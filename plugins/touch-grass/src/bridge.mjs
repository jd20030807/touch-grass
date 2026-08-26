import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PRESENCE_FRESHNESS_MS = 20_000;

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

function sessionKey(input, env, host) {
  const raw = input.session_id
    ?? input.sessionId
    ?? env.CODEX_THREAD_ID
    ?? env.CLAUDE_SESSION_ID
    ?? `${host}-default`;
  return createHash('sha256').update(String(raw)).digest('hex').slice(0, 24);
}

function isSessionEnd(input) {
  const event = String(input.hook_event_name ?? input.event ?? '').toLowerCase();
  return event === 'sessionend' || event === 'session_end';
}

async function atomicWrite(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export async function publishAgentSession(input = {}, options = {}) {
  const env = options.env ?? process.env;
  const nowMs = options.nowMs ?? Date.now();
  const host = options.host ?? 'agent';
  const bridgePath = nativeBridgeDirectory(env);
  const sessionsPath = path.join(bridgePath, 'sessions');
  await mkdir(sessionsPath, { recursive: true, mode: 0o700 });
  const leasePath = path.join(sessionsPath, `${sessionKey(input, env, host)}.json`);

  if (isSessionEnd(input)) {
    await unlink(leasePath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    return { active: false, host, leasePath };
  }

  const awayResetMinutes = Math.min(180, Math.max(1, Number(options.awayResetMinutes) || 10));
  const lease = {
    schemaVersion: 1,
    active: true,
    host,
    awayResetMinutes,
    updatedAt: new Date(nowMs).toISOString()
  };
  await atomicWrite(leasePath, lease);
  return { ...lease, leasePath };
}

function cleanIdentifier(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value) ? value : null;
}

export async function readPresenceSnapshot(env = process.env, nowMs = Date.now()) {
  const presencePath = path.join(nativeBridgeDirectory(env), 'presence.json');
  let value;
  try {
    value = JSON.parse(await readFile(presencePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }

  const sampledAtMs = Date.parse(value.sampledAt);
  const helperInstanceId = cleanIdentifier(value.helperInstanceId);
  const stretchId = cleanIdentifier(value.stretchId);
  const stretchEngagedMs = Number(value.stretchEngagedMs);
  const ageMs = nowMs - sampledAtMs;
  if (
    value.schemaVersion !== 1
    || !helperInstanceId
    || !stretchId
    || !Number.isFinite(stretchEngagedMs)
    || stretchEngagedMs < 0
    || typeof value.engaged !== 'boolean'
    || !Number.isFinite(sampledAtMs)
    || ageMs < -5_000
    || ageMs > PRESENCE_FRESHNESS_MS
  ) return null;

  return {
    helperInstanceId,
    stretchId,
    stretchEngagedMs: Math.round(stretchEngagedMs),
    sampledAt: new Date(sampledAtMs).toISOString(),
    engaged: value.engaged
  };
}
