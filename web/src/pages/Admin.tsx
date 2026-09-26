import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api, avatarUrl, get, post } from '../api';
import { Link, useRoute, useSession } from '../context';
import { Avatar, Icon, Modal, Select, ago, copyText, useToast } from '../ui';
import { refreshPlans } from '../plans';

/*
 * Super Admin: the platform owners' own workspace. A full-height sidebar on the left edge, a working
 * dashboard (money, growth, what needs a hand), and one job per screen after that: customers,
 * payments, QR codes, addresses, short links, support, the audit log and settings.
 */

const npr = (n: number) => `NPR ${Math.round(n).toLocaleString('en-IN')}`;
const fmtDateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const err = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);
const PLAN_OPTS = [{ value: 'free', label: 'Free Forever · 1 app' }, { value: 'plus', label: 'Plus · NPR 500/mo · 10 apps' }, { value: 'pro', label: 'Pro · NPR 2,000/mo · 50 apps' }];
const planName = (p: string) => ({ free: 'Free Forever', plus: 'Plus', pro: 'Pro' }[p] ?? p);
const periodName = (p: string | undefined) => (p === 'year' ? 'year' : 'month');
const fmtBytes = (n: number | null | undefined) => {
  const b = Number(n || 0);
  return b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`;
};

type NavKey = 'overview' | 'analytics' | 'creations' | 'users' | 'payments' | 'subscriptions' | 'plans' | 'methods' | 'apps' | 'hosting' | 'links' | 'support' | 'audit' | 'settings';
const NAV: { group: string; items: [NavKey, string, string][] }[] = [
  { group: '', items: [['overview', 'Overview', 'chart'], ['analytics', 'Analytics', 'live']] },
  { group: 'Customers', items: [['payments', 'Plan requests', 'receipt'], ['subscriptions', 'Subscriptions', 'card'], ['users', 'Users', 'users']] },
  { group: 'Money', items: [['plans', 'Plans & pricing', 'chart'], ['methods', 'QR & payment methods', 'qr']] },
  { group: 'Platform', items: [['creations', 'Apps made', 'blocks'], ['apps', 'Apps & data', 'grid'], ['hosting', 'Addresses', 'globe'], ['links', 'Short links', 'link']] },
  { group: 'Operations', items: [['support', 'Support', 'help'], ['audit', 'Audit log', 'audit'], ['settings', 'Settings', 'settings']] },
];
const TITLES: Record<NavKey, string> = { overview: 'Overview', analytics: 'Analytics', creations: 'Apps made', users: 'Users', payments: 'Plan requests', subscriptions: 'Subscriptions', plans: 'Plans & pricing', apps: 'Apps & data', methods: 'QR & payment methods', hosting: 'Addresses', links: 'Short links', support: 'Support', audit: 'Audit log', settings: 'Settings' };

export function AdminPage({ section, sub }: { section: string; sub?: string }) {
  const { user, refresh } = useSession();
  const { go } = useRoute();
  const [counts, setCounts] = useState<{ pendingPayments: number; openTickets: number } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [newUser, setNewUser] = useState(false);
  const loadCounts = useCallback(() => get<{ pendingPayments: number; openTickets: number }>('/api/admin/overview').then(setCounts, () => {}), []);
  useEffect(() => { loadCounts(); }, [loadCounts, section]);
  useEffect(() => { setDrawer(false); }, [section, sub]);
  useEffect(() => { document.title = `${TITLES[(section as NavKey)] ?? 'Overview'} · Jhino Admin`; return () => { document.title = 'Jhino'; }; }, [section]);
  const cur: NavKey = NAV.some((g) => g.items.some((n) => n[0] === section)) ? section as NavKey : 'overview';
  const badge = (k: NavKey) => (k === 'payments' ? counts?.pendingPayments : k === 'support' ? counts?.openTickets : 0) || 0;
  return (
    <div className="adm">
      <aside className={`adm-side ${drawer ? 'open' : ''}`} aria-label="Super Admin">
        <div className="adm-brand">
          <Link to="/admin" className="wordmark" aria-label="Jhino Admin">jhino<i /></Link>
          <span className="adm-badge mono">admin</span>
          <button className="icon-btn adm-close" onClick={() => setDrawer(false)} aria-label="Close menu"><Icon name="close" /></button>
        </div>
        <nav className="adm-nav">
          {NAV.map((g) => (
            <div key={g.group || 'top'} className="adm-group">
              {g.group && <p className="adm-group-h">{g.group}</p>}
              {g.items.map(([k, l, i]) => (
                <Link key={k} to={`/admin/${k}`} aria-current={cur === k ? 'page' : undefined}>
                  <Icon name={i} size={17} /><span>{l}</span>{badge(k) > 0 && <span className="adm-count mono">{badge(k)}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="adm-foot">
          <Link to="/apps" className="adm-back"><Icon name="back" size={16} />My apps</Link>
          <div className="adm-me">
            <Avatar name={user.name} src={avatarUrl(user)} />
            <span className="adm-me-t"><b>{user.displayName || user.name}</b><small>{user.email}</small></span>
            <button className="icon-btn" aria-label="Log out" title="Log out" onClick={async () => { await post('/api/auth/logout'); await refresh(); go('/login', true); }}><Icon name="logout" size={17} /></button>
          </div>
        </div>
      </aside>
      {drawer && <div className="adm-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}
      <div className="adm-main">
        <header className="adm-top">
          <button className="icon-btn adm-menu" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer}><Icon name="list" /></button>
          <p className="adm-where"><span className="muted">Super Admin</span><span className="muted" aria-hidden="true">/</span><b>{TITLES[cur]}</b></p>
          <div className="spacer" />
          <button className="btn primary sm adm-new" onClick={() => setNewUser(true)}><Icon name="plus" size={15} /><span>New user</span></button>
          {!!counts?.pendingPayments && cur !== 'payments' && <Link to="/admin/payments" className="adm-pill"><i className="live-dot" />{counts.pendingPayments} plan {counts.pendingPayments === 1 ? 'request' : 'requests'}</Link>}
        </header>
        <main className="adm-body">
          {cur === 'overview' && <Overview />}
          {cur === 'analytics' && <SiteAnalytics />}
          {cur === 'creations' && <Creations />}
          {cur === 'users' && (sub ? <UserDetail id={sub} /> : <Users />)}
          {cur === 'payments' && (sub ? <PaymentDetail id={sub} onChanged={loadCounts} /> : <Payments />)}
          {cur === 'subscriptions' && <Subscriptions />}
          {cur === 'plans' && <PlansAdmin />}
          {cur === 'apps' && (sub ? <AppDetailAdmin id={sub} /> : <AppsAdmin />)}
          {cur === 'methods' && <Methods />}
          {cur === 'hosting' && <Hosting />}
          {cur === 'links' && <AdminLinks />}
          {cur === 'support' && <Support onChanged={loadCounts} />}
          {cur === 'audit' && <Audit />}
          {cur === 'settings' && <Settings />}
        </main>
      </div>
      {newUser && <CreateUser onClose={(made) => { setNewUser(false); if (made) go(`/admin/users/${made}`); }} />}
    </div>
  );
}

function Head({ title, lede, actions }: { title: string; lede?: ReactNode; actions?: ReactNode }) {
  return <div className="adm-head"><div><h1>{title}</h1>{lede && <p className="acc-lede">{lede}</p>}</div>{actions && <div className="actions-row">{actions}</div>}</div>;
}

/* ---------------- overview: the dashboard ---------------- */
interface OverviewT {
  users: number; clients: number; newUsers30: number; newUsersPrev30: number; paying: number; pendingPayments: number; revenue30: number; revenuePrev30: number; revenueAll: number; monthlyRevenue: number;
  apps: number; hosted: number; openTickets: number; links: number; linkClicks30: number; mailReady: boolean;
  revenueByMonth: { month: string; n: number }[]; signupsByDay: { day: string; n: number }[]; appsByDay: { day: string; n: number }[];
  planMix: { free: number; plus: number; pro: number };
  pendingList: { id: string; userName: string; plan: string; period: string; amount: number; expectedAmount: number; createdAt: string }[];
  ticketsList: { id: string; email: string; kind: string; subject: string; createdAt: string }[];
  expiring: { id: string; name: string; email: string; plan: string; expiresAt: string }[];
  recent: { actor: string; action: string; detail: string; at: string }[];
  storage: { database: number; apps: number; files: number; disk: { total: number; free: number } | null; maxFileMB: number };
}
const monthLabel = (m: string) => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }).slice(0, 3);
function Delta({ now, before, money }: { now: number; before: number; money?: boolean }) {
  if (!before && !now) return <span className="kd flat">no change</span>;
  const d = now - before;
  const pct = before ? Math.round((d / before) * 100) : null;
  return <span className={`kd ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}`}>{d > 0 ? '+' : d < 0 ? '−' : ''}{money ? npr(Math.abs(d)).replace('NPR ', '') : Math.abs(d)}{pct !== null && d !== 0 ? ` (${d > 0 ? '+' : '−'}${Math.abs(pct)}%)` : ''} vs previous 30 days</span>;
}

/** Bars for a series; the last bar (now) is the signal colour. Bars grow in once, on first draw. */
function Bars({ data, label, format }: { data: { key: string; label: string; n: number }[]; label: string; format: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? data.length - 1;
  return (
    <figure className="chart" aria-label={label}>
      <figcaption className="chart-read"><b className="mono">{format(data[shown]?.n ?? 0)}</b><span className="muted">{data[shown]?.label}</span></figcaption>
      <div className="bars" role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${format(d.n)}`).join(', ')}`} onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75, 1].map((g) => <span key={g} className="grid-line" style={{ bottom: `${g * 100}%` }} aria-hidden="true" />)}
        {data.map((d, i) => (
          <button key={d.key} type="button" className={`bar ${i === data.length - 1 ? 'now' : ''} ${hover === i ? 'hot' : ''}`} style={{ ['--h' as string]: String(d.n / max), ['--i' as string]: String(i) }}
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={`${d.label}: ${format(d.n)}`}>
            <i />
          </button>
        ))}
      </div>
      <div className="bars-axis mono" aria-hidden="true">{data.map((d, i) => <span key={d.key}>{i % Math.ceil(data.length / 12) === 0 || i === data.length - 1 ? d.label : ''}</span>)}</div>
    </figure>
  );
}

/** Two daily series as lines: sign-ups (ink) and new apps (quiet). */
function Lines({ a, b, labelA, labelB }: { a: { day: string; n: number }[]; b: { day: string; n: number }[]; labelA: string; labelB: string }) {
  const W = 600, H = 150, P = 6;
  const max = Math.max(1, ...a.map((d) => d.n), ...b.map((d) => d.n));
  const pt = (i: number, n: number, len: number) => `${(P + (i * (W - 2 * P)) / Math.max(1, len - 1)).toFixed(1)},${(H - P - (n / max) * (H - 2 * P)).toFixed(1)}`;
  const path = (s: { n: number }[]) => s.map((d, i) => `${i ? 'L' : 'M'}${pt(i, d.n, s.length)}`).join(' ');
  const sum = (s: { n: number }[]) => s.reduce((t, d) => t + d.n, 0);
  return (
    <figure className="chart dlines" aria-label={`${labelA} and ${labelB}, last 30 days`}>
      <figcaption className="legend">
        <span><i className="sw ink" />{labelA} <b className="mono">{sum(a)}</b></span>
        <span><i className="sw quiet" />{labelB} <b className="mono">{sum(b)}</b></span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${labelA}: ${sum(a)}; ${labelB}: ${sum(b)} in the last 30 days`}>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} className="gl" />)}
        <path d={`${path(a)} L${W - P},${H - P} L${P},${H - P} Z`} className="area" />
        <path d={path(b)} className="ln quiet" vectorEffect="non-scaling-stroke" />
        <path d={path(a)} className="ln ink" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="bars-axis mono" aria-hidden="true"><span>{new Date(a[0]?.day ?? Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span><span>today</span></div>
    </figure>
  );
}

function Overview() {
  const [o, setO] = useState<OverviewT | null>(null);
  useEffect(() => { get<OverviewT>('/api/admin/overview').then(setO, () => {}); }, []);
  if (!o) return <div className="dash-skel"><div className="acc-skel sm" /><div className="acc-skel" /></div>;
  const mixTotal = o.planMix.free + o.planMix.plus + o.planMix.pro || 1;
  const queue = o.pendingList.length + o.ticketsList.length + o.expiring.length;
  return (
    <div className="dash">
      <Head title="Overview" lede={`Today, ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`} />

      <section className="kpi-strip" aria-label="Key numbers">
        <div className="kpi2">
          <p className="k-l">Monthly revenue</p>
          <p className="k-v mono">{npr(o.monthlyRevenue)}</p>
          <p className="k-s" title="Yearly plans count as a twelfth each month">{o.paying} paying {o.paying === 1 ? 'customer' : 'customers'}</p>
        </div>
        <div className="kpi2">
          <p className="k-l">Collected, 30 days</p>
          <p className="k-v mono">{npr(o.revenue30)}</p>
          <Delta now={o.revenue30} before={o.revenuePrev30} money />
        </div>
        <Link to="/admin/users" className="kpi2">
          <p className="k-l">Customers</p>
          <p className="k-v mono">{o.users.toLocaleString('en-IN')}</p>
          <Delta now={o.newUsers30} before={o.newUsersPrev30} />
        </Link>
        <Link to="/admin/payments" className={`kpi2 ${o.pendingPayments ? 'hot' : ''}`}>
          <p className="k-l">Plan requests to review</p>
          <p className="k-v mono">{o.pendingPayments}</p>
          <p className="k-s">{o.pendingPayments ? 'Oldest first in the queue' : 'Nothing waiting'}</p>
        </Link>
      </section>

      <div className="dash-grid">
        <section className="dpanel span2" aria-labelledby="rev-h">
          <div className="panel-h"><h2 id="rev-h">Revenue by month</h2><span className="muted small">approved payments · all time {npr(o.revenueAll)}</span></div>
          <Bars data={o.revenueByMonth.map((m) => ({ key: m.month, label: monthLabel(m.month), n: m.n }))} label="Revenue by month, last 12 months" format={npr} />
        </section>

        <section className="dpanel queue" aria-labelledby="q-h">
          <div className="panel-h"><h2 id="q-h">Needs you</h2>{queue > 0 && <span className="mono small muted">{queue}</span>}</div>
          {!o.mailReady && <p className="q-warn"><Icon name="mail" size={15} /><span>Emails are not delivered. Set SMTP_URL; until then read them in <Link to="/admin/settings" className="link">Settings</Link>.</span></p>}
          {!queue ? <p className="q-clear"><Icon name="check" size={16} />All clear. New payments and requests land here.</p> : (
            <ul className="q-list">
              {o.pendingList.map((p) => (
                <li key={p.id}><Link to={`/admin/payments/${p.id}`}>
                  <span className="q-k">Payment</span>
                  <span className="q-t"><b>{p.userName}</b><small>{planName(p.plan)} · one {periodName(p.period)} · {ago(p.createdAt)}</small></span>
                  <span className={`mono q-n ${p.amount !== p.expectedAmount ? 'warn-text' : ''}`}>{npr(p.amount)}</span>
                </Link></li>
              ))}
              {o.ticketsList.map((t) => (
                <li key={t.id}><Link to="/admin/support">
                  <span className="q-k">{t.kind === 'problem' ? 'Problem' : t.kind === 'feedback' ? 'Feedback' : 'Message'}</span>
                  <span className="q-t"><b>{t.subject}</b><small>{t.email} · {ago(t.createdAt)}</small></span>
                </Link></li>
              ))}
              {o.expiring.map((u) => (
                <li key={u.id}><Link to={`/admin/users/${u.id}`}>
                  <span className="q-k">Renewal</span>
                  <span className="q-t"><b>{u.name}</b><small>{planName(u.plan)} ends {fmtDate(u.expiresAt)}</small></span>
                </Link></li>
              ))}
            </ul>
          )}
        </section>

        <section className="dpanel span2" aria-labelledby="gr-h">
          <div className="panel-h"><h2 id="gr-h">Growth, last 30 days</h2></div>
          <Lines a={o.signupsByDay} b={o.appsByDay} labelA="Sign-ups" labelB="New apps" />
        </section>

        <section className="dpanel" aria-labelledby="mix-h">
          <div className="panel-h"><h2 id="mix-h">Plans</h2><span className="muted small">{o.users} customers</span></div>
          <div className="mix" role="img" aria-label={`Free ${o.planMix.free}, Plus ${o.planMix.plus}, Pro ${o.planMix.pro}`}>
            <i className="m-free" style={{ flexGrow: o.planMix.free }} /><i className="m-plus" style={{ flexGrow: o.planMix.plus }} /><i className="m-pro" style={{ flexGrow: o.planMix.pro }} />
          </div>
          <dl className="mix-legend">
            {([['free', 'Free Forever'], ['plus', 'Plus'], ['pro', 'Pro']] as const).map(([k, l]) => (
              <div key={k}><dt><i className={`sw m-${k}`} />{l}</dt><dd className="mono">{o.planMix[k]}<small> · {Math.round((o.planMix[k] / mixTotal) * 100)}%</small></dd></div>
            ))}
          </dl>
          <dl className="plat">
            <div><dt>Apps</dt><dd className="mono">{o.apps}</dd></div>
            <div><dt>Addresses</dt><dd className="mono"><Link to="/admin/hosting">{o.hosted}</Link></dd></div>
            <div><dt>Short links</dt><dd className="mono"><Link to="/admin/links">{o.links}</Link></dd></div>
            <div><dt>Link clicks, 30 d</dt><dd className="mono">{o.linkClicks30.toLocaleString('en-IN')}</dd></div>
            <div><dt>Client sign-ins</dt><dd className="mono">{o.clients}</dd></div>
            <div><dt>Open requests</dt><dd className="mono"><Link to="/admin/support">{o.openTickets}</Link></dd></div>
          </dl>
        </section>

        <section className="dpanel" aria-labelledby="st-h">
          <div className="panel-h"><h2 id="st-h">Storage</h2>{o.storage.disk && <span className="muted small">{fmtBytes(o.storage.disk.free)} free</span>}</div>
          {o.storage.disk && (() => { const used = o.storage.disk.total - o.storage.disk.free; const pct = Math.min(100, Math.round((used / o.storage.disk.total) * 100)); return (
            <>
              <div className={`disk ${pct > 85 ? 'hot' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Disk used"><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
              <p className="small muted disk-l">{fmtBytes(used)} of {fmtBytes(o.storage.disk.total)} used on the server disk ({pct}%)</p>
            </>
          ); })()}
          <dl className="plat">
            <div><dt>Database</dt><dd className="mono">{fmtBytes(o.storage.database)}</dd></div>
            <div><dt>Uploaded files</dt><dd className="mono">{fmtBytes(o.storage.files)}</dd></div>
            <div><dt>App files</dt><dd className="mono">{fmtBytes(o.storage.apps)}</dd></div>
            <div><dt>Largest upload</dt><dd className="mono"><Link to="/admin/plans">by plan</Link></dd></div>
          </dl>
        </section>

        <section className="dpanel span2" aria-labelledby="act-h">
          <div className="panel-h"><h2 id="act-h">Recent admin activity</h2><Link to="/admin/audit" className="link small">Audit log</Link></div>
          {!o.recent.length ? <p className="muted">Nothing yet.</p> : (
            <table className="adm-table act-table">
              <tbody>{o.recent.map((r, i) => <tr key={i}><td className="mono small nowrap">{r.action}</td><td className="small">{r.detail}</td><td className="muted small hide-sm">{r.actor}</td><td className="muted small nowrap">{ago(r.at)}</td></tr>)}</tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------------- short links: every link on the platform ---------------- */
interface AdminLinkT { id: string; code: string; url: string; short: string; clicks: number; disabled: boolean; disabledReason: string; createdAt: string; ownerEmail: string; ownerId: string }
function AdminLinks() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AdminLinkT[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [editCode, setEditCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState('');

  const load = useCallback(() => get<{ links: AdminLinkT[] }>(`/api/admin/links?q=${encodeURIComponent(q)}`).then((r) => setRows(r.links), () => {}), [q]);
  useEffect(() => { const t = setTimeout(load, 150); return () => clearTimeout(t); }, [load]);

  const toggle = async (l: AdminLinkT) => {
    let reason = '';
    if (!l.disabled) { const r = prompt(`Turn off /${l.code}? Visitors get "Nothing here". The owner sees your reason.\n\nReason:`, 'Goes to a harmful page'); if (r === null) return; reason = r; }
    try { await api('PATCH', `/api/admin/links/${l.id}`, { disabled: !l.disabled, reason }); toast(l.disabled ? 'Turned back on' : 'Turned off'); load(); } catch (e) { toast(err(e, 'Could not change it.'), true); }
  };

  const startEdit = (l: AdminLinkT) => {
    setEditingId(l.id);
    setEditUrl(l.url);
    const suffix = l.code.replace(/^s-/, '');
    setEditCode(suffix);
    setEditError('');
  };

  const saveEdit = async (e: FormEvent, id: string) => {
    e.preventDefault();
    if (busy) return;
    const cleanSuffix = editCode.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanSuffix.length < 4 || cleanSuffix.length > 5) {
      setEditError('Short code must have 4 or 5 characters after s- (e.g. s-sale or s-promo).');
      return;
    }
    setBusy(true); setEditError('');
    try {
      await api('PATCH', `/api/admin/links/${id}`, {
        url: editUrl,
        code: `s-${cleanSuffix}`,
      });
      toast('Link updated');
      setEditingId(null);
      load();
    } catch (e2) {
      setEditError(err(e2, 'Could not update link.'));
    }
    setBusy(false);
  };

  return (
    <>
      <Head title="Short links" lede="Every short link, newest first. Edit addresses and codes, or turn off any that goes somewhere harmful." />
      <div className="adm-tools"><label className="ix-search"><Icon name="search" size={16} /><span className="sr-only">Search links</span><input placeholder="Code, address or owner email" value={q} onChange={(e) => setQ(e.target.value)} /></label></div>
      {!rows ? <div className="acc-skel" /> : !rows.length ? <p className="muted">No short links yet.</p> : (
        <table className="adm-table">
          <thead><tr><th>Link</th><th>Goes to</th><th className="hide-sm">Owner</th><th>Clicks</th><th /></tr></thead>
          <tbody>
            {rows.map((l) => (
              <Fragment key={l.id}>
                <tr className={l.disabled ? 'row-off' : ''}>
                  <td><a className="mono link" href={l.short} target="_blank" rel="noopener noreferrer">/{l.code}</a>{l.disabled && <small className="reason">Off: {l.disabledReason || 'no reason given'}</small>}</td>
                  <td className="small url-cell" title={l.url}>{l.url}</td>
                  <td className="hide-sm muted small">{l.ownerEmail}</td>
                  <td className="mono">{l.clicks.toLocaleString('en-IN')}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn sm quiet" style={{ marginRight: 6 }} onClick={() => startEdit(l)}>Edit</button>
                    <button className={`btn sm ${l.disabled ? '' : 'quiet danger'}`} onClick={() => toggle(l)}>{l.disabled ? 'Turn on' : 'Turn off'}</button>
                  </td>
                </tr>
                {editingId === l.id && (
                  <tr className="adm-edit-row">
                    <td colSpan={5} style={{ padding: '12px 16px', background: 'var(--bg-sub, rgba(0,0,0,0.03))' }}>
                      <form className="acc-form" onSubmit={(e) => saveEdit(e, l.id)}>
                        <div className="grid2">
                          <label className="field">
                            <span>Destination address</span>
                            <input className="input" required value={editUrl} onChange={(e) => setEditUrl(e.target.value)} placeholder="https://example.com" />
                          </label>
                          <label className="field">
                            <span>Short code (4-5 chars after s-)</span>
                            <div className="addr-input">
                              <span className="addr-host mono">/s-</span>
                              <input className="mono" maxLength={5} value={editCode} onChange={(e) => setEditCode(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))} placeholder="sale" />
                            </div>
                          </label>
                        </div>
                        {editError && <p className="error-text" role="alert">{editError}</p>}
                        <div className="actions-row" style={{ marginTop: 8 }}>
                          <button className="btn sm primary" disabled={busy}>{busy && <span className="spin" />}Save</button>
                          <button type="button" className="btn sm quiet" onClick={() => setEditingId(null)}>Cancel</button>
                        </div>
                      </form>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/* ---------------- users ---------------- */
interface UserRowT { id: string; name: string; email: string; username: string | null; storage: number; emailVerified: boolean | null; createdAt: string; status: string; role: string; usage: { planName: string; plan: string; used: number; limit: number | null } | null; lastLoginAt: string | null; lastPayment: string | null }
function Users() {
  const toast = useToast();
  const { go } = useRoute();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState({ role: '', status: '', plan: '' });
  const [rows, setRows] = useState<{ users: UserRowT[]; total: number } | null>(null);
  const [create, setCreate] = useState(false);
  const load = useCallback(() => {
    const p = new URLSearchParams({ q, ...filter });
    get<{ users: UserRowT[]; total: number }>(`/api/admin/users?${p}`).then(setRows, (e) => toast(err(e, 'Could not load.'), true));
  }, [q, filter, toast]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  return (
    <>
      <Head title="Users" lede={rows ? `${rows.total} ${rows.total === 1 ? 'person' : 'people'} · customers, their clients and super admins` : ''} actions={<><a className="btn sm" href="/api/admin/export/users.csv" download><Icon name="download" size={15} />Export CSV</a><button className="btn primary sm" onClick={() => setCreate(true)}><Icon name="plus" size={15} />New user</button></>} />
      <div className="adm-tools">
        <label className="ix-search"><Icon name="search" size={16} /><span className="sr-only">Search users</span><input placeholder="Search by name, email or ID" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <Select size="sm" label="Role" value={filter.role} width={150} options={[{ value: '', label: 'Everyone' }, { value: 'creator', label: 'Customers' }, { value: 'client', label: 'Clients' }, { value: 'super_admin', label: 'Super admins' }]} onChange={(v) => setFilter({ ...filter, role: v })} />
        <Select size="sm" label="Plan" value={filter.plan} width={150} options={[{ value: '', label: 'Any plan' }, { value: 'free', label: 'Free Forever' }, { value: 'plus', label: 'Plus' }, { value: 'pro', label: 'Pro' }]} onChange={(v) => setFilter({ ...filter, plan: v })} />
        <Select size="sm" label="Status" value={filter.status} width={150} options={[{ value: '', label: 'Any status' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }, { value: 'unverified', label: 'Email not verified' }]} onChange={(v) => setFilter({ ...filter, status: v })} />
      </div>
      {!rows ? <div className="acc-skel" /> : !rows.users.length ? <p className="muted">No one matches.</p> : (
        <table className="adm-table">
          <thead><tr><th>Person</th><th className="hide-sm">Plan</th><th className="hide-sm">Apps</th><th className="hide-sm">Storage</th><th className="hide-sm">Payment</th><th>Status</th><th className="hide-sm">Joined</th></tr></thead>
          <tbody>
            {rows.users.map((u) => (
              <tr key={u.id} className="clickable" onClick={() => go(`/admin/users/${u.id}`)}>
                <td><Link to={`/admin/users/${u.id}`} className="cell-main"><b>{u.name}{u.username && <span className="mono muted small"> @{u.username}</span>}</b><small>{u.email}{u.emailVerified === false ? ' · unverified' : ''}{u.role === 'super_admin' ? ' · super admin' : u.role === 'client' ? ' · client' : ''}</small></Link></td>
                <td className="hide-sm">{u.usage ? u.usage.planName : '—'}</td>
                <td className="hide-sm mono">{u.usage ? (u.usage.limit === null ? `${u.usage.used} / ∞` : `${u.usage.used} / ${u.usage.limit}`) : '—'}</td>
                <td className="hide-sm mono">{u.usage ? fmtBytes(u.storage) : '—'}</td>
                <td className="hide-sm">{u.lastPayment ? <span className={`status s-${u.lastPayment}`}>{u.lastPayment}</span> : '—'}</td>
                <td><span className={`status ${u.status === 'active' ? 's-approved' : 's-rejected'}`}>{u.status}</span></td>
                <td className="hide-sm muted">{fmtDate(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {create && <CreateUser onClose={(made) => { setCreate(false); if (made) go(`/admin/users/${made}`); else load(); }} />}
    </>
  );
}

function CreateUser({ onClose }: { onClose: (madeId?: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', username: '', password: '', plan: 'plus', period: 'month', superAdmin: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState<{ id: string; email: string; password: string; signInUrl: string; name: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { const r = await post<{ user: UserRowT; password: string; signInUrl: string }>('/api/admin/users', { ...f, username: f.username || undefined, password: f.password || undefined, period: f.period === 'none' ? undefined : f.period }); setMade({ id: r.user.id, email: r.user.email, password: r.password, signInUrl: r.signInUrl, name: r.user.name }); }
    catch (e2) { setError(err(e2, 'Could not create it.')); }
    setBusy(false);
  };
  const text = made ? `Your Jhino account\nSign in: ${made.signInUrl}\nSign-in ID: ${made.email}\nPassword: ${made.password}\n\nChange the password after signing in (Account → Security).` : '';
  return (
    <Modal title={made ? 'Account ready' : 'New user'} onClose={() => onClose(made?.id)}>
      <div className="modal-body">
        {made ? (
          <>
            <p className="muted">Send this to {made.name} privately. The password is shown only now.</p>
            <div className="code" style={{ fontSize: 13 }}>{text}</div>
            <div className="actions-row"><button className="btn primary" onClick={() => copyText(text).then(() => toast('Copied'))}><Icon name="copy" size={15} />Copy</button><button className="btn" onClick={() => onClose(made.id)}>Open their page</button></div>
          </>
        ) : (
          <form className="acc-form" onSubmit={submit}>
            <p className="hint">Makes a ready account with a password you pass on. Use it for customers who paid you directly, for a teammate (tick super admin), or to set someone up.</p>
            <label className="field"><span>Name</span><input className="input" required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
            <label className="field"><span>Email or sign-in ID</span><input className="input" required autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
            <label className="field"><span>Username <em>optional: made from the email if empty</em></span><input className="input mono" autoComplete="off" maxLength={50} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} placeholder="their-studio" /><small className="hint">Any free name works, including words people cannot pick themselves (services, jhino…). Only Jhino's own addresses (login, apps, admin…) are off limits.</small></label>
            <label className="field"><span>Password <em>optional</em></span><input className="input" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="Leave empty to generate one" /></label>
            {!f.superAdmin && (
              <div className="grid2">
                <div className="field"><span>Plan</span><Select label="Plan" value={f.plan} options={PLAN_OPTS} onChange={(v) => setF({ ...f, plan: v })} /></div>
                {f.plan !== 'free' && <div className="field"><span>Paid for</span><Select label="Paid for" value={f.period} options={[{ value: 'month', label: 'One month' }, { value: 'year', label: 'One year' }, { value: 'none', label: 'No end date' }]} onChange={(v) => setF({ ...f, period: v })} /></div>}
              </div>
            )}
            {!f.superAdmin && <small className="hint">For customers who paid outside Jhino. Paid by QR? Approve their payment in Payments instead.</small>}
            <label className="check-row"><input type="checkbox" checked={f.superAdmin} onChange={(e) => setF({ ...f, superAdmin: e.target.checked })} /><span>Make them a super admin (full access to this dashboard)</span></label>
            {error && <p className="error-text" role="alert">{error}</p>}
            <div className="actions-row"><button className="btn primary" disabled={busy || !f.name.trim() || f.email.trim().length < 3}>{busy && <span className="spin" />}Create sign-in</button><button type="button" className="btn quiet" onClick={() => onClose()}>Cancel</button></div>
          </form>
        )}
      </div>
    </Modal>
  );
}

function UserDetail({ id }: { id: string }) {
  const toast = useToast();
  const { user: me } = useSession();
  const [d, setD] = useState<Record<string, any> | null>(null);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [edit, setEdit] = useState<{ plan: string; expires: string; extra: string } | null>(null);
  const [changing, setChanging] = useState(false);
  const load = useCallback(() => get(`/api/admin/users/${id}`).then((r) => { setD(r); setEdit({ plan: r.user.usage?.plan ?? 'free', expires: r.user.planExpiresAt ? r.user.planExpiresAt.slice(0, 10) : '', extra: String(r.user.extraCreations ?? 0) }); }, (e) => toast(err(e, 'Not found.'), true)), [id, toast]);
  useEffect(() => { load(); }, [load]);
  if (!d || !edit) return <div className="acc-skel" />;
  const u = d.user;
  const patch = async (body: Record<string, unknown>, done: string) => {
    try { await api('PATCH', `/api/admin/users/${id}`, body); toast(done); load(); } catch (e) { toast(err(e, 'Could not save.'), true); }
  };
  const suspend = async () => {
    if (u.status === 'suspended') { patch({ suspended: false }, 'Reactivated'); return; }
    const reason = prompt(`Suspend ${u.name}? They are signed out everywhere and cannot sign in.\n\nReason (shown to them):`);
    if (reason === null) return;
    patch({ suspended: true, reason }, 'Suspended');
  };
  const resetPw = async () => {
    if (!confirm(`Make a new password for ${u.name}? Their old password stops working and they are signed out.`)) return;
    try { setSecret(await post(`/api/admin/users/${id}/password`)); } catch (e) { toast(err(e, 'Could not do that.'), true); }
  };
  const self = me.id === u.id;
  return (
    <>
      <div className="crumb"><Link to="/admin/users" className="link">Users</Link> / {u.name}</div>
      <Head title={u.name} lede={<>{u.email} · <span className={`status ${u.status === 'active' ? 's-approved' : 's-rejected'}`}>{u.status}</span>{u.role === 'super_admin' && ' · super admin'}{u.role === 'client' && ' · client of a customer'}</>} />
      {secret && <div className="cred-box" role="status"><b>New password for {secret.email}</b><div className="code">{secret.password}</div><div className="actions-row"><button className="btn sm" onClick={() => copyText(`Sign-in ID: ${secret.email}\nPassword: ${secret.password}`).then(() => toast('Copied'))}>Copy</button><button className="btn sm quiet" onClick={() => setSecret(null)}>Done</button></div></div>}
      <ProfileEdit u={u} onSaved={load} />
      <dl className="facts wide">
        <div><dt>User ID</dt><dd className="mono">{u.id}</dd></div>
        {u.username && <div><dt>Username and page</dt><dd><a className="link mono" href={`/${u.username}`} target="_blank" rel="noopener">{location.host}/{u.username}</a></dd></div>}
        <div><dt>Email</dt><dd>{u.emailVerified === null ? 'Sign-in ID (no email)' : u.emailVerified ? 'Verified' : 'Not verified'}</dd></div>
        <div><dt>Joined</dt><dd>{fmtDate(u.createdAt)}</dd></div>
        <div><dt>Last sign-in</dt><dd>{u.lastLoginAt ? `${fmtDateTime(u.lastLoginAt)} · ${u.lastLoginDevice}${u.lastLoginIp ? ' · ' + u.lastLoginIp : ''}` : 'Never'}</dd></div>
        <div><dt>Signed in on</dt><dd>{d.sessions} device{d.sessions === 1 ? '' : 's'}</dd></div>
        {u.phone && <div><dt>Phone</dt><dd>{u.phone}</dd></div>}
        {u.company && <div><dt>Company</dt><dd>{u.company}</dd></div>}
        {u.suspendedReason && <div><dt>Suspended because</dt><dd>{u.suspendedReason}</dd></div>}
      </dl>

      {u.usage && (
        <section className="adm-block">
          <h3 className="adm-sub">Plan and allowance</h3>
          <p className="muted">{u.usage.planName} · {u.usage.limit === null ? `${u.usage.used} apps, no limit` : `${u.usage.used} of ${u.usage.limit} apps used`}{u.planExpiresAt ? ` · ends ${fmtDate(u.planExpiresAt)}` : u.usage.plan !== 'free' ? ' · no end date' : ''}</p>
          <div className="actions-row"><button className="btn sm primary" onClick={() => setChanging(true)}>Upgrade, downgrade or extend…</button></div>
          {changing && <PlanDialog sub={{ id: u.id, name: u.name, email: u.email, plan: u.usage.plan, planName: u.usage.planName, period: null, expiresAt: u.planExpiresAt }} onClose={() => { setChanging(false); load(); }} />}
          <details className="adv">
            <summary>Set an exact end date, or give extra apps</summary>
            <div className="adm-plan">
              <div className="field"><span>Plan</span><Select label="Plan" value={edit.plan} options={PLAN_OPTS} onChange={(v) => setEdit({ ...edit, plan: v })} /></div>
              <label className="field"><span>Ends <em>optional</em></span><input className="input" type="date" value={edit.expires} onChange={(e) => setEdit({ ...edit, expires: e.target.value })} /></label>
              <label className="field"><span>Extra apps</span><input className="input mono" inputMode="numeric" value={edit.extra} onChange={(e) => setEdit({ ...edit, extra: e.target.value.replace(/[^\d-]/g, '') })} /></label>
            </div>
            <button className="btn sm" onClick={() => {
              const body: Record<string, unknown> = {};
              if (edit.plan !== u.usage.plan) body.plan = edit.plan;
              if ((edit.expires || null) !== (u.planExpiresAt ? u.planExpiresAt.slice(0, 10) : null)) body.planExpiresAt = edit.expires || null;
              if (Number(edit.extra || 0) !== u.extraCreations) body.extraCreations = Number(edit.extra || 0);
              if (!Object.keys(body).length) { toast('Nothing changed'); return; }
              patch(body, 'Plan updated');
            }}>Save</button>
          </details>
        </section>
      )}

      <section className="adm-block">
        <h3 className="adm-sub">Actions</h3>
        <div className="actions-row wrap">
          <button className="btn sm" onClick={resetPw}><Icon name="key" size={15} />New password</button>
          <button className="btn sm" onClick={async () => { await post(`/api/admin/users/${id}/signout`); toast('Signed out everywhere'); load(); }}>Sign out everywhere</button>
          {u.emailVerified === false && <button className="btn sm" onClick={() => patch({ emailVerified: true }, 'Marked verified')}>Mark email verified</button>}
          {!self && <button className="btn sm" onClick={() => { if (confirm(u.role === 'super_admin' ? `Remove super admin access from ${u.name}?` : `Make ${u.name} a super admin? They get full access to this dashboard.`)) patch({ superAdmin: u.role !== 'super_admin' }, 'Updated'); }}>{u.role === 'super_admin' ? 'Remove super admin' : 'Make super admin'}</button>}
          {!self && <button className={`btn sm ${u.status === 'suspended' ? '' : 'danger'}`} onClick={suspend}>{u.status === 'suspended' ? 'Reactivate' : 'Suspend…'}</button>}
        </div>
      </section>

      {u.role !== 'client' && (
        <section className="adm-block">
          <h3 className="adm-sub">Storage</h3>
          <dl className="store-row">
            <div><dt>Total</dt><dd className="mono">{fmtBytes(d.storage.total)}</dd></div>
            <div><dt>App files (HTML, ZIP)</dt><dd className="mono">{fmtBytes(d.storage.apps)}</dd></div>
            <div><dt>Uploaded files</dt><dd className="mono">{fmtBytes(d.storage.files)}</dd></div>
            <div><dt>Saved data</dt><dd className="mono">{fmtBytes(d.storage.kv + d.storage.records)}</dd></div>
          </dl>
        </section>
      )}
      <section className="adm-block"><h3 className="adm-sub">Apps they own ({d.apps.length})</h3>
        {!d.apps.length ? <p className="muted">None.</p> : <AppTable rows={d.apps} showOwner={false} />}
      </section>
      {!!d.memberOf?.length && (
        <section className="adm-block"><h3 className="adm-sub">Apps shared with them</h3>
          <ul className="acc-list compact">{d.memberOf.map((a: any) => <li key={a.id}><Link to={`/admin/apps/${a.id}`} className="cell-main"><b>{a.name}</b><small>{a.ownerEmail} · {a.role === 'editor' ? 'can edit' : a.role === 'contributor' ? 'can add' : 'can view'}</small></Link></li>)}</ul>
        </section>
      )}
      <section className="adm-block"><h3 className="adm-sub">Payments</h3>
        {!d.payments.length ? <p className="muted">None.</p> : <ul className="acc-list compact">{d.payments.map((p: any) => <li key={p.id}><Link to={`/admin/payments/${p.id}`} className="cell-main"><b>{planName(p.plan)} · {npr(p.amount)}</b><small>{p.method} · {fmtDate(p.createdAt)}</small></Link><span className={`status s-${p.status}`}>{p.status}</span></li>)}</ul>}
      </section>
      <section className="adm-block"><h3 className="adm-sub">Security activity</h3>
        {!d.security.length ? <p className="muted">None.</p> : <ul className="acc-list compact">{d.security.map((e: any, i: number) => <li key={i}><span><b>{e.kind.replace(/_/g, ' ')}</b><small>{e.device}{e.ip ? ' · ' + e.ip : ''}</small></span><span className="muted small">{fmtDateTime(e.at)}</span></li>)}</ul>}
      </section>
      {!!d.audit.length && <section className="adm-block"><h3 className="adm-sub">Admin changes</h3><ul className="acc-list compact">{d.audit.map((a: any, i: number) => <li key={i}><span><b>{a.action.replace(/[._]/g, ' ')}</b><small>{a.actor} · {a.detail}</small></span><span className="muted small">{fmtDateTime(a.at)}</span></li>)}</ul></section>}
      {!self && <DeleteUser u={u} />}
    </>
  );
}

/** Change someone's name or sign-in email (set by a super admin, it counts as confirmed). */
function ProfileEdit({ u, onSaved }: { u: any; onSaved: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: u.name, email: u.email, username: u.username ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!open) return <div className="actions-row"><button className="btn sm" onClick={() => { setF({ name: u.name, email: u.email, username: u.username ?? '' }); setOpen(true); }}>Edit name, email or username</button></div>;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('PATCH', `/api/admin/users/${u.id}`, {
        name: f.name,
        email: f.email,
        ...(f.username && f.username.toLowerCase() !== (u.username ?? '').toLowerCase() ? { username: f.username } : {})
      });
      toast('Saved'); setOpen(false); onSaved();
    }
    catch (e2) { setError(err(e2, 'Could not save.')); }
    setBusy(false);
  };
  return (
    <form className="acc-form edit-profile" onSubmit={save}>
      <div className="grid2">
        <label className="field"><span>Name</span><input className="input" required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>Email or sign-in ID</span><input className="input" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      </div>
      <label className="field"><span>Username</span><input className="input mono" maxLength={50} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} placeholder="username" /><small className="hint">Any free name, including general words and "jhino". No 30-day wait. Only Jhino's own addresses (login, apps, admin…) are off limits.</small></label>
      {f.username && f.username.toLowerCase() !== (u.username ?? '').toLowerCase() && <p className="hint">Their public page moves to jhino.com/{f.username}, and @{u.username} is immediately released for anyone else to take.</p>}
      {f.email.trim().toLowerCase() !== u.email.toLowerCase() && <p className="hint">They sign in with the new one from now on. If the old one was an email address, it gets a notice.</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="actions-row"><button className="btn sm primary" disabled={busy}>{busy && <span className="spin" />}Save</button><button type="button" className="btn sm quiet" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

/** Delete an account for good, after typing its email. */
function DeleteUser({ u }: { u: any }) {
  const toast = useToast();
  const { go } = useRoute();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const del = async () => {
    setBusy(true);
    try { const r = await post<{ apps: number }>(`/api/admin/users/${u.id}/delete`, { confirm: confirmText }); toast(`${u.name} deleted, with ${r.apps} app${r.apps === 1 ? '' : 's'}`); go('/admin/users'); }
    catch (e) { toast(err(e, 'Could not delete.'), true); setBusy(false); }
  };
  return (
    <section className="danger-zone">
      <b>Delete this account</b>
      <p>Their apps, everything saved in them, their uploaded files and the client sign-ins they made are removed for good. Payment records stay for your accounts. Suspending is usually enough.</p>
      {!open ? <button className="btn sm danger" onClick={() => setOpen(true)}>Delete account…</button> : (
        <div className="acc-form tight">
          <label className="field"><span>Type <b className="mono">{u.email}</b> to confirm</span><input className="input mono" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus /></label>
          <div className="actions-row"><button className="btn sm danger" disabled={busy || confirmText.trim().toLowerCase() !== u.email.toLowerCase()} onClick={del}>{busy && <span className="spin" />}Delete for good</button><button className="btn sm quiet" onClick={() => setOpen(false)}>Cancel</button></div>
        </div>
      )}
    </section>
  );
}

/* ---------------- apps & data: every app, and what it holds ---------------- */
interface AppNumT { id: string; name: string; slug: string | null; rootSlug: string | null; ownerUsername: string | null; access: string; createdAt: string; updatedAt: string; deletedAt: string | null; ownerId: string; ownerName: string; ownerEmail: string; members: number; versions: number; appBytes: number; records: number; recordBytes: number; kvKeys: number; kvBytes: number; files: number; fileBytes: number; lastActivity: string | null; built: number }
const appTotal = (a: AppNumT) => a.appBytes + a.fileBytes + a.kvBytes + a.recordBytes;

function AppTable({ rows, showOwner = true }: { rows: AppNumT[]; showOwner?: boolean }) {
  const { go } = useRoute();
  return (
    <table className="adm-table">
      <thead><tr><th>App</th>{showOwner && <th className="hide-sm">Owner</th>}<th className="hide-sm">People</th><th className="hide-sm">Saved data</th><th className="hide-sm">Files</th><th>Size</th><th className="hide-sm">Last activity</th></tr></thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.id} className="clickable" onClick={() => go(`/admin/apps/${a.id}`)}>
            <td><Link to={`/admin/apps/${a.id}`} className="cell-main"><b>{a.name}{a.deletedAt && <span className="status s-rejected">in Trash</span>}</b><small>{a.built ? 'Create app' : 'uploaded HTML'}{a.rootSlug ? ` · /${a.rootSlug}` : ''}{a.slug ? ` · /${a.ownerUsername}/${a.slug}` : ''}{a.access !== 'private' ? ` · ${a.access} link` : ''}</small></Link></td>
            {showOwner && <td className="hide-sm small">{a.ownerEmail}</td>}
            <td className="hide-sm mono">{a.members}</td>
            <td className="hide-sm mono small">{a.records + a.kvKeys} items · {fmtBytes(a.kvBytes + a.recordBytes)}</td>
            <td className="hide-sm mono small">{a.files} · {fmtBytes(a.fileBytes)}</td>
            <td className="mono">{fmtBytes(appTotal(a))}</td>
            <td className="hide-sm muted small">{a.lastActivity ? ago(a.lastActivity) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AppsAdmin() {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('recent');
  const [d, setD] = useState<{ apps: AppNumT[]; totals: Record<string, number> } | null>(null);
  useEffect(() => { const t = setTimeout(() => get<typeof d>(`/api/admin/apps/all?q=${encodeURIComponent(q)}&sort=${sort}`).then(setD, () => {}), 150); return () => clearTimeout(t); }, [q, sort]);
  const t = d?.totals;
  return (
    <>
      <Head title="Apps & data" lede="Every app on Jhino, who owns it, and what it holds: saved data in the database, uploaded files and the app's own files on disk." />
      {t && (
        <dl className="store-row">
          <div><dt>Apps</dt><dd className="mono">{t.apps}</dd></div>
          <div><dt>Saved data (database)</dt><dd className="mono">{fmtBytes(t.kvBytes + t.recordBytes)}</dd></div>
          <div><dt>Uploaded files ({t.files})</dt><dd className="mono">{fmtBytes(t.fileBytes)}</dd></div>
          <div><dt>App files (HTML, ZIP)</dt><dd className="mono">{fmtBytes(t.appBytes)}</dd></div>
        </dl>
      )}
      <div className="adm-tools">
        <div className="seg" role="group" aria-label="Sort">{[['recent', 'Recently changed'], ['size', 'Largest']].map(([k, l]) => <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>)}</div>
        <label className="ix-search"><Icon name="search" size={16} /><span className="sr-only">Search apps</span><input placeholder="App name, owner email or address" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      {!d ? <div className="acc-skel" /> : !d.apps.length ? <p className="muted">No apps match.</p> : <AppTable rows={d.apps} />}
    </>
  );
}

function AppDetailAdmin({ id }: { id: string }) {
  const toast = useToast();
  const [d, setD] = useState<Record<string, any> | null>(null);
  useEffect(() => { get(`/api/admin/apps/${id}/detail`).then(setD, (e) => toast(err(e, 'Not found.'), true)); }, [id, toast]);
  if (!d) return <div className="acc-skel" />;
  const a: AppNumT = d.app;
  return (
    <>
      <div className="crumb"><Link to="/admin/apps" className="link">Apps & data</Link> / {a.name}</div>
      <Head title={a.name} lede={<>Owned by <Link to={`/admin/users/${a.ownerId}`} className="link">{a.ownerName}</Link> ({a.ownerEmail}) · made {fmtDate(a.createdAt)}{a.deletedAt ? ' · in Trash' : ''}</>}
        actions={<>
          {a.slug && a.access !== 'private' && <a className="btn sm" href={`/${a.slug}`} target="_blank" rel="noopener"><Icon name="external" size={14} />/{a.slug}</a>}
          <a className="btn sm" href={`/api/admin/apps/${a.id}/export`} download onClick={() => toast('Download started. It is recorded in the audit log.')}><Icon name="download" size={15} />Export data (JSON)</a>
        </>} />
      <dl className="store-row">
        <div><dt>Total size</dt><dd className="mono">{fmtBytes(appTotal(a))}</dd></div>
        <div><dt>Saved data</dt><dd className="mono">{a.records + a.kvKeys} items · {fmtBytes(a.kvBytes + a.recordBytes)}</dd></div>
        <div><dt>Uploaded files</dt><dd className="mono">{a.files} · {fmtBytes(a.fileBytes)}</dd></div>
        <div><dt>App files</dt><dd className="mono">{a.versions} version{a.versions === 1 ? '' : 's'} · {fmtBytes(a.appBytes)}</dd></div>
      </dl>
      <div className="adm-two">
        <section className="adm-block"><h3 className="adm-sub">People ({d.members.length})</h3>
          <ul className="acc-list compact">{d.members.map((m: any) => <li key={m.id}><Link to={`/admin/users/${m.id}`} className="cell-main"><b>{m.name}</b><small>{m.email} · {m.role === 'owner' ? 'owner' : m.role === 'editor' ? 'can edit' : m.role === 'contributor' ? 'can add' : 'can view'}</small></Link><span className="muted small">{m.lastLoginAt ? ago(m.lastLoginAt) : 'never signed in'}</span></li>)}</ul>
        </section>
        <section className="adm-block"><h3 className="adm-sub">Recent activity</h3>
          {!d.activity.length ? <p className="muted">Nothing yet.</p> : <ul className="acc-list compact">{d.activity.map((x: any, i: number) => <li key={i}><span><b>{x.name ?? 'Someone'} {x.action}</b>{x.detail && <small>{x.detail}</small>}</span><span className="muted small">{ago(x.at)}</span></li>)}</ul>}
        </section>
      </div>
      <section className="adm-block"><h3 className="adm-sub">Saved data in the database</h3>
        {!d.collections.length && !d.keys.length ? <p className="muted">Nothing saved yet.</p> : (
          <table className="adm-table">
            <thead><tr><th>Where</th><th>What</th><th>Size</th><th className="hide-sm">Changed</th></tr></thead>
            <tbody>
              {d.collections.map((c: any) => <tr key={'c' + c.collection}><td className="small">Section</td><td className="mono small">{c.collection} · {c.n} item{c.n === 1 ? '' : 's'}</td><td className="mono small">{fmtBytes(c.bytes)}</td><td className="hide-sm muted small">{ago(c.updatedAt)}</td></tr>)}
              {d.keys.map((k: any, i: number) => <tr key={'k' + i}><td className="small">{k.ns === 'ls' ? 'localStorage' : k.ns === 'ws' ? 'window.storage' : k.ns} · {k.scope}</td><td className="mono small url-cell" title={k.key}>{k.key}</td><td className="mono small">{fmtBytes(k.bytes)}</td><td className="hide-sm muted small">{ago(k.updatedAt)}</td></tr>)}
            </tbody>
          </table>
        )}
        <p className="hint">The values themselves are in the export. Opening someone's data is recorded in the audit log.</p>
      </section>
      {!!d.bigFiles.length && (
        <section className="adm-block"><h3 className="adm-sub">Largest files</h3>
          <table className="adm-table">
            <thead><tr><th>File</th><th>Size</th><th className="hide-sm">Uploaded</th></tr></thead>
            <tbody>{d.bigFiles.map((f: any) => <tr key={f.id} className={f.deletedAt ? 'row-off' : ''}><td className="small url-cell" title={f.name}>{f.name}{f.deletedAt && ' (in Trash)'}</td><td className="mono small">{fmtBytes(f.size)}{f.originalSize ? <small className="muted"> (was {fmtBytes(f.originalSize)})</small> : null}</td><td className="hide-sm muted small">{fmtDate(f.createdAt)}</td></tr>)}</tbody>
          </table>
        </section>
      )}
      <section className="adm-block"><h3 className="adm-sub">Versions</h3>
        <ul className="acc-list compact">{d.versions.map((v: any) => <li key={v.n}><span><b>Version {v.n}{v.n === (a as any).liveVersion ? ' · live' : ''}</b><small>{v.built ? 'Built with Create app' : v.source} · {v.fileCount} file{v.fileCount === 1 ? '' : 's'} · {fmtBytes(v.size)}</small></span><span className="muted small">{fmtDate(v.createdAt)}</span></li>)}</ul>
      </section>
    </>
  );
}

/* ---------------- plans & pricing ---------------- */
interface PlanEdit { id: string; name: string; price: number; yearly: number; creations: number; blurb: string; features: Record<string, number | boolean | string> }
const FLAG_FIELDS: [string, string][] = [['customPage', 'Own HTML page design'], ['passwordLinks', 'Password links'], ['hideBar', 'Hide the top bar'], ['download', 'Download as an HTML file'], ['customCodes', 'Short links with their own names'], ['linkStats', 'Daily click history'], ['prioritySupport', 'Priority support']];
function PlansAdmin() {
  const toast = useToast();
  const [d, setD] = useState<{ plans: PlanEdit[]; serverMaxMB: number; customers: Record<string, number> } | null>(null);
  const [draft, setDraft] = useState<PlanEdit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => get<typeof d>('/api/admin/plans').then((r) => { setD(r); setDraft(JSON.parse(JSON.stringify(r!.plans))); }, () => {}), []);
  useEffect(() => { load(); }, [load]);
  if (!d || !draft) return <div className="acc-skel" />;
  const set = (i: number, patch: Partial<PlanEdit>) => setDraft(draft.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const setF = (i: number, k: string, v: number | boolean | string) => setDraft(draft.map((p, j) => (j === i ? { ...p, features: { ...p.features, [k]: v } } : p)));
  const num = (v: string) => Number(v.replace(/[^\d]/g, '') || 0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(d.plans);
  const save = async () => {
    if (!confirm('Save the new plans? The website and checkout show them at once. People who already paid keep their plan until its end date; renewals use the new prices.')) return;
    setBusy(true); setError('');
    try { await api('PUT', '/api/admin/plans', { plans: draft }); toast('Plans saved. The website shows them now.'); await refreshPlans(); load(); }
    catch (e) { setError(err(e, 'Could not save.')); }
    setBusy(false);
  };
  return (
    <>
      <Head title="Plans & pricing" lede="What each plan costs and includes. Changes show on the website and at checkout straight away, and the server enforces the limits." actions={<a className="btn sm" href="/#pricing" target="_blank" rel="noopener"><Icon name="external" size={14} />See the website</a>} />
      <div className="plan-edit-grid">
        {draft.map((p, i) => {
          const free = p.id === 'free';
          const months = p.price > 0 ? 12 - p.yearly / p.price : 0;
          return (
            <section key={p.id} className="plan-edit">
              <header><span className="mono small muted">{p.id}</span><span className="muted small">{d.customers[p.id] ?? 0} {free ? 'on it' : 'paying now'}</span></header>
              <label className="field"><span>Name</span><input className="input" maxLength={40} value={p.name} onChange={(e) => set(i, { name: e.target.value })} /></label>
              <label className="field"><span>One line under the name</span><input className="input" maxLength={160} value={p.blurb} onChange={(e) => set(i, { blurb: e.target.value })} /></label>
              {free ? <p className="hint">Free Forever always costs nothing.</p> : (
                <div className="grid2">
                  <label className="field"><span>Monthly (NPR)</span><input className="input mono" inputMode="numeric" value={p.price} onChange={(e) => set(i, { price: num(e.target.value) })} /></label>
                  <label className="field"><span>Yearly (NPR)</span><input className="input mono" inputMode="numeric" value={p.yearly} onChange={(e) => set(i, { yearly: num(e.target.value) })} /></label>
                </div>
              )}
              {!free && <p className="hint">{months > 0.05 ? `Yearly saves ${months.toFixed(1).replace(/\.0$/, '')} month${Math.round(months) === 1 ? '' : 's'}.` : 'Yearly saves nothing at these prices.'} <button type="button" className="link" onClick={() => set(i, { yearly: p.price * 10 })}>Make it 10 × monthly</button></p>}
              <div className="grid2">
                <label className="field"><span>Apps</span><input className="input mono" inputMode="numeric" value={p.creations} onChange={(e) => set(i, { creations: num(e.target.value) })} /></label>
                <label className="field"><span>Addresses</span><input className="input mono" inputMode="numeric" value={Number(p.features.addresses)} onChange={(e) => setF(i, 'addresses', num(e.target.value))} /></label>
                <label className="field"><span>Short links</span><input className="input mono" inputMode="numeric" value={Number(p.features.shortLinks)} onChange={(e) => setF(i, 'shortLinks', num(e.target.value))} /></label>
                <label className="field"><span>Largest file (MB)</span><input className="input mono" inputMode="numeric" value={Number(p.features.maxUploadMB)} onChange={(e) => setF(i, 'maxUploadMB', num(e.target.value))} /></label>
              </div>
              <div className="grid2">
                <div className="field"><span>Page designs</span><Select label="Page designs" value={String(p.features.themeTier)} options={[{ value: 'free', label: '5 (free designs)' }, { value: 'plus', label: '15 (free + plus)' }, { value: 'pro', label: 'All 30' }]} onChange={(v) => setF(i, 'themeTier', v as never)} /></div>
                <div className="field"><span>Jhino branding on the page</span><Select label="Jhino branding" value={String(p.features.branding)} options={[{ value: 'popup', label: 'Badge and popup' }, { value: 'badge', label: 'Small badge' }, { value: 'none', label: 'None' }]} onChange={(v) => setF(i, 'branding', v as never)} /></div>
                <label className="field"><span>Analytics (days)</span><input className="input mono" inputMode="numeric" value={Number(p.features.analyticsDays)} onChange={(e) => setF(i, 'analyticsDays', num(e.target.value))} /></label>
              </div>
              <div className="plan-flags">
                {FLAG_FIELDS.map(([k, l]) => (
                  <label key={k} className="check-row"><input type="checkbox" checked={!!p.features[k]} onChange={(e) => setF(i, k, e.target.checked)} /><span>{l}</span></label>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <p className="hint">Largest file applies to each upload by the app's owner and everyone in it (photos, videos, ZIPs), up to {d.serverMaxMB.toLocaleString('en-IN')} MB set on the server (MAX_FILE_MB). Super admins are not limited. Bigger videos can always be shared as a link.</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="actions-row sticky-save">
        <button className="btn primary" disabled={!dirty || busy} onClick={save}>{busy && <span className="spin" />}Save plans</button>
        <button className="btn quiet" disabled={!dirty || busy} onClick={() => setDraft(JSON.parse(JSON.stringify(d.plans)))}>Undo changes</button>
        {dirty && <span className="hint">Not saved yet.</span>}
      </div>
    </>
  );
}

/* ---------------- announcements ---------------- */
function Announce() {
  const toast = useToast();
  const [f, setF] = useState({ title: '', body: '', audience: 'customers' });
  const [busy, setBusy] = useState(false);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!confirm(`Send "${f.title}" to ${f.audience === 'everyone' ? 'everyone, clients too' : f.audience === 'paying' ? 'paying customers' : f.audience === 'free' ? 'Free Forever customers' : 'all customers'}? It goes to their bell and by email.`)) return;
    setBusy(true);
    try { const r = await post<{ sent: number }>('/api/admin/announce', f); toast(`Sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}`); setF({ ...f, title: '', body: '' }); }
    catch (e2) { toast(err(e2, 'Could not send.'), true); }
    setBusy(false);
  };
  return (
    <form className="acc-form" onSubmit={send}>
      <div className="grid2">
        <label className="field"><span>Title</span><input className="input" required minLength={3} maxLength={140} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="New: short links on every plan" /></label>
        <div className="field"><span>To</span><Select label="To" value={f.audience} options={[{ value: 'customers', label: 'All customers' }, { value: 'paying', label: 'Paying customers' }, { value: 'free', label: 'Free Forever customers' }, { value: 'everyone', label: 'Everyone (clients too)' }]} onChange={(v) => setF({ ...f, audience: v })} /></div>
      </div>
      <label className="field"><span>Message</span><textarea className="textarea" rows={3} maxLength={600} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
      <div><button className="btn sm primary" disabled={busy || f.title.trim().length < 3}>{busy && <span className="spin" />}Send announcement</button></div>
    </form>
  );
}

/* ---------------- payments ---------------- */
interface PaymentT { id: string; receiptNo: string; plan: string; planName: string; period: string; amount: number; expectedAmount: number; method: string; reference: string; paidOn: string; note: string; hasProof: boolean; status: string; rejectReason: string; createdAt: string; reviewedAt: string | null; userId: string | null; userEmail: string; userName: string; internalNote: string; reviewedBy: string }
function Payments() {
  const { go } = useRoute();
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [d, setD] = useState<{ payments: PaymentT[]; counts: Record<string, number> } | null>(null);
  useEffect(() => { const t = setTimeout(() => get<typeof d>(`/api/admin/payments?status=${status}&q=${encodeURIComponent(q)}`).then(setD, () => {}), 150); return () => clearTimeout(t); }, [status, q]);
  return (
    <>
      <Head title="Plan requests" lede="Everyone who paid for a plan and sent a screenshot. Check it against your bank or wallet, then approve (the plan turns on at once) or reject with a reason." actions={<><a className="btn sm" href="/api/admin/export/payments.csv" download><Icon name="download" size={15} />Export CSV</a><Link to="/admin/subscriptions" className="btn sm">Subscriptions</Link></>} />
      <div className="adm-tools">
        <div className="seg" role="group" aria-label="Status">
          {[['pending', 'To review'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']].map(([k, l]) => (
            <button key={k} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}{k !== 'all' && d?.counts[k] ? <span className="n">{d.counts[k]}</span> : null}</button>
          ))}
        </div>
        <label className="ix-search"><Icon name="search" size={16} /><span className="sr-only">Search payments</span><input placeholder="Customer, email or reference" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      {!d ? <div className="acc-skel" /> : !d.payments.length ? <p className="muted">{status === 'pending' ? 'Nothing waiting. New payments show up here and in your bell.' : 'None.'}</p> : (
        <table className="adm-table">
          <thead><tr><th>Customer</th><th>Plan</th><th>Amount</th><th className="hide-sm">Method</th><th className="hide-sm">Reference</th><th>Status</th><th className="hide-sm">Submitted</th></tr></thead>
          <tbody>
            {d.payments.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => go(`/admin/payments/${p.id}`)}>
                <td><Link to={`/admin/payments/${p.id}`} className="cell-main"><b>{p.userName}</b><small>{p.userEmail}</small></Link></td>
                <td>{p.planName}<small className="muted"> · {periodName(p.period)}</small></td>
                <td className={`mono ${p.amount !== p.expectedAmount ? 'warn-text' : ''}`} title={p.amount !== p.expectedAmount ? `Plan price is ${npr(p.expectedAmount)}` : undefined}>{npr(p.amount)}</td>
                <td className="hide-sm">{p.method}</td>
                <td className="hide-sm mono">{p.reference || '—'}</td>
                <td><span className={`status s-${p.status}`}>{p.status}</span></td>
                <td className="hide-sm muted">{ago(p.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function PaymentDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<{ payment: PaymentT; user: any; history: any[]; earlier: PaymentT[]; endsIfApproved: string | null } | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'' | 'approve' | 'reject'>('');
  const [rejecting, setRejecting] = useState(false);
  const load = useCallback(() => get<typeof d>(`/api/admin/payments/${id}`).then((r) => { setD(r); setNote(r!.payment.internalNote); }, (e) => toast(err(e, 'Not found.'), true)), [id, toast]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="acc-skel" />;
  const p = d.payment;
  const approve = async () => {
    if (!confirm(`Approve ${npr(p.amount)} from ${p.userName}? ${p.planName} turns on for them now${d.endsIfApproved ? `, until ${fmtDate(d.endsIfApproved)}` : ''}.`)) return;
    setBusy('approve');
    try { const r = await post<{ already: boolean }>(`/api/admin/payments/${id}/approve`, { note: note || undefined }); toast(r.already ? 'Already approved (nothing given twice)' : `Approved. ${p.planName} is active for ${p.userName}.`); onChanged(); load(); }
    catch (e) { toast(err(e, 'Could not approve.'), true); }
    setBusy('');
  };
  const reject = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('reject');
    try { await post(`/api/admin/payments/${id}/reject`, { reason, note: note || undefined }); toast('Rejected. The customer can see why.'); setRejecting(false); onChanged(); load(); }
    catch (e2) { toast(err(e2, 'Could not reject.'), true); }
    setBusy('');
  };
  return (
    <>
      <div className="crumb"><Link to="/admin/payments" className="link">Plan requests</Link> / {p.receiptNo}</div>
      <Head title={`${p.planName} · ${npr(p.amount)}`} lede={<><span className={`status s-${p.status}`}>{p.status}</span> · submitted {fmtDateTime(p.createdAt)}{p.reviewedAt && ` · reviewed by ${p.reviewedBy} ${fmtDateTime(p.reviewedAt)}`}</>} />
      <div className="pay-review">
        <div className="proof">
          {p.hasProof ? <a href={`/api/billing/payments/${p.id}/proof`} target="_blank" rel="noopener" title="Open full size"><img src={`/api/billing/payments/${p.id}/proof`} alt="Payment screenshot" /></a> : <p className="muted">No screenshot.</p>}
        </div>
        <div>
          <dl className="facts">
            <div><dt>Customer</dt><dd>{d.user ? <Link to={`/admin/users/${d.user.id}`} className="link">{p.userName}</Link> : p.userName}<br /><span className="muted">{p.userEmail}</span></dd></div>
            <div><dt>Plan</dt><dd>{p.planName}, one {periodName(p.period)} (price {npr(p.expectedAmount)})</dd></div>
            {p.status === 'pending' && d.endsIfApproved && <div><dt>Approving gives</dt><dd>{p.planName} until {fmtDate(d.endsIfApproved)}</dd></div>}
            <div><dt>Amount paid</dt><dd className={`mono ${p.amount !== p.expectedAmount ? 'warn-text' : ''}`}>{npr(p.amount)}{p.amount !== p.expectedAmount && ' · not the plan price'}</dd></div>
            <div><dt>Method</dt><dd>{p.method}</dd></div>
            <div><dt>Reference</dt><dd className="mono">{p.reference || '—'}</dd></div>
            <div><dt>Paid on</dt><dd>{p.paidOn}</dd></div>
            {p.note && <div><dt>Customer note</dt><dd>{p.note}</dd></div>}
            {d.user && <div><dt>Their plan now</dt><dd>{d.user.plan.planName} · {d.user.plan.used}{d.user.plan.limit !== null ? ` of ${d.user.plan.limit}` : ''} used</dd></div>}
            {p.rejectReason && <div><dt>Rejected because</dt><dd>{p.rejectReason}</dd></div>}
          </dl>
          <label className="field"><span>Internal note <em>only admins see it</em></span><textarea className="textarea" rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></label>
          {p.status !== 'pending' && note !== p.internalNote && <button className="btn sm" onClick={async () => { await post(`/api/admin/payments/${id}/note`, { note }); toast('Note saved'); load(); }}>Save note</button>}
          {p.status === 'pending' && !rejecting && (
            <div className="actions-row review-acts">
              <button className="btn primary" disabled={!!busy} onClick={approve}>{busy === 'approve' && <span className="spin" />}<Icon name="check" size={16} />Approve and activate</button>
              <button className="btn" disabled={!!busy} onClick={() => setRejecting(true)}>Reject…</button>
            </div>
          )}
          {rejecting && (
            <form className="acc-form tight" onSubmit={reject}>
              <label className="field"><span>Reason the customer will see</span><textarea className="textarea" rows={3} required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Payment screenshot could not be verified. Please upload a clearer screenshot showing the transaction details." /></label>
              <div className="actions-row"><button className="btn danger" disabled={busy === 'reject' || reason.trim().length < 5}>{busy === 'reject' && <span className="spin" />}Reject payment</button><button type="button" className="btn quiet" onClick={() => setRejecting(false)}>Cancel</button></div>
            </form>
          )}
        </div>
      </div>
      {!!d.history.length && <section className="adm-block"><h3 className="adm-sub">History</h3><ul className="acc-list compact">{d.history.map((h, i) => <li key={i}><span><b>{h.action.replace(/[._]/g, ' ')}</b><small>{h.actor}</small></span><span className="muted small">{fmtDateTime(h.at)}</span></li>)}</ul></section>}
      {!!d.earlier.length && <section className="adm-block"><h3 className="adm-sub">Earlier payments by this customer</h3><ul className="acc-list compact">{d.earlier.map((e) => <li key={e.id}><Link to={`/admin/payments/${e.id}`} className="cell-main"><b>{e.planName} · {npr(e.amount)}</b><small>{fmtDate(e.createdAt)}</small></Link><span className={`status s-${e.status}`}>{e.status}</span></li>)}</ul></section>}
    </>
  );
}

/* ---------------- subscriptions: who is on which plan, until when ---------------- */
interface SubT { id: string; name: string; email: string; plan: string; planName: string; period: string | null; startedAt?: string | null; expiresAt: string | null; status?: string; used?: number; limit?: number | null; suspended?: boolean; lastPayment?: { id: string; amount: number; period: string; status: string; createdAt: string } | null; pendingPaymentId?: string | null }
const daysFrom = (iso: string) => Math.round((Date.parse(iso) - Date.now()) / 864e5);
function endsText(iso: string | null) {
  if (!iso) return 'No end date';
  const d = daysFrom(iso);
  return d < 0 ? `Ended ${-d} day${d === -1 ? '' : 's'} ago` : d === 0 ? 'Ends today' : `Ends in ${d} day${d === 1 ? '' : 's'}`;
}
function Subscriptions() {
  const { go } = useRoute();
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [d, setD] = useState<{ subscriptions: SubT[]; counts: Record<string, number> } | null>(null);
  const [edit, setEdit] = useState<SubT | null>(null);
  const load = useCallback(() => get<typeof d>(`/api/admin/subscriptions?status=${status}&q=${encodeURIComponent(q)}`).then(setD, () => {}), [status, q]);
  useEffect(() => { const t = setTimeout(load, 150); return () => clearTimeout(t); }, [load]);
  return (
    <>
      <Head title="Subscriptions" lede="Everyone on a paid plan: since when, until when, and what they last paid. Upgrade, downgrade or extend a plan here. New requests wait in Plan requests." actions={<Link to="/admin/payments" className="btn sm">Plan requests</Link>} />
      {d && (
        <dl className="sub-sum">
          <div><dt>Plus</dt><dd className="mono">{d.counts.plus}</dd></div>
          <div><dt>Pro</dt><dd className="mono">{d.counts.pro}</dd></div>
          <div><dt>Ending in 14 days</dt><dd className={`mono ${d.counts.ending ? 'warn-text' : ''}`}>{d.counts.ending}</dd></div>
          <div><dt>Ended, not renewed</dt><dd className="mono">{d.counts.ended}</dd></div>
        </dl>
      )}
      <div className="adm-tools">
        <div className="seg" role="group" aria-label="Show">
          {[['active', 'Active'], ['ending', 'Ending soon'], ['ended', 'Ended'], ['all', 'All']].map(([k, l]) => (
            <button key={k} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}{d && k !== 'all' && d.counts[k] ? <span className="n">{d.counts[k]}</span> : null}</button>
          ))}
        </div>
        <label className="ix-search"><Icon name="search" size={16} /><span className="sr-only">Search subscriptions</span><input placeholder="Customer name or email" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      {!d ? <div className="acc-skel" /> : !d.subscriptions.length ? <p className="muted">{status === 'active' ? 'No one is on a paid plan yet. Approved plan requests show up here.' : 'None.'}</p> : (
        <table className="adm-table">
          <thead><tr><th>Customer</th><th>Plan</th><th className="hide-sm">Since</th><th>Ends</th><th className="hide-sm">Apps</th><th className="hide-sm">Last payment</th><th /></tr></thead>
          <tbody>
            {d.subscriptions.map((s) => (
              <tr key={s.id}>
                <td><Link to={`/admin/users/${s.id}`} className="cell-main"><b>{s.name}{s.suspended && <span className="status s-rejected">suspended</span>}</b><small>{s.email}</small></Link></td>
                <td>{s.planName}{s.period && <small className="muted"> · {s.period === 'year' ? 'yearly' : 'monthly'}</small>}</td>
                <td className="hide-sm muted">{fmtDate(s.startedAt)}</td>
                <td><span className={s.status === 'ended' ? 'warn-text' : s.status === 'ending' ? 'warn-text' : ''}>{endsText(s.expiresAt)}</span>{s.expiresAt && <small className="reason">{fmtDate(s.expiresAt)}</small>}</td>
                <td className="hide-sm mono">{s.used} / {s.limit}</td>
                <td className="hide-sm">{s.pendingPaymentId ? <Link to={`/admin/payments/${s.pendingPaymentId}`} className="status s-pending">request waiting</Link> : s.lastPayment ? <><span className="mono">{npr(s.lastPayment.amount)}</span><small className="reason">{fmtDate(s.lastPayment.createdAt)} · {s.lastPayment.status}</small></> : <span className="muted">given by an admin</span>}</td>
                <td><div className="actions-row"><button className="btn sm" onClick={() => setEdit(s)}>Change…</button>{s.pendingPaymentId && <button className="btn sm quiet" onClick={() => go(`/admin/payments/${s.pendingPaymentId}`)}>Review</button>}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {edit && <PlanDialog sub={edit} onClose={() => { setEdit(null); load(); }} />}
    </>
  );
}

/** Upgrade, downgrade, extend or end one customer's plan. The customer is told in their bell and by email. */
function PlanDialog({ sub, onClose }: { sub: SubT; onClose: () => void }) {
  const toast = useToast();
  const [plan, setPlan] = useState(sub.plan === 'free' ? 'plus' : sub.plan);
  const [period, setPeriod] = useState<'month' | 'year' | 'keep' | 'none'>(sub.plan === 'free' ? 'month' : 'keep');
  const [busy, setBusy] = useState('');
  const run = async (what: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(what);
    try { await fn(); toast(msg); onClose(); } catch (e) { toast(err(e, 'Could not change it.'), true); setBusy(''); }
  };
  const rank: Record<string, number> = { free: 0, plus: 1, pro: 2 };
  const verb = rank[plan] > rank[sub.plan] ? 'Upgrade' : rank[plan] < rank[sub.plan] ? 'Downgrade' : 'Update';
  const save = () => run('save', async () => {
    const body: Record<string, unknown> = { plan };
    if (period === 'month' || period === 'year') body.period = period;
    await api('PATCH', `/api/admin/users/${sub.id}`, body);
    if (period === 'none') await api('PATCH', `/api/admin/users/${sub.id}`, { planExpiresAt: null });
  }, `${sub.name} is now on ${planName(plan)}`);
  const paid = sub.plan !== 'free';
  return (
    <Modal title={`${sub.name}'s plan`} onClose={onClose}>
      <div className="modal-body">
        <p className="plan-now"><span className="muted">Now</span> <b>{sub.planName}</b>{sub.period && <> · {sub.period === 'year' ? 'yearly' : 'monthly'}</>} · {endsText(sub.expiresAt)}{sub.expiresAt && ` (${fmtDate(sub.expiresAt)})`}</p>

        {paid && (
          <section className="plan-sec">
            <h3>Extend</h3>
            <p className="hint">Adds to the end date (or starts from today if it has ended). Use this when they paid you outside Jhino.</p>
            <div className="actions-row">
              <button className="btn sm" disabled={!!busy} onClick={() => run('m', () => post(`/api/admin/users/${sub.id}/extend`, { period: 'month' }), 'Extended by a month')}>{busy === 'm' && <span className="spin" />}+1 month</button>
              <button className="btn sm" disabled={!!busy} onClick={() => run('y', () => post(`/api/admin/users/${sub.id}/extend`, { period: 'year' }), 'Extended by a year')}>{busy === 'y' && <span className="spin" />}+1 year</button>
            </div>
          </section>
        )}

        <section className="plan-sec">
          <h3>Upgrade or downgrade</h3>
          <div className="grid2">
            <div className="field"><span>Plan</span><Select label="Plan" value={plan} options={PLAN_OPTS.filter((o) => o.value !== 'free')} onChange={setPlan} /></div>
            <div className="field"><span>For</span><Select label="For" value={period} options={[
              ...(paid ? [{ value: 'keep', label: 'Keep the current end date' }] : []),
              { value: 'month', label: 'One month from today' }, { value: 'year', label: 'One year from today' }, { value: 'none', label: 'No end date' },
            ]} onChange={(v) => setPeriod(v as typeof period)} /></div>
          </div>
          <div className="actions-row"><button className="btn sm primary" disabled={!!busy || (plan === sub.plan && period === 'keep')} onClick={save}>{busy === 'save' && <span className="spin" />}{verb} to {planName(plan)}</button></div>
        </section>

        {paid && (
          <section className="plan-sec">
            <h3>End the plan</h3>
            <p className="hint">Moves them to Free Forever now. Their apps keep working; they cannot add more than the free allowance.</p>
            <div className="actions-row"><button className="btn sm quiet danger" disabled={!!busy} onClick={() => { if (confirm(`Move ${sub.name} to Free Forever now?`)) run('end', () => api('PATCH', `/api/admin/users/${sub.id}`, { plan: 'free' }), `${sub.name} is on Free Forever`); }}>Downgrade to Free Forever</button></div>
          </section>
        )}
        <p className="hint">They get a notification (and an email) about the change. Every change is in the audit log.</p>
      </div>
    </Modal>
  );
}

/* ---------------- payment methods (QR) ---------------- */
interface MethodT { id: string; name: string; provider: string; bank: string; accountName: string; accountNumber: string; instructions: string; notes: string; hasQr: boolean; qrVersion: string; active: boolean; position: number }
const PROVIDER_LABEL: Record<string, string> = { manual_qr: 'Bank QR', fonepay: 'Fonepay QR', esewa: 'eSewa', khalti: 'Khalti', bank: 'Bank transfer', other: 'Other / manual' };
function Methods() {
  const toast = useToast();
  const [list, setList] = useState<MethodT[] | null>(null);
  const [editing, setEditing] = useState<MethodT | 'new' | null>(null);
  const load = useCallback(() => get<{ methods: MethodT[] }>('/api/admin/payment-methods').then((r) => setList(r.methods), () => {}), []);
  useEffect(() => { load(); }, [load]);
  const toggle = async (m: MethodT) => { try { await api('PATCH', `/api/admin/payment-methods/${m.id}`, { active: !m.active }); toast(m.active ? 'Hidden from checkout' : 'Shown at checkout'); load(); } catch (e) { toast(err(e, 'Could not change it.'), true); } };
  return (
    <>
      <Head title="QR & payment methods" lede="Active methods show at checkout, in this order. Replace a QR any time; the newest one shows at once." actions={<button className="btn primary sm" onClick={() => setEditing('new')}><Icon name="plus" size={15} />Add method</button>} />
      {!list ? <div className="acc-skel" /> : !list.length ? <div className="acc-muted-box">No payment methods yet. Add one (for example Fonepay QR) so customers can pay for plans.</div> : (
        <ul className="method-list">
          {list.map((m) => (
            <li key={m.id} className={m.active ? '' : 'off'}>
              <div className="qr-thumb">{m.hasQr ? <img src={`/api/billing/methods/${m.id}/qr?v=${encodeURIComponent(m.qrVersion)}`} alt="" /> : <Icon name="qr" size={22} />}</div>
              <div className="grow"><b>{m.name}</b><small>{PROVIDER_LABEL[m.provider] ?? m.provider}{m.bank ? ` · ${m.bank}` : ''}{m.accountName ? ` · ${m.accountName}` : ''}{!m.hasQr ? ' · no QR yet' : ''}</small></div>
              <span className={`status ${m.active ? 's-approved' : ''}`}>{m.active ? 'Active' : 'Hidden'}</span>
              <div className="actions-row"><button className="btn sm" onClick={() => setEditing(m)}>Edit</button><button className="btn sm quiet" onClick={() => toggle(m)}>{m.active ? 'Hide' : 'Show'}</button></div>
            </li>
          ))}
        </ul>
      )}
      {editing && <MethodEditor method={editing === 'new' ? null : editing} onClose={() => { setEditing(null); load(); }} />}
    </>
  );
}

function MethodEditor({ method, onClose }: { method: MethodT | null; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: method?.name ?? '', provider: method?.provider ?? 'fonepay', bank: method?.bank ?? '', accountName: method?.accountName ?? '', accountNumber: method?.accountNumber ?? '', instructions: method?.instructions ?? 'Scan the QR code with your banking or wallet app and pay the exact plan amount. Then upload a screenshot that shows the amount, date and transaction ID.', notes: method?.notes ?? '', position: String(method?.position ?? '') , active: method?.active ?? true });
  const [cur, setCur] = useState<MethodT | null>(method);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const qrInput = useRef<HTMLInputElement>(null);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setError('');
    try {
      const body = { ...f, position: f.position === '' ? undefined : Number(f.position) };
      const r = cur ? await api<{ method: MethodT }>('PATCH', `/api/admin/payment-methods/${cur.id}`, body) : await post<{ method: MethodT }>('/api/admin/payment-methods', body);
      setCur(r.method); toast('Saved');
      return r.method;
    } catch (e2) { setError(err(e2, 'Could not save.')); return null; } finally { setBusy(false); }
  };
  const uploadQr = async (file: File | undefined) => {
    if (!file) return;
    const m = cur ?? (await save());
    if (!m) return;
    const fd = new FormData(); fd.append('qr', file, file.name);
    try { const r = await api<{ method: MethodT }>('POST', `/api/admin/payment-methods/${m.id}/qr`, fd); setCur(r.method); toast(m.hasQr ? 'QR replaced' : 'QR uploaded'); }
    catch (e2) { toast(err(e2, 'Could not upload the QR.'), true); }
  };
  const remove = async () => {
    if (!cur || !confirm(`Delete ${cur.name}? Past payments keep its name.`)) return;
    await api('DELETE', `/api/admin/payment-methods/${cur.id}`); toast('Deleted'); onClose();
  };
  return (
    <Modal title={cur ? `Edit ${cur.name}` : 'Add a payment method'} onClose={onClose} wide>
      <div className="modal-body">
        <div className="method-edit">
          <div className="qr-side">
            <div className="qr-box">{cur?.hasQr ? <img src={`/api/billing/methods/${cur.id}/qr?v=${encodeURIComponent(cur.qrVersion)}`} alt="QR code preview" /> : <span className="muted"><Icon name="qr" size={28} /><br />No QR yet</span>}</div>
            <input ref={qrInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { uploadQr(e.target.files?.[0]); e.target.value = ''; }} />
            <div className="actions-row wrap">
              <button type="button" className="btn sm" onClick={() => qrInput.current?.click()}><Icon name="upload" size={15} />{cur?.hasQr ? 'Replace QR' : 'Upload QR'}</button>
              {cur?.hasQr && <a className="btn sm quiet" href={`/api/billing/methods/${cur.id}/qr?v=${encodeURIComponent(cur.qrVersion)}`} target="_blank" rel="noopener">View</a>}
            </div>
            <small className="hint">PNG, JPG or WEBP up to 5 MB.</small>
          </div>
          <form className="acc-form" onSubmit={save}>
            <div className="grid2">
              <label className="field"><span>Method name</span><input className="input" required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Fonepay QR" /></label>
              <div className="field"><span>Type</span><Select label="Type" value={f.provider} options={Object.entries(PROVIDER_LABEL).map(([value, label]) => ({ value, label }))} onChange={(v) => setF({ ...f, provider: v })} /></div>
              <label className="field"><span>Bank or wallet <em>optional</em></span><input className="input" maxLength={80} value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} /></label>
              <label className="field"><span>Account / merchant name <em>optional</em></span><input className="input" maxLength={80} value={f.accountName} onChange={(e) => setF({ ...f, accountName: e.target.value })} /></label>
              <label className="field"><span>Account number <em>optional</em></span><input className="input mono" maxLength={60} value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} /></label>
              <label className="field"><span>Order <em>lower shows first</em></span><input className="input mono" inputMode="numeric" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value.replace(/\D/g, '') })} /></label>
            </div>
            <label className="field"><span>Payment instructions</span><textarea className="textarea" rows={3} maxLength={1500} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></label>
            <label className="field"><span>Notes <em>optional</em></span><textarea className="textarea" rows={2} maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
            <label className="check-row"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /><span>Show at checkout</span></label>
            {error && <p className="error-text" role="alert">{error}</p>}
            <div className="actions-row"><button className="btn primary" disabled={busy || !f.name.trim()}>{busy && <span className="spin" />}Save</button><button type="button" className="btn quiet" onClick={onClose}>Close</button>{cur && <button type="button" className="btn quiet danger" onClick={remove}>Delete</button>}</div>
          </form>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- hosting ---------------- */
interface HostedT { id: string; name: string; ownerEmail: string; access: string; publicRole: string; hasPassword: boolean; shareUrl: string; slug: string | null; slugUrl: string | null; rootSlug: string | null; rootUrl: string | null; username: string | null; updatedAt: string }
function Hosting() {
  const toast = useToast();
  const [d, setD] = useState<{ apps: HostedT[] } | null>(null);
  const [dialog, setDialog] = useState<'host' | 'assign' | null>(null);
  const [editing, setEditing] = useState<HostedT | null>(null);
  const load = useCallback(() => get<{ apps: HostedT[] }>('/api/admin/hosting').then(setD, () => {}), []);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <Head title="Addresses" lede="Owners give their apps addresses under their username (jhino.com/their-name/room). Only super admins give top-level ones, jhino.com/name, which can never be a username." actions={<><button className="btn sm" onClick={() => setDialog('assign')}>Give an app an address</button><button className="btn primary sm" onClick={() => setDialog('host')}><Icon name="upload" size={15} />Host an HTML</button></>} />
      {!d ? <div className="acc-skel" /> : !d.apps.length ? <p className="muted">No app has an address or a public link yet.</p> : (
        <table className="adm-table">
          <thead><tr><th>Address</th><th>App</th><th className="hide-sm">Owner</th><th>Access</th><th /></tr></thead>
          <tbody>
            {d.apps.map((a) => (
              <tr key={a.id}>
                <td>{a.rootUrl && <a className="mono link" href={a.rootUrl} target="_blank" rel="noopener">/{a.rootSlug}</a>}{a.rootUrl && a.slugUrl && <br />}{a.slugUrl ? <a className="mono link small" href={a.slugUrl} target="_blank" rel="noopener">/{a.username}/{a.slug}</a> : !a.rootUrl ? <span className="muted">share link only</span> : null}</td>
                <td><b>{a.name}</b></td>
                <td className="hide-sm muted">{a.ownerEmail}</td>
                <td>{a.access === 'password' ? 'Password' : a.access === 'public' ? 'Public' : 'Private'}{a.access !== 'private' && <small className="muted"> · {a.publicRole === 'viewer' ? 'view' : a.publicRole === 'contributor' ? 'add' : 'edit'}</small>}</td>
                <td><div className="actions-row"><button className="btn sm quiet" onClick={() => copyText(a.slugUrl ?? a.shareUrl).then(() => toast('Link copied'))}><Icon name="copy" size={14} /></button><button className="btn sm" onClick={() => setEditing(a)}>Edit</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {dialog === 'host' && <HostDialog onClose={() => { setDialog(null); load(); }} />}
      {dialog === 'assign' && <AssignDialog onClose={() => { setDialog(null); load(); }} />}
      {editing && <AddressDialog app={editing} onClose={() => { setEditing(null); load(); }} />}
    </>
  );
}

function AccessFields({ v, set }: { v: { access: string; publicRole: string; password: string }; set: (x: { access: string; publicRole: string; password: string }) => void }) {
  return (
    <>
      <div className="grid2">
        <div className="field"><span>Who can open it</span><Select label="Who can open it" value={v.access} options={[{ value: 'public', label: 'Anyone with the address' }, { value: 'password', label: 'Anyone with the password' }, { value: 'private', label: 'Only people added (address off)' }]} onChange={(x) => set({ ...v, access: x })} /></div>
        <div className="field"><span>Visitors can</span><Select label="Visitors can" value={v.publicRole} options={[{ value: 'viewer', label: 'View' }, { value: 'contributor', label: 'Add' }, { value: 'editor', label: 'Edit' }]} onChange={(x) => set({ ...v, publicRole: x })} /></div>
      </div>
      {v.access === 'password' && <label className="field"><span>Password for visitors</span><input className="input" autoComplete="new-password" value={v.password} onChange={(e) => set({ ...v, password: e.target.value })} placeholder="Leave empty to keep the current one" /></label>}
    </>
  );
}

function slugify(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50); }

function HostDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ name: '', slug: '', access: 'public', publicRole: 'viewer', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = location.origin;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setError('');
    const fd = new FormData();
    fd.append('name', f.name); fd.append('slug', f.slug); fd.append('access', f.access === 'password' ? 'password' : 'public'); if (f.password) fd.append('password', f.password);
    fd.append('file', file, file.name);
    try { const r = await api<HostedT>('POST', '/api/admin/host', fd); toast(`Live at ${r.slugUrl}`); onClose(); }
    catch (e2) { setError(err(e2, 'Could not host it.')); }
    setBusy(false);
  };
  return (
    <Modal title="Host an HTML at an address" onClose={onClose}>
      <div className="modal-body">
        <form className="acc-form" onSubmit={submit}>
          <label className="field"><span>HTML file or ZIP</span><input className="input" type="file" accept=".html,.htm,.zip,text/html,application/zip" required onChange={(e) => { const x = e.target.files?.[0] ?? null; setFile(x); if (x && !f.slug) setF({ ...f, slug: slugify(x.name.replace(/\.(zip|html?)$/i, '')) }); }} /></label>
          <label className="field"><span>Name <em>optional</em></span><input className="input" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Uses the page title" /></label>
          <label className="field"><span>Address</span><div className="slug-input"><span className="mono muted">{base.replace(/^https?:\/\//, '')}/</span><input className="input mono" required value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} placeholder="your-studio" /></div></label>
          <div className="grid2">
            <div className="field"><span>Who can open it</span><Select label="Who can open it" value={f.access} options={[{ value: 'public', label: 'Anyone with the address' }, { value: 'password', label: 'Anyone with the password' }]} onChange={(x) => setF({ ...f, access: x })} /></div>
            {f.access === 'password' && <label className="field"><span>Password</span><input className="input" required minLength={4} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>}
          </div>
          <p className="hint">It belongs to you and counts as your app. Visitors can view it; change that later with Edit.</p>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="actions-row"><button className="btn primary" disabled={busy || !file || f.slug.length < 2}>{busy && <span className="spin" />}Host it</button><button type="button" className="btn quiet" onClick={onClose}>Cancel</button></div>
        </form>
      </div>
    </Modal>
  );
}

function AssignDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [apps, setApps] = useState<HostedT[]>([]);
  const [pick, setPick] = useState<HostedT | null>(null);
  useEffect(() => { const t = setTimeout(() => get<{ apps: HostedT[] }>(`/api/admin/apps?q=${encodeURIComponent(q)}`).then((r) => setApps(r.apps), () => {}), 150); return () => clearTimeout(t); }, [q]);
  if (pick) return <AddressDialog app={pick} onClose={onClose} />;
  return (
    <Modal title="Give an app an address" onClose={onClose}>
      <div className="modal-body">
        <label className="ix-search"><Icon name="search" size={16} /><input autoFocus placeholder="Find an app by name or owner email" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <ul className="acc-list compact pick-list">
          {apps.map((a) => <li key={a.id}><button className="cell-main" onClick={() => setPick(a)}><b>{a.name}</b><small>{a.ownerEmail}{a.slug ? ` · /${a.slug}` : ''}</small></button></li>)}
          {!apps.length && <li className="muted">No apps match.</li>}
        </ul>
      </div>
    </Modal>
  );
}

function AddressDialog({ app, onClose }: { app: HostedT; onClose: () => void }) {
  const toast = useToast();
  const [slug, setSlug] = useState(app.rootSlug ?? slugify(app.name));
  const [v, setV] = useState({ access: app.access === 'private' ? 'public' : app.access, publicRole: app.publicRole, password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (remove = false) => {
    setBusy(true); setError('');
    try {
      await api('PUT', `/api/admin/apps/${app.id}/address`, remove ? { slug: null } : { slug: slug || null, access: v.access, publicRole: v.publicRole, password: v.password || undefined });
      toast(remove ? 'Top-level address removed' : `Saved: ${location.host}/${slug}`); onClose();
    } catch (e) { setError(err(e, 'Could not save.')); }
    setBusy(false);
  };
  return (
    <Modal title={app.name} onClose={onClose}>
      <div className="modal-body">
        <div className="acc-form">
          <label className="field"><span>Top-level address</span><div className="slug-input"><span className="mono muted">{location.host}/</span><input className="input mono" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} /></div><small className="hint">Lowercase letters, numbers and dashes. It cannot be anyone's username.</small></label>
          <AccessFields v={v} set={setV} />
          <p className="hint">Its share link keeps working too: <span className="mono">{app.shareUrl}</span></p>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="actions-row"><button className="btn primary" disabled={busy || slug.length < 2} onClick={() => save()}>{busy && <span className="spin" />}Save</button>{app.rootSlug && <button className="btn quiet danger" disabled={busy} onClick={() => save(true)}>Remove address</button>}<button className="btn quiet" onClick={onClose}>Cancel</button></div>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- support ---------------- */
function Support({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const [list, setList] = useState<any[] | null>(null);
  const load = useCallback(() => get<{ tickets: any[] }>(`/api/admin/support?status=${status}`).then((r) => setList(r.tickets), () => {}), [status]);
  useEffect(() => { load(); }, [load]);
  const set = async (id: string, s: string) => { await api('PATCH', `/api/admin/support/${id}`, { status: s }); toast(s === 'closed' ? 'Closed' : 'Reopened'); load(); onChanged(); };
  return (
    <>
      <Head title="Support" lede="Messages, problem reports and feedback. Reply by email." />
      <div className="adm-tools"><div className="seg" role="group" aria-label="Status">{[['open', 'Open'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => <button key={k} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}</div></div>
      {!list ? <div className="acc-skel" /> : !list.length ? <p className="muted">Nothing here.</p> : (
        <ul className="tickets">
          {list.map((t) => (
            <li key={t.id}>
              <div className="t-head"><b>{t.subject}</b><span className="tag">{t.kind === 'problem' ? 'Problem' : t.kind === 'feedback' ? 'Feedback' : 'Contact'}</span><span className="muted small">{fmtDateTime(t.createdAt)}</span></div>
              <p className="t-body">{t.message}</p>
              <div className="t-foot"><a className="link" href={`mailto:${t.email}?subject=${encodeURIComponent('Re: ' + t.subject)}`}>{t.email}</a>{t.diagnostics && <span className="mono small muted">{Object.entries(JSON.parse(t.diagnostics)).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span>}
                <button className="btn sm" onClick={() => set(t.id, t.status === 'open' ? 'closed' : 'open')}>{t.status === 'open' ? 'Mark done' : 'Reopen'}</button></div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ---------------- audit log ---------------- */
function Audit() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { const t = setTimeout(() => get<{ entries: any[] }>(`/api/admin/audit?q=${encodeURIComponent(q)}`).then((r) => setRows(r.entries), () => {}), 150); return () => clearTimeout(t); }, [q]);
  return (
    <>
      <Head title="Audit log" lede="Every sensitive change by a super admin, and account deletions. It cannot be edited." />
      <div className="adm-tools"><label className="ix-search"><Icon name="search" size={16} /><input placeholder="Search actions, people, details" value={q} onChange={(e) => setQ(e.target.value)} /></label></div>
      {!rows ? <div className="acc-skel" /> : !rows.length ? <p className="muted">Nothing recorded yet.</p> : (
        <table className="adm-table">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th className="hide-sm">Details</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td className="muted small nowrap">{fmtDateTime(r.at)}</td><td>{r.actor}</td><td className="mono small">{r.action}</td><td className="hide-sm small">{r.detail}</td></tr>)}</tbody>
        </table>
      )}
    </>
  );
}

/* ---------------- settings ---------------- */
function Settings() {
  const toast = useToast();
  const [s, setS] = useState<{ uploads: boolean; signups: boolean; supportEmail: string; mailReady: boolean; mailSender: string | null; mailFrom: string; google: boolean; apple: boolean; publicUrl: string } | null>(null);
  const [testTo, setTestTo] = useState('');
  const [emails, setEmails] = useState<any[] | null>(null);
  const [support, setSupport] = useState('');
  const load = useCallback(() => { get<typeof s>('/api/admin/settings').then((r) => { setS(r); setSupport(r!.supportEmail); }, () => {}); get<{ emails: any[] }>('/api/admin/emails').then((r) => setEmails(r.emails), () => {}); }, []);
  useEffect(() => { load(); }, [load]);
  if (!s) return <div className="acc-skel" />;
  const put = async (body: Record<string, unknown>, msg: string) => { try { await api('PUT', '/api/admin/settings', body); toast(msg); load(); } catch (e) { toast(err(e, 'Could not save.'), true); } };
  return (
    <>
      <Head title="Settings" />
      <section className="adm-block">
        <h3 className="adm-sub">Send an announcement</h3>
        <p className="hint">Goes to people's bell and by email: new features, planned maintenance, price changes.</p>
        <Announce />
      </section>
      <ul className="acc-list settings-list">
        <li>
          <span><b>File uploads inside apps</b><small>{s.uploads ? 'On: people can upload photos, videos and files into apps.' : 'Off: apps use links (Drive, Dropbox, OneDrive, YouTube…). Payment proof, QR codes and profile photos still upload.'}</small></span>
          <label className="toggle"><input type="checkbox" checked={s.uploads} onChange={(e) => put({ uploads: e.target.checked }, e.target.checked ? 'Uploads are on' : 'Links only')} aria-label="File uploads inside apps" /><span aria-hidden="true" /></label>
        </li>
        <li>
          <span><b>New sign-ups</b><small>{s.signups ? 'Anyone can create a Free Forever account.' : 'Closed: only sign-ins you create can get in.'}</small></span>
          <label className="toggle"><input type="checkbox" checked={s.signups} onChange={(e) => put({ signups: e.target.checked }, e.target.checked ? 'Sign-ups are open' : 'Sign-ups are closed')} aria-label="New sign-ups" /><span aria-hidden="true" /></label>
        </li>
        <li className="stack">
          <span><b>Support email</b><small>Support requests are also emailed here.</small></span>
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); put({ supportEmail: support }, 'Saved'); }}><input className="input" type="email" value={support} onChange={(e) => setSupport(e.target.value)} placeholder="support@your-domain.com" /><button className="btn sm">Save</button></form>
        </li>
      </ul>
      <h3 className="adm-sub">Server</h3>
      <dl className="facts wide">
        <div><dt>Address</dt><dd className="mono">{s.publicUrl}</dd></div>
        <div><dt>Email delivery</dt><dd>{s.mailReady ? `On (${s.mailSender === 'resend' ? 'Resend' : 'SMTP'}), from ${s.mailFrom}` : 'Off: set RESEND_API_KEY (or SMTP_URL) and MAIL_FROM'}</dd></div>
        <div><dt>Continue with Google</dt><dd>{s.google ? 'On' : 'Off: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'}</dd></div>
        <div><dt>Continue with Apple</dt><dd>{s.apple ? 'On' : 'Off: set APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY'}</dd></div>
      </dl>
      {s.mailReady && (
        <form className="inline-form mail-test" onSubmit={async (e) => { e.preventDefault(); try { await post('/api/admin/mail/test', { to: testTo || undefined }); toast('Test email sent. See Recent emails for the result.'); setTimeout(load, 2500); } catch (e2) { toast(err(e2, 'Could not send.'), true); } }}>
          <input className="input" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Send a test to (default: you)" aria-label="Send a test email to" />
          <button className="btn sm"><Icon name="mail" size={15} />Send a test email</button>
        </form>
      )}
      <h3 className="adm-sub">Recent emails</h3>
      {!s.mailReady && <p className="hint">Emails are not delivered yet, so their text is shown here. You can pass a link on by hand. Treat these as private: they contain sign-in links.</p>}
      {!emails ? null : !emails.length ? <p className="muted">None yet.</p> : (
        <ul className="acc-list compact emails">
          {emails.slice(0, 30).map((m) => (
            <li key={m.id}><details><summary><span><b>{m.subject}</b><small>{m.to} · {m.status.replace('_', ' ')}</small></span><span className="muted small">{ago(m.createdAt)}</span></summary>{m.body && <pre className="code">{m.body}</pre>}{m.error && <p className="error-text">{m.error}</p>}</details></li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ---------------- Analytics: everything opened on Jhino, live and by day ---------------- */
interface LiveT { active: number; areas: { key: string; n: number }[]; apps: { key: string; name: string; n: number }[]; pages: { key: string; n: number }[]; countries: { key: string; n: number }[]; devices: { key: string; n: number }[]; recent: { area: string; title: string; country: string | null; device: string; ago: number }[] }
interface Top { key: string; views: number; visitors: number }
interface SiteT { days: number; series: { day: string; views: number; visitors: number }[]; hours: { hour: string; views: number }[]; totals: { views: number; visitors: number }; previous: { views: number; visitors: number };
  areas: Top[]; apps: (Top & { name: string; owner: string; address: string | null })[]; pages: Top[]; profiles: Top[]; countries: Top[]; refs: Top[]; devices: Top[]; browsers: Top[] }
const AREA_NAME: Record<string, string> = { website: 'Website', dashboard: 'Dashboards', app: 'Apps', profile: 'Public pages', link: 'Short links' };
const regionName = (() => { try { const d = new Intl.DisplayNames(['en'], { type: 'region' }); return (c: string) => (c === '—' ? 'Unknown' : d.of(c) ?? c); } catch { return (c: string) => c; } })();
const agoShort = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);

function SiteAnalytics() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<SiteT | null>(null);
  const [lv, setLv] = useState<LiveT | null>(null);
  useEffect(() => {
    setD(null);
    const load = () => get<SiteT>(`/api/admin/analytics?days=${days}`).then(setD, () => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [days]);
  useEffect(() => {
    const load = () => { if (document.visibilityState === 'visible') get<LiveT>('/api/admin/analytics/live').then(setLv, () => {}); };
    load();
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
  }, []);
  const list = (rows: Top[], name: (k: string) => string = (k) => k, empty = 'Nothing yet.') => {
    const top = Math.max(1, ...rows.map((r) => r.views));
    return !rows.length ? <p className="muted small">{empty}</p> : (
      <ul className="an-bars">{rows.map((r) => <li key={r.key}><span className="an-l" title={name(r.key)}>{name(r.key)}</span><span className="an-track"><i style={{ transform: `scaleX(${r.views / top})` }} /></span><span className="mono an-n" title={`${r.visitors} visitors`}>{r.views.toLocaleString('en-IN')}</span></li>)}</ul>
    );
  };
  const totalLive = lv?.active ?? 0;
  const appViews = d?.areas.find((a) => a.key === 'app')?.views ?? 0;
  return (
    <div className="dash">
      <Head title="Analytics" lede="Everything people open on Jhino: the website, dashboards, public pages and every app, whoever made it."
        actions={<div className="seg range" role="group" aria-label="Range">{[1, 7, 30, 90, 365].map((n) => <button key={n} aria-pressed={days === n} onClick={() => setDays(n)}>{n === 1 ? 'Today' : n === 365 ? '1 year' : `${n} days`}</button>)}</div>} />

      <section className="live-panel" aria-label="Right now">
        <div className="live-now">
          <p className="live-h"><span className="live-pulse" aria-hidden="true" />Right now</p>
          <p className="live-n mono" aria-live="polite">{totalLive.toLocaleString('en-IN')}</p>
          <p className="muted small">{totalLive === 1 ? 'person' : 'people'} on Jhino in the last 3 minutes</p>
          {lv && totalLive > 0 && (
            <>
              <div className="live-split" role="img" aria-label={lv.areas.filter((a) => a.n).map((a) => `${AREA_NAME[a.key]} ${a.n}`).join(', ')}>
                {lv.areas.filter((a) => a.n).map((a) => <i key={a.key} className={`ar-${a.key}`} style={{ flexGrow: a.n }} />)}
              </div>
              <ul className="live-legend">{lv.areas.filter((a) => a.n).map((a) => <li key={a.key}><i className={`ar-${a.key}`} />{AREA_NAME[a.key]} <b className="mono">{a.n}</b></li>)}</ul>
            </>
          )}
        </div>
        <div className="live-col">
          <h2 className="live-sub">Open now</h2>
          {!lv || (!lv.apps.length && !lv.pages.length) ? <p className="muted small">No one yet. This updates every few seconds.</p> : (
            <ul className="live-list">
              {lv.apps.map((a) => <li key={a.key}><Link to={`/admin/apps/${a.key}`} className="link">{a.name}</Link><span className="muted small">app</span><b className="mono">{a.n}</b></li>)}
              {lv.pages.slice(0, Math.max(0, 8 - lv.apps.length)).map((p) => <li key={p.key}><span>{p.key}</span><span className="muted small">page</span><b className="mono">{p.n}</b></li>)}
            </ul>
          )}
          {!!lv?.countries.length && <p className="live-where small muted">{lv.countries.slice(0, 5).map((c) => `${regionName(c.key)} ${c.n}`).join(' · ')}</p>}
        </div>
        <div className="live-col">
          <h2 className="live-sub">Just now</h2>
          {!lv?.recent.length ? <p className="muted small">Visits show here as they happen.</p> : (
            <ol className="live-feed">
              {lv.recent.slice(0, 9).map((h, i) => (
                <li key={i}><span className={`dot ar-${h.area}`} aria-hidden="true" /><span className="lf-t"><span className="lf-l">{h.area === 'link' ? 'Clicked ' : 'Opened '}<b>{h.title}</b></span><small>{h.country ? regionName(h.country) : 'Somewhere'} · {h.device}</small></span><span className="mono muted small">{agoShort(h.ago)}</span></li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {!d ? <div className="acc-skel" /> : (
        <>
          <section className="kpi-strip" aria-label="Totals">
            <div className="kpi2"><p className="k-l">Visitors</p><p className="k-v mono">{d.totals.visitors.toLocaleString('en-IN')}</p><PeriodDelta now={d.totals.visitors} before={d.previous.visitors} days={d.days} /></div>
            <div className="kpi2"><p className="k-l">Page views</p><p className="k-v mono">{d.totals.views.toLocaleString('en-IN')}</p><PeriodDelta now={d.totals.views} before={d.previous.views} days={d.days} /></div>
            <div className="kpi2"><p className="k-l">Views per visitor</p><p className="k-v mono">{d.totals.visitors ? (d.totals.views / d.totals.visitors).toFixed(1) : '0'}</p><p className="k-s">pages each visit</p></div>
            <div className="kpi2"><p className="k-l">Apps opened</p><p className="k-v mono">{appViews.toLocaleString('en-IN')}</p><p className="k-s">{d.apps.length} different {d.apps.length === 1 ? 'app' : 'apps'}</p></div>
          </section>

          <div className="dash-grid">
            <section className="dpanel span2">
              <div className="panel-h"><h2>Visitors and views</h2></div>
              {d.days > 1 ? <Lines a={d.series.map((x) => ({ day: x.day, n: x.visitors }))} b={d.series.map((x) => ({ day: x.day, n: x.views }))} labelA="Visitors" labelB="Views" />
                : <p className="muted small">Pick 7 days or more to see the trend. Today by hour is next to this.</p>}
            </section>
            <section className="dpanel">
              <div className="panel-h"><h2>Last 24 hours</h2></div>
              <Bars data={d.hours.map((h) => ({ key: h.hour, label: `${new Date(h.hour + ':00:00Z').getHours()}h`, n: h.views }))} label="Views each hour, last 24 hours" format={(n) => `${n} views`} />
            </section>

            <section className="dpanel span2">
              <div className="panel-h"><h2>Apps getting traffic</h2><span className="muted small">every customer's apps</span></div>
              {!d.apps.length ? <p className="muted small">No app has been opened in this time.</p> : (
                <table className="adm-table">
                  <thead><tr><th>App</th><th>Owner</th><th>Address</th><th className="num">Views</th><th className="num">Visitors</th></tr></thead>
                  <tbody>{d.apps.map((a) => <tr key={a.key}><td><Link to={`/admin/apps/${a.key}`} className="link">{a.name}</Link></td><td className="small">{a.owner}</td><td className="mono small">{a.address ? <a className="link" href={a.address} target="_blank" rel="noopener">{a.address}</a> : <span className="muted">share link</span>}</td><td className="num mono">{a.views.toLocaleString('en-IN')}</td><td className="num mono">{a.visitors.toLocaleString('en-IN')}</td></tr>)}</tbody>
                </table>
              )}
            </section>
            <section className="dpanel">
              <div className="panel-h"><h2>Where on Jhino</h2></div>
              {list(d.areas, (k) => AREA_NAME[k] ?? k)}
            </section>

            <section className="dpanel"><div className="panel-h"><h2>Countries</h2></div>{list(d.countries, regionName, 'Countries show once visitors arrive through Cloudflare.')}</section>
            <section className="dpanel"><div className="panel-h"><h2>Where they came from</h2></div>{list(d.refs)}</section>
            <section className="dpanel"><div className="panel-h"><h2>Website pages</h2></div>{list(d.pages, (k) => (k === '/' ? 'Home page' : k))}</section>
            <section className="dpanel"><div className="panel-h"><h2>Public pages</h2><span className="muted small">jhino.com/username</span></div>{list(d.profiles, (k) => `@${k}`)}</section>
            <section className="dpanel"><div className="panel-h"><h2>Devices</h2></div>{list(d.devices)}</section>
            <section className="dpanel"><div className="panel-h"><h2>Browsers</h2></div>{list(d.browsers)}</section>
          </div>
          <p className="hint">Visitors are counted once a day each, from a hash that changes daily; no addresses are stored. Bots and your own admin pages are left out.</p>
        </>
      )}
    </div>
  );
}

function PeriodDelta({ now, before, days }: { now: number; before: number; days: number }) {
  if (!before && !now) return <span className="kd flat">no change</span>;
  const d = now - before;
  const pct = before ? Math.round((d / before) * 100) : null;
  return <span className={`kd ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}`}>{d > 0 ? '+' : d < 0 ? '−' : ''}{Math.abs(d).toLocaleString('en-IN')}{pct !== null && d !== 0 ? ` (${d > 0 ? '+' : '−'}${Math.abs(pct)}%)` : ''} vs previous {days === 1 ? 'day' : `${days} days`}</span>;
}

/* ---------------- Apps made: what people build on Jhino, and how ---------------- */
interface CreationsT {
  days: number;
  series: { day: string; built: number; html: number; zip: number; builds: number }[];
  total: { apps: number; live: number; trash: number; versions: number; kinds: Record<string, number> };
  period: { apps: number; builds: number; makers: number; kinds: Record<string, number> };
  previous: { apps: number; builds: number };
  creators: { id: string; name: string; username: string | null; email: string; apps: number; builds: number }[];
  recent: { id: string; name: string; kind: string; createdAt: string; deletedAt: string | null; owner: string; username: string | null; versions: number }[];
}
const KIND_NAME: Record<string, string> = { built: 'Create app', html: 'HTML upload', zip: 'ZIP upload' };

function Creations() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<CreationsT | null>(null);
  useEffect(() => { setD(null); get<CreationsT>(`/api/admin/creations?days=${days}`).then(setD, () => {}); }, [days]);
  const k = (o: Record<string, number>, key: string) => (o[key] ?? 0).toLocaleString('en-IN');
  return (
    <div className="dash">
      <Head title="Apps made" lede="Every app people create on Jhino, and how: built with Create app, or uploaded as HTML or a ZIP. Each later publish counts as a build."
        actions={<div className="seg range" role="group" aria-label="Range">{[7, 30, 90, 365].map((n) => <button key={n} aria-pressed={days === n} onClick={() => setDays(n)}>{n === 365 ? '1 year' : `${n} days`}</button>)}</div>} />
      {!d ? <div className="acc-skel" /> : (
        <>
          <section className="kpi-strip" aria-label="In this period">
            <div className="kpi2"><p className="k-l">New apps</p><p className="k-v mono">{d.period.apps.toLocaleString('en-IN')}</p><PeriodDelta now={d.period.apps} before={d.previous.apps} days={d.days} /></div>
            <div className="kpi2"><p className="k-l">Builds and updates</p><p className="k-v mono">{d.period.builds.toLocaleString('en-IN')}</p><PeriodDelta now={d.period.builds} before={d.previous.builds} days={d.days} /></div>
            <div className="kpi2"><p className="k-l">Made with Create app</p><p className="k-v mono">{k(d.period.kinds, 'built')}</p><p className="k-s">{k(d.period.kinds, 'html')} HTML · {k(d.period.kinds, 'zip')} ZIP uploads</p></div>
            <div className="kpi2"><p className="k-l">People making apps</p><p className="k-v mono">{d.period.makers.toLocaleString('en-IN')}</p><p className="k-s">in this period</p></div>
          </section>

          <div className="dash-grid">
            <section className="dpanel span2">
              <div className="panel-h"><h2>New apps and builds</h2></div>
              <Lines a={d.series.map((x) => ({ day: x.day, n: x.built + x.html + x.zip }))} b={d.series.map((x) => ({ day: x.day, n: x.builds }))} labelA="New apps" labelB="Builds and updates" />
            </section>
            <section className="dpanel">
              <div className="panel-h"><h2>All time</h2></div>
              <dl className="facts">
                <div><dt>Apps made</dt><dd className="mono">{d.total.apps.toLocaleString('en-IN')}</dd></div>
                <div><dt>Live now</dt><dd className="mono">{d.total.live.toLocaleString('en-IN')}</dd></div>
                <div><dt>In trash</dt><dd className="mono">{d.total.trash.toLocaleString('en-IN')}</dd></div>
                <div><dt>Builds and updates</dt><dd className="mono">{d.total.versions.toLocaleString('en-IN')}</dd></div>
                <div><dt>Create app</dt><dd className="mono">{k(d.total.kinds, 'built')}</dd></div>
                <div><dt>HTML uploads</dt><dd className="mono">{k(d.total.kinds, 'html')}</dd></div>
                <div><dt>ZIP uploads</dt><dd className="mono">{k(d.total.kinds, 'zip')}</dd></div>
              </dl>
            </section>

            <section className="dpanel">
              <div className="panel-h"><h2>Who makes the most</h2></div>
              {!d.creators.length ? <p className="muted small">No apps made in this period.</p> : (
                <table className="adm-table"><thead><tr><th>Person</th><th className="num">Apps</th><th className="num">Builds</th></tr></thead>
                  <tbody>{d.creators.map((c) => <tr key={c.id}><td><Link to={`/admin/users/${c.id}`} className="link">{c.name}</Link>{c.username && <small className="muted"> @{c.username}</small>}</td><td className="num mono">{c.apps}</td><td className="num mono">{c.builds}</td></tr>)}</tbody></table>
              )}
            </section>
            <section className="dpanel span2">
              <div className="panel-h"><h2>Latest apps</h2><Link to="/admin/apps" className="link small">All apps</Link></div>
              <table className="adm-table">
                <thead><tr><th>App</th><th>Made with</th><th>By</th><th className="num">Versions</th><th>Made</th></tr></thead>
                <tbody>{d.recent.map((a) => (
                  <tr key={a.id}>
                    <td><Link to={`/admin/apps/${a.id}`} className="link">{a.name}</Link>{a.deletedAt && <small className="muted"> · in trash</small>}</td>
                    <td className="small">{KIND_NAME[a.kind] ?? a.kind}</td>
                    <td className="small">{a.owner}{a.username && <span className="muted"> @{a.username}</span>}</td>
                    <td className="num mono">{a.versions}</td>
                    <td className="small muted">{ago(a.createdAt)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
