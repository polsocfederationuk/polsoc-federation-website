# Homepage migration (Cleanup Phase 14)

`dist/index.html` and `dist/pl/index.html` are now generated from one bilingual
homepage record, the canonical event records and shared site settings. This was
the last un-migrated public page: every page the site serves now has a
production-equivalent generated version.

**The live site has not changed.** Netlify still publishes the repository root.
`scripts/compare-homepage.js` passes 215/215 with 30 documented negative controls.

This phase also added the archive-disclosure styles the events listing has been
waiting for since Phase 13 — the only public-CSS change, and purely additive.

Related: [EVENTS_LISTING_MIGRATION.md](EVENTS_LISTING_MIGRATION.md),
[BUSINESS_FORUM_MIGRATION.md](BUSINESS_FORUM_MIGRATION.md),
[BUILD_ARCHITECTURE.md](BUILD_ARCHITECTURE.md).

---

## 1. Homepage content schema

`content/pages/home.yaml` — one record, both locales, ~300 lines. Shape:

```yaml
slug: home
published: true

hero:
  shield_image: "/assets/logo.svg"
  shield_alt: ""                 # decorative; the brand name is beside it
  primary_link: events.html
  secondary_link: members.html

ticker:
  phrases:                       # stored ONCE; the template repeats the run
    - { en: "By students", pl: "Przez studentów" }
    - …

about:
  photo: "/assets/photos/christmas-dinner-group.jpg"

statistics:
  - key: founded
    value: 2013
    suffix: null
    plain: true                  # suppresses the thousands separator
    label: { en: "Established", pl: "Rok założenia" }
  - …

pillars:
  - key: representation
    number: "01"
    background: "/assets/home/students-conversation.jpg"
    title: { en, pl }
    body:  { en, pl }

featured_event:
  slug: business-forum           # names the canonical event
  logo / logo_alt / link
  gallery: [{ src, alt: { en, pl } }]

testimonials:
  - key: pbf-attendee
    quote: { en, pl }
    who:   { en, pl }
    role:  { en, pl }

partners:
  - key: lbs
    name: "London Business School"   # doubles as the accessible name
    image: "/assets/pbf/sponsors/lbs.jpg"
    url: null                        # the live logos are not linked

watermarks:
  about:    { en: "EST. 2013", pl: "OD 2013" }
  featured: { en: "PBF", pl: "PBF" }
  voices:   { en: "VOICES", pl: "GŁOSY" }
  # the timeline watermark is the academic year, from the central setting

en: { …34 localised fields… }
pl: { …the same 34… }
```

The event timeline is **not** in this record. See §4.

## 2. Shared and localised fields

| Shared | Localised |
| --- | --- |
| link destinations | headings, eyebrows, body copy |
| image paths | button labels |
| statistic values, suffixes, `plain` | statistic labels |
| pillar numerals and backdrops | pillar titles and descriptions |
| partner order, names, logos, URLs | image alt text |
| testimonial order and keys | quotes, attributions, roles |
| section order (in the template) | accessibility labels (in `ui.json`) |
| the Organization block (in `site.json`) | SEO copy, `schema_description` |

Two things worth noting:

- **Partner `name` is shared, not localised.** It is a proper noun and doubles as
  the accessible name; the live pages use the identical string on both.
- **The Organization's primary `name` is shared and is the POLISH legal name on
  both pages.** That is deliberate on the live site (see §11) and was preserved,
  not "corrected" to match the page language.

Interface strings that are site UI rather than page copy live in
`src/_data/ui.json` under `ui.<locale>.home`: the quote-carousel and marquee
accessible labels, the marquee's accessible name, the empty-season text and the
all-events link label. Nothing translated is hard-coded in a template or in JS.

## 3. Section ordering

Fixed in `src/index.njk`, matching the live pages exactly:

```
hero → ticker → about → statistics → pillars → event timeline
     → featured event → testimonials → partners → call to action
```

Order is **not** stored in the record: the homepage is a designed page, not a
page builder. A marketing officer fills sections in and cannot reorder or remove
them. Ten partials under `src/_includes/partials/home/` back these sections; the
"what we do" heading band and the full-bleed pillar strip are two `<section>`
elements on the live page and stay two, inside one partial.

## 4. Event-timeline data source

Generated from the **canonical event records** via `src/_data/eventListing.js`,
filtered by the `homepageEvents` filter to `show_on_homepage: true`. Nothing about
an event is repeated in the homepage record, so the homepage, the events listing
and the five detail pages cannot disagree about a date, a venue or a title.

Dates come from the same deterministic `eventDisplayDate` formatter the other two
use. **No homepage display date is stored anywhere.**

Only the **current academic year** appears, taken from
`content/settings/academic-year.yaml` — the one central setting, shared with the
team page and the listing. The watermark renders that value directly, so changing
the setting moves the whole band.

## 5. Timeline ordering and override rules

**No `homepage_order` override was necessary.** The live homepage timeline and the
live events listing are in the *same* order:

```
business-forum → sikorski-debate → christmas-dinner → youth-congress → icebreaker
```

so the existing `order` field (1–5, scoped to the academic year) drives both. The
validator fails if a `homepage_order` field ever appears, because adding one that
merely repeats `order` would create a second source of truth for the same fact.

If a future edition genuinely needs a different homepage order, add
`homepage_order` **only to the affected records**, scope it within the academic
year exactly as `order` is (see EVENTS_LISTING_MIGRATION §9), document why, and
keep the "must not equal `order`" assertion.

### Timeline titles

Derived from the event title by default, overridden by `timeline_title` where the
live homepage genuinely differs. **All five differ** — the homepage uses short,
venue-flavoured labels:

| Event | Event title | Homepage timeline title |
| --- | --- | --- |
| business-forum | Polish Business Forum 2026 | **Polish Business Forum at LBS** |
| sikorski-debate | How to Think About Politics in a Polarised World | **Debate at the Sikorski Institute** |
| christmas-dinner | Annual Christmas Dinner | **Christmas Dinner at Ognisko** |
| youth-congress | Polish Youth Congress 2025 | **Polish Youth Congress** |
| icebreaker | Icebreaker | **Icebreaker at Mamuśka!** |

The Business Forum's override already existed from Phase 12; the other four were
added in this phase, transcribed from the live pages. The validator rejects any
`timeline_title` that merely repeats the event's own title.

`timeline_summary` is required in both languages for every homepage-visible event;
all five already had it.

### Links

`event-<slug>.html`, **relative on both pages** — from `/` it resolves to
`/event-<slug>.html`, from `/pl/` to `/pl/event-<slug>.html`. Verified in-browser:
every timeline link, hero CTA, featured CTA and the closing CTA resolve inside
`/pl/` on the Polish homepage. No record contains a locale prefix.

## 6. Why archives are not shown on the homepage

The homepage is a snapshot of the current season; the events page is the archive
and already has the `<details>` disclosures. Putting them in both would mean two
places to maintain the same interaction, and a homepage that grows without bound
as seasons accumulate.

So the timeline shows the current year only, and the validator fails if a
`<details>` element ever appears on either homepage.

**Empty current season.** When the configured year has no homepage-visible events,
the section keeps its heading and season watermark, replaces the items with one
concise localised line, and offers a link to the events page. Previous years are
*not* promoted. That matches the live design better than hiding the whole band,
which would leave a visible gap between the pillars and the featured event. The
strings live in `ui.<locale>.home.emptySeason` and `.allEventsLabel`.

## 7. Ticker content and technical repetition

Phrases are stored **once** in `home.ticker.phrases` and repeated `tickerRuns`
times by the template, because the CSS translation needs a second copy in place as
the first leaves; one run shows a gap every cycle.

`tickerRuns: 2` lives in `src/_data/homeTechnical.js` — IT-owned, outside every
content collection, so no CMS form can reach it.

`.ticker-clip` is **load-bearing**: it clips the stripe's overhang so an over-wide
rotated element cannot widen the document. The validator checks for the wrapper by
name rather than trusting the CSS, and the comparison fails if it disappears. The
overflow is solved by that wrapper, never by hiding overflow globally.

The whole `.ticker` is `aria-hidden="true"` on the live pages, so assistive
technology never reaches either copy and the repetition raises no accessibility
question here.

## 8. Statistics and `data-plain`

Four counters, values and labels transcribed exactly:

| key | value | suffix | plain | label (en) |
| --- | --- | --- | --- | --- |
| founded | 2013 | — | **true** | Established |
| students | 7000 | + | false | Students from all around the UK |
| societies | 30 | + | false | Polish student societies |
| flagship_events | 5 | + | false | Flagship events per year |

`data-count` / `data-suffix` / `data-plain` are emitted from those machine values;
no formatted display string is stored, and the validator rejects one if added.

**`data-plain` on the founding year is load-bearing**: without it `js/main.js`
formats the counter with `toLocaleString()` and it renders as **2,013**. It is
asserted in the record, in the generated markup, and by a negative control.

The literal `0` inside each counter is the pre-animation value and is what shows
if JavaScript never runs — not a placeholder.

## 9. Partner canonical data and marquee repetition

**9 canonical logos, rendered as 18 tiles** — the architecture audit's figure is
confirmed against the live pages.

Each logo is stored once. `js/main.js` wraps the strip at `scrollWidth / 2`, which
hard-codes exactly two identical sequences, so the repetition is animation
machinery: `partnerMarqueeSets: 2` in `src/_data/homeTechnical.js`, never in
content and never in a CMS field. Storing the duplicate set in YAML would let
someone add a partner in one place and silently break the loop.

The repeated set is `aria-hidden="true"` with `alt=""`, so each partner is
announced once. Order, URLs (`null` — the live logos are not linked) and the
carousel classes are preserved.

**One live detail reproduced rather than normalised:** the homepage marquee carries
**no** `data-autoscroll` attribute, unlike the Business Forum page's two carousels
which do. Both pages agree with each other, so this is per-page, and the
comparison asserts it.

Verified in-browser: `scrollWidth` 4092 across 18 tiles, so the wrap point (2046)
is exactly 9 tiles — a clean boundary. Auto-scroll and the arrows both work.

## 10. Testimonial modelling

Four slides, ordered, each with a localised `quote`, `who` and `role`. The live
markup renders attribution as a label plus a nested `<span>` styled differently,
which is why `who` and `role` are separate fields.

Preserved: wording, order, `.quote-slide` classes, the `active` class on the first
slide (applied by the template as the initial state), the `.quote-nav` controls,
the **empty** `.quote-dots` container that `js/main.js` fills with indicators, the
localised arrow labels, and the decorative `&ldquo;` glyph.

No photographs, biographies or links exist on the live page and none were
invented. The Polish quotes are genuinely translated on the live page, so nothing
was left in English and nothing was auto-translated.

Verified in-browser: clicking the next arrow advances the active slide and four
indicator dots are rendered.

## 11. Organization JSON-LD

Built from `site.organization` (shared) plus the record's localised
`schema_description`. Only three fields vary by locale:

| Field | English page | Polish page |
| --- | --- | --- |
| `url` | `https://polsocfederation.pl/` | `https://polsocfederation.pl/pl/` |
| `description` | English | Polish |
| `inLanguage` | *absent* | `pl-PL` |

Everything else is shared and byte-identical to the live blocks: `@type`, `name`,
`alternateName`, `logo`, `image`, `email`, `foundingDate`, `identifier`, `address`,
`sameAs`.

**The primary `name` is the Polish legal name on BOTH pages**, with the two English
forms in `alternateName`. That is what the live site does; it was preserved rather
than "fixed", because the organisation's registered name is Polish and changing
structured-data identity is not a migration decision.

## 12. Correspondence-address status

The live Organization JSON-LD **contains** a `PostalAddress` (238-246 King St,
London W6 0RF, GB) on both homepages. It is therefore **preserved verbatim** for
production equivalence, and the comparison asserts it in both directions.

> **PENDING GOVERNANCE / SEO DECISION — not resolved in this phase.**
> Whether the Federation's correspondence address belongs in Organization
> structured data is a question for the Federation, not for a migration. Listing a
> mail-forwarding address as an organisation's address can affect local-SEO
> signals and publishes a postal address in machine-readable form.
>
> It is modelled as **one shared block** in `src/_data/site.json`
> (`site.organization.address`), read by both pages, so removing it later is a
> single deletion with no page edits. The visible contact-page wording was not
> touched.

## 13. Social-profile rules

`sameAs` holds **exactly three** confirmed Federation profiles:

- `https://www.instagram.com/federac_ja/`
- `https://www.linkedin.com/company/federation-of-polish-student-societies-in-the-uk`
- `https://www.facebook.com/FederationOfPolishStudentSocietiesUK/`

The Polish Business Forum and The Lambert are **separate initiatives**, not
Federation-level profiles in the live schema, and are not added. The validator
rejects any fourth entry and any URL matching those initiatives; a negative control
proves it fires.

## 14. Social-sharing metadata

The homepages use the **shared Federation banner** —
`/assets/social/og-image.png`, 1200×630 — and that is what the live pages declare,
so it is preserved. It was *not* swapped for another asset merely because one
exists; the live metadata is the source of truth.

Preserved exactly: `og:type` (website), `og:site_name`, `og:locale` +
`og:locale:alternate`, `og:title`/`og:description`/`og:url`, the full
`og:image` set including `secure_url`, `type`, `width` and `height`, the localised
`og:image:alt`, all five Twitter tags, every favicon declaration, the manifest link
and `theme-color`.

One live oddity preserved: the **English** page's `<title>`, `og:title` and
`twitter:title` are the **Polish** organisation name with a `| FPSS UK` suffix. It
is transcribed as-is; changing it is an SEO decision, not a migration one.

## 15. Archive disclosure CSS

63 lines appended to `css/style.css`, **0 lines removed** — the only public change
in this phase, and additive by construction. Nothing on the current live pages
matches these selectors, because only one academic year exists and no archive
markup is emitted yet, which is exactly why the block can be added safely.

```
.event-archive                        wrapper + heading
.event-archive-year                   one <details> per archived season
.event-archive-year > summary         the disclosure control
.event-archive-year > .event-list     expanded content
```

Decisions:

- **Native `<details>`/`<summary>` kept.** `display: list-item` preserves the
  browser's own marker, so no custom indicator is needed and none is provided —
  the brief's condition for hiding it never arises.
- **Visible keyboard focus** via `:focus-visible` with a 2px red outline, matching
  the language switcher's existing treatment.
- **Touch-friendly**: `min-height: 44px` plus padding. Measured 55px on mobile,
  62px on desktop.
- **No JavaScript**: `js/main.js` contains no reference to `details`, `summary` or
  `archive` — confirmed by grep.
- Expanded content reuses the normal `.event-list` grid; **no event card was
  restyled**.
- Seasons are separated by hairline rules using the existing `--line` token.

### Testing it without inventing content

A synthetic fixture at `src/build-test/archive-fixture.njk` renders the same
markup from **fictional** seasons and events, defined inside that template so they
can never reach `content/events/`, a listing, a timeline, a sitemap or a feed. It
is `noindex`, lives under `build-test/`, and the validator asserts both that it
exists there and that its fictional slugs appear on **no** public page.

Measured at 320 / 390 / 768 / 1280 px, both languages: all disclosures collapsed
by default, summaries within the viewport, **zero** document overflow both
collapsed and expanded, expanded cards within the viewport, native marker intact,
44px+ target. A real click toggles the disclosure and leaves overflow at zero.

## 16. How to edit homepage content manually

1. Edit `content/pages/home.yaml` — one file, both languages side by side.
2. Statistics: change `value` / `suffix` / `plain`, never a formatted string.
3. Partners: add one entry with `key`, `name`, `image` (and `url` if it should
   link). **Do not** duplicate it for the marquee.
4. Testimonials and pillars: add one entry with its localised fields.
5. The event timeline is **not** edited here — edit the event record.
6. `npm run build && npm run validate && npm run compare:homepage`.

## 17. How the future CMS should expose homepage fields

- **Repeatable lists** (statistics, pillars, testimonials, partners) as sortable
  lists with a stable `key` per item, both locales required on every localised
  field.
- **`plain` needs a hint**: *"tick for year-like numbers so 2013 does not render
  as 2,013."*
- **Never expose** `partnerMarqueeSets` or `tickerRuns`. They are not fields.
- **Do not expose section order.** The homepage's sections are fixed.
- **Do not expose the timeline.** Show a read-only note that it comes from the
  event records, with a link to them — otherwise an editor will look for it here.
- **`shield_alt: ""` must stay empty** and should carry a "decorative" hint rather
  than looking like a missing value an editor should fill.
- **The Organization block and the address are site settings**, not homepage
  fields, and the address should be flagged as pending a governance decision.
- The **`{season}`-style placeholders** used on the events page do not appear on
  the homepage; the season only reaches the timeline watermark.

## 18. Which structures remain IT-controlled

- section order and the section set
- `partnerMarqueeSets`, `tickerRuns` (`src/_data/homeTechnical.js`)
- `.ticker-clip` and the whole ticker structure
- the `.timeline` / `.timeline-progress` rail markup `js/main.js` animates
- `.reveal` classes and their `reveal-dN` stagger
- counter mechanics (`data-count` / `data-suffix` / `data-plain` emission)
- the hero's blobs, ring and scroll hint
- the decorative quote glyph, the camera-style card chrome, `.quote-dots`
- the `active` class on the first testimonial slide
- the Organization JSON-LD shape
- `css/style.css`, including the new archive block

## 19. Approved differences from the live pages

**One content correction**, asserted in both directions:

| Where | Live | Generated |
| --- | --- | --- |
| Icebreaker timeline date (en) | October 2025 | **16 October 2025** |
| Icebreaker timeline date (pl) | Październik 2025 | **16 października 2025** |

That follows from Phase 10 decision 2 (the exact date) and is already applied to
the detail page and the listing; the homepage simply stops carrying its own
month-only copy.

The homepage timeline shows **no venue**, so the canonical venue corrections do not
surface here. No Polish event title on the homepage needed correcting — the
timeline uses `timeline_title`, and all five were already correct in both
languages. No image-alt correction was needed: every homepage alt string was
already properly localised.

**Structural differences shared with earlier phases:** asset and stylesheet paths
are root-relative (`/css/style.css`) where the live pages use page-relative ones;
the fonts URL is HTML-escaped (`&amp;`) for the same URL. Both established in the
shared-chrome phase.

**Nothing else differs.** Every other string, class, attribute, image and link is
compared for equivalence, and 30 negative controls confirm the comparison bites.

## 20. Remaining tasks before production cutover

Every public page now has a generated equivalent, so the remaining work is about
switching over rather than migrating:

1. **`sitemap.xml` is still hand-maintained** and is not generated. It should be
   built from the same records before cutover, or it will drift the first time a
   page is added.
2. **`robots.txt`, `favicon.ico`, `site.webmanifest`** are passthrough copies; they
   need a deliberate check that the generated tree serves them at the same paths.
3. **The Netlify switch itself** (`publish = "."` → `"dist"`) is a one-line change
   that should land on its own, with the full comparison suite green, so it can be
   reverted independently of any content work.
4. **A redirect audit**: the live tree contains files the generated tree does not
   (and vice versa for `build-test/`). `build-test/` should be excluded from the
   published output before cutover — it is currently generated into `dist/`.
5. **The three untranslated Polish strings** on the live Business Forum page were
   fixed in the records (Phase 12) but the *live* pages still show the English
   until cutover.
6. **Archive styles are unexercised in production** until a 2026/27 season exists.
   They are tested by fixture only.
7. **The Organization address decision** (§12) is still open.

---

## Fictional example — adding a partner and a statistic

```yaml
# content/pages/home.yaml
statistics:
  # …existing four…
  - key: example-cities
    value: 12
    suffix: "+"
    plain: false          # not a year, so thousands separators are fine
    label: { en: "Cities", pl: "Miast" }

partners:
  # …existing nine…
  - key: example-partner
    name: "Example Partner Ltd"          # shared: a proper noun
    image: "/assets/home/partners/example.png"
    url: "https://example.com/"          # set to link the logo
```

That renders a fifth counter and a tenth partner — and **20** marquee tiles, not
18, because the template multiplies the canonical set by `partnerMarqueeSets`. The
YAML never mentions the repetition, and the validator recomputes the expected tile
count from the record so the assertion follows automatically.
