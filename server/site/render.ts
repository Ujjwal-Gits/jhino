import {
  FONTS, LIBRARY, blockDef, esc, fontById, safeHref, textOf,
  type Block, type ImageRef, type LinkRef, type Page, type Site, type Theme,
} from './schema.js';

/*
 * Site JSON → HTML. One renderer for three places:
 * - publish: static files in a version folder (index.html, <slug>/index.html), links relative to the page;
 * - preview: the draft in a tab of its own;
 * - edit: the editor's canvas, with data-* hooks on every editable text, image and link.
 * Everything visitors typed is escaped here; inline HTML props were sanitised by schema.ts before they
 * got this far (cleanSite runs on every save and publish).
 * Only the CSS of the blocks a page uses is inlined; the one script (/_jhino/site.js) is deferred.
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

/** An image. Without one: nothing on the site, a quiet "Add a photo" frame in the editor. */
function img(c: RenderCtx, path: string, ref: ImageRef | undefined, o: { sizes?: string; className?: string; eager?: boolean; ratio?: string } = {}) {
  const a = ref?.src ? c.asset(ref.src) : null;
  if (!a) {
    if (!edit(c)) return '';
    return `<div${attrs({ class: cls('ph-img', o.className), 'data-img': path, style: o.ratio ? `aspect-ratio:${o.ratio}` : undefined })}><span>Add a photo</span></div>`;
  }
  const pos = ref!.focal ? `object-position:${ref!.focal[0]}% ${ref!.focal[1]}%` : undefined;
  return `<img${attrs({
    class: o.className, src: a.url, srcset: a.srcset, sizes: a.srcset ? o.sizes ?? '100vw' : undefined, alt: ref!.alt || '',
    loading: o.eager ? 'eager' : 'lazy', fetchpriority: o.eager ? 'high' : undefined, decoding: 'async', style: pos,
    'data-img': edit(c) ? path : undefined,
  })}>`;
}

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
const nl2br = (s: string) => String(s ?? '').replace(/\n/g, '<br>');
const lines = (s: string) => textOf(String(s ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/\n/g, '\u0001')).split('\u0001').map((x) => x.trim()).filter(Boolean);

/* ---------------- blocks ---------------- */
type R = (c: RenderCtx, b: Block, p: any) => string;

const head2 = (c: RenderCtx, p: any, intro = 'intro', h = 'heading') => T(c, h, p[h], 'h2', 'h2', 'Heading') + (intro in p ? T(c, intro, p[intro], 'p', 'lede', 'A short intro', 'para') : '');
const has = (x: string) => !!textOf(x);

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

const hero: R = (c, b, p) => {
  const first = c.page.blocks[0]?.id === b.id;
  const text = T(c, 'eyebrow', p.eyebrow, 'p', 'eyebrow', 'Small line above') + T(c, 'title', p.title, 'h1', 'h1', 'Headline') + T(c, 'text', p.text, 'p', 'lede', 'A sentence or two', 'para')
    + buttons(c, ['primary', p.primary], ['secondary', p.secondary]);
  if (b.variant === 'text') return `<div class="wrap hero-t">${text}</div>`;
  if (b.variant === 'split') {
    return `<div class="wrap hero-s"><div class="hero-copy">${text}</div><div class="hero-media">${img(c, 'image', p.image, { eager: first, sizes: '(min-width: 900px) 50vw, 100vw', ratio: '4/5' })}</div></div>`;
  }
  const media = b.variant === 'video' && /^https:\/\/[^\s]+\.(mp4|webm)(\?[^\s]*)?$/i.test(p.video) && !edit(c)
    ? `<video class="hero-bg" autoplay muted loop playsinline preload="metadata"${p.image?.src && c.asset(p.image.src) ? ` poster="${esc(c.asset(p.image.src)!.url)}"` : ''}><source src="${esc(p.video)}"></video>`
    : img(c, 'image', p.image, { eager: first, className: 'hero-bg', sizes: '100vw' });
  return `${media}<div class="hero-scrim" aria-hidden="true"></div><div class="wrap hero-over">${text}</div>`;
};

const footer: R = (c, b, p) => {
  const s = c.site;
  const year = new Date().getFullYear();
  const note = p.note ? `<p class="f-note"${edit(c) ? attrs({ 'data-f': 'note', 'data-kind': 'text', 'data-ph': 'Small print' }) : ''}>${p.note}</p>`
    : `<p class="f-note"${edit(c) ? attrs({ 'data-f': 'note', 'data-kind': 'text', 'data-ph': `© ${year} ${s.name}` }) : ''}>${edit(c) ? '' : `© ${year} ${esc(s.name)}`}</p>`;
  const pages = p.showPages ? `<ul class="f-pages">${s.pages.filter((x) => x.nav).map((x) => `<li><a href="${esc(c.pageHref(x))}">${esc(x.title)}</a></li>`).join('')}</ul>` : '';
  const st = s.settings;
  const contact = p.showContact && (st.phone || st.email || st.address) ? `<ul class="f-contact">${st.address ? `<li>${esc(st.address)}</li>` : ''}${st.phone ? `<li><a href="tel:${esc(st.phone.replace(/[^\d+]/g, ''))}">${esc(st.phone)}</a></li>` : ''}${st.email ? `<li><a href="mailto:${esc(st.email)}">${esc(st.email)}</a></li>` : ''}</ul>` : '';
  const social = p.showSocial && st.social.length ? `<ul class="f-social">${st.social.map((x) => `<li><a href="${esc(x.url)}" rel="noopener me" target="_blank">${esc(netName(x.network))}</a></li>`).join('')}</ul>` : '';
  const about = T(c, 'about', p.about, 'p', 'f-about', 'One line about you', 'para');
  if (b.variant === 'simple') return `<div class="wrap f-simple"><span class="f-name">${esc(s.name)}</span>${pages}${social}${note}</div>`;
  if (b.variant === 'big') return `<div class="wrap"><p class="f-big" aria-hidden="true">${esc(s.name)}</p><div class="f-row">${about}${contact}${pages}${social}</div>${note}</div>`;
  return `<div class="wrap"><div class="f-cols"><div><p class="f-name">${esc(s.name)}</p>${about}</div>${pages ? `<div><p class="f-h">Pages</p>${pages}</div>` : ''}${contact || social ? `<div><p class="f-h">Contact</p>${contact}${social}</div>` : ''}</div>${note}</div>`;
};

const richtext: R = (c, b, p) => {
  const body = T(c, 'body', p.body, 'div', 'prose', 'Write here', 'rich');
  if (b.variant === 'split') return `<div class="wrap rt-split">${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}${body}</div>`;
  return `<div class="wrap ${b.variant === 'wide' ? 'rt-wide' : 'rt-narrow'}">${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}${body}</div>`;
};

const image: R = (c, b, p) => {
  const cap = T(c, 'caption', p.caption, 'figcaption', 'cap', 'Caption');
  const im = img(c, 'image', p.image, { sizes: b.variant === 'full' ? '100vw' : '(min-width: 1240px) 1200px, 100vw' });
  if (!im && !cap) return '';
  if (b.variant === 'full') return `<figure class="img-full">${im}<div class="wrap">${cap}</div></figure>`;
  if (b.variant === 'framed') return `<figure class="wrap img-framed">${im}${cap}</figure>`;
  return `<figure class="wrap img-c">${im}${cap}</figure>`;
};

const imagetext: R = (c, b, p) => {
  const text = `<div class="it-copy">${T(c, 'eyebrow', p.eyebrow, 'p', 'eyebrow', 'Small line above')}${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}${T(c, 'body', p.body, 'div', 'prose', 'Write here', 'rich')}${buttons(c, ['link', p.link])}</div>`;
  const media = `<div class="it-media">${img(c, 'image', p.image, { sizes: '(min-width: 900px) 50vw, 100vw', ratio: '4/3' })}</div>`;
  return `<div class="wrap it it-${b.variant}">${b.variant === 'right' ? text + media : media + text}</div>`;
};

const gallery: R = (c, b, p) => {
  const items = (p.images ?? []).map((it: any, i: number) => {
    const im = img(c, `images.${i}.image`, it.image, { sizes: b.variant === 'carousel' ? '(min-width: 900px) 45vw, 85vw' : '(min-width: 900px) 33vw, 50vw', ratio: b.variant === 'masonry' ? undefined : b.variant === 'carousel' ? '4/3' : '1' });
    if (!im) return '';
    return `<figure class="g-it">${im}${T(c, `images.${i}.caption`, it.caption, 'figcaption', 'cap', 'Caption')}</figure>`;
  }).join('');
  const top = has(p.heading) || has(p.intro) || edit(c) ? `<div class="wrap sec-head">${head2(c, p)}</div>` : '';
  if (b.variant === 'carousel') {
    return `${top}<div class="car" data-car><div class="car-track wrap-bleed" tabindex="0" aria-label="${esc(textOf(p.heading) || 'Photos')}">${items}</div><div class="wrap car-nav"><button type="button" data-dir="-1" aria-label="Previous">&#8592;</button><button type="button" data-dir="1" aria-label="Next">&#8594;</button></div></div>`;
  }
  return `${top}<div class="wrap g-${b.variant}">${items}</div>`;
};

const video: R = (c, b, p) => {
  const vid = videoOf(p.url);
  let player: string;
  if (vid) {
    const thumb = vid.thumb ? `<img src="${esc(vid.thumb)}" alt="" loading="lazy" decoding="async">` : '';
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
    `<li class="ft-it">${b.variant === 'rows' ? `<span class="ft-n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>` : ''}<div class="ft-main">${T(c, `items.${i}.title`, it.title, 'h3', 'h3', 'Name')}${T(c, `items.${i}.text`, it.text, 'p', 'ft-t', 'Description', 'para')}</div>${it.detail ? `<p class="ft-d">${P(it.detail)}</p>` : ''}</li>`).join('');
  return `<div class="wrap"><div class="sec-head">${head2(c, p)}</div><ul class="ft ft-${b.variant}" role="list">${items}</ul></div>`;
};

const pricing: R = (c, b, p) => {
  const lang = c.site.settings.lang;
  const plans = (p.plans ?? []).map((pl: any, i: number) => {
    const price = money(pl.price, p.currency, lang);
    const feats = lines(pl.features);
    const list = feats.length ? `<ul class="pr-f">${feats.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '';
    return `<li class="${cls('pr-it', pl.featured && 'pr-on')}"><div class="pr-top">${T(c, `plans.${i}.name`, pl.name, 'h3', 'h3', 'Package')}${price ? `<p class="pr-price"><b>${price}</b>${pl.period ? `<span> / ${P(pl.period)}</span>` : ''}</p>` : ''}${T(c, `plans.${i}.note`, pl.note, 'p', 'pr-note', 'Short note', 'para')}</div>${list}${button(c, `plans.${i}.cta`, pl.cta, pl.featured ? 'p' : 's')}</li>`;
  }).join('');
  return `<div class="wrap"><div class="sec-head">${head2(c, p)}</div><ul class="pr pr-${b.variant}" role="list">${plans}</ul></div>`;
};

const menu: R = (c, b, p) => {
  const lang = c.site.settings.lang;
  const secs = (p.sections ?? []).map((s: any, i: number) => {
    const items = (s.items ?? []).map((it: any, j: number) => {
      const base = `sections.${i}.items.${j}`;
      const price = money(it.price, p.currency, lang);
      return `<li class="mi"><div class="mi-row">${T(c, `${base}.name`, it.name, 'h4', 'mi-name', 'Name')}${it.tag ? `<span class="mi-tag">${P(it.tag)}</span>` : ''}<span class="mi-dots" aria-hidden="true"></span>${price ? `<span class="mi-price">${price}</span>` : ''}</div>${T(c, `${base}.desc`, it.desc, 'p', 'mi-desc', 'What is in it', 'para')}</li>`;
    }).join('');
    return `<section class="mn-sec">${T(c, `sections.${i}.title`, s.title, 'h3', 'h3 mn-h', 'Section')}${T(c, `sections.${i}.note`, s.note, 'p', 'mn-note', 'Section note', 'para')}<ul role="list">${items}</ul></section>`;
  }).join('');
  return `<div class="wrap"><div class="sec-head">${head2(c, p)}</div><div class="mn mn-${b.variant}">${secs}</div></div>`;
};

const team: R = (c, b, p) => {
  const people = (p.people ?? []).map((m: any, i: number) => {
    const face = b.variant === 'grid' ? img(c, `people.${i}.image`, m.image, { sizes: '(min-width: 900px) 25vw, 50vw', ratio: '4/5', className: 'tm-img' })
      : b.variant === 'monogram' ? `<span class="tm-mono" aria-hidden="true">${esc(initials(m.name))}</span>` : '';
    return `<li class="tm-it">${face}<div>${T(c, `people.${i}.name`, m.name, 'h3', 'h3', 'Name')}${T(c, `people.${i}.role`, m.role, 'p', 'tm-role', 'Role')}${T(c, `people.${i}.bio`, m.bio, 'p', 'tm-bio', 'Short bio', 'para')}</div></li>`;
  }).join('');
  return `<div class="wrap"><div class="sec-head">${head2(c, p)}</div><ul class="tm tm-${b.variant}" role="list">${people}</ul></div>`;
};

const testimonials: R = (c, b, p) => {
  const items = (p.items ?? []).map((q: any, i: number) =>
    `<figure class="q-it"><blockquote>${T(c, `items.${i}.quote`, q.quote, 'p', 'q-text', 'Their words', 'para')}</blockquote><figcaption>${T(c, `items.${i}.name`, q.name, 'span', 'q-name', 'Name')}${T(c, `items.${i}.detail`, q.detail, 'span', 'q-detail', 'Who they are')}</figcaption></figure>`).join('');
  const top = has(p.heading) || edit(c) ? `<div class="sec-head">${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}</div>` : '';
  if (b.variant === 'carousel') return `<div class="wrap">${top}</div><div class="car" data-car><div class="car-track wrap-bleed q-car" tabindex="0" aria-label="Testimonials">${items}</div><div class="wrap car-nav"><button type="button" data-dir="-1" aria-label="Previous">&#8592;</button><button type="button" data-dir="1" aria-label="Next">&#8594;</button></div></div>`;
  return `<div class="wrap">${top}<div class="q q-${b.variant}">${items}</div></div>`;
};

const logos: R = (c, b, p) => {
  const items = (p.items ?? []).map((l: any, i: number) => {
    const a = l.image?.src ? c.asset(l.image.src) : null;
    const inner = a ? `<img src="${esc(a.url)}" alt="${esc(l.name || l.image.alt)}" loading="lazy" decoding="async"${edit(c) ? attrs({ 'data-img': `items.${i}.image` }) : ''}>` : `<span class="lg-name">${P(l.name)}</span>`;
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
    return `<details class="fq-it"${b.variant === 'accordion' ? ` name="fq-${b.id}"` : ''}${edit(c) ? ' open' : ''}><summary>${T(c, `items.${i}.q`, q.q, 'span', 'fq-q', 'Question')}</summary>${T(c, `items.${i}.a`, q.a, 'p', 'fq-a', 'Answer', 'para')}</details>`;
  }).join('');
  if (b.variant === 'split') return `<div class="wrap fq-split"><div>${head2(c, p)}</div><div class="fq">${items}</div></div>`;
  return `<div class="wrap rt-narrow"><div class="sec-head">${head2(c, p)}</div><div class="fq">${items}</div></div>`;
};

const cta: R = (c, b, p) => {
  const copy = T(c, 'title', p.title, 'h2', 'h2', 'Heading') + T(c, 'text', p.text, 'p', 'lede', 'A short text', 'para');
  const acts = buttons(c, ['primary', p.primary], ['secondary', p.secondary]);
  if (b.variant === 'split') return `<div class="wrap cta-split"><div>${copy}</div>${acts}</div>`;
  if (b.variant === 'boxed') return `<div class="wrap"><div class="cta-box">${copy}${acts}</div></div>`;
  return `<div class="wrap cta-band">${copy}${acts}</div>`;
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
  const details = `<div class="ct-info">${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}${T(c, 'text', p.text, 'p', 'lede', 'A short text', 'para')}<dl class="ct-dl">${addr ? `<div><dt>Address</dt><dd>${addr}</dd></div>` : ''}${phone ? `<div><dt>Phone</dt><dd><a href="tel:${esc(String(phone).replace(/[^\d+]/g, ''))}">${esc(phone)}</a></dd></div>` : ''}${email ? `<div><dt>Email</dt><dd><a href="mailto:${esc(email)}">${esc(email)}</a></dd></div>` : ''}</dl></div>`;
  const form = formShell(c, b, input(b, 'name', 'Your name', { required: true, auto: 'name', max: 120 }) + input(b, 'email', 'Email', { type: 'email', auto: 'email' })
    + (p.askPhone ? input(b, 'phone', 'Phone', { type: 'tel', auto: 'tel', max: 40 }) : '') + input(b, 'message', 'Message', { required: true, long: true }), p.button, p.success);
  if (b.variant === 'form') return `<div class="wrap rt-narrow"><div class="sec-head">${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}${T(c, 'text', p.text, 'p', 'lede', 'A short text', 'para')}</div>${form}</div>`;
  return `<div class="wrap ${b.variant === 'split' ? 'ct-split' : 'ct-stack'}">${details}${form}</div>`;
};

const booking: R = (c, b, p) => {
  const choices = lines(p.services);
  const pick = choices.length ? `<fieldset class="fl chips"><legend>What for</legend>${choices.map((x, i) => `<label class="chip"><input type="radio" name="choice" value="${esc(x)}"${i === 0 ? ' checked' : ''}><span>${esc(x)}</span></label>`).join('')}</fieldset>` : '';
  const when = `<div class="fl-row"><div class="fl"><label for="${fid(b, 'date')}">Date</label><input id="${fid(b, 'date')}" name="date" type="date" required></div>${p.askTime ? `<div class="fl"><label for="${fid(b, 'time')}">Time</label><input id="${fid(b, 'time')}" name="time" type="time" step="900"></div>` : ''}</div>`;
  const form = formShell(c, b, pick + when + `<div class="fl-row">${input(b, 'name', 'Your name', { required: true, auto: 'name', max: 120 })}${input(b, 'phone', 'Phone', { type: 'tel', auto: 'tel', required: true, max: 40 })}</div>`
    + input(b, 'email', 'Email', { type: 'email', auto: 'email' }) + input(b, 'notes', 'Anything we should know', { long: true, max: 2000 }), p.button, p.success);
  const copy = T(c, 'heading', p.heading, 'h2', 'h2', 'Heading') + T(c, 'text', p.text, 'p', 'lede', 'A short text', 'para');
  if (b.variant === 'form') return `<div class="wrap rt-narrow"><div class="sec-head">${copy}</div>${form}</div>`;
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
  const addrHtml = p.address || esc(c.site.settings.address);
  const q = p.query || textOf(addrHtml) || c.site.name;
  const src = mapEmbed(q, p.link);
  const dir = mapsLink(q, p.link);
  const frame = src ? (edit(c)
    ? `<div class="map-frame map-ph"><span>Map of ${esc(textOf(q))}</span></div>`
    : `<iframe class="map-frame" src="${esc(src)}" title="Map: ${esc(textOf(q))}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`) : '';
  const info = `<div class="map-info">${T(c, 'heading', p.heading, 'h2', 'h2', 'Heading')}${addrHtml ? `<p class="map-addr"${edit(c) && p.address ? attrs({ 'data-f': 'address', 'data-kind': 'para', 'data-ph': 'Address' }) : ''}>${addrHtml}</p>` : ''}${dir ? `<a class="btn btn-s" href="${esc(dir)}" target="_blank" rel="noopener">Get directions</a>` : ''}</div>`;
  if (b.variant === 'card') return `<div class="wrap"><div class="map-card">${info}</div></div>`;
  if (b.variant === 'split') return `<div class="wrap map-split">${info}${frame}</div>`;
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
    return `<li>${href || edit(c) ? `<a href="${esc(href || '#')}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''}${edit(c) ? attrs({ 'data-link': `items.${i}.url` }) : ''}>${inner}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v9M4 7.5 8 11.5l4-4M3 14h10"/></svg></a>` : ''}</li>`;
  }).join('');
  return `<div class="wrap">${T(c, 'heading', p.heading, 'h2', 'h2 sec-h', 'Heading')}<ul class="dl dl-${b.variant}" role="list">${items}</ul></div>`;
};

const NET: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', x: 'X', linkedin: 'LinkedIn', whatsapp: 'WhatsApp', viber: 'Viber', pinterest: 'Pinterest', behance: 'Behance', website: 'Website' };
const netName = (n: string) => NET[n] ?? 'Link';
const social: R = (c, b, p) => {
  const links = ((p.links ?? []).filter((l: any) => l.url).length ? p.links : c.site.settings.social).filter((l: any) => /^https?:/.test(l.url));
  if (!links.length && !edit(c)) return '';
  const items = links.map((l: any) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener me">${esc(netName(l.network))}</a></li>`).join('') || '<li class="muted">Add links in the block settings or Site settings</li>';
  return `<div class="wrap so so-${b.variant}">${T(c, 'heading', p.heading, 'h2', 'so-h', 'Heading')}<ul role="list">${items}</ul></div>`;
};

const spacer: R = (_c, b, p) => `<div class="wrap sp sp-${p.size ?? 'm'} sp-${b.variant}" aria-hidden="true">${b.variant === 'space' ? '' : '<hr>'}</div>`;

const RENDER: Record<string, R> = { header, hero, footer, richtext, image, imagetext, gallery, video, features, pricing, menu, team, testimonials, logos, stats, faq, cta, contact, booking, newsletter, hours, map, timeline, beforeafter, downloads, social, spacer };

/** One block as HTML (a <section>, or the header/footer element). */
export function renderBlock(c: RenderCtx, b: Block, anchor?: string): string {
  const r = RENDER[b.type];
  if (!r) return '';
  const inner = r(c, b, b.props ?? {});
  if (!inner && !edit(c)) return '';
  const st = b.style ?? { bg: 'page', space: 'm', hide: '' };
  const tag = b.type === 'header' ? 'header' : b.type === 'footer' ? 'footer' : 'section';
  const className = cls('blk', `b-${b.type}`, `v-${b.variant}`, `bg-${st.bg}`, `sp-${st.space}`, st.hide && `hide-${st.hide}`,
    b.type === 'header' && 'site-h', b.type === 'header' && b.props.sticky && 'sticky', b.type === 'footer' && 'site-f');
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
    css += `@font-face{font-family:"${f.family}";src:url(/_jhino/fonts/s-${f.id}.woff2) format("woff2");font-weight:${w};font-display:swap;unicode-range:${LATIN}}`;
    css += `@font-face{font-family:"${f.family}";src:url(/_jhino/fonts/s-${f.id}-ext.woff2) format("woff2");font-weight:${w};font-display:swap;unicode-range:${LATIN_EXT}}`;
    if (f.italic) css += `@font-face{font-family:"${f.family}";src:url(/_jhino/fonts/s-${f.id}-i.woff2) format("woff2");font-weight:${w};font-style:italic;font-display:swap;unicode-range:${LATIN}}`;
  }
  return css + `@font-face{font-family:"Site Deva";src:url(/_jhino/fonts/devanagari.woff2) format("woff2");font-weight:100 900;font-display:swap;unicode-range:${DEVA}}`;
}
const stack = (id: string) => { const f = fontById(id); return `"${f.family}","Site Deva",${f.fallback}`; };

/** The theme as CSS custom properties. Switching the theme restyles every block through these. */
export function themeCss(t: Theme): string {
  const d = fontById(t.display), b = fontById(t.body);
  const pad = { tight: [44, 76], even: [60, 104], airy: [76, 136] }[t.rhythm];
  const c = t.colors;
  return fontFaces([t.display, t.body]) + `:root{--c-bg:${c.bg};--c-surface:${c.surface};--c-text:${c.text};--c-muted:${c.muted};--c-accent:${c.accent};--c-on:${c.onAccent};--c-line:${c.line};`
    + `--f-d:${stack(t.display)};--f-b:${stack(t.body)};--dw:${d.display.weight};--dt:${d.display.tracking};--dl:${d.display.lead};--bw:${b.kind === 'mono' ? 400 : 400};`
    + `--r:${t.radius}px;--rb:${t.button === 'pill' ? '999px' : `${Math.min(t.radius, 14)}px`};--u:${(8 * t.space).toFixed(2)}px;--pad0:${pad[0]}px;--pad1:${pad[1]}px;`
    + `--bodysize:${b.kind === 'mono' ? '16px' : b.kind === 'serif' ? '18.5px' : '17px'}}`;
}

const BASE = `*,*::before,*::after{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important;animation:none!important}}
body{margin:0;background:var(--c-bg);color:var(--c-text);font:var(--bodysize)/1.62 var(--f-b);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
img,video{display:block;max-width:100%}a{color:inherit;text-underline-offset:.18em;text-decoration-thickness:1px}p,h1,h2,h3,h4,figure,blockquote,dl,dd{margin:0}ul,ol{margin:0;padding:0}
:focus-visible{outline:2px solid var(--accent,var(--c-accent));outline-offset:3px}
.skip{position:absolute;left:12px;top:-60px;z-index:50;background:var(--c-text);color:var(--c-bg);padding:10px 14px;border-radius:var(--rb);text-decoration:none}.skip:focus{top:12px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.blk{--bg:var(--c-bg);--surface:var(--c-surface);--text:var(--c-text);--muted:var(--c-muted);--accent:var(--c-accent);--on:var(--c-on);--line:var(--c-line);--k:1;background:var(--bg);color:var(--text);padding:calc(var(--pad0)*var(--k)) 0}
@media (min-width:900px){.blk{padding:calc(var(--pad1)*var(--k)) 0}}
.sp-s{--k:.55}.sp-l{--k:1.45}
.bg-surface{--bg:var(--c-surface);--surface:var(--c-bg)}
.bg-accent{--bg:var(--c-accent);--text:var(--c-on);--muted:color-mix(in srgb,var(--c-on) 88%,var(--c-accent));--accent:var(--c-on);--on:var(--c-accent);--line:color-mix(in srgb,var(--c-on) 28%,var(--c-accent));--surface:color-mix(in srgb,var(--c-on) 10%,var(--c-accent))}
.bg-ink{--bg:var(--c-text);--text:var(--c-bg);--muted:color-mix(in srgb,var(--c-bg) 68%,var(--c-text));--line:color-mix(in srgb,var(--c-bg) 20%,var(--c-text));--surface:color-mix(in srgb,var(--c-bg) 7%,var(--c-text))}
.bg-ink .btn-p{background:var(--c-bg);color:var(--c-text)}
@media (max-width:759px){.hide-mobile{display:none!important}}@media (min-width:760px){.hide-desktop{display:none!important}}
.wrap{width:min(100% - 40px,1180px);margin-inline:auto}@media (min-width:760px){.wrap{width:min(100% - 80px,1180px)}}
.rt-narrow{max-width:720px}
h1,h2,h3,h4,.f-big,.brand-name{font-family:var(--f-d);font-weight:var(--dw);letter-spacing:var(--dt);line-height:var(--dl);text-wrap:balance}
body.caps h1,body.caps h2,body.caps .h3,body.caps .f-big,body.caps .brand-name{text-transform:uppercase}
.h1{font-size:clamp(2.5rem,1.35rem + 4.6vw,5.4rem)}.h2{font-size:clamp(1.85rem,1.25rem + 2.1vw,3.05rem)}.h3{font-size:1.3rem;line-height:1.2}
.sec-head{display:grid;gap:calc(var(--u)*1.5);margin-bottom:calc(var(--u)*5);max-width:760px}.sec-h{margin-bottom:calc(var(--u)*4)}
.lede{font-size:1.14em;color:var(--muted);max-width:62ch;text-wrap:pretty}
.eyebrow{font-size:.8rem;font-weight:650;letter-spacing:.09em;text-transform:uppercase;color:var(--accent)}
.bg-accent .eyebrow{color:var(--text)}
.cap{font-size:.88rem;color:var(--muted);margin-top:calc(var(--u)*1.25)}
.acts{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:calc(var(--u)*1)}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 1.35em;border-radius:var(--rb);font:600 1rem/1.1 var(--f-b);text-decoration:none;border:1.5px solid transparent;transition:background-color .18s cubic-bezier(.2,.7,.2,1),color .18s,transform .18s cubic-bezier(.2,.7,.2,1);cursor:pointer}
.btn:active{transform:translateY(1px)}
.btn-p{background:var(--accent);color:var(--on);border-color:var(--accent)}.btn-p:hover{background:color-mix(in srgb,var(--accent) 86%,var(--text))}
.btn-s{border-color:currentColor;color:var(--text);background:transparent}.btn-s:hover{background:var(--surface)}
body.bs-outline .btn-p{background:transparent;color:var(--text);border-color:var(--text)}body.bs-outline .btn-p:hover{background:var(--text);color:var(--bg)}
body.bs-underline .btn{min-height:44px;padding:0 0 2px;border:0;border-bottom:2px solid var(--accent);border-radius:0;background:none;color:var(--text)}body.bs-underline .btn-s{border-bottom-color:var(--line)}body.bs-underline .btn:hover{border-bottom-color:var(--text);background:none}
body.bs-underline .acts{gap:28px}
.prose{display:grid;gap:1em;max-width:66ch}.prose ul,.prose ol{padding-left:1.25em;display:grid;gap:.35em}.prose h3{font-size:1.3rem;margin-top:.4em}.prose a{color:var(--accent)}.bg-accent .prose a{color:inherit}
figure img{width:100%}
.ph-img{display:grid;place-items:center;min-height:180px;background:repeating-linear-gradient(135deg,var(--surface) 0 12px,color-mix(in srgb,var(--surface) 70%,var(--bg)) 12px 24px);color:var(--muted);font-size:.9rem;border-radius:var(--r)}
.ph-img span{background:var(--bg);padding:6px 10px;border-radius:var(--rb)}
`;
const CSS: Record<string, string> = {
  header: `.site-h{--k:0;padding:14px 0;border-bottom:1px solid var(--line);z-index:20}.site-h.sticky{position:sticky;top:0}
.h-in{display:flex;align-items:center;gap:24px}.brand{display:flex;align-items:center;text-decoration:none;margin-right:auto;min-height:44px}.brand .logo{height:40px;width:auto}.brand-name{font-size:1.35rem}
.h-nav ul{list-style:none;display:flex;gap:22px;flex-wrap:wrap}.h-nav a{text-decoration:none;font-weight:500;padding:10px 0;display:inline-block}.h-nav a:hover,.h-nav a[aria-current]{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:.35em;text-decoration-color:var(--accent)}
.nav-t{display:none;align-items:center;gap:8px;min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:var(--rb);background:transparent;color:inherit;font:600 .95rem var(--f-b);cursor:pointer}
.nav-i,.nav-i::before{display:block;width:16px;height:1.5px;background:currentColor;position:relative}.nav-i::before{content:"";position:absolute;top:5px}.nav-i{top:-2.5px}
.v-centered .h-in{flex-direction:column;gap:10px}.v-centered .brand{margin:0}
.nav-cta{display:none}html:not(.js) .nav-cta{display:none!important}
@media (max-width:759px){html.js .h-cta{display:none}html.js .nav-cta{display:block;padding-top:10px}html.js .nav-cta .btn{padding:0 1.35em;text-decoration:none}html.js .nav-t{display:inline-flex}html.js .h-nav ul{display:none}.h-in{flex-wrap:wrap}.site-h.open .h-nav ul{display:flex;flex-direction:column;gap:0;width:100%;padding:8px 0}.site-h.open .h-nav{order:5;width:100%}.h-cta{min-height:44px;padding:0 1em}.v-centered .h-in{flex-direction:row}.v-centered .brand{margin-right:auto}}
html.js .v-minimal .nav-t{display:inline-flex}html.js .v-minimal .h-nav ul{display:none}.v-minimal.open .h-nav ul{display:flex;flex-direction:column;position:absolute;right:max(20px,calc((100% - 1180px)/2));top:100%;background:var(--bg);border:1px solid var(--line);border-radius:var(--r);padding:10px 20px;min-width:220px;gap:0}.v-minimal .h-in{position:relative}.v-minimal{position:relative}`,
  hero: `.b-hero .h1{max-width:16ch}.b-hero .lede{margin-top:calc(var(--u)*2.5)}.b-hero .acts{margin-top:calc(var(--u)*4)}.b-hero .eyebrow{margin-bottom:calc(var(--u)*2)}
.hero-t{padding:calc(var(--u)*3) 0}.hero-t .h1{max-width:14ch;font-size:clamp(2.8rem,1.2rem + 6.2vw,7rem)}
.hero-s{display:grid;gap:calc(var(--u)*5);align-items:center}@media (min-width:900px){.hero-s{grid-template-columns:1.05fr .95fr;gap:calc(var(--u)*8)}}
.hero-media img,.hero-media .ph-img{aspect-ratio:4/5;object-fit:cover;width:100%;border-radius:var(--r)}
.v-image,.v-video{position:relative;min-height:min(86vh,820px);display:flex;align-items:flex-end;overflow:hidden;--text:#fff;--muted:rgba(255,255,255,.86);--accent:var(--c-accent);color:#fff;background:#1b1a18}
.hero-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.hero-scrim{position:absolute;inset:0;background:linear-gradient(to top,rgba(10,10,10,.72),rgba(10,10,10,.12) 62%)}
.hero-over{position:relative;padding-bottom:calc(var(--u)*2)}.v-image .btn-s,.v-video .btn-s{color:#fff}.v-image .eyebrow,.v-video .eyebrow{color:#fff}
.v-image .ph-img.hero-bg,.v-video .ph-img.hero-bg{border-radius:0}`,
  footer: `.site-f{--k:.7;font-size:.95rem;border-top:1px solid var(--line)}.site-f ul{list-style:none;display:grid;gap:6px}.site-f a{text-decoration:none}.site-f a:hover{text-decoration:underline}
.f-cols{display:grid;gap:32px}@media (min-width:760px){.f-cols{grid-template-columns:2fr 1fr 1.2fr}}.f-name{font-family:var(--f-d);font-weight:var(--dw);font-size:1.4rem;margin-bottom:8px}.f-about{color:var(--muted);max-width:42ch}
.f-h{font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}.f-social{margin-top:14px}.f-social,.f-simple ul{display:flex!important;flex-wrap:wrap;gap:6px 16px!important}
.f-note{margin-top:36px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}
.f-simple{display:flex;flex-wrap:wrap;gap:12px 28px;align-items:baseline}.f-simple .f-name{font-size:1.1rem;margin:0}.f-simple .f-note{margin:0 0 0 auto;padding:0;border:0}
.f-big{font-size:clamp(3rem,11vw,10rem);line-height:.9;margin-bottom:36px;overflow-wrap:anywhere}.f-row{display:grid;gap:24px}@media (min-width:760px){.f-row{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}}`,
  richtext: `.rt-split{display:grid;gap:calc(var(--u)*3)}@media (min-width:900px){.rt-split{grid-template-columns:1fr 1.4fr;gap:calc(var(--u)*8)}}.rt-narrow .h2,.rt-wide .h2{margin-bottom:calc(var(--u)*3)}.rt-wide .prose{max-width:none;columns:2 320px;column-gap:48px;display:block}.rt-wide .prose>*{margin-bottom:1em;break-inside:avoid}`,
  image: `.img-c img,.img-framed img{border-radius:var(--r);width:100%;max-height:82vh;object-fit:cover}.img-full img{width:100%;max-height:88vh;object-fit:cover}
.img-framed{display:grid;gap:18px}@media (min-width:900px){.img-framed{grid-template-columns:2.2fr 1fr;align-items:end}}`,
  imagetext: `.it{display:grid;gap:calc(var(--u)*4);align-items:center}@media (min-width:900px){.it-left,.it-right{grid-template-columns:1fr 1fr;gap:calc(var(--u)*9)}}
.it-media img,.it-media .ph-img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r)}.it-copy{display:grid;gap:calc(var(--u)*2.25);align-content:center}.it-stacked{max-width:900px}`,
  gallery: `.g-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}@media (min-width:900px){.g-grid{grid-template-columns:repeat(3,1fr);gap:16px}}.g-grid img,.g-grid .ph-img{aspect-ratio:1;object-fit:cover;border-radius:var(--r)}
.g-masonry{columns:2 200px;column-gap:12px}@media (min-width:900px){.g-masonry{columns:3;column-gap:16px}}.g-masonry .g-it{break-inside:avoid;margin-bottom:12px}.g-masonry img{border-radius:var(--r)}
.car-track{display:flex;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;padding:0 max(20px,calc((100% - 1180px)/2));scroll-padding:0 max(20px,calc((100% - 1180px)/2))}.car-track::-webkit-scrollbar{display:none}
.car-track>*{flex:0 0 min(85%,560px);scroll-snap-align:start}.car-track img,.car-track .ph-img{aspect-ratio:4/3;object-fit:cover;border-radius:var(--r)}
.car-nav{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}.car-nav button{width:48px;height:48px;border-radius:var(--rb);border:1px solid var(--line);background:transparent;color:inherit;font-size:1.1rem;cursor:pointer}.car-nav button:hover{background:var(--surface)}html:not(.js) .car-nav{display:none}`,
  video: `.vid{position:relative;display:block;aspect-ratio:16/9;background:#111;border-radius:var(--r);overflow:hidden;color:#fff;text-decoration:none}.vid img{width:100%;height:100%;object-fit:cover;opacity:.9}
.vid-play{position:absolute;left:20px;bottom:20px;display:flex;align-items:center;gap:12px;font-weight:600;background:rgba(0,0,0,.62);padding:10px 16px 10px 12px;border-radius:var(--rb)}.vid-play span{width:0;height:0;border-left:12px solid #fff;border-top:8px solid transparent;border-bottom:8px solid transparent}
.vid:hover .vid-play{background:#000}iframe.vid,.b-video iframe{width:100%;aspect-ratio:16/9;border:0;border-radius:var(--r)}.vid-empty{display:grid;place-items:center;color:#bbb;font-size:.9rem}
.vid-narrow{max-width:820px}.vid-split{display:grid;gap:32px;align-items:center}@media (min-width:900px){.vid-split{grid-template-columns:1fr 1.5fr;gap:64px}}.vid-split .lede{margin-top:16px}`,
  features: `.ft{list-style:none}.ft-rows .ft-it{display:grid;grid-template-columns:auto 1fr;gap:6px 24px;padding:calc(var(--u)*3) 0;border-top:1px solid var(--line)}.ft-rows .ft-it:last-child{border-bottom:1px solid var(--line)}
@media (min-width:760px){.ft-rows .ft-it{grid-template-columns:80px 1fr auto;align-items:baseline}}.ft-n{font:500 .95rem var(--f-b);color:var(--accent);font-variant-numeric:tabular-nums}.ft-main{display:grid;gap:8px;max-width:62ch}.ft-t{color:var(--muted)}.ft-d{font-weight:600;white-space:nowrap}
@media (max-width:759px){.ft-rows .ft-d{grid-column:2}}
.ft-grid{display:grid;gap:calc(var(--u)*4) calc(var(--u)*6)}@media (min-width:760px){.ft-grid{grid-template-columns:1fr 1fr}}.ft-grid .ft-it{display:grid;gap:10px;padding-top:calc(var(--u)*2.5);border-top:2px solid var(--text)}
.ft-compact{display:grid;gap:0}.ft-compact .ft-it{display:flex;justify-content:space-between;gap:20px;padding:14px 0;border-bottom:1px solid var(--line)}.ft-compact .h3{font-size:1.1rem}`,
  pricing: `.pr{list-style:none}.pr-columns{display:grid;gap:16px}@media (min-width:760px){.pr-columns{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}}
.pr-columns .pr-it{display:flex;flex-direction:column;gap:20px;padding:calc(var(--u)*3.5);border:1px solid var(--line);border-radius:var(--r)}.pr-columns .pr-it .btn{margin-top:auto;align-self:flex-start}
.pr-on{background:var(--text);color:var(--bg);border-color:var(--text)!important;--muted:color-mix(in srgb,var(--bg) 70%,var(--text));--line:color-mix(in srgb,var(--bg) 22%,var(--text))}.pr-on .btn-p{background:var(--bg);color:var(--text);border-color:var(--bg)}
.pr-top{display:grid;gap:8px}.pr-price b{font-family:var(--f-d);font-weight:var(--dw);font-size:2.1rem;letter-spacing:var(--dt)}.pr-price span,.pr-note{color:var(--muted)}
.pr-f{list-style:none;display:grid;gap:8px;font-size:.96rem}.pr-f li{padding-left:18px;position:relative}.pr-f li::before{content:"";position:absolute;left:0;top:.7em;width:8px;height:1.5px;background:var(--accent)}.pr-on .pr-f li::before{background:currentColor}
.pr-table .pr-it,.pr-list .pr-it{display:grid;gap:12px;padding:calc(var(--u)*3) 0;border-top:1px solid var(--line)}@media (min-width:760px){.pr-table .pr-it{grid-template-columns:1.2fr 1.6fr auto;align-items:start;gap:32px}}
.pr-table .pr-on,.pr-list .pr-on{background:none;color:inherit;--muted:var(--c-muted)}.pr-table .pr-on .h3::after,.pr-list .pr-on .h3::after{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-left:10px;vertical-align:middle}
.pr-list .pr-top{grid-template-columns:1fr auto;align-items:baseline}.pr-list .pr-f,.pr-list .btn{display:none}.pr-list .pr-price b{font-size:1.3rem}`,
  menu: `.mn{display:grid;gap:calc(var(--u)*6) calc(var(--u)*8)}@media (min-width:900px){.mn-columns{grid-template-columns:1fr 1fr}.mn-compact{grid-template-columns:repeat(3,1fr)}}.mn-list{max-width:780px}
.mn-sec{display:grid;gap:14px;align-content:start}.mn-h{padding-bottom:10px;border-bottom:2px solid var(--text)}.mn-note{color:var(--muted);font-size:.92rem}.mn-sec ul{list-style:none;display:grid;gap:16px}
.mi-row{display:flex;align-items:baseline;gap:10px}.mi-name{font:600 1.05rem/1.3 var(--f-b);letter-spacing:0}.mi-dots{flex:1;border-bottom:1.5px dotted color-mix(in srgb,var(--text) 40%,transparent);transform:translateY(-4px);min-width:16px}
.mi-price{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}.mi-tag{font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);border:1px solid currentColor;border-radius:var(--rb);padding:1px 6px;white-space:nowrap}.mi-desc{color:var(--muted);font-size:.93rem;margin-top:3px;max-width:52ch}
.mn-compact .mn-sec{padding:calc(var(--u)*3);background:var(--surface);border-radius:var(--r)}.mn-compact .mi-desc{display:none}`,
  team: `.tm{list-style:none;display:grid;gap:calc(var(--u)*4) calc(var(--u)*3)}.tm-grid{grid-template-columns:repeat(2,1fr)}@media (min-width:900px){.tm-grid{grid-template-columns:repeat(4,1fr)}}
.tm-grid .tm-it{display:grid;gap:14px;align-content:start}.tm-img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:var(--r)}.tm-role{color:var(--accent);font-weight:600;font-size:.92rem;margin-top:4px}.tm-bio{color:var(--muted);font-size:.94rem;margin-top:8px}
.tm-list{gap:0}.tm-list .tm-it{padding:calc(var(--u)*2.5) 0;border-top:1px solid var(--line)}.tm-list .tm-it>div{display:grid;gap:4px}@media (min-width:760px){.tm-list .tm-it>div{grid-template-columns:1fr 1fr 2fr;gap:24px;align-items:baseline}.tm-list .tm-role,.tm-list .tm-bio{margin:0}}
.tm-monogram{grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}.tm-monogram .tm-it{display:flex;gap:16px;align-items:flex-start}.tm-mono{flex:none;width:56px;height:56px;border-radius:50%;display:grid;place-items:center;background:var(--surface);color:var(--accent);font:600 1.05rem var(--f-d);border:1px solid var(--line)}`,
  testimonials: `.q-text{font-family:var(--f-d);font-weight:var(--dw);letter-spacing:var(--dt);font-size:1.35rem;line-height:1.35;text-wrap:pretty}.q-it figcaption{display:grid;gap:2px;margin-top:18px}.q-name{font-weight:650}.q-detail{color:var(--muted);font-size:.92rem}
.q-single{max-width:900px}.q-single .q-it+.q-it{display:none}.q-single .q-text{font-size:clamp(1.6rem,1.1rem + 2vw,2.6rem);line-height:1.2}
.q-grid{display:grid;gap:calc(var(--u)*5)}@media (min-width:760px){.q-grid{grid-template-columns:1fr 1fr}}.q-grid .q-it{padding-top:22px;border-top:1px solid var(--line)}
.q-car .q-it{padding:calc(var(--u)*3.5);background:var(--surface);border-radius:var(--r);flex-basis:min(85%,480px)}`,
  logos: `.lg{display:grid;gap:22px}.lg-h{font:600 .8rem var(--f-b);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}.lg ul{list-style:none;display:flex;flex-wrap:wrap;gap:20px 44px;align-items:center}
.lg img{max-height:40px;width:auto;max-width:150px;filter:grayscale(1);opacity:.8}.lg a:hover img{filter:none;opacity:1}.lg-name{font-family:var(--f-d);font-weight:var(--dw);font-size:1.3rem;color:var(--muted)}.lg a{text-decoration:none}
.lg-grid ul{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:var(--line);border:1px solid var(--line)}@media (min-width:760px){.lg-grid ul{grid-template-columns:repeat(4,1fr)}}.lg-grid li{background:var(--bg);display:grid;place-items:center;min-height:110px;padding:16px}`,
  stats: `.st{list-style:none;display:grid;gap:28px}.st-row{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.st li{display:grid;gap:6px;padding-top:16px;border-top:1px solid var(--line)}
.st-v{font-family:var(--f-d);font-weight:var(--dw);letter-spacing:var(--dt);font-size:2.6rem;line-height:1;font-variant-numeric:tabular-nums}.st-l{color:var(--muted)}.st-big .st-v{font-size:clamp(3rem,2rem + 5vw,6.5rem)}.st-big{gap:40px}
.st-split{display:grid;gap:40px}@media (min-width:900px){.st-split{grid-template-columns:1fr 1.3fr;gap:80px;align-items:start}}.st-split .lede{margin-top:16px}`,
  faq: `.fq{display:grid}.fq-it{border-top:1px solid var(--line)}.fq-it:last-child{border-bottom:1px solid var(--line)}
.fq summary{list-style:none;display:flex;justify-content:space-between;gap:20px;align-items:center;padding:20px 0;cursor:pointer;font-weight:600;font-size:1.08rem}.fq summary::-webkit-details-marker{display:none}
.fq summary::after{content:"";flex:none;width:12px;height:12px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg) translateY(-3px);transition:transform .2s cubic-bezier(.2,.7,.2,1)}.fq details[open] summary::after{transform:rotate(225deg) translateY(-3px)}
.fq-a{color:var(--muted);padding:0 0 22px;max-width:64ch}.v-plain .fq-it{padding:22px 0;display:grid;gap:8px}.v-plain .fq-a{padding:0}
.fq-split{display:grid;gap:32px}@media (min-width:900px){.fq-split{grid-template-columns:1fr 1.6fr;gap:80px}}.fq-split .lede{margin-top:16px}`,
  cta: `.cta-band{display:grid;gap:18px;max-width:900px}.cta-split{display:grid;gap:28px;align-items:end}@media (min-width:900px){.cta-split{grid-template-columns:1.6fr auto;gap:64px}}.cta-split .lede,.cta-box .lede{margin-top:14px}
.cta-box{padding:calc(var(--u)*6) calc(var(--u)*4);border:1.5px solid var(--text);border-radius:var(--r);display:grid;gap:18px}@media (min-width:760px){.cta-box{padding:calc(var(--u)*8)}}`,
  form: `.form{display:grid;gap:16px}.fl{display:grid;gap:6px;min-width:0}.fl label,.fl legend{font-weight:600;font-size:.93rem}.opt{font-weight:400;color:var(--muted)}
.fl input,.fl textarea{width:100%;min-height:48px;padding:12px 14px;border:1.5px solid var(--line);border-radius:min(var(--r),10px);background:var(--bg);color:var(--text);font:inherit;font-size:1rem}
.fl textarea{resize:vertical;min-height:130px}.fl input:focus,.fl textarea:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--text)}
.fl-row{display:grid;gap:16px}@media (min-width:600px){.fl-row{grid-template-columns:1fr 1fr}}
.chips{border:0;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px}.chips legend{margin-bottom:8px;padding:0}.chip{position:relative}.chip input{position:absolute;opacity:0;inset:0;cursor:pointer}.chip span{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1.5px solid var(--line);border-radius:var(--rb);cursor:pointer}
.chip input:checked+span{border-color:var(--text);background:var(--text);color:var(--bg)}.chip input:focus-visible+span{outline:2px solid var(--accent);outline-offset:2px}
.hp{position:absolute!important;left:-9999px!important;width:1px;height:1px;overflow:hidden}.form-end{display:flex;flex-wrap:wrap;gap:14px;align-items:center}.form-msg{color:var(--muted);font-size:.95rem}.form.sent .form-msg{color:var(--text);font-weight:600}
.ct-split,.ct-stack{display:grid;gap:calc(var(--u)*5)}@media (min-width:900px){.ct-split{grid-template-columns:1fr 1.2fr;gap:calc(var(--u)*9)}}.ct-info{display:grid;gap:16px;align-content:start}
.ct-dl{display:grid;gap:16px;margin-top:10px}.ct-dl dt{font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.ct-dl dd{font-size:1.05rem}.ct-dl a{text-decoration:none}.ct-dl a:hover{text-decoration:underline}
.nl{display:grid;gap:24px;align-items:end}@media (min-width:900px){.nl-inline,.nl-band{grid-template-columns:1fr 1fr;gap:64px}}.nl .lede{margin-top:12px}.nl-form{grid-template-columns:1fr auto;align-items:end;gap:10px}.nl-form .form-end{display:contents}.nl-form .form-msg{grid-column:1/-1}
.nl-card{max-width:560px;padding:calc(var(--u)*4);border:1px solid var(--line);border-radius:var(--r)}`,
  hours: `.hr-t{border-collapse:collapse;width:100%;margin-top:22px;font-variant-numeric:tabular-nums}.hr-t th,.hr-t td{padding:12px 0;border-bottom:1px solid var(--line);text-align:left;font-weight:400}.hr-t td{text-align:right}.hr-t th{font-weight:600}
.hr-t tr.today th,.hr-t tr.today td{color:var(--accent);font-weight:650}.hr-t tr.today th::after{content:" · today";font-weight:400;font-size:.85em}
.hr-compact .hr-t{max-width:520px}.hr-compact .hr-t th,.hr-compact .hr-t td{padding:6px 0;border:0}
.hr-split{display:grid;gap:24px}@media (min-width:900px){.hr-split{grid-template-columns:1fr 1fr;gap:80px}.hr-split .hr-t{margin:0}}.hr-split .lede{margin-top:14px}.rt-narrow .lede,.hr-compact .lede{margin-top:16px}`,
  map: `.map-info{display:grid;gap:14px;align-content:start;margin-bottom:24px}.map-addr{font-size:1.1rem;max-width:40ch}.map-info .btn{justify-self:start}
.map-frame{display:block;width:100%;height:420px;border:0;border-radius:var(--r);background:var(--surface)}.map-ph{display:grid;place-items:center;color:var(--muted)}
.map-split{display:grid;gap:24px}@media (min-width:900px){.map-split{grid-template-columns:1fr 1.7fr;gap:64px}.map-split .map-info{margin:0}}.map-card{padding:calc(var(--u)*4);border:1px solid var(--line);border-radius:var(--r);max-width:620px}.map-card .map-info{margin:0}`,
  timeline: `.tl{list-style:none;padding:0;display:grid}.tl-d{font-weight:650;color:var(--accent);font-variant-numeric:tabular-nums}.tl-t{color:var(--muted);margin-top:6px;max-width:60ch}
.tl-vertical{border-left:2px solid var(--line);margin-left:6px}.tl-vertical .tl-it{position:relative;padding:0 0 calc(var(--u)*4) 28px;display:grid;gap:6px}.tl-vertical .tl-it::before{content:"";position:absolute;left:-7px;top:6px;width:12px;height:12px;border-radius:50%;background:var(--bg);border:2px solid var(--accent)}
.tl-horizontal{grid-auto-flow:column;grid-auto-columns:minmax(220px,1fr);gap:28px;overflow-x:auto;padding-bottom:10px}.tl-horizontal .tl-it{display:grid;gap:10px;padding-top:18px;border-top:2px solid var(--text);align-content:start}
.tl-list .tl-it{display:grid;gap:6px;padding:20px 0;border-top:1px solid var(--line)}@media (min-width:760px){.tl-list .tl-it{grid-template-columns:160px 1fr;gap:32px}}`,
  beforeafter: `.ba{position:relative;overflow:hidden;border-radius:var(--r);aspect-ratio:3/2}.ba img{width:100%;height:100%;object-fit:cover}.ba-b,.ba-a{position:absolute;inset:0}.ba-a{clip-path:inset(0 0 0 var(--pos))}
.ba::after{content:"";position:absolute;top:0;bottom:0;left:var(--pos);width:2px;background:#fff;transform:translateX(-1px);pointer-events:none}.ba-range{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:ew-resize;margin:0}
.ba-l{position:absolute;left:14px;bottom:14px;background:rgba(0,0,0,.66);color:#fff;font-size:.82rem;padding:4px 10px;border-radius:var(--rb)}.ba-lr{left:auto;right:14px}.ba-range:focus-visible+*{outline:2px solid var(--accent)}
.ba-side{display:grid;gap:14px}@media (min-width:760px){.ba-side{grid-template-columns:1fr 1fr}}.ba-side img,.ba-side .ph-img{aspect-ratio:3/2;object-fit:cover;border-radius:var(--r)}.ba-side figcaption{margin-top:8px;font-weight:600}`,
  downloads: `.dl{list-style:none;display:grid}.dl a{display:flex;align-items:center;gap:14px;padding:18px 0;border-top:1px solid var(--line);text-decoration:none}.dl li:last-child a{border-bottom:1px solid var(--line)}.dl-l{font-weight:600;margin-right:auto}.dl-n{color:var(--muted);font-size:.9rem}
.dl svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5;flex:none}.dl a:hover .dl-l{text-decoration:underline}
.dl-cards{grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}.dl-cards a{border:1px solid var(--line)!important;border-radius:var(--r);padding:20px;flex-wrap:wrap;height:100%}`,
  social: `.so{display:grid;gap:18px}.so-h{font:600 .8rem var(--f-b);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}.so ul{list-style:none;display:flex;flex-wrap:wrap;gap:10px 28px}.so a{font-weight:600}
.so-list ul{display:grid;gap:0}.so-list a{display:block;padding:14px 0;border-top:1px solid var(--line);text-decoration:none}.so-big a{font-family:var(--f-d);font-weight:var(--dw);font-size:clamp(1.8rem,1.2rem + 2.4vw,3.2rem);text-decoration:none;letter-spacing:var(--dt)}.so-big a:hover{color:var(--accent)}`,
  spacer: `.b-spacer{padding:0}.sp-s.sp{height:24px}.sp-m.sp{height:56px}.sp-l.sp{height:112px}.sp{display:flex;align-items:center}.sp hr{width:100%;border:0;border-top:1px solid var(--line);margin:0}.sp-mark hr{width:56px;border-top:3px solid var(--accent)}`,
};
/** CSS for exactly the blocks on a page (plus the base and the theme). */
export function pageCss(site: Site, types: string[]): string {
  const need = new Set(types);
  if (['contact', 'booking', 'newsletter'].some((t) => need.has(t))) need.add('form');
  if (need.has('testimonials')) need.add('gallery');
  return themeCss(site.theme) + BASE + [...need].map((t) => CSS[t] ?? '').join('');
}
export const allCss = (site: Site) => pageCss(site, [...Object.keys(CSS)]);

/* ---------------- whole pages ---------------- */
export interface DocOptions { canonical?: string; extraHead?: string; siteJs?: string; /** CSS for every block type (the editor canvas, where blocks come and go). */ allCss?: boolean }
export function renderBody(c: RenderCtx): string {
  const anchors = anchorsFor(c.page);
  const head = c.site.header ? renderBlock(c, c.site.header) : '';
  const blocks = c.page.blocks.map((b) => renderBlock(c, b, anchors[b.id])).join('\n');
  const foot = c.site.footer ? renderBlock(c, c.site.footer) : '';
  return `<a class="skip" href="#main">Skip to content</a>\n${head}\n<main id="main">\n${blocks}\n</main>\n${foot}`;
}
export const bodyClass = (site: Site) => cls(`bs-${site.theme.button}`, site.theme.caps && 'caps');

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
export const FONT_IDS = FONTS.map((f) => f.id);
