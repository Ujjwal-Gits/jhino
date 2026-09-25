import { db, now, type UserRow } from './db.js';
import { HttpError } from './errors.js';
import { notifyUser } from './realtime.js';
import { sendMail, type Mail } from './mail.js';
import { setting, setSetting } from './security.js';
import { config } from './config.js';

/* ---------------- plans ---------------- */
export type PlanId = 'free' | 'plus' | 'pro';
export type Period = 'month' | 'year';
export interface Features {
  /** Apps with their own address, jhino.com/<name>. */
  addresses: number;
  shortLinks: number;
  /** Short links with a name you choose (otherwise a random code). */
  customCodes: boolean;
  passwordLinks: boolean;
  hideBar: boolean;
  download: boolean;
  /** Clicks per day for each short link (everyone sees the total). */
  linkStats: boolean;
  prioritySupport: boolean;
  /** Largest single upload (a photo, a video, an app's ZIP) for people on this plan, in MB. */
  maxUploadMB: number;
}
export interface Plan { id: PlanId; name: string; price: number; yearly: number; creations: number; blurb: string; features: Features }
/** The starting plans. Super admins change prices and limits in Super Admin → Plans & pricing (kept in settings). */
const DEFAULT_PLANS: Record<PlanId, Plan> = {
  free: { id: 'free', name: 'Free Forever', price: 0, yearly: 0, creations: 1, blurb: 'One client room, free for as long as you like.',
    features: { addresses: 1, shortLinks: 5, customCodes: false, passwordLinks: false, hideBar: false, download: false, linkStats: false, prioritySupport: false, maxUploadMB: 20 } },
  plus: { id: 'plus', name: 'Plus', price: 500, yearly: 5000, creations: 10, blurb: 'A freelancer or a small studio with a handful of clients.',
    features: { addresses: 10, shortLinks: 100, customCodes: true, passwordLinks: true, hideBar: true, download: true, linkStats: false, prioritySupport: false, maxUploadMB: 50 } },
  pro: { id: 'pro', name: 'Pro', price: 2000, yearly: 20000, creations: 50, blurb: 'A studio or agency with a room for every client.',
    features: { addresses: 50, shortLinks: 1000, customCodes: true, passwordLinks: true, hideBar: true, download: true, linkStats: true, prioritySupport: true, maxUploadMB: 50 } },
};
/** The plans in force. Everything reads them at call time, so a saved change applies at once. */
export const PLANS: Record<PlanId, Plan> = JSON.parse(JSON.stringify(DEFAULT_PLANS));
/** Super admins: everything, no limits (uploads only up to the server's own MAX_FILE_MB). */
const UNLIMITED: Features = { addresses: 1e9, shortLinks: 1e9, customCodes: true, passwordLinks: true, hideBar: true, download: true, linkStats: true, prioritySupport: true, maxUploadMB: 1e9 };
const PLAN_IDS: PlanId[] = ['free', 'plus', 'pro'];
const serverMaxMB = () => Math.floor(config.limits.fileBytes / 1048576);

function applyPlans(saved: Partial<Record<PlanId, Partial<Plan> & { features?: Partial<Features> }>>) {
  for (const id of PLAN_IDS) {
    const d = DEFAULT_PLANS[id]; const s = saved[id] ?? {};
    PLANS[id] = { ...d, ...s, id, features: { ...d.features, ...(s.features ?? {}) } };
  }
}
function loadPlans() {
  try { applyPlans(JSON.parse(setting('plans') || '{}')); } catch { applyPlans({}); }
}
loadPlans();

/** Check and save new prices and limits. Free Forever always costs nothing. */
export function savePlans(input: unknown) {
  // Either { free: {...}, plus: {...} } or the list that /api/plans returns.
  const src = (Array.isArray(input) ? Object.fromEntries(input.map((p) => [String((p as { id?: string })?.id), p])) : input ?? {}) as Record<string, Record<string, unknown>>;
  const int = (v: unknown, min: number, max: number, what: string) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, 'VALIDATION_FAILED', `${what}: use a whole number from ${min} to ${max.toLocaleString('en-IN')}.`);
    return n;
  };
  const out: Record<string, Plan> = {};
  for (const id of PLAN_IDS) {
    const p = src[id] ?? {}; const cur = PLANS[id]; const f = (p.features ?? {}) as Record<string, unknown>;
    const name = String(p.name ?? cur.name).trim().slice(0, 40);
    if (!name) throw new HttpError(400, 'VALIDATION_FAILED', 'Every plan needs a name.');
    const label = name;
    const price = id === 'free' ? 0 : int(p.price ?? cur.price, 1, 10_000_000, `${label} monthly price`);
    const yearly = id === 'free' ? 0 : int(p.yearly ?? cur.yearly, 1, 100_000_000, `${label} yearly price`);
    out[id] = {
      id, name, price, yearly, creations: int(p.creations ?? cur.creations, id === 'free' ? 0 : 1, 100_000, `${label} apps`),
      blurb: String(p.blurb ?? cur.blurb).trim().slice(0, 160),
      features: {
        addresses: int(f.addresses ?? cur.features.addresses, 0, 100_000, `${label} addresses`),
        shortLinks: int(f.shortLinks ?? cur.features.shortLinks, 0, 1_000_000, `${label} short links`),
        maxUploadMB: int(f.maxUploadMB ?? cur.features.maxUploadMB, 1, serverMaxMB(), `${label} largest upload (MB)`),
        customCodes: !!(f.customCodes ?? cur.features.customCodes), passwordLinks: !!(f.passwordLinks ?? cur.features.passwordLinks),
        hideBar: !!(f.hideBar ?? cur.features.hideBar), download: !!(f.download ?? cur.features.download),
        linkStats: !!(f.linkStats ?? cur.features.linkStats), prioritySupport: !!(f.prioritySupport ?? cur.features.prioritySupport),
      },
    };
  }
  setSetting('plans', JSON.stringify(out));
  applyPlans(out as Record<PlanId, Plan>);
  return Object.values(PLANS);
}
export const publicPlans = () => PLAN_IDS.map((id) => PLANS[id]);
export const planLimitsInfo = () => ({ serverMaxMB: serverMaxMB() });

/**
 * The largest single upload allowed, in bytes. It follows the plan of the app's owner (who pays for it);
 * super admins, as uploader or owner, are held only by the server's MAX_FILE_MB.
 */
export function uploadLimitBytes(owner: PlanFields | undefined, uploader: Pick<UserRow, 'is_admin'>, serverCap = config.limits.fileBytes) {
  if (uploader.is_admin || !owner || owner.is_admin) return serverCap;
  return Math.min(serverCap, featuresOf(owner).maxUploadMB * 1048576);
}
type PlanFields = Pick<UserRow, 'plan' | 'plan_expires_at' | 'is_admin'>;
export const isPlan = (p: unknown): p is PlanId => typeof p === 'string' && p in PLANS;
export const isPeriod = (p: unknown): p is Period => p === 'month' || p === 'year';
export const priceOf = (plan: PlanId, period: Period) => (period === 'year' ? PLANS[plan].yearly : PLANS[plan].price);
export const npr = (n: number) => `NPR ${n.toLocaleString('en-IN')}`;

/** The plan someone is on right now: a paid plan that has ended counts as Free Forever. */
export function activePlan(u: Pick<UserRow, 'plan' | 'plan_expires_at'>): PlanId {
  const expired = !!u.plan_expires_at && Date.parse(u.plan_expires_at) < Date.now();
  return !expired && isPlan(u.plan) ? u.plan : 'free';
}
export function featuresOf(u: PlanFields): Features {
  return u.is_admin ? UNLIMITED : PLANS[activePlan(u)].features;
}
type Gate = 'customCodes' | 'passwordLinks' | 'hideBar' | 'download' | 'linkStats';
/** Refuse an action the person's plan does not include. `what` starts the sentence "... is on Plus and Pro." */
export function assertFeature(u: PlanFields, key: Gate, what: string) {
  if (featuresOf(u)[key]) return;
  const on = Object.values(PLANS).filter((p) => p.features[key]).map((p) => p.name);
  const list = on.length > 1 ? `${on.slice(0, -1).join(', ')} and ${on[on.length - 1]}` : on[0];
  throw new HttpError(403, 'PLAN_FEATURE', `${what} is on ${list}. Upgrade in Plan & usage.`, { feature: key });
}

/** Creations used and allowed, decided on the server only. Super admins have no limit. */
export function usage(u: UserRow) {
  const used = (db.prepare('SELECT COUNT(*) n FROM apps WHERE owner_id=?').get(u.id) as { n: number }).n;
  const addressesUsed = (db.prepare('SELECT COUNT(*) n FROM apps WHERE owner_id=? AND slug IS NOT NULL').get(u.id) as { n: number }).n;
  const linksUsed = (db.prepare('SELECT COUNT(*) n FROM short_links WHERE owner_id=?').get(u.id) as { n: number }).n;
  const features = featuresOf(u);
  const period: Period = u.plan_period === 'year' ? 'year' : 'month';
  if (u.is_admin) return { plan: 'pro' as PlanId, planName: 'Super admin', used, limit: null as number | null, remaining: null as number | null, expiresAt: null as string | null, expired: false, period, addressesUsed, linksUsed, features };
  const expired = !!u.plan_expires_at && Date.parse(u.plan_expires_at) < Date.now();
  const plan = activePlan(u);
  const limit = Math.max(0, PLANS[plan].creations + (u.extra_creations ?? 0));
  return { plan, planName: PLANS[plan].name, used, limit, remaining: Math.max(0, limit - used), expiresAt: u.plan_expires_at ?? null, expired, period, addressesUsed, linksUsed, features };
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

/** One more address for this person's apps? (The app being changed does not count against itself.) */
export function assertAddressAllowance(u: UserRow, exceptAppId: string | null) {
  const f = featuresOf(u);
  const n = (db.prepare('SELECT COUNT(*) n FROM apps WHERE owner_id=? AND slug IS NOT NULL AND id<>?').get(u.id, exceptAppId ?? '') as { n: number }).n;
  if (n >= f.addresses) {
    throw new HttpError(403, 'LIMIT_REACHED', `Your plan includes ${f.addresses} address${f.addresses === 1 ? '' : 'es'}, and ${n === 1 ? 'it is' : 'they are all'} in use. Remove one from another app, or upgrade in Plan & usage.`);
  }
}

/** When a plan paid for one period ends. Paying again for the plan you already have adds to its end date. */
export function periodEnd(u: Pick<UserRow, 'plan' | 'plan_expires_at'>, plan: PlanId, period: Period, from = new Date()) {
  const cur = u.plan_expires_at ? new Date(u.plan_expires_at) : null;
  const start = u.plan === plan && cur && cur > from ? cur : from;
  const end = new Date(start);
  if (period === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1); else end.setUTCMonth(end.getUTCMonth() + 1);
  return end.toISOString();
}

/** A few days before a paid plan ends, and when it has ended, the person hears about it once. */
function planNotices() {
  const soon = new Date(Date.now() + 3 * 864e5).toISOString();
  const rows = db.prepare("SELECT id, plan, plan_expires_at FROM users WHERE kind='person' AND is_admin=0 AND plan IN ('plus','pro') AND plan_expires_at IS NOT NULL AND plan_expires_at < ?").all(soon) as { id: string; plan: PlanId; plan_expires_at: string }[];
  for (const r of rows) {
    const ended = Date.parse(r.plan_expires_at) < Date.now();
    const key = `plan_notice:${ended ? 'ended' : 'soon'}:${r.id}`;
    if (setting(key) === r.plan_expires_at) continue;
    setSetting(key, r.plan_expires_at);
    const day = new Date(r.plan_expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    if (ended) notify(r.id, 'billing', `Your ${PLANS[r.plan].name} plan has ended.`, 'Your apps keep working. To create more or use paid features again, renew in Plan & usage.', '/account/plan');
    else notify(r.id, 'billing', `Your ${PLANS[r.plan].name} plan ends on ${day}.`, 'Renew in Plan & usage to keep the same plan. Paying early adds to the end date.', '/account/plan');
  }
}
export function startPlanNotices() {
  const run = () => { try { planNotices(); } catch (e) { console.error('plan notices', e); } };
  setTimeout(run, 5000).unref();
  setInterval(run, 3600_000).unref();
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
