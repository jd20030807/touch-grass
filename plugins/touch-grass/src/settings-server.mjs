import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PLUGIN_ROOT, ensureDataDir, loadConfig, loadPresets, loadState, updateConfig, updateState } from './config.mjs';
import { previewReminder, statusSnapshot } from './engine.mjs';
import { launchBrowser, launchReminder } from './launcher.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8'
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' file: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error('Request body is too large.');
  }
  return raw ? JSON.parse(raw) : {};
}

async function serveFile(res, filePath) {
  const body = await readFile(filePath);
  send(res, 200, body, MIME[path.extname(filePath)] ?? 'application/octet-stream');
}

export async function runSettingsServer(options = {}) {
  const env = options.env ?? process.env;
  const token = randomBytes(24).toString('base64url');
  const paths = await ensureDataDir(env);
  let lastRequestAt = Date.now();

  const server = createServer(async (req, res) => {
    lastRequestAt = Date.now();
    try {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const pathname = requestUrl.pathname;

      if (pathname === '/' && req.method === 'GET') {
        await serveFile(res, path.join(PLUGIN_ROOT, 'ui', 'settings.html'));
        return;
      }
      if (['/settings.css', '/settings.js'].includes(pathname) && req.method === 'GET') {
        await serveFile(res, path.join(PLUGIN_ROOT, 'ui', pathname.slice(1)));
        return;
      }
      if (pathname.startsWith('/assets/actions/') && req.method === 'GET') {
        const filename = path.basename(pathname);
        if (!/^[a-z0-9-]+\.svg$/.test(filename)) throw new Error('Invalid asset path.');
        await serveFile(res, path.join(PLUGIN_ROOT, 'assets', 'actions', filename));
        return;
      }

      if (!pathname.startsWith('/api/')) {
        send(res, 404, { error: 'Not found' });
        return;
      }
      if (req.headers['x-touch-grass-token'] !== token) {
        send(res, 403, { error: 'Invalid settings token.' });
        return;
      }

      if (pathname === '/api/snapshot' && req.method === 'GET') {
        const [config, state, presets, status] = await Promise.all([
          loadConfig(env),
          loadState(env),
          loadPresets(),
          statusSnapshot(env)
        ]);
        send(res, 200, { config, state, presets: presets.reminders, status, dataDir: paths.dir });
        return;
      }
      if (pathname === '/api/config' && req.method === 'PUT') {
        const body = await readBody(req);
        const config = await updateConfig(() => body, env);
        send(res, 200, { config });
        return;
      }
      if (pathname === '/api/action' && req.method === 'POST') {
        const body = await readBody(req);
        if (body.action === 'test') {
          const payload = await previewReminder(body.reminderId, { env });
          launchReminder(payload, { env });
          send(res, 200, { ok: true });
          return;
        }
        if (body.action === 'snooze') {
          const minutes = Math.min(240, Math.max(1, Number(body.minutes) || 15));
          const state = await updateState((current) => ({
            ...current,
            snoozedUntil: new Date(Date.now() + minutes * 60_000).toISOString()
          }), env);
          send(res, 200, { ok: true, state });
          return;
        }
        if (body.action === 'reset-activity') {
          const state = await updateState((current) => ({
            ...current,
            activeMs: 0,
            lastActivityAt: new Date().toISOString()
          }), env);
          send(res, 200, { ok: true, state });
          return;
        }
        send(res, 400, { error: 'Unknown action.' });
        return;
      }
      send(res, 404, { error: 'Not found' });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/?token=${encodeURIComponent(token)}`;
  await writeFile(paths.settingsServer, `${JSON.stringify({ port: address.port, token, pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });

  const cleanup = async () => {
    await unlink(paths.settingsServer).catch(() => {});
  };
  server.on('close', cleanup);
  process.once('SIGTERM', () => server.close());
  process.once('SIGINT', () => server.close());

  const idleMs = options.idleMs ?? 20 * 60_000;
  const timer = setInterval(() => {
    if (Date.now() - lastRequestAt > idleMs) server.close();
  }, Math.min(60_000, Math.max(1_000, Math.floor(idleMs / 4))));
  timer.unref();

  if (options.openBrowser !== false) launchBrowser(url, { env });
  return { server, url, token, port: address.port };
}
