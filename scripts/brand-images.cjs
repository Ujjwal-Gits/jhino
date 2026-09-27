// Renders Jhino's brand PNGs (favicon sizes, app icons, the share picture) from the SVGs in web/public/brand,
// in a real browser so they match the brand files exactly. Run: node scripts/brand-images.cjs
const fs = require('fs'), path = require('path');
const { chromium } = require('@playwright/test');
const root = path.join(__dirname, '..');
const brand = path.join(root, 'web', 'public', 'brand');
const icon = fs.readFileSync(path.join(brand, 'jhino-icon.svg'), 'utf8');
const rounded = fs.readFileSync(path.join(root, 'web', 'public', 'favicon.svg'), 'utf8');
const word = fs.readFileSync(path.join(brand, 'jhino-wordmark-white.svg'), 'utf8');
const font = (f) => 'data:font/woff2;base64,' + fs.readFileSync(require.resolve(`@fontsource-variable/schibsted-grotesk/files/${f}`)).toString('base64');

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const shot = async (html, w, h, file, transparent = false) => {
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${transparent ? 'transparent' : '#090b10'}}svg{display:block}</style></head><body>${html}</body></html>`);
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(brand, file), omitBackground: transparent });
  };
  const sized = (svg, s) => svg.replace('<svg ', `<svg width="${s}" height="${s}" `);
  // Square icons (full bleed, for iPhone and Android masks) and rounded ones (browser tabs, Google results).
  for (const s of [180, 192, 512]) await shot(sized(icon, s), s, s, `icon-${s}.png`);
  for (const s of [48, 96, 192, 512]) await shot(sized(rounded, s), s, s, `icon-${s}-round.png`, true);
  // The share picture: the wordmark and the promise, as on the website.
  await shot(`<div style="position:relative;width:1200px;height:630px;background:radial-gradient(ellipse at 70% 10%,rgba(102,98,197,.14),transparent 60%),#090b10;color:#f7f7fb;font-family:'SG',Arial,sans-serif;overflow:hidden">
    <style>@font-face{font-family:'SG';src:url(${font('schibsted-grotesk-latin-wght-normal.woff2')}) format('woff2');font-weight:400 900}</style>
    <div style="position:absolute;left:84px;top:72px;width:190px">${word.replace('<svg ', '<svg width="190" height="58" ')}</div>
    <div style="position:absolute;left:80px;top:196px;font-size:118px;font-weight:700;letter-spacing:-.07em;line-height:.99">Your HTML.<br>Out in the <span style="color:#e0461f">world.</span></div>
    <div style="position:absolute;left:86px;bottom:62px;font-size:26px;color:#acb1c0;letter-spacing:-.01em">Upload your HTML. Publish a live website. Share it.</div>
    <div style="position:absolute;right:84px;bottom:62px;font-size:26px;color:#f7f7fb;font-weight:600">jhino.com</div>
  </div>`, 1200, 630, 'og.png');
  await b.close();
  for (const f of fs.readdirSync(brand)) console.log(f.padEnd(28), fs.statSync(path.join(brand, f)).size);
})().catch((e) => { console.error(e); process.exit(1); });
