# Website builder: site JSON, blocks and themes

This is the reference for writing website templates as data. A template is one JSON file in
`builder/site-templates/`. The server reads that folder at start-up (in development, every few seconds), so a
new file shows up in **Create a website** without any code change.

The source of truth is `server/site/schema.ts`. The block and theme sections below are generated from it by
`npx tsx scripts/site-blocks-doc.ts`. Run that after changing a block.

## How it fits together

- **A site is an app.** It gets an address (`jhino.com/<user>/<slug>/`), Share, custom domains, the per-domain
  sign-in, version history, "Show on Google" and the "Built with Jhino" line, exactly like any other app.
- **The draft** lives on the app (`apps.site_draft`) and autosaves while the owner edits.
- **Publish** renders every page to static HTML (`server/site/render.ts`) into a new version folder:
  `index.html`, `<slug>/index.html`, and `assets/` (uploaded photos are copied in). The version row keeps the
  site JSON it was made from (`app_versions.site`). Rolling back a version works like any app.
- **Public sites** (Share: anyone with the address, view only) are served as plain HTML straight from their
  address, with strict security headers. Password and private sites open through the usual Jhino link page.
- **Forms** (contact, booking, email signup) post to `/_jhino/site-form`. Submissions go to the
  `site_submissions` table and show in the editor's **Submissions** tab, with CSV export.

## A template file

```json
{
  "id": "cafe",
  "name": "Ghumti Café",
  "category": "Restaurant and café",
  "description": "One sentence for the template picker.",
  "site": { ...a site, see below... }
}
```

- `category` groups templates on the start screen. Reuse an existing category name where it fits.
- `name` is the business name used in the copy. When someone creates a site from the template, every
  occurrence of this exact name in the site's text is replaced with the name they type.
- Write real, specific copy for a Nepali business: real dishes, prices in rupees, neighbourhoods, festivals,
  opening hours. No "Lorem ipsum", no invented reviews or statistics (the `testimonials` and `stats` blocks are
  for the owner's real words and numbers; leave them out of templates, or keep their instructive defaults).
- Photos: use library photos (`"src": "lib:<name>"`, listed at the end) or leave `src` empty. A block with an
  empty photo shows an "Add a photo" frame in the editor and nothing on the published site.

## The site object

```json
{
  "name": "Ghumti Café",
  "theme": { "preset": "chiya" },
  "settings": {
    "tagline": "Coffee, momo and chiya in Jhamsikhel",
    "lang": "en",
    "phone": "01-5911204",
    "email": "hello@example.com.np",
    "address": "Jhamsikhel Road, Lalitpur 44600",
    "social": [{ "network": "instagram", "url": "https://www.instagram.com/..." }],
    "logo": null, "favicon": null, "socialImage": null
  },
  "header": { "type": "header", "variant": "bar", "props": { ... } },
  "footer": { "type": "footer", "variant": "columns", "props": { ... } },
  "pages": [
    { "id": "home", "title": "Home", "seoTitle": "", "seoDescription": "", "blocks": [ ... ] },
    { "id": "menu", "slug": "menu", "title": "Menu", "nav": true, "blocks": [ ... ] }
  ]
}
```

- **pages**: up to 30. The first page is the home page (its slug is always empty). Other slugs are 1 to 42
  lowercase letters, digits and dashes; a missing or clashing slug is made from the title. `nav: false` keeps a
  page out of the menu. `seoTitle` (up to 70) and `seoDescription` (up to 170) are what Google and link previews
  show; empty ones fall back to the page and site names and the first long text on the page.
- **Page ids** matter: links point at pages as `"href": "page:<id>"`, so they survive renames.
- **header** and **footer** are one block each for the whole site (`null` for none). The menu is built from
  the pages automatically.
- **blocks**: up to 60 per page. Each is `{ "type", "variant", "props", "style" }`; `id` is optional in
  templates (one is made). Unknown props are dropped, missing props take the block's defaults, text is
  sanitised, and lists are cut to their limits, so a slightly wrong template still loads.
- **style** (optional): `bg` is `page` (default), `surface`, `accent` or `ink` (dark, the text colour);
  `space` is `s`, `m` (default) or `l`; `hide` is `""`, `mobile` (computers only) or `desktop` (phones only).
- **Anchors**: each block's section gets the block type as its id (`#menu`, `#contact`, then `#faq-2` for a
  second one), so `"href": "#contact"` works within a page.

### Values

- **Inline text** (`text`, `para`): may contain `<strong>`, `<em>`, `<a href>` and `<br>`; everything else is
  removed. **Rich text** (`rich`) also allows `<p>`, `<ul>`, `<ol>`, `<li>` and `<h3>`.
- **Plain text** is shown as typed (escaped).
- **Links** (`href`, `url` props): `https://…`, `http://…`, `mailto:…`, `tel:…`, `page:<page id>`, `#anchor`
  or `/path`. Anything else (including `javascript:`) is dropped.
- **Images**: `{ "src": "lib:<name>" | "file:<uploaded file id>" | "https://…", "alt": "…", "focal": [x, y] }`.
  `focal` is the part that stays in view when cropped, in percent (default 50, 50). Always write `alt`.
- **Prices** in `menu` and `pricing`: write digits (`"4500"`); they are shown with Nepali grouping and the
  currency (`Rs 4,500`, or `रू` on a Nepali-language site). Text like `"From 3,000"` is shown as written.
- **Opening hours**: day names in English or Nepali (Sunday, आइतबार…) get today's row marked for visitors.

## Theme tokens

`theme` is a preset id plus any overrides:

```json
{ "preset": "chiya", "display": "youngserif", "body": "hanken",
  "colors": { "bg": "#f4efe6", "surface": "#ebe2d2", "text": "#2a211b", "muted": "#6b5d51",
              "accent": "#b5462a", "onAccent": "#fff8f1", "line": "#d8ccb8" },
  "radius": 4, "space": 1, "button": "solid", "rhythm": "airy", "caps": false }
```

- `display` / `body`: font ids (below). Headings use the display font at a weight tuned per font.
- `colors`: seven hex colours. `accent` is for buttons and small marks; `onAccent` is text on it. Keep text
  on `bg` and `onAccent` on `accent` at 4.5:1 contrast or more.
- `radius`: 0 to 28 px. `space`: 0.8 to 1.3 (padding inside blocks). `button`: `solid`, `outline`, `pill`
  or `underline`. `rhythm`: `tight`, `even` or `airy` (space between sections). `caps`: headings in capitals.
- Everything renders through these tokens, so switching the preset restyles the whole site.

<!-- generated: npx tsx scripts/site-blocks-doc.ts -->
## Blocks

### Page structure

#### `header`: Header and menu (one per site, in `site.header`)

Your logo or name, a link to every page (it updates by itself) and one button.

Variants: `bar` (Logo left, links right), `centered` (Logo centred, links below), `minimal` (Logo and a menu button). The first is the default.

Props:
- `cta` (Button): button `{ label, href, newTab? }`.
- `sticky` (Stays on top while scrolling): true / false.

Defaults: `{"cta":{"label":"Contact us","href":""},"sticky":true}`

#### `hero`: Hero

The first thing people see: what you do, where, and what to do next.

Variants: `split` (Text beside a photo), `image` (Full photo, text on top), `text` (Large type only), `video` (Video in the background). The first is the default.

Props:
- `eyebrow` (Small line above): inline text (bold, italic, links), up to 80 characters.
- `title` (Headline): inline text (bold, italic, links), up to 160 characters.
- `text` (Text): inline text, several lines, up to 500 characters.
- `primary` (Main button): button `{ label, href, newTab? }`.
- `secondary` (Second button): button `{ label, href, newTab? }`.
- `image` (Photo): image `{ src, alt, focal? }`.
- `video` (Background video): link (https:, mailto:, tel:, page:<id>, #anchor). A direct link to an .mp4 file. The photo shows while it loads and on slow connections.

Defaults: `{"eyebrow":"","title":"Say what you do and where, in one line","text":"Add a sentence or two about who you help and why people come back. Click any text on the page to change it.","primary":{"label":"Get in touch","href":""},"secondary":{"label":"","href":""},"image":{"src":"","alt":""},"video":""}`

#### `footer`: Footer (one per site, in `site.footer`)

Your name, pages, contact details and social links, on every page.

Variants: `columns` (Columns), `simple` (One quiet line), `big` (Large name). The first is the default.

Props:
- `about` (About line): inline text, several lines, up to 300 characters.
- `note` (Small print): inline text (bold, italic, links), up to 160 characters.
- `showPages` (List the pages): true / false.
- `showContact` (Show phone, email and address): true / false.
- `showSocial` (Show social links): true / false.

Defaults: `{"about":"","note":"","showPages":true,"showContact":true,"showSocial":true}`

### Text and media

#### `richtext`: Text

A heading and paragraphs, with bold, italic, links and lists.

Variants: `narrow` (Narrow column), `wide` (Wide column), `split` (Heading left, text right). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `body` (Text): rich text (paragraphs, lists, h3, bold, italic, links), up to 12000 characters.

Defaults: `{"heading":"A heading for this part","body":"<p>Write the way you talk to a customer at the counter. Short paragraphs read best on a phone.</p>"}`

#### `image`: Image

One photo, with a caption if you like.

Variants: `contained` (Inside the page margins), `full` (Edge to edge), `framed` (Caption beside it). The first is the default.

Props:
- `image` (Photo): image `{ src, alt, focal? }`.
- `caption` (Caption): inline text (bold, italic, links), up to 240 characters.

Defaults: `{"image":{"src":"","alt":""},"caption":""}`

#### `imagetext`: Image and text

A photo next to a short story, with a link.

Variants: `left` (Photo on the left), `right` (Photo on the right), `stacked` (Photo above). The first is the default.

Props:
- `image` (Photo): image `{ src, alt, focal? }`.
- `eyebrow` (Small line above): inline text (bold, italic, links), up to 80 characters.
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `body` (Text): rich text (paragraphs, lists, h3, bold, italic, links), up to 4000 characters.
- `link` (Link): button `{ label, href, newTab? }`.

Defaults: `{"image":{"src":"","alt":""},"eyebrow":"","heading":"Tell one story here","body":"<p>How you started, how something is made, or what a first visit is like.</p>","link":{"label":"","href":""}}`

#### `gallery`: Gallery

Several photos as a grid, a masonry wall or a carousel.

Variants: `grid` (Even grid), `masonry` (Masonry), `carousel` (Carousel). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `intro` (Intro): inline text, several lines, up to 400 characters.
- `images` (Photos): list of items. Up to 48 photos, each:
  - `image` (Photo): image `{ src, alt, focal? }`.
  - `caption` (Caption): inline text (bold, italic, links), up to 160 characters.

Defaults: `{"heading":"Gallery","intro":"","images":[{"image":{"src":"","alt":""},"caption":""},{"image":{"src":"","alt":""},"caption":""},{"image":{"src":"","alt":""},"caption":""}]}`

#### `video`: Video

A YouTube or Vimeo video. It loads only when someone presses play, so the page stays fast.

Variants: `wide` (Wide), `contained` (Narrow), `split` (Text beside it). The first is the default.

Props:
- `url` (YouTube or Vimeo link): link (https:, mailto:, tel:, page:<id>, #anchor).
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `text` (Text): inline text, several lines, up to 600 characters.
- `caption` (Caption): inline text (bold, italic, links), up to 200 characters.

Defaults: `{"url":"","heading":"","text":"","caption":""}`

### Business

#### `features`: Services

What you offer, each with a line or two and an optional price or time.

Variants: `rows` (Numbered rows), `grid` (Two columns), `compact` (Compact list). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `intro` (Intro): inline text, several lines, up to 500 characters.
- `items` (Services): list of items. Up to 30 services, each:
  - `title` (Name): inline text (bold, italic, links), up to 100 characters.
  - `text` (Description): inline text, several lines, up to 500 characters.
  - `detail` (Price or time): plain text, up to 60 characters.

Defaults: `{"heading":"What we do","intro":"","items":[{"title":"First service","text":"One or two lines on what is included.","detail":""},{"title":"Second service","text":"Who it is for and how long it takes.","detail":""}]}`

#### `pricing`: Pricing

Packages with prices and what each includes.

Variants: `columns` (Side by side), `table` (Rows), `list` (Simple list). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `intro` (Intro): inline text, several lines, up to 500 characters.
- `currency` (Currency): one of: `NPR`, `INR`, `USD`, `EUR`, `GBP`, `AUD`, ``.
- `plans` (Packages): list of items. Up to 8 packages, each:
  - `name` (Name): inline text (bold, italic, links), up to 80 characters.
  - `price` (Price): plain text, up to 30 characters. Numbers only, like 4500 or 4,500.
  - `period` (Per): plain text, up to 30 characters.
  - `note` (Short note): inline text, several lines, up to 200 characters.
  - `features` (What is included (one per line)): inline text, several lines, up to 1200 characters.
  - `cta` (Button): button `{ label, href, newTab? }`.
  - `featured` (Point this one out): true / false.

Defaults: `{"heading":"Prices","intro":"","currency":"NPR","plans":[{"name":"Basic","price":"","period":"","note":"","features":"What is included\nAnother thing included","cta":{"label":"","href":""},"featured":false}]}`

#### `menu`: Menu

Food and drinks by section, with prices in rupees (or any currency).

Variants: `columns` (Two columns), `list` (One long list), `compact` (Compact board). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `intro` (Note): inline text, several lines, up to 400 characters.
- `currency` (Currency): one of: `NPR`, `INR`, `USD`, `EUR`, `GBP`, `AUD`, ``.
- `sections` (Sections): list of items. Up to 16 sections, each:
  - `title` (Section): inline text (bold, italic, links), up to 80 characters.
  - `note` (Section note): inline text, several lines, up to 200 characters.
  - `items` (Dishes and drinks): list of items. Up to 60 items, each:
    - `name` (Name): inline text (bold, italic, links), up to 90 characters.
    - `desc` (Description): inline text, several lines, up to 240 characters.
    - `price` (Price): plain text, up to 20 characters.
    - `tag` (Tag): plain text, up to 20 characters. Like Veg, New or Spicy.

Defaults: `{"heading":"Menu","intro":"","currency":"NPR","sections":[{"title":"Section","note":"","items":[{"name":"Dish name","desc":"What is in it.","price":"","tag":""}]}]}`

#### `team`: Team

The people behind the work, with or without photos.

Variants: `grid` (Photos in a grid), `list` (Names and roles in rows), `monogram` (Initials instead of photos). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `intro` (Intro): inline text, several lines, up to 400 characters.
- `people` (People): list of items. Up to 40 persons, each:
  - `name` (Name): inline text (bold, italic, links), up to 80 characters.
  - `role` (Role): inline text (bold, italic, links), up to 100 characters.
  - `bio` (Short bio): inline text, several lines, up to 400 characters.
  - `image` (Photo): image `{ src, alt, focal? }`.

Defaults: `{"heading":"Who you will meet","intro":"","people":[{"name":"Full name","role":"Role","bio":"","image":{"src":"","alt":""}}]}`

#### `testimonials`: Testimonials

What real customers said, in their words.

Variants: `single` (One large quote), `grid` (Several quotes), `carousel` (Carousel). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `items` (Quotes): list of items. Up to 20 quotes, each:
  - `quote` (Quote): inline text, several lines, up to 600 characters.
  - `name` (Name): inline text (bold, italic, links), up to 80 characters.
  - `detail` (Who they are): inline text (bold, italic, links), up to 100 characters.

Defaults: `{"heading":"","items":[{"quote":"Paste a review a customer really wrote, word for word.","name":"Their name","detail":""}]}`

#### `logos`: Logos

Clients, partners or press, as logos or names.

Variants: `row` (One row), `grid` (Grid). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `items` (Logos): list of items. Up to 24 logos, each:
  - `name` (Name): plain text, up to 60 characters.
  - `image` (Logo): image `{ src, alt, focal? }`.
  - `url` (Link): link (https:, mailto:, tel:, page:<id>, #anchor).

Defaults: `{"heading":"Worked with","items":[{"name":"Client name","image":{"src":"","alt":""},"url":""}]}`

#### `stats`: Numbers

A few real numbers. Rows with no number are not shown on the site.

Variants: `row` (In a row), `big` (Large), `split` (Beside a text). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `text` (Text): inline text, several lines, up to 500 characters.
- `items` (Numbers): list of items. Up to 8 numbers, each:
  - `value` (Number): plain text, up to 20 characters. Only a number you can stand behind.
  - `label` (What it counts): inline text (bold, italic, links), up to 80 characters.

Defaults: `{"heading":"","text":"","items":[{"value":"","label":"What this number counts"}]}`

### Engagement

#### `faq`: Questions

Questions people ask before they call, with short answers.

Variants: `accordion` (Open one at a time), `split` (Heading left), `plain` (All open). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `intro` (Intro): inline text, several lines, up to 400 characters.
- `items` (Questions): list of items. Up to 40 questions, each:
  - `q` (Question): inline text (bold, italic, links), up to 200 characters.
  - `a` (Answer): inline text, several lines, up to 1500 characters.

Defaults: `{"heading":"Questions","intro":"","items":[{"q":"A question people often ask?","a":"A short, direct answer."}]}`

#### `cta`: Call to action

One clear next step: book, call, visit or order.

Variants: `band` (Full-width band), `split` (Text left, buttons right), `boxed` (Boxed). The first is the default.

Props:
- `title` (Heading): inline text (bold, italic, links), up to 140 characters.
- `text` (Text): inline text, several lines, up to 400 characters.
- `primary` (Main button): button `{ label, href, newTab? }`.
- `secondary` (Second button): button `{ label, href, newTab? }`.

Defaults: `{"title":"Ready when you are","text":"","primary":{"label":"Get in touch","href":""},"secondary":{"label":"","href":""}}`

#### `contact`: Contact form

A short form. Messages arrive in Submissions, and your details sit beside it.

Variants: `split` (Details beside the form), `form` (Form only), `stacked` (Details above). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `text` (Text): inline text, several lines, up to 400 characters.
- `address` (Address): inline text, several lines, up to 200 characters. Empty: the address from Site settings.
- `phone` (Phone): plain text, up to 40 characters. Empty: the phone from Site settings.
- `email` (Email): plain text, up to 120 characters. Empty: the email from Site settings.
- `askPhone` (Ask for a phone number): true / false.
- `button` (Button): plain text, up to 40 characters.
- `success` (Message after sending): plain text, up to 200 characters.

Form fields visitors send: `name` (required), `email`, `phone`, `message` (required).

Defaults: `{"heading":"Write to us","text":"","address":"","phone":"","email":"","askPhone":true,"button":"Send message","success":"Thank you. We will reply within a day."}`

#### `booking`: Booking form

Visitors ask for a date and time; you confirm by phone or email.

Variants: `split` (Text beside the form), `form` (Form only). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `text` (Text): inline text, several lines, up to 500 characters.
- `services` (Choices (one per line)): inline text, several lines, up to 800 characters. Visitors pick one, like a service, a table size or a package. Leave empty to skip.
- `askTime` (Ask for a time): true / false.
- `button` (Button): plain text, up to 40 characters.
- `success` (Message after sending): plain text, up to 200 characters.

Form fields visitors send: `name` (required), `phone` (required), `email`, `choice`, `date`, `time`, `notes`.

Defaults: `{"heading":"Ask for a booking","text":"Pick a day and we will confirm by phone.","services":"","askTime":true,"button":"Send request","success":"Thank you. We will call to confirm."}`

#### `newsletter`: Email signup

Collect email addresses for news and offers.

Variants: `inline` (Heading and field in a row), `band` (Coloured band), `card` (Small card). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `text` (Text): inline text, several lines, up to 300 characters.
- `button` (Button): plain text, up to 30 characters.
- `success` (Message after signing up): plain text, up to 200 characters.

Form fields visitors send: `email` (required).

Defaults: `{"heading":"Hear about new things first","text":"One email a month at most.","button":"Sign up","success":"Thank you. You are on the list."}`

#### `hours`: Opening hours

Your days and hours. Today is marked for visitors.

Variants: `table` (Table), `compact` (Compact), `split` (Beside a note). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `note` (Note): inline text, several lines, up to 400 characters.
- `days` (Days): list of items. Up to 14 days, each:
  - `day` (Day): plain text, up to 30 characters.
  - `hours` (Hours): plain text, up to 60 characters.

Defaults: `{"heading":"Opening hours","note":"","days":[{"day":"Sunday","hours":"10:00 – 18:00"},{"day":"Monday","hours":"10:00 – 18:00"},{"day":"Tuesday","hours":"10:00 – 18:00"},{"day":"Wednesday","hours":"10:00 – 18:00"},{"day":"Thursday","hours":"10:00 – 18:00"},{"day":"Friday","hours":"10:00 – 18:00"},{"day":"Saturday","hours":"Closed"}]}`

#### `map`: Map

A Google map of where you are, with a directions link. No API key needed.

Variants: `embed` (Map, full width), `split` (Address beside the map), `card` (Address card only). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `address` (Address): inline text, several lines, up to 300 characters. Empty: the address from Site settings.
- `query` (Place to show): plain text, up to 200 characters. A place name or address as you would type it into Google Maps.
- `link` (Google Maps link): link (https:, mailto:, tel:, page:<id>, #anchor). The share link from Google Maps, for directions.

Defaults: `{"heading":"Find us","address":"","query":"","link":""}`

#### `timeline`: Timeline

Dates and milestones, or the steps of how you work.

Variants: `vertical` (Down the page), `horizontal` (Across), `list` (Dated list). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `items` (Entries): list of items. Up to 30 entrys, each:
  - `date` (Date or step): plain text, up to 30 characters.
  - `title` (Title): inline text (bold, italic, links), up to 100 characters.
  - `text` (Text): inline text, several lines, up to 500 characters.

Defaults: `{"heading":"How it started","items":[{"date":"2079","title":"The first year","text":""}]}`

#### `beforeafter`: Before and after

Two photos to compare, with a slider.

Variants: `slider` (Slider), `side` (Side by side). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `before` (Before): image `{ src, alt, focal? }`.
- `after` (After): image `{ src, alt, focal? }`.
- `beforeLabel` (Before label): plain text, up to 30 characters.
- `afterLabel` (After label): plain text, up to 30 characters.
- `caption` (Caption): inline text (bold, italic, links), up to 200 characters.

Defaults: `{"heading":"","before":{"src":"","alt":""},"after":{"src":"","alt":""},"beforeLabel":"Before","afterLabel":"After","caption":""}`

#### `downloads`: Downloads and links

Menus, brochures, forms or useful links.

Variants: `list` (List), `cards` (Tiles). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `items` (Links): list of items. Up to 30 links, each:
  - `label` (Label): inline text (bold, italic, links), up to 100 characters.
  - `url` (Link): link (https:, mailto:, tel:, page:<id>, #anchor).
  - `note` (Note): plain text, up to 80 characters. Like PDF, 2 pages.

Defaults: `{"heading":"Downloads","items":[{"label":"Price list","url":"","note":"PDF"}]}`

#### `social`: Social links

Where to follow you. Empty: the links from Site settings.

Variants: `row` (In a row), `list` (List with names), `big` (Large names). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `links` (Links): list of items. Up to 12 links, each:
  - `network` (Network): one of: `facebook`, `instagram`, `tiktok`, `youtube`, `x`, `linkedin`, `whatsapp`, `viber`, `pinterest`, `behance`, `website`.
  - `url` (Link): link (https:, mailto:, tel:, page:<id>, #anchor).

Defaults: `{"heading":"Follow along","links":[]}`

#### `spacer`: Space or divider

Breathing room, or a thin line between parts.

Variants: `space` (Empty space), `line` (Thin line), `mark` (Short accent rule). The first is the default.

Props:
- `size` (Size): one of: `s`, `m`, `l`.

Defaults: `{"size":"m"}`

## Theme presets

| id | name | display / body font | radius | buttons | rhythm | for |
| --- | --- | --- | --- | --- | --- | --- |
| `chiya` | Chiya house | youngserif / hanken | 4 | solid | airy | Cream paper, a soft serif and terracotta. Cafés, bakeries, homestays. |
| `darkroom` | Darkroom | bodoni / archivo | 0 | outline | airy | Near-black, bone white and a didone. Photographers, film, fashion. |
| `clinic` | Clear clinic | hanken / hanken | 8 | solid | even | White, pine green, one grotesque. Clinics, pharmacies, labs. |
| `newsprint` | Newsprint | newsreader / newsreader | 0 | underline | tight | Off-white and ink with a red rule. Writers, NGOs, publications. |
| `workshop` | Workshop | bigshoulders / archivo | 0 | solid | tight | Concrete grey, signal yellow, condensed capitals. Gyms, garages, builders. |
| `rhododendron` | Rhododendron | dmserif / schibsted | 16 | pill | even | Blush white and laligurans red. Salons, boutiques, events. |
| `teagarden` | Tea garden | fraunces / schibsted | 22 | pill | airy | Pale leaf, deep green and round corners. Farms, tea, wellness. |
| `ledger` | Ledger | plexmono / newsreader | 2 | outline | even | Typewriter headings over a book serif. Consultants, architects, lawyers. |
| `marigold` | Marigold night | gloock / bricolage | 6 | solid | even | Warm dark brown with marigold. Bars, music venues, late kitchens. |
| `gallery` | Gallery white | archivo / archivo | 0 | underline | airy | White space and heavy black type, nothing else. Studios, artists, agencies. |

## Fonts (self-hosted, `/_jhino/fonts/s-<id>.woff2`)

- `youngserif`: Young Serif (serif, weights 400–400)
- `fraunces`: Fraunces (serif, weights 100–900)
- `newsreader`: Newsreader (serif, weights 200–800)
- `bodoni`: Bodoni Moda (serif, weights 400–900)
- `dmserif`: DM Serif Display (serif, weights 400–400)
- `gloock`: Gloock (serif, weights 400–400)
- `hanken`: Hanken Grotesk (sans, weights 100–900)
- `schibsted`: Schibsted Grotesk (sans, weights 400–900)
- `archivo`: Archivo (sans, weights 100–900)
- `bricolage`: Bricolage Grotesque (sans, weights 200–800)
- `bigshoulders`: Big Shoulders Display (display, weights 100–900)
- `jetbrains`: JetBrains Mono (mono, weights 100–800)
- `plexmono`: IBM Plex Mono (mono, weights 400–400)

## Library photos (`lib:<name>`)

- `food-spread`: Plates of grilled meat, greens and dipping sauce on a wooden table
- `dinner-plate`: A plated dish on a busy dinner table
- `cafe-hall`: A bright café with long tables and hanging lamps
- `dining-room`: A dark dining room with wooden chairs
- `long-table`: A long table set with glasses and flowers
- `wedding-bouquet`: A bride holding a bouquet in warm light
- `camera-kit`: A camera body and two lenses on a dark table
- `ridge-photographer`: A photographer on a rocky ridge above the clouds
- `portrait-woman`: Portrait of a woman in a striped shirt
- `portrait-man`: Portrait of a smiling man
- `doctor-visit`: A doctor talking with a patient
- `doctor-coat`: A doctor in a white coat with a stethoscope
- `pill-bottle`: A bottle of tablets on a white surface
- `boudha`: Boudhanath stupa from above, surrounded by the city
- `swayambhu`: Swayambhu stupa with prayer flags
- `himal-trek`: A trekker looking at snow peaks
- `night-peaks`: Snow peaks under a starry sky
- `cut-pour-over`: Coffee being poured over a filter
- `shoot-beans`: Roasted coffee beans
- `shoot-cheers`: Two coffee cups raised together
- `shoot-iced`: An iced coffee in a glass
- `shoot-lattes`: Two lattes with milk art
