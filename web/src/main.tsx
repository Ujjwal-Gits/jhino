import { StrictMode, useCallback, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { get, setCsrf, type User } from './api';
import { live } from './live';
import { ToastProvider } from './ui';
import { Login } from './pages/Login';
import { Invite } from './pages/Invite';
import { AppsPage } from './pages/Apps';
import { Player } from './pages/Player';
import { People } from './pages/People';
import { Shell } from './pages/Shell';
import { Builder } from './pages/Builder';
import { RouteCtx, SessionCtx, applyTheme, readTheme } from './context';

applyTheme(readTheme());

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

  // Signed out elsewhere or session ended: the live stream drops; re-check.
  useEffect(() => live.on((e) => { if (e === 'offline') setTimeout(refresh, 1500); }), [refresh]);

  let page: ReactNode;
  const invite = path.match(/^\/invite\/([\w-]+)$/);
  const appMatch = path.match(/^\/apps\/([\w-]+)$/);
  const blocksMatch = path.match(/^\/apps\/([\w-]+)\/blocks$/);
  const viewMatch = path.match(/^\/apps\/([\w-]+)\/view$/);
  if (user === undefined) page = null;
  else if (invite) page = <Invite token={invite[1]} user={user} onJoined={refresh} />;
  else if (!user) page = <Login onDone={refresh} />;
  else if (path === '/build') page = <Builder />;
  else if (blocksMatch) page = <Builder appId={blocksMatch[1]} />;
  else if (viewMatch) page = <Player id={viewMatch[1]} solo />;
  else if (appMatch) page = <Player id={appMatch[1]} />;
  else if (path === '/people' && user.isAdmin) page = <Shell><People /></Shell>;
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
