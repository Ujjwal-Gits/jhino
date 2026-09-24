import { test, expect, request as pwRequest, type Browser } from '@playwright/test';

/*
 * Apps that keep their data in IndexedDB. Browsers block IndexedDB in the sandboxed app frame, so Jhino
 * gives them one that saves every record on the server: it survives a reload and is shared between people.
 */
const OWNER = { email: 'owner@test.local', password: 'owner-password-123' };
const BASE = 'http://127.0.0.1:4399';
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

// A payments tracker written the usual way: raw IndexedDB, an auto-increment store with an index,
// a cursor to mark paid, delete by key, and a small receipt image stored as a Blob.
const APP = `<!doctype html><html><head><meta charset="utf-8"><title>Payments</title></head><body>
<h1>Payments</h1>
<form id="f"><input id="amount" type="number" value="10"><input id="note"><button>Save payment</button></form>
<ul id="list"></ul><p id="total"></p>
<script>
let db;
const req = indexedDB.open('studio-payments', 1);
req.onupgradeneeded = (e) => {
  const d = e.target.result;
  const s = d.createObjectStore('payments', { keyPath: 'id', autoIncrement: true });
  s.createIndex('month', 'month');
};
req.onsuccess = () => { db = req.result; render(); };
req.onerror = () => { document.body.dataset.error = String(req.error); };
function render() {
  const tx = db.transaction('payments');
  tx.objectStore('payments').getAll().onsuccess = (e) => {
    const rows = e.target.result;
    const ul = document.getElementById('list'); ul.innerHTML = '';
    rows.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'pay' + (p.paid ? ' paid' : '');
      li.dataset.id = p.id;
      li.textContent = p.amount + ' NPR · ' + p.note + ' · ' + p.month + ' · ' + (p.at instanceof Date ? 'dated' : 'undated') + ' · ' + (p.receipt instanceof Blob ? 'receipt ' + p.receipt.size + 'B' : 'no receipt');
      const del = document.createElement('button'); del.textContent = 'Delete'; del.className = 'del';
      del.onclick = () => { const t = db.transaction('payments', 'readwrite'); t.objectStore('payments').delete(p.id); t.oncomplete = render; };
      li.appendChild(del); ul.appendChild(li);
    });
    document.getElementById('total').textContent = 'Total ' + rows.reduce((s, p) => s + p.amount, 0);
  };
}
document.getElementById('f').onsubmit = (e) => {
  e.preventDefault();
  const tx = db.transaction('payments', 'readwrite');
  tx.objectStore('payments').add({ amount: Number(document.getElementById('amount').value), note: document.getElementById('note').value,
    month: '2026-09', at: new Date(), paid: false, receipt: new Blob(['receipt-bytes'], { type: 'text/plain' }) });
  tx.oncomplete = () => { document.getElementById('note').value = ''; render(); };
};
window.markAllPaid = () => new Promise((ok) => {
  const tx = db.transaction('payments', 'readwrite');
  tx.objectStore('payments').openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { c.update(Object.assign({}, c.value, { paid: true })); c.continue(); } };
  tx.oncomplete = () => { render(); ok(); };
});
</script></body></html>`;

async function webSignIn(browser: Browser, login: string, password: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await page.fill('input[autocomplete=username]', login);
  await page.fill('input[type=password]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('h1');
  return page;
}

test('IndexedDB apps: records are saved on the server, survive a reload and are shared', async ({ browser }) => {
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-jhino': '1' } });
  await api.post('/api/auth/login', { data: OWNER });
  const csrf = (await (await api.get('/api/me')).json()).csrf;
  const up = await api.post('/api/apps', { multipart: { name: 'Payments', file: { name: 'payments.html', mimeType: 'text/html', buffer: Buffer.from(APP) } }, headers: { 'x-csrf-token': csrf } });
  expect(up.status()).toBe(200);
  const app = (await up.json()).app;
  expect(app.features.indexedDB).toBe(true);
  const login = 'accounts' + String(Date.now()).slice(-7);
  const person = await (await api.post(`/api/apps/${app.id}/people`, { data: { name: 'Accounts', login, role: 'editor' }, headers: { 'x-csrf-token': csrf } })).json();

  const A = await webSignIn(browser, OWNER.email, OWNER.password);
  await A.goto(`/apps/${app.id}`);
  const FA = A.frameLocator('iframe');
  await expect(FA.locator('#total')).toHaveText('Total 0');
  await expect(FA.locator('body')).not.toHaveAttribute('data-error', /.+/);

  // Save two payments (the case that failed with "Cannot read properties of undefined (reading 'transaction')").
  await FA.locator('#amount').fill('1500');
  await FA.locator('#note').fill('Advance');
  await FA.locator('button', { hasText: 'Save payment' }).click();
  await expect(FA.locator('li.pay')).toHaveCount(1);
  await FA.locator('#amount').fill('2500');
  await FA.locator('#note').fill('Final');
  await FA.locator('button', { hasText: 'Save payment' }).click();
  await expect(FA.locator('#total')).toHaveText('Total 4000');
  await expect(A.locator('.sync')).toHaveText(/Saved/);

  // On the server: one saved key per record, plus the database structure.
  await expect.poll(async () => Object.keys((await (await api.get(`/api/apps/${app.id}/kv`)).json()).data.ws.s).filter((k) => k.startsWith('__idb/')).length).toBe(3);

  // A reload brings it all back, with dates and files intact.
  await A.reload();
  await expect(FA.locator('#total')).toHaveText('Total 4000', { timeout: 15_000 });
  await expect(FA.locator('li.pay').first()).toContainText('dated');
  await expect(FA.locator('li.pay').first()).toContainText('receipt 13B');

  // The client sees the same payments, marks them paid, and deletes one; the owner sees both changes.
  const B = await webSignIn(browser, login, person.password);
  await B.goto(`/apps/${app.id}`);
  const FB = B.frameLocator('iframe');
  await expect(FB.locator('#total')).toHaveText('Total 4000', { timeout: 15_000 });
  const fb = B.frames().find((f) => f.url().includes('/run/'))!;
  await fb.evaluate(() => (window as any).markAllPaid());
  await FB.locator('li.pay', { hasText: 'Advance' }).locator('button.del').click();
  await expect(FB.locator('#total')).toHaveText('Total 2500');
  await expect(FA.locator('#total')).toHaveText('Total 2500', { timeout: 20_000 });
  await expect(FA.locator('li.pay.paid')).toHaveCount(1);

  // And it is still there after a reload.
  await A.reload();
  await expect(FA.locator('#total')).toHaveText('Total 2500', { timeout: 15_000 });
  await expect(FA.locator('li.pay.paid', { hasText: 'Final' })).toHaveCount(1);
  await api.dispose();
});
