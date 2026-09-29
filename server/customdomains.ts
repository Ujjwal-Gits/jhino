import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { Resolver } from 'node:dns/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verify } from '@node-rs/argon2';
import { config, makePassword } from './config.js';
import { db, newId, now, sha256, roleOf, logActivity, type AppRow, type Role, type UserRow } from './db.js';
import { HttpError, COOKIE, createUser, requireAdmin, requireUser } from './auth.js';
import { audit, limit, uploadsOn } from './security.js';
import { featuresOf, notify } from './plans.js';
import { collaborative, ensureVisitor } from './publicshare.js';
import { appDir } from './packages.js';
import { inject, openTag, TYPES, versionRow } from './apps.js';
import { snapshotFor } from './data.js';
import { canReadFile, loadFile, sendFile } from './files.js';
import { withCurrentBuilder } from './builder.js';
import { CNAME_TARGET as CF_TARGET, ORIGIN as CF_ORIGIN, cfCreds, onCloudflareChange } from './cloudflare.js';
import { trackRun } from './analytics.js';
import { installInfo } from './pwa.js';

/*
 * Custom domains: Jhino as a hosting provider. A person's own domain (shop.com, app.shop.com) opens one of
 * their apps, served at the top of that domain (no frame, no redirect), with the runtime shim talking to
 * this server directly, so saved data, files and live updates work exactly as on jhino.com.
 *
 * Two ways to get a certificate, picked by the environment (docs/CUSTOM_DOMAINS.md):
 * - Cloudflare for SaaS (CF_API_TOKEN + CF_ZONE_ID): each hostname becomes a Cloudflare custom hostname; the
 *   customer adds a CNAME to CUSTOM_DOMAIN_CNAME_TARGET and Cloudflare validates it and issues the certificate.
 * - Self-managed: the customer proves ownership with a TXT record at _jhino.<domain> and points the domain at
 *   this server; Caddy (on_demand_tls) or Traefik asks GET /api/domains/tls-ask before issuing a certificate.
 *
 * Every page served on a custom domain ends with one small "Built with Jhino" line (a backlink). Only a super
 * admin can turn it off, and only on their own domains.
 */

/* ---------------- settings ---------------- */
const env = process.env;
const cleanHost = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#:]/)[0].replace(/\.$/, '');
// Cloudflare comes from the environment or from Super Admin → Custom domains → Connect Cloudflare (server/cloudflare.ts).
const CF = {
  get token() { return cfCreds().token; },
  get zone() { return cfCreds().zone; },
  get fallback() { return cleanHost(env.CF_FALLBACK_ORIGIN) || (cfCreds().token ? CF_ORIGIN : ''); },
  sslMethod: (env.CF_SSL_METHOD === 'txt' ? 'txt' : 'http') as 'txt' | 'http',
};
export const cfMode = () => !!(CF.token && CF.zone);
const publicHost = (() => { try { return config.publicUrl ? new URL(config.publicUrl).hostname.toLowerCase() : ''; } catch { return ''; } })();
const platformBase = publicHost.replace(/^www\./, '');
/** What customers point their CNAME at. */
const target = () => [cleanHost(env.CUSTOM_DOMAIN_CNAME_TARGET), cfCreds().token ? CF_TARGET : '', CF.fallback, publicHost].find((h) => h && !isIP(h) && h.includes('.')) ?? '';
let TARGET = target();
onCloudflareChange(() => { TARGET = target(); forgetHosts(); });
/** An IPv4 address for domains that cannot use a CNAME at the root (self-managed, or Cloudflare apex proxying). */
const A_RECORD = isIP(String(env.CUSTOM_DOMAIN_A_RECORD ?? '').trim()) === 4 ? String(env.CUSTOM_DOMAIN_A_RECORD).trim() : '';
/** Other names this server answers as Jhino itself (a Coolify sslip.io name, a staging host), comma-separated. */
const EXTRA_HOSTS = new Set(String(env.PLATFORM_HOSTS ?? '').split(',').map(cleanHost).filter(Boolean));
const BRAND = (config.publicUrl || 'https://jhino.com').replace(/\/+$/, '');
const secureSite = (req: FastifyRequest) => config.cookieSecure || req.protocol === 'https';

/* ---------------- the table ---------------- */
export type DomainStatus = 'pending' | 'verifying' | 'active' | 'error';
export interface DomainRow {
  id: string; owner_id: string; app_id: string; hostname: string; alt_hostname: string | null; www_mode: 'off' | 'apex' | 'www';
  status: DomainStatus; verify_token: string; cf_hostname_id: string | null; cf_alt_id: string | null; ssl_status: string | null;
  records: string | null; backlink: number; granted: number; disabled_at: string | null; error: string | null; fails: number; checks: number;
  last_checked_at: string | null; next_check_at: string | null; activated_at: string | null; created_at: string; updated_at: string;
}
interface Found { cf?: { ownership?: { name: string; value: string } | null; validation?: { name: string; value: string }[]; status?: string; ssl?: string; errors?: string[] }; dns?: Record<string, { pointing: boolean | null; seen?: string }>; txt?: boolean | null; tls?: boolean | null }
const loadDomain = (id: string) => db.prepare('SELECT * FROM custom_domains WHERE id=?').get(id) as DomainRow | undefined;
const foundOf = (d: DomainRow): Found => { try { return d.records ? JSON.parse(d.records) as Found : {}; } catch { return {}; } };
const bad = (msg: string) => new HttpError(400, 'VALIDATION_FAILED', msg);

/* ---------------- hostnames ---------------- */
const RESERVED_TLDS = new Set(['localhost', 'local', 'test', 'example', 'invalid', 'internal', 'onion', 'arpa', 'lan', 'home', 'corp', 'intranet', 'localdomain']);
const SECOND_LEVEL = new Set(['com', 'co', 'org', 'net', 'edu', 'gov', 'ac', 'or', 'ne', 'go', 'mil', 'gen', 'info', 'biz', 'ltd', 'plc', 'nic', 'sch', 'nom', 'web']);
/** The registrable part of a hostname, near enough for DNS panels: shop.com, shop.com.np, shop.co.uk. */
export function registrable(host: string) {
  const l = host.split('.');
  if (l.length >= 3 && SECOND_LEVEL.has(l[l.length - 2]) && l[l.length - 1].length === 2) return l.slice(-3).join('.');
  return l.slice(-2).join('.');
}
/** Names that are Jhino's own: never claimable, always served as Jhino. */
function isJhinoName(h: string) {
  const own = ['jhino.com', platformBase, CF.fallback, TARGET].filter(Boolean);
  return own.some((b) => h === b || h.endsWith('.' + b)) || EXTRA_HOSTS.has(h);
}
/** Clean and check a domain someone typed (a pasted URL is fine). Throws a readable 400. */
export function normalizeHostname(input: unknown): string {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s) throw bad('Enter a domain, like yourstudio.com or app.yourstudio.com.');
  if (s.length > 300) throw bad('That domain is too long.');
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].replace(/:\d*$/, '').replace(/\.$/, '');
  if (/[@*\s]/.test(s)) throw bad('Use one plain domain, without spaces, @ or *.');
  if (isIP(s) || isIP(s.replace(/^\[|\]$/g, '')) || /^[\d.]+$/.test(s)) throw bad('Use a domain name, not an IP address.');
  const ascii = domainToASCII(s);
  if (!ascii) throw bad('That is not a valid domain name.');
  if (ascii.length > 253) throw bad('That domain is too long.');
  const labels = ascii.split('.');
  if (labels.length < 2) throw bad('Use a full domain with a dot, like yourstudio.com.');
  if (!labels.every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) throw bad('Domains use letters, numbers and dashes between dots (not at the start or end of a part).');
  const tld = labels[labels.length - 1];
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) throw bad('That domain does not end in a real extension, like .com or .np.');
  if (RESERVED_TLDS.has(tld)) throw bad(`.${tld} addresses do not work on the internet. Use a domain you registered.`);
  if (isJhinoName(ascii)) throw bad('That address belongs to Jhino. Use a domain you own.');
  return ascii;
}
/** A www option makes sense for a main domain (shop.com) or its www name. */
export const wwwEligible = (host: string) => host.startsWith('www.') || registrable(host) === host;
function pairFor(host: string, mode: 'off' | 'apex' | 'www') {
  const base = host.replace(/^www\./, '');
  if (mode === 'apex') return { primary: base, alt: 'www.' + base };
  if (mode === 'www') return { primary: 'www.' + base, alt: base };
  return { primary: host, alt: null as string | null };
}
function readWww(v: unknown, host: string): 'off' | 'apex' | 'www' {
  const m = v === 'apex' || v === 'www' ? v : 'off';
  if (m !== 'off' && !wwwEligible(host)) throw bad('The www option is for a main domain, like yourstudio.com. Subdomains open at exactly their own name.');
  if (m !== 'off' && host.replace(/^www\./, '').split('.').length < 2) throw bad('That domain is too short for a www option.');
  return m;
}
/** A record's name as most DNS panels want it: @ for the domain itself, otherwise the part before it. */
const shortName = (name: string) => { const base = registrable(name); return name === base ? '@' : name.slice(0, -(base.length + 1)); };

/** Is either name already connected (to any app)? */
function nameTaken(names: (string | null)[], exceptId = '') {
  const list = names.filter(Boolean) as string[];
  if (!list.length) return false;
  const q = list.map(() => '?').join(',');
  return !!db.prepare(`SELECT 1 FROM custom_domains WHERE id<>? AND (hostname IN (${q}) OR alt_hostname IN (${q}))`).get(exceptId, ...list, ...list);
}

/* ---------------- which host is asking ---------------- */
function reqHost(req: FastifyRequest) {
  return String(req.hostname || req.headers.host || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '').replace(/\.$/, '');
}
/** Jhino's own names, IPs, local names: served as Jhino. */
function isPlatformHost(h: string) {
  if (!h || isIP(h) || !h.includes('.') || h.endsWith('.localhost')) return true;
  return isJhinoName(h);
}
interface Hosted { d: DomainRow; a: AppRow | null; owner: UserRow | null; paused: boolean }
const hostCache = new Map<string, { at: number; v: Hosted | null }>();
export const forgetHosts = () => hostCache.clear();
/** Domains past the owner's plan (a plan that ended) pause; super admins and domains a super admin gave are never counted. */
function pausedByPlan(d: DomainRow, owner: UserRow | null) {
  if (!owner) return true;
  if (owner.is_admin || d.granted) return false;
  const allowed = featuresOf(owner).customDomains;
  const before = (db.prepare('SELECT COUNT(*) n FROM custom_domains WHERE owner_id=? AND granted=0 AND (created_at < ? OR (created_at = ? AND id < ?))').get(owner.id, d.created_at, d.created_at, d.id) as { n: number }).n;
  return before >= allowed;
}
function hostedAt(host: string): Hosted | null {
  const c = hostCache.get(host);
  if (c && Date.now() - c.at < 15_000) return c.v;
  const d = db.prepare('SELECT * FROM custom_domains WHERE hostname=? OR alt_hostname=?').get(host, host) as DomainRow | undefined;
  let v: Hosted | null = null;
  if (d) {
    const a = db.prepare('SELECT * FROM apps WHERE id=?').get(d.app_id) as AppRow | undefined;
    const owner = db.prepare('SELECT * FROM users WHERE id=?').get(d.owner_id) as UserRow | undefined;
    v = { d, a: a ?? null, owner: owner ?? null, paused: pausedByPlan(d, owner ?? null) || !!owner?.disabled };
  }
  if (hostCache.size > 5000) hostCache.clear();
  hostCache.set(host, { at: Date.now(), v });
  return v;
}

/* ---------------- Cloudflare for SaaS ---------------- */
class CfError extends Error { constructor(public status: number, message: string, public code?: number) { super(message); } }
interface CfHostname {
  id: string; hostname: string; status: string; verification_errors?: string[];
  ownership_verification?: { type?: string; name?: string; value?: string };
  ssl?: { status?: string; method?: string; validation_records?: { txt_name?: string; txt_value?: string; http_url?: string; http_body?: string; status?: string }[]; validation_errors?: { message?: string }[] };
}
async function cf<T>(method: string, sub = '', body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(CF.zone)}/custom_hostnames${sub}`, {
      method, headers: { Authorization: `Bearer ${CF.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
  } catch (e) { throw new CfError(0, `Could not reach Cloudflare (${(e as Error).message}).`); }
  const j = await r.json().catch(() => null) as { success?: boolean; result?: T; errors?: { code?: number; message?: string }[] } | null;
  if (!r.ok || !j?.success) {
    const e = j?.errors?.[0];
    throw new CfError(r.status, String(e?.message || `Cloudflare answered ${r.status}.`).slice(0, 300), e?.code);
  }
  return j.result as T;
}
const cfSsl = () => ({ method: CF.sslMethod, type: 'dv', settings: { min_tls_version: '1.2', http2: 'on' } });
async function cfCreate(hostname: string): Promise<CfHostname> {
  try { return await cf<CfHostname>('POST', '', { hostname, ssl: cfSsl() }); }
  catch (e) {
    // Already there (a retry after a timeout): take it over.
    if (e instanceof CfError && (e.code === 1406 || /duplicate|already exists/i.test(e.message))) {
      const list = await cf<CfHostname[]>('GET', `?hostname=${encodeURIComponent(hostname)}`);
      if (list[0]) return list[0];
    }
    throw e;
  }
}
async function cfDelete(id: string | null) {
  if (!id) return;
  try { await cf('DELETE', `/${encodeURIComponent(id)}`); } catch (e) { if (!(e instanceof CfError && e.status === 404)) throw e; }
}
/** Make the Cloudflare side match the names: create what is missing, delete what is no longer used. */
async function cfSync(d: DomainRow, next: { primary: string; alt: string | null }) {
  const had = new Map<string, string>();
  if (d.cf_hostname_id) had.set(d.hostname, d.cf_hostname_id);
  if (d.cf_alt_id && d.alt_hostname) had.set(d.alt_hostname, d.cf_alt_id);
  const want = [next.primary, next.alt].filter(Boolean) as string[];
  const ids: Record<string, string> = {};
  for (const n of want) ids[n] = had.get(n) ?? (await cfCreate(n)).id;
  for (const [n, id] of had) if (!want.includes(n)) await cfDelete(id);
  return { primaryId: ids[next.primary], altId: next.alt ? ids[next.alt] : null };
}

/* ---------------- DNS ---------------- */
const resolver = new Resolver({ timeout: 4000, tries: 2 });
{
  const servers = String(env.CUSTOM_DOMAIN_DNS_SERVERS ?? '1.1.1.1,8.8.8.8').trim();
  if (servers && servers !== 'system') { try { resolver.setServers(servers.split(',').map((s) => s.trim()).filter(Boolean)); } catch { /* keep the system's */ } }
}
type Look<T> = { v: T } | { none: true } | { unknown: true };
async function look<T>(fn: () => Promise<T>): Promise<Look<T>> {
  try { return { v: await fn() }; } catch (e) {
    const code = (e as { code?: string }).code;
    return code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ENONAME' || code === 'NXDOMAIN' ? { none: true } : { unknown: true };
  }
}
let targetIps: { at: number; ips: string[] } = { at: 0, ips: [] };
async function ourIps() {
  if (Date.now() - targetIps.at < 10 * 60_000) return targetIps.ips;
  const ips = new Set<string>(A_RECORD ? [A_RECORD] : []);
  if (TARGET) { const r = await look(() => resolver.resolve4(TARGET)); if ('v' in r) r.v.forEach((x) => ips.add(x)); }
  targetIps = { at: Date.now(), ips: [...ips] };
  return targetIps.ips;
}
/** Does this name lead to us: a CNAME to the target, or the same addresses (a flattened root, an A record)? null = could not tell. */
async function pointing(name: string): Promise<{ pointing: boolean | null; seen?: string }> {
  const c = await look(() => resolver.resolveCname(name));
  const targets = [TARGET, CF.fallback, publicHost].filter(Boolean);
  if ('v' in c && c.v.length) {
    const t = c.v[0].toLowerCase().replace(/\.$/, '');
    return { pointing: targets.includes(t), seen: `CNAME ${t}` };
  }
  const a = await look(() => resolver.resolve4(name));
  if ('unknown' in a && 'unknown' in c) return { pointing: null };
  if (!('v' in a) || !a.v.length) return { pointing: false };
  const mine = await ourIps();
  return { pointing: a.v.some((ip) => mine.includes(ip)), seen: `A ${a.v.slice(0, 2).join(', ')}` };
}
async function txtHas(d: DomainRow): Promise<boolean | null> {
  const r = await look(() => resolver.resolveTxt(`_jhino.${d.hostname.replace(/^www\./, '')}`));
  if ('unknown' in r) return null;
  if (!('v' in r)) return false;
  return r.v.some((parts) => parts.join('').trim() === d.verify_token);
}
const pingToken = (d: DomainRow) => sha256(`ping:${d.id}:${d.verify_token}`).slice(0, 32);
/** Self-managed: does https://<host> answer with a valid certificate, and is it us? */
async function probe(d: DomainRow): Promise<boolean> {
  try {
    const r = await fetch(`https://${d.hostname}/__jhino/ping`, { signal: AbortSignal.timeout(15_000), redirect: 'manual' });
    return r.ok && (await r.text()).trim() === pingToken(d);
  } catch { return false; }
}

/* ---------------- checking a domain ---------------- */
const DAY = 864e5;
const running = new Map<string, Promise<DomainRow | undefined>>();
export function checkDomain(id: string, manual = false): Promise<DomainRow | undefined> {
  const r = running.get(id);
  if (r) return r;
  const p = runCheck(id, manual).finally(() => running.delete(id));
  running.set(id, p);
  return p;
}
async function runCheck(id: string, manual: boolean): Promise<DomainRow | undefined> {
  const d = loadDomain(id);
  if (!d) return undefined;
  const a = db.prepare('SELECT id, name, deleted_at FROM apps WHERE id=?').get(d.app_id) as { id: string; name: string; deleted_at: string | null } | undefined;
  if (!a) { await removeDomain(d).catch(() => {}); return undefined; }
  const found: Found = foundOf(d);
  let status: DomainStatus = d.status;
  let ssl = d.ssl_status;
  let error: string | null = null;
  let unknown = false;
  let ids = { primaryId: d.cf_hostname_id, altId: d.cf_alt_id };

  // DNS as seen from here: for the owner's checklist in both modes.
  found.dns = {};
  for (const n of [d.hostname, d.alt_hostname].filter(Boolean) as string[]) found.dns[n] = await pointing(n);

  if (cfMode()) {
    try {
      if (!d.cf_hostname_id || (d.alt_hostname && !d.cf_alt_id)) {
        const s = await cfSync(d, { primary: d.hostname, alt: d.alt_hostname });
        ids = s;
        db.prepare('UPDATE custom_domains SET cf_hostname_id=?, cf_alt_id=? WHERE id=?').run(s.primaryId, s.altId, d.id);
      }
      const r = await cf<CfHostname>('GET', `/${encodeURIComponent(ids.primaryId!)}`);
      // A manual check while the certificate waits for validation asks Cloudflare to look again.
      if (manual && r.ssl?.status === 'pending_validation') await cf('PATCH', `/${encodeURIComponent(r.id)}`, { ssl: cfSsl() }).catch(() => {});
      const own = r.ownership_verification?.name && r.ownership_verification.value ? { name: r.ownership_verification.name, value: r.ownership_verification.value } : null;
      const validation = (r.ssl?.validation_records ?? []).filter((v) => v.txt_name && v.txt_value).map((v) => ({ name: v.txt_name!, value: v.txt_value! }));
      const errs = [...(r.verification_errors ?? []), ...(r.ssl?.validation_errors ?? []).map((x) => x.message ?? '')].filter(Boolean).slice(0, 3);
      found.cf = { ownership: own, validation, status: r.status, ssl: r.ssl?.status, errors: errs };
      ssl = r.ssl?.status ?? null;
      const sslState = r.ssl?.status ?? '';
      if (['blocked', 'moved', 'deleted'].includes(r.status) || ['validation_timed_out', 'issuance_timed_out', 'expired', 'deleted', 'deployment_timed_out', 'deletion_timed_out'].includes(sslState)) {
        status = 'error';
        error = errs[0] || (r.status === 'blocked' ? 'Cloudflare blocked this hostname.' : sslState.includes('timed_out') ? 'The certificate could not be issued in time. Check the DNS records, then Check now.' : `Cloudflare reports ${r.status} / ${sslState}.`);
      } else if (r.status === 'active' && sslState === 'active') status = 'active';
      else if (r.status === 'active' || found.dns[d.hostname]?.pointing) status = 'verifying';
      else status = 'pending';
      if (status !== 'active' && status !== 'error' && errs[0]) error = errs[0];
      if (d.alt_hostname && ids.altId) {
        const alt = await cf<CfHostname>('GET', `/${encodeURIComponent(ids.altId)}`).catch(() => null);
        if (alt && status === 'active' && !(alt.status === 'active' && alt.ssl?.status === 'active')) error = `${d.alt_hostname} is not ready yet: add its DNS record so it can forward to ${d.hostname}.`;
      }
    } catch (e) {
      if (e instanceof CfError && e.status >= 400 && e.status < 500 && e.status !== 429) { status = d.status === 'active' ? 'active' : 'error'; error = `Cloudflare: ${e.message}`; }
      else { unknown = true; error = e instanceof Error ? e.message : 'Could not check.'; }
    }
  } else {
    const txt = await txtHas(d);
    found.txt = txt;
    const pt = found.dns[d.hostname]?.pointing ?? null;
    if (txt === null || pt === null) unknown = true;
    else if (!txt || !pt) {
      status = 'pending';
      error = !txt && !pt ? null : !txt ? `The TXT record _jhino.${d.hostname.replace(/^www\./, '')} is missing or has another value.` : `${d.hostname} does not point to Jhino yet.`;
    } else {
      // Ownership and DNS are right: the certificate is issued on the first HTTPS visit (tls-ask says yes from now on).
      if (d.status === 'pending' || d.status === 'error') db.prepare("UPDATE custom_domains SET status='verifying' WHERE id=?").run(d.id);
      forgetHosts();
      const tls = await probe({ ...d });
      found.tls = tls;
      ssl = tls ? 'active' : 'pending_issuance';
      status = tls ? 'active' : 'verifying';
      if (!tls && d.checks >= 6) error = `HTTPS does not answer on ${d.hostname} yet. The proxy in front of Jhino must issue certificates on demand (see the setup guide).`;
    }
    if (d.alt_hostname && status === 'active' && found.dns[d.alt_hostname]?.pointing === false) error = `${d.alt_hostname} does not point to Jhino yet, so it cannot forward to ${d.hostname}.`;
  }

  // Waiting a long time for DNS: say so plainly (checks go on, slowly).
  const age = Date.now() - Date.parse(d.created_at);
  if (status === 'pending' && !unknown && age > 14 * DAY) { status = 'error'; error = error ?? 'We still cannot see the DNS records after 14 days. Check them with your domain provider, then Check now.'; }

  // A live domain that fails once keeps serving; it counts as broken on the second failure in a row.
  let fails = d.fails;
  if (d.status === 'active' && status !== 'active' && !unknown) {
    fails += 1;
    if (fails < 2) { status = 'active'; error = error ?? 'A check failed once; checking again soon.'; }
  } else if (status === 'active') fails = 0;
  if (unknown) status = d.status;

  const checks = manual ? 0 : d.checks + 1;
  const wait = status === 'active' ? (fails ? 30 * 60_000 : DAY)
    : unknown ? 5 * 60_000
      : status === 'error' && age > 14 * DAY ? 12 * 3600_000
        : Math.min(6 * 3600_000, 60_000 * 2 ** Math.min(checks, 9));
  const t = now();
  db.prepare(`UPDATE custom_domains SET status=?, ssl_status=?, error=?, records=?, fails=?, checks=?, last_checked_at=?, next_check_at=?, updated_at=?,
    activated_at=CASE WHEN ?='active' AND activated_at IS NULL THEN ? ELSE activated_at END WHERE id=?`)
    .run(status, ssl, error, JSON.stringify(found), fails, checks, t, new Date(Date.now() + wait).toISOString(), t, status, t, d.id);
  forgetHosts();

  if (status !== d.status) {
    if (status === 'active') notify(d.owner_id, 'account', `${d.hostname} is live`, `${a.name} now opens at https://${d.hostname}.`, `/apps/${d.app_id}`);
    else if (d.status === 'active') notify(d.owner_id, 'account', `${d.hostname} stopped working`, `${error ?? 'Its DNS or certificate changed.'} Open Share → Custom domain to see what to fix.`, `/apps/${d.app_id}`);
  }
  return loadDomain(d.id);
}

/** Wait for a check, but not longer than `ms` (it carries on in the background). */
const within = (p: Promise<unknown>, ms: number) => Promise.race([p.catch(() => undefined), new Promise((r) => setTimeout(r, ms))]);

/** Disconnect a domain: Cloudflare first (so no hostname is left behind), then the row. */
async function removeDomain(d: DomainRow) {
  if (cfMode()) { await cfDelete(d.cf_hostname_id); await cfDelete(d.cf_alt_id); }
  db.prepare('DELETE FROM custom_domains WHERE id=?').run(d.id);
  forgetHosts();
}

let jobOn = false;
function startJob() {
  if (jobOn) return;
  jobOn = true;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const due = db.prepare('SELECT id FROM custom_domains WHERE disabled_at IS NULL AND (next_check_at IS NULL OR next_check_at <= ?) ORDER BY next_check_at LIMIT 10').all(now()) as { id: string }[];
      for (const r of due) await checkDomain(r.id).catch((e) => console.error('  [domains] check failed', (e as Error).message));
      // Apps deleted for good: let their domains go too.
      const gone = db.prepare('SELECT d.* FROM custom_domains d LEFT JOIN apps a ON a.id=d.app_id WHERE a.id IS NULL LIMIT 20').all() as DomainRow[];
      for (const d of gone) await removeDomain(d).catch(() => {});
    } catch (e) { console.error('  [domains]', (e as Error).message); }
    busy = false;
  };
  setTimeout(() => { void tick(); }, 15_000).unref();
  setInterval(() => { void tick(); }, 60_000).unref();
}


/* ---------------- whose DNS is it: exact steps for a root domain (ujjwal.com) ---------------- */
// A root domain can't hold a plain CNAME. Some DNS providers flatten it for you (ALIAS, ANAME), some can't at all.
type RootWay = 'cname' | 'alias' | 'aname' | 'a' | 'move' | 'unknown';
const PROVIDERS: [RegExp, string, RootWay][] = [
  [/\.ns\.cloudflare\.com$/, 'Cloudflare', 'cname'],
  [/registrar-servers\.com$/, 'Namecheap', 'alias'],
  [/porkbun\.com$/, 'Porkbun', 'alias'],
  [/dnsimple\.com$|dnsimple-edge/, 'DNSimple', 'alias'],
  [/vercel-dns\.com$/, 'Vercel', 'alias'],
  [/name\.com$/, 'Name.com', 'aname'],
  [/domaincontrol\.com$/, 'GoDaddy', 'move'],
  [/awsdns/, 'Amazon Route 53', 'move'],
  [/googledomains\.com$|squarespacedns|google\.com$/, 'Squarespace (Google Domains)', 'move'],
  [/digitalocean\.com$/, 'DigitalOcean', 'move'],
  [/hostinger|dns-parking\.com$/, 'Hostinger', 'move'],
  [/bluehost\.com$/, 'Bluehost', 'move'],
  [/hostgator/, 'HostGator', 'move'],
  [/wixdns\.net$/, 'Wix', 'move'],
];
const provCache = new Map<string, { at: number; v: { provider: string | null; nameservers: string[]; root: RootWay } }>();
async function dnsProvider(base: string) {
  const hit = provCache.get(base);
  if (hit && Date.now() - hit.at < 3600_000) return hit.v;
  let ns: string[] = [];
  try { ns = (await resolver.resolveNs(base)).map((x) => x.toLowerCase().replace(/\.$/, '')); } catch { /* not delegated yet */ }
  const m = PROVIDERS.find(([re]) => ns.some((n) => re.test(n)));
  const np = /\.np$/.test(base);
  const v = { provider: m?.[1] ?? null, nameservers: ns, root: (m?.[2] ?? (np ? 'move' : 'unknown')) as RootWay };
  if (provCache.size >= 2000) provCache.clear(); // an hour-long cache, bounded
  provCache.set(base, { at: Date.now(), v });
  return v;
}

/* ---------------- what the owner sees ---------------- */
interface RecordOut { type: 'CNAME' | 'A' | 'TXT'; name: string; host: string; value: string; purpose: string; required: boolean; ok: boolean | null; note?: string }
function recordsFor(d: DomainRow): RecordOut[] {
  const f = foundOf(d);
  const out: RecordOut[] = [];
  const names = [d.hostname, d.alt_hostname].filter(Boolean) as string[];
  for (const n of names) {
    const apex = registrable(n) === n;
    const ok = f.dns?.[n]?.pointing ?? null;
    const purpose = n === d.hostname ? 'Points your domain at Jhino' : `Lets ${n} forward to ${d.hostname}`;
    if (!cfMode() && A_RECORD && (apex || !TARGET)) {
      out.push({ type: 'A', name: n, host: shortName(n), value: A_RECORD, purpose, required: true, ok });
      continue;
    }
    out.push({
      type: 'CNAME', name: n, host: shortName(n), value: TARGET, purpose, required: true, ok,
      note: apex ? `At the root (@) many providers do not allow a CNAME. Use their ALIAS, ANAME or "CNAME flattening" (Cloudflare DNS does this by itself)${A_RECORD ? `, or an A record to ${A_RECORD}` : ''}.` : undefined,
    });
  }
  if (cfMode()) {
    if (f.cf?.ownership) out.push({ type: 'TXT', name: f.cf.ownership.name, host: shortName(f.cf.ownership.name), value: f.cf.ownership.value, purpose: 'Proves you own the domain', required: false, ok: d.status === 'active' || f.cf.status === 'active' ? true : null, note: 'Optional when the CNAME is in place. Add it to verify before you switch the CNAME, so there is no gap.' });
    for (const v of f.cf?.validation ?? []) out.push({ type: 'TXT', name: v.name, host: shortName(v.name), value: v.value, purpose: 'Lets the certificate be issued', required: true, ok: d.ssl_status === 'active' ? true : null });
  } else {
    const n = `_jhino.${d.hostname.replace(/^www\./, '')}`;
    out.unshift({ type: 'TXT', name: n, host: shortName(n), value: d.verify_token, purpose: 'Proves you own the domain', required: true, ok: f.txt ?? null });
  }
  return out;
}
function view(d: DomainRow) {
  const f = foundOf(d);
  return {
    id: d.id, appId: d.app_id, hostname: d.hostname, altHostname: d.alt_hostname, wwwMode: d.www_mode, wwwEligible: wwwEligible(d.hostname),
    status: d.status, sslStatus: d.ssl_status, error: d.error, backlink: d.backlink !== 0, disabled: !!d.disabled_at, granted: !!d.granted,
    url: `https://${d.hostname}`, lastCheckedAt: d.last_checked_at, nextCheckAt: d.next_check_at, activatedAt: d.activated_at, createdAt: d.created_at,
    records: recordsFor(d), seen: Object.fromEntries(Object.entries(f.dns ?? {}).map(([k, v]) => [k, v.seen ?? null])),
  };
}
function setupInfo() {
  return { mode: cfMode() ? 'cloudflare' : 'self', target: TARGET, aRecord: A_RECORD || null };
}
/** The app, when this person may manage its domains (its owner, or a super admin). */
function manageable(req: FastifyRequest, appId: string) {
  const u = requireUser(req);
  if (req.pub || req.desk) throw new HttpError(403, 'FORBIDDEN', 'Not here.');
  const a = db.prepare('SELECT * FROM apps WHERE id=?').get(appId) as AppRow | undefined;
  if (!a || (roleOf(appId, u.id) !== 'owner' && !u.is_admin)) throw new HttpError(404, 'NOT_FOUND', 'That app does not exist.');
  const owner = db.prepare('SELECT * FROM users WHERE id=?').get(a.owner_id) as UserRow;
  return { u, a, owner };
}
function ownedDomain(req: FastifyRequest, id: string) {
  const d = loadDomain(String(id));
  if (!d) throw new HttpError(404, 'NOT_FOUND', 'That domain is not connected.');
  const m = manageable(req, d.app_id);
  return { ...m, d };
}
const domainLimit = (owner: UserRow, u: UserRow) => (owner.is_admin || u.is_admin ? null : featuresOf(owner).customDomains);
const domainsUsed = (ownerId: string) => (db.prepare('SELECT COUNT(*) n FROM custom_domains WHERE owner_id=? AND granted=0').get(ownerId) as { n: number }).n;

/* ---------------- pages Jhino shows on a custom domain ---------------- */
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
/** The one line under every site on a custom domain: its own isolated style (shadow DOM), in the page flow so it never covers fixed content. */
export function creditLine(host: string) {
  const href = `${BRAND}/?ref=${encodeURIComponent(host)}`;
  const guard = 'all:initial!important;display:block!important;position:static!important;visibility:visible!important;opacity:1!important;'
    + 'width:auto!important;height:28px!important;min-height:28px!important;max-height:28px!important;margin:0!important;padding:0!important;border:0!important;'
    + 'overflow:hidden!important;clear:both!important;float:none!important;transform:none!important;filter:none!important;clip-path:none!important;'
    + 'pointer-events:auto!important;z-index:auto!important;contain:layout style paint!important;box-sizing:border-box!important';
  const style = ':host{all:initial;display:block}'
    + 'a{display:flex;align-items:center;justify-content:center;height:28px;margin:0;padding:0 12px;box-sizing:border-box;border-top:1px solid #e8e8e6;background:#fafaf9;'
    + 'color:#5c5b58;font:500 11.5px/1 "Helvetica Neue",Arial,sans-serif;letter-spacing:.01em;text-decoration:none;white-space:nowrap}'
    + 'a:hover{color:#141414;text-decoration:underline;text-underline-offset:2px}a:focus-visible{outline:2px solid #141414;outline-offset:-3px}'
    + '@media (prefers-color-scheme:dark){a{background:#161615;border-top-color:#2a2a28;color:#a8a6a0}a:hover{color:#f2f1ed}a:focus-visible{outline-color:#f2f1ed}}';
  const fallback = `<a href="${esc(href)}" rel="noopener" target="_blank" style="display:block!important;height:28px!important;line-height:28px!important;text-align:center!important;font:500 11.5px Arial,sans-serif!important;color:#5c5b58!important;background:#fafaf9!important;text-decoration:none!important">Built with Jhino</a>`;
  return `\n<jhino-credit data-jhino-credit style="${guard}"><template shadowrootmode="open"><style>${style}</style><a href="${esc(href)}" rel="noopener" target="_blank" part="link">Built with Jhino</a></template>${fallback}</jhino-credit>\n`;
}
/** Put the line at the very end of the body (after the site's own footer). */
function withCredit(html: string, host: string) {
  const line = creditLine(host);
  const lower = html.length > 4_000_000 ? '' : html.toLowerCase();
  const b = lower.lastIndexOf('</body>');
  if (b >= 0) return html.slice(0, b) + line + html.slice(b);
  const h = lower.lastIndexOf('</html>');
  if (h >= 0) return html.slice(0, h) + line + html.slice(h);
  return html + line;
}
function page(reply: FastifyReply, status: number, o: { title: string; heading: string; text: string; host?: string; form?: string; credit?: boolean }) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(o.title)}</title><style>@font-face{font-family:JG;src:url(/_jhino/fonts/grotesk.woff2) format("woff2");font-weight:400 800;font-display:swap}
*{box-sizing:border-box}html{background:#fff;color:#141414;font:15px/1.55 JG,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}body{margin:0;min-height:100vh;display:flex;flex-direction:column}
main{flex:1;display:grid;place-items:center;padding:48px 16px}.card{width:min(400px,100%)}h1{font-size:24px;line-height:1.2;letter-spacing:-.02em;margin:0 0 10px;font-weight:650}
p{margin:0 0 18px;color:#4b4a47}.host{font:12.5px/1.4 ui-monospace,Menlo,monospace;color:#75736e;margin-bottom:18px}label{display:grid;gap:6px;margin-bottom:14px;font-size:13px;font-weight:550;color:#4b4a47}
input{font:inherit;height:42px;padding:0 12px;border:1px solid #cfccc5;border-radius:7px;background:#fff;color:#141414}input:focus{outline:2px solid #141414;outline-offset:1px;border-color:#141414}
button{font:inherit;font-weight:600;height:42px;width:100%;border:0;border-radius:7px;background:#141414;color:#fff;cursor:pointer}button:hover{background:#2b2b2a}.err{color:#b3261e;font-size:13.5px;margin:-4px 0 14px}
@media (prefers-color-scheme:dark){html{background:#121211;color:#f2f1ed}p{color:#c4c2bc}.host{color:#95928b}label{color:#c4c2bc}input{background:#1a1a19;color:#f2f1ed;border-color:#403f3b}input:focus{outline-color:#f2f1ed}button{background:#f2f1ed;color:#121211}.err{color:#ff7a70}}</style></head>
<body><main><div class="card">${o.host ? `<div class="host">${esc(o.host)}</div>` : ''}<h1>${esc(o.heading)}</h1><p>${o.text}</p>${o.form ?? ''}</div></main>${o.credit === false ? '' : creditLine(o.host ?? '')}</body></html>`;
  return reply.code(status).header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex').type('text/html; charset=utf-8').send(body);
}

/* ---------------- visitors on a custom domain ---------------- */
const VISIT_DAYS = 30;
const visitCookie = (appId: string) => `jp_${appId}`;
const CSRF_COOKIE = 'jd_csrf';
/** The guest or visitor this browser is in the app, from its host-only cookie. */
function visitingAs(req: FastifyRequest, a: AppRow): string | null {
  const c = req.cookies?.[visitCookie(a.id)];
  if (!c) return null;
  const r = db.prepare('SELECT user_id FROM pub_sessions WHERE token_hash=? AND app_id=? AND expires_at > ?').get(sha256(c), a.id, now()) as { user_id: string | null } | undefined;
  return r?.user_id && roleOf(a.id, r.user_id) ? r.user_id : null;
}
/** A visit on the custom domain: host-only, HttpOnly, Secure, SameSite=Lax (a link from another site opens it signed in). */
function startVisit(req: FastifyRequest, reply: FastifyReply, a: AppRow, userId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + VISIT_DAYS * DAY);
  db.prepare('INSERT INTO pub_sessions(token_hash,app_id,ip,created_at,expires_at,user_id) VALUES(?,?,?,?,?,?)').run(sha256(token), a.id, req.ip, now(), expires.toISOString(), userId);
  reply.setCookie(visitCookie(a.id), token, { path: '/', httpOnly: true, sameSite: 'lax', secure: secureSite(req), expires });
}
/** The app's shared visitor account (made once; two first visits at the same moment both end up with it). */
async function sharedVisitor(appId: string): Promise<string> {
  const fresh = () => db.prepare('SELECT * FROM apps WHERE id=?').get(appId) as AppRow;
  let vid: string;
  try { vid = await ensureVisitor(fresh()); } catch (e) {
    const v = e instanceof HttpError && e.code === 'EMAIL_TAKEN' ? fresh().visitor_id : null;
    if (!v) throw e;
    vid = v;
  }
  // As setSharing does: an app open by link has its visitor as a member with the visitors' role.
  const a = fresh();
  if (a.access && a.access !== 'private') db.prepare('INSERT INTO memberships(app_id,user_id,role,added_at) VALUES(?,?,?,?) ON CONFLICT(app_id,user_id) DO NOTHING').run(appId, vid, a.public_role ?? 'viewer', now());
  return vid;
}
const BOTS = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|whatsapp|telegram|discord|curl|wget|python|headless|lighthouse/i;
type Visit = { userId: string; role: Role } | { gate: 'private' | 'password' | 'name' };
async function visitFor(req: FastifyRequest, reply: FastifyReply, a: AppRow): Promise<Visit> {
  if (!a.access || a.access === 'private') return { gate: 'private' };
  const role = (a.public_role ?? 'viewer') as Role;
  const me = visitingAs(req, a);
  if (me) return { userId: me, role: roleOf(a.id, me) ?? role };
  if (a.access === 'password') return { gate: 'password' };
  if (collaborative(a.public_role)) return { gate: 'name' };
  // Open to view: everyone is the app's shared visitor. Crawlers read the page without a stored visit.
  const vid = await sharedVisitor(a.id);
  if (!BOTS.test(String(req.headers['user-agent'] ?? ''))) {
    try { limit(req, 'domain-visit', 120, 60_000); startVisit(req, reply, a, vid); } catch { /* many new visits from one address: the page still opens */ }
  }
  return { userId: vid, role };
}
function csrfFor(req: FastifyRequest, reply: FastifyReply) {
  let t = req.cookies?.[CSRF_COOKIE];
  if (!t || !/^[\w-]{20,64}$/.test(t)) {
    t = crypto.randomBytes(18).toString('base64url');
    reply.setCookie(CSRF_COOKIE, t, { path: '/', httpOnly: true, sameSite: 'lax', secure: secureSite(req) });
  }
  return t;
}
function gatePage(req: FastifyRequest, reply: FastifyReply, host: string, a: AppRow, gate: 'password' | 'name', error = '', status = 200) {
  const askName = collaborative(a.public_role);
  const askPw = a.access === 'password';
  const next = (req.url.split('?')[0] || '/').slice(0, 300);
  const form = `<form method="post" action="/__jhino/unlock">
<input type="hidden" name="csrf" value="${esc(csrfFor(req, reply))}"><input type="hidden" name="next" value="${esc(next)}">
${askName ? '<label>Your full name<input name="name" required minlength="2" maxlength="60" autocomplete="name" placeholder="Sita Sharma"' + (askPw ? '' : ' autofocus') + '></label>' : ''}
${askPw ? '<label>Password<input name="password" type="password" required autocomplete="current-password" autofocus></label>' : ''}
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}<button type="submit">Open</button></form>`;
  const text = gate === 'password'
    ? (askName ? 'This site is protected. Enter the password you were given and your name; it shows next to what you add.' : 'This site is protected. Enter the password you were given.')
    : 'Tell the others who you are. Your name shows next to everything you add here.';
  reply.header('X-Robots-Tag', 'noindex');
  return page(reply, status, { title: a.name, heading: a.name, text: esc(text), host, form });
}

/* ---------------- serving the app at the top of the domain ---------------- */
const APP_API = /^(kv|records|files|people|activity|trash|watch|unwatch)(\/|$)/;
/** API calls a site on a custom domain may make: its own app's data and live stream, nothing else. */
function apiAllowed(appId: string, method: string, url: string) {
  const [p, q = ''] = url.split('?');
  if (p === '/api/events') return method === 'GET' && new URLSearchParams(q).get('app') === appId;
  const pre = `/api/apps/${appId}/`;
  return p.startsWith(pre) && APP_API.test(p.slice(pre.length));
}
const indexable = (a: AppRow) => a.access === 'public' && !collaborative(a.public_role);
function listPages(root: string) {
  const out: string[] = [];
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > 5 || out.length >= 1000) return;
    let items: fs.Dirent[] = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (it.name.startsWith('.') || it.name.startsWith('_')) continue;
      if (it.isDirectory()) walk(path.join(dir, it.name), rel + it.name + '/', depth + 1);
      else if (/\.html?$/i.test(it.name)) out.push(rel + it.name);
    }
  };
  walk(root, '', 0);
  return out;
}
function headExtras(html: string, origin: string, pathname: string, a: AppRow) {
  const head = html.slice(0, 256 * 1024);
  const has = (rel: string) => new RegExp(`<link[^>]+rel\\s*=\\s*["']?[^"'>]*\\b${rel}\\b`, 'i').test(head);
  const info = installInfo(a, '/');
  let extra = '';
  if (!has('canonical')) extra += `<link rel="canonical" href="${esc(origin + pathname)}">`;
  if (!has('manifest')) extra += '<link rel="manifest" href="/__jhino/manifest.webmanifest">';
  if (!has('icon')) extra += `<link rel="icon" type="image/png" href="${esc(info.icon)}">`;
  if (!has('apple-touch-icon')) extra += `<link rel="apple-touch-icon" href="${esc(info.appleIcon)}">`;
  if (!extra) return html;
  // Right after the Jhino boot and shim tags, which inject() put first in <head>.
  const shim = html.indexOf('<script src="/_jhino/shim.js"></script>');
  if (shim >= 0) { const at = shim + '<script src="/_jhino/shim.js"></script>'.length; return html.slice(0, at) + extra + html.slice(at); }
  const h = openTag(html, 'head');
  return h >= 0 ? html.slice(0, h) + extra + html.slice(h) : extra + html;
}
async function serveSite(req: FastifyRequest, reply: FastifyReply, h: Hosted, host: string, c: Ctx) {
  const a = h.a!;
  const d = h.d;
  const sys = () => { c.csp = PAGE_CSP; };
  const origin = `${secureSite(req) ? 'https' : req.protocol}://${d.hostname}`;
  const v = versionRow(a.id, a.live_version) as (ReturnType<typeof versionRow> & { builder?: string | null }) | undefined;
  if (!v) sys();
  if (!v) return page(reply, 404, { title: 'Nothing here', heading: 'Nothing here yet', text: 'This site has no published version.', host });
  const root = appDir(a.id, a.live_version);
  const pathname = req.url.split('?')[0];
  let rel: string;
  try { rel = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return reply.code(400).type('text/plain').send('Bad address'); }
  if (rel.includes('\0')) return reply.code(400).type('text/plain').send('Bad address');

  // Search engines and home screens: the site's own files win, otherwise Jhino makes them.
  const own = (name: string) => fs.existsSync(path.join(root, name));
  if (rel === 'robots.txt' && !own('robots.txt')) {
    return reply.type('text/plain; charset=utf-8').header('Cache-Control', 'public, max-age=3600')
      .send(indexable(a) && !h.paused ? `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
  }
  if (rel === 'sitemap.xml' && !own('sitemap.xml')) {
    if (!indexable(a)) return reply.code(404).type('text/plain').send('Not found');
    const lastmod = String(a.updated_at).slice(0, 10);
    const urls = listPages(root).map((p) => (p === v.entry || p === 'index.html' ? '/' : p.replace(/(^|\/)index\.html?$/i, '$1'))).filter((p, i, arr) => arr.indexOf(p) === i);
    if (!urls.includes('/')) urls.unshift('/');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(origin + (u.startsWith('/') ? u : '/' + u.split('/').map(encodeURIComponent).join('/')))}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`;
    return reply.type('application/xml; charset=utf-8').header('Cache-Control', 'no-cache').send(xml);
  }
  if (rel === '__jhino/manifest.webmanifest') {
    const m = { ...installInfo(a, '/').manifest, id: '/', description: a.name };
    return reply.type('application/manifest+json; charset=utf-8').header('Cache-Control', 'no-cache').send(JSON.stringify(m));
  }
  if (rel === 'favicon.ico' && !own('favicon.ico')) return reply.redirect(installInfo(a, '/').icon, 302);

  const visit = await visitFor(req, reply, a);
  const isHtmlish = !path.extname(rel) || /\.html?$/i.test(rel);
  if ('gate' in visit) {
    if (!isHtmlish) return reply.code(403).type('text/plain').send('This site is not open.');
    sys();
    if (visit.gate === 'private') return page(reply, 403, { title: 'Not public yet', heading: 'This site is not public yet', text: 'Its owner has not opened it to visitors. Check back soon.', host });
    return gatePage(req, reply, host, a, visit.gate);
  }
  const role = visit.role;

  // Files people added in the app (relative links, so any page depth works).
  const fm = rel.match(/(?:^|\/)__jhino\/files\/([\w-]{1,64})$/);
  if (fm) {
    const f = loadFile(a.id, fm[1]);
    if (!f || !canReadFile(f, visit.userId, role)) return reply.code(404).type('text/plain').send('File not found');
    // Same origin as the site: anything that could run script stays sandboxed (PDFs open in the browser's viewer).
    c.csp = f.type === 'application/pdf' ? null : FILE_CSP;
    return sendFile(req, reply, f, { download: (req.query as { download?: string }).download === '1', sameOrigin: true });
  }

  if (!rel || rel.endsWith('/')) rel += rel ? 'index.html' : v.entry;
  let file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) return reply.code(400).type('text/plain').send('Bad address');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // A folder with its own page: /about → /about/ so its relative links work.
    if (fs.existsSync(path.join(file, 'index.html')) && !pathname.endsWith('/')) {
      const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      return reply.redirect(pathname + '/' + qs, 301);
    }
    if (path.extname(rel)) {
      if (/\.html?$/i.test(rel)) sys();
      if (/\.html?$/i.test(rel)) return page(reply, 404, { title: 'Page not found', heading: 'Page not found', text: 'There is no page at this address. <a href="/">Go to the home page</a>.', host });
      return reply.code(404).type('text/plain').send('Not found');
    }
    // Apps with their own routing: unknown paths without an extension get the main page.
    file = path.join(root, v.entry);
  }
  const ext = path.extname(file).toLowerCase();
  reply.type(TYPES[ext] || 'application/octet-stream');
  const privateSite = a.access !== 'public';
  if (ext === '.html' || ext === '.htm') {
    const u = db.prepare('SELECT id, name, username, kind FROM users WHERE id=?').get(visit.userId) as { id: string; name: string; username: string | null; kind: string } | undefined;
    const boot = {
      v: 1, nonce: crypto.randomBytes(12).toString('base64url'), appId: a.id, version: a.live_version,
      user: { id: visit.userId, name: u?.name ?? 'Visitor', email: '', username: u?.kind === 'visitor' ? null : u?.username ?? null, role },
      privateKeys: JSON.parse(a.private_keys),
      data: snapshotFor(a.id, visit.userId),
      uploads: uploadsOn(),
      // No Jhino page around it: the shim talks to this server itself (same origin, the visit cookie).
      direct: { app: a.id },
    };
    let usesIdb = false;
    try { usesIdb = !!JSON.parse(v.features).indexedDB; } catch { /* old version row */ }
    const entry = file === path.join(root, v.entry);
    if (entry) trackRun(req, a.id, a.name);
    let html = fs.readFileSync(file, 'utf8');
    if (entry && v.builder) html = withCurrentBuilder(html);
    html = inject(html, boot, usesIdb);
    html = headExtras(html, origin, pathname, a);
    const showCredit = !(d.backlink === 0 && h.owner?.is_admin && h.owner.id === d.owner_id);
    if (showCredit) html = withCredit(html, d.hostname);
    reply.header('Cache-Control', 'no-store');
    if (!indexable(a)) reply.header('X-Robots-Tag', 'noindex');
    return reply.send(html);
  }
  reply.header('Cache-Control', privateSite ? 'private, max-age=600' : 'public, max-age=600');
  if (req.method === 'HEAD') return reply.send();
  return reply.send(fs.createReadStream(file));
}

/* ---------------- routes and hooks ---------------- */
interface Ctx { host: string; h: Hosted | null; csp?: string | null }
const ctxOf = new WeakMap<FastifyRequest, Ctx>();
const FILE_CSP = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'";
const APP_CSP = (secure: boolean) => `frame-ancestors 'self'; base-uri 'self'; object-src 'none'${secure ? '; upgrade-insecure-requests' : ''}`;

export function registerCustomDomains(app: FastifyInstance) {
  startJob();

  /* Every request: is it for a custom domain? Then it is that site (and only that site's API). */
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health' || req.url === '/api/health') return;
    const host = reqHost(req);
    const h = host ? hostedAt(host) : null;
    if (!h) {
      if (!publicHost || isPlatformHost(host)) return; // Jhino itself (and every host in development)
      ctxOf.set(req, { host, h: null, csp: PAGE_CSP });
      return page(reply, 404, { title: 'Site not found', heading: 'There is no site here', text: 'This domain is not connected to a site on Jhino. If it is yours, connect it from your app’s Share settings.', host, credit: false });
    }
    // A custom domain never sees Jhino's own sign-in: no session cookie, no app key, whatever the browser sends.
    if (req.cookies) delete req.cookies[COOKIE];
    delete req.headers.authorization;
    // The app as it is now (sharing changes apply at once); the domain itself may come from the short cache.
    const fresh: Hosted = { ...h, a: (db.prepare('SELECT * FROM apps WHERE id=?').get(h.d.app_id) as AppRow | undefined) ?? null };
    const c: Ctx = { host, h: fresh };
    ctxOf.set(req, c);
    const { d, a } = fresh;
    const pathname = req.url.split('?')[0];

    if (pathname === '/__jhino/ping' && (d.status === 'verifying' || d.status === 'active')) {
      return reply.type('text/plain').header('Cache-Control', 'no-store').send(pingToken(d));
    }
    const pageFor = (status: number, title: string, heading: string, text: string) => { c.csp = PAGE_CSP; return page(reply, status, { title, heading, text, host }); };
    if (d.disabled_at) return pageFor(503, 'Unavailable', 'This site is unavailable', 'It has been switched off. If it is yours, contact Jhino support.');
    if (d.status !== 'active') {
      return d.status === 'verifying'
        ? pageFor(503, 'Almost ready', 'This site is almost ready', 'Its secure certificate is being issued. This usually takes a few minutes.')
        : pageFor(404, 'Not connected yet', 'This domain is not connected yet', 'Its DNS records are still being checked.');
    }
    // The www twin (or the root) forwards to the address the owner chose.
    if (d.alt_hostname && host === d.alt_hostname) {
      return reply.redirect(`${secureSite(req) ? 'https' : req.protocol}://${d.hostname}${req.url}`, req.method === 'GET' || req.method === 'HEAD' ? 301 : 308);
    }
    if (!a || a.deleted_at) return pageFor(404, 'Nothing here', 'This site is no longer here', 'The app behind it was removed.');
    if (h.paused) return pageFor(503, 'Paused', 'This site is paused', 'It will be back when its owner renews their plan.');

    if (pathname.startsWith('/api/')) {
      if (apiAllowed(a.id, req.method, req.url)) return; // on to the app's data routes, as its visitor
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Not found.' });
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (/^\/_jhino\/(shim\.js|idb\.js|fonts\/[\w-]+\.woff2|icon\/[\w-]+\.png)$/.test(pathname)) return; // the runtime and icons
    }
    if (pathname === '/__jhino/unlock' && req.method === 'POST') return; // the gate form (route below)
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply.code(405).header('Allow', 'GET, HEAD').type('text/plain').send('Method not allowed');
    return serveSite(req, reply, fresh, host, c);
  });

  /* Headers for custom domains: the site's own rules, never Jhino's dashboard ones. */
  app.addHook('onSend', async (req, reply, payload) => {
    const c = ctxOf.get(req);
    if (!c) return payload;
    const secure = secureSite(req);
    if (!req.url.startsWith('/api/')) {
      if (c.csp === null) reply.removeHeader('Content-Security-Policy');
      else reply.header('Content-Security-Policy', c.csp ?? APP_CSP(secure));
    }
    if (c.csp === PAGE_CSP) reply.header('X-Frame-Options', 'DENY'); else reply.removeHeader('X-Frame-Options');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.removeHeader('Permissions-Policy');
    // Not includeSubDomains: the rest of the customer's domain is theirs to decide.
    if (secure) reply.header('Strict-Transport-Security', 'max-age=31536000');
    return payload;
  });

  /* The gate on a custom domain: a password and/or a name, then a host-only visit cookie. */
  app.post('/__jhino/unlock', async (req, reply) => {
    const c = ctxOf.get(req);
    const a = c?.h?.a;
    if (!c || !a || c.h!.d.status !== 'active') return reply.code(404).send({ error: 'NOT_FOUND', message: 'Not found.' });
    c.csp = PAGE_CSP;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const next = typeof b.next === 'string' && /^\/(?!\/)[^\s\\]{0,300}$/.test(b.next) ? b.next : '/';
    const cookieT = req.cookies?.[CSRF_COOKIE] ?? '';
    const formT = String(b.csrf ?? '');
    if (!cookieT || cookieT.length !== formT.length || !crypto.timingSafeEqual(Buffer.from(cookieT), Buffer.from(formT))) {
      return gatePage(req, reply, c.host, a, a.access === 'password' ? 'password' : 'name', 'The form expired. Try again.', 403);
    }
    if (!a.access || a.access === 'private') return reply.redirect('/', 303);
    try {
      limit(req, 'domain-unlock', 10, 15 * 60_000, a.id);
      if (a.access === 'password') {
        if (!a.share_password_hash || !await verify(a.share_password_hash, String(b.password ?? '').slice(0, 200))) {
          return gatePage(req, reply, c.host, a, 'password', 'That password is not right.', 401);
        }
      }
      if (!collaborative(a.public_role)) {
        startVisit(req, reply, a, await sharedVisitor(a.id));
        return reply.redirect(next, 303);
      }
      const name = String(b.name ?? '').replace(/\s+/g, ' ').trim();
      if (name.length < 2 || name.length > 60) return gatePage(req, reply, c.host, a, a.access === 'password' ? 'password' : 'name', 'Write your name (2 to 60 characters).', 400);
      limit(req, 'public-guest', 30, 60 * 60_000);
      const guest = await createUser(`guest.${crypto.randomBytes(9).toString('hex')}@visitors.invalid`, name, makePassword(24), false, { createdBy: a.owner_id, kind: 'visitor' });
      db.prepare('UPDATE users SET password_set=0 WHERE id=?').run(guest.id);
      const r = db.prepare('INSERT INTO memberships(app_id,user_id,role,added_at,via_link) VALUES(?,?,?,?,1) ON CONFLICT(app_id,user_id) DO NOTHING').run(a.id, guest.id, a.public_role ?? 'viewer', now());
      if (r.changes) logActivity(a.id, guest.id, 'joined as a guest', `on ${c.host}`);
      startVisit(req, reply, a, guest.id);
      return reply.redirect(next, 303);
    } catch (e) {
      if (e instanceof HttpError && e.status === 429) return gatePage(req, reply, c.host, a, a.access === 'password' ? 'password' : 'name', e.message, 429);
      throw e;
    }
  });

  /* Caddy on_demand_tls "ask" (or a Traefik plugin): 200 only for domains that proved ownership. */
  app.get('/api/domains/tls-ask', async (req, reply) => {
    limit(req, 'tls-ask', 600, 60_000);
    let host = '';
    try { host = normalizeHostname((req.query as { domain?: string }).domain); } catch { return reply.code(404).send({ ok: false }); }
    const d = db.prepare("SELECT status, disabled_at FROM custom_domains WHERE (hostname=? OR alt_hostname=?) AND status IN ('verifying','active')").get(host, host) as { status: string; disabled_at: string | null } | undefined;
    if (!d || d.disabled_at) return reply.code(404).send({ ok: false });
    return { ok: true };
  });

  /* ---------- the owner's settings (Share → Custom domain) ---------- */
  app.get('/api/apps/:id/domains', async (req) => {
    const { u, a, owner } = manageable(req, (req.params as { id: string }).id);
    const rows = db.prepare('SELECT * FROM custom_domains WHERE app_id=? ORDER BY created_at').all(a.id) as DomainRow[];
    const lim = domainLimit(owner, u);
    return {
      ...setupInfo(), limit: lim, used: domainsUsed(owner.id), canAdd: lim === null || domainsUsed(owner.id) < lim,
      canHideBacklink: !!u.is_admin && owner.id === u.id, access: a.access ?? 'private', domains: rows.map(view),
    };
  });

  app.post('/api/apps/:id/domains', async (req) => {
    const { u, a, owner } = manageable(req, (req.params as { id: string }).id);
    limit(req, 'domain-add', 20, 60 * 60_000, u.id);
    if (a.deleted_at) throw new HttpError(409, 'IN_TRASH', 'Restore this app from Trash first.');
    const b = (req.body ?? {}) as { hostname?: unknown; www?: unknown };
    const host = normalizeHostname(b.hostname);
    const mode = readWww(b.www, host);
    const pair = pairFor(host, mode);
    const lim = domainLimit(owner, u);
    const byAdminForOther = !!u.is_admin && u.id !== owner.id;
    if (lim !== null) {
      if (lim <= 0) throw new HttpError(403, 'PLAN_FEATURE', 'Custom domains are on Pro. Upgrade in Plan & usage.', { feature: 'customDomains' });
      if (domainsUsed(owner.id) >= lim) throw new HttpError(403, 'LIMIT_REACHED', `Your plan includes ${lim} custom domain${lim === 1 ? '' : 's'}, and ${lim === 1 ? 'it is' : 'they are all'} in use. Remove one first.`, { feature: 'customDomains' });
    }
    const id = newId('dom');
    const t = now();
    db.transaction(() => {
      if (nameTaken([pair.primary, pair.alt])) throw new HttpError(409, 'DOMAIN_TAKEN', `${pair.primary}${pair.alt ? ` or ${pair.alt}` : ''} is already connected to a site on Jhino. Remove it there first, or contact support if it is yours.`);
      if (lim !== null && domainsUsed(owner.id) >= lim) throw new HttpError(403, 'LIMIT_REACHED', 'Your plan’s custom domains are all in use.');
      db.prepare(`INSERT INTO custom_domains(id,owner_id,app_id,hostname,alt_hostname,www_mode,status,verify_token,granted,created_at,updated_at,next_check_at)
        VALUES(?,?,?,?,?,?,'pending',?,?,?,?,?)`).run(id, owner.id, a.id, pair.primary, pair.alt, mode, `jhino-verify=${crypto.randomBytes(16).toString('hex')}`, byAdminForOther ? 1 : 0, t, t, t);
    })();
    if (cfMode()) {
      try {
        const s = await cfSync(loadDomain(id)!, pair);
        db.prepare('UPDATE custom_domains SET cf_hostname_id=?, cf_alt_id=? WHERE id=?').run(s.primaryId, s.altId, id);
      } catch (e) {
        // Refused outright (an invalid or blocked name): undo. Cloudflare unreachable: keep it, the checks retry.
        if (e instanceof CfError && e.status >= 400 && e.status < 500 && e.status !== 429) {
          const d = loadDomain(id);
          if (d) await removeDomain(d).catch(() => { db.prepare('DELETE FROM custom_domains WHERE id=?').run(id); });
          throw new HttpError(400, 'VALIDATION_FAILED', `Cloudflare did not accept ${pair.primary}: ${e.message}`);
        }
        db.prepare('UPDATE custom_domains SET error=? WHERE id=?').run('Cloudflare could not be reached. It is retried automatically.', id);
      }
    }
    logActivity(a.id, u.id, 'connected the domain', pair.primary);
    if (byAdminForOther) audit(req, 'domain.add', 'app', a.id, `${pair.primary} → ${a.name}`);
    forgetHosts();
    // The first look at DNS, without keeping the person waiting long (the checks carry on by themselves).
    await within(checkDomain(id, true), 8000);
    return { domain: view(loadDomain(id)!) };
  });

  app.get('/api/domains/:id', async (req) => {
    const { d } = ownedDomain(req, (req.params as { id: string }).id);
    return { domain: view(d) };
  });

  app.get('/api/domains/:id/provider', async (req) => {
    const { u, d } = ownedDomain(req, (req.params as { id: string }).id);
    limit(req, 'domain-provider', 60, 60_000, u.id);
    const base = registrable(d.hostname.replace(/^www\./, ''));
    const p = await dnsProvider(base);
    // With an A record set up (self-managed mode), every provider can point the root.
    return { base, target: TARGET, aRecord: !cfMode() && A_RECORD ? A_RECORD : null, ...p, root: !cfMode() && A_RECORD ? 'a' : p.root };
  });

  app.post('/api/domains/:id/check', async (req) => {
    const { u, d } = ownedDomain(req, (req.params as { id: string }).id);
    limit(req, 'domain-check', 12, 60_000, u.id);
    await within(checkDomain(d.id, true), 20_000);
    return { domain: view(loadDomain(d.id) ?? d) };
  });

  app.patch('/api/domains/:id', async (req) => {
    const { u, d, owner, a } = ownedDomain(req, (req.params as { id: string }).id);
    limit(req, 'domain-edit', 30, 60_000, u.id);
    const b = (req.body ?? {}) as { www?: unknown; backlink?: unknown };
    if (b.backlink !== undefined) {
      const on = !!b.backlink;
      if (!on && !(u.is_admin && owner.is_admin && owner.id === u.id && d.owner_id === u.id)) {
        throw new HttpError(403, 'FORBIDDEN', 'The “Built with Jhino” line stays on custom domains. Only a super admin can turn it off, on their own domains.');
      }
      db.prepare('UPDATE custom_domains SET backlink=?, updated_at=? WHERE id=?').run(on ? 1 : 0, now(), d.id);
      if (u.is_admin) audit(req, on ? 'domain.backlink_on' : 'domain.backlink_off', 'domain', d.id, d.hostname);
    }
    if (b.www !== undefined) {
      const mode = readWww(b.www, d.hostname);
      if (mode !== d.www_mode) {
        const pair = mode === 'off' ? { primary: d.hostname, alt: null } : pairFor(d.hostname, mode);
        if (nameTaken([pair.primary, pair.alt], d.id)) throw new HttpError(409, 'DOMAIN_TAKEN', `${pair.alt ?? pair.primary} is already connected to another site.`);
        let ids = { primaryId: d.cf_hostname_id, altId: d.cf_alt_id };
        if (cfMode()) {
          try { ids = await cfSync(d, pair); } catch (e) { throw new HttpError(502, 'CLOUDFLARE', `Cloudflare: ${(e as Error).message}`); }
        }
        // The address people land on changes only when it is already set up; otherwise it waits for its DNS.
        const primaryChanged = pair.primary !== d.hostname;
        db.prepare(`UPDATE custom_domains SET hostname=?, alt_hostname=?, www_mode=?, cf_hostname_id=?, cf_alt_id=?, status=CASE WHEN ? THEN 'pending' ELSE status END,
          checks=0, next_check_at=?, updated_at=? WHERE id=?`).run(pair.primary, pair.alt, mode, ids.primaryId, ids.altId, primaryChanged ? 1 : 0, now(), now(), d.id);
        logActivity(a.id, u.id, 'changed the www setting of', pair.primary);
        forgetHosts();
        await within(checkDomain(d.id, true), 8000);
      }
    }
    forgetHosts();
    return { domain: view(loadDomain(d.id)!) };
  });

  app.delete('/api/domains/:id', async (req) => {
    const { u, d, a } = ownedDomain(req, (req.params as { id: string }).id);
    limit(req, 'domain-remove', 30, 60_000, u.id);
    try { await removeDomain(d); } catch (e) { throw new HttpError(502, 'CLOUDFLARE', `Could not remove it at Cloudflare: ${(e as Error).message} Try again.`); }
    logActivity(a.id, u.id, 'disconnected the domain', d.hostname);
    if (u.id !== d.owner_id) audit(req, 'domain.remove', 'domain', d.id, d.hostname);
    return { ok: true };
  });

  /* ---------- Super Admin: every custom domain ---------- */
  app.get('/api/admin/domains', async (req) => {
    requireAdmin(req);
    const q = String((req.query as { q?: string }).q ?? '').trim().toLowerCase().slice(0, 100);
    const like = '%' + q.replace(/[!%_]/g, (x) => '!' + x) + '%';
    const rows = db.prepare(`SELECT d.*, u.name owner_name, u.email owner_email, a.name app_name FROM custom_domains d
      LEFT JOIN users u ON u.id=d.owner_id LEFT JOIN apps a ON a.id=d.app_id
      WHERE (?='' OR lower(d.hostname) LIKE ? ESCAPE '!' OR lower(COALESCE(d.alt_hostname,'')) LIKE ? ESCAPE '!' OR lower(COALESCE(u.email,'')) LIKE ? ESCAPE '!' OR lower(COALESCE(a.name,'')) LIKE ? ESCAPE '!')
      ORDER BY d.created_at DESC LIMIT 500`).all(q, like, like, like, like) as (DomainRow & { owner_name: string | null; owner_email: string | null; app_name: string | null })[];
    const counts = db.prepare('SELECT status, COUNT(*) n FROM custom_domains GROUP BY status').all() as { status: string; n: number }[];
    // Cloudflare counts every hostname: a domain with the www option is two.
    const hostnames = (db.prepare('SELECT COUNT(*) + COUNT(alt_hostname) n FROM custom_domains').get() as { n: number }).n;
    return {
      hostnames,
      ...setupInfo(),
      counts: Object.fromEntries(counts.map((r) => [r.status, r.n])),
      domains: rows.map((r) => ({ ...view(r), ownerId: r.owner_id, ownerName: r.owner_name, ownerEmail: r.owner_email, appName: r.app_name })),
    };
  });
  app.post('/api/admin/domains/:id/check', async (req) => {
    requireAdmin(req);
    limit(req, 'admin-domain-check', 60, 60_000);
    const d = loadDomain((req.params as { id: string }).id);
    if (!d) throw new HttpError(404, 'NOT_FOUND', 'That domain is not connected.');
    await within(checkDomain(d.id, true), 20_000);
    return { domain: view(loadDomain(d.id) ?? d) };
  });
  app.post('/api/admin/domains/:id/disable', async (req) => {
    requireAdmin(req);
    const d = loadDomain((req.params as { id: string }).id);
    if (!d) throw new HttpError(404, 'NOT_FOUND', 'That domain is not connected.');
    const off = !!((req.body ?? {}) as { disabled?: unknown }).disabled;
    db.prepare('UPDATE custom_domains SET disabled_at=?, next_check_at=?, updated_at=? WHERE id=?').run(off ? now() : null, now(), now(), d.id);
    forgetHosts();
    audit(req, off ? 'domain.disable' : 'domain.enable', 'domain', d.id, d.hostname);
    if (off) notify(d.owner_id, 'account', `${d.hostname} was switched off`, 'A Jhino super admin switched this domain off. Contact support if you think this is a mistake.', `/apps/${d.app_id}`);
    return { domain: view(loadDomain(d.id)!) };
  });
  app.delete('/api/admin/domains/:id', async (req) => {
    requireAdmin(req);
    const d = loadDomain((req.params as { id: string }).id);
    if (!d) throw new HttpError(404, 'NOT_FOUND', 'That domain is not connected.');
    try { await removeDomain(d); } catch (e) { throw new HttpError(502, 'CLOUDFLARE', `Could not remove it at Cloudflare: ${(e as Error).message}`); }
    audit(req, 'domain.remove', 'domain', d.id, d.hostname);
    notify(d.owner_id, 'account', `${d.hostname} was disconnected`, 'A Jhino super admin removed this custom domain from your app.', `/apps/${d.app_id}`);
    return { ok: true };
  });

  if (config.isProd && !cfMode() && !TARGET && !A_RECORD) console.warn('  [domains] Neither Cloudflare for SaaS (CF_API_TOKEN, CF_ZONE_ID) nor CUSTOM_DOMAIN_CNAME_TARGET / CUSTOM_DOMAIN_A_RECORD is set: custom domains cannot be verified.');
}
