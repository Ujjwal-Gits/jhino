# Jhino

**Small apps. Real work.** A self-hosted home for HTML apps made with Claude or any other AI tool.

Two ways to get an app:

- **Create HTML:** say which client or brand it is for and what kind of work (video, photography, design, social media, apps, websites), tick the features you want from 41 (video deliveries with approval, photo proofing, design proofs, shoot schedules, content calendar, app releases, bug reports, invoices, the client's receipts, payments and more), pick the colour, lettering and their logo, and Jhino writes the whole HTML for you. It opens straight away.
- **Upload HTML:** upload an `.html` file or a `.zip` made with Claude or any other tool. It opens straight away too.

Share an app with the people you add (each signs in with their own ID and password), or by a public link, or by a link with a password. Everything saved is stored in Jhino's database on your server and shows up for everyone else, live. Sign-in, hosting, database, files and sharing all run in this one program; email (SMTP) and Google/Apple sign-in are optional.

It is also a small SaaS: a public website, sign-up, an Account Center, plans paid by QR monthly or yearly (Free Forever: 1 app; Plus NPR 500/month: 10 apps; Pro NPR 2,000/month: 50 apps; a year costs ten months), app addresses like `jhino.com/your-studio`, short links and a Super Admin dashboard. See [Accounts, plans and Super Admin](#accounts-plans-and-super-admin).

## Run it

Requires Node.js 22 or newer.

```bash
npm install
npm run build
npm start            # http://127.0.0.1:4310
```

On the first start Jhino creates `.env` with a random admin password and prints it. Sign in with that, then change the password from the account menu (top right).

For development with hot reload: `npm run dev` (dashboard on http://localhost:5173, API on 4310).

### With Docker

```bash
ADMIN_PASSWORD='choose-a-long-password' docker compose up -d --build
```

All data lives in the `jhino-data` volume. If you leave `ADMIN_PASSWORD` empty, a password is generated and printed once in `docker compose logs`.

### On Coolify (or any Docker host)

Deploy with the Dockerfile and mount a persistent volume at `/data`. The image already sets `DATA_DIR=/data`, `BACKUP_DIR=/data/backups` and `FFMPEG_PATH=/usr/bin/ffmpeg`; set `PUBLIC_URL`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` yourself.

- Everything Jhino writes goes under `/data`: the SQLite database (WAL mode), uploaded apps, files, compressed videos, staging and backups. The rest of the container can be wiped on every redeploy.
- The app runs as the `node` user (uid 1000). If `/data` is not writable by it, Jhino stops at start and says how to fix it (`chown -R 1000:1000` on the volume).
- The admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` is created only when the database has no users. Later starts never change it. To change the admin's email or password later, run in the container: `node dist/server/admin.js --email new@example.com --password 'a long password'` (it renames the current admin, so its apps stay with it).
- Health check: `GET /health` returns 200 when the server and database answer.
- On `SIGTERM` (a redeploy) Jhino stops taking new requests, lets running ones finish (up to 25 seconds), stops a video encode (it resumes on the next start) and closes the database cleanly.
- Database migrations run at every start and only apply what is new.

### Put it on the internet (HTTPS)

Run Jhino behind a reverse proxy that handles HTTPS, and set `PUBLIC_URL` to the public address. That makes session cookies `Secure` and puts the right address in invite links. Example with Caddy:

```
apps.example.com {
  reverse_proxy 127.0.0.1:4310
}
```

```
PUBLIC_URL=https://apps.example.com
```

Server-sent events need response buffering switched off in your proxy. Caddy does this by itself; for nginx add `proxy_buffering off;` to the location block. Serve over HTTPS with HTTP/2 (Caddy does by default): over plain HTTP/1.1 a browser allows only about six connections per server, and every open Jhino tab uses one for live updates (background tabs let theirs go after 15 seconds).

## Accounts, plans and Super Admin

- **Website and sign-up.** The website is always at `/` (pricing, help, terms, privacy), signed in or not; the dashboard (My apps) is at `/apps`, and signing in lands there. Anyone can create a Free Forever account (switch sign-ups off in Super Admin → Settings). Email verification, forgot/reset password (single-use links, 30 minutes), sign-in alerts for new devices and every security email go out by SMTP when `SMTP_URL` is set; without it Super Admin → Settings shows them.
- **Continue with Google / Apple** appear when their keys are set (see `.env.example`). A Google/Apple sign-in with a verified email joins the existing account with that email; if that account had never confirmed its email, its password is cleared first (someone else may have set it).
- **Account Center** (`/account`): profile and photo, email (a new email counts only after it is confirmed), security (password, sign-in methods, every signed-in device with sign-out, recent security activity), plan and usage, billing with receipts, notification choices (security and account messages are always on), privacy (download your data, delete the account after password and "DELETE").
- **Plans & pricing are editable** in Super Admin → Plans & pricing: names, monthly and yearly prices, apps, addresses, short links, the largest file per upload, and each feature. They are saved in the database, served at `/api/plans`, shown on the website and at checkout at once, and enforced by the server. People who already paid keep their plan until its end date.
- **Upload size** follows the app owner's plan (defaults: Free 20 MB, Plus and Pro 50 MB per file, including app ZIPs). An upload that is too big is refused before anything is stored. Super admins are limited only by `MAX_FILE_MB`.
- **Default plans** (`server/plans.ts`, shown from `web/src/plans.ts`): Free Forever has 1 app, 1 address and 5 short links. Plus has 10 apps, 10 addresses, password links, a hidden top bar, "Download as HTML file", and 100 short links with names you choose. Pro has 50 apps, 50 addresses, 1,000 short links and a daily click history. The server checks every feature. A plan paid for a month or a year ends then (paying again for the same plan adds to the end date). Three days before it ends, and when it has ended, the owner is told. An ended plan counts as Free Forever, and apps keep working.
- **Addresses.** Owners pick `jhino.com/<name>` when they upload or create an app (Create HTML step 04), or later in Share. The app opens at exactly that address, with no redirect, for visitors and members alike. Addresses and short links share one set of names, so a name is never used twice (any letter case); Jhino's own words are reserved.
- **Short links** (`/links`): `jhino.com/<code>` sends the visitor on to any http(s) address with a 302 and counts the click. Super Admin → Short links can turn off any link.
- **Plans.** The server counts apps per owner and refuses the next one past the plan (checked again inside the insert, so two requests at once cannot both pass). Super admins have no limit. Apps in Trash count until they are deleted for good.
- **Paying by QR.** Super Admin adds payment methods with a QR image. The customer picks a plan, pays, and uploads a screenshot (JPG/PNG/WEBP up to 10 MB, checked by its bytes, stored privately, never at a public address). The payment waits for review; approving grants the plan exactly once (a double click or two admins at once give it once), and rejecting keeps the old plan and shows the reason. The customer and the admins get a notification (and an email).
- **Super Admin** (`/admin`, super admins only; everyone else is sent to their apps and every `/api/admin/*` call answers 403): its own workspace with a full-height sidebar. The overview shows monthly revenue, money by month, sign-ups and new apps by day, the plan mix, and a "Needs you" queue (payments, requests, plans about to end). It also has users (create a sign-in for someone who paid, change plan, end date and extra allowance, suspend, new password, sign out everywhere, make or remove super admins), **Plan requests** (everyone who paid and sent a screenshot; approve to switch the plan on, or reject with a reason; shows the period and the end date approving gives), **New user** (on every screen), **Apps & data** (every app with its owner, people, saved data, files and size; a JSON export of any app, audited), **Plans & pricing**, **Subscriptions** (everyone on a paid plan: since when, until when, last payment; upgrade, downgrade, +1 month / +1 year, or back to Free, and the customer is told), QR and payment methods, addresses, short links, support requests, CSV exports of users and payments, editing a user's name or email, deleting an account (type their email), announcements to everyone or one group, storage and free disk space, the audit log (every sensitive admin action) and settings (uploads on/off, sign-ups, support email, email log).
- **Sharing by link.** In Share, an owner turns on a public link or a password link and picks what visitors can do (view, add or edit). Visitors act as one hidden "Visitor" member of that app only; their cookie opens nothing else. Super admins can change any app's address, or host an HTML at one in a single step (Super Admin → Addresses).
- **Top bar.** Each app can hide the Jhino top bar (⋯ → Hide top bar, or in Share) to open like a standalone app; a small corner button keeps the menu in reach.
- **Studio booking.** A Create HTML template: a day of free and booked time slots (tap a free slot to book), month, upcoming and history, reschedule and cancel, a warning before double-booking, and reminders before each booking (10 minutes to a day, or custom, with your own message) to everyone who can edit the app, in the bell and by email.
- **Files.** Super Admin → Settings → "File uploads inside apps". Off means apps use links (Drive, Dropbox, OneDrive, Figma, Canva, YouTube, Vimeo, any https address); payment screenshots, QR codes and profile photos still upload. Installs that already held uploaded files keep uploads on; new installs start with links only.

## How it works

### Create HTML

| Step | What you do |
| --- | --- |
| 01 Who is it for? | The client or brand, their logo (optional, shrunk in the browser and kept inside the HTML), and the kind of work: Video production, Photography, Design and branding, Social media, App development, Website projects, or something else. Picking a kind ticks the usual features for it. |
| 02 Tick what it should have | Feature cards in Deliver and approve, Shoots and production, Brand and content, Apps and websites, Money with the client, Working together, and Extras, with search and filters. Each card says what it adds (Approval, Comments, Video, Client picks, Totals, Board, Calendar). A live preview shows the real HTML as you tick, as desktop or phone. |
| 03 How should it look? | Colour, lettering (Modern, Editorial, Technical), currency, light or follow-the-device, and the order and names in the menu. |

Jhino writes one self-contained HTML file with a manifest that tells the server the exact fields of every feature. The server checks every save against it (types, required fields, who may change what). Change the ticks later with **Edit features and design**; unticked features keep their data on the server and come back if you tick them again. **Download HTML** gives you the file.

Everything is built for work between a studio or IT company and its clients:

- **Deliver and approve:** video deliveries (the client watches, comments, approves or asks for changes), photo proofing (the client marks Pick, Maybe or No on every photo), design proofs round by round, final deliveries, and big file transfer both ways.
- **Shoots and production:** shoot schedule with call sheets, shot list, creative brief, mood board, talent and locations, products to shoot.
- **Brand and content:** brand kit, content calendar with approval before publishing, scripts and captions, campaigns, ad spend, monthly reports.
- **Apps and websites:** app releases to test and sign off, bug reports with screen recordings, feature requests, milestones, links and access, domains and hosting renewals, support requests, maintenance log.
- **Money with the client:** invoices and quotes that print as PDF, the client's receipts and expenses with photos, payments with proof, a project ledger, retainer hours and the project budget.
- **Working together:** project updates, tasks for either side, meeting notes, decisions and polls, contracts the client signs and uploads, shared documents, guides, and feedback.

Every created HTML also has:

- **Pages for items.** Open a video, a design, a bug or a receipt and it fills the screen: the player or picture, an Approve / Ask for changes bar (asking for changes asks what should change and posts it as a comment), the details you can change in place, the comments, and its history. Step through items with the arrows, or open one in a new tab: the tab shows just that item or document, with "Open in the app" to get back to everything. The address points at the item, so it can be shared.
- **Files and links on every item.** Upload several files at once, drop them on the item, or paste links (Drive, Dropbox, WeTransfer, YouTube, Figma). The main file of an item can be a link instead of an upload.
- **Activity.** A bell with the number of new things, a list of who did what with links to each item, popups when the other side does something, and desktop notifications (Jhino menu → Turn on desktop notifications).
- **Trash.** Deleting an item, comment, file or link moves it to the app's Trash, with Undo right away. Restore it later, or delete it for good (people who can edit only).
- **Choosing many at once.** Tick rows or files to change their status, download, mark picks or delete them together.
- **Nepali dates.** Dates show in Bikram Sambat with the AD date small beside them (or AD only, if you pick that in step 03). Calendars are BS months with Saturday marked; the date picker is the same calendar.
- **Writing, to-dos and messages.** Scripts, captions, briefs, meeting notes and guides are documents with a list, filters and a proper writing page. To-do lists add with Enter. Messages is a chat between you and the client.

Items with comments have a thread under them: either side writes, attaches a file or screenshot, and the other side sees it live. Approval buttons appear for people who can edit, so give clients **Can edit** (the default when you share).

### Upload HTML

| You do | What happens |
| --- | --- |
| Upload `.html` or `.zip` | The file is checked (size, paths, no symlinks, needs an `index.html`, a valid manifest if it has one) and stored as version 1. It opens straight away, visible only to you. |
| The app saves data | `localStorage` and Claude's `window.storage` are redirected to Jhino: every key is saved on the server with a revision number, then pushed to everyone who has the app open. |
| The app lets someone pick a photo, video or PDF | Jhino streams the real file to the server (videos up to 2 GB, never loaded into memory) and gives the app a link instead of a huge data URL. Photos the app shrinks on a canvas are moved to file storage before saving. Everyone who has the app sees and plays the same file. Small images under 150 KB are left as they are. |
| Two people change the same thing | The server refuses the older write, and the bridge merges both changes (lists of items with an `id` merge item by item). |
| Someone else saves | Apps that listen for the `storage` event update in place; others refresh when the person pauses. Jhino never refreshes while someone is typing or has unsent text; it shows "Refresh now" instead. |
| Upload a new version | Everyone gets the new screens. Saved data is kept. Older versions stay under Details → Versions. |

Apps written for Jhino can use the records and files API (`window.jhino`). See [docs/BUILD_FOR_JHINO.md](docs/BUILD_FOR_JHINO.md), also under Details → Copy build instructions.

### Who can open an app, and what they can do

The owner shares from **Share**:

- **Create a sign-in:** name, sign-in ID (an email or a simple ID like `sita`), an optional password (otherwise one is made), and a role. Jhino shows the sign-in details once to copy and send privately. The owner can make a new password later for sign-ins they made.
- **Existing account:** add someone who already signs in here.
- **Invite link:** a single-use link (7 days) where the person sets their own password.

A copied app link alone never gives access.

People you create from Share, or who join through an invite link, are **clients**: they see only the apps shared with them (a single app opens straight away), cannot upload or create apps, and sign out from the app's ⋯ menu. People an admin adds under People are team members who can upload their own apps.

| Role | Can do |
| --- | --- |
| Owner | Everything, including sharing, versions, features and Trash. |
| Can edit | Add, change and delete anything; approve, mark paid, post notices, send contracts. |
| Can add | Add new items and upload files; change only what they added or what names them (for example a task assigned to them, or a contract they must sign). Cannot change approval fields. |
| Can view | Read only. |

Features marked "each person sees only their own" (expense claims, contracts, leave, support tickets) show Can add and Can view people only what they added or what names them, and the same goes for the files attached to them. The server enforces all of this; the app only mirrors it.

Admins (account level) also manage everyone under **People**.

### What does not sync (uploaded HTML)

- **IndexedDB** is saved on the server too: browsers block it in the sandboxed app frame, so Jhino gives such apps a full IndexedDB (fake-indexeddb) that saves every record and syncs between people.
- **Cookies and `sessionStorage`** stay in one browser tab.
- **Private keys:** an owner can mark some `localStorage` keys (for example `theme`) as private per person.
- **Network calls** the app makes to other websites are not proxied or stored.

### Files

Uploads stream to disk in `DATA_DIR/files`. Limits: `MAX_FILE_MB` per file (default 2048) and `APP_STORAGE_GB` per app (default 50). Images, video, audio and PDF open in the browser; other types download. Everything else a file could run is sandboxed.

**Big videos are made smaller automatically.** Any video from `COMPRESS_VIDEO_MB` (default 20) up is re-encoded in the background with the bundled ffmpeg: H.264 MP4, at most 1920 px on the long side, quality CRF 24, "fast start" so playback begins at once. The original keeps playing while this runs (the uploader sees "Making a smaller copy" with a percentage), and it is only replaced if the new file is at least 10% smaller. In testing a 75 MB 1080p clip became 13.6 MB in about 4 seconds; a 2 GB camera file typically ends up a few hundred MB. One video is processed at a time at low priority, and unfinished work restarts after a server restart. Set `COMPRESS_VIDEO_MB=0` to turn it off, or `FFMPEG_PATH` to use your own ffmpeg.

## Back up and restore

```bash
npm run backup       # writes BACKUP_DIR/<date-time>/ with jhino.db, apps/, files/ and manifest.json (BACKUP_DIR defaults to DATA_DIR/backups)
```

In Docker or Coolify, run `node dist/server/backup.js` inside the container.

It is safe while Jhino is running, because it uses SQLite's online backup. Copy the `backups` folder to another disk or machine: a backup on the same disk does not survive losing that disk.

To restore:

1. Stop Jhino.
2. Move the current `data/` folder aside.
3. Create a new `data/` folder containing the backup's `jhino.db`, `apps/` and `files/`.
4. Start Jhino.

People sign in with the passwords they had when the backup was made.

To recover a lost admin password, sign in as another super admin and use Super Admin → Users → New password, or run `node dist/server/admin.js --email you@example.com --password '…'` on the server. If there is no other admin, stop Jhino, back up `data/`, and ask a developer to reset the hash in the `users` table. There is no hidden backdoor.

## Tests

```bash
npx playwright install chromium firefox webkit   # once
npm run build
npm test                                         # all three browsers
npx playwright test --project=chromium           # just one
```

The tests start their own server on port 4399 with an empty `test-data/` folder, plus a stand-in Google sign-in provider on port 4398. The same tests run in Chromium, Firefox and WebKit (Safari's engine). They cover:

- accounts: sign up, confirm email, password reset links that work once, changing the password (other devices signed out), sessions, data export without secrets, deleting the account
- plans: creation limits enforced by the server; QR payments (fake images refused, private screenshots, one pending at a time), two approvals at the same moment granting the plan once, rejections with a reason; everything in the audit log
- link sharing: public, password and private; visitors reach only that app; super admin addresses (reserved names refused); the custom address opening the app
- Super Admin: paid sign-ins, suspend and reactivate, the uploads switch, customers kept out of the admin API
- Continue with Google: new account, forged token refused, safe linking of an unconfirmed account, unverified email refused, replayed sign-in refused
- studio booking: a reminder sent once before a booking; the day view, double-booking warning and hiding the top bar on screen

- uploaded HTML with files: a large photo, a video and a canvas-shrunk photo picked inside your own HTML are stored on the server and seen, renamed and deleted from both sides (you and a client on a phone); clients land in their app and cannot create apps

- client work on a created HTML: we deliver a video, the client (signed in separately) sees it live, comments and asks for changes; we see the status and the comment; the big video is made smaller and still streams; the client adds a receipt with a photo; we share photos and the client's pick shows up for us
- phone layout of a created HTML: the first four sections in a bottom bar, the rest in a menu that slides up
- activity: lines point at their item, private items stay private, "seen" is remembered
- Nepali dates (BS with AD, and AD only) in lists, the date picker and the calendar
- documents, to-dos and messages used from both sides at once
- Trash: items with their comments and files, restore, delete for good, who may do what
- files and links on an item, several at once, removed to Trash and restored from the Trash screen, Undo
- My apps: an index of client apps, with the ones that have news first; each row shows the client, the latest work and how much is new
- Download as HTML file: one .html file per app. Open it, sign in once, and it is the same app, live with everyone (it needs the internet). Removing someone locks their file at once
- Create HTML: who it is for, ticking features, the live preview, opening directly, saving, and changing features later without losing data
- builder settings: logos must be small PNG, JPG or WebP (SVG refused), comment threads are checked by the server
- owner-made sign-ins and the Can add role: own items only, protected approval fields, editors-only features, "own" visibility for records and their files, contract signing, video byte ranges, password reset
- manifests: conflicting, unsupported or invalid ones are refused
- the full journey in two real browser sessions
- simultaneous edits
- unsent typing surviving live updates
- view-only enforcement and access removal
- app isolation
- revisions and idempotency
- `window.storage` privacy
- unsafe uploads, new versions and rollback
- CSRF protection
- the sandbox

## Security notes and limits

- Passwords are hashed with argon2id. Sessions are server-side, stored hashed, and sent in `HttpOnly`, `SameSite=Strict` cookies (`Secure` when `PUBLIC_URL` is https). Every change needs a CSRF token. Sign-in, sign-up, password reset, payments, link passwords and every write are rate-limited per address. Password, email and account deletion ask for the password again. Security events (sign-ins, failures, password and email changes) are kept per account; admin actions go to the audit log. With https, responses also carry HSTS.
- Uploaded apps run in a sandboxed frame without `allow-same-origin`, so they cannot read Jhino's page, cookies or session. The same sandbox is also sent as a response header, so opening an app file directly does not escape it. The app talks to Jhino only through a per-launch handshake and a private message channel. The server checks every request again.
- Uploaded code is still code: it can show anything, and it can send the data a person can see to other websites. Only people with an account can upload, so give accounts only to people you trust.
- One server, SQLite, small teams. The design target is tens of apps and a handful of people editing at the same time. It has not been load-tested yet.
- Data is not end-to-end encrypted. Whoever runs the server can read it.
