import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, get, post } from '../api';
import { Link, useRoute, useSession } from '../context';
import { PageLoader } from '../Loader';
import { Icon, useToast } from '../ui';
import { AddressField, OpenChoice, addressPayload, openReady, slugify, useNameCheck, type OpenSettings } from '../pages/Address';
import { PRESETS, blankSite, fontById, type Site } from '../../../server/site/schema';
import { libraryAsset, renderDocument } from '../../../server/site/render';
import './site-editor.css';
import { useSiteFonts } from './fields';

/*
 * Create a website: what kind, which template (or a blank page in a theme), then its name and address.
 * The editor opens straight after; nothing goes live until the owner presses Publish.
 */

interface Template { id: string; name: string; category: string; description: string; site: Site }
const BLANK = '__blank';

function previewHtml(site: Site, pageIdx = 0) {
  const page = site.pages[pageIdx] ?? site.pages[0];
  return renderDocument({
    mode: 'preview', appId: 'preview', site, page, formAction: '#',
    pageHref: () => '#',
    asset: (src) => (src.startsWith('lib:') ? libraryAsset(src.slice(4)) : /^https:\/\//.test(src) ? { url: src } : null),
  }, { extraHead: '<style>html{scrollbar-width:none}body::-webkit-scrollbar{display:none}.rv::after{display:none!important}.rv>img{transform:none!important}a,button,input,textarea,select,label,summary,iframe{pointer-events:none!important}</style>' });
}

/** A site drawn small: the real page at desktop width in a normal-height window (so "one screen tall" sections
 * stay the right size), scaled to fit the box. scroll: the page scrolls natively inside it, like any web page (the big
 * preview); its links and forms do nothing. Otherwise hovering the template card scrolls smoothly down the page and back to the top on leave. */
function Miniature({ site, page = 0, width = 1280, label, scroll = false }: { site: Site; page?: number; width?: number; label: string; scroll?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [w, setW] = useState(300);
  const [h, setH] = useState(200);
  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => { setW(el.clientWidth); setH(el.clientHeight); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const html = useMemo(() => previewHtml(site, page), [site, page]);
  const k = w / width;
  const win = () => frame.current?.contentWindow ?? null;
  useEffect(() => {
    const el = box.current!;
    if (scroll) return; // the big preview scrolls natively (the iframe takes the wheel and touch itself)
    const card = el.closest('button') ?? el;
    let raf = 0;
    const enter = () => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      cancelAnimationFrame(raf);
      const step = () => { const v = win(); if (!v) return; const d = v.document.documentElement; if (v.scrollY + v.innerHeight >= d.scrollHeight - 2) return; v.scrollBy(0, 9); raf = requestAnimationFrame(step); };
      raf = requestAnimationFrame(step);
    };
    const leave = () => { cancelAnimationFrame(raf); win()?.scrollTo({ top: 0, behavior: 'smooth' }); };
    card.addEventListener('mouseenter', enter); card.addEventListener('mouseleave', leave); card.addEventListener('focus', enter); card.addEventListener('blur', leave);
    return () => { cancelAnimationFrame(raf); card.removeEventListener('mouseenter', enter); card.removeEventListener('mouseleave', leave); card.removeEventListener('focus', enter); card.removeEventListener('blur', leave); };
  }, [scroll, k]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`ss-mini ${scroll ? 'scroll' : ''}`} ref={box}>
      <iframe ref={frame} title={label} srcDoc={html} tabIndex={-1} aria-hidden={scroll ? undefined : true} style={{ width, height: h / k, transform: `scale(${k})`, pointerEvents: scroll ? 'auto' : 'none' }} />
    </div>
  );
}

export function SiteStart() {
  useSiteFonts();
  const { go } = useRoute();
  const toast = useToast();
  const { user } = useSession();
  const [data, setData] = useState<{ categories: string[]; templates: Template[] } | null>(null);
  const [err, setErr] = useState('');
  const [cat, setCat] = useState('');
  const [tpl, setTpl] = useState('');
  const [preset, setPreset] = useState('salt');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [open, setOpen] = useState<OpenSettings>({ access: 'public', password: '' });
  const [busy, setBusy] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);
  const check = useNameCheck(slug);

  useEffect(() => {
    get<{ categories: string[]; templates: Template[] }>('/api/site-templates').then((r) => { setData(r); setCat(r.categories[0] ?? BLANK); setTpl(r.templates[0]?.id ?? BLANK); }, (e) => setErr(e instanceof ApiError ? e.message : 'Could not load the templates.'));
  }, []);
  useEffect(() => { if (!slugTouched) setSlug(slugify(name)); }, [name, slugTouched]);
  useEffect(() => setPreviewPage(0), [tpl]);

  const chosen = data?.templates.find((t) => t.id === tpl);
  const previewSite = useMemo(() => (chosen ? chosen.site : blankSite(name || 'Your website', preset)), [chosen, preset, name]);
  if (err) return <div className="se-fail"><p>{err}</p><Link to="/home" className="btn">Back</Link></div>;
  if (!data) return <PageLoader />;
  const inCat = cat === BLANK ? [] : data.templates.filter((t) => t.category === cat);
  const ready = name.trim().length > 0 && openReady(slug, check, open) && !!tpl;

  const create = async () => {
    if (!name.trim()) { document.getElementById('ss-name')?.focus(); return; }
    setBusy(true);
    try {
      const r = await post<{ app: { id: string } }>('/api/sites', { name: name.trim(), template: tpl === BLANK ? undefined : tpl, preset: tpl === BLANK ? preset : undefined, address: slug ? addressPayload(slug, open) : undefined });
      toast('Your website is ready to edit. It goes live when you press Publish.');
      go(`/apps/${r.app.id}/site`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not create the website.', true);
      setBusy(false);
    }
  };

  return (
    <div className="ss">
      <header className="ss-top">
        <Link to="/home" className="icon-btn" aria-label="Back"><Icon name="back" /></Link>
        <h1>Create a website</h1>
      </header>
      <div className="ss-body">
        <div className="ss-steps">
          <section aria-labelledby="ss1">
            <h2 id="ss1"><span className="mono">01</span>What is it for?</h2>
            <div className="ss-cats" role="radiogroup" aria-label="Kind of website">
              {data.categories.map((c) => <button key={c} role="radio" aria-checked={cat === c} onClick={() => { setCat(c); const first = data.templates.find((t) => t.category === c); if (first) setTpl(first.id); }}>{c}</button>)}
              <button role="radio" aria-checked={cat === BLANK} onClick={() => { setCat(BLANK); setTpl(BLANK); }}>Something else: start blank</button>
            </div>
          </section>

          <section aria-labelledby="ss2">
            <h2 id="ss2"><span className="mono">02</span>{cat === BLANK ? 'Pick a look' : 'Pick a template'}</h2>
            {cat === BLANK ? (
              <ul className="ss-presets" role="list">
                {PRESETS.map((p) => (
                  <li key={p.id}><button aria-pressed={preset === p.id} onClick={() => setPreset(p.id)}>
                    <span className="ss-sw" style={{ background: p.theme.colors.bg, color: p.theme.colors.text, borderColor: p.theme.colors.line }}>
                      <b style={{ fontFamily: `"${fontById(p.theme.display).family}", serif`, textTransform: p.theme.caps ? 'uppercase' : undefined }}>{p.name}</b>
                      <i style={{ background: p.theme.colors.accent }} />
                    </span>
                    <small>{p.note}</small>
                  </button></li>
                ))}
              </ul>
            ) : (
              <ul className="ss-tpls" role="list">
                {inCat.map((t) => (
                  <li key={t.id}><button aria-pressed={tpl === t.id} onClick={() => setTpl(t.id)}>
                    <Miniature site={t.site} label={`${t.name} template`} />
                    <span className="ss-tpl-t"><b>{t.name}</b><small>{t.description}</small><small className="mono">{t.site.pages.length} pages · {t.site.pages.map((p) => p.title).join(', ')}</small></span>
                  </button></li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="ss3">
            <h2 id="ss3"><span className="mono">03</span>Name and address</h2>
            <label className="field"><span>Name of the business or website</span>
              <input id="ss-name" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={chosen ? `Like ${chosen.name}` : 'Like Himal Tea Garden'} />
            </label>
            {user.username && <AddressField value={slug} onChange={(v) => { setSlug(v); setSlugTouched(true); }} check={check} />}
            <OpenChoice value={open} onChange={setOpen} compact />
            <p className="hint">The template’s words and photos are examples: change them in the editor. Visitors see a short “coming soon” page until you press Publish.</p>
            <button className="btn primary ss-create" onClick={create} disabled={busy || !ready}>{busy && <span className="spin" />}Create and open the editor</button>
          </section>
        </div>

        <aside className="ss-preview" aria-label="Preview">
          <div className="ss-preview-head">
            <b>{chosen ? chosen.name : PRESETS.find((p) => p.id === preset)?.name}</b>
            {chosen && chosen.site.pages.length > 1 && (
              <div className="seg-sm" role="group" aria-label="Page">
                {chosen.site.pages.map((p, i) => <button key={p.id} aria-pressed={previewPage === i} onClick={() => setPreviewPage(i)}>{p.title}</button>)}
              </div>
            )}
          </div>
          <div className="ss-preview-frame"><Miniature site={previewSite} page={previewPage} width={1280} label="Preview of the website" scroll /></div>
        </aside>
      </div>
    </div>
  );
}
