import type { FastifyInstance } from 'fastify';
import { config, makePassword } from './config.js';
import { db, newId, now, type AppRow, type UserRow } from './db.js';
import { HttpError, canCreateApps, createUser, hashPassword, requireAdmin, revokeSessions, validateEmail, validateName, validatePassword } from './auth.js';
import { audit, deviceName, maskIp, setSetting, setting } from './security.js';
import { PLANS, activePlan, isPeriod, isPlan, notify, periodEnd, usage, type PlanId } from './plans.js';
import { mailReady } from './mail.js';
import { providerReady } from './oauth.js';
import { RESERVED, assertNameFree, baseFor, setSharing, shareInfo, validSlug } from './publicshare.js';
import { createAppFromUpload, readUpload } from './apps.js';

/*
 * The Super Admin dashboard: platform owners manage customers, plans, payments (billing.ts),
 * hosting addresses and settings. Everything sensitive lands in the audit log.
 */

function userRow(u: UserRow) {
  const last = db.prepare('SELECT status FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(u.id) as { status: string } | undefined;
  return {
    id: u.id, name: u.name, email: u.email, emailVerified: /@/.test(u.email) ? !!u.email_verified_at : null, createdAt: u.created_at,
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
    const b = (req.body ?? {}) as { name?: string; email?: string; password?: string; plan?: string; period?: string; superAdmin?: boolean };
    const plan = isPlan(b.plan) ? b.plan : 'free';
    const password = b.password ? validatePassword(b.password) : makePassword(12);
    const u = await createUser(validateEmail(b.email), validateName(b.name), password, !!b.superAdmin, { verified: true, plan });
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
      apps: db.prepare('SELECT id, name, created_at createdAt, deleted_at deletedAt, access, slug FROM apps WHERE owner_id=? ORDER BY created_at DESC').all(u.id),
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
    const b = (req.body ?? {}) as { name?: string; plan?: string; period?: string; planExpiresAt?: string | null; extraCreations?: number; suspended?: boolean; reason?: string; superAdmin?: boolean; emailVerified?: boolean };
    const self = u.id === admin.id;
    if (b.name !== undefined) { db.prepare('UPDATE users SET name=? WHERE id=?').run(validateName(b.name), u.id); audit(req, 'user.rename', 'user', u.id, `${u.name} → ${b.name}`); }
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
  app.get('/api/admin/settings', async (req) => {
    requireAdmin(req);
    return {
      uploads: setting('uploads') === 'on', signups: setting('signups') === 'on', supportEmail: setting('support_email') || config.mail.supportEmail,
      mailReady: mailReady(), google: providerReady('google'), apple: providerReady('apple'), publicUrl: config.publicUrl || baseFor(req),
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
      WHERE a.deleted_at IS NULL AND (a.slug IS NOT NULL OR a.access <> 'private') ORDER BY a.slug IS NULL, a.slug, a.updated_at DESC LIMIT 300`).all() as (AppRow & { owner_email: string; owner_name: string })[];
    return { apps: rows.map((a) => hostedRow(a, base)), reserved: [...RESERVED].sort() };
  });
  app.get('/api/admin/apps', async (req) => {
    requireAdmin(req);
    const s = String((req.query as { q?: string }).q ?? '').trim().toLowerCase();
    const rows = db.prepare(`SELECT a.*, u.email owner_email, u.name owner_name FROM apps a JOIN users u ON u.id=a.owner_id
      WHERE a.deleted_at IS NULL AND (? = '' OR lower(a.name) LIKE ? OR lower(u.email) LIKE ? OR a.id=?) ORDER BY a.updated_at DESC LIMIT 30`).all(s, `%${s}%`, `%${s}%`, s) as (AppRow & { owner_email: string; owner_name: string })[];
    return { apps: rows.map((a) => hostedRow(a, baseFor(req))) };
  });
  /** Give an app its own address (or take it away). An address only works when the app is open by link. */
  app.put('/api/admin/apps/:id/address', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const a = db.prepare('SELECT * FROM apps WHERE id=? AND deleted_at IS NULL').get(id) as AppRow | undefined;
    if (!a) throw new HttpError(404, 'NOT_FOUND', 'That app does not exist.');
    const b = (req.body ?? {}) as { slug?: string | null; access?: string; publicRole?: string; password?: string };
    const slug = b.slug ? validSlug(b.slug) : null;
    if (slug) assertNameFree(slug, { appId: id });
    db.prepare('UPDATE apps SET slug=? WHERE id=?').run(slug, id);
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
    const slug = validSlug(up.fields.slug);
    assertNameFree(slug);
    const id = await createAppFromUpload(admin, up.buf, up.filename, up.name, slug);
    const access = up.fields.access === 'password' ? 'password' : 'public';
    await setSharing(id, { access, publicRole: 'viewer', password: up.fields.password || undefined });
    audit(req, 'hosting.host', 'app', id, `/${slug} · ${access}`);
    const a = db.prepare('SELECT * FROM apps WHERE id=?').get(id) as AppRow;
    return hostedRow({ ...a, owner_email: admin.email, owner_name: admin.name }, baseFor(req));
  });
}
