import crypto from 'node:crypto';
import { db, now, sha256, type UserRow } from './db.js';
import { HttpError } from './errors.js';
import { secretKey } from './codes.js';

/*
 * Two-step sign-in with an authenticator app (TOTP, RFC 6238: 6 digits, 30-second steps, SHA-1, the
 * format every authenticator app reads). The secret is stored encrypted; a code works once (the last
 * used step is remembered); eight recovery codes, stored as hashes, each work once.
 *
 * Signing in: after the password (or Google/Apple), a person with two-step on gets a ticket instead of a
 * session; the ticket plus a code (or a recovery code) makes the session. Tickets live 5 minutes.
 */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf: Buffer) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(s: string) {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch); if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function hotp(secret: Buffer, counter: number) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(c).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
const step = (t = Date.now()) => Math.floor(t / 30_000);

/* the secret at rest: AES-256-GCM with a key kept outside the database */
function seal(plain: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secretKey('totp'), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}
function open(sealed: string) {
  const [iv, tag, body] = sealed.split('.').map((x) => Buffer.from(x, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', secretKey('totp'), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
}

/** Start setting up: a new secret, kept pending until a first code proves the app has it. */
export function beginSetup(u: UserRow, issuer = 'Jhino') {
  const secret = base32(crypto.randomBytes(20));
  db.prepare('UPDATE users SET totp_pending=? WHERE id=?').run(seal(secret), u.id);
  const label = encodeURIComponent(`${issuer}:${u.email}`);
  return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30` };
}

/** Check a 6-digit code against a secret, one step either side; returns the step used, or null. */
function matchStep(secretB32: string, code: string, after: number | null) {
  if (!/^\d{6}$/.test(code)) return null;
  const key = unbase32(secretB32);
  const s = step();
  for (const k of [s - 1, s, s + 1]) {
    if (after !== null && k <= after) continue; // a code works once
    if (crypto.timingSafeEqual(Buffer.from(hotp(key, k)), Buffer.from(code))) return k;
  }
  return null;
}

const RECOVERY = 8;
const recoveryHash = (userId: string, code: string) => sha256(`recovery:${userId}:${code.replace(/[^a-z0-9]/gi, '').toLowerCase()}`);

/** Finish setting up with the first code: two-step is on; the recovery codes are shown once. */
export function finishSetup(u: UserRow, code: unknown) {
  const pending = (db.prepare('SELECT totp_pending FROM users WHERE id=?').get(u.id) as { totp_pending: string | null }).totp_pending;
  if (!pending) throw new HttpError(400, 'VALIDATION_FAILED', 'Start again: scan the new code first.');
  const k = matchStep(open(pending), String(code ?? '').replace(/\s/g, ''), null);
  if (k === null) throw new HttpError(400, 'CODE_INVALID', 'That code is not right. Check the time on your phone, and use the newest code.');
  const codes = Array.from({ length: RECOVERY }, () => crypto.randomBytes(5).toString('hex').replace(/(.{5})/, '$1-'));
  db.prepare('UPDATE users SET totp_secret=?, totp_pending=NULL, totp_enabled_at=?, totp_last_step=?, totp_recovery=? WHERE id=?')
    .run(pending, now(), k, JSON.stringify(codes.map((c) => recoveryHash(u.id, c))), u.id);
  return codes;
}

/** A code from the app, or one recovery code (used up). */
export function checkSecondFactor(userId: string, input: unknown): 'app' | 'recovery' {
  const u = db.prepare('SELECT id, totp_secret, totp_last_step, totp_recovery FROM users WHERE id=?').get(userId) as { id: string; totp_secret: string | null; totp_last_step: number | null; totp_recovery: string | null } | undefined;
  if (!u?.totp_secret) throw new HttpError(400, 'VALIDATION_FAILED', 'Two-step sign-in is not on.');
  const code = String(input ?? '').trim();
  const digits = code.replace(/\s/g, '');
  if (/^\d{6}$/.test(digits)) {
    const k = matchStep(open(u.totp_secret), digits, u.totp_last_step);
    if (k !== null && db.prepare('UPDATE users SET totp_last_step=? WHERE id=? AND (totp_last_step IS NULL OR totp_last_step < ?)').run(k, u.id, k).changes) return 'app';
  } else if (code.length >= 8) {
    const list = JSON.parse(u.totp_recovery ?? '[]') as string[];
    const h = recoveryHash(u.id, code);
    const i = list.indexOf(h);
    if (i >= 0) {
      list.splice(i, 1);
      db.prepare('UPDATE users SET totp_recovery=? WHERE id=?').run(JSON.stringify(list), u.id);
      return 'recovery';
    }
  }
  throw new HttpError(400, 'CODE_INVALID', 'That code is not right. Use the newest code from your app, or a recovery code.');
}

export const twoFactorOn = (u: UserRow) => !!u.totp_enabled_at;
export const recoveryLeft = (userId: string) => (JSON.parse((db.prepare('SELECT totp_recovery FROM users WHERE id=?').get(userId) as { totp_recovery: string | null }).totp_recovery ?? '[]') as string[]).length;
export function turnOff(userId: string) {
  db.prepare('UPDATE users SET totp_secret=NULL, totp_pending=NULL, totp_enabled_at=NULL, totp_last_step=NULL, totp_recovery=NULL WHERE id=?').run(userId);
}

/* sign-in tickets: the password was right; the second step is next */
const tickets = new Map<string, { userId: string; how: string; exp: number; tries: number }>();
setInterval(() => { const t = Date.now(); for (const [k, v] of tickets) if (v.exp < t) tickets.delete(k); }, 60_000).unref();
export function startTicket(userId: string, how: string) {
  if (tickets.size > 50_000) tickets.clear();
  const t = crypto.randomBytes(24).toString('base64url');
  tickets.set(sha256(t), { userId, how, exp: Date.now() + 5 * 60_000, tries: 0 });
  return t;
}
/** The ticket's person, after a right code; five wrong codes end the ticket. */
export function useTicket(ticket: unknown, code: unknown) {
  const k = sha256(String(ticket ?? ''));
  const t = tickets.get(k);
  if (!t || t.exp < Date.now()) { tickets.delete(k); throw new HttpError(400, 'TICKET_EXPIRED', 'That took too long. Sign in again.'); }
  try { const via = checkSecondFactor(t.userId, code); tickets.delete(k); return { userId: t.userId, how: t.how, via }; }
  catch (e) { if (++t.tries >= 5) tickets.delete(k); throw e; }
}
