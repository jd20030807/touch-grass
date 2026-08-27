import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  COMPANION_PAIR_ART,
  PLUGIN_ROOT,
  loadConfig,
  loadPresets,
  loadState,
  pathExists,
  saveState,
  withDataLock
} from './config.mjs';
import { publishAgentSession, readPresenceSnapshot } from './bridge.mjs';

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
  // Markers the host sets for this specific hook invocation win over markers
  // inherited from a parent shell, so Codex launched from a Claude Code Bash
  // tool (or Claude Code launched from a Codex exec) still labels its lease
  // with the app that actually fired the hook.
  if (env.CLAUDE_PLUGIN_ROOT) return 'claude-code';
  if (env.CODEX_THREAD_ID) return 'codex';
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
      schedule: config.reminderSchedules[item.id],
      iconPath: path.join(PLUGIN_ROOT, 'assets', 'actions', item.icon)
    }));
  const custom = config.customReminders
    .filter((item) => item.enabled !== false)
    .map((item) => ({ ...item, kind: 'custom' }));
  return [...builtins, ...custom];
}

export async function availableCompanions(config) {
  const manifestPath = path.join(PLUGIN_ROOT, 'assets', 'companions', 'manifest.json');
  let bundled = [];
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    bundled = (manifest.companions ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      bundled: true,
      assets: Object.fromEntries(
        Object.entries(item.assets ?? {}).map(([action, relativePath]) => [
          action === 'nap' ? 'bedtime' : action,
          path.join(PLUGIN_ROOT, 'assets', 'companions', item.id, relativePath)
        ])
      )
    }));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const hidden = new Set(config.hiddenCompanionIds ?? []);
  const visibleBundled = bundled.filter((item) => !hidden.has(item.id));
  // Never hide every cat: a reminder with no companion has nothing to show.
  const usableBundled = visibleBundled.length > 0 || config.companions.length > 0
    ? visibleBundled
    : bundled;
  return [...usableBundled, ...config.companions];
}

function chooseCompanion(companions, config, random = Math.random) {
  if (companions.length === 0) return null;
  if (config.companion === 'rotate') {
    const sample = Number(random());
    const bounded = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 0.999999999999) : 0;
    const index = Math.floor(bounded * companions.length);
    return companions[index];
  }
  return companions.find((item) => item.id === config.companion) ?? companions[0];
}

// Several clocks can come due within the same minute — at the one-hour mark eye
// rest, water, and stretch are all exactly at their interval. Only one reminder
// is delivered per hook, and hooks fire every few seconds, so without a floor
// they arrive as one burst. Bedtime is exempt: its two stages are deliberately
// close together and it is the reminder least worth postponing.
const MINIMUM_REMINDER_GAP_MS = 5 * 60_000;

// Portraits of the cats still in rotation. A user who hid Nian should not meet
// her again on reminders that have no animation of their own.
async function fallbackPortraits(config) {
  const present = [];
  for (const companion of (await availableCompanions(config)).filter((item) => item.bundled)) {
    const artPath = path.join(PLUGIN_ROOT, 'assets', 'welcome', `${companion.id}.png`);
    if (await pathExists(artPath)) present.push(artPath);
  }
  return present;
}

async function toPayload(reminder, companion, durationSeconds, presentation = {}, config = null) {
  const assetAction = presentation.assetAction ?? reminder.id;
  let assetPath = reminder.assetPath ?? null;
  if (companion?.assets?.[assetAction]) assetPath = companion.assets[assetAction];
  if (assetPath && !(await pathExists(assetPath))) assetPath = null;
  const portraits = assetPath || !config ? [] : await fallbackPortraits(config);
  // Two portraits use the pair layout; a lone remaining cat still gets shown.
  const pairArt = portraits.length >= 2 ? portraits.slice(0, 2) : [];
  if (!assetPath && pairArt.length === 0 && portraits.length === 1) assetPath = portraits[0];
  return {
    ...(pairArt.length > 0 ? { assetPaths: pairArt } : {}),
    id: assetAction,
    eventId: presentation.eventId ?? reminder.id,
    title: presentation.title ?? reminder.title,
    message: presentation.message ?? reminder.message,
    iconText: reminder.iconText ?? null,
    iconPath: reminder.iconPath ?? null,
    assetPath,
    companionId: companion?.id ?? null,
    companionName: companion?.name ?? null,
    artPending: !assetPath && pairArt.length === 0,
    durationSeconds
  };
}

function dateAtLocalTime(reference, time, dayOffset = 0) {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate() + dayOffset,
    hours,
    minutes,
    0,
    0
  );
}

function localStamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function clockCandidates(reminder, now, delivered) {
  const candidates = [];
  const graceMs = reminder.schedule.graceMinutes * 60_000;
  for (const time of reminder.schedule.times) {
    for (const offset of [-1, 0]) {
      const occurrence = dateAtLocalTime(now, time, offset);
      const age = now.getTime() - occurrence.getTime();
      const occurrenceKey = `${reminder.id}@${localStamp(occurrence)}`;
      if (age >= 0 && age <= graceMs && !delivered.has(occurrenceKey)) {
        candidates.push({ reminder, occurrenceKey, scheduledAt: occurrence.getTime() });
      }
    }
  }
  return candidates;
}

function bedtimeCandidates(reminder, now, delivered) {
  const candidates = [];
  const schedule = reminder.schedule;
  for (const offset of [-1, 0, 1]) {
    const bedtime = dateAtLocalTime(now, schedule.time, offset);
    const windDown = new Date(bedtime.getTime() - schedule.windDownMinutes * 60_000);
    const bedtimeStamp = localStamp(bedtime);
    const windDownKey = `${reminder.id}-wind-down@${bedtimeStamp}`;
    if (now >= windDown && now < bedtime && !delivered.has(windDownKey)) {
      candidates.push({
        reminder,
        occurrenceKey: windDownKey,
        scheduledAt: windDown.getTime(),
        presentation: {
          assetAction: 'bedtime',
          eventId: 'bedtime-wind-down',
          title: reminder.stages?.windDown?.title ?? 'Start winding down',
          message: `Bedtime is in ${schedule.windDownMinutes} minutes. Wrap up this thought and save your place.`
        }
      });
    }

    const age = now.getTime() - bedtime.getTime();
    const bedtimeKey = `${reminder.id}@${bedtimeStamp}`;
    if (age >= 0 && age <= schedule.graceMinutes * 60_000 && !delivered.has(bedtimeKey)) {
      candidates.push({
        reminder,
        occurrenceKey: bedtimeKey,
        scheduledAt: bedtime.getTime(),
        presentation: {
          assetAction: 'bedtime',
          eventId: 'bedtime',
          title: reminder.stages?.bedtime?.title ?? reminder.title,
          message: reminder.stages?.bedtime?.message ?? reminder.message
        }
      });
    }
  }
  return candidates;
}

function scheduledCandidates(reminders, state, now) {
  const delivered = new Set(state.deliveredOccurrences);
  return reminders
    .flatMap((reminder) => {
      if (reminder.schedule?.kind === 'clock') return clockCandidates(reminder, now, delivered);
      if (reminder.schedule?.kind === 'bedtime') return bedtimeCandidates(reminder, now, delivered);
      return [];
    })
    .sort((left, right) => right.scheduledAt - left.scheduledAt);
}

function updateActiveClocks(reminders, state, deltaMs, reset) {
  if (reset) state.activeMsByReminder = {};
  for (const reminder of reminders) {
    if (reminder.schedule?.kind !== 'active') continue;
    const previous = Math.max(0, Number(state.activeMsByReminder[reminder.id]) || 0);
    state.activeMsByReminder[reminder.id] = previous + deltaMs;
  }
}

function applyPresenceProgress(reminders, state, presence) {
  if (!presence) return { engaged: false, available: false, deltaMs: 0, reset: false };

  const previous = state.presenceCursor;
  const sameStretch = previous
    && previous.helperInstanceId === presence.helperInstanceId
    && previous.stretchId === presence.stretchId;
  const counterMovedBackwards = sameStretch
    && presence.stretchEngagedMs < previous.stretchEngagedMs;
  const reset = !sameStretch || counterMovedBackwards;
  const deltaMs = reset
    ? presence.stretchEngagedMs
    : Math.max(0, presence.stretchEngagedMs - previous.stretchEngagedMs);

  updateActiveClocks(reminders, state, deltaMs, reset);
  state.presenceCursor = {
    helperInstanceId: presence.helperInstanceId,
    stretchId: presence.stretchId,
    stretchEngagedMs: presence.stretchEngagedMs
  };
  return { engaged: presence.engaged, available: true, deltaMs, reset };
}

function activeCandidates(reminders, state) {
  return reminders
    .filter((reminder) => reminder.schedule?.kind === 'active')
    .map((reminder) => {
      const intervalMs = reminder.schedule.intervalMinutes * 60_000;
      const activeMs = state.activeMsByReminder[reminder.id] ?? 0;
      return { reminder, intervalMs, activeMs, urgency: activeMs / intervalMs };
    })
    .filter((candidate) => candidate.activeMs >= candidate.intervalMs)
    .sort((left, right) => right.urgency - left.urgency || left.intervalMs - right.intervalMs);
}

export async function recordActivity(input = {}, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const env = options.env ?? process.env;
  const host = inferHost(input, env);
  const eventName = String(input.hook_event_name ?? input.event ?? 'activity');

  if (eventName.toLowerCase().replace('_', '') === 'sessionend') {
    await publishAgentSession(input, { env, nowMs, host });
    return { due: false, reason: 'session-ended' };
  }

  return withDataLock(async () => {
    const config = await loadConfig(env);
    const state = await loadState(env);
    const now = new Date(nowMs);
    const reminders = await availableReminders(config);
    await publishAgentSession(input, {
      env,
      nowMs,
      host,
      awayResetMinutes: config.idleResetMinutes
    });
    const presence = await readPresenceSnapshot(env, nowMs);
    const progress = applyPresenceProgress(reminders, state, presence);

    if (!config.enabled) {
      state.activeMsByReminder = {};
      await saveState(state, env);
      return { due: false, reason: 'disabled', config, state };
    }

    const snoozed = state.snoozedUntil && Date.parse(state.snoozedUntil) > nowMs;
    const quiet = isQuietHours(config.quietHours, now);
    const scheduled = scheduledCandidates(reminders, state, now);
    const active = activeCandidates(reminders, state);
    const eligible = progress.engaged
      && !snoozed
      && !quiet
      && reminders.length > 0
      && (scheduled.length > 0 || active.length > 0);

    if (!eligible) {
      await saveState(state, env);
      return {
        due: false,
        reason: !progress.available
          ? 'presence-unavailable'
          : !progress.engaged
            ? 'not-active'
            : snoozed
              ? 'snoozed'
              : quiet
                ? 'quiet-hours'
                : reminders.length === 0 ? 'no-reminders' : 'not-due',
        config,
        state,
        presence
      };
    }

    const candidate = scheduled[0] ?? active[0];
    const reminder = candidate.reminder;

    const lastReminderMs = state.lastReminderAt ? Date.parse(state.lastReminderAt) : Number.NaN;
    const sinceLastReminderMs = Number.isFinite(lastReminderMs)
      ? nowMs - lastReminderMs
      : Number.POSITIVE_INFINITY;
    if (reminder.schedule?.kind !== 'bedtime' && sinceLastReminderMs < MINIMUM_REMINDER_GAP_MS) {
      await saveState(state, env);
      return { due: false, reason: 'recently-reminded', config, state, presence };
    }
    const companions = await availableCompanions(config);
    const companion = chooseCompanion(companions, config, options.random ?? Math.random);
    const payload = await toPayload(reminder, companion, config.reminderDurationSeconds, candidate.presentation, config);

    // Show the banner before recording it as delivered. If the popup companion
    // is not running — after a restart, say — the reminder stays due instead of
    // being marked delivered and silently lost.
    if (options.deliver) {
      try {
        await options.deliver(payload);
      } catch (error) {
        await saveState(state, env);
        return { due: false, reason: 'popup-unavailable', error: error.message, config, state, presence };
      }
    }

    if (candidate.occurrenceKey) {
      state.deliveredOccurrences = [...state.deliveredOccurrences, candidate.occurrenceKey].slice(-64);
    } else {
      state.activeMsByReminder[reminder.id] = 0;
    }
    if (state.snoozedUntil && Date.parse(state.snoozedUntil) <= nowMs) state.snoozedUntil = null;
    state.lastReminderAt = now.toISOString();
    state.lastReminderAtById[reminder.id] = now.toISOString();
    state.lastReminderId = payload.eventId;
    state.reminderCount += 1;
    await saveState(state, env);

    return { due: true, payload, config, state, presence };
  }, env);
}

export async function previewReminder(id, options = {}) {
  const env = options.env ?? process.env;
  const config = await loadConfig(env);
  const reminders = await availableReminders(config);
  const windDownAliases = new Set(['wind-down', 'winddown', 'bedtime-wind-down']);
  const isWindDown = windDownAliases.has(id);
  const requestedId = id === 'nap' || isWindDown ? 'bedtime' : id;
  const reminder = reminders.find((item) => item.id === requestedId);
  if (!reminder) {
    const presets = await loadPresets();
    const known = presets.reminders.some((item) => item.id === requestedId)
      || config.customReminders.some((item) => item.id === requestedId);
    throw new Error(known
      ? `Reminder ${id} is turned off right now. Turn it back on to preview it.`
      : `Reminder ${id} is not available.`);
  }
  const companions = await availableCompanions(config);
  const companion = options.companionId
    ? companions.find((item) => item.id === options.companionId)
    : chooseCompanion(companions, config, options.random ?? Math.random);
  if (options.companionId && !companion) {
    throw new Error(`Companion ${options.companionId} is not available.`);
  }
  let presentation = {};
  if (isWindDown) {
    const windDownMinutes = reminder.schedule?.windDownMinutes ?? 20;
    presentation = {
      assetAction: 'bedtime',
      eventId: 'bedtime-wind-down',
      title: reminder.stages?.windDown?.title,
      message: `Bedtime is in ${windDownMinutes} minutes. Wrap up this thought and save your place.`
    };
  } else if (requestedId === 'bedtime') {
    presentation = {
      assetAction: 'bedtime',
      eventId: 'bedtime',
      title: reminder.stages?.bedtime?.title,
      message: reminder.stages?.bedtime?.message
    };
  }
  return toPayload(reminder, companion, config.reminderDurationSeconds, presentation, config);
}

export async function statusSnapshot(env = process.env, nowMs = Date.now()) {
  const config = await loadConfig(env);
  const state = await loadState(env);
  const presence = await readPresenceSnapshot(env, nowMs);
  return {
    enabled: config.enabled,
    schedules: config.reminderSchedules,
    activeMinutesByReminder: Object.fromEntries(
      Object.entries(state.activeMsByReminder).map(([id, value]) => [id, Math.round((value / 60_000) * 10) / 10])
    ),
    snoozedUntil: state.snoozedUntil,
    lastReminderAt: state.lastReminderAt,
    lastReminderId: state.lastReminderId,
    reminderCount: state.reminderCount,
    presenceAvailable: presence !== null,
    currentlyEngaged: presence?.engaged === true
  };
}
