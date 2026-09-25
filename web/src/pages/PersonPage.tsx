import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ApiError, api, get, post, type User } from '../api';
import { Link, useSession } from '../context';
import { Icon, Select, copyText, useToast } from '../ui';
import { Shell } from './Shell';
import { PublicApp } from './PublicApp';
import { PlanTag } from './Address';
import { ProfileView } from '../profile/ProfileView';
import { PortfolioView, PALETTES } from '../profile/PortfolioView';
import { ThemeThumb } from '../profile/ThemeThumb';
import { THEMES, canUseTheme } from '../profile/themes';
import type { Home, ProfileData, Service, SocialKind, Stat, Tier } from '../profile/types';

/*
 * jhino.com/<username>, /links and /profile. Visitors see the person's pages. The owner sees the
 * studio console: the links page and the profile page, each with its content and its design, a live
 * device preview, analytics and settings. Changes save as you go.
 */

interface PublicResp { profile: ProfileData; owner: boolean; custom: boolean; published: boolean }

export function PersonPage({ name, user, view }: { name: string; user: User | null; view?: Home }) {
  const [d, setD] = useState<PublicResp | null | 'none'>(null);
  useEffect(() => {
    setD(null);
    get<PublicResp>(`/api/profile/${encodeURIComponent(name)}`).then(setD, () => setD('none'));
  }, [name]);
  if (d === null) return <main className="state-card" aria-busy="true"><span className="spin" /></main>;
  // Not a person: a top-level address (made by a super admin, or before usernames).
  if (d === 'none') return view ? <main className="state-card"><h2>Nothing here</h2><p>This page does not exist.</p></main> : <PublicApp refId={name} signedInUser={user} />;
  if (d.owner && user && !view) return <Shell><Console /></Shell>;
  return <PublicPage d={d} view={view ?? d.profile.home} />;
}

/* ---------------- what visitors see ---------------- */
function PublicPage({ d, view }: { d: PublicResp; view: Home }) {
  useEffect(() => {
    document.title = `${d.profile.name} (@${d.profile.username}) · Jhino`;
    post(`/api/profile/${encodeURIComponent(d.profile.username)}/hit`, { ref: document.referrer || '', view }).catch(() => {});
    return () => { document.title = 'Jhino'; };
  }, [d, view]);
  if (view === 'profile') return <PortfolioView data={d.profile} />;
  if (d.custom) {
    return <iframe className="pf-custom" title={`${d.profile.name} on Jhino`} src={`/p/${encodeURIComponent(d.profile.username)}/custom`}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-forms" />;
  }
  return <ProfileView data={d.profile} />;
}

/* ---------------- the owner's console ---------------- */
interface ItemT { id: string; type: 'link' | 'header' | 'text' | 'video' | 'app'; title: string; subtitle: string; url: string | null; text: string | null; appId: string | null; highlight: boolean; visible: boolean; clicks30: number }
interface EditorT {
  username: string; page: ProfileData;
  settings: { bio: string; location: string; theme: string; home: Home; socials: { kind: SocialKind; url: string }[]; published: boolean; customHtml: string; useCustom: boolean };
  items: ItemT[]; features: { themeTier: Tier; branding: string; customPage: boolean; analyticsDays: number; workImages: number };
  apps: { id: string; name: string; slug: string | null; access: string }[]; starter: string;
}
type Tab = 'links' | 'profile' | 'analytics' | 'settings';
type Mode = 'content' | 'design';

/** Saving state for the header: every change goes through here. */
interface Saver { save: (p: Promise<EditorT>, ok?: string) => Promise<boolean>; d: EditorT }
const SaverCtx = createContext<Saver>(null as unknown as Saver);
const useSaver = () => useContext(SaverCtx);

function Console() {
  const toast = useToast();
  const [d, setD] = useState<EditorT | null>(null);
  const q = new URLSearchParams(location.search);
  const [tab, setTab] = useState<Tab>(() => (['links', 'profile', 'analytics', 'settings'].includes(q.get('tab') ?? '') ? q.get('tab') as Tab : 'links'));
  const [mode, setMode] = useState<Mode>(() => (q.get('mode') === 'design' ? 'design' : 'content'));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const load = useCallback(() => get<EditorT>('/api/me/page').then(setD, (e) => toast(e instanceof ApiError ? e.message : 'Could not load your pages.', true)), [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { document.title = 'Your pages · Jhino'; }, []);
  // The address remembers the place, and stays plain (/<username>) on the first one.
  useEffect(() => {
    const q = tab === 'links' && mode === 'content' ? '' : `?tab=${tab}${tab === 'links' || tab === 'profile' ? `&mode=${mode}` : ''}`;
    history.replaceState(null, '', location.pathname + q);
  }, [tab, mode]);
  const save = useCallback(async (p: Promise<EditorT>, ok?: string) => {
    setState('saving');
    try { setD(await p); setState('saved'); if (ok) toast(ok); return true; }
    catch (e) { setState('error'); toast(e instanceof ApiError ? e.message : 'Could not save.', true); return false; }
  }, [toast]);
  if (!d) return <main className="page"><div className="acc-skel" /></main>;
  const host = `${location.host}/${d.username}`;
  return (
    <SaverCtx.Provider value={{ save, d }}>
      <main className="page cs">
        <header className="cs-top">
          <div className="cs-title">
            <h1>Your pages</h1>
            <p className="cs-sub">
              <a href={`/${d.username}`} target="_blank" rel="noopener" className="mono">{host}</a>
              <span className="muted">opens your {d.settings.home === 'profile' ? 'profile' : 'links'} page</span>
            </p>
          </div>
          <span className={`cs-state mono ${state}`} aria-live="polite">{state === 'saving' ? 'Saving…' : state === 'saved' ? 'All changes saved' : state === 'error' ? 'Not saved' : ''}</span>
        </header>
        <nav className="cs-tabs" aria-label="Your pages">
          {([['links', 'Links page'], ['profile', 'Profile page'], ['analytics', 'Analytics'], ['settings', 'Settings']] as const).map(([k, l]) => (
            <button key={k} aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l}</button>
          ))}
        </nav>

        {tab === 'analytics' ? <AnalyticsTab /> : tab === 'settings' ? <SettingsTab /> : (
          <div className="cs-grid">
            <section className="cs-edit">
              <div className="cs-mode" role="tablist" aria-label="Edit">
                {(['content', 'design'] as const).map((m) => <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>{m === 'content' ? 'Content' : tab === 'links' ? 'Design' : 'Style'}</button>)}
                <a className="btn sm cs-open" href={`/${d.username}/${tab}`} target="_blank" rel="noopener"><Icon name="external" size={14} />Open page</a>
              </div>
              {tab === 'links' && mode === 'content' && <LinksContent />}
              {tab === 'links' && mode === 'design' && <LinksDesign />}
              {tab === 'profile' && mode === 'content' && <ProfileContent />}
              {tab === 'profile' && mode === 'design' && <ProfileStyle />}
            </section>
            <Preview which={tab === 'profile' ? 'profile' : 'links'} />
          </div>
        )}
      </main>
    </SaverCtx.Provider>
  );
}

/* ---------- the live preview: a phone for the links page; phone or desktop for the profile ---------- */
function Preview({ which }: { which: Home }) {
  const { d } = useSaver();
  const [device, setDevice] = useState<'phone' | 'desktop'>('phone');
  const [open, setOpen] = useState(false); // on small screens the preview folds away under the editor's tabs
  const dev = which === 'links' ? 'phone' : device;
  const custom = which === 'links' && d.settings.useCustom && d.features.customPage && d.settings.customHtml;
  const page = custom
    ? <iframe className="dev-frame-html" title="Preview of your own HTML" src={`/p/${d.username}/custom?preview=1&v=${d.settings.customHtml.length}`} sandbox="allow-scripts" />
    : which === 'links' ? <ProfileView data={d.page} preview /> : <PortfolioView data={d.page} preview />;
  return (
    <aside className="cs-prev" aria-label="Preview" data-open={open ? '' : undefined}>
      <div className="cs-prev-bar">
        <span className="mono muted cs-prev-l">Preview</span>
        <button type="button" className="cs-prev-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'up' : 'eye'} size={15} />{open ? 'Hide preview' : 'Preview your page'}
        </button>
        {which === 'profile' && (
          <div className="seg-sm" role="group" aria-label="Device">
            <button aria-pressed={device === 'phone'} onClick={() => setDevice('phone')}><Icon name="phone" size={14} /><span>Phone</span></button>
            <button aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}><Icon name="desktop" size={14} /><span>Desktop</span></button>
          </div>
        )}
      </div>
      {dev === 'phone' ? (
        <div className="dev-phone"><div className="dev-screen"><span className="dev-island" aria-hidden="true" /><div className="dev-scroll">{page}</div></div></div>
      ) : (
        <Desktop url={`${location.host}/${d.username}/profile`}>{page}</Desktop>
      )}
    </aside>
  );
}
function Desktop({ url, children }: { url: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / 1280);
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="dev-desk">
      <div className="dev-desk-bar"><span className="dev-url mono">{url}</span></div>
      <div className="dev-desk-view" ref={box}>
        <div className="dev-desk-page" style={{ transform: `scale(${scale})`, height: `${100 / scale}%` }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- links page: content ---------- */
const KINDS: [ItemT['type'], string, string, string][] = [
  ['link', 'Link', 'A button to any page: booking, shop, Drive.', 'link'],
  ['video', 'Video', 'A YouTube or Vimeo video that plays here.', 'play'],
  ['header', 'Heading', 'A title to group what follows.', 'list'],
  ['text', 'Text', 'A short note or line.', 'receipt'],
  ['app', 'Jhino app', 'One of your apps, at its address.', 'grid'],
];
const kindIcon = (t: ItemT['type']) => KINDS.find((k) => k[0] === t)![3];

function LinksContent() {
  const { d, save } = useSaver();
  const [adding, setAdding] = useState(false);
  const [paste, setPaste] = useState('');
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const quickAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!paste.trim()) return;
    const isVideo = /youtu\.?be|vimeo\.com/.test(paste);
    if (await save(post<EditorT>('/api/me/page/items', { type: isVideo ? 'video' : 'link', url: paste.trim(), title: '' }), isVideo ? 'Video added' : 'Link added')) setPaste('');
  };
  const add = async (type: ItemT['type']) => {
    setAdding(false);
    if (type === 'link' || type === 'video') { document.getElementById('cs-paste')?.focus(); return; }
    await save(post<EditorT>('/api/me/page/items', type === 'header' ? { type, title: 'New heading' } : type === 'text' ? { type, text: 'Write something here.' } : { type, appId: d.apps[0]?.id }));
  };
  const reorder = (from: string, to: string) => {
    const ids = d.items.map((x) => x.id);
    const a = ids.indexOf(from); const b = ids.indexOf(to);
    if (a < 0 || b < 0 || a === b) return;
    ids.splice(b, 0, ids.splice(a, 1)[0]);
    save(api<EditorT>('PUT', '/api/me/page/order', { ids }));
  };
  const move = (id: string, dir: -1 | 1) => { const i = d.items.findIndex((x) => x.id === id); const j = i + dir; if (j >= 0 && j < d.items.length) reorder(id, d.items[j].id); };
  return (
    <div className="cs-stack">
      <HeaderCard />
      <form className="cs-paste" onSubmit={quickAdd}>
        <Icon name="link" size={18} />
        <input id="cs-paste" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste a link to add it: a booking page, a YouTube video, your shop" aria-label="Paste a link" />
        <button className="btn primary" disabled={!paste.trim()}>Add</button>
        <button type="button" className="btn cs-more" aria-expanded={adding} onClick={() => setAdding(!adding)}><Icon name="plus" size={16} /><span>More</span></button>
      </form>
      {adding && (
        <div className="cs-kinds" role="menu">
          {KINDS.map(([t, l, h, i]) => (
            <button key={t} role="menuitem" onClick={() => add(t)} disabled={t === 'app' && !d.apps.length}>
              <span className="cs-kind-ico"><Icon name={i} size={18} /></span><b>{l}</b><small>{t === 'app' && !d.apps.length ? 'You have no apps yet.' : h}</small>
            </button>
          ))}
        </div>
      )}
      {!d.items.length ? (
        <div className="cs-empty"><b>Nothing here yet</b><p>Paste your first link above. Visitors see your links in this order; drag them to change it.</p></div>
      ) : (
        <ol className="cs-items">
          {d.items.map((it) => (
            <li key={it.id} className={`${drag === it.id ? 'dragging' : ''} ${over === it.id && drag !== it.id ? 'over' : ''}`}
              onDragOver={(e: DragEvent) => { if (drag) { e.preventDefault(); setOver(it.id); } }}
              onDrop={(e: DragEvent) => { e.preventDefault(); if (drag) reorder(drag, it.id); setDrag(null); setOver(null); }}>
              <ItemCard it={it} onMove={move} dragProps={{ draggable: true, onDragStart: (e: DragEvent) => { setDrag(it.id); e.dataTransfer.effectAllowed = 'move'; }, onDragEnd: () => { setDrag(null); setOver(null); } }} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The top of the links page: photo, name, a line, socials. */
function HeaderCard() {
  const { d, save } = useSaver();
  const [bio, setBio] = useState(d.settings.bio);
  const [place, setPlace] = useState(d.settings.location);
  useEffect(() => { setBio(d.settings.bio); setPlace(d.settings.location); }, [d.settings.bio, d.settings.location]);
  return (
    <section className="cs-card cs-head">
      <Photo />
      <div className="cs-head-f">
        <p className="cs-head-name">{d.page.name} <Link to="/account/profile" className="link small">Edit name</Link></p>
        <textarea className="cs-in cs-bio" rows={1} maxLength={280} value={bio} placeholder="A line about you: what you do, where" aria-label="Bio"
          onChange={(e) => setBio(e.target.value)} onBlur={() => bio !== d.settings.bio && save(api<EditorT>('PUT', '/api/me/page', { bio }))} />
        <input className="cs-in cs-place" maxLength={80} value={place} placeholder="Location, optional" aria-label="Location"
          onChange={(e) => setPlace(e.target.value)} onBlur={() => place !== d.settings.location && save(api<EditorT>('PUT', '/api/me/page', { location: place }))} />
        <Socials />
      </div>
    </section>
  );
}
function Photo() {
  const { d, save } = useSaver();
  const { refresh } = useSession();
  const pick = async (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData(); fd.append('photo', await shrink(file, 800), 'photo.jpg');
    if (await save(api('POST', '/api/account/avatar', fd).then(() => get<EditorT>('/api/me/page')), 'Photo updated')) refresh();
  };
  return (
    <label className="cs-photo" title="Change photo">
      {d.page.avatarUrl ? <img src={d.page.avatarUrl} alt="" /> : <span>{(d.page.name || '?').slice(0, 1)}</span>}
      <i><Icon name="image" size={14} /></i>
      <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} aria-label="Change photo" />
    </label>
  );
}

const SOCIAL_OPTS: [SocialKind, string, string][] = [
  ['instagram', 'Instagram', '@handle'], ['facebook', 'Facebook', 'page name or link'], ['tiktok', 'TikTok', '@handle'], ['youtube', 'YouTube', '@channel or link'],
  ['whatsapp', 'WhatsApp', 'number with country code'], ['viber', 'Viber', 'number with country code'], ['email', 'Email', 'you@studio.com'], ['phone', 'Phone', '+977 98…'],
  ['x', 'X', '@handle'], ['linkedin', 'LinkedIn', 'profile or link'], ['threads', 'Threads', '@handle'], ['telegram', 'Telegram', '@handle'], ['messenger', 'Messenger', 'username'],
  ['pinterest', 'Pinterest', '@handle'], ['snapchat', 'Snapchat', 'username'], ['spotify', 'Spotify', 'link'], ['soundcloud', 'SoundCloud', 'username'], ['behance', 'Behance', 'username'],
  ['dribbble', 'Dribbble', 'username'], ['github', 'GitHub', 'username'], ['discord', 'Discord', 'invite link'], ['twitch', 'Twitch', 'username'], ['website', 'Website', 'https://…'],
];
function Socials() {
  const { d, save } = useSaver();
  const [list, setList] = useState(d.settings.socials.map((s) => ({ ...s, url: s.url.replace(/^mailto:|^tel:/, '') })));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setList(d.settings.socials.map((s) => ({ ...s, url: s.url.replace(/^mailto:|^tel:/, '') }))); }, [d.settings.socials, editing]);
  const commit = async () => { if (await save(api<EditorT>('PUT', '/api/me/page', { socials: list.filter((s) => s.url.trim()) }), 'Socials saved')) setEditing(false); };
  const label = (k: SocialKind) => SOCIAL_OPTS.find((o) => o[0] === k)?.[1] ?? k;
  if (!editing) {
    return (
      <div className="cs-soc">
        {d.settings.socials.map((s, i) => <span key={i} className="cs-soc-chip">{label(s.kind)}</span>)}
        <button type="button" className="link small" onClick={() => setEditing(true)}>{d.settings.socials.length ? 'Edit socials' : '+ Add Instagram, WhatsApp, TikTok…'}</button>
      </div>
    );
  }
  return (
    <div className="cs-soc-edit">
      {list.map((s, i) => (
        <div key={i} className="cs-soc-row">
          <Select label="Network" size="sm" width={140} value={s.kind} options={SOCIAL_OPTS.map(([v, l]) => ({ value: v, label: l }))} onChange={(v) => setList(list.map((x, j) => (j === i ? { ...x, kind: v as SocialKind } : x)))} />
          <input className="input" value={s.url} placeholder={SOCIAL_OPTS.find((o) => o[0] === s.kind)?.[2]} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} aria-label="Handle or link" />
          <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setList(list.filter((_, j) => j !== i))}><Icon name="close" size={15} /></button>
        </div>
      ))}
      <div className="actions-row">
        <button type="button" className="btn sm" onClick={() => setList([...list, { kind: (SOCIAL_OPTS.find(([k]) => !list.some((s) => s.kind === k)) ?? SOCIAL_OPTS[0])[0], url: '' }])}><Icon name="plus" size={14} />Add</button>
        <button type="button" className="btn sm primary" onClick={commit}>Save socials</button>
        <button type="button" className="btn sm quiet" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  );
}

function ItemCard({ it, onMove, dragProps }: { it: ItemT; onMove: (id: string, dir: -1 | 1) => void; dragProps: Record<string, unknown> }) {
  const { d, save } = useSaver();
  const [f, setF] = useState({ title: it.title, url: it.url ?? '', text: it.text ?? '', subtitle: it.subtitle });
  useEffect(() => { setF({ title: it.title, url: it.url ?? '', text: it.text ?? '', subtitle: it.subtitle }); }, [it.title, it.url, it.text, it.subtitle]);
  const patch = (body: Record<string, unknown>, ok?: string) => save(api<EditorT>('PATCH', `/api/me/page/items/${it.id}`, body), ok);
  const blur = (k: 'title' | 'url' | 'text' | 'subtitle') => { const cur = k === 'url' ? it.url ?? '' : k === 'text' ? it.text ?? '' : it[k]; if (f[k] !== cur) patch({ [k]: f[k] }); };
  const del = () => { if (confirm('Remove this from your page? Its click count goes too.')) save(api<EditorT>('DELETE', `/api/me/page/items/${it.id}`), 'Removed'); };
  const lockHl = d.features.themeTier === 'free';
  const enter = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.currentTarget.blur(); };
  return (
    <div className={`cs-item ${it.visible ? '' : 'off'} t-${it.type}`}>
      <button type="button" className="cs-grip" aria-label="Drag to reorder, or use the arrow keys" title="Drag to reorder" {...dragProps}
        onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); onMove(it.id, -1); } if (e.key === 'ArrowDown') { e.preventDefault(); onMove(it.id, 1); } }}>
        <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><g fill="currentColor">{[3, 8, 13].flatMap((y) => [2, 8].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.4" />))}</g></svg>
      </button>
      <span className="cs-item-ico" title={it.type}><Icon name={kindIcon(it.type)} size={16} /></span>
      <div className="cs-item-f">
        {it.type === 'text' ? (
          <textarea className="cs-in cs-t" rows={2} maxLength={1000} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} onBlur={() => blur('text')} aria-label="Text" />
        ) : it.type === 'app' ? (
          <>
            <input className="cs-in cs-t" maxLength={120} value={f.title} placeholder={d.apps.find((a) => a.id === it.appId)?.name ?? 'App'} onChange={(e) => setF({ ...f, title: e.target.value })} onBlur={() => blur('title')} onKeyDown={enter} aria-label="Title" />
            <Select label="App" size="sm" width={240} value={it.appId ?? ''} options={d.apps.map((a) => ({ value: a.id, label: `${a.name}${a.access === 'private' ? ' (private)' : ''}` }))} onChange={(v) => patch({ appId: v })} />
          </>
        ) : (
          <>
            <input className="cs-in cs-t" maxLength={120} value={f.title} placeholder={it.type === 'header' ? 'Heading' : it.url ? hostLabel(it.url) : 'Title'} onChange={(e) => setF({ ...f, title: e.target.value })} onBlur={() => blur('title')} onKeyDown={enter} aria-label="Title" />
            {it.type !== 'header' && <input className="cs-in cs-u mono" value={f.url} placeholder="https://" onChange={(e) => setF({ ...f, url: e.target.value })} onBlur={() => blur('url')} onKeyDown={enter} aria-label="Address" />}
          </>
        )}
      </div>
      <div className="cs-item-side">
        {(it.type === 'link' || it.type === 'video' || it.type === 'app') && <span className="cs-clicks mono" title="Clicks in the last 30 days">{it.clicks30}</span>}
        {it.type === 'link' && (
          <button type="button" className={`icon-btn cs-star ${it.highlight ? 'on' : ''}`} aria-pressed={it.highlight} aria-label="Highlight" title={lockHl ? 'Highlight is on Plus and Pro' : it.highlight ? 'Highlighted' : 'Highlight this link'}
            onClick={() => patch({ highlight: !it.highlight })}><Icon name="spark" size={15} /></button>
        )}
        <label className="toggle" title={it.visible ? 'Shown' : 'Hidden'}><input type="checkbox" checked={it.visible} onChange={(e) => patch({ visible: e.target.checked })} aria-label={it.visible ? 'Shown' : 'Hidden'} /><span aria-hidden="true" /></label>
        <button type="button" className="icon-btn cs-del" aria-label="Remove" onClick={del}><Icon name="trash" size={15} /></button>
      </div>
    </div>
  );
}
const hostLabel = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

/* ---------- links page: design ---------- */
const TIER_NAME: Record<Tier, string> = { free: 'Free', plus: 'Plus', pro: 'Pro' };
function LinksDesign() {
  const { d, save } = useSaver();
  const [html, setHtml] = useState(d.settings.customHtml || '');
  const custom = d.features.customPage;
  return (
    <div className="cs-stack">
      {(['free', 'plus', 'pro'] as Tier[]).map((tier) => {
        const list = THEMES.filter((t) => t.tier === tier);
        const ok = canUseTheme(tier, d.features.themeTier);
        return (
          <section key={tier} className="cs-card">
            <div className="cs-card-h"><h2>{TIER_NAME[tier]} designs</h2>{!ok && <PlanTag plan={TIER_NAME[tier]} />}</div>
            <div className="cs-themes">
              {list.map((t) => {
                const on = d.settings.theme === t.id && !d.settings.useCustom;
                return (
                  <button key={t.id} className={`cs-theme ${on ? 'on' : ''} ${ok ? '' : 'locked'}`} aria-pressed={on} disabled={!ok} title={ok ? t.blurb : `${t.name} is on ${TIER_NAME[tier]}`}
                    onClick={() => save(api<EditorT>('PUT', '/api/me/page', { theme: t.id, useCustom: false }))}>
                    <ThemeThumb id={t.id} />
                    <span className="cs-tname">{t.name}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      <section className="cs-card">
        <div className="cs-card-h"><h2>Your own HTML</h2>{!custom && <PlanTag plan="Pro" />}</div>
        <p className="hint">Replace the design with a page you wrote. Use <code>{'{{name}}'}</code>, <code>{'{{bio}}'}</code>, <code>{'{{avatar}}'}</code>, <code>{'{{links}}'}</code> and <code>{'{{socials}}'}</code>, or read <code>window.JHINO</code>. Clicks are still counted, and it runs sandboxed.</p>
        <textarea className="textarea mono cs-html" rows={10} value={html} disabled={!custom} spellCheck={false} onChange={(e) => setHtml(e.target.value)} placeholder={custom ? 'Paste your HTML, or start from the example.' : 'Your own design is on Pro.'} />
        {custom && (
          <div className="actions-row">
            {!html && <button className="btn sm" onClick={() => setHtml(d.starter)}>Start from an example</button>}
            <button className="btn sm" disabled={html === d.settings.customHtml} onClick={() => save(api<EditorT>('PUT', '/api/me/page', { customHtml: html }), 'HTML saved')}>Save HTML</button>
            <label className="check-row"><input type="checkbox" checked={d.settings.useCustom} disabled={!d.settings.customHtml} onChange={(e) => save(api<EditorT>('PUT', '/api/me/page', { useCustom: e.target.checked }))} /><span>Use my HTML for the links page</span></label>
          </div>
        )}
      </section>
      <p className="hint cs-brand">{d.features.branding === 'none' ? 'Your pages show nothing of Jhino.' : d.features.branding === 'badge' ? 'Your pages end with a small "Made with jhino". Pro removes it.' : 'Your pages show "Made with jhino" and a small note for visitors. Plus keeps just the badge; Pro removes both.'} {d.features.branding !== 'none' && <Link to="/account/plan" className="link">See plans</Link>}</p>
    </div>
  );
}

/* ---------- profile page: content ---------- */
function ProfileContent() {
  const { d, save } = useSaver();
  const p = d.page.portfolio;
  const [f, setF] = useState({ headline: p.headline, about: p.about, ctaLabel: p.cta?.label ?? '', ctaUrl: p.cta?.url ?? '' });
  useEffect(() => { setF({ headline: p.headline, about: p.about, ctaLabel: p.cta?.label ?? '', ctaUrl: p.cta?.url ?? '' }); }, [p.headline, p.about, p.cta]);
  const put = (body: Record<string, unknown>, ok?: string) => save(api<EditorT>('PUT', '/api/me/page', body), ok);
  const saveCta = () => { if (f.ctaLabel !== (p.cta?.label ?? '') || f.ctaUrl !== (p.cta?.url ?? '')) put({ cta: f.ctaLabel || f.ctaUrl ? { label: f.ctaLabel, url: f.ctaUrl } : null }); };
  return (
    <div className="cs-stack">
      <Cover />
      <section className="cs-card">
        <div className="cs-card-h"><h2>Introduction</h2></div>
        <label className="field"><span>What you do</span><input className="input" maxLength={120} value={f.headline} placeholder="Photo and film for brands, weddings and podcasts" onChange={(e) => setF({ ...f, headline: e.target.value })} onBlur={() => f.headline !== p.headline && put({ headline: f.headline })} /></label>
        <div className="grid2">
          <label className="field"><span>Main button</span><input className="input" maxLength={40} value={f.ctaLabel} placeholder="Book a session" onChange={(e) => setF({ ...f, ctaLabel: e.target.value })} onBlur={saveCta} /></label>
          <label className="field"><span>It opens</span><input className="input" value={f.ctaUrl} placeholder="https://… or mailto:you@studio.com" onChange={(e) => setF({ ...f, ctaUrl: e.target.value })} onBlur={saveCta} /></label>
        </div>
        <p className="hint">Without a main button, visitors get your WhatsApp or email (from your socials).</p>
      </section>
      <section className="cs-card">
        <div className="cs-card-h"><h2>About</h2><span className="mono muted small">{f.about.length}/1500</span></div>
        <textarea className="textarea cs-about" rows={5} maxLength={1500} value={f.about} placeholder="Tell visitors who you are and how you work. A few sentences read best." onChange={(e) => setF({ ...f, about: e.target.value })} onBlur={() => f.about !== p.about && put({ about: f.about })} />
      </section>
      <Rows<Stat> title="Numbers" hint="Up to 4, like 9 yrs · making films, or 240+ · weddings." max={4} rows={p.stats} blank={{ value: '', label: '' }} keyName="stats"
        cols={[['value', 'Number', 'value', 16, '240+'], ['label', 'What it counts', 'label', 40, 'weddings']]} />
      <Rows<Service> title="Services" hint="What you offer, with a price if you like: from NPR 15,000." max={12} rows={p.services} blank={{ name: '', note: '', price: '' }} keyName="services"
        cols={[['name', 'Service', 'name', 60, 'Wedding story'], ['note', 'Details', 'note', 140, 'Two shooters, full day'], ['price', 'Price', 'price', 40, 'from NPR 120,000']]} />
      <Work />
      <p className="hint cs-brand">Your film and links on this page come from the links page (its first video and its links). Contact buttons come from your socials: WhatsApp, email and phone.</p>
    </div>
  );
}

function Cover() {
  const { d, save } = useSaver();
  const url = d.page.portfolio.coverUrl;
  const file = url?.split('/').pop();
  const pick = async (f: File | undefined) => {
    if (!f) return;
    const fd = new FormData(); fd.append('image', await shrink(f, 2200), 'cover.jpg');
    save(api<EditorT>('POST', '/api/me/page/image?kind=cover', fd), 'Cover updated');
  };
  return (
    <section className="cs-card">
      <div className="cs-card-h"><h2>Cover</h2>{url && <button className="link small" onClick={() => save(api<EditorT>('DELETE', `/api/me/page/image/${file}`), 'Cover removed')}>Remove</button>}</div>
      <label className={`cs-cover ${url ? 'has' : ''}`}>
        {url ? <img src={url} alt="" /> : <span><Icon name="image" size={22} /><b>Add a cover photo</b><small>A wide photo of your work. JPG, PNG or WEBP.</small></span>}
        {url && <i className="btn sm">Replace</i>}
        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
    </section>
  );
}

function Rows<T extends { [K in keyof T]: string }>({ title, hint, max, rows, blank, keyName, cols }: { title: string; hint: string; max: number; rows: T[]; blank: T; keyName: string; cols: [keyof T & string, string, string, number, string][] }) {
  const { save } = useSaver();
  const [list, setList] = useState<T[]>(rows);
  useEffect(() => { setList(rows); }, [rows]);
  const commit = (next: T[]) => { setList(next); save(api<EditorT>('PUT', '/api/me/page', { [keyName]: next.filter((r) => Object.values(r).some((v) => String(v).trim())) })); };
  const dirty = JSON.stringify(list) !== JSON.stringify(rows);
  return (
    <section className="cs-card">
      <div className="cs-card-h"><h2>{title}</h2><span className="mono muted small">{list.length}/{max}</span></div>
      <p className="hint">{hint}</p>
      {list.length > 0 && (
        <div className="cs-rows" style={{ ['--cols' as string]: cols.map((c) => (c[3] > 60 ? '1.6fr' : '1fr')).join(' ') }}>
          {list.map((r, i) => (
            <div key={i} className="cs-row">
              {cols.map(([k, label, , mx, ph]) => (
                <input key={k} className="input" maxLength={mx} value={r[k]} placeholder={ph} aria-label={label}
                  onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} onBlur={() => dirty && commit(list)} />
              ))}
              <button type="button" className="icon-btn" aria-label="Remove" onClick={() => commit(list.filter((_, j) => j !== i))}><Icon name="close" size={15} /></button>
            </div>
          ))}
        </div>
      )}
      {list.length < max && <button type="button" className="btn sm" onClick={() => setList([...list, { ...blank }])}><Icon name="plus" size={14} />Add</button>}
    </section>
  );
}

function Work() {
  const { d, save } = useSaver();
  const work = d.page.portfolio.work;
  const [caps, setCaps] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(0);
  const upload = async (files: FileList | null) => {
    if (!files) return;
    const list = [...files].slice(0, Math.max(0, d.features.workImages - work.length));
    setBusy(list.length);
    for (const f of list) {
      const fd = new FormData(); fd.append('image', await shrink(f, 1800), 'work.jpg');
      await save(api<EditorT>('POST', '/api/me/page/image?kind=work', fd));
      setBusy((n) => n - 1);
    }
  };
  const push = (next: { id: string; caption: string }[]) => save(api<EditorT>('PUT', '/api/me/page', { work: next }));
  const move = (i: number, dir: -1 | 1) => { const j = i + dir; if (j < 0 || j >= work.length) return; const n = work.map((w) => ({ id: w.id, caption: w.caption })); [n[i], n[j]] = [n[j], n[i]]; push(n); };
  return (
    <section className="cs-card">
      <div className="cs-card-h"><h2>Work</h2><span className="mono muted small">{work.length}/{d.features.workImages}</span></div>
      <p className="hint">Your best photos or stills. The first one shows larger. Big photos are made lighter before they are sent.</p>
      <div className="cs-work">
        {work.map((w, i) => (
          <figure key={w.id} className="cs-wimg">
            <img src={w.url} alt="" />
            <div className="cs-wbar">
              <button type="button" className="icon-btn" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="back" size={14} /></button>
              <button type="button" className="icon-btn" aria-label="Move later" disabled={i === work.length - 1} onClick={() => move(i, 1)} style={{ transform: 'scaleX(-1)' }}><Icon name="back" size={14} /></button>
              <button type="button" className="icon-btn" aria-label="Remove" onClick={() => save(api<EditorT>('DELETE', `/api/me/page/image/${w.id}`))}><Icon name="trash" size={14} /></button>
            </div>
            <input className="cs-in cs-cap" maxLength={80} value={caps[w.id] ?? w.caption} placeholder="Caption, optional" aria-label="Caption"
              onChange={(e) => setCaps({ ...caps, [w.id]: e.target.value })}
              onBlur={() => { if (caps[w.id] !== undefined && caps[w.id] !== w.caption) push(work.map((x) => ({ id: x.id, caption: x.id === w.id ? caps[w.id] : x.caption }))); }} />
          </figure>
        ))}
        {work.length < d.features.workImages && (
          <label className="cs-wadd">
            {busy ? <span className="spin" /> : <Icon name="plus" size={20} />}<b>{busy ? `Adding ${busy}…` : 'Add photos'}</b>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
          </label>
        )}
      </div>
      {work.length >= d.features.workImages && d.features.workImages < 24 && <p className="hint">Your plan holds {d.features.workImages} photos. <Link to="/account/plan" className="link">More on a higher plan</Link></p>}
    </section>
  );
}

/* ---------- profile page: style ---------- */
function ProfileStyle() {
  const { d, save } = useSaver();
  const p = d.page.portfolio;
  return (
    <div className="cs-stack">
      <section className="cs-card">
        <div className="cs-card-h"><h2>Colour</h2></div>
        <div className="cs-pals" role="radiogroup" aria-label="Colour">
          {PALETTES.map((c) => (
            <button key={c.id} role="radio" aria-checked={p.palette === c.id} className="cs-pal" onClick={() => save(api<EditorT>('PUT', '/api/me/page', { palette: c.id }))}>
              <span className="cs-pal-sw" style={{ background: c.bg, color: c.fg, borderColor: c.line }}><b style={{ fontFamily: p.type === 'serif' ? "'Fraunces Variable', serif" : "'Bricolage Grotesque Variable', sans-serif" }}>Aa</b><i style={{ background: c.accent }} /></span>
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="cs-card">
        <div className="cs-card-h"><h2>Type</h2></div>
        <div className="cs-types" role="radiogroup" aria-label="Type">
          {([['sans', 'Grotesk', 'Modern and direct.', "'Bricolage Grotesque Variable', sans-serif"], ['serif', 'Serif', 'Editorial and warm.', "'Fraunces Variable', serif"]] as const).map(([k, l, h, ff]) => (
            <button key={k} role="radio" aria-checked={p.type === k} className="cs-type" onClick={() => save(api<EditorT>('PUT', '/api/me/page', { ptype: k }))}>
              <b style={{ fontFamily: ff }}>Sur Studio</b><span>{l}</span><small>{h}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ---------- settings ---------- */
function SettingsTab() {
  const { d, save } = useSaver();
  const toast = useToast();
  const { refresh } = useSession();
  const [uname, setUname] = useState(d.username);
  const base = `${location.origin}/${d.username}`;
  const changeName = async () => {
    if (!confirm(`Change your username to @${uname}? Your pages, app addresses and short links move to jhino.com/${uname}/…, and the old addresses stop working.`)) return;
    try { await api('PUT', '/api/account/username', { username: uname }); await refresh(); toast('Username changed'); location.replace(`/${uname}?tab=settings`); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not change it.', true); }
  };
  const share = async (url: string) => {
    if (navigator.share) { try { await navigator.share({ title: d.page.name, url }); return; } catch { /* closed */ } }
    await copyText(url); toast('Link copied');
  };
  return (
    <div className="cs-settings">
      <section className="cs-card">
        <div className="cs-card-h"><h2>What opens at {location.host}/{d.username}</h2></div>
        <div className="cs-home" role="radiogroup" aria-label="Home page">
          {([['links', 'Links page', 'Best for a bio link on Instagram or TikTok.'], ['profile', 'Profile page', 'Best for proposals, email signatures and clients.']] as const).map(([k, l, h]) => (
            <button key={k} role="radio" aria-checked={d.settings.home === k} className="cs-homeopt" onClick={() => save(api<EditorT>('PUT', '/api/me/page', { home: k }), 'Saved')}>
              <span className="radio" /><span><b>{l}</b><small>{h}</small></span>
            </button>
          ))}
        </div>
      </section>
      <section className="cs-card">
        <div className="cs-card-h"><h2>Share</h2></div>
        <ul className="cs-share">
          {([['Your page', base], ['Links page', `${base}/links`], ['Profile page', `${base}/profile`]] as const).map(([l, u]) => (
            <li key={u}><div><b>{l}</b><span className="mono small">{u.replace(/^https?:\/\//, '')}</span></div>
              <div className="actions-row"><button className="btn sm" onClick={() => copyText(u).then(() => toast('Link copied'))}><Icon name="copy" size={14} />Copy</button><button className="btn sm quiet" onClick={() => share(u)}>Share…</button></div></li>
          ))}
        </ul>
      </section>
      <section className="cs-card">
        <div className="cs-card-h"><h2>Visibility</h2></div>
        <label className="check-row"><input type="checkbox" checked={d.settings.published} onChange={(e) => save(api<EditorT>('PUT', '/api/me/page', { published: e.target.checked }), e.target.checked ? 'Your pages are public' : 'Your pages are hidden')} /><span>Anyone can see my pages</span></label>
        <p className="hint">Hidden, they say "There is no page here" to everyone but you. Your apps and short links keep working.</p>
      </section>
      <section className="cs-card">
        <div className="cs-card-h"><h2>Username</h2></div>
        <div className="linkbox"><span className="addr-host mono">{location.host}/</span><input className="input mono" value={uname} maxLength={30} onChange={(e) => setUname(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} aria-label="Username" />
          <button className="btn sm" disabled={uname === d.username || uname.length < 3} onClick={changeName}>Change</button></div>
        <p className="hint">Your pages, app addresses and short links all live under it.</p>
      </section>
    </div>
  );
}

/* ---------- analytics ---------- */
interface StatsT { days: number; maxDays: number; totals: { views: number; visitors: number; clicks: number; ctr: number }; series: { day: string; views: number; visitors: number; clicks: number }[];
  items: { id: string; type: string; title: string; url: string | null; clicks: number }[]; refs: { value: string; n: number }[]; devices: { value: string; n: number }[]; countries: { value: string; n: number }[]; pages?: { value: string; n: number }[]; shortLinks: { code: string; url: string; clicks: number }[] }
function AnalyticsTab() {
  const { d } = useSaver();
  const [days, setDays] = useState(Math.min(30, d.features.analyticsDays));
  const [s, setS] = useState<StatsT | null>(null);
  useEffect(() => { setS(null); get<StatsT>(`/api/me/page/analytics?days=${days}`).then(setS, () => {}); }, [days]);
  const max = s ? Math.max(1, ...s.series.map((x) => Math.max(x.views, x.clicks))) : 1;
  const bar = (list: { value: string; n: number }[], label: (v: string) => ReactNode = (v) => v) => {
    const top = Math.max(1, ...list.map((x) => x.n));
    return !list.length ? <p className="muted small">Nothing yet.</p> : <ul className="an-bars">{list.map((x) => <li key={x.value}><span className="an-l">{label(x.value)}</span><span className="an-track"><i style={{ transform: `scaleX(${x.n / top})` }} /></span><span className="mono an-n">{x.n.toLocaleString('en-IN')}</span></li>)}</ul>;
  };
  const region = useMemo(() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; } }, []);
  return (
    <div className="cs-an">
      <div className="an-head">
        <div className="seg" role="group" aria-label="Range">
          {[7, 30, 90, 365].map((r) => <button key={r} aria-pressed={days === r} disabled={r > d.features.analyticsDays} title={r > d.features.analyticsDays ? 'A longer history is on a higher plan' : undefined} onClick={() => setDays(r)}>{r === 365 ? '1 year' : `${r} days`}</button>)}
        </div>
        {d.features.analyticsDays < 365 && <span className="hint">Your plan keeps {d.features.analyticsDays} days. <Link to="/account/plan" className="link">More</Link></span>}
      </div>
      {!s ? <div className="acc-skel" /> : (
        <>
          <dl className="kpi-strip">
            <div className="kpi2"><p className="k-l">Page views</p><p className="k-v mono">{s.totals.views.toLocaleString('en-IN')}</p></div>
            <div className="kpi2"><p className="k-l">Visitors</p><p className="k-v mono">{s.totals.visitors.toLocaleString('en-IN')}</p><p className="k-s">counted once a day</p></div>
            <div className="kpi2"><p className="k-l">Link clicks</p><p className="k-v mono">{s.totals.clicks.toLocaleString('en-IN')}</p></div>
            <div className="kpi2"><p className="k-l">Click rate</p><p className="k-v mono">{s.totals.ctr}%</p><p className="k-s">clicks per view</p></div>
          </dl>
          <section className="dpanel an-chart">
            <div className="panel-h"><h2>Views and clicks</h2><span className="legend"><span><i className="sw ink" />Views</span><span><i className="sw quiet" />Clicks</span></span></div>
            <div className="an-cols" role="img" aria-label={`${s.totals.views} views and ${s.totals.clicks} clicks over ${s.days} days`}>
              {s.series.map((x) => <div key={x.day} className="an-col" title={`${x.day}: ${x.views} views, ${x.clicks} clicks`}><i className="v" style={{ transform: `scaleY(${x.views / max})` }} /><i className="c" style={{ transform: `scaleY(${x.clicks / max})` }} /></div>)}
            </div>
            <div className="bars-axis mono an-axis"><span>{s.series[0]?.day}</span><span>today</span></div>
          </section>
          <div className="an-grid">
            <section className="dpanel"><div className="panel-h"><h2>Links</h2></div>
              {!s.items.length ? <p className="muted small">Add links to see which get clicked.</p> : (
                <table className="adm-table"><thead><tr><th>Link</th><th>Clicks</th><th>Rate</th></tr></thead>
                  <tbody>{s.items.map((i) => <tr key={i.id}><td className="small url-cell" title={i.url ?? ''}>{i.title || (i.url ? hostLabel(i.url) : i.type)}</td><td className="mono">{i.clicks}</td><td className="mono small">{s.totals.views ? Math.round((i.clicks / s.totals.views) * 1000) / 10 : 0}%</td></tr>)}</tbody></table>
              )}
            </section>
            <section className="dpanel"><div className="panel-h"><h2>Pages</h2></div>{bar(s.pages ?? [])}</section>
            <section className="dpanel"><div className="panel-h"><h2>Where visitors came from</h2></div>{bar(s.refs)}</section>
            <section className="dpanel"><div className="panel-h"><h2>Devices</h2></div>{bar(s.devices)}</section>
            <section className="dpanel"><div className="panel-h"><h2>Countries</h2></div>{bar(s.countries, (c) => region?.of(c) ?? c)}</section>
            {!!s.shortLinks.length && <section className="dpanel"><div className="panel-h"><h2>Short links</h2><Link to="/links" className="link small">All links</Link></div>{bar(s.shortLinks.map((l) => ({ value: `/${l.code}`, n: l.clicks })))}</section>}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- helpers ---------- */
/** Make a photo lighter before it is sent: at most `max` px on its long side, as JPEG. */
async function shrink(file: File, max: number): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 900_000) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok) => c.toBlob((b) => ok(b ?? file), 'image/jpeg', 0.86));
  } catch { return file; }
}
