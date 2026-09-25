import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import { config, ROOT } from './config.js';
import { db } from './db.js';
import { registerAuth, bootstrapAdmin, HttpError } from './auth.js';
import { registerApps } from './apps.js';
import { registerData } from './data.js';
import { registerFiles } from './files.js';
import { registerBuilder } from './builder.js';
import { registerActivity } from './activity.js';
import { registerTrash } from './trash.js';
import { registerDesk } from './desk.js';
import { registerAccount } from './account.js';
import { registerOAuth } from './oauth.js';
import { registerBilling } from './billing.js';
import { registerSuperAdmin } from './superadmin.js';
import { registerPublicShare } from './publicshare.js';
import { registerLinks } from './links.js';
import { registerUsernames, ensureUsernames } from './usernames.js';
import { registerProfiles } from './profiles.js';
import { startPlanNotices } from './plans.js';
import { startBookingReminders } from './booking.js';
import { limit } from './security.js';
import { trustHop } from './clientip.js';
import { registerSiteAnalytics } from './analytics.js';
import { startAutoBackups } from './autobackup.js';
import { closeAllStreams } from './realtime.js';
import { stopVideo } from './video.js';

const app = Fastify({
  logger: {
    level: config.isProd ? 'info' : 'warn', redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]'],
    // Logged addresses keep their path only: tokens in ?token= and /run/<token>/ never reach the logs.
    serializers: { req: (r: { method: string; url: string; id?: string }) => ({ method: r.method, url: r.url.split('?')[0].replace(/^\/(run|s|u|invite|preview)\/[^/]+/, '/$1/…'), id: r.id }) },
  },
  bodyLimit: 8 * 1024 * 1024,
  // Only local proxies and Cloudflare are trusted to say who the visitor is (clientip.ts).
  trustProxy: (address: string) => trustHop(address),
  // On shutdown, idle keep-alive connections close at once; requests already running are allowed to finish.
  forceCloseConnections: 'idle',
  genReqId: () => Math.random().toString(36).slice(2, 10),
});

await app.register(cookie);
await app.register(multipart, { limits: { fileSize: config.limits.uploadBytes, files: 1, fields: 5 } });

app.setErrorHandler((err, req, reply) => {
  if (err instanceof HttpError) {
    return reply.code(err.status).send({ error: err.code, message: err.message, ...err.extra });
  }
  const e = err as { statusCode?: number; code?: string; message: string };
  if (e.statusCode && e.statusCode < 500) {
    const tooBig = e.statusCode === 413 || e.code === 'FST_REQ_FILE_TOO_LARGE';
    return reply.code(e.statusCode).send({ error: tooBig ? 'TOO_LARGE' : 'BAD_REQUEST', message: tooBig ? 'That file is too large.' : 'The request was not valid.' });
  }
  req.log.error(err);
  const disk = /ENOSPC|SQLITE_FULL/.test(String(e.code) + e.message);
  return reply.code(500).send({
    error: disk ? 'DISK_FULL' : 'SERVER_ERROR',
    message: disk ? 'The server is out of disk space. Nothing was saved.' : `Something went wrong on the server (ref ${req.id}).`,
  });
});

// Security headers for the Jhino pages themselves (uploaded apps get their own in /run).
app.addHook('onSend', async (req, reply) => {
  // Uploaded apps (/run), previews and Pro pages made from their own HTML (/p/…/custom) set their own sandbox.
  if (req.url.startsWith('/run/') || req.url.startsWith('/preview/') || /^\/p\/[^/?]+\/custom(\?|$)/.test(req.url)) return;
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'same-origin');
  if (!req.url.startsWith('/api/') && !req.url.startsWith('/_jhino/')) {
    reply.header('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    reply.header('X-Frame-Options', 'DENY');
  }
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (config.cookieSecure) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});

registerAuth(app);
registerDesk(app);
registerPublicShare(app);
registerLinks(app);
registerUsernames(app);
registerProfiles(app);
registerSiteAnalytics(app);

// Search engines: the website is public; dashboards, apps, links and the API are not for indexing.
app.get('/robots.txt', async (req, reply) => {
  const base = config.publicUrl || `${req.protocol}://${req.headers.host}`;
  reply.type('text/plain; charset=utf-8').header('Cache-Control', 'public, max-age=86400');
  return ['User-agent: *', 'Allow: /$', 'Allow: /pricing', 'Allow: /help', 'Allow: /terms', 'Allow: /privacy', 'Allow: /signup',
    'Disallow: /api/', 'Disallow: /run/', 'Disallow: /s/', 'Disallow: /apps', 'Disallow: /account', 'Disallow: /admin', 'Disallow: /invite/', 'Disallow: /go/', 'Disallow: /p/',
    '', `Sitemap: ${base}/sitemap.xml`, ''].join('\n');
});
app.get('/sitemap.xml', async (req, reply) => {
  const base = config.publicUrl || `${req.protocol}://${req.headers.host}`;
  const urls = ['/', '/pricing', '/help', '/signup', '/terms', '/privacy'];
  reply.type('application/xml; charset=utf-8').header('Cache-Control', 'public, max-age=86400');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${base}${u}</loc></url>`).join('\n')}\n</urlset>\n`;
});
startAutoBackups();
// A ceiling on changes from one address (sign-in, payments and links have their own, tighter limits).
app.addHook('onRequest', async (req) => {
  if (req.url.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) limit(req, 'api-write', Number(process.env.API_WRITES_PER_MIN) || 900, 60_000);
});
registerAccount(app);
registerOAuth(app);
registerBilling(app);
registerSuperAdmin(app);
registerApps(app);
registerData(app);
registerFiles(app);
registerBuilder(app);
registerActivity(app);
registerTrash(app);

// Fonts for built apps. They load from sandboxed (origin "null") frames, so they need CORS.
const FONTS = path.join(ROOT, 'runtime', 'fonts');
app.get('/_jhino/fonts/:name', async (req, reply) => {
  const name = (req.params as { name: string }).name;
  if (!/^[\w-]+\.woff2$/.test(name) || !fs.existsSync(path.join(FONTS, name))) return reply.code(404).send();
  reply.header('Content-Type', 'font/woff2').header('Access-Control-Allow-Origin', '*').header('Cache-Control', 'public, max-age=31536000, immutable');
  return fs.createReadStream(path.join(FONTS, name));
});

// Health checks (Docker, Coolify, load balancers): 200 when the server and the database answer.
const health = async () => {
  db.prepare('SELECT 1').get();
  return { ok: true };
};
app.get('/health', health);
app.get('/api/health', health);

// The built dashboard (npm run build). In development Vite serves it instead.
const webDir = path.join(ROOT, 'dist', 'web');
if (fs.existsSync(path.join(webDir, 'index.html'))) {
  // wildcard: serve whatever is in dist/web now, so a rebuild does not need a restart.
  await app.register(fstatic, {
    root: webDir, index: 'index.html', wildcard: true, prefix: '/', cacheControl: false,
    // Fingerprinted assets never change; the page itself is always fetched fresh.
    setHeaders: (res, file) => { res.header('Cache-Control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-store'); },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url.startsWith('/run/')) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Not found.' });
    }
    reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(fs.readFileSync(path.join(webDir, 'index.html'), 'utf8'));
  });
}

await bootstrapAdmin();
// Everyone who makes apps has a username (older accounts get one made from their email).
const named = ensureUsernames();
if (named) console.log(`  Gave ${named} account${named === 1 ? '' : 's'} a username.`);
startBookingReminders();
startPlanNotices();
if (config.isProd && !config.publicUrl.startsWith('https://')) {
  // Without it: session cookies are not marked Secure, no HSTS, and email links would follow the Host header.
  console.warn('  [security] PUBLIC_URL is not an https address. Set PUBLIC_URL=https://your-domain in the environment.');
}
if (!config.mail.resendKey && !config.mail.smtpUrl) console.warn('  [mail] No RESEND_API_KEY or SMTP_URL: emails (codes) are only logged for Super Admin.');
await app.listen({ port: config.port, host: config.host });
console.log(`  Jhino is running at ${config.publicUrl || `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`}`);

/**
 * SIGTERM (a redeploy) or Ctrl+C: stop taking new requests, let the ones already running finish,
 * end live streams, stop a video encode (it resumes next start), then close the database cleanly.
 */
let stopping = false;
const stop = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`  ${signal}: finishing requests in progress, then stopping.`);
  const force = setTimeout(() => {
    console.error('  Requests were still running after 25 seconds; stopping now.');
    try { db.close(); } catch { /* already closed */ }
    process.exit(1);
  }, 25_000);
  force.unref();
  stopVideo();
  closeAllStreams();
  try { await app.close(); } catch (e) { console.error('  Error while closing the server:', (e as Error).message); }
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* nothing to write back */ }
  db.close();
  console.log('  Stopped cleanly.');
  process.exit(0);
};
process.on('SIGINT', () => { void stop('SIGINT'); });
process.on('SIGTERM', () => { void stop('SIGTERM'); });
