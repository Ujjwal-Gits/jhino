import { test, expect, request as pwRequest } from '@playwright/test';

// File sections (mood board, gallery, files, proofing) take links as well as files.
const BASE = 'http://127.0.0.1:4399';
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

test('mood board: paste links, they show as tiles next to the photos', async ({ browser }) => {
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-jhino': '1' } });
  await api.post('/api/auth/login', { data: { email: 'owner@test.local', password: 'owner-password-123' } });
  const csrf = (await (await api.get('/api/me')).json()).csrf;
  const r = await api.post('/api/apps/build', { headers: { 'x-csrf-token': csrf }, data: { config: { name: 'Links on the board ' + Date.now(), client: 'Brand', field: 'design', design: { accent: '#1f6f5c', style: 'modern', currency: 'NPR', theme: 'light' }, blocks: [{ id: 'mood_l1', preset: 'mood_board', title: 'Mood board' }] } } });
  expect(r.status()).toBe(200);
  const appId = (await r.json()).app.id;
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.fill('input[autocomplete=username]', 'owner@test.local');
  await page.fill('input[type=password]', 'owner-password-123');
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('h1');
  await page.goto(`/apps/${appId}#mood_l1`);
  const F = page.frameLocator('iframe');
  await F.locator('.empty .btn', { hasText: 'Add link' }).click();
  await F.locator('.modal textarea').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ\nhttps://www.pinterest.com/pin/warm-coffee-tones/');
  await F.locator('.modal .btn.primary').click();
  await expect(F.locator('.ftile')).toHaveCount(2);
  await expect(F.locator('.ftile .link-tag')).toHaveCount(2);
  await expect(F.locator('.ftile', { hasText: 'pinterest.com' })).toContainText('warm coffee tones');
  // More links from the header button, and the item opens with an Open link button.
  // The section redraws after the first links arrive; click again if the first click landed on the old header.
  await expect(async () => {
    await F.locator('.head .btn', { hasText: 'Add link' }).click();
    await expect(F.locator('.modal textarea')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await F.locator('.modal textarea').fill('https://example.com/refs/palette.png');
  await F.locator('.modal .btn.primary').click();
  await expect(F.locator('.ftile')).toHaveCount(3);
  await F.locator('.ftile', { hasText: 'pinterest.com' }).click();
  await expect(F.locator('.lightbox a', { hasText: 'Open link' }).first()).toHaveAttribute('href', 'https://www.pinterest.com/pin/warm-coffee-tones/');
  await api.dispose();
});
