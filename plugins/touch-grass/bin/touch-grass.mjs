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
import { availableCompanions, availableReminders, previewReminder, recordActivity, statusSnapshot } from '../src/engine.mjs';
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

function friendlyTime(value) {
  const [hours, minutes] = value.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''} ${suffix}`;
}

function reminderPhrase(id) {
  return ({
    water: 'water breaks',
    stretch: 'stretch breaks',
    snack: 'snack breaks',
    walk: 'short walks',
    eyes: 'screen breaks',
    nap: 'nap breaks'
  })[id] ?? id.replaceAll('-', ' ');
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
  if (canonical === 'intervalMinutes') {
    print(`Okay — I'll nudge you to take a break about every ${config.intervalMinutes} minutes while you're coding.`);
  } else if (canonical === 'reminderDurationSeconds') {
    print(`Okay — each reminder will hang around for ${config.reminderDurationSeconds} seconds.`);
  } else if (canonical === 'quiet-hours') {
    print(config.quietHours.enabled
      ? `Okay — I'll stay quiet between ${friendlyTime(config.quietHours.start)} and ${friendlyTime(config.quietHours.end)}.`
      : 'Okay — reminders can pop up at any time.');
  } else if (canonical === 'enabled') {
    print(config.enabled ? 'Touch Grass is back on.' : 'Okay — Touch Grass is paused for now.');
  } else if (canonical === 'companion') {
    print(config.companion === 'rotate'
      ? `Okay — I'll rotate through your cats.`
      : `Okay — ${config.companion} will bring your reminders.`);
  } else if (canonical === 'order') {
    print(config.order === 'shuffle' ? `Okay — I'll keep the reminders varied.` : `Okay — I'll take the reminders in a steady rotation.`);
  } else print('Okay — I adjusted how Touch Grass notices an active coding stretch.');
}

async function setReminderEnabled(id, enabled) {
  const presets = await loadPresets();
  const presetIds = new Set(presets.reminders.map((item) => item.id));
  await updateConfig((current) => {
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
  print(enabled
    ? `Okay — I'll remind you about ${reminderPhrase(id)} again.`
    : `Okay — I won't remind you about ${reminderPhrase(id)} anymore.`);
}

async function addReminder(id, flags) {
  if (!flags.title || !flags.message || !flags.gif) {
    throw new Error('A custom reminder needs --title, --message, and a matching animated --gif.');
  }
  const assetPath = path.resolve(flags.gif);
  if (!/\.(?:gif|webp)$/i.test(assetPath) || !(await pathExists(assetPath))) {
    throw new Error('The custom reminder animation must be an existing GIF or animated WebP file.');
  }
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
      assetPath
    });
    return current;
  });
  const reminder = config.customReminders.find((item) => item.id === id);
  print(`Lovely — I'll add “${reminder.title}” to the reminder mix.`);
}

async function removeReminder(id) {
  await updateConfig((current) => {
    const before = current.customReminders.length;
    current.customReminders = current.customReminders.filter((item) => item.id !== id);
    if (current.customReminders.length === before) throw new Error(`Custom reminder ${id} was not found.`);
    return current;
  });
  print(`Okay — I won't use the ${reminderPhrase(id)} reminder anymore.`);
}

async function addCompanion(id, flags) {
  if (!flags.dir) throw new Error('companions add requires --dir /path/to/assets.');
  const directory = path.resolve(flags.dir);
  if (!(await pathExists(directory))) throw new Error(`Directory does not exist: ${directory}`);
  const files = new Set(await readdir(directory));
  const presets = await loadPresets();
  const extensions = ['gif', 'webp'];
  const assets = {};
  for (const reminder of presets.reminders) {
    const filename = extensions.map((ext) => `${reminder.id}.${ext}`).find((candidate) => files.has(candidate));
    if (filename) assets[reminder.id] = path.join(directory, filename);
  }
  const missing = presets.reminders.map((item) => item.id).filter((action) => !assets[action]);
  if (missing.length > 0) {
    throw new Error(`This cat pack still needs animated files for: ${missing.join(', ')}.`);
  }
  const config = await updateConfig((current) => {
    if (current.companions.some((item) => item.id === id)) throw new Error(`Companion ${id} already exists.`);
    current.companions.push({ id, name: flags.name ?? id, assets });
    return current;
  });
  const companion = config.companions.find((item) => item.id === id);
  print(`Perfect — ${companion.name} is ready to bring your reminders.`);
}

async function removeCompanion(id) {
  let removedName = id;
  await updateConfig((current) => {
    const before = current.companions.length;
    removedName = current.companions.find((item) => item.id === id)?.name ?? id;
    current.companions = current.companions.filter((item) => item.id !== id);
    if (current.companions.length === before) throw new Error(`Companion ${id} was not found.`);
    if (current.companion === id) current.companion = 'rotate';
    return current;
  });
  print(`Okay — I removed ${removedName} from the cat rotation.`);
}

async function doctor() {
  const config = await loadConfig();
  const state = await loadState();
  const paths = getDataPaths();
  const reminders = await availableReminders(config);
  const presets = await loadPresets();
  const requiredActions = presets.reminders.map((item) => item.id);
  const missingAssets = [];
  const companions = await availableCompanions(config);
  for (const companion of companions) {
    for (const action of requiredActions) {
      const assetPath = companion.assets[action];
      if (!assetPath || !(await pathExists(assetPath))) {
        missingAssets.push({ companion: companion.id, action, assetPath: assetPath ?? null });
      }
    }
  }
  const bundledCompanions = companions.filter((item) => item.bundled);
  const bundledCatPacksReady = bundledCompanions.length >= 2
    && !missingAssets.some((item) => bundledCompanions.some((companion) => companion.id === item.companion));
  const sample = reminders[0] ? await previewReminder(reminders[0].id) : null;
  const launch = sample ? resolveReminderCommand('file:///touch-grass-preview') : null;
  const popupReady = launch?.mode === 'app-window' || (launch?.mode === 'native-helper' && launch.ready);
  print({
    ok: reminders.length > 0 && bundledCatPacksReady && popupReady,
    node: process.version,
    platform: process.platform,
    dataDir: paths.dir,
    enabledReminders: reminders.map((item) => item.id),
    companion: config.companion,
    bundledCatPacksReady,
    popupReady,
    missingAssets,
    reminderWindow: launch,
    state
  });
}

function introductionCopy() {
  return `Touch Grass starts with six built-in break reminders:

- Drink water
- Stand up and stretch
- Get a snack
- Take a short walk around the room
- Rest your eyes away from the screen
- Take a nap or short rest

By default, Touch Grass checks in about every 50 minutes while you’re actively using your coding agent. Quiet hours are off, so reminders can appear at any time until you ask for a quiet period. Each local popup banner stays visible for 18 seconds unless you dismiss it sooner. The suggestions vary instead of following a fixed order.

You can customize Touch Grass by saying things like:

- “Remind me to take a break every 40 minutes.”
- “Don’t remind me about snacks anymore.”
- “Keep nap reminders, but turn walks off.”
- “Don’t interrupt me between 10 PM and 8 AM.”
- “Snooze reminders for half an hour.”
- “Use my cat Mochi for icon from \`/absolute/path/to/mochi\`.”

Everything stays on your computer.`;
}

async function markOnboardingShown() {
  await updateState((current) => ({ ...current, onboardingShown: true }));
}

async function showSettings() {
  await markOnboardingShown();
  print(introductionCopy());
}

async function showWelcome() {
  const state = await loadState();
  if (state.onboardingShown) return;
  await markOnboardingShown();
  print(introductionCopy());
}

function help() {
  print(`Touch Grass — local break reminders for agent sessions

Usage:
  touch-grass welcome
  touch-grass status [--json]
  touch-grass settings
  touch-grass test [reminder-id] [--dry-run]
  touch-grass config get
  touch-grass config set <interval|duration|order|companion|quiet-hours|enabled> <value>
  touch-grass reminders list
  touch-grass reminders enable|disable <id>
  touch-grass reminders add <id> --title "..." --message "..." --gif /path/file.gif [--icon "..."]
  touch-grass reminders remove <id>
  touch-grass companions list
  touch-grass companions add <id> --name "..." --dir /path/to/assets
  touch-grass companions use <id|rotate>
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
      if (result.due) launchReminder(result.payload);
    } catch (error) {
      if (process.env.TOUCH_GRASS_DEBUG === '1') process.stderr.write(`touch-grass: ${error.message}\n`);
    }
    return;
  }
  if (command === 'settings') {
    await showSettings();
    return;
  }
  if (command === 'welcome') {
    await showWelcome();
    return;
  }
  if (command === 'status') {
    const status = await statusSnapshot();
    if (flags.json) print(status);
    else print(status.enabled
      ? 'Touch Grass is on and watching this coding stretch. I’ll pop in when it’s time for a break.'
      : 'Touch Grass is off.');
    return;
  }
  if (command === 'test') {
    const payload = await previewReminder(positionals[0] ?? 'water');
    if (flags['dry-run']) {
      print({ payload, launch: launchReminder(payload, { dryRun: true }) });
      return;
    }
    launchReminder(payload);
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
    if (!positionals[1]) throw new Error('companions use requires a cat id or rotate.');
    await setConfigValue('companion', positionals[1]);
    return;
  }
  if (command === 'snooze') {
    const minutes = Math.min(240, Math.max(1, Number(positionals[0]) || 15));
    await updateState((current) => ({
      ...current,
      snoozedUntil: new Date(Date.now() + minutes * 60_000).toISOString()
    }));
    print(`Okay — I'll stay quiet for ${minutes} minutes.`);
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
