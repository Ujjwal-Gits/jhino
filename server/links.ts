import crypto from 'node:crypto';
import { track } from './analytics.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db, newId, now, type UserRow } from './db.js';
import { HttpError, requireAdmin, requireCreator } from './auth.js';
import { audit, limit } from './security.js';
import { assertFeature, featuresOf } from './plans.js';
import { SYSTEM_PATHS, baseFor, usernameOf } from './publicshare.js';

/*
 * Short links: jhino.com/s-xxxxx sends the visitor on to any web address, and counts the click.
 * All newly generated short links are top-level domain/s-(random 5 letters).
 * Super admin can create and edit custom short codes under s- (4 to 5 characters).
 * Other users receive random unique 5 letters and cannot choose/edit codes or destination URLs.
 * Re-shortening an existing URL returns the user's existing link without consuming a new code.
 */

interface LinkRow { id: string; owner_id: string; root: number; code: string; url: string; title: string | null; clicks: number; last_click_at: string | null; disabled: number; disabled_reason: string | null; created_at: string; updated_at: string }

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
function randomLetters(len = 5): string {
  const b = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += LETTERS[b[i] % LETTERS.length];
  return s;
}

/** Check whether a code is already taken at the root level across all short links, apps, users, and system routes. */
export function isCodeInUse(code: string, exceptLinkId?: string): boolean {
  return !!db.prepare('SELECT 1 FROM short_links WHERE code=? COLLATE NOCASE AND id<>?').get(code, exceptLinkId ?? '')
    || !!db.prepare('SELECT 1 FROM apps WHERE root_slug=? COLLATE NOCASE').get(code)
    || !!db.prepare('SELECT 1 FROM users WHERE username=? COLLATE NOCASE').get(code)
    || SYSTEM_PATHS.has(code.toLowerCase());
}

/** Generates a unique short code in the form s-xxxxx (5 random letters). */
function generateUniqueShortCode(): string {
  for (let i = 0; i < 2000; i++) {
    const code = 's-' + randomLetters(5);
    if (!isCodeInUse(code)) return code;
  }
  throw new HttpError(500, 'SERVER_ERROR', 'Could not generate a unique short code.');
}

/** Normalizes and validates a super admin custom code. Must have 4 or 5 characters after s-. */
function normalizeAdminCode(raw: unknown): string {
  let s = String(raw ?? '').trim().toLowerCase();
  if (s.startsWith('s-')) s = s.slice(2);
  if (!/^[a-z0-9]{4,5}$/.test(s)) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Custom short code must be 4 or 5 letters/numbers after s- (e.g. s-sale or s-promo).');
  }
  return `s-${s}`;
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
  if (u.host === here.host || u.host === `www.${here.host}`) {
    const seg = u.pathname.split('/').filter(Boolean).map((x) => decodeURIComponent(x));
    const loop = seg[0] === 'go' || seg[0] === 'u'
      || (seg.length === 1 && db.prepare('SELECT 1 FROM short_links WHERE code=? COLLATE NOCASE').get(seg[0]))
      || (seg.length === 2 && db.prepare('SELECT 1 FROM short_links l JOIN users o ON o.id=l.owner_id WHERE l.code=? COLLATE NOCASE AND o.username=? COLLATE NOCASE').get(seg[1], seg[0]));
    if (loop) throw new HttpError(400, 'VALIDATION_FAILED', 'That is already a short link here. Link to where it goes instead.');
  }
  return u.toString();
}

const view = (l: LinkRow, base: string, admin = false) => ({
  id: l.id,
  code: l.code,
  url: l.url,
  title: l.title ?? '',
  short: l.code.startsWith('s-') || l.root ? `${base}/${l.code}` : `${base}/${usernameOf(l.owner_id) ?? '_'}/${l.code}`,
  clicks: l.clicks,
  lastClickAt: l.last_click_at,
  disabled: !!l.disabled,
  disabledReason: l.disabled_reason ?? '',
  createdAt: l.created_at,
  updatedAt: l.updated_at,
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
  return { used, limit: u.is_admin ? null : f.shortLinks, customCodes: !!u.is_admin, stats: f.linkStats };
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
  // jhino.com/s-xxxxx (and legacy jhino.com/<username>/<code>): send the visitor on. Runs before the website.
  const count = db.prepare('UPDATE short_links SET clicks=clicks+1, last_click_at=? WHERE id=?');
  const day = db.prepare('INSERT INTO link_clicks(link_id,day,n) VALUES(?,?,1) ON CONFLICT(link_id,day) DO UPDATE SET n=n+1');
  const findByCode = db.prepare('SELECT id, url FROM short_links WHERE code=? COLLATE NOCASE AND disabled=0');
  const findAt = db.prepare(`SELECT l.id, l.url FROM short_links l JOIN users u ON u.id=l.owner_id
    WHERE u.username=? COLLATE NOCASE AND l.code=? COLLATE NOCASE AND l.disabled=0 AND u.disabled=0`);

  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return;
    const m = /^\/([A-Za-z0-9_-]{2,50})(?:\/([A-Za-z0-9-]{2,50}))?\/?(?:\?.*)?$/.exec(req.url);
    if (!m || SYSTEM_PATHS.has(m[1].toLowerCase())) return;
    const l = (m[2] ? findAt.get(m[1], m[2]) : findByCode.get(m[1])) as { id: string; url: string } | undefined;
    if (!l) return;
    if (req.method === 'GET') {
      const t = now();
      db.transaction(() => { count.run(t, l.id); day.run(l.id, t.slice(0, 10)); })();
      track(req, { area: 'link', key: l.id, title: m[2] ? `/${m[1]}/${m[2]}` : `/${m[1]}`, ref: req.headers.referer });
    }
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'strict-origin-when-cross-origin').redirect(l.url, 302);
    return reply;
  });

  app.get('/api/links', async (req) => {
    const u = requireCreator(req);
    const rows = db.prepare('SELECT * FROM short_links WHERE owner_id=? ORDER BY created_at DESC LIMIT 1000').all(u.id) as LinkRow[];
    const base = baseFor(req);
    return { links: rows.map((l) => view(l, base)), allowance: allowance(u), host: base.replace(/^https?:\/\//, '').replace(/\/$/, '') };
  });

  app.post('/api/links', async (req) => {
    const u = requireCreator(req);
    limit(req, 'link-create', 60, 3600_000, u.id);
    const b = (req.body ?? {}) as { url?: string; code?: string; title?: string };
    const url = validTarget(b.url, req);

    // If this user already has an active short link for this exact address, return it (prevent duplicate codes and button spam)
    const existing = db.prepare('SELECT * FROM short_links WHERE owner_id=? AND url=? AND disabled=0 LIMIT 1').get(u.id, url) as LinkRow | undefined;
    if (existing) {
      return { link: view(existing, baseFor(req)), allowance: allowance(u), alreadyExists: true };
    }

    const a = allowance(u);
    if (a.limit !== null && a.used >= a.limit) throw new HttpError(403, 'LIMIT_REACHED', `Your plan includes ${a.limit} short links and they are all in use. Delete one, or upgrade in Plan & usage.`);

    let code: string;
    if (b.code && String(b.code).trim()) {
      if (!u.is_admin) throw new HttpError(403, 'FORBIDDEN', 'Only super admins can choose custom short codes.');
      code = normalizeAdminCode(b.code);
      if (isCodeInUse(code)) throw new HttpError(409, 'SLUG_TAKEN', `/${code} is already taken. Try another.`);
    } else {
      code = generateUniqueShortCode();
    }

    const id = newId('lnk');
    const t = now();
    db.transaction(() => {
      if (isCodeInUse(code)) throw new HttpError(409, 'SLUG_TAKEN', `/${code} is already taken.`);
      db.prepare('INSERT INTO short_links(id,owner_id,code,url,title,created_at,updated_at,root) VALUES(?,?,?,?,?,?,?,1)').run(id, u.id, code, url, String(b.title ?? '').trim().slice(0, 120) || null, t, t);
    })();
    return { link: view(db.prepare('SELECT * FROM short_links WHERE id=?').get(id) as LinkRow, baseFor(req)), allowance: allowance(u) };
  });

  app.patch('/api/links/:id', async (req) => {
    const { u, l } = own(req, (req.params as { id: string }).id);
    const b = (req.body ?? {}) as { url?: string; code?: string; title?: string };
    const sets: string[] = []; const args: unknown[] = [];

    if (b.title !== undefined) {
      sets.push('title=?');
      args.push(String(b.title).trim().slice(0, 120) || null);
    }

    if (b.url !== undefined && b.url.trim() !== l.url) {
      if (!u.is_admin) throw new HttpError(403, 'FORBIDDEN', 'Only super admin can change where a short link goes.');
      sets.push('url=?');
      args.push(validTarget(b.url, req));
    }

    if (b.code !== undefined && String(b.code).trim().toLowerCase() !== l.code.toLowerCase()) {
      if (!u.is_admin) throw new HttpError(403, 'FORBIDDEN', 'Only super admin can choose or edit custom short codes.');
      const code = normalizeAdminCode(b.code);
      if (isCodeInUse(code, l.id)) throw new HttpError(409, 'SLUG_TAKEN', `/${code} is already taken. Try another.`);
      sets.push('code=?');
      args.push(code);
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

  /* ---------- super admin: every link, editing url & code, and switching one off ---------- */
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
    const b = (req.body ?? {}) as { disabled?: boolean; reason?: string; url?: string; code?: string; title?: string };
    const l = db.prepare('SELECT * FROM short_links WHERE id=?').get(id) as LinkRow | undefined;
    if (!l) throw new HttpError(404, 'NOT_FOUND', 'That link does not exist.');

    const sets: string[] = [];
    const args: unknown[] = [];

    if (b.disabled !== undefined) {
      sets.push('disabled=?');
      args.push(b.disabled ? 1 : 0);
      sets.push('disabled_reason=?');
      args.push(b.disabled ? String(b.reason ?? '').trim().slice(0, 200) || null : null);
      audit(req, b.disabled ? 'link.disable' : 'link.enable', 'link', id, `/${l.code} → ${l.url.slice(0, 120)}${b.reason ? ' · ' + b.reason : ''}`);
    }

    if (b.url !== undefined && b.url.trim() !== l.url) {
      const newUrl = validTarget(b.url, req);
      sets.push('url=?');
      args.push(newUrl);
      audit(req, 'link.edit_url', 'link', id, `/${l.code} url: ${l.url} → ${newUrl}`);
    }

    if (b.code !== undefined && String(b.code).trim().toLowerCase() !== l.code.toLowerCase()) {
      const newCode = normalizeAdminCode(b.code);
      if (isCodeInUse(newCode, l.id)) throw new HttpError(409, 'SLUG_TAKEN', `/${newCode} is already taken. Try another.`);
      sets.push('code=?');
      args.push(newCode);
      audit(req, 'link.edit_code', 'link', id, `code: ${l.code} → ${newCode}`);
    }

    if (b.title !== undefined) {
      sets.push('title=?');
      args.push(String(b.title).trim().slice(0, 120) || null);
    }

    if (sets.length) {
      sets.push('updated_at=?');
      args.push(now());
      args.push(id);
      db.prepare(`UPDATE short_links SET ${sets.join(', ')} WHERE id=?`).run(...args);
    }

    return { ok: true, link: view(db.prepare('SELECT * FROM short_links WHERE id=?').get(id) as LinkRow, baseFor(req), true) };
  });
}

export { series as clickSeries };
