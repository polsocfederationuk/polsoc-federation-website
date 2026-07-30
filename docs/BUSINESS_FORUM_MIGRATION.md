# Polish Business Forum migration (Cleanup Phase 12)

The Business Forum is now **structured content**: one YAML record and one
dedicated bilingual template. It is the last un-migrated event.

**The live site has not changed.** Netlify still publishes the repository root.
`scripts/compare-business-forum.js` passes 182/182, with 20 documented negative
controls proving the comparison can actually fail.

Related: [STANDARD_EVENTS_MIGRATION.md](STANDARD_EVENTS_MIGRATION.md),
[EVENT_RECONCILIATION.md](EVENT_RECONCILIATION.md),
[BUILD_ARCHITECTURE.md](BUILD_ARCHITECTURE.md).

---

## 1. Shared event core

The Forum uses the **same field names** as the four standard events, so one code
path can later build listing cards, the homepage timeline, archives, the sitemap
and JSON-LD for all five events:

```yaml
slug: business-forum
event_family: polish-business-forum
template: business-forum
academic_year: "2025/26"
published: true
order: 1
flagship: true
show_in_listing: true
show_on_homepage: true
show_in_archive: true

start_date: "2026-04-24"
end_date: "2026-04-25"
date_precision: day

venue: { name, neighbourhood, locality, country }
registration: { state, type, url, email }

hero_image: null
card_image: "/assets/pbf/stage.jpg"
og_image: "/assets/pbf/stage.jpg"

organiser: { en, pl }
co_organisers: []
performers: [{ name, type }]
```

Two deliberate differences from a standard record:

- **`organiser` is localised.** The live Polish Forum page names the
  organisation in Polish in its JSON-LD and links `/pl/`; the standard events
  name it in English on both locales and link `/`. Both live behaviours are
  reproduced, and the record shape decides which — a localised `organiser` means
  the localised organisation URL. See §16.
- **`hero_image` is null.** That field is the *standard-event* field for a hero
  `<img>` element, and this family renders none — its backdrop is a CSS layer
  beneath the navy overlay. The backdrop **photograph** is edition-specific and
  lives at `business_forum.branding.hero_backdrop`; see §11a.

There is **no `sections:` key**. See §6.

## 2. Business Forum extension

Everything the Forum has and no other event may have sits under one key:

```yaml
business_forum:
  edition:                 { number, ordinal: {en, pl} }
  branding:                { logo, logo_alt, tagline, hero_backdrop,
                             watermark_hero, watermark_story, watermark_people }
  attendance:              { count, suffix, noun: {en, pl} }
  facts:                   { date_label, venue_label, attendance_label,
                             edition_label }   # labels only — values are derived
  statistics:              { background, eyebrow, items[] }
  galleries:               [{ images: [{ src, wide, alt }] }]
  people:                  [{ name, photo, role: {en, pl} }]
  people_photo_row:        [{ src, alt, caption }]
  partner_groups:          [{ key, order, heading, aria_label,
                              prev_label, next_label, logos[] }]
  funding_acknowledgement: { logo, logo_alt, text }
  forum_ball:              { enabled, image, image_alt, caption, eyebrow,
                             title, body }
  photographers:           [{ name, gallery_url, pin, tag, description,
                              link_label }]
  calls_to_action:         { team: { url, text, label } }
```

`scripts/validate.js` §27 fails the build if this block appears on any record
outside the family, and if a Forum record lacks it.

## 3. Why the Forum is a separate event family

Its detail page shares almost nothing with a standard event page. It has a
branded navy hero with a logo lock-up instead of a typographic title, a
screen-reader-only `<h1>`, three watermarks, an animated statistics band, a
founders grid, two auto-scrolling partner carousels, a funding acknowledgement,
a Ball feature and photographer cards. It loads a second stylesheet that
overrides the first.

Forcing that through the standard template would mean either a template full of
`{% if event_family == %}` branches, or a record able to switch between two
incompatible designs. Instead the family **selects the template**, and the
selection is enforced in three places: `src/_data/businessForumPages.js` throws
if the family and template disagree, `standardEventPages.js` filters the Forum
out, and validate.js §27/§28 assert the pairing and that no standard event picked
up `pbf-page` or `pbf.css`.

## 4. Why it stays in the common event collection

Because for every purpose *except* its detail page, it is an ordinary event. It
belongs in the listing, the homepage timeline, the academic-year archive, the
sitemap, and it needs the same canonical/hreflang/JSON-LD treatment.

So it lives in `content/events/` alongside the standard records and reuses the
same core field names and the same filters — `eventDisplayDate`, `venueDisplay`,
`eventJsonLd` and the record-derived image passthrough all serve both families
unchanged. A separate `content/business-forum/` directory would have forced the
listing phase to merge two shapes.

## 5. Final schema

The complete record is [`content/events/business-forum.yaml`](../content/events/business-forum.yaml)
(409 lines, generated from the live pages). §1 and §2 above give its shape; the
worked fictional example is in §18.

## 6. Required and optional sections

**The section order is fixed by the template, not the record.** Standard events
carry a `sections:` list because their pages genuinely differ in shape. The Forum
is a branded set piece:

| # | Section | Required? |
| --- | --- | --- |
| 1 | Branded hero + facts bar | required |
| 2 | Story (gallery → prose → gallery) | required |
| 3 | Statistics band | required |
| 4 | **Forum Ball** | **optional** (`enabled`) |
| 5 | Founders and project leaders | required |
| 6 | Partners + funding acknowledgement | required |
| 7 | Photographers and galleries | required |

Only the Ball is conditional. validate.js asserts that the section's presence in
the output matches `forum_ball.enabled` in the record — in **both** directions,
so a disabled Ball that still rendered an empty shell would fail.

## 7. Marketing-editable fields

Everything a marketing officer legitimately owns:

- edition number and ordinal
- dates, venue, attendance count and noun
- all four facts-bar **labels**
- statistics values, suffixes and labels
- the story write-up (Markdown)
- gallery images and their English/Polish alt text
- people: names, photographs, roles
- partners: names, logos, URLs, alt text, group headings and arrow labels
- funding wording and logo
- Forum Ball copy, image, caption, headings — and whether it appears at all
- photographers: names, credits, gallery links, PINs, descriptions
- the team call-to-action text and label
- listing/timeline copy and card alt text
- SEO titles, descriptions and schema descriptions
- **the hero backdrop photograph** (`branding.hero_backdrop`) — see §11a

## 8. IT-controlled structure

Everything a marketing officer must **not** be able to change:

- the template itself, and the family→template pairing
- section order and which sections exist
- the `pbf-page` body class and the `pbf.css` cascade position
- hero geometry, the logo lock-up requirement and the screen-reader-only `<h1>`
- the hero's overlay gradient, `center 30%` framing and `cover` scaling — the
  backdrop *image* is editable, its *treatment* is not (§11a)
- watermark positioning (`right: -20px` inside `overflow: hidden`)
- **carousel repetition** — `businessForumTechnical.carouselSets`, see §11
- gallery strip spacing, which is set in the template so no CSS reaches the CMS
- the Ball's first-paragraph spacing (a `styleFirstParagraph` filter, not a
  record field)
- the camera glyph on photographer cards
- responsive rules, reveal classes, counter mechanics
- `css/pbf.css` itself

The record contains **no raw HTML anywhere**, and validate.js §27 fails if any
field grows a tag, an inline event handler, or a non-http(s)/mailto URL.

## 9. Edition-number handling

```yaml
edition:
  number: 1
  ordinal: { en: "Inaugural", pl: "Pierwsza" }
```

`number` is the machine value (sorting, "Nth edition" logic later). `ordinal` is
how it is *written*, and it is localised because "Inaugural" and "Pierwsza" are
not mechanical translations of a numeral. The facts bar shows `ordinal`; nothing
stores the word "Inaugural" twice.

## 10. Partner and sponsor modelling

```yaml
partner_groups:
  - key: sponsors
    order: 1
    heading:    { en: "Sponsors", pl: "Sponsorzy" }
    aria_label: { en: "Sponsor logos", pl: "Logotypy sponsorów" }
    prev_label: { en: "Scroll sponsors backwards", pl: "Przewiń sponsorów wstecz" }
    next_label: { en: "Scroll sponsors forwards",  pl: "Przewiń sponsorów dalej" }
    logos:
      - name: "London Business School"
        image: "/assets/pbf/sponsors/lbs.jpg"
        url: null
        image_alt: { en: "London Business School", pl: "London Business School" }
```

Two groups this edition: `sponsors` (9 logos) and `media-patrons` (11). The group
**key** and the logo list are shared; headings, accessible names and arrow labels
are localised. `url: null` throughout, because the live logos are not linked —
the field exists so a future edition can link them without a schema change.

validate.js rejects duplicate keys, duplicate logos within a group, a logo whose
alt text is not localised, and a missing `order` — and rejects any carousel
mechanics appearing here at all (§11).

## 11. Carousel duplication strategy

**Each logo is stored exactly once. The template repeats the rendered set.**

`js/main.js` auto-scrolls each strip and wraps its position with:

```js
const half = () => car.scrollWidth / 2;
```

That divisor **hard-codes two identical tile sets**. With one set the loop never
wraps; with three it wraps mid-set and the strip visibly jumps.

### Why the repetition is not content

It answers a question no editor should ever be asked. "How many times should the
sponsor strip be duplicated in the DOM?" has exactly one correct answer, it is
determined by a divisor in a JavaScript file, and getting it wrong breaks the
animation **silently** — the page still renders, the strip just stutters. That is
the definition of machinery, not editorial choice. It is also not localisable, not
edition-specific, and meaningless without the code it pairs with.

### Where the count lives

**`src/_data/businessForumTechnical.js`** — an IT-owned build-time constant:

```js
module.exports = { carouselSets: 2 };
```

`partners.njk` reads `businessForumTechnical.carouselSets`. The content record
contains **no** carousel field at any depth.

It is deliberately *not*: in `content/`, in a localised block, or anywhere a
content collection maps to — so no CMS form can surface it. The file documents the
`scrollWidth / 2` coupling at length, because the constant and that divisor are two
halves of one contract and must change together.

### Why it must not appear in the CMS

Exposing it would let a marketing officer break the carousel while doing something
that looks entirely reasonable (adding a partner, tidying a field). Worse, the
failure is visual and intermittent rather than an error, so it would likely ship.

Storing the duplicate *set* in YAML would be worse still: a partner added in one
place and not the other silently desynchronises the two sequences. validate.js §27
therefore **fails if the same logo image or name appears twice in a group**, fails
if any key matching `/carousel|repetition|duplicate_sets/` exists anywhere in the
record, and requires the technical file to exist with `carouselSets === 2`. §28
checks the rendered tile count equals `canonical logos × the technical count` for
every group on both pages — pinned to the IT constant, so removing the field from
YAML did not weaken the check.

The repeated set is `aria-hidden="true"` with `alt=""`, so a screen reader
announces each partner once. That is asserted too — and because empty alt is the
*correct* marking for a decorative image, the validator checks that the number of
empty-alt images equals exactly `duplicated tiles + 1` (the footer brand mark),
rather than banning empty alt outright.

Verified in the browser: `scrollWidth` 4092 with 18 tiles, so the wrap point
(2046) lands exactly on the 9-tile boundary. Auto-scroll and both arrows move the
strip.

## 11a. Hero backdrop — edition-specific, not permanent branding

### The classification, and the evidence for it

**Edition-specific event photography.** The backdrop was `stage.jpg`, hard-coded
in `css/pbf.css`. The evidence that it is not brand furniture:

- Its alt text, everywhere it appears, is *"The Polish Business Forum team on the
  main stage at London Business School"* — a photograph of **the 2026 team** at
  **one venue**. A 2027 edition has a different team, probably a different stage.
- The same file is simultaneously the `og_image`, the future `card_image`, the
  first story-gallery tile, the events-listing card image, and the 2026
  announcement's image. Brand assets do not double as an event's press photo.
- The Forum's actual permanent brand assets sit beside it and are obvious by
  contrast: `pbf-logo-full.png`, `pbf-logo-icon.jpg`, `pbf-logo-nav*.png` — small
  wordmark files. `stage.jpg` is a 378 KB photograph.

So it is **marketing-editable**, and it was in the one place a marketing officer
must never go.

### The implementation

The record carries the image; the stylesheet keeps the treatment:

```yaml
business_forum:
  branding:
    hero_backdrop: "/assets/pbf/stage.jpg"
```

The template passes it as a custom property, and nothing else changes:

```html
<section class="pbf-hero" style="--pbf-hero-backdrop: url('/assets/pbf/stage.jpg')">
```

`css/pbf.css` changed by **one line**, plus a comment:

```css
    var(--pbf-hero-backdrop, url("../assets/pbf/stage.jpg")) center 30% / cover no-repeat;
```

The **fallback is the point**: the hand-written live pages set no custom property,
so they keep rendering exactly the image they always did. That is the only public
CSS change in this phase, and validate.js enforces its scope — it fails if the
diff removes anything but the old backdrop line, adds any declaration other than
the `var()` line, or adds or removes a selector.

Everything else about the hero is untouched and deliberately **not** configurable:
the navy overlay gradient, `center 30%` framing, `cover no-repeat` scaling,
`padding: 150px 0 80px`, `overflow: hidden` clipping, the watermark's `right:
-20px` bleed, the dot-matrix `::before` and the spinning `::after` ring. The
validator asserts the gradient, the framing string and the overflow clipping are
still present, so "make the image editable" cannot quietly become "make the design
editable".

The URL is root-relative, so it resolves identically from `/` and `/pl/`.

### How a future edition changes it

Set one field:

```yaml
business_forum:
  branding:
    hero_backdrop: "/assets/pbf-2027/hero.jpg"
```

No CSS edit, no template edit. The passthrough list is derived from the record, so
the new file is copied automatically; the validator fails if it does not exist.

### Verified unchanged

Measured on the live pages (`:8012`) and the generated pages (`:8011`) at 320,
390, 768 and 1280 px. The computed values are identical on both:

| | Live | Generated |
| --- | --- | --- |
| resolved backdrop | `/assets/pbf/stage.jpg` | `/assets/pbf/stage.jpg` |
| image loads | yes | yes |
| `background-position` | `0% 0%, 50% 30%` | `0% 0%, 50% 30%` |
| `background-size` | `auto, cover` | `auto, cover` |
| `background-repeat` | `repeat, no-repeat` | `repeat, no-repeat` |
| overlay gradient | present | present |
| hero `overflow` | `hidden` | `hidden` |
| hero `padding-top` | `150px` | `150px` |
| document overflow | 0 | 0 |

Hero heights agree within 1 px at some widths — ordinary text reflow, and smaller
than the 47 px the live English and Polish heroes already differ by at 320 px.

### `hero_image` versus `hero_backdrop`

They are different things and both are correct:

- `hero_image` (shared core) — a hero **`<img>` element**, which standard events
  use and the Forum does not. Stays `null`; the validator asserts it.
- `branding.hero_backdrop` (extension) — the **CSS backdrop layer** behind the
  navy overlay, which only this family has.

The CMS should show the backdrop as a Business Forum branding image field, and
must **not** show `hero_image` for this family at all — it would be an input that
does nothing.

## 12. People and photographer modelling

```yaml
people:
  - name: "Szymon Kwidziński"
    photo: "/assets/team/szymon-kwidzinski.jpg"
    role: { en: "Project Leader & Founder", pl: "Lider projektu i współzałożyciel" }
```

Names are shared and **never translated**. Roles are localised. The live photo
alt *is* the person's name, so the template derives it rather than storing it
twice. Order is the live order and is compared position by position. There are
**no biography fields**, because the live page has none — inventing them would
create empty CMS inputs inviting content the design cannot show.

```yaml
photographers:
  - name: "YoniVisuals"
    gallery_url: "https://yonivisuals49.pixieset.com/polishbusinessforum/"
    pin: "8409"
    tag:         { en: "Photographer · Conference", pl: "Fotograf · Konferencja" }
    description: { en: "…the gallery PIN is", pl: "…PIN do galerii to" }
    link_label:  { en: "Open the gallery", pl: "Otwórz galerię" }
```

The **PIN is its own field**, not embedded in the description: the live page wraps
it in `<span class="pbf-pin">`, and that markup belongs to the template. A
photographer without a PIN omits the field and no span is emitted. Only the live
fields exist — no `credit_url`, `social_url` or per-photographer image list,
because the live cards have none.

## 13. Funding acknowledgement

```yaml
funding_acknowledgement:
  logo: "/assets/pbf/senat-polonia-2026.png"
  logo_alt: { en: "Senat–Polonia 2026", pl: "Senat–Polonia 2026" }
  text:     { en: "Project co-financed as part of…", pl: "Projekt współfinansowany…" }
```

Deliberately **only** in this extension. The wording is a condition of the
Senate of the Republic of Poland's co-financing of this edition. Generalising it
into every event would invite an empty acknowledgement on events with no funder;
if another event ever has the same obligation, that is the moment to promote it
to the shared core.

## 14. Forum Ball optionality

```yaml
forum_ball:
  enabled: true
  image: …
  image_alt: { en, pl }
  caption:   { en, pl }
  eyebrow:   { en, pl }
  title:     { en: { lead, fancy }, pl: { lead, fancy } }
  body:      { en: |…, pl: |… }
```

`enabled: false` renders **nothing** — no heading, no empty container, no
placeholder image — and the rest of the page is untouched because no other
section reads these fields. `enabled` must be an explicit boolean; validate.js
rejects a missing or non-boolean value so an edition can never hide the Ball by
accident of omission.

The Ball is **not** required for future editions.

## 15. Image and alt-text rules

- Every path is **root-relative** (`/assets/…`). A page-relative path would
  resolve to `/pl/assets/…` from the Polish page and 404. Both the comparison and
  validate.js assert no such path exists.
- Image paths, order and the `wide` flag are **shared**; only alt text is
  localised, matched positionally.
- Nothing was renamed, moved, optimised, replaced or deleted. 35 images are
  referenced; the passthrough list is derived from the record, so adding a
  partner logo needs no second list updated.
- **Decorative vs informative** is explicit: duplicated carousel tiles and the
  footer brand mark carry `alt=""`; everything else has a description. The hero
  backdrop and the statistics backdrop are CSS/`aria-hidden` elements, not
  `<img>`, exactly as on the live page.
- `css/pbf.css` is copied too, and its own `url()` references are checked to
  resolve inside `dist/` — the first build of this phase linked a stylesheet no
  passthrough rule copied, so that is now asserted.
- The **hero backdrop** is not an `<img>`: it is a CSS layer supplied as
  `--pbf-hero-backdrop` (§11a). It is still derived from the record, so the
  passthrough copies it and the validator fails if the file is missing.

## 16. JSON-LD generation

One builder (`eventJsonLd` in `eleventy.config.js`) serves both families:

| Field | Source |
| --- | --- |
| `name` | `<locale>.title` (standard events compose theirs from title parts) |
| `description` | `<locale>.schema_description` |
| `startDate` / `endDate` | `start_date` / `end_date` |
| `eventStatus` | always `EventScheduled` |
| `eventAttendanceMode` | always `OfflineEventAttendanceMode` |
| `location` | `venue.name` + `locality` + `country` |
| `organizer` | localised `organiser`, with the locale's home URL |
| `performer` | `performers[]` |
| `url` | the page's own canonical |
| `image` | `og_image` |
| `inLanguage` | `pl-PL` on the Polish page only |

Verified: both blocks parse, `startDate` (2026-04-24) ≤ `endDate` (2026-04-25),
and the JSON-LD venue is asserted to be **the same string the facts bar shows** —
the drift class the Phase 10 audit found. No value is stored twice.

## 17. Registration limitations

```yaml
registration: { state: none, type: null, url: null, email: null }
```

The 2026 edition has been held, so the state is `none`. States are limited to
`none | open | closed | sold-out`, types to `null | external-link |
payment-link | email`, and any Forum registration or payment link remains an
**external destination**.

Out of scope and IT-led when wanted: attendee databases, payment webhooks,
ticket inventory, waiting lists, confirmation emails, native registration forms.
Nothing in the template renders registration yet, because the live page has no
such UI to reproduce.

## 18. Adding a future Forum edition

A new edition is a **new file**, never an edit of this one:

1. Put the artwork in `assets/pbf-2027/`.
2. Create `content/events/business-forum-2027.yaml`.
3. Bump `academic_year`, `order`, and `edition.number` / `edition.ordinal`.
4. Update the validator's expected Forum count (it pins exactly one published
   edition, deliberately, so a second is a conscious decision).
5. `npm run build && npm run validate && npm run compare:business-forum`.

The previous edition keeps its record, its URL and its photographs.

### Fictional future edition (illustrative only)

```yaml
slug: business-forum-2027
event_family: polish-business-forum
template: business-forum
academic_year: "2026/27"
published: true
order: 1
flagship: true
show_in_listing: true
show_on_homepage: true
show_in_archive: true

start_date: "2027-04-23"
end_date: "2027-04-24"
date_precision: day

venue:
  name:     { en: "Example Business School", pl: "Example Business School" }
  locality: { en: "London", pl: "Londyn" }
  country: "GB"

registration:
  state: open
  type: external-link
  url: "https://example.com/pbf-2027-tickets"
  email: null

hero_image: null
card_image: "/assets/pbf-2027/card.jpg"
og_image: "/assets/pbf-2027/og.jpg"

organiser:
  en: "Federation of Polish Student Societies UK"
  pl: "Federacja Polskich Stowarzyszeń Studenckich w Wielkiej Brytanii"
co_organisers: []
performers:
  - name: "Example Speaker"
    type: Person

business_forum:
  edition:
    number: 2
    ordinal: { en: "Second", pl: "Druga" }
  branding:
    logo: "/assets/pbf-2027/logo-full.png"
    logo_alt: "Polish Business Forum"
    tagline: "An example theme for the second edition"
    hero_backdrop: "/assets/pbf-2027/hero.jpg"   # edition-specific; no CSS edit
    watermark_hero: "PBF"
    watermark_story: "2027"
    watermark_people: { en: "FOUNDERS", pl: "ZAŁOŻYCIELE" }
  attendance:
    count: 350
    suffix: "+"
    noun: { en: "guests", pl: "gości" }
  facts:
    date_label:       { en: "Date", pl: "Data" }
    venue_label:      { en: "Venue", pl: "Miejsce" }
    attendance_label: { en: "Attendance", pl: "Frekwencja" }
    edition_label:    { en: "Edition", pl: "Edycja" }
  statistics:
    background: "/assets/pbf-2027/stats-bg.jpg"
    eyebrow: { en: "The Forum in numbers", pl: "Forum w liczbach" }
    items:
      - count: 350
        suffix: "+"
        plain: false
        label: { en: "Attendees", pl: "Uczestników" }
      # A year-like number MUST set plain: true or it renders as "2,027".
      - count: 2027
        suffix: null
        plain: true
        label: { en: "Edition year", pl: "Rok edycji" }
  galleries:
    - images:
        - src: "/assets/pbf-2027/stage.jpg"
          wide: true
          alt: { en: "The main stage", pl: "Scena główna" }
  people:
    - name: "Example Person"
      photo: "/assets/pbf-2027/people/example.jpg"
      role: { en: "Project Lead", pl: "Kierowniczka projektu" }
  people_photo_row:
    - src: "/assets/pbf-2027/team.jpg"
      alt: { en: "The 2027 team", pl: "Zespół 2027" }
      caption: { en: "The Forum team", pl: "Zespół Forum" }
  partner_groups:
    - key: sponsors
      order: 1
      # No carousel_sets here — the repetition count is IT machinery and lives
      # in src/_data/businessForumTechnical.js.
      heading:    { en: "Sponsors", pl: "Sponsorzy" }
      aria_label: { en: "Sponsor logos", pl: "Logotypy sponsorów" }
      prev_label: { en: "Scroll sponsors backwards", pl: "Przewiń sponsorów wstecz" }
      next_label: { en: "Scroll sponsors forwards", pl: "Przewiń sponsorów dalej" }
      logos:
        - name: "Example Bank"
          image: "/assets/pbf-2027/partners/example-bank.png"
          url: "https://example.com/"
          image_alt: { en: "Example Bank", pl: "Example Bank" }
  funding_acknowledgement:
    logo: "/assets/pbf-2027/funder.png"
    logo_alt: { en: "Example Foundation", pl: "Fundacja Przykładowa" }
    text:
      en: "Co-financed by the Example Foundation."
      pl: "Współfinansowane przez Fundację Przykładową."

  # This edition holds no Ball — the section disappears entirely.
  forum_ball:
    enabled: false

  photographers:
    - name: "Example Photographer"
      gallery_url: "https://example.com/gallery"
      pin: null
      tag:         { en: "Photographer · Conference", pl: "Fotograf · Konferencja" }
      description: { en: "The official gallery.", pl: "Oficjalna galeria." }
      link_label:  { en: "Open the gallery", pl: "Otwórz galerię" }
  calls_to_action:
    team:
      url: "team.html"
      text: { en: "And behind them stood the committee.", pl: "A za nimi stał zarząd." }
      label: { en: "Meet the full team", pl: "Poznaj cały zespół" }

en:
  title: "Polish Business Forum 2027"
  hero_eyebrow: "A flagship conference by the Federation…"
  back_link: "← All events"
  back_link_bottom: "← Back to all events"
  story_body: |
    The second Polish Business Forum.
  people_eyebrow: "The people behind the Forum"
  people_title: { lead: "Founders & project ", fancy: "leaders" }
  people_lead: "An example lead paragraph."
  partners_eyebrow: "Partners"
  partners_title: { lead: "Made possible by our ", fancy: "partners" }
  partners_lead: "An example lead paragraph."
  photographers_eyebrow: "Galleries & downloads"
  photographers_title: { lead: "Take the memories ", fancy: "home" }
  photographers_lead: "An example lead paragraph."
  card_title: "Polish Business Forum 2027"
  card_summary: "An example listing summary."
  card_image_alt: "An example description of the listing photograph."
  flagship_tag: "★ Flagship event"
  timeline_title: "Polish Business Forum 2027"
  timeline_summary: "An example timeline summary."
  seo_title: "Polish Business Forum 2027 | Federation of Polish Student Societies UK"
  seo_description: "An example description."
  schema_description: "An example structured-data description."
  og_image_alt: "An example social-card description."

pl:
  # …the same keys, in Polish.
```

## 19. How the future CMS should present the specialised form

The Forum needs its **own** Decap collection, not a variant of the event form:

- **Family and template are hidden, hard-coded fields.** They must not be
  selectable, or an editor can create a combination the templates reject.
- **No section list.** Sections appear as fixed fieldsets in template order.
  There is no "add section" control.
- **The Ball is a single toggle** that shows or hides its fieldset. Turning it off
  must not delete the copy — `enabled: false` keeps it for next year.
- **The carousel repetition count is not a field at all.** It lives in
  `src/_data/businessForumTechnical.js`, outside every content collection, so no
  CMS form can reach it. Exposing it would let an editor break the auto-scroll
  loop silently while doing something that looks reasonable.
- **The hero backdrop IS a field** — a Business Forum branding image input. Its
  treatment (overlay, framing, scaling) is not exposed.
- **Do not show `hero_image` for this family.** It is the standard-event field for
  a hero `<img>`, which the Forum does not render; it would be an input that does
  nothing.
- **Partner groups are a list of logo objects** with image, name, URL and both
  alt strings. One entry per partner. The form must never suggest duplicating a
  logo for the carousel.
- **Statistics items are a variant list**: "counter" (count + suffix + plain) or
  "text value". `plain` needs a hint: *tick this for year-like numbers so 2027
  does not render as 2,027.*
- **Attendance is one number plus a localised noun**, and the form should say it
  feeds both the facts bar and the statistics band.
- **No raw-HTML or CSS field anywhere.** Prose fields are Markdown with raw HTML
  disabled; the only styling an editor controls is emphasis and links.
- **Both locales required** on every localised field; the build fails on a
  missing one, so the form should block saving instead.

## 20. What remains before events-listing generation

The Forum record now carries everything the listing and timeline need:
`card_image`, `card_image_alt`, `card_summary`, `card_title`, `flagship_tag`,
`timeline_title`, `timeline_summary`, `order`, `flagship` and the three
visibility flags — in both locales, and validated.

Remaining gaps:

- **The four standard records have `card_summary` and `timeline_summary` but no
  `card_image` / `card_image_alt`,** and no `card_title` / `timeline_title` /
  `flagship_tag`. Those must be transcribed from the live listing and homepage
  before either page can be generated.
- **Ordering across families** is unsettled: the Forum is `order: 1` and the
  standard events 2–5, which works for one academic year but not for an archive
  spanning several. The archive needs a rule combining `academic_year` and
  `order`.
- The listing's own chrome (the `2025/26` watermark, the flagship card variant
  `event-card-pbf`) is not modelled yet.

## 21. Approved and intentional differences from the live page

**Approved correction (Phase 10 decision 1).** The live Polish page repeats the
**English** `og:image:alt` and `twitter:image:alt`. Both are now Polish, reusing
the wording the live Polish listing card and story gallery already use for the
same photograph — no new copy was authored. Asserted in both directions.

### A correction to the Phase 10 audit

**Decision 11's premise was wrong.** The audit reported the Business Forum
listing image as `assets/events/my-event.jpg` with `alt=""`, and decision 11
asked for meaningful localised alt text to be supplied. In fact the audit's
parser had picked up a **commented-out "how to add an event" example** in
`events.html`. The real card uses `assets/pbf/stage.jpg` and **already has
meaningful, correctly localised alt text in both languages**. Those exact strings
are now in the record; nothing was invented, and decision 11 is satisfied without
authoring anything. The reconciliation document has been corrected.

### Approved bilingual corrections: three untranslated Polish fragments

The extractor compares every Polish string against its English counterpart and
reports matches. Four came back: decision 1 above, and three fragments the Phase
10 audit had not caught. All three are now **translated** in the canonical record.
The English fields are untouched, no links changed, no raw HTML was introduced,
and no partner, sponsor or personal name was translated.

**1. The Forum Ball body** — two paragraphs that were entirely English on the live
Polish page.

English source (unchanged):

> The inaugural Polish Business Forum Ball brought delegates, speakers and
> partners together for a grand black-tie evening at The Landmark London — one of
> the capital's most storied five-star hotels.
>
> The night opened in true Polish tradition with the polonez, before dinner,
> speeches and dancing carried the Forum's conversations long past midnight. It
> was the moment the conference became a community.

Polish translation:

> Pierwszy Bal Polish Business Forum zgromadził delegatów, prelegentów i partnerów
> podczas uroczystego wieczoru w formule black tie w The Landmark London, jednym z
> najbardziej znanych pięciogwiazdkowych hoteli w Londynie.
>
> Wieczór rozpoczął się zgodnie z polską tradycją polonezem. Następnie kolacja,
> przemówienia i tańce sprawiły, że rozmowy rozpoczęte podczas Forum trwały długo
> po północy. To był moment, w którym konferencja przerodziła się w prawdziwą
> społeczność.

This wording was **supplied and approved by the Federation**, replacing the
translator's first draft.

Choices worth noting: **"black tie" is kept**, because the live Polish page's own
statistics label already reads "Black tie w The Landmark London" — translating it
here would have made one page say two things; the Polish renders it as *"w formule
black tie"* so the borrowing reads naturally. *Polish Business Forum*, *The
Landmark London* and *polonez* are proper nouns and stay. "one of the capital's
most storied" became "jednym z najbardziej znanych … hoteli w Londynie" — *storied*
has no compact Polish equivalent, and naming Londyn outright is clearer than a
periphrasis for "the capital". The second paragraph is split into three sentences
rather than carrying the English em-dash construction, which reads stilted in
Polish.

**2. Nikodem Rajpold's role** — `Project Leader & Founder` → **`Lider projektu i
współzałożyciel`**.

The brief suggested `Lider projektu i założyciel`, *unless context establishes that
co-founder is more accurate*. It does, decisively: the live Polish page already
renders the **character-for-character identical** English role
("Project Leader & Founder") as "Lider projektu i współzałożyciel" for Szymon
Kwidziński, and renders "Founder" as "Współzałożyciel" for Marek Świątek and
"…i współzałożyciel" for Michał Kobus. The Forum has five founders, so *co-founder*
is factually right, and using "założyciel" for Nikodem would have made two
identical English roles read differently on the same page. The comparison asserts
both people now share one Polish wording.

**3. Stas Romanowski's gallery button** — `Open the gallery` → **`Otwórz galerię`**,
matching the other photographer card on the same page.

Deliberately kept English (protected names, per the audit): the theme "Polish
Golden Age: From Emerging to Leading", "Polish Business Forum", "London Business
School", "The Landmark London", and all personal names.

### Structural differences shared with the earlier phases

- Asset and stylesheet paths are **root-relative** (`/css/pbf.css`) where the
  live pages use page-relative ones. This is what makes one template serve both
  locales; established in the shared-chrome phase.
- The fonts URL is HTML-escaped (`&amp;`) where the live page writes `&`. Same
  URL.

### A Phase 11 regression found and fixed

Comparing the head metadata turned up two things the Phase 11 comparison never
checked, and which had therefore drifted on all eight standard-event pages:

- **`og:type` was `website`** on the generated pages against `article` live.
- The **Icebreaker lost four `og:image:*` fields** (`secure_url`, `type`,
  `width`, `height`) that the live pages carry because its OG image is the shared
  1200×630 Federation banner.

Both are fixed in `src/event.11tydata.js`, derived from `site.json`'s declared
banner dimensions, and both are now asserted by
`compare-standard-events.js` — which is why that suite went from 554 to 570
comparisons.

## 22. Remaining risks

- **The three Polish fragments are now translated** (§21), so the generated
  Polish page no longer matches the live one word-for-word. That is intentional
  and asserted as an approved correction in both directions — but it does mean
  the live Polish page still carries the English text until this is published.
- **`carouselSets` is validated as exactly 2**, which couples
  `src/_data/businessForumTechnical.js` to `js/main.js`'s `scrollWidth / 2`. If
  that JavaScript is ever rewritten to measure a single set, the constant and the
  validator must change together. The coupling is documented in both files and
  asserted by the template, the validator and the comparison, so it cannot drift
  silently — but it is coupling, now held in one IT-owned place instead of in
  editorial content.
- **`css/pbf.css` now has one public change** — the `--pbf-hero-backdrop` fallback.
  It is the only public file this phase touches, its scope is asserted by the
  validator, and the live pages were measured before and after to confirm their
  hero renders identically. If the fallback is ever removed while un-migrated
  pages still exist, those pages lose their hero image; the validator fails on
  exactly that.
- **Reveal and counter animations were not observed.** They depend on
  `IntersectionObserver`, which requires the page to be actually compositing; the
  Browser pane was not displayed, so nothing scrolled into view and no observer
  fired. What *is* verified: the counter markup (`data-count`, `data-suffix`,
  `data-plain` support) is byte-identical to the live page, `js/main.js` is
  unchanged, and the carousel auto-scroll and both arrows do work (they use
  `setInterval`, not an observer). Reduced motion is likewise a `matchMedia` gate
  inside that unchanged shared script; the code path was read, not exercised.
- **Only one edition exists**, so multi-edition behaviour (archive grouping,
  `order` across years) is still untested in practice.
- **`eventStatus` variation is unmodelled** — a postponed or cancelled edition
  has no field yet, for the Forum or for standard events.
- The Forum's `hero_image: null` relies on the backdrop staying in `css/pbf.css`.
  If a future edition wants a per-edition hero photograph, that is a schema
  addition plus a CSS change, not a record edit.
