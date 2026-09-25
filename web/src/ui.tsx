import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/* ---------- icons: a small drawn set, one stroke weight ---------- */
const PATHS: Record<string, string> = {
  back: 'M15 5l-7 7 7 7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.2-4.2',
  list: 'M4 6h16M4 12h16M4 18h16',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  upload: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  close: 'M6 6l12 12M18 6 6 18',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  check: 'M5 12.5l4.5 4.5L19 7',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8v.01',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  plus: 'M12 5v14M5 12h14',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  blocks: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 16.5h7M16.5 13v7',
  live: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8',
  key: 'M14 10a4 4 0 1 0-3.5 4L9 15.5V18H6.5v2H4v-3l6-6M15 7h.01',
  desktop: 'M4 5h16v11H4zM9 20h6M12 16v4',
  phone: 'M8 3h8v18H8zM11.5 17.5h1',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18.5 20a6.5 6.5 0 0 0-3-5.5',
  shield: 'M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6zM9 12l2 2 4-4',
  card: 'M3 6h18v12H3zM3 10h18M7 15h4',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.5v.01',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M13 5v4M9 15v4',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.5 9h17M3.5 15h17M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M4 19h16',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 5l12 7-12 7z',
  spark: 'M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  audit: 'M8 4h10v16H6V6zM8 4v2H6M9 10h6M9 14h6M9 18h3',
  rotate: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  zoomIn: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.2-4.2M11 8v6M8 11h6',
  zoomOut: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.2-4.2M8 11h6',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2',
};
export function Icon({ name, size }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="svg" viewBox="0 0 24 24" aria-hidden="true" style={size ? { width: size, height: size } : undefined}>
      <path d={PATHS[name] ?? PATHS.info} strokeWidth={name === 'more' ? 3 : undefined} />
    </svg>
  );
}

export const initials = (name: string) => {
  const words = (name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return (words.map((w) => w[0]).join('').slice(0, 2) || '?').toUpperCase();
};

/** Initials, or the person's photo when there is one (falls back to initials if it cannot load). */
export function Avatar({ name, size, src }: { name: string; size?: 'sm' | 'lg'; src?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) return <span className={`avatar has-img ${size ?? ''}`} title={name} aria-hidden="true"><img src={src} alt="" onError={() => setFailed(true)} /></span>;
  return <span className={`avatar ${size ?? ''}`} title={name} aria-hidden="true">{initials(name)}</span>;
}

/** App monogram: two letters in a hairline square. */
export function Mark({ name, large }: { name: string; large?: boolean }) {
  const letters = name.replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/);
  const t = letters.length > 1 ? letters[0][0] + letters[1][0] : (letters[0] || '?').slice(0, 2);
  return <span className={`mark ${large ? 'lg' : ''}`} aria-hidden="true">{t.toUpperCase()}</span>;
}

/* ---------- time ---------- */
export function ago(iso: string | null | undefined) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: s > 31536000 ? 'numeric' : undefined });
}
export const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

/* ---------- modal (native dialog: focus trap and Esc for free) ---------- */
export function Modal({ title, onClose, children, footer, wide, panel }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; panel?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    const onCancel = (e: Event) => { e.preventDefault(); onClose(); };
    d.addEventListener('cancel', onCancel);
    return () => d.removeEventListener('cancel', onCancel);
  }, [onClose]);
  return (
    <dialog
      ref={ref}
      className={panel ? 'panel' : `modal ${wide ? 'wide' : ''}`}
      aria-label={title}
      onMouseDown={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
      {children}
      {footer && <div className="modal-foot">{footer}</div>}
    </dialog>
  );
}

/* ---------- menu anchored to a button ---------- */
export function Menu({ anchor, onClose, children }: { anchor: HTMLElement; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const w = ref.current?.offsetWidth ?? 220;
    const hgt = ref.current?.offsetHeight ?? 0;
    // Near the bottom of the window (for example the corner button of a bare app), open upwards.
    const below = window.innerHeight - r.bottom - 12;
    const top = hgt > below && r.top - hgt - 6 > 8 ? r.top - hgt - 6 : r.bottom + 6;
    setPos({ top, left: Math.max(8, Math.min(r.left < w ? r.left : r.right - w, window.innerWidth - w - 8)) });
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [anchor]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); anchor.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        e.preventDefault();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [anchor, onClose]);
  return <div className="menu" role="menu" ref={ref} style={pos} onClick={(e) => { if ((e.target as HTMLElement).closest('button')) onClose(); }}>{children}</div>;
}

/* ---------- toasts ---------- */
type Toast = { id: number; text: string; error?: boolean };
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, error?: boolean) => {
    const id = Math.random();
    setItems((x) => [...x.slice(-2), { id, text, error }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), error ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

/* ---------- a designed dropdown, used instead of the browser's select ---------- */
export interface SelectOption<T extends string> { value: T; label: string; hint?: string }
export function Select<T extends string>({ value, options, onChange, label, width, size, disabled }: {
  value: T; options: SelectOption<T>[]; onChange: (v: T) => void; label: string; width?: number | string; size?: 'sm'; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 640);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const cur = options.find((o) => o.value === value);
  const searchable = options.length > 12;
  const shown = searchable && q ? options.filter((o) => (o.label + ' ' + (o.hint ?? '')).toLowerCase().includes(q.toLowerCase())) : options;
  const close = useCallback((focus = true) => { setOpen(false); if (focus) btn.current?.focus(); }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useLayoutEffect(() => {
    if (!open || !btn.current || isMobile) return;
    const r = btn.current.getBoundingClientRect();
    const w = Math.max(r.width, 220);
    const h = Math.min(searchable ? 380 : 320, options.length * 40 + 12 + (searchable ? 48 : 0));
    const up = innerHeight - r.bottom < h + 12 && r.top > innerHeight - r.bottom;
    setPos({ top: up ? r.top - h - 6 : r.bottom + 6, left: Math.max(8, Math.min(r.left, innerWidth - w - 8)), width: Math.min(w, innerWidth - 16) });
  }, [open, options.length, isMobile, searchable]);

  useEffect(() => {
    if (open && !isMobile && pos) (searchRef.current ?? list.current)?.focus({ preventScroll: true });
    if (!open) setQ('');
  }, [open, pos, isMobile]);

  // Lock body scroll when mobile sheet is open
  useEffect(() => {
    if (!open || !isMobile) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = orig; };
  }, [open, isMobile]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) close(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    if (!isMobile) {
      const scroll = (e: Event) => {
        const t = e.target as Node;
        if (list.current && !list.current.contains(t) && t !== document) {
          // If outer scroll moves anchor button, reposition or close
          close(false);
        }
      };
      window.addEventListener('scroll', scroll, true);
      window.addEventListener('pointerdown', outside, true);
      window.addEventListener('keydown', key);
      return () => {
        window.removeEventListener('scroll', scroll, true);
        window.removeEventListener('pointerdown', outside, true);
        window.removeEventListener('keydown', key);
      };
    } else {
      window.addEventListener('keydown', key);
      return () => window.removeEventListener('keydown', key);
    }
  }, [open, isMobile, close]);

  const choose = (o: SelectOption<T>) => { close(); if (o.value !== value) onChange(o.value); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' || (e.key === ' ' && !searchable)) { e.preventDefault(); if (shown[active]) choose(shown[active]); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); }
  };

  const host = typeof document !== 'undefined' ? (btn.current?.closest('dialog') ?? document.body) : null;

  return (
    <>
      <button ref={btn} type="button" className={`dd ${size === 'sm' ? 'dd-sm' : ''}`} style={width ? { width } : undefined} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        onClick={() => { setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen((o) => !o); }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); } }}>
        <span className="dd-t">{cur?.label ?? 'Choose'}</span>
        <Icon name="down" size={15} />
      </button>

      {open && host && isMobile && createPortal(
        <div className="dd-sheet-root" role="dialog" aria-modal="true" aria-label={label}>
          <div className="dd-sheet-backdrop" onClick={() => close(false)} />
          <div ref={list} className="dd-sheet" onKeyDown={onKey}>
            <div className="dd-sheet-handle" aria-hidden="true" />
            <div className="dd-sheet-head">
              <h3>{label}</h3>
              <button type="button" className="icon-btn dd-sheet-close" onClick={() => close(false)} aria-label="Close">
                <Icon name="close" size={16} />
              </button>
            </div>
            {searchable && (
              <div className="dd-sheet-search">
                <Icon name="search" size={16} />
                <input ref={searchRef} className="input dd-search" placeholder={`Search ${label.toLowerCase()}...`} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} autoCapitalize="none" autoCorrect="off" />
                {q && <button type="button" className="dd-search-clear" onClick={() => setQ('')} aria-label="Clear"><Icon name="close" size={14} /></button>}
              </div>
            )}
            <div className="dd-sheet-list" role="listbox" tabIndex={-1}>
              {searchable && !shown.length && <p className="hint dd-empty">No options match "{q}".</p>}
              {shown.map((o) => (
                <button key={o.value} type="button" role="option" aria-selected={o.value === value} className={`dd-opt ${o.value === value ? 'selected' : ''}`} onClick={() => choose(o)}>
                  <span className="dd-t">
                    <b>{o.label}</b>
                    {o.hint && <small>{o.hint}</small>}
                  </span>
                  {o.value === value && <Icon name="check" size={18} />}
                </button>
              ))}
            </div>
          </div>
        </div>, host
      )}

      {open && host && !isMobile && pos && createPortal(
        <div ref={list} className={`dd-pop ${searchable ? 'dd-searchable' : ''}`} role="listbox" tabIndex={-1} aria-label={label} style={{ top: pos.top, left: pos.left, minWidth: pos.width }} onKeyDown={onKey}>
          {searchable && <input ref={searchRef} className="input dd-search" placeholder="Search" aria-label={`Search ${label}`} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} />}
          {searchable && !shown.length && <p className="hint" style={{ padding: '8px 10px' }}>Nothing matches.</p>}
          {shown.map((o, i) => (
            <div key={o.value} role="option" aria-selected={o.value === value} className={`dd-opt ${i === active ? 'act' : ''}`}
              onPointerMove={() => setActive(i)} onClick={() => choose(o)}>
              <span className="dd-t">{o.label}{o.hint && <small>{o.hint}</small>}</span>
              {o.value === value && <Icon name="check" size={15} />}
            </div>
          ))}
        </div>, host
      )}
    </>
  );
}
