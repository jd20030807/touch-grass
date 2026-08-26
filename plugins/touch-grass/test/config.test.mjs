import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultConfig, getDataDir, loadConfig, normalizeConfig, saveConfig } from '../src/config.mjs';

test('config defaults are local-first and include safe timing bounds', () => {
  const config = defaultConfig();
  assert.equal(config.enabled, true);
  assert.equal('delivery' in config, false);
  assert.deepEqual(config.reminderSchedules.eyes, { kind: 'active', intervalMinutes: 20 });
  assert.deepEqual(config.reminderSchedules.water, { kind: 'active', intervalMinutes: 30 });
  assert.deepEqual(config.reminderSchedules.stretch, { kind: 'active', intervalMinutes: 60 });
  assert.deepEqual(config.reminderSchedules.walk, { kind: 'active', intervalMinutes: 120 });
  assert.deepEqual(config.reminderSchedules.snack.times, ['10:30', '15:30']);
  assert.equal(config.reminderSchedules.bedtime.time, '22:00');
  assert.equal(config.reminderSchedules.bedtime.windDownMinutes, 20);
  assert.equal(config.idleResetMinutes, 10);
  assert.equal(config.companion, 'rotate');
  assert.equal(config.quietHours.enabled, false);
});

test('TOUCH_GRASS_HOME overrides the platform data directory', () => {
  assert.equal(getDataDir({ TOUCH_GRASS_HOME: './custom-data' }), path.resolve('./custom-data'));
});

test('config rejects invalid timing and accepts a future bundled companion id', () => {
  assert.throws(
    () => normalizeConfig({ reminderSchedules: { ...defaultConfig().reminderSchedules, eyes: { kind: 'active', intervalMinutes: 0 } } }),
    /between 1 and 480/
  );
  assert.equal(normalizeConfig({ companion: 'mochi' }).companion, 'mochi');
  assert.equal(normalizeConfig({ companion: 'none' }).companion, 'rotate');
});

test('legacy global timing and nap assets migrate without breaking local preferences', () => {
  const config = normalizeConfig({
    intervalMinutes: 45,
    disabledPresetIds: ['nap'],
    companions: [{ id: 'mochi', name: 'Mochi', assets: { nap: '/tmp/mochi-nap.gif' } }]
  });
  assert.equal(config.reminderSchedules.eyes.intervalMinutes, 45);
  assert.equal(config.reminderSchedules.walk.intervalMinutes, 45);
  assert.deepEqual(config.disabledPresetIds, ['bedtime']);
  assert.equal(config.companions[0].assets.bedtime, '/tmp/mochi-nap.gif');
});

test('config persists valid custom reminders and companions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-config-'));
  const env = { TOUCH_GRASS_HOME: directory };
  try {
    const config = defaultConfig();
    config.customReminders.push({
      id: 'breathe',
      title: 'Breathe',
      message: 'Take five slow breaths.',
      iconText: '◌',
      schedule: { kind: 'active', intervalMinutes: 45 }
    });
    config.companions.push({ id: 'juniper', name: 'Juniper', assets: { bedtime: path.join(directory, 'bedtime.gif') } });
    config.companion = 'juniper';
    await saveConfig(config, env);
    const loaded = await loadConfig(env);
    assert.equal(loaded.customReminders[0].id, 'breathe');
    assert.equal(loaded.customReminders[0].schedule.intervalMinutes, 45);
    assert.equal(loaded.companions[0].name, 'Juniper');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
