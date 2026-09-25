import { test, expect, request as pwRequest } from '@playwright/test';
import http from 'node:http';
import crypto from 'node:crypto';

/*
 * "Continue with Google" against a stand-in OpenID provider on port 4398 (the test server is started with
 * GOOGLE_CLIENT_ID/SECRET and JHINO_OAUTH_TEST_BASE pointing here). Checks the whole flow: state, nonce,
 * signature, a new account, and safe linking to an existing account with the same email.
 */
const BASE = 'http://127.0.0.1:4399';
const OP = 'http://127.0.0.1:4398';
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'k-' + crypto.randomBytes(4).toString('hex');
const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: KID, alg: 'RS256', use: 'sig' };
const codes = new Map<string, { nonce: string; email: string; sub: string; verified: boolean; bad: boolean }>();
let next = { email: '', sub: '', verified: true, badSignature: false };
const b64u = (x: object | Buffer) => Buffer.from(x instanceof Buffer ? x : JSON.stringify(x)).toString('base64url');
function idToken(claims: object, bad: boolean) {
  const head = b64u({ alg: 'RS256', kid: KID, typ: 'JWT' }), body = b64u(claims);
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), bad ? crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey : privateKey);
  return `${head}.${body}.${b64u(sig)}`;
}
let server: http.Server;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, OP);
    if (url.pathname === '/auth') {
      const code = crypto.randomBytes(8).toString('hex');
      codes.set(code, { nonce: url.searchParams.get('nonce')!, email: next.email, sub: next.sub, verified: next.verified, bad: next.badSignature });
      res.writeHead(302, { location: `${url.searchParams.get('redirect_uri')}?code=${code}&state=${url.searchParams.get('state')}` }).end();
    } else if (url.pathname === '/token') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const f = new URLSearchParams(raw);
        const c = codes.get(f.get('code') ?? '');
        if (!c || f.get('client_secret') !== 'test-secret' || !f.get('code_verifier')) { res.writeHead(400).end('{}'); return; }
        const now = Math.floor(Date.now() / 1000);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id_token: idToken({ iss: OP, aud: 'test-client', sub: c.sub, email: c.email, email_verified: c.verified, nonce: c.nonce, iat: now, exp: now + 600, name: 'Google Person' }, c.bad) }));
      });
    } else if (url.pathname === '/jwks') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
    } else res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server.listen(4398, '127.0.0.1', ok));
});
test.afterAll(async () => { await new Promise((ok) => server.close(ok)); });

test('continue with Google: new account, forged token refused, same verified email links safely', async ({ browser }) => {
  const opts = await (await (await pwRequest.newContext({ baseURL: BASE })).get('/api/auth/options')).json();
  expect(opts.google).toBe(true);
  const email = `g.${Date.now().toString(36)}@example.com`;

  // A forged token (wrong key) is refused.
  next = { email, sub: 'sub-' + email, verified: true, badSignature: true };
  const p0 = await (await browser.newContext()).newPage();
  await p0.goto('/api/auth/oauth/google/start');
  await expect(p0).toHaveURL(/\/login\?error=oauth_failed/);
  await expect(p0.getByRole('alert')).toContainText('could not confirm');

  // A new account from Google.
  next = { email, sub: 'sub-' + email, verified: true, badSignature: false };
  const p1 = await (await browser.newContext()).newPage();
  await p1.goto('/login');
  await p1.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(p1.getByRole('heading', { name: 'Your pages' })).toBeVisible({ timeout: 15_000 });
  const me = await (await p1.request.get('/api/me')).json();
  expect(me.user.email).toBe(email);
  expect(me.user.passwordSet).toBe(false);
  expect(me.user.emailVerified).toBe(true);
  // Using the same flow again signs into the same account.
  const p2 = await (await browser.newContext()).newPage();
  await p2.goto('/api/auth/oauth/google/start');
  await expect(p2.getByRole('heading', { name: 'Your pages' })).toBeVisible();
  expect((await (await p2.request.get('/api/me')).json()).user.id).toBe(me.user.id);

  // Someone registered an email they do not own (never confirmed). When the owner signs in with Google,
  // they get the account, and the stranger's password stops working.
  const victim = `v.${Date.now().toString(36)}@example.com`;
  const squatter = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-jhino': '1' } });
  expect((await squatter.post('/api/auth/signup', { data: { name: 'Squatter', email: victim, password: 'squatter-pass-123', terms: true } })).status()).toBe(200);
  next = { email: victim, sub: 'sub-' + victim, verified: true, badSignature: false };
  const p3 = await (await browser.newContext()).newPage();
  await p3.goto('/api/auth/oauth/google/start');
  await expect(p3.getByRole('heading', { name: 'Your pages' })).toBeVisible();
  expect((await squatter.get('/api/account')).status()).toBe(401);
  const again = await (await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-jhino': '1' } })).post('/api/auth/login', { data: { email: victim, password: 'squatter-pass-123' } });
  expect(again.status()).toBe(401);

  // An unverified Google email is not trusted for linking.
  next = { email: `u.${Date.now().toString(36)}@example.com`, sub: 'sub-unverified', verified: false, badSignature: false };
  const p4 = await (await browser.newContext()).newPage();
  await p4.goto('/api/auth/oauth/google/start');
  await expect(p4).toHaveURL(/error=oauth_unverified/);

  // A replayed callback (the state was used) is refused.
  next = { email, sub: 'sub-' + email, verified: true, badSignature: false };
  const p5 = await (await browser.newContext()).newPage();
  let callback = '';
  p5.on('request', (r) => { if (r.url().includes('/oauth/google/callback')) callback = r.url(); });
  await p5.goto('/api/auth/oauth/google/start');
  await expect(p5.getByRole('heading', { name: 'Your pages' })).toBeVisible();
  const replay = await p5.request.get(callback, { maxRedirects: 0 });
  expect(replay.status()).toBe(302);
  expect(replay.headers().location).toContain('error=oauth_state');
});
