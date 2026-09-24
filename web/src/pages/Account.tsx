import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api, avatarUrl, get, post } from '../api';
import { Link, applyTheme, readTheme, useRoute, useSession, type Theme } from '../context';
import { Avatar, Icon, Select, ago, copyText, useToast } from '../ui';

/*
 * The Account Center: one quiet page per concern. The server decides everything that matters
 * (plans, usage, payments, sessions); this page shows it and sends changes.
 */

type Usage = { plan: string; planName: string; used: number; limit: number | null; remaining: number | null; expiresAt: string | null; expired: boolean };
type Prefs = Record<string, { inapp: boolean; email: boolean }>;
interface AccountData {
  user: { id: string; name: string; email: string; hasAvatar: boolean; emailIsAddress: boolean; emailVerified: boolean | null; passwordSet: boolean; canCreate: boolean; isAdmin: boolean };
  profile: { name: string; displayName: string; email: string; phone: string; country: string; timezone: string; language: string; company: string; jobTitle: string; bio: string };
  account: { id: string; status: string; createdAt: string; lastLogin: { at: string; device: string; ip: string } | null; emailVerifiedAt: string | null; pendingEmail: string | null; passwordChangedAt: string | null; kind: string };
  usage: Usage | null;
  identities: { provider: string; email: string; createdAt: string }[];
  providers: { google: boolean; apple: boolean };
  prefs: Prefs; essential: string[]; mailReady: boolean;
}
interface Plan { id: string; name: string; price: number; creations: number; blurb: string }
interface Method { id: string; name: string; provider: string; bank: string; accountName: string; accountNumber: string; instructions: string; notes: string; hasQr: boolean; qrVersion: string }
interface Payment { id: string; receiptNo: string; plan: string; planName: string; creations: number; amount: number; method: string; reference: string; paidOn: string; note: string; hasProof: boolean; status: 'pending' | 'approved' | 'rejected'; rejectReason: string; createdAt: string; reviewedAt: string | null }

const npr = (n: number) => `NPR ${n.toLocaleString('en-IN')}`;
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const fmtDateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const err = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const SECTIONS: { key: string; label: string; icon: string; creators?: boolean }[] = [
  { key: 'profile', label: 'Profile', icon: 'user' },
  { key: 'account', label: 'Account', icon: 'settings' },
  { key: 'security', label: 'Security', icon: 'shield' },
  { key: 'plan', label: 'Plan & usage', icon: 'chart', creators: true },
  { key: 'billing', label: 'Billing', icon: 'card', creators: true },
  { key: 'notifications', label: 'Notifications', icon: 'bell' },
  { key: 'privacy', label: 'Privacy & data', icon: 'lock' },
  { key: 'help', label: 'Help & support', icon: 'help' },
];

function Section({ title, lede, children, id }: { title: string; lede?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="acc-sec" aria-labelledby={id ?? title}>
      <h2 id={id ?? title}>{title}</h2>
      {lede && <p className="acc-lede">{lede}</p>}
      {children}
    </section>
  );
}

export function AccountPage({ section }: { section: string }) {
  const { user } = useSession();
  const [data, setData] = useState<AccountData | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => get<AccountData>('/api/account').then((d) => { setData(d); setError(''); }, (e) => setError(err(e, 'Could not load your account.'))), []);
  useEffect(() => { load(); }, [load]);
  const sections = SECTIONS.filter((s) => !s.creators || user.canCreate);
  const cur = sections.find((s) => s.key === section) ? section : 'profile';
  return (
    <main className="page acc">
      <header className="acc-head">
        <h1>Account</h1>
      </header>
      <div className="acc-body">
        <nav className="acc-nav" aria-label="Account sections">
          {sections.map((s) => (
            <Link key={s.key} to={`/account/${s.key}`} aria-current={cur === s.key ? 'page' : undefined}><Icon name={s.icon} size={17} />{s.label}</Link>
          ))}
        </nav>
        <div className="acc-main">
          {error && <p className="error-text" role="alert">{error} <button className="btn sm" onClick={load}>Try again</button></p>}
          {!data ? <div className="acc-skel" aria-busy="true" /> : (
            <>
              {cur === 'profile' && <ProfileSection data={data} onSaved={setData} />}
              {cur === 'account' && <AccountSection data={data} reload={load} />}
              {cur === 'security' && <SecuritySection data={data} reload={load} />}
              {cur === 'plan' && <PlanSection data={data} />}
              {cur === 'billing' && <BillingSection />}
              {cur === 'notifications' && <NotificationsSection data={data} onSaved={(prefs) => setData({ ...data, prefs })} />}
              {cur === 'privacy' && <PrivacySection data={data} />}
              {cur === 'help' && <HelpSection />}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/* ---------------- profile ---------------- */
const COUNTRY_CODES = 'NP IN BD BT LK PK CN JP KR SG MY TH AE QA SA KW BH OM US CA GB IE AU NZ DE FR NL BE CH AT IT ES PT SE NO DK FI PL CZ HU RO GR TR IL EG ZA NG KE BR MX AR CL CO PE ID PH VN HK TW MM KH LA MN AF IR IQ JO LB MV'.split(' ');
function countryOptions() {
  let names: Intl.DisplayNames | null = null;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* old browser */ }
  const list = COUNTRY_CODES.map((c) => ({ value: c, label: names?.of(c) ?? c })).sort((a, b) => (a.value === 'NP' ? -1 : b.value === 'NP' ? 1 : a.label.localeCompare(b.label)));
  return [{ value: '', label: 'Not set' }, ...list];
}
function timezoneOptions() {
  let zones: string[] = [];
  try { zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []; } catch { /* old browser */ }
  if (!zones.length) zones = ['Asia/Kathmandu', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'Australia/Sydney', 'UTC'];
  return [{ value: '', label: 'Not set' }, ...['Asia/Kathmandu', ...zones.filter((z) => z !== 'Asia/Kathmandu')].map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))];
}

function ProfileSection({ data, onSaved }: { data: AccountData; onSaved: (d: AccountData) => void }) {
  const toast = useToast();
  const { refresh, user } = useSession();
  const [p, setP] = useState(data.profile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [photoV, setPhotoV] = useState(Date.now());
  const file = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof p) => (e: { target: { value: string } }) => setP({ ...p, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { const d = await api<AccountData>('PATCH', '/api/account/profile', p); onSaved(d); await refresh(); toast('Profile saved'); }
    catch (e2) { setError(err(e2, 'Could not save.')); }
    setBusy(false);
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast('Use a photo up to 2 MB.', true); return; }
    const fd = new FormData(); fd.append('file', f);
    try { await api('POST', '/api/account/avatar', fd); await refresh(); setPhotoV(Date.now()); onSaved({ ...data, user: { ...data.user, hasAvatar: true } }); toast('Photo updated'); }
    catch (e2) { toast(err(e2, 'Could not upload the photo.'), true); }
  };
  const removePhoto = async () => {
    try { await api('DELETE', '/api/account/avatar'); await refresh(); onSaved({ ...data, user: { ...data.user, hasAvatar: false } }); toast('Photo removed'); } catch (e2) { toast(err(e2, 'Could not remove it.'), true); }
  };
  return (
    <Section title="Profile" lede="How you appear to the people you work with.">
      <div className="acc-photo">
        <Avatar name={p.name || user.name} size="lg" src={avatarUrl({ id: user.id, hasAvatar: user.hasAvatar }, photoV)} />
        <div>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          <div className="actions-row">
            <button className="btn sm" type="button" onClick={() => file.current?.click()}><Icon name="image" size={15} />{user.hasAvatar ? 'Change photo' : 'Add a photo'}</button>
            {user.hasAvatar && <button className="btn sm quiet" type="button" onClick={removePhoto}>Remove</button>}
          </div>
          <small className="hint">JPG, PNG or WEBP, up to 2 MB.</small>
        </div>
      </div>
      <form className="acc-form" onSubmit={save}>
        <div className="grid2">
          <label className="field"><span>Full name</span><input className="input" required maxLength={80} autoComplete="name" value={p.name} onChange={set('name')} /></label>
          <label className="field"><span>Display name <em>optional</em></span><input className="input" maxLength={60} value={p.displayName} onChange={set('displayName')} placeholder="What people call you" /></label>
          <div className="field"><span>Email</span><p className="static">{data.profile.email} {data.user.emailIsAddress && <VerifiedTag ok={!!data.user.emailVerified} />}</p><small className="hint">Change it in <Link to="/account/account" className="link">Account</Link>.</small></div>
          <label className="field"><span>Phone <em>optional</em></span><input className="input" type="tel" autoComplete="tel" maxLength={30} value={p.phone} onChange={set('phone')} placeholder="+977 98…" /></label>
          <div className="field"><span>Country or region</span><Select label="Country or region" value={p.country} options={countryOptions()} onChange={(v) => setP({ ...p, country: v })} /></div>
          <div className="field"><span>Time zone</span><Select label="Time zone" value={p.timezone} options={timezoneOptions()} onChange={(v) => setP({ ...p, timezone: v })} /></div>
          <div className="field"><span>Language</span><Select label="Language" value={p.language} options={[{ value: 'en', label: 'English' }, { value: 'ne', label: 'नेपाली (Nepali)', hint: 'Emails and screens stay in English for now' }]} onChange={(v) => setP({ ...p, language: v })} /></div>
          <label className="field"><span>Company or organisation <em>optional</em></span><input className="input" maxLength={100} autoComplete="organization" value={p.company} onChange={set('company')} /></label>
          <label className="field"><span>Job title <em>optional</em></span><input className="input" maxLength={80} autoComplete="organization-title" value={p.jobTitle} onChange={set('jobTitle')} /></label>
        </div>
        <label className="field"><span>Short bio <em>optional</em></span><textarea className="textarea" rows={3} maxLength={500} value={p.bio} onChange={set('bio')} /><small className="hint">{p.bio.length}/500</small></label>
        <dl className="facts">
          <div><dt>Member since</dt><dd>{fmtDate(data.account.createdAt)}</dd></div>
          <div><dt>Last sign-in</dt><dd>{data.account.lastLogin ? `${fmtDateTime(data.account.lastLogin.at)} · ${data.account.lastLogin.device}` : 'This is your first'}</dd></div>
        </dl>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div><button className="btn primary" disabled={busy || !p.name.trim()}>{busy && <span className="spin" />}Save profile</button></div>
      </form>
    </Section>
  );
}

function VerifiedTag({ ok }: { ok: boolean }) {
  return <span className={`vtag ${ok ? 'ok' : ''}`}>{ok ? <><Icon name="check" size={13} />Verified</> : 'Not verified'}</span>;
}

/* ---------------- account ---------------- */
function AccountSection({ data, reload }: { data: AccountData; reload: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState({ open: false, value: '', password: '', busy: false, error: '' });
  const resend = async () => {
    try { await post('/api/account/verify/resend'); toast('Sent. Check your inbox.'); } catch (e) { toast(err(e, 'Could not send.'), true); }
  };
  const change = async (e: FormEvent) => {
    e.preventDefault();
    setEmail({ ...email, busy: true, error: '' });
    try { await post('/api/account/email', { email: email.value, password: email.password }); setEmail({ open: false, value: '', password: '', busy: false, error: '' }); toast('Check the new inbox to confirm.'); reload(); }
    catch (e2) { setEmail({ ...email, busy: false, error: err(e2, 'Could not start the change.') }); }
  };
  const cancelPending = async () => { await api('DELETE', '/api/account/email/pending'); reload(); };
  const kindLabel = data.account.kind === 'super_admin' ? 'Super admin' : data.account.kind === 'client' ? 'Client (opens apps shared with you)' : 'Creator';
  return (
    <>
      <Section title="Email" lede="Security emails always go here.">
        <div className="acc-card">
          <div className="acc-card-row">
            <div><b>{data.profile.email}</b> {data.user.emailIsAddress ? <VerifiedTag ok={!!data.user.emailVerified} /> : <span className="vtag">Sign-in ID</span>}</div>
            {data.user.emailIsAddress && !data.user.emailVerified && <button className="btn sm" onClick={resend}>Resend confirmation</button>}
          </div>
          {data.account.pendingEmail && (
            <p className="notice-line">Waiting for you to confirm <b>{data.account.pendingEmail}</b>. Until then your current email stays in use. <button className="link" onClick={cancelPending}>Cancel the change</button></p>
          )}
          {!email.open ? <button className="btn sm" onClick={() => setEmail({ ...email, open: true })}>{data.user.emailIsAddress ? 'Change email' : 'Add an email'}</button> : (
            <form className="acc-form tight" onSubmit={change}>
              <label className="field"><span>New email</span><input className="input" type="email" required autoComplete="email" value={email.value} onChange={(e) => setEmail({ ...email, value: e.target.value })} /></label>
              {data.user.passwordSet && <label className="field"><span>Your password</span><input className="input" type="password" required autoComplete="current-password" value={email.password} onChange={(e) => setEmail({ ...email, password: e.target.value })} /></label>}
              <p className="hint">We send a link to the new address. It replaces your email only after you open it.</p>
              {email.error && <p className="error-text" role="alert">{email.error}</p>}
              <div className="actions-row"><button className="btn primary sm" disabled={email.busy || !email.value}>{email.busy && <span className="spin" />}Send confirmation</button><button type="button" className="btn sm quiet" onClick={() => setEmail({ open: false, value: '', password: '', busy: false, error: '' })}>Cancel</button></div>
            </form>
          )}
        </div>
        {!data.mailReady && <p className="hint">Emails are not being delivered on this server yet. A super admin can see them in Super Admin → Settings.</p>}
      </Section>
      <Appearance />
      <Section title="Account information">
        <dl className="facts wide">
          <div><dt>User ID</dt><dd className="mono">{data.account.id} <button className="icon-btn sm" aria-label="Copy user ID" onClick={() => copyText(data.account.id).then(() => toast('Copied'))}><Icon name="copy" size={14} /></button></dd></div>
          <div><dt>Status</dt><dd>{data.account.status === 'active' ? 'Active' : 'Suspended'}</dd></div>
          <div><dt>Account type</dt><dd>{kindLabel}</dd></div>
          <div><dt>Registered</dt><dd>{fmtDate(data.account.createdAt)}</dd></div>
          {data.usage && <>
            <div><dt>Current plan</dt><dd>{data.usage.planName}</dd></div>
            <div><dt>Creations used</dt><dd>{data.usage.limit === null ? `${data.usage.used} (no limit)` : `${data.usage.used} of ${data.usage.limit}`}</dd></div>
            <div><dt>Remaining</dt><dd>{data.usage.remaining === null ? 'No limit' : data.usage.remaining}</dd></div>
            <div><dt>Renewal</dt><dd>{data.usage.expiresAt ? `Ends ${fmtDate(data.usage.expiresAt)}` : 'No renewal needed: paid once'}</dd></div>
          </>}
        </dl>
        {data.usage && <Link to="/account/plan" className="btn sm">Plan & usage</Link>}
      </Section>
    </>
  );
}

function Appearance() {
  const [theme, setTheme] = useState<Theme>(readTheme());
  return (
    <Section title="Appearance" lede="On this device only.">
      <div className="seg" role="group" aria-label="Appearance" style={{ marginLeft: 0, width: 'max-content' }}>
        {(['light', 'dark', 'system'] as Theme[]).map((t) => (
          <button key={t} style={{ width: 'auto', padding: '0 12px', fontSize: 13 }} aria-pressed={theme === t} onClick={() => { setTheme(t); applyTheme(t); }}>
            {t === 'system' ? 'Match device' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
    </Section>
  );
}

/* ---------------- security ---------------- */
interface Session { id: string; device: string; ip: string; createdAt: string; lastSeenAt: string; current: boolean }
const EVENT_TEXT: Record<string, string> = {
  login: 'Signed in', login_failed: 'Wrong password entered', logout: 'Signed out', password_changed: 'Password changed', password_reset: 'Password reset by email link',
  reset_requested: 'Password reset requested', email_verified: 'Email confirmed', email_changed: 'Email changed', email_change_requested: 'Email change requested',
  session_revoked: 'A device was signed out', sessions_revoked: 'All other devices signed out', sign_in_method_added: 'Sign-in method added', sign_in_method_removed: 'Sign-in method removed',
  data_exported: 'Account data downloaded', reauth_failed: 'Wrong password at a check',
};
function SecuritySection({ data, reload }: { data: AccountData; reload: () => void }) {
  const toast = useToast();
  const { go } = useRoute();
  const [sessions, setSessions] = useState<{ sessions: Session[]; downloadedFiles: number } | null>(null);
  const [events, setEvents] = useState<{ kind: string; device: string; ip: string; detail: string; at: string }[]>([]);
  const [pw, setPw] = useState({ open: false, current: '', next: '', again: '', busy: false, error: '' });
  const loadAll = useCallback(() => {
    get<{ sessions: Session[]; downloadedFiles: number }>('/api/account/sessions').then(setSessions, () => {});
    get<{ events: typeof events }>('/api/account/security').then((r) => setEvents(r.events), () => {});
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('linked')) toast(`${q.get('linked') === 'google' ? 'Google' : 'Apple'} can now be used to sign in.`);
    if (q.get('error') === 'oauth_taken') toast('That account is already linked to another Jhino account.', true);
  }, [toast]);
  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.next !== pw.again) { setPw({ ...pw, error: 'The new passwords are not the same.' }); return; }
    setPw({ ...pw, busy: true, error: '' });
    try { await post('/api/account/password', { current: pw.current, next: pw.next }); setPw({ open: false, current: '', next: '', again: '', busy: false, error: '' }); toast('Password changed. Other devices were signed out.'); reload(); loadAll(); }
    catch (e2) { setPw({ ...pw, busy: false, error: err(e2, 'Could not change the password.') }); }
  };
  const signOut = async (s: Session) => {
    try { const r = await api<{ current: boolean }>('DELETE', `/api/account/sessions/${s.id}`); if (r.current) { go('/login', true); location.reload(); } else { toast('Signed out that device'); loadAll(); } }
    catch (e) { toast(err(e, 'Could not sign it out.'), true); }
  };
  const signOutOthers = async () => {
    if (!confirm('Sign out every other device and downloaded app file? You stay signed in here.')) return;
    try { await post('/api/account/sessions/others'); toast('All other devices are signed out'); loadAll(); } catch (e) { toast(err(e, 'Could not do that.'), true); }
  };
  const unlink = async (p: string) => {
    const r = await post<{ ok: boolean; message?: string }>(`/api/account/identities/${p}/remove`);
    if (!r.ok) toast(r.message ?? 'Could not remove it.', true); else { toast('Removed'); reload(); }
  };
  const linked = new Set(data.identities.map((i) => i.provider));
  return (
    <>
      <Section title="Password" lede={data.user.passwordSet ? `Last changed ${data.account.passwordChangedAt ? fmtDate(data.account.passwordChangedAt) : 'when the account was made'}.` : 'You sign in with Google or Apple. Add a password to sign in with your email too.'}>
        {!pw.open ? <button className="btn sm" onClick={() => setPw({ ...pw, open: true })}><Icon name="lock" size={15} />{data.user.passwordSet ? 'Change password' : 'Set a password'}</button> : (
          <form className="acc-form tight" onSubmit={changePw}>
            {data.user.passwordSet && <label className="field"><span>Current password</span><input className="input" type="password" required autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>}
            <label className="field"><span>New password</span><input className="input" type="password" required minLength={10} autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /><small className="hint">At least 10 characters. Other devices will be signed out.</small></label>
            <label className="field"><span>New password again</span><input className="input" type="password" required autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></label>
            {pw.error && <p className="error-text" role="alert">{pw.error}</p>}
            <div className="actions-row"><button className="btn primary sm" disabled={pw.busy || pw.next.length < 10}>{pw.busy && <span className="spin" />}Save password</button><button type="button" className="btn sm quiet" onClick={() => setPw({ open: false, current: '', next: '', again: '', busy: false, error: '' })}>Cancel</button></div>
          </form>
        )}
      </Section>

      {(data.providers.google || data.providers.apple || data.identities.length > 0) && (
        <Section title="Sign-in methods">
          <ul className="acc-list">
            <li><span><b>Email and password</b><small>{data.user.passwordSet ? 'On' : 'Not set'}</small></span></li>
            {(['google', 'apple'] as const).filter((p) => data.providers[p] || linked.has(p)).map((p) => (
              <li key={p}>
                <span><b>{p === 'google' ? 'Google' : 'Apple'}</b><small>{linked.has(p) ? data.identities.find((i) => i.provider === p)?.email || 'Linked' : 'Not linked'}</small></span>
                {linked.has(p) ? <button className="btn sm quiet" onClick={() => unlink(p)}>Remove</button> : <a className="btn sm" href={`/api/auth/oauth/${p}/start?link=1`}>Link</a>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Two-step sign-in" lede="An extra code when you sign in on a new device.">
        <p className="acc-muted-box">Not available yet. Your account is ready for it, and we will tell you in the app when you can turn it on.</p>
      </Section>

      <Section title="Where you are signed in" lede="End any session you do not recognise.">
        {!sessions ? <div className="acc-skel sm" /> : (
          <>
            <ul className="acc-list">
              {sessions.sessions.map((s) => (
                <li key={s.id}>
                  <span><b>{s.device}{s.current && <span className="vtag ok">This device</span>}</b><small>{s.ip ? `${s.ip} · ` : ''}active {ago(s.lastSeenAt)} · signed in {fmtDate(s.createdAt)}</small></span>
                  <button className="btn sm quiet" onClick={() => signOut(s)}>{s.current ? 'Sign out' : 'Sign out'}</button>
                </li>
              ))}
            </ul>
            {sessions.downloadedFiles > 0 && <p className="hint">Also signed in: {sessions.downloadedFiles} downloaded app file{sessions.downloadedFiles === 1 ? '' : 's'}.</p>}
            {(sessions.sessions.length > 1 || sessions.downloadedFiles > 0) && <button className="btn sm" onClick={signOutOthers}>Sign out all other devices</button>}
          </>
        )}
      </Section>

      <Section title="Recent security activity">
        {!events.length ? <p className="muted">Nothing yet.</p> : (
          <ul className="acc-list compact">
            {events.map((e, i) => (
              <li key={i}><span><b>{EVENT_TEXT[e.kind] ?? e.kind.replace(/_/g, ' ')}</b><small>{[e.device, e.ip, e.detail].filter(Boolean).join(' · ')}</small></span><span className="muted mono small">{fmtDateTime(e.at)}</span></li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

/* ---------------- plan & usage (with checkout) ---------------- */
function UsageMeter({ u }: { u: Usage }) {
  const pct = u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
  return (
    <div className="usage">
      <div className="usage-top">
        <div><span className="mono small muted">Current plan</span><b className="usage-plan">{u.planName}</b></div>
        <p className="usage-num"><b>{u.used}</b>{u.limit !== null && <> of {u.limit}</>} creations used</p>
      </div>
      {u.limit !== null && <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={u.limit} aria-valuenow={u.used} aria-label="Creations used"><i style={{ transform: `scaleX(${pct / 100})` }} /></div>}
      <p className="muted">{u.limit === null ? 'No limit on this account.' : u.remaining === 0 ? 'No creations left. Upgrade, or delete an app for good to free one.' : `${u.remaining} creation${u.remaining === 1 ? '' : 's'} remaining.`}{u.expired && ' Your paid plan has ended; you are on Free Forever.'}</p>
    </div>
  );
}

function PlanSection({ data }: { data: AccountData }) {
  const [billing, setBilling] = useState<{ plans: Plan[]; usage: Usage; methods: Method[]; payments: Payment[]; pending: boolean } | null>(null);
  const [choose, setChoose] = useState<string | null>(() => new URLSearchParams(location.search).get('choose'));
  const load = useCallback(() => get<typeof billing>('/api/billing').then(setBilling, () => {}), []);
  useEffect(() => { load(); }, [load]);
  if (!billing || !data.usage) return <div className="acc-skel" />;
  const u = billing.usage;
  const pending = billing.payments.find((p) => p.status === 'pending');
  const plan = billing.plans.find((p) => p.id === choose && p.price > 0);
  return (
    <>
      <Section title="Plan & usage">
        <UsageMeter u={u} />
        {pending && <p className="notice-line"><Icon name="info" size={16} />Your payment of {npr(pending.amount)} for {pending.planName} is being verified. We will let you know as soon as it is reviewed. <Link to="/account/billing" className="link">See status</Link></p>}
      </Section>
      {plan ? <Checkout plan={plan} methods={billing.methods} onCancel={() => setChoose(null)} onDone={() => { setChoose(null); load(); }} /> : (
        <Section title="Plans" lede="Pay once by QR and upload the screenshot. We turn the plan on after checking the payment.">
          <table className="plan-table">
            <thead><tr><th>Plan</th><th>Price</th><th>Creations</th><th /></tr></thead>
            <tbody>
              {billing.plans.map((p) => {
                const current = u.plan === p.id && u.limit !== null;
                return (
                  <tr key={p.id} className={current ? 'current' : ''}>
                    <th scope="row"><b>{p.name}</b><small>{p.blurb}</small></th>
                    <td className="mono">{p.price ? npr(p.price) : 'Free'}</td>
                    <td className="mono">up to {p.creations}</td>
                    <td>{current ? <span className="vtag ok">Your plan</span> : p.price > 0 ? <button className="btn sm primary" disabled={!!pending || u.limit === null} onClick={() => setChoose(p.id)}>Choose</button> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {u.limit === null && <p className="hint">Super admin accounts have no limit.</p>}
        </Section>
      )}
    </>
  );
}

function Checkout({ plan, methods, onCancel, onDone }: { plan: Plan; methods: Method[]; onCancel: () => void; onDone: () => void }) {
  const toast = useToast();
  const [methodId, setMethodId] = useState(methods[0]?.id ?? '');
  const [f, setF] = useState({ amount: String(plan.price), reference: '', paidOn: new Date().toISOString().slice(0, 10), note: '' });
  const [shot, setShot] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const m = methods.find((x) => x.id === methodId);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const pick = (file: File | undefined) => {
    setError('');
    if (!file) return;
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) { setError('Use a JPG, JPEG, PNG or WEBP screenshot.'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('The screenshot can be up to 10 MB.'); return; }
    setShot(file); setPreview(URL.createObjectURL(file));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!shot) { setError('Upload a screenshot of the payment.'); return; }
    setBusy(true); setError('');
    const fd = new FormData();
    fd.append('plan', plan.id); fd.append('amount', f.amount); fd.append('methodId', methodId); fd.append('reference', f.reference); fd.append('paidOn', f.paidOn); fd.append('note', f.note);
    fd.append('proof', shot, shot.name);
    try { await api('POST', '/api/billing/payments', fd); setSent(true); toast('Payment submitted'); }
    catch (e2) { setError(err(e2, 'Could not submit the payment.')); }
    setBusy(false);
  };
  if (sent) {
    return (
      <Section title="Payment submitted">
        <div className="done-box" role="status">
          <Icon name="check" size={22} />
          <div><b>Payment submitted successfully.</b><p>Your payment is currently being verified. Your plan will be activated after approval.</p></div>
        </div>
        <div className="actions-row"><Link to="/account/billing" className="btn">See payment status</Link><button className="btn quiet" onClick={onDone}>Back to plans</button></div>
      </Section>
    );
  }
  return (
    <Section title={`Upgrade to ${plan.name}`} lede={`${npr(plan.price)} · up to ${plan.creations} creations`}>
      {!methods.length ? (
        <div className="acc-muted-box">Payments are not open yet. Please write to us through <Link to="/account/help" className="link">Help</Link> and we will set up your plan. <div style={{ marginTop: 10 }}><button className="btn sm" onClick={onCancel}>Back</button></div></div>
      ) : (
        <div className="checkout">
          <div className="pay-to">
            {methods.length > 1 && <div className="field"><span>Pay with</span><Select label="Payment method" value={methodId} options={methods.map((x) => ({ value: x.id, label: x.name }))} onChange={setMethodId} /></div>}
            {m && <>
              <div className="qr-box">{m.hasQr ? <img src={`/api/billing/methods/${m.id}/qr?v=${encodeURIComponent(m.qrVersion)}`} alt={`QR code for ${m.name}`} /> : <span className="muted">No QR for this method</span>}</div>
              <dl className="facts">
                <div><dt>Method</dt><dd>{m.name}</dd></div>
                {m.bank && <div><dt>Bank / wallet</dt><dd>{m.bank}</dd></div>}
                {m.accountName && <div><dt>Account name</dt><dd>{m.accountName}</dd></div>}
                {m.accountNumber && <div><dt>Account number</dt><dd className="mono">{m.accountNumber}</dd></div>}
                <div><dt>Amount</dt><dd className="mono"><b>{npr(plan.price)}</b></dd></div>
              </dl>
              {m.instructions && <p className="pay-instr">{m.instructions}</p>}
              {m.notes && <p className="hint">{m.notes}</p>}
            </>}
          </div>
          <form className="acc-form" onSubmit={submit}>
            <p className="step-label mono">After paying, tell us about it</p>
            <div className="grid2">
              <label className="field"><span>Amount paid (NPR)</span><input className="input mono" inputMode="numeric" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d]/g, '') })} /></label>
              <label className="field"><span>Payment date</span><input className="input" type="date" required max={new Date(Date.now() + 864e5).toISOString().slice(0, 10)} value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></label>
            </div>
            <label className="field"><span>Transaction or reference ID <em>optional</em></span><input className="input mono" maxLength={80} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
            <div className="field">
              <span>Payment screenshot</span>
              <label className={`shot ${preview ? 'has' : ''}`}>
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
                {preview ? <img src={preview} alt="Your payment screenshot" /> : <><Icon name="upload" size={20} /><b>Upload payment screenshot</b><small>JPG, PNG or WEBP, up to 10 MB</small></>}
              </label>
              {shot && <small className="hint">{shot.name} · {(shot.size / 1048576).toFixed(1)} MB · <button type="button" className="link" onClick={() => { setShot(null); setPreview(''); }}>Choose another</button></small>}
            </div>
            <label className="field"><span>Note <em>optional</em></span><textarea className="textarea" rows={2} maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
            {error && <p className="error-text" role="alert">{error}</p>}
            <div className="actions-row"><button className="btn primary" disabled={busy || !shot || !f.amount}>{busy && <span className="spin" />}Submit payment</button><button type="button" className="btn quiet" onClick={onCancel}>Cancel</button></div>
          </form>
        </div>
      )}
    </Section>
  );
}

/* ---------------- billing ---------------- */
const STATUS_TEXT = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
function BillingSection() {
  const [b, setB] = useState<{ plans: Plan[]; usage: Usage; payments: Payment[] } | null>(null);
  useEffect(() => { get<typeof b>('/api/billing').then(setB, () => {}); }, []);
  if (!b) return <div className="acc-skel" />;
  const rejected = b.payments.find((p) => p.status === 'rejected');
  const latestPending = b.payments.find((p) => p.status === 'pending');
  return (
    <>
      <Section title="Billing" lede={`${b.usage.planName}${b.usage.limit !== null ? ` · up to ${b.usage.limit} creations` : ''}`}>
        {latestPending && <p className="notice-line"><Icon name="info" size={16} /><span><b>Pending:</b> payment submitted and waiting for review.</span></p>}
        {rejected && !latestPending && b.payments[0]?.id === rejected.id && (
          <div className="reject-box" role="status">
            <b>Your last payment could not be verified.</b>
            <p>{rejected.rejectReason}</p>
            <Link to={`/account/plan?choose=${rejected.plan}`} className="btn sm">Submit corrected payment proof</Link>
          </div>
        )}
        <Link to="/account/plan" className="btn sm">Upgrade plan</Link>
      </Section>
      <Section title="Payment history">
        {!b.payments.length ? <p className="muted">No payments yet.</p> : (
          <table className="pay-table">
            <thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th className="hide-sm">Reference</th><th>Status</th><th /></tr></thead>
            <tbody>
              {b.payments.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDate(p.createdAt)}</td>
                  <td>{p.planName}</td>
                  <td className="mono">{npr(p.amount)}</td>
                  <td className="mono hide-sm">{p.reference || p.receiptNo}</td>
                  <td><span className={`status s-${p.status}`}>{STATUS_TEXT[p.status]}</span>{p.status === 'rejected' && <small className="reason">{p.rejectReason}</small>}</td>
                  <td>{p.status === 'approved' ? <Link to={`/account/receipt/${p.id}`} className="link">Receipt</Link> : p.hasProof ? <a className="link" href={`/api/billing/payments/${p.id}/proof`} target="_blank" rel="noopener">Screenshot</a> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}

export function ReceiptPage({ id }: { id: string }) {
  const { user } = useSession();
  const [p, setP] = useState<Payment | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { get<{ payment: Payment }>(`/api/billing/payments/${id}`).then((r) => setP(r.payment), (e) => setError(err(e, 'Receipt not found.'))); }, [id]);
  return (
    <main className="page receipt-page">
      <div className="receipt-tools no-print"><Link to="/account/billing" className="btn sm"><Icon name="back" size={15} />Billing</Link><button className="btn sm" onClick={() => window.print()}><Icon name="download" size={15} />Print or save as PDF</button></div>
      {error && <p className="error-text">{error}</p>}
      {p && (
        <article className="receipt">
          <header><span className="wordmark">jhino<i /></span><div><b>Receipt</b><span className="mono">{p.receiptNo}</span></div></header>
          <dl className="facts wide">
            <div><dt>Billed to</dt><dd>{user.name}<br /><span className="muted">{user.email}</span></dd></div>
            <div><dt>Status</dt><dd>{p.status === 'approved' ? 'Paid' : STATUS_TEXT[p.status]}</dd></div>
            <div><dt>Payment date</dt><dd>{p.paidOn || fmtDate(p.createdAt)}</dd></div>
            <div><dt>Approved</dt><dd>{fmtDate(p.reviewedAt)}</dd></div>
            <div><dt>Method</dt><dd>{p.method}</dd></div>
            {p.reference && <div><dt>Reference</dt><dd className="mono">{p.reference}</dd></div>}
          </dl>
          <table className="receipt-lines">
            <thead><tr><th>Item</th><th>Amount</th></tr></thead>
            <tbody><tr><td>{p.planName} plan · up to {p.creations} creations</td><td className="mono">{npr(p.amount)}</td></tr></tbody>
            <tfoot><tr><th>Total paid</th><th className="mono">{npr(p.amount)}</th></tr></tfoot>
          </table>
          <p className="muted small">Thank you. Keep this receipt for your records.</p>
        </article>
      )}
    </main>
  );
}

/* ---------------- notifications ---------------- */
const CATS: [string, string, string][] = [
  ['security', 'Account and security alerts', 'New sign-ins, password and email changes.'],
  ['account', 'Account messages', 'Important changes to your account.'],
  ['announcements', 'Important announcements', 'Planned maintenance and changes that affect you.'],
  ['billing', 'Billing and payments', 'Payment received, approved or not verified.'],
  ['bookings', 'Booking reminders', 'Reminders before studio bookings in your apps.'],
  ['product', 'Product updates', 'New features and improvements.'],
  ['marketing', 'Offers and news', 'Occasional offers from Jhino.'],
];
function NotificationsSection({ data, onSaved }: { data: AccountData; onSaved: (p: Prefs) => void }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState<Prefs>(data.prefs);
  const toggle = async (cat: string, kind: 'inapp' | 'email', v: boolean) => {
    const next = { ...prefs, [cat]: { ...prefs[cat], [kind]: v } };
    setPrefs(next);
    try { const r = await api<{ prefs: Prefs }>('PUT', '/api/account/notifications', { prefs: { [cat]: next[cat] } }); setPrefs(r.prefs); onSaved(r.prefs); }
    catch (e) { toast(err(e, 'Could not save.'), true); setPrefs(prefs); }
  };
  return (
    <Section title="Notifications" lede="Security and account messages always arrive. Everything else is your choice.">
      <table className="notif-table">
        <thead><tr><th>Type</th><th>In Jhino</th><th>Email</th></tr></thead>
        <tbody>
          {CATS.map(([k, name, hint]) => {
            const locked = data.essential.includes(k);
            return (
              <tr key={k}>
                <th scope="row"><b>{name}</b><small>{hint}</small></th>
                {(['inapp', 'email'] as const).map((kind) => (
                  <td key={kind}>
                    <label className="toggle">
                      <input type="checkbox" checked={prefs[k]?.[kind] ?? false} disabled={locked} onChange={(e) => toggle(k, kind, e.target.checked)} aria-label={`${name}: ${kind === 'inapp' ? 'in Jhino' : 'by email'}`} />
                      <span aria-hidden="true" />
                    </label>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">Locked rows keep you safe and cannot be turned off. Desktop notifications are turned on per browser from an app's ⋯ menu.</p>
    </Section>
  );
}

/* ---------------- privacy & data ---------------- */
function PrivacySection({ data }: { data: AccountData }) {
  const { go } = useRoute();
  const { refresh } = useSession();
  const [del, setDel] = useState({ open: false, password: '', confirm: '', busy: false, error: '' });
  const remove = async (e: FormEvent) => {
    e.preventDefault();
    setDel({ ...del, busy: true, error: '' });
    try { await post('/api/account/delete', { password: del.password, confirm: del.confirm }); await refresh(); go('/', true); }
    catch (e2) { setDel({ ...del, busy: false, error: err(e2, 'Could not delete the account.') }); }
  };
  return (
    <>
      <Section title="Your data" lede="What we keep about you, and a copy you can take.">
        <dl className="facts wide">
          <div><dt>Profile</dt><dd>Name, email{data.profile.phone ? ', phone' : ''}{data.profile.company ? ', company' : ''} and the details you added</dd></div>
          <div><dt>Apps</dt><dd>{data.usage ? `${data.usage.used} app${data.usage.used === 1 ? '' : 's'} you own, and apps shared with you` : 'Apps shared with you'}</dd></div>
          <div><dt>Security</dt><dd>Sign-in times, devices and approximate addresses</dd></div>
          <div><dt>Payments</dt><dd>Plans, amounts, references and your screenshots</dd></div>
        </dl>
        <a className="btn sm" href="/api/account/export" download><Icon name="download" size={15} />Download my data (JSON)</a>
        <p className="hint">Read how we use it in the <Link to="/privacy" className="link">Privacy Policy</Link>.</p>
      </Section>
      <Section title="Delete account" lede="This cannot be undone.">
        <div className="danger-zone">
          <p>Deleting your account removes your profile, <b>every app you own and everything saved in them</b>, and the sign-ins you made for clients (unless another owner still uses them). Payment records are kept for accounting, without your account.</p>
          {!del.open ? <button className="btn sm danger" onClick={() => setDel({ ...del, open: true })}>Delete my account…</button> : (
            <form className="acc-form tight" onSubmit={remove}>
              {data.user.passwordSet && <label className="field"><span>Your password</span><input className="input" type="password" required autoComplete="current-password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} /></label>}
              {!data.user.passwordSet && <p className="hint">You sign in with Google or Apple: sign in again first if it has been more than 10 minutes.</p>}
              <label className="field"><span>Type DELETE to confirm</span><input className="input mono" required autoComplete="off" value={del.confirm} onChange={(e) => setDel({ ...del, confirm: e.target.value })} /></label>
              {del.error && <p className="error-text" role="alert">{del.error}</p>}
              <div className="actions-row"><button className="btn danger sm" disabled={del.busy || del.confirm !== 'DELETE' || (data.user.passwordSet && !del.password)}>{del.busy && <span className="spin" />}Delete my account for good</button><button type="button" className="btn sm quiet" onClick={() => setDel({ open: false, password: '', confirm: '', busy: false, error: '' })}>Keep my account</button></div>
            </form>
          )}
        </div>
      </Section>
    </>
  );
}

/* ---------------- help ---------------- */
function HelpSection() {
  return (
    <Section title="Help & support">
      <ul className="acc-list links">
        <li><Link to="/help"><b>Help center</b><small>Guides for sharing, plans, bookings and more</small></Link></li>
        <li><Link to="/help#contact-h"><b>Contact support</b><small>Write to us; we answer by email</small></Link></li>
        <li><Link to="/help?kind=problem"><b>Report a problem</b><small>We add the page and browser for you</small></Link></li>
        <li><Link to="/help?kind=feedback"><b>Send feedback</b><small>What would make Jhino better for you</small></Link></li>
        <li><Link to="/terms"><b>Terms of Service</b></Link></li>
        <li><Link to="/privacy"><b>Privacy Policy</b></Link></li>
      </ul>
    </Section>
  );
}
