import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchReminder, reminderUrl, resolveReminderCommand } from '../src/launcher.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function inspectGif(buffer) {
  assert.match(buffer.subarray(0, 6).toString('ascii'), /^GIF8[79]a$/);
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  const screenPacked = buffer[10];
  let offset = 13;
  if (screenPacked & 0x80) offset += 3 * (2 ** ((screenPacked & 0x07) + 1));
  let frames = 0;
  let transparent = false;

  const skipSubBlocks = () => {
    while (offset < buffer.length) {
      const size = buffer[offset++];
      if (size === 0) return;
      offset += size;
    }
  };

  while (offset < buffer.length) {
    const marker = buffer[offset++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      const label = buffer[offset++];
      if (label === 0xf9) {
        const blockSize = buffer[offset++];
        transparent ||= Boolean(buffer[offset] & 0x01);
        offset += blockSize;
        assert.equal(buffer[offset++], 0, 'graphic-control extension must terminate');
      } else skipSubBlocks();
      continue;
    }
    assert.equal(marker, 0x2c, `unexpected GIF block 0x${marker.toString(16)}`);
    frames += 1;
    const imagePacked = buffer[offset + 8];
    offset += 9;
    if (imagePacked & 0x80) offset += 3 * (2 ** ((imagePacked & 0x07) + 1));
    offset += 1;
    skipSubBlocks();
  }
  return { width, height, frames, transparent };
}

test('both host manifests identify the same plugin version', async () => {
  const codex = JSON.parse(await readFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
  const claude = JSON.parse(await readFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(codex.name, 'touch-grass');
  assert.equal(claude.name, codex.name);
  assert.equal(claude.version, codex.version.split('+')[0]);
});

test('chat skill does not embellish first-use copy with companion names or rotation details', async () => {
  const skill = await readFile(path.join(pluginRoot, 'skills', 'touch-grass', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(skill, /Nian and You|rotate(?:s|d|ing)? by default/i);
  assert.match(skill, /Present `welcome` and `settings` output verbatim/);
});

test('Nian and You ship as complete transparent animated companion packs', async () => {
  const manifest = JSON.parse(await readFile(
    path.join(pluginRoot, 'assets', 'companions', 'manifest.json'),
    'utf8'
  ));
  assert.deepEqual(manifest.companions.map((item) => item.id), ['nian', 'you']);
  const actions = ['water', 'stretch', 'snack', 'walk', 'eyes', 'bedtime'];

  for (const companion of manifest.companions) {
    assert.deepEqual(Object.keys(companion.assets), actions);
    for (const action of actions) {
      const assetPath = path.join(pluginRoot, 'assets', 'companions', companion.id, companion.assets[action].split('/').at(-1));
      const source = await readFile(assetPath);
      const gif = inspectGif(source);
      assert.deepEqual([gif.width, gif.height], [256, 256]);
      assert.equal(gif.frames, 8, `${companion.id}/${action} must contain eight loop frames`);
      assert.equal(gif.transparent, true, `${companion.id}/${action} must preserve transparency`);
      assert.ok(source.length < 2_000_000, `${companion.id}/${action} must stay under 2 MB`);
    }
  }
});

test('popup is constrained to a notification-sized banner', async () => {
  const [css, swift] = await Promise.all([
    readFile(path.join(pluginRoot, 'ui', 'reminder.css'), 'utf8'),
    readFile(path.join(pluginRoot, 'native', 'macos', 'TouchGrassPopup.swift'), 'utf8')
  ]);
  assert.match(css, /width: min\(100%, 394px\)/);
  assert.match(css, /min-height: 104px/);
  assert.match(swift, /let width: CGFloat = 414/);
  assert.match(swift, /let height: CGFloat = 124/);
});

test('hook commands stay inside the installed plugin root', async () => {
  const hooks = JSON.parse(await readFile(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));
  assert.ok(hooks.hooks.SessionEnd, 'SessionEnd must remove the local session lease');
  for (const groups of Object.values(hooks.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        assert.match(hook.command, /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/touch-grass\.mjs/);
        assert.doesNotMatch(hook.command, /https?:\/\//);
      }
    }
  }
});

test('macOS presence sampling uses aggregate idle age without privileged event capture', async () => {
  const [swift, plist] = await Promise.all([
    readFile(path.join(pluginRoot, 'native', 'macos', 'TouchGrassPopup.swift'), 'utf8'),
    readFile(path.join(pluginRoot, 'native', 'macos', 'Info.plist'), 'utf8')
  ]);
  assert.match(swift, /secondsSinceLastEventType/);
  assert.match(swift, /frontmostApplication/);
  assert.match(swift, /com\.openai\.codex/);
  assert.match(swift, /com\.anthropic\.claudefordesktop/);
  assert.match(swift, /isClaudeDesktop \|\| isClaudeCodeCLIHost/);
  assert.doesNotMatch(swift, /CGEvent\.tapCreate|NSEvent\.addGlobalMonitor/);
  assert.doesNotMatch(plist, /Accessibility|InputMonitoring|ScreenCapture|ScreenRecording/i);
});

test('reminder payload is encoded into a local file URL', () => {
  const url = reminderUrl({ id: 'bedtime', title: 'Bedtime', message: 'Rest.', durationSeconds: 10 });
  assert.match(url, /^file:/);
  assert.doesNotMatch(url, /title=Nap/);
  assert.ok(new URL(url).searchParams.get('data'));
});

test('launcher requires either the native helper or a dedicated app window', () => {
  const command = resolveReminderCommand('file:///preview', {
    TOUCH_GRASS_NATIVE_HELPER: '1',
    TOUCH_GRASS_BROWSER: '/path/that/does/not/exist',
    TOUCH_GRASS_BRIDGE_DIR: '/tmp/touch-grass-unit-missing'
  });
  if (command.mode === 'native-helper') {
    assert.equal(command.executable, 'Touch Grass.app');
    assert.equal(command.bridgePath, '/tmp/touch-grass-unit-missing');
  } else if (command.mode === 'unavailable') {
    assert.equal(command.executable, null);
    assert.deepEqual(command.args, []);
  } else {
    assert.equal(command.mode, 'app-window');
    assert.ok(command.args.some((argument) => argument.includes('file:///preview')));
  }
});

test('native helper bridge receives a local reminder request only when its heartbeat is fresh', async () => {
  const bridgePath = await mkdtemp(path.join(os.tmpdir(), 'touch-grass-bridge-'));
  const env = { TOUCH_GRASS_NATIVE_HELPER: '1', TOUCH_GRASS_BRIDGE_DIR: bridgePath };
  try {
    assert.throws(
      () => launchReminder({ id: 'water', title: 'Water', message: 'Sip.', durationSeconds: 18 }, { env }),
      /popup helper is not running/i
    );

    await writeFile(path.join(bridgePath, 'helper.json'), '{}');
    const result = launchReminder({ id: 'water', title: 'Water', message: 'Sip.', durationSeconds: 18 }, { env });
    const request = JSON.parse(await readFile(path.join(bridgePath, 'reminder.json'), 'utf8'));
    assert.equal(result.mode, 'native-helper');
    assert.match(request.url, /^file:/);
    assert.match(request.url, /reminder\.html/);
  } finally {
    await rm(bridgePath, { recursive: true, force: true });
  }
});
