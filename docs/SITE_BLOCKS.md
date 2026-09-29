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

## Making a template look studio-made

The three flagship templates (`cafe`, `clinic`, `agency`) are the reference. Open them next to this list.

- **Long and complete.** The home page has 10 to 14 sections (header and footer included); every inner page
  (3 or 4 of them) is fully built, 5 to 8 blocks, never a stub with one text block.
- **Photo-led.** 10 to 15 library photos per template, each one of *this* business (the dish, the room, the
  treatment, the work), never a nearby category. Set `focal` when the subject is off-centre. If the library has
  no fitting photo, add one (see *Adding library photos*) instead of using an unrelated one.
- **Pick the theme for the photography**, not the category: `roast` (white, bottle green, heavy serif) suits
  moody food and coffee; `meridian` (white, navy, cobalt) suits bright clinical rooms; `monolith` (near-black,
  marigold) suits a portfolio of vivid work. Every theme has one accent. Do not add a second accent colour.
- **Vary the rhythm.** Alternate dense and quiet sections and change the layout every block: a full-photo hero,
  then a band of `marquee` words on `accent`, a `quote`, `rows` with big photos, a text-dense `features` list on
  `surface`, a `sticky` photo story, a `gallery` mosaic, and so on. Never put two blocks with the same layout
  next to each other. Use `style.bg` (`surface`, `accent`, `ink`) to separate sections instead of lines.
- **No eyebrows.** The small line above headings is gone; the hero's `eyebrow` prop is now a *detail line*
  shown under the buttons (hours, neighbourhood). Headings carry themselves.
- **Numbers only where order matters.** `steps` is numbered because the order is the point. Lists of services
  are not numbered.
- **Real content only.** No invented reviews, press mentions, awards or statistics. `quote` may carry the
  owner's own words; `press`, `stats` and `testimonials` stay out of templates unless the copy is clearly
  the business's own. Avoid real brand, hospital or shop names in copy.
- **Close well.** End the home page with a `cta` (the `image` variant over a photo is strongest), and use the
  `rich` footer with a closing line, a button and the hours.
- **Check both widths.** Look at every page at 1440 and 390 px wide before calling it done.

### Motion

One signature motion only, and it is automatic: photos inside most photo blocks are *unveiled* as they scroll
into view (a panel in the section colour slides away while the photo settles from 1.08 to 1; transform only).
It is off in the editor, in print, without JavaScript and for visitors who turn motion off. The `marquee`
block moves slowly and stands still for those visitors too. Do not ask for more.

### Adding library photos

Free Unsplash photos only (the `unsplash.com/photos/<id>/download` redirect must go to `images.unsplash.com`;
Unsplash+ is not allowed). Convert each to WebP at 800 and 1600 pixels wide (the files
`runtime/site-img/<name>-800.webp` and `<name>-1600.webp`; the flagship photos were drawn onto a canvas in
Chromium and exported with `toDataURL('image/webp', 0.8)`), add `'<name>': { widths: [800, 1600], alt: '…' }`
to `LIBRARY` in `server/site/schema.ts`, and a line to `runtime/site-img/CREDITS.txt`. When a photo is
retired, add its name to `LIBRARY_MOVED` with the photo that replaces it, so older sites keep a picture.

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

`theme` is a preset id plus any overrides. In a template, the preset alone is usually right:

```json
{ "preset": "roast" }
{ "preset": "roast", "display": "rozha", "body": "figtree",
  "colors": { "bg": "#ffffff", "surface": "#f3f1ec", "text": "#1b1815", "muted": "#5f5851",
              "accent": "#1f4a3a", "onAccent": "#ffffff", "line": "#e4e0d9" },
  "radius": 2, "space": 1, "button": "solid", "rhythm": "airy", "caps": false, "scale": 1.02 }
```

- Theme ids from before the redesign (`chiya`, `darkroom`, `clinic`, `newsprint`, `workshop`, `rhododendron`,
  `teagarden`, `ledger`, `marigold`, `gallery`) still load: they move to the nearest new theme
  (`LEGACY_PRESETS` in schema.ts). Colours and fonts the owner never changed follow the new theme.
- `scale`: 0.85 to 1.15, how large headings are against the text.
- Text in the accent colour (step numbers, labels, links) falls back to the text colour when the accent is too
  light to read on the page, so a yellow accent stays legible.

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

Variants: `split` (Text beside a photo), `image` (Full photo, text on top), `stacked` (Big headline over a wide photo), `text` (Large type only), `video` (Video in the background). The first is the default.

Props:
- `title` (Headline): inline text (bold, italic, links), up to 160 characters.
- `text` (Text): inline text, several lines, up to 500 characters.
- `primary` (Main button): button `{ label, href, newTab? }`.
- `secondary` (Second button): button `{ label, href, newTab? }`.
- `image` (Photo): image `{ src, alt, focal? }`.
- `eyebrow` (Detail line): inline text (bold, italic, links), up to 120 characters. A short fact under the buttons, like opening hours or the neighbourhood.
- `video` (Background video): link (https:, mailto:, tel:, page:<id>, #anchor). A direct link to an .mp4 file. The photo shows while it loads and on slow connections.

Defaults: `{"eyebrow":"","title":"Say what you do and where, in one line","text":"Add a sentence or two about who you help and why people come back. Click any text on the page to change it.","primary":{"label":"Get in touch","href":""},"secondary":{"label":"","href":""},"image":{"src":"","alt":""},"video":""}`

#### `footer`: Footer (one per site, in `site.footer`)

Your name, pages, contact details, hours and social links, on every page.

Variants: `rich` (Full: a closing line, columns and hours), `columns` (Columns), `simple` (One quiet line), `big` (Large name). The first is the default.

Props:
- `headline` (Closing line): inline text (bold, italic, links), up to 140 characters. A last sentence in large type, like "Come in for a cup". Full footer only.
- `cta` (Button): button `{ label, href, newTab? }`.
- `about` (About line): inline text, several lines, up to 300 characters.
- `hours` (Hours): inline text, several lines, up to 300 characters. One line per row, like "Sun to Fri, 7:30 to 21:00". Full footer only.
- `note` (Small print): inline text (bold, italic, links), up to 160 characters.
- `showPages` (List the pages): true / false.
- `showContact` (Show phone, email and address): true / false.
- `showSocial` (Show social links): true / false.

Defaults: `{"headline":"","cta":{"label":"","href":""},"about":"","hours":"","note":"","showPages":true,"showContact":true,"showSocial":true}`

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

Several photos as a mosaic, a grid, a masonry wall, a carousel or a square feed.

Variants: `bento` (Mosaic of mixed sizes), `grid` (Even grid), `masonry` (Masonry), `carousel` (Carousel), `feed` (Square feed, like Instagram). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `intro` (Intro): inline text, several lines, up to 400 characters.
- `images` (Photos): list of items. Up to 48 photos, each:
  - `image` (Photo): image `{ src, alt, focal? }`.
  - `caption` (Caption): inline text (bold, italic, links), up to 160 characters.
- `link` (Link): button `{ label, href, newTab? }`.

Defaults: `{"heading":"Gallery","intro":"","images":[{"image":{"src":"","alt":""},"caption":""},{"image":{"src":"","alt":""},"caption":""},{"image":{"src":"","alt":""},"caption":""}],"link":{"label":"","href":""}}`

#### `rows`: Feature rows

Large photos and short stories in rows, left and right in turn.

Variants: `alternate` (Photo left, then right), `large` (Big photos, text beneath). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `intro` (Intro): inline text, several lines, up to 500 characters.
- `items` (Rows): list of items. Up to 12 rows, each:
  - `image` (Photo): image `{ src, alt, focal? }`.
  - `title` (Title): inline text (bold, italic, links), up to 120 characters.
  - `text` (Text): inline text, several lines, up to 700 characters.
  - `link` (Link): button `{ label, href, newTab? }`.

Defaults: `{"heading":"","intro":"","items":[{"image":{"src":"","alt":""},"title":"One thing you do well","text":"Two or three sentences with a real detail: where it comes from, who makes it, how long it takes.","link":{"label":"","href":""}},{"image":{"src":"","alt":""},"title":"Another thing worth a photo","text":"Say what a customer sees, tastes or gets.","link":{"label":"","href":""}}]}`

#### `sticky`: Photo with scrolling story

A photo that stays in view while short chapters scroll past beside it.

Variants: `left` (Photo on the left), `right` (Photo on the right). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `intro` (Intro): inline text, several lines, up to 500 characters.
- `image` (Photo): image `{ src, alt, focal? }`.
- `items` (Chapters): list of items. Up to 10 chapters, each:
  - `label` (Small label): plain text, up to 40 characters. Like a year, a place or a step.
  - `title` (Title): inline text (bold, italic, links), up to 120 characters.
  - `text` (Text): inline text, several lines, up to 700 characters.

Defaults: `{"heading":"How it is made","intro":"","image":{"src":"","alt":""},"items":[{"label":"","title":"Where it starts","text":"A few sentences about the first part of the story."},{"label":"","title":"What happens next","text":"Keep each chapter short enough to read in one breath."}]}`

#### `quote`: Big quote

One sentence in large type: your promise, or words someone really said.

Variants: `large` (Large type), `image` (Beside a photo). The first is the default.

Props:
- `quote` (Quote): inline text, several lines, up to 600 characters.
- `name` (Who said it): inline text (bold, italic, links), up to 80 characters.
- `detail` (Who they are): inline text (bold, italic, links), up to 120 characters.
- `image` (Photo): image `{ src, alt, focal? }`.

Defaults: `{"quote":"One sentence that sums up why you do this work.","name":"","detail":"","image":{"src":"","alt":""}}`

#### `marquee`: Moving words

A slow band of words across the page. It stands still for visitors who turn motion off.

Variants: `large` (Large), `small` (Small band). The first is the default.

Props:
- `items` (Words): list of items. Up to 12 phrases, each:
  - `text` (Words): plain text, up to 80 characters.

Defaults: `{"items":[{"text":"Say it"},{"text":"In a few words"},{"text":"Again and again"}]}`

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

Variants: `columns` (Two columns), `photo` (With photos of the dishes), `list` (One long list), `compact` (Compact board). The first is the default.

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
    - `image` (Photo): image `{ src, alt, focal? }`.

Defaults: `{"heading":"Menu","intro":"","currency":"NPR","sections":[{"title":"Section","note":"","items":[{"name":"Dish name","desc":"What is in it.","price":"","tag":"","image":{"src":"","alt":""}}]}]}`

#### `steps`: Steps

How it works, in numbered steps, when the order matters.

Variants: `columns` (Side by side), `stack` (Down the page, large numbers). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `intro` (Intro): inline text, several lines, up to 500 characters.
- `items` (Steps): list of items. Up to 8 steps, each:
  - `title` (Title): inline text (bold, italic, links), up to 100 characters.
  - `text` (Text): inline text, several lines, up to 500 characters.
  - `detail` (Time or note): plain text, up to 60 characters. Like "Day 1" or "20 minutes".

Defaults: `{"heading":"How it works","intro":"","items":[{"title":"First, you ask","text":"What happens and what the customer needs to do.","detail":""},{"title":"Then we get to work","text":"What you do, and how long it takes.","detail":""},{"title":"You get the result","text":"What they walk away with.","detail":""}]}`

#### `work`: Work and projects

Projects or case studies as large photos with a title and a line each.

Variants: `grid` (Two columns), `feature` (One large, then two), `list` (Rows with a small photo). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `intro` (Intro): inline text, several lines, up to 500 characters.
- `items` (Projects): list of items. Up to 24 projects, each:
  - `image` (Photo): image `{ src, alt, focal? }`.
  - `title` (Title): inline text (bold, italic, links), up to 100 characters.
  - `tag` (Kind of work): plain text, up to 60 characters.
  - `text` (One line): inline text, several lines, up to 300 characters.
  - `link` (Link): button `{ label, href, newTab? }`.
- `link` (Link under the list): button `{ label, href, newTab? }`.

Defaults: `{"heading":"Selected work","intro":"","items":[{"image":{"src":"","alt":""},"title":"Project name","tag":"Identity","text":"What you made and for whom.","link":{"label":"","href":""}},{"image":{"src":"","alt":""},"title":"Another project","tag":"Website","text":"The result in one line.","link":{"label":"","href":""}}],"link":{"label":"","href":""}}`

#### `press`: Press and awards

Where you were written about or what you won, with a short line from each.

Variants: `list` (Rows), `quotes` (Quotes from the press). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `items` (Mentions): list of items. Up to 16 mentions, each:
  - `name` (Publication or award): plain text, up to 80 characters.
  - `detail` (Title or year): inline text (bold, italic, links), up to 140 characters.
  - `quote` (What they wrote): inline text, several lines, up to 300 characters.
  - `url` (Link): link (https:, mailto:, tel:, page:<id>, #anchor).

Defaults: `{"heading":"In the press","items":[{"name":"Publication name","detail":"The headline, and the year","quote":"","url":""}]}`

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

Variants: `band` (Full-width band), `image` (Over a photo), `split` (Text left, buttons right), `boxed` (Boxed). The first is the default.

Props:
- `title` (Heading): inline text (bold, italic, links), up to 140 characters.
- `text` (Text): inline text, several lines, up to 400 characters.
- `primary` (Main button): button `{ label, href, newTab? }`.
- `secondary` (Second button): button `{ label, href, newTab? }`.
- `image` (Background photo): image `{ src, alt, focal? }`.

Defaults: `{"title":"Ready when you are","text":"","primary":{"label":"Get in touch","href":""},"secondary":{"label":"","href":""},"image":{"src":"","alt":""}}`

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

Variants: `location` (Location card over the map), `split` (Address beside the map), `embed` (Map, full width), `card` (Address card only). The first is the default.

Props:
- `heading` (Heading): inline text (bold, italic, links), up to 160 characters.
- `address` (Address): inline text, several lines, up to 300 characters. Empty: the address from Site settings.
- `hours` (Hours): inline text, several lines, up to 300 characters. Optional. One line per row.
- `phone` (Phone): plain text, up to 40 characters. Empty: the phone from Site settings.
- `note` (Getting here): inline text, several lines, up to 400 characters. Landmarks, parking, which gate.
- `query` (Place to show): plain text, up to 200 characters. A place name or address as you would type it into Google Maps.
- `link` (Google Maps link): link (https:, mailto:, tel:, page:<id>, #anchor). The share link from Google Maps, for directions.

Defaults: `{"heading":"Find us","address":"","hours":"","phone":"","note":"","query":"","link":""}`

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
| `roast` | Roast | rozha / figtree | 2 | solid | airy | White, espresso ink and bottle green, with a heavy Devanagari-born didone. Cafés, bakeries, restaurants. |
| `meridian` | Meridian | sourceserif / hanken | 12 | pill | even | Clinical white, deep navy and one clear cobalt. A readable serif for headings. Clinics, labs, schools. |
| `monolith` | Monolith | archivox / archivo | 0 | solid | airy | Near-black, bone text, marigold and wide heavy type. Agencies, studios, music. |
| `salt` | Salt | schibsted / schibsted | 0 | underline | airy | True white and black grotesque, nothing else. Architects, portfolios, galleries. |
| `kora` | Kora | gloock / figtree | 4 | solid | airy | A soft white, slate blue and a contrasty serif. Homestays, boutique hotels, weddings. |
| `summit` | Summit | bigshoulders / archivo | 0 | solid | tight | White, pine-black and prayer-flag yellow, condensed capitals. Gyms, trekking, builders. |
| `nocturne` | Nocturne | bodoni / schibsted | 0 | outline | airy | Green-black, warm bone and brass, with a fashion didone. Photographers, weddings, bars. |
| `counsel` | Counsel | youngserif / hanken | 2 | solid | even | White, graphite and oxblood, a sturdy serif. Consultants, lawyers, NGOs. |
| `bloom` | Bloom | caslon / figtree | 20 | pill | even | White, a blush panel and raspberry, with an elegant Caslon. Salons, boutiques, florists. |

## Fonts (self-hosted, `/_jhino/fonts/s-<id>.woff2`)

- `rozha`: Rozha One (serif, weights 400–400)
- `sourceserif`: Source Serif (serif, weights 200–900)
- `caslon`: Libre Caslon Display (serif, weights 400–400)
- `figtree`: Figtree (sans, weights 300–900)
- `archivox`: Archivo Expanded (sans, weights 100–900)
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

- `cafe-room`: A sunlit café with a pale wood counter, an espresso machine and tables by tall windows
- `cafe-barista`: A barista pouring from a gooseneck kettle into pour-over drippers at a dark counter
- `cafe-pourover`: A glass pour-over brewer and carafe beside copper kettles on a dark bar
- `cafe-latte`: A latte with tulip latte art, seen from above on a dark wooden table
- `cafe-roaster`: Freshly roasted beans pouring from a drum roaster into its cooling tray
- `cafe-beans`: Close-up of glossy roasted coffee beans
- `cafe-cherries`: A branch of ripening red and yellow coffee cherries
- `cafe-momo`: Steam rising from a bamboo steamer of momo, with a bowl of dipping sauce
- `cafe-momo-2`: Plates of steamed, spinach and pan-fried momo with a bowl of soup
- `cafe-chiya`: A steel tray of small glasses of milk tea, from above
- `cafe-thali`: A Thakali set on a brass plate: rice, dal, curries, achar, greens and papad
- `cafe-pastry`: Rows of golden croissants on baking paper
- `cafe-bag`: A plain black coffee pouch with roasted beans in front of it
- `cafe-evening`: A Kathmandu durbar square at night, lit temples and light trails
- `clinic-reception`: A bright, minimal white clinic lobby with a small indoor tree and curved benches
- `clinic-consult`: A doctor writing notes at a desk while a patient sits across from him
- `clinic-doctor-1`: Portrait of a smiling woman doctor in a white coat
- `clinic-doctor-2`: Portrait of a bearded doctor with glasses and a stethoscope
- `clinic-doctor-3`: Portrait of a smiling woman doctor in a white coat over green scrubs
- `clinic-child`: A doctor’s stethoscope on a young child’s chest
- `clinic-lab`: Blood sample tubes with coloured caps in a rack
- `clinic-bp`: A nurse inflating a blood pressure cuff on a patient’s arm
- `clinic-pharmacy`: A pharmacist reaching for medicine on pharmacy shelves
- `clinic-scan`: A pregnant woman holding an ultrasound print
- `clinic-physio`: A physiotherapist working on a patient’s knee
- `clinic-room`: A modern consultation room with a desk, chairs and an examination couch
- `clinic-hands`: An older person’s hand held by a younger hand
- `clinic-stetho`: A stethoscope on a plain light blue background
- `agency-studio`: A designer at a desk in a warm, plant-filled studio with prints pinned up
- `agency-desk`: A hand sketching app screens on paper
- `agency-posters`: A wall of black and white typographic posters
- `agency-packaging`: A plain box and a frosted jar with a blank label on pale stone
- `agency-tea`: Two green tea tubes on a pale mint background
- `agency-stationery`: A stationery suite of cards and envelopes laid flat
- `agency-patan`: The courtyard of the Patan palace with carved Newari facades
- `agency-hotel`: A calm hotel bedroom with a mustard throw and pendant lamps
- `agency-textile`: Brightly coloured warp threads on a loom
- `agency-shoot`: A photographer shooting in a studio surrounded by lights
- `agency-phone`: Hands holding a phone with a dark app on screen
- `agency-team-1`: Portrait of a young woman in a red top in natural light
- `agency-team-2`: Portrait of a smiling man with long dark hair
- `agency-team-3`: Portrait of a laughing woman in a mustard and navy outfit
- `agency-meeting`: Two women reviewing colour swatches in front of a moodboard wall
- `salon-chairs`: A bright hair salon with styling chairs and a long mirror
- `salon-mirrors`: Salon chairs facing round mirrors on a dark wall
- `salon-facial`: A therapist giving a facial to a woman lying back
- `gym-barbell`: A loaded barbell beside a squat rack
- `gym-kettlebells`: A wall of black kettlebells in a dark gym
- `gym-lift`: A lifter gripping a barbell overhead
- `gym-dumbbells`: Rows of black dumbbells on a rack
- `school-class`: Students at desks listening to a teacher
- `school-lecture`: A teacher speaking to students while a student raises a hand
- `school-board`: A hand writing an equation on a chalkboard
- `shop-fabric-shelf`: Shelves of folded cloth rolls in a small shop
- `shop-fabric-rolls`: Stacked folded fabric in blue, teal, cream and magenta
- `shop-rack`: A rail of ready-made clothes in a shop
- `home-modern`: A modern house with tall glass doors and a garden
- `home-garden`: A two-storey house with a timber and stone facade and a lawn
- `home-living`: A bright living room with a sofa and large windows
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
- `boudha`: Boudhanath stupa from above, surrounded by the city
- `swayambhu`: Swayambhu stupa with prayer flags
- `himal-trek`: A trekker looking at snow peaks
- `night-peaks`: Snow peaks under a starry sky
- `shoot-cheers`: Two coffee cups raised together
