import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, get, post } from '../api';
import { Link, useRoute } from '../context';
import { UsernameField, suggestFrom, useUsernameCheck } from './Username';
import { CodeBoxes, CodeStep, type CodeInfo } from './CodeEntry';

type SignInResult = { ok?: boolean; verify?: boolean; email?: string; twofa?: boolean; ticket?: string } & CodeInfo;

/** The second step: a code from the authenticator app, or one of the recovery codes. */
function TwoFactorStep({ ticket, onDone, onBack }: { ticket: string; onDone: () => Promise<void>; onBack: () => void }) {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e?: FormEvent, v = code) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { await post('/api/auth/2fa', { ticket, code: v }); await onDone(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not check the code.'); setCode(''); setBusy(false); }
  };
  return (
    <form className="code-step" onSubmit={submit} noValidate>
      <h2>Two-step sign-in</h2>
      {recovery ? (
        <>
          <p className="muted">Enter one of the recovery codes you saved when you turned this on. Each works once.</p>
          <label className="field"><span>Recovery code</span><input className="input mono" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" autoFocus placeholder="xxxxx-xxxxx" /></label>
        </>
      ) : (
        <>
          <p className="muted">Open your authenticator app and enter the 6-digit code for Jhino.</p>
          <CodeBoxes value={code} onChange={(v) => { setCode(v); setError(''); }} onComplete={(v) => submit(undefined, v)} disabled={busy} invalid={!!error} label="Code from your authenticator app" />
        </>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn primary lg" disabled={busy || (recovery ? code.trim().length < 8 : code.length !== 6)}>{busy && <span className="spin" />}Sign in</button>
      <p className="hint"><button type="button" className="link" onClick={() => { setRecovery(!recovery); setCode(''); setError(''); }}>{recovery ? 'Use the app instead' : 'No phone? Use a recovery code'}</button> · <button type="button" className="link" onClick={onBack}>Start over</button></p>
    </form>
  );
}

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
  const [code, setCode] = useState<{ email: string; info: CodeInfo } | null>(null);
  const [ticket, setTicket] = useState<string | null>(() => new URLSearchParams(location.search).get('twofa'));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await post<SignInResult>('/api/auth/login', { email, password });
      if (r.verify) { setCode({ email: r.email ?? email, info: r }); setBusy(false); return; }
      if (r.twofa && r.ticket) { setTicket(r.ticket); setBusy(false); return; }
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
      setBusy(false);
    }
  };

  if (ticket) {
    return <AuthLayout><TwoFactorStep ticket={ticket} onDone={onDone} onBack={() => { setTicket(null); history.replaceState(null, '', '/login'); }} /></AuthLayout>;
  }
  if (code) {
    return (
      <AuthLayout>
        <CodeStep title="Confirm your email" email={code.email} info={code.info} submitLabel="Confirm and sign in"
          onSubmit={async (c) => { await post('/api/auth/verify-login', { email: code.email, code: c }); await onDone(); }}
          onResend={() => post<SignInResult>('/api/auth/login', { email, password })}
          extra={<p className="hint">Your account opens once this email is confirmed. <button type="button" className="link" onClick={() => setCode(null)}>Use another account</button></p>} />
      </AuthLayout>
    );
  }

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
  const [form, setForm] = useState({ name: '', email: '', username: '', password: '', terms: false });
  const [touched, setTouched] = useState(false);
  const check = useUsernameCheck(form.username);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<CodeInfo | null>(null);
  const plan = new URLSearchParams(location.search).get('plan');
  const next = () => (plan === 'plus' || plan === 'pro' ? `/account/plan?choose=${plan}&period=${new URLSearchParams(location.search).get('period') === 'year' ? 'year' : 'month'}` : `/${form.username}`);
  // Suggest a username from the email until they type their own.
  const setEmail = (email: string) => setForm((f) => ({ ...f, email, username: touched ? f.username : suggestFrom(email) }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await post<SignInResult>('/api/auth/signup', form);
      if (r.verify) { setCode(r); setBusy(false); return; }
      await onDone();
      go(next(), true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the account.');
      setBusy(false);
    }
  };
  if (code) {
    return (
      <AuthLayout>
        <CodeStep title="Confirm your email" email={form.email} info={code} submitLabel="Confirm and open Jhino"
          onSubmit={async (c) => { await post('/api/auth/verify-login', { email: form.email, code: c }); await onDone(); go(next(), true); }}
          onResend={() => post<SignInResult>('/api/auth/login', { email: form.email, password: form.password })}
          extra={<p className="hint">Wrong address? <button type="button" className="link" onClick={() => setCode(null)}>Go back and change it</button></p>} />
      </AuthLayout>
    );
  }
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
        <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <UsernameField value={form.username} onChange={(v) => { setTouched(true); setForm({ ...form, username: v }); }} check={check} />
        <label className="field"><span>Password</span><input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={10} /><small className="hint">At least 10 characters.</small></label>
        <label className="check-row"><input type="checkbox" checked={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.checked })} /><span>I agree to the <Link to="/terms" className="link">Terms of Service</Link> and <Link to="/privacy" className="link">Privacy Policy</Link>.</span></label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn primary lg" disabled={busy || !form.name.trim() || !form.email || form.password.length < 10 || !form.terms || check.state !== 'ok'}>{busy && <span className="spin" />}Create account</button>
        <p className="hint">Already have an account? <Link to="/login" className="link">Sign in</Link></p>
      </form>
    </AuthLayout>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [f, setF] = useState({ code: '', a: '', b: '' });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setError('');
    try { await post('/api/auth/forgot', { email }); setSent(true); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not send the email.'); }
    setBusy(false);
  };
  const reset = async (e: FormEvent) => {
    e.preventDefault();
    if (f.a !== f.b) { setError('The two passwords are not the same.'); return; }
    setBusy(true); setError('');
    try { await post('/api/auth/reset-code', { email, code: f.code, password: f.a }); setDone(true); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not change the password.'); }
    setBusy(false);
  };
  if (done) {
    return <AuthLayout><div className="auth-note" role="status"><h2>Password changed</h2><p className="muted">You were signed out on every device. Sign in with your new password.</p><Link to="/login" className="btn primary lg">Sign in</Link></div></AuthLayout>;
  }
  return (
    <AuthLayout>
      {sent ? (
        <form onSubmit={reset} noValidate>
          <h2>Enter the code</h2>
          <p className="muted">If an account uses <b>{email}</b>, we sent it a 6-digit code. It works once, for 5 minutes; asked again within that time, you get the same code.</p>
          <CodeBoxes value={f.code} onChange={(v) => setF({ ...f, code: v })} label="Code from the email" />
          <label className="field"><span>New password</span><input className="input" type="password" autoComplete="new-password" value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })} required minLength={10} /><small className="hint">At least 10 characters.</small></label>
          <label className="field"><span>The same again</span><input className="input" type="password" autoComplete="new-password" value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })} required /></label>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn primary lg" disabled={busy || f.code.length !== 6 || f.a.length < 10 || !f.b}>{busy && <span className="spin" />}Change password</button>
          <p className="hint">No email? Check spam, or <button type="button" className="link" onClick={() => send()} disabled={busy}>send it again</button>. Signed in with a sign-in ID from a studio (not an email)? Ask them for a new password.</p>
        </form>
      ) : (
        <form onSubmit={send} noValidate>
          <h2>Forgot your password?</h2>
          <p className="muted">Enter your email. We send you a 6-digit code to choose a new password.</p>
          <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn primary lg" disabled={busy || !email}>{busy && <span className="spin" />}Send the code</button>
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
    if (!token) return;
    post<{ kind: string; email?: string }>('/api/auth/verify', { token })
      .then((r) => { setState({ ok: true, kind: r.kind, email: r.email }); onDone().catch(() => {}); }, (e) => setState({ error: e instanceof ApiError ? e.message : 'Could not confirm.' }));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!token && !state.ok) {
    return (
      <AuthLayout>
        {signedIn ? (
          <CodeStep title="Confirm your email" email="your email" info={{}}
            onSubmit={async (c) => { const r = await post<{ kind: string; email?: string }>('/api/auth/verify-code', { code: c }); setState({ ok: true, kind: r.kind, email: r.email }); onDone().catch(() => {}); }}
            onResend={() => post<CodeInfo>('/api/account/verify/resend')} />
        ) : (
          <div className="auth-note"><h2>Sign in to confirm</h2><p className="muted">Sign in, then enter the code from the email. Or open the link in the email.</p><Link to="/login" className="btn primary lg">Sign in</Link></div>
        )}
      </AuthLayout>
    );
  }
  return (
    <AuthLayout>
      <div className="auth-note" role="status">
        {!state.ok && !state.error && <><h2>Confirming…</h2><span className="spin" /></>}
        {state.ok && <><h2>{state.kind === 'email_change' ? 'Your email is changed' : 'Email confirmed'}</h2>
          <p className="muted">{state.kind === 'email_change' ? `Your account now uses ${state.email}.` : 'Thank you. Your email is confirmed.'}</p>
          <Link to={signedIn ? '/account' : '/login'} className="btn primary lg">{signedIn ? 'Go to your account' : 'Sign in'}</Link></>}
        {state.error && <><h2>This link did not work</h2><p className="muted">{state.error}</p><Link to={signedIn ? '/verify' : '/login'} className="btn lg">{signedIn ? 'Enter a code instead' : 'Sign in'}</Link></>}
      </div>
    </AuthLayout>
  );
}
