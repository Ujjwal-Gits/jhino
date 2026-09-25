/*
 * The 30 designs for the links page. A design is a set of decisions, not a costume: a page colour,
 * an ink, a type pairing and one way of drawing a button. Nothing is textured or themed-up; each one
 * should look like a brand chose it. Names are places in Nepal.
 *
 * Keep `id`, `name`, `tier` first in each entry: scripts/sync-themes.mjs reads them for the server.
 */
import type { CSSProperties } from 'react';
import type { Tier } from './types';

/** How buttons are drawn. */
export type Btn = 'fill' | 'outline' | 'soft' | 'hard' | 'line';
/** Type pairings (display for the name, text for everything else). */
export type Face = 'grotesk' | 'serif' | 'didone' | 'condensed' | 'mono' | 'rounded';

export interface ThemeMeta {
  id: string;
  name: string;
  tier: Tier;
  blurb: string;
  /** The page: any CSS background (almost always one flat colour). */
  bg: string;
  fg: string;
  muted: string;
  /** Buttons. */
  card: string;
  cardFg: string;
  border: string;
  radius: number;
  btn: Btn;
  face: Face;
  /** The one accent: the ring on the photo and the highlighted link. */
  accent: string;
  /** Name in capitals (condensed and poster designs). */
  caps?: boolean;
}

export const THEMES: ThemeMeta[] = [
  // ---------- Free (5): quiet, universal ----------
  { id: 'paper', name: 'Paper', tier: 'free', blurb: 'White page, black ink, thin outlines.', bg: '#ffffff', fg: '#141414', muted: '#6b6a66', card: '#ffffff', cardFg: '#141414', border: '#141414', radius: 14, btn: 'outline', face: 'grotesk', accent: '#e0461f' },
  { id: 'ink', name: 'Ink', tier: 'free', blurb: 'Near-black page with white buttons.', bg: '#111111', fg: '#f4f3ef', muted: '#9a9893', card: '#f4f3ef', cardFg: '#111111', border: 'transparent', radius: 14, btn: 'fill', face: 'grotesk', accent: '#ff6a3d' },
  { id: 'mustang', name: 'Mustang', tier: 'free', blurb: 'Warm sand with soft cream pills.', bg: '#ece5da', fg: '#2a241e', muted: '#7a6f63', card: '#faf6ef', cardFg: '#2a241e', border: 'transparent', radius: 999, btn: 'soft', face: 'grotesk', accent: '#b4532a' },
  { id: 'himal', name: 'Himal', tier: 'free', blurb: 'Cold sky, deep navy buttons.', bg: '#e6edf3', fg: '#12263a', muted: '#5b6f82', card: '#12263a', cardFg: '#f3f7fa', border: 'transparent', radius: 12, btn: 'fill', face: 'grotesk', accent: '#12263a' },
  { id: 'ilam', name: 'Ilam', tier: 'free', blurb: 'Tea green, cream, a gentle serif.', bg: '#e3e8dc', fg: '#1f2b21', muted: '#5d6a5c', card: 'transparent', cardFg: '#1f2b21', border: '#1f2b21', radius: 999, btn: 'outline', face: 'serif', accent: '#3d6b45' },

  // ---------- Plus (10): more voice ----------
  { id: 'patan', name: 'Patan', tier: 'plus', blurb: 'Editorial cream, a serif name, black buttons.', bg: '#f6f1e7', fg: '#1d1a16', muted: '#7a7163', card: '#1d1a16', cardFg: '#f6f1e7', border: 'transparent', radius: 6, btn: 'fill', face: 'serif', accent: '#a8391b' },
  { id: 'rara', name: 'Rara', tier: 'plus', blurb: 'Lake cobalt, white buttons.', bg: '#2143c6', fg: '#ffffff', muted: '#c5d0f5', card: '#ffffff', cardFg: '#2143c6', border: 'transparent', radius: 14, btn: 'fill', face: 'grotesk', accent: '#ffffff' },
  { id: 'tihar', name: 'Tihar', tier: 'plus', blurb: 'Marigold orange, black pills.', bg: '#ff7a2f', fg: '#140c05', muted: '#5a2f12', card: '#140c05', cardFg: '#ffffff', border: 'transparent', radius: 999, btn: 'fill', face: 'grotesk', accent: '#140c05' },
  { id: 'shivapuri', name: 'Shivapuri', tier: 'plus', blurb: 'Forest green with soft, see-through cards.', bg: '#183a2c', fg: '#f1ebdb', muted: '#a9b8a4', card: 'rgba(241,235,219,0.09)', cardFg: '#f1ebdb', border: 'rgba(241,235,219,0.18)', radius: 12, btn: 'soft', face: 'serif', accent: '#d9b26a' },
  { id: 'lalitpur', name: 'Lalitpur', tier: 'plus', blurb: 'Blush pink, white pills, brick text.', bg: '#f4dcd4', fg: '#3b1c17', muted: '#8a5d53', card: '#ffffff', cardFg: '#3b1c17', border: 'transparent', radius: 999, btn: 'fill', face: 'rounded', accent: '#b53a2a' },
  { id: 'slate', name: 'Slate', tier: 'plus', blurb: 'Graphite with raised grey buttons.', bg: '#262a30', fg: '#eceef1', muted: '#9aa1ab', card: '#353b43', cardFg: '#eceef1', border: 'transparent', radius: 10, btn: 'fill', face: 'grotesk', accent: '#ff8a5b' },
  { id: 'ason', name: 'Ason', tier: 'plus', blurb: 'Market yellow, hard black shadows.', bg: '#f3df4d', fg: '#141414', muted: '#4d4617', card: '#ffffff', cardFg: '#141414', border: '#141414', radius: 10, btn: 'hard', face: 'grotesk', accent: '#141414' },
  { id: 'newsroom', name: 'Newsroom', tier: 'plus', blurb: 'White, black, sharp shadows.', bg: '#ffffff', fg: '#141414', muted: '#666666', card: '#ffffff', cardFg: '#141414', border: '#141414', radius: 4, btn: 'hard', face: 'grotesk', accent: '#e0461f' },
  { id: 'durbar', name: 'Durbar', tier: 'plus', blurb: 'Oxblood with fine outlines and a Didone.', bg: '#561b20', fg: '#f6e7dc', muted: '#c8a79b', card: 'transparent', cardFg: '#f6e7dc', border: 'rgba(246,231,220,0.55)', radius: 2, btn: 'outline', face: 'didone', accent: '#e7c38a' },
  { id: 'phewa', name: 'Phewa', tier: 'plus', blurb: 'Pale mint, deep green pills.', bg: '#d8efe3', fg: '#0f3324', muted: '#4c7563', card: '#0f3324', cardFg: '#e8f6ee', border: 'transparent', radius: 999, btn: 'fill', face: 'rounded', accent: '#0f3324' },

  // ---------- Pro (15): the finest ----------
  { id: 'noir', name: 'Noir', tier: 'pro', blurb: 'Black, brass outlines, a Didone name.', bg: '#0c0c0c', fg: '#f1eadb', muted: '#8f8778', card: 'transparent', cardFg: '#f1eadb', border: '#b89a62', radius: 0, btn: 'outline', face: 'didone', accent: '#c9a96b' },
  { id: 'gallery', name: 'Gallery', tier: 'pro', blurb: 'Wall-label list: ruled rows, no boxes.', bg: '#fbfaf7', fg: '#161513', muted: '#77746d', card: 'transparent', cardFg: '#161513', border: '#161513', radius: 0, btn: 'line', face: 'serif', accent: '#161513' },
  { id: 'kathmandu-night', name: 'Kathmandu Night', tier: 'pro', blurb: 'Deep navy with soft panels.', bg: '#0f1b2d', fg: '#e8eef8', muted: '#8fa0b8', card: 'rgba(232,238,248,0.07)', cardFg: '#e8eef8', border: 'rgba(232,238,248,0.14)', radius: 16, btn: 'soft', face: 'grotesk', accent: '#7fb0ff' },
  { id: 'bhaktapur', name: 'Bhaktapur', tier: 'pro', blurb: 'Brick terracotta and cream pills.', bg: '#b85a3c', fg: '#fff5ec', muted: '#f3c9b3', card: '#fff5ec', cardFg: '#7a2f18', border: 'transparent', radius: 999, btn: 'fill', face: 'serif', accent: '#fff5ec' },
  { id: 'stone', name: 'Stone', tier: 'pro', blurb: 'Warm grey, square cards, condensed caps.', bg: '#d9d5cf', fg: '#22201d', muted: '#6d6860', card: '#f4f2ee', cardFg: '#22201d', border: 'transparent', radius: 3, btn: 'fill', face: 'condensed', accent: '#22201d', caps: true },
  { id: 'volt', name: 'Volt', tier: 'pro', blurb: 'Black with electric lime buttons.', bg: '#0b0b0b', fg: '#f4f4f0', muted: '#8d8d88', card: '#d6ff3b', cardFg: '#0b0b0b', border: 'transparent', radius: 8, btn: 'fill', face: 'condensed', accent: '#d6ff3b', caps: true },
  { id: 'poster', name: 'Poster', tier: 'pro', blurb: 'A big condensed name, black blocks.', bg: '#ebe5d8', fg: '#141414', muted: '#6b665b', card: '#141414', cardFg: '#ebe5d8', border: 'transparent', radius: 0, btn: 'fill', face: 'condensed', accent: '#d8401d', caps: true },
  { id: 'pokhara', name: 'Pokhara', tier: 'pro', blurb: 'Lake teal and bright cream buttons.', bg: '#0f4e5a', fg: '#eaf6f3', muted: '#9cc6c1', card: '#eaf6f3', cardFg: '#0f4e5a', border: 'transparent', radius: 14, btn: 'fill', face: 'grotesk', accent: '#f2c36b' },
  { id: 'porcelain', name: 'Porcelain', tier: 'pro', blurb: 'Clean white cards on cool grey.', bg: '#eef1f3', fg: '#18242c', muted: '#6a7880', card: '#ffffff', cardFg: '#18242c', border: '#dbe2e6', radius: 16, btn: 'soft', face: 'grotesk', accent: '#18242c' },
  { id: 'terai', name: 'Terai', tier: 'pro', blurb: 'Rust type on wheat, serif and warm.', bg: '#f2e3cf', fg: '#6d2c14', muted: '#a06a4d', card: '#6d2c14', cardFg: '#f7ecdd', border: 'transparent', radius: 8, btn: 'fill', face: 'serif', accent: '#6d2c14' },
  { id: 'vermilion', name: 'Vermilion', tier: 'pro', blurb: 'Sindoor red, white pills.', bg: '#e0461f', fg: '#ffffff', muted: '#ffd2c4', card: '#ffffff', cardFg: '#b3300f', border: 'transparent', radius: 999, btn: 'fill', face: 'grotesk', accent: '#ffffff' },
  { id: 'apricot', name: 'Apricot', tier: 'pro', blurb: 'A soft dusk from apricot to peach.', bg: 'linear-gradient(180deg, #f6ddb6 0%, #eca47e 100%)', fg: '#2d1a10', muted: '#6d4630', card: '#fffaf3', cardFg: '#2d1a10', border: 'transparent', radius: 16, btn: 'fill', face: 'serif', accent: '#2d1a10' },
  { id: 'typewriter', name: 'Typewriter', tier: 'pro', blurb: 'Mono type on off-white, square outlines.', bg: '#f2eee5', fg: '#1b1a17', muted: '#6d6a61', card: 'transparent', cardFg: '#1b1a17', border: '#1b1a17', radius: 0, btn: 'outline', face: 'mono', accent: '#1b1a17' },
  { id: 'cinema', name: 'Cinema', tier: 'pro', blurb: 'Screening-room black with raised cards.', bg: '#101010', fg: '#f2f2ef', muted: '#8b8b86', card: '#1d1d1c', cardFg: '#f2f2ef', border: '#2c2c2a', radius: 12, btn: 'soft', face: 'grotesk', accent: '#e0461f' },
  { id: 'everest', name: 'Everest', tier: 'pro', blurb: 'Snow white, ice blue, fine lines.', bg: '#f7fafc', fg: '#0f2233', muted: '#6b7f90', card: 'transparent', cardFg: '#0f2233', border: '#9fb6c8', radius: 12, btn: 'outline', face: 'rounded', accent: '#2f78b7' },
];

export const tierRank: Record<Tier, number> = { free: 0, plus: 1, pro: 2 };
export const canUseTheme = (themeTier: Tier, userTier: Tier) => tierRank[themeTier] <= tierRank[userTier];
export const themeById = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

const FACES: Record<Face, { display: string; text: string }> = {
  grotesk: { display: "'Bricolage Grotesque Variable', 'Schibsted Grotesk Variable', sans-serif", text: "'Schibsted Grotesk Variable', 'Noto Sans Devanagari Variable', sans-serif" },
  serif: { display: "'Fraunces Variable', Georgia, serif", text: "'Schibsted Grotesk Variable', 'Noto Sans Devanagari Variable', sans-serif" },
  didone: { display: "'Bodoni Moda Variable', Didot, serif", text: "'Newsreader Variable', Georgia, serif" },
  condensed: { display: "'Archivo Variable', 'Schibsted Grotesk Variable', sans-serif", text: "'Schibsted Grotesk Variable', 'Noto Sans Devanagari Variable', sans-serif" },
  mono: { display: "'JetBrains Mono Variable', ui-monospace, monospace", text: "'JetBrains Mono Variable', ui-monospace, monospace" },
  rounded: { display: "'Bricolage Grotesque Variable', sans-serif", text: "'Bricolage Grotesque Variable', 'Noto Sans Devanagari Variable', sans-serif" },
};

/** The CSS variables a design sets on the page root. */
export function themeVars(t: ThemeMeta): CSSProperties {
  const f = FACES[t.face];
  return {
    '--lk-bg': t.bg, '--lk-fg': t.fg, '--lk-muted': t.muted, '--lk-card': t.card, '--lk-card-fg': t.cardFg,
    '--lk-border': t.border, '--lk-radius': `${t.radius}px`, '--lk-accent': t.accent,
    '--lk-display': f.display, '--lk-text': f.text,
  } as CSSProperties;
}
