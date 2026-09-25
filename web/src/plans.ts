/*
 * What each plan includes. The server (server/plans.ts) enforces the same numbers; this copy is for
 * showing them on the website, at checkout and in Plan & usage. Keep the two in step.
 */

export type PlanId = 'free' | 'plus' | 'pro';
export type Period = 'month' | 'year';

export interface PlanCard {
  id: PlanId;
  name: string;
  /** NPR per month, and per year (a year costs ten months). */
  monthly: number;
  yearly: number;
  apps: number;
  addresses: number;
  shortLinks: number;
  blurb: string;
  /** What a card lists, in order. The first line is always the app count. */
  features: string[];
  /** Shown faded on the card: what the next plan adds. */
  missing: string[];
}

export const PLAN_CARDS: PlanCard[] = [
  {
    id: 'free', name: 'Free Forever', monthly: 0, yearly: 0, apps: 1, addresses: 1, shortLinks: 5,
    blurb: 'One client room, free for as long as you like.',
    features: ['1 app, uploaded or built here', '1 address: jhino.com/your-name', 'Share by sign-in or public link', 'Live data and files on both sides', '5 short links'],
    missing: ['Password links', 'Hide the top bar', 'Download as an HTML file'],
  },
  {
    id: 'plus', name: 'Plus', monthly: 500, yearly: 5000, apps: 10, addresses: 10, shortLinks: 100,
    blurb: 'A freelancer or a small studio with a handful of clients.',
    features: ['10 apps', '10 addresses on jhino.com', 'Password links', 'Hide the top bar: opens like its own site', 'Download any app as an HTML file', '100 short links with your own names'],
    missing: ['Daily click history'],
  },
  {
    id: 'pro', name: 'Pro', monthly: 2000, yearly: 20000, apps: 50, addresses: 50, shortLinks: 1000,
    blurb: 'A studio or agency with a room for every client.',
    features: ['50 apps', '50 addresses on jhino.com', 'Everything in Plus', '1,000 short links', 'Daily click history for every link', 'Priority support'],
    missing: [],
  },
];

export const planCard = (id: string) => PLAN_CARDS.find((p) => p.id === id) ?? PLAN_CARDS[0];
export const nprAmount = (n: number) => n.toLocaleString('en-IN');
export const priceFor = (p: PlanCard, period: Period) => (period === 'year' ? p.yearly : p.monthly);
