import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db, newId, now, type UserRow } from './db.js';
import { HttpError, requireAdmin, requireCreator } from './auth.js';
import { audit, limit } from './security.js';
import { assertFeature, featuresOf } from './plans.js';
import { RESERVED, assertNameFree, baseFor, nameInUse, usernameOf, validSlug } from './publicshare.js';

/*
 * Short links: jhino.com/<username>/<code> sends the visitor on to any web address, and counts the
 * click. Codes share one set of names with the person's app addresses, so each address is one thing.
 * Links made before usernames keep working at jhino.com/<code> (root = 1).
 * Random codes on every plan; codes you name yourself on Plus and Pro; daily clicks on Pro.
 */

interface LinkRow { id: string; owner_id: string; root: number; code: string; url: string; title: string | null; clicks: number; last_click_at: string | null; disabled: number; disabled_reason: string | null; created_at: string; updated_at: string }

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function randomCode(len = 6) {
  const b = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}

/** Only ordinary web addresses: http(s), no credentials, not too long. */
function validTarget(raw: unknown, req: FastifyRequest) {
  let s = String(raw ?? '').trim();
  if (s && !/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  let u: URL;
  try { u = new URL(s); } catch { throw new HttpError(400, 'VALIDATION_FAILED', 'Enter a web address, like https://example.com/page.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, 'VALIDATION_FAILED', 'Short links can only go to http or https addresses.');
  if (u.username || u.password) throw new HttpError(400, 'VALIDATION_FAILED', 'Take the user name and password out of the address.');
  if (s.length > 2000) throw new HttpError(400, 'VALIDATION_FAILED', 'That address is too long (up to 2,000 characters).');
  // A link to another short link on this site would only loop.
  const here = new URL(baseFor(req));
  if (u.host === here.host) {
    const first = u.pathname.split('/').filter(Boolean);
    if (first.length === 1 && db.prepare('SELECT 1 FROM short_links WHERE code=? COLLATE NOCASE').get(first[0])) throw new HttpError(400, 'VALIDATION_FAILED', 'That is already a short link.');
  }
  return u.toString();
}

const view = (l: LinkRow, base: string, admin = false) => ({
  id: l.id, code: l.code, url: l.url, title: l.title ?? '', short: l.root ? `${base}/${l.code}` : `${base}/${usernameOf(l.owner_id) ?? '_'}/${l.code}`, clicks: l.clicks, lastClickAt: l.last_click_at,
  disabled: !!l.disabled, disabledReason: l.disabled_reason ?? '', createdAt: l.created_at, updatedAt: l.updated_at,
  ...(admin ? { ownerId: l.owner_id } : {}),
});

function own(req: FastifyRequest, id: string) {
  const u = requireCreator(req);
  const l = db.prepare('SELECT * FROM short_links WHERE id=?').get(id) as LinkRow | undefined;
  if (!l || (l.owner_id !== u.id && !u.is_admin)) throw new HttpError(404, 'NOT_FOUND', 'That link does not exist.');
  return { u, l };
}

function allowance(u: UserRow) {
  const f = featuresOf(u);
  const used = (db.prepare('SELECT COUNT(*) n FROM short_links WHERE owner_id=?').get(u.id) as { n: number }).n;
  return { used, limit: u.is_admin ? null : f.shortLinks, customCodes: f.customCodes, stats: f.linkStats };
}

/** The last 30 days of clicks, oldest first, with empty days as 0. */
function series(linkIds: string[], days = 30) {
  const out: { day: string; n: number }[] = [];
  const start = new Date(); start.setUTCHours(0, 0, 0, 0); start.setUTCDate(start.getUTCDate() - (days - 1));
  const rows = linkIds.length ? db.prepare(`SELECT day, SUM(n) n FROM link_clicks WHERE link_id IN (${linkIds.map(() => '?').join(',')}) AND day >= ? GROUP BY day`).all(...linkIds, start.toISOString().slice(0, 10)) as { day: string; n: number }[] : [];
  const by = new Map(rows.map((r) => [r.day, r.n]));
  for (let i = 0; i < days; i++) { const d = new Date(start); d.setUTCDate(start.getUTCDate() + i); const k = d.toISOString().slice(0, 10); out.push({ day: k, n: by.get(k) ?? 0 }); }
  return out;
}

export function registerLinks(app: FastifyInstance) {
  // jhino.com/<username>/<code> (and older jhino.com/<code>): send the visitor on. Runs before the website.
  const count = db.prepare('UPDATE short_links SET clicks=clicks+1, last_click_at=? WHERE id=?');
  const day = db.prepare('INSERT INTO link_clicks(link_id,day,n) VALUES(?,?,1) ON CONFLICT(link_id,day) DO UPDATE SET n=n+1');
  const findRoot = db.prepare('SELECT id, url FROM short_links WHERE root=1 AND code=? COLLATE NOCASE AND disabled=0');
  const findAt = db.prepare(`SELECT l.id, l.url FROM short_links l JOIN users u ON u.id=l.owner_id
    WHERE u.username=? COLLATE NOCASE AND l.root=0 AND l.code=? COLLATE NOCASE AND l.disabled=0 AND u.disabled=0`);
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return;
    const m = /^\/([A-Za-z0-9_-]{2,50})(?:\/([A-Za-z0-9-]{2,50}))?\/?(?:\?.*)?$/.exec(req.url);
    if (!m || RESERVED.has(m[1].toLowerCase())) return;
    const l = (m[2] ? findAt.get(m[1], m[2]) : findRoot.get(m[1])) as { id: string; url: string } | undefined;
    if (!l) return;
    if (req.method === 'GET') { const t = now(); db.transaction(() => { count.run(t, l.id); day.run(l.id, t.slice(0, 10)); })(); }
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'strict-origin-when-cross-origin').redirect(l.url, 302);
    return reply;
  });

  app.get('/api/links', async (req) => {
    const u = requireCreator(req);
    const rows = db.prepare('SELECT * FROM short_links WHERE owner_id=? ORDER BY created_at DESC LIMIT 1000').all(u.id) as LinkRow[];
    const base = baseFor(req);
    return { links: rows.map((l) => view(l, base)), allowance: allowance(u), host: `${base.replace(/^https?:\/\//, '')}/${u.username ?? ''}`.replace(/\/$/, '') };
  });

  app.post('/api/links', async (req) => {
    const u = requireCreator(req);
    limit(req, 'link-create', 60, 3600_000, u.id);
    const b = (req.body ?? {}) as { url?: string; code?: string; title?: string };
    const url = validTarget(b.url, req);
    const a = allowance(u);
    if (a.limit !== null && a.used >= a.limit) throw new HttpError(403, 'LIMIT_REACHED', `Your plan includes ${a.limit} short links and they are all in use. Delete one, or upgrade in Plan & usage.`);
    let code: string;
    if (b.code && String(b.code).trim()) {
      assertFeature(u, 'customCodes', 'Choosing your own short link name');
      code = validSlug(b.code);
      assertNameFree(u.id, code);
    } else {
      let n = 0;
      do { code = randomCode(n > 5 ? 8 : 6); n++; } while (nameInUse(u.id, code));
    }
    const id = newId('lnk');
    const t = now();
    db.transaction(() => {
      assertNameFree(u.id, code);
      db.prepare('INSERT INTO short_links(id,owner_id,code,url,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, u.id, code, url, String(b.title ?? '').trim().slice(0, 120) || null, t, t);
    })();
    return { link: view(db.prepare('SELECT * FROM short_links WHERE id=?').get(id) as LinkRow, baseFor(req)), allowance: allowance(u) };
  });

  app.patch('/api/links/:id', async (req) => {
    const { u, l } = own(req, (req.params as { id: string }).id);
    const b = (req.body ?? {}) as { url?: string; code?: string; title?: string };
    const sets: string[] = []; const args: unknown[] = [];
    if (b.url !== undefined) { sets.push('url=?'); args.push(validTarget(b.url, req)); }
    if (b.title !== undefined) { sets.push('title=?'); args.push(String(b.title).trim().slice(0, 120) || null); }
    if (b.code !== undefined && String(b.code).trim().toLowerCase() !== l.code.toLowerCase()) {
      assertFeature(u, 'customCodes', 'Choosing your own short link name');
      const code = validSlug(b.code);
      assertNameFree(l.owner_id, code, { linkId: l.id });
      sets.push('code=?'); args.push(code);
    }
    if (sets.length) db.prepare(`UPDATE short_links SET ${sets.join(', ')}, updated_at=? WHERE id=?`).run(...args, now(), l.id);
    return { link: view(db.prepare('SELECT * FROM short_links WHERE id=?').get(l.id) as LinkRow, baseFor(req)) };
  });

  app.delete('/api/links/:id', async (req) => {
    const { u, l } = own(req, (req.params as { id: string }).id);
    db.prepare('DELETE FROM short_links WHERE id=?').run(l.id);
    return { ok: true, allowance: allowance(u) };
  });

  app.get('/api/links/:id/stats', async (req) => {
    const { u, l } = own(req, (req.params as { id: string }).id);
    assertFeature(u, 'linkStats', 'Daily click history');
    return { clicks: l.clicks, days: series([l.id]) };
  });

  /* ---------- super admin: every link, and switching one off ---------- */
  app.get('/api/admin/links', async (req) => {
    requireAdmin(req);
    const s = String((req.query as { q?: string }).q ?? '').trim().toLowerCase();
    const rows = db.prepare(`SELECT l.*, u.email owner_email FROM short_links l JOIN users u ON u.id=l.owner_id
      WHERE (? = '' OR lower(l.code) LIKE ? OR lower(l.url) LIKE ? OR lower(u.email) LIKE ?) ORDER BY l.created_at DESC LIMIT 300`).all(s, `%${s}%`, `%${s}%`, `%${s}%`) as (LinkRow & { owner_email: string })[];
    const base = baseFor(req);
    return { links: rows.map((l) => ({ ...view(l, base, true), ownerEmail: l.owner_email })) };
  });
  app.patch('/api/admin/links/:id', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { disabled?: boolean; reason?: string };
    const l = db.prepare('SELECT * FROM short_links WHERE id=?').get(id) as LinkRow | undefined;
    if (!l) throw new HttpError(404, 'NOT_FOUND', 'That link does not exist.');
    db.prepare('UPDATE short_links SET disabled=?, disabled_reason=?, updated_at=? WHERE id=?').run(b.disabled ? 1 : 0, b.disabled ? String(b.reason ?? '').trim().slice(0, 200) || null : null, now(), id);
    audit(req, b.disabled ? 'link.disable' : 'link.enable', 'link', id, `/${l.code} → ${l.url.slice(0, 120)}${b.reason ? ' · ' + b.reason : ''}`);
    return { ok: true };
  });
}

export { series as clickSeries };
