import { useEffect, useRef, useState } from 'react';
import { BS_MONTHS, adToBs, localIso } from './bs';
import { Icon } from './ui';

/*
 * A designed date picker (the browser's own one looks different everywhere). The value is a local
 * YYYY-MM-DD string, like <input type="date">. The Nepali (BS) date shows under the English one.
 */
const WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const parse = (v: string) => { const [y, m, d] = v.split('-').map(Number); return y ? new Date(y, m - 1, d) : null; };
const bsLabel = (v: string) => { const b = adToBs(v); return b ? `${b.d} ${BS_MONTHS[b.m]} ${b.y}` : ''; };

export function DateField({ value, onChange, label, required, placeholder = 'Pick a date' }: { value: string; onChange: (v: string) => void; label: string; required?: boolean; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const cur = parse(value);
  const [view, setView] = useState(() => { const d = cur ?? new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const wrap = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  // The calendar floats above everything (fixed), so a dialog's edge or scroll never cuts it off.
  const place = () => {
    const r = wrap.current?.getBoundingClientRect(); if (!r) return;
    const h = 330, w = 292, below = r.bottom + 6;
    setPos({ top: below + h > innerHeight && r.top - h - 6 > 8 ? r.top - h - 6 : Math.min(below, Math.max(8, innerHeight - h - 8)), left: Math.max(8, Math.min(r.left, innerWidth - w - 8)) });
  };
  useEffect(() => {
    if (!open) return;
    place();
    const close = () => setOpen(false);
    addEventListener('resize', close); addEventListener('scroll', close, true);
    const d = parse(value) ?? new Date(); setView(new Date(d.getFullYear(), d.getMonth(), 1));
    const out = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setOpen(false); } };
    document.addEventListener('pointerdown', out); document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', out); document.removeEventListener('keydown', key, true); removeEventListener('resize', close); removeEventListener('scroll', close, true); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = view.getDay(), days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const today = localIso(new Date());
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const pick = (d: number) => { onChange(localIso(new Date(view.getFullYear(), view.getMonth(), d))); setOpen(false); };
  const move = (by: number) => setView((v) => new Date(v.getFullYear(), v.getMonth() + by, 1));
  return (
    <div className="df" ref={wrap}>
      <button type="button" className={`input df-btn ${value ? '' : 'empty'}`} aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="calendar" size={16} />
        <span>{cur ? cur.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : placeholder}{cur && <small>{bsLabel(value)}</small>}</span>
      </button>
      {required && <input className="df-req" tabIndex={-1} aria-hidden="true" required value={value} onChange={() => {}} />}
      {open && (
        <div className="df-pop" role="dialog" aria-label={label} style={{ top: pos.top, left: pos.left }}>
          <div className="df-head">
            <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => move(-1)}><Icon name="back" size={16} /></button>
            <b>{view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b>
            <button type="button" className="icon-btn df-next" aria-label="Next month" onClick={() => move(1)}><Icon name="back" size={16} /></button>
          </div>
          <div className="df-grid">
            {WEEK.map((w) => <span key={w} className="df-wk">{w}</span>)}
            {cells.map((d, i) => {
              if (!d) return <span key={`x${i}`} />;
              const iso = localIso(new Date(view.getFullYear(), view.getMonth(), d));
              return <button type="button" key={iso} className={`df-day ${iso === value ? 'on' : ''} ${iso === today ? 'today' : ''}`} aria-pressed={iso === value} onClick={() => pick(d)}>{d}</button>;
            })}
          </div>
          <div className="df-foot">
            <button type="button" className="btn sm quiet" onClick={() => { onChange(today); setOpen(false); }}>Today</button>
            <span className="df-quick">
              {[[1, '+1 mo'], [12, '+1 yr']].map(([m, l]) => <button key={l} type="button" className="btn sm quiet" onClick={() => { const b = parse(value) ?? new Date(); onChange(localIso(new Date(b.getFullYear(), b.getMonth() + (m as number), b.getDate()))); setOpen(false); }}>{l}</button>)}
              {value && !required && <button type="button" className="btn sm quiet" onClick={() => { onChange(''); setOpen(false); }}>Clear</button>}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
