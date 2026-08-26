import path from 'node:path';
import {
  PLUGIN_ROOT,
  loadConfig,
  loadPresets,
  loadState,
  pathExists,
  saveState,
  withDataLock
} from './config.mjs';

export function isQuietHours(quietHours, now = new Date()) {
  if (!quietHours?.enabled) return false;
  const toMinutes = (time) => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };
  const current = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(quietHours.start);
  const end = toMinutes(quietHours.end);
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function inferHost(input = {}, env = process.env) {
  if (env.CODEX_THREAD_ID || input.model) return 'codex';
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return 'claude-code';
  return 'agent';
}

export async function availableReminders(config) {
  const presets = await loadPresets();
  const disabled = new Set(config.disabledPresetIds);
  const builtins = presets.reminders
    .filter((item) => !disabled.has(item.id))
    .map((item) => ({
      ...item,
      kind: 'preset',
      iconPath: path.join(PLUGIN_ROOT, 'assets', 'actions', item.icon)
    }));
  const custom = config.customReminders
    .filter((item) => item.enabled !== false)
    .map((item) => ({ ...item, kind: 'custom' }));
  return [...builtins, ...custom];
}

function chooseReminder(reminders, config, state, random = Math.random) {
  if (reminders.length === 0) return null;
  let index;
  if (config.order === 'cycle') {
    index = state.nextReminderIndex % reminders.length;
    state.nextReminderIndex = (index + 1) % reminders.length;
  } else {
    index = Math.min(reminders.length - 1, Math.floor(random() * reminders.length));
    if (reminders.length > 1 && reminders[index].id === state.lastReminderId) {
      index = (index + 1) % reminders.length;
    }
  }
  return reminders[index];
}

function chooseCompanion(config, state) {
  if (config.companion === 'none' || config.companions.length === 0) return null;
  if (config.companion === 'rotate') {
    const index = state.nextCompanionIndex % config.companions.length;
    state.nextCompanionIndex = (index + 1) % config.companions.length;
    return config.companions[index];
  }
  return config.companions.find((item) => item.id === config.companion) ?? null;
}

async function toPayload(reminder, companion, durationSeconds) {
  let assetPath = reminder.assetPath ?? null;
  if (companion?.assets?.[reminder.id]) assetPath = companion.assets[reminder.id];
  if (assetPath && !(await pathExists(assetPath))) assetPath = null;
  return {
    id: reminder.id,
    title: reminder.title,
    message: reminder.message,
    iconText: reminder.iconText ?? null,
    iconPath: reminder.iconPath ?? null,
    assetPath,
    companionId: companion?.id ?? null,
    companionName: companion?.name ?? null,
    durationSeconds
  };
}

export async function recordActivity(input = {}, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const random = options.random ?? Math.random;
  const env = options.env ?? process.env;

  return withDataLock(async () => {
    const config = await loadConfig(env);
    const state = await loadState(env);
    const previous = state.lastActivityAt ? Date.parse(state.lastActivityAt) : null;
    const now = new Date(nowMs);

    if (!config.enabled) {
      state.lastActivityAt = now.toISOString();
      state.activeMs = 0;
      await saveState(state, env);
      return { due: false, reason: 'disabled', config, state };
    }

    if (previous !== null) {
      const delta = Math.max(0, nowMs - previous);
      if (delta > config.idleResetMinutes * 60_000) state.activeMs = 0;
      else state.activeMs += delta;
    }

    state.lastActivityAt = now.toISOString();
    state.lastEventName = String(input.hook_event_name ?? input.event ?? 'activity');
    state.lastHost = inferHost(input, env);

    const intervalMs = config.intervalMinutes * 60_000;
    const snoozed = state.snoozedUntil && Date.parse(state.snoozedUntil) > nowMs;
    const quiet = isQuietHours(config.quietHours, now);
    const reminders = await availableReminders(config);
    const eligible = state.activeMs >= intervalMs && !snoozed && !quiet && reminders.length > 0;

    if (!eligible) {
      await saveState(state, env);
      return {
        due: false,
        reason: snoozed ? 'snoozed' : quiet ? 'quiet-hours' : reminders.length === 0 ? 'no-reminders' : 'not-due',
        remainingMs: Math.max(0, intervalMs - state.activeMs),
        config,
        state
      };
    }

    const reminder = chooseReminder(reminders, config, state, random);
    const companion = chooseCompanion(config, state);
    const payload = await toPayload(reminder, companion, config.reminderDurationSeconds);
    state.activeMs = 0;
    state.snoozedUntil = null;
    state.lastReminderAt = now.toISOString();
    state.lastReminderId = reminder.id;
    state.reminderCount += 1;
    await saveState(state, env);

    return { due: true, payload, config, state };
  }, env);
}

export async function previewReminder(id, options = {}) {
  const env = options.env ?? process.env;
  const config = await loadConfig(env);
  const state = await loadState(env);
  const reminders = await availableReminders(config);
  const reminder = reminders.find((item) => item.id === id) ?? reminders[0];
  if (!reminder) throw new Error('No enabled reminders are available.');
  const companion = chooseCompanion(config, state);
  return toPayload(reminder, companion, config.reminderDurationSeconds);
}

export function formatAgentReminder(payload) {
  const icon = payload.iconText ? `${payload.iconText} ` : '';
  return `🌱 Touch Grass\n${icon}${payload.title}\n${payload.message}`;
}

export async function statusSnapshot(env = process.env) {
  const config = await loadConfig(env);
  const state = await loadState(env);
  const remainingMs = Math.max(0, config.intervalMinutes * 60_000 - state.activeMs);
  return {
    enabled: config.enabled,
    delivery: config.delivery,
    intervalMinutes: config.intervalMinutes,
    activeMinutes: Math.round((state.activeMs / 60_000) * 10) / 10,
    remainingMinutes: Math.ceil(remainingMs / 60_000),
    snoozedUntil: state.snoozedUntil,
    lastReminderAt: state.lastReminderAt,
    lastReminderId: state.lastReminderId,
    reminderCount: state.reminderCount,
    lastHost: state.lastHost
  };
}
