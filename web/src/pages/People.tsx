import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, get, post, type User } from '../api';
import { useSession } from '../context';
import { Avatar, Modal, copyText, useToast } from '../ui';

export function People() {
  const { user: me } = useSession();
  const toast = useToast();
  const [users, setUsers] = useState<User[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', isAdmin: false });
  const [secret, setSecret] = useState<{ name: string; email: string; password: string } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => get<{ users: User[] }>('/api/users').then((r) => setUsers(r.users)), []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setError('');
    try {
      const r = await post<{ user: User; password: string }>('/api/users', form);
      setAdding(false);
      setForm({ name: '', email: '', isAdmin: false });
      setSecret({ name: r.user.name, email: r.user.email, password: r.password });
      load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not add.'); }
  };
  const patch = async (u: User, body: Record<string, unknown>, done: string) => {
    try {
      const r = await api<{ password?: string }>('PATCH', `/api/users/${u.id}`, body);
      if (r.password) setSecret({ name: u.name, email: u.email, password: r.password });
      else toast(done);
      load();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not update.', true); }
  };

  return (
    <main className="page people">
      <div className="page-head">
        <h1>People{users && <span className="count">{users.length}</span>}</h1>
        <button className="btn primary" onClick={() => setAdding(true)}>Add person</button>
      </div>
      <p className="hint" style={{ marginBottom: 18, maxWidth: '62ch' }}>
        Everyone with an account here. Adding someone gives them an account only; share each app with them separately. You can also invite new people from an app's Share button.
      </p>
      <div className="list">
        <div className="row head" aria-hidden="true"><span>Name</span><span className="hide-md">Email</span><span className="hide-sm">Role</span><span /></div>
        {users?.map((u) => (
          <div className="row" key={u.id} style={{ opacity: u.disabled ? 0.55 : 1 }}>
            <span className="name"><Avatar name={u.name} /><span>{u.name}{u.id === me.id ? ' (you)' : ''}</span></span>
            <span className="cell hide-md mono">{u.email}</span>
            <span className="cell hide-sm">{u.disabled ? 'Turned off' : u.isAdmin ? 'Admin' : 'Member'}</span>
            <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              {u.id !== me.id && (
                <>
                  <button className="btn sm quiet" onClick={() => confirm(`Make a new password for ${u.name}? Their current password stops working and they are signed out.`) && patch(u, { resetPassword: true }, '')}>New password</button>
                  <button className="btn sm quiet" onClick={() => patch(u, { disabled: !u.disabled }, u.disabled ? `${u.name} can sign in again` : `${u.name} is turned off`)}>{u.disabled ? 'Turn on' : 'Turn off'}</button>
                </>
              )}
            </span>
          </div>
        ))}
      </div>

      {adding && (
        <Modal title="Add person" onClose={() => setAdding(false)} footer={<>
          <button className="btn" onClick={() => setAdding(false)}>Cancel</button>
          <button className="btn primary" onClick={add} disabled={!form.name.trim() || !form.email.includes('@')}>Add</button>
        </>}>
          <div className="modal-body">
            <label className="field"><span>Name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></label>
            <label className="field"><span>Email</span><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}>
              <input type="checkbox" checked={form.isAdmin} onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })} /> Admin (can manage people)
            </label>
            <p className="hint">Jhino makes a password for them. You give it to them yourself; no email is sent.</p>
            {error && <p className="error-text" role="alert">{error}</p>}
          </div>
        </Modal>
      )}

      {secret && (
        <Modal title={`Sign-in details for ${secret.name}`} onClose={() => setSecret(null)} footer={<button className="btn primary" onClick={() => setSecret(null)}>Done</button>}>
          <div className="modal-body">
            <p>Give these to {secret.name}. The password is shown only now. They can change it from their account menu.</p>
            <div className="code" style={{ fontSize: 13 }}>{`${secret.email}\n${secret.password}`}</div>
            <div><button className="btn" onClick={() => copyText(`${secret.email}\n${secret.password}`).then(() => toast('Copied'))}>Copy</button></div>
          </div>
        </Modal>
      )}
    </main>
  );
}
