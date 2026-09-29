import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, get, post } from '../api';
import { Link, useRoute, useSession } from '../context';
import { PanelLoader } from '../Loader';
import { Icon, ago, bytes, copyText, Modal, useToast } from '../ui';
import { Calendar, Contacts, Notes, P, QrLogoField, QrMaker, QrSvg, TOOLS, Tasks, useTimer } from '../QuickTools';
import { Calculator, ColourTool, Encoder, JsonTool, NepaliDate, Passwords, WorldClock } from '../MoreTools';
import { UploadDialog } from './Shell';
import { ASK_THEMES, askTheme } from './Ask';
import { appsForInterests, getRecent, noteRecent, type InterestState } from '../appsPrefs';
import '../tools.css';
import '../apps.css';

/*
 * Apps on the dashboard: twenty everyday apps, each with a full page at /home/<key>. Home shows nine of
 * them as cards, and the person picks which nine (saved to their account). The side rail's tools also open
 * full-page from here. Smart links, dynamic QR codes and Ask me anything are saved on the server
 * (server/mini.ts); the text and image tools run only in the browser.
 */
type AppKey = 'upload' | 'bio' | 'smart' | 'qr' | 'ask' | 'focus' | 'subs' | 'image' | 'pdf' | 'wordpdf' | 'pdfword' | 'currency' | 'text' | 'fonts' | 'thumb' | 'picker' | 'emi' | 'date' | 'password' | 'links';
interface DashApp { key: AppKey; label: string; desc: string; d: string; to?: string; group: string }
const D = {
  upload: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  bio: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM6 21v-1a6 6 0 0 1 12 0v1M3 3h4M17 3h4',
  smart: 'M6 3h5v7H6zM13 14h5v7h-5zM8.5 10v4a2 2 0 0 0 2 2h2.5M15.5 14V9a2 2 0 0 0-2-2H11',
  ask: 'M4 5h16v11H9l-5 4zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.4M12 14.5h.01',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  subs: 'M4 6h16v12H4zM4 10h16M8 15h3M16 3v3M8 3v3',
  pdf: 'M7 3h7l5 5v13H7zM14 3v5h5M9.5 13h5M9.5 17h5',
  wordpdf: 'M5 3h7l4 4v6M12 3v4h4M6 9l1.2 5 1.3-4 1.3 4L11 9M14 17h7M18 14l3 3-3 3',
  pdfword: 'M5 3h7l4 4v6M12 3v4h4M6 10h4M6 13h3M14 17h7M18 14l3 3-3 3',
  currency: 'M12 3v18M16.5 7.5c-.8-1.2-2.4-2-4.5-2-2.8 0-4.5 1.4-4.5 3.2 0 4.3 9 2.3 9 6.6 0 1.9-1.9 3.2-4.5 3.2-2.3 0-4-.9-4.8-2.3',
  fonts: 'M4 19l5-14 5 14M6 14h6M17 8v11M14.5 11h5',
  thumb: 'M3 6h18v12H3zM10 9.5v5l4.5-2.5z',
  picker: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v9l6.4 6.4M12 12H3',
  emi: 'M4 20h16M6 16V9M10 16V6M14 16v-4M18 16V8M3 4h4',
};
export const DASH_APPS: DashApp[] = [
  { key: 'upload', group: 'Publish', label: 'Upload HTML or ZIP', desc: 'Your own page or site, live in seconds.', d: D.upload },
  { key: 'bio', group: 'Publish', label: 'Link in bio', desc: 'Your page: links, videos, TikToks and posts.', d: D.bio },
  { key: 'smart', group: 'Publish', label: 'Smart link', desc: 'One link. iPhone, Android and computers each land in the right place.', d: D.smart },
  { key: 'qr', group: 'Publish', label: 'Dynamic QR', desc: 'Print it once, change where it goes any time.', d: P.qr },
  { key: 'ask', group: 'Publish', label: 'Ask me anything', desc: 'Anonymous questions from your followers.', d: D.ask },
  { key: 'links', group: 'Publish', label: 'Short links', desc: 'Short links with a QR and click counts.', d: P.links, to: '/links' },
  { key: 'focus', group: 'Everyday', label: 'Focus studio', desc: 'Pomodoro with a real alarm, live music, sounds and your playlists.', d: P.focus },
  { key: 'subs', group: 'Everyday', label: 'Subscriptions and domains', desc: 'Every renewal and domain expiry in one place, with totals in rupees.', d: D.subs },
  { key: 'currency', group: 'Everyday', label: 'Currency converter', desc: "NPR against USD, INR and 20 more, at today's NRB rates.", d: D.currency },
  { key: 'emi', group: 'Everyday', label: 'EMI calculator', desc: 'Monthly loan payment, interest and a year-by-year plan.', d: D.emi },
  { key: 'date', group: 'Everyday', label: 'Nepali date', desc: 'BS to AD and back.', d: P.date },
  { key: 'image', group: 'Files', label: 'Image converter', desc: 'JPG, PNG, WebP and AVIF. Convert, shrink and resize in bulk.', d: D.image },
  { key: 'pdf', group: 'Files', label: 'PDF tools', desc: 'Merge, split, organise, compress, images to PDF and back.', d: D.pdf },
  { key: 'wordpdf', group: 'Files', label: 'Word to PDF', desc: 'Turn a .docx into a clean PDF.', d: D.wordpdf },
  { key: 'pdfword', group: 'Files', label: 'PDF to Word', desc: 'Get the text of a PDF as an editable .docx.', d: D.pdfword },
  { key: 'text', group: 'Social and text', label: 'Text converter', desc: 'UPPER, lower, Title Case, slugs and word counts.', d: P.text },
  { key: 'fonts', group: 'Social and text', label: 'Fancy fonts', desc: 'Bold, script and more letters for your bio and captions.', d: D.fonts },
  { key: 'thumb', group: 'Social and text', label: 'YouTube thumbnail', desc: "Save any video's thumbnail in full HD.", d: D.thumb },
  { key: 'picker', group: 'Social and text', label: 'Giveaway picker', desc: 'Spin a wheel to pick fair winners from names or comments.', d: D.picker },
  { key: 'password', group: 'Social and text', label: 'Password generator', desc: 'Strong passwords you can read out and type.', d: P.password },
];
const DEFAULT: AppKey[] = ['upload', 'bio', 'focus', 'subs', 'smart', 'qr', 'ask', 'image', 'pdf'];
const MAX = 9;
const GROUPS = ['Publish', 'Everyday', 'Files', 'Social and text'];
/** Side-rail tools that are not one of the twenty, also opened full-page. */
const EXTRA = TOOLS.filter((t) => !t.admin && !['focus', 'links', 'qr', 'text', 'date', 'password', 'subs'].includes(t.key));
const FocusStudio = lazy(() => import('./apps/Focus').then((m) => ({ default: m.FocusStudio })));
const Subscriptions = lazy(() => import('./apps/Subscriptions').then((m) => ({ default: m.Subscriptions })));
const PdfTools = lazy(() => import('./apps/Pdf').then((m) => ({ default: m.PdfTools })));
const WordToPdf = lazy(() => import('./apps/Pdf').then((m) => ({ default: m.WordToPdf })));
const PdfToWord = lazy(() => import('./apps/Pdf').then((m) => ({ default: m.PdfToWord })));
const ImageConverter = lazy(() => import('./apps/Everyday').then((m) => ({ default: m.ImageConverter })));
const Currency = lazy(() => import('./apps/Everyday').then((m) => ({ default: m.Currency })));
const FancyFonts = lazy(() => import('./apps/Everyday').then((m) => ({ default: m.FancyFonts })));
const Thumbnails = lazy(() => import('./apps/Everyday').then((m) => ({ default: m.Thumbnails })));
const Picker = lazy(() => import('./apps/Everyday').then((m) => ({ default: m.Picker })));
const Emi = lazy(() => import('./apps/Everyday').then((m) => ({ default: m.Emi })));

const Svg = ({ d, size = 22 }: { d: string; size?: number }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const msg = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);
const pad = (n: number) => String(n).padStart(2, '0');
const hrefOf = (a: DashApp, username?: string | null) => (a.key === 'bio' ? `/${username ?? ''}` : a.to ?? `/home/${a.key}`);
const download = (href: string, name: string) => { const a = document.createElement('a'); a.href = href; a.download = name; a.click(); };

/* ---------------- pinned apps: the server list (max 9, ordered), shared by Home and All apps ---------------- */
function usePinned() {
  const toast = useToast();
  const [pins, setPins] = useState<AppKey[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [interests, setInterests] = useState<string[]>([]);
  const load = () => {
    get<{ ids: string[] | null; unread: { ask: number } }>('/api/home/apps').then((r) => {
      setPins((r.ids ?? []).filter((k): k is AppKey => DASH_APPS.some((a) => a.key === k))); setUnread(r.unread.ask);
    }, () => setPins([]));
    get<InterestState>('/api/home/interests').then((r) => setInterests(r.interests), () => {});
  };
  useEffect(() => { load(); addEventListener('jhino-home-apps', load); return () => removeEventListener('jhino-home-apps', load); }, []);
  const save = async (next: AppKey[]) => {
    const before = pins; setPins(next);
    try { await api('PUT', '/api/home/apps', { ids: next }); } catch (e) { setPins(before); toast(msg(e, 'Could not save your apps.'), true); }
  };
  const toggle = (k: AppKey) => {
    const cur = pins ?? [];
    if (!cur.includes(k) && cur.length >= MAX) { toast(`Home holds ${MAX} pins. Unpin one first.`, true); return; }
    save(cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]);
  };
  return { pins, unread, interests, save, toggle };
}
const PinIcon = ({ on }: { on: boolean }) => <svg viewBox="0 0 24 24" width="16" height="16" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M9 3h6l-1 6 4 3v2h-5v7l-1 1-1-1v-7H6v-2l4-3z" /></svg>;
const recentApps = () => getRecent().map((k) => DASH_APPS.find((a) => a.key === k)!).filter(Boolean);

function AppCard({ a, username, pinned, onPin, meta }: { a: DashApp; username?: string | null; pinned: boolean; onPin: () => void; meta?: string }) {
  return (
    <li className="ha-item">
      <Link to={hrefOf(a, username)} className="ha-card" onClick={() => noteRecent(a.key)}>
        <span className="ha-ic"><Svg d={a.d} /></span>
        <span className="ha-t"><b>{a.label}</b><small>{a.desc}</small></span>
        {meta && <span className={`ha-meta ${a.key === 'ask' ? 'hot' : ''}`}>{meta}</span>}
      </Link>
      <button className={`ha-pin ${pinned ? 'on' : ''}`} aria-pressed={pinned} aria-label={pinned ? `Unpin ${a.label}` : `Pin ${a.label}`} title={pinned ? 'Unpin' : 'Pin to Home'} onClick={onPin}><PinIcon on={pinned} /></button>
    </li>
  );
}

/* ---------------- the nine cards on Home: pinned, then recently used, then the ones that fit your interests ---------------- */
export function HomeApps() {
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  const { pins, unread, interests, save, toggle } = usePinned();
  const t = useTimer();
  const meta = (k: AppKey) => k === 'ask' && unread > 0 ? `${unread} new ${unread === 1 ? 'question' : 'questions'}`
    : k === 'focus' && t.running ? `${t.mode === 'work' ? 'Focus' : 'Break'} · ${pad(Math.floor(t.left / 60))}:${pad(t.left % 60)} left` : '';
  const shown = useMemo(() => {
    if (!pins) return [];
    const order = [...pins, ...getRecent(), ...appsForInterests(interests, MAX), ...DEFAULT];
    return [...new Set(order)].map((k) => DASH_APPS.find((a) => a.key === k)!).filter(Boolean).slice(0, MAX);
  }, [pins, interests]);
  return (
    <section className="ha" aria-labelledby="ha-h">
      <div className="ha-head">
        <h2 id="ha-h">Your apps</h2>
        <div className="ha-acts">
          <button className="btn sm quiet" onClick={() => setEditing(true)}><Icon name="settings" size={15} />Pins</button>
          <Link to="/home/all" className="btn sm">All apps<small className="mono">{DASH_APPS.length}</small></Link>
        </div>
      </div>
      {!pins ? <PanelLoader /> : (
        <ul className="ha-grid">{shown.map((a) => <AppCard key={a.key} a={a} username={user.username} pinned={pins.includes(a.key)} onPin={() => toggle(a.key)} meta={meta(a.key)} />)}</ul>
      )}
      {editing && pins && <ChooseApps current={pins} onClose={() => setEditing(false)} onSave={(n) => { save(n); setEditing(false); }} />}
    </section>
  );
}

function ChooseApps({ current, onClose, onSave }: { current: AppKey[]; onClose: () => void; onSave: (ids: AppKey[]) => void }) {
  const [pick, setPick] = useState<AppKey[]>(current);
  const flip = (k: AppKey) => setPick((p) => (p.includes(k) ? p.filter((x) => x !== k) : p.length >= MAX ? p : [...p, k]));
  const move = (k: AppKey, by: number) => setPick((p) => { const i = p.indexOf(k), j = i + by; if (j < 0 || j >= p.length) return p; const n = [...p]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  return (
    <Modal title="Pinned apps" onClose={onClose} footer={<>
      <button className="btn quiet" onClick={() => setPick([])}>Clear</button>
      <button className="btn primary" onClick={() => onSave(pick)}>Save</button>
    </>}>
      <div className="modal-body">
      <p className="hint">Pin up to nine and put them in the order you like. They come first on Home. <b className="mono">{pick.length}/{MAX}</b></p>
      <ul className="ha-pick">{DASH_APPS.map((a) => {
        const i = pick.indexOf(a.key), on = i >= 0;
        return (
          <li key={a.key} className={on ? 'on' : ''}>
            <button className="ha-pick-main" aria-pressed={on} disabled={!on && pick.length >= MAX} onClick={() => flip(a.key)}>
              <span className="ha-num mono">{on ? i + 1 : ''}</span>
              <span className="ha-ic sm"><Svg d={a.d} size={18} /></span>
              <span className="ha-t"><b>{a.label}</b><small>{a.desc}</small></span>
            </button>
            {on && <span className="ha-order">
              <button className="icon-btn" aria-label={`Move ${a.label} up`} disabled={i === 0} onClick={() => move(a.key, -1)}><Icon name="up" size={16} /></button>
              <button className="icon-btn" aria-label={`Move ${a.label} down`} disabled={i === pick.length - 1} onClick={() => move(a.key, 1)}><Icon name="down" size={16} /></button>
            </span>}
          </li>
        );
      })}</ul>
      </div>
    </Modal>
  );
}

/* ---------------- /home/all and /home/<key> ---------------- */
export function ToolsPage({ k }: { k: string }) {
  const { user } = useSession();
  const app = DASH_APPS.find((a) => a.key === k);
  const extra = EXTRA.find((t) => t.key === k);
  useEffect(() => { if (app) noteRecent(app.key); }, [app]);
  if (!app && !extra) return <AllApps username={user.username} />;
  return <ToolFrame k={k} app={app} extra={extra} />;
}
function ToolFrame({ k, app, extra }: { k: string; app?: DashApp; extra?: (typeof EXTRA)[number] }) {
  const label = app?.label ?? extra!.label, desc = app?.desc ?? extra!.desc, d = app?.d ?? P[k];
  const body: Record<string, ReactNode> = {
    upload: <UploadApp />, smart: <SmartLinks kind="smart" />, qr: <DynamicQr />, ask: <AskInbox />, text: <TextStudio />,
    focus: <FocusStudio />, subs: <Subscriptions />, image: <ImageConverter />, pdf: <PdfTools />, wordpdf: <WordToPdf />, pdfword: <PdfToWord />,
    currency: <Currency />, fonts: <FancyFonts />, thumb: <Thumbnails />, picker: <Picker />, emi: <Emi />,
    date: <Narrow><NepaliDate /></Narrow>, password: <Narrow><Passwords /></Narrow>,
    tasks: <Narrow><Tasks /></Narrow>, notes: <Narrow><Notes /></Narrow>,
    calendar: <Narrow><Calendar /></Narrow>, contacts: <Narrow><Contacts /></Narrow>, calc: <Narrow><Calculator /></Narrow>,
    clock: <Narrow><WorldClock /></Narrow>, json: <Narrow><JsonTool /></Narrow>, encode: <Narrow><Encoder /></Narrow>, colour: <Narrow><ColourTool /></Narrow>,
  };
  useEffect(() => { document.title = `${label} | Jhino`; }, [label]);
  return (
    <main className="page tp">
      <header className="tp-head">
        <Link to="/home/all" className="icon-btn" aria-label="All apps"><Icon name="back" size={18} /></Link>
        <span className="ha-ic"><Svg d={d} /></span>
        <div><h1>{label}</h1><p>{desc}</p></div>
      </header>
      <Suspense fallback={<PanelLoader />}>{body[k]}</Suspense>
    </main>
  );
}
const Narrow = ({ children }: { children: ReactNode }) => <div className="tp-narrow qt-body">{children}</div>;

function AllApps({ username }: { username?: string | null }) {
  useEffect(() => { document.title = 'All apps | Jhino'; }, []);
  const { pins, interests, toggle } = usePinned();
  const [q, setQ] = useState('');
  const { go } = useRoute();
  const box = useRef<HTMLInputElement>(null);
  const query = q.trim().toLowerCase();
  const fits = (a: DashApp) => !query || `${a.label} ${a.desc}`.toLowerCase().includes(query);
  const mine = new Set(appsForInterests(interests, 40));
  const byFit = (list: DashApp[]) => [...list].sort((x, y) => Number(mine.has(y.key)) - Number(mine.has(x.key)));
  const pinned = (pins ?? []).map((k) => DASH_APPS.find((a) => a.key === k)!).filter(Boolean);
  const recent = recentApps();
  const results = byFit(DASH_APPS.filter(fits));
  const extras = EXTRA.filter((t) => !query || `${t.label} ${t.desc}`.toLowerCase().includes(query));
  const grid = (list: DashApp[]) => (
    <ul className="ha-grid all">{list.map((a) => <AppCard key={a.key} a={a} username={username} pinned={!!pins?.includes(a.key)} onPin={() => toggle(a.key)} />)}</ul>
  );
  const sec = (title: string, list: DashApp[], note?: string) => list.length > 0 && (
    <section key={title} className="tp-group" aria-label={title}>
      <h2 className="tp-sub">{title}{note && <small>{note}</small>}</h2>
      {grid(list)}
    </section>
  );
  return (
    <main className="page tp">
      <div className="tp-head">
        <Link to="/home" className="icon-btn" aria-label="Home"><Icon name="back" size={18} /></Link>
        <div><h1>All apps</h1><p>Pin up to nine to keep them first on Home.</p></div>
      </div>
      <form className="tp-find" role="search" onSubmit={(e) => { e.preventDefault(); const f = results[0]; if (f) { noteRecent(f.key); go(hrefOf(f, username)); } }}>
        <Icon name="search" size={16} />
        <input ref={box} className="input" type="search" value={q} placeholder="Search apps" aria-label="Search apps" autoComplete="off" enterKeyHint="go"
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.preventDefault(); setQ(''); } }} />
      </form>
      {query ? (
        <>
          {sec(`${results.length} ${results.length === 1 ? 'result' : 'results'}`, results)}
          {extras.length > 0 && <MoreTools list={extras} />}
          {!results.length && !extras.length && <p className="tp-empty">No app matches "{q.trim()}". <button className="link" onClick={() => { setQ(''); box.current?.focus(); }}>Clear search</button></p>}
        </>
      ) : (
        <>
          {sec('Pinned', pinned, `${pinned.length} of ${MAX}`)}
          {sec('Recently used', recent)}
          {GROUPS.map((g) => sec(g, byFit(DASH_APPS.filter((a) => a.group === g))))}
          <MoreTools list={EXTRA} />
        </>
      )}
    </main>
  );
}
function MoreTools({ list }: { list: typeof EXTRA }) {
  return (
    <section className="tp-group" aria-label="More tools">
      <h2 className="tp-sub">More tools</h2>
      <ul className="tp-list">{list.map((t) => (
        <li key={t.key}><Link to={`/home/${t.key}`}><span className="ha-ic sm"><Svg d={P[t.key]} size={18} /></span><span className="ha-t"><b>{t.label}</b><small>{t.desc}</small></span></Link></li>
      ))}</ul>
    </section>
  );
}

/* ---------------- upload ---------------- */
function UploadApp() {
  const [file, setFile] = useState<File | null | undefined>(undefined);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const take = (f?: File | null) => { if (f) setFile(f); };
  return (
    <div className="tp-upload">
      <button className={`tp-drop ${over ? 'over' : ''}`} onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); }}>
        <Svg d={D.upload} size={30} />
        <b>Drop an .html or .zip file here</b>
        <span>or click to choose one. It goes live right away at your own address, and anything people add inside it is saved for everyone.</span>
      </button>
      <input ref={input} type="file" accept=".html,.htm,.zip,text/html,application/zip" hidden onChange={(e) => take(e.target.files?.[0])} />
      <div className="tp-steps">
        <div><b className="mono">1</b><span>Upload your file. A ZIP can hold a whole site: pages, images, scripts.</span></div>
        <div><b className="mono">2</b><span>Pick its address, like jhino.com/you/menu.</span></div>
        <div><b className="mono">3</b><span>Share a link, or give a client a sign-in. Both of you see the same data, live.</span></div>
      </div>
      <p className="hint">No file yet? <Link to="/build" className="link">Create an app</Link> from ready-made parts instead.</p>
      {file !== undefined && <UploadDialog file={file} onClose={() => setFile(undefined)} />}
    </div>
  );
}

/* ---------------- smart links + dynamic QR (server/mini.ts) ---------------- */
interface Smart { id: string; code: string; kind: 'smart' | 'qr'; title: string; url: string; ios: string; android: string; windows: string; mac: string; short: string; clicks: number; byDevice: { ios: number; android: number; desktop: number }; lastClickAt: string | null; disabled: boolean; createdAt: string }
function useSmart(kind: 'smart' | 'qr') {
  const toast = useToast();
  const [list, setList] = useState<Smart[] | null>(null);
  useEffect(() => { get<{ links: Smart[] }>('/api/smart').then((r) => setList(r.links.filter((l) => l.kind === kind)), (e) => { toast(msg(e, 'Could not load.'), true); setList([]); }); }, [kind, toast]);
  const add = async (b: Record<string, unknown>) => { try { const r = await post<{ link: Smart }>('/api/smart', { ...b, kind }); setList((l) => [r.link, ...(l ?? [])]); return r.link; } catch (e) { toast(msg(e, 'Could not save.'), true); return null; } };
  const save = async (id: string, b: Record<string, unknown>) => { try { const r = await api<{ link: Smart }>('PATCH', `/api/smart/${id}`, b); setList((l) => (l ?? []).map((x) => (x.id === id ? r.link : x))); return r.link; } catch (e) { toast(msg(e, 'Could not save.'), true); return null; } };
  const remove = async (id: string) => { if (!confirm('Delete this? Anyone who opens it after will see "not found".')) return; try { await api('DELETE', `/api/smart/${id}`); setList((l) => (l ?? []).filter((x) => x.id !== id)); } catch (e) { toast(msg(e, 'Could not delete.'), true); } };
  return { list, add, save, remove };
}
const EMPTY = { title: '', url: '', ios: '', android: '', windows: '', mac: '' };
function SmartForm({ init, onSubmit, onCancel, more: startMore = false }: { init?: typeof EMPTY; onSubmit: (f: typeof EMPTY) => Promise<unknown>; onCancel?: () => void; more?: boolean }) {
  const [f, setF] = useState(init ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(startMore || !!(init?.windows || init?.mac));
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="tp-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const ok = await onSubmit(f); setBusy(false); if (ok && !init) setF(EMPTY); }}>
      <label className="field"><span>Name <em>only you see it</em></span><input className="input" maxLength={120} value={f.title} onChange={set('title')} placeholder="Our app download" /></label>
      <div className="grid2">
        <label className="field"><span>iPhone and iPad</span><input className="input" inputMode="url" value={f.ios} onChange={set('ios')} placeholder="https://apps.apple.com/…" /></label>
        <label className="field"><span>Android</span><input className="input" inputMode="url" value={f.android} onChange={set('android')} placeholder="https://play.google.com/…" /></label>
      </div>
      {more && <div className="grid2">
        <label className="field"><span>Windows</span><input className="input" inputMode="url" value={f.windows} onChange={set('windows')} placeholder="https://… (optional)" /></label>
        <label className="field"><span>Mac</span><input className="input" inputMode="url" value={f.mac} onChange={set('mac')} placeholder="https://… (optional)" /></label>
      </div>}
      <label className="field"><span>Everyone else</span><input className="input" inputMode="url" required value={f.url} onChange={set('url')} placeholder="https://your-site.com" /></label>
      <div className="actions-row">
        <button className="btn primary" disabled={busy}>{busy && <span className="spin" />}{init ? 'Save' : 'Create smart link'}</button>
        {!more && <button type="button" className="btn quiet" onClick={() => setMore(true)}>Add Windows and Mac</button>}
        {onCancel && <button type="button" className="btn quiet" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
function Devices({ l }: { l: Smart }) {
  const tot = Math.max(1, l.clicks);
  return (
    <div className="tp-dev" aria-label="Opens by device">
      {([['iPhone', l.byDevice.ios], ['Android', l.byDevice.android], ['Computer', l.byDevice.desktop]] as [string, number][]).map(([n, v]) => (
        <span key={n}><i style={{ transform: `scaleX(${v / tot})` }} /><small>{n}</small><b className="mono">{v}</b></span>
      ))}
    </div>
  );
}
function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <button className="btn sm" onClick={async () => { if (await copyText(text)) { setDone(true); setTimeout(() => setDone(false), 1400); } }}><Icon name={done ? 'check' : 'copy'} size={15} />{done ? 'Copied' : label}</button>;
}
function AddToPage({ title, url }: { title: string; url: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return <button className="btn sm quiet" disabled={done} onClick={async () => {
    try { await post('/api/me/page/items', { type: 'link', title, url, subtitle: '' }); setDone(true); toast('Added to your page.'); } catch (e) { toast(msg(e, 'Could not add it.'), true); }
  }}><Icon name={done ? 'check' : 'plus'} size={15} />{done ? 'On your page' : 'Add to my page'}</button>;
}

function SmartLinks({ kind }: { kind: 'smart' }) {
  const { list, add, save, remove } = useSmart(kind);
  const [edit, setEdit] = useState<string | null>(null);
  const [qr, setQr] = useState<Smart | null>(null);
  return (
    <div className="tp-split">
      <section className="tp-card">
        <h2>New smart link</h2>
        <p className="hint">Share one link everywhere. We look at the visitor's phone or computer and send them to the right store or page.</p>
        <SmartForm onSubmit={(f) => add(f)} />
      </section>
      <section>
        {!list ? <PanelLoader /> : !list.length ? <p className="tp-empty">Your smart links show here, with how many people opened them from each kind of device.</p> : (
          <ul className="tp-items">{list.map((l) => (
            <li key={l.id} className={`tp-card ${l.disabled ? 'off' : ''}`}>
              {edit === l.id ? <SmartForm init={{ title: l.title, url: l.url, ios: l.ios, android: l.android, windows: l.windows, mac: l.mac }} onCancel={() => setEdit(null)} onSubmit={async (f) => { const r = await save(l.id, f); if (r) setEdit(null); return r; }} /> : <>
                <div className="tp-row"><b className="tp-title">{l.title || 'Smart link'}</b><span className="tp-count mono">{l.clicks}<small> opens</small></span></div>
                <a className="tp-short mono" href={l.short} target="_blank" rel="noopener">{l.short.replace(/^https?:\/\//, '')}</a>
                <dl className="tp-targets">
                  {l.ios && <><dt>iPhone</dt><dd>{l.ios}</dd></>}
                  {l.android && <><dt>Android</dt><dd>{l.android}</dd></>}
                  {l.windows && <><dt>Windows</dt><dd>{l.windows}</dd></>}
                  {l.mac && <><dt>Mac</dt><dd>{l.mac}</dd></>}
                  <dt>Others</dt><dd>{l.url}</dd>
                </dl>
                <Devices l={l} />
                <div className="actions-row">
                  <CopyBtn text={l.short} />
                  <button className="btn sm" onClick={() => setQr(l)}><Icon name="qr" size={15} />QR</button>
                  <button className="btn sm quiet" onClick={() => setEdit(l.id)}>Edit</button>
                  <AddToPage title={l.title || 'Get the app'} url={l.short} />
                  <button className="btn sm quiet" onClick={() => save(l.id, { disabled: !l.disabled })}>{l.disabled ? 'Turn on' : 'Turn off'}</button>
                  <button className="btn sm quiet danger" onClick={() => remove(l.id)}>Delete</button>
                </div>
              </>}
            </li>
          ))}</ul>
        )}
      </section>
      {qr && <Modal title={qr.title || 'QR code'} onClose={() => setQr(null)}><div className="modal-body"><QrCard text={qr.short} name={qr.code} /></div></Modal>}
    </div>
  );
}

function QrCard({ text, name, big }: { text: string; name: string; big?: boolean }) {
  const [fg, setFg] = useState('#141414'), [bg, setBg] = useState('#ffffff');
  const [logo, setLogo] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const svg = () => wrap.current?.querySelector('svg')?.outerHTML ?? '';
  return (
    <div className="tp-qr">
      <div ref={wrap} className="tp-qr-img"><QrSvg text={text} fg={fg} bg={bg} size={big ? 200 : 240} logo={logo} /></div>
      <div className="tp-qr-side">
        <div className="qt-row">
          <label className="field sm"><span>Colour</span><input type="color" value={fg} onChange={(e) => setFg(e.target.value)} /></label>
          <label className="field sm"><span>Background</span><input type="color" value={bg} onChange={(e) => setBg(e.target.value)} /></label>
        </div>
        <QrLogoField logo={logo} setLogo={setLogo} />
        <div className="actions-row">
          <button className="btn sm" onClick={() => download(URL.createObjectURL(new Blob([svg()], { type: 'image/svg+xml' })), `qr-${name}.svg`)}><Icon name="download" size={15} />SVG</button>
          <button className="btn sm" onClick={() => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 1200; c.getContext('2d')!.drawImage(img, 0, 0, 1200, 1200); download(c.toDataURL('image/png'), `qr-${name}.png`); }; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg()); }}><Icon name="download" size={15} />PNG</button>
        </div>
      </div>
    </div>
  );
}

function DynamicQr() {
  const { list, add, save, remove } = useSmart('qr');
  const [tab, setTab] = useState<'dynamic' | 'static'>('dynamic');
  const [f, setF] = useState({ title: '', url: '' });
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ id: string; url: string } | null>(null);
  return (
    <>
      <div className="tp-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'dynamic'} onClick={() => setTab('dynamic')}>Dynamic</button>
        <button role="tab" aria-selected={tab === 'static'} onClick={() => setTab('static')}>Plain</button>
      </div>
      {tab === 'static' ? <div className="tp-narrow qt-body"><QrMaker templates /></div> : (
        <div className="tp-split">
          <section className="tp-card">
            <h2>New dynamic QR</h2>
            <p className="hint">The code points at a jhino.com/l/ address, so you can change where it goes after it is printed on menus, cards or posters. Scans are counted.</p>
            <form className="tp-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await add(f); setBusy(false); if (r) setF({ title: '', url: '' }); }}>
              <label className="field"><span>Name</span><input className="input" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Table menu" /></label>
              <label className="field"><span>Opens</span><input className="input" inputMode="url" required value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" /></label>
              <button className="btn primary" disabled={busy}>{busy && <span className="spin" />}Create QR</button>
            </form>
          </section>
          <section>
            {!list ? <PanelLoader /> : !list.length ? <p className="tp-empty">Your QR codes show here. Download them as PNG or SVG, and change where they lead any time.</p> : (
              <ul className="tp-items">{list.map((l) => (
                <li key={l.id} className={`tp-card ${l.disabled ? 'off' : ''}`}>
                  <div className="tp-row"><b className="tp-title">{l.title || 'QR code'}</b><span className="tp-count mono">{l.clicks}<small> scans</small></span></div>
                  <QrCard text={l.short} name={l.code} big />
                  {edit?.id === l.id ? (
                    <form className="tp-inline" onSubmit={async (e) => { e.preventDefault(); if (await save(l.id, { url: edit.url })) setEdit(null); }}>
                      <input className="input" inputMode="url" required autoFocus value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value })} />
                      <button className="btn sm primary">Save</button><button type="button" className="btn sm quiet" onClick={() => setEdit(null)}>Cancel</button>
                    </form>
                  ) : <p className="tp-dest">Opens <a href={l.url} target="_blank" rel="noopener noreferrer">{l.url}</a> <button className="link" onClick={() => setEdit({ id: l.id, url: l.url })}>Change</button></p>}
                  <p className="hint">{l.lastClickAt ? `Last scanned ${ago(l.lastClickAt)}` : 'Not scanned yet'} · {l.short.replace(/^https?:\/\//, '')}</p>
                  <div className="actions-row">
                    <CopyBtn text={l.short} label="Copy link" />
                    <button className="btn sm quiet" onClick={() => save(l.id, { disabled: !l.disabled })}>{l.disabled ? 'Turn on' : 'Pause'}</button>
                    <button className="btn sm quiet danger" onClick={() => remove(l.id)}>Delete</button>
                  </div>
                </li>
              ))}</ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}

/* ---------------- ask me anything ---------------- */
interface Q { id: string; body: string; answer: string; answeredAt: string | null; public: boolean; pinned: boolean; seen: boolean; createdAt: string }
function AskInbox() {
  const toast = useToast();
  const [d, setD] = useState<{ questions: Q[]; settings: { enabled: boolean; prompt: string; theme: string }; username: string | null } | null>(null);
  const [tab, setTab] = useState<'new' | 'answered'>('new');
  const [prompt, setPrompt] = useState('');
  useEffect(() => { get<NonNullable<typeof d>>('/api/my/ask').then((r) => { setD(r); setPrompt(r.settings.prompt); }, (e) => toast(msg(e, 'Could not load.'), true)); }, [toast]);
  if (!d) return <PanelLoader />;
  const link = `${location.origin}/${d.username}/ask`;
  const setS = async (b: Record<string, unknown>) => { try { const r = await api<{ settings: typeof d.settings }>('PUT', '/api/my/ask-settings', b); setD({ ...d, settings: r.settings }); toast('Saved.'); } catch (e) { toast(msg(e, 'Could not save.'), true); } };
  const patch = async (id: string, b: Record<string, unknown>) => { try { const r = await api<{ question: Q }>('PATCH', `/api/my/ask/${id}`, b); setD((x) => x && { ...x, questions: x.questions.map((q) => (q.id === id ? { ...r.question, seen: q.seen } : q)) }); return true; } catch (e) { toast(msg(e, 'Could not save.'), true); return false; } };
  const del = async (id: string) => { try { await api('DELETE', `/api/my/ask/${id}`); setD((x) => x && { ...x, questions: x.questions.filter((q) => q.id !== id) }); } catch (e) { toast(msg(e, 'Could not delete.'), true); } };
  const open = d.questions.filter((q) => !q.answer), done = d.questions.filter((q) => q.answer);
  const shown = tab === 'new' ? open : done;
  if (!d.username) return <p className="tp-empty">Pick a username in Account first: your question page lives at jhino.com/&lt;username&gt;/ask.</p>;
  return (
    <div className="tp-split ask">
      <section className="tp-card tp-sticky">
        <h2>Your question link</h2>
        <a className="tp-short mono" href={link} target="_blank" rel="noopener">{link.replace(/^https?:\/\//, '')}</a>
        <div className="actions-row">
          <CopyBtn text={link} />
          {'share' in navigator && <button className="btn sm" onClick={() => navigator.share({ title: d.settings.prompt, url: link }).catch(() => {})}>Share</button>}
          <AddToPage title={d.settings.prompt} url={link} />
        </div>
        <p className="hint">Put it in your Instagram or TikTok bio or story. People ask without signing in, and you never see who they are.</p>
        <form className="tp-inline" onSubmit={(e) => { e.preventDefault(); setS({ prompt }); }}>
          <input className="input" maxLength={120} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="What your page asks" />
          <button className="btn sm" disabled={prompt === d.settings.prompt}>Save</button>
        </form>
        <div className="ask-themes" role="group" aria-label="Page theme">
          <span className="ask-themes-l">Page theme</span>
          {ASK_THEMES.map((t) => <button key={t.id} type="button" className="ask-swatch" style={{ background: t.bg }} aria-label={t.name} title={t.name} aria-pressed={d.settings.theme === t.id} onClick={() => d.settings.theme !== t.id && setS({ theme: t.id })} />)}
        </div>
        <label className="tp-toggle"><input type="checkbox" checked={d.settings.enabled} onChange={(e) => setS({ enabled: e.target.checked })} /><i aria-hidden="true" /><span>{d.settings.enabled ? 'Taking questions' : 'Paused: new questions are turned away'}</span></label>
      </section>
      <section>
        <div className="tp-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'new'} onClick={() => setTab('new')}>To answer <small className="mono">{open.length}</small></button>
          <button role="tab" aria-selected={tab === 'answered'} onClick={() => setTab('answered')}>Answered <small className="mono">{done.length}</small></button>
        </div>
        {!shown.length ? <p className="tp-empty">{tab === 'new' ? 'No questions waiting. Share your link to get some.' : 'Answers you post show on your question page for everyone.'}</p> : (
          <ul className="tp-items">{shown.map((q) => <Question key={q.id} q={q} username={d.username!} theme={d.settings.theme} patch={patch} del={del} />)}</ul>
        )}
      </section>
    </div>
  );
}
function Question({ q, username, theme, patch, del }: { q: Q; username: string; theme: string; patch: (id: string, b: Record<string, unknown>) => Promise<boolean>; del: (id: string) => void }) {
  const [a, setA] = useState(q.answer);
  const [editing, setEditing] = useState(!q.answer);
  return (
    <li className="tp-card tp-q">
      <div className="tp-row"><span className="tp-bubble">{q.body}</span>{!q.seen && <span className="ix-new">New</span>}</div>
      <small className="hint">{ago(q.createdAt)}{q.answer && !q.public ? ' · private answer' : ''}{q.pinned ? ' · pinned' : ''}</small>
      {editing ? (
        <form className="tp-form" onSubmit={async (e) => { e.preventDefault(); if (await patch(q.id, { answer: a, public: true })) setEditing(false); }}>
          <textarea className="textarea" rows={3} maxLength={2000} value={a} onChange={(e) => setA(e.target.value)} placeholder="Your answer" />
          <div className="actions-row">
            <button className="btn sm primary" disabled={!a.trim()}>Post answer</button>
            <button type="button" className="btn sm quiet" disabled={!a.trim()} onClick={async () => { if (await patch(q.id, { answer: a, public: false })) setEditing(false); }}>Answer privately</button>
            <button type="button" className="btn sm quiet" onClick={() => storyImage(q.body, username, undefined, theme)}><Icon name="image" size={15} />Story image</button>
            {q.answer && <button type="button" className="btn sm quiet" onClick={() => { setA(q.answer); setEditing(false); }}>Cancel</button>}
            <button type="button" className="btn sm quiet danger" onClick={() => del(q.id)}>Delete</button>
          </div>
        </form>
      ) : <>
        <p className="tp-answer">{q.answer}</p>
        <div className="actions-row">
          <button className="btn sm quiet" onClick={() => setEditing(true)}>Edit</button>
          <button className="btn sm quiet" onClick={() => patch(q.id, { pinned: !q.pinned })}>{q.pinned ? 'Unpin' : 'Pin'}</button>
          <button className="btn sm quiet" onClick={() => patch(q.id, { public: !q.public })}>{q.public ? 'Hide from page' : 'Show on page'}</button>
          <button className="btn sm quiet" onClick={() => storyImage(q.body, username, q.answer, theme)}><Icon name="image" size={15} />Story image</button>
          <button className="btn sm quiet danger" onClick={() => del(q.id)}>Delete</button>
        </div>
      </>}
    </li>
  );
}
/** A 1080×1920 picture of the question (and answer) to post as a story. */
function storyImage(question: string, username: string, answer?: string, themeId?: string) {
  const t = askTheme(themeId);
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
  const x = c.getContext('2d')!;
  const font = getComputedStyle(document.body).fontFamily;
  x.fillStyle = t.bg; x.fillRect(0, 0, 1080, 1920);
  x.fillStyle = t.ink; x.globalAlpha = 0.09;
  for (const [cx, cy, r] of [[1000, 160, 340], [60, 1700, 420], [900, 1500, 160]]) { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); }
  x.globalAlpha = 1;
  const wrap = (s: string, size: number, weight: number, max: number) => { x.font = `${weight} ${size}px ${font}`; const out: string[] = []; for (const para of s.split('\n')) { let line = ''; for (const w of para.split(/\s+/)) { const tt = line ? `${line} ${w}` : w; if (x.measureText(tt).width > max && line) { out.push(line); line = w; } else line = tt; } out.push(line); } return out.slice(0, 12); };
  const q = wrap(question, 68, 700, 800), an = answer ? wrap(answer, 50, 400, 800) : [];
  const h = 210 + q.length * 84 + (an.length ? 90 + an.length * 66 : 0) + 40;
  const top = Math.max(250, (1920 - h) / 2 - 60);
  x.save(); x.shadowColor = 'rgba(0,0,0,0.28)'; x.shadowBlur = 60; x.shadowOffsetY = 24;
  x.fillStyle = '#ffffff'; x.beginPath(); x.roundRect(90, top, 900, h, 48); x.fill(); x.restore();
  x.fillStyle = t.btn; x.beginPath(); x.roundRect(90, top, 900, 120, [48, 48, 0, 0]); x.fill();
  x.fillStyle = t.btnInk; x.font = `700 42px ${font}`; x.textAlign = 'left'; x.fillText('Anonymous question', 140, top + 76);
  x.textAlign = 'right'; x.font = `500 36px ${font}`; x.fillText(`@${username}`, 940, top + 74); x.textAlign = 'left';
  x.fillStyle = '#141414'; x.font = `700 68px ${font}`; q.forEach((l, i) => x.fillText(l, 140, top + 235 + i * 84));
  if (an.length) {
    const ay = top + 235 + (q.length - 1) * 84 + 60;
    x.fillStyle = t.btn; x.fillRect(140, ay, 64, 8);
    x.fillStyle = '#3a3936'; x.font = `400 50px ${font}`; an.forEach((l, i) => x.fillText(l, 140, ay + 80 + i * 66));
  }
  const url = `${location.host}/${username}/ask`;
  x.font = `700 44px ${font}`; const pw = Math.min(940, x.measureText(url).width + 100);
  x.fillStyle = '#ffffff'; x.beginPath(); x.roundRect(540 - pw / 2, 1920 - 300, pw, 96, 48); x.fill();
  x.fillStyle = '#141414'; x.textAlign = 'center'; x.fillText(url, 540, 1920 - 300 + 62);
  x.fillStyle = t.ink; x.font = `500 38px ${font}`; x.fillText('Send me an anonymous question', 540, 1920 - 140);
  download(c.toDataURL('image/png'), 'question.png');
}

/* ---------------- text converter (browser only) ---------------- */
const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const CASES: [string, (s: string) => string][] = [
  ['UPPER CASE', (s) => s.toUpperCase()],
  ['lower case', (s) => s.toLowerCase()],
  ['Title Case', (s) => s.toLowerCase().replace(/(^|[\s\-_/(])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase())],
  ['Sentence case', (s) => s.toLowerCase().replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu, (m) => m.toUpperCase())],
  ['aLtErNaTe', (s) => [...s].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join('')],
  ['iNVERSE', (s) => [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('')],
  ['camelCase', (s) => words(s).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('')],
  ['PascalCase', (s) => words(s).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('')],
  ['snake_case', (s) => words(s).map((w) => w.toLowerCase()).join('_')],
  ['kebab-case', (s) => words(s).map((w) => w.toLowerCase()).join('-')],
  ['CONSTANT_CASE', (s) => words(s).map((w) => w.toUpperCase()).join('_')],
  ['url-slug', (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, '-').replace(/^-+|-+$/g, '')],
];
const CLEAN: [string, (s: string) => string][] = [
  ['Trim extra spaces', (s) => s.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')],
  ['Remove line breaks', (s) => s.replace(/\s*\n+\s*/g, ' ').trim()],
  ['Remove empty lines', (s) => s.split('\n').filter((l) => l.trim()).join('\n')],
  ['Sort lines A–Z', (s) => s.split('\n').sort((a, b) => a.localeCompare(b)).join('\n')],
  ['Remove duplicate lines', (s) => [...new Set(s.split('\n'))].join('\n')],
  ['Reverse text', (s) => [...s].reverse().join('')],
  ['Strip HTML tags', (s) => s.replace(/<[^>]*>/g, '')],
];
function TextStudio() {
  const [text, setText] = useState(() => { try { return localStorage.getItem('jhino-text') ?? ''; } catch { return ''; } });
  const [undo, setUndo] = useState<string[]>([]);
  useEffect(() => { const id = setTimeout(() => { try { localStorage.setItem('jhino-text', text.slice(0, 100000)); } catch { /* private mode */ } }, 400); return () => clearTimeout(id); }, [text]);
  const apply = (f: (s: string) => string) => { if (!text) return; setUndo((u) => [...u.slice(-30), text]); setText(f(text)); };
  const stats = useMemo(() => {
    const w = text.trim() ? text.trim().split(/\s+/).length : 0;
    return [['Characters', text.length], ['Without spaces', text.replace(/\s/g, '').length], ['Words', w], ['Sentences', (text.match(/[^.!?\n]+[.!?]+/g) ?? []).length || (text.trim() ? 1 : 0)], ['Lines', text ? text.split('\n').length : 0], ['Reading time', `${Math.max(w ? 1 : 0, Math.round(w / 220))} min`]] as [string, number | string][];
  }, [text]);
  return (
    <div className="tp-text">
      <section className="tp-card">
        <textarea className="textarea tp-area" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type or paste text here. It stays in this browser: nothing is sent anywhere." aria-label="Text" />
        <div className="tp-stats">{stats.map(([k, v]) => <span key={k}><b className="mono">{typeof v === 'number' ? v.toLocaleString() : v}</b><small>{k}</small></span>)}</div>
        <div className="actions-row">
          <CopyBtn text={text} />
          <button className="btn sm quiet" disabled={!undo.length} onClick={() => { setText(undo[undo.length - 1]); setUndo((u) => u.slice(0, -1)); }}>Undo</button>
          <button className="btn sm quiet" disabled={!text} onClick={() => { setUndo((u) => [...u, text]); setText(''); }}>Clear</button>
          <button className="btn sm quiet" disabled={!text} onClick={() => download(URL.createObjectURL(new Blob([text], { type: 'text/plain' })), 'text.txt')}>Download .txt</button>
        </div>
      </section>
      <aside className="tp-card">
        <h2>Change case</h2>
        <div className="tp-chips">{CASES.map(([n, f]) => <button key={n} className="chip" disabled={!text} onClick={() => apply(f)}>{n}</button>)}</div>
        <h2>Clean up</h2>
        <div className="tp-chips">{CLEAN.map(([n, f]) => <button key={n} className="chip" disabled={!text} onClick={() => apply(f)}>{n}</button>)}</div>
      </aside>
    </div>
  );
}
