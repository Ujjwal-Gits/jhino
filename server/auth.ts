import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hash, verify } from '@node-rs/argon2';
import { config, makePassword } from './config.js';
import { db, newId, now, sha256, type UserRow } from './db.js';
import { closeUser } from './realtime.js';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

const COOKIE = 'jhino_sid';
// Sign in once: a session lasts 60 days and renews itself while it is used.
const SESSION_DAYS = 60;
const RENEW_BELOW_DAYS = 45;

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
    csrf: string | null;
    /** Set when the request comes from a downloaded HTML file (a key for this one app, not a cookie). */
    desk: string | null;
  }
}

export const hashPassword = (pw: string) => hash(pw);

/** Clients (sign-ins made from Share or joined by invite) only open apps shared with them. */
export const canCreateApps = (u: UserRow) => !!u.is_admin || !(u as UserRow & { created_by?: string | null }).created_by;
export function requireCreator(req: FastifyRequest): UserRow {
  const u = requireUser(req);
  if (!canCreateApps(u)) throw new HttpError(403, 'FORBIDDEN', 'This account opens apps shared with it. Ask the owner if you need to add your own.');
  return u;
}

export function publicUser(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name, isAdmin: !!u.is_admin, disabled: !!u.disabled, canCreate: canCreateApps(u) };
}

export function requireUser(req: FastifyRequest): UserRow {
  if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in.');
  return req.user;
}
export function requireAdmin(req: FastifyRequest): UserRow {
  const u = requireUser(req);
  if (!u.is_admin) throw new HttpError(403, 'FORBIDDEN', 'Only admins can do this.');
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
export function validateName(n: unknown): string {
  const s = String(n ?? '').trim();
  if (!s || s.length > 80) throw new HttpError(400, 'VALIDATION_FAILED', 'Enter a name up to 80 characters.');
  return s;
}

function setSessionCookie(reply: FastifyReply, token: string, expires: Date) {
  reply.setCookie(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, expires });
}
export function createSession(reply: FastifyReply, userId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare('INSERT INTO sessions(id_hash,user_id,csrf,created_at,expires_at) VALUES(?,?,?,?,?)')
    .run(sha256(token), userId, crypto.randomBytes(24).toString('base64url'), now(), expires.toISOString());
  setSessionCookie(reply, token, expires);
}

export async function createUser(email: string, name: string, password: string, isAdmin = false): Promise<UserRow> {
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) {
    throw new HttpError(409, 'EMAIL_TAKEN', 'Someone already uses that email here.');
  }
  const id = newId('u');
  db.prepare('INSERT INTO users(id,email,name,password_hash,is_admin,created_at) VALUES(?,?,?,?,?,?)')
    .run(id, email, name, await hashPassword(password), isAdmin ? 1 : 0, now());
  return db.prepare('SELECT * FROM users WHERE id=?').get(id) as UserRow;
}

/** First start: create the admin from .env if there are no users. */
export async function bootstrapAdmin() {
  const n = (db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n;
  if (n > 0) return;
  const password = config.admin.password || makePassword();
  await createUser(config.admin.email, config.admin.name, password, true);
  console.log(`  Admin account ready: ${config.admin.email}`);
  if (!config.admin.password) console.log(`  Generated admin password (shown once, change it after signing in): ${password}`);
}

// Simple login throttle: after 5 misses, wait (grows with each miss).
const misses = new Map<string, { n: number; until: number }>();
function throttleKey(req: FastifyRequest, email: string) { return `${req.ip}|${email.toLowerCase()}`; }

/** Check a sign-in ID and password, with the throttle. Used by the web sign-in and by downloaded files. */
export async function checkLogin(req: FastifyRequest, emailIn: unknown, password: unknown): Promise<UserRow> {
  const email = String(emailIn ?? '').trim();
  const key = throttleKey(req, email);
  const m = misses.get(key);
  if (m && m.until > Date.now()) {
    throw new HttpError(429, 'TOO_MANY_ATTEMPTS', `Too many tries. Wait ${Math.ceil((m.until - Date.now()) / 1000)} seconds.`);
  }
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email) as UserRow | undefined;
  const ok = u && !u.disabled && await verify(u.password_hash, String(password ?? ''));
  if (!ok) {
    const n = (m?.n ?? 0) + 1;
    misses.set(key, { n, until: n >= 5 ? Date.now() + Math.min(15 * 60, 2 ** (n - 4) * 15) * 1000 : 0 });
    throw new HttpError(401, 'BAD_LOGIN', 'That sign-in ID and password do not match.');
  }
  misses.delete(key);
  return u!;
}

setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()), 3600_000).unref();

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('user', null);
  app.decorateRequest('csrf', null);
  app.decorateRequest('desk', null);

  app.addHook('onRequest', async (req, reply) => {
    const token = req.cookies?.[COOKIE];
    if (!token) return;
    const s = db.prepare(`SELECT s.csrf, s.expires_at, u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=?`)
      .get(sha256(token)) as (UserRow & { csrf: string; expires_at: string }) | undefined;
    if (!s || s.disabled || Date.parse(s.expires_at) < Date.now()) return;
    const { csrf, expires_at: exp, ...user } = s;
    req.user = user as UserRow;
    req.csrf = csrf;
    // Still in use: keep it going, so people who come back stay signed in.
    if (Date.parse(exp) - Date.now() < RENEW_BELOW_DAYS * 864e5) {
      const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
      db.prepare('UPDATE sessions SET expires_at=? WHERE id_hash=?').run(expires.toISOString(), sha256(token));
      setSessionCookie(reply, token, expires);
    }
  });

  // Every state-changing API call needs the custom header (forces a CORS
  // preflight from other sites) and, once signed in, the session's CSRF token.
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    if (req.headers['x-jhino'] !== '1') throw new HttpError(403, 'CSRF', 'Request blocked.');
    // A downloaded file sends its key in a header, which a browser never adds by itself: no CSRF token needed.
    if (req.user && !req.desk && req.headers['x-csrf-token'] !== req.csrf) throw new HttpError(403, 'CSRF', 'Your session changed. Reload the page.');
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    const u = await checkLogin(req, body.email, body.password);
    createSession(reply, u.id);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE id_hash=?').run(sha256(token));
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    if (!req.user) return { user: null };
    return { user: publicUser(req.user), csrf: req.csrf };
  });

  app.patch('/api/me', async (req) => {
    const u = requireUser(req);
    const b = (req.body ?? {}) as { name?: string; currentPassword?: string; newPassword?: string };
    if (b.name !== undefined) db.prepare('UPDATE users SET name=? WHERE id=?').run(validateName(b.name), u.id);
    if (b.newPassword !== undefined) {
      if (!await verify(u.password_hash, String(b.currentPassword ?? ''))) throw new HttpError(400, 'BAD_PASSWORD', 'Your current password is not right.');
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await hashPassword(validatePassword(b.newPassword)), u.id);
      // Sign out every other device, and every downloaded file.
      db.prepare('DELETE FROM sessions WHERE user_id=? AND id_hash<>?').run(u.id, sha256(req.cookies?.[COOKIE] ?? ''));
      db.prepare('DELETE FROM app_keys WHERE user_id=?').run(u.id);
    }
    return { ok: true };
  });

  /* ---------- people (admin) ---------- */
  app.get('/api/users', async (req) => {
    requireAdmin(req);
    const rows = db.prepare('SELECT * FROM users ORDER BY created_at').all() as UserRow[];
    return { users: rows.map(publicUser) };
  });

  app.post('/api/users', async (req) => {
    requireAdmin(req);
    const b = (req.body ?? {}) as { email?: string; name?: string; isAdmin?: boolean };
    const password = makePassword(12);
    const u = await createUser(validateEmail(b.email), validateName(b.name), password, !!b.isAdmin);
    return { user: publicUser(u), password };
  });

  app.patch('/api/users/:id', async (req) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { name?: string; isAdmin?: boolean; disabled?: boolean; resetPassword?: boolean };
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(id) as UserRow | undefined;
    if (!u) throw new HttpError(404, 'NOT_FOUND', 'That person does not exist.');
    if (id === admin.id && (b.isAdmin === false || b.disabled)) throw new HttpError(400, 'VALIDATION_FAILED', 'You cannot remove your own admin access.');
    if (b.name !== undefined) db.prepare('UPDATE users SET name=? WHERE id=?').run(validateName(b.name), id);
    if (b.isAdmin !== undefined) db.prepare('UPDATE users SET is_admin=? WHERE id=?').run(b.isAdmin ? 1 : 0, id);
    if (b.disabled !== undefined) {
      db.prepare('UPDATE users SET disabled=? WHERE id=?').run(b.disabled ? 1 : 0, id);
      if (b.disabled) { db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); db.prepare('DELETE FROM app_keys WHERE user_id=?').run(id); closeUser(id); }
    }
    let password: string | undefined;
    if (b.resetPassword) {
      password = makePassword(12);
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await hashPassword(password), id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      db.prepare('DELETE FROM app_keys WHERE user_id=?').run(id);
      closeUser(id);
    }
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id) as UserRow), password };
  });
}
