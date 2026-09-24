import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ROOT } from './config.js';
import { db, newId, now, logActivity } from './db.js';
import { HttpError, requireUser, requireCreator, validateName } from './auth.js';
import { access, loadApp } from './apps.js';
import { appDir } from './packages.js';
import { validateManifest, type Manifest } from './manifest.js';
import { publish } from './realtime.js';
import { assertCanCreate } from './plans.js';

/*
 * The app builder. A person picks blocks and a design; Jhino writes a complete
 * single-file app (HTML + CSS + JS) that stores everything through the records
 * and files APIs, with a manifest so the server enforces types and permissions.
 */

interface FieldSpec { key: string; label: string; type: string; orLink?: boolean; required?: boolean; options?: string[]; protected?: boolean; default?: unknown; min?: number; max?: number; list?: boolean; accept?: string; copy?: boolean }
interface BlockSpec { key: string; name: string; category: string; engine: string; icon: string; description: string; fields: FieldSpec[]; visibility?: 'own'; createRole?: 'editor'; comments?: boolean; mode?: string; [k: string]: unknown }
interface Catalog { categories: string[]; blocks: BlockSpec[]; templates: { key: string; name: string; description: string; blocks: string[] }[] }

export interface BuildConfig {
  v: 1;
  name: string;
  purpose: string;
  /** Who the app is for (a client or brand), and their field of work. */
  client: string;
  field: string;
  design: { accent: string; style: 'modern' | 'editorial' | 'technical'; currency: string; theme: 'light' | 'auto'; calendar: 'bs' | 'ad'; logo?: string };
  blocks: { id: string; preset: string; title: string }[];
}

const CURRENCIES = ['NPR', 'INR', 'USD', 'EUR', 'GBP', 'AUD', 'AED'];
const STYLES = ['modern', 'editorial', 'technical'];
const FIELDS = ['video', 'photo', 'design', 'social', 'apps', 'web', 'studio', 'other'];
/** A small raster logo, already shrunk by the browser. SVG is refused (it can carry script). */
const LOGO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_LOGO = 150_000;
/** Features whose items get a Files and links area. */
const ATTACH_ENGINES = ['table', 'docs'];
let catalogCache: Catalog | null = null;
function catalog(): Catalog {
  if (!catalogCache) catalogCache = JSON.parse(fs.readFileSync(path.join(ROOT, 'builder', 'catalog.json'), 'utf8')) as Catalog;
  return catalogCache;
}
const read = (f: string) => fs.readFileSync(path.join(ROOT, 'builder', f), 'utf8');
const bad = (msg: string) => new HttpError(400, 'VALIDATION_FAILED', msg);

export function validateConfig(raw: unknown): BuildConfig {
  const c = (raw ?? {}) as Record<string, any>;
  const name = validateName(c.name);
  const purpose = typeof c.purpose === 'string' ? c.purpose.trim().slice(0, 400) : '';
  const d = c.design ?? {};
  const accent = typeof d.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(d.accent) ? d.accent.toLowerCase() : '#1f6f5c';
  const style = STYLES.includes(d.style) ? d.style : 'modern';
  const currency = CURRENCIES.includes(d.currency) ? d.currency : 'NPR';
  const theme = d.theme === 'auto' ? 'auto' : 'light';
  // Dates show in Bikram Sambat with AD alongside, unless the owner picks AD.
  const calendar = d.calendar === 'ad' ? 'ad' : 'bs';
  let logo: string | undefined;
  if (d.logo !== undefined && d.logo !== null && d.logo !== '') {
    if (typeof d.logo !== 'string' || d.logo.length > MAX_LOGO || !LOGO.test(d.logo)) throw bad('The logo must be a PNG, JPG or WebP image under 100 KB.');
    logo = d.logo;
  }
  const client = typeof c.client === 'string' ? c.client.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80) : '';
  const field = FIELDS.includes(c.field) ? c.field : 'other';
  if (!Array.isArray(c.blocks) || c.blocks.length === 0) throw bad('Tick at least one feature.');
  if (c.blocks.length > 45) throw bad('An app can have up to 45 features.');
  const ids = new Set<string>();
  const blocks = c.blocks.map((b: any) => {
    const preset = catalog().blocks.find((x) => x.key === b?.preset);
    if (!preset) throw bad(`Unknown block "${String(b?.preset).slice(0, 40)}".`);
    const id = String(b.id ?? '');
    if (!/^[a-z][a-z0-9_]{2,40}$/.test(id) || ids.has(id)) throw bad('Each block needs its own id.');
    ids.add(id);
    const title = String(b.title ?? preset.name).trim().slice(0, 60) || preset.name;
    return { id, preset: preset.key, title };
  });
  return { v: 1, name, purpose, client, field, design: { accent, style, currency, theme, calendar, ...(logo ? { logo } : {}) }, blocks };
}

/** Full block definitions the app renders from. */
function expand(cfg: BuildConfig) {
  return cfg.blocks.map((b) => {
    const p = catalog().blocks.find((x) => x.key === b.preset)!;
    const { category: _c, name: _n, short, ...rest } = p;
    // Every item can carry files and links. The main file of an item may be a link instead
    // (a video on Drive or YouTube); the app asks for one or the other. A contract to sign stays a file.
    let fields = p.fields;
    if (ATTACH_ENGINES.includes(p.engine)) {
      const signDoc = (p.signing as { document?: string } | undefined)?.document;
      fields = fields.map((f) => (f.type === 'file' && f.required && f.key !== signDoc ? { ...f, required: false, orLink: true } : f));
      if (!fields.some((f) => f.key === 'attachments')) fields = [...fields, { key: 'attachments', label: 'Files and links', type: 'json' }];
    }
    // A file section holds files or links (a Pinterest pin, a Drive folder, a YouTube reference): each item is one or the other.
    if (p.engine === 'files') {
      fields = fields.map((f) => (f.key === 'file' ? { ...f, required: false } : f));
      if (!fields.some((f) => f.key === 'link')) fields = [...fields, { key: 'link', label: 'Link', type: 'url' }];
    }
    // The short phone-tab label only fits the feature's own name; a renamed section uses its new name.
    return { ...rest, fields, id: b.id, preset: p.key, title: b.title, short: b.title === p.name ? short : undefined };
  });
}

/** Collections for the server to enforce. "today"/"me" defaults are filled in by the app, not the server. */
export function manifestFor(cfg: BuildConfig): Manifest {
  const collections: Record<string, any> = {};
  for (const b of expand(cfg)) {
    if (b.engine === 'summary') continue;
    const fields: Record<string, any> = {};
    for (const f of b.fields) {
      const def = f.default === 'today' || f.default === 'me' ? undefined : f.default;
      fields[f.key] = { type: f.type, required: !!f.required, options: f.options, protected: f.protected, default: def, min: f.min, max: f.max };
      if (f.type === 'money' || f.type === 'number') delete fields[f.key].options;
    }
    collections[b.id] = { title: b.title, fields, visibility: b.visibility === 'own' ? 'own' : 'all', create: b.createRole === 'editor' ? 'editors' : 'all' };
    if (b.comments) {
      collections[`${b.id}_comments`] = {
        title: `${b.title} comments`,
        fields: { rec: { type: 'text', required: true, maxLength: 64 }, body: { type: 'longtext', required: true, maxLength: 5000 }, file: { type: 'file' } },
        visibility: 'all', create: 'all',
      };
    }
    if (b.engine === 'poll') {
      collections[`${b.id}_votes`] = {
        title: `${b.title} votes`,
        fields: { poll: { type: 'text', required: true, maxLength: 64 }, choice: { type: 'number', required: true, min: 0, max: 50 }, voter: { type: 'user', required: true } },
        visibility: 'all', create: 'all',
      };
    }
  }
  return validateManifest({ specVersion: 1, name: cfg.name, version: '1.0.0', sdkVersion: 1, capabilities: ['data', 'realtime', 'files'], collections });
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

export function generateHtml(cfg: BuildConfig, opts: { preview?: boolean } = {}) {
  const manifest = manifestFor(cfg);
  const appCfg = { name: cfg.name, purpose: cfg.purpose, client: cfg.client, design: cfg.design, blocks: expand(cfg), preview: !!opts.preview, builtAt: now() };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(cfg.name)}</title>
<meta name="generator" content="Jhino app builder">
<script type="application/json" id="jhino-manifest">${safeJson(manifest)}</script>
<script type="application/json" id="jhino-app-config">${safeJson(appCfg)}</script>
<style>
${read('app.css')}
</style>
</head>
<body>
<div id="app" aria-live="polite"></div>
<script>
${read('app.js')}
</script>
</body>
</html>
`;
}

function installBuilt(appId: string, n: number, html: string) {
  const dest = appDir(appId, n);
  if (fs.existsSync(dest)) throw new Error('version folder already exists');
  const staging = path.join(path.dirname(dest), `.staging-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'index.html'), html);
  fs.renameSync(staging, dest);
}

const FEATURES = JSON.stringify({ localStorage: false, claudeStorage: false, jhinoSdk: true, indexedDB: false, network: false });

/** Short labels for what a feature does, shown on its card in the tick list. */
function tagsFor(b: BlockSpec): string[] {
  const t: string[] = [];
  const types = new Set(b.fields.map((f) => f.type));
  const accepts = b.fields.map((f) => f.accept ?? '').join(' ');
  if (b.engine === 'docs') t.push('Writing');
  if (b.engine === 'chat') t.push('Live chat');
  if (b.engine === 'checklist') t.push('Type and tick');
  if (b.workflow) t.push('Approval');
  if (b.mode === 'proofing') t.push('Client picks');
  if (b.signing) t.push('Sign-off');
  if (b.comments) t.push('Comments');
  if (/video/.test(accepts)) t.push('Video');
  else if (/image/.test(accepts) || b.mode === 'gallery') t.push('Photos');
  else if ((types.has('file') || types.has('files') || b.engine === 'files') && b.engine !== 'docs') t.push('Files');
  if (b.engine === 'quote') t.push('Print or PDF');
  if (b.engine === 'ledger' || (Array.isArray(b.totals) && b.fields.some((f) => f.type === 'money' && (b.totals as string[]).includes(f.key)))) t.push('Totals');
  const views = Array.isArray(b.views) ? (b.views as string[]) : [];
  if (views.includes('board')) t.push('Board');
  if (views.includes('calendar')) t.push('Calendar');
  if (b.engine === 'poll') t.push('Live votes');
  if (b.engine === 'booking') t.push('Time slots', 'Reminders');
  return t.slice(0, 4);
}

export function registerBuilder(app: FastifyInstance) {
  app.get('/api/build/catalog', async (req) => {
    requireUser(req);
    const c = catalog();
    return {
      categories: c.categories,
      templates: c.templates,
      blocks: c.blocks.map((b) => ({
        key: b.key, name: b.name, category: b.category, description: b.description, icon: b.icon, engine: b.engine,
        fields: b.fields.map((f) => ({ label: f.label, type: f.type })), own: b.visibility === 'own', tags: tagsFor(b),
      })),
    };
  });

  // Previews are served from their own short-lived, sandboxed URL (never inline in the Jhino page).
  const previews = new Map<string, { html: string; exp: number }>();
  app.post('/api/build/preview', async (req) => {
    requireUser(req);
    const cfg = validateConfig((req.body as { config?: unknown })?.config);
    const t = Date.now();
    for (const [k, v] of previews) if (v.exp < t) previews.delete(k);
    while (previews.size > 200) previews.delete(previews.keys().next().value!);
    const token = crypto.randomBytes(18).toString('base64url');
    previews.set(token, { html: generateHtml(cfg, { preview: true }), exp: t + 10 * 60_000 });
    return { url: `/preview/${token}` };
  });
  app.get('/preview/:token', async (req, reply) => {
    const p = previews.get((req.params as { token: string }).token);
    reply.header('Content-Security-Policy', "sandbox allow-scripts allow-forms allow-modals; frame-ancestors 'self'")
      .header('Referrer-Policy', 'no-referrer').header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (!p || p.exp < Date.now()) return reply.code(410).type('text/plain').send('Preview expired.');
    return reply.type('text/html; charset=utf-8').send(p.html);
  });

  app.post('/api/apps/build', async (req) => {
    const user = requireCreator(req);
    assertCanCreate(user.id);
    const cfg = validateConfig((req.body as { config?: unknown })?.config);
    const html = generateHtml(cfg);
    const manifest = manifestFor(cfg);
    const id = newId('app');
    fs.mkdirSync(path.join(path.dirname(appDir(id, 1))), { recursive: true });
    installBuilt(id, 1, html);
    const t = now();
    try {
    db.transaction(() => {
      assertCanCreate(user.id); // again inside the insert, so two requests at once cannot both pass
      db.prepare('INSERT INTO apps(id,name,color,owner_id,live_version,created_at,updated_at,share_token) VALUES(?,?,?,?,1,?,?,?)').run(id, cfg.name, 0, user.id, t, t, crypto.randomBytes(10).toString('hex'));
      db.prepare('INSERT INTO app_versions(app_id,n,entry,file_count,size,features,source_name,uploaded_by,created_at,manifest,builder) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, 1, 'index.html', 1, Buffer.byteLength(html), FEATURES, 'Built in Jhino', user.id, t, JSON.stringify(manifest), JSON.stringify(cfg));
      db.prepare('INSERT INTO memberships(app_id,user_id,role,added_at) VALUES(?,?,?,?)').run(id, user.id, 'owner', t);
      logActivity(id, user.id, 'built the app', `${cfg.blocks.length} blocks`);
    })();
    } catch (e) {
      fs.rmSync(path.dirname(appDir(id, 1)), { recursive: true, force: true });
      throw e;
    }
    return { app: { id, name: cfg.name } };
  });

  app.get('/api/apps/:id/build', async (req) => {
    const { id } = req.params as { id: string };
    const { app: a } = access(req, id, 'owner');
    const v = db.prepare('SELECT builder FROM app_versions WHERE app_id=? AND n=?').get(id, a.live_version) as { builder: string | null } | undefined;
    if (!v?.builder) throw new HttpError(404, 'NOT_BUILT', 'This app was uploaded, not built with blocks.');
    return { config: JSON.parse(v.builder) };
  });

  app.post('/api/apps/:id/build', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = access(req, id, 'owner');
    const cfg = validateConfig((req.body as { config?: unknown })?.config);
    const html = generateHtml(cfg);
    const manifest = manifestFor(cfg);
    const n = ((db.prepare('SELECT MAX(n) n FROM app_versions WHERE app_id=?').get(id) as { n: number }).n || 0) + 1;
    installBuilt(id, n, html);
    db.transaction(() => {
      db.prepare('INSERT INTO app_versions(app_id,n,entry,file_count,size,features,source_name,uploaded_by,created_at,manifest,builder) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, n, 'index.html', 1, Buffer.byteLength(html), FEATURES, 'Built in Jhino', user.id, now(), JSON.stringify(manifest), JSON.stringify(cfg));
      db.prepare('UPDATE apps SET live_version=?, name=?, updated_at=? WHERE id=?').run(n, cfg.name, now(), id);
      logActivity(id, user.id, 'changed the app blocks', `version ${n}`);
    })();
    publish(id, 'app-updated', { reason: 'version', version: n });
    return { app: { id, name: loadApp(id).name, liveVersion: n } };
  });

  /** The live version's page as a file the owner can keep or edit elsewhere. */
  app.get('/api/apps/:id/source', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { app: a } = access(req, id, 'owner');
    const v = db.prepare('SELECT entry FROM app_versions WHERE app_id=? AND n=?').get(id, a.live_version) as { entry: string };
    const file = path.join(appDir(id, a.live_version), v.entry);
    const safe = a.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'app';
    reply.header('Content-Type', 'text/html; charset=utf-8').header('Content-Security-Policy', 'sandbox').header('Content-Disposition', `attachment; filename="${safe}.html"`);
    return fs.readFileSync(file, 'utf8');
  });
}
