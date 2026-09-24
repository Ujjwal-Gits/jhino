/**
 * npm run backup  →  backups/<date-time>/{jhino.db, apps/, manifest.json}
 * Safe while Jhino is running: SQLite's online backup copies a consistent snapshot (WAL included).
 * Copy the backups folder to another disk or machine; a backup on the same disk does not survive losing that disk.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { db } from './db.js';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = path.resolve(ROOT, process.env.BACKUP_DIR || 'backups', stamp);
fs.mkdirSync(dir, { recursive: true });

await db.backup(path.join(dir, 'jhino.db'));

const src = path.join(config.dataDir, 'apps');
if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, 'apps'), { recursive: true });

// Check every published version's files made it into the backup.
const versions = db.prepare('SELECT app_id, n FROM app_versions').all() as { app_id: string; n: number }[];
const missing = versions.filter((v) => !fs.existsSync(path.join(dir, 'apps', v.app_id, `v${v.n}`)));
const counts = {
  users: (db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n,
  apps: (db.prepare('SELECT COUNT(*) n FROM apps').get() as { n: number }).n,
  versions: versions.length,
  kvKeys: (db.prepare('SELECT COUNT(*) n FROM kv WHERE value IS NOT NULL').get() as { n: number }).n,
  records: (db.prepare('SELECT COUNT(*) n FROM records').get() as { n: number }).n,
};
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), counts, missingVersions: missing }, null, 2));
db.close();

if (missing.length) {
  console.error(`Backup written to ${dir}, but ${missing.length} app version folder(s) were missing. See manifest.json.`);
  process.exit(1);
}
console.log(`Backup written to ${dir}`);
console.log(`  ${counts.apps} apps, ${counts.versions} versions, ${counts.users} people, ${counts.kvKeys} saved keys, ${counts.records} records`);
