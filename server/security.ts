import type { FastifyRequest } from 'fastify';
import { db, now } from './db.js';
import { HttpError } from './errors.js';

/* ---------------- rate limits ---------------- */
// Fixed windows in memory: enough for one server; counters reset on restart.
const hits = new Map<string, { n: number; reset: number }>();
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (v.reset < t) hits.delete(k); }, 60_000).unref();

// Automated tests sign in hundreds of times from one address; they raise this. Never set it in production.
const SCALE = Math.max(1, Number(process.env.RATE_LIMIT_SCALE) || 1);
/** Count one attempt against `bucket` for this IP (and an optional extra key). Throws 429 over the limit. */
export function limit(req: FastifyRequest, bucket: string, max: number, windowMs: number, extra = '') {
  const key = `${bucket}|${req.ip}|${extra}`;
  const t = Date.now();
  let h = hits.get(key);
  if (!h || h.reset < t) { h = { n: 0, reset: t + windowMs }; hits.set(key, h); }
  h.n++;
  if (h.n > max * SCALE) {
    const wait = Math.ceil((h.reset - t) / 1000);
    throw new HttpError(429, 'TOO_MANY_REQUESTS', `Too many tries. Please wait ${wait > 90 ? Math.ceil(wait / 60) + ' minutes' : wait + ' seconds'} and try again.`);
  }
}

/**
 * Count one attempt against `bucket` for a key that is not an address (an account, an email), so
 * spreading tries over many addresses does not help. Throws 429 over the limit.
 */
export function limitKey(bucket: string, key: string, max: number, windowMs: number, message?: string) {
  const k = `${bucket}|#${key.toLowerCase()}`;
  const t = Date.now();
  let h = hits.get(k);
  if (!h || h.reset < t) { h = { n: 0, reset: t + windowMs }; hits.set(k, h); }
  h.n++;
  if (h.n > max * SCALE) {
    const wait = Math.ceil((h.reset - t) / 1000);
    throw new HttpError(429, 'TOO_MANY_REQUESTS', message ?? `Too many tries for this account. Please wait ${wait > 90 ? Math.ceil(wait / 60) + ' minutes' : wait + ' seconds'} and try again.`);
  }
}

/* ---------------- who is asking ---------------- */
export function clientInfo(req: FastifyRequest) {
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 300);
  // Only from a trusted proxy header (Cloudflare and similar), never guessed.
  const country = String(req.headers['cf-ipcountry'] ?? req.headers['x-vercel-ip-country'] ?? '').slice(0, 2).toUpperCase() || null;
  return { ip: req.ip, ua, country: country && /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : null };
}

/** "Chrome on Windows", "Safari on iPhone" from a user agent. */
export function deviceName(ua: string | null | undefined): string {
  const s = ua ?? '';
  if (!s) return 'Unknown device';
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox'
    : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /curl|node|undici|Playwright/i.test(s) ? 'App' : 'Browser';
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows'
    : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /CrOS/.test(s) ? 'Chromebook' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

/** Show enough of an address to recognise it, not the whole thing. */
export function maskIp(ip: string | null | undefined): string {
  if (!ip) return '';
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.split('.').slice(0, 3).join('.') + '.x';
  return ip.split(':').slice(0, 3).join(':') + ':…';
}

/* ---------------- logs ---------------- */
export function securityEvent(userId: string | null, kind: string, req: FastifyRequest | null, detail = '') {
  const c = req ? clientInfo(req) : { ip: null, ua: null };
  db.prepare('INSERT INTO security_events(user_id,kind,ip,ua,detail,at) VALUES(?,?,?,?,?,?)').run(userId, kind, c.ip, c.ua, detail.slice(0, 300), now());
}

export function audit(req: FastifyRequest, action: string, targetType: string | null, targetId: string | null, detail = '') {
  const u = req.user;
  db.prepare('INSERT INTO audit_log(actor_id,actor_email,action,target_type,target_id,detail,ip,at) VALUES(?,?,?,?,?,?,?,?)')
    .run(u?.id ?? null, u?.email ?? null, action, targetType, targetId, detail.slice(0, 500), req.ip, now());
}

/* ---------------- platform settings ---------------- */
const DEFAULTS: Record<string, string> = { uploads: 'off', signups: 'on', support_email: '' };
export function setting(key: string): string {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
  return r?.value ?? DEFAULTS[key] ?? '';
}
export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}
export const uploadsOn = () => setting('uploads') === 'on';

/* ---------------- files people send us (payment proof, QR codes, avatars) ---------------- */
/** The real image type from the first bytes, whatever the file name says. */
export function imageType(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
