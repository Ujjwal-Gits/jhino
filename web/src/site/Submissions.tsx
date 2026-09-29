import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, get } from '../api';
import { live } from '../live';
import { Icon, Select, ago, useToast } from '../ui';
import { BLOCKS } from '../../../server/site/schema';

/* What visitors sent through the site's contact, booking and signup forms, with export to CSV. */

interface Sub { id: string; form: string; page: string; data: Record<string, string>; createdAt: string; readAt: string | null }
const LABEL: Record<string, string> = { name: 'Name', email: 'Email', phone: 'Phone', choice: 'For', date: 'Date', time: 'Time', message: 'Message', notes: 'Notes' };
const ORDER = ['name', 'email', 'phone', 'choice', 'date', 'time', 'message', 'notes'];

export function Submissions({ appId, onClose }: { appId: string; onClose: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<Sub[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState('');
  const load = useCallback(() => {
    get<{ items: Sub[] }>(`/api/sites/${appId}/submissions`).then((r) => { setItems(r.items); setErr(''); }, (e) => setErr(e instanceof ApiError ? e.message : 'Could not load submissions.'));
  }, [appId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const w = live.watch(appId);
    const off = live.on((e, d) => { if (e === 'site-submission' && (d as { appId?: string })?.appId === appId) load(); });
    return () => { off(); w.stop(); };
  }, [appId, load]);

  const forms = useMemo(() => [...new Set((items ?? []).map((i) => i.form))], [items]);
  const shown = (items ?? []).filter((i) => (!form || i.form === form) && (!q || JSON.stringify(i.data).toLowerCase().includes(q.toLowerCase())));
  const del = async (s: Sub) => {
    setItems((x) => x?.filter((y) => y.id !== s.id) ?? x);
    try { await api('DELETE', `/api/sites/${appId}/submissions/${s.id}`); toast('Deleted.'); } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete.', true); load(); }
  };
  const name = (t: string) => BLOCKS.find((b) => b.type === t)?.name ?? t;
  return (
    <section className="se-subs" aria-labelledby="subs-h">
      <header className="se-subs-head">
        <div><h2 id="subs-h">Submissions</h2><p className="hint">Messages, booking requests and signups from your site’s forms. The newest come first.</p></div>
        <div className="se-subs-acts">
          <a className="btn sm" href={`/api/sites/${appId}/submissions.csv${form ? `?form=${form}` : ''}`} download><Icon name="download" size={15} />Export CSV</a>
          <button className="btn sm quiet" onClick={onClose}><Icon name="close" size={15} />Back to the editor</button>
        </div>
      </header>
      {items && items.length > 0 && (
        <div className="se-subs-tools">
          <label className="ix-search"><Icon name="search" size={16} /><span className="sr-only">Search</span><input placeholder="Search names, emails, messages" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          {forms.length > 1 && <Select label="Form" size="sm" width={180} value={form} onChange={setForm} options={[{ value: '', label: 'All forms' }, ...forms.map((f) => ({ value: f, label: name(f) }))]} />}
        </div>
      )}
      {err && <p className="error-text" role="alert">{err}</p>}
      {items === null && !err ? <p className="hint">Loading…</p> : items && items.length === 0 ? (
        <div className="se-subs-empty"><p><b>Nothing yet.</b></p><p className="hint">When someone sends your contact form, asks for a booking or signs up, it shows up here, and you get a notification.</p></div>
      ) : (
        <ol className="se-subs-list">
          {shown.map((s) => (
            <li key={s.id} className={s.readAt ? '' : 'new'}>
              <div className="se-sub-top">
                <b>{s.data.name || s.data.email || 'Someone'}</b>
                <span className="muted">{name(s.form)}{s.page ? ` · ${s.page}` : ''} · <time dateTime={s.createdAt} title={new Date(s.createdAt).toLocaleString()}>{ago(s.createdAt)}</time></span>
                <button className="icon-btn sm" aria-label="Delete this submission" onClick={() => del(s)}><Icon name="trash" size={14} /></button>
              </div>
              <dl>
                {ORDER.filter((k) => s.data[k] && k !== 'name').map((k) => (
                  <div key={k} className={k === 'message' || k === 'notes' ? 'long' : ''}><dt>{LABEL[k]}</dt><dd>{k === 'email' ? <a href={`mailto:${s.data[k]}`}>{s.data[k]}</a> : k === 'phone' ? <a href={`tel:${s.data[k].replace(/[^\d+]/g, '')}`}>{s.data[k]}</a> : s.data[k]}</dd></div>
                ))}
              </dl>
            </li>
          ))}
          {shown.length === 0 && <li className="muted">Nothing matches.</li>}
        </ol>
      )}
    </section>
  );
}
