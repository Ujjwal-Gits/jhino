import { useEffect, useState } from 'react';
import { ApiError, api, get, post, type AppDetail } from '../api';
import { BUILD_PROMPT } from '../buildPrompt';
import { Icon, Modal, ago, bytes, copyText, useToast } from '../ui';
import { dataMode } from './Apps';
import { ROLE_LABEL } from './Share';
import { useRoute } from '../context';

type Tab = 'overview' | 'activity' | 'versions' | 'data';
interface Activity { id: number; action: string; detail: string; at: string; name: string | null }
interface KvRow { ns: string; scope: string; key: string; size: number; preview: string; rev: number; updatedAt: string; updatedBy: string | null; owner: string | null }

export function DetailsPanel({ app, onClose, onChanged, onUpload }: { app: AppDetail; onClose: () => void; onChanged: () => void; onUpload: () => void }) {
  const toast = useToast();
  const owner = app.role === 'owner';
  const [tab, setTab] = useState<Tab>('overview');
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [data, setData] = useState<{ kv: KvRow[]; collections: { collection: string; n: number; updatedAt: string }[] } | null>(null);
  const [name, setName] = useState(app.name);
  const [privateKeys, setPrivateKeys] = useState(app.privateKeys.join('\n'));
  const [error, setError] = useState('');
  const mode = dataMode(app.features, app.built);
  const { go } = useRoute();
  const [files, setFiles] = useState<{ id: string; name: string; size: number; createdAt: string; createdByName: string | null; status?: string; originalSize?: number | null }[] | null>(null);

  useEffect(() => {
    if (tab === 'activity') get<{ activity: Activity[] }>(`/api/apps/${app.id}/activity`).then((r) => setActivity(r.activity), () => setActivity([]));
    if (tab === 'data' && owner) {
      get(`/api/apps/${app.id}/data`).then(setData, () => setData({ kv: [], collections: [] }));
      get<{ files: any[] }>(`/api/apps/${app.id}/files`).then((r) => setFiles(r.files), () => setFiles([]));
    }
  }, [tab, app.id, owner]);

  const save = async () => {
    setError('');
    try {
      await api('PATCH', `/api/apps/${app.id}`, { name, privateKeys: privateKeys.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) });
      toast('Saved');
      onChanged();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save.'); }
  };
  const makeLive = async (n: number) => {
    try { await post(`/api/apps/${app.id}/rollback`, { n }); toast(`Version ${n} is live`); onChanged(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not switch version.', true); }
  };

  const tabs: [Tab, string][] = [['overview', 'Overview'], ['activity', 'Activity']];
  if (owner) tabs.push(['versions', 'Versions'], ['data', 'Data']);
  const ownerName = app.members.find((m) => m.role === 'owner')?.name;

  return (
    <Modal title={app.name} onClose={onClose} panel>
      <div className="panel-tabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="panel-body">
        {tab === 'overview' && (
          <>
            <section>
              <p className="tag" style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 550 }}><span className={`dot ${mode.dot}`} />{mode.text}</p>
              <p className="hint" style={{ marginTop: 6 }}>{mode.long}</p>
            </section>
            <dl className="kv">
              <dt>Owner</dt><dd>{ownerName}</dd>
              <dt>Your access</dt><dd>{app.role ? ROLE_LABEL[app.role] : ''}</dd>
              <dt>People</dt><dd>{app.members.length}</dd>
              <dt>Live version</dt><dd className="mono">v{app.liveVersion}</dd>
              <dt>Created</dt><dd>{new Date(app.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
            </dl>
            {owner && app.built && (
              <section className="actions-row">
                <button className="btn primary" onClick={() => go(`/apps/${app.id}/blocks`)}><Icon name="blocks" size={16} />Edit features and design</button>
                <a className="btn" href={`/api/apps/${app.id}/source`} download>Download HTML</a>
              </section>
            )}
            {owner && (
              <section style={{ display: 'grid', gap: 14 }}>
                <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
                {!app.built && <label className="field">
                  <span>Private keys</span>
                  <textarea className="textarea" rows={3} value={privateKeys} onChange={(e) => setPrivateKeys(e.target.value)} placeholder={'theme\nsettings-*'} spellCheck={false} style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }} />
                  <small className="hint">localStorage keys that each person keeps for themselves, one per line. Use * as a wildcard. Everything else is shared.</small>
                </label>}
                {error && <p className="error-text" role="alert">{error}</p>}
                <div><button className="btn primary" onClick={save} disabled={!name.trim()}>Save changes</button></div>
              </section>
            )}
            <section>
              <p className="section-title">Make an app work better here</p>
              <p className="hint" style={{ marginBottom: 10 }}>Copy these instructions into Claude or another AI tool together with your app. It will adapt the app so saving and live updates work smoothly.</p>
              <button className="btn" onClick={() => copyText(BUILD_PROMPT).then(() => toast('Instructions copied'))}>Copy build instructions</button>
            </section>
          </>
        )}

        {tab === 'activity' && (
          activity === null ? null : activity.length === 0 ? <p className="hint">Nothing yet.</p> : (
            <div className="lines">
              {activity.map((a) => (
                <div className="line" key={a.id}>
                  <div className="grow"><b>{a.name ?? 'Someone'}</b> {a.action}{a.detail ? <span className="muted"> · {a.detail}</span> : null}</div>
                  <span className="mono muted" title={new Date(a.at).toLocaleString()}>{ago(a.at)}</span>
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'versions' && (
          <>
            <div><button className="btn primary" onClick={onUpload}>Upload a new version</button></div>
            <div className="lines">
              {app.versions.map((v) => (
                <div className="line" key={v.n}>
                  <span className="mono" style={{ width: 34 }}>v{v.n}</span>
                  <div className="grow">
                    <b>{v.sourceName}</b>
                    <div className="sub">{v.uploadedBy} · {ago(v.createdAt)} · {v.fileCount} {v.fileCount === 1 ? 'file' : 'files'} · {bytes(v.size)}</div>
                  </div>
                  {v.n === app.liveVersion ? <span className="pill">Live</span> : <button className="btn sm" onClick={() => makeLive(v.n)}>Make live</button>}
                </div>
              ))}
            </div>
            <p className="hint">Switching versions changes only the app's screens. Saved data stays as it is.</p>
          </>
        )}

        {tab === 'data' && data && (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
              <p className="hint">Everything this app saved on the server.</p>
              <a className="btn sm" href={`/api/apps/${app.id}/export`} download>Download JSON</a>
            </div>
            {data.kv.length === 0 && data.collections.length === 0 && <p className="hint">No saved data yet.</p>}
            {files && files.length > 0 && (
              <section>
                <p className="section-title">Files <span className="mono muted">{files.length} · {bytes(files.reduce((s, f) => s + f.size, 0))}</span></p>
                <div className="lines">
                  {files.slice(0, 200).map((f) => (
                    <div className="line" key={f.id}>
                      <div className="grow"><b>{f.name}</b><div className="sub">{f.createdByName ?? 'Someone'} · {ago(f.createdAt)}</div></div>
                      <span className="mono muted">{f.status === 'processing' ? 'making smaller…' : f.originalSize ? `${bytes(f.size)} (was ${bytes(f.originalSize)})` : bytes(f.size)}</span>
                      <a className="btn sm" href={`/api/apps/${app.id}/files/${f.id}?download=1`} download>Download</a>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {data.collections.length > 0 && (
              <section>
                <p className="section-title">Record collections</p>
                <div className="lines">
                  {data.collections.map((c) => (
                    <div className="line" key={c.collection}><div className="grow"><b className="mono">{c.collection}</b></div><span className="mono muted">{c.n} records · {ago(c.updatedAt)}</span></div>
                  ))}
                </div>
              </section>
            )}
            {data.kv.length > 0 && (
              <section>
                <p className="section-title">Saved keys</p>
                <div className="lines">
                  {data.kv.map((r) => (
                    <details className="line" key={`${r.ns}${r.scope}${r.key}`} style={{ display: 'block' }}>
                      <summary style={{ display: 'flex', gap: 12, cursor: 'pointer', listStyle: 'none' }}>
                        <span className="grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <b className="mono">{r.key}</b>{r.owner ? <span className="muted"> · private to {r.owner}</span> : null}
                        </span>
                        <span className="mono muted">{bytes(r.size)} · {ago(r.updatedAt)}</span>
                      </summary>
                      <pre className="code" style={{ marginTop: 8 }}>{r.preview}{r.size > 400 ? ' …' : ''}</pre>
                      <p className="hint">{r.ns === 'ls' ? 'localStorage' : 'window.storage'} · revision {r.rev}{r.updatedBy ? ` · last saved by ${r.updatedBy}` : ''}</p>
                    </details>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
