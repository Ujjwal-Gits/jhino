import type { FastifyInstance } from 'fastify';
import { db, now } from './db.js';
import { HttpError, requireUser } from './auth.js';
import { limit } from './security.js';

/*
 * Server help for the everyday apps on Home:
 * - Exchange rates: Nepal Rastra Bank's published NPR rates, cached for six hours (currency converter and
 *   the subscription totals).
 * - Domain expiry: an RDAP lookup (the public successor to WHOIS) finds a domain's expiry date and registrar.
 *   Saved domains are looked up again every week, so a renewal shows up by itself.
 * - Renewals roll forward: a monthly, yearly or weekly subscription whose date has passed moves to its next
 *   date, with a fresh reminder.
 * - Focus music: a person's playlists and favourites (one small JSON document; recent plays stay in the
 *   browser, not here), and video titles
 *   from YouTube's oEmbed.
 * - YouTube thumbnails, fetched here so the browser can save them as a file.
 */

db.exec(`CREATE TABLE IF NOT EXISTS focus_library (user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);`);
// Recent plays used to be saved here; they now stay in the browser. Drop the old copies once.
db.exec(`UPDATE focus_library SET data=json_remove(data,'$.history') WHERE json_extract(data,'$.history') IS NOT NULL;`);

const UA = { 'user-agent': 'Jhino/1.0 (+https://jhino.com)' };
async function fetchJson(url: string, ms = 9000): Promise<any> {
  const r = await fetch(url, { headers: { accept: 'application/json, application/rdap+json', ...UA }, signal: AbortSignal.timeout(ms), redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/* ---------- exchange rates ---------- */
let fx: { at: number; date: string; rates: Record<string, { name: string; buy: number; sell: number }> } | null = null;
async function rates() {
  if (fx && Date.now() - fx.at < 6 * 3600_000) return fx;
  const d = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const j = await fetchJson(`https://www.nrb.org.np/api/forex/v1/rates?page=1&per_page=10&from=${d(7)}&to=${d(0)}`);
  const days = (j?.data?.payload ?? []) as { date: string; rates: { currency: { iso3: string; name: string; unit: number }; buy: string; sell: string }[] }[];
  const latest = days.filter((p) => p.rates?.length).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!latest) throw new Error('no rates');
  const out: Record<string, { name: string; buy: number; sell: number }> = { NPR: { name: 'Nepalese Rupee', buy: 1, sell: 1 } };
  for (const r of latest.rates) {
    const unit = Number(r.currency.unit) || 1;
    out[r.currency.iso3] = { name: r.currency.name, buy: Number(r.buy) / unit, sell: Number(r.sell) / unit };
  }
  fx = { at: Date.now(), date: latest.date, rates: out };
  return fx;
}

/* ---------- domains ---------- */
export function cleanDomain(raw: unknown) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '').replace(/\.$/, '');
  if (!/^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s)) throw new HttpError(400, 'VALIDATION_FAILED', 'Enter a domain like example.com.');
  return s;
}
/** Which RDAP server answers for each top-level domain (IANA's list, kept for a day). */
let boot: { at: number; map: Map<string, string> } | null = null;
async function rdapBase(tld: string) {
  if (!boot || Date.now() - boot.at > 864e5) {
    const j = await fetchJson('https://data.iana.org/rdap/dns.json');
    const map = new Map<string, string>();
    for (const [tlds, urls] of j.services as [string[], string[]][]) { const u = urls.find((x) => x.startsWith('https')) ?? urls[0]; for (const t of tlds) map.set(t, u.endsWith('/') ? u : `${u}/`); }
    boot = { at: Date.now(), map };
  }
  return boot.map.get(tld) ?? null;
}
async function scanDomain(domain: string) {
  const base = await rdapBase(domain.split('.').pop()!);
  if (!base) throw new Error('no rdap');
  const j = await fetchJson(`${base}domain/${encodeURIComponent(domain)}`, 12000);
  const ev = (a: string) => (j.events ?? []).find((e: { eventAction: string; eventDate: string }) => e.eventAction === a)?.eventDate as string | undefined;
  const reg = (j.entities ?? []).find((e: { roles?: string[] }) => e.roles?.includes('registrar'));
  const fn = (reg?.vcardArray?.[1] ?? []).find((v: unknown[]) => v[0] === 'fn')?.[3] as string | undefined;
  const expires = ev('expiration');
  return { expiresAt: expires ? new Date(expires).toISOString() : null, registeredAt: ev('registration') ?? null, registrar: fn ?? '', status: (j.status ?? []) as string[] };
}

/* ---------- renewals roll forward, domains re-checked ---------- */
function nextDate(iso: string, cycle: string) {
  const d = new Date(iso), t = Date.now();
  for (let i = 0; i < 600 && d.getTime() < t; i++) {
    if (cycle === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
    else if (cycle === 'weekly') d.setDate(d.getDate() + 7);
    else if (cycle === 'quarterly') d.setMonth(d.getMonth() + 3);
    else break;
  }
  return d.toISOString();
}
interface SubRow { id: string; data: string; due_at: string | null }
async function sweep() {
  const past = db.prepare("SELECT id, data, due_at FROM tool_items WHERE kind='sub' AND archived=0 AND due_at IS NOT NULL AND due_at < ? LIMIT 500").all(new Date(Date.now() - 864e5).toISOString()) as SubRow[];
  for (const r of past) {
    const d = JSON.parse(r.data) as Record<string, unknown>;
    if (d.status === 'cancelled' || d.domain || !['monthly', 'yearly', 'weekly', 'quarterly'].includes(String(d.cycle))) continue;
    const due = nextDate(r.due_at!, String(d.cycle));
    const remind = new Date(new Date(due).getTime() - Number(d.remindDays ?? 3) * 864e5).toISOString();
    db.prepare('UPDATE tool_items SET due_at=?, remind_at=?, reminded_at=NULL, updated_at=? WHERE id=?').run(due, remind, now(), r.id);
  }
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  const domains = (db.prepare("SELECT id, data, due_at FROM tool_items WHERE kind='sub' AND archived=0 AND json_extract(data,'$.domain') IS NOT NULL AND COALESCE(json_extract(data,'$.scannedAt'),'') < ? LIMIT 40").all(week) as SubRow[]);
  for (const r of domains) {
    const d = JSON.parse(r.data) as Record<string, unknown>;
    try {
      const s = await scanDomain(String(d.domain));
      const data = { ...d, scannedAt: now(), registrar: s.registrar || d.registrar || '' };
      if (s.expiresAt && s.expiresAt !== r.due_at) {
        const remind = new Date(new Date(s.expiresAt).getTime() - Number(d.remindDays ?? 30) * 864e5).toISOString();
        db.prepare('UPDATE tool_items SET data=?, due_at=?, remind_at=?, reminded_at=NULL, updated_at=? WHERE id=?').run(JSON.stringify(data), s.expiresAt, remind, now(), r.id);
      } else db.prepare('UPDATE tool_items SET data=? WHERE id=?').run(JSON.stringify(data), r.id);
    } catch {
      db.prepare('UPDATE tool_items SET data=? WHERE id=?').run(JSON.stringify({ ...d, scannedAt: now() }), r.id);
    }
    await new Promise((ok) => setTimeout(ok, 1500));
  }
}


/* ---------- focus stations: the channels' streams that are live right now ---------- */
const CHANNELS: [string, string][] = [['@LofiGirl', 'Lofi Girl'], ['@ChillhopMusic', 'Chillhop Music']];
/** Videos that stay up, used with the live ones and when YouTube can't be read. */
const STEADY = [
  { type: 'video', id: 'mPZkdNFkNps', title: 'Heavy rain on a window, with thunder', author: 'Relaxing Ambience', tag: 'Rain' },
  { type: 'video', id: 'lTRiuFIWV54', title: '1 A.M study session', author: 'Lofi Girl', tag: 'Mix' },
  { type: 'video', id: 'n61ULEU7CO0', title: 'Best of lofi hip hop', author: 'Lofi Girl', tag: 'Mix' },
];
const FALLBACK = [
  { type: 'live', id: 'UCSJ4gkVC6NrvII8umztf0Ow', title: 'Lofi Girl, live now', author: 'Lofi Girl', tag: 'Live' },
  { type: 'live', id: 'UCOxqgCwgOqC2lMqC5PYz_Dg', title: 'Chillhop Radio, live now', author: 'Chillhop Music', tag: 'Live' },
];
const tagOf = (t: string) => { const l = t.toLowerCase(); return /jazz/.test(l) ? 'Jazz' : /sleep|dream/.test(l) ? 'Sleep' : /piano/.test(l) ? 'Piano' : /classical/.test(l) ? 'Classical' : /synth/.test(l) ? 'Synthwave' : /ambient|space/.test(l) ? 'Ambient' : /rain/.test(l) ? 'Rain' : /pomodoro|study with me/.test(l) ? 'Pomodoro' : /study|focus/.test(l) ? 'Study' : /house|lounge/.test(l) ? 'Lounge' : 'Chill'; };
let stations: { at: number; list: unknown[] } | null = null;
async function liveOf(handle: string, author: string) {
  const r = await fetch(`https://www.youtube.com/${handle}/streams`, { headers: { 'accept-language': 'en-US,en', cookie: 'SOCS=CAI; CONSENT=YES+1', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' }, signal: AbortSignal.timeout(10000) });
  const t = await r.text();
  const i = t.indexOf('var ytInitialData = '); if (i < 0) return [];
  const d = JSON.parse(t.slice(i + 20, t.indexOf(';</script>', i)));
  const out: { type: string; id: string; title: string; author: string; tag: string }[] = [];
  const walk = (o: any): void => {
    if (!o || typeof o !== 'object' || out.length >= 12) return;
    // YouTube lists videos as lockupViewModel now (videoRenderer before); a live one carries a "LIVE" badge.
    const lk = o.lockupViewModel, v = o.videoRenderer ?? o.gridVideoRenderer;
    const id = lk?.contentId ?? v?.videoId;
    if (id) {
      const live = lk ? /"text":"LIVE"/.test(JSON.stringify(lk.contentImage ?? {})) : /"(LIVE|BADGE_STYLE_TYPE_LIVE_NOW)"/.test(JSON.stringify(v.thumbnailOverlays ?? []) + JSON.stringify(v.badges ?? []));
      const raw = lk ? lk.metadata?.lockupMetadataViewModel?.title?.content : v.title?.runs?.[0]?.text ?? v.title?.simpleText;
      const title = String(raw ?? '').replace(/\p{Extended_Pictographic}|️/gu, '').replace(/\s+/g, ' ').trim();
      if (live && title && /^[\w-]{11}$/.test(id) && !/christmas|halloween/i.test(title)) out.push({ type: 'live', id, title, author, tag: tagOf(title) });
      return;
    }
    for (const k in o) walk(o[k]);
  };
  walk(d);
  return out;
}
async function currentStations() {
  if (stations && Date.now() - stations.at < 6 * 3600_000) return stations.list;
  const lists = await Promise.all(CHANNELS.map(([h, a]) => liveOf(h, a).catch(() => [])));
  const live = lists.flat();
  const list = [...(live.length ? live : FALLBACK), ...STEADY];
  stations = { at: live.length ? Date.now() : Date.now() - 5 * 3600_000, list };
  return list;
}

/* ---------- focus library ---------- */
const s = (v: unknown, n: number) => String(v ?? '').slice(0, n);
const item = (v: any) => (v && typeof v === 'object' && /^[\w-]{6,64}$/.test(String(v.id)) && ['video', 'list', 'live'].includes(v.type)
  ? { type: v.type, id: String(v.id), title: s(v.title, 200), author: s(v.author, 120), ...(v.at ? { at: s(v.at, 30) } : {}) } : null);
const items = (v: unknown, max: number) => (Array.isArray(v) ? v.map(item).filter(Boolean).slice(0, max) : []);

export function registerEveryday(app: FastifyInstance) {
  app.get('/api/fx', async (req) => {
    requireUser(req);
    try { const r = await rates(); return { date: r.date, rates: r.rates, source: 'Nepal Rastra Bank' }; } catch { throw new HttpError(503, 'UNAVAILABLE', 'Exchange rates are not reachable right now. Try again soon.'); }
  });

  app.post('/api/subs/scan', async (req) => {
    const u = requireUser(req);
    limit(req, 'domain-scan', 40, 3600_000, u.id);
    const domain = cleanDomain((req.body as { domain?: unknown })?.domain);
    try { return { domain, ...(await scanDomain(domain)) }; } catch {
      return { domain, expiresAt: null, registrar: '', status: [], note: 'This domain’s registry does not publish its expiry date (common for .np and some country domains). Enter the date yourself.' };
    }
  });

  app.get('/api/focus/stations', async (req) => { requireUser(req); return { stations: await currentStations() }; });

  app.get('/api/focus/library', async (req) => {
    const u = requireUser(req);
    const r = db.prepare('SELECT data FROM focus_library WHERE user_id=?').get(u.id) as { data: string } | undefined;
    return r ? { ...JSON.parse(r.data), history: [] } : { playlists: [], favs: [], history: [] };
  });
  app.put('/api/focus/library', async (req) => {
    const u = requireUser(req);
    limit(req, 'focus-lib', 600, 3600_000, u.id);
    const b = (req.body ?? {}) as { playlists?: unknown; favs?: unknown };
    const lists = Array.isArray(b.playlists) ? b.playlists.slice(0, 50).map((p: any) => ({ id: s(p?.id, 20) || Math.random().toString(36).slice(2, 10), name: s(p?.name, 80).trim() || 'Playlist', items: items(p?.items, 200) })) : [];
    const data = { playlists: lists, favs: items(b.favs, 300) };
    const json = JSON.stringify(data);
    if (json.length > 300_000) throw new HttpError(413, 'TOO_LARGE', 'Your library is too big. Remove some videos.');
    db.prepare('INSERT INTO focus_library(user_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at').run(u.id, json, now());
    return data;
  });
  app.get('/api/focus/meta', async (req) => {
    const u = requireUser(req);
    limit(req, 'focus-meta', 300, 3600_000, u.id);
    const url = String((req.query as { url?: string }).url ?? '');
    if (!/^https:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//.test(url)) throw new HttpError(400, 'VALIDATION_FAILED', 'Not a YouTube link.');
    try { const j = await fetchJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, 6000); return { title: s(j.title, 200), author: s(j.author_name, 120) }; } catch { return { title: '', author: '' }; }
  });

  app.get('/api/yt-thumb/:id/:q', async (req, reply) => {
    const u = requireUser(req);
    limit(req, 'yt-thumb', 200, 3600_000, u.id);
    const { id, q } = req.params as { id: string; q: string };
    if (!/^[\w-]{11}$/.test(id) || !['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault'].includes(q)) throw new HttpError(400, 'VALIDATION_FAILED', 'Bad video.');
    const r = await fetch(`https://i.ytimg.com/vi/${id}/${q}.jpg`, { headers: UA, signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!r?.ok) throw new HttpError(404, 'NOT_FOUND', 'That size does not exist for this video.');
    return reply.header('Content-Type', 'image/jpeg').header('Content-Disposition', `attachment; filename="thumbnail-${id}-${q}.jpg"`).header('Cache-Control', 'private, max-age=3600').send(Buffer.from(await r.arrayBuffer()));
  });

  setTimeout(() => { void sweep().catch(() => {}); }, 30_000).unref();
  setInterval(() => { void sweep().catch(() => {}); }, 6 * 3600_000).unref();
}
