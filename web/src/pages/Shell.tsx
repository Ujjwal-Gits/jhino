import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, post, type AppSummary } from '../api';
import { Link, applyTheme, readTheme, useRoute, useSession, type Theme } from '../context';
import { Avatar, Icon, Menu, Modal, useToast } from '../ui';

/* ---------- upload ---------- */
export function UploadDialog({ file: initial, onClose, replaceAppId }: { file?: File | null; onClose: () => void; replaceAppId?: string }) {
  const { go } = useRoute();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(initial ?? null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true); setError('');
    const fd = new FormData();
    if (!replaceAppId) fd.append('name', name);
    fd.append('file', file);
    try {
      const r = await api<{ app: AppSummary }>('POST', replaceAppId ? `/api/apps/${replaceAppId}/versions` : '/api/apps', fd);
      onClose();
      if (replaceAppId) toast(`Version ${r.app.liveVersion} is live. Saved data was kept.`);
      else { toast(`${r.app.name} is live.`); go(`/apps/${r.app.id}`); }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Upload failed.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={replaceAppId ? 'Upload a new version' : 'Upload HTML'}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={!file || busy}>
          {busy && <span className="spin" />}{replaceAppId ? 'Publish version' : 'Upload and publish'}
        </button>
      </>}
    >
      <div className="modal-body">
        <input ref={input} type="file" accept=".html,.htm,.zip,text/html,application/zip" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(''); }} />
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
              <span className="hint">Or drop it here. A ZIP needs an index.html inside.</span>
            </>
          )}
        </button>
        {!replaceAppId && (
          <label className="field">
            <span>Name <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Uses the page title" />
          </label>
        )}
        {replaceAppId && <p className="hint">Everyone gets the new version. Saved data stays as it is.</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

/* ---------- account ---------- */
function AccountDialog({ onClose }: { onClose: () => void }) {
  const { user, refresh } = useSession();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [theme, setTheme] = useState<Theme>(readTheme());
  const [pw, setPw] = useState({ current: '', next: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true); setError('');
    try {
      const body: Record<string, string> = {};
      if (name.trim() !== user.name) body.name = name;
      if (pw.next) { body.currentPassword = pw.current; body.newPassword = pw.next; }
      if (Object.keys(body).length) await api('PATCH', '/api/me', body);
      await refresh();
      toast('Saved');
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
      setBusy(false);
    }
  };

  return (
    <Modal title="Your account" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>{busy && <span className="spin" />}Save</button>
    </>}>
      <div className="modal-body">
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="field"><span>Sign-in ID</span><p className="mono">{user.email}</p></div>
        <div className="field">
          <span>Appearance on this device</span>
          <div className="seg" style={{ marginLeft: 0, width: 'max-content' }} role="group" aria-label="Appearance">
            {(['light', 'dark', 'system'] as Theme[]).map((t) => (
              <button key={t} style={{ width: 'auto', padding: '0 12px', fontSize: 13 }} aria-pressed={theme === t} onClick={() => { setTheme(t); applyTheme(t); }}>
                {t === 'system' ? 'Match device' : t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          <legend className="section-title" style={{ padding: 0 }}>Change password</legend>
          <label className="field"><span>Current password</span><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
          <label className="field"><span>New password</span><input className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /><small className="hint">At least 10 characters. Leave empty to keep your password.</small></label>
        </fieldset>
        {error && <p className="error-text" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

/* ---------- shell ---------- */
export function Shell({ children }: { children: ReactNode }) {
  const { user, refresh } = useSession();
  const { path, go } = useRoute();
  const [menuFor, setMenuFor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<'upload' | 'account' | null>(null);
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
          <Link to="/" className="wordmark" aria-label="Jhino home">jhino<i /></Link>
          {user.canCreate ? (
            <nav className="tabs" aria-label="Apps">
              {tab('/', 'My apps')}
              {tab('/shared', 'Shared with me')}
              {tab('/trash', 'Trash', 'tab-trash')}
            </nav>
          ) : <span className="who-tag hide-sm">Apps shared with you</span>}
          <div className="spacer" />
          {user.canCreate && (
            <div className="home-actions">
              <button className="btn primary sm" onClick={() => { setDropped(null); setDialog('upload'); }} aria-label="Upload HTML or ZIP">
                <Icon name="upload" size={16} /><span className="new-label">Upload HTML</span><span className="up-label">Upload</span>
              </button>
              <button className="btn sm" onClick={() => go('/build')} aria-keyshortcuts="n" aria-label="Create HTML">
                <Icon name="plus" size={16} /><span className="new-label">Create HTML</span>
              </button>
            </div>
          )}
          <button className="avatar-btn" onClick={(e) => setMenuFor(e.currentTarget)} aria-label="Account menu" aria-haspopup="menu" aria-expanded={!!menuFor}>
            <Avatar name={user.name} />
          </button>
        </div>
      </header>
      {menuFor && (
        <Menu anchor={menuFor} onClose={() => setMenuFor(null)}>
          <div className="who"><b>{user.name}</b><span>{user.email}</span></div>
          <button role="menuitem" onClick={() => setDialog('account')}>Account and appearance</button>
          {user.isAdmin && <button role="menuitem" onClick={() => go('/people')}>People</button>}
          {user.canCreate && <button role="menuitem" className="tab-trash-menu" onClick={() => go('/trash')}>Trash</button>}
          <hr />
          <button role="menuitem" onClick={async () => { await post('/api/auth/logout'); await refresh(); go('/', true); }}>Sign out</button>
        </Menu>
      )}
      {children}
      {dialog === 'upload' && <UploadDialog file={dropped} onClose={() => setDialog(null)} />}
      {dialog === 'account' && <AccountDialog onClose={() => setDialog(null)} />}
      {dragging && <div className="dropping-overlay">Drop to upload your app</div>}
    </>
  );
}
