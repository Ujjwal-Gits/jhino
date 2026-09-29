import { useEffect, useMemo, useState } from 'react';
import { get } from './api';
import { BS_MONTHS, adToBs, bsDays, bsRange, bsToAd, bsToday, localIso } from './bs';
import { Link } from './context';
import { copyText, useToast } from './ui';

/*
 * The extra tools behind the rail's +. They all run in the browser (nothing typed here is sent anywhere),
 * except User lookup, which searches accounts for super admins.
 */

const Copy = ({ text, label = 'Copy' }: { text: string; label?: string }) => {
  const toast = useToast();
  return <button className="btn sm" disabled={!text} onClick={() => { copyText(text); toast('Copied'); }}>{label}</button>;
};

/* ---------- calculator (a small parser: the page's security policy forbids eval) ---------- */
function calc(src: string): number {
  const s = src.replace(/,/g, '').replace(/×/g, '*').replace(/÷/g, '/');
  let i = 0, lastPct = false;
  const peek = () => s[i], skip = () => { while (s[i] === ' ') i++; };
  const num = (): number => {
    skip(); lastPct = false;
    if (peek() === '(') { i++; const v = expr(); skip(); if (s[i++] !== ')') throw new Error('Missing )'); return pct(v); }
    if (peek() === '-') { i++; return -num(); }
    const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(s.slice(i));
    if (!m) throw new Error('Check the numbers');
    i += m[0].length; return pct(Number(m[0]));
  };
  const pct = (v: number) => { skip(); if (peek() === '%') { i++; lastPct = true; return v / 100; } return v; };
  const term = (): number => { let v = num(); for (;;) { skip(); const c = peek(); if (c !== '*' && c !== '/') return v; i++; const r = num(); v = c === '*' ? v * r : v / r; } };
  const expr = (): number => { let v = term(); for (;;) { skip(); const c = peek(); if (c !== '+' && c !== '-') return v; i++; let r = term(); if (lastPct) r = v * r; v = c === '+' ? v + r : v - r; } }; // 100 + 13% = 113
  const v = expr(); skip();
  if (i < s.length) throw new Error('Check the sum');
  if (!Number.isFinite(v)) throw new Error('Cannot divide by zero');
  return v;
}
const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 6 });
export function Calculator() {
  const [x, setX] = useState('');
  const [hist, setHist] = useState<string[]>([]);
  let out = '', err = '';
  try { out = x.trim() ? fmt(calc(x)) : ''; } catch (e) { err = (e as Error).message; }
  const val = () => { try { return calc(x); } catch { return NaN; } };
  const keys = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '%', '+'];
  return (
    <>
      <input className="input mono qt-calc-in" placeholder="12500 * 3 + 13%" value={x} onChange={(e) => setX(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && out) { setHist([`${x} = ${out}`, ...hist].slice(0, 6)); setX(String(val())); } }} aria-label="Sum" />
      <p className={`qt-calc-out mono ${err && x.trim() ? 'err' : ''}`} aria-live="polite">{x.trim() ? (err || `= ${out}`) : 'Type a sum, or use the keys.'}</p>
      <div className="qt-keys">{keys.map((k) => <button key={k} className="btn" onClick={() => setX(x + k)}>{k === '*' ? '×' : k === '/' ? '÷' : k}</button>)}</div>
      <div className="qt-row">
        <button className="btn sm" onClick={() => setX(x.slice(0, -1))}>Back</button>
        <button className="btn sm" onClick={() => setX('')}>Clear</button>
        <button className="btn primary sm" disabled={!out} onClick={() => { setHist([`${x} = ${out}`, ...hist].slice(0, 6)); setX(String(val())); }}>=</button>
      </div>
      <div className="qt-row">
        <button className="btn sm" disabled={!out} onClick={() => setX(String(Math.round(val() * 1.13 * 100) / 100))}>Add 13% VAT</button>
        <button className="btn sm" disabled={!out} onClick={() => setX(String(Math.round((val() / 1.13) * 100) / 100))}>Remove 13% VAT</button>
        <Copy text={out} />
      </div>
      {hist.length > 0 && <ul className="qt-hist mono">{hist.map((h, i) => <li key={i}>{h}</li>)}</ul>}
    </>
  );
}

/* ---------- Nepali date (BS ⇄ AD) ---------- */
export function NepaliDate() {
  const [ad, setAd] = useState(localIso(new Date()));
  const today = adToBs(localIso(new Date()));
  const [b, setB] = useState(today ?? { y: 2083, m: 0, d: 1 });
  const bs = adToBs(ad);
  const adOut = bsToAd(b.y, b.m, b.d);
  const long = (iso: string) => new Date(iso + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const years = Array.from({ length: bsRange.to - bsRange.from + 1 }, (_, n) => bsRange.from + n);
  return (
    <>
      <p className="qt-big">Today is <b>{bsToday()}</b><small>{long(localIso(new Date()))}</small></p>
      <h3 className="qt-sub">AD to BS</h3>
      <input className="input" type="date" value={ad} onChange={(e) => setAd(e.target.value)} aria-label="AD date" />
      <p className="qt-res">{bs ? <><b>{bs.d} {BS_MONTHS[bs.m]} {bs.y}</b><Copy text={`${bs.d} ${BS_MONTHS[bs.m]} ${bs.y}`} /></> : `Pick a date between ${bsRange.from - 57} and ${bsRange.to - 57}.`}</p>
      <h3 className="qt-sub">BS to AD</h3>
      <div className="qt-row">
        <select className="input" aria-label="BS year" value={b.y} onChange={(e) => setB({ ...b, y: +e.target.value, d: Math.min(b.d, bsDays(+e.target.value, b.m)) })}>{years.map((y) => <option key={y}>{y}</option>)}</select>
        <select className="input" aria-label="BS month" value={b.m} onChange={(e) => setB({ ...b, m: +e.target.value, d: Math.min(b.d, bsDays(b.y, +e.target.value)) })}>{BS_MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}</select>
        <select className="input" aria-label="BS day" value={b.d} onChange={(e) => setB({ ...b, d: +e.target.value })}>{Array.from({ length: bsDays(b.y, b.m) }, (_, n) => <option key={n}>{n + 1}</option>)}</select>
      </div>
      <p className="qt-res">{adOut ? <><b>{long(adOut)}</b><Copy text={adOut} /></> : 'Not in the calendar table.'}</p>
      <p className="qt-hint">Covers {bsRange.from} to {bsRange.to} BS, the same calendar the apps use.</p>
    </>
  );
}

/* ---------- password generator ---------- */
export function Passwords() {
  const [len, setLen] = useState(16);
  const [opt, setOpt] = useState({ upper: true, digits: true, symbols: true });
  const [seed, setSeed] = useState(0);
  const pw = useMemo(() => {
    let set = 'abcdefghijkmnopqrstuvwxyz' + (opt.upper ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : '') + (opt.digits ? '23456789' : '') + (opt.symbols ? '!@#$%^&*-_=+?' : '');
    const r = new Uint32Array(len); crypto.getRandomValues(r);
    return Array.from(r, (n) => set[n % set.length]).join('');
  }, [len, opt, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const bits = Math.round(len * Math.log2(25 + (opt.upper ? 24 : 0) + (opt.digits ? 8 : 0) + (opt.symbols ? 13 : 0)));
  return (
    <>
      <p className="qt-pw mono">{pw}</p>
      <div className="qt-row"><button className="btn primary sm" onClick={() => setSeed(seed + 1)}>New password</button><Copy text={pw} /></div>
      <label className="field sm"><span>Length: {len}</span><input type="range" min={8} max={64} value={len} onChange={(e) => setLen(+e.target.value)} /></label>
      {([['upper', 'Capital letters'], ['digits', 'Numbers'], ['symbols', 'Symbols']] as const).map(([k, l]) => (
        <label key={k} className="check-row"><input type="checkbox" checked={opt[k]} onChange={(e) => setOpt({ ...opt, [k]: e.target.checked })} />{l}</label>
      ))}
      <p className="qt-hint">{bits >= 80 ? 'Very strong' : bits >= 60 ? 'Strong' : 'Fair'} ({bits} bits). Made in your browser; similar-looking letters are left out.</p>
    </>
  );
}

/* ---------- world clock ---------- */
const ZONES: [string, string][] = [['Kathmandu', 'Asia/Kathmandu'], ['New Delhi', 'Asia/Kolkata'], ['Dubai', 'Asia/Dubai'], ['Doha', 'Asia/Qatar'], ['London', 'Europe/London'], ['New York', 'America/New_York'], ['Sydney', 'Australia/Sydney'], ['Tokyo', 'Asia/Tokyo'], ['UTC', 'UTC']];
export function WorldClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);
  const ktm = (d: Date) => new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' })).getTime();
  return (
    <ul className="qt-list">{ZONES.map(([n, z]) => {
      const diff = Math.round((new Date(now.toLocaleString('en-US', { timeZone: z })).getTime() - ktm(now)) / 36e5 * 4) / 4;
      return (
        <li key={z}>
          <div className="qt-li-main"><b>{n}</b><small>{now.toLocaleDateString(undefined, { timeZone: z, weekday: 'short', day: 'numeric', month: 'short' })}{z !== 'Asia/Kathmandu' ? ` · ${diff >= 0 ? '+' : ''}${diff} h from Kathmandu` : ''}</small></div>
          <span className="mono qt-clock">{now.toLocaleTimeString(undefined, { timeZone: z, hour: '2-digit', minute: '2-digit' })}</span>
        </li>
      );
    })}</ul>
  );
}

/* ---------- JSON ---------- */
export function JsonTool() {
  const [t, setT] = useState('');
  const [err, setErr] = useState('');
  const run = (space: number) => { try { setT(JSON.stringify(JSON.parse(t), null, space)); setErr(''); } catch (e) { setErr((e as Error).message); } };
  return (
    <>
      <textarea className="textarea mono" rows={12} placeholder='{"paste": "JSON here"}' value={t} onChange={(e) => { setT(e.target.value); setErr(''); }} spellCheck={false} />
      {err ? <p className="error-text">{err}</p> : t && <p className="qt-hint">{(() => { try { JSON.parse(t); return 'Valid JSON.'; } catch { return 'Not valid JSON yet.'; } })()}</p>}
      <div className="qt-row"><button className="btn primary sm" disabled={!t} onClick={() => run(2)}>Format</button><button className="btn sm" disabled={!t} onClick={() => run(0)}>Minify</button><Copy text={t} /></div>
    </>
  );
}

/* ---------- encode / decode ---------- */
const b64e = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const b64d = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0)));
export function Encoder() {
  const [t, setT] = useState('');
  const [err, setErr] = useState('');
  const run = (f: (s: string) => string) => { try { setT(f(t)); setErr(''); } catch { setErr('That text cannot be decoded this way.'); } };
  return (
    <>
      <textarea className="textarea mono" rows={8} value={t} onChange={(e) => { setT(e.target.value); setErr(''); }} spellCheck={false} placeholder="Text, a link or Base64" />
      {err && <p className="error-text">{err}</p>}
      <div className="qt-grid2">
        <button className="btn sm" onClick={() => run(b64e)}>Base64 encode</button><button className="btn sm" onClick={() => run(b64d)}>Base64 decode</button>
        <button className="btn sm" onClick={() => run(encodeURIComponent)}>URL encode</button><button className="btn sm" onClick={() => run(decodeURIComponent)}>URL decode</button>
      </div>
      <div className="qt-row"><Copy text={t} /></div>
    </>
  );
}

/* ---------- colour ---------- */
const hexToRgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const lum = ([r, g, b]: number[]) => { const f = (c: number) => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const ratio = (a: number, b: number) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
export function ColourTool() {
  const [c, setC] = useState('#e0461f');
  const [r, g, b] = hexToRgb(c);
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2, d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const hh = d === 0 ? 0 : mx === r / 255 ? ((g - b) / 255 / d) % 6 : mx === g / 255 ? (b - r) / 255 / d + 2 : (r - g) / 255 / d + 4;
  const hsl = `hsl(${Math.round((hh * 60 + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  const L = lum([r, g, b]);
  const rows: [string, string][] = [['HEX', c.toUpperCase()], ['RGB', `rgb(${r}, ${g}, ${b})`], ['HSL', hsl]];
  return (
    <>
      <div className="qt-swatch" style={{ background: c }}><input type="color" value={c} onChange={(e) => setC(e.target.value)} aria-label="Pick a colour" /></div>
      <input className="input mono" value={c} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) ? setC(e.target.value.toLowerCase()) : undefined} aria-label="HEX colour" />
      <ul className="qt-list">{rows.map(([k, v]) => <li key={k}><div className="qt-li-main"><b className="mono">{v}</b><small>{k}</small></div><Copy text={v} /></li>)}</ul>
      <p className="qt-hint">Contrast with white text {ratio(L, 1).toFixed(1)}:1, with black {ratio(L, 0).toFixed(1)}:1. {ratio(L, 1) >= 4.5 ? 'White text reads well.' : ratio(L, 0) >= 4.5 ? 'Use dark text on it.' : 'Use large text only.'}</p>
    </>
  );
}

/* ---------- user lookup (super admins) ---------- */
export function UserLookup() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<{ id: string; name: string; email: string; username: string | null; status: string; role: string; usage: { planName: string } | null }[] | null>(null);
  useEffect(() => {
    const s = q.trim(); if (s.length < 2) { setRows(null); return; }
    const t = setTimeout(() => get<{ users: any[] }>(`/api/admin/users?q=${encodeURIComponent(s)}`).then((r) => setRows(r.users.slice(0, 12)), () => setRows([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <>
      <input className="input" placeholder="Name, email or ID" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Find a user" />
      {rows === null ? <p className="qt-empty">Type at least two letters.</p> : !rows.length ? <p className="qt-empty">Nobody matches.</p> : (
        <ul className="qt-list">{rows.map((u) => (
          <li key={u.id}>
            <Link to={`/admin/users/${u.id}`} className="qt-li-main"><b>{u.name}{u.username ? ` · @${u.username}` : ''}</b><small>{u.email} · {u.role === 'super_admin' ? 'Super admin' : u.role === 'client' ? 'Client sign-in' : u.usage?.planName ?? 'Creator'}{u.status === 'suspended' ? ' · suspended' : ''}</small></Link>
            <Copy text={u.email} label="Email" />
          </li>
        ))}</ul>
      )}
    </>
  );
}
