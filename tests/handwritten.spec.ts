import { test, expect, request as pwRequest, type Browser } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/*
 * A hand-written HTML with its own design (samples/ticket-rail.html: plain HTML, CSS and JS, localStorage,
 * FileReader), uploaded as it is and used from three sides: the owner on the web, the client on a phone,
 * and the client in the downloaded file.
 */
const OWNER = { email: 'owner@test.local', password: 'owner-password-123' };
const BASE = 'http://127.0.0.1:4399';
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

async function webSignIn(browser: Browser, login: string, password: string, width: number) {
  const page = await (await browser.newContext({ viewport: { width, height: 820 } })).newPage();
  await page.goto('/');
  await page.fill('input[autocomplete=username]', login);
  await page.fill('input[type=password]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('h1');
  return page;
}

test('a hand-written HTML keeps its own design and is live on the web, on a phone and in the downloaded file', async ({ browser, browserName }, info) => {
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-jhino': '1' } });
  await api.post('/api/auth/login', { data: OWNER });
  const csrf = (await (await api.get('/api/me')).json()).csrf;
  const up = await api.post('/api/apps', { multipart: { name: 'Ticket Rail', file: { name: 'ticket-rail.html', mimeType: 'text/html', buffer: fs.readFileSync('samples/ticket-rail.html') } }, headers: { 'x-csrf-token': csrf } });
  expect(up.status()).toBe(200);
  const appId = (await up.json()).app.id as string;
  const login = 'kitchen' + String(Date.now()).slice(-7);
  const person = await (await api.post(`/api/apps/${appId}/people`, { data: { name: 'Kitchen', login, role: 'editor' }, headers: { 'x-csrf-token': csrf } })).json();

  const A = await webSignIn(browser, OWNER.email, OWNER.password, 1280);
  const B = await webSignIn(browser, login, person.password, 390);
  await A.goto(`/apps/${appId}`);
  await B.goto(`/apps/${appId}`);
  const FA = A.frameLocator('iframe'), FB = B.frameLocator('iframe');

  // Its own design, untouched: the page's fonts and colours, not Jhino's.
  await expect(FA.locator('h1')).toHaveText('Ticket Rail', { timeout: 20_000 });
  expect(await FA.locator('body').evaluate((b) => getComputedStyle(b).backgroundColor)).toBe('rgb(28, 26, 23)');

  // The owner fires a ticket (the form resets, with Qty back to 1): the phone gets it, and the owner still sees the phone's changes.
  await FA.locator('#dish').fill('Himalayan latte');
  await FA.locator('#qty').fill('2');
  await FA.locator('#notes').fill('Oat milk');
  await FA.locator('.fire').click();
  await expect(FB.locator('.ticket', { hasText: 'Himalayan latte' })).toBeVisible({ timeout: 20_000 });
  await FB.locator('.ticket', { hasText: 'Himalayan latte' }).locator('button', { hasText: 'Serve' }).click();
  await expect(FA.locator('.ticket.served', { hasText: 'Himalayan latte' })).toBeVisible({ timeout: 20_000 });

  // The downloaded file: same design, same tickets, and what it adds reaches the web.
  const file = path.join(info.outputDir, 'Ticket-Rail.html');
  fs.mkdirSync(info.outputDir, { recursive: true });
  fs.writeFileSync(file, await (await api.get(`/api/apps/${appId}/download`)).body());
  const C = await (await browser.newContext()).newPage();
  await C.goto('file:///' + file.replace(/\\/g, '/').replace(/^\//, ''));
  await C.fill('input[name=username]', login);
  await C.fill('input[name=password]', person.password);
  await C.click('button:has-text("Sign in and open")');
  await expect(C.locator('#bar h1')).toHaveText('Ticket Rail');
  if (browserName !== 'firefox') { // Playwright cannot look inside a web frame on a file:// page in Firefox
    const FC = C.frameLocator('iframe');
    await expect(FC.locator('.ticket', { hasText: 'Himalayan latte' })).toBeVisible({ timeout: 20_000 });
    await FC.locator('#dish').fill('Masala chai');
    await FC.locator('.fire').click();
    await expect(FA.locator('.ticket', { hasText: 'Masala chai' })).toBeVisible({ timeout: 20_000 });
    await expect(FB.locator('.ticket', { hasText: 'Masala chai' })).toBeVisible({ timeout: 20_000 });
  }
  await api.dispose();
});
