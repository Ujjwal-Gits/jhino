import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { config } from './config.js';
import { db } from './db.js';
import { requireAdmin } from './auth.js';
import { purgeFile, type FileRow } from './files.js';
import { appDir } from './packages.js';
import { publish, openStreams } from './realtime.js';
import { setting, setSetting } from './security.js';

/*
 * The janitor: what Jhino keeps, and for how long. One place for every retention rule.
 *
 * Every hour it removes what has expired (sessions, one-time codes, run tokens...). Once a night (21:00
 * UTC, about 3 am in Nepal; JANITOR_HOUR_UTC changes it) it does the heavier work: old history, old app
 * versions, Trash, orphan files on disk, then PRAGMA optimize and a WAL checkpoint.
 *
 * Deletes run in small steps (at most 5,000 rows per statement, with a pause after each) so the server
 * keeps answering requests while it works. Every rule below says what it removes; everything not listed
 * is people's own data and is never removed automatically: users, apps (also in Trash: the Trash screen
 * promises "kept until you delete it for good"), app data (records, kv), files, payments, subscriptions,
 * profiles and their items, short links, smart links, ask questions, tool items, support requests.
 *
 * Turn it off with JANITOR=0. Super admins see its last runs at GET /api/admin/janitor.
 */

const DAY = 864e5;
const STEP = 5000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const dayOf = (msAgo: number) => iso(msAgo).slice(0, 10);
const pause = (ms = 2) => new Promise<void>((ok) => setTimeout(ok, ms));

/** How long things are kept. Shown to super admins with the janitor's report. */
export const RULES = {
  sessions: 'deleted when expired (web sessions last 60 days and renew while used)',
  runs: 'app launch tokens: deleted when expired',
  pub_sessions: 'link-visitor sessions: deleted when expired',
  oauth_states: 'Google/Apple sign-in states: deleted after 15 minutes',
  auth_tokens: 'email codes and links: deleted 7 days after they expire',
  code_usage: 'daily code counters: 3 days',
  invites: 'deleted 7 days after they expire, are used or are revoked',
  idempotency: 'duplicate-save guards: 1 day',
  app_keys: 'downloaded-file keys not used for 365 days',
  site_seen: 'site visitor hashes: 2 days',
  page_seen: 'page visitor hashes: 2 days',
  site_hours: 'site views per hour: 30 days',
  site_days: 'site views per day: 13 months',
  page_days: 'page views per day: 13 months',
  page_dims: 'page countries, devices and referrers per day: 13 months',
  item_days: 'page link clicks per day: 13 months',
  link_clicks: 'short link clicks per day: 13 months (the total stays on the link)',
  security_events: 'sign-ins and account changes: 90 days',
  audit_log: 'admin actions: 1 year (payment records are kept)',
  notifications: 'read: 60 days; unread: 180 days',
  email_outbox: 'body emptied after 14 days; log line deleted after 30 days',
  booking_reminders: '"already sent" marks: 30 days after their time',
  activity: 'app history: 12 months, and at most the newest 5,000 lines per app',
  app_versions: 'the live version plus the newest 10 per app (older ones and their files are deleted)',
  trash: 'items and files in an app\'s Trash: 30 days, then deleted for good (with the file on disk)',
  disk: 'app and file folders with no app, unfinished uploads and replaced video copies: after 1 day',
} as const;

const KEEP_VERSIONS = 10;
const ACTIVITY_PER_APP = 5000;
const MONTHS_13 = 396 * DAY;

type Report = Record<string, number>;

/**
 * Delete (or change) rows matching `where`, walking the table by rowid in windows of 5,000: every
 * statement reads and changes at most 5,000 rows, whatever the table's size, and the event loop gets a
 * turn between windows. `sql` is the statement with its own WHERE and "rowid >= ? AND rowid < ?" first.
 * Table names and conditions are constants in this file; values are always bound parameters.
 */
async function windowed(table: string, sql: string, ...params: unknown[]): Promise<number> {
  const r = db.prepare(`SELECT MIN(rowid) lo, MAX(rowid) hi FROM ${table}`).get() as { lo: number | null; hi: number | null };
  if (r.lo === null || r.hi === null) return 0;
  const stmt = db.prepare(sql);
  let total = 0;
  for (let lo = r.lo; lo <= r.hi; lo += STEP) {
    total += stmt.run(lo, lo + STEP, ...params).changes;
    await pause();
  }
  return total;
}
const sweep = (table: string, where: string, ...params: unknown[]) =>
  windowed(table, `DELETE FROM ${table} WHERE rowid >= ? AND rowid < ? AND (${where})`, ...params);

/** Delete through an index, 5,000 rows at a time (for conditions an index answers directly). */
async function sweepIndexed(table: string, where: string, ...params: unknown[]): Promise<number> {
  const stmt = db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${where} LIMIT ${STEP})`);
  let total = 0;
  for (;;) {
    const n = stmt.run(...params).changes;
    total += n;
    if (n < STEP) return total;
    await pause();
  }
}

/* ---------------- every hour: what has expired ---------------- */
async function hourly(out: Report) {
  const now = new Date().toISOString();
  out.sessions = await sweepIndexed('sessions', 'expires_at < ?', now);
  out.runs = await sweep('runs', 'expires_at < ?', Date.now());
  out.pub_sessions = await sweep('pub_sessions', 'expires_at < ?', now);
  out.oauth_states = await sweep('oauth_states', 'created_at < ?', iso(15 * 60_000));
  out.auth_tokens = await sweep('auth_tokens', 'expires_at < ?', iso(7 * DAY));
  out.code_usage = await sweep('code_usage', 'day < ?', dayOf(3 * DAY));
  const week = iso(7 * DAY);
  out.invites = await sweep('invites', 'expires_at < ? OR used_at < ? OR revoked_at < ?', week, week, week);
}

/* ---------------- every night: history, versions, Trash, disk ---------------- */
async function nightly(out: Report) {
  out.idempotency = await sweep('idempotency', 'created_at < ?', iso(DAY));
  out.app_keys = await sweep('app_keys', 'last_used_at < ?', iso(365 * DAY));

  // Analytics: visitor hashes only de-duplicate within a day; per-day counts are what the charts show.
  out.site_seen = await sweepIndexed('site_seen', 'day < ?', dayOf(2 * DAY));
  out.page_seen = await sweep('page_seen', 'day < ?', dayOf(2 * DAY));
  out.site_hours = await sweepIndexed('site_hours', 'hour < ?', iso(30 * DAY).slice(0, 13));
  const month13 = dayOf(MONTHS_13);
  out.site_days = await sweepIndexed('site_days', 'day < ?', month13);
  out.page_days = await sweep('page_days', 'day < ?', month13);
  out.page_dims = await sweep('page_dims', 'day < ?', month13);
  out.item_days = await sweep('item_days', 'day < ?', month13);
  out.link_clicks = await sweep('link_clicks', 'day < ?', month13);

  // Logs.
  out.security_events = await sweep('security_events', 'at < ?', iso(90 * DAY));
  out.audit_log = await sweep('audit_log', "at < ? AND COALESCE(target_type, '') NOT IN ('payment', 'payment_method')", iso(365 * DAY));
  out.notifications = await sweep('notifications', '(read_at IS NOT NULL AND created_at < ?) OR created_at < ?', iso(60 * DAY), iso(180 * DAY));
  out.email_bodies = await windowed('email_outbox', "UPDATE email_outbox SET body='' WHERE rowid >= ? AND rowid < ? AND body <> '' AND created_at < ?", iso(14 * DAY));
  out.email_outbox = await sweep('email_outbox', 'created_at < ?', iso(30 * DAY));
  out.booking_reminders = await sweep('booking_reminders', 'fire_at < ?', iso(30 * DAY));

  // App history: 12 months, then at most the newest 5,000 lines per app.
  out.activity = await sweep('activity', 'at < ?', iso(365 * DAY));
  const busy = db.prepare('SELECT app_id FROM activity WHERE app_id IS NOT NULL GROUP BY app_id HAVING COUNT(*) > ?').all(ACTIVITY_PER_APP) as { app_id: string }[];
  for (const { app_id } of busy) {
    const edge = db.prepare('SELECT id FROM activity WHERE app_id=? ORDER BY id DESC LIMIT 1 OFFSET ?').get(app_id, ACTIVITY_PER_APP - 1) as { id: number } | undefined;
    if (edge) out.activity += await sweepIndexed('activity', 'app_id=? AND id<?', app_id, edge.id);
  }

  out.app_versions = await pruneVersions();
  out.trash = await purgeTrash();
  out.disk = await sweepDisk();
}

/** Keep the live version and the newest 10 of each app; delete the rest, and their folders. */
async function pruneVersions(): Promise<number> {
  let removed = 0;
  const many = db.prepare('SELECT app_id FROM app_versions GROUP BY app_id HAVING COUNT(*) > ?').all(KEEP_VERSIONS) as { app_id: string }[];
  const drop = db.prepare(`DELETE FROM app_versions WHERE app_id=? AND n=?
    AND n <> (SELECT live_version FROM apps WHERE id=?)
    AND NOT EXISTS (SELECT 1 FROM runs WHERE app_id=? AND n=? AND expires_at > ?)`);
  for (const { app_id } of many) {
    const old = db.prepare('SELECT n FROM app_versions WHERE app_id=? ORDER BY n DESC LIMIT -1 OFFSET ?').all(app_id, KEEP_VERSIONS) as { n: number }[];
    for (const { n } of old) {
      // Checked again at the moment of deleting: never the live version, never one open in someone's tab.
      if (!drop.run(app_id, n, app_id, app_id, n, Date.now()).changes) continue;
      removed++;
      await fs.promises.rm(appDir(app_id, n), { recursive: true, force: true }).catch(() => {});
    }
    await pause();
  }
  return removed;
}

/** Items and files in an app's Trash for more than 30 days are deleted for good. */
async function purgeTrash(): Promise<number> {
  let removed = 0;
  const cutoff = iso(30 * DAY);
  const apps = new Set<string>();
  for (;;) {
    const rows = db.prepare('SELECT id, app_id, kind, record_id FROM trash WHERE parent IS NULL AND deleted_at < ? LIMIT 200').all(cutoff) as { id: string; app_id: string; kind: string; record_id: string }[];
    if (!rows.length) break;
    db.transaction(() => {
      for (const t of rows) {
        if (t.kind === 'file') {
          const f = db.prepare('SELECT * FROM files WHERE id=? AND app_id=?').get(t.record_id, t.app_id) as FileRow | undefined;
          if (f?.deleted_at) purgeFile(f);
        }
        db.prepare('DELETE FROM trash WHERE parent=?').run(t.id);
        db.prepare('DELETE FROM trash WHERE id=?').run(t.id);
        apps.add(t.app_id);
      }
    })();
    removed += rows.length;
    await pause(10);
  }
  // Open Trash screens refresh themselves.
  for (const id of apps) publish(id, 'trash', { op: 'purge' });
  return removed;
}

/**
 * Files on disk nothing points at any more, older than a day (so an upload in progress is never touched):
 * folders of apps that no longer exist, version folders with no version, unfinished uploads, and older
 * copies of videos that were made smaller (kept while someone was still streaming them).
 */
async function sweepDisk(): Promise<number> {
  let removed = 0;
  const old = Date.now() - DAY;
  const aged = async (p: string) => { try { return (await fs.promises.stat(p)).mtimeMs < old; } catch { return false; } };
  const rm = async (p: string) => { try { await fs.promises.rm(p, { recursive: true, force: true }); removed++; } catch { /* in use: next night */ } };
  const list = async (dir: string) => { try { return await fs.promises.readdir(dir); } catch { return [] as string[]; } };
  const appExists = db.prepare('SELECT 1 FROM apps WHERE id=?');

  const appsDir = path.join(config.dataDir, 'apps');
  for (const id of await list(appsDir)) {
    const dir = path.join(appsDir, id);
    if (!appExists.get(id)) { if (await aged(dir)) await rm(dir); continue; }
    const kept = new Set((db.prepare('SELECT n FROM app_versions WHERE app_id=?').all(id) as { n: number }[]).map((v) => `v${v.n}`));
    for (const v of await list(dir)) if (/^v\d+$/.test(v) && !kept.has(v) && await aged(path.join(dir, v))) await rm(path.join(dir, v));
    await pause();
  }

  const filesDir = path.join(config.dataDir, 'files');
  const fileRow = db.prepare('SELECT version FROM files WHERE id=? AND app_id=?');
  for (const id of await list(filesDir)) {
    const dir = path.join(filesDir, id);
    if (!appExists.get(id)) { if (await aged(dir)) await rm(dir); continue; }
    for (const name of await list(dir)) {
      const m = /^(f_[\w-]+?)(?:\.v(\d+))?(\.part(?:\.mp4)?)?$/.exec(name);
      if (!m) continue;
      const row = fileRow.get(m[1], id) as { version: number } | undefined;
      const version = m[2] ? Number(m[2]) : 1;
      const orphan = !!m[3] || !row || version < row.version;
      if (orphan && await aged(path.join(dir, name))) await rm(path.join(dir, name));
    }
    await pause();
  }

  const staging = path.join(config.dataDir, 'staging');
  for (const n of await list(staging)) if (await aged(path.join(staging, n))) await rm(path.join(staging, n));
  return removed;
}

/* ---------------- disk space inside the database ---------------- */
/**
 * Deleted rows leave free pages in the file; SQLite reuses them, but the file never shrinks unless
 * auto_vacuum is INCREMENTAL. Switching a database to it needs one full VACUUM (a rewrite of the whole
 * file, which blocks the database while it runs and needs free disk space of about its size).
 * At start, that is done by itself when it is cheap: a database under 256 MB with at least three times its
 * size free on disk. Otherwise it is left for a manual, planned step (see docs/STATUS.md) and logged.
 */
function ensureIncrementalVacuum() {
  if (process.env.JANITOR_VACUUM === '0') return;
  const mode = db.pragma('auto_vacuum', { simple: true }) as number;
  if (mode === 2) return; // INCREMENTAL already
  const file = path.join(config.dataDir, 'jhino.db');
  let size = 0, free = Infinity;
  try { size = fs.statSync(file).size; } catch { return; }
  try { const s = fs.statfsSync(config.dataDir); free = s.bavail * s.bsize; } catch { /* unknown: assume enough */ }
  if (size > 256 * 1048576 || free < size * 3) {
    console.warn(`  [janitor] The database (${Math.round(size / 1048576)} MB) cannot give disk space back yet. Run the one-time VACUUM described in docs/STATUS.md at a quiet time.`);
    return;
  }
  const t = Date.now();
  db.pragma('auto_vacuum = INCREMENTAL');
  db.exec('VACUUM');
  console.log(`  [janitor] Database switched to incremental vacuum (${Math.round(size / 1048576)} MB -> ${Math.round(fs.statSync(file).size / 1048576)} MB, ${Date.now() - t} ms).`);
}

/** Give free pages back to the disk, 1,000 pages (about 4 MB) at a time. */
async function releaseFreePages(): Promise<number> {
  if ((db.pragma('auto_vacuum', { simple: true }) as number) !== 2) return 0;
  let pages = 0;
  for (let i = 0; i < 10_000; i++) {
    const free = db.pragma('freelist_count', { simple: true }) as number;
    if (!free) break;
    db.pragma(`incremental_vacuum(${Math.min(free, 1000)})`);
    pages += Math.min(free, 1000);
    await pause(5);
  }
  return pages;
}

/* ---------------- schedule and report ---------------- */
const NIGHT_HOUR = Math.min(23, Math.max(0, Number(process.env.JANITOR_HOUR_UTC ?? 21)));
let running = false;

const total = (r: Report) => Object.values(r).reduce((s, n) => s + n, 0);
const summary = (r: Report) => Object.entries(r).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ') || 'nothing to remove';

async function run(kind: 'hourly' | 'nightly') {
  const started = Date.now();
  const out: Report = {};
  await hourly(out);
  if (kind === 'nightly') {
    await nightly(out);
    db.pragma('optimize');
    out.freed_pages = await releaseFreePages();
    // A quiet moment: write the WAL back into the database and shrink it to nothing.
    db.pragma('wal_checkpoint(TRUNCATE)');
    setSetting('janitor_night_at', String(Date.now()));
  }
  const ms = Date.now() - started;
  if (kind === 'nightly' || total(out)) console.log(`  [janitor] ${kind}: ${summary(out)} (${ms} ms)`);
  let last: Record<string, unknown> = {};
  try { last = JSON.parse(setting('janitor_last') || '{}'); } catch { /* start over */ }
  last[kind] = { at: new Date().toISOString(), ms, removed: out };
  setSetting('janitor_last', JSON.stringify(last));
}

function due(): 'hourly' | 'nightly' {
  const lastNight = Number(setting('janitor_night_at') || 0);
  const since = Date.now() - lastNight;
  // At the quiet hour once a day, or at once when the last night run is more than a day and a half ago.
  return (new Date().getUTCHours() === NIGHT_HOUR && since > 20 * 3600e3) || since > 36 * 3600e3 ? 'nightly' : 'hourly';
}

async function tick(force?: 'nightly') {
  if (running) return;
  running = true;
  try { await run(force ?? due()); } catch (e) { console.error('  [janitor]', (e as Error).message); }
  running = false;
}

export function startJanitor(app: FastifyInstance) {
  app.get('/api/admin/janitor', async (req) => {
    requireAdmin(req);
    let last: unknown = {};
    try { last = JSON.parse(setting('janitor_last') || '{}'); } catch { /* none yet */ }
    const pageSize = db.pragma('page_size', { simple: true }) as number;
    const pages = db.pragma('page_count', { simple: true }) as number;
    const free = db.pragma('freelist_count', { simple: true }) as number;
    const vacuum = ['none', 'full', 'incremental'][db.pragma('auto_vacuum', { simple: true }) as number] ?? 'unknown';
    return {
      running, nightHourUtc: NIGHT_HOUR, last, rules: RULES,
      database: { bytes: pages * pageSize, freeBytes: free * pageSize, autoVacuum: vacuum }, liveStreams: openStreams(),
    };
  });
  if (process.env.JANITOR === '0') return;
  ensureIncrementalVacuum();
  const first = Math.max(1000, Number(process.env.JANITOR_FIRST_MS) || 2 * 60_000);
  setTimeout(() => { void tick(process.env.JANITOR_NIGHTLY_NOW === '1' ? 'nightly' : undefined); }, first).unref();
  setInterval(() => { void tick(); }, 3600_000).unref();
}
