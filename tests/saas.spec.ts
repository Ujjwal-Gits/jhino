import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';

/*
 * The account system, plans, QR payments, link sharing, hosting and booking reminders,
 * checked through the API the way an attacker would try them, plus the key screens.
 */
const BASE = 'http://127.0.0.1:4399';
const OWNER = { email: 'owner@test.local', password: 'owner-password-123' };
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

interface Api { ctx: APIRequestContext; csrf: string; call: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }> }
async function session(login?: { email: string; password: string }): Promise<Api> {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-jhino': '1' } });
  let csrf = '';
  if (login) {
    const r = await ctx.post('/api/auth/login', { data: login });
    expect(r.status(), await r.text()).toBe(200);
    csrf = (await (await ctx.get('/api/me')).json()).csrf;
  }
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await ctx.fetch(path, { method, data: body, headers: csrf ? { 'x-csrf-token': csrf } : {} });
    let json: any = null;
    try { json = await res.json(); } catch { /* not json */ }
    return { status: res.status(), json };
  };
  return { ctx, csrf, call };
}
const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// A real 1x1 PNG, and a file that only pretends to be one.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const FAKE_PNG = Buffer.from('<script>alert(1)</script>');

async function signup(name: string) {
  const email = `${name.toLowerCase()}.${uniq()}@example.com`;
  const s = await session();
  const r = await s.ctx.post('/api/auth/signup', { data: { name, email, password: 'a-good-password-1', terms: true } });
  expect(r.status(), await r.text()).toBe(200);
  return { email, password: 'a-good-password-1' };
}
/** The latest email to someone, from the log (no SMTP in tests). */
async function lastMail(admin: Api, to: string, kind?: string) {
  const r = await admin.call('GET', '/api/admin/emails');
  return r.json.emails.find((m: any) => m.to === to && (!kind || m.kind === kind));
}
const linkIn = (body: string, path: string) => new URL(body.match(new RegExp(`https?://\\S+${path}\\?token=[\\w-]+`))![0]).searchParams.get('token')!;

test('accounts: sign up, confirm email, reset password once, change password, sessions, export, delete', async () => {
  const admin = await session(OWNER);
  const who = await signup('Maya');
  const maya = await session(who);
  let acc = (await maya.call('GET', '/api/account')).json;
  expect(acc.user.emailVerified).toBe(false);
  expect(acc.usage).toMatchObject({ plan: 'free', used: 0, limit: 1, remaining: 1 });

  // Confirm the email with the link from the email.
  const verify = await lastMail(admin, who.email, 'verify');
  const vtoken = linkIn(verify.body, '/verify');
  expect((await maya.call('POST', '/api/auth/verify', { token: vtoken })).status).toBe(200);
  expect((await maya.call('POST', '/api/auth/verify', { token: vtoken })).json.error).toBe('TOKEN_USED');
  acc = (await maya.call('GET', '/api/account')).json;
  expect(acc.user.emailVerified).toBe(true);

  // Profile: saved, and checked.
  expect((await maya.call('PATCH', '/api/account/profile', { name: 'Maya Gurung', phone: '+977 9801234567', country: 'NP', timezone: 'Asia/Kathmandu', language: 'en', company: 'Sur Studio', bio: 'Sound' })).status).toBe(200);
  expect((await maya.call('PATCH', '/api/account/profile', { name: 'Maya', timezone: 'Mars/Olympus' })).status).toBe(400);
  expect((await maya.call('PATCH', '/api/account/profile', { name: 'Maya', phone: 'call me <b>' })).status).toBe(400);

  // Forgot password: the same answer for unknown emails; the link works once.
  const anon = await session();
  expect((await anon.call('POST', '/api/auth/forgot', { email: 'nobody.' + uniq() + '@example.com' })).status).toBe(200);
  expect((await anon.call('POST', '/api/auth/forgot', { email: who.email })).status).toBe(200);
  const rtoken = linkIn((await lastMail(admin, who.email, 'reset')).body, '/reset');
  expect((await anon.call('POST', '/api/auth/reset', { token: rtoken, password: 'short' })).status).toBe(400);
  expect((await anon.call('POST', '/api/auth/reset', { token: rtoken, password: 'a-newer-password-2' })).status).toBe(200);
  expect((await anon.call('POST', '/api/auth/reset', { token: rtoken, password: 'a-newer-password-3' })).json.error).toBe('TOKEN_USED');
  // Resetting signed Maya out everywhere.
  expect((await maya.call('GET', '/api/account')).status).toBe(401);
  const maya2 = await session({ email: who.email, password: 'a-newer-password-2' });
  const other = await session({ email: who.email, password: 'a-newer-password-2' });

  // Change password needs the current one; other devices are signed out.
  expect((await maya2.call('POST', '/api/account/password', { current: 'wrong-password-x', next: 'a-third-password-4' })).json.error).toBe('BAD_PASSWORD');
  expect((await maya2.call('POST', '/api/account/password', { current: 'a-newer-password-2', next: 'a-third-password-4' })).status).toBe(200);
  expect((await other.call('GET', '/api/account')).status).toBe(401);
  const sessions = (await maya2.call('GET', '/api/account/sessions')).json.sessions;
  expect(sessions.filter((s: any) => s.current)).toHaveLength(1);
  const events = (await maya2.call('GET', '/api/account/security')).json.events.map((e: any) => e.kind);
  expect(events).toEqual(expect.arrayContaining(['login', 'password_reset', 'password_changed']));

  // Export has the data and never the password hash.
  const exp = await maya2.ctx.get('/api/account/export');
  const text = await exp.text();
  expect(exp.headers()['content-disposition']).toContain('attachment');
  expect(text).toContain('Sur Studio');
  expect(text).not.toContain('password_hash');
  expect(text).not.toContain('$argon2');

  // Delete: needs DELETE and the password.
  expect((await maya2.call('POST', '/api/account/delete', { password: 'a-third-password-4', confirm: 'delete' })).status).toBe(400);
  expect((await maya2.call('POST', '/api/account/delete', { password: 'wrong-password-x', confirm: 'DELETE' })).status).toBe(400);
  expect((await maya2.call('POST', '/api/account/delete', { password: 'a-third-password-4', confirm: 'DELETE' })).status).toBe(200);
  expect((await (await session()).ctx.post('/api/auth/login', { data: { email: who.email, password: 'a-third-password-4' } })).status()).toBe(401);
});

test('plans: the server enforces creation limits; QR payment approved once, even when approved twice at once', async () => {
  const admin = await session(OWNER);
  const who = await signup('Bikash');
  const b = await session(who);
  const upload = (name: string) => b.ctx.post('/api/apps', { multipart: { name, file: { name: 'a.html', mimeType: 'text/html', buffer: Buffer.from('<!doctype html><title>x</title><p>hi') } }, headers: { 'x-csrf-token': b.csrf } });
  expect((await upload('First')).status()).toBe(200);
  const second = await upload('Second');
  expect(second.status()).toBe(403);
  expect((await second.json()).error).toBe('LIMIT_REACHED');
  const built = await b.call('POST', '/api/apps/build', { config: { name: 'Built', client: 'X', field: 'other', design: { accent: '#1f6f5c', style: 'modern', currency: 'NPR', theme: 'light' }, blocks: [{ id: 'todos_q1', preset: 'todos', title: 'To-dos' }] } });
  expect(built.json.error).toBe('LIMIT_REACHED');

  // A QR payment method (the file must really be an image).
  const m = await admin.call('POST', '/api/admin/payment-methods', { name: 'Fonepay QR ' + uniq(), provider: 'fonepay', instructions: 'Scan and pay.' });
  expect(m.status).toBe(200);
  const badQr = await admin.ctx.post(`/api/admin/payment-methods/${m.json.method.id}/qr`, { multipart: { qr: { name: 'qr.png', mimeType: 'image/png', buffer: FAKE_PNG } }, headers: { 'x-csrf-token': admin.csrf } });
  expect(badQr.status()).toBe(400);
  const qr = await admin.ctx.post(`/api/admin/payment-methods/${m.json.method.id}/qr`, { multipart: { qr: { name: 'qr.png', mimeType: 'image/png', buffer: PNG } }, headers: { 'x-csrf-token': admin.csrf } });
  expect(qr.status()).toBe(200);
  expect((await b.ctx.get(`/api/billing/methods/${m.json.method.id}/qr`)).headers()['content-type']).toContain('image/png');

  // Paying: fake screenshots are refused; a real one waits for review; a second one while pending is refused.
  const pay = (buf: Buffer, plan = 'plus') => b.ctx.post('/api/billing/payments', { multipart: { plan, amount: '500', methodId: m.json.method.id, reference: 'FP-1', paidOn: new Date().toISOString().slice(0, 10), proof: { name: 'paid.png', mimeType: 'image/png', buffer: buf } }, headers: { 'x-csrf-token': b.csrf } });
  expect((await pay(FAKE_PNG)).status()).toBe(400);
  const ok = await pay(PNG);
  expect(ok.status(), await ok.text()).toBe(200);
  const payment = (await ok.json()).payment;
  expect(payment.status).toBe('pending');
  expect((await pay(PNG)).status()).toBe(409);

  // The proof is private: not for other customers, not without signing in.
  const stranger = await session(await signup('Stranger'));
  expect((await stranger.ctx.get(`/api/billing/payments/${payment.id}/proof`)).status()).toBe(404);
  expect((await (await session()).ctx.get(`/api/billing/payments/${payment.id}/proof`)).status()).toBe(401);
  expect((await b.ctx.get(`/api/billing/payments/${payment.id}/proof`)).status()).toBe(200);
  // Customers cannot approve.
  expect((await b.call('POST', `/api/admin/payments/${payment.id}/approve`, {})).status).toBe(403);

  // Two approvals at the same moment: the plan is granted once.
  const [a1, a2] = await Promise.all([admin.call('POST', `/api/admin/payments/${payment.id}/approve`, {}), admin.call('POST', `/api/admin/payments/${payment.id}/approve`, {})]);
  expect([a1.json.already, a2.json.already].sort()).toEqual([false, true]);
  const again = await admin.call('POST', `/api/admin/payments/${payment.id}/approve`, {});
  expect(again.json.already).toBe(true);
  const detail = (await admin.call('GET', `/api/admin/users/${(await b.call('GET', '/api/account')).json.account.id}`)).json;
  expect(detail.subscriptions.filter((s: any) => s.plan === 'plus')).toHaveLength(1);
  const usage = (await b.call('GET', '/api/account')).json.usage;
  expect(usage).toMatchObject({ plan: 'plus', limit: 10, used: 1, remaining: 9 });
  expect((await upload('Second, now allowed')).status()).toBe(200);
  const notes = (await b.call('GET', '/api/notifications')).json.items.map((n: any) => n.title);
  expect(notes.join(' | ')).toContain('Payment approved');

  // A rejected payment keeps the plan and tells the customer why.
  const p2 = await (await pay(PNG, 'pro')).json();
  expect((await admin.call('POST', `/api/admin/payments/${p2.payment.id}/reject`, { reason: 'x' })).status).toBe(400);
  expect((await admin.call('POST', `/api/admin/payments/${p2.payment.id}/reject`, { reason: 'Screenshot could not be verified. Please upload a clearer one.' })).status).toBe(200);
  const bill = (await b.call('GET', '/api/billing')).json;
  expect(bill.usage.plan).toBe('plus');
  expect(bill.payments.find((p: any) => p.id === p2.payment.id)).toMatchObject({ status: 'rejected', rejectReason: 'Screenshot could not be verified. Please upload a clearer one.' });
  // Every step is in the audit log.
  const audit = (await admin.call('GET', `/api/admin/audit?q=${payment.id.slice(0, 0)}payment`)).json.entries.map((e: any) => e.action);
  expect(audit).toEqual(expect.arrayContaining(['payment.approve', 'payment.reject', 'payment_method.create', 'payment_method.qr_upload']));
});

test('sharing by link: public, password and private; visitors only reach that app; super admin addresses', async ({ browser }) => {
  const admin = await session(OWNER);
  const who = await signup('Sita');
  const sita = await session(who);
  const app = await sita.call('POST', '/api/apps/build', { config: { name: 'Link test ' + uniq(), client: 'X', field: 'other', design: { accent: '#1f6f5c', style: 'modern', currency: 'NPR', theme: 'light' }, blocks: [{ id: 'todos_l1', preset: 'todos', title: 'To-dos' }] } });
  const id = app.json.app.id;
  await sita.call('POST', `/api/apps/${id}/records/todos_l1`, { data: { title: 'Visible to visitors' } });
  let sh = (await sita.call('GET', `/api/apps/${id}/sharing`)).json;
  expect(sh.access).toBe('private');
  const token = sh.shareUrl.split('/s/')[1];
  const v = await session();
  expect((await v.call('GET', `/api/public/${token}`)).json.error).toBe('NOT_PUBLIC');
  expect((await v.call('GET', `/api/apps/${id}/records/todos_l1`)).status).toBe(401);

  // Public, view only.
  sh = (await sita.call('PATCH', `/api/apps/${id}/sharing`, { access: 'public', publicRole: 'viewer' })).json;
  expect((await v.call('GET', `/api/public/${token}`)).json.ready).toBe(true);
  const items = (await v.call('GET', `/api/apps/${id}/records/todos_l1`)).json.items;
  expect(items.map((r: any) => r.data.title)).toContain('Visible to visitors');
  expect((await v.call('POST', `/api/apps/${id}/records/todos_l1`, { data: { title: 'Sneaky' } })).status).toBe(403);
  // Nothing outside the app: not the account, not the list of apps, not another app, not the members.
  expect((await v.call('GET', '/api/account')).status).toBe(401);
  expect((await v.call('GET', '/api/apps')).status).toBe(401);
  expect((await v.call('GET', `/api/apps/${id}/invites`)).status).toBe(401);
  expect((await v.call('GET', `/api/apps/${id}`)).json.app.members).toEqual([]);
  // Visitors who may add can add.
  await sita.call('PATCH', `/api/apps/${id}/sharing`, { publicRole: 'contributor' });
  expect((await v.call('POST', `/api/apps/${id}/records/todos_l1`, { data: { title: 'From a visitor' } })).status).toBe(200);

  // Password links are on Plus and Pro: refused on Free Forever, then allowed after an upgrade.
  const free = await sita.call('PATCH', `/api/apps/${id}/sharing`, { access: 'password', password: 'open-sesame' });
  expect(free.status).toBe(403);
  expect(free.json.error).toBe('PLAN_FEATURE');
  const sitaId = (await sita.call('GET', '/api/account')).json.account.id;
  expect((await admin.call('PATCH', `/api/admin/users/${sitaId}`, { plan: 'plus' })).status).toBe(200);

  // Password: the old visitor is sent back to the password screen; wrong and right passwords.
  expect((await sita.call('PATCH', `/api/apps/${id}/sharing`, { access: 'password' })).status).toBe(400);
  await sita.call('PATCH', `/api/apps/${id}/sharing`, { access: 'password', password: 'open-sesame' });
  expect((await v.call('GET', `/api/apps/${id}/records/todos_l1`)).status).toBe(401);
  expect((await v.call('GET', `/api/public/${token}`)).json.needsPassword).toBe(true);
  expect((await v.call('POST', `/api/public/${token}/unlock`, { password: 'nope' })).status).toBe(401);
  expect((await v.call('POST', `/api/public/${token}/unlock`, { password: 'open-sesame' })).json.ready).toBe(true);
  expect((await v.call('GET', `/api/apps/${id}/records/todos_l1`)).status).toBe(200);

  // The owner gives the app its own address; the admin-only route stays admin-only; reserved words are refused.
  const slug = 'sita-' + uniq();
  expect((await sita.call('PUT', `/api/admin/apps/${id}/address`, { slug })).status).toBe(403);
  expect((await admin.call('PUT', `/api/admin/apps/${id}/address`, { slug: 'admin' })).status).toBe(400);
  expect((await sita.call('PUT', `/api/apps/${id}/address`, { slug: 'links' })).status).toBe(400);
  expect((await v.call('PUT', `/api/apps/${id}/address`, { slug })).status).toBe(401);
  const set = await sita.call('PUT', `/api/apps/${id}/address`, { slug, access: 'public' });
  expect(set.status, JSON.stringify(set.json)).toBe(200);
  expect(set.json.slugUrl).toContain('/' + slug);
  // Opened at exactly that address: no redirect.
  const page = await (await browser.newContext()).newPage();
  await page.goto('/' + slug);
  await expect(page.frameLocator('iframe').getByText('Visible to visitors')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.player-bar h1')).toContainText('Link test');
  await expect(page).toHaveURL(new RegExp(`/${slug}(#.*)?$`));

  // Private again: the link stops working.
  await sita.call('PATCH', `/api/apps/${id}/sharing`, { access: 'private' });
  expect((await v.call('GET', `/api/apps/${id}/records/todos_l1`)).status).toBe(401);
  expect((await v.call('GET', `/api/public/${slug}`)).json.error).toBe('NOT_PUBLIC');
});

test('super admin: create a paid sign-in, suspend and reactivate; uploads switch; only super admins get in', async () => {
  const admin = await session(OWNER);
  const made = await admin.call('POST', '/api/admin/users', { name: 'Paid Client', email: 'paid.' + uniq() + '@example.com', plan: 'pro' });
  expect(made.status).toBe(200);
  expect(made.json.password).toMatch(/\w{4}-/);
  const pc = await session({ email: made.json.user.email, password: made.json.password });
  expect((await pc.call('GET', '/api/account')).json.usage).toMatchObject({ plan: 'pro', limit: 50 });
  // Customers cannot reach the dashboard's API.
  for (const p of ['/api/admin/overview', '/api/admin/users', '/api/admin/payments', '/api/admin/settings', '/api/admin/audit']) expect((await pc.call('GET', p)).status).toBe(403);
  // Suspend: signed out at once, cannot sign in; reactivate.
  expect((await admin.call('PATCH', `/api/admin/users/${made.json.user.id}`, { suspended: true, reason: 'Unpaid' })).status).toBe(200);
  expect((await pc.call('GET', '/api/account')).status).toBe(401);
  const again = await (await session()).ctx.post('/api/auth/login', { data: { email: made.json.user.email, password: made.json.password } });
  expect(again.status()).toBe(403);
  expect((await again.json()).message).toContain('Unpaid');
  await admin.call('PATCH', `/api/admin/users/${made.json.user.id}`, { suspended: false });
  const pc2 = await session({ email: made.json.user.email, password: made.json.password });
  // The admin cannot suspend or demote themselves.
  const me = (await admin.call('GET', '/api/account')).json.account.id;
  expect((await admin.call('PATCH', `/api/admin/users/${me}`, { suspended: true })).status).toBe(400);
  expect((await admin.call('PATCH', `/api/admin/users/${me}`, { superAdmin: false })).status).toBe(400);

  // Uploads off: app files are refused (links still work); then back on for the other tests.
  const app = await pc2.ctx.post('/api/apps', { multipart: { name: 'U', file: { name: 'u.html', mimeType: 'text/html', buffer: Buffer.from('<!doctype html><title>u</title>') } }, headers: { 'x-csrf-token': pc2.csrf } });
  const appId = (await app.json()).app.id;
  await admin.call('PUT', '/api/admin/settings', { uploads: false });
  const up = await pc2.ctx.post(`/api/apps/${appId}/files`, { multipart: { file: { name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') } }, headers: { 'x-csrf-token': pc2.csrf } });
  expect(up.status()).toBe(403);
  expect((await up.json()).error).toBe('UPLOADS_OFF');
  await admin.call('PUT', '/api/admin/settings', { uploads: true });
  const up2 = await pc2.ctx.post(`/api/apps/${appId}/files`, { multipart: { file: { name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') } }, headers: { 'x-csrf-token': pc2.csrf } });
  expect(up2.status()).toBe(200);
  const actions = (await admin.call('GET', '/api/admin/audit')).json.entries.map((e: any) => e.action);
  expect(actions).toEqual(expect.arrayContaining(['user.create', 'user.suspend', 'user.reactivate', 'settings.uploads']));
});

test('studio booking: a reminder is sent once before the booking, to the owner', async () => {
  const who = await signup('Ravi');
  const r = await session(who);
  const app = await r.call('POST', '/api/apps/build', { config: { name: 'Studio ' + uniq(), client: 'Studio', field: 'studio', design: { accent: '#1f6f5c', style: 'modern', currency: 'NPR', theme: 'light' }, blocks: [{ id: 'studio_booking_b1', preset: 'studio_booking', title: 'Studio booking' }] } });
  expect(app.status, JSON.stringify(app.json)).toBe(200);
  const id = app.json.app.id;
  // Reminder settings live in the app's shared storage (set from the booking screen).
  await r.call('PUT', `/api/apps/${id}/kv`, { ns: 'ws', scope: 'shared', key: 'jhino.booking-reminders.studio_booking_b1', value: JSON.stringify({ enabled: true, minutes: 60, message: 'Session with {customer} at {time}.', tz: 'UTC' }), baseRev: 0 });
  const soon = new Date(Date.now() + 30 * 60_000);
  const hh = String(soon.getUTCHours()).padStart(2, '0'), mm = String(soon.getUTCMinutes()).padStart(2, '0');
  const endT = new Date(soon.getTime() + 3600e3);
  const rec = await r.call('POST', `/api/apps/${id}/records/studio_booking_b1`, { data: { customer: 'Himalayan Coffee', date: soon.toISOString().slice(0, 10), start: `${hh}:${mm}`, end: `${String(endT.getUTCHours()).padStart(2, '0')}:${mm}`, status: 'Booked', service: 'Recording' } });
  expect(rec.status, JSON.stringify(rec.json)).toBe(200);
  await expect.poll(async () => (await r.call('GET', '/api/notifications')).json.items.filter((n: any) => n.category === 'bookings').length, { timeout: 15_000 }).toBe(1);
  const n = (await r.call('GET', '/api/notifications')).json.items.find((x: any) => x.category === 'bookings');
  expect(n.body).toBe(`Session with Himalayan Coffee at ${hh}:${mm}.`);
  expect(n.link).toBe(`/apps/${id}#studio_booking_b1/${rec.json.record.id}`);
  // Sent once, however many times the timer runs.
  await new Promise((ok) => setTimeout(ok, 4000));
  expect((await r.call('GET', '/api/notifications')).json.items.filter((x: any) => x.category === 'bookings')).toHaveLength(1);
});

test('screens: website, sign up, account menu, booking day and hidden top bar', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Send the work. Get the yes.');
  await expect(page.locator('.price-card')).toHaveCount(3);
  await page.getByRole('link', { name: 'Start free' }).first().click();
  const email = `ui.${uniq()}@example.com`;
  await page.fill('input[autocomplete=name]', 'Ui Person');
  await page.fill('input[autocomplete=email]', email);
  await page.fill('input[autocomplete=new-password]', 'a-good-password-1');
  await page.check('.check-row input');
  await page.click('button:has-text("Create account")');
  await expect(page.getByRole('heading', { name: 'My apps' })).toBeVisible();
  await expect(page).toHaveURL(/\/apps$/);
  // Signed in, the main address is still the website; the dashboard is at /apps.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Send the work. Get the yes.');
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Open dashboard' }).first().click();
  await expect(page).toHaveURL(/\/apps$/);
  await expect(page.getByRole('heading', { name: 'My apps' })).toBeVisible();
  await page.goto('/no-such-page/deep');
  await expect(page).toHaveURL(/\/apps$/);
  await page.click('.avatar-btn');
  for (const item of ['Profile', 'My creations', 'Plan & usage', 'Billing', 'Notifications', 'Security', 'Settings', 'Help & support', 'Log out']) {
    await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
  }
  await page.getByRole('menuitem', { name: 'Plan & usage' }).click();
  await expect(page.locator('.usage')).toContainText('0 of 1 creations used');
  // Not a super admin: the dashboard is not there.
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Super Admin' })).toHaveCount(0);

  // Build a studio booking app from the screen and use the day view.
  await page.goto('/build');
  await page.fill('input[placeholder="For example: Himalayan Coffee"]', 'Sur Studio');
  await page.click('button.fp:has-text("Studio bookings")');
  await page.locator('.btn.primary:visible', { hasText: 'Create HTML' }).first().click();
  await page.waitForURL(/\/apps\//);
  const F = page.frameLocator('iframe');
  await expect(F.locator('.bk-day')).toBeVisible({ timeout: 20_000 });
  await F.locator('.bk-slot:not(:disabled)', { hasText: 'Book 10:00' }).click({ force: true });
  await F.locator('.drawer input').first().fill('Walk-in band');
  await F.locator('.drawer button:has-text("Add")').last().click();
  await expect(F.locator('.bk-ev', { hasText: 'Walk-in band' })).toBeVisible();
  // A second booking at the same time asks first.
  await F.locator('.head .btn', { hasText: 'New booking' }).click();
  await F.locator('.drawer input').first().fill('Clash');
  await F.locator('.drawer button:has-text("Add")').last().click();
  await expect(F.locator('.modal', { hasText: 'already booked' })).toBeVisible();
  await F.locator('.modal button', { hasText: 'Cancel' }).click();

  // Hide the top bar (on Plus and Pro): the app fills the window, a corner button keeps the menu.
  const admin = await session(OWNER);
  const me = (await admin.call('GET', `/api/admin/users?q=${encodeURIComponent(email)}`)).json.users[0];
  expect((await admin.call('PATCH', `/api/admin/users/${me.id}`, { plan: 'plus' })).status).toBe(200);
  await page.reload();
  await expect(F.locator('.bk-day')).toBeVisible({ timeout: 20_000 });
  await page.locator('.player-bar button[aria-label=More]').click();
  await page.getByRole('menuitem', { name: 'Hide top bar' }).click();
  await expect(page.locator('.player.bare')).toBeVisible();
  await expect(page.locator('.player-bar')).toHaveCount(0);
  await page.locator('.bar-handle').click();
  await page.getByRole('menuitem', { name: 'Show top bar' }).click();
  await expect(page.locator('.player-bar')).toBeVisible();
});

test('addresses: picked when creating, unique across apps and short links, opened at the exact address', async ({ browser }) => {
  const admin = await session(OWNER);
  const who = await signup('Anu');
  const anu = await session(who);
  const name = 'anu-' + uniq();
  // Free Forever: one app, and it can have its address from the start.
  expect((await anu.call('GET', `/api/addresses/check?name=${name}`)).json.available).toBe(true);
  expect((await anu.call('GET', '/api/addresses/check?name=admin')).json.available).toBe(false);
  const up = await anu.ctx.post('/api/apps', { multipart: { name: 'Anu site', slug: name, access: 'public', file: { name: 'a.html', mimeType: 'text/html', buffer: Buffer.from('<!doctype html><title>Anu</title><h1 id="t">Hello from Anu</h1>') } }, headers: { 'x-csrf-token': anu.csrf } });
  expect(up.status(), await up.text()).toBe(200);
  const appId = (await up.json()).app.id;
  expect((await anu.call('GET', `/api/addresses/check?name=${name}`)).json.available).toBe(false);
  expect((await anu.call('GET', `/api/addresses/check?name=${name}&app=${appId}`)).json.available).toBe(true);
  // Anyone opens it at that address, and the address stays in the bar.
  const page = await (await browser.newContext()).newPage();
  await page.goto('/' + name);
  await expect(page.frameLocator('iframe').locator('#t')).toHaveText('Hello from Anu', { timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`/${name}(#.*)?$`));

  // A second person cannot take the same name, for an app or a short link (any letter case).
  const raj = await session(await signup('Raj'));
  const b = await raj.call('POST', '/api/apps/build', { config: { name: 'Raj ' + uniq(), client: 'X', field: 'other', design: { accent: '#1f6f5c', style: 'modern', currency: 'NPR', theme: 'light' }, blocks: [{ id: 'todos_r1', preset: 'todos', title: 'To-dos' }] }, address: { slug: name.toUpperCase() } });
  expect(b.status).toBe(409);
  expect(b.json.error).toBe('SLUG_TAKEN');
  const rajId = (await raj.call('GET', '/api/account')).json.account.id;
  await admin.call('PATCH', `/api/admin/users/${rajId}`, { plan: 'plus' });
  expect((await raj.call('POST', '/api/links', { url: 'https://example.com', code: name })).json.error).toBe('SLUG_TAKEN');
  // Nothing was half made: Raj still has no apps.
  expect((await raj.call('GET', '/api/account')).json.usage.used).toBe(0);
  // Built with an address of its own: that works.
  const own = 'raj-' + uniq();
  const b2 = await raj.call('POST', '/api/apps/build', { config: { name: 'Raj ' + uniq(), client: 'X', field: 'other', design: { accent: '#1f6f5c', style: 'modern', currency: 'NPR', theme: 'light' }, blocks: [{ id: 'todos_r1', preset: 'todos', title: 'To-dos' }] }, address: { slug: own, access: 'password', password: 'studio-pass' } });
  expect(b2.status, JSON.stringify(b2.json)).toBe(200);
  const v = await session();
  expect((await v.call('GET', `/api/public/${own}`)).json.needsPassword).toBe(true);

  // Free Forever includes one address: a second one is refused.
  const anuApp2 = await anu.call('POST', '/api/apps/build', { config: { name: 'Anu 2', client: 'X', field: 'other', design: { accent: '#1f6f5c', style: 'modern', currency: 'NPR', theme: 'light' }, blocks: [{ id: 'todos_a2', preset: 'todos', title: 'To-dos' }] } });
  expect(anuApp2.json.error).toBe('LIMIT_REACHED'); // one app on Free Forever
  // The owner can move the address, and removing it frees the name.
  expect((await anu.call('PUT', `/api/apps/${appId}/address`, { slug: null })).status).toBe(200);
  expect((await raj.call('GET', `/api/addresses/check?name=${name}`)).json.available).toBe(true);
  // Someone else cannot change it.
  expect((await raj.call('PUT', `/api/apps/${appId}/address`, { slug: 'raj-steal-' + uniq() })).status).toBe(404);
});

test('short links: go on to the address, count clicks, one namespace, plan limits, admins can turn them off', async () => {
  const admin = await session(OWNER);
  const who = await signup('Kiran');
  const k = await session(who);
  const kid = (await k.call('GET', '/api/account')).json.account.id;
  // Free: random names only; only web addresses.
  expect((await k.call('POST', '/api/links', { url: 'javascript:alert(1)' })).status).toBe(400);
  expect((await k.call('POST', '/api/links', { url: 'https://user:pw@example.com' })).status).toBe(400);
  expect((await k.call('POST', '/api/links', { url: 'https://example.com', code: 'my-name-' + uniq() })).json.error).toBe('PLAN_FEATURE');
  const made = await k.call('POST', '/api/links', { url: 'example.com/some/long/page?x=1' });
  expect(made.status, JSON.stringify(made.json)).toBe(200);
  const code = made.json.link.code as string;
  expect(made.json.link.url).toBe('https://example.com/some/long/page?x=1');
  // Visiting it sends the browser on, and counts the click.
  const anon = await pwRequest.newContext({ baseURL: BASE });
  const r = await anon.get('/' + code, { maxRedirects: 0 });
  expect(r.status()).toBe(302);
  expect(r.headers()['location']).toBe('https://example.com/some/long/page?x=1');
  await anon.get('/' + code.toUpperCase(), { maxRedirects: 0 });
  const list = (await k.call('GET', '/api/links')).json;
  expect(list.links[0].clicks).toBe(2);
  expect(list.allowance).toMatchObject({ used: 1, limit: 5, customCodes: false, stats: false });
  // Daily clicks are on Pro.
  expect((await k.call('GET', `/api/links/${made.json.link.id}/stats`)).json.error).toBe('PLAN_FEATURE');
  // Someone else cannot change or delete it.
  const other = await session(await signup('Other'));
  expect((await other.call('PATCH', `/api/links/${made.json.link.id}`, { url: 'https://evil.example' })).status).toBe(404);
  expect((await other.call('DELETE', `/api/links/${made.json.link.id}`)).status).toBe(404);
  // Free Forever: five links.
  for (let i = 0; i < 4; i++) expect((await k.call('POST', '/api/links', { url: `https://example.com/${i}` })).status).toBe(200);
  expect((await k.call('POST', '/api/links', { url: 'https://example.com/6' })).json.error).toBe('LIMIT_REACHED');

  // Pro: named links, the daily chart; an app address cannot take a link's name.
  await admin.call('PATCH', `/api/admin/users/${kid}`, { plan: 'pro' });
  const named = 'reel-' + uniq();
  const n = await k.call('POST', '/api/links', { url: 'https://youtube.com/watch?v=abc', code: named });
  expect(n.status, JSON.stringify(n.json)).toBe(200);
  await anon.get('/' + named, { maxRedirects: 0 });
  const st = (await k.call('GET', `/api/links/${n.json.link.id}/stats`)).json;
  expect(st.days).toHaveLength(30);
  expect(st.days[29].n).toBe(1);
  expect((await k.call('GET', `/api/addresses/check?name=${named}`)).json.available).toBe(false);
  expect((await k.call('POST', '/api/links', { url: 'https://example.com', code: 'admin' })).status).toBe(400);

  // A super admin turns it off: no more redirect, and it is in the audit log.
  expect((await k.call('PATCH', `/api/admin/links/${n.json.link.id}`, { disabled: true })).status).toBe(403);
  expect((await admin.call('PATCH', `/api/admin/links/${n.json.link.id}`, { disabled: true, reason: 'Test' })).status).toBe(200);
  const off = await anon.get('/' + named, { maxRedirects: 0 });
  expect(off.status()).toBe(200);
  expect((await admin.call('GET', '/api/admin/audit?q=link.disable')).json.entries.length).toBeGreaterThan(0);
  expect((await admin.call('GET', `/api/admin/links?q=${named}`)).json.links[0]).toMatchObject({ code: named, disabled: true });
});

test('plans: monthly and yearly payments set the end date; paying again adds to it; features follow the plan', async () => {
  const admin = await session(OWNER);
  const methods = (await admin.call('GET', '/api/admin/payment-methods')).json.methods;
  let methodId = methods.find((m: any) => m.active)?.id;
  if (!methodId) methodId = (await admin.call('POST', '/api/admin/payment-methods', { name: 'Test QR ' + uniq(), provider: 'fonepay', active: true })).json.method.id;
  const who = await signup('Yam');
  const y = await session(who);
  const me = (await y.call('GET', '/api/me')).json.user;
  expect(me.features).toMatchObject({ passwordLinks: false, download: false, addresses: 1 });
  const pay = async (plan: string, period: string, amount: number) => {
    const r = await y.ctx.post('/api/billing/payments', { multipart: { plan, period, amount: String(amount), methodId, paidOn: new Date().toISOString().slice(0, 10), proof: { name: 'p.png', mimeType: 'image/png', buffer: PNG } }, headers: { 'x-csrf-token': y.csrf } });
    expect(r.status(), await r.text()).toBe(200);
    return (await r.json()).payment;
  };
  const p1 = await pay('plus', 'year', 5000);
  expect(p1).toMatchObject({ period: 'year', expectedAmount: 5000 });
  const d1 = (await admin.call('GET', `/api/admin/payments/${p1.id}`)).json;
  expect(d1.payment.expectedAmount).toBe(5000);
  const soon = Date.parse(d1.endsIfApproved);
  expect(Math.abs(soon - (Date.now() + 365 * 864e5))).toBeLessThan(2 * 864e5);
  await admin.call('POST', `/api/admin/payments/${p1.id}/approve`);
  let u = (await y.call('GET', '/api/billing')).json.usage;
  expect(u).toMatchObject({ plan: 'plus', period: 'year', limit: 10 });
  const end1 = Date.parse(u.expiresAt);
  expect(Math.abs(end1 - soon)).toBeLessThan(864e5);
  expect((await y.call('GET', '/api/me')).json.user.features).toMatchObject({ passwordLinks: true, download: true, addresses: 10 });
  // Renewing for a month adds a month to the end date.
  const p2 = await pay('plus', 'month', 500);
  await admin.call('POST', `/api/admin/payments/${p2.id}/approve`);
  u = (await y.call('GET', '/api/billing')).json.usage;
  const end2 = Date.parse(u.expiresAt);
  expect(end2 - end1).toBeGreaterThan(27 * 864e5);
  expect(end2 - end1).toBeLessThan(32 * 864e5);
  // An ended plan counts as Free Forever: features go back, apps stay.
  const yid = (await y.call('GET', '/api/account')).json.account.id;
  await admin.call('PATCH', `/api/admin/users/${yid}`, { planExpiresAt: '2020-01-01' });
  expect((await y.call('GET', '/api/me')).json.user).toMatchObject({ plan: 'free', features: { passwordLinks: false } });
  // The dashboard's numbers.
  const o = (await admin.call('GET', '/api/admin/overview')).json;
  expect(o.revenueByMonth).toHaveLength(12);
  expect(o.signupsByDay).toHaveLength(30);
  expect(o.revenueByMonth[11].n).toBeGreaterThanOrEqual(5500);
  expect(o.planMix).toHaveProperty('pro');
});

test('super admin screens: sidebar on the left edge, dashboard, short links; others cannot open it', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  await page.goto('/login');
  await page.fill('input[autocomplete=username]', OWNER.email);
  await page.fill('input[type=password]', OWNER.password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/apps$/);
  await page.goto('/admin');
  const side = page.locator('.adm-side');
  await expect(side).toBeVisible();
  expect((await side.boundingBox())!.x).toBe(0);
  await expect(page.getByRole('heading', { name: 'Revenue by month' })).toBeVisible();
  await expect(page.locator('.kpi2')).toHaveCount(4);
  await expect(page.locator('.bars .bar')).toHaveCount(12);
  await page.locator('.adm-nav a', { hasText: 'Short links' }).click();
  await expect(page).toHaveURL(/\/admin\/links$/);
  await expect(page.getByRole('heading', { name: 'Short links', level: 1 })).toBeVisible();
  // Phone: the sidebar opens as a drawer.
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(side).not.toBeInViewport();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(side).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
