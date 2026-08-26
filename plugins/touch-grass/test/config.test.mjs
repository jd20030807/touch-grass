import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultConfig, getDataDir, loadConfig, normalizeConfig, saveConfig } from '../src/config.mjs';

test('config defaults are local-first and include safe timing bounds', () => {
  const config = defaultConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.delivery, 'agent');
  assert.equal(config.intervalMinutes, 50);
  assert.equal(config.idleResetMinutes, 10);
  assert.equal(config.companion, 'rotate');
});

test('TOUCH_GRASS_HOME overrides the platform data directory', () => {
  assert.equal(getDataDir({ TOUCH_GRASS_HOME: './custom-data' }), path.resolve('./custom-data'));
});

test('config rejects invalid timing and unknown companions', () => {
  assert.throws(() => normalizeConfig({ intervalMinutes: 0 }), /between 1 and 480/);
  assert.throws(() => normalizeConfig({ delivery: 'cloud' }), /agent or popup/);
  assert.throws(() => normalizeConfig({ companion: 'missing' }), /Unknown companion/);
});

test('config persists valid custom reminders and companions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-config-'));
  const env = { TOUCH_GRASS_HOME: directory };
  try {
    const config = defaultConfig();
    config.customReminders.push({ id: 'breathe', title: 'Breathe', message: 'Take five slow breaths.', iconText: '◌' });
    config.companions.push({ id: 'juniper', name: 'Juniper', assets: { nap: path.join(directory, 'nap.gif') } });
    config.companion = 'juniper';
    await saveConfig(config, env);
    const loaded = await loadConfig(env);
    assert.equal(loaded.customReminders[0].id, 'breathe');
    assert.equal(loaded.companions[0].name, 'Juniper');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
