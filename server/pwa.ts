import zlib from 'node:zlib';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db, roleOf, type AppRow } from './db.js';
import { HttpError } from './errors.js';
import { limit } from './security.js';

/*
 * Installing an app on a phone or computer ("Add to Home Screen", "Install app").
 * Every app address serves its own web app manifest: its name, its own icon (drawn here: the first
 * letter of its name on its colour), and the address it opens at. A tiny service worker lets the
 * installed app open with a proper page when there is no connection. Nothing here caches app data:
 * an installed app is the same live page as the address.
 */

/* ---------------- which app an address is ---------------- */
interface Found { app: AppRow; path: string }
/** An app page's address: /<username>/<name>, /<top-level name>, /s/<token> or /apps/<id>. */
function appAt(rawPath: string): Found | null {
  const p = String(rawPath ?? '').split(/[?#]/)[0].replace(/\/+$/, '');
  const seg = p.split('/').filter(Boolean);
  const one = (sql: string, ...args: string[]) => db.prepare(sql).get(...args) as AppRow | undefined;
  let a: AppRow | undefined;
  if (seg.length === 2 && seg[0] === 'apps' && /^[\w-]{1,64}$/.test(seg[1])) a = one('SELECT * FROM apps WHERE id=? AND deleted_at IS NULL', seg[1]);
  else if (seg.length === 2 && seg[0] === 's' && /^[\w-]{2,64}$/.test(seg[1])) a = one('SELECT * FROM apps WHERE share_token=? AND deleted_at IS NULL', seg[1]);
  else if (seg.length === 2 && /^[\w-]{2,64}$/.test(seg[0]) && /^[\w-]{2,64}$/.test(seg[1])) {
    a = one(`SELECT a.* FROM apps a JOIN users u ON u.id=a.owner_id WHERE u.username=? COLLATE NOCASE AND a.slug=? COLLATE NOCASE AND a.deleted_at IS NULL`, seg[0], seg[1]);
  } else if (seg.length === 1 && /^[\w-]{1,64}$/.test(seg[0])) a = one('SELECT * FROM apps WHERE root_slug=? COLLATE NOCASE AND deleted_at IS NULL', seg[0]);
  return a ? { app: a, path: '/' + seg.join('/') } : null;
}
/** Anyone may install an app that opens by link; a private one only its members. */
function mayInstall(req: FastifyRequest, a: AppRow) {
  if (a.access === 'public' || a.access === 'password') return true;
  return !!req.user && !req.pub && req.user.kind !== 'visitor' && !!roleOf(a.id, req.user.id);
}

/* ---------------- how it looks on the home screen ---------------- */
const INK = '141414';
function brandOf(a: AppRow): { color: string; label: string } {
  let accent: string | undefined; let client = '';
  const v = db.prepare('SELECT builder FROM app_versions WHERE app_id=? AND n=?').get(a.id, a.live_version) as { builder: string | null } | undefined;
  if (v?.builder) {
    try { const c = JSON.parse(v.builder) as { client?: string; design?: { accent?: string } }; accent = c.design?.accent; client = c.client ?? ''; } catch { /* an old build */ }
  }
  const color = accent && /^#[0-9a-f]{6}$/i.test(accent) ? accent.slice(1).toLowerCase() : INK;
  return { color, label: client || a.name };
}
/** The letter drawn on the icon: the first letter or digit of the name, or four tiles when there is none. */
const letterOf = (s: string) => (/[A-Za-z0-9]/.exec(s)?.[0] ?? '*').toUpperCase();
const iconUrl = (color: string, letter: string, size: number, maskable = false) => `/_jhino/icon/${color}-${letter === '*' ? 'x' : letter}-${size}${maskable ? '-m' : ''}.png`;
/** A short label for under the icon (home screens cut long names). */
function shortName(label: string) {
  const first = label.split(' · ')[0].trim();
  if (first.length <= 15) return first;
  const cut = first.slice(0, 15);
  return (cut.includes(' ') ? cut.slice(0, cut.lastIndexOf(' ')) : cut).trim();
}

export function installInfo(a: AppRow, path: string) {
  const { color, label } = brandOf(a);
  const letter = letterOf(label);
  return {
    name: a.name, shortName: shortName(label), path, color: `#${color}`,
    icon: iconUrl(color, letter, 192), appleIcon: iconUrl(color, letter, 180, true),
    manifest: {
      id: path, name: a.name, short_name: shortName(label), description: `${a.name}, on Jhino.`,
      start_url: path, scope: path, display: 'standalone', orientation: 'any',
      background_color: '#ffffff', theme_color: `#${color}`, lang: 'en', dir: 'auto',
      icons: [
        { src: iconUrl(color, letter, 192), sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: iconUrl(color, letter, 512), sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: iconUrl(color, letter, 512, true), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
  };
}

/* ---------------- drawing the icon ---------------- */
type Pt = [number, number];
/** Points along an ellipse arc; angles in degrees, 0 = right, 90 = down (screen coordinates). */
function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number): Pt[] {
  const n = Math.max(6, Math.ceil(Math.abs(to - from) / 10));
  return Array.from({ length: n + 1 }, (_, i) => { const t = ((from + ((to - from) * i) / n) * Math.PI) / 180; return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as Pt; });
}
/** Points along cubic Bézier curves: a start point, then [c1, c2, end] triples. */
function curve(start: Pt, ...segs: [Pt, Pt, Pt][]): Pt[] {
  const out: Pt[] = [start]; let p0 = start;
  for (const [c1, c2, p3] of segs) {
    for (let i = 1; i <= 14; i++) {
      const t = i / 14, u = 1 - t;
      out.push([u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]]);
    }
    p0 = p3;
  }
  return out;
}
/** A monoline alphabet drawn on a 10-unit cap height (y grows downwards). Each glyph is a list of strokes. */
const GLYPHS: Record<string, Pt[][]> = {
  A: [[[0, 10], [3.6, 0], [7.2, 10]], [[1.35, 6.3], [5.85, 6.3]]],
  B: [[[0, 10], [0, 0], [3.4, 0], ...arc(3.4, 2.5, 2.6, 2.5, -90, 90), [0, 5]], [[0, 5], [3.8, 5], ...arc(3.8, 7.5, 2.8, 2.5, -90, 90), [0, 10]]],
  C: [arc(5, 5, 5, 5, -40, -320)],
  D: [[[0, 0], [2.6, 0], ...arc(2.6, 5, 4.6, 5, -90, 90), [0, 10], [0, 0]]],
  E: [[[6, 0], [0, 0], [0, 10], [6, 10]], [[0, 5], [5, 5]]],
  F: [[[6, 0], [0, 0], [0, 10]], [[0, 5], [5, 5]]],
  G: [[...arc(5, 5, 5, 5, -40, -360), [5.4, 5]]],
  H: [[[0, 0], [0, 10]], [[7, 0], [7, 10]], [[0, 5], [7, 5]]],
  I: [[[0, 0], [0, 10]]],
  J: [[[5, 0], [5, 7.3], ...arc(2.5, 7.3, 2.5, 2.7, 0, 180)]],
  K: [[[0, 0], [0, 10]], [[6.6, 0], [0, 6.2]], [[2.3, 4], [7, 10]]],
  L: [[[0, 0], [0, 10], [6, 10]]],
  M: [[[0, 10], [0, 0], [4.5, 7], [9, 0], [9, 10]]],
  N: [[[0, 10], [0, 0], [7, 10], [7, 0]]],
  O: [arc(5, 5, 5, 5, 0, 360)],
  P: [[[0, 10], [0, 0], [3.4, 0], ...arc(3.4, 2.8, 2.9, 2.8, -90, 90), [0, 5.6]]],
  Q: [arc(5, 5, 5, 5, 0, 360), [[6.4, 6.4], [10, 10]]],
  R: [[[0, 10], [0, 0], [3.4, 0], ...arc(3.4, 2.8, 2.9, 2.8, -90, 90), [0, 5.6]], [[3.2, 5.6], [6.8, 10]]],
  S: [curve([6.5, 1.6], [[5.6, 0.1], [0.9, -0.1], [0.8, 2.7]], [[0.6, 5.2], [6.8, 4.6], [6.9, 7.3]], [[7, 10.2], [1.4, 10.4], [0.2, 8.4]])],
  T: [[[0, 0], [7, 0]], [[3.5, 0], [3.5, 10]]],
  U: [[[0, 0], [0, 6.5], ...arc(3.5, 6.5, 3.5, 3.5, 180, 0), [7, 0]]],
  V: [[[0, 0], [3.6, 10], [7.2, 0]]],
  W: [[[0, 0], [2.5, 10], [5, 2.4], [7.5, 10], [10, 0]]],
  X: [[[0, 0], [7, 10]], [[7, 0], [0, 10]]],
  Y: [[[0, 0], [3.5, 5.2], [7, 0]], [[3.5, 5.2], [3.5, 10]]],
  Z: [[[0.2, 0], [7, 0], [0, 10], [7, 10]]],
  0: [arc(3.5, 5, 3.5, 5, 0, 360)],
  1: [[[0.6, 2], [3.2, 0], [3.2, 10]]],
  2: [[...curve([0.4, 2.6], [[0.6, -0.6], [6.6, -0.6], [6.6, 2.8]], [[6.6, 5], [3, 6.8], [0, 10]]), [7, 10]]],
  3: [curve([0.4, 1.2], [[2.5, -0.6], [6.6, 0.2], [6.2, 2.8]], [[5.9, 4.8], [3.5, 4.9], [2.6, 4.9]], [[4.6, 4.9], [6.9, 5.6], [6.8, 7.6]], [[6.6, 10.6], [1.8, 10.6], [0.2, 8.8]])],
  4: [[[5.2, 10], [5.2, 0], [0, 7], [7, 7]]],
  5: [[[6.5, 0], [1, 0], [0.6, 4.4], ...curve([0.6, 4.4], [[2.5, 3.4], [6.9, 3.4], [6.9, 6.9]], [[6.9, 10.6], [1.6, 10.6], [0.2, 8.8]])]],
  6: [arc(3.5, 6.6, 3.4, 3.4, 0, 360), curve([5.6, 0.3], [[2.5, 0.3], [0.1, 3], [0.1, 6.6]])],
  7: [[[0, 0], [7, 0], [2.6, 10]]],
  8: [arc(3.5, 2.6, 2.9, 2.6, 0, 360), arc(3.5, 7.4, 3.4, 2.6, 0, 360)],
  9: [arc(3.5, 3.4, 3.4, 3.4, 0, 360), curve([6.9, 3.4], [[6.9, 7], [4.5, 9.7], [1.4, 9.7]])],
  // Marks for set text (the share image): a point, a middle dot, a dash.
  '.': [[[0, 10], [0, 10]]],
  '·': [[[0, 5.4], [0, 5.4]]],
  '-': [[[0, 5.6], [4.4, 5.6]]],
};

function luminance(hex: string) {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Distance from a point to a segment. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? clamp01(((px - ax) * dx + (py - ay) * dy) / len) : 0;
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return Math.sqrt(x * x + y * y);
}
/** Signed distance to a rounded rectangle centred at (cx, cy); negative inside. */
function roundRect(px: number, py: number, cx: number, cy: number, hw: number, hh: number, r: number) {
  const qx = Math.abs(px - cx) - hw + r, qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * The icon as RGBA pixels. "any" icons are a rounded square on transparent; maskable (Android) and Apple
 * icons fill the square, with the letter inside the safe zone.
 */
function drawIcon(size: number, color: string, letter: string, full: boolean): Buffer {
  const px = Buffer.alloc(size * size * 4);
  const bg = [0, 2, 4].map((i) => parseInt(color.slice(i, i + 2), 16));
  const fg = luminance(color) > 0.5 ? [20, 20, 20] : [255, 255, 255];
  const radius = full ? 0 : size * 0.225;
  // Letter strokes, scaled into the middle of the icon.
  const cap = size * (full ? 0.36 : 0.44);
  const unit = cap / 10;
  const half = Math.max(1, unit * 0.86);
  const strokes = GLYPHS[letter] ?? null;
  let segs: number[] = [];
  let tiles: { cx: number; cy: number; hw: number; r: number }[] = [];
  if (strokes) {
    const all = strokes.flat();
    const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
    const ox = size / 2 - ((minX + maxX) / 2) * unit, oy = size / 2 - 5 * unit;
    for (const s of strokes) for (let i = 1; i < s.length; i++) segs.push(ox + s[i - 1][0] * unit, oy + s[i - 1][1] * unit, ox + s[i][0] * unit, oy + s[i][1] * unit);
  } else {
    // Four tiles (the "Jhino app" mark), one of them round.
    const t = size * (full ? 0.13 : 0.16), gap = size * (full ? 0.05 : 0.06);
    const c = size / 2, d = t + gap / 2;
    tiles = [[-1, -1, 0.28], [1, -1, 1], [-1, 1, 0.28], [1, 1, 0.28]].map(([sx, sy, r]) => ({ cx: c + sx * d, cy: c + sy * d, hw: t, r: r * t }));
  }
  const n = segs.length / 4;
  // Only pixels near the letter need the (slower) stroke distance.
  let bx0 = size, by0 = size, bx1 = 0, by1 = 0;
  for (let i = 0; i < segs.length; i += 2) { bx0 = Math.min(bx0, segs[i]); bx1 = Math.max(bx1, segs[i]); by0 = Math.min(by0, segs[i + 1]); by1 = Math.max(by1, segs[i + 1]); }
  bx0 -= half + 2; by0 -= half + 2; bx1 += half + 2; by1 += half + 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      const a = full ? 1 : clamp01(0.5 - roundRect(cx, cy, size / 2, size / 2, size / 2, size / 2, radius));
      if (!a) continue;
      let g = 0;
      if (n && cx >= bx0 && cx <= bx1 && cy >= by0 && cy <= by1) {
        let d = Infinity;
        for (let i = 0; i < segs.length; i += 4) { const v = segDist(cx, cy, segs[i], segs[i + 1], segs[i + 2], segs[i + 3]); if (v < d) d = v; }
        g = clamp01(half - d + 0.5);
      } else if (tiles.length) {
        for (const t of tiles) g = Math.max(g, clamp01(0.5 - roundRect(cx, cy, t.cx, t.cy, t.hw, t.hw, t.r)));
      }
      const o = (y * size + x) * 4;
      px[o] = Math.round(bg[0] + (fg[0] - bg[0]) * g);
      px[o + 1] = Math.round(bg[1] + (fg[1] - bg[1]) * g);
      px[o + 2] = Math.round(bg[2] + (fg[2] - bg[2]) * g);
      px[o + 3] = Math.round(a * 255);
    }
  }
  return px;
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf: Buffer) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** RGBA pixels → PNG file. */
function png(size: number, rgba: Buffer, height = size) {
  const w = size, h = height;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const icons = new Map<string, Buffer>();
export function iconPng(color: string, letter: string, size: number, full: boolean) {
  const key = `${color}-${letter}-${size}-${full ? 1 : 0}`;
  let b = icons.get(key);
  if (!b) {
    b = png(size, drawIcon(size, color, letter, full));
    if (icons.size > 400) icons.delete(icons.keys().next().value!);
    icons.set(key, b);
  }
  return b;
}

/* ---------------- Jhino's own marks: the logo, favicon.ico and the share image ---------------- */
/** Paints strokes (capsules) into a coverage mask, visiting only the pixels near each one. */
function stamp(mask: Float32Array, w: number, h: number, segs: number[], half: number) {
  for (let i = 0; i < segs.length; i += 4) {
    const [ax, ay, bx, by] = [segs[i], segs[i + 1], segs[i + 2], segs[i + 3]];
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - half - 1)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + half + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - half - 1)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + half + 1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = clamp01(half - segDist(x + 0.5, y + 0.5, ax, ay, bx, by) + 0.5);
      if (c > mask[y * w + x]) mask[y * w + x] = c;
    }
  }
}
/** A filled circle into a coverage mask. */
function disc(mask: Float32Array, w: number, h: number, cx: number, cy: number, r: number) {
  for (let y = Math.max(0, Math.floor(cy - r - 1)); y <= Math.min(h - 1, Math.ceil(cy + r + 1)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(w - 1, Math.ceil(cx + r + 1)); x++) {
      const c = clamp01(r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5);
      if (c > mask[y * w + x]) mask[y * w + x] = c;
    }
  }
}
/** Lays a coverage mask over RGBA pixels in one colour. */
function paint(px: Buffer, mask: Float32Array, rgb: number[]) {
  for (let i = 0; i < mask.length; i++) {
    const a = mask[i];
    if (!a) continue;
    const o = i * 4;
    for (let k = 0; k < 3; k++) px[o + k] = Math.round(px[o + k] + (rgb[k] - px[o + k]) * a);
  }
}
const hex = (c: string) => [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
const polyline = (pts: Pt[], sx: number, sy: number, k: number) => {
  const out: number[] = [];
  for (let i = 1; i < pts.length; i++) out.push(sx + pts[i - 1][0] * k, sy + pts[i - 1][1] * k, sx + pts[i][0] * k, sy + pts[i][1] * k);
  return out;
};
/** The favicon's "j" with its red point, on a 32-unit grid: a stem, a hook to the left, a dot up and right. */
const J_STEM: Pt[] = [[13, 9], [13, 20.5], ...arc(9.002, 20.378, 4, 4, 1.75, 128.7)];
function drawMark(px: Buffer, w: number, h: number, x: number, y: number, size: number, withTile: boolean) {
  const k = size / 32;
  if (withTile) {
    const tile = new Float32Array(w * h);
    for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(h, Math.ceil(y + size)); yy++) {
      for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(w, Math.ceil(x + size)); xx++) {
        tile[yy * w + xx] = clamp01(0.5 - roundRect(xx + 0.5, yy + 0.5, x + size / 2, y + size / 2, size / 2, size / 2, 6 * k));
      }
    }
    paint(px, tile, hex(INK));
  }
  const j = new Float32Array(w * h);
  stamp(j, w, h, polyline(J_STEM, x, y, k), 1.5 * k);
  paint(px, j, [255, 255, 255]);
  const dot = new Float32Array(w * h);
  disc(dot, w, h, x + 22 * k, y + 10 * k, 3.5 * k);
  paint(px, dot, hex('e0461f'));
}
/** Jhino's logo as a square PNG (a rounded tile; `full` fills the square, for iPhone and Android masks). */
export function logoPng(size: number, full = false) {
  const key = `logo-${size}-${full ? 1 : 0}`;
  let b = icons.get(key);
  if (!b) {
    const px = Buffer.alloc(size * size * 4);
    if (full) { for (let i = 0; i < px.length; i += 4) { px[i] = 0x14; px[i + 1] = 0x14; px[i + 2] = 0x14; px[i + 3] = 255; } drawMark(px, size, size, size * 0.1, size * 0.1, size * 0.8, false); }
    else {
      drawMark(px, size, size, 0, 0, size, true);
      // Only the tile is opaque: its coverage becomes the alpha.
      for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) px[(yy * size + xx) * 4 + 3] = Math.round(255 * clamp01(0.5 - roundRect(xx + 0.5, yy + 0.5, size / 2, size / 2, size / 2, size / 2, (6 / 32) * size)));
    }
    b = png(size, px);
    icons.set(key, b);
  }
  return b;
}
/** favicon.ico: one 48×48 PNG inside an ICO wrapper (what browsers and search engines ask for). */
export function faviconIco() {
  let b = icons.get('ico');
  if (!b) {
    const pngData = logoPng(48);
    const head = Buffer.alloc(22);
    head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
    head[6] = 48; head[7] = 48; head[8] = 0; head[9] = 0; head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
    head.writeUInt32LE(pngData.length, 14); head.writeUInt32LE(22, 18);
    b = Buffer.concat([head, pngData]);
    icons.set('ico', b);
  }
  return b;
}
/** Set text in the monoline alphabet (capitals, figures, a few marks). Returns where the text ends. */
function text(px: Buffer, w: number, h: number, s: string, x: number, top: number, cap: number, rgb: number[], weight = 0.86) {
  const u = cap / 10, mask = new Float32Array(w * h);
  let pen = x;
  for (const ch of s.toUpperCase()) {
    if (ch === ' ') { pen += 4.4 * u; continue; }
    const g = GLYPHS[ch];
    if (!g) continue;
    const all = g.flat();
    const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
    for (const stroke of g) stamp(mask, w, h, polyline(stroke.length > 1 ? stroke : [stroke[0], stroke[0]], pen - minX * u, top, u), u * weight);
    pen += (maxX - minX) * u + 2.9 * u;
  }
  paint(px, mask, rgb);
  return pen;
}
/** The picture shown when a Jhino page is shared (1200 × 630): the mark and the promise, on ink. */
export function ogPng() {
  let b = icons.get('og');
  if (!b) {
    const W = 1200, H = 630, px = Buffer.alloc(W * H * 4);
    for (let i = 0; i < px.length; i += 4) { px[i] = 0x14; px[i + 1] = 0x14; px[i + 2] = 0x14; px[i + 3] = 255; }
    drawMark(px, W, H, 88, 84, 104, false);
    text(px, W, H, 'Send the work.', 92, 256, 78, [244, 242, 236]);
    const end = text(px, W, H, 'Get the ', 92, 368, 78, [244, 242, 236]);
    text(px, W, H, 'yes.', end, 368, 78, hex('e0461f'));
    text(px, W, H, 'Client apps · link in bio · short links', 94, 522, 20, [150, 147, 139], 0.95);
    const url = 'jhino.com';
    text(px, W, H, url, W - 94 - url.length * 17.2, 522, 20, [244, 242, 236], 0.95);
    b = png(W, px, H);
    icons.set('og', b);
  }
  return b;
}

/* ---------------- the service worker ---------------- */
const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline</title>
<style>html{background:#fff;color:#141414;font:16px/1.5 -apple-system,"Segoe UI",sans-serif}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}
main{max-width:340px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 20px;color:#5f5e5a}button{font:inherit;font-weight:600;padding:10px 18px;border-radius:8px;border:1px solid #141414;background:#141414;color:#fff;cursor:pointer}
@media (prefers-color-scheme:dark){html{background:#121211;color:#f2f1ed}p{color:#a8a7a1}button{background:#f2f1ed;color:#121211;border-color:#f2f1ed}}</style></head>
<body><main><h1>You are offline</h1><p>This app stays in sync with everyone, so it needs the internet. It opens again as soon as you are back online.</p><button onclick="location.reload()">Try again</button></main>
<script>addEventListener('online',function(){location.reload()})</script></body></html>`;
const SERVICE_WORKER = `/* Jhino installed apps: open from the home screen, with a friendly page when offline. Nothing is cached. */
const OFFLINE = ${JSON.stringify(OFFLINE_PAGE)};
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
`;

/* ---------------- routes ---------------- */
export function registerPwa(app: FastifyInstance) {
  /** The manifest for the app at an address (?path=/<username>/<name>). */
  app.get('/api/pwa/manifest', async (req, reply) => {
    limit(req, 'pwa-manifest', 120, 60_000);
    const found = appAt(String((req.query as { path?: string }).path ?? ''));
    if (!found || !mayInstall(req, found.app)) throw new HttpError(404, 'NOT_FOUND', 'There is no app to install here.');
    reply.type('application/manifest+json; charset=utf-8').header('Cache-Control', 'no-cache');
    return JSON.stringify(installInfo(found.app, found.path).manifest);
  });

  /** What the install sheet shows: the name, icon and address. */
  app.get('/api/pwa/info', async (req) => {
    limit(req, 'pwa-info', 120, 60_000);
    const found = appAt(String((req.query as { path?: string }).path ?? ''));
    if (!found || !mayInstall(req, found.app)) throw new HttpError(404, 'NOT_FOUND', 'There is no app to install here.');
    const { manifest: _m, ...info } = installInfo(found.app, found.path);
    return info;
  });

  /** Icons: /_jhino/icon/<colour>-<letter>-<size>[-m].png. Made once, then cached for good (the name says it all). */
  app.get('/_jhino/icon/:file', async (req, reply) => {
    const m = /^([0-9a-f]{6})-([A-Z0-9x])-(180|192|512)(-m)?\.png$/.exec((req.params as { file: string }).file);
    if (!m) return reply.code(404).type('text/plain').send('Not found');
    const letter = m[2] === 'x' ? '*' : m[2];
    reply.type('image/png').header('Cache-Control', 'public, max-age=31536000, immutable').header('X-Content-Type-Options', 'nosniff');
    return iconPng(m[1], letter, Number(m[3]), !!m[4]);
  });

  /** The service worker for installed apps. Registered with the app's own address as its scope. */
  app.get('/_jhino/app-sw.js', async (_req, reply) => {
    reply.type('text/javascript; charset=utf-8').header('Cache-Control', 'no-cache').header('Service-Worker-Allowed', '/');
    return SERVICE_WORKER;
  });
}
