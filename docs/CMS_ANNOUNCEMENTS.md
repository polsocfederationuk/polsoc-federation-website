# Announcements CMS (Phase 17B)

Announcement editing in the local Decap panel, on top of the foundation in
`docs/CMS_FOUNDATION.md`. Read that first: the local-only architecture, startup
commands, Record ID rules and duplicate protection are shared and are not
repeated here.

This phase adds **Announcements** only. Events, the Business Forum, member
societies and page content are still not editable, and there is still no
production `/admin/` and no authentication.

---

## 1. Collection architecture

`content/announcements/` ⇄ the **Announcements** collection — the same 28 files
the site already renders, edited in place. Nothing was moved, renamed, split by
language or converted to Markdown files.

```yaml
folder: content/announcements
extension: yaml
format: yaml
create: true
delete: true
slug: "{{fields.slug}}"
summary: "{{fields.academic_year}} — {{fields.en.title}} — {{fields.published_date}}"
```

**Deletion is enabled here, unlike Team.** An announcement posted by mistake is
something to remove; a committee member who served is history. For anything that
genuinely happened, unpublish instead.

The summary leads with the academic year because the collection holds every year
at once — a campaign repeated next year is otherwise indistinguishable from its
predecessor in the list.

## 2. The schema, as it really is

All 28 records carry all 14 top-level keys. Derived from the files, not assumed:

| Field | Type | Required | Notes |
|---|---|---|---|
| `slug` | string | **required** | Equals the filename |
| `academic_year` | `"YYYY/YY"` | **required** | All 28 are `2025/26` |
| `published_date` | `"YYYY-MM-DD"` | **required** | Quoted string — see §6 |
| `order` | integer | **required** | Scoped per year — see §4 |
| `published` | boolean | **required** | All 28 `true` |
| `image` | string \| null | optional | 25 have one, 3 are null |
| `image_position` | string \| null | optional | CSS position; 5 records use it |
| `image_fit` | `"contain"` \| null | optional | 4 records |
| `image_background` | `"#rrggbb"` \| null | optional | 1 record (`#001f62`) |
| `extra_images` | list of paths | optional | 25 empty, 2 one, 1 two |
| `signups_closed` | boolean | **required** | 8 closed |
| `link` | object \| null | optional | 17 null, 9 event, 2 external |
| `en` / `pl` | object | **required** | `title`, `subtitle`, `body`, optional `link_label` |

`en.link_label` / `pl.link_label` appear on exactly the 11 records that have a
link — they are **conditional**, required when a link exists and absent otherwise.

There are no technical discriminator fields to hide: unlike events, an
announcement has no `template` or `event_family`. Every key is editorial or
structural information an editor legitimately owns, so nothing is hidden and
nothing was invented in order to hide it.

## 3. Academic-year behaviour

Identical to Team, and identically boring. `content/settings/academic-year.yaml`
names the current year; the page renders only announcements whose
`academic_year` matches it.

Changing the current year does **not** touch a single announcement record — it
neither rewrites, moves, deletes nor re-years anything. Verified directly: saving
the setting changed one file and no announcement.

There is no rollover button and no bulk copy. Preparing next year is additive:
write the new records, leave the old ones alone, change the setting when the
season starts.

**A future-year announcement is not an unpublished one.** These are separate
ideas and the CMS keeps them separate:

- `academic_year` decides whether a record belongs to the current season or the
  archive.
- `published` decides whether it is public at all.

A `2026/27` announcement with `published: true` is a finished, publishable record
that simply is not this year's. Verified live: a 2026/27 record created while
`current: 2025/26` was in force appeared in neither language and required no
change to the setting.

## 4. Ordering is scoped by year

`order` is unique within **(academic year, published)** — the same scope
`scripts/validate.js` enforces. So this is correct:

```
2025/26   order 1, 2, 3 …
2026/27   order 1, 2, 3 …      ← starts again at 1
```

Next year's first announcement is position 1, not 29. A clash *inside* one year
is a fault and is reported; a repeat *across* years is not. Both directions are
covered by `npm run test:announcement-rules`.

## 5. Record IDs

Same model as Team: the filename **is** the `slug` field
(`slug: "{{fields.slug}}"`), so the validator's slug-equals-filename invariant
holds by construction, and the same three protections apply — the pre-save guard
blocks a duplicate before it is written, `npm run cms:check` names any collision
afterwards, and `npm run validate` fails the build.

The guard now covers **every** folder collection, derived from the configuration
rather than listed, so Announcements were protected the moment the collection
existed. Format is unchanged: `^[a-z0-9]+(-[a-z0-9]+)*$`.

Existing slugs were not touched. For a repeated campaign, give the new year's
record a distinct ID — `spring-careers-evening` then
`spring-careers-evening-2026-27`.

## 6. The publication date — the one real trap

`published_date` is a **date-only** value, and it has two legal spellings on disk.

The canonical files quote it, so YAML yields a string:

```yaml
published_date: "2025-10-26"
```

Decap re-serialises with `yaml`@1, whose YAML 1.2 core schema treats a bare
`2025-10-26` as an ordinary string and writes it **without quotes**. js-yaml —
what the build parses with — still carries YAML 1.1 timestamps and reads that
same line back as a `Date`.

This is not theoretical. Saving one announcement through the CMS produced exactly
that, and the parsed value came back as:

```
Sun Oct 26 2025 02:00:00 GMT+0200
```

Midnight UTC, displayed in Warsaw. Rendered through anything timezone-aware, a
date-only value could show the previous calendar day — precisely the
non-determinism the `isoDate` filter was written to prevent.

**The fix, in one place.** `src/_data/records.js` converts a midnight-UTC `Date`
back to its calendar day using UTC components:

```js
if (dirName === "announcements" && record.published_date instanceof Date) { … }
```

Both spellings then mean one value, and the file is never rewritten to match the
other. Verified end to end: the CMS wrote `published_date: 2025-10-26` unquoted,
the loader returned the string `"2025-10-26"`, and the generated card read
**14 May 2026** for a `2026-05-14` record — the right day, on a Warsaw machine.

**What is still rejected:** a `Date` carrying a real time component.
`2026-05-14T13:45:00Z` is not a calendar day, and no normalisation should quietly
round it. The validator names it:

> publication dates that are not date-only — a time component makes rendering
> timezone-dependent

**Why the field is a plain string, not Decap's `datetime` widget.** The datetime
widget applies a timezone and can hand back either a `Date` or a formatted value.
A pattern-checked string (`^\d{4}-\d{2}-\d{2}$`) cannot shift a calendar day, and
the pattern rejects a timestamp outright. The editor types `2026-05-14`.

## 7. Bilingual editing

One record, two blocks, as before:

```yaml
en:
  title: …
  subtitle: …
  body: |
    Markdown…
  link_label: Read more        # only when there is a link
pl:
  …
```

The form shows **Shared information → English → Polski**, using nested object
widgets. Decap's own i18n is not enabled, no per-language folder or filename can
be produced, and `validate:cms` asserts all of that.

## 8. Markdown safety

Bodies are Markdown, rendered by `markdown-it` with **`html: false`**. That is
the security boundary, it lives in the build, and this phase did not move it:
a stored `<script>` renders as visible text, not as markup.

The CMS side is shaped to match:

- the **Markdown widget**, so what is stored is Markdown, never HTML;
- `editor_components: []` — no HTML block component is offered;
- the toolbar is limited to **bold, italic, link, quote, bulleted and numbered
  list**. There is no code-block or image button, and no raw-HTML control.

`npm run validate:cms` asserts the widget shape *and* re-reads
`eleventy.config.js` to confirm `html: false` is still there and `html: true`
appears nowhere. `npm run test:announcement-rules` additionally renders a stored
`<script>` through the real `markdown-it` and asserts it comes out escaped.

`npm run cms:check` flags any announcement body containing an HTML tag, with an
explanation an editor can act on.

**Round-trip.** Editing one field and saving left both Markdown bodies
**byte-identical** — paragraphs, wording and Polish diacritics intact. The
rich-text editor does not reformat existing prose.

> **A note on the paragraph test.** Under browser automation, a synthetic Enter
> key does not reach Slate, so an automated save can collapse two typed
> paragraphs into one. That is a limitation of the automation, not of the CMS: a
> real `insertParagraph` event — what a person pressing Enter produces — creates
> the second paragraph correctly, which was verified directly. Existing
> multi-paragraph bodies are unaffected either way, as the round-trip above shows.

Body links stay Markdown. They are not extracted into fields, but their protocols
are validated: `javascript:` and other unrecognised schemes are rejected.

## 9. Images

**Main image** — optional. Absent and `null` mean the same thing, exactly as for
Team photographs, and `src/_data/records.js` normalises the two at the load
boundary. A no-image announcement can be created entirely through the CMS with no
hand-editing; verified live, and the card renders the text-only state.

**Uploads** go to `assets/announcements/` and are stored root-relative as
`/assets/announcements/<file>`. External URL insertion is disabled.

**Existing paths may point elsewhere, and that is correct.** Several
announcements reuse event imagery — `/assets/pbf/stage.jpg`,
`/assets/debata/networking.jpg`, `/assets/pbf/sponsors/…`. The rule is therefore
"any real file under `/assets/`", not "must be in `assets/announcements/`";
requiring one folder would have made three real records uneditable.

Rejected, each by its own name: `/pl/assets/…`, a Windows path, an external
hotlink, an empty string, a wrong type, and a path that resolves to nothing.

**Extra images** are an ordered list of plain paths — matching the canonical
records exactly, not restructured into objects. Editors can add, remove and drag
to reorder. Order is preserved: the two-image record still renders
`pcc-gala.jpg` then `pcc-duda.jpg` in both languages after a CMS save.

**Alt text is not stored and is not asked for.** The renderer derives it from the
announcement title (`extraImageAltPattern` with the title and image number), so
there is no alt field to expose and none was invented.

## 10. Image display modes

| Field | Widget | Why |
|---|---|---|
| `image_fit` | **select** — Contain | Finite set (`contain`), drift-checked against `SUPPORTED_FIT` in the validator |
| `image_background` | string, hex pattern | A colour, validated as `#rrggbb`, not arbitrary CSS |
| `image_position` | **free text** | Real records use `center top`, `center 30%`, `center 22%` — no finite list could hold them |

The select shows a human label ("Contain (show the whole image)") and stores the
canonical value (`contain`). `validate:cms` fails if the CMS options and the
validator's set ever diverge.

## 11. Destination links

Three genuinely different things, kept apart:

**A. A Federation event** — stores a **slug**, never a URL:

```yaml
link:
  type: event
  event_slug: icebreaker
```

The select is generated from `content/events/*.yaml`, so the five options are
derived, not hardcoded, and each shows its human title (`Icebreaker`,
`How to Think About Politics in a Polarised World`) while storing the slug.
Titles are assembled the way the event templates assemble them — parts joined
with a **space**, because joining them with `""` is the exact defect that once
produced "Polish Youth Congress2025".

This is why a slug matters: the generated link is **relative** —
`event-icebreaker.html` — which resolves to `/event-icebreaker.html` from the
English page and `/pl/event-icebreaker.html` from the Polish one. One stored
value, correct in both languages. Storing a URL would freeze one language into
the content. Verified: every event link in both generated data files is the bare
relative form, with no absolute path and no `/pl/` prefix anywhere.

**B. An external website** — stores a full address:

```yaml
link:
  type: external
  url: https://example.com/
```

Validated as `^https://[^\s"'<>]+$`. `javascript:`, `data:`, `file:`,
`vbscript:`, plain `http:` and protocol-relative `//…` all fail — this value is
rendered into the page as a button target.

**C. A link inside the body** stays Markdown and is left alone, beyond the
protocol check in §8.

**Both languages need a button label** when a link is set, or the button renders
with no words on it. `cms:check` reports a missing label per language.

### Choosing and changing the destination

The **Link destination** control has three choices, and every one of them is a
positive selection:

```
No link — no button on the card
Federation event
External website
```

Switching between them is the whole point. **Choose the destination you want and
save; whatever is left in the other field is discarded.** An event chosen by
mistake is undone by picking *No link* and saving — nothing has to be cleared by
hand, and no YAML has to be touched.

Decap has no conditional field visibility, so all three controls stay on screen
at once. That is deliberate rather than unfinished: hiding fields would have
needed fragile custom UI, and the hints on each field say which destination uses
it. The form is static; the *stored result* is not ambiguous.

**How it stays clean.** A `preSave` handler reduces the link to exactly one
destination before anything is written:

| You choose | Stored | Removed |
|---|---|---|
| No link | `link: null` | any event slug, any URL |
| Federation event | `type` + `event_slug` | any URL |
| External website | `type` + `url` | any event slug |

An incomplete choice is not a link: *Federation event* with no event selected, or
*External website* with an empty address, both store `link: null` rather than a
half-made destination.

The logic is one pure function, `normaliseAnnouncementLink` in
`src/_data/cmsConfig.js`. The admin page embeds its source verbatim and
`npm run test:announcement-rules` imports the same function, so the tested
behaviour and the shipped behaviour cannot drift.

`No link` is an **editor-only** value. It never reaches a file — it becomes
`link: null`. If a file ever did contain `type: none`, that would mean
normalisation had not run, and both `cms:check` and `npm run validate` reject it
by name rather than quietly accepting it.

**Older records still load correctly.** No migration was needed: an existing
event link opens showing *Federation event* and its title, an external link opens
showing *External website* and its address. A legacy `link: null` record opens
with the destination simply unselected rather than showing *No link* — the two
mean the same thing, and saving either way stores `link: null`.

`cms:check` still rejects the impossible combinations — an event link that also
carries a URL, an external link that also names an event — because a file can
always be edited by hand outside the CMS. Normalisation makes those states
unreachable *through the CMS*; it does not make the check redundant.

## 12. Registration and publication state

| Field | Meaning |
|---|---|
| `signups_closed` | The sign-up is closed. Set deliberately — an announcement does **not** close because its date passed, and nothing infers it. |
| `published` | Whether the record is public at all. Separate from the academic year (§3). |

Both are plain toggles, and both are consistent across the two languages by
construction: one stored flag drives both.

## 13. What the checks cover

| Command | Covers |
|---|---|
| `npm run validate` | The canonical content rules, announcements included |
| `npm run validate:cms` | The CMS configuration — 195 checks |
| `npm run cms:check` | Content integrity in editor language, Team **and** Announcements |
| `npm run test:announcement-rules` | 51 negative controls |

`cms:check` reports, per announcement: record count, missing or malformed Record
IDs, filename/slug disagreement, duplicates, the Decap `-1` collision signature,
malformed or non-consecutive academic years, same-year position clashes, dates
that are not calendar days, every image path, broken event references,
malformed and unsafe link destinations, missing button labels, missing bilingual
fields, HTML in a body, and leftover test records. It never repairs anything.

Example, in its real wording:

```
PROBLEM   event slug "missing-event" does not exist
file      content/announcements/example.yaml
detail    no record in content/events/ has that slug (available: business-forum, …)
do this   Choose an existing Federation event or remove the event link.
```

## 14. Known limitations

1. **No conditional link fields** (§11). Decap does not support field visibility
   rules; the mitigations are hints plus `cms:check`.
2. ~~No clear control on a chosen event.~~ **Fixed in Phase 17B.1** (§11). Decap's
   optional select never showed a clear (×) in practice, so "no link" is now an
   explicit choice in the destination list rather than something an editor has to
   clear. All six destination transitions were exercised through the real UI with
   no YAML editing.
   *Remaining nuance:* a legacy `link: null` record opens with the destination
   unselected rather than showing *No link*. Harmless — both save as `link: null`.
3. **The team-group and link-type selects show stored keys in list summaries** —
   Decap's summary templates support only the `date` and `default` filters, so a
   select value cannot be mapped back to its label there.
4. **A CMS save drops comments and quotes**, as documented in
   `docs/CMS_FOUNDATION.md` §8. For announcements this now includes the quotes
   around `published_date`, which is safe because of §6 — but it does mean a
   saved record's diff is larger than the edit.
5. **Uploads always land in `assets/announcements/`.** An editor cannot choose to
   put a new image in `assets/pbf/`; existing records that point there keep
   working, but new reuse of event imagery needs the file copied or the path set
   by hand.

---

## Editor workflows

### Create an ordinary announcement

1. **Announcements → New announcement.**
2. **Record ID** — lowercase words with hyphens, e.g. `spring-careers-evening`.
3. **Academic year** — this year, e.g. `2025/26`.
4. **Publication date** — `2026-05-14`.
5. **Display position** — 1 is first; use a number no other announcement in this
   year has.
6. **Main image** — optional.
7. **English** and **Polski** — title, summary and body in both.
8. **Publish → Publish now.**
9. Review with `git diff`, then run `npm run cms:check`.

### Create one for next academic year

Exactly the same, but set **Academic year** to `2026/27` and start **Display
position** again at 1. Do not touch Site settings: the record stays invisible
until the Federation is ready, and then the year is changed once, deliberately.

Give it a distinct Record ID if the same campaign already exists —
`spring-careers-evening-2026-27`.

### Link to a Federation event

Set **Link destination** to *Federation event*, choose the event by name, and add
a **Button label** in both languages. Anything left in the external address is
discarded on save. The link keeps the reader's language automatically.

### Link to an external site

Set **Link destination** to *External website*, paste a full `https://` address,
and add a **Button label** in both languages. Anything left in the Federation
event is discarded on save.

### Remove a link you added by mistake

Set **Link destination** to *No link — no button on the card* and save. The event
or address you had chosen is removed for you; you do not need to clear it, and
you never need to edit the file. The card goes back to having no button.

### Change one destination to the other

Just pick the other destination and fill in its field. The previous one is
discarded on save — an event does not linger behind an external address, and vice
versa.

### Create an announcement with no image

Leave **Main image** empty. Nothing else is required, and no YAML needs fixing
afterwards — the card renders in its text-only form.

### Close registrations

Open the announcement and switch **Registration closed** on. Both languages show
the closed state. Do this deliberately; nothing closes on its own.

---

## Files in this phase

| File | | Purpose |
|---|---|---|
| `src/_data/cmsConfig.js` | modified | Announcements collection, event options, enums |
| `src/_data/records.js` | modified | Date normalisation + absent-field normalisation |
| `src/admin/index.njk` | modified | Duplicate guard generalised to every folder collection |
| `scripts/validate.js` | modified | Date-only rule replacing the quoted-string rule |
| `scripts/validate-cms.js` | modified | Announcements configuration assertions |
| `scripts/cms-check.js` | modified | Announcements integrity section |
| `scripts/test-announcement-rules.js` | new | Negative controls — 73 after 17B.1 |
| `docs/CMS_ANNOUNCEMENTS.md` | new | This document |

Phase 17B.1 additionally changed `src/_data/cmsConfig.js` (the destination list
and `normaliseAnnouncementLink`), `src/admin/index.njk` (pre-save normalisation),
`scripts/validate-cms.js` and `scripts/cms-check.js`.

No announcement record, image or `netlify.toml` was changed.
