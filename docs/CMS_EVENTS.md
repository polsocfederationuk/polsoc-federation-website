# Events in the CMS (Phase 17C-a)

Editing the Federation's **standard events** — the Sikorski Debate, the Christmas
Dinner, the Youth Congress and the Icebreaker.

The **Polish Business Forum is not here.** It has its own page design, its own
bespoke content and its own editor, which arrives in Phase 17C-b.

---

## 1. What a standard event is

An event with the ordinary Federation page layout: a title, a date, a venue, some
paragraphs, optionally a photo gallery, and links to Instagram or an album. Four
of them exist today, all for 2025/26.

Every standard event record carries two fields that decide *how* it is rendered:

```yaml
event_family: standard
template: standard
```

You will never see or type these. They are set for you, and they are what keeps a
standard event from being rendered with the wrong page design.

## 2. Why the Polish Business Forum is separate

The Forum is not a bigger version of a standard event — it is a different page
with different content: statistics, partner tiers, a Forum Ball, project leaders,
performers, story galleries. Its record uses:

```yaml
event_family: polish-business-forum
template: business-forum
```

The Events collection is **filtered** to `event_family: standard`, so the Forum
record does not appear in it and cannot be opened through it. New events created
here are always standard, because the family is a fixed hidden value. There is no
control anywhere in this form that can turn one into the other.

## 3. Creating an event

**Events → New event.** Fill in the Record ID, academic year, date, position,
venue, images, both languages, and the section lists. Nothing needs editing by
hand afterwards.

## 4. Record IDs

The **Record ID — must be unique** field becomes the filename. Lowercase letters,
numbers and single hyphens.

```
christmas-dinner
sikorski-debate
```

## 5. Recurring annual events

A recurring event gets a **new record each year**. The old one stays exactly as it
is — that is what keeps the archive honest.

```
Annual Christmas Dinner 2025/26
Record ID: christmas-dinner

Annual Christmas Dinner 2026/27
Record ID: christmas-dinner-2026-27
```

The 2025/26 record is not touched, renamed or re-dated. Never change the academic
year on a past event to reuse it; that erases that year from the site's history.

If you type an ID that already exists, the save is blocked with a message
suggesting a year-qualified ID. Nothing is overwritten.

## 6. Academic years

Every event belongs to one academic year, in the form `2025/26`. Which year the
site treats as *current* is set once, in **Site settings**.

Creating a 2026/27 event does **not** change the current year and does not make
that event current.

### Publishing and the current year

While the site's current academic year is **2025/26**:

| Event | Published | |
|---|---|---|
| 2025/26 | on | ✓ allowed |
| 2024/25 (a past year) | on | ✓ allowed |
| 2026/27 | **off** | ✓ allowed — this is how you prepare next season |
| 2026/27 | on | ✗ **the CMS refuses to save it** |

After the current year is changed to **2026/27**, that last row becomes allowed
and you can publish those records.

The rule is *later than current*, not *equal to current*: past years publish
freely, and a future year is blocked only while it is still in the future.

**Why the CMS refuses it.** The events listing cannot group an event into a
season that has not started, and it treats that as a fatal build error — which
also stops `npm run cms:serve`, so an editor who saved such a record could not
reopen the CMS to undo it. The CMS therefore checks before writing anything:

```
Cannot publish this event yet.

This event belongs to 2026/27, but the website's current academic year is
still 2025/26.

You can save the event now with "Published" switched off.

When the Federation changes the current academic year to 2026/27, you can
return to this event and publish it.

The event has not been saved.
```

Nothing is written, and the switch is not flipped for you — saving it
unpublished is your decision to make.

**Changing an event's academic year never changes the site's current academic
year.** That happens only in **Site settings**, deliberately, once per season.

## 7. Ordering

**Display position** is scoped to the academic year. Positions restart at 1 each
year, so 2026/27 having a position 1 while 2025/26 also has one is correct. Two
published events in the *same* year may not share a position.

## 8. Bilingual content

One record holds both languages, in an **English** and a **Polski** section. There
is no separate Polish file and no separate Polish event.

## 9. Editing the title

The title is stored in up to three parts, and this matters:

| Field | Christmas Dinner | Youth Congress | Icebreaker |
|---|---|---|---|
| Title — before highlighted part | `Annual` | `Polish Youth Congress` | `Icebreaker` |
| Highlighted part of title | `Christmas` | `2025` | *(empty)* |
| Title — after highlighted part | `Dinner` | *(empty)* | *(empty)* |

The page joins them with single spaces and wraps the highlighted part in the
accent style. **Do not add spaces yourself** — the parts are joined for you, and a
trailing space in a field becomes a doubled space on the page.

Leaving the highlighted part empty is fine: Icebreaker does exactly that, and the
page renders `Icebreaker` with no stray space and no empty styling.

> This is not fussiness. Joining these parts without spaces once shipped
> "Polish Youth Congress2025" and "AnnualChristmasDinner" to the live site.
> `npm run test:event-rules` renders the real page template against every title
> and asserts those exact strings can never come back.

## 10. Cards

The events listing shows a card per event, built from **Card image**, **Card image
description**, the title and **Summary on the events-listing card**. There is no
separate card title — it is derived from the event title, deliberately, so the two
cannot drift apart.

## 11. Homepage timeline

The homepage shows a condensed timeline. **Short title for the homepage timeline**
is the concise label it uses — usually shorter than the full title
("Christmas Dinner at Ognisko", not "Annual Christmas Dinner"). **Show on the
homepage timeline** controls whether the event appears there at all.

That short title is also what the CMS shows in the events list, so each record is
recognisable at a glance.

## 12. Date and venue

**Date** is a calendar day, typed as `2026-02-10`. Year, month, day — no time.

> It is a plain validated field rather than a date picker on purpose. A picker
> applies a timezone, and on a machine in Warsaw a date-only value can slide to
> the previous day. A typed calendar day cannot.

**Date, as written** is the wording readers see ("10 February 2026"), in each
language. The two are independent: one is data, one is prose.

**Venue** is bilingual where it needs to be. The venue name and town each have an
English and a Polish form — "Polish Institute and Sikorski Museum" /
"Instytut Polski i Muzeum im. gen. Sikorskiego"; "London" / "Londyn". Where a
venue keeps one name in both languages, write the same text twice rather than
leaving one empty.

## 13. Sections — the two levels of editing

An event's body is built from **sections**: paragraphs, headings, photo galleries,
an album link, an Instagram post.

Sections are stored in **three lists that must stay in step**:

```
Section structure    the type of each section, its layout, gallery image files
English sections     the English paragraphs, headings, image descriptions
Polski sections      the Polish equivalents
```

They are matched **by position**: section 3 of the structure is described by
section 3 of English and section 3 of Polish.

### Ordinary editing — safe

Changing the **words inside** an existing section. Rewrite a paragraph, fix a
heading, correct an image description. Nothing structural changes, and it saves
normally.

### Structural editing — advanced

**Adding, removing or reordering** sections. The same change must be made in all
three lists. The CMS does **not** do this for you.

If the lists stop matching, the save is refused with a message naming the
problem — for example:

```
Event sections are out of alignment.

Shared sections: 3
English sections: 3
Polish sections: 2

Polish is missing section 3.
```

or, when the order differs:

```
Section 3:
Shared structure: gallery
English structure: gallery
Polish structure: prose
```

**Nothing is repaired automatically.** No section is inserted, deleted or
reordered for you, and English is never copied into Polish. Refusing the save
loses nothing — your work is still on screen. Guessing would either invent
content or throw some away.

## 14. Galleries

A gallery's **images** live in Section structure; each image's **description**
lives in the English and Polish lists, in the same order.

The counts must match: one description per image, per language. If they do not,
the save is refused — otherwise a photograph would silently lose its description
for screen-reader users.

Galleries are optional. The Icebreaker has none, and that is a valid event.
Nothing forces you to add one.

## 15. Images

| Field | Used for |
|---|---|
| Card image | The events listing |
| Social sharing image | Link previews on social media |
| Hero image | Optional; none of the current events use one |
| Gallery images | Inside a gallery section |
| Co-organiser logos | Beside partner names |

New uploads go to `assets/events/`. Existing events keep their images where they
already are — several live in event-specific folders like `assets/wigilia/` and
`assets/yc/`, and **nothing was moved**. Any `/assets/…` path that resolves to a
real file is valid.

Rejected: `/pl/assets/…` (breaks the Polish page), paths from your own computer,
and images hotlinked from other sites.

## 16. Links

**Instagram post** and **Photo album link** are optional; an event with neither is
perfectly valid. Both must be full `https://` addresses. `javascript:`, `data:`,
`file:` and `vbscript:` are rejected — these values are rendered into the page.

## 17. Co-organisers

A list of partner organisations, each with a logo and its name **in both
languages**. Only the Youth Congress uses this today (the Polish Embassy and
Ognisko Polskie). Leave it empty when there are none.

## 18. Publication and visibility

Four separate ideas — they are not interchangeable:

| Control | Means |
|---|---|
| **Academic year** | Which season the event belongs to |
| **Published** | Whether the record is public at all |
| **Show in the events listing** | Whether it appears on /events.html |
| **Show on the homepage timeline** | Whether it appears on the homepage |
| **Keep in the season archive** | Whether past editions stay reachable |

A future-year event may be published and still invisible, because the site is not
showing that year yet. An event is never published automatically because its date
arrived, and publishing one never changes the current academic year.

**Flagship** marks the Federation's headline event of the year. All four current
events are not flagship.

## 19. Preparing next season

1. Create the new edition with a **new Record ID** and `academic_year: 2026/27`,
   and turn **Published off**.
2. Fill it in. It renders nowhere — the site is still on 2025/26.
3. When the season starts, change the current year once in **Site settings**,
   then publish the new editions.

Turning Published on *before* the year moves is refused by the CMS (§6), so the
build cannot be broken that way. `npm run cms:check` reports the same state if a
file is edited by hand outside the CMS.

Old editions stay on disk, unchanged, and remain reachable through the archive.

## 20. What not to change

- The **Record ID** of an existing event — it is the filename and the page address.
- The **academic year** of a past event — create a new record instead.
- The structure of a section list unless you change all three together.
- Anything you do not recognise in **Section structure** — the spacing values are
  layout, not content.

## 21. Known limitations

1. **The three section lists are not linked.** Decap cannot keep parallel lists in
   step, so structural changes must be made three times. The guard makes a
   mistake impossible to save, not impossible to make.
2. **Section content and structure are edited in different places.** A paragraph's
   text is under English/Polski; its position and spacing are under Section
   structure. That follows the stored schema, which this phase deliberately did
   not migrate.
3. **`title_tail` is rarely needed.** Only the Christmas Dinner uses it. It exists
   because that title has the highlighted word in the middle.
4. **Gallery image order lives in Section structure.** Reordering images there
   means reordering both description lists to match.
5. **Registration is inert.** All four events store `state: none`; the Federation
   has never run registration through the site. The field is exposed but untested
   against a real open registration.
6. Business Forum editing is out of scope until Phase 17C-b.

## Commands

| Command | Does |
|---|---|
| `npm run cms:proxy` | Start the local proxy (terminal 1) |
| `npm run cms:serve` | Build with `/admin/` and serve (terminal 2) |
| `npm run cms:check` | Content integrity, in editor language |
| `npm run test:event-rules` | Title spacing, section alignment, media and link rules |
| `npm run validate` | The full repository validator |

## Files in this phase

| File | | Purpose |
|---|---|---|
| `src/_data/cmsConfig.js` | modified | Events collection, section guard, event options |
| `src/_data/records.js` | modified | Event date normalisation |
| `src/admin/index.njk` | modified | Section-alignment guard wired into pre-save |
| `scripts/cms-check.js` | modified | Standard Events integrity section |
| `scripts/validate-cms.js` | modified | Events configuration assertions |
| `scripts/test-event-rules.js` | new | Title, alignment, year, media and link rules |
| `docs/CMS_EVENTS.md` | new | This document |

No canonical event YAML was changed, and the Polish Business Forum record was not
touched.
