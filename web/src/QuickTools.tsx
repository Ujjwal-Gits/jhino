import qrcode from 'qrcode-generator';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, get, post } from './api';
import { Link } from './context';
import { Icon, ago, copyText, useToast } from './ui';
import './quicktools.css';

/*
 * Quick tools: a rail on the right edge (like Google Workspace's side panel) with a focus timer and lo-fi
 * player, calendar, tasks, notes, contacts, subscription and trial reminders, short links, a QR maker and
 * text tools. Tasks, notes, contacts, events and subscriptions are saved to the person's account
 * (server/tools.ts); the timer, QR maker and text tools run only in the browser (text never leaves it).
 */

type ToolKey = 'focus' | 'calendar' | 'tasks' | 'notes' | 'contacts' | 'subs' | 'links' | 'qr' | 'text';
const P: Record<string, string> = {
  focus: 'M12 7v5l3 2M9 2h6M12 22a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M12 14h2M16 14h0',
  tasks: 'M4 6l2 2 3-3M12 7h8M4 13l2 2 3-3M12 14h8M12 20h8M5 20h2',
  notes: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5',
  contacts: 'M16 21v-1a4 4 0 0 0-8 0v1M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 8v6M23 11h-6',
  subs: 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zM18 16V11a6 6 0 1 0-12 0v5l-2 2h16z',
  links: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2',
  text: 'M4 19l5-14 5 14M6 14h6M15 19v-6a3 3 0 0 1 6 0v6M15 16h6',
};
const TOOLS: { key: ToolKey; label: string; tint: string }[] = [
  { key: 'focus', label: 'Focus timer', tint: 'g' }, { key: 'calendar', label: 'Calendar', tint: 'b' }, { key: 'tasks', label: 'Tasks', tint: 't' },
  { key: 'notes', label: 'Notes', tint: 'y' }, { key: 'contacts', label: 'Contacts', tint: 'g' }, { key: 'subs', label: 'Subscriptions & trials', tint: 'r' },
  { key: 'links', label: 'Short links', tint: 'n' }, { key: 'qr', label: 'QR code maker', tint: 'b' }, { key: 'text', label: 'Text tools', tint: 'p' },
];
const Svg = ({ d, size = 20 }: { d: string; size?: number }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const msg = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);
const pad = (n: number) => String(n).padStart(2, '0');
const localInput = (iso?: string | null) => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const REMIND = [{ v: '', l: 'No reminder' }, { v: '0', l: 'At the time' }, { v: '10', l: '10 minutes before' }, { v: '60', l: '1 hour before' }, { v: '1440', l: '1 day before' }];
const remindFrom = (due: string, mins: string) => (due && mins !== '' ? new Date(new Date(due).getTime() - Number(mins) * 60000).toISOString() : null);

/* ---------------- saved items ---------------- */
type Item = { id: string; done: boolean; pinned: boolean; archived: boolean; dueAt: string | null; remindAt: string | null; createdAt: string; updatedAt: string; createdBy: string; updatedBy: string; [k: string]: any };
function useItems(kind: string) {
  const toast = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const load = useCallback(() => get<{ items: Item[] }>(`/api/tools/${kind}`).then((r) => setItems(r.items), (e) => toast(msg(e, 'Could not load.'), true)), [kind, toast]);
  useEffect(() => { load(); }, [load]);
  const add = async (b: Record<string, unknown>) => { try { const r = await post<{ item: Item }>(`/api/tools/${kind}`, b); setItems((l) => [r.item, ...(l ?? [])]); return r.item; } catch (e) { toast(msg(e, 'Could not save.'), true); return null; } };
  const save = async (id: string, b: Record<string, unknown>) => { try { const r = await api<{ item: Item }>('PATCH', `/api/tools/${kind}/${id}`, b); setItems((l) => (l ?? []).map((x) => (x.id === id ? r.item : x))); return r.item; } catch (e) { toast(msg(e, 'Could not save.'), true); return null; } };
  const remove = async (id: string) => { try { await api('DELETE', `/api/tools/${kind}/${id}`); setItems((l) => (l ?? []).filter((x) => x.id !== id)); } catch (e) { toast(msg(e, 'Could not delete.'), true); } };
  return { items, add, save, remove, load };
}
const Stamp = ({ i }: { i: Item }) => <small className="qt-stamp">Added by {i.createdBy} {ago(i.createdAt)}{i.updatedAt !== i.createdAt ? ` · edited by ${i.updatedBy} ${ago(i.updatedAt)}` : ''}</small>;
const Empty = ({ children }: { children: ReactNode }) => <p className="qt-empty">{children}</p>;

/* ---------------- the rail ---------------- */
export function QuickTools({ actions }: { actions?: { label: string; to?: string; onClick?: () => void }[] }) {
  const [open, setOpen] = useState<ToolKey | null>(() => { try { return (sessionStorage.getItem('jhino-qt') as ToolKey) || null; } catch { return null; } });
  const [plus, setPlus] = useState(false);
  const timer = useTimer();
  useEffect(() => { try { if (open) sessionStorage.setItem('jhino-qt', open); else sessionStorage.removeItem('jhino-qt'); } catch { /* private mode */ } }, [open]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(null); setPlus(false); } }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  const tool = TOOLS.find((t) => t.key === open);
  return (
    <>
      <nav className="qt-rail" aria-label="Quick tools">
        {TOOLS.map((t) => (
          <button key={t.key} className={`qt-btn tint-${t.tint}`} aria-pressed={open === t.key} aria-label={t.label} title={t.label} onClick={() => { setPlus(false); setOpen(open === t.key ? null : t.key); }}>
            <Svg d={P[t.key]} />{t.key === 'focus' && timer.running && <span className="qt-dot mono">{Math.ceil(timer.left / 60)}</span>}
          </button>
        ))}
        <span className="qt-sep" aria-hidden="true" />
        <div className="qt-plus-wrap">
          <button className="qt-btn qt-plus" aria-label="Quick actions" title="Quick actions" aria-expanded={plus} onClick={() => setPlus(!plus)}><Icon name="plus" /></button>
          {plus && (
            <div className="qt-menu" role="menu">
              {(actions ?? []).map((a) => a.to
                ? <Link key={a.label} role="menuitem" to={a.to} onClick={() => setPlus(false)}>{a.label}</Link>
                : <button key={a.label} role="menuitem" onClick={() => { setPlus(false); a.onClick?.(); }}>{a.label}</button>)}
            </div>
          )}
        </div>
      </nav>
      {tool && (
        <aside className={`qt-panel ${tool.key === 'focus' ? 'wide' : ''}`} aria-label={tool.label}>
          <header className="qt-head"><h2>{tool.label}</h2><button className="icon-btn" onClick={() => setOpen(null)} aria-label="Close"><Icon name="close" /></button></header>
          <div className="qt-body">
            {tool.key === 'focus' && <Focus t={timer} />}
            {tool.key === 'calendar' && <Calendar />}
            {tool.key === 'tasks' && <Tasks />}
            {tool.key === 'notes' && <Notes />}
            {tool.key === 'contacts' && <Contacts />}
            {tool.key === 'subs' && <Subs />}
            {tool.key === 'links' && <ShortLinks />}
            {tool.key === 'qr' && <QrMaker />}
            {tool.key === 'text' && <TextTools />}
          </div>
        </aside>
      )}
    </>
  );
}

/* ---------------- focus timer + lo-fi ---------------- */
function useTimer() {
  const [work, setWork] = useState(25), [rest, setRest] = useState(5);
  const [mode, setMode] = useState<'work' | 'rest'>('work');
  const [left, setLeft] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const endAt = useRef(0);
  useEffect(() => {
    if (!running) return;
    endAt.current = Date.now() + left * 1000;
    const id = setInterval(() => {
      const s = Math.max(0, Math.round((endAt.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) {
        const next = mode === 'work' ? 'rest' : 'work';
        try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=').play().catch(() => {}); } catch { /* no sound */ }
        if ('Notification' in window && Notification.permission === 'granted') new Notification(next === 'rest' ? 'Time for a break' : 'Back to work');
        setMode(next); const n = (next === 'work' ? work : rest) * 60; setLeft(n); endAt.current = Date.now() + n * 1000;
      }
    }, 500);
    return () => clearInterval(id);
  }, [running, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = () => { setRunning(false); setMode('work'); setLeft(work * 60); };
  return { work, rest, mode, left, running, setRunning, reset, setWork: (n: number) => { setWork(n); if (!running && mode === 'work') setLeft(n * 60); }, setRest: (n: number) => { setRest(n); if (!running && mode === 'rest') setLeft(n * 60); } };
}
const LOFI = 'jfKfPfyJRdk';
const ytId = (s: string) => /(?:youtu\.be\/|v=|embed\/|live\/)([\w-]{11})/.exec(s)?.[1] ?? (/^[\w-]{11}$/.test(s) ? s : null);
function Focus({ t }: { t: ReturnType<typeof useTimer> }) {
  const [video, setVideo] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const total = (t.mode === 'work' ? t.work : t.rest) * 60;
  return (
    <div className="qt-focus">
      <div className="qt-timer">
        <p className="qt-mode">{t.mode === 'work' ? 'Focus' : 'Break'}</p>
        <div className="qt-ring" style={{ ['--p' as string]: `${(1 - t.left / total) * 360}deg` }}><span className="mono">{pad(Math.floor(t.left / 60))}:{pad(t.left % 60)}</span></div>
        <div className="qt-row">
          <button className="btn primary" onClick={() => { if (!t.running && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission(); t.setRunning(!t.running); }}>{t.running ? 'Pause' : 'Start'}</button>
          <button className="btn" onClick={t.reset}>Reset</button>
        </div>
        <div className="qt-row">
          <label className="field sm"><span>Work (min)</span><input className="input mono" type="number" min={1} max={180} value={t.work} disabled={t.running} onChange={(e) => t.setWork(Math.min(180, Math.max(1, Number(e.target.value) || 1)))} /></label>
          <label className="field sm"><span>Break (min)</span><input className="input mono" type="number" min={1} max={60} value={t.rest} disabled={t.running} onChange={(e) => t.setRest(Math.min(60, Math.max(1, Number(e.target.value) || 1)))} /></label>
        </div>
      </div>
      <div className="qt-music">
        <p className="qt-mode">Lo-fi music</p>
        {video
          ? <iframe title="Lo-fi music" src={`https://www.youtube-nocookie.com/embed/${video}?autoplay=1`} allow="autoplay; encrypted-media" allowFullScreen />
          : <button className="qt-play" onClick={() => setVideo(LOFI)}><Icon name="play" /><span>Play lo-fi radio</span><small>From YouTube. Starts only when you press play.</small></button>}
        <div className="qt-row">
          <input className="input" placeholder="Or paste a YouTube link" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button className="btn" onClick={() => { const id = ytId(custom.trim()); if (id) setVideo(id); }}>Play</button>
        </div>
        {video && <button className="btn sm" onClick={() => setVideo(null)}>Stop music</button>}
      </div>
    </div>
  );
}

/* ---------------- tasks ---------------- */
function Tasks() {
  const { items, add, save, remove } = useItems('task');
  const notes = useItems('note').items, contacts = useItems('contact').items, events = useItems('event').items;
  const [title, setTitle] = useState(''), [due, setDue] = useState('');
  const [edit, setEdit] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  if (!items) return <div className="acc-skel sm" />;
  const open = items.filter((i) => !i.done), done = items.filter((i) => i.done);
  const nameOf = (list: Item[] | null, id: string) => list?.find((x) => x.id === id);
  const row = (i: Item) => (
    <li key={i.id} className={i.done ? 'done' : ''}>
      <button className="qt-check" aria-label={i.done ? 'Mark not done' : 'Mark done'} aria-pressed={i.done} onClick={() => save(i.id, { done: !i.done })}>{i.done && <Icon name="check" size={13} />}</button>
      <div className="qt-li-main" onClick={() => setEdit(edit === i.id ? null : i.id)}>
        <b>{i.title}</b>
        <small className={i.dueAt && !i.done && new Date(i.dueAt) < new Date() ? 'late' : ''}>{i.dueAt ? `Due ${when(i.dueAt)}` : 'No date'}{(i.links ?? []).length ? ` · ${(i.links as string[]).length} linked` : ''}</small>
      </div>
      {edit === i.id && <TaskEdit i={i} notes={notes} contacts={contacts} events={events} save={save} remove={remove} nameOf={nameOf} close={() => setEdit(null)} />}
    </li>
  );
  return (
    <>
      <form className="qt-add" onSubmit={async (e) => { e.preventDefault(); if (!title.trim()) return; if (await add({ title: title.trim(), dueAt: due || null })) { setTitle(''); setDue(''); } }}>
        <input className="input" placeholder="Add a task" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="input" type="datetime-local" aria-label="Due" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className="btn primary">Add</button>
      </form>
      {!open.length ? <Empty>No open tasks.</Empty> : <ul className="qt-list">{open.map(row)}</ul>}
      {done.length > 0 && <button className="btn sm quiet" onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide' : 'Show'} {done.length} done</button>}
      {showDone && <ul className="qt-list">{done.map(row)}</ul>}
    </>
  );
}
function TaskEdit({ i, notes, contacts, events, save, remove, nameOf, close }: { i: Item; notes: Item[] | null; contacts: Item[] | null; events: Item[] | null; save: (id: string, b: Record<string, unknown>) => Promise<Item | null>; remove: (id: string) => void; nameOf: (l: Item[] | null, id: string) => Item | undefined; close: () => void }) {
  const [f, setF] = useState({ title: i.title as string, due: localInput(i.dueAt), remind: '', links: (i.links ?? []) as string[] });
  const pick = (list: Item[] | null, label: string, k: string) => (
    <label className="field sm"><span>{label}</span>
      <select className="input" value="" onChange={(e) => e.target.value && setF({ ...f, links: [...new Set([...f.links, e.target.value])] })}>
        <option value="">Link a {label.toLowerCase()}…</option>
        {(list ?? []).map((x) => <option key={x.id} value={`${k}:${x.id}`}>{x.title || x.name || '(untitled)'}</option>)}
      </select>
    </label>
  );
  const label = (l: string) => { const [k, id] = l.split(':'); const x = nameOf(k === 'note' ? notes : k === 'contact' ? contacts : events, id); return x ? `${k === 'note' ? 'Note' : k === 'contact' ? 'Contact' : 'Event'}: ${x.title || x.name}` : null; };
  return (
    <div className="qt-edit">
      <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <div className="qt-row">
        <label className="field sm"><span>Due</span><input className="input" type="datetime-local" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></label>
        <label className="field sm"><span>Remind me</span><select className="input" value={f.remind} onChange={(e) => setF({ ...f, remind: e.target.value })}>{REMIND.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}</select></label>
      </div>
      <div className="qt-row">{pick(notes, 'Note', 'note')}{pick(contacts, 'Contact', 'contact')}{pick(events, 'Event', 'event')}</div>
      {f.links.length > 0 && <div className="qt-chips">{f.links.map((l) => label(l) && <span key={l} className="qt-chip">{label(l)}<button aria-label="Remove link" onClick={() => setF({ ...f, links: f.links.filter((x) => x !== l) })}>×</button></span>)}</div>}
      <Stamp i={i} />
      <div className="qt-row">
        <button className="btn primary sm" onClick={async () => { const due = f.due ? new Date(f.due).toISOString() : null; if (await save(i.id, { title: f.title, dueAt: due, links: f.links, ...(f.remind !== '' || !due ? { remindAt: due ? remindFrom(due, f.remind) : null } : {}) })) close(); }}>Save</button>
        <button className="btn sm danger" onClick={() => { if (confirm('Delete this task?')) remove(i.id); }}>Delete</button>
      </div>
    </div>
  );
}

/* ---------------- notes ---------------- */
function Notes() {
  const { items, add, save, remove } = useItems('note');
  const [q, setQ] = useState(''), [archived, setArchived] = useState(false);
  const [edit, setEdit] = useState<Item | 'new' | null>(null);
  const [f, setF] = useState({ title: '', body: '' });
  useEffect(() => { setF(edit && edit !== 'new' ? { title: edit.title ?? '', body: edit.body ?? '' } : { title: '', body: '' }); }, [edit]);
  if (!items) return <div className="acc-skel sm" />;
  if (edit) return (
    <div className="qt-edit flat">
      <input className="input" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <textarea className="textarea" rows={12} placeholder="Write…" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      {edit !== 'new' && <Stamp i={edit} />}
      <div className="qt-row">
        <button className="btn primary sm" onClick={async () => { if (await (edit === 'new' ? add(f) : save(edit.id, f))) setEdit(null); }}>Save</button>
        <button className="btn sm" onClick={() => setEdit(null)}>Cancel</button>
        {edit !== 'new' && <button className="btn sm danger" onClick={() => { if (confirm('Delete this note?')) { remove(edit.id); setEdit(null); } }}>Delete</button>}
      </div>
    </div>
  );
  const list = items.filter((i) => i.archived === archived && `${i.title} ${i.body}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="qt-add"><input className="input" placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn primary" onClick={() => setEdit('new')}>New</button></div>
      <div className="seg sm"><button aria-pressed={!archived} onClick={() => setArchived(false)}>Notes</button><button aria-pressed={archived} onClick={() => setArchived(true)}>Archived</button></div>
      {!list.length ? <Empty>{q ? 'Nothing matches.' : archived ? 'No archived notes.' : 'No notes yet.'}</Empty> : (
        <ul className="qt-cards">{list.map((i) => (
          <li key={i.id}>
            <button className="qt-card" onClick={() => setEdit(i)}><b>{i.title || 'Untitled'}</b><span>{String(i.body ?? '').slice(0, 140)}</span><small>{ago(i.updatedAt)}</small></button>
            <div className="qt-card-acts">
              <button className="icon-btn" title={i.pinned ? 'Unpin' : 'Pin'} aria-pressed={i.pinned} onClick={() => save(i.id, { pinned: !i.pinned })}><Icon name={i.pinned ? 'check' : 'up'} size={15} /></button>
              <button className="icon-btn" title={i.archived ? 'Unarchive' : 'Archive'} onClick={() => save(i.id, { archived: !i.archived })}><Icon name={i.archived ? 'rotate' : 'down'} size={15} /></button>
            </div>
          </li>
        ))}</ul>
      )}
    </>
  );
}

/* ---------------- contacts ---------------- */
const CONTACT = { name: '', phone: '', email: '', company: '', link: '', notes: '' };
function Contacts() {
  const { items, add, save, remove } = useItems('contact');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Item | 'new' | null>(null);
  const [f, setF] = useState(CONTACT);
  useEffect(() => { setF(edit && edit !== 'new' ? { ...CONTACT, ...Object.fromEntries(Object.keys(CONTACT).map((k) => [k, edit[k] ?? ''])) } : CONTACT); }, [edit]);
  if (!items) return <div className="acc-skel sm" />;
  if (edit) return (
    <div className="qt-edit flat">
      {([['name', 'Name', 'text'], ['phone', 'Phone', 'tel'], ['email', 'Email', 'email'], ['company', 'Company', 'text'], ['link', 'Website or profile link', 'url']] as const).map(([k, l, t]) => (
        <label key={k} className="field sm"><span>{l}</span><input className="input" type={t} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
      ))}
      <label className="field sm"><span>Notes</span><textarea className="textarea" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      {edit !== 'new' && <Stamp i={edit} />}
      <div className="qt-row">
        <button className="btn primary sm" onClick={async () => { if (await (edit === 'new' ? add(f) : save(edit.id, f))) setEdit(null); }}>Save</button>
        <button className="btn sm" onClick={() => setEdit(null)}>Cancel</button>
        {edit !== 'new' && <button className="btn sm danger" onClick={() => { if (confirm('Delete this contact?')) { remove(edit.id); setEdit(null); } }}>Delete</button>}
      </div>
    </div>
  );
  const list = items.filter((i) => `${i.name} ${i.email} ${i.phone} ${i.company}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return (
    <>
      <div className="qt-add"><input className="input" placeholder="Search contacts" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn primary" onClick={() => setEdit('new')}>New</button></div>
      {!list.length ? <Empty>{q ? 'Nothing matches.' : 'No contacts yet.'}</Empty> : (
        <ul className="qt-list">{list.map((i) => (
          <li key={i.id}>
            <span className="qt-av" aria-hidden="true">{String(i.name).trim().charAt(0).toUpperCase()}</span>
            <div className="qt-li-main" onClick={() => setEdit(i)}><b>{i.name}</b><small>{[i.company, i.phone, i.email].filter(Boolean).join(' · ') || 'No details'}</small></div>
            <span className="qt-acts">
              {i.phone && <a className="icon-btn" href={`tel:${i.phone}`} title="Call"><Svg d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" size={16} /></a>}
              {i.email && <a className="icon-btn" href={`mailto:${i.email}`} title="Email"><Icon name="mail" size={16} /></a>}
              {/^https?:\/\//.test(i.link ?? '') && <a className="icon-btn" href={i.link} target="_blank" rel="noopener noreferrer" title="Open link"><Icon name="external" size={16} /></a>}
            </span>
          </li>
        ))}</ul>
      )}
    </>
  );
}

/* ---------------- calendar ---------------- */
function Calendar() {
  const { items, add, remove } = useItems('event');
  const taskList = useItems('task');
  const tasks = taskList.items;
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [sel, setSel] = useState(() => dayKey(new Date()));
  const [f, setF] = useState({ title: '', time: '09:00', remind: '10' });
  if (!items) return <div className="acc-skel sm" />;
  const byDay = new Map<string, Item[]>();
  for (const i of [...items, ...(tasks ?? []).filter((t) => t.dueAt && !t.done).map((t) => ({ ...t, isTask: true }))]) if (i.dueAt) { const k = dayKey(new Date(i.dueAt)); byDay.set(k, [...(byDay.get(k) ?? []), i]); }
  const first = new Date(month); const start = new Date(first); start.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, n) => { const d = new Date(start); d.setDate(start.getDate() + n); return d; });
  const today = dayKey(new Date());
  const list = (byDay.get(sel) ?? []).sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  return (
    <>
      <div className="qt-cal-h">
        <button className="icon-btn" aria-label="Previous month" onClick={() => { const d = new Date(month); d.setMonth(d.getMonth() - 1); setMonth(d); }}><Icon name="back" size={16} /></button>
        <b>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b>
        <button className="icon-btn" aria-label="Next month" onClick={() => { const d = new Date(month); d.setMonth(d.getMonth() + 1); setMonth(d); }}><Icon name="more" size={16} /></button>
      </div>
      <div className="qt-cal" role="grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, n) => <span key={n} className="qt-dow">{d}</span>)}
        {days.map((d) => { const k = dayKey(d); return (
          <button key={k} className={`qt-day ${d.getMonth() !== month.getMonth() ? 'out' : ''} ${k === today ? 'today' : ''}`} aria-pressed={k === sel} onClick={() => setSel(k)}>
            {d.getDate()}{byDay.has(k) && <i />}
          </button>
        ); })}
      </div>
      <h3 className="qt-sub">{new Date(sel + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
      {!list.length ? <Empty>Nothing on this day.</Empty> : (
        <ul className="qt-list">{list.map((i) => (
          <li key={i.id}>
            <span className="mono qt-time">{new Date(i.dueAt!).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
            <div className="qt-li-main"><b>{i.title}</b><small>{i.isTask ? 'Task' : i.remindAt ? `Reminder ${when(i.remindAt)}` : 'Event'}</small></div>
            {!i.isTask && <button className="icon-btn" aria-label="Delete event" onClick={() => { if (confirm('Delete this event?')) remove(i.id); }}><Icon name="trash" size={15} /></button>}
            {i.isTask && <button className="icon-btn" aria-label="Mark done" onClick={() => taskList.save(i.id, { done: true })}><Icon name="check" size={15} /></button>}
          </li>
        ))}</ul>
      )}
      <form className="qt-edit flat" onSubmit={async (e) => { e.preventDefault(); if (!f.title.trim()) return; const due = new Date(`${sel}T${f.time || '09:00'}`).toISOString(); if (await add({ title: f.title.trim(), dueAt: due, remindAt: remindFrom(due, f.remind) })) setF({ ...f, title: '' }); }}>
        <input className="input" placeholder={`Add an event on ${new Date(sel + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <div className="qt-row">
          <input className="input" type="time" aria-label="Time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
          <select className="input" aria-label="Reminder" value={f.remind} onChange={(e) => setF({ ...f, remind: e.target.value })}>{REMIND.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}</select>
          <button className="btn primary">Add</button>
        </div>
      </form>
    </>
  );
}

/* ---------------- subscriptions and trials ---------------- */
const SUB = { service: '', price: '', cycle: 'monthly', date: '', remind: '3', cancelUrl: '', notes: '' };
function Subs() {
  const { items, add, save, remove } = useItems('sub');
  const [edit, setEdit] = useState<Item | 'new' | null>(null);
  const [f, setF] = useState(SUB);
  useEffect(() => { setF(edit && edit !== 'new' ? { ...SUB, service: edit.service ?? '', price: edit.price ?? '', cycle: edit.cycle ?? 'monthly', date: edit.dueAt ? edit.dueAt.slice(0, 10) : '', remind: String(edit.remindDays ?? '3'), cancelUrl: edit.cancelUrl ?? '', notes: edit.notes ?? '' } : SUB); }, [edit]);
  if (!items) return <div className="acc-skel sm" />;
  const body = () => { const due = f.date ? new Date(`${f.date}T09:00`).toISOString() : null; return { service: f.service.trim(), price: f.price, cycle: f.cycle, remindDays: Number(f.remind), cancelUrl: f.cancelUrl.trim(), notes: f.notes, dueAt: due, remindAt: due ? new Date(new Date(due).getTime() - Number(f.remind) * 864e5).toISOString() : null }; };
  if (edit) return (
    <div className="qt-edit flat">
      <label className="field sm"><span>Service</span><input className="input" placeholder="e.g. Netflix, Canva Pro trial" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} /></label>
      <div className="qt-row">
        <label className="field sm"><span>Price</span><input className="input mono" placeholder="NPR 1,200" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
        <label className="field sm"><span>Schedule</span><select className="input" value={f.cycle} onChange={(e) => setF({ ...f, cycle: e.target.value })}><option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="weekly">Weekly</option><option value="trial">Free trial</option><option value="once">One time</option></select></label>
      </div>
      <div className="qt-row">
        <label className="field sm"><span>{f.cycle === 'trial' ? 'Trial ends' : 'Next renewal'}</span><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="field sm"><span>Remind me</span><select className="input" value={f.remind} onChange={(e) => setF({ ...f, remind: e.target.value })}><option value="0">On the day</option><option value="1">1 day before</option><option value="3">3 days before</option><option value="7">A week before</option></select></label>
      </div>
      <label className="field sm"><span>Cancellation link</span><input className="input" type="url" value={f.cancelUrl} onChange={(e) => setF({ ...f, cancelUrl: e.target.value })} /></label>
      <label className="field sm"><span>Notes</span><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      <p className="qt-hint">No card or bank details are needed, and Jhino never reads your email.</p>
      <div className="qt-row">
        <button className="btn primary sm" onClick={async () => { if (await (edit === 'new' ? add(body()) : save(edit.id, body()))) setEdit(null); }}>Save</button>
        <button className="btn sm" onClick={() => setEdit(null)}>Cancel</button>
        {edit !== 'new' && <button className="btn sm danger" onClick={() => { if (confirm('Delete this?')) { remove(edit.id); setEdit(null); } }}>Delete</button>}
      </div>
    </div>
  );
  const sorted = [...items].sort((a, b) => String(a.dueAt ?? '9').localeCompare(String(b.dueAt ?? '9')));
  return (
    <>
      <div className="qt-add"><span className="muted small">Get reminded before renewals and trial ends.</span><button className="btn primary" onClick={() => setEdit('new')}>Add</button></div>
      {!sorted.length ? <Empty>Nothing added yet.</Empty> : (
        <ul className="qt-list">{sorted.map((i) => { const days = i.dueAt ? Math.ceil((new Date(i.dueAt).getTime() - Date.now()) / 864e5) : null; return (
          <li key={i.id}>
            <div className="qt-li-main" onClick={() => setEdit(i)}>
              <b>{i.service}</b>
              <small>{[i.price, i.cycle === 'trial' ? 'Free trial' : i.cycle, i.dueAt ? new Date(i.dueAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''].filter(Boolean).join(' · ')}</small>
            </div>
            {days !== null && <span className={`qt-tag ${days <= 3 ? 'hot' : ''}`}>{days < 0 ? 'passed' : days === 0 ? 'today' : `${days} d`}</span>}
            {/^https?:\/\//.test(i.cancelUrl ?? '') && <a className="icon-btn" href={i.cancelUrl} target="_blank" rel="noopener noreferrer" title="Cancel page"><Icon name="external" size={15} /></a>}
          </li>
        ); })}</ul>
      )}
    </>
  );
}

/* ---------------- short links ---------------- */
function ShortLinks() {
  const toast = useToast();
  const [url, setUrl] = useState(''), [code, setCode] = useState('');
  const [made, setMade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <form className="qt-edit flat" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        try { const r = await post<{ link: { short: string } }>('/api/links', { url: url.trim(), code: code.trim() || undefined }); setMade(r.link.short); setUrl(''); setCode(''); }
        catch (er) { toast(msg(er, 'Could not make the link.'), true); } finally { setBusy(false); }
      }}>
        <label className="field sm"><span>Long address</span><input className="input" type="url" required placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
        <label className="field sm"><span>Name <em>optional</em></span><input className="input mono" placeholder="sale" value={code} onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} /></label>
        <button className="btn primary sm" disabled={busy}>Make short link</button>
      </form>
      {made && <div className="qt-made"><span className="mono">{made.replace(/^https?:\/\//, '')}</span><button className="btn sm" onClick={() => { copyText(made); toast('Copied'); }}>Copy</button></div>}
      {made && <div className="qt-qr"><QrSvg text={made} fg="#141414" bg="#ffffff" size={160} /></div>}
      <p className="qt-links"><Link to="/links">My short links</Link><Link to="/admin/links">All short links (admin)</Link></p>
    </>
  );
}

/* ---------------- QR maker ---------------- */
function QrSvg({ text, fg, bg, size }: { text: string; fg: string; bg: string; size: number }) {
  const { n, d } = useMemo(() => { const q = qrcode(0, 'M'); q.addData(text || ' '); q.make(); const c = q.getModuleCount(); let d = ''; for (let r = 0; r < c; r++) for (let x = 0; x < c; x++) if (q.isDark(r, x)) d += `M${x + 4} ${r + 4}h1v1h-1z`; return { n: c + 8, d }; }, [text]);
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label="QR code"><rect width={n} height={n} fill={bg} /><path d={d} fill={fg} /></svg>;
}
function QrMaker() {
  const [text, setText] = useState('https://jhino.com');
  const [fg, setFg] = useState('#141414'), [bg, setBg] = useState('#ffffff');
  const wrap = useRef<HTMLDivElement>(null);
  const tooLong = text.length > 1200;
  const svgText = () => wrap.current?.querySelector('svg')?.outerHTML ?? '';
  const download = (href: string, name: string) => { const a = document.createElement('a'); a.href = href; a.download = name; a.click(); };
  return (
    <>
      <label className="field sm"><span>Link or text</span><textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <div className="qt-row">
        <label className="field sm"><span>Colour</span><input type="color" value={fg} onChange={(e) => setFg(e.target.value)} /></label>
        <label className="field sm"><span>Background</span><input type="color" value={bg} onChange={(e) => setBg(e.target.value)} /></label>
      </div>
      {tooLong ? <p className="error-text">Too long for one QR code (1,200 characters at most).</p> : <div className="qt-qr" ref={wrap}><QrSvg text={text} fg={fg} bg={bg} size={220} /></div>}
      <div className="qt-row">
        <button className="btn sm" disabled={tooLong || !text} onClick={() => download(URL.createObjectURL(new Blob([svgText()], { type: 'image/svg+xml' })), 'qr-code.svg')}>Download SVG</button>
        <button className="btn sm" disabled={tooLong || !text} onClick={() => {
          const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 1024; c.getContext('2d')!.drawImage(img, 0, 0, 1024, 1024); download(c.toDataURL('image/png'), 'qr-code.png'); };
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText());
        }}>Download PNG</button>
      </div>
      <p className="qt-hint">This code always opens exactly this text or link. To change where a printed code goes later, point it at a short link.</p>
    </>
  );
}

/* ---------------- text tools (in the browser only) ---------------- */
const sentence = (s: string) => s.toLowerCase().replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu, (m) => m.toUpperCase());
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s\-_/(])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
function TextTools() {
  const toast = useToast();
  const [t, setT] = useState('');
  const words = t.trim() ? t.trim().split(/\s+/).length : 0;
  const ops: [string, (s: string) => string][] = [
    ['UPPERCASE', (s) => s.toUpperCase()], ['lowercase', (s) => s.toLowerCase()], ['Sentence case', sentence], ['Title Case', titleCase],
    ['Clean spaces', (s) => s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()], ['Remove line breaks', (s) => s.replace(/\s*\n+\s*/g, ' ').trim()],
  ];
  return (
    <>
      <textarea className="textarea" rows={10} placeholder="Paste or type text. It stays in your browser." value={t} onChange={(e) => setT(e.target.value)} />
      <p className="qt-count mono">{words} words · {t.length} characters · {t.replace(/\s/g, '').length} without spaces · {t ? t.split('\n').length : 0} lines</p>
      <div className="qt-grid2">{ops.map(([l, f]) => <button key={l} className="btn sm" onClick={() => setT(f(t))}>{l}</button>)}</div>
      <div className="qt-row"><button className="btn primary sm" disabled={!t} onClick={() => { copyText(t); toast('Copied'); }}>Copy</button><button className="btn sm" disabled={!t} onClick={() => setT('')}>Clear</button></div>
    </>
  );
}

/* ---------------- "Your day" for dashboards ---------------- */
export function YourDay() {
  const [d, setD] = useState<{ tasks: Item[]; events: Item[]; subs: Item[]; openTasks: number } | null>(null);
  useEffect(() => { get<typeof d>('/api/tools-today').then(setD, () => setD({ tasks: [], events: [], subs: [], openTasks: 0 })); }, []);
  if (!d) return null;
  const all = [
    ...d.tasks.map((i) => ({ i, k: 'Task', late: !!i.dueAt && new Date(i.dueAt) < new Date() })),
    ...d.events.map((i) => ({ i, k: 'Event', late: false })),
    ...d.subs.map((i) => ({ i, k: i.cycle === 'trial' ? 'Trial ends' : 'Renews', late: false })),
  ].sort((a, b) => String(a.i.dueAt).localeCompare(String(b.i.dueAt)));
  return (
    <section className="dpanel" aria-labelledby="day-h">
      <div className="panel-h"><h2 id="day-h">Your day</h2><span className="muted small">{d.openTasks} open {d.openTasks === 1 ? 'task' : 'tasks'}</span></div>
      {!all.length ? <p className="q-clear"><Icon name="check" size={16} />Nothing due today or tomorrow. Add tasks and events from the tools on the right.</p> : (
        <ul className="q-list">{all.slice(0, 8).map(({ i, k, late }) => (
          <li key={i.id}><span className="q-row"><span className="q-k">{k}</span><span className="q-t"><b>{i.title || i.service}</b><small className={late ? 'warn-text' : ''}>{late ? 'Overdue · ' : ''}{when(i.dueAt)}</small></span></span></li>
        ))}</ul>
      )}
    </section>
  );
}
