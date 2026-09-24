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
}
export interface AppRow {
  id: string; name: string; color: number; owner_id: string; live_version: number;
  private_keys: string; created_at: string; updated_at: string; deleted_at: string | null;
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
