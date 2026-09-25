import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, get, post, type AppDetail, type Role } from '../api';
import { useSession } from '../context';
import { Avatar, Icon, Modal, Select, ago, copyText, useToast } from '../ui';
import { downloadHtml } from './Player';
import { AddressField, HOST, PlanTag, addrBase, slugify, useNameCheck } from './Address';

interface InviteRow { id: string; role: Role; createdAt: string; expiresAt: string; usedAt: string | null; revokedAt: string | null; usedBy: string | null }
interface Member { id: string; name: string; email: string; role: Role; madeByMe?: boolean }

export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', editor: 'Can edit', contributor: 'Can add', viewer: 'Can view' };
const ROLE_HELP: Record<Exclude<Role, 'owner'>, string> = {
  editor: 'Add, change, approve and comment on anything, including photos, videos and files. Best for clients.',
  contributor: 'Add new items and change only their own or ones assigned to them.',
  viewer: 'Open the app and read. No changes.',
};
const ROLES: Exclude<Role, 'owner'>[] = ['editor', 'contributor', 'viewer'];

function RoleSelect({ value, onChange, label, sdk }: { value: Role; onChange: (r: Role) => void; label: string; sdk: boolean }) {
  return (
    <Select label={label} size="sm" width={124} value={value} onChange={(v) => onChange(v as Role)}
      options={ROLES.filter((r) => sdk || r !== 'contributor').map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
  );
}

export function ShareDialog({ app, onClose }: { app: AppDetail; onClose: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const sdk = !!(app.features?.jhinoSdk || app.built);
  const [members, setMembers] = useState<Member[]>(app.members as Member[]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [mode, setMode] = useState<'create' | 'existing' | 'link'>('create');
  const [form, setForm] = useState({ name: '', login: '', password: '', role: 'editor' as Role });
  const [existing, setExisting] = useState({ login: '', role: 'editor' as Role });
  const [linkRole, setLinkRole] = useState<Role>('editor');
  const [link, setLink] = useState('');
  const [secret, setSecret] = useState<{ name: string; login: string; password: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [a, i] = await Promise.all([get<{ app: AppDetail }>(`/api/apps/${app.id}`), get<{ invites: InviteRow[] }>(`/api/apps/${app.id}/invites`)]);
    setMembers(a.app.members as Member[]);
    setInvites(i.invites);
  }, [app.id]);
  useEffect(() => { reload().catch(() => {}); }, [reload]);

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Something went wrong.');
  const appUrl = `${location.origin}/apps/${app.id}`;
  const credText = (s: { name: string; login: string; password: string }) =>
    `${app.name}\nOpen: ${appUrl}\nSign-in ID: ${s.login}\nPassword: ${s.password}\n\nYou can change the password after signing in.`;

  const create = async () => {
    setBusy(true); setError('');
    try {
      const r = await post<{ person: { name: string; login: string }; password: string }>(`/api/apps/${app.id}/people`, {
        name: form.name, login: form.login.trim(), password: form.password || undefined, role: form.role,
      });
      setSecret({ name: r.person.name, login: r.person.login, password: r.password });
      setForm({ ...form, name: '', login: '', password: '' });
      reload();
    } catch (e) { fail(e); }
    setBusy(false);
  };
  const addExisting = async () => {
    setBusy(true); setError('');
    try { await post(`/api/apps/${app.id}/members`, { email: existing.login.trim(), role: existing.role }); setExisting({ ...existing, login: '' }); toast('Added'); reload(); }
    catch (e) { fail(e); }
    setBusy(false);
  };
  const createLink = async () => {
    setBusy(true); setError('');
    try {
      const r = await post<{ url: string }>(`/api/apps/${app.id}/invites`, { role: linkRole, days: 7 });
      setLink(r.url);
      await copyText(r.url);
      toast('Invite link copied');
      reload();
    } catch (e) { fail(e); }
    setBusy(false);
  };
  const change = async (uid: string, role: Role) => {
    try { await api('PATCH', `/api/apps/${app.id}/members/${uid}`, { role }); toast('Access changed'); reload(); } catch (e) { fail(e); }
  };
  const remove = async (m: Member) => {
    if (!confirm(`Remove ${m.name}? They lose access right away, on the web and in any downloaded HTML file. Anything they already saw cannot be taken back.`)) return;
    try { await api('DELETE', `/api/apps/${app.id}/members/${m.id}`); toast(`${m.name} removed`); reload(); } catch (e) { fail(e); }
  };
  const resetPassword = async (m: Member) => {
    if (!confirm(`Make a new password for ${m.name}? Their old password stops working and they are signed out.`)) return;
    try { const r = await post<{ password: string; login: string }>(`/api/apps/${app.id}/people/${m.id}/password`); setSecret({ name: m.name, login: r.login, password: r.password }); }
    catch (e) { fail(e); }
  };
  const revoke = async (inviteId: string) => {
    try { await api('DELETE', `/api/apps/${app.id}/invites/${inviteId}`); reload(); } catch (e) { fail(e); }
  };
  const open = invites.filter((i) => !i.usedAt && !i.revokedAt && Date.parse(i.expiresAt) > Date.now());

  return (
    <Modal title={`Share ${app.name}`} onClose={onClose} wide>
      <div className="modal-body" style={{ gap: 22 }}>
        <p className="callout"><Icon name="key" size={15} /> Only people on this list can open this app, and each signs in with their own ID and password. A copied link alone never gives access.</p>
        <LinkSharing appId={app.id} appName={app.name} />
        <div className="share-file">
          <div>
            <b>Send it as an HTML file {!user.features?.download && <PlanTag />}</b>
            <span className="hint">They open the file, sign in once, and use the same app, live with you. It needs the internet.</span>
          </div>
          <button className="btn sm" disabled={!user.features?.download} onClick={async () => { const fail = await downloadHtml(app.id); if (fail) toast(fail, true); }}><Icon name="download" size={15} />Download HTML file</button>
        </div>

        {secret ? (
          <section className="cred" aria-live="polite">
            <p className="section-title">Sign-in for {secret.name}</p>
            <div className="code" style={{ fontSize: 13 }}>{credText(secret)}</div>
            <div className="linkbox" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={() => copyText(credText(secret)).then(() => toast('Copied. Send it privately.'))}><Icon name="copy" size={16} />Copy sign-in details</button>
              <button className="btn quiet" onClick={() => setSecret(null)}>Done</button>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>The password is shown only now. Send it privately, for example in a direct message.</p>
          </section>
        ) : (
          <section>
            <div className="seg" role="tablist" aria-label="How to add someone" style={{ marginLeft: 0, marginBottom: 14 }}>
              {([['create', 'Create a sign-in'], ['existing', 'Existing account'], ['link', 'Invite link']] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={mode === k} aria-pressed={mode === k} style={{ width: 'auto', padding: '0 12px', fontSize: 13 }} onClick={() => { setMode(k); setError(''); }}>{l}</button>
              ))}
            </div>

            {mode === 'create' && (
              <form className="share-form" onSubmit={(e) => { e.preventDefault(); create(); }}>
                <div className="grid2">
                  <label className="field"><span>Name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sita Sharma" /></label>
                  <label className="field"><span>Sign-in ID</span><input className="input" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} placeholder="sita or sita@company.com" autoComplete="off" /></label>
                  <label className="field"><span>Password <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></span><input className="input" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Leave empty to generate one" autoComplete="new-password" /></label>
                  <label className="field"><span>Access</span><RoleSelect value={form.role} onChange={(role) => setForm({ ...form, role })} label="Access" sdk={sdk} /></label>
                </div>
                <p className="hint">{ROLE_HELP[form.role as Exclude<Role, 'owner'>]}</p>
                <div><button className="btn primary" disabled={busy || !form.name.trim() || form.login.trim().length < 3}>{busy && <span className="spin" />}Create sign-in</button></div>
              </form>
            )}

            {mode === 'existing' && (
              <form className="linkbox" onSubmit={(e) => { e.preventDefault(); addExisting(); }}>
                <input className="input" placeholder="Their sign-in ID or email" value={existing.login} onChange={(e) => setExisting({ ...existing, login: e.target.value })} aria-label="Sign-in ID or email" />
                <RoleSelect value={existing.role} onChange={(role) => setExisting({ ...existing, role })} label="Access" sdk={sdk} />
                <button className="btn primary" disabled={busy || existing.login.trim().length < 3}>Add</button>
              </form>
            )}

            {mode === 'link' && (
              <div>
                <div className="linkbox">
                  <RoleSelect value={linkRole} onChange={setLinkRole} label="Access for the link" sdk={sdk} />
                  {link
                    ? <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
                    : <span className="hint" style={{ alignSelf: 'center', flex: 1 }}>The person opens it once, creates their own password, and joins. Expires in 7 days.</span>}
                  <button className="btn primary" onClick={link ? () => copyText(link).then(() => toast('Copied')) : createLink} disabled={busy}>
                    <Icon name={link ? 'copy' : 'plus'} size={16} />{link ? 'Copy' : 'Create link'}
                  </button>
                </div>
                {link && <button className="btn quiet sm" style={{ marginTop: 6 }} onClick={() => setLink('')}>Make another link</button>}
              </div>
            )}
          </section>
        )}

        {error && <p className="error-text" role="alert">{error}</p>}

        <section>
          <p className="section-title">People with access <span className="mono muted">{members.length}</span></p>
          <div className="lines">
            {members.map((m) => (
              <div className="line" key={m.id}>
                <Avatar name={m.name} />
                <div className="grow">
                  <b>{m.name}{m.id === user.id ? ' (you)' : ''}</b>
                  <div className="sub mono">{m.email}</div>
                </div>
                {m.role === 'owner' ? <span className="hint">Owner</span> : (
                  <>
                    {m.madeByMe && <button className="btn sm quiet" onClick={() => resetPassword(m)}>New password</button>}
                    <RoleSelect value={m.role} onChange={(r) => change(m.id, r)} label={`Access for ${m.name}`} sdk={sdk} />
                    <button className="btn sm quiet danger" onClick={() => remove(m)} aria-label={`Remove ${m.name}`}>Remove</button>
                  </>
                )}
              </div>
            ))}
            {open.map((i) => (
              <div className="line" key={i.id}>
                <span className="avatar" style={{ background: 'transparent', borderStyle: 'dashed' }} aria-hidden="true" />
                <div className="grow">
                  <b>Unused invite link</b>
                  <div className="sub">{ROLE_LABEL[i.role]} · made {ago(i.createdAt)} · expires {new Date(i.expiresAt).toLocaleDateString()}</div>
                </div>
                <button className="btn sm quiet" onClick={() => revoke(i.id)}>Turn off</button>
              </div>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            {sdk ? 'In sections marked "people see only their own", Can add and Can view people see just what they added or what names them. Everything else is visible to everyone here.' : 'Everyone here can see all of this app’s saved data.'}
          </p>
        </section>
      </div>
    </Modal>
  );
}

/* ---------- the app's own address: jhino.com/<name> ---------- */
function AddressSection({ appId, appName, sharing, onChange }: { appId: string; appName: string; sharing: SharingT; onChange: (s: SharingT) => void }) {
  const toast = useToast();
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<'standard' | 'root'>(user.isAdmin && sharing.rootSlug ? 'root' : 'standard');
  const [slug, setSlug] = useState(sharing.rootSlug ?? sharing.slug ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const currentSlug = mode === 'root' ? (sharing.rootSlug ?? '') : (sharing.slug ?? '');
  const isDirect = mode === 'root';
  const check = useNameCheck(editing && slug !== currentSlug ? slug : '', { app: appId, top: isDirect });

  const handleModeChange = (nextMode: 'standard' | 'root') => {
    setMode(nextMode);
    setSlug(nextMode === 'root' ? (sharing.rootSlug ?? slugify(appName)) : (sharing.slug ?? slugify(appName)));
    setError('');
  };

  const save = async (next: string | null) => {
    setBusy(true); setError('');
    try {
      // An address is for opening without being added: a private app opens to anyone with it.
      const body = next
        ? { mode, slug: next, access: sharing.access === 'private' ? 'public' : undefined }
        : { mode, slug: null };
      const r = await api<SharingT>('PUT', `/api/apps/${appId}/address`, body);
      onChange(r);
      setEditing(false);
      const liveUrl = mode === 'root' ? r.rootUrl : r.slugUrl;
      toast(next ? `Live at ${liveUrl || r.rootUrl || r.slugUrl}` : 'Address removed');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save.'); }
    setBusy(false);
  };

  const activeUrl = sharing.rootUrl || sharing.slugUrl;

  return (
    <div className="addr-sec">
      <p className="section-title">Address</p>
      {!editing ? (
        activeUrl ? (
          <div className="linkbox-stack" style={{ display: 'grid', gap: 8 }}>
            {sharing.rootUrl && (
              <div>
                {user.isAdmin && <div className="hint" style={{ marginBottom: 4, fontSize: 12 }}>Direct address</div>}
                <div className="linkbox">
                  <input
                    className="input mono"
                    readOnly
                    value={sharing.rootUrl}
                    onClick={() => { setMode('root'); setSlug(sharing.rootSlug ?? ''); setEditing(true); }}
                    aria-label="Direct address"
                    style={{ cursor: 'pointer' }}
                    title="Click to edit address"
                  />
                  <a href={sharing.rootUrl} target="_blank" rel="noopener noreferrer" className="btn sm" title="Browse / open address in new tab">
                    <Icon name="external" size={14} />Browse
                  </a>
                  <button className="btn sm" type="button" onClick={() => copyText(sharing.rootUrl!).then(() => toast('Address copied'))}>
                    <Icon name="copy" size={15} />Copy
                  </button>
                  <button className="btn sm quiet" type="button" onClick={() => { setMode('root'); setSlug(sharing.rootSlug ?? ''); setEditing(true); }}>
                    Change
                  </button>
                </div>
              </div>
            )}
            {sharing.slugUrl && (!sharing.rootUrl || user.isAdmin) && (
              <div>
                {user.isAdmin && sharing.rootUrl && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>Standard user URL</div>}
                <div className="linkbox">
                  <input
                    className="input mono"
                    readOnly
                    value={sharing.slugUrl}
                    onClick={() => { setMode('standard'); setSlug(sharing.slug ?? ''); setEditing(true); }}
                    aria-label="Standard address"
                    style={{ cursor: 'pointer' }}
                    title="Click to edit address"
                  />
                  <a href={sharing.slugUrl} target="_blank" rel="noopener noreferrer" className="btn sm" title="Browse / open address in new tab">
                    <Icon name="external" size={14} />Browse
                  </a>
                  <button className="btn sm" type="button" onClick={() => copyText(sharing.slugUrl!).then(() => toast('Address copied'))}>
                    <Icon name="copy" size={15} />Copy
                  </button>
                  <button className="btn sm quiet" type="button" onClick={() => { setMode('standard'); setSlug(sharing.slug ?? ''); setEditing(true); }}>
                    Change
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="addr-empty">
            <span className="hint">
              Give it its own address{user.isAdmin ? ', like a direct root URL or under your username' : `, like ${addrBase(user.username)}/${slugify(appName) || 'your-studio'}`}. It opens at exactly that address.
            </span>
            <button className="btn sm" type="button" onClick={() => { setMode(user.isAdmin ? 'root' : 'standard'); setSlug(slugify(appName)); setEditing(true); }}>
              <Icon name="globe" size={15} />Add address
            </button>
          </div>
        )
      ) : (
        <form className="addr-edit" onSubmit={(e) => { e.preventDefault(); if (slug) save(slug); }}>
          {user.isAdmin && (
            <div className="field">
              <span>Format</span>
              <Select<'standard' | 'root'>
                label="Format"
                value={mode}
                options={[
                  { value: 'standard', label: 'Standard' },
                  { value: 'root', label: 'Direct' },
                ]}
                onChange={(next) => handleModeChange(next)}
              />
            </div>
          )}
          <AddressField
            value={slug}
            onChange={setSlug}
            check={slug === currentSlug ? { state: 'ok' } : check}
            appId={appId}
            optional={false}
            mode={mode}
          />
          <div className="actions-row">
            <button className="btn sm primary" disabled={busy || !slug || (slug !== currentSlug && check.state !== 'ok')}>
              {busy && <span className="spin" />}Save address
            </button>
            {((mode === 'root' ? sharing.rootSlug : sharing.slug) || (sharing.slug || sharing.rootSlug)) && (
              <button
                type="button"
                className="btn sm quiet danger"
                disabled={busy}
                onClick={() => {
                  const targetUrl = mode === 'root' ? (sharing.rootUrl || sharing.slugUrl) : (sharing.slugUrl || sharing.rootUrl);
                  if (confirm(`Remove ${targetUrl}? Anyone using it gets "Nothing here", and the name becomes free for others.`)) {
                    save(null);
                  }
                }}
              >
                Remove
              </button>
            )}
            <button type="button" className="btn sm quiet" onClick={() => { setEditing(false); setError(''); }}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {activeUrl && sharing.access === 'private' && !editing && <p className="hint">Only people added below can open it. Choose "Anyone with the link" to open it to everyone with the address.</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}

/* ---------- sharing by link: private, public, or with a password ---------- */
interface SharingT {
  access: 'private' | 'public' | 'password';
  publicRole: Role;
  hasPassword: boolean;
  showBar: boolean;
  shareUrl: string;
  slug: string | null;
  slugUrl: string | null;
  rootSlug?: string | null;
  rootUrl?: string | null;
}
function LinkSharing({ appId, appName }: { appId: string; appName: string }) {
  const toast = useToast();
  const { user } = useSession();
  const f = user.features;
  const [s, setS] = useState<SharingT | null>(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { get<SharingT>(`/api/apps/${appId}/sharing`).then(setS, () => {}); }, [appId]);
  if (!s) return null;
  const save = async (patch: Partial<SharingT> & { password?: string }) => {
    setBusy(true); setError('');
    try { const r = await api<SharingT>('PATCH', `/api/apps/${appId}/sharing`, patch); setS(r); setPw(''); toast(r.access === 'private' ? 'Link sharing is off' : 'Saved'); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save.'); }
    setBusy(false);
  };
  const choose = (access: SharingT['access']) => {
    if (access === 'password' && !s.hasPassword) { setS({ ...s, access }); return; } // ask for the password first
    save({ access });
  };
  const url = s.slugUrl ?? s.shareUrl;
  return (
    <section className="link-share" aria-labelledby="ls-h">
      <AddressSection appId={appId} appName={appName} sharing={s} onChange={setS} />
      <p className="section-title" id="ls-h">Share by link</p>
      <div className="ls-opts" role="radiogroup" aria-label="Who can open the link">
        {([['private', 'Only people added below'], ['public', 'Anyone with the link'], ['password', 'Anyone with the link and a password']] as const).map(([k, l]) => {
          const locked = k === 'password' && !f?.passwordLinks && s.access !== 'password';
          return <button key={k} type="button" role="radio" aria-checked={s.access === k} aria-disabled={locked} className="ls-opt" disabled={busy} onClick={() => { if (!locked) choose(k); }}><span className="radio" />{l}{locked && <PlanTag />}</button>;
        })}
      </div>
      {s.access === 'password' && (
        <form className="linkbox" onSubmit={(e) => { e.preventDefault(); save({ access: 'password', password: pw }); }}>
          <input className="input" type="text" autoComplete="new-password" placeholder={s.hasPassword ? 'New password (leave empty to keep it)' : 'Set a password for the link'} value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Link password" />
          <button className="btn sm" disabled={busy || (!s.hasPassword && pw.length < 4)}>{s.hasPassword ? 'Change' : 'Set password'}</button>
        </form>
      )}
      {s.access !== 'private' && (
        <>
          <div className="linkbox">
            <input className="input mono" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Share link" />
            <button className="btn sm primary" type="button" onClick={() => copyText(url).then(() => toast('Link copied'))}><Icon name="copy" size={15} />Copy</button>
          </div>
          <div className="ls-row">
            <span>Visitors can</span>
            <Select size="sm" label="Visitors can" width={130} value={s.publicRole} options={[{ value: 'viewer', label: 'View' }, { value: 'contributor', label: 'Add' }, { value: 'editor', label: 'Edit' }]} onChange={(v) => save({ publicRole: v as Role })} />
          </div>
        </>
      )}
      <label className="check-row"><input type="checkbox" checked={s.showBar} disabled={s.showBar && !f?.hideBar} onChange={(e) => save({ showBar: e.target.checked })} /><span>Show the Jhino top bar (hide it to open like a standalone app){s.showBar && !f?.hideBar && <PlanTag />}</span></label>
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}
