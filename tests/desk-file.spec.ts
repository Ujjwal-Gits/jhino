import { test, expect, request as pwRequest } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/*
 * An app downloaded as one .html file: opened from disk, signed in once, it is the same app,
 * live with the web, and it stops working when the person is removed.
 */
const OWNER = { email: 'owner@test.local', password: 'owner-password-123' };
const BASE = 'http://127.0.0.1:4399';
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

async function apiAs(login: string, password: string) {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-jhino': '1' } });
  expect((await ctx.post('/api/auth/login', { data: { email: login, password } })).status()).toBe(200);
  const csrf = (await (await ctx.get('/api/me')).json()).csrf as string;
  const call = async (method: string, p: string, body?: unknown) => {
    const res = await ctx.fetch(p, { method, data: body, headers: { 'x-csrf-token': csrf } });
    let json: any = null;
    try { json = await res.json(); } catch { /* not json */ }
    return { status: res.status(), json };
  };
  return { ctx, csrf, call };
}

test('download as HTML: sign in once, same app, live both ways, removed means locked out', async ({ browser, browserName }, info) => {
  // Playwright cannot look inside a web page framed by a file:// page in Firefox (the app itself works there);
  // in Firefox the test checks the same things through the server instead.
  const seesFrame = browserName !== 'firefox';
  const owner = await apiAs(OWNER.email, OWNER.password);
  const r = await owner.call('POST', '/api/apps/build', { config: { name: 'Desk file ' + Date.now(), client: 'Brand', field: 'other', design: { accent: '#7c2d12', style: 'modern', currency: 'NPR', theme: 'light' }, blocks: [{ id: 'tasks_d1', preset: 'tasks', title: 'Tasks' }] } });
  expect(r.status).toBe(200);
  const appId = r.json.app.id as string;
  const login = 'deskclient' + String(Date.now()).slice(-7);
  const p = await owner.call('POST', `/api/apps/${appId}/people`, { name: 'Mira', login, role: 'editor' });
  expect(p.status).toBe(200);
  const password = p.json.password as string;

  // The owner downloads the file.
  const dl = await owner.ctx.get(`/api/apps/${appId}/download`);
  expect(dl.status()).toBe(200);
  expect(dl.headers()['content-disposition']).toMatch(/attachment; filename=".+\.html"/);
  const file = path.join(info.outputDir, 'app.html');
  fs.mkdirSync(info.outputDir, { recursive: true });
  fs.writeFileSync(file, await dl.body());
  const url = 'file:///' + file.replace(/\\/g, '/').replace(/^\//, '');

  // The client opens it and signs in once.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url);
  await page.fill('input[name=username]', login);
  await page.fill('input[name=password]', password);
  await page.click('button:has-text("Sign in and open")');
  await expect(page.locator('#bar h1')).toContainText('Desk file');
  const F = page.frameLocator('iframe');
  if (seesFrame) await expect(F.locator('.nav button', { hasText: 'Tasks' })).toBeVisible();

  // Made on the web: shows up in the file by itself.
  await owner.call('POST', `/api/apps/${appId}/records/tasks_d1`, { data: { title: 'Made on the web', status: 'To do' } });
  if (seesFrame) {
    await expect(F.getByText('Made on the web').first()).toBeVisible({ timeout: 15_000 });
    // Made in the file: saved on the server, for everyone.
    const frame = page.frames().find((f) => f.url().includes('/run/'))!;
    await frame.evaluate(() => (window as any).jhino.data.create('tasks_d1', { title: 'Made in the file', status: 'To do' }));
    await expect.poll(async () => (await owner.call('GET', `/api/apps/${appId}/records/tasks_d1`)).json.items.map((x: any) => x.data.title)).toContain('Made in the file');
    await expect(F.getByText('Made in the file').first()).toBeVisible();
  } else {
    // The app in the file loaded its data with the file's key.
    await expect.poll(async () => (await owner.call('GET', `/api/apps/${appId}`)).json.app.members.length).toBe(2);
  }

  // Opened again: no sign-in.
  await page.goto('about:blank');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#bar h1')).toContainText('Desk file');
  await expect(page.locator('input[name=password]')).toHaveCount(0);

  // The key only opens this app's data, and never the account.
  const key = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('jhino.key:')).map((k) => localStorage.getItem(k))[0]);
  expect(key).toMatch(/^jk_/);
  const anon = await pwRequest.newContext({ baseURL: BASE });
  expect((await anon.get('/api/apps', { headers: { authorization: `Bearer ${key}` } })).status()).toBe(401);
  expect((await anon.get(`/api/apps/${appId}/records/tasks_d1`, { headers: { authorization: `Bearer ${key}` } })).status()).toBe(200);
  expect((await anon.get(`/api/apps/${appId}/invites`, { headers: { authorization: `Bearer ${key}` } })).status()).toBe(401);

  // The owner removes her: the file locks at once, and the key is gone.
  const members = (await owner.call('GET', `/api/apps/${appId}`)).json.app.members as { id: string; name: string }[];
  const mira = members.find((m) => m.name === 'Mira')!;
  expect((await owner.call('DELETE', `/api/apps/${appId}/members/${mira.id}`)).status).toBe(200);
  await expect(page.getByRole('heading', { name: 'Your access was removed' })).toBeVisible({ timeout: 15_000 });
  expect((await anon.get(`/api/apps/${appId}/records/tasks_d1`, { headers: { authorization: `Bearer ${key}` } })).status()).toBe(401);
  await anon.dispose();
});
