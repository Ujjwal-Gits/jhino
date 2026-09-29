import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, bytes, useToast } from '../../ui';

/*
 * Documents, all in the browser (files never leave the device):
 * - PDF tools: merge, organise pages (reorder, rotate, delete), extract or split pages, images to PDF,
 *   PDF to images, and compress.
 * - Word to PDF: a .docx is turned into a clean page and saved as PDF with the browser's print.
 * - PDF to Word: the text of each page, in paragraphs, as a .docx (and .txt).
 * pdf-lib, pdf.js, mammoth and fflate load only when these pages open.
 */
const dl = (data: BlobPart | Uint8Array, name: string, type: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data as BlobPart], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60_000); };
const base = (n: string) => n.replace(/\.[^.]+$/, '');
async function pdfjs() {
  const m = await import('pdfjs-dist');
  const w = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  m.GlobalWorkerOptions.workerSrc = w.default;
  return m;
}
const lib = () => import('pdf-lib');
async function zip(files: Record<string, Uint8Array>) { const { zipSync } = await import('fflate'); return zipSync(files, { level: 0 }); }
async function render(page: any, scale: number) {
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
  return c;
}
const blobOf = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), type, q));
/** "1-3, 5, 8-" → zero-based page numbers. */
function pages(spec: string, count: number) {
  const out: number[] = [];
  for (const part of spec.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    if (m) { const a = Number(m[1] || 1), b = Number(m[2] || count); for (let i = a; i <= Math.min(b, count); i++) out.push(i - 1); }
    else if (/^\d+$/.test(part) && Number(part) <= count && Number(part) > 0) out.push(Number(part) - 1);
  }
  return [...new Set(out)];
}

function Drop({ accept, multiple, onFiles, title, sub }: { accept: string; multiple?: boolean; onFiles: (f: File[]) => void; title: string; sub: string }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return <>
    <button className={`tp-drop ${over ? 'over' : ''}`} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]); }}>
      <Icon name="upload" size={26} /><b>{title}</b><span>{sub}</span>
    </button>
    <input ref={input} type="file" accept={accept} multiple={multiple} hidden onChange={(e) => { if (e.target.files) onFiles([...e.target.files]); e.target.value = ''; }} />
  </>;
}
function Busy({ on, children }: { on: boolean; children: ReactNode }) { return on ? <p className="pd-busy"><span className="spin" />{children}</p> : null; }

type Tool = 'merge' | 'organise' | 'extract' | 'images' | 'topng' | 'compress';
const TOOLS: [Tool, string, string][] = [
  ['merge', 'Merge', 'Join several PDFs into one.'],
  ['organise', 'Organise pages', 'Reorder, rotate or delete pages.'],
  ['extract', 'Extract or split', 'Keep some pages, or split every page into its own file.'],
  ['images', 'Images to PDF', 'JPG, PNG or WebP photos into one PDF.'],
  ['topng', 'PDF to images', 'Every page as a JPG or PNG.'],
  ['compress', 'Compress', 'Make a scanned or heavy PDF smaller.'],
];
export function PdfTools() {
  const [tool, setTool] = useState<Tool>('merge');
  return (
    <div className="pd">
      <nav className="pd-tools" aria-label="PDF tools">{TOOLS.map(([k, l, d]) => (
        <button key={k} aria-pressed={tool === k} onClick={() => setTool(k)}><b>{l}</b><small>{d}</small></button>
      ))}</nav>
      <section className="tp-card pd-body">
        {tool === 'merge' && <Merge />}
        {tool === 'organise' && <Organise />}
        {tool === 'extract' && <Extract />}
        {tool === 'images' && <ImagesToPdf />}
        {tool === 'topng' && <PdfToImages />}
        {tool === 'compress' && <Compress />}
        <p className="hint">Everything happens on your device. Your files are never uploaded.</p>
      </section>
    </div>
  );
}

function Merge() {
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const { PDFDocument } = await lib(); const out = await PDFDocument.create();
      for (const f of files) { const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true }); (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p)); }
      dl(await out.save(), 'merged.pdf', 'application/pdf');
    } catch { toast('One of the files could not be read. Is it a PDF with a password?', true); }
    setBusy(false);
  };
  return <>
    <Drop accept="application/pdf,.pdf" multiple onFiles={(f) => setFiles((l) => [...l, ...f.filter((x) => /pdf$/i.test(x.name) || x.type === 'application/pdf')])} title="Drop PDFs here" sub="or click to choose. Add as many as you like, then put them in order." />
    {!!files.length && <ul className="pd-files">{files.map((f, i) => (
      <li key={i}><span className="mono pd-n">{i + 1}</span><span className="ha-t"><b>{f.name}</b><small className="mono">{bytes(f.size)}</small></span>
        <button className="icon-btn" aria-label="Move up" disabled={!i} onClick={() => setFiles((l) => { const n = [...l]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}><Icon name="up" size={15} /></button>
        <button className="icon-btn" aria-label="Move down" disabled={i === files.length - 1} onClick={() => setFiles((l) => { const n = [...l]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })}><Icon name="down" size={15} /></button>
        <button className="icon-btn" aria-label="Remove" onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}><Icon name="close" size={15} /></button></li>
    ))}</ul>}
    <div className="actions-row"><button className="btn primary" disabled={files.length < 2 || busy} onClick={go}>{busy && <span className="spin" />}Merge {files.length > 1 ? `${files.length} files` : ''}</button>{!!files.length && <button className="btn quiet" onClick={() => setFiles([])}>Clear</button>}</div>
  </>;
}

interface Pg { i: number; rot: number; src: string }
function Organise() {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [pgs, setPgs] = useState<Pg[]>([]);
  const [busy, setBusy] = useState('');
  const open = async (f: File) => {
    setFile(f); setPgs([]); setBusy('Reading pages…');
    try {
      const m = await pdfjs(); const doc = await m.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
      const out: Pg[] = [];
      for (let i = 1; i <= Math.min(doc.numPages, 300); i++) { const c = await render(await doc.getPage(i), 0.3); out.push({ i: i - 1, rot: 0, src: c.toDataURL('image/jpeg', 0.7) }); if (i % 6 === 0) setPgs([...out]); }
      setPgs(out);
    } catch { toast('Could not read that PDF.', true); setFile(null); }
    setBusy('');
  };
  const save = async () => {
    if (!file) return; setBusy('Saving…');
    try {
      const { PDFDocument, degrees } = await lib();
      const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true }); const out = await PDFDocument.create();
      const copied = await out.copyPages(src, pgs.map((p) => p.i));
      copied.forEach((p, k) => { p.setRotation(degrees((p.getRotation().angle + pgs[k].rot) % 360)); out.addPage(p); });
      dl(await out.save(), `${base(file.name)}-organised.pdf`, 'application/pdf');
    } catch { toast('Could not save it.', true); }
    setBusy('');
  };
  const mv = (k: number, by: number) => setPgs((l) => { const j = k + by; if (j < 0 || j >= l.length) return l; const n = [...l]; [n[k], n[j]] = [n[j], n[k]]; return n; });
  return <>
    {!file ? <Drop accept="application/pdf,.pdf" onFiles={(f) => f[0] && open(f[0])} title="Drop a PDF here" sub="You will see every page. Move, turn or remove them, then save." /> : <>
      <div className="tp-row"><b>{file.name}</b><span className="actions-row"><button className="btn primary" disabled={!pgs.length || !!busy} onClick={save}>Save PDF</button><button className="btn quiet" onClick={() => { setFile(null); setPgs([]); }}>Another file</button></span></div>
      <Busy on={!!busy}>{busy}</Busy>
      <ul className="pd-pages">{pgs.map((p, k) => (
        <li key={p.i}>
          <span className="pd-thumb"><img src={p.src} alt={`Page ${p.i + 1}`} style={{ transform: `rotate(${p.rot}deg)` }} /></span>
          <small className="mono">{k + 1}</small>
          <span className="pd-pg-acts">
            <button className="icon-btn" aria-label="Move earlier" disabled={!k} onClick={() => mv(k, -1)}><Icon name="back" size={14} /></button>
            <button className="icon-btn" aria-label="Turn right" onClick={() => setPgs((l) => l.map((x, j) => (j === k ? { ...x, rot: (x.rot + 90) % 360 } : x)))}><Icon name="rotate" size={14} /></button>
            <button className="icon-btn" aria-label="Delete page" onClick={() => setPgs((l) => l.filter((_, j) => j !== k))}><Icon name="trash" size={14} /></button>
            <button className="icon-btn pd-fwd" aria-label="Move later" disabled={k === pgs.length - 1} onClick={() => mv(k, 1)}><Icon name="back" size={14} /></button>
          </span>
        </li>
      ))}</ul>
    </>}
  </>;
}

function Extract() {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [count, setCount] = useState(0);
  const [spec, setSpec] = useState('');
  const [busy, setBusy] = useState(false);
  const open = async (f: File) => { try { const { PDFDocument } = await lib(); const d = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true }); setCount(d.getPageCount()); setFile(f); setSpec(`1-${d.getPageCount()}`); } catch { toast('Could not read that PDF.', true); } };
  const run = async (split: boolean) => {
    if (!file) return; setBusy(true);
    try {
      const { PDFDocument } = await lib(); const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      const want = pages(spec, count); if (!want.length) { toast('Which pages? For example 1-3, 5', true); setBusy(false); return; }
      if (!split) { const out = await PDFDocument.create(); (await out.copyPages(src, want)).forEach((p) => out.addPage(p)); dl(await out.save(), `${base(file.name)}-pages.pdf`, 'application/pdf'); }
      else {
        const files: Record<string, Uint8Array> = {};
        for (const i of want) { const out = await PDFDocument.create(); out.addPage((await out.copyPages(src, [i]))[0]); files[`${base(file.name)}-page-${i + 1}.pdf`] = await out.save(); }
        dl(await zip(files), `${base(file.name)}-pages.zip`, 'application/zip');
      }
    } catch { toast('Could not do that.', true); }
    setBusy(false);
  };
  return !file ? <Drop accept="application/pdf,.pdf" onFiles={(f) => f[0] && open(f[0])} title="Drop a PDF here" sub="Then choose the pages to keep." /> : <>
    <div className="tp-row"><span className="ha-t"><b>{file.name}</b><small>{count} pages</small></span><button className="btn quiet sm" onClick={() => setFile(null)}>Another file</button></div>
    <label className="field"><span>Pages <em>like 1-3, 5, 8-</em></span><input className="input mono" value={spec} onChange={(e) => setSpec(e.target.value)} /></label>
    <div className="actions-row"><button className="btn primary" disabled={busy} onClick={() => run(false)}>{busy && <span className="spin" />}Save as one PDF</button><button className="btn" disabled={busy} onClick={() => run(true)}>Split: one PDF per page (.zip)</button></div>
  </>;
}

function ImagesToPdf() {
  const toast = useToast();
  const [imgs, setImgs] = useState<{ f: File; url: string }[]>([]);
  const [size, setSize] = useState<'a4' | 'letter' | 'fit'>('a4');
  const [margin, setMargin] = useState(24);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => imgs.forEach((i) => URL.revokeObjectURL(i.url)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    setBusy(true);
    try {
      const { PDFDocument } = await lib(); const out = await PDFDocument.create();
      for (const { f } of imgs) {
        const bmp = await createImageBitmap(f); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const x = c.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0);
        const img = await out.embedJpg(new Uint8Array(await (await blobOf(c, 'image/jpeg', 0.92)).arrayBuffer()));
        const [W, H] = size === 'a4' ? [595.28, 841.89] : size === 'letter' ? [612, 792] : [bmp.width * 0.75, bmp.height * 0.75];
        const land = size !== 'fit' && bmp.width > bmp.height;
        const pw = land ? H : W, ph = land ? W : H, m = size === 'fit' ? 0 : margin;
        const s = Math.min((pw - m * 2) / img.width, (ph - m * 2) / img.height);
        const page = out.addPage([pw, ph]); page.drawImage(img, { x: (pw - img.width * s) / 2, y: (ph - img.height * s) / 2, width: img.width * s, height: img.height * s });
      }
      dl(await out.save(), 'images.pdf', 'application/pdf');
    } catch { toast('One of the images could not be read.', true); }
    setBusy(false);
  };
  return <>
    <Drop accept="image/*" multiple onFiles={(f) => setImgs((l) => [...l, ...f.filter((x) => x.type.startsWith('image/')).map((x) => ({ f: x, url: URL.createObjectURL(x) }))])} title="Drop photos here" sub="JPG, PNG, WebP. Each photo becomes a page, in this order." />
    {!!imgs.length && <ul className="pd-pages">{imgs.map((im, k) => (
      <li key={im.url}><span className="pd-thumb"><img src={im.url} alt="" /></span><small className="mono">{k + 1}</small>
        <span className="pd-pg-acts"><button className="icon-btn" aria-label="Move earlier" disabled={!k} onClick={() => setImgs((l) => { const n = [...l]; [n[k - 1], n[k]] = [n[k], n[k - 1]]; return n; })}><Icon name="back" size={14} /></button>
          <button className="icon-btn" aria-label="Remove" onClick={() => setImgs((l) => l.filter((_, j) => j !== k))}><Icon name="trash" size={14} /></button></span></li>
    ))}</ul>}
    <div className="grid2">
      <div className="field"><span>Page size</span><div className="tp-seg">{([['a4', 'A4'], ['letter', 'Letter'], ['fit', 'Same as photo']] as const).map(([v, l]) => <button key={v} aria-pressed={size === v} onClick={() => setSize(v)}>{l}</button>)}</div></div>
      {size !== 'fit' && <label className="field"><span>Margin <em className="mono">{margin}pt</em></span><input type="range" min={0} max={72} step={4} value={margin} onChange={(e) => setMargin(Number(e.target.value))} /></label>}
    </div>
    <div className="actions-row"><button className="btn primary" disabled={!imgs.length || busy} onClick={go}>{busy && <span className="spin" />}Make PDF</button>{!!imgs.length && <button className="btn quiet" onClick={() => setImgs([])}>Clear</button>}</div>
  </>;
}

function PdfToImages() {
  const toast = useToast();
  const [fmt, setFmt] = useState<'image/jpeg' | 'image/png'>('image/jpeg');
  const [dpi, setDpi] = useState(150);
  const [busy, setBusy] = useState('');
  const go = async (f: File) => {
    setBusy('Starting…');
    try {
      const m = await pdfjs(); const doc = await m.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
      const files: Record<string, Uint8Array> = {}; const ext = fmt === 'image/png' ? 'png' : 'jpg';
      for (let i = 1; i <= doc.numPages; i++) {
        setBusy(`Page ${i} of ${doc.numPages}…`);
        const c = await render(await doc.getPage(i), dpi / 72);
        files[`${base(f.name)}-${String(i).padStart(3, '0')}.${ext}`] = new Uint8Array(await (await blobOf(c, fmt, 0.9)).arrayBuffer());
      }
      const names = Object.keys(files);
      if (names.length === 1) dl(files[names[0]], names[0], fmt); else dl(await zip(files), `${base(f.name)}-images.zip`, 'application/zip');
    } catch { toast('Could not read that PDF.', true); }
    setBusy('');
  };
  return <>
    <div className="grid2">
      <div className="field"><span>Format</span><div className="tp-seg">{([['image/jpeg', 'JPG'], ['image/png', 'PNG']] as const).map(([v, l]) => <button key={v} aria-pressed={fmt === v} onClick={() => setFmt(v)}>{l}</button>)}</div></div>
      <div className="field"><span>Sharpness</span><div className="tp-seg">{[[96, 'Screen'], [150, 'Good'], [300, 'Print']].map(([v, l]) => <button key={v} aria-pressed={dpi === v} onClick={() => setDpi(v as number)}>{l}</button>)}</div></div>
    </div>
    <Drop accept="application/pdf,.pdf" onFiles={(f) => f[0] && go(f[0])} title="Drop a PDF here" sub="Every page is saved as a picture. Many pages come as one .zip." />
    <Busy on={!!busy}>{busy}</Busy>
  </>;
}

function Compress() {
  const toast = useToast();
  const [level, setLevel] = useState<'light' | 'medium' | 'strong'>('medium');
  const [busy, setBusy] = useState('');
  const [res, setRes] = useState<{ name: string; before: number; after: number } | null>(null);
  const go = async (f: File) => {
    setBusy('Starting…'); setRes(null);
    try {
      const [scale, q] = level === 'light' ? [1.6, 0.8] : level === 'medium' ? [1.25, 0.65] : [1, 0.5];
      const m = await pdfjs(); const { PDFDocument } = await lib();
      const doc = await m.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise; const out = await PDFDocument.create();
      for (let i = 1; i <= doc.numPages; i++) {
        setBusy(`Page ${i} of ${doc.numPages}…`);
        const page = await doc.getPage(i); const vp = page.getViewport({ scale: 1 }); const c = await render(page, scale);
        const img = await out.embedJpg(new Uint8Array(await (await blobOf(c, 'image/jpeg', q)).arrayBuffer()));
        out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
      }
      const bytesOut = await out.save();
      if (bytesOut.length >= f.size) { setRes({ name: f.name, before: f.size, after: bytesOut.length }); toast('This PDF is already small; the compressed copy would be bigger.', true); }
      else { dl(bytesOut, `${base(f.name)}-compressed.pdf`, 'application/pdf'); setRes({ name: f.name, before: f.size, after: bytesOut.length }); }
    } catch { toast('Could not read that PDF.', true); }
    setBusy('');
  };
  return <>
    <div className="field"><span>Strength</span><div className="tp-seg">{([['light', 'Light: sharper'], ['medium', 'Medium'], ['strong', 'Strong: smallest']] as const).map(([v, l]) => <button key={v} aria-pressed={level === v} onClick={() => setLevel(v)}>{l}</button>)}</div></div>
    <Drop accept="application/pdf,.pdf" onFiles={(f) => f[0] && go(f[0])} title="Drop a PDF here" sub="Best for scans and photo-heavy PDFs. Pages become images, so text can no longer be selected." />
    <Busy on={!!busy}>{busy}</Busy>
    {res && <p className="pd-res"><b>{res.name}</b> <span className="mono">{bytes(res.before)} → {bytes(res.after)}</span> {res.after < res.before && <span className="ok-text">{Math.round((1 - res.after / res.before) * 100)}% smaller</span>}</p>}
  </>;
}

/* ---------------- Word to PDF ---------------- */
const PRINT_CSS = `@page{size:A4;margin:20mm}body{font:11.5pt/1.55 Calibri,'Segoe UI',Arial,sans-serif;color:#111;margin:0}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%;margin:8pt 0}td,th{border:1px solid #bbb;padding:4pt 6pt;vertical-align:top}h1{font-size:20pt}h2{font-size:16pt}h3{font-size:13pt}p{margin:0 0 8pt}`;
export function WordToPdf() {
  const toast = useToast();
  const [doc, setDoc] = useState<{ name: string; html: string; warn: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const open = async (f: File) => {
    if (!/\.docx$/i.test(f.name)) { toast('Choose a .docx file. For an old .doc, open it in Word and save as .docx first.', true); return; }
    setBusy(true);
    try {
      const mammoth = await import('mammoth');
      const r = await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
      setDoc({ name: base(f.name), html: r.value, warn: r.messages.filter((m) => m.type === 'warning').length });
    } catch { toast('Could not read that document.', true); }
    setBusy(false);
  };
  const srcDoc = doc ? `<!doctype html><html><head><meta charset="utf-8"><title>${doc.name.replace(/[<&]/g, '')}</title><style>${PRINT_CSS}</style></head><body>${doc.html}</body></html>` : '';
  return (
    <div className="pd-one">
      {!doc ? <>
        <Drop accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onFiles={(f) => f[0] && open(f[0])} title="Drop a Word file (.docx)" sub="Headings, lists, tables, bold, links and pictures are kept." />
        <Busy on={busy}>Reading the document…</Busy>
      </> : <>
        <div className="tp-row"><span className="ha-t"><b>{doc.name}.docx</b><small>Ready. In the print window choose "Save as PDF".</small></span>
          <span className="actions-row"><button className="btn primary" onClick={() => frame.current?.contentWindow?.print()}><Icon name="download" size={16} />Save as PDF</button><button className="btn quiet" onClick={() => setDoc(null)}>Another file</button></span></div>
        {doc.warn > 0 && <p className="hint">Some special Word formatting was simplified.</p>}
        <div className="pd-paper"><iframe ref={frame} title="Preview" srcDoc={srcDoc} /></div>
      </>}
      <p className="hint">Converted on your device; the document is never uploaded.</p>
    </div>
  );
}

/* ---------------- PDF to Word ---------------- */
const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function docx(pagesOfParas: { text: string; size: number; bold: boolean }[][]) {
  const body = pagesOfParas.map((ps, i) => (i ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '') + ps.map((p) =>
    `<w:p><w:r><w:rPr>${p.bold ? '<w:b/>' : ''}<w:sz w:val="${Math.round(Math.min(72, Math.max(8, p.size)) * 2)}"/></w:rPr><w:t xml:space="preserve">${esc(p.text)}</w:t></w:r></w:p>`).join('')).join('');
  const enc = new TextEncoder();
  return {
    '[Content_Types].xml': enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`),
  };
}
export function PdfToWord() {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [out, setOut] = useState<{ name: string; paras: { text: string; size: number; bold: boolean }[][] } | null>(null);
  const go = async (f: File) => {
    setBusy('Starting…'); setOut(null);
    try {
      const m = await pdfjs(); const doc = await m.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
      const all: { text: string; size: number; bold: boolean }[][] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        setBusy(`Page ${i} of ${doc.numPages}…`);
        const tc = await (await doc.getPage(i)).getTextContent();
        const lines: { y: number; x: number; h: number; t: string; bold: boolean }[] = [];
        for (const it of tc.items as any[]) {
          if (!('str' in it) || !it.str) continue;
          const y = it.transform[5], x = it.transform[4], h = Math.abs(it.transform[3]) || it.height || 11;
          const bold = /bold|black|heavy/i.test((tc.styles as any)[it.fontName]?.fontFamily ?? '') || /bold/i.test(it.fontName);
          const line = lines.find((l) => Math.abs(l.y - y) < h * 0.5);
          if (line) { line.t += (x > line.x && !line.t.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str; line.x = x; }
          else lines.push({ y, x, h, t: it.str, bold });
        }
        lines.sort((a, b) => b.y - a.y);
        const paras: { text: string; size: number; bold: boolean }[] = [];
        let prev: (typeof lines)[number] | null = null;
        for (const l of lines) {
          const t = l.t.replace(/\s+/g, ' ').trim(); if (!t) continue;
          const gap = prev ? prev.y - l.y : 0, last = paras[paras.length - 1];
          if (prev && last && gap < l.h * 1.7 && Math.abs(prev.h - l.h) < 1.5) last.text += (last.text.endsWith('-') ? '' : ' ') + t;
          else paras.push({ text: t, size: Math.round(l.h), bold: l.bold });
          prev = l;
        }
        all.push(paras);
      }
      if (!all.some((p) => p.length)) toast('No text found. This looks like a scanned PDF (pictures of pages), which has no text to copy.', true);
      setOut({ name: base(f.name), paras: all });
    } catch { toast('Could not read that PDF.', true); }
    setBusy('');
  };
  const word = async () => { if (!out) return; const { zipSync } = await import('fflate'); dl(zipSync(docx(out.paras)), `${out.name}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); };
  const text = out?.paras.map((p) => p.map((x) => x.text).join('\n\n')).join('\n\n\f\n\n') ?? '';
  return (
    <div className="pd-one">
      <Drop accept="application/pdf,.pdf" onFiles={(f) => f[0] && go(f[0])} title="Drop a PDF here" sub="Its text comes out as an editable Word document, page by page." />
      <Busy on={!!busy}>{busy}</Busy>
      {out && <>
        <div className="tp-row"><span className="ha-t"><b>{out.name}</b><small>{out.paras.length} pages · {out.paras.reduce((n, p) => n + p.length, 0)} paragraphs</small></span>
          <span className="actions-row"><button className="btn primary" onClick={word}><Icon name="download" size={16} />Download .docx</button><button className="btn" onClick={() => dl(text, `${out.name}.txt`, 'text/plain')}>.txt</button></span></div>
        <pre className="pd-text">{text.slice(0, 20000)}{text.length > 20000 ? '\n…' : ''}</pre>
      </>}
      <p className="hint">Text, paragraphs, headings and page breaks come across. Complex layouts, columns and pictures do not. Converted on your device.</p>
    </div>
  );
}
