import crypto from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { db, roleOf, onActivity, type Role } from './db.js';

/**
 * One server-sent-events stream per open tab. A tab "watches" the apps it has
 * open and receives their data changes. Every event is re-checked against the
 * person's current membership before it is written.
 */
interface Conn {
  id: string;
  userId: string;
  res: ServerResponse;
  apps: Set<string>;
}

const conns = new Map<string, Conn>();
export const BOOT_ID = crypto.randomBytes(6).toString('hex');

function write(c: Conn, event: string, data: unknown) {
  c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function openStream(userId: string, res: ServerResponse): Conn {
  const c: Conn = { id: crypto.randomBytes(9).toString('base64url'), userId, res, apps: new Set() };
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  conns.set(c.id, c);
  write(c, 'hello', { connId: c.id, bootId: BOOT_ID });
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  res.on('close', () => {
    clearInterval(ping);
    conns.delete(c.id);
    for (const appId of c.apps) sendPresence(appId);
  });
  return c;
}

export function watch(connId: string, userId: string, appId: string): boolean {
  const c = conns.get(connId);
  if (!c || c.userId !== userId || !roleOf(appId, userId)) return false;
  c.apps.add(appId);
  sendPresence(appId);
  return true;
}

export function unwatch(connId: string, userId: string, appId: string) {
  const c = conns.get(connId);
  if (!c || c.userId !== userId) return;
  if (c.apps.delete(appId)) sendPresence(appId);
}

/** Who has this app open right now. */
export function presence(appId: string): { id: string; name: string }[] {
  const ids = new Set<string>();
  for (const c of conns.values()) if (c.apps.has(appId)) ids.add(c.userId);
  if (!ids.size) return [];
  const q = db.prepare('SELECT id, name FROM users WHERE id=?');
  return [...ids].map((id) => q.get(id) as { id: string; name: string }).filter(Boolean);
}

/** Presence goes to every connected member (the dashboard shows who is in which app). */
function sendPresence(appId: string) {
  const people = presence(appId);
  const allowed = new Map<string, boolean>();
  for (const c of conns.values()) {
    if (!allowed.has(c.userId)) allowed.set(c.userId, !!roleOf(appId, c.userId));
    if (allowed.get(c.userId)) write(c, 'presence', { appId, people });
  }
}

/**
 * Send a committed change to everyone watching the app.
 * `onlyUser` limits it to one person; `canSee` filters per person and role.
 */
export function publish(
  appId: string, event: string, data: Record<string, unknown>,
  onlyUser?: string, canSee?: (userId: string, role: Role) => boolean,
) {
  for (const c of conns.values()) {
    if (!c.apps.has(appId)) continue;
    if (onlyUser && c.userId !== onlyUser) continue;
    const role = roleOf(appId, c.userId);
    if (!role) {
      c.apps.delete(appId);
      write(c, 'revoked', { appId });
      continue;
    }
    if (canSee && !canSee(c.userId, role)) continue;
    write(c, event, { appId, ...data });
  }
}

/** Tell a person's open tabs that something about their apps changed. */
export function notifyUser(userId: string, event = 'apps-changed', data: Record<string, unknown> = {}) {
  for (const c of conns.values()) if (c.userId === userId) write(c, event, data);
}

/** Access removed: stop sending that app's events to this person right away. */
export function revoke(appId: string, userId: string) {
  for (const c of conns.values()) {
    if (c.userId === userId && c.apps.delete(appId)) write(c, 'revoked', { appId });
  }
  sendPresence(appId);
  notifyUser(userId);
}

export function closeUser(userId: string) {
  for (const c of conns.values()) if (c.userId === userId) c.res.end();
}

// New activity lines stream to every connected member of that app (after the write commits).
type ActivityFilter = (appId: string, row: Record<string, unknown>, userId: string, role: Role) => boolean;
let activityFilter: ActivityFilter = () => true;
/** Set by the activity module: hides lines about items a person cannot see. */
export const setActivityFilter = (fn: ActivityFilter) => { activityFilter = fn; };

onActivity((row) => {
  if (!row.appId) return;
  setImmediate(() => {
    const exists = db.prepare(`SELECT a.id, a.action, a.detail, a.at, a.app_id appId, u.name, ap.name appName, a.user_id userId, a.collection, a.record_id recordId, a.kind, a.note
      FROM activity a LEFT JOIN users u ON u.id=a.user_id JOIN apps ap ON ap.id=a.app_id WHERE a.id=?`).get(row.id) as Record<string, unknown> | undefined;
    if (!exists) return;
    const allowed = new Map<string, boolean>();
    for (const c of conns.values()) {
      if (!allowed.has(c.userId)) {
        const r = roleOf(row.appId!, c.userId);
        allowed.set(c.userId, !!r && activityFilter(row.appId!, exists, c.userId, r));
      }
      if (allowed.get(c.userId)) write(c, 'activity', exists);
    }
  });
});
