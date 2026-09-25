import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verify } from '@node-rs/argon2';
import { config, makePassword } from './config.js';
import { db, logActivity, now, roleOf, sha256, type AppRow, type Role, type UserRow } from './db.js';
import { HttpError, createUser, hashPassword, requireUser } from './auth.js';
import { audit, limit } from './security.js';
import { assertAddressAllowance, assertFeature } from './plans.js';
import { revoke, publish } from './realtime.js';

/*
 * Sharing an app by link.
 * - private: only people added in Share (the default).
 * - public: anyone with the link opens it.
 * - password: anyone with the link and the password.
 * Visitors act as one hidden "Visitor" account per app, a member with the role the owner picked
 * (view, add or edit), so every existing check applies to them unchanged. Their cookie works for
 * that one app's data only.
 *
 * Addresses: an app can have its own address, jhino.com/<name>, chosen when it is created or later in
 * Share. It opens the app at that exact address (no redirect). Addresses and short links share one set
 * of names, so a name is never used twice.
 */

export const RESERVED = new Set(['api', 'run', 'apps', 'app', 'build', 'shared', 'trash', 'people', 'invite', 's', 'admin', 'account', 'login', 'signin',
  'signup', 'register', 'forgot', 'reset', 'verify', 'help', 'support', 'terms', 'privacy', 'pricing', 'billing', 'plans', '_jhino', 'preview', 'health',
  'assets', 'static', 'logout', 'settings', 'dashboard', 'home', 'about', 'contact', 'blog', 'docs', 'status', 'www', 'mail', 'jhino', 'favicon.ico',
  'robots.txt', 'sitemap.xml', 'manifest.json', 'new', 'create', 'upload', 'download', 'files', 'public', 'p', 'u', 'user', 'users', 'auth', 'oauth',
  'links', 'link', 'go', 'l', 'admin-links', 'addresses', 'receipt', 'receipts', 'payments', 'checkout', 'plan', 'features', 'index.html', 'img', 'images', 'fonts']);
export function validSlug(s: unknown): string {
  const v = String(s ?? '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(v) || v.length < 2) throw new HttpError(400, 'VALIDATION_FAILED', 'Use 2 to 50 lowercase letters, numbers and dashes (not at the start or end).');
  if (RESERVED.has(v)) throw new HttpError(400, 'VALIDATION_FAILED', `"${v}" is used by Jhino itself. Choose another address.`);
  return v;
}

/** Is this name already an app's address or a short link? (Apps in Trash keep their address.) */
export function nameInUse(name: string, except: { appId?: string; linkId?: string } = {}) {
  return !!db.prepare('SELECT 1 FROM apps WHERE slug=? COLLATE NOCASE AND id<>?').get(name, except.appId ?? '')
    || !!db.prepare('SELECT 1 FROM short_links WHERE code=? COLLATE NOCASE AND id<>?').get(name, except.linkId ?? '');
}
export function assertNameFree(name: string, except: { appId?: string; linkId?: string } = {}) {
  if (nameInUse(name, except)) throw new HttpError(409, 'SLUG_TAKEN', `jhino.com/${name} is already taken. Try another name.`);
}

export type Access = 'private' | 'public' | 'password';
export interface AddressRequest { slug: string | null; access?: Access; publicRole?: Role; password?: string }
/**
 * Check an address (and how it opens) before an app is created or changed, so nothing is half done.
 * `u` is the owner; super admins have no limits.
 */
export function readAddressRequest(u: UserRow, raw: { slug?: unknown; access?: unknown; publicRole?: unknown; password?: unknown }, appId: string | null, prevAccess: string | null = null): AddressRequest {
  const slug = raw.slug === null || raw.slug === undefined || String(raw.slug).trim() === '' ? null : validSlug(raw.slug);
  if (slug) { assertNameFree(slug, { appId: appId ?? undefined }); assertAddressAllowance(u, appId); }
  const access = raw.access === undefined || raw.access === '' ? undefined : String(raw.access) as Access;
  if (access && !['private', 'public', 'password'].includes(access)) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose who can open it.');
  if (access === 'password' && prevAccess !== 'password') assertFeature(u, 'passwordLinks', 'A password link');
  const role = raw.publicRole === undefined || raw.publicRole === '' ? undefined : String(raw.publicRole) as Role;
  const password = raw.password === undefined || raw.password === null || raw.password === '' ? undefined : String(raw.password);
  return { slug, access, publicRole: role, password };
}
/** Give an app its address and link settings, after readAddressRequest said yes. */
export async function applyAddress(appId: string, r: AddressRequest) {
  db.transaction(() => {
    if (r.slug) assertNameFree(r.slug, { appId });
    db.prepare('UPDATE apps SET slug=? WHERE id=?').run(r.slug, appId);
  })();
  if (r.access || r.publicRole || r.password) return setSharing(appId, { access: r.access, publicRole: r.publicRole, password: r.password });
  return db.prepare('SELECT * FROM apps WHERE id=?').get(appId) as AppRow;
}

const PUB_DAYS = 30;
const cookieName = (appId: string) => `jp_${appId}`;
const ROLES: Role[] = ['viewer', 'contributor', 'editor'];

export function ensureShareToken(appId: string): string {
  const a = db.prepare('SELECT share_token FROM apps WHERE id=?').get(appId) as { share_token: string | null } | undefined;
  if (a?.share_token) return a.share_token;
  const t = crypto.randomBytes(10).toString('hex');
  db.prepare('UPDATE apps SET share_token=? WHERE id=?').run(t, appId);
  return t;
}
export function shareInfo(a: AppRow, base: string) {
  const token = a.share_token || ensureShareToken(a.id);
  return {
    access: (a.access ?? 'private') as 'private' | 'public' | 'password', publicRole: (a.public_role ?? 'viewer') as Role,
    hasPassword: !!a.share_password_hash, showBar: a.show_bar !== 0,
    shareUrl: `${base}/s/${token}`, slug: a.slug ?? null, slugUrl: a.slug ? `${base}/${a.slug}` : null,
  };
}

async function ensureVisitor(a: AppRow): Promise<string> {
  if (a.visitor_id && db.prepare('SELECT 1 FROM users WHERE id=?').get(a.visitor_id)) return a.visitor_id;
  const v = await createUser(`visitor.${a.id.toLowerCase()}@visitors.invalid`.replace(/[^a-z0-9@._-]/g, ''), 'Visitor', makePassword(24), false, { createdBy: a.owner_id, kind: 'visitor' });
  db.prepare('UPDATE users SET password_set=0 WHERE id=?').run(v.id);
  db.prepare('UPDATE apps SET visitor_id=? WHERE id=?').run(v.id, a.id);
  return v.id;
}

/** Change how an app is shared by link. Used by the owner (Share) and by super admins (Hosting). */
export async function setSharing(appId: string, b: { access?: unknown; publicRole?: unknown; password?: unknown; showBar?: unknown }) {
  const a = db.prepare('SELECT * FROM apps WHERE id=?').get(appId) as AppRow | undefined;
  if (!a) throw new HttpError(404, 'NOT_FOUND', 'That app does not exist.');
  const access = b.access === undefined ? (a.access ?? 'private') : String(b.access);
  if (!['private', 'public', 'password'].includes(access)) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose who can open the link.');
  const role = b.publicRole === undefined ? ((a.public_role ?? 'viewer') as Role) : (String(b.publicRole) as Role);
  if (!ROLES.includes(role)) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose what visitors can do.');
  let hash = a.share_password_hash ?? null;
  if (b.password !== undefined && b.password !== null && String(b.password) !== '') {
    const pw = String(b.password);
    if (pw.length < 4 || pw.length > 100) throw new HttpError(400, 'VALIDATION_FAILED', 'Use a link password of 4 to 100 characters.');
    hash = await hashPassword(pw);
  }
  if (access === 'password' && !hash) throw new HttpError(400, 'VALIDATION_FAILED', 'Set a password for the link.');
  const passwordChanged = hash !== (a.share_password_hash ?? null);
  if (b.showBar !== undefined) db.prepare('UPDATE apps SET show_bar=? WHERE id=?').run(b.showBar ? 1 : 0, appId);
  if (access === 'private') {
    db.prepare("UPDATE apps SET access='private', public_role=?, share_password_hash=? WHERE id=?").run(role, hash, appId);
    db.prepare('DELETE FROM pub_sessions WHERE app_id=?').run(appId);
    if (a.visitor_id) { db.prepare('DELETE FROM memberships WHERE app_id=? AND user_id=?').run(appId, a.visitor_id); revoke(appId, a.visitor_id); }
  } else {
    const vid = await ensureVisitor(a);
    db.transaction(() => {
      db.prepare('UPDATE apps SET access=?, public_role=?, share_password_hash=? WHERE id=?').run(access, role, hash, appId);
      db.prepare('INSERT INTO memberships(app_id,user_id,role,added_at) VALUES(?,?,?,?) ON CONFLICT(app_id,user_id) DO UPDATE SET role=excluded.role').run(appId, vid, role, now());
    })();
    // A new password (or going from open to password) sends current visitors back to the password screen.
    if (passwordChanged || (a.access === 'public' && access === 'password')) db.prepare('DELETE FROM pub_sessions WHERE app_id=?').run(appId);
    if (a.public_role !== role) publish(appId, 'role-changed', { userId: vid, role }, vid);
  }
  ensureShareToken(appId);
  return db.prepare('SELECT * FROM apps WHERE id=?').get(appId) as AppRow;
}

/** The paths a link visitor's cookie opens: this one app's data and live stream. */
function allowedPath(appId: string, method: string, url: string) {
  const p = url.split('?')[0];
  if (p === '/api/events') return method === 'GET';
  if (p === `/api/apps/${appId}`) return method === 'GET';
  const rest = p.startsWith(`/api/apps/${appId}/`) ? p.slice(`/api/apps/${appId}/`.length) : null;
  return rest !== null && /^(kv|records|files|people|activity|trash|launch|watch|unwatch|logo)(\/|$)/.test(rest);
}

function resolve(ref: string) {
  const r = String(ref ?? '').trim();
  if (!/^[\w-]{2,64}$/.test(r)) return undefined;
  return (db.prepare('SELECT * FROM apps WHERE share_token=? AND deleted_at IS NULL').get(r)
    ?? db.prepare('SELECT * FROM apps WHERE slug=? COLLATE NOCASE AND deleted_at IS NULL').get(r)) as AppRow | undefined;
}
function startVisit(reply: FastifyReply, a: AppRow, req: FastifyRequest) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + PUB_DAYS * 864e5);
  db.prepare('INSERT INTO pub_sessions(token_hash,app_id,ip,created_at,expires_at) VALUES(?,?,?,?,?)').run(sha256(token), a.id, req.ip, now(), expires.toISOString());
  reply.setCookie(cookieName(a.id), token, { path: '/', httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, expires });
}
function visiting(req: FastifyRequest, a: AppRow) {
  const c = req.cookies?.[cookieName(a.id)];
  if (!c) return false;
  return !!db.prepare('SELECT 1 FROM pub_sessions WHERE token_hash=? AND app_id=? AND expires_at > ?').get(sha256(c), a.id, now());
}
function visitorApp(a: AppRow) {
  let brand: { accent?: string; logo?: boolean; client?: string } | null = null;
  const v = db.prepare('SELECT builder FROM app_versions WHERE app_id=? AND n=?').get(a.id, a.live_version) as { builder: string | null } | undefined;
  if (v?.builder) { try { const c = JSON.parse(v.builder); brand = { accent: c.design?.accent, logo: !!c.design?.logo, client: c.client }; } catch { /* old build */ } }
  return { id: a.id, name: a.name, showBar: a.show_bar !== 0, access: a.access, role: a.public_role, brand };
}
setInterval(() => db.prepare('DELETE FROM pub_sessions WHERE expires_at < ?').run(now()), 3600_000).unref();

export function registerPublicShare(app: FastifyInstance) {
  // A link visitor's cookie: that app's data only. A signed-in member keeps their own account.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const m = /^\/api\/apps\/([\w-]{1,64})(?:\/|\?|$)/.exec(req.url);
    const appId = m ? m[1] : req.url.startsWith('/api/events') ? new URL(req.url, 'http://x').searchParams.get('app') : null;
    if (!appId) return;
    const c = req.cookies?.[cookieName(appId)];
    if (!c) return;
    if (req.user && !req.desk && roleOf(appId, req.user.id) && req.user.kind !== 'visitor') return;
    const row = db.prepare(`SELECT a.visitor_id FROM pub_sessions p JOIN apps a ON a.id=p.app_id
      WHERE p.token_hash=? AND p.app_id=? AND p.expires_at > ? AND a.access <> 'private' AND a.deleted_at IS NULL`).get(sha256(c), appId, now()) as { visitor_id: string | null } | undefined;
    if (!row?.visitor_id || !allowedPath(appId, req.method, req.url)) return;
    const v = db.prepare('SELECT * FROM users WHERE id=?').get(row.visitor_id) as UserRow | undefined;
    if (!v) return;
    req.user = v; req.pub = appId; req.csrf = null; req.desk = null; req.sessionHash = null;
  });

  /** Open a shared link: /s/<token> or a custom address. */
  app.get('/api/public/:ref', async (req, reply) => {
    limit(req, 'public-open', 120, 60_000);
    const a = resolve((req.params as { ref: string }).ref);
    if (!a) throw new HttpError(404, 'NOT_FOUND', 'This link does not exist or the app was removed.');
    if (req.user && !req.pub && req.user.kind !== 'visitor' && roleOf(a.id, req.user.id)) return { member: true, appId: a.id, app: visitorApp(a) };
    if (a.access === 'private' || !a.access) throw new HttpError(403, 'NOT_PUBLIC', 'This app is private. Ask its owner to add you, then sign in.');
    if (visiting(req, a)) return { ready: true, app: visitorApp(a) };
    if (a.access === 'password') return { needsPassword: true, app: { id: a.id, name: a.name } };
    startVisit(reply, a, req);
    return { ready: true, app: visitorApp(a) };
  });
  app.post('/api/public/:ref/unlock', async (req, reply) => {
    const a = resolve((req.params as { ref: string }).ref);
    if (!a || a.access !== 'password' || !a.share_password_hash) throw new HttpError(404, 'NOT_FOUND', 'This link does not need a password.');
    limit(req, 'public-unlock', 10, 15 * 60_000, a.id);
    const ok = await verify(a.share_password_hash, String((req.body as { password?: string })?.password ?? ''));
    if (!ok) throw new HttpError(401, 'BAD_PASSWORD', 'That password is not right.');
    startVisit(reply, a, req);
    return { ready: true, app: visitorApp(a) };
  });

  /* ---------- the owner's link settings ---------- */
  app.get('/api/apps/:id/sharing', async (req) => {
    const u = requireUser(req);
    const { id } = req.params as { id: string };
    const a = db.prepare('SELECT * FROM apps WHERE id=?').get(id) as AppRow | undefined;
    if (!a || (roleOf(id, u.id) !== 'owner' && !u.is_admin) || req.pub) throw new HttpError(404, 'NOT_FOUND', 'That app does not exist.');
    return shareInfo(a, baseFor(req));
  });
  app.patch('/api/apps/:id/sharing', async (req) => {
    const u = requireUser(req);
    const { id } = req.params as { id: string };
    if ((roleOf(id, u.id) !== 'owner' && !u.is_admin) || req.pub || req.desk) throw new HttpError(403, 'FORBIDDEN', 'Only the owner can change how the app is shared.');
    const before = db.prepare('SELECT access, public_role, show_bar FROM apps WHERE id=?').get(id) as { access: string; public_role: string; show_bar: number };
    const b = (req.body ?? {}) as { access?: unknown; showBar?: unknown };
    if (b.access === 'password' && before.access !== 'password') assertFeature(u, 'passwordLinks', 'A password link');
    if (b.showBar === false && before.show_bar !== 0) assertFeature(u, 'hideBar', 'Hiding the top bar');
    const a = await setSharing(id, (req.body ?? {}) as Record<string, unknown>);
    if (before.access !== a.access || before.public_role !== a.public_role) {
      logActivity(id, u.id, a.access === 'private' ? 'turned the share link off' : `shared the app by ${a.access === 'password' ? 'password link' : 'public link'}`, a.access === 'private' ? '' : a.public_role === 'viewer' ? 'visitors can view' : a.public_role === 'contributor' ? 'visitors can add' : 'visitors can edit');
    }
    if (before.show_bar !== a.show_bar) publish(id, 'app-updated', { reason: 'bar' });
    return shareInfo(a, baseFor(req));
  });

  /* ---------- addresses: jhino.com/<name> ---------- */
  /** Is a name free? For the address box while someone types. */
  app.get('/api/addresses/check', async (req) => {
    const u = requireUser(req);
    if (req.pub || req.desk) throw new HttpError(403, 'FORBIDDEN', 'Not here.');
    limit(req, 'address-check', 240, 60_000, u.id);
    const q = req.query as { name?: string; app?: string; link?: string };
    const url = (n: string) => `${baseFor(req).replace(/^https?:\/\//, '')}/${n}`;
    let name: string;
    try { name = validSlug(q.name); } catch (e) { return { name: String(q.name ?? ''), available: false, reason: (e as Error).message }; }
    if (nameInUse(name, { appId: q.app, linkId: q.link })) return { name, available: false, reason: `${url(name)} is already taken.` };
    return { name, available: true, url: url(name) };
  });
  /** The owner sets or removes their app's address. */
  app.put('/api/apps/:id/address', async (req) => {
    const u = requireUser(req);
    const { id } = req.params as { id: string };
    const a = db.prepare('SELECT * FROM apps WHERE id=? AND deleted_at IS NULL').get(id) as AppRow | undefined;
    if (!a || (roleOf(id, u.id) !== 'owner' && !u.is_admin) || req.pub || req.desk) throw new HttpError(404, 'NOT_FOUND', 'That app does not exist.');
    const owner = db.prepare('SELECT * FROM users WHERE id=?').get(a.owner_id) as UserRow;
    const r = readAddressRequest(u.is_admin ? u : owner, (req.body ?? {}) as Record<string, unknown>, id, a.access ?? 'private');
    const next = await applyAddress(id, r);
    if ((a.slug ?? null) !== r.slug) {
      logActivity(id, u.id, r.slug ? `set the address to /${r.slug}` : 'removed the address', '');
      if (u.id !== a.owner_id) audit(req, r.slug ? 'hosting.address_set' : 'hosting.address_removed', 'app', id, `${a.name}${r.slug ? ' → /' + r.slug : ''}`);
    }
    return shareInfo(next, baseFor(req));
  });
}

export const baseFor = (req: FastifyRequest) => config.publicUrl || `${req.protocol}://${req.headers.host}`;
