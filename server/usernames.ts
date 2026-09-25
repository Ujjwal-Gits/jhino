import type { FastifyInstance } from 'fastify';
import { db, now, type UserRow } from './db.js';
import { HttpError, requireUser } from './auth.js';
import { audit, limit, securityEvent } from './security.js';
import { RESERVED, rootNameInUse } from './publicshare.js';
import { reservedReason } from './reserved.js';

/*
 * Usernames: the name in every address a person makes. jhino.com/<username> is their public page;
 * their apps and short links live at jhino.com/<username>/<name>. A username is not the full name:
 * it is unique, lowercase, and kept apart from Jhino's own words and the few top-level addresses.
 */

/** Words that would read as Jhino itself, on top of the paths the site uses. */
const MORE_RESERVED = new Set(['root', 'system', 'null', 'undefined', 'me', 'you', 'owner', 'staff', 'team', 'official', 'moderator', 'security',
  'sales', 'info', 'noreply', 'no-reply', 'hello', 'email', 'contact', 'jhinoapp', 'jhino-app', 'jhinohq', 'webmaster', 'postmaster', 'abuse',
  'billing', 'payment', 'pay', 'store', 'shop', 'api-docs', 'developer', 'developers', 'test', 'demo', 'example', 'undefined', 'anonymous']);

/**
 * A valid username. People choosing their own also stay off general words (faq, services, about-us…)
 * and anything that reads as Jhino; `byAdmin` lets a super admin give those.
 */
export function validUsername(v: unknown, byAdmin = false): string {
  const s = String(v ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/.test(s)) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Use 3 to 30 lowercase letters, numbers, dashes or underscores, starting and ending with a letter or number.');
  }
  if (/[-_]{2}/.test(s)) throw new HttpError(400, 'VALIDATION_FAILED', 'Use one dash or underscore at a time.');
  if (RESERVED.has(s)) throw new HttpError(400, 'USERNAME_RESERVED', `"${s}" is used by Jhino itself. Choose another username.`);
  if (!byAdmin) {
    if (MORE_RESERVED.has(s)) throw new HttpError(400, 'USERNAME_RESERVED', `"${s}" is kept by Jhino. Choose another username.`);
    const why = reservedReason(s);
    if (why) throw new HttpError(400, 'USERNAME_RESERVED', `"${s}" ${why}. Use your name or your studio's name.`);
  }
  return s;
}
export const usernameFree = (name: string, exceptUserId?: string) => !rootNameInUse(name, { userId: exceptUserId });
export function assertUsernameFree(name: string, exceptUserId?: string) {
  if (!usernameFree(name, exceptUserId)) throw new HttpError(409, 'USERNAME_TAKEN', `@${name} is taken. Try another.`);
}

/** A free username made from an email or a name: "sita.sharma@x.com" → "sitasharma", then "sitasharma2"… */
export function suggestUsername(from: string) {
  let base = String(from || '').toLowerCase().split('@')[0].normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
  if (base.length < 3) base = (base + 'studio').slice(0, 8);
  base = base.slice(0, 24);
  const ok = (s: string) => { try { validUsername(s); return usernameFree(s); } catch { return false; } };
  if (ok(base)) return base;
  for (let i = 2; i < 10_000; i++) { const s = `${base}${i}`; if (ok(s)) return s; }
  return `${base}${Date.now().toString(36)}`;
}

/** Give a username to everyone who can make apps and has none yet (older accounts, admin-made ones). */
export function ensureUsernames() {
  const rows = db.prepare("SELECT id, email, name FROM users WHERE username IS NULL AND kind='person' AND (created_by IS NULL OR is_admin=1)").all() as Pick<UserRow, 'id' | 'email' | 'name'>[];
  for (const u of rows) {
    const name = suggestUsername(/@/.test(u.email) ? u.email : u.email || u.name);
    db.prepare('UPDATE users SET username=? WHERE id=? AND username IS NULL').run(name, u.id);
  }
  return rows.length;
}

/** People change their own username once in 30 days; the old one is free for anyone at once. */
export const USERNAME_EVERY_DAYS = 30;
export function nextUsernameChange(u: UserRow): string | null {
  if (u.is_admin || !u.username_changed_at) return null;
  const next = new Date(Date.parse(u.username_changed_at) + USERNAME_EVERY_DAYS * 864e5);
  return next.getTime() > Date.now() ? next.toISOString() : null;
}

/** Set a username now (sign-up, admin-made accounts); falls back to a suggestion. */
export function assignUsername(userId: string, wanted: string | null | undefined, from: string, byAdmin = false) {
  let name: string;
  if (wanted) { name = validUsername(wanted, byAdmin); assertUsernameFree(name, userId); } else name = suggestUsername(from);
  db.prepare('UPDATE users SET username=? WHERE id=?').run(name, userId);
  return name;
}

export function registerUsernames(app: FastifyInstance) {
  /** Is a username free? Used by the sign-up form and Account, so it works signed out too. */
  app.get('/api/usernames/check', async (req) => {
    limit(req, 'username-check', 120, 60_000);
    const raw = String((req.query as { name?: string }).name ?? '');
    // A super admin (setting someone's name) may use general words; everyone else may not.
    const admin = (req.query as { admin?: string }).admin === '1' && !!req.user?.is_admin && !req.pub && !req.desk;
    let name: string;
    try { name = validUsername(raw, admin); } catch (e) { return { name: raw.toLowerCase(), available: false, reason: (e as Error).message }; }
    const me = req.user && !req.pub && !req.desk ? req.user.id : undefined;
    if (me && req.user?.username?.toLowerCase() === name) return { name, available: true, yours: true };
    return usernameFree(name, me) ? { name, available: true } : { name, available: false, reason: `@${name} is taken.` };
  });

  /** Change your username. Your page, apps and short links move with it; old addresses stop working. */
  app.put('/api/account/username', async (req) => {
    const u = requireUser(req);
    if (req.pub || req.desk) throw new HttpError(403, 'FORBIDDEN', 'Not here.');
    limit(req, 'username-change', 10, 24 * 3600_000, u.id);
    const name = validUsername((req.body as { username?: string })?.username);
    if (name === (u.username ?? '').toLowerCase()) return { username: name };
    const next = nextUsernameChange(u);
    if (next) {
      const days = Math.ceil((Date.parse(next) - Date.now()) / 864e5);
      throw new HttpError(429, 'USERNAME_COOLDOWN', `You can change your username once in ${USERNAME_EVERY_DAYS} days. You can change it again in ${days} day${days === 1 ? '' : 's'} (${next.slice(0, 10)}).`, { next });
    }
    assertUsernameFree(name, u.id);
    db.prepare('UPDATE users SET username=?, username_changed_at=? WHERE id=?').run(name, now(), u.id);
    securityEvent(u.id, 'username_changed', req, `${u.username ?? ''} → ${name}`);
    audit(req, 'user.username', 'user', u.id, `${u.username ?? ''} → ${name}`);
    return { username: name };
  });
}
