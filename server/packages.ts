import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import yauzl from 'yauzl';
import { config } from './config.js';
import { HttpError } from './auth.js';
import { extractManifest, type Manifest } from './manifest.js';

export interface PackageResult {
  entry: string;
  fileCount: number;
  size: number;
  features: Features;
  title: string | null;
  manifest: Manifest | null;
}
export interface Features {
  localStorage: boolean;
  claudeStorage: boolean;
  jhinoSdk: boolean;
  indexedDB: boolean;
  network: boolean;
}

const bad = (msg: string) => new HttpError(400, 'INVALID_PACKAGE', msg);
const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;

export const appDir = (appId: string, n: number) => path.join(config.dataDir, 'apps', appId, `v${n}`);

/** Unpack an upload into a staging folder, then move it into place in one rename. */
export async function installPackage(buf: Buffer, fileName: string, appId: string, n: number): Promise<PackageResult> {
  const staging = path.join(config.dataDir, 'staging', crypto.randomBytes(8).toString('hex'));
  fs.mkdirSync(staging, { recursive: true });
  try {
    const isZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
    if (isZip) await extractZip(buf, staging);
    else if (/\.html?$/i.test(fileName) || looksLikeHtml(buf)) fs.writeFileSync(path.join(staging, 'index.html'), buf);
    else throw bad('Upload a .zip file or a single .html file.');

    const root = findRoot(staging);
    const entry = findEntry(root);
    const files = listFiles(root);
    const size = files.reduce((s, f) => s + fs.statSync(path.join(root, f)).size, 0);
    const features = scan(root, files);
    // Only the start of the page is read for its title and manifest (a huge or hostile file cannot stall the server).
    const html = readStart(path.join(root, entry), 4 * 1024 * 1024);
    const t = html.slice(0, 512 * 1024).match(/<title[^>]{0,200}>([^<]{1,80})<\/title>/i);
    const manifest = extractManifest(root, html);
    if (manifest?.collections) features.jhinoSdk = true;

    const dest = appDir(appId, n);
    if (fs.existsSync(dest)) throw new Error('version folder already exists');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(root, dest);
    return { entry, fileCount: files.length, size, features, title: t ? decodeEntities(t[1].trim()) : (manifest?.name ?? null), manifest };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function looksLikeHtml(buf: Buffer) {
  const head = buf.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

function decodeEntities(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function extractZip(buf: Buffer, dest: string) {
  const zip = await yauzl.fromBufferPromise(buf, { lazyEntries: true, validateEntrySizes: true, strictFileNames: false });
  if (zip.entryCount > config.limits.zipEntries) throw bad(`The ZIP has too many files (limit ${config.limits.zipEntries}).`);
  let total = 0;
  const seen = new Set<string>();
  try {
    for (;;) {
      const entry = await new Promise<yauzl.Entry | null>((resolve, reject) => {
        const onEntry = (e: yauzl.Entry) => { cleanup(); resolve(e); };
        const onEnd = () => { cleanup(); resolve(null); };
        const onErr = (e: Error) => {
          cleanup();
          reject(bad(/relative path|absolute path/i.test(e.message) ? 'The ZIP has an unsafe file path (it points outside the app folder).' : `The ZIP could not be read: ${e.message}`));
        };
        const cleanup = () => { zip.off('entry', onEntry); zip.off('end', onEnd); zip.off('error', onErr); };
        zip.on('entry', onEntry); zip.on('end', onEnd); zip.on('error', onErr);
        zip.readEntry();
      });
      if (!entry) break;
      const name = entry.fileName;
      if (name.endsWith('/') || JUNK.test(name)) continue;
      if (entry.isEncrypted()) throw bad('The ZIP is password-protected. Upload an unprotected ZIP.');
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (mode === 0o120000) throw bad(`The ZIP contains a shortcut (symlink): ${name}`);
      const parts = name.split('/');
      if (name.length > 300 || parts.length > 24 || parts.some((p) => !p || p === '.' || p === '..' || p.length > 200) || /^[a-z]:/i.test(name) || name.startsWith('/')) {
        throw bad(`The ZIP has an unsafe file path: ${name.slice(0, 120)}`);
      }
      const lower = name.toLowerCase();
      if (seen.has(lower)) throw bad(`The ZIP has two files with the same name: ${name}`);
      seen.add(lower);
      if (total + entry.uncompressedSize > config.limits.unzippedBytes) throw bad('The ZIP is too large once unpacked.');

      const target = path.join(dest, ...parts);
      if (!target.startsWith(dest + path.sep)) throw bad(`The ZIP has an unsafe file path: ${name}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const stream = await zip.openReadStreamPromise(entry);
      // Count real bytes too; never trust the sizes written in the archive.
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          total += chunk.length;
          if (total > config.limits.unzippedBytes) cb(bad('The ZIP is too large once unpacked.'));
          else cb(null, chunk);
        },
      });
      await pipeline(stream, counter, fs.createWriteStream(target, { flags: 'wx' }));
    }
  } finally {
    zip.close();
  }
}

/** Use the folder that actually holds the site: strip a single wrapper folder, prefer dist/ or build/. */
function findRoot(dir: string): string {
  let root = dir;
  for (let i = 0; i < 3; i++) {
    if (fs.existsSync(path.join(root, 'index.html'))) return root;
    for (const sub of ['dist', 'build', 'out', 'public']) {
      if (fs.existsSync(path.join(root, sub, 'index.html'))) return path.join(root, sub);
    }
    const items = fs.readdirSync(root, { withFileTypes: true });
    if (items.length === 1 && items[0].isDirectory()) { root = path.join(root, items[0].name); continue; }
    break;
  }
  return root;
}

function findEntry(root: string): string {
  if (fs.existsSync(path.join(root, 'index.html'))) return 'index.html';
  const top = fs.readdirSync(root).filter((f) => /\.html?$/i.test(f));
  if (top.length === 1) return top[0];
  if (fs.existsSync(path.join(root, 'package.json')) || fs.existsSync(path.join(root, 'src'))) {
    throw bad('This looks like source code, not a finished app. Run its build (for example "npm run build") and upload the dist folder as a ZIP.');
  }
  if (top.length > 1) throw bad(`Found ${top.length} HTML files but no index.html. Rename the main page to index.html.`);
  throw bad('Missing index.html. The ZIP needs an index.html file.');
}

function listFiles(root: string, rel = ''): string[] {
  const out: string[] = [];
  for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...listFiles(root, r));
    else if (d.isFile()) out.push(r);
  }
  return out;
}

/** Look at the code (never run it) to tell people honestly how data will behave. */
function scan(root: string, files: string[]): Features {
  const f: Features = { localStorage: false, claudeStorage: false, jhinoSdk: false, indexedDB: false, network: false };
  for (const file of files) {
    if (!/\.(html?|m?js|jsx|tsx?)$/i.test(file)) continue;
    const st = fs.statSync(path.join(root, file));
    if (st.size > 8 * 1024 * 1024) continue;
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    if (/\blocalStorage\b/.test(src)) f.localStorage = true;
    if (/\bwindow\.storage\b|\bstorage\.(get|set|list|delete)\s*\(/.test(src)) f.claudeStorage = true;
    if (/\bjhino\.(data|kv|me|ready|onChange)\b/.test(src)) f.jhinoSdk = true;
    if (/\bindexedDB\b|\blocalforage\b|\bDexie\b/.test(src)) f.indexedDB = true;
    if (/\bfetch\s*\(|XMLHttpRequest|\bWebSocket\s*\(/.test(src)) f.network = true;
  }
  return f;
}

/** The first `max` bytes of a file as text. */
function readStart(file: string, max: number) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(max, fs.fstatSync(fd).size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}
