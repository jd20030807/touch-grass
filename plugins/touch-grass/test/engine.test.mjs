import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultConfig, saveConfig } from '../src/config.mjs';
import { previewReminder, recordActivity } from '../src/engine.mjs';

async function tempEnv() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-engine-'));
  return { directory, env: { TOUCH_GRASS_HOME: directory } };
}

function localTime(hours, minutes = 0) {
  return new Date(2026, 7, 26, hours, minutes, 0, 0).getTime();
}

test('each active reminder keeps its own clock', async () => {
  const { directory, env } = await tempEnv();
  try {
    const config = defaultConfig();
    config.disabledPresetIds = ['stretch', 'snack', 'walk', 'bedtime'];
    await saveConfig(config, env);
    const base = localTime(12);

    let eyeBreak;
    for (let minutes = 0; minutes <= 20; minutes += 5) {
      eyeBreak = await recordActivity({}, { env, nowMs: base + minutes * 60_000 });
    }
    assert.equal(eyeBreak.due, true);
    assert.equal(eyeBreak.payload.id, 'eyes');
    assert.equal(eyeBreak.state.activeMsByReminder.eyes, 0);
    assert.equal(eyeBreak.state.activeMsByReminder.water, 20 * 60_000);

    const waterBreak = await recordActivity({}, { env, nowMs: base + 30 * 60_000 });
    assert.equal(waterBreak.due, true);
    assert.equal(waterBreak.payload.id, 'water');
    assert.equal(waterBreak.state.activeMsByReminder.water, 0);
    assert.equal(waterBreak.state.activeMsByReminder.eyes, 10 * 60_000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a gap longer than the private inactivity threshold restarts every active clock', async () => {
  const { directory, env } = await tempEnv();
  try {
    const config = defaultConfig();
    config.disabledPresetIds = ['snack', 'bedtime'];
    await saveConfig(config, env);
    const base = localTime(12);
    await recordActivity({}, { env, nowMs: base });
    await recordActivity({}, { env, nowMs: base + 5 * 60_000 });
    const result = await recordActivity({}, { env, nowMs: base + 21 * 60_000 });
    assert.equal(result.due, false);
    assert.equal(result.state.activeMsByReminder.eyes, 0);
    assert.equal(result.state.activeMsByReminder.water, 0);
    assert.equal(result.state.activeMsByReminder.walk, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('snack reminders use their own local clock occurrences and fire once', async () => {
  const { directory, env } = await tempEnv();
  try {
    const config = defaultConfig();
    config.disabledPresetIds = ['water', 'stretch', 'walk', 'eyes', 'bedtime'];
    await saveConfig(config, env);

    const first = await recordActivity({}, { env, nowMs: localTime(10, 30) });
    const second = await recordActivity({}, { env, nowMs: localTime(10, 35) });
    assert.equal(first.due, true);
    assert.equal(first.payload.id, 'snack');
    assert.equal(second.due, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('bedtime is a two-stage wind-down and bedtime reminder', async () => {
  const { directory, env } = await tempEnv();
  try {
    const config = defaultConfig();
    config.disabledPresetIds = ['water', 'stretch', 'snack', 'walk', 'eyes'];
    config.reminderSchedules.bedtime.windDownMinutes = 30;
    await saveConfig(config, env);

    const windDown = await recordActivity({}, { env, nowMs: localTime(21, 30) });
    const bedtime = await recordActivity({}, { env, nowMs: localTime(22) });
    assert.equal(windDown.due, true);
    assert.equal(windDown.payload.id, 'bedtime');
    assert.equal(windDown.payload.eventId, 'bedtime-wind-down');
    assert.match(windDown.payload.title, /wind/i);
    assert.match(windDown.payload.message, /30 minutes/i);
    assert.equal(bedtime.due, true);
    assert.equal(bedtime.payload.eventId, 'bedtime');
    assert.match(bedtime.payload.title, /bedtime/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('quiet hours suppress an otherwise due reminder', async () => {
  const { directory, env } = await tempEnv();
  try {
    const config = defaultConfig();
    config.disabledPresetIds = ['water', 'stretch', 'snack', 'walk', 'bedtime'];
    config.reminderSchedules.eyes.intervalMinutes = 5;
    config.quietHours = { enabled: true, start: '00:00', end: '00:00' };
    await saveConfig(config, env);
    const base = localTime(12);
    await recordActivity({}, { env, nowMs: base });
    const result = await recordActivity({}, { env, nowMs: base + 5 * 60_000 });
    assert.equal(result.due, false);
    assert.equal(result.reason, 'quiet-hours');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('bedtime and wind-down are previewable with the shared bedtime cat action', async () => {
  const { directory, env } = await tempEnv();
  try {
    const bedtime = await previewReminder('bedtime', { env });
    const windDown = await previewReminder('bedtime-wind-down', { env });
    assert.equal(bedtime.id, 'bedtime');
    assert.equal(windDown.id, 'bedtime');
    assert.equal(windDown.eventId, 'bedtime-wind-down');
    assert.match(bedtime.iconPath, /bedtime\.svg$/);
    assert.equal(bedtime.assetPath, null);
    assert.equal(bedtime.artPending, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
