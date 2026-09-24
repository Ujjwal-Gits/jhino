import { db, now, type UserRow } from './db.js';
import { HttpError } from './errors.js';
import { notifyUser } from './realtime.js';
import { sendMail, type Mail } from './mail.js';

/* ---------------- plans ---------------- */
export type PlanId = 'free' | 'plus' | 'pro';
export const PLANS: Record<PlanId, { id: PlanId; name: string; price: number; creations: number; blurb: string }> = {
  free: { id: 'free', name: 'Free Forever', price: 0, creations: 1, blurb: 'Try Jhino with one app, free for as long as you like.' },
  plus: { id: 'plus', name: 'Plus', price: 500, creations: 10, blurb: 'For a freelancer or a small studio with a few clients.' },
  pro: { id: 'pro', name: 'Pro', price: 2000, creations: 50, blurb: 'For a studio or agency running many client rooms.' },
};
export const isPlan = (p: unknown): p is PlanId => typeof p === 'string' && p in PLANS;
export const npr = (n: number) => `NPR ${n.toLocaleString('en-IN')}`;

/** Creations used and allowed, decided on the server only. Super admins have no limit. */
export function usage(u: UserRow) {
  const used = (db.prepare('SELECT COUNT(*) n FROM apps WHERE owner_id=?').get(u.id) as { n: number }).n;
  if (u.is_admin) return { plan: 'pro' as PlanId, planName: 'Super admin', used, limit: null as number | null, remaining: null as number | null, expiresAt: null as string | null, expired: false };
  const expired = !!u.plan_expires_at && Date.parse(u.plan_expires_at) < Date.now();
  const plan: PlanId = !expired && isPlan(u.plan) ? u.plan : 'free';
  const limit = Math.max(0, PLANS[plan].creations + (u.extra_creations ?? 0));
  return { plan, planName: PLANS[plan].name, used, limit, remaining: Math.max(0, limit - used), expiresAt: u.plan_expires_at ?? null, expired };
}

/** Call inside the same transaction as the insert, so two requests at once cannot both slip past the limit. */
export function assertCanCreate(userId: string) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(userId) as UserRow | undefined;
  if (!u) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in.');
  const us = usage(u);
  if (us.limit !== null && us.used >= us.limit) {
    throw new HttpError(403, 'LIMIT_REACHED', us.limit === 0
      ? 'Your plan has no creations left. Upgrade in Plan & usage to create apps.'
      : `You have used all ${us.limit} creation${us.limit === 1 ? '' : 's'} on ${us.planName}. Upgrade in Plan & usage to create more, or delete an app for good.`,
      { used: us.used, limit: us.limit });
  }
}

/* ---------------- notifications ---------------- */
export type Category = 'security' | 'account' | 'billing' | 'product' | 'announcements' | 'marketing' | 'bookings';
/** Security, account and important announcements always arrive; the rest follow the person's choices. */
export const ESSENTIAL: Category[] = ['security', 'account', 'announcements'];
const DEFAULT_PREFS: Record<Category, { inapp: boolean; email: boolean }> = {
  security: { inapp: true, email: true }, account: { inapp: true, email: true }, announcements: { inapp: true, email: true },
  billing: { inapp: true, email: true }, bookings: { inapp: true, email: true }, product: { inapp: true, email: false }, marketing: { inapp: false, email: false },
};
export function prefsOf(u: Pick<UserRow, 'notify_prefs'>) {
  let saved: Partial<Record<Category, { inapp?: boolean; email?: boolean }>> = {};
  try { saved = JSON.parse(u.notify_prefs || '{}'); } catch { /* reset below */ }
  const out = {} as Record<Category, { inapp: boolean; email: boolean }>;
  (Object.keys(DEFAULT_PREFS) as Category[]).forEach((c) => {
    out[c] = ESSENTIAL.includes(c) ? { inapp: true, email: true } : { inapp: saved[c]?.inapp ?? DEFAULT_PREFS[c].inapp, email: saved[c]?.email ?? DEFAULT_PREFS[c].email };
  });
  return out;
}

/** A bell notification (live to open tabs) and, when the person wants it, an email. */
export function notify(userId: string, category: Category, title: string, body = '', link: string | null = null, email?: { kind: string; mail: Mail }) {
  const u = db.prepare('SELECT id, email, notify_prefs, kind FROM users WHERE id=?').get(userId) as (Pick<UserRow, 'id' | 'email' | 'notify_prefs' | 'kind'>) | undefined;
  if (!u || u.kind === 'visitor') return;
  const p = prefsOf(u)[category];
  if (p.inapp) {
    const at = now();
    const id = Number(db.prepare('INSERT INTO notifications(user_id,category,title,body,link,created_at) VALUES(?,?,?,?,?,?)').run(userId, category, title.slice(0, 200), body.slice(0, 600), link, at).lastInsertRowid);
    notifyUser(userId, 'notification', { id, category, title, body, link, createdAt: at });
  }
  if (email && p.email) sendMail(u.email, email.kind, email.mail);
}

/** Tell every super admin (for example: a payment is waiting). */
export function notifyAdmins(category: Category, title: string, body = '', link: string | null = null) {
  for (const a of db.prepare("SELECT id FROM users WHERE is_admin=1 AND disabled=0 AND kind='person'").all() as { id: string }[]) notify(a.id, category, title, body, link);
}
