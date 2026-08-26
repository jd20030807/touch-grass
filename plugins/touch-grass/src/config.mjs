import { constants as fsConstants } from 'node:fs';
import { access, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CURRENT_ONBOARDING_VERSION = 3;
const PRESETS_PATH = path.join(PLUGIN_ROOT, 'presets.json');

export const DEFAULT_REMINDER_SCHEDULES = Object.freeze({
  eyes: Object.freeze({ kind: 'active', intervalMinutes: 20 }),
  water: Object.freeze({ kind: 'active', intervalMinutes: 30 }),
  stretch: Object.freeze({ kind: 'active', intervalMinutes: 60 }),
  walk: Object.freeze({ kind: 'active', intervalMinutes: 120 }),
  snack: Object.freeze({ kind: 'clock', times: Object.freeze(['10:30', '15:30']), graceMinutes: 60 }),
  bedtime: Object.freeze({ kind: 'bedtime', time: '22:00', windDownMinutes: 20, graceMinutes: 120 })
});

const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: 2,
  enabled: true,
  idleResetMinutes: 10,
  reminderDurationSeconds: 18,
  companion: 'rotate',
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '08:00'
  },
  reminderSchedules: DEFAULT_REMINDER_SCHEDULES,
  disabledPresetIds: [],
  customReminders: [],
  companions: []
});

const DEFAULT_STATE = Object.freeze({
  schemaVersion: 3,
  onboardingShown: false,
  onboardingVersion: 0,
  activeMsByReminder: {},
  presenceCursor: null,
  deliveredOccurrences: [],
  lastReminderAt: null,
  lastReminderAtById: {},
  lastReminderId: null,
  nextCompanionIndex: 0,
  snoozedUntil: null,
  reminderCount: 0
});

export function getDataDir(env = process.env) {
  if (env.TOUCH_GRASS_HOME) return path.resolve(env.TOUCH_GRASS_HOME);
  if (process.platform === 'win32' && env.APPDATA) return path.join(env.APPDATA, 'touch-grass');
  return path.join(os.homedir(), '.touch-grass');
}

export function getDataPaths(env = process.env) {
  const dir = getDataDir(env);
  return {
    dir,
    config: path.join(dir, 'config.json'),
    state: path.join(dir, 'state.json'),
    lock: path.join(dir, '.state.lock')
  };
}

export async function loadPresets() {
  return JSON.parse(await readFile(PRESETS_PATH, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function defaultConfig() {
  return clone(DEFAULT_CONFIG);
}

export function defaultState() {
  return clone(DEFAULT_STATE);
}

function requireNumber(value, name, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return number;
}

function cleanId(value, label = 'id') {
  const id = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id)) {
    throw new Error(`${label} must use lowercase letters, numbers, and hyphens.`);
  }
  return id === 'nap' ? 'bedtime' : id;
}

function cleanText(value, label, maxLength) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength) {
    throw new Error(`${label} must contain 1-${maxLength} characters.`);
  }
  return text;
}

function cleanTime(value, label) {
  const time = String(value ?? '');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error(`${label} must use 24-hour HH:MM format.`);
  }
  return time;
}

function cleanTimes(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) {
    throw new Error(`${label} must contain 1-12 times.`);
  }
  return [...new Set(value.map((time) => cleanTime(time, label)))].sort();
}

export function normalizeSchedule(input, fallback = { kind: 'active', intervalMinutes: 60 }) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const kind = source.kind ?? fallback.kind;
  if (kind === 'active') {
    return {
      kind,
      intervalMinutes: requireNumber(
        source.intervalMinutes ?? fallback.intervalMinutes ?? 60,
        'schedule.intervalMinutes',
        1,
        480
      )
    };
  }
  if (kind === 'clock') {
    return {
      kind,
      times: cleanTimes(source.times ?? fallback.times ?? ['12:00'], 'schedule.times'),
      graceMinutes: requireNumber(source.graceMinutes ?? fallback.graceMinutes ?? 60, 'schedule.graceMinutes', 5, 240)
    };
  }
  if (kind === 'bedtime') {
    return {
      kind,
      time: cleanTime(source.time ?? fallback.time ?? '22:00', 'schedule.time'),
      windDownMinutes: requireNumber(
        source.windDownMinutes ?? fallback.windDownMinutes ?? 20,
        'schedule.windDownMinutes',
        5,
        180
      ),
      graceMinutes: requireNumber(source.graceMinutes ?? fallback.graceMinutes ?? 120, 'schedule.graceMinutes', 5, 240)
    };
  }
  throw new Error('schedule.kind must be active, clock, or bedtime.');
}

function cleanAssetMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const assets = {};
  for (const [rawKey, rawPath] of Object.entries(value)) {
    if (!rawPath) continue;
    assets[cleanId(rawKey, 'asset action')] = path.resolve(String(rawPath));
  }
  return assets;
}

function normalizeCustomReminder(item) {
  return {
    id: cleanId(item.id, 'reminder id'),
    title: cleanText(item.title, 'reminder title', 80),
    message: cleanText(item.message, 'reminder message', 220),
    iconText: item.iconText ? cleanText(item.iconText, 'reminder icon', 8) : '•',
    enabled: item.enabled !== false,
    schedule: normalizeSchedule(item.schedule),
    ...(item.assetPath ? { assetPath: path.resolve(String(item.assetPath)) } : {})
  };
}

function normalizeCompanion(item) {
  return {
    id: cleanId(item.id, 'companion id'),
    name: cleanText(item.name || item.id, 'companion name', 60),
    assets: cleanAssetMap(item.assets)
  };
}

function normalizeReminderSchedules(input = {}, legacyInterval) {
  const result = {};
  for (const [id, fallback] of Object.entries(DEFAULT_REMINDER_SCHEDULES)) {
    let migratedFallback = fallback;
    if (Number.isFinite(legacyInterval) && fallback.kind === 'active') {
      migratedFallback = { kind: 'active', intervalMinutes: legacyInterval };
    }
    result[id] = normalizeSchedule(input[id], migratedFallback);
  }
  return result;
}

export function normalizeConfig(input = {}) {
  const base = defaultConfig();
  const quiet = input.quietHours && typeof input.quietHours === 'object' ? input.quietHours : {};
  const legacyInterval = input.reminderSchedules ? null : Number(input.intervalMinutes);
  const config = {
    schemaVersion: 2,
    enabled: input.enabled ?? base.enabled,
    idleResetMinutes: requireNumber(input.idleResetMinutes ?? base.idleResetMinutes, 'idleResetMinutes', 1, 180),
    reminderDurationSeconds: requireNumber(
      input.reminderDurationSeconds ?? base.reminderDurationSeconds,
      'reminderDurationSeconds',
      5,
      120
    ),
    companion: input.companion === 'none' ? 'rotate' : String(input.companion ?? base.companion),
    quietHours: {
      enabled: quiet.enabled ?? base.quietHours.enabled,
      start: cleanTime(quiet.start ?? base.quietHours.start, 'quietHours.start'),
      end: cleanTime(quiet.end ?? base.quietHours.end, 'quietHours.end')
    },
    reminderSchedules: normalizeReminderSchedules(input.reminderSchedules, legacyInterval),
    disabledPresetIds: [...new Set((input.disabledPresetIds ?? []).map((id) => cleanId(id, 'preset id')))],
    customReminders: (input.customReminders ?? []).map(normalizeCustomReminder),
    companions: (input.companions ?? []).map(normalizeCompanion)
  };

  if (typeof config.enabled !== 'boolean' || typeof config.quietHours.enabled !== 'boolean') {
    throw new Error('enabled values must be true or false.');
  }

  const reminderIds = new Set();
  for (const reminder of config.customReminders) {
    if (reminderIds.has(reminder.id)) throw new Error(`Duplicate reminder id: ${reminder.id}`);
    reminderIds.add(reminder.id);
  }
  const companionIds = new Set();
  for (const companion of config.companions) {
    if (companionIds.has(companion.id)) throw new Error(`Duplicate companion id: ${companion.id}`);
    companionIds.add(companion.id);
  }
  if (config.companion !== 'rotate') config.companion = cleanId(config.companion, 'companion id');

  return config;
}

function cleanNumberMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([id, number]) => [cleanId(id), Math.max(0, Number(number) || 0)])
  );
}

function cleanStringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, text]) => typeof text === 'string' && text)
      .map(([id, text]) => [cleanId(id), text])
  );
}

function cleanPresenceCursor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const helperInstanceId = typeof value.helperInstanceId === 'string' ? value.helperInstanceId : '';
  const stretchId = typeof value.stretchId === 'string' ? value.stretchId : '';
  const stretchEngagedMs = Number(value.stretchEngagedMs);
  if (
    !/^[a-zA-Z0-9-]{1,80}$/.test(helperInstanceId)
    || !/^[a-zA-Z0-9-]{1,80}$/.test(stretchId)
    || !Number.isFinite(stretchEngagedMs)
    || stretchEngagedMs < 0
  ) return null;
  return { helperInstanceId, stretchId, stretchEngagedMs: Math.round(stretchEngagedMs) };
}

function normalizeState(input = {}) {
  const legacyActive = Math.max(0, Number(input.activeMs) || 0);
  const activeMsByReminder = Object.keys(input.activeMsByReminder ?? {}).length > 0
    ? cleanNumberMap(input.activeMsByReminder)
    : Object.fromEntries(
      Object.entries(DEFAULT_REMINDER_SCHEDULES)
        .filter(([, schedule]) => schedule.kind === 'active')
        .map(([id]) => [id, legacyActive])
    );
  const onboardingVersion = Number.isFinite(Number(input.onboardingVersion))
    ? Math.max(0, Number(input.onboardingVersion))
    : input.onboardingShown === true ? 1 : 0;
  return {
    schemaVersion: 3,
    onboardingShown: onboardingVersion >= CURRENT_ONBOARDING_VERSION,
    onboardingVersion,
    activeMsByReminder,
    presenceCursor: cleanPresenceCursor(input.presenceCursor),
    deliveredOccurrences: [...new Set(
      (Array.isArray(input.deliveredOccurrences) ? input.deliveredOccurrences : [])
        .filter((value) => typeof value === 'string' && value.length <= 100)
    )].slice(-64),
    lastReminderAt: typeof input.lastReminderAt === 'string' ? input.lastReminderAt : null,
    lastReminderAtById: cleanStringMap(input.lastReminderAtById),
    lastReminderId: typeof input.lastReminderId === 'string' ? input.lastReminderId : null,
    nextCompanionIndex: Math.max(0, Number(input.nextCompanionIndex) || 0),
    snoozedUntil: typeof input.snoozedUntil === 'string' ? input.snoozedUntil : null,
    reminderCount: Math.max(0, Number(input.reminderCount) || 0)
  };
}

async function readJsonOrDefault(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return clone(fallback);
    throw new Error(`Could not read ${filePath}: ${error.message}`);
  }
}

async function atomicWrite(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, filePath);
}

export async function ensureDataDir(env = process.env) {
  const paths = getDataPaths(env);
  await mkdir(paths.dir, { recursive: true, mode: 0o700 });
  return paths;
}

export async function loadConfig(env = process.env) {
  const paths = await ensureDataDir(env);
  return normalizeConfig(await readJsonOrDefault(paths.config, DEFAULT_CONFIG));
}

export async function saveConfig(config, env = process.env) {
  const paths = await ensureDataDir(env);
  const normalized = normalizeConfig(config);
  await atomicWrite(paths.config, normalized);
  return normalized;
}

export async function loadState(env = process.env) {
  const paths = await ensureDataDir(env);
  return normalizeState(await readJsonOrDefault(paths.state, DEFAULT_STATE));
}

export async function saveState(state, env = process.env) {
  const paths = await ensureDataDir(env);
  const normalized = normalizeState(state);
  await atomicWrite(paths.state, normalized);
  return normalized;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withDataLock(callback, env = process.env) {
  const paths = await ensureDataDir(env);
  let handle;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      handle = await open(paths.lock, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
      await handle.writeFile(`${process.pid}\n`);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const lockStat = await stat(paths.lock);
        if (Date.now() - lockStat.mtimeMs > 10_000) await unlink(paths.lock);
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
      }
      await delay(15 + attempt * 10);
    }
  }

  if (!handle) throw new Error('Touch Grass is busy. Try again in a moment.');
  try {
    return await callback(paths);
  } finally {
    await handle.close().catch(() => {});
    await unlink(paths.lock).catch(() => {});
  }
}

export async function pathExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

export async function updateConfig(mutator, env = process.env) {
  return withDataLock(async () => {
    const config = await loadConfig(env);
    const next = await mutator(clone(config));
    return saveConfig(next ?? config, env);
  }, env);
}

export async function updateState(mutator, env = process.env) {
  return withDataLock(async () => {
    const state = await loadState(env);
    const next = await mutator(clone(state));
    return saveState(next ?? state, env);
  }, env);
}
