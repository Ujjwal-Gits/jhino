import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, avatarUrl, get, post, type AppSummary } from '../api';
import { Link, useRoute, useSession } from '../context';
import { live } from '../live';
import { Avatar, Icon, Menu, Modal, ago, useToast } from '../ui';
import { AddressField, OpenChoice, addrBase, addressPayload, openReady, slugify, useNameCheck, type OpenSettings } from './Address';

/* ---------- upload ---------- */
export function UploadDialog({ file: initial, onClose, replaceAppId }: { file?: File | null; onClose: () => void; replaceAppId?: string }) {
  const { go } = useRoute();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(initial ?? null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [limitHit, setLimitHit] = useState(false);
  const [slug, setSlug] = useState('');
  const [open, setOpen] = useState<OpenSettings>({ access: 'public', password: '' });
  const check = useNameCheck(slug);
  const input = useRef<HTMLInputElement>(null);
  const suggest = (f: File | null) => { if (f && !slug && !replaceAppId) setSlug(''); };

  const { user } = useSession();
  const maxMB = user.isAdmin ? null : user.features?.maxUploadMB ?? null;
  const submit = async () => {
    if (!file) return;
    if (maxMB && file.size > maxMB * 1048576) { setError(`That file is ${(file.size / 1048576).toFixed(1)} MB. Your plan allows up to ${maxMB} MB for one upload.`); setLimitHit(true); return; }
    setBusy(true); setError('');
    const fd = new FormData();
    if (!replaceAppId) {
      // Fields go before the file: the server reads them first.
      fd.append('name', name);
      if (slug) { const a = addressPayload(slug, open); fd.append('slug', slug); fd.append('access', a.access); if (a.password) fd.append('password', a.password); }
    }
    fd.append('file', file);
    try {
      const r = await api<{ app: AppSummary }>('POST', replaceAppId ? `/api/apps/${replaceAppId}/versions` : '/api/apps', fd);
      onClose();
      if (replaceAppId) toast(`Version ${r.app.liveVersion} is live. Saved data was kept.`);
      else { toast(`${r.app.name} is live.`); go(`/apps/${r.app.id}`); }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Upload failed.');
      setLimitHit(e instanceof ApiError && e.code === 'LIMIT_REACHED');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={replaceAppId ? 'Upload a new version' : 'Upload HTML'}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={!file || busy || (!replaceAppId && !openReady(slug, check, open))}>
          {busy && <span className="spin" />}{replaceAppId ? 'Publish version' : 'Upload and publish'}
        </button>
      </>}
    >
      <div className="modal-body">
        <input ref={input} type="file" accept=".html,.htm,.zip,text/html,application/zip" hidden onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); suggest(f); setError(''); }} />
        <button
          type="button"
          className="drop"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, padding: 20, textAlign: 'left', width: '100%' }}
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { setFile(f); setError(''); } }}
        >
          {file ? (
            <>
              <b style={{ fontWeight: 600 }}>{file.name}</b>
              <span className="mono muted">{(file.size / 1024).toFixed(0)} KB · choose another</span>
            </>
          ) : (
            <>
              <b style={{ fontWeight: 600 }}>Choose an .html file or a .zip</b>
              <span className="hint">Or drop it here. A ZIP needs an index.html inside.{maxMB ? ` Up to ${maxMB} MB.` : ''}</span>
            </>
          )}
        </button>
        {!replaceAppId && (
          <>
            <label className="field">
              <span>Name <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Uses the page title" />
            </label>
            <AddressField value={slug} onChange={setSlug} check={check} />
            {!slug && file && <button type="button" className="link addr-suggest" onClick={() => setSlug(slugify(name || file.name.replace(/\.(zip|html?)$/i, '')))}>Use {addrBase(user.username)}/{slugify(name || file.name.replace(/\.(zip|html?)$/i, '')) || 'my-app'}</button>}
            {slug && <OpenChoice value={open} onChange={setOpen} compact />}
          </>
        )}
        {replaceAppId && <p className="hint">Everyone gets the new version. Saved data stays as it is.</p>}
        {error && <p className="error-text" role="alert">{error}{limitHit && <> <Link to="/account/plan" className="link" onClick={onClose}>See plans</Link></>}</p>}
      </div>
    </Modal>
  );
}

/* ---------- shell ---------- */
export function Shell({ children }: { children: ReactNode }) {
  const { user, refresh } = useSession();
  const { path, go } = useRoute();
  const [menuFor, setMenuFor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<'upload' | null>(null);
  const [dropped, setDropped] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  // Drop an app anywhere on the page to upload it.
  useEffect(() => {
    let depth = 0;
    const hasFile = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    if (!user.canCreate) return; // clients open shared apps only
    const enter = (e: DragEvent) => { if (hasFile(e) && !dialog) { depth++; setDragging(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const over = (e: DragEvent) => { if (hasFile(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFile(e) || dialog) return;
      e.preventDefault(); depth = 0; setDragging(false);
      const f = e.dataTransfer?.files[0];
      if (f) { setDropped(f); setDialog('upload'); }
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over); window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over); window.removeEventListener('drop', drop);
    };
  }, [dialog, user.canCreate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (user.canCreate && e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !document.querySelector('dialog[open]')) {
        e.preventDefault(); go('/build');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const tab = (to: string, label: string, cls = '') => (
    <Link to={to} className={`tab ${cls}`} aria-current={path === to ? 'page' : undefined}>{label}</Link>
  );

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to={user.username ? `/${user.username}` : '/apps'} className="wordmark" aria-label="Your Jhino home">jhino<i /></Link>
          {user.canCreate ? (
            <nav className="tabs" aria-label="Apps">
              {user.username && tab(`/${user.username}`, 'My page')}
              {tab('/apps', 'My apps')}
              {tab('/shared', 'Shared with me')}
              {tab('/links', 'Links')}
              {tab('/trash', 'Trash', 'tab-trash')}
            </nav>
          ) : <span className="who-tag hide-sm">Apps shared with you</span>}
          <div className="spacer" />
          {user.canCreate && (
            <div className="home-actions">
              <button className="btn primary sm" onClick={() => { setDropped(null); setDialog('upload'); }} aria-label="Upload HTML or ZIP">
                <Icon name="upload" size={16} /><span className="new-label">Upload HTML</span><span className="up-label">Upload</span>
              </button>
              <button className="btn sm" onClick={() => go('/build')} aria-keyshortcuts="n" aria-label="Create app">
                <Icon name="plus" size={16} /><span className="new-label">Create app</span>
              </button>
            </div>
          )}
          <Bell />
          <button className="avatar-btn" onClick={(e) => setMenuFor(e.currentTarget)} aria-label="Account menu" aria-haspopup="menu" aria-expanded={!!menuFor}>
            <Avatar name={user.name} src={avatarUrl(user)} />
          </button>
        </div>
      </header>
      {menuFor && (
        <Menu anchor={menuFor} onClose={() => setMenuFor(null)}>
          <div className="who"><b>{user.displayName || user.name}</b><span>{user.email}</span></div>
          <button role="menuitem" onClick={() => go('/account/profile')}><Icon name="user" size={16} />Profile</button>
          {user.username && <button role="menuitem" onClick={() => go(`/${user.username}`)}><Icon name="user" size={16} />My page</button>}
          {user.canCreate && <button role="menuitem" onClick={() => go('/apps')}><Icon name="grid" size={16} />My creations</button>}
          <button role="menuitem" onClick={() => go('/')}><Icon name="globe" size={16} />Jhino website</button>
          {user.canCreate && <button role="menuitem" onClick={() => go('/account/plan')}><Icon name="chart" size={16} />Plan & usage</button>}
          {user.canCreate && <button role="menuitem" onClick={() => go('/account/billing')}><Icon name="card" size={16} />Billing</button>}
          <button role="menuitem" onClick={() => go('/account/notifications')}><Icon name="bell" size={16} />Notifications</button>
          <button role="menuitem" onClick={() => go('/account/security')}><Icon name="shield" size={16} />Security</button>
          <button role="menuitem" onClick={() => go('/account/account')}><Icon name="settings" size={16} />Settings</button>
          <button role="menuitem" onClick={() => go('/help')}><Icon name="help" size={16} />Help & support</button>
          {user.canCreate && <button role="menuitem" className="tab-trash-menu" onClick={() => go('/trash')}><Icon name="trash" size={16} />Trash</button>}
          {user.isAdmin && <><hr /><button role="menuitem" onClick={() => go('/admin')}><Icon name="lock" size={16} />Super Admin</button></>}
          <hr />
          <button role="menuitem" onClick={async () => { await post('/api/auth/logout'); await refresh(); go('/login', true); }}><Icon name="logout" size={16} />Log out</button>
        </Menu>
      )}
      {children}
      {dialog === 'upload' && <UploadDialog file={dropped} onClose={() => setDialog(null)} />}
      {dragging && <div className="dropping-overlay">Drop to upload your app</div>}
    </>
  );
}

/* ---------- the bell: payments, reminders, security and support notices ---------- */
interface Note { id: number; category: string; title: string; body: string; link: string | null; createdAt: string; readAt: string | null }
function Bell() {
  const { go } = useRoute();
  const [items, setItems] = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState<HTMLElement | null>(null);
  const load = () => get<{ items: Note[]; unread: number }>('/api/notifications').then((r) => { setItems(r.items); setUnread(r.unread); }, () => {});
  useEffect(() => { load(); }, []);
  useEffect(() => live.on((e) => { if (e === 'notification') load(); }), []);
  const openItem = async (n: Note) => {
    setOpen(null);
    if (!n.readAt) post('/api/notifications/read', { ids: [n.id] }).then(load, () => {});
    if (n.link && n.link.startsWith('/')) go(n.link);
  };
  return (
    <>
      <button className="icon-btn bell" onClick={(e) => setOpen(e.currentTarget)} aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'} aria-haspopup="menu" aria-expanded={!!open}>
        <Icon name="bell" />{unread > 0 && <span className="bell-n">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <Menu anchor={open} onClose={() => setOpen(null)}>
          <div className="notes-h"><b>Notifications</b>{unread > 0 && <button className="link" onClick={(e) => { e.stopPropagation(); post('/api/notifications/read', { all: true }).then(load); }}>Mark all read</button>}</div>
          {!items.length ? <p className="notes-empty muted">Nothing yet. Payments, booking reminders and account notices show up here.</p> : (
            <div className="notes">
              {items.slice(0, 12).map((n) => (
                <button key={n.id} role="menuitem" className={`note ${n.readAt ? '' : 'unread'}`} onClick={() => openItem(n)}>
                  <b>{n.title}</b>{n.body && <span>{n.body}</span>}<small className="muted">{ago(n.createdAt)}</small>
                </button>
              ))}
            </div>
          )}
        </Menu>
      )}
    </>
  );
}
