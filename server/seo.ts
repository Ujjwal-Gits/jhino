import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ROOT, config } from './config.js';
import { db, now, roleOf, logActivity, type AppRow, type UserRow } from './db.js';
import { HttpError, requireUser } from './auth.js';
import { limit, setting, setSetting } from './security.js';
import { featuresOf, publicPlans, type Plan } from './plans.js';
import { pageData } from './profiles.js';
import { applyAddress, baseFor, readAddressRequest, setSharing, usernameOf } from './publicshare.js';
import { appDir } from './packages.js';
import { faviconIco, installInfo, logoPng, ogPng } from './pwa.js';

/*
 * Search engines, social previews and AI search. Jhino is a single-page app, so the server writes each
 * page's head (title, description, canonical, robots, Open Graph, schema.org JSON-LD) into the HTML it
 * sends, plus a plain snapshot of the page's words that the app replaces once it starts. Crawlers that
 * do not run JavaScript read the same content people see. Pages that should not be found (dashboards,
 * private apps) say noindex; addresses that do not exist answer 404.
 *
 * What gets indexed: the website, people's pages (unless they opt out, or the page is still empty), and
 * apps whose owner ticked "Show on Google" (Pro: up to 10; super admins: any). Every title ends "| Jhino".
 */

const SUFFIX = ' | Jhino';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Cut at a word, with an ellipsis, so a description fits the space search results give it. */
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/[\s,.;:!-]+\S*$/, '') + '…';
};
const withSuffix = (t: string) => (/\|\s*jhino\s*$/i.test(t) ? t.replace(/\s*\|\s*jhino\s*$/i, SUFFIX) : t + SUFFIX);
const base = (req: FastifyRequest) => baseFor(req).replace(/\/$/, '');

/** Which parts of the site are pages of Jhino itself (keep in step with KNOWN in web/src/main.tsx). */
const KNOWN = new Set(['_themes', 'go', 'p', 'links', 'login', 'signup', 'forgot', 'reset', 'verify', 'help', 'terms', 'privacy', 'build', 'shared', 'trash', 'people', 'account', 'admin', 'apps', 'invite', 's', 'api', 'run', 'pricing', 'sitemap']);

interface Doc {
  status: number;
  title: string;
  description: string;
  /** The address this page is known by (canonical), from the site root. */
  path: string;
  index: boolean;
  image?: string;
  imageAlt?: string;
  card?: 'summary' | 'summary_large_image';
  type?: 'website' | 'profile' | 'article';
  keywords?: string[];
  jsonld?: Record<string, unknown>[];
  /** Plain HTML of the page's words, for crawlers; the app replaces it when it starts. */
  body?: string;
  verify?: boolean;
}

/* ---------------- the website ---------------- */
// Keep in step with FAQ in web/src/pages/Public.tsx (schema must match what the page shows).
const FAQ: [string, string][] = [
  ['What counts as an app?', 'One app on your account: an HTML you uploaded, or one you made with Create app. Apps in Trash count until you delete them for good.'],
  ['Does my client need an account?', 'Only if you want one. Give them a sign-in, or share the app by public link or by link and password. You decide what visitors can do: view, add or edit.'],
  ['Will any HTML file work?', 'Yes. Plain HTML, CSS and JavaScript that saves with localStorage or IndexedDB syncs between everyone with no changes. Its own design stays exactly as it is.'],
  ['Can I use my own address?', 'Yes. Pick jhino.com/your-name when you create an app, or later in Share. Each address is unique. The page opens at that exact address, with no redirect.'],
  ['What is jhino.com/your-name?', 'Your own page, like a link in bio: your links, socials, videos and apps in one of 40 designs, as a list or a full profile. It can show up on Google. Share it anywhere and see who clicks what.'],
  ['Can my app show up on Google?', 'On Pro, yes: tick "Show on Google" in Share, then give it a title, a description, an address and a keyword. It becomes a public page anyone can open without signing in, and search engines can list it. Up to 10 pages on Pro.'],
  ['What are short links?', 'A short address like jhino.com/abc that opens any web link you choose: a Drive folder, a YouTube cut, a form. You see how many times each one was opened.'],
  ['Monthly or yearly?', 'Either. Pay month by month, or pay for a whole year at a lower price. Both are paid the same way, and paying again adds to your end date.'],
  ['How big can a file be?', 'Each plan shows its largest file size. For bigger videos, paste a Google Drive, Dropbox or YouTube link: it shows as a proper preview.'],
  ['How do I pay?', 'Choose a plan, scan the QR code, and upload a screenshot of the payment. We check it and switch the plan on, usually the same day. You get a receipt.'],
  ['Where is my data?', 'On the Jhino server, backed up, and never sold. The Privacy page has the details.'],
];
const HOME_KEYWORDS = ['client portal', 'client portal for agencies', 'client approval app', 'video review and approval', 'photo proofing', 'design proofing', 'host HTML app', 'share HTML with clients', 'link in bio', 'link in bio Nepal', 'short links', 'studio booking', 'Jhino'];

const org = (b: string) => ({ '@type': 'Organization', '@id': `${b}/#org`, name: 'Jhino', url: `${b}/`, logo: { '@type': 'ImageObject', url: `${b}/_jhino/logo-512.png`, width: 512, height: 512 }, email: 'jhinoapp@gmail.com', areaServed: 'NP' });
const website = (b: string) => ({ '@type': 'WebSite', '@id': `${b}/#website`, url: `${b}/`, name: 'Jhino', alternateName: 'jhino.com', inLanguage: 'en', publisher: { '@id': `${b}/#org` } });
const crumbs = (b: string, items: [string, string][]) => ({
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${b}${p}` })),
});
const offer = (b: string, p: Plan) => ({
  '@type': 'Offer', name: p.name, price: String(p.price), priceCurrency: 'NPR', url: `${b}/pricing`, availability: 'https://schema.org/InStock',
  description: p.blurb, ...(p.price ? { priceSpecification: { '@type': 'UnitPriceSpecification', price: String(p.price), priceCurrency: 'NPR', billingDuration: 'P1M', unitText: 'month' } } : {}),
});
const software = (b: string) => ({
  '@type': 'SoftwareApplication', '@id': `${b}/#app`, name: 'Jhino', url: `${b}/`, applicationCategory: 'BusinessApplication', operatingSystem: 'Web, Android, iOS, Windows, macOS',
  description: 'Client apps for studios and agencies: share video cuts, photos, designs, bookings and invoices with clients on one live page, host your own HTML apps, a link-in-bio page and short links.',
  image: `${b}/_jhino/og.png`, publisher: { '@id': `${b}/#org` }, inLanguage: 'en',
  offers: publicPlans().map((p) => offer(b, p)),
});
const planLines = () => publicPlans().map((p) => `<li><b>${esc(p.name)}</b>: ${p.price ? `NPR ${p.price.toLocaleString('en-IN')} a month (NPR ${p.yearly.toLocaleString('en-IN')} a year)` : 'free, for good'}. ${p.creations} app${p.creations === 1 ? '' : 's'}. ${esc(p.blurb)}</li>`).join('');
const siteNav = '<p><a href="/signup">Start free</a> · <a href="/pricing">Pricing</a> · <a href="/help">Help</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>';

function sitePage(p: string, b: string): Doc | null {
  const plans = publicPlans();
  const pro = plans.find((x) => x.id === 'pro'), plus = plans.find((x) => x.id === 'plus');
  const priceLine = `Free Forever for one client. Plus NPR ${plus?.price.toLocaleString('en-IN')} a month, Pro NPR ${pro?.price.toLocaleString('en-IN')}.`;
  switch (p) {
    case '/':
      return {
        status: 200, index: true, path: '/', verify: true, card: 'summary_large_image', keywords: HOME_KEYWORDS,
        title: 'Client portal and link in bio for studios' + SUFFIX,
        description: 'Give every client one live page for cuts, photos, bookings and bills, and get their approval the moment they give it. Host HTML apps, a link in bio and short links. Free.',
        jsonld: [org(b), website(b), software(b), { '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }],
        body: `<h1>Send the work. Get the yes.</h1>
<p>Every client gets one live page. The cut, the photos, the booking and the bill sit on it, and their answer reaches you the moment they give it.</p>
<p>For video, photo and design studios, agencies and their clients. Upload the HTML you already have, or build one here in a few minutes. Prices in rupees, dates in Bikram Sambat.</p>
<h2>What moves between you</h2><p>Six things a studio sends a client every week: video cuts for review and approval, photo proofing with client picks, design proofs, shoots and bookings, invoices and receipts, and messages. Each one lands on their screen when you add it, and their answer lands on yours.</p>
<h2>Two ways to make one</h2><p>Bring the HTML you already have: a single file or a ZIP goes live at once and keeps its own design, and anything it saves with localStorage or IndexedDB syncs for everyone you let in. Or build it here in a few minutes: say who it is for, tick what the job needs, and it is ready to share. No code.</p>
<h2>Share it the way the job needs</h2><p>Keep it to the people you add, open it to anyone with the link, or put a password on the link, then choose what visitors can do. Give it its own address, like jhino.com/your-studio/client-room. On Pro, tick "Show on Google" and it becomes a public page search engines can list.</p>
<h2>Your page, and short links</h2><p>jhino.com/you is your link in bio: your links, socials, videos and apps in one of 40 designs, with analytics. Short links like jhino.com/s-promo open any address and count every click.</p>
<h2>Plans, in rupees</h2><ul>${planLines()}</ul>
<h2>Questions</h2><dl>${FAQ.map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join('')}</dl>
${siteNav}`,
      };
    case '/pricing':
      return {
        status: 200, index: true, path: '/pricing', card: 'summary_large_image', keywords: ['Jhino pricing', 'client portal price Nepal', 'link in bio free', ...HOME_KEYWORDS.slice(0, 4)],
        title: 'Pricing: Free, Plus and Pro plans in rupees' + SUFFIX,
        description: `${priceLine} Your own page, short links, password links and pages on Google. Pay monthly or yearly by QR.`,
        jsonld: [org(b), website(b), { ...software(b), '@id': `${b}/pricing#app` }, crumbs(b, [['Jhino', '/'], ['Pricing', '/pricing']])],
        body: `<h1>Plans, in rupees</h1><p>Start free with one app. Move up when you have more clients.</p><ul>${planLines()}</ul><p>Scan our QR code, upload a screenshot of the payment, and we switch the plan on, usually the same day. Yearly costs ten months.</p>${siteNav}`,
      };
    case '/help':
      return {
        status: 200, index: true, path: '/help', keywords: ['Jhino help', 'how to share HTML app with client', 'client portal guide'],
        title: 'Help and guides' + SUFFIX,
        description: 'How to upload an HTML app, build one without code, share it with a client by sign-in or link, set your address, and put a page on Google. Or write to us.',
        jsonld: [org(b), website(b), crumbs(b, [['Jhino', '/'], ['Help', '/help']])],
        body: `<h1>Help</h1><p>Guides for uploading your own HTML, building an app here, sharing it with clients, your page at jhino.com/you, short links and plans. Write to us from this page: we reply by email, usually within a working day.</p>${siteNav}`,
      };
    case '/terms':
      return { status: 200, index: true, path: '/terms', title: 'Terms of Service' + SUFFIX, description: 'The terms for using Jhino: your account, your content, plans and payment, availability and ending your account.', jsonld: [org(b), crumbs(b, [['Jhino', '/'], ['Terms of Service', '/terms']])], body: `<h1>Terms of Service</h1><p>Using Jhino, your account, your content, plans and payment, availability, and ending.</p>${siteNav}` };
    case '/privacy':
      return { status: 200, index: true, path: '/privacy', title: 'Privacy Policy' + SUFFIX, description: 'What Jhino keeps and why, visits and cookies, who sees your data, services we use, backups, emails and your choices. We never sell your data.', jsonld: [org(b), crumbs(b, [['Jhino', '/'], ['Privacy Policy', '/privacy']])], body: `<h1>Privacy Policy</h1><p>What we keep, why, visits and cookies, who sees it, services we use, backups, emails and your choices. Your data is never sold.</p>${siteNav}` };
    case '/signup':
      return { status: 200, index: true, path: '/signup', title: 'Create your free account' + SUFFIX, description: 'Start free: one client app, your own page at jhino.com/you and short links. No card needed. Upgrade to Plus or Pro when you have more clients.', jsonld: [org(b), website(b)], body: `<h1>Create your free account</h1><p>One client app free, for good, with your own page at jhino.com/you. No card.</p>${siteNav}` };
    case '/login':
      return { status: 200, index: true, path: '/login', title: 'Sign in' + SUFFIX, description: 'Sign in to Jhino to open your client apps, your page and your short links.', jsonld: [org(b), website(b)] };
  }
  return null;
}

/* ---------------- people's pages ---------------- */
interface ProfileSeoRow { published: number; seo_index: number; seo_description: string | null; bio: string; location: string; updated_at: string }
function profileDoc(u: UserRow, p: string, b: string): Doc {
  const pr = db.prepare('SELECT published, seo_index, seo_description, bio, location, updated_at FROM profiles WHERE user_id=?').get(u.id) as ProfileSeoRow | undefined;
  const d = pageData(u) as ReturnType<typeof pageData> & { items: { type: string; title?: string; text?: string; href?: string; subtitle?: string }[] };
  const name = d.name || u.username!;
  const title = `${name} (@${u.username})` + SUFFIX;
  if (pr && !pr.published) return { status: 404, index: false, path: p, title: 'There is no page here' + SUFFIX, description: 'This page is not public.' };
  const links = d.items.filter((i) => i.type === 'link' || i.type === 'app' || i.type === 'video');
  // Every person's page is listed. One with nothing on it yet still says who it is and where.
  const described = pr?.seo_description?.trim() || d.bio || (links.length
    ? `${name}'s links: ${links.slice(0, 4).map((l) => l.title).filter(Boolean).join(', ')}${d.location ? `, ${d.location}` : ''}.`
    : `${name} (@${u.username}) on Jhino: links, work and apps${d.location ? ` from ${d.location}` : ''}.`);
  const description = clip(`${described}${pr?.seo_description ? '' : d.location && d.bio ? ` · ${d.location}` : ''}`, 158);
  const url = `${b}/${u.username}`;
  const sameAs = d.socials.map((s) => s.url).filter((x) => /^https?:\/\//.test(x));
  const image = d.avatarUrl ? `${b}${d.avatarUrl}` : undefined;
  return {
    // Accounts that never confirmed their email stay out of search results until they do.
    status: 200, index: pr?.seo_index !== 0 && !u.verify_required, path: `/${u.username}`, type: 'profile', card: image ? 'summary' : 'summary_large_image',
    title, description, image, imageAlt: image ? `Photo of ${name}` : undefined,
    keywords: [name, `@${u.username}`, ...(d.location ? [d.location] : []), 'Jhino'],
    jsonld: [
      {
        '@type': 'ProfilePage', '@id': `${url}#page`, url, name: title, description, inLanguage: 'en', isPartOf: { '@id': `${b}/#website` },
        ...(pr?.updated_at ? { dateModified: pr.updated_at } : {}),
        mainEntity: {
          '@type': 'Person', '@id': `${url}#person`, name, alternateName: `@${u.username}`, identifier: u.username, url,
          ...(d.bio ? { description: d.bio } : {}), ...(image ? { image } : {}), ...(sameAs.length ? { sameAs } : {}),
          ...(d.location ? { homeLocation: { '@type': 'Place', name: d.location } } : {}),
        },
      },
      website(b), org(b), crumbs(b, [['Jhino', '/'], [name, `/${u.username}`]]),
    ],
    body: `<h1>${esc(name)}</h1><p>@${esc(u.username)}</p>${d.bio ? `<p>${esc(d.bio)}</p>` : ''}${d.location ? `<p>${esc(d.location)}</p>` : ''}
${d.items.length ? `<ul>${d.items.map((i) => (i.type === 'header' ? `</ul><h2>${esc(i.title)}</h2><ul>` : i.type === 'text' ? `<li>${esc(i.text)}</li>` : i.href ? `<li><a href="${esc(i.href)}">${esc(i.title)}</a>${i.subtitle ? ` · ${esc(i.subtitle)}` : ''}</li>` : '')).join('')}</ul>` : ''}
${sameAs.length ? `<ul>${d.socials.filter((s) => /^https?:/.test(s.url)).map((s) => `<li><a href="${esc(s.url)}" rel="me noopener">${esc(s.kind)}</a></li>`).join('')}</ul>` : ''}
<p><a href="/">Made with Jhino</a></p>`,
  };
}

/* ---------------- apps shown on Google ---------------- */
type SeoApp = AppRow & { seo_on?: number; seo_title?: string | null; seo_description?: string | null; seo_keyword?: string | null; seo_updated_at?: string | null };
/** The address an app is best known by: a top-level address, or /<owner>/<name>. */
function appPath(a: SeoApp): string | null {
  if (a.root_slug) return `/${a.root_slug}`;
  const u = a.slug ? usernameOf(a.owner_id) : null;
  return u && a.slug ? `/${u}/${a.slug}` : null;
}
/** On Google right now: ticked, open to anyone to view, with an address, and allowed by the owner's plan. */
function seoLive(a: SeoApp) {
  if (!a.seo_on || a.deleted_at || a.access !== 'public' || (a.public_role ?? 'viewer') !== 'viewer' || !appPath(a)) return false;
  const owner = db.prepare('SELECT * FROM users WHERE id=?').get(a.owner_id) as UserRow | undefined;
  return !!owner && !owner.disabled && (!!owner.is_admin || featuresOf(owner).seoPages > 0);
}
/** The words on an app, for crawlers: an uploaded page's own text, or a built app's sections and items. */
const snapshots = new Map<string, { at: number; html: string }>();
function appWords(a: SeoApp): string {
  const key = `${a.id}:${a.live_version}:${a.updated_at}:${a.seo_updated_at}`;
  const hit = snapshots.get(a.id);
  if (hit && hit.html && Date.now() - hit.at < 5 * 60_000 && snapshots.get(a.id + ':key')?.html === key) return hit.html;
  const v = db.prepare('SELECT entry, builder FROM app_versions WHERE app_id=? AND n=?').get(a.id, a.live_version) as { entry: string; builder: string | null } | undefined;
  let html = '';
  try {
    const file = v ? path.join(appDir(a.id, a.live_version), v.entry) : '';
    const src = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8').slice(0, 2_000_000) : '';
    html = v?.builder ? builtWords(a, src) : pageWords(src);
  } catch { html = ''; }
  snapshots.set(a.id, { at: Date.now(), html });
  snapshots.set(a.id + ':key', { at: Date.now(), html: key });
  if (snapshots.size > 600) snapshots.clear();
  return html;
}
function decode(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k[0] === '#') { const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) && n > 31 && n < 0x10ffff ? String.fromCodePoint(n) : ' '; }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" } as Record<string, string>)[k] ?? m;
  });
}
/** An uploaded page's visible words, as headings and paragraphs (scripts, styles and code left out). */
function pageWords(src: string) {
  const bodyAt = src.search(/<body\b/i);
  let s = bodyAt >= 0 ? src.slice(bodyAt) : src;
  s = s.replace(/<(script|style|noscript|template|svg|iframe|canvas|select|textarea|code|pre)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<h[1-6]\b[^>]*>/gi, '\n\u0001').replace(/<\/h[1-6]\s*>/gi, '\n')
    .replace(/<img\b[^>]*?\balt\s*=\s*["']([^"']{3,200})["'][^>]*>/gi, '\n$1\n')
    .replace(/<\/?(br|p|div|li|tr|section|article|header|footer|main|nav|aside|ul|ol|table|blockquote|figcaption|dt|dd|button|label|td|th|form|figure)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  const seen = new Set<string>();
  const out: string[] = [];
  let chars = 0;
  for (const raw of decode(s).split('\n')) {
    const head = raw.startsWith('\u0001');
    const line = raw.replace(/\u0001/g, '').replace(/\s+/g, ' ').trim();
    if (line.length < 2 || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    out.push(head ? `<h2>${esc(line)}</h2>` : `<p>${esc(line)}</p>`);
    chars += line.length;
    if (out.length >= 120 || chars > 9000) break;
  }
  return out.join('\n');
}
/** A built app: its sections, what each is for, and the titles of what is in them (all public to view). */
function builtWords(a: SeoApp, src: string) {
  let cfg: { purpose?: string; client?: string; blocks?: { id: string; title: string; description?: string; titleField?: string; visibility?: string }[] } = {};
  try { cfg = JSON.parse(/<script type="application\/json" id="jhino-app-config">([^<]*)<\/script>/.exec(src)?.[1] ?? '{}'); } catch { /* an old build */ }
  const parts: string[] = [];
  if (cfg.client) parts.push(`<p>${esc(cfg.client)}</p>`);
  if (cfg.purpose) parts.push(`<p>${esc(cfg.purpose)}</p>`);
  const titles = db.prepare('SELECT data FROM records WHERE app_id=? AND collection=? ORDER BY created_at DESC LIMIT 15');
  for (const bl of cfg.blocks ?? []) {
    if (bl.visibility === 'own') continue;
    parts.push(`<h2>${esc(bl.title)}</h2>`);
    if (bl.description) parts.push(`<p>${esc(bl.description)}</p>`);
    if (!bl.titleField) continue;
    const items = (titles.all(a.id, bl.id) as { data: string }[]).map((r) => { try { return String(JSON.parse(r.data)[bl.titleField!] ?? ''); } catch { return ''; } }).filter((t) => t && t.length < 200);
    if (items.length) parts.push(`<ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`);
  }
  return parts.join('\n');
}
function appDoc(a: SeoApp, requested: string, b: string): Doc {
  const canonical = appPath(a) ?? requested;
  if (!seoLive(a)) {
    // Opens as before (signed in, by link, or by password), but is not for search engines.
    return { status: 200, index: false, path: canonical, title: withSuffix(a.name), description: `${a.name}, on Jhino.` };
  }
  const owner = db.prepare('SELECT * FROM users WHERE id=?').get(a.owner_id) as UserRow;
  const ownerName = owner.display_name || owner.name;
  const title = withSuffix(a.seo_title || a.name);
  const description = clip(a.seo_description || `${a.name}, on Jhino.`, 160);
  const url = `${b}${canonical}`;
  const icon = installInfo(a, canonical);
  const image = `${b}${icon.icon.replace('-192.png', '-512.png')}`;
  const words = appWords(a);
  const byline = owner.username ? `<p>By <a href="/${esc(owner.username)}">${esc(ownerName)}</a> · Made with <a href="/">Jhino</a></p>` : `<p>Made with <a href="/">Jhino</a></p>`;
  return {
    status: 200, index: true, path: canonical, type: 'website', card: 'summary', title, description, image, imageAlt: a.name,
    keywords: [a.seo_keyword ?? '', a.name, 'Jhino'].filter(Boolean),
    jsonld: [
      {
        '@type': 'WebPage', '@id': `${url}#page`, url, name: title, headline: a.seo_title || a.name, description, inLanguage: 'en',
        keywords: a.seo_keyword ?? undefined, isPartOf: { '@id': `${b}/#website` }, primaryImageOfPage: { '@type': 'ImageObject', url: image },
        datePublished: a.created_at, dateModified: a.seo_updated_at || a.updated_at,
        author: { '@type': 'Person', name: ownerName, ...(owner.username ? { url: `${b}/${owner.username}` } : {}) },
      },
      website(b), org(b),
      crumbs(b, owner.username && !a.root_slug ? [['Jhino', '/'], [ownerName, `/${owner.username}`], [a.seo_title || a.name, canonical]] : [['Jhino', '/'], [a.seo_title || a.name, canonical]]),
    ],
    body: `<h1>${esc(a.seo_title || a.name)}</h1><p>${esc(description)}</p>\n${words}\n${byline}`,
  };
}

/* ---------------- which page an address is ---------------- */
const NOINDEX_DOC = (p: string): Doc => ({ status: 200, index: false, path: p, title: 'Jhino', description: 'Jhino: client apps, a link in bio and short links.' });
const NOT_FOUND = (p: string): Doc => ({ status: 404, index: false, path: p, title: 'Nothing here' + SUFFIX, description: 'This address does not exist on Jhino, or it was removed.' });
function resolveDoc(pathname: string, b: string): Doc {
  const p = pathname.replace(/\/+$/, '') || '/';
  // Pages of the site that used this domain before Jhino (…/abc.html): gone for good, so search engines drop them fast.
  if (/\.(s?html?|php|aspx?|jsp)$/i.test(p)) return { status: 410, index: false, path: p, title: 'This page is gone' + SUFFIX, description: 'This address is not part of Jhino.' };
  const site = sitePage(p, b);
  if (site) return site;
  const seg = p.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  if (!seg.length) return NOT_FOUND(p);
  // Jhino's own screens (dashboards, sign-in steps, invites, share-token links): never in search results.
  if (KNOWN.has(seg[0].toLowerCase())) return NOINDEX_DOC(p);
  const findUser = (n: string) => (/^[\w-]{2,50}$/.test(n) ? db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE AND kind='person' AND disabled=0").get(n) as UserRow | undefined : undefined);
  if (seg.length === 1) {
    const u = findUser(seg[0]);
    if (u) return profileDoc(u, p, b);
    const a = /^[\w-]{1,64}$/.test(seg[0]) ? db.prepare('SELECT * FROM apps WHERE root_slug=? COLLATE NOCASE AND deleted_at IS NULL').get(seg[0]) as SeoApp | undefined : undefined;
    return a ? appDoc(a, p, b) : NOT_FOUND(p);
  }
  if (seg.length === 2) {
    const u = findUser(seg[0]);
    if (!u) return NOT_FOUND(p);
    if (seg[1].toLowerCase() === 'preview') return NOINDEX_DOC(p);
    const a = /^[\w-]{2,64}$/.test(seg[1]) ? db.prepare('SELECT * FROM apps WHERE owner_id=? AND slug=? COLLATE NOCASE AND deleted_at IS NULL').get(u.id, seg[1]) as SeoApp | undefined : undefined;
    return a ? appDoc(a, p, b) : NOT_FOUND(p);
  }
  return NOT_FOUND(p);
}

/* ---------------- writing the head ---------------- */
const INDEX_ROBOTS = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
const SNAPSHOT_STYLE = '<style id="seo-snap-style">@keyframes seo-in{from{opacity:0}}.seo-snap{animation:seo-in .3s ease 1.5s both;max-width:760px;margin:0 auto;padding:56px 20px 64px;font:16px/1.6 "Schibsted Grotesk Variable","Helvetica Neue",Arial,sans-serif;color:#141414;background:#fff}.seo-snap h1{font-size:34px;line-height:1.15;letter-spacing:-.02em;margin:0 0 14px}.seo-snap h2{font-size:19px;margin:28px 0 8px}.seo-snap p,.seo-snap li,.seo-snap dd{color:#4b4a47}.seo-snap dt{font-weight:600;margin-top:12px}.seo-snap dd{margin:2px 0 0}.seo-snap a{color:#141414}</style>';
function head(d: Doc, b: string) {
  const url = `${b}${d.path === '/' ? '/' : d.path}`;
  const image = d.image ?? `${b}/_jhino/og.png`;
  const big = (d.card ?? (d.image ? 'summary' : 'summary_large_image')) === 'summary_large_image';
  const tags = [
    `<title>${esc(d.title)}</title>`,
    `<meta name="description" content="${esc(d.description)}">`,
    `<meta name="robots" content="${d.index ? INDEX_ROBOTS : 'noindex, nofollow'}">`,
    d.index ? `<link rel="canonical" href="${esc(url)}">` : '',
    d.keywords?.length ? `<meta name="keywords" content="${esc(d.keywords.join(', '))}">` : '',
    `<meta property="og:site_name" content="Jhino">`,
    `<meta property="og:locale" content="en_US">`,
    `<meta property="og:type" content="${d.type ?? 'website'}">`,
    `<meta property="og:title" content="${esc(d.title)}">`,
    `<meta property="og:description" content="${esc(d.description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    big ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : '',
    `<meta property="og:image:alt" content="${esc(d.imageAlt ?? 'Jhino: send the work, get the yes.')}">`,
    `<meta name="twitter:card" content="${big ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(d.title)}">`,
    `<meta name="twitter:description" content="${esc(d.description)}">`,
    `<meta name="twitter:image" content="${esc(image)}">`,
    d.verify && process.env.GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${esc(process.env.GOOGLE_SITE_VERIFICATION)}">` : '',
    d.verify && process.env.BING_SITE_VERIFICATION ? `<meta name="msvalidate.01" content="${esc(process.env.BING_SITE_VERIFICATION)}">` : '',
    d.jsonld?.length ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': d.jsonld }).replace(/</g, '\\u003c')}</script>` : '',
    d.body ? SNAPSHOT_STYLE : '',
  ];
  return tags.filter(Boolean).join('\n');
}

/**
 * The website's index.html for this address, with this page's head and (for crawlers) its words.
 * Used for every page the single-page app serves.
 */
export function renderDocument(req: FastifyRequest, html: string): { status: number; html: string } {
  const b = base(req);
  let d: Doc;
  try { d = resolveDoc(new URL(req.url, 'http://x').pathname, b); } catch { d = NOINDEX_DOC('/'); }
  let out = html.replace(/<title>[^<]*<\/title>/i, head(d, b));
  if (d.body) out = out.replace('<div id="root"></div>', `<div id="root"><main class="seo-snap">${d.body}</main></div>`);
  return { status: d.status, html: out };
}

/* ---------------- sitemap, robots, llms.txt, IndexNow ---------------- */
/*
 * The sitemap is made on every request from the database, so a new page, a person who opts out or an
 * app taken off Google shows at once. "lastmod" is when the page's content last changed: for people,
 * their page settings, links or photo; for apps on Google, their settings, a new version, or their data.
 */
const SITE_PAGES: [string, string, string, number][] = [
  ['/', 'Home: client portal and link in bio', 'weekly', 1.0], ['/pricing', 'Pricing', 'weekly', 0.9], ['/signup', 'Create a free account', 'monthly', 0.7],
  ['/help', 'Help and guides', 'monthly', 0.6], ['/sitemap', 'Sitemap', 'weekly', 0.4], ['/terms', 'Terms of Service', 'yearly', 0.3], ['/privacy', 'Privacy Policy', 'yearly', 0.3],
];
/** When the website itself last changed: the deployed build's date. */
function siteDate() {
  try { return fs.statSync(path.join(ROOT, 'dist', 'web', 'index.html')).mtime.toISOString(); } catch { return new Date().toISOString(); }
}
interface Entry { path: string; title: string; lastmod: string; changefreq: string; priority: number; image?: string; sub?: string }
function entries(b: string): { site: Entry[]; people: Entry[]; apps: Entry[] } {
  const built = siteDate();
  const site = SITE_PAGES.map(([p, title, changefreq, priority]) => ({ path: p, title, lastmod: built, changefreq, priority }));
  // Every person with a username has a page (a new account's page exists before they open My page).
  const rows = db.prepare(`SELECT u.username, u.name, u.display_name, u.avatar, COALESCE(p.bio, '') bio, COALESCE(p.location, '') location,
      MAX(COALESCE(p.updated_at, u.created_at), COALESCE((SELECT MAX(i.updated_at) FROM profile_items i WHERE i.user_id=u.id), '')) changed
    FROM users u LEFT JOIN profiles p ON p.user_id=u.id
    WHERE u.kind='person' AND u.disabled=0 AND u.username IS NOT NULL AND COALESCE(u.verify_required, 0)=0 AND COALESCE(p.published, 1)=1 AND COALESCE(p.seo_index, 1)=1
    ORDER BY changed DESC LIMIT 45000`).all() as { username: string; name: string; display_name: string | null; avatar: string | null; bio: string; location: string; changed: string }[];
  const people = rows.map((u) => ({
    path: `/${u.username}`, title: `${u.display_name || u.name} (@${u.username})`, sub: [u.location, clip(u.bio ?? '', 90)].filter(Boolean).join(' · '),
    lastmod: u.changed, changefreq: 'weekly', priority: 0.6, image: u.avatar ? `/api/profile/${u.username}/avatar` : undefined,
  }));
  const appRows = db.prepare(`SELECT a.*, MAX(COALESCE(a.seo_updated_at,''), a.updated_at,
      COALESCE((SELECT MAX(updated_at) FROM records r WHERE r.app_id=a.id), ''),
      COALESCE((SELECT MAX(updated_at) FROM kv k WHERE k.app_id=a.id AND k.scope=''), '')) changed
    FROM apps a WHERE a.seo_on=1 AND a.deleted_at IS NULL AND a.access='public'`).all() as (SeoApp & { changed: string })[];
  const apps: Entry[] = [];
  for (const a of appRows) {
    if (!seoLive(a)) continue;
    const p = appPath(a)!;
    const owner = usernameOf(a.owner_id);
    apps.push({ path: p, title: a.seo_title || a.name, sub: owner ? `by @${owner}` : undefined, lastmod: a.changed, changefreq: 'weekly', priority: 0.7, image: installInfo(a, p).icon.replace('-192.png', '-512.png') });
  }
  apps.sort((x, y) => (x.lastmod < y.lastmod ? 1 : -1));
  return { site, people, apps };
}
function sitemap(b: string) {
  const e = entries(b);
  const url = (x: Entry) => `<url><loc>${esc(b + x.path)}</loc><lastmod>${x.lastmod.slice(0, 10)}</lastmod><changefreq>${x.changefreq}</changefreq><priority>${x.priority.toFixed(1)}</priority>${x.image ? `<image:image><image:loc>${esc(b + x.image)}</image:loc></image:image>` : ''}</url>`;
  // The stylesheet only changes how a browser shows it; search engines read the XML as it is.
  return `<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${[...e.site, ...e.apps, ...e.people].map(url).join('\n')}\n</urlset>\n`;
}
/** The look shared by sitemap.xml (in a browser) and the /sitemap page: white paper, black ink, hairlines. */
const PAGE_STYLE = `*{box-sizing:border-box}html{background:#fff;color:#141414;font:15px/1.55 "Schibsted Grotesk Variable","Schibsted Grotesk","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
body{margin:0}.sm{max-width:1040px;margin:0 auto;padding:40px 20px 72px}a{color:#141414;text-underline-offset:3px}
.sm-mark{display:inline-flex;align-items:baseline;font-weight:700;font-size:22px;letter-spacing:-.04em;text-decoration:none}.sm-mark i{width:6px;height:6px;margin-left:2px;border-radius:50%;background:#e0461f;display:inline-block}
h1{font-size:34px;line-height:1.1;letter-spacing:-.03em;margin:28px 0 10px}h2{font-size:18px;letter-spacing:-.01em;margin:40px 0 4px;display:flex;align-items:baseline;gap:10px}h2 small{font:500 12.5px/1 "IBM Plex Mono",ui-monospace,Menlo,monospace;color:#75736e}
.sm-lede{max-width:66ch;color:#4b4a47;margin:0 0 28px}
.sm-table{overflow-x:auto;border-top:1px solid #141414}table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font-weight:600;font-size:12px;color:#75736e;padding:10px 12px 10px 0;border-bottom:1px solid #e6e4df;white-space:nowrap}
td{padding:9px 12px 9px 0;border-bottom:1px solid #e6e4df;vertical-align:top}td.u{word-break:break-all}td.u a{text-decoration:none}td.u a:hover{text-decoration:underline}
td.d,td.n,th.n{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-size:12.5px;color:#4b4a47;white-space:nowrap}.n{text-align:right}
.sm-list{list-style:none;margin:10px 0 0;padding:0;border-top:1px solid #141414;columns:2 300px;column-gap:40px}.sm-list li{break-inside:avoid;padding:9px 0;border-bottom:1px solid #e6e4df}
.sm-list a{font-weight:550;text-decoration:none}.sm-list a:hover{text-decoration:underline}.sm-list small{display:block;color:#75736e;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sm-foot{margin-top:48px;color:#75736e;font-size:13px}
@media (max-width:640px){.hide{display:none}h1{font-size:28px}}
@media (prefers-color-scheme:dark){html{background:#121211;color:#f2f1ed}a,.sm-mark{color:#f2f1ed}.sm-table,.sm-list{border-top-color:#f2f1ed}th,td,.sm-list li{border-bottom-color:#2c2b29}.sm-lede,td.d,td.n{color:#c4c2bc}}`;
/** How sitemap.xml looks in a browser: a Jhino page with a table (browsers apply it; crawlers do not). */
const SITEMAP_XSL = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" exclude-result-prefixes="s image">
<xsl:output method="html" encoding="UTF-8" indent="yes" doctype-system="about:legacy-compat"/>
<xsl:template match="/">
<html lang="en">
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="robots" content="noindex"/>
<title>sitemap.xml | Jhino</title>
<style>${PAGE_STYLE}</style>
</head>
<body><main class="sm">
<a class="sm-mark" href="/">jhino<i></i></a>
<h1>sitemap.xml</h1>
<p class="sm-lede">The pages of Jhino that search engines read: the website, apps shown on Google and people's pages. It updates by itself. <b><xsl:value-of select="count(s:urlset/s:url)"/></b> pages. <a href="/sitemap">Browse them as a page</a></p>
<div class="sm-table"><table>
<thead><tr><th>Address</th><th class="n">Images</th><th>Updated</th><th class="hide">Changes</th><th class="n hide">Priority</th></tr></thead>
<tbody>
<xsl:for-each select="s:urlset/s:url">
<tr><td class="u"><a href="{s:loc}"><xsl:value-of select="s:loc"/></a></td><td class="n"><xsl:value-of select="count(image:image)"/></td><td class="d"><xsl:value-of select="s:lastmod"/></td><td class="hide"><xsl:value-of select="s:changefreq"/></td><td class="n hide"><xsl:value-of select="s:priority"/></td></tr>
</xsl:for-each>
</tbody></table></div>
</main></body></html>
</xsl:template>
</xsl:stylesheet>
`;
/** jhino.com/sitemap: the same pages for people, linked from every page's footer. */
function sitemapPage(b: string) {
  const e = entries(b);
  const list = (items: Entry[]) => `<ul class="sm-list">${items.map((x) => `<li><a href="${esc(x.path)}">${esc(x.title)}</a>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</li>`).join('')}</ul>`;
  const d: Doc = {
    status: 200, index: true, path: '/sitemap', title: 'Sitemap' + SUFFIX, card: 'summary_large_image',
    description: `Every public page on Jhino: the website, ${e.apps.length ? `${e.apps.length} page${e.apps.length === 1 ? '' : 's'} on Google, ` : ''}and ${e.people.length} people's pages with their links and work.`,
    jsonld: [website(b), org(b), crumbs(b, [['Jhino', '/'], ['Sitemap', '/sitemap']])],
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${head(d, b)}
<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/_jhino/logo-180-m.png">
<style>${PAGE_STYLE}</style></head>
<body><main class="sm">
<a class="sm-mark" href="/">jhino<i></i></a>
<h1>Sitemap</h1>
<p class="sm-lede">Every public page on Jhino. It updates by itself when someone adds a page or takes one off. For search engines: <a href="/sitemap.xml">sitemap.xml</a>.</p>
<h2>Jhino <small>${e.site.length - 1}</small></h2>${list(e.site.filter((x) => x.path !== '/sitemap'))}
${e.apps.length ? `<h2>Pages on Google <small>${e.apps.length}</small></h2>${list(e.apps)}` : ''}
${e.people.length ? `<h2>People <small>${e.people.length}</small></h2>${list(e.people)}` : ''}
<p class="sm-foot"><a href="/">Jhino</a> · <a href="/pricing">Pricing</a> · <a href="/signup">Start free</a> · <a href="/help">Help</a></p>
</main></body></html>`;
}
/** Paths of Jhino's own screens, blocked for crawlers. "$" and "/" forms, so usernames like "appsmith" stay open. */
const PRIVATE = ['apps', 'account', 'admin', 'build', 'shared', 'trash', 'links', 'people', 'verify', 'reset', 'forgot', 'invite', '_themes'];
function robots(b: string) {
  return ['User-agent: *', 'Allow: /',
    // Profile photos are listed in the sitemap: they must stay reachable under /api/.
    'Disallow: /api/', 'Allow: /api/profile/*/avatar', 'Disallow: /run/', 'Disallow: /go/', 'Disallow: /p/', 'Disallow: /s/', 'Disallow: /preview/',
    ...PRIVATE.flatMap((x) => [`Disallow: /${x}$`, `Disallow: /${x}/`]),
    'Disallow: /*/preview$', 'Disallow: /*?install=',
    'Disallow: /_jhino/', 'Allow: /_jhino/icon/', 'Allow: /_jhino/logo-', 'Allow: /_jhino/og.png',
    '', `Sitemap: ${b}/sitemap.xml`, ''].join('\n');
}
function llms(b: string) {
  const plans = publicPlans();
  return `# Jhino

> Jhino (${b}) gives video, photo and design studios and agencies one live page per client: video cuts for approval, photo proofing, design proofs, bookings, invoices and messages, seen by both sides at once. Studios can upload their own HTML apps or build one without code, share it by sign-in, public link or password link, and give it its own address. Every person gets a link-in-bio page at jhino.com/<username> and short links. Prices in Nepali rupees; dates in Bikram Sambat.

## Pages
- [Home](${b}/): what Jhino does, plans and questions.
- [Pricing](${b}/pricing): ${plans.map((p) => `${p.name} ${p.price ? `NPR ${p.price} a month` : 'free'} (${p.creations} app${p.creations === 1 ? '' : 's'})`).join('; ')}.
- [Help](${b}/help): guides and contact.
- [Create a free account](${b}/signup)
- [Sitemap](${b}/sitemap): every public page, including people's pages and apps on Google.
- [Terms](${b}/terms) and [Privacy](${b}/privacy)

## Facts
- Upload an HTML file or ZIP: it goes live at once; localStorage and IndexedDB data sync between everyone with access.
- Share an app with a client by sign-in, public link or password link; choose if visitors view, add or edit.
- Pro can publish up to 10 apps as public pages on Google search, each with its own title, description, address and keyword.
- People's pages (jhino.com/<username>) have 40 designs, socials, videos, apps and click analytics.
- Payment by QR code in NPR, monthly or yearly (a year costs ten months).
`;
}
function indexNowKey() {
  let k = setting('indexnow_key');
  if (!k) { k = crypto.randomBytes(16).toString('hex'); setSetting('indexnow_key', k); }
  return k;
}
/** Tell Bing, Yandex and others (IndexNow) that pages changed. Production only; never blocks the request. */
export function pingSearchEngines(paths: string[]) {
  const b = (config.publicUrl || '').replace(/\/$/, '');
  if (!b.startsWith('https://') || !paths.length) return;
  const host = new URL(b).host;
  const key = indexNowKey();
  fetch('https://api.indexnow.org/indexnow', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, keyLocation: `${b}/${key}.txt`, urlList: paths.map((p) => b + p) }),
  }).catch(() => { /* best effort */ });
}

/* ---------------- "Show on Google" for an app ---------------- */
function seoInfo(a: SeoApp, viewer: UserRow) {
  const owner = db.prepare('SELECT * FROM users WHERE id=?').get(a.owner_id) as UserRow;
  const f = featuresOf(owner);
  const used = (db.prepare('SELECT COUNT(*) n FROM apps WHERE owner_id=? AND seo_on=1 AND deleted_at IS NULL').get(owner.id) as { n: number }).n;
  const p = appPath(a);
  return {
    on: !!a.seo_on, live: seoLive(a), title: a.seo_title ?? '', description: a.seo_description ?? '', keyword: a.seo_keyword ?? '',
    slug: a.slug ?? null, rootSlug: a.root_slug ?? null, username: owner.username ?? null, path: p, url: p ? `${(config.publicUrl || '').replace(/\/$/, '')}${p}` : null,
    allowed: !!viewer.is_admin || !!owner.is_admin || f.seoPages > 0, limit: owner.is_admin ? null : f.seoPages, used,
    access: a.access ?? 'private', suffix: SUFFIX,
  };
}
function ownerOrAdmin(req: FastifyRequest, id: string) {
  const u = requireUser(req);
  if (req.pub || req.desk) throw new HttpError(403, 'FORBIDDEN', 'Not here.');
  const a = db.prepare('SELECT * FROM apps WHERE id=? AND deleted_at IS NULL').get(id) as SeoApp | undefined;
  if (!a || (roleOf(id, u.id) !== 'owner' && !u.is_admin)) throw new HttpError(404, 'NOT_FOUND', 'That app does not exist.');
  return { u, a };
}
const words = (v: unknown, what: string, min: number, max: number) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < min || s.length > max) throw new HttpError(400, 'VALIDATION_FAILED', `${what}: use ${min} to ${max} characters.`);
  return s;
};

export function registerSeo(app: FastifyInstance) {
  const key = indexNowKey();
  app.get(`/${key}.txt`, async (_req, reply) => reply.type('text/plain; charset=utf-8').send(key));

  app.get('/robots.txt', async (req, reply) => {
    reply.type('text/plain; charset=utf-8').header('Cache-Control', 'public, max-age=3600');
    return robots(base(req));
  });
  app.get('/sitemap.xml', async (req, reply) => {
    limit(req, 'sitemap', 60, 60_000);
    // Always fresh: it is made from the database on each request, so a new page shows at once.
    reply.type('application/xml; charset=utf-8').header('Cache-Control', 'no-cache');
    return sitemap(base(req));
  });
  app.get('/sitemap.xsl', async (_req, reply) => reply.type('text/xsl; charset=utf-8').header('Cache-Control', 'public, max-age=3600').send(SITEMAP_XSL));
  app.get('/sitemap', async (req, reply) => {
    limit(req, 'sitemap', 60, 60_000);
    reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache');
    return sitemapPage(base(req));
  });
  app.get('/llms.txt', async (req, reply) => {
    reply.type('text/plain; charset=utf-8').header('Cache-Control', 'public, max-age=3600');
    return llms(base(req));
  });
  // Jhino's marks: favicons Google can show in results, and the picture for shared links.
  const image = (buf: () => Buffer, type = 'image/png') => async (_req: FastifyRequest, reply: import('fastify').FastifyReply) =>
    reply.type(type).header('Cache-Control', 'public, max-age=604800').header('X-Content-Type-Options', 'nosniff').send(buf());
  app.get('/favicon.ico', image(faviconIco, 'image/x-icon'));
  app.get('/_jhino/og.png', image(ogPng));
  app.get('/_jhino/logo-:size.png', async (req, reply) => {
    const m = /^(48|96|180|192|512)(-m)?$/.exec((req.params as { size: string }).size);
    if (!m) return reply.code(404).type('text/plain').send('Not found');
    return reply.type('image/png').header('Cache-Control', 'public, max-age=604800').send(logoPng(Number(m[1]), !!m[2]));
  });

  app.get('/api/apps/:id/seo', async (req) => {
    const { u, a } = ownerOrAdmin(req, (req.params as { id: string }).id);
    return seoInfo(a, u);
  });

  /** Tick "Show on Google": a title, a description, an address and a keyword; the app becomes public to view. */
  app.put('/api/apps/:id/seo', async (req) => {
    const { id } = req.params as { id: string };
    const { u, a } = ownerOrAdmin(req, id);
    limit(req, 'seo-save', 60, 60_000, u.id);
    const b = (req.body ?? {}) as { on?: unknown; title?: unknown; description?: unknown; keyword?: unknown; slug?: unknown };
    const owner = db.prepare('SELECT * FROM users WHERE id=?').get(a.owner_id) as UserRow;
    const before = appPath(a);
    if (!b.on) {
      db.prepare('UPDATE apps SET seo_on=0, seo_updated_at=? WHERE id=?').run(now(), id);
      if (a.seo_on) { logActivity(id, u.id, 'took the app off Google'); if (before) pingSearchEngines([before]); }
      return seoInfo(db.prepare('SELECT * FROM apps WHERE id=?').get(id) as SeoApp, u);
    }
    const byAdmin = !!u.is_admin;
    if (!byAdmin && !owner.is_admin) {
      const f = featuresOf(owner);
      const used = (db.prepare('SELECT COUNT(*) n FROM apps WHERE owner_id=? AND seo_on=1 AND id<>? AND deleted_at IS NULL').get(owner.id, id) as { n: number }).n;
      if (f.seoPages <= 0) throw new HttpError(403, 'PLAN_FEATURE', 'Pages on Google are on Pro. Upgrade in Plan & usage.', { feature: 'seoPages' });
      if (used >= f.seoPages) throw new HttpError(403, 'LIMIT_REACHED', `Your plan includes ${f.seoPages} page${f.seoPages === 1 ? '' : 's'} on Google, all in use. Take one off Google first.`, { feature: 'seoPages' });
    }
    const title = words(String(b.title ?? '').replace(/\s*\|\s*jhino\s*$/i, ''), 'Page title', 3, 70);
    const description = words(b.description, 'Meta description', 50, 200);
    const keyword = words(b.keyword, 'Primary keyword', 2, 60);
    // Its address: a top-level one (set by a super admin) stays; otherwise jhino.com/<owner>/<slug>.
    if (!a.root_slug) {
      const r = readAddressRequest(owner, { slug: b.slug ?? a.slug }, id, a.access ?? 'private', byAdmin && u.id !== owner.id);
      if (!r.slug) throw new HttpError(400, 'VALIDATION_FAILED', 'Give the page an address.');
      if (r.slug !== a.slug) await applyAddress(id, { slug: r.slug });
    }
    // Public to view: anyone opens it without signing in (and crawlers can read it).
    await setSharing(id, { access: 'public', publicRole: 'viewer' });
    db.prepare('UPDATE apps SET seo_on=1, seo_title=?, seo_description=?, seo_keyword=?, seo_updated_at=?, updated_at=? WHERE id=?').run(title, description, keyword, now(), now(), id);
    if (!a.seo_on) logActivity(id, u.id, 'put the app on Google', title);
    const next = db.prepare('SELECT * FROM apps WHERE id=?').get(id) as SeoApp;
    const p = appPath(next);
    pingSearchEngines([...new Set([p, before].filter((x): x is string => !!x))]);
    return seoInfo(next, u);
  });
}
