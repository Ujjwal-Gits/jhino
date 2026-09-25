import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';

/*
 * A copy of the database every day, while Jhino runs: BACKUP_DIR/auto/jhino-<date>.db, the last 14 kept.
 * SQLite's online backup copies a consistent snapshot. The database holds every account, app record,
 * payment and setting; uploaded app files live in DATA_DIR/apps and DATA_DIR/files (copy those with
 * `npm run backup`, or back up the whole volume). Turn off with AUTO_BACKUP=0.
 *
 * Restore: stop Jhino, copy a snapshot over DATA_DIR/jhino.db (and delete jhino.db-wal / -shm), start it.
 */
const KEEP = 14;
const DAY = 24 * 3600e3;

async function snapshot() {
  const dir = path.join(config.backupDir, 'auto');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `jhino-${new Date().toISOString().slice(0, 10)}.db`);
  if (fs.existsSync(file)) return;
  try {
    await db.backup(`${file}.part`);
    fs.renameSync(`${file}.part`, file);
    const all = fs.readdirSync(dir).filter((f) => /^jhino-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP))) fs.rmSync(path.join(dir, old), { force: true });
    console.log(`  [backup] database snapshot ${path.basename(file)}`);
  } catch (e) {
    fs.rmSync(`${file}.part`, { force: true });
    console.error('  [backup] snapshot failed:', (e as Error).message);
  }
}

export function startAutoBackups() {
  if (process.env.AUTO_BACKUP === '0') return;
  // A minute after start (not during it), then every day.
  setTimeout(() => { void snapshot(); setInterval(() => void snapshot(), DAY).unref(); }, 60_000).unref();
}
