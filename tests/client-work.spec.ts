import { test, expect, request as pwRequest, type Browser, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

/*
 * The whole agency <-> client loop on an HTML made with Create HTML:
 * we deliver a video, the client watches, comments and asks for changes; the client adds a receipt with a photo;
 * we share photos and the client picks; every change shows up live on the other side. The big video is made smaller.
 */
const OWNER = { email: 'owner@test.local', password: 'owner-password-123' };
const BASE = 'http://127.0.0.1:4399';
const require = createRequire(import.meta.url);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

async function signIn(browser: Browser, login: string, password: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
  await page.goto('/');
  await page.fill('input[autocomplete=username]', login);
  await page.fill('input[type=password]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('h1');
  return page;
}

/** A real, deliberately heavy H.264 clip (a camera-original stand-in), made with the bundled ffmpeg. */
function heavyVideo(): string {
  const out = path.join(os.tmpdir(), 'jhino-test-cut-10s.mp4');
  if (fs.existsSync(out) && fs.statSync(out).size > 2_000_000) return out;
  const ffmpeg = require('ffmpeg-static') as string;
  execFileSync(ffmpeg, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440',
    '-t', '10', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '6', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out], { stdio: 'ignore' });
  return out;
}

test('client work: deliver a video, client comments and asks for changes, receipts and photo picks sync live, big video is made smaller', async ({ browser }) => {
  test.setTimeout(150_000);
  // Make the HTML, as the studio.
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-jhino': '1' } });
  expect((await api.post('/api/auth/login', { data: { email: OWNER.email, password: OWNER.password } })).status()).toBe(200);
  const csrf = (await (await api.get('/api/me')).json()).csrf as string;
  const blocks = [
    { id: 'video_review_t1', preset: 'video_review', title: 'Video deliveries' },
    { id: 'photo_proofing_t1', preset: 'photo_proofing', title: 'Photo proofing' },
    { id: 'receipts_t1', preset: 'receipts', title: 'Receipts and expenses' },
  ];
  const built = await api.post('/api/apps/build', { headers: { 'x-csrf-token': csrf }, data: { config: { name: 'Everest Tea · Video', client: 'Everest Tea', field: 'video', purpose: 'Autumn film', design: { accent: '#9a3412', style: 'editorial', currency: 'NPR', theme: 'light' }, blocks } } });
  expect(built.status()).toBe(200);
  const appId = (await built.json()).app.id as string;
  const stamp = String(Date.now()).slice(-6);
  const person = await api.post(`/api/apps/${appId}/people`, { headers: { 'x-csrf-token': csrf }, data: { name: 'Everest Tea', login: `everest${stamp}`, role: 'editor' } });
  expect(person.status()).toBe(200);
  const client = await person.json();

  const us = await signIn(browser, OWNER.email, OWNER.password);
  await us.goto(`/apps/${appId}`);
  const U = us.frameLocator('iframe');
  await expect(U.locator('.brand .client')).toHaveText('Everest Tea');

  // The client signs in and lands straight in the app.
  const them = await signIn(browser, client.person.login, client.password);
  await them.waitForURL(new RegExp(`/apps/${appId}(#.*)?$`));
  const T = them.frameLocator('iframe');
  await expect(T.locator('.head h2').first()).toHaveText('Video deliveries');

  // We deliver a cut.
  const video = heavyVideo();
  const originalSize = fs.statSync(video).size;
  await U.locator('button:has-text("Add video")').first().click();
  await U.locator('.drawer input.input').first().fill('Brand film, first cut');
  await U.locator('.drawer input[type=file]').setInputFiles(video);
  await expect(U.locator('.drawer .file-chip')).toBeVisible({ timeout: 30_000 });
  // Someone is already streaming the original while it is made smaller (on Windows an open file cannot be replaced).
  const cookie = (await api.storageState()).cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const vid = (await (await api.get(`/api/apps/${appId}/files`)).json()).files.find((f: any) => f.type.startsWith('video/'));
  const held = http.get(`${BASE}/api/apps/${appId}/files/${vid.id}`, { headers: { cookie, 'x-jhino': '1' } }, (res) => res.once('data', () => res.pause()));
  held.on('error', () => {});
  await U.locator('.drawer button:has-text("Add")').last().click();

  // The client sees it without reloading, opens it, comments and asks for changes.
  const card = T.locator('button.card', { hasText: 'Brand film, first cut' });
  await expect(card).toBeVisible();
  await card.click();
  // It opens as a page of its own: the player, the review bar and the conversation.
  await expect(T.locator('.ip-title h2')).toHaveText('Brand film, first cut');
  await expect(T.locator('.ip-hero video')).toHaveCount(1);
  await T.locator('.thread textarea').fill('Lovely. Please make the logo at the end bigger.');
  await T.locator('.thread button:has-text("Send")').click();
  await expect(T.locator('.thread .cmt-t')).toHaveText('Lovely. Please make the logo at the end bigger.');
  // Asking for changes asks what should change; the answer becomes a comment.
  await T.locator('.ip-approve button:has-text("Ask for changes")').click();
  await T.locator('.modal textarea').fill('And warmer colours at the end.');
  await T.locator('.modal button:has-text("Ask for changes")').click();
  await expect(T.locator('.ip-approve b')).toHaveText('Changes requested');
  await expect(T.locator('.thread .cmt-t')).toHaveText(['Lovely. Please make the logo at the end bigger.', 'And warmer colours at the end.']);
  await T.locator('.ip-top button').first().click();

  // We see the status and the comments live, get a popup, and the bell counts what is new.
  const ourCard = U.locator('button.card', { hasText: 'Brand film, first cut' });
  await expect(ourCard.locator('.badge')).toHaveText('Changes requested');
  await expect(ourCard.locator('.ccount')).toHaveText('2');
  await expect(U.locator('.popup').first()).toContainText('Everest Tea');
  await expect(U.locator('.bell-n').first()).toHaveText(/^[1-9]/);
  await U.locator('.bell').first().click();
  await expect(U.locator('.act-pop .act-line', { hasText: 'Changes requested' }).first()).toBeVisible();
  await U.locator('.act-pop .act-line', { hasText: 'commented on' }).first().click();
  await expect(U.locator('.ip-title h2')).toHaveText('Brand film, first cut');
  await expect(U.locator('.bell-n').first()).toBeHidden();
  await expect(U.locator('.ip-hist')).toContainText('moved it to Changes requested');
  await U.locator('.thread textarea').fill('Done, v2 coming tonight.');
  await U.locator('.thread button:has-text("Send")').click();
  await U.locator('.ip-top button').first().click();
  await card.click();
  await expect(T.locator('.thread .cmt-t')).toHaveText(['Lovely. Please make the logo at the end bigger.', 'And warmer colours at the end.', 'Done, v2 coming tonight.']);
  await T.locator('.ip-top button').first().click();

  // The server made the video smaller and it still streams.
  let file: any;
  await expect.poll(async () => {
    const list = await (await api.get(`/api/apps/${appId}/files`)).json();
    file = list.files.find((f: any) => f.type.startsWith('video/'));
    return file?.status;
  }, { timeout: 90_000 }).toBe('ready');
  expect(file.originalSize).toBe(originalSize);
  expect(file.size).toBeLessThan(originalSize * 0.9);
  expect(file.type).toBe('video/mp4');
  const part = await api.get(`/api/apps/${appId}/files/${file.id}`, { headers: { Range: 'bytes=0-1023' } });
  expect(part.status()).toBe(206);
  expect((await part.body()).subarray(4, 8).toString()).toBe('ftyp');
  held.destroy();

  // The client adds a receipt with a photo; we see it.
  await T.locator('nav button', { hasText: 'Receipts and expenses' }).click();
  await T.locator('button:has-text("Add receipt")').first().click();
  await T.locator('.drawer input.input').first().fill('Taxi to the tea garden');
  await T.locator('.drawer .money-in input').fill('1800');
  await T.locator('.drawer input[type=file]').setInputFiles({ name: 'taxi.png', mimeType: 'image/png', buffer: PNG });
  await expect(T.locator('.drawer img.preview-img')).toBeVisible();
  await T.locator('.drawer button:has-text("Add")').last().click();
  await U.locator('nav button', { hasText: 'Receipts and expenses' }).click();
  await expect(U.locator('td', { hasText: 'Taxi to the tea garden' })).toBeVisible();
  await expect(U.locator('.stat .v').first()).toContainText('1,800.00');

  // We share photos; the client picks one; we see the pick.
  await U.locator('nav button', { hasText: 'Photo proofing' }).click();
  await U.locator('.main input[type=file]').setInputFiles([
    { name: 'tea-01.png', mimeType: 'image/png', buffer: PNG },
    { name: 'tea-02.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await expect(U.locator('.proof-tile')).toHaveCount(2);
  await T.locator('nav button', { hasText: 'Photo proofing' }).click();
  await expect(T.locator('.proof-tile')).toHaveCount(2);
  await T.locator('.proof-tile', { hasText: 'tea-01' }).locator('button.pk-pick').click();
  await expect(U.locator('.proof-tile.is-pick')).toHaveCount(1);
  await expect(U.locator('.proofbar button', { hasText: 'Picked' }).locator('.n')).toHaveText('1');
  await expect(U.locator('.proof-tile.is-pick')).toContainText('tea-01');
  // Every card is the same size; the viewer puts the picks under the photo, and M marks it Maybe.
  const [h1, h2] = await Promise.all(['tea-01', 'tea-02'].map(async (n) => (await T.locator('.proof-tile', { hasText: n }).boundingBox())!.height));
  expect(Math.abs(h1 - h2)).toBeLessThan(1);
  await T.locator('.proof-tile', { hasText: 'tea-02' }).locator('.ftile').click();
  const photo = (await T.locator('.lightbox .stage img').boundingBox())!;
  const picks = (await T.locator('.lightbox .picks.big').boundingBox())!;
  expect(photo.y + photo.height).toBeLessThanOrEqual(picks.y);
  await T.locator('.lightbox').press('m');
  await expect(T.locator('.lightbox .pk-maybe')).toHaveAttribute('aria-pressed', 'true');
  await expect(U.locator('.proof-tile.is-maybe')).toContainText('tea-02');
  await T.locator('.lightbox').press('Escape');

  // We change the built HTML; the client's open copy switches to the new version by itself and stays in the same section.
  const cfg = (await (await api.get(`/api/apps/${appId}/build`)).json()).config;
  cfg.blocks.push({ id: 'links_t1', preset: 'links', title: 'Links and access' });
  expect((await api.post(`/api/apps/${appId}/build`, { headers: { 'x-csrf-token': csrf }, data: { config: cfg } })).status()).toBe(200);
  await expect(T.locator('nav button', { hasText: 'Links and access' })).toBeVisible({ timeout: 20_000 });
  await expect(T.locator('nav button[aria-current=page] .t')).toHaveText('Photo proofing');
  await expect(T.locator('.proof-tile.is-pick')).toHaveCount(1);
  await api.dispose();
});

test('phone: main sections in a bottom bar, everything else behind the menu button', async ({ browser }) => {
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-jhino': '1' } });
  expect((await api.post('/api/auth/login', { data: { email: OWNER.email, password: OWNER.password } })).status()).toBe(200);
  const csrf = (await (await api.get('/api/me')).json()).csrf as string;
  const presets = ['summary', 'video_review', 'shoots', 'receipts', 'invoices', 'tasks', 'links'];
  const blocks = presets.map((p, i) => ({ id: `${p}_p${i}`, preset: p, title: p === 'links' ? 'Useful links' : undefined }));
  const cat = await (await api.get('/api/build/catalog')).json();
  for (const b of blocks) b.title = b.title ?? cat.blocks.find((x: any) => x.key === b.preset).name;
  const built = await api.post('/api/apps/build', { headers: { 'x-csrf-token': csrf }, data: { config: { name: 'Phone test', client: 'Brand', field: 'video', design: {}, blocks } } });
  expect(built.status()).toBe(200);
  const appId = (await built.json()).app.id;

  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
  await page.goto('/');
  await page.fill('input[autocomplete=username]', OWNER.email);
  await page.fill('input[type=password]', OWNER.password);
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('h1');
  await page.goto(`/apps/${appId}`);
  const F = page.frameLocator('iframe');
  await expect(F.locator('.tabs .tl')).toHaveText(['Overview', 'Videos', 'Shoots', 'Receipts', 'More']);
  await expect(F.locator('.side .nav')).toBeHidden();
  await F.locator('.tabs button', { hasText: 'Videos' }).click();
  await expect(F.locator('.head h2')).toHaveText('Video deliveries');
  await F.locator('.burger').click();
  await expect(F.locator('.msheet-l button')).toHaveCount(8); // seven sections and Trash
  await expect(F.locator('.msheet-l button').last()).toContainText('Trash');
  await F.locator('.msheet-l button', { hasText: 'Useful links' }).click();
  await expect(F.locator('.msheet')).toHaveCount(0);
  await expect(F.locator('.head h2')).toHaveText('Useful links');
  // A renamed section keeps its own name in the bar.
  await expect(F.locator('.tabs button[aria-current=page] .tl')).toHaveText('Useful links');
  await api.dispose();
});
