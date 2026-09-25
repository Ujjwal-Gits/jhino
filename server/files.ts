import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { db, newId, now, canAdd, canWrite, logActivity, type Role } from './db.js';
import { HttpError } from './auth.js';
import { access } from './apps.js';
import { publish } from './realtime.js';
import { collectionDef, hasOwnVisibility, visibleTo, type RecordRow } from './data.js';
import { initVideo, maybeCompress, videoProgress } from './video.js';
import { uploadsOn } from './security.js';
import { uploadLimitBytes } from './plans.js';

export interface FileRow { id: string; app_id: string; name: string; type: string; size: number; created_by: string | null; created_at: string; status: string; original_size: number | null; version: number; deleted_at: string | null }

const filesDir = (appId: string) => path.join(config.dataDir, 'files', appId);
/** Where a file is on disk. A smaller copy made later (version 2 and up) gets its own name, so it never has to replace a file someone is streaming. */
export const filePath = (f: Pick<FileRow, 'app_id' | 'id' | 'version'>) => path.join(filesDir(f.app_id), f.version > 1 ? `${f.id}.v${f.version}` : f.id);

/** Remove every stored copy of a file (current and any older one still waiting to be removed). */
function removeStored(f: FileRow) {
  const dir = filesDir(f.app_id);
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) if (n === f.id || n.startsWith(f.id + '.v')) { try { fs.rmSync(path.join(dir, n), { force: true }); } catch { /* in use; the startup sweep removes it later */ } }
}

const INLINE_SAFE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/(mp4|webm|quicktime|ogg)|audio\/[\w.+-]+|application\/pdf|text\/plain)$/;

export function publicFile(f: FileRow) {
  const by = f.created_by ? (db.prepare('SELECT name FROM users WHERE id=?').get(f.created_by) as { name: string } | undefined)?.name : undefined;
  return {
    id: f.id, name: f.name, type: f.type, size: f.size, createdAt: f.created_at, createdBy: f.created_by, createdByName: by ?? null,
    status: f.status, originalSize: f.original_size, version: f.version, progress: f.status === 'processing' ? videoProgress(f.id) ?? 0 : undefined,
  };
}

/** A file that is not in Trash. */
export function loadFile(appId: string, fileId: string): FileRow | undefined {
  return db.prepare('SELECT * FROM files WHERE id=? AND app_id=? AND deleted_at IS NULL').get(fileId, appId) as FileRow | undefined;
}
/** A file whether or not it is in Trash (for restoring and deleting for good). */
export function loadFileAny(appId: string, fileId: string): FileRow | undefined {
  return db.prepare('SELECT * FROM files WHERE id=? AND app_id=?').get(fileId, appId) as FileRow | undefined;
}
/** Delete a file for good: the row and every stored copy. */
export function purgeFile(f: FileRow) {
  db.prepare('DELETE FROM files WHERE id=?').run(f.id);
  removeStored(f);
}

/**
 * Owners/editors and the uploader can always read a file. Otherwise, in apps with
 * "own"-visibility collections, a file is readable only through a record the person can see.
 */
export function canReadFile(f: FileRow, userId: string, role: Role): boolean {
  if (canWrite(role) || f.created_by === userId) return true;
  if (!hasOwnVisibility(f.app_id)) return true;
  const rows = db.prepare('SELECT * FROM records WHERE app_id=? AND instr(data, ?) > 0 LIMIT 200').all(f.app_id, `"${f.id}"`) as RecordRow[];
  return rows.some((r) => visibleTo(r, collectionDef(f.app_id, r.collection).def, userId, role));
}

function contentDisposition(kind: 'inline' | 'attachment', name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Stream a stored file, with byte ranges so videos can seek. */
export function sendFile(req: FastifyRequest, reply: FastifyReply, f: FileRow, opts: { download?: boolean; sameOrigin: boolean }) {
  const p = filePath(f);
  if (!fs.existsSync(p)) return reply.code(404).send({ error: 'NOT_FOUND', message: 'This file is missing on the server.' });
  const safe = INLINE_SAFE.test(f.type);
  const inline = !opts.download && safe;
  reply.header('Content-Type', f.type)
    .header('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', f.name))
    .header('X-Content-Type-Options', 'nosniff')
    .header('Accept-Ranges', 'bytes')
    .header('Cache-Control', 'private, no-cache')
    .header('ETag', `"${f.id}-${f.version}-${f.size}"`);
  // Anything that could run script is never rendered as a page on the Jhino origin.
  if (opts.sameOrigin && f.type !== 'application/pdf') reply.header('Content-Security-Policy', 'sandbox; default-src \'none\'; img-src \'self\'; media-src \'self\'; style-src \'unsafe-inline\'');
  const etag = `"${f.id}-${f.version}-${f.size}"`;
  if (req.headers['if-none-match'] === etag && !req.headers.range) return reply.code(304).send();
  const size = f.size;
  const ifRange = req.headers['if-range'];
  const range = ifRange && ifRange !== etag ? undefined : req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = 0, end = size - 1;
    if (m && (m[1] || m[2])) {
      if (m[1] === '') { start = Math.max(0, size - Number(m[2])); }
      else { start = Number(m[1]); if (m[2] !== '') end = Math.min(Number(m[2]), size - 1); }
    }
    if (!m || start > end || start >= size) {
      return reply.code(416).header('Content-Range', `bytes */${size}`).send();
    }
    reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1);
    return reply.send(fs.createReadStream(p, { start, end }));
  }
  reply.header('Content-Length', size);
  return reply.send(fs.createReadStream(p));
}

function appFilesBytes(appId: string) {
  return (db.prepare('SELECT COALESCE(SUM(size),0) n FROM files WHERE app_id=?').get(appId) as { n: number }).n;
}

function cleanType(t: string | undefined, name: string) {
  if (t && /^[\w.+-]+\/[\w.+-]+$/.test(t) && t !== 'application/octet-stream') return t.toLowerCase();
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.csv': 'text/csv',
    '.txt': 'text/plain', '.zip': 'application/zip', '.psd': 'image/vnd.adobe.photoshop', '.ai': 'application/postscript',
  };
  return map[ext] ?? 'application/octet-stream';
}

export function registerFiles(app: FastifyInstance) {
  initVideo({
    filePath: (row) => filePath(row),
    onUpdate: (appId, fileId) => {
      const f = loadFile(appId, fileId);
      if (f) publish(appId, 'file', { op: 'update', file: publicFile(f) }, undefined, (uid, r) => canReadFile(f, uid, r));
    },
  });

  app.post('/api/apps/:id/files', async (req) => {
    const { id } = req.params as { id: string };
    const { user, role } = access(req, id, 'add');
    if (!uploadsOn()) throw new HttpError(403, 'UPLOADS_OFF', 'File uploads are turned off on this Jhino. Add a link to the file instead (Google Drive, Dropbox, OneDrive, YouTube and so on).');
    if (appFilesBytes(id) >= config.limits.appFilesBytes) throw new HttpError(413, 'QUOTA_EXCEEDED', 'This app has used all of its file storage.');
    const owner = db.prepare('SELECT u.plan, u.plan_expires_at, u.is_admin FROM apps a JOIN users u ON u.id=a.owner_id WHERE a.id=?').get(id) as { plan: string; plan_expires_at: string | null; is_admin: number } | undefined;
    const maxBytes = uploadLimitBytes(owner, user);
    const tooBig = () => new HttpError(413, 'TOO_LARGE', `Files can be up to ${Math.round(maxBytes / 1048576)} MB here. Share a bigger file as a link (Google Drive, Dropbox, YouTube…).`, { maxBytes });
    // Refuse at once when the browser says it is sending more than that: nothing is written to disk.
    if (Number(req.headers['content-length'] || 0) > maxBytes + 64 * 1024) throw tooBig();
    const part = await req.file({ limits: { fileSize: maxBytes, files: 1, fields: 4 } });
    if (!part) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose a file to upload.');
    // Videos are shared as links (YouTube, Vimeo, Google Drive…), not stored here. Super admins still can.
    if (!user.is_admin && (/^video\//i.test(part.mimetype || '') || /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|3gp|mpe?g|ogv|mts|m2ts)$/i.test(part.filename || ''))) {
      // Read to the end (up to the size limit) before answering: some browsers treat an answer that
      // arrives mid-upload as a broken connection and retry.
      for await (const chunk of part.file) void chunk;
      throw new HttpError(415, 'VIDEO_AS_LINK', 'Videos are added as links here: paste a YouTube, Vimeo, Google Drive or Dropbox link instead.');
    }
    const name = (part.filename || 'file').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200) || 'file';
    const fid = newId('f');
    fs.mkdirSync(filesDir(id), { recursive: true });
    const tmp = path.join(filesDir(id), `${fid}.part`);
    try {
      await pipeline(part.file, fs.createWriteStream(tmp, { flags: 'wx' }));
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
    if (part.file.truncated) {
      fs.rmSync(tmp, { force: true });
      throw tooBig();
    }
    const size = fs.statSync(tmp).size;
    if (appFilesBytes(id) + size > config.limits.appFilesBytes) {
      fs.rmSync(tmp, { force: true });
      throw new HttpError(413, 'QUOTA_EXCEEDED', 'This app has used all of its file storage.');
    }
    fs.renameSync(tmp, path.join(filesDir(id), fid));
    db.prepare('INSERT INTO files(id,app_id,name,type,size,created_by,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(fid, id, name, cleanType(part.mimetype, name), size, user.id, now());
    db.prepare('UPDATE apps SET updated_at=? WHERE id=?').run(now(), id);
    logActivity(id, user.id, 'uploaded', name, { recordId: fid, kind: 'file' });
    maybeCompress(loadFile(id, fid)!);
    const f = loadFile(id, fid)!;
    const out = publicFile(f);
    publish(id, 'file', { op: 'create', file: out }, undefined, (uid, r) => canReadFile(f, uid, r));
    void role;
    return { file: out };
  });

  app.get('/api/apps/:id/files', async (req) => {
    const { id } = req.params as { id: string };
    const { user, role } = access(req, id);
    const rows = db.prepare('SELECT * FROM files WHERE app_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 5000').all(id) as FileRow[];
    return { files: rows.filter((f) => canReadFile(f, user.id, role)).map(publicFile) };
  });

  app.get('/api/apps/:id/files/:fid', async (req, reply) => {
    const { id, fid } = req.params as { id: string; fid: string };
    const { user, role } = access(req, id);
    const f = loadFile(id, fid);
    if (!f || !canReadFile(f, user.id, role)) throw new HttpError(404, 'NOT_FOUND', 'File not found.');
    return sendFile(req, reply, f, { download: (req.query as { download?: string }).download === '1', sameOrigin: true });
  });

  app.delete('/api/apps/:id/files/:fid', async (req) => {
    const { id, fid } = req.params as { id: string; fid: string };
    const { user, role } = access(req, id, 'add');
    const f = loadFile(id, fid);
    if (!f || !canReadFile(f, user.id, role)) throw new HttpError(404, 'NOT_FOUND', 'File not found.');
    if (!canWrite(role) && f.created_by !== user.id) throw new HttpError(403, 'FORBIDDEN', 'You can only delete files you uploaded.');
    // Into Trash: the bytes stay until someone deletes it for good.
    const t = now();
    db.transaction(() => {
      db.prepare('UPDATE files SET deleted_at=? WHERE id=?').run(t, fid);
      db.prepare('INSERT INTO trash(id,app_id,kind,record_id,label,created_by,created_at,deleted_by,deleted_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(newId('tr'), id, 'file', fid, f.name, f.created_by, f.created_at, user.id, t);
    })();
    logActivity(id, user.id, 'moved a file to Trash:', f.name, { recordId: fid, kind: 'delete' });
    publish(id, 'file', { op: 'delete', file: { id: fid } }, undefined, (uid, r) => canReadFile(f, uid, r) || canAdd(r));
    publish(id, 'trash', { op: 'delete' });
    return { ok: true };
  });
}
