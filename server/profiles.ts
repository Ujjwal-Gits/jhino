import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { db, newId, now, sha256, type UserRow } from './db.js';
import { HttpError, requireCreator } from './auth.js';
import { imageType, limit, setSetting, setting } from './security.js';
import { featuresOf } from './plans.js';
import { THEME_TIERS, DEFAULT_THEME } from './themes.js';

/*
 * A person's public page at jhino.com/<username>: a link-in-bio page with their links, socials, a
 * video, their Jhino apps, in one of 30 designs (by plan), laid out as a list of links or as a profile.
 * Pro can replace the design with their own HTML, which runs sandboxed. Every link goes through
 * /go/<id> so clicks are counted; page views are counted per day with visitors counted once a day.
 */

type ItemType = 'link' | 'header' | 'text' | 'video' | 'app';
const ITEM_TYPES: ItemType[] = ['link', 'header', 'text', 'video', 'app'];
const SOCIALS = ['instagram', 'facebook', 'tiktok', 'youtube', 'x', 'linkedin', 'whatsapp', 'viber', 'telegram', 'threads', 'pinterest', 'snapchat',
  'spotify', 'soundcloud', 'behance', 'dribbble', 'github', 'discord', 'twitch', 'messenger', 'email', 'phone', 'website'] as const;
type SocialKind = typeof SOCIALS[number];
const TIER = { free: 0, plus: 1, pro: 2 } as const;

interface ProfileRow {
  user_id: string; bio: string; location: string; theme: string; layout: string; socials: string; published: number; custom_html: string | null; use_custom: number; updated_at: string;
  home: string; headline: string; about: string; cover: string | null; cta: string | null; stats: string; services: string; work: string; palette: string; ptype: string;
}
const PALETTES = ['studio', 'night', 'sand', 'forest', 'navy', 'oxblood', 'stone', 'porcelain'];
const imgDir = () => path.join(config.dataDir, 'system', 'profiles');
/** Work images on the profile page, by plan. */
const workLimit = (u: UserRow) => ({ free: 6, plus: 12, pro: 24 } as const)[featuresOf(u).themeTier];
const json = <T,>(s: string | null, d: T): T => { try { return s ? JSON.parse(s) as T : d; } catch { return d; } };
interface ItemRow { id: string; user_id: string; position: number; type: ItemType; title: string; subtitle: string; url: string | null; text: string | null; app_id: string | null; highlight: number; visible: number; created_at: string; updated_at: string }

function profileOf(userId: string): ProfileRow {
  let p = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(userId) as ProfileRow | undefined;
  if (!p) {
    db.prepare('INSERT OR IGNORE INTO profiles(user_id, updated_at) VALUES(?,?)').run(userId, now());
    p = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(userId) as ProfileRow;
  }
  return p;
}
const userByName = (name: string) => (/^[\w-]{2,40}$/.test(name)
  ? db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE AND kind='person' AND disabled=0").get(name) as UserRow | undefined
  : undefined);

/* ---------------- helpers: addresses people paste ---------------- */
function httpUrl(raw: unknown, what = 'address') {
  let s = String(raw ?? '').trim();
  if (s && !/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  let u: URL;
  try { u = new URL(s); } catch { throw new HttpError(400, 'VALIDATION_FAILED', `Enter a web ${what}, like https://example.com.`); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || s.length > 2000) throw new HttpError(400, 'VALIDATION_FAILED', `Enter a web ${what}, like https://example.com.`);
  return u.toString();
}
/** The player address for a YouTube or Vimeo link, or null. */
export function embedOf(url: string): string | null {
  const yt = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = /vimeo\.com\/(?:video\/)?(\d{6,12})/.exec(url);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}
const HANDLE_URL: Partial<Record<SocialKind, (h: string) => string>> = {
  instagram: (h) => `https://instagram.com/${h}`, facebook: (h) => `https://facebook.com/${h}`, tiktok: (h) => `https://www.tiktok.com/@${h}`,
  youtube: (h) => `https://www.youtube.com/@${h}`, x: (h) => `https://x.com/${h}`, linkedin: (h) => `https://www.linkedin.com/in/${h}`,
  telegram: (h) => `https://t.me/${h}`, threads: (h) => `https://www.threads.net/@${h}`, pinterest: (h) => `https://pinterest.com/${h}`,
  snapchat: (h) => `https://www.snapchat.com/add/${h}`, behance: (h) => `https://www.behance.net/${h}`, dribbble: (h) => `https://dribbble.com/${h}`,
  github: (h) => `https://github.com/${h}`, twitch: (h) => `https://www.twitch.tv/${h}`, soundcloud: (h) => `https://soundcloud.com/${h}`,
  messenger: (h) => `https://m.me/${h}`,
};
/** A social as people type it (a handle, a number, an email or a full link) → a proper link. */
function socialUrl(kind: SocialKind, raw: unknown) {
  const v = String(raw ?? '').trim();
  if (!v) throw new HttpError(400, 'VALIDATION_FAILED', 'Add the link or handle.');
  if (kind === 'email') { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.replace(/^mailto:/i, ''))) throw new HttpError(400, 'VALIDATION_FAILED', 'Enter an email address.'); return 'mailto:' + v.replace(/^mailto:/i, ''); }
  if (kind === 'phone') { const d = v.replace(/^tel:/i, '').replace(/[^\d+]/g, ''); if (d.length < 6) throw new HttpError(400, 'VALIDATION_FAILED', 'Enter a phone number.'); return 'tel:' + d; }
  if ((kind === 'whatsapp' || kind === 'viber') && /^[+\d\s()-]{6,}$/.test(v)) {
    const d = v.replace(/[^\d]/g, '');
    return kind === 'whatsapp' ? `https://wa.me/${d}` : `viber://chat?number=%2B${d}`;
  }
  const handle = /^@?([\w.-]{1,60})$/.exec(v);
  if (handle && HANDLE_URL[kind]) return HANDLE_URL[kind]!(handle[1]);
  return httpUrl(v, 'link');
}

/* ---------------- the page, as visitors and the editor preview see it ---------------- */
function avatarUrl(u: UserRow) {
  return u.avatar ? `/api/profile/${u.username}/avatar?v=${sha256(u.avatar).slice(0, 8)}` : null;
}
function effectiveTheme(u: UserRow, theme: string) {
  const tier = THEME_TIERS[theme];
  if (!tier) return DEFAULT_THEME;
  // A plan that ended falls back to a free design; the choice is kept for when they renew.
  return TIER[tier] <= TIER[featuresOf(u).themeTier] ? theme : DEFAULT_THEME;
}
function publicItems(u: UserRow, rows: ItemRow[], forOwner: boolean) {
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    if (!r.visible && !forOwner) continue;
    const hidden = !r.visible ? { hidden: true } : {};
    if (r.type === 'header') out.push({ id: r.id, type: 'header', title: r.title, ...hidden });
    else if (r.type === 'text') out.push({ id: r.id, type: 'text', text: r.text ?? '', ...hidden });
    else if (r.type === 'link' && r.url) out.push({ id: r.id, type: 'link', title: r.title || hostOf(r.url), subtitle: r.subtitle || undefined, href: `/go/${r.id}`, url: r.url, thumb: null, highlight: !!r.highlight, ...hidden });
    else if (r.type === 'video' && r.url) {
      const embed = embedOf(r.url);
      if (embed) out.push({ id: r.id, type: 'video', title: r.title, embed, href: `/go/${r.id}`, ...hidden });
      else out.push({ id: r.id, type: 'link', title: r.title || hostOf(r.url), subtitle: 'Video', href: `/go/${r.id}`, url: r.url, thumb: null, ...hidden });
    } else if (r.type === 'app' && r.app_id) {
      const a = db.prepare('SELECT id, name, slug, root_slug, access, share_token FROM apps WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(r.app_id, u.id) as { id: string; name: string; slug: string | null; root_slug: string | null; access: string; share_token: string | null } | undefined;
      if (!a) continue;
      // Visitors only see apps they can open (public or password) or that have an address.
      if (a.access === 'private' && !forOwner) continue;
      const href = a.slug ? `/${u.username}/${a.slug}` : a.root_slug ? `/${a.root_slug}` : `/s/${a.share_token}`;
      out.push({ id: r.id, type: 'app', title: r.title || a.name, subtitle: r.subtitle || (a.access === 'password' ? 'Password protected' : undefined), href, ...hidden, ...(a.access === 'private' ? { privateApp: true } : {}) });
    }
  }
  return out;
}
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

export function pageData(u: UserRow, forOwner = false) {
  const p = profileOf(u.id);
  const rows = db.prepare('SELECT * FROM profile_items WHERE user_id=? ORDER BY position, created_at').all(u.id) as ItemRow[];
  let socials: { kind: string; url: string }[] = [];
  try { socials = JSON.parse(p.socials); } catch { /* reset */ }
  const img = (f: string) => `/api/profile/${u.username}/img/${f}`;
  return {
    username: u.username!, name: u.display_name || u.name, bio: p.bio, location: p.location, avatarUrl: avatarUrl(u),
    theme: effectiveTheme(u, p.theme), home: p.home === 'profile' ? 'profile' : 'links', branding: featuresOf(u).branding,
    socials, items: publicItems(u, rows, forOwner),
    portfolio: {
      headline: p.headline, about: p.about, coverUrl: p.cover ? img(p.cover) : null, cta: json<{ label: string; url: string } | null>(p.cta, null),
      stats: json<{ value: string; label: string }[]>(p.stats, []), services: json<{ name: string; note: string; price: string }[]>(p.services, []),
      work: json<{ id: string; caption: string }[]>(p.work, []).map((w) => ({ id: w.id, url: img(w.id), caption: w.caption })),
      palette: PALETTES.includes(p.palette) ? p.palette : 'studio', type: p.ptype === 'serif' ? 'serif' : 'sans',
    },
  };
}

/* ---------------- analytics ---------------- */
const today = () => new Date().toISOString().slice(0, 10);
function daySalt(day: string) {
  let secret = setting('analytics_secret');
  if (!secret) { secret = crypto.randomBytes(32).toString('hex'); setSetting('analytics_secret', secret); }
  return sha256(`${secret}:${day}`);
}
function deviceOf(ua: string) {
  if (/iPad|Tablet|Nexus 7|SM-T/i.test(ua)) return 'Tablet';
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return 'Phone';
  if (/bot|crawl|spider|preview|facebookexternalhit|slurp/i.test(ua)) return 'Bot';
  return 'Computer';
}
function refOf(ref: unknown, req: FastifyRequest) {
  const s = String(ref ?? '').trim();
  if (!s) return 'Direct';
  try {
    const h = new URL(s).hostname.replace(/^(www|m|l|lm)\./, '').toLowerCase();
    const own = (config.publicUrl ? new URL(config.publicUrl).hostname : String(req.headers.host ?? '').split(':')[0]).replace(/^www\./, '');
    if (h === own) return 'Jhino';
    const known: [RegExp, string][] = [[/instagram\.com$/, 'Instagram'], [/facebook\.com$|fb\.com$/, 'Facebook'], [/t\.co$|twitter\.com$|x\.com$/, 'X'],
      [/tiktok\.com$/, 'TikTok'], [/youtube\.com$|youtu\.be$/, 'YouTube'], [/linkedin\.com$|lnkd\.in$/, 'LinkedIn'], [/google\./, 'Google'], [/whatsapp\.com$|wa\.me$/, 'WhatsApp'], [/threads\.net$/, 'Threads']];
    for (const [re, name] of known) if (re.test(h)) return name;
    return h.slice(0, 80);
  } catch { return 'Direct'; }
}
const bump = {
  view: db.prepare('INSERT INTO page_days(user_id,day,views,visitors,clicks) VALUES(?,?,1,0,0) ON CONFLICT(user_id,day) DO UPDATE SET views=views+1'),
  visitor: db.prepare('UPDATE page_days SET visitors=visitors+1 WHERE user_id=? AND day=?'),
  seen: db.prepare('INSERT OR IGNORE INTO page_seen(user_id,day,visitor) VALUES(?,?,?)'),
  dim: db.prepare('INSERT INTO page_dims(user_id,day,dim,value,n) VALUES(?,?,?,?,1) ON CONFLICT(user_id,day,dim,value) DO UPDATE SET n=n+1'),
  click: db.prepare('INSERT INTO page_days(user_id,day,views,visitors,clicks) VALUES(?,?,0,0,1) ON CONFLICT(user_id,day) DO UPDATE SET clicks=clicks+1'),
  item: db.prepare('INSERT INTO item_days(item_id,user_id,day,clicks) VALUES(?,?,?,1) ON CONFLICT(item_id,day) DO UPDATE SET clicks=clicks+1'),
};
function countView(req: FastifyRequest, userId: string, ref: unknown, page: 'Links' | 'Profile' = 'Links') {
  const ua = String(req.headers['user-agent'] ?? '');
  const device = deviceOf(ua);
  if (device === 'Bot') return;
  const day = today();
  const visitor = sha256(`${daySalt(day)}:${req.ip}:${ua}`).slice(0, 32);
  db.transaction(() => {
    bump.view.run(userId, day);
    bump.dim.run(userId, day, 'page', page);
    if (bump.seen.run(userId, day, visitor).changes) {
      bump.visitor.run(userId, day);
      bump.dim.run(userId, day, 'device', device);
      const country = String(req.headers['cf-ipcountry'] ?? '').toUpperCase();
      if (/^[A-Z]{2}$/.test(country) && country !== 'XX') bump.dim.run(userId, day, 'country', country);
      bump.dim.run(userId, day, 'ref', refOf(ref, req));
    }
  })();
}
setInterval(() => db.prepare('DELETE FROM page_seen WHERE day < ?').run(new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10)), 6 * 3600e3).unref();

/* ---------------- the owner's own HTML page (Pro), sandboxed ---------------- */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function renderCustom(u: UserRow, html: string) {
  const d = pageData(u);
  const links = (d.items as { type: string; title?: string; href?: string; subtitle?: string }[]).filter((i) => i.href && i.type !== 'video');
  const linksHtml = `<ul class="jhino-links">${links.map((l) => `<li><a href="${esc(l.href!)}" target="_top">${esc(l.title ?? '')}</a>${l.subtitle ? `<small>${esc(l.subtitle)}</small>` : ''}</li>`).join('')}</ul>`;
  const socialsHtml = `<ul class="jhino-socials">${d.socials.map((s) => `<li><a href="${esc(s.url)}" target="_top" rel="noopener" data-kind="${esc(s.kind)}">${esc(s.kind)}</a></li>`).join('')}</ul>`;
  const data = JSON.stringify({ ...d, items: undefined, links: links.map((l) => ({ title: l.title, subtitle: l.subtitle ?? '', href: l.href })) })
    .replace(new RegExp('[<' + String.fromCharCode(0x2028, 0x2029) + ']', 'g'), (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const out = html
    .replaceAll('{{name}}', esc(d.name)).replaceAll('{{username}}', esc(d.username)).replaceAll('{{bio}}', esc(d.bio))
    .replaceAll('{{location}}', esc(d.location)).replaceAll('{{avatar}}', esc(d.avatarUrl ?? '')).replaceAll('{{links}}', linksHtml).replaceAll('{{socials}}', socialsHtml);
  const boot = `<base target="_top"><script>window.JHINO=${data};</script>`;
  return /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => m + boot) : boot + out;
}
const CUSTOM_STARTER = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{name}}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111; color: #f4f2ec; font: 16px/1.5 Georgia, serif; }
  main { width: min(520px, 100% - 32px); padding: 48px 0; text-align: center; }
  img { width: 96px; height: 96px; border-radius: 50%; object-fit: cover; }
  .jhino-links { list-style: none; padding: 0; display: grid; gap: 12px; margin: 32px 0; }
  .jhino-links a { display: block; padding: 16px; border: 1px solid #f4f2ec; color: inherit; text-decoration: none; }
  .jhino-links small { display: block; opacity: .6; margin-top: 4px; }
</style>
</head>
<body>
<main>
  <img src="{{avatar}}" alt="">
  <h1>{{name}}</h1>
  <p>{{bio}}</p>
  {{links}}
</main>
</body>
</html>`;

/* ---------------- routes ---------------- */
export function registerProfiles(app: FastifyInstance) {
  /** The public page's data. The owner also gets hidden items (marked), for the editor's preview. */
  app.get('/api/profile/:name', async (req) => {
    limit(req, 'profile-read', 240, 60_000);
    const u = userByName((req.params as { name: string }).name);
    const owner = !!u && !!req.user && !req.pub && !req.desk && req.user.id === u.id;
    if (!u) throw new HttpError(404, 'NOT_FOUND', 'There is no page here.');
    const p = profileOf(u.id);
    if (!p.published && !owner) throw new HttpError(404, 'NOT_FOUND', 'This page is not public.');
    const custom = !!p.use_custom && !!p.custom_html && featuresOf(u).customPage;
    return { profile: pageData(u, false), owner, custom, published: !!p.published };
  });

  /** One page view (sent by the page itself, not counted for the owner). */
  app.post('/api/profile/:name/hit', async (req) => {
    limit(req, 'profile-hit', 60, 60_000);
    const u = userByName((req.params as { name: string }).name);
    if (!u || (req.user && req.user.id === u.id)) return { ok: true };
    const b = (req.body ?? {}) as { ref?: string; view?: string };
    countView(req, u.id, b.ref, b.view === 'profile' ? 'Profile' : 'Links');
    return { ok: true };
  });

  /** The page's photo is public: it is on the page. */
  app.get('/api/profile/:name/avatar', async (req, reply) => {
    const u = userByName((req.params as { name: string }).name);
    if (!u?.avatar || !/^[\w.-]+$/.test(u.avatar)) throw new HttpError(404, 'NOT_FOUND', 'No photo.');
    const file = path.join(config.dataDir, 'system', 'avatars', u.avatar);
    if (!fs.existsSync(file)) throw new HttpError(404, 'NOT_FOUND', 'No photo.');
    const type = u.avatar.endsWith('.png') ? 'image/png' : u.avatar.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    reply.header('Cache-Control', 'public, max-age=86400').header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "sandbox; default-src 'none'");
    return reply.type(type).send(fs.readFileSync(file));
  });

  /** Images on a profile page are public: they are on the page. Only files that page uses. */
  app.get('/api/profile/:name/img/:file', async (req, reply) => {
    const { name, file } = req.params as { name: string; file: string };
    const u = userByName(name);
    if (!u || !/^[\w.-]+$/.test(file)) throw new HttpError(404, 'NOT_FOUND', 'No image.');
    const p = profileOf(u.id);
    if (!p.published && req.user?.id !== u.id) throw new HttpError(404, 'NOT_FOUND', 'No image.');
    const used = p.cover === file || json<{ id: string }[]>(p.work, []).some((w) => w.id === file);
    const f = path.join(imgDir(), file);
    if (!used || !fs.existsSync(f)) throw new HttpError(404, 'NOT_FOUND', 'No image.');
    reply.header('Cache-Control', 'public, max-age=604800, immutable').header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "sandbox; default-src 'none'");
    return reply.type(file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg').send(fs.readFileSync(f));
  });

  /** Every link on a page goes through here: count the click, then go. */
  app.get('/go/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const r = /^[\w-]{4,40}$/.test(id) ? db.prepare(`SELECT i.id, i.user_id, i.url FROM profile_items i JOIN users u ON u.id=i.user_id
      WHERE i.id=? AND i.visible=1 AND i.url IS NOT NULL AND u.disabled=0`).get(id) as { id: string; user_id: string; url: string } | undefined : undefined;
    if (!r) return reply.redirect('/', 302);
    const ua = String(req.headers['user-agent'] ?? '');
    if (deviceOf(ua) !== 'Bot' && !(req.user && req.user.id === r.user_id)) {
      const day = today();
      db.transaction(() => { bump.click.run(r.user_id, day); bump.item.run(r.id, r.user_id, day); })();
    }
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'strict-origin-when-cross-origin');
    return reply.redirect(r.url, 302);
  });

  /** A Pro page made from the owner's own HTML. It runs sandboxed: no cookies, no Jhino data but its own. */
  app.get('/p/:name/custom', async (req, reply) => {
    const u = userByName((req.params as { name: string }).name);
    const p = u ? profileOf(u.id) : null;
    const preview = (req.query as { preview?: string }).preview === '1' && !!req.user && !!u && req.user.id === u.id;
    if (!u || !p?.custom_html || !featuresOf(u).customPage || (!p.use_custom && !preview) || (!p.published && !preview)) return reply.code(404).type('text/plain').send('Not found');
    reply.header('Content-Security-Policy', "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-forms; frame-ancestors 'self'")
      .header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'no-store').header('Referrer-Policy', 'strict-origin-when-cross-origin');
    return reply.type('text/html; charset=utf-8').send(renderCustom(u, p.custom_html));
  });

  /* ---------- the owner's editor ---------- */
  const me = (req: FastifyRequest) => {
    const u = requireCreator(req);
    if (req.pub || req.desk) throw new HttpError(403, 'FORBIDDEN', 'Not here.');
    if (!u.username) throw new HttpError(409, 'NO_USERNAME', 'Choose a username first (Account → Profile).');
    return u;
  };
  const editorView = (u: UserRow) => {
    const p = profileOf(u.id);
    const f = featuresOf(u);
    const items = db.prepare('SELECT * FROM profile_items WHERE user_id=? ORDER BY position, created_at').all(u.id) as ItemRow[];
    const since = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
    const clicks = Object.fromEntries((db.prepare('SELECT item_id, SUM(clicks) n FROM item_days WHERE user_id=? AND day>=? GROUP BY item_id').all(u.id, since) as { item_id: string; n: number }[]).map((r) => [r.item_id, r.n]));
    let socials: unknown[] = [];
    try { socials = JSON.parse(p.socials); } catch { /* reset */ }
    return {
      username: u.username, page: pageData(u, true),
      settings: { bio: p.bio, location: p.location, theme: p.theme, home: p.home === 'profile' ? 'profile' : 'links', socials, published: !!p.published, customHtml: p.custom_html ?? '', useCustom: !!p.use_custom },
      items: items.map((r) => ({ id: r.id, type: r.type, title: r.title, subtitle: r.subtitle, url: r.url, text: r.text, appId: r.app_id, highlight: !!r.highlight, visible: !!r.visible, clicks30: clicks[r.id] ?? 0 })),
      features: { themeTier: f.themeTier, branding: f.branding, customPage: f.customPage, analyticsDays: f.analyticsDays, workImages: workLimit(u) },
      apps: db.prepare('SELECT id, name, slug, access FROM apps WHERE owner_id=? AND deleted_at IS NULL ORDER BY updated_at DESC').all(u.id),
      starter: CUSTOM_STARTER, themeTiers: THEME_TIERS,
    };
  };
  app.get('/api/me/page', async (req) => editorView(me(req)));

  /** A cover photo or a work image for the profile page (JPG, PNG or WEBP, checked by its bytes). */
  app.post('/api/me/page/image', async (req) => {
    const u = me(req);
    limit(req, 'page-image', 60, 3600_000, u.id);
    const kind = (req.query as { kind?: string }).kind === 'cover' ? 'cover' : 'work';
    const p = profileOf(u.id);
    const work = json<{ id: string; caption: string }[]>(p.work, []);
    if (kind === 'work' && work.length >= workLimit(u)) throw new HttpError(403, 'LIMIT_REACHED', `Your plan holds ${workLimit(u)} work images. Remove one, or upgrade in Plan & usage.`);
    const max = 10 * 1024 * 1024;
    if (Number(req.headers['content-length'] || 0) > max + 64 * 1024) throw new HttpError(413, 'TOO_LARGE', 'Use an image up to 10 MB.');
    const part = await req.file({ limits: { fileSize: max, files: 1, fields: 2 } });
    if (!part) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose an image.');
    const buf = await part.toBuffer();
    if (part.file.truncated) throw new HttpError(413, 'TOO_LARGE', 'Use an image up to 10 MB.');
    const type = imageType(buf);
    if (!type) throw new HttpError(400, 'VALIDATION_FAILED', 'Use a JPG, PNG or WEBP image.');
    const file = `${u.id}-${crypto.randomBytes(8).toString('hex')}.${type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'}`;
    fs.writeFileSync(path.join(imgDir(), file), buf, { flag: 'wx' });
    if (kind === 'cover') {
      if (p.cover) fs.rmSync(path.join(imgDir(), p.cover), { force: true });
      db.prepare('UPDATE profiles SET cover=?, updated_at=? WHERE user_id=?').run(file, now(), u.id);
    } else {
      db.prepare('UPDATE profiles SET work=?, updated_at=? WHERE user_id=?').run(JSON.stringify([...work, { id: file, caption: '' }]), now(), u.id);
    }
    return editorView(u);
  });
  app.delete('/api/me/page/image/:file', async (req) => {
    const u = me(req);
    const file = (req.params as { file: string }).file;
    const p = profileOf(u.id);
    if (p.cover === file) db.prepare('UPDATE profiles SET cover=NULL WHERE user_id=?').run(u.id);
    else {
      const work = json<{ id: string; caption: string }[]>(p.work, []);
      if (!work.some((w) => w.id === file)) throw new HttpError(404, 'NOT_FOUND', 'That image is not on your page.');
      db.prepare('UPDATE profiles SET work=? WHERE user_id=?').run(JSON.stringify(work.filter((w) => w.id !== file)), u.id);
    }
    if (/^[\w.-]+$/.test(file)) fs.rmSync(path.join(imgDir(), file), { force: true });
    return editorView(u);
  });

  app.put('/api/me/page', async (req) => {
    const u = me(req);
    limit(req, 'page-save', 240, 60_000, u.id);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const p = profileOf(u.id);
    const f = featuresOf(u);
    const next = { ...p };
    if (b.bio !== undefined) { const s = String(b.bio).trim(); if (s.length > 280) throw new HttpError(400, 'VALIDATION_FAILED', 'Keep the bio to 280 characters.'); next.bio = s; }
    if (b.location !== undefined) next.location = String(b.location).trim().slice(0, 80);
    if (b.home !== undefined) next.home = b.home === 'profile' ? 'profile' : 'links';
    if (b.headline !== undefined) next.headline = String(b.headline).trim().slice(0, 120);
    if (b.about !== undefined) { const s = String(b.about).trim(); if (s.length > 1500) throw new HttpError(400, 'VALIDATION_FAILED', 'Keep About to 1,500 characters.'); next.about = s; }
    if (b.palette !== undefined) { if (!PALETTES.includes(String(b.palette))) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose one of the colours.'); next.palette = String(b.palette); }
    if (b.ptype !== undefined) next.ptype = b.ptype === 'serif' ? 'serif' : 'sans';
    if (b.cta !== undefined) {
      const c = b.cta as { label?: string; url?: string } | null;
      if (!c || (!c.url && !c.label)) next.cta = null;
      else {
        const label = String(c.label ?? '').trim().slice(0, 40);
        if (!label) throw new HttpError(400, 'VALIDATION_FAILED', 'Write what the main button says.');
        const raw = String(c.url ?? '').trim();
        const url = /^(mailto:|tel:)/i.test(raw) ? raw.slice(0, 300) : httpUrl(raw, 'link for the button');
        next.cta = JSON.stringify({ label, url });
      }
    }
    if (b.stats !== undefined) {
      if (!Array.isArray(b.stats) || b.stats.length > 4) throw new HttpError(400, 'VALIDATION_FAILED', 'Add up to 4 numbers.');
      next.stats = JSON.stringify(b.stats.map((x) => ({ value: String((x as { value?: string }).value ?? '').trim().slice(0, 16), label: String((x as { label?: string }).label ?? '').trim().slice(0, 40) })).filter((x) => x.value && x.label));
    }
    if (b.services !== undefined) {
      if (!Array.isArray(b.services) || b.services.length > 12) throw new HttpError(400, 'VALIDATION_FAILED', 'Add up to 12 services.');
      next.services = JSON.stringify(b.services.map((x) => ({ name: String((x as { name?: string }).name ?? '').trim().slice(0, 60), note: String((x as { note?: string }).note ?? '').trim().slice(0, 140), price: String((x as { price?: string }).price ?? '').trim().slice(0, 40) })).filter((x) => x.name));
    }
    if (b.work !== undefined) {
      // Only reorder and caption: images are added and removed through their own routes.
      const have = new Set(json<{ id: string }[]>(p.work, []).map((w) => w.id));
      if (!Array.isArray(b.work)) throw new HttpError(400, 'VALIDATION_FAILED', 'Send the images.');
      const sent = b.work.filter((w) => have.has(String((w as { id?: string }).id))).map((w) => ({ id: String((w as { id: string }).id), caption: String((w as { caption?: string }).caption ?? '').trim().slice(0, 80) }));
      // An image left out keeps its place at the end: only its own route removes it (and its file).
      const kept = json<{ id: string; caption: string }[]>(p.work, []).filter((w) => !sent.some((x) => x.id === w.id));
      next.work = JSON.stringify([...new Map([...sent, ...kept].map((w) => [w.id, w])).values()]);
    }
    if (b.published !== undefined) next.published = b.published ? 1 : 0;
    if (b.theme !== undefined) {
      const t = String(b.theme);
      const tier = THEME_TIERS[t];
      if (!tier) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose one of the designs.');
      if (TIER[tier] > TIER[f.themeTier]) throw new HttpError(403, 'PLAN_FEATURE', `This design is on ${tier === 'pro' ? 'Pro' : 'Plus and Pro'}. Upgrade in Plan & usage.`, { feature: 'themeTier' });
      next.theme = t;
    }
    if (b.socials !== undefined) {
      if (!Array.isArray(b.socials) || b.socials.length > 30) throw new HttpError(400, 'VALIDATION_FAILED', 'Add up to 30 social links.');
      next.socials = JSON.stringify(b.socials.map((s) => {
        const kind = String((s as { kind?: string })?.kind) as SocialKind;
        if (!SOCIALS.includes(kind)) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose the kind of social link.');
        return { kind, url: socialUrl(kind, (s as { url?: string }).url) };
      }));
    }
    if (b.customHtml !== undefined) {
      const html = String(b.customHtml ?? '');
      if (html.length > 200_000) throw new HttpError(400, 'VALIDATION_FAILED', 'Your HTML can be up to 200 KB.');
      if (html && !f.customPage) throw new HttpError(403, 'PLAN_FEATURE', 'Your own page design is on Pro. Upgrade in Plan & usage.', { feature: 'customPage' });
      next.custom_html = html || null;
    }
    if (b.useCustom !== undefined) {
      if (b.useCustom && !f.customPage) throw new HttpError(403, 'PLAN_FEATURE', 'Your own page design is on Pro. Upgrade in Plan & usage.', { feature: 'customPage' });
      if (b.useCustom && !next.custom_html) throw new HttpError(400, 'VALIDATION_FAILED', 'Add your HTML first.');
      next.use_custom = b.useCustom ? 1 : 0;
    }
    db.prepare(`UPDATE profiles SET bio=?, location=?, theme=?, layout=?, socials=?, published=?, custom_html=?, use_custom=?, home=?, headline=?, about=?,
      cta=?, stats=?, services=?, work=?, palette=?, ptype=?, updated_at=? WHERE user_id=?`)
      .run(next.bio, next.location, next.theme, next.layout, next.socials, next.published, next.custom_html, next.use_custom, next.home, next.headline, next.about,
        next.cta, next.stats, next.services, next.work, next.palette, next.ptype, now(), u.id);
    return editorView(u);
  });

  function readItem(u: UserRow, b: Record<string, unknown>, cur?: ItemRow) {
    const type = (cur?.type ?? String(b.type)) as ItemType;
    if (!ITEM_TYPES.includes(type)) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose what to add.');
    const str = (k: string, max: number, fallback = '') => (b[k] === undefined ? (cur ? String((cur as unknown as Record<string, unknown>)[k] ?? '') : fallback) : String(b[k] ?? '').trim().slice(0, max));
    const out = {
      type, title: str('title', 120), subtitle: str('subtitle', 160),
      url: cur?.url ?? null as string | null, text: cur?.text ?? null as string | null, app_id: cur?.app_id ?? null as string | null,
      highlight: b.highlight === undefined ? cur?.highlight ?? 0 : b.highlight ? 1 : 0,
      visible: b.visible === undefined ? cur?.visible ?? 1 : b.visible ? 1 : 0,
    };
    if ((type === 'link' || type === 'video') && (b.url !== undefined || !cur)) out.url = httpUrl(b.url, type === 'video' ? 'video link' : 'address');
    if (type === 'video' && out.url && !embedOf(out.url) && b.url !== undefined) throw new HttpError(400, 'VALIDATION_FAILED', 'Paste a YouTube or Vimeo link to play it on the page. For other videos, add a link instead.');
    if (type === 'text' && (b.text !== undefined || !cur)) { out.text = String(b.text ?? '').trim().slice(0, 1000); if (!out.text) throw new HttpError(400, 'VALIDATION_FAILED', 'Write the text.'); }
    if (type === 'header' && !out.title) throw new HttpError(400, 'VALIDATION_FAILED', 'Write the heading.');
    if (type === 'app' && (b.appId !== undefined || !cur)) {
      const a = db.prepare('SELECT id FROM apps WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(String(b.appId), u.id);
      if (!a) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose one of your apps.');
      out.app_id = String(b.appId);
    }
    if (out.highlight && featuresOf(u).themeTier === 'free') throw new HttpError(403, 'PLAN_FEATURE', 'Highlighting a link is on Plus and Pro. Upgrade in Plan & usage.', { feature: 'highlight' });
    return out;
  }
  app.post('/api/me/page/items', async (req) => {
    const u = me(req);
    limit(req, 'page-items', 240, 60_000, u.id);
    if ((db.prepare('SELECT COUNT(*) n FROM profile_items WHERE user_id=?').get(u.id) as { n: number }).n >= 100) throw new HttpError(400, 'VALIDATION_FAILED', 'A page can hold up to 100 items.');
    const v = readItem(u, (req.body ?? {}) as Record<string, unknown>);
    const pos = (db.prepare('SELECT COALESCE(MIN(position),0)-1 n FROM profile_items WHERE user_id=?').get(u.id) as { n: number }).n;
    const t = now();
    const first = (req.body as { position?: string })?.position !== 'end';
    const position = first ? pos : (db.prepare('SELECT COALESCE(MAX(position),0)+1 n FROM profile_items WHERE user_id=?').get(u.id) as { n: number }).n;
    db.prepare('INSERT INTO profile_items(id,user_id,position,type,title,subtitle,url,text,app_id,highlight,visible,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(newId('pi'), u.id, position, v.type, v.title, v.subtitle, v.url, v.text, v.app_id, v.highlight, v.visible, t, t);
    return editorView(u);
  });
  app.patch('/api/me/page/items/:id', async (req) => {
    const u = me(req);
    const cur = db.prepare('SELECT * FROM profile_items WHERE id=? AND user_id=?').get((req.params as { id: string }).id, u.id) as ItemRow | undefined;
    if (!cur) throw new HttpError(404, 'NOT_FOUND', 'That item is not on your page.');
    const v = readItem(u, (req.body ?? {}) as Record<string, unknown>, cur);
    db.prepare('UPDATE profile_items SET title=?, subtitle=?, url=?, text=?, app_id=?, highlight=?, visible=?, updated_at=? WHERE id=?')
      .run(v.title, v.subtitle, v.url, v.text, v.app_id, v.highlight, v.visible, now(), cur.id);
    return editorView(u);
  });
  app.delete('/api/me/page/items/:id', async (req) => {
    const u = me(req);
    db.prepare('DELETE FROM profile_items WHERE id=? AND user_id=?').run((req.params as { id: string }).id, u.id);
    return editorView(u);
  });
  app.put('/api/me/page/order', async (req) => {
    const u = me(req);
    const ids = (req.body as { ids?: unknown })?.ids;
    if (!Array.isArray(ids)) throw new HttpError(400, 'VALIDATION_FAILED', 'Send the new order.');
    const set = db.prepare('UPDATE profile_items SET position=? WHERE id=? AND user_id=?');
    db.transaction(() => ids.forEach((id, i) => set.run(i, String(id), u.id)))();
    return editorView(u);
  });

  /** Views, visitors and clicks: as far back as the plan allows. */
  app.get('/api/me/page/analytics', async (req) => {
    const u = me(req);
    const max = featuresOf(u).analyticsDays;
    const days = Math.max(1, Math.min(max, Number((req.query as { days?: string }).days) || 30));
    const start = new Date(); start.setUTCHours(0, 0, 0, 0); start.setUTCDate(start.getUTCDate() - (days - 1));
    const from = start.toISOString().slice(0, 10);
    const rows = new Map((db.prepare('SELECT day, views, visitors, clicks FROM page_days WHERE user_id=? AND day>=?').all(u.id, from) as { day: string; views: number; visitors: number; clicks: number }[]).map((r) => [r.day, r]));
    const series = Array.from({ length: days }, (_, i) => { const d = new Date(start); d.setUTCDate(start.getUTCDate() + i); const k = d.toISOString().slice(0, 10); const r = rows.get(k); return { day: k, views: r?.views ?? 0, visitors: r?.visitors ?? 0, clicks: r?.clicks ?? 0 }; });
    const sum = (k: 'views' | 'visitors' | 'clicks') => series.reduce((s, r) => s + r[k], 0);
    const dims = (dim: string) => db.prepare('SELECT value, SUM(n) n FROM page_dims WHERE user_id=? AND day>=? AND dim=? GROUP BY value ORDER BY n DESC LIMIT 12').all(u.id, from, dim);
    const items = db.prepare(`SELECT i.id, i.type, i.title, i.url, COALESCE(SUM(d.clicks),0) clicks FROM profile_items i LEFT JOIN item_days d ON d.item_id=i.id AND d.day>=?
      WHERE i.user_id=? AND i.type IN ('link','video','app') GROUP BY i.id ORDER BY clicks DESC, i.position`).all(from, u.id);
    const links = db.prepare(`SELECT l.code, l.url, COALESCE(SUM(c.n),0) clicks FROM short_links l LEFT JOIN link_clicks c ON c.link_id=l.id AND c.day>=? WHERE l.owner_id=? GROUP BY l.id ORDER BY clicks DESC LIMIT 20`).all(from, u.id);
    const views = sum('views'); const clicks = sum('clicks');
    return { days, maxDays: max, totals: { views, visitors: sum('visitors'), clicks, ctr: views ? Math.round((clicks / views) * 1000) / 10 : 0 }, series, items, refs: dims('ref'), devices: dims('device'), countries: dims('country'), pages: dims('page'), shortLinks: links };
  });
}
