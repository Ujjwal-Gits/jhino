// Copies the design ids and their plan tiers from web/src/profile/themes.ts into server/themes.ts,
// so the server checks the same list the editor shows. Run after changing the designs:
//   node scripts/sync-themes.mjs
import fs from 'node:fs';

const src = fs.readFileSync('web/src/profile/themes.ts', 'utf8');
const pairs = [...src.matchAll(/id:\s*'([a-z0-9-]+)'[^}]*?tier:\s*'(free|plus|pro)'/gs)].map((m) => [m[1], m[2]]);
if (pairs.length < 5 || !pairs.some(([id]) => id === 'paper')) throw new Error(`Found ${pairs.length} designs; expected 30 including "paper".`);
const body = pairs.map(([id, tier]) => `  '${id}': '${tier}',`).join('\n');
fs.writeFileSync('server/themes.ts', `/*
 * The public page designs and the plan tier each needs. Made from web/src/profile/themes.ts by
 * scripts/sync-themes.mjs; a test keeps the two in step.
 */
export const DEFAULT_THEME = 'paper';
export const THEME_TIERS: Record<string, 'free' | 'plus' | 'pro'> = {
${body}
};
`);
const count = (t) => pairs.filter(([, x]) => x === t).length;
console.log(`${pairs.length} designs: free ${count('free')}, plus ${count('plus')}, pro ${count('pro')}`);
