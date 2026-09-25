import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import zlib from 'node:zlib';

const OWNER = { email: 'owner@test.local', password: 'owner-password-123' };
const BASE = 'http://127.0.0.1:4399';

interface Api { ctx: APIRequestContext; csrf: string; call: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }> }
async function apiAs(login: string, password: string): Promise<Api> {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-jhino': '1' } });
  const r = await ctx.post('/api/auth/login', { data: { email: login, password } });
  expect(r.status(), `login ${login}`).toBe(200);
  const csrf = (await (await ctx.get('/api/me')).json()).csrf as string;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await ctx.fetch(path, { method, data: body, headers: { 'x-csrf-token': csrf } });
    let json: any = null;
    try { json = await res.json(); } catch { /* not json */ }
    return { status: res.status(), json };
  };
  return { ctx, csrf, call };
}
async function signIn(browser: Browser, login: string, password: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
  await page.goto('/login');
  await page.fill('input[autocomplete=username]', login);
  await page.fill('input[type=password]', password);
  await page.click('button:has-text("Sign in")');
  // Home after signing in is your page (jhino.com/<username>); clients without one land on their apps.
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  if (!/\/apps$/.test(new URL(page.url()).pathname)) await page.goto('/apps');
  await expect(page.getByRole('heading', { name: 'My apps' })).toBeVisible();
  return page;
}
async function uploadApp(owner: Api, name: string, buffer: Buffer) {
  const r = await owner.ctx.post('/api/apps', { multipart: { file: { name, mimeType: 'application/octet-stream', buffer } }, headers: { 'x-csrf-token': owner.csrf } });
  return { status: r.status(), json: await r.json() };
}
function makeZip(entries: { name: string; data: string }[]) {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name), data = Buffer.from(e.data), crc = zlib.crc32(data);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x0800, 6); l.writeUInt32LE(crc, 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(l, name, data); centrals.push(c, name); offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
async function buildApp(owner: Api, name: string, presets: string[]) {
  const blocks = presets.map((p, i) => ({ id: `${p}_${i}x`, preset: p, title: p }));
  const r = await owner.call('POST', '/api/apps/build', { config: { name, purpose: '', design: { accent: '#1f6f5c', style: 'modern', currency: 'NPR', theme: 'light' }, blocks } });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return { id: r.json.app.id as string, col: (p: string) => blocks.find((b) => b.preset === p)!.id };
}
// Close every browser window a test opened, so no live connections pile up.
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

const tick = (page: Page, name: string) => page.locator('label.fcard', { has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) }).click();

test('Create HTML: say who it is for, tick features, create, it opens directly, data saves, editing features keeps data', async ({ browser }) => {
  const a = await signIn(browser, OWNER.email, OWNER.password);
  await expect(a.locator('.strip, .rail')).toHaveCount(0); // no dashboard on the home page
  await a.click('header button:has-text("Create app")');
  await a.getByLabel('Client or brand').fill('Test Brand');
  await expect(a.locator('#c-name')).toHaveValue('Test Brand');
  await a.getByRole('radio', { name: /Something else/ }).click();
  await a.fill('#c-name', 'Test Brand desk');
  await a.getByPlaceholder('Spring campaign 2026').fill('Money and files for the test brand.');
  for (const name of ['Receipts and expenses', 'Project ledger', 'Big file transfer']) await tick(a, name);
  await expect(a.locator('label.fcard input:checked')).toHaveCount(3);
  await expect(a.frameLocator('.builder-preview iframe').locator('.nav button:not(.nav-trash)')).toHaveCount(3, { timeout: 15_000 });
  await a.locator('header button:has-text("Create app")').click();
  await a.waitForURL(/\/apps\/[\w-]+(#.*)?$/);
  const f = a.frameLocator('iframe');
  await expect(f.locator('.head h2').first()).toHaveText('Receipts and expenses');
  await expect(f.locator('.brand p')).toHaveText('Money and files for the test brand.');
  await expect(f.locator('.brand .client')).toHaveText('Test Brand');
  await f.locator('button:has-text("Add receipt")').first().click();
  await f.locator('.drawer input').first().fill('Printer paper');
  await f.locator('.drawer .money-in input').fill('640.50');
  await f.locator('.drawer button:has-text("Add")').last().click();
  await expect(f.locator('td', { hasText: 'Printer paper' })).toBeVisible();
  await expect(f.locator('.stat .v').first()).toContainText('640.50');

  const url = a.url().replace(/#.*$/, '');
  await a.goto(url + '/blocks');
  await expect(a.getByLabel('Client or brand')).toHaveValue('Test Brand');
  await tick(a, 'Project ledger');
  await tick(a, 'Tasks and requests');
  await a.locator('header button:has-text("Save changes")').click();
  await a.waitForURL((u) => u.href.replace(/#.*$/, '') === url);
  await expect(f.locator('.nav button:not(.nav-trash) .t')).toHaveText(['Receipts and expenses', 'Big file transfer', 'Tasks and requests']);
  await expect(f.locator('td', { hasText: 'Printer paper' })).toBeVisible();
});

test('builder settings are checked by the server: logo type, comments collections', async () => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const cfg = (design: object) => ({ config: { name: 'Logo test', client: 'Brand', field: 'design', design: { accent: '#1f6f5c', style: 'modern', currency: 'NPR', theme: 'light', ...design }, blocks: [{ id: 'design_proofs_1x', preset: 'design_proofs', title: 'Proofs' }] } });
  const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString('base64');
  expect((await owner.call('POST', '/api/apps/build', cfg({ logo: svg }))).status).toBe(400);
  expect((await owner.call('POST', '/api/apps/build', cfg({ logo: 'data:image/png;base64,' + 'A'.repeat(200_000) }))).status).toBe(400);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const r = await owner.call('POST', '/api/apps/build', cfg({ logo: png }));
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const id = r.json.app.id;
  const src = await owner.ctx.get(`/api/apps/${id}/source`);
  expect(await src.text()).toContain(png);
  const up = await owner.ctx.post(`/api/apps/${id}/files`, { multipart: { file: { name: 'logo-v1.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') } }, headers: { 'x-csrf-token': owner.csrf } });
  expect(up.status()).toBe(200);
  expect((await owner.call('POST', `/api/apps/${id}/records/design_proofs_1x`, { data: { title: 'Logo v0', file: 'f_missing', round: 1 } })).status).toBe(400);
  const rec = await owner.call('POST', `/api/apps/${id}/records/design_proofs_1x`, { data: { title: 'Logo v1', file: (await up.json()).file.id, round: 1 } });
  expect(rec.status, JSON.stringify(rec.json)).toBe(200);
  expect(rec.json.record.data.status).toBe('Waiting for review');
  const C = `/api/apps/${id}/records/design_proofs_1x_comments`;
  expect((await owner.call('POST', C, { data: { rec: rec.json.record.id, body: 'Make the mark bigger' } })).status).toBe(200);
  expect((await owner.call('POST', C, { data: { rec: rec.json.record.id } })).status).toBe(400);
  expect((await owner.call('GET', C)).json.items).toHaveLength(1);
});

test('owner-made sign-ins and the Can add role are enforced by the server', async () => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const app = await buildApp(owner, 'Roles test', ['receipts', 'contracts', 'announcements']);
  const stamp = String(Date.now()).slice(-6);
  const mk = async (name: string, login: string) => {
    const r = await owner.call('POST', `/api/apps/${app.id}/people`, { name, login: login + stamp, role: 'contributor' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return apiAs(r.json.person.login, r.json.password);
  };
  const sita = await mk('Sita', 'sita');
  const ravi = await mk('Ravi', 'ravi');
  const people = (await owner.call('GET', `/api/apps/${app.id}/people`)).json.people as { id: string; name: string }[];
  const sitaId = people.find((p) => p.name === 'Sita')!.id;
  expect((await owner.call('POST', `/api/apps/${app.id}/people`, { name: 'X', login: 'sita' + stamp, role: 'viewer' })).status).toBe(409);
  expect((await sita.call('GET', '/api/apps')).json.apps.map((x: any) => x.id)).toEqual([app.id]);

  const R = `/api/apps/${app.id}/records/${app.col('receipts')}`;
  const mine = await sita.call('POST', R, { data: { vendor: 'Taxi', amount: 35000, date: '2026-09-24' } });
  expect(mine.status).toBe(200);
  expect(mine.json.record.data.status).toBe('To be paid back');
  expect((await sita.call('PATCH', `${R}/${mine.json.record.id}`, { data: { status: 'Paid' } })).status).toBe(400);
  expect((await sita.call('PATCH', `${R}/${mine.json.record.id}`, { data: { amount: 36000 } })).status).toBe(200);
  const ownerRec = await owner.call('POST', R, { data: { vendor: 'Studio rent', amount: 5000000, date: '2026-09-01' } });
  expect((await sita.call('PATCH', `${R}/${ownerRec.json.record.id}`, { data: { amount: 1 } })).status).toBe(403);
  expect((await sita.call('DELETE', `${R}/${ownerRec.json.record.id}`)).status).toBe(403);
  expect((await owner.call('PATCH', `${R}/${mine.json.record.id}`, { data: { status: 'Paid back' } })).status).toBe(200);
  expect((await sita.call('POST', R, { data: { vendor: 'x', amount: 10.5, date: '2026-09-24' } })).status).toBe(400);
  expect((await sita.call('POST', R, { data: { vendor: 'x', amount: 10, date: 'yesterday' } })).status).toBe(400);
  expect((await sita.call('POST', R, { data: { vendor: 'x', amount: 10, date: '2026-09-24', hacked: true } })).status).toBe(400);
  expect((await sita.call('POST', `/api/apps/${app.id}/records/not_declared`, { data: { a: 1 } })).status).toBe(400);
  expect((await sita.call('POST', `/api/apps/${app.id}/records/${app.col('announcements')}`, { data: { title: 'x', body: 'y' } })).status).toBe(403);

  const upload = async (who: Api, name: string, body: string) => {
    const r = await who.ctx.post(`/api/apps/${app.id}/files`, { multipart: { file: { name, mimeType: 'application/pdf', buffer: Buffer.from(body) } }, headers: { 'x-csrf-token': who.csrf } });
    expect(r.status()).toBe(200);
    return (await r.json()).file.id as string;
  };
  const C = `/api/apps/${app.id}/records/${app.col('contracts')}`;
  const doc = await upload(owner, 'contract.pdf', '%PDF-1.4 contract');
  const contract = await owner.call('POST', C, { data: { title: 'Agreement', signer: sitaId, document: doc } });
  expect(contract.status).toBe(200);
  expect((await sita.call('POST', C, { data: { title: 'Mine', signer: sitaId, document: doc } })).status).toBe(403);
  expect((await sita.call('GET', C)).json.items).toHaveLength(1);
  expect((await ravi.call('GET', C)).json.items).toHaveLength(0);
  expect((await sita.ctx.get(`/api/apps/${app.id}/files/${doc}`)).status()).toBe(200);
  expect((await ravi.ctx.get(`/api/apps/${app.id}/files/${doc}`)).status()).toBe(404);
  const signed = await upload(sita, 'signed.pdf', '%PDF-1.4 signed');
  expect((await sita.call('PATCH', `${C}/${contract.json.record.id}`, { data: { signed_document: signed, status: 'Signed' } })).status).toBe(200);
  expect((await sita.call('PATCH', `${C}/${contract.json.record.id}`, { data: { document: signed } })).status).toBe(403);
  const part = await owner.ctx.get(`/api/apps/${app.id}/files/${doc}`, { headers: { Range: 'bytes=0-3' } });
  expect(part.status()).toBe(206);
  expect(await part.text()).toBe('%PDF');

  expect((await owner.call('POST', `/api/apps/${app.id}/people/${sitaId}/password`)).status).toBe(200);
  expect((await sita.call('GET', '/api/apps')).status).toBe(401);
});

test('manifests: conflicting or unsupported manifests are refused', async () => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const html = (m: string) => `<!doctype html><title>M</title><script type="application/json" id="jhino-manifest">${m}</script>`;
  const conflict = makeZip([
    { name: 'index.html', data: html('{"specVersion":1,"collections":{"a":{"fields":{"t":{"type":"text"}}}}}') },
    { name: 'jhino.json', data: '{"specVersion":1,"collections":{"b":{"fields":{"t":{"type":"text"}}}}}' },
  ]);
  const r1 = await uploadApp(owner, 'c.zip', conflict);
  expect(r1.status).toBe(400);
  expect(r1.json.message).toMatch(/different/);
  expect((await uploadApp(owner, 'u.html', Buffer.from(html('{"specVersion":1,"capabilities":["servercode"]}')))).json.message).toMatch(/unsupported capability/);
  expect((await uploadApp(owner, 't.html', Buffer.from(html('{"specVersion":1,"collections":{"a":{"fields":{"t":{"type":"banana"}}}}}')))).json.message).toMatch(/unknown type/);
});
