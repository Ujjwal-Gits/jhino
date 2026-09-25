# Jhino status (2026-09-25, SaaS round)

Measured against the product brief plus the owner's direction:
- the main job: **upload or create an HTML, share it with a client by sign-in, and both sides work on the same data and files, live**
- **Create HTML** is for work between a studio or IT company and its clients (never internal HR or company management): who it is for, 41 features, the design; it opens directly
- no management dashboard; every app needs a sign-in ID and password made by its owner, with roles

## Tested automatically: `npm test`, 36 tests × Chromium, Firefox, WebKit = 108/108 passing

| Area | What the tests prove |
| --- | --- |
| Accounts (new) | Sign up, email confirmation link (single use), forgot/reset (same answer for unknown emails, link works once, everyone signed out), change password (needs the current one, other devices signed out), profile validation, sessions, security activity, data export without secrets, account deletion (needs DELETE and the password) |
| Plans and QR payments (new) | Free Forever allows 1 app and the server refuses the 2nd (upload and Create HTML); fake PNGs refused for QR and proof; one pending payment at a time; proof private to the payer and super admins; customers cannot approve; two approvals at the same moment grant the plan once; rejection keeps the plan and shows the reason; audit log entries |
| Link sharing and addresses (new) | Private → public (view, then add) → password (old visitors sent back, wrong/right password) → private; visitors reach only that app (no account, no app list, no invites, no member list); only super admins set addresses, reserved names refused; `/<address>` opens the app |
| Super Admin (new) | Paid sign-ins with a plan, suspend (signed out at once, sign-in refused with the reason) and reactivate, no self-suspend or self-demotion, customers get 403 on every admin API, uploads switch refusing app files with UPLOADS_OFF, audit log |
| Continue with Google (new) | Against a stand-in provider: new account, forged signature refused, same account next time, an unconfirmed same-email account taken over safely (its password stops working), unverified email refused, replayed callback refused |
| Studio booking (new) | A reminder sent once, at the set time before the booking, with the owner's message and a link to the booking; on screen: day view, booking a free slot, double-booking warning |
| Top bar (new) | Hide the top bar from the menu, the corner button brings the menu back, show it again |
| Client work (new) | On a created HTML: we deliver a video, the client (own sign-in) sees it live, comments and asks for changes; we see the status and comment count live and reply; the video is made smaller on the server even while someone streams the original, and still streams (206, MP4); the client adds a receipt with a photo and we see it; we share photos and the client's Pick shows up for us; we change the built HTML and the client's open copy switches to the new version by itself, staying in the same section |
| Activity | Lines point at their item (comments at the item they belong to); lines about private items and files are hidden from people who cannot see them; "seen" per person, never backwards |
| Nepali dates | BS with AD small in lists, the date picker (picking saves the right AD date) and BS calendar months with Saturday; AD-only apps show AD |
| Documents, to-dos, messages | A script written on one side is read and approved on the other; to-dos typed quickly are not lost and ticks sync; chat both ways |
| Trash | Items go to Trash with their comments and come back with the same id; files hide, restore and delete for good; Can add people restore their own things but cannot delete for good |
| Files and links | Links and several files at once on an item; removing several goes to Trash; Select all and Restore on the Trash screen; Undo after deleting an item |
| My apps | One quiet list, apps with news first; each row: name, latest work line, people, new count and time; search, All/Created/Uploaded, sort, row menu |
| Download as HTML file | Player menu, My apps row menu, Share dialog. The file signs in once (a key for that one app, kept on that computer), then opens the same app live over the internet; removing the person, a new password or "Sign out of this file" ends the key |
| Hand-written HTML | samples/ticket-rail.html: plain HTML/CSS/JS with localStorage and FileReader, its own design kept exactly; live between web, phone and the downloaded file (tests/handwritten.spec.ts) |
| Stay signed in | Web sessions last 60 days and renew themselves while used |
| Open in a new tab | Opens only that item or document at `/apps/:id/view#…` (no dashboard), with "Open in the app"; long documents never scroll past their content |
| Phone layout | Bottom bar with the first four sections (short names), More and the menu button open every section, a renamed section keeps its name |
| Create HTML | Who it is for (client name fills the HTML name), ticking feature cards, live preview, create, opens directly, purpose and client shown, saving works, changing features later keeps data |
| Builder settings | SVG or oversized logos refused; comment threads checked by the server |
| Sign-ins and roles | Owner makes a sign-in (duplicate IDs refused), it sees only that app; Can add creates own items, cannot change others' items or use editors-only features; schema refuses bad values, unknown fields and undeclared collections |
| Private sections and files | Contracts visible only to the signer, including the attached files; contract signing; video byte ranges; owner password reset signs the person out |
| Manifests | Conflicting embedded vs jhino.json, unsupported capabilities and unknown field types are refused |
| Uploaded HTML | Photos and videos picked inside your own HTML are shared both ways; full two-person journey, simultaneous edits merged, unsent typing kept, viewer refused, access removal is immediate, app isolation, revisions and idempotency, window.storage privacy, unsafe uploads refused, versions and rollback, CSRF, sandbox |

## Live on this machine (http://127.0.0.1:4310)

**Himalayan Coffee · Video production** was made through the Create HTML page:
- **Setup:** client name, logo, and Video production (plus Payments, Overview and later Photo proofing and Links).
- **Sharing:** shared with a client sign-in (`himalayan`).
- **Two-sided work** (studio on a desktop, client on a phone):
  - We uploaded an 85 MB cut in under a second.
  - The client watched it, commented and asked for changes; we saw it and replied.
  - The client added a courier receipt with a photo.
  - We shared four photos and the client picked two.
  - Two new versions of the HTML reached the client's open app by themselves (the first in 73 ms).
- **Video:** the server made the 85 MB video 17.3 MB. In a second check, with a download of the original held open the whole time, 80.9 MB became 16.5 MB and the old copy was removed.

## Verified with scripted browser runs in the second round (older feature set, not in the suite)

- **Two people using a 13-feature created app.**
  - Receipts with photo upload, approval and live updates.
  - The cash book balance.
  - An invoice (VAT maths checked).
  - Contract signing: download, then upload of the signed copy.
  - A 120 MB upload in about 3 seconds.
  - Video playback for the second person.
  - Polls, checklist, wiki, notice board permissions, private leave and the task board drag.
- **All 37 features in one app:** every section renders with no page errors.
- **Dashboard actions:**
  - People page: add, turn off, turn on, new password.
  - Changing a password.
  - Drag-and-drop upload.
  - New version, then making the old one live again.
  - Creating a sign-in from Share.
  - Joining through an invite with an existing account.
  - Private keys.
  - Trash, restore and delete for good.
- **From the first round:** server restart with open tabs, backup restored into a clean instance, Nepali text, mobile (390 px), dark theme.

## Not verified

- The Docker image (Docker is not installed on the build machine).
- HTTPS with HTTP/2 behind a real proxy.
- Load at the suggested workload.
- A formal WCAG audit with a screen reader.
- Real phone hardware; mobile was checked in emulated browsers only.

## Plans, addresses and short links round (2026-09-25)

- New website with plan cards and a monthly/yearly switch. The Super Admin workspace has a sidebar and a dashboard. Owners pick addresses when they create an app. Short links. Plan features are checked by the server. Plans are paid for a month or a year and have end dates.
- Playwright: 40 tests × 3 browsers = 120 passing. The new tests cover address uniqueness across apps and short links, the exact-address opening, short link redirects, click counts and plan limits, yearly and monthly payment end dates, and the admin layout on desktop and phone.

## Usernames, My page, email codes round (2026-09-25)

- Unique usernames. Addresses and short links live under them (jhino.com/<username>/<name>); top-level addresses are for super admins only.
- My page at jhino.com/<username> is a link in bio with socials, video, apps, two layouts, 30 designs by plan, Pro own HTML (sandboxed), and analytics.
- 6-digit email codes for confirming an email, resetting a password and changing an email. Videos are shared as links only (super admins excepted). "Create HTML" is now "Create app".
- Playwright: 47 tests × 3 browsers = 141 passing.

## Known limits

- **Built apps on HTTP/1.1:** each open tab holds one live connection. Browsers allow about six per server, so use HTTPS with HTTP/2 in production. Background tabs release their connection after 15 seconds.
- **Uploaded localStorage apps:** changes are merged per key and per item `id`. Two people editing the very same text field at the same moment: the later save wins.
- **Files:** up to `MAX_FILE_MB` (2 GB default) each. There is no virus scanning.
- **Built apps:** fields per feature are fixed by the catalog; you can rename and reorder features but not add custom fields yet.
- **Video compression:** one video at a time, CPU-bound. A 2 GB file can take several minutes on a small server; it keeps playing from the original meanwhile. Audio-only and image files are never changed.

## Deferred

- Custom fields in Create HTML.
- Email delivery of sign-in details (they are copied by hand).
- App duplication.
- A backup schedule in the UI (backups are a command).
