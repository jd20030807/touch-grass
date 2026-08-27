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
    assert.deepEqual(payload.assetUrls.map((url) => path.basename(new URL(url).pathname)), ['nian.png', 'yuzu.png']);

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

test('a custom reminder without its own animation falls back to both companions', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  try {
    const added = run(['reminders', 'add', 'breathe', '--title', 'Breathe', '--message', 'Take five slow breaths.', '--interval', '45'], home);
    assert.equal(added.status, 0, added.stderr);

    const preview = run(['test', 'breathe', '--dry-run'], home);
    assert.equal(preview.status, 0, preview.stderr);
    const payload = JSON.parse(preview.stdout).payload;
    assert.equal(payload.assetPath, null);
    assert.equal(payload.artPending, false);
    assert.deepEqual(
      payload.assetPaths.map((item) => path.basename(item)),
      ['nian.png', 'yuzu.png']
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('a custom reminder still rejects an animation path that does not exist', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  try {
    const result = run(['reminders', 'add', 'breathe', '--title', 'Breathe', '--message', 'Take five slow breaths.', '--gif', path.join(home, 'missing.gif')], home);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /existing GIF or animated WebP/i);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('moving bedtime keeps a wind-down the user already customized', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  try {
    const custom = run(['reminders', 'bedtime', '23:00', '--wind-down', '45'], home);
    assert.equal(custom.status, 0, custom.stderr);
    assert.match(custom.stdout, /10:15 PM/);

    const moved = run(['reminders', 'bedtime', '23:30'], home);
    assert.equal(moved.status, 0, moved.stderr);
    assert.match(moved.stdout, /10:45 PM/, 'the 45-minute wind-down should survive a bedtime change');

    const replaced = run(['reminders', 'bedtime', '23:30', '--wind-down', '20'], home);
    assert.equal(replaced.status, 0, replaced.stderr);
    assert.match(replaced.stdout, /11:10 PM/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('spoken output never prints the absolute home directory', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  const catDir = path.join(os.tmpdir(), `touch-grass-outside-${process.pid}`);
  try {
    await mkdir(catDir, { recursive: true });
    for (const action of ['water', 'stretch', 'snack', 'walk', 'eyes', 'bedtime']) {
      await writeFile(path.join(catDir, `${action}.gif`), 'GIF89a');
    }
    const added = run(['companions', 'add', 'mochi', '--name', 'Mochi', '--dir', catDir], home);
    assert.equal(added.status, 0, added.stderr);
    assert.match(added.stdout, /outside your home folder/i, 'the warning should still appear');
    assert.doesNotMatch(
      added.stdout,
      new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'conversational output must not name the home directory'
    );
  } finally {
    await rm(catDir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test('a hidden bundled cat can be brought back by name', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  try {
    const hidden = run(['companions', 'remove', 'nian'], home);
    assert.equal(hidden.status, 0, hidden.stderr);
    assert.match(hidden.stdout, /removed Nian/, 'the cat should be named, not identified by id');

    const back = run(['companions', 'use', 'nian'], home);
    assert.equal(back.status, 0, back.stderr);
    assert.match(back.stdout, /Nian will bring your reminders/, 'the cat is named, not identified by id');
    const listed = JSON.parse(run(['companions', 'list'], home).stdout);
    assert.equal(listed.selected, 'nian');

    // the other door: companions add with a bundled id and no --dir
    assert.equal(run(['companions', 'remove', 'nian'], home).status, 0);
    const readded = run(['companions', 'add', 'nian'], home);
    assert.equal(readded.status, 0, readded.stderr);
    assert.match(readded.stdout, /Nian is back/i);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('a helper too old to report its version is flagged, not passed as healthy', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  const bridge = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-bridge-'));
  try {
    await writeFile(
      path.join(bridge, 'helper.json'),
      JSON.stringify({ pid: 1, updatedAt: new Date().toISOString() })
    );
    const report = JSON.parse(run(['doctor'], home, { TOUCH_GRASS_BRIDGE_DIR: bridge }).stdout);
    assert.equal(report.popupReady, true, 'the fake heartbeat should read as running');
    assert.equal(report.helperVersion, null);
    assert.equal(report.helperVersionMatches, false, 'a version-less helper predates the handshake');
    assert.equal(report.ok, false);
    assert.match(report.helperUpgradeHint, /rebuild/i);
  } finally {
    await rm(bridge, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test('doctor abbreviates the home directory instead of naming the user', async () => {
  const home = await mkdtemp(path.join(os.homedir(), '.touch-grass-doctor-'));
  try {
    const result = run(['doctor'], home);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.match(report.dataDir, /^~[/\\]/, 'a data directory under home must be written with a tilde');
    assert.doesNotMatch(result.stdout, new RegExp(os.userInfo().username), 'doctor must not name the user');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('doctor still prints a data directory outside home in full', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-outside-'));
  try {
    const report = JSON.parse(run(['doctor'], home).stdout);
    assert.equal(report.dataDir, home, 'a path outside home stays literal so it can be debugged');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('choosing a companion that does not exist is refused, not silently ignored', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  try {
    const bogus = run(['companions', 'use', 'mochi'], home);
    assert.equal(bogus.status, 1);
    assert.match(bogus.stderr, /don't have a companion called mochi/i);

    const listed = JSON.parse(run(['companions', 'list'], home).stdout);
    assert.equal(listed.selected, 'rotate', 'a rejected id must not be saved');

    const real = run(['companions', 'use', 'nian'], home);
    assert.equal(real.status, 0, real.stderr);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('a bundled cat can be hidden, and the last one cannot', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  try {
    const hidden = run(['companions', 'remove', 'nian'], home);
    assert.equal(hidden.status, 0, hidden.stderr);
    assert.match(hidden.stdout, /removed nian/i);

    const listed = JSON.parse(run(['companions', 'list'], home).stdout);
    assert.equal(listed.selected, 'rotate');

    const last = run(['companions', 'remove', 'yuzu'], home);
    assert.equal(last.status, 1, 'hiding every cat must be refused');
    assert.match(last.stderr, /last companion/i);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('previewing a disabled reminder explains that it is turned off', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  try {
    assert.equal(run(['reminders', 'disable', 'water'], home).status, 0);
    const disabled = run(['test', 'water', '--dry-run'], home);
    assert.equal(disabled.status, 1);
    assert.match(disabled.stderr, /turned off/i);

    const unknown = run(['test', 'nonsense', '--dry-run'], home);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /not available/i);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('a config naming the retired companion id migrates to Yuzu', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  try {
    assert.equal(run(['companions', 'use', 'nian'], home).status, 0);
    const configPath = path.join(home, 'config.json');
    const raw = JSON.parse(await readFile(configPath, 'utf8'));
    raw.companion = 'you';
    await writeFile(configPath, JSON.stringify(raw));

    const listed = JSON.parse(run(['companions', 'list'], home).stdout);
    assert.equal(listed.selected, 'yuzu');
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

test('a six-file cat pack still completes, reusing snack art for lunch and dinner', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  const catDir = path.join(home, 'juniper');
  try {
    await mkdir(catDir);
    for (const action of ['water', 'stretch', 'snack', 'walk', 'eyes', 'bedtime']) {
      await writeFile(path.join(catDir, `${action}.gif`), 'GIF89a');
    }
    const added = run(['companions', 'add', 'juniper', '--name', 'Juniper', '--dir', catDir], home);
    assert.equal(added.status, 0, added.stderr);
    const listed = JSON.parse(run(['companions', 'list'], home).stdout);
    const juniper = listed.companions.find((item) => item.id === 'juniper');
    assert.equal(juniper.assets.lunch, path.join(catDir, 'snack.gif'));
    assert.equal(juniper.assets.dinner, path.join(catDir, 'snack.gif'));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('cat packs require all eight animated actions including bedtime', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-cli-'));
  const catDir = path.join(home, 'mochi');
  try {
    await mkdir(catDir);
    await writeFile(path.join(catDir, 'water.gif'), 'GIF89a');
    const result = run(['companions', 'add', 'mochi', '--name', 'Mochi', '--dir', catDir], home);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /stretch, snack, lunch, dinner, walk, eyes, bedtime/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
