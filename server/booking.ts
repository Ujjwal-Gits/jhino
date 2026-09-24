import { db, now } from './db.js';
import { notify } from './plans.js';
import { baseUrl, mails } from './mail.js';

/*
 * Studio booking reminders. Each Studio Booking section keeps its reminder settings in the app's shared
 * storage (key "jhino.booking-reminders.<section>"). Once a minute, bookings starting soon get a reminder,
 * sent once, to the app's owner and editors: in the bell and, if they want, by email.
 */

export const REMINDER_KEY = (blockId: string) => `jhino.booking-reminders.${blockId}`;
interface Settings { enabled: boolean; minutes: number; message: string; tz: string }
const DEFAULTS: Settings = { enabled: true, minutes: 60, message: 'Studio booking: {customer} at {time} ({service}).', tz: 'Asia/Kathmandu' };
const DONE = new Set(['Cancelled', 'Completed', 'No-show']);

function settingsFor(appId: string, blockId: string): Settings {
  const r = db.prepare("SELECT value FROM kv WHERE app_id=? AND ns='ws' AND scope='' AND key=?").get(appId, REMINDER_KEY(blockId)) as { value: string | null } | undefined;
  let s: Partial<Settings> = {};
  try { s = r?.value ? JSON.parse(r.value) : {}; } catch { /* defaults */ }
  const minutes = Math.round(Number(s.minutes));
  let tz = typeof s.tz === 'string' ? s.tz : DEFAULTS.tz;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { tz = DEFAULTS.tz; }
  return {
    enabled: s.enabled !== false,
    minutes: Number.isFinite(minutes) && minutes >= 1 && minutes <= 60 * 24 * 14 ? minutes : DEFAULTS.minutes,
    message: typeof s.message === 'string' && s.message.trim() ? s.message.slice(0, 300) : DEFAULTS.message,
    tz,
  };
}

/** The moment a wall-clock date and time happen in a time zone. */
export function zonedTime(date: string, time: string, tz: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? ''), t = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
  if (!d || !t) return null;
  const wall = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  const offset = (at: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(at)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - at;
  };
  let guess = wall - offset(wall);
  guess = wall - offset(guess);
  return guess;
}
const fmtTime = (ms: number, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
const fmtDay = (ms: number, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(ms));

export function sendDueReminders(at = Date.now()) {
  const apps = db.prepare(`SELECT a.id, a.name, v.builder FROM apps a JOIN app_versions v ON v.app_id=a.id AND v.n=a.live_version
    WHERE a.deleted_at IS NULL AND v.builder LIKE '%studio_booking%'`).all() as { id: string; name: string; builder: string }[];
  let sent = 0;
  for (const a of apps) {
    let blocks: { id: string; preset: string; title: string }[] = [];
    try { blocks = (JSON.parse(a.builder).blocks ?? []).filter((b: { preset: string }) => b.preset === 'studio_booking'); } catch { continue; }
    for (const b of blocks) {
      const s = settingsFor(a.id, b.id);
      if (!s.enabled) continue;
      const recs = db.prepare('SELECT id, data FROM records WHERE app_id=? AND collection=?').all(a.id, b.id) as { id: string; data: string }[];
      for (const r of recs) {
        let d: Record<string, string>;
        try { d = JSON.parse(r.data); } catch { continue; }
        if (DONE.has(d.status)) continue;
        const start = zonedTime(d.date, d.start, s.tz);
        if (start === null) continue;
        const fire = start - s.minutes * 60_000;
        // Due now, and not for bookings that already began (for example after the server was off for a while).
        if (at < fire || at > start + 5 * 60_000) continue;
        const fireIso = new Date(fire).toISOString();
        if (!db.prepare('INSERT OR IGNORE INTO booking_reminders(app_id,record_id,fire_at,sent_at) VALUES(?,?,?,?)').run(a.id, r.id, fireIso, now()).changes) continue;
        const time = fmtTime(start, s.tz);
        const text = s.message
          .replace(/\{customer\}/g, d.customer || 'a customer').replace(/\{time\}/g, time).replace(/\{date\}/g, fmtDay(start, s.tz))
          .replace(/\{service\}/g, d.service || 'booking').replace(/\{end\}/g, d.end || '').replace(/\{app\}/g, a.name);
        const people = db.prepare("SELECT u.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.app_id=? AND m.role IN ('owner','editor') AND u.kind='person' AND u.disabled=0").all(a.id) as { id: string }[];
        const link = `/apps/${a.id}#${b.id}/${r.id}`;
        for (const p of people) {
          const name = (db.prepare('SELECT name FROM users WHERE id=?').get(p.id) as { name: string }).name;
          notify(p.id, 'bookings', `Booking at ${time}: ${d.customer || 'customer'}`, text, link, { kind: 'booking_reminder', mail: mails.bookingReminder(name, text, `${baseUrl()}${link}`) });
        }
        sent++;
      }
    }
  }
  return sent;
}

export function startBookingReminders() {
  const every = Math.max(1000, Number(process.env.BOOKING_TICK_MS) || 60_000);
  const tick = () => { try { sendDueReminders(); } catch (e) { console.error('[booking]', (e as Error).message); } };
  setTimeout(tick, 5000).unref();
  setInterval(tick, every).unref();
  // Old "already sent" marks are not needed after a few weeks.
  setInterval(() => db.prepare('DELETE FROM booking_reminders WHERE fire_at < ?').run(new Date(Date.now() - 30 * 864e5).toISOString()), 6 * 3600e3).unref();
}
