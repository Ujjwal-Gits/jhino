import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRoute } from './context';
import { Icon } from './ui';

/*
 * Quick search: a search box in the top bar that opens a palette (click it, or press Ctrl K / Cmd K).
 * Pages match as you type; people and apps come from the server after a short pause. Arrow keys move,
 * Enter opens, Escape closes.
 */
export interface Hit { group: string; label: string; sub?: string; to: string }

export function QuickSearch({ placeholder, pages, search }: { placeholder: string; pages: Hit[]; search?: (q: string) => Promise<Hit[]> }) {
  const { go } = useRoute();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); } else if (e.key === 'Escape') setOpen(false); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);
  useEffect(() => { if (open) { setQ(''); setFound([]); setSel(0); } }, [open]);
  useEffect(() => {
    const s = q.trim();
    if (!search || s.length < 2) { setFound([]); setBusy(false); return; }
    setBusy(true);
    const t = setTimeout(() => { search(s).then((r) => { setFound(r); setBusy(false); }, () => setBusy(false)); }, 220);
    return () => clearTimeout(t);
  }, [q, search]);

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    const pg = pages.filter((p) => !s || `${p.label} ${p.sub ?? ''}`.toLowerCase().includes(s)).slice(0, s ? 6 : 8);
    return [...pg, ...found];
  }, [q, pages, found]);
  useEffect(() => { setSel(0); }, [hits.length]);

  const pick = (h: Hit) => { setOpen(false); go(h.to); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((n) => Math.min(hits.length - 1, n + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((n) => Math.max(0, n - 1)); }
    else if (e.key === 'Enter' && hits[sel]) { e.preventDefault(); pick(hits[sel]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <>
      <button type="button" className="qs-box" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="search" size={16} /><span>{placeholder}</span><kbd className="mono">{mac ? '⌘ K' : 'Ctrl K'}</kbd>
      </button>
      {open && createPortal(
        <div className="qs-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="qs" role="dialog" aria-modal="true" aria-label="Quick search">
            <div className="qs-in">
              <Icon name="search" size={18} />
              <input ref={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={placeholder} aria-label={placeholder}
                role="combobox" aria-expanded="true" aria-controls="qs-list" aria-activedescendant={hits[sel] ? `qs-${sel}` : undefined} />
              {busy && <span className="ld-spin" aria-hidden="true" />}
              <kbd className="mono">Esc</kbd>
            </div>
            <ul id="qs-list" className="qs-list" role="listbox">
              {!hits.length && <li className="qs-none">{q.trim().length < 2 ? 'Type to search.' : busy ? 'Searching…' : `Nothing found for “${q.trim()}”.`}</li>}
              {hits.map((h, i) => (
                <li key={`${h.group}-${h.to}-${i}`}>
                  {(i === 0 || hits[i - 1].group !== h.group) && <p className="qs-group">{h.group}</p>}
                  <button id={`qs-${i}`} role="option" aria-selected={i === sel} className="qs-hit" onMouseEnter={() => setSel(i)} onClick={() => pick(h)}>
                    <b>{h.label}</b>{h.sub && <small>{h.sub}</small>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
