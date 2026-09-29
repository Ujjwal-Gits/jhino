import { useEffect, useMemo, useState } from 'react';
import { ApiError, api, get, post } from '../../api';
import { PanelLoader } from '../../Loader';
import { Icon, Modal, Select, useToast } from '../../ui';

/*
 * Subscriptions and domains: every renewal in one place (AI tools, streaming, software, hosting, domains,
 * free trials), what it all costs a month and a year in rupees (Nepal Rastra Bank rates), and what renews or
 * expires next. Domains are looked up automatically (RDAP): expiry date and registrar, re-checked weekly.
 * Saved as "sub" items in server/tools.ts, so reminders go to the bell and email; server/everyday.ts rolls
 * monthly and yearly dates forward and re-checks domains.
 */
type Kind = 'sub' | 'trial' | 'domain';
type Cycle = 'monthly' | 'yearly' | 'quarterly' | 'weekly' | 'once';
interface Sub {
  id: string; service: string; subType?: Kind; category?: string; amount?: number; currency?: string; cycle?: string; price?: string;
  remindDays?: number; cancelUrl?: string; notes?: string; status?: string; domain?: string; registrar?: string; scannedAt?: string; account?: string;
  dueAt: string | null; archived: boolean;
}
interface Fx { date: string; rates: Record<string, { name: string; buy: number; sell: number }> }
const CATS = ['AI tools', 'Software', 'Design', 'Streaming', 'Music', 'Cloud storage', 'Hosting', 'Domains', 'Phone and internet', 'Education', 'Gaming', 'News', 'Fitness', 'Other'];
const CUR = ['NPR', 'USD', 'INR', 'EUR', 'GBP', 'AUD', 'AED'];
const CYCLES: [Cycle, string][] = [['monthly', 'Monthly'], ['yearly', 'Yearly'], ['quarterly', 'Every 3 months'], ['weekly', 'Weekly'], ['once', 'One time']];
const PRESETS: [string, number, string, Cycle, string, string][] = [
  ['Claude Pro', 20, 'USD', 'monthly', 'AI tools', 'https://claude.ai/settings/billing'],
  ['ChatGPT Plus', 20, 'USD', 'monthly', 'AI tools', 'https://chatgpt.com/#settings'],
  ['Gemini Advanced', 20, 'USD', 'monthly', 'AI tools', 'https://one.google.com/settings'],
  ['Cursor Pro', 20, 'USD', 'monthly', 'AI tools', 'https://cursor.com/settings'],
  ['GitHub Copilot', 10, 'USD', 'monthly', 'AI tools', 'https://github.com/settings/billing'],
  ['Midjourney', 10, 'USD', 'monthly', 'AI tools', 'https://www.midjourney.com/account'],
  ['Canva Pro', 15, 'USD', 'monthly', 'Design', 'https://www.canva.com/settings/billing-and-teams'],
  ['Adobe Creative Cloud', 60, 'USD', 'monthly', 'Design', 'https://account.adobe.com/plans'],
  ['Figma', 15, 'USD', 'monthly', 'Design', 'https://www.figma.com/settings'],
  ['CapCut Pro', 8, 'USD', 'monthly', 'Design', ''],
  ['Netflix', 799, 'NPR', 'monthly', 'Streaming', 'https://www.netflix.com/cancelplan'],
  ['YouTube Premium', 12, 'USD', 'monthly', 'Streaming', 'https://www.youtube.com/paid_memberships'],
  ['Spotify', 11, 'USD', 'monthly', 'Music', 'https://www.spotify.com/account/subscription/'],
  ['Google One', 2, 'USD', 'monthly', 'Cloud storage', 'https://one.google.com/settings'],
  ['iCloud+', 1, 'USD', 'monthly', 'Cloud storage', 'https://support.apple.com/en-us/118428'],
  ['Microsoft 365', 100, 'USD', 'yearly', 'Software', 'https://account.microsoft.com/services'],
  ['Notion', 10, 'USD', 'monthly', 'Software', 'https://www.notion.so/my-account'],
  ['Vercel Pro', 20, 'USD', 'monthly', 'Hosting', 'https://vercel.com/account/billing'],
  ['Hosting', 0, 'USD', 'yearly', 'Hosting', ''],
];
const msg = (e: unknown, f: string) => (e instanceof ApiError ? e.message : f);
const kindOf = (s: Sub): Kind => (s.subType ?? (s.domain ? 'domain' : s.cycle === 'trial' ? 'trial' : 'sub'));
/** Old items keep their price as text ("NPR 1,200"); read a number and currency out of it. */
const amountOf = (s: Sub) => {
  if (typeof s.amount === 'number') return { n: s.amount, c: s.currency || 'NPR' };
  const t = String(s.price ?? ''); const n = Number(t.replace(/[^\d.]/g, '')) || 0;
  const c = /\$|usd/i.test(t) ? 'USD' : /inr|₹/i.test(t) ? 'INR' : /€|eur/i.test(t) ? 'EUR' : 'NPR';
  return { n, c };
};
const perMonth = (n: number, cycle?: string) => (cycle === 'monthly' ? n : cycle === 'yearly' ? n / 12 : cycle === 'quarterly' ? n / 3 : cycle === 'weekly' ? (n * 52) / 12 : 0);
const daysLeft = (iso: string | null) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5) : null);
const fmt = (n: number, c = 'NPR') => `${c === 'NPR' ? 'Rs' : c} ${n.toLocaleString(undefined, { maximumFractionDigits: c === 'NPR' ? 0 : 2 })}`;
const dateStr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date');

export function Subscriptions() {
  const toast = useToast();
  const [items, setItems] = useState<Sub[] | null>(null);
  const [fx, setFx] = useState<Fx | null>(null);
  const [filter, setFilter] = useState<'all' | Kind | 'cancelled'>('all');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Sub | Kind | null>(null);
  const load = () => get<{ items: Sub[] }>('/api/tools/sub').then((r) => setItems(r.items), (e) => { toast(msg(e, 'Could not load.'), true); setItems([]); });
  useEffect(() => { load(); get<Fx>('/api/fx').then(setFx, () => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toNpr = (n: number, c: string) => (c === 'NPR' ? n : fx?.rates[c] ? n * fx.rates[c].sell : null);

  const stats = useMemo(() => {
    const active = (items ?? []).filter((s) => s.status !== 'cancelled' && !s.archived);
    let month = 0, missing = 0, next30 = 0, next30n = 0;
    const byCat: Record<string, number> = {};
    for (const s of active) {
      const { n, c } = amountOf(s); const npr = toNpr(n, c);
      if (npr === null) { if (n) missing++; continue; }
      const m = kindOf(s) === 'trial' ? 0 : perMonth(npr, s.cycle);
      month += m; const cat = s.category || (kindOf(s) === 'domain' ? 'Domains' : 'Other'); byCat[cat] = (byCat[cat] ?? 0) + m;
      const d = daysLeft(s.dueAt); if (d !== null && d >= 0 && d <= 30 && kindOf(s) !== 'trial') { next30 += npr; next30n++; }
    }
    const domains = active.filter((s) => kindOf(s) === 'domain');
    return { month, year: month * 12, missing, next30, next30n, byCat: Object.entries(byCat).sort((a, b) => b[1] - a[1]), active: active.length, domainsSoon: domains.filter((s) => (daysLeft(s.dueAt) ?? 999) <= 60).length, domains: domains.length };
  }, [items, fx]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!items) return <PanelLoader />;
  const shown = items
    .filter((s) => (filter === 'all' ? s.status !== 'cancelled' : filter === 'cancelled' ? s.status === 'cancelled' : kindOf(s) === filter && s.status !== 'cancelled'))
    .filter((s) => !q || `${s.service} ${s.domain ?? ''} ${s.category ?? ''} ${s.registrar ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => String(a.dueAt ?? '9').localeCompare(String(b.dueAt ?? '9')));
  const urgent = shown.filter((s) => { const d = daysLeft(s.dueAt); return d !== null && d <= 7 && s.status !== 'cancelled'; });
  const rest = shown.filter((s) => !urgent.includes(s));
  const patch = async (s: Sub, b: Record<string, unknown>) => { try { const r = await api<{ item: Sub }>('PATCH', `/api/tools/sub/${s.id}`, b); setItems((l) => (l ?? []).map((x) => (x.id === s.id ? r.item : x))); } catch (e) { toast(msg(e, 'Could not save.'), true); } };
  const del = async (s: Sub) => { if (!confirm(`Delete ${s.service}?`)) return; try { await api('DELETE', `/api/tools/sub/${s.id}`); setItems((l) => (l ?? []).filter((x) => x.id !== s.id)); } catch (e) { toast(msg(e, 'Could not delete.'), true); } };
  const csv = () => {
    const rows = [['Name', 'Type', 'Category', 'Amount', 'Currency', 'Cycle', 'Next date', 'Per month (NPR)', 'Status', 'Registrar', 'Manage link', 'Notes'],
      ...items.map((s) => { const { n, c } = amountOf(s); const npr = toNpr(n, c); return [s.service, kindOf(s), s.category ?? '', n, c, s.cycle ?? '', s.dueAt?.slice(0, 10) ?? '', npr === null ? '' : Math.round(perMonth(npr, s.cycle)), s.status ?? 'active', s.registrar ?? '', s.cancelUrl ?? '', s.notes ?? '']; })];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' })); a.download = 'subscriptions.csv'; a.click();
  };

  const Row = ({ s }: { s: Sub }) => {
    const d = daysLeft(s.dueAt), k = kindOf(s), { n, c } = amountOf(s), npr = toNpr(n, c);
    return (
      <li className={`sb-row ${s.status === 'cancelled' ? 'off' : ''}`}>
        <span className="sb-tile" aria-hidden="true">{(s.domain || s.service).slice(0, 1).toUpperCase()}</span>
        <button className="sb-main" onClick={() => setEdit(s)}>
          <b>{s.service}</b>
          <small>{[k === 'domain' ? (s.registrar || 'Domain') : k === 'trial' ? 'Free trial' : (s.category || 'Subscription'), k === 'trial' ? (n ? `then ${fmt(n, c)}` : '') : CYCLES.find(([v]) => v === s.cycle)?.[1], s.account].filter(Boolean).join(' · ')}</small>
        </button>
        <span className="sb-amt">{n ? <><b className="mono">{fmt(n, c)}</b>{c !== 'NPR' && npr !== null && <small className="mono">≈ {fmt(Math.round(npr))}</small>}</> : <small>—</small>}</span>
        <span className="sb-when"><small>{k === 'domain' ? 'Expires' : k === 'trial' ? 'Trial ends' : s.cycle === 'once' ? 'Date' : 'Renews'} {dateStr(s.dueAt)}</small>
          {d !== null && s.status !== 'cancelled' && <span className={`sb-days ${d < 0 ? 'past' : d <= 3 ? 'hot' : d <= 14 ? 'warm' : ''}`}>{d < 0 ? `${-d} d ago` : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `${d} days`}</span>}</span>
        <span className="sb-acts">
          {/^https?:\/\//.test(s.cancelUrl ?? '') && <a className="icon-btn" href={s.cancelUrl} target="_blank" rel="noopener noreferrer" title="Manage or cancel" aria-label={`Manage ${s.service}`}><Icon name="external" size={15} /></a>}
          <button className="icon-btn" title={s.status === 'cancelled' ? 'Mark active' : 'Mark cancelled'} aria-label={s.status === 'cancelled' ? 'Mark active' : 'Mark cancelled'} onClick={() => patch(s, { status: s.status === 'cancelled' ? 'active' : 'cancelled' })}><Icon name={s.status === 'cancelled' ? 'refresh' : 'close'} size={15} /></button>
          <button className="icon-btn" aria-label={`Delete ${s.service}`} onClick={() => del(s)}><Icon name="trash" size={15} /></button>
        </span>
      </li>
    );
  };

  return (
    <div className="sb">
      <div className="sb-sum">
        <div><small>Per month</small><b className="mono">{fmt(Math.round(stats.month))}</b><span>{stats.active} active</span></div>
        <div><small>Per year</small><b className="mono">{fmt(Math.round(stats.year))}</b><span>{fx ? `NRB rates, ${fx.date}` : 'Rupees only until rates load'}</span></div>
        <div><small>Due in 30 days</small><b className="mono">{fmt(Math.round(stats.next30))}</b><span>{stats.next30n} {stats.next30n === 1 ? 'payment' : 'payments'}</span></div>
        <div><small>Domains</small><b className="mono">{stats.domains}</b><span>{stats.domainsSoon ? `${stats.domainsSoon} expire within 60 days` : 'None expiring soon'}</span></div>
      </div>
      {stats.missing > 0 && <p className="hint">{stats.missing} item{stats.missing > 1 ? 's are' : ' is'} in a currency without a rate and left out of the totals.</p>}

      <div className="sb-bar">
        <div className="tp-tabs" role="tablist">
          {([['all', 'All'], ['sub', 'Subscriptions'], ['trial', 'Trials'], ['domain', 'Domains'], ['cancelled', 'Cancelled']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <input className="input sb-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search" />
        <span className="actions-row">
          <button className="btn primary" onClick={() => setEdit('sub')}><Icon name="plus" size={16} />Subscription</button>
          <button className="btn" onClick={() => setEdit('domain')}><Icon name="globe" size={16} />Domain</button>
          <button className="btn" onClick={() => setEdit('trial')}>Free trial</button>
        </span>
      </div>

      <div className="sb-grid">
        <section>
          {!items.length ? (
            <div className="tp-empty sb-empty">
              <b>Everything you pay for, in one list.</b>
              <p>Add Claude, ChatGPT, Netflix, your hosting and your domains. You see the monthly and yearly total in rupees, and get a reminder before each one renews or expires.</p>
              <div className="actions-row center"><button className="btn primary" onClick={() => setEdit('sub')}>Add a subscription</button><button className="btn" onClick={() => setEdit('domain')}>Add a domain</button></div>
            </div>
          ) : <>
            {!!urgent.length && <><h2 className="sb-h">Needs attention</h2><ul className="sb-list">{urgent.map((s) => <Row key={s.id} s={s} />)}</ul></>}
            {!!rest.length && <><h2 className="sb-h">{urgent.length ? 'Later' : 'Upcoming'}</h2><ul className="sb-list">{rest.map((s) => <Row key={s.id} s={s} />)}</ul></>}
            {!shown.length && <p className="tp-empty">Nothing here.</p>}
          </>}
        </section>
        <aside className="tp-card sb-side">
          <h2>Where the money goes</h2>
          {!stats.byCat.length ? <p className="hint">Add prices to see this.</p> : (
            <ul className="sb-cats">{stats.byCat.map(([c, v]) => (
              <li key={c}><span>{c}</span><b className="mono">{fmt(Math.round(v))}</b><i style={{ transform: `scaleX(${v / (stats.byCat[0][1] || 1)})` }} /></li>
            ))}</ul>
          )}
          <p className="hint">Per month, in rupees. Yearly plans are spread over 12 months; trials count once they are paid.</p>
          <button className="btn sm" onClick={csv} disabled={!items.length}><Icon name="download" size={15} />Export CSV</button>
        </aside>
      </div>
      {edit && <SubForm init={typeof edit === 'string' ? null : edit} kind={typeof edit === 'string' ? edit : kindOf(edit)} onClose={() => setEdit(null)} onSaved={(it, isNew) => { setItems((l) => (isNew ? [it, ...(l ?? [])] : (l ?? []).map((x) => (x.id === it.id ? it : x)))); setEdit(null); }} />}
    </div>
  );
}

function SubForm({ init, kind: k0, onClose, onSaved }: { init: Sub | null; kind: Kind; onClose: () => void; onSaved: (s: Sub, isNew: boolean) => void }) {
  const toast = useToast();
  const a0 = init ? amountOf(init) : { n: 0, c: k0 === 'domain' ? 'USD' : 'USD' };
  const [kind, setKind] = useState<Kind>(k0);
  const [f, setF] = useState({
    service: init?.service ?? '', category: init?.category ?? (k0 === 'domain' ? 'Domains' : 'AI tools'), amount: a0.n ? String(a0.n) : '', currency: a0.c,
    cycle: (init?.cycle && init.cycle !== 'trial' ? init.cycle : k0 === 'domain' ? 'yearly' : 'monthly') as Cycle, date: init?.dueAt ? init.dueAt.slice(0, 10) : '',
    remind: String(init?.remindDays ?? (k0 === 'domain' ? 30 : k0 === 'trial' ? 1 : 3)), cancelUrl: init?.cancelUrl ?? '', notes: init?.notes ?? '', account: init?.account ?? '',
    domain: init?.domain ?? '', registrar: init?.registrar ?? '',
  });
  const [scan, setScan] = useState<{ busy: boolean; note?: string }>({ busy: false });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const lookup = async () => {
    if (!f.domain.trim()) return;
    setScan({ busy: true });
    try {
      const r = await post<{ domain: string; expiresAt: string | null; registrar: string; note?: string }>('/api/subs/scan', { domain: f.domain });
      set({ domain: r.domain, service: f.service || r.domain, registrar: r.registrar || f.registrar, date: r.expiresAt ? r.expiresAt.slice(0, 10) : f.date });
      setScan({ busy: false, note: r.expiresAt ? `Found: expires ${dateStr(r.expiresAt)}${r.registrar ? ` at ${r.registrar}` : ''}. We check again every week.` : r.note });
    } catch (e) { setScan({ busy: false, note: msg(e, 'Could not look it up.') }); }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    const due = f.date ? new Date(`${f.date}T09:00`).toISOString() : null, n = Number(f.amount) || 0;
    const b = {
      service: (f.service || f.domain).trim(), subType: kind, category: kind === 'domain' ? 'Domains' : f.category, amount: n, currency: f.currency,
      cycle: kind === 'trial' ? 'trial' : f.cycle, price: n ? `${f.currency} ${n}` : '', remindDays: Number(f.remind), cancelUrl: f.cancelUrl.trim(), notes: f.notes, account: f.account.trim(),
      domain: kind === 'domain' ? f.domain.trim().toLowerCase() : '', registrar: kind === 'domain' ? f.registrar : '', status: init?.status ?? 'active',
      dueAt: due, remindAt: due ? new Date(new Date(due).getTime() - Number(f.remind) * 864e5).toISOString() : null,
    };
    try {
      const r = init ? await api<{ item: Sub }>('PATCH', `/api/tools/sub/${init.id}`, b) : await post<{ item: Sub }>('/api/tools/sub', b);
      window.dispatchEvent(new Event('jhino-tools-changed')); onSaved(r.item, !init);
    } catch (x) { toast(msg(x, 'Could not save.'), true); }
    setBusy(false);
  };
  return (
    <Modal title={init ? `Edit ${init.service}` : kind === 'domain' ? 'Add a domain' : kind === 'trial' ? 'Add a free trial' : 'Add a subscription'} onClose={onClose} wide>
      <form className="tp-form sb-form" onSubmit={save}>
        {!init && <div className="tp-seg">{([['sub', 'Subscription'], ['trial', 'Free trial'], ['domain', 'Domain']] as const).map(([v, l]) => <button type="button" key={v} aria-pressed={kind === v} onClick={() => { setKind(v); set({ remind: v === 'domain' ? '30' : v === 'trial' ? '1' : '3', cycle: v === 'domain' ? 'yearly' : f.cycle }); }}>{l}</button>)}</div>}
        {kind === 'sub' && !init && <div className="tp-chips sb-presets">{PRESETS.map(([name, amt, cur, cyc, cat, url]) => (
          <button type="button" key={name} className="chip" onClick={() => set({ service: name, amount: amt ? String(amt) : '', currency: cur, cycle: cyc, category: cat, cancelUrl: url })}>{name}</button>
        ))}</div>}
        {kind === 'domain' ? <>
          <div className="field"><span>Domain</span>
            <div className="tp-inline"><input className="input" required value={f.domain} onChange={(e) => set({ domain: e.target.value })} onBlur={() => { if (f.domain && !f.date) lookup(); }} placeholder="yourbrand.com" autoFocus={!init} />
              <button type="button" className="btn" onClick={lookup} disabled={scan.busy || !f.domain.trim()}>{scan.busy && <span className="spin" />}Look up</button></div>
          </div>
          {scan.note && <p className="hint">{scan.note}</p>}
          <div className="grid2">
            <label className="field"><span>Expires</span><input className="input" type="date" required value={f.date} onChange={(e) => set({ date: e.target.value })} /></label>
            <label className="field"><span>Registrar</span><input className="input" value={f.registrar} onChange={(e) => set({ registrar: e.target.value })} placeholder="Namecheap, GoDaddy, Mercantile…" /></label>
          </div>
        </> : <>
          <label className="field"><span>Name</span><input className="input" required maxLength={120} value={f.service} onChange={(e) => set({ service: e.target.value })} placeholder={kind === 'trial' ? 'Canva Pro trial' : 'Claude Pro'} autoFocus={!init} /></label>
          <div className="field"><span>Category</span><Select label="Category" value={f.category} options={CATS.map((c) => ({ value: c, label: c }))} onChange={(v) => set({ category: v })} /></div>
        </>}
        <div className="grid2">
          <div className="field"><span>{kind === 'trial' ? 'Price after the trial' : kind === 'domain' ? 'Renewal price' : 'Price'} <em>optional</em></span>
            <div className="tp-inline"><input className="input mono" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" /><Select label="Currency" size="sm" width={92} value={f.currency} options={CUR.map((c) => ({ value: c, label: c }))} onChange={(v) => set({ currency: v })} /></div></div>
          {kind === 'sub' ? <div className="field"><span>Billed</span><Select label="Billed" value={f.cycle} options={CYCLES.map(([v, l]) => ({ value: v, label: l }))} onChange={(v) => set({ cycle: v })} /></div>
            : kind === 'trial' ? <label className="field"><span>Trial ends</span><input className="input" type="date" required value={f.date} onChange={(e) => set({ date: e.target.value })} /></label> : <span />}
        </div>
        <div className="grid2">
          {kind === 'sub' && <label className="field"><span>Next payment</span><input className="input" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} /></label>}
          <div className="field"><span>Remind me</span><Select label="Remind me" value={f.remind} options={[['0', 'On the day'], ['1', '1 day before'], ['3', '3 days before'], ['7', 'A week before'], ['14', '2 weeks before'], ['30', 'A month before'], ['60', '2 months before']].map(([v, l]) => ({ value: v, label: l }))} onChange={(v) => set({ remind: v })} /></div>
        </div>
        <div className="grid2">
          <label className="field"><span>Manage or cancel link <em>optional</em></span><input className="input" inputMode="url" value={f.cancelUrl} onChange={(e) => set({ cancelUrl: e.target.value })} placeholder="https://…" /></label>
          <label className="field"><span>Account <em>optional</em></span><input className="input" maxLength={120} value={f.account} onChange={(e) => set({ account: e.target.value })} placeholder="Which email or login" /></label>
        </div>
        <label className="field"><span>Notes <em>optional</em></span><input className="input" maxLength={500} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
        <p className="hint">{kind === 'domain' ? 'We read the public registry record for the expiry date; nothing is changed at your registrar.' : 'Monthly and yearly dates move forward by themselves after each payment. No card details are needed.'}</p>
        <div className="actions-row"><button className="btn primary" disabled={busy}>{busy && <span className="spin" />}Save</button><button type="button" className="btn quiet" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}
