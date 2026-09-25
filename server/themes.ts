/*
 * The public page designs and the plan tier each needs. Made from web/src/profile/themes.ts by
 * scripts/sync-themes.mjs; a test keeps the two in step.
 */
export const DEFAULT_THEME = 'paper';
export const THEME_TIERS: Record<string, 'free' | 'plus' | 'pro'> = {
  'paper': 'free',
  'ink': 'free',
  'mustang': 'free',
  'himal': 'free',
  'ilam': 'free',
  'patan': 'plus',
  'rara': 'plus',
  'tihar': 'plus',
  'shivapuri': 'plus',
  'lalitpur': 'plus',
  'slate': 'plus',
  'ason': 'plus',
  'newsroom': 'plus',
  'durbar': 'plus',
  'phewa': 'plus',
  'noir': 'pro',
  'gallery': 'pro',
  'kathmandu-night': 'pro',
  'bhaktapur': 'pro',
  'stone': 'pro',
  'volt': 'pro',
  'poster': 'pro',
  'pokhara': 'pro',
  'porcelain': 'pro',
  'terai': 'pro',
  'vermilion': 'pro',
  'apricot': 'pro',
  'typewriter': 'pro',
  'cinema': 'pro',
  'everest': 'pro',
};
