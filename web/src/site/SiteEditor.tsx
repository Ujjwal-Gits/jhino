import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, get, post } from '../api';
import { Link, useRoute } from '../context';
import { PageLoader } from '../Loader';
import { Icon, Modal, Select, ago, copyText, useToast } from '../ui';
import {
  BLOCKS, COLOR_KEYS, COLOR_LABELS, FONTS, NETWORKS, PRESETS, blockDef, cleanPlain, makeBlock, newBlockId, newPageId, safeHref, sanitizeInline, sanitizeRich, slugOk, toSlug,
  type Block, type BlockStyle, type ImageRef, type LinkRef, type Page, type Site, type Theme,
} from '../../../server/site/schema';
import { allCss, anchorsFor, bodyClass, libraryAsset, renderBlock, renderBody, renderDocument, type RenderCtx } from '../../../server/site/render';
import { BlockPicker, BlockThumb, FieldEditor, ImageDialog, ImageThumb, LinkDialog, LinkFields, type FieldCtx } from './fields';
import { Submissions } from './Submissions';
import './site-editor.css';
import { useSiteFonts } from './fields';

/*
 * The website editor (/apps/<id>/site). The canvas is the real renderer (server/site/render.ts) in an
 * iframe: click text to type, click a photo or a button to change it, hover a block for its toolbar.
 * Changes patch only the blocks that changed, are saved as a draft a moment later, and go live with Publish.
 */

interface Meta { draftAt: string | null; liveVersion: number; publishedAt: string | null; livePublished: boolean; url: string | null; access: string; uploads: boolean; unread: number }
type Device = 'desktop' | 'tablet' | 'phone';
type Tab = 'block' | 'page' | 'site' | 'design';
type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
const WIDTH: Record<Device, number> = { desktop: 1240, tablet: 820, phone: 390 };

/* ---------------- immutable helpers ---------------- */
function setIn(obj: any, path: (string | number)[], value: any): any {
  if (!path.length) return value;
  const [k, ...rest] = path;
  const copy = Array.isArray(obj) ? obj.slice() : { ...(obj ?? {}) };
  copy[k as any] = setIn(obj?.[k as any], rest, value);
  return copy;
}
const pathOf = (p: string) => p.split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : x));
function mapBlock(site: Site, id: string, fn: (b: Block) => Block): Site {
  if (site.header?.id === id) return { ...site, header: fn(site.header) };
  if (site.footer?.id === id) return { ...site, footer: fn(site.footer) };
  return { ...site, pages: site.pages.map((p) => (p.blocks.some((b) => b.id === id) ? { ...p, blocks: p.blocks.map((b) => (b.id === id ? fn(b) : b)) } : p)) };
}
function blockOf(site: Site, id: string | null): Block | null {
  if (!id) return null;
  if (site.header?.id === id) return site.header;
  if (site.footer?.id === id) return site.footer;
  for (const p of site.pages) { const b = p.blocks.find((x) => x.id === id); if (b) return b; }
  return null;
}
function reId(v: any): any {
  if (Array.isArray(v)) return v.map(reId);
  return v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, reId(x)])) : v;
}

function ctxFor(site: Site, page: Page, appId: string, mode: 'edit' | 'preview'): RenderCtx {
  return {
    mode, appId, site, page, formAction: '/_jhino/site-form',
    pageHref: (p) => `#page:${p.id}`,
    asset: (src) => (src.startsWith('file:') ? { url: `/api/apps/${appId}/files/${src.slice(5)}` } : src.startsWith('lib:') ? libraryAsset(src.slice(4)) : /^https:\/\//.test(src) ? { url: src } : null),
  };
}

/** What the canvas adds inside the page: hover and editing outlines, placeholders. */
const EDIT_CSS = `html{scroll-behavior:auto}[data-f]{cursor:text;border-radius:2px;transition:outline-color .15s}[data-f]:hover{outline:1px dashed color-mix(in srgb,currentColor 45%,transparent);outline-offset:3px}
[data-f][contenteditable=true]{outline:2px solid #e0461f!important;outline-offset:4px;cursor:text}[data-f]:empty::before{content:attr(data-ph);opacity:.42;pointer-events:none}
[data-img]{cursor:pointer}[data-img]:hover{outline:2px solid #e0461f;outline-offset:-2px}[data-link]{cursor:pointer}[data-link]:hover{outline:2px dashed #e0461f;outline-offset:3px}
.site-h.sticky{position:relative}.empty-blk{padding:24px;border:1px dashed currentColor;opacity:.6;text-align:center;font-size:14px}a[href^="#page:"]{cursor:pointer}`;

/* ---------------- the canvas ---------------- */
/** The device frame: the page is drawn at the device's real width and scaled to fit the stage. */
function useStage(device: Device) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 700 });
  useLayoutEffect(() => {
    const el = stage.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const devW = device === 'desktop' ? Math.max(WIDTH.desktop, Math.min(1440, size.w)) : WIDTH[device];
  const scale = Math.min(1, (size.w - (device === 'desktop' ? 0 : 32)) / devW);
  const devH = Math.max(400, (size.h - (device === 'desktop' ? 0 : 24)) / scale);
  return { stage, size, devW, scale, devH, left: Math.max(0, (size.w - devW * scale) / 2) };
}

/** Preview mode: the page exactly as a visitor gets it (menus, carousels, the photo reveals), no editing chrome. */
function PreviewFrame({ site, page, appId, device, onPage }: { site: Site; page: Page; appId: string; device: Device; onPage: (id: string) => void }) {
  const { stage, devW, devH, scale, left } = useStage(device);
  const html = useMemo(() => renderDocument(ctxFor(site, page, appId, 'preview')), [site, page, appId]);
  const onLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const d = e.currentTarget.contentDocument;
    if (!d) return;
    d.addEventListener('click', (ev) => {
      const a = (ev.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      if (href.startsWith('#page:')) { ev.preventDefault(); onPage(href.slice(6)); return; }
      // Other sites open in a tab of their own, never inside the editor.
      if (/^https?:/i.test(href)) { ev.preventDefault(); window.open(href, '_blank', 'noopener'); }
    });
  };
  return (
    <div className={`se-stage dev-${device}`} ref={stage}>
      <div className="se-device" style={{ width: devW, height: devH, transform: `scale(${scale})`, left }}>
        <iframe key={page.id} title="Preview of the page" srcDoc={html} onLoad={onLoad} />
      </div>
    </div>
  );
}

interface CanvasApi { scrollTo: (id: string) => void }
interface CanvasProps {
  site: Site; page: Page; appId: string; device: Device; selected: string | null;
  onSelect: (id: string | null) => void;
  onText: (blockId: string, path: string, html: string) => void;
  onImage: (blockId: string, path: string) => void;
  onLink: (blockId: string, path: string) => void;
  onPage: (pageId: string) => void;
  onKey: (e: KeyboardEvent) => void;
  toolbar: (id: string) => ReactNode;
  onAddAt: (index: number) => void;
  apiRef: React.MutableRefObject<CanvasApi | null>;
}
function Canvas(p: CanvasProps) {
  const { stage, devW, devH, scale, left } = useStage(p.device);
  const frame = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const [tick, setTick] = useState(0);
  const raf = useRef(0);
  const [hover, setHover] = useState<string | null>(null);
  const hoverTimer = useRef<number>(0);
  const editing = useRef<{ el: HTMLElement; blockId: string; path: string; kind: string; timer: number } | null>(null);
  const [editRect, setEditRect] = useState<DOMRect | null>(null);
  const last = useRef<{ parts: [string, string][]; css: string } | null>(null);
  const force = useRef<string | null>(null);
  const props = useRef(p); props.current = p;


  // The page itself: written once per page; later changes are patched in.
  const srcDoc = useMemo(() => renderDocument(ctxFor(p.site, p.page, p.appId, 'edit'), { allCss: true, extraHead: `<style>${EDIT_CSS}</style>` }), [p.page.id, p.appId]); // eslint-disable-line react-hooks/exhaustive-deps

  const parts = (s: Site, pg: Page): [string, string][] => {
    const c = ctxFor(s, pg, p.appId, 'edit');
    const anchors = anchorsFor(pg);
    return [...(s.header ? [[s.header.id, renderBlock(c, s.header)] as [string, string]] : []), ...pg.blocks.map((b) => [b.id, renderBlock(c, b, anchors[b.id])] as [string, string]), ...(s.footer ? [[s.footer.id, renderBlock(c, s.footer)] as [string, string]] : [])];
  };

  const finishEdit = useCallback(() => {
    const e = editing.current;
    if (!e) return;
    clearTimeout(e.timer);
    editing.current = null;
    e.el.contentEditable = 'false';
    const html = e.kind === 'rich' ? sanitizeRich(e.el.innerHTML) : sanitizeInline(e.el.innerHTML, 2000);
    force.current = e.blockId; // drawn again from the saved (sanitised) value
    props.current.onText(e.blockId, e.path, html);
    setEditRect(null);
  }, []);

  const startEdit = useCallback((d: Document, el: HTMLElement, blockId: string, x: number, y: number) => {
    if (editing.current?.el === el) return;
    finishEdit();
    el.contentEditable = 'true';
    el.spellcheck = true;
    el.focus();
    const r = (d as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(x, y);
    if (r) { const s = d.getSelection(); s?.removeAllRanges(); s?.addRange(r); }
    const kind = el.dataset.kind ?? 'text';
    const e = { el, blockId, path: el.dataset.f!, kind, timer: 0 };
    editing.current = e;
    setEditRect(el.getBoundingClientRect());
    const push = () => {
      clearTimeout(e.timer);
      e.timer = window.setTimeout(() => { if (editing.current === e) props.current.onText(blockId, e.path, kind === 'rich' ? sanitizeRich(el.innerHTML) : sanitizeInline(el.innerHTML, 2000)); setEditRect(el.getBoundingClientRect()); }, 180);
    };
    el.oninput = push;
    el.onblur = () => { if (editing.current === e) finishEdit(); };
    el.onpaste = (ev) => { ev.preventDefault(); d.execCommand('insertText', false, ev.clipboardData?.getData('text/plain') ?? ''); };
    el.onkeydown = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); el.blur(); return; }
      if (ev.key === 'Enter' && kind !== 'rich') {
        ev.preventDefault();
        if (kind === 'para' && ev.shiftKey) d.execCommand('insertLineBreak'); else el.blur();
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); document.dispatchEvent(new CustomEvent('se-link')); }
    };
  }, [finishEdit]);

  // Wire up the page once it loads.
  const onLoad = () => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    editing.current = null;
    last.current = { parts: parts(props.current.site, props.current.page), css: allCss(props.current.site) };
    d.addEventListener('click', (ev) => {
      const t = ev.target as Element;
      if (!t?.closest) return;
      const b = t.closest('[data-b]') as HTMLElement | null;
      if (t.closest('a,button,summary,label,input,textarea,form')) ev.preventDefault();
      const nav = t.closest('a[href^="#page:"]') as HTMLAnchorElement | null;
      const f = t.closest('[data-f]') as HTMLElement | null;
      const im = t.closest('[data-img]') as HTMLElement | null;
      const ln = t.closest('[data-link]') as HTMLElement | null;
      if (b) props.current.onSelect(b.dataset.b!);
      if (f && b) startEdit(d, f, b.dataset.b!, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
      else if (im && b) props.current.onImage(b.dataset.b!, im.dataset.img!);
      else if (ln && b) props.current.onLink(b.dataset.b!, ln.dataset.link!);
      else if (nav) props.current.onPage(nav.getAttribute('href')!.slice(6));
    }, true);
    d.addEventListener('submit', (ev) => ev.preventDefault(), true);
    d.addEventListener('mousemove', (ev) => {
      const b = (ev.target as Element)?.closest?.('[data-b]') as HTMLElement | null;
      clearTimeout(hoverTimer.current);
      setHover(b ? b.dataset.b! : null);
    });
    d.addEventListener('mouseleave', () => { hoverTimer.current = window.setTimeout(() => setHover(null), 500); });
    d.addEventListener('scroll', () => {
      if (raf.current) return;
      raf.current = requestAnimationFrame(() => { raf.current = 0; setTick((t) => t + 1); if (editing.current) setEditRect(editing.current.el.getBoundingClientRect()); });
    }, { passive: true });
    d.addEventListener('keydown', (ev) => {
      if (!editing.current) { props.current.onKey(ev); return; }
      // Undo while typing: finish the text first, then undo like anywhere else.
      if ((ev.ctrlKey || ev.metaKey) && ['z', 'y'].includes(ev.key.toLowerCase())) { ev.preventDefault(); editing.current.el.blur(); props.current.onKey(new KeyboardEvent('keydown', { key: ev.key, ctrlKey: true, shiftKey: ev.shiftKey })); }
      else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') props.current.onKey(ev);
    });
    setDoc(d);
    setTick((t) => t + 1);
  };
  useEffect(() => { setDoc(null); }, [srcDoc]);

  // Patch what changed.
  useEffect(() => {
    if (!doc) return;
    const next = parts(p.site, p.page);
    const css = allCss(p.site);
    const prev = last.current;
    if (!prev || prev.css !== css) { const st = doc.getElementById('site-css'); if (st) st.textContent = css; }
    doc.body.className = bodyClass(p.site);
    const sameOrder = prev && prev.parts.length === next.length && prev.parts.every(([id], i) => id === next[i][0]);
    if (sameOrder) {
      next.forEach(([id, html], i) => {
        if ((prev!.parts[i][1] === html && force.current !== id) || editing.current?.blockId === id) return;
        const el = doc.querySelector(`[data-b="${id}"]`);
        if (!el) return;
        const tpl = doc.createElement('template');
        tpl.innerHTML = html;
        el.replaceWith(tpl.content);
      });
    } else {
      if (editing.current) { editing.current.el.onblur = null; editing.current = null; setEditRect(null); }
      const y = doc.defaultView?.scrollY ?? 0;
      doc.body.innerHTML = renderBody(ctxFor(p.site, p.page, p.appId, 'edit'));
      doc.defaultView?.scrollTo(0, y);
    }
    last.current = { parts: next, css };
    force.current = null;
    setTick((t) => t + 1);
  }, [p.site, p.page, doc]); // eslint-disable-line react-hooks/exhaustive-deps

  p.apiRef.current = {
    scrollTo: (id) => {
      const el = doc?.querySelector(`[data-b="${id}"]`);
      el?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    },
  };

  // Where things are on the page, for the outlines and toolbars drawn over it.
  const rectOf = (id: string | null) => {
    if (!doc || !id) return null;
    const el = doc.querySelector(`[data-b="${id}"]`);
    return el ? el.getBoundingClientRect() : null;
  };
  void tick;
  const sel = rectOf(p.selected);
  const hov = hover && hover !== p.selected ? rectOf(hover) : null;
  const pageIdx = (id: string | null) => (id ? p.page.blocks.findIndex((b) => b.id === id) : -1);
  const plus = (id: string | null, r: DOMRect | null) => {
    if (!r || !id) return null;
    const i = pageIdx(id);
    const isHeader = p.site.header?.id === id, isFooter = p.site.footer?.id === id;
    const above = isHeader ? null : isFooter ? p.page.blocks.length : i;
    const below = isFooter ? null : isHeader ? 0 : i + 1;
    return <>
      {above !== null && <button className="se-plus" style={{ top: Math.max(0, r.top) - 13, left: r.left + r.width / 2 - 13 }} onClick={() => p.onAddAt(above)} aria-label="Add a block above" title="Add a block here"><Icon name="plus" size={14} /></button>}
      {below !== null && <button className="se-plus" style={{ top: r.bottom - 13, left: r.left + r.width / 2 - 13 }} onClick={() => p.onAddAt(below)} aria-label="Add a block below" title="Add a block here"><Icon name="plus" size={14} /></button>}
    </>;
  };

  const fmt = (cmd: string) => (e: React.MouseEvent) => { e.preventDefault(); doc?.execCommand(cmd); editing.current?.el.dispatchEvent(new Event('input')); };
  const [linkOpen, setLinkOpen] = useState<{ range: Range | null; url: string } | null>(null);
  const askLink = useCallback(() => {
    const s = doc?.getSelection();
    setLinkOpen({ range: s && s.rangeCount ? s.getRangeAt(0).cloneRange() : null, url: 'https://' });
  }, [doc]);
  useEffect(() => { const h = () => askLink(); document.addEventListener('se-link', h); return () => document.removeEventListener('se-link', h); }, [askLink]);
  const applyLink = () => {
    const e = editing.current;
    if (!e || !doc || !linkOpen) { setLinkOpen(null); return; }
    const url = safeHref(linkOpen.url);
    e.el.focus();
    const s = doc.getSelection();
    if (linkOpen.range && s) { s.removeAllRanges(); s.addRange(linkOpen.range); }
    if (url) doc.execCommand('createLink', false, url); else doc.execCommand('unlink');
    e.el.dispatchEvent(new Event('input'));
    setLinkOpen(null);
  };

  return (
    <div className={`se-stage dev-${p.device}`} ref={stage}>
      <div className="se-device" style={{ width: devW, height: devH, transform: `scale(${scale})`, left }}>
        <iframe ref={frame} title="Page preview" srcDoc={srcDoc} onLoad={onLoad} />
        <div className="se-overlay" style={{ ['--inv' as string]: String(1 / scale) }} onMouseEnter={() => clearTimeout(hoverTimer.current)} onMouseLeave={() => { hoverTimer.current = window.setTimeout(() => setHover(null), 400); }}>
          {hov && <div className="se-hov" style={{ top: hov.top, left: hov.left, width: hov.width, height: hov.height }} />}
          {sel && <div className="se-sel" style={{ top: sel.top, left: sel.left, width: sel.width, height: sel.height }} />}
          {hov && plus(hover, hov)}
          {sel && plus(p.selected, sel)}
          {sel && p.selected && !editRect && <div className="se-tools" style={{ top: Math.min(Math.max(sel.top + 8, 8), devH - 60), left: Math.max(8, sel.right - 8) }}>{p.toolbar(p.selected)}</div>}
          {editRect && (
            <div className="se-fmt" style={{ top: Math.max(4, editRect.top - 46), left: Math.max(4, editRect.left) }} onMouseDown={(e) => e.preventDefault()}>
              {linkOpen ? (
                <form onSubmit={(e) => { e.preventDefault(); applyLink(); }} className="se-fmt-link">
                  <input autoFocus className="input" value={linkOpen.url} onChange={(e) => setLinkOpen({ ...linkOpen, url: e.target.value })} aria-label="Link address" onMouseDown={(e) => e.stopPropagation()} />
                  <button className="btn sm primary" type="submit">Link</button>
                  <button className="btn sm" type="button" onClick={() => setLinkOpen(null)}>Cancel</button>
                </form>
              ) : <>
                <button onMouseDown={fmt('bold')} aria-label="Bold (Ctrl+B)" title="Bold (Ctrl+B)"><b>B</b></button>
                <button onMouseDown={fmt('italic')} aria-label="Italic (Ctrl+I)" title="Italic (Ctrl+I)"><i>I</i></button>
                <button onMouseDown={(e) => { e.preventDefault(); askLink(); }} aria-label="Link (Ctrl+K)" title="Link (Ctrl+K)"><Icon name="link" size={15} /></button>
                <span className="se-fmt-hint">Esc when done</span>
              </>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- panels ---------------- */
function Section({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return <details className="se-sec" open={open}><summary>{title}</summary><div className="se-sec-body">{children}</div></details>;
}
const BG_OPTS = [{ value: 'page', label: 'Page colour' }, { value: 'surface', label: 'Panel colour' }, { value: 'accent', label: 'Accent colour' }, { value: 'ink', label: 'Dark (text colour)' }];
const SPACE_OPTS = [{ value: 's', label: 'Tight' }, { value: 'm', label: 'Normal' }, { value: 'l', label: 'Roomy' }];
const HIDE_OPTS = [{ value: '', label: 'Phones and computers' }, { value: 'desktop', label: 'Phones only' }, { value: 'mobile', label: 'Computers only' }];

function BlockPanel({ b, fctx, onProps, onStyle, onVariant, onDelete }: { b: Block; fctx: FieldCtx; onProps: (path: string, v: any) => void; onStyle: (s: Partial<BlockStyle>) => void; onVariant: (v: string) => void; onDelete: () => void }) {
  const def = blockDef(b.type)!;
  return (
    <div className="se-panel-body">
      <div className="se-bhead"><BlockThumb type={b.type} /><div><h3>{def.name}</h3><p className="hint">{def.description}</p></div></div>
      <div className="field"><span className="se-flabel">Layout</span>
        <div className="se-variants" role="radiogroup" aria-label="Layout">
          {def.variants.map((v) => <button key={v.id} role="radio" aria-checked={b.variant === v.id} onClick={() => onVariant(v.id)}>{v.name}</button>)}
        </div>
      </div>
      <Section title="Content">
        {def.fields.map((f) => <FieldEditor key={`${b.id}-${f.key}`} f={f} value={b.props[f.key]} ctx={fctx} path={`${b.id}.${f.key}`} onChange={(v) => onProps(f.key, v)} />)}
        {def.form && <p className="hint">Messages sent with this form arrive in <b>Submissions</b> (top bar). Spam is filtered with a hidden field and limits per visitor.</p>}
      </Section>
      {!def.global && (
        <Section title="Section">
          <div className="field"><span className="se-flabel">Background</span><Select label="Background" value={b.style.bg} options={BG_OPTS} onChange={(v) => onStyle({ bg: v as BlockStyle['bg'] })} /></div>
          <div className="field"><span className="se-flabel">Space above and below</span><Select label="Spacing" value={b.style.space} options={SPACE_OPTS} onChange={(v) => onStyle({ space: v as BlockStyle['space'] })} /></div>
          <div className="field"><span className="se-flabel">Show on</span><Select label="Show on" value={b.style.hide} options={HIDE_OPTS} onChange={(v) => onStyle({ hide: v as BlockStyle['hide'] })} /></div>
        </Section>
      )}
      <button className="btn danger-quiet se-del" onClick={onDelete}><Icon name="trash" size={15} />Remove this block</button>
    </div>
  );
}

function PagePanel({ site, page, onPage }: { site: Site; page: Page; onPage: (p: Partial<Page>) => void }) {
  const isHome = site.pages[0]?.id === page.id;
  const [slug, setSlug] = useState(page.slug);
  useEffect(() => setSlug(page.slug), [page.id, page.slug]);
  const clash = slug !== page.slug && site.pages.some((p) => p.id !== page.id && p.slug === slug);
  const title = page.seoTitle || (isHome ? site.name : `${page.title} · ${site.name}`);
  return (
    <div className="se-panel-body">
      <label className="field"><span>Page name (in the menu)</span><input className="input" value={page.title} maxLength={60} onChange={(e) => onPage({ title: e.target.value })} onBlur={(e) => onPage({ title: cleanPlain(e.target.value, 60) || 'Page' })} /></label>
      {!isHome && (
        <label className="field"><span>Address</span>
          <div className="se-slug"><span className="mono">…/</span><input className="input mono" value={slug} maxLength={42} aria-invalid={clash || (!!slug && !slugOk(slug))}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            onBlur={() => { const s = toSlug(slug); if (s && slugOk(s) && !site.pages.some((p) => p.id !== page.id && p.slug === s)) onPage({ slug: s }); else setSlug(page.slug); }} /><span className="mono">/</span></div>
          <small className="hint">{clash ? 'Another page has this address.' : 'Links to this page update by themselves.'}</small>
        </label>
      )}
      <label className="se-check"><input type="checkbox" checked={page.nav} onChange={(e) => onPage({ nav: e.target.checked })} /> Show in the menu</label>
      <Section title="On Google and in link previews">
        <label className="field"><span>Title <small className="mono">{(page.seoTitle || title).length}/60</small></span><input className="input" value={page.seoTitle} maxLength={70} placeholder={title} onChange={(e) => onPage({ seoTitle: e.target.value })} /></label>
        <label className="field"><span>Description <small className="mono">{page.seoDescription.length}/160</small></span><textarea className="textarea" rows={3} maxLength={170} value={page.seoDescription} placeholder="What someone searching should know about this page, in one or two sentences." onChange={(e) => onPage({ seoDescription: e.target.value })} /></label>
        <div className="se-serp" aria-label="How it may look on Google"><small>{site.name}</small><b>{title}</b><p>{page.seoDescription || 'Google picks a sentence from the page when this is empty.'}</p></div>
        <p className="hint">Search engines list the site once you turn on <b>Show on Google</b> in Share.</p>
      </Section>
    </div>
  );
}

function SitePanel({ site, set, fctx }: { site: Site; set: (fn: (s: Site) => Site, key?: string) => void; fctx: FieldCtx }) {
  const st = site.settings;
  const setS = (k: keyof Site['settings'], v: any, key?: string) => set((s) => ({ ...s, settings: { ...s.settings, [k]: v } }), key ?? `settings.${k}`);
  const img = (k: 'logo' | 'favicon' | 'socialImage', label: string, hint: string) => (
    <div className="field"><span className="se-flabel">{label}</span>
      <ImageThumb appId={fctx.appId} label={label} value={st[k] ?? { src: '', alt: '' }} onPick={() => fctx.pickImage(st[k] ?? { src: '', alt: '' }, (v) => setS(k, v.src ? v : null))} onClear={() => setS(k, null)} />
      <small className="hint">{hint}</small></div>
  );
  return (
    <div className="se-panel-body">
      <label className="field"><span>Site name</span><input className="input" value={site.name} maxLength={80} onChange={(e) => set((s) => ({ ...s, name: e.target.value }), 'name')} onBlur={(e) => set((s) => ({ ...s, name: cleanPlain(e.target.value, 80) || 'My website' }))} /></label>
      <label className="field"><span>One line about you</span><input className="input" value={st.tagline} maxLength={160} onChange={(e) => setS('tagline', e.target.value)} placeholder="Used on Google when a page has no description" /></label>
      <div className="field"><span className="se-flabel">Language of the site</span><Select label="Language" value={st.lang} options={[{ value: 'en', label: 'English' }, { value: 'ne', label: 'नेपाली (Nepali)' }]} onChange={(v) => setS('lang', v)} /></div>
      <Section title="Logo and icons">
        {img('logo', 'Logo', 'Shown in the header instead of the name. A wide PNG with a clear background works best.')}
        {img('favicon', 'Browser tab icon', 'A square image, at least 64 by 64.')}
        {img('socialImage', 'Link preview image', 'Shown when the site is shared on Facebook, WhatsApp or Viber. 1200 by 630 is ideal.')}
      </Section>
      <Section title="Contact details">
        <p className="hint">Used by the footer, the contact form and the map when theirs are left empty.</p>
        <label className="field"><span>Phone</span><input className="input" value={st.phone} maxLength={40} onChange={(e) => setS('phone', e.target.value)} /></label>
        <label className="field"><span>Email</span><input className="input" type="email" value={st.email} maxLength={120} onChange={(e) => setS('email', e.target.value)} /></label>
        <label className="field"><span>Address</span><textarea className="textarea" rows={2} value={st.address} maxLength={240} onChange={(e) => setS('address', e.target.value)} /></label>
      </Section>
      <Section title="Social links">
        <ol className="se-social">
          {st.social.map((x, i) => (
            <li key={i}>
              <Select label="Network" size="sm" width={130} value={x.network} options={NETWORKS.map(([value, label]) => ({ value, label }))} onChange={(v) => setS('social', st.social.map((y, j) => (j === i ? { ...y, network: v } : y)))} />
              <input className="input" value={x.url} placeholder="https://" aria-label={`${x.network} link`} onChange={(e) => setS('social', st.social.map((y, j) => (j === i ? { ...y, url: e.target.value } : y)))} onBlur={(e) => setS('social', st.social.map((y, j) => (j === i ? { ...y, url: safeHref(e.target.value) } : y)))} />
              <button className="icon-btn sm" aria-label="Remove" onClick={() => setS('social', st.social.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>
            </li>
          ))}
        </ol>
        <button className="btn sm" disabled={st.social.length >= 12} onClick={() => setS('social', [...st.social, { network: 'instagram', url: '' }])}><Icon name="plus" size={14} />Add a link</button>
      </Section>
    </div>
  );
}

function DesignPanel({ theme, set }: { theme: Theme; set: (t: Theme, key?: string) => void }) {
  const fonts = FONTS.map((f) => ({ value: f.id, label: f.name, hint: f.kind }));
  const pick = (id: string) => { const p = PRESETS.find((x) => x.id === id)!; set({ ...p.theme }); };
  return (
    <div className="se-panel-body">
      <Section title="Theme">
        <ul className="se-presets" role="list">
          {PRESETS.map((p) => (
            <li key={p.id}><button aria-pressed={theme.preset === p.id} onClick={() => pick(p.id)} title={p.note}>
              <span className="se-sw" style={{ background: p.theme.colors.bg, color: p.theme.colors.text, borderColor: p.theme.colors.line }}>
                <span style={{ fontFamily: `"${FONTS.find((f) => f.id === p.theme.display)!.family}"` }}>Aa</span>
                <i style={{ background: p.theme.colors.accent }} /><i style={{ background: p.theme.colors.surface }} />
              </span>
              <b>{p.name}</b>
            </button></li>
          ))}
        </ul>
        <p className="hint">{PRESETS.find((p) => p.id === theme.preset)?.note} Changing the theme keeps your words and photos.</p>
      </Section>
      <Section title="Fonts">
        <div className="field"><span className="se-flabel">Headings</span><Select label="Heading font" value={theme.display} options={fonts} onChange={(v) => set({ ...theme, display: v })} /></div>
        <div className="field"><span className="se-flabel">Text</span><Select label="Text font" value={theme.body} options={fonts} onChange={(v) => set({ ...theme, body: v })} /></div>
        <label className="se-check"><input type="checkbox" checked={theme.caps} onChange={(e) => set({ ...theme, caps: e.target.checked })} /> Headings in capitals</label>
      </Section>
      <Section title="Colours">
        <ul className="se-colors" role="list">
          {COLOR_KEYS.map((k) => (
            <li key={k}><label>
              <input type="color" value={theme.colors[k]} onChange={(e) => set({ ...theme, colors: { ...theme.colors, [k]: e.target.value } }, `color.${k}`)} />
              <span>{COLOR_LABELS[k]}<small className="mono">{theme.colors[k]}</small></span>
            </label></li>
          ))}
        </ul>
      </Section>
      <Section title="Shape and space">
        <label className="field"><span>Corners <small className="mono">{theme.radius}px</small></span><input type="range" min={0} max={28} value={theme.radius} onChange={(e) => set({ ...theme, radius: Number(e.target.value) }, 'radius')} /></label>
        <label className="field"><span>Spacing inside blocks <small className="mono">{Math.round(theme.space * 100)}%</small></span><input type="range" min={80} max={130} step={5} value={Math.round(theme.space * 100)} onChange={(e) => set({ ...theme, space: Number(e.target.value) / 100 }, 'space')} /></label>
        <div className="field"><span className="se-flabel">Buttons</span><div className="se-variants" role="radiogroup" aria-label="Buttons">
          {(['solid', 'outline', 'pill', 'underline'] as const).map((b) => <button key={b} role="radio" aria-checked={theme.button === b} onClick={() => set({ ...theme, button: b })}>{b[0].toUpperCase() + b.slice(1)}</button>)}
        </div></div>
        <div className="field"><span className="se-flabel">Space between sections</span><div className="se-variants" role="radiogroup" aria-label="Section rhythm">
          {([['tight', 'Tight'], ['even', 'Even'], ['airy', 'Airy']] as const).map(([k, l]) => <button key={k} role="radio" aria-checked={theme.rhythm === k} onClick={() => set({ ...theme, rhythm: k })}>{l}</button>)}
        </div></div>
      </Section>
    </div>
  );
}

/* ---------------- the editor ---------------- */
export function SiteEditor({ id }: { id: string }) {
  useSiteFonts();
  const { go } = useRoute();
  const toast = useToast();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [hist, setHist] = useState<{ past: Site[]; present: Site; future: Site[] } | null>(null);
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  const [pageId, setPageId] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('block');
  const [device, setDevice] = useState<Device>(() => (innerWidth < 700 ? 'phone' : 'desktop'));
  const [previewing, setPreviewing] = useState(false);
  const [view, setView] = useState<'edit' | 'submissions'>(() => (new URLSearchParams(location.search).get('tab') === 'submissions' ? 'submissions' : 'edit'));
  const [sheet, setSheet] = useState<'none' | 'left' | 'right'>('none');
  const [save, setSave] = useState<SaveState>('saved');
  const [publishing, setPublishing] = useState(false);
  const [changedSincePublish, setChanged] = useState(false);
  const [picker, setPicker] = useState<{ index: number } | null>(null);
  const [imageDlg, setImageDlg] = useState<{ value: ImageRef; done: (v: ImageRef) => void } | null>(null);
  const [linkDlg, setLinkDlg] = useState<{ value: LinkRef; done: (v: LinkRef) => void } | null>(null);
  const [confirmPage, setConfirmPage] = useState<Page | null>(null);
  const [newPage, setNewPage] = useState<string | null>(null);
  const canvas = useRef<CanvasApi | null>(null);
  const site = hist?.present ?? null;
  const siteRef = useRef<Site | null>(null); siteRef.current = site;
  const savedRef = useRef<Site | null>(null);
  const draftAt = useRef<string | null>(null);
  const saving = useRef<Promise<void> | null>(null);

  useEffect(() => {
    get<{ site: Site } & Meta>(`/api/sites/${id}`).then((r) => {
      setHist({ past: [], present: r.site, future: [] });
      savedRef.current = r.site; draftAt.current = r.draftAt;
      setPageId(r.site.pages[0].id);
      setChanged(!r.livePublished);
      setMeta(r);
    }, (e) => setLoadErr(e instanceof ApiError ? e.message : 'Could not open this website.'));
  }, [id]);

  const commit = useCallback((fn: (s: Site) => Site, key?: string) => {
    setHist((h) => {
      if (!h) return h;
      const next = fn(h.present);
      if (next === h.present) return h;
      const t = Date.now();
      const same = !!key && lastKey.current?.key === key && t - lastKey.current.at < 1500;
      lastKey.current = key ? { key, at: t } : null;
      return { past: same ? h.past : [...h.past.slice(-100), h.present], present: next, future: [] };
    });
    setChanged(true);
  }, []);
  const undo = useCallback(() => { lastKey.current = null; setHist((h) => (h && h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h)); setChanged(true); }, []);
  const redo = useCallback(() => { lastKey.current = null; setHist((h) => (h && h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h)); setChanged(true); }, []);

  /* ---- saving the draft ---- */
  const doSave = useCallback(async (): Promise<void> => {
    if (saving.current) { await saving.current; }
    const s = siteRef.current;
    if (!s || s === savedRef.current) { setSave((x) => (x === 'dirty' ? 'saved' : x)); return; }
    setSave('saving');
    const run = (async () => {
      try {
        const r = await api<{ draftAt: string }>('PUT', `/api/sites/${id}/draft`, { site: s, base: draftAt.current });
        draftAt.current = r.draftAt; savedRef.current = s;
        setSave(siteRef.current === s ? 'saved' : 'dirty');
      } catch (e) {
        setSave(e instanceof ApiError && e.code === 'DRAFT_CHANGED' ? 'conflict' : 'error');
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
  }, [id]);
  useEffect(() => {
    if (!site || site === savedRef.current || save === 'conflict') return;
    setSave((x) => (x === 'saving' ? x : 'dirty'));
    const t = setTimeout(() => { void doSave(); }, 900);
    return () => clearTimeout(t);
  }, [site, doSave]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (siteRef.current && siteRef.current !== savedRef.current) { e.preventDefault(); } };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, []);

  const page = site ? site.pages.find((p) => p.id === pageId) ?? site.pages[0] : null;
  const block = site ? blockOf(site, selected) : null;

  /* ---- block actions ---- */
  const setPageBlocks = (fn: (blocks: Block[]) => Block[]) => commit((s) => ({ ...s, pages: s.pages.map((p) => (p.id === page!.id ? { ...p, blocks: fn(p.blocks) } : p)) }));
  const move = (bid: string, by: number) => setPageBlocks((bs) => { const i = bs.findIndex((b) => b.id === bid), j = i + by; if (i < 0 || j < 0 || j >= bs.length) return bs; const n = bs.slice(); [n[i], n[j]] = [n[j], n[i]]; return n; });
  const duplicate = (bid: string) => {
    const nid = newBlockId();
    setPageBlocks((bs) => { const i = bs.findIndex((b) => b.id === bid); if (i < 0) return bs; const n = bs.slice(); n.splice(i + 1, 0, { ...reId(JSON.parse(JSON.stringify(bs[i]))), id: nid }); return n; });
    setSelected(nid);
  };
  const remove = (bid: string) => {
    const name = blockDef(blockOf(site!, bid)?.type ?? '')?.name ?? 'Block';
    commit((s) => (s.header?.id === bid ? { ...s, header: null } : s.footer?.id === bid ? { ...s, footer: null } : { ...s, pages: s.pages.map((p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== bid) })) }));
    setSelected(null);
    toast(`${name} removed. Ctrl+Z brings it back.`);
  };
  const cycleVariant = (bid: string) => {
    const b = blockOf(site!, bid); if (!b) return;
    const vs = blockDef(b.type)!.variants; const i = vs.findIndex((v) => v.id === b.variant);
    commit((s) => mapBlock(s, bid, (x) => ({ ...x, variant: vs[(i + 1) % vs.length].id })));
  };
  const insert = (type: string, index: number) => {
    const b = makeBlock(type);
    const def = blockDef(type)!;
    if (def.global === 'header') commit((s) => ({ ...s, header: b }));
    else if (def.global === 'footer') commit((s) => ({ ...s, footer: b }));
    else setPageBlocks((bs) => { const n = bs.slice(); n.splice(Math.max(0, Math.min(index, n.length)), 0, b); return n; });
    setPicker(null); setSelected(b.id); setTab('block');
    setTimeout(() => canvas.current?.scrollTo(b.id), 120);
  };
  const onText = useCallback((bid: string, path: string, html: string) => commit((s) => mapBlock(s, bid, (b) => ({ ...b, props: setIn(b.props, pathOf(path), html) })), `text:${bid}:${path}`), [commit]);
  const getIn = (obj: any, path: string) => pathOf(path).reduce((o, k) => o?.[k as any], obj);
  const onImage = (bid: string, path: string) => {
    const b = blockOf(siteRef.current!, bid); if (!b) return;
    setImageDlg({ value: getIn(b.props, path) ?? { src: '', alt: '' }, done: (v) => commit((s) => mapBlock(s, bid, (x) => ({ ...x, props: setIn(x.props, pathOf(path), v) }))) });
  };
  const onLink = (bid: string, path: string) => {
    const b = blockOf(siteRef.current!, bid); if (!b) return;
    const cur = getIn(b.props, path);
    if (typeof cur === 'string') { // a plain URL field (downloads)
      setLinkDlg({ value: { label: 'Link', href: cur }, done: (v) => commit((s) => mapBlock(s, bid, (x) => ({ ...x, props: setIn(x.props, pathOf(path), v.href) }))) });
      return;
    }
    setLinkDlg({ value: cur ?? { label: '', href: '' }, done: (v) => commit((s) => mapBlock(s, bid, (x) => ({ ...x, props: setIn(x.props, pathOf(path), v) }))) });
  };
  const fctx: FieldCtx | null = site ? { site, appId: id, pickImage: (value, done) => setImageDlg({ value, done }) } : null;

  /* ---- pages ---- */
  const addPage = (title: string) => {
    const t = cleanPlain(title, 60) || 'New page';
    let slug = toSlug(t) || 'page'; let n = 2; const base = slug;
    while (!slugOk(slug) || site!.pages.some((p) => p.slug === slug)) slug = `${base}-${n++}`;
    const hero = makeBlock('hero'); hero.variant = 'text'; hero.props = { ...hero.props, title: t, text: '', primary: { label: '', href: '' } }; hero.style.space = 's';
    const p: Page = { id: newPageId(), slug, title: t, nav: true, seoTitle: '', seoDescription: '', blocks: [hero] };
    commit((s) => ({ ...s, pages: [...s.pages, p] }));
    setPageId(p.id); setSelected(null); setNewPage(null);
  };
  const movePage = (pid: string, by: number) => commit((s) => { const i = s.pages.findIndex((p) => p.id === pid), j = i + by; if (i < 1 || j < 1 || j >= s.pages.length) return s; const n = s.pages.slice(); [n[i], n[j]] = [n[j], n[i]]; return { ...s, pages: n }; });
  const deletePage = (pid: string) => { commit((s) => ({ ...s, pages: s.pages.filter((p) => p.id !== pid) })); if (pageId === pid) setPageId(site!.pages[0].id); setConfirmPage(null); };

  /* ---- publishing ---- */
  const publishNow = async () => {
    setPublishing(true);
    try {
      await doSave();
      if (siteRef.current !== savedRef.current) await doSave();
      const r = await post<{ version: number; url: string | null; publishedAt: string }>(`/api/sites/${id}/publish`);
      setMeta((m) => (m ? { ...m, url: r.url, publishedAt: r.publishedAt, liveVersion: r.version } : m));
      setChanged(false);
      toast('Published. The live site now matches this draft.');
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not publish.', true); }
    setPublishing(false);
  };

  /* ---- keyboard ---- */
  const onKey = useCallback((e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 's') { e.preventDefault(); void doSave(); return; }
    if (typing) return;
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape' && previewing) { setPreviewing(false); return; }
    if (!selected || previewing) return;
    if (e.key === 'Escape') { setSelected(null); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(selected); return; }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(selected, e.key === 'ArrowUp' ? -1 : 1); }
  }, [selected, undo, redo, doSave, previewing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const h = (e: KeyboardEvent) => onKey(e); addEventListener('keydown', h); return () => removeEventListener('keydown', h); }, [onKey]);

  if (loadErr) return <div className="se-fail"><p>{loadErr}</p><Link to="/apps" className="btn">Back to my apps</Link></div>;
  if (!site || !page || !meta || !fctx) return <PageLoader />;

  const toolbar = (bid: string) => {
    const b = blockOf(site, bid); if (!b) return null;
    const def = blockDef(b.type)!;
    const i = page.blocks.findIndex((x) => x.id === bid);
    const variant = def.variants.find((v) => v.id === b.variant)?.name ?? '';
    return <>
      <span className="se-tools-name">{def.name}</span>
      {!def.global && <button onClick={() => move(bid, -1)} disabled={i <= 0} aria-label="Move up" title="Move up (Alt+↑)"><Icon name="up" size={15} /></button>}
      {!def.global && <button onClick={() => move(bid, 1)} disabled={i >= page.blocks.length - 1} aria-label="Move down" title="Move down (Alt+↓)"><Icon name="down" size={15} /></button>}
      {!def.global && <button onClick={() => duplicate(bid)} aria-label="Duplicate" title="Duplicate"><Icon name="copy" size={15} /></button>}
      {def.variants.length > 1 && <button onClick={() => cycleVariant(bid)} aria-label={`Layout: ${variant}. Switch to the next layout`} title={`Layout: ${variant}`}><Icon name="grid" size={15} /></button>}
      <button onClick={() => { setTab('block'); setSheet('right'); }} aria-label="Settings" title="Settings"><Icon name="settings" size={15} /></button>
      <button onClick={() => remove(bid)} aria-label="Remove" title="Remove (Delete)"><Icon name="trash" size={15} /></button>
    </>;
  };

  const saveLabel = { saved: 'Saved', dirty: 'Unsaved changes', saving: 'Saving…', error: 'Not saved. Retrying when you edit.', conflict: 'Changed in another tab' }[save];
  const layers = [
    ...(site.header ? [{ b: site.header, g: true }] : []),
    ...page.blocks.map((b) => ({ b, g: false })),
    ...(site.footer ? [{ b: site.footer, g: true }] : []),
  ];

  const left = (
    <aside className="se-left" aria-label="Pages and blocks">
      <div className="se-left-sec">
        <div className="se-left-head"><h2>Pages</h2><button className="icon-btn sm" onClick={() => setNewPage('')} aria-label="Add a page" title="Add a page"><Icon name="plus" size={15} /></button></div>
        <ol className="se-pages">
          {site.pages.map((p, i) => (
            <li key={p.id} className={p.id === page.id ? 'on' : ''}>
              <button className="se-page-name" aria-current={p.id === page.id ? 'page' : undefined} onClick={() => { setPageId(p.id); setSelected(null); setSheet('none'); }}>
                <span>{p.title}</span><small className="mono">/{p.slug}</small>
              </button>
              {i > 0 && <span className="se-page-acts">
                <button className="icon-btn sm" aria-label={`Move ${p.title} up`} disabled={i <= 1} onClick={() => movePage(p.id, -1)}><Icon name="up" size={13} /></button>
                <button className="icon-btn sm" aria-label={`Move ${p.title} down`} disabled={i >= site.pages.length - 1} onClick={() => movePage(p.id, 1)}><Icon name="down" size={13} /></button>
                <button className="icon-btn sm" aria-label={`Delete ${p.title}`} onClick={() => setConfirmPage(p)}><Icon name="trash" size={13} /></button>
              </span>}
            </li>
          ))}
        </ol>
        {newPage !== null && (
          <form className="se-newpage" onSubmit={(e) => { e.preventDefault(); addPage(newPage); }}>
            <input className="input" autoFocus value={newPage} maxLength={60} placeholder="Page name, like About" aria-label="New page name" onChange={(e) => setNewPage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNewPage(null); }} />
            <button className="btn sm primary" disabled={!newPage.trim()}>Add</button>
          </form>
        )}
      </div>
      <div className="se-left-sec grow">
        <div className="se-left-head"><h2>Blocks on this page</h2></div>
        <Layers items={layers} selected={selected} onSelect={(bid) => { setSelected(bid); setTab('block'); canvas.current?.scrollTo(bid); setSheet('none'); }}
          onReorder={(from, to) => setPageBlocks((bs) => { const n = bs.slice(); const [x] = n.splice(from, 1); n.splice(to, 0, x); return n; })} />
        <button className="btn sm se-addblock" onClick={() => { setPicker({ index: page.blocks.length }); setSheet('none'); }}><Icon name="plus" size={15} />Add a block</button>
      </div>
    </aside>
  );

  const right = (
    <aside className="se-right" aria-label="Settings">
      <div className="se-tabs" role="tablist">
        {([['block', 'Block'], ['page', 'Page'], ['site', 'Site'], ['design', 'Design']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
        <button className="icon-btn sm se-sheet-close" onClick={() => setSheet('none')} aria-label="Close settings"><Icon name="close" size={16} /></button>
      </div>
      <div className="se-right-scroll">
        {tab === 'block' && (block
          ? <BlockPanel key={block.id} b={block} fctx={fctx}
            onProps={(k, v) => commit((s) => mapBlock(s, block.id, (b) => ({ ...b, props: { ...b.props, [k]: v } })), `prop:${block.id}:${k}`)}
            onStyle={(st) => commit((s) => mapBlock(s, block.id, (b) => ({ ...b, style: { ...b.style, ...st } })))}
            onVariant={(v) => commit((s) => mapBlock(s, block.id, (b) => ({ ...b, variant: v })))}
            onDelete={() => remove(block.id)} />
          : <div className="se-panel-body se-empty"><p>Click any block on the page to change its layout, content and colours.</p><p className="hint">Click text to type over it. Click a photo or a button to change it.</p><button className="btn" onClick={() => setPicker({ index: page.blocks.length })}><Icon name="plus" size={15} />Add a block</button></div>)}
        {tab === 'page' && <PagePanel site={site} page={page} onPage={(ch) => commit((s) => ({ ...s, pages: s.pages.map((p) => (p.id === page.id ? { ...p, ...ch } : p)) }), `page:${page.id}:${Object.keys(ch).join()}`)} />}
        {tab === 'site' && <SitePanel site={site} set={commit} fctx={fctx} />}
        {tab === 'design' && <DesignPanel theme={site.theme} set={(t, key) => commit((s) => ({ ...s, theme: t }), key)} />}
      </div>
    </aside>
  );

  const liveHref = meta.url;
  return (
    <div className={`se ${sheet !== 'none' ? `sheet-${sheet}` : ''} ${previewing ? 'se-previewing' : ''}`}>
      <header className="se-top">
        <Link to="/apps" className="icon-btn" aria-label="Back to my apps"><Icon name="back" /></Link>
        <div className="se-title"><b>{site.name}</b><small className={`se-save s-${save}`} aria-live="polite">{saveLabel}</small></div>
        <div className="se-top-mid">
          <div className="se-pagesel"><Select label="Page" size="sm" width={170} value={page.id} options={site.pages.map((p) => ({ value: p.id, label: p.title }))} onChange={(v) => { setPageId(v); setSelected(null); }} /></div>
          <div className="seg-sm se-mode" role="group" aria-label="Editing or previewing">
            <button aria-pressed={!previewing} onClick={() => setPreviewing(false)} title="Click things on the page to change them"><Icon name="pen" size={14} />Edit</button>
            <button aria-pressed={previewing} onClick={() => { setPreviewing(true); setView('edit'); setSelected(null); setSheet('none'); }} title="See the page as a visitor does. Esc goes back to editing."><Icon name="eye" size={14} />Preview</button>
          </div>
          <div className="seg-sm se-devices" role="group" aria-label="Screen size">
            {([['desktop', 'Computer'], ['tablet', 'Tablet'], ['phone', 'Phone']] as const).map(([k, l]) => (
              <button key={k} aria-pressed={device === k} onClick={() => setDevice(k)} title={`${l} width`} aria-label={`${l} width`}><DeviceIcon d={k} /></button>
            ))}
          </div>
          {!previewing && <div className="seg-sm se-hist" role="group" aria-label="History">
            <button onClick={undo} disabled={!hist!.past.length} aria-label="Undo" title="Undo (Ctrl+Z)"><UndoIcon /></button>
            <button onClick={redo} disabled={!hist!.future.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" className="se-redo"><UndoIcon /></button>
          </div>}
        </div>
        <div className="se-top-end">
          <button className={`btn sm quiet ${view === 'submissions' ? 'on' : ''}`} aria-pressed={view === 'submissions'} onClick={() => setView(view === 'submissions' ? 'edit' : 'submissions')}>
            <Icon name="mail" size={15} /><span className="se-hide-s">Submissions</span>{meta.unread > 0 && <span className="se-badge">{meta.unread}</span>}
          </button>
          <a className="btn sm quiet se-hide-m" href={`/api/sites/${id}/preview/${page.slug ? page.slug + '/' : ''}`} target="_blank" rel="noopener" onClick={() => { void doSave(); }} title="The draft at full size, in a new tab"><Icon name="external" size={15} />Preview in new tab</a>
          {liveHref
            ? <a className="btn sm se-hide-s" href={liveHref + (page.slug && liveHref.endsWith('/') ? page.slug + '/' : '')} target="_blank" rel="noopener" title={changedSincePublish ? 'The published site. Your latest changes are not on it until you publish.' : 'The published site'}><Icon name="globe" size={15} />Open live site</a>
            : <span className="btn sm se-hide-s" aria-disabled="true" title="Publish first to get an address">Open live site</span>}
          <button className="btn sm primary" onClick={publishNow} disabled={publishing || save === 'conflict'}>{publishing && <span className="spin" />}{changedSincePublish ? 'Publish' : 'Published'}</button>
        </div>
      </header>
      {save === 'conflict' && <div className="se-banner" role="alert">This website was changed in another tab or on another device. <button className="btn sm" onClick={() => location.reload()}>Load the latest draft</button></div>}
      {liveHref && (
        <div className="se-live">
          <span className={`dot ${meta.access === 'public' ? 'ok' : ''}`} aria-hidden="true" />
          <span>{meta.access === 'public' ? 'Live at' : meta.access === 'password' ? 'Live, with a password, at' : 'Private. Only people you add can open'}</span>
          <a href={liveHref} target="_blank" rel="noopener" className="mono">{liveHref.replace(/^https?:\/\//, '')}</a>
          <button className="se-textbtn" onClick={async () => { if (await copyText(liveHref)) toast('Address copied.'); }}>Copy</button>
          {meta.publishedAt && <span className="muted">Published {ago(meta.publishedAt)}{changedSincePublish ? ' · the draft has changes' : ''}</span>}
          <Link to={`/apps/${id}`} className="se-textbtn">Share, domains and versions</Link>
        </div>
      )}
      <div className="se-body">
        {left}
        <main className="se-main">
          {previewing && <div className="se-prev-note" role="status"><span><b>Preview.</b> The page as visitors see it: menus, links and photos work, forms do not send.</span><button className="btn sm" onClick={() => setPreviewing(false)}><Icon name="pen" size={14} />Back to editing</button></div>}
          {previewing
            ? <PreviewFrame site={site} page={page} appId={id} device={device} onPage={(pid) => { if (site.pages.some((p) => p.id === pid)) setPageId(pid); }} />
            : view === 'submissions'
            ? <Submissions appId={id} onClose={() => setView('edit')} />
            : <Canvas site={site} page={page} appId={id} device={device} selected={selected} apiRef={canvas}
              onSelect={(bid) => { setSelected(bid); setTab('block'); }} onText={onText} onImage={onImage} onLink={onLink}
              onPage={(pid) => { if (site.pages.some((p) => p.id === pid)) { setPageId(pid); setSelected(null); } }}
              onKey={onKey} toolbar={toolbar} onAddAt={(index) => setPicker({ index })} />}
        </main>
        {right}
      </div>
      <nav className="se-bottom" aria-label="Editor">
        {previewing ? <>
          <button onClick={() => setPreviewing(false)}><Icon name="pen" size={18} />Back to editing</button>
          <a href={`/api/sites/${id}/preview/${page.slug ? page.slug + '/' : ''}`} target="_blank" rel="noopener"><Icon name="external" size={18} />New tab</a>
          {liveHref && <a href={liveHref} target="_blank" rel="noopener"><Icon name="globe" size={18} />Live site</a>}
        </> : <>
          <button onClick={() => setSheet(sheet === 'left' ? 'none' : 'left')} aria-pressed={sheet === 'left'}><Icon name="list" size={18} />Pages</button>
          <button onClick={() => setPicker({ index: page.blocks.length })}><Icon name="plus" size={18} />Add block</button>
          <button onClick={() => { setTab(block ? 'block' : 'design'); setSheet(sheet === 'right' ? 'none' : 'right'); }} aria-pressed={sheet === 'right'}><Icon name="settings" size={18} />{block ? 'Block' : 'Design'}</button>
          <button onClick={() => { setPreviewing(true); setSelected(null); setSheet('none'); }}><Icon name="eye" size={18} />Preview</button>
        </>}
      </nav>
      {sheet !== 'none' && <button className="se-scrim" aria-label="Close" onClick={() => setSheet('none')} />}

      {picker && <BlockPicker onClose={() => setPicker(null)} onPick={(t) => insert(t, picker.index)} hasHeader={!!site.header} hasFooter={!!site.footer} />}
      {imageDlg && <ImageDialog appId={id} value={imageDlg.value} uploads={meta.uploads} onClose={() => setImageDlg(null)} onSave={(v) => { imageDlg.done(v); setImageDlg(null); }} />}
      {linkDlg && <LinkDialog value={linkDlg.value} site={site} onClose={() => setLinkDlg(null)} onSave={(v) => { linkDlg.done(v); setLinkDlg(null); }} />}
      {confirmPage && (
        <Modal title={`Delete “${confirmPage.title}”?`} onClose={() => setConfirmPage(null)} footer={<>
          <button className="btn" onClick={() => setConfirmPage(null)}>Keep it</button>
          <button className="btn danger" onClick={() => deletePage(confirmPage.id)}>Delete page</button>
        </>}>
          <div className="modal-body"><p>The page and its {confirmPage.blocks.length} blocks leave the draft. The live site keeps it until you publish. Ctrl+Z brings it back.</p></div>
        </Modal>
      )}
    </div>
  );
}

const UndoIcon = () => <svg className="svg" viewBox="0 0 24 24" aria-hidden="true" style={{ width: 15, height: 15 }}><path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>;

function DeviceIcon({ d }: { d: Device }) {
  const path = d === 'desktop' ? 'M3 5h18v11H3zM9 20h6M12 16v4' : d === 'tablet' ? 'M6 3h12v18H6zM11 17.5h2' : 'M8.5 3h7v18h-7zM11.5 17.5h1';
  return <svg className="svg" viewBox="0 0 24 24" aria-hidden="true" style={{ width: 15, height: 15 }}><path d={path} /></svg>;
}

/** The page's blocks as a list: click to jump there, drag (or use the buttons) to reorder. */
function Layers({ items, selected, onSelect, onReorder }: { items: { b: Block; g: boolean }[]; selected: string | null; onSelect: (id: string) => void; onReorder: (from: number, to: number) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const offset = items.length && items[0].g && items[0].b.type === 'header' ? 1 : 0;
  return (
    <ol className="se-layers">
      {items.map(({ b, g }, i) => {
        const idx = i - offset;
        return (
          <li key={b.id} className={`${selected === b.id ? 'on' : ''} ${over === idx && drag !== null && drag !== idx ? 'over' : ''} ${g ? 'global' : ''}`}
            draggable={!g} onDragStart={(e) => { setDrag(idx); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.id); }}
            onDragOver={(e) => { if (drag !== null && !g) { e.preventDefault(); setOver(idx); } }}
            onDrop={(e) => { e.preventDefault(); if (drag !== null && !g && drag !== idx) onReorder(drag, idx); setDrag(null); setOver(null); }}
            onDragEnd={() => { setDrag(null); setOver(null); }}>
            <button onClick={() => onSelect(b.id)} aria-current={selected === b.id ? 'true' : undefined}>
              {!g && <span className="se-grip" aria-hidden="true" />}
              <BlockThumb type={b.type} />
              <span className="se-layer-t"><b>{blockDef(b.type)?.name}</b><small>{g ? 'On every page' : blockDef(b.type)?.variants.find((v) => v.id === b.variant)?.name}</small></span>
            </button>
          </li>
        );
      })}
      {items.length === 0 && <li className="muted se-layers-empty">No blocks yet.</li>}
    </ol>
  );
}

export const BLOCK_COUNT = BLOCKS.length;
