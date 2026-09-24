import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, post } from '../api';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth">
      <section className="auth-side" aria-hidden="true">
        <span className="wordmark">jhino<i /></span>
        <p className="big">Small apps. Real work.</p>
        <p className="small">Upload an HTML app, open it anywhere, and work on the same data with the people you invite. Everything stays on this server.</p>
      </section>
      <section className="auth-form">{children}</section>
    </main>
  );
}

export function Login({ onDone }: { onDone: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
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
        <label className="field">
          <span>Email or sign-in ID</span>
          <input className="input" type="text" autoCapitalize="none" spellCheck={false} autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus aria-invalid={!!error} />
        </label>
        <label className="field">
          <span>Password</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-invalid={!!error} />
        </label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn primary lg" disabled={busy || !email || !password}>{busy ? <span className="spin" /> : null}Sign in</button>
        <p className="hint">No account? Ask the person who shared an app with you for your sign-in ID and password.</p>
      </form>
    </AuthLayout>
  );
}
