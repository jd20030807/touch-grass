import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLUGIN_ROOT } from './config.mjs';

function encodePayload(payload) {
  const browserPayload = {
    ...payload,
    assetUrl: payload.assetPath ? pathToFileURL(payload.assetPath).href : null,
    iconUrl: payload.iconPath ? pathToFileURL(payload.iconPath).href : null
  };
  delete browserPayload.assetPath;
  delete browserPayload.iconPath;
  return Buffer.from(JSON.stringify(browserPayload), 'utf8').toString('base64url');
}

export function reminderUrl(payload) {
  const page = pathToFileURL(path.join(PLUGIN_ROOT, 'ui', 'reminder.html'));
  page.searchParams.set('data', encodePayload(payload));
  return page.href;
}

function isCommandAvailable(command) {
  if (command.includes(path.sep)) return existsSync(command);
  const probe = process.platform === 'win32' ? 'where' : 'command';
  const args = process.platform === 'win32' ? [command] : ['-v', command];
  return spawnSync(probe, args, { shell: process.platform !== 'win32', stdio: 'ignore' }).status === 0;
}

function browserCandidates(env = process.env) {
  const custom = env.TOUCH_GRASS_BROWSER ? [env.TOUCH_GRASS_BROWSER] : [];
  if (process.platform === 'win32') {
    return [
      ...custom,
      path.join(env.PROGRAMFILES ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(env.LOCALAPPDATA ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ];
  }
  return [...custom, 'google-chrome', 'chromium', 'chromium-browser', 'brave-browser', 'microsoft-edge'];
}

export function nativeBridgeDirectory(env = process.env) {
  if (env.TOUCH_GRASS_BRIDGE_DIR) return path.resolve(env.TOUCH_GRASS_BRIDGE_DIR);
  const userId = typeof process.getuid === 'function' ? process.getuid() : (env.UID ?? 'user');
  return path.join(os.tmpdir(), `touch-grass-${userId}`);
}

export function nativeHelperStatus(env = process.env, nowMs = Date.now()) {
  const bridgePath = nativeBridgeDirectory(env);
  const heartbeatPath = path.join(bridgePath, 'helper.json');
  let ready = false;
  try {
    ready = nowMs - statSync(heartbeatPath).mtimeMs < 3_500;
  } catch {
    ready = false;
  }
  return { bridgePath, heartbeatPath, ready };
}

export function resolveReminderCommand(url, env = process.env) {
  if (process.platform === 'darwin' || env.TOUCH_GRASS_NATIVE_HELPER === '1') {
    const helper = nativeHelperStatus(env);
    return {
      executable: 'Touch Grass.app',
      args: [],
      mode: 'native-helper',
      ...helper
    };
  }
  const browser = browserCandidates(env).find(isCommandAvailable);
  if (browser) {
    const browserArgs = [
      `--app=${url}`,
      '--window-size=414,124',
      '--window-position=32,54',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-mode',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-session-crashed-bubble',
      '--disable-sync',
      '--metrics-recording-only'
    ];
    return {
      executable: browser,
      args: browserArgs,
      mode: 'app-window'
    };
  }
  return { executable: null, args: [], mode: 'unavailable' };
}

function launch(command, dryRun = false) {
  if (dryRun) return command;
  if (!command.executable || command.mode !== 'app-window') {
    throw new Error('No supported local popup host was found. Install Chrome, Chromium, Brave, or Edge and try again.');
  }
  const child = spawn(command.executable, command.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  return command;
}

export function launchReminder(payload, options = {}) {
  const url = reminderUrl(payload);
  const command = resolveReminderCommand(url, options.env ?? process.env);
  const dryRun = options.dryRun ?? process.env.TOUCH_GRASS_DRY_RUN === '1';
  if (command.mode === 'native-helper') {
    if (!dryRun) {
      if (!command.ready) {
        throw new Error('The Touch Grass popup helper is not running. Open “Touch Grass.app” once, then try again.');
      }
      mkdirSync(command.bridgePath, { recursive: true, mode: 0o700 });
      const requestPath = path.join(command.bridgePath, 'reminder.json');
      const temporaryPath = `${requestPath}.${process.pid}.${randomUUID()}.tmp`;
      writeFileSync(temporaryPath, `${JSON.stringify({ url, createdAt: new Date().toISOString() })}\n`, { mode: 0o600 });
      renameSync(temporaryPath, requestPath);
    }
  } else launch(command, dryRun);
  return { url, ...command };
}
