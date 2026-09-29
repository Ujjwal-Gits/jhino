import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, get, type AppSummary } from '../api';
import { Link, useRoute, useSession } from '../context';
import { live } from '../live';
import { PanelLoader } from '../Loader';
import { Icon, ago, useToast } from '../ui';
import { Brand, appPathOf } from './Apps';
import { UploadDialog } from './Shell';

/*
 * Home: the signed-in dashboard. A greeting, the day's tasks and reminders, what happened across the
 * person's apps, their pinned apps (in their own order) and the latest ones, with the common actions
 * one click away. Search, filters and sorting stay on My apps.
 */
interface Line { action: string; detail: string; at: string; name: string | null }
interface Pulse { unread: number; last: Line | null; lastNew?: Line | null }
interface Day { tasks: any[]; events: any[]; subs: any[]; openTasks: number }
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const lastAt = (a: AppSummary, p?: Pulse) => p?.last?.at ?? a.updatedAt ?? a.createdAt;

export function HomePage() {
  const { user } = useSession();
  const { go } = useRoute();
  const toast = useToast();
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [pulse, setPulse] = useState<Record<string, Pulse>>({});
  const [day, setDay] = useState<Day | null>(null);
  const [pins, setPins] = useState<string[] | null>(null);
  const [upload, setUpload] = useState(false);

  const load = useCallback(() => {
    get<{ apps: AppSummary[] }>('/api/apps').then((r) => setApps(r.apps), () => setApps([]));
    get<{ apps: Record<string, Pulse> }>('/api/activity/summary').then((r) => setPulse(r.apps), () => {});
    get<Day>('/api/tools-today').then(setDay, () => setDay({ tasks: [], events: [], subs: [], openTasks: 0 }));
  }, []);
  useEffect(() => { load(); get<{ ids: string[] }>('/api/home/pins').then((r) => setPins(r.ids), () => setPins([])); }, [load]);
  useEffect(() => live.on((e) => { if (e === 'apps-changed' || e === 'activity' || e === 'online') load(); }), [load]);

  const savePins = async (next: string[]) => {
    const before = pins; setPins(next);
    try { const r = await api<{ ids: string[] }>('PUT', '/api/home/pins', { ids: next }); setPins(r.ids); }
    catch { setPins(before); toast('Could not save your pinned apps.', true); }
  };
  const byId = useMemo(() => new Map((apps ?? []).map((a) => [a.id, a])), [apps]);
  const pinned = (pins ?? []).map((id) => byId.get(id)).filter(Boolean) as AppSummary[];
  const recent = useMemo(() => (apps ?? []).filter((a) => !(pins ?? []).includes(a.id)).sort((x, y) => (lastAt(y, pulse[y.id]) > lastAt(x, pulse[x.id]) ? 1 : -1)).slice(0, 8), [apps, pins, pulse]);
  const activity = useMemo(() => (apps ?? []).flatMap((a) => { const l = pulse[a.id]?.lastNew ?? pulse[a.id]?.last; return l ? [{ a, l, unread: pulse[a.id]?.unread ?? 0 }] : []; })
    .sort((x, y) => (y.l.at > x.l.at ? 1 : -1)).slice(0, 6), [apps, pulse]);
  const due = day ? [
    ...day.tasks.map((i) => ({ i, k: 'Task', late: new Date(i.dueAt) < new Date() })),
    ...day.events.map((i) => ({ i, k: 'Event', late: false })),
    ...day.subs.map((i) => ({ i, k: i.cycle === 'trial' ? 'Trial ends' : 'Renews', late: false })),
  ].sort((a, b) => String(a.i.dueAt).localeCompare(String(b.i.dueAt))) : [];
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const dueToday = due.filter((d) => new Date(d.i.dueAt) <= today).length;
  const unread = Object.values(pulse).reduce((n, p) => n + (p.unread || 0), 0);
  const first = (user.displayName || user.name).split(' ')[0];

  const card = (a: AppSummary, isPinned: boolean, idx = 0) => {
    const l = pulse[a.id]?.lastNew ?? pulse[a.id]?.last;
    return (
      <li key={a.id} className={`hm-app ${isPinned ? 'pinned' : ''}`}>
        <Link to={appPathOf(a)} className="hit"><span className="sr-only">Open {a.name}</span></Link>
        <div className="hm-app-top"><Brand a={a} /><b>{a.name}</b>{(pulse[a.id]?.unread ?? 0) > 0 && <span className="ix-new">{pulse[a.id].unread} new</span>}</div>
        <small>{l ? `${l.name ?? 'A guest'} ${l.name ? l.action : l.action.replace(/ as a guest$/, '')} ${l.detail}` : a.role === 'owner' ? 'Yours' : 'Shared with you'} · {ago(lastAt(a, pulse[a.id]))}</small>
        <div className="hm-app-acts">
          {isPinned && <button className="icon-btn" aria-label={`Move ${a.name} earlier`} title="Move earlier" disabled={idx === 0} onClick={() => { const n = [...(pins ?? [])]; [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]]; savePins(n); }}><Icon name="back" size={15} /></button>}
          {isPinned && <button className="icon-btn flip" aria-label={`Move ${a.name} later`} title="Move later" disabled={idx === pinned.length - 1} onClick={() => { const n = [...(pins ?? [])]; [n[idx + 1], n[idx]] = [n[idx], n[idx + 1]]; savePins(n); }}><Icon name="back" size={15} /></button>}
          <button className="icon-btn" aria-pressed={isPinned} aria-label={isPinned ? `Unpin ${a.name}` : `Pin ${a.name}`} title={isPinned ? 'Unpin' : 'Pin to the top'}
            onClick={() => savePins(isPinned ? (pins ?? []).filter((x) => x !== a.id) : [...(pins ?? []), a.id])}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M9 3h6l-1 6 4 3v2h-5v7l-1 1-1-1v-7H6v-2l4-3z" /></svg>
          </button>
        </div>
      </li>
    );
  };

  return (
    <main className="page hm">
      <header className="hm-head">
        <div>
          <h1>{greeting()}, {first}</h1>
          <p>{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}{day ? ` · ${dueToday} due today · ${unread} new in your apps` : ''}</p>
        </div>
        {user.canCreate && (
          <div className="hm-acts">
            <button className="btn primary sm" onClick={() => go('/build')}><Icon name="plus" size={15} />Create app</button>
            <button className="btn sm" onClick={() => setUpload(true)}><Icon name="upload" size={15} />Upload HTML</button>
            <Link to="/links" className="btn sm"><Icon name="link" size={15} />Short link</Link>
            <Link to="/help?kind=feedback" className="btn sm"><Icon name="spark" size={15} />Request a feature</Link>
          </div>
        )}
      </header>

      <div className="hm-grid">
        <section className="hm-card" aria-labelledby="hm-day">
          <div className="hm-card-h"><h2 id="hm-day">Tasks and reminders{day && <small>{day.openTasks} open</small>}</h2></div>
          {!day ? <PanelLoader /> : (
            <>
              <div className="hm-stats"><div><b>{day.openTasks}</b><span>Open tasks</span></div><div><b>{dueToday}</b><span>Due today</span></div><div><b>{day.subs.length}</b><span>Renewals this week</span></div></div>
              {!due.length ? <p className="hm-empty">Nothing due today or tomorrow. Add tasks, events and reminders from the quick tools bar.</p> : (
                <ul className="hm-list">{due.slice(0, 6).map(({ i, k, late }) => (
                  <li key={i.id}><span className={`hm-kind ${late ? 'late' : ''}`}>{late ? 'Overdue' : k}</span><span className="t"><b>{i.title || i.service}</b><small>{when(i.dueAt)}</small></span></li>
                ))}</ul>
              )}
            </>
          )}
        </section>
        <section className="hm-card" aria-labelledby="hm-act">
          <div className="hm-card-h"><h2 id="hm-act">Recent activity{unread > 0 && <small>{unread} new</small>}</h2><Link to="/apps">All apps</Link></div>
          {!apps ? <PanelLoader /> : !activity.length ? <p className="hm-empty">Nothing yet. When you or the people you share with add or change something, it shows here.</p> : (
            <ul className="hm-list">{activity.map(({ a, l, unread: n }) => (
              <li key={a.id}><Brand a={a} /><Link to={appPathOf(a)} className="t"><b>{l.name ?? 'A guest'} {l.name ? l.action : l.action.replace(/ as a guest$/, '')} {l.detail}</b><small>{a.name} · {ago(l.at)}</small></Link>{n > 0 && <span className="ix-new">{n} new</span>}</li>
            ))}</ul>
          )}
        </section>
      </div>

      {!apps || !pins ? <PanelLoader label="Loading your apps" /> : !apps.length ? (
        <section className="hm-card"><p className="hm-empty">{user.canCreate ? 'No apps yet. Create one or upload your HTML to get started.' : 'No apps are shared with you yet.'}</p></section>
      ) : (
        <>
          {pinned.length > 0 && <>
            <div className="hm-sec-h"><h2>Pinned</h2><span className="muted small">Use the arrows to change the order</span></div>
            <ul className="hm-apps">{pinned.map((a, i) => card(a, true, i))}</ul>
          </>}
          <div className="hm-sec-h"><h2>{pinned.length ? 'Recent apps' : 'Your apps'}</h2><Link to="/apps" className="small">Search, filter and sort all apps</Link></div>
          {recent.length ? <ul className="hm-apps">{recent.map((a) => card(a, false))}</ul> : <p className="muted small">Every app is pinned.</p>}
        </>
      )}
      {upload && <UploadDialog onClose={() => { setUpload(false); load(); }} />}
    </main>
  );
}
