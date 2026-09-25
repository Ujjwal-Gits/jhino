import { StrictMode, Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './site.css';
import './dash.css';
import { get, post, setCsrf, type User } from './api';

/** Where the visitor came from: sent with the first page only. */
let firstRef = document.referrer;
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
import { LinksPage } from './pages/Links';
import { PersonPage } from './pages/PersonPage';
import { RouteCtx, SessionCtx, applyTheme, readTheme, useRoute } from './context';

applyTheme(readTheme());

const KNOWN = new Set(['_themes', 'go', 'p', 'links', 'login', 'signup', 'forgot', 'reset', 'verify', 'help', 'terms', 'privacy', 'build', 'shared', 'trash', 'people', 'account', 'admin', 'apps', 'invite', 's', 'api', 'run', 'pricing']);

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
    // Home is their own page (jhino.com/<username>); client accounts go to the apps shared with them.
    if (user && ['/login', '/signup', '/forgot'].includes(path)) go(user.username ? `/${user.username}` : '/apps', true);
    if (user && path === '/people') go('/admin/users', true);
  }, [user, path, go]);

  // Site analytics (Super Admin): one count per page, then a quiet "still here" each minute while visible.
  useEffect(() => {
    if (user === undefined || path.startsWith('/admin')) return;
    const r = firstRef; firstRef = '';
    post('/api/t', { p: path, r }).catch(() => {});
    const beat = setInterval(() => { if (document.visibilityState === 'visible') post('/api/t', { p: location.pathname, h: true }).catch(() => {}); }, 60_000);
    return () => clearInterval(beat);
  }, [path, user === undefined]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // One segment that is not a page of Jhino: someone's page (jhino.com/<username>), or a top-level address.
  // Two: an app address under a username (jhino.com/<username>/<name>).
  const seg = path.split('/').filter(Boolean);
  const person = seg.length === 1 && !KNOWN.has(seg[0]) && /^[a-z0-9][a-z0-9_-]{0,49}$/i.test(seg[0]) ? seg[0] : null;
  const under = seg.length === 2 && !KNOWN.has(seg[0]) && /^[a-z0-9][a-z0-9_-]{1,49}$/i.test(seg[0]) && /^[a-z0-9][a-z0-9-]{1,49}$/i.test(seg[1]) ? `${seg[0]}/${seg[1]}` : null;
  const shell = (n: ReactNode) => (user ? <Shell>{n}</Shell> : n);
  if (user === undefined) page = null;
  else if (invite) page = <Invite token={invite[1]} user={user} onJoined={refresh} />;
  else if (path === '/verify') page = <Verify signedIn={!!user} onDone={refresh} />;
  else if (path === '/reset') page = <Reset />;
  else if (path === '/help') page = shell(<HelpPage signedIn={!!user} />);
  else if (path === '/terms') page = shell(<TermsPage signedIn={!!user} />);
  else if (path === '/privacy') page = shell(<PrivacyPage signedIn={!!user} />);
  else if (shareMatch || under) page = <PublicApp refId={shareMatch ? shareMatch[1] : under!} signedInUser={user} />;
  else if (person) page = <PersonPage name={person} user={user} />;
  else if (path === '/_themes' && user?.isAdmin) page = <ThemeGallery />;
  // The website is always at the main address; the dashboard lives at /apps.
  else if (path === '/' || path === '/pricing') page = <Landing signedIn={!!user} at={path === '/pricing' ? 'pricing' : undefined} />;
  else if (!user) {
    if (path === '/signup') page = <Signup onDone={refresh} />;
    else if (path === '/forgot') page = <Forgot />;
    else page = <Login onDone={refresh} />; // also for deep links: after signing in, the same page opens
  }
  else if (['/login', '/signup', '/forgot', '/people'].includes(path)) page = null;
  else if (receiptMatch) page = <Shell><ReceiptPage id={receiptMatch[1]} /></Shell>;
  else if (accountMatch) page = <Shell><AccountPage section={accountMatch[1] ?? 'profile'} /></Shell>;
  else if (adminMatch && user.isAdmin) page = <AdminPage section={adminMatch[1] ?? 'overview'} sub={adminMatch[2]} />;
  else if (path === '/links' && user.canCreate) page = <Shell><LinksPage /></Shell>;
  else if (path === '/build') page = <Builder />;
  else if (blocksMatch) page = <Builder appId={blocksMatch[1]} />;
  else if (viewMatch) page = <Player id={viewMatch[1]} solo />;
  else if (appMatch) page = <Player id={appMatch[1]} />;
  else if (path === '/shared') page = <Shell><AppsPage view="shared" /></Shell>;
  else if (path === '/trash') page = <Shell><AppsPage view="trash" /></Shell>;
  else if (path === '/apps') page = <Shell><AppsPage view={user.canCreate ? 'mine' : 'shared'} /></Shell>;
  else page = <GoTo to="/apps" />; // anything else signed in leads to the dashboard

  return (
    <RouteCtx.Provider value={{ path, go }}>
      <ToastProvider>
        <Suspense fallback={null}>{user ? <SessionCtx.Provider value={{ user, refresh }}>{page}</SessionCtx.Provider> : page}</Suspense>
      </ToastProvider>
    </RouteCtx.Provider>
  );
}

function GoTo({ to }: { to: string }) {
  const { go } = useRoute();
  useEffect(() => { go(to, true); }, [go, to]);
  return null;
}

const ThemeGallery = lazy(() => import('./profile/Gallery').then((m) => ({ default: m.ProfileGallery })));

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
