import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, get, type AppSummary } from '../api';
import { Link, useRoute, useSession } from '../context';
import { live } from '../live';
import { PanelLoader } from '../Loader';
import { Icon, ago, useToast } from '../ui';
import { Brand, appPathOf } from './Apps';
import { HomeApps } from './Tools';
import { Welcome } from '../Welcome';
import type { InterestState } from '../appsPrefs';

/*
 * Home: a simple dashboard. A greeting, one notice when something needs you, and two cards: your apps
 * (pinned first) and your tasks and reminders. Search, filters and sorting stay on My apps.
 */
interface Line { action: string; detail: string; at: string; name: string | null }
interface Pulse { unread: number; last: Line | null; lastNew?: Line | null }
interface Day { tasks: any[]; events: any[]; subs: any[]; openTasks: number }
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const lastAt = (a: AppSummary, p?: Pulse) => p?.last?.at ?? a.updatedAt ?? a.createdAt;
const openTool = (t: string) => window.dispatchEvent(new CustomEvent('jhino-tool', { detail: t }));
const Chevron = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>;

export function HomePage() {
  const { user } = useSession();
  const { go } = useRoute();
  const toast = useToast();
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [pulse, setPulse] = useState<Record<string, Pulse>>({});
  const [day, setDay] = useState<Day | null>(null);
  const [pins, setPins] = useState<string[]>([]);
  const [welcome, setWelcome] = useState(false);
  useEffect(() => { if (user.canCreate) get<InterestState>('/api/home/interests').then((r) => setWelcome(r.onboard), () => {}); }, [user.canCreate]);

  const load = useCallback(() => {
    get<{ apps: AppSummary[] }>('/api/apps').then((r) => setApps(r.apps), () => setApps([]));
    get<{ apps: Record<string, Pulse> }>('/api/activity/summary').then((r) => setPulse(r.apps), () => {});
    get<Day>('/api/tools-today').then(setDay, () => setDay({ tasks: [], events: [], subs: [], openTasks: 0 }));
  }, []);
  useEffect(() => { load(); get<{ ids: string[] }>('/api/home/pins').then((r) => setPins(r.ids), () => {}); }, [load]);
  useEffect(() => live.on((e) => { if (e === 'apps-changed' || e === 'activity' || e === 'online') load(); }), [load]);
  // Tasks added in the tools panel show here straight away.
  useEffect(() => { const on = () => { get<Day>('/api/tools-today').then(setDay, () => {}); }; addEventListener('jhino-tools-changed', on); return () => removeEventListener('jhino-tools-changed', on); }, []);

  const togglePin = async (id: string) => {
    const before = pins, next = pins.includes(id) ? pins.filter((x) => x !== id) : [...pins, id];
    setPins(next);
    try { setPins((await api<{ ids: string[] }>('PUT', '/api/home/pins', { ids: next })).ids); } catch { setPins(before); toast('Could not save that pin.', true); }
  };
  const list = useMemo(() => {
    const all = apps ?? [];
    const pinned = pins.map((id) => all.find((a) => a.id === id)).filter(Boolean) as AppSummary[];
    const rest = all.filter((a) => !pins.includes(a.id)).sort((x, y) => (lastAt(y, pulse[y.id]) > lastAt(x, pulse[x.id]) ? 1 : -1));
    return [...pinned, ...rest].slice(0, 6);
  }, [apps, pins, pulse]);

  const due = day ? [
    ...day.tasks.map((i) => ({ i, k: 'Task', late: new Date(i.dueAt) < new Date() })),
    ...day.events.map((i) => ({ i, k: 'Event', late: false })),
    ...day.subs.map((i) => ({ i, k: i.cycle === 'trial' ? 'Trial ends' : 'Renews', late: false })),
  ].sort((a, b) => String(a.i.dueAt).localeCompare(String(b.i.dueAt))) : [];
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  const dueToday = due.filter((d) => new Date(d.i.dueAt) <= endToday).length;
  const late = due.filter((d) => d.late).length;
  const fresh = (apps ?? []).filter((a) => (pulse[a.id]?.unread ?? 0) > 0);
  const first = (user.displayName || user.name).split(' ')[0];

  // One notice, only when something needs you.
  const notice = !apps ? null
    : apps.length === 0 && user.canCreate ? { btn: 'Create your first app', go: () => go('/build'), title: 'Put your first app online.', text: 'Create one for a client, or upload the HTML you already have.' }
      : late > 0 ? { btn: 'Open tasks', go: () => openTool('tasks'), title: `${late} ${late === 1 ? 'task is' : 'tasks are'} overdue.`, text: 'Finish them or give them a new date.' }
        : fresh.length > 0 ? { btn: 'See what is new', go: () => go(appPathOf(fresh[0])), title: `${fresh.length} ${fresh.length === 1 ? 'app has' : 'apps have'} something new.`, text: fresh.slice(0, 3).map((a) => a.name).join(', ') + (fresh.length > 3 ? ' and more.' : '.') }
          : null;

  return (
    <main className="page hm">
      <div className="hm-head">
        <div>
          <h1>{greeting()}, {first}</h1>
          <p>{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        {user.canCreate && (
          <div className="hm-acts">
            <Link to="/links" className="btn"><Icon name="link" size={16} />Short link</Link>
            <Link to="/help?kind=feedback" className="btn"><Icon name="spark" size={16} />Request a feature</Link>
          </div>
        )}
      </div>

      {notice && (
        <section className="hm-card hm-notice">
          <button className="btn primary" onClick={notice.go}>{notice.btn}</button>
          <div><b>{notice.title}</b><p>{notice.text}</p></div>
        </section>
      )}

      {user.canCreate && <HomeApps />}
      {welcome && <Welcome onClose={() => setWelcome(false)} />}

      <div className="hm-grid">
        <section className="hm-card" aria-labelledby="hm-apps">
          <div className="hm-card-h"><h2 id="hm-apps">{user.canCreate ? 'Your apps' : 'Apps shared with you'}{apps && <small>{apps.length} {apps.length === 1 ? 'app' : 'apps'}</small>}</h2><Link to="/apps">Open all</Link></div>
          {!apps ? <PanelLoader /> : !list.length ? <p className="hm-empty">No apps yet.</p> : (
            <ul className="hm-list">{list.map((a) => {
              const l = pulse[a.id]?.lastNew ?? pulse[a.id]?.last;
              const pinned = pins.includes(a.id);
              return (
                <li key={a.id} className="hm-row">
                  <Brand a={a} />
                  <Link to={appPathOf(a)} className="t"><b>{a.name}</b><small>{l ? `${l.name ?? 'A guest'} ${l.name ? l.action : l.action.replace(/ as a guest$/, '')} ${l.detail}` : a.role === 'owner' ? 'Yours' : 'Shared with you'} · {ago(lastAt(a, pulse[a.id]))}</small></Link>
                  {(pulse[a.id]?.unread ?? 0) > 0 && <span className="ix-new">{pulse[a.id].unread} new</span>}
                  <button className={`icon-btn hm-pin ${pinned ? 'on' : ''}`} aria-pressed={pinned} aria-label={pinned ? `Unpin ${a.name}` : `Pin ${a.name}`} title={pinned ? 'Unpin' : 'Pin to the top'} onClick={() => togglePin(a.id)}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M9 3h6l-1 6 4 3v2h-5v7l-1 1-1-1v-7H6v-2l4-3z" /></svg>
                  </button>
                  <Link to={appPathOf(a)} className="hm-go" aria-hidden="true" tabIndex={-1}><Chevron /></Link>
                </li>
              );
            })}</ul>
          )}
        </section>

        <section className="hm-card" aria-labelledby="hm-day">
          <div className="hm-card-h"><h2 id="hm-day">Tasks and reminders{day && <small>{day.openTasks} open</small>}</h2><button className="link" onClick={() => openTool('tasks')}>All tasks</button></div>
          {!day ? <PanelLoader /> : (
            <>
              <div className="hm-stats"><div><b>{day.openTasks}</b><span>Open</span></div><div><b>{dueToday}</b><span>Due today</span></div><div><b>{day.subs.length}</b><span>Renewals this week</span></div></div>
              {!due.length ? <p className="hm-empty">Nothing due today or tomorrow. <button className="link" onClick={() => openTool('tasks')}>Add a task</button></p> : (
                <ul className="hm-list">{due.slice(0, 5).map(({ i, k, late: l }) => (
                  <li key={i.id}><span className="t"><b>{i.title || i.service}</b><small>{k}</small></span><span className={`hm-kind ${l ? 'late' : ''}`}>{l ? 'Overdue' : when(i.dueAt)}</span></li>
                ))}</ul>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
