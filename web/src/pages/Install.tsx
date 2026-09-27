import { useEffect, useState, type ReactNode } from 'react';
import { get } from '../api';
import { Icon, Modal, copyText, useToast } from '../ui';
import { browser, canPrompt, downloadShortcut, justInstalled, makeInstallable, onInstallChange, platform, promptInstall, standalone } from '../install';

/*
 * "Install app" / "Add to Home Screen" for one Jhino app. The page carries the app's own manifest and
 * icon while it is open (useInstallable); the sheet asks the browser to install when it can, and
 * otherwise shows the two or three taps this phone or browser needs.
 */

export interface InstallInfo { name: string; shortName: string; path: string; color: string; icon: string; appleIcon: string }

/** Make the app at this address installable while its page is open. */
export function useInstallable(path: string | null) {
  const [info, setInfo] = useState<InstallInfo | null>(null);
  useEffect(() => {
    if (!path) { setInfo(null); return; }
    let alive = true;
    let undo: (() => void) | null = null;
    get<InstallInfo>(`/api/pwa/info?path=${encodeURIComponent(path)}`).then(
      (i) => { if (!alive) return; setInfo(i); undo = makeInstallable(i.path, i); },
      () => { if (alive) setInfo(null); },
    );
    return () => { alive = false; undo?.(); };
  }, [path]);
  return info;
}

/** The browser has offered to install this page (it can show its own prompt). */
export function useCanPrompt() {
  const [v, setV] = useState(canPrompt);
  useEffect(() => onInstallChange(() => setV(canPrompt())), []);
  return v;
}

/** Opened with ?install=1 (the "Add to home screen" button on someone's page). */
export const hasInstallFlag = () => new URLSearchParams(location.search).get('install') === '1';
/** Take ?install=1 out of the address, so a reload or a shared link does not open the sheet again. */
export function clearInstallFlag() {
  const q = new URLSearchParams(location.search);
  if (!q.has('install')) return;
  q.delete('install');
  const rest = q.toString();
  history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
}

type Stage = 'ready' | 'waiting' | 'done';

export function InstallSheet({ info, onClose }: { info: InstallInfo; onClose: () => void }) {
  const toast = useToast();
  const prompt = useCanPrompt();
  const p = platform();
  const b = browser();
  const phone = p === 'ios' || p === 'android';
  const [stage, setStage] = useState<Stage>(() => (justInstalled() ? 'done' : canPrompt() || p === 'ios' || b === 'inapp' ? 'ready' : 'waiting'));
  const url = `${location.origin}${info.path}`;

  // Browsers offer their prompt a moment after the page gets its manifest: wait briefly before showing the manual steps.
  useEffect(() => {
    if (stage !== 'waiting') return;
    if (prompt) { setStage('ready'); return; }
    const t = setTimeout(() => setStage('ready'), 2500);
    return () => clearTimeout(t);
  }, [stage, prompt]);

  const install = async () => {
    const r = await promptInstall();
    if (r === 'accepted') setStage('done');
    else if (r === 'unavailable') toast('Use the steps below to add it.', true);
  };
  const shortcut = () => {
    const file = downloadShortcut(info.name, url, `${location.origin}${info.icon}`);
    toast(`Downloaded ${file}. Put it on your desktop or in your dock.`);
  };

  let body: ReactNode;
  if (standalone()) {
    body = <p className="ins-lede">You are using the installed app. It opens from your home screen and stays in sync with everyone.</p>;
  } else if (stage === 'done') {
    body = (
      <div className="ins-done" role="status">
        <span className="ins-check" aria-hidden="true"><Icon name="check" size={18} /></span>
        <p><b>Added.</b> Open {info.shortName || info.name} from your {phone ? 'home screen' : 'apps or desktop'}. It always shows the latest, live.</p>
      </div>
    );
  } else if (b === 'inapp') {
    body = (
      <>
        <p className="ins-lede">This page is open inside another app, which cannot add it. Open it in your browser first.</p>
        <Steps items={[
          <>Tap <Key>{p === 'ios' ? '•••' : '⋮'}</Key> at the top of the screen.</>,
          <>Choose <b>{p === 'ios' ? 'Open in Safari' : 'Open in browser'}</b>, then add it from there.</>,
        ]} />
        <button className="btn primary lg ins-main" onClick={() => copyText(url).then(() => toast('Link copied. Paste it in your browser.'))}><Icon name="copy" size={16} />Copy link</button>
      </>
    );
  } else if (p === 'ios') {
    body = (
      <>
        <p className="ins-lede">Add it to your Home Screen and it opens like an app, full screen, always up to date.</p>
        <Steps items={[
          <>Tap <Key label="Share"><ShareGlyph /></Key> {b === 'safari' ? 'in the toolbar' : 'at the top right'}.</>,
          <>Scroll down and tap <b>Add to Home Screen</b> <Key label="Add to Home Screen"><AddGlyph /></Key></>,
          <>Tap <b>Add</b>.</>,
        ]} />
      </>
    );
  } else if (stage === 'waiting') {
    body = <p className="ins-lede ins-wait"><span className="spin" />Getting it ready…</p>;
  } else if (prompt) {
    body = (
      <>
        <p className="ins-lede">{phone ? 'Add it to your home screen: it opens like an app, full screen, always up to date.' : 'It opens in its own window from your dock or Start menu, always up to date.'}</p>
        <button className="btn primary lg ins-main" onClick={install} autoFocus><Icon name="download" size={16} />Install app</button>
        {!phone && <button className="link ins-alt" onClick={shortcut}>Download a shortcut instead</button>}
      </>
    );
  } else if (p === 'android') {
    const menu = b === 'samsung'
      ? [<>Tap <Key>☰</Key> at the bottom.</>, <>Tap <b>Add page to</b>, then <b>Home screen</b>.</>]
      : b === 'firefox'
        ? [<>Tap <Key>⋮</Key>.</>, <>Tap <b>Install</b> (or <b>Add to Home screen</b>).</>]
        : [<>Tap <Key>⋮</Key> at the top right.</>, <>Tap <b>Add to Home screen</b> or <b>Install app</b>, then <b>Install</b>.</>];
    body = (
      <>
        <p className="ins-lede">Add it to your home screen and it opens like an app, always up to date.</p>
        <Steps items={menu} />
      </>
    );
  } else {
    const how = b === 'safari' ? <>In Safari you can also choose <b>File → Add to Dock</b>.</>
      : b === 'edge' ? <>In Edge you can also open <Key>…</Key> → <b>Apps</b> → <b>Install this site as an app</b>.</>
        : b === 'chrome' ? <>In Chrome you can also open <Key>⋮</Key> → <b>Cast, save and share</b> → <b>Install page as app</b>.</>
          : <>It opens this app in your browser, signed in as you.</>;
    body = (
      <>
        <p className="ins-lede">Put a shortcut on your desktop or dock that opens this app in one click.</p>
        <button className="btn primary lg ins-main" onClick={shortcut}><Icon name="download" size={16} />Download shortcut</button>
        <p className="hint ins-alt-text">{how}</p>
      </>
    );
  }

  return (
    <Modal title="Add to this device" onClose={onClose}>
      <div className="modal-body ins">
        <div className="ins-app">
          <img src={info.icon} alt="" width={56} height={56} />
          <div className="ins-name">
            <b>{info.name}</b>
            <span className="mono">{location.host}{info.path}</span>
          </div>
        </div>
        {body}
      </div>
    </Modal>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return <ol className="ins-steps">{items.map((x, i) => <li key={i}><span>{x}</span></li>)}</ol>;
}
function Key({ children, label }: { children: ReactNode; label?: string }) {
  return <span className="ins-key" role={label ? 'img' : undefined} aria-label={label}>{children}</span>;
}
/** The iOS share mark: a box with an arrow out of the top. */
function ShareGlyph() {
  return <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5v11M8 7.2 12 3.5l4 3.7M8.5 10.5H6.5v10h11v-10h-2" /></svg>;
}
/** A rounded square with a plus. */
function AddGlyph() {
  return <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8.5v7M8.5 12h7" /></svg>;
}
