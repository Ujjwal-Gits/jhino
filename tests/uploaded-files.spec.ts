import { test, expect, type Browser, type Page } from '@playwright/test';

const OWNER = { email: 'owner@test.local', password: 'owner-password-123' };

test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

async function signIn(browser: Browser, login: string, password: string, mobile = false): Promise<Page> {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 } } : { viewport: { width: 1360, height: 860 } });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.fill('input[autocomplete=username]', login);
  await page.fill('input[type=password]', password);
  await page.click('button:has-text("Sign in")');
  // Studios land on their page (jhino.com/<username>); go on to My apps. Clients land in their app.
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  if (/^\/[\w-]+$/.test(new URL(page.url()).pathname) && new URL(page.url()).pathname !== '/apps') await page.goto('/apps');
  await page.waitForSelector('h1');
  return page;
}

/** Real media made in the browser: a big photo (well over 150 KB) and a short playable video. */
async function makeMedia(page: Page) {
  return page.evaluate(async () => {
    const toB64 = async (b: Blob) => { const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
    const c = document.createElement('canvas'); c.width = 900; c.height = 700; const g = c.getContext('2d')!;
    const img = g.createImageData(900, 700); for (let i = 0; i < img.data.length; i += 4) { img.data[i] = (i * 13) % 255; img.data[i + 1] = Math.random() * 255; img.data[i + 2] = 90; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    const photo = await toB64(await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png')));
    let video = '';
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm')) {
      const v = document.createElement('canvas'); v.width = 320; v.height = 180; const vg = v.getContext('2d')!;
      const rec = new MediaRecorder(v.captureStream(20), { mimeType: 'video/webm' }); const chunks: Blob[] = []; rec.ondataavailable = (e) => chunks.push(e.data); rec.start();
      for (let i = 0; i < 20; i++) { vg.fillStyle = `hsl(${i * 15},60%,45%)`; vg.fillRect(0, 0, 320, 180); await new Promise((r) => setTimeout(r, 40)); }
      rec.stop(); await new Promise((r) => (rec.onstop = r)); video = await toB64(new Blob(chunks));
    }
    return { photo, video };
  });
}

test('uploaded HTML: photos and videos picked in the app are stored on the server and shared both ways; clients cannot create apps', async ({ browser, browserName }) => {
  const a = await signIn(browser, OWNER.email, OWNER.password);
  const media = await makeMedia(a);
  const photo = { name: 'rent-receipt.png', mimeType: 'image/png', buffer: Buffer.from(media.photo, 'base64') };
  expect(photo.buffer.length).toBeGreaterThan(300_000);

  // We upload our own HTML (a ZIP) and make a sign-in for the client.
  await a.click('header button:has-text("Upload HTML")');
  await a.setInputFiles('dialog input[type=file]', 'tests/fixtures/client-media.zip');
  await a.click('dialog button:has-text("Upload and publish")');
  await a.waitForURL(/\/apps\//);
  const appId = a.url().split('/').pop()!;
  await a.click('button:has-text("Share")');
  const login = 'client' + String(Date.now()).slice(-6) + browserName.slice(0, 2);
  await a.fill('input[placeholder="Sita Sharma"]', 'Client Anita');
  await a.fill('input[placeholder="sita or sita@company.com"]', login);
  await a.click('button:has-text("Create sign-in")');
  const cred = await a.locator('.cred .code').textContent();
  const password = cred!.match(/Password: (.+)/)![1];
  await a.click('.cred button:has-text("Done")');
  await a.keyboard.press('Escape');

  // We add a receipt photo.
  const fa = a.frameLocator('iframe');
  await fa.locator('#title').fill('Studio rent receipt');
  await fa.locator('#file').setInputFiles(photo);
  await expect(fa.locator('#status')).toContainText('ready', { timeout: 30_000 });
  await fa.locator('button:has-text("Add")').click();
  await expect(a.locator('.sync')).toHaveText(/Saved/, { timeout: 30_000 });

  // The client signs in on a phone, lands straight in the app, and sees the photo.
  const c = await signIn(browser, login, password, true);
  await c.waitForURL(new RegExp(`/apps/${appId}(#.*)?$`));
  await expect(c.locator('.home-actions')).toHaveCount(0);
  const fc = c.frameLocator('iframe');
  await expect(fc.locator('.item .title', { hasText: 'Studio rent receipt' })).toBeVisible();
  await expect.poll(() => fc.locator('.item img').first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(800);

  // Videos are shared as links, never stored: a video file picked in the app is refused, and the app says so.
  if (media.video) {
    await fc.locator('#title').fill('Final cut v2');
    await fc.locator('#file').setInputFiles({ name: 'final-cut-v2.webm', mimeType: 'video/webm', buffer: Buffer.from(media.video, 'base64') });
    await expect(c.locator('.toast.error', { hasText: 'Videos are added as links' })).toHaveCount(1, { timeout: 20_000 });
    // The message goes after a few seconds (it sits over the app on a phone).
    await expect(c.locator('.toast.error')).toHaveCount(0, { timeout: 15_000 });
  }
  void browserName;
  // The client adds a canvas-shrunk photo; we see it.
  await fc.locator('#title').fill('Site photo');
  await fc.locator('#shrink').setInputFiles(photo);
  await expect(fc.locator('#status')).toContainText('shrunk', { timeout: 30_000 });
  await fc.locator('button:has-text("Add")').click();
  await expect(fa.locator('.item .title', { hasText: 'Site photo' })).toBeVisible({ timeout: 20_000 });

  // We rename the client's item; the client sees it. The client deletes ours; it goes for us too.
  await a.waitForTimeout(1600);
  const t = fa.locator('.item .title', { hasText: 'Site photo' });
  await t.click();
  await t.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await t.pressSequentially('Site photo (checked)');
  await fa.locator('header h1').click();
  await expect(fc.locator('.item .title', { hasText: 'Site photo (checked)' })).toBeVisible({ timeout: 20_000 });
  await c.waitForTimeout(1600);
  await fc.locator('.item', { hasText: 'Studio rent receipt' }).locator('button:has-text("Delete")').click();
  await expect(fa.locator('.item .title', { hasText: 'Studio rent receipt' })).toHaveCount(0, { timeout: 30_000 });

  // On the server: the saved data holds links, not megabytes of pixels; the files are stored separately.
  const saved = await a.evaluate(async (id) => (await (await fetch(`/api/apps/${id}/kv`)).json()).data.ls.s['project-items'][0] as string, appId);
  expect(saved.length).toBeLessThan(5000);
  expect(saved).toContain('__jhino/files/');
  const files = await a.evaluate(async (id) => (await (await fetch(`/api/apps/${id}/files`)).json()).files.length as number, appId);
  expect(files).toBeGreaterThanOrEqual(2); // the photos; the video was refused (videos are links)

  // Clients cannot put their own apps on the server.
  const status = await c.evaluate(async () => {
    const me = await (await fetch('/api/me')).json();
    const fd = new FormData(); fd.append('file', new Blob(['<html>x</html>'], { type: 'text/html' }), 'x.html');
    return (await fetch('/api/apps', { method: 'POST', body: fd, headers: { 'x-jhino': '1', 'x-csrf-token': me.csrf } })).status;
  });
  expect(status).toBe(403);
});
