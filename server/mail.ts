import nodemailer, { type Transporter } from 'nodemailer';
import type { FastifyRequest } from 'fastify';
import { config } from './config.js';
import { db, now } from './db.js';

/*
 * Account and security emails. With RESEND_API_KEY (Resend's HTTP API) or SMTP_URL set they are sent;
 * either way they are logged, so Super Admin can see what went out (and, without a sender, pass a code on).
 */

interface Outgoing { to: string; subject: string; text: string; html: string }
type Sender = { name: 'resend' | 'smtp'; send: (m: Outgoing) => Promise<void> };

function resendSender(key: string): Sender {
  return {
    name: 'resend',
    async send(m) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: config.mail.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) {
        // Resend answers {"name":"validation_error","message":"..."}; keep the message, never the key.
        const body = await r.json().catch(() => ({})) as { message?: string; name?: string };
        throw new Error(`Resend ${r.status}: ${body.message ?? body.name ?? r.statusText}`);
      }
    },
  };
}

let sender: Sender | null = null;
if (config.mail.resendKey) sender = resendSender(config.mail.resendKey);
else if (config.mail.smtpUrl) {
  try {
    const t: Transporter = nodemailer.createTransport(config.mail.smtpUrl);
    sender = { name: 'smtp', send: async (m) => { await t.sendMail({ from: config.mail.from, ...m }); } };
  } catch (e) { console.error('[mail] SMTP_URL is not valid:', (e as Error).message); }
}
export const mailReady = () => !!sender;
export const mailSender = () => sender?.name ?? null;

/** The public address of this Jhino, for links in emails. */
export function baseUrl(req?: FastifyRequest | null) {
  if (config.publicUrl) return config.publicUrl;
  if (req) return `${req.protocol}://${req.headers.host}`;
  return `http://localhost:${config.port}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface Mail {
  subject: string; lines: string[]; action?: { label: string; url: string }; footer?: string;
  /** A one-time code, shown large; `codeNote` says how long it works. */
  code?: string; codeNote?: string;
  /** The line email apps show next to the subject in the inbox. */
  preheader?: string;
  /** The heading inside the email, when it should differ from the subject. */
  title?: string;
}

/*
 * One layout for every email: tables and inline styles, because email apps ignore most modern CSS.
 * Paper and ink, one vermilion mark, the code set large in a monospace with generous spacing.
 */
export function renderMail(m: Mail) {
  const text = [
    ...m.lines,
    ...(m.code ? ['', `Your code: ${m.code}`, m.codeNote ?? ''] : []),
    ...(m.action ? ['', `${m.action.label}: ${m.action.url}`] : []),
    '', m.footer ?? 'You get this email because of your Jhino account.', '', 'Jhino · jhino.com',
  ].join('\n');
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif";
  const mono = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";
  const codeBox = m.code ? `<td style="padding:16px 22px 16px 30px;border:1px solid #d9d6cf;border-radius:12px;background:#faf8f4;font:600 34px/1 ${mono};letter-spacing:12px;color:#141414;-webkit-user-select:all;user-select:all;white-space:nowrap">${esc(m.code)}</td>` : '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(m.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f2ee;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(m.code ? `${m.code} is your code. ${m.preheader ?? ''}` : m.preheader ?? m.lines.find((l) => l && !/^Hi /.test(l)) ?? '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee"><tr><td align="center" style="padding:36px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 20px;font:700 20px/1 ${font};color:#141414;letter-spacing:-0.4px">jhino<span style="color:#e0461f">.</span></td></tr>
<tr><td style="background:#ffffff;border:1px solid #e6e4df;border-radius:14px;padding:32px 28px">
<h1 style="margin:0 0 16px;font:700 21px/1.3 ${font};color:#141414;letter-spacing:-0.3px">${esc(m.title ?? m.subject)}</h1>
${m.lines.map((l) => (l ? `<p style="margin:0 0 12px;font:15px/1.6 ${font};color:#3d3c39">${esc(l)}</p>` : '')).join('')}
${m.code ? `<p style="margin:22px 0 8px;font:600 12px/1 ${font};letter-spacing:1px;text-transform:uppercase;color:#75736e">Your code</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 10px"><tr>${codeBox}</tr></table>
<p style="margin:0 0 4px;font:13px/1.5 ${font};color:#75736e">Tap and hold the code (or double-click it) to copy it. ${esc(m.codeNote ?? '')}</p>` : ''}
${m.action ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px"><tr><td style="background:#141414;border-radius:8px"><a href="${esc(m.action.url)}" style="display:inline-block;padding:12px 20px;font:600 15px/1 ${font};color:#ffffff;text-decoration:none">${esc(m.action.label)}</a></td></tr></table>
<p style="margin:10px 0 0;font:12px/1.5 ${font};color:#75736e;word-break:break-all">${esc(m.action.url)}</p>` : ''}
</td></tr>
<tr><td style="padding:18px 6px 0;font:12px/1.6 ${font};color:#75736e">${esc(m.footer ?? 'You get this email because of your Jhino account.')}${m.code ? '<br>Never share this code. Jhino will never ask you for it.' : ''}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

/** Log and (when a sender is set) send. Never throws: a failed email must not fail the action. */
export function sendMail(to: string, kind: string, m: Mail) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return; // sign-in IDs are not email addresses
  const { text, html } = renderMail(m);
  // The log keeps no one-time code: Super Admin sees that it went out, not what it was.
  const logged = m.code ? text.split(m.code).join('••••••') : text;
  const id = Number(db.prepare('INSERT INTO email_outbox(to_addr,subject,body,kind,status,created_at) VALUES(?,?,?,?,?,?)')
    .run(to, m.code ? m.subject.split(m.code).join('••••••') : m.subject, sender ? logged : text, kind, sender ? 'sending' : 'not_sent', now()).lastInsertRowid);
  if (!sender) return;
  sender.send({ to, subject: m.subject, text, html })
    .then(() => db.prepare("UPDATE email_outbox SET status='sent', sent_at=? WHERE id=?").run(now(), id))
    .catch((e: Error) => { db.prepare("UPDATE email_outbox SET status='failed', error=? WHERE id=?").run(e.message.slice(0, 300), id); console.error('[mail]', kind, e.message); });
}

// Links in logged emails are only useful for a few days; keep the log, drop old bodies.
setInterval(() => db.prepare("UPDATE email_outbox SET body='' WHERE created_at < ? AND body <> ''").run(new Date(Date.now() - 14 * 864e5).toISOString()), 6 * 3600_000).unref();

/* ---------------- the emails ---------------- */
const CODE_NOTE = 'It works for 5 minutes. Asked again within that time, you get this same code.';
export const mails = {
  verify: (name: string, url: string, code?: string): Mail => ({
    subject: code ? `${code} is your Jhino code` : 'Confirm your email for Jhino',
    code, codeNote: CODE_NOTE, title: 'Confirm your email', preheader: 'Your code to confirm your email for Jhino.',
    lines: [`Hi ${name},`, code ? 'Enter this code to confirm your email and open your Jhino account.' : 'Please confirm this is your email address.'],
    action: code ? undefined : { label: 'Confirm email', url },
    footer: 'If you did not create a Jhino account, you can ignore this email.',
  }),
  reset: (name: string, url: string, code?: string): Mail => ({
    subject: code ? `${code} is your Jhino password reset code` : 'Reset your Jhino password',
    code, codeNote: CODE_NOTE, title: 'Reset your password', preheader: 'Your code to choose a new Jhino password.',
    lines: [`Hi ${name},`, 'Someone asked to reset the password for your Jhino account. Enter this code on the reset page to choose a new password.'],
    action: code ? undefined : { label: 'Choose a new password', url },
    footer: 'If this was not you, ignore this email. Your password stays the same.',
  }),
  passwordChanged: (name: string, device: string, url: string): Mail => ({
    subject: 'Your Jhino password was changed',
    lines: [`Hi ${name},`, `Your password was changed from ${device}. Other devices were signed out.`, 'If this was not you, reset your password now and contact support.'],
    action: { label: 'Reset password', url },
  }),
  emailChangeConfirm: (name: string, url: string, code?: string): Mail => ({
    subject: code ? `${code} confirms your new Jhino email` : 'Confirm your new email for Jhino',
    code, codeNote: CODE_NOTE, title: 'Confirm your new email', preheader: 'Your code to confirm your new email for Jhino.',
    lines: [`Hi ${name},`, 'Enter this code in Jhino to make this address the email for your account. Until then your old email stays in use.'],
    action: code ? undefined : { label: 'Confirm new email', url },
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
  methodChanged: (name: string, provider: string, email: string, added: boolean): Mail => ({
    subject: added ? `${provider} sign-in was added to your Jhino account` : `${provider} sign-in was removed from your Jhino account`,
    lines: [`Hi ${name},`, added ? `${provider}${email ? ' (' + email + ')' : ''} can now sign in to your Jhino account.` : `${provider} can no longer sign in to your Jhino account.`, 'If this was not you, change your password, remove it in Account → Security, and contact support.'],
  }),
  twoFactor: (name: string, on: boolean): Mail => ({
    subject: on ? 'Two-step sign-in is on for your Jhino account' : 'Two-step sign-in was turned off',
    lines: [`Hi ${name},`, on ? 'Signing in now also asks for a code from your authenticator app. Keep your recovery codes somewhere safe.' : 'Signing in no longer asks for a code from your authenticator app.', 'If this was not you, change your password and contact support right away.'],
  }),
  test: (to: string): Mail => ({
    subject: 'Jhino email is working',
    lines: ['Hi,', `This is a test from Jhino, sent to ${to}. Codes for sign-up, password reset and email change go out the same way.`],
    footer: 'Sent from Super Admin → Settings.',
  }),
};
