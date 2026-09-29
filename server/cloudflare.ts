import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from './config.js';
import { secretKey } from './codes.js';
import { HttpError, requireAdmin } from './auth.js';
import { audit, limit, setting, setSetting } from './security.js';

/*
 * Cloudflare, set up from Super Admin. The owner pastes one API token; Jhino finds the zone and does the
 * rest of the one-time setup for custom domains itself:
 *   1. origin.<domain>  A record to this server (proxied), taken from the site's own A record
 *   2. cname.<domain>   CNAME to origin.<domain> (proxied): what customers point their domains at
 *   3. the fallback origin for Custom Hostnames
 *   4. a Configuration Rule that sets SSL to Full for customer domains (the zone itself stays as it is)
 * Every step says whether it worked and, when not, what to do by hand. The token is kept encrypted
 * (AES-256-GCM, with a key outside the database). Environment variables CF_API_TOKEN / CF_ZONE_ID still win.
 */
const API = 'https://api.cloudflare.com/client/v4';
const base = (() => { try { return new URL(config.publicUrl || 'https://jhino.com').hostname.replace(/^www\./, '').toLowerCase(); } catch { return 'jhino.com'; } })();
export const ORIGIN = `origin.${base}`, CNAME_TARGET = `cname.${base}`;
const RULE_REF = 'jhino_customer_domains_ssl';

function seal(plain: string) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', secretKey('cloudflare'), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}
function unseal(s: string) {
  try {
    const [iv, tag, body] = s.split('.').map((x) => Buffer.from(x, 'base64url'));
    const d = crypto.createDecipheriv('aes-256-gcm', secretKey('cloudflare'), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString('utf8');
  } catch { return ''; }
}

/** The token and zone in use: environment first, then what was saved from Super Admin (read once, then kept). */
type Creds = { token: string; zone: string; from: 'env' | 'admin' | null };
let creds: Creds | null = null;
export function cfCreds(): Creds {
  if (creds) return creds;
  if (process.env.CF_API_TOKEN && process.env.CF_ZONE_ID) return (creds = { token: process.env.CF_API_TOKEN, zone: process.env.CF_ZONE_ID, from: 'env' });
  const t = setting('cf_token'), z = setting('cf_zone');
  const token = t ? unseal(t) : '';
  return (creds = token && z ? { token, zone: z, from: 'admin' } : { token: '', zone: '', from: null });
}

async function call(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({})) as { success?: boolean; result?: any; errors?: { code: number; message: string }[] };
  return { ok: r.ok && j.success !== false, status: r.status, result: j.result, error: j.errors?.map((e) => `${e.message} (${e.code})`).join('; ') || (r.ok ? '' : `HTTP ${r.status}`) };
}

interface Step { key: string; label: string; ok: boolean; note: string }
async function runSetup(token: string): Promise<{ zone: string | null; steps: Step[] }> {
  const steps: Step[] = [];
  const add = (key: string, label: string, ok: boolean, note = '') => { steps.push({ key, label, ok, note }); return ok; };

  const v = await call(token, 'GET', '/user/tokens/verify');
  if (!add('token', 'API token works', v.ok && v.result?.status === 'active', v.ok ? '' : 'Cloudflare did not accept this token. Create it again and copy it straight away.')) return { zone: null, steps };

  const z = await call(token, 'GET', `/zones?name=${encodeURIComponent(base)}`);
  const zone = z.ok ? (z.result?.[0]?.id as string | undefined) : undefined;
  if (!add('zone', `Found the ${base} zone`, !!zone, zone ? '' : `The token cannot see ${base}. Under Zone Resources choose Include → Specific zone → ${base}.`)) return { zone: null, steps };

  const ch = await call(token, 'GET', `/zones/${zone}/custom_hostnames?per_page=1`);
  add('saas', 'Custom Hostnames is turned on', ch.ok, ch.ok ? '' : `Turn it on: ${base} → SSL/TLS → Custom Hostnames → Enable (it asks for a card; 100 domains are free). ${ch.error}`);

  // 1 + 2: DNS records. The server's address comes from the site's own A record.
  const site = await call(token, 'GET', `/zones/${zone}/dns_records?type=A&name=${encodeURIComponent(base)}`);
  const ip = process.env.CUSTOM_DOMAIN_ORIGIN_IP || (site.ok ? site.result?.[0]?.content as string | undefined : undefined);
  const ensure = async (type: 'A' | 'CNAME', name: string, content: string) => {
    const cur = await call(token, 'GET', `/zones/${zone}/dns_records?name=${encodeURIComponent(name)}`);
    if (!cur.ok) return cur;
    const same = (cur.result as { id: string; type: string; content: string; proxied: boolean }[]).find((r) => r.type === type);
    if (same && same.content === content && same.proxied) return { ok: true, error: '' };
    if ((cur.result as unknown[]).length && !same) return { ok: false, error: `${name} already exists with another record type; leave it or remove it first.` };
    return same ? call(token, 'PATCH', `/zones/${zone}/dns_records/${same.id}`, { type, name, content, proxied: true, ttl: 1 })
      : call(token, 'POST', `/zones/${zone}/dns_records`, { type, name, content, proxied: true, ttl: 1, comment: 'Jhino custom domains' });
  };
  const dnsHelp = 'Give the token Zone → DNS → Edit, or add the record by hand in DNS → Records.';
  if (ip) { const a = await ensure('A', ORIGIN, ip); add('origin', `${ORIGIN} → ${ip} (proxied)`, a.ok, a.ok ? '' : `${a.error}. ${dnsHelp}`); }
  else add('origin', `${ORIGIN} → this server`, false, `Could not read the server address from ${base}'s A record. Add ${ORIGIN} as an A record to the server's IP, proxied.`);
  const c = await call(token, 'GET', `/zones/${zone}/dns_records?name=${encodeURIComponent(ORIGIN)}`).then(() => ensure('CNAME', CNAME_TARGET, ORIGIN));
  add('cname', `${CNAME_TARGET} → ${ORIGIN} (proxied)`, c.ok, c.ok ? '' : `${c.error}. ${dnsHelp}`);

  // 3: fallback origin (needs Custom Hostnames on).
  const fb = await call(token, 'PUT', `/zones/${zone}/custom_hostnames/fallback_origin`, { origin: ORIGIN });
  add('fallback', `Fallback origin is ${ORIGIN}`, fb.ok, fb.ok ? (fb.result?.status && fb.result.status !== 'active' ? `Cloudflare says: ${fb.result.status}. It becomes active in a few minutes.` : '') : `${fb.error}. Set it by hand: SSL/TLS → Custom Hostnames → Fallback Origin → ${ORIGIN}.`);

  // 4: SSL Full for every host that is not the site itself (the zone keeps Full (strict)).
  const phase = `/zones/${zone}/rulesets/phases/http_config_settings/entrypoint`;
  const cur = await call(token, 'GET', phase);
  const rules = (cur.ok ? cur.result?.rules ?? [] : []) as { ref?: string; description?: string; expression: string; action: string; action_parameters?: unknown; enabled?: boolean }[];
  const mine = { ref: RULE_REF, description: 'Jhino: SSL Full for customer domains', expression: `(not http.host in {"${base}" "www.${base}"})`, action: 'set_config', action_parameters: { ssl: 'full' }, enabled: true };
  let rOk = cur.ok || cur.status === 404, rErr = rOk ? '' : cur.error;
  if (rOk && !rules.some((r) => r.ref === RULE_REF)) {
    const put = await call(token, 'PUT', phase, { rules: [...rules.map(({ ref, description, expression, action, action_parameters, enabled }) => ({ ref, description, expression, action, action_parameters, enabled })), mine] });
    rOk = put.ok; rErr = put.error;
  }
  add('ssl', 'SSL Full for customer domains (a Configuration Rule)', rOk, rOk ? '' : `${rErr}. Give the token Zone → Config Rules → Edit, or add it by hand: Rules → Configuration Rules → expression ${mine.expression} → SSL: Full.`);
  return { zone: zone ?? null, steps };
}

let onChange: (() => void) | null = null;
export const onCloudflareChange = (f: () => void) => { onChange = f; };

export function registerCloudflare(app: FastifyInstance) {
  app.get('/api/admin/cloudflare', async (req) => {
    requireAdmin(req);
    const c = cfCreds();
    let last: unknown = null; try { last = JSON.parse(setting('cf_setup') || 'null'); } catch { /* none yet */ }
    return { connected: !!c.token, from: c.from, zone: c.zone || null, base, origin: ORIGIN, target: CNAME_TARGET, last };
  });
  app.post('/api/admin/cloudflare', async (req) => {
    const u = requireAdmin(req);
    limit(req, 'cf-setup', 10, 600_000, u.id);
    const body = (req.body ?? {}) as { token?: unknown };
    const typed = String(body.token ?? '').trim();
    const token = typed || cfCreds().token;
    if (!token) throw new HttpError(400, 'VALIDATION_FAILED', 'Paste the Cloudflare API token.');
    if (typed && !/^[\w-]{30,120}$/.test(typed)) throw new HttpError(400, 'VALIDATION_FAILED', 'That does not look like a Cloudflare API token.');
    const r = await runSetup(token);
    if (r.zone && typed && cfCreds().from !== 'env') { setSetting('cf_token', seal(typed)); setSetting('cf_zone', r.zone); }
    const result = { at: new Date().toISOString(), steps: r.steps, ready: r.steps.every((s) => s.ok) };
    setSetting('cf_setup', JSON.stringify(result));
    audit(req, 'cloudflare.setup', 'settings', 'cloudflare', result.ready ? 'ready' : r.steps.filter((s) => !s.ok).map((s) => s.key).join(','));
    creds = null; onChange?.();
    return { ...result, connected: !!cfCreds().token, zone: cfCreds().zone || null };
  });
  app.delete('/api/admin/cloudflare', async (req) => {
    const u = requireAdmin(req);
    setSetting('cf_token', ''); setSetting('cf_zone', ''); setSetting('cf_setup', '');
    audit(req, 'cloudflare.disconnect', 'settings', 'cloudflare', '');
    creds = null; onChange?.();
    return { ok: true };
  });
}
