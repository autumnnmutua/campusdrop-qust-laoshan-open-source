import type { Env } from './types';
import { ApiError, body, json } from './http';
import { requireAdmin, requireStudent } from './session';
import { pushRemoveSchema, pushSubscriptionSchema } from '../shared/live';
import { rateLimit } from './rate-limit';

/**
 * Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291), on WebCrypto only.
 * Disabled until VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are set as Worker secrets (see scripts/vapid-keys.mjs).
 */
export interface PushPayload { title: string; body: string; url: string; tag: string }
type Owner = 'STUDENT' | 'ADMIN';

// Browser push services only. Endpoints are client-supplied URLs, so anything else would turn push into an open relay.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^push\.services\.mozilla\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/, /^push\.api\.chrome\.google\.com$/];
export const pushEnabled = (env: Env) => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

type Bytes = Uint8Array<ArrayBuffer>;
const text = (value: string): Bytes => new TextEncoder().encode(value);
const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};
const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (value: string): Bytes => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** RFC 8291: one aes128gcm record keyed from an ephemeral ECDH exchange with the browser's key and auth secret. */
async function encrypt(p256dh: string, authSecret: string, payload: Bytes): Promise<Bytes> {
  const browserKey = fromBase64Url(p256dh), auth = fromBase64Url(authSecret);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const localPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey) as ArrayBuffer);
  const browserPublic = await crypto.subtle.importKey('raw', browserKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: browserPublic }, local.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(text('WebPush: info\0'), browserKey, localPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await crypto.subtle.importKey('raw', await hkdf(salt, ikm, text('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['encrypt']);
  const nonce = await hkdf(salt, ikm, text('Content-Encoding: nonce\0'), 12);
  // 0x02 marks the last (and only) record.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, contentKey, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = localPublic.length;
  return concat(header, localPublic, cipher);
}

const vapidCache = new Map<string, { value: string; expires: number }>();
/** ES256 JWT for the push service's origin, reused for an hour per isolate. */
async function vapidHeader(env: Env, endpoint: string): Promise<string> {
  const audience = new URL(endpoint).origin, now = Math.floor(Date.now() / 1000);
  const cached = vapidCache.get(audience);
  if (cached && cached.expires > now) return cached.value;
  const publicKey = fromBase64Url(env.VAPID_PUBLIC_KEY!);
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: toBase64Url(publicKey.slice(1, 33)), y: toBase64Url(publicKey.slice(33, 65)), d: env.VAPID_PRIVATE_KEY, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const encode = (value: unknown) => toBase64Url(text(JSON.stringify(value)));
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({ aud: audience, exp: now + 12 * 3600, sub: env.VAPID_SUBJECT || env.APP_ORIGIN })}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, text(unsigned)));
  const value = `vapid t=${unsigned}.${toBase64Url(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
  vapidCache.set(audience, { value, expires: now + 3600 });
  return value;
}

/** Sends to every device the owner subscribed; expired subscriptions (404/410) are removed. Never throws. */
export async function sendPush(env: Env, owner: Owner, ownerId: string, payload: PushPayload): Promise<void> {
  if (!pushEnabled(env)) return;
  const subscriptions = (await env.DB.prepare('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE owner_kind=? AND owner_id=? ORDER BY created_at DESC LIMIT 8')
    .bind(owner, ownerId).all<{ endpoint: string; p256dh: string; auth: string }>()).results;
  await Promise.all(subscriptions.map(async sub => {
    try {
      const response = await fetch(sub.endpoint, {
        method: 'POST',
        headers: { Authorization: await vapidHeader(env, sub.endpoint), TTL: '86400', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' },
        body: await encrypt(sub.p256dh, sub.auth, text(JSON.stringify(payload))),
      });
      if (response.status === 404 || response.status === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(sub.endpoint).run();
    } catch (error) { console.warn('push failed', error); }
  }));
}

export async function pushRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace('/api/v1', ''), method = request.method;
  if (path === '/push/key' && method === 'GET') return json({ publicKey: pushEnabled(env) ? env.VAPID_PUBLIC_KEY : null });
  const match = /^\/(admin\/)?push\/(subscribe|unsubscribe)$/.exec(path);
  if (!match || method !== 'POST') return null;
  const owner: Owner = match[1] ? 'ADMIN' : 'STUDENT';
  const ownerId = owner === 'ADMIN' ? (await requireAdmin(request, env)).id : (await requireStudent(request, env)).id;
  if (match[2] === 'unsubscribe') {
    const data = await body(request, pushRemoveSchema);
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND owner_kind=? AND owner_id=?').bind(data.endpoint, owner, ownerId).run();
    return json({ ok: true });
  }
  if (!pushEnabled(env)) throw new ApiError(503, 'PUSH_UNAVAILABLE', '站点暂未开启推送通知');
  await rateLimit(env, `push:${owner}:${ownerId}`, 20);
  const data = await body(request, pushSubscriptionSchema);
  if (!PUSH_HOSTS.some(host => host.test(new URL(data.endpoint).hostname))) throw new ApiError(400, 'PUSH_SERVICE_UNSUPPORTED', '当前浏览器的推送服务暂不支持');
  await env.DB.prepare(`INSERT INTO push_subscriptions(endpoint,owner_kind,owner_id,p256dh,auth) VALUES(?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET owner_kind=excluded.owner_kind,owner_id=excluded.owner_id,p256dh=excluded.p256dh,auth=excluded.auth,created_at=unixepoch()`)
    .bind(data.endpoint, owner, ownerId, data.keys.p256dh, data.keys.auth).run();
  return json({ ok: true }, 201);
}
