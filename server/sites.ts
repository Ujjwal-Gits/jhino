import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ROOT, config } from './config.js';
import { db, newId, now, logActivity, type AppRow } from './db.js';
import { HttpError, requireCreator, validateName } from './auth.js';
import { access } from './apps.js';
import { appDir } from './packages.js';
import { publish } from './realtime.js';
import { assertCanCreate, notify } from './plans.js';
import { SYSTEM_PATHS, assertNameFree, baseFor, collaborative, readAddressRequest, setSharing, usernameOf } from './publicshare.js';
import { filePath, loadFile } from './files.js';
import { limit, limitKey, uploadsOn } from './security.js';
import { creditLine } from './customdomains.js';
import {
  CATEGORIES, BLOCKS, FONTS, PRESETS, blankSite, esc, blockDef, cleanPlain, cleanSite, filesUsed, findBlock, presetById, textOf,
  type Page, type Site,
} from './site/schema.js';
import { libraryAsset, pageFile, relativePageHref, renderDocument, type RenderCtx } from './site/render.js';
import { finishSiteHtml, siteCsp } from './site/serve.js';

/*
 * Websites (a kind of app). The draft lives on the app (apps.site_draft) and is saved as the owner edits.
 * Publish renders every page to static HTML in a new version folder (index.html, <slug>/index.html,
 * assets/), so version history, rollback, custom domains and Share work exactly as for any app. The
 * version row keeps the site JSON it was made from (app_versions.site).
 *
 * A public site opens straight from its address (jhino.com/<user>/<name>/ and its pages below it): plain
 * HTML, no Jhino page around it. Password and private sites open through the usual Jhino link flow.
 * Forms post to /_jhino/site-form and land in site_submissions (the editor's Submissions tab).
 */

const bad = (msg: string) => new HttpError(400, 'VALIDATION_FAILED', msg);
const MAX_JSON = 1_500_000;
const FORM_PATH = '/_jhino/site-form';

/* ---------------- templates (builder/site-templates/*.json) ---------------- */
interface Template { id: string; name: string; category: string; description: string; site: Site }
let tplCache: { at: number; list: Template[] } | null = null;
export function templates(): Template[] {
  if (tplCache && (config.isProd || Date.now() - tplCache.at < 3000)) return tplCache.list;
  const dir = path.join(ROOT, 'builder', 'site-templates');
  const list: Template[] = [];
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { /* none yet */ }
  for (const f of names) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const id = String(raw.id ?? f.replace(/\.json$/, '')).replace(/[^\w-]/g, '').slice(0, 40);
      list.push({ id, name: cleanPlain(raw.name, 60) || id, category: cleanPlain(raw.category, 40) || 'Other', description: cleanPlain(raw.description, 240), site: cleanSite(raw.site) });
    } catch (e) { console.warn(`  [sites] template ${f} could not be read: ${(e as Error).message}`); }
  }
  tplCache = { at: Date.now(), list };
  return list;
}

/* ---------------- loading and saving ---------------- */
interface SiteApp extends AppRow { site_draft: string | null; site_draft_at: string | null; seo_on?: number }
function siteApp(req: FastifyRequest, id: string) {
  const r = access(req, id, 'owner');
  const a = db.prepare('SELECT * FROM apps WHERE id=?').get(id) as SiteApp;
  if (!a.site_draft) throw new HttpError(404, 'NOT_A_SITE', 'This app is not a website.');
  return { ...r, a };
}
const draftOf = (a: SiteApp): Site => cleanSite(JSON.parse(a.site_draft!));
function liveSite(appId: string): { site: Site; n: number } | null {
  const v = db.prepare('SELECT v.n, v.site FROM app_versions v JOIN apps a ON a.id=v.app_id AND v.n=a.live_version WHERE a.id=?').get(appId) as { n: number; site: string | null } | undefined;
  if (!v?.site) return null;
  try { return { site: JSON.parse(v.site) as Site, n: v.n }; } catch { return null; }
}
function readSite(raw: unknown): Site {
  if (!raw || typeof raw !== 'object') throw bad('The site is missing.');
  if (JSON.stringify(raw).length > MAX_JSON) throw bad('This site is too large to save. Remove some pages or blocks.');
  return cleanSite(raw);
}
/** The address people open, for the editor's Publish button. */
function liveUrl(req: FastifyRequest, a: AppRow): string | null {
  const base = baseFor(req).replace(/\/$/, '');
  const dom = db.prepare("SELECT hostname FROM custom_domains WHERE app_id=? AND status='active' AND disabled_at IS NULL ORDER BY created_at LIMIT 1").get(a.id) as { hostname: string } | undefined;
  if (dom) return `https://${dom.hostname}/`;
  const u = usernameOf(a.owner_id);
  if (a.root_slug) return `${base}/${a.root_slug}/`;
  if (a.slug && u) return `${base}/${u}/${a.slug}/`;
  return a.share_token ? `${base}/s/${a.share_token}` : null;
}

/* ---------------- publishing ---------------- */
const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };
const MANIFEST = (name: string) => JSON.stringify({ specVersion: 1, name, version: '1.0.0', sdkVersion: 1, capabilities: [], collections: {} });

/** Render every page into a new version folder and make it live. */
export function publishSite(appId: string, userId: string, site: Site, note = 'published the website'): number {
  const n = ((db.prepare('SELECT MAX(n) n FROM app_versions WHERE app_id=?').get(appId) as { n: number | null }).n || 0) + 1;
  const dest = appDir(appId, n);
  if (fs.existsSync(dest)) throw new Error('version folder already exists');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const staging = path.join(path.dirname(dest), `.staging-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(path.join(staging, 'assets'), { recursive: true });
  let files = 0, size = 0;
  try {
    // Photos uploaded to the app are copied in, so the published site never depends on the editor's files.
    const copied = new Map<string, string>();
    for (const fid of filesUsed(site)) {
      const f = loadFile(appId, fid);
      if (!f || !EXT[f.type] || !fs.existsSync(filePath(f))) continue;
      const name = `${fid}${EXT[f.type]}`;
      fs.copyFileSync(filePath(f), path.join(staging, 'assets', name));
      copied.set(fid, name);
      files++; size += f.size;
    }
    for (const page of site.pages) {
      const up = page.slug ? '../' : '';
      const ctx: RenderCtx = {
        mode: 'publish', appId, site, page, formAction: FORM_PATH,
        pageHref: (p: Page) => relativePageHref(page, p),
        asset: (src) => {
          if (src.startsWith('file:')) { const nm = copied.get(src.slice(5)); return nm ? { url: `${up}assets/${nm}` } : null; }
          if (src.startsWith('lib:')) return libraryAsset(src.slice(4));
          return /^https:\/\//.test(src) ? { url: src } : null;
        },
      };
      const html = renderDocument(ctx);
      const file = path.join(staging, pageFile(page));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, html);
      files++; size += Buffer.byteLength(html);
    }
    fs.renameSync(staging, dest);
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw e;
  }
  const t = now();
  try {
    db.transaction(() => {
      db.prepare('INSERT INTO app_versions(app_id,n,entry,file_count,size,features,source_name,uploaded_by,created_at,manifest,site) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(appId, n, 'index.html', files, size, '{}', 'Website builder', userId, t, MANIFEST(site.name), JSON.stringify(site));
      db.prepare('UPDATE apps SET live_version=?, updated_at=? WHERE id=?').run(n, t, appId);
      logActivity(appId, userId, note, `version ${n}`);
    })();
  } catch (e) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw e;
  }
  publish(appId, 'app-updated', { reason: 'version', version: n });
  return n;
}

/** Version 1 of a new site: a quiet "coming soon" page in its theme, until the owner publishes. */
function comingSoon(site: Site): Site {
  return cleanSite({
    ...site, header: null, footer: null,
    pages: [{ id: 'home', slug: '', title: 'Home', seoTitle: site.name, blocks: [{ type: 'hero', variant: 'text', props: { eyebrow: '', title: site.name, text: 'This website is being made. Please check back soon.', primary: { label: '', href: '' }, secondary: { label: '', href: '' } }, style: { bg: 'page', space: 'l' } }] }],
  });
}

/* ---------------- serving a public site at its address ---------------- */
const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };

function sitePage(reply: FastifyReply, status: number, title: string, text: string) {
  reply.code(status).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  return reply.send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><body style="font:17px/1.6 Georgia,serif;max-width:560px;margin:14vh auto;padding:0 24px;color:#1b1b1a;background:#fbfaf7"><h1 style="font-weight:500;font-size:2rem;margin:0 0 12px">${title}</h1><p style="margin:0">${text}</p></body></html>`);
}

type Found = { a: SiteApp & { n: number }; root: string; rest: string[] };
function findPublicSite(pathname: string): Found | null {
  const seg = pathname.split('/').slice(1);
  if (!seg[0] || SYSTEM_PATHS.has(seg[0].toLowerCase()) || !/^[\w-]{1,64}$/.test(seg[0])) return null;
  const q = `SELECT a.*, v.n n FROM apps a JOIN app_versions v ON v.app_id=a.id AND v.n=a.live_version WHERE a.deleted_at IS NULL AND v.site IS NOT NULL`;
  if (seg.length >= 2 && /^[\w-]{2,64}$/.test(seg[1])) {
    const a = db.prepare(`${q} AND a.slug=? COLLATE NOCASE AND a.owner_id=(SELECT id FROM users WHERE username=? COLLATE NOCASE)`).get(seg[1], seg[0]) as Found['a'] | undefined;
    if (a) return { a, root: `/${seg[0]}/${seg[1]}/`, rest: seg.slice(2) };
  }
  const a = db.prepare(`${q} AND a.root_slug=? COLLATE NOCASE`).get(seg[0]) as Found['a'] | undefined;
  return a ? { a, root: `/${seg[0]}/`, rest: seg.slice(1) } : null;
}

async function servePublic(req: FastifyRequest, reply: FastifyReply, f: Found) {
  const { a, rest } = f;
  const [pathname, qs = ''] = req.url.split('?');
  const dir = appDir(a.id, a.n);
  const base = baseFor(req).replace(/\/$/, '');
  (req as { jhinoSite?: boolean }).jhinoSite = true;
  reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'strict-origin-when-cross-origin').header('Content-Security-Policy', siteCsp(config.cookieSecure));
  // Files of the version (photos copied in at publish).
  if (rest[0] === 'assets' && rest.length === 2 && /^[\w-]{1,80}\.(png|jpe?g|webp|gif|avif)$/i.test(rest[1])) {
    const file = path.join(dir, 'assets', rest[1]);
    if (!fs.existsSync(file)) return reply.code(404).type('text/plain').send('Not found');
    reply.type(TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream').header('Cache-Control', 'public, max-age=86400');
    return req.method === 'HEAD' ? reply.send() : reply.send(fs.createReadStream(file));
  }
  const clean = rest.filter(Boolean);
  if (clean.length > 1 || (clean[0] && !/^[a-z0-9-]{1,42}$/.test(clean[0]))) return sitePage(reply, 404, 'Page not found', `There is no page at this address. <a href="${f.root}">Go to the home page</a>.`);
  // Pages are folders: /name/ and /name/about/, so their relative links work.
  if (!pathname.endsWith('/')) return reply.redirect(pathname + '/' + (qs ? `?${qs}` : ''), 301);
  const file = path.join(dir, clean[0] ? `${clean[0]}/index.html` : 'index.html');
  if (!fs.existsSync(file)) return sitePage(reply, 404, 'Page not found', `There is no page at this address. <a href="${f.root}">Go to the home page</a>.`);
  const dom = db.prepare("SELECT hostname FROM custom_domains WHERE app_id=? AND status='active' AND disabled_at IS NULL ORDER BY created_at LIMIT 1").get(a.id) as { hostname: string } | undefined;
  const canonical = dom ? `https://${dom.hostname}/${clean[0] ? clean[0] + '/' : ''}` : `${base}${f.root}${clean[0] ? clean[0] + '/' : ''}`;
  const onGoogle = !!a.seo_on;
  const host = String(req.headers.host ?? '');
  const html = finishSiteHtml(fs.readFileSync(file, 'utf8'), { origin: base, root: f.root, canonical, noindex: !onGoogle, credit: creditLine(host), titleSuffix: ' | Jhino' });
  if (!onGoogle) reply.header('X-Robots-Tag', 'noindex');
  return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(html);
}

/* ---------------- form submissions ---------------- */
const cleanLong = (s: unknown, max: number) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,24}$/;

function readForm(body: unknown): Record<string, unknown> {
  if (typeof body === 'string') { try { const j = JSON.parse(body); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}
/** Only this page's own site may post (or a sandboxed frame of it, which has no origin). */
function sameSite(req: FastifyRequest): boolean {
  const host = String(req.headers.host ?? '').toLowerCase();
  const o = req.headers.origin;
  if (o && o !== 'null') { try { return new URL(o).host.toLowerCase() === host; } catch { return false; } }
  const r = req.headers.referer;
  if (r) { try { return new URL(r).host.toLowerCase() === host; } catch { return false; } }
  return true;
}

export function registerSites(app: FastifyInstance) {
  /* ---- the public side ---- */
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return;
    const p = req.url;
    if (p === '/' || p.startsWith('/api/') || p.startsWith('/_jhino/') || p.startsWith('/run/') || p.startsWith('/assets/')) return;
    const pathname = p.split('?')[0];
    if (!/^\/[\w-]+(\/|$)/.test(pathname)) return;
    const f = findPublicSite(pathname);
    // Only sites anyone may open to view are served bare; the rest go through the Jhino link page.
    if (!f || f.a.access !== 'public' || collaborative(f.a.public_role)) return;
    return servePublic(req, reply, f);
  });

  app.get('/_jhino/site.js', async (req, reply) => {
    const p = path.join(ROOT, 'runtime', 'site.js');
    const st = fs.statSync(p);
    const etag = `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
    reply.header('Content-Type', 'text/javascript; charset=utf-8').header('Cache-Control', 'public, max-age=300').header('ETag', etag);
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return fs.createReadStream(p);
  });
  app.get('/_jhino/site-img/:name', async (req, reply) => {
    const name = (req.params as { name: string }).name;
    const file = path.join(ROOT, 'runtime', 'site-img', name);
    if (!/^[a-z0-9-]{2,60}-\d{3,4}\.webp$/.test(name) || !fs.existsSync(file)) return reply.code(404).send();
    reply.header('Content-Type', 'image/webp').header('Cache-Control', 'public, max-age=2592000').header('Access-Control-Allow-Origin', '*');
    return fs.createReadStream(file);
  });

  app.post(FORM_PATH, { bodyLimit: 48 * 1024 }, async (req, reply) => {
    const b = readForm(req.body);
    const noJs = typeof req.body === 'object' && !('_t' in b) && String(req.headers['content-type'] ?? '').includes('urlencoded');
    reply.header('Access-Control-Allow-Origin', '*').header('Cache-Control', 'no-store');
    const done = (status: number, message: string) => {
      if (!noJs) return reply.code(status).send(status < 300 ? { ok: true } : { error: 'FORM', message });
      const back = sameSite(req) && req.headers.referer ? String(req.headers.referer) : '/';
      return sitePage(reply, status < 300 ? 200 : status, status < 300 ? 'Thank you' : 'Not sent', `${status < 300 ? 'Your message was sent.' : message} <a href="${back.replace(/"/g, '%22').replace(/</g, '%3C')}">Go back</a>`);
    };
    if (!sameSite(req)) return done(403, 'This form can only be sent from its own website.');
    const appId = String(b._s ?? ''), blockId = String(b._b ?? '');
    if (!/^app_[\w-]{4,40}$/.test(appId) || !/^[\w-]{4,24}$/.test(blockId)) return done(400, 'This form is not set up right.');
    limit(req, 'site-form', 6, 10 * 60_000, appId);
    limitKey('site-form-app', appId, 300, 3600_000, 'This website is getting a lot of messages right now. Please try again in an hour.');
    // Spam: the hidden field filled in, or sent faster than a person can type. Answer as if it went through.
    if (String(b.website ?? '').trim() || (typeof b._t === 'number' && b._t < 2500)) return done(200, '');
    const a = db.prepare('SELECT * FROM apps WHERE id=? AND deleted_at IS NULL').get(appId) as AppRow | undefined;
    const live = a ? liveSite(appId) : null;
    const hit = live ? findBlock(live.site, blockId) : null;
    const def = hit ? blockDef(hit.block.type) : undefined;
    if (!a || !hit || !def?.form) return done(404, 'This form is no longer on the website.');
    const p = hit.block.props;
    const data: Record<string, string> = {};
    for (const fd of def.form.fields) {
      if (fd.name === 'phone' && def.type === 'contact' && !p.askPhone) continue;
      if (fd.name === 'time' && def.type === 'booking' && !p.askTime) continue;
      let val = fd.kind === 'long' ? cleanLong(b[fd.name], fd.max) : cleanPlain(b[fd.name], fd.max);
      if (fd.kind === 'email' && val && !EMAIL.test(val)) return done(400, 'Check the email address.');
      if (fd.kind === 'tel' && val && !/^[+\d][\d\s()./-]{5,30}$/.test(val)) return done(400, 'Check the phone number.');
      if (fd.kind === 'date' && val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) val = '';
      if (fd.kind === 'time' && val && !/^\d{2}:\d{2}$/.test(val)) val = '';
      if (fd.kind === 'choice') { const opts = textOf(String(p.services ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/\n/g, '\u0001')).split('\u0001').map((x) => x.trim()); if (!opts.includes(val)) val = ''; }
      if (fd.required && !val) return done(400, `Please fill in: ${fd.label}.`);
      if (val) data[fd.name] = val;
    }
    if (def.type === 'contact' && !data.email && !data.phone) return done(400, 'Leave an email or a phone number so they can reply.');
    const pageTitle = hit.page?.title ?? '';
    const id = newId('sub');
    db.prepare('INSERT INTO site_submissions(id,app_id,form,block_id,page,data,created_at) VALUES(?,?,?,?,?,?,?)').run(id, appId, def.type, blockId, pageTitle, JSON.stringify(data), now());
    logActivity(appId, null, `got a ${def.name.toLowerCase()} message`, pageTitle);
    notify(a.owner_id, 'product', `New ${def.name.toLowerCase()} message on ${a.name}`, (data.name ? `${data.name}: ` : '') + (data.message ?? data.notes ?? data.email ?? '').slice(0, 200), `/apps/${appId}/site?tab=submissions`);
    publish(appId, 'site-submission', { id });
    return done(200, '');
  });

  /* ---- the owner's side ---- */
  app.get('/api/site-templates', async (req) => {
    requireCreator(req);
    return {
      categories: [...new Set(templates().map((t) => t.category))],
      templates: templates(),
      presets: PRESETS, fonts: FONTS.map(({ id, name, kind }) => ({ id, name, kind })),
      blocks: BLOCKS.map(({ type, name, category }) => ({ type, name, category })), blockCategories: CATEGORIES,
    };
  });

  app.post('/api/sites', async (req) => {
    const user = requireCreator(req);
    assertCanCreate(user.id);
    const body = (req.body ?? {}) as { name?: unknown; template?: unknown; preset?: unknown; address?: Record<string, unknown> };
    const name = validateName(body.name);
    const tpl = body.template ? templates().find((t) => t.id === body.template) : undefined;
    if (body.template && !tpl) throw bad('That template is not available.');
    // The template's own name in its copy (titles, footer, small print) becomes the new site's name.
    const swap = (v: unknown): unknown => typeof v === 'string' ? v.split(tpl!.name).join(v.includes('<') ? esc(name) : name)
      : Array.isArray(v) ? v.map(swap) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v;
    const site = tpl ? cleanSite({ ...(swap(tpl.site) as Site), name }) : blankSite(name, presetById(String(body.preset ?? '')).id);
    const addr = readAddressRequest(user, body.address ?? {}, null);
    const id = newId('app');
    const t = now();
    db.transaction(() => {
      assertCanCreate(user.id);
      if (addr.slug) assertNameFree(user.id, addr.slug);
      db.prepare('INSERT INTO apps(id,name,color,owner_id,live_version,created_at,updated_at,share_token,slug,site_draft,site_draft_at) VALUES(?,?,?,?,0,?,?,?,?,?,?)')
        .run(id, name, 0, user.id, t, t, crypto.randomBytes(10).toString('hex'), addr.slug, JSON.stringify(site), t);
      db.prepare('INSERT INTO memberships(app_id,user_id,role,added_at) VALUES(?,?,?,?)').run(id, user.id, 'owner', t);
    })();
    try { publishSite(id, user.id, comingSoon(site), 'made the website'); } catch (e) {
      db.prepare('DELETE FROM apps WHERE id=?').run(id);
      fs.rmSync(path.dirname(appDir(id, 1)), { recursive: true, force: true });
      throw e;
    }
    if (addr.access && addr.access !== 'private') await setSharing(id, { access: addr.access, publicRole: addr.publicRole, password: addr.password });
    return { app: { id, name, slug: addr.slug } };
  });

  app.get('/api/sites/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { a } = siteApp(req, id);
    const live = liveSite(id);
    const v = db.prepare('SELECT created_at FROM app_versions WHERE app_id=? AND n=?').get(id, a.live_version) as { created_at: string } | undefined;
    const unread = (db.prepare('SELECT COUNT(*) n FROM site_submissions WHERE app_id=? AND read_at IS NULL').get(id) as { n: number }).n;
    return {
      site: draftOf(a), draftAt: a.site_draft_at, liveVersion: a.live_version, publishedAt: v?.created_at ?? null,
      liveIsSite: !!live, livePublished: live ? JSON.stringify(live.site) === JSON.stringify(draftOf(a)) : false,
      url: liveUrl(req, a), access: a.access ?? 'private', uploads: uploadsOn(), unread,
    };
  });

  app.put('/api/sites/:id/draft', { bodyLimit: 4 * 1024 * 1024 }, async (req) => {
    const { id } = req.params as { id: string };
    const { a } = siteApp(req, id);
    const b = (req.body ?? {}) as { site?: unknown; base?: string | null };
    // Two tabs editing the same site: the older one is told instead of silently winning.
    if (b.base !== undefined && b.base !== null && a.site_draft_at && b.base !== a.site_draft_at) {
      throw new HttpError(409, 'DRAFT_CHANGED', 'This site was changed in another tab or device. Reload to get the latest draft.');
    }
    const site = readSite(b.site);
    const t = now();
    db.prepare('UPDATE apps SET site_draft=?, site_draft_at=?, name=?, updated_at=? WHERE id=?').run(JSON.stringify(site), t, site.name, t, id);
    return { draftAt: t };
  });

  app.post('/api/sites/:id/publish', async (req) => {
    const { id } = req.params as { id: string };
    const { user, a } = siteApp(req, id);
    const site = draftOf(a);
    const n = publishSite(id, user.id, site);
    return { version: n, url: liveUrl(req, a), publishedAt: now() };
  });

  /** Load an earlier published version into the draft (the live site does not change). */
  app.post('/api/sites/:id/restore/:n', async (req) => {
    const { id, n } = req.params as { id: string; n: string };
    siteApp(req, id);
    const v = db.prepare('SELECT site FROM app_versions WHERE app_id=? AND n=?').get(id, Number(n)) as { site: string | null } | undefined;
    if (!v?.site) throw new HttpError(404, 'NOT_FOUND', 'That version was not made with the website builder.');
    const site = cleanSite(JSON.parse(v.site));
    const t = now();
    db.prepare('UPDATE apps SET site_draft=?, site_draft_at=?, updated_at=? WHERE id=?').run(JSON.stringify(site), t, t, id);
    return { site, draftAt: t };
  });

  app.get('/api/sites/:id/versions', async (req) => {
    const { id } = req.params as { id: string };
    siteApp(req, id);
    return { versions: db.prepare("SELECT n, created_at createdAt, site IS NOT NULL isSite FROM app_versions WHERE app_id=? ORDER BY n DESC LIMIT 50").all(id) };
  });

  /** The draft, rendered as the published site would be, in a tab of its own. */
  app.get('/api/sites/:id/preview/*', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { a } = siteApp(req, id);
    const site = draftOf(a);
    const slug = ((req.params as Record<string, string>)['*'] || '').replace(/\/+$/, '');
    const page = site.pages.find((p) => p.slug === slug);
    if (!page) return reply.code(404).type('text/plain').send('This page is not in the draft.');
    const base = `/api/sites/${id}/preview/`;
    const html = renderDocument({
      mode: 'preview', appId: id, site, page, formAction: FORM_PATH,
      pageHref: (p) => base + (p.slug ? `${p.slug}/` : ''),
      asset: (src) => (src.startsWith('file:') ? { url: `/api/apps/${id}/files/${src.slice(5)}` } : src.startsWith('lib:') ? libraryAsset(src.slice(4)) : { url: src }),
    });
    (req as { jhinoSite?: boolean }).jhinoSite = true;
    reply.header('Content-Security-Policy', siteCsp(config.cookieSecure)).header('X-Robots-Tag', 'noindex').header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    return reply.type('text/html; charset=utf-8').send(finishSiteHtml(html, { origin: baseFor(req).replace(/\/$/, ''), root: base, noindex: true }));
  });

  /* ---- submissions ---- */
  const subRows = (id: string, q: string, form: string) => {
    const where = ['app_id=?']; const args: unknown[] = [id];
    if (form) { where.push('form=?'); args.push(form); }
    if (q) { where.push('instr(lower(data), ?) > 0'); args.push(q.toLowerCase().slice(0, 80)); }
    return db.prepare(`SELECT id, form, block_id blockId, page, data, created_at createdAt, read_at readAt FROM site_submissions WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 2000`).all(...args) as { id: string; form: string; page: string; data: string; createdAt: string; readAt: string | null }[];
  };
  app.get('/api/sites/:id/submissions', async (req) => {
    const { id } = req.params as { id: string };
    siteApp(req, id);
    const q = req.query as { q?: string; form?: string };
    const items = subRows(id, String(q.q ?? '').trim(), String(q.form ?? '')).map((r) => ({ ...r, data: JSON.parse(r.data) }));
    db.prepare('UPDATE site_submissions SET read_at=? WHERE app_id=? AND read_at IS NULL').run(now(), id);
    return { items };
  });
  app.get('/api/sites/:id/submissions.csv', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { a } = siteApp(req, id);
    const rows = subRows(id, '', String((req.query as { form?: string }).form ?? ''));
    const keys = ['name', 'email', 'phone', 'choice', 'date', 'time', 'message', 'notes'];
    // Cells that start like a formula are prefixed, so a spreadsheet shows them as text.
    const cell = (v: unknown) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
    const lines = [['Received', 'Form', 'Page', ...keys].map(cell).join(',')];
    for (const r of rows) { const d = JSON.parse(r.data); lines.push([r.createdAt, blockDef(r.form)?.name ?? r.form, r.page, ...keys.map((k) => d[k] ?? '')].map(cell).join(',')); }
    const safe = a.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'website';
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${safe}-submissions.csv"`).header('Cache-Control', 'no-store');
    return '﻿' + lines.join('\r\n') + '\r\n';
  });
  app.delete('/api/sites/:id/submissions/:sid', async (req) => {
    const { id, sid } = req.params as { id: string; sid: string };
    siteApp(req, id);
    db.prepare('DELETE FROM site_submissions WHERE id=? AND app_id=?').run(sid, id);
    return { ok: true };
  });
}
