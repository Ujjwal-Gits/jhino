import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, get, post, type User } from '../api';
import { useRoute } from '../context';
import { AuthLayout } from './Login';

interface Info { appName: string; inviter: string; role: 'editor' | 'viewer'; expiresAt: string }

export function Invite({ token, user, onJoined }: { token: string; user: User | null; onJoined: () => Promise<void> }) {
  const { go } = useRoute();
  const [info, setInfo] = useState<Info | null>(null);
  const [problem, setProblem] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signIn, setSignIn] = useState(false);

  useEffect(() => {
    get<Info>(`/api/invites/${token}`).then(setInfo, (e) => setProblem(e instanceof ApiError ? e.message : 'This invite link is not valid.'));
  }, [token]);

  const accept = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await post<{ appId: string }>(`/api/invites/${token}/accept`, user ? {} : form);
      await onJoined();
      go(`/apps/${r.appId}`, true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not join.');
      setBusy(false);
    }
  };

  const loginThenAccept = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await post('/api/auth/login', { email: form.email, password: form.password });
      await onJoined();
      setBusy(false);
      setSignIn(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
      setBusy(false);
    }
  };

  const access = info?.role === 'editor' ? 'view and change its data' : 'view it';

  return (
    <AuthLayout>
      {problem ? (
        <div style={{ width: 'min(360px,100%)', display: 'grid', gap: 12 }}>
          <h2>Invite not available</h2>
          <p className="muted">{problem}</p>
          <button className="btn" onClick={() => go('/', true)}>Go to Jhino</button>
        </div>
      ) : !info ? null : user ? (
        <div style={{ width: 'min(360px,100%)', display: 'grid', gap: 16 }}>
          <h2>Join {info.appName}</h2>
          <p className="muted">{info.inviter} invited you to {access}. You are signed in as {user.name}.</p>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn primary lg" onClick={() => accept()} disabled={busy}>{busy && <span className="spin" />}Join app</button>
        </div>
      ) : signIn ? (
        <form onSubmit={loginThenAccept} noValidate>
          <h2>Sign in to join</h2>
          <p className="muted">Then you can join {info.appName}.</p>
          <label className="field"><span>Email</span><input className="input" type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoFocus /></label>
          <label className="field"><span>Password</span><input className="input" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn primary lg" disabled={busy}>{busy && <span className="spin" />}Sign in</button>
          <button type="button" className="btn quiet" onClick={() => { setSignIn(false); setError(''); }}>I need an account</button>
        </form>
      ) : (
        <form onSubmit={accept} noValidate>
          <h2>Join {info.appName}</h2>
          <p className="muted">{info.inviter} invited you to {access}. Create your account to continue.</p>
          <label className="field"><span>Your name</span><input className="input" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></label>
          <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="field"><span>Password</span><input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /><small className="hint">At least 10 characters.</small></label>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn primary lg" disabled={busy || !form.name || !form.email || form.password.length < 10}>{busy && <span className="spin" />}Create account and join</button>
          <button type="button" className="btn quiet" onClick={() => { setSignIn(true); setError(''); }}>I already have an account</button>
          <p className="hint">This link works once. Anyone who has it can use it, so keep it private.</p>
        </form>
      )}
    </AuthLayout>
  );
}
