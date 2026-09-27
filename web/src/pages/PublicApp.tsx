import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, get, post, type User } from '../api';
import { SessionCtx } from '../context';
import { live } from '../live';
import { Player } from './Player';
import { Link } from '../context';
import { Login } from './Login';

/*
 * A shared app opened by link: /s/<token>, an address like /your-studio/client-room, a top-level one, or a
 * copied /apps/<id>. Signed in, you come in as yourself (after the password, if it has one). Otherwise you
 * give your name once: in this app you are a guest with that name, and everything you add shows it.
 * The page never redirects, so jhino.com/your-studio stays jhino.com/your-studio.
 */

interface PublicInfo {
  ready?: boolean; needsPassword?: boolean; needsName?: boolean; member?: boolean; appId?: string; guest?: string;
  joinAs?: { name: string; username: string | null }; app?: { id: string; name: string; showBar?: boolean };
}

/** A share token, a top-level address, or <username>/<name>. */
const refPath = (ref: string) => ref.split('/').map(encodeURIComponent).join('/');

const VISITOR: User = { id: 'visitor', email: '', name: 'Visitor', displayName: null, isAdmin: false, disabled: false, canCreate: false, emailIsAddress: false, emailVerified: null, hasAvatar: false, passwordSet: false, plan: 'free' };

export function PublicApp({ refId, signedInUser }: { refId: string; signedInUser: User | null }) {
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [error, setError] = useState<{ title: string; text: string; signIn?: boolean } | null>(null);
  const [pw, setPw] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [pwError, setPwError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    setInfo(null); setError(null);
    get<PublicInfo>(`/api/public/${refPath(refId)}`).then((r) => {
      setInfo(r);
    }, (e) => {
      const a = e as ApiError;
      setError(a.code === 'NOT_PUBLIC'
        ? { title: 'This app is private', text: 'Only people its owner added can open it. If that is you, sign in first.', signIn: true }
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
    try { setInfo(await post<PublicInfo>(`/api/public/${refPath(refId)}/unlock`, { password: pw || undefined, name: name.trim() || undefined })); }
    catch (err) { setPwError(err instanceof ApiError ? err.message : 'Could not open it.'); }
    setBusy(false);
  };

  // A private app, signed out: sign in right here, so the app opens at this same address (and an installed app stays in its window).
  if (error?.signIn && !signedInUser) return <Login onDone={async () => { location.reload(); }} />;
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
  if (info.member && info.appId && signedInUser) return <Player id={info.appId} noFallback />;
  // A Jhino account instead of a guest name: sign in here, and the app opens as you at this same address.
  if (signingIn && !signedInUser) return <Login onDone={async () => { location.reload(); }} />;
  if (info.needsPassword || info.needsName) {
    const askName = !!info.needsName && !signedInUser;
    return (
      <main className="pw-gate">
        <form onSubmit={unlock} className="pw-card">
          <span className="wordmark">jhino<i /></span>
          <h1>{info.app?.name}</h1>
          {info.joinAs
            ? <p className="muted">You open it as <b>{info.joinAs.name}</b>{info.joinAs.username ? <> (@{info.joinAs.username})</> : null}. {info.needsPassword ? 'Enter the password you were given.' : ''}</p>
            : <p className="muted">{info.needsPassword ? 'This app is protected. ' : ''}Tell the others who you are. Your name shows next to everything you add, in this app only.</p>}
          {askName && (
            <label className="field"><span>Your full name</span>
              <input className="input" autoFocus required minLength={2} maxLength={60} autoComplete="name" placeholder="Sita Sharma" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          {info.needsPassword && (
            <label className="field"><span>Password</span><input className="input" type="password" autoFocus={!askName} required autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={!!pwError} /></label>
          )}
          {pwError && <p className="error-text" role="alert">{pwError}</p>}
          <button className="btn primary lg" disabled={busy || (info.needsPassword && !pw) || (askName && name.trim().length < 2)}>{busy && <span className="spin" />}Open</button>
          {askName && <p className="hint pw-alt">Have a Jhino account? <button type="button" className="link" onClick={() => setSigningIn(true)}>Sign in</button> to open it as yourself.</p>}
        </form>
      </main>
    );
  }
  if (!info.ready || !info.app) return null;
  return (
    <SessionCtx.Provider value={{ user: signedInUser ?? (info.guest ? { ...VISITOR, name: info.guest } : VISITOR), refresh: async () => {} }}>

      <Player id={info.app.id} visitor={{ name: info.app.name, showBar: info.app.showBar !== false }} />
    </SessionCtx.Provider>
  );
}
