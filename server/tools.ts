import type { FastifyInstance } from 'fastify';
import { db, newId, now } from './db.js';
import { HttpError, requireUser } from './auth.js';
import { limit } from './security.js';
import { notify } from './plans.js';

/*
 * Quick tools: a person's own tasks, notes, contacts, calendar events and subscription/trial reminders.
 * One table; each item's fields live in `data` (JSON). `due_at` drives the "Your day" card and reminders;
 * `remind_at` is when a notification goes out (once). Text tools, the QR maker and the focus timer need no
 * server: they run in the browser.
 */
const KINDS = ['task', 'note', 'contact', 'event', 'sub'] as const;
type Kind = (typeof KINDS)[number];
const LABEL: Record<Kind, string> = { task: 'Task', note: 'Note', contact: 'Contact', event: 'Event', sub: 'Subscription' };

db.exec(`CREATE TABLE IF NOT EXISTS tool_items (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  due_at TEXT, remind_at TEXT, reminded_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tool_items_user ON tool_items(user_id, kind);
CREATE INDEX IF NOT EXISTS tool_items_remind ON tool_items(remind_at) WHERE reminded_at IS NULL;
CREATE TABLE IF NOT EXISTS user_pins (user_id TEXT PRIMARY KEY, ids TEXT NOT NULL, updated_at TEXT NOT NULL);`);

interface Row { id: string; kind: Kind; data: string; done: number; pinned: number; archived: number; due_at: string | null; remind_at: string | null; created_at: string; updated_at: string; created_by: string; updated_by: string }
const names = db.prepare('SELECT COALESCE(NULLIF(display_name,\'\'), name) n FROM users WHERE id=?');
const who = (id: string) => (names.get(id) as { n: string } | undefined)?.n ?? '';
const out = (r: Row) => ({
  id: r.id, kind: r.kind, ...JSON.parse(r.data), done: !!r.done, pinned: !!r.pinned, archived: !!r.archived,
  dueAt: r.due_at, remindAt: r.remind_at, createdAt: r.created_at, updatedAt: r.updated_at, createdBy: who(r.created_by), updatedBy: who(r.updated_by),
});

const kindOf = (k: string): Kind => { if (!(KINDS as readonly string[]).includes(k)) throw new HttpError(404, 'NOT_FOUND', 'No such tool.'); return k as Kind; };
const iso = (v: unknown, field: string) => {
  if (v === null || v === undefined || v === '') return null;
  const t = Date.parse(String(v));
  if (Number.isNaN(t)) throw new HttpError(400, 'VALIDATION_FAILED', `${field} is not a valid date.`);
  return new Date(t).toISOString();
};
/** Only plain, short fields are kept (strings, numbers, booleans, lists of ids). */
function clean(d: unknown) {
  const o: Record<string, unknown> = {};
  if (d && typeof d === 'object') for (const [k, v] of Object.entries(d)) {
    if (!/^[a-zA-Z]{1,24}$/.test(k) || ['id', 'kind', 'done', 'pinned', 'archived', 'dueAt', 'remindAt'].includes(k)) continue;
    if (typeof v === 'string') o[k] = v.slice(0, k === 'body' ? 20000 : 500);
    else if (typeof v === 'number' && Number.isFinite(v)) o[k] = v;
    else if (typeof v === 'boolean') o[k] = v;
    else if (Array.isArray(v)) o[k] = v.filter((x) => typeof x === 'string').slice(0, 20).map((x) => String(x).slice(0, 40));
  }
  if (JSON.stringify(o).length > 40000) throw new HttpError(413, 'TOO_LARGE', 'That is too long.');
  return o;
}
const title = (d: Record<string, unknown>) => String(d.title ?? d.name ?? d.service ?? '').trim();

export function registerTools(app: FastifyInstance) {
  app.get('/api/tools/:kind', async (req) => {
    const u = requireUser(req);
    const kind = kindOf((req.params as { kind: string }).kind);
    const rows = db.prepare('SELECT * FROM tool_items WHERE user_id=? AND kind=? ORDER BY pinned DESC, done ASC, COALESCE(due_at, updated_at) ASC LIMIT 1000').all(u.id, kind) as Row[];
    return { items: rows.map(out) };
  });

  app.post('/api/tools/:kind', async (req) => {
    const u = requireUser(req);
    limit(req, 'tools-write', 600, 3600_000, u.id);
    const kind = kindOf((req.params as { kind: string }).kind);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const data = clean(b);
    if (!title(data) && kind !== 'note') throw new HttpError(400, 'VALIDATION_FAILED', `Give the ${LABEL[kind].toLowerCase()} a name.`);
    if (kind === 'note' && !title(data) && !String(data.body ?? '').trim()) throw new HttpError(400, 'VALIDATION_FAILED', 'Write something first.');
    const count = (db.prepare('SELECT COUNT(*) n FROM tool_items WHERE user_id=?').get(u.id) as { n: number }).n;
    if (count >= 5000) throw new HttpError(403, 'LIMIT', 'You have 5,000 items. Delete some first.');
    const t = now(), id = newId('tl');
    db.prepare('INSERT INTO tool_items(id,user_id,kind,data,pinned,due_at,remind_at,created_at,updated_at,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, u.id, kind, JSON.stringify(data), b.pinned ? 1 : 0, iso(b.dueAt, 'Date'), iso(b.remindAt, 'Reminder'), t, t, u.id, u.id);
    return { item: out(db.prepare('SELECT * FROM tool_items WHERE id=?').get(id) as Row) };
  });

  app.patch('/api/tools/:kind/:id', async (req) => {
    const u = requireUser(req);
    limit(req, 'tools-write', 600, 3600_000, u.id);
    const { kind, id } = req.params as { kind: string; id: string };
    const r = db.prepare('SELECT * FROM tool_items WHERE id=? AND user_id=? AND kind=?').get(id, u.id, kindOf(kind)) as Row | undefined;
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const data = { ...JSON.parse(r.data), ...clean(b) };
    const flag = (k: string, cur: number) => (typeof b[k] === 'boolean' ? (b[k] ? 1 : 0) : cur);
    const due = 'dueAt' in b ? iso(b.dueAt, 'Date') : r.due_at;
    const remind = 'remindAt' in b ? iso(b.remindAt, 'Reminder') : r.remind_at;
    db.prepare('UPDATE tool_items SET data=?, done=?, pinned=?, archived=?, due_at=?, remind_at=?, reminded_at=CASE WHEN ? THEN NULL ELSE reminded_at END, updated_at=?, updated_by=? WHERE id=?')
      .run(JSON.stringify(data), flag('done', r.done), flag('pinned', r.pinned), flag('archived', r.archived), due, remind, remind !== r.remind_at ? 1 : 0, now(), u.id, r.id);
    return { item: out(db.prepare('SELECT * FROM tool_items WHERE id=?').get(r.id) as Row) };
  });

  app.delete('/api/tools/:kind/:id', async (req) => {
    const u = requireUser(req);
    const { kind, id } = req.params as { kind: string; id: string };
    db.prepare('DELETE FROM tool_items WHERE id=? AND user_id=? AND kind=?').run(id, u.id, kindOf(kind));
    return { ok: true };
  });

  /** "Your day": open tasks due by tomorrow, today's and tomorrow's events, subscriptions ending within a week. */
  app.get('/api/tools-today', async (req) => {
    const u = requireUser(req);
    const end = (days: number) => { const d = new Date(); d.setHours(23, 59, 59, 999); d.setDate(d.getDate() + days); return d.toISOString(); };
    const q = (kind: Kind, until: string, from?: string) => (db.prepare(`SELECT * FROM tool_items WHERE user_id=? AND kind=? AND done=0 AND archived=0 AND due_at IS NOT NULL AND due_at<=? ${from ? 'AND due_at>=?' : ''} ORDER BY due_at LIMIT 20`)
      .all(...[u.id, kind, until, ...(from ? [from] : [])]) as Row[]).map(out);
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    return { tasks: q('task', end(1)), events: q('event', end(1), startToday.toISOString()), subs: q('sub', end(7)), openTasks: (db.prepare("SELECT COUNT(*) n FROM tool_items WHERE user_id=? AND kind='task' AND done=0 AND archived=0").get(u.id) as { n: number }).n };
  });

  /** Pinned apps on the Home dashboard, in the person's own order. Only apps they can open are kept. */
  app.get('/api/home/pins', async (req) => {
    const u = requireUser(req);
    const r = db.prepare('SELECT ids FROM user_pins WHERE user_id=?').get(u.id) as { ids: string } | undefined;
    return { ids: r ? (JSON.parse(r.ids) as string[]) : [] };
  });
  app.put('/api/home/pins', async (req) => {
    const u = requireUser(req);
    limit(req, 'tools-write', 600, 3600_000, u.id);
    const raw = (req.body as { ids?: unknown })?.ids;
    const ids = [...new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && /^[\w-]{1,64}$/.test(x)) : [])].slice(0, 24);
    const mine = new Set((db.prepare('SELECT id FROM apps WHERE owner_id=? UNION SELECT app_id FROM memberships WHERE user_id=?').all(u.id, u.id) as { id: string }[]).map((x) => x.id));
    const keep = ids.filter((id) => mine.has(id));
    db.prepare('INSERT INTO user_pins(user_id, ids, updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET ids=excluded.ids, updated_at=excluded.updated_at').run(u.id, JSON.stringify(keep), now());
    return { ids: keep };
  });

  // Reminders: one notification (in the bell, and by email if they allow account emails) when remind_at passes.
  const sweep = () => {
    const due = db.prepare('SELECT * FROM tool_items WHERE reminded_at IS NULL AND remind_at IS NOT NULL AND remind_at<=? AND done=0 AND archived=0 LIMIT 200').all(now()) as (Row & { user_id: string })[];
    for (const r of due) {
      const d = JSON.parse(r.data) as Record<string, unknown>;
      const when = r.due_at ? new Date(r.due_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' }) : '';
      notify(r.user_id, 'account', `${LABEL[r.kind]}: ${title(d) || 'Reminder'}`, [r.kind === 'sub' ? (when ? `Renews or ends ${when}.` : '') : when ? `Due ${when}.` : '', d.cancelUrl ? `Cancel: ${d.cancelUrl}` : ''].filter(Boolean).join(' '), null);
      db.prepare('UPDATE tool_items SET reminded_at=? WHERE id=?').run(now(), r.id);
    }
  };
  setInterval(sweep, 60_000).unref();
}
