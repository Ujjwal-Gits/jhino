import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config, ROOT } from './config.js';
import { db, newId, now, sha256, roleOf, logActivity, canAdd, canWrite, type AppRow, type Role, type UserRow } from './db.js';
import { HttpError, requireUser, requireCreator, createUser, createSession, validateEmail, validateName, validatePassword, publicUser, hashPassword } from './auth.js';
import { makePassword } from './config.js';
import { loadFile, canReadFile, sendFile } from './files.js';
import { installPackage, appDir } from './packages.js';
import { publish, revoke, notifyUser, watch, unwatch, openStream } from './realtime.js';
import { snapshotFor } from './data.js';
import { assertCanCreate, uploadLimitBytes } from './plans.js';
import { assertNameFree, readAddressRequest, setSharing } from './publicshare.js';
import { uploadsOn } from './security.js';

const ROLES: Role[] = ['editor', 'contributor', 'viewer'];
const roleWord = (r: Role) => (r === 'editor' ? 'can edit' : r === 'contributor' ? 'can add' : 'can view');
const PICK_ROLE = 'Pick Can edit, Can add or Can view.';

export function loadApp(id: string): AppRow {
  const a = db.prepare('SELECT * FROM apps WHERE id=?').get(id) as AppRow | undefined;
  if (!a) throw new HttpError(404, 'NOT_FOUND', 'That app does not exist.');
  return a;
}

/** Member access check. Deleted apps are only visible to their owner (for Trash). */
export function access(req: FastifyRequest, appId: string, need: 'read' | 'add' | 'write' | 'owner' = 'read') {
  const user = requireUser(req);
  const app = loadApp(appId);
  const role = roleOf(appId, user.id);
  if (!role || (app.deleted_at && role !== 'owner')) throw new HttpError(404, 'NOT_FOUND', 'That app does not exist or is not shared with you.');
  if (need === 'write' && !canWrite(role)) throw new HttpError(403, 'FORBIDDEN', role === 'contributor' ? 'You can add items here but not change shared data.' : 'You can view this app but not change it.');
  if (need === 'add' && !canAdd(role)) throw new HttpError(403, 'FORBIDDEN', 'You can view this app but not change it.');
  if (need === 'owner' && role !== 'owner') throw new HttpError(403, 'FORBIDDEN', 'Only the owner can do this.');
  if (need !== 'read' && app.deleted_at) throw new HttpError(409, 'IN_TRASH', 'Restore this app from Trash first.');
  return { user, app, role };
}

function versionRow(appId: string, n: number) {
  return db.prepare('SELECT * FROM app_versions WHERE app_id=? AND n=?').get(appId, n) as
    { app_id: string; n: number; entry: string; file_count: number; size: number; features: string; source_name: string; uploaded_by: string; created_at: string } | undefined;
}

function appSummary(a: AppRow, userId: string) {
  const members = db.prepare(`SELECT u.id, u.name, m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.app_id=? AND u.kind='person' ORDER BY m.added_at`).all(a.id) as { id: string; name: string; role: Role }[];
  const v = versionRow(a.id, a.live_version) as (ReturnType<typeof versionRow> & { builder?: string | null }) | undefined;
  const last = db.prepare(`SELECT a.action, a.at, u.name FROM activity a LEFT JOIN users u ON u.id=a.user_id WHERE a.app_id=? ORDER BY a.id DESC LIMIT 1`).get(a.id) as { action: string; at: string; name: string | null } | undefined;
  // For created apps: who it is for, their colour and whether there is a logo (served by /api/apps/:id/logo).
  let brand: { client: string; field: string; accent: string; logo: boolean; sections: number } | null = null;
  if (v?.builder) {
    try {
      const cfg = JSON.parse(v.builder) as { client?: string; field?: string; design?: { accent?: string; logo?: string }; blocks?: unknown[] };
      brand = { client: cfg.client ?? '', field: cfg.field ?? '', accent: cfg.design?.accent ?? '#1f6f5c', logo: !!cfg.design?.logo, sections: cfg.blocks?.length ?? 0 };
    } catch { /* an old build */ }
  }
  return {
    id: a.id, name: a.name, color: a.color, ownerId: a.owner_id,
    role: members.find((m) => m.id === userId)?.role ?? null,
    members, liveVersion: a.live_version,
    features: v ? JSON.parse(v.features) : {},
    privateKeys: JSON.parse(a.private_keys) as string[],
    createdAt: a.created_at, updatedAt: a.updated_at, deletedAt: a.deleted_at,
    last: last ?? null,
    built: !!v?.builder,
    brand,
    storage: db.prepare('SELECT COUNT(*) files, COALESCE(SUM(size),0) bytes FROM files WHERE app_id=?').get(a.id) as { files: number; bytes: number },
    access: a.access ?? 'private', slug: a.slug ?? null, showBar: a.show_bar !== 0,
  };
}

/** An uploaded app (HTML or ZIP) plus the form fields sent before it. */
export async function readUpload(req: FastifyRequest, maxBytes = config.limits.uploadBytes) {
  const mb = Math.round(maxBytes / 1048576);
  if (Number(req.headers['content-length'] || 0) > maxBytes + 64 * 1024) throw new HttpError(413, 'TOO_LARGE', `That file is larger than ${mb} MB, the most your plan allows for one upload.`, { maxBytes });
  const part = await req.file({ limits: { fileSize: maxBytes, files: 1, fields: 8 } });
  if (!part) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose a file to upload.');
  const buf = await part.toBuffer();
  if (part.file.truncated) throw new HttpError(413, 'TOO_LARGE', `That file is larger than ${mb} MB, the most your plan allows for one upload.`, { maxBytes });
  const raw = part.fields as Record<string, { value?: string } | undefined>;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (v && typeof v.value === 'string') fields[k] = v.value;
  return { buf, filename: part.filename || 'app.html', name: fields.name, fields };
}

/**
 * Publish an uploaded HTML/ZIP as a new app. The plan limit is checked before the work and again inside
 * the insert transaction, so two uploads at once cannot both slip past it.
 */
export async function createAppFromUpload(user: UserRow, buf: Buffer, filename: string, nameIn?: string, slug: string | null = null) {
  assertCanCreate(user.id);
  const id = newId('app');
  const pkg = await installPackage(buf, filename, id, 1);
  const name = (nameIn?.trim() || pkg.title || filename.replace(/\.(zip|html?)$/i, '').replace(/[-_]+/g, ' ')).slice(0, 80) || 'Untitled app';
  const t = now();
  try {
    db.transaction(() => {
      assertCanCreate(user.id);
      if (slug) assertNameFree(slug);
      db.prepare('INSERT INTO apps(id,name,color,owner_id,live_version,created_at,updated_at,share_token,slug) VALUES(?,?,?,?,1,?,?,?,?)')
        .run(id, name, crypto.randomInt(0, 6), user.id, t, t, crypto.randomBytes(10).toString('hex'), slug);
      db.prepare('INSERT INTO app_versions(app_id,n,entry,file_count,size,features,source_name,uploaded_by,created_at,manifest) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id, 1, pkg.entry, pkg.fileCount, pkg.size, JSON.stringify(pkg.features), filename.slice(0, 200), user.id, t, pkg.manifest ? JSON.stringify(pkg.manifest) : null);
      db.prepare('INSERT INTO memberships(app_id,user_id,role,added_at) VALUES(?,?,?,?)').run(id, user.id, 'owner', t);
      logActivity(id, user.id, 'published the app', `version 1`);
    })();
  } catch (e) {
    fs.rmSync(path.join(config.dataDir, 'apps', id), { recursive: true, force: true });
    throw e;
  }
  return id;
}

/* ---------------- run tokens: short-lived, per open app, cookie-free ---------------- */
interface Run { appId: string; n: number; userId: string; nonce: string; exp: number; desk: number }
const getRun = (token: string) => db.prepare('SELECT app_id appId, n, user_id userId, nonce, expires_at exp, desk FROM runs WHERE token_hash=?').get(sha256(token)) as Run | undefined;
setInterval(() => db.prepare('DELETE FROM runs WHERE expires_at < ?').run(Date.now()), 10 * 60_000).unref();

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.pdf': 'application/pdf',
  '.wasm': 'application/wasm', '.map': 'application/json', '.xml': 'application/xml', '.md': 'text/plain; charset=utf-8',
};
export const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads';

/** Put the Jhino bridge first in <head> so it runs before any app script. */
function inject(html: string, boot: unknown, idb = false) {
  // Escape "<" and the two JS line separators so data can never close the script tag.
  const unsafe = new RegExp('[<' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
  const json = JSON.stringify(boot).replace(unsafe, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  // Apps that use IndexedDB get one that works in the sandbox and saves to the server (loaded before the shim).
  const tag = `<script id="__jhino_boot">window.__JHINO_BOOT__=${json}</script>${idb ? '<script src="/_jhino/idb.js"></script>' : ''}<script src="/_jhino/shim.js"></script>`;
  const head = html.match(/<head(\s[^>]*)?>/i);
  if (head && head.index !== undefined) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  const root = html.match(/<html(\s[^>]*)?>/i);
  if (root && root.index !== undefined) return html.slice(0, root.index + root[0].length) + `<head>${tag}</head>` + html.slice(root.index + root[0].length);
  const dt = html.match(/^\s*<!doctype[^>]*>/i);
  return dt ? dt[0] + tag + html.slice(dt[0].length) : tag + html;
}

export function registerApps(app: FastifyInstance) {
  /* ---------- realtime stream ---------- */
  app.get('/api/events', async (req, reply) => {
    const user = requireUser(req);
    reply.hijack();
    openStream(user.id, reply.raw);
  });
  app.post('/api/apps/:id/watch', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = access(req, id);
    const { connId } = (req.body ?? {}) as { connId?: string };
    if (!connId || !watch(connId, user.id, id)) throw new HttpError(400, 'CONNECTION_LOST', 'Live connection not found. Reconnecting.');
    return { ok: true };
  });
  app.post('/api/apps/:id/unwatch', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    unwatch(String((req.body as { connId?: string })?.connId), user.id, id);
    return { ok: true };
  });

  /* ---------- list / create ---------- */
  app.get('/api/apps', async (req) => {
    const user = requireUser(req);
    const trash = (req.query as { trash?: string }).trash === '1';
    const rows = db.prepare(`SELECT a.* FROM apps a JOIN memberships m ON m.app_id=a.id AND m.user_id=?
      WHERE ${trash ? "a.deleted_at IS NOT NULL AND m.role='owner'" : 'a.deleted_at IS NULL'} ORDER BY a.updated_at DESC`).all(user.id) as AppRow[];
    return { apps: rows.map((a) => appSummary(a, user.id)) };
  });

  /** The logo of a created app, as an image (so app lists stay small and browsers can cache it). */
  app.get('/api/apps/:id/logo', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { app: a } = access(req, id);
    const v = db.prepare('SELECT builder FROM app_versions WHERE app_id=? AND n=?').get(id, a.live_version) as { builder: string | null } | undefined;
    let logo: string | undefined;
    try { logo = v?.builder ? (JSON.parse(v.builder) as { design?: { logo?: string } }).design?.logo : undefined; } catch { /* ignore */ }
    const m = logo ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(logo) : null;
    if (!m) throw new HttpError(404, 'NOT_FOUND', 'This app has no logo.');
    const etag = '"' + crypto.createHash('sha1').update(m[2]).digest('hex').slice(0, 16) + '"';
    reply.header('Cache-Control', 'private, max-age=300').header('ETag', etag).header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "sandbox; default-src 'none'");
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.type(m[1]).send(Buffer.from(m[2], 'base64'));
  });

  app.post('/api/apps', async (req) => {
    const user = requireCreator(req);
    assertCanCreate(user.id); // before reading a big upload
    const up = await readUpload(req, uploadLimitBytes(user, user, config.limits.uploadBytes));
    // An address (jhino.com/<name>) and how it opens can be chosen with the upload; all checked first.
    const addr = readAddressRequest(user, { slug: up.fields.slug, access: up.fields.access, publicRole: up.fields.publicRole, password: up.fields.password }, null);
    const id = await createAppFromUpload(user, up.buf, up.filename, up.name, addr.slug);
    if (addr.access && addr.access !== 'private') await setSharing(id, { access: addr.access, publicRole: addr.publicRole, password: addr.password });
    return { app: appSummary(loadApp(id), user.id) };
  });

  app.get('/api/apps/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { user, app: a, role } = access(req, id);
    const s = appSummary(a, user.id);
    if (req.pub) return { app: { ...s, members: [], versions: [], ownerId: '', privateKeys: [], storage: undefined } };
    const members = (db.prepare(`SELECT u.id, u.name, u.email, m.role, u.created_by, u.is_admin FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.app_id=? AND u.kind='person' ORDER BY m.role='owner' DESC, m.added_at`).all(id) as any[])
      .map(({ created_by, is_admin, ...m }) => ({ ...m, madeByMe: role === 'owner' && created_by === user.id && !is_admin }));
    const versions = role === 'owner'
      ? db.prepare(`SELECT v.n, v.file_count fileCount, v.size, v.source_name sourceName, v.created_at createdAt, v.features, u.name uploadedBy FROM app_versions v LEFT JOIN users u ON u.id=v.uploaded_by WHERE app_id=? ORDER BY n DESC`).all(id)
        .map((v: any) => ({ ...v, features: JSON.parse(v.features) }))
      : [];
    return { app: { ...s, members, versions } };
  });

  app.patch('/api/apps/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = access(req, id, 'owner');
    const b = (req.body ?? {}) as { name?: string; privateKeys?: string[] };
    if (b.name !== undefined) db.prepare('UPDATE apps SET name=?, updated_at=? WHERE id=?').run(validateName(b.name), now(), id);
    if (b.privateKeys !== undefined) {
      if (!Array.isArray(b.privateKeys) || b.privateKeys.length > 50) throw new HttpError(400, 'VALIDATION_FAILED', 'Up to 50 private key patterns.');
      const keys = b.privateKeys.map((k) => String(k).trim()).filter(Boolean).map((k) => k.slice(0, 120));
      db.prepare('UPDATE apps SET private_keys=?, updated_at=? WHERE id=?').run(JSON.stringify(keys), now(), id);
      publish(id, 'app-updated', { reason: 'settings' });
    }
    logActivity(id, user.id, 'changed app settings');
    return { app: appSummary(loadApp(id), user.id) };
  });

  /* ---------- versions ---------- */
  app.post('/api/apps/:id/versions', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = access(req, id, 'owner');
    const up = await readUpload(req, uploadLimitBytes(user, user, config.limits.uploadBytes));
    const n = ((db.prepare('SELECT MAX(n) n FROM app_versions WHERE app_id=?').get(id) as { n: number }).n || 0) + 1;
    const pkg = await installPackage(up.buf, up.filename, id, n);
    db.transaction(() => {
      db.prepare('INSERT INTO app_versions(app_id,n,entry,file_count,size,features,source_name,uploaded_by,created_at,manifest) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id, n, pkg.entry, pkg.fileCount, pkg.size, JSON.stringify(pkg.features), up.filename.slice(0, 200), user.id, now(), pkg.manifest ? JSON.stringify(pkg.manifest) : null);
      db.prepare('UPDATE apps SET live_version=?, updated_at=? WHERE id=?').run(n, now(), id);
      logActivity(id, user.id, 'published a new version', `version ${n}`);
    })();
    publish(id, 'app-updated', { reason: 'version', version: n });
    return { app: appSummary(loadApp(id), user.id) };
  });

  app.post('/api/apps/:id/rollback', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = access(req, id, 'owner');
    const n = Number((req.body as { n?: number })?.n);
    if (!versionRow(id, n)) throw new HttpError(404, 'NOT_FOUND', 'That version does not exist.');
    db.prepare('UPDATE apps SET live_version=?, updated_at=? WHERE id=?').run(n, now(), id);
    logActivity(id, user.id, 'switched the live version', `version ${n}`);
    publish(id, 'app-updated', { reason: 'version', version: n });
    return { app: appSummary(loadApp(id), user.id) };
  });

  /* ---------- trash ---------- */
  app.post('/api/apps/:id/trash', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = access(req, id, 'owner');
    db.prepare('UPDATE apps SET deleted_at=?, updated_at=? WHERE id=?').run(now(), now(), id);
    logActivity(id, user.id, 'moved the app to Trash');
    const members = db.prepare('SELECT user_id FROM memberships WHERE app_id=?').all(id) as { user_id: string }[];
    publish(id, 'app-updated', { reason: 'trashed' });
    members.forEach((m) => notifyUser(m.user_id));
    return { ok: true };
  });
  app.post('/api/apps/:id/restore', async (req) => {
    const { id } = req.params as { id: string };
    const { user, role } = access(req, id);
    if (role !== 'owner') throw new HttpError(403, 'FORBIDDEN', 'Only the owner can do this.');
    db.prepare('UPDATE apps SET deleted_at=NULL, updated_at=? WHERE id=?').run(now(), id);
    logActivity(id, user.id, 'restored the app from Trash');
    const members = db.prepare('SELECT user_id FROM memberships WHERE app_id=?').all(id) as { user_id: string }[];
    members.forEach((m) => notifyUser(m.user_id));
    return { ok: true };
  });
  app.delete('/api/apps/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { role, app: a } = access(req, id);
    if (role !== 'owner') throw new HttpError(403, 'FORBIDDEN', 'Only the owner can do this.');
    if (!a.deleted_at) throw new HttpError(409, 'NOT_IN_TRASH', 'Move the app to Trash first.');
    const members = db.prepare('SELECT user_id FROM memberships WHERE app_id=?').all(id) as { user_id: string }[];
    db.prepare('DELETE FROM apps WHERE id=?').run(id);
    if (a.visitor_id) db.prepare("DELETE FROM users WHERE id=? AND kind='visitor'").run(a.visitor_id);
    fs.rmSync(path.join(config.dataDir, 'apps', id), { recursive: true, force: true });
    fs.rmSync(path.join(config.dataDir, 'files', id), { recursive: true, force: true });
    members.forEach((m) => notifyUser(m.user_id));
    return { ok: true };
  });

  /* ---------- people ---------- */
  app.post('/api/apps/:id/members', async (req) => {
    const { id } = req.params as { id: string };
    const { user, app: a } = access(req, id, 'owner');
    const b = (req.body ?? {}) as { email?: string; role?: Role };
    if (!ROLES.includes(b.role as Role)) throw new HttpError(400, 'VALIDATION_FAILED', PICK_ROLE);
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(b.email ?? '').trim()) as UserRow | undefined;
    if (!u) throw new HttpError(404, 'NO_SUCH_USER', 'Nobody with that email has an account yet. Send them an invite link instead.');
    if (roleOf(id, u.id)) throw new HttpError(409, 'ALREADY_MEMBER', `${u.name} already has access.`);
    db.prepare('INSERT INTO memberships(app_id,user_id,role,added_at) VALUES(?,?,?,?)').run(id, u.id, b.role, now());
    logActivity(id, user.id, `added ${u.name}`, roleWord(b.role as Role));
    notifyUser(u.id);
    return { ok: true, name: a.name };
  });
  app.patch('/api/apps/:id/members/:userId', async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const { user } = access(req, id, 'owner');
    const role = (req.body as { role?: Role })?.role;
    if (!ROLES.includes(role as Role)) throw new HttpError(400, 'VALIDATION_FAILED', PICK_ROLE);
    if (roleOf(id, userId) === 'owner') throw new HttpError(400, 'VALIDATION_FAILED', 'The owner keeps full access.');
    const r = db.prepare('UPDATE memberships SET role=? WHERE app_id=? AND user_id=?').run(role, id, userId);
    if (!r.changes) throw new HttpError(404, 'NOT_FOUND', 'That person is not in this app.');
    const name = (db.prepare('SELECT name FROM users WHERE id=?').get(userId) as { name: string }).name;
    logActivity(id, user.id, `changed ${name}'s access`, roleWord(role as Role));
    publish(id, 'role-changed', { userId, role }, userId);
    return { ok: true };
  });
  app.delete('/api/apps/:id/members/:userId', async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const { user } = access(req, id);
    const role = roleOf(id, user.id);
    // Owners remove anyone else; anyone can remove themselves (leave).
    if (userId !== user.id && role !== 'owner') throw new HttpError(403, 'FORBIDDEN', 'Only the owner can remove people.');
    if (roleOf(id, userId) === 'owner') throw new HttpError(400, 'VALIDATION_FAILED', 'The owner cannot be removed.');
    const name = (db.prepare('SELECT name FROM users WHERE id=?').get(userId) as { name: string } | undefined)?.name ?? 'someone';
    db.prepare('DELETE FROM memberships WHERE app_id=? AND user_id=?').run(id, userId);
    db.prepare('DELETE FROM app_keys WHERE app_id=? AND user_id=?').run(id, userId); // their downloaded file stops working too
    logActivity(id, user.id, userId === user.id ? 'left the app' : `removed ${name}`);
    revoke(id, userId);
    return { ok: true };
  });

  /** Everyone in the app, for pickers inside apps (assignee, signer). */
  app.get('/api/apps/:id/people', async (req) => {
    const { id } = req.params as { id: string };
    access(req, id);
    const rows = db.prepare("SELECT u.id, u.name, m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.app_id=? AND u.disabled=0 AND u.kind='person' ORDER BY u.name").all(id);
    return { people: rows };
  });

  /** The app owner makes a sign-in (ID + password) for someone and gives them a role in this app. */
  app.post('/api/apps/:id/people', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = access(req, id, 'owner');
    const b = (req.body ?? {}) as { name?: string; login?: string; password?: string; role?: Role };
    if (!ROLES.includes(b.role as Role)) throw new HttpError(400, 'VALIDATION_FAILED', PICK_ROLE);
    const login = validateEmail(b.login);
    const password = b.password ? validatePassword(b.password) : makePassword(12);
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(login)) {
      throw new HttpError(409, 'LOGIN_TAKEN', 'That sign-in ID is already used. If it is the same person, add them with "Add existing account".');
    }
    const u = await createUser(login, validateName(b.name), password);
    db.transaction(() => {
      db.prepare('UPDATE users SET created_by=? WHERE id=?').run(user.id, u.id);
      db.prepare('INSERT INTO memberships(app_id,user_id,role,added_at) VALUES(?,?,?,?)').run(id, u.id, b.role, now());
      logActivity(id, user.id, `made a sign-in for ${u.name}`, roleWord(b.role as Role));
    })();
    return { person: { id: u.id, name: u.name, login: u.email, role: b.role }, password };
  });

  /** Owners can give a new password only to people they created (never admins or other people's accounts). */
  app.post('/api/apps/:id/people/:userId/password', async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const { user } = access(req, id, 'owner');
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(userId) as (UserRow & { created_by: string | null }) | undefined;
    if (!u || !roleOf(id, userId) || u.created_by !== user.id || u.is_admin) throw new HttpError(403, 'FORBIDDEN', 'You can only reset passwords for sign-ins you made.');
    const password = makePassword(12);
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await hashPassword(password), userId);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM app_keys WHERE user_id=?').run(userId);
    logActivity(id, user.id, `gave ${u.name} a new password`);
    return { password, login: u.email };
  });

  /* ---------- invite links ---------- */
  app.get('/api/apps/:id/invites', async (req) => {
    const { id } = req.params as { id: string };
    access(req, id, 'owner');
    const rows = db.prepare(`SELECT i.id, i.role, i.created_at createdAt, i.expires_at expiresAt, i.used_at usedAt, i.revoked_at revokedAt, u.name usedBy
      FROM invites i LEFT JOIN users u ON u.id=i.used_by WHERE i.app_id=? ORDER BY i.created_at DESC LIMIT 30`).all(id);
    return { invites: rows };
  });
  app.post('/api/apps/:id/invites', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = access(req, id, 'owner');
    const b = (req.body ?? {}) as { role?: Role; days?: number };
    if (!ROLES.includes(b.role as Role)) throw new HttpError(400, 'VALIDATION_FAILED', PICK_ROLE);
    const days = Math.min(Math.max(Number(b.days) || 7, 1), 30);
    const token = crypto.randomBytes(24).toString('base64url');
    const inviteId = newId('inv');
    db.prepare('INSERT INTO invites(id,app_id,token_hash,role,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?)')
      .run(inviteId, id, sha256(token), b.role, user.id, now(), new Date(Date.now() + days * 864e5).toISOString());
    const base = config.publicUrl || `${req.protocol}://${req.headers.host}`;
    return { id: inviteId, url: `${base}/invite/${token}` };
  });
  app.delete('/api/apps/:id/invites/:inviteId', async (req) => {
    const { id, inviteId } = req.params as { id: string; inviteId: string };
    access(req, id, 'owner');
    db.prepare('UPDATE invites SET revoked_at=? WHERE id=? AND app_id=? AND revoked_at IS NULL').run(now(), inviteId, id);
    return { ok: true };
  });

  const loadInvite = (token: string) => {
    const inv = db.prepare(`SELECT i.*, a.name app_name, a.deleted_at, u.name inviter FROM invites i JOIN apps a ON a.id=i.app_id JOIN users u ON u.id=i.created_by WHERE i.token_hash=?`)
      .get(sha256(token)) as (Record<string, any>) | undefined;
    if (!inv || inv.deleted_at) throw new HttpError(404, 'INVITE_INVALID', 'This invite link is not valid.');
    if (inv.revoked_at) throw new HttpError(410, 'INVITE_REVOKED', 'This invite link was turned off by the owner.');
    if (inv.used_at) throw new HttpError(410, 'INVITE_USED', 'This invite link was already used. Ask for a new one.');
    if (Date.parse(inv.expires_at) < Date.now()) throw new HttpError(410, 'INVITE_EXPIRED', 'This invite link has expired. Ask for a new one.');
    return inv;
  };
  app.get('/api/invites/:token', async (req) => {
    const inv = loadInvite((req.params as { token: string }).token);
    return { appName: inv.app_name, inviter: inv.inviter, role: inv.role, expiresAt: inv.expires_at };
  });
  app.post('/api/invites/:token/accept', async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const inv = loadInvite(token);
    let user = req.user;
    if (!user) {
      const b = (req.body ?? {}) as { name?: string; email?: string; password?: string };
      user = await createUser(validateEmail(b.email), validateName(b.name), validatePassword(b.password));
      // Someone who joins through an invite is a client of that app's owner.
      db.prepare('UPDATE users SET created_by=? WHERE id=?').run(inv.created_by, user.id);
      user = db.prepare('SELECT * FROM users WHERE id=?').get(user.id) as UserRow;
      createSession(reply, user.id, req);
    }
    const uid = user.id;
    const joined = db.transaction(() => {
      // Single use: only the first request that flips used_at wins.
      const r = db.prepare('UPDATE invites SET used_at=?, used_by=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL').run(now(), uid, inv.id);
      if (!r.changes) throw new HttpError(410, 'INVITE_USED', 'This invite link was already used. Ask for a new one.');
      if (!roleOf(inv.app_id, uid)) {
        db.prepare('INSERT INTO memberships(app_id,user_id,role,added_at) VALUES(?,?,?,?)').run(inv.app_id, uid, inv.role, now());
        logActivity(inv.app_id, uid, 'joined with an invite link', roleWord(inv.role));
        return true;
      }
      return false;
    })();
    notifyUser(inv.created_by);
    return { appId: inv.app_id, joined, user: publicUser(user) };
  });

  /* ---------- activity, data, export ---------- */
  // The activity log lives in activity.ts.
  app.get('/api/apps/:id/data', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = access(req, id, 'owner');
    const kv = db.prepare(`SELECT k.ns, k.scope, k.key, length(k.value) size, substr(k.value,1,400) preview, k.rev, k.updated_at updatedAt, u.name updatedBy
      FROM kv k LEFT JOIN users u ON u.id=k.updated_by WHERE k.app_id=? AND (k.scope='' OR k.scope=?) AND k.value IS NOT NULL ORDER BY k.ns, k.scope, k.key`).all(id, user.id) as any[];
    const people = new Map((db.prepare('SELECT id, name FROM users').all() as { id: string; name: string }[]).map((u) => [u.id, u.name]));
    const collections = db.prepare(`SELECT collection, COUNT(*) n, MAX(updated_at) updatedAt FROM records WHERE app_id=? GROUP BY collection ORDER BY collection`).all(id);
    return { kv: kv.map((r) => ({ ...r, owner: r.scope ? people.get(r.scope) ?? 'Someone' : null })), collections };
  });
  app.get('/api/apps/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { app: a } = access(req, id, 'owner');
    // Shared data only: other people's private settings stay private.
    const kv = db.prepare("SELECT ns, key, value, rev, updated_at FROM kv WHERE app_id=? AND scope='' AND value IS NOT NULL").all(id);
    const records = db.prepare('SELECT id, collection, data, rev, created_at, updated_at FROM records WHERE app_id=?').all(id)
      .map((r: any) => ({ ...r, data: JSON.parse(r.data) }));
    const safe = a.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'app';
    reply.header('Content-Disposition', `attachment; filename="${safe}-data.json"`);
    const files = db.prepare('SELECT id, name, type, size, created_at FROM files WHERE app_id=?').all(id);
    return { jhinoExport: 1, exportedAt: now(), app: { name: a.name, liveVersion: a.live_version }, kv, records, files };
  });

  /* ---------- launch + runtime ---------- */
  app.post('/api/apps/:id/launch', async (req) => {
    const { id } = req.params as { id: string };
    const { user, app: a, role } = access(req, id);
    if (a.deleted_at) throw new HttpError(409, 'IN_TRASH', 'Restore this app from Trash to open it.');
    const token = crypto.randomBytes(24).toString('base64url');
    const nonce = crypto.randomBytes(16).toString('base64url');
    // A downloaded file keeps the app open for days; the web page relaunches more often.
    db.prepare('INSERT INTO runs(token_hash,app_id,n,user_id,nonce,expires_at,desk) VALUES(?,?,?,?,?,?,?)')
      .run(sha256(token), id, a.live_version, user.id, nonce, Date.now() + (req.desk ? 7 * 864e5 : 12 * 3600e3), req.desk ? 1 : 0);
    return { url: `/run/${token}/`, nonce, role, version: a.live_version };
  });

  app.get('/_jhino/shim.js', async (_req, reply) => {
    reply.header('Content-Type', 'text/javascript; charset=utf-8').header('Cache-Control', 'no-cache');
    return fs.createReadStream(shimPath());
  });

  app.get('/_jhino/idb.js', async (_req, reply) => {
    reply.header('Content-Type', 'text/javascript; charset=utf-8').header('Cache-Control', 'no-cache');
    return fs.createReadStream(path.join(ROOT, 'runtime', 'idb.js'));
  });

  app.get('/run/:token/*', async (req, reply) => {
    const { token } = req.params as { token: string };
    const run = getRun(token);
    // A run opened from a downloaded file is framed by that file (a local page), so it cannot be limited to this site.
    reply.header('Content-Security-Policy', run?.desk ? `sandbox ${SANDBOX}` : `sandbox ${SANDBOX}; frame-ancestors 'self'`)
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Content-Type-Options', 'nosniff');
    const deny = (msg: string) => reply.code(410).type('text/html; charset=utf-8').header('Cache-Control', 'no-store')
      .send(`<!doctype html><meta charset="utf-8"><body style="font:15px system-ui;padding:24px;color:#555">${msg}</body>`);
    if (!run || run.exp < Date.now()) return deny('This app session ended. Go back to Jhino and open the app again.');
    const a = db.prepare('SELECT * FROM apps WHERE id=?').get(run.appId) as AppRow | undefined;
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(run.userId) as UserRow | undefined;
    const role = roleOf(run.appId, run.userId);
    if (!a || a.deleted_at || !u || u.disabled || !role) { db.prepare('DELETE FROM runs WHERE token_hash=?').run(sha256(token)); return deny('You no longer have access to this app.'); }
    const v = versionRow(a.id, run.n)!;
    const root = appDir(a.id, run.n);
    let rel = decodeURIComponent(((req.params as Record<string, string>)['*'] || '').split('?')[0]);
    // File links are relative, so pages in subfolders ask for .../sub/__jhino/files/<id>.
    const fm = rel.match(/(?:^|\/)__jhino\/files\/([\w-]{1,64})$/);
    if (fm) {
      const f = loadFile(a.id, fm[1]);
      if (!f || !canReadFile(f, u.id, role)) return reply.code(404).type('text/plain').send('File not found');
      // Browsers will not show a PDF under a sandbox rule, so PDFs open in a tab of their own like on the files API.
      if (f.type === 'application/pdf') reply.removeHeader('Content-Security-Policy');
      // The app frame has no origin of its own; it may read its files (for example to restore a saved photo). The link is the key.
      reply.header('Access-Control-Allow-Origin', '*');
      return sendFile(req, reply, f, { download: (req.query as { download?: string }).download === '1', sameOrigin: false });
    }
    if (!rel || rel.endsWith('/')) rel += rel ? 'index.html' : v.entry;
    let file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return reply.code(400).send('Bad path');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      // Apps with their own page routing: unknown paths without a file extension get the main page.
      if (path.extname(rel)) return reply.code(404).type('text/plain').send('Not found');
      file = path.join(root, v.entry);
    }
    const ext = path.extname(file).toLowerCase();
    reply.type(TYPES[ext] || 'application/octet-stream');
    if (ext === '.html' || ext === '.htm') {
      reply.header('Cache-Control', 'no-store');
      const boot = {
        v: 1, nonce: run.nonce, appId: a.id, version: run.n,
        user: { id: u.id, name: u.name, email: u.email, role },
        privateKeys: JSON.parse(a.private_keys),
        data: snapshotFor(a.id, u.id),
        uploads: uploadsOn(),
      };
      let usesIdb = false;
      try { usesIdb = !!JSON.parse(v.features).indexedDB; } catch { /* old version row */ }
      return inject(fs.readFileSync(file, 'utf8'), boot, usesIdb);
    }
    reply.header('Cache-Control', 'private, max-age=3600');
    return fs.createReadStream(file);
  });
}

function shimPath() {
  return path.join(ROOT, 'runtime', 'shim.js');
}
