import { Fragment, useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import '../website.css';
import { ApiError, post } from '../api';
import { Link, useRoute } from '../context';
import { Wordmark } from '../Logo';
import { bestFreeMonths, freeMonthsText, nprAmount, planCard, usePlans, type PlanCard } from '../plans';
import heroImg from '../assets/landing/hero-file.webp';
import rojanImg from '../assets/landing/profile-rojan.webp';
import roshanImg from '../assets/landing/profile-roshan.webp';
import yunishImg from '../assets/landing/profile-yunish.webp';
import subashImg from '../assets/landing/profile-subash.webp';
import roshaniImg from '../assets/landing/profile-roshani.webp';
import alishImg from '../assets/landing/profile-alish.webp';

/*
 * The public website: home, help, terms and privacy, built from the Jhino Landing v3 design.
 * The markup keeps the design's own inline styles so every size, colour and spacing matches it;
 * website.css adds what inline styles cannot (hover states, fonts, keyframes, reduced motion).
 * Dark by default, with a light theme the visitor can pick (kept on their device).
 * The landing markup was converted from the design file (Jhino Landing.html) and wired to Jhino:
 * keep changes in step with the design.
 */

/* ---------------- theme, width and in-page links ---------------- */

type SiteTheme = 'dark' | 'light';
const THEME_KEY = 'jhino-site-theme';
const LIGHT = {
  '--bg': '#ffffff', '--ink': '#171818', '--mu': '#5d5f5b', '--line': '#e4e4e1', '--outl': '#c7c9c3', '--hdr': 'rgba(255,255,255,0.92)',
  '--soft': 'transparent', '--hov': '#f4f4f3', '--panel': '#f9f9f8', '--iconTile': '#2b1a15', '--chip': 'rgba(0,0,0,0.06)', '--em': '#c93b16', '--heroGlow': 'none', '--tog': '#ffffff',
} as CSSProperties;

function readSiteTheme(): SiteTheme {
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

function useViewportWidth() {
  const [vw, setVw] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);
  return vw;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function usePageMeta(title: string, description?: string) {
  useEffect(() => {
    document.title = title;
    if (description) {
      let meta = document.querySelector('meta[name="description"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'description');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', description);
    }
  }, [title, description]);
}

/** The site's few links: the rest of the page is one scroll away. */
const NAV: [string, string][] = [['Product', '/#how'], ['Features', '/#features'], ['My page', '/#mypage'], ['Plans', '/pricing'], ['Help', '/help']];

/** Header, footer and theme shared by every page of the website. */
function SiteFrame({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  const { go } = useRoute();
  const vw = useViewportWidth();
  const [theme, setTheme] = useState<SiteTheme>(readSiteTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const light = theme === 'light';

  useEffect(() => { try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ } }, [theme]);
  // The browser's own bar takes the page colour; the dashboard sets it back when it opens.
  useEffect(() => { document.querySelector('meta[name=theme-color]')?.setAttribute('content', light ? '#ffffff' : '#090b10'); }, [light]);
  useEffect(() => { if (vw >= 1120) setMenuOpen(false); }, [vw]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const showNav = vw >= 1120, showMenuBtn = vw < 1120, showHeaderCta = vw >= 560;
  const menuIcon = menuOpen ? 'M6 6l12 12M18 6 6 18' : 'M5 8h14M5 16h14';
  const themeIcon = light ? '☾' : '☀';
  const toggleTheme = () => setTheme(light ? 'dark' : 'light');
  const toggleMenu = () => setMenuOpen((o) => !o);
  const closeMenu = () => setMenuOpen(false);
  const start = signedIn ? '/apps' : '/signup';

  const toTop = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    setMenuOpen(false);
    if (location.pathname !== '/') { go('/'); return; }
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    if (location.hash) history.replaceState(null, '', '/');
  };

  // Links to a part of a page (#plans, /#how): glide there. From another page, open home at that part.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = (e.target as Element).closest?.('a')?.getAttribute('href') ?? '';
    const m = /^(\/?)#([\w-]+)$/.exec(href);
    if (!m) return;
    e.preventDefault();
    if (m[1] && location.pathname !== '/' && location.pathname !== '/pricing') { go(`/#${m[2]}`); return; }
    // After the phone menu has closed, so the page does not move under the scroll.
    requestAnimationFrame(() => document.getElementById(m[2])?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }));
    history.replaceState(null, '', `${location.pathname}#${m[2]}`);
  };

  return (
    <div className="jh-site" data-site-theme={theme} style={light ? LIGHT : undefined} onClick={onClick}>
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}><defs><linearGradient id="jhIconGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#e0461f"></stop><stop offset="1" stopColor="#ffffff"></stop></linearGradient></defs></svg>
      <div style={{ minHeight: '100vh', background: 'var(--bg,#090b10)', color: 'var(--ink,#f7f7fb)', overflowX: 'hidden', lineHeight: '1.6', transition: 'background .3s,color .3s' }}>
<header style={{ position: "sticky", top: "0", zIndex: "60", background: "var(--hdr,rgba(9,11,16,0.93))", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid var(--line,#2b303e)" }}>
  <div style={{ maxWidth: "1240px", margin: "0 auto", padding: "0 20px", height: "72px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "28px" }}>
    <a href="/" onClick={toTop} aria-label="Jhino, home" className="jh-logo" style={{ display: "flex", alignItems: "center", height: "33px", color: "var(--ink,#f7f7fb)" }}><Wordmark /></a>
    {showNav && (<><nav style={{ display: "flex", gap: "26px", whiteSpace: "nowrap", fontSize: "14px", alignItems: "center", flexWrap: "wrap" }}>
      {NAV.map(([label, href]) => (href.startsWith('/#') ? <a key={href} href={href}>{label}</a> : <Link key={href} to={href}>{label}</Link>))}
    </nav></>)}
    <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
      <button className="jh-h1" onClick={toggleTheme} aria-label="Toggle theme" style={{ width: "42px", height: "42px", borderRadius: "50%", border: "1px solid var(--outl,#394050)", background: "transparent", color: "var(--ink,#f7f7fb)", display: "grid", placeItems: "center", cursor: "pointer", fontSize: "15px" }}>{themeIcon}</button>
      {showHeaderCta && !signedIn && (<><Link to="/login" className="jh-signin" style={{ fontSize: "14px", fontWeight: "500", whiteSpace: "nowrap", padding: "0 4px" }}>Sign in</Link></>)}
      {showHeaderCta && (<><Link className="jh-h2" to={start} style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: "10px", padding: "10px 20px", minHeight: "42px", borderRadius: "100px", background: "#e0461f", color: "#ffffff", fontSize: "14px", fontWeight: "700", transition: "background .2s,transform .3s" }}>
        {signedIn ? 'Open dashboard' : 'Publish HTML'}
        <svg viewBox="0 0 24 24" style={{ width: "16px", height: "16px", stroke: "currentColor", fill: "none", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M12 17V3M7 8l5-5 5 5M4 16v5h16v-5"></path></svg>
      </Link></>)}
      {showMenuBtn && (<><button onClick={toggleMenu} aria-label="Menu" aria-expanded={menuOpen} style={{ width: "42px", height: "42px", borderRadius: "50%", border: "1px solid var(--outl,#394050)", background: "transparent", color: "var(--ink,#f7f7fb)", display: "grid", placeItems: "center", cursor: "pointer" }}><svg viewBox="0 0 24 24" style={{ width: "18px", height: "18px", stroke: "currentColor", fill: "none", strokeWidth: "1.8", strokeLinecap: "round" }}><path d={menuIcon}></path></svg></button></>)}
    </div>
  </div>
  {menuOpen && (<>
    <nav style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "8px 20px 22px", borderTop: "1px solid var(--line,#2b303e)", fontSize: "17px" }}>
      {NAV.map(([label, href]) => (href.startsWith('/#') ? <a key={href} href={href} onClick={closeMenu} style={{ padding: "12px 4px" }}>{label}</a> : <Link key={href} to={href} onClick={closeMenu} style={{ padding: "12px 4px" }}>{label}</Link>))}
      {!signedIn && <Link to="/login" onClick={closeMenu} style={{ padding: "12px 4px" }}>Sign in</Link>}
      <Link to={start} onClick={closeMenu} style={{ marginTop: "10px", display: "flex", justifyContent: "center", padding: "14px 20px", borderRadius: "100px", background: "#e0461f", color: "#ffffff", fontWeight: "700", fontSize: "15px" }}>{signedIn ? 'Open dashboard' : 'Publish HTML'}</Link>
    </nav>
  </>)}
</header>
<main id="main">{children}</main>
<footer style={{ background: "#08090b", color: "#b8c3d6", padding: "32px 24px" }}>
  <div style={{ maxWidth: "1240px", margin: "0 auto" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "24px", flexWrap: "wrap" }}>
      <a href="/" onClick={toTop} aria-label="Jhino, home" className="jh-logo" style={{ display: "flex", alignItems: "center", height: "33px", color: "#f3f5ef" }}><Wordmark /></a>
      <nav style={{ display: "flex", gap: "25px", flexWrap: "wrap", fontSize: "14px" }}>
        <Link to="/apps">Dashboard</Link><Link to="/links">Short links</Link><Link to="/pricing">Pricing</Link><Link to="/help">Help</Link><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link><a href="/sitemap">Sitemap</a>
      </nav>
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", gap: "18px", flexWrap: "wrap", marginTop: "24px", fontSize: "12px", color: "#959fb3" }}>
      <span>© 2026 Jhino. Made in Nepal.</span><span>For the things you make.</span>
    </div>
  </div>
</footer>
      </div>
    </div>
  );
}

/* ---------------- home ---------------- */

const TICKS = ['Video deliveries with approval', 'Photo proofing', 'Shoot schedule', 'Invoices and quotes', 'Content calendar'];
const TICK_ON = { bg: '#e0461f', border: '#e0461f', mark: '✓' }, TICK_OFF = { bg: '#ffffff', border: '#d4d4d4', mark: '' };
const files = [
  { name: 'studio-booking.html', meta: 'v1', color: '#e0461f' },
  { name: 'himalaya-coffee-portal.html', meta: 'v4', color: '#3b82f6' },
  { name: 'everest-trek-proofing.zip', meta: 'v2', color: '#8b5cf6' },
  { name: 'kathmandu-dental-site.zip', meta: 'v7', color: '#8b5cf6' },
  { name: 'patan-studio-invoices.html', meta: 'v3', color: '#3b82f6' },
];
const PICK = { Pick: { bg: '#e3f5ea', fg: '#157a45' }, Maybe: { bg: '#fdf1d8', fg: '#8a5a00' }, No: { bg: '#f3f3f3', fg: '#6b6b6b' } };
const photos = ([
  { name: 'IMG_0412.jpg', meta: 'Everest Trek Co.', pick: 'Pick', tone: '#c9b79a' },
  { name: 'IMG_0413.jpg', meta: 'Everest Trek Co.', pick: 'Maybe', tone: '#8ea3b5' },
  { name: 'IMG_0417.jpg', meta: 'Everest Trek Co.', pick: 'Pick', tone: '#a9b98a' },
  { name: 'IMG_0420.jpg', meta: 'Everest Trek Co.', pick: 'No', tone: '#b69488' },
] as const).map((p) => ({ ...p, ...PICK[p.pick] }));
const invoice = [{ item: 'Brand film — edit', amt: '60,000' }, { item: 'Colour grade', amt: '15,000' }, { item: 'Stills (40)', amt: '10,000' }];
const alsoChips = ['Shoots and production', 'Brand and content', 'Apps and websites', 'Working together'];
const log = [
  { t: '10:42', msg: 'Sita approved Brand film — cut 3' },
  { t: '10:41', msg: 'You uploaded a new version (v4)' },
  { t: '10:38', msg: 'Aarav marked 18 photos as Pick' },
  { t: '10:31', msg: 'Sita added a receipt with a photo' },
  { t: '10:24', msg: 'Invoice #104 marked paid' },
];
const people = [
  { name: 'You', role: 'Owner', access: 'Everything', bg: '#f1f1f1', fg: '#3a3a3a' },
  { name: 'Sita Gurung', role: 'Can edit', access: '● Signed in', bg: '#e3f5ea', fg: '#157a45' },
  { name: 'Aarav Shrestha', role: 'Can add', access: '● Signed in', bg: '#e3f5ea', fg: '#157a45' },
  { name: 'Bikash Rai', role: 'Can view', access: 'Invite sent', bg: '#fdf1d8', fg: '#8a5a00' },
  { name: 'Visitors', role: 'Can view', access: 'Public link', bg: '#e0461f', fg: '#ffffff' },
];
/** Real pages on Jhino: each card opens that person's page. */
const profiles = [
  { name: 'Rojan Shrestha', handle: 'rojan', role: 'Video editor', img: rojanImg },
  { name: 'Roshan Shrestha', handle: 'roshan', role: 'Founder', img: roshanImg },
  { name: 'yunishh', handle: 'yunish', role: 'Motion designer', img: yunishImg },
  { name: 'Subash Shrestha', handle: 'subash', role: 'Teacher', img: subashImg },
  { name: 'Roshani Shrestha', handle: 'roshani', role: 'Creator', img: roshaniImg },
  { name: 'Alish Karki', handle: 'alish', role: 'Photographer', img: alishImg },
].map((p) => ({ ...p, alt: `${p.name}'s Jhino profile page` }));
const clickBars = [38, 52, 44, 70, 58, 86, 100].map((h, i) => ({ h: `${Math.round(h * 0.4)}px`, c: i === 6 ? '#e0461f' : '#f3c4b3' }));

// Keep in step with FAQ in server/seo.ts: search engines are told these exact questions.
export const HOME_FAQ: [string, string][] = [
  ['What can I upload?', 'A single .html file, or a .zip with an index.html inside, made with Claude or any other tool. It is checked, stored as version 1 and opens straight away, visible only to you.'],
  ['Do my clients need an account?', 'They sign in with the ID and password you create for them, or through a single-use invite link. You can also share by a public link, or a password link on Plus and Pro.'],
  ['How do I pay for Plus or Pro?', 'Pick a plan, pay by QR and upload a screenshot of the payment. Once it is reviewed, your plan switches on. A year costs ten months.'],
  ['What happens when my plan ends?', 'You are told three days before. An ended plan counts as Free Forever, and your apps keep working.'],
  ['Do dates show in Nepali?', 'Yes. Dates show in Bikram Sambat with the AD date small beside them, or AD only if you pick that when creating the app.'],
];
export const PRICING_FAQ: [string, string][] = [
  ['How much does Jhino cost?', 'Jhino offers a Free Forever plan for one client app. Plus is NPR 500 a month (NPR 5,000 a year), and Pro is NPR 2,000 a month (NPR 20,000 a year).'],
  ['How do I pay for Plus or Pro?', 'Pick a plan, scan our QR code to pay in Nepali rupees (NPR), and upload a screenshot of your payment. We verify and activate your plan, usually the same day.'],
  ['Is there a discount for paying yearly?', 'Yes. Yearly billing costs 10 months instead of 12, giving you 2 full months free on both Plus and Pro.'],
  ['What happens when my plan ends?', 'You are notified three days before expiration. An ended plan automatically reverts to Free Forever, and all your apps continue working without interruption.'],
  ['Do my clients need to pay or create accounts?', 'No, your clients never pay. You control client access via direct sign-in credentials, single-use invite links, or password-protected links.'],
  ['Can my published apps show up on Google search?', 'Yes. Pro plans include up to 10 public pages indexed on Google, each with customizable SEO titles, descriptions, addresses, and keywords.'],
];
const SYNC: [string, string][] = [
  ['Never interrupts someone typing.', 'Apps that listen for changes update in place. Others refresh when the person pauses, and Jhino shows “Refresh now” instead of reloading while there is unsent text.'],
  ['New versions keep your data.', 'Upload a new version and everyone gets the new screens. Saved data is kept, and older versions stay under Details → Versions.'],
  ['Big videos are made smaller.', 'Large videos are re-encoded in the background. The original keeps playing while this runs, and is only replaced if the new file is at least 10% smaller.'],
];

const PLAN_FOR: Record<string, string> = { free: 'Your first step onto the web.', plus: 'For a growing collection of client apps.', pro: 'For studios running many clients at once.' };
const count = (n: number, one: string, many = `${one}s`) => `${nprAmount(n)} ${n === 1 ? one : many}`;

/** A plan as the design shows it: prices and limits come live from the server; each card lists what it adds. */
function planView(p: PlanCard, prev: PlanCard | undefined, yearly: boolean, signedIn: boolean) {
  const f = p.f, g = prev?.f;
  const paid = p.monthly > 0;
  const period = yearly ? 'year' : 'month';
  const designs = f.themeTier === 'pro' ? `All 40 designs${f.customPage ? ' or your own HTML' : ''}` : f.themeTier === 'plus' ? '15 designs for your page' : 'Link-in-bio page with 5 designs';
  const days = f.analyticsDays >= 365 ? 'A year of analytics' : `${f.analyticsDays} days of analytics`;
  const items = [
    `${count(p.apps, 'app')} · ${count(f.addresses, 'address', 'addresses')}`,
    `${count(f.shortLinks, 'short link')}${f.customCodes && !g?.customCodes ? ' with names you choose' : ''}`,
    ...(!prev ? ['Create HTML and Upload HTML', designs, days] : []),
    ...(f.passwordLinks && !g?.passwordLinks ? ['Password links'] : []),
    ...(f.hideBar && !g?.hideBar ? ['Hide the Jhino top bar'] : []),
    ...(f.download && !g?.download ? ['Download as HTML file'] : []),
    ...(f.linkStats && !g?.linkStats ? ['Daily click history'] : []),
    ...(prev && f.themeTier === 'pro' && g?.themeTier !== 'pro' ? [designs] : []),
    ...(prev && f.analyticsDays >= 365 && (g?.analyticsDays ?? 0) < 365 ? [days] : []),
  ];
  const featured = p.id === 'plus';
  return {
    name: p.name, for: PLAN_FOR[p.id] ?? p.blurb, featured, items,
    price: nprAmount(paid ? (yearly ? p.yearly : p.monthly) : 0),
    per: !paid ? '/ forever' : yearly ? '/ year' : '/ month',
    note: !paid ? 'No card. No time limit.' : yearly ? `NPR ${nprAmount(p.yearly)} total, billed yearly.` : `Or NPR ${nprAmount(p.yearly)} billed yearly.`,
    cta: !paid ? (signedIn ? 'See your plan' : 'Start free') : `Get ${p.name}`,
    href: signedIn ? (paid ? `/account/plan?choose=${p.id}&period=${period}` : '/account/plan') : (paid ? `/signup?plan=${p.id}&period=${period}` : '/signup'),
    border: featured ? 'rgba(224,70,31,0.55)' : 'var(--line,#2b303e)',
    ctaBg: featured ? '#e0461f' : 'transparent', ctaColor: featured ? '#ffffff' : 'var(--ink,#f7f7fb)', ctaBorder: featured ? '#e0461f' : 'var(--outl,#363d4d)',
  };
}

/** Open-one-at-a-time lists (questions, live sync), as the design's accordions. */
function accordion<T>(list: T[], open: number, setOpen: (f: (n: number) => number) => void) {
  return list.map((it, i) => ({ ...it, open: open === i, rot: open === i ? '180deg' : '0deg', toggle: () => setOpen((n) => (n === i ? -1 : i)) }));
}

export function Landing({ signedIn = false, at }: { signedIn?: boolean; at?: string }) {
  usePageMeta(
    'Publish your HTML as a live website | Jhino',
    'Upload an HTML file or ZIP to publish a live website instantly. Share with clients, sync saves live, create a link-in-bio page and short links. Start free.'
  );
  const vw = useViewportWidth();
  const notMobile = vw >= 640;
  // jhino.com/pricing opens at the plans; jhino.com/#faq at the questions.
  useEffect(() => {
    const id = at ?? location.hash.slice(1);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, [at]);

  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [faq, setFaq] = useState(0);
  const [sync, setSync] = useState(0);
  const [tickState, setTicks] = useState([1, 1, 0, 1, 0]);
  const [longUrl, setLongUrl] = useState('https://www.youtube.com/watch?v=q8Zt2Lw4pXk&list=PLh7-brand-film-2026');
  const [slug, setSlug] = useState('brand-film');
  const [copied, setCopied] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const live = usePlans();

  const yearly = billing === 'yearly';
  const on = { bg: 'var(--tog,#262c3a)', c: 'var(--ink,#f7f7fb)' }, off = { bg: 'transparent', c: 'var(--mu,#acb1c0)' };
  const setMonthly = () => setBilling('monthly'), setYearly = () => setBilling('yearly');
  const mBg = yearly ? off.bg : on.bg, mColor = yearly ? off.c : on.c;
  const yBg = yearly ? on.bg : off.bg, yColor = yearly ? on.c : off.c;
  const months = freeMonthsText(bestFreeMonths(live));
  const yearlyLabel = months ? `Yearly · ${months}` : 'Yearly';
  const plans = live.map((p, i) => planView(p, live[i - 1], yearly, signedIn));
  const [free, plus, pro] = [planCard(live, 'free'), planCard(live, 'plus'), planCard(live, 'pro')];
  const linksText = `Free gives you ${nprAmount(free.shortLinks)} short links. Plus gives ${nprAmount(plus.shortLinks)} with names you pick, and Pro gives ${nprAmount(pro.shortLinks)}.`;
  const span = (d: number, unit = '') => (d >= 365 ? 'a year' : `${d}${unit}`);
  const statsText = `Views, visitors, clicks, referrers, devices and countries: ${span(free.f.analyticsDays, ' days')} on Free, ${span(plus.f.analyticsDays)} on Plus, ${span(pro.f.analyticsDays)} on Pro.`;

  const faqs = accordion(HOME_FAQ.map(([q, a]) => ({ q, a })), faq, setFaq);
  const syncItems = accordion(SYNC.map(([title, body]) => ({ title, body })), sync, setSync);
  const ticks = TICKS.map((name, i) => {
    const v = !!tickState[i];
    const toggle = () => setTicks((s) => s.map((x, j) => (j === i ? (x ? 0 : 1) : x)));
    const key = (e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } };
    return { name, checked: v, ...(v ? TICK_ON : TICK_OFF), toggle, key };
  });

  const scrollRow = (dir: number) => {
    const el = rowRef.current;
    if (!el) return;
    const card = el.firstElementChild;
    const w = card ? card.getBoundingClientRect().width + 16 : 300;
    el.scrollBy({ left: dir * w * (window.innerWidth < 700 ? 1 : 2), behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  const scrollPrev = () => scrollRow(-1), scrollNext = () => scrollRow(1);

  const onLong = (e: { target: HTMLInputElement }) => { setLongUrl(e.target.value); setCopied(false); };
  const onSlug = (e: { target: HTMLInputElement }) => { setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40)); setCopied(false); };
  const shortUrl = `jhino.com/${slug || 'your-link'}`;
  const copyLabel = copied ? 'Copied' : 'Copy';
  const copyLink = () => { navigator.clipboard?.writeText(`https://${shortUrl}`).catch(() => {}); setCopied(true); };
  const linksLeft = '12 of 100 used';

  const start = signedIn ? '/apps' : '/signup';
  const startBuild = signedIn ? '/build' : '/signup';
  const linksHref = signedIn ? '/links' : '/signup';

  return (
    <SiteFrame signedIn={signedIn}>
{/* HERO */}
<section id="top" style={{ padding: "clamp(40px,7vw,67px) 20px clamp(36px,6vw,59px)", textAlign: "center", background: "var(--heroGlow,radial-gradient(ellipse at 66% 12%,rgba(102,98,197,0.075),transparent 65%))" }}>
  <div style={{ fontFamily: "'Geist Mono',monospace", fontSize: "12px", letterSpacing: ".11em", textTransform: "uppercase", color: "var(--mu,#acb1c0)" }}>A place for the things you make</div>
  <h1 style={{ fontSize: "clamp(44px,8.1vw,118px)", letterSpacing: "-.07em", lineHeight: ".99", margin: "23px auto 27px", maxWidth: "1150px", fontWeight: "700", animation: "jhEnter .8s cubic-bezier(.2,.75,.2,1) both" }}>Your HTML.<br />Out in the <em style={{ fontStyle: "normal", fontFamily: "inherit", fontWeight: "inherit", letterSpacing: "inherit", color: "#e0461f" }}>world</em><span style={{ color: "#e0461f" }}>.</span></h1>
  <p style={{ fontSize: "19px", lineHeight: "1.6", maxWidth: "510px", margin: "0 auto", color: "var(--mu,#acb1c0)", animation: "jhEnter .8s .08s cubic-bezier(.2,.75,.2,1) both" }}>Upload your HTML. Publish a live website.<br />Share it with the people who matter.</p>
  <div style={{ display: "flex", gap: "12px", justifyContent: "center", alignItems: "center", marginTop: "29px", flexWrap: "wrap", animation: "jhEnter .8s .16s cubic-bezier(.2,.75,.2,1) both" }}>
    <Link className="jh-h3" to={start} style={{ display: "inline-flex", alignItems: "center", gap: "15px", padding: "15px 25px", minHeight: "54px", borderRadius: "100px", background: "#e0461f", color: "#ffffff", fontSize: "15px", fontWeight: "700", boxShadow: "0 6px 26px rgba(224,70,31,0.25)", transition: "background .2s,transform .3s" }}>
      Publish your HTML
      <svg viewBox="0 0 24 24" style={{ width: "18px", height: "18px", stroke: "currentColor", fill: "none", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M12 17V3M7 8l5-5 5 5M4 16v5h16v-5"></path></svg>
    </Link>
    <a className="jh-h4" href="#how" style={{ display: "inline-flex", alignItems: "center", gap: "15px", padding: "15px 25px", minHeight: "54px", borderRadius: "100px", border: "1px solid var(--outl,#363d4d)", background: "var(--soft,#171b25)", fontSize: "15px", fontWeight: "700", transition: "background .2s,transform .3s" }}>
      See how it works
      <svg viewBox="0 0 24 24" style={{ width: "18px", height: "18px", stroke: "currentColor", fill: "none", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M4 12h16M14 6l6 6-6 6"></path></svg>
    </a>
  </div>
  <small style={{ display: "block", fontSize: "13px", color: "var(--mu,#acb1c0)", marginTop: "17px" }}>Start free. <b style={{ fontWeight: "400", color: "var(--ink,#f7f7fb)" }}>HTML or ZIP.</b> All your ideas welcome.</small>
</section>

<div style={{ padding: "0 clamp(12px,2.5vw,26px) 26px" }}>
  <figure style={{ margin: "0", position: "relative", overflow: "hidden", borderRadius: "clamp(16px,2vw,25px)", background: "#08090b", color: "#f8f8f7", width: "100%", minWidth: "0", height: "max(520px,min(46.5vw,620px))", isolation: "isolate", border: "1px solid var(--line,#2b303e)" }}>
    <img src={heroImg} width={1672} height={941} decoding="async" fetchPriority="high" alt="A sculptural metal HTML file suspended in warm light" style={{ position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "cover", zIndex: "-2" }} />
    <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "48%", width: "min(46%,560px)", aspectRatio: "1", borderRadius: "50%", background: "radial-gradient(closest-side,rgba(255,150,90,0.55),rgba(224,70,31,0.28) 45%,transparent 75%)", mixBlendMode: "screen", filter: "blur(24px)", pointerEvents: "none", zIndex: "-1", animation: "jhGlow 5s ease-in-out infinite" }}></div>
    <div style={{ position: "absolute", inset: "0", zIndex: "-1", background: "linear-gradient(0deg,rgba(8,9,11,0.61),transparent 28%,transparent 65%,rgba(8,9,11,0.19))", pointerEvents: "none" }}></div>
    <div style={{ position: "absolute", top: "clamp(20px,3vw,35px)", left: "clamp(20px,3.5vw,42px)", right: "clamp(20px,3.5vw,42px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", fontSize: "13px", color: "#a9aba8" }}>
      <span style={{ fontFamily: "'Geist Mono',monospace", fontSize: "12px", letterSpacing: ".11em", textTransform: "uppercase", color: "#c3c4c0" }}>A file is only the beginning.</span>
      {notMobile && (<><span>01 / Jhino publishing</span></>)}
    </div>
    <div style={{ position: "absolute", left: "clamp(16px,9%,200px)", top: "26%", display: "flex", alignItems: "center", gap: "12px", fontSize: "clamp(12px,1.3vw,14px)", background: "rgba(23,25,27,0.85)", backdropFilter: "blur(12px)", border: "1px solid rgba(98,103,108,0.44)", borderRadius: "12px", padding: "clamp(10px,1.4vw,15px) clamp(12px,1.8vw,20px)", boxShadow: "0 20px 50px rgba(0,0,0,0.2)", textAlign: "left", animation: "jhFloatA 8s ease-in-out infinite" }}>
      <svg viewBox="0 0 24 24" style={{ width: "20px", height: "20px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"></path></svg>
      <div>my-next-idea.html<small style={{ display: "block", color: "#a6a8a5", fontSize: "12px", marginTop: "2px" }}>Made by you</small></div>
    </div>
    <div style={{ position: "absolute", right: "5.5%", bottom: "29%", display: "flex", alignItems: "center", gap: "12px", fontSize: "clamp(12px,1.3vw,14px)", background: "rgba(23,25,27,0.85)", backdropFilter: "blur(12px)", border: "1px solid rgba(98,103,108,0.44)", borderRadius: "12px", padding: "clamp(10px,1.4vw,15px) clamp(12px,1.8vw,20px)", boxShadow: "0 20px 50px rgba(0,0,0,0.2)", textAlign: "left", animation: "jhFloatB 9s ease-in-out infinite" }}>
      <svg viewBox="0 0 24 24" style={{ width: "20px", height: "20px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="m10 8 3-3a5 5 0 0 1 7 7l-3 3M14 16l-3 3a5 5 0 0 1-7-7l3-3M8 16l8-8"></path></svg>
      <div><strong style={{ display: "block", fontFamily: "'Geist Mono',monospace", fontWeight: "400", fontSize: "13px", lineHeight: "1.4" }}>jhino.com/you/next-idea</strong><small style={{ display: "block", color: "#a6a8a5", fontSize: "12px", marginTop: "2px" }}>Example published address</small></div>
    </div>
    <figcaption style={{ position: "absolute", left: "clamp(20px,3.5vw,42px)", bottom: "clamp(24px,3vw,36px)", fontSize: "clamp(24px,2.6vw,34px)", lineHeight: "1.08", letterSpacing: "-.04em", maxWidth: "330px", textAlign: "left" }}>Built in your world.<br /><span style={{ color: "#898d91" }}>Ready for everyone else's.</span></figcaption>
    {notMobile && (<><span style={{ position: "absolute", bottom: "38px", right: "42px", fontFamily: "'Geist Mono',monospace", fontSize: "12px", color: "#979ba1", textAlign: "right" }}>FROM .HTML<br />TO HELLO, WORLD.</span></>)}
  </figure>
  <div style={{ display: "flex", justifyContent: "space-between", gap: "20px", flexWrap: "wrap", padding: "19px 22px 0", fontSize: "13px", color: "var(--mu,#acb1c0)" }}>
    <span>Your code. Your design. <b style={{ fontWeight: "400", color: "var(--ink,#f7f7fb)" }}>Your next chapter.</b></span>
    <span style={{ display: "flex", gap: "20px" }}><span><b style={{ fontWeight: "400", color: "var(--ink,#f7f7fb)" }}>.html</b> Single files</span><span><b style={{ fontWeight: "400", color: "var(--ink,#f7f7fb)" }}>.zip</b> Website packages</span></span>
  </div>
</div>

{/* HOW IT WORKS */}
<section id="how" style={{ padding: "clamp(64px,10vw,120px) 20px 32px" }}>
  <div style={{ maxWidth: "1240px", margin: "0 auto", background: "var(--panel,#0f1218)", border: "1px solid var(--line,#2b303e)", borderRadius: "20px", padding: "clamp(20px,4vw,60px)" }}>
    <div style={{ display: "flex", gap: "8px", fontSize: "15px", color: "var(--mu,#acb1c0)", paddingBottom: "20px", borderBottom: "1px solid var(--line,#2b303e)", marginBottom: "28px" }}><span>[</span><span>How it works</span><span>]</span></div>
    <div style={{ display: "flex", justifyContent: "space-between", gap: "32px 64px", flexWrap: "wrap", alignItems: "flex-start", marginBottom: "clamp(32px,5vw,56px)" }}>
      <h2 style={{ margin: "0", fontSize: "clamp(34px,3.6vw,50px)", lineHeight: "1.15", letterSpacing: "-0.03em", fontWeight: "500", textWrap: "balance", maxWidth: "660px" }}>Write it with Jhino, or bring the HTML you already made</h2>
      <div>
        <p style={{ margin: "0", fontSize: "clamp(17px,1.5vw,20px)", lineHeight: "1.55", color: "var(--mu,#acb1c0)", maxWidth: "520px", textWrap: "pretty" }}>Both ways open straight away, save to your server and sync live for everyone you share with.</p>
        <Link to={startBuild} style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginTop: "28px", fontSize: "18px", fontWeight: "500", color: "var(--ink,#f7f7fb)" }}>Create your first app <svg viewBox="0 0 24 24" style={{ width: "18px", height: "18px", stroke: "currentColor", fill: "none", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M4 12h16M14 6l6 6-6 6"></path></svg></Link>
      </div>
    </div>
    <div style={{ borderRadius: "14px", background: "linear-gradient(180deg,#030406 0%,#10202a 32%,#234656 55%,#6f848e 78%,#c7cfd4 100%)", minHeight: "clamp(400px,40vw,560px)", display: "flex", alignItems: "center", justifyContent: "center", gap: "24px", flexWrap: "wrap", padding: "clamp(28px,5vw,56px) clamp(14px,3vw,24px)" }}>
      <div style={{ background: "#ffffff", color: "#1a1a1a", borderRadius: "14px", boxShadow: "0 30px 60px -18px rgba(0,0,0,0.5)", padding: "18px", fontSize: "13px", width: "min(100%,340px)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}><span style={{ fontSize: "14px", fontWeight: "500" }}>Create HTML</span><span style={{ fontSize: "11px", color: "#8a8a8a" }}>Step 02 of 03</span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
          {ticks.map((t, tIndex) => (<Fragment key={tIndex}>
            <div className="jh-h5" onClick={t.toggle} role="checkbox" aria-checked={t.checked} tabIndex={0} onKeyDown={t.key} style={{ cursor: "pointer", userSelect: "none", transition: "background .15s", display: "flex", alignItems: "center", gap: "10px", padding: "11px 14px", borderRadius: "8px", background: "#f4f4f4", justifyContent: "space-between" }}><span>{t.name}</span><span style={{ width: "16px", height: "16px", borderRadius: "5px", background: `${t.bg}`, border: `1px solid ${t.border}`, display: "grid", placeItems: "center", color: "#ffffff", fontSize: "10px" }}>{t.mark}</span></div>
          </Fragment>))}
        </div>
      </div>
      <div style={{ background: "#ffffff", color: "#1a1a1a", borderRadius: "14px", boxShadow: "0 30px 60px -18px rgba(0,0,0,0.5)", padding: "18px", fontSize: "13px", width: "min(100%,340px)" }}>
        <div style={{ fontSize: "14px", fontWeight: "500", marginBottom: "14px" }}>My apps</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
          {files.map((fl, flIndex) => (<Fragment key={flIndex}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 14px", borderRadius: "8px", background: "#f4f4f4" }}><span style={{ width: "14px", height: "16px", borderRadius: "3px", background: `${fl.color}`, flexShrink: "0" }}></span><span style={{ flex: "1", minWidth: "0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fl.name}</span><span style={{ fontSize: "11px", color: "#8a8a8a" }}>{fl.meta}</span></div>
          </Fragment>))}
        </div>
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))", gap: "36px 56px", marginTop: "clamp(36px,5vw,56px)" }}>
      <div><span style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--iconTile,rgba(224,70,31,0.12))", display: "grid", placeItems: "center", marginBottom: "20px" }}><svg viewBox="0 0 24 24" style={{ width: "22px", height: "22px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"></path></svg></span><h3 style={{ margin: "0 0 12px", fontSize: "21px", fontWeight: "500", letterSpacing: "-0.01em", lineHeight: "1.3" }}>Create HTML</h3><p style={{ margin: "0", fontSize: "16px", lineHeight: "1.65", color: "var(--mu,#acb1c0)", textWrap: "pretty" }}>Say who it is for and what kind of work. Tick features from 45, pick the colour, lettering and logo. Jhino writes the whole file.</p></div>
      <div><span style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--iconTile,rgba(224,70,31,0.12))", display: "grid", placeItems: "center", marginBottom: "20px" }}><svg viewBox="0 0 24 24" style={{ width: "22px", height: "22px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M12 17V3M7 8l5-5 5 5M4 16v5h16v-5"></path></svg></span><h3 style={{ margin: "0 0 12px", fontSize: "21px", fontWeight: "500", letterSpacing: "-0.01em", lineHeight: "1.3" }}>Upload HTML</h3><p style={{ margin: "0", fontSize: "16px", lineHeight: "1.65", color: "var(--mu,#acb1c0)", textWrap: "pretty" }}>Bring an .html file or a .zip made with Claude or any other tool. Its localStorage is redirected to Jhino, so every save lands on the server.</p></div>
      <div><span style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--iconTile,rgba(224,70,31,0.12))", display: "grid", placeItems: "center", marginBottom: "20px" }}><svg viewBox="0 0 24 24" style={{ width: "22px", height: "22px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M4 20h4L19 9l-4-4L4 16z"></path><path d="m13 7 4 4"></path></svg></span><h3 style={{ margin: "0 0 12px", fontSize: "21px", fontWeight: "500", letterSpacing: "-0.01em", lineHeight: "1.3" }}>Change it later</h3><p style={{ margin: "0", fontSize: "16px", lineHeight: "1.65", color: "var(--mu,#acb1c0)", textWrap: "pretty" }}>Edit features and design at any time. Unticked features keep their data and come back when you tick them again.</p></div>
    </div>
  </div>
</section>

{/* FEATURES */}
<section id="features" style={{ padding: "clamp(64px,10vw,100px) 20px 32px" }}>
  <div style={{ maxWidth: "1240px", margin: "0 auto" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: "32px 64px", flexWrap: "wrap", alignItems: "flex-start", marginBottom: "clamp(32px,5vw,56px)" }}>
      <div>
        <span style={{ display: "inline-block", padding: "9px 18px", borderRadius: "100px", background: "rgba(224,70,31,0.12)", color: "var(--em,#ff9a80)", fontSize: "14px", marginBottom: "24px" }}>45 features to tick</span>
        <h2 style={{ margin: "0", fontSize: "clamp(34px,3.6vw,50px)", lineHeight: "1.15", letterSpacing: "-0.03em", fontWeight: "500", textWrap: "balance", maxWidth: "660px", marginBottom: "28px" }}>Everything a client project leaves behind.</h2>
        <Link className="jh-h6" to={startBuild} style={{ display: "inline-flex", alignItems: "center", gap: "12px", padding: "14px 24px", minHeight: "50px", borderRadius: "100px", background: "#e0461f", color: "#ffffff", fontSize: "15px", fontWeight: "600", transition: "background .2s,transform .3s" }}>Explore features</Link>
      </div>
      <p style={{ margin: "0", fontSize: "clamp(17px,1.5vw,20px)", lineHeight: "1.55", color: "var(--mu,#acb1c0)", maxWidth: "520px", textWrap: "pretty", marginTop: "clamp(0px,5vw,64px)" }}>Built for work between a studio and its clients: video, photography, design, social media, apps and websites. Dates show in Bikram Sambat, with AD beside them.</p>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: "16px" }}>
      <article>
        <div style={{ aspectRatio: "4/5", borderRadius: "14px", overflow: "hidden", display: "grid", placeItems: "center", background: "radial-gradient(70% 55% at 25% 45%,rgba(205,120,110,0.6),transparent 60%),radial-gradient(80% 60% at 85% 85%,#5b7fb2,transparent 60%),linear-gradient(170deg,#a8d0e6,#dfe8ec 70%,#9db5cf)" }}>
          <div style={{ background: "rgba(255,255,255,0.26)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.45)", borderRadius: "18px", padding: "12px 5px 5px", width: "min(84%,300px)", boxShadow: "0 20px 40px -20px rgba(0,0,0,0.35)" }}>
            <div style={{ textAlign: "center", color: "#ffffff", fontSize: "15px", marginBottom: "10px", textShadow: "0 1px 8px rgba(0,0,0,0.15)" }}>Deliver and approve</div>
            <div style={{ background: "#ffffff", color: "#1a1a1a", borderRadius: "14px", padding: "12px", fontSize: "12.5px" }}>
              <div style={{ aspectRatio: "16/10", borderRadius: "9px", background: "repeating-linear-gradient(135deg,#e9ecef 0 10px,#f2f4f5 10px 20px)", display: "grid", placeItems: "center", marginBottom: "10px" }}><span style={{ width: "34px", height: "34px", borderRadius: "50%", background: "#1a1a1a", color: "#ffffff", display: "grid", placeItems: "center", fontSize: "11px" }}>▶</span></div>
              <div style={{ fontWeight: "500", fontSize: "13px" }}>Brand film — cut 3</div>
              <div style={{ color: "#8a8a8a", fontSize: "11.5px", margin: "2px 0 10px" }}>Himalaya Coffee · 02:14</div>
              <div style={{ display: "flex", gap: "6px" }}><span style={{ flex: "1", textAlign: "center", padding: "7px", borderRadius: "7px", background: "#1f9d5c", color: "#ffffff", fontSize: "11.5px" }}>Approve</span><span style={{ flex: "1", textAlign: "center", padding: "7px", borderRadius: "7px", background: "#f1f1f1", fontSize: "11.5px" }}>Ask for changes</span></div>
            </div>
          </div>
        </div>
        <span style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--iconTile,rgba(224,70,31,0.12))", display: "grid", placeItems: "center", margin: "24px 0 18px" }}><svg viewBox="0 0 24 24" style={{ width: "22px", height: "22px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }}><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m10 9 5 3-5 3z"></path></svg></span><h3 style={{ margin: "0 0 12px", fontSize: "21px", fontWeight: "500", letterSpacing: "-0.01em", lineHeight: "1.3" }}>Deliver and approve</h3>
        <p style={{ margin: "0", fontSize: "16px", lineHeight: "1.65", color: "var(--mu,#acb1c0)", textWrap: "pretty" }}>Video deliveries the client watches, comments on and approves. Design proofs round by round, and big file transfer both ways.</p>
      </article>
      <article>
        <div style={{ aspectRatio: "4/5", borderRadius: "14px", overflow: "hidden", display: "grid", placeItems: "center", background: "radial-gradient(55% 40% at 75% 12%,rgba(214,226,120,0.8),transparent 60%),radial-gradient(70% 55% at 18% 28%,#a2b34c,transparent 60%),linear-gradient(180deg,#b3c47e 0%,#6f9b60 55%,#2d5b2e 100%)" }}>
          <div style={{ background: "rgba(255,255,255,0.26)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.45)", borderRadius: "18px", padding: "12px 5px 5px", width: "min(84%,300px)", boxShadow: "0 20px 40px -20px rgba(0,0,0,0.35)" }}>
            <div style={{ textAlign: "center", color: "#ffffff", fontSize: "15px", marginBottom: "10px", textShadow: "0 1px 8px rgba(0,0,0,0.15)" }}>Photo proofing</div>
            <div style={{ background: "#ffffff", color: "#1a1a1a", borderRadius: "14px", padding: "6px", fontSize: "12.5px" }}>
              {photos.map((ph, phIndex) => (<Fragment key={phIndex}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px", borderBottom: "1px solid #f0f0f0" }}>
                  <span style={{ width: "30px", height: "30px", borderRadius: "7px", background: `${ph.tone}`, flexShrink: "0" }}></span>
                  <span style={{ flex: "1", minWidth: "0" }}><span style={{ display: "block", fontWeight: "500" }}>{ph.name}</span><span style={{ display: "block", color: "#8a8a8a", fontSize: "11px" }}>{ph.meta}</span></span>
                  <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "100px", background: `${ph.bg}`, color: `${ph.fg}` }}>{ph.pick}</span>
                </div>
              </Fragment>))}
            </div>
          </div>
        </div>
        <span style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--iconTile,rgba(224,70,31,0.12))", display: "grid", placeItems: "center", margin: "24px 0 18px" }}><svg viewBox="0 0 24 24" style={{ width: "22px", height: "22px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }}><rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="9" cy="10" r="2"></circle><path d="m21 16-5-5-9 9"></path></svg></span><h3 style={{ margin: "0 0 12px", fontSize: "21px", fontWeight: "500", letterSpacing: "-0.01em", lineHeight: "1.3" }}>Photo proofing</h3>
        <p style={{ margin: "0", fontSize: "16px", lineHeight: "1.65", color: "var(--mu,#acb1c0)", textWrap: "pretty" }}>The client marks Pick, Maybe or No on every photo, and you see their choices the moment they make them.</p>
      </article>
      <article>
        <div style={{ aspectRatio: "4/5", borderRadius: "14px", overflow: "hidden", display: "grid", placeItems: "center", background: "radial-gradient(60% 45% at 85% 12%,rgba(255,214,170,0.75),transparent 60%),radial-gradient(70% 50% at 40% 80%,rgba(255,150,100,0.7),transparent 62%),linear-gradient(160deg,#f7b35a 0%,#ef6a3a 55%,#e0461f 100%)" }}>
          <div style={{ background: "rgba(255,255,255,0.26)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.45)", borderRadius: "18px", padding: "12px 5px 5px", width: "min(84%,300px)", boxShadow: "0 20px 40px -20px rgba(0,0,0,0.35)" }}>
            <div style={{ textAlign: "center", color: "#ffffff", fontSize: "15px", marginBottom: "10px", textShadow: "0 1px 8px rgba(0,0,0,0.15)" }}>Money with the client</div>
            <div style={{ background: "#ffffff", color: "#1a1a1a", borderRadius: "14px", padding: "12px", fontSize: "12.5px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}><span style={{ fontWeight: "500", fontSize: "13px" }}>Invoice #104</span><span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "100px", background: "#e3f5ea", color: "#157a45" }}>Paid</span></div>
              {invoice.map((iv, ivIndex) => (<Fragment key={ivIndex}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f0f0f0", color: "#4a4a4a" }}><span>{iv.item}</span><span>{iv.amt}</span></div>
              </Fragment>))}
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "9px", fontWeight: "500" }}><span>Total</span><span>NPR 85,000</span></div>
            </div>
          </div>
        </div>
        <span style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--iconTile,rgba(224,70,31,0.12))", display: "grid", placeItems: "center", margin: "24px 0 18px" }}><svg viewBox="0 0 24 24" style={{ width: "22px", height: "22px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"></path><path d="M9 8h6M9 12h6M9 16h3"></path></svg></span><h3 style={{ margin: "0 0 12px", fontSize: "21px", fontWeight: "500", letterSpacing: "-0.01em", lineHeight: "1.3" }}>Money with the client</h3>
        <p style={{ margin: "0", fontSize: "16px", lineHeight: "1.65", color: "var(--mu,#acb1c0)", textWrap: "pretty" }}>Invoices and quotes that print as PDF, the client's receipts with photos, payments with proof and a project ledger.</p>
      </article>
    </div>
    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginTop: "40px", fontSize: "15px", color: "var(--mu,#acb1c0)" }}>
      <span>Also in the 45:</span>
      {alsoChips.map((c, cIndex) => (<Fragment key={cIndex}>
        <span style={{ padding: "7px 14px", borderRadius: "100px", border: "1px solid var(--line,#2b303e)", color: "var(--ink,#f7f7fb)", fontSize: "14px" }}>{c}</span>
      </Fragment>))}
    </div>
  </div>
</section>

{/* MY PAGE */}
<section id="mypage" style={{ padding: "clamp(64px,10vw,100px) 0 32px", overflow: "hidden" }}>
  <div style={{ maxWidth: "1240px", margin: "0 auto", padding: "0 20px" }}>
    <div style={{ display: "flex", gap: "8px", fontSize: "15px", color: "var(--mu,#acb1c0)", paddingBottom: "20px", borderBottom: "1px solid var(--line,#2b303e)", marginBottom: "28px" }}><span>[</span><span>My page</span><span>]</span></div>
    <div style={{ display: "flex", justifyContent: "space-between", gap: "32px 64px", flexWrap: "wrap", alignItems: "flex-start", marginBottom: "clamp(32px,5vw,56px)" }}>
      <h2 style={{ margin: "0", fontSize: "clamp(34px,3.6vw,50px)", lineHeight: "1.15", letterSpacing: "-0.03em", fontWeight: "500", textWrap: "balance", maxWidth: "660px" }}>One page for your work, your socials and your apps</h2>
      <div>
        <p style={{ margin: "0", fontSize: "clamp(17px,1.5vw,20px)", lineHeight: "1.55", color: "var(--mu,#acb1c0)", maxWidth: "520px", textWrap: "pretty" }}>Links, headings, text, YouTube and Vimeo videos, your Jhino apps and social icons, all at <span style={{ fontFamily: "'Geist Mono',monospace", fontSize: "0.9em", color: "var(--ink,#f7f7fb)" }}>jhino.com/you</span>. Pick a list or a profile layout, and one of 40 designs.</p>
        <div style={{ display: "flex", gap: "10px", marginTop: "28px" }}>
          <button className="jh-h7" onClick={scrollPrev} aria-label="Previous profiles" style={{ width: "46px", height: "46px", borderRadius: "50%", border: "1px solid var(--line,#2b303e)", background: "var(--panel,#0f1218)", color: "var(--ink,#f7f7fb)", display: "grid", placeItems: "center", cursor: "pointer", transition: "background .2s" }}><svg viewBox="0 0 24 24" style={{ width: "18px", height: "18px", stroke: "currentColor", fill: "none", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round", transform: "rotate(180deg)" }}><path d="M4 12h16M14 6l6 6-6 6"></path></svg></button>
          <button className="jh-h8" onClick={scrollNext} aria-label="Next profiles" style={{ width: "46px", height: "46px", borderRadius: "50%", border: "1px solid var(--line,#2b303e)", background: "var(--panel,#0f1218)", color: "var(--ink,#f7f7fb)", display: "grid", placeItems: "center", cursor: "pointer", transition: "background .2s" }}><svg viewBox="0 0 24 24" style={{ width: "18px", height: "18px", stroke: "currentColor", fill: "none", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M4 12h16M14 6l6 6-6 6"></path></svg></button>
        </div>
      </div>
    </div>
  </div>
  <div ref={rowRef} className="jh-row" style={{ display: "flex", gap: "16px", overflowX: "auto", scrollSnapType: "x mandatory", scrollPadding: "0 max(20px,calc((100vw - 1200px) / 2))", padding: "8px max(20px,calc((100vw - 1200px) / 2)) 24px", scrollbarWidth: "none" }}>
    {profiles.map((pr, prIndex) => (<Fragment key={prIndex}>
      <Link className="jh-h9" to={`/${pr.handle}`} style={{ flex: "0 0 clamp(230px,24vw,290px)", scrollSnapAlign: "start", display: "flex", flexDirection: "column", gap: "14px", transition: "transform .35s cubic-bezier(.2,.75,.2,1)" }}>
        <div style={{ padding: "8px", borderRadius: "24px", background: "var(--panel,#0f1218)", border: "1px solid var(--line,#2b303e)", boxShadow: "0 10px 24px -16px rgba(0,0,0,0.18)" }}>
          <div style={{ aspectRatio: "9/16", borderRadius: "17px", overflow: "hidden", background: "#1a1a1a" }}>
            <img src={pr.img} alt={pr.alt} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", display: "block" }} />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", padding: "0 4px" }}>
          <div style={{ minWidth: "0" }}>
            <div style={{ fontSize: "17px", fontWeight: "500", letterSpacing: "-0.01em" }}>{pr.name}</div>
            <div style={{ fontFamily: "'Geist Mono',monospace", fontSize: "12.5px", color: "var(--mu,#acb1c0)", marginTop: "2px" }}>jhino.com/{pr.handle}</div>
          </div>
          <span style={{ flexShrink: "0", fontSize: "12px", padding: "4px 10px", borderRadius: "100px", border: "1px solid var(--line,#2b303e)", color: "var(--mu,#acb1c0)" }}>{pr.role}</span>
        </div>
      </Link>
    </Fragment>))}
  </div>
  <div style={{ maxWidth: "1240px", margin: "0 auto", padding: "0 20px" }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))", gap: "36px 56px", marginTop: "clamp(28px,4vw,40px)" }}>
      <div><span style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--iconTile,rgba(224,70,31,0.12))", display: "grid", placeItems: "center", marginBottom: "20px" }}><svg viewBox="0 0 24 24" style={{ width: "22px", height: "22px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }}><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect></svg></span><h3 style={{ margin: "0 0 12px", fontSize: "21px", fontWeight: "500", letterSpacing: "-0.01em", lineHeight: "1.3" }}>40 designs</h3><p style={{ margin: "0", fontSize: "16px", lineHeight: "1.65", color: "var(--mu,#acb1c0)" }}>Free has 5, Plus 15 and Pro all 40. Pro can replace the design with its own HTML.</p></div>
      <div><span style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--iconTile,rgba(224,70,31,0.12))", display: "grid", placeItems: "center", marginBottom: "20px" }}><svg viewBox="0 0 24 24" style={{ width: "22px", height: "22px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }}><rect x="6" y="2" width="12" height="20" rx="2.5"></rect><path d="M12 8v6M9 11h6M11 18h2"></path></svg></span><h3 style={{ margin: "0 0 12px", fontSize: "21px", fontWeight: "500", letterSpacing: "-0.01em", lineHeight: "1.3" }}>Add to home screen</h3><p style={{ margin: "0", fontSize: "16px", lineHeight: "1.65", color: "var(--mu,#acb1c0)" }}>Each app on your page can be installed on phones and computers, with its own icon.</p></div>
      <div><span style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--iconTile,rgba(224,70,31,0.12))", display: "grid", placeItems: "center", marginBottom: "20px" }}><svg viewBox="0 0 24 24" style={{ width: "22px", height: "22px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"></path></svg></span><h3 style={{ margin: "0 0 12px", fontSize: "21px", fontWeight: "500", letterSpacing: "-0.01em", lineHeight: "1.3" }}>See who visits</h3><p style={{ margin: "0", fontSize: "16px", lineHeight: "1.65", color: "var(--mu,#acb1c0)" }}>{statsText}</p></div>
    </div>
  </div>
</section>

{/* SHORT LINKS */}
<section id="links" style={{ padding: "clamp(64px,10vw,100px) 20px 32px" }}>
  <div style={{ maxWidth: "1240px", margin: "0 auto", background: "var(--panel,#0f1218)", border: "1px solid var(--line,#2b303e)", borderRadius: "20px", padding: "clamp(20px,4vw,60px)" }}>
    <div style={{ display: "flex", gap: "8px", fontSize: "15px", color: "var(--mu,#acb1c0)", paddingBottom: "20px", borderBottom: "1px solid var(--line,#2b303e)", marginBottom: "28px" }}><span>[</span><span>Short links</span><span>]</span></div>
    <div style={{ display: "flex", justifyContent: "space-between", gap: "32px 64px", flexWrap: "wrap", alignItems: "flex-start", marginBottom: "clamp(32px,5vw,56px)" }}>
      <h2 style={{ margin: "0", fontSize: "clamp(34px,3.6vw,50px)", lineHeight: "1.15", letterSpacing: "-0.03em", fontWeight: "500", textWrap: "balance", maxWidth: "660px" }}>Long link in, short link out. Every click counted.</h2>
      <div>
        <p style={{ margin: "0", fontSize: "clamp(17px,1.5vw,20px)", lineHeight: "1.55", color: "var(--mu,#acb1c0)", maxWidth: "520px", textWrap: "pretty" }}>Already have a web address? Turn it into <span style={{ fontFamily: "'Geist Mono',monospace", fontSize: "0.9em", color: "var(--ink,#f7f7fb)" }}>jhino.com/your-name</span>. Visitors go straight to the page, and you see how many opened it.</p>
        <Link to={linksHref} style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginTop: "28px", fontSize: "18px", fontWeight: "500", color: "var(--ink,#f7f7fb)" }}>Make a short link <svg viewBox="0 0 24 24" style={{ width: "18px", height: "18px", stroke: "currentColor", fill: "none", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M4 12h16M14 6l6 6-6 6"></path></svg></Link>
      </div>
    </div>
    <div style={{ borderRadius: "14px", background: "linear-gradient(180deg,#030406 0%,#10202a 32%,#234656 55%,#6f848e 78%,#c7cfd4 100%)", minHeight: "clamp(400px,40vw,560px)", display: "grid", placeItems: "center", padding: "clamp(28px,5vw,56px) clamp(14px,3vw,24px)" }}>
      <div style={{ background: "#ffffff", color: "#1a1a1a", borderRadius: "14px", boxShadow: "0 30px 60px -18px rgba(0,0,0,0.5)", padding: "20px", fontSize: "13px", width: "min(100%,460px)", display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontSize: "14px", fontWeight: "500" }}>New short link</span><span style={{ fontSize: "11px", color: "#8a8a8a" }}>{linksLeft}</span></div>
        <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}><span style={{ fontSize: "11.5px", color: "#8a8a8a" }}>Paste a long address</span><input value={longUrl} onChange={onLong} style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: "8px", border: "1px solid #e3e3e3", background: "#f7f7f7", fontFamily: "inherit", fontSize: "13px", color: "#1a1a1a", outline: "none" }} /></label>
        <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}><span style={{ fontSize: "11.5px", color: "#8a8a8a" }}>Name it (Plus and Pro)</span>
          <div style={{ display: "flex", alignItems: "center", borderRadius: "8px", border: "1px solid #e3e3e3", background: "#f7f7f7", overflow: "hidden" }}><span style={{ padding: "11px 0 11px 12px", color: "#8a8a8a", fontFamily: "'Geist Mono',monospace", fontSize: "12.5px" }}>jhino.com/</span><input value={slug} onChange={onSlug} style={{ flex: "1", minWidth: "0", padding: "11px 12px 11px 2px", border: "none", background: "transparent", fontFamily: "'Geist Mono',monospace", fontSize: "12.5px", color: "#1a1a1a", outline: "none" }} /></div>
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", borderRadius: "10px", background: "#fdf1ec", border: "1px solid #f6d3c5" }}>
          <svg viewBox="0 0 24 24" style={{ width: "16px", height: "16px", flexShrink: "0", stroke: "#e0461f", fill: "none", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="m10 8 3-3a5 5 0 0 1 7 7l-3 3M14 16l-3 3a5 5 0 0 1-7-7l3-3M8 16l8-8"></path></svg>
          <span style={{ flex: "1", minWidth: "0", fontFamily: "'Geist Mono',monospace", fontSize: "13px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{shortUrl}</span>
          <button onClick={copyLink} style={{ border: "none", borderRadius: "100px", padding: "7px 14px", background: "#e0461f", color: "#ffffff", fontFamily: "inherit", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>{copyLabel}</button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", paddingTop: "12px", borderTop: "1px solid #eeeeee" }}>
          <div><div style={{ fontSize: "11.5px", color: "#8a8a8a" }}>Clicks · last 7 days</div><div style={{ fontSize: "22px", fontWeight: "500", letterSpacing: "-0.02em", marginTop: "2px" }}>1,284</div></div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "5px", height: "40px" }}>
            {clickBars.map((cb, cbIndex) => (<Fragment key={cbIndex}><span style={{ width: "10px", borderRadius: "3px", background: `${cb.c}`, height: `${cb.h}` }}></span></Fragment>))}
          </div>
        </div>
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))", gap: "36px 56px", marginTop: "clamp(36px,5vw,56px)" }}>
      <div><span style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--iconTile,rgba(224,70,31,0.12))", display: "grid", placeItems: "center", marginBottom: "20px" }}><svg viewBox="0 0 24 24" style={{ width: "22px", height: "22px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M4 20h4L19 9l-4-4L4 16z"></path><path d="m13 7 4 4"></path></svg></span><h3 style={{ margin: "0 0 12px", fontSize: "21px", fontWeight: "500", letterSpacing: "-0.01em", lineHeight: "1.3" }}>Names you choose</h3><p style={{ margin: "0", fontSize: "16px", lineHeight: "1.65", color: "var(--mu,#acb1c0)", textWrap: "pretty" }}>{linksText}</p></div>
      <div><span style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--iconTile,rgba(224,70,31,0.12))", display: "grid", placeItems: "center", marginBottom: "20px" }}><svg viewBox="0 0 24 24" style={{ width: "22px", height: "22px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"></path></svg></span><h3 style={{ margin: "0 0 12px", fontSize: "21px", fontWeight: "500", letterSpacing: "-0.01em", lineHeight: "1.3" }}>Every click counted</h3><p style={{ margin: "0", fontSize: "16px", lineHeight: "1.65", color: "var(--mu,#acb1c0)", textWrap: "pretty" }}>Each visit is counted as it passes through. Pro adds a daily click history for every link.</p></div>
      <div><span style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--iconTile,rgba(224,70,31,0.12))", display: "grid", placeItems: "center", marginBottom: "20px" }}><svg viewBox="0 0 24 24" style={{ width: "22px", height: "22px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"></path><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"></path></svg></span><h3 style={{ margin: "0 0 12px", fontSize: "21px", fontWeight: "500", letterSpacing: "-0.01em", lineHeight: "1.3" }}>Any web address</h3><p style={{ margin: "0", fontSize: "16px", lineHeight: "1.65", color: "var(--mu,#acb1c0)", textWrap: "pretty" }}>Point it at a video, a Drive folder, a form or a shop. Short links and app addresses never share a name.</p></div>
    </div>
  </div>
</section>

{/* LIVE SYNC */}
<section style={{ padding: "clamp(64px,10vw,100px) 20px 32px" }}>
  <div style={{ maxWidth: "1240px", margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,460px),1fr))", gap: "16px" }}>
    <div style={{ borderRadius: "20px", background: "linear-gradient(180deg,#030406 0%,#10202a 32%,#234656 55%,#6f848e 78%,#c7cfd4 100%)", minHeight: "clamp(420px,50vw,560px)", display: "grid", placeItems: "center", padding: "clamp(24px,4vw,40px) 14px" }}>
      <div style={{ background: "#ffffff", color: "#1a1a1a", borderRadius: "14px", boxShadow: "0 30px 60px -18px rgba(0,0,0,0.5)", padding: "18px", fontSize: "13px", width: "min(100%,380px)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}><span style={{ fontSize: "14px", fontWeight: "500" }}>Activity</span><span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#1f9d5c" }}><span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#1f9d5c", animation: "jhPulse 2s infinite" }}></span>Live</span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
          {log.map((l, lIndex) => (<Fragment key={lIndex}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 14px", borderRadius: "8px", background: "#f4f4f4" }}><span style={{ fontSize: "11px", color: "#8a8a8a", width: "34px", flexShrink: "0" }}>{l.t}</span><span style={{ flex: "1", minWidth: "0" }}>{l.msg}</span></div>
          </Fragment>))}
        </div>
      </div>
    </div>
    <div style={{ background: "var(--panel,#0f1218)", border: "1px solid var(--line,#2b303e)", borderRadius: "20px", padding: "clamp(24px,3vw,36px)", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "48px" }}>
      <p style={{ margin: "0", fontSize: "clamp(18px,1.6vw,21px)", lineHeight: "1.5", color: "var(--mu,#acb1c0)", textWrap: "pretty" }}>Every save goes to the server with a revision number, then out to everyone who has the app open. When two people change the same thing, both changes are merged.</p>
      <div>
        {syncItems.map((s, sIndex) => (<Fragment key={sIndex}>
          <div style={{ borderTop: "1px solid var(--line,#2b303e)" }}>
            <button onClick={s.toggle} aria-expanded={s.open} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "20px", padding: "22px 0", background: "transparent", border: "none", color: "var(--ink,#f7f7fb)", fontFamily: "inherit", fontSize: "clamp(17px,1.6vw,20px)", textAlign: "left", cursor: "pointer", letterSpacing: "-0.01em" }}>
              <span>{s.title}</span>
              <span style={{ width: "26px", height: "26px", borderRadius: "50%", background: "var(--chip,rgba(255,255,255,0.08))", display: "grid", placeItems: "center", flexShrink: "0" }}><svg viewBox="0 0 24 24" style={{ width: "14px", height: "14px", stroke: "currentColor", fill: "none", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", transform: `rotate(${s.rot})`, transition: "transform .25s" }}><path d="m6 9 6 6 6-6"></path></svg></span>
            </button>
            {s.open && (<>
              <p style={{ margin: "-6px 0 22px", paddingRight: "40px", fontSize: "16px", lineHeight: "1.6", color: "var(--mu,#acb1c0)" }}>{s.body}</p>
            </>)}
          </div>
        </Fragment>))}
      </div>
    </div>
  </div>
</section>

{/* SHARING */}
<section id="sharing" style={{ padding: "clamp(64px,10vw,100px) 20px 32px" }}>
  <div style={{ maxWidth: "1240px", margin: "0 auto", background: "var(--panel,#0f1218)", border: "1px solid var(--line,#2b303e)", borderRadius: "20px", padding: "clamp(20px,4vw,60px)" }}>
    <div style={{ display: "flex", gap: "8px", fontSize: "15px", color: "var(--mu,#acb1c0)", paddingBottom: "20px", borderBottom: "1px solid var(--line,#2b303e)", marginBottom: "28px" }}><span>[</span><span>Sharing</span><span>]</span></div>
    <div style={{ display: "flex", justifyContent: "space-between", gap: "32px 64px", flexWrap: "wrap", alignItems: "flex-start", marginBottom: "clamp(32px,5vw,56px)" }}>
      <h2 style={{ margin: "0", fontSize: "clamp(34px,3.6vw,50px)", lineHeight: "1.15", letterSpacing: "-0.03em", fontWeight: "500", textWrap: "balance", maxWidth: "660px" }}>Give each person exactly the access they need</h2>
      <div>
        <p style={{ margin: "0", fontSize: "clamp(17px,1.5vw,20px)", lineHeight: "1.55", color: "var(--mu,#acb1c0)", maxWidth: "520px", textWrap: "pretty" }}>Add people with their own ID and password, or share by link. A copied app link alone never gives access.</p>
        <Link to="/help" style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginTop: "28px", fontSize: "18px", fontWeight: "500", color: "var(--ink,#f7f7fb)" }}>How sharing works <svg viewBox="0 0 24 24" style={{ width: "18px", height: "18px", stroke: "currentColor", fill: "none", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M4 12h16M14 6l6 6-6 6"></path></svg></Link>
      </div>
    </div>
    <div style={{ borderRadius: "14px", background: "linear-gradient(180deg,#050506 0%,#24160f 36%,#6b3f2d 62%,#c9ab9a 86%,#e6dcd5 100%)", minHeight: "clamp(400px,40vw,560px)", display: "grid", placeItems: "center", padding: "clamp(28px,5vw,56px) clamp(14px,3vw,20px)" }}>
      <div style={{ background: "#ffffff", color: "#1a1a1a", borderRadius: "14px", boxShadow: "0 30px 60px -18px rgba(0,0,0,0.5)", padding: "0", fontSize: "13px", width: "min(100%,540px)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "16px 20px", borderBottom: "1px solid #eeeeee" }}><span style={{ width: "16px", height: "16px", borderRadius: "4px", background: "#e0461f" }}></span><span style={{ fontSize: "14px", fontWeight: "500" }}>Himalaya Coffee</span><span style={{ marginLeft: "auto", color: "#8a8a8a", fontSize: "12px" }}>Share</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", padding: "10px 20px", color: "#8a8a8a", fontSize: "11.5px", borderBottom: "1px solid #eeeeee" }}><span>Person</span><span>Role</span><span>Access</span></div>
        {people.map((pp, ppIndex) => (<Fragment key={ppIndex}>
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid #f2f2f2" }}>
            <span style={{ fontWeight: "500" }}>{pp.name}</span>
            <span style={{ color: "#4a4a4a" }}>{pp.role}</span>
            <span><span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "11.5px", padding: "3px 9px", borderRadius: "5px", background: `${pp.bg}`, color: `${pp.fg}` }}>{pp.access}</span></span>
          </div>
        </Fragment>))}
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))", gap: "36px 56px", marginTop: "clamp(36px,5vw,56px)" }}>
      <div><span style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--iconTile,rgba(224,70,31,0.12))", display: "grid", placeItems: "center", marginBottom: "20px" }}><svg viewBox="0 0 24 24" style={{ width: "22px", height: "22px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }}><circle cx="9" cy="8" r="4"></circle><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"></path></svg></span><h3 style={{ margin: "0 0 12px", fontSize: "21px", fontWeight: "500", letterSpacing: "-0.01em", lineHeight: "1.3" }}>Create a sign-in</h3><p style={{ margin: "0", fontSize: "16px", lineHeight: "1.65", color: "var(--mu,#acb1c0)", textWrap: "pretty" }}>Name, sign-in ID and a role. Jhino shows the details once for you to send privately.</p></div>
      <div><span style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--iconTile,rgba(224,70,31,0.12))", display: "grid", placeItems: "center", marginBottom: "20px" }}><svg viewBox="0 0 24 24" style={{ width: "22px", height: "22px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }}><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 7 9 6 9-6"></path></svg></span><h3 style={{ margin: "0 0 12px", fontSize: "21px", fontWeight: "500", letterSpacing: "-0.01em", lineHeight: "1.3" }}>Invite link</h3><p style={{ margin: "0", fontSize: "16px", lineHeight: "1.65", color: "var(--mu,#acb1c0)", textWrap: "pretty" }}>A single-use link, valid for 7 days, where the person sets their own password.</p></div>
      <div><span style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--iconTile,rgba(224,70,31,0.12))", display: "grid", placeItems: "center", marginBottom: "20px" }}><svg viewBox="0 0 24 24" style={{ width: "22px", height: "22px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }}><rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"></path></svg></span><h3 style={{ margin: "0 0 12px", fontSize: "21px", fontWeight: "500", letterSpacing: "-0.01em", lineHeight: "1.3" }}>Public or password link</h3><p style={{ margin: "0", fontSize: "16px", lineHeight: "1.65", color: "var(--mu,#acb1c0)", textWrap: "pretty" }}>Pick what visitors can do: view, add or edit. Their cookie opens nothing else.</p></div>
    </div>
  </div>
</section>

{/* PLANS */}
<section id="plans" style={{ padding: "clamp(64px,10vw,100px) 20px 32px" }}>
  <div style={{ maxWidth: "1240px", margin: "0 auto" }}>
    <div style={{ display: "flex", gap: "8px", fontSize: "15px", color: "var(--mu,#acb1c0)", paddingBottom: "20px", borderBottom: "1px solid var(--line,#2b303e)", marginBottom: "28px" }}><span>[</span><span>Plans</span><span>]</span></div>
    <div style={{ display: "flex", justifyContent: "space-between", gap: "32px 64px", flexWrap: "wrap", alignItems: "flex-end", marginBottom: "clamp(32px,5vw,56px)" }}>
      <h2 style={{ margin: "0", fontSize: "clamp(34px,3.6vw,50px)", lineHeight: "1.15", letterSpacing: "-0.03em", fontWeight: "500", textWrap: "balance", maxWidth: "660px" }}>Start free. Pay by QR when you grow.</h2>
      <div style={{ padding: "4px", border: "1px solid var(--line,#2b303e)", borderRadius: "100px", display: "flex", background: "var(--panel,#0f1218)" }}>
        <button onClick={setMonthly} style={{ border: "0", borderRadius: "100px", padding: "10px 18px", fontFamily: "inherit", fontSize: "14px", cursor: "pointer", background: `${mBg}`, color: `${mColor}` }}>Monthly</button>
        <button onClick={setYearly} style={{ border: "0", borderRadius: "100px", padding: "10px 18px", fontFamily: "inherit", fontSize: "14px", cursor: "pointer", background: `${yBg}`, color: `${yColor}` }}>{yearlyLabel}</button>
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: "16px" }}>
      {plans.map((p, pIndex) => (<Fragment key={pIndex}>
        <article style={{ padding: "32px", borderRadius: "20px", background: "var(--panel,#0f1218)", border: `1px solid ${p.border}`, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h3 style={{ margin: "0", fontSize: "21px", fontWeight: "500" }}>{p.name}</h3>
            {p.featured && (<><span style={{ fontSize: "12px", padding: "5px 12px", borderRadius: "100px", background: "rgba(224,70,31,0.12)", color: "var(--em,#ff9a80)" }}>Popular</span></>)}
          </div>
          <p style={{ margin: "8px 0 0", fontSize: "15px", color: "var(--mu,#acb1c0)" }}>{p.for}</p>
          <div style={{ marginTop: "28px", display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap" }}><span style={{ fontSize: "14px", color: "var(--mu,#acb1c0)" }}>NPR</span><strong style={{ fontSize: "46px", fontWeight: "500", letterSpacing: "-0.035em", lineHeight: "1" }}>{p.price}</strong><span style={{ fontSize: "14px", color: "var(--mu,#acb1c0)" }}>{p.per}</span></div>
          <p style={{ margin: "8px 0 28px", fontSize: "13px", color: "var(--mu,#acb1c0)" }}>{p.note}</p>
          <Link to={p.href} style={{ textAlign: "center", padding: "13px 20px", borderRadius: "100px", fontSize: "15px", fontWeight: "600", background: `${p.ctaBg}`, color: `${p.ctaColor}`, border: `1px solid ${p.ctaBorder}` }}>{p.cta}</Link>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "28px", paddingTop: "24px", borderTop: "1px solid var(--line,#2b303e)", fontSize: "15px" }}>
            {p.items.map((it, itIndex) => (<Fragment key={itIndex}>
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", lineHeight: "1.45" }}><svg viewBox="0 0 24 24" style={{ width: "16px", height: "16px", flexShrink: "0", marginTop: "3px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="m5 12 4 4L19 6"></path></svg><span>{it}</span></div>
            </Fragment>))}
          </div>
        </article>
      </Fragment>))}
    </div>
    <p style={{ margin: "20px 0 0", fontSize: "14px", color: "var(--mu,#acb1c0)" }}>An ended plan counts as Free Forever, and apps keep working.</p>
  </div>
</section>

{/* FAQ */}
<section id="faq" style={{ padding: "clamp(64px,10vw,100px) 20px 32px" }}>
  <div style={{ maxWidth: "1240px", margin: "0 auto", background: "var(--panel,#0f1218)", border: "1px solid var(--line,#2b303e)", borderRadius: "20px", padding: "clamp(20px,4vw,60px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,360px),1fr))", gap: "48px 72px" }}>
    <div>
      <h2 style={{ margin: "0", fontSize: "clamp(34px,3.6vw,50px)", lineHeight: "1.15", letterSpacing: "-0.03em", fontWeight: "500", textWrap: "balance", maxWidth: "660px", marginBottom: "20px" }}>A few things before you begin</h2>
      <p style={{ margin: "0", fontSize: "clamp(17px,1.5vw,20px)", lineHeight: "1.55", color: "var(--mu,#acb1c0)", maxWidth: "520px", textWrap: "pretty" }}>Good questions. Straightforward answers.</p>
      <Link to="/help" style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginTop: "28px", fontSize: "18px", fontWeight: "500", color: "var(--ink,#f7f7fb)" }}>Visit the help centre <svg viewBox="0 0 24 24" style={{ width: "18px", height: "18px", stroke: "currentColor", fill: "none", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M4 12h16M14 6l6 6-6 6"></path></svg></Link>
    </div>
    <div>
      {faqs.map((q, qIndex) => (<Fragment key={qIndex}>
        <div style={{ borderTop: "1px solid var(--line,#2b303e)" }}>
          <button onClick={q.toggle} aria-expanded={q.open} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "20px", padding: "22px 0", background: "transparent", border: "none", color: "var(--ink,#f7f7fb)", fontFamily: "inherit", fontSize: "clamp(17px,1.6vw,20px)", textAlign: "left", cursor: "pointer", letterSpacing: "-0.01em" }}>
            <span>{q.q}</span>
            <span style={{ width: "26px", height: "26px", borderRadius: "50%", background: "var(--chip,rgba(255,255,255,0.08))", display: "grid", placeItems: "center", flexShrink: "0" }}><svg viewBox="0 0 24 24" style={{ width: "14px", height: "14px", stroke: "currentColor", fill: "none", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", transform: `rotate(${q.rot})`, transition: "transform .25s" }}><path d="m6 9 6 6 6-6"></path></svg></span>
          </button>
          {q.open && (<>
            <p style={{ margin: "-6px 0 22px", paddingRight: "40px", fontSize: "16px", lineHeight: "1.6", color: "var(--mu,#acb1c0)" }}>{q.a}</p>
          </>)}
        </div>
      </Fragment>))}
    </div>
  </div>
</section>

{/* FINALE */}
<section style={{ background: "#e0461f", padding: "clamp(64px,10vw,95px) 20px 0", textAlign: "center", color: "#1c1d16", overflow: "hidden", marginTop: "68px" }}>
  <div style={{ fontFamily: "'Geist Mono',monospace", fontSize: "12px", letterSpacing: ".11em", textTransform: "uppercase" }}>It's your turn.</div>
  <h2 style={{ fontSize: "clamp(51px,8.2vw,113px)", letterSpacing: "-.065em", lineHeight: ".98", margin: "25px auto 30px", maxWidth: "1050px", fontWeight: "700", color: "#FFFFFF" }}>From “I made this”<br />to “<em style={{ fontStyle: "normal", fontFamily: "inherit", fontWeight: "inherit", letterSpacing: "inherit" }}>take a look.</em>”</h2>
  <p style={{ margin: "0 auto 29px", fontSize: "18px", color: "#4a1606", maxWidth: "520px" }}>Your next idea deserves more than a folder.</p>
  <Link className="jh-h10" to={start} style={{ display: "inline-flex", justifyContent: "center", alignItems: "center", gap: "15px", minWidth: "215px", padding: "15px 25px", minHeight: "54px", borderRadius: "100px", background: "#1a1b1b", color: "#ffffff", fontSize: "15px", fontWeight: "700", transition: "background .2s,transform .3s" }}>
    Publish your HTML
    <svg viewBox="0 0 24 24" style={{ width: "18px", height: "18px", stroke: "currentColor", fill: "none", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M12 17V3M7 8l5-5 5 5M4 16v5h16v-5"></path></svg>
  </Link>
  <small style={{ display: "block", fontSize: "12px", marginTop: "20px", color: "#4a1606" }}>Start free. Bring your file. Keep your design.</small>
  <div className="jh-watermark" aria-hidden="true" style={{ fontSize: "clamp(130px,25vw,355px)", fontWeight: "700", lineHeight: ".82", letterSpacing: "-.075em", margin: "75px 0 -0.34em", color: "#191c15", opacity: ".12", userSelect: "none", pointerEvents: "none" }}><Wordmark /></div>
</section>


    </SiteFrame>
  );
}

/* ---------------- shared pieces of the inner pages ---------------- */

function Bracket({ children }: { children: ReactNode }) {
  return <div className="jh-bracket"><span>[</span><span>{children}</span><span>]</span></div>;
}

function PageHead({ eyebrow, title, lede, children }: { eyebrow: string; title: string; lede?: ReactNode; children?: ReactNode }) {
  const hasPunctuation = /[.!?]$/.test(title);
  return (
    <section className="jh-pagehead">
      <div className="jh-wrap">
        <div className="jh-eyebrow">{eyebrow}</div>
        <h1>{title}{hasPunctuation ? '' : <span className="jh-dot">.</span>}</h1>
        {lede && <p className="jh-lede">{lede}</p>}
        {children}
      </div>
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span className="jh-acc-ic" aria-hidden="true">
      <svg viewBox="0 0 24 24" style={{ transform: `rotate(${open ? 180 : 0}deg)` }}><path d="m6 9 6 6 6-6" /></svg>
    </span>
  );
}

/** The design's question list: one open at a time. */
function Accordion({ items, first = 0 }: { items: [string, ReactNode][]; first?: number }) {
  const [open, setOpen] = useState(first);
  return (
    <div className="jh-acc">
      {items.map(([q, a], i) => (
        <div key={q} className="jh-acc-item">
          <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
            <span>{q}</span><Chevron open={open === i} />
          </button>
          {open === i && <div className="jh-acc-body">{a}</div>}
        </div>
      ))}
    </div>
  );
}

const Arrow = () => <svg viewBox="0 0 24 24" className="jh-arrow" aria-hidden="true"><path d="M4 12h16M14 6l6 6-6 6" /></svg>;

/* ---------------- pricing ---------------- */

export function PricingPage({ signedIn = false }: { signedIn?: boolean }) {
  usePageMeta(
    'Pricing: Free, Plus and Pro Plans in Rupees | Jhino',
    'Free forever for one client. Plus NPR 500/mo, Pro NPR 2,000/mo. Includes your own page, short links, and client portals. Pay monthly or yearly by QR.'
  );

  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [faq, setFaq] = useState(0);
  const live = usePlans();
  const yearly = billing === 'yearly';
  const on = { bg: 'var(--tog,#262c3a)', c: 'var(--ink,#f7f7fb)' }, off = { bg: 'transparent', c: 'var(--mu,#acb1c0)' };
  const mBg = yearly ? off.bg : on.bg, mColor = yearly ? off.c : on.c;
  const yBg = yearly ? on.bg : off.bg, yColor = yearly ? on.c : off.c;
  const months = freeMonthsText(bestFreeMonths(live));
  const yearlyLabel = months ? `Yearly · ${months}` : 'Yearly';
  const plans = live.map((p, i) => planView(p, live[i - 1], yearly, signedIn));
  const faqs = accordion(PRICING_FAQ.map(([q, a]) => ({ q, a })), faq, setFaq);
  const start = signedIn ? '/apps' : '/signup';

  return (
    <SiteFrame signedIn={signedIn}>
      <PageHead
        eyebrow="Plans &amp; Pricing"
        title="Start free. Pay by QR when you grow"
        lede="Free Forever for one client. Simple, transparent pricing in Nepali rupees for studios, agencies, and creators. Upgrade whenever you need more clients."
      >
        <div style={{ marginTop: "28px", display: "inline-flex", padding: "4px", border: "1px solid var(--line,#2b303e)", borderRadius: "100px", background: "var(--panel,#0f1218)" }}>
          <button onClick={() => setBilling('monthly')} style={{ border: "0", borderRadius: "100px", padding: "10px 20px", fontFamily: "inherit", fontSize: "14px", cursor: "pointer", background: `${mBg}`, color: `${mColor}` }}>Monthly</button>
          <button onClick={() => setBilling('yearly')} style={{ border: "0", borderRadius: "100px", padding: "10px 20px", fontFamily: "inherit", fontSize: "14px", cursor: "pointer", background: `${yBg}`, color: `${yColor}` }}>{yearlyLabel}</button>
        </div>
      </PageHead>

      <section id="plans" style={{ padding: "0 20px clamp(48px,6vw,80px)" }}>
        <div style={{ maxWidth: "1240px", margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: "16px" }}>
            {plans.map((p, pIndex) => (
              <Fragment key={pIndex}>
                <article style={{ padding: "32px", borderRadius: "20px", background: "var(--panel,#0f1218)", border: `1px solid ${p.border}`, display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ margin: "0", fontSize: "21px", fontWeight: "500" }}>{p.name}</h3>
                    {p.featured && <span style={{ fontSize: "12px", padding: "5px 12px", borderRadius: "100px", background: "rgba(224,70,31,0.12)", color: "var(--em,#ff9a80)" }}>Popular</span>}
                  </div>
                  <p style={{ margin: "8px 0 0", fontSize: "15px", color: "var(--mu,#acb1c0)" }}>{p.for}</p>
                  <div style={{ marginTop: "28px", display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "14px", color: "var(--mu,#acb1c0)" }}>NPR</span>
                    <strong style={{ fontSize: "46px", fontWeight: "500", letterSpacing: "-0.035em", lineHeight: "1" }}>{p.price}</strong>
                    <span style={{ fontSize: "14px", color: "var(--mu,#acb1c0)" }}>{p.per}</span>
                  </div>
                  <p style={{ margin: "8px 0 28px", fontSize: "13px", color: "var(--mu,#acb1c0)" }}>{p.note}</p>
                  <Link to={p.href} style={{ textAlign: "center", padding: "13px 20px", borderRadius: "100px", fontSize: "15px", fontWeight: "600", background: `${p.ctaBg}`, color: `${p.ctaColor}`, border: `1px solid ${p.ctaBorder}` }}>{p.cta}</Link>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "28px", paddingTop: "24px", borderTop: "1px solid var(--line,#2b303e)", fontSize: "15px" }}>
                    {p.items.map((it, itIndex) => (
                      <Fragment key={itIndex}>
                        <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", lineHeight: "1.45" }}>
                          <svg viewBox="0 0 24 24" style={{ width: "16px", height: "16px", flexShrink: "0", marginTop: "3px", stroke: "url(#jhIconGrad)", fill: "none", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="m5 12 4 4L19 6"></path></svg>
                          <span>{it}</span>
                        </div>
                      </Fragment>
                    ))}
                  </div>
                </article>
              </Fragment>
            ))}
          </div>
          <p style={{ margin: "20px 0 0", fontSize: "14px", color: "var(--mu,#acb1c0)" }}>An ended plan counts as Free Forever, and apps keep working.</p>
        </div>
      </section>

      {/* VALUE HIGHLIGHTS */}
      <section style={{ padding: "clamp(32px,5vw,64px) 20px" }}>
        <div style={{ maxWidth: "1240px", margin: "0 auto", background: "var(--panel,#0f1218)", border: "1px solid var(--line,#2b303e)", borderRadius: "20px", padding: "clamp(24px,4vw,56px)" }}>
          <div style={{ display: "flex", gap: "8px", fontSize: "15px", color: "var(--mu,#acb1c0)", paddingBottom: "20px", borderBottom: "1px solid var(--line,#2b303e)", marginBottom: "28px" }}><span>[</span><span>What is included</span><span>]</span></div>
          <h2 style={{ margin: "0 0 32px", fontSize: "clamp(26px,2.8vw,38px)", letterSpacing: "-0.02em", fontWeight: "500" }}>Everything your studio needs to publish and deliver</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))", gap: "32px 48px" }}>
            <div>
              <h3 style={{ margin: "0 0 10px", fontSize: "19px", fontWeight: "500" }}>Instant live website</h3>
              <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.6", color: "var(--mu,#acb1c0)" }}>Bring an HTML file or ZIP package made anywhere. It goes live at once at jhino.com/you/app with SSL.</p>
            </div>
            <div>
              <h3 style={{ margin: "0 0 10px", fontSize: "19px", fontWeight: "500" }}>Real-time live sync</h3>
              <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.6", color: "var(--mu,#acb1c0)" }}>Data in localStorage and IndexedDB automatically syncs across all devices without touching backend code.</p>
            </div>
            <div>
              <h3 style={{ margin: "0 0 10px", fontSize: "19px", fontWeight: "500" }}>Client portal approval</h3>
              <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.6", color: "var(--mu,#acb1c0)" }}>Video delivery with timestamped comments, photo proofing (Pick/Maybe/No), invoices, and shoot bookings.</p>
            </div>
            <div>
              <h3 style={{ margin: "0 0 10px", fontSize: "19px", fontWeight: "500" }}>Link-in-bio page</h3>
              <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.6", color: "var(--mu,#acb1c0)" }}>Your own jhino.com/username page with 40 designer themes, socials, apps, and visitor analytics.</p>
            </div>
            <div>
              <h3 style={{ margin: "0 0 10px", fontSize: "19px", fontWeight: "500" }}>Branded short links</h3>
              <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.6", color: "var(--mu,#acb1c0)" }}>Turn long links into compact addresses. Track clicks, devices, referrers, and locations in real time.</p>
            </div>
            <div>
              <h3 style={{ margin: "0 0 10px", fontSize: "19px", fontWeight: "500" }}>Pay by QR in rupees</h3>
              <p style={{ margin: "0", fontSize: "15px", lineHeight: "1.6", color: "var(--mu,#acb1c0)" }}>Scan our Fonepay QR code with any Nepali bank or wallet. We activate your plan swiftly.</p>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING FAQ */}
      <section id="faq" style={{ padding: "clamp(48px,8vw,80px) 20px" }}>
        <div style={{ maxWidth: "1240px", margin: "0 auto", background: "var(--panel,#0f1218)", border: "1px solid var(--line,#2b303e)", borderRadius: "20px", padding: "clamp(20px,4vw,60px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,360px),1fr))", gap: "48px 72px" }}>
          <div>
            <h2 style={{ margin: "0", fontSize: "clamp(32px,3.4vw,46px)", lineHeight: "1.15", letterSpacing: "-0.03em", fontWeight: "500", textWrap: "balance", maxWidth: "660px", marginBottom: "20px" }}>Questions about plans &amp; billing</h2>
            <p style={{ margin: "0", fontSize: "clamp(16px,1.4vw,19px)", lineHeight: "1.55", color: "var(--mu,#acb1c0)", maxWidth: "520px", textWrap: "pretty" }}>Everything you need to know about pricing, payments, and client access.</p>
            <Link to="/help" style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginTop: "28px", fontSize: "17px", fontWeight: "500", color: "var(--ink,#f7f7fb)" }}>Visit the help centre <svg viewBox="0 0 24 24" style={{ width: "18px", height: "18px", stroke: "currentColor", fill: "none", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M4 12h16M14 6l6 6-6 6"></path></svg></Link>
          </div>
          <div>
            {faqs.map((q, qIndex) => (
              <Fragment key={qIndex}>
                <div style={{ borderTop: "1px solid var(--line,#2b303e)" }}>
                  <button onClick={q.toggle} aria-expanded={q.open} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "20px", padding: "22px 0", background: "transparent", border: "none", color: "var(--ink,#f7f7fb)", fontFamily: "inherit", fontSize: "clamp(17px,1.6vw,20px)", textAlign: "left", cursor: "pointer", letterSpacing: "-0.01em" }}>
                    <span>{q.q}</span>
                    <span style={{ width: "26px", height: "26px", borderRadius: "50%", background: "var(--chip,rgba(255,255,255,0.08))", display: "grid", placeItems: "center", flexShrink: "0" }}><svg viewBox="0 0 24 24" style={{ width: "14px", height: "14px", stroke: "currentColor", fill: "none", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", transform: `rotate(${q.rot})`, transition: "transform .25s" }}><path d="m6 9 6 6 6-6"></path></svg></span>
                  </button>
                  {q.open && <p style={{ margin: "-6px 0 22px", paddingRight: "40px", fontSize: "16px", lineHeight: "1.6", color: "var(--mu,#acb1c0)" }}>{q.a}</p>}
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* FINALE */}
      <section style={{ background: "#e0461f", padding: "clamp(56px,8vw,80px) 20px", textAlign: "center", color: "#1c1d16" }}>
        <h2 style={{ fontSize: "clamp(38px,5vw,68px)", letterSpacing: "-.04em", lineHeight: "1.05", margin: "0 auto 20px", maxWidth: "850px", fontWeight: "700", color: "#FFFFFF" }}>Ready to publish your HTML?</h2>
        <p style={{ margin: "0 auto 28px", fontSize: "18px", color: "#4a1606", maxWidth: "520px" }}>Start free today. No card required. Bring your HTML file or ZIP.</p>
        <Link className="jh-h10" to={start} style={{ display: "inline-flex", justifyContent: "center", alignItems: "center", gap: "12px", minWidth: "200px", padding: "15px 28px", borderRadius: "100px", background: "#1a1b1b", color: "#ffffff", fontSize: "15px", fontWeight: "700" }}>
          Publish your HTML
          <svg viewBox="0 0 24 24" style={{ width: "18px", height: "18px", stroke: "currentColor", fill: "none", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M12 17V3M7 8l5-5 5 5M4 16v5h16v-5"></path></svg>
        </Link>
      </section>
    </SiteFrame>
  );
}

/* ---------------- help ---------------- */

const GUIDES: [string, ReactNode][] = [
  ['Make your first app', 'Sign in, then use Create HTML (say who it is for and tick the features it needs) or Upload HTML (your own .html or .zip file). It is live as soon as it is saved.'],
  ['Share with a client', 'Open the app and press Share. Make a sign-in for the client, send an invite link, or turn on a public or password link, and pick what visitors can do: view, add or edit.'],
  ['Set up your page', 'Open My page from the dashboard. Add links, headings, text, videos, your apps and social icons, then pick a layout and a design. Your page lives at jhino.com/your-username.'],
  ['Make a short link', 'Open Short links, paste a long address and, on Plus and Pro, name it yourself. Every click is counted.'],
  ['Upgrade your plan', 'Account → Plan & usage → choose a plan. Pay by QR, upload the screenshot, and the plan turns on after we check it.'],
  ['Hide the top bar', 'On Plus and Pro, open the app, press ⋯ and choose Hide top bar. It opens like a standalone app; the small corner button brings the menu back.'],
  ['Forgot your password', 'On the sign-in page choose Forgot password. The link in the email works once, for 30 minutes.'],
];

// Keep in step with HELP_FAQ in server/seo.ts.
export const MORE_FAQ: [string, string][] = [
  ['Will any HTML file work?', 'Yes. Plain HTML, CSS and JavaScript that saves with localStorage or IndexedDB syncs between everyone with no changes. Its own design stays exactly as it is.'],
  ['Can I use my own address?', 'Yes. Pick jhino.com/your-name when you create an app, or later in Share. Each address is unique. The page opens at that exact address, with no redirect.'],
  ['What is jhino.com/your-name?', 'Your own page, like a link in bio: your links, socials, videos and apps in one of 40 designs, as a list or a full profile. It can show up on Google. Share it anywhere and see who clicks what.'],
  ['Can my app show up on Google?', 'On Pro, yes: tick "Show on Google" in Share, then give it a title, a description, an address and a keyword. It becomes a public page anyone can open without signing in, and search engines can list it. Up to 10 pages on Pro.'],
  ['How big can a file be?', 'Each plan shows its largest file size. For bigger videos, paste a Google Drive, Dropbox or YouTube link: it shows as a proper preview.'],
  ['Where is my data?', 'On the Jhino server, backed up every day, and never sold. The Privacy page has the details.'],
];

export function HelpPage({ signedIn }: { signedIn: boolean }) {
  usePageMeta(
    'Help & Guides: Tutorials, FAQs and Support | Jhino',
    'Learn how to publish HTML apps, share client portals, set up your bio page, create short links, and upgrade your plan. Contact our support team anytime.'
  );
  const [kind, setKind] = useState<'contact' | 'problem' | 'feedback'>(() => { const k = new URLSearchParams(location.search).get('kind'); return k === 'problem' || k === 'feedback' ? k : 'contact'; });
  const [form, setForm] = useState({ email: '', subject: '', message: '' });
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState('');
  const [ref] = useState(() => new URLSearchParams(location.search).get('ref') ?? '');
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setState('busy'); setError('');
    try {
      await post('/api/support', {
        kind, subject: form.subject, message: form.message, email: signedIn ? undefined : form.email,
        diagnostics: kind === 'problem' ? { page: document.referrer || location.pathname, errorRef: ref, appVersion: 'web', screen: `${innerWidth}x${innerHeight}` } : undefined,
      });
      setState('sent');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not send.'); setState('idle'); }
  };
  // Opened from a "Report a problem" button: go straight to the form.
  useEffect(() => { if (ref || location.hash === '#contact') requestAnimationFrame(() => document.getElementById('contact')?.scrollIntoView()); }, [ref]);

  return (
    <SiteFrame signedIn={signedIn}>
      <PageHead eyebrow="Help centre" title="How can we help you?" lede="Guides for your first week, straight answers, and a way to reach us. We reply by email, usually within a working day.">
        <div className="jh-head-actions">
          <a className="jh-pill jh-pill-accent" href="#contact">Write to us <Arrow /></a>
          <a className="jh-pill" href="#questions">Read the questions</a>
        </div>
      </PageHead>

      <section className="jh-sec">
        <div className="jh-wrap">
          <div className="jh-panel">
            <Bracket>Guides</Bracket>
            <div className="jh-split">
              <div>
                <h2 className="jh-title">Your first week with Jhino</h2>
                <p className="jh-sub">From the first upload to a client saying yes. Each guide is a few lines: open one.</p>
              </div>
              <Accordion items={GUIDES} />
            </div>
          </div>
        </div>
      </section>

      <section className="jh-sec" id="questions">
        <div className="jh-wrap">
          <Bracket>Questions</Bracket>
          <div className="jh-split">
            <div>
              <h2 className="jh-title">Good questions. Straightforward answers.</h2>
              <p className="jh-sub">Plans, payment, sharing and your data. Not here? Write to us below.</p>
            </div>
            <Accordion items={[...HOME_FAQ, ...MORE_FAQ]} first={-1} />
          </div>
        </div>
      </section>

      <section className="jh-sec" id="contact">
        <div className="jh-wrap jh-contact">
          <div className="jh-panel jh-contact-copy">
            <Bracket>Write to us</Bracket>
            <h2 className="jh-title">Still stuck? Tell us.</h2>
            <p className="jh-sub">A person reads every message. Report a problem and we add the page you came from and your screen size, so we can find it. Nothing else.</p>
            <ul className="jh-facts">
              <li><b>Reply</b><span>By email, usually within a working day</span></li>
              <li><b>Email</b><a href="mailto:jhinoapp@gmail.com">jhinoapp@gmail.com</a></li>
            </ul>
          </div>
          <div className="jh-stage">
            <div className="jh-card">
              {state === 'sent' ? (
                <div className="jh-sent" role="status">
                  <b>Thank you. We have your message.</b>
                  <p>We reply by email, usually within a working day.</p>
                  <button type="button" className="jh-btn" onClick={() => { setState('idle'); setForm({ email: form.email, subject: '', message: '' }); }}>Send another</button>
                </div>
              ) : (
                <form onSubmit={send} className="jh-form">
                  <div className="jh-card-head"><span>New message</span><span>{kind === 'problem' ? 'Problem report' : kind === 'feedback' ? 'Feedback' : 'Support'}</span></div>
                  <div className="jh-seg" role="radiogroup" aria-label="What is this about">
                    {([['contact', 'Support'], ['problem', 'A problem'], ['feedback', 'Feedback']] as const).map(([k, l]) => (
                      <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>{l}</button>
                    ))}
                  </div>
                  {!signedIn && <label className="jh-field"><span>Your email</span><input type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>}
                  <label className="jh-field"><span>Subject</span><input required maxLength={140} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
                  <label className="jh-field"><span>Message</span><textarea required rows={5} maxLength={5000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
                  {kind === 'problem' && ref && <p className="jh-hint">Error reference {ref} is added for us.</p>}
                  {error && <p className="jh-error" role="alert">{error}</p>}
                  <button className="jh-btn" disabled={state === 'busy'}>{state === 'busy' ? 'Sending…' : 'Send message'}</button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
      <div className="jh-wrap jh-legal-links"><Link to="/terms">Terms of Service</Link><span aria-hidden="true">·</span><Link to="/privacy">Privacy Policy</Link><span aria-hidden="true">·</span><a href="/sitemap">Sitemap</a></div>
    </SiteFrame>
  );
}

/* ---------------- terms and privacy ---------------- */

type Part = [id: string, title: string, body: ReactNode];

function LegalPage({ title, updated, parts, signedIn }: { title: string; updated: string; parts: Part[]; signedIn: boolean }) {
  const { path } = useRoute();
  return (
    <SiteFrame signedIn={signedIn}>
      <PageHead eyebrow="Legal" title={title} lede={<>Last updated <span className="jh-mono">{updated}</span></>}>
        <nav className="jh-switch" aria-label="Legal pages">
          <Link to="/terms" aria-current={path === '/terms' ? 'page' : undefined}>Terms</Link>
          <Link to="/privacy" aria-current={path === '/privacy' ? 'page' : undefined}>Privacy</Link>
        </nav>
      </PageHead>
      <section className="jh-sec jh-sec-tight">
        <div className="jh-wrap jh-legal">
          <nav className="jh-toc" aria-label="On this page">
            <Bracket>On this page</Bracket>
            <ol>{parts.map(([id, t], i) => <li key={id}><a href={`#${id}`}><span className="jh-mono">{String(i + 1).padStart(2, '0')}</span>{t}</a></li>)}</ol>
          </nav>
          <article className="jh-panel jh-prose">
            {parts.map(([id, t, body], i) => (
              <section key={id} id={id}>
                <h2><span className="jh-mono">{String(i + 1).padStart(2, '0')}</span>{t}</h2>
                {body}
              </section>
            ))}
            <p className="jh-prose-end">Questions about this page? Write to us through <Link to="/help">Help</Link>.</p>
          </article>
        </div>
      </section>
    </SiteFrame>
  );
}

export function TermsPage({ signedIn }: { signedIn: boolean }) {
  usePageMeta(
    'Terms of Service | Jhino',
    'Read the Terms of Service for Jhino: account terms, content ownership, HTML app hosting, plans and QR payments, service availability, and usage rules.'
  );
  return (
    <LegalPage title="Terms of Service" updated="27 September 2026" signedIn={signedIn} parts={[
      ['using', 'Using Jhino', <p>Jhino hosts small web apps (HTML) and the data people save in them, pages at jhino.com/you and short links. By creating an account you agree to these terms. If you use Jhino for a business, you agree for that business.</p>],
      ['account', 'Your account', <p>Keep your password private and tell us if you think someone else used your account. You are responsible for what happens under it, including sign-ins and links you create for other people.</p>],
      ['content', 'Your content', <p>The apps, data and links you add stay yours. You give us permission to store, copy and show them only to run Jhino for you and the people you share with, and, when you turn on Show on Google, to let search engines list that page. Do not upload anything illegal, harmful, or that you do not have the right to share, and do not use Jhino to attack or spam anyone. We may remove content or suspend accounts that break these rules.</p>],
      ['plans', 'Plans and payment', <p>Free Forever costs nothing. Paid plans are paid monthly or yearly, at the prices and with the limits (apps, addresses, short links and largest file) shown in the Plans section of our home page when you pay. Each address on jhino.com belongs to one app and is unique. Plans are paid by QR. A plan turns on after we verify the payment and runs for the month or year you paid for; if we cannot verify it, your plan stays as it was and we tell you why. When a plan ends, the account counts as Free Forever and its apps keep working. If something went wrong with a payment, write to us through Help.</p>],
      ['availability', 'Availability', <p>We work to keep Jhino running and backed up, but we cannot promise it will never be interrupted. Keep your own copy of anything you cannot afford to lose; you can download your data from Account at any time.</p>],
      ['ending', 'Ending', <p>You can delete your account in Account → Privacy & data. We may close accounts that break these terms. We will change these terms only with notice in the app.</p>],
    ]} />
  );
}

export function PrivacyPage({ signedIn }: { signedIn: boolean }) {
  usePageMeta(
    'Privacy Policy | Jhino',
    'Learn how Jhino protects your privacy: data storage, zero-tracking analytics, client portal privacy, backups, and security. We never sell your data.'
  );
  return (
    <LegalPage title="Privacy Policy" updated="27 September 2026" signedIn={signedIn} parts={[
      ['keep', 'What we keep', <p>Your name, email, the profile details you choose to add, your apps and the data saved in them, payment records (amount, plan, reference and the screenshot you upload), and security records such as sign-in times, device type and IP address.</p>],
      ['why', 'Why', <p>To run your account and your apps, to verify payments, to keep accounts safe (for example to warn you about a new sign-in), and to answer you when you write to us. We do not sell your data and we do not show ads.</p>],
      ['cookies', 'Visits and cookies', <p>We count visits to Jhino pages and apps (which page, the country, the kind of device and browser, and the site you came from) to see what is used. A visitor is counted with a code that changes every day, so we cannot follow anyone from one day to the next, and these counts store no IP address. We use no advertising or tracking cookies: only the cookies that keep you signed in and protect forms, which Jhino needs to work. Your choice of light or dark website is kept in your own browser.</p>],
      ['who', 'Who sees it', <p>The people you share an app with see that app and what is saved in it. Your page at jhino.com/you, and any app you put on Google, are public. Our administrators can see account and payment records to support you and verify payments; they never see your password. Payment screenshots are private to you and our administrators.</p>],
      ['services', 'Services we use', <p>Jhino runs on our own server with Hostinger (in India). Cloudflare delivers the site and protects it from attacks, so your requests pass through it. Resend sends our emails (such as your sign-in codes). Each only handles what it needs for that job.</p>],
      ['backups', 'Backups and how long we keep things', <p>We back up Jhino every day and keep those copies for 30 days, and the server is backed up weekly, so your work survives an outage. Security records (sign-ins, codes and emails sent) are kept for your account's safety; email contents are cleared after 14 days. Messages you send us through Help are kept to answer you and to keep a record of support.</p>],
      ['emails', 'Emails', <p>Security and account emails (verification, password reset, sign-in alerts) are always sent. Product news and marketing are off unless you turn them on in Account → Notifications.</p>],
      ['choices', 'Your choices', <p>You can change your details, download your data, and delete your account from Account at any time. When you delete it, your apps go with it; payment records are kept for accounting without your account.</p>],
    ]} />
  );
}

