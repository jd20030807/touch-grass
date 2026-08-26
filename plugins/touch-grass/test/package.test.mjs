import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { reminderUrl, resolveReminderCommand } from '../src/launcher.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('both host manifests identify the same plugin version', async () => {
  const codex = JSON.parse(await readFile(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
  const claude = JSON.parse(await readFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(codex.name, 'touch-grass');
  assert.equal(claude.name, codex.name);
  assert.equal(claude.version, codex.version);
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

test('launcher has a deterministic fallback command', () => {
  const command = resolveReminderCommand('file:///preview', { TOUCH_GRASS_BROWSER: '/path/that/does/not/exist' });
  assert.ok(command.executable);
  assert.ok(command.args.some((argument) => argument.includes('file:///preview')));
});
