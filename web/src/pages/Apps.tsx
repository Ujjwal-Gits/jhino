import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, get, post, type AppDetail, type AppSummary, type Features } from '../api';
import { Link, useRoute, useSession } from '../context';
import { live } from '../live';
import { Avatar, Icon, Mark, Menu, Select, ago, useToast } from '../ui';
import { UploadDialog } from './Shell';
import { ShareDialog } from './Share';
import { downloadHtml } from './Player';

export function dataMode(f: Features, built?: boolean): { dot: string; text: string; long: string } {
  if (built) return { dot: 'ok', text: 'Created in Jhino', long: 'Created with Create HTML. Every record and file is stored on this server, checked by the server, and shown to everyone with access, live.' };
  // localStorage, window.storage and IndexedDB are all saved on the server and synced.
  if (f.jhinoSdk || f.localStorage || f.claudeStorage || f.indexedDB) {
    return { dot: 'ok', text: 'Saves to server', long: 'What people save in this app is stored on this server and appears for everyone with access, live.' };
  }
  return { dot: '', text: 'Hosted page', long: 'Jhino found no saved data in this app. It is hosted as a page; nothing people type is kept.' };
}

interface Line { id: number; action: string; detail: string; at: string; name: string | null; userId: string | null; note: string | null }
interface Pulse { unread: number; last: Line | null; lastNew?: Line | null }
const FIELD: Record<string, string> = { video: 'Video production', photo: 'Photography', design: 'Design and branding', social: 'Social media', apps: 'App development', web: 'Website', studio: 'Studio bookings', other: 'Client room' };
type Kind = 'all' | 'created' | 'uploaded';
type Sort = 'recent' | 'name' | 'new';

function readPref<T extends string>(key: string, allowed: T[], fallback: T): T {
  try { const v = localStorage.getItem(key) as T | null; return v && allowed.includes(v) ? v : fallback; } catch { return fallback; }
}
function savePref(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* private mode */ } }
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const lastAt = (a: AppSummary, p?: Pulse) => p?.last?.at ?? a.updatedAt;

/** The latest thing that happened, as one line: "Everest Tea commented on “Brand film” in Video deliveries". */
export function LastLine({ line }: { line: Line | null }) {
  if (!line) return <p className="ap-last muted">Nothing has happened here yet.</p>;
  return (
    <p className="ap-last">
      <Avatar name={line.name ?? '?'} size="sm" />
      <span><b>{line.name ?? 'Someone'}</b> {line.action} <span className="muted">{line.detail}</span>
        {line.note && <span className="ap-note">“{line.note}”</span>}</span>
    </p>
  );
}
function People({ a, meId }: { a: AppSummary; meId: string }) {
  const others = a.members.filter((m) => m.id !== meId);
  if (!others.length) return <span className="ap-people" />;
  return (
    <span className="ap-people" title={others.map((m) => m.name).join(', ')}>
      <span className="stack">{others.slice(0, 3).map((m) => <Avatar key={m.id} name={m.name} size="sm" />)}</span>
      {others.length > 3 && <span className="muted">+{others.length - 3}</span>}
    </span>
  );
}
function Brand({ a, large }: { a: AppSummary; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (a.brand?.logo && !failed) return <span className={`ap-logo ${large ? 'lg' : ''}`}><img src={`/api/apps/${a.id}/logo`} alt="" onError={() => setFailed(true)} /></span>;
  return <Mark name={a.brand?.client || a.name} large={large} />;
}

export function AppsPage({ view }: { view: 'mine' | 'shared' | 'trash' }) {
  const { user } = useSession();
  const { go } = useRoute();
  const toast = useToast();
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [pulse, setPulse] = useState<Record<string, Pulse>>({});
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [sort, setSort] = useState<Sort>(() => readPref('jhino-sort', ['recent', 'name', 'new'], 'recent'));
  const [upload, setUpload] = useState(false);
  const [menu, setMenu] = useState<{ a: AppSummary; el: HTMLElement } | null>(null);
  const [share, setShare] = useState<AppSummary | null>(null);
  const pulseTimer = useRef<number | undefined>(undefined);

  const loadPulse = useCallback(() => {
    get<{ apps: Record<string, Pulse> }>('/api/activity/summary').then((r) => setPulse(r.apps), () => {});
  }, []);
  const load = useCallback(() => {
    get<{ apps: AppSummary[] }>(view === 'trash' ? '/api/apps?trash=1' : '/api/apps')
      .then((r) => { setApps(r.apps); setError(''); }, (e) => setError(e instanceof ApiError ? e.message : 'Could not load apps.'));
    if (view !== 'trash') loadPulse();
  }, [view, loadPulse]);
  useEffect(() => { setApps(null); load(); }, [load]);
  useEffect(() => live.on((e) => {
    if (e === 'apps-changed' || e === 'online') load();
    // Someone did something in one of my apps: refresh the lines and counts (at most every second).
    if (e === 'activity') { window.clearTimeout(pulseTimer.current); pulseTimer.current = window.setTimeout(loadPulse, 800); }
  }), [load, loadPulse]);
  useEffect(() => {
    const f = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [load]);

  const inView = useMemo(() => (apps ?? []).filter((a) => view === 'trash' || (view === 'mine' ? a.role === 'owner' : a.role !== 'owner')), [apps, view]);
  const shown = useMemo(() => {
    let list = inView.filter((a) => kind === 'all' || (kind === 'created' ? a.built : !a.built));
    const s = q.trim().toLowerCase();
    if (s) list = list.filter((a) => [a.name, a.brand?.client, ...a.members.map((m) => m.name)].some((x) => x && x.toLowerCase().includes(s)));
    const fresh = (a: AppSummary) => ((pulse[a.id]?.unread ?? 0) > 0 ? 1 : 0);
    const by = { recent: (x: AppSummary, y: AppSummary) => (fresh(y) - fresh(x)) || (lastAt(y, pulse[y.id]) > lastAt(x, pulse[x.id]) ? 1 : -1), name: (x: AppSummary, y: AppSummary) => x.name.localeCompare(y.name), new: (x: AppSummary, y: AppSummary) => (y.createdAt > x.createdAt ? 1 : -1) }[sort];
    return list.slice().sort(by);
  }, [inView, kind, q, sort, pulse]);
  const attention = useMemo(() => inView.filter((a) => (pulse[a.id]?.unread ?? 0) > 0).sort((x, y) => lastAt(y, pulse[y.id]) > lastAt(x, pulse[x.id]) ? 1 : -1), [inView, pulse]);

  // A client with just one app goes straight into it (once per visit, so Back still works).
  useEffect(() => {
    if (user.canCreate || view !== 'shared' || !apps || apps.length !== 1) return;
    try { if (sessionStorage.getItem('jhino-opened')) return; sessionStorage.setItem('jhino-opened', '1'); } catch { /* ignore */ }
    go(`/apps/${apps[0].id}`, true);
  }, [apps, user.canCreate, view, go]);

  const restore = async (a: AppSummary) => {
    try { await post(`/api/apps/${a.id}/restore`); toast(`${a.name} restored`); load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not restore.', true); }
  };
  const destroy = async (a: AppSummary) => {
    if (!confirm(`Delete “${a.name}” for good? Its files and all saved data will be removed. This cannot be undone.`)) return;
    try { await api('DELETE', `/api/apps/${a.id}`); toast(`${a.name} deleted`); load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete.', true); }
  };
  const trash = async (a: AppSummary) => {
    try { await post(`/api/apps/${a.id}/trash`); toast(`${a.name} moved to Trash. Restore it from Trash any time.`); load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not move it to Trash.', true); }
  };
  const setS = (s: Sort) => { setSort(s); savePref('jhino-sort', s); };

  const title = view === 'mine' ? 'My apps' : view === 'shared' ? (user.canCreate ? 'Shared with me' : 'Your apps') : 'Trash';
  const clients = new Set(inView.map((a) => a.brand?.client).filter(Boolean)).size;
  const counts = { all: inView.length, created: inView.filter((a) => a.built).length, uploaded: inView.filter((a) => !a.built).length };

  const moreButton = (a: AppSummary) => (
    <button className="icon-btn ap-more" aria-label={`More for ${a.name}`} aria-haspopup="menu" aria-expanded={menu?.a.id === a.id}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ a, el: e.currentTarget }); }}><Icon name="more" /></button>
  );

  const kindWord = (a: AppSummary) => (a.built ? FIELD[a.brand?.field ?? 'other'] ?? 'Client room' : `Uploaded HTML, v${a.liveVersion}`);

  /** Who it is for, when the name does not already say it. */
  const clientOf = (a: AppSummary) => {
    const c = a.brand?.client || (a.built ? '' : kindWord(a));
    return c && !a.name.toLowerCase().includes(c.toLowerCase()) ? c : '';
  };
  /** One app, one row: mark, name, the latest thing that happened, people, what is new. */
  const row = (a: AppSummary) => {
    const p = pulse[a.id];
    const line = p?.lastNew ?? p?.last ?? null;
    const client = clientOf(a);
    return (
      <li key={a.id} className={`ix-row ${p?.unread ? 'is-new' : ''}`}>
        <Link to={`/apps/${a.id}`} className="ix-hit"><span className="sr-only">Open {a.name}</span></Link>
        <Brand a={a} />
        <div className="ix-name">
          <p className="ix-title"><b>{a.name}</b>{client && <span className="ix-client">{client}</span>}</p>
          <p className="ix-last">
            {line ? <><b>{line.name ?? 'Someone'}</b> {line.action} <span className="ix-where">{line.detail}</span></>
              : <span className="ix-where">Nothing has happened here yet.</span>}
          </p>
        </div>
        <People a={a} meId={user.id} />
        <div className="ix-meta">
          {p?.unread ? <span className="ix-new">{p.unread > 99 ? '99+' : p.unread} new</span> : null}
          <span className="ix-when">{ago(lastAt(a, p))}</span>
        </div>
        {moreButton(a)}
      </li>
    );
  };
  const trashList = (
    <ul className="ix" role="list">
      {shown.map((a) => (
        <li key={a.id} className="ix-row trashed">
          <Brand a={a} />
          <div className="ix-name">
            <p className="ix-title"><b>{a.name}</b>{clientOf(a) && <span className="ix-client">{clientOf(a)}</span>}</p>
            <p className="ix-last"><span className="ix-where">Moved to Trash {ago(a.deletedAt)}. Kept until you delete it for good.</span></p>
          </div>
          <div className="ix-actions">
            <button className="btn sm" onClick={() => restore(a)}><Icon name="refresh" size={15} />Restore</button>
            <button className="btn sm quiet danger" onClick={() => destroy(a)}>Delete for good</button>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <main className="page apps-page">
      <header className="ix-head">
        <h1>{title}</h1>
        {apps && inView.length > 0 && view !== 'trash' && (
          <p className="ix-sum">
            {inView.length} {inView.length === 1 ? 'app' : 'apps'}
            {clients > 0 && <> for {clients} {clients === 1 ? 'client' : 'clients'}</>}
            {attention.length > 0 && <> · <span className="hot">{attention.length} with something new</span></>}
          </p>
        )}
      </header>

      {error && <p className="error-text" role="alert" style={{ marginBottom: 16 }}>{error} <button className="btn sm" onClick={load}>Try again</button></p>}

      {apps && inView.length === 0 && view === 'mine' ? (
        <section className="start" aria-labelledby="first-app">
          <h2 id="first-app">Put your first app online.</h2>
          <p className="lede">Upload your HTML, or create one for a client. Share it with a sign-in, and both of you see the same data, photos and videos, live.</p>
          <div className="start-grid">
            <button className="start-card" onClick={() => setUpload(true)}>
              <span className="n mono">01</span>
              <b>Upload HTML</b>
              <span>Your .html file or a .zip. It goes live right away, and whatever anyone adds or changes is saved on this server for everyone.</span>
              <span className="go">Choose a file <Icon name="upload" size={16} /></span>
            </button>
            <button className="start-card" onClick={() => go('/build')}>
              <span className="n mono">02</span>
              <b>Create HTML</b>
              <span>A client room made for you: video approvals, photo picks, receipts, to-dos, messages and more.</span>
              <span className="go">Create HTML <Icon name="blocks" size={16} /></span>
            </button>
          </div>
          <p className="hint" style={{ marginTop: 14 }}>You can also drop an .html or .zip file anywhere on this page.</p>
        </section>
      ) : apps && inView.length === 0 ? (
        <p className="empty-line">
          {view === 'shared' ? (user.canCreate ? 'Nothing is shared with you yet. When someone adds you to an app, it shows up here.' : 'No apps are shared with you right now. Ask the person who gave you your sign-in.') : 'Trash is empty. Apps you move here stay until you delete them for good.'}
        </p>
      ) : apps === null ? (
        <ul className="ix">{[0, 1, 2].map((i) => <li key={i} className="ix-row ix-skel" />)}</ul>
      ) : (
        <>
          <div className="ix-tools">
            <label className="ix-search">
              <Icon name="search" size={16} />
              <span className="sr-only">Search apps</span>
              <input placeholder="Search apps, clients, people" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            {view === 'mine' && (
              <div className="ix-filter" role="group" aria-label="Show">
                {([['all', 'All'], ['created', 'Created'], ['uploaded', 'Uploaded']] as [Kind, string][]).map(([k, l]) => (
                  <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}<span>{counts[k]}</span></button>
                ))}
              </div>
            )}
            {view !== 'trash' && (
              <Select label="Order" size="sm" width={168} value={sort} onChange={setS}
                options={[{ value: 'recent', label: 'Latest activity' }, { value: 'name', label: 'Name, A to Z' }, { value: 'new', label: 'Newest first' }]} />
            )}
          </div>

          {shown.length === 0 ? <p className="empty-line">No apps match{q ? ` “${q}”` : ''}.</p>
            : view === 'trash' ? trashList
              : <ul className="ix" role="list">{shown.map(row)}</ul>}
        </>
      )}

      {menu && (
        <Menu anchor={menu.el} onClose={() => setMenu(null)}>
          <button role="menuitem" onClick={() => go(`/apps/${menu.a.id}`)}>Open</button>
          <button role="menuitem" onClick={() => window.open(`/apps/${menu.a.id}`, '_blank', 'noopener')}>Open in a new tab</button>
          <button role="menuitem" onClick={async () => { const id = menu.a.id; setMenu(null); const fail = await downloadHtml(id); toast(fail ?? 'Downloaded. Open the file, sign in once, and it stays in sync.', !!fail); }}>Download as HTML file</button>
          {menu.a.role === 'owner' && <button role="menuitem" onClick={() => setShare(menu.a)}>Share and sign-ins</button>}
          {menu.a.role === 'owner' && menu.a.built && <button role="menuitem" onClick={() => go(`/apps/${menu.a.id}/blocks`)}>Edit features and design</button>}
          {menu.a.role === 'owner' && <><hr /><button role="menuitem" className="danger" onClick={() => trash(menu.a)}>Move to Trash</button></>}
        </Menu>
      )}
      {share && <ShareDialog app={share as AppDetail} onClose={() => { setShare(null); load(); }} />}
      {upload && <UploadDialog onClose={() => { setUpload(false); load(); }} />}
    </main>
  );
}
