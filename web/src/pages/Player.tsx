import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, get, post, uploadWithProgress, type AppDetail, type Role } from '../api';
import { useRoute, useSession } from '../context';
import { live } from '../live';
import { Avatar, Icon, Menu, copyText, useToast } from '../ui';
import { UploadDialog } from './Shell';
import { ShareDialog } from './Share';
import { DetailsPanel } from './Details';
import { SANDBOX } from '../sandbox';

/** The app as one .html file: open it, sign in once, and it works live with everyone (while online). */
export async function downloadHtml(appId: string): Promise<string | null> {
  const r = await fetch(`/api/apps/${appId}/download`, { credentials: 'same-origin' });
  if (!r.ok) {
    try { return ((await r.json()) as { message?: string }).message ?? 'Could not download it.'; } catch { return 'Could not download it.'; }
  }
  const name = /filename="?([^";]+)"?/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'app.html';
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = decodeURIComponent(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return null;
}

type Sync = 'saved' | 'saving' | 'retry' | 'offline';
interface Run { url: string; nonce: string; role: Role; version: number }

const MAX_VALUE = 5 * 1024 * 1024;
const COLLECTION = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The trusted side of the bridge. It only accepts a handshake from our own iframe
 * with this launch's nonce, then talks over a private MessageChannel. Every request
 * is scoped to this app here and checked again by the server.
 */
class Bridge {
  private port: MessagePort | null = null;
  private buffer: unknown[] = [];
  constructor(
    private frame: HTMLIFrameElement,
    private nonce: string,
    private appId: string,
    private on: { note: (type: string, data: any) => void; takeScroll: () => [number, number] | null },
  ) {
    window.addEventListener('message', this.onWindowMessage);
  }
  destroy() {
    window.removeEventListener('message', this.onWindowMessage);
    this.port?.close();
    this.port = null;
  }
  send(event: string, data: unknown) {
    const msg = { event, data };
    if (this.port) this.port.postMessage(msg);
    else if (this.buffer.length < 500) this.buffer.push(msg);
  }
  private onWindowMessage = (e: MessageEvent) => {
    if (e.source !== this.frame.contentWindow || !this.frame.contentWindow) return;
    const d = e.data;
    if (!d || d.jhino !== 'hello' || d.nonce !== this.nonce) return;
    // Every page load in the frame says hello; give it a fresh private channel.
    this.port?.close();
    const ch = new MessageChannel();
    const port = ch.port1;
    this.port = port;
    port.onmessage = (ev) => this.onPortMessage(port, ev);
    this.frame.contentWindow.postMessage({ jhino: 'port', nonce: this.nonce, scroll: this.on.takeScroll() }, '*', [ch.port2]);
    this.buffer.splice(0).forEach((m) => port.postMessage(m));
  };
  private async onPortMessage(port: MessagePort, ev: MessageEvent) {
    const m = ev.data;
    if (!m || typeof m !== 'object') return;
    if (typeof m.note === 'string') { this.on.note(m.note, m.data); return; }
    if (typeof m.id !== 'number' || typeof m.op !== 'string') return;
    const result = await this.handle(m.op, m.args && typeof m.args === 'object' ? m.args : {});
    port.postMessage({ re: m.id, result });
  }
  private async handle(op: string, a: any): Promise<any> {
    const base = `/api/apps/${this.appId}`;
    const col = (c: unknown) => { if (typeof c !== 'string' || !COLLECTION.test(c)) throw new ApiError(400, 'VALIDATION_FAILED', 'Collection names use letters, numbers, - and _.'); return c; };
    const rid = (r: unknown) => { if (typeof r !== 'string' || !/^[\w-]{1,64}$/.test(r)) throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid record id.'); return r; };
    try {
      switch (op) {
        case 'kv.set': {
          if (a.ns !== 'ls' && a.ns !== 'ws') throw new ApiError(400, 'VALIDATION_FAILED', 'Unknown storage.');
          if (typeof a.key !== 'string' || (a.value !== null && typeof a.value !== 'string')) throw new ApiError(400, 'VALIDATION_FAILED', 'Keys and values must be text.');
          if (a.value && a.value.length > MAX_VALUE) throw new ApiError(413, 'QUOTA_EXCEEDED', 'That value is too large to save (5 MB limit).');
          return await api('PUT', `${base}/kv`, { ns: a.ns, scope: a.scope === 'private' ? 'private' : 'shared', key: a.key, value: a.value, baseRev: Number(a.baseRev) || 0 });
        }
        case 'kv.snapshot': return await get(`${base}/kv`);
        case 'people': return await get(`${base}/people`);
        case 'files.list': return await get(`${base}/files`);
        case 'activity.list': {
          const q = new URLSearchParams();
          if (a.limit) q.set('limit', String(Math.min(200, Number(a.limit) || 100)));
          if (a.before) q.set('before', String(Number(a.before) || 0));
          return await get(`${base}/activity?${q}`);
        }
        case 'activity.seen': return await post(`${base}/activity/seen`, { upTo: Number(a.upTo) || 0 });
        case 'trash.list': return await get(`${base}/trash`);
        case 'trash.restore': return await post(`${base}/trash/restore`, { ids: Array.isArray(a.ids) ? a.ids.filter((x: unknown) => typeof x === 'string').slice(0, 500) : [] });
        case 'trash.purge': return await post(`${base}/trash/purge`, a.all === true ? { all: true } : { ids: Array.isArray(a.ids) ? a.ids.filter((x: unknown) => typeof x === 'string').slice(0, 500) : [] });
        case 'files.delete': {
          if (typeof a.id !== 'string' || !/^[\w-]{1,64}$/.test(a.id)) throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid file id.');
          return await api('DELETE', `${base}/files/${a.id}`);
        }
        case 'files.upload': {
          if (!(a.file instanceof Blob)) throw new ApiError(400, 'VALIDATION_FAILED', 'Pass a File or Blob.');
          const name = typeof a.name === 'string' && a.name ? a.name.slice(0, 200) : 'file';
          const uploadId = typeof a.uploadId === 'string' ? a.uploadId.slice(0, 40) : '';
          let last = 0;
          return await uploadWithProgress(`${base}/files`, a.file, name, (loaded, total) => {
            const t = Date.now();
            if (t - last > 120 || loaded === total) { last = t; this.send('upload-progress', { uploadId, loaded, total }); }
          });
        }
        case 'records.list': {
          const q = new URLSearchParams();
          if (a.limit) q.set('limit', String(Number(a.limit)));
          if (typeof a.after === 'string') q.set('after', a.after);
          return await get(`${base}/records/${col(a.collection)}?${q}`);
        }
        case 'records.get': return await get(`${base}/records/${col(a.collection)}/${rid(a.id)}`);
        case 'records.create': return await api('POST', `${base}/records/${col(a.collection)}`, { data: a.data, idempotencyKey: typeof a.idempotencyKey === 'string' ? a.idempotencyKey : undefined });
        case 'records.update': return await api('PATCH', `${base}/records/${col(a.collection)}/${rid(a.id)}`, { data: a.data, expectedRevision: a.expectedRevision });
        case 'records.delete': {
          const q = a.expectedRevision !== undefined ? `?expectedRevision=${Number(a.expectedRevision)}` : '';
          return await api('DELETE', `${base}/records/${col(a.collection)}/${rid(a.id)}${q}`);
        }
        default: return { error: 'UNKNOWN', message: `Unknown request: ${op}` };
      }
    } catch (e) {
      if (e instanceof ApiError) return { ...e.data, error: e.code, message: e.message };
      return { error: 'CONNECTION_LOST', message: 'Could not reach Jhino.' };
    }
  }
}

/** Desktop notifications for activity by others while this tab is in the background (opt-in per browser). */
const NOTIFY_KEY = 'jhino.notify';
const notifyOn = () => { try { return localStorage.getItem(NOTIFY_KEY) === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted'; } catch { return false; } };

const mb = (n: number) => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : (n / 1048576).toFixed(1) + ' MB');

/**
 * The Jhino page around an app. With `solo`, it is the "open in a new tab" view of one item:
 * the item fills the tab, with no Jhino bar and none of the app's menus.
 */
export function Player({ id, solo, visitor }: { id: string; solo?: boolean; visitor?: { name: string; showBar: boolean } }) {
  const { user, refresh } = useSession();
  const { go } = useRoute();
  const toast = useToast();
  const [app, setApp] = useState<AppDetail | null>(null);
  const [fatal, setFatal] = useState<{ title: string; text: string } | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [sync, setSync] = useState<Sync>('saved');
  const [online, setOnline] = useState(true);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [notice, setNotice] = useState<{ text: string; action: string; onAction: () => void } | null>(null);
  const [dialog, setDialog] = useState<'share' | 'details' | 'upload' | null>(null);
  const [menuFor, setMenuFor] = useState<HTMLElement | null>(null);
  const [upload, setUpload] = useState<{ name: string; pct: number } | null>(null);
  // Big videos this person uploaded that the server is making smaller.
  const [shrinking, setShrinking] = useState<Record<string, { name: string; pct: number }>>({});
  const shrinkIds = useRef(new Set<string>());
  const [notify, setNotify] = useState(notifyOn);
  const notifyDesktop = useCallback((d: any) => {
    if (!notifyOn() || !document.hidden || !d || d.userId === user?.id) return;
    const text = [d.name || 'Someone', d.action, d.detail].filter(Boolean).join(' ');
    try {
      const n = new Notification(app?.name || 'Jhino', { body: d.note ? `${text}
“${String(d.note).slice(0, 120)}”` : text, tag: `jhino-${id}-${d.id}` });
      n.onclick = () => { window.focus(); if (d.collection && d.recordId) bridge.current?.send('navigate', { hash: `#${d.collection}/${d.recordId}` }); n.close(); };
    } catch { /* not supported here */ }
  }, [app?.name, id, user?.id]);
  const toggleNotify = async () => {
    if (notify) { try { localStorage.removeItem(NOTIFY_KEY); } catch { /* ignore */ } setNotify(false); toast('Desktop notifications are off.'); return; }
    if (typeof Notification === 'undefined') { toast('This browser cannot show notifications.', true); return; }
    const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (perm !== 'granted') { toast('Notifications are blocked for this site in your browser settings.', true); return; }
    try { localStorage.setItem(NOTIFY_KEY, '1'); } catch { /* ignore */ }
    setNotify(true);
    toast('You will get a notification when someone changes something while this tab is in the background.');
  };
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<Bridge | null>(null);
  const scroll = useRef<[number, number] | null>(null);

  const loadApp = useCallback(() => get<{ app: AppDetail }>(`/api/apps/${id}`).then((r) => { setApp(r.app); return r.app; }), [id]);

  const launch = useCallback(async (keep?: { hash?: string; scroll?: [number, number] | null }) => {
    const r = await post<Run>(`/api/apps/${id}/launch`);
    scroll.current = keep?.scroll ?? null;
    // Keep the section the person was in (built apps put it in the hash).
    const hash = keep?.hash && /^#[\w/-]{1,160}$/.test(keep.hash) ? keep.hash : '';
    setRun({ ...r, url: r.url + hash });
    setNotice(null);
  }, [id]);

  // Load, start listening for changes, then open the app.
  useEffect(() => {
    let alive = true;
    const w = live.watch(id);
    (async () => {
      try {
        await loadApp();
        await w.ready;
        // Open straight at the item in the address (for example a link someone shared, or "open in new tab").
        if (alive) await launch({ hash: solo && /^#[\w-]+\/[\w-]+$/.test(location.hash) ? '#view/' + location.hash.slice(1) : location.hash });
      } catch (e) {
        if (!alive) return;
        const err = e as ApiError;
        setFatal(err.status === 404
          ? { title: 'App not found', text: 'This app does not exist, or it is not shared with you.' }
          : err.code === 'IN_TRASH'
            ? { title: 'This app is in Trash', text: 'Restore it from Trash to open it again.' }
            : { title: 'Could not open this app', text: err.message || 'Try again in a moment.' });
      }
    })();
    return () => { alive = false; w.stop(); };
  }, [id, loadApp, launch]);

  // Wire the bridge to the frame for this launch.
  useEffect(() => {
    if (!run || !frame.current) return;
    const b = new Bridge(frame.current, run.nonce, id, {
      takeScroll: () => { const s = scroll.current; scroll.current = null; return s; },
      note: (type, data) => {
        if (type === 'status') setSync(data?.state === 'saving' ? 'saving' : data?.state === 'retry' ? 'retry' : 'saved');
        else if (type === 'readonly') toast('You can view this app but not change it.');
        else if (type === 'location') {
          const hash = typeof data?.hash === 'string' && /^#?[\w/-]{0,160}$/.test(data.hash) ? data.hash.replace(/^#?/, '#') : '';
          // Keep the address the app was opened at (jhino.com/your-studio stays that); only the #part follows the app.
          if (!solo) history.replaceState(history.state, '', `${location.pathname}${hash === '#' ? '' : hash}`);
        }
        else if (type === 'title') {
          const t = typeof data?.title === 'string' ? data.title.slice(0, 120) : '';
          document.title = t ? `${t} · ${app?.name ?? 'Jhino'}` : (app?.name ?? 'Jhino');
        }
        else if (type === 'open-full') {
          // From the single-item tab to the whole app, at the same item.
          const hash = typeof data?.hash === 'string' && /^#?[\w/-]{0,160}$/.test(data.hash) ? data.hash.replace(/^#?/, '#') : '';
          location.href = `${visitor ? location.pathname : `/apps/${id}`}${hash === '#' ? '' : hash}`;
        }
        else if (type === 'open-tab') {
          const hash = typeof data?.hash === 'string' && /^#?[\w/-]{0,160}$/.test(data.hash) ? data.hash.replace(/^#?/, '#') : '';
          const url = `/apps/${id}/view${hash === '#' ? '' : hash}`;
          const w = window.open(url, '_blank', 'noopener');
          if (!w) copyText(`${location.origin}${url}`).then(() => toast('Link copied. Paste it in a new tab.'));
        }
        else if (type === 'upload') {
          if (data?.done) { setUpload(null); if (data.error) toast(String(data.error).slice(0, 160), true); }
          else setUpload({ name: String(data?.name ?? 'file').slice(0, 60), pct: data?.total ? Math.round((data.loaded / data.total) * 100) : 0 });
        }
        else if (type === 'error') toast(String(data?.message || 'A change could not be saved.').slice(0, 200), true);
        else if (type === 'version-ready') {
          const s = data?.scroll;
          launch({ hash: typeof data?.hash === 'string' ? data.hash : '', scroll: Array.isArray(s) ? [Number(s[0]) || 0, Number(s[1]) || 0] : null }).catch(() => {});
        }
        else if (type === 'stale') setNotice({ text: 'Someone updated this app. It refreshes when you pause.', action: 'Refresh now', onAction: () => b.send('refresh-now', {}) });
        else if (type === 'reloading') {
          const s = data?.scroll;
          scroll.current = Array.isArray(s) ? [Number(s[0]) || 0, Number(s[1]) || 0] : null;
          setNotice(null);
        }
      },
    });
    bridge.current = b;
    return () => { b.destroy(); bridge.current = null; };
  }, [run, id, toast]);

  // Committed changes from the server.
  // The address changed (Back, Forward or an edited link): show that section or item in the app.
  useEffect(() => {
    const f = () => { if (/^#[\w/-]{1,160}$/.test(location.hash)) bridge.current?.send('navigate', { hash: location.hash }); };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);

  useEffect(() => live.on((event, d) => {
    if (event === 'notification' && d && !visitor) {
      toast(String(d.title ?? '').slice(0, 160));
      if (notifyOn() && document.hidden) { try { new Notification(String(d.title ?? 'Jhino'), { body: String(d.body ?? '').slice(0, 200), tag: `jhino-n-${d.id}` }); } catch { /* not supported */ } }
      return;
    }
    if (event === 'online') {
      setOnline(true);
      // Re-sync on every (re)connection: if the stream came up after the app opened, changes in between are fetched now.
      bridge.current?.send('resync', {});
      return;
    }
    if (event === 'offline') { setOnline(false); return; }
    if (!d || d.appId !== id) return;
    if (event === 'kv' || event === 'record' || event === 'file' || event === 'activity' || event === 'trash') bridge.current?.send(event, d);
    if (event === 'activity') notifyDesktop(d);
    if (event === 'file' && d.file && d.file.createdBy === user?.id && (d.op === 'create' || d.op === 'update')) {
      const f = d.file;
      if (f.status === 'processing') {
        shrinkIds.current.add(f.id);
        setShrinking((m) => ({ ...m, [f.id]: { name: String(f.name), pct: Number(f.progress) || 0 } }));
      } else if (shrinkIds.current.delete(f.id)) {
        if (f.status === 'ready' && f.originalSize) toast(`${f.name} is now ${mb(f.size)} (was ${mb(f.originalSize)}). It plays the same and loads faster.`);
        setShrinking((m) => { const { [f.id]: _gone, ...rest } = m; return rest; });
      }
      return;
    }
    if (event === 'presence') setPeople(d.people ?? []);
    else if (event === 'revoked') { setRun(null); setFatal(visitor ? { title: 'This link was turned off', text: 'The owner stopped sharing this app by link.' } : { title: 'Your access was removed', text: 'The owner removed you from this app. Anything already on your screen may be out of date.' }); }
    else if (event === 'role-changed') {
      bridge.current?.send('role', { role: d.role });
      loadApp().catch(() => {});
      toast(d.role === 'editor' ? 'You can now edit this app.' : 'You can now only view this app.');
    } else if (event === 'app-updated') {
      if (d.reason === 'trashed') { setRun(null); setFatal({ title: 'This app was moved to Trash', text: 'The owner moved it to Trash. It can be restored from there.' }); return; }
      loadApp().catch(() => {});
      if (d.reason === 'version' || d.reason === 'settings') {
        // A new version opens by itself when the person pauses; the notice lets them switch at once.
        if (d.reason === 'version') bridge.current?.send('new-version', { version: d.version });
        setNotice({ text: d.reason === 'version' ? `Version ${d.version} is live. It opens when you pause.` : 'App settings changed.', action: 'Reload now', onAction: () => { launch(); } });
      }
    }
  }), [id, loadApp, launch, toast, user?.id, notifyDesktop]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => { if (sync !== 'saved') { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', f);
    return () => removeEventListener('beforeunload', f);
  }, [sync]);

  useEffect(() => { document.title = app ? `${app.name} · Jhino` : 'Jhino'; return () => { document.title = 'Jhino'; }; }, [app]);

  const back = () => go(app && app.role !== 'owner' ? '/shared' : '/apps');
  const isOwner = app?.role === 'owner';
  const others = people.filter((p) => p.id !== user.id);

  const trash = async () => {
    if (!app || !confirm(`Move “${app.name}” to Trash? People you shared it with lose access until you restore it.`)) return;
    try { await post(`/api/apps/${id}/trash`); toast(`${app.name} moved to Trash`); go('/apps'); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not move to Trash.', true); }
  };
  const leave = async () => {
    if (!app || !confirm(`Leave “${app.name}”? You will need a new invite to come back.`)) return;
    try { await api('DELETE', `/api/apps/${id}/members/${user.id}`); go('/shared'); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not leave.', true); }
  };

  const syncView = !online
    ? <><span className="dot bad" />Offline</>
    : sync === 'saving' ? <><span className="spin" style={{ width: 10, height: 10 }} />Saving</>
      : sync === 'retry' ? <><span className="dot warn" />Retrying</>
        : <><span className="dot ok" />Saved</>;

  if (fatal) {
    return (
      <main className="state-card">
        <h2>{fatal.title}</h2>
        <p>{fatal.text}</p>
        {!visitor && <button className="btn" onClick={() => go('/apps')}><Icon name="back" size={16} />Back to apps</button>}
      </main>
    );
  }
  const showBar = app?.showBar !== false;
  const setBar = async (on: boolean) => {
    setMenuFor(null);
    try { await api('PATCH', `/api/apps/${id}/sharing`, { showBar: on }); await loadApp(); toast(on ? 'Top bar shown' : 'Top bar hidden. Use the corner button for the menu.'); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not change it.', true); }
  };

  if (solo) {
    return (
      <div className="player solo">
        <div className="frame-wrap">
          {run && <iframe key={run.url} ref={frame} src={run.url} title={app?.name ?? 'App'} sandbox={SANDBOX} allow="clipboard-write; fullscreen" referrerPolicy="no-referrer" />}
          {notice && <div className="notice" role="status"><span>{notice.text}</span><button className="btn sm" onClick={notice.onAction}>{notice.action}</button></div>}
        </div>
      </div>
    );
  }

  return (
    <div className={`player player-enter ${showBar ? '' : 'bare'}`}>
      {showBar ? <header className="player-bar">
        {visitor ? <span className="visitor-mark" aria-hidden="true" /> : <button className="icon-btn" onClick={back} aria-label="Back to apps"><Icon name="back" /></button>}
        <div className="title">
          <h1>{app?.name ?? ''}</h1>
          {app && !visitor && <span className="ver hide-sm">v{app.liveVersion}</span>}
        </div>
        <div className="spacer" />
        {others.length > 0 && !visitor && (
          <span className="stack hide-sm" aria-label={`Also here: ${others.map((p) => p.name).join(', ')}`} title={`Also here: ${others.map((p) => p.name).join(', ')}`}>
            {others.slice(0, 4).map((p) => <Avatar key={p.id} name={p.name} size="sm" />)}
          </span>
        )}
        {run?.role === 'viewer' && <span className="pill hide-sm">View only</span>}
        {run?.role === 'contributor' && <span className="pill hide-sm">Can add</span>}
        {upload && <span className="sync upload" title={upload.name}><span className="up-bar"><i style={{ transform: `scaleX(${upload.pct / 100})` }} /></span><span className="hide-sm">{upload.name.length > 22 ? upload.name.slice(0, 20) + '…' : upload.name}</span> {upload.pct}%</span>}
        {Object.values(shrinking).slice(0, 1).map((p) => <span key="shrink" className="sync upload" title={`Making a smaller copy of ${p.name}. The original plays until it is ready.`}><span className="up-bar"><i style={{ transform: `scaleX(${p.pct / 100})` }} /></span><span className="hide-sm">Making a smaller copy</span> {p.pct}%</span>)}
        <span className="sync" role="status" aria-live="polite">{syncView}</span>
        {isOwner && <button className="btn sm" onClick={() => setDialog('share')}>Share</button>}
        <button className="icon-btn" onClick={(e) => setMenuFor(e.currentTarget)} aria-label="More" aria-haspopup="menu" aria-expanded={!!menuFor}><Icon name="more" /></button>
      </header> : !visitor && (
        // Top bar hidden: a small corner button keeps the menu in reach.
        <button className="bar-handle" onClick={(e) => setMenuFor(e.currentTarget)} aria-label="Menu" aria-haspopup="menu" aria-expanded={!!menuFor}><Icon name="more" /></button>
      )}
      <div className="frame-wrap">
        {run && (
          <iframe
            key={run.url}
            ref={frame}
            src={run.url}
            title={app?.name ?? 'App'}
            sandbox={SANDBOX}
            allow="clipboard-write; fullscreen"
            referrerPolicy="no-referrer"
          />
        )}
        {notice && (
          <div className="notice" role="status">
            <span>{notice.text}</span>
            <button className="btn sm" onClick={notice.onAction}>{notice.action}</button>
          </div>
        )}
      </div>
      {menuFor && app && visitor && (
        <Menu anchor={menuFor} onClose={() => setMenuFor(null)}>
          <button role="menuitem" onClick={() => launch()}>Reload</button>
          <button role="menuitem" onClick={() => go('/')}>About Jhino</button>
        </Menu>
      )}
      {menuFor && app && !visitor && (
        <Menu anchor={menuFor} onClose={() => setMenuFor(null)}>
          {!showBar && <button role="menuitem" onClick={back}>Back to apps</button>}
          {!showBar && isOwner && <button role="menuitem" onClick={() => setDialog('share')}>Share</button>}
          <button role="menuitem" onClick={() => setDialog('details')}>Details and activity</button>
          <button role="menuitem" onClick={() => launch()}>Reload app</button>
          <button role="menuitem" onClick={async () => { setMenuFor(null); const fail = await downloadHtml(app.id); toast(fail ?? 'Downloaded. Open the file, sign in once, and it stays in sync with everyone.', !!fail); }}>Download as HTML file</button>
          <button role="menuitem" onClick={() => { setMenuFor(null); toggleNotify(); }}>{notify ? 'Turn off desktop notifications' : 'Turn on desktop notifications'}</button>
          {isOwner && <button role="menuitem" onClick={() => setBar(!showBar)}>{showBar ? 'Hide top bar' : 'Show top bar'}</button>}
          {isOwner && app.built && <button role="menuitem" onClick={() => go(`/apps/${app.id}/blocks`)}>Edit features and design</button>}
          {isOwner && !app.built && <button role="menuitem" onClick={() => setDialog('upload')}>Upload a new version</button>}
          <hr />
          {isOwner
            ? <button role="menuitem" className="danger" onClick={trash}>Move to Trash</button>
            : <button role="menuitem" className="danger" onClick={leave}>Leave this app</button>}
          <button role="menuitem" onClick={async () => { await post('/api/auth/logout'); await refresh(); go('/login', true); }}>Sign out</button>
        </Menu>
      )}
      {dialog === 'share' && app && <ShareDialog app={app} onClose={() => { setDialog(null); loadApp().catch(() => {}); }} />}
      {dialog === 'details' && app && <DetailsPanel app={app} onClose={() => setDialog(null)} onChanged={() => loadApp().catch(() => {})} onUpload={() => setDialog('upload')} />}
      {dialog === 'upload' && app && <UploadDialog replaceAppId={app.id} onClose={() => { setDialog(null); loadApp().then(() => launch()).catch(() => {}); }} />}
    </div>
  );
}
