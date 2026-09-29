import crypto from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { db, roleOf, onActivity, type Role } from './db.js';

/**
 * One server-sent-events stream per open tab. A tab "watches" the apps it has
 * open and receives their data changes. Every event is re-checked against the
 * person's current membership before it is written.
 *
 * Connections are indexed by app and by person, so a change reaches the tabs that watch that app
 * without walking every open connection on the server, and presence and activity look up an app's
 * members once instead of once per connected person.
 */
interface Conn {
  id: string;
  userId: string;
  res: ServerResponse;
  apps: Set<string>;
  /** Set for streams opened for one app only (a link visitor, a custom domain): nothing about other apps reaches it. */
  scope?: string;
}

const conns = new Map<string, Conn>();
const byApp = new Map<string, Set<Conn>>();
const byUser = new Map<string, Set<Conn>>();
export const BOOT_ID = crypto.randomBytes(6).toString('hex');

const add = (m: Map<string, Set<Conn>>, k: string, c: Conn) => { let s = m.get(k); if (!s) { s = new Set(); m.set(k, s); } s.add(c); };
const drop = (m: Map<string, Set<Conn>>, k: string, c: Conn) => { const s = m.get(k); if (s && s.delete(c) && !s.size) m.delete(k); };

/** A tab that stops reading (a phone that went to sleep with the socket still open) is let go before its unread events use up memory. */
const MAX_BUFFERED = 1024 * 1024;
function write(c: Conn, event: string, data: unknown) {
  if (c.res.writableLength > MAX_BUFFERED) { c.res.destroy(); return; }
  c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// One keep-alive timer for all streams (not one per connection).
setInterval(() => { for (const c of conns.values()) if (c.res.writableLength < MAX_BUFFERED) c.res.write(': ping\n\n'); }, 25_000).unref();

export function openStream(userId: string, res: ServerResponse, scope?: string): Conn {
  const c: Conn = { id: crypto.randomBytes(9).toString('base64url'), userId, res, apps: new Set(), scope };
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  conns.set(c.id, c);
  add(byUser, userId, c);
  write(c, 'hello', { connId: c.id, bootId: BOOT_ID });
  res.on('close', () => {
    conns.delete(c.id);
    drop(byUser, c.userId, c);
    for (const appId of c.apps) { drop(byApp, appId, c); sendPresence(appId); }
  });
  return c;
}

export function watch(connId: string, userId: string, appId: string): boolean {
  const c = conns.get(connId);
  if (!c || c.userId !== userId || (c.scope && c.scope !== appId) || !roleOf(appId, userId)) return false;
  c.apps.add(appId);
  add(byApp, appId, c);
  sendPresence(appId);
  return true;
}

function stopWatching(c: Conn, appId: string): boolean {
  if (!c.apps.delete(appId)) return false;
  drop(byApp, appId, c);
  return true;
}

export function unwatch(connId: string, userId: string, appId: string) {
  const c = conns.get(connId);
  if (!c || c.userId !== userId) return;
  if (stopWatching(c, appId)) sendPresence(appId);
}

/** Who has this app open right now. */
export function presence(appId: string): { id: string; name: string }[] {
  const ids = new Set<string>();
  for (const c of byApp.get(appId) ?? []) ids.add(c.userId);
  if (!ids.size) return [];
  const q = db.prepare('SELECT id, name FROM users WHERE id=?');
  return [...ids].map((id) => q.get(id) as { id: string; name: string }).filter(Boolean);
}

/** The app's members who have a live connection open, with their role. */
function connectedMembers(appId: string): { userId: string; role: Role }[] {
  const members = db.prepare('SELECT user_id userId, role FROM memberships WHERE app_id=?').all(appId) as { userId: string; role: Role }[];
  return members.filter((m) => byUser.has(m.userId));
}

/**
 * Presence goes to every connected member (the dashboard shows who is in which app).
 * Many tabs opening at once (a restart, a class all joining) ask for it in the same moment: it is sent
 * once per app on the next turn of the event loop, not once per tab.
 */
const presencePending = new Set<string>();
function sendPresence(appId: string) {
  if (presencePending.has(appId)) return;
  presencePending.add(appId);
  setImmediate(() => {
    presencePending.delete(appId);
    const people = presence(appId);
    for (const m of connectedMembers(appId)) for (const c of byUser.get(m.userId) ?? []) if (!c.scope || c.scope === appId) write(c, 'presence', { appId, people });
  });
}

/**
 * Send a committed change to everyone watching the app.
 * `onlyUser` limits it to one person; `canSee` filters per person and role.
 */
export function publish(
  appId: string, event: string, data: Record<string, unknown>,
  onlyUser?: string, canSee?: (userId: string, role: Role) => boolean,
) {
  const watching = byApp.get(appId);
  if (!watching?.size) return;
  const payload = { appId, ...data };
  const roles = new Map<string, Role | null>();
  const seen = new Map<string, boolean>();
  for (const c of [...watching]) {
    if (onlyUser && c.userId !== onlyUser) continue;
    if (!roles.has(c.userId)) roles.set(c.userId, roleOf(appId, c.userId));
    const role = roles.get(c.userId) ?? null;
    if (!role) {
      stopWatching(c, appId);
      write(c, 'revoked', { appId });
      continue;
    }
    if (canSee) {
      if (!seen.has(c.userId)) seen.set(c.userId, canSee(c.userId, role));
      if (!seen.get(c.userId)) continue;
    }
    write(c, event, payload);
  }
}

/** Tell a person's open tabs that something about their apps changed. */
export function notifyUser(userId: string, event = 'apps-changed', data: Record<string, unknown> = {}) {
  for (const c of byUser.get(userId) ?? []) if (!c.scope) write(c, event, data);
}

/** Access removed: stop sending that app's events to this person right away. */
export function revoke(appId: string, userId: string) {
  for (const c of [...(byUser.get(userId) ?? [])]) {
    if (stopWatching(c, appId)) write(c, 'revoked', { appId });
  }
  sendPresence(appId);
  notifyUser(userId);
}

/** Shutdown: end every live stream so the server can close. Browsers reconnect to the next instance by themselves. */
export function closeAllStreams() {
  for (const c of conns.values()) { try { c.res.end(); } catch { /* already gone */ } }
  conns.clear();
  byApp.clear();
  byUser.clear();
}

export function closeUser(userId: string) {
  for (const c of [...(byUser.get(userId) ?? [])]) c.res.end();
}

/** How many live streams are open (for the janitor's report). */
export const openStreams = () => conns.size;

// New activity lines stream to every connected member of that app (after the write commits).
type ActivityFilter = (appId: string, row: Record<string, unknown>, userId: string, role: Role) => boolean;
let activityFilter: ActivityFilter = () => true;
/** Set by the activity module: hides lines about items a person cannot see. */
export const setActivityFilter = (fn: ActivityFilter) => { activityFilter = fn; };

onActivity((row) => {
  if (!row.appId) return;
  setImmediate(() => {
    const members = connectedMembers(row.appId!);
    if (!members.length) return;
    const exists = db.prepare(`SELECT a.id, a.action, a.detail, a.at, a.app_id appId, u.name, u.username, ap.name appName, a.user_id userId, a.collection, a.record_id recordId, a.kind, a.note
      FROM activity a LEFT JOIN users u ON u.id=a.user_id JOIN apps ap ON ap.id=a.app_id WHERE a.id=?`).get(row.id) as Record<string, unknown> | undefined;
    if (!exists) return;
    for (const m of members) {
      if (!activityFilter(row.appId!, exists, m.userId, m.role)) continue;
      for (const c of byUser.get(m.userId) ?? []) if (!c.scope || c.scope === row.appId) write(c, 'activity', exists);
    }
  });
});
