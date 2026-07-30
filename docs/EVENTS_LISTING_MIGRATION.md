# Events listing migration (Cleanup Phase 13)

`dist/events.html` and `dist/pl/events.html` are now generated from the five
canonical event records and one bilingual page record. The listing also gains an
academic-year archive system that does not yet display anything, because only one
season exists — by design.

**The live site has not changed.** Netlify still publishes the repository root.
`scripts/compare-events-listing.js` passes 242/242 with 22 documented negative
controls.

Related: [STANDARD_EVENTS_MIGRATION.md](STANDARD_EVENTS_MIGRATION.md),
[BUSINESS_FORUM_MIGRATION.md](BUSINESS_FORUM_MIGRATION.md),
[EVENT_RECONCILIATION.md](EVENT_RECONCILIATION.md).

---

## 1. Events-page content schema

`content/pages/events.yaml` — one record, both locales, page furniture only. No
individual event appears in it.

```yaml
slug: events
template: events
hero_image: "/assets/debata/networking.jpg"
hero_image_position: "center 52%"

en:
  eyebrow: "{season} Season"        # {season} is replaced at build time
  title_lead: "Our"
  title_fancy: "events"
  lead: "…"
  read_more: "Read more"            # generic card control
  flagship_tag: "★ Flagship event"  # generic status label
  archive_heading: "Previous seasons"
  archive_summary: "{season} events"
  empty_season: "The {season} season is just getting started — …"
  cta_heading / cta_text / cta_label
  seo_title / seo_description / og_image_alt
pl:
  # …the same keys, in Polish
```

Every visible string was transcribed from the live pages. Only `archive_heading`,
`archive_summary` and `empty_season` are new, because those states do not exist on
the live site — see §15.

`{season}` is a placeholder, not stored text. The validator fails if `eyebrow`,
`archive_summary` or `empty_season` hard-codes a year.

## 2. Event-card data resolution

Every visible value on a card comes from the canonical event record:

| Card element | Source |
| --- | --- |
| title | `eventTitle` — `title`, or the trimmed title parts joined with a space |
| date | `eventDisplayDate(start_date, end_date, date_precision, locale)` |
| venue | `venueDisplay(venue, locale)` |
| summary | `<locale>.card_summary` |
| image | `card_image` |
| alt | `<locale>.card_image_alt` |
| link | `event-<slug>.html` |
| variant | `event_family` |
| flagship tag | `flagship` + the page record's `flagship_tag` |

**No display date or venue string is stored anywhere.** The validator rejects
`card_display_date`, `card_venue` and similar keys outright. That is what keeps
the card, the detail page's facts bar and the JSON-LD from disagreeing the way the
hand-written pages did (EVENT_RECONCILIATION §5.2).

## 3. Why titles are derived unless overridden

All ten card titles (five events × two locales) turned out to be
**character-identical** to the event's own resolved title. Storing them again
would have created ten strings that can silently fall out of sync with the pages
they name.

So the rule is: **derive from `title`; permit `card_title` only where the live
listing genuinely differs.** It differs nowhere, so no override exists — and the
Business Forum's `card_title`, added in Phase 12, was **removed** as redundant.
The validator now fails if any record stores a `card_title` that merely repeats
its own title.

The same rule is written down for `timeline_title` ahead of the homepage phase.
There, one override *is* genuine: the Forum's timeline entry reads "Polish
Business Forum at LBS", not "Polish Business Forum 2026".

> **A defect this exposed.** Standard events store their title split around the
> `.fancy` span (`title_lead` / `title_fancy` / `title_tail`). Phase 11
> **concatenated** those parts, which rendered "Polish Youth Congress2025" and
> "AnnualChristmasDinner" — the `<span>` is inline and contributes no space. The
> comparison missed it because normalising markup to text replaces every tag with
> whitespace, hiding exactly this class of bug. Phase 13 joins the parts with a
> single space, stores every part trimmed, and adds an "as rendered" check
> (markup removed, nothing substituted) to both event comparisons.
>
> The same concatenation had also corrupted the JSON-LD `name` on all four
> standard events — and that field had never been compared against the live block
> at all. Two events legitimately name the year in structured data but not in
> their heading, so `schema_name` now records that override.

## 4. Card image and alt-text rules

- `card_image` is a top-level field: the photograph is the same in both
  languages, only its description is localised.
- `<locale>.card_image_alt` is required in both languages, must be at least 15
  characters, and must **differ** between languages — an identical pair means one
  was never translated.
- Paths are root-relative (`/assets/…`) so `/pl/` cannot resolve them into
  `/pl/assets/…`.
- The passthrough list is derived from the records, so adding an event copies its
  card image automatically.

The listing card photograph is deliberately a **different frame** from the detail
page's OG image on three of the five events — that is live behaviour, preserved.

## 5. Standard versus flagship card variants

One partial, `src/_includes/partials/event-card.njk`, renders both families. The
family selects a modifier class from a small map:

```njk
{%- set familyClass = { "polish-business-forum": " event-card-pbf" } -%}
```

The Business Forum card gets `event-card event-card-pbf` plus a `.flagship-tag`
span; standard events get `event-card`. Nothing else differs — the Forum's card is
a **listing variant**, not a miniature of its detail page. Adding a family means
adding one entry to that map, not a sixth template.

The comparison asserts, on both pages, that exactly one card is flagship, that it
is the Business Forum, that the Forum keeps both its variant class and its tag,
and that **no standard event** carries either.

### Where the flagship label lives

`★ Flagship event` / `★ Wydarzenie flagowe` is **generic interface wording**: it
names a status, not this event, and any future flagship event would use the same
words. It is therefore centralised in `content/pages/events.yaml` and was
**removed** from the Business Forum record, where Phase 12 had put it. Had the
label been event-specific copy ("★ Our 10th anniversary"), the record field would
have been the right home.

## 6. Academic-year format

`YYYY/YY`, where the second pair is the last two digits of the following calendar
year:

| Value | Valid? |
| --- | --- |
| `2025/26` | yes |
| `2026/27` | yes |
| `2099/00` | yes (century rollover) |
| `2025/27` | **no** — not the following year |
| `2025/25` | **no** |
| `2025-26`, `25/26`, `2025/2026` | **no** |

Validated in `parseAcademicYear()`, in `scripts/validate.js`, and by the synthetic
tests.

## 7. The central current-year setting

`content/settings/academic-year.yaml` → `current: "2025/26"`. **One setting**,
already used by the team page; the listing reuses it rather than adding a second.
The validator fails if a rival year setting appears, or if the events page record
grows its own copy.

Nothing in the listing hard-codes a year. The watermark renders `2025/26` (the raw
value) and the eyebrow renders `2025 / 2026` (via the `academicYearLong` filter) —
two renderings of one stored value.

## 8. Grouping and sorting rules

`src/_data/eventListing.js` exports a **pure** `group(records, currentYear)`:

1. Keep only `published: true` **and** `show_in_listing: true`.
2. Bucket by `academic_year`.
3. The configured current year renders first, always present even when empty.
4. Previous years follow, sorted by starting year **descending**.
5. Within a year, sort by `order` ascending, ties broken by slug.

It never mutates its input, never consults filesystem order, publication date,
title or event family, and returns identical output for shuffled input — all
asserted by the synthetic tests.

## 9. Why `order` is scoped within an academic year

Because seasons repeat. The 2026/27 Icebreaker is the first event of *its* year and
should be `order: 1`, exactly as the 2025/26 Business Forum is `order: 1` of its
own. A global uniqueness rule would force every new season to start numbering
where the last one stopped, so the numbers would drift further from "position in
this year's programme" every season.

So uniqueness is required within `academic_year` **only**. The validator and the
grouping helper both enforce that scope, and a test asserts that reusing `order: 1`
across years is accepted while duplicating it within one year is rejected.

## 10. Previous-year archive behaviour

Each previous year renders inside a native `<details>` with a localised
`<summary>`:

```html
<details class="event-archive-year">
  <summary>2024 / 2025 events</summary>
  <div class="event-list"> …cards… </div>
</details>
```

- collapsed by default
- keyboard accessible and fully usable **without JavaScript**
- the year is visible in the summary
- events inside are ordinary links
- content stays in the DOM and the accessibility tree while collapsed, so in-page
  search still finds it
- **no ARIA is added.** `role`, `aria-expanded` and friends would duplicate or
  fight the semantics the browser already provides. The comparison fails if any
  appears.

## 11. Empty-current-year behaviour

When the current year is changed and no event has been published under it yet:

- a concise localised message renders in place of the card list
- previous years still render in their archive disclosures
- the newest archived year is **not** silently promoted to current
- no events are hidden

Covered by synthetic test 3.

## 12. Future-year validation behaviour

**A published event whose academic year is later than the configured current year
FAILS the build.** It is not silently archived and not silently hidden.

Publishing next season's event before the site moves to that season is almost
always an editorial mistake, and the two silent alternatives are both worse: an
archive would file next year's event under history, and exclusion would leave the
author hunting for a page that built without complaint. The error names the record
and the fix.

```
freshers-mixer: academic_year 2026/27 is later than the configured current year
2025/26 — publish it once the current year moves on, or correct the record
```

Enforced in the grouping helper and again in `scripts/validate.js`.

## 13. Native `<details>` disclosure semantics

See §10. The decision in one line: the browser already ships an accessible,
JavaScript-free disclosure widget, and a custom one would be worse in every
respect that matters — keyboard support, screen-reader announcement, find-in-page,
and behaviour when scripts fail to load.

## 14. Relative event-link routing

Cards link to `event-<slug>.html` — **relative, on both pages**:

- from `/events.html` the browser resolves it to `/event-<slug>.html` (English)
- from `/pl/events.html` it resolves to `/pl/event-<slug>.html` (Polish)

One href, two correct destinations, and **no locale prefix is ever stored in a
record**. Verified by clicking a card on the Polish listing and landing on the
Polish detail page. The comparison fails if any card link becomes root-relative,
because that would drop a Polish reader onto the English site.

## 15. Approved visible corrections from the live listing

Each is asserted in **both** directions — the live page must still show the old
value and the generated page the new one.

| Card | Locale | Live | Generated |
| --- | --- | --- | --- |
| sikorski-debate | en | Polish Institute **&** Sikorski Museum | Polish Institute **and** Sikorski Museum |
| christmas-dinner | en | Ognisko, South Kensington | **Ognisko Restaurant**, South Kensington |
| christmas-dinner | pl | Ognisko Polskie, South Kensington | **Ognisko Restaurant**, South Kensington |
| icebreaker | en | October 2025 | **16 October 2025** |
| icebreaker | pl | Październik 2025 | **16 października 2025** |

All five follow from decisions already approved in Phase 10 and applied to the
detail pages in Phase 11; the listing simply stops storing its own contradictory
copies. Every other venue and date string already matched the canonical value.

**Not corrections, but worth recording:**

- The Polish Christmas Dinner card title was **already** "Doroczna Kolacja
  Wigilijna" on the live listing, even though the detail page's heading was not.
- All ten card alt strings were already properly localised; they are transcribed
  verbatim.
- The live pages carry an `ADDING A NEW EVENT` HTML comment containing a
  placeholder `<img src="assets/events/my-event.jpg" alt="">`. Generating the
  listing from records makes those hand-editing instructions obsolete, so the
  generated pages omit the comment. (That same commented markup is what made the
  Phase 10 audit misreport the Forum's card image — see EVENT_RECONCILIATION.)

## 16. Adding a future event manually

1. Put the images in `assets/<event>/`.
2. Create `content/events/<slug>.yaml` (see the standard or Forum migration doc).
3. Set `academic_year` to the season it belongs to, and `order` to its position
   **within that season**.
4. Set `show_in_listing: true`, `card_image`, and `card_summary` +
   `card_image_alt` in both languages.
5. `npm run build && npm run validate && npm run compare:events-listing`.

The validator pins the current roster at five listing-visible events, so a sixth
fails until that constant is updated — deliberately.

## 17. Starting a new academic year

Change one line:

```yaml
# content/settings/academic-year.yaml
current: "2026/27"
```

Add the new season's records with `academic_year: "2026/27"` and `order: 1, 2, 3…`.
Nothing else moves.

## 18. How changing the current year moves old events into archives

It is automatic and requires no edit to any existing event record. With
`current: "2026/27"`:

- 2026/27 events render as the main list under a `2026 / 2027 Season` heading and
  a `2026/27` watermark
- every 2025/26 event moves, untouched, into a collapsed `2025 / 2026 events`
  disclosure
- if no 2026/27 event exists yet, the empty-season message renders and the archive
  still appears

The old records keep their slugs, URLs, order values and photographs. Archiving is
a consequence of the central setting, never a per-record flag.

## 19. How the future CMS should expose academic year and order

- **Academic year**: a constrained field, not free text — either a select of known
  seasons or a masked `YYYY/YY` input with the "second half must be the next year"
  rule enforced in the form. The build rejects bad values, but the editor should
  never get that far.
- **Order**: a number **scoped to the chosen year**, with the form showing the
  other events already using that year so a clash is visible before saving. Two
  events sharing an order within one year is a build failure.
- **The current-year setting is a site-settings field, not a page field**, and
  changing it is a deliberate seasonal action — worth a confirmation, since it
  moves the whole listing into the archive.
- **Do not expose** `card_title` or `timeline_title` as ordinary fields. Present
  them as optional overrides, clearly labelled "only if the card should differ
  from the event title", or editors will dutifully fill in duplicates.
- **`show_in_listing` and `published` are separate toggles** and should stay that
  way: unpublishing removes the page, hiding removes only the card.

## 20. What remains before homepage generation

The homepage timeline needs, per event:

- `timeline_summary` — **present** on all five records.
- `timeline_title` — derived from `title` by default; **one genuine override
  exists** (the Forum's "Polish Business Forum at LBS"), and it is already stored.
- `timeline_display_date` — must be **generated**, exactly as the card's is; the
  live homepage's strings should not be transcribed into records.

Still unsettled:

- The homepage shows a **subset** in a different order from the listing. Whether
  that is `show_on_homepage` plus the same `order`, or a separate homepage order,
  needs deciding from the live markup.
- The homepage also carries an "Est. 2013" counter with `data-plain`, unrelated to
  events but on the same page.
- Both homepages carry substantial non-event content (hero, mission, partners
  strip, quotes carousel) that has no record yet. The homepage is a bigger job
  than the listing was, and the event timeline is only one band of it.

---

## Fictional multi-year example

Illustrative only — no real future event details.

```yaml
# content/settings/academic-year.yaml
current: "2026/27"
known:
  - "2026/27"
  - "2025/26"
```

```yaml
# content/events/example-autumn-social.yaml   (2026/27, first of its season)
slug: example-autumn-social
event_family: standard
template: standard
academic_year: "2026/27"
published: true
order: 1                       # order 1 again — scoped to 2026/27
flagship: false
show_in_listing: true
show_on_homepage: true
show_in_archive: true

start_date: "2026-10-15"
end_date: null
date_precision: day

venue:
  name:          { en: "Example Venue", pl: "Example Venue" }
  neighbourhood: { en: "Bloomsbury", pl: "Bloomsbury" }
  locality:      { en: "London", pl: "Londyn" }
  country: "GB"

card_image: "/assets/example/social.jpg"

en:
  title_lead: "Example Autumn"
  title_fancy: "Social"
  card_summary: "An example description of the first social of the season."
  card_image_alt: "An example description of the photograph on the listing card."
  # no card_title — the card title is "Example Autumn Social", derived
pl:
  title_lead: "Przykładowe jesienne"
  title_fancy: "spotkanie"
  card_summary: "Przykładowy opis pierwszego spotkania w sezonie."
  card_image_alt: "Przykładowy opis zdjęcia na karcie wydarzenia."
```

With that setting and those records, the listing renders:

```
2026 / 2027 Season                       ← eyebrow, from the central setting
[watermark 2026/27]
  ┌ Example Autumn Social ─────────────┐  ← order 1 of 2026/27
  └────────────────────────────────────┘

Previous seasons
  ▸ 2025 / 2026 events                    ← collapsed <details>
      Polish Business Forum 2026          ← order 1 of 2025/26, still flagship
      How to Think About Politics…        ← order 2
      Annual Christmas Dinner             ← order 3
      Polish Youth Congress 2025          ← order 4
      Icebreaker                          ← order 5
```

Both events are `order: 1` and neither moved. Adding a 2027/28 record while
`current` is still `2026/27` fails the build (§12).
