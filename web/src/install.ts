/*
 * Installing an app on this device: the browser's own install prompt when it offers one (Chrome, Edge,
 * Samsung Internet, Android), clear steps where it does not (iPhone and iPad, in-app browsers), and a
 * shortcut file to download as the last resort on computers. Loaded first thing, so the browser's
 * "beforeinstallprompt" is never missed.
 */

interface PromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: PromptEvent | null = null;
let installed = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

addEventListener('beforeinstallprompt', (e) => {
  // Keep it for our own Install button (the page decides when to ask).
  e.preventDefault();
  deferred = e as PromptEvent;
  emit();
});
addEventListener('appinstalled', () => { installed = true; deferred = null; emit(); });

export const onInstallChange = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** The browser will show its install prompt when asked. */
export const canPrompt = () => !!deferred;
export const justInstalled = () => installed;

/** Show the browser's prompt. Must run from a tap or click. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred;
  if (!e) return 'unavailable';
  deferred = null; // a prompt can be shown once
  emit();
  try {
    await e.prompt();
    const r = await e.userChoice;
    if (r.outcome === 'accepted') { installed = true; emit(); }
    return r.outcome;
  } catch { return 'unavailable'; }
}

/* ---------- where we are ---------- */
const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
export type Platform = 'ios' | 'android' | 'mac' | 'windows' | 'linux' | 'other';
export function platform(): Platform {
  // iPadOS reports itself as a Mac with touch.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Linux|CrOS/.test(ua)) return 'linux';
  return 'other';
}
export type Browser = 'safari' | 'chrome' | 'edge' | 'samsung' | 'firefox' | 'opera' | 'inapp' | 'other';
export function browser(): Browser {
  // Apps that open links inside themselves cannot install anything.
  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|TikTok|musical_ly|Twitter|Snapchat|Pinterest|LinkedInApp|GSA\//.test(ua) || /; wv\)/.test(ua)) return 'inapp';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/EdgiOS|EdgA|Edg\//.test(ua)) return 'edge';
  if (/OPR\/|OPT\/|Opera/.test(ua)) return 'opera';
  if (/FxiOS|Firefox\//.test(ua)) return 'firefox';
  if (/CriOS|Chrome\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}
/** Opened from the home screen or as an installed app. */
export function standalone() {
  try {
    return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch { return false; }
}

/* ---------- the page's manifest and service worker ---------- */
/**
 * Make the app at `path` installable while its page is open: its manifest, its home screen icon on
 * iPhone, and a service worker for a friendly offline page. Returns a function that undoes it.
 */
export function makeInstallable(path: string, info: { name: string; shortName: string; appleIcon: string }) {
  const added: HTMLElement[] = [];
  // The site's own home-screen icon steps aside while this app's is on the page.
  const siteIcons = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel=apple-touch-icon]')];
  siteIcons.forEach((l) => { l.rel = 'x-apple-touch-icon'; });
  const head = document.head;
  const put = (tag: 'link' | 'meta', attrs: Record<string, string>) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    head.appendChild(el);
    added.push(el);
  };
  put('link', { rel: 'manifest', href: `/api/pwa/manifest?path=${encodeURIComponent(path)}`, crossorigin: 'use-credentials' });
  put('link', { rel: 'apple-touch-icon', href: info.appleIcon });
  put('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  put('meta', { name: 'mobile-web-app-capable', content: 'yes' });
  put('meta', { name: 'apple-mobile-web-app-title', content: info.shortName || info.name });
  put('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'default' });
  // Service workers need a secure page (https, or localhost while developing).
  if ('serviceWorker' in navigator && isSecureContext) {
    navigator.serviceWorker.register('/_jhino/app-sw.js', { scope: path }).catch(() => { /* installing still works without it */ });
  }
  return () => { added.forEach((el) => el.remove()); siteIcons.forEach((l) => { l.rel = 'apple-touch-icon'; }); };
}

/* ---------- a shortcut file, for computers whose browser cannot install ---------- */
const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
export function shortcutFile(name: string, url: string, iconUrl: string): { file: string; type: string; body: string } {
  const safe = name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Jhino app';
  const p = platform();
  if (p === 'mac' || p === 'ios') {
    return {
      file: `${safe}.webloc`, type: 'application/x-apple-plist',
      body: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>URL</key>\n\t<string>${xml(url)}</string>\n</dict>\n</plist>\n`,
    };
  }
  if (p === 'linux') {
    return { file: `${safe}.desktop`, type: 'application/x-desktop', body: `[Desktop Entry]\nVersion=1.0\nType=Link\nName=${safe}\nURL=${url}\nIcon=${iconUrl}\n` };
  }
  return { file: `${safe}.url`, type: 'application/internet-shortcut', body: `[InternetShortcut]\r\nURL=${url}\r\nIconIndex=0\r\n` };
}
export function downloadShortcut(name: string, url: string, iconUrl: string) {
  const f = shortcutFile(name, url, iconUrl);
  const href = URL.createObjectURL(new Blob([f.body], { type: f.type }));
  const a = document.createElement('a');
  a.href = href; a.download = f.file;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return f.file;
}
