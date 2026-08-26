import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(pluginRoot, 'bin', 'touch-grass.mjs');

function run(args, home) {
  return spawnSync(process.execPath, [cli, ...args], {
    env: { ...process.env, TOUCH_GRASS_HOME: home },
    encoding: 'utf8'
  });
}

test('settings teaches conversational phrases without exposing internal fields', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  try {
    const result = run(['settings'], home);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /local break-reminder companion for Codex and Claude Code/);
    assert.match(result.stdout, /six built-in reminder groups/);
    assert.match(result.stdout, /Rest your eyes — every 20 minutes/);
    assert.match(result.stdout, /Drink water — every 30 minutes/);
    assert.match(result.stdout, /Get a snack — at 10:30 AM and 3:30 PM/);
    assert.match(result.stdout, /Bedtime — wind down at 9:40 PM/);
    assert.match(result.stdout, /starts with no quiet hours/);
    assert.match(result.stdout, /Remind me to walk around every 40 minutes/);
    assert.match(result.stdout, /Use my cat Mochi from/);
    assert.match(result.stdout, /Add a breathing reminder with this GIF/);
    assert.match(result.stdout, /Everything stays on your computer/);
    assert.doesNotMatch(result.stdout, /Show me a water reminder/);
    assert.doesNotMatch(result.stdout, /every 50 minutes|18 seconds|shuffle|random|idle reset|activeMs|delivery|intervalMinutes/i);
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
    assert.match(first.stdout, /six built-in reminder groups/);
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
