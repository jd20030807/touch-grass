import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
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
  if (process.platform === 'darwin') {
    return [
      ...custom,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ];
  }
  if (process.platform === 'win32') {
    return [
      ...custom,
      path.join(env.PROGRAMFILES ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ];
  }
  return [...custom, 'google-chrome', 'chromium', 'chromium-browser', 'brave-browser', 'microsoft-edge'];
}

export function resolveReminderCommand(url, env = process.env) {
  const browser = browserCandidates(env).find(isCommandAvailable);
  if (browser) {
    return {
      executable: browser,
      args: [
        `--app=${url}`,
        '--window-size=420,420',
        '--window-position=32,72',
        '--no-first-run',
        '--disable-session-crashed-bubble'
      ],
      mode: 'app-window'
    };
  }
  if (process.platform === 'darwin') return { executable: '/usr/bin/open', args: [url], mode: 'browser-tab' };
  if (process.platform === 'win32') {
    return { executable: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', url], mode: 'browser-tab' };
  }
  return { executable: 'xdg-open', args: [url], mode: 'browser-tab' };
}

function launch(command, dryRun = false) {
  if (dryRun) return command;
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
  launch(command, options.dryRun ?? process.env.TOUCH_GRASS_DRY_RUN === '1');
  return { url, ...command };
}
