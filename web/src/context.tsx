import { createContext, useContext, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import type { User } from './api';

/* ---------- tiny router ---------- */
export const RouteCtx = createContext<{ path: string; go: (to: string, replace?: boolean) => void }>({ path: '/', go: () => {} });
export const useRoute = () => useContext(RouteCtx);
export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const { go } = useRoute();
  return (
    <a {...rest} href={to} onClick={(e: MouseEvent<HTMLAnchorElement>) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault(); go(to);
    }}>{children}</a>
  );
}

/* ---------- session ---------- */
export const SessionCtx = createContext<{ user: User; refresh: () => Promise<void> }>(null!);
export const useSession = () => useContext(SessionCtx);

/* ---------- theme (per device) ---------- */
export type Theme = 'light' | 'dark' | 'system';
export function readTheme(): Theme {
  try { return (localStorage.getItem('jhino-theme') as Theme) || 'light'; } catch { return 'light'; }
}
export function applyTheme(t: Theme) {
  try { localStorage.setItem('jhino-theme', t); } catch { /* private mode */ }
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#121211' : '#ffffff');
}
