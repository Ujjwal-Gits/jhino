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
          {!live && d.records.some((r) => r.host === '@' && r.type === 'CNAME') && <RootHelp id={d.id} />}
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

/* ---------------- a root domain (ujjwal.com): what to do at their DNS provider ---------------- */
interface Prov { base: string; target: string; aRecord: string | null; provider: string | null; nameservers: string[]; root: 'cname' | 'alias' | 'aname' | 'a' | 'move' | 'unknown' }
function RootHelp({ id }: { id: string }) {
  const [p, setP] = useState<Prov | null>(null);
  useEffect(() => { get<Prov>(`/api/domains/${id}/provider`).then(setP, () => {}); }, [id]);
  if (!p || p.root === 'a') return null;
  const at = p.provider ?? 'your DNS provider';
  const rec = <><b>Name</b> <span className="mono">@</span>, <b>value</b> <span className="mono">{p.target}</span></>;
  return (
    <div className="cd-root">
      <p className="cd-root-h"><Icon name="info" size={15} /><b>{p.provider ? `${p.base} uses ${p.provider} for DNS` : `Pointing ${p.base} itself (no www)`}</b></p>
      {p.root === 'cname' && <ol><li>In Cloudflare, open <b>{p.base}</b> → <b>DNS</b> → <b>Add record</b>.</li><li>Type <b>CNAME</b>, {rec}. Cloudflare allows this at the root by itself.</li><li>Set <b>Proxy status</b> to <b>DNS only</b> (grey cloud), then save.</li></ol>}
      {p.root === 'alias' && <ol><li>In {at}, open the DNS settings for <b>{p.base}</b>{p.provider === 'Namecheap' ? <> (Domain List → Manage → <b>Advanced DNS</b>)</> : null}.</li><li>Delete any old <b>A</b> or <b>CNAME</b> record with the name <span className="mono">@</span>.</li><li>Add an <b>ALIAS</b> record: {rec}.</li></ol>}
      {p.root === 'aname' && <ol><li>In {at}, open the DNS records for <b>{p.base}</b>.</li><li>Delete any old <b>A</b> record for the root.</li><li>Add an <b>ANAME</b> record: {rec}.</li></ol>}
      {p.root === 'move' && <>
        <p>{p.provider ?? 'Your provider'} can’t point the root of a domain at another service with a CNAME{/\.np$/.test(p.base) ? ', like most .np registrars' : ''}. The fix is free and takes about 10 minutes: let Cloudflare run your DNS. Your email and other records are copied across and keep working.</p>
        <ol>
          <li>Make a free account at <a className="link" href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener noreferrer">cloudflare.com</a>, choose <b>Add a domain</b>, type <b>{p.base}</b> and pick the <b>Free</b> plan.</li>
          <li>Cloudflare shows two <b>nameservers</b>. In {at}, replace the current nameservers{p.nameservers.length ? <> (<span className="mono">{p.nameservers.slice(0, 2).join(', ')}</span>)</> : null} with those two.</li>
          <li>In Cloudflare → <b>DNS</b>, add a <b>CNAME</b> record: {rec}, with <b>Proxy status: DNS only</b>.</li>
          <li>Come back here and press <b>Check now</b>. Nameserver changes can take a few hours.</li>
        </ol>
      </>}
      {p.root === 'unknown' && <p>Most providers don’t allow a plain CNAME at the root (<span className="mono">@</span>). Look for an <b>ALIAS</b>, <b>ANAME</b> or <b>CNAME flattening</b> record and point it at <span className="mono">{p.target}</span>. If your provider has none of these, move your DNS to Cloudflare (free): add {p.base} there, switch the nameservers at your registrar, then add the CNAME in Cloudflare.</p>}
    </div>
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

/* ---------------- Super Admin → Custom domains → Connect Cloudflare ---------------- */
interface CfStep { key: string; label: string; ok: boolean; note: string }
interface CfState { connected: boolean; from: 'env' | 'admin' | null; zone: string | null; base: string; origin: string; target: string; last: { at: string; steps: CfStep[]; ready: boolean } | null }
function CloudflareCard({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const [s, setS] = useState<CfState | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(() => get<CfState>('/api/admin/cloudflare').then(setS, () => {}), []);
  useEffect(() => { load(); }, [load]);
  if (!s) return null;
  const run = async (e?: FormEvent) => {
    e?.preventDefault(); setBusy(true); setErr('');
    try { const r = await post<{ ready: boolean }>('/api/admin/cloudflare', token ? { token } : {}); setToken(''); await load(); onChange(); toast(r.ready ? 'Cloudflare is set up. Custom domains are ready.' : 'Some steps need attention.'); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not reach Cloudflare.'); }
    setBusy(false);
  };
  const disconnect = async () => { if (!confirm('Disconnect Cloudflare? Domains already live keep working; new ones cannot be added until you connect again.')) return; await api('DELETE', '/api/admin/cloudflare'); setS({ ...s, connected: false, last: null }); onChange(); };
  const ready = s.connected && s.last?.ready;
  return (
    <section className={`cf-card ${ready ? 'ready' : ''}`} aria-labelledby="cf-h">
      <header className="cf-head">
        <div><h2 id="cf-h">Cloudflare</h2><p className="hint">{ready ? <>Connected{s.from === 'env' ? ' (from the server settings)' : ''}. Customers point their domains at <span className="mono">{s.target}</span>.</> : s.connected ? 'Connected, but some steps need attention.' : 'Connect once and Jhino sets up everything custom domains need.'}</p></div>
        <span className={`cf-pill ${ready ? 'ok' : s.connected ? 'warn' : ''}`}>{ready ? 'Ready' : s.connected ? 'Needs attention' : 'Not connected'}</span>
      </header>
      {!s.connected && (
        <ol className="cf-how">
          <li>In Cloudflare, open <b>{s.base}</b> → <b>SSL/TLS</b> → <b>Custom Hostnames</b> and press <b>Enable</b> (100 domains free, then USD 0.10 each a month).</li>
          <li>Go to <b>My Profile → API Tokens → Create Token → Custom token</b>. Add these permissions for the zone <b>{s.base}</b>:
            <span className="cf-perms"><span>Zone · DNS · Edit</span><span>Zone · SSL and Certificates · Edit</span><span>Zone · Config Rules · Edit</span><span>Zone · Zone · Read</span></span>
            If <b>Custom Hostnames</b> is in the list, add <span className="mono">Zone · Custom Hostnames · Edit</span> too.</li>
          <li>Paste the token below. Jhino adds <span className="mono">{s.origin}</span> and <span className="mono">{s.target}</span>, sets the fallback origin, and adds the SSL rule for customer domains.</li>
        </ol>
      )}
      {s.last && (
        <ul className="cf-steps">{s.last.steps.map((st) => (
          <li key={st.key} className={st.ok ? 'ok' : 'no'}><Icon name={st.ok ? 'check' : 'info'} size={15} /><span><b>{st.label}</b>{st.note && <small>{st.note}</small>}</span></li>
        ))}</ul>
      )}
      {s.from !== 'env' && (
        <form className="cf-form" onSubmit={run}>
          {!s.connected && <input className="input mono" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste the Cloudflare API token" aria-label="Cloudflare API token" />}
          <button className="btn primary" disabled={busy || (!s.connected && !token.trim())}>{busy && <span className="spin" />}{s.connected ? 'Check and fix again' : 'Connect and set up'}</button>
          {s.connected && <button type="button" className="btn quiet danger" onClick={disconnect}>Disconnect</button>}
        </form>
      )}
      {s.from === 'env' && <div className="actions-row"><button className="btn" onClick={() => run()} disabled={busy}>{busy && <span className="spin" />}Check and fix again</button></div>}
      {err && <p className="error-text" role="alert">{err}</p>}
      <p className="hint">The token is stored encrypted on the server and never shown again.</p>
    </section>
  );
}

/* ---------------- Super Admin → Custom domains ---------------- */
interface AdminDomainT extends DomainT { ownerId: string; ownerName: string | null; ownerEmail: string | null; appName: string | null }
export function DomainsAdmin() {
  const toast = useToast();
  const { user } = useSession();
  const [q, setQ] = useState('');
  const [d, setD] = useState<{ mode: 'cloudflare' | 'self'; target: string; aRecord: string | null; counts: Record<string, number>; hostnames?: number; domains: AdminDomainT[] } | null>(null);
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
      <CloudflareCard onChange={load} />
      {d && d.hostnames !== undefined && (() => {
        const used = d.hostnames, free = 100, over = Math.max(0, used - free);
        return (
          <section className="cf-usage" aria-label="Cloudflare usage">
            <div className="cf-usage-top"><b>Cloudflare hostnames</b><span className="mono">{used} of {free} free</span></div>
            <div className="cf-meter" aria-hidden="true"><i style={{ transform: `scaleX(${Math.min(1, used / free)})` }} className={used >= free ? 'full' : used >= free * 0.8 ? 'near' : ''} /></div>
            <p className="hint">{over ? <>{over} over the free 100: about <b>USD {(over * 0.1).toFixed(2)} a month</b> at Cloudflare's USD 0.10 per extra hostname.</> : <>No cost until 100. After that Cloudflare charges USD 0.10 for each extra hostname.</>} A domain with the www option counts as two. Check the exact bill in Cloudflare → Billing.</p>
          </section>
        );
      })()}
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
