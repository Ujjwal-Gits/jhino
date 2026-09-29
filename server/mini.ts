import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db, newId, now, sha256, type UserRow } from './db.js';
import { HttpError, requireCreator, requireUser } from './auth.js';
import { limit, limitKey } from './security.js';
import { notify } from './plans.js';
import { baseFor } from './publicshare.js';

/*
 * The dashboard's own apps that need the server:
 * - Smart links and dynamic QR codes: jhino.com/l/<code>. One address that sends iPhone, Android, Windows
 *   and Mac visitors to different places, and whose destination the owner can change after the QR is printed.
 * - Ask me anything: jhino.com/<username>/ask takes anonymous questions; the owner answers, and answered
 *   questions show on that page. Nothing about the asker is kept (only a salted hash for rate limits).
 * - Which apps a person keeps on their Home (six at a time, their own order).
 */

db.exec(`CREATE TABLE IF NOT EXISTS smart_links (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, code TEXT NOT NULL UNIQUE COLLATE NOCASE, kind TEXT NOT NULL DEFAULT 'smart',
  title TEXT NOT NULL DEFAULT '', url TEXT NOT NULL, ios TEXT, android TEXT, windows TEXT, mac TEXT,
  clicks INTEGER NOT NULL DEFAULT 0, c_ios INTEGER NOT NULL DEFAULT 0, c_android INTEGER NOT NULL DEFAULT 0, c_desktop INTEGER NOT NULL DEFAULT 0,
  last_click_at TEXT, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS smart_links_owner ON smart_links(owner_id, created_at);
CREATE TABLE IF NOT EXISTS ask_questions (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, body TEXT NOT NULL, answer TEXT, answered_at TEXT,
  public INTEGER NOT NULL DEFAULT 1, pinned INTEGER NOT NULL DEFAULT 0, seen INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ask_owner ON ask_questions(owner_id, created_at);
CREATE TABLE IF NOT EXISTS ask_settings (user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, prompt TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS user_home_apps (user_id TEXT PRIMARY KEY, ids TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS user_interests (user_id TEXT PRIMARY KEY, interests TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  try { db.exec("ALTER TABLE ask_settings ADD COLUMN theme TEXT NOT NULL DEFAULT 'ember'"); } catch { /* column already there */ }

interface SmartRow { id: string; owner_id: string; code: string; kind: string; title: string; url: string; ios: string | null; android: string | null; windows: string | null; mac: string | null; clicks: number; c_ios: number; c_android: number; c_desktop: number; last_click_at: string | null; disabled: number; created_at: string; updated_at: string }
interface AskRow { id: string; owner_id: string; body: string; answer: string | null; answered_at: string | null; public: number; pinned: number; seen: number; created_at: string }

function target(raw: unknown, field: string, required = false): string | null {
  let s = String(raw ?? '').trim();
  if (!s) { if (required) throw new HttpError(400, 'VALIDATION_FAILED', `${field}: enter a web address.`); return null; }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  let u: URL;
  try { u = new URL(s); } catch { throw new HttpError(400, 'VALIDATION_FAILED', `${field}: that is not a web address.`); }
  // App-store and app links (itms-apps:, market:) are allowed as well as the web.
  if (!['http:', 'https:', 'itms-apps:', 'market:'].includes(u.protocol)) throw new HttpError(400, 'VALIDATION_FAILED', `${field}: use an http or https address.`);
  if (u.username || u.password) throw new HttpError(400, 'VALIDATION_FAILED', `${field}: take the user name and password out of the address.`);
  if (s.length > 2000) throw new HttpError(400, 'VALIDATION_FAILED', `${field}: that address is too long.`);
  if (/^\/l\/[a-z0-9]{6}\/?$/i.test(u.pathname) && /(^|\.)jhino\.com$/i.test(u.hostname)) throw new HttpError(400, 'VALIDATION_FAILED', `${field}: that is already a smart link. Link to where it goes instead.`);
  return u.toString();
}
const code = () => { for (;;) { const c = Array.from(crypto.randomBytes(6), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join(''); if (!db.prepare('SELECT 1 FROM smart_links WHERE code=?').get(c)) return c; } };
const smartView = (l: SmartRow, base: string) => ({
  id: l.id, code: l.code, kind: l.kind, title: l.title, url: l.url, ios: l.ios ?? '', android: l.android ?? '', windows: l.windows ?? '', mac: l.mac ?? '',
  short: `${base}/l/${l.code}`, clicks: l.clicks, byDevice: { ios: l.c_ios, android: l.c_android, desktop: l.c_desktop }, lastClickAt: l.last_click_at,
  disabled: !!l.disabled, createdAt: l.created_at, updatedAt: l.updated_at,
});
function ownSmart(req: FastifyRequest) {
  const u = requireCreator(req);
  const l = db.prepare('SELECT * FROM smart_links WHERE id=? AND owner_id=?').get((req.params as { id: string }).id, u.id) as SmartRow | undefined;
  if (!l) throw new HttpError(404, 'NOT_FOUND', 'That link does not exist.');
  return { u, l };
}

const askView = (q: AskRow) => ({ id: q.id, body: q.body, answer: q.answer ?? '', answeredAt: q.answered_at, public: !!q.public, pinned: !!q.pinned, seen: !!q.seen, createdAt: q.created_at });
const ASK_THEMES = ['ember', 'tide', 'moss', 'plum', 'sun', 'ink'];
const settingsOf = (userId: string) => {
  const r = db.prepare('SELECT enabled, prompt, theme FROM ask_settings WHERE user_id=?').get(userId) as { enabled: number; prompt: string; theme: string } | undefined;
  return { enabled: r ? !!r.enabled : true, prompt: r?.prompt || 'Send me an anonymous question', theme: r && ASK_THEMES.includes(r.theme) ? r.theme : 'ember' };
};
const personByName = (name: string) => (/^[\w-]{1,50}$/.test(name)
  ? db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE AND kind='person' AND disabled=0").get(name) as UserRow | undefined : undefined);

export function registerMini(app: FastifyInstance) {
  /* ---------- smart links and dynamic QR ---------- */
  const hit = db.prepare('UPDATE smart_links SET clicks=clicks+1, c_ios=c_ios+?, c_android=c_android+?, c_desktop=c_desktop+?, last_click_at=? WHERE id=?');
  app.get('/l/:code', async (req, reply) => {
    const l = db.prepare('SELECT * FROM smart_links WHERE code=? AND disabled=0').get((req.params as { code: string }).code) as SmartRow | undefined;
    if (!l) return reply.code(404).type('text/html').send('<!doctype html><meta name="viewport" content="width=device-width"><title>Link not found | Jhino</title><p style="font:16px system-ui;padding:40px">This link does not exist or was turned off.</p>');
    const ua = String(req.headers['user-agent'] ?? '');
    const ios = /iPhone|iPad|iPod/i.test(ua), android = !ios && /Android/i.test(ua);
    const win = !ios && !android && /Windows/i.test(ua), mac = !ios && !android && /Macintosh|Mac OS X/i.test(ua);
    const to = (ios && l.ios) || (android && l.android) || (win && l.windows) || (mac && l.mac) || l.url;
    if (!/bot|crawl|spider|preview/i.test(ua)) hit.run(ios ? 1 : 0, android ? 1 : 0, ios || android ? 0 : 1, now(), l.id);
    return reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'strict-origin-when-cross-origin').header('X-Robots-Tag', 'noindex').redirect(to, 302);
  });

  app.get('/api/smart', async (req) => {
    const u = requireCreator(req);
    const rows = db.prepare('SELECT * FROM smart_links WHERE owner_id=? ORDER BY created_at DESC LIMIT 500').all(u.id) as SmartRow[];
    const base = baseFor(req);
    return { links: rows.map((l) => smartView(l, base)) };
  });
  app.post('/api/smart', async (req) => {
    const u = requireCreator(req);
    limit(req, 'smart-create', 60, 3600_000, u.id);
    const b = (req.body ?? {}) as Record<string, unknown>;
    if ((db.prepare('SELECT COUNT(*) n FROM smart_links WHERE owner_id=?').get(u.id) as { n: number }).n >= (u.is_admin ? 10000 : 200)) throw new HttpError(403, 'LIMIT_REACHED', 'You have 200 smart links and QR codes. Delete one first.');
    const t = now(), id = newId('sl');
    db.prepare('INSERT INTO smart_links(id,owner_id,code,kind,title,url,ios,android,windows,mac,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, u.id, code(), b.kind === 'qr' ? 'qr' : 'smart', String(b.title ?? '').trim().slice(0, 120), target(b.url, 'Everyone else', true),
        target(b.ios, 'iPhone and iPad'), target(b.android, 'Android'), target(b.windows, 'Windows'), target(b.mac, 'Mac'), t, t);
    return { link: smartView(db.prepare('SELECT * FROM smart_links WHERE id=?').get(id) as SmartRow, baseFor(req)) };
  });
  app.patch('/api/smart/:id', async (req) => {
    const { u, l } = ownSmart(req);
    limit(req, 'smart-edit', 300, 3600_000, u.id);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const pick = (k: 'ios' | 'android' | 'windows' | 'mac', f: string) => (k in b ? target(b[k], f) : l[k]);
    db.prepare('UPDATE smart_links SET title=?, url=?, ios=?, android=?, windows=?, mac=?, disabled=?, updated_at=? WHERE id=?').run(
      'title' in b ? String(b.title ?? '').trim().slice(0, 120) : l.title, 'url' in b ? target(b.url, 'Everyone else', true) : l.url,
      pick('ios', 'iPhone and iPad'), pick('android', 'Android'), pick('windows', 'Windows'), pick('mac', 'Mac'),
      typeof b.disabled === 'boolean' ? (b.disabled ? 1 : 0) : l.disabled, now(), l.id);
    return { link: smartView(db.prepare('SELECT * FROM smart_links WHERE id=?').get(l.id) as SmartRow, baseFor(req)) };
  });
  app.delete('/api/smart/:id', async (req) => {
    const { l } = ownSmart(req);
    db.prepare('DELETE FROM smart_links WHERE id=?').run(l.id);
    return { ok: true };
  });

  /* ---------- ask me anything ---------- */
  app.get('/api/ask/:name', async (req) => {
    const p = personByName((req.params as { name: string }).name);
    if (!p?.username) throw new HttpError(404, 'NOT_FOUND', 'Nobody has that username.');
    const s = settingsOf(p.id);
    const answered = db.prepare('SELECT * FROM ask_questions WHERE owner_id=? AND answer IS NOT NULL AND public=1 ORDER BY pinned DESC, answered_at DESC LIMIT 60').all(p.id) as AskRow[];
    return {
      username: p.username, name: p.display_name || p.name,
      avatarUrl: p.avatar ? `/api/profile/${p.username}/avatar?v=${sha256(p.avatar).slice(0, 8)}` : null,
      enabled: s.enabled, prompt: s.prompt, theme: s.theme,
      answered: answered.map((q) => ({ id: q.id, body: q.body, answer: q.answer, answeredAt: q.answered_at, pinned: !!q.pinned })),
    };
  });
  app.post('/api/ask/:name', async (req) => {
    const p = personByName((req.params as { name: string }).name);
    if (!p?.username) throw new HttpError(404, 'NOT_FOUND', 'Nobody has that username.');
    if (!settingsOf(p.id).enabled) throw new HttpError(403, 'CLOSED', `${p.display_name || p.name} is not taking questions right now.`);
    const body = String((req.body as { body?: unknown })?.body ?? '').replace(/\s+\n/g, '\n').trim();
    if (body.length < 2) throw new HttpError(400, 'VALIDATION_FAILED', 'Write a question first.');
    if (body.length > 500) throw new HttpError(400, 'VALIDATION_FAILED', 'Keep it under 500 characters.');
    limit(req, 'ask-send', 10, 600_000, p.id);
    limitKey('ask-inbox', p.id, 300, 3600_000, 'This inbox is getting too many questions. Try again later.');
    const open = (db.prepare('SELECT COUNT(*) n FROM ask_questions WHERE owner_id=? AND answer IS NULL').get(p.id) as { n: number }).n;
    if (open >= 2000) throw new HttpError(403, 'FULL', 'This inbox is full right now.');
    db.prepare('INSERT INTO ask_questions(id,owner_id,body,created_at) VALUES(?,?,?,?)').run(newId('aq'), p.id, body, now());
    notify(p.id, 'account', 'New anonymous question', body.slice(0, 140), '/home/ask');
    return { ok: true };
  });

  app.get('/api/my/ask', async (req) => {
    const u = requireUser(req);
    const rows = db.prepare('SELECT * FROM ask_questions WHERE owner_id=? ORDER BY (answer IS NULL) DESC, created_at DESC LIMIT 1000').all(u.id) as AskRow[];
    // Opening the inbox counts as seeing them; each still shows as new this once.
    db.prepare('UPDATE ask_questions SET seen=1 WHERE owner_id=? AND seen=0').run(u.id);
    return { questions: rows.map(askView), settings: settingsOf(u.id), username: u.username };
  });
  app.put('/api/my/ask-settings', async (req) => {
    const u = requireUser(req);
    const b = (req.body ?? {}) as { enabled?: unknown; prompt?: unknown; theme?: unknown };
    const cur = settingsOf(u.id);
    db.prepare('INSERT INTO ask_settings(user_id,enabled,prompt,theme,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled, prompt=excluded.prompt, theme=excluded.theme, updated_at=excluded.updated_at')
      .run(u.id, typeof b.enabled === 'boolean' ? (b.enabled ? 1 : 0) : (cur.enabled ? 1 : 0), typeof b.prompt === 'string' ? b.prompt.trim().slice(0, 120) : cur.prompt,
        typeof b.theme === 'string' && ASK_THEMES.includes(b.theme) ? b.theme : cur.theme, now());
    return { settings: settingsOf(u.id) };
  });
  app.patch('/api/my/ask/:id', async (req) => {
    const u = requireUser(req);
    const q = db.prepare('SELECT * FROM ask_questions WHERE id=? AND owner_id=?').get((req.params as { id: string }).id, u.id) as AskRow | undefined;
    if (!q) throw new HttpError(404, 'NOT_FOUND', 'That question is gone.');
    const b = (req.body ?? {}) as { answer?: unknown; public?: unknown; pinned?: unknown; seen?: unknown };
    let answer = q.answer, at = q.answered_at;
    if (typeof b.answer === 'string') { answer = b.answer.trim().slice(0, 2000) || null; at = answer ? (q.answered_at ?? now()) : null; }
    const f = (v: unknown, cur: number) => (typeof v === 'boolean' ? (v ? 1 : 0) : cur);
    db.prepare('UPDATE ask_questions SET answer=?, answered_at=?, public=?, pinned=?, seen=? WHERE id=?').run(answer, at, f(b.public, q.public), f(b.pinned, q.pinned), answer ? 1 : f(b.seen, q.seen), q.id);
    return { question: askView(db.prepare('SELECT * FROM ask_questions WHERE id=?').get(q.id) as AskRow) };
  });
  app.delete('/api/my/ask/:id', async (req) => {
    const u = requireUser(req);
    db.prepare('DELETE FROM ask_questions WHERE id=? AND owner_id=?').run((req.params as { id: string }).id, u.id);
    return { ok: true };
  });

  /* ---------- the apps on Home ---------- */
  app.get('/api/home/apps', async (req) => {
    const u = requireUser(req);
    const r = db.prepare('SELECT ids FROM user_home_apps WHERE user_id=?').get(u.id) as { ids: string } | undefined;
    const unread = (db.prepare('SELECT COUNT(*) n FROM ask_questions WHERE owner_id=? AND seen=0 AND answer IS NULL').get(u.id) as { n: number }).n;
    return { ids: r ? (JSON.parse(r.ids) as string[]) : null, unread: { ask: unread } };
  });
  app.put('/api/home/apps', async (req) => {
    const u = requireUser(req);
    limit(req, 'tools-write', 600, 3600_000, u.id);
    const raw = (req.body as { ids?: unknown })?.ids;
    const ids = [...new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && /^[a-z]{2,16}$/.test(x)) : [])].slice(0, 9);
    db.prepare('INSERT INTO user_home_apps(user_id,ids,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET ids=excluded.ids, updated_at=excluded.updated_at').run(u.id, JSON.stringify(ids), now());
    return { ids };
  });

  /* ---------- what the person uses Jhino for (welcome step) ---------- */
  const INTERESTS = ['bio', 'hosting', 'domain', 'qr', 'files', 'focus', 'money', 'social'];
  app.get('/api/home/interests', async (req) => {
    const u = requireUser(req);
    const r = db.prepare('SELECT interests FROM user_interests WHERE user_id=?').get(u.id) as { interests: string } | undefined;
    const made = (db.prepare('SELECT created_at FROM users WHERE id=?').get(u.id) as { created_at: string } | undefined)?.created_at;
    // Only accounts made in the last week get the welcome; older ones never saw it and should not now.
    const fresh = !!made && Date.now() - new Date(made).getTime() < 7 * 86400_000;
    return { interests: r ? (JSON.parse(r.interests) as string[]) : [], done: !!r, onboard: !r && fresh };
  });
  app.put('/api/home/interests', async (req) => {
    const u = requireUser(req);
    limit(req, 'tools-write', 600, 3600_000, u.id);
    const raw = (req.body as { interests?: unknown })?.interests;
    if (!Array.isArray(raw) || raw.length > INTERESTS.length || raw.some((x) => typeof x !== 'string' || !INTERESTS.includes(x))) throw new HttpError(400, 'VALIDATION_FAILED', 'Pick from the list.');
    const interests = [...new Set(raw as string[])];
    db.prepare('INSERT INTO user_interests(user_id,interests,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET interests=excluded.interests, updated_at=excluded.updated_at').run(u.id, JSON.stringify(interests), now());
    return { interests, done: true, onboard: false };
  });
}
