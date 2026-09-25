import { useEffect, useState } from 'react';
import type { PlanFeatures } from './api';

/*
 * What each plan includes. Super admins set prices and limits in Super Admin → Plans & pricing;
 * the server enforces them and serves them at /api/plans. This file turns them into the lines the
 * website, checkout and Plan & usage show. DEFAULTS are only for the first paint.
 */

export type PlanId = 'free' | 'plus' | 'pro';
export type Period = 'month' | 'year';
export interface ServerPlan { id: PlanId; name: string; price: number; yearly: number; creations: number; blurb: string; features: PlanFeatures }

export interface PlanCard {
  id: PlanId;
  name: string;
  /** NPR per month, and per year. */
  monthly: number;
  yearly: number;
  apps: number;
  addresses: number;
  shortLinks: number;
  maxUploadMB: number;
  themeTier: 'free' | 'plus' | 'pro';
  flags: Pick<PlanFeatures, 'customCodes' | 'passwordLinks' | 'hideBar' | 'download' | 'linkStats' | 'prioritySupport'>;
  blurb: string;
  /** What a card lists, in order. */
  features: string[];
  /** Shown faded on the card: what a higher plan adds. */
  missing: string[];
}

const DEFAULTS: ServerPlan[] = [
  { id: 'free', name: 'Free Forever', price: 0, yearly: 0, creations: 1, blurb: 'One client room, free for as long as you like.',
    features: { addresses: 1, shortLinks: 5, customCodes: false, passwordLinks: false, hideBar: false, download: false, linkStats: false, prioritySupport: false, maxUploadMB: 20, themeTier: 'free', branding: 'popup', customPage: false, analyticsDays: 7 } },
  { id: 'plus', name: 'Plus', price: 500, yearly: 5000, creations: 10, blurb: 'A freelancer or a small studio with a handful of clients.',
    features: { addresses: 10, shortLinks: 100, customCodes: true, passwordLinks: true, hideBar: true, download: true, linkStats: false, prioritySupport: false, maxUploadMB: 50, themeTier: 'plus', branding: 'badge', customPage: false, analyticsDays: 30 } },
  { id: 'pro', name: 'Pro', price: 2000, yearly: 20000, creations: 50, blurb: 'A studio or agency with a room for every client.',
    features: { addresses: 50, shortLinks: 1000, customCodes: true, passwordLinks: true, hideBar: true, download: true, linkStats: true, prioritySupport: true, maxUploadMB: 50, themeTier: 'pro', branding: 'none', customPage: true, analyticsDays: 365 } },
];

export const nprAmount = (n: number) => n.toLocaleString('en-IN');
const plural = (n: number, one: string, many = one + 's') => `${nprAmount(n)} ${n === 1 ? one : many}`;

export function cardOf(p: ServerPlan): PlanCard {
  const f = p.features;
  const features = [
    p.id === 'free' ? `${plural(p.creations, 'app')}, uploaded or built here` : plural(p.creations, 'app'),
    `Your page at jhino.com/you: ${f.themeTier === 'pro' ? 'all 30 designs' : f.themeTier === 'plus' ? '15 designs' : '5 designs'}${f.customPage ? ' or your own HTML' : ''}`,
    `${plural(f.addresses, 'address', 'addresses')} under your name`,
    'Share by sign-in or public link',
    ...(f.passwordLinks ? ['Password links'] : []),
    ...(f.hideBar ? ['Hide the top bar: opens like its own site'] : []),
    ...(f.download ? ['Download any app as an HTML file'] : []),
    `${plural(f.shortLinks, 'short link')}${f.customCodes ? ' with your own names' : ''}`,
    ...(f.linkStats ? ['Daily click history for every link'] : []),
    `Page analytics: ${f.analyticsDays >= 365 ? 'a full year' : `${f.analyticsDays} days`}`,
    f.branding === 'none' ? 'No Jhino branding on your page' : f.branding === 'badge' ? 'A small Jhino badge, no popup' : 'Jhino badge and popup on your page',
    `Files up to ${nprAmount(f.maxUploadMB)} MB each (videos as links)`,
    ...(f.prioritySupport ? ['Priority support'] : []),
  ];
  const missing = [
    ...(!f.passwordLinks ? ['Password links'] : []),
    ...(!f.hideBar ? ['Hide the top bar'] : []),
    ...(!f.download ? ['Download as an HTML file'] : []),
    ...(!f.linkStats && f.passwordLinks ? ['Daily click history'] : []),
  ].slice(0, 3);
  return {
    id: p.id, name: p.name, monthly: p.price, yearly: p.yearly, apps: p.creations, addresses: f.addresses, shortLinks: f.shortLinks,
    maxUploadMB: f.maxUploadMB, themeTier: f.themeTier, blurb: p.blurb, features, missing,
    flags: { customCodes: f.customCodes, passwordLinks: f.passwordLinks, hideBar: f.hideBar, download: f.download, linkStats: f.linkStats, prioritySupport: f.prioritySupport },
  };
}

/** The first paint, before /api/plans answers. */
export const PLAN_CARDS: PlanCard[] = DEFAULTS.map(cardOf);

let current: PlanCard[] | null = null;
let loading: Promise<PlanCard[]> | null = null;
function fetchPlans() {
  loading ??= fetch('/api/plans', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((j: { plans: ServerPlan[] }) => (current = j.plans.map(cardOf)))
    .catch(() => { loading = null; return current ?? PLAN_CARDS; });
  return loading;
}
/** Force the next usePlans() to ask the server again (after a super admin saves new prices). */
export function refreshPlans() { loading = null; current = null; return fetchPlans(); }

/** The plans in force, as the server has them. */
export function usePlans(): PlanCard[] {
  const [plans, setPlans] = useState<PlanCard[]>(current ?? PLAN_CARDS);
  useEffect(() => { let live = true; fetchPlans().then((p) => { if (live) setPlans(p); }); return () => { live = false; }; }, []);
  return plans;
}

export const planCard = (plans: PlanCard[], id: string) => plans.find((p) => p.id === id) ?? plans[0];
export const priceFor = (p: PlanCard, period: Period) => (period === 'year' ? p.yearly : p.monthly);
/** Whole months saved by paying for a year (0 when a year costs twelve months or more). */
export const freeMonths = (p: PlanCard) => (p.monthly > 0 ? Math.max(0, Math.round(12 - p.yearly / p.monthly)) : 0);
export const bestFreeMonths = (plans: PlanCard[]) => Math.max(0, ...plans.map(freeMonths));
export const freeMonthsText = (n: number) => (n > 0 ? `${n} month${n === 1 ? '' : 's'} free` : '');
