import { BlockList, isIP } from 'node:net';

/*
 * Who is the visitor? Jhino runs behind Cloudflare and a local proxy (Traefik on Coolify). Each proxy
 * adds the address it received the request from to X-Forwarded-For, so the chain is
 * "<anything the client wrote>, <client>, <Cloudflare edge>" with the socket being the local proxy.
 * We trust only hops that are local/private networks or Cloudflare's published ranges; the first
 * address past them is the visitor. Whatever the client wrote further left is ignored, so rate limits
 * and logged addresses cannot be spoofed with a header.
 */

// https://www.cloudflare.com/ips/ (stable for years; update if Cloudflare announces changes)
const CF_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20',
  '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'];
const CF_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];
const LOCAL_V4 = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16'];
const LOCAL_V6 = ['::1/128', 'fc00::/7', 'fe80::/10'];

const trusted = new BlockList();
for (const c of [...CF_V4, ...LOCAL_V4]) { const [a, p] = c.split('/'); trusted.addSubnet(a, Number(p), 'ipv4'); }
for (const c of [...CF_V6, ...LOCAL_V6]) { const [a, p] = c.split('/'); trusted.addSubnet(a, Number(p), 'ipv6'); }
// Extra proxies an install sits behind (comma-separated CIDRs), e.g. a load balancer's range.
for (const c of (process.env.TRUSTED_PROXIES ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
  const [a, p] = c.split('/');
  const v = isIP(a);
  if (v) trusted.addSubnet(a, Number(p ?? (v === 4 ? 32 : 128)), v === 4 ? 'ipv4' : 'ipv6');
}

/** Fastify's trustProxy: is this hop one of our proxies? */
export function trustHop(address: string): boolean {
  const a = address.startsWith('::ffff:') ? address.slice(7) : address;
  const v = isIP(a);
  return v === 4 ? trusted.check(a, 'ipv4') : v === 6 ? trusted.check(a, 'ipv6') : false;
}
