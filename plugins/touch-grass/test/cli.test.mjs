import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(pluginRoot, 'bin', 'touch-grass.mjs');

function run(args, home, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    env: { ...process.env, TOUCH_GRASS_HOME: home, ...env },
    encoding: 'utf8'
  });
}

test('settings teaches conversational phrases without exposing internal fields', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  try {
    const result = run(['settings'], home);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /## Meet Touch Grass/);
    assert.match(result.stdout, /local break-reminder companion for Codex and Claude Code/);
    assert.match(result.stdout, /Eye rest every 20 minutes/);
    assert.match(result.stdout, /Water every 30 minutes of active coding/);
    assert.match(result.stdout, /Snacks at 10:30 AM and 3:30 PM/);
    assert.match(result.stdout, /Wind-down at 9:40 PM and bedtime at 10 PM/);
    assert.match(result.stdout, /coding app is in front and you’ve used your computer recently/);
    assert.match(result.stdout, /Everything stays on your Mac/);
    assert.match(result.stdout, /never records your typing, clicks, code, prompts, or window titles/);
    assert.match(result.stdout, /Move snack reminders to 11 AM and 4 PM/);
    assert.match(result.stdout, /Use my dog Mochi from/);
    assert.match(result.stdout, /Add a breathing reminder/);
    assert.match(result.stdout, /Each reminder can have its own rhythm/);
    assert.doesNotMatch(result.stdout, /Show me a water reminder/);
    assert.doesNotMatch(result.stdout, /Nian|cat-GIF|compact local popup banners|bundled cats|rotate by default/);
    assert.doesNotMatch(result.stdout, /every 50 minutes|18 seconds|shuffle|random|idle reset|activeMs|delivery|intervalMinutes/i);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('welcome banner opens once with both approved static companions', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  const bridge = path.join(home, 'bridge');
  const env = { TOUCH_GRASS_NATIVE_HELPER: '1', TOUCH_GRASS_BRIDGE_DIR: bridge };
  try {
    await mkdir(bridge);
    await writeFile(path.join(bridge, 'helper.json'), '{}');

    const first = run(['welcome-banner'], home, env);
    assert.equal(first.status, 0);
    assert.equal(first.stdout, '');

    const requestPath = path.join(bridge, 'reminder.json');
    const request = JSON.parse(await readFile(requestPath, 'utf8'));
    const encoded = new URL(request.url).searchParams.get('data');
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    assert.equal(payload.variant, 'welcome');
    assert.equal(payload.title, 'Touch Grass is here');
    assert.match(payload.message, /break reminders are ready/i);
    assert.deepEqual(payload.assetUrls.map((url) => path.basename(new URL(url).pathname)), ['nian.png', 'you.png']);

    const state = JSON.parse(await readFile(path.join(home, 'state.json'), 'utf8'));
    assert.equal(state.welcomeBannerVersion, 1);

    await unlink(requestPath);
    const second = run(['welcome-banner'], home, env);
    assert.equal(second.status, 0);
    await assert.rejects(readFile(requestPath), { code: 'ENOENT' });

    const preview = run(['welcome-banner', '--force', '--dry-run'], home, env);
    assert.equal(preview.status, 0);
    assert.equal(JSON.parse(preview.stdout).payload.variant, 'welcome');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('welcome explains Touch Grass once per local installation', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  try {
    const first = run(['welcome'], home);
    const second = run(['welcome'], home);
    assert.equal(first.status, 0);
    assert.match(first.stdout, /## Meet Touch Grass/);
    assert.equal(second.status, 0);
    assert.equal(second.stdout, '');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('settings changes receive natural acknowledgements', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  try {
    const interval = run(['reminders', 'interval', 'walk', '40'], home);
    assert.equal(interval.status, 0);
    assert.match(interval.stdout, /short walks every 40 minutes while you're actively coding/i);
    assert.doesNotMatch(interval.stdout, /setting|intervalMinutes/i);

    const snack = run(['reminders', 'disable', 'snack'], home);
    assert.equal(snack.status, 0);
    assert.match(snack.stdout, /won't remind you about snack breaks anymore/i);

    const bedtime = run(['reminders', 'bedtime', '23:30', '--wind-down', '30'], home);
    assert.equal(bedtime.status, 0);
    assert.match(bedtime.stdout, /wind down at 11 PM/i);
    assert.match(bedtime.stdout, /bedtime at 11:30 PM/i);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('custom reminders require a matching animation', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  try {
    const result = run(['reminders', 'add', 'breathe', '--title', 'Breathe', '--message', 'Take five slow breaths.'], home);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /matching animated --gif/i);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('wind-down previews use the bedtime asset and a temporary companion override', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  try {
    const result = run(['test', 'wind-down', '--companion', 'nian', '--dry-run'], home);
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.payload.id, 'bedtime');
    assert.equal(output.payload.eventId, 'bedtime-wind-down');
    assert.equal(output.payload.companionId, 'nian');
    assert.equal(output.payload.title, 'Start winding down');
    assert.match(output.payload.message, /Bedtime is in 20 minutes/);
    assert.match(output.payload.assetPath, /companions\/nian\/bedtime\.gif$/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('cat packs require all six animated actions including bedtime', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  const catDir = path.join(home, 'mochi');
  try {
    await mkdir(catDir);
    await writeFile(path.join(catDir, 'water.gif'), 'GIF89a');
    const result = run(['companions', 'add', 'mochi', '--name', 'Mochi', '--dir', catDir], home);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /stretch, snack, walk, eyes, bedtime/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
