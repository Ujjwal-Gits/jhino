import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api, get, post } from '../api';
import { Link, useRoute, useSession } from '../context';
import { Icon, Modal, Select, ago, copyText, useToast } from '../ui';

/*
 * Super Admin: customers, payments, QR codes, hosted addresses, support, audit log, settings.
 * One job per screen, lists first, details on demand.
 */

const npr = (n: number) => `NPR ${n.toLocaleString('en-IN')}`;
const fmtDateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const err = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);
const PLAN_OPTS = [{ value: 'free', label: 'Free Forever · 1' }, { value: 'plus', label: 'Plus · NPR 500 · 10' }, { value: 'pro', label: 'Pro · NPR 2,000 · 50' }];
const planName = (p: string) => ({ free: 'Free Forever', plus: 'Plus', pro: 'Pro' }[p] ?? p);

const NAV = [
  ['overview', 'Overview', 'chart'], ['users', 'Users', 'users'], ['payments', 'Payments', 'receipt'], ['methods', 'QR & payment methods', 'qr'],
  ['hosting', 'Hosting', 'globe'], ['support', 'Support', 'help'], ['audit', 'Audit log', 'audit'], ['settings', 'Settings', 'settings'],
] as const;

export function AdminPage({ section, sub }: { section: string; sub?: string }) {
  const [counts, setCounts] = useState<{ pendingPayments: number; openTickets: number } | null>(null);
  const loadCounts = useCallback(() => get<{ pendingPayments: number; openTickets: number }>('/api/admin/overview').then(setCounts, () => {}), []);
  useEffect(() => { loadCounts(); }, [loadCounts, section]);
  const cur = NAV.some((n) => n[0] === section) ? section : 'overview';
  return (
    <main className="page acc admin">
      <header className="acc-head"><h1>Super Admin</h1></header>
      <div className="acc-body">
        <nav className="acc-nav" aria-label="Super Admin">
          {NAV.map(([k, l, i]) => (
            <Link key={k} to={`/admin/${k}`} aria-current={cur === k ? 'page' : undefined}><Icon name={i} size={17} />{l}
              {k === 'payments' && !!counts?.pendingPayments && <span className="count">{counts.pendingPayments}</span>}
              {k === 'support' && !!counts?.openTickets && <span className="count">{counts.openTickets}</span>}
            </Link>
          ))}
        </nav>
        <div className="acc-main">
          {cur === 'overview' && <Overview />}
          {cur === 'users' && (sub ? <UserDetail id={sub} /> : <Users />)}
          {cur === 'payments' && (sub ? <PaymentDetail id={sub} onChanged={loadCounts} /> : <Payments />)}
          {cur === 'methods' && <Methods />}
          {cur === 'hosting' && <Hosting />}
          {cur === 'support' && <Support onChanged={loadCounts} />}
          {cur === 'audit' && <Audit />}
          {cur === 'settings' && <Settings />}
        </div>
      </div>
    </main>
  );
}

function Head({ title, lede, actions }: { title: string; lede?: ReactNode; actions?: ReactNode }) {
  return <div className="adm-head"><div><h2>{title}</h2>{lede && <p className="acc-lede">{lede}</p>}</div>{actions && <div className="actions-row">{actions}</div>}</div>;
}

/* ---------------- overview ---------------- */
function Overview() {
  const [o, setO] = useState<Record<string, any> | null>(null);
  useEffect(() => { get('/api/admin/overview').then(setO, () => {}); }, []);
  if (!o) return <div className="acc-skel" />;
  const cell = (label: string, value: ReactNode, to?: string, hot?: boolean) => (
    <div className={`kpi ${hot ? 'hot' : ''}`}>{to ? <Link to={to}><dt>{label}</dt><dd>{value}</dd></Link> : <><dt>{label}</dt><dd>{value}</dd></>}</div>
  );
  return (
    <>
      <Head title="Overview" />
      <dl className="kpis">
        {cell('Payments to review', o.pendingPayments, '/admin/payments', o.pendingPayments > 0)}
        {cell('Customers', o.users, '/admin/users')}
        {cell('Paying now', o.paying, '/admin/users?plan=paid')}
        {cell('Revenue, 30 days', npr(o.revenue30))}
        {cell('Apps', o.apps)}
        {cell('Hosted addresses', o.hosted, '/admin/hosting')}
        {cell('Open support requests', o.openTickets, '/admin/support', o.openTickets > 0)}
        {cell('New customers, 30 days', o.newUsers30)}
      </dl>
      {!o.mailReady && <p className="notice-line"><Icon name="mail" size={16} />Emails are not being delivered: set SMTP_URL on the server. Until then you can read them in <Link to="/admin/settings" className="link">Settings</Link>.</p>}
      <h3 className="adm-sub">Recent admin activity</h3>
      {!o.recent.length ? <p className="muted">Nothing yet.</p> : (
        <ul className="acc-list compact">{o.recent.map((r: any, i: number) => <li key={i}><span><b>{r.action.replace(/[._]/g, ' ')}</b><small>{r.actor} · {r.detail}</small></span><span className="muted small">{ago(r.at)}</span></li>)}</ul>
      )}
    </>
  );
}

/* ---------------- users ---------------- */
interface UserRowT { id: string; name: string; email: string; emailVerified: boolean | null; createdAt: string; status: string; role: string; usage: { planName: string; plan: string; used: number; limit: number | null } | null; lastLoginAt: string | null; lastPayment: string | null }
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
      <Head title="Users" lede={rows ? `${rows.total} ${rows.total === 1 ? 'person' : 'people'}` : ''} actions={<button className="btn primary sm" onClick={() => setCreate(true)}><Icon name="plus" size={15} />New sign-in</button>} />
      <div className="adm-tools">
        <label className="ix-search"><Icon name="search" size={16} /><span className="sr-only">Search users</span><input placeholder="Search by name, email or ID" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <Select size="sm" label="Role" value={filter.role} width={150} options={[{ value: '', label: 'Everyone' }, { value: 'creator', label: 'Customers' }, { value: 'client', label: 'Clients' }, { value: 'super_admin', label: 'Super admins' }]} onChange={(v) => setFilter({ ...filter, role: v })} />
        <Select size="sm" label="Plan" value={filter.plan} width={150} options={[{ value: '', label: 'Any plan' }, { value: 'free', label: 'Free Forever' }, { value: 'plus', label: 'Plus' }, { value: 'pro', label: 'Pro' }]} onChange={(v) => setFilter({ ...filter, plan: v })} />
        <Select size="sm" label="Status" value={filter.status} width={150} options={[{ value: '', label: 'Any status' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }, { value: 'unverified', label: 'Email not verified' }]} onChange={(v) => setFilter({ ...filter, status: v })} />
      </div>
      {!rows ? <div className="acc-skel" /> : !rows.users.length ? <p className="muted">No one matches.</p> : (
        <table className="adm-table">
          <thead><tr><th>Person</th><th className="hide-sm">Plan</th><th className="hide-sm">Usage</th><th className="hide-sm">Payment</th><th>Status</th><th className="hide-sm">Joined</th></tr></thead>
          <tbody>
            {rows.users.map((u) => (
              <tr key={u.id} className="clickable" onClick={() => go(`/admin/users/${u.id}`)}>
                <td><Link to={`/admin/users/${u.id}`} className="cell-main"><b>{u.name}</b><small>{u.email}{u.emailVerified === false ? ' · unverified' : ''}{u.role === 'super_admin' ? ' · super admin' : u.role === 'client' ? ' · client' : ''}</small></Link></td>
                <td className="hide-sm">{u.usage ? u.usage.planName : '—'}</td>
                <td className="hide-sm mono">{u.usage ? (u.usage.limit === null ? `${u.usage.used} / ∞` : `${u.usage.used} / ${u.usage.limit}`) : '—'}</td>
                <td className="hide-sm">{u.lastPayment ? <span className={`status s-${u.lastPayment}`}>{u.lastPayment}</span> : '—'}</td>
                <td><span className={`status ${u.status === 'active' ? 's-approved' : 's-rejected'}`}>{u.status}</span></td>
                <td className="hide-sm muted">{fmtDate(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {create && <CreateUser onClose={() => { setCreate(false); load(); }} />}
    </>
  );
}

function CreateUser({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', password: '', plan: 'plus', superAdmin: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState<{ email: string; password: string; signInUrl: string; name: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { const r = await post<{ user: UserRowT; password: string; signInUrl: string }>('/api/admin/users', { ...f, password: f.password || undefined }); setMade({ email: r.user.email, password: r.password, signInUrl: r.signInUrl, name: r.user.name }); }
    catch (e2) { setError(err(e2, 'Could not create it.')); }
    setBusy(false);
  };
  const text = made ? `Your Jhino account\nSign in: ${made.signInUrl}\nSign-in ID: ${made.email}\nPassword: ${made.password}\n\nChange the password after signing in (Account → Security).` : '';
  return (
    <Modal title={made ? 'Sign-in ready' : 'New sign-in'} onClose={onClose}>
      <div className="modal-body">
        {made ? (
          <>
            <p className="muted">Send this to {made.name} privately. The password is shown only now.</p>
            <div className="code" style={{ fontSize: 13 }}>{text}</div>
            <div className="actions-row"><button className="btn primary" onClick={() => copyText(text).then(() => toast('Copied'))}><Icon name="copy" size={15} />Copy</button><button className="btn" onClick={onClose}>Done</button></div>
          </>
        ) : (
          <form className="acc-form" onSubmit={submit}>
            <label className="field"><span>Name</span><input className="input" required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
            <label className="field"><span>Email or sign-in ID</span><input className="input" required autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
            <label className="field"><span>Password <em>optional</em></span><input className="input" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="Leave empty to generate one" /></label>
            {!f.superAdmin && <div className="field"><span>Plan</span><Select label="Plan" value={f.plan} options={PLAN_OPTS} onChange={(v) => setF({ ...f, plan: v })} /><small className="hint">For customers who paid outside Jhino. Paid by QR? Approve their payment in Payments instead.</small></div>}
            <label className="check-row"><input type="checkbox" checked={f.superAdmin} onChange={(e) => setF({ ...f, superAdmin: e.target.checked })} /><span>Make them a super admin (full access to this dashboard)</span></label>
            {error && <p className="error-text" role="alert">{error}</p>}
            <div className="actions-row"><button className="btn primary" disabled={busy || !f.name.trim() || f.email.trim().length < 3}>{busy && <span className="spin" />}Create sign-in</button><button type="button" className="btn quiet" onClick={onClose}>Cancel</button></div>
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
      <dl className="facts wide">
        <div><dt>User ID</dt><dd className="mono">{u.id}</dd></div>
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
          <p className="muted">{u.usage.planName} · {u.usage.limit === null ? `${u.usage.used} apps, no limit` : `${u.usage.used} of ${u.usage.limit} creations used`}</p>
          <div className="adm-plan">
            <div className="field"><span>Plan</span><Select label="Plan" value={edit.plan} options={PLAN_OPTS} onChange={(v) => setEdit({ ...edit, plan: v })} /></div>
            <label className="field"><span>Ends <em>optional</em></span><input className="input" type="date" value={edit.expires} onChange={(e) => setEdit({ ...edit, expires: e.target.value })} /></label>
            <label className="field"><span>Extra creations</span><input className="input mono" inputMode="numeric" value={edit.extra} onChange={(e) => setEdit({ ...edit, extra: e.target.value.replace(/[^\d-]/g, '') })} /></label>
          </div>
          <button className="btn sm" onClick={() => {
            const body: Record<string, unknown> = {};
            if (edit.plan !== u.usage.plan) body.plan = edit.plan;
            if ((edit.expires || null) !== (u.planExpiresAt ? u.planExpiresAt.slice(0, 10) : null)) body.planExpiresAt = edit.expires || null;
            if (Number(edit.extra || 0) !== u.extraCreations) body.extraCreations = Number(edit.extra || 0);
            if (!Object.keys(body).length) { toast('Nothing changed'); return; }
            patch(body, 'Plan updated');
          }}>Save plan</button>
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

      <section className="adm-block"><h3 className="adm-sub">Apps ({d.apps.length})</h3>
        {!d.apps.length ? <p className="muted">None.</p> : <ul className="acc-list compact">{d.apps.map((a: any) => <li key={a.id}><span><b>{a.name}</b><small>{a.access !== 'private' ? `${a.access} link` : 'private'}{a.slug ? ` · /${a.slug}` : ''}{a.deletedAt ? ' · in Trash' : ''}</small></span><span className="muted small">{fmtDate(a.createdAt)}</span></li>)}</ul>}
      </section>
      <section className="adm-block"><h3 className="adm-sub">Payments</h3>
        {!d.payments.length ? <p className="muted">None.</p> : <ul className="acc-list compact">{d.payments.map((p: any) => <li key={p.id}><Link to={`/admin/payments/${p.id}`} className="cell-main"><b>{planName(p.plan)} · {npr(p.amount)}</b><small>{p.method} · {fmtDate(p.createdAt)}</small></Link><span className={`status s-${p.status}`}>{p.status}</span></li>)}</ul>}
      </section>
      <section className="adm-block"><h3 className="adm-sub">Security activity</h3>
        {!d.security.length ? <p className="muted">None.</p> : <ul className="acc-list compact">{d.security.map((e: any, i: number) => <li key={i}><span><b>{e.kind.replace(/_/g, ' ')}</b><small>{e.device}{e.ip ? ' · ' + e.ip : ''}</small></span><span className="muted small">{fmtDateTime(e.at)}</span></li>)}</ul>}
      </section>
      {!!d.audit.length && <section className="adm-block"><h3 className="adm-sub">Admin changes</h3><ul className="acc-list compact">{d.audit.map((a: any, i: number) => <li key={i}><span><b>{a.action.replace(/[._]/g, ' ')}</b><small>{a.actor} · {a.detail}</small></span><span className="muted small">{fmtDateTime(a.at)}</span></li>)}</ul></section>}
    </>
  );
}

/* ---------------- payments ---------------- */
interface PaymentT { id: string; receiptNo: string; plan: string; planName: string; amount: number; expectedAmount: number; method: string; reference: string; paidOn: string; note: string; hasProof: boolean; status: string; rejectReason: string; createdAt: string; reviewedAt: string | null; userId: string | null; userEmail: string; userName: string; internalNote: string; reviewedBy: string }
function Payments() {
  const { go } = useRoute();
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [d, setD] = useState<{ payments: PaymentT[]; counts: Record<string, number> } | null>(null);
  useEffect(() => { const t = setTimeout(() => get<typeof d>(`/api/admin/payments?status=${status}&q=${encodeURIComponent(q)}`).then(setD, () => {}), 150); return () => clearTimeout(t); }, [status, q]);
  return (
    <>
      <Head title="Payments" lede="Check each screenshot against your bank or wallet, then approve or reject." />
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
                <td>{p.planName}</td>
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
  const [d, setD] = useState<{ payment: PaymentT; user: any; history: any[]; earlier: PaymentT[] } | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'' | 'approve' | 'reject'>('');
  const [rejecting, setRejecting] = useState(false);
  const load = useCallback(() => get<typeof d>(`/api/admin/payments/${id}`).then((r) => { setD(r); setNote(r!.payment.internalNote); }, (e) => toast(err(e, 'Not found.'), true)), [id, toast]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="acc-skel" />;
  const p = d.payment;
  const approve = async () => {
    if (!confirm(`Approve ${npr(p.amount)} from ${p.userName}? ${p.planName} turns on for them now.`)) return;
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
      <div className="crumb"><Link to="/admin/payments" className="link">Payments</Link> / {p.receiptNo}</div>
      <Head title={`${p.planName} · ${npr(p.amount)}`} lede={<><span className={`status s-${p.status}`}>{p.status}</span> · submitted {fmtDateTime(p.createdAt)}{p.reviewedAt && ` · reviewed by ${p.reviewedBy} ${fmtDateTime(p.reviewedAt)}`}</>} />
      <div className="pay-review">
        <div className="proof">
          {p.hasProof ? <a href={`/api/billing/payments/${p.id}/proof`} target="_blank" rel="noopener" title="Open full size"><img src={`/api/billing/payments/${p.id}/proof`} alt="Payment screenshot" /></a> : <p className="muted">No screenshot.</p>}
        </div>
        <div>
          <dl className="facts">
            <div><dt>Customer</dt><dd>{d.user ? <Link to={`/admin/users/${d.user.id}`} className="link">{p.userName}</Link> : p.userName}<br /><span className="muted">{p.userEmail}</span></dd></div>
            <div><dt>Plan</dt><dd>{p.planName} (price {npr(p.expectedAmount)})</dd></div>
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
interface HostedT { id: string; name: string; ownerEmail: string; access: string; publicRole: string; hasPassword: boolean; shareUrl: string; slug: string | null; slugUrl: string | null; updatedAt: string }
function Hosting() {
  const toast = useToast();
  const [d, setD] = useState<{ apps: HostedT[] } | null>(null);
  const [dialog, setDialog] = useState<'host' | 'assign' | null>(null);
  const [editing, setEditing] = useState<HostedT | null>(null);
  const load = useCallback(() => get<{ apps: HostedT[] }>('/api/admin/hosting').then(setD, () => {}), []);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <Head title="Hosting" lede="Short addresses like jhino.com/your-studio. Only super admins give them out." actions={<><button className="btn sm" onClick={() => setDialog('assign')}>Give an app an address</button><button className="btn primary sm" onClick={() => setDialog('host')}><Icon name="upload" size={15} />Host an HTML</button></>} />
      {!d ? <div className="acc-skel" /> : !d.apps.length ? <p className="muted">No app is open by link yet.</p> : (
        <table className="adm-table">
          <thead><tr><th>Address</th><th>App</th><th className="hide-sm">Owner</th><th>Access</th><th /></tr></thead>
          <tbody>
            {d.apps.map((a) => (
              <tr key={a.id}>
                <td>{a.slugUrl ? <a className="mono link" href={a.slugUrl} target="_blank" rel="noopener">/{a.slug}</a> : <span className="muted">share link only</span>}</td>
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
  const [slug, setSlug] = useState(app.slug ?? slugify(app.name));
  const [v, setV] = useState({ access: app.access === 'private' ? 'public' : app.access, publicRole: app.publicRole, password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (remove = false) => {
    setBusy(true); setError('');
    try {
      await api('PUT', `/api/admin/apps/${app.id}/address`, remove ? { slug: null } : { slug: slug || null, access: v.access, publicRole: v.publicRole, password: v.password || undefined });
      toast(remove ? 'Address removed' : `Saved: /${slug}`); onClose();
    } catch (e) { setError(err(e, 'Could not save.')); }
    setBusy(false);
  };
  return (
    <Modal title={app.name} onClose={onClose}>
      <div className="modal-body">
        <div className="acc-form">
          <label className="field"><span>Address</span><div className="slug-input"><span className="mono muted">{location.host}/</span><input className="input mono" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} /></div><small className="hint">Lowercase letters, numbers and dashes.</small></label>
          <AccessFields v={v} set={setV} />
          <p className="hint">Its share link keeps working too: <span className="mono">{app.shareUrl}</span></p>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="actions-row"><button className="btn primary" disabled={busy || slug.length < 2} onClick={() => save()}>{busy && <span className="spin" />}Save</button>{app.slug && <button className="btn quiet danger" disabled={busy} onClick={() => save(true)}>Remove address</button>}<button className="btn quiet" onClick={onClose}>Cancel</button></div>
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
  const [s, setS] = useState<{ uploads: boolean; signups: boolean; supportEmail: string; mailReady: boolean; google: boolean; apple: boolean; publicUrl: string } | null>(null);
  const [emails, setEmails] = useState<any[] | null>(null);
  const [support, setSupport] = useState('');
  const load = useCallback(() => { get<typeof s>('/api/admin/settings').then((r) => { setS(r); setSupport(r!.supportEmail); }, () => {}); get<{ emails: any[] }>('/api/admin/emails').then((r) => setEmails(r.emails), () => {}); }, []);
  useEffect(() => { load(); }, [load]);
  if (!s) return <div className="acc-skel" />;
  const put = async (body: Record<string, unknown>, msg: string) => { try { await api('PUT', '/api/admin/settings', body); toast(msg); load(); } catch (e) { toast(err(e, 'Could not save.'), true); } };
  return (
    <>
      <Head title="Settings" />
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
        <div><dt>Email delivery</dt><dd>{s.mailReady ? 'On (SMTP)' : 'Off: set SMTP_URL and MAIL_FROM'}</dd></div>
        <div><dt>Continue with Google</dt><dd>{s.google ? 'On' : 'Off: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'}</dd></div>
        <div><dt>Continue with Apple</dt><dd>{s.apple ? 'On' : 'Off: set APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY'}</dd></div>
      </dl>
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
