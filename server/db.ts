import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { config } from './config.js';

export const db = new Database(path.join(config.dataDir, 'jhino.db'));
db.pragma('journal_mode = WAL');
// FULL: a write is on disk before we answer "Saved".
db.pragma('synchronous = FULL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users(
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions(
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE apps(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color INTEGER NOT NULL DEFAULT 0,
    owner_id TEXT NOT NULL REFERENCES users(id),
    live_version INTEGER NOT NULL DEFAULT 1,
    private_keys TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE TABLE app_versions(
    app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    n INTEGER NOT NULL,
    entry TEXT NOT NULL,
    file_count INTEGER NOT NULL,
    size INTEGER NOT NULL,
    features TEXT NOT NULL DEFAULT '{}',
    source_name TEXT NOT NULL,
    uploaded_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY(app_id, n)
  );
  CREATE TABLE memberships(
    app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
    added_at TEXT NOT NULL,
    PRIMARY KEY(app_id, user_id)
  );
  CREATE INDEX memberships_user ON memberships(user_id);
  CREATE TABLE invites(
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('editor','viewer')),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    used_by TEXT,
    revoked_at TEXT
  );
  CREATE INDEX invites_app ON invites(app_id);
  -- Key/value data: what an uploaded app keeps in localStorage (ns 'ls')
  -- or in window.storage (ns 'ws'). scope '' = shared, otherwise a user id.
  -- value NULL = deleted (kept so revisions keep counting up).
  CREATE TABLE kv(
    app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    ns TEXT NOT NULL,
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    rev INTEGER NOT NULL,
    updated_by TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(app_id, ns, scope, key)
  );
  CREATE TABLE records(
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    collection TEXT NOT NULL,
    data TEXT NOT NULL,
    rev INTEGER NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_by TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX records_list ON records(app_id, collection, created_at, id);
  CREATE TABLE idempotency(
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    record_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(user_id, key)
  );
  CREATE TABLE activity(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id TEXT REFERENCES apps(id) ON DELETE CASCADE,
    user_id TEXT,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    at TEXT NOT NULL
  );
  CREATE INDEX activity_app ON activity(app_id, id);
  `,
  `
  -- Per-launch tokens for the sandboxed app frame (cookie-free). Stored hashed.
  CREATE TABLE runs(
    token_hash TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    n INTEGER NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nonce TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `,
  `
  -- "Can add" role, app-scoped logins made by app owners, files, app schemas and builder configs.
  ALTER TABLE users ADD COLUMN created_by TEXT;
  ALTER TABLE app_versions ADD COLUMN manifest TEXT;
  ALTER TABLE app_versions ADD COLUMN builder TEXT;
  CREATE TABLE memberships2(
    app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('owner','editor','contributor','viewer')),
    added_at TEXT NOT NULL,
    PRIMARY KEY(app_id, user_id)
  );
  INSERT INTO memberships2 SELECT app_id, user_id, role, added_at FROM memberships;
  DROP TABLE memberships;
  ALTER TABLE memberships2 RENAME TO memberships;
  CREATE INDEX memberships_user ON memberships(user_id);
  CREATE TABLE invites2(
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('editor','contributor','viewer')),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    used_by TEXT,
    revoked_at TEXT
  );
  INSERT INTO invites2 SELECT id, app_id, token_hash, role, created_by, created_at, expires_at, used_at, used_by, revoked_at FROM invites;
  DROP TABLE invites;
  ALTER TABLE invites2 RENAME TO invites;
  CREATE INDEX invites_app ON invites(app_id);
  -- Files people upload inside apps. Bytes live in DATA_DIR/files/<app>/<id>.
  CREATE TABLE files(
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX files_app ON files(app_id, created_at);
  `,
  `
  -- Video compression: status while the smaller copy is made, the size before, and a version for caching.
  ALTER TABLE files ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
  ALTER TABLE files ADD COLUMN original_size INTEGER;
  ALTER TABLE files ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
  `,
  `
  -- Activity that points at the item it is about, so apps can show "who did what" and link to it.
  ALTER TABLE activity ADD COLUMN collection TEXT;
  ALTER TABLE activity ADD COLUMN record_id TEXT;
  ALTER TABLE activity ADD COLUMN kind TEXT;
  ALTER TABLE activity ADD COLUMN note TEXT;
  -- Newest activity line each member has seen in each app (for the unread count).
  ALTER TABLE memberships ADD COLUMN seen_activity INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- Trash inside an app: deleted items (with their comments) and files wait here until restored or deleted for good.
  CREATE TABLE trash(
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    collection TEXT,
    record_id TEXT NOT NULL,
    data TEXT,
    rev INTEGER,
    created_by TEXT,
    created_at TEXT,
    updated_by TEXT,
    updated_at TEXT,
    label TEXT NOT NULL DEFAULT '',
    parent TEXT,
    deleted_by TEXT,
    deleted_at TEXT NOT NULL
  );
  CREATE INDEX trash_app ON trash(app_id, deleted_at);
  ALTER TABLE files ADD COLUMN deleted_at TEXT;
  `,
  `
  -- Downloaded HTML files: each person signs in once from the file and gets a key for that one app (stored hashed).
  CREATE TABLE app_keys(
    key_hash TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
  );
  CREATE INDEX app_keys_user ON app_keys(user_id, app_id);
  -- Runs opened from a downloaded file may be framed by that file.
  ALTER TABLE runs ADD COLUMN desk INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- Accounts: profile, email verification, plans and usage.
  ALTER TABLE users ADD COLUMN display_name TEXT;
  ALTER TABLE users ADD COLUMN phone TEXT;
  ALTER TABLE users ADD COLUMN country TEXT;
  ALTER TABLE users ADD COLUMN timezone TEXT;
  ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
  ALTER TABLE users ADD COLUMN company TEXT;
  ALTER TABLE users ADD COLUMN job_title TEXT;
  ALTER TABLE users ADD COLUMN bio TEXT;
  ALTER TABLE users ADD COLUMN avatar TEXT;
  ALTER TABLE users ADD COLUMN email_verified_at TEXT;
  ALTER TABLE users ADD COLUMN password_set INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE users ADD COLUMN password_changed_at TEXT;
  ALTER TABLE users ADD COLUMN last_login_at TEXT;
  ALTER TABLE users ADD COLUMN last_login_ip TEXT;
  ALTER TABLE users ADD COLUMN last_login_ua TEXT;
  ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
  ALTER TABLE users ADD COLUMN plan_started_at TEXT;
  ALTER TABLE users ADD COLUMN plan_expires_at TEXT;
  ALTER TABLE users ADD COLUMN extra_creations INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN suspended_reason TEXT;
  ALTER TABLE users ADD COLUMN kind TEXT NOT NULL DEFAULT 'person';
  ALTER TABLE users ADD COLUMN notify_prefs TEXT NOT NULL DEFAULT '{}';
  -- Accounts made before this (by an admin or an invite) count as verified when their sign-in is an email.
  UPDATE users SET email_verified_at = created_at WHERE email LIKE '%@%';

  -- Sessions know their device, so people can see and end them.
  ALTER TABLE sessions ADD COLUMN ip TEXT;
  ALTER TABLE sessions ADD COLUMN ua TEXT;
  ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
  ALTER TABLE sessions ADD COLUMN auth_at TEXT;

  -- Single-use, short-lived links: verify email, reset password, confirm a new email. Stored hashed.
  CREATE TABLE auth_tokens(
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,
    data TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE INDEX auth_tokens_user ON auth_tokens(user_id, purpose);

  -- Sign-in with Google or Apple, linked to one account.
  CREATE TABLE identities(
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY(provider, subject)
  );
  CREATE TABLE oauth_states(
    state_hash TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    nonce TEXT NOT NULL,
    verifier TEXT NOT NULL,
    bind_hash TEXT NOT NULL,
    link_user TEXT,
    created_at TEXT NOT NULL
  );

  -- What happened to an account (sign-ins, password and email changes), for the person and for support.
  CREATE TABLE security_events(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    kind TEXT NOT NULL,
    ip TEXT,
    ua TEXT,
    detail TEXT NOT NULL DEFAULT '',
    at TEXT NOT NULL
  );
  CREATE INDEX security_events_user ON security_events(user_id, id);

  -- Every sensitive action by an administrator.
  CREATE TABLE audit_log(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT,
    actor_email TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    detail TEXT NOT NULL DEFAULT '',
    ip TEXT,
    at TEXT NOT NULL
  );

  -- In-app notifications (the bell).
  CREATE TABLE notifications(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    link TEXT,
    created_at TEXT NOT NULL,
    read_at TEXT
  );
  CREATE INDEX notifications_user ON notifications(user_id, id);

  -- Emails: sent by SMTP when it is set up, and always logged.
  CREATE TABLE email_outbox(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_addr TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT
  );

  -- Platform settings changed from Super Admin.
  CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  -- Installs that already hold uploaded files keep uploads on; new installs use links only.
  INSERT INTO settings(key, value) SELECT 'uploads', CASE WHEN EXISTS(SELECT 1 FROM files) THEN 'on' ELSE 'off' END;
  INSERT INTO settings(key, value) VALUES('signups', 'on');

  -- Payments: manual QR now, other providers later, all through the same records.
  CREATE TABLE payment_methods(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'manual_qr',
    bank TEXT,
    account_name TEXT,
    account_number TEXT,
    instructions TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    qr_file TEXT,
    qr_type TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE payments(
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    user_email TEXT NOT NULL,
    user_name TEXT NOT NULL,
    plan TEXT NOT NULL,
    amount INTEGER NOT NULL,
    expected_amount INTEGER NOT NULL,
    method_id TEXT,
    method_name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'manual_qr',
    reference TEXT,
    paid_on TEXT,
    note TEXT,
    proof_file TEXT,
    proof_type TEXT,
    status TEXT NOT NULL,
    reject_reason TEXT,
    internal_note TEXT,
    reviewed_by TEXT,
    reviewed_by_email TEXT,
    reviewed_at TEXT,
    ip TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX payments_user ON payments(user_id, created_at);
  CREATE INDEX payments_status ON payments(status, created_at);
  -- One row per plan granted. payment_id is unique, so one payment can never grant twice.
  CREATE TABLE subscriptions(
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    plan TEXT NOT NULL,
    creations INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    payment_id TEXT UNIQUE,
    source TEXT NOT NULL,
    granted_by TEXT,
    starts_at TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT NOT NULL
  );

  -- Help and support requests.
  CREATE TABLE support_tickets(
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    kind TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    diagnostics TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    closed_at TEXT
  );

  -- Sharing an app by link: private (people added), public, or password protected. Custom addresses (jhino.com/abc) by Super Admin.
  ALTER TABLE apps ADD COLUMN access TEXT NOT NULL DEFAULT 'private';
  ALTER TABLE apps ADD COLUMN public_role TEXT NOT NULL DEFAULT 'viewer';
  ALTER TABLE apps ADD COLUMN share_token TEXT;
  ALTER TABLE apps ADD COLUMN share_password_hash TEXT;
  ALTER TABLE apps ADD COLUMN slug TEXT;
  ALTER TABLE apps ADD COLUMN show_bar INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE apps ADD COLUMN visitor_id TEXT;
  UPDATE apps SET share_token = lower(hex(randomblob(10)));
  CREATE UNIQUE INDEX apps_share_token ON apps(share_token);
  CREATE UNIQUE INDEX apps_slug ON apps(slug COLLATE NOCASE);
  CREATE TABLE pub_sessions(
    token_hash TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    ip TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  -- Studio booking reminders already sent (so each is sent once).
  CREATE TABLE booking_reminders(
    app_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    fire_at TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    PRIMARY KEY(app_id, record_id, fire_at)
  );
  `,
  // 9: plans paid by the month or the year; short links (jhino.com/<code> to any web address).
  `
  ALTER TABLE users ADD COLUMN plan_period TEXT;
  ALTER TABLE payments ADD COLUMN period TEXT NOT NULL DEFAULT 'month';
  ALTER TABLE subscriptions ADD COLUMN period TEXT;
  CREATE TABLE short_links(
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    clicks INTEGER NOT NULL DEFAULT 0,
    last_click_at TEXT,
    disabled INTEGER NOT NULL DEFAULT 0,
    disabled_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX short_links_code ON short_links(code COLLATE NOCASE);
  CREATE INDEX short_links_owner ON short_links(owner_id, created_at);
  CREATE TABLE link_clicks(
    link_id TEXT NOT NULL REFERENCES short_links(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(link_id, day)
  );
  `,
  // 10: usernames; addresses live under them (jhino.com/<username>/<name>); a public page per person
  // (jhino.com/<username>) with its links and designs; page analytics; one-time email codes.
  `
  ALTER TABLE users ADD COLUMN username TEXT;
  CREATE UNIQUE INDEX users_username ON users(username COLLATE NOCASE);

  -- App addresses were one set of names for everyone; now each person has their own. Addresses made
  -- before this keep working at the top (root_slug), and also under the owner's username.
  ALTER TABLE apps ADD COLUMN root_slug TEXT;
  UPDATE apps SET root_slug = slug WHERE slug IS NOT NULL;
  DROP INDEX apps_slug;
  CREATE UNIQUE INDEX apps_root_slug ON apps(root_slug COLLATE NOCASE);
  CREATE UNIQUE INDEX apps_owner_slug ON apps(owner_id, slug COLLATE NOCASE);

  -- Short links too: old ones stay at the top (root = 1), new ones live under the username.
  ALTER TABLE short_links ADD COLUMN root INTEGER NOT NULL DEFAULT 0;
  UPDATE short_links SET root = 1;
  DROP INDEX short_links_code;
  CREATE UNIQUE INDEX short_links_owner_code ON short_links(owner_id, code COLLATE NOCASE);
  CREATE UNIQUE INDEX short_links_root_code ON short_links(code COLLATE NOCASE) WHERE root = 1;

  -- The public page.
  CREATE TABLE profiles(
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    bio TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    theme TEXT NOT NULL DEFAULT 'paper',
    layout TEXT NOT NULL DEFAULT 'links',
    socials TEXT NOT NULL DEFAULT '[]',
    published INTEGER NOT NULL DEFAULT 1,
    custom_html TEXT,
    use_custom INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE profile_items(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    type TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    subtitle TEXT NOT NULL DEFAULT '',
    url TEXT,
    text TEXT,
    app_id TEXT,
    highlight INTEGER NOT NULL DEFAULT 0,
    visible INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX profile_items_user ON profile_items(user_id, position);

  -- Page analytics, counted per day. Visitors are counted once a day from a daily-salted hash; the
  -- hashes are kept two days only.
  CREATE TABLE page_days(
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    visitors INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, day)
  );
  CREATE TABLE page_seen(user_id TEXT NOT NULL, day TEXT NOT NULL, visitor TEXT NOT NULL, PRIMARY KEY(user_id, day, visitor));
  CREATE TABLE item_days(
    item_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    clicks INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(item_id, day)
  );
  CREATE INDEX item_days_user ON item_days(user_id, day);
  CREATE TABLE page_dims(
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    dim TEXT NOT NULL,
    value TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, day, dim, value)
  );

  -- A 6-digit code sent with every email link (confirm email, reset password, change email).
  ALTER TABLE auth_tokens ADD COLUMN code_hash TEXT;
  ALTER TABLE auth_tokens ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
  `,
  // 11: username 30-day cooldown tracking
  `
  ALTER TABLE users ADD COLUMN username_changed_at TEXT;
  `,
];

const current = db.pragma('user_version', { simple: true }) as number;
for (let v = current; v < MIGRATIONS.length; v++) {
  db.transaction(() => {
    db.exec(MIGRATIONS[v]);
    db.pragma(`user_version = ${v + 1}`);
  })();
}

export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export type Role = 'owner' | 'editor' | 'contributor' | 'viewer';
export interface UserRow {
  id: string; email: string; name: string; password_hash: string;
  is_admin: number; disabled: number; created_at: string;
  created_by?: string | null;
  display_name?: string | null; phone?: string | null; country?: string | null; timezone?: string | null; language?: string;
  company?: string | null; job_title?: string | null; bio?: string | null; avatar?: string | null;
  email_verified_at?: string | null; password_set?: number; password_changed_at?: string | null;
  last_login_at?: string | null; last_login_ip?: string | null; last_login_ua?: string | null;
  plan?: string; plan_started_at?: string | null; plan_expires_at?: string | null; plan_period?: string | null; username?: string | null; extra_creations?: number;
  username_changed_at?: string | null;
  suspended_reason?: string | null; kind?: string; notify_prefs?: string;
}
export interface AppRow {
  id: string; name: string; color: number; owner_id: string; live_version: number;
  private_keys: string; created_at: string; updated_at: string; deleted_at: string | null;
  access?: string; public_role?: string; share_token?: string | null; share_password_hash?: string | null;
  slug?: string | null; root_slug?: string | null; show_bar?: number; visitor_id?: string | null;
}

export function roleOf(appId: string, userId: string): Role | null {
  const r = db.prepare('SELECT role FROM memberships WHERE app_id=? AND user_id=?').get(appId, userId) as { role: Role } | undefined;
  return r?.role ?? null;
}
/** Change any shared data. */
export const canWrite = (r: Role | null) => r === 'owner' || r === 'editor';
/** Add new records and files, and change what they added or are assigned to. */
export const canAdd = (r: Role | null) => r === 'owner' || r === 'editor' || r === 'contributor';

type ActivityListener = (row: { id: number; appId: string | null; userId: string | null; action: string; detail: string; at: string }) => void;
let activityListener: ActivityListener = () => {};
export const onActivity = (fn: ActivityListener) => { activityListener = fn; };

export interface ActivityExtra { collection?: string; recordId?: string; kind?: 'create' | 'update' | 'status' | 'delete' | 'comment' | 'vote' | 'file'; note?: string }

/** Collapse bursts of edits: one activity line per person, app and thing per minute. Comments are never collapsed. */
export function logActivity(appId: string | null, userId: string | null, action: string, detail = '', extra: ActivityExtra = {}) {
  const last = extra.kind === 'comment' ? undefined : db.prepare('SELECT id, at FROM activity WHERE app_id IS ? AND user_id IS ? AND action=? AND detail=? AND record_id IS ? ORDER BY id DESC LIMIT 1')
    .get(appId, userId, action, detail, extra.recordId ?? null) as { id: number; at: string } | undefined;
  if (last && Date.now() - Date.parse(last.at) < 60_000) {
    db.prepare('UPDATE activity SET at=? WHERE id=?').run(now(), last.id);
  } else {
    const at = now();
    const r = db.prepare('INSERT INTO activity(app_id,user_id,action,detail,at,collection,record_id,kind,note) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(appId, userId, action, detail, at, extra.collection ?? null, extra.recordId ?? null, extra.kind ?? null, extra.note ? extra.note.slice(0, 160) : null);
    activityListener({ id: Number(r.lastInsertRowid), appId, userId, action, detail, at });
  }
}
