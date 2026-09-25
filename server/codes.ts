import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { config } from './config.js';
import { db, now, sha256, type UserRow } from './db.js';
import { HttpError } from './errors.js';
import { baseUrl, mails, sendMail } from './mail.js';

/*
 * One-time codes (and the link sent with them) for confirming an email, resetting a password and
 * changing an email.
 *
 * - A code works for 5 minutes, once. Five wrong tries lock it.
 * - Asked for again within those 5 minutes, the same code is sent again (emails sometimes do not
 *   arrive), up to 5 sends, at least 20 seconds apart. After that, the person waits for it to expire.
 * - The code and link are derived from a random seed with a key kept outside the database, so the
 *   same code can be re-sent without storing it; the database holds only hashes.
 */

export type Purpose = 'verify' | 'reset' | 'email_change';
export const CODE_MINUTES = 5;
export const MAX_SENDS = 5;
const GAP_SECONDS = 20;

let key: Buffer | null = null;
function codeKey() {
  if (key) return key;
  const file = path.join(config.dataDir, 'system', 'codes.key');
  try { key = fs.readFileSync(file); } catch { /* first start */ }
  if (!key || key.length < 32) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    key = crypto.randomBytes(32);
    fs.writeFileSync(file, key, { mode: 0o600 });
  }
  return key;
}
/** A 32-byte key for one use (e.g. 'totp'), derived from the key file. */
export const secretKey = (label: string) => crypto.createHmac('sha256', codeKey()).update(`key:${label}`).digest();
const derive = (seed: string, what: string) => crypto.createHmac('sha256', codeKey()).update(`${what}:${seed}`).digest();
function fromSeed(seed: string) {
  const token = derive(seed, 'link').toString('base64url');
  const code = String(derive(seed, 'code').readUInt32BE(0) % 1_000_000).padStart(6, '0');
  return { token, code };
}
export const codeHash = (userId: string, purpose: string, code: string) => sha256(`code:${userId}:${purpose}:${code}`);

interface Row { token_hash: string; user_id: string; purpose: Purpose; data: string | null; created_at: string; expires_at: string; used_at: string | null; code_hash: string | null; attempts: number; seed: string | null; sends: number; last_sent_at: string | null }

export interface Issued { token: string; code: string; sends: number; maxSends: number; expiresAt: string; again: boolean }

/** A code to send now: the live one again (same code), or a new one. Throws 429 when it may not be sent yet. */
/* Per account per day, whatever the address: at most 30 codes sent and 20 wrong codes typed. */
const DAY_SENDS = 30;
const DAY_WRONG = 20;
const today = () => new Date().toISOString().slice(0, 10);
function usage(userId: string) {
  return (db.prepare('SELECT issued, wrong FROM code_usage WHERE user_id=? AND day=?').get(userId, today()) as { issued: number; wrong: number } | undefined) ?? { issued: 0, wrong: 0 };
}
const bump = (userId: string, col: 'issued' | 'wrong') => db.prepare(`INSERT INTO code_usage(user_id,day,${col}) VALUES(?,?,1) ON CONFLICT(user_id,day) DO UPDATE SET ${col}=${col}+1`).run(userId, today());
setInterval(() => db.prepare('DELETE FROM code_usage WHERE day < ?').run(new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)), 6 * 3600e3).unref();

export function issueCode(userId: string, purpose: Purpose, data: string | null = null): Issued {
  if (usage(userId).issued >= DAY_SENDS) throw new HttpError(429, 'CODE_DAY_LIMIT', 'Too many codes were asked for this account today. Try again tomorrow, or contact support.');
  const live = db.prepare('SELECT * FROM auth_tokens WHERE user_id=? AND purpose=? AND used_at IS NULL AND expires_at > ? AND seed IS NOT NULL ORDER BY created_at DESC LIMIT 1')
    .get(userId, purpose, now()) as Row | undefined;
  if (live && live.attempts < 5 && (live.data ?? null) === data) {
    const wait = Math.ceil((Date.parse(live.expires_at) - Date.now()) / 1000);
    if (live.sends >= MAX_SENDS) {
      throw new HttpError(429, 'CODE_SEND_LIMIT', `We sent this code ${MAX_SENDS} times. Check your spam folder, or ask again in ${Math.max(1, Math.ceil(wait / 60))} minute${wait > 60 ? 's' : ''}.`, { retryAfter: wait });
    }
    const since = (Date.now() - Date.parse(live.last_sent_at ?? live.created_at)) / 1000;
    if (since < GAP_SECONDS) {
      const s = Math.ceil(GAP_SECONDS - since);
      throw new HttpError(429, 'CODE_TOO_SOON', `The code is on its way. You can ask again in ${s} second${s === 1 ? '' : 's'}.`, { retryAfter: s });
    }
    db.prepare('UPDATE auth_tokens SET sends=sends+1, last_sent_at=? WHERE token_hash=?').run(now(), live.token_hash);
    bump(userId, 'issued');
    return { ...fromSeed(live.seed!), sends: live.sends + 1, maxSends: MAX_SENDS, expiresAt: live.expires_at, again: true };
  }
  // A new code replaces older unused ones for the same purpose.
  db.prepare('DELETE FROM auth_tokens WHERE user_id=? AND purpose=? AND used_at IS NULL').run(userId, purpose);
  const seed = crypto.randomBytes(16).toString('hex');
  const { token, code } = fromSeed(seed);
  const t = now();
  const expiresAt = new Date(Date.now() + CODE_MINUTES * 60_000).toISOString();
  db.prepare('INSERT INTO auth_tokens(token_hash,user_id,purpose,data,created_at,expires_at,code_hash,seed,sends,last_sent_at) VALUES(?,?,?,?,?,?,?,?,1,?)')
    .run(sha256(token), userId, purpose, data, t, expiresAt, codeHash(userId, purpose, code), seed, t);
  bump(userId, 'issued');
  return { token, code, sends: 1, maxSends: MAX_SENDS, expiresAt, again: false };
}

/** Use a 6-digit code: right user, right purpose, not expired, not used; five wrong tries lock it. */
export function useCode(userId: string, purposes: Purpose[], code: unknown) {
  const c = String(code ?? '').replace(/\s+/g, '');
  const row = db.prepare(`SELECT * FROM auth_tokens WHERE user_id=? AND purpose IN (${purposes.map(() => '?').join(',')}) AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`)
    .get(userId, ...purposes) as Row | undefined;
  const bad = () => new HttpError(400, 'CODE_INVALID', 'That code is not right. Check the latest email, or ask for the code again.');
  if (!row || !row.code_hash) throw bad();
  if (usage(userId).wrong >= DAY_WRONG) throw new HttpError(429, 'CODE_LOCKED', 'Too many wrong codes for this account today. Try again tomorrow, or contact support.');
  if (Date.parse(row.expires_at) < Date.now()) throw new HttpError(400, 'CODE_EXPIRED', 'That code has expired. Ask for a new one.');
  if (row.attempts >= 5) throw new HttpError(429, 'CODE_LOCKED', 'Too many wrong codes. Ask for a new one.');
  if (!/^\d{6}$/.test(c) || !crypto.timingSafeEqual(Buffer.from(codeHash(userId, row.purpose, c)), Buffer.from(row.code_hash))) {
    db.prepare('UPDATE auth_tokens SET attempts=attempts+1 WHERE token_hash=?').run(row.token_hash);
    bump(userId, 'wrong');
    throw bad();
  }
  if (!db.prepare('UPDATE auth_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL').run(now(), row.token_hash).changes) throw bad();
  return row;
}

/** Use the link from an email (same rules as the code). */
export function useToken(token: unknown, purposes: Purpose[]) {
  const t = String(token ?? '');
  if (!/^[\w-]{20,100}$/.test(t)) throw new HttpError(400, 'TOKEN_INVALID', 'This link is not valid. Ask for a new one.');
  const row = db.prepare('SELECT * FROM auth_tokens WHERE token_hash=?').get(sha256(t)) as Row | undefined;
  if (!row || !purposes.includes(row.purpose)) throw new HttpError(400, 'TOKEN_INVALID', 'This link is not valid. Ask for a new one.');
  if (row.used_at) throw new HttpError(400, 'TOKEN_USED', 'This link was already used. Ask for a new one if you need it.');
  if (Date.parse(row.expires_at) < Date.now()) throw new HttpError(400, 'TOKEN_EXPIRED', 'This link has expired. Ask for a new one.');
  if (!db.prepare('UPDATE auth_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL').run(now(), row.token_hash).changes) {
    throw new HttpError(400, 'TOKEN_USED', 'This link was already used.');
  }
  return row;
}
setInterval(() => db.prepare('DELETE FROM auth_tokens WHERE expires_at < ?').run(new Date(Date.now() - 7 * 864e5).toISOString()), 6 * 3600e3).unref();

const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
/** A new sign-up must confirm the email with a code before it gets a session. */
export const mustVerifyToSignIn = (u: UserRow) => !!u.verify_required && !u.email_verified_at && !u.is_admin && looksLikeEmail(u.email);

/** Send (or send again) the code that confirms a person's email. */
export function sendVerifyCode(req: FastifyRequest | null, u: UserRow): Issued {
  const c = issueCode(u.id, 'verify');
  sendMail(u.email, 'verify', mails.verify(u.name, `${baseUrl(req)}/verify?token=${c.token}`, c.code));
  return c;
}
/** What a code screen needs to know, without the code. */
export const codeInfo = (c: Issued) => ({ sends: c.sends, maxSends: c.maxSends, expiresAt: c.expiresAt, again: c.again });
