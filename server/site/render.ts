import {
  FONTS, LIBRARY, blockDef, esc, fontById, safeHref, textOf,
  type Block, type ImageRef, type LinkRef, type Page, type Site, type Theme,
} from './schema.js';
import { BS_MONTHS, adToBs } from './bs.js';

/*
 * Site JSON → HTML. One renderer for three places:
 * - publish: static files in a version folder (index.html, <slug>/index.html), links relative to the page;
 * - preview: the draft in a tab of its own (and the editor's Preview mode);
 * - edit: the editor's canvas, with data-* hooks on every editable text, image and link.
 * Everything visitors typed is escaped here; inline HTML props were sanitised by schema.ts before they
 * got this far (cleanSite runs on every save and publish).
 * Only the CSS of the blocks a page uses is inlined; the one script (/_jhino/site.js) is deferred.
 *
 * Design system: a 12-column grid inside .wrap, a fluid type scale set by the theme (--ts), section rhythm
 * set by the theme (--pad0/--pad1), and one signature motion: photos are unveiled as they scroll into view
 * (a panel in the section colour slides away while the photo settles from 1.08 to 1). Transform only; off
 * for reduced motion, in the editor, in print and without scripting.
 */

export type Mode = 'edit' | 'preview' | 'publish';
export interface RenderCtx {
  mode: Mode;
  appId: string;
  site: Site;
  page: Page;
  /** A stored image (file:, lib: or https:) as a URL, with a srcset when there are sizes. */
  asset: (src: string) => { url: string; srcset?: string } | null;
  /** Where a page of the site is, from the page being rendered. */
  pageHref: (p: Page) => string;
  /** Where the form posts go. */
  formAction: string;
}

/* ---------------- small helpers ---------------- */
const edit = (c: RenderCtx) => c.mode === 'edit';
const attrs = (o: Record<string, string | number | boolean | undefined | null>) =>
  Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== false).map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');
const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

/** Editable text: a value that already is sanitised inline HTML. Empty values are left out of the published page. */
function T(c: RenderCtx, path: string, val: string, tag = 'p', className = '', ph = '', kind: 'text' | 'para' | 'rich' = 'text') {
  const v = String(val ?? '');
  if (!v && !edit(c)) return '';
  const a = edit(c) ? attrs({ 'data-f': path, 'data-kind': kind, 'data-ph': ph || 'Write here' }) : '';
  return `<${tag}${className ? ` class="${className}"` : ''}${a}>${v}</${tag}>`;
}
/** Plain text from a plain field (escaped). */
const P = (v: unknown) => esc(String(v ?? ''));

/** Drawn icons (one stroke weight), never glyphs. */
const ICON: Record<string, string> = {
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  out: '<path d="M7 17L17 7M9 7h8v8"/>',
  down: '<path d="M12 4v15M6 13l6 6 6-6"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  cross: '<path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3"/>',
  chat: '<path d="M4.5 19.5l1.3-4A7.5 7.5 0 1 1 9 18.6z"/>',
};
const icon = (n: string, className = 'ic') => `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON[n]}</svg>`;

export function resolveHref(c: RenderCtx, href: string): string {
  const h = safeHref(href);
  if (!h) return '';
  if (h.startsWith('page:')) {
    const p = c.site.pages.find((x) => x.id === h.slice(5));
    return p ? c.pageHref(p) : '';
  }
  return h;
}
function button(c: RenderCtx, path: string, l: LinkRef | undefined, kind: 'p' | 's', extra = '') {
  if (!l || !l.label) return '';
  const href = resolveHref(c, l.href);
  if (!href && !edit(c)) return '';
  const ext = /^https?:/.test(href) && l.newTab;
  return `<a${attrs({ class: cls('btn', kind === 'p' ? 'btn-p' : 'btn-s', extra), href: href || '#', target: ext ? '_blank' : undefined, rel: ext ? 'noopener' : undefined, 'data-link': edit(c) ? path : undefined })}>${P(l.label)}</a>`;
}
const buttons = (c: RenderCtx, a: [string, LinkRef | undefined], b?: [string, LinkRef | undefined]) => {
  const x = button(c, a[0], a[1], 'p') + (b ? button(c, b[0], b[1], 's') : '');
  return x ? `<div class="acts">${x}</div>` : '';
};
/** A quiet text link with a drawn arrow (lists of work, press, "see all"). */
function textLink(c: RenderCtx, path: string, l: LinkRef | undefined, extra = '') {
  if (!l || !l.label) return '';
  const href = resolveHref(c, l.href);
  if (!href && !edit(c)) return '';
  const ext = /^https?:/.test(href) && l.newTab;
  return `<a${attrs({ class: cls('tlink', extra), href: href || '#', target: ext ? '_blank' : undefined, rel: ext ? 'noopener' : undefined, 'data-link': edit(c) ? path : undefined })}><span>${P(l.label)}</span>${icon('right')}</a>`;
}

/** An image. Without one: nothing on the site, a quiet "Add a photo" frame in the editor. */
function img(c: RenderCtx, path: string, ref: ImageRef | undefined, o: { sizes?: string; className?: string; eager?: boolean; ratio?: string } = {}) {
  const a = ref?.src ? c.asset(ref.src) : null;
  if (!a) {
    if (!edit(c)) return '';
    return `<div${attrs({ class: cls('ph-img', o.className), 'data-img': path, style: o.ratio ? `aspect-ratio:${o.ratio}` : undefined })}><span>Add a photo</span></div>`;
  }
  const pos = ref!.focal ? `object-position:${ref!.focal[0]}% ${ref!.focal[1]}%` : undefined;
  // Lazy only on the published site. No decoding="async": off-screen async decodes are skipped by page
  // captures and by the editor's scaled canvas, which showed empty frames.
  const lazy = c.mode === 'publish' && !o.eager;
  return `<img${attrs({
    class: o.className, src: a.url, srcset: a.srcset, sizes: a.srcset ? o.sizes ?? '100vw' : undefined, alt: ref!.alt || '',
    loading: lazy ? 'lazy' : undefined, fetchpriority: o.eager ? 'high' : undefined, style: pos,
    'data-img': edit(c) ? path : undefined,
  })}>`;
}
const hasImg = (c: RenderCtx, ref: ImageRef | undefined) => !!(ref?.src && c.asset(ref.src));

const money = (price: string, currency: string, lang: string) => {
  const p = String(price ?? '').trim();
  if (!p) return '';
  const num = /^\d[\d,]*(\.\d+)?$/.test(p) ? Number(p.replace(/,/g, '')) : NaN;
  const shown = isFinite(num) ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(num) : p;
  if (!isFinite(num) || !currency) return esc(shown);
  const sym: Record<string, string> = { NPR: lang === 'ne' ? 'रू ' : 'Rs ', INR: '₹', USD: '$', EUR: '€', GBP: '£', AUD: 'A$' };
  return `${esc(sym[currency] ?? currency + ' ')}${esc(shown)}`;
};
const initials = (name: string) => textOf(name).split(/\s+/).filter((w) => /^[\p{L}]/u.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·';

/** YouTube / Vimeo link → what the facade needs. */
export function videoOf(u: string): { kind: 'youtube' | 'vimeo'; id: string; embed: string; thumb?: string; watch: string } | null {
  const s = String(u ?? '').trim();
  let m = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i.exec(s);
  if (m) return { kind: 'youtube', id: m[1], embed: `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&rel=0`, thumb: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`, watch: `https://www.youtube.com/watch?v=${m[1]}` };
  m = /^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{5,12})/i.exec(s);
  if (m) return { kind: 'vimeo', id: m[1], embed: `https://player.vimeo.com/video/${m[1]}?autoplay=1&dnt=1`, watch: `https://vimeo.com/${m[1]}` };
  return null;
}
/** A Google Maps embed URL, no API key: from a pasted embed link, or a search for the place. */
export function mapEmbed(query: string, link: string): string {
  const l = String(link ?? '').trim();
  if (/^https:\/\/www\.google\.com\/maps\/embed\?pb=[\w!.%-]{10,2000}$/.test(l)) return l;
  const q = textOf(query).trim();
  return q ? `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed` : '';
}
const mapsLink = (query: string, link: string) => {
  const l = safeHref(link);
  if (/^https:\/\//.test(l) && !/\/maps\/embed\?/.test(l)) return l;
  const q = textOf(query).trim();
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : '';
};
const lines = (s: string) => textOf(String(s ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/\n/g, '\u0001')).split('\u0001').map((x) => x.trim()).filter(Boolean);
const telOf = (s: string) => String(s ?? '').replace(/[^\d+]/g, '');

/* ---------------- blocks ---------------- */
type R = (c: RenderCtx, b: Block, p: any) => string;

const has = (x: string) => !!textOf(x);
/** A section's heading and intro: side by side on wide screens when both are there. */
function secHead(c: RenderCtx, p: any, o: { intro?: string; h?: string; extra?: string; cls?: string } = {}) {
  const hk = o.h ?? 'heading', ik = o.intro ?? 'intro';
  const hasIntro = ik in p && (has(p[ik]) || edit(c));
  if (!has(p[hk]) && !hasIntro && !edit(c) && !o.extra) return '';
  const h = T(c, hk, p[hk], 'h2', 'h2', 'Heading');
  const intro = ik in p ? T(c, ik, p[ik], 'p', 'lede', 'A short intro', 'para') : '';
  return `<div class="${cls('sec-head', hasIntro && 'two', o.cls)}">${h}${intro || o.extra ? `<div class="sec-aside">${intro}${o.extra ?? ''}</div>` : ''}</div>`;
}

const header: R = (c, b, p) => {
  const s = c.site;
  const home = c.site.pages[0];
  const logo = s.settings.logo?.src ? c.asset(s.settings.logo.src) : null;
  const brand = logo
    ? `<img class="logo" src="${esc(logo.url)}" alt="${esc(s.name)}" height="40">`
    : `<span class="brand-name">${esc(s.name)}</span>`;
  const links = s.pages.filter((x) => x.nav).map((x) => `<li><a href="${esc(c.pageHref(x))}"${x.id === c.page.id ? ' aria-current="page"' : ''}>${esc(x.title)}</a></li>`).join('');
  const cta = button(c, 'cta', p.cta, 'p', 'h-cta');
  // On phones the button moves into the menu, so the bar stays one line.
  const navCta = cta && !edit(c) ? `<li class="nav-cta">${button(c, 'cta', p.cta, 'p')}</li>` : '';
  return `<div class="wrap h-in">
<a class="brand" href="${esc(c.pageHref(home))}">${brand}</a>
<nav class="h-nav" aria-label="Main"><button class="nav-t" type="button" aria-expanded="false" aria-controls="nav-${b.id}"><span class="nav-i" aria-hidden="true"></span>Menu</button><ul id="nav-${b.id}">${links}${navCta}</ul></nav>
${cta}</div>`;
};
/** A header laid over a full-photo hero (white text until the page scrolls). */
const headerOver = (c: RenderCtx) => { const f = c.page.blocks[0]; return !!f && f.type === 'hero' && (f.variant === 'image' || f.variant === 'video'); };

const hero: R = (c, b, p) => {
  const first = c.page.blocks[0]?.id === b.id;
  const meta = T(c, 'eyebrow', p.eyebrow, 'p', 'h-meta', 'A detail: hours, place, since when');
  const acts = buttons(c, ['primary', p.primary], ['secondary', p.secondary]);
  const title = T(c, 'title', p.title, 'h1', 'h1', 'Headline');
  const lede = T(c, 'text', p.text, 'p', 'lede', 'A sentence or two', 'para');
  if (b.variant === 'text') return `<div class="wrap hero-t">${title}<div class="hero-t-side">${lede}${acts}${meta}</div></div>`;
  if (b.variant === 'split') {
    return `<div class="hero-s"><div class="hero-copy">${title}${lede}${acts}${meta}</div><div class="hero-media rv">${img(c, 'image', p.image, { eager: first, sizes: '(min-width: 900px) 50vw, 100vw', ratio: '4/5' })}</div></div>`;
  }
  if (b.variant === 'stacked') {
    return `<div class="wrap hero-k">${title}<div class="hero-k-row">${lede}<div>${acts}${meta}</div></div></div><div class="hero-k-media rv">${img(c, 'image', p.image, { eager: first, sizes: '100vw', ratio: '21/9' })}</div>`;
  }
  const media = b.variant === 'video' && /^https:\/\/[^\s]+\.(mp4|webm)(\?[^\s]*)?$/i.test(p.video) && !edit(c)
    ? `<video class="hero-bg" autoplay muted loop playsinline preload="metadata"${p.image?.src && c.asset(p.image.src) ? ` poster="${esc(c.asset(p.image.src)!.url)}"` : ''}><source src="${esc(p.video)}"></video>`
    : img(c, 'image', p.image, { eager: first, className: 'hero-bg', sizes: '100vw' });
  return `${media}<div class="hero-scrim" aria-hidden="true"></div><div class="wrap hero-over">${title}<div class="hero-over-row">${lede}<div>${acts}${meta}</div></div></div>`;
};

const NET: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', x: 'X', linkedin: 'LinkedIn', whatsapp: 'WhatsApp', viber: 'Viber', pinterest: 'Pinterest', behance: 'Behance', website: 'Website' };
const netName = (n: string) => NET[n] ?? 'Link';

const footer: R = (c, b, p) => {
  const s = c.site;
  const year = new Date().getFullYear();
  const note = p.note ? `<p class="f-note"${edit(c) ? attrs({ 'data-f': 'note', 'data-kind': 'text', 'data-ph': 'Small print' }) : ''}>${p.note}</p>`
    : `<p class="f-note"${edit(c) ? attrs({ 'data-f': 'note', 'data-kind': 'text', 'data-ph': `© ${year} ${s.name}` }) : ''}>${edit(c) ? '' : `© ${year} ${esc(s.name)}`}</p>`;
  const pages = p.showPages ? `<ul class="f-pages">${s.pages.filter((x) => x.nav).map((x) => `<li><a href="${esc(c.pageHref(x))}">${esc(x.title)}</a></li>`).join('')}</ul>` : '';
  const st = s.settings;
  const contact = p.showContact && (st.phone || st.email || st.address) ? `<ul class="f-contact">${st.address ? `<li>${esc(st.address)}</li>` : ''}${st.phone ? `<li><a href="tel:${esc(telOf(st.phone))}">${esc(st.phone)}</a></li>` : ''}${st.email ? `<li><a href="mailto:${esc(st.email)}">${esc(st.email)}</a></li>` : ''}</ul>` : '';
  const social = p.showSocial && st.social.length ? `<ul class="f-social">${st.social.map((x) => `<li><a href="${esc(x.url)}" rel="noopener me" target="_blank">${esc(netName(x.network))}</a></li>`).join('')}</ul>` : '';
  const about = T(c, 'about', p.about, 'p', 'f-about', 'One line about you', 'para');
  if (b.variant === 'simple') return `<div class="wrap f-simple"><span class="f-name">${esc(s.name)}</span>${pages}${social}${note}</div>`;
  if (b.variant === 'big') return `<div class="wrap"><p class="f-big" aria-hidden="true">${esc(s.name)}</p><div class="f-row">${about}${contact}${pages}${social}</div>${note}</div>`;
  if (b.variant === 'rich') {
    const hrs = lines(p.hours);
    const hoursHtml = edit(c) ? T(c, 'hours', p.hours, 'p', 'f-hours', 'Hours, one line per row', 'para') : hrs.length ? `<ul class="f-hours">${hrs.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : '';
    const top = has(p.headline) || edit(c) || (p.cta && p.cta.label) ? `<div class="f-top">${T(c, 'headline', p.headline, 'p', 'f-headline', 'A closing line')}${buttons(c, ['cta', p.cta])}</div>` : '';
    const col = (h: string, inner: string) => (inner ? `<div class="f-col"><p class="f-h">${h}</p>${inner}</div>` : '');
    return `<div class="wrap">${top}<div class="f-grid"><div class="f-col f-brand"><p class="f-name">${esc(s.name)}</p>${about}</div>${col('Pages', pages)}${col('Visit', contact)}${col('Hours', hoursHtml)}${col('Follow', social)}</div>${note}</div>`;
  }
  return `<div class="wrap"><div class="f-cols"><div><p class="f-name">${esc(s.name)}</p>${about}</div>${pages ? `<div><p class="f-h">Pages</p>${pages}</div>` : ''}${contact || social ? `<div><p class="f-h">Contact</p>${contact}${social}</div>` : ''}</div>${note}</div>`;
};

const richtext: R = (c, b, p) => {
  const body = T(c, 'body', p.body, 'div', 'prose', 'Write here', 'rich');
  if (b.variant === 'split') return `<div class="wrap rt-split">${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}${body}</div>`;
  return `<div class="wrap ${b.variant === 'wide' ? 'rt-wide' : 'rt-narrow'}">${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}${body}</div>`;
};

const image: R = (c, b, p) => {
  const cap = T(c, 'caption', p.caption, 'figcaption', 'cap', 'Caption');
  const im = img(c, 'image', p.image, { sizes: b.variant === 'full' ? '100vw' : '(min-width: 1400px) 1320px, 100vw' });
  if (!im && !cap) return '';
  if (b.variant === 'full') return `<figure class="img-full"><div class="rv">${im}</div><div class="wrap">${cap}</div></figure>`;
  if (b.variant === 'framed') return `<figure class="wrap img-framed"><div class="rv">${im}</div>${cap}</figure>`;
  return `<figure class="wrap img-c"><div class="rv">${im}</div>${cap}</figure>`;
};

const imagetext: R = (c, b, p) => {
  const text = `<div class="it-copy">${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}${T(c, 'body', p.body, 'div', 'prose', 'Write here', 'rich')}${T(c, 'eyebrow', p.eyebrow, 'p', 'it-meta', 'A detail line')}${buttons(c, ['link', p.link])}</div>`;
  const media = `<div class="it-media rv">${img(c, 'image', p.image, { sizes: '(min-width: 900px) 55vw, 100vw', ratio: '4/5' })}</div>`;
  return `<div class="wrap it it-${b.variant}">${b.variant === 'right' ? text + media : media + text}</div>`;
};

const rows: R = (c, b, p) => {
  const items = (p.items ?? []).map((it: any, i: number) => {
    const media = `<div class="rw-media rv">${img(c, `items.${i}.image`, it.image, { sizes: b.variant === 'large' ? '100vw' : '(min-width: 900px) 58vw, 100vw', ratio: b.variant === 'large' ? '16/9' : '5/4' })}</div>`;
    const copy = `<div class="rw-copy">${T(c, `items.${i}.title`, it.title, 'h3', 'h3 rw-t', 'Title')}${T(c, `items.${i}.text`, it.text, 'p', 'rw-x', 'A few sentences', 'para')}${textLink(c, `items.${i}.link`, it.link)}</div>`;
    return `<li class="rw-it">${media}${copy}</li>`;
  }).join('');
  return `<div class="wrap">${secHead(c, p)}<ul class="rw rw-${b.variant}" role="list">${items}</ul></div>`;
};

const sticky: R = (c, b, p) => {
  const media = `<div class="sk-media"><div class="sk-pin rv">${img(c, 'image', p.image, { sizes: '(min-width: 900px) 50vw, 100vw', ratio: '4/5' })}</div></div>`;
  const items = (p.items ?? []).map((it: any, i: number) => `<li class="sk-it">${it.label ? `<p class="sk-l">${P(it.label)}</p>` : ''}${T(c, `items.${i}.title`, it.title, 'h3', 'h3 sk-t', 'Title')}${T(c, `items.${i}.text`, it.text, 'p', 'sk-x', 'A few sentences', 'para')}</li>`).join('');
  const copy = `<div class="sk-copy">${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}${T(c, 'intro', p.intro, 'p', 'lede', 'A short intro', 'para')}<ol class="sk-list" role="list">${items}</ol></div>`;
  return `<div class="wrap sk sk-${b.variant}">${b.variant === 'right' ? copy + media : media + copy}</div>`;
};

const quote: R = (c, b, p) => {
  const who = has(p.name) || has(p.detail) || edit(c) ? `<figcaption class="qt-who">${T(c, 'name', p.name, 'span', 'qt-name', 'Name')}${T(c, 'detail', p.detail, 'span', 'qt-detail', 'Who they are')}</figcaption>` : '';
  const q = `<figure class="qt-fig"><blockquote>${T(c, 'quote', p.quote, 'p', 'qt-text', 'The words', 'para')}</blockquote>${who}</figure>`;
  if (b.variant === 'image' && (hasImg(c, p.image) || edit(c))) return `<div class="wrap qt-img"><div class="qt-media rv">${img(c, 'image', p.image, { sizes: '(min-width: 900px) 40vw, 100vw', ratio: '4/5' })}</div>${q}</div>`;
  return `<div class="wrap qt-large">${q}</div>`;
};

const marquee: R = (c, b, p) => {
  const words = (p.items ?? []).map((x: any) => cleanWord(x.text)).filter(Boolean);
  if (!words.length) return edit(c) ? '<div class="wrap empty-blk">Add words in the block settings.</div>' : '';
  const run = (hidden: boolean) => `<ul class="mq-run" role="list"${hidden ? ' aria-hidden="true"' : ''}>${words.map((w: string) => `<li>${esc(w)}<span class="mq-sep" aria-hidden="true"></span></li>`).join('')}</ul>`;
  // Enough copies to fill a wide screen; the track moves by exactly half its width, so the loop is seamless.
  const reps = Math.max(2, Math.ceil(8 / words.length));
  const half = Array.from({ length: reps }, (_, i) => run(i > 0)).join('');
  return `<div class="mq" role="marquee" aria-label="${esc(words.join(', '))}"><div class="mq-track">${half}${half.replace(/<ul class="mq-run" role="list">/, '<ul class="mq-run" role="list" aria-hidden="true">')}</div></div>`;
};
const cleanWord = (s: unknown) => String(s ?? '').replace(/<[^>]*>/g, '').trim();

const gallery: R = (c, b, p) => {
  const sizes: Record<string, string> = { carousel: '(min-width: 900px) 45vw, 85vw', bento: '(min-width: 900px) 60vw, 100vw', feed: '(min-width: 900px) 25vw, 33vw', grid: '(min-width: 900px) 33vw, 50vw', masonry: '(min-width: 900px) 33vw, 50vw' };
  const ratio: Record<string, string | undefined> = { carousel: '4/3', grid: '4/5', feed: '1', bento: undefined, masonry: undefined };
  const items = (p.images ?? []).map((it: any, i: number) => {
    const im = img(c, `images.${i}.image`, it.image, { sizes: sizes[b.variant], ratio: ratio[b.variant] });
    if (!im) return '';
    const cap = b.variant === 'feed' ? '' : T(c, `images.${i}.caption`, it.caption, 'figcaption', 'cap', 'Caption');
    return `<figure class="g-it"><div class="g-m rv">${im}</div>${cap}</figure>`;
  }).join('');
  const more = textLink(c, 'link', p.link);
  const top = secHead(c, p, { extra: b.variant === 'feed' ? more : '' });
  if (b.variant === 'carousel') {
    return `<div class="wrap">${top}</div><div class="car" data-car><div class="car-track" tabindex="0" aria-label="${esc(textOf(p.heading) || 'Photos')}">${items}</div><div class="wrap car-nav"><button type="button" data-dir="-1" aria-label="Previous photos">${icon('left')}</button><button type="button" data-dir="1" aria-label="Next photos">${icon('right')}</button></div></div>`;
  }
  return `<div class="wrap">${top}<div class="g-${b.variant}">${items}</div>${b.variant !== 'feed' && more ? `<div class="g-more">${more}</div>` : ''}</div>`;
};

const video: R = (c, b, p) => {
  const vid = videoOf(p.url);
  let player: string;
  if (vid) {
    const thumb = vid.thumb ? `<img src="${esc(vid.thumb)}" alt="" loading="lazy">` : '';
    player = `<a class="vid" href="${esc(vid.watch)}"${edit(c) ? '' : attrs({ 'data-embed': vid.embed, 'data-title': textOf(p.heading) || 'Video' })}>${thumb}<span class="vid-play"><span aria-hidden="true"></span>Play video</span></a>`;
  } else player = edit(c) ? '<div class="vid vid-empty"><span>Paste a YouTube or Vimeo link in the block settings</span></div>' : '';
  if (!player) return '';
  const copy = T(c, 'heading', p.heading, 'h2', 'h2', 'Heading') + T(c, 'text', p.text, 'p', 'lede', 'A short text', 'para');
  const cap = T(c, 'caption', p.caption, 'p', 'cap', 'Caption');
  if (b.variant === 'split') return `<div class="wrap vid-split"><div>${copy}</div><div>${player}${cap}</div></div>`;
  return `<div class="wrap ${b.variant === 'contained' ? 'vid-narrow' : ''}">${copy ? `<div class="sec-head">${copy}</div>` : ''}${player}${cap}</div>`;
};

const features: R = (c, b, p) => {
  const items = (p.items ?? []).map((it: any, i: number) =>
    `<li class="ft-it"><div class="ft-main">${T(c, `items.${i}.title`, it.title, 'h3', 'h3', 'Name')}${T(c, `items.${i}.text`, it.text, 'p', 'ft-t', 'Description', 'para')}</div>${it.detail ? `<p class="ft-d">${P(it.detail)}</p>` : ''}</li>`).join('');
  return `<div class="wrap">${secHead(c, p)}<ul class="ft ft-${b.variant}" role="list">${items}</ul></div>`;
};

const steps: R = (c, b, p) => {
  const items = (p.items ?? []).map((it: any, i: number) =>
    `<li class="sp-it"><span class="sp-n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><div class="sp-b">${T(c, `items.${i}.title`, it.title, 'h3', 'h3', 'Title')}${T(c, `items.${i}.text`, it.text, 'p', 'sp-x', 'What happens', 'para')}${it.detail ? `<p class="sp-d">${P(it.detail)}</p>` : ''}</div></li>`).join('');
  return `<div class="wrap">${secHead(c, p)}<ol class="sp sp-${b.variant}" role="list">${items}</ol></div>`;
};

const work: R = (c, b, p) => {
  const items = (p.items ?? []).map((it: any, i: number) => {
    const href = resolveHref(c, it.link?.href ?? '');
    const media = `<div class="wk-m rv">${img(c, `items.${i}.image`, it.image, { sizes: b.variant === 'list' ? '240px' : b.variant === 'feature' && i === 0 ? '100vw' : '(min-width: 900px) 50vw, 100vw', ratio: b.variant === 'list' ? '4/3' : b.variant === 'feature' && i === 0 ? '16/9' : '4/3' })}</div>`;
    const title = T(c, `items.${i}.title`, it.title, 'h3', 'h3 wk-t', 'Project');
    const meta = `<p class="wk-tag">${P(it.tag)}</p>`;
    const text = T(c, `items.${i}.text`, it.text, 'p', 'wk-x', 'One line', 'para');
    const body = `${media}<div class="wk-b"><div class="wk-h">${title}${it.tag ? meta : ''}</div>${text}${edit(c) ? textLink(c, `items.${i}.link`, it.link) : ''}</div>`;
    const inner = href && !edit(c) ? `<a class="wk-a" href="${esc(href)}"${/^https?:/.test(href) && it.link?.newTab ? ' target="_blank" rel="noopener"' : ''}>${body}</a>` : body;
    return `<li class="wk-it">${inner}</li>`;
  }).join('');
  const more = textLink(c, 'link', p.link);
  return `<div class="wrap">${secHead(c, p)}<ul class="wk wk-${b.variant}" role="list">${items}</ul>${more ? `<div class="g-more">${more}</div>` : ''}</div>`;
};

const press: R = (c, b, p) => {
  const items = (p.items ?? []).map((it: any, i: number) => {
    const href = safeHref(it.url);
    const name = `<p class="pr-name">${P(it.name)}</p>`;
    const go = href && !edit(c) ? `<a class="pr-go" href="${esc(href)}" target="_blank" rel="noopener" aria-label="Read it on ${esc(it.name)}">${icon('out')}</a>` : '';
    if (b.variant === 'quotes') return `<li class="pq-it">${T(c, `items.${i}.quote`, it.quote, 'p', 'pq-q', 'What they wrote', 'para')}<div class="pq-by">${name}${T(c, `items.${i}.detail`, it.detail, 'p', 'pq-d', 'Title or year')}${go}</div></li>`;
    return `<li class="pl-it">${name}${T(c, `items.${i}.detail`, it.detail, 'p', 'pl-d', 'Title or year')}${go}</li>`;
  }).join('');
  return `<div class="wrap">${secHead(c, p, { intro: '_none' })}<ul class="${b.variant === 'quotes' ? 'pq' : 'pl'}" role="list">${items}</ul></div>`;
};

const pricing: R = (c, b, p) => {
  const lang = c.site.settings.lang;
  const plans = (p.plans ?? []).map((pl: any, i: number) => {
    const price = money(pl.price, p.currency, lang);
    const feats = lines(pl.features);
    const list = feats.length ? `<ul class="pr-f">${feats.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '';
    return `<li class="${cls('pr-it', pl.featured && 'pr-on')}"><div class="pr-top">${T(c, `plans.${i}.name`, pl.name, 'h3', 'h3', 'Package')}${price ? `<p class="pr-price"><b>${price}</b>${pl.period ? `<span> / ${P(pl.period)}</span>` : ''}</p>` : ''}${T(c, `plans.${i}.note`, pl.note, 'p', 'pr-note', 'Short note', 'para')}</div>${list}${button(c, `plans.${i}.cta`, pl.cta, pl.featured ? 'p' : 's')}</li>`;
  }).join('');
  return `<div class="wrap">${secHead(c, p)}<ul class="pr pr-${b.variant}" role="list">${plans}</ul></div>`;
};

const menu: R = (c, b, p) => {
  const lang = c.site.settings.lang;
  const photo = b.variant === 'photo';
  const secs = (p.sections ?? []).map((s: any, i: number) => {
    const items = (s.items ?? []).map((it: any, j: number) => {
      const base = `sections.${i}.items.${j}`;
      const price = money(it.price, p.currency, lang);
      const pic = photo && (hasImg(c, it.image) || edit(c)) ? `<div class="mi-pic">${img(c, `${base}.image`, it.image, { sizes: '120px', ratio: '1' })}</div>` : '';
      return `<li class="${cls('mi', pic && 'mi-has')}">${pic}<div class="mi-body"><div class="mi-row">${T(c, `${base}.name`, it.name, 'h4', 'mi-name', 'Name')}${it.tag ? `<span class="mi-tag">${P(it.tag)}</span>` : ''}<span class="mi-dots" aria-hidden="true"></span>${price ? `<span class="mi-price">${price}</span>` : ''}</div>${T(c, `${base}.desc`, it.desc, 'p', 'mi-desc', 'What is in it', 'para')}</div></li>`;
    }).join('');
    return `<section class="mn-sec">${T(c, `sections.${i}.title`, s.title, 'h3', 'h3 mn-h', 'Section')}${T(c, `sections.${i}.note`, s.note, 'p', 'mn-note', 'Section note', 'para')}<ul role="list">${items}</ul></section>`;
  }).join('');
  return `<div class="wrap">${secHead(c, p)}<div class="mn mn-${b.variant}">${secs}</div></div>`;
};

const team: R = (c, b, p) => {
  const people = (p.people ?? []).map((m: any, i: number) => {
    const face = b.variant === 'grid' ? `<div class="tm-m rv">${img(c, `people.${i}.image`, m.image, { sizes: '(min-width: 900px) 30vw, 50vw', ratio: '4/5', className: 'tm-img' })}</div>`
      : b.variant === 'monogram' ? `<span class="tm-mono" aria-hidden="true">${esc(initials(m.name))}</span>` : '';
    return `<li class="tm-it">${face}<div class="tm-b">${T(c, `people.${i}.name`, m.name, 'h3', 'h3', 'Name')}${T(c, `people.${i}.role`, m.role, 'p', 'tm-role', 'Role')}${T(c, `people.${i}.bio`, m.bio, 'p', 'tm-bio', 'Short bio', 'para')}</div></li>`;
  }).join('');
  return `<div class="wrap">${secHead(c, p)}<ul class="tm tm-${b.variant}" role="list">${people}</ul></div>`;
};

const testimonials: R = (c, b, p) => {
  const items = (p.items ?? []).map((q: any, i: number) =>
    `<figure class="q-it"><blockquote>${T(c, `items.${i}.quote`, q.quote, 'p', 'q-text', 'Their words', 'para')}</blockquote><figcaption>${T(c, `items.${i}.name`, q.name, 'span', 'q-name', 'Name')}${T(c, `items.${i}.detail`, q.detail, 'span', 'q-detail', 'Who they are')}</figcaption></figure>`).join('');
  const top = has(p.heading) || edit(c) ? `<div class="sec-head">${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}</div>` : '';
  if (b.variant === 'carousel') return `<div class="wrap">${top}</div><div class="car" data-car><div class="car-track q-car" tabindex="0" aria-label="Testimonials">${items}</div><div class="wrap car-nav"><button type="button" data-dir="-1" aria-label="Previous">${icon('left')}</button><button type="button" data-dir="1" aria-label="Next">${icon('right')}</button></div></div>`;
  return `<div class="wrap">${top}<div class="q q-${b.variant}">${items}</div></div>`;
};

const logos: R = (c, b, p) => {
  const items = (p.items ?? []).map((l: any, i: number) => {
    const a = l.image?.src ? c.asset(l.image.src) : null;
    const inner = a ? `<img src="${esc(a.url)}" alt="${esc(l.name || l.image.alt)}" loading="lazy"${edit(c) ? attrs({ 'data-img': `items.${i}.image` }) : ''}>` : `<span class="lg-name">${P(l.name)}</span>`;
    const href = safeHref(l.url);
    return `<li>${href && !edit(c) ? `<a href="${esc(href)}" rel="noopener" target="_blank">${inner}</a>` : inner}</li>`;
  }).join('');
  return `<div class="wrap lg lg-${b.variant}">${T(c, 'heading', p.heading, 'h2', 'lg-h', 'Heading')}<ul role="list">${items}</ul></div>`;
};

const stats: R = (c, b, p) => {
  const items = (p.items ?? []).map((s: any, i: number) => (s.value || edit(c) ? `<li><span class="st-v"${edit(c) ? ' data-empty-hint="Add a real number in settings"' : ''}>${P(s.value) || (edit(c) ? '—' : '')}</span>${T(c, `items.${i}.label`, s.label, 'span', 'st-l', 'What it counts')}</li>` : '')).join('');
  if (!items) return '';
  const copy = T(c, 'heading', p.heading, 'h2', 'h2', 'Heading') + T(c, 'text', p.text, 'p', 'lede', 'A short text', 'para');
  if (b.variant === 'split') return `<div class="wrap st-split"><div>${copy}</div><ul class="st st-row" role="list">${items}</ul></div>`;
  return `<div class="wrap">${copy ? `<div class="sec-head">${copy}</div>` : ''}<ul class="st st-${b.variant}" role="list">${items}</ul></div>`;
};

const faq: R = (c, b, p) => {
  const items = (p.items ?? []).map((q: any, i: number) => {
    if (b.variant === 'plain') return `<div class="fq-it">${T(c, `items.${i}.q`, q.q, 'h3', 'h3', 'Question')}${T(c, `items.${i}.a`, q.a, 'p', 'fq-a', 'Answer', 'para')}</div>`;
    return `<details class="fq-it"${b.variant === 'accordion' ? ` name="fq-${b.id}"` : ''}${edit(c) ? ' open' : ''}><summary>${T(c, `items.${i}.q`, q.q, 'span', 'fq-q', 'Question')}<span class="fq-x" aria-hidden="true"></span></summary>${T(c, `items.${i}.a`, q.a, 'p', 'fq-a', 'Answer', 'para')}</details>`;
  }).join('');
  if (b.variant === 'split') return `<div class="wrap fq-split"><div class="fq-side">${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}${T(c, 'intro', p.intro, 'p', 'lede', 'A short intro', 'para')}</div><div class="fq">${items}</div></div>`;
  return `<div class="wrap rt-narrow">${secHead(c, p, { cls: 'one' })}<div class="fq">${items}</div></div>`;
};

const cta: R = (c, b, p) => {
  const copy = T(c, 'title', p.title, 'h2', 'h2 cta-h', 'Heading') + T(c, 'text', p.text, 'p', 'lede', 'A short text', 'para');
  const acts = buttons(c, ['primary', p.primary], ['secondary', p.secondary]);
  if (b.variant === 'image') return `${img(c, 'image', p.image, { className: 'cta-bg', sizes: '100vw' })}<div class="cta-scrim" aria-hidden="true"></div><div class="wrap cta-over"><div>${copy}</div>${acts}</div>`;
  if (b.variant === 'split') return `<div class="wrap cta-split"><div>${copy}</div>${acts}</div>`;
  if (b.variant === 'boxed') return `<div class="wrap"><div class="cta-box">${copy}${acts}</div></div>`;
  return `<div class="wrap cta-band"><div>${copy}</div>${acts}</div>`;
};

/* ---- forms ---- */
function formShell(c: RenderCtx, b: Block, inner: string, buttonLabel: string, success: string, extraClass = '') {
  const hidden = `<input type="hidden" name="_s" value="${esc(c.appId)}"><input type="hidden" name="_b" value="${esc(b.id)}"><input type="hidden" name="_p" value="${esc(c.page.id)}">`;
  const hp = '<div class="hp" aria-hidden="true"><label>Leave this empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>';
  return `<form class="${cls('form', extraClass)}" method="post" action="${esc(c.formAction)}" data-form data-success="${esc(success || 'Thank you.')}">${hidden}${hp}${inner}<div class="form-end"><button class="btn btn-p" type="submit">${P(buttonLabel || 'Send')}</button><p class="form-msg" role="status" aria-live="polite"></p></div></form>`;
}
const fid = (b: Block, n: string) => `f-${b.id}-${n}`;
const input = (b: Block, name: string, label: string, o: { type?: string; required?: boolean; auto?: string; long?: boolean; max?: number } = {}) =>
  `<div class="fl"><label for="${fid(b, name)}">${esc(label)}${o.required ? '' : ' <span class="opt">(optional)</span>'}</label>${o.long
    ? `<textarea id="${fid(b, name)}" name="${name}" rows="5" maxlength="${o.max ?? 5000}"${o.required ? ' required' : ''}></textarea>`
    : `<input id="${fid(b, name)}" name="${name}" type="${o.type ?? 'text'}"${o.auto ? ` autocomplete="${o.auto}"` : ''} maxlength="${o.max ?? 200}"${o.required ? ' required' : ''}>`}</div>`;

const contact: R = (c, b, p) => {
  const st = c.site.settings;
  const addr = p.address || esc(st.address);
  const phone = p.phone || st.phone, email = p.email || st.email;
  const details = `<div class="ct-info">${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}${T(c, 'text', p.text, 'p', 'lede', 'A short text', 'para')}<dl class="ct-dl">${addr ? `<div><dt>Address</dt><dd>${addr}</dd></div>` : ''}${phone ? `<div><dt>Phone</dt><dd><a href="tel:${esc(telOf(phone))}">${esc(phone)}</a></dd></div>` : ''}${email ? `<div><dt>Email</dt><dd><a href="mailto:${esc(email)}">${esc(email)}</a></dd></div>` : ''}</dl></div>`;
  const form = formShell(c, b, input(b, 'name', 'Your name', { required: true, auto: 'name', max: 120 }) + input(b, 'email', 'Email', { type: 'email', auto: 'email' })
    + (p.askPhone ? input(b, 'phone', 'Phone', { type: 'tel', auto: 'tel', max: 40 }) : '') + input(b, 'message', 'Message', { required: true, long: true }), p.button, p.success);
  if (b.variant === 'form') return `<div class="wrap rt-narrow"><div class="sec-head one">${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}${T(c, 'text', p.text, 'p', 'lede', 'A short text', 'para')}</div>${form}</div>`;
  return `<div class="wrap ${b.variant === 'split' ? 'ct-split' : 'ct-stack'}">${details}${form}</div>`;
};

const booking: R = (c, b, p) => {
  const choices = lines(p.services);
  const pick = choices.length ? `<fieldset class="fl chips"><legend>What for</legend>${choices.map((x, i) => `<label class="chip"><input type="radio" name="choice" value="${esc(x)}"${i === 0 ? ' checked' : ''}><span>${esc(x)}</span></label>`).join('')}</fieldset>` : '';
  const when = `<div class="fl-row"><div class="fl"><label for="${fid(b, 'date')}">Date</label><input id="${fid(b, 'date')}" name="date" type="date" required></div>${p.askTime ? `<div class="fl"><label for="${fid(b, 'time')}">Time</label><input id="${fid(b, 'time')}" name="time" type="time" step="900"></div>` : ''}</div>`;
  const form = formShell(c, b, pick + when + `<div class="fl-row">${input(b, 'name', 'Your name', { required: true, auto: 'name', max: 120 })}${input(b, 'phone', 'Phone', { type: 'tel', auto: 'tel', required: true, max: 40 })}</div>`
    + input(b, 'email', 'Email', { type: 'email', auto: 'email' }) + input(b, 'notes', 'Anything we should know', { long: true, max: 2000 }), p.button, p.success);
  const copy = T(c, 'heading', p.heading, 'h2', 'h2', 'Heading') + T(c, 'text', p.text, 'p', 'lede', 'A short text', 'para');
  if (b.variant === 'form') return `<div class="wrap rt-narrow"><div class="sec-head one">${copy}</div>${form}</div>`;
  return `<div class="wrap ct-split"><div class="ct-info">${copy}</div>${form}</div>`;
};

const newsletter: R = (c, b, p) => {
  const form = formShell(c, b, `<div class="fl nl-f"><label for="${fid(b, 'email')}">Email</label><input id="${fid(b, 'email')}" name="email" type="email" autocomplete="email" required maxlength="200"></div>`, p.button, p.success, 'nl-form');
  const copy = T(c, 'heading', p.heading, 'h2', 'h2', 'Heading') + T(c, 'text', p.text, 'p', 'lede', 'A short text', 'para');
  return `<div class="wrap nl nl-${b.variant}"><div>${copy}</div>${form}</div>`;
};

const DOW: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, 'आइत': 0, 'सोम': 1, 'मंगल': 2, 'बुध': 3, 'बिही': 4, 'शुक्र': 5, 'शनि': 6 };
const dowOf = (d: string) => { const k = textOf(d).toLowerCase(); for (const [n, i] of Object.entries(DOW)) if (k.startsWith(n)) return i; return undefined; };
const hours: R = (c, b, p) => {
  const rows = (p.days ?? []).map((d: any) => `<tr${dowOf(d.day) !== undefined ? ` data-dow="${dowOf(d.day)}"` : ''}><th scope="row">${P(d.day)}</th><td>${P(d.hours)}</td></tr>`).join('');
  const table = `<table class="hr-t"><caption class="sr-only">${esc(textOf(p.heading) || 'Opening hours')}</caption><tbody>${rows}</tbody></table>`;
  const note = T(c, 'note', p.note, 'p', 'lede', 'A note, like holidays', 'para');
  if (b.variant === 'split') return `<div class="wrap hr-split"><div>${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}${note}</div>${table}</div>`;
  return `<div class="wrap ${b.variant === 'compact' ? 'hr-compact' : 'rt-narrow'}">${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}${table}${note}</div>`;
};

const map: R = (c, b, p) => {
  const st = c.site.settings;
  const addrHtml = p.address || esc(st.address);
  const q = p.query || textOf(addrHtml) || c.site.name;
  const src = mapEmbed(q, p.link);
  const dir = mapsLink(q, p.link);
  const phone = p.phone || st.phone;
  const hrs = lines(p.hours);
  const frame = src ? (edit(c)
    ? `<div class="map-frame map-ph">${icon('pin', 'map-pin')}<span>Map of ${esc(textOf(q))}</span><small>The live map shows on the published site.</small></div>`
    : `<iframe class="map-frame" src="${esc(src)}" title="Map: ${esc(textOf(q))}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`) : '';
  const facts = `${addrHtml ? `<p class="map-addr"${edit(c) && p.address ? attrs({ 'data-f': 'address', 'data-kind': 'para', 'data-ph': 'Address' }) : ''}>${addrHtml}</p>` : ''}`
    + (phone ? `<p class="map-ph-n"><a href="tel:${esc(telOf(phone))}">${esc(phone)}</a></p>` : '')
    + (edit(c) ? T(c, 'hours', p.hours, 'p', 'map-hours', 'Hours, one line per row', 'para') : hrs.length ? `<ul class="map-hours">${hrs.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : '')
    + T(c, 'note', p.note, 'p', 'map-note', 'Landmarks, parking, which gate', 'para');
  const info = `<div class="map-info">${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}${facts}${dir ? `<a class="btn btn-p" href="${esc(dir)}" target="_blank" rel="noopener">Get directions</a>` : ''}</div>`;
  if (b.variant === 'card') return `<div class="wrap"><div class="map-card">${info}</div></div>`;
  if (b.variant === 'split') return `<div class="wrap map-split">${info}${frame}</div>`;
  if (b.variant === 'location') return `<div class="wrap map-loc">${frame}<div class="map-float">${info}</div></div>`;
  return `<div class="wrap">${info}${frame}</div>`;
};

const timeline: R = (c, b, p) => {
  const items = (p.items ?? []).map((t: any, i: number) => `<li class="tl-it"><p class="tl-d">${P(t.date)}</p><div>${T(c, `items.${i}.title`, t.title, 'h3', 'h3', 'Title')}${T(c, `items.${i}.text`, t.text, 'p', 'tl-t', 'What happened', 'para')}</div></li>`).join('');
  return `<div class="wrap">${T(c, 'heading', p.heading, 'h2', 'h2 sec-h', 'Heading')}<ol class="tl tl-${b.variant}">${items}</ol></div>`;
};

const beforeafter: R = (c, b, p) => {
  const before = img(c, 'before', p.before, { sizes: '(min-width: 1000px) 960px, 100vw', ratio: '3/2', className: 'ba-img' });
  const after = img(c, 'after', p.after, { sizes: '(min-width: 1000px) 960px, 100vw', ratio: '3/2', className: 'ba-img' });
  const cap = T(c, 'caption', p.caption, 'p', 'cap', 'Caption');
  const head = T(c, 'heading', p.heading, 'h2', 'h2 sec-h', 'Heading');
  if (b.variant === 'side' || edit(c)) return `<div class="wrap">${head}<div class="ba-side"><figure>${before}<figcaption>${P(p.beforeLabel)}</figcaption></figure><figure>${after}<figcaption>${P(p.afterLabel)}</figcaption></figure></div>${cap}</div>`;
  if (!before || !after) return '';
  return `<div class="wrap">${head}<div class="ba" style="--pos:50%"><div class="ba-b">${before}<span class="ba-l">${P(p.beforeLabel)}</span></div><div class="ba-a">${after}<span class="ba-l ba-lr">${P(p.afterLabel)}</span></div><input class="ba-range" type="range" min="0" max="100" value="50" aria-label="Move to compare ${esc(p.beforeLabel)} and ${esc(p.afterLabel)}"></div>${cap}</div>`;
};

const downloads: R = (c, b, p) => {
  const items = (p.items ?? []).map((d: any, i: number) => {
    const href = safeHref(d.url);
    const inner = `${T(c, `items.${i}.label`, d.label, 'span', 'dl-l', 'Label')}${d.note ? `<span class="dl-n">${P(d.note)}</span>` : ''}`;
    return `<li>${href || edit(c) ? `<a href="${esc(href || '#')}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''}${edit(c) ? attrs({ 'data-link': `items.${i}.url` }) : ''}>${inner}${icon('down')}</a>` : ''}</li>`;
  }).join('');
  return `<div class="wrap">${T(c, 'heading', p.heading, 'h2', 'h2 sec-h', 'Heading')}<ul class="dl dl-${b.variant}" role="list">${items}</ul></div>`;
};

const social: R = (c, b, p) => {
  const links = ((p.links ?? []).filter((l: any) => l.url).length ? p.links : c.site.settings.social).filter((l: any) => /^https?:/.test(l.url));
  if (!links.length && !edit(c)) return '';
  const items = links.map((l: any) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener me">${esc(netName(l.network))}</a></li>`).join('') || '<li class="muted">Add links in the block settings or Site settings</li>';
  return `<div class="wrap so so-${b.variant}">${T(c, 'heading', p.heading, 'h2', 'so-h', 'Heading')}<ul role="list">${items}</ul></div>`;
};

/* ---------------- the second set: tabs, comparisons, countdowns, stories, notes, enquiries, payments ---------------- */

/** A list line like "Blow-dry – 900" → ["Blow-dry", "900"] (a dash with spaces around it). */
const splitDetail = (line: string): [string, string] => {
  const m = /^(.*?\S)\s+[–—-]\s+([^–—]{1,40})$/.exec(line);
  return m ? [m[1], m[2].trim()] : [line, ''];
};
/** A phone number as WhatsApp wants it (country code, digits only). Nepali mobiles get 977 in front. */
export const waOf = (s: string) => {
  let d = String(s ?? '').replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, '');
  if (/^9[78]\d{8}$/.test(d)) d = '977' + d;
  return /^[1-9]\d{7,14}$/.test(d) ? d : '';
};
const hashOf = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const emptyNote = (c: RenderCtx, msg: string) => (edit(c) ? `<div class="wrap empty-blk">${esc(msg)}</div>` : '');

const announce: R = (c, b, p) => {
  if (!has(p.text) && !edit(c)) return '';
  const tag = p.label ? `<span class="an-tag">${P(p.label)}</span>` : '';
  const msg = T(c, 'text', p.text, 'p', 'an-msg', 'A short message');
  const more = textLink(c, 'link', p.link, 'an-link');
  const close = p.dismiss && !edit(c) ? `<button type="button" class="an-x" data-an-x aria-label="Close this message">${icon('close')}</button>` : '';
  // The key changes with the words, so a new message shows again to someone who closed the last one.
  const key = close ? ` data-an="${esc(`${b.id}-${hashOf(textOf(p.text) + '|' + p.label)}`)}"` : '';
  const inner = b.variant === 'split' ? `<div class="an-main">${tag}${msg}</div>${more}` : `${tag}${msg}${more}`;
  return `<div class="${cls('wrap an', `an-${b.variant}`, close && 'an-has-x')}"${key}>${inner}${close}</div>`;
};

const tabs: R = (c, b, p) => {
  const list = (p.tabs ?? []) as any[];
  if (!list.length) return emptyNote(c, 'Add tabs in the block settings.');
  const id = (i: number) => `tb-${b.id}-${i}`;
  const btns = list.map((t, i) => `<button type="button" role="tab" class="tb-tab" id="${id(i)}-t" aria-controls="${id(i)}" aria-selected="${i === 0}"${i ? ' tabindex="-1"' : ''}><span>${P(t.label || `Tab ${i + 1}`)}</span></button>`).join('');
  const panels = list.map((t, i) => {
    const pts = lines(t.points);
    const ptsHtml = edit(c) ? T(c, `tabs.${i}.points`, t.points, 'p', 'tb-pts-e', 'A list, one per line (Shift+Enter for a new line)', 'para')
      : pts.length ? `<ul class="tb-pts" role="list">${pts.map((l) => { const [n, v] = splitDetail(l); return `<li><span>${esc(n)}</span>${v ? `<span class="tb-dots" aria-hidden="true"></span><b>${esc(v)}</b>` : ''}</li>`; }).join('')}</ul>` : '';
    const media = hasImg(c, t.image) || edit(c) ? `<div class="tb-m rv">${img(c, `tabs.${i}.image`, t.image, { sizes: b.variant === 'side' ? '(min-width: 900px) 40vw, 100vw' : '(min-width: 900px) 50vw, 100vw', ratio: '4/3' })}</div>` : '';
    const copy = `<div class="tb-c"><p class="tb-pl">${P(t.label)}</p>${T(c, `tabs.${i}.title`, t.title, 'h3', 'h3 tb-t', 'Heading')}${T(c, `tabs.${i}.text`, t.text, 'p', 'tb-x', 'A few lines', 'para')}${ptsHtml}${textLink(c, `tabs.${i}.link`, t.link)}</div>`;
    return `<div class="${cls('tb-p', i > 0 && 'tb-off', !media && 'tb-nom')}" role="tabpanel" id="${id(i)}" aria-labelledby="${id(i)}-t" tabindex="0">${copy}${media}</div>`;
  }).join('');
  return `<div class="wrap">${secHead(c, p)}<div class="tb tb-${b.variant}" data-tabs><div class="tb-list" role="tablist" aria-label="${esc(textOf(p.heading) || 'Tabs')}">${btns}</div><div class="tb-ps">${panels}</div></div></div>`;
};

const YES = /^(yes|y|true|included|✓|✔|हो|छ)$/i, NO = /^(no|n|false|not included|x|✗|✘|-|–|—|होइन|छैन)$/i;
const mark = (v: unknown) => {
  const s = String(v ?? '').trim();
  if (YES.test(s)) return `<span class="cmp-y">${icon('check')}<span class="sr-only">Included</span></span>`;
  if (NO.test(s)) return `<span class="cmp-no">${icon('cross')}<span class="sr-only">Not included</span></span>`;
  return s ? `<span class="cmp-v">${esc(s)}</span>` : '';
};
const compare: R = (c, b, p) => {
  const cols = ((p.columns ?? []) as any[]).slice(0, 4);
  const rows = (p.rows ?? []) as any[];
  if (!cols.length) return emptyNote(c, 'Add plans in the block settings.');
  const note = T(c, 'note', p.note, 'p', 'cmp-fine', 'Small print', 'para');
  if (b.variant === 'cards') {
    const cards = cols.map((col, i) => {
      const items = rows.map((r, j) => {
        const v = String(r[`v${i + 1}`] ?? '').trim();
        const off = !v || NO.test(v);
        const label = T(c, `rows.${j}.label`, r.label, 'span', 'cmp-rl', 'What is compared');
        return `<li class="${cls(off && 'cmp-off')}">${off ? `<span class="cmp-no">${icon('cross')}<span class="sr-only">Not included:</span></span>` : `<span class="cmp-y">${icon('check')}</span>`}${label}${!off && !YES.test(v) ? `<b class="cmp-v">${esc(v)}</b>` : ''}</li>`;
      }).join('');
      return `<li class="${cls('cmp-card', col.featured && 'cmp-on')}"><div class="cmp-top">${T(c, `columns.${i}.name`, col.name, 'h3', 'h3 cmp-name', 'Plan')}${col.note ? `<p class="cmp-note">${P(col.note)}</p>` : ''}</div><ul class="cmp-ul" role="list">${items}</ul></li>`;
    }).join('');
    return `<div class="wrap">${secHead(c, p)}<ul class="cmp-cards" role="list">${cards}</ul>${note}</div>`;
  }
  const head = `<thead><tr><td class="cmp-c0"></td>${cols.map((col, i) => `<th scope="col" class="${cls('cmp-th', col.featured && 'cmp-on')}">${T(c, `columns.${i}.name`, col.name, 'span', 'cmp-name', 'Plan')}${col.note ? `<span class="cmp-note">${P(col.note)}</span>` : ''}</th>`).join('')}</tr></thead>`;
  const body = rows.map((r, j) => `<tr><th scope="row">${T(c, `rows.${j}.label`, r.label, 'span', 'cmp-rl', 'What is compared')}</th>${cols.map((col, i) => `<td class="${cls(col.featured && 'cmp-on')}">${mark(r[`v${i + 1}`])}</td>`).join('')}</tr>`).join('');
  return `<div class="wrap">${secHead(c, p)}<div class="cmp-scroll" role="region" tabindex="0" aria-label="${esc(textOf(p.heading) || 'Comparison')}"><table class="cmp" style="--n:${cols.length}">${head}<tbody>${body}</tbody></table></div>${note}</div>`;
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const clock12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`; };
/** "Wednesday, 4 Kartik 2083 (21 October 2026), 10 am": the day in BS, AD or both. */
export function whenOf(date: string, time: string, calendar: string) {
  const [y, mo, d] = date.split('-').map(Number);
  const ad = `${d} ${MONTHS[mo - 1]} ${y}`;
  const b = adToBs(date);
  const bs = b ? `${b.d} ${BS_MONTHS[b.m]} ${b.y}` : '';
  const day = calendar === 'bs' && bs ? bs : calendar === 'both' && bs ? `${bs} (${ad})` : ad;
  return `${WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]}, ${day}${time ? `, ${clock12(time)}` : ''}`;
}
const countdown: R = (c, b, p) => {
  const date = String(p.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return emptyNote(c, 'Pick a date in the block settings.');
  const time = /^\d{2}:\d{2}$/.test(p.time) ? p.time : '';
  const iso = `${date}T${time || '00:00'}:00+05:45`;
  const left = Math.max(0, Date.parse(iso) - Date.now());
  const done = left <= 0;
  const n = [Math.floor(left / 864e5), Math.floor(left / 36e5) % 24, Math.floor(left / 6e4) % 60, Math.floor(left / 1e3) % 60];
  const units: [string, string][] = [['d', 'Days'], ['h', 'Hours'], ['m', 'Minutes'], ['s', 'Seconds']];
  const clock = `<div class="cd-clock" role="timer" aria-label="Time left">${units.map(([k, l], i) => `<div class="cd-u"><span class="cd-n" data-u="${k}">${i ? String(n[i]).padStart(2, '0') : n[i]}</span><span class="cd-l">${l}</span></div>`).join('')}</div>`;
  const when = `<p class="cd-when"><time datetime="${esc(iso)}">${esc(whenOf(date, time, p.calendar))}</time></p>`;
  const after = (edit(c) ? '<p class="cd-elabel">Shown once the time comes:</p>' : '') + T(c, 'after', p.after, 'p', 'cd-after', 'What to say once the time comes');
  const copy = T(c, 'heading', p.heading, 'h2', 'h2 cd-h', 'Heading') + T(c, 'text', p.text, 'p', 'lede', 'A short text', 'para');
  const acts = buttons(c, ['link', p.link]);
  const root = (x: string, inner: string) => `<div class="${cls(x, 'cd', done && 'cd-done')}" data-cd="${esc(iso)}">${inner}</div>`;
  if (b.variant === 'split') return root('wrap cd-split', `<div class="cd-copy">${copy}${when}${acts}</div><div class="cd-side">${clock}${after}</div>`);
  if (b.variant === 'image') return `${img(c, 'image', p.image, { className: 'cd-bg', sizes: '100vw' })}<div class="cd-scrim" aria-hidden="true"></div>${root('wrap cd-over', `<div class="cd-copy">${copy}${when}</div>${clock}${after}${acts}`)}`;
  return root('wrap cd-band', `<div class="cd-copy">${copy}</div>${clock}${after}<div class="cd-foot">${when}${acts}</div>`);
};

const voices: R = (c, b, p) => {
  const items = (p.items ?? []) as any[];
  if (!items.length) return emptyNote(c, 'Add stories in the block settings.');
  const wall = b.variant === 'wall';
  const one = (q: any, i: number, extra = '') => {
    const pic = hasImg(c, q.image) || edit(c);
    const photo = pic && !wall ? `<div class="vc-m rv">${img(c, `items.${i}.image`, q.image, { sizes: b.variant === 'slider' ? '(min-width: 900px) 40vw, 100vw' : '(min-width: 900px) 30vw, 100vw', ratio: '4/5' })}</div>` : '';
    const avatar = pic && wall ? `<span class="vc-av">${img(c, `items.${i}.image`, q.image, { sizes: '56px', ratio: '1' })}</span>` : '';
    const who = `<figcaption class="vc-who">${avatar}<span class="vc-wt">${T(c, `items.${i}.name`, q.name, 'span', 'vc-name', 'Name')}${T(c, `items.${i}.role`, q.role, 'span', 'vc-role', 'Who they are')}</span></figcaption>`;
    return `<figure class="${cls('vc-it', !pic && 'vc-nopic')}"${extra}>${photo}<div class="vc-b"><blockquote class="vc-bq">${T(c, `items.${i}.quote`, q.quote, 'p', 'vc-q', 'Their words', 'para')}</blockquote>${who}</div></figure>`;
  };
  if (b.variant === 'slider') {
    const n = items.length;
    const slides = items.map((q, i) => one(q, i, ` role="group" aria-roledescription="slide" aria-label="${i + 1} of ${n}"`)).join('');
    const nav = n > 1 ? `<div class="vc-nav"><button type="button" class="vc-btn" data-sl="-1" aria-label="Previous story" disabled>${icon('left')}</button><p class="vc-count" aria-live="polite"><span data-sl-i>1</span> of ${n}</p><button type="button" class="vc-btn" data-sl="1" aria-label="Next story">${icon('right')}</button></div>` : '';
    return `<div class="wrap">${secHead(c, p)}<div class="vc-slider" data-slider role="region" aria-roledescription="carousel" aria-label="${esc(textOf(p.heading) || 'Customer stories')}"><div class="vc-track" tabindex="0">${slides}</div>${nav}</div></div>`;
  }
  return `<div class="wrap">${secHead(c, p)}<div class="vc-${b.variant}">${items.map((q, i) => one(q, i)).join('')}</div></div>`;
};

const pct = (v: unknown) => { const n = Number(v); return isFinite(n) ? Math.min(100, Math.max(0, n)) : 50; };
const hotspots: R = (c, b, p) => {
  const pts = (p.points ?? []) as any[];
  const im = img(c, 'image', p.image, { sizes: b.variant === 'legend' ? '(min-width: 900px) 62vw, 100vw' : '(min-width: 1400px) 1320px, 100vw' });
  if (!im) return '';
  const pos = (pt: any) => `--x:${pct(pt.x)}%;--y:${pct(pt.y)}%`;
  const nid = (i: number) => `hs-${b.id}-${i}`;
  if (b.variant === 'legend') {
    const dots = pts.map((pt, i) => `<span class="hs-dot" style="${pos(pt)}" aria-hidden="true" data-hs-i="${i}">${i + 1}</span>`).join('');
    const legend = pts.map((pt, i) => `<li class="hs-li" data-hs-i="${i}"><span class="hs-n" aria-hidden="true">${i + 1}</span><div class="hs-lb">${T(c, `points.${i}.title`, pt.title, 'h3', 'hs-t', 'Title')}${T(c, `points.${i}.text`, pt.text, 'p', 'hs-x', 'A short note', 'para')}</div></li>`).join('');
    return `<div class="wrap">${secHead(c, p)}<div class="hs hs-legend" data-hs-box><div class="hs-stage"><div class="hs-img rv">${im}</div>${dots}</div><ol class="hs-leg" role="list">${legend}</ol></div></div>`;
  }
  const spots = pts.map((pt, i) => {
    const x = pct(pt.x), y = pct(pt.y);
    const title = textOf(pt.title) || `Point ${i + 1}`;
    return `<button type="button" class="hs-dot" style="${pos(pt)}" aria-expanded="false" aria-controls="${nid(i)}" data-hs="${nid(i)}"><span aria-hidden="true">${i + 1}</span><span class="sr-only">${esc(title)}</span></button>`
      + `<div class="${cls('hs-note', x > 55 && 'hs-l', y > 58 && 'hs-u')}" id="${nid(i)}" style="${pos(pt)}"${edit(c) ? '' : ' hidden'}><span class="hs-n" aria-hidden="true">${i + 1}</span><div class="hs-lb">${T(c, `points.${i}.title`, pt.title, 'h3', 'hs-t', 'Title')}${T(c, `points.${i}.text`, pt.text, 'p', 'hs-x', 'A short note', 'para')}</div>${edit(c) ? '' : `<button type="button" class="hs-close" data-hs-close aria-label="Close the note">${icon('close')}</button>`}</div>`;
  }).join('');
  return `<div class="wrap">${secHead(c, p)}<div class="hs hs-pins" data-hs-box><div class="hs-stage"><div class="hs-img rv">${im}</div>${spots}</div></div></div>`;
};

const expand: R = (c, b, p) => {
  const items = (p.items ?? []) as any[];
  if (!items.length) return emptyNote(c, 'Add items in the block settings.');
  const split = b.variant === 'split';
  const rows = items.map((it, i) => {
    const pic = hasImg(c, it.image) || edit(c);
    const m = pic ? `<div class="${cls('ex-m', split && 'ex-m-s', !split && 'rv')}">${img(c, `items.${i}.image`, it.image, { sizes: split ? '100vw' : '(min-width: 900px) 40vw, 100vw', ratio: '4/3' })}</div>` : '';
    return `<details class="ex-it" name="ex-${b.id}"${i === 0 || edit(c) ? ' open' : ''}><summary>${T(c, `items.${i}.title`, it.title, 'span', 'ex-t', 'Name')}${it.detail ? `<span class="ex-d">${P(it.detail)}</span>` : ''}<span class="fq-x ex-x" aria-hidden="true"></span></summary>`
      + `<div class="${cls('ex-body', !m && 'ex-nom')}">${m}<div class="ex-c">${T(c, `items.${i}.text`, it.text, 'p', 'ex-p', 'A few lines', 'para')}${textLink(c, `items.${i}.link`, it.link)}</div></div></details>`;
  }).join('');
  if (split) {
    const pics = items.map((it, i) => `<div class="ex-pic">${img(c, `items.${i}.image`, it.image, { sizes: '(min-width: 900px) 45vw, 1px', ratio: '4/5' })}</div>`).join('');
    return `<div class="wrap">${secHead(c, p)}<div class="ex ex-split"><div class="ex-list">${rows}</div><div class="ex-pics rv">${pics}</div></div></div>`;
  }
  return `<div class="wrap">${secHead(c, p)}<div class="ex ex-rows">${rows}</div></div>`;
};

const EMAIL_OK = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const enquire: R = (c, b, p) => {
  const st = c.site.settings;
  const items = (p.items ?? []) as any[];
  if (!items.length) return emptyNote(c, 'Add items in the block settings.');
  const wa = waOf(p.whatsapp || st.phone);
  const formBlock = c.page.blocks.find((x) => ['contact', 'visit', 'booking'].includes(x.type));
  const anchor = formBlock ? anchorsFor(c.page)[formBlock.id] : '';
  const email = EMAIL_OK.test(st.email) ? st.email : '';
  const order = p.via === 'form' ? ['form', 'whatsapp', 'email'] : p.via === 'email' ? ['email', 'whatsapp', 'form'] : ['whatsapp', 'form', 'email'];
  const go = (name: string): { href: string; ext?: boolean; form?: string } | null => {
    const msg = `${cleanWord(p.message) || 'Hello, I would like to ask about'} ${name}`.trim();
    for (const k of order) {
      if (k === 'whatsapp' && wa) return { href: `https://wa.me/${wa}?text=${encodeURIComponent(msg)}`, ext: true };
      if (k === 'form' && anchor) return { href: `#${anchor}`, form: msg };
      if (k === 'email' && email) return { href: `mailto:${email}?subject=${encodeURIComponent(name)}&body=${encodeURIComponent(msg)}` };
    }
    return null;
  };
  const sizes: Record<string, string> = { grid: '(min-width: 1000px) 30vw, (min-width: 560px) 50vw, 100vw', wide: '(min-width: 900px) 50vw, 100vw', rows: '160px' };
  const list = items.map((it, i) => {
    const name = textOf(it.name);
    const price = money(it.price, p.currency, st.lang);
    const to = go(name);
    const btn = p.button && (to || edit(c)) ? `<a${attrs({ class: 'btn btn-s eq-go', href: to?.href ?? '#', target: to?.ext ? '_blank' : undefined, rel: to?.ext ? 'noopener' : undefined, 'data-enq': to?.form })}>${P(p.button)}<span class="sr-only">: ${esc(name)}</span></a>` : '';
    const badge = it.badge ? `<span class="${cls('eq-badge', /sold|out of stock|बिक्री/i.test(it.badge) && 'eq-out')}">${P(it.badge)}</span>` : '';
    const pic = hasImg(c, it.image) || edit(c);
    const media = pic ? `<div class="eq-m"><div class="rv">${img(c, `items.${i}.image`, it.image, { sizes: sizes[b.variant], ratio: b.variant === 'wide' ? '4/3' : b.variant === 'rows' ? '1' : '4/5' })}</div>${badge}</div>` : '';
    const priceHtml = price ? `<p class="eq-price">${price}${it.per ? `<span> / ${P(it.per)}</span>` : ''}</p>` : '';
    return `<li class="${cls('eq-it', !pic && 'eq-nopic')}">${media}<div class="eq-b"><div class="eq-h">${T(c, `items.${i}.name`, it.name, 'h3', 'h3 eq-t', 'Name')}${priceHtml}</div>${pic ? '' : badge}${T(c, `items.${i}.text`, it.text, 'p', 'eq-x', 'A short description', 'para')}${btn}</div></li>`;
  }).join('');
  return `<div class="wrap">${secHead(c, p)}<ul class="eq eq-${b.variant}" role="list">${list}</ul></div>`;
};

const payment: R = (c, b, p) => {
  const ms = (p.methods ?? []) as any[];
  if (!ms.length) return emptyNote(c, 'Add a way to pay in the block settings.');
  const items = ms.map((m, i) => {
    const qr = hasImg(c, m.qr) || edit(c) ? `<div class="pay-qr">${img(c, `methods.${i}.qr`, m.qr, { sizes: '240px', ratio: '1' })}</div>` : '';
    const more = lines(m.details);
    const holder = m.holder ? `<div><dt>Name</dt><dd>${P(m.holder)}</dd></div>` : '';
    const number = m.number ? `<div><dt>Number</dt><dd class="pay-num"><span class="pay-v">${P(m.number)}</span><button type="button" class="pay-copy" data-copy="${esc(m.number)}" aria-label="Copy the ${esc(m.name || 'payment')} number">${icon('copy')}<span>Copy</span></button></dd></div>` : '';
    return `<li class="${cls('pay-it', !qr && 'pay-noqr')}"><h3 class="pay-name">${P(m.name || 'Way to pay')}</h3>${qr}<div class="pay-info">${holder || number ? `<dl class="pay-dl">${holder}${number}</dl>` : ''}${more.length ? `<ul class="pay-more" role="list">${more.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div></li>`;
  }).join('');
  return `<div class="wrap">${secHead(c, p)}<ul class="pay pay-${b.variant}" role="list">${items}</ul>${T(c, 'note', p.note, 'p', 'pay-note', 'What to do after paying', 'para')}<p class="sr-only" role="status" data-copy-status></p></div>`;
};

/** A video link → its player, for the Video feature. YouTube and Vimeo as the Video block; TikTok and Instagram
 *  as profiles do (see embedOf in server/profiles.ts). Every player is on a host allowed by the site's frame-src. */
export function embedOfSite(u: string): { src: string; watch: string; thumb?: string; vertical: boolean; label: string } | null {
  const s = String(u ?? '').trim();
  const v = videoOf(s);
  if (v) return { src: v.embed, watch: v.watch, thumb: v.thumb, vertical: /youtube\.com\/shorts\//i.test(s), label: v.kind === 'youtube' ? 'YouTube' : 'Vimeo' };
  let m = /^https:\/\/(?:www\.|m\.)?tiktok\.com\/(?:(@[\w.-]{1,40})\/(?:video|photo)\/|embed\/(?:v2\/)?|player\/v1\/|v\/)(\d{8,25})/i.exec(s);
  if (m) return { src: `https://www.tiktok.com/player/v1/${m[2]}?autoplay=1&description=1&music_info=1`, watch: m[1] ? `https://www.tiktok.com/${m[1]}/video/${m[2]}` : `https://www.tiktok.com/embed/v2/${m[2]}`, vertical: true, label: 'TikTok' };
  m = /^https:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/(?:(?!share\/)[\w.]{1,40}\/)?(p|reels?|tv)\/([\w-]{5,40})/i.exec(s);
  if (m) { const k = m[1] === 'p' ? 'p' : 'reel'; return { src: `https://www.instagram.com/${k}/${m[2]}/embed/`, watch: `https://www.instagram.com/${k}/${m[2]}/`, vertical: true, label: 'Instagram' }; }
  return null;
}
const videofeature: R = (c, b, p) => {
  const v = embedOfSite(p.url);
  if (!v && !edit(c)) return '';
  const title = textOf(p.heading) || 'Video';
  const own = hasImg(c, p.image);
  const poster = own || !v?.thumb ? img(c, 'image', p.image, { className: 'vf-img', sizes: b.variant === 'split' || v?.vertical ? '(min-width: 900px) 50vw, 100vw' : '100vw' })
    : `<img class="vf-img" src="${esc(v.thumb)}" alt=""${c.mode === 'publish' ? ' loading="lazy"' : ''}${edit(c) ? ' data-img="image"' : ''}>`;
  const label = !v ? '<span class="vf-src">Paste a YouTube, Vimeo, TikTok or Instagram link in the block settings</span>' : !poster ? `<span class="vf-src">${esc(v.label)}</span>` : '';
  const face = `<a${attrs({ class: 'vf-face', href: v?.watch ?? '#', 'data-embed': v && !edit(c) ? v.src : undefined, 'data-title': v && !edit(c) ? title : undefined, 'data-frame': v && !edit(c) ? cls('vf-frame', v.vertical && 'vf-v') : undefined })}>${poster}${label}<span class="vf-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8.5 5.8v12.4L18.6 12z"/></svg></span><span class="sr-only">Play video: ${esc(title)}</span></a>`;
  const copy = T(c, 'heading', p.heading, 'h2', 'h2 vf-h', 'Heading') + T(c, 'text', p.text, 'p', 'lede vf-x', 'A short text', 'para') + buttons(c, ['link', p.link]);
  const cap = T(c, 'caption', p.caption, 'p', 'cap', 'Caption');
  const vert = !!v?.vertical;
  if (b.variant === 'overlay' && !vert) return `<div class="vf vf-overlay" data-vf><div class="vf-stage">${face}<div class="vf-scrim" aria-hidden="true"></div></div><div class="wrap vf-copy">${copy}${cap}</div></div>`;
  if (b.variant === 'cinema' && !vert) return `<div class="wrap vf vf-cinema" data-vf><div class="vf-head">${copy}</div><div class="vf-stage">${face}</div>${cap}</div>`;
  return `<div class="${cls('wrap vf vf-split', vert && 'vf-isv')}" data-vf><div class="vf-copy">${copy}</div><div class="vf-side"><div class="vf-stage">${face}</div>${cap}</div></div>`;
};

const share: R = (c, b, p) => {
  const file = safeHref(p.file);
  const dl = file || edit(c) ? `<div class="sh-file"><a${attrs({ class: 'btn btn-p sh-dl', href: file || '#', target: /^https?:/.test(file) ? '_blank' : undefined, rel: /^https?:/.test(file) ? 'noopener' : undefined, 'data-link': edit(c) ? 'file' : undefined })}><span>${P(p.fileLabel || 'Download')}</span>${icon('down')}</a>${p.fileNote ? `<span class="sh-note">${P(p.fileNote)}</span>` : ''}</div>` : '';
  const nets: [string, string][] = [['whatsapp', 'WhatsApp'], ['facebook', 'Facebook'], ['x', 'X']];
  const shareHtml = p.showShare ? `<div class="sh-share">${p.shareLabel ? `<p class="sh-l">${P(p.shareLabel)}</p>` : ''}<ul class="sh-ul" role="list">${nets.map(([k, l]) => `<li><a class="sh-b" href="#" data-share="${k}" target="_blank" rel="noopener">${l}</a></li>`).join('')}<li><button type="button" class="sh-b" data-share="copy">${icon('copy')}<span>Copy link</span></button></li><li class="sh-native" hidden><button type="button" class="sh-b" data-share="native">More ways</button></li></ul><p class="sr-only" role="status" data-share-status></p></div>` : '';
  if (!dl && !shareHtml) return emptyNote(c, 'Add a file link or turn on the share buttons in the block settings.');
  const copy = T(c, 'heading', p.heading, 'h2', b.variant === 'inline' ? 'sh-ih' : 'h2 sh-h', 'Heading') + (b.variant === 'inline' ? '' : T(c, 'text', p.text, 'p', 'lede', 'A short text', 'para'));
  if (b.variant === 'card') {
    const cover = hasImg(c, p.image) || edit(c) ? `<div class="sh-cover rv">${img(c, 'image', p.image, { sizes: '(min-width: 900px) 320px, 60vw', ratio: '3/4' })}</div>` : '';
    return `<div class="wrap"><div class="${cls('sh sh-card', !cover && 'sh-nocover')}">${cover}<div class="sh-body">${copy}${dl}${shareHtml}</div></div></div>`;
  }
  if (b.variant === 'inline') return `<div class="wrap sh sh-inline">${copy}${dl}${shareHtml}</div>`;
  return `<div class="wrap sh sh-band"><div class="sh-copy">${copy}</div><div class="sh-acts">${dl}${shareHtml}</div></div>`;
};

const visit: R = (c, b, p) => {
  const st = c.site.settings;
  const addr = p.address || esc(st.address);
  const phone = p.phone || st.phone, email = p.email || st.email;
  const wa = waOf(p.whatsapp);
  const q = p.query || textOf(addr) || c.site.name;
  const src = mapEmbed(q, p.link), dir = mapsLink(q, p.link);
  const hrs = lines(p.hours);
  const frame = src ? (edit(c)
    ? `<div class="map-frame vs-map map-ph">${icon('pin', 'map-pin')}<span>Map of ${esc(textOf(q))}</span><small>The live map shows on the published site.</small></div>`
    : `<iframe class="map-frame vs-map" src="${esc(src)}" title="Map: ${esc(textOf(q))}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`) : '';
  const row = (dt: string, dd: string) => (dd ? `<div><dt>${dt}</dt><dd>${dd}</dd></div>` : '');
  const hoursHtml = edit(c) ? T(c, 'hours', p.hours, 'p', 'vs-hours', 'Hours, one line per row', 'para') : hrs.length ? `<ul class="vs-hours" role="list">${hrs.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : '';
  const dl = `<dl class="ct-dl vs-dl">${addr ? `<div><dt>Address</dt><dd${edit(c) && p.address ? attrs({ 'data-f': 'address', 'data-kind': 'para', 'data-ph': 'Address' }) : ''}>${addr}</dd></div>` : ''}`
    + row('Phone', phone ? `<a href="tel:${esc(telOf(phone))}">${esc(phone)}</a>` : '')
    + row('WhatsApp', wa ? `<a href="https://wa.me/${wa}" target="_blank" rel="noopener">Message on WhatsApp</a>` : '')
    + row('Email', email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : '')
    + row('Hours', hoursHtml) + '</dl>';
  const directions = dir ? `<a class="tlink" href="${esc(dir)}" target="_blank" rel="noopener"><span>Get directions</span>${icon('out')}</a>` : '';
  const info = `<div class="vs-info">${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}${T(c, 'text', p.text, 'p', 'lede', 'A short text', 'para')}${dl}${directions}</div>`;
  const form = formShell(c, b, input(b, 'name', 'Your name', { required: true, auto: 'name', max: 120 }) + (p.askPhone ? `<div class="fl-row">${input(b, 'email', 'Email', { type: 'email', auto: 'email' })}${input(b, 'phone', 'Phone', { type: 'tel', auto: 'tel', max: 40 })}</div>` : input(b, 'email', 'Email', { type: 'email', auto: 'email' }))
    + input(b, 'message', 'Message', { required: true, long: true }), p.button, p.success, 'vs-form');
  if (b.variant === 'map') return `<div class="wrap vs vs-top">${frame}<div class="vs-row">${info}${form}</div></div>`;
  return `<div class="wrap vs vs-split">${info}<div class="vs-side">${form}${frame}</div></div>`;
};

const spacer: R = (_c, b, p) => `<div class="wrap sp sp-${p.size ?? 'm'} sp-${b.variant}" aria-hidden="true">${b.variant === 'space' ? '' : '<hr>'}</div>`;

const RENDER: Record<string, R> = { header, hero, footer, richtext, image, imagetext, rows, sticky, quote, marquee, gallery, video, features, steps, work, press, pricing, menu, team, testimonials, logos, stats, faq, cta, contact, booking, newsletter, hours, map, timeline, beforeafter, downloads, social, spacer,
  announce, tabs, compare, countdown, voices, hotspots, expand, enquire, payment, videofeature, share, visit };

/** One block as HTML (a <section>, or the header/footer element). */
export function renderBlock(c: RenderCtx, b: Block, anchor?: string): string {
  const r = RENDER[b.type];
  if (!r) return '';
  const inner = r(c, b, b.props ?? {});
  if (!inner && !edit(c)) return '';
  const st = b.style ?? { bg: 'page', space: 'm', hide: '' };
  const tag = b.type === 'header' ? 'header' : b.type === 'footer' ? 'footer' : 'section';
  const className = cls('blk', `b-${b.type}`, `v-${b.variant}`, `bg-${st.bg}`, `sp-${st.space}`, st.hide && `hide-${st.hide}`,
    b.type === 'header' && 'site-h', b.type === 'header' && b.props.sticky && 'sticky', b.type === 'header' && headerOver(c) && 'over', b.type === 'footer' && 'site-f');
  return `<${tag}${attrs({ class: className, id: anchor, 'data-b': edit(c) ? b.id : undefined })}>${inner || (edit(c) ? '<div class="wrap empty-blk">This block has nothing to show yet. Open its settings.</div>' : '')}</${tag}>`;
}

/** Anchors for a page's blocks: the block type, numbered when it repeats (#menu, #contact, #faq-2). */
export function anchorsFor(page: Page): Record<string, string> {
  const seen: Record<string, number> = {};
  const out: Record<string, string> = {};
  for (const b of page.blocks) { const n = (seen[b.type] = (seen[b.type] ?? 0) + 1); out[b.id] = n === 1 ? b.type : `${b.type}-${n}`; }
  return out;
}

/* ---------------- CSS ---------------- */
const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+20A8, U+20B9, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';
const DEVA = 'U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+20A8, U+25CC, U+A830-A839, U+A8E0-A8FF';
export const fontFiles = (id: string) => [`/_jhino/fonts/s-${id}.woff2`];
export function fontFaces(ids: string[]) {
  let css = '';
  for (const id of [...new Set(ids)]) {
    const f = fontById(id);
    const w = f.weights[0] === f.weights[1] ? `${f.weights[0]}` : `${f.weights[0]} ${f.weights[1]}`;
    const s = f.stretch ? `;font-stretch:${f.stretch}` : '';
    css += `@font-face{font-family:"${f.family}";src:url(/_jhino/fonts/s-${f.id}.woff2) format("woff2");font-weight:${w}${s};font-display:swap;unicode-range:${LATIN}}`;
    css += `@font-face{font-family:"${f.family}";src:url(/_jhino/fonts/s-${f.id}-ext.woff2) format("woff2");font-weight:${w}${s};font-display:swap;unicode-range:${LATIN_EXT}}`;
    if (f.italic) css += `@font-face{font-family:"${f.family}";src:url(/_jhino/fonts/s-${f.id}-i.woff2) format("woff2");font-weight:${w};font-style:italic;font-display:swap;unicode-range:${LATIN}}`;
  }
  return css + `@font-face{font-family:"Site Deva";src:url(/_jhino/fonts/devanagari.woff2) format("woff2");font-weight:100 900;font-display:swap;unicode-range:${DEVA}}`;
}
const stack = (id: string) => { const f = fontById(id); return `"${f.family}","Site Deva",${f.fallback}`; };

/** The theme as CSS custom properties. Switching the theme restyles every block through these. */
export function themeCss(t: Theme): string {
  const d = fontById(t.display), b = fontById(t.body);
  const pad = { tight: [48, 80], even: [60, 100], airy: [68, 116] }[t.rhythm];
  const c = t.colors;
  const at = contrast(c.accent, c.bg) >= 4.5 ? c.accent : c.text;
  return fontFaces([t.display, t.body]) + `:root{--c-at:${at};--c-bg:${c.bg};--c-surface:${c.surface};--c-text:${c.text};--c-muted:${c.muted};--c-accent:${c.accent};--c-on:${c.onAccent};--c-line:${c.line};`
    + `--f-d:${stack(t.display)};--f-b:${stack(t.body)};--dw:${d.display.weight};--dt:${d.display.tracking};--dl:${d.display.lead};--ds:${d.display.stretch ?? '100%'};--bs:${b.stretch ? '100%' : 'normal'};`
    + `--r:${t.radius}px;--rb:${t.button === 'pill' ? '999px' : `${Math.min(t.radius, 14)}px`};--ri:${Math.min(t.radius, 18)}px;--u:${(8 * t.space).toFixed(2)}px;--pad0:${pad[0]}px;--pad1:${pad[1]}px;--ts:${t.scale ?? 1};`
    + `--bodysize:${b.kind === 'mono' ? '16px' : b.kind === 'serif' ? '18.5px' : '17.5px'};color-scheme:${lum(c.bg) < 0.4 ? 'dark' : 'light'};${PERSONA[t.preset] ?? PERSONA.roast}}`;
}
/*
 * Each theme's manner beyond colour and type: how panels and cards are drawn, how the menu is set and how the
 * header meets the page. Set as custom properties, so owners' colour changes still flow through.
 */
const PERSONA: Record<string, string> = {
  roast: '--card-bg:var(--surface);--card-bd:0;--card-sh:none;--nav-tt:none;--nav-ls:0;--nav-fs:.95rem;--nav-fw:500;--hdr-b:1px solid var(--line)',
  meridian: '--card-bg:var(--surface);--card-bd:0;--card-sh:none;--nav-tt:none;--nav-ls:0;--nav-fs:.96rem;--nav-fw:550;--hdr-b:0;--hdr-bg:var(--c-surface)',
  monolith: '--card-bg:transparent;--card-bd:0;--card-sh:inset 0 2px 0 var(--text);--nav-tt:uppercase;--nav-ls:.08em;--nav-fs:.78rem;--nav-fw:650;--hdr-b:1px solid var(--line)',
  salt: '--card-bg:transparent;--card-bd:0;--card-sh:inset 0 1px 0 var(--text);--nav-tt:none;--nav-ls:0;--nav-fs:.92rem;--nav-fw:500;--hdr-b:1px solid var(--c-text)',
  kora: '--card-bg:var(--bg);--card-bd:1px solid var(--line);--card-sh:0 22px 44px -32px rgba(0,0,0,.4);--nav-tt:uppercase;--nav-ls:.12em;--nav-fs:.74rem;--nav-fw:600;--hdr-b:1px solid var(--line)',
  summit: '--card-bg:var(--surface);--card-bd:0;--card-sh:inset 0 4px 0 var(--accent);--nav-tt:uppercase;--nav-ls:.05em;--nav-fs:.86rem;--nav-fw:700;--hdr-b:3px solid var(--c-text)',
  nocturne: '--card-bg:transparent;--card-bd:1px solid var(--line);--card-sh:none;--nav-tt:uppercase;--nav-ls:.16em;--nav-fs:.72rem;--nav-fw:500;--hdr-b:0',
  counsel: '--card-bg:var(--bg);--card-bd:1px solid var(--line);--card-sh:inset 0 2px 0 var(--text);--nav-tt:none;--nav-ls:0;--nav-fs:.95rem;--nav-fw:600;--hdr-b:3px double var(--line)',
  bloom: '--card-bg:var(--surface);--card-bd:0;--card-sh:none;--nav-tt:none;--nav-ls:0;--nav-fs:.97rem;--nav-fw:500;--hdr-b:0',
};
const PERSONA_CSS = `.site-h{border-bottom:var(--hdr-b)}.site-h:not(.over)::before{background:var(--hdr-bg,var(--bg))}.site-h.over{border-bottom:0}
.h-nav a:not(.btn){text-transform:var(--nav-tt);letter-spacing:var(--nav-ls);font-size:var(--nav-fs);font-weight:var(--nav-fw)}
:is(.pr-columns .pr-it:not(.pr-on),.cmp-card:not(.cmp-on),.pay-cards .pay-it,.cta-box,.nl-card,.map-card,.mn-compact .mn-sec,.q-car .q-it){background:var(--card-bg);border:var(--card-bd);box-shadow:var(--card-sh)}
.t-bloom .h-nav a:not(.btn){padding:8px 14px;border-radius:999px;background-image:none;transition:background-color .2s cubic-bezier(.2,.7,.1,1)}.t-bloom .h-nav ul{gap:4px}.t-bloom .h-nav a:not(.btn):hover,.t-bloom .h-nav a[aria-current]{background-color:var(--c-surface)}
.t-nocturne :is(.wk-m,.g-grid .g-m,.g-masonry .g-m,.tm-m,.it-media,.eq-m .rv,.vc-m,.qt-media){outline:1px solid var(--line);outline-offset:6px}
.t-summit .btn{text-transform:uppercase;letter-spacing:.04em;font-weight:700}
.t-monolith .sec-head .h2,.t-monolith .cta-h{letter-spacing:calc(var(--dt) - .01em)}
@media (max-width:759px){.site-h.open .h-nav a:not(.btn){text-transform:none;letter-spacing:0;font-size:1.4rem}.t-bloom .site-h.open .h-nav a:not(.btn){padding:8px 0;background:none}}`;
const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** Relative luminance of a #rrggbb colour (0 black to 1 white). */
function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

const EASE = 'cubic-bezier(.2,.7,.1,1)';
const BASE = `*,*::before,*::after{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;scrollbar-color:color-mix(in srgb,var(--c-text) 28%,transparent) var(--c-bg)}@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important;animation:none!important}}
body{margin:0;background:var(--c-bg);color:var(--c-text);font:var(--bodysize)/1.6 var(--f-b);font-stretch:var(--bs);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;font-optical-sizing:auto;caret-color:var(--c-accent)}
::selection{background:var(--c-accent);color:var(--c-on)}
img,video{display:block;max-width:100%}a{color:inherit;text-underline-offset:.2em;text-decoration-thickness:1px}p,h1,h2,h3,h4,figure,blockquote,dl,dd{margin:0}ul,ol{margin:0;padding:0}
:focus-visible{outline:2px solid var(--accent,var(--c-accent));outline-offset:3px}
.skip{position:absolute;left:12px;top:-60px;z-index:50;background:var(--c-text);color:var(--c-bg);padding:10px 14px;border-radius:var(--rb);text-decoration:none}.skip:focus{top:12px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.blk{--bg:var(--c-bg);--surface:var(--c-surface);--text:var(--c-text);--muted:var(--c-muted);--accent:var(--c-accent);--on:var(--c-on);--line:var(--c-line);--at:var(--c-at);--k:1;background:var(--bg);color:var(--text);padding:calc(var(--pad0)*var(--k)) 0;position:relative}
@media (min-width:900px){.blk{padding:calc(var(--pad1)*var(--k)) 0}}
.sp-s{--k:.55}.sp-l{--k:1.4}
.bg-surface{--bg:var(--c-surface);--surface:var(--c-bg)}.bg-accent{--at:var(--c-on)}.bg-ink{--at:var(--c-bg)}
.bg-accent{--bg:var(--c-accent);--text:var(--c-on);--muted:color-mix(in srgb,var(--c-on) 84%,var(--c-accent));--accent:var(--c-on);--on:var(--c-accent);--line:color-mix(in srgb,var(--c-on) 28%,var(--c-accent));--surface:color-mix(in srgb,var(--c-on) 10%,var(--c-accent))}
.bg-ink{--bg:var(--c-text);--text:var(--c-bg);--muted:color-mix(in srgb,var(--c-bg) 72%,var(--c-text));--line:color-mix(in srgb,var(--c-bg) 18%,var(--c-text));--surface:color-mix(in srgb,var(--c-bg) 7%,var(--c-text));--accent:color-mix(in srgb,var(--c-accent) 45%,var(--c-bg))}
.bg-ink .btn-p{background:var(--c-bg);color:var(--c-text);border-color:var(--c-bg)}.bg-ink .btn-p:hover{background:color-mix(in srgb,var(--c-bg) 86%,var(--c-text))}
@media (max-width:759px){.hide-mobile{display:none!important}}@media (min-width:760px){.hide-desktop{display:none!important}}
:root{--gut:20px;--maxw:1320px}@media (min-width:760px){:root{--gut:40px}}@media (min-width:1200px){:root{--gut:56px}}
.wrap{width:min(100% - var(--gut)*2,var(--maxw));margin-inline:auto}
.rt-narrow{max-width:760px}
h1,h2,h3,h4,.f-big,.brand-name,.f-headline,.qt-text,.mq,.st-v,.sp-n,.pr-name,.pq-q,.q-text,.f-name{font-family:var(--f-d);font-weight:var(--dw);letter-spacing:var(--dt);line-height:var(--dl);font-stretch:var(--ds);text-wrap:balance}
body.caps h1,body.caps h2,body.caps .h3,body.caps .f-big,body.caps .brand-name,body.caps .f-headline,body.caps .mq{text-transform:uppercase}
.h1{font-size:clamp(2.6rem,calc((1.1rem + 5.4vw)*var(--ts)),6rem)}
.h2{font-size:clamp(2rem,calc((1.05rem + 2.7vw)*var(--ts)),3.9rem)}
.h3{font-size:clamp(1.25rem,calc((1rem + .75vw)*var(--ts)),1.75rem);line-height:1.15}
.sec-head{display:grid;gap:calc(var(--u)*2);margin-bottom:calc(var(--u)*6);max-width:880px}
@media (min-width:900px){.sec-head{margin-bottom:calc(var(--u)*9)}.sec-head.two:not(.one){max-width:none;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:calc(var(--u)*8);align-items:end}}
.sec-aside{display:grid;gap:calc(var(--u)*2);justify-items:start}.sec-h{margin-bottom:calc(var(--u)*5)}
.lede{font-size:clamp(1.08rem,1rem + .3vw,1.22rem);line-height:1.55;color:var(--muted);max-width:58ch;text-wrap:pretty}
.cap{font-size:.875rem;color:var(--muted);margin-top:calc(var(--u)*1.5)}
.acts{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5em;min-height:50px;padding:0 1.5em;border-radius:var(--rb);font:600 .98rem/1.1 var(--f-b);letter-spacing:.005em;text-decoration:none;border:1.5px solid transparent;transition:background-color .2s ${EASE},color .2s ${EASE},border-color .2s ${EASE},transform .2s ${EASE};cursor:pointer;white-space:nowrap}
.btn:active{transform:translateY(1px)}
.btn-p{background:var(--accent);color:var(--on);border-color:var(--accent)}.btn-p:hover{background:color-mix(in srgb,var(--accent) 84%,var(--text));border-color:color-mix(in srgb,var(--accent) 84%,var(--text))}
.btn-s{border-color:color-mix(in srgb,currentColor 40%,transparent);color:var(--text);background:transparent}.btn-s:hover{border-color:currentColor;background:color-mix(in srgb,currentColor 6%,transparent)}
body.bs-outline .btn-p{background:transparent;color:var(--text);border-color:var(--text)}body.bs-outline .btn-p:hover{background:var(--text);color:var(--bg)}
body.bs-underline .btn{min-height:44px;padding:0 0 3px;border:0;border-bottom:2px solid var(--text);border-radius:0;background:none;color:var(--text)}body.bs-underline .btn-s{border-bottom-color:var(--line)}body.bs-underline .btn:hover{border-bottom-color:var(--accent);background:none}
body.bs-underline .acts{gap:32px}
.tlink{display:inline-flex;align-items:center;gap:.45em;font-weight:600;text-decoration:none;border-bottom:1.5px solid var(--line);padding-bottom:3px;transition:border-color .2s ${EASE}}.tlink:hover{border-color:currentColor}.tlink .ic{width:1em;height:1em;transition:transform .25s ${EASE}}.tlink:hover .ic{transform:translateX(3px)}
.ic{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex:none}
.prose{display:grid;gap:1em;max-width:66ch;text-wrap:pretty}.prose ul,.prose ol{padding-left:1.25em;display:grid;gap:.35em}.prose h3{font-size:1.3rem;margin-top:.5em}.prose a{color:var(--at);text-decoration-thickness:1.5px}.bg-accent .prose a,.bg-ink .prose a{color:inherit}
figure img{width:100%}
.ph-img{display:grid;place-items:center;min-height:180px;background:repeating-linear-gradient(135deg,var(--surface) 0 12px,color-mix(in srgb,var(--surface) 70%,var(--bg)) 12px 24px);color:var(--muted);font-size:.9rem;border-radius:var(--ri)}
.ph-img span{background:var(--bg);padding:6px 10px;border-radius:var(--rb)}
.rv{position:relative;overflow:hidden;border-radius:var(--ri)}
.rv>img{transition:transform 1.3s ${EASE}}
@media (scripting:enabled) and (prefers-reduced-motion:no-preference){
html:not([data-edit]):not([data-preview]) .rv::after{content:"";position:absolute;inset:-1px;background:var(--bg);transform-origin:50% 0;transform:scaleY(1);transition:transform .95s cubic-bezier(.76,0,.2,1);pointer-events:none;animation:rv-safe .01s 2.6s both}
html:not([data-edit]):not([data-preview]) .rv>img{transform:scale(1.08)}
html.rv-js .rv::after{animation:none}
html .rv.in::after{transform:scaleY(0)}html .rv.in>img{transform:none}}
html .rv.shown::after{content:none}
@keyframes rv-safe{to{transform:scaleY(0)}}
@media print{.rv::after{display:none!important}.rv>img{transform:none!important}}
`;
const CSS: Record<string, string> = {
  header: `.site-h{--k:0;padding:0;z-index:30;border-bottom:1px solid var(--line)}.site-h.sticky{position:sticky;top:0}
.h-in{display:flex;align-items:center;gap:28px;min-height:76px}.brand{display:flex;align-items:center;text-decoration:none;margin-right:auto;min-height:44px}.brand .logo{height:40px;width:auto}.brand-name{font-size:clamp(1.3rem,1.1rem + .5vw,1.6rem);line-height:1}
.h-nav ul{list-style:none;display:flex;gap:30px;flex-wrap:wrap;align-items:center}.h-nav a:not(.btn){text-decoration:none;font-weight:500;font-size:.95rem;padding:10px 0;display:inline-block;background:linear-gradient(currentColor,currentColor) 0 calc(100% - 6px)/0 1.5px no-repeat;transition:background-size .25s ${EASE}}.h-nav a:not(.btn):hover,.h-nav a[aria-current]{background-size:100% 1.5px}
.h-cta{min-height:44px;padding:0 1.2em;font-size:.92rem}
.nav-t{display:none;align-items:center;gap:8px;min-height:44px;padding:0 14px;border:1px solid color-mix(in srgb,currentColor 35%,transparent);border-radius:var(--rb);background:transparent;color:inherit;font:600 .95rem var(--f-b);cursor:pointer}
.nav-i,.nav-i::before{display:block;width:16px;height:1.5px;background:currentColor;position:relative}.nav-i::before{content:"";position:absolute;top:5px}.nav-i{top:-2.5px}
.v-centered .h-in{flex-direction:column;gap:6px;padding:14px 0}.v-centered .brand{margin:0}@media (min-width:760px){.v-centered .h-in{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);grid-template-areas:'brand brand brand' '. nav cta';align-items:center;row-gap:8px}.v-centered .brand{grid-area:brand;justify-self:center}.v-centered .h-nav{grid-area:nav;justify-self:center}.v-centered .h-cta{grid-area:cta;justify-self:end}}
.nav-cta{display:none}html:not(.js) .nav-cta{display:none!important}
.site-h::before{content:"";position:absolute;inset:0;background:var(--bg);z-index:-1}
.site-h.over{position:absolute;left:0;right:0;top:0;border-bottom-color:transparent;--text:#fff;color:#fff;background:transparent}.site-h.over.sticky{position:fixed}.site-h.over::before{opacity:0;transition:opacity .3s ${EASE};border-bottom:1px solid var(--line)}
.site-h.over .btn-p{background:#fff;color:#111;border-color:#fff}.site-h.over .btn-p:hover{background:rgba(255,255,255,.86)}
.site-h.over.scrolled{--text:var(--c-text);color:var(--c-text)}.site-h.over.scrolled::before{opacity:1}.site-h.over.scrolled .btn-p{background:var(--accent);color:var(--on);border-color:var(--accent)}
html[data-edit] .site-h.over{position:absolute}
@media (max-width:759px){html.js .h-cta{display:none}html.js .nav-cta{display:block;padding-top:14px}html.js .nav-cta .btn{text-decoration:none;background-image:none}html.js .nav-t{display:inline-flex}html.js .h-nav ul{display:none}.h-in{flex-wrap:wrap;min-height:64px}.site-h.open .h-nav ul{display:flex;flex-direction:column;align-items:flex-start;gap:0;width:100%;padding:8px 0 20px}.site-h.open .h-nav a{font-size:1.4rem;font-family:var(--f-d)}.site-h.open .h-nav{order:5;width:100%}.site-h.over.open{--text:var(--c-text);color:var(--c-text)}.site-h.over.open::before{opacity:1}.v-centered .h-in{flex-direction:row}.v-centered .brand{margin-right:auto}}
html.js .v-minimal .nav-t{display:inline-flex}html.js .v-minimal .h-nav ul{display:none}.v-minimal.open .h-nav ul{display:flex;flex-direction:column;position:absolute;right:max(var(--gut),calc((100% - var(--maxw))/2));top:100%;background:var(--c-bg);color:var(--c-text);border:1px solid var(--line);border-radius:var(--r);padding:12px 22px;min-width:240px;gap:0}.v-minimal .h-in{position:relative}.v-minimal{position:relative}`,
  hero: `.b-hero .h1{max-width:13ch}.b-hero .lede{max-width:46ch}.h-meta{font-size:.9rem;color:var(--muted);margin-top:calc(var(--u)*3)}
.hero-t{display:grid;gap:calc(var(--u)*5);padding-top:calc(var(--u)*4)}.hero-t .h1{max-width:16ch;font-size:clamp(2.5rem,calc((1rem + 6.4vw)*var(--ts)),6rem)}.hero-t-side{display:grid;gap:calc(var(--u)*3.5);justify-items:start}
@media (min-width:900px){.hero-t-side{grid-template-columns:minmax(0,1fr);margin-left:calc(100% * 5 / 12);max-width:620px}}
.b-hero.v-split{padding-top:0;padding-bottom:0}
.hero-s{display:grid}.hero-copy{display:grid;gap:calc(var(--u)*3.5);align-content:end;justify-items:start;padding:calc(var(--pad0)*.8) var(--gut) calc(var(--pad0)*.9)}
.hero-media{border-radius:0}.hero-media img,.hero-media .ph-img{width:100%;height:100%;aspect-ratio:4/5;object-fit:cover;border-radius:0}
@media (min-width:900px){.hero-s{grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:min(92vh,940px)}.hero-copy{padding:calc(var(--u)*10) calc(var(--u)*7) calc(var(--u)*10) max(var(--gut),calc((100vw - var(--maxw))/2));align-content:center}.hero-media img,.hero-media .ph-img{aspect-ratio:auto;min-height:100%}}
.hero-k{display:grid;gap:calc(var(--u)*5);padding-bottom:calc(var(--u)*7)}.hero-k .h1{max-width:18ch;font-size:clamp(2.35rem,calc((1rem + 6.2vw)*var(--ts)),6rem)}
.hero-k-row{display:grid;gap:calc(var(--u)*3.5);align-items:end}@media (min-width:900px){.hero-k-row{grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:calc(var(--u)*8)}}
.hero-k-media{border-radius:0;margin-inline:0}.hero-k-media img,.hero-k-media .ph-img{width:100%;aspect-ratio:21/9;object-fit:cover;border-radius:0}@media (max-width:759px){.hero-k-media img,.hero-k-media .ph-img{aspect-ratio:4/3}}
.b-hero.v-image,.b-hero.v-video{min-height:100svh;display:flex;align-items:flex-end;overflow:hidden;--text:#fff;--muted:rgba(255,255,255,.88);--line:rgba(255,255,255,.35);--accent:var(--c-accent);color:#fff;background:#141414;padding-bottom:calc(var(--u)*6)}
@media (min-width:900px){.b-hero.v-image,.b-hero.v-video{padding-bottom:calc(var(--u)*9)}}
.hero-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;animation:hero-in 1.8s ${EASE} both}@keyframes hero-in{from{transform:scale(1.06)}to{transform:none}}html[data-edit] .hero-bg{animation:none}
.hero-scrim{position:absolute;inset:0;background:linear-gradient(to top,rgba(8,8,8,.78) 0%,rgba(8,8,8,.42) 38%,rgba(8,8,8,.1) 68%,rgba(8,8,8,.42) 100%)}
.hero-over{position:relative;display:grid;gap:calc(var(--u)*4)}.hero-over .h1{max-width:15ch;text-shadow:0 1px 24px rgba(0,0,0,.18)}.hero-over-row{display:grid;gap:calc(var(--u)*3);align-items:end}@media (min-width:900px){.hero-over-row{grid-template-columns:minmax(0,6fr) minmax(0,5fr);gap:calc(var(--u)*8)}.hero-over-row>div{justify-self:end;text-align:right}.hero-over-row .acts{justify-content:flex-end}}
.b-hero.v-image .btn-p,.b-hero.v-video .btn-p{background:#fff;color:#111;border-color:#fff}.b-hero.v-image .btn-p:hover,.b-hero.v-video .btn-p:hover{background:rgba(255,255,255,.85)}.b-hero.v-image .btn-s,.b-hero.v-video .btn-s{color:#fff;border-color:rgba(255,255,255,.6)}
body.bs-underline .b-hero.v-image .btn,body.bs-underline .b-hero.v-video .btn{background:none;color:#fff;border-bottom-color:#fff}
.b-hero.v-image .ph-img.hero-bg,.b-hero.v-video .ph-img.hero-bg{border-radius:0;animation:none}`,
  footer: `.site-f{--k:.75;font-size:.95rem;border-top:1px solid var(--line)}.site-f ul{list-style:none;display:grid;gap:8px}.site-f a{text-decoration:none}.site-f a:hover{text-decoration:underline}
.f-cols{display:grid;gap:32px}@media (min-width:760px){.f-cols{grid-template-columns:2fr 1fr 1.2fr}}.f-name{font-size:1.5rem;margin-bottom:10px}.f-about{color:var(--muted);max-width:42ch}
.f-h{font-size:.8rem;font-weight:600;color:var(--muted);margin-bottom:12px}.f-social{margin-top:14px}.f-social,.f-simple ul{display:flex!important;flex-wrap:wrap;gap:6px 18px!important}
.f-note{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}
.f-simple{display:flex;flex-wrap:wrap;gap:12px 28px;align-items:baseline}.f-simple .f-name{font-size:1.15rem;margin:0}.f-simple .f-note{margin:0 0 0 auto;padding:0;border:0}
.f-big{font-size:clamp(3rem,11vw,10rem);line-height:.9;margin-bottom:40px;overflow-wrap:anywhere}.f-row{display:grid;gap:24px}@media (min-width:760px){.f-row{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}}
.v-rich{--k:1;padding-bottom:calc(var(--u)*5)!important}.f-top{display:grid;gap:calc(var(--u)*4);align-items:end;padding-bottom:calc(var(--u)*8);margin-bottom:calc(var(--u)*7);border-bottom:1px solid var(--line)}@media (min-width:900px){.f-top{grid-template-columns:minmax(0,1fr) auto;gap:calc(var(--u)*8)}}
.f-headline{font-size:clamp(2.4rem,calc((1rem + 4.4vw)*var(--ts)),5.2rem);max-width:16ch}
.f-grid{display:grid;gap:36px 28px;grid-template-columns:1fr 1fr}.f-brand{grid-column:1/-1}@media (min-width:900px){.f-grid{grid-template-columns:minmax(0,4fr) repeat(4,minmax(0,2fr));gap:40px}.f-brand{grid-column:auto;padding-right:24px}}
.f-hours li,.f-contact li{color:var(--text)}.f-hours{color:var(--muted);white-space:pre-line}`,
  richtext: `.rt-split{display:grid;gap:calc(var(--u)*3)}@media (min-width:900px){.rt-split{grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:calc(var(--u)*8)}}.rt-narrow .h2,.rt-wide .h2{margin-bottom:calc(var(--u)*4)}.rt-wide .prose{max-width:none;columns:2 320px;column-gap:56px;display:block}.rt-wide .prose>*{margin-bottom:1em;break-inside:avoid}.rt-split .prose{font-size:1.06rem}`,
  image: `.img-c img,.img-framed img{width:100%;max-height:86vh;object-fit:cover}.img-full .rv{border-radius:0}.img-full img{width:100%;max-height:92vh;object-fit:cover}
.img-framed{display:grid;gap:18px}@media (min-width:900px){.img-framed{grid-template-columns:minmax(0,8fr) minmax(0,3fr);gap:40px;align-items:end}}`,
  imagetext: `.it{display:grid;gap:calc(var(--u)*5);align-items:center}@media (min-width:900px){.it-left{grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:calc(var(--u)*10)}.it-right{grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:calc(var(--u)*10)}}
.it-media img,.it-media .ph-img{width:100%;aspect-ratio:4/5;object-fit:cover}@media (min-width:900px){.it-media img,.it-media .ph-img{aspect-ratio:1/1.08}}.it-copy{display:grid;gap:calc(var(--u)*3);align-content:center;justify-items:start}.it-meta{font-size:.9rem;color:var(--muted)}.it-stacked{max-width:980px}.it-stacked .it-media img{aspect-ratio:16/10}`,
  rows: `.rw{list-style:none;display:grid;gap:calc(var(--u)*9)}@media (min-width:900px){.rw{gap:calc(var(--u)*16)}}
.rw-it{display:grid;gap:calc(var(--u)*3.5);align-items:center}.rw-media img,.rw-media .ph-img{width:100%;aspect-ratio:5/4;object-fit:cover}.rw-copy{display:grid;gap:calc(var(--u)*2.5);justify-items:start;max-width:520px}.rw-t{font-size:clamp(1.6rem,calc((1rem + 1.8vw)*var(--ts)),2.7rem);line-height:1.08}.rw-x{color:var(--muted);font-size:1.06rem;text-wrap:pretty}
@media (min-width:900px){.rw-alternate .rw-it{grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:calc(var(--u)*10)}.rw-alternate .rw-it:nth-child(even) .rw-media{order:2}.rw-alternate .rw-it:nth-child(even){grid-template-columns:minmax(0,5fr) minmax(0,7fr)}.rw-alternate .rw-it:nth-child(even) .rw-copy{justify-self:end}}
.rw-large .rw-media img,.rw-large .rw-media .ph-img{aspect-ratio:16/9}@media (min-width:900px){.rw-large .rw-copy{max-width:none;grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:calc(var(--u)*8);align-items:start}.rw-large .rw-copy .tlink{grid-column:2}}`,
  sticky: `.sk{display:grid;gap:calc(var(--u)*6)}.sk-media{align-self:stretch}.sk-pin img,.sk-pin .ph-img{width:100%;aspect-ratio:4/5;object-fit:cover}
.sk-copy{display:grid;gap:calc(var(--u)*3);align-content:start}.sk-list{list-style:none;display:grid;margin-top:calc(var(--u)*4)}.sk-it{display:grid;gap:12px;padding:calc(var(--u)*4) 0;border-top:1px solid var(--line)}.sk-l{font-size:.85rem;font-weight:600;color:var(--at);font-variant-numeric:lining-nums proportional-nums}.sk-t{font-size:clamp(1.4rem,calc((1rem + 1.2vw)*var(--ts)),2.1rem)}.sk-x{color:var(--muted);max-width:52ch;text-wrap:pretty}
@media (min-width:900px){.sk{grid-template-columns:minmax(0,6fr) minmax(0,5fr);gap:calc(var(--u)*10);align-items:start}.sk-right{grid-template-columns:minmax(0,5fr) minmax(0,6fr)}.sk-pin{position:sticky;top:110px}.sk-pin img,.sk-pin .ph-img{aspect-ratio:auto;height:calc(100vh - 150px);max-height:860px}.sk-it{padding:calc(var(--u)*6) 0;min-height:26vh;align-content:start}.sk-it:last-child{min-height:0}}
html[data-edit] .sk-pin{position:relative;top:0}`,
  quote: `.qt-fig{display:grid;gap:calc(var(--u)*4)}.qt-large{display:grid;justify-items:center}.qt-large .qt-fig{max-width:min(100%,1040px)}.qt-text{font-size:clamp(1.9rem,calc((1rem + 2.9vw)*var(--ts)),4.2rem);line-height:1.08;max-width:24ch;text-wrap:balance}.qt-large .qt-text::before{content:"\\201C";display:block;color:var(--at);font-size:1.6em;line-height:.6;margin-bottom:.12em}
.qt-who{display:grid;gap:2px;padding-left:56px;position:relative}.qt-who::before{content:"";position:absolute;left:0;top:.75em;width:40px;height:1.5px;background:currentColor}.qt-name{font-weight:650}.qt-detail{color:var(--muted);font-size:.95rem}
.qt-img{display:grid;gap:calc(var(--u)*5);align-items:center}.qt-media img,.qt-media .ph-img{width:100%;aspect-ratio:4/5;object-fit:cover}.qt-img .qt-text{font-size:clamp(1.7rem,calc((1rem + 2.1vw)*var(--ts)),3.3rem)}@media (min-width:900px){.qt-img{grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:calc(var(--u)*10)}}`,
  marquee: `.b-marquee{padding:calc(var(--u)*4*var(--k)) 0;overflow:hidden}.mq{overflow:hidden;font-size:clamp(2.6rem,calc((1rem + 5vw)*var(--ts)),6rem);line-height:1.1;white-space:nowrap}.v-small .mq{font-size:clamp(1.2rem,1rem + 1vw,1.7rem);font-family:var(--f-b);font-weight:600;letter-spacing:0;font-stretch:var(--bs)}
.mq-track{display:flex;width:max-content;animation:mq 46s linear infinite}.v-small .mq-track{animation-duration:32s}.mq:hover .mq-track{animation-play-state:paused}.mq-run{list-style:none;display:flex;flex:none}.mq-run li{display:flex;align-items:center}
.mq-sep{display:inline-block;width:.28em;height:.28em;border-radius:50%;background:var(--accent);margin:0 .7em;flex:none}.bg-accent .mq-sep{background:currentColor}
@keyframes mq{to{transform:translateX(-50%)}}html[data-edit] .mq-track{animation:none}
@media (prefers-reduced-motion:reduce){.mq{white-space:normal}.mq-track{width:auto;flex-wrap:wrap}.mq-run[aria-hidden="true"]{display:none}.mq-run{flex-wrap:wrap}}`,
  gallery: `.g-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}@media (min-width:900px){.g-grid{grid-template-columns:repeat(3,1fr);gap:20px}}.g-grid img,.g-grid .ph-img{aspect-ratio:4/5;object-fit:cover}
.g-masonry{columns:2 200px;column-gap:12px}@media (min-width:900px){.g-masonry{columns:3;column-gap:20px}}.g-masonry .g-it{break-inside:avoid;margin-bottom:20px}
.g-bento{display:grid;grid-template-columns:repeat(2,1fr);grid-auto-rows:clamp(150px,34vw,260px);gap:10px;grid-auto-flow:dense}.g-bento .g-it{position:relative;min-height:0}.g-bento .g-m{height:100%}.g-bento img,.g-bento .ph-img{width:100%;height:100%;object-fit:cover}
.g-bento .g-it:nth-child(5n+1){grid-column:span 2;grid-row:span 2}
@media (min-width:900px){.g-bento{grid-template-columns:repeat(12,1fr);grid-auto-rows:clamp(180px,17vw,270px);gap:16px}.g-bento .g-it{grid-column:span 5}.g-bento .g-it:nth-child(5n+1){grid-column:span 7;grid-row:span 2}.g-bento .g-it:nth-child(5n+4){grid-column:span 5}.g-bento .g-it:nth-child(5n){grid-column:span 7}}
.g-bento .cap{position:absolute;left:12px;bottom:12px;margin:0;padding:6px 10px;background:rgba(10,10,10,.62);color:#fff;border-radius:calc(var(--ri)/2);font-size:.8rem;max-width:calc(100% - 24px);z-index:2}
.g-feed{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}@media (min-width:900px){.g-feed{grid-template-columns:repeat(4,1fr);gap:8px}}.g-feed .g-m{border-radius:calc(var(--ri)/2)}.g-feed img,.g-feed .ph-img{aspect-ratio:1;object-fit:cover}.g-feed img{transition:transform .5s ${EASE}}.g-feed .g-it:hover img{transform:scale(1.04)}
.g-more{margin-top:calc(var(--u)*5)}
.car-track{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;padding:0 max(var(--gut),calc((100% - var(--maxw))/2));scroll-padding:0 max(var(--gut),calc((100% - var(--maxw))/2))}.car-track::-webkit-scrollbar{display:none}
.car-track>*{flex:0 0 min(84%,620px);scroll-snap-align:start}.car-track img,.car-track .ph-img{aspect-ratio:4/3;object-fit:cover}
.car-nav{display:flex;gap:10px;justify-content:flex-end;margin-top:20px}.car-nav button{width:52px;height:52px;display:grid;place-items:center;border-radius:50%;border:1px solid var(--line);background:transparent;color:inherit;cursor:pointer;transition:border-color .2s ${EASE},background-color .2s ${EASE}}.car-nav button:hover{border-color:currentColor;background:var(--surface)}html:not(.js) .car-nav{display:none}`,
  video: `.vid{position:relative;display:block;aspect-ratio:16/9;background:#111;border-radius:var(--ri);overflow:hidden;color:#fff;text-decoration:none}.vid img{width:100%;height:100%;object-fit:cover;opacity:.9}
.vid-play{position:absolute;left:20px;bottom:20px;display:flex;align-items:center;gap:12px;font-weight:600;background:rgba(0,0,0,.62);padding:10px 16px 10px 12px;border-radius:var(--rb)}.vid-play span{width:0;height:0;border-left:12px solid #fff;border-top:8px solid transparent;border-bottom:8px solid transparent}
.vid:hover .vid-play{background:#000}iframe.vid,.b-video iframe{width:100%;aspect-ratio:16/9;border:0;border-radius:var(--ri)}.vid-empty{display:grid;place-items:center;color:#bbb;font-size:.9rem}
.vid-narrow{max-width:880px}.vid-split{display:grid;gap:32px;align-items:center}@media (min-width:900px){.vid-split{grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:72px}}.vid-split .lede{margin-top:16px}`,
  features: `.ft{list-style:none}.ft-rows .ft-it{display:grid;grid-template-columns:1fr auto;gap:8px 32px;padding:calc(var(--u)*3.5) 0;border-top:1px solid var(--line);align-items:baseline}.ft-rows .ft-it:last-child{border-bottom:1px solid var(--line)}
@media (min-width:900px){.ft-rows .ft-main{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:40px;align-items:baseline}}.ft-main{display:grid;gap:10px}.ft-t{color:var(--muted);max-width:56ch}.ft-d{font-weight:600;white-space:nowrap;font-variant-numeric:lining-nums proportional-nums}
.ft-grid{display:grid;gap:calc(var(--u)*6) calc(var(--u)*6)}@media (min-width:760px){.ft-grid{grid-template-columns:1fr 1fr}}@media (min-width:1100px){.ft-grid{grid-template-columns:repeat(3,1fr)}}.ft-grid .ft-it{display:grid;gap:12px;align-content:start;padding-top:calc(var(--u)*3);border-top:1px solid var(--text)}.ft-grid .ft-d{color:var(--muted);font-weight:500}
.ft-compact{display:grid;gap:0;max-width:900px}.ft-compact .ft-it{display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding:16px 0;border-bottom:1px solid var(--line)}.ft-compact .h3{font-size:1.12rem;font-family:var(--f-b);font-weight:600;letter-spacing:0;font-stretch:var(--bs)}.ft-compact .ft-t{font-size:.95rem}`,
  steps: `.sp{list-style:none;counter-reset:none}.sp-n{display:block;font-size:clamp(2.6rem,calc((1rem + 3vw)*var(--ts)),4.4rem);line-height:.9;color:var(--at);font-variant-numeric:lining-nums proportional-nums}.sp-b{display:grid;gap:12px;align-content:start}.sp-x{color:var(--muted);text-wrap:pretty}.sp-d{font-size:.88rem;font-weight:600}
.sp-columns{display:grid;gap:calc(var(--u)*5)}@media (min-width:760px){.sp-columns{grid-template-columns:repeat(2,1fr)}}@media (min-width:1100px){.sp-columns{grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:calc(var(--u)*5)}}.sp-columns .sp-it{display:grid;gap:calc(var(--u)*3);padding-top:calc(var(--u)*3);border-top:1px solid var(--line);align-content:start}
.sp-stack .sp-it{display:grid;gap:16px;padding:calc(var(--u)*5) 0;border-top:1px solid var(--line)}.sp-stack .sp-it:last-child{border-bottom:1px solid var(--line)}@media (min-width:900px){.sp-stack .sp-it{grid-template-columns:minmax(0,4fr) minmax(0,8fr);gap:calc(var(--u)*8);align-items:start}.sp-stack .sp-n{font-size:clamp(4rem,calc((1rem + 5vw)*var(--ts)),6rem)}.sp-stack .sp-b{grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:12px 40px}.sp-stack .sp-d{grid-column:2}}`,
  work: `.wk{list-style:none;display:grid;gap:calc(var(--u)*7) calc(var(--u)*4)}.wk-a{display:block;text-decoration:none;color:inherit}.wk-m img,.wk-m .ph-img{width:100%;aspect-ratio:4/3;object-fit:cover}.wk-m img{transition:transform .7s ${EASE}}.wk-a:hover .wk-m img,.wk-a:focus-visible .wk-m img{transform:scale(1.035)}
.wk-b{display:grid;gap:8px;padding-top:calc(var(--u)*2.5)}.wk-h{display:flex;justify-content:space-between;align-items:baseline;gap:16px}.wk-t{font-size:clamp(1.3rem,calc((1rem + .9vw)*var(--ts)),1.9rem)}.wk-tag{font-size:.88rem;color:var(--muted);white-space:nowrap}.wk-x{color:var(--muted);max-width:52ch}
.wk-a .wk-t{background:linear-gradient(currentColor,currentColor) 0 100%/0 1.5px no-repeat;transition:background-size .35s ${EASE}}.wk-a:hover .wk-t{background-size:100% 1.5px}
@media (min-width:900px){.wk-grid{grid-template-columns:1fr 1fr;gap:calc(var(--u)*10) calc(var(--u)*5)}.wk-grid .wk-it:nth-child(even){margin-top:calc(var(--u)*14)}.wk-feature{grid-template-columns:1fr 1fr;gap:calc(var(--u)*9) calc(var(--u)*5)}.wk-feature .wk-it:first-child{grid-column:1/-1}.wk-feature .wk-it:first-child .wk-m img,.wk-feature .wk-it:first-child .wk-m .ph-img{aspect-ratio:16/8}}
.wk-list{gap:0}.wk-list .wk-it{border-top:1px solid var(--line)}.wk-list .wk-it:last-child{border-bottom:1px solid var(--line)}.wk-list .wk-a,.wk-list .wk-it>.wk-m+.wk-b{display:block}.wk-list .wk-a,.wk-list .wk-it:not(:has(.wk-a)){display:grid;grid-template-columns:96px 1fr;gap:20px;align-items:center;padding:18px 0}.wk-list .wk-b{padding:0}
@media (min-width:900px){.wk-list .wk-a,.wk-list .wk-it:not(:has(.wk-a)){grid-template-columns:200px 1fr;gap:40px;padding:22px 0}.wk-list .wk-b{grid-template-columns:minmax(0,5fr) minmax(0,6fr);align-items:baseline;gap:40px}}
.wk-list .wk-a:hover{background:linear-gradient(var(--surface),var(--surface))}`,
  press: `.pl{list-style:none}.pl-it{display:grid;grid-template-columns:1fr auto;gap:6px 24px;align-items:baseline;padding:calc(var(--u)*3) 0;border-top:1px solid var(--line)}.pl-it:last-child{border-bottom:1px solid var(--line)}.pr-name{font-size:clamp(1.3rem,1rem + 1vw,1.9rem)}.pl-d{color:var(--muted);grid-column:1}
@media (min-width:900px){.pl-it{grid-template-columns:minmax(0,4fr) minmax(0,7fr) auto;gap:40px}.pl-d{grid-column:auto}}
.pr-go{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;border:1px solid var(--line);color:inherit;transition:border-color .2s ${EASE},transform .25s ${EASE}}.pr-go:hover{border-color:currentColor;transform:translate(2px,-2px)}.pl-it .pr-go{grid-row:1/3;grid-column:2}@media (min-width:900px){.pl-it .pr-go{grid-row:auto;grid-column:auto}}
.pq{list-style:none;display:grid;gap:calc(var(--u)*6)}@media (min-width:900px){.pq{grid-template-columns:repeat(3,1fr);gap:calc(var(--u)*5)}}.pq-it{display:grid;gap:calc(var(--u)*3);align-content:space-between;padding-top:calc(var(--u)*3);border-top:1px solid var(--text)}.pq-q{font-size:clamp(1.25rem,1rem + .8vw,1.65rem);line-height:1.25;text-wrap:pretty}.pq-by{display:grid;grid-template-columns:1fr auto;gap:2px 16px;align-items:center}.pq-by .pr-name{font-family:var(--f-b);font-size:1rem;font-weight:650;letter-spacing:0;font-stretch:var(--bs)}.pq-d{color:var(--muted);font-size:.9rem;grid-column:1}.pq-by .pr-go{grid-row:1/3;grid-column:2}`,
  pricing: `.pr{list-style:none}.pr-columns{display:grid;gap:16px}@media (min-width:760px){.pr-columns{grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}}
.pr-columns .pr-it{display:flex;flex-direction:column;gap:22px;padding:calc(var(--u)*4);border:1px solid var(--line);border-radius:var(--r)}.pr-columns .pr-it .btn{margin-top:auto;align-self:flex-start}
.pr-on{background:var(--text);color:var(--bg);border-color:var(--text)!important;--muted:color-mix(in srgb,var(--bg) 72%,var(--text));--line:color-mix(in srgb,var(--bg) 22%,var(--text))}.pr-on .btn-p{background:var(--bg);color:var(--text);border-color:var(--bg)}
.pr-top{display:grid;gap:8px}.pr-price b{font-family:var(--f-d);font-weight:var(--dw);font-size:2.2rem;letter-spacing:var(--dt);font-variant-numeric:lining-nums proportional-nums}.pr-price span,.pr-note{color:var(--muted)}
.pr-f{list-style:none;display:grid;gap:8px;font-size:.96rem}.pr-f li{padding-left:20px;position:relative}.pr-f li::before{content:"";position:absolute;left:0;top:.72em;width:9px;height:1.5px;background:var(--accent)}.pr-on .pr-f li::before{background:currentColor}
.pr-table .pr-it,.pr-list .pr-it{display:grid;gap:12px;padding:calc(var(--u)*3.5) 0;border-top:1px solid var(--line)}@media (min-width:760px){.pr-table .pr-it{grid-template-columns:minmax(0,1.2fr) minmax(0,1.6fr) auto;align-items:start;gap:40px}}
.pr-table .pr-on,.pr-list .pr-on{background:none;color:inherit;--muted:var(--c-muted)}.pr-table .pr-on .h3::after,.pr-list .pr-on .h3::after{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-left:10px;vertical-align:middle}
.pr-list .pr-top{grid-template-columns:1fr auto;align-items:baseline}.pr-list .pr-f,.pr-list .btn{display:none}.pr-list .pr-price b{font-size:1.3rem}`,
  menu: `.mn{display:grid;gap:calc(var(--u)*8) calc(var(--u)*10)}@media (min-width:900px){.mn-columns,.mn-photo{grid-template-columns:1fr 1fr}.mn-compact{grid-template-columns:repeat(3,1fr);gap:calc(var(--u)*3)}}.mn-list{max-width:820px}
.mn-sec{display:grid;gap:16px;align-content:start}.mn-h{font-size:clamp(1.5rem,calc((1rem + 1.2vw)*var(--ts)),2.2rem);padding-bottom:14px;border-bottom:1px solid var(--text)}.mn-note{color:var(--muted);font-size:.93rem}.mn-sec ul{list-style:none;display:grid;gap:20px;margin-top:8px}
.mi{display:grid;gap:4px}.mi-has{grid-template-columns:88px 1fr;gap:18px;align-items:start}.mi-pic{border-radius:var(--ri);overflow:hidden}.mi-pic img,.mi-pic .ph-img{width:100%;aspect-ratio:1;object-fit:cover;min-height:0}.mi-body{display:grid;gap:4px}
.mi-row{display:flex;align-items:baseline;gap:10px}.mi-name{font:600 1.06rem/1.3 var(--f-b);letter-spacing:0;font-stretch:var(--bs)}.mi-dots{flex:1;border-bottom:1.5px dotted color-mix(in srgb,var(--text) 34%,transparent);transform:translateY(-4px);min-width:16px}
.mi-price{font-weight:600;font-variant-numeric:lining-nums proportional-nums;white-space:nowrap}.mi-tag{font-size:.72rem;font-weight:600;color:var(--at);border:1px solid currentColor;border-radius:999px;padding:1px 8px;white-space:nowrap}.mi-desc{color:var(--muted);font-size:.94rem;max-width:52ch}
@media (min-width:900px){.mi-has{grid-template-columns:112px 1fr;gap:22px}.mn-photo .mi:not(.mi-has){padding-left:134px}}@media (max-width:899px){.mn-photo .mi:not(.mi-has){padding-left:106px}}
.mn-compact .mn-sec{padding:calc(var(--u)*3.5);background:var(--surface);border-radius:var(--r)}.mn-compact .mi-desc{display:none}`,
  team: `.tm{list-style:none;display:grid;gap:calc(var(--u)*6) calc(var(--u)*3)}.tm-grid{grid-template-columns:repeat(2,1fr)}@media (min-width:900px){.tm-grid{grid-template-columns:repeat(3,1fr);gap:calc(var(--u)*8) calc(var(--u)*4)}}
.tm-grid .tm-it{display:grid;gap:18px;align-content:start}.tm-img,.tm-m .ph-img{width:100%;aspect-ratio:4/5;object-fit:cover}.tm-b{display:grid;gap:4px}.tm-role{color:var(--muted);font-size:.95rem}.tm-bio{color:var(--muted);font-size:.95rem;margin-top:8px;max-width:48ch}
.tm-list{gap:0}.tm-list .tm-it{padding:calc(var(--u)*3) 0;border-top:1px solid var(--line)}.tm-list .tm-b{gap:4px}@media (min-width:760px){.tm-list .tm-b{grid-template-columns:minmax(0,4fr) minmax(0,3fr) minmax(0,5fr);gap:32px;align-items:baseline}.tm-list .tm-role,.tm-list .tm-bio{margin:0}}
.tm-monogram{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}.tm-monogram .tm-it{display:flex;gap:18px;align-items:flex-start}.tm-mono{flex:none;width:60px;height:60px;border-radius:50%;display:grid;place-items:center;background:var(--surface);color:var(--text);font:var(--dw) 1.1rem var(--f-d);border:1px solid var(--line)}`,
  testimonials: `.q-text{font-size:1.4rem;line-height:1.3;text-wrap:pretty}.q-it figcaption{display:grid;gap:2px;margin-top:20px}.q-name{font-weight:650}.q-detail{color:var(--muted);font-size:.92rem}
.q-single{max-width:1000px}.q-single .q-it+.q-it{display:none}.q-single .q-text{font-size:clamp(1.8rem,1.1rem + 2.4vw,3.2rem);line-height:1.12}
.q-grid{display:grid;gap:calc(var(--u)*6)}@media (min-width:760px){.q-grid{grid-template-columns:1fr 1fr}}.q-grid .q-it{padding-top:24px;border-top:1px solid var(--line)}
.q-car .q-it{padding:calc(var(--u)*4);background:var(--surface);border-radius:var(--r);flex-basis:min(85%,500px)}`,
  logos: `.lg{display:grid;gap:26px}.lg-h{font:600 .9rem var(--f-b);color:var(--muted);letter-spacing:0}.lg ul{list-style:none;display:flex;flex-wrap:wrap;gap:20px 52px;align-items:center}
.lg img{max-height:40px;width:auto;max-width:150px;filter:grayscale(1);opacity:.8}.lg a:hover img{filter:none;opacity:1}.lg-name{font-family:var(--f-d);font-weight:var(--dw);font-size:1.35rem;color:var(--muted);font-stretch:var(--ds)}.lg a{text-decoration:none}
.lg-grid ul{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:var(--line);border:1px solid var(--line)}@media (min-width:760px){.lg-grid ul{grid-template-columns:repeat(4,1fr)}}.lg-grid li{background:var(--bg);display:grid;place-items:center;min-height:120px;padding:16px}`,
  stats: `.st{list-style:none;display:grid;gap:32px}.st-row{grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}.st li{display:grid;gap:8px;padding-top:18px;border-top:1px solid var(--line);align-content:start}
.st-v{font-size:clamp(2.6rem,calc((1rem + 2.8vw)*var(--ts)),4rem);line-height:1;font-variant-numeric:lining-nums proportional-nums}.st-l{color:var(--muted);max-width:26ch}.st-big .st-v{font-size:clamp(3.4rem,calc((1rem + 5.5vw)*var(--ts)),6rem)}.st-big{grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:48px}
.st-split{display:grid;gap:40px}@media (min-width:900px){.st-split{grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:80px;align-items:start}}.st-split .lede{margin-top:18px}`,
  faq: `.fq{display:grid}.fq-it{border-top:1px solid var(--line)}.fq-it:last-child{border-bottom:1px solid var(--line)}
.fq summary{list-style:none;display:flex;justify-content:space-between;gap:24px;align-items:center;padding:24px 0;cursor:pointer;font-weight:600;font-size:1.1rem}.fq summary::-webkit-details-marker{display:none}.fq summary:hover .fq-q{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.25em}
.fq-x{position:relative;flex:none;width:18px;height:18px;transition:transform .3s ${EASE}}.fq-x::before,.fq-x::after{content:"";position:absolute;left:0;top:8px;width:18px;height:1.6px;background:currentColor}.fq-x::after{transform:rotate(90deg)}.fq details[open] .fq-x,.fq-it[open] .fq-x{transform:rotate(45deg)}
.fq-a{color:var(--muted);padding:0 0 26px;max-width:64ch;text-wrap:pretty}.v-plain .fq-it{padding:24px 0;display:grid;gap:10px}.v-plain .fq-a{padding:0}
.fq-split{display:grid;gap:36px}@media (min-width:900px){.fq-split{grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:96px;align-items:start}.fq-side{position:sticky;top:120px}}.fq-side{display:grid;gap:18px}html[data-edit] .fq-side{position:static}`,
  cta: `.cta-band{display:grid;gap:calc(var(--u)*4);align-items:end}@media (min-width:900px){.cta-band{grid-template-columns:minmax(0,1fr) auto;gap:calc(var(--u)*8)}}.cta-h{font-size:clamp(2.2rem,calc((1rem + 3.8vw)*var(--ts)),4.8rem);max-width:17ch}.cta-band .lede,.cta-split .lede,.cta-box .lede,.cta-over .lede{margin-top:calc(var(--u)*2.5)}
.cta-split{display:grid;gap:28px;align-items:end}@media (min-width:900px){.cta-split{grid-template-columns:minmax(0,1.6fr) auto;gap:64px}}.cta-split .cta-h{font-size:clamp(1.9rem,calc((1rem + 2.4vw)*var(--ts)),3.4rem)}
.cta-box{padding:calc(var(--u)*6) calc(var(--u)*4);border:1px solid var(--line);border-radius:var(--r);display:grid;gap:22px;background:var(--surface)}@media (min-width:760px){.cta-box{padding:calc(var(--u)*9)}}
.v-image.b-cta{min-height:min(84vh,820px);display:flex;align-items:flex-end;overflow:hidden;color:#fff;--text:#fff;--muted:rgba(255,255,255,.88);background:#141414}.cta-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.cta-scrim{position:absolute;inset:0;background:linear-gradient(to top,rgba(8,8,8,.84),rgba(8,8,8,.55) 45%,rgba(8,8,8,.2) 80%)}.b-cta .ph-img.cta-bg{border-radius:0}
.cta-over{position:relative;display:grid;gap:calc(var(--u)*4);align-items:end}@media (min-width:900px){.cta-over{grid-template-columns:minmax(0,1fr) auto;gap:calc(var(--u)*8)}}.v-image.b-cta .btn-p{background:#fff;color:#111;border-color:#fff}.v-image.b-cta .btn-s{color:#fff;border-color:rgba(255,255,255,.6)}`,
  form: `.form{display:grid;gap:18px}.fl{display:grid;gap:8px;min-width:0}.fl label,.fl legend{font-weight:600;font-size:.93rem}.opt{font-weight:400;color:var(--muted)}
.fl input,.fl textarea{width:100%;min-height:52px;padding:13px 15px;border:1px solid color-mix(in srgb,var(--text) 22%,transparent);border-radius:min(var(--r),10px);background:var(--bg);color:var(--text);font:inherit;font-size:1rem;transition:border-color .2s ${EASE}}
.fl input:hover,.fl textarea:hover{border-color:color-mix(in srgb,var(--text) 45%,transparent)}.fl textarea{resize:vertical;min-height:140px}.fl input:focus,.fl textarea:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--text)}
.fl input:user-invalid,.fl textarea:user-invalid{border-color:#b3261e}
.fl-row{display:grid;gap:18px}@media (min-width:600px){.fl-row{grid-template-columns:1fr 1fr}}
.chips{border:0;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px}.chips legend{margin-bottom:10px;padding:0}.chip{position:relative}.chip input{position:absolute;opacity:0;inset:0;cursor:pointer}.chip span{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border:1px solid color-mix(in srgb,var(--text) 24%,transparent);border-radius:999px;cursor:pointer;transition:background-color .2s ${EASE},color .2s ${EASE}}
.chip input:checked+span{border-color:var(--text);background:var(--text);color:var(--bg)}.chip input:focus-visible+span{outline:2px solid var(--accent);outline-offset:2px}
.hp{position:absolute!important;left:-9999px!important;width:1px;height:1px;overflow:hidden}.form-end{display:flex;flex-wrap:wrap;gap:16px;align-items:center;margin-top:6px}.form-msg{color:var(--muted);font-size:.95rem}.form.sent .form-msg{color:var(--text);font-weight:600}.form button:disabled{opacity:.6;cursor:progress}
.ct-split,.ct-stack{display:grid;gap:calc(var(--u)*6)}@media (min-width:900px){.ct-split{grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:calc(var(--u)*11)}}.ct-info{display:grid;gap:18px;align-content:start}
.ct-dl{display:grid;gap:18px;margin-top:14px}.ct-dl dt{font-size:.82rem;font-weight:600;color:var(--muted)}.ct-dl dd{font-size:1.08rem;margin-top:2px}.ct-dl a{text-decoration:none}.ct-dl a:hover{text-decoration:underline}
.nl{display:grid;gap:24px;align-items:end}@media (min-width:900px){.nl-inline,.nl-band{grid-template-columns:1fr 1fr;gap:72px}}.nl .lede{margin-top:12px}.nl-form{grid-template-columns:1fr auto;align-items:end;gap:10px}.nl-form .form-end{display:contents}.nl-form .form-msg{grid-column:1/-1}
.nl-card{max-width:580px;padding:calc(var(--u)*4);border:1px solid var(--line);border-radius:var(--r)}`,
  hours: `.hr-t{border-collapse:collapse;width:100%;margin-top:24px;font-variant-numeric:lining-nums proportional-nums}.hr-t th,.hr-t td{padding:14px 0;border-bottom:1px solid var(--line);text-align:left;font-weight:400}.hr-t td{text-align:right}.hr-t th{font-weight:600}
.hr-t tr.today th,.hr-t tr.today td{color:var(--at);font-weight:650}.hr-t tr.today th::after{content:" · today";font-weight:400;font-size:.85em}.bg-ink .hr-t tr.today th,.bg-ink .hr-t tr.today td{color:var(--text)}
.hr-compact .hr-t{max-width:520px}.hr-compact .hr-t th,.hr-compact .hr-t td{padding:6px 0;border:0}
.hr-split{display:grid;gap:24px}@media (min-width:900px){.hr-split{grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:96px}.hr-split .hr-t{margin:0}}.hr-split .lede{margin-top:16px}.rt-narrow .lede,.hr-compact .lede{margin-top:16px}`,
  map: `.map-info{display:grid;gap:16px;align-content:start;justify-items:start;margin-bottom:28px}.map-addr{font-size:1.12rem;max-width:36ch}.map-ph-n a{font-weight:600;text-decoration:none}.map-hours{list-style:none;display:grid;gap:4px;color:var(--muted);font-variant-numeric:lining-nums proportional-nums;white-space:pre-line}.map-note{color:var(--muted);font-size:.95rem;max-width:40ch}
.map-frame{display:block;width:100%;height:460px;border:0;border-radius:var(--ri);background:var(--surface) radial-gradient(circle,color-mix(in srgb,var(--text) 14%,transparent) 1px,transparent 1.5px) 0 0/22px 22px}.map-ph{display:grid;place-items:center;align-content:center;gap:8px;color:var(--muted);text-align:center;padding:24px;background:radial-gradient(circle at 60% 40%,color-mix(in srgb,var(--accent) 10%,var(--surface)),var(--surface) 60%)}.map-ph span{font-weight:600;color:var(--text)}.map-pin{width:34px;height:34px;fill:none;stroke:var(--accent);stroke-width:1.6}
.map-split{display:grid;gap:28px}@media (min-width:900px){.map-split{grid-template-columns:minmax(0,4fr) minmax(0,7fr);gap:72px}.map-split .map-info{margin:0}}.map-card{padding:calc(var(--u)*5);border:1px solid var(--line);border-radius:var(--r);max-width:640px}.map-card .map-info{margin:0}
.map-loc{display:grid}.map-loc .map-frame{height:clamp(380px,56vh,600px)}.map-float{background:var(--c-bg);color:var(--c-text);padding:calc(var(--u)*4);border-radius:var(--r);border:1px solid var(--line);margin-top:16px}.map-float .map-info{margin:0}
@media (min-width:900px){.map-loc>*{grid-area:1/1}.map-loc .map-frame{height:auto;min-height:clamp(560px,70vh,720px)}.map-float{align-self:start;justify-self:end;width:min(440px,42%);margin:36px;box-shadow:0 24px 60px -24px rgba(0,0,0,.4)}}`,
  timeline: `.tl{list-style:none;padding:0;display:grid}.tl-d{font-weight:650;color:var(--at);font-variant-numeric:lining-nums proportional-nums}.tl-t{color:var(--muted);margin-top:8px;max-width:60ch}
.tl-vertical{border-left:1px solid var(--line);margin-left:6px}.tl-vertical .tl-it{position:relative;padding:0 0 calc(var(--u)*5) 32px;display:grid;gap:6px}.tl-vertical .tl-it::before{content:"";position:absolute;left:-6px;top:7px;width:11px;height:11px;border-radius:50%;background:var(--bg);border:1.5px solid var(--accent)}
.tl-horizontal{grid-auto-flow:column;grid-auto-columns:minmax(240px,1fr);gap:32px;overflow-x:auto;padding-bottom:10px}.tl-horizontal .tl-it{display:grid;gap:12px;padding-top:20px;border-top:1px solid var(--text);align-content:start}
.tl-list .tl-it{display:grid;gap:6px;padding:24px 0;border-top:1px solid var(--line)}@media (min-width:760px){.tl-list .tl-it{grid-template-columns:180px 1fr;gap:40px}}`,
  beforeafter: `.ba{position:relative;overflow:hidden;border-radius:var(--ri);aspect-ratio:3/2}.ba img{width:100%;height:100%;object-fit:cover}.ba-b,.ba-a{position:absolute;inset:0}.ba-a{clip-path:inset(0 0 0 var(--pos))}
.ba::after{content:"";position:absolute;top:0;bottom:0;left:var(--pos);width:2px;background:#fff;transform:translateX(-1px);pointer-events:none}.ba-range{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:ew-resize;margin:0}
.ba-l{position:absolute;left:14px;bottom:14px;background:rgba(0,0,0,.66);color:#fff;font-size:.82rem;padding:4px 10px;border-radius:var(--rb)}.ba-lr{left:auto;right:14px}.ba-range:focus-visible+*{outline:2px solid var(--accent)}
.ba-side{display:grid;gap:16px}@media (min-width:760px){.ba-side{grid-template-columns:1fr 1fr}}.ba-side img,.ba-side .ph-img{aspect-ratio:3/2;object-fit:cover;border-radius:var(--ri)}.ba-side figcaption{margin-top:10px;font-weight:600}`,
  downloads: `.dl{list-style:none;display:grid}.dl a{display:flex;align-items:center;gap:14px;padding:20px 0;border-top:1px solid var(--line);text-decoration:none}.dl li:last-child a{border-bottom:1px solid var(--line)}.dl-l{font-weight:600;margin-right:auto}.dl-n{color:var(--muted);font-size:.9rem}
.dl a:hover .dl-l{text-decoration:underline}
.dl-cards{grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}.dl-cards a{border:1px solid var(--line)!important;border-radius:var(--r);padding:22px;flex-wrap:wrap;height:100%}`,
  social: `.so{display:grid;gap:20px}.so-h{font:600 .95rem var(--f-b);color:var(--muted);letter-spacing:0}.so ul{list-style:none;display:flex;flex-wrap:wrap;gap:10px 30px}.so a{font-weight:600}
.so-list ul{display:grid;gap:0}.so-list a{display:block;padding:16px 0;border-top:1px solid var(--line);text-decoration:none}.so-big a{font-family:var(--f-d);font-weight:var(--dw);font-size:clamp(1.9rem,1.2rem + 2.6vw,3.6rem);text-decoration:none;letter-spacing:var(--dt);font-stretch:var(--ds)}.so-big a:hover{color:var(--accent)}`,
  spacer: `.b-spacer{padding:0}.sp-s.sp{height:24px}.sp-m.sp{height:56px}.sp-l.sp{height:112px}.sp{display:flex;align-items:center}.sp hr{width:100%;border:0;border-top:1px solid var(--line);margin:0}.sp-mark hr{width:56px;border-top:3px solid var(--accent)}`,
  announce: `.b-announce{padding:10px 0!important;font-size:.93rem;line-height:1.4;z-index:31}
.an{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 16px;min-height:30px;text-align:center;position:relative}.an-has-x{padding:0 44px}
.an-tag{font-size:.76rem;font-weight:650;letter-spacing:.01em;padding:2px 10px;border:1px solid color-mix(in srgb,currentColor 50%,transparent);border-radius:999px;white-space:nowrap}
.an-msg{font-weight:500;text-wrap:balance}.an .tlink{font-size:.9rem;padding-bottom:1px;border-bottom-color:color-mix(in srgb,currentColor 45%,transparent)}.an .tlink:hover{border-bottom-color:currentColor}
.an-split{justify-content:space-between;text-align:left}.an-split.an-has-x{padding-left:0}.an-main{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px}
.an-x{position:absolute;right:-8px;top:50%;transform:translateY(-50%);width:44px;height:44px;display:grid;place-items:center;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer;transition:background-color .2s ${EASE}}.an-x:hover{background:color-mix(in srgb,currentColor 12%,transparent)}.an-x .ic{width:18px;height:18px}
@media (max-width:759px){.an-split{flex-direction:column;align-items:flex-start;gap:4px}.an{justify-content:flex-start;text-align:left}.an-has-x{padding-left:0}}`,
  tabs: `.tb-list{display:flex;gap:4px 30px;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--line);margin-bottom:calc(var(--u)*6)}.tb-list::-webkit-scrollbar{display:none}
.tb-tab{position:relative;flex:none;min-height:50px;padding:10px 0 14px;border:0;background:none;color:var(--muted);font:600 1.02rem/1.2 var(--f-b);font-stretch:var(--bs);cursor:pointer;transition:color .2s ${EASE}}.tb-tab:focus-visible{outline-offset:-3px}
.tb-tab::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--text);transform:scaleX(0);transform-origin:0 50%;transition:transform .32s ${EASE}}
.tb-tab:hover,.tb-tab[aria-selected=true]{color:var(--text)}.tb-tab[aria-selected=true]::after{transform:none}
.tb-p{display:grid;gap:calc(var(--u)*5);align-items:start}.tb-p:focus-visible{outline-offset:8px}
@media (min-width:900px){.tb-p{grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:calc(var(--u)*10)}.tb-p.tb-nom{grid-template-columns:minmax(0,8fr)}}
.tb-m img,.tb-m .ph-img{width:100%;aspect-ratio:4/3;object-fit:cover}
.tb-c{display:grid;gap:calc(var(--u)*2.5);align-content:start;justify-items:start}.tb-t{font-size:clamp(1.6rem,calc((1rem + 1.6vw)*var(--ts)),2.6rem)}.tb-x{color:var(--muted);max-width:52ch;text-wrap:pretty}
.tb-pts{list-style:none;display:grid;width:100%;margin:calc(var(--u)*1) 0}.tb-pts li{display:flex;align-items:baseline;gap:12px;padding:13px 0;border-top:1px solid var(--line)}.tb-pts li:last-child{border-bottom:1px solid var(--line)}.tb-dots{flex:1;min-width:12px}.tb-pts b{font-weight:600;white-space:nowrap;font-variant-numeric:lining-nums tabular-nums}
.tb-pl{display:none;font-size:.82rem;font-weight:650;color:var(--at)}.tb-pts-e{white-space:pre-line;color:var(--muted);width:100%}
@media (scripting:enabled){.tb-off{display:none}.tb-in{animation:tb-in .34s ${EASE} both}}@keyframes tb-in{from{opacity:0;transform:translateY(10px)}}
@media (scripting:none){.tb-list{display:none}.tb-pl{display:block}.tb-p+.tb-p{margin-top:calc(var(--u)*8)}}
html[data-edit] .tb-off{display:grid}html[data-edit] .tb-pl{display:block}html[data-edit] .tb-p+.tb-p{margin-top:calc(var(--u)*6);padding-top:calc(var(--u)*6);border-top:1px dashed var(--line)}
.tb-pills .tb-list{justify-content:center;flex-wrap:wrap;gap:8px;border:0}.tb-pills .tb-tab{min-height:46px;padding:0 20px;border:1px solid var(--line);border-radius:var(--rb);color:var(--text);transition:background-color .2s ${EASE},color .2s ${EASE},border-color .2s ${EASE}}.tb-pills .tb-tab::after{display:none}
.tb-pills .tb-tab:hover{border-color:var(--text)}.tb-pills .tb-tab[aria-selected=true]{background:var(--text);color:var(--bg);border-color:var(--text)}.tb-pills .tb-tab:focus-visible{outline-offset:3px}
@media (min-width:900px){.tb-pills .tb-p{grid-template-columns:minmax(0,7fr) minmax(0,5fr);align-items:center}.tb-pills .tb-m{order:-1}.tb-pills .tb-p.tb-nom{grid-template-columns:minmax(0,1fr);max-width:760px;margin-inline:auto}}
@media (max-width:759px){.tb-pills .tb-list{justify-content:flex-start;flex-wrap:nowrap}}
@media (min-width:900px){.tb-side{display:grid;grid-template-columns:minmax(0,4fr) minmax(0,8fr);gap:calc(var(--u)*8);align-items:start}
.tb-side .tb-list{flex-direction:column;gap:0;border:0;margin:0;overflow:visible}.tb-side .tb-tab{text-align:left;padding:20px 0 20px 22px;border-top:1px solid var(--line);font:var(--dw) clamp(1.3rem,calc((1rem + .8vw)*var(--ts)),1.9rem)/1.1 var(--f-d);letter-spacing:var(--dt);font-stretch:var(--ds)}.tb-side .tb-tab:last-child{border-bottom:1px solid var(--line)}
.tb-side .tb-tab::after{top:-1px;bottom:-1px;right:auto;width:2px;height:auto;transform:scaleY(0);transform-origin:50% 0}.tb-side .tb-tab[aria-selected=true]::after{transform:none}
.tb-side .tb-p{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:calc(var(--u)*6)}.tb-side .tb-p.tb-nom{grid-template-columns:minmax(0,1fr)}}
body.caps .tb-side .tb-tab{text-transform:uppercase}`,
  compare: `.cmp-scroll{overflow-x:auto;overscroll-behavior-x:contain}.cmp-scroll:focus-visible{outline-offset:4px}
.cmp{width:100%;min-width:calc(150px + var(--n)*104px);border-collapse:separate;border-spacing:0;table-layout:fixed;font-variant-numeric:lining-nums tabular-nums}
.cmp th,.cmp td{padding:17px 14px;border-bottom:1px solid var(--line);text-align:center;vertical-align:middle;font-weight:400}
.cmp tbody th{text-align:left;padding-left:0;font-weight:500;position:sticky;left:0;z-index:1;background:var(--bg);width:34%}
.cmp thead th,.cmp-c0{vertical-align:bottom;padding-top:22px;padding-bottom:18px;border-bottom:1px solid var(--text)}.cmp-c0{position:sticky;left:0;z-index:1;background:var(--bg)}
.cmp-name{display:block;font-family:var(--f-d);font-weight:var(--dw);letter-spacing:var(--dt);font-stretch:var(--ds);font-size:clamp(1.12rem,1rem + .6vw,1.5rem);line-height:1.15}.cmp-note{display:block;margin-top:6px;font-size:.88rem;color:var(--muted)}
.cmp .cmp-on{background:var(--surface)}.cmp thead .cmp-on{box-shadow:inset 0 3px 0 var(--accent);border-radius:var(--ri) var(--ri) 0 0}.cmp tbody tr:last-child .cmp-on{border-radius:0 0 var(--ri) var(--ri)}
.cmp-y,.cmp-no{display:inline-grid;place-items:center;vertical-align:middle}.cmp-y .ic{width:22px;height:22px;stroke:var(--at);stroke-width:2.2}.cmp-no .ic{width:18px;height:18px;stroke:color-mix(in srgb,var(--muted) 75%,transparent)}.cmp-v{font-weight:600}
.cmp-fine{margin-top:calc(var(--u)*3);font-size:.9rem;color:var(--muted);max-width:70ch}
@media (max-width:599px){.cmp th,.cmp td{padding:14px 8px}.cmp{min-width:calc(136px + var(--n)*100px)}.cmp tbody th{font-size:.93rem;width:136px}.cmp-name{font-size:1rem;overflow-wrap:break-word;hyphens:auto}.cmp-note{font-size:.8rem}}
.cmp-cards{list-style:none;display:grid;gap:16px}@media (min-width:760px){.cmp-cards{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}}
.cmp-card{display:grid;align-content:start;gap:calc(var(--u)*3);padding:calc(var(--u)*4);border:1px solid var(--line);border-radius:var(--r)}.cmp-card.cmp-on{border-color:var(--text);box-shadow:inset 0 3px 0 var(--accent)}
.cmp-top{display:grid;gap:6px;padding-bottom:calc(var(--u)*2.5);border-bottom:1px solid var(--line)}.cmp-card .cmp-name{font-size:clamp(1.4rem,calc((1rem + 1vw)*var(--ts)),1.9rem)}.cmp-card .cmp-note{font-size:1rem;color:var(--text);font-weight:600}
.cmp-ul{list-style:none;display:grid;gap:12px}.cmp-ul li{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:10px;align-items:start}.cmp-ul .ic{width:20px!important;height:20px!important}.cmp-ul .cmp-v{font-size:.95rem;text-align:right}.cmp-off .cmp-rl{color:var(--muted)}`,
  countdown: `.cd{display:grid;gap:calc(var(--u)*4)}.cd-copy{display:grid;gap:calc(var(--u)*2.5);justify-items:start}.cd-h{font-size:clamp(2rem,calc((1rem + 3vw)*var(--ts)),4.2rem);max-width:18ch}
.cd-clock{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.cd-u{display:grid;gap:8px;justify-items:start;padding:calc(var(--u)*2.5) 0 calc(var(--u)*2.5) clamp(10px,2.2vw,32px)}.cd-u:first-child{padding-left:0}.cd-u+.cd-u{border-left:1px solid var(--line)}
.cd-n{font-family:var(--f-d);font-weight:var(--dw);letter-spacing:var(--dt);font-stretch:var(--ds);font-size:clamp(2.5rem,calc((1rem + 6.4vw)*var(--ts)),8.4rem);line-height:.9;font-variant-numeric:lining-nums tabular-nums}
.cd-l{font-size:.82rem;font-weight:600;color:var(--muted)}.cd-when{font-weight:600}
.cd-foot{display:flex;flex-wrap:wrap;gap:16px 40px;align-items:center;justify-content:space-between}
.cd-after{font-family:var(--f-d);font-weight:var(--dw);letter-spacing:var(--dt);font-stretch:var(--ds);font-size:clamp(1.6rem,calc((1rem + 2vw)*var(--ts)),3rem);line-height:1.1;max-width:24ch;text-wrap:balance}
.cd:not(.cd-done) .cd-after{display:none}.cd-done .cd-clock{display:none}.cd-elabel{font-size:.8rem;color:var(--muted);margin-bottom:-12px}
html[data-edit] .cd .cd-after{display:block}@media (scripting:none){.cd:not(.cd-done) .cd-clock{display:none}}
@media (min-width:900px){.cd-split{grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:calc(var(--u)*10);align-items:center}}
.cd-side{display:grid;gap:calc(var(--u)*3)}.cd-split .cd-copy{gap:calc(var(--u)*3)}.cd-split .cd-clock{grid-template-columns:repeat(2,minmax(0,1fr));border-bottom:0}
.cd-split .cd-u{padding:calc(var(--u)*3) 0;border-bottom:1px solid var(--line)}.cd-split .cd-u+.cd-u{border-left:0}.cd-split .cd-u:nth-child(even){padding-left:calc(var(--u)*3);border-left:1px solid var(--line)}
.cd-split .cd-n{font-size:clamp(3rem,calc((1rem + 5vw)*var(--ts)),6.6rem)}
.v-image.b-countdown{min-height:min(88vh,860px);display:flex;align-items:flex-end;overflow:hidden;color:#fff;--text:#fff;--muted:rgba(255,255,255,.86);--line:rgba(255,255,255,.3);background:#141414}
.cd-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.b-countdown .ph-img.cd-bg{border-radius:0}.cd-scrim{position:absolute;inset:0;background:linear-gradient(to top,rgba(8,8,8,.84),rgba(8,8,8,.5) 55%,rgba(8,8,8,.28))}
.cd-over{position:relative}.v-image.b-countdown .btn-p{background:#fff;color:#111;border-color:#fff}.v-image.b-countdown .btn-p:hover{background:rgba(255,255,255,.86)}`,
  voices: `.vc-q{font-family:var(--f-d);font-weight:var(--dw);letter-spacing:var(--dt);font-stretch:var(--ds);font-size:clamp(1.35rem,calc((1rem + 1.1vw)*var(--ts)),2rem);line-height:1.22;text-wrap:pretty}.vc-q::before{content:"\\201C"}.vc-q::after{content:"\\201D"}
.vc-who{display:flex;align-items:center;gap:14px;margin-top:calc(var(--u)*3)}.vc-wt{display:grid;gap:2px}.vc-name{font-weight:650}.vc-role{color:var(--muted);font-size:.93rem}
.vc-m img,.vc-m .ph-img{width:100%;aspect-ratio:4/5;object-fit:cover}
.vc-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-x:contain;border-radius:var(--ri)}.vc-track::-webkit-scrollbar{display:none}.vc-track:focus-visible{outline-offset:4px}
.vc-slider .vc-it{flex:0 0 100%;scroll-snap-align:start;display:grid;gap:calc(var(--u)*4);align-items:center;align-content:start;transition:opacity .45s ${EASE}}
.vc-slider .vc-m{max-width:520px}
@media (min-width:900px){.vc-slider .vc-it{grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:calc(var(--u)*10);align-content:center}.vc-slider .vc-nopic{grid-template-columns:minmax(0,1fr);max-width:1000px}.vc-slider .vc-q{font-size:clamp(1.8rem,calc((1rem + 2vw)*var(--ts)),3.1rem);line-height:1.12}}
[data-slider].ready .vc-it:not(.on){opacity:.25}
.vc-nav{display:flex;align-items:center;gap:14px;margin-top:calc(var(--u)*4)}@media (min-width:900px){.vc-nav{justify-content:flex-end}}.vc-count{font-variant-numeric:lining-nums tabular-nums;color:var(--muted);font-size:.95rem;min-width:6ch;text-align:center}
.vc-btn{width:52px;height:52px;display:grid;place-items:center;border-radius:50%;border:1px solid var(--line);background:transparent;color:inherit;cursor:pointer;transition:border-color .2s ${EASE},background-color .2s ${EASE},opacity .2s ${EASE}}.vc-btn:hover:not(:disabled){border-color:currentColor;background:var(--surface)}.vc-btn:disabled{opacity:.35;cursor:default}
html:not(.js) .vc-nav{display:none}html[data-edit] .vc-track{display:grid;gap:calc(var(--u)*8);overflow:visible}
.vc-cards{display:grid;gap:calc(var(--u)*7) calc(var(--u)*4)}@media (min-width:700px){.vc-cards{grid-template-columns:repeat(2,1fr)}}@media (min-width:1100px){.vc-cards{grid-template-columns:repeat(3,1fr)}}
.vc-cards .vc-it{display:grid;gap:calc(var(--u)*3);align-content:start}.vc-cards .vc-q{font-size:clamp(1.18rem,calc((1rem + .45vw)*var(--ts)),1.45rem);line-height:1.32}.vc-cards .vc-nopic .vc-b{padding-top:calc(var(--u)*3);border-top:1px solid var(--text)}
.vc-wall{columns:1;column-gap:calc(var(--u)*6)}@media (min-width:700px){.vc-wall{columns:2}}@media (min-width:1100px){.vc-wall{columns:3}}
.vc-wall .vc-it{break-inside:avoid;padding:calc(var(--u)*4) 0;border-top:1px solid var(--line)}.vc-wall .vc-q{font-family:var(--f-b);font-weight:400;letter-spacing:0;font-stretch:var(--bs);font-size:1.12rem;line-height:1.6}
.vc-av{flex:none;width:52px;height:52px;border-radius:50%;overflow:hidden}.vc-av img,.vc-av .ph-img{width:100%;height:100%;min-height:0;object-fit:cover;border-radius:50%}.vc-av .ph-img span{display:none}`,
  hotspots: `.hs-stage{position:relative;width:fit-content;max-width:100%;margin-inline:auto}.hs-img img{width:auto;max-width:100%;height:auto;max-height:min(86vh,940px)}.hs-legend .hs-stage{margin:0}.hs-stage:has(.ph-img){width:100%}.hs-img .ph-img{aspect-ratio:16/10}
.hs-dot{position:absolute;left:var(--x);top:var(--y);z-index:2;width:38px;height:38px;margin:-19px 0 0 -19px;padding:0;display:grid;place-items:center;border:0;border-radius:50%;background:#fff;color:#111;font:650 .92rem/1 var(--f-b);box-shadow:0 0 0 6px rgba(255,255,255,.3),0 8px 20px -8px rgba(0,0,0,.55);transition:transform .22s ${EASE},background-color .22s ${EASE},color .22s ${EASE}}
button.hs-dot{cursor:pointer}button.hs-dot:hover{transform:scale(1.1)}.hs-dot[aria-expanded=true],.hs-dot.on{background:var(--c-accent);color:var(--c-on);transform:scale(1.1)}
.hs-note{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;margin-top:12px;padding:16px 48px 16px 16px;border:1px solid var(--line);border-radius:var(--r);background:var(--surface);color:var(--text);animation:hs-in .24s ${EASE}}
.hs-note[hidden]{display:none}@keyframes hs-in{from{opacity:0;transform:translateY(6px)}}
.hs-n{flex:none;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font:650 .82rem/1 var(--f-b);background:var(--text);color:var(--bg);transition:background-color .2s ${EASE},color .2s ${EASE}}
.hs-lb{display:grid;gap:4px;padding-top:3px}.hs-t{font:650 1.04rem/1.3 var(--f-b);letter-spacing:0;font-stretch:var(--bs);text-transform:none!important}.hs-x{color:var(--muted);font-size:.95rem;line-height:1.5;text-wrap:pretty}
.hs-close{position:absolute;right:6px;top:6px;width:40px;height:40px;display:grid;place-items:center;padding:0;border:0;border-radius:50%;background:none;color:inherit;cursor:pointer}.hs-close:hover{background:color-mix(in srgb,currentColor 8%,transparent)}.hs-close .ic{width:18px;height:18px}
@media (min-width:760px){html:not([data-edit]) .hs-pins .hs-note{position:absolute;left:var(--x);top:var(--y);z-index:3;width:min(320px,calc(100vw - 80px));margin:30px 0 0 -30px;border:0;background:var(--c-bg);color:var(--c-text);--text:var(--c-text);--bg:var(--c-bg);--muted:var(--c-muted);box-shadow:0 24px 60px -20px rgba(0,0,0,.5)}
html:not([data-edit]) .hs-pins .hs-l{translate:-100% 0;margin-left:30px}html:not([data-edit]) .hs-pins .hs-u{translate:0 -100%;margin-top:-30px}html:not([data-edit]) .hs-pins .hs-l.hs-u{translate:-100% -100%}}
@media (scripting:none){.hs-note[hidden]{display:grid}.hs-pins .hs-note{position:relative!important;left:auto!important;top:auto!important;translate:none!important;margin:12px 0 0!important;width:auto!important}.hs-close{display:none}}
@media (max-width:759px){.hs-dot{width:32px;height:32px;margin:-16px 0 0 -16px;font-size:.84rem;box-shadow:0 0 0 4px rgba(255,255,255,.3),0 6px 16px -6px rgba(0,0,0,.5)}}
.hs-legend{display:grid;gap:calc(var(--u)*5)}@media (min-width:900px){.hs-legend{grid-template-columns:fit-content(64%) minmax(0,1fr);gap:calc(var(--u)*8);align-items:center}}
.hs-leg{list-style:none;display:grid}.hs-li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:16px;padding:calc(var(--u)*2.5) 0;border-top:1px solid var(--line)}.hs-li:last-child{border-bottom:1px solid var(--line)}
${Array.from({ length: 12 }, (_, i) => `.hs-legend:has(.hs-li:nth-child(${i + 1}):hover) .hs-dot:nth-of-type(${i + 1}),.hs-legend:has(.hs-dot:nth-of-type(${i + 1}):hover) .hs-li:nth-child(${i + 1}) .hs-n`).join(',')}{background:var(--c-accent);color:var(--c-on)}`,
  expand: `.ex{display:grid}.ex-it{border-top:1px solid var(--line)}.ex-it:last-child{border-bottom:1px solid var(--line)}
.ex-it summary{list-style:none;display:flex;align-items:baseline;gap:8px 24px;padding:calc(var(--u)*3) 0;cursor:pointer}.ex-it summary::-webkit-details-marker{display:none}
.ex-t{margin-right:auto;font-family:var(--f-d);font-weight:var(--dw);letter-spacing:var(--dt);font-stretch:var(--ds);font-size:clamp(1.4rem,calc((1rem + 1.2vw)*var(--ts)),2.2rem);line-height:1.1;text-wrap:balance}body.caps .ex-t{text-transform:uppercase}
.ex-d{color:var(--muted);font-size:.95rem;white-space:nowrap;font-variant-numeric:lining-nums proportional-nums}.ex-x{align-self:center}.ex-it[open] .ex-x{transform:rotate(45deg)}
.ex-it summary:hover .ex-t{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.18em}
.ex-body{display:grid;gap:calc(var(--u)*3);padding:0 0 calc(var(--u)*4)}.ex-it[open] .ex-body{animation:ex-in .4s ${EASE}}@keyframes ex-in{from{opacity:0;transform:translateY(-6px)}}
@media (min-width:760px){.ex-rows .ex-body{grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:calc(var(--u)*6);align-items:start}.ex-rows .ex-nom{grid-template-columns:minmax(0,8fr)}}
.ex-m img,.ex-m .ph-img,.ex-pic img,.ex-pic .ph-img{width:100%;aspect-ratio:4/3;object-fit:cover}.ex-m-s{border-radius:var(--ri);overflow:hidden}
.ex-c{display:grid;gap:calc(var(--u)*2.5);justify-items:start;align-content:start}.ex-p{color:var(--muted);max-width:56ch;text-wrap:pretty}
@media (max-width:759px){.ex-it summary{flex-wrap:wrap}.ex-t{flex:1 1 60%}.ex-d{order:3;width:100%;margin-top:-2px}}
.ex-pics{display:none}
@media (min-width:900px){.ex-split{grid-template-columns:minmax(0,6fr) minmax(0,5fr);gap:calc(var(--u)*10);align-items:start}.ex-pics{display:grid;position:sticky;top:110px}.ex-pic{grid-area:1/1;opacity:0;transition:opacity .5s ${EASE}}.ex-pic img,.ex-pic .ph-img{aspect-ratio:4/5}.ex-split .ex-m-s{display:none}}
${Array.from({ length: 12 }, (_, i) => `.ex-split:has(.ex-it:nth-child(${i + 1})[open]) .ex-pic:nth-child(${i + 1})`).join(',')},.ex-split:not(:has(.ex-it[open])) .ex-pic:first-child{opacity:1}
html[data-edit] .ex-pics{position:static}html[data-edit] .ex-split .ex-m-s{display:block}html[data-edit] .ex-pic{opacity:0!important}html[data-edit] .ex-pic:first-child{opacity:1!important}`,
  enquire: `.eq{list-style:none;display:grid;gap:calc(var(--u)*6) calc(var(--u)*3)}@media (min-width:560px){.eq-grid{grid-template-columns:repeat(2,1fr)}}@media (min-width:1000px){.eq-grid{grid-template-columns:repeat(3,1fr);gap:calc(var(--u)*8) calc(var(--u)*4)}}
@media (min-width:760px){.eq-wide{grid-template-columns:repeat(2,1fr);gap:calc(var(--u)*9) calc(var(--u)*5)}}
.eq-it{display:grid;gap:calc(var(--u)*2.5);align-content:start}.eq-m{position:relative}.eq-m img,.eq-m .ph-img{width:100%;aspect-ratio:4/5;object-fit:cover}.eq-wide .eq-m img,.eq-wide .eq-m .ph-img{aspect-ratio:4/3}
.eq-m .rv img{transition:transform 1.3s ${EASE},scale .6s ${EASE}}.eq-it:hover .eq-m img{scale:1.03}
.eq-badge{position:absolute;left:12px;top:12px;z-index:2;padding:5px 11px;border-radius:var(--rb);background:var(--c-bg);color:var(--c-text);font-size:.78rem;font-weight:650;line-height:1.2}.eq-out{background:var(--c-text);color:var(--c-bg)}
.eq-nopic .eq-badge{position:static;justify-self:start;border:1px solid var(--line);background:none;color:inherit}
.eq-b{display:grid;gap:10px;justify-items:start}.eq-h{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 18px;width:100%}
.eq-t{font-size:clamp(1.2rem,calc((1rem + .6vw)*var(--ts)),1.55rem)}.eq-wide .eq-t{font-size:clamp(1.35rem,calc((1rem + 1vw)*var(--ts)),2rem)}
.eq-price{font-weight:650;white-space:nowrap;font-variant-numeric:lining-nums tabular-nums}.eq-price span{font-weight:400;color:var(--muted);font-size:.9rem}
.eq-x{color:var(--muted);font-size:.96rem;max-width:46ch;text-wrap:pretty}.eq-go{margin-top:6px;min-height:44px;font-size:.93rem}
.eq-rows{gap:0}.eq-rows .eq-it{grid-template-columns:88px minmax(0,1fr);gap:16px;padding:calc(var(--u)*2.5) 0;border-top:1px solid var(--line);align-items:start}.eq-rows .eq-it:last-child{border-bottom:1px solid var(--line)}.eq-rows .eq-nopic{grid-template-columns:minmax(0,1fr)}
.eq-rows .eq-m img,.eq-rows .eq-m .ph-img{aspect-ratio:1;min-height:0}.eq-rows .eq-m .ph-img span{font-size:.7rem;padding:3px 6px}.eq-rows .eq-badge{left:6px;top:6px;font-size:.7rem;padding:3px 7px}
@media (min-width:760px){.eq-rows .eq-it{grid-template-columns:150px minmax(0,1fr);gap:36px;align-items:center}.eq-rows .eq-b{grid-template-columns:minmax(0,1fr) auto;column-gap:48px;align-items:center}.eq-rows .eq-b>*{grid-column:1}.eq-rows .eq-go{grid-column:2;grid-row:1/span 3;margin:0}}`,
  payment: `.pay{list-style:none;display:grid;gap:16px}.pay-cards{grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr))}
.pay-cards .pay-it{display:grid;align-content:start;gap:calc(var(--u)*2.5);padding:calc(var(--u)*3.5);border:1px solid var(--line);border-radius:var(--r)}
.pay-name{font-family:var(--f-d);font-weight:var(--dw);letter-spacing:var(--dt);font-stretch:var(--ds);font-size:clamp(1.3rem,calc((1rem + .8vw)*var(--ts)),1.7rem);line-height:1.1}
.pay-qr{width:100%;max-width:240px;padding:14px;background:#fff;border:1px solid var(--line);border-radius:var(--ri)}.pay-qr img,.pay-qr .ph-img{width:100%;aspect-ratio:1;object-fit:contain;min-height:0}
.pay-dl{display:grid;gap:12px}.pay-dl dt{font-size:.8rem;font-weight:600;color:var(--muted)}.pay-dl dd{margin-top:2px;font-weight:500}
.pay-num{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}.pay-v{font-size:1.15rem;font-weight:650;letter-spacing:.02em;font-variant-numeric:lining-nums tabular-nums;user-select:all;overflow-wrap:anywhere}
.pay-copy{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 13px;border:1px solid var(--line);border-radius:var(--rb);background:transparent;color:inherit;font:600 .86rem var(--f-b);cursor:pointer;transition:border-color .2s ${EASE},background-color .2s ${EASE},color .2s ${EASE}}.pay-copy:hover{border-color:currentColor}.pay-copy .ic{width:16px;height:16px}.pay-copy.done{background:var(--text);color:var(--bg);border-color:var(--text)}
html:not(.js) .pay-copy{display:none}.pay-more{list-style:none;display:grid;gap:4px;margin-top:12px;color:var(--muted);font-size:.93rem}
.pay-note{margin-top:calc(var(--u)*4);max-width:64ch;text-wrap:pretty}
.pay-list{gap:0}.pay-list .pay-it{display:grid;grid-template-columns:112px minmax(0,1fr);gap:12px 20px;padding:calc(var(--u)*3.5) 0;border-top:1px solid var(--line);align-items:start}.pay-list .pay-it:last-child{border-bottom:1px solid var(--line)}.pay-list .pay-name{grid-column:1/-1}.pay-list .pay-qr{padding:8px}.pay-list .pay-noqr{grid-template-columns:minmax(0,1fr)}
@media (min-width:760px){.pay-list .pay-it{grid-template-columns:minmax(0,3fr) 170px minmax(0,6fr);gap:40px}.pay-list .pay-name{grid-column:auto}.pay-list .pay-noqr .pay-info{grid-column:3}}
.bg-ink .pay-qr,.bg-accent .pay-qr{border-color:transparent}`,
  videofeature: `.vf-face{position:relative;display:block;overflow:hidden;background:#141414;color:#fff;text-decoration:none;border-radius:var(--ri)}.vf-img{width:100%;height:100%;object-fit:cover;transition:transform .9s ${EASE}}.vf-face:hover .vf-img{transform:scale(1.03)}
.vf-face .ph-img{height:100%;min-height:0;border-radius:0}
.vf-play{position:absolute;left:50%;top:50%;z-index:2;width:clamp(68px,7vw,96px);height:clamp(68px,7vw,96px);translate:-50% -50%;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.95);color:#111;transition:transform .25s ${EASE}}.vf-play svg{width:36%;height:36%;fill:currentColor;margin-left:7%}
.vf-face:hover .vf-play,.vf-face:focus-visible .vf-play{transform:scale(1.07)}.vf-src{position:absolute;left:0;right:0;bottom:20px;z-index:2;padding:0 20px;text-align:center;font-size:.9rem;color:rgba(255,255,255,.82)}
.vf-frame{display:block;width:100%;aspect-ratio:16/9;border:0;border-radius:var(--ri);background:#000}.vf-frame.vf-v{aspect-ratio:9/16;width:auto;height:min(78vh,720px);max-width:100%;margin-inline:auto}
.b-videofeature.v-overlay:has(.vf-overlay){padding:0;background:#111;color:#fff}
.vf-overlay{position:relative;--text:#fff;--muted:rgba(255,255,255,.86);--line:rgba(255,255,255,.35);color:#fff}.vf-overlay .vf-stage{position:relative}
.vf-overlay .vf-face{border-radius:0;width:100%;aspect-ratio:4/5;max-height:94vh}@media (min-width:760px){.vf-overlay .vf-face{aspect-ratio:16/9}}.vf-overlay .vf-play{top:40%}
.vf-scrim{position:absolute;inset:0;pointer-events:none;background:linear-gradient(to top,rgba(8,8,8,.82),rgba(8,8,8,.38) 42%,rgba(8,8,8,0) 72%)}
.vf-overlay .vf-copy{position:absolute;left:0;right:0;bottom:0;z-index:3;display:grid;gap:calc(var(--u)*2.5);justify-items:start;padding-bottom:calc(var(--u)*6);pointer-events:none}.vf-overlay .vf-copy a{pointer-events:auto}html[data-edit] .vf-overlay .vf-copy{pointer-events:auto}
@media (min-width:900px){.vf-overlay .vf-copy{padding-bottom:calc(var(--u)*9)}}.vf-overlay .vf-h{max-width:16ch}.vf-overlay .lede{color:var(--muted)}.vf-overlay .cap{color:rgba(255,255,255,.78)}
.vf-overlay .btn-p{background:#fff;color:#111;border-color:#fff}.vf-overlay .btn-p:hover{background:rgba(255,255,255,.86)}body.bs-underline .vf-overlay .btn{background:none;color:#fff;border-bottom-color:#fff}
.vf-overlay.playing .vf-copy{position:static;pointer-events:auto;padding-top:calc(var(--u)*4)}.vf-overlay.playing .vf-scrim{display:none}.vf-overlay .vf-frame{border-radius:0}
.b-videofeature.v-cinema.bg-page{--bg:#0f0f0e;--text:#f2f0eb;--muted:rgba(242,240,235,.72);--line:rgba(242,240,235,.16);--surface:#1b1b19;--at:#f2f0eb}.b-videofeature.v-cinema.bg-page .btn-p{background:#f2f0eb;color:#111;border-color:#f2f0eb}
.vf-cinema{display:grid;gap:calc(var(--u)*5)}.vf-head{display:grid;gap:calc(var(--u)*2.5);justify-items:center;text-align:center;max-width:860px;margin-inline:auto}.vf-head .lede{margin-inline:auto}
.vf-cinema .vf-face{aspect-ratio:16/9}@media (min-width:900px){.vf-cinema .vf-face{aspect-ratio:21/9}}.vf-cinema .cap{text-align:center}
.vf-split{display:grid;gap:calc(var(--u)*5);align-items:center}@media (min-width:900px){.vf-split{grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:calc(var(--u)*10)}.vf-isv{grid-template-columns:minmax(0,6fr) minmax(0,5fr)}}
.vf-split .vf-copy{display:grid;gap:calc(var(--u)*2.5);justify-items:start}.vf-split .vf-face{aspect-ratio:16/10}
.vf-isv .vf-side{display:grid;justify-items:center}.vf-isv .vf-face{aspect-ratio:9/16;width:min(100%,calc(min(78vh,720px)*9/16))}`,
  share: `.sh{display:grid;gap:calc(var(--u)*4)}@media (min-width:900px){.sh-band{grid-template-columns:minmax(0,6fr) minmax(0,5fr);gap:calc(var(--u)*10);align-items:end}}
.sh-copy{display:grid;gap:calc(var(--u)*2.5)}.sh-h{font-size:clamp(1.9rem,calc((1rem + 2.4vw)*var(--ts)),3.4rem);max-width:18ch}
.sh-acts{display:grid;gap:calc(var(--u)*4);justify-items:start}.sh-file{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px}.sh-dl .ic{width:18px;height:18px}.sh-note{color:var(--muted);font-size:.9rem}
.sh-share{display:grid;gap:12px}.sh-l{font-size:.85rem;font-weight:600;color:var(--muted)}.sh-ul{list-style:none;display:flex;flex-wrap:wrap;gap:8px}
.sh-b{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border:1px solid var(--line);border-radius:var(--rb);background:transparent;color:inherit;font:600 .92rem var(--f-b);text-decoration:none;cursor:pointer;transition:border-color .2s ${EASE},background-color .2s ${EASE},color .2s ${EASE}}
.sh-b:hover{border-color:currentColor;background:color-mix(in srgb,currentColor 5%,transparent)}.sh-b .ic{width:16px;height:16px}.sh-b.done{background:var(--text);color:var(--bg);border-color:var(--text)}html:not(.js) .sh-share{display:none}
.sh-card{padding:calc(var(--u)*4);gap:calc(var(--u)*4);border-radius:var(--r);background:var(--surface)}@media (min-width:760px){.sh-card{grid-template-columns:minmax(0,4fr) minmax(0,7fr);padding:calc(var(--u)*7);gap:calc(var(--u)*8);align-items:center}.sh-card.sh-nocover{grid-template-columns:minmax(0,1fr)}}
.sh-cover{max-width:300px;width:100%;box-shadow:0 26px 50px -30px rgba(0,0,0,.5)}.sh-cover img,.sh-cover .ph-img{width:100%;aspect-ratio:3/4;object-fit:cover}.sh-body{display:grid;gap:calc(var(--u)*3);justify-items:start}
.sh-inline{display:flex;flex-wrap:wrap;align-items:center;gap:16px 28px;padding:calc(var(--u)*3) 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.sh-ih{margin-right:auto;font:650 1.15rem/1.3 var(--f-b);letter-spacing:0;font-stretch:var(--bs);text-transform:none!important}.sh-inline .sh-share{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px}`,
  visit: `.vs{display:grid;gap:calc(var(--u)*6)}.vs-info{display:grid;gap:calc(var(--u)*2.5);align-content:start;justify-items:start}.vs-dl{margin-top:4px}
.vs-hours{list-style:none;display:grid;gap:2px;white-space:pre-line;font-variant-numeric:lining-nums proportional-nums}
.vs-form{padding:calc(var(--u)*3.5);background:var(--surface);border-radius:var(--r)}@media (min-width:760px){.vs-form{padding:calc(var(--u)*5)}}
.vs .map-frame{height:320px}.vs-side{display:grid;gap:calc(var(--u)*5);align-content:start}
@media (min-width:900px){.vs-split{grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:calc(var(--u)*9);align-items:start}}
.vs-top .map-frame{height:clamp(300px,46vh,480px)}.vs-row{display:grid;gap:calc(var(--u)*6)}@media (min-width:900px){.vs-row{grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:calc(var(--u)*9);align-items:start}}`,
};
/** CSS for exactly the blocks on a page (plus the base and the theme). */
export function pageCss(site: Site, types: string[]): string {
  const need = new Set(types);
  if (['contact', 'booking', 'newsletter', 'visit'].some((t) => need.has(t))) need.add('form');
  if (need.has('visit')) need.add('map');
  if (need.has('expand')) need.add('faq');
  if (need.has('testimonials')) need.add('gallery');
  return themeCss(site.theme) + BASE + [...need].map((t) => CSS[t] ?? '').join('') + PERSONA_CSS;
}
export const allCss = (site: Site) => pageCss(site, [...Object.keys(CSS)]);

/* ---------------- whole pages ---------------- */
export interface DocOptions { canonical?: string; extraHead?: string; siteJs?: string; /** CSS for every block type (the editor canvas, where blocks come and go). */ allCss?: boolean }
export function renderBody(c: RenderCtx): string {
  const anchors = anchorsFor(c.page);
  const head = c.site.header ? renderBlock(c, c.site.header) : '';
  // Announcement bars at the very top of the page sit above the header.
  let lead = 0;
  while (c.page.blocks[lead]?.type === 'announce') lead++;
  const top = c.page.blocks.slice(0, lead).map((b) => renderBlock(c, b, anchors[b.id])).join('\n');
  const blocks = c.page.blocks.slice(lead).map((b) => renderBlock(c, b, anchors[b.id])).join('\n');
  const foot = c.site.footer ? renderBlock(c, c.site.footer) : '';
  return `<a class="skip" href="#main">Skip to content</a>\n${top ? top + '\n' : ''}${head}\n<main id="main">\n${blocks}\n</main>\n${foot}`;
}
export const bodyClass = (site: Site) => cls(`bs-${site.theme.button}`, site.theme.caps && 'caps', `t-${site.theme.preset}`);

/** The page's title and description for search engines and link previews. */
export function pageMeta(site: Site, page: Page) {
  const isHome = site.pages[0]?.id === page.id;
  const title = page.seoTitle || (isHome ? (site.settings.tagline ? `${site.name}: ${site.settings.tagline}` : site.name) : `${page.title} · ${site.name}`);
  let description = page.seoDescription;
  if (!description) {
    for (const b of page.blocks) {
      const t = textOf(b.props.text || b.props.intro || b.props.body || '');
      if (t.length > 40) { description = t; break; }
    }
  }
  description = (description || site.settings.tagline || site.name).slice(0, 170);
  return { title: title.slice(0, 90), description };
}

export function renderDocument(c: RenderCtx, o: DocOptions = {}): string {
  const { site, page } = c;
  const meta = pageMeta(site, page);
  const types = [...new Set([...(site.header ? ['header'] : []), ...page.blocks.map((b) => b.type), ...(site.footer ? ['footer'] : [])])];
  const fav = site.settings.favicon?.src ? c.asset(site.settings.favicon.src) : null;
  const social = site.settings.socialImage?.src ? c.asset(site.settings.socialImage.src) : null;
  const firstImg = page.blocks.map((b) => b.props.image?.src).find(Boolean);
  const ogImg = social ?? (firstImg ? c.asset(firstImg) : null);
  const preload = [...new Set([site.theme.display, site.theme.body])].map((id) => `<link rel="preload" href="/_jhino/fonts/s-${id}.woff2" as="font" type="font/woff2" crossorigin>`).join('');
  const isHome = site.pages[0]?.id === page.id;
  const ld = isHome ? `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'LocalBusiness', name: site.name,
    ...(meta.description ? { description: meta.description } : {}),
    ...(site.settings.phone ? { telephone: site.settings.phone } : {}),
    ...(site.settings.email ? { email: site.settings.email } : {}),
    ...(site.settings.address ? { address: site.settings.address } : {}),
    ...(site.settings.social.length ? { sameAs: site.settings.social.map((s) => s.url) } : {}),
  }).replace(/</g, '\\u003c')}</script>` : '';
  const ogUrl = (u: string) => (/^https?:/.test(u) ? u : `%%ORIGIN%%%%ROOT%%${u.replace(/^(\.\.\/)+|^\.\//, '')}`.replace('%%ROOT%%/_jhino', '/_jhino'));
  return `<!doctype html>
<html lang="${site.settings.lang}"${c.mode === 'edit' ? ' data-edit' : c.mode === 'preview' ? ' data-preview' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}">
<meta name="generator" content="Jhino website builder">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(site.name)}"><meta property="og:title" content="${esc(meta.title)}"><meta property="og:description" content="${esc(meta.description)}">
${ogImg ? `<meta property="og:image" content="${esc(ogUrl(ogImg.url))}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
${fav ? `<link rel="icon" href="${esc(fav.url)}">` : ''}
<meta name="theme-color" content="${esc(site.theme.colors.bg)}">
${o.canonical ? `<link rel="canonical" href="${esc(o.canonical)}">` : ''}<!--jhino:head-->
${preload}
<style id="site-css">${o.allCss ? allCss(site) : pageCss(site, types)}</style>
${o.extraHead ?? ''}
<script src="${esc(o.siteJs ?? '/_jhino/site.js')}" defer></script>
${ld}
</head>
<body class="${bodyClass(site)}">
${renderBody(c)}
</body>
</html>
`;
}

/** Where a page's file goes in a version folder, and how pages link to each other from there. */
export const pageFile = (p: Page) => (p.slug ? `${p.slug}/index.html` : 'index.html');
export function relativePageHref(from: Page, to: Page): string {
  const up = from.slug ? '../' : './';
  return to.slug ? `${up}${to.slug}/` : up;
}
/** Library photos: /_jhino/site-img/<name>-<width>.webp. */
export function libraryAsset(name: string) {
  const l = LIBRARY[name];
  if (!l) return null;
  const w = l.widths;
  return { url: `/_jhino/site-img/${name}-${w[w.length - 1]}.webp`, srcset: w.length > 1 ? w.map((x) => `/_jhino/site-img/${name}-${x}.webp ${x}w`).join(', ') : undefined };
}
/** The smallest file of a library photo (thumbnails in the photo picker). */
export function libraryThumb(name: string) {
  const l = LIBRARY[name];
  return l ? `/_jhino/site-img/${name}-${l.widths[0]}.webp` : '';
}
export const FONT_IDS = FONTS.map((f) => f.id);
void blockDef;
