import type { FastifyInstance } from 'fastify';
import { db, type Role } from './db.js';
import { HttpError, requireUser } from './auth.js';
import { access } from './apps.js';
import { collectionDef, visibleTo, type RecordRow } from './data.js';
import { canReadFile, loadFile } from './files.js';
import { setActivityFilter } from './realtime.js';

/*
 * The activity log of an app: who did what, pointing at the item it is about.
 * Lines about private items ("own" sections) and private files are shown only to people who can see them.
 */

export interface ActivityRow {
  id: number; action: string; detail: string; at: string; name: string | null; userId: string | null;
  collection: string | null; recordId: string | null; kind: string | null; note: string | null;
}

const SELECT = `SELECT a.id, a.action, a.detail, a.at, u.name, a.user_id userId, a.collection, a.record_id recordId, a.kind, a.note
  FROM activity a LEFT JOIN users u ON u.id=a.user_id`;

export function activityVisible(appId: string, row: Pick<ActivityRow, 'collection' | 'recordId' | 'kind'>, userId: string, role: Role): boolean {
  if (row.kind === 'file' && row.recordId) {
    const f = loadFile(appId, row.recordId);
    return !f || canReadFile(f, userId, role);
  }
  if (!row.collection) return true;
  const { def } = collectionDef(appId, row.collection);
  if (!def || def.visibility !== 'own') return true;
  const r = row.recordId ? db.prepare('SELECT * FROM records WHERE id=? AND app_id=?').get(row.recordId, appId) as RecordRow | undefined : undefined;
  return !!r && visibleTo(r, def, userId, role);
}

export function registerActivity(app: FastifyInstance) {
  /** For the My apps page: new activity by others in each app, and the latest line each person may see. */
  app.get('/api/activity/summary', async (req) => {
    const user = requireUser(req);
    const apps = db.prepare('SELECT m.app_id, m.role, m.seen_activity FROM memberships m JOIN apps a ON a.id=m.app_id WHERE m.user_id=? AND a.deleted_at IS NULL').all(user.id) as { app_id: string; role: Role; seen_activity: number }[];
    const out: Record<string, { unread: number; last: ActivityRow | null; lastNew: ActivityRow | null }> = {};
    for (const m of apps) {
      const rows = db.prepare(SELECT + ' WHERE a.app_id=? ORDER BY a.id DESC LIMIT 120').all(m.app_id) as ActivityRow[];
      const vis = rows.filter((r) => activityVisible(m.app_id, r, user.id, m.role));
      const fresh = vis.filter((r) => r.id > m.seen_activity && r.userId !== user.id);
      const work = (r: ActivityRow) => !!(r.collection || r.kind);
      out[m.app_id] = { unread: fresh.length, last: vis.find(work) ?? vis[0] ?? null, lastNew: fresh.find(work) ?? fresh[0] ?? null };
    }
    return { apps: out };
  });

  const isVisitor = (userId: string) => (db.prepare('SELECT kind FROM users WHERE id=?').get(userId) as { kind: string } | undefined)?.kind === 'visitor';
  setActivityFilter((appId, row, userId, role) => (!!(row as { collection?: string }).collection || !isVisitor(userId)) && activityVisible(appId, row as unknown as ActivityRow, userId, role));

  app.get('/api/apps/:id/activity', async (req) => {
    const { id } = req.params as { id: string };
    const { user, role } = access(req, id);
    const q = req.query as { limit?: string; before?: string };
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 100));
    const before = Number(q.before) || Number.MAX_SAFE_INTEGER;
    const out: ActivityRow[] = [];
    let cursor = before;
    // Read in pages until enough visible lines are found (private lines are skipped).
    for (let i = 0; i < 10 && out.length < limit; i++) {
      const rows = db.prepare(`${SELECT} WHERE a.app_id=? AND a.id<? ORDER BY a.id DESC LIMIT 200`).all(id, cursor) as ActivityRow[];
      if (!rows.length) break;
      // Link visitors see what happened to the app's content, not who was added or how it is shared.
      for (const r of rows) if (out.length < limit && activityVisible(id, r, user.id, role) && (!req.pub || r.collection)) out.push(r);
      cursor = rows[rows.length - 1].id;
    }
    const seen = (db.prepare('SELECT seen_activity n FROM memberships WHERE app_id=? AND user_id=?').get(id, user.id) as { n: number } | undefined)?.n ?? 0;
    return { activity: out, seen, me: user.id };
  });

  /** Mark activity as seen up to a line id (never goes backwards). */
  app.post('/api/apps/:id/activity/seen', async (req) => {
    const { id } = req.params as { id: string };
    const { user } = access(req, id);
    const upTo = Number((req.body as { upTo?: unknown } | null)?.upTo);
    if (!Number.isInteger(upTo) || upTo < 0) throw new HttpError(400, 'VALIDATION_FAILED', 'Send the id of the newest line you have seen.');
    db.prepare('UPDATE memberships SET seen_activity=MAX(seen_activity, ?) WHERE app_id=? AND user_id=?').run(upTo, id, user.id);
    return { ok: true };
  });
}
