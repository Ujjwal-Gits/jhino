/**
 * Set the admin sign-in on a running install (for example from the Coolify terminal):
 *
 *   npm run admin -- --email super@example.com --password 'a long password'
 *   node dist/server/admin.js --email super@example.com --password '...' [--from old-admin@example.com]
 *
 * - If an account with the new email exists, it becomes an admin with the new password.
 * - Otherwise the existing admin (the one named in --from, or the only admin) is renamed to the new
 *   email, so every app it owns stays with it.
 * - Otherwise a new admin is created.
 * Every signed-in session and downloaded-file key of that account ends; it signs in again with the new password.
 * ADMIN_EMAIL / ADMIN_PASSWORD in the environment are only used for the very first start and are not changed here.
 */
import { db, type UserRow } from './db.js';
import { createUser, hashPassword, validateEmail, validatePassword } from './auth.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const fail = (msg: string): never => { console.error(`\n  ${msg}\n`); db.close(); process.exit(1); };

const emailIn = arg('email');
const passwordIn = arg('password') ?? process.env.NEW_ADMIN_PASSWORD;
if (!emailIn || !passwordIn) fail('Usage: node dist/server/admin.js --email you@example.com --password \'a long password\' [--from current-admin@example.com]');

let email = '', password = '';
try { email = validateEmail(emailIn); password = validatePassword(passwordIn); } catch (e) { fail((e as Error).message); }

const byEmail = (e: string) => db.prepare('SELECT * FROM users WHERE email=?').get(e) as UserRow | undefined;
const hash = await hashPassword(password);
let user = byEmail(email);
let what: string;

if (user) {
  db.prepare('UPDATE users SET password_hash=?, is_admin=1, disabled=0 WHERE id=?').run(hash, user.id);
  what = `Updated ${email}: admin, new password.`;
} else {
  const from = arg('from');
  const admins = db.prepare('SELECT * FROM users WHERE is_admin=1 AND disabled=0 ORDER BY created_at').all() as UserRow[];
  const target = from ? byEmail(from) : admins.length === 1 ? admins[0] : undefined;
  if (from && !target) fail(`No account with the email ${from}.`);
  if (!from && admins.length > 1) fail(`There are ${admins.length} admins (${admins.map((a) => a.email).join(', ')}). Say which one to rename with --from.`);
  if (target) {
    db.prepare('UPDATE users SET email=?, password_hash=?, is_admin=1, disabled=0 WHERE id=?').run(email, hash, target.id);
    what = `Renamed ${target.email} to ${email} with the new password. Its apps stay with it.`;
  } else {
    user = await createUser(email, 'Admin', password, true);
    what = `Created the admin ${email}.`;
  }
}

const id = (byEmail(email) as UserRow).id;
db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
db.prepare('DELETE FROM app_keys WHERE user_id=?').run(id);
db.close();
console.log(`\n  ${what}\n  Sign in with ${email} and the new password. Old sessions on that account were signed out.\n`);
