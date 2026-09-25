import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

function findRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
}

export const ROOT = findRoot();

/** Readable random password: no look-alike characters. */
export function makePassword(len = 16): string {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += abc[bytes[i] % abc.length];
  return out.replace(/(.{4})(?=.)/g, '$1-');
}

const envPath = process.env.JHINO_ENV_FILE || path.join(ROOT, '.env');
// Local installs get a .env made for them. In a container (production) settings come from the environment
// and nothing is written to the app folder.
if (!fs.existsSync(envPath) && !process.env.JHINO_SKIP_ENV_FILE && process.env.NODE_ENV !== 'production') {
  const pw = makePassword();
  fs.writeFileSync(
    envPath,
    [
      '# Jhino settings. Keep this file private. It is listed in .gitignore.',
      'PORT=4310',
      'HOST=127.0.0.1',
      'DATA_DIR=./data',
      '# Set to your https address in production, e.g. https://apps.example.com',
      'PUBLIC_URL=',
      '# Used only once, when the database has no users yet.',
      'ADMIN_EMAIL=admin@jhino.local',
      'ADMIN_NAME=Admin',
      `ADMIN_PASSWORD=${pw}`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  console.log(`\n  Created ${envPath}\n  First admin login: admin@jhino.local / ${pw}\n`);
}
dotenv.config({ path: envPath, quiet: true });

const env = process.env;
const publicUrl = (env.PUBLIC_URL || '').replace(/\/+$/, '');
const dataDir = path.resolve(ROOT, env.DATA_DIR || './data');

export const config = {
  port: Number(env.PORT || 4310),
  host: env.HOST || '127.0.0.1',
  // Everything Jhino writes lives here: the database, uploaded apps, files, compressed videos, staging.
  dataDir,
  // Backups (npm run backup). Defaults to a folder inside the data volume, never the app folder.
  backupDir: path.resolve(ROOT, env.BACKUP_DIR || path.join(dataDir, 'backups')),
  publicUrl,
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' : publicUrl.startsWith('https://'),
  isProd: env.NODE_ENV === 'production',
  admin: {
    email: env.ADMIN_EMAIL || 'admin@jhino.local',
    name: env.ADMIN_NAME || 'Admin',
    password: env.ADMIN_PASSWORD || '',
  },
  // Email (verification, password reset, receipts). Without SMTP_URL, emails are only logged for Super Admin.
  mail: {
    smtpUrl: env.SMTP_URL || '',
    from: env.MAIL_FROM || 'Jhino <no-reply@jhino.local>',
    supportEmail: env.SUPPORT_EMAIL || '',
  },
  // Sign in with Google / Apple: shown only when these are set.
  oauth: {
    google: { clientId: env.GOOGLE_CLIENT_ID || '', clientSecret: env.GOOGLE_CLIENT_SECRET || '' },
    apple: { clientId: env.APPLE_CLIENT_ID || '', teamId: env.APPLE_TEAM_ID || '', keyId: env.APPLE_KEY_ID || '', privateKey: (env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n') },
  },
  limits: {
    uploadBytes: 60 * 1024 * 1024,
    unzippedBytes: 250 * 1024 * 1024,
    zipEntries: 3000,
    valueBytes: 5 * 1024 * 1024,
    appDataBytes: 100 * 1024 * 1024,
    recordBytes: 256 * 1024,
    fileBytes: Number(env.MAX_FILE_MB || 2048) * 1024 * 1024,
    // Videos bigger than this are re-encoded to a smaller H.264 MP4 in the background (0 = never).
    compressVideoBytes: Number(env.COMPRESS_VIDEO_MB ?? 20) * 1024 * 1024,
    appFilesBytes: Number(env.APP_STORAGE_GB || 50) * 1024 * 1024 * 1024,
  },
};

/**
 * Make the data folders and check this process can write to them. A volume mounted as root while the
 * app runs as a normal user is the usual cause of a failure here, so say exactly that and stop.
 */
/** "uid:gid" for the chown hint, or '' where there are no numeric ids (Windows). */
const ids = () => { try { const u = os.userInfo(); return u.uid >= 0 ? `${u.uid}:${u.gid}` : ''; } catch { return '1000:1000'; } };
function ensureWritable(dir: string, label: string) {
  const probe = path.join(dir, `.write-test-${process.pid}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
  } catch (e) {
    let who = 'this user';
    try { const u = os.userInfo(); who = `user "${u.username}" (uid ${u.uid}, gid ${u.gid})`; } catch { /* no passwd entry */ }
    console.error(`\n  Jhino cannot write to ${label}: ${dir}\n  ${(e as Error).message}\n` +
      `  It runs as ${who}. Give that user write access to the folder or volume` +
      (ids() ? `, for example:\n    chown -R ${ids()} ${dir}\n` : '.\n') +
      `  Or set ${label} to a folder it can write to.\n`);
    process.exit(1);
  }
}
ensureWritable(config.dataDir, 'DATA_DIR');
for (const sub of ['apps', 'files', 'staging', 'system/avatars', 'system/qr', 'system/payments']) fs.mkdirSync(path.join(config.dataDir, sub), { recursive: true });
ensureWritable(config.backupDir, 'BACKUP_DIR');
// Half-finished uploads from a previous run.
for (const n of fs.readdirSync(path.join(config.dataDir, 'staging'))) fs.rmSync(path.join(config.dataDir, 'staging', n), { recursive: true, force: true });
