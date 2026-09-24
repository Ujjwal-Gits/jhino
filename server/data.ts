import type { FastifyInstance } from 'fastify';
import { config } from './config.js';
import { db, newId, now, logActivity, roleOf, canWrite, type Role, type ActivityExtra } from './db.js';
import { validateRecord, type CollectionDef, type Manifest, type ValidateContext } from './manifest.js';
import { HttpError } from './auth.js';
import { access } from './apps.js';
import { publish } from './realtime.js';

type Ns = 'ls' | 'ws';
type Pair = [string | null, number];
interface Scoped { s: Record<string, Pair>; p: Record<string, Pair> }

/** Everything an app needs at start: shared keys plus this person's private keys. */
export function snapshotFor(appId: string, userId: string): Record<Ns, Scoped> {
  const out: Record<Ns, Scoped> = { ls: { s: {}, p: {} }, ws: { s: {}, p: {} } };
  const rows = db.prepare(`SELECT ns, scope, key, value, rev FROM kv WHERE app_id=? AND (scope='' OR scope=?)`).all(appId, userId) as
    { ns: Ns; scope: string; key: string; value: string | null; rev: number }[];
  for (const r of rows) {
    if (!out[r.ns]) continue;
    out[r.ns][r.scope ? 'p' : 's'][r.key] = [r.value, r.rev];
  }
  return out;
}

const COLLECTION = /^[A-Za-z0-9_-]{1,64}$/;
const bad = (msg: string, extra: Record<string, unknown> = {}) => new HttpError(400, 'VALIDATION_FAILED', msg, extra);

function checkNs(ns: unknown): Ns {
  if (ns !== 'ls' && ns !== 'ws') throw bad('Unknown storage type.');
  return ns;
}

function appBytes(appId: string) {
  const kv = (db.prepare('SELECT COALESCE(SUM(length(value)),0) n FROM kv WHERE app_id=?').get(appId) as { n: number }).n;
  const rec = (db.prepare('SELECT COALESCE(SUM(length(data)),0) n FROM records WHERE app_id=?').get(appId) as { n: number }).n;
  return kv + rec;
}
function checkQuota(appId: string, adding: number) {
  if (appBytes(appId) + adding > config.limits.appDataBytes) {
    throw new HttpError(413, 'QUOTA_EXCEEDED', 'This app has reached its storage limit.');
  }
}

export interface RecordRow { id: string; collection: string; data: string; rev: number; created_by: string; created_at: string; updated_by: string; updated_at: string }
const toRecord = (r: RecordRow) => ({
  id: r.id, collection: r.collection, data: JSON.parse(r.data), revision: r.rev,
  createdBy: r.created_by, createdAt: r.created_at, updatedBy: r.updated_by, updatedAt: r.updated_at,
});

function checkRecordData(d: unknown): string {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw bad('Record data must be an object.');
  const s = JSON.stringify(d);
  if (s.length > config.limits.recordBytes) throw new HttpError(413, 'QUOTA_EXCEEDED', 'That record is too large.');
  return s;
}

export function registerData(app: FastifyInstance) {
  /* ---------------- key/value (localStorage + window.storage) ---------------- */
  app.get('/api/apps/:id/kv', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = access(req, id);
    return { data: snapshotFor(id, user.id) };
  });

  app.put('/api/apps/:id/kv', async (req) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { ns?: string; scope?: string; key?: unknown; value?: unknown; baseRev?: unknown; clientId?: string };
    const priv = b.scope === 'private';
    const { user } = access(req, id, priv ? 'read' : 'write');
    const ns = checkNs(b.ns);
    if (typeof b.key !== 'string' || !b.key.length || b.key.length > 512) throw bad('Keys must be 1 to 512 characters.');
    if (b.value !== null && typeof b.value !== 'string') throw bad('Values must be text.');
    const value = b.value as string | null;
    if (value && value.length > config.limits.valueBytes) throw new HttpError(413, 'QUOTA_EXCEEDED', 'That value is too large to save.');
    const baseRev = Number(b.baseRev ?? 0);
    const scope = priv ? user.id : '';

    const result = db.transaction(() => {
      const cur = db.prepare('SELECT value, rev FROM kv WHERE app_id=? AND ns=? AND scope=? AND key=?').get(id, ns, scope, b.key) as { value: string | null; rev: number } | undefined;
      const curRev = cur?.rev ?? 0;
      if (baseRev !== curRev) return { conflict: true as const, value: cur?.value ?? null, rev: curRev };
      if ((cur?.value ?? null) === value) return { conflict: false as const, rev: curRev, changed: false };
      if (value) checkQuota(id, value.length - (cur?.value?.length ?? 0));
      const rev = curRev + 1;
      db.prepare(`INSERT INTO kv(app_id,ns,scope,key,value,rev,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(app_id,ns,scope,key) DO UPDATE SET value=excluded.value, rev=excluded.rev, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
        .run(id, ns, scope, b.key, value, rev, user.id, now());
      if (!priv) {
        db.prepare('UPDATE apps SET updated_at=? WHERE id=?').run(now(), id);
        logActivity(id, user.id, 'saved changes');
      }
      return { conflict: false as const, rev, changed: true };
    })();

    if (result.conflict) {
      throw new HttpError(409, 'REVISION_CONFLICT', 'Someone else changed this first.', { value: result.value, rev: result.rev });
    }
    if (result.changed) {
      publish(id, 'kv', { ns, scope: priv ? 'private' : 'shared', key: b.key, value, rev: result.rev, by: { id: user.id, name: user.name }, clientId: b.clientId ?? null }, priv ? user.id : undefined);
    }
    return { ok: true, rev: result.rev };
  });

  /* ---------------- records (Jhino SDK and built apps) ---------------- */
  const col = (c: string) => { if (!COLLECTION.test(c)) throw bad('Collection names use letters, numbers, - and _ (up to 64).'); return c; };

  app.get('/api/apps/:id/records/:col', async (req) => {
    const { id, col: c } = req.params as { id: string; col: string };
    const { user, role } = access(req, id);
    const { def } = collectionDef(id, col(c));
    const q = req.query as { limit?: string; after?: string };
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 500);
    const own = def?.visibility === 'own' && !canWrite(role);
    const ownSql = own ? ' AND (created_by = @me OR EXISTS (SELECT 1 FROM json_each(records.data) j WHERE j.value = @me))' : '';
    let rows: RecordRow[];
    if (q.after) {
      const [at, rid] = Buffer.from(q.after, 'base64url').toString().split('|');
      rows = db.prepare(`SELECT * FROM records WHERE app_id=@app AND collection=@col${ownSql} AND (created_at, id) > (@at, @rid) ORDER BY created_at, id LIMIT @lim`)
        .all({ app: id, col: c, me: user.id, at, rid, lim: limit + 1 }) as RecordRow[];
    } else {
      rows = db.prepare(`SELECT * FROM records WHERE app_id=@app AND collection=@col${ownSql} ORDER BY created_at, id LIMIT @lim`)
        .all({ app: id, col: c, me: user.id, lim: limit + 1 }) as RecordRow[];
    }
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return { items: items.map(toRecord), next: more && last ? Buffer.from(`${last.created_at}|${last.id}`).toString('base64url') : null };
  });

  app.get('/api/apps/:id/records/:col/:rid', async (req) => {
    const { id, col: c, rid } = req.params as { id: string; col: string; rid: string };
    const { user, role } = access(req, id);
    const r = db.prepare('SELECT * FROM records WHERE id=? AND app_id=? AND collection=?').get(rid, id, col(c)) as RecordRow | undefined;
    if (!r || !visibleTo(r, collectionDef(id, c).def, user.id, role)) throw new HttpError(404, 'NOT_FOUND', 'Record not found.');
    return { record: toRecord(r) };
  });

  app.post('/api/apps/:id/records/:col', async (req) => {
    const { id, col: c } = req.params as { id: string; col: string };
    const { user, role } = access(req, id, 'add');
    const b = (req.body ?? {}) as { data?: unknown; idempotencyKey?: string; clientId?: string };
    const { def, strict } = collectionDef(id, col(c));
    if (!def && strict) throw bad(`This app does not have a collection called "${c}".`);
    if (def?.create === 'editors' && !canWrite(role)) throw new HttpError(403, 'FORBIDDEN', 'Only people who can edit can add items here.');
    if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) throw bad('Record data must be an object.');
    const clean = def ? validateRecord(def, b.data as Record<string, unknown>, null, ctxFor(id, role, true)) : (b.data as Record<string, unknown>);
    const data = checkRecordData(clean);
    const ik = typeof b.idempotencyKey === 'string' && b.idempotencyKey.length <= 100 ? `${id}:${b.idempotencyKey}` : null;
    const out = db.transaction(() => {
      if (ik) {
        const seen = db.prepare('SELECT record_id FROM idempotency WHERE user_id=? AND key=?').get(user.id, ik) as { record_id: string } | undefined;
        const prior = seen && (db.prepare('SELECT * FROM records WHERE id=?').get(seen.record_id) as RecordRow | undefined);
        if (prior) return { row: prior, created: false };
      }
      checkQuota(id, data.length);
      const rid = newId('rec');
      const t = now();
      db.prepare('INSERT INTO records(id,app_id,collection,data,rev,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,1,?,?,?,?)')
        .run(rid, id, c, data, user.id, t, user.id, t);
      if (ik) db.prepare('INSERT OR REPLACE INTO idempotency(user_id,key,record_id,created_at) VALUES(?,?,?,?)').run(user.id, ik, rid, t);
      db.prepare('UPDATE apps SET updated_at=? WHERE id=?').run(t, id);
      const act = activityFor(id, c, def, 'create', clean, null, rid);
      logActivity(id, user.id, act.action, act.detail, act.extra);
      return { row: db.prepare('SELECT * FROM records WHERE id=?').get(rid) as RecordRow, created: true };
    })();
    const record = toRecord(out.row);
    if (out.created) publish(id, 'record', { collection: c, op: 'create', record, by: { id: user.id, name: user.name }, clientId: b.clientId ?? null }, undefined, (uid, r) => visibleTo(out.row, def, uid, r));
    return { record };
  });

  app.patch('/api/apps/:id/records/:col/:rid', async (req) => {
    const { id, col: c, rid } = req.params as { id: string; col: string; rid: string };
    const { user, role } = access(req, id, 'add');
    const b = (req.body ?? {}) as { data?: Record<string, unknown>; expectedRevision?: number; clientId?: string };
    if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) throw bad('Send the fields to change as an object.');
    const { def } = collectionDef(id, col(c));
    const row = db.transaction(() => {
      const cur = db.prepare('SELECT * FROM records WHERE id=? AND app_id=? AND collection=?').get(rid, id, c) as RecordRow | undefined;
      if (!cur || !visibleTo(cur, def, user.id, role)) throw new HttpError(404, 'NOT_FOUND', 'Record not found.');
      if (!mayChange(cur, user.id, role, def)) throw new HttpError(403, 'FORBIDDEN', 'You can only change items you added or that are assigned to you.');
      if (b.expectedRevision !== undefined && b.expectedRevision !== null && Number(b.expectedRevision) !== cur.rev) {
        throw new HttpError(409, 'REVISION_CONFLICT', 'Someone else changed this first.', { record: toRecord(cur) });
      }
      const prev = JSON.parse(cur.data) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...prev, ...b.data };
      for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
      const clean = def ? validateRecord(def, merged, prev, ctxFor(id, role, false)) : merged;
      const data = checkRecordData(clean);
      if (data === cur.data) return cur;
      checkQuota(id, data.length - cur.data.length);
      db.prepare('UPDATE records SET data=?, rev=rev+1, updated_by=?, updated_at=? WHERE id=?').run(data, user.id, now(), rid);
      db.prepare('UPDATE apps SET updated_at=? WHERE id=?').run(now(), id);
      const act = activityFor(id, c, def, 'update', clean, prev, rid);
      logActivity(id, user.id, act.action, act.detail, act.extra);
      return db.prepare('SELECT * FROM records WHERE id=?').get(rid) as RecordRow;
    })();
    const record = toRecord(row);
    publish(id, 'record', { collection: c, op: 'update', record, by: { id: user.id, name: user.name }, clientId: b.clientId ?? null }, undefined, (uid, r) => visibleTo(row, def, uid, r));
    return { record };
  });

  app.delete('/api/apps/:id/records/:col/:rid', async (req) => {
    const { id, col: c, rid } = req.params as { id: string; col: string; rid: string };
    const { user, role } = access(req, id, 'add');
    const q = req.query as { expectedRevision?: string; clientId?: string };
    const { def } = collectionDef(id, col(c));
    const gone = db.transaction(() => {
      const cur = db.prepare('SELECT * FROM records WHERE id=? AND app_id=? AND collection=?').get(rid, id, c) as RecordRow | undefined;
      if (!cur || !visibleTo(cur, def, user.id, role)) throw new HttpError(404, 'NOT_FOUND', 'Record not found.');
      if (!canWrite(role) && cur.created_by !== user.id) throw new HttpError(403, 'FORBIDDEN', 'You can only delete items you added.');
      if (q.expectedRevision !== undefined && Number(q.expectedRevision) !== cur.rev) throw new HttpError(409, 'REVISION_CONFLICT', 'Someone else changed this first.', { record: toRecord(cur) });
      trashRecord(id, cur, user.id);
      logActivity(id, user.id, `moved ${label(JSON.parse(cur.data))}to Trash from`, def?.title ?? c, { collection: c, recordId: rid, kind: 'delete' });
      return cur;
    })();
    publish(id, 'record', { collection: c, op: 'delete', record: { id: rid, collection: c }, by: { id: user.id, name: user.name }, clientId: q.clientId ?? null }, undefined, (uid, r) => visibleTo(gone, def, uid, r));
    publish(id, 'trash', { op: 'delete' });
    return { ok: true };
  });
}

/* ---------------- helpers shared with files ---------------- */
const manifestCache = new Map<string, Manifest | null>();
export function liveManifest(appId: string): Manifest | null {
  const v = db.prepare('SELECT v.n, v.manifest FROM app_versions v JOIN apps a ON a.id=v.app_id AND v.n=a.live_version WHERE a.id=?').get(appId) as { n: number; manifest: string | null } | undefined;
  if (!v) return null;
  const key = `${appId}:${v.n}`;
  if (!manifestCache.has(key)) manifestCache.set(key, v.manifest ? (JSON.parse(v.manifest) as Manifest) : null);
  return manifestCache.get(key)!;
}
export function collectionDef(appId: string, c: string): { def: CollectionDef | null; strict: boolean } {
  const cols = liveManifest(appId)?.collections;
  return { def: cols?.[c] ?? null, strict: !!cols };
}
export function hasOwnVisibility(appId: string) {
  const cols = liveManifest(appId)?.collections;
  return !!cols && Object.values(cols).some((c) => c.visibility === 'own');
}
function mentions(data: unknown, userId: string): boolean {
  if (!data || typeof data !== 'object') return false;
  return Object.values(data as Record<string, unknown>).some((v) => v === userId || (Array.isArray(v) && v.includes(userId)));
}
/** "own" collections: people who cannot edit see only what they added or are named in. */
export function visibleTo(r: RecordRow, def: CollectionDef | null, userId: string, role: Role): boolean {
  if (!def || def.visibility !== 'own' || canWrite(role)) return true;
  return r.created_by === userId || mentions(JSON.parse(r.data), userId);
}
/** "Can add" people may change what they added or what names them (for example as assignee or signer). */
function mayChange(r: RecordRow, userId: string, role: Role, def?: CollectionDef | null): boolean {
  if (canWrite(role)) return true;
  if (role !== 'contributor') return false;
  if (def?.create === 'editors' && !mentions(JSON.parse(r.data), userId)) return false;
  return r.created_by === userId || mentions(JSON.parse(r.data), userId);
}
function ctxFor(appId: string, role: Role, isCreate: boolean): ValidateContext {
  return {
    isCreate,
    canProtected: canWrite(role),
    isMember: (uid) => !!roleOf(appId, uid),
    isFile: (fid) => !!db.prepare('SELECT 1 FROM files WHERE id=? AND app_id=? AND deleted_at IS NULL').get(fid, appId),
  };
}
/**
 * How a record change reads in the activity log, and which item it points at.
 * "<collection>_comments" and "<collection>_votes" (made by the app builder) count as activity on their parent item.
 */
function activityFor(appId: string, c: string, def: CollectionDef | null, op: 'create' | 'update', data: Record<string, unknown>, prev: Record<string, unknown> | null, rid: string):
  { action: string; detail: string; extra: ActivityExtra } {
  const title = def?.title ?? c;
  const sub = /^(.+)_(comments|votes)$/.exec(c);
  if (sub && op === 'create') {
    const parentCol = sub[1];
    const parentId = String((sub[2] === 'comments' ? data.rec : data.poll) ?? '');
    const parent = db.prepare('SELECT * FROM records WHERE id=? AND app_id=? AND collection=?').get(parentId, appId, parentCol) as RecordRow | undefined;
    const parentTitle = collectionDef(appId, parentCol).def?.title ?? parentCol;
    const pl = parent ? label(JSON.parse(parent.data)) : '';
    if (sub[2] === 'comments') {
      return { action: `commented on ${pl}in`, detail: parentTitle, extra: { collection: parentCol, recordId: parentId, kind: 'comment', note: typeof data.body === 'string' ? data.body : undefined } };
    }
    return { action: `voted on ${pl}in`, detail: parentTitle, extra: { collection: parentCol, recordId: parentId, kind: 'vote' } };
  }
  if (op === 'create') return { action: `added ${label(data)}to`, detail: title, extra: { collection: c, recordId: rid, kind: 'create' } };
  // A changed status reads as a move; a client pick as a mark; ticking something done as completing it.
  if (prev && def) {
    for (const [k, f] of Object.entries(def.fields)) {
      if (data[k] === prev[k] || data[k] === undefined || data[k] === null) continue;
      if (f.type === 'select' && k === 'pick') return { action: `marked ${label(data)}“${data[k]}” in`, detail: title, extra: { collection: c, recordId: rid, kind: 'status' } };
      if (f.type === 'select' && (k === 'status' || k === 'shot' || k === 'sample')) return { action: `moved ${label(data)}to ${data[k]} in`, detail: title, extra: { collection: c, recordId: rid, kind: 'status' } };
      if (f.type === 'boolean' && k === 'done' && data[k] === true) return { action: `completed ${label(data)}in`, detail: title, extra: { collection: c, recordId: rid, kind: 'status' } };
    }
  }
  return { action: `updated ${label(data)}in`, detail: title, extra: { collection: c, recordId: rid, kind: 'update' } };
}

/**
 * Move a record to Trash, with the comments and votes that belong to it, so a restore brings everything back.
 * Returns the trash id. Runs inside the caller's transaction.
 */
export function trashRecord(appId: string, r: RecordRow, userId: string, parent: string | null = null): string {
  const tid = newId('tr');
  const data = JSON.parse(r.data) as Record<string, unknown>;
  db.prepare('INSERT INTO trash(id,app_id,kind,collection,record_id,data,rev,created_by,created_at,updated_by,updated_at,label,parent,deleted_by,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(tid, appId, 'record', r.collection, r.id, r.data, r.rev, r.created_by, r.created_at, r.updated_by, r.updated_at, label(data).replace(/[“”]/g, '').trim(), parent, userId, now());
  db.prepare('DELETE FROM records WHERE id=?').run(r.id);
  if (!parent) {
    const kids = db.prepare(`SELECT * FROM records WHERE app_id=? AND ((collection=? AND json_extract(data,'$.rec')=?) OR (collection=? AND json_extract(data,'$.poll')=?))`)
      .all(appId, r.collection + '_comments', r.id, r.collection + '_votes', r.id) as RecordRow[];
    for (const k of kids) trashRecord(appId, k, userId, tid);
  }
  return tid;
}
export { label as recordLabel };

/** A short, human label for activity lines: the first text value of the record. */
function label(data: Record<string, unknown>) {
  const v = Object.values(data).find((x) => typeof x === 'string' && x.trim() && !/^(u|f|rec)_/.test(x) && x.length < 200) as string | undefined;
  return v ? `“${v.trim().slice(0, 60)}” ` : '';
}
