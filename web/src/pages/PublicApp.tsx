import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, get, post, type User } from '../api';
import { SessionCtx } from '../context';
import { live } from '../live';
import { Player } from './Player';
import { Link } from '../context';

/*
 * A shared app opened by link: /s/<token>, an address like /your-studio/client-room, or a top-level one.
 * Public links open straight away; password links ask once. Signed-in members get the full app, at the
 * same address: the page never redirects, so jhino.com/your-studio stays jhino.com/your-studio.
 */

interface PublicInfo { ready?: boolean; needsPassword?: boolean; member?: boolean; appId?: string; app?: { id: string; name: string; showBar?: boolean } }

/** A share token, a top-level address, or <username>/<name>. */
const refPath = (ref: string) => ref.split('/').map(encodeURIComponent).join('/');

const VISITOR: User = { id: 'visitor', email: '', name: 'Visitor', displayName: null, isAdmin: false, disabled: false, canCreate: false, emailIsAddress: false, emailVerified: null, hasAvatar: false, passwordSet: false, plan: 'free' };

export function PublicApp({ refId, signedInUser }: { refId: string; signedInUser: User | null }) {
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [pwError, setPwError] = useState('');

  useEffect(() => {
    setInfo(null); setError(null);
    get<PublicInfo>(`/api/public/${refPath(refId)}`).then((r) => {
      setInfo(r);
    }, (e) => {
      const a = e as ApiError;
      setError(a.code === 'NOT_PUBLIC'
        ? { title: 'This app is private', text: 'Only people its owner added can open it. If that is you, sign in first.' }
        : a.status === 404 ? { title: 'Nothing here', text: 'This link does not exist, or the app was removed.' }
          : { title: 'Could not open this', text: a.message || 'Try again in a moment.' });
    });
  }, [refId, signedInUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A visitor's live updates are for this one app. Signed-in people keep their own connection (changing it
  // here would drop it, and the dashboard reacts to a drop by checking the session again: a reload loop).
  const signedIn = !!signedInUser;
  useEffect(() => {
    if (!info?.ready || !info.app || signedIn) return;
    live.setScope(info.app.id);
    live.start();
    return () => { live.setScope(null); live.stop(); };
  }, [info, signedIn]);

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setPwError('');
    try { setInfo(await post<PublicInfo>(`/api/public/${refPath(refId)}/unlock`, { password: pw })); }
    catch (err) { setPwError(err instanceof ApiError ? err.message : 'Could not open it.'); }
    setBusy(false);
  };

  if (error) {
    return (
      <main className="state-card">
        <h2>{error.title}</h2>
        <p>{error.text}</p>
        {signedInUser ? <Link to="/apps" className="btn">Back to your apps</Link> : <Link to="/login" className="btn">Sign in</Link>}
      </main>
    );
  }
  if (!info) return <main className="state-card" aria-busy="true"><span className="spin" /></main>;
  if (info.member && info.appId && signedInUser) return <Player id={info.appId} />;
  if (info.needsPassword) {
    return (
      <main className="pw-gate">
        <form onSubmit={unlock} className="pw-card">
          <span className="wordmark">jhino<i /></span>
          <h1>{info.app?.name}</h1>
          <p className="muted">This app is protected. Enter the password you were given.</p>
          <label className="field"><span>Password</span><input className="input" type="password" autoFocus required autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={!!pwError} /></label>
          {pwError && <p className="error-text" role="alert">{pwError}</p>}
          <button className="btn primary lg" disabled={busy || !pw}>{busy && <span className="spin" />}Open</button>
        </form>
      </main>
    );
  }
  if (!info.ready || !info.app) return null;
  return (
    <SessionCtx.Provider value={{ user: signedInUser ?? VISITOR, refresh: async () => {} }}>
      <Player id={info.app.id} visitor={{ name: info.app.name, showBar: info.app.showBar !== false }} />
    </SessionCtx.Provider>
  );
}
