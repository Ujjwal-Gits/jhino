import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, get, post } from '../api';
import { useRoute, useSession } from '../context';
import { Icon, Select, useToast } from '../ui';
import { AddressField, OpenChoice, addrBase, addressPayload, openReady, slugify, useNameCheck, type OpenSettings } from './Address';

interface Feature { key: string; name: string; category: string; description: string; own: boolean; tags: string[] }
interface Template { key: string; name: string; description: string; blocks: string[] }
interface Catalog { categories: string[]; blocks: Feature[]; templates: Template[] }
interface Instance { id: string; preset: string; title: string }
interface Config {
  v: 1; name: string; purpose: string; client: string; field: string;
  design: { accent: string; style: 'modern' | 'editorial' | 'technical'; currency: string; theme: 'light' | 'auto'; calendar: 'bs' | 'ad'; logo?: string };
  blocks: Instance[];
}

const ACCENTS = [
  { hex: '#1f6f5c', name: 'Forest' }, { hex: '#9a3412', name: 'Terracotta' }, { hex: '#1f2937', name: 'Graphite' },
  { hex: '#1e5a8a', name: 'Harbour' }, { hex: '#7c2d12', name: 'Walnut' }, { hex: '#4d6b1f', name: 'Moss' },
  { hex: '#a1123c', name: 'Crimson' }, { hex: '#8a6a00', name: 'Brass' },
];
const STYLES: { key: Config['design']['style']; name: string; hint: string }[] = [
  { key: 'modern', name: 'Modern', hint: 'Clean grotesque' },
  { key: 'editorial', name: 'Editorial', hint: 'Serif headings' },
  { key: 'technical', name: 'Technical', hint: 'Mono headings' },
];
const CURRENCIES = ['NPR', 'INR', 'USD', 'EUR', 'GBP', 'AUD', 'AED'];
const newId = (preset: string) => `${preset.replace(/[^a-z0-9_]/g, '_')}_${Math.random().toString(36).slice(2, 6)}`;
const MAX_LOGO = 140_000;
/** Desktop preview is drawn at a real laptop width and scaled to fit, so it shows the desktop layout, not the phone one. */
const DESK_W = 1100;

/** Shrink a logo in the browser so it can live inside the HTML (at most 240 px, WebP or PNG). */
async function shrinkLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    for (const max of [240, 160, 110]) {
      const s = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round((img.naturalWidth || max) * s));
      c.height = Math.max(1, Math.round((img.naturalHeight || max) * s));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      let out = c.toDataURL('image/webp', 0.9);
      if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/png');
      if (out.length <= MAX_LOGO) return out;
    }
    throw new Error('too big');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Create app for working with a client: who it is for, what it should have, how it looks. It opens live straight away. */
export function Builder({ appId }: { appId?: string }) {
  const { go } = useRoute();
  const toast = useToast();
  const [cat, setCat] = useState<Catalog | null>(null);
  const [cfg, setCfg] = useState<Config>({ v: 1, name: '', purpose: '', client: '', field: '', design: { accent: ACCENTS[0].hex, style: 'modern', currency: 'NPR', theme: 'light', calendar: 'bs' }, blocks: [] });
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const [sheet, setSheet] = useState(false);
  const [original, setOriginal] = useState<Instance[]>([]);
  const nameTouched = useRef(!!appId);
  const dirty = useRef(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = device === 'desktop' && stage.w > 0 && stage.w < DESK_W ? stage.w / DESK_W : 1;

  useEffect(() => {
    get<Catalog>('/api/build/catalog').then(setCat, () => setError('Could not load the list of features.'));
    if (appId) {
      get<{ config: Config }>(`/api/apps/${appId}/build`).then(
        (r) => { setCfg({ ...r.config, purpose: r.config.purpose ?? '', client: r.config.client ?? '', field: r.config.field ?? '', design: { ...r.config.design, calendar: r.config.design.calendar ?? 'bs' } }); setOriginal(r.config.blocks); },
        (e) => setError(e instanceof ApiError ? e.message : 'Could not load this HTML.'),
      );
    }
  }, [appId]);

  // Live preview of the real HTML (in-memory data), refreshed as you tick.
  useEffect(() => {
    if (!cfg.blocks.length) { setPreview(''); return; }
    const t = setTimeout(() => {
      post<{ url: string }>('/api/build/preview', { config: { ...cfg, name: cfg.name.trim() || 'Untitled' } })
        .then((r) => setPreview(r.url), (e) => setError(e instanceof ApiError ? e.message : 'Preview failed.'));
    }, 350);
    return () => clearTimeout(t);
  }, [cfg]);

  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', f);
    return () => removeEventListener('beforeunload', f);
  }, []);

  useEffect(() => {
    if (!sheet) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(false); };
    addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [sheet]);

  const change = (fn: (c: Config) => Config) => { dirty.current = true; setError(''); setCfg(fn); };
  const ticked = useMemo(() => new Set(cfg.blocks.map((b) => b.preset)), [cfg.blocks]);
  const byKey = useMemo(() => new Map((cat?.blocks ?? []).map((b) => [b.key, b])), [cat]);
  const fieldName = (key: string) => cat?.templates.find((t) => t.key === key)?.name ?? '';
  const autoName = (client: string, field: string) => [client.trim(), fieldName(field)].filter(Boolean).join(' · ');
  const inst = (k: string) => original.find((o) => o.preset === k) ?? { id: newId(k), preset: k, title: byKey.get(k)?.name ?? k };

  const toggle = (f: Feature) => change((c) => {
    if (c.blocks.some((b) => b.preset === f.key)) return { ...c, blocks: c.blocks.filter((b) => b.preset !== f.key) };
    // Ticking a feature back on keeps its old id, so data saved earlier comes back.
    const i = inst(f.key);
    return { ...c, blocks: f.key === 'summary' ? [i, ...c.blocks] : [...c.blocks, i] };
  });
  const tickAll = (category: string, on: boolean) => change((c) => {
    const keys = (cat?.blocks ?? []).filter((b) => b.category === category).map((b) => b.key);
    if (!on) return { ...c, blocks: c.blocks.filter((b) => !keys.includes(b.preset)) };
    return { ...c, blocks: [...c.blocks, ...keys.filter((k) => !c.blocks.some((b) => b.preset === k)).map(inst)] };
  });
  const pickField = (t: Template | null) => {
    const key = t?.key ?? 'other';
    if (key === cfg.field) return;
    const replace = t && (!cfg.blocks.length || confirm(`Tick the features for ${t.name}? Your current ticks are replaced.`));
    change((c) => ({
      ...c, field: key,
      name: nameTouched.current ? c.name : autoName(c.client, key),
      blocks: replace && t ? t.blocks.map(inst) : c.blocks,
    }));
  };
  const setClient = (client: string) => change((c) => ({ ...c, client, name: nameTouched.current ? c.name : autoName(client, c.field) }));
  const move = (id: string, d: number) => change((c) => {
    const i = c.blocks.findIndex((x) => x.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= c.blocks.length) return c;
    const blocks = c.blocks.slice(); [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    return { ...c, blocks };
  });
  const rename = (id: string, title: string) => change((c) => ({ ...c, blocks: c.blocks.map((x) => (x.id === id ? { ...x, title } : x)) }));
  const setDesign = (d: Partial<Config['design']>) => change((c) => ({ ...c, design: { ...c.design, ...d } }));
  const onLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('The logo must be an image.'); return; }
    try { setDesign({ logo: await shrinkLogo(file) }); }
    catch { setError('That image could not be used as a logo. Try a PNG or JPG.'); }
  };

  const { user } = useSession();
  const [slug, setSlug] = useState('');
  const [open, setOpen] = useState<OpenSettings>({ access: 'public', password: '' });
  const check = useNameCheck(slug);

  const search = q.trim().toLowerCase();
  const visible = (cat?.blocks ?? []).filter((f) =>
    (!filter || (filter === '__on' ? ticked.has(f.key) : f.category === filter)) &&
    (!search || (f.name + ' ' + f.description + ' ' + f.tags.join(' ') + ' ' + f.category).toLowerCase().includes(search)));
  const groups = (cat?.categories ?? []).map((c) => ({ c, list: visible.filter((f) => f.category === c) })).filter((g) => g.list.length);
  const untickedOld = appId ? original.filter((o) => !cfg.blocks.some((b) => b.id === o.id)) : [];
  const ready = cfg.name.trim() && cfg.blocks.length > 0;

  const save = async () => {
    if (!cfg.name.trim()) { setError('Give the HTML a name (step 01).'); document.getElementById('c-name')?.focus(); return; }
    if (!cfg.blocks.length) { setError('Tick at least one feature (step 02).'); document.getElementById('s2')?.scrollIntoView({ block: 'start' }); return; }
    if (cfg.blocks.some((b) => !b.title.trim())) { setError('Every feature in the menu needs a name.'); return; }
    if (!appId && !openReady(slug, check, open)) { setError(check.state === 'bad' ? `Address: ${check.reason}` : open.access === 'password' ? 'Set a password of 4 or more characters, or choose who can open it.' : 'Wait a moment: the address is being checked.'); document.getElementById('s4')?.scrollIntoView({ block: 'start' }); return; }
    setBusy(true); setError('');
    try {
      if (appId) {
        await post(`/api/apps/${appId}/build`, { config: cfg });
        dirty.current = false;
        toast('Saved. Everyone gets the new version right away.');
        go(`/apps/${appId}`);
      } else {
        const r = await post<{ app: { id: string; name: string } }>('/api/apps/build', { config: cfg, address: slug ? addressPayload(slug, open) : undefined });
        dirty.current = false;
        toast(`${r.app.name} is live.`);
        go(`/apps/${r.app.id}`);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the HTML.');
      setBusy(false);
    }
  };

  const createButton = (cls = '') => (
    <button className={`btn primary ${cls}`} onClick={save} disabled={busy}>
      {busy && <span className="spin" />}{appId ? 'Save changes' : 'Create app'}
    </button>
  );
  const frame = (fit: boolean) => preview
    ? <iframe title="Preview of the HTML" sandbox="allow-scripts allow-forms allow-modals" src={preview}
        style={fit && scale < 1 ? { width: DESK_W, height: stage.h / scale, transform: `scale(${scale})` } : undefined} />
    : <div className="pv-empty"><p>Tick a feature and the HTML appears here.</p></div>;
  const deviceSwitch = (
    <div className="seg-sm" role="group" aria-label="Preview size">
      <button aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}><Icon name="desktop" size={15} /><span>Desktop</span></button>
      <button aria-pressed={device === 'phone'} onClick={() => setDevice('phone')}><Icon name="phone" size={15} /><span>Phone</span></button>
    </div>
  );

  return (
    <div className="builder">
      <header className="player-bar">
        <button className="icon-btn" onClick={() => { if (!dirty.current || confirm('Leave without saving?')) go(appId ? `/apps/${appId}` : '/apps'); }} aria-label="Back"><Icon name="back" /></button>
        <div className="title"><h1>{appId ? `Edit ${cfg.name || 'app'}` : 'Create app'}</h1></div>
        <div className="spacer" />
        <span className="mono muted hide-sm" aria-live="polite">{cfg.blocks.length} {cfg.blocks.length === 1 ? 'feature' : 'features'} ticked</span>
        {createButton('hide-sm')}
      </header>
      <div className="builder-body">
        <div className="builder-side">
          <section className="step" aria-labelledby="s1">
            <p className="step-n mono">01</p>
            <h2 id="s1">Who is it for?</h2>
            <div className="who">
              <label className="field">
                <span>Client or brand</span>
                <input className="input" value={cfg.client} placeholder="For example: Himalayan Coffee" maxLength={80} onChange={(e) => setClient(e.target.value)} autoFocus={!appId} />
              </label>
              <div className="field">
                <span>Logo <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></span>
                <input ref={logoInput} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => { onLogo(e.target.files?.[0]); e.target.value = ''; }} />
                <div className="logo-pick">
                  <button type="button" className="logo-box" onClick={() => logoInput.current?.click()} aria-label={cfg.design.logo ? 'Change logo' : 'Add a logo'}>
                    {cfg.design.logo ? <img src={cfg.design.logo} alt="" /> : <Icon name="image" />}
                  </button>
                  {cfg.design.logo && <button type="button" className="link" onClick={() => setDesign({ logo: undefined })}>Remove</button>}
                </div>
              </div>
            </div>
            {cat && (
              <div className="field">
                <span>What kind of work?</span>
                <div className="fields-pick" role="radiogroup" aria-label="What kind of work">
                  {cat.templates.map((t) => (
                    <button key={t.key} role="radio" aria-checked={cfg.field === t.key} className="fp" onClick={() => pickField(t)}>
                      <b>{t.name}</b><span>{t.description}</span>
                    </button>
                  ))}
                  <button role="radio" aria-checked={cfg.field === 'other'} className="fp" onClick={() => pickField(null)}>
                    <b>Something else</b><span>Tick the features yourself below.</span>
                  </button>
                </div>
                {!appId && <small className="hint">Picking one ticks the usual features for that kind of work. Change them in step 02.</small>}
              </div>
            )}
            <div className="grid2">
              <label className="field">
                <span>Name of this HTML</span>
                <input id="c-name" className="input" value={cfg.name} placeholder="Himalayan Coffee · Social media" maxLength={80} onChange={(e) => { nameTouched.current = true; change((c) => ({ ...c, name: e.target.value })); }} />
              </label>
              <label className="field">
                <span>Working on <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></span>
                <input className="input" value={cfg.purpose} maxLength={400} placeholder="Spring campaign 2026" onChange={(e) => change((c) => ({ ...c, purpose: e.target.value }))} />
              </label>
            </div>
          </section>

          <section className="step" aria-labelledby="s2">
            <p className="step-n mono">02</p>
            <div className="step-h">
              <h2 id="s2">Tick what it should have</h2>
              <span className="mono muted">{cfg.blocks.length} of {cat?.blocks.length ?? 0}</span>
            </div>
            <p className="step-lede">Everything you tick works for both sides: you add, the client sees it live, comments and approves. Files, photos and big videos included.</p>
            <label className="search" style={{ display: 'block' }}>
              <Icon name="search" /><span className="sr-only">Search features</span>
              <input className="input" type="search" placeholder="Search: video, receipt, approval, bug…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            {cat && (
              <div className="cat-chips" role="group" aria-label="Show">
                <button aria-pressed={!filter} onClick={() => setFilter('')}>All <span className="mono">{cat.blocks.length}</span></button>
                <button aria-pressed={filter === '__on'} onClick={() => setFilter('__on')}>Ticked <span className="mono">{cfg.blocks.length}</span></button>
                {cat.categories.map((c) => (
                  <button key={c} aria-pressed={filter === c} onClick={() => setFilter(c)}>{c} <span className="mono">{cat.blocks.filter((b) => b.category === c && ticked.has(b.key)).length || ''}</span></button>
                ))}
              </div>
            )}
            {groups.map(({ c, list }) => {
              const all = cat!.blocks.filter((b) => b.category === c);
              const on = all.filter((b) => ticked.has(b.key)).length;
              return (
                <fieldset key={c} className="ticks">
                  <legend>
                    <span>{c}</span>
                    <span className="mono muted">{on}/{all.length}</span>
                    {filter !== '__on' && <button type="button" className="link" onClick={() => tickAll(c, on < all.length)}>{on < all.length ? 'Tick all' : 'Untick all'}</button>}
                  </legend>
                  <div className="fcards">
                    {list.map((f) => (
                      <label key={f.key} className={`fcard ${ticked.has(f.key) ? 'on' : ''}`}>
                        <input type="checkbox" checked={ticked.has(f.key)} onChange={() => toggle(f)} />
                        <span className="fcard-t">
                          <b>{f.name}</b>
                          <span className="d">{f.description}</span>
                          {(f.tags.length > 0 || f.own) && (
                            <span className="tags">
                              {f.tags.map((t) => <i key={t}>{t}</i>)}
                              {f.own && <i>Private to each person</i>}
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
            {cat && !groups.length && <p className="muted">{filter === '__on' ? 'Nothing ticked yet.' : 'No feature matches that search.'}</p>}
            {untickedOld.length > 0 && <p className="callout">Unticked features disappear from the HTML. What was saved in them stays on the server and comes back if you tick them again.</p>}
          </section>

          <section className="step" aria-labelledby="s3">
            <p className="step-n mono">03</p>
            <h2 id="s3">How should it look?</h2>
            <div className="field">
              <span>Colour</span>
              <div className="swatches" role="radiogroup" aria-label="Colour">
                {ACCENTS.map((a) => (
                  <button key={a.hex} role="radio" aria-checked={cfg.design.accent === a.hex} aria-label={a.name} title={a.name} style={{ background: a.hex }} onClick={() => setDesign({ accent: a.hex })} />
                ))}
              </div>
            </div>
            <div className="field">
              <span>Lettering</span>
              <div className="style-pick">
                {STYLES.map((s) => (
                  <button key={s.key} aria-pressed={cfg.design.style === s.key} className={`st-${s.key}`} onClick={() => setDesign({ style: s.key })}>
                    <b>Aa</b><span>{s.name}</span><small>{s.hint}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid3">
              <div className="field"><span>Dates</span>
                <Select label="Dates" value={cfg.design.calendar} onChange={(v) => setDesign({ calendar: v })}
                  options={[{ value: 'bs', label: 'Nepali (BS)', hint: ' with AD small' }, { value: 'ad', label: 'English (AD)' }]} />
              </div>
              <div className="field"><span>Currency</span>
                <Select label="Currency" value={cfg.design.currency} onChange={(v) => setDesign({ currency: v })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
              </div>
              <div className="field"><span>Light or dark</span>
                <Select label="Light or dark" value={cfg.design.theme} onChange={(v) => setDesign({ theme: v })}
                  options={[{ value: 'light', label: 'Always light' }, { value: 'auto', label: 'Follow the device' }]} />
              </div>
            </div>
            {cfg.blocks.length > 1 && (
              <div className="field">
                <span>Menu order and names</span>
                <small className="hint">{cfg.blocks.length <= 5 ? 'On phones all of them sit in the bottom bar.' : 'On phones the first four sit in the bottom bar; the rest are under More.'}</small>
                <ol className="picked">
                  {cfg.blocks.map((b, i) => (
                    <li key={b.id}>
                      <span className="mono muted n">{String(i + 1).padStart(2, '0')}</span>
                      <div className="grow">
                        <input className="input slim" aria-label={`Menu name for ${byKey.get(b.preset)?.name}`} value={b.title} maxLength={60} onChange={(e) => rename(b.id, e.target.value)} />
                      </div>
                      {i < (cfg.blocks.length <= 5 ? cfg.blocks.length : 4) && <span className="mono muted bar-tag" title="In the bottom bar on phones">bar</span>}
                      <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(b.id, -1)}><Icon name="up" size={16} /></button>
                      <button className="icon-btn" aria-label="Move down" disabled={i === cfg.blocks.length - 1} onClick={() => move(b.id, 1)}><Icon name="down" size={16} /></button>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>

          {!appId && (
            <section className="step" aria-labelledby="s4">
              <p className="step-n mono">04</p>
              <h2 id="s4">Where does it open?</h2>
              <p className="step-lede">Give it its own address under {addrBase(user.username)}. It opens at exactly that address. You can add or change it later in Share.</p>
              <AddressField value={slug} onChange={setSlug} check={check} />
              {!slug && cfg.name.trim() && <button type="button" className="link addr-suggest" onClick={() => setSlug(slugify(cfg.client || cfg.name))}>Use {addrBase(user.username)}/{slugify(cfg.client || cfg.name)}</button>}
              {slug && <OpenChoice value={open} onChange={setOpen} />}
            </section>
          )}

          <section className="step step-end">
            {error && <p className="error-text" role="alert">{error}</p>}
            {createButton()}
            <p className="hint">{ready ? 'The HTML goes live on this server straight away. Only people you give a sign-in can open it.' : 'Add a name and tick at least one feature.'}</p>
          </section>
        </div>

        <section className={`builder-preview dev-${device}`} aria-label="Live preview">
          <div className="pv-bar"><span className="dot live" /> Live preview <span className="muted hide-md">· try it, nothing here is saved</span><span className="spacer" />{scale < 1 && <span className="mono muted pv-scale" title="Shown smaller to fit">{Math.round(scale * 100)}%</span>}{deviceSwitch}</div>
          <div className="pv-stage" ref={stageRef}>{frame(true)}</div>
        </section>
      </div>

      {/* Phones: the preview opens as a sheet, and the main action stays under the thumb. */}
      <div className="builder-dock">
        <span className="mono">{cfg.blocks.length} ticked</span>
        <button className="btn" onClick={() => setSheet(true)} disabled={!cfg.blocks.length}><Icon name="eye" size={16} />Preview</button>
        {createButton()}
      </div>
      {sheet && (
        <div className="pv-sheet" role="dialog" aria-modal="true" aria-label="Preview">
          <div className="pv-bar"><span className="dot live" /> Preview <span className="spacer" /><button className="icon-btn" onClick={() => setSheet(false)} aria-label="Close preview"><Icon name="close" /></button></div>
          <div className="pv-stage">{frame(false)}</div>
        </div>
      )}
    </div>
  );
}
