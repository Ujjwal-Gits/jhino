/*
 * The 30 designs a person can pick for their public page. The look lives in themes.css under
 * `.pf[data-theme="<id>"]`; this file is the catalogue (names, tiers, picker swatches).
 */
import type { Tier } from './types';

export interface ThemeMeta {
  id: string;
  name: string;
  tier: Tier;
  blurb: string;
  swatch: { bg: string; fg: string; accent: string };
}

export const THEMES: ThemeMeta[] = [
  // ---- Free (5)
  { id: 'paper', name: 'Paper', tier: 'free', blurb: 'White stock, black ink, one vermilion mark.', swatch: { bg: '#fbfaf8', fg: '#151412', accent: '#e0461f' } },
  { id: 'night', name: 'Night', tier: 'free', blurb: 'Near-black page, solid bone buttons.', swatch: { bg: '#101211', fg: '#ece8df', accent: '#ff6a3d' } },
  { id: 'newsprint', name: 'Newsprint', tier: 'free', blurb: 'A broadsheet masthead and boxed classifieds.', swatch: { bg: '#edebe3', fg: '#1b1a17', accent: '#1b1a17' } },
  { id: 'clay', name: 'Soft Clay', tier: 'free', blurb: 'Terracotta pills on unglazed cream.', swatch: { bg: '#efe3d5', fg: '#3a2219', accent: '#b4492f' } },
  { id: 'marigold', name: 'Marigold', tier: 'free', blurb: 'Tihar orange with heavy black type.', swatch: { bg: '#f3a21a', fg: '#1c1206', accent: '#1c1206' } },

  // ---- Plus (10)
  { id: 'letterpress', name: 'Letterpress', tier: 'plus', blurb: 'Cotton paper, pressed ink, small caps.', swatch: { bg: '#f3eee3', fg: '#22252b', accent: '#b8322a' } },
  { id: 'swiss', name: 'Swiss Grid', tier: 'plus', blurb: 'Flush left, numbered, one red.', swatch: { bg: '#ffffff', fg: '#111111', accent: '#e2231a' } },
  { id: 'darkroom', name: 'Darkroom', tier: 'plus', blurb: 'Safelight red over film-strip frames.', swatch: { bg: '#140c0b', fg: '#f0d9d2', accent: '#e0321c' } },
  { id: 'blueprint', name: 'Blueprint', tier: 'plus', blurb: 'Drafting grid, title block, dashed parts.', swatch: { bg: '#1d4f91', fg: '#eaf2ff', accent: '#ffffff' } },
  { id: 'linen', name: 'Linen', tier: 'plus', blurb: 'Woven oatmeal cloth and stitched labels.', swatch: { bg: '#e8e1d2', fg: '#3b3a33', accent: '#56643f' } },
  { id: 'terminal', name: 'Terminal', tier: 'plus', blurb: 'Amber phosphor on a warm black shell.', swatch: { bg: '#12110e', fg: '#e8e0c8', accent: '#f2a93b' } },
  { id: 'risograph', name: 'Risograph', tier: 'plus', blurb: 'Two-ink print: fluoro pink and blue.', swatch: { bg: '#f5f0e6', fg: '#0078bf', accent: '#ff48b0' } },
  { id: 'gallery', name: 'Gallery White', tier: 'plus', blurb: 'Wall labels with room to breathe.', swatch: { bg: '#ffffff', fg: '#111111', accent: '#9a9a96' } },
  { id: 'monsoon', name: 'Monsoon', tier: 'plus', blurb: 'Slate rain and pale jade.', swatch: { bg: '#22303a', fg: '#dfe8ea', accent: '#9fd3c7' } },
  { id: 'tea-estate', name: 'Tea Estate', tier: 'plus', blurb: 'Ilam greens, contour lines, brass.', swatch: { bg: '#1d3a2a', fg: '#efe9d6', accent: '#d4ae5a' } },

  // ---- Pro (15)
  { id: 'kathmandu-morning', name: 'Kathmandu Morning', tier: 'pro', blurb: 'Dhaka weave bands on warm cream.', swatch: { bg: '#f6efe2', fg: '#1a1512', accent: '#a3271c' } },
  { id: 'himalaya', name: 'Himalaya', tier: 'pro', blurb: 'Snow ridges, slate, rhododendron red.', swatch: { bg: '#f2f4f6', fg: '#1f2a35', accent: '#c2402b' } },
  { id: 'film-slate', name: 'Film Slate', tier: 'pro', blurb: 'Clapper stripes and chalk on black.', swatch: { bg: '#161616', fg: '#f2f2ee', accent: '#f2f2ee' } },
  { id: 'studio-black', name: 'Studio Black', tier: 'pro', blurb: 'Bodoni, roman numerals, quiet brass.', swatch: { bg: '#0a0a0a', fg: '#f4f1ea', accent: '#c8b48a' } },
  { id: 'paper-cut', name: 'Paper Cut', tier: 'pro', blurb: 'Layered card stock, hand placed.', swatch: { bg: '#f2dcc8', fg: '#2d2a26', accent: '#d2694c' } },
  { id: 'brutalist', name: 'Brutalist', tier: 'pro', blurb: 'Raw concrete, hard shadows, no manners.', swatch: { bg: '#d7d6d0', fg: '#000000', accent: '#ff3d00' } },
  { id: 'neon-night', name: 'Neon Night', tier: 'pro', blurb: 'One pink tube on a brick wall.', swatch: { bg: '#0c0d10', fg: '#ffd9e1', accent: '#ff3864' } },
  { id: 'index-cards', name: 'Index Cards', tier: 'pro', blurb: 'Typed catalogue cards on a green desk.', swatch: { bg: '#3d5044', fg: '#fbf8f0', accent: '#c7372f' } },
  { id: 'ticket-stub', name: 'Ticket Stub', tier: 'pro', blurb: 'Admit-one stubs on cinema red.', swatch: { bg: '#6e1a17', fg: '#f3e6c8', accent: '#f3e6c8' } },
  { id: 'quarterly', name: 'Quarterly', tier: 'pro', blurb: 'A magazine contents page, dot leaders.', swatch: { bg: '#f7f3ea', fg: '#1a1a1a', accent: '#c23b22' } },
  { id: 'receipt', name: 'Receipt', tier: 'pro', blurb: 'Thermal paper, line items, a barcode.', swatch: { bg: '#d4d1ca', fg: '#1d1d1b', accent: '#1d1d1b' } },
  { id: 'bauhaus', name: 'Bauhaus', tier: 'pro', blurb: 'Circle, square, triangle, three primaries.', swatch: { bg: '#f1ebdd', fg: '#151515', accent: '#d63a27' } },
  { id: 'velvet', name: 'Velvet', tier: 'pro', blurb: 'Oxblood pile and soft italic serif.', swatch: { bg: '#3a0e18', fg: '#f5e6d8', accent: '#e8b4a0' } },
  { id: 'prayer-flags', name: 'Prayer Flags', tier: 'pro', blurb: 'Five colours strung across the sky.', swatch: { bg: '#fbf9f4', fg: '#1d2430', accent: '#2d5fa8' } },
  { id: 'cyanotype', name: 'Cyanotype', tier: 'pro', blurb: 'Sunprint blue with a pressed fern.', swatch: { bg: '#1c3f7a', fg: '#eef2f8', accent: '#eef2f8' } },

  // ---- Pro Nepali Heritage (10 new)
  { id: 'bhaktapur-terracotta', name: 'Bhaktapur Terracotta', tier: 'pro', blurb: 'Nyatapola pagoda roof, baked clay Dachi Appa bricks, temple bells.', swatch: { bg: '#2d100b', fg: '#fbf3ec', accent: '#d85d38' } },
  { id: 'patan-patina', name: 'Patan Patina', tier: 'pro', blurb: 'Gilded repoussé torana arch, oxidized verdigris on cast bronze.', swatch: { bg: '#0d1715', fg: '#eef6f3', accent: '#1cbda4' } },
  { id: 'pokhara-phewa', name: 'Pokhara Lakeside', tier: 'pro', blurb: 'Machhapuchhre reflection on dawn waters, painted paddle boat trim.', swatch: { bg: '#071526', fg: '#f2f7fc', accent: '#4fa8e0' } },
  { id: 'mustang-ochre', name: 'Mustang Ochre', tier: 'pro', blurb: 'Lo Manthang sky caves, sacred 3 mineral stripe chorten, chiseled stone.', swatch: { bg: '#26160c', fg: '#f8f2e7', accent: '#9e3518' } },
  { id: 'dhaka-topi', name: 'Palpali Dhaka', tier: 'pro', blurb: 'Authentic handloom geometric diamond weave tapestry, stitched edges.', swatch: { bg: '#0e121a', fg: '#f5f6fa', accent: '#cf2237' } },
  { id: 'mithila-art', name: 'Mithila Folk', tier: 'pro', blurb: 'Janakpur ritual murals, double-line contour ink, peacocks and sacred fish.', swatch: { bg: '#faf4e8', fg: '#181614', accent: '#d93826' } },
  { id: 'yak-wool', name: 'Khumbu Tweed', tier: 'pro', blurb: 'Sherpa Pangden rainbow apron band, heavy yak wool brushed twill.', swatch: { bg: '#16181b', fg: '#f2ece2', accent: '#cf3225' } },
  { id: 'bodhi-stupa', name: 'Boudha Harmika', tier: 'pro', blurb: 'Golden stupa harmika with all-seeing Buddha wisdom eyes and Ekata nose.', swatch: { bg: '#20080d', fg: '#fcf7eb', accent: '#f2c03f' } },
  { id: 'tihar-deusi', name: 'Tihar Diyo', tier: 'pro', blurb: 'Draped Sayapatri marigold garlands, burning terracotta clay oil lamps.', swatch: { bg: '#080914', fg: '#fff8eb', accent: '#ff8800' } },
  { id: 'rara-azure', name: 'Rara Alpine', tier: 'pro', blurb: 'Himalayan blue pines overlooking pristine high-altitude sapphire waters.', swatch: { bg: '#04101e', fg: '#f0f7fe', accent: '#38bdf8' } },
];

export const tierRank: Record<Tier, number> = { free: 0, plus: 1, pro: 2 };

const byId = new Map(THEMES.map((t) => [t.id, t]));

/** The theme with this id, or the default ('paper') when it is unknown. */
export function themeById(id: string | null | undefined): ThemeMeta {
  return (id && byId.get(id)) || THEMES[0];
}

/** Whether a person on `userTier` may use a theme of `themeTier`. */
export function canUseTheme(themeTier: Tier, userTier: Tier): boolean {
  return tierRank[userTier] >= tierRank[themeTier];
}
