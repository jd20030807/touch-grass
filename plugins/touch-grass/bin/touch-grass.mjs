#!/usr/bin/env node

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  CURRENT_ONBOARDING_VERSION,
  CURRENT_WELCOME_BANNER_VERSION,
  PLUGIN_ROOT,
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
import { readPresenceSnapshot } from '../src/bridge.mjs';
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
    bedtime: 'bedtime reminders'
  })[id] ?? id.replaceAll('-', ' ');
}

function canonicalReminderId(id) {
  return id === 'nap' ? 'bedtime' : id;
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input.trim() ? JSON.parse(input) : {};
}

async function setConfigValue(key, rawValue) {
  const aliases = {
    'idle-reset': 'idleResetMinutes',
    duration: 'reminderDurationSeconds'
  };
  const canonical = aliases[key] ?? key;
  const config = await updateConfig((current) => {
    if (canonical === 'enabled') current.enabled = boolValue(rawValue);
    else if (['idleResetMinutes', 'reminderDurationSeconds'].includes(canonical)) {
      current[canonical] = Number(rawValue);
    }
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
  if (canonical === 'reminderDurationSeconds') {
    print(`Okay — each reminder will hang around for ${config.reminderDurationSeconds} seconds.`);
  } else if (canonical === 'quiet-hours') {
    print(config.quietHours.enabled
      ? `Okay — I'll stay quiet between ${friendlyTime(config.quietHours.start)} and ${friendlyTime(config.quietHours.end)}.`
      : 'Okay — reminders can pop up at any time.');
  } else if (canonical === 'enabled') {
    print(config.enabled ? 'Touch Grass is back on.' : 'Okay — Touch Grass is paused for now.');
  } else if (canonical === 'companion') {
    print(config.companion === 'rotate'
      ? `Okay — I'll choose a companion at random for each reminder.`
      : `Okay — ${config.companion} will bring your reminders.`);
  } else print('Okay — I adjusted how Touch Grass notices an active coding stretch.');
}

async function setReminderInterval(rawId, rawMinutes) {
  const id = canonicalReminderId(rawId);
  const minutes = Number(rawMinutes);
  const config = await updateConfig((current) => {
    if (current.reminderSchedules[id]) {
      current.reminderSchedules[id] = { kind: 'active', intervalMinutes: minutes };
      return current;
    }
    const reminder = current.customReminders.find((item) => item.id === id);
    if (!reminder) throw new Error(`Unknown reminder: ${id}`);
    reminder.schedule = { kind: 'active', intervalMinutes: minutes };
    return current;
  });
  const schedule = config.reminderSchedules[id]
    ?? config.customReminders.find((item) => item.id === id)?.schedule;
  print(`Okay — I'll remind you about ${reminderPhrase(id)} every ${schedule.intervalMinutes} minutes while you're actively coding.`);
}

async function setReminderTimes(rawId, rawTimes) {
  const id = canonicalReminderId(rawId);
  const times = String(rawTimes).split(',').map((time) => time.trim()).filter(Boolean);
  const config = await updateConfig((current) => {
    if (id === 'bedtime') throw new Error('Use reminders bedtime HH:MM for the two-stage bedtime reminder.');
    if (current.reminderSchedules[id]) {
      current.reminderSchedules[id] = { kind: 'clock', times, graceMinutes: 60 };
      return current;
    }
    const reminder = current.customReminders.find((item) => item.id === id);
    if (!reminder) throw new Error(`Unknown reminder: ${id}`);
    reminder.schedule = { kind: 'clock', times, graceMinutes: 60 };
    return current;
  });
  const schedule = config.reminderSchedules[id]
    ?? config.customReminders.find((item) => item.id === id)?.schedule;
  print(`Okay — I'll bring ${reminderPhrase(id)} at ${schedule.times.map(friendlyTime).join(' and ')}.`);
}

async function setBedtime(time, rawWindDownMinutes = 20) {
  const config = await updateConfig((current) => {
    current.reminderSchedules.bedtime = {
      kind: 'bedtime',
      time,
      windDownMinutes: Number(rawWindDownMinutes),
      graceMinutes: current.reminderSchedules.bedtime?.graceMinutes ?? 120
    };
    return current;
  });
  const schedule = config.reminderSchedules.bedtime;
  const windDownAt = (() => {
    const [hours, minutes] = schedule.time.split(':').map(Number);
    const total = (hours * 60 + minutes - schedule.windDownMinutes + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  })();
  print(`Okay — I'll help you wind down at ${friendlyTime(windDownAt)} and remind you again at bedtime at ${friendlyTime(schedule.time)}.`);
}

async function setReminderEnabled(rawId, enabled) {
  const id = canonicalReminderId(rawId);
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

async function addReminder(rawId, flags) {
  const id = canonicalReminderId(rawId);
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
      schedule: flags.at
        ? { kind: 'clock', times: String(flags.at).split(',').map((time) => time.trim()), graceMinutes: 60 }
        : { kind: 'active', intervalMinutes: Number(flags.interval) || 60 },
      assetPath
    });
    return current;
  });
  const reminder = config.customReminders.find((item) => item.id === id);
  print(`Lovely — I'll add “${reminder.title}” to the reminder mix.`);
}

async function removeReminder(rawId) {
  const id = canonicalReminderId(rawId);
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
    const candidates = extensions.flatMap((ext) => [
      `${reminder.id}.${ext}`,
      ...(reminder.id === 'bedtime' ? [`nap.${ext}`] : [])
    ]);
    const filename = candidates.find((candidate) => files.has(candidate));
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
  return `## Meet Touch Grass

Touch Grass is a local break-reminder companion for Codex and Claude Code. It begins with:

- Water every 30 minutes of active coding
- Eye rest every 20 minutes
- Stretching every hour
- Walking every two hours
- Snacks at 10:30 AM and 3:30 PM
- Wind-down at 9:40 PM and bedtime at 10 PM

It only counts time while your coding app is in front and you’ve used your computer recently. Everything stays on your Mac—it never records your typing, clicks, code, prompts, or window titles.

You can personalize it simply by telling me things like:

- “Remind me to walk every 40 minutes.”
- “Move snack reminders to 11 AM and 4 PM.”
- “Keep quiet from 10 PM to 8 AM.”
- “Turn off bedtime reminders.”
- “Snooze reminders for 30 minutes.”
- “Use my dog Mochi from \`/absolute/path/to/mochi\`.”
- “Add a breathing reminder.”

Each reminder can have its own rhythm. Tell me your preferences in plain language, and I’ll configure them locally.`;
}

async function markOnboardingShown() {
  await updateState((current) => ({
    ...current,
    onboardingShown: true,
    onboardingVersion: CURRENT_ONBOARDING_VERSION
  }));
}

async function showSettings() {
  await markOnboardingShown();
  print(introductionCopy());
}

async function showWelcome() {
  const state = await loadState();
  if (state.onboardingVersion >= CURRENT_ONBOARDING_VERSION) return;
  await markOnboardingShown();
  print(introductionCopy());
}

function welcomeBannerPayload() {
  return {
    id: 'welcome',
    eventId: 'welcome',
    variant: 'welcome',
    title: 'Touch Grass is here',
    message: 'Your gentle break reminders are ready. We’ll pop in while you code.',
    iconText: '✓',
    assetPaths: [
      path.join(PLUGIN_ROOT, 'assets', 'welcome', 'nian.png'),
      path.join(PLUGIN_ROOT, 'assets', 'welcome', 'you.png')
    ],
    durationSeconds: 18
  };
}

async function showWelcomeBanner(flags = {}) {
  const state = await loadState();
  if (!flags.force && state.welcomeBannerVersion >= CURRENT_WELCOME_BANNER_VERSION) return;

  const payload = welcomeBannerPayload();
  if (flags['dry-run']) {
    print({ payload, launch: launchReminder(payload, { dryRun: true }) });
    return;
  }

  launchReminder(payload);
  if (!flags.force) {
    await updateState((current) => ({
      ...current,
      welcomeBannerVersion: CURRENT_WELCOME_BANNER_VERSION
    }));
  }
}

function help() {
  print(`Touch Grass — local break reminders for agent sessions

Usage:
  touch-grass welcome
  touch-grass welcome-banner [--force] [--dry-run]
  touch-grass status [--json]
  touch-grass settings
  touch-grass test [reminder-id] [--companion <id>] [--dry-run]
  touch-grass config get
  touch-grass config set <duration|companion|quiet-hours|enabled> <value>
  touch-grass reminders list
  touch-grass reminders enable|disable <id>
  touch-grass reminders interval <id> <minutes>
  touch-grass reminders times <id> <HH:MM[,HH:MM]>
  touch-grass reminders bedtime <HH:MM> [--wind-down <minutes>]
  touch-grass reminders add <id> --title "..." --message "..." --gif /path/file.gif [--interval <minutes>|--at <HH:MM,...>]
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
  if (command === 'welcome-banner') {
    await showWelcomeBanner(flags);
    return;
  }
  if (command === 'status') {
    const status = await statusSnapshot();
    if (flags.json) print(status);
    else print(status.enabled
      ? status.currentlyEngaged
        ? 'Touch Grass is on and counting this coding stretch. I’ll pop in when it’s time for a break.'
        : 'Touch Grass is on. Break timers will count while your coding app is in front and your computer is in use.'
      : 'Touch Grass is off.');
    return;
  }
  if (command === 'test') {
    const payload = await previewReminder(positionals[0] ?? 'water', {
      companionId: typeof flags.companion === 'string' ? flags.companion : undefined
    });
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
  if (command === 'reminders' && positionals[0] === 'interval') {
    if (!positionals[1] || positionals[2] === undefined) throw new Error('reminders interval requires an id and minutes.');
    await setReminderInterval(positionals[1], positionals[2]);
    return;
  }
  if (command === 'reminders' && positionals[0] === 'times') {
    if (!positionals[1] || !positionals[2]) throw new Error('reminders times requires an id and one or more comma-separated times.');
    await setReminderTimes(positionals[1], positionals[2]);
    return;
  }
  if (command === 'reminders' && positionals[0] === 'bedtime') {
    if (!positionals[1]) throw new Error('reminders bedtime requires HH:MM.');
    await setBedtime(positionals[1], flags['wind-down'] ?? 20);
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
    const presence = await readPresenceSnapshot();
    const state = await updateState((current) => ({
      ...current,
      activeMsByReminder: {},
      presenceCursor: presence ? {
        helperInstanceId: presence.helperInstanceId,
        stretchId: presence.stretchId,
        stretchEngagedMs: presence.stretchEngagedMs
      } : null
    }));
    print({ activeMinutesByReminder: state.activeMsByReminder });
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
