import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config, ROOT } from './config.js';
import { db, now, sha256, roleOf, type AppRow, type UserRow } from './db.js';
import { HttpError, checkLogin, publicUser, requireUser } from './auth.js';
import { openStream, watch } from './realtime.js';
import { access } from './apps.js';

/*
 * Downloaded HTML files. The owner or a member downloads an app as one .html file. Opened on any computer,
 * it asks for the person's sign-in once, keeps a key for that one app, and shows the same app, live,
 * talking to this server (it needs to be online). Removing the person or changing their password stops the key.
 *
 * A file opened from disk has the origin "null", so these routes answer CORS for it. The key travels in the
 * Authorization header, never in a cookie, so other sites cannot use it on the person's behalf.
 */

const KEY_PREFIX = 'jk_';
const KEY_IDLE_DAYS = 180;

/** The only API paths a file's key opens: the app's own data, files, people, activity, Trash and launch. */
function allowed(appId: string, url: string) {
  const p = url.split('?')[0];
  if (p.startsWith(`/api/desk/${appId}/`)) return true;
  const rest = p.startsWith(`/api/apps/${appId}/`) ? p.slice(`/api/apps/${appId}/`.length) : null;
  return rest !== null && /^(kv|records|files|people|activity|trash|launch)(\/|$)/.test(rest);
}

export function registerDesk(app: FastifyInstance) {
  // CORS for files opened from disk (origin "null") on the routes they use. Answers preflights here.
  app.addHook('onRequest', async (req, reply) => {
    if (req.headers.origin !== 'null' || !(req.url.startsWith('/api/desk/') || req.url.startsWith('/api/apps/'))) return;
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
      reply.header('Access-Control-Allow-Headers', 'authorization, content-type, x-jhino');
      reply.header('Access-Control-Max-Age', '600');
      if (req.headers['access-control-request-private-network'] === 'true') reply.header('Access-Control-Allow-Private-Network', 'true');
      return reply.code(204).send();
    }
  });

  // A file's key: the person, for that one app only.
  app.addHook('onRequest', async (req) => {
    const auth = req.headers.authorization;
    if (req.user || !auth || !auth.startsWith('Bearer ' + KEY_PREFIX)) return;
    const k = db.prepare(`SELECT k.app_id, k.last_used_at, u.* FROM app_keys k JOIN users u ON u.id=k.user_id WHERE k.key_hash=?`)
      .get(sha256(auth.slice(7))) as (UserRow & { app_id: string; last_used_at: string }) | undefined;
    if (!k || k.disabled || !roleOf(k.app_id, k.id) || Date.parse(k.last_used_at) < Date.now() - KEY_IDLE_DAYS * 864e5) return;
    if (!allowed(k.app_id, req.url)) return;
    const { app_id: appId, last_used_at: last, ...user } = k;
    req.user = user as UserRow;
    req.desk = appId;
    if (Date.parse(last) < Date.now() - 3600e3) db.prepare('UPDATE app_keys SET last_used_at=? WHERE key_hash=?').run(now(), sha256(auth.slice(7)));
  });

  /** Sign in from the file: a key for this app, kept by the file on that computer. */
  app.post('/api/desk/:appId/login', async (req) => {
    const { appId } = req.params as { appId: string };
    const b = (req.body ?? {}) as { email?: string; password?: string };
    const u = await checkLogin(req, b.email, b.password);
    const a = db.prepare('SELECT * FROM apps WHERE id=?').get(appId) as AppRow | undefined;
    const role = roleOf(appId, u.id);
    if (!a || a.deleted_at || !role) throw new HttpError(403, 'NOT_MEMBER', 'This sign-in does not have access to this app. Ask the person who sent you the file.');
    const key = KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO app_keys(key_hash,app_id,user_id,created_at,last_used_at) VALUES(?,?,?,?,?)').run(sha256(key), appId, u.id, now(), now());
    return { key, user: publicUser(u), role, app: { id: a.id, name: a.name } };
  });

  app.get('/api/desk/:appId/me', async (req) => {
    const { appId } = req.params as { appId: string };
    const u = requireUser(req);
    const a = db.prepare('SELECT id, name, live_version FROM apps WHERE id=?').get(appId) as { id: string; name: string; live_version: number };
    return { user: publicUser(u), role: roleOf(appId, u.id), app: { id: a.id, name: a.name, version: a.live_version } };
  });

  app.post('/api/desk/:appId/logout', async (req) => {
    const auth = req.headers.authorization ?? '';
    if (auth.startsWith('Bearer ' + KEY_PREFIX)) db.prepare('DELETE FROM app_keys WHERE key_hash=?').run(sha256(auth.slice(7)));
    return { ok: true };
  });

  /** Live changes for the file, as server-sent events (read with fetch, since the key is a header). */
  app.get('/api/desk/:appId/events', async (req, reply) => {
    const { appId } = req.params as { appId: string };
    const u = requireUser(req);
    if (req.desk !== appId) throw new HttpError(403, 'FORBIDDEN', 'Not for this app.');
    reply.hijack();
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    const c = openStream(u.id, reply.raw);
    watch(c.id, u.id, appId);
  });

  /** The app as one .html file to keep, open and send to the people in it. */
  app.get('/api/apps/:id/download', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { app: a } = access(req, id);
    let accent = '#1f6f5c';
    const v = db.prepare('SELECT builder FROM app_versions WHERE app_id=? AND n=?').get(a.id, a.live_version) as { builder: string | null } | undefined;
    try { const cfg = v?.builder ? JSON.parse(v.builder) : null; if (cfg?.design?.accent && /^#[0-9a-f]{6}$/i.test(cfg.design.accent)) accent = cfg.design.accent; } catch { /* an old build */ }
    const server = config.publicUrl || `${req.protocol}://${req.headers.host}`;
    const conf = { v: 1, server, appId: a.id, name: a.name, accent };
    // Safe inside a <script>: no "<" and no JS line separators in the JSON.
    const unsafe = new RegExp('[<' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
    const json = JSON.stringify(conf).replace(unsafe, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
    const html = fs.readFileSync(path.join(ROOT, 'runtime', 'desk.html'), 'utf8')
      .replace('{{TITLE}}', () => esc(a.name))
      .replace('{{CONFIG}}', () => json);
    const safe = a.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'app';
    reply.header('Content-Type', 'text/html; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${safe}.html"`)
      .header('Cache-Control', 'no-store');
    return html;
  });
}
