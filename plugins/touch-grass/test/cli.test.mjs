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
    assert.match(result.stdout, /Remind me to take a break every 40 minutes/);
    assert.match(result.stdout, /Everything stays on this computer/);
    assert.doesNotMatch(result.stdout, /idle reset|activeMs|delivery|intervalMinutes/i);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('settings changes receive natural acknowledgements', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  try {
    const interval = run(['config', 'set', 'interval', '40'], home);
    assert.equal(interval.status, 0);
    assert.match(interval.stdout, /nudge you to take a break about every 40 minutes/i);
    assert.doesNotMatch(interval.stdout, /setting|intervalMinutes/i);

    const snack = run(['reminders', 'disable', 'snack'], home);
    assert.equal(snack.status, 0);
    assert.match(snack.stdout, /won't remind you about snack breaks anymore/i);
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

test('cat packs require all six animated actions', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  const catDir = path.join(home, 'mochi');
  try {
    await mkdir(catDir);
    await writeFile(path.join(catDir, 'water.gif'), 'GIF89a');
    const result = run(['companions', 'add', 'mochi', '--name', 'Mochi', '--dir', catDir], home);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /stretch, snack, walk, eyes, nap/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
