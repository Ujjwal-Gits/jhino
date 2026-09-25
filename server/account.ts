import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { db, newId, now, sha256, type UserRow } from './db.js';
import {
  HttpError, afterLogin, canCreateApps, createSession, createUser, hashPassword, publicUser, reauth, requireUser,
  revokeSessions, validateName, validatePassword, validateRealEmail,
} from './auth.js';
import { baseUrl, mailReady, mails, sendMail } from './mail.js';
import { clientInfo, deviceName, imageType, limit, maskIp, securityEvent, setting, audit } from './security.js';
import { ESSENTIAL, notifyAdmins, prefsOf, usage, type Category } from './plans.js';
import { closeUser } from './realtime.js';

/* ---------------- single-use links ---------------- */
type Purpose = 'verify' | 'reset' | 'email_change';
function makeToken(userId: string, purpose: Purpose, hours: number, data: string | null = null) {
  // A new link replaces older unused ones for the same purpose.
  db.prepare('DELETE FROM auth_tokens WHERE user_id=? AND purpose=? AND used_at IS NULL').run(userId, purpose);
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO auth_tokens(token_hash,user_id,purpose,data,created_at,expires_at) VALUES(?,?,?,?,?,?)')
    .run(sha256(token), userId, purpose, data, now(), new Date(Date.now() + hours * 3600e3).toISOString());
  return token;
}
function useToken(token: unknown, purposes: Purpose[]) {
  const t = String(token ?? '');
  if (!/^[\w-]{20,100}$/.test(t)) throw new HttpError(400, 'TOKEN_INVALID', 'This link is not valid. Ask for a new one.');
  const row = db.prepare('SELECT * FROM auth_tokens WHERE token_hash=?').get(sha256(t)) as { token_hash: string; user_id: string; purpose: Purpose; data: string | null; expires_at: string; used_at: string | null } | undefined;
  if (!row || !purposes.includes(row.purpose)) throw new HttpError(400, 'TOKEN_INVALID', 'This link is not valid. Ask for a new one.');
  if (row.used_at) throw new HttpError(400, 'TOKEN_USED', 'This link was already used. Ask for a new one if you need it.');
  if (Date.parse(row.expires_at) < Date.now()) throw new HttpError(400, 'TOKEN_EXPIRED', 'This link has expired. Ask for a new one.');
  // Only one request can use it.
  if (!db.prepare('UPDATE auth_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL').run(now(), row.token_hash).changes) {
    throw new HttpError(400, 'TOKEN_USED', 'This link was already used.');
  }
  return row;
}
setInterval(() => db.prepare('DELETE FROM auth_tokens WHERE expires_at < ?').run(new Date(Date.now() - 7 * 864e5).toISOString()), 6 * 3600e3).unref();

export function sendVerification(req: FastifyRequest | null, u: UserRow) {
  const token = makeToken(u.id, 'verify', 48);
  sendMail(u.email, 'verify', mails.verify(u.name, `${baseUrl(req)}/verify?token=${token}`));
}

/* ---------------- avatars ---------------- */
const avatarDir = () => path.join(config.dataDir, 'system', 'avatars');
function removeAvatar(u: Pick<UserRow, 'avatar'>) {
  if (u.avatar && /^[\w.-]+$/.test(u.avatar)) fs.rmSync(path.join(avatarDir(), u.avatar), { force: true });
}

/* ---------------- profile fields ---------------- */
const text = (v: unknown, max: number, label: string) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new HttpError(400, 'VALIDATION_FAILED', `${label} can be up to ${max} characters.`);
  return s || null;
};
function validTimezone(tz: unknown) {
  const s = String(tz ?? '').trim();
  if (!s) return null;
  try { new Intl.DateTimeFormat('en', { timeZone: s }); return s; } catch { throw new HttpError(400, 'VALIDATION_FAILED', 'Choose a time zone from the list.'); }
}

function accountView(req: FastifyRequest, u: UserRow) {
  const pending = db.prepare("SELECT data, expires_at FROM auth_tokens WHERE user_id=? AND purpose='email_change' AND used_at IS NULL AND expires_at > ?").get(u.id, now()) as { data: string; expires_at: string } | undefined;
  return {
    user: publicUser(u),
    profile: {
      name: u.name, displayName: u.display_name ?? '', email: u.email, phone: u.phone ?? '', country: u.country ?? '', timezone: u.timezone ?? '',
      language: u.language ?? 'en', company: u.company ?? '', jobTitle: u.job_title ?? '', bio: u.bio ?? '',
    },
    account: {
      id: u.id, status: u.disabled ? 'suspended' : 'active', createdAt: u.created_at,
      lastLogin: u.last_login_at ? { at: u.last_login_at, device: deviceName(u.last_login_ua), ip: maskIp(u.last_login_ip) } : null,
      emailVerifiedAt: u.email_verified_at ?? null, pendingEmail: pending?.data ?? null, passwordChangedAt: u.password_changed_at ?? null,
      kind: u.is_admin ? 'super_admin' : canCreateApps(u) ? 'creator' : 'client',
    },
    usage: canCreateApps(u) ? usage(u) : null,
    identities: db.prepare('SELECT provider, email, created_at createdAt FROM identities WHERE user_id=?').all(u.id),
    providers: { google: !!(config.oauth.google.clientId && config.oauth.google.clientSecret), apple: !!(config.oauth.apple.clientId && config.oauth.apple.privateKey) },
    prefs: prefsOf(u),
    essential: ESSENTIAL,
    mailReady: mailReady(),
  };
}


/** Remove an account with its apps, their data and files, and the client sign-ins it made (unless shared). */
export function deleteAccount(u: UserRow) {
  const owned = db.prepare('SELECT id FROM apps WHERE owner_id=?').all(u.id) as { id: string }[];
  const clients = db.prepare("SELECT id FROM users WHERE created_by=? AND is_admin=0 AND kind='person'").all(u.id) as { id: string }[];
  db.transaction(() => {
    for (const a of owned) {
      const v = db.prepare('SELECT visitor_id FROM apps WHERE id=?').get(a.id) as { visitor_id: string | null };
      db.prepare('DELETE FROM apps WHERE id=?').run(a.id);
      if (v?.visitor_id) db.prepare('DELETE FROM users WHERE id=?').run(v.visitor_id);
    }
    // Sign-ins this person made for their clients go too, unless another owner still uses them.
    for (const c of clients) {
      if (!db.prepare('SELECT 1 FROM memberships WHERE user_id=? LIMIT 1').get(c.id)) db.prepare('DELETE FROM users WHERE id=?').run(c.id);
      else db.prepare('UPDATE users SET created_by=NULL WHERE id=?').run(c.id);
    }
    db.prepare('DELETE FROM memberships WHERE user_id=?').run(u.id);
    db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  })();
  for (const a of owned) {
    fs.rmSync(path.join(config.dataDir, 'apps', a.id), { recursive: true, force: true });
    fs.rmSync(path.join(config.dataDir, 'files', a.id), { recursive: true, force: true });
  }
  removeAvatar(u);
  closeUser(u.id);
  return owned;
}

export function registerAccount(app: FastifyInstance) {
  /** What the sign-in page can offer. */
  app.get('/api/auth/options', async () => ({
    signups: setting('signups') === 'on',
    google: !!(config.oauth.google.clientId && config.oauth.google.clientSecret),
    apple: !!(config.oauth.apple.clientId && config.oauth.apple.privateKey),
  }));

  /* ---------- create account ---------- */
  app.post('/api/auth/signup', async (req, reply) => {
    if (setting('signups') !== 'on') throw new HttpError(403, 'SIGNUPS_CLOSED', 'New accounts are not open right now.');
    limit(req, 'signup', 5, 3600_000);
    const b = (req.body ?? {}) as { name?: string; email?: string; password?: string; terms?: boolean };
    if (b.terms !== true) throw new HttpError(400, 'VALIDATION_FAILED', 'Please accept the Terms of Service and Privacy Policy.');
    const email = validateRealEmail(b.email);
    const name = validateName(b.name);
    const password = validatePassword(b.password);
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Sign in, or reset your password.');
    const u = await createUser(email, name, password, false, { plan: 'free' });
    createSession(reply, u.id, req);
    afterLogin(req, u, 'signup');
    sendVerification(req, u);
    return { ok: true };
  });

  /* ---------- confirm email (new account, or a changed email) ---------- */
  app.post('/api/auth/verify', async (req) => {
    limit(req, 'verify', 20, 15 * 60_000);
    const row = useToken((req.body as { token?: string })?.token, ['verify', 'email_change']);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id) as UserRow | undefined;
    if (!u) throw new HttpError(400, 'TOKEN_INVALID', 'This link is not valid.');
    if (row.purpose === 'verify') {
      db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(now(), u.id);
      securityEvent(u.id, 'email_verified', req);
      return { ok: true, kind: 'verify' };
    }
    const next = String(row.data ?? '');
    if (db.prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(next, u.id)) throw new HttpError(409, 'EMAIL_TAKEN', 'Another account uses that email now.');
    db.prepare('UPDATE users SET email=?, email_verified_at=? WHERE id=?').run(next, now(), u.id);
    securityEvent(u.id, 'email_changed', req, `${u.email} → ${next}`);
    sendMail(u.email, 'email_changed', mails.emailChanged(u.name, next));
    sendMail(next, 'email_changed', mails.emailChanged(u.name, next));
    return { ok: true, kind: 'email_change', email: next };
  });

  app.post('/api/account/verify/resend', async (req) => {
    const u = requireUser(req);
    limit(req, 'verify-resend', 3, 3600_000, u.id);
    if (u.email_verified_at) return { ok: true, already: true };
    if (!/@/.test(u.email)) throw new HttpError(400, 'VALIDATION_FAILED', 'Your sign-in ID is not an email address. Add an email in Account first.');
    sendVerification(req, u);
    return { ok: true };
  });

  /* ---------- forgot / reset password ---------- */
  app.post('/api/auth/forgot', async (req) => {
    limit(req, 'forgot', 5, 15 * 60_000);
    const email = String((req.body as { email?: string })?.email ?? '').trim();
    const u = email ? db.prepare("SELECT * FROM users WHERE email=? AND kind='person' AND disabled=0").get(email) as UserRow | undefined : undefined;
    if (u && /@/.test(u.email)) {
      limit(req, 'forgot-user', 3, 3600_000, u.id);
      const token = makeToken(u.id, 'reset', 0.5);
      sendMail(u.email, 'reset', mails.reset(u.name, `${baseUrl(req)}/reset?token=${token}`));
      securityEvent(u.id, 'reset_requested', req);
    }
    // The same answer either way, so this cannot be used to find out who has an account.
    return { ok: true };
  });

  app.post('/api/auth/reset', async (req) => {
    limit(req, 'reset', 10, 15 * 60_000);
    const b = (req.body ?? {}) as { token?: string; password?: string };
    const password = validatePassword(b.password);
    const row = useToken(b.token, ['reset']);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id) as UserRow | undefined;
    if (!u) throw new HttpError(400, 'TOKEN_INVALID', 'This link is not valid.');
    db.prepare('UPDATE users SET password_hash=?, password_set=1, password_changed_at=?, email_verified_at=COALESCE(email_verified_at, ?) WHERE id=?')
      .run(await hashPassword(password), now(), now(), u.id);
    revokeSessions(u.id);
    securityEvent(u.id, 'password_reset', req);
    sendMail(u.email, 'password_changed', mails.passwordChanged(u.name, deviceName(clientInfo(req).ua), `${baseUrl(req)}/forgot`));
    return { ok: true };
  });

  /* ---------- the account ---------- */
  app.get('/api/account', async (req) => {
    const u = requireUser(req);
    if (req.pub || req.desk) throw new HttpError(403, 'FORBIDDEN', 'Sign in to see your account.');
    return accountView(req, u);
  });

  app.patch('/api/account/profile', async (req) => {
    const u = requireUser(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const phone = text(b.phone, 30, 'Phone');
    if (phone && !/^[+0-9 ()-]{5,30}$/.test(phone)) throw new HttpError(400, 'VALIDATION_FAILED', 'Enter the phone number with digits, spaces, +, - or brackets.');
    const country = text(b.country, 2, 'Country');
    if (country && !/^[A-Z]{2}$/.test(country)) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose a country from the list.');
    const language = b.language === 'ne' ? 'ne' : 'en';
    db.prepare(`UPDATE users SET name=?, display_name=?, phone=?, country=?, timezone=?, language=?, company=?, job_title=?, bio=? WHERE id=?`).run(
      validateName(b.name), text(b.displayName, 60, 'Display name'), phone, country, validTimezone(b.timezone), language,
      text(b.company, 100, 'Company'), text(b.jobTitle, 80, 'Job title'), text(b.bio, 500, 'Bio'), u.id);
    return accountView(req, db.prepare('SELECT * FROM users WHERE id=?').get(u.id) as UserRow);
  });

  app.post('/api/account/avatar', async (req) => {
    const u = requireUser(req);
    limit(req, 'avatar', 20, 3600_000, u.id);
    const part = await req.file({ limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 } });
    if (!part) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose a photo.');
    const buf = await part.toBuffer();
    if (part.file.truncated) throw new HttpError(413, 'TOO_LARGE', 'Use a photo up to 2 MB.');
    const type = imageType(buf);
    if (!type) throw new HttpError(400, 'VALIDATION_FAILED', 'Use a JPG, PNG or WEBP photo.');
    const name = `${u.id}-${crypto.randomBytes(6).toString('hex')}.${type.split('/')[1].replace('jpeg', 'jpg')}`;
    fs.writeFileSync(path.join(avatarDir(), name), buf, { flag: 'wx' });
    removeAvatar(u);
    db.prepare('UPDATE users SET avatar=? WHERE id=?').run(name, u.id);
    return { ok: true };
  });
  app.delete('/api/account/avatar', async (req) => {
    const u = requireUser(req);
    removeAvatar(u);
    db.prepare('UPDATE users SET avatar=NULL WHERE id=?').run(u.id);
    return { ok: true };
  });
  /** A person's photo: for themselves, super admins, and people who share an app with them. */
  app.get('/api/users/:id/avatar', async (req, reply) => {
    const me = requireUser(req);
    const { id } = req.params as { id: string };
    const shares = me.id === id || me.is_admin || db.prepare('SELECT 1 FROM memberships a JOIN memberships b ON a.app_id=b.app_id WHERE a.user_id=? AND b.user_id=? LIMIT 1').get(me.id, id);
    const u = db.prepare('SELECT avatar FROM users WHERE id=?').get(id) as { avatar: string | null } | undefined;
    if (!shares || !u?.avatar || !/^[\w.-]+$/.test(u.avatar)) throw new HttpError(404, 'NOT_FOUND', 'No photo.');
    const file = path.join(avatarDir(), u.avatar);
    if (!fs.existsSync(file)) throw new HttpError(404, 'NOT_FOUND', 'No photo.');
    const type = u.avatar.endsWith('.png') ? 'image/png' : u.avatar.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    reply.header('Cache-Control', 'private, max-age=300').header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "sandbox; default-src 'none'");
    return reply.type(type).send(fs.readFileSync(file));
  });

  /* ---------- password and email ---------- */
  app.post('/api/account/password', async (req) => {
    const u = requireUser(req);
    const b = (req.body ?? {}) as { current?: string; next?: string };
    const next = validatePassword(b.next);
    await reauth(req, b.current);
    db.prepare('UPDATE users SET password_hash=?, password_set=1, password_changed_at=? WHERE id=?').run(await hashPassword(next), now(), u.id);
    revokeSessions(u.id, req.sessionHash);
    securityEvent(u.id, 'password_changed', req);
    sendMail(u.email, 'password_changed', mails.passwordChanged(u.name, deviceName(clientInfo(req).ua), `${baseUrl(req)}/forgot`));
    return { ok: true };
  });

  app.post('/api/account/email', async (req) => {
    const u = requireUser(req);
    const b = (req.body ?? {}) as { email?: string; password?: string };
    const email = validateRealEmail(b.email);
    await reauth(req, b.password);
    limit(req, 'email-change', 5, 3600_000, u.id);
    if (email === u.email.toLowerCase()) throw new HttpError(400, 'VALIDATION_FAILED', 'That is already your email.');
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new HttpError(409, 'EMAIL_TAKEN', 'Another account uses that email.');
    const token = makeToken(u.id, 'email_change', 48, email);
    sendMail(email, 'email_change', mails.emailChangeConfirm(u.name, `${baseUrl(req)}/verify?token=${token}`));
    sendMail(u.email, 'email_change_requested', mails.emailChangeRequested(u.name, email));
    securityEvent(u.id, 'email_change_requested', req, email);
    return { ok: true, pendingEmail: email };
  });
  app.delete('/api/account/email/pending', async (req) => {
    const u = requireUser(req);
    db.prepare("DELETE FROM auth_tokens WHERE user_id=? AND purpose='email_change' AND used_at IS NULL").run(u.id);
    return { ok: true };
  });

  /* ---------- sessions and security activity ---------- */
  app.get('/api/account/sessions', async (req) => {
    const u = requireUser(req);
    const rows = db.prepare('SELECT id_hash, ip, ua, created_at, last_seen_at FROM sessions WHERE user_id=? AND expires_at > ? ORDER BY COALESCE(last_seen_at, created_at) DESC').all(u.id, now()) as { id_hash: string; ip: string | null; ua: string | null; created_at: string; last_seen_at: string | null }[];
    const files = db.prepare('SELECT COUNT(*) n FROM app_keys WHERE user_id=?').get(u.id) as { n: number };
    return {
      sessions: rows.map((r) => ({ id: r.id_hash.slice(0, 24), device: deviceName(r.ua), ip: maskIp(r.ip), createdAt: r.created_at, lastSeenAt: r.last_seen_at ?? r.created_at, current: r.id_hash === req.sessionHash })),
      downloadedFiles: files.n,
    };
  });
  app.delete('/api/account/sessions/:id', async (req) => {
    const u = requireUser(req);
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f]{24}$/.test(id)) throw new HttpError(400, 'VALIDATION_FAILED', 'Unknown session.');
    const row = db.prepare('SELECT id_hash FROM sessions WHERE user_id=? AND substr(id_hash,1,24)=?').get(u.id, id) as { id_hash: string } | undefined;
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'That device is already signed out.');
    db.prepare('DELETE FROM sessions WHERE id_hash=?').run(row.id_hash);
    securityEvent(u.id, 'session_revoked', req);
    return { ok: true, current: row.id_hash === req.sessionHash };
  });
  app.post('/api/account/sessions/others', async (req) => {
    const u = requireUser(req);
    revokeSessions(u.id, req.sessionHash);
    securityEvent(u.id, 'sessions_revoked', req, 'all other devices');
    return { ok: true };
  });
  app.get('/api/account/security', async (req) => {
    const u = requireUser(req);
    const rows = db.prepare('SELECT kind, ip, ua, detail, at FROM security_events WHERE user_id=? ORDER BY id DESC LIMIT 40').all(u.id) as { kind: string; ip: string | null; ua: string | null; detail: string; at: string }[];
    return { events: rows.map((r) => ({ kind: r.kind, device: deviceName(r.ua), ip: maskIp(r.ip), detail: r.kind === 'email_changed' || r.kind === 'email_change_requested' ? r.detail : '', at: r.at })) };
  });

  /* ---------- notifications ---------- */
  app.put('/api/account/notifications', async (req) => {
    const u = requireUser(req);
    const incoming = ((req.body ?? {}) as { prefs?: Record<string, { inapp?: unknown; email?: unknown }> }).prefs ?? {};
    const current = prefsOf(u);
    const out: Record<string, { inapp: boolean; email: boolean }> = {};
    (Object.keys(current) as Category[]).forEach((c) => {
      if (ESSENTIAL.includes(c)) return; // always on
      const p = incoming[c];
      out[c] = { inapp: p && typeof p.inapp === 'boolean' ? p.inapp : current[c].inapp, email: p && typeof p.email === 'boolean' ? p.email : current[c].email };
    });
    db.prepare('UPDATE users SET notify_prefs=? WHERE id=?').run(JSON.stringify(out), u.id);
    return { prefs: prefsOf(db.prepare('SELECT notify_prefs FROM users WHERE id=?').get(u.id) as UserRow) };
  });
  app.get('/api/notifications', async (req) => {
    const u = requireUser(req);
    if (req.pub) return { items: [], unread: 0 };
    const before = Number((req.query as { before?: string }).before) || 0;
    const items = db.prepare(`SELECT id, category, title, body, link, created_at createdAt, read_at readAt FROM notifications WHERE user_id=? ${before ? 'AND id<?' : ''} ORDER BY id DESC LIMIT 30`)
      .all(...(before ? [u.id, before] : [u.id]));
    const unread = (db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL').get(u.id) as { n: number }).n;
    return { items, unread };
  });
  app.post('/api/notifications/read', async (req) => {
    const u = requireUser(req);
    const b = (req.body ?? {}) as { ids?: unknown; all?: boolean };
    if (b.all) db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(now(), u.id);
    else if (Array.isArray(b.ids)) {
      const q = db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND id=? AND read_at IS NULL');
      b.ids.slice(0, 200).forEach((id) => { if (Number.isInteger(id)) q.run(now(), u.id, id); });
    }
    return { ok: true };
  });

  /* ---------- privacy and data ---------- */
  app.get('/api/account/export', async (req, reply) => {
    const u = requireUser(req);
    limit(req, 'export', 5, 3600_000, u.id);
    const { password_hash: _p, notify_prefs, avatar: _a, ...profile } = u;
    const data = {
      exportedAt: now(),
      profile: { ...profile, notifyPrefs: JSON.parse(notify_prefs || '{}') },
      usage: canCreateApps(u) ? usage(u) : null,
      apps: db.prepare('SELECT a.id, a.name, m.role, a.created_at createdAt FROM memberships m JOIN apps a ON a.id=m.app_id WHERE m.user_id=?').all(u.id),
      signIns: db.prepare('SELECT provider, email, created_at createdAt FROM identities WHERE user_id=?').all(u.id),
      sessions: (db.prepare('SELECT ua, created_at, last_seen_at FROM sessions WHERE user_id=?').all(u.id) as { ua: string; created_at: string; last_seen_at: string }[]).map((s) => ({ device: deviceName(s.ua), createdAt: s.created_at, lastSeenAt: s.last_seen_at })),
      securityActivity: db.prepare('SELECT kind, at FROM security_events WHERE user_id=? ORDER BY id DESC LIMIT 500').all(u.id),
      payments: db.prepare('SELECT id, plan, amount, method_name method, reference, paid_on paidOn, status, reject_reason rejectReason, created_at createdAt, reviewed_at reviewedAt FROM payments WHERE user_id=?').all(u.id),
      notifications: db.prepare('SELECT category, title, body, created_at createdAt, read_at readAt FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 500').all(u.id),
      supportRequests: db.prepare('SELECT kind, subject, message, status, created_at createdAt FROM support_tickets WHERE user_id=?').all(u.id),
    };
    securityEvent(u.id, 'data_exported', req);
    reply.header('Content-Disposition', 'attachment; filename="jhino-account-data.json"').header('Cache-Control', 'no-store');
    return data;
  });

  app.post('/api/account/delete', async (req, reply) => {
    const u = requireUser(req);
    const b = (req.body ?? {}) as { password?: string; confirm?: string };
    if (String(b.confirm ?? '').trim() !== 'DELETE') throw new HttpError(400, 'VALIDATION_FAILED', 'Type DELETE to confirm.');
    await reauth(req, b.password);
    if (u.is_admin && (db.prepare("SELECT COUNT(*) n FROM users WHERE is_admin=1 AND disabled=0 AND kind='person'").get() as { n: number }).n <= 1) {
      throw new HttpError(400, 'LAST_ADMIN', 'You are the only super admin. Make someone else a super admin before deleting your account.');
    }
    sendMail(u.email, 'account_deleted', mails.deleted(u.name));
    const owned = deleteAccount(u);
    securityEvent(u.id, 'account_deleted', req, `${owned.length} apps`);
    db.prepare('INSERT INTO audit_log(actor_id,actor_email,action,target_type,target_id,detail,ip,at) VALUES(?,?,?,?,?,?,?,?)')
      .run(u.id, u.email, 'account.self_delete', 'user', u.id, `${owned.length} apps deleted`, req.ip, now());
    reply.clearCookie('jhino_sid', { path: '/' });
    return { ok: true };
  });

  /* ---------- help and support ---------- */
  app.post('/api/support', async (req) => {
    limit(req, 'support', 6, 3600_000);
    const b = (req.body ?? {}) as { kind?: string; subject?: string; message?: string; email?: string; diagnostics?: unknown };
    const kind = ['contact', 'problem', 'feedback'].includes(String(b.kind)) ? String(b.kind) : 'contact';
    const subject = String(b.subject ?? '').trim().slice(0, 140);
    const message = String(b.message ?? '').trim();
    if (!subject) throw new HttpError(400, 'VALIDATION_FAILED', 'Add a short subject.');
    if (message.length < 5 || message.length > 5000) throw new HttpError(400, 'VALIDATION_FAILED', 'Write a message of 5 to 5,000 characters.');
    const u = req.user && !req.pub ? req.user : null;
    const email = u ? u.email : validateRealEmail(b.email);
    // Only harmless details: app version, page, browser, an error reference.
    let diagnostics: string | null = null;
    if (b.diagnostics && typeof b.diagnostics === 'object') {
      const d = b.diagnostics as Record<string, unknown>;
      const keep: Record<string, string> = {};
      ['page', 'errorRef', 'appVersion', 'screen'].forEach((k) => { if (typeof d[k] === 'string') keep[k] = String(d[k]).slice(0, 200); });
      keep.browser = deviceName(clientInfo(req).ua);
      diagnostics = JSON.stringify(keep);
    }
    const id = newId('tk');
    db.prepare('INSERT INTO support_tickets(id,user_id,email,kind,subject,message,diagnostics,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, u?.id ?? null, email, kind, subject, message, diagnostics, now());
    const to = setting('support_email') || config.mail.supportEmail;
    if (to) sendMail(to, 'support', mails.supportReceived(kind === 'problem' ? 'Problem report' : kind === 'feedback' ? 'Feedback' : 'Message', email, subject, message));
    notifyAdmins('account', `New support request: ${subject}`, `${kind} from ${email}`, '/admin/support');
    return { ok: true, id };
  });

  void audit; // (audit is used by the admin routes)
}
