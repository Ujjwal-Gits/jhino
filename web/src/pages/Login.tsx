import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, get, post } from '../api';
import { Link, useRoute } from '../context';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth">
      <section className="auth-side" aria-hidden="true">
        <Link to="/" className="wordmark" tabIndex={-1}>jhino<i /></Link>
        <p className="big">One live page for you and your client.</p>
        <p className="small">Approvals, bookings, receipts and files, saved once and seen on both sides as they happen.</p>
      </section>
      <section className="auth-form">{children}</section>
    </main>
  );
}

const OAUTH_ERRORS: Record<string, string> = {
  oauth_state: 'That sign-in took too long or was opened in another browser. Try again.',
  oauth_cancelled: 'Sign-in was cancelled.',
  oauth_failed: 'We could not confirm that sign-in. Try again, or use your email and password.',
  oauth_unverified: 'That account has no verified email. Use another sign-in method.',
  oauth_no_email: 'That account did not share an email address with us.',
  oauth_off: 'That sign-in method is not available here.',
  signups_closed: 'New accounts are not open right now.',
  suspended: 'This account is suspended. Contact support if you think this is a mistake.',
};

interface Options { signups: boolean; google: boolean; apple: boolean }
function useAuthOptions() {
  const [o, setO] = useState<Options>({ signups: true, google: false, apple: false });
  useEffect(() => { get<Options>('/api/auth/options').then(setO, () => {}); }, []);
  return o;
}

function Social({ o, verb }: { o: Options; verb: string }) {
  if (!o.google && !o.apple) return null;
  return (
    <div className="social">
      {o.google && <a className="btn lg social-btn" href="/api/auth/oauth/google/start">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z" /><path fill="#34A853" d="M12 23c3 0 5.5-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.2v2.8A11 11 0 0 0 12 23z" /><path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7H2.2a11 11 0 0 0 0 9.9z" /><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.2 7l3.6 2.9C6.7 7.3 9.1 5.4 12 5.4z" /></svg>
        {verb} with Google</a>}
      {o.apple && <a className="btn lg social-btn" href="/api/auth/oauth/apple/start">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7a4.6 4.6 0 0 0-3.6-2c-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9A4.9 4.9 0 0 0 3.7 9.4c-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.6 1.3-.1 1.7-.8 3.3-.8 1.5 0 1.9.8 3.3.8 1.4 0 2.2-1.3 3-2.5a10 10 0 0 0 1.4-2.8 4.3 4.3 0 0 1-2.7-4.3zM14 5.3a4.3 4.3 0 0 0 1-3.2 4.5 4.5 0 0 0-2.9 1.5 4.2 4.2 0 0 0-1 3.1A3.7 3.7 0 0 0 14 5.3z" /></svg>
        {verb} with Apple</a>}
      <p className="or"><span>or</span></p>
    </div>
  );
}

export function Login({ onDone }: { onDone: () => Promise<void> }) {
  const o = useAuthOptions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(() => OAUTH_ERRORS[new URLSearchParams(location.search).get('error') ?? ''] ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await post('/api/auth/login', { email, password });
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <form onSubmit={submit} noValidate>
        <h2>Sign in</h2>
        <Social o={o} verb="Continue" />
        <label className="field">
          <span>Email or sign-in ID</span>
          <input className="input" type="text" autoCapitalize="none" spellCheck={false} autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus aria-invalid={!!error} />
        </label>
        <label className="field">
          <span className="label-row">Password <Link to="/forgot" className="link">Forgot password?</Link></span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-invalid={!!error} />
        </label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn primary lg" disabled={busy || !email || !password}>{busy ? <span className="spin" /> : null}Sign in</button>
        {o.signups
          ? <p className="hint">New to Jhino? <Link to="/signup" className="link">Create an account</Link>. Got a sign-in from a studio? Use it above.</p>
          : <p className="hint">Got a sign-in from a studio or agency? Use it above.</p>}
      </form>
    </AuthLayout>
  );
}

export function Signup({ onDone }: { onDone: () => Promise<void> }) {
  const o = useAuthOptions();
  const { go } = useRoute();
  const [form, setForm] = useState({ name: '', email: '', password: '', terms: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const plan = new URLSearchParams(location.search).get('plan');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await post('/api/auth/signup', form);
      await onDone();
      go(plan === 'plus' || plan === 'pro' ? `/account/plan?choose=${plan}` : '/', true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the account.');
      setBusy(false);
    }
  };
  if (!o.signups) {
    return <AuthLayout><div className="auth-note"><h2>Accounts are by invitation</h2><p className="muted">New accounts are not open right now. If a studio gave you a sign-in, use it to sign in.</p><Link to="/login" className="btn primary lg">Sign in</Link></div></AuthLayout>;
  }
  return (
    <AuthLayout>
      <form onSubmit={submit} noValidate>
        <h2>Create your account</h2>
        <p className="muted">Free Forever: one app, no card needed.{plan === 'plus' || plan === 'pro' ? ' You can pay for your plan right after.' : ''}</p>
        <Social o={o} verb="Sign up" />
        <label className="field"><span>Your name</span><input className="input" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus /></label>
        <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        <label className="field"><span>Password</span><input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={10} /><small className="hint">At least 10 characters.</small></label>
        <label className="check-row"><input type="checkbox" checked={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.checked })} /><span>I agree to the <Link to="/terms" className="link">Terms of Service</Link> and <Link to="/privacy" className="link">Privacy Policy</Link>.</span></label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn primary lg" disabled={busy || !form.name.trim() || !form.email || form.password.length < 10 || !form.terms}>{busy && <span className="spin" />}Create account</button>
        <p className="hint">Already have an account? <Link to="/login" className="link">Sign in</Link></p>
      </form>
    </AuthLayout>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await post('/api/auth/forgot', { email }); setSent(true); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not send the email.'); }
    setBusy(false);
  };
  return (
    <AuthLayout>
      {sent ? (
        <div className="auth-note" role="status">
          <h2>Check your email</h2>
          <p className="muted">If an account uses <b>{email}</b>, we sent it a link to choose a new password. The link works once, for 30 minutes.</p>
          <p className="hint">Signed in with a sign-in ID from a studio (not an email)? Ask them for a new password.</p>
          <Link to="/login" className="btn lg">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <h2>Forgot your password?</h2>
          <p className="muted">Enter the email you signed up with. We will send a link to choose a new one.</p>
          <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn primary lg" disabled={busy || !email}>{busy && <span className="spin" />}Send the link</button>
          <p className="hint"><Link to="/login" className="link">Back to sign in</Link></p>
        </form>
      )}
    </AuthLayout>
  );
}

export function Reset() {
  const token = new URLSearchParams(location.search).get('token') ?? '';
  const [pw, setPw] = useState({ a: '', b: '' });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.a !== pw.b) { setError('The two passwords are not the same.'); return; }
    setBusy(true); setError('');
    try { await post('/api/auth/reset', { token, password: pw.a }); setDone(true); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not change the password.'); }
    setBusy(false);
  };
  return (
    <AuthLayout>
      {done ? (
        <div className="auth-note" role="status"><h2>Password changed</h2><p className="muted">You were signed out on every device. Sign in with your new password.</p><Link to="/login" className="btn primary lg">Sign in</Link></div>
      ) : (
        <form onSubmit={submit} noValidate>
          <h2>Choose a new password</h2>
          <label className="field"><span>New password</span><input className="input" type="password" autoComplete="new-password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} required minLength={10} autoFocus /><small className="hint">At least 10 characters.</small></label>
          <label className="field"><span>The same again</span><input className="input" type="password" autoComplete="new-password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} required /></label>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn primary lg" disabled={busy || pw.a.length < 10 || !pw.b || !token}>{busy && <span className="spin" />}Change password</button>
          {!token && <p className="error-text">This link is missing its code. Open the link from the email again.</p>}
        </form>
      )}
    </AuthLayout>
  );
}

export function Verify({ signedIn, onDone }: { signedIn: boolean; onDone: () => Promise<void> }) {
  const token = new URLSearchParams(location.search).get('token') ?? '';
  const [state, setState] = useState<{ ok?: boolean; kind?: string; email?: string; error?: string }>({});
  useEffect(() => {
    post<{ kind: string; email?: string }>('/api/auth/verify', { token })
      .then((r) => { setState({ ok: true, kind: r.kind, email: r.email }); onDone().catch(() => {}); }, (e) => setState({ error: e instanceof ApiError ? e.message : 'Could not confirm.' }));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AuthLayout>
      <div className="auth-note" role="status">
        {!state.ok && !state.error && <><h2>Confirming…</h2><span className="spin" /></>}
        {state.ok && <><h2>{state.kind === 'email_change' ? 'Your email is changed' : 'Email confirmed'}</h2>
          <p className="muted">{state.kind === 'email_change' ? `Your account now uses ${state.email}.` : 'Thank you. Your email is confirmed.'}</p>
          <Link to={signedIn ? '/account' : '/login'} className="btn primary lg">{signedIn ? 'Go to your account' : 'Sign in'}</Link></>}
        {state.error && <><h2>This link did not work</h2><p className="muted">{state.error}</p><Link to={signedIn ? '/account' : '/login'} className="btn lg">{signedIn ? 'Send a new link from Account' : 'Sign in'}</Link></>}
      </div>
    </AuthLayout>
  );
}
