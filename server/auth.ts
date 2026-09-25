import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hash, verify } from '@node-rs/argon2';
import { config, makePassword } from './config.js';
import { db, newId, now, sha256, type UserRow } from './db.js';
import { closeUser } from './realtime.js';
import { HttpError } from './errors.js';
import { clientInfo, deviceName, limit, securityEvent, audit } from './security.js';
import { sendMail, mails } from './mail.js';
import { activePlan, featuresOf } from './plans.js';

export { HttpError };

export const COOKIE = 'jhino_sid';
// Sign in once: a session lasts 60 days and renews itself while it is used.
const SESSION_DAYS = 60;
const RENEW_BELOW_DAYS = 45;
// Sensitive changes without a password (accounts that sign in with Google/Apple only) need a sign-in this recent.
const REAUTH_MINUTES = 10;

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
    csrf: string | null;
    /** Set when the request comes from a downloaded HTML file (a key for this one app, not a cookie). */
    desk: string | null;
    /** Set when the request comes from a public or password link to one app (a visitor). */
    pub: string | null;
    /** Hash of this browser's session token (to tell "this device" apart). */
    sessionHash: string | null;
  }
}

export const hashPassword = (pw: string) => hash(pw);

/** Clients (sign-ins made from Share or joined by invite) and link visitors only open apps shared with them. */
export const canCreateApps = (u: UserRow) => u.kind !== 'visitor' && (!!u.is_admin || !u.created_by);
export function requireCreator(req: FastifyRequest): UserRow {
  const u = requireUser(req);
  if (!canCreateApps(u) || req.pub) throw new HttpError(403, 'FORBIDDEN', 'This account opens apps shared with it. Ask the owner if you need to add your own.');
  return u;
}

const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
export function publicUser(u: UserRow) {
  return {
    id: u.id, email: u.email, name: u.name, displayName: u.display_name || null,
    isAdmin: !!u.is_admin, disabled: !!u.disabled, canCreate: canCreateApps(u),
    emailIsAddress: looksLikeEmail(u.email), emailVerified: looksLikeEmail(u.email) ? !!u.email_verified_at : null,
    hasAvatar: !!u.avatar, passwordSet: u.password_set !== 0, plan: activePlan(u),
    // What the plan includes, so screens can show what is on and what needs an upgrade. The server checks again.
    features: canCreateApps(u) ? featuresOf(u) : null,
  };
}

export function requireUser(req: FastifyRequest): UserRow {
  if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in.');
  return req.user;
}
/** Super admin: the platform owners. */
export function requireAdmin(req: FastifyRequest): UserRow {
  const u = requireUser(req);
  if (!u.is_admin || req.pub || req.desk) throw new HttpError(403, 'FORBIDDEN', 'Only super admins can do this.');
  return u;
}

export function validatePassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'VALIDATION_FAILED', 'Use at least 10 characters for the password.');
  if (pw.length > 200) throw new HttpError(400, 'VALIDATION_FAILED', 'That password is too long.');
  return pw;
}
/** Sign-in ID: an email address or a simple ID such as "maya" or "maya.gurung". */
export function validateEmail(e: unknown): string {
  const s = String(e ?? '').trim();
  const email = /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(s);
  const id = /^[A-Za-z0-9][A-Za-z0-9._-]{2,59}$/.test(s);
  if (!email && !id) throw new HttpError(400, 'VALIDATION_FAILED', 'Use an email address, or a sign-in ID of 3 or more letters, numbers, dots, dashes or underscores.');
  return s;
}
/** A real email address (for sign-up and email changes). */
export function validateRealEmail(e: unknown): string {
  const s = String(e ?? '').trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s)) throw new HttpError(400, 'VALIDATION_FAILED', 'Enter a valid email address.');
  return s;
}
export function validateName(n: unknown): string {
  const s = String(n ?? '').trim();
  if (!s || s.length > 80) throw new HttpError(400, 'VALIDATION_FAILED', 'Enter a name up to 80 characters.');
  return s;
}

function setSessionCookie(reply: FastifyReply, token: string, expires: Date) {
  reply.setCookie(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, expires });
}
export function createSession(reply: FastifyReply, userId: string, req?: FastifyRequest) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  const c = req ? clientInfo(req) : { ip: null, ua: null };
  const t = now();
  db.prepare('INSERT INTO sessions(id_hash,user_id,csrf,created_at,expires_at,ip,ua,last_seen_at,auth_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(sha256(token), userId, crypto.randomBytes(24).toString('base64url'), t, expires.toISOString(), c.ip, c.ua, t, t);
  setSessionCookie(reply, token, expires);
  return sha256(token);
}

/** End sessions (and downloaded-file keys) of a person; keep the one given. */
export function revokeSessions(userId: string, keepHash: string | null = null, keys = true) {
  db.prepare('DELETE FROM sessions WHERE user_id=? AND id_hash IS NOT ?').run(userId, keepHash);
  if (keys) db.prepare('DELETE FROM app_keys WHERE user_id=?').run(userId);
  if (!keepHash) closeUser(userId);
}

export async function createUser(email: string, name: string, password: string, isAdmin = false, extra: { createdBy?: string | null; verified?: boolean; plan?: string; kind?: string } = {}): Promise<UserRow> {
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) {
    throw new HttpError(409, 'EMAIL_TAKEN', 'Someone already uses that email or sign-in ID here.');
  }
  const id = newId('u');
  const t = now();
  db.prepare('INSERT INTO users(id,email,name,password_hash,is_admin,created_at,created_by,email_verified_at,plan,plan_started_at,kind,password_changed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, email, name, await hashPassword(password), isAdmin ? 1 : 0, t, extra.createdBy ?? null, extra.verified ? t : null, extra.plan ?? 'free', t, extra.kind ?? 'person', t);
  return db.prepare('SELECT * FROM users WHERE id=?').get(id) as UserRow;
}

/** First start: create the admin from .env if there are no users. Later starts never change it. */
export async function bootstrapAdmin() {
  const n = (db.prepare("SELECT COUNT(*) n FROM users WHERE kind='person'").get() as { n: number }).n;
  if (n > 0) return;
  const password = config.admin.password || makePassword();
  await createUser(config.admin.email, config.admin.name, password, true, { verified: true });
  console.log(`  Admin account ready: ${config.admin.email}`);
  if (!config.admin.password) console.log(`  Generated admin password (shown once, change it after signing in): ${password}`);
}

// Sign-in throttle: after 5 misses for one ID from one address, wait (longer with each miss).
const misses = new Map<string, { n: number; until: number }>();
function throttleKey(req: FastifyRequest, email: string) { return `${req.ip}|${email.toLowerCase()}`; }
setInterval(() => { const t = Date.now(); for (const [k, v] of misses) if (v.until && v.until < t - 3600e3) misses.delete(k); }, 600_000).unref();

/** Check a sign-in ID and password, with the throttle. Used by the web sign-in and by downloaded files. */
export async function checkLogin(req: FastifyRequest, emailIn: unknown, password: unknown): Promise<UserRow> {
  const email = String(emailIn ?? '').trim();
  limit(req, 'login', 40, 15 * 60_000); // across all IDs from one address
  const key = throttleKey(req, email);
  const m = misses.get(key);
  if (m && m.until > Date.now()) {
    throw new HttpError(429, 'TOO_MANY_ATTEMPTS', `Too many tries. Wait ${Math.ceil((m.until - Date.now()) / 1000)} seconds.`);
  }
  const u = db.prepare("SELECT * FROM users WHERE email=? AND kind='person'").get(email) as UserRow | undefined;
  const ok = u && u.password_set !== 0 && await verify(u.password_hash, String(password ?? ''));
  if (!ok) {
    const n = (m?.n ?? 0) + 1;
    misses.set(key, { n, until: n >= 5 ? Date.now() + Math.min(15 * 60, 2 ** (n - 4) * 15) * 1000 : 0 });
    if (u) securityEvent(u.id, 'login_failed', req);
    throw new HttpError(401, 'BAD_LOGIN', u && u.password_set === 0 ? 'This account signs in with Google or Apple. Use that button, or reset your password to add one.' : 'That sign-in ID and password do not match.');
  }
  misses.delete(key);
  if (u!.disabled) throw new HttpError(403, 'SUSPENDED', `This account is suspended${u!.suspended_reason ? ': ' + u!.suspended_reason : ''}. Contact support if you think this is a mistake.`);
  return u!;
}

/** After any successful sign-in: remember it, and email the person when it is a device we have not seen. */
export function afterLogin(req: FastifyRequest, u: UserRow, how = 'password') {
  const c = clientInfo(req);
  const seen = db.prepare("SELECT 1 FROM security_events WHERE user_id=? AND kind='login' AND ua=? LIMIT 1").get(u.id, c.ua);
  const first = !db.prepare("SELECT 1 FROM security_events WHERE user_id=? AND kind='login' LIMIT 1").get(u.id);
  db.prepare('UPDATE users SET last_login_at=?, last_login_ip=?, last_login_ua=? WHERE id=?').run(now(), c.ip, c.ua, u.id);
  securityEvent(u.id, 'login', req, how);
  if (!seen && !first) sendMail(u.email, 'new_login', mails.newLogin(u.name, deviceName(c.ua), c.country ?? '', new Date().toUTCString()));
}

/**
 * Sensitive changes (password, email, deleting the account) ask again: the password, or for accounts
 * without one, a sign-in in the last few minutes.
 */
export async function reauth(req: FastifyRequest, password: unknown) {
  const u = requireUser(req);
  limit(req, 'reauth', 10, 15 * 60_000, u.id);
  if (u.password_set !== 0) {
    if (!await verify(u.password_hash, String(password ?? ''))) {
      securityEvent(u.id, 'reauth_failed', req);
      throw new HttpError(400, 'BAD_PASSWORD', 'Your current password is not right.');
    }
    if (req.sessionHash) db.prepare('UPDATE sessions SET auth_at=? WHERE id_hash=?').run(now(), req.sessionHash);
    return u;
  }
  const s = req.sessionHash ? db.prepare('SELECT auth_at FROM sessions WHERE id_hash=?').get(req.sessionHash) as { auth_at: string | null } | undefined : undefined;
  if (!s?.auth_at || Date.parse(s.auth_at) < Date.now() - REAUTH_MINUTES * 60_000) {
    throw new HttpError(401, 'REAUTH_REQUIRED', 'For your security, sign in again, then try this within 10 minutes.');
  }
  return u;
}

setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()), 3600_000).unref();

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('user', null);
  app.decorateRequest('csrf', null);
  app.decorateRequest('desk', null);
  app.decorateRequest('pub', null);
  app.decorateRequest('sessionHash', null);

  app.addHook('onRequest', async (req, reply) => {
    const token = req.cookies?.[COOKIE];
    if (!token) return;
    const h = sha256(token);
    const s = db.prepare(`SELECT s.csrf, s.expires_at, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=?`)
      .get(h) as (UserRow & { csrf: string; expires_at: string; last_seen_at: string | null }) | undefined;
    if (!s || s.disabled || s.kind === 'visitor' || Date.parse(s.expires_at) < Date.now()) return;
    const { csrf, expires_at: exp, last_seen_at: seen, ...user } = s;
    req.user = user as UserRow;
    req.csrf = csrf;
    req.sessionHash = h;
    if (!seen || Date.parse(seen) < Date.now() - 5 * 60_000) db.prepare('UPDATE sessions SET last_seen_at=?, ip=? WHERE id_hash=?').run(now(), req.ip, h);
    // Still in use: keep it going, so people who come back stay signed in.
    if (Date.parse(exp) - Date.now() < RENEW_BELOW_DAYS * 864e5) {
      const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
      db.prepare('UPDATE sessions SET expires_at=? WHERE id_hash=?').run(expires.toISOString(), h);
      setSessionCookie(reply, token, expires);
    }
  });

  // Every state-changing API call needs the custom header (forces a CORS
  // preflight from other sites) and, once signed in, the session's CSRF token.
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    // Apple posts the sign-in result from its own site; that callback is protected by its single-use state and cookie.
    if (req.method === 'POST' && /^\/api\/auth\/oauth\/(google|apple)\/callback(\?|$)/.test(req.url)) return;
    if (req.headers['x-jhino'] !== '1') throw new HttpError(403, 'CSRF', 'Request blocked.');
    // A downloaded file sends its key in a header, which a browser never adds by itself; a link visitor's cookie
    // is same-site only and paired with the custom header above: no CSRF token needed for either.
    if (req.user && !req.desk && !req.pub && req.headers['x-csrf-token'] !== req.csrf) throw new HttpError(403, 'CSRF', 'Your session changed. Reload the page.');
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    const u = await checkLogin(req, body.email, body.password);
    createSession(reply, u.id, req);
    afterLogin(req, u);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE id_hash=?').run(sha256(token));
    if (req.user && !req.pub) securityEvent(req.user.id, 'logout', req);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    if (!req.user || req.pub || req.desk) return { user: null };
    return { user: publicUser(req.user), csrf: req.csrf };
  });

  /** Kept for older clients: name and password. The Account Center uses /api/account. */
  app.patch('/api/me', async (req) => {
    const u = requireUser(req);
    const b = (req.body ?? {}) as { name?: string; currentPassword?: string; newPassword?: string };
    if (b.name !== undefined) db.prepare('UPDATE users SET name=? WHERE id=?').run(validateName(b.name), u.id);
    if (b.newPassword !== undefined) {
      await reauth(req, b.currentPassword);
      db.prepare('UPDATE users SET password_hash=?, password_set=1, password_changed_at=? WHERE id=?').run(await hashPassword(validatePassword(b.newPassword)), now(), u.id);
      revokeSessions(u.id, req.sessionHash);
      securityEvent(u.id, 'password_changed', req);
    }
    return { ok: true };
  });

  /* ---------- people (super admin; the Super Admin dashboard uses /api/admin) ---------- */
  app.get('/api/users', async (req) => {
    requireAdmin(req);
    const rows = db.prepare("SELECT * FROM users WHERE kind='person' ORDER BY created_at").all() as UserRow[];
    return { users: rows.map(publicUser) };
  });

  app.post('/api/users', async (req) => {
    requireAdmin(req);
    const b = (req.body ?? {}) as { email?: string; name?: string; isAdmin?: boolean };
    const password = makePassword(12);
    const u = await createUser(validateEmail(b.email), validateName(b.name), password, !!b.isAdmin, { verified: true });
    audit(req, 'user.create', 'user', u.id, `${u.email}${b.isAdmin ? ' as super admin' : ''}`);
    return { user: publicUser(u), password };
  });

  app.patch('/api/users/:id', async (req) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { name?: string; isAdmin?: boolean; disabled?: boolean; resetPassword?: boolean };
    const u = db.prepare("SELECT * FROM users WHERE id=? AND kind='person'").get(id) as UserRow | undefined;
    if (!u) throw new HttpError(404, 'NOT_FOUND', 'That person does not exist.');
    if (id === admin.id && (b.isAdmin === false || b.disabled)) throw new HttpError(400, 'VALIDATION_FAILED', 'You cannot remove your own admin access.');
    if (b.name !== undefined) db.prepare('UPDATE users SET name=? WHERE id=?').run(validateName(b.name), id);
    if (b.isAdmin !== undefined) { db.prepare('UPDATE users SET is_admin=? WHERE id=?').run(b.isAdmin ? 1 : 0, id); audit(req, b.isAdmin ? 'user.make_super_admin' : 'user.remove_super_admin', 'user', id, u.email); }
    if (b.disabled !== undefined) {
      db.prepare('UPDATE users SET disabled=? WHERE id=?').run(b.disabled ? 1 : 0, id);
      if (b.disabled) revokeSessions(id);
      audit(req, b.disabled ? 'user.suspend' : 'user.reactivate', 'user', id, u.email);
    }
    let password: string | undefined;
    if (b.resetPassword) {
      password = makePassword(12);
      db.prepare('UPDATE users SET password_hash=?, password_set=1, password_changed_at=? WHERE id=?').run(await hashPassword(password), now(), id);
      revokeSessions(id);
      audit(req, 'user.reset_password', 'user', id, u.email);
    }
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id) as UserRow), password };
  });
}
