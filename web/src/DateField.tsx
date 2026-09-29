import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { BS_MONTHS, adToBs, localIso } from './bs';
import { Icon } from './ui';
import './datefield.css';

/*
 * Designed date and time pickers, used everywhere instead of the browser's own (which look different in
 * every browser). Values match the native inputs: date "YYYY-MM-DD", time "HH:MM", date and time
 * "YYYY-MM-DDTHH:MM". The Nepali (BS) date shows beside the English one. The popup floats above
 * everything (fixed), so a dialog's edge or a scrolling panel never cuts it off.
 */
const WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const parse = (v: string) => { const [y, m, d] = v.split('-').map(Number); return y ? new Date(y, m - 1, d) : null; };
const bsLabel = (v: string) => { const b = adToBs(v); return b ? `${b.d} ${BS_MONTHS[b.m]} ${b.y}` : ''; };
const pad = (n: number) => String(n).padStart(2, '0');
const timeLabel = (t: string) => { const [h, m] = t.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };

function usePopup(wrap: RefObject<HTMLDivElement | null>, h: number, w: number) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!open) return;
    const r = wrap.current?.getBoundingClientRect();
    if (r) { const below = r.bottom + 6; setPos({ top: below + h > innerHeight && r.top - h - 6 > 8 ? r.top - h - 6 : Math.min(below, Math.max(8, innerHeight - h - 8)), left: Math.max(8, Math.min(r.left, innerWidth - w - 8)) }); }
    const close = () => setOpen(false);
    const out = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setOpen(false); } };
    const scroll = (e: Event) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', out); document.addEventListener('keydown', key, true);
    addEventListener('resize', close); addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('pointerdown', out); document.removeEventListener('keydown', key, true); removeEventListener('resize', close); removeEventListener('scroll', scroll, true); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return { open, setOpen, style: { top: pos.top, left: pos.left } };
}

function Trigger({ icon, label, open, onClick, empty, children, compact }: { icon: string; label: string; open: boolean; onClick: () => void; empty: boolean; children: ReactNode; compact?: boolean }) {
  return (
    <button type="button" className={`input df-btn ${empty ? 'empty' : ''} ${compact ? 'compact' : ''}`} aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={onClick}>
      <Icon name={icon} size={16} /><span>{children}</span><Icon name="down" size={14} />
    </button>
  );
}

export function DateField({ value, onChange, label, required, placeholder = 'Pick a date', min, max, compact }: { value: string; onChange: (v: string) => void; label: string; required?: boolean; placeholder?: string; min?: string; max?: string; compact?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const { open, setOpen, style } = usePopup(wrap, 340, 292);
  const cur = parse(value);
  const [view, setView] = useState(() => { const d = cur ?? new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  useEffect(() => { if (open) { const d = parse(value) ?? new Date(); setView(new Date(d.getFullYear(), d.getMonth(), 1)); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = view.getDay(), days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const today = localIso(new Date());
  const ok = (iso: string) => (!min || iso >= min) && (!max || iso <= max);
  const set = (iso: string) => { if (ok(iso)) { onChange(iso); setOpen(false); } };
  const move = (by: number) => setView((v) => new Date(v.getFullYear(), v.getMonth() + by, 1));
  return (
    <div className="df" ref={wrap}>
      <Trigger icon="calendar" label={label} open={open} empty={!cur} compact={compact} onClick={() => setOpen(!open)}>
        {cur ? <>{cur.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}{!compact && <small>{bsLabel(value)}</small>}</> : placeholder}
      </Trigger>
      {required && <input className="df-req" tabIndex={-1} aria-hidden="true" required value={value} onChange={() => {}} />}
      {open && (
        <div className="df-pop" role="dialog" aria-label={label} style={style}>
          <div className="df-head">
            <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => move(-1)}><Icon name="back" size={16} /></button>
            <b>{view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b>
            <button type="button" className="icon-btn df-next" aria-label="Next month" onClick={() => move(1)}><Icon name="back" size={16} /></button>
          </div>
          <div className="df-grid">
            {WEEK.map((w) => <span key={w} className="df-wk">{w}</span>)}
            {Array.from({ length: first }, (_, i) => <span key={`x${i}`} />)}
            {Array.from({ length: days }, (_, i) => {
              const iso = localIso(new Date(view.getFullYear(), view.getMonth(), i + 1));
              return <button type="button" key={iso} disabled={!ok(iso)} className={`df-day ${iso === value ? 'on' : ''} ${iso === today ? 'today' : ''}`} aria-pressed={iso === value} onClick={() => set(iso)}>{i + 1}</button>;
            })}
          </div>
          <div className="df-foot">
            <button type="button" className="btn sm quiet" disabled={!ok(today)} onClick={() => set(today)}>Today</button>
            <span className="df-quick">
              {([[1, '+1 mo'], [12, '+1 yr']] as const).map(([m, l]) => <button key={l} type="button" className="btn sm quiet" onClick={() => { const b = parse(value) ?? new Date(); set(localIso(new Date(b.getFullYear(), b.getMonth() + m, b.getDate()))); }}>{l}</button>)}
              {value && !required && <button type="button" className="btn sm quiet" onClick={() => { onChange(''); setOpen(false); }}>Clear</button>}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

const TIMES = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);
export function TimeField({ value, onChange, label, placeholder = 'Time', compact }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; compact?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { open, setOpen, style } = usePopup(wrap, 300, 200);
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!open) return; setTyped('');
    const on = list.current?.querySelector<HTMLElement>('.on') ?? list.current?.querySelector<HTMLElement>(`[data-t="${value || '09:00'}"]`);
    requestAnimationFrame(() => on?.scrollIntoView({ block: 'center' }));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromTyped = () => {
    const m = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/i.exec(typed.trim()); if (!m) return;
    let h = Number(m[1]); const mi = Number(m[2] ?? 0); const ap = m[3]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
    if (h < 24 && mi < 60) { onChange(`${pad(h)}:${pad(mi)}`); setOpen(false); }
  };
  return (
    <div className="df" ref={wrap}>
      <Trigger icon="clock" label={label} open={open} empty={!value} compact={compact} onClick={() => setOpen(!open)}>{value ? timeLabel(value) : placeholder}</Trigger>
      {open && (
        <div className="df-pop df-time" role="dialog" aria-label={label} style={style}>
          <input className="input" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fromTyped(); } }} placeholder="Type, like 7:45 pm" aria-label="Type a time" />
          <div className="df-times" ref={list}>{TIMES.map((t) => <button type="button" key={t} data-t={t} className={t === value ? 'on' : ''} onClick={() => { onChange(t); setOpen(false); }}>{timeLabel(t)}</button>)}</div>
        </div>
      )}
    </div>
  );
}

/** Date and time together; the value is "YYYY-MM-DDTHH:MM" (or "" when empty). */
export function DateTimeField({ value, onChange, label, compact }: { value: string; onChange: (v: string) => void; label: string; compact?: boolean }) {
  const [d, t] = value ? value.split('T') : ['', ''];
  return (
    <div className="dtf">
      <DateField label={`${label}: date`} compact={compact} placeholder="Date" value={d} onChange={(nd) => onChange(nd ? `${nd}T${t || '09:00'}` : '')} />
      <TimeField label={`${label}: time`} compact={compact} value={t} onChange={(nt) => onChange(`${d || localIso(new Date())}T${nt}`)} />
    </div>
  );
}
