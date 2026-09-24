import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, post } from '../api';
import { Link, useRoute } from '../context';
import { Icon } from '../ui';

/*
 * The public site: home, help, terms and privacy. Direction: a studio job sheet. Big tight grotesque,
 * mono readouts, ruled lists and tables, paper and ink with one vermilion signal. One moving moment:
 * the hero booking that lands on the client's screen.
 */

export function SiteHeader() {
  const { path } = useRoute();
  return (
    <header className="site-head">
      <div className="site-in">
        <Link to="/" className="wordmark" aria-label="Jhino home">jhino<i /></Link>
        <nav className="site-nav" aria-label="Site">
          <a href="/#pricing" aria-current={path === '/' ? undefined : undefined}>Pricing</a>
          <Link to="/help" aria-current={path === '/help' ? 'page' : undefined}>Help</Link>
          <Link to="/login" className="site-signin">Sign in</Link>
          <Link to="/signup" className="btn primary sm">Start free</Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="site-in">
        <span className="wordmark">jhino<i /></span>
        <span className="muted">Client work, live on both sides. Made in Nepal.</span>
        <nav aria-label="Footer">
          <Link to="/help">Help</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/login">Sign in</Link>
        </nav>
      </div>
    </footer>
  );
}

/** The hero's working sheet: the studio books a slot, and the client's copy shows it. */
function LiveSheet() {
  const slots = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00'];
  const pane = (who: string, side: 'studio' | 'client') => (
    <div className={`sheet-pane ${side}`}>
      <div className="sheet-top">
        <span className="mono">{who}</span>
        <span className="sheet-date"><b>8 Asoj 2083</b><small>24 Sep 2026</small></span>
      </div>
      <ol className="sheet-slots" aria-hidden="true">
        {slots.map((t) => (
          <li key={t}>
            <span className="mono">{t}</span>
            {t === '09:00' && <span className="sheet-bk old">Podcast · Anish</span>}
            {t === '13:00' && <span className={`sheet-bk new ${side}`}>Recording · Himalayan Coffee</span>}
            {t === '13:00' && side === 'studio' && <span className="sheet-tap" />}
          </li>
        ))}
      </ol>
    </div>
  );
  return (
    <figure className="sheet" aria-label="A studio booking made on one screen appears on the client's screen">
      {pane('Your studio', 'studio')}
      {pane('Your client', 'client')}
      <figcaption className="sheet-sync mono"><i className="live-dot" />synced · 0.4 s</figcaption>
    </figure>
  );
}

const MOVES: [string, string, string][] = [
  ['Video deliveries', 'The cut plays in the page. The client approves it or asks for changes, with a comment on the exact item.', 'approve · changes'],
  ['Photo proofing', 'Every frame the same size. The client marks Pick, Maybe or No, and you copy the picked file names.', 'pick · maybe · no'],
  ['Studio booking', 'A day of free and booked slots, a month view, upcoming and history. A reminder before each session.', 'slots · reminders'],
  ['Briefs and scripts', 'Twenty scripts stay readable: each one opens as its own page, and a single link opens just that script.', 'write · read · link'],
  ['Receipts and payments', 'Money in and out with the running total. Dates in Bikram Sambat with the AD date beside it.', 'NPR · BS / AD'],
  ['Files and links', 'Paste Drive, Dropbox, OneDrive, Figma, Canva, YouTube or Vimeo links. They show as proper previews.', 'links first'],
];

const PLANS = [
  { id: 'free', name: 'Free Forever', price: '0', creations: 1, who: 'Try it with one client room. No card, no time limit.' },
  { id: 'plus', name: 'Plus', price: '500', creations: 10, who: 'A freelancer or a small studio with a handful of clients.' },
  { id: 'pro', name: 'Pro', price: '2,000', creations: 50, who: 'A studio or agency running a room for every client.' },
];

const FAQ: [string, ReactNode][] = [
  ['What is a "creation"?', 'One app on your account: an HTML you uploaded or one you made with Create HTML. Apps in Trash count until you delete them for good.'],
  ['Does my client need an account?', 'Only if you want one. Give them a sign-in, or share the app by public link or by link and password. You decide what visitors can do: view, add or edit.'],
  ['Will any HTML file work?', 'Yes. Plain HTML, CSS and JavaScript that saves with localStorage or IndexedDB syncs between everyone with no changes. Its own design stays exactly as it is.'],
  ['How do I pay?', 'Choose a plan, scan the QR code, and upload a screenshot of the payment. We check it and turn the plan on, usually the same day. You get a receipt.'],
  ['Can I use my own address?', 'Hosted pages can have a short address like jhino.com/your-studio. Ask us through Help and we set it up.'],
  ['Where is my data?', 'On the Jhino server, backed up, and never sold. Read the Privacy page for the details.'],
];

export function Landing() {
  return (
    <div className="site">
      <SiteHeader />
      <main>
        <section className="hero site-in">
          <div className="hero-copy">
            <p className="kicker mono">for studios, agencies and their clients</p>
            <h1>One live page for you and your client.</h1>
            <p className="lede">Upload an HTML app, or build one in minutes. Share it with a sign-in or a link. Every approval, booking, receipt and file either of you adds shows up on both screens as it happens.</p>
            <div className="hero-cta">
              <Link to="/signup" className="btn primary lg">Start free</Link>
              <a href="#pricing" className="btn lg quiet">See plans</a>
            </div>
            <p className="hint">Free Forever includes one app. Paid plans from NPR 500.</p>
          </div>
          <LiveSheet />
        </section>

        <section className="moves site-in" aria-labelledby="moves-h">
          <h2 id="moves-h">What moves between you</h2>
          <ul className="ledger">
            {MOVES.map(([name, text, tag]) => (
              <li key={name}>
                <b>{name}</b>
                <span>{text}</span>
                <span className="mono tag-r">{tag}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="ways" aria-labelledby="ways-h">
          <div className="site-in ways-in">
            <h2 id="ways-h">Two ways to make one</h2>
            <div className="way upload">
              <h3>Upload the HTML you have</h3>
              <p>A single file or a ZIP. It goes live at once, keeps its own design, and whatever it saves is shared with everyone you let in.</p>
              <pre className="code-sheet" aria-label="An ordinary HTML app saving to localStorage"><code>{`localStorage.setItem('orders', JSON.stringify(orders));
// saved on Jhino, live for everyone in the app`}</code></pre>
            </div>
            <div className="way create">
              <h3>Or build it here</h3>
              <p>Say who it is for, tick what you need, and it is ready to share.</p>
              <ul className="ticks-list">
                {['Studio booking with reminders', 'Video approvals', 'Photo proofing', 'To-dos and messages', 'Invoices and receipts'].map((t) => <li key={t}><Icon name="check" size={16} />{t}</li>)}
              </ul>
            </div>
          </div>
        </section>

        <section className="share site-in" aria-labelledby="share-h">
          <div>
            <h2 id="share-h">Share it the way the job needs</h2>
            <p className="lede">Keep it to the people you add, open it to anyone with the link, or put a password on the link. Visitors can view, add or edit: your choice, per app.</p>
          </div>
          <div className="share-demo" aria-hidden="true">
            <div className="share-opt"><span className="radio" /> Only people I add</div>
            <div className="share-opt"><span className="radio" /> Anyone with the link</div>
            <div className="share-opt on"><span className="radio" /> Anyone with the link and password</div>
            <div className="share-url mono">jhino.com/<b>your-studio</b></div>
          </div>
        </section>

        <section className="pricing site-in" id="pricing" aria-labelledby="pricing-h">
          <h2 id="pricing-h">Plans</h2>
          <p className="lede">Pay once by QR, upload the screenshot, and we switch your plan on. Prices in Nepali rupees.</p>
          <table className="price-table">
            <thead><tr><th scope="col">Plan</th><th scope="col">Price</th><th scope="col">Apps</th><th scope="col" className="hide-sm">Good for</th><th scope="col"><span className="sr-only">Choose</span></th></tr></thead>
            <tbody>
              {PLANS.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.name}</th>
                  <td className="mono">{p.price === '0' ? 'Free' : `NPR ${p.price}`}</td>
                  <td className="mono">up to {p.creations}</td>
                  <td className="hide-sm muted">{p.who}</td>
                  <td><Link to={p.id === 'free' ? '/signup' : `/signup?plan=${p.id}`} className={`btn sm ${p.id === 'free' ? 'primary' : ''}`}>{p.id === 'free' ? 'Start free' : 'Choose'}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="faq site-in" aria-labelledby="faq-h">
          <h2 id="faq-h">Questions</h2>
          <dl>
            {FAQ.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}
          </dl>
        </section>
      </main>
      <SiteFooter />
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
      <main className="site-in help">
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
      <main className="site-in legal">
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
      <p>Free Forever lets you keep one app. Paid plans (NPR 500 for up to 10 apps, NPR 2,000 for up to 50) are paid by QR. A plan turns on after we verify the payment; if we cannot verify it, your plan stays as it was and we tell you why. If something went wrong with a payment, write to us through Help.</p>
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
