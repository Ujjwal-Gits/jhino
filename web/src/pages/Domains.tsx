import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, get, post } from '../api';
import { Link, useSession } from '../context';
import { Icon, Select, ago, copyText, useToast } from '../ui';
import { PlanTag } from './Address';
import '../domains.css';

/*
 * Custom domains: an app opened at the owner's own address (yourstudio.com), hosted by Jhino.
 * In Share: connect a domain, the DNS records to add (each with a copy button), live status and Check now.
 * In Super Admin: every domain Jhino hosts, with recheck, switch off and remove.
 */

type Status = 'pending' | 'verifying' | 'active' | 'error';
type WwwMode = 'off' | 'apex' | 'www';
interface DnsRecord { type: 'CNAME' | 'A' | 'TXT'; name: string; host: string; value: string; purpose: string; required: boolean; ok: boolean | null; note?: string }
export interface DomainT {
  id: string; appId: string; hostname: string; altHostname: string | null; wwwMode: WwwMode; wwwEligible: boolean;
  status: Status; sslStatus: string | null; error: string | null; backlink: boolean; disabled: boolean; granted: boolean;
  url: string; lastCheckedAt: string | null; nextCheckAt: string | null; activatedAt: string | null; createdAt: string;
  records: DnsRecord[]; seen: Record<string, string | null>;
}
interface DomainsInfo {
  mode: 'cloudflare' | 'self'; target: string; aRecord: string | null; limit: number | null; used: number; canAdd: boolean;
  canHideBacklink: boolean; access: 'private' | 'public' | 'password'; domains: DomainT[];
}

const errText = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);
const STATUS_LABEL: Record<Status, string> = { pending: 'Waiting for DNS', verifying: 'Issuing certificate', active: 'Live', error: 'Needs attention' };
const STATUS_CLASS: Record<Status, string> = { pending: 's-pending', verifying: 's-pending', active: 's-approved', error: 's-rejected' };

/** The same guess the server makes: a main domain (shop.com, shop.com.np) or its www name gets the www option. */
const SECOND = new Set(['com', 'co', 'org', 'net', 'edu', 'gov', 'ac', 'or', 'ne', 'go', 'mil', 'gen', 'info', 'biz', 'ltd', 'plc', 'nic', 'sch', 'nom', 'web']);
function cleanHost(s: string) {
  return s.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].replace(/:\d*$/, '').replace(/\.$/, '');
}
function registrable(h: string) {
  const l = h.split('.');
  return l.length >= 3 && SECOND.has(l[l.length - 2]) && l[l.length - 1].length === 2 ? l.slice(-3).join('.') : l.slice(-2).join('.');
}
const eligible = (h: string) => h.includes('.') && (h.startsWith('www.') || registrable(h) === h);
function wwwOptions(host: string): { value: WwwMode; label: string }[] {
  const base = host.replace(/^www\./, '');
  return [
    { value: 'apex', label: `${base}, www forwards to it` },
    { value: 'www', label: `www.${base}, ${base} forwards to it` },
    { value: 'off', label: `Only ${host}` },
  ];
}

export function StatusPill({ d }: { d: Pick<DomainT, 'status' | 'disabled'> }) {
  if (d.disabled) return <span className="status s-rejected">Switched off</span>;
  return <span className={`status ${STATUS_CLASS[d.status]}`}>{d.status === 'verifying' && <span className="cd-pulse" aria-hidden="true" />}{STATUS_LABEL[d.status]}</span>;
}

/* ---------------- Share → Custom domain ---------------- */
export function CustomDomainSection({ appId, access }: { appId: string; access: 'private' | 'public' | 'password' }) {
  const toast = useToast();
  const [info, setInfo] = useState<DomainsInfo | null>(null);
  const [adding, setAdding] = useState(false);
  const [host, setHost] = useState('');
  const [www, setWww] = useState<WwwMode>('apex');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => get<DomainsInfo>(`/api/apps/${appId}/domains`).then(setInfo, () => {}), [appId]);
  useEffect(() => { load(); }, [load]);
  // While a domain is being set up, keep its status fresh.
  const waiting = !!info?.domains.some((d) => d.status !== 'active' && !d.disabled);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 20_000);
    return () => clearInterval(t);
  }, [waiting, load]);
  if (!info) return null;

  const locked = info.limit === 0;
  const clean = cleanHost(host);
  const showWww = eligible(clean);
  const typed = (v: string) => {
    setHost(v);
    const h = cleanHost(v);
    setWww(h.startsWith('www.') ? 'www' : eligible(h) ? 'apex' : 'off');
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await post(`/api/apps/${appId}/domains`, { hostname: clean, www: showWww ? www : 'off' });
      setAdding(false); setHost('');
      toast('Domain added. Now add the DNS records below.');
      await load();
    } catch (err) { setError(errText(err, 'Could not add the domain.')); }
    setBusy(false);
  };
  const onChange = (d: DomainT | null, removedId?: string) => {
    setInfo((cur) => cur && ({
      ...cur,
      domains: removedId ? cur.domains.filter((x) => x.id !== removedId) : cur.domains.map((x) => (d && x.id === d.id ? d : x)),
      used: removedId ? Math.max(0, cur.used - 1) : cur.used,
      canAdd: removedId ? true : cur.canAdd,
    }));
    if (removedId) load();
  };

  return (
    <div className="cd-sec">
      <p className="section-title">Custom domain {locked && <PlanTag plan="Pro" />}</p>
      {locked ? (
        <div className="cd-upsell">
          <div>
            <b>Open this app at your own domain</b>
            <span className="hint">Like yourstudio.com: the complete app runs there, with its saved data, files and live updates. Jhino looks after the certificate.</span>
          </div>
          <Link to="/account/plan" className="btn sm">See Pro</Link>
        </div>
      ) : (
        <>
          {info.domains.map((d) => (
            <DomainCard key={d.id} d={d} canHideBacklink={info.canHideBacklink} onChange={onChange} />
          ))}
          {adding ? (
            <form className="cd-add" onSubmit={add}>
              <label className="field">
                <span>Your domain</span>
                <input className="input mono" autoFocus inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="yourstudio.com or app.yourstudio.com"
                  value={host} onChange={(e) => typed(e.target.value)} aria-describedby="cd-add-hint" />
              </label>
              {showWww && (
                <div className="field">
                  <span>Open it at</span>
                  <Select<WwwMode> label="Open it at" value={www} options={wwwOptions(clean)} onChange={setWww} />
                </div>
              )}
              <p className="hint" id="cd-add-hint">A domain you own. You add two or three DNS records where you bought it; the next step shows exactly which.</p>
              {error && <p className="error-text" role="alert">{error}</p>}
              <div className="actions-row">
                <button className="btn sm primary" disabled={busy || clean.length < 4 || !clean.includes('.')}>{busy && <span className="spin" />}Connect domain</button>
                <button type="button" className="btn sm quiet" onClick={() => { setAdding(false); setError(''); }}>Cancel</button>
              </div>
            </form>
          ) : info.canAdd ? (
            <div className="addr-empty">
              <span className="hint">{info.domains.length ? 'Connect another domain to this app.' : 'Open this app at your own domain, like yourstudio.com. Not a redirect or a frame: the full app, at your address.'}</span>
              <button className="btn sm" type="button" onClick={() => setAdding(true)}><Icon name="globe" size={15} />Connect a domain</button>
            </div>
          ) : !info.domains.length ? null : (
            <p className="hint">Your plan’s custom domain{info.limit === 1 ? ' is' : 's are'} in use{info.limit !== null ? ` (${info.used} of ${info.limit})` : ''}.</p>
          )}
          {info.domains.length > 0 && access === 'private' && (
            <p className="cd-warn"><Icon name="info" size={14} />This app is private, so the domain shows “This site is not public yet”. Choose “Anyone with the link” above to open it.</p>
          )}
        </>
      )}
    </div>
  );
}

function CopyCell({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const toast = useToast();
  return (
    <span className="cd-copy">
      <span className={`cd-val ${mono ? 'mono' : ''}`} title={value}>{value}</span>
      <button type="button" className="icon-btn cd-copy-btn" aria-label={`Copy ${label}`} title={`Copy ${label}`} onClick={() => copyText(value).then(() => toast(`${label} copied`))}><Icon name="copy" size={14} /></button>
    </span>
  );
}

function Steps({ d }: { d: DomainT }) {
  const dnsOk = d.status === 'verifying' || d.status === 'active';
  const steps: [string, 'done' | 'now' | 'todo'][] = [
    ['DNS records', dnsOk ? 'done' : 'now'],
    ['Certificate', d.status === 'active' ? 'done' : dnsOk ? 'now' : 'todo'],
    ['Live', d.status === 'active' ? 'done' : 'todo'],
  ];
  return (
    <ol className="cd-steps" aria-label="Setup progress">
      {steps.map(([l, s], i) => (
        <li key={l} className={`cd-step ${s}`} aria-current={s === 'now' ? 'step' : undefined}>
          <span className="cd-dot" aria-hidden="true">{s === 'done' ? <Icon name="check" size={12} /> : i + 1}</span>
          <span>{l}</span>
        </li>
      ))}
    </ol>
  );
}

function DomainCard({ d, canHideBacklink, onChange }: { d: DomainT; canHideBacklink: boolean; onChange: (d: DomainT | null, removedId?: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<'' | 'check' | 'www' | 'remove' | 'credit'>('');
  const [error, setError] = useState('');
  const [showDns, setShowDns] = useState(d.status !== 'active');
  useEffect(() => { if (d.status !== 'active') setShowDns(true); }, [d.status]);
  const run = async (what: typeof busy, fn: () => Promise<void>) => { setBusy(what); setError(''); try { await fn(); } catch (e) { setError(errText(e, 'Something went wrong.')); } setBusy(''); };
  const check = () => run('check', async () => {
    const r = await post<{ domain: DomainT }>(`/api/domains/${d.id}/check`);
    onChange(r.domain);
    toast(r.domain.status === 'active' ? `${r.domain.hostname} is live` : r.domain.status === 'verifying' ? 'DNS found. The certificate is being issued.' : 'Checked. The records are not visible yet; DNS changes can take up to a few hours.');
  });
  const setWww = (mode: WwwMode) => run('www', async () => { const r = await api<{ domain: DomainT }>('PATCH', `/api/domains/${d.id}`, { www: mode }); onChange(r.domain); toast('Saved'); });
  const setCredit = (on: boolean) => run('credit', async () => { const r = await api<{ domain: DomainT }>('PATCH', `/api/domains/${d.id}`, { backlink: on }); onChange(r.domain); });
  const remove = () => {
    if (!confirm(`Disconnect ${d.hostname}? It stops opening this app at once. You can connect it again later.`)) return;
    run('remove', async () => { await api('DELETE', `/api/domains/${d.id}`); toast(`${d.hostname} disconnected`); onChange(null, d.id); });
  };
  const required = d.records.filter((r) => r.required);
  const optional = d.records.filter((r) => !r.required);
  const live = d.status === 'active' && !d.disabled;
  const base = registrable(d.hostname.replace(/^www\./, ''));

  return (
    <article className={`cd-card ${live ? 'live' : ''}`} aria-label={d.hostname}>
      <header className="cd-head">
        <div className="cd-name">
          {live ? <a className="mono" href={d.url} target="_blank" rel="noopener">{d.hostname}<Icon name="external" size={13} /></a> : <span className="mono">{d.hostname}</span>}
          {d.altHostname && <small>{d.altHostname} forwards here</small>}
        </div>
        <StatusPill d={d} />
      </header>

      {!d.disabled && <Steps d={d} />}
      {d.disabled && <p className="cd-warn"><Icon name="info" size={14} />A Jhino super admin switched this domain off. Contact support if you think this is a mistake.</p>}
      {d.error && !d.disabled && <p className={d.status === 'error' ? 'error-text' : 'cd-note'} role={d.status === 'error' ? 'alert' : undefined}>{d.error}</p>}
      {d.status === 'verifying' && !d.error && <p className="cd-note">DNS is in place. The secure certificate is being issued; this usually takes a few minutes.</p>}

      {live && !showDns ? (
        <div className="cd-live">
          <span className="hint">Opens at <a className="link mono" href={d.url} target="_blank" rel="noopener">{d.url}</a>{d.activatedAt ? ` since ${new Date(d.activatedAt).toLocaleDateString()}` : ''}.</span>
          <button type="button" className="btn sm quiet" onClick={() => setShowDns(true)}>DNS records</button>
        </div>
      ) : (
        <div className="cd-dns">
          <p className="cd-dns-lede">{live ? 'These records keep it working. Leave them in place.' : <>At the company where you manage <b>{base}</b> (your registrar or DNS provider), add {required.length === 1 ? 'this record' : `these ${required.length} records`}:</>}</p>
          <ul className="cd-records">
            {required.map((r) => <RecordRow key={`${r.type}-${r.name}`} r={r} />)}
          </ul>
          {optional.length > 0 && (
            <details className="cd-more">
              <summary>Optional: verify before you switch DNS</summary>
              <ul className="cd-records">{optional.map((r) => <RecordRow key={`${r.type}-${r.name}`} r={r} />)}</ul>
            </details>
          )}
          <p className="hint">DNS changes usually show within minutes, sometimes a few hours. We keep checking and tell you when it is live. {live && <button type="button" className="link" onClick={() => setShowDns(false)}>Hide</button>}</p>
        </div>
      )}

      <div className="cd-foot">
        <div className="actions-row">
          {!d.disabled && <button type="button" className="btn sm" onClick={check} disabled={!!busy}>{busy === 'check' ? <span className="spin" /> : <Icon name="refresh" size={14} />}Check now</button>}
          {d.wwwEligible && !d.disabled && (
            <Select<WwwMode> size="sm" label="Open it at" width={250} disabled={!!busy} value={d.wwwMode} options={wwwOptions(d.hostname)} onChange={setWww} />
          )}
          <span className="spacer" />
          <button type="button" className="btn sm quiet danger" onClick={remove} disabled={!!busy}>{busy === 'remove' && <span className="spin" />}Disconnect</button>
        </div>
        <p className="hint cd-checked">{d.lastCheckedAt ? `Checked ${ago(d.lastCheckedAt)}` : 'Not checked yet'}{d.status !== 'active' && d.nextCheckAt && !d.disabled ? ' · next check soon' : ''}</p>
        {canHideBacklink
          ? <label className="check-row"><input type="checkbox" checked={d.backlink} disabled={!!busy} onChange={(e) => setCredit(e.target.checked)} /><span>Show the “Built with Jhino” line at the bottom of every page (super admins can switch it off on their own domains)</span></label>
          : <p className="hint">Every page on this domain ends with one small “Built with Jhino” line under your footer.</p>}
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </article>
  );
}

function RecordRow({ r }: { r: DnsRecord }) {
  return (
    <li className="cd-rec">
      <span className={`cd-type t-${r.type.toLowerCase()}`}>{r.type}</span>
      <div className="cd-rec-body">
        <div className="cd-kv"><span className="cd-k">Name</span><CopyCell label="Name" value={r.host} /></div>
        <div className="cd-kv"><span className="cd-k">Value</span><CopyCell label="Value" value={r.value} /></div>
        <p className="cd-purpose">{r.purpose}{r.host !== '@' && r.name !== r.host ? <> · full name <span className="mono">{r.name}</span></> : null}</p>
        {r.note && <p className="cd-purpose">{r.note}</p>}
      </div>
      <span className={`cd-state ${r.ok === true ? 'ok' : r.ok === false ? 'no' : ''}`} title={r.ok === true ? 'Found' : r.ok === false ? 'Not found yet' : 'Not checked yet'}>
        {r.ok === true ? <><Icon name="check" size={14} /><span>Found</span></> : <span>{r.ok === false ? 'Not found yet' : 'Waiting'}</span>}
      </span>
    </li>
  );
}

/* ---------------- Super Admin → Custom domains ---------------- */
interface AdminDomainT extends DomainT { ownerId: string; ownerName: string | null; ownerEmail: string | null; appName: string | null }
export function DomainsAdmin() {
  const toast = useToast();
  const { user } = useSession();
  const [q, setQ] = useState('');
  const [d, setD] = useState<{ mode: 'cloudflare' | 'self'; target: string; aRecord: string | null; counts: Record<string, number>; domains: AdminDomainT[] } | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => get<typeof d>(`/api/admin/domains?q=${encodeURIComponent(q)}`).then(setD, () => {}), [q]);
  useEffect(() => { const t = setTimeout(load, 150); return () => clearTimeout(t); }, [load]);
  const act = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try { await fn(); toast(done); await load(); } catch (e) { toast(errText(e, 'Could not do that.'), true); }
    setBusy('');
  };
  const c = d?.counts ?? {};
  return (
    <>
      <div className="adm-head">
        <div>
          <h1>Custom domains</h1>
          <p className="acc-lede">Customer domains Jhino hosts, with their status, owner and app. {d && (d.mode === 'cloudflare' ? <>Certificates by Cloudflare for SaaS; customers point a CNAME at <span className="mono">{d.target}</span>.</> : <>Self-managed: ownership by TXT record, certificates on demand by the proxy (it asks <span className="mono">/api/domains/tls-ask</span>).</>)}</p>
        </div>
      </div>
      {d && (
        <dl className="store-row">
          <div><dt>Live</dt><dd className="mono">{c.active ?? 0}</dd></div>
          <div><dt>Waiting for DNS</dt><dd className="mono">{c.pending ?? 0}</dd></div>
          <div><dt>Issuing certificate</dt><dd className="mono">{c.verifying ?? 0}</dd></div>
          <div><dt>Needs attention</dt><dd className="mono">{c.error ?? 0}</dd></div>
        </dl>
      )}
      <div className="adm-tools">
        <label className="ix-search"><Icon name="search" size={16} /><span className="sr-only">Search domains</span><input placeholder="Domain, app or owner email" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      {!d ? <div className="acc-skel" /> : !d.domains.length ? <p className="muted">{q ? 'No domains match.' : 'No custom domains yet. Pro customers connect theirs from an app’s Share settings.'}</p> : (
        <table className="adm-table cd-table">
          <thead><tr><th>Domain</th><th className="hide-sm">App</th><th className="hide-sm">Owner</th><th>Status</th><th className="hide-sm">Checked</th><th /></tr></thead>
          <tbody>
            {d.domains.map((x) => (
              <tr key={x.id} className={x.disabled ? 'row-off' : ''}>
                <td>
                  <span className="cell-main">
                    <b>{x.status === 'active' && !x.disabled ? <a className="mono link" href={x.url} target="_blank" rel="noopener">{x.hostname}</a> : <span className="mono">{x.hostname}</span>}</b>
                    <small>{x.altHostname ? `${x.altHostname} forwards · ` : ''}{x.backlink ? 'Built with Jhino line on' : 'line off'}{x.granted ? ' · given by a super admin' : ''}</small>
                    {x.error && <small className="cd-err-line" title={x.error}>{x.error}</small>}
                  </span>
                </td>
                <td className="hide-sm"><Link to={`/admin/apps/${x.appId}`} className="link">{x.appName ?? 'Removed app'}</Link></td>
                <td className="hide-sm"><Link to={`/admin/users/${x.ownerId}`} className="cell-main"><b>{x.ownerName ?? '—'}</b><small>{x.ownerEmail}</small></Link></td>
                <td><StatusPill d={x} /></td>
                <td className="hide-sm muted small">{x.lastCheckedAt ? ago(x.lastCheckedAt) : '—'}</td>
                <td>
                  <div className="actions-row cd-admin-acts">
                    <button className="btn sm" disabled={busy === x.id} onClick={() => act(x.id, () => post(`/api/admin/domains/${x.id}/check`), `${x.hostname} checked`)}>{busy === x.id ? <span className="spin" /> : <Icon name="refresh" size={14} />}<span className="hide-sm">Check</span></button>
                    <button className="btn sm quiet" disabled={busy === x.id} onClick={() => { if (x.disabled || confirm(`Switch ${x.hostname} off? It stops serving at once and the owner is told.`)) act(x.id, () => post(`/api/admin/domains/${x.id}/disable`, { disabled: !x.disabled }), x.disabled ? 'Switched on' : 'Switched off'); }}>{x.disabled ? 'Switch on' : 'Switch off'}</button>
                    {x.ownerId === user.id && user.isAdmin && (
                      <button className="btn sm quiet" disabled={busy === x.id} onClick={() => act(x.id, () => api('PATCH', `/api/domains/${x.id}`, { backlink: !x.backlink }), x.backlink ? 'Line hidden on this domain' : 'Line shown again')}>{x.backlink ? 'Hide line' : 'Show line'}</button>
                    )}
                    <button className="btn sm quiet danger" disabled={busy === x.id} onClick={() => { if (confirm(`Remove ${x.hostname}? It is disconnected from “${x.appName ?? 'the app'}” (and from Cloudflare), and the owner is told.`)) act(x.id, () => api('DELETE', `/api/admin/domains/${x.id}`), 'Removed'); }}>Remove</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
