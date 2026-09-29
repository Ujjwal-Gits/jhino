/* Home and All apps preferences: what the person said they use Jhino for, and the apps opened lately (this browser only). */
export const INTERESTS: { key: string; label: string; apps: string[] }[] = [
  { key: 'bio', label: 'Link in bio', apps: ['bio', 'ask', 'smart'] },
  { key: 'hosting', label: 'Client apps / host my HTML', apps: ['upload', 'smart', 'qr'] },
  { key: 'domain', label: 'Custom domain site', apps: ['upload', 'subs', 'links'] },
  { key: 'qr', label: 'QR codes and links', apps: ['qr', 'links', 'smart'] },
  { key: 'files', label: 'PDF and image tools', apps: ['pdf', 'image', 'wordpdf', 'pdfword'] },
  { key: 'focus', label: 'Focus and study', apps: ['focus', 'date', 'text'] },
  { key: 'money', label: 'Subscriptions and money', apps: ['subs', 'currency', 'emi'] },
  { key: 'social', label: 'Social media tools', apps: ['ask', 'fonts', 'thumb', 'picker', 'text'] },
];

/** Apps for the chosen interests, taking one from each in turn so every interest is represented. */
export function appsForInterests(keys: string[], max = 9): string[] {
  const lists = INTERESTS.filter((i) => keys.includes(i.key)).map((i) => i.apps);
  const out: string[] = [];
  for (let n = 0; out.length < max && lists.some((l) => n < l.length); n++) {
    for (const l of lists) if (n < l.length && !out.includes(l[n]) && out.length < max) out.push(l[n]);
  }
  return out;
}

const RECENT = 'jhino.recentApps';
export function getRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 6) : []; } catch { return []; }
}
export function noteRecent(key: string) {
  try { localStorage.setItem(RECENT, JSON.stringify([key, ...getRecent().filter((k) => k !== key)].slice(0, 6))); } catch { /* private mode */ }
}

export interface InterestState { interests: string[]; done: boolean; onboard: boolean }
