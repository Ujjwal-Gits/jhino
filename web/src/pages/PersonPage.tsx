import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api, get, post, type User } from '../api';
import { Link, useSession } from '../context';
import { Icon, Select, copyText, useToast } from '../ui';
import { AvatarViewerModal, AvatarPositionModal, validatePhotoFile, ACCEPT_PHOTO_TYPES } from '../AvatarModal';
import { Shell } from './Shell';
import { PublicApp } from './PublicApp';
import { PlanTag } from './Address';
import { ProfileView } from '../profile/ProfileView';
import { ThemeThumb } from '../profile/ThemeThumb';
import { THEMES, canUseTheme } from '../profile/themes';
import type { ProfileData, SocialKind, Tier } from '../profile/types';

/*
 * jhino.com/<username>. Visitors see the person's page. The owner sees their editor with a live
 * preview: links, profile and socials, design (30 designs by plan, or their own HTML on Pro),
 * analytics and sharing. A name that is not a username may still be a top-level app address.
 */

interface PublicResp { profile: ProfileData; owner: boolean; custom: boolean; published: boolean }

export function PersonPage({ name, user }: { name: string; user: User | null }) {
  const [d, setD] = useState<PublicResp | null | 'none'>(null);
  useEffect(() => {
    setD(null);
    get<PublicResp & { isApp?: boolean }>(`/api/profile/${encodeURIComponent(name)}`).then(
      (res) => { if (res.isApp) setD('none'); else setD(res); },
      () => setD('none')
    );
  }, [name]);
  if (d === null) return <main className="state-card" aria-busy="true"><span className="spin" /></main>;
  // Not a person: a top-level address (made by a super admin, or before usernames).
  if (d === 'none') return <PublicApp refId={name} signedInUser={user} />;
  if (d.owner && user) return <Shell><MyPage /></Shell>;
  return <PublicProfile d={d} />;
}

/* ---------------- what visitors see ---------------- */
function PublicProfile({ d }: { d: PublicResp }) {
  const view = new URLSearchParams(location.search).get('view');
  const data = useMemo(() => ({ ...d.profile, layout: view === 'profile' || view === 'links' ? view : d.profile.layout } as ProfileData), [d, view]);
  useEffect(() => {
    document.title = `${d.profile.name} (@${d.profile.username}) · Jhino`;
    // One view, sent by the page (the owner's own visits are not counted by the server).
    post(`/api/profile/${encodeURIComponent(d.profile.username)}/hit`, { ref: document.referrer || '' }).catch(() => {});
    return () => { document.title = 'Jhino'; };
  }, [d]);
  if (d.custom) {
    return (
      <iframe className="pf-custom" title={`${d.profile.name} on Jhino`} src={`/p/${encodeURIComponent(d.profile.username)}/custom`}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-forms" />
    );
  }
  return <ProfileView data={data} />;
}

/* ---------------- the owner's editor ---------------- */
interface ItemT { id: string; type: 'link' | 'header' | 'text' | 'video' | 'app'; title: string; subtitle: string; url: string | null; text: string | null; appId: string | null; highlight: boolean; visible: boolean; clicks30: number }
interface EditorT {
  username: string; page: ProfileData;
  usernameNextChange?: string | null; usernameEveryDays?: number;
  settings: { bio: string; location: string; theme: string; layout: 'links' | 'profile'; socials: { kind: SocialKind; url: string }[]; published: boolean; customHtml: string; useCustom: boolean };
  items: ItemT[]; features: { themeTier: Tier; branding: string; customPage: boolean; analyticsDays: number };
  apps: { id: string; name: string; slug: string | null; access: string }[]; starter: string;
}
type Tab = 'links' | 'profile' | 'design' | 'analytics' | 'share';
const TABS: [Tab, string][] = [['links', 'Links'], ['profile', 'Profile'], ['design', 'Design'], ['analytics', 'Analytics'], ['share', 'Share']];

function MyPage() {
  const toast = useToast();
  const [d, setD] = useState<EditorT | null>(null);
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get('tab') as Tab) || 'links');
  const load = useCallback(() => get<EditorT>('/api/me/page').then(setD, (e) => toast(e instanceof ApiError ? e.message : 'Could not load your page.', true)), [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { document.title = 'My page · Jhino'; }, []);
  /** Save, then show what the server now has (the preview follows at once). */
  const run = useCallback(async (p: Promise<EditorT>, ok?: string) => {
    try { setD(await p); if (ok) toast(ok); return true; } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save.', true); return false; }
  }, [toast]);
  if (!d) return <main className="page"><div className="acc-skel" /></main>;
  const url = `${location.origin}/${d.username}`;
  return (
    <main className="page mp">
      <header className="mp-head">
        <div className="mp-title">
          <h1>My page</h1>
          <p className="mp-url">
            <a href={`/${d.username}`} target="_blank" rel="noopener" className="mono">{location.host}/<b>{d.username}</b></a>
            <button className="btn sm" onClick={() => copyText(url).then(() => toast('Link copied'))}><Icon name="copy" size={14} />Copy</button>
            {!d.settings.published && <span className="status s-rejected">hidden</span>}
          </p>
        </div>
        <nav className="seg mp-tabs" aria-label="My page">
          {TABS.map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => { setTab(k); history.replaceState(null, '', `?tab=${k}`); }}>{l}</button>)}
        </nav>
      </header>
      <div className={`mp-body ${tab === 'analytics' ? 'wide' : ''}`}>
        <section className="mp-editor" aria-label={TABS.find((t) => t[0] === tab)![1]}>
          {tab === 'links' && <LinksTab d={d} run={run} />}
          {tab === 'profile' && <ProfileTab d={d} run={run} reload={load} />}
          {tab === 'design' && <DesignTab d={d} run={run} />}
          {tab === 'analytics' && <AnalyticsTab d={d} />}
          {tab === 'share' && <ShareTab d={d} run={run} />}
        </section>
        {tab !== 'analytics' && (
          <aside className="mp-preview" aria-label="Preview">
            <div className="mp-phone">
              {d.settings.useCustom && d.features.customPage && d.settings.customHtml
                ? <iframe title="Preview of your own HTML" src={`/p/${d.username}/custom?preview=1&v=${d.settings.customHtml.length}`} sandbox="allow-scripts" />
                : <ProfileView data={d.page} preview />}
            </div>
            <p className="hint mp-prev-note">Preview. Hidden items show faded here only. <a className="link" href={`/${d.username}`} target="_blank" rel="noopener">Open the live page</a></p>
          </aside>
        )}
      </div>
    </main>
  );
}
type Run = (p: Promise<EditorT>, ok?: string) => Promise<boolean>;

/* ---------- links ---------- */
const ADDERS: [ItemT['type'], string, string][] = [['link', 'Link', 'link'], ['header', 'Heading', 'list'], ['text', 'Text', 'receipt'], ['video', 'Video', 'play'], ['app', 'Jhino app', 'grid']];
function LinksTab({ d, run }: { d: EditorT; run: Run }) {
  const [adding, setAdding] = useState<ItemT['type'] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const move = (id: string, dir: -1 | 1) => {
    const ids = d.items.map((x) => x.id);
    const i = ids.indexOf(id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(api<EditorT>('PUT', '/api/me/page/order', { ids }));
  };
  return (
    <>
      <div className="mp-add" role="group" aria-label="Add to your page">
        {ADDERS.map(([t, l, i]) => <button key={t} className={`btn ${t === 'link' ? 'primary' : ''}`} aria-pressed={adding === t} onClick={() => setAdding(adding === t ? null : t)}><Icon name={i} size={15} />{l}</button>)}
      </div>
      {adding && <ItemForm type={adding} d={d} onDone={() => setAdding(null)} run={run} />}
      {!d.items.length && !adding && <p className="mp-empty">Your page is empty. Add a link to your work, a booking form, a price list or a video. Visitors see them in this order.</p>}
      <ol className="mp-items">
        {d.items.map((it, i) => (
          <li key={it.id} className={`${it.visible ? '' : 'off'} ${open === it.id ? 'open' : ''}`}>
            <div className="mp-row">
              <div className="mp-move">
                <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(it.id, -1)}><Icon name="up" size={15} /></button>
                <button className="icon-btn" aria-label="Move down" disabled={i === d.items.length - 1} onClick={() => move(it.id, 1)}><Icon name="down" size={15} /></button>
              </div>
              <button className="mp-main" onClick={() => setOpen(open === it.id ? null : it.id)} aria-expanded={open === it.id}>
                <span className="mp-kind mono">{it.type === 'app' ? 'app' : it.type}</span>
                <b>{it.type === 'text' ? (it.text ?? '').slice(0, 60) : it.title || (it.url ? hostOf(it.url) : 'Untitled')}</b>
                {(it.url || it.type === 'app') && <small>{it.type === 'app' ? d.apps.find((a) => a.id === it.appId)?.name ?? 'App' : hostOf(it.url!)}</small>}
              </button>
              {(it.type === 'link' || it.type === 'video' || it.type === 'app') && <span className="mp-clicks mono" title="Clicks in the last 30 days">{it.clicks30}<small> clicks</small></span>}
              {it.type === 'link' && (
                <button className={`icon-btn mp-star ${it.highlight ? 'on' : ''}`} aria-pressed={it.highlight} aria-label="Highlight this link" title={d.features.themeTier === 'free' ? 'Highlight is on Plus and Pro' : 'Highlight'}
                  onClick={() => run(api<EditorT>('PATCH', `/api/me/page/items/${it.id}`, { highlight: !it.highlight }))}><Icon name="spark" size={15} /></button>
              )}
              <label className="toggle" title={it.visible ? 'Shown' : 'Hidden'}><input type="checkbox" checked={it.visible} onChange={(e) => run(api<EditorT>('PATCH', `/api/me/page/items/${it.id}`, { visible: e.target.checked }))} aria-label={`Show ${it.title || it.type}`} /><span aria-hidden="true" /></label>
            </div>
            {open === it.id && <ItemForm type={it.type} d={d} item={it} onDone={() => setOpen(null)} run={run} />}
          </li>
        ))}
      </ol>
    </>
  );
}
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function ItemForm({ type, d, item, onDone, run }: { type: ItemT['type']; d: EditorT; item?: ItemT; onDone: () => void; run: Run }) {
  const [f, setF] = useState({ title: item?.title ?? '', subtitle: item?.subtitle ?? '', url: item?.url ?? '', text: item?.text ?? '', appId: item?.appId ?? d.apps[0]?.id ?? '' });
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body = { type, ...f, appId: f.appId || undefined };
    const ok = await run(item ? api<EditorT>('PATCH', `/api/me/page/items/${item.id}`, body) : post<EditorT>('/api/me/page/items', body), item ? 'Saved' : 'Added to your page');
    setBusy(false);
    if (ok) onDone();
  };
  const del = async () => { if (item && confirm('Remove this from your page? Its click counts go too.')) { if (await run(api<EditorT>('DELETE', `/api/me/page/items/${item.id}`), 'Removed')) onDone(); } };
  return (
    <form className="mp-form" onSubmit={save}>
      {type === 'link' && <>
        <label className="field"><span>Address</span><input className="input" inputMode="url" required value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://… a booking form, a Drive folder, your shop" autoFocus={!item} /></label>
        <div className="grid2">
          <label className="field"><span>Title</span><input className="input" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Book a session" /></label>
          <label className="field"><span>Line under it <em>optional</em></span><input className="input" maxLength={160} value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} placeholder="Weekdays, 10 to 6" /></label>
        </div>
      </>}
      {type === 'video' && <>
        <label className="field"><span>YouTube or Vimeo link</span><input className="input" inputMode="url" required value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://youtu.be/…" autoFocus={!item} /></label>
        <label className="field"><span>Title</span><input className="input" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Showreel 2026" /></label>
        <p className="hint">It plays on your page. Videos are never uploaded here: they stay on YouTube or Vimeo.</p>
      </>}
      {type === 'header' && <label className="field"><span>Heading</span><input className="input" required maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Work" autoFocus={!item} /></label>}
      {type === 'text' && <label className="field"><span>Text</span><textarea className="textarea" rows={3} required maxLength={1000} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} autoFocus={!item} /></label>}
      {type === 'app' && (d.apps.length ? <>
        <div className="field"><span>App</span><Select label="App" value={f.appId} options={d.apps.map((a) => ({ value: a.id, label: `${a.name}${a.access === 'private' ? ' (private)' : ''}` }))} onChange={(v) => setF({ ...f, appId: v })} /></div>
        <label className="field"><span>Title <em>optional</em></span><input className="input" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Uses the app's name" /></label>
        {d.apps.find((a) => a.id === f.appId)?.access === 'private' && <p className="hint warn-text">Visitors only see apps open by link. Turn on a public or password link in the app's Share.</p>}
      </> : <p className="hint">You have no apps yet. <Link to="/build" className="link">Create one</Link>.</p>)}
      <div className="actions-row">
        <button className="btn sm primary" disabled={busy || (type === 'app' && !d.apps.length)}>{busy && <span className="spin" />}{item ? 'Save' : 'Add'}</button>
        <button type="button" className="btn sm quiet" onClick={onDone}>Cancel</button>
        {item && <button type="button" className="btn sm quiet danger" onClick={del}>Remove</button>}
      </div>
    </form>
  );
}

/* ---------- profile and socials ---------- */
const SOCIAL_OPTS: [SocialKind, string, string][] = [
  ['instagram', 'Instagram', '@handle'], ['facebook', 'Facebook', 'page name or link'], ['tiktok', 'TikTok', '@handle'], ['youtube', 'YouTube', '@channel or link'],
  ['whatsapp', 'WhatsApp', 'number with country code'], ['viber', 'Viber', 'number with country code'], ['x', 'X (Twitter)', '@handle'], ['linkedin', 'LinkedIn', 'profile name or link'],
  ['threads', 'Threads', '@handle'], ['telegram', 'Telegram', '@handle'], ['messenger', 'Messenger', 'username'], ['pinterest', 'Pinterest', '@handle'], ['snapchat', 'Snapchat', 'username'],
  ['spotify', 'Spotify', 'link'], ['soundcloud', 'SoundCloud', 'username'], ['behance', 'Behance', 'username'], ['dribbble', 'Dribbble', 'username'], ['github', 'GitHub', 'username'],
  ['discord', 'Discord', 'invite link'], ['twitch', 'Twitch', 'username'], ['email', 'Email', 'you@studio.com'], ['phone', 'Phone', '+977 98…'], ['website', 'Website', 'https://…'],
];
function ProfileTab({ d, run, reload }: { d: EditorT; run: Run; reload: () => void }) {
  const toast = useToast();
  const { refresh } = useSession();
  const [f, setF] = useState({ bio: d.settings.bio, location: d.settings.location });
  const [socials, setSocials] = useState(d.settings.socials.map((s) => ({ ...s, url: s.url.replace(/^mailto:|^tel:/, '') })));
  const [uname, setUname] = useState(d.username);
  const [viewOpen, setViewOpen] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const saveText = (e: FormEvent) => { e.preventDefault(); run(api<EditorT>('PUT', '/api/me/page', f), 'Saved'); };
  const saveSocials = () => run(api<EditorT>('PUT', '/api/me/page', { socials: socials.filter((s) => s.url.trim()) }), 'Socials saved');
  const changeName = async () => {
    if (!confirm(`Change your username from @${d.username} to @${uname}?\n\n• Your public page moves to ${location.host}/${uname}\n• You can only change your username once every 30 days\n• Your previous username @${d.username} will be released immediately for anyone else to claim`)) return;
    try { await api('PUT', '/api/account/username', { username: uname }); await refresh(); toast('Username changed'); location.replace(`/${uname}?tab=profile`); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not change it.', true); }
  };

  const onFileChosen = (file: File | undefined) => {
    if (!file) return;
    const check = validatePhotoFile(file);
    if (!check.ok) { toast(check.error, true); return; }
    const url = URL.createObjectURL(file);
    setCropSrc(url);
  };

  const savePhoto = async (blob: Blob) => {
    const fd = new FormData();
    fd.append('photo', blob, 'avatar.webp');
    try {
      await api('POST', '/api/account/avatar', fd);
      await refresh();
      reload();
      toast('Photo updated');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not upload.', true);
      throw e;
    }
  };

  const removePhoto = async () => {
    try {
      await api('DELETE', '/api/account/avatar');
      await refresh();
      reload();
      toast('Photo removed');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not remove photo.', true);
    }
  };

  return (
    <>
      <section className="mp-sec">
        <h2>You</h2>
        <div className="mp-you">
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT_PHOTO_TYPES}
            className="sr-only"
            onChange={(e) => {
              onFileChosen(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="mp-photo"
            title={d.page.avatarUrl ? 'Click to view or adjust photo' : 'Add a photo'}
            onClick={() => {
              if (d.page.avatarUrl) setViewOpen(true);
              else fileInput.current?.click();
            }}
          >
            {d.page.avatarUrl ? <img src={d.page.avatarUrl} alt="" /> : <span>{(d.page.name || '?').slice(0, 1)}</span>}
            <span className="mp-photo-badge" aria-hidden="true">
              <Icon name={d.page.avatarUrl ? 'eye' : 'plus'} size={18} />
            </span>
          </button>
          <div>
            <b>{d.page.name}</b>
            <div className="actions-row" style={{ margin: '3px 0 2px' }}>
              {d.page.avatarUrl ? (
                <>
                  <button type="button" className="btn sm quiet" onClick={() => setViewOpen(true)}><Icon name="eye" size={13} />View</button>
                  <button type="button" className="btn sm quiet" onClick={() => setCropSrc(d.page.avatarUrl)}><Icon name="crop" size={13} />Reposition</button>
                  <button type="button" className="btn sm quiet" onClick={() => fileInput.current?.click()}><Icon name="image" size={13} />Change</button>
                  <button type="button" className="btn sm quiet danger" onClick={removePhoto}><Icon name="trash" size={13} />Remove</button>
                </>
              ) : (
                <button type="button" className="btn sm quiet" onClick={() => fileInput.current?.click()}><Icon name="image" size={13} />Add photo</button>
              )}
            </div>
            <small className="muted">JPG, PNG or WEBP, up to 10 MB.</small>
          </div>
        </div>
        <AvatarViewerModal
          isOpen={viewOpen}
          name={d.page.name}
          username={d.username}
          src={d.page.avatarUrl || ''}
          onClose={() => setViewOpen(false)}
          onReposition={() => { if (d.page.avatarUrl) setCropSrc(d.page.avatarUrl); }}
          onChange={() => fileInput.current?.click()}
          onRemove={removePhoto}
        />
        <AvatarPositionModal
          isOpen={!!cropSrc}
          src={cropSrc}
          onClose={() => setCropSrc(null)}
          onSave={savePhoto}
        />
        <form className="acc-form" onSubmit={saveText}>
          <label className="field"><span>Bio <em>{f.bio.length}/280</em></span><textarea className="textarea" rows={3} maxLength={280} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} placeholder="Photo and video studio in Kathmandu. Weddings, brands, podcasts." /></label>
          <label className="field"><span>Location <em>optional</em></span><input className="input" maxLength={80} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Kathmandu, Nepal" /></label>
          <div><button className="btn sm primary">Save</button></div>
        </form>
      </section>
      <section className="mp-sec">
        <h2>Social links</h2>
        <p className="hint">Shown as icons under your name. A handle is enough: we make the link.</p>
        <ul className="mp-socials">
          {socials.map((s, i) => (
            <li key={i}>
              <Select label="Network" size="sm" width={150} value={s.kind} options={SOCIAL_OPTS.map(([v, l]) => ({ value: v, label: l }))} onChange={(v) => setSocials(socials.map((x, j) => (j === i ? { ...x, kind: v as SocialKind } : x)))} />
              <input className="input" value={s.url} placeholder={SOCIAL_OPTS.find((o) => o[0] === s.kind)?.[2]} onChange={(e) => setSocials(socials.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} aria-label="Handle or link" />
              <button className="icon-btn" aria-label="Remove" onClick={() => setSocials(socials.filter((_, j) => j !== i))}><Icon name="close" size={15} /></button>
            </li>
          ))}
        </ul>
        <div className="actions-row">
          <button className="btn sm" onClick={() => setSocials([...socials, { kind: (SOCIAL_OPTS.find(([k]) => !socials.some((s) => s.kind === k)) ?? SOCIAL_OPTS[0])[0], url: '' }])}><Icon name="plus" size={14} />Add a social</button>
          <button className="btn sm primary" onClick={saveSocials}>Save socials</button>
        </div>
      </section>
      <section className="mp-sec">
        <h2>Username</h2>
        <p className="hint">Your page is {location.host}/{d.username}, and your apps and short links live under it.</p>
        <div className="linkbox">
          <span className="addr-host mono">{location.host}/</span>
          <input
            className="input mono"
            value={uname}
            maxLength={50}
            disabled={!!d.usernameNextChange}
            onChange={(e) => setUname(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
            aria-label="Username"
          />
          <button
            className="btn sm"
            disabled={uname === d.username || uname.length < 2 || !!d.usernameNextChange}
            onClick={changeName}
          >
            Change
          </button>
        </div>
        {d.usernameNextChange ? (
          <p className="hint warn-text">
            Username can be changed once every 30 days. You can change yours again on{' '}
            <b>{new Date(d.usernameNextChange).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</b>{' '}
            ({Math.ceil((Date.parse(d.usernameNextChange) - Date.now()) / 864e5)} days left).
          </p>
        ) : (
          <p className="hint">
            You can change your username once every 30 days. If you change from <b>@{d.username}</b> to <b>@{uname || '...'}</b>, your old username <b>@{d.username}</b> is immediately released and becomes available for anyone else to take.
          </p>
        )}
      </section>
    </>
  );
}

/* ---------- design ---------- */
const TIER_NAME: Record<Tier, string> = { free: 'Free', plus: 'Plus', pro: 'Pro' };
function DesignTab({ d, run }: { d: EditorT; run: Run }) {
  const [html, setHtml] = useState(d.settings.customHtml || '');
  const custom = d.features.customPage;
  return (
    <>
      <section className="mp-sec">
        <h2>Layout</h2>
        <div className="mp-layouts" role="radiogroup" aria-label="Layout">
          {([['links', 'Links', 'A column of links, like a link in bio.'], ['profile', 'Profile', 'A fuller page: your name up top, links in a grid.']] as const).map(([k, l, t]) => (
            <button key={k} role="radio" aria-checked={d.settings.layout === k} className="mp-layout" onClick={() => run(api<EditorT>('PUT', '/api/me/page', { layout: k }))}>
              <span className={`mp-lthumb ${k}`} aria-hidden="true"><i /><i /><i /><i /></span><b>{l}</b><small>{t}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="mp-sec">
        <h2>Design <span className="muted small">{THEMES.filter((t) => canUseTheme(t.tier, d.features.themeTier)).length} of {THEMES.length} on your plan</span></h2>
        <div className="mp-themes">
          {THEMES.map((t) => {
            const ok = canUseTheme(t.tier, d.features.themeTier);
            const on = d.page.theme === t.id && !d.settings.useCustom;
            return (
              <button key={t.id} className={`mp-theme ${on ? 'on' : ''} ${ok ? '' : 'locked'}`} aria-pressed={on} title={ok ? t.blurb : `${t.name} is on ${TIER_NAME[t.tier]}`}
                onClick={() => (ok ? run(api<EditorT>('PUT', '/api/me/page', { theme: t.id, useCustom: false })) : undefined)}>
                <ThemeThumb id={t.id} />
                <span className="mp-tname">{t.name}{!ok && <PlanTag plan={TIER_NAME[t.tier]} />}</span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="mp-sec">
        <h2>Your own HTML {!custom && <PlanTag plan="Pro" />}</h2>
        <p className="hint">Replace the design with a page you wrote. Use <code>{'{{name}}'}</code>, <code>{'{{bio}}'}</code>, <code>{'{{avatar}}'}</code>, <code>{'{{links}}'}</code> and <code>{'{{socials}}'}</code>, or read <code>window.JHINO</code>. Links keep counting clicks. It runs sandboxed, so it cannot reach anyone's account.</p>
        <textarea className="textarea mono mp-html" rows={12} value={html} disabled={!custom} spellCheck={false} onChange={(e) => setHtml(e.target.value)} placeholder={custom ? 'Paste your HTML, or start from the example.' : 'Your own page design is on Pro.'} />
        {custom && (
          <div className="actions-row">
            {!html && <button className="btn sm" onClick={() => setHtml(d.starter)}>Start from an example</button>}
            <button className="btn sm" disabled={html === d.settings.customHtml} onClick={() => run(api<EditorT>('PUT', '/api/me/page', { customHtml: html }), 'HTML saved')}>Save HTML</button>
            <label className="check-row"><input type="checkbox" checked={d.settings.useCustom} disabled={!d.settings.customHtml} onChange={(e) => run(api<EditorT>('PUT', '/api/me/page', { useCustom: e.target.checked }), e.target.checked ? 'Your HTML is live' : 'Back to the design')} /><span>Use my HTML for my page</span></label>
          </div>
        )}
      </section>
      <section className="mp-sec">
        <h2>Jhino branding</h2>
        <p className="hint">{d.features.branding === 'none' ? 'Your page shows nothing of Jhino.' : d.features.branding === 'badge' ? 'A small "Made with jhino" at the foot of your page. Pro removes it.' : 'A "Made with jhino" badge and a small popup for visitors. Plus keeps just the badge; Pro removes both.'} {d.features.branding !== 'none' && <Link to="/account/plan" className="link">See plans</Link>}</p>
      </section>
    </>
  );
}

/* ---------- analytics ---------- */
interface StatsT { days: number; maxDays: number; totals: { views: number; visitors: number; clicks: number; ctr: number }; series: { day: string; views: number; visitors: number; clicks: number }[];
  items: { id: string; type: string; title: string; url: string | null; clicks: number }[]; refs: { value: string; n: number }[]; devices: { value: string; n: number }[]; countries: { value: string; n: number }[]; shortLinks: { code: string; url: string; clicks: number }[] }
function AnalyticsTab({ d }: { d: EditorT }) {
  const [days, setDays] = useState(Math.min(30, d.features.analyticsDays));
  const [s, setS] = useState<StatsT | null>(null);
  useEffect(() => { setS(null); get<StatsT>(`/api/me/page/analytics?days=${days}`).then(setS, () => {}); }, [days]);
  const ranges = [7, 30, 90, 365];
  const max = s ? Math.max(1, ...s.series.map((x) => Math.max(x.views, x.clicks))) : 1;
  const itemTitle = (i: StatsT['items'][number]) => i.title || (i.url ? hostOf(i.url) : i.type);
  const bar = (list: { value: string; n: number }[], label: (v: string) => ReactNode = (v) => v) => {
    const top = Math.max(1, ...list.map((x) => x.n));
    return !list.length ? <p className="muted small">Nothing yet.</p> : (
      <ul className="an-bars">{list.map((x) => <li key={x.value}><span className="an-l">{label(x.value)}</span><span className="an-track"><i style={{ transform: `scaleX(${x.n / top})` }} /></span><span className="mono an-n">{x.n.toLocaleString('en-IN')}</span></li>)}</ul>
    );
  };
  return (
    <>
      <div className="an-head">
        <div className="seg" role="group" aria-label="Range">
          {ranges.map((r) => {
            const ok = r <= d.features.analyticsDays;
            return <button key={r} aria-pressed={days === r} disabled={!ok} title={ok ? undefined : 'A longer history is on a higher plan'} onClick={() => setDays(r)}>{r === 365 ? '1 year' : `${r} days`}</button>;
          })}
        </div>
        {d.features.analyticsDays < 365 && <span className="hint">Your plan keeps {d.features.analyticsDays} days. <Link to="/account/plan" className="link">More</Link></span>}
      </div>
      {!s ? <div className="acc-skel" /> : (
        <>
          <dl className="kpi-strip an-kpis">
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
              {!s.items.length ? <p className="muted small">Add links to your page to see which get clicked.</p> : (
                <table className="adm-table"><thead><tr><th>Link</th><th>Clicks</th><th>Rate</th></tr></thead>
                  <tbody>{s.items.map((i) => <tr key={i.id}><td className="small url-cell" title={i.url ?? ''}>{itemTitle(i)}</td><td className="mono">{i.clicks}</td><td className="mono small">{s.totals.views ? Math.round((i.clicks / s.totals.views) * 1000) / 10 : 0}%</td></tr>)}</tbody></table>
              )}
            </section>
            <section className="dpanel"><div className="panel-h"><h2>Where visitors came from</h2></div>{bar(s.refs)}</section>
            <section className="dpanel"><div className="panel-h"><h2>Devices</h2></div>{bar(s.devices)}</section>
            <section className="dpanel"><div className="panel-h"><h2>Countries</h2></div>{bar(s.countries, (c) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(c) ?? c; } catch { return c; } })}</section>
            {!!s.shortLinks.length && <section className="dpanel"><div className="panel-h"><h2>Short links</h2><Link to="/links" className="link small">All links</Link></div>{bar(s.shortLinks.map((l) => ({ value: `/${l.code}`, n: l.clicks })))}</section>}
          </div>
        </>
      )}
    </>
  );
}

/* ---------- share ---------- */
function ShareTab({ d, run }: { d: EditorT; run: Run }) {
  const toast = useToast();
  const base = `${location.origin}/${d.username}`;
  const links: [string, string, string][] = [
    ['Your page', base, `Opens as ${d.settings.layout === 'profile' ? 'a profile' : 'a list of links'}, the layout you chose.`],
    ['As a list of links', `${base}?view=links`, 'For a bio link on Instagram or TikTok.'],
    ['As a profile', `${base}?view=profile`, 'For your email signature or a proposal.'],
  ];
  const share = async (url: string) => {
    if (navigator.share) { try { await navigator.share({ title: d.page.name, url }); return; } catch { /* closed */ } }
    await copyText(url); toast('Link copied');
  };
  return (
    <>
      <section className="mp-sec">
        <h2>Share your page</h2>
        <ul className="mp-share">
          {links.map(([l, u, t]) => (
            <li key={u}><div><b>{l}</b><small className="muted">{t}</small><span className="mono small">{u.replace(/^https?:\/\//, '')}</span></div>
              <div className="actions-row"><button className="btn sm" onClick={() => copyText(u).then(() => toast('Link copied'))}><Icon name="copy" size={14} />Copy</button><button className="btn sm quiet" onClick={() => share(u)}>Share…</button></div></li>
          ))}
        </ul>
      </section>
      <section className="mp-sec">
        <h2>Who can see it</h2>
        <label className="check-row"><input type="checkbox" checked={d.settings.published} onChange={(e) => run(api<EditorT>('PUT', '/api/me/page', { published: e.target.checked }), e.target.checked ? 'Your page is public' : 'Your page is hidden')} /><span>Anyone can see my page at jhino.com/{d.username}</span></label>
        <p className="hint">Hidden, it says "There is no page here" to everyone but you. Your apps and short links keep working either way.</p>
      </section>
    </>
  );
}
