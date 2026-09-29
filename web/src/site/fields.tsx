import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, uploadWithProgress } from '../api';
import { Icon, Modal, Select } from '../ui';
import {
  BLOCKS, CATEGORIES, LIBRARY, cleanImage, safeHref, sanitizeInline, sanitizeRich, textOf,
  type Field, type ImageRef, type LinkRef, type Site,
} from '../../../server/site/schema';
import { fontFaces, libraryAsset, libraryThumb } from '../../../server/site/render';
import { FONTS } from '../../../server/site/schema';

/*
 * The editor's controls: text that keeps bold/italic/links, lists of items, images, links, and the
 * block picker. Every value goes through the same sanitisers the server uses before it is stored.
 */

/** The site fonts in the dashboard too (theme swatches), loaded only when a swatch uses one. */
export function useSiteFonts() {
  useEffect(() => {
    if (document.getElementById('site-fonts')) return;
    const st = document.createElement('style');
    st.id = 'site-fonts';
    st.textContent = fontFaces(FONTS.map((f) => f.id));
    document.head.appendChild(st);
  }, []);
}

export const assetUrl = (appId: string, src: string) =>
  src.startsWith('file:') ? `/api/apps/${appId}/files/${src.slice(5)}` : src.startsWith('lib:') ? libraryAsset(src.slice(4))?.url ?? '' : /^https:\/\//.test(src) ? src : '';

/** A small editable box for text with bold, italic and links (same rules as editing on the page). */
export function InlineField({ value, onChange, rich, multiline, label, id }: { value: string; onChange: (v: string) => void; rich?: boolean; multiline?: boolean; label: string; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  useEffect(() => { if (ref.current && !focused.current && ref.current.innerHTML !== value) ref.current.innerHTML = value; }, [value]);
  const read = () => { const h = ref.current?.innerHTML ?? ''; onChange(rich ? sanitizeRich(h) : sanitizeInline(h, 2000)); };
  return (
    <div
      ref={ref} id={id} className={`se-rich ${multiline || rich ? 'multi' : ''}`} contentEditable suppressContentEditableWarning role="textbox"
      aria-label={label} aria-multiline={multiline || rich ? true : undefined} tabIndex={0}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; read(); }}
      onInput={read}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !rich) { e.preventDefault(); if (multiline) document.execCommand('insertLineBreak'); else (e.target as HTMLElement).blur(); }
      }}
      onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }}
    />
  );
}

/** Where a link goes: one of the site's pages, or a web, email or phone address. */
export function LinkTarget({ value, onChange, site, label = 'Goes to' }: { value: string; onChange: (v: string) => void; site: Site; label?: string }) {
  const isPage = value.startsWith('page:');
  const [custom, setCustom] = useState(!isPage && !!value);
  const opts = [
    { value: '', label: 'Nowhere yet' },
    ...site.pages.map((p) => ({ value: `page:${p.id}`, label: `Page: ${p.title}` })),
    { value: '__custom', label: 'A web address, email or phone' },
  ];
  const sel = custom ? '__custom' : isPage ? value : '';
  return (
    <div className="se-link-target">
      <Select label={label} value={sel} options={opts} onChange={(v) => { if (v === '__custom') { setCustom(true); onChange(isPage ? '' : value); } else { setCustom(false); onChange(v); } }} />
      {custom && (
        <input className="input" value={value} placeholder="https://…, mailto:…, tel:98…" aria-label="Web address"
          onChange={(e) => onChange(e.target.value)} onBlur={(e) => onChange(safeHref(e.target.value))} />
      )}
    </div>
  );
}

export function LinkFields({ value, onChange, site }: { value: LinkRef; onChange: (v: LinkRef) => void; site: Site }) {
  return (
    <div className="se-fieldset">
      <label className="field"><span>Label</span><input className="input" value={value.label} maxLength={60} onChange={(e) => onChange({ ...value, label: e.target.value })} placeholder="Leave empty to hide the button" /></label>
      <LinkTarget value={value.href} site={site} onChange={(href) => onChange({ ...value, href })} />
      {/^https?:/.test(value.href) && (
        <label className="se-check"><input type="checkbox" checked={!!value.newTab} onChange={(e) => onChange({ ...value, newTab: e.target.checked || undefined })} /> Open in a new tab</label>
      )}
    </div>
  );
}

export function ImageThumb({ appId, value, onPick, onClear, label }: { appId: string; value: ImageRef; onPick: () => void; onClear?: () => void; label: string }) {
  const url = value?.src ? assetUrl(appId, value.src) : '';
  return (
    <div className="se-img-field">
      <button type="button" className="se-img-btn" onClick={onPick} aria-label={`${label}: ${url ? 'change' : 'add'}`}>
        {url ? <img src={url} alt="" style={value.focal ? { objectPosition: `${value.focal[0]}% ${value.focal[1]}%` } : undefined} /> : <span><Icon name="image" size={18} />Add a photo</span>}
      </button>
      {url && <div className="se-img-meta"><small>{value.alt ? `Alt: ${value.alt}` : 'No description yet'}</small>{onClear && <button type="button" className="se-textbtn" onClick={onClear}>Remove</button>}</div>}
    </div>
  );
}

/* ---------------- one field of a block ---------------- */
export interface FieldCtx { site: Site; appId: string; pickImage: (current: ImageRef, done: (v: ImageRef) => void) => void }
export function FieldEditor({ f, value, onChange, ctx, path }: { f: Field; value: any; onChange: (v: any) => void; ctx: FieldCtx; path: string }) {
  const id = `fld-${path.replace(/\W/g, '-')}`;
  const head = (extra?: ReactNode) => <span className="se-flabel"><label htmlFor={id}>{f.label}</label>{extra}</span>;
  switch (f.type) {
    case 'text': case 'para': case 'rich':
      return <div className="field">{head()}<InlineField id={id} label={f.label} value={value ?? ''} onChange={onChange} rich={f.type === 'rich'} multiline={f.type === 'para'} />{f.hint && <small className="hint">{f.hint}</small>}</div>;
    case 'plain':
      return <div className="field">{head()}{f.max && f.max > 160
        ? <textarea id={id} className="textarea" rows={3} maxLength={f.max} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
        : <input id={id} className="input" maxLength={f.max} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />}{f.hint && <small className="hint">{f.hint}</small>}</div>;
    case 'url':
      return <div className="field">{head()}<input id={id} className="input" value={value ?? ''} placeholder="https://" onChange={(e) => onChange(e.target.value)} onBlur={(e) => onChange(safeHref(e.target.value))} />{f.hint && <small className="hint">{f.hint}</small>}</div>;
    case 'bool':
      return <label className="se-check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {f.label}</label>;
    case 'select':
      return <div className="field"><span className="se-flabel">{f.label}</span><Select label={f.label} value={String(value ?? '')} options={f.options!} onChange={onChange} /></div>;
    case 'image':
      return <div className="field"><span className="se-flabel">{f.label}</span><ImageThumb appId={ctx.appId} label={f.label} value={value ?? { src: '', alt: '' }} onPick={() => ctx.pickImage(value ?? { src: '', alt: '' }, onChange)} onClear={() => onChange({ src: '', alt: '' })} /></div>;
    case 'link':
      return <div className="field"><span className="se-flabel">{f.label}</span><LinkFields value={value ?? { label: '', href: '' }} onChange={onChange} site={ctx.site} /></div>;
    case 'list':
      return <ListEditor f={f} value={Array.isArray(value) ? value : []} onChange={onChange} ctx={ctx} path={path} />;
  }
}

const summary = (f: Field, it: any, i: number) => {
  for (const x of f.of!) {
    if (['text', 'para', 'plain'].includes(x.type) && textOf(it[x.key])) return textOf(it[x.key]).slice(0, 60);
    if (x.type === 'image' && it[x.key]?.alt) return it[x.key].alt.slice(0, 60);
    if (x.type === 'select') return `${x.options!.find((o) => o.value === it[x.key])?.label ?? ''}`;
  }
  return `${f.item ?? 'Item'} ${i + 1}`;
};
function blankItem(f: Field) {
  const o: Record<string, any> = {};
  for (const x of f.of!) o[x.key] = x.type === 'list' ? [] : x.type === 'image' ? { src: '', alt: '' } : x.type === 'link' ? { label: '', href: '' } : x.type === 'bool' ? false : x.type === 'select' ? x.options![0].value : '';
  return o;
}
export function ListEditor({ f, value, onChange, ctx, path }: { f: Field; value: any[]; onChange: (v: any[]) => void; ctx: FieldCtx; path: string }) {
  const [open, setOpen] = useState<number | null>(value.length === 1 ? 0 : null);
  const set = (i: number, it: any) => onChange(value.map((x, j) => (j === i ? it : x)));
  const move = (i: number, by: number) => { const j = i + by; if (j < 0 || j >= value.length) return; const n = value.slice(); [n[i], n[j]] = [n[j], n[i]]; onChange(n); setOpen(open === i ? j : open); };
  const full = value.length >= (f.maxItems ?? 40);
  return (
    <div className="se-list">
      <div className="se-list-head"><span className="se-flabel">{f.label}</span><small className="mono">{value.length}</small></div>
      <ol>
        {value.map((it, i) => (
          <li key={i} className={open === i ? 'open' : ''}>
            <div className="se-li-row">
              <button type="button" className="se-li-name" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                <Icon name={open === i ? 'down' : 'more'} size={14} /><span>{summary(f, it, i)}</span>
              </button>
              <span className="se-li-acts">
                <button type="button" className="icon-btn sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={14} /></button>
                <button type="button" className="icon-btn sm" aria-label="Move down" disabled={i === value.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={14} /></button>
                <button type="button" className="icon-btn sm" aria-label="Duplicate" disabled={full} onClick={() => { const n = value.slice(); n.splice(i + 1, 0, JSON.parse(JSON.stringify(it))); onChange(n); }}><Icon name="copy" size={14} /></button>
                <button type="button" className="icon-btn sm" aria-label="Remove" onClick={() => { onChange(value.filter((_, j) => j !== i)); setOpen(null); }}><Icon name="trash" size={14} /></button>
              </span>
            </div>
            {open === i && (
              <div className="se-li-body">
                {f.of!.map((x) => <FieldEditor key={x.key} f={x} value={it[x.key]} ctx={ctx} path={`${path}.${i}.${x.key}`} onChange={(v) => set(i, { ...it, [x.key]: v })} />)}
              </div>
            )}
          </li>
        ))}
      </ol>
      <button type="button" className="btn sm" disabled={full} onClick={() => { onChange([...value, blankItem(f)]); setOpen(value.length); }}><Icon name="plus" size={14} />Add {f.item ?? 'item'}</button>
    </div>
  );
}

/* ---------------- choosing an image ---------------- */
async function shrink(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const max = 2000;
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 900_000) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.84));
    return out && out.size < file.size ? out : file;
  } catch { return file; }
}

export function ImageDialog({ appId, value, uploads, onClose, onSave }: { appId: string; value: ImageRef; uploads: boolean; onClose: () => void; onSave: (v: ImageRef) => void }) {
  const [cur, setCur] = useState<ImageRef>({ ...value });
  const [tab, setTab] = useState<'upload' | 'library' | 'link'>(value.src.startsWith('lib:') ? 'library' : value.src.startsWith('https:') ? 'link' : uploads ? 'upload' : 'library');
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState('');
  const [link, setLink] = useState(value.src.startsWith('https:') ? value.src : '');
  const url = cur.src ? assetUrl(appId, cur.src) : '';
  const focal = cur.focal ?? [50, 50];
  const upload = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/') || /svg/.test(file.type)) { setErr('Choose a JPG, PNG or WebP photo.'); return; }
    setErr(''); setBusy(1);
    try {
      const blob = await shrink(file);
      const name = file.name.replace(/\.[^.]+$/, '') + (blob.type === 'image/webp' && blob !== file ? '.webp' : file.name.match(/\.[^.]+$/)?.[0] ?? '');
      const r = await uploadWithProgress<{ file: { id: string } }>(`/api/apps/${appId}/files`, blob, name, (l, t) => setBusy(Math.max(1, Math.round((l / t) * 100))));
      setCur((c) => ({ ...c, src: `file:${r.file.id}`, alt: c.alt || file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') }));
    } catch (e) {
      setErr(e instanceof ApiError ? (e.code === 'UPLOADS_OFF' ? 'Uploads are turned off on this Jhino. Pick a library photo or paste a link instead.' : e.message) : 'The upload failed.');
    } finally { setBusy(0); }
  };
  return (
    <Modal title={value.src ? 'Change photo' : 'Add a photo'} onClose={onClose} wide footer={<>
      {value.src && <button className="btn quiet" style={{ marginRight: 'auto' }} onClick={() => onSave({ src: '', alt: '' })}>Remove photo</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!!busy} onClick={() => onSave(cleanImage(cur))}>Use this photo</button>
    </>}>
      <div className="modal-body se-imgdlg">
        <div className="seg-sm" role="tablist" aria-label="Where the photo comes from">
          {uploads && <button role="tab" aria-selected={tab === 'upload'} aria-pressed={tab === 'upload'} onClick={() => setTab('upload')}>Upload</button>}
          <button role="tab" aria-selected={tab === 'library'} aria-pressed={tab === 'library'} onClick={() => setTab('library')}>Library</button>
          <button role="tab" aria-selected={tab === 'link'} aria-pressed={tab === 'link'} onClick={() => setTab('link')}>Paste a link</button>
        </div>
        {tab === 'upload' && (
          <label className="se-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files[0]); }}>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
            <Icon name="upload" size={20} />
            <b>{busy ? `Uploading… ${busy}%` : 'Choose a photo or drop it here'}</b>
            <small>JPG, PNG or WebP. Large photos are made smaller before they upload.</small>
          </label>
        )}
        {tab === 'library' && (
          <ul className="se-lib" role="list">
            {Object.entries(LIBRARY).map(([k, l]) => (
              <li key={k}><button type="button" aria-pressed={cur.src === `lib:${k}`} onClick={() => setCur({ src: `lib:${k}`, alt: cur.src === `lib:${k}` ? cur.alt : l.alt })}><img src={libraryThumb(k)} alt={l.alt} loading="lazy" /></button></li>
            ))}
          </ul>
        )}
        {tab === 'link' && (
          <div className="field"><span>Photo address</span>
            <input className="input" value={link} placeholder="https://…/photo.jpg" onChange={(e) => setLink(e.target.value)} onBlur={() => { const s = cleanImage({ src: link.trim() }).src; if (s) setCur((c) => ({ ...c, src: s })); else if (link) setErr('Use a link that starts with https://'); }} />
            <small className="hint">A direct link to a photo on another site. It must start with https://.</small>
          </div>
        )}
        {err && <p className="error-text" role="alert">{err}</p>}
        {url && (
          <div className="se-focal">
            <div className="se-focal-pic" role="button" tabIndex={0} aria-label="Click the part of the photo that must always stay in view"
              onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setCur((c) => ({ ...c, focal: [Math.round(((e.clientX - r.left) / r.width) * 100), Math.round(((e.clientY - r.top) / r.height) * 100)] })); }}
              onKeyDown={(e) => { const d: Record<string, [number, number]> = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, -5], ArrowDown: [0, 5] }; const m = d[e.key]; if (m) { e.preventDefault(); setCur((c) => { const f = c.focal ?? [50, 50]; return { ...c, focal: [Math.min(100, Math.max(0, f[0] + m[0])), Math.min(100, Math.max(0, f[1] + m[1]))] }; }); } }}>
              <img src={url} alt="" />
              <span className="se-focal-dot" style={{ left: `${focal[0]}%`, top: `${focal[1]}%` }} aria-hidden="true" />
            </div>
            <div className="se-focal-side">
              <p className="hint">Focal point: click the part that must stay in view when the photo is cropped. Arrow keys move it.</p>
              <label className="field"><span>Description for screen readers and Google</span>
                <textarea className="textarea" rows={3} maxLength={240} value={cur.alt} onChange={(e) => setCur({ ...cur, alt: e.target.value })} placeholder="What is in the photo, in a sentence" />
              </label>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- a link or button on the page ---------------- */
export function LinkDialog({ value, site, onClose, onSave }: { value: LinkRef; site: Site; onClose: () => void; onSave: (v: LinkRef) => void }) {
  const [cur, setCur] = useState<LinkRef>({ ...value });
  return (
    <Modal title="Button" onClose={onClose} footer={<>
      <button className="btn quiet" style={{ marginRight: 'auto' }} onClick={() => onSave({ label: '', href: '' })}>Remove button</button>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={() => onSave({ ...cur, href: safeHref(cur.href) })}>Save</button>
    </>}>
      <div className="modal-body"><LinkFields value={cur} onChange={setCur} site={site} /></div>
    </Modal>
  );
}

/* ---------------- the block picker ---------------- */
/** Small line drawings of each block's layout. */
const THUMB: Record<string, string> = {
  header: '<rect x="8" y="14" width="22" height="6" rx="1"/><path d="M58 17h10M74 17h10M90 17h10"/><rect x="104" y="12" width="12" height="10" rx="2" class="a"/>',
  hero: '<rect x="8" y="12" width="48" height="8" rx="1"/><rect x="8" y="24" width="38" height="8" rx="1"/><path d="M8 40h40M8 45h32"/><rect x="8" y="52" width="18" height="8" rx="2" class="a"/><rect x="66" y="10" width="46" height="54" rx="2" class="f"/>',
  footer: '<path d="M8 12h104"/><rect x="8" y="20" width="26" height="6" rx="1"/><path d="M8 32h30M52 22h18M52 30h14M52 38h16M84 22h24M84 30h20"/><path d="M8 56h104" class="t"/>',
  richtext: '<rect x="20" y="12" width="50" height="7" rx="1"/><path d="M20 28h80M20 34h76M20 40h80M20 46h60M20 56h70"/>',
  image: '<rect x="12" y="10" width="96" height="46" rx="2" class="f"/><path d="M12 62h40" class="t"/>',
  imagetext: '<rect x="8" y="12" width="50" height="48" rx="2" class="f"/><rect x="66" y="18" width="40" height="7" rx="1"/><path d="M66 32h46M66 38h42M66 44h44"/><path d="M66 54h20" class="a2"/>',
  gallery: '<rect x="8" y="10" width="32" height="26" rx="2" class="f"/><rect x="44" y="10" width="32" height="26" rx="2" class="f"/><rect x="80" y="10" width="32" height="26" rx="2" class="f"/><rect x="8" y="40" width="32" height="26" rx="2" class="f"/><rect x="44" y="40" width="32" height="26" rx="2" class="f"/><rect x="80" y="40" width="32" height="26" rx="2" class="f"/>',
  video: '<rect x="12" y="10" width="96" height="54" rx="3" class="f"/><path d="M54 29l14 8-14 8z" class="a"/>',
  features: '<path d="M8 16h104M8 34h104M8 52h104" class="t"/><path d="M8 24h6M24 24h40M96 24h16M8 42h6M24 42h36M96 42h16M8 60h6M24 60h44M96 60h16"/>',
  pricing: '<rect x="8" y="10" width="32" height="54" rx="2"/><rect x="44" y="10" width="32" height="54" rx="2" class="f"/><rect x="80" y="10" width="32" height="54" rx="2"/><path d="M14 22h14M50 22h14M86 22h14M14 32h20M50 32h20M86 32h20"/>',
  menu: '<path d="M8 14h46M66 14h46" class="t"/><path d="M8 24h24M42 24h12M8 34h28M42 34h12M8 44h20M42 44h12M66 24h26M100 24h12M66 34h22M100 34h12M66 44h28M100 44h12"/><path d="M33 24h8M37 34h4M29 44h12" class="d"/>',
  team: '<rect x="8" y="10" width="22" height="28" rx="2" class="f"/><rect x="36" y="10" width="22" height="28" rx="2" class="f"/><rect x="64" y="10" width="22" height="28" rx="2" class="f"/><rect x="92" y="10" width="22" height="28" rx="2" class="f"/><path d="M8 46h16M36 46h16M64 46h16M92 46h16M8 52h12M36 52h12M64 52h12M92 52h12"/>',
  testimonials: '<path d="M14 18c-4 4-4 10 2 10M26 18c-4 4-4 10 2 10" class="a2"/><path d="M14 36h92M14 43h84M14 50h60"/><path d="M14 60h24" class="t"/>',
  logos: '<rect x="8" y="28" width="20" height="10" rx="2"/><rect x="36" y="28" width="20" height="10" rx="2"/><rect x="64" y="28" width="20" height="10" rx="2"/><rect x="92" y="28" width="20" height="10" rx="2"/>',
  stats: '<path d="M8 22h30M46 22h30M84 22h28" class="t"/><path d="M8 34h16M46 34h22M84 34h14" class="w"/><path d="M8 46h24M46 46h20M84 46h26"/>',
  faq: '<path d="M8 16h104M8 32h104M8 48h104M8 64h104" class="t"/><path d="M8 24h60M104 22l3 3 3-3M8 40h52M104 38l3 3 3-3M8 56h70M104 54l3 3 3-3"/>',
  cta: '<rect x="4" y="12" width="112" height="48" rx="2" class="f"/><rect x="14" y="24" width="56" height="8" rx="1"/><rect x="84" y="30" width="24" height="10" rx="2" class="a"/>',
  contact: '<path d="M8 16h34M8 26h30M8 34h26M8 42h28"/><rect x="56" y="12" width="56" height="9" rx="2"/><rect x="56" y="25" width="56" height="9" rx="2"/><rect x="56" y="38" width="56" height="16" rx="2"/><rect x="56" y="58" width="22" height="8" rx="2" class="a"/>',
  booking: '<rect x="8" y="12" width="22" height="9" rx="4" class="a"/><rect x="34" y="12" width="22" height="9" rx="4"/><rect x="60" y="12" width="22" height="9" rx="4"/><rect x="8" y="27" width="50" height="9" rx="2"/><rect x="62" y="27" width="50" height="9" rx="2"/><rect x="8" y="40" width="104" height="9" rx="2"/><rect x="8" y="55" width="26" height="9" rx="2" class="a"/>',
  newsletter: '<rect x="8" y="22" width="40" height="8" rx="1"/><path d="M8 38h36"/><rect x="60" y="28" width="36" height="12" rx="2"/><rect x="98" y="28" width="16" height="12" rx="2" class="a"/>',
  hours: '<path d="M20 16h80M20 26h80M20 36h80M20 46h80M20 56h80" class="t"/><path d="M20 21h20M84 21h16M20 31h24M84 31h16M20 41h22M84 41h16M20 51h18M84 51h16"/>',
  map: '<rect x="8" y="10" width="104" height="54" rx="2" class="f"/><path d="M8 40l30-12 30 16 44-18" class="t"/><path d="M70 22c0-5 8-5 8 0 0 5-4 9-4 9s-4-4-4-9z" class="a"/>',
  timeline: '<path d="M20 10v56" class="t"/><circle cx="20" cy="18" r="3" class="a"/><circle cx="20" cy="38" r="3" class="a"/><circle cx="20" cy="58" r="3" class="a"/><path d="M32 18h40M32 24h60M32 38h36M32 44h56M32 58h44"/>',
  beforeafter: '<rect x="12" y="10" width="96" height="54" rx="2" class="f"/><path d="M60 10v54"/><circle cx="60" cy="37" r="5"/>',
  downloads: '<path d="M8 20h104M8 38h104M8 56h104" class="t"/><path d="M8 29h40M8 47h52M102 25v7l-3-3M102 32l3-3M102 43v7l-3-3M102 50l3-3"/>',
  social: '<path d="M8 36h22M40 36h22M72 36h16M98 36h14" class="w"/>',
  spacer: '<path d="M8 36h104" class="t"/><path d="M60 16v10M56 22l4 4 4-4M60 56V46M56 50l4-4 4 4"/>',
  rows: '<rect x="8" y="8" width="56" height="26" rx="2" class="f"/><path d="M72 16h36M72 23h30"/><rect x="56" y="40" width="56" height="26" rx="2" class="f"/><path d="M8 48h36M8 55h30"/>',
  sticky: '<rect x="8" y="10" width="46" height="54" rx="2" class="f"/><path d="M64 14h40M64 20h34" /><path d="M64 32h44M64 38h36" class="t"/><path d="M64 50h44M64 56h30" class="t"/>',
  quote: '<path d="M14 16c-4 4-4 10 2 10M26 16c-4 4-4 10 2 10" class="a2"/><rect x="14" y="32" width="90" height="8" rx="1"/><rect x="14" y="44" width="70" height="8" rx="1"/><path d="M14 60h10M28 60h26" class="t"/>',
  marquee: '<path d="M4 36h20M34 36h26M70 36h22M102 36h14" class="w"/><circle cx="29" cy="36" r="2" class="a"/><circle cx="65" cy="36" r="2" class="a"/><circle cx="97" cy="36" r="2" class="a"/>',
  steps: '<path d="M8 22h8M44 22h8M80 22h8" class="w a2"/><path d="M8 34h28M44 34h28M80 34h28M8 42h24M44 42h22M80 42h26" /><path d="M8 14h28M44 14h28M80 14h28" class="t"/>',
  work: '<rect x="8" y="8" width="50" height="34" rx="2" class="f"/><rect x="64" y="18" width="50" height="34" rx="2" class="f"/><path d="M8 48h30M8 54h20M64 58h30M64 64h20"/>',
  press: '<path d="M8 16h104M8 34h104M8 52h104" class="t"/><path d="M8 25h30M56 25h36M8 43h24M56 43h40" /><circle cx="106" cy="25" r="4"/><circle cx="106" cy="43" r="4"/>',
};
export function BlockThumb({ type }: { type: string }) {
  return <svg className="se-thumb" viewBox="0 0 120 72" aria-hidden="true" dangerouslySetInnerHTML={{ __html: THUMB[type] ?? '' }} />;
}

export function BlockPicker({ onClose, onPick, hasHeader, hasFooter }: { onClose: () => void; onPick: (type: string) => void; hasHeader: boolean; hasFooter: boolean }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('all');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return BLOCKS.filter((b) => (cat === 'all' || b.category === cat) && (!s || `${b.name} ${b.description} ${b.keywords ?? ''} ${b.type}`.toLowerCase().includes(s))
      && !(b.global === 'header' && hasHeader) && !(b.global === 'footer' && hasFooter));
  }, [q, cat, hasHeader, hasFooter]);
  return (
    <Modal title="Add a block" onClose={onClose} wide>
      <div className="modal-body se-picker">
        <label className="ix-search se-pick-search"><Icon name="search" size={16} /><span className="sr-only">Search blocks</span>
          <input autoFocus placeholder="Search: menu, prices, map, form…" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) { e.preventDefault(); onPick(list[0].type); } }} />
        </label>
        <div className="seg-sm se-pick-cats" role="group" aria-label="Category">
          <button aria-pressed={cat === 'all'} onClick={() => setCat('all')}>All</button>
          {CATEGORIES.map((c) => <button key={c.id} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</button>)}
        </div>
        {list.length === 0 ? <p className="empty-line">No block matches “{q}”.</p> : (
          <ul className="se-pick-grid" role="list">
            {list.map((b) => (
              <li key={b.type}><button type="button" onClick={() => onPick(b.type)}>
                <BlockThumb type={b.type} />
                <b>{b.name}</b><small>{b.description}</small>
              </button></li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
