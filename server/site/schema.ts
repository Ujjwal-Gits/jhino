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
  display: { weight: number; tracking: string; lead: number };
  fallback: string;
}
export const FONTS: FontDef[] = [
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
}
export const COLOR_KEYS: (keyof ThemeColors)[] = ['bg', 'surface', 'text', 'muted', 'accent', 'onAccent', 'line'];
export const COLOR_LABELS: Record<keyof ThemeColors, string> = { bg: 'Page', surface: 'Panels', text: 'Text', muted: 'Quiet text', accent: 'Accent', onAccent: 'Text on accent', line: 'Lines' };

export interface Preset { id: string; name: string; note: string; theme: Theme }
const preset = (id: string, name: string, note: string, display: string, body: string, c: [string, string, string, string, string, string, string], radius: number, button: ButtonStyle, rhythm: Rhythm, space = 1, caps = false): Preset =>
  ({ id, name, note, theme: { preset: id, display, body, colors: { bg: c[0], surface: c[1], text: c[2], muted: c[3], accent: c[4], onAccent: c[5], line: c[6] }, radius, space, button, rhythm, caps } });
export const PRESETS: Preset[] = [
  preset('chiya', 'Chiya house', 'Cream paper, a soft serif and terracotta. Cafés, bakeries, homestays.', 'youngserif', 'hanken',
    ['#f4efe6', '#ebe2d2', '#2a211b', '#6b5d51', '#b5462a', '#fff8f1', '#d8ccb8'], 4, 'solid', 'airy'),
  preset('darkroom', 'Darkroom', 'Near-black, bone white and a didone. Photographers, film, fashion.', 'bodoni', 'archivo',
    ['#121110', '#1c1b19', '#efebe3', '#a19b90', '#d9c9a8', '#121110', '#34322e'], 0, 'outline', 'airy'),
  preset('clinic', 'Clear clinic', 'White, pine green, one grotesque. Clinics, pharmacies, labs.', 'hanken', 'hanken',
    ['#ffffff', '#eef4f1', '#10231d', '#4d625a', '#0f6b54', '#ffffff', '#d6e2dc'], 8, 'solid', 'even'),
  preset('newsprint', 'Newsprint', 'Off-white and ink with a red rule. Writers, NGOs, publications.', 'newsreader', 'newsreader',
    ['#fbfaf6', '#f1eee6', '#171614', '#5e5a52', '#c1272d', '#ffffff', '#dcd7cc'], 0, 'underline', 'tight'),
  preset('workshop', 'Workshop', 'Concrete grey, signal yellow, condensed capitals. Gyms, garages, builders.', 'bigshoulders', 'archivo',
    ['#e8e6e1', '#dcd9d2', '#151515', '#55534e', '#f0b400', '#151515', '#c3c0b8'], 0, 'solid', 'tight', 0.95, true),
  preset('rhododendron', 'Rhododendron', 'Blush white and laligurans red. Salons, boutiques, events.', 'dmserif', 'schibsted',
    ['#fff8f5', '#f7e7e1', '#2b1014', '#6d4b50', '#a3161f', '#fff8f5', '#ecd3cb'], 16, 'pill', 'even'),
  preset('teagarden', 'Tea garden', 'Pale leaf, deep green and round corners. Farms, tea, wellness.', 'fraunces', 'schibsted',
    ['#f2f4ec', '#e3e9d8', '#1c2a1e', '#566257', '#3d6a38', '#f6f8f1', '#cfd8c2'], 22, 'pill', 'airy', 1.08),
  preset('ledger', 'Ledger', 'Typewriter headings over a book serif. Consultants, architects, lawyers.', 'plexmono', 'newsreader',
    ['#f6f4ee', '#ece8dd', '#1b1b1a', '#5b5a55', '#2e5b4f', '#f6f4ee', '#d4d0c4'], 2, 'outline', 'even'),
  preset('marigold', 'Marigold night', 'Warm dark brown with marigold. Bars, music venues, late kitchens.', 'gloock', 'bricolage',
    ['#1b1412', '#261d1a', '#f4e8d8', '#b5a390', '#e9a23b', '#1b1412', '#3d302b'], 6, 'solid', 'even'),
  preset('gallery', 'Gallery white', 'White space and heavy black type, nothing else. Studios, artists, agencies.', 'archivo', 'archivo',
    ['#ffffff', '#f3f3f1', '#0b0b0b', '#5f5f5b', '#0b0b0b', '#ffffff', '#e2e2de'], 0, 'underline', 'airy', 1.1),
];
export const presetById = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

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
export type FieldType = 'text' | 'para' | 'rich' | 'plain' | 'url' | 'image' | 'link' | 'bool' | 'select' | 'list';
export interface Field {
  key: string; label: string; type: FieldType;
  /** Longest text allowed (characters). */
  max?: number;
  options?: { value: string; label: string }[];
  /** For lists: the fields of each item, the most items, and what one item is called. */
  of?: Field[]; maxItems?: number; item?: string;
  hint?: string;
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
}
const v = (...pairs: [string, string][]) => pairs.map(([id, name]) => ({ id, name }));
const lib = (name: string, alt: string): ImageRef => ({ src: `lib:${name}`, alt });
const noImage = (): ImageRef => ({ src: '', alt: '' });

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
    variants: v(['split', 'Text beside a photo'], ['image', 'Full photo, text on top'], ['text', 'Large type only'], ['video', 'Video in the background']),
    fields: [text('eyebrow', 'Small line above', 80), text('title', 'Headline', 160), para('text', 'Text', 500), link('primary', 'Main button'), link('secondary', 'Second button'), image('image', 'Photo'), url('video', 'Background video', 'A direct link to an .mp4 file. The photo shows while it loads and on slow connections.')],
    defaults: () => ({ eyebrow: '', title: 'Say what you do and where, in one line', text: 'Add a sentence or two about who you help and why people come back. Click any text on the page to change it.', primary: { label: 'Get in touch', href: '' }, secondary: { label: '', href: '' }, image: noImage(), video: '' }),
  },
  {
    type: 'footer', name: 'Footer', category: 'structure', global: 'footer', keywords: 'bottom copyright contact',
    description: 'Your name, pages, contact details and social links, on every page.',
    variants: v(['columns', 'Columns'], ['simple', 'One quiet line'], ['big', 'Large name']),
    fields: [para('about', 'About line', 300), text('note', 'Small print', 160), bool('showPages', 'List the pages'), bool('showContact', 'Show phone, email and address'), bool('showSocial', 'Show social links')],
    defaults: () => ({ about: '', note: '', showPages: true, showContact: true, showSocial: true }),
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
    description: 'Several photos as a grid, a masonry wall or a carousel.',
    variants: v(['grid', 'Even grid'], ['masonry', 'Masonry'], ['carousel', 'Carousel']),
    fields: [text('heading', 'Heading'), para('intro', 'Intro', 400), list('images', 'Photos', 'photo', [image('image', 'Photo'), text('caption', 'Caption', 160)], 48)],
    defaults: () => ({ heading: 'Gallery', intro: '', images: [{ image: noImage(), caption: '' }, { image: noImage(), caption: '' }, { image: noImage(), caption: '' }] }),
  },
  {
    type: 'video', name: 'Video', category: 'media', keywords: 'youtube vimeo film embed',
    description: 'A YouTube or Vimeo video. It loads only when someone presses play, so the page stays fast.',
    variants: v(['wide', 'Wide'], ['contained', 'Narrow'], ['split', 'Text beside it']),
    fields: [url('url', 'YouTube or Vimeo link'), text('heading', 'Heading'), para('text', 'Text', 600), text('caption', 'Caption', 200)],
    defaults: () => ({ url: '', heading: '', text: '', caption: '' }),
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
    variants: v(['columns', 'Two columns'], ['list', 'One long list'], ['compact', 'Compact board']),
    fields: [text('heading', 'Heading'), para('intro', 'Note', 400), select('currency', 'Currency', CURRENCIES),
      list('sections', 'Sections', 'section', [text('title', 'Section', 80), para('note', 'Section note', 200),
        list('items', 'Dishes and drinks', 'item', [text('name', 'Name', 90), para('desc', 'Description', 240), plain('price', 'Price', 20), plain('tag', 'Tag', 20, 'Like Veg, New or Spicy.')], 60)], 16)],
    defaults: () => ({ heading: 'Menu', intro: '', currency: 'NPR', sections: [{ title: 'Section', note: '', items: [{ name: 'Dish name', desc: 'What is in it.', price: '', tag: '' }] }] }),
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
    variants: v(['band', 'Full-width band'], ['split', 'Text left, buttons right'], ['boxed', 'Boxed']),
    fields: [text('title', 'Heading', 140), para('text', 'Text', 400), link('primary', 'Main button'), link('secondary', 'Second button')],
    defaults: () => ({ title: 'Ready when you are', text: '', primary: { label: 'Get in touch', href: '' }, secondary: { label: '', href: '' } }),
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
    variants: v(['embed', 'Map, full width'], ['split', 'Address beside the map'], ['card', 'Address card only']),
    fields: [text('heading', 'Heading'), para('address', 'Address', 300, 'Empty: the address from Site settings.'), plain('query', 'Place to show', 200, 'A place name or address as you would type it into Google Maps.'), url('link', 'Google Maps link', 'The share link from Google Maps, for directions.')],
    defaults: () => ({ heading: 'Find us', address: '', query: '', link: '' }),
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
/** name → widths available (files are <name>-<width>.webp). */
export const LIBRARY: Record<string, { widths: number[]; alt: string }> = {
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
  'doctor-coat': { widths: [640, 1400], alt: 'A doctor in a white coat with a stethoscope' },
  'pill-bottle': { widths: [640, 1400], alt: 'A bottle of tablets on a white surface' },
  boudha: { widths: [640, 1400], alt: 'Boudhanath stupa from above, surrounded by the city' },
  swayambhu: { widths: [640, 1400], alt: 'Swayambhu stupa with prayer flags' },
  'himal-trek': { widths: [640, 1400], alt: 'A trekker looking at snow peaks' },
  'night-peaks': { widths: [640, 1400], alt: 'Snow peaks under a starry sky' },
  'cut-pour-over': { widths: [1400], alt: 'Coffee being poured over a filter' },
  'shoot-beans': { widths: [1400], alt: 'Roasted coffee beans' },
  'shoot-cheers': { widths: [1400], alt: 'Two coffee cups raised together' },
  'shoot-iced': { widths: [1400], alt: 'An iced coffee in a glass' },
  'shoot-lattes': { widths: [1400], alt: 'Two lattes with milk art' },
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

export function cleanImage(raw: any): ImageRef {
  const src0 = String(raw?.src ?? '').trim();
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

export function cleanTheme(raw: any): Theme {
  const base = presetById(String(raw?.preset ?? '')).theme;
  const c = raw?.colors ?? {};
  const colors = { ...base.colors };
  for (const k of COLOR_KEYS) if (typeof c[k] === 'string' && HEX.test(c[k])) colors[k] = c[k].toLowerCase();
  const num = (n: unknown, lo: number, hi: number, d: number) => (typeof n === 'number' && isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);
  return {
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
  return { id: newBlockId(), type, variant: def.variants[0].id, props: def.defaults(), style: { bg: 'page', space: 'm', hide: '' } };
}

/** A blank site: header, one hero, footer, one theme. */
export function blankSite(name: string, presetId = 'gallery'): Site {
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
