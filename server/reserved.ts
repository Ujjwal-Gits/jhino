/*
 * Names a person may not take as their own username (jhino.com/<username>): the pages any company
 * site has (faq, services, about-us…), words that would read as Jhino or its staff, big brands and
 * payment services people trust, and a few offensive ones. A super admin can still give any of these
 * (except the paths Jhino itself uses, which RESERVED in publicshare.ts keeps for everyone).
 *
 * Names are compared loosely: dashes and underscores are ignored, a trailing number is ignored, and
 * common wrappers are peeled off ("our-services", "servicespage", "contact-us", "faqs", "the-team").
 */

const WORDS = `
about aboutus about-me aboutme who whoweare story ourstory history mission vision values culture
team people staff crew founders founder leadership leaders management board directors partners partner
careers career jobs job hiring hire vacancy vacancies openings apply recruit recruitment internship internships
press news newsroom media mediakit presskit announcements announcement updates update changelog release releases
blog blogs article articles post posts stories journal magazine insights resources resource library
faq faqs frequentlyaskedquestions questions question answers answer qa askus ask howto how guide guides
tutorial tutorials learn learning academy course courses training webinar webinars workshop workshops
help helpcenter helpdesk support customersupport customerservice customercare care service services
serviceareas solution solutions offer offers offering offerings product products feature features
pricing price prices plan plans package packages quote quotes estimate estimates rates rate tariff
portfolio work works ourwork projects project casestudies casestudy cases case showcase gallery galleries
photos photo pictures images videos video media reels reel showreel clients client customers customer
testimonials testimonial reviews review ratings feedback success successstories references
contact contactus contacts getintouch reachus callus enquiry enquiries inquiry inquiries message messages
location locations address addresses directions map maps office offices branch branches headquarters hq
store stores shop shops shopping cart basket checkout order orders ordernow buy sell sale sales deals deal
discount discounts coupon coupons promo promos promotion promotions offerzone giftcard giftcards gift gifts
catalog catalogue collection collections category categories tag tags brand brands shipping delivery
returns return refund refunds exchange warranty guarantee tracking track trackorder invoice invoices
booking bookings book bookonline appointment appointments schedule schedules calendar reservations reserve
menu menus event events tickets ticket registration register signup signin login logout logon account
accounts profile profiles settings preferences dashboard portal members member membership subscribe
subscription subscriptions unsubscribe newsletter newsletters community forum forums discussion groups group
home homepage index main start welcome landing default page pages site website web www www1 www2
search find explore discover browse directory listing listings archive archives sitemap feed rss atom
terms termsofservice termsandconditions tos conditions legal legalnotice imprint privacy privacypolicy
policy policies cookie cookies cookiepolicy gdpr dpa compliance accessibility disclaimer copyright dmca
security trust safety status uptime health report reports abuse spam phishing fraud scam
download downloads app apps application applications mobile android ios tools tool integrations
integration plugins plugin extensions api developer developers docs documentation sdk
task tasks todo todos project-management workspace workspaces board boards inbox notifications
investors investor ir funding donate donation donations sponsor sponsors sponsorship charity csr
sustainability environment esg affiliate affiliates referral referrals rewards loyalty ambassador ambassadors
partnerships reseller resellers dealers dealer distributors wholesale franchise
company business corporate corporation enterprise enterprises agency agencies studio studios firm group
organization organisation official officials verified admin admins administrator administrators root
superadmin sysadmin moderator moderators mod mods owner owners operator operators staffonly internal
billing payment payments pay payout payouts wallet account-settings accountsettings
nepal kathmandu lalitpur bhaktapur pokhara government gov govt ministry police army embassy
esewa khalti fonepay imepay connectips nabil nicasia globalime himalayan everest
google gmail youtube facebook meta instagram whatsapp messenger tiktok twitter x threads linkedin
snapchat telegram viber pinterest reddit discord apple icloud microsoft outlook amazon netflix spotify
paypal stripe visa mastercard openai chatgpt claude anthropic
sewa seva sampark hamro barema jankari prashna uttar kaam kam sewaharu
test tests testing demo demos example examples sample samples null undefined none nil void anonymous
guest guests user users username everyone all public private system systems
sex porn porno xxx nude nudes adult escort escorts casino gambling bet betting
fuck shit bitch bastard asshole dick pussy cunt slut whore nigger nigga faggot retard
`;

const SET = new Set(WORDS.split(/\s+/).map((w) => w.replace(/[-_]/g, '')).filter(Boolean));

/** Words people wrap around a page name: "our services", "services page", "contact us". */
const PREFIXES = ['our', 'my', 'the', 'all', 'get', 'view', 'see', 'your', 'main', 'official', 'new', 'top', 'best', 'free', 'online', 'jhino', 'go', 'visit', 'meet'];
const SUFFIXES = ['page', 'pages', 'list', 'info', 'us', 'now', 'here', 'hub', 'center', 'centre', 'section', 'online', 'area', 'zone', 'desk', 'portal', 'site', 'official', 'team', 'dept', 'department', 'np', 'nepal'];
/** Names that must never appear anywhere inside a username someone picks. */
const INSIDE = ['jhino', 'jhlno', 'jh1no', 'superadmin', 'sysadmin', 'administrator', 'moderator', 'official', 'verified', 'support', 'helpdesk', 'security', 'billing', 'noreply'];

function singular(w: string): string[] {
  const out = [w];
  if (w.endsWith('ies') && w.length > 4) out.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es') && w.length > 3) out.push(w.slice(0, -2));
  if (w.endsWith('s') && w.length > 3) out.push(w.slice(0, -1));
  return out;
}

/** Every form of the name worth checking: as typed, without wrappers, without a plural or a trailing number. */
function forms(name: string): Set<string> {
  const base = name.toLowerCase().replace(/[-_.]/g, '');
  const seeds = new Set([base, base.replace(/\d+$/, '')]);
  const out = new Set<string>();
  for (const s of seeds) {
    const layer = [s];
    for (const p of PREFIXES) if (s.startsWith(p) && s.length > p.length + 1) layer.push(s.slice(p.length));
    for (const w of [...layer]) {
      for (const x of SUFFIXES) if (w.endsWith(x) && w.length > x.length + 1) layer.push(w.slice(0, -x.length));
    }
    for (const w of layer) for (const f of singular(w)) if (f) out.add(f);
  }
  return out;
}

/** Why a person may not take this name themselves, or null when they may. */
export function reservedReason(name: string): string | null {
  const flat = name.toLowerCase().replace(/[-_.]/g, '');
  if (INSIDE.some((w) => flat.includes(w))) return 'looks like Jhino or its staff';
  for (const f of forms(name)) if (SET.has(f)) return 'is a general word that could be anyone\'s page';
  return null;
}
