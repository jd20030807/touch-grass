import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchReminder, reminderUrl, resolveReminderCommand } from '../src/launcher.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('both host manifests identify the same plugin version', async () => {
  const codex = JSON.parse(await readFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
  const claude = JSON.parse(await readFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(codex.name, 'touch-grass');
  assert.equal(claude.name, codex.name);
  assert.equal(claude.version, codex.version.split('+')[0]);
});

test('hook commands stay inside the installed plugin root', async () => {
  const hooks = JSON.parse(await readFile(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));
  for (const groups of Object.values(hooks.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        assert.match(hook.command, /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/touch-grass\.mjs/);
        assert.doesNotMatch(hook.command, /https?:\/\//);
      }
    }
  }
});

test('reminder payload is encoded into a local file URL', () => {
  const url = reminderUrl({ id: 'nap', title: 'Nap', message: 'Rest.', durationSeconds: 10 });
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
