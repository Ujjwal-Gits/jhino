import { test, expect, request as pwRequest, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/*
 * The working surfaces of a created HTML: activity (who did what, privately where it should be),
 * Nepali dates, documents, to-dos and messages, used from both sides at once.
 */
const OWNER = { email: 'owner@test.local', password: 'owner-password-123' };
const BASE = 'http://127.0.0.1:4399';

test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

interface Api { ctx: APIRequestContext; csrf: string; call: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }> }
async function apiAs(login: string, password: string): Promise<Api> {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-jhino': '1' } });
  expect((await ctx.post('/api/auth/login', { data: { email: login, password } })).status()).toBe(200);
  const csrf = (await (await ctx.get('/api/me')).json()).csrf as string;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await ctx.fetch(path, { method, data: body, headers: { 'x-csrf-token': csrf } });
    let json: any = null;
    try { json = await res.json(); } catch { /* not json */ }
    return { status: res.status(), json };
  };
  return { ctx, csrf, call };
}
async function build(owner: Api, name: string, presets: string[], design: Record<string, unknown> = {}) {
  const cat = (await owner.call('GET', '/api/build/catalog')).json;
  const blocks = presets.map((p, i) => ({ id: `${p}_w${i}`, preset: p, title: cat.blocks.find((b: any) => b.key === p).name }));
  const r = await owner.call('POST', '/api/apps/build', { config: { name, client: 'Brand', field: 'other', design: { accent: '#1f6f5c', style: 'modern', currency: 'NPR', theme: 'light', ...design }, blocks } });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return { id: r.json.app.id as string, col: (p: string) => blocks.find((b) => b.preset === p)!.id };
}
async function person(owner: Api, appId: string, name: string, role: string) {
  const r = await owner.call('POST', `/api/apps/${appId}/people`, { name, login: name.toLowerCase().replace(/\W/g, '') + String(Date.now()).slice(-6), role });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return { login: r.json.person.login as string, password: r.json.password as string, id: r.json.person.id as string };
}
async function signIn(browser: Browser, login: string, password: string, width = 1360): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 860 } })).newPage();
  await page.goto('/login');
  await page.fill('input[autocomplete=username]', login);
  await page.fill('input[type=password]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('h1');
  return page;
}

test('activity: lines point at their item, private items stay private, and "seen" is remembered', async () => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const app = await build(owner, 'Activity test', ['contracts', 'tasks']);
  const sita = await person(owner, app.id, 'Sita', 'contributor');
  const ravi = await person(owner, app.id, 'Ravi', 'contributor');
  const S = await apiAs(sita.login, sita.password);
  const R = await apiAs(ravi.login, ravi.password);
  const up = await owner.ctx.post(`/api/apps/${app.id}/files`, { multipart: { file: { name: 'nda-sita.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 nda') } }, headers: { 'x-csrf-token': owner.csrf } });
  const doc = (await up.json()).file.id;
  const contract = await owner.call('POST', `/api/apps/${app.id}/records/${app.col('contracts')}`, { data: { title: 'NDA for Sita', signer: sita.id, document: doc } });
  expect(contract.status).toBe(200);
  const task = await owner.call('POST', `/api/apps/${app.id}/records/${app.col('tasks')}`, { data: { title: 'Send the shot list', status: 'To do', side: 'Us' } });
  await owner.call('PATCH', `/api/apps/${app.id}/records/${app.col('tasks')}/${task.json.record.id}`, { data: { status: 'Done' } });

  const lines = async (who: Api) => (await who.call('GET', `/api/apps/${app.id}/activity`)).json;
  const own = await lines(owner);
  const moved = own.activity.find((l: any) => l.recordId === task.json.record.id && l.kind === 'status');
  expect(moved.action).toContain('to Done');
  expect(moved.collection).toBe(app.col('tasks'));
  // Sita is named in the contract, so she sees it; Ravi sees neither the contract nor its file.
  const forSita = await lines(S);
  const forRavi = await lines(R);
  expect(forSita.activity.some((l: any) => l.recordId === contract.json.record.id)).toBe(true);
  expect(forRavi.activity.some((l: any) => l.recordId === contract.json.record.id)).toBe(false);
  expect(forRavi.activity.some((l: any) => /nda-sita/.test(l.detail))).toBe(false);
  expect(forRavi.activity.some((l: any) => l.recordId === task.json.record.id)).toBe(true);
  // Seen is kept per person and never goes backwards.
  const top = forRavi.activity[0].id;
  expect((await R.call('POST', `/api/apps/${app.id}/activity/seen`, { upTo: top })).status).toBe(200);
  expect((await R.call('POST', `/api/apps/${app.id}/activity/seen`, { upTo: 1 })).status).toBe(200);
  expect((await lines(R)).seen).toBe(top);
  expect((await lines(S)).seen).toBe(0);
  // Comments are activity on the item they belong to.
  const withComments = await build(owner, 'Comment activity', ['video_review']);
  const up2 = await owner.ctx.post(`/api/apps/${withComments.id}/files`, { multipart: { file: { name: 'cut.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video') } }, headers: { 'x-csrf-token': owner.csrf } });
  const vid = await owner.call('POST', `/api/apps/${withComments.id}/records/${withComments.col('video_review')}`, { data: { title: 'Cut 1', video: (await up2.json()).file.id } });
  await owner.call('POST', `/api/apps/${withComments.id}/records/${withComments.col('video_review')}_comments`, { data: { rec: vid.json.record.id, body: 'Check the ending' } });
  const c = (await owner.call('GET', `/api/apps/${withComments.id}/activity`)).json.activity.find((l: any) => l.kind === 'comment');
  expect(c.recordId).toBe(vid.json.record.id);
  expect(c.collection).toBe(withComments.col('video_review'));
  expect(c.note).toBe('Check the ending');
  expect(c.action).toContain('commented on “Cut 1”');
});

test('dates: Nepali (BS) first with AD alongside, or AD when the owner picks it', async ({ browser }) => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const bs = await build(owner, 'BS dates', ['shoots']);
  const rec = await owner.call('POST', `/api/apps/${bs.id}/records/${bs.col('shoots')}`, { data: { title: 'Tea garden shoot', date: '2026-09-24' } });
  const page = await signIn(browser, OWNER.email, OWNER.password);
  await page.goto(`/apps/${bs.id}#${bs.col('shoots')}/${rec.json.record.id}`);
  const F = page.frameLocator('iframe');
  await expect(F.locator('.ip-title h2')).toHaveText('Tea garden shoot');
  const date = F.locator('.ip-dl .dp');
  await expect(date).toContainText('8 Asoj 2083');
  await expect(date).toContainText('24 Sep 2026');
  await date.click();
  await expect(F.locator('.dp-pop .dp-t b')).toHaveText('Asoj 2083');
  await expect(F.locator('.dp-pop .dp-d.sel .n')).toHaveText('8');
  await expect(F.locator('.dp-pop .dp-d.sel small')).toHaveText('24');
  // Pick the next day: it saves as the AD date underneath, and both sides see it.
  await F.locator('.dp-pop .dp-d', { has: F.locator('.n', { hasText: /^9$/ }) }).first().click();
  await expect(F.locator('.ip-dl .dp')).toContainText('9 Asoj 2083');
  await expect.poll(async () => (await owner.call('GET', `/api/apps/${bs.id}/records/${bs.col('shoots')}/${rec.json.record.id}`)).json.record.data.date).toBe('2026-09-25');
  // The calendar for that month is the BS month, with Saturday marked.
  await F.locator('.ip-top button').first().click();
  await F.locator('.cal-h .btn', { hasText: 'Today' }).click();
  await expect(F.locator('.cal .dow').last()).toHaveText('Sat');

  const ad = await build(owner, 'AD dates', ['shoots'], { calendar: 'ad' });
  const rec2 = await owner.call('POST', `/api/apps/${ad.id}/records/${ad.col('shoots')}`, { data: { title: 'City shoot', date: '2026-09-24' } });
  await page.goto(`/apps/${ad.id}#${ad.col('shoots')}/${rec2.json.record.id}`);
  await expect(F.locator('.ip-dl .dp')).toContainText('24 Sep 2026');
  await expect(F.locator('.ip-dl .dp')).not.toContainText('Asoj');
});

test('documents, to-dos and messages work from both sides at once', async ({ browser }) => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const app = await build(owner, 'Workspace test', ['captions', 'todos', 'messages']);
  const client = await person(owner, app.id, 'Kiran', 'editor');
  const us = await signIn(browser, OWNER.email, OWNER.password);
  await us.goto(`/apps/${app.id}`);
  const U = us.frameLocator('iframe');
  const them = await signIn(browser, client.login, client.password);
  await them.waitForURL(new RegExp(`/apps/${app.id}(#.*)?$`));
  const T = them.frameLocator('iframe');

  // A script: we write it, the client reads and approves it.
  await U.locator('.nav button', { hasText: 'Scripts and captions' }).click();
  await U.locator('button:has-text("New script")').first().click();
  await U.locator('.doc-title').fill('Reel one: the first cup');
  await U.locator('.doc-write').click();
  await U.locator('.doc-write').fill('Steam rising off the first cup of the season.');
  await expect(U.locator('.doc-save')).toHaveText('Saved', { timeout: 10_000 });
  await expect(U.locator('.doc-item b').first()).toHaveText('Reel one: the first cup');
  await T.locator('.nav button', { hasText: 'Scripts and captions' }).click();
  await expect(T.locator('.doc-item b').first()).toHaveText('Reel one: the first cup');
  await T.locator('.doc-item').first().click();
  await expect(T.locator('.doc-read')).toContainText('Steam rising off the first cup');
  await T.locator('.ip-approve button:has-text("Approve")').click();
  await expect(U.locator('.doc-item .badge').first()).toHaveText('Approved');

  // To-dos: typed quickly one after another, none are lost; the client ticks one, we see it.
  await U.locator('.nav button', { hasText: 'To-do list' }).click();
  const box = U.locator('.todo-add input.input');
  await box.fill('Colour-grade the stills');
  await box.press('Enter');
  await box.pressSequentially('Book the studio', { delay: 5 });
  await box.press('Enter');
  await expect(U.locator('.check-row .t')).toHaveText(['Colour-grade the stills', 'Book the studio']);
  await T.locator('.nav button', { hasText: 'To-do list' }).click();
  await T.locator('.check-row', { hasText: 'Book the studio' }).locator('input[type=checkbox]').check();
  await expect(U.locator('.todo-prog')).toContainText('1 of 2');

  // Messages, both ways.
  await U.locator('.nav button', { hasText: 'Messages' }).click();
  await U.locator('.chat-input').fill('The first cut is up.');
  await U.locator('.chat-input').press('Enter');
  await T.locator('.nav button', { hasText: 'Messages' }).click();
  await expect(T.locator('.bubble', { hasText: 'The first cut is up.' })).toBeVisible();
  await T.locator('.chat-input').fill('Thanks, watching now.');
  await T.locator('.chat-input').press('Enter');
  await expect(U.locator('.bubble', { hasText: 'Thanks, watching now.' })).toBeVisible();
  await expect(U.locator('.msg.mine .bubble')).toHaveText('The first cut is up.');
});

test('trash: deleted items (with their comments) and files wait in Trash; restore brings them back; only editors delete for good', async () => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const app = await build(owner, 'Trash test', ['video_review', 'tasks']);
  const kiran = await person(owner, app.id, 'Kiran', 'contributor');
  const K = await apiAs(kiran.login, kiran.password);
  const T = `/api/apps/${app.id}/records/${app.col('tasks')}`;
  const V = `/api/apps/${app.id}/records/${app.col('video_review')}`;
  const up = await owner.ctx.post(`/api/apps/${app.id}/files`, { multipart: { file: { name: 'cut.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video') } }, headers: { 'x-csrf-token': owner.csrf } });
  const fileId = (await up.json()).file.id as string;
  const vid = await owner.call('POST', V, { data: { title: 'Cut 1', video: fileId } });
  await owner.call('POST', `${V.replace(app.col('video_review'), app.col('video_review') + '_comments')}`, { data: { rec: vid.json.record.id, body: 'Warmer at the end' } });
  // Delete the video item: it and its comment go to Trash.
  expect((await owner.call('DELETE', `${V}/${vid.json.record.id}`)).status).toBe(200);
  expect((await owner.call('GET', V)).json.items).toHaveLength(0);
  let trash = (await owner.call('GET', `/api/apps/${app.id}/trash`)).json;
  const item = trash.items.find((t: any) => t.recordId === vid.json.record.id);
  expect(item.label).toBe('Cut 1');
  expect(item.comments).toBe(1);
  expect(trash.canPurge).toBe(true);
  // Restore: same id, same data, the comment is back too.
  expect((await owner.call('POST', `/api/apps/${app.id}/trash/restore`, { ids: [item.id] })).status).toBe(200);
  expect((await owner.call('GET', `${V}/${vid.json.record.id}`)).json.record.data.title).toBe('Cut 1');
  expect((await owner.call('GET', `${V.replace(app.col('video_review'), app.col('video_review') + '_comments')}`)).json.items).toHaveLength(1);
  // Files: deleting hides the file; restoring makes it readable again; deleting for good removes it.
  expect((await owner.call('DELETE', `/api/apps/${app.id}/files/${fileId}`)).status).toBe(200);
  expect((await owner.ctx.get(`/api/apps/${app.id}/files/${fileId}`)).status()).toBe(404);
  trash = (await owner.call('GET', `/api/apps/${app.id}/trash`)).json;
  const f = trash.items.find((t: any) => t.kind === 'file' && t.recordId === fileId);
  expect(f.label).toBe('cut.mp4');
  await owner.call('POST', `/api/apps/${app.id}/trash/restore`, { ids: [f.id] });
  expect((await owner.ctx.get(`/api/apps/${app.id}/files/${fileId}`)).status()).toBe(200);
  // A contributor's own item: they see it in Trash and may restore it, but not delete it for good.
  const task = await K.call('POST', T, { data: { title: 'Kiran task', status: 'To do', side: 'Client' } });
  expect((await K.call('DELETE', `${T}/${task.json.record.id}`)).status).toBe(200);
  const kt = (await K.call('GET', `/api/apps/${app.id}/trash`)).json;
  expect(kt.canPurge).toBe(false);
  expect(kt.items.map((t: any) => t.label)).toEqual(['Kiran task']);
  expect((await K.call('POST', `/api/apps/${app.id}/trash/purge`, { ids: [kt.items[0].id] })).status).toBe(403);
  // The owner's video is not the contributor's to restore.
  await owner.call('DELETE', `${V}/${vid.json.record.id}`);
  const ownerTrash = (await owner.call('GET', `/api/apps/${app.id}/trash`)).json;
  const vItem = ownerTrash.items.find((t: any) => t.recordId === vid.json.record.id);
  expect((await K.call('POST', `/api/apps/${app.id}/trash/restore`, { ids: [vItem.id] })).status).toBe(200); // not visible to Kiran: silently skipped
  expect((await owner.call('GET', V)).json.items).toHaveLength(0);
  expect((await owner.call('POST', `/api/apps/${app.id}/trash/purge`, { ids: [vItem.id] })).status).toBe(200);
  expect((await owner.call('GET', `/api/apps/${app.id}/trash`)).json.items.some((t: any) => t.recordId === vid.json.record.id)).toBe(false);
});

test('files and links on an item, several at once; removing goes to Trash; the screen restores it', async ({ browser }) => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const app = await build(owner, 'Attachments test', ['tasks']);
  const rec = await owner.call('POST', `/api/apps/${app.id}/records/${app.col('tasks')}`, { data: { title: 'Launch checklist', status: 'To do', side: 'Us' } });
  const page = await signIn(browser, OWNER.email, OWNER.password);
  await page.goto(`/apps/${app.id}#${app.col('tasks')}/${rec.json.record.id}`);
  const F = page.frameLocator('iframe');
  await expect(F.locator('.ip-title h2')).toHaveText('Launch checklist');
  await F.locator('.attbox input[type=url]').fill('https://www.figma.com/file/abc https://drive.google.com/drive/folders/xyz');
  await F.locator('.attbox button:has-text("Add link")').click();
  await expect(F.locator('.att')).toHaveCount(2);
  await F.locator('.attbox input[type=file]').setInputFiles([
    { name: 'brief.txt', mimeType: 'text/plain', buffer: Buffer.from('The brief') },
    { name: 'logo.txt', mimeType: 'text/plain', buffer: Buffer.from('The logo') },
  ]);
  await expect(F.locator('.att')).toHaveCount(4);
  await expect(F.locator('.att', { hasText: 'figma.com' })).toBeVisible();
  // Select two and remove them together.
  await F.locator('.att', { hasText: 'brief.txt' }).locator('input[type=checkbox]').check();
  await F.locator('.att', { hasText: 'drive.google.com' }).locator('input[type=checkbox]').check();
  await F.locator('.attbox .bulk button:has-text("Remove")').click();
  await expect(F.locator('.att')).toHaveCount(2);
  // Both wait in Trash; restore them.
  await F.locator('.nav-trash').click();
  await expect(F.locator('.tr-row')).toHaveCount(2);
  await F.locator('.toolbar .switch input').check();
  await F.locator('.bulk button:has-text("Restore")').click();
  await expect(F.locator('.tr-row')).toHaveCount(0);
  await page.goto(`/apps/${app.id}#${app.col('tasks')}/${rec.json.record.id}`);
  await expect(F.locator('.att')).toHaveCount(4);
  // The restored file downloads again.
  const saved = (await owner.call('GET', `/api/apps/${app.id}/records/${app.col('tasks')}/${rec.json.record.id}`)).json.record.data.attachments;
  const brief = saved.find((a: any) => a.name === 'brief.txt');
  expect(await (await owner.ctx.get(`/api/apps/${app.id}/files/${brief.id}`)).text()).toBe('The brief');
  // Deleting the whole item: it goes to Trash, and Undo brings it back.
  await F.locator('.ip-head button[aria-label="Delete"]').click();
  await F.locator('.toast-a', { hasText: 'Undo' }).click();
  await expect.poll(async () => (await owner.call('GET', `/api/apps/${app.id}/records/${app.col('tasks')}`)).json.items.length).toBe(1);
});

test('My apps: each app shows its client, the latest thing that happened and what is new', async ({ browser }) => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const room = 'Pulse room ' + String(Date.now()).slice(-6);
  const app = await build(owner, room, ['tasks']);
  const client = await person(owner, app.id, 'Mira', 'editor');
  const M = await apiAs(client.login, client.password);
  await M.call('POST', `/api/apps/${app.id}/records/${app.col('tasks')}`, { data: { title: 'Send the brand fonts', status: 'To do', side: 'Client' } });
  const page = await signIn(browser, OWNER.email, OWNER.password);
  const card = page.locator('.ix-row', { hasText: room });
  await expect(card.locator('.ix-client')).toHaveText('Brand');
  await expect(card.locator('.ix-last')).toContainText('Mira');
  await expect(card.locator('.ix-last')).toContainText('Send the brand fonts');
  await expect(card.locator('.ix-new')).toHaveText(/^[1-9]\d* new$/);
  // Apps with something new come first.
  await expect(page.locator('.ix-row').first()).toHaveClass(/is-new/);
  await expect(page.locator('.ix-sum .hot')).toContainText('with something new');
  // Search and the row menu.
  await page.locator('.ix-search input').fill(room.toLowerCase());
  await expect(page.locator('.ix-row')).toHaveCount(1);
  await card.locator('.ap-more').click();
  await expect(page.locator('.menu button', { hasText: 'Open in a new tab' })).toBeVisible();
  await page.locator('.menu button', { hasText: 'Open' }).first().click();
  await page.waitForURL(new RegExp(`/apps/${app.id}`));
});

test('open in a new tab shows only that item; "Open in the app" goes to the whole app', async ({ browser }) => {
  const owner = await apiAs(OWNER.email, OWNER.password);
  const app = await build(owner, 'New tab test', ['briefs', 'tasks']);
  const brief = await owner.call('POST', `/api/apps/${app.id}/records/${app.col('briefs')}`, { data: { title: 'Autumn brief', body: '# Goal\nWarm, slow, honest.' } });
  const page = await signIn(browser, OWNER.email, OWNER.password);
  await page.goto(`/apps/${app.id}#${app.col('briefs')}`);
  const F = page.frameLocator('iframe');
  await F.locator('.doc-item', { hasText: 'Autumn brief' }).click();
  const [tab] = await Promise.all([page.context().waitForEvent('page'), F.locator('.doc-bar button[aria-label="Open in a new tab"]').click()]);
  await tab.waitForLoadState();
  expect(tab.url()).toContain(`/apps/${app.id}/view#${app.col('briefs')}/${brief.json.record.id}`);
  const T = tab.frameLocator('iframe');
  await expect(T.locator('.solo-doc .doc-title')).toHaveValue('Autumn brief');
  await expect(T.locator('.doc-read h1')).toHaveText('Goal');
  await expect(T.locator('.side')).toBeHidden();
  await expect(T.locator('.doc-list')).toHaveCount(0);
  await expect(tab.locator('.player-bar')).toHaveCount(0);
  await expect(tab).toHaveTitle(/Autumn brief/);
  await T.locator('.solo-bar button', { hasText: 'Open in the app' }).click();
  await tab.waitForURL((u) => !u.pathname.endsWith('/view'));
  await expect(T.locator('.nav')).toBeVisible();
  // The page never scrolls past a long document.
  await T.locator('.doc-bar button', { hasText: 'Write' }).click();
  await T.locator('.doc-write').fill('A long brief.\n'.repeat(120));
  const f = tab.frames().find((x) => x.url().includes('/run/'))!;
  await expect.poll(() => f.evaluate(() => document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight)).toBeLessThanOrEqual(2);
});
