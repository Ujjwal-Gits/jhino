import qrcode from 'qrcode-generator';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ApiError, api, get, post } from './api';
import { Link } from './context';
import { Icon, Select, ago, copyText, useToast } from './ui';
import { DateField, DateTimeField, TimeField } from './DateField';
import './quicktools.css';
import { PanelLoader } from './Loader';
import { ringAlarm, stopAlarm, useSounds } from './alarm';
import { Calculator, ColourTool, Encoder, JsonTool, NepaliDate, Passwords, UserLookup, WorldClock } from './MoreTools';

/*
 * Quick tools: a rail on the right edge (like Google Workspace's side panel) with a focus timer and lo-fi
 * player, calendar, tasks, notes, contacts, subscription and trial reminders, short links, a QR maker and
 * text tools. Tasks, notes, contacts, events and subscriptions are saved to the person's account
 * (server/tools.ts); the timer, QR maker and text tools run only in the browser (text never leaves it).
 */

export type ToolKey = 'focus' | 'calendar' | 'tasks' | 'notes' | 'contacts' | 'subs' | 'links' | 'qr' | 'text' | 'calc' | 'date' | 'password' | 'clock' | 'json' | 'encode' | 'colour' | 'users' | 'more';
export const P: Record<string, string> = {
  focus: 'M12 7v5l3 2M9 2h6M12 22a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M12 14h2M16 14h0',
  tasks: 'M4 6l2 2 3-3M12 7h8M4 13l2 2 3-3M12 14h8M12 20h8M5 20h2',
  notes: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5',
  contacts: 'M16 21v-1a4 4 0 0 0-8 0v1M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 8v6M23 11h-6',
  subs: 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zM18 16V11a6 6 0 1 0-12 0v5l-2 2h16z',
  links: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2',
  text: 'M4 19l5-14 5 14M6 14h6M15 19v-6a3 3 0 0 1 6 0v6M15 16h6',
  calc: 'M6 3h12v18H6zM9 7h6M9 11h.01M12 11h.01M15 11h.01M9 14.5h.01M12 14.5h.01M15 14.5h.01M9 18h6',
  date: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8.5 15l2 2 4.5-4.5',
  password: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2c2.8 2.8 4 6.2 4 10s-1.2 7.2-4 10c-2.8-2.8-4-6.2-4-10s1.2-7.2 4-10z',
  json: 'M8 4C6 4 6 6 6 8s-2 4-2 4 2 0 2 4 0 4 2 4M16 4c2 0 2 2 2 4s2 4 2 4-2 0-2 4 0 4-2 4',
  encode: 'M7 8l-4 4 4 4M17 8l4 4-4 4M14 4l-4 16',
  colour: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-1.5 2-1.5H17a4 4 0 0 0 4-4c0-4.4-4-8.5-9-8.5zM7.5 11h.01M10 7h.01M15 7h.01',
  users: 'M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3.5 20a6.5 6.5 0 0 1 11.3-4.4M17 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM19 17.5l2.5 2.5',
};
/** Every tool. `admin` tools show only in Super Admin. The first nine sit on the rail until you change it. */
export const TOOLS: { key: ToolKey; label: string; desc: string; admin?: boolean }[] = [
  { key: 'focus', label: 'Focus timer', desc: 'Work and break timer, with lo-fi music.' },
  { key: 'calendar', label: 'Calendar', desc: 'Events and reminders by month.' },
  { key: 'tasks', label: 'Tasks', desc: 'To-dos with due dates, linked to notes and contacts.' },
  { key: 'notes', label: 'Notes', desc: 'Write, search, pin and archive.' },
  { key: 'contacts', label: 'Contacts', desc: 'Names, phones, emails and links.' },
  { key: 'subs', label: 'Subscriptions & trials', desc: 'Get reminded before renewals and trial ends.' },
  { key: 'links', label: 'Short links', desc: 'Turn a long address into a short one, with a QR.' },
  { key: 'qr', label: 'QR code maker', desc: 'A QR for any link or text, SVG or PNG.' },
  { key: 'text', label: 'Text tools', desc: 'Change case, count words, clean up spaces.' },
  { key: 'users', label: 'User lookup', desc: 'Find anyone by name, email or ID and open them.', admin: true },
  { key: 'calc', label: 'Calculator', desc: 'Sums in rupees, with 13% VAT in one click.' },
  { key: 'date', label: 'Nepali date', desc: 'BS to AD and back, 2070 to 2090 BS.' },
  { key: 'password', label: 'Password generator', desc: 'Strong passwords to send with a new sign-in.' },
  { key: 'clock', label: 'World clock', desc: 'The time in Kathmandu and where your clients are.' },
  { key: 'json', label: 'JSON formatter', desc: 'Format, minify and check JSON.' },
  { key: 'encode', label: 'Encode and decode', desc: 'Base64 and URL encoding.' },
  { key: 'colour', label: 'Colour converter', desc: 'HEX, RGB and HSL, with contrast.' },
];
const DEFAULT_RAIL: ToolKey[] = ['focus', 'calendar', 'tasks', 'notes', 'contacts', 'subs', 'links', 'qr', 'text'];
const RAIL_KEY = 'jhino-qt-rail';
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
  const changed = () => window.dispatchEvent(new Event('jhino-tools-changed'));
  const add = async (b: Record<string, unknown>) => { try { const r = await post<{ item: Item }>(`/api/tools/${kind}`, b); setItems((l) => [r.item, ...(l ?? [])]); changed(); return r.item; } catch (e) { toast(msg(e, 'Could not save.'), true); return null; } };
  const save = async (id: string, b: Record<string, unknown>) => { try { const r = await api<{ item: Item }>('PATCH', `/api/tools/${kind}/${id}`, b); setItems((l) => (l ?? []).map((x) => (x.id === id ? r.item : x))); changed(); return r.item; } catch (e) { toast(msg(e, 'Could not save.'), true); return null; } };
  const remove = async (id: string) => { try { await api('DELETE', `/api/tools/${kind}/${id}`); setItems((l) => (l ?? []).filter((x) => x.id !== id)); changed(); } catch (e) { toast(msg(e, 'Could not delete.'), true); } };
  return { items, add, save, remove, load };
}
const Stamp = ({ i }: { i: Item }) => <small className="qt-stamp">Added by {i.createdBy} {ago(i.createdAt)}{i.updatedAt !== i.createdAt ? ` · edited by ${i.updatedBy} ${ago(i.updatedAt)}` : ''}</small>;
const Empty = ({ children }: { children: ReactNode }) => <p className="qt-empty">{children}</p>;

/* ---------------- the rail ---------------- */
export function QuickTools({ admin = false }: { admin?: boolean }) {
  const all = TOOLS.filter((t) => admin || !t.admin);
  const [rail, setRail] = useState<ToolKey[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(RAIL_KEY) ?? 'null'); if (Array.isArray(v)) return v.filter((k) => TOOLS.some((t) => t.key === k)); } catch { /* private mode */ }
    return admin ? [...DEFAULT_RAIL.slice(0, 8), 'users', 'text'] : DEFAULT_RAIL;
  });
  const [open, setOpen] = useState<ToolKey | null>(() => { try { return (sessionStorage.getItem('jhino-qt') as ToolKey) || null; } catch { return null; } });
  const timer = useTimer();
  const sounds = useSounds();
  useEffect(() => { try { if (open) sessionStorage.setItem('jhino-qt', open); else sessionStorage.removeItem('jhino-qt'); } catch { /* private mode */ } }, [open]);
  useEffect(() => { try { localStorage.setItem(RAIL_KEY, JSON.stringify(rail)); } catch { /* private mode */ } }, [rail]);
  // Other screens can open a tool (Home's "All tasks").
  useEffect(() => { const on = (e: Event) => setOpen((e as CustomEvent).detail as ToolKey); addEventListener('jhino-tool', on); return () => removeEventListener('jhino-tool', on); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  const shown = rail.map((k) => all.find((t) => t.key === k)).filter(Boolean) as typeof TOOLS;
  const tool = open === 'more' ? { key: 'more' as ToolKey, label: 'More tools', desc: '' } : all.find((t) => t.key === open);
  const toggleRail = (k: ToolKey) => setRail((r) => (r.includes(k) ? r.filter((x) => x !== k) : [...r, k]));
  return (
    <>
      {sounds.ringing && (
        <div className="qt-ringing" role="alert">
          <span><b>{timer.mode === 'rest' ? 'Time for a break' : 'Back to focus'}</b><small>Your timer turned over.</small></span>
          <button className="btn primary" onClick={stopAlarm}>Stop alarm</button>
        </div>
      )}
      <nav className="qt-rail" aria-label="Quick tools">
        {shown.map((t) => (
          <button key={t.key} className="qt-btn" aria-pressed={open === t.key} aria-label={t.label} onClick={() => setOpen(open === t.key ? null : t.key)}>
            <Svg d={P[t.key]} />{t.key === 'focus' && timer.running && <span className="qt-dot mono">{Math.ceil(timer.left / 60)}</span>}
          </button>
        ))}
        <span className="qt-sep" aria-hidden="true" />
        <div className="qt-plus-wrap">
          <button className="qt-btn qt-plus" aria-label="More tools" aria-pressed={open === 'more'} onClick={() => setOpen(open === 'more' ? null : 'more')}><Icon name="plus" /></button>
        </div>
      </nav>
      {tool && (
        <aside className={`qt-panel ${tool.key === 'focus' ? 'wide' : ''}`} aria-label={tool.label}>
          <header className="qt-head">
            {tool.key !== 'more' && !rail.includes(tool.key) ? <button className="icon-btn" onClick={() => setOpen('more')} aria-label="Back to more tools"><Icon name="back" size={18} /></button> : null}
            <h2>{tool.label}</h2>
            <button className="icon-btn" onClick={() => setOpen(null)} aria-label="Close"><Icon name="close" /></button>
          </header>
          <div className="qt-body">
            {tool.key === 'more' && (
              <>
                <p className="qt-hint">Open any tool, and choose which ones sit on the rail. Your choice is kept on this device.</p>
                <ul className="qt-cat">{all.map((t) => (
                  <li key={t.key}>
                    <button className="qt-cat-open" onClick={() => setOpen(t.key)}>
                      <span className="qt-cat-ic"><Svg d={P[t.key]} size={18} /></span>
                      <span className="qt-li-main"><b>{t.label}</b><small>{t.desc}</small></span>
                    </button>
                    <label className="qt-switch" title={rail.includes(t.key) ? 'On the rail' : 'Add to the rail'}>
                      <input type="checkbox" checked={rail.includes(t.key)} onChange={() => toggleRail(t.key)} aria-label={`Show ${t.label} on the rail`} /><i aria-hidden="true" />
                    </label>
                  </li>
                ))}</ul>
                <button className="btn sm quiet" onClick={() => setRail(admin ? [...DEFAULT_RAIL.slice(0, 8), 'users', 'text'] : DEFAULT_RAIL)}>Reset the rail</button>
              </>
            )}
            {tool.key === 'focus' && <Focus t={timer} />}
            {tool.key === 'calendar' && <Calendar />}
            {tool.key === 'tasks' && <Tasks />}
            {tool.key === 'notes' && <Notes />}
            {tool.key === 'contacts' && <Contacts />}
            {tool.key === 'subs' && <Subs />}
            {tool.key === 'links' && <ShortLinks />}
            {tool.key === 'qr' && <QrMaker />}
            {tool.key === 'text' && <TextTools />}
            {tool.key === 'calc' && <Calculator />}
            {tool.key === 'date' && <NepaliDate />}
            {tool.key === 'password' && <Passwords />}
            {tool.key === 'clock' && <WorldClock />}
            {tool.key === 'json' && <JsonTool />}
            {tool.key === 'encode' && <Encoder />}
            {tool.key === 'colour' && <ColourTool />}
            {tool.key === 'users' && admin && <UserLookup />}
          </div>
        </aside>
      )}
    </>
  );
}

/* ---------------- focus timer + lo-fi ---------------- */
/** One timer for the whole dashboard: the rail and the full Focus page show the same clock, and it survives a reload. */
type TimerState = { work: number; rest: number; mode: 'work' | 'rest'; left: number; running: boolean; endAt: number; rounds: number };
const TIMER_KEY = 'jhino-focus';
const T: TimerState = (() => {
  const d: TimerState = { work: 25, rest: 5, mode: 'work', left: 1500, running: false, endAt: 0, rounds: 0 };
  try { const v = JSON.parse(localStorage.getItem(TIMER_KEY) ?? 'null'); if (v && typeof v.work === 'number') Object.assign(d, v); } catch { /* private mode */ }
  if (d.running) d.left = Math.max(0, Math.round((d.endAt - Date.now()) / 1000));
  return d;
})();
let snap = { ...T };
const timerSubs = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | undefined;
const emit = () => { snap = { ...T }; try { localStorage.setItem(TIMER_KEY, JSON.stringify(T)); } catch { /* private mode */ } timerSubs.forEach((f) => f()); };
const tick = () => {
  if (!T.running) return;
  T.left = Math.max(0, Math.round((T.endAt - Date.now()) / 1000));
  if (T.left === 0) {
    const next = T.mode === 'work' ? 'rest' : 'work';
    if (T.mode === 'work') T.rounds += 1;
    ringAlarm();
    if ('Notification' in window && Notification.permission === 'granted') new Notification(next === 'rest' ? 'Time for a break' : 'Back to work');
    T.mode = next; T.left = (next === 'work' ? T.work : T.rest) * 60; T.endAt = Date.now() + T.left * 1000;
  }
  emit();
};
const run = () => { clearInterval(ticker); if (T.running) ticker = setInterval(tick, 500); };
run();
export const focusTimer = {
  start() { stopAlarm(); if (T.running) return; if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); T.running = true; T.endAt = Date.now() + T.left * 1000; run(); emit(); },
  pause() { tick(); T.running = false; run(); emit(); },
  reset() { T.running = false; T.mode = 'work'; T.left = T.work * 60; run(); emit(); },
  skip() { T.mode = T.mode === 'work' ? 'rest' : 'work'; T.left = (T.mode === 'work' ? T.work : T.rest) * 60; T.endAt = Date.now() + T.left * 1000; emit(); },
  set(work: number, rest: number) { T.work = work; T.rest = rest; if (!T.running) T.left = (T.mode === 'work' ? work : rest) * 60; emit(); },
  clearRounds() { T.rounds = 0; emit(); },
};
export function useTimer() {
  const s = useSyncExternalStore((f) => { timerSubs.add(f); return () => timerSubs.delete(f); }, () => snap);
  return { ...s, setRunning: (b: boolean) => (b ? focusTimer.start() : focusTimer.pause()), reset: focusTimer.reset, setWork: (n: number) => focusTimer.set(n, s.rest), setRest: (n: number) => focusTimer.set(s.work, n) };
}
export const LOFI = 'jfKfPfyJRdk';
export const ytId = (s: string) => /(?:youtu\.be\/|v=|embed\/|live\/)([\w-]{11})/.exec(s)?.[1] ?? (/^[\w-]{11}$/.test(s) ? s : null);
export function Focus({ t }: { t: ReturnType<typeof useTimer> }) {
  const [video, setVideo] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const total = (t.mode === 'work' ? t.work : t.rest) * 60;
  return (
    <div className="qt-focus">
      <div className="qt-timer">
        <p className="qt-mode">{t.mode === 'work' ? 'Focus' : 'Break'}</p>
        <div className="qt-ring" style={{ ['--p' as string]: `${(1 - t.left / total) * 360}deg` }}><span className="mono">{pad(Math.floor(t.left / 60))}:{pad(t.left % 60)}</span></div>
        <div className="qt-row">
          <button className="btn primary" onClick={() => t.setRunning(!t.running)}>{t.running ? 'Pause' : 'Start'}</button>
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
          ? <iframe title="Lo-fi music" src={`https://www.youtube-nocookie.com/embed/${video}?autoplay=1`} allow="autoplay; encrypted-media" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          : <button className="qt-play" onClick={() => setVideo(LOFI)}><Icon name="play" /><span>Play lo-fi radio</span><small>From YouTube. Starts only when you press play.</small></button>}
        <div className="qt-row">
          <input className="input" placeholder="Or paste a YouTube link" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button className="btn" onClick={() => { const id = ytId(custom.trim()); if (id) setVideo(id); }}>Play</button>
        </div>
        {video && <button className="btn sm" onClick={() => setVideo(null)}>Stop music</button>}
        <Link to="/home/focus" className="btn sm">Open Focus studio: alarm sounds, playlists, favourites</Link>
      </div>
    </div>
  );
}

/* ---------------- tasks ---------------- */
export function Tasks() {
  const { items, add, save, remove } = useItems('task');
  const notes = useItems('note').items, contacts = useItems('contact').items, events = useItems('event').items;
  const [title, setTitle] = useState(''), [due, setDue] = useState('');
  const [edit, setEdit] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  if (!items) return <PanelLoader />;
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
        <DateTimeField label="Due" compact value={due} onChange={setDue} />
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
    <div className="field sm"><span>{label}</span>
      <Select size="sm" label={`Link a ${label.toLowerCase()}`} value="" disabled={!(list ?? []).length}
        options={[{ value: '', label: (list ?? []).length ? `Link a ${label.toLowerCase()}` : `No ${label.toLowerCase()}s yet` }, ...(list ?? []).map((x) => ({ value: `${k}:${x.id}`, label: String(x.title || x.name || '(untitled)') }))]}
        onChange={(v) => v && setF({ ...f, links: [...new Set([...f.links, v])] })} />
    </div>
  );
  const label = (l: string) => { const [k, id] = l.split(':'); const x = nameOf(k === 'note' ? notes : k === 'contact' ? contacts : events, id); return x ? `${k === 'note' ? 'Note' : k === 'contact' ? 'Contact' : 'Event'}: ${x.title || x.name}` : null; };
  return (
    <div className="qt-edit">
      <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <div className="qt-row">
        <div className="field sm"><span>Due</span><DateTimeField label="Due" compact value={f.due} onChange={(v) => setF({ ...f, due: v })} /></div>
        <div className="field sm"><span>Remind me</span><Select size="sm" label="Remind me" value={f.remind} options={REMIND.map((r) => ({ value: r.v, label: r.l }))} onChange={(v) => setF({ ...f, remind: v })} /></div>
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
export function Notes() {
  const { items, add, save, remove } = useItems('note');
  const [q, setQ] = useState(''), [archived, setArchived] = useState(false);
  const [edit, setEdit] = useState<Item | 'new' | null>(null);
  const [f, setF] = useState({ title: '', body: '' });
  useEffect(() => { setF(edit && edit !== 'new' ? { title: edit.title ?? '', body: edit.body ?? '' } : { title: '', body: '' }); }, [edit]);
  if (!items) return <PanelLoader />;
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
      <div className="qt-seg" role="tablist" aria-label="Show"><button role="tab" aria-selected={!archived} onClick={() => setArchived(false)}>Notes <small>{items.filter((i) => !i.archived).length}</small></button><button role="tab" aria-selected={archived} onClick={() => setArchived(true)}>Archived <small>{items.filter((i) => i.archived).length}</small></button></div>
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
export function Contacts() {
  const { items, add, save, remove } = useItems('contact');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Item | 'new' | null>(null);
  const [f, setF] = useState(CONTACT);
  useEffect(() => { setF(edit && edit !== 'new' ? { ...CONTACT, ...Object.fromEntries(Object.keys(CONTACT).map((k) => [k, edit[k] ?? ''])) } : CONTACT); }, [edit]);
  if (!items) return <PanelLoader />;
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
export function Calendar() {
  const { items, add, remove } = useItems('event');
  const taskList = useItems('task');
  const tasks = taskList.items;
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [sel, setSel] = useState(() => dayKey(new Date()));
  const [f, setF] = useState({ title: '', time: '09:00', remind: '10' });
  if (!items) return <PanelLoader />;
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
        <button className="icon-btn" aria-label="Next month" onClick={() => { const d = new Date(month); d.setMonth(d.getMonth() + 1); setMonth(d); }}><Icon name="back" size={16} /></button>
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
          <TimeField label="Time" compact value={f.time} onChange={(v) => setF({ ...f, time: v })} />
          <Select size="sm" label="Reminder" value={f.remind} options={REMIND.map((r) => ({ value: r.v, label: r.l }))} onChange={(v) => setF({ ...f, remind: v })} />
          <button className="btn primary">Add</button>
        </div>
      </form>
    </>
  );
}

/* ---------------- subscriptions and trials ---------------- */
const SUB = { service: '', price: '', cycle: 'monthly', date: '', remind: '3', cancelUrl: '', notes: '' };
export function Subs() {
  const { items, add, save, remove } = useItems('sub');
  const [edit, setEdit] = useState<Item | 'new' | null>(null);
  const [f, setF] = useState(SUB);
  useEffect(() => { setF(edit && edit !== 'new' ? { ...SUB, service: edit.service ?? '', price: edit.price ?? '', cycle: edit.cycle ?? 'monthly', date: edit.dueAt ? edit.dueAt.slice(0, 10) : '', remind: String(edit.remindDays ?? '3'), cancelUrl: edit.cancelUrl ?? '', notes: edit.notes ?? '' } : SUB); }, [edit]);
  if (!items) return <PanelLoader />;
  const body = () => { const due = f.date ? new Date(`${f.date}T09:00`).toISOString() : null; return { service: f.service.trim(), price: f.price, cycle: f.cycle, remindDays: Number(f.remind), cancelUrl: f.cancelUrl.trim(), notes: f.notes, dueAt: due, remindAt: due ? new Date(new Date(due).getTime() - Number(f.remind) * 864e5).toISOString() : null }; };
  if (edit) return (
    <div className="qt-edit flat">
      <label className="field sm"><span>Service</span><input className="input" placeholder="e.g. Netflix, Canva Pro trial" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} /></label>
      <div className="qt-row">
        <label className="field sm"><span>Price</span><input className="input mono" placeholder="NPR 1,200" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
        <div className="field sm"><span>Schedule</span><Select size="sm" label="Schedule" value={f.cycle} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }, { value: 'weekly', label: 'Weekly' }, { value: 'trial', label: 'Free trial' }, { value: 'once', label: 'One time' }]} onChange={(v) => setF({ ...f, cycle: v })} /></div>
      </div>
      <div className="qt-row">
        <div className="field sm"><span>{f.cycle === 'trial' ? 'Trial ends' : 'Next renewal'}</span><DateField compact label={f.cycle === 'trial' ? 'Trial ends' : 'Next renewal'} value={f.date} onChange={(v) => setF({ ...f, date: v })} /></div>
        <div className="field sm"><span>Remind me</span><Select size="sm" label="Remind me" value={f.remind} options={[{ value: '0', label: 'On the day' }, { value: '1', label: '1 day before' }, { value: '3', label: '3 days before' }, { value: '7', label: 'A week before' }]} onChange={(v) => setF({ ...f, remind: v })} /></div>
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
      <Link to="/home/subs" className="btn sm qt-full">Open the full page: totals, domains, expiry checks</Link>
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
export function ShortLinks() {
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
export function QrSvg({ text, fg, bg, size, logo }: { text: string; fg: string; bg: string; size: number; logo?: string | null }) {
  const { n, c, d } = useMemo(() => { const q = qrcode(0, logo ? 'H' : 'M'); q.addData(text || ' '); q.make(); const c = q.getModuleCount(); let d = ''; for (let r = 0; r < c; r++) for (let x = 0; x < c; x++) if (q.isDark(r, x)) d += `M${x + 4} ${r + 4}h1v1h-1z`; return { n: c + 8, c, d }; }, [text, logo]);
  const box = Math.round(c * 0.2 * 100) / 100, o = (n - box) / 2, pad = box * 0.12;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" viewBox={`0 0 ${n} ${n}`} width={size} height={size} role="img" aria-label="QR code">
      <rect width={n} height={n} fill={bg} /><path d={d} fill={fg} shapeRendering="crispEdges" />
      {logo && <><rect x={o} y={o} width={box} height={box} rx={box * 0.2} fill="#ffffff" /><image href={logo} xlinkHref={logo} x={o + pad} y={o + pad} width={box - pad * 2} height={box - pad * 2} preserveAspectRatio="xMidYMid meet" /></>}
    </svg>
  );
}
/** Picks a logo image for the middle of a QR code. It stays in the browser as a small data URL. */
export function QrLogoField({ logo, setLogo }: { logo: string | null; setLogo: (v: string | null) => void }) {
  const toast = useToast();
  const onFile = (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast('Pick an image file.', true); return; }
    const url = URL.createObjectURL(f), img = new Image();
    img.onload = () => {
      const m = 256, k = Math.min(1, m / Math.max(img.width, img.height)), w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d')!.drawImage(img, 0, 0, w, h);
      setLogo(cv.toDataURL('image/png')); URL.revokeObjectURL(url);
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Could not read that image.', true); };
    img.src = url;
  };
  return (
    <div className="qt-logo">
      <label className="btn sm quiet qt-logo-pick">{logo ? 'Change logo' : 'Add logo'}<input type="file" accept="image/*" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
      {logo && <><img src={logo} alt="" className="qt-logo-thumb" /><button type="button" className="btn sm quiet" onClick={() => setLogo(null)}>Remove</button></>}
      <small className="qt-hint">Stays in your browser. Adding one raises error correction so the code still scans.</small>
    </div>
  );
}

/* What each QR type encodes. */
export type QrKind = 'link' | 'wifi' | 'email' | 'phone' | 'sms' | 'whatsapp' | 'contact' | 'location' | 'text';
export const QR_KINDS: { value: QrKind; label: string }[] = [
  { value: 'link', label: 'Link' }, { value: 'wifi', label: 'Wi-Fi' }, { value: 'email', label: 'Email' }, { value: 'phone', label: 'Phone' }, { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' }, { value: 'contact', label: 'Contact card' }, { value: 'location', label: 'Location' }, { value: 'text', label: 'Plain text' },
];
type QrForm = Record<string, string>;
const wifiEsc = (v: string) => v.replace(/([\\;,:"])/g, '\\$1');
const vEsc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([;,])/g, '\\$1');
const digits = (v: string) => v.replace(/[^\d]/g, '');
const phoneClean = (v: string) => v.replace(/[^\d+]/g, '');
export function qrPayload(k: QrKind, f: QrForm): string {
  const g = (x: string) => (f[x] ?? '').trim();
  switch (k) {
    case 'link': { const u = g('url'); return u && !/^[a-z][a-z0-9+.-]*:/i.test(u) ? `https://${u}` : u; }
    case 'wifi': { const enc = f.enc || 'WPA'; return g('ssid') ? `WIFI:T:${enc};S:${wifiEsc(f.ssid)};${enc === 'nopass' ? '' : `P:${wifiEsc(f.pass ?? '')};`}H:${f.hidden === '1' ? 'true' : 'false'};;` : ''; }
    case 'email': { if (!g('to')) return ''; const q = [g('subject') && `subject=${encodeURIComponent(g('subject'))}`, g('body') && `body=${encodeURIComponent(g('body'))}`].filter(Boolean).join('&'); return `mailto:${g('to')}${q ? `?${q}` : ''}`; }
    case 'phone': return g('phone') ? `tel:${phoneClean(g('phone'))}` : '';
    case 'sms': return g('phone') ? `SMSTO:${phoneClean(g('phone'))}:${f.message ?? ''}` : '';
    case 'whatsapp': return digits(g('phone')) ? `https://wa.me/${digits(g('phone'))}${g('message') ? `?text=${encodeURIComponent(g('message'))}` : ''}` : '';
    case 'contact': {
      if (!g('first') && !g('last') && !g('org')) return '';
      const L = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vEsc(g('last'))};${vEsc(g('first'))};;;`, `FN:${vEsc([g('first'), g('last')].filter(Boolean).join(' ') || g('org'))}`];
      if (g('org')) L.push(`ORG:${vEsc(g('org'))}`);
      if (g('phone')) L.push(`TEL;TYPE=CELL:${phoneClean(g('phone'))}`);
      if (g('email')) L.push(`EMAIL:${vEsc(g('email'))}`);
      if (g('url')) L.push(`URL:${g('url')}`);
      L.push('END:VCARD'); return L.join('\r\n');
    }
    case 'location': {
      const v = g('loc');
      const at = /^https?:/i.test(v) ? (v.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) ?? v.match(/[?&](?:q|ll|query|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/i)) : null;
      const m = at ?? v.match(/^(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
      return m ? `geo:${m[1]},${m[2]}` : '';
    }
    default: return f.text ?? '';
  }
}
const QR_LAST = 'jhino-qr-kind';
const wifiOpts = [{ value: 'WPA', label: 'WPA/WPA2' }, { value: 'WEP', label: 'WEP' }, { value: 'nopass', label: 'No password' }];
function QrFields({ kind, f, set }: { kind: QrKind; f: QrForm; set: (k: string, v: string) => void }) {
  const inp = (k: string, label: string, ph = '', type = 'text') => <label className="field sm"><span>{label}</span><input className="input" type={type} value={f[k] ?? ''} placeholder={ph} onChange={(e) => set(k, e.target.value)} /></label>;
  const area = (k: string, label: string, rows = 3) => <label className="field sm"><span>{label}</span><textarea className="textarea" rows={rows} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></label>;
  switch (kind) {
    case 'link': return inp('url', 'Link', 'https://jhino.com', 'url');
    case 'wifi': return <>{inp('ssid', 'Network name (SSID)')}
      <div className="qt-row"><label className="field sm"><span>Security</span><Select label="Security" size="sm" value={f.enc || 'WPA'} options={wifiOpts} onChange={(v) => set('enc', v)} /></label>
        {f.enc !== 'nopass' && inp('pass', 'Password')}</div>
      <label className="tp-toggle"><input type="checkbox" checked={f.hidden === '1'} onChange={(e) => set('hidden', e.target.checked ? '1' : '0')} /><i aria-hidden="true" /><span>Hidden network</span></label></>;
    case 'email': return <>{inp('to', 'To', 'name@example.com', 'email')}{inp('subject', 'Subject')}{area('body', 'Message')}</>;
    case 'phone': return inp('phone', 'Phone number', '+977 98…', 'tel');
    case 'sms': return <>{inp('phone', 'Phone number', '+977 98…', 'tel')}{area('message', 'Message', 2)}</>;
    case 'whatsapp': return <>{inp('phone', 'WhatsApp number with country code', '+977 98…', 'tel')}{area('message', 'Message (optional)', 2)}</>;
    case 'contact': return <><div className="qt-row">{inp('first', 'First name')}{inp('last', 'Last name')}</div>{inp('org', 'Company')}<div className="qt-row">{inp('phone', 'Phone', '', 'tel')}{inp('email', 'Email', '', 'email')}</div>{inp('url', 'Website', 'https://')}</>;
    case 'location': return <>{inp('loc', 'Latitude, longitude or a Maps link', '27.7172, 85.3240')}<small className="qt-hint">Paste "27.7172, 85.3240" or a Google Maps link that has the coordinates in it.</small></>;
    default: return area('text', 'Text', 4);
  }
}

/* ---------------- QR maker ---------------- */
export function QrMaker({ templates }: { templates?: boolean } = {}) {
  const [kind, setKind] = useState<QrKind>(() => { try { const v = localStorage.getItem(QR_LAST) as QrKind | null; return v && QR_KINDS.some((k) => k.value === v) ? v : 'link'; } catch { return 'link'; } });
  const [forms, setForms] = useState<Record<string, QrForm>>({ link: { url: 'https://jhino.com' } });
  const [plain, setPlain] = useState('https://jhino.com');
  const [fg, setFg] = useState('#141414'), [bg, setBg] = useState('#ffffff');
  const [logo, setLogo] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const f = forms[kind] ?? {};
  const text = templates ? qrPayload(kind, f) : plain;
  const tooLong = text.length > 1200;
  const svgText = () => wrap.current?.querySelector('svg')?.outerHTML ?? '';
  const download = (href: string, name: string) => { const a = document.createElement('a'); a.href = href; a.download = name; a.click(); };
  const pickKind = (k: QrKind) => { setKind(k); try { localStorage.setItem(QR_LAST, k); } catch { /* private mode */ } };
  return (
    <>
      {templates ? (
        <>
          <label className="field sm"><span>Type</span><Select label="QR type" value={kind} options={QR_KINDS} onChange={pickKind} /></label>
          <QrFields kind={kind} f={f} set={(k, v) => setForms((x) => ({ ...x, [kind]: { ...x[kind], [k]: v } }))} />
        </>
      ) : <label className="field sm"><span>Link or text</span><textarea className="textarea" rows={3} value={plain} onChange={(e) => setPlain(e.target.value)} /></label>}
      <div className="qt-row">
        <label className="field sm"><span>Colour</span><input type="color" value={fg} onChange={(e) => setFg(e.target.value)} /></label>
        <label className="field sm"><span>Background</span><input type="color" value={bg} onChange={(e) => setBg(e.target.value)} /></label>
      </div>
      <QrLogoField logo={logo} setLogo={setLogo} />
      {tooLong ? <p className="error-text">Too long for one QR code (1,200 characters at most).</p>
        : !text ? <p className="qt-hint">Fill in the form and your code shows here.</p>
        : <div className="qt-qr" ref={wrap}><QrSvg text={text} fg={fg} bg={bg} size={220} logo={logo} /></div>}
      <div className="qt-row">
        <button className="btn sm" disabled={tooLong || !text} onClick={() => download(URL.createObjectURL(new Blob([svgText()], { type: 'image/svg+xml' })), 'qr-code.svg')}>Download SVG</button>
        <button className="btn sm" disabled={tooLong || !text} onClick={() => {
          const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 1024; c.getContext('2d')!.drawImage(img, 0, 0, 1024, 1024); download(c.toDataURL('image/png'), 'qr-code.png'); };
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText());
        }}>Download PNG</button>
      </div>
      <p className="qt-hint">This code always opens exactly what it holds. To change where a printed code goes later, use a Dynamic QR.</p>
    </>
  );
}

/* ---------------- text tools (in the browser only) ---------------- */
const sentence = (s: string) => s.toLowerCase().replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu, (m) => m.toUpperCase());
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s\-_/(])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
export function TextTools() {
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
  const load = useCallback(() => { get<typeof d>('/api/tools-today').then(setD, () => setD({ tasks: [], events: [], subs: [], openTasks: 0 })); }, []);
  useEffect(() => { load(); addEventListener('jhino-tools-changed', load); return () => removeEventListener('jhino-tools-changed', load); }, [load]);
  const open = (t: string) => window.dispatchEvent(new CustomEvent('jhino-tool', { detail: t }));
  const all = d ? [
    ...d.tasks.map((i) => ({ i, k: 'Task', late: !!i.dueAt && new Date(i.dueAt) < new Date() })),
    ...d.events.map((i) => ({ i, k: 'Event', late: false })),
    ...d.subs.map((i) => ({ i, k: i.cycle === 'trial' ? 'Trial ends' : 'Renews', late: false })),
  ].sort((a, b) => String(a.i.dueAt).localeCompare(String(b.i.dueAt))) : [];
  const end = new Date(); end.setHours(23, 59, 59, 999);
  return (
    <section className="hm-card" aria-labelledby="day-h">
      <div className="hm-card-h"><h2 id="day-h">Your day{d && <small>{d.openTasks} open {d.openTasks === 1 ? 'task' : 'tasks'}</small>}</h2><button className="link" onClick={() => open('tasks')}>All tasks</button></div>
      {!d ? <PanelLoader /> : (
        <>
          <div className="hm-stats"><div><b>{d.openTasks}</b><span>Open</span></div><div><b>{all.filter((x) => new Date(x.i.dueAt!) <= end).length}</b><span>Due today</span></div><div><b>{d.subs.length}</b><span>Renewals this week</span></div></div>
          {!all.length ? <p className="hm-empty">Nothing due today or tomorrow. <button className="link" onClick={() => open('tasks')}>Add a task</button> or <button className="link" onClick={() => open('calendar')}>an event</button>.</p> : (
            <ul className="hm-list">{all.slice(0, 5).map(({ i, k, late }) => (
              <li key={i.id}><span className="t"><b>{i.title || i.service}</b><small>{k}</small></span><span className={`hm-kind ${late ? 'late' : ''}`}>{late ? 'Overdue' : when(i.dueAt)}</span></li>
            ))}</ul>
          )}
        </>
      )}
    </section>
  );
}
