import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, get } from '../../api';
import { PanelLoader } from '../../Loader';
import { Icon, bytes, copyText, Select, useToast } from '../../ui';

/*
 * Everyday tools people come back for: image converter, NPR currency converter (Nepal Rastra Bank rates),
 * fancy fonts for bios, YouTube thumbnail saver, giveaway picker with a spin wheel, and a loan EMI
 * calculator. All run in the browser, except the rates and thumbnails (server/everyday.ts).
 */
const dl = (href: string, name: string) => { const a = document.createElement('a'); a.href = href; a.download = name; a.click(); };
function CopyBtn({ text, label = 'Copy', sm = true }: { text: string; label?: string; sm?: boolean }) {
  const [done, setDone] = useState(false);
  return <button className={`btn ${sm ? 'sm' : ''}`} disabled={!text} onClick={async () => { if (await copyText(text)) { setDone(true); setTimeout(() => setDone(false), 1300); } }}><Icon name={done ? 'check' : 'copy'} size={15} />{done ? 'Copied' : label}</button>;
}

/* ---------------- image converter ---------------- */
type Fmt = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif';
interface Img { id: string; name: string; src: File; w: number; h: number; out?: { blob: Blob; url: string; w: number; h: number } }
const EXT: Record<Fmt, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
const canAvif = (() => { try { const c = document.createElement('canvas'); c.width = c.height = 1; return c.toDataURL('image/avif').startsWith('data:image/avif'); } catch { return false; } })();
export function ImageConverter() {
  const [imgs, setImgs] = useState<Img[]>([]);
  const [fmt, setFmt] = useState<Fmt>('image/webp');
  const [maxW, setMaxW] = useState(0), [q, setQ] = useState(0.82);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const add = async (files: FileList | File[]) => {
    const got = await Promise.all([...files].filter((f) => f.type.startsWith('image/') || /\.(heic|avif|svg)$/i.test(f.name)).slice(0, 50).map(async (f) => {
      const b = await createImageBitmap(f).catch(() => null); if (!b) return null;
      const r: Img = { id: Math.random().toString(36).slice(2), name: f.name, src: f, w: b.width, h: b.height }; b.close(); return r;
    }));
    setImgs((l) => [...l, ...(got.filter(Boolean) as Img[])]);
  };
  const run = useCallback(async (list: Img[]) => {
    for (const im of list) {
      const b = await createImageBitmap(im.src);
      const s = maxW ? Math.min(1, maxW / b.width) : 1, w = Math.round(b.width * s), h = Math.round(b.height * s);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d')!; if (fmt === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); }
      x.imageSmoothingQuality = 'high'; x.drawImage(b, 0, 0, w, h); b.close();
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, fmt, q)); if (!blob) continue;
      setImgs((all) => all.map((z) => { if (z.id !== im.id) return z; if (z.out) URL.revokeObjectURL(z.out.url); return { ...z, out: { blob, url: URL.createObjectURL(blob), w, h } }; }));
    }
  }, [maxW, q, fmt]);
  const key = imgs.map((i) => i.id).join();
  useEffect(() => { const t = setTimeout(() => run(imgs), 250); return () => clearTimeout(t); }, [key, run]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (i: Img) => `${i.name.replace(/\.[^.]+$/, '')}.${EXT[fmt]}`;
  const all = async () => {
    const ready = imgs.filter((i) => i.out); if (ready.length === 1) { dl(ready[0].out!.url, name(ready[0])); return; }
    const { zipSync } = await import('fflate'); const files: Record<string, Uint8Array> = {};
    for (const i of ready) files[name(i)] = new Uint8Array(await i.out!.blob.arrayBuffer());
    dl(URL.createObjectURL(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' })), 'images.zip');
  };
  const saved = imgs.reduce((n, i) => n + (i.out ? i.src.size - i.out.blob.size : 0), 0);
  const FMTS: [Fmt, string][] = [['image/jpeg', 'JPG'], ['image/png', 'PNG'], ['image/webp', 'WebP'], ...(canAvif ? [['image/avif', 'AVIF'] as [Fmt, string]] : [])];
  return (
    <div className="tp-split img">
      <section className="tp-card tp-sticky">
        <h2>Convert to</h2>
        <div className="tp-seg">{FMTS.map(([v, l]) => <button key={v} aria-pressed={fmt === v} onClick={() => setFmt(v)}>{l}</button>)}</div>
        <p className="hint">{fmt === 'image/webp' ? 'WebP: much smaller than JPG, works in every modern browser. Best for websites.' : fmt === 'image/jpeg' ? 'JPG: opens everywhere. Transparent parts turn white.' : fmt === 'image/png' ? 'PNG: sharp edges and transparency; larger files.' : 'AVIF: the smallest files, newer browsers only.'}</p>
        {fmt !== 'image/png' && <label className="field"><span>Quality <em className="mono">{Math.round(q * 100)}%</em></span><input type="range" min={0.3} max={1} step={0.02} value={q} onChange={(e) => setQ(Number(e.target.value))} /></label>}
        <h2>Size</h2>
        <div className="tp-presets">{[[0, 'Original'], [1920, 'Full HD'], [1080, 'Instagram'], [800, 'Web']].map(([w, n]) => <button key={n} className={maxW === w ? 'on' : ''} onClick={() => setMaxW(w as number)}><b className="mono">{w || '100%'}</b><small>{n}</small></button>)}</div>
        <label className="field"><span>Largest width <em className="mono">{maxW ? `${maxW}px` : 'original'}</em></span><input type="range" min={0} max={4000} step={40} value={maxW} onChange={(e) => setMaxW(Number(e.target.value))} /></label>
        <p className="hint">JPG to PNG, PNG to WebP, WebP to JPG, HEIC (on iPhone Safari) to JPG and more. Photos never leave your device.</p>
      </section>
      <section>
        <button className={`tp-drop ${over ? 'over' : ''}`} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
          <Icon name="image" size={28} /><b>Drop images here</b><span>JPG, PNG, WebP, GIF, AVIF, SVG, BMP. Up to 50 at once.</span>
        </button>
        <input ref={input} type="file" accept="image/*,.heic,.avif" multiple hidden onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
        {!!imgs.length && <>
          <div className="tp-row tp-sum"><span>{imgs.length} {imgs.length === 1 ? 'image' : 'images'} · {saved >= 0 ? `saved ${bytes(saved)}` : `${bytes(-saved)} larger`}</span>
            <span className="actions-row"><button className="btn sm primary" onClick={all}><Icon name="download" size={15} />{imgs.length > 1 ? 'Download all (.zip)' : 'Download'}</button><button className="btn sm quiet" onClick={() => setImgs([])}>Clear</button></span></div>
          <ul className="tp-imgs">{imgs.map((i) => (
            <li key={i.id} className="tp-card">
              {i.out ? <img src={i.out.url} alt="" /> : <span className="tp-img-wait"><span className="spin" /></span>}
              <div className="ha-t"><b title={i.name}>{name(i)}</b><small className="mono">{bytes(i.src.size)} → {i.out ? bytes(i.out.blob.size) : '…'}{i.out && ` · ${i.out.w}×${i.out.h}`}</small>
                {i.out && <small className={i.out.blob.size < i.src.size ? 'ok-text' : 'warn-text'}>{i.out.blob.size < i.src.size ? `${Math.round((1 - i.out.blob.size / i.src.size) * 100)}% smaller` : 'Larger than the original'}</small>}</div>
              <span className="actions-row"><button className="btn sm" aria-label="Download" disabled={!i.out} onClick={() => i.out && dl(i.out.url, name(i))}><Icon name="download" size={15} /></button><button className="icon-btn" aria-label="Remove" onClick={() => setImgs((l) => l.filter((x) => x.id !== i.id))}><Icon name="close" size={15} /></button></span>
            </li>
          ))}</ul>
        </>}
      </section>
    </div>
  );
}

/* ---------------- currency ---------------- */
interface Fx { date: string; rates: Record<string, { name: string; buy: number; sell: number }> }
const POPULAR = ['USD', 'INR', 'EUR', 'GBP', 'AUD', 'AED', 'QAR', 'SAR', 'MYR', 'KRW', 'JPY', 'CAD', 'CNY'];
export function Currency() {
  const [fx, setFx] = useState<Fx | null>(null);
  const [err, setErr] = useState('');
  const [amt, setAmt] = useState('100'), [from, setFrom] = useState('USD'), [to, setTo] = useState('NPR');
  useEffect(() => { get<Fx>('/api/fx').then(setFx, (e) => setErr(e instanceof ApiError ? e.message : 'Rates are not reachable right now.')); }, []);
  if (err) return <p className="tp-empty">{err}</p>;
  if (!fx) return <PanelLoader />;
  const codes = Object.keys(fx.rates).sort((a, b) => (a === 'NPR' ? -1 : b === 'NPR' ? 1 : (POPULAR.indexOf(a) + 1 || 99) - (POPULAR.indexOf(b) + 1 || 99)));
  const opts = codes.map((c) => ({ value: c, label: `${c} · ${fx.rates[c].name}` }));
  const n = Number(amt) || 0;
  // Selling foreign money gets the bank's buying rate; buying it costs the selling rate.
  const npr = from === 'NPR' ? n : n * fx.rates[from].buy;
  const result = to === 'NPR' ? npr : npr / fx.rates[to].sell;
  const mid = (c: string) => (fx.rates[c].buy + fx.rates[c].sell) / 2;
  const midResult = (from === 'NPR' ? n : n * mid(from)) / (to === 'NPR' ? 1 : mid(to));
  return (
    <div className="cx">
      <section className="tp-card cx-main">
        <div className="cx-row">
          <label className="field"><span>Amount</span><input className="input mono cx-amt" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))} /></label>
          <div className="field"><span>From</span><Select label="From" value={from} options={opts} onChange={setFrom} /></div>
          <button className="icon-btn cx-swap" aria-label="Swap" onClick={() => { setFrom(to); setTo(from); }}><Icon name="refresh" size={18} /></button>
          <div className="field"><span>To</span><Select label="To" value={to} options={opts} onChange={setTo} /></div>
        </div>
        <p className="cx-out"><span className="mono">{n.toLocaleString()} {from} =</span><b className="mono">{result.toLocaleString(undefined, { maximumFractionDigits: 2 })} {to}</b></p>
        <p className="hint">At bank rates (you sell {from === 'NPR' ? 'rupees' : from}, the bank sells you {to === 'NPR' ? 'rupees' : to}). Middle rate: <span className="mono">{midResult.toLocaleString(undefined, { maximumFractionDigits: 2 })} {to}</span>. Nepal Rastra Bank, {fx.date}.</p>
        <div className="tp-chips">{POPULAR.filter((c) => fx.rates[c]).slice(0, 8).map((c) => <button key={c} className="chip" onClick={() => { setFrom(c); setTo('NPR'); }}>{c} → NPR</button>)}</div>
      </section>
      <section className="tp-card">
        <h2>Today's rates for 1 unit</h2>
        <table className="cx-table"><thead><tr><th>Currency</th><th>Buying</th><th>Selling</th></tr></thead>
          <tbody>{codes.filter((c) => c !== 'NPR').map((c) => <tr key={c}><td><b>{c}</b> <small>{fx.rates[c].name}</small></td><td className="mono">{fx.rates[c].buy.toFixed(fx.rates[c].buy < 1 ? 4 : 2)}</td><td className="mono">{fx.rates[c].sell.toFixed(fx.rates[c].sell < 1 ? 4 : 2)}</td></tr>)}</tbody></table>
      </section>
    </div>
  );
}

/* ---------------- fancy fonts ---------------- */
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', a = 'abcdefghijklmnopqrstuvwxyz', D = '0123456789';
const cp = (n: number) => String.fromCodePoint(n);
function alpha(up: number, low: number, dig?: number, ex: Record<string, string> = {}) {
  return (s: string) => [...s].map((ch) => ex[ch] ?? (A.includes(ch) ? cp(up + A.indexOf(ch)) : a.includes(ch) ? cp(low + a.indexOf(ch)) : dig && D.includes(ch) ? cp(dig + D.indexOf(ch)) : ch)).join('');
}
const combine = (mark: string) => (s: string) => [...s].map((c) => (c === ' ' ? c : c + mark)).join('');
const SMALL = 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ', FLIP = 'ɐqɔpǝɟƃɥᴉɾʞlɯuodbɹsʇnʌʍxʎz';
const FONTS: [string, (s: string) => string][] = [
  ['Bold', alpha(0x1d400, 0x1d41a, 0x1d7ce)],
  ['Italic', alpha(0x1d434, 0x1d44e, undefined, { h: 'ℎ' })],
  ['Bold italic', alpha(0x1d468, 0x1d482)],
  ['Sans bold', alpha(0x1d5d4, 0x1d5ee, 0x1d7ec)],
  ['Sans italic', alpha(0x1d608, 0x1d622)],
  ['Script', alpha(0x1d49c, 0x1d4b6, undefined, { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ' })],
  ['Bold script', alpha(0x1d4d0, 0x1d4ea)],
  ['Gothic', alpha(0x1d504, 0x1d51e, undefined, { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' })],
  ['Bold gothic', alpha(0x1d56c, 0x1d586)],
  ['Double-struck', alpha(0x1d538, 0x1d552, 0x1d7d8, { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' })],
  ['Monospace', alpha(0x1d670, 0x1d68a, 0x1d7f6)],
  ['Circled', alpha(0x24b6, 0x24d0, undefined, { 0: '⓪', ...Object.fromEntries([...'123456789'].map((d, i) => [d, cp(0x2460 + i)])) })],
  ['Squared', (s) => alpha(0x1f130, 0x1f130)(s.toUpperCase())],
  ['Wide', (s) => [...s].map((c) => (c === ' ' ? '　' : c >= '!' && c <= '~' ? cp(c.charCodeAt(0) + 0xfee0) : c)).join('')],
  ['Small caps', (s) => [...s.toLowerCase()].map((c) => (a.includes(c) ? SMALL[a.indexOf(c)] : c)).join('')],
  ['Upside down', (s) => [...s.toLowerCase()].reverse().map((c) => (a.includes(c) ? FLIP[a.indexOf(c)] : c)).join('')],
  ['Strikethrough', combine('̶')],
  ['Underline', combine('̲')],
];
export function FancyFonts() {
  const [t, setT] = useState(() => { try { return localStorage.getItem('jhino-fonts') || 'Photo studio in Kathmandu'; } catch { return 'Photo studio in Kathmandu'; } });
  useEffect(() => { try { localStorage.setItem('jhino-fonts', t); } catch { /* private mode */ } }, [t]);
  return (
    <div className="ff">
      <textarea className="textarea ff-in" rows={2} maxLength={300} value={t} onChange={(e) => setT(e.target.value)} placeholder="Type your bio, name or caption" aria-label="Your text" />
      <ul className="ff-list">{FONTS.map(([n, f]) => { const out = f(t); return (
        <li key={n}><small>{n}</small><span className="ff-out">{out || ' '}</span><CopyBtn text={out} /></li>
      ); })}</ul>
      <p className="hint">These are Unicode letters, so they paste into Instagram, TikTok, WhatsApp and X bios, names and captions. Screen readers may read them oddly, so keep important words plain.</p>
    </div>
  );
}

/* ---------------- youtube thumbnails ---------------- */
const SIZES: [string, string, string][] = [['maxresdefault', 'Full HD', '1280×720'], ['sddefault', 'Standard', '640×480'], ['hqdefault', 'High', '480×360'], ['mqdefault', 'Medium', '320×180']];
export function Thumbnails() {
  const [url, setUrl] = useState('');
  const [bad, setBad] = useState<string[]>([]);
  const id = /(?:youtu\.be\/|[?&]v=|shorts\/|embed\/|live\/)([\w-]{11})/.exec(url)?.[1] ?? (/^[\w-]{11}$/.test(url.trim()) ? url.trim() : null);
  useEffect(() => setBad([]), [id]);
  return (
    <div className="th">
      <input className="input th-in" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a YouTube or Shorts link" aria-label="YouTube link" autoFocus />
      {!url ? <p className="tp-empty">Paste a link to see and save the video's thumbnail in every size.</p> : !id ? <p className="tp-empty">That doesn't look like a YouTube link.</p> : (
        <ul className="th-grid">{SIZES.filter(([q]) => !bad.includes(q)).map(([q, n, dim], k) => (
          <li key={q} className={`tp-card ${k === 0 ? 'big' : ''}`}>
            <img src={`https://i.ytimg.com/vi/${id}/${q}.jpg`} alt={`${n} thumbnail`} onLoad={(e) => { if ((e.target as HTMLImageElement).naturalWidth <= 120) setBad((b) => [...b, q]); }} onError={() => setBad((b) => [...b, q])} />
            <div className="tp-row"><span className="ha-t"><b>{n}</b><small className="mono">{dim}</small></span><a className="btn sm primary" href={`/api/yt-thumb/${id}/${q}`} download><Icon name="download" size={15} />Save</a></div>
          </li>
        ))}</ul>
      )}
      <p className="hint">Use thumbnails with credit to the creator.</p>
    </div>
  );
}

/* ---------------- giveaway picker ---------------- */
const rnd = (n: number) => { const x = new Uint32Array(1); crypto.getRandomValues(x); return x[0] % n; };
const COLOURS = ['#141414', '#e6e4df', '#4b4a47', '#efeeeb', '#75736e', '#ffffff'];
export function Picker() {
  const [raw, setRaw] = useState(() => { try { return localStorage.getItem('jhino-picker') ?? ''; } catch { return ''; } });
  const [dedupe, setDedupe] = useState(true), [count, setCount] = useState(1), [exclude, setExclude] = useState(true);
  const [winners, setWinners] = useState<string[]>([]);
  const [angle, setAngle] = useState(0), [spinning, setSpinning] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { try { localStorage.setItem('jhino-picker', raw.slice(0, 50000)); } catch { /* private mode */ } }, [raw]);
  const names = useMemo(() => { const l = raw.split(/\n|,/).map((x) => x.trim().replace(/^@/, '@')).filter(Boolean); return dedupe ? [...new Map(l.map((x) => [x.toLowerCase(), x])).values()] : l; }, [raw, dedupe]);
  const pool = exclude ? names.filter((n) => !winners.includes(n)) : names;
  useEffect(() => {
    const c = canvas.current; if (!c) return; const x = c.getContext('2d')!, r = c.width / 2, n = Math.max(1, pool.length);
    x.clearRect(0, 0, c.width, c.height);
    for (let i = 0; i < n; i++) {
      const s = (i / n) * Math.PI * 2 - Math.PI / 2, e = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
      // Four shades in turn; the last slice gets its own when it would sit next to the same shade.
      const ci = i === n - 1 && n > 1 && (n - 1) % 4 === 0 ? 5 : i % 4;
      x.beginPath(); x.moveTo(r, r); x.arc(r, r, r - 2, s, e); x.closePath(); x.fillStyle = pool.length ? COLOURS[ci] : '#efeeeb'; x.fill();
      x.strokeStyle = '#cfccc5'; x.lineWidth = 1; x.stroke();
      if (pool.length && n <= 60) { x.save(); x.translate(r, r); x.rotate((s + e) / 2); x.textAlign = 'right'; x.fillStyle = ['#141414', '#4b4a47', '#75736e'].includes(COLOURS[ci]) ? '#fff' : '#141414'; x.font = `600 ${n > 30 ? 11 : 14}px ${getComputedStyle(document.body).fontFamily}`; x.fillText(pool[i].slice(0, 18), r - 14, 5); x.restore(); }
    }
  }, [pool]);
  const spin = () => {
    if (!pool.length || spinning) return;
    const pick = rnd(pool.length), n = pool.length;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The pointer is at the top: turn so the middle of the winner's slice ends under it.
    const target = 360 * (reduce ? 0 : 6) + (360 - ((pick + 0.5) / n) * 360);
    setSpinning(true); setAngle((a0) => a0 - (a0 % 360) + target);
    setTimeout(() => {
      const extra: string[] = []; const left = pool.filter((_, i) => i !== pick);
      for (let k = 1; k < count && left.length; k++) extra.push(left.splice(rnd(left.length), 1)[0]);
      setWinners((w) => [...w, pool[pick], ...extra]); setSpinning(false);
    }, reduce ? 50 : 4600);
  };
  return (
    <div className="pk">
      <section className="tp-card">
        <label className="field"><span>Names or comments <em>{names.length} entries</em></span>
          <textarea className="textarea" rows={10} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={'One per line, or separated by commas\n@asha\n@bikash\n@sita'} /></label>
        <div className="pk-opts">
          <label className="tp-toggle"><input type="checkbox" checked={dedupe} onChange={(e) => setDedupe(e.target.checked)} /><i aria-hidden="true" /><span>One entry per person</span></label>
          <label className="tp-toggle"><input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} /><i aria-hidden="true" /><span>Winners can't win again</span></label>
          <label className="field sm"><span>Winners per spin</span><input className="input mono" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} /></label>
        </div>
      </section>
      <section className="tp-card pk-wheel-card">
        <div className="pk-wheel">
          <span className="pk-pointer" aria-hidden="true" />
          <canvas ref={canvas} width={420} height={420} style={{ transform: `rotate(${angle}deg)` }} className={spinning ? 'spinning' : ''} aria-label="Wheel" />
        </div>
        <button className="btn primary lg" onClick={spin} disabled={!pool.length || spinning}>{spinning ? 'Spinning…' : pool.length ? 'Spin' : 'Add names first'}</button>
        {!!winners.length && <div className="pk-win">
          <h2>Winners</h2>
          <ol>{winners.map((w, i) => <li key={i} className={i >= winners.length - count && !spinning ? 'new' : ''}>{w}</li>)}</ol>
          <div className="actions-row"><CopyBtn text={winners.map((w, i) => `${i + 1}. ${w}`).join('\n')} /><button className="btn sm quiet" onClick={() => setWinners([])}>Start over</button></div>
        </div>}
        <p className="hint">Picked with your device's secure random numbers, so every entry has the same chance.</p>
      </section>
    </div>
  );
}

/* ---------------- EMI ---------------- */
export function Emi() {
  const [p, setP] = useState('2500000'), [r, setR] = useState('11.5'), [t, setT] = useState('5'), [unit, setUnit] = useState<'y' | 'm'>('y');
  const P = Number(p) || 0, R = (Number(r) || 0) / 1200, N = Math.round((Number(t) || 0) * (unit === 'y' ? 12 : 1));
  const emi = N ? (R ? (P * R * (1 + R) ** N) / ((1 + R) ** N - 1) : P / N) : 0;
  const total = emi * N, interest = total - P;
  const years = useMemo(() => {
    const out: { y: number; pr: number; in: number; bal: number }[] = []; let bal = P;
    for (let m = 1; m <= N; m++) { const i = bal * R, pr = emi - i; bal = Math.max(0, bal - pr); const y = Math.ceil(m / 12); if (!out[y - 1]) out[y - 1] = { y, pr: 0, in: 0, bal: 0 }; out[y - 1].pr += pr; out[y - 1].in += i; out[y - 1].bal = bal; }
    return out;
  }, [P, R, N, emi]);
  const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`;
  return (
    <div className="tp-split emi">
      <section className="tp-card tp-sticky">
        <label className="field"><span>Loan amount (Rs)</span><input className="input mono" inputMode="numeric" value={p} onChange={(e) => setP(e.target.value.replace(/\D/g, ''))} /></label>
        <input type="range" min={10000} max={50000000} step={10000} value={P} onChange={(e) => setP(e.target.value)} aria-label="Loan amount" />
        <label className="field"><span>Interest rate (% a year)</span><input className="input mono" inputMode="decimal" value={r} onChange={(e) => setR(e.target.value.replace(/[^\d.]/g, ''))} /></label>
        <input type="range" min={1} max={24} step={0.25} value={Number(r) || 0} onChange={(e) => setR(e.target.value)} aria-label="Interest rate" />
        <div className="field"><span>Time</span><div className="tp-inline"><input className="input mono" inputMode="numeric" value={t} onChange={(e) => setT(e.target.value.replace(/[^\d.]/g, ''))} />
          <div className="tp-seg">{([['y', 'Years'], ['m', 'Months']] as const).map(([v, l]) => <button key={v} aria-pressed={unit === v} onClick={() => setUnit(v)}>{l}</button>)}</div></div></div>
        <div className="tp-chips">{[['Home', '5000000', '10.5', '20'], ['Car', '3000000', '12', '7'], ['Bike', '300000', '14', '3'], ['Education', '1500000', '11', '10']].map(([n, a0, r0, t0]) => <button key={n} className="chip" onClick={() => { setP(a0); setR(r0); setT(t0); setUnit('y'); }}>{n} loan</button>)}</div>
      </section>
      <section className="tp-card">
        <p className="emi-big"><small>Monthly payment (EMI)</small><b className="mono">{rs(emi)}</b></p>
        <div className="emi-split" aria-hidden="true"><i style={{ transform: `scaleX(${total ? P / total : 1})` }} /></div>
        <div className="sb-sum emi-sum">
          <div><small>Borrowed</small><b className="mono">{rs(P)}</b></div>
          <div><small>Total interest</small><b className="mono">{rs(interest)}</b></div>
          <div><small>Total you pay</small><b className="mono">{rs(total)}</b></div>
        </div>
        <h2>Year by year</h2>
        <div className="emi-table"><table className="cx-table"><thead><tr><th>Year</th><th>Principal</th><th>Interest</th><th>Left to pay</th></tr></thead>
          <tbody>{years.map((y) => <tr key={y.y}><td className="mono">{y.y}</td><td className="mono">{rs(y.pr)}</td><td className="mono">{rs(y.in)}</td><td className="mono">{rs(y.bal)}</td></tr>)}</tbody></table></div>
        <p className="hint">Reducing-balance method, the one Nepali banks use for EMI loans. Your bank's fees and rate changes are not included.</p>
      </section>
    </div>
  );
}
