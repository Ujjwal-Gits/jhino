import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import zlib from 'node:zlib';
import fs from 'node:fs';

const OWNER = { email: 'owner@test.local', password: 'owner-password-123' };
const BASE = 'http://127.0.0.1:4399';

/* ---------------- helpers ---------------- */
interface Api { ctx: APIRequestContext; csrf: string; call: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }> }

async function apiAs(email: string, password: string): Promise<Api> {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-jhino': '1' } });
  const login = await ctx.post('/api/auth/login', { data: { email, password } });
  expect(login.status(), `login ${email}`).toBe(200);
  const me = await (await ctx.get('/api/me')).json();
  const csrf = me.csrf as string;
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await ctx.fetch(path, { method, data: body, headers: { 'x-csrf-token': csrf } });
    let json: any = null;
    try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status(), json };
  };
  return { ctx, csrf, call };
}

async function upload(api: Api, file: string | { name: string; buffer: Buffer }, name = '') {
  const f = typeof file === 'string' ? { name: file.split('/').pop()!, mimeType: 'application/octet-stream', buffer: fs.readFileSync(file) } : { ...file, mimeType: 'application/octet-stream' };
  const r = await api.ctx.post('/api/apps', { multipart: { name, file: f }, headers: { 'x-csrf-token': api.csrf } });
  return { status: r.status(), json: await r.json() };
}

let userCounter = 0;
async function createUser(owner: Api, name: string) {
  const email = `u${Date.now()}${userCounter++}@test.local`;
  const r = await owner.call('POST', '/api/users', { email, name });
  expect(r.status).toBe(200);
  return { email, password: r.json.password as string, id: r.json.user.id as string, name };
}

async function signIn(browser: Browser, email: string, password: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.fill('input[autocomplete=username]', email);
  await page.fill('input[type=password]', password);
  await page.click('button:has-text("Sign in")');
  // Home after signing in is your page (jhino.com/<username>); clients without one land on their apps.
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  if (!/\/apps$/.test(new URL(page.url()).pathname)) await page.goto('/apps');
  await expect(page.getByRole('heading', { name: 'My apps' })).toBeVisible();
  return page;
}

/** Minimal ZIP writer (stored, no compression) for crafted test archives. */
function makeZip(entries: { name: string; data: string; mode?: number }[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.data, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(e.mode ? 0x031e : 20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((e.mode ?? 0) << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const frameOf = (page: Page) => page.frameLocator('iframe');

// Close every browser window a test opened, so no live connections pile up.
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

/* ---------------- tests ---------------- */

test('full journey: upload a ZIP, share with an invite link, edit together live, data persists', async ({ browser }) => {
  const a = await signIn(browser, OWNER.email, OWNER.password);
  await a.click('header button:has-text("Upload HTML")');
  await a.setInputFiles('dialog input[type=file]', 'tests/fixtures/team-tasks.zip');
  await a.click('button:has-text("Upload and publish")');
  await a.waitForURL(/\/apps\//);
  await expect(a.locator('.player-bar h1')).toHaveText('Team Tasks');

  const fa = frameOf(a);
  await fa.locator('#title').fill('Shoot rooftop b-roll');
  await fa.locator('button:has-text("Add task")').click();
  await expect(a.locator('.sync')).toHaveText(/Saved/);

  await a.click('button:has-text("Share")');
  await a.getByRole('tab', { name: 'Invite link' }).click();
  await a.click('button:has-text("Create link")');
  const link = await a.inputValue('input[aria-label="Invite link"]');
  expect(link).toMatch(/\/invite\//);
  await a.keyboard.press('Escape');

  // Second person joins from the link with a brand-new account.
  const m = await (await browser.newContext()).newPage();
  await m.goto(link);
  await m.fill('input[autocomplete=name]', 'Maya Gurung');
  await m.fill('input[autocomplete=email]', `maya${Date.now()}@test.local`);
  await m.fill('input[autocomplete=new-password]', 'maya-password-123');
  await m.click('button:has-text("Create account and join")');
  await m.waitForURL(/\/apps\//);
  const fm = frameOf(m);
  await expect(fm.locator('li.task .text')).toHaveText(['Shoot rooftop b-roll']);

  // Maya ticks and adds; the owner sees both without doing anything.
  await fm.locator('li.task input[type=checkbox]').first().check();
  await fm.locator('#title').fill('Book studio for Friday');
  await fm.locator('button:has-text("Add task")').click();
  await expect(fa.locator('li.task .text')).toHaveText(['Shoot rooftop b-roll', 'Book studio for Friday'], { timeout: 15_000 });
  await expect(fa.locator('li.task').first()).toHaveClass(/done/);

  // Both add at the same moment: nothing is lost.
  await Promise.all([
    (async () => { await fa.locator('#title').fill('From owner'); await fa.locator('button:has-text("Add task")').click(); })(),
    (async () => { await fm.locator('#title').fill('From Maya'); await fm.locator('button:has-text("Add task")').click(); })(),
  ]);
  for (const f of [fa, fm]) {
    await expect(f.locator('li.task .text', { hasText: 'From owner' })).toBeVisible({ timeout: 15_000 });
    await expect(f.locator('li.task .text', { hasText: 'From Maya' })).toBeVisible({ timeout: 15_000 });
  }

  // Refresh and sign out/in: the server copy is what loads.
  await m.reload();
  await expect(frameOf(m).locator('li.task')).toHaveCount(4);
  // Maya joined by invite, so she is a client: she signs out from the app's menu.
  await m.getByRole('button', { name: 'More' }).click();
  await m.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(m.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  // The invite link cannot be used twice.
  const again = await (await browser.newContext()).newPage();
  await again.goto(link);
  await expect(again.getByText('Invite not available')).toBeVisible();

  // The owner's app list shows it shared.
  await a.goto('/apps');
  const card = a.locator('.ix-row', { hasText: 'Team Tasks' }).first();
  await expect(card.locator('.ap-people .avatar')).toHaveCount(1);
  await expect(card.locator('.ap-people')).toBeVisible();
});

test('text someone is still typing is never wiped by a live update', async ({ browser }) => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const appId = (await upload(owner, 'tests/fixtures/team-tasks.zip', 'Draft test')).json.app.id;
  const page = await signIn(browser, OWNER.email, OWNER.password);
  await page.goto(`/apps/${appId}`);
  const f = frameOf(page);
  await f.locator('#title').fill('half-typed idea');
  await f.locator('h1').click(); // leave the field without submitting

  const snap = await owner.call('GET', `/api/apps/${appId}/kv`);
  const rev = snap.json.data.ls.s['team-tasks-v1']?.[1] ?? 0;
  await owner.call('PUT', `/api/apps/${appId}/kv`, { ns: 'ls', scope: 'shared', key: 'team-tasks-v1', value: JSON.stringify([{ id: 'x', title: 'From elsewhere', who: 'Anyone', done: false }]), baseRev: rev });

  await expect(page.getByText('Someone updated this app')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(3000);
  await expect(f.locator('#title')).toHaveValue('half-typed idea');
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await expect(f.locator('li.task .text')).toHaveText(['From elsewhere'], { timeout: 10_000 });
});

test('a viewer can open the app but the server refuses their changes', async ({ browser }) => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const up = await upload(owner, 'tests/fixtures/team-tasks.zip', 'Viewer test');
  const appId = up.json.app.id;
  await owner.call('PUT', `/api/apps/${appId}/kv`, { ns: 'ls', scope: 'shared', key: 'team-tasks-v1', value: JSON.stringify([{ id: '1', title: 'Existing', who: 'Anyone', done: false }]), baseRev: 0 });
  const v = await createUser(owner, 'Vera Viewer');
  expect((await owner.call('POST', `/api/apps/${appId}/members`, { email: v.email, role: 'viewer' })).status).toBe(200);

  const viewer = await apiAs(v.email, v.password);
  const attack = await viewer.call('PUT', `/api/apps/${appId}/kv`, { ns: 'ls', scope: 'shared', key: 'team-tasks-v1', value: '[]', baseRev: 1 });
  expect(attack.status).toBe(403);
  expect((await viewer.call('POST', `/api/apps/${appId}/records/tasks`, { data: { title: 'x' } })).status).toBe(403);
  expect((await viewer.call('POST', `/api/apps/${appId}/invites`, { role: 'editor' })).status).toBe(403);
  expect((await viewer.call('POST', `/api/apps/${appId}/members`, { email: v.email, role: 'editor' })).status).toBe(403);

  const page = await signIn(browser, v.email, v.password);
  await page.goto(`/apps/${appId}`);
  await expect(page.locator('.pill', { hasText: 'View only' })).toBeVisible();
  const f = frameOf(page);
  await expect(f.locator('li.task .text')).toHaveText(['Existing']);
  await f.locator('#title').fill('Sneaky');
  await f.locator('button:has-text("Add task")').click();
  await expect(page.getByText('You can view this app but not change it.')).toBeVisible();
  const snap = await owner.call('GET', `/api/apps/${appId}/kv`);
  expect(JSON.parse(snap.json.data.ls.s['team-tasks-v1'][0])).toHaveLength(1);
});

test('removing someone cuts off their open app and their API access right away', async ({ browser }) => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const up = await upload(owner, 'tests/fixtures/team-tasks.zip', 'Revoke test');
  expect(up.status, JSON.stringify(up.json)).toBe(200);
  const appId = up.json.app.id;
  const e = await createUser(owner, 'Eli Editor');
  await owner.call('POST', `/api/apps/${appId}/members`, { email: e.email, role: 'editor' });

  const page = await signIn(browser, e.email, e.password);
  await page.goto(`/apps/${appId}`);
  await expect(frameOf(page).locator('#summary')).toContainText('tasks');

  expect((await owner.call('DELETE', `/api/apps/${appId}/members/${e.id}`)).status).toBe(200);
  await expect(page.getByText('Your access was removed')).toBeVisible({ timeout: 10_000 });
  const editor = await apiAs(e.email, e.password);
  expect((await editor.call('GET', `/api/apps/${appId}/kv`)).status).toBe(404);
  expect((await editor.call('PUT', `/api/apps/${appId}/kv`, { ns: 'ls', scope: 'shared', key: 'k', value: 'v', baseRev: 0 })).status).toBe(404);
});

test('apps are isolated: members of one app cannot reach another app by guessing ids', async () => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const a1 = (await upload(owner, 'tests/fixtures/shared-checklist.html', 'Isolation A')).json.app.id;
  const a2 = (await upload(owner, 'tests/fixtures/shared-checklist.html', 'Isolation B')).json.app.id;
  const rec = await owner.call('POST', `/api/apps/${a2}/records/tasks`, { data: { title: 'secret' } });
  expect(rec.status).toBe(200);
  const u = await createUser(owner, 'Ira Isolated');
  await owner.call('POST', `/api/apps/${a1}/members`, { email: u.email, role: 'editor' });
  const user = await apiAs(u.email, u.password);
  expect((await user.call('GET', `/api/apps/${a1}/records/tasks`)).status).toBe(200);
  for (const [m, p] of [
    ['GET', `/api/apps/${a2}`], ['GET', `/api/apps/${a2}/kv`], ['GET', `/api/apps/${a2}/records/tasks`],
    ['GET', `/api/apps/${a2}/records/tasks/${rec.json.record.id}`], ['GET', `/api/apps/${a2}/activity`],
    ['POST', `/api/apps/${a2}/launch`], ['POST', `/api/apps/${a2}/watch`],
  ] as const) {
    expect((await user.call(m, p, m === 'POST' ? { connId: 'x' } : undefined)).status, `${m} ${p}`).toBe(404);
  }
  // A record id from app B used through app A is not found either.
  expect((await user.call('GET', `/api/apps/${a1}/records/tasks/${rec.json.record.id}`)).status).toBe(404);
  expect((await user.call('PATCH', `/api/apps/${a1}/records/tasks/${rec.json.record.id}`, { data: { title: 'x' } })).status).toBe(404);
  const list = await user.call('GET', '/api/apps');
  expect(list.json.apps.map((x: any) => x.id)).toEqual([a1]);
});

test('records API: revisions stop stale edits, idempotency stops duplicates, live subscribe works', async ({ browser }) => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const appId = (await upload(owner, 'tests/fixtures/shared-checklist.html')).json.app.id;
  const created = await owner.call('POST', `/api/apps/${appId}/records/tasks`, { data: { title: 'Review cut', done: false }, idempotencyKey: 'k1' });
  const again = await owner.call('POST', `/api/apps/${appId}/records/tasks`, { data: { title: 'Review cut', done: false }, idempotencyKey: 'k1' });
  expect(again.json.record.id).toBe(created.json.record.id);
  const rid = created.json.record.id;
  const first = await owner.call('PATCH', `/api/apps/${appId}/records/tasks/${rid}`, { data: { done: true }, expectedRevision: 1 });
  expect(first.status).toBe(200);
  const stale = await owner.call('PATCH', `/api/apps/${appId}/records/tasks/${rid}`, { data: { done: false }, expectedRevision: 1 });
  expect(stale.status).toBe(409);
  expect(stale.json.error).toBe('REVISION_CONFLICT');
  expect(stale.json.record.data.done).toBe(true);
  expect((await owner.call('GET', `/api/apps/${appId}/records/tasks`)).json.items).toHaveLength(1);

  // The SDK app updates from a change made elsewhere without reloading.
  const page = await signIn(browser, OWNER.email, OWNER.password);
  await page.goto(`/apps/${appId}`);
  const f = frameOf(page);
  await expect(f.locator('li span')).toHaveText(['Review cut']);
  await f.locator('#title').fill('Colour grade');
  await f.locator('#add button').click();
  await expect(f.locator('li span')).toHaveText(['Review cut', 'Colour grade']);
  await owner.call('POST', `/api/apps/${appId}/records/tasks`, { data: { title: 'Added from elsewhere' } });
  await expect(f.locator('li span')).toHaveText(['Review cut', 'Colour grade', 'Added from elsewhere'], { timeout: 10_000 });
});

test('Claude window.storage apps: shared values are shared, private values stay private', async ({ browser }) => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const appId = (await upload(owner, 'tests/fixtures/studio-poll.html')).json.app.id;
  const e = await createUser(owner, 'Pia Poller');
  await owner.call('POST', `/api/apps/${appId}/members`, { email: e.email, role: 'editor' });

  const a = await signIn(browser, OWNER.email, OWNER.password);
  await a.goto(`/apps/${appId}`);
  await frameOf(a).locator('.opt', { hasText: 'Rooftop at sunset' }).click();
  await frameOf(a).locator('#note').fill('owner secret note');
  await expect(frameOf(a).locator('#note-status')).toHaveText('Saved');
  await expect(a.locator('.sync')).toHaveText(/Saved/);

  const p = await signIn(browser, e.email, e.password);
  await p.goto(`/apps/${appId}`);
  await expect(frameOf(p).locator('#info')).toHaveText('1 vote so far.');
  await expect(frameOf(p).locator('#note')).toHaveValue('');
  const editor = await apiAs(e.email, e.password);
  const snap = await editor.call('GET', `/api/apps/${appId}/kv`);
  expect(JSON.stringify(snap.json.data)).not.toContain('owner secret note');
});

test('unsafe or wrong uploads are rejected with a clear reason', async () => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const cases: [Buffer, string, RegExp][] = [
    [makeZip([{ name: '../evil.html', data: '<html>x</html>' }, { name: 'index.html', data: '<html></html>' }]), 'a.zip', /unsafe file path/i],
    [makeZip([{ name: 'index.html', data: '<html></html>' }, { name: 'link', data: '/etc/passwd', mode: 0o120777 }]), 'b.zip', /symlink/i],
    [makeZip([{ name: 'readme.txt', data: 'hi' }]), 'c.zip', /Missing index.html/i],
    [makeZip([{ name: 'package.json', data: '{}' }, { name: 'src/main.js', data: '' }]), 'd.zip', /source code/i],
    [Buffer.from('just text'), 'e.txt', /\.zip file or a single \.html/i],
  ];
  for (const [buffer, name, why] of cases) {
    const r = await upload(owner, { name, buffer });
    expect(r.status, name).toBe(400);
    expect(r.json.message, name).toMatch(why);
  }
  // A ZIP with one wrapper folder (how most tools zip a folder) works.
  const ok = await upload(owner, { name: 'site.zip', buffer: makeZip([{ name: 'my-site/index.html', data: '<!doctype html><title>Wrapped</title><p>hi' }, { name: 'my-site/app.js', data: 'localStorage.x=1' }]) });
  expect(ok.status).toBe(200);
  expect(ok.json.app.name).toBe('Wrapped');
});

test('a new version keeps saved data; a broken upload leaves the live version alone; rollback works', async () => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const appId = (await upload(owner, { name: 'v1.html', buffer: Buffer.from('<!doctype html><title>Versioned</title><p>one') })).json.app.id;
  await owner.call('PUT', `/api/apps/${appId}/kv`, { ns: 'ls', scope: 'shared', key: 'k', value: 'kept', baseRev: 0 });
  const v2 = await owner.ctx.post(`/api/apps/${appId}/versions`, { multipart: { file: { name: 'v2.html', mimeType: 'text/html', buffer: Buffer.from('<!doctype html><title>Versioned</title><p>two') } }, headers: { 'x-csrf-token': owner.csrf } });
  expect((await v2.json()).app.liveVersion).toBe(2);
  const bad = await owner.ctx.post(`/api/apps/${appId}/versions`, { multipart: { file: { name: 'bad.zip', mimeType: 'application/zip', buffer: makeZip([{ name: 'x.txt', data: 'x' }]) } }, headers: { 'x-csrf-token': owner.csrf } });
  expect(bad.status()).toBe(400);
  let detail = await owner.call('GET', `/api/apps/${appId}`);
  expect(detail.json.app.liveVersion).toBe(2);
  expect(detail.json.app.versions.map((v: any) => v.n)).toEqual([2, 1]);
  expect((await owner.call('GET', `/api/apps/${appId}/kv`)).json.data.ls.s.k[0]).toBe('kept');
  await owner.call('POST', `/api/apps/${appId}/rollback`, { n: 1 });
  detail = await owner.call('GET', `/api/apps/${appId}`);
  expect(detail.json.app.liveVersion).toBe(1);
  const run = await owner.call('POST', `/api/apps/${appId}/launch`);
  expect(await (await owner.ctx.get(run.json.url)).text()).toContain('<p>one');
});

test('requests without the Jhino header or CSRF token are refused', async () => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const noHeader = await owner.ctx.fetch('/api/apps', { method: 'POST', headers: { 'x-jhino': '' } });
  expect(noHeader.status()).toBe(403);
  const noCsrf = await owner.ctx.fetch('/api/users', { method: 'POST', data: { email: 'x@y.z', name: 'X' } });
  expect(noCsrf.status()).toBe(403);
  const anon = await pwRequest.newContext({ baseURL: BASE });
  expect((await anon.get('/api/apps')).status()).toBe(401);
});

test('the uploaded app runs sandboxed and cannot reach the Jhino page or its session', async ({ browser }) => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const probe = `<!doctype html><title>Probe</title><body><script>
    const out = {};
    try { out.parentDoc = !!parent.document.body; } catch (e) { out.parentDoc = 'blocked'; }
    out.origin = String(self.origin);
    out.cookie = document.cookie;
    fetch('/api/me', { credentials: 'include' }).then(r => r.text()).then(t => { out.me = t; }, () => { out.me = 'blocked'; })
      .finally(() => { document.body.dataset.result = JSON.stringify(out); });
  </script></body>`;
  const appId = (await upload(owner, { name: 'probe.html', buffer: Buffer.from(probe) })).json.app.id;
  const page = await signIn(browser, OWNER.email, OWNER.password);
  await page.goto(`/apps/${appId}`);
  const body = frameOf(page).locator('body[data-result]');
  await expect(body).toHaveCount(1, { timeout: 10_000 });
  const result = JSON.parse((await body.getAttribute('data-result'))!);
  expect(result.parentDoc).toBe('blocked');
  expect(result.origin).toBe('null');
  expect(result.cookie).toBe('');
  expect(result.me).not.toContain('owner@test.local');
});
