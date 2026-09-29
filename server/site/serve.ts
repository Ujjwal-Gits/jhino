/* Serving a published website: its security rules and the few touches made when a page is sent. */

/** The rules a site page is served under: its own files and Jhino's, plus video and map embeds. */
export const siteCsp = (secure: boolean) => [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: https:", "font-src 'self'",
  "media-src 'self' https:", 'frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.google.com', "connect-src 'self'",
  "form-action 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'self'",
].join('; ') + (secure ? '; upgrade-insecure-requests' : '');

/** Serve-time touches: absolute addresses for link previews, canonical, robots, the credit line. */
export function finishSiteHtml(html: string, o: { origin: string; root: string; canonical?: string; noindex?: boolean; credit?: string; titleSuffix?: string }) {
  let h = html.replace(/%%ORIGIN%%/g, o.origin).replace(/%%ROOT%%/g, o.root);
  let extra = '';
  if (o.canonical && !/<link rel="canonical"/.test(h)) extra += `<link rel="canonical" href="${o.canonical.replace(/"/g, '%22')}">`;
  if (o.noindex) extra += '<meta name="robots" content="noindex">';
  if (extra) h = h.replace('<!--jhino:head-->', extra);
  if (o.titleSuffix) h = h.replace(/<title>([^<]*)<\/title>/, (_m, t) => `<title>${/\|\s*jhino\s*$/i.test(t) ? t : t + o.titleSuffix}</title>`);
  if (o.credit) { const b = h.lastIndexOf('</body>'); h = b >= 0 ? h.slice(0, b) + o.credit + h.slice(b) : h + o.credit; }
  return h;
}

