#!/usr/bin/env node

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  defaultConfig,
  getDataPaths,
  loadConfig,
  loadPresets,
  loadState,
  pathExists,
  updateConfig,
  updateState
} from '../src/config.mjs';
import { availableReminders, formatAgentReminder, previewReminder, recordActivity, statusSnapshot } from '../src/engine.mjs';
import { launchReminder, resolveReminderCommand } from '../src/launcher.mjs';

function parseArgs(tokens) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = tokens[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else flags[key] = true;
  }
  return { positionals, flags };
}

function print(value) {
  process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
}

function boolValue(value) {
  if (['true', 'on', 'yes', '1'].includes(String(value).toLowerCase())) return true;
  if (['false', 'off', 'no', '0'].includes(String(value).toLowerCase())) return false;
  throw new Error('Expected true/false or on/off.');
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input.trim() ? JSON.parse(input) : {};
}

async function setConfigValue(key, rawValue) {
  const aliases = {
    interval: 'intervalMinutes',
    'idle-reset': 'idleResetMinutes',
    duration: 'reminderDurationSeconds'
  };
  const canonical = aliases[key] ?? key;
  const config = await updateConfig((current) => {
    if (canonical === 'enabled') current.enabled = boolValue(rawValue);
    else if (['intervalMinutes', 'idleResetMinutes', 'reminderDurationSeconds'].includes(canonical)) {
      current[canonical] = Number(rawValue);
    } else if (canonical === 'order') current.order = rawValue;
    else if (canonical === 'delivery') current.delivery = rawValue;
    else if (canonical === 'companion') current.companion = rawValue;
    else if (canonical === 'quiet-hours') {
      if (String(rawValue).toLowerCase() === 'off') current.quietHours.enabled = false;
      else {
        const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(String(rawValue));
        if (!match) throw new Error('quiet-hours must be off or HH:MM-HH:MM.');
        current.quietHours = { enabled: true, start: match[1], end: match[2] };
      }
    } else throw new Error(`Unknown setting: ${key}`);
    return current;
  });
  print(config);
}

async function setReminderEnabled(id, enabled) {
  const presets = await loadPresets();
  const presetIds = new Set(presets.reminders.map((item) => item.id));
  const config = await updateConfig((current) => {
    if (presetIds.has(id)) {
      const disabled = new Set(current.disabledPresetIds);
      if (enabled) disabled.delete(id);
      else disabled.add(id);
      current.disabledPresetIds = [...disabled];
      return current;
    }
    const reminder = current.customReminders.find((item) => item.id === id);
    if (!reminder) throw new Error(`Unknown reminder: ${id}`);
    reminder.enabled = enabled;
    return current;
  });
  print({ id, enabled, disabledPresetIds: config.disabledPresetIds });
}

async function addReminder(id, flags) {
  if (!flags.title || !flags.message) throw new Error('reminders add requires --title and --message.');
  const presets = await loadPresets();
  if (presets.reminders.some((item) => item.id === id)) throw new Error(`A preset already uses the id ${id}.`);
  const config = await updateConfig((current) => {
    if (current.customReminders.some((item) => item.id === id)) throw new Error(`Reminder ${id} already exists.`);
    current.customReminders.push({
      id,
      title: flags.title,
      message: flags.message,
      iconText: flags.icon ?? '•',
      enabled: true,
      ...(flags.gif ? { assetPath: path.resolve(flags.gif) } : {})
    });
    return current;
  });
  print(config.customReminders.find((item) => item.id === id));
}

async function removeReminder(id) {
  const config = await updateConfig((current) => {
    const before = current.customReminders.length;
    current.customReminders = current.customReminders.filter((item) => item.id !== id);
    if (current.customReminders.length === before) throw new Error(`Custom reminder ${id} was not found.`);
    return current;
  });
  print({ removed: id, customReminderCount: config.customReminders.length });
}

async function addCompanion(id, flags) {
  if (!flags.dir) throw new Error('companions add requires --dir /path/to/assets.');
  const directory = path.resolve(flags.dir);
  if (!(await pathExists(directory))) throw new Error(`Directory does not exist: ${directory}`);
  const files = new Set(await readdir(directory));
  const presets = await loadPresets();
  const extensions = ['gif', 'webp', 'png', 'jpg', 'jpeg'];
  const assets = {};
  for (const reminder of presets.reminders) {
    const filename = extensions.map((ext) => `${reminder.id}.${ext}`).find((candidate) => files.has(candidate));
    if (filename) assets[reminder.id] = path.join(directory, filename);
  }
  if (Object.keys(assets).length === 0) {
    throw new Error('No matching assets found. Use filenames such as water.gif, stretch.gif, and nap.gif.');
  }
  const config = await updateConfig((current) => {
    if (current.companions.some((item) => item.id === id)) throw new Error(`Companion ${id} already exists.`);
    current.companions.push({ id, name: flags.name ?? id, assets });
    if (current.companion === 'none') current.companion = id;
    return current;
  });
  print(config.companions.find((item) => item.id === id));
}

async function removeCompanion(id) {
  const config = await updateConfig((current) => {
    const before = current.companions.length;
    current.companions = current.companions.filter((item) => item.id !== id);
    if (current.companions.length === before) throw new Error(`Companion ${id} was not found.`);
    if (current.companion === id) current.companion = current.companions.length ? 'rotate' : 'none';
    return current;
  });
  print({ removed: id, companion: config.companion });
}

async function doctor() {
  const config = await loadConfig();
  const state = await loadState();
  const paths = getDataPaths();
  const reminders = await availableReminders(config);
  const missingAssets = [];
  for (const companion of config.companions) {
    for (const [action, assetPath] of Object.entries(companion.assets)) {
      if (!(await pathExists(assetPath))) missingAssets.push({ companion: companion.id, action, assetPath });
    }
  }
  const sample = reminders[0] ? await previewReminder(reminders[0].id) : null;
  const launch = sample ? resolveReminderCommand('file:///touch-grass-preview') : null;
  print({
    ok: missingAssets.length === 0 && reminders.length > 0,
    node: process.version,
    platform: process.platform,
    dataDir: paths.dir,
    enabledReminders: reminders.map((item) => item.id),
    companion: config.companion,
    missingAssets,
    reminderWindow: launch,
    state
  });
}

async function showSettings() {
  const config = await loadConfig();
  const reminders = await availableReminders(config);
  print(`Touch Grass settings (stored only on this computer)

Delivery: ${config.delivery === 'agent' ? 'inside Codex / Claude Code' : 'local popup window'}
Reminder interval: ${config.intervalMinutes} active minutes
Idle reset: ${config.idleResetMinutes} minutes
Reminder duration: ${config.reminderDurationSeconds} seconds
Order: ${config.order}
Quiet hours: ${config.quietHours.enabled ? `${config.quietHours.start}-${config.quietHours.end}` : 'off'}
Enabled reminders: ${reminders.map((item) => item.id).join(', ') || 'none'}
Companion: ${config.companion}

Ask your agent to change any of these settings, or run touch-grass config get for JSON.`);
}

function help() {
  print(`Touch Grass — local break reminders for agent sessions

Usage:
  touch-grass status [--json]
  touch-grass settings
  touch-grass test [reminder-id] [--dry-run]
  touch-grass config get
  touch-grass config set <interval|idle-reset|duration|delivery|order|companion|quiet-hours|enabled> <value>
  touch-grass reminders list
  touch-grass reminders enable|disable <id>
  touch-grass reminders add <id> --title "..." --message "..." [--icon "..."] [--gif /path/file.gif]
  touch-grass reminders remove <id>
  touch-grass companions list
  touch-grass companions add <id> --name "..." --dir /path/to/assets
  touch-grass companions use <id|rotate|none>
  touch-grass companions remove <id>
  touch-grass snooze [minutes]
  touch-grass reset-activity
  touch-grass doctor`);
}

async function main() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  const { positionals, flags } = parseArgs(rest);

  if (command === 'hook') {
    try {
      const result = await recordActivity(await readStdin());
      if (result.due) {
        if (result.config.delivery === 'popup') launchReminder(result.payload);
        else print({ systemMessage: formatAgentReminder(result.payload) });
      }
    } catch (error) {
      if (process.env.TOUCH_GRASS_DEBUG === '1') process.stderr.write(`touch-grass: ${error.message}\n`);
    }
    return;
  }
  if (command === 'settings') {
    await showSettings();
    return;
  }
  if (command === 'status') {
    const status = await statusSnapshot();
    if (flags.json) print(status);
    else print(status.enabled
      ? `Touch Grass is on. About ${status.remainingMinutes} active minute(s) until the next break.`
      : 'Touch Grass is off.');
    return;
  }
  if (command === 'test') {
    const payload = await previewReminder(positionals[0] ?? 'water');
    if (flags['dry-run']) {
      print({ payload, delivery: (await loadConfig()).delivery });
      return;
    }
    const config = await loadConfig();
    if (config.delivery === 'popup') {
      launchReminder(payload);
      print(`Opened the ${payload.id} reminder.`);
    } else print(formatAgentReminder(payload));
    return;
  }
  if (command === 'config' && positionals[0] === 'get') {
    print(await loadConfig());
    return;
  }
  if (command === 'config' && positionals[0] === 'set') {
    if (!positionals[1] || positionals[2] === undefined) throw new Error('config set requires a setting and value.');
    await setConfigValue(positionals[1], positionals[2]);
    return;
  }
  if (command === 'reminders' && positionals[0] === 'list') {
    const config = await loadConfig();
    print(await availableReminders(config));
    return;
  }
  if (command === 'reminders' && ['enable', 'disable'].includes(positionals[0])) {
    if (!positionals[1]) throw new Error(`reminders ${positionals[0]} requires an id.`);
    await setReminderEnabled(positionals[1], positionals[0] === 'enable');
    return;
  }
  if (command === 'reminders' && positionals[0] === 'add') {
    if (!positionals[1]) throw new Error('reminders add requires an id.');
    await addReminder(positionals[1], flags);
    return;
  }
  if (command === 'reminders' && positionals[0] === 'remove') {
    if (!positionals[1]) throw new Error('reminders remove requires an id.');
    await removeReminder(positionals[1]);
    return;
  }
  if (command === 'companions' && positionals[0] === 'list') {
    const config = await loadConfig();
    print({ selected: config.companion, companions: config.companions });
    return;
  }
  if (command === 'companions' && positionals[0] === 'add') {
    if (!positionals[1]) throw new Error('companions add requires an id.');
    await addCompanion(positionals[1], flags);
    return;
  }
  if (command === 'companions' && positionals[0] === 'remove') {
    if (!positionals[1]) throw new Error('companions remove requires an id.');
    await removeCompanion(positionals[1]);
    return;
  }
  if (command === 'companions' && positionals[0] === 'use') {
    if (!positionals[1]) throw new Error('companions use requires an id, rotate, or none.');
    await setConfigValue('companion', positionals[1]);
    return;
  }
  if (command === 'snooze') {
    const minutes = Math.min(240, Math.max(1, Number(positionals[0]) || 15));
    const state = await updateState((current) => ({
      ...current,
      snoozedUntil: new Date(Date.now() + minutes * 60_000).toISOString()
    }));
    print({ snoozedUntil: state.snoozedUntil });
    return;
  }
  if (command === 'reset-activity') {
    const state = await updateState((current) => ({ ...current, activeMs: 0, lastActivityAt: new Date().toISOString() }));
    print({ activeMinutes: state.activeMs / 60_000 });
    return;
  }
  if (command === 'reset') {
    const config = await updateConfig(() => defaultConfig());
    await updateState(() => ({}));
    print({ reset: true, config });
    return;
  }
  if (command === 'doctor') {
    await doctor();
    return;
  }
  help();
}

main().catch((error) => {
  process.stderr.write(`touch-grass: ${error.message}\n`);
  process.exitCode = 1;
});
