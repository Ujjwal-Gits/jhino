import { StrictMode, useCallback, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './site.css';
import { get, setCsrf, type User } from './api';
import { live } from './live';
import { ToastProvider } from './ui';
import { Forgot, Login, Reset, Signup, Verify } from './pages/Login';
import { HelpPage, Landing, PrivacyPage, TermsPage } from './pages/Public';
import { AccountPage, ReceiptPage } from './pages/Account';
import { AdminPage } from './pages/Admin';
import { PublicApp } from './pages/PublicApp';
import { Invite } from './pages/Invite';
import { AppsPage } from './pages/Apps';
import { Player } from './pages/Player';
import { Shell } from './pages/Shell';
import { Builder } from './pages/Builder';
import { RouteCtx, SessionCtx, applyTheme, readTheme } from './context';

applyTheme(readTheme());

const KNOWN = new Set(['login', 'signup', 'forgot', 'reset', 'verify', 'help', 'terms', 'privacy', 'build', 'shared', 'trash', 'people', 'account', 'admin', 'apps', 'invite', 's', 'api', 'run', 'pricing']);

function App() {
  const [path, setPath] = useState(location.pathname);
  const [user, setUser] = useState<User | null | undefined>(undefined);

  const go = useCallback((to: string, replace = false) => {
    if (to === location.pathname + location.search) return;
    history[replace ? 'replaceState' : 'pushState'](null, '', to);
    setPath(location.pathname);
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await get<{ user: User | null; csrf?: string }>('/api/me');
      setCsrf(r.csrf ?? '');
      setUser(r.user);
    } catch {
      setUser((u) => (u === undefined ? null : u));
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (user) live.start(); else live.stop();
  }, [user]);

  // Signed in: the sign-in pages lead home.
  useEffect(() => {
    if (user && ['/login', '/signup', '/forgot'].includes(path)) go('/', true);
    if (user && path === '/people') go('/admin/users', true);
  }, [user, path, go]);

  // Signed out elsewhere or session ended: the live stream drops; re-check.
  useEffect(() => live.on((e) => { if (e === 'offline') setTimeout(refresh, 1500); }), [refresh]);

  let page: ReactNode;
  const invite = path.match(/^\/invite\/([\w-]+)$/);
  const appMatch = path.match(/^\/apps\/([\w-]+)$/);
  const blocksMatch = path.match(/^\/apps\/([\w-]+)\/blocks$/);
  const viewMatch = path.match(/^\/apps\/([\w-]+)\/view$/);
  const shareMatch = path.match(/^\/s\/([\w-]{2,64})$/);
  const accountMatch = path.match(/^\/account(?:\/([\w-]+))?\/?$/);
  const receiptMatch = path.match(/^\/account\/receipt\/([\w-]+)$/);
  const adminMatch = path.match(/^\/admin(?:\/([\w-]+))?(?:\/([\w-]+))?\/?$/);
  // A single path segment that is not a page of Jhino is a hosted address (jhino.com/your-studio).
  const seg = path.split('/').filter(Boolean);
  const slug = seg.length === 1 && !KNOWN.has(seg[0]) && /^[a-z0-9][a-z0-9-]{1,49}$/i.test(seg[0]) ? seg[0] : null;
  const shell = (n: ReactNode) => (user ? <Shell>{n}</Shell> : n);
  if (user === undefined) page = null;
  else if (invite) page = <Invite token={invite[1]} user={user} onJoined={refresh} />;
  else if (path === '/verify') page = <Verify signedIn={!!user} onDone={refresh} />;
  else if (path === '/reset') page = <Reset />;
  else if (path === '/help') page = shell(<HelpPage signedIn={!!user} />);
  else if (path === '/terms') page = shell(<TermsPage signedIn={!!user} />);
  else if (path === '/privacy') page = shell(<PrivacyPage signedIn={!!user} />);
  else if (shareMatch || slug) page = <PublicApp refId={shareMatch ? shareMatch[1] : slug!} signedInUser={user} />;
  else if (!user) {
    if (path === '/') page = <Landing />;
    else if (path === '/signup') page = <Signup onDone={refresh} />;
    else if (path === '/forgot') page = <Forgot />;
    else page = <Login onDone={refresh} />; // also for deep links: after signing in, the same page opens
  }
  else if (['/login', '/signup', '/forgot', '/people'].includes(path)) page = null;
  else if (receiptMatch) page = <Shell><ReceiptPage id={receiptMatch[1]} /></Shell>;
  else if (accountMatch) page = <Shell><AccountPage section={accountMatch[1] ?? 'profile'} /></Shell>;
  else if (adminMatch && user.isAdmin) page = <Shell><AdminPage section={adminMatch[1] ?? 'overview'} sub={adminMatch[2]} /></Shell>;
  else if (path === '/build') page = <Builder />;
  else if (blocksMatch) page = <Builder appId={blocksMatch[1]} />;
  else if (viewMatch) page = <Player id={viewMatch[1]} solo />;
  else if (appMatch) page = <Player id={appMatch[1]} />;
  else if (path === '/shared') page = <Shell><AppsPage view="shared" /></Shell>;
  else if (path === '/trash') page = <Shell><AppsPage view="trash" /></Shell>;
  else page = <Shell><AppsPage view={user.canCreate ? 'mine' : 'shared'} /></Shell>;

  return (
    <RouteCtx.Provider value={{ path, go }}>
      <ToastProvider>
        {user ? <SessionCtx.Provider value={{ user, refresh }}>{page}</SessionCtx.Provider> : page}
      </ToastProvider>
    </RouteCtx.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
