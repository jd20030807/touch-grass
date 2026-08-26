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

test('sustained recent activity triggers at the configured threshold', async () => {
  const { directory, env } = await tempEnv();
  try {
    const config = defaultConfig();
    config.intervalMinutes = 20;
    config.order = 'cycle';
    await saveConfig(config, env);
    const base = Date.parse('2026-08-26T12:00:00Z');
    let result;
    for (let step = 0; step <= 4; step += 1) {
      result = await recordActivity({ hook_event_name: 'PostToolUse' }, { env, nowMs: base + step * 5 * 60_000, random: () => 0 });
    }
    assert.equal(result.due, true);
    assert.equal(result.payload.id, 'water');
    assert.equal(result.state.activeMs, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a gap longer than idle reset starts active time fresh', async () => {
  const { directory, env } = await tempEnv();
  try {
    const config = defaultConfig();
    config.intervalMinutes = 20;
    config.idleResetMinutes = 10;
    await saveConfig(config, env);
    const base = Date.parse('2026-08-26T12:00:00Z');
    await recordActivity({}, { env, nowMs: base });
    await recordActivity({}, { env, nowMs: base + 5 * 60_000 });
    const result = await recordActivity({}, { env, nowMs: base + 21 * 60_000 });
    assert.equal(result.due, false);
    assert.equal(result.state.activeMs, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('quiet hours suppress an otherwise due reminder', async () => {
  const { directory, env } = await tempEnv();
  try {
    const config = defaultConfig();
    config.intervalMinutes = 5;
    config.idleResetMinutes = 10;
    config.quietHours = { enabled: true, start: '00:00', end: '00:00' };
    await saveConfig(config, env);
    const base = Date.parse('2026-08-26T12:00:00Z');
    await recordActivity({}, { env, nowMs: base });
    const result = await recordActivity({}, { env, nowMs: base + 5 * 60_000 });
    assert.equal(result.due, false);
    assert.equal(result.reason, 'quiet-hours');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('nap is a first-class previewable preset', async () => {
  const { directory, env } = await tempEnv();
  try {
    const payload = await previewReminder('nap', { env });
    assert.equal(payload.id, 'nap');
    assert.match(payload.title, /nap/i);
    assert.match(payload.iconPath, /nap\.svg$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
