/*
 * Websites made in Jhino: the data a site is saved as, its theme tokens, the block library and the
 * checks every site goes through before it is saved or published. Pure TypeScript with no Node or DOM
 * imports, so the server (validation, publishing) and the dashboard editor (live preview) share it.
 *
 * A site is JSON: { v, name, theme, settings, header, footer, pages[] }, each page holds blocks[],
 * each block is { id, type, variant, props, style }. docs/SITE_BLOCKS.md describes all of it.
 */

/* ---------------- fonts (self-hosted in runtime/fonts, served at /_jhino/fonts) ---------------- */
export type FontKind = 'serif' | 'sans' | 'mono' | 'display';
export interface FontDef {
  id: string; name: string; kind: FontKind;
  /** CSS family name used on the site. */
  family: string;
  /** Weight range of the file ([400, 400] for single-weight faces). */
  weights: [number, number];
  italic?: boolean;
  /** Weight headings use with this face, and their letter spacing. */
  display: { weight: number; tracking: string; lead: number; stretch?: string };
  fallback: string;
  /** Width axis range of a variable file (e.g. "62% 125%"). */
  stretch?: string;
}
export const FONTS: FontDef[] = [
  { id: 'rozha', name: 'Rozha One', kind: 'serif', family: 'Rozha One', weights: [400, 400], display: { weight: 400, tracking: '-0.015em', lead: 1.0 }, fallback: 'Didot, Georgia, serif' },
  { id: 'sourceserif', name: 'Source Serif', kind: 'serif', family: 'Source Serif 4', weights: [200, 900], italic: true, display: { weight: 520, tracking: '-0.022em', lead: 1.04 }, fallback: 'Georgia, serif' },
  { id: 'caslon', name: 'Libre Caslon Display', kind: 'serif', family: 'Libre Caslon Display', weights: [400, 400], display: { weight: 400, tracking: '-0.01em', lead: 1.02 }, fallback: 'Georgia, serif' },
  { id: 'figtree', name: 'Figtree', kind: 'sans', family: 'Figtree', weights: [300, 900], display: { weight: 650, tracking: '-0.03em', lead: 1.02 }, fallback: '"Helvetica Neue", Arial, sans-serif' },
  { id: 'archivox', name: 'Archivo Expanded', kind: 'sans', family: 'Archivo Wide', weights: [100, 900], stretch: '62% 125%', display: { weight: 720, tracking: '-0.035em', lead: 0.98, stretch: '125%' }, fallback: '"Helvetica Neue", Arial, sans-serif' },
  { id: 'youngserif', name: 'Young Serif', kind: 'serif', family: 'Young Serif', weights: [400, 400], display: { weight: 400, tracking: '-0.01em', lead: 1.08 }, fallback: 'Georgia, serif' },
  { id: 'fraunces', name: 'Fraunces', kind: 'serif', family: 'Fraunces', weights: [100, 900], italic: true, display: { weight: 560, tracking: '-0.02em', lead: 1.04 }, fallback: 'Georgia, serif' },
  { id: 'newsreader', name: 'Newsreader', kind: 'serif', family: 'Newsreader', weights: [200, 800], italic: true, display: { weight: 500, tracking: '-0.015em', lead: 1.06 }, fallback: 'Georgia, serif' },
  { id: 'bodoni', name: 'Bodoni Moda', kind: 'serif', family: 'Bodoni Moda', weights: [400, 900], italic: true, display: { weight: 500, tracking: '-0.01em', lead: 1.02 }, fallback: 'Didot, Georgia, serif' },
  { id: 'dmserif', name: 'DM Serif Display', kind: 'serif', family: 'DM Serif Display', weights: [400, 400], display: { weight: 400, tracking: '-0.01em', lead: 1.05 }, fallback: 'Georgia, serif' },
  { id: 'gloock', name: 'Gloock', kind: 'serif', family: 'Gloock', weights: [400, 400], display: { weight: 400, tracking: '0em', lead: 1.08 }, fallback: 'Georgia, serif' },
  { id: 'hanken', name: 'Hanken Grotesk', kind: 'sans', family: 'Hanken Grotesk', weights: [100, 900], display: { weight: 650, tracking: '-0.025em', lead: 1.05 }, fallback: '"Helvetica Neue", Arial, sans-serif' },
  { id: 'schibsted', name: 'Schibsted Grotesk', kind: 'sans', family: 'Schibsted Grotesk', weights: [400, 900], display: { weight: 650, tracking: '-0.025em', lead: 1.05 }, fallback: '"Helvetica Neue", Arial, sans-serif' },
  { id: 'archivo', name: 'Archivo', kind: 'sans', family: 'Archivo', weights: [100, 900], display: { weight: 760, tracking: '-0.03em', lead: 1.0 }, fallback: '"Helvetica Neue", Arial, sans-serif' },
  { id: 'bricolage', name: 'Bricolage Grotesque', kind: 'sans', family: 'Bricolage Grotesque', weights: [200, 800], display: { weight: 640, tracking: '-0.03em', lead: 1.02 }, fallback: '"Helvetica Neue", Arial, sans-serif' },
  { id: 'bigshoulders', name: 'Big Shoulders Display', kind: 'display', family: 'Big Shoulders Display', weights: [100, 900], display: { weight: 800, tracking: '0.005em', lead: 0.95 }, fallback: 'Impact, "Arial Narrow", sans-serif' },
  { id: 'jetbrains', name: 'JetBrains Mono', kind: 'mono', family: 'JetBrains Mono', weights: [100, 800], display: { weight: 600, tracking: '-0.03em', lead: 1.1 }, fallback: 'ui-monospace, Menlo, monospace' },
  { id: 'plexmono', name: 'IBM Plex Mono', kind: 'mono', family: 'IBM Plex Mono', weights: [400, 400], display: { weight: 400, tracking: '-0.02em', lead: 1.12 }, fallback: 'ui-monospace, Menlo, monospace' },
];
export const fontById = (id: string) => FONTS.find((f) => f.id === id) ?? FONTS[0];

/* ---------------- theme tokens ---------------- */
export interface ThemeColors { bg: string; surface: string; text: string; muted: string; accent: string; onAccent: string; line: string }
export type ButtonStyle = 'solid' | 'outline' | 'pill' | 'underline';
export type Rhythm = 'tight' | 'even' | 'airy';
export interface Theme {
  preset: string;
  display: string; body: string;
  colors: ThemeColors;
  /** Corner radius in px (0 to 28). */
  radius: number;
  /** Spacing scale, 0.8 (compact) to 1.3 (roomy). */
  space: number;
  button: ButtonStyle;
  /** Space between sections. */
  rhythm: Rhythm;
  /** Headings in capitals (for condensed display faces). */
  caps: boolean;
  /** Size of headings against the text, 0.85 (quiet) to 1.15 (grand). */
  scale: number;
}
export const COLOR_KEYS: (keyof ThemeColors)[] = ['bg', 'surface', 'text', 'muted', 'accent', 'onAccent', 'line'];
export const COLOR_LABELS: Record<keyof ThemeColors, string> = { bg: 'Page', surface: 'Panels', text: 'Text', muted: 'Quiet text', accent: 'Accent', onAccent: 'Text on accent', line: 'Lines' };

export interface Preset { id: string; name: string; note: string; theme: Theme }
type Swatch = [bg: string, surface: string, text: string, muted: string, accent: string, onAccent: string, line: string];
const preset = (id: string, name: string, note: string, display: string, body: string, c: Swatch, radius: number, button: ButtonStyle, rhythm: Rhythm, o: { space?: number; caps?: boolean; scale?: number } = {}): Preset =>
  ({ id, name, note, theme: { preset: id, display, body, colors: { bg: c[0], surface: c[1], text: c[2], muted: c[3], accent: c[4], onAccent: c[5], line: c[6] }, radius, space: o.space ?? 1, button, rhythm, caps: o.caps ?? false, scale: o.scale ?? 1 } });
/*
 * The themes. Neutral grounds (true white, charcoal, near-black) and ONE accent each, taken from the kind
 * of photography the business shows. Every text/background pair is at least 4.5:1.
 */
export const PRESETS: Preset[] = [
  preset('roast', 'Roast', 'White, espresso ink and bottle green, with a heavy Devanagari-born didone. Cafés, bakeries, restaurants.', 'rozha', 'figtree',
    ['#ffffff', '#f3f1ec', '#1b1815', '#5f5851', '#1f4a3a', '#ffffff', '#e4e0d9'], 2, 'solid', 'airy', { scale: 1.02 }),
  preset('meridian', 'Meridian', 'Clinical white, deep navy and one clear cobalt. A readable serif for headings. Clinics, labs, schools.', 'sourceserif', 'hanken',
    ['#ffffff', '#eef3f7', '#0e1b2a', '#4b5968', '#1d5fb4', '#ffffff', '#d9e2ea'], 12, 'pill', 'even'),
  preset('monolith', 'Monolith', 'Near-black, bone text, marigold and wide heavy type. Agencies, studios, music.', 'archivox', 'archivo',
    ['#111110', '#1b1b19', '#f1efe9', '#a6a39a', '#f0b43c', '#111110', '#2f2e2b'], 0, 'solid', 'airy', { scale: 1.06 }),
  preset('salt', 'Salt', 'True white and black grotesque, nothing else. Architects, portfolios, galleries.', 'schibsted', 'schibsted',
    ['#ffffff', '#f4f4f2', '#0b0b0b', '#5c5c58', '#0b0b0b', '#ffffff', '#e3e3df'], 0, 'underline', 'airy', { space: 1.05, scale: 1.08 }),
  preset('kora', 'Kora', 'A soft white, slate blue and a contrasty serif. Homestays, boutique hotels, weddings.', 'gloock', 'figtree',
    ['#faf9f6', '#efece6', '#1f1d1a', '#5e5952', '#2e4a5c', '#ffffff', '#e2ded6'], 4, 'solid', 'airy'),
  preset('summit', 'Summit', 'White, pine-black and prayer-flag yellow, condensed capitals. Gyms, trekking, builders.', 'bigshoulders', 'archivo',
    ['#ffffff', '#eef0ec', '#121613', '#545b55', '#e8a317', '#121613', '#dde1db'], 0, 'solid', 'tight', { caps: true, scale: 1.1 }),
  preset('nocturne', 'Nocturne', 'Green-black, warm bone and brass, with a fashion didone. Photographers, weddings, bars.', 'bodoni', 'schibsted',
    ['#0f1312', '#171d1b', '#ece9e2', '#a39f95', '#c8a46a', '#0f1312', '#2a312e'], 0, 'outline', 'airy'),
  preset('counsel', 'Counsel', 'White, graphite and oxblood, a sturdy serif. Consultants, lawyers, NGOs.', 'youngserif', 'hanken',
    ['#ffffff', '#f3f3f0', '#16181b', '#53575d', '#7a1e2c', '#ffffff', '#dfdfdb'], 2, 'solid', 'even'),
  preset('bloom', 'Bloom', 'White, a blush panel and raspberry, with an elegant Caslon. Salons, boutiques, florists.', 'caslon', 'figtree',
    ['#ffffff', '#f8eef0', '#231418', '#6b5358', '#a3214f', '#ffffff', '#eedde1'], 20, 'pill', 'even'),
];
/** Theme ids from before the redesign, and the theme each moved to. */
export const LEGACY_PRESETS: Record<string, { to: string; colors: Swatch; display: string; body: string }> = {
  chiya: { to: 'roast', colors: ['#f4efe6', '#ebe2d2', '#2a211b', '#6b5d51', '#b5462a', '#fff8f1', '#d8ccb8'], display: 'youngserif', body: 'hanken' },
  darkroom: { to: 'nocturne', colors: ['#121110', '#1c1b19', '#efebe3', '#a19b90', '#d9c9a8', '#121110', '#34322e'], display: 'bodoni', body: 'archivo' },
  clinic: { to: 'meridian', colors: ['#ffffff', '#eef4f1', '#10231d', '#4d625a', '#0f6b54', '#ffffff', '#d6e2dc'], display: 'hanken', body: 'hanken' },
  newsprint: { to: 'counsel', colors: ['#fbfaf6', '#f1eee6', '#171614', '#5e5a52', '#c1272d', '#ffffff', '#dcd7cc'], display: 'newsreader', body: 'newsreader' },
  workshop: { to: 'summit', colors: ['#e8e6e1', '#dcd9d2', '#151515', '#55534e', '#f0b400', '#151515', '#c3c0b8'], display: 'bigshoulders', body: 'archivo' },
  rhododendron: { to: 'bloom', colors: ['#fff8f5', '#f7e7e1', '#2b1014', '#6d4b50', '#a3161f', '#fff8f5', '#ecd3cb'], display: 'dmserif', body: 'schibsted' },
  teagarden: { to: 'kora', colors: ['#f2f4ec', '#e3e9d8', '#1c2a1e', '#566257', '#3d6a38', '#f6f8f1', '#cfd8c2'], display: 'fraunces', body: 'schibsted' },
  ledger: { to: 'counsel', colors: ['#f6f4ee', '#ece8dd', '#1b1b1a', '#5b5a55', '#2e5b4f', '#f6f4ee', '#d4d0c4'], display: 'plexmono', body: 'newsreader' },
  marigold: { to: 'monolith', colors: ['#1b1412', '#261d1a', '#f4e8d8', '#b5a390', '#e9a23b', '#1b1412', '#3d302b'], display: 'gloock', body: 'bricolage' },
  gallery: { to: 'salt', colors: ['#ffffff', '#f3f3f1', '#0b0b0b', '#5f5f5b', '#0b0b0b', '#ffffff', '#e2e2de'], display: 'archivo', body: 'archivo' },
};
export const presetById = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS.find((p) => p.id === LEGACY_PRESETS[id]?.to) ?? PRESETS[0];

/* ---------------- the site ---------------- */
export interface ImageRef { src: string; alt: string; focal?: [number, number] }
export interface LinkRef { label: string; href: string; newTab?: boolean }
export type BgStyle = 'page' | 'surface' | 'accent' | 'ink';
export interface BlockStyle { bg: BgStyle; space: 's' | 'm' | 'l'; hide: '' | 'mobile' | 'desktop' }
export interface Block { id: string; type: string; variant: string; props: Record<string, any>; style: BlockStyle }
export interface Page { id: string; slug: string; title: string; nav: boolean; seoTitle: string; seoDescription: string; blocks: Block[] }
export interface SocialLink { network: string; url: string }
export interface SiteSettings {
  logo: ImageRef | null; favicon: ImageRef | null; socialImage: ImageRef | null;
  tagline: string; lang: 'en' | 'ne';
  phone: string; email: string; address: string;
  social: SocialLink[];
}
export interface Site { v: 1; name: string; theme: Theme; settings: SiteSettings; header: Block | null; footer: Block | null; pages: Page[] }

/* ---------------- fields: how each prop is edited and checked ---------------- */
export type FieldType = 'text' | 'para' | 'rich' | 'plain' | 'url' | 'image' | 'link' | 'bool' | 'select' | 'list' | 'number' | 'date' | 'time';
export interface Field {
  key: string; label: string; type: FieldType;
  /** Longest text allowed (characters). */
  max?: number;
  options?: { value: string; label: string }[];
  /** For lists: the fields of each item, the most items, and what one item is called. */
  of?: Field[]; maxItems?: number; item?: string;
  hint?: string;
  /** For numbers: the smallest and largest value. */
  lo?: number; hi?: number;
}
const text = (key: string, label: string, max = 160, hint?: string): Field => ({ key, label, type: 'text', max, hint });
const para = (key: string, label: string, max = 900, hint?: string): Field => ({ key, label, type: 'para', max, hint });
const rich = (key: string, label: string, max = 12000): Field => ({ key, label, type: 'rich', max });
const plain = (key: string, label: string, max = 120, hint?: string): Field => ({ key, label, type: 'plain', max, hint });
const url = (key: string, label: string, hint?: string): Field => ({ key, label, type: 'url', hint });
const image = (key: string, label: string): Field => ({ key, label, type: 'image' });
const link = (key: string, label: string): Field => ({ key, label, type: 'link' });
const bool = (key: string, label: string, hint?: string): Field => ({ key, label, type: 'bool', hint });
const select = (key: string, label: string, options: [string, string][]): Field => ({ key, label, type: 'select', options: options.map(([value, l]) => ({ value, label: l })) });
const list = (key: string, label: string, item: string, of: Field[], maxItems = 40): Field => ({ key, label, type: 'list', item, of, maxItems });
const num = (key: string, label: string, lo: number, hi: number, hint?: string): Field => ({ key, label, type: 'number', lo, hi, hint });
/** A day, stored as YYYY-MM-DD (AD). The editor shows the Nepali (BS) date beside it. */
const date = (key: string, label: string, hint?: string): Field => ({ key, label, type: 'date', hint });
const time = (key: string, label: string, hint?: string): Field => ({ key, label, type: 'time', hint });

export const CURRENCIES: [string, string][] = [['NPR', 'NPR (रू)'], ['INR', 'INR (₹)'], ['USD', 'USD ($)'], ['EUR', 'EUR (€)'], ['GBP', 'GBP (£)'], ['AUD', 'AUD (A$)'], ['', 'No currency']];
export const NETWORKS: [string, string][] = [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['x', 'X'], ['linkedin', 'LinkedIn'], ['whatsapp', 'WhatsApp'], ['viber', 'Viber'], ['pinterest', 'Pinterest'], ['behance', 'Behance'], ['website', 'Website']];

export type Category = 'structure' | 'media' | 'business' | 'engagement';
export const CATEGORIES: { id: Category; name: string }[] = [
  { id: 'structure', name: 'Page structure' }, { id: 'media', name: 'Text and media' }, { id: 'business', name: 'Business' }, { id: 'engagement', name: 'Engagement' },
];
export interface BlockDef {
  type: string; name: string; category: Category; description: string;
  variants: { id: string; name: string }[];
  fields: Field[];
  defaults: () => Record<string, any>;
  /** Blocks whose visitors send something (saved as Submissions). */
  form?: { fields: { name: string; label: string; required?: boolean; max: number; kind?: 'email' | 'tel' | 'date' | 'time' | 'text' | 'long' | 'choice' }[] };
  /** Only one per site, kept above or below every page. */
  global?: 'header' | 'footer';
  /** Words the block picker search also matches. */
  keywords?: string;
  /** Section style a new block of this type starts with. */
  style?: Partial<BlockStyle>;
}
const v = (...pairs: [string, string][]) => pairs.map(([id, name]) => ({ id, name }));
const lib = (name: string, alt: string): ImageRef => ({ src: `lib:${name}`, alt });
const noImage = (): ImageRef => ({ src: '', alt: '' });
/** A day some weeks from now (YYYY-MM-DD), so a new countdown has something to count to. */
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

export const BLOCKS: BlockDef[] = [
  /* ---- page structure ---- */
  {
    type: 'header', name: 'Header and menu', category: 'structure', global: 'header', keywords: 'nav navigation logo menu top bar',
    description: 'Your logo or name, a link to every page (it updates by itself) and one button.',
    variants: v(['bar', 'Logo left, links right'], ['centered', 'Logo centred, links below'], ['minimal', 'Logo and a menu button']),
    fields: [link('cta', 'Button'), bool('sticky', 'Stays on top while scrolling')],
    defaults: () => ({ cta: { label: 'Contact us', href: '' }, sticky: true }),
  },
  {
    type: 'hero', name: 'Hero', category: 'structure', keywords: 'banner intro headline top cover',
    description: 'The first thing people see: what you do, where, and what to do next.',
    variants: v(['split', 'Text beside a photo'], ['image', 'Full photo, text on top'], ['stacked', 'Big headline over a wide photo'], ['text', 'Large type only'], ['video', 'Video in the background']),
    fields: [text('title', 'Headline', 160), para('text', 'Text', 500), link('primary', 'Main button'), link('secondary', 'Second button'), image('image', 'Photo'), text('eyebrow', 'Detail line', 120, 'A short fact under the buttons, like opening hours or the neighbourhood.'), url('video', 'Background video', 'A direct link to an .mp4 file. The photo shows while it loads and on slow connections.')],
    defaults: () => ({ eyebrow: '', title: 'Say what you do and where, in one line', text: 'Add a sentence or two about who you help and why people come back. Click any text on the page to change it.', primary: { label: 'Get in touch', href: '' }, secondary: { label: '', href: '' }, image: noImage(), video: '' }),
  },
  {
    type: 'footer', name: 'Footer', category: 'structure', global: 'footer', keywords: 'bottom copyright contact',
    description: 'Your name, pages, contact details, hours and social links, on every page.',
    variants: v(['rich', 'Full: a closing line, columns and hours'], ['columns', 'Columns'], ['simple', 'One quiet line'], ['big', 'Large name']),
    fields: [text('headline', 'Closing line', 140, 'A last sentence in large type, like "Come in for a cup". Full footer only.'), link('cta', 'Button'), para('about', 'About line', 300), para('hours', 'Hours', 300, 'One line per row, like "Sun to Fri, 7:30 to 21:00". Full footer only.'), text('note', 'Small print', 160), bool('showPages', 'List the pages'), bool('showContact', 'Show phone, email and address'), bool('showSocial', 'Show social links')],
    defaults: () => ({ headline: '', cta: { label: '', href: '' }, about: '', hours: '', note: '', showPages: true, showContact: true, showSocial: true }),
  },
  {
    type: 'announce', name: 'Announcement bar', category: 'structure', keywords: 'notice banner top bar news offer holiday closed alert strip',
    description: 'One short line at the very top: a holiday, an offer, new hours. Visitors can close it.',
    variants: v(['bar', 'One centred line'], ['split', 'Message left, link right']),
    fields: [text('text', 'Message', 200), plain('label', 'Small tag', 30, 'Optional, like "New" or "Tihar hours".'), link('link', 'Link'), bool('dismiss', 'Visitors can close it', 'Once closed it stays closed for them until you change the message.')],
    defaults: () => ({ text: 'Open every day through Tihar, 8 in the morning to 9 at night.', label: 'Tihar hours', link: { label: 'Plan your visit', href: '' }, dismiss: true }),
    style: { bg: 'ink', space: 's' },
  },
  /* ---- text and media ---- */
  {
    type: 'richtext', name: 'Text', category: 'media', keywords: 'paragraph about story article words',
    description: 'A heading and paragraphs, with bold, italic, links and lists.',
    variants: v(['narrow', 'Narrow column'], ['wide', 'Wide column'], ['split', 'Heading left, text right']),
    fields: [text('heading', 'Heading'), rich('body', 'Text')],
    defaults: () => ({ heading: 'A heading for this part', body: '<p>Write the way you talk to a customer at the counter. Short paragraphs read best on a phone.</p>' }),
  },
  {
    type: 'image', name: 'Image', category: 'media', keywords: 'photo picture',
    description: 'One photo, with a caption if you like.',
    variants: v(['contained', 'Inside the page margins'], ['full', 'Edge to edge'], ['framed', 'Caption beside it']),
    fields: [image('image', 'Photo'), text('caption', 'Caption', 240)],
    defaults: () => ({ image: noImage(), caption: '' }),
  },
  {
    type: 'imagetext', name: 'Image and text', category: 'media', keywords: 'photo side about feature',
    description: 'A photo next to a short story, with a link.',
    variants: v(['left', 'Photo on the left'], ['right', 'Photo on the right'], ['stacked', 'Photo above']),
    fields: [image('image', 'Photo'), text('eyebrow', 'Small line above', 80), text('heading', 'Heading'), rich('body', 'Text', 4000), link('link', 'Link')],
    defaults: () => ({ image: noImage(), eyebrow: '', heading: 'Tell one story here', body: '<p>How you started, how something is made, or what a first visit is like.</p>', link: { label: '', href: '' } }),
  },
  {
    type: 'gallery', name: 'Gallery', category: 'media', keywords: 'photos portfolio images grid slider',
    description: 'Several photos as a mosaic, a grid, a masonry wall, a carousel or a square feed.',
    variants: v(['bento', 'Mosaic of mixed sizes'], ['grid', 'Even grid'], ['masonry', 'Masonry'], ['carousel', 'Carousel'], ['feed', 'Square feed, like Instagram']),
    fields: [text('heading', 'Heading'), para('intro', 'Intro', 400), list('images', 'Photos', 'photo', [image('image', 'Photo'), text('caption', 'Caption', 160)], 48), link('link', 'Link', )],
    defaults: () => ({ heading: 'Gallery', intro: '', images: [{ image: noImage(), caption: '' }, { image: noImage(), caption: '' }, { image: noImage(), caption: '' }], link: { label: '', href: '' } }),
  },
  {
    type: 'rows', name: 'Feature rows', category: 'media', keywords: 'alternating image text zigzag features story sections',
    description: 'Large photos and short stories in rows, left and right in turn.',
    variants: v(['alternate', 'Photo left, then right'], ['large', 'Big photos, text beneath']),
    fields: [text('heading', 'Heading'), para('intro', 'Intro', 500), list('items', 'Rows', 'row', [image('image', 'Photo'), text('title', 'Title', 120), para('text', 'Text', 700), link('link', 'Link')], 12)],
    defaults: () => ({ heading: '', intro: '', items: [{ image: noImage(), title: 'One thing you do well', text: 'Two or three sentences with a real detail: where it comes from, who makes it, how long it takes.', link: { label: '', href: '' } }, { image: noImage(), title: 'Another thing worth a photo', text: 'Say what a customer sees, tastes or gets.', link: { label: '', href: '' } }] }),
  },
  {
    type: 'sticky', name: 'Photo with scrolling story', category: 'media', keywords: 'sticky pinned image scroll chapters story about',
    description: 'A photo that stays in view while short chapters scroll past beside it.',
    variants: v(['left', 'Photo on the left'], ['right', 'Photo on the right']),
    fields: [text('heading', 'Heading'), para('intro', 'Intro', 500), image('image', 'Photo'), list('items', 'Chapters', 'chapter', [plain('label', 'Small label', 40, 'Like a year, a place or a step.'), text('title', 'Title', 120), para('text', 'Text', 700)], 10)],
    defaults: () => ({ heading: 'How it is made', intro: '', image: noImage(), items: [{ label: '', title: 'Where it starts', text: 'A few sentences about the first part of the story.' }, { label: '', title: 'What happens next', text: 'Keep each chapter short enough to read in one breath.' }] }),
  },
  {
    type: 'quote', name: 'Big quote', category: 'media', keywords: 'pull quote statement words founder saying',
    description: 'One sentence in large type: your promise, or words someone really said.',
    variants: v(['large', 'Large type'], ['image', 'Beside a photo']),
    fields: [para('quote', 'Quote', 600), text('name', 'Who said it', 80), text('detail', 'Who they are', 120), image('image', 'Photo')],
    defaults: () => ({ quote: 'One sentence that sums up why you do this work.', name: '', detail: '', image: noImage() }),
  },
  {
    type: 'marquee', name: 'Moving words', category: 'media', keywords: 'marquee ticker scrolling text band words',
    description: 'A slow band of words across the page. It stands still for visitors who turn motion off.',
    variants: v(['large', 'Large'], ['small', 'Small band']),
    fields: [list('items', 'Words', 'phrase', [plain('text', 'Words', 80)], 12)],
    defaults: () => ({ items: [{ text: 'Say it' }, { text: 'In a few words' }, { text: 'Again and again' }] }),
  },
  {
    type: 'video', name: 'Video', category: 'media', keywords: 'youtube vimeo film embed',
    description: 'A YouTube or Vimeo video. It loads only when someone presses play, so the page stays fast.',
    variants: v(['wide', 'Wide'], ['contained', 'Narrow'], ['split', 'Text beside it']),
    fields: [url('url', 'YouTube or Vimeo link'), text('heading', 'Heading'), para('text', 'Text', 600), text('caption', 'Caption', 200)],
    defaults: () => ({ url: '', heading: '', text: '', caption: '' }),
  },
  {
    type: 'videofeature', name: 'Video feature', category: 'media', keywords: 'film reel tiktok instagram youtube vimeo showreel poster big video',
    description: 'A big video with your own poster photo and words on it. YouTube, Vimeo, TikTok or Instagram; it loads only when pressed.',
    variants: v(['overlay', 'Words over the video'], ['split', 'Words beside it (best for phone videos)'], ['cinema', 'Wide, on a dark band']),
    fields: [url('url', 'Video link', 'A YouTube, Vimeo, TikTok or Instagram link to one video or reel.'), image('image', 'Poster photo'), text('heading', 'Heading', 140), para('text', 'Text', 500), link('link', 'Button'), text('caption', 'Caption', 200)],
    defaults: () => ({ url: '', image: noImage(), heading: 'Two minutes in our kitchen', text: 'Watch the morning batch of momo being folded, steamed and sent out, start to finish.', link: { label: '', href: '' }, caption: '' }),
  },
  {
    type: 'tabs', name: 'Tabs', category: 'media', keywords: 'tabbed categories services by category menu by meal switch sections',
    description: 'A few groups of the same thing behind tabs: services by category, a menu by meal, rooms by floor.',
    variants: v(['top', 'Tabs above'], ['pills', 'Rounded tabs, centred'], ['side', 'Tabs down the side']),
    fields: [text('heading', 'Heading'), para('intro', 'Intro', 500), list('tabs', 'Tabs', 'tab', [plain('label', 'Tab name', 40), text('title', 'Heading', 120), para('text', 'Text', 700), para('points', 'List (one per line)', 1500, 'Put a price or time after a dash, like "Blow-dry – 900".'), image('image', 'Photo'), link('link', 'Link')], 8)],
    defaults: () => ({
      heading: 'What we do, by chair', intro: '',
      tabs: [
        { label: 'Hair', title: 'Cuts, colour and care', text: 'Every cut starts with a wash and a proper talk about how you wear your hair on a normal day.', points: 'Cut and blow-dry – 1,200\nFringe trim – 300\nRoot colour – 2,800\nKeratin smoothing – 7,500', image: noImage(), link: { label: '', href: '' } },
        { label: 'Skin', title: 'Facials and threading', text: 'Quiet rooms, clean tools for every guest, and products we are happy to name.', points: 'Threading, brows – 150\nClean-up facial – 1,500\nHydrating facial – 2,800', image: noImage(), link: { label: '', href: '' } },
        { label: 'Bridal', title: 'Bridal and party make-up', text: 'A trial two weeks before, then the full look on the day, at the salon or at your venue.', points: 'Trial session – 3,500\nBridal make-up and hair – 18,000\nParty make-up – 4,500', image: noImage(), link: { label: 'Ask for a date', href: '' } },
      ],
    }),
  },
  {
    type: 'hotspots', name: 'Photo with notes', category: 'media', keywords: 'hotspots points pins numbered image room product tour details',
    description: 'One photo with numbered points on it. Each point opens a short note: a room, a product, a site.',
    variants: v(['pins', 'Notes open on the photo'], ['legend', 'Numbered notes beside the photo']),
    fields: [text('heading', 'Heading'), para('intro', 'Intro', 500), image('image', 'Photo'), list('points', 'Points', 'point', [text('title', 'Title', 100), para('text', 'Note', 400), num('x', 'Across, from the left (%)', 0, 100, '0 is the left edge, 100 the right.'), num('y', 'Down, from the top (%)', 0, 100, '0 is the top edge, 100 the bottom.')], 12)],
    defaults: () => ({
      heading: 'A look around the corner room', intro: 'Tap a number to read about it.', image: noImage(),
      points: [
        { title: 'Window onto the hills', text: 'Faces east, so the first light reaches the bed a little after six.', x: 70, y: 32 },
        { title: 'Handwoven dhaka throws', text: 'Made by a weavers’ group in Tehrathum; there is an extra one in the chest.', x: 38, y: 64 },
        { title: 'Reading lamp and desk', text: 'Two plug points and a USB port by the desk, and the Wi-Fi password on the lamp.', x: 16, y: 48 },
      ],
    }),
  },
  /* ---- business ---- */
  {
    type: 'features', name: 'Services', category: 'business', keywords: 'features services offer what we do list',
    description: 'What you offer, each with a line or two and an optional price or time.',
    variants: v(['rows', 'Numbered rows'], ['grid', 'Two columns'], ['compact', 'Compact list']),
    fields: [text('heading', 'Heading'), para('intro', 'Intro', 500), list('items', 'Services', 'service', [text('title', 'Name', 100), para('text', 'Description', 500), plain('detail', 'Price or time', 60)], 30)],
    defaults: () => ({ heading: 'What we do', intro: '', items: [{ title: 'First service', text: 'One or two lines on what is included.', detail: '' }, { title: 'Second service', text: 'Who it is for and how long it takes.', detail: '' }] }),
  },
  {
    type: 'pricing', name: 'Pricing', category: 'business', keywords: 'prices packages plans rates',
    description: 'Packages with prices and what each includes.',
    variants: v(['columns', 'Side by side'], ['table', 'Rows'], ['list', 'Simple list']),
    fields: [text('heading', 'Heading'), para('intro', 'Intro', 500), select('currency', 'Currency', CURRENCIES),
      list('plans', 'Packages', 'package', [text('name', 'Name', 80), plain('price', 'Price', 30, 'Numbers only, like 4500 or 4,500.'), plain('period', 'Per', 30), para('note', 'Short note', 200), para('features', 'What is included (one per line)', 1200), link('cta', 'Button'), bool('featured', 'Point this one out')], 8)],
    defaults: () => ({ heading: 'Prices', intro: '', currency: 'NPR', plans: [{ name: 'Basic', price: '', period: '', note: '', features: 'What is included\nAnother thing included', cta: { label: '', href: '' }, featured: false }] }),
  },
  {
    type: 'menu', name: 'Menu', category: 'business', keywords: 'food drinks restaurant cafe prices dishes',
    description: 'Food and drinks by section, with prices in rupees (or any currency).',
    variants: v(['columns', 'Two columns'], ['photo', 'With photos of the dishes'], ['list', 'One long list'], ['compact', 'Compact board']),
    fields: [text('heading', 'Heading'), para('intro', 'Note', 400), select('currency', 'Currency', CURRENCIES),
      list('sections', 'Sections', 'section', [text('title', 'Section', 80), para('note', 'Section note', 200),
        list('items', 'Dishes and drinks', 'item', [text('name', 'Name', 90), para('desc', 'Description', 240), plain('price', 'Price', 20), plain('tag', 'Tag', 20, 'Like Veg, New or Spicy.'), image('image', 'Photo')], 60)], 16)],
    defaults: () => ({ heading: 'Menu', intro: '', currency: 'NPR', sections: [{ title: 'Section', note: '', items: [{ name: 'Dish name', desc: 'What is in it.', price: '', tag: '', image: noImage() }] }] }),
  },
  {
    type: 'steps', name: 'Steps', category: 'business', keywords: 'process how it works numbered steps stages first visit',
    description: 'How it works, in numbered steps, when the order matters.',
    variants: v(['columns', 'Side by side'], ['stack', 'Down the page, large numbers']),
    fields: [text('heading', 'Heading'), para('intro', 'Intro', 500), list('items', 'Steps', 'step', [text('title', 'Title', 100), para('text', 'Text', 500), plain('detail', 'Time or note', 60, 'Like "Day 1" or "20 minutes".')], 8)],
    defaults: () => ({ heading: 'How it works', intro: '', items: [{ title: 'First, you ask', text: 'What happens and what the customer needs to do.', detail: '' }, { title: 'Then we get to work', text: 'What you do, and how long it takes.', detail: '' }, { title: 'You get the result', text: 'What they walk away with.', detail: '' }] }),
  },
  {
    type: 'work', name: 'Work and projects', category: 'business', keywords: 'portfolio case studies projects clients work grid',
    description: 'Projects or case studies as large photos with a title and a line each.',
    variants: v(['grid', 'Two columns'], ['feature', 'One large, then two'], ['list', 'Rows with a small photo']),
    fields: [text('heading', 'Heading'), para('intro', 'Intro', 500), list('items', 'Projects', 'project', [image('image', 'Photo'), text('title', 'Title', 100), plain('tag', 'Kind of work', 60), para('text', 'One line', 300), link('link', 'Link')], 24), link('link', 'Link under the list')],
    defaults: () => ({ heading: 'Selected work', intro: '', items: [{ image: noImage(), title: 'Project name', tag: 'Identity', text: 'What you made and for whom.', link: { label: '', href: '' } }, { image: noImage(), title: 'Another project', tag: 'Website', text: 'The result in one line.', link: { label: '', href: '' } }], link: { label: '', href: '' } }),
  },
  {
    type: 'press', name: 'Press and awards', category: 'business', keywords: 'press mentions awards media recognition featured in',
    description: 'Where you were written about or what you won, with a short line from each.',
    variants: v(['list', 'Rows'], ['quotes', 'Quotes from the press']),
    fields: [text('heading', 'Heading'), list('items', 'Mentions', 'mention', [plain('name', 'Publication or award', 80), text('detail', 'Title or year', 140), para('quote', 'What they wrote', 300), url('url', 'Link')], 16)],
    defaults: () => ({ heading: 'In the press', items: [{ name: 'Publication name', detail: 'The headline, and the year', quote: '', url: '' }] }),
  },
  {
    type: 'team', name: 'Team', category: 'business', keywords: 'people staff doctors about us',
    description: 'The people behind the work, with or without photos.',
    variants: v(['grid', 'Photos in a grid'], ['list', 'Names and roles in rows'], ['monogram', 'Initials instead of photos']),
    fields: [text('heading', 'Heading'), para('intro', 'Intro', 400), list('people', 'People', 'person', [text('name', 'Name', 80), text('role', 'Role', 100), para('bio', 'Short bio', 400), image('image', 'Photo')], 40)],
    defaults: () => ({ heading: 'Who you will meet', intro: '', people: [{ name: 'Full name', role: 'Role', bio: '', image: noImage() }] }),
  },
  {
    type: 'testimonials', name: 'Testimonials', category: 'business', keywords: 'reviews quotes customers',
    description: 'What real customers said, in their words.',
    variants: v(['single', 'One large quote'], ['grid', 'Several quotes'], ['carousel', 'Carousel']),
    fields: [text('heading', 'Heading'), list('items', 'Quotes', 'quote', [para('quote', 'Quote', 600), text('name', 'Name', 80), text('detail', 'Who they are', 100)], 20)],
    defaults: () => ({ heading: '', items: [{ quote: 'Paste a review a customer really wrote, word for word.', name: 'Their name', detail: '' }] }),
  },
  {
    type: 'logos', name: 'Logos', category: 'business', keywords: 'clients partners brands press',
    description: 'Clients, partners or press, as logos or names.',
    variants: v(['row', 'One row'], ['grid', 'Grid']),
    fields: [text('heading', 'Heading'), list('items', 'Logos', 'logo', [plain('name', 'Name', 60), image('image', 'Logo'), url('url', 'Link')], 24)],
    defaults: () => ({ heading: 'Worked with', items: [{ name: 'Client name', image: noImage(), url: '' }] }),
  },
  {
    type: 'stats', name: 'Numbers', category: 'business', keywords: 'stats figures facts counts',
    description: 'A few real numbers. Rows with no number are not shown on the site.',
    variants: v(['row', 'In a row'], ['big', 'Large'], ['split', 'Beside a text']),
    fields: [text('heading', 'Heading'), para('text', 'Text', 500), list('items', 'Numbers', 'number', [plain('value', 'Number', 20, 'Only a number you can stand behind.'), text('label', 'What it counts', 80)], 8)],
    defaults: () => ({ heading: '', text: '', items: [{ value: '', label: 'What this number counts' }] }),
  },
  {
    type: 'compare', name: 'Comparison table', category: 'business', keywords: 'compare plans packages table features check cross ticks membership versus',
    description: 'Plans or packages side by side, with a tick, a cross or a short value on every row.',
    variants: v(['table', 'Table'], ['cards', 'A card for each plan']),
    fields: [text('heading', 'Heading'), para('intro', 'Intro', 500),
      list('columns', 'Plans', 'plan', [text('name', 'Name', 60), plain('note', 'Price or short line', 60), bool('featured', 'Point this one out')], 4),
      list('rows', 'Rows', 'row', [text('label', 'What is compared', 140), plain('v1', 'First plan', 60, 'Type yes for a tick, no for a cross, or a short value like "2 hours".'), plain('v2', 'Second plan', 60), plain('v3', 'Third plan', 60), plain('v4', 'Fourth plan', 60)], 30),
      para('note', 'Small print', 400)],
    defaults: () => ({
      heading: 'Choose a membership', intro: 'All plans include the open gym floor. Pay monthly at the desk or by eSewa.',
      columns: [{ name: 'Open gym', note: 'Rs 3,000 a month', featured: false }, { name: 'Coached', note: 'Rs 5,500 a month', featured: true }, { name: 'Personal', note: 'Rs 12,000 a month', featured: false }],
      rows: [
        { label: 'Gym floor, 5:30 am to 9 pm', v1: 'yes', v2: 'yes', v3: 'yes', v4: '' },
        { label: 'Group classes a week', v1: 'no', v2: '4', v3: 'Unlimited', v4: '' },
        { label: 'Programme written for you', v1: 'no', v2: 'yes', v3: 'yes', v4: '' },
        { label: 'One-to-one sessions', v1: 'no', v2: 'no', v3: '12 a month', v4: '' },
        { label: 'Body check every month', v1: 'no', v2: 'yes', v3: 'yes', v4: '' },
        { label: 'Locker and towel', v1: 'no', v2: 'yes', v3: 'yes', v4: '' },
      ],
      note: 'Prices include VAT. Freeze your plan for up to a month when you travel.',
    }),
  },
  {
    type: 'voices', name: 'Customer stories', category: 'business', keywords: 'testimonials reviews carousel slider quotes photos customers clients',
    description: 'Words customers really said, with their photo and who they are. No star ratings: only what they wrote.',
    variants: v(['slider', 'One at a time, with the photo'], ['cards', 'Photos and words in a grid'], ['wall', 'Quotes in columns']),
    fields: [text('heading', 'Heading'), para('intro', 'Intro', 400), list('items', 'Stories', 'story', [para('quote', 'Their words', 700), text('name', 'Name', 80), text('role', 'Who they are', 120, 'Like "Came for the bridal package" or "Owner, a bakery in Patan".'), image('image', 'Photo')], 16)],
    defaults: () => ({
      heading: 'In their words', intro: '',
      items: [
        { quote: 'Paste what a customer wrote to you, word for word, and ask them first if you may use it here with their photo.', name: 'Their name', role: 'What they came for, or where they are from', image: noImage() },
        { quote: 'A second story works best when it is about something different: another service, another kind of customer.', name: 'Another name', role: 'Who they are', image: noImage() },
      ],
    }),
  },
  {
    type: 'expand', name: 'Expanding list', category: 'business', keywords: 'accordion rooms services list photos open close details collapsible',
    description: 'Rooms, services or courses as a list; each opens to show its photo, a few lines and a link.',
    variants: v(['rows', 'The photo opens inside the row'], ['split', 'One photo beside the list']),
    fields: [text('heading', 'Heading'), para('intro', 'Intro', 500), list('items', 'Items', 'item', [text('title', 'Name', 100), plain('detail', 'Price, size or time', 60), para('text', 'Text', 700), image('image', 'Photo'), link('link', 'Link')], 12)],
    defaults: () => ({
      heading: 'Rooms', intro: 'Every room has hot water all day, a heater in winter and breakfast on the terrace.',
      items: [
        { title: 'Garden double', detail: 'Rs 3,800 a night', text: 'A queen bed, a bench under the window and a door straight onto the garden. Quiet side of the house.', image: noImage(), link: { label: 'Ask about dates', href: '' } },
        { title: 'Corner room with a view', detail: 'Rs 4,600 a night', text: 'Windows on two sides, a writing desk and the best morning light in the house.', image: noImage(), link: { label: 'Ask about dates', href: '' } },
        { title: 'Family room', detail: 'Rs 6,200 a night', text: 'A double and two singles, a wide bathroom and space for a cot. Sleeps four.', image: noImage(), link: { label: 'Ask about dates', href: '' } },
      ],
    }),
  },
  {
    type: 'enquire', name: 'Products and rooms', category: 'business', keywords: 'products shop catalogue rooms prices enquire whatsapp order buy badge grid',
    description: 'Things or rooms with a photo, price and tag. Each has a button that opens WhatsApp or your form with its name filled in.',
    variants: v(['grid', 'Cards in a grid'], ['wide', 'Two large a row'], ['rows', 'Rows with a small photo']),
    fields: [text('heading', 'Heading'), para('intro', 'Intro', 500), select('currency', 'Currency', CURRENCIES),
      list('items', 'Items', 'item', [image('image', 'Photo'), text('name', 'Name', 90), plain('price', 'Price', 30, 'Numbers only, like 4500, or words like "On request".'), plain('per', 'Per', 30, 'Like night, piece or metre. Optional.'), plain('badge', 'Tag', 24, 'Like New, Popular or Sold out. Optional.'), para('text', 'Short description', 300)], 24),
      plain('button', 'Button on each', 30),
      select('via', 'The button opens', [['whatsapp', 'A WhatsApp message'], ['form', 'The contact or booking form on this page'], ['email', 'An email']]),
      plain('whatsapp', 'WhatsApp number', 40, 'Empty: the phone from Site settings.'),
      plain('message', 'Message starts with', 160, 'The item’s name is added after it.')],
    defaults: () => ({
      heading: 'From the loom', intro: 'Each piece is woven by hand, so colours vary a little. Ask and we will send photos of the one you will get.', currency: 'NPR',
      items: [
        { image: noImage(), name: 'Dhaka shawl, madder red', price: '4800', per: '', badge: 'New', text: 'Cotton, 190 by 70 cm, with a hand-knotted fringe.' },
        { image: noImage(), name: 'Nettle-fibre tote', price: '2200', per: '', badge: '', text: 'Allo fibre from Sankhuwasabha, lined, with an inside pocket.' },
        { image: noImage(), name: 'Pashmina stole, undyed', price: '9500', per: '', badge: 'Popular', text: 'Soft, warm and light enough to wear in spring.' },
      ],
      button: 'Enquire', via: 'whatsapp', whatsapp: '', message: 'Namaste, I would like to ask about',
    }),
  },
  {
    type: 'payment', name: 'Payment details', category: 'business', keywords: 'pay qr esewa khalti fonepay bank transfer account number copy deposit',
    description: 'eSewa, Khalti or bank QR codes with the account details, which visitors copy with one tap.',
    variants: v(['cards', 'Side by side'], ['list', 'Rows']),
    fields: [text('heading', 'Heading'), para('intro', 'Intro', 500),
      list('methods', 'Ways to pay', 'way to pay', [plain('name', 'Name', 40, 'Like eSewa, Khalti or the bank’s name.'), image('qr', 'QR code'), plain('holder', 'Account name', 80), plain('number', 'ID or account number', 60, 'Visitors can copy it with one tap.'), para('details', 'Other details', 300, 'Bank branch, SWIFT code; one per line.')], 6),
      para('note', 'After paying', 500, 'What visitors do next, like sending a screenshot.')],
    defaults: () => ({
      heading: 'Pay online', intro: 'Scan with your wallet or banking app, or copy the details.',
      methods: [
        { name: 'eSewa', qr: noImage(), holder: 'Your business name', number: '98XXXXXXXX', details: '' },
        { name: 'Khalti', qr: noImage(), holder: 'Your business name', number: '98XXXXXXXX', details: '' },
        { name: 'Bank transfer', qr: noImage(), holder: 'Your business name', number: 'Account number', details: 'Your bank, branch\nSWIFT code, for payments from abroad' },
      ],
      note: 'After paying, send a screenshot to our WhatsApp with your name, and we will confirm within the hour.',
    }),
  },
  /* ---- engagement ---- */
  {
    type: 'faq', name: 'Questions', category: 'engagement', keywords: 'faq accordion questions answers',
    description: 'Questions people ask before they call, with short answers.',
    variants: v(['accordion', 'Open one at a time'], ['split', 'Heading left'], ['plain', 'All open']),
    fields: [text('heading', 'Heading'), para('intro', 'Intro', 400), list('items', 'Questions', 'question', [text('q', 'Question', 200), para('a', 'Answer', 1500)], 40)],
    defaults: () => ({ heading: 'Questions', intro: '', items: [{ q: 'A question people often ask?', a: 'A short, direct answer.' }] }),
  },
  {
    type: 'cta', name: 'Call to action', category: 'engagement', keywords: 'banner book call button',
    description: 'One clear next step: book, call, visit or order.',
    variants: v(['band', 'Full-width band'], ['image', 'Over a photo'], ['split', 'Text left, buttons right'], ['boxed', 'Boxed']),
    fields: [text('title', 'Heading', 140), para('text', 'Text', 400), link('primary', 'Main button'), link('secondary', 'Second button'), image('image', 'Background photo')],
    defaults: () => ({ title: 'Ready when you are', text: '', primary: { label: 'Get in touch', href: '' }, secondary: { label: '', href: '' }, image: noImage() }),
  },
  {
    type: 'countdown', name: 'Countdown', category: 'engagement', keywords: 'timer countdown event launch sale opening date festival dashain tihar',
    description: 'Days, hours and minutes to an event, a launch or a sale. The date shows in Nepali (BS) or English (AD).',
    variants: v(['band', 'Large numbers in a row'], ['split', 'Text beside the numbers'], ['image', 'Over a photo']),
    fields: [text('heading', 'Heading', 140), para('text', 'Text', 500), date('date', 'Date', 'Pick the day in English (AD); the Nepali date shows beside it.'), time('time', 'Time', 'Nepal time. Empty: midnight at the start of the day.'),
      select('calendar', 'Show the date as', [['bs', 'Nepali date (BS)'], ['ad', 'English date (AD)'], ['both', 'Both']]),
      text('after', 'Shown once the time comes', 200, 'Replaces the numbers, like "The sale is on now".'), link('link', 'Button'), image('image', 'Background photo')],
    defaults: () => ({ heading: 'The Dashain sale starts in', text: 'Twenty percent off everything in the shop for five days, in store and on phone orders.', date: inDays(21), time: '10:00', calendar: 'both', after: 'The Dashain sale is on now. Come in, or call to order.', link: { label: 'See what is in the sale', href: '' }, image: noImage() }),
  },
  {
    type: 'contact', name: 'Contact form', category: 'engagement', keywords: 'form message email phone enquiry',
    description: 'A short form. Messages arrive in Submissions, and your details sit beside it.',
    variants: v(['split', 'Details beside the form'], ['form', 'Form only'], ['stacked', 'Details above']),
    fields: [text('heading', 'Heading'), para('text', 'Text', 400), para('address', 'Address', 200, 'Empty: the address from Site settings.'), plain('phone', 'Phone', 40, 'Empty: the phone from Site settings.'), plain('email', 'Email', 120, 'Empty: the email from Site settings.'), bool('askPhone', 'Ask for a phone number'), plain('button', 'Button', 40), plain('success', 'Message after sending', 200)],
    defaults: () => ({ heading: 'Write to us', text: '', address: '', phone: '', email: '', askPhone: true, button: 'Send message', success: 'Thank you. We will reply within a day.' }),
    form: { fields: [{ name: 'name', label: 'Name', required: true, max: 120 }, { name: 'email', label: 'Email', kind: 'email', max: 200 }, { name: 'phone', label: 'Phone', kind: 'tel', max: 40 }, { name: 'message', label: 'Message', required: true, kind: 'long', max: 5000 }] },
  },
  {
    type: 'visit', name: 'Contact, map and form', category: 'engagement', keywords: 'contact map form address directions visit find us phone whatsapp hours',
    description: 'Everything for getting in touch in one block: the form, your phone, WhatsApp and hours, and a map.',
    variants: v(['split', 'Details beside the form and map'], ['map', 'Map across the top']),
    fields: [text('heading', 'Heading'), para('text', 'Text', 400), para('address', 'Address', 200, 'Empty: the address from Site settings.'), plain('phone', 'Phone', 40, 'Empty: the phone from Site settings.'), plain('whatsapp', 'WhatsApp number', 40, 'Optional. Adds a "Message on WhatsApp" link.'), plain('email', 'Email', 120, 'Empty: the email from Site settings.'), para('hours', 'Hours', 300, 'Optional. One line per row.'), plain('query', 'Place on the map', 200, 'A place name or address as you would type it into Google Maps. Empty: the address.'), url('link', 'Google Maps link', 'The share link from Google Maps, for directions.'), bool('askPhone', 'Ask for a phone number'), plain('button', 'Button', 40), plain('success', 'Message after sending', 200)],
    defaults: () => ({ heading: 'Come by, call or write', text: 'We reply to messages the same day, and to WhatsApp faster.', address: '', phone: '', whatsapp: '', email: '', hours: 'Sunday to Friday, 9:00 to 18:00\nSaturday closed', query: '', link: '', askPhone: true, button: 'Send message', success: 'Thank you. We will reply within a day.' }),
    form: { fields: [{ name: 'name', label: 'Name', required: true, max: 120 }, { name: 'email', label: 'Email', kind: 'email', max: 200 }, { name: 'phone', label: 'Phone', kind: 'tel', max: 40 }, { name: 'message', label: 'Message', required: true, kind: 'long', max: 5000 }] },
  },
  {
    type: 'booking', name: 'Booking form', category: 'engagement', keywords: 'appointment reservation enquiry book table',
    description: 'Visitors ask for a date and time; you confirm by phone or email.',
    variants: v(['split', 'Text beside the form'], ['form', 'Form only']),
    fields: [text('heading', 'Heading'), para('text', 'Text', 500), para('services', 'Choices (one per line)', 800, 'Visitors pick one, like a service, a table size or a package. Leave empty to skip.'), bool('askTime', 'Ask for a time'), plain('button', 'Button', 40), plain('success', 'Message after sending', 200)],
    defaults: () => ({ heading: 'Ask for a booking', text: 'Pick a day and we will confirm by phone.', services: '', askTime: true, button: 'Send request', success: 'Thank you. We will call to confirm.' }),
    form: { fields: [{ name: 'name', label: 'Name', required: true, max: 120 }, { name: 'phone', label: 'Phone', required: true, kind: 'tel', max: 40 }, { name: 'email', label: 'Email', kind: 'email', max: 200 }, { name: 'choice', label: 'Choice', kind: 'choice', max: 120 }, { name: 'date', label: 'Date', kind: 'date', max: 10 }, { name: 'time', label: 'Time', kind: 'time', max: 5 }, { name: 'notes', label: 'Notes', kind: 'long', max: 2000 }] },
  },
  {
    type: 'newsletter', name: 'Email signup', category: 'engagement', keywords: 'newsletter subscribe updates mailing list',
    description: 'Collect email addresses for news and offers.',
    variants: v(['inline', 'Heading and field in a row'], ['band', 'Coloured band'], ['card', 'Small card']),
    fields: [text('heading', 'Heading'), para('text', 'Text', 300), plain('button', 'Button', 30), plain('success', 'Message after signing up', 200)],
    defaults: () => ({ heading: 'Hear about new things first', text: 'One email a month at most.', button: 'Sign up', success: 'Thank you. You are on the list.' }),
    form: { fields: [{ name: 'email', label: 'Email', required: true, kind: 'email', max: 200 }] },
  },
  {
    type: 'hours', name: 'Opening hours', category: 'engagement', keywords: 'timings open closed schedule',
    description: 'Your days and hours. Today is marked for visitors.',
    variants: v(['table', 'Table'], ['compact', 'Compact'], ['split', 'Beside a note']),
    fields: [text('heading', 'Heading'), para('note', 'Note', 400), list('days', 'Days', 'day', [plain('day', 'Day', 30), plain('hours', 'Hours', 60)], 14)],
    defaults: () => ({ heading: 'Opening hours', note: '', days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day) => ({ day, hours: day === 'Saturday' ? 'Closed' : '10:00 – 18:00' })) }),
  },
  {
    type: 'map', name: 'Map', category: 'engagement', keywords: 'location directions google maps address',
    description: 'A Google map of where you are, with a directions link. No API key needed.',
    variants: v(['location', 'Location card over the map'], ['split', 'Address beside the map'], ['embed', 'Map, full width'], ['card', 'Address card only']),
    fields: [text('heading', 'Heading'), para('address', 'Address', 300, 'Empty: the address from Site settings.'), para('hours', 'Hours', 300, 'Optional. One line per row.'), plain('phone', 'Phone', 40, 'Empty: the phone from Site settings.'), para('note', 'Getting here', 400, 'Landmarks, parking, which gate.'), plain('query', 'Place to show', 200, 'A place name or address as you would type it into Google Maps.'), url('link', 'Google Maps link', 'The share link from Google Maps, for directions.')],
    defaults: () => ({ heading: 'Find us', address: '', hours: '', phone: '', note: '', query: '', link: '' }),
  },
  {
    type: 'timeline', name: 'Timeline', category: 'engagement', keywords: 'history milestones steps process journey',
    description: 'Dates and milestones, or the steps of how you work.',
    variants: v(['vertical', 'Down the page'], ['horizontal', 'Across'], ['list', 'Dated list']),
    fields: [text('heading', 'Heading'), list('items', 'Entries', 'entry', [plain('date', 'Date or step', 30), text('title', 'Title', 100), para('text', 'Text', 500)], 30)],
    defaults: () => ({ heading: 'How it started', items: [{ date: '2079', title: 'The first year', text: '' }] }),
  },
  {
    type: 'beforeafter', name: 'Before and after', category: 'engagement', keywords: 'compare slider transformation',
    description: 'Two photos to compare, with a slider.',
    variants: v(['slider', 'Slider'], ['side', 'Side by side']),
    fields: [text('heading', 'Heading'), image('before', 'Before'), image('after', 'After'), plain('beforeLabel', 'Before label', 30), plain('afterLabel', 'After label', 30), text('caption', 'Caption', 200)],
    defaults: () => ({ heading: '', before: noImage(), after: noImage(), beforeLabel: 'Before', afterLabel: 'After', caption: '' }),
  },
  {
    type: 'downloads', name: 'Downloads and links', category: 'engagement', keywords: 'files pdf brochure links documents',
    description: 'Menus, brochures, forms or useful links.',
    variants: v(['list', 'List'], ['cards', 'Tiles']),
    fields: [text('heading', 'Heading'), list('items', 'Links', 'link', [text('label', 'Label', 100), url('url', 'Link'), plain('note', 'Note', 80, 'Like PDF, 2 pages.')], 30)],
    defaults: () => ({ heading: 'Downloads', items: [{ label: 'Price list', url: '', note: 'PDF' }] }),
  },
  {
    type: 'share', name: 'Brochure and share', category: 'engagement', keywords: 'download pdf menu brochure catalogue share whatsapp facebook copy link',
    description: 'A download button for your menu or brochure, and buttons to share this page on WhatsApp, Facebook or by link.',
    variants: v(['band', 'Download and share side by side'], ['card', 'With a cover photo'], ['inline', 'One quiet row']),
    fields: [text('heading', 'Heading', 140), para('text', 'Text', 400), url('file', 'Menu or brochure link', 'A link to the PDF, for example from Google Drive or Dropbox.'), plain('fileLabel', 'Download button', 50), plain('fileNote', 'About the file', 60, 'Like PDF, 4 pages.'), image('image', 'Cover photo'), bool('showShare', 'Show share buttons'), plain('shareLabel', 'Above the share buttons', 60)],
    defaults: () => ({ heading: 'Take the menu with you', text: 'The full menu with prices, to keep on your phone or send to whoever is choosing tonight.', file: '', fileLabel: 'Download the menu', fileNote: 'PDF, 4 pages', image: noImage(), showShare: true, shareLabel: 'Share this page' }),
  },
  {
    type: 'social', name: 'Social links', category: 'engagement', keywords: 'instagram facebook tiktok follow',
    description: 'Where to follow you. Empty: the links from Site settings.',
    variants: v(['row', 'In a row'], ['list', 'List with names'], ['big', 'Large names']),
    fields: [text('heading', 'Heading'), list('links', 'Links', 'link', [select('network', 'Network', NETWORKS), url('url', 'Link')], 12)],
    defaults: () => ({ heading: 'Follow along', links: [] }),
  },
  {
    type: 'spacer', name: 'Space or divider', category: 'engagement', keywords: 'gap line separator',
    description: 'Breathing room, or a thin line between parts.',
    variants: v(['space', 'Empty space'], ['line', 'Thin line'], ['mark', 'Short accent rule']),
    fields: [select('size', 'Size', [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']])],
    defaults: () => ({ size: 'm' }),
  },
];
export const blockDef = (type: string) => BLOCKS.find((b) => b.type === type);
export const FORM_TYPES = BLOCKS.filter((b) => b.form).map((b) => b.type);

/* ---------------- library photos (runtime/site-img) ---------------- */
/** name → widths available (files are <name>-<width>.webp), smallest first. */
export const LIBRARY: Record<string, { widths: number[]; alt: string }> = {
  /* flagship templates (cafe, clinic, agency): 800 and 1600 wide */
  'cafe-room': { widths: [800, 1600], alt: 'A sunlit café with a pale wood counter, an espresso machine and tables by tall windows' },
  'cafe-barista': { widths: [800, 1600], alt: 'A barista pouring from a gooseneck kettle into pour-over drippers at a dark counter' },
  'cafe-pourover': { widths: [800, 1600], alt: 'A glass pour-over brewer and carafe beside copper kettles on a dark bar' },
  'cafe-latte': { widths: [800, 1600], alt: 'A latte with tulip latte art, seen from above on a dark wooden table' },
  'cafe-roaster': { widths: [800, 1600], alt: 'Freshly roasted beans pouring from a drum roaster into its cooling tray' },
  'cafe-beans': { widths: [800, 1600], alt: 'Close-up of glossy roasted coffee beans' },
  'cafe-cherries': { widths: [800, 1600], alt: 'A branch of ripening red and yellow coffee cherries' },
  'cafe-momo': { widths: [800, 1600], alt: 'Steam rising from a bamboo steamer of momo, with a bowl of dipping sauce' },
  'cafe-momo-2': { widths: [800, 1600], alt: 'Plates of steamed, spinach and pan-fried momo with a bowl of soup' },
  'cafe-chiya': { widths: [800, 1600], alt: 'A steel tray of small glasses of milk tea, from above' },
  'cafe-thali': { widths: [800, 1600], alt: 'A Thakali set on a brass plate: rice, dal, curries, achar, greens and papad' },
  'cafe-pastry': { widths: [800, 1600], alt: 'Rows of golden croissants on baking paper' },
  'cafe-bag': { widths: [800, 1600], alt: 'A plain black coffee pouch with roasted beans in front of it' },
  'cafe-evening': { widths: [800, 1600], alt: 'A Kathmandu durbar square at night, lit temples and light trails' },
  'clinic-reception': { widths: [800, 1600], alt: 'A bright, minimal white clinic lobby with a small indoor tree and curved benches' },
  'clinic-consult': { widths: [800, 1600], alt: 'A doctor writing notes at a desk while a patient sits across from him' },
  'clinic-doctor-1': { widths: [800, 1600], alt: 'Portrait of a smiling woman doctor in a white coat' },
  'clinic-doctor-2': { widths: [800, 1600], alt: 'Portrait of a bearded doctor with glasses and a stethoscope' },
  'clinic-doctor-3': { widths: [800, 1600], alt: 'Portrait of a smiling woman doctor in a white coat over green scrubs' },
  'clinic-child': { widths: [800, 1600], alt: 'A doctor’s stethoscope on a young child’s chest' },
  'clinic-lab': { widths: [800, 1600], alt: 'Blood sample tubes with coloured caps in a rack' },
  'clinic-bp': { widths: [800, 1600], alt: 'A nurse inflating a blood pressure cuff on a patient’s arm' },
  'clinic-pharmacy': { widths: [800, 1600], alt: 'A pharmacist reaching for medicine on pharmacy shelves' },
  'clinic-scan': { widths: [800, 1600], alt: 'A pregnant woman holding an ultrasound print' },
  'clinic-physio': { widths: [800, 1600], alt: 'A physiotherapist working on a patient’s knee' },
  'clinic-room': { widths: [800, 1600], alt: 'A modern consultation room with a desk, chairs and an examination couch' },
  'clinic-hands': { widths: [800, 1600], alt: 'An older person’s hand held by a younger hand' },
  'clinic-stetho': { widths: [800, 1600], alt: 'A stethoscope on a plain light blue background' },
  'agency-studio': { widths: [800, 1600], alt: 'A designer at a desk in a warm, plant-filled studio with prints pinned up' },
  'agency-desk': { widths: [800, 1600], alt: 'A hand sketching app screens on paper' },
  'agency-posters': { widths: [800, 1600], alt: 'A wall of black and white typographic posters' },
  'agency-packaging': { widths: [800, 1600], alt: 'A plain box and a frosted jar with a blank label on pale stone' },
  'agency-tea': { widths: [800, 1600], alt: 'Two green tea tubes on a pale mint background' },
  'agency-stationery': { widths: [800, 1600], alt: 'A stationery suite of cards and envelopes laid flat' },
  'agency-patan': { widths: [800, 1600], alt: 'The courtyard of the Patan palace with carved Newari facades' },
  'agency-hotel': { widths: [800, 1600], alt: 'A calm hotel bedroom with a mustard throw and pendant lamps' },
  'agency-textile': { widths: [800, 1600], alt: 'Brightly coloured warp threads on a loom' },
  'agency-shoot': { widths: [800, 1600], alt: 'A photographer shooting in a studio surrounded by lights' },
  'agency-phone': { widths: [800, 1600], alt: 'Hands holding a phone with a dark app on screen' },
  'agency-team-1': { widths: [800, 1600], alt: 'Portrait of a young woman in a red top in natural light' },
  'agency-team-2': { widths: [800, 1600], alt: 'Portrait of a smiling man with long dark hair' },
  'agency-team-3': { widths: [800, 1600], alt: 'Portrait of a laughing woman in a mustard and navy outfit' },
  'agency-meeting': { widths: [800, 1600], alt: 'Two women reviewing colour swatches in front of a moodboard wall' },
  // --- templates batch B ---
  /* portfolio, ngo, homestay, trek, consultant, photographer: 800 and 1600 wide */
  'ngo-classroom': { widths: [800, 1600], alt: 'Children in blue school uniforms at their desks in a classroom' },
  'ngo-girls': { widths: [800, 1600], alt: 'Two schoolgirls in blue uniforms smiling in their classroom' },
  'ngo-boys': { widths: [800, 1600], alt: 'Three schoolboys sitting close together in a classroom corner' },
  'ngo-school': { widths: [800, 1600], alt: 'A hill school’s buildings and dirt courtyard in low evening sun' },
  'ngo-kitchen': { widths: [800, 1600], alt: 'Two women sifting rice and cooking in a smoky village kitchen' },
  'ngo-dalbhat': { widths: [800, 1600], alt: 'Rice, dal and sautéed greens in brass bowls' },
  'ngo-pot': { widths: [800, 1600], alt: 'A cook stirring a big pot of vegetable curry over a wood fire' },
  'ngo-washing': { widths: [800, 1600], alt: 'A woman washing large cooking pots in a yard' },
  'ngo-desk': { widths: [800, 1600], alt: 'Boys at a school desk in a blue-painted classroom' },
  'ngo-desks': { widths: [800, 1600], alt: 'Young children sitting at green desks in a classroom' },
  'ngo-line': { widths: [800, 1600], alt: 'Children sitting in a long row outdoors in morning light' },
  'ngo-market': { widths: [800, 1600], alt: 'Women selling vegetables and marigolds from baskets by a brick wall' },
  'ngo-nutrition': { widths: [800, 1600], alt: 'Schoolchildren looking at a nutrition corner display with Nepali signs' },
  'ngo-walk': { widths: [800, 1600], alt: 'Children in grey school uniforms and ties standing on the road' },
  'ngo-meal': { widths: [800, 1600], alt: 'Children in blue uniforms eating a midday meal sitting on the floor' },
  'trek-everest': { widths: [800, 1600], alt: 'A stupa and prayer flags on a ridge below Everest and Lhotse' },
  'trek-amadablam': { widths: [800, 1600], alt: 'Trekkers on the valley trail below Ama Dablam' },
  'trek-namche': { widths: [800, 1600], alt: 'Namche Bazaar’s houses on a hillside under snow peaks' },
  'trek-tengboche': { widths: [800, 1600], alt: 'The painted gate of Tengboche monastery with peaks behind' },
  'trek-porter': { widths: [800, 1600], alt: 'A porter carrying a load over rocks below a snow face' },
  'trek-rest': { widths: [800, 1600], alt: 'Trekkers resting on rocks facing Ama Dablam' },
  'trek-bridge': { widths: [800, 1600], alt: 'A suspension bridge hung with prayer flags over a forested gorge' },
  'trek-porter-bridge': { widths: [800, 1600], alt: 'A porter crossing a steel suspension bridge with a heavy load' },
  'trek-yak': { widths: [800, 1600], alt: 'A yak grazing beside a frozen lake below the peaks' },
  'trek-gokyo': { widths: [800, 1600], alt: 'Gokyo lakes and the glacier seen from above' },
  'trek-ebc': { widths: [800, 1600], alt: 'The Everest Base Camp rock with prayer flags and the icefall behind' },
  'trek-glacier': { widths: [800, 1600], alt: 'A group of trekkers crossing glacier moraine' },
  'trek-langtang': { widths: [800, 1600], alt: 'Kyanjin Gompa’s lodges in the Langtang valley under snow peaks' },
  'trek-maniwall': { widths: [800, 1600], alt: 'A trekker walking beside a mani wall in a green valley' },
  'trek-gorakshep': { widths: [800, 1600], alt: 'Blue-roofed lodges at the edge of the moraine below snow peaks' },
  'stay-house': { widths: [800, 1600], alt: 'A stone village house at dusk with Annapurna South lit pink behind' },
  'stay-village': { widths: [800, 1600], alt: 'Slate-roofed houses of a Gurung village on a hillside' },
  'stay-cloud': { widths: [800, 1600], alt: 'Village rooftops with cloud rolling over the hills' },
  'stay-night': { widths: [800, 1600], alt: 'The village’s slate roofs and lit windows at night' },
  'stay-alpenglow': { widths: [800, 1600], alt: 'Last light on Annapurna South and Machhapuchhre' },
  'stay-steps': { widths: [800, 1600], alt: 'Stone steps climbing through a mossy forest' },
  'stay-stone': { widths: [800, 1600], alt: 'Two stone houses with slate roofs beside a field' },
  'stay-family': { widths: [800, 1600], alt: 'A family sitting in the doorway of their stone house' },
  'stay-room': { widths: [800, 1600], alt: 'A small timber-lined room with a window onto the mountains' },
  'stay-bed': { widths: [800, 1600], alt: 'A wood-panelled guest room with a made bed' },
  'stay-thali': { widths: [800, 1600], alt: 'A brass plate of rice, dal and vegetable curries on a woven dhaka cloth' },
  'stay-aama': { widths: [800, 1600], alt: 'An elderly woman in a red vest sitting on a porch' },
  'stay-stove': { widths: [800, 1600], alt: 'A kettle on a wood-fired clay stove' },
  'stay-chiya': { widths: [800, 1600], alt: 'Milk tea being poured into a glass' },
  'stay-fields': { widths: [800, 1600], alt: 'People working a green field below a snow peak' },
  'ca-partner': { widths: [800, 1600], alt: 'A man in a suit at his office desk with a laptop' },
  'ca-partner-2': { widths: [800, 1600], alt: 'A woman in a cream blazer at an office desk' },
  'ca-partner-3': { widths: [800, 1600], alt: 'A woman in a white blazer and glasses at her desk' },
  'ca-calc': { widths: [800, 1600], alt: 'Hands working a calculator at a desk' },
  'ca-desk': { widths: [800, 1600], alt: 'A calculator, glasses, printed charts and binders on a desk' },
  'ca-review': { widths: [800, 1600], alt: 'Hands going through printed forms with a calculator and coffee' },
  'ca-ledger': { widths: [800, 1600], alt: 'A calculator and pen on a ledger page' },
  'ca-khata': { widths: [800, 1600], alt: 'Old handwritten account books open on a table' },
  'ca-shop': { widths: [800, 1600], alt: 'A shopkeeper in a small kiosk hung with snacks' },
  'ca-workshop': { widths: [800, 1600], alt: 'A carpenter cutting timber in his workshop' },
  'ca-meeting': { widths: [800, 1600], alt: 'Two people going through documents at a table' },
  'ca-training': { widths: [800, 1600], alt: 'A training session around a long meeting table' },
  'ca-office': { widths: [800, 1600], alt: 'A woman smiling at her desk in a busy office' },
  'photo-bride': { widths: [800, 1600], alt: 'A bride in a red and gold sari looking down, against a dark wall' },
  'photo-bride-2': { widths: [800, 1600], alt: 'A bride in red with hennaed hands raised' },
  'photo-couple': { widths: [800, 1600], alt: 'A couple in wedding clothes walking down a hillside path' },
  'photo-henna': { widths: [800, 1600], alt: 'Two hennaed hands holding each other, with red bangles' },
  'photo-bangles': { widths: [800, 1600], alt: 'Hennaed hands with gold bangles resting on an orange sari' },
  'photo-doorway': { widths: [800, 1600], alt: 'A woman in a red and black sari standing in a carved doorway' },
  'photo-headpiece': { widths: [800, 1600], alt: 'A woman in a golden headpiece and red beads at a festival' },
  'photo-aama': { widths: [800, 1600], alt: 'An older woman smiling in a red blouse in a narrow street' },
  'photo-girl': { widths: [800, 1600], alt: 'A young girl in red and gold with a festival crowd behind' },
  'photo-lamps': { widths: [800, 1600], alt: 'A woman sitting among hundreds of lit oil lamps' },
  'photo-family': { widths: [800, 1600], alt: 'A family in festival clothes walking down a busy street' },
  'photo-garlands': { widths: [800, 1600], alt: 'Newlyweds laughing in flower garlands and a dhaka topi' },
  'photo-outdoors': { widths: [800, 1600], alt: 'A bride and groom face to face outdoors' },
  'photo-mirror': { widths: [800, 1600], alt: 'A bride checking her reflection in a mirror' },
  'photo-garland-exchange': { widths: [800, 1600], alt: 'A couple exchanging garlands in front of red and gold drapes' },
  'arch-house': { widths: [800, 1600], alt: 'A brick house with a glass-block wall and tall windows' },
  'arch-gable': { widths: [800, 1600], alt: 'The brick gable and deep eave of a house against a blue sky' },
  'arch-lightwell': { widths: [800, 1600], alt: 'A light well with a brick wall, a young tree and timber shelving' },
  'arch-walkway': { widths: [800, 1600], alt: 'A steel walkway crossing a tall brick courtyard' },
  'arch-courtyard': { widths: [800, 1600], alt: 'A courtyard with timber balconies around a tree' },
  'arch-balcony': { widths: [800, 1600], alt: 'Carved timber balconies under a tiled roof, seen from a courtyard' },
  'arch-window': { widths: [800, 1600], alt: 'A carved timber window on an old brick facade' },
  'arch-hall': { widths: [800, 1600], alt: 'Sunlight falling between brick columns in a long hall' },
  'arch-model': { widths: [800, 1600], alt: 'A white card model of a house with a stair' },
  'arch-plan': { widths: [800, 1600], alt: 'A hand drawing a floor plan with a pencil and scale' },
  'arch-sketch': { widths: [800, 1600], alt: 'Someone sketching the temples of a durbar square' },
  'arch-jali': { widths: [800, 1600], alt: 'A terracotta breeze-block screen' },
  'arch-portrait': { widths: [800, 1600], alt: 'Portrait of a woman with glasses in a checked shirt' },
  'arch-site': { widths: [800, 1600], alt: 'Masons stacking bricks on a building site' },
  'arch-night': { widths: [800, 1600], alt: 'A dark brick house with lit windows at night' },
  // --- end batch B ---
  // --- templates batch A ---
  /* salon, gym, tuition, boutique, realestate and wedding templates: 800 and 1600 wide */
  'bloom-room': { widths: [800, 1600], alt: 'A bright white salon with plants, styling chairs and a stylist at work by the window' },
  'bloom-styling': { widths: [800, 1600], alt: 'A stylist finishing a client’s hair in a sunny white salon' },
  'bloom-cut': { widths: [800, 1600], alt: 'A stylist trimming long dark wet hair with scissors' },
  'bloom-colour': { widths: [800, 1600], alt: 'Two colourists in gloves brushing colour through a client’s hair' },
  'bloom-bride': { widths: [800, 1600], alt: 'A bride in a red and gold veil and heavy gold jewellery, smiling down' },
  'bloom-bride-2': { widths: [800, 1600], alt: 'Close-up of bridal make-up: shimmer eyes, a pink lip and a nose ring with a chain' },
  'bloom-mehndi': { widths: [800, 1600], alt: 'A bride’s hands and wrists covered in fine mehndi over a red carpet' },
  'bloom-threading': { widths: [800, 1600], alt: 'A woman having her eyebrows shaped with a twisted thread' },
  'bloom-lashes': { widths: [800, 1600], alt: 'A beautician in a mask applying lash extensions to a client lying back' },
  'bloom-facial': { widths: [800, 1600], alt: 'A woman lying back with a white face mask and a teal headband' },
  'bloom-nails': { widths: [800, 1600], alt: 'A nail technician filing a client’s nails over a dust extractor' },
  'bloom-blowdry': { widths: [800, 1600], alt: 'A young woman with glossy, loose black waves' },
  'bloom-wash': { widths: [800, 1600], alt: 'Two stylists washing clients’ hair at the basins' },
  'lift-deadlift': { widths: [800, 1600], alt: 'A man in a black vest holding a barbell with green plates in a dark gym' },
  'lift-press': { widths: [800, 1600], alt: 'A man pressing two dumbbells on an incline bench' },
  'lift-pulldown': { widths: [800, 1600], alt: 'A bearded man in a turban pulling down on a lat machine' },
  'lift-coach': { widths: [800, 1600], alt: 'Portrait of a smiling coach in a yellow T-shirt on the gym floor' },
  'lift-rest': { widths: [800, 1600], alt: 'A man in a green vest resting on a bench between sets' },
  'lift-squat': { widths: [800, 1600], alt: 'A woman doing a split squat with a barbell in a squat rack' },
  'lift-pt': { widths: [800, 1600], alt: 'A coach correcting a man’s push-up position on the turf' },
  'lift-boxing': { widths: [800, 1600], alt: 'Two women laughing in boxing gloves by a heavy bag' },
  'lift-plate': { widths: [800, 1600], alt: 'A lifter’s hand on a loaded barbell on a rubber floor' },
  'lift-floor': { widths: [800, 1600], alt: 'Squat racks with coloured bumper plates under a skylit roof' },
  'lift-pull': { widths: [800, 1600], alt: 'A lifter’s hands and feet set for a deadlift on a rubber floor' },
  'lift-dumbbells': { widths: [800, 1600], alt: 'Two rows of dumbbells on a rack against a block wall' },
  'lift-bells': { widths: [800, 1600], alt: 'Rows of black kettlebells on a gym floor' },
  'study-physics': { widths: [800, 1600], alt: 'A teacher drawing a physics diagram on a green chalkboard' },
  'study-lab': { widths: [800, 1600], alt: 'A student looking through a microscope in a science lab' },
  'study-microscopes': { widths: [800, 1600], alt: 'A row of microscopes on a lab bench' },
  'study-desk': { widths: [800, 1600], alt: 'A study desk at night with a scientific calculator and pages of worked problems' },
  'study-lecture': { widths: [800, 1600], alt: 'A teacher talking to a small class seated at long desks' },
  'study-board': { widths: [800, 1600], alt: 'A schoolgirl in a white uniform writing on a blackboard' },
  'study-class': { widths: [800, 1600], alt: 'Schoolgirls in white uniforms listening in a classroom' },
  'study-test': { widths: [800, 1600], alt: 'A boy in glasses thinking over his exam paper at a wooden desk' },
  'study-library': { widths: [800, 1600], alt: 'A student reading at a long table in a wood-panelled library' },
  'study-room': { widths: [800, 1600], alt: 'An empty science classroom with benches and a green board' },
  'study-revision': { widths: [800, 1600], alt: 'A student reading her notes at a table in a quiet classroom' },
  'study-notes': { widths: [800, 1600], alt: 'A girl writing in her exercise book with a pencil' },
  'sari-green-sari': { widths: [800, 1600], alt: 'A woman in a green silk sari with a long gold and ruby necklace' },
  'sari-white-sari': { widths: [800, 1600], alt: 'A woman in a cream sari with a red and gold border and a red blouse' },
  'sari-red-sari': { widths: [800, 1600], alt: 'A woman in a red and gold silk sari by the sea' },
  'sari-mint-sari': { widths: [800, 1600], alt: 'A woman in a pale mint and silver sari against a red wall' },
  'sari-border': { widths: [800, 1600], alt: 'Close-up of red silk with a woven gold border' },
  'sari-cloth': { widths: [800, 1600], alt: 'Folded lengths of lime and magenta cloth with tassels' },
  'sari-pink-sari': { widths: [800, 1600], alt: 'A smiling woman in a magenta silk sari with a black and gold border' },
  'sari-kurta': { widths: [800, 1600], alt: 'A red block-printed kurta on a mannequin in a shop' },
  'sari-white-kurta': { widths: [800, 1600], alt: 'A woman in a white embroidered cotton kurta' },
  'sari-mens-kurta': { widths: [800, 1600], alt: 'A man in a pale yellow kurta against a warm wall' },
  'sari-loom': { widths: [800, 1600], alt: 'A weaver at a handloom working a black, white and red cloth' },
  'sari-sewing': { widths: [800, 1600], alt: 'Hands guiding cloth under a sewing machine needle' },
  'sari-folds': { widths: [800, 1600], alt: 'Rolled lengths of cloth in mustard, grey and maroon' },
  'sari-shop': { widths: [800, 1600], alt: 'A small shop with shelves stacked with folded printed cloth' },
  'estate-bungalow': { widths: [800, 1600], alt: 'A white housing-colony building with red roofs and arched windows' },
  'estate-lane': { widths: [800, 1600], alt: 'A quiet residential lane of Kathmandu houses with a parked car' },
  'estate-valley': { widths: [800, 1600], alt: 'Houses climbing a green hillside on the edge of Kathmandu' },
  'estate-modern': { widths: [800, 1600], alt: 'A white modern house with deep window boxes under a blue sky' },
  'estate-townhouse': { widths: [800, 1600], alt: 'A three-storey white house with balconies at dusk' },
  'estate-house': { widths: [800, 1600], alt: 'A single-storey white house with a stone path, lawn and two planters' },
  'estate-living': { widths: [800, 1600], alt: 'A bright living room with a vaulted ceiling and wood floor' },
  'estate-kitchen': { widths: [800, 1600], alt: 'A white kitchen with an island, bar stools and pendant lamps' },
  'estate-bedroom': { widths: [800, 1600], alt: 'A calm bedroom with a large bed, a bench and a tall window' },
  'estate-sunroom': { widths: [800, 1600], alt: 'A sunny living room with a sofa and a balcony door onto the city' },
  'estate-plans': { widths: [800, 1600], alt: 'Two people marking up house plans with a ruler and calculator' },
  'estate-keys': { widths: [800, 1600], alt: 'A hand holding up house keys in an open doorway' },
  'estate-dining': { widths: [800, 1600], alt: 'A dining area with a black table by an open staircase' },
  'vivah-bride': { widths: [800, 1600], alt: 'A Nepali bride in a red and white sari with a tall garland, standing on a terrace' },
  'vivah-garlands': { widths: [800, 1600], alt: 'A bride and groom in marigold and flower garlands, holding hands' },
  'vivah-pote': { widths: [800, 1600], alt: 'A bride in pink with a green and red pote necklace on a balcony' },
  'vivah-ceremony': { widths: [800, 1600], alt: 'A bride and groom seated before the fire at their wedding rites' },
  'vivah-swagat': { widths: [800, 1600], alt: 'A groom in a dhaka topi and garlands welcomed with fruit and flowers' },
  'vivah-rites': { widths: [800, 1600], alt: 'The couple’s hands during an offering among rice, fruit and flowers' },
  'vivah-mehndi': { widths: [800, 1600], alt: 'Several hands with fresh mehndi held together over yellow and green clothes' },
  'vivah-marigold': { widths: [800, 1600], alt: 'A heap of bright orange marigolds' },
  'vivah-garland-strings': { widths: [800, 1600], alt: 'Strings of marigold and white jasmine hanging as a curtain' },
  'vivah-lights': { widths: [800, 1600], alt: 'A garden aisle lit by string lights, between rows of white chairs' },
  'vivah-mandap': { widths: [800, 1600], alt: 'A white floral mandap at the end of an aisle, with hills behind' },
  'vivah-bouquet': { widths: [800, 1600], alt: 'A Nepali bride in red holding a bouquet and smiling' },
  'vivah-ring': { widths: [800, 1600], alt: 'The groom slipping a ring onto the bride’s finger at the ceremony' },
  'vivah-pair': { widths: [800, 1600], alt: 'A bride and groom sitting cross-legged side by side during the rites' },
  'vivah-haldi': { widths: [800, 1600], alt: 'A woman in a yellow sari and flower jewellery beside marigold strings' },
  // --- end batch A ---
  /* earlier photos: 640 and 1400 wide */
  'salon-chairs': { widths: [640, 1400], alt: 'A bright hair salon with styling chairs and a long mirror' },
  'salon-mirrors': { widths: [640, 1400], alt: 'Salon chairs facing round mirrors on a dark wall' },
  'salon-facial': { widths: [640, 1400], alt: 'A therapist giving a facial to a woman lying back' },
  'gym-barbell': { widths: [640, 1400], alt: 'A loaded barbell beside a squat rack' },
  'gym-kettlebells': { widths: [640, 1400], alt: 'A wall of black kettlebells in a dark gym' },
  'gym-lift': { widths: [640, 1400], alt: 'A lifter gripping a barbell overhead' },
  'gym-dumbbells': { widths: [640, 1400], alt: 'Rows of black dumbbells on a rack' },
  'school-class': { widths: [640, 1400], alt: 'Students at desks listening to a teacher' },
  'school-lecture': { widths: [640, 1400], alt: 'A teacher speaking to students while a student raises a hand' },
  'school-board': { widths: [640, 1400], alt: 'A hand writing an equation on a chalkboard' },
  'shop-fabric-shelf': { widths: [640, 1400], alt: 'Shelves of folded cloth rolls in a small shop' },
  'shop-fabric-rolls': { widths: [640, 1400], alt: 'Stacked folded fabric in blue, teal, cream and magenta' },
  'shop-rack': { widths: [640, 1400], alt: 'A rail of ready-made clothes in a shop' },
  'home-modern': { widths: [640, 1400], alt: 'A modern house with tall glass doors and a garden' },
  'home-garden': { widths: [640, 1400], alt: 'A two-storey house with a timber and stone facade and a lawn' },
  'home-living': { widths: [640, 1400], alt: 'A bright living room with a sofa and large windows' },
  'food-spread': { widths: [640, 1400], alt: 'Plates of grilled meat, greens and dipping sauce on a wooden table' },
  'dinner-plate': { widths: [640, 1400], alt: 'A plated dish on a busy dinner table' },
  'cafe-hall': { widths: [640, 1400], alt: 'A bright café with long tables and hanging lamps' },
  'dining-room': { widths: [640, 1400], alt: 'A dark dining room with wooden chairs' },
  'long-table': { widths: [640, 1400], alt: 'A long table set with glasses and flowers' },
  'wedding-bouquet': { widths: [640, 1400], alt: 'A bride holding a bouquet in warm light' },
  'camera-kit': { widths: [640, 1400], alt: 'A camera body and two lenses on a dark table' },
  'ridge-photographer': { widths: [640, 1400], alt: 'A photographer on a rocky ridge above the clouds' },
  'portrait-woman': { widths: [640, 1400], alt: 'Portrait of a woman in a striped shirt' },
  'portrait-man': { widths: [640, 1400], alt: 'Portrait of a smiling man' },
  'doctor-visit': { widths: [640, 1400], alt: 'A doctor talking with a patient' },
  boudha: { widths: [640, 1400], alt: 'Boudhanath stupa from above, surrounded by the city' },
  swayambhu: { widths: [640, 1400], alt: 'Swayambhu stupa with prayer flags' },
  'himal-trek': { widths: [640, 1400], alt: 'A trekker looking at snow peaks' },
  'night-peaks': { widths: [640, 1400], alt: 'Snow peaks under a starry sky' },
  'shoot-cheers': { widths: [1400], alt: 'Two coffee cups raised together' },
};

/* ---------------- sanitising ---------------- */
const ENTITY = /^&(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#x[0-9a-fA-F]{1,6});/;
/** Text between tags: keep real entities, escape everything else that could be markup. */
function escText(s: string) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '&') { const m = ENTITY.exec(s.slice(i, i + 40)); if (m) { out += m[0]; i += m[0].length - 1; } else out += '&amp;'; }
    else if (c === '<') out += '&lt;';
    else if (c === '>') out += '&gt;';
    else out += c;
  }
  return out;
}
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const decodeAttr = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/**
 * A link a site may use: web and mail/phone links, a page of the site (page:<id>), an anchor on the
 * page (#…) or an address on the same host (/…). Anything else (javascript:, data:, protocol-relative) is dropped.
 */
export function safeHref(raw: unknown): string {
  const u = String(raw ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (!u || u.length > 800) return '';
  if (/^https?:\/\/[^\s"'<>]+$/i.test(u)) return u;
  if (/^mailto:[^\s"'<>]+$/i.test(u) || /^tel:[+\d\s().-]{3,30}$/i.test(u)) return u.replace(/\s+/g, '');
  if (/^page:[\w-]{1,40}$/.test(u)) return u;
  if (/^#[\w-]{1,60}$/.test(u)) return u;
  if (/^\/(?!\/)[^\s"'<>]*$/.test(u)) return u;
  // "www.example.com" typed without the scheme.
  if (/^[\w-]+(\.[\w-]+)+(\/[^\s"'<>]*)?$/.test(u)) return 'https://' + u;
  return '';
}

const INLINE_TAGS = new Set(['strong', 'em', 'a', 'br']);
const RICH_TAGS = new Set([...INLINE_TAGS, 'p', 'ul', 'ol', 'li', 'h3']);
const MAP: Record<string, string> = { b: 'strong', i: 'em', div: 'p', h1: 'h3', h2: 'h3', h4: 'h3' };
const DROP_WITH_CONTENT = /<(script|style|template|iframe|object|embed|svg|math|textarea|select|noscript|title|head)\b[\s\S]*?<\/\1\s*>/gi;

function sanitize(input: unknown, allowed: Set<string>, max: number): string {
  let s = String(input ?? '');
  if (s.length > max * 3) s = s.slice(0, max * 3);
  s = s.replace(/<!--[\s\S]*?(-->|$)/g, '').replace(DROP_WITH_CONTENT, '').replace(/<(script|style)\b[\s\S]*$/gi, '');
  const out: string[] = [];
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0; let textLen = 0; let m: RegExpExecArray | null;
  const pushText = (t: string) => { if (textLen >= max) return; const cut = t.slice(0, max - textLen); textLen += cut.length; out.push(escText(cut)); };
  while ((m = re.exec(s))) {
    pushText(s.slice(last, m.index));
    last = re.lastIndex;
    const closing = m[1] === '/';
    const raw = m[2].toLowerCase();
    const tag = MAP[raw] ?? raw;
    if (!allowed.has(tag)) continue;
    if (tag === 'br') { if (!closing) out.push('<br>'); continue; }
    if (closing) {
      const at = stack.lastIndexOf(tag);
      if (at < 0) continue;
      while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }
    // Block tags close an open paragraph; a link never sits inside a link.
    if (['p', 'ul', 'ol', 'h3'].includes(tag)) { while (stack.length && ['p', 'strong', 'em', 'a', 'h3'].includes(stack[stack.length - 1])) out.push(`</${stack.pop()}>`); }
    if (tag === 'li' && !stack.some((t) => t === 'ul' || t === 'ol')) continue;
    if (tag === 'a') {
      if (stack.includes('a')) continue;
      const hm = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[3]);
      const href = safeHref(decodeAttr(hm ? (hm[1] ?? hm[2] ?? hm[3] ?? '') : ''));
      if (!href) continue;
      const blank = /\btarget\s*=\s*["']?_blank/i.test(m[3]);
      out.push(`<a href="${esc(href)}"${blank ? ' target="_blank" rel="noopener noreferrer"' : ''}>`);
      stack.push('a');
      continue;
    }
    out.push(`<${tag}>`);
    stack.push(tag);
  }
  pushText(s.slice(last));
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join('').replace(/<(strong|em|a|p|h3|li)(\s[^>]*)?>\s*<\/\1>/g, (all, t) => (t === 'p' ? '' : all.includes('href') ? all : ''));
}
/** One line of text with bold, italic and links (headlines, names, captions). */
export const sanitizeInline = (s: unknown, max = 400) => sanitize(s, INLINE_TAGS, max).replace(/^(<br>)+|(<br>)+$/g, '');
/** Paragraphs and lists as well (the Text block). */
export const sanitizeRich = (s: unknown, max = 12000) => sanitize(s, RICH_TAGS, max);
/** Plain text: no markup at all, one line. */
export const cleanPlain = (s: unknown, max = 200) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** The words of an inline value (for titles, alt text and search results). */
export const textOf = (s: unknown) => String(s ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

/* ---------------- checking a whole site ---------------- */
export const newBlockId = () => 'b' + Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 5);
export const newPageId = () => 'p' + Math.random().toString(36).slice(2, 9);
const HEX = /^#[0-9a-fA-F]{6}$/;
const RESERVED_SLUGS = new Set(['assets', '__jhino', '_jhino', 'api', 'index', 'sitemap', 'robots', 'favicon']);
export const slugOk = (s: string) => /^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/.test(s) && !RESERVED_SLUGS.has(s);
export const toSlug = (s: string) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

/** Library photos that were retired, and the photo that replaces each (so older sites keep a picture). */
export const LIBRARY_MOVED: Record<string, string> = {
  'cut-pour-over': 'cafe-pourover', 'shoot-beans': 'cafe-beans', 'shoot-cheers': 'cafe-latte', 'cafe-window': 'cafe-room', 'shoot-iced': 'cafe-latte', 'shoot-lattes': 'cafe-latte',
  'cafe-hall': 'cafe-room', 'doctor-visit': 'clinic-consult', 'doctor-coat': 'clinic-doctor-2', 'pill-bottle': 'clinic-pharmacy',
};
export function cleanImage(raw: any): ImageRef {
  let src0 = String(raw?.src ?? '').trim();
  if (/^lib:/.test(src0) && !LIBRARY[src0.slice(4)] && LIBRARY_MOVED[src0.slice(4)]) src0 = 'lib:' + LIBRARY_MOVED[src0.slice(4)];
  let src = '';
  if (/^file:[\w-]{1,64}$/.test(src0)) src = src0;
  else if (/^lib:[\w-]{1,40}$/.test(src0) && LIBRARY[src0.slice(4)]) src = src0;
  else if (/^https:\/\/[^\s"'<>]{4,900}$/i.test(src0)) src = src0;
  const out: ImageRef = { src, alt: cleanPlain(raw?.alt, 240) };
  const f = raw?.focal;
  if (Array.isArray(f) && f.length === 2 && f.every((n) => typeof n === 'number' && isFinite(n))) {
    const fx = Math.round(Math.min(100, Math.max(0, f[0]))), fy = Math.round(Math.min(100, Math.max(0, f[1])));
    if (fx !== 50 || fy !== 50) out.focal = [fx, fy];
  }
  return out;
}
export function cleanLink(raw: any): LinkRef {
  const out: LinkRef = { label: cleanPlain(raw?.label, 60), href: safeHref(raw?.href) };
  if (raw?.newTab) out.newTab = true;
  return out;
}

function cleanValue(f: Field, raw: any, dflt: any): any {
  switch (f.type) {
    case 'text': return raw === undefined ? dflt ?? '' : sanitizeInline(raw, f.max ?? 200);
    case 'para': return raw === undefined ? dflt ?? '' : sanitizeInline(raw, f.max ?? 900);
    case 'rich': return raw === undefined ? dflt ?? '' : sanitizeRich(raw, f.max ?? 12000);
    case 'plain': return raw === undefined ? dflt ?? '' : cleanPlain(raw, f.max ?? 120);
    case 'url': return raw === undefined ? dflt ?? '' : safeHref(raw);
    case 'image': return cleanImage(raw ?? dflt);
    case 'link': return cleanLink(raw ?? dflt);
    case 'bool': return raw === undefined ? !!dflt : !!raw;
    case 'select': { const val = raw === undefined ? dflt : String(raw); return f.options!.some((o) => o.value === val) ? val : f.options![0].value; }
    case 'number': {
      const lo = f.lo ?? 0, hi = f.hi ?? 100;
      const n = typeof raw === 'number' ? raw : raw === undefined || raw === null || raw === '' ? NaN : Number(String(raw).trim());
      const d = typeof dflt === 'number' && isFinite(dflt) ? dflt : Math.round((lo + hi) / 2);
      return isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 10) / 10)) : d;
    }
    case 'date': { const s = String(raw === undefined ? dflt ?? '' : raw ?? '').trim(); return /^(19|20)\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) ? s : ''; }
    case 'time': { const s = String(raw === undefined ? dflt ?? '' : raw ?? '').trim(); return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : ''; }
    case 'list': {
      const arr = Array.isArray(raw) ? raw : Array.isArray(dflt) ? dflt : [];
      return arr.slice(0, f.maxItems ?? 40).map((it: any) => cleanProps(f.of!, it && typeof it === 'object' ? it : {}, {}));
    }
  }
}
function cleanProps(fields: Field[], raw: Record<string, any>, dflt: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const f of fields) out[f.key] = cleanValue(f, raw[f.key], dflt[f.key]);
  return out;
}

export function cleanBlock(raw: any, ids: Set<string>): Block | null {
  const def = blockDef(String(raw?.type ?? ''));
  if (!def) return null;
  let id = String(raw?.id ?? '');
  if (!/^[\w-]{4,24}$/.test(id) || ids.has(id)) id = newBlockId();
  ids.add(id);
  const variant = def.variants.some((x) => x.id === raw?.variant) ? String(raw.variant) : def.variants[0].id;
  const s = raw?.style ?? {};
  const style: BlockStyle = {
    bg: ['page', 'surface', 'accent', 'ink'].includes(s.bg) ? s.bg : 'page',
    space: ['s', 'm', 'l'].includes(s.space) ? s.space : 'm',
    hide: ['mobile', 'desktop'].includes(s.hide) ? s.hide : '',
  };
  return { id, type: def.type, variant, props: cleanProps(def.fields, raw?.props && typeof raw.props === 'object' ? raw.props : {}, def.defaults()), style };
}

export function cleanTheme(input: any): Theme {
  let raw = input;
  // A theme id from before the redesign: move to its successor. Colours and fonts the owner never changed
  // follow the new theme; ones they did change are kept.
  const legacy = LEGACY_PRESETS[String(raw?.preset ?? '')];
  if (legacy) {
    const c = raw?.colors ?? {};
    const custom = COLOR_KEYS.some((k, i) => typeof c[k] === 'string' && c[k].toLowerCase() !== legacy.colors[i]);
    raw = { ...raw, preset: legacy.to, colors: custom ? raw.colors : undefined, display: raw.display && raw.display !== legacy.display ? raw.display : undefined, body: raw.body && raw.body !== legacy.body ? raw.body : undefined, scale: undefined };
    if (!custom) { raw.radius = undefined; raw.button = undefined; raw.rhythm = undefined; raw.caps = undefined; raw.space = undefined; }
  }
  const base = presetById(String(raw?.preset ?? '')).theme;
  const c = raw?.colors ?? {};
  const colors = { ...base.colors };
  for (const k of COLOR_KEYS) if (typeof c[k] === 'string' && HEX.test(c[k])) colors[k] = c[k].toLowerCase();
  const num = (n: unknown, lo: number, hi: number, d: number) => (typeof n === 'number' && isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);
  return {
    scale: Math.round(num(raw?.scale, 0.85, 1.15, base.scale) * 100) / 100,
    preset: PRESETS.some((p) => p.id === raw?.preset) ? raw.preset : base.preset,
    display: FONTS.some((f) => f.id === raw?.display) ? raw.display : base.display,
    body: FONTS.some((f) => f.id === raw?.body) ? raw.body : base.body,
    colors,
    radius: Math.round(num(raw?.radius, 0, 28, base.radius)),
    space: Math.round(num(raw?.space, 0.8, 1.3, base.space) * 100) / 100,
    button: ['solid', 'outline', 'pill', 'underline'].includes(raw?.button) ? raw.button : base.button,
    rhythm: ['tight', 'even', 'airy'].includes(raw?.rhythm) ? raw.rhythm : base.rhythm,
    caps: typeof raw?.caps === 'boolean' ? raw.caps : base.caps,
  };
}

export const MAX_PAGES = 30;
export const MAX_BLOCKS = 60;
/** Any input → a valid site (unknown things dropped, text sanitised, limits applied). */
export function cleanSite(raw: any): Site {
  const ids = new Set<string>();
  const st = raw?.settings ?? {};
  const settings: SiteSettings = {
    logo: st.logo && cleanImage(st.logo).src ? cleanImage(st.logo) : null,
    favicon: st.favicon && cleanImage(st.favicon).src ? cleanImage(st.favicon) : null,
    socialImage: st.socialImage && cleanImage(st.socialImage).src ? cleanImage(st.socialImage) : null,
    tagline: cleanPlain(st.tagline, 160),
    lang: st.lang === 'ne' ? 'ne' : 'en',
    phone: cleanPlain(st.phone, 40), email: cleanPlain(st.email, 120), address: cleanPlain(st.address, 240),
    social: (Array.isArray(st.social) ? st.social : []).slice(0, 12)
      .map((x: any) => ({ network: NETWORKS.some(([k]) => k === x?.network) ? String(x.network) : 'website', url: safeHref(x?.url) }))
      .filter((x: SocialLink) => /^https?:/.test(x.url)),
  };
  const header = raw?.header ? cleanBlock({ ...raw.header, type: 'header' }, ids) : null;
  const footer = raw?.footer ? cleanBlock({ ...raw.footer, type: 'footer' }, ids) : null;
  const pageIds = new Set<string>();
  const slugs = new Set<string>();
  let pages: Page[] = (Array.isArray(raw?.pages) ? raw.pages : []).slice(0, MAX_PAGES).map((p: any, i: number) => {
    let id = String(p?.id ?? '');
    if (!/^[\w-]{2,40}$/.test(id) || pageIds.has(id)) id = newPageId();
    pageIds.add(id);
    const title = cleanPlain(p?.title, 60) || (i === 0 ? 'Home' : `Page ${i + 1}`);
    let slug = i === 0 ? '' : String(p?.slug ?? '');
    if (i > 0) {
      if (!slugOk(slug)) slug = toSlug(title) || `page-${i + 1}`;
      if (!slugOk(slug)) slug = `page-${i + 1}`;
      let n = 2; const b = slug;
      while (slugs.has(slug)) slug = `${b}-${n++}`;
      slugs.add(slug);
    }
    const blocks = (Array.isArray(p?.blocks) ? p.blocks : []).slice(0, MAX_BLOCKS)
      .filter((b: any) => !blockDef(String(b?.type))?.global)
      .map((b: any) => cleanBlock(b, ids)).filter(Boolean) as Block[];
    return { id, slug, title, nav: p?.nav !== false, seoTitle: cleanPlain(p?.seoTitle, 70), seoDescription: cleanPlain(p?.seoDescription, 170), blocks };
  });
  if (!pages.length) pages = [{ id: newPageId(), slug: '', title: 'Home', nav: true, seoTitle: '', seoDescription: '', blocks: [] }];
  return { v: 1, name: cleanPlain(raw?.name, 80) || 'My website', theme: cleanTheme(raw?.theme), settings, header, footer, pages };
}

/** A new block of a type, with its first variant and example text. */
export function makeBlock(type: string): Block {
  const def = blockDef(type)!;
  return { id: newBlockId(), type, variant: def.variants[0].id, props: def.defaults(), style: { bg: 'page', space: 'm', hide: '', ...def.style } };
}

/** A blank site: header, one hero, footer, one theme. */
export function blankSite(name: string, presetId = 'salt'): Site {
  return cleanSite({
    name, theme: presetById(presetId).theme,
    header: makeBlock('header'), footer: makeBlock('footer'),
    pages: [{ id: 'home', slug: '', title: 'Home', blocks: [makeBlock('hero')] }],
  });
}

/** Every uploaded file a site uses (file:<id>), for copying into a published version. */
export function filesUsed(site: Site): string[] {
  const out = new Set<string>();
  const walk = (v: any) => {
    if (!v || typeof v !== 'object') return;
    if (typeof v.src === 'string' && v.src.startsWith('file:')) out.add(v.src.slice(5));
    for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(site);
  return [...out];
}

/** Find a block anywhere in the site. */
export function findBlock(site: Site, id: string): { block: Block; page: Page | null } | null {
  if (site.header?.id === id) return { block: site.header, page: null };
  if (site.footer?.id === id) return { block: site.footer, page: null };
  for (const p of site.pages) { const b = p.blocks.find((x) => x.id === id); if (b) return { block: b, page: p }; }
  return null;
}
