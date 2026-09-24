import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { config } from './config.js';
import { db, newId, now, type UserRow } from './db.js';
import { HttpError, requireAdmin, requireCreator, requireUser } from './auth.js';
import { baseUrl, mails } from './mail.js';
import { audit, imageType, limit } from './security.js';
import { PLANS, isPlan, notify, notifyAdmins, npr, usage, type PlanId } from './plans.js';

/*
 * Plans are paid by QR for now: the customer pays, uploads a screenshot, and a super admin approves.
 * Every provider (manual QR today; eSewa, Khalti, Fonepay later) writes to the same payments table,
 * and approving grants the plan through one function, exactly once per payment.
 */

const PROVIDERS = ['manual_qr', 'esewa', 'khalti', 'fonepay', 'bank', 'other'];
const qrDir = () => path.join(config.dataDir, 'system', 'qr');
const proofDir = () => path.join(config.dataDir, 'system', 'payments');

interface MethodRow { id: string; name: string; provider: string; bank: string | null; account_name: string | null; account_number: string | null; instructions: string; notes: string; qr_file: string | null; qr_type: string | null; active: number; position: number; created_at: string; updated_at: string }
interface PaymentRow { id: string; user_id: string | null; user_email: string; user_name: string; plan: PlanId; amount: number; expected_amount: number; method_id: string | null; method_name: string; provider: string; reference: string | null; paid_on: string | null; note: string | null; proof_file: string | null; proof_type: string | null; status: 'pending' | 'approved' | 'rejected'; reject_reason: string | null; internal_note: string | null; reviewed_by: string | null; reviewed_by_email: string | null; reviewed_at: string | null; ip: string | null; created_at: string }

const methodView = (m: MethodRow, admin = false) => ({
  id: m.id, name: m.name, provider: m.provider, bank: m.bank ?? '', accountName: m.account_name ?? '', accountNumber: m.account_number ?? '',
  instructions: m.instructions, notes: m.notes, hasQr: !!m.qr_file, qrVersion: m.updated_at, ...(admin ? { active: !!m.active, position: m.position, createdAt: m.created_at } : {}),
});
const paymentView = (p: PaymentRow, admin = false) => ({
  id: p.id, receiptNo: 'JH-' + p.id.slice(-8).toUpperCase(), plan: p.plan, planName: PLANS[p.plan]?.name ?? p.plan, creations: PLANS[p.plan]?.creations ?? 0,
  amount: p.amount, expectedAmount: p.expected_amount, method: p.method_name, provider: p.provider, reference: p.reference ?? '', paidOn: p.paid_on ?? '',
  note: p.note ?? '', hasProof: !!p.proof_file, status: p.status, rejectReason: p.reject_reason ?? '', createdAt: p.created_at, reviewedAt: p.reviewed_at,
  ...(admin ? { userId: p.user_id, userEmail: p.user_email, userName: p.user_name, internalNote: p.internal_note ?? '', reviewedBy: p.reviewed_by_email ?? '', ip: p.ip ?? '' } : {}),
});

function sendImage(reply: FastifyReply, file: string, type: string) {
  if (!fs.existsSync(file)) throw new HttpError(404, 'NOT_FOUND', 'Image not found.');
  reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "sandbox; default-src 'none'")
    .header('Content-Disposition', 'inline');
  return reply.type(type).send(fs.readFileSync(file));
}

/** Read one image upload (checked by its real bytes) plus plain fields. */
async function readImageForm(req: FastifyRequest, maxBytes: number) {
  const fields: Record<string, string> = {};
  let image: { buf: Buffer; type: 'image/png' | 'image/jpeg' | 'image/webp' } | null = null;
  const parts = req.parts({ limits: { fileSize: maxBytes, files: 1, fields: 12, fieldSize: 4000 } });
  for await (const part of parts) {
    if (part.type === 'file') {
      const f = part as MultipartFile;
      const buf = await f.toBuffer();
      if (f.file.truncated) throw new HttpError(413, 'TOO_LARGE', `The image can be up to ${Math.round(maxBytes / 1048576)} MB.`);
      if (!/\.(jpe?g|png|webp)$/i.test(f.filename || '')) throw new HttpError(400, 'VALIDATION_FAILED', 'Use a JPG, JPEG, PNG or WEBP image.');
      const type = imageType(buf);
      if (!type) throw new HttpError(400, 'VALIDATION_FAILED', 'That file is not a real JPG, PNG or WEBP image.');
      image = { buf, type };
    } else fields[part.fieldname] = String((part as { value?: unknown }).value ?? '');
  }
  return { fields, image };
}
const ext = (t: string) => (t === 'image/png' ? 'png' : t === 'image/webp' ? 'webp' : 'jpg');

/**
 * Grant a payment's plan. One transaction: the payment flips to approved only if it was not approved yet,
 * and the subscription row is unique per payment, so double clicks and two admins at once grant once.
 */
export function approvePayment(req: FastifyRequest, paymentId: string, note: string | null) {
  const admin = requireAdmin(req);
  const out = db.transaction(() => {
    const p = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId) as PaymentRow | undefined;
    if (!p) throw new HttpError(404, 'NOT_FOUND', 'That payment does not exist.');
    if (p.status === 'approved') return { already: true, p };
    const t = now();
    const changed = db.prepare("UPDATE payments SET status='approved', reviewed_by=?, reviewed_by_email=?, reviewed_at=?, reject_reason=NULL, internal_note=COALESCE(?, internal_note) WHERE id=? AND status<>'approved'")
      .run(admin.id, admin.email, t, note, paymentId).changes;
    if (!changed) return { already: true, p };
    const plan = PLANS[p.plan];
    db.prepare('INSERT INTO subscriptions(id,user_id,plan,creations,amount,payment_id,source,granted_by,starts_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(newId('sub'), p.user_id, p.plan, plan.creations, p.amount, p.id, p.provider, admin.id, t, t);
    if (p.user_id) db.prepare('UPDATE users SET plan=?, plan_started_at=?, plan_expires_at=NULL WHERE id=?').run(p.plan, t, p.user_id);
    return { already: false, p: db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId) as PaymentRow };
  })();
  if (!out.already) {
    const plan = PLANS[out.p.plan];
    audit(req, 'payment.approve', 'payment', paymentId, `${out.p.user_email} · ${plan.name} · ${npr(out.p.amount)}`);
    if (out.p.user_id) notify(out.p.user_id, 'billing', `Payment approved. Your plan is now active with up to ${plan.creations} creations.`, `${plan.name} · ${npr(out.p.amount)}`, '/account/plan',
      { kind: 'payment_approved', mail: mails.paymentApproved(out.p.user_name, plan.name, plan.creations, `${baseUrl(req)}/account/plan`) });
  }
  return out;
}

export function registerBilling(app: FastifyInstance) {
  /* ---------- for customers ---------- */
  app.get('/api/billing', async (req) => {
    const u = requireUser(req);
    const methods = (db.prepare('SELECT * FROM payment_methods WHERE active=1 ORDER BY position, updated_at DESC').all() as MethodRow[]).map((m) => methodView(m));
    const payments = (db.prepare('SELECT * FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(u.id) as PaymentRow[]).map((p) => paymentView(p));
    return { plans: Object.values(PLANS), usage: usage(u), methods, payments, pending: payments.some((p) => p.status === 'pending') };
  });

  app.get('/api/billing/methods/:id/qr', async (req, reply) => {
    const u = requireUser(req);
    const m = db.prepare('SELECT * FROM payment_methods WHERE id=?').get((req.params as { id: string }).id) as MethodRow | undefined;
    if (!m || !m.qr_file || (!m.active && !u.is_admin)) throw new HttpError(404, 'NOT_FOUND', 'No QR code.');
    return sendImage(reply, path.join(qrDir(), m.qr_file), m.qr_type || 'image/png');
  });

  app.post('/api/billing/payments', async (req) => {
    const u = requireCreator(req);
    limit(req, 'payment-submit', 6, 3600_000, u.id);
    const { fields, image } = await readImageForm(req, 10 * 1024 * 1024);
    const plan = fields.plan;
    if (!isPlan(plan) || plan === 'free') throw new HttpError(400, 'VALIDATION_FAILED', 'Choose a paid plan.');
    const amount = Math.round(Number(String(fields.amount).replace(/[, ]/g, '')));
    if (!Number.isFinite(amount) || amount < 1 || amount > 10_000_000) throw new HttpError(400, 'VALIDATION_FAILED', 'Enter the amount you paid, in NPR.');
    const m = db.prepare('SELECT * FROM payment_methods WHERE id=? AND active=1').get(fields.methodId) as MethodRow | undefined;
    if (!m) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose how you paid.');
    const paidOn = String(fields.paidOn || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || Number.isNaN(Date.parse(paidOn)) || Date.parse(paidOn) > Date.now() + 36 * 3600e3) throw new HttpError(400, 'VALIDATION_FAILED', 'Enter the date you paid.');
    if (!image) throw new HttpError(400, 'VALIDATION_FAILED', 'Upload a screenshot of the payment.');
    if (db.prepare("SELECT 1 FROM payments WHERE user_id=? AND status='pending'").get(u.id)) {
      throw new HttpError(409, 'ALREADY_PENDING', 'You already have a payment waiting for review. We will let you know soon.');
    }
    const id = newId('pay');
    const file = `${id}-${crypto.randomBytes(6).toString('hex')}.${ext(image.type)}`;
    fs.writeFileSync(path.join(proofDir(), file), image.buf, { flag: 'wx' });
    db.prepare(`INSERT INTO payments(id,user_id,user_email,user_name,plan,amount,expected_amount,method_id,method_name,provider,reference,paid_on,note,proof_file,proof_type,status,ip,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`).run(
      id, u.id, u.email, u.name, plan, amount, PLANS[plan].price, m.id, m.name, m.provider,
      String(fields.reference || '').trim().slice(0, 80) || null, paidOn, String(fields.note || '').trim().slice(0, 500) || null, file, image.type, req.ip, now());
    notify(u.id, 'billing', `Your payment of ${npr(amount)} has been submitted for verification.`, `${PLANS[plan].name} · ${m.name}`, '/account/billing',
      { kind: 'payment_submitted', mail: mails.paymentSubmitted(u.name, npr(amount), PLANS[plan].name) });
    notifyAdmins('billing', 'New payment verification request received.', `${u.name} · ${PLANS[plan].name} · ${npr(amount)}`, `/admin/payments/${id}`);
    return { payment: paymentView(db.prepare('SELECT * FROM payments WHERE id=?').get(id) as PaymentRow) };
  });

  function ownPayment(req: FastifyRequest) {
    const u = requireUser(req);
    const p = db.prepare('SELECT * FROM payments WHERE id=?').get((req.params as { id: string }).id) as PaymentRow | undefined;
    // Only the person who paid and super admins, and never through an app link or a downloaded file.
    if (!p || req.pub || req.desk || (p.user_id !== u.id && !u.is_admin)) throw new HttpError(404, 'NOT_FOUND', 'That payment does not exist.');
    return { u, p };
  }
  app.get('/api/billing/payments/:id', async (req) => {
    const { u, p } = ownPayment(req);
    return { payment: paymentView(p, !!u.is_admin && p.user_id !== u.id) };
  });
  app.get('/api/billing/payments/:id/proof', async (req, reply) => {
    const { p } = ownPayment(req);
    if (!p.proof_file || !/^[\w.-]+$/.test(p.proof_file)) throw new HttpError(404, 'NOT_FOUND', 'No screenshot.');
    return sendImage(reply, path.join(proofDir(), p.proof_file), p.proof_type || 'image/png');
  });

  /* ---------- for super admins ---------- */
  app.get('/api/admin/payments', async (req) => {
    requireAdmin(req);
    const q = req.query as { status?: string; q?: string };
    const status = ['pending', 'approved', 'rejected'].includes(String(q.status)) ? String(q.status) : null;
    const s = String(q.q ?? '').trim().toLowerCase();
    const rows = db.prepare(`SELECT * FROM payments WHERE (? IS NULL OR status=?) AND (? = '' OR lower(user_email) LIKE ? OR lower(user_name) LIKE ? OR lower(COALESCE(reference,'')) LIKE ?)
      ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 300`).all(status, status, s, `%${s}%`, `%${s}%`, `%${s}%`) as PaymentRow[];
    const counts = db.prepare('SELECT status, COUNT(*) n FROM payments GROUP BY status').all() as { status: string; n: number }[];
    return { payments: rows.map((p) => paymentView(p, true)), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
  });
  app.get('/api/admin/payments/:id', async (req) => {
    requireAdmin(req);
    const p = db.prepare('SELECT * FROM payments WHERE id=?').get((req.params as { id: string }).id) as PaymentRow | undefined;
    if (!p) throw new HttpError(404, 'NOT_FOUND', 'That payment does not exist.');
    const user = p.user_id ? db.prepare('SELECT * FROM users WHERE id=?').get(p.user_id) as UserRow | undefined : undefined;
    const history = db.prepare("SELECT actor_email actor, action, detail, at FROM audit_log WHERE target_type='payment' AND target_id=? ORDER BY id DESC").all(p.id);
    const earlier = p.user_id ? (db.prepare('SELECT * FROM payments WHERE user_id=? AND id<>? ORDER BY created_at DESC LIMIT 10').all(p.user_id, p.id) as PaymentRow[]).map((x) => paymentView(x, true)) : [];
    return { payment: paymentView(p, true), user: user ? { id: user.id, name: user.name, email: user.email, plan: usage(user), status: user.disabled ? 'suspended' : 'active' } : null, history, earlier };
  });
  app.post('/api/admin/payments/:id/approve', async (req) => {
    const b = (req.body ?? {}) as { note?: string };
    const r = approvePayment(req, (req.params as { id: string }).id, b.note ? String(b.note).slice(0, 1000) : null);
    return { already: r.already, payment: paymentView(r.p, true) };
  });
  app.post('/api/admin/payments/:id/reject', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { reason?: string; note?: string };
    const reason = String(b.reason ?? '').trim().slice(0, 500);
    if (reason.length < 5) throw new HttpError(400, 'VALIDATION_FAILED', 'Tell the customer why, in a sentence.');
    const admin = req.user!;
    const changed = db.prepare("UPDATE payments SET status='rejected', reject_reason=?, internal_note=COALESCE(?, internal_note), reviewed_by=?, reviewed_by_email=?, reviewed_at=? WHERE id=? AND status='pending'")
      .run(reason, b.note ? String(b.note).slice(0, 1000) : null, admin.id, admin.email, now(), id).changes;
    const p = db.prepare('SELECT * FROM payments WHERE id=?').get(id) as PaymentRow | undefined;
    if (!p) throw new HttpError(404, 'NOT_FOUND', 'That payment does not exist.');
    if (!changed) throw new HttpError(409, 'NOT_PENDING', p.status === 'approved' ? 'This payment is already approved.' : 'This payment was already reviewed.');
    audit(req, 'payment.reject', 'payment', id, `${p.user_email} · ${reason}`);
    if (p.user_id) notify(p.user_id, 'billing', 'Your payment could not be verified. Please review the reason and resubmit your payment proof.', reason, '/account/billing',
      { kind: 'payment_rejected', mail: mails.paymentRejected(p.user_name, reason, `${baseUrl(req)}/account/billing`) });
    return { payment: paymentView(p, true) };
  });
  app.post('/api/admin/payments/:id/note', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const note = String((req.body as { note?: string })?.note ?? '').slice(0, 1000);
    if (!db.prepare('UPDATE payments SET internal_note=? WHERE id=?').run(note || null, id).changes) throw new HttpError(404, 'NOT_FOUND', 'That payment does not exist.');
    audit(req, 'payment.note', 'payment', id, note.slice(0, 120));
    return { ok: true };
  });

  /* ---------- payment methods (QR) ---------- */
  function methodInput(b: Record<string, unknown>, partial: boolean) {
    const out: Record<string, unknown> = {};
    const str = (k: string, max: number, required = false) => {
      if (b[k] === undefined) { if (!partial && required) throw new HttpError(400, 'VALIDATION_FAILED', `Add the ${k === 'name' ? 'payment method name' : k}.`); return; }
      const s = String(b[k] ?? '').trim();
      if (required && !s) throw new HttpError(400, 'VALIDATION_FAILED', 'Add the payment method name.');
      if (s.length > max) throw new HttpError(400, 'VALIDATION_FAILED', `That is too long (up to ${max} characters).`);
      out[k] = s;
    };
    str('name', 60, true); str('bank', 80); str('accountName', 80); str('accountNumber', 60); str('instructions', 1500); str('notes', 500);
    if (b.provider !== undefined) { if (!PROVIDERS.includes(String(b.provider))) throw new HttpError(400, 'VALIDATION_FAILED', 'Unknown payment type.'); out.provider = String(b.provider); }
    if (b.active !== undefined) out.active = b.active ? 1 : 0;
    if (b.position !== undefined) out.position = Math.max(0, Math.min(999, Math.round(Number(b.position) || 0)));
    return out;
  }
  const cols: Record<string, string> = { name: 'name', bank: 'bank', accountName: 'account_name', accountNumber: 'account_number', instructions: 'instructions', notes: 'notes', provider: 'provider', active: 'active', position: 'position' };

  app.get('/api/admin/payment-methods', async (req) => {
    requireAdmin(req);
    return { methods: (db.prepare('SELECT * FROM payment_methods ORDER BY position, updated_at DESC').all() as MethodRow[]).map((m) => methodView(m, true)), providers: PROVIDERS };
  });
  app.post('/api/admin/payment-methods', async (req) => {
    requireAdmin(req);
    const v = methodInput((req.body ?? {}) as Record<string, unknown>, false);
    const id = newId('pm');
    const t = now();
    const pos = v.position ?? ((db.prepare('SELECT COALESCE(MAX(position),0)+1 n FROM payment_methods').get() as { n: number }).n);
    db.prepare('INSERT INTO payment_methods(id,name,provider,bank,account_name,account_number,instructions,notes,active,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, v.name, v.provider ?? 'manual_qr', v.bank ?? null, v.accountName ?? null, v.accountNumber ?? null, v.instructions ?? '', v.notes ?? '', v.active ?? 1, pos, t, t);
    audit(req, 'payment_method.create', 'payment_method', id, String(v.name));
    return { method: methodView(db.prepare('SELECT * FROM payment_methods WHERE id=?').get(id) as MethodRow, true) };
  });
  app.patch('/api/admin/payment-methods/:id', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const v = methodInput((req.body ?? {}) as Record<string, unknown>, true);
    const keys = Object.keys(v);
    if (keys.length) db.prepare(`UPDATE payment_methods SET ${keys.map((k) => `${cols[k]}=?`).join(', ')}, updated_at=? WHERE id=?`).run(...keys.map((k) => v[k]), now(), id);
    const m = db.prepare('SELECT * FROM payment_methods WHERE id=?').get(id) as MethodRow | undefined;
    if (!m) throw new HttpError(404, 'NOT_FOUND', 'That payment method does not exist.');
    audit(req, 'payment_method.update', 'payment_method', id, keys.join(', '));
    return { method: methodView(m, true) };
  });
  app.delete('/api/admin/payment-methods/:id', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const m = db.prepare('SELECT * FROM payment_methods WHERE id=?').get(id) as MethodRow | undefined;
    if (!m) throw new HttpError(404, 'NOT_FOUND', 'That payment method does not exist.');
    db.prepare('DELETE FROM payment_methods WHERE id=?').run(id);
    if (m.qr_file) fs.rmSync(path.join(qrDir(), m.qr_file), { force: true });
    audit(req, 'payment_method.delete', 'payment_method', id, m.name);
    return { ok: true };
  });
  app.post('/api/admin/payment-methods/:id/qr', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const m = db.prepare('SELECT * FROM payment_methods WHERE id=?').get(id) as MethodRow | undefined;
    if (!m) throw new HttpError(404, 'NOT_FOUND', 'That payment method does not exist.');
    const { image } = await readImageForm(req, 5 * 1024 * 1024);
    if (!image) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose the QR image.');
    const file = `${id}-${crypto.randomBytes(6).toString('hex')}.${ext(image.type)}`;
    fs.writeFileSync(path.join(qrDir(), file), image.buf, { flag: 'wx' });
    db.prepare('UPDATE payment_methods SET qr_file=?, qr_type=?, updated_at=? WHERE id=?').run(file, image.type, now(), id);
    if (m.qr_file) fs.rmSync(path.join(qrDir(), m.qr_file), { force: true });
    audit(req, m.qr_file ? 'payment_method.qr_replace' : 'payment_method.qr_upload', 'payment_method', id, m.name);
    return { method: methodView(db.prepare('SELECT * FROM payment_methods WHERE id=?').get(id) as MethodRow, true) };
  });
}
