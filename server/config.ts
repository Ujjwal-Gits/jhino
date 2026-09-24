import fs from 'node:fs';
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
if (!fs.existsSync(envPath) && !process.env.JHINO_SKIP_ENV_FILE) {
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

export const config = {
  port: Number(env.PORT || 4310),
  host: env.HOST || '127.0.0.1',
  dataDir: path.resolve(ROOT, env.DATA_DIR || './data'),
  publicUrl,
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' : publicUrl.startsWith('https://'),
  isProd: env.NODE_ENV === 'production',
  admin: {
    email: env.ADMIN_EMAIL || 'admin@jhino.local',
    name: env.ADMIN_NAME || 'Admin',
    password: env.ADMIN_PASSWORD || '',
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

fs.mkdirSync(config.dataDir, { recursive: true });
