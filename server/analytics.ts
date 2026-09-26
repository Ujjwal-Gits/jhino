import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { db, sha256 } from './db.js';
import { requireAdmin } from './auth.js';
import { clientInfo, limit, setSetting, setting } from './security.js';

/*
 * Site analytics for Super Admin: everything people open on Jhino (the website, dashboards, public
 * pages and every app, whoever made it), live and by day.
 *
 * Privacy: a visitor is a daily-changing hash of address + browser with a secret salt, so no address
 * is stored and the same person cannot be followed from one day to the next. Bots are left out.
 */

export type Area = 'website' | 'dashboard' | 'app' | 'profile' | 'link';
const AREAS: Area[] = ['website', 'dashboard', 'app', 'profile', 'link'];

db.exec(`
  CREATE TABLE IF NOT EXISTS site_days(day TEXT NOT NULL, dim TEXT NOT NULL, key TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, visitors INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day, dim, key));
  CREATE TABLE IF NOT EXISTS site_seen(day TEXT NOT NULL, scope TEXT NOT NULL, visitor TEXT NOT NULL, PRIMARY KEY(day, scope, visitor));
  CREATE TABLE IF NOT EXISTS site_hours(hour TEXT PRIMARY KEY, views INTEGER NOT NULL DEFAULT 0);
`);

let salt: { day: string; v: string } | null = null;
function daySalt(day: string) {
  if (salt?.day === day) return salt.v;
  let secret = setting('analytics_secret');
  if (!secret) { secret = crypto.randomBytes(32).toString('hex'); setSetting('analytics_secret', secret); }
  salt = { day, v: sha256(`${secret}:site:${day}`) };
  return salt.v;
}

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora link|whatsapp|telegrambot|discordbot|headlesschrome|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|go-http|axios|node-fetch|undici/i;
function deviceOf(ua: string) { return /iPad|Tablet|SM-T/i.test(ua) ? 'Tablet' : /Mobi|Android|iPhone|iPod/i.test(ua) ? 'Phone' : 'Computer'; }
function browserOf(ua: string) {
  return /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
}
const ownHost = (req: FastifyRequest) => (config.publicUrl ? new URL(config.publicUrl).hostname : String(req.headers.host ?? '').split(':')[0]).replace(/^www\./, '');
function refOf(ref: unknown, req: FastifyRequest) {
  const s = String(ref ?? '').trim();
  if (!s) return 'Direct';
  try {
    const h = new URL(s).hostname.replace(/^(www|m|l|lm)\./, '').toLowerCase();
    if (h === ownHost(req)) return 'Jhino';
    const known: [RegExp, string][] = [[/instagram\.com$/, 'Instagram'], [/facebook\.com$|fb\.com$/, 'Facebook'], [/t\.co$|twitter\.com$|x\.com$/, 'X'],
      [/tiktok\.com$/, 'TikTok'], [/youtube\.com$|youtu\.be$/, 'YouTube'], [/linkedin\.com$|lnkd\.in$/, 'LinkedIn'], [/google\./, 'Google'], [/bing\.com$/, 'Bing'],
      [/whatsapp\.com$|wa\.me$/, 'WhatsApp'], [/viber\.com$/, 'Viber'], [/threads\.net$/, 'Threads'], [/chatgpt\.com$|openai\.com$/, 'ChatGPT']];
    for (const [re, name] of known) if (re.test(h)) return name;
    return h.slice(0, 80);
  } catch { return 'Direct'; }
}

/* ---------------- live: who is on Jhino right now ---------------- */
interface Live { at: number; area: Area; key: string; title: string; country: string | null; device: string }
const live = new Map<string, Live>();
const LIVE_MS = 3 * 60_000;
setInterval(() => { const t = Date.now() - LIVE_MS; for (const [k, v] of live) if (v.at < t) live.delete(k); }, 30_000).unref();
interface Hit { at: number; area: Area; title: string; country: string | null; device: string }
const recent: Hit[] = [];

const stmt = {
  view: db.prepare('INSERT INTO site_days(day,dim,key,views,visitors) VALUES(?,?,?,1,0) ON CONFLICT(day,dim,key) DO UPDATE SET views=views+1'),
  seen: db.prepare('INSERT OR IGNORE INTO site_seen(day,scope,visitor) VALUES(?,?,?)'),
  visitor: db.prepare('UPDATE site_days SET visitors=visitors+1 WHERE day=? AND dim=? AND key=?'),
  hour: db.prepare('INSERT INTO site_hours(hour,views) VALUES(?,1) ON CONFLICT(hour) DO UPDATE SET views=views+1'),
};
setInterval(() => {
  const old = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  db.prepare('DELETE FROM site_seen WHERE day < ?').run(old);
  db.prepare('DELETE FROM site_hours WHERE hour < ?').run(new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 13));
}, 6 * 3600e3).unref();

/**
 * Count one view (and keep the visitor in the live list). `beat` only keeps them live (a page still open).
 * Never throws: analytics must not break a page.
 */
export function track(req: FastifyRequest, t: { area: Area; key: string; title: string; ref?: unknown; path?: string; beat?: boolean }) {
  try {
    const ua = String(req.headers['user-agent'] ?? '');
    if (!ua || BOT.test(ua)) return;
    const day = new Date().toISOString().slice(0, 10);
    const visitor = sha256(`${daySalt(day)}:${req.ip}:${ua}`).slice(0, 32);
    const { country } = clientInfo(req);
    const device = deviceOf(ua);
    live.set(visitor, { at: Date.now(), area: t.area, key: t.key, title: t.title, country, device });
    if (t.beat) return;
    const dims: [string, string][] = [['all', ''], ['area', t.area], ['country', country ?? '—'], ['device', device], ['browser', browserOf(ua)], ['ref', refOf(t.ref, req)]];
    if (t.area === 'app') dims.push(['app', t.key]);
    if (t.area === 'profile') dims.push(['profile', t.key]);
    if (t.area === 'website' && t.path) dims.push(['page', t.path]);
    db.transaction(() => {
      for (const [dim, key] of dims) {
        stmt.view.run(day, dim, key);
        if (stmt.seen.run(day, `${dim}:${key}`, visitor).changes) stmt.visitor.run(day, dim, key);
      }
      stmt.hour.run(new Date().toISOString().slice(0, 13));
    })();
    recent.unshift({ at: Date.now(), area: t.area, title: t.title, country, device });
    if (recent.length > 40) recent.length = 40;
  } catch { /* never break a page for a count */ }
}

/* What a Jhino page address is: the website, someone's dashboard, a public page, or an app. */
const WEBSITE = /^\/(|help|terms|privacy|pricing|login|signup|forgot|reset|verify|invite\/[\w-]+)$/;
const SKIP = /^\/(admin|_themes|api|run|_jhino|go|p)(\/|$)/;
const appName = (id: string) => (db.prepare('SELECT name FROM apps WHERE id=?').get(id) as { name: string } | undefined)?.name ?? null;
function classify(req: FastifyRequest, raw: string): { area: Area; key: string; title: string; path?: string } | null {
  const path = ('/' + String(raw ?? '').split(/[?#]/)[0].replace(/^\/+/, '')).replace(/\/+$/, '') || '/';
  if (path.length > 200 || SKIP.test(path)) return null;
  if (WEBSITE.test(path)) { const p = path.startsWith('/invite/') ? '/invite' : path; return { area: 'website', key: p, title: p === '/' ? 'Home page' : p, path: p }; }
  const seg = path.split('/').filter(Boolean);
  // An app: in the dashboard (/apps/<id>), at a share link (/s/<token>), under a username, or at a top-level address.
  let appId: string | null = null;
  if (seg[0] === 'apps' && seg[1] && /^[\w-]{3,64}$/.test(seg[1])) appId = seg[1];
  else if (seg[0] === 's' && seg[1]) appId = (db.prepare('SELECT id FROM apps WHERE share_token=? AND deleted_at IS NULL').get(seg[1]) as { id: string } | undefined)?.id ?? null;
  else if (seg.length === 2) appId = (db.prepare('SELECT a.id FROM apps a JOIN users u ON u.id=a.owner_id WHERE u.username=? COLLATE NOCASE AND a.slug=? COLLATE NOCASE AND a.deleted_at IS NULL').get(seg[0], seg[1]) as { id: string } | undefined)?.id ?? null;
  else if (seg.length === 1) appId = (db.prepare('SELECT id FROM apps WHERE root_slug=? COLLATE NOCASE AND deleted_at IS NULL').get(seg[0]) as { id: string } | undefined)?.id ?? null;
  if (appId) { const name = appName(appId); if (name) return { area: 'app', key: appId, title: name }; }
  if (seg.length === 1 && /^[\w-]{2,50}$/.test(seg[0])) {
    const u = db.prepare("SELECT id, username FROM users WHERE username=? COLLATE NOCASE AND kind='person'").get(seg[0]) as { id: string; username: string } | undefined;
    if (u) {
      if (req.user?.id === u.id) return { area: 'dashboard', key: 'page', title: 'Their own page (editing)' };
      return { area: 'profile', key: u.username, title: `@${u.username}` };
    }
  }
  // The rest of the signed-in dashboard: apps list, account, links, builder…
  if (req.user) return { area: 'dashboard', key: seg[0] ?? '', title: `/${seg[0] ?? ''}` };
  return null;
}

/** An app opened straight at /run (not inside a Jhino page, which counts itself). */
export function trackRun(req: FastifyRequest, appId: string, name: string) {
  const ref = String(req.headers.referer ?? '');
  try { if (ref && new URL(ref).hostname.replace(/^www\./, '') === ownHost(req)) return; } catch { /* count it */ }
  track(req, { area: 'app', key: appId, title: name, ref });
}

/* ---------------- Super Admin ---------------- */
const day = (offset: number) => new Date(Date.now() - offset * 864e5).toISOString().slice(0, 10);
function top(from: string, to: string, dim: string, n = 10) {
  return db.prepare('SELECT key, SUM(views) views, SUM(visitors) visitors FROM site_days WHERE day>=? AND day<=? AND dim=? GROUP BY key ORDER BY views DESC LIMIT ?').all(from, to, dim, n) as { key: string; views: number; visitors: number }[];
}

export function registerSiteAnalytics(app: FastifyInstance) {
  /** The dashboard's pages report where they are (and every minute while open, to stay "live"). */
  app.post('/api/t', async (req) => {
    limit(req, 'track', 120, 60_000);
    const b = (req.body ?? {}) as { p?: string; r?: string; h?: boolean };
    const c = classify(req, String(b.p ?? ''));
    if (c && !(req.user?.is_admin && c.area === 'dashboard')) track(req, { ...c, ref: b.r, beat: !!b.h });
    return { ok: true };
  });

  app.get('/api/admin/analytics/live', async (req) => {
    requireAdmin(req);
    const t = Date.now() - LIVE_MS;
    const now = [...live.values()].filter((v) => v.at >= t);
    const count = <K extends string>(f: (v: Live) => K | null) => {
      const m = new Map<K, number>();
      for (const v of now) { const k = f(v); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([key, n]) => ({ key, n }));
    };
    const apps = count((v) => (v.area === 'app' ? v.key : null)).map((x) => ({ ...x, name: appName(x.key) ?? 'Deleted app' }));
    return {
      active: now.length,
      areas: AREAS.map((a) => ({ key: a, n: now.filter((v) => v.area === a).length })),
      apps,
      pages: count((v) => (v.area === 'app' ? null : v.title)),
      countries: count((v) => v.country ?? '—'),
      devices: count((v) => v.device),
      recent: recent.slice(0, 25).map((h) => ({ ...h, ago: Math.round((Date.now() - h.at) / 1000) })),
    };
  });

  app.get('/api/admin/analytics', async (req) => {
    requireAdmin(req);
    const days = Math.max(1, Math.min(365, Number((req.query as { days?: string }).days) || 30));
    const from = day(days - 1), to = day(0), pFrom = day(days * 2 - 1), pTo = day(days);
    const rows = new Map((db.prepare("SELECT day, views, visitors FROM site_days WHERE dim='all' AND key='' AND day>=?").all(from) as { day: string; views: number; visitors: number }[]).map((r) => [r.day, r]));
    const series = Array.from({ length: days }, (_, i) => { const d = day(days - 1 - i); const r = rows.get(d); return { day: d, views: r?.views ?? 0, visitors: r?.visitors ?? 0 }; });
    const sum = (a: string, b: string) => db.prepare("SELECT COALESCE(SUM(views),0) views, COALESCE(SUM(visitors),0) visitors FROM site_days WHERE dim='all' AND key='' AND day>=? AND day<=?").get(a, b) as { views: number; visitors: number };
    const hoursFrom = new Date(Date.now() - 23 * 3600e3).toISOString().slice(0, 13);
    const hourRows = new Map((db.prepare('SELECT hour, views FROM site_hours WHERE hour>=?').all(hoursFrom) as { hour: string; views: number }[]).map((r) => [r.hour, r.views]));
    const hours = Array.from({ length: 24 }, (_, i) => { const h = new Date(Date.now() - (23 - i) * 3600e3).toISOString().slice(0, 13); return { hour: h, views: hourRows.get(h) ?? 0 }; });
    const apps = top(from, to, 'app', 15).map((a) => {
      const r = db.prepare('SELECT a.name, a.slug, a.root_slug rootSlug, u.username, u.name ownerName FROM apps a JOIN users u ON u.id=a.owner_id WHERE a.id=?').get(a.key) as { name: string; slug: string | null; rootSlug: string | null; username: string | null; ownerName: string } | undefined;
      return { ...a, name: r?.name ?? 'Deleted app', owner: r ? (r.username ? `@${r.username}` : r.ownerName) : '', address: r?.rootSlug ? `/${r.rootSlug}` : r?.slug && r.username ? `/${r.username}/${r.slug}` : null };
    });
    return {
      days, series, hours,
      totals: sum(from, to), previous: sum(pFrom, pTo),
      areas: top(from, to, 'area', 10), apps, pages: top(from, to, 'page', 12), profiles: top(from, to, 'profile', 10),
      countries: top(from, to, 'country', 12), refs: top(from, to, 'ref', 12), devices: top(from, to, 'device', 5), browsers: top(from, to, 'browser', 8),
    };
  });
}

/* ---------------- Super Admin: apps made on Jhino ---------------- */
// How an app was made, from its first version: built with Create app, an uploaded HTML file, or a ZIP.
const KIND = `CASE WHEN v.builder IS NOT NULL THEN 'built' WHEN lower(v.source_name) LIKE '%.zip' THEN 'zip' ELSE 'html' END`;

export function registerCreations(app: FastifyInstance) {
  app.get('/api/admin/creations', async (req) => {
    requireAdmin(req);
    const days = Math.max(1, Math.min(365, Number((req.query as { days?: string }).days) || 30));
    const from = day(days - 1), pFrom = day(days * 2 - 1), pTo = day(days);
    const first = `SELECT a.id, a.name, a.owner_id, a.created_at, a.deleted_at, ${KIND} kind FROM apps a JOIN app_versions v ON v.app_id=a.id AND v.n=1`;
    const kinds = (sql: string, ...args: unknown[]) => Object.fromEntries((db.prepare(`SELECT kind, COUNT(*) n FROM (${first}) ${sql} GROUP BY kind`).all(...args) as { kind: string; n: number }[]).map((r) => [r.kind, r.n]));
    const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;
    const perDay = new Map((db.prepare(`SELECT substr(created_at,1,10) d, kind, COUNT(*) n FROM (${first}) WHERE created_at >= ? GROUP BY d, kind`).all(from) as { d: string; kind: string; n: number }[])
      .reduce((m, r) => m.set(r.d, { ...(m.get(r.d) ?? {}), [r.kind]: r.n }), new Map<string, Record<string, number>>()));
    const buildsPerDay = new Map((db.prepare('SELECT substr(created_at,1,10) d, COUNT(*) n FROM app_versions WHERE created_at >= ? GROUP BY d').all(from) as { d: string; n: number }[]).map((r) => [r.d, r.n]));
    const series = Array.from({ length: days }, (_, i) => {
      const d = day(days - 1 - i); const k = perDay.get(d) ?? {};
      return { day: d, built: k.built ?? 0, html: k.html ?? 0, zip: k.zip ?? 0, builds: buildsPerDay.get(d) ?? 0 };
    });
    const creators = db.prepare(`SELECT u.id, u.name, u.username, u.email, COUNT(DISTINCT a.id) apps,
        (SELECT COUNT(*) FROM app_versions v JOIN apps x ON x.id=v.app_id WHERE x.owner_id=u.id AND v.created_at >= ?) builds
      FROM apps a JOIN users u ON u.id=a.owner_id WHERE a.created_at >= ? GROUP BY u.id ORDER BY apps DESC, builds DESC LIMIT 10`).all(from, from);
    const recent = db.prepare(`SELECT f.id, f.name, f.kind, f.created_at createdAt, f.deleted_at deletedAt, u.name owner, u.username,
        (SELECT COUNT(*) FROM app_versions WHERE app_id=f.id) versions FROM (${first}) f JOIN users u ON u.id=f.owner_id ORDER BY f.created_at DESC LIMIT 25`).all();
    return {
      days, series, creators, recent,
      total: { apps: count('SELECT COUNT(*) n FROM apps'), live: count('SELECT COUNT(*) n FROM apps WHERE deleted_at IS NULL'), trash: count('SELECT COUNT(*) n FROM apps WHERE deleted_at IS NOT NULL'),
        versions: count('SELECT COUNT(*) n FROM app_versions'), kinds: kinds('') },
      period: { apps: count('SELECT COUNT(*) n FROM apps WHERE created_at >= ?', from), builds: count('SELECT COUNT(*) n FROM app_versions WHERE created_at >= ?', from), kinds: kinds('WHERE created_at >= ?', from),
        makers: count('SELECT COUNT(DISTINCT owner_id) n FROM apps WHERE created_at >= ?', from) },
      previous: { apps: count('SELECT COUNT(*) n FROM apps WHERE created_at >= ? AND created_at < ?', pFrom, from), builds: count('SELECT COUNT(*) n FROM app_versions WHERE created_at >= ? AND created_at < ?', pFrom, from) },
    };
  });
}
