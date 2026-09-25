import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import '../landing.css';
import { ApiError, post } from '../api';
import { Link, useRoute } from '../context';
import { PLAN_CARDS, nprAmount, priceFor, type Period, type PlanCard } from '../plans';
import { Icon } from '../ui';

/*
 * The public site: home, help, terms and privacy.
 * Direction: a print-shop job sheet. One tight grotesque set very large, IBM Plex Mono for every
 * readout (times, rupees, BS/AD dates, addresses), ruled hairlines instead of boxes and shadows,
 * paper and ink with one vermilion signal. One moving moment: the hero booking made on the studio's
 * screen lands on the client's phone. Everything else holds still.
 */

export function SiteHeader({ signedIn = false }: { signedIn?: boolean }) {
  const { path } = useRoute();
  return (
    <header className="lp-head">
      <div className="lp-wrap lp-head-in">
        <Link to="/" className="wordmark" aria-label="Jhino home">jhino<i /></Link>
        <nav className="lp-nav" aria-label="Site">
          <a href="/#pricing" className="lp-nav-pricing">Pricing</a>
          <Link to="/help" aria-current={path === '/help' ? 'page' : undefined}>Help</Link>
          {signedIn
            ? <Link to="/apps" className="btn primary sm">Open dashboard</Link>
            : <><Link to="/login">Sign in</Link><Link to="/signup" className="btn primary sm">Start free</Link></>}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <footer className="lp-foot">
      <div className="lp-wrap">
        <div className="lp-foot-top">
          <div className="lp-foot-mark">
            <Link to="/" className="wordmark" aria-label="Jhino home">jhino<i /></Link>
            <p>Client work, live on both sides. Made in Nepal.</p>
          </div>
          <nav aria-label="Footer" className="lp-foot-nav">
            <a href="/#pricing">Pricing</a>
            <Link to="/help">Help</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
            {signedIn ? <Link to="/apps">Dashboard</Link> : <Link to="/login">Sign in</Link>}
          </nav>
        </div>
        <p className="lp-foot-colo mono">
          <span>Prices in NPR</span><span>Dates in Bikram Sambat, AD beside</span><span>Pay by QR</span><span>© 2026 Jhino</span>
        </p>
      </div>
    </footer>
  );
}

/* ---------------- hero: a clapperboard for the job ---------------- */

/**
 * The hero is the job's slate, drawn as the real object: a matte black board with printed fields,
 * a striped clapstick on a metal hinge. The one moving moment: the stick claps shut, then the
 * client's APPROVED stamp lands. With reduced motion it is shown shut and stamped.
 */
function Slate({ start }: { start: ReactNode }) {
  return (
    <div className="slate">
      <div className="slate-sticks" aria-hidden="true">
        <span className="slate-stick" />
        <span className="slate-bar" />
        <span className="slate-hinge"><i /></span>
      </div>
      <div className="slate-board">
        <i className="slate-screw s1" aria-hidden="true" /><i className="slate-screw s2" aria-hidden="true" />
        <dl className="sl-row sl-head">
          <div className="sl-cell"><dt>Prod.</dt><dd>Himalayan Coffee, spring film</dd></div>
          <div className="sl-cell"><dt>Room</dt><dd className="mono">jhino.com/<b>sur-studio</b></dd></div>
        </dl>
        <div className="sl-main">
          <h1 id="hero-h">Send the work. <span>Get the yes.</span></h1>
          <div className="sl-copy">
            <p className="lp-lede">Every client gets one live page. The cut, the photos, the booking and the bill sit on it, and their answer reaches you the moment they give it.</p>
            <div className="lp-cta">
              {start}
              <a href="#pricing" className="sl-plans">See the plans</a>
            </div>
            <p className="lp-hint mono">Free for one client, for good. No card.</p>
          </div>
        </div>
        <dl className="sl-row sl-foot">
          <div className="sl-cell"><dt>Scene</dt><dd>Final cut</dd></div>
          <div className="sl-cell"><dt>Take</dt><dd className="sl-big mono">3</dd></div>
          <div className="sl-cell"><dt>Date</dt><dd><span className="mono">8 Asoj 2083</span><small className="mono">24 Sep 2026</small></dd></div>
          <div className="sl-cell sl-client">
            <dt>Client</dt>
            <dd><span className="sl-stamp" role="img" aria-label="Approved at 13:02"><b>Approved</b><small className="mono">13:02</small></span></dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/* ---------------- what moves between studio and client ---------------- */

function VideoSpec() {
  return (
    <div className="sp sp-video">
      <div className="sp-frame">
        <img src="/img/cut-pour-over.webp" alt="" width="1200" height="675" loading="lazy" decoding="async" />
        <span className="sp-play" /><span className="mono sp-tc">01:12 / 02:14</span><span className="mono sp-ver">Himalayan Coffee · final cut v3</span>
      </div>
      <div className="sp-scrub"><i style={{ transform: 'scaleX(0.53)' }} /><b style={{ left: '53%' }} /></div>
      <p className="sp-note"><span className="mono">01:12</span> Logo a little larger here.</p>
      <div className="sp-btns"><span className="sp-btn ink">Approve</span><span className="sp-btn">Ask for changes</span></div>
    </div>
  );
}

function ProofSpec() {
  const shots: [string, string, string][] = [
    ['Pick', 'shoot-iced.webp', 'DSC_0412'], ['Maybe', 'shoot-lattes.webp', 'DSC_0418'],
    ['No', 'shoot-beans.webp', 'DSC_0425'], ['Pick', 'shoot-cheers.webp', 'DSC_0431'],
  ];
  return (
    <div className="sp sp-proof">
      <div className="sp-photos">
        {shots.map(([m, file, name]) => (
          <figure key={name} className={`sp-photo ${m.toLowerCase()}`}>
            <img src={`/img/${file}`} alt="" width="600" height="750" loading="lazy" decoding="async" />
            <span className={`sp-mark ${m.toLowerCase()}`}>{m}</span>
            <figcaption className="mono">{name}</figcaption>
          </figure>
        ))}
      </div>
      <p className="mono sp-tally"><span>Pick 24</span><span>Maybe 6</span><span>No 11</span></p>
    </div>
  );
}

function BookingSpec() {
  return (
    <div className="sp sp-book">
      <div className="sp-cal mono" aria-hidden="true">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <span key={d} className="h">{d}</span>)}
        {Array.from({ length: 14 }, (_, i) => i + 3).map((d) => <span key={d} className={d === 8 ? 'on' : [5, 9, 12, 15].includes(d) ? 'bk' : ''}>{d}</span>)}
      </div>
      <p className="sp-remind"><span className="mono">12:00</span> Reminder sent: session at 13:00.</p>
    </div>
  );
}

function ScriptSpec() {
  return (
    <div className="sp sp-script">
      <p className="mono sp-k">Script 07 of 20</p>
      <b>Dashain ad, 30 seconds</b>
      <p>Open on the kitchen. Steam, then the cup. The voice comes in after the first sip.</p>
      <p className="mono sp-link">jhino.com/sur-studio#script-07</p>
    </div>
  );
}

function MoneySpec() {
  const rows: [string, string, string, string][] = [
    ['Advance', '2 Asoj 2083', '18 Sep 2026', '5,000'],
    ['Studio, 2 hrs', '8 Asoj 2083', '24 Sep 2026', '−3,000'],
    ['Edit and colour', '12 Asoj 2083', '28 Sep 2026', '−9,500'],
  ];
  return (
    <div className="sp sp-money">
      <table>
        <tbody>
          {rows.map(([w, bs, ad, n]) => (
            <tr key={w}><th scope="row">{w}</th><td className="mono sp-dates"><span>{bs}</span><span>{ad}</span></td><td className="mono sp-num">{n}</td></tr>
          ))}
        </tbody>
        <tfoot><tr><th scope="row">Balance due</th><td /><td className="mono sp-num">NPR 7,500</td></tr></tfoot>
      </table>
    </div>
  );
}

function FilesSpec() {
  const files: [string, string, string][] = [
    ['Google Drive', 'Raw footage, day 1', 'drive.google.com'],
    ['Figma', 'Menu board, v4', 'figma.com'],
    ['YouTube', 'Teaser, unlisted', 'youtube.com'],
  ];
  return (
    <ul className="sp sp-files">
      {files.map(([src, name, host]) => (
        <li key={src}><span className={`sp-thumb ${src.split(' ')[0].toLowerCase()}`} /><span><b>{name}</b><span className="mono">{src} · {host}</span></span></li>
      ))}
    </ul>
  );
}

const MOVES: { id: string; name: string; text: string; spec: () => ReactNode }[] = [
  { id: 'video', name: 'Video approvals', text: 'The cut plays in the page. Your client approves it or asks for changes, with a note pinned to the exact second.', spec: VideoSpec },
  { id: 'proof', name: 'Photo proofing', text: 'Every frame at the same size. The client marks each one Pick, Maybe or No, and you copy the picked file names in one go.', spec: ProofSpec },
  { id: 'book', name: 'Studio booking', text: 'A day of free and booked slots, a month view, upcoming and history. Both sides get a reminder before each session.', spec: BookingSpec },
  { id: 'script', name: 'Briefs and scripts', text: 'Twenty scripts stay readable. Each opens as its own page, and one link opens just that script.', spec: ScriptSpec },
  { id: 'money', name: 'Receipts and payments', text: 'Money in and out with the running balance, in rupees. Dates in Bikram Sambat with the AD date beside.', spec: MoneySpec },
  { id: 'files', name: 'Files and links', text: 'Paste a Drive, Dropbox, OneDrive, Figma, Canva, YouTube or Vimeo link. It shows as a proper preview, not a bare URL.', spec: FilesSpec },
];

/* ---------------- pricing ---------------- */

const perMonth = (p: PlanCard) => nprAmount(Math.round(p.yearly / 12));

function BillingSwitch({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const opts: [Period, string][] = [['month', 'Monthly'], ['year', 'Yearly']];
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const next: Period = period === 'month' ? 'year' : 'month';
    onChange(next);
    (e.currentTarget.parentElement?.querySelector(`[data-period="${next}"]`) as HTMLButtonElement | null)?.focus();
  };
  return (
    <div className="bill-switch" role="radiogroup" aria-label="Billing period">
      {opts.map(([p, label]) => (
        <button
          key={p} type="button" role="radio" data-period={p}
          aria-checked={period === p} tabIndex={period === p ? 0 : -1}
          onClick={() => onChange(p)} onKeyDown={onKey}
        >
          {label}{p === 'year' && <span className="bill-free mono">2 months free</span>}
        </button>
      ))}
    </div>
  );
}

function PriceCard({ plan, period, signedIn }: { plan: PlanCard; period: Period; signedIn: boolean }) {
  const paid = plan.monthly > 0;
  const rec = plan.id === 'plus';
  const price = priceFor(plan, period);
  const label = paid ? `Choose ${plan.name}` : signedIn ? 'Your plan' : 'Start free';
  const to = signedIn
    ? (paid ? `/account/plan?choose=${plan.id}&period=${period}` : '/account/plan')
    : (paid ? `/signup?plan=${plan.id}&period=${period}` : '/signup');
  return (
    <article className={`price-card${rec ? ' is-rec' : ''}`} aria-labelledby={`plan-${plan.id}`}>
      <div className="pcard-top">
        <h3 id={`plan-${plan.id}`}>{plan.name}</h3>
        {rec && <span className="pcard-rec mono"><i className="lp-dot" />Recommended</span>}
      </div>
      <p className="pcard-blurb">{plan.blurb}</p>
      <p className="pcard-price">
        <span className="pcard-cur mono">NPR</span>
        <span className="pcard-amt">{nprAmount(price)}</span>
        <span className="pcard-per">{paid ? (period === 'year' ? '/ year' : '/ month') : 'forever'}</span>
      </p>
      <p className="pcard-sub mono">
        {!paid ? 'No card. No time limit.'
          : period === 'year' ? `NPR ${perMonth(plan)} a month · 2 months free`
          : `or NPR ${nprAmount(plan.yearly)} a year`}
      </p>
      <Link to={to} className={`btn ${rec ? 'primary' : ''} pcard-cta`}>{label}</Link>
      <ul className="pcard-list">
        {plan.features.map((f) => <li key={f}><Icon name="check" size={15} />{f}</li>)}
      </ul>
      {plan.missing.length > 0 && (
        <ul className="pcard-list pcard-missing">
          {plan.missing.map((f) => <li key={f}><span className="pcard-dash" aria-hidden="true" /><span className="sr-only">Not included: </span>{f}</li>)}
        </ul>
      )}
    </article>
  );
}

const COMPARE: [string, (p: PlanCard) => ReactNode][] = [
  ['Apps', (p) => nprAmount(p.apps)],
  ['Addresses on jhino.com', (p) => nprAmount(p.addresses)],
  ['Short links', (p) => nprAmount(p.shortLinks)],
  ['Sign-in and public links', () => true],
  ['Password links', (p) => p.id !== 'free'],
  ['Hide the top bar', (p) => p.id !== 'free'],
  ['Download as an HTML file', (p) => p.id !== 'free'],
  ['Daily click history', (p) => p.id === 'pro'],
  ['Priority support', (p) => p.id === 'pro'],
];

function Compare() {
  return (
    <div className="cmp-wrap">
      <table className="cmp">
        <caption className="sr-only">What each plan includes</caption>
        <thead>
          <tr><td /><th scope="col">Free</th><th scope="col" className="is-rec">Plus</th><th scope="col">Pro</th></tr>
        </thead>
        <tbody>
          {COMPARE.map(([name, get]) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              {PLAN_CARDS.map((p) => {
                const v = get(p);
                return (
                  <td key={p.id} className={p.id === 'plus' ? 'is-rec' : undefined}>
                    {v === true ? <><Icon name="check" size={15} /><span className="sr-only">Included</span></>
                      : v === false ? <><span className="pcard-dash" aria-hidden="true" /><span className="sr-only">Not included</span></>
                      : <span className="mono">{v}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- questions ---------------- */

const FAQ: [string, ReactNode][] = [
  ['What counts as an app?', 'One app on your account: an HTML you uploaded, or one you made with Create HTML. Apps in Trash count until you delete them for good.'],
  ['Does my client need an account?', 'Only if you want one. Give them a sign-in, or share the app by public link or by link and password. You decide what visitors can do: view, add or edit.'],
  ['Will any HTML file work?', 'Yes. Plain HTML, CSS and JavaScript that saves with localStorage or IndexedDB syncs between everyone with no changes. Its own design stays exactly as it is.'],
  ['Can I use my own address?', 'Yes. Pick jhino.com/your-name when you create an app, or later in Share. Each address is unique. The page opens at that exact address, with no redirect.'],
  ['What are short links?', 'A short address like jhino.com/abc that opens any web link you choose: a Drive folder, a YouTube cut, a form. You see how many times each one was opened.'],
  ['Monthly or yearly?', 'Either. Pay month by month, or pay for a year at the price of ten months, which is two months free. Both are paid the same way.'],
  ['How do I pay?', 'Choose a plan, scan the QR code, and upload a screenshot of the payment. We check it and switch the plan on, usually the same day. You get a receipt.'],
  ['Where is my data?', <>On the Jhino server, backed up, and never sold. The <Link to="/privacy">Privacy page</Link> has the details.</>],
];

/* ---------------- the page ---------------- */

export function Landing({ signedIn = false }: { signedIn?: boolean }) {
  const [period, setPeriod] = useState<Period>('month');
  const start = signedIn
    ? <Link to="/apps" className="btn primary lg">Open dashboard</Link>
    : <Link to="/signup" className="btn primary lg">Start free</Link>;
  return (
    <div className="site lp">
      <SiteHeader signedIn={signedIn} />
      <main id="main">
        {/* 1. hero */}
        <section className="lp-hero" aria-labelledby="hero-h">
          <div className="lp-wrap">
            <Slate start={start} />
            <p className="sl-under">For video, photo and design studios, agencies and their clients. Upload the HTML you already have, or build one here in a few minutes. Prices in rupees, dates in Bikram Sambat.</p>
          </div>
        </section>

        {/* 2. what moves */}
        <section className="lp-moves" id="moves" aria-labelledby="moves-h">
          <div className="lp-wrap">
            <div className="lp-split-head">
              <h2 id="moves-h">What moves between you.</h2>
              <p>Six things a studio sends a client every week. Each one lands on their screen when you add it, and their answer lands on yours.</p>
            </div>
            <ol className="mv-list">
              {MOVES.map(({ id, name, text, spec: Spec }, i) => (
                <li key={id} className={`mv mv-${id}`}>
                  <span className="mv-n mono" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  <div className="mv-copy">
                    <h3>{name}</h3>
                    <p>{text}</p>
                  </div>
                  <div className="mv-spec" aria-hidden="true"><Spec /></div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 3. two ways to make an app */}
        <section className="lp-ways" aria-labelledby="ways-h">
          <div className="lp-wrap">
            <h2 id="ways-h">Two ways to make one.</h2>
            <div className="ways-grid">
              <div className="ways-col">
                <p className="ways-k mono">Upload</p>
                <h3>Bring the HTML you already have.</h3>
                <p>A single file or a ZIP. It goes live at once and keeps its own design. Any HTML that saves with localStorage or IndexedDB syncs for everyone you let in, with no changes to the code.</p>
                <figure className="lp-code" aria-label="An ordinary HTML app saving to localStorage">
                  <figcaption className="mono">jobs.html</figcaption>
                  <pre><code>
                    <span><i>1</i>const jobs = JSON.parse(localStorage.jobs || '[]');</span>
                    <span><i>2</i>jobs.push({'{'} shoot: 'Menu', day: '8 Asoj' {'}'});</span>
                    <span><i>3</i>localStorage.jobs = JSON.stringify(jobs);</span>
                    <span className="c"><i>4</i>// On Jhino: the same jobs on every screen.</span>
                  </code></pre>
                </figure>
              </div>
              <div className="ways-col ways-b">
                <span className="ways-or mono" aria-hidden="true">or</span>
                <p className="ways-k mono">Create HTML</p>
                <h3>Build it here in a few minutes.</h3>
                <p>Say who it is for, tick what the job needs, and it is ready to share. No code.</p>
                <div className="make">
                  <div className="make-field"><span className="mono">Who is it for?</span><b>Himalayan Coffee</b></div>
                  <ul className="make-ticks">
                    {([['Studio booking with reminders', true], ['Video approvals', true], ['Photo proofing', true], ['To-dos and messages', false], ['Invoices and receipts', true]] as const).map(([t, on]) => (
                      <li key={t} className={on ? 'on' : undefined}><span className="make-box" aria-hidden="true">{on && <Icon name="check" size={13} />}</span>{t}</li>
                    ))}
                  </ul>
                  <span className="make-go" aria-hidden="true">Create HTML</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 4. sharing, addresses and short links */}
        <section className="lp-share" aria-labelledby="share-h">
          <div className="lp-wrap">
            <div className="share-grid">
              <div className="share-copy">
                <h2 id="share-h">Share it the way the job needs.</h2>
                <p>Keep it to the people you add, open it to anyone with the link, or put a password on the link. Then choose what visitors can do. Per app, and you can change it any time.</p>
              </div>
              <div className="share-spec" aria-hidden="true">
                <p className="share-k mono">Who can open it</p>
                <div className="share-opt"><span className="radio" />Only people I add</div>
                <div className="share-opt"><span className="radio" />Anyone with the link</div>
                <div className="share-opt on"><span className="radio" />Anyone with the link and password</div>
                <p className="share-k mono">Visitors can</p>
                <div className="share-seg"><span>View</span><span className="on">Add</span><span>Edit</span></div>
              </div>
            </div>

            <div className="addr">
              <h3 id="addr-h" className="addr-h">An address of its own</h3>
              <p className="addr-big"><span>jhino.com/</span><wbr /><b>your-studio</b></p>
              <div className="addr-notes">
                <p>Pick the name when you create the app, or later in Share. Each address is unique.</p>
                <p>No redirect. The page opens at that exact address, and with the top bar hidden it looks like its own site.</p>
              </div>
            </div>

            <div className="short">
              <div className="short-copy">
                <h3>Short links, with counts.</h3>
                <p>Point jhino.com/abc at any web address: a Drive folder, a YouTube cut, a form. Send the short one. See how many times it was opened.</p>
              </div>
              <table className="short-t">
                <caption className="sr-only">Example short links</caption>
                <thead><tr><th scope="col">Short link</th><th scope="col">Opens</th><th scope="col">Clicks</th></tr></thead>
                <tbody>
                  <tr><td className="mono">jhino.com/<b>dashain</b></td><td className="mono short-dest">youtube.com/watch?v=q8Vd2</td><td className="mono short-n">1,284</td></tr>
                  <tr><td className="mono">jhino.com/<b>k7f</b></td><td className="mono short-dest">drive.google.com/drive/folders/1xR</td><td className="mono short-n">57</td></tr>
                  <tr><td className="mono">jhino.com/<b>menu</b></td><td className="mono short-dest">figma.com/file/menu-board-v4</td><td className="mono short-n">212</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* 5. pricing */}
        <section className="lp-pricing" id="pricing" aria-labelledby="pricing-h">
          <div className="lp-wrap">
            <div className="pr-head">
              <div>
                <h2 id="pricing-h">Plans, in rupees.</h2>
                <p>Start free with one app. Move up when you have more clients.</p>
              </div>
              <BillingSwitch period={period} onChange={setPeriod} />
            </div>
            <p className="sr-only" aria-live="polite">{period === 'year' ? 'Showing yearly prices.' : 'Showing monthly prices.'}</p>
            <div className="pr-cards">
              {PLAN_CARDS.map((p) => <PriceCard key={p.id} plan={p} period={period} signedIn={signedIn} />)}
            </div>
            <p className="pr-pay">
              <Icon name="qr" size={18} />
              <span><b>How paying works.</b> Scan our QR code, upload a screenshot of the payment, and we switch the plan on, usually the same day.</span>
            </p>
            <Compare />
          </div>
        </section>

        {/* 6. questions */}
        <section className="lp-faq" aria-labelledby="faq-h">
          <div className="lp-wrap faq-grid">
            <h2 id="faq-h">Questions.</h2>
            <dl>
              {FAQ.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}
            </dl>
          </div>
        </section>

        {/* 7. close */}
        <section className="lp-close" aria-labelledby="close-h">
          <div className="lp-wrap">
            <div className="close-in">
              <h2 id="close-h">{signedIn ? 'Your rooms are where you left them.' : 'Your first client room is free.'}</h2>
              <div className="lp-cta">{start}<Link to="/help" className="btn lg quiet">Ask us something</Link></div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter signedIn={signedIn} />
    </div>
  );
}

/* ---------------- help and support ---------------- */
const HELP: [string, string][] = [
  ['Make your first app', 'Sign in, then use Create HTML (pick what the client needs) or Upload HTML (your own .html or .zip file). It is live as soon as it is saved.'],
  ['Share with a client', 'Open the app and press Share. Make a sign-in for the client, send an invite link, or turn on a public or password link.'],
  ['Upgrade your plan', 'Account → Plan & usage → choose a plan. Pay by QR, upload the screenshot, and the plan turns on after we check it.'],
  ['Studio booking reminders', 'Open the booking section and press Reminders. Choose when (10 minutes to a day before) and the message.'],
  ['Hide the top bar', 'Open the app, press ⋯ and choose Hide top bar. It opens like a standalone app; the small corner button brings the menu back.'],
  ['Forgot your password', 'On the sign-in page choose Forgot password. The link in the email works once, for 30 minutes.'],
];

export function HelpPage({ signedIn }: { signedIn: boolean }) {
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
  return (
    <div className="site">
      {!signedIn && <SiteHeader />}
      <main className="lp-wrap help">
        <h1>Help</h1>
        <div className="help-grid">
          <section aria-labelledby="guides-h">
            <h2 id="guides-h">Guides</h2>
            <dl className="help-list">{HELP.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}</dl>
          </section>
          <section aria-labelledby="contact-h" className="help-contact">
            <h2 id="contact-h">Write to us</h2>
            {state === 'sent' ? (
              <div className="sent" role="status"><b>Thank you. We have your message.</b><p className="muted">We reply by email, usually within a working day.</p><button className="btn" onClick={() => { setState('idle'); setForm({ email: form.email, subject: '', message: '' }); }}>Send another</button></div>
            ) : (
              <form onSubmit={send} className="stack-form">
                <div className="seg" role="radiogroup" aria-label="What is this about">
                  {([['contact', 'Contact support'], ['problem', 'Report a problem'], ['feedback', 'Send feedback']] as const).map(([k, l]) => (
                    <button key={k} type="button" role="radio" aria-checked={kind === k} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>
                  ))}
                </div>
                {!signedIn && <label className="field"><span>Your email</span><input className="input" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>}
                <label className="field"><span>Subject</span><input className="input" required maxLength={140} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
                <label className="field"><span>Message</span><textarea className="textarea" required rows={6} maxLength={5000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
                {kind === 'problem' && <p className="hint">We add the page you came from, your browser and screen size{ref ? ` and error reference ${ref}` : ''}, so we can find the problem. Nothing else.</p>}
                {error && <p className="error-text" role="alert">{error}</p>}
                <div><button className="btn primary" disabled={state === 'busy'}>{state === 'busy' && <span className="spin" />}Send</button></div>
              </form>
            )}
          </section>
        </div>
        <p className="muted help-legal"><Link to="/terms">Terms of Service</Link> · <Link to="/privacy">Privacy Policy</Link></p>
      </main>
      {!signedIn && <SiteFooter />}
    </div>
  );
}

/* ---------------- terms and privacy ---------------- */
function LegalPage({ title, updated, children, signedIn }: { title: string; updated: string; children: ReactNode; signedIn: boolean }) {
  return (
    <div className="site">
      {!signedIn && <SiteHeader />}
      <main className="lp-wrap legal">
        <h1>{title}</h1>
        <p className="mono muted">Last updated {updated}</p>
        {children}
      </main>
      {!signedIn && <SiteFooter />}
    </div>
  );
}

export function TermsPage({ signedIn }: { signedIn: boolean }) {
  return (
    <LegalPage title="Terms of Service" updated="25 September 2026" signedIn={signedIn}>
      <h2>Using Jhino</h2>
      <p>Jhino hosts small web apps (HTML) and the data people save in them. By creating an account you agree to these terms. If you use Jhino for a business, you agree for that business.</p>
      <h2>Your account</h2>
      <p>Keep your password private and tell us if you think someone else used your account. You are responsible for what happens under it, including sign-ins and links you create for other people.</p>
      <h2>Your content</h2>
      <p>The apps, data and links you add stay yours. You give us permission to store, copy and show them only to run Jhino for you and the people you share with. Do not upload anything illegal, harmful, or that you do not have the right to share, and do not use Jhino to attack or spam anyone. We may remove content or suspend accounts that break these rules.</p>
      <h2>Plans and payment</h2>
      <p>Free Forever lets you keep one app, one address on jhino.com and five short links. Plus (NPR 500 a month, up to 10 apps, 10 addresses and 100 short links) and Pro (NPR 2,000 a month, up to 50 apps, 50 addresses and 1,000 short links) can be paid monthly, or yearly for the price of ten months. Each address on jhino.com belongs to one app and is unique. Plans are paid by QR. A plan turns on after we verify the payment and runs for the month or year you paid for; if we cannot verify it, your plan stays as it was and we tell you why. If something went wrong with a payment, write to us through Help.</p>
      <h2>Availability</h2>
      <p>We work to keep Jhino running and backed up, but we cannot promise it will never be interrupted. Keep your own copy of anything you cannot afford to lose; you can download your data from Account at any time.</p>
      <h2>Ending</h2>
      <p>You can delete your account in Account → Privacy & data. We may close accounts that break these terms. We will change these terms only with notice in the app.</p>
    </LegalPage>
  );
}

export function PrivacyPage({ signedIn }: { signedIn: boolean }) {
  return (
    <LegalPage title="Privacy Policy" updated="25 September 2026" signedIn={signedIn}>
      <h2>What we keep</h2>
      <p>Your name, email, the profile details you choose to add, your apps and the data saved in them, payment records (amount, plan, reference and the screenshot you upload), and security records such as sign-in times, device type and IP address.</p>
      <h2>Why</h2>
      <p>To run your account and your apps, to verify payments, to keep accounts safe (for example to warn you about a new sign-in), and to answer you when you write to us. We do not sell your data and we do not show ads.</p>
      <h2>Who sees it</h2>
      <p>The people you share an app with see that app and what is saved in it. Our administrators can see account and payment records to support you and verify payments; they never see your password. Payment screenshots are private to you and our administrators.</p>
      <h2>Emails</h2>
      <p>Security and account emails (verification, password reset, sign-in alerts) are always sent. Product news and marketing are off unless you turn them on in Account → Notifications.</p>
      <h2>Your choices</h2>
      <p>You can change your details, download your data, and delete your account from Account at any time. When you delete it, your apps go with it; payment records are kept for accounting without your account.</p>
      <h2>Contact</h2>
      <p>Questions about privacy: write to us through <Link to="/help">Help</Link>.</p>
    </LegalPage>
  );
}
