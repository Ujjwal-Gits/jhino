import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config, makePassword } from './config.js';
import { db, now, sha256, type UserRow } from './db.js';
import { afterLogin, createSession, createUser, revokeSessions } from './auth.js';
import { baseUrl } from './mail.js';
import { limit, securityEvent, setting } from './security.js';
import { assignUsername } from './usernames.js';

/*
 * Continue with Google / Apple (OpenID Connect, authorization code flow).
 * - state + nonce are random and single use; the browser that started holds a matching cookie.
 * - The id_token signature is checked against the provider's published keys; issuer, audience,
 *   expiry and nonce are checked too.
 * - The same verified email links to the existing account instead of making a second one. If that
 *   account never confirmed its email, its password is cleared (someone else may have set it).
 */

type Provider = 'google' | 'apple';
interface Endpoints { auth: string; token: string; jwks: string; issuers: string[]; scope: string; formPost: boolean }

function endpoints(p: Provider): Endpoints {
  const test = process.env.JHINO_OAUTH_TEST_BASE; // only for automated tests with a stand-in provider
  if (test) return { auth: `${test}/auth`, token: `${test}/token`, jwks: `${test}/jwks`, issuers: [test], scope: 'openid email profile', formPost: p === 'apple' };
  return p === 'google'
    ? { auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', jwks: 'https://www.googleapis.com/oauth2/v3/certs', issuers: ['https://accounts.google.com', 'accounts.google.com'], scope: 'openid email profile', formPost: false }
    : { auth: 'https://appleid.apple.com/auth/authorize', token: 'https://appleid.apple.com/auth/token', jwks: 'https://appleid.apple.com/auth/keys', issuers: ['https://appleid.apple.com'], scope: 'name email', formPost: true };
}
export const providerReady = (p: Provider) => p === 'google'
  ? !!(config.oauth.google.clientId && config.oauth.google.clientSecret)
  : !!(config.oauth.apple.clientId && config.oauth.apple.teamId && config.oauth.apple.keyId && config.oauth.apple.privateKey);
const clientId = (p: Provider) => (p === 'google' ? config.oauth.google.clientId : config.oauth.apple.clientId);

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** Apple's client secret is a short-lived JWT signed with the team's key (ES256). */
function appleSecret() {
  const a = config.oauth.apple;
  const iat = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'ES256', kid: a.keyId }));
  const body = b64u(JSON.stringify({ iss: a.teamId, iat, exp: iat + 600, aud: 'https://appleid.apple.com', sub: a.clientId }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: a.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64u(sig)}`;
}

/* ---------------- id_token checks ---------------- */
const jwksCache = new Map<string, { at: number; keys: (JsonWebKey & { kid?: string })[] }>();
async function keysFor(url: string, force = false) {
  const c = jwksCache.get(url);
  if (c && !force && Date.now() - c.at < 3600_000) return c.keys;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('keys');
  const keys = ((await r.json()) as { keys: (JsonWebKey & { kid?: string })[] }).keys ?? [];
  jwksCache.set(url, { at: Date.now(), keys });
  return keys;
}
export async function verifyIdToken(token: string, e: Endpoints, aud: string, nonce: string) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('shape');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { alg: string; kid?: string };
  if (header.alg !== 'RS256') throw new Error('alg');
  const check = (jwk: JsonWebKey) => crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk as crypto.JsonWebKeyInput['key'], format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  let jwk = (await keysFor(e.jwks)).find((k) => k.kid === header.kid);
  // Keys rotate: an unknown key id, or a signature that fails with the cached key, fetches the keys once more.
  if (!jwk || !check(jwk)) jwk = (await keysFor(e.jwks, true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('kid');
  if (!check(jwk)) throw new Error('signature');
  const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { iss: string; aud: string | string[]; exp: number; nonce?: string; sub: string; email?: string; email_verified?: boolean | string; name?: string };
  const auds = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!e.issuers.includes(c.iss) || !auds.includes(aud) || c.exp * 1000 < Date.now() - 60_000 || c.nonce !== nonce || !c.sub) throw new Error('claims');
  return { sub: String(c.sub), email: c.email ? String(c.email).toLowerCase() : null, verified: c.email_verified === true || c.email_verified === 'true', name: c.name ? String(c.name).slice(0, 80) : null };
}

/* ---------------- the flow ---------------- */
const BIND = 'jhino_oauth';
const bindCookie = { path: '/api/auth/oauth', httpOnly: true, secure: config.cookieSecure, sameSite: (config.cookieSecure ? 'none' : 'lax') as 'none' | 'lax', maxAge: 600 };
setInterval(() => db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(new Date(Date.now() - 15 * 60_000).toISOString()), 600_000).unref();

function fail(reply: FastifyReply, code: string) { return reply.redirect(`/login?error=${encodeURIComponent(code)}`); }

async function finish(req: FastifyRequest, reply: FastifyReply, p: Provider, params: Record<string, string>) {
  const state = String(params.state ?? '');
  const row = state ? db.prepare('SELECT * FROM oauth_states WHERE state_hash=? AND provider=?').get(sha256(state), p) as { state_hash: string; nonce: string; verifier: string; bind_hash: string; link_user: string | null; created_at: string } | undefined : undefined;
  if (row) db.prepare('DELETE FROM oauth_states WHERE state_hash=?').run(row.state_hash); // single use
  reply.clearCookie(BIND, { path: bindCookie.path });
  const bind = req.cookies?.[BIND];
  if (!row || !bind || sha256(bind) !== row.bind_hash || Date.parse(row.created_at) < Date.now() - 10 * 60_000) return fail(reply, 'oauth_state');
  if (params.error) return fail(reply, 'oauth_cancelled');
  const e = endpoints(p);
  let claims: Awaited<ReturnType<typeof verifyIdToken>>;
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code: String(params.code ?? ''), redirect_uri: `${baseUrl(req)}/api/auth/oauth/${p}/callback`,
      client_id: clientId(p), client_secret: p === 'google' ? config.oauth.google.clientSecret : appleSecret(),
      ...(p === 'google' ? { code_verifier: row.verifier } : {}),
    });
    const r = await fetch(e.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10000) });
    const tok = await r.json() as { id_token?: string };
    if (!r.ok || !tok.id_token) throw new Error('token');
    claims = await verifyIdToken(tok.id_token, e, clientId(p), row.nonce);
  } catch (err) {
    req.log.warn({ err: (err as Error).message, provider: p }, 'oauth sign-in failed');
    if (process.env.JHINO_OAUTH_TEST_BASE) reply.header('x-oauth-why', (err as Error).message.slice(0, 80)); // tests only
    return fail(reply, 'oauth_failed');
  }
  // Apple sends the name only the first time, in the form post.
  let name = claims.name;
  if (!name && params.user) { try { const u = JSON.parse(params.user) as { name?: { firstName?: string; lastName?: string } }; name = [u.name?.firstName, u.name?.lastName].filter(Boolean).join(' ').slice(0, 80) || null; } catch { /* no name */ } }

  const linked = db.prepare('SELECT user_id FROM identities WHERE provider=? AND subject=?').get(p, claims.sub) as { user_id: string } | undefined;
  let user: UserRow | undefined;
  if (row.link_user) {
    // Adding Google/Apple to the signed-in account (from Security).
    if (linked && linked.user_id !== row.link_user) return reply.redirect('/account/security?error=oauth_taken');
    if (!linked) db.prepare('INSERT INTO identities(provider,subject,user_id,email,created_at) VALUES(?,?,?,?,?)').run(p, claims.sub, row.link_user, claims.email, now());
    securityEvent(row.link_user, 'sign_in_method_added', req, p);
    return landHome(reply, `/account/security?linked=${p}`);
  }
  if (linked) user = db.prepare('SELECT * FROM users WHERE id=?').get(linked.user_id) as UserRow | undefined;
  if (!user && claims.email) {
    if (!claims.verified) return fail(reply, 'oauth_unverified');
    const same = db.prepare("SELECT * FROM users WHERE email=? AND kind='person'").get(claims.email) as UserRow | undefined;
    if (same) {
      if (!same.email_verified_at) {
        // We never confirmed who set this account's password: the provider just proved the email, so start clean.
        db.prepare('UPDATE users SET password_hash=?, password_set=0, email_verified_at=? WHERE id=?').run(sha256(makePassword(24)), now(), same.id);
        revokeSessions(same.id);
      }
      db.prepare('INSERT INTO identities(provider,subject,user_id,email,created_at) VALUES(?,?,?,?,?)').run(p, claims.sub, same.id, claims.email, now());
      securityEvent(same.id, 'sign_in_method_added', req, p);
      user = db.prepare('SELECT * FROM users WHERE id=?').get(same.id) as UserRow;
    } else {
      if (setting('signups') !== 'on') return fail(reply, 'signups_closed');
      const created = await createUser(claims.email, name || claims.email.split('@')[0], makePassword(24), false, { verified: true, plan: 'free' });
      db.prepare('UPDATE users SET password_set=0 WHERE id=?').run(created.id);
      assignUsername(created.id, null, claims.email);
      db.prepare('INSERT INTO identities(provider,subject,user_id,email,created_at) VALUES(?,?,?,?,?)').run(p, claims.sub, created.id, claims.email, now());
      user = db.prepare('SELECT * FROM users WHERE id=?').get(created.id) as UserRow;
    }
  }
  if (!user) return fail(reply, 'oauth_no_email');
  if (user.disabled) return fail(reply, 'suspended');
  createSession(reply, user.id, req);
  afterLogin(req, user, p);
  // Home is their page (jhino.com/<username>); client accounts without one go to their apps.
  const uname = (db.prepare('SELECT username FROM users WHERE id=?').get(user.id) as { username: string | null }).username;
  return landHome(reply, uname ? `/${uname}` : '/apps');
}

/**
 * After a sign-in that came from Google/Apple, go on from a page of our own: some browsers do not send a
 * SameSite=Strict cookie on a page reached straight from another site's redirect, so this step makes the
 * move to the dashboard a same-site one.
 */
function landHome(reply: FastifyReply, to: string) {
  reply.header('Cache-Control', 'no-store').header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'").type('text/html; charset=utf-8');
  return reply.send(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${to}"><title>Signing in…</title><p style="font:15px system-ui;padding:24px">Signing you in… <a href="${to}">Continue</a></p>`);
}

export function registerOAuth(app: FastifyInstance) {
  // Apple posts the result as a form.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => {
    try { done(null, Object.fromEntries(new URLSearchParams(String(body)))); } catch (e) { done(e as Error, undefined); }
  });

  app.get('/api/auth/oauth/:provider/start', async (req, reply) => {
    const p = (req.params as { provider: string }).provider as Provider;
    if ((p !== 'google' && p !== 'apple') || !providerReady(p)) return fail(reply, 'oauth_off');
    limit(req, 'oauth-start', 30, 15 * 60_000);
    const link = (req.query as { link?: string }).link === '1' && req.user && !req.pub ? req.user.id : null;
    const state = crypto.randomBytes(24).toString('base64url');
    const nonce = crypto.randomBytes(24).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const bind = crypto.randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO oauth_states(state_hash,provider,nonce,verifier,bind_hash,link_user,created_at) VALUES(?,?,?,?,?,?,?)').run(sha256(state), p, nonce, verifier, sha256(bind), link, now());
    reply.setCookie(BIND, bind, bindCookie);
    const e = endpoints(p);
    const q = new URLSearchParams({
      client_id: clientId(p), redirect_uri: `${baseUrl(req)}/api/auth/oauth/${p}/callback`, response_type: 'code', scope: e.scope, state, nonce,
      ...(e.formPost ? { response_mode: 'form_post' } : { code_challenge: b64u(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', prompt: 'select_account' }),
    });
    return reply.redirect(`${e.auth}?${q}`);
  });

  app.get('/api/auth/oauth/:provider/callback', async (req, reply) => {
    const p = (req.params as { provider: string }).provider as Provider;
    if (p !== 'google' && p !== 'apple') return fail(reply, 'oauth_off');
    return finish(req, reply, p, req.query as Record<string, string>);
  });
  app.post('/api/auth/oauth/:provider/callback', async (req, reply) => {
    const p = (req.params as { provider: string }).provider as Provider;
    if (p !== 'google' && p !== 'apple') return fail(reply, 'oauth_off');
    return finish(req, reply, p, (req.body ?? {}) as Record<string, string>);
  });

  /** Remove Google/Apple from an account that still has a password. */
  app.post('/api/account/identities/:provider/remove', async (req) => {
    const u = req.user;
    if (!u || req.pub) return { ok: false };
    const p = (req.params as { provider: string }).provider;
    if (u.password_set === 0 && (db.prepare('SELECT COUNT(*) n FROM identities WHERE user_id=?').get(u.id) as { n: number }).n <= 1) {
      return { ok: false, message: 'Set a password first, so you can still sign in.' };
    }
    db.prepare('DELETE FROM identities WHERE user_id=? AND provider=?').run(u.id, p);
    securityEvent(u.id, 'sign_in_method_removed', req, p);
    return { ok: true };
  });
}
