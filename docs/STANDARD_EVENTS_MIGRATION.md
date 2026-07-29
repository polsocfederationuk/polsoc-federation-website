# Standard events migration (Cleanup Phase 11)

The four standard events are now **structured content**. Four YAML records under
`content/events/` replace eight hand-written HTML pages, and one Eleventy
template generates all eight from them.

**The live site has not changed.** Netlify still publishes the repository root.
`scripts/compare-standard-events.js` passes 554/554, which is the evidence that
the eventual cutover is safe — and, unlike the earlier phases, it also proves
that each *approved correction* actually applied.

**The Polish Business Forum is not part of this phase.** It is a separate event
family with its own template and extension schema; `content/events/` holds only
`event_family: standard` records, and the validator fails if a Forum record
appears before its phase.

Related: [EVENT_RECONCILIATION.md](EVENT_RECONCILIATION.md) (the audit these
decisions came from), [BUILD_ARCHITECTURE.md](BUILD_ARCHITECTURE.md),
[ANNOUNCEMENTS_MIGRATION.md](ANNOUNCEMENTS_MIGRATION.md).

---

## 1. Final standard-event schema

One event, one file: `content/events/<slug>.yaml`. The worked reference is
[`schema-examples/event-standard.example.yaml`](schema-examples/event-standard.example.yaml).

```yaml
slug: sikorski-debate
event_family: standard
template: standard
academic_year: "2025/26"
published: true
order: 2
flagship: false
show_in_listing: true
show_on_homepage: true
show_in_archive: true

start_date: "2026-02-10"
end_date: null
date_precision: day

venue:
  name:         { en: "…", pl: "…" }
  neighbourhood: null            # or { en: "…", pl: "…" }
  locality:     { en: "London", pl: "Londyn" }
  country: "GB"
  # show_locality_in_facts: true — only where the live facts bar names the city

registration: { state: none, type: null, url: null, email: null }

hero_image: null                 # standard heroes are typographic
og_image: "/assets/…"
instagram_permalink: "https://www.instagram.com/p/…/"
album_url: "https://photos.app.goo.gl/…"

organiser: "Federation of Polish Student Societies UK"
co_organisers: []                # or [{ logo, alt: { en, pl } }]

sections:                        # ordered; shared structure
  - type: gallery
    instagram_in_grid: false
    images: [{ src, wide }]
  - type: prose
  - type: heading
  - type: album
  - type: instagram

en: { … }
pl: { … }
```

## 2. Shared and localised fields

| Shared (top level) | Localised (`en:` / `pl:`) |
| --- | --- |
| `slug`, `event_family`, `template` | `title_lead`, `title_fancy`, `title_tail` |
| `academic_year`, `published`, `order` | `eyebrow`, `hero_summary` |
| | `card_summary`, `timeline_summary` |
| `flagship`, the three visibility flags | `date_label`, `venue_label`, `facts[]` |
| `start_date`, `end_date`, `date_precision` | `co_organisers_label` |
| `venue` (all parts, per locale inside) | `back_link`, `back_link_bottom` |
| `registration` | `sections[]` content (prose, alts, headings) |
| `og_image`, `hero_image` | `album` (heading, text, label) |
| `instagram_permalink`, `album_url` | `seo_title`, `seo_description` |
| `organiser`, `co_organisers[].logo` | `schema_description`, `og_image_alt` |
| `sections[]` types, order, image srcs, `wide` | |

**The section list is split deliberately.** Structure (which sections, in what
order, which images, which tiles are wide) is shared, because it is the same
page in both languages. Only the words differ, and they sit in a positionally
matched list under each locale. The validator fails if the two lists disagree in
type or length — a mismatch would silently pair Polish alt text with the wrong
photograph.

**Display dates and venue strings are not stored per locale.** They are
generated from `start_date`, `date_precision` and `venue`. That is what stops
the facts bar, the listing card and the JSON-LD drifting apart the way the live
pages did — the audit found seven such drifts (EVENT_RECONCILIATION §5.2).

## 3. Dates and month precision

Dates are **quoted ISO strings**. Unquoted, YAML parses them into JavaScript
`Date` objects whose stringification depends on the machine's timezone; the
validator rejects any non-string date.

`date_precision` is `day` or `month`:

| Precision | Stored | English | Polish |
| --- | --- | --- | --- |
| `day` | `"2026-02-10"` | 10 February 2026 | 10 lutego 2026 |
| `month` | `"2025-10"` | October 2025 | Październik 2025 |

The two Polish forms differ grammatically and are formatted separately: a full
date takes the **genitive** ("10 lutego"), a standalone month takes the
**nominative** and is capitalised ("Październik"). Generating one from the other
would be wrong, so `eventDisplayDate` branches on precision rather than reusing
the announcement formatter.

Formatting splits the ISO string arithmetically and never constructs a `Date`,
so it is UTC-safe — verified by building under `TZ=Pacific/Auckland`.

**All four current events are day-precision.** `month` remains supported because
the Icebreaker was month-only until this phase, and a future event may be
announced before its day is fixed.

## 4. Venue modelling

```yaml
venue:
  name:          { en: "Ognisko Restaurant", pl: "Ognisko Restaurant" }
  neighbourhood: { en: "South Kensington",  pl: "South Kensington" }
  locality:      { en: "London",            pl: "Londyn" }
  country: "GB"
```

One canonical name feeds three consumers: the facts bar, the JSON-LD
`location.name`, and (later) the listing card. The facts bar shows
`name, neighbourhood` when a neighbourhood exists.

**`show_locality_in_facts`** exists because the live pages genuinely differ: the
Youth Congress facts bar says "Ognisko Polskie, London" while the Sikorski page
says just the institution. That is an editorial choice per event, so it is an
explicit flag rather than a rule inferred from which fields happen to be set.

`locality` and `country` always feed the JSON-LD `PostalAddress`, whether or not
the locality is shown in the facts bar.

## 5. Supported section types

Five, and only five. There is no page builder.

| Type | Shared | Localised | Used by |
| --- | --- | --- | --- |
| `prose` | inline style | `body` (Markdown) | all four |
| `gallery` | `images[]` (src, wide), `instagram_in_grid` | `alts[]` | 3 of 4 |
| `heading` | inline style | `eyebrow`, `title_lead`, `title_fancy` | 3 of 4 |
| `album` | `album_url` | `album.heading/text/label` | 2 of 4 |
| `instagram` | `instagram_permalink` | — | 3 of 4 |

Plus two template-level pieces present on every page: the **facts bar**
(including the co-organiser logo strip) and the top and bottom **back-links**.

Section usage per event:

| Event | Section order |
| --- | --- |
| sikorski-debate | gallery → prose → heading → gallery (Instagram inside the grid) |
| christmas-dinner | prose → heading → gallery → album → instagram |
| youth-congress | gallery → prose → album → instagram |
| icebreaker | prose → heading → instagram |

The order genuinely differs per event, so `sections` is an **ordered list**, not
a set of booleans. `instagram_in_grid` reproduces the Sikorski page's second
grid, where the embed sits inside the grid as a `span-2` tile.

`downloads` and a generic call-to-action were considered and **not built** — no
current page uses either, and a section with no consumer is how a page builder
starts.

## 6. Markdown and link handling

Event prose is Markdown, rendered at build time by markdown-it with the same
security configuration as announcements: `html: false`, `linkify: false`,
`typographer: false`, and an explicit safe-protocol allow-list. A record can
never inject markup; the validator independently rejects raw tags.

**One deliberate difference from the announcement renderer.** Announcements are
rendered *inline* because `.ann-text` uses `white-space: pre-line`. Event prose
lives in `.prose`, which styles real `<p>` and `<blockquote>`, so this is a full
block render — but with markdown-it's nested `<p>` **suppressed inside
blockquotes**:

```
markdown-it default:  <blockquote><p>quote</p></blockquote>
this renderer:        <blockquote>quote</blockquote>
```

That is not cosmetic. `.prose blockquote` sets its own font-family, size and
weight; `.prose p` would override them on the inner paragraph and the quote
would silently render as body text. Verified in-browser: zero nested `<p>`, and
the quote computes to 20px as it does live.

External links get `target="_blank" rel="noopener"` from a renderer rule, so
every external link is consistent rather than depending on an author. The
`mailto:`-style exceptions the contact page needs do not arise here.

## 7. Images and galleries

- Every path is **root-relative** (`/assets/…`). A page-relative path would
  resolve to `/pl/assets/…` from the Polish page and 404 — a bug this site
  shipped once. Both the comparison and the validator assert no `/pl/assets/`
  path exists.
- **Image paths and tile widths are shared**; only `alts` are localised, matched
  positionally to `images`. The validator fails if the counts differ.
- **Gallery order is preserved** and compared position by position.
- The passthrough list is derived from the records, so only referenced images
  are copied and adding one needs no second list updated.
- `wide: true` renders `class="ph ph-wide span-2"`, preserving the existing grid
  rhythm and `object-fit` behaviour.
- **The Icebreaker has an empty gallery.** No placeholder, no invented
  photographs; the validator asserts it stays empty.

## 8. JSON-LD generation

Generated from the record for every event with a full day-precision date — which,
after decision 2, is all four:

| Field | Source |
| --- | --- |
| `name` | the localised title parts, joined |
| `description` | `<locale>.schema_description` |
| `startDate` / `endDate` | `start_date` / `end_date` |
| `eventStatus` | always `EventScheduled` |
| `eventAttendanceMode` | always `OfflineEventAttendanceMode` (decision 3) |
| `location` | `venue.name` + `locality` + `country` as Place/PostalAddress |
| `organizer` | `organiser` |
| `url` | the page's own canonical |
| `image` | `og_image` |
| `performer` | `performers[]`, omitted when empty |
| `inLanguage` | `pl-PL` on Polish pages only |

Decision 3 is why the attendance mode is unconditional: the live Polish Sikorski
and Youth Congress pages were missing it, and generating it from one field makes
that class of omission impossible.

The JSON-LD venue is the **same canonical name the facts bar shows** — the
comparison asserts this explicitly, because venue drift between the two is
exactly what the audit found on the live pages.

## 9. Why the Icebreaker now has JSON-LD

It did not, and the original plan was to keep it that way.

The Phase 10 audit found `startDate: "2025-10"` — valid ISO 8601 and valid
schema.org, but **not accepted by Google's Event rich results**, which require a
full date. The recommendation was to keep month precision and omit the block
rather than ship something inert or invent a day.

**Decision 2 supplied the real date: 16 October 2025.** With a genuine full date
there is no reason to withhold the block, so the Icebreaker now carries the same
JSON-LD as the other three, and its visible date reads "16 October 2025" /
"16 października 2025".

> **Note on the brief.** The Phase 11 instructions also contained the earlier
> plan — month precision, no Icebreaker JSON-LD — in their *Dates*, *JSON-LD*,
> validation and comparison sections. That conflicted with decision 2. The
> conflict was raised and resolved in favour of the exact date. The comparison
> therefore treats the date change and the added JSON-LD as **approved
> corrections** and asserts both explicitly.

The `month` precision path remains implemented and tested for future use.

## 10. Registration fields and limits

```yaml
registration:
  state: none | open | closed | sold-out
  type: null | external-link | payment-link | email
  url: "https://…"
  email: "…"
```

All four current events are past, so every record is `state: none`. The fields
exist so a marketing officer can set a state and paste a link on a future event.

**Out of scope and IT-led when wanted:** native attendee registration, payment
webhooks, attendee databases, waiting lists, ticket inventory, confirmation
emails. None is a content problem.

Nothing in the template renders registration yet — there is no live example to
reproduce, and building an unused UI is what §5 argues against.

## 11. Adding a standard event

1. Put images in `assets/<event>/`.
2. Create `content/events/<slug>.yaml` from the schema example.
3. Set `event_family: standard`, `template: standard`, the academic year, and
   the next free `order`.
4. Set `start_date` (quoted) and `date_precision`.
5. Fill `venue` — one canonical name per locale.
6. List `sections` in the order the page should read, then write the matching
   localised content under **both** `en:` and `pl:`.
7. `npm run build && npm run validate && npm run compare:events-standard`.

The validator pins the expected count at four, so adding a fifth **will fail
validation until that constant is updated** — deliberately, so the roster is a
conscious decision rather than something that drifts.

## 12. Creating a future edition

An annual event that recurs gets a **new record**, never an edit of the old one:

- New slug, year-suffixed: `icebreaker-2026` (decision 12 keeps every existing
  slug and URL untouched; only *new* editions carry the year).
- New `academic_year`, new `order`.
- The previous edition keeps its record, its URL and its photographs.

## 13. Hiding an event without deleting its page

| Control | Effect |
| --- | --- |
| `show_on_homepage: false` | drops out of the homepage timeline |
| `show_in_listing: false` | drops off the events page; the detail page still resolves |
| `show_in_archive: false` | excluded from a future archive view |
| `published: false` | no page is generated at all |

Deriving visibility from dates would be fragile: a past event that should stay
prominent and a future one that should stay hidden are both normal.

## 14. CMS connection

The schema is Decap-shaped (`i18n.structure: single_file`, invariants as
`i18n: duplicate`). Three things to settle before wiring it up:

- **`sections` is a variant list.** Decap needs a `list` with `types`, one per
  section type, and the localised half must stay positionally aligned — the
  safest CMS shape is probably a single list whose items carry both the shared
  and localised fields, with the build splitting them.
- **`event_family`/`template` must be a locked pair**, not two free selects, or
  an editor can create a combination the templates reject.
- **`date_precision` should drive `start_date`'s widget** (date vs month), or an
  editor will produce a value that contradicts its own precision.

## 15. Approved differences from the old pages

Every one is asserted explicitly by `compare-standard-events.js` — the live
value *and* the new value — so a correction that failed to apply fails the build
just as loudly as a regression.

| # | Event | Was | Now |
| --- | --- | --- | --- |
| 1 | sikorski-debate (en) | Polish Institute **&** Sikorski Museum | Polish Institute **and** Sikorski Museum |
| 2 | christmas-dinner (en) | Ognisko, South Kensington | **Ognisko Restaurant**, South Kensington |
| 3 | christmas-dinner (pl) | Ognisko Polskie, South Kensington | **Ognisko Restaurant**, South Kensington |
| 4 | icebreaker (both) | Mamuśka!, London Waterloo / londyńskie Waterloo | Mamuśka!, **Waterloo** |
| 5 | icebreaker (both) | October 2025 / Październik 2025 | **16 October 2025** / **16 października 2025** |
| 6 | icebreaker (both) | month-only JSON-LD | **full Event JSON-LD** |
| 7 | christmas-dinner (pl) | "Annual Christmas Dinner" | **"Doroczna Kolacja Wigilijna"** |
| 8 | 3 Polish pages | English `og:image:alt` | **Polish**, reusing each page's own gallery alt |
| 9 | sikorski-debate, youth-congress (pl) | `eventAttendanceMode` absent | **emitted** |

**Everything else is required to match**, including prose, links, galleries,
album cards, embeds, classes, chrome and URLs.

### A correction to the Phase 10 report

EVENT_RECONCILIATION §18 stated the Polish debate title was untranslated. **It
was not** — `pl/event-sikorski-debate.html` already reads "Jak myśleć o polityce
w spolaryzowanym świecie", exactly what decision 9 approves. The audit *data*
was right (the title was never flagged `uncertain`); the prose table in that
report was wrong. Only the Christmas Dinner title genuinely needed translating.
The reconciliation document has been corrected.

### Preserved as-is, deliberately

Two live oddities are **not** in the approved list and are reproduced verbatim:

- The mid-page eyebrow **"As seen on Instagram" is English on the Polish pages**
  (Sikorski and Icebreaker).
- The Polish Sikorski prose contains an English "and" between the two media
  partners ("MyPolska.uk **and** British Poles").

Both are candidates for a future copy pass; neither was approved here, so
neither was touched.

## 16. Remaining work before the events listing

- **The Polish Business Forum** — its own family, template and extension schema.
  The single largest remaining page.
- **`events.html` (both locales)** — the listing needs `card_summary` (present)
  and the card image plus its alt text (**not** present: no standard event
  carries a `card_image`, because the live listing's card art was not part of
  this phase's page comparison).
- **Both homepages** — the timeline needs `timeline_summary` (present) and the
  ordering rules across event families, which cannot be settled until the
  Business Forum record exists.
- **`events.html` and the homepages are not generated**, and the validator fails
  if they appear.

**`card_summary` and `timeline_summary` are already in all four records**, in
both locales, transcribed verbatim from the live listing and homepage via the
Phase 10 audit matrix — not authored, and not derived from `hero_summary`. The
audit shows the three summaries are genuinely different lengths and are not
interchangeable, so generating one from another would have degraded the copy.
Nothing renders them yet; the validator requires them so that the listing phase
cannot begin with a record that silently lacks its card copy.

The remaining blocker for the listing is therefore the **card imagery**, plus
decision 11's Business Forum alt text — both of which arrive with the Forum's own
migration.
