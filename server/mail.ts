import nodemailer, { type Transporter } from 'nodemailer';
import type { FastifyRequest } from 'fastify';
import { config } from './config.js';
import { db, now } from './db.js';

/*
 * Account and security emails. With SMTP_URL set they are sent; either way they are logged,
 * so Super Admin can see what went out (and, without SMTP, forward a link by hand).
 */

let transport: Transporter | null = null;
if (config.mail.smtpUrl) {
  try { transport = nodemailer.createTransport(config.mail.smtpUrl); } catch (e) { console.error('[mail] SMTP_URL is not valid:', (e as Error).message); }
}
export const mailReady = () => !!transport;

/** The public address of this Jhino, for links in emails. */
export function baseUrl(req?: FastifyRequest | null) {
  if (config.publicUrl) return config.publicUrl;
  if (req) return `${req.protocol}://${req.headers.host}`;
  return `http://localhost:${config.port}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface Mail { subject: string; lines: string[]; action?: { label: string; url: string }; footer?: string }

function render(m: Mail) {
  const text = [...m.lines, ...(m.action ? ['', `${m.action.label}: ${m.action.url}`] : []), '', m.footer ?? 'Jhino'].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f4;font:15px/1.55 -apple-system,'Helvetica Neue',Arial,sans-serif;color:#141414">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<p style="font-weight:700;font-size:18px;margin:0 0 24px">jhino<span style="color:#e0461f">.</span></p>
<div style="background:#fff;border:1px solid #e6e4df;border-radius:10px;padding:24px">
<h1 style="font-size:19px;margin:0 0 14px">${esc(m.subject)}</h1>
${m.lines.map((l) => (l ? `<p style="margin:0 0 12px">${esc(l)}</p>` : '')).join('')}
${m.action ? `<p style="margin:20px 0 6px"><a href="${esc(m.action.url)}" style="display:inline-block;background:#141414;color:#fff;text-decoration:none;padding:11px 18px;border-radius:7px;font-weight:600">${esc(m.action.label)}</a></p>
<p style="margin:10px 0 0;font-size:12px;color:#75736e;word-break:break-all">${esc(m.action.url)}</p>` : ''}
</div>
<p style="font-size:12px;color:#75736e;margin:18px 4px 0">${esc(m.footer ?? 'You get this email because of your Jhino account.')}</p>
</div></body></html>`;
  return { text, html };
}

/** Log and (when SMTP is set) send. Never throws: a failed email must not fail the action. */
export function sendMail(to: string, kind: string, m: Mail) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return; // sign-in IDs are not email addresses
  const { text, html } = render(m);
  const id = Number(db.prepare('INSERT INTO email_outbox(to_addr,subject,body,kind,status,created_at) VALUES(?,?,?,?,?,?)')
    .run(to, m.subject, text, kind, transport ? 'sending' : 'not_sent', now()).lastInsertRowid);
  if (!transport) return;
  transport.sendMail({ from: config.mail.from, to, subject: m.subject, text, html })
    .then(() => db.prepare("UPDATE email_outbox SET status='sent', sent_at=? WHERE id=?").run(now(), id))
    .catch((e: Error) => { db.prepare("UPDATE email_outbox SET status='failed', error=? WHERE id=?").run(e.message.slice(0, 300), id); console.error('[mail]', kind, e.message); });
}

// Links in logged emails are only useful for a few days; keep the log, drop old bodies.
setInterval(() => db.prepare("UPDATE email_outbox SET body='' WHERE created_at < ? AND body <> ''").run(new Date(Date.now() - 14 * 864e5).toISOString()), 6 * 3600_000).unref();

/* ---------------- the emails ---------------- */
export const mails = {
  verify: (name: string, url: string): Mail => ({
    subject: 'Confirm your email for Jhino',
    lines: [`Hi ${name},`, 'Welcome to Jhino. Please confirm this is your email address. The link works for 48 hours.'],
    action: { label: 'Confirm email', url },
    footer: 'If you did not create a Jhino account, you can ignore this email.',
  }),
  reset: (name: string, url: string): Mail => ({
    subject: 'Reset your Jhino password',
    lines: [`Hi ${name},`, 'Someone asked to reset the password for your Jhino account. The link works once, for 30 minutes.'],
    action: { label: 'Choose a new password', url },
    footer: 'If this was not you, ignore this email. Your password stays the same.',
  }),
  passwordChanged: (name: string, device: string, url: string): Mail => ({
    subject: 'Your Jhino password was changed',
    lines: [`Hi ${name},`, `Your password was changed from ${device}. Other devices were signed out.`, 'If this was not you, reset your password now and contact support.'],
    action: { label: 'Reset password', url },
  }),
  emailChangeConfirm: (name: string, url: string): Mail => ({
    subject: 'Confirm your new email for Jhino',
    lines: [`Hi ${name},`, 'Confirm this address to make it the email for your Jhino account. Until you do, your old email stays in use. The link works for 48 hours.'],
    action: { label: 'Confirm new email', url },
    footer: 'If you did not ask for this, ignore this email.',
  }),
  emailChangeRequested: (name: string, newEmail: string): Mail => ({
    subject: 'Someone asked to change your Jhino email',
    lines: [`Hi ${name},`, `A change of your account email to ${newEmail} was requested. It happens only if that address is confirmed.`, 'If this was not you, change your password and contact support.'],
  }),
  emailChanged: (name: string, newEmail: string): Mail => ({
    subject: 'Your Jhino email was changed',
    lines: [`Hi ${name},`, `The email for your Jhino account is now ${newEmail}.`, 'If this was not you, contact support right away.'],
  }),
  newLogin: (name: string, device: string, where: string, when: string): Mail => ({
    subject: 'New sign-in to your Jhino account',
    lines: [`Hi ${name},`, `Your account was signed in to from ${device}${where ? ' (' + where + ')' : ''} at ${when}.`, 'If this was you, there is nothing to do. If not, change your password and sign out other devices in Security.'],
  }),
  deleted: (name: string): Mail => ({
    subject: 'Your Jhino account was deleted',
    lines: [`Hi ${name},`, 'Your Jhino account and your apps have been deleted, as you asked. Payment records are kept for accounting, without your account.', 'Thank you for using Jhino.'],
  }),
  paymentSubmitted: (name: string, amount: string, plan: string): Mail => ({
    subject: 'Payment received for review',
    lines: [`Hi ${name},`, `Your payment of ${amount} for ${plan} has been submitted for verification. We will let you know as soon as it is reviewed.`],
  }),
  paymentApproved: (name: string, plan: string, creations: number, url: string): Mail => ({
    subject: 'Payment approved: your plan is active',
    lines: [`Hi ${name},`, `Your payment was verified. ${plan} is now active, with up to ${creations} creations.`],
    action: { label: 'See your plan', url },
  }),
  paymentRejected: (name: string, reason: string, url: string): Mail => ({
    subject: 'Your payment could not be verified',
    lines: [`Hi ${name},`, 'Your payment could not be verified.', `Reason: ${reason}`, 'Your current plan has not changed. You can send corrected payment proof.'],
    action: { label: 'Review and resubmit', url },
  }),
  bookingReminder: (name: string, text: string, url: string): Mail => ({
    subject: 'Booking reminder',
    lines: [`Hi ${name},`, text],
    action: { label: 'Open bookings', url },
  }),
  supportReceived: (kind: string, from: string, subject: string, message: string): Mail => ({
    subject: `Support: ${subject}`,
    lines: [`${kind} from ${from}`, message],
  }),
};
