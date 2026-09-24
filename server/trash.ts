import type { FastifyInstance } from 'fastify';
import { db, now, canAdd, canWrite, logActivity, type Role } from './db.js';
import { HttpError } from './auth.js';
import { access } from './apps.js';
import { publish } from './realtime.js';
import { collectionDef, visibleTo, type RecordRow } from './data.js';
import { canReadFile, loadFileAny, publicFile, purgeFile } from './files.js';

/*
 * The Trash of an app. Deleting an item or a file puts it here (an item takes its comments with it).
 * People who can edit see everything in Trash; others see what they deleted or added themselves.
 * Anyone who could add it back can restore it; only people who can edit delete for good.
 */

interface TrashRow {
  id: string; app_id: string; kind: 'record' | 'file'; collection: string | null; record_id: string; data: string | null; rev: number | null;
  created_by: string | null; created_at: string | null; updated_by: string | null; updated_at: string | null;
  label: string; parent: string | null; deleted_by: string | null; deleted_at: string;
}

const asRecordRow = (t: TrashRow): RecordRow => ({
  id: t.record_id, collection: t.collection!, data: t.data!, rev: t.rev ?? 1,
  created_by: t.created_by ?? '', created_at: t.created_at ?? t.deleted_at, updated_by: t.updated_by ?? '', updated_at: t.updated_at ?? t.deleted_at,
});

function mayFind(t: TrashRow, userId: string, role: Role): boolean {
  if (canWrite(role)) return true;
  if (t.deleted_by !== userId && t.created_by !== userId) return false;
  if (t.kind === 'record') return visibleTo(asRecordRow(t), collectionDef(t.app_id, t.collection!).def, userId, role);
  return true;
}
const mayRestore = (t: TrashRow, userId: string, role: Role) => canAdd(role) && (canWrite(role) || t.created_by === userId || t.deleted_by === userId);

function publicTrash(t: TrashRow) {
  const who = (id: string | null) => (id ? (db.prepare('SELECT name FROM users WHERE id=?').get(id) as { name: string } | undefined)?.name ?? null : null);
  const kids = db.prepare('SELECT COUNT(*) n FROM trash WHERE parent=?').get(t.id) as { n: number };
  const f = t.kind === 'file' ? loadFileAny(t.app_id, t.record_id) : undefined;
  return {
    id: t.id, kind: t.kind, collection: t.collection, recordId: t.record_id, label: t.label, data: t.data ? JSON.parse(t.data) : null,
    createdBy: t.created_by, deletedBy: t.deleted_by, deletedByName: who(t.deleted_by), deletedAt: t.deleted_at, comments: kids.n,
    file: f ? publicFile(f) : null,
  };
}

export function registerTrash(app: FastifyInstance) {
  app.get('/api/apps/:id/trash', async (req) => {
    const { id } = req.params as { id: string };
    const { user, role } = access(req, id);
    const rows = db.prepare('SELECT * FROM trash WHERE app_id=? AND parent IS NULL ORDER BY deleted_at DESC LIMIT 1000').all(id) as TrashRow[];
    return { items: rows.filter((t) => mayFind(t, user.id, role)).map(publicTrash), canPurge: canWrite(role) };
  });

  const pick = (appId: string, ids: unknown): TrashRow[] => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some((x) => typeof x !== 'string')) throw new HttpError(400, 'VALIDATION_FAILED', 'Send the ids of the things to restore or delete.');
    return ids.map((tid) => db.prepare('SELECT * FROM trash WHERE id=? AND app_id=? AND parent IS NULL').get(tid, appId) as TrashRow | undefined).filter((t): t is TrashRow => !!t);
  };

  app.post('/api/apps/:id/trash/restore', async (req) => {
    const { id } = req.params as { id: string };
    const { user, role } = access(req, id, 'add');
    const items = pick(id, (req.body as { ids?: unknown } | null)?.ids).filter((t) => mayFind(t, user.id, role));
    const denied = items.filter((t) => !mayRestore(t, user.id, role));
    if (denied.length) throw new HttpError(403, 'FORBIDDEN', 'You can restore only what you added or deleted.');
    const restored: { kind: string; collection: string | null; record: RecordRow | null; fileId?: string }[] = [];
    const t = now();
    db.transaction(() => {
      for (const it of items) {
        if (it.kind === 'file') {
          db.prepare('UPDATE files SET deleted_at=NULL WHERE id=? AND app_id=?').run(it.record_id, id);
          restored.push({ kind: 'file', collection: null, record: null, fileId: it.record_id });
        } else {
          const group = [it, ...(db.prepare('SELECT * FROM trash WHERE parent=?').all(it.id) as TrashRow[])];
          for (const g of group) {
            if (db.prepare('SELECT 1 FROM records WHERE id=?').get(g.record_id)) continue; // already back
            db.prepare('INSERT INTO records(id,app_id,collection,data,rev,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
              .run(g.record_id, id, g.collection, g.data, (g.rev ?? 1) + 1, g.created_by, g.created_at ?? t, user.id, t);
            restored.push({ kind: 'record', collection: g.collection, record: db.prepare('SELECT * FROM records WHERE id=?').get(g.record_id) as RecordRow });
          }
          db.prepare('DELETE FROM trash WHERE parent=?').run(it.id);
        }
        db.prepare('DELETE FROM trash WHERE id=?').run(it.id);
        const title = it.collection ? (collectionDef(id, it.collection).def?.title ?? it.collection) : '';
        logActivity(id, user.id, it.kind === 'file' ? 'restored a file from Trash:' : `restored “${it.label || 'an item'}” from Trash to`, it.kind === 'file' ? it.label : title,
          { collection: it.collection ?? undefined, recordId: it.record_id, kind: 'create' });
      }
      db.prepare('UPDATE apps SET updated_at=? WHERE id=?').run(t, id);
    })();
    for (const r of restored) {
      if (r.kind === 'file' && r.fileId) {
        const f = loadFileAny(id, r.fileId);
        if (f) publish(id, 'file', { op: 'create', file: publicFile(f) }, undefined, (uid, rl) => canReadFile(f, uid, rl));
      } else if (r.record) {
        const rec = r.record;
        const def = collectionDef(id, rec.collection).def;
        publish(id, 'record', { collection: rec.collection, op: 'create', record: { id: rec.id, collection: rec.collection, data: JSON.parse(rec.data), revision: rec.rev, createdBy: rec.created_by, createdAt: rec.created_at, updatedBy: rec.updated_by, updatedAt: rec.updated_at }, by: { id: user.id, name: user.name } },
          undefined, (uid, rl) => visibleTo(rec, def, uid, rl));
      }
    }
    publish(id, 'trash', { op: 'restore' });
    return { ok: true, restored: items.length };
  });

  app.post('/api/apps/:id/trash/purge', async (req) => {
    const { id } = req.params as { id: string };
    const { user, role } = access(req, id, 'write');
    const body = (req.body ?? {}) as { ids?: unknown; all?: boolean };
    const items = body.all
      ? (db.prepare('SELECT * FROM trash WHERE app_id=? AND parent IS NULL').all(id) as TrashRow[])
      : pick(id, body.ids);
    db.transaction(() => {
      for (const it of items) {
        if (it.kind === 'file') {
          const f = loadFileAny(id, it.record_id);
          if (f && f.deleted_at) purgeFile(f);
        }
        db.prepare('DELETE FROM trash WHERE parent=?').run(it.id);
        db.prepare('DELETE FROM trash WHERE id=?').run(it.id);
      }
      if (items.length) logActivity(id, user.id, items.length === 1 ? `deleted “${items[0].label || 'an item'}” for good` : `deleted ${items.length} things for good`, '', { kind: 'delete' });
    })();
    void role;
    publish(id, 'trash', { op: 'purge' });
    return { ok: true, deleted: items.length };
  });
}
