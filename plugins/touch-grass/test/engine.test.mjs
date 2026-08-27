import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publishAgentSession } from '../src/bridge.mjs';
import { defaultConfig, saveConfig } from '../src/config.mjs';
import { inferHost, previewReminder, recordActivity } from '../src/engine.mjs';

async function tempEnv() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-engine-'));
  return {
    directory,
    env: {
      TOUCH_GRASS_HOME: path.join(directory, 'data'),
      TOUCH_GRASS_BRIDGE_DIR: path.join(directory, 'bridge'),
      CODEX_THREAD_ID: 'local-test-thread'
    }
  };
}

function localTime(hours, minutes = 0) {
  return new Date(2026, 7, 26, hours, minutes, 0, 0).getTime();
}

async function writePresence(env, nowMs, options = {}) {
  await mkdir(env.TOUCH_GRASS_BRIDGE_DIR, { recursive: true, mode: 0o700 });
  const snapshot = {
    schemaVersion: 1,
    helperInstanceId: options.helperInstanceId ?? 'helper-a',
    stretchId: options.stretchId ?? 'stretch-a',
    stretchEngagedMs: options.stretchEngagedMs ?? 0,
    sampledAt: new Date(options.sampledAtMs ?? nowMs).toISOString(),
    engaged: options.engaged ?? true
  };
  await writeFile(
    path.join(env.TOUCH_GRASS_BRIDGE_DIR, 'presence.json'),
    `${JSON.stringify(snapshot)}\n`,
    { mode: 0o600 }
  );
}

const hook = { hook_event_name: 'UserPromptSubmit', session_id: 'private-session-id' };

test('host inference does not mistake Claude hook model metadata for Codex', () => {
  assert.equal(inferHost({ model: 'shared-model-field' }, { CLAUDECODE: '1' }), 'claude-code');
  assert.equal(inferHost({ model: 'shared-model-field' }, { CODEX_THREAD_ID: 'thread' }), 'codex');
  assert.equal(inferHost({ model: 'shared-model-field' }, {}), 'agent');
});

test('per-invocation host markers beat markers inherited from a parent shell', () => {
  assert.equal(
    inferHost({}, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CODEX_THREAD_ID: 'thread' }),
    'codex'
  );
  assert.equal(
    inferHost({}, { CODEX_THREAD_ID: 'thread', CLAUDE_PLUGIN_ROOT: '/plugins/touch-grass' }),
    'claude-code'
  );
});

test('hook frequency alone never advances reminder clocks', async () => {
  const { directory, env } = await tempEnv();
  try {
    const config = defaultConfig();
    config.disabledPresetIds = ['water', 'stretch', 'snack', 'walk', 'bedtime'];
    config.reminderSchedules.eyes.intervalMinutes = 1;
    await saveConfig(config, env);
    const base = localTime(12);

    await recordActivity(hook, { env, nowMs: base });
    const result = await recordActivity({ ...hook, hook_event_name: 'PostToolUse' }, { env, nowMs: base + 10 * 60_000 });
    assert.equal(result.due, false);
    assert.equal(result.reason, 'presence-unavailable');
    assert.equal(result.state.activeMsByReminder.eyes ?? 0, 0);
    assert.equal('lastHookAt' in result.state, false);
    assert.equal('lastEventName' in result.state, false);
    assert.equal('lastHost' in result.state, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('each active reminder consumes its own aggregate presence clock', async () => {
  const { directory, env } = await tempEnv();
  try {
    const config = defaultConfig();
    config.disabledPresetIds = ['stretch', 'snack', 'walk', 'bedtime'];
    await saveConfig(config, env);
    const base = localTime(12);

    await writePresence(env, base, { stretchEngagedMs: 0 });
    await recordActivity(hook, { env, nowMs: base });

    await writePresence(env, base + 20 * 60_000, { stretchEngagedMs: 20 * 60_000 });
    const eyeBreak = await recordActivity(hook, { env, nowMs: base + 20 * 60_000 });
    assert.equal(eyeBreak.due, true);
    assert.equal(eyeBreak.payload.id, 'eyes');
    assert.equal(eyeBreak.state.activeMsByReminder.eyes, 0);
    assert.equal(eyeBreak.state.activeMsByReminder.water, 20 * 60_000);

    await writePresence(env, base + 30 * 60_000, { stretchEngagedMs: 30 * 60_000 });
    const waterBreak = await recordActivity(hook, { env, nowMs: base + 30 * 60_000 });
    assert.equal(waterBreak.due, true);
    assert.equal(waterBreak.payload.id, 'water');
    assert.equal(waterBreak.state.activeMsByReminder.water, 0);
    assert.equal(waterBreak.state.activeMsByReminder.eyes, 10 * 60_000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a new presence stretch restarts every activity-based clock', async () => {
  const { directory, env } = await tempEnv();
  try {
    const config = defaultConfig();
    config.disabledPresetIds = ['water', 'stretch', 'snack', 'walk', 'bedtime'];
    await saveConfig(config, env);
    const base = localTime(12);

    await writePresence(env, base, { stretchEngagedMs: 0 });
    await recordActivity(hook, { env, nowMs: base });
    await writePresence(env, base + 15 * 60_000, { stretchEngagedMs: 15 * 60_000 });
    const beforeAway = await recordActivity(hook, { env, nowMs: base + 15 * 60_000 });
    assert.equal(beforeAway.state.activeMsByReminder.eyes, 15 * 60_000);

    await writePresence(env, base + 30 * 60_000, { stretchId: 'stretch-b', stretchEngagedMs: 5 * 60_000 });
    const afterAway = await recordActivity(hook, { env, nowMs: base + 30 * 60_000 });
    assert.equal(afterAway.due, false);
    assert.equal(afterAway.state.activeMsByReminder.eyes, 5 * 60_000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('stale presence is ignored instead of falling back to hook gaps', async () => {
  const { directory, env } = await tempEnv();
  try {
    const config = defaultConfig();
    config.disabledPresetIds = ['water', 'stretch', 'snack', 'walk', 'bedtime'];
    await saveConfig(config, env);
    const nowMs = localTime(12);
    await writePresence(env, nowMs, {
      stretchEngagedMs: 25 * 60_000,
      sampledAtMs: nowMs - 21_000
    });
    const result = await recordActivity(hook, { env, nowMs });
    assert.equal(result.due, false);
    assert.equal(result.reason, 'presence-unavailable');
    assert.equal(result.state.activeMsByReminder.eyes ?? 0, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('clock reminders wait until the user is present in the coding app', async () => {
  const { directory, env } = await tempEnv();
  try {
    const config = defaultConfig();
    config.disabledPresetIds = ['water', 'stretch', 'walk', 'eyes', 'bedtime'];
    await saveConfig(config, env);

    await writePresence(env, localTime(10, 30), { engaged: false });
    const absent = await recordActivity(hook, { env, nowMs: localTime(10, 30) });
    assert.equal(absent.due, false);
    assert.equal(absent.reason, 'not-active');

    await writePresence(env, localTime(10, 35), { engaged: true });
    const present = await recordActivity(hook, { env, nowMs: localTime(10, 35) });
    const repeated = await recordActivity(hook, { env, nowMs: localTime(10, 36) });
    assert.equal(present.due, true);
    assert.equal(present.payload.id, 'snack');
    assert.equal(repeated.due, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('bedtime is a two-stage wind-down and bedtime reminder while present', async () => {
  const { directory, env } = await tempEnv();
  try {
    const config = defaultConfig();
    config.disabledPresetIds = ['water', 'stretch', 'snack', 'walk', 'eyes'];
    config.reminderSchedules.bedtime.windDownMinutes = 30;
    await saveConfig(config, env);

    await writePresence(env, localTime(21, 30));
    const windDown = await recordActivity(hook, { env, nowMs: localTime(21, 30) });
    await writePresence(env, localTime(22));
    const bedtime = await recordActivity(hook, { env, nowMs: localTime(22) });
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

test('quiet hours suppress an otherwise due presence reminder', async () => {
  const { directory, env } = await tempEnv();
  try {
    const config = defaultConfig();
    config.disabledPresetIds = ['water', 'stretch', 'snack', 'walk', 'bedtime'];
    config.reminderSchedules.eyes.intervalMinutes = 5;
    config.quietHours = { enabled: true, start: '00:00', end: '00:00' };
    await saveConfig(config, env);
    const base = localTime(12);
    await writePresence(env, base, { stretchEngagedMs: 0 });
    await recordActivity(hook, { env, nowMs: base });
    await writePresence(env, base + 5 * 60_000, { stretchEngagedMs: 5 * 60_000 });
    const result = await recordActivity(hook, { env, nowMs: base + 5 * 60_000 });
    assert.equal(result.due, false);
    assert.equal(result.reason, 'quiet-hours');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('session leases discard content and remove the opaque lease on SessionEnd', async () => {
  const { directory, env } = await tempEnv();
  try {
    const rawInput = {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'raw-session-should-not-be-stored',
      prompt: 'secret prompt text',
      tool_input: { password: 'secret tool value' },
      transcript_path: '/private/transcript.jsonl'
    };
    await publishAgentSession(rawInput, { env, nowMs: localTime(12), host: 'codex', awayResetMinutes: 10 });
    const sessionsPath = path.join(env.TOUCH_GRASS_BRIDGE_DIR, 'sessions');
    const files = await readdir(sessionsPath);
    assert.equal(files.length, 1);
    assert.doesNotMatch(files[0], /raw-session/);
    const source = await readFile(path.join(sessionsPath, files[0]), 'utf8');
    const lease = JSON.parse(source);
    assert.deepEqual(Object.keys(lease).sort(), ['active', 'awayResetMinutes', 'host', 'schemaVersion', 'updatedAt']);
    assert.doesNotMatch(source, /secret|raw-session|transcript/i);

    await publishAgentSession(
      { ...rawInput, hook_event_name: 'SessionEnd' },
      { env, nowMs: localTime(13), host: 'codex' }
    );
    assert.deepEqual(await readdir(sessionsPath), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('bedtime and wind-down are previewable with the shared bedtime cat action', async () => {
  const { directory, env } = await tempEnv();
  try {
    const bedtime = await previewReminder('bedtime', { env, companionId: 'nian' });
    const windDown = await previewReminder('wind-down', { env, companionId: 'nian' });
    assert.equal(bedtime.id, 'bedtime');
    assert.equal(windDown.id, 'bedtime');
    assert.equal(windDown.eventId, 'bedtime-wind-down');
    assert.equal(windDown.title, 'Start winding down');
    assert.match(windDown.message, /Bedtime is in 20 minutes/);
    assert.match(bedtime.iconPath, /bedtime\.svg$/);
    assert.match(bedtime.assetPath, /companions\/nian\/bedtime\.gif$/);
    assert.match(windDown.assetPath, /companions\/nian\/bedtime\.gif$/);
    assert.equal(bedtime.companionName, 'Nian');
    assert.equal(bedtime.artPending, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rotate mode makes an independent random companion choice for every reminder', async () => {
  const { directory, env } = await tempEnv();
  try {
    const firstHalf = await previewReminder('water', { env, random: () => 0.2 });
    const secondHalf = await previewReminder('water', { env, random: () => 0.8 });
    const repeatedSecondHalf = await previewReminder('water', { env, random: () => 0.8 });
    assert.equal(firstHalf.companionId, 'nian');
    assert.equal(secondHalf.companionId, 'you');
    assert.equal(repeatedSecondHalf.companionId, 'you');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('preview rejects unknown reminder ids instead of falling back to water', async () => {
  const { directory, env } = await tempEnv();
  try {
    await assert.rejects(previewReminder('unknown-break', { env }), /not available/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
