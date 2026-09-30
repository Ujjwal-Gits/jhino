/*
 * Bikram Sambat dates for 2070-2090 BS: the same table the app builder uses (builder/app.js; month lengths from
 * nepali-date-converter, MIT). 1 Baisakh 2070 = 14 April 2013. Outside the table the functions return null.
 * Pure TypeScript: the dashboard (web/src/bs.ts re-exports this) and the site renderer share it.
 */
const BS_FROM = 2070, BS_TO = 2090, BS_ANCHOR = Date.UTC(2013, 3, 14);
const BS_T = '333433122122334333212122343432212122343432221123333433212122334333212122343432221122343432221213333433212122334333212122343432221122343432221213334333212122334333212122343432221123243432221213334333212122334333221222234423221222243432221222243432221222';
export const BS_MONTHS = ['Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Asoj', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];
export const bsRange = { from: BS_FROM, to: BS_TO };
export const bsDays = (y: number, m: number) => Number(BS_T[(y - BS_FROM) * 12 + m]) + 28;
const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** An AD date (YYYY-MM-DD) as { y, m (0-11), d } in BS. */
export function adToBs(iso: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  let n = Math.round((utc(iso) - BS_ANCHOR) / 864e5);
  if (n < 0) return null;
  for (let y = BS_FROM; y <= BS_TO; y++) for (let m = 0; m < 12; m++) { const d = bsDays(y, m); if (n < d) return { y, m, d: n + 1 }; n -= d; }
  return null;
}

/** A BS date (month 0-11) as an AD date, YYYY-MM-DD. */
export function bsToAd(y: number, m: number, d: number): string | null {
  if (y < BS_FROM || y > BS_TO || m < 0 || m > 11 || d < 1 || d > bsDays(y, m)) return null;
  let n = d - 1;
  for (let yy = BS_FROM; yy < y; yy++) for (let mm = 0; mm < 12; mm++) n += bsDays(yy, mm);
  for (let mm = 0; mm < m; mm++) n += bsDays(y, mm);
  return new Date(BS_ANCHOR + n * 864e5).toISOString().slice(0, 10);
}

/** Today in BS, like "13 Asoj 2083" (empty outside the table). */
export function bsToday(d = new Date()) {
  const b = adToBs(localIso(d));
  return b ? `${b.d} ${BS_MONTHS[b.m]} ${b.y}` : '';
}
