import fs from 'node:fs';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { config } from './config.js';
import { db } from './db.js';

/*
 * Big videos are re-encoded in the background to H.264 MP4 (at most 1920 px on the long
 * side, "fast start" so playback begins at once). The original keeps streaming until the
 * smaller copy is ready; it is only replaced when the new file is clearly smaller.
 * One video at a time, at low priority, so the server stays responsive.
 */

interface Row { id: string; app_id: string; name: string; type: string; size: number; status: string; version: number }

const require = createRequire(import.meta.url);
let warned = false;
/** FFMPEG_PATH (the Docker image sets /usr/bin/ffmpeg), else the ffmpeg-static package, else no compression. */
function ffmpegPath(): string | null {
  const own = process.env.FFMPEG_PATH;
  if (own) {
    if (fs.existsSync(own)) return own;
    if (!warned) { warned = true; console.warn(`[video] FFMPEG_PATH is set to ${own}, but there is no file there. Big videos will not be made smaller.`); }
    return null;
  }
  try { const p = require('ffmpeg-static') as string | null; return p && fs.existsSync(p) ? p : null; } catch { return null; }
}
let current: ChildProcess | null = null;
let stopped = false;
/** Shutdown: stop the running encode. The file stays "processing" and starts again on the next start. */
export function stopVideo() {
  stopped = true;
  queue.length = 0;
  if (current) { try { current.kill('SIGKILL'); } catch { /* already done */ } }
}

const queue: string[] = [];
let running = false;
const progress = new Map<string, number>();
let onUpdate: (appId: string, fileId: string) => void = () => {};
let filePathOf: (row: Row) => string = () => '';

export function initVideo(opts: { onUpdate: (appId: string, fileId: string) => void; filePath: (row: Row) => string }) {
  onUpdate = opts.onUpdate;
  filePathOf = opts.filePath;
  // Anything left half-done when the server stopped starts again.
  const pending = db.prepare("SELECT id FROM files WHERE status='processing'").all() as { id: string }[];
  pending.forEach((p) => queue.push(p.id));
  // Older copies that were still being streamed when their smaller copy took over.
  (db.prepare('SELECT * FROM files WHERE version > 1').all() as Row[]).forEach((r) => removeOlder(r));
  pump();
}

export const videoProgress = (id: string) => progress.get(id);

/** Called after an upload. Returns true when the file was queued. */
export function maybeCompress(row: Row): boolean {
  if (!config.limits.compressVideoBytes || row.size < config.limits.compressVideoBytes) return false;
  if (!/^video\//.test(row.type) || !ffmpegPath()) return false;
  db.prepare("UPDATE files SET status='processing' WHERE id=?").run(row.id);
  queue.push(row.id);
  pump();
  return true;
}

function pump() {
  if (running || stopped) return;
  const id = queue.shift();
  if (!id) return;
  running = true;
  compress(id).catch((e) => console.error('[video]', id, e?.message ?? e)).finally(() => {
    running = false;
    progress.delete(id);
    setImmediate(pump);
  });
}

function probeDuration(stderr: string): number {
  const m = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

async function compress(id: string) {
  const row = db.prepare('SELECT * FROM files WHERE id=?').get(id) as Row | undefined;
  const bin = ffmpegPath();
  if (!row || !bin) return;
  const src = filePathOf(row);
  if (!fs.existsSync(src)) { db.prepare("UPDATE files SET status='failed' WHERE id=?").run(id); return; }
  const target = filePathOf({ ...row, version: row.version + 1 });
  const out = `${target}.part.mp4`;
  fs.rmSync(out, { force: true });
  const args = [
    '-hide_banner', '-nostdin', '-y',
    '-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,flv,mpegts,mpeg',
    '-i', src,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', "scale=w='if(gte(iw,ih),min(1920,iw),-2)':h='if(gte(iw,ih),-2,min(1920,ih))':flags=lanczos,format=yuv420p",
    '-c:v', 'libx264', '-preset', 'faster', '-crf', '24', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-movflags', '+faststart', out,
  ];
  const code = await new Promise<number>((resolve) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    current = p;
    try { if (p.pid) os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not allowed on this system */ }
    let err = '', duration = 0, told = 0;
    p.stderr.on('data', (b: Buffer) => {
      err = (err + b.toString()).slice(-20_000);
      if (!duration) duration = probeDuration(err);
      const t = [...err.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
      if (t && duration) progress.set(id, Math.min(99, Math.round(((Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3])) / duration) * 100)));
      // Tell open apps how far along it is, a few times a minute at most.
      if (Date.now() - told > 5000 && progress.has(id)) { told = Date.now(); onUpdate(row.app_id, id); }
    });
    p.on('close', (c) => { current = null; if (c !== 0 && !stopped) console.error('[video] ffmpeg failed', id, err.slice(-600)); resolve(c ?? 1); });
    p.on('error', (e) => { console.error('[video]', e.message); resolve(1); });
  });
  if (stopped) { fs.rmSync(out, { force: true }); return; } // shutting down: it starts again next time
  const still = db.prepare('SELECT * FROM files WHERE id=?').get(id) as Row | undefined;
  if (!still) { fs.rmSync(out, { force: true }); return; } // deleted meanwhile
  if (code !== 0 || !fs.existsSync(out)) {
    fs.rmSync(out, { force: true });
    db.prepare("UPDATE files SET status='failed' WHERE id=?").run(id);
    onUpdate(row.app_id, id);
    return;
  }
  const newSize = fs.statSync(out).size;
  if (newSize >= row.size * 0.9) {
    // Not worth it: keep the original.
    fs.rmSync(out, { force: true });
    db.prepare("UPDATE files SET status='ready' WHERE id=?").run(id);
    onUpdate(row.app_id, id);
    return;
  }
  // The smaller copy gets its own name: the original may be open in someone's player, and Windows will not replace an open file.
  fs.renameSync(out, target);
  const name = row.name.replace(/\.[A-Za-z0-9]{1,5}$/, '') + '.mp4';
  db.prepare("UPDATE files SET status='ready', size=?, original_size=?, type='video/mp4', name=?, version=? WHERE id=?").run(newSize, row.size, name, row.version + 1, id);
  console.log(`[video] ${row.name}: ${(row.size / 1048576).toFixed(1)} MB -> ${(newSize / 1048576).toFixed(1)} MB`);
  onUpdate(row.app_id, id);
  removeOlder({ ...row, version: row.version + 1 });
}

/** Delete the copies a file had before its current version. One still open in a player is retried later. */
function removeOlder(row: Row, attempt = 0) {
  let left = 0;
  for (let v = 1; v < row.version; v++) {
    try { fs.rmSync(filePathOf({ ...row, version: v }), { force: true }); } catch { left++; }
  }
  if (left && attempt < 30) setTimeout(() => removeOlder(row, attempt + 1), 60_000).unref();
}

