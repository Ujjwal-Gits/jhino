import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { config, makePassword } from './config.js';
import { db, newId, now, type AppRow, type UserRow } from './db.js';
import { HttpError, canCreateApps, createUser, hashPassword, requireAdmin, revokeSessions, validateEmail, validateName, validatePassword } from './auth.js';
import { audit, deviceName, limit, maskIp, setSetting, setting } from './security.js';
import { PLANS, activePlan, isPeriod, isPlan, notify, periodEnd, planLimitsInfo, publicPlans, savePlans, usage, type Category, type PlanId } from './plans.js';
import { deleteAccount } from './account.js';
import { mailReady, mailSender, mails, sendMail } from './mail.js';
import { providerReady } from './oauth.js';
import { RESERVED, assertRootFree, baseFor, setSharing, shareInfo, validSlug } from './publicshare.js';
import { assertUsernameFree, assignUsername, validUsername } from './usernames.js';
import { createAppFromUpload, readUpload } from './apps.js';

/*
 * The Super Admin dashboard: platform owners manage customers, plans, payments (billing.ts),
 * hosting addresses and settings. Everything sensitive lands in the audit log.
 */

/** Bytes on disk for everything a person owns: app files (HTML, ZIP contents, every version) and uploaded files. */
function storageOf(userId: string) {
  const r = db.prepare(`SELECT
      (SELECT COALESCE(SUM(v.size),0) FROM app_versions v JOIN apps a ON a.id=v.app_id WHERE a.owner_id=@u) apps,
      (SELECT COALESCE(SUM(f.size),0) FROM files f JOIN apps a ON a.id=f.app_id WHERE a.owner_id=@u) files,
      (SELECT COALESCE(SUM(LENGTH(k.value)),0) FROM kv k JOIN apps a ON a.id=k.app_id WHERE a.owner_id=@u) kv,
      (SELECT COALESCE(SUM(LENGTH(r.data)),0) FROM records r JOIN apps a ON a.id=r.app_id WHERE a.owner_id=@u) records`).get({ u: userId }) as { apps: number; files: number; kv: number; records: number };
  return { ...r, total: r.apps + r.files + r.kv + r.records };
}
function userRow(u: UserRow) {
  const last = db.prepare('SELECT status FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(u.id) as { status: string } | undefined;
  return {
    storage: canCreateApps(u) ? storageOf(u.id).total : 0,
    id: u.id, name: u.name, email: u.email, username: u.username ?? null, emailVerified: /@/.test(u.email) ? !!u.email_verified_at : null, createdAt: u.created_at,
    status: u.disabled ? 'suspended' : 'active', role: u.is_admin ? 'super_admin' : canCreateApps(u) ? 'creator' : 'client',
    usage: canCreateApps(u) ? usage(u) : null, lastLoginAt: u.last_login_at ?? null, lastPayment: last?.status ?? null,
  };
}
const getUser = (id: string) => {
  const u = db.prepare("SELECT * FROM users WHERE id=? AND kind='person'").get(id) as UserRow | undefined;
  if (!u) throw new HttpError(404, 'NOT_FOUND', 'That person does not exist.');
  return u;
};
function grant(userId: string, plan: string, adminId: string, source: string) {
  const t = now();
  db.prepare('INSERT INTO subscriptions(id,user_id,plan,creations,amount,payment_id,source,granted_by,starts_at,created_at) VALUES(?,?,?,?,?,NULL,?,?,?,?)')
    .run(newId('sub'), userId, plan, PLANS[plan as keyof typeof PLANS]?.creations ?? 0, 0, source, adminId, t, t);
}

/** What is stored where: the database file, app files and uploads (from their recorded sizes), and the disk. */
function serverStorage() {
  const size = (f: string) => { try { return fs.statSync(f).size; } catch { return 0; } };
  const dbFile = path.join(config.dataDir, 'jhino.db');
  const database = size(dbFile) + size(dbFile + '-wal');
  const sums = db.prepare('SELECT (SELECT COALESCE(SUM(size),0) FROM app_versions) apps, (SELECT COALESCE(SUM(size),0) FROM files) files').get() as { apps: number; files: number };
  let disk: { total: number; free: number } | null = null;
  try { const st = fs.statfsSync(config.dataDir); disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize }; } catch { /* not available here */ }
  return { database, apps: sums.apps, files: sums.files, disk, maxFileMB: planLimitsInfo().serverMaxMB };
}

/** Days from `days` ago to today (UTC), as YYYY-MM-DD, with a count for each. */
function daily(sql: string, days: number) {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0); start.setUTCDate(start.getUTCDate() - (days - 1));
  const by = new Map((db.prepare(sql).all(start.toISOString()) as { d: string; n: number }[]).map((r) => [r.d, r.n]));
  return Array.from({ length: days }, (_, i) => { const d = new Date(start); d.setUTCDate(start.getUTCDate() + i); const k = d.toISOString().slice(0, 10); return { day: k, n: by.get(k) ?? 0 }; });
}
/** What the dashboard draws: money by month, sign-ups and apps by day, the plan mix, and what needs a hand. */
function trends() {
  const n = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;
  const t = now();
  const d30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const d60 = new Date(Date.now() - 60 * 864e5).toISOString();
  const m0 = new Date(); m0.setUTCDate(1); m0.setUTCHours(0, 0, 0, 0); m0.setUTCMonth(m0.getUTCMonth() - 11);
  const byMonth = new Map((db.prepare("SELECT substr(reviewed_at,1,7) m, SUM(amount) n FROM payments WHERE status='approved' AND reviewed_at >= ? GROUP BY m").all(m0.toISOString()) as { m: string; n: number }[]).map((r) => [r.m, r.n]));
  const revenueByMonth = Array.from({ length: 12 }, (_, i) => { const d = new Date(m0); d.setUTCMonth(m0.getUTCMonth() + i); const k = d.toISOString().slice(0, 7); return { month: k, n: byMonth.get(k) ?? 0 }; });
  const creators = "kind='person' AND created_by IS NULL AND is_admin=0";
  const paid = (p: string) => n(`SELECT COUNT(*) n FROM users WHERE ${creators} AND plan=? AND (plan_expires_at IS NULL OR plan_expires_at > ?)`, p, t);
  const plus = paid('plus'); const pro = paid('pro');
  const monthlyOf = (p: 'plus' | 'pro') => (db.prepare(`SELECT plan_period p, COUNT(*) n FROM users WHERE ${creators} AND plan=? AND (plan_expires_at IS NULL OR plan_expires_at > ?) GROUP BY plan_period`).all(p, t) as { p: string | null; n: number }[])
    .reduce((s, r) => s + r.n * (r.p === 'year' ? PLANS[p].yearly / 12 : PLANS[p].price), 0);
  return {
    revenuePrev30: n("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE status='approved' AND reviewed_at > ? AND reviewed_at <= ?", d60, d30),
    newUsersPrev30: n(`SELECT COUNT(*) n FROM users WHERE ${creators} AND created_at > ? AND created_at <= ?`, d60, d30),
    monthlyRevenue: Math.round(monthlyOf('plus') + monthlyOf('pro')),
    revenueByMonth,
    signupsByDay: daily(`SELECT substr(created_at,1,10) d, COUNT(*) n FROM users WHERE ${creators} AND created_at >= ? GROUP BY d`, 30),
    appsByDay: daily('SELECT substr(created_at,1,10) d, COUNT(*) n FROM apps WHERE created_at >= ? GROUP BY d', 30),
    planMix: { free: Math.max(0, n(`SELECT COUNT(*) n FROM users WHERE ${creators}`) - plus - pro), plus, pro },
    links: n('SELECT COUNT(*) n FROM short_links'),
    linkClicks30: n('SELECT COALESCE(SUM(n),0) n FROM link_clicks WHERE day >= ?', d30.slice(0, 10)),
    pendingList: db.prepare("SELECT id, user_name userName, plan, period, amount, expected_amount expectedAmount, created_at createdAt FROM payments WHERE status='pending' ORDER BY created_at LIMIT 5").all(),
    ticketsList: db.prepare("SELECT id, email, kind, subject, created_at createdAt FROM support_tickets WHERE status='open' ORDER BY created_at DESC LIMIT 4").all(),
    expiring: db.prepare(`SELECT id, name, email, plan, plan_expires_at expiresAt FROM users WHERE ${creators} AND plan IN ('plus','pro') AND plan_expires_at IS NOT NULL AND plan_expires_at > ? AND plan_expires_at < ? ORDER BY plan_expires_at LIMIT 5`).all(t, new Date(Date.now() + 14 * 864e5).toISOString()),
  };
}

export function registerSuperAdmin(app: FastifyInstance) {
  app.get('/api/admin/overview', async (req) => {
    requireAdmin(req);
    const n = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    return {
      users: n("SELECT COUNT(*) n FROM users WHERE kind='person' AND created_by IS NULL AND is_admin=0"),
      clients: n("SELECT COUNT(*) n FROM users WHERE kind='person' AND created_by IS NOT NULL AND is_admin=0"),
      newUsers30: n("SELECT COUNT(*) n FROM users WHERE kind='person' AND created_by IS NULL AND is_admin=0 AND created_at > ?", since),
      paying: n("SELECT COUNT(*) n FROM users WHERE kind='person' AND plan IN ('plus','pro') AND is_admin=0 AND (plan_expires_at IS NULL OR plan_expires_at > ?)", now()),
      pendingPayments: n("SELECT COUNT(*) n FROM payments WHERE status='pending'"),
      revenue30: n("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE status='approved' AND reviewed_at > ?", since),
      revenueAll: n("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE status='approved'"),
      apps: n('SELECT COUNT(*) n FROM apps WHERE deleted_at IS NULL'),
      hosted: n("SELECT COUNT(*) n FROM apps WHERE slug IS NOT NULL AND deleted_at IS NULL"),
      openTickets: n("SELECT COUNT(*) n FROM support_tickets WHERE status='open'"),
      recent: db.prepare('SELECT actor_email actor, action, detail, at FROM audit_log ORDER BY id DESC LIMIT 8').all(),
      mailReady: mailReady(),
      storage: serverStorage(),
      ...trends(),
    };
  });

  /* ---------- users ---------- */
  app.get('/api/admin/users', async (req) => {
    requireAdmin(req);
    const q = req.query as { q?: string; status?: string; plan?: string; role?: string; offset?: string };
    const s = String(q.q ?? '').trim().toLowerCase();
    const where = ["kind='person'"]; const args: unknown[] = [];
    if (s) { where.push('(lower(email) LIKE ? OR lower(name) LIKE ? OR id=?)'); args.push(`%${s}%`, `%${s}%`, s); }
    if (q.status === 'suspended') where.push('disabled=1');
    if (q.status === 'active') where.push('disabled=0');
    if (q.status === 'unverified') where.push("email LIKE '%@%' AND email_verified_at IS NULL");
    if (q.role === 'super_admin') where.push('is_admin=1');
    if (q.role === 'creator') where.push('is_admin=0 AND created_by IS NULL');
    if (q.role === 'client') where.push('is_admin=0 AND created_by IS NOT NULL');
    if (isPlan(q.plan)) { where.push('plan=? AND is_admin=0 AND created_by IS NULL'); args.push(q.plan); }
    const offset = Math.max(0, Number(q.offset) || 0);
    const total = (db.prepare(`SELECT COUNT(*) n FROM users WHERE ${where.join(' AND ')}`).get(...args) as { n: number }).n;
    const rows = db.prepare(`SELECT * FROM users WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 50 OFFSET ?`).all(...args, offset) as UserRow[];
    return { users: rows.map(userRow), total, offset };
  });

  /** Make a sign-in for someone who paid (or a new super admin). The password is shown once. */
  app.post('/api/admin/users', async (req) => {
    const admin = requireAdmin(req);
    const b = (req.body ?? {}) as { name?: string; email?: string; username?: string; password?: string; plan?: string; period?: string; superAdmin?: boolean };
    const plan = isPlan(b.plan) ? b.plan : 'free';
    const password = b.password ? validatePassword(b.password) : makePassword(12);
    const u = await createUser(validateEmail(b.email), validateName(b.name), password, !!b.superAdmin, { verified: true, plan });
    try { assignUsername(u.id, b.username || null, u.email, true); } catch (e) { db.prepare('DELETE FROM users WHERE id=?').run(u.id); throw e; }
    if (plan !== 'free' && !b.superAdmin) {
      grant(u.id, plan, admin.id, 'admin');
      // Paid for a month or a year: the plan ends then. No period: it runs until changed.
      if (isPeriod(b.period)) db.prepare('UPDATE users SET plan_expires_at=?, plan_period=? WHERE id=?').run(periodEnd({ plan: 'free', plan_expires_at: null }, plan, b.period), b.period, u.id);
    }
    audit(req, 'user.create', 'user', u.id, `${u.email} · ${b.superAdmin ? 'super admin' : PLANS[plan].name}`);
    return { user: userRow(u), password, signInUrl: `${baseFor(req)}/login` };
  });

  app.get('/api/admin/users/:id', async (req) => {
    requireAdmin(req);
    const u = getUser((req.params as { id: string }).id);
    return {
      user: { ...userRow(u), displayName: u.display_name ?? '', phone: u.phone ?? '', country: u.country ?? '', company: u.company ?? '', planExpiresAt: u.plan_expires_at ?? null, extraCreations: u.extra_creations ?? 0, suspendedReason: u.suspended_reason ?? '', lastLoginDevice: deviceName(u.last_login_ua), lastLoginIp: maskIp(u.last_login_ip) },
      apps: appsWithNumbers('a.owner_id=@q', { q: u.id }),
      storage: storageOf(u.id),
      memberOf: db.prepare(`SELECT a.id, a.name, m.role, o.email ownerEmail FROM memberships m JOIN apps a ON a.id=m.app_id JOIN users o ON o.id=a.owner_id WHERE m.user_id=? AND m.role<>'owner' AND a.deleted_at IS NULL ORDER BY a.name LIMIT 100`).all(u.id),
      payments: db.prepare("SELECT id, plan, amount, status, method_name method, created_at createdAt FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 20").all(u.id),
      subscriptions: db.prepare('SELECT plan, creations, amount, source, starts_at startsAt, expires_at expiresAt FROM subscriptions WHERE user_id=? ORDER BY created_at DESC LIMIT 20').all(u.id),
      security: (db.prepare('SELECT kind, ua, ip, at FROM security_events WHERE user_id=? ORDER BY id DESC LIMIT 20').all(u.id) as { kind: string; ua: string; ip: string; at: string }[]).map((e) => ({ kind: e.kind, device: deviceName(e.ua), ip: maskIp(e.ip), at: e.at })),
      sessions: (db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=? AND expires_at > ?').get(u.id, now()) as { n: number }).n,
      audit: db.prepare("SELECT actor_email actor, action, detail, at FROM audit_log WHERE target_type='user' AND target_id=? ORDER BY id DESC LIMIT 20").all(u.id),
    };
  });

  app.patch('/api/admin/users/:id', async (req) => {
    const admin = requireAdmin(req);
    const u = getUser((req.params as { id: string }).id);
    const b = (req.body ?? {}) as { name?: string; email?: string; username?: string; plan?: string; period?: string; planExpiresAt?: string | null; extraCreations?: number; suspended?: boolean; reason?: string; superAdmin?: boolean; emailVerified?: boolean };
    const self = u.id === admin.id;
    if (b.name !== undefined) { db.prepare('UPDATE users SET name=? WHERE id=?').run(validateName(b.name), u.id); audit(req, 'user.rename', 'user', u.id, `${u.name} → ${b.name}`); }
    // A super admin can set anyone's username, any time.
    if (b.username !== undefined && String(b.username).trim().toLowerCase() !== (u.username ?? '').toLowerCase()) {
      const name = validUsername(b.username, true);
      assertUsernameFree(name, u.id);
      db.prepare('UPDATE users SET username=? WHERE id=?').run(name, u.id);
      audit(req, 'user.username', 'user', u.id, `${u.username ?? ''} → ${name}`);
    }
    if (b.email !== undefined && String(b.email).trim().toLowerCase() !== u.email.toLowerCase()) {
      const email = validateEmail(b.email);
      if (db.prepare('SELECT 1 FROM users WHERE lower(email)=lower(?) AND id<>?').get(email, u.id)) throw new HttpError(409, 'EMAIL_TAKEN', 'Another account already uses that email or sign-in ID.');
      // Set by a super admin: counts as confirmed, and the old address is told.
      db.prepare('UPDATE users SET email=?, email_verified_at=CASE WHEN ? LIKE \'%@%\' THEN ? ELSE NULL END WHERE id=?').run(email, email, now(), u.id);
      if (/@/.test(u.email)) sendMail(u.email, 'email_changed', mails.emailChanged(u.name, email));
      audit(req, 'user.email', 'user', u.id, `${u.email} → ${email}`);
    }
    if (b.plan !== undefined) {
      if (!isPlan(b.plan)) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose a plan.');
      const from = PLANS[activePlan(u)].name;
      if (b.plan === 'free') {
        // Down to Free Forever: no end date, nothing to renew. Apps stay; only new ones need room.
        db.prepare('UPDATE users SET plan=?, plan_started_at=?, plan_expires_at=NULL, plan_period=NULL WHERE id=?').run('free', now(), u.id);
      } else if (isPeriod(b.period)) {
        // For a month or a year from today (or from the current end date, when it is the same plan).
        const ends = periodEnd(u, b.plan, b.period);
        db.prepare('UPDATE users SET plan=?, plan_started_at=CASE WHEN plan=? THEN plan_started_at ELSE ? END, plan_expires_at=?, plan_period=? WHERE id=?').run(b.plan, b.plan, now(), ends, b.period, u.id);
      } else {
        db.prepare('UPDATE users SET plan=?, plan_started_at=CASE WHEN plan=? THEN plan_started_at ELSE ? END WHERE id=?').run(b.plan, b.plan, now(), u.id);
      }
      grant(u.id, b.plan, admin.id, 'admin');
      audit(req, 'user.plan', 'user', u.id, `${u.email}: ${from} → ${PLANS[b.plan].name}${isPeriod(b.period) && b.plan !== 'free' ? ` (${b.period})` : ''}`);
      const after = db.prepare('SELECT plan_expires_at FROM users WHERE id=?').get(u.id) as { plan_expires_at: string | null };
      const until = after.plan_expires_at ? ` until ${new Date(after.plan_expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : '';
      notify(u.id, 'billing', b.plan === 'free' ? 'Your plan is now Free Forever.' : `Your plan is now ${PLANS[b.plan].name}${until}.`, `Changed by Jhino from ${from}.`, '/account/plan');
    }
    if (b.planExpiresAt !== undefined) {
      const v = b.planExpiresAt ? String(b.planExpiresAt) : null;
      if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))) throw new HttpError(400, 'VALIDATION_FAILED', 'Use a date like 2027-01-31, or leave it empty for no end date.');
      db.prepare('UPDATE users SET plan_expires_at=? WHERE id=?').run(v ? `${v}T23:59:59.000Z` : null, u.id);
      audit(req, 'user.plan_end', 'user', u.id, v ? `ends ${v}` : 'no end date');
    }
    if (b.extraCreations !== undefined) {
      const n = Math.round(Number(b.extraCreations));
      if (!Number.isFinite(n) || n < -1000 || n > 10000) throw new HttpError(400, 'VALIDATION_FAILED', 'Use a number between -1000 and 10000.');
      db.prepare('UPDATE users SET extra_creations=? WHERE id=?').run(n, u.id);
      audit(req, 'user.allowance', 'user', u.id, `${u.extra_creations ?? 0} → ${n} extra creations`);
    }
    if (b.suspended !== undefined) {
      if (self) throw new HttpError(400, 'VALIDATION_FAILED', 'You cannot suspend yourself.');
      db.prepare('UPDATE users SET disabled=?, suspended_reason=? WHERE id=?').run(b.suspended ? 1 : 0, b.suspended ? String(b.reason ?? '').trim().slice(0, 200) || null : null, u.id);
      if (b.suspended) revokeSessions(u.id);
      audit(req, b.suspended ? 'user.suspend' : 'user.reactivate', 'user', u.id, `${u.email}${b.reason ? ' · ' + b.reason : ''}`);
    }
    if (b.superAdmin !== undefined) {
      if (self && !b.superAdmin) throw new HttpError(400, 'VALIDATION_FAILED', 'You cannot remove your own super admin access.');
      db.prepare('UPDATE users SET is_admin=? WHERE id=?').run(b.superAdmin ? 1 : 0, u.id);
      audit(req, b.superAdmin ? 'user.make_super_admin' : 'user.remove_super_admin', 'user', u.id, u.email);
    }
    if (b.emailVerified !== undefined) {
      db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(b.emailVerified ? now() : null, u.id);
      audit(req, b.emailVerified ? 'user.mark_verified' : 'user.mark_unverified', 'user', u.id, u.email);
    }
    return { user: userRow(getUser(u.id)) };
  });

  /** Everyone on a paid plan (or whose plan ended): when it started, when it ends, what they last paid. */
  app.get('/api/admin/subscriptions', async (req) => {
    requireAdmin(req);
    const q = req.query as { status?: string; q?: string };
    const t = now();
    const soon = new Date(Date.now() + 14 * 864e5).toISOString();
    const base = "kind='person' AND is_admin=0 AND created_by IS NULL AND plan IN ('plus','pro')";
    const cond: Record<string, string> = {
      active: '(plan_expires_at IS NULL OR plan_expires_at > @t)',
      ending: '(plan_expires_at > @t AND plan_expires_at <= @soon)',
      ended: '(plan_expires_at IS NOT NULL AND plan_expires_at <= @t)',
    };
    const status = q.status === 'all' || cond[String(q.status)] ? String(q.status) : 'active';
    const s = String(q.q ?? '').trim().toLowerCase();
    const rows = db.prepare(`SELECT * FROM users WHERE ${base} AND ${status === 'all' ? '1' : cond[status]}
      AND (@s = '' OR lower(email) LIKE @like OR lower(name) LIKE @like) ORDER BY COALESCE(plan_expires_at, '9999') ASC LIMIT 500`)
      .all({ t, soon, s, like: `%${s}%` }) as UserRow[];
    const count = (c: string) => (db.prepare(`SELECT COUNT(*) n FROM users WHERE ${base} AND ${c}`).get({ t, soon }) as { n: number }).n;
    const lastPay = db.prepare("SELECT id, amount, period, status, created_at createdAt FROM payments WHERE user_id=? AND status='approved' ORDER BY created_at DESC LIMIT 1");
    const pending = db.prepare("SELECT id FROM payments WHERE user_id=? AND status='pending' LIMIT 1");
    return {
      counts: { active: count(cond.active), ending: count(cond.ending), ended: count(cond.ended), plus: count(`plan='plus' AND ${cond.active}`), pro: count(`plan='pro' AND ${cond.active}`) },
      subscriptions: rows.map((u) => {
        const us = usage(u);
        const ended = !!u.plan_expires_at && u.plan_expires_at <= t;
        return {
          id: u.id, name: u.name, email: u.email, plan: u.plan as PlanId, planName: PLANS[u.plan as PlanId]?.name ?? u.plan,
          period: u.plan_period === 'year' ? 'year' : u.plan_period === 'month' ? 'month' : null,
          startedAt: u.plan_started_at ?? null, expiresAt: u.plan_expires_at ?? null, status: ended ? 'ended' : u.plan_expires_at && u.plan_expires_at <= soon ? 'ending' : 'active',
          used: us.used, limit: PLANS[u.plan as PlanId]?.creations ?? null, suspended: !!u.disabled,
          lastPayment: lastPay.get(u.id) ?? null, pendingPaymentId: (pending.get(u.id) as { id: string } | undefined)?.id ?? null,
        };
      }),
    };
  });

  /** Add a month or a year to someone's paid plan (from its end date, or from today if it has ended). */
  app.post('/api/admin/users/:id/extend', async (req) => {
    requireAdmin(req);
    const u = getUser((req.params as { id: string }).id);
    const period = (req.body as { period?: string })?.period;
    if (!isPeriod(period)) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose a month or a year.');
    if (!isPlan(u.plan) || u.plan === 'free') throw new HttpError(400, 'VALIDATION_FAILED', 'They are on Free Forever. Choose a paid plan first.');
    const ends = periodEnd(u, u.plan, period);
    db.prepare('UPDATE users SET plan_expires_at=?, plan_period=COALESCE(plan_period, ?) WHERE id=?').run(ends, period, u.id);
    audit(req, 'user.plan_extend', 'user', u.id, `${u.email}: +1 ${period} → ends ${ends.slice(0, 10)}`);
    notify(u.id, 'billing', `Your ${PLANS[u.plan].name} plan now runs until ${new Date(ends).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`, 'Extended by Jhino.', '/account/plan');
    return { expiresAt: ends };
  });

  /** Delete someone's account for good: their apps, data and files go too. The admin types their email to confirm. */
  app.post('/api/admin/users/:id/delete', async (req) => {
    const admin = requireAdmin(req);
    const u = getUser((req.params as { id: string }).id);
    if (u.id === admin.id) throw new HttpError(400, 'VALIDATION_FAILED', 'You cannot delete your own account here. Use Account → Privacy & data.');
    if (String((req.body as { confirm?: string })?.confirm ?? '').trim().toLowerCase() !== u.email.toLowerCase()) throw new HttpError(400, 'VALIDATION_FAILED', `Type ${u.email} to confirm.`);
    if (u.is_admin && (db.prepare("SELECT COUNT(*) n FROM users WHERE is_admin=1 AND disabled=0 AND kind='person'").get() as { n: number }).n <= 1) throw new HttpError(400, 'LAST_ADMIN', 'That is the only super admin.');
    const owned = deleteAccount(u);
    audit(req, 'user.delete', 'user', u.id, `${u.email} · ${owned.length} apps deleted`);
    return { ok: true, apps: owned.length };
  });

  /* ---------- exports: people and payments as CSV (safe to open in Excel) ---------- */
  const csvCell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // no formulas when opened in a spreadsheet
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = (rows: unknown[][]) => '\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  app.get('/api/admin/export/users.csv', async (req, reply) => {
    requireAdmin(req);
    const rows = db.prepare("SELECT * FROM users WHERE kind='person' ORDER BY created_at").all() as UserRow[];
    audit(req, 'export.users', 'export', 'users', `${rows.length} rows`);
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="jhino-users-${now().slice(0, 10)}.csv"`).header('Cache-Control', 'no-store');
    return csv([['id', 'name', 'email', 'role', 'plan', 'period', 'plan_ends', 'apps', 'storage_mb', 'status', 'email_verified', 'joined', 'last_sign_in'],
      ...rows.map((u) => { const r = userRow(u); return [u.id, u.name, u.email, r.role, r.usage?.planName ?? '', u.plan_period ?? '', u.plan_expires_at ?? '', r.usage?.used ?? '', (r.storage / 1048576).toFixed(1), r.status, u.email_verified_at ? 'yes' : 'no', u.created_at, u.last_login_at ?? '']; })]);
  });
  app.get('/api/admin/export/payments.csv', async (req, reply) => {
    requireAdmin(req);
    const rows = db.prepare('SELECT * FROM payments ORDER BY created_at').all() as Record<string, unknown>[];
    audit(req, 'export.payments', 'export', 'payments', `${rows.length} rows`);
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="jhino-payments-${now().slice(0, 10)}.csv"`).header('Cache-Control', 'no-store');
    return csv([['receipt', 'customer', 'email', 'plan', 'period', 'amount_npr', 'expected_npr', 'method', 'reference', 'paid_on', 'status', 'reject_reason', 'submitted', 'reviewed', 'reviewed_by'],
      ...rows.map((p) => ['JH-' + String(p.id).slice(-8).toUpperCase(), p.user_name, p.user_email, p.plan, p.period, p.amount, p.expected_amount, p.method_name, p.reference, p.paid_on, p.status, p.reject_reason, p.created_at, p.reviewed_at, p.reviewed_by_email])]);
  });

  /* ---------- plans & pricing ---------- */
  app.get('/api/admin/plans', async (req) => {
    requireAdmin(req);
    const counts = db.prepare("SELECT plan, COUNT(*) n FROM users WHERE kind='person' AND is_admin=0 AND created_by IS NULL AND (plan_expires_at IS NULL OR plan_expires_at > ?) GROUP BY plan").all(now()) as { plan: string; n: number }[];
    return { plans: publicPlans(), ...planLimitsInfo(), customers: Object.fromEntries(counts.map((c) => [c.plan, c.n])) };
  });
  app.put('/api/admin/plans', async (req) => {
    requireAdmin(req);
    const before = JSON.stringify(publicPlans());
    const plans = savePlans((req.body as { plans?: unknown })?.plans);
    const changes: string[] = [];
    const old = JSON.parse(before) as typeof plans;
    for (const p of plans) {
      const o = old.find((x) => x.id === p.id)!;
      if (o.price !== p.price || o.yearly !== p.yearly) changes.push(`${p.name}: NPR ${o.price}/${o.yearly} → ${p.price}/${p.yearly}`);
      if (o.creations !== p.creations) changes.push(`${p.name}: ${o.creations} → ${p.creations} apps`);
      if (JSON.stringify(o.features) !== JSON.stringify(p.features)) changes.push(`${p.name}: limits changed`);
      if (o.name !== p.name || o.blurb !== p.blurb) changes.push(`${p.name}: wording`);
    }
    audit(req, 'plans.update', 'settings', 'plans', changes.join('; ').slice(0, 900) || 'no change');
    return { plans };
  });

  /* ---------- every app on the platform, with what it holds ---------- */
  function appsWithNumbers(where: string, args: Record<string, unknown>, limitN = 300) {
    return db.prepare(`SELECT a.id, a.name, a.slug, a.access, a.created_at createdAt, a.updated_at updatedAt, a.deleted_at deletedAt, a.live_version liveVersion,
        o.id ownerId, o.name ownerName, o.email ownerEmail, o.username ownerUsername, a.root_slug rootSlug,
        (SELECT COUNT(*) FROM memberships m JOIN users mu ON mu.id=m.user_id WHERE m.app_id=a.id AND mu.kind='person') members,
        (SELECT COUNT(*) FROM app_versions v WHERE v.app_id=a.id) versions,
        (SELECT COALESCE(SUM(v.size),0) FROM app_versions v WHERE v.app_id=a.id) appBytes,
        (SELECT COUNT(*) FROM records r WHERE r.app_id=a.id) records,
        (SELECT COALESCE(SUM(LENGTH(r.data)),0) FROM records r WHERE r.app_id=a.id) recordBytes,
        (SELECT COUNT(*) FROM kv k WHERE k.app_id=a.id AND k.value IS NOT NULL) kvKeys,
        (SELECT COALESCE(SUM(LENGTH(k.value)),0) FROM kv k WHERE k.app_id=a.id) kvBytes,
        (SELECT COUNT(*) FROM files f WHERE f.app_id=a.id AND f.deleted_at IS NULL) files,
        (SELECT COALESCE(SUM(f.size),0) FROM files f WHERE f.app_id=a.id) fileBytes,
        (SELECT MAX(at) FROM activity ac WHERE ac.app_id=a.id) lastActivity,
        (SELECT builder IS NOT NULL FROM app_versions v WHERE v.app_id=a.id AND v.n=a.live_version) built
      FROM apps a JOIN users o ON o.id=a.owner_id WHERE ${where} ORDER BY a.updated_at DESC LIMIT ${limitN}`).all(args) as Record<string, number | string | null>[];
  }
  app.get('/api/admin/apps/all', async (req) => {
    requireAdmin(req);
    const q = req.query as { q?: string; sort?: string };
    const s = String(q.q ?? '').trim().toLowerCase();
    const rows = appsWithNumbers("(@s = '' OR lower(a.name) LIKE @like OR lower(o.email) LIKE @like OR lower(COALESCE(a.slug,'')) LIKE @like OR a.id=@s)", { s, like: `%${s}%` }, 500);
    const size = (r: Record<string, unknown>) => Number(r.appBytes) + Number(r.fileBytes) + Number(r.kvBytes) + Number(r.recordBytes);
    if (q.sort === 'size') rows.sort((x, y) => size(y) - size(x));
    const tot = db.prepare(`SELECT (SELECT COUNT(*) FROM apps WHERE deleted_at IS NULL) apps, (SELECT COALESCE(SUM(size),0) FROM app_versions) appBytes, (SELECT COALESCE(SUM(size),0) FROM files) fileBytes,
      (SELECT COALESCE(SUM(LENGTH(value)),0) FROM kv) kvBytes, (SELECT COALESCE(SUM(LENGTH(data)),0) FROM records) recordBytes, (SELECT COUNT(*) FROM files WHERE deleted_at IS NULL) files, (SELECT COUNT(*) FROM records) records`).get();
    return { apps: rows, totals: tot };
  });
  app.get('/api/admin/apps/:id/detail', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const a = appsWithNumbers('a.id=@id', { id })[0];
    if (!a) throw new HttpError(404, 'NOT_FOUND', 'That app does not exist.');
    return {
      app: a,
      members: db.prepare(`SELECT u.id, u.name, u.email, m.role, u.last_login_at lastLoginAt FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.app_id=? AND u.kind='person' ORDER BY m.role='owner' DESC, m.added_at`).all(id),
      versions: db.prepare('SELECT n, source_name source, size, file_count fileCount, created_at createdAt, builder IS NOT NULL built FROM app_versions WHERE app_id=? ORDER BY n DESC LIMIT 20').all(id),
      collections: db.prepare('SELECT collection, COUNT(*) n, COALESCE(SUM(LENGTH(data)),0) bytes, MAX(updated_at) updatedAt FROM records WHERE app_id=? GROUP BY collection ORDER BY n DESC').all(id),
      keys: db.prepare("SELECT ns, CASE WHEN scope='' THEN 'shared' ELSE 'per person' END scope, key, LENGTH(value) bytes, updated_at updatedAt FROM kv WHERE app_id=? AND value IS NOT NULL ORDER BY LENGTH(value) DESC LIMIT 60").all(id),
      bigFiles: db.prepare('SELECT id, name, type, size, original_size originalSize, status, created_at createdAt, deleted_at deletedAt FROM files WHERE app_id=? ORDER BY size DESC LIMIT 25').all(id),
      activity: db.prepare('SELECT ac.action, ac.detail, ac.at, u.name FROM activity ac LEFT JOIN users u ON u.id=ac.user_id WHERE ac.app_id=? ORDER BY ac.id DESC LIMIT 25').all(id),
    };
  });
  /** Everything an app has saved, as JSON: for support, backups or a customer who asks. Always audited. */
  app.get('/api/admin/apps/:id/export', async (req, reply) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const a = db.prepare('SELECT a.*, u.email owner_email FROM apps a JOIN users u ON u.id=a.owner_id WHERE a.id=?').get(id) as (AppRow & { owner_email: string }) | undefined;
    if (!a) throw new HttpError(404, 'NOT_FOUND', 'That app does not exist.');
    audit(req, 'app.export', 'app', id, `${a.name} (${a.owner_email})`);
    const data = {
      exportedAt: now(), app: { id: a.id, name: a.name, owner: a.owner_email, createdAt: a.created_at, address: a.slug, access: a.access },
      keyValues: db.prepare('SELECT ns, scope, key, value, updated_at updatedAt FROM kv WHERE app_id=? AND value IS NOT NULL').all(id),
      records: (db.prepare('SELECT id, collection, data, created_at createdAt, updated_at updatedAt FROM records WHERE app_id=?').all(id) as { data: string }[]).map((r) => ({ ...r, data: (() => { try { return JSON.parse(r.data); } catch { return r.data; } })() })),
      files: db.prepare('SELECT id, name, type, size, created_at createdAt, deleted_at deletedAt FROM files WHERE app_id=?').all(id),
    };
    reply.header('Content-Type', 'application/json; charset=utf-8').header('Content-Disposition', `attachment; filename="jhino-app-${id}.json"`).header('Cache-Control', 'no-store');
    return JSON.stringify(data, null, 2);
  });

  /* ---------- an announcement to everyone (or one group), in the bell and by email ---------- */
  app.post('/api/admin/announce', async (req) => {
    requireAdmin(req);
    const b = (req.body ?? {}) as { title?: string; body?: string; link?: string; audience?: string };
    const title = String(b.title ?? '').trim().slice(0, 140);
    const body = String(b.body ?? '').trim().slice(0, 600);
    if (title.length < 3) throw new HttpError(400, 'VALIDATION_FAILED', 'Write a title.');
    const link = b.link && /^\/[\w\-/?=&#.]*$/.test(String(b.link)) ? String(b.link) : null;
    const where: Record<string, string> = {
      everyone: "kind='person' AND disabled=0",
      customers: "kind='person' AND disabled=0 AND created_by IS NULL AND is_admin=0",
      paying: "kind='person' AND disabled=0 AND is_admin=0 AND plan IN ('plus','pro') AND (plan_expires_at IS NULL OR plan_expires_at > @t)",
      free: "kind='person' AND disabled=0 AND is_admin=0 AND created_by IS NULL AND (plan='free' OR plan_expires_at <= @t)",
    };
    const aud = where[String(b.audience)] ? String(b.audience) : 'customers';
    const ids = db.prepare(`SELECT id, name FROM users WHERE ${where[aud]}`).all(aud === 'paying' || aud === 'free' ? { t: now() } : {}) as { id: string; name: string }[];
    for (const u of ids) notify(u.id, 'announcements' as Category, title, body, link, { kind: 'announcement', mail: { subject: title, lines: [`Hi ${u.name},`, '', body || title] } });
    audit(req, 'announce', 'announcement', aud, `${title} · ${ids.length} people`);
    return { sent: ids.length };
  });

  app.post('/api/admin/users/:id/password', async (req) => {
    requireAdmin(req);
    const u = getUser((req.params as { id: string }).id);
    const password = makePassword(12);
    db.prepare('UPDATE users SET password_hash=?, password_set=1, password_changed_at=? WHERE id=?').run(await hashPassword(password), now(), u.id);
    revokeSessions(u.id);
    audit(req, 'user.reset_password', 'user', u.id, u.email);
    return { password, email: u.email };
  });
  app.post('/api/admin/users/:id/signout', async (req) => {
    requireAdmin(req);
    const u = getUser((req.params as { id: string }).id);
    revokeSessions(u.id);
    audit(req, 'user.sign_out_everywhere', 'user', u.id, u.email);
    return { ok: true };
  });

  /* ---------- audit log, support, emails ---------- */
  app.get('/api/admin/audit', async (req) => {
    requireAdmin(req);
    const q = req.query as { before?: string; q?: string };
    const before = Number(q.before) || 0;
    const s = String(q.q ?? '').trim().toLowerCase();
    const rows = db.prepare(`SELECT id, actor_email actor, action, target_type targetType, target_id targetId, detail, ip, at FROM audit_log
      WHERE (? = 0 OR id < ?) AND (? = '' OR lower(action) LIKE ? OR lower(COALESCE(actor_email,'')) LIKE ? OR lower(detail) LIKE ?) ORDER BY id DESC LIMIT 100`)
      .all(before, before, s, `%${s}%`, `%${s}%`, `%${s}%`);
    return { entries: rows };
  });
  app.get('/api/admin/support', async (req) => {
    requireAdmin(req);
    const status = (req.query as { status?: string }).status === 'closed' ? 'closed' : (req.query as { status?: string }).status === 'all' ? null : 'open';
    return { tickets: db.prepare(`SELECT id, user_id userId, email, kind, subject, message, diagnostics, status, created_at createdAt, closed_at closedAt FROM support_tickets WHERE (? IS NULL OR status=?) ORDER BY created_at DESC LIMIT 200`).all(status, status) };
  });
  app.patch('/api/admin/support/:id', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const status = (req.body as { status?: string })?.status === 'closed' ? 'closed' : 'open';
    if (!db.prepare('UPDATE support_tickets SET status=?, closed_at=? WHERE id=?').run(status, status === 'closed' ? now() : null, id).changes) throw new HttpError(404, 'NOT_FOUND', 'No such request.');
    audit(req, status === 'closed' ? 'support.close' : 'support.reopen', 'support', id);
    return { ok: true };
  });
  app.get('/api/admin/emails', async (req) => {
    requireAdmin(req);
    const ready = mailReady();
    const rows = db.prepare('SELECT id, to_addr "to", subject, kind, status, error, body, created_at createdAt, sent_at sentAt FROM email_outbox ORDER BY id DESC LIMIT 100').all() as { body: string }[];
    // Without SMTP the body (with its link) is shown so it can be passed on by hand; with SMTP it is not needed here.
    return { mailReady: ready, emails: rows.map((r) => ({ ...r, body: ready ? '' : r.body })) };
  });

  /* ---------- settings ---------- */
  /** Send a test email (to check Resend or SMTP). The result shows in Recent emails. */
  app.post('/api/admin/mail/test', async (req) => {
    const admin = requireAdmin(req);
    limit(req, 'mail-test', 10, 3600_000, admin.id);
    const to = validateEmail((req.body as { to?: string } | undefined)?.to ?? admin.email);
    sendMail(to, 'test', mails.test(to));
    audit(req, 'mail.test', 'user', admin.id, to);
    return { ok: true, to, sender: mailSender() };
  });

  app.get('/api/admin/settings', async (req) => {
    requireAdmin(req);
    return {
      uploads: setting('uploads') === 'on', signups: setting('signups') === 'on', supportEmail: setting('support_email') || config.mail.supportEmail,
      mailReady: mailReady(), mailSender: mailSender(), mailFrom: config.mail.from, google: providerReady('google'), apple: providerReady('apple'), publicUrl: config.publicUrl || baseFor(req),
    };
  });
  app.put('/api/admin/settings', async (req) => {
    requireAdmin(req);
    const b = (req.body ?? {}) as { uploads?: boolean; signups?: boolean; supportEmail?: string };
    if (b.uploads !== undefined) { setSetting('uploads', b.uploads ? 'on' : 'off'); audit(req, 'settings.uploads', 'settings', 'uploads', b.uploads ? 'on' : 'off'); }
    if (b.signups !== undefined) { setSetting('signups', b.signups ? 'on' : 'off'); audit(req, 'settings.signups', 'settings', 'signups', b.signups ? 'on' : 'off'); }
    if (b.supportEmail !== undefined) {
      const e = String(b.supportEmail).trim();
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, 'VALIDATION_FAILED', 'Enter a valid support email, or leave it empty.');
      setSetting('support_email', e); audit(req, 'settings.support_email', 'settings', 'support_email', e);
    }
    return { ok: true };
  });

  /* ---------- hosting: jhino.com/<address> ---------- */
  const hostedRow = (a: AppRow & { owner_email?: string; owner_name?: string }, base: string) => ({
    id: a.id, name: a.name, ownerEmail: a.owner_email ?? '', ownerName: a.owner_name ?? '', updatedAt: a.updated_at, ...shareInfo(a, base),
  });
  app.get('/api/admin/hosting', async (req) => {
    requireAdmin(req);
    const base = baseFor(req);
    const rows = db.prepare(`SELECT a.*, u.email owner_email, u.name owner_name FROM apps a JOIN users u ON u.id=a.owner_id
      WHERE a.deleted_at IS NULL AND (a.slug IS NOT NULL OR a.root_slug IS NOT NULL OR a.access <> 'private') ORDER BY a.root_slug IS NULL, a.root_slug, a.slug IS NULL, a.updated_at DESC LIMIT 300`).all() as (AppRow & { owner_email: string; owner_name: string })[];
    return { apps: rows.map((a) => hostedRow(a, base)), reserved: [...RESERVED].sort() };
  });
  app.get('/api/admin/apps', async (req) => {
    requireAdmin(req);
    const s = String((req.query as { q?: string }).q ?? '').trim().toLowerCase();
    const rows = db.prepare(`SELECT a.*, u.email owner_email, u.name owner_name FROM apps a JOIN users u ON u.id=a.owner_id
      WHERE a.deleted_at IS NULL AND (? = '' OR lower(a.name) LIKE ? OR lower(u.email) LIKE ? OR a.id=?) ORDER BY a.updated_at DESC LIMIT 30`).all(s, `%${s}%`, `%${s}%`, s) as (AppRow & { owner_email: string; owner_name: string })[];
    return { apps: rows.map((a) => hostedRow(a, baseFor(req))) };
  });
  /**
   * Give an app a top-level address, jhino.com/<name> (or take it away). Only super admins do this; it
   * cannot be anyone's username. Owners give their apps addresses under their own username in Share.
   */
  app.put('/api/admin/apps/:id/address', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const a = db.prepare('SELECT * FROM apps WHERE id=? AND deleted_at IS NULL').get(id) as AppRow | undefined;
    if (!a) throw new HttpError(404, 'NOT_FOUND', 'That app does not exist.');
    const b = (req.body ?? {}) as { slug?: string | null; access?: string; publicRole?: string; password?: string };
    const slug = b.slug ? validSlug(b.slug, true) : null;
    if (slug) assertRootFree(slug, { appId: id });
    db.prepare('UPDATE apps SET root_slug=? WHERE id=?').run(slug, id);
    // An address is for opening without being added: make the app open by link if it was private.
    const access = b.access ?? (slug && (a.access ?? 'private') === 'private' ? 'public' : undefined);
    const next = await setSharing(id, { access, publicRole: b.publicRole, password: b.password });
    audit(req, slug ? 'hosting.address_set' : 'hosting.address_removed', 'app', id, `${a.name}${slug ? ' → /' + slug : ''}${access ? ' · ' + access : ''}`);
    return hostedRow({ ...next, owner_email: '', owner_name: '' }, baseFor(req));
  });
  /** Host an HTML file at an address in one step. The app belongs to the super admin who hosts it. */
  app.post('/api/admin/host', async (req) => {
    const admin = requireAdmin(req);
    const up = await readUpload(req);
    const slug = validSlug(up.fields.slug, true);
    assertRootFree(slug);
    const id = await createAppFromUpload(admin, up.buf, up.filename, up.name);
    db.prepare('UPDATE apps SET root_slug=? WHERE id=?').run(slug, id);
    const access = up.fields.access === 'password' ? 'password' : 'public';
    await setSharing(id, { access, publicRole: 'viewer', password: up.fields.password || undefined });
    audit(req, 'hosting.host', 'app', id, `/${slug} · ${access}`);
    const a = db.prepare('SELECT * FROM apps WHERE id=?').get(id) as AppRow;
    return hostedRow({ ...a, owner_email: admin.email, owner_name: admin.name }, baseFor(req));
  });
}
