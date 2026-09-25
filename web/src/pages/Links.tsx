import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, get, post } from '../api';
import { Link, useSession } from '../context';
import { Icon, ago, copyText, useToast } from '../ui';
import { PlanTag, useNameCheck } from './Address';

/*
 * Short links: jhino.com/<code> goes on to any web address, and counts clicks.
 * One list, a form on top, details (and the daily chart on Pro) on demand.
 */

interface LinkT { id: string; code: string; url: string; title: string; short: string; clicks: number; lastClickAt: string | null; disabled: boolean; disabledReason: string; createdAt: string }
interface Allowance { used: number; limit: number | null; customCodes: boolean; stats: boolean }

const shortHost = (u: string) => { try { const x = new URL(u); return x.host.replace(/^www\./, '') + (x.pathname === '/' ? '' : x.pathname); } catch { return u; } };

export function LinksPage() {
  const toast = useToast();
  const [d, setD] = useState<{ links: LinkT[]; allowance: Allowance; host: string } | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => get<{ links: LinkT[]; allowance: Allowance; host: string }>('/api/links').then(setD, (e) => toast(e instanceof ApiError ? e.message : 'Could not load.', true)), [toast]);
  useEffect(() => { load(); }, [load]);
  const list = (d?.links ?? []).filter((l) => !q || (l.code + ' ' + l.url + ' ' + l.title).toLowerCase().includes(q.toLowerCase()));
  const total = (d?.links ?? []).reduce((s, l) => s + l.clicks, 0);
  return (
    <main className="page links-page">
      <header className="lk-head">
        <div>
          <h1>Links</h1>
          <p className="muted">Short addresses on {d?.host ?? location.host} that go to any page: a Drive folder, a YouTube cut, a form.</p>
        </div>
        {d && (
          <dl className="lk-meter">
            <div><dt>Links</dt><dd className="mono">{d.allowance.used}{d.allowance.limit !== null && <small> / {d.allowance.limit}</small>}</dd></div>
            <div><dt>Clicks</dt><dd className="mono">{total.toLocaleString('en-IN')}</dd></div>
          </dl>
        )}
      </header>
      {d && <NewLink host={d.host} allowance={d.allowance} onMade={(l) => { load(); setOpen(l.id); }} />}
      {d && d.links.length > 6 && (
        <label className="ix-search lk-search"><Icon name="search" size={16} /><span className="sr-only">Search links</span><input placeholder="Search links" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      )}
      {!d ? <div className="acc-skel" /> : !d.links.length ? (
        <p className="lk-empty muted">No links yet. Paste a long address above and you get a short one to send.</p>
      ) : (
        <ul className="lk-list">
          {list.map((l) => (
            <li key={l.id} className={`${l.disabled ? 'off' : ''} ${open === l.id ? 'open' : ''}`}>
              <div className="lk-row">
                <button className="lk-main" onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}>
                  <b className="mono">/{l.code}</b>
                  <span className="lk-to">{l.title ? <><span>{l.title}</span> · </> : null}{shortHost(l.url)}</span>
                </button>
                <span className="lk-clicks mono" title={l.lastClickAt ? `Last click ${ago(l.lastClickAt)}` : 'No clicks yet'}>{l.clicks.toLocaleString('en-IN')}<small> clicks</small></span>
                <button className="btn sm" onClick={() => copyText(l.short).then(() => toast('Link copied'))}><Icon name="copy" size={14} /><span className="hide-sm">Copy</span></button>
              </div>
              {l.disabled && <p className="error-text lk-off">Turned off by Jhino{l.disabledReason ? `: ${l.disabledReason}` : ''}.</p>}
              {open === l.id && <LinkDetail link={l} host={d.host} allowance={d.allowance} onChanged={load} onGone={() => { setOpen(null); load(); }} />}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function NewLink({ host, allowance, onMade }: { host: string; allowance: Allowance; onMade: (l: LinkT) => void }) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [named, setNamed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const check = useNameCheck(named ? code : '');
  const full = allowance.limit !== null && allowance.used >= allowance.limit;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await post<{ link: LinkT }>('/api/links', { url, code: named && code ? code : undefined });
      await copyText(r.link.short).catch(() => {});
      toast(`${r.link.short.replace(/^https?:\/\//, '')} is ready and copied`);
      setUrl(''); setCode(''); setNamed(false);
      onMade(r.link);
    } catch (e2) { setError(e2 instanceof ApiError ? e2.message : 'Could not make it.'); }
    setBusy(false);
  };
  return (
    <form className="lk-new" onSubmit={submit}>
      <label className="lk-url">
        <span className="sr-only">Long address</span>
        <Icon name="link" size={17} />
        <input type="text" inputMode="url" required placeholder="Paste a long address, like https://drive.google.com/…" value={url} onChange={(e) => setUrl(e.target.value)} disabled={full} />
      </label>
      {named && (
        <div className={`lk-code addr-input ${check.state}`}>
          <span className="addr-host mono">{host}/</span>
          <input className="mono" value={code} maxLength={50} placeholder="spring-reel" aria-label="Short name" onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
        </div>
      )}
      <button className="btn primary" disabled={busy || full || !url.trim() || (named && !!code && check.state !== 'ok')}>{busy && <span className="spin" />}Shorten</button>
      <div className="lk-new-foot">
        {allowance.customCodes
          ? <button type="button" className="link" onClick={() => setNamed(!named)}>{named ? 'Use a random name' : 'Choose the name'}</button>
          : <span className="hint">Random names like /k7m2qa. Choosing the name is on Plus <PlanTag /></span>}
        {named && check.state === 'bad' && <span className="error-text">{check.reason}</span>}
        {full && <span className="error-text">All {allowance.limit} links on your plan are in use. <Link to="/account/plan" className="link">See plans</Link></span>}
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </form>
  );
}

function LinkDetail({ link, host, allowance, onChanged, onGone }: { link: LinkT; host: string; allowance: Allowance; onChanged: () => void; onGone: () => void }) {
  const toast = useToast();
  const { user } = useSession();
  const [f, setF] = useState({ url: link.url, code: link.code, title: link.title });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [days, setDays] = useState<{ day: string; n: number }[] | null>(null);
  const check = useNameCheck(f.code !== link.code ? f.code : '', { link: link.id });
  useEffect(() => { if (allowance.stats) get<{ days: { day: string; n: number }[] }>(`/api/links/${link.id}/stats`).then((r) => setDays(r.days), () => {}); }, [link.id, allowance.stats]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await api('PATCH', `/api/links/${link.id}`, f); toast('Saved'); onChanged(); }
    catch (e2) { setError(e2 instanceof ApiError ? e2.message : 'Could not save.'); }
    setBusy(false);
  };
  const del = async () => {
    if (!confirm(`Delete ${host}/${link.code}? Anyone who clicks it after this gets "Nothing here", and the name becomes free.`)) return;
    try { await api('DELETE', `/api/links/${link.id}`); toast('Deleted'); onGone(); } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete.', true); }
  };
  const max = days ? Math.max(1, ...days.map((d) => d.n)) : 1;
  return (
    <div className="lk-detail">
      <div className="lk-chart" aria-label="Clicks per day, last 30 days">
        {days ? (
          <>
            <div className="lk-bars" role="img" aria-label={`${days.reduce((s, d) => s + d.n, 0)} clicks in the last 30 days`}>
              {days.map((d) => <i key={d.day} style={{ transform: `scaleY(${d.n / max})` }} title={`${d.day}: ${d.n}`} />)}
            </div>
            <div className="lk-axis mono"><span>30 days ago</span><span>today</span></div>
          </>
        ) : allowance.stats ? <div className="acc-skel sm" /> : (
          <p className="hint">{link.clicks.toLocaleString('en-IN')} clicks in total{link.lastClickAt ? `, the last ${ago(link.lastClickAt)}` : ''}. Clicks for each day are on Pro <PlanTag plan="Pro" /></p>
        )}
      </div>
      <form className="lk-edit" onSubmit={save}>
        <label className="field"><span>Goes to</span><input className="input" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></label>
        <div className="grid2">
          <label className="field"><span>Label <em>optional, only you see it</em></span><input className="input" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Spring reel for Himalayan Coffee" /></label>
          <div className="field">
            <span>Short name {!allowance.customCodes && <PlanTag />}</span>
            <div className={`addr-input ${f.code !== link.code ? check.state : ''}`}>
              <span className="addr-host mono">{host}/</span>
              <input className="mono" value={f.code} maxLength={50} disabled={!allowance.customCodes && !user.isAdmin} aria-label="Short name" onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
            </div>
            {f.code !== link.code && check.state === 'bad' && <small className="error-text">{check.reason}</small>}
          </div>
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="actions-row">
          <button className="btn sm primary" disabled={busy || (f.code !== link.code && check.state !== 'ok')}>{busy && <span className="spin" />}Save</button>
          <a className="btn sm quiet" href={link.url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={14} />Open target</a>
          <button type="button" className="btn sm quiet danger" onClick={del}>Delete</button>
          <span className="muted small lk-made">Made {ago(link.createdAt)}</span>
        </div>
      </form>
    </div>
  );
}
