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
venue, images, and the writing in both languages. Nothing needs editing by hand
afterwards, and nothing below the writing is required — gallery, registration,
photo album and social posts are all optional and all start closed.

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

## 11b. Images — one upload, several uses

An event has three image fields, and they all draw from the same folder. That is
what makes reuse work:

| Field | What it is |
|---|---|
| **Main event image** | the event's photograph, shown on the events listing |
| **Sharing image** | what appears when somebody shares the page |
| **Hero image** | leave empty — see below |

**Upload the photograph once.** Use Upload on the main image; the file is saved
to `assets/events`. Then, in the sharing image, choose that *same file* from the
library. Both fields store a path, and two fields are perfectly entitled to store
the same one — nothing is copied and no second file is created.

This is not a new trick. The Christmas Dinner and Business Forum records have
pointed both fields at one photograph since before the CMS existed.

Some events instead use the Federation's own sharing card rather than an event
photo. Either is fine; pick whichever represents the event better.

**Hero image should stay empty.** Standard event pages open with a typographic
heading rather than a photograph, and no template displays this field — every
current event leaves it blank. It remains in the form only so that saving a
record cannot drop the key.

### A limitation worth knowing

The library lists only files sitting directly in `assets/events`. Photographs
from earlier events live in their own folders (`assets/wigilia/`, `assets/yc/`
and so on) and are not offered — the local content service does not look inside
subfolders, and that is its behaviour rather than a setting. For a new event,
upload the photograph and it will be there for every field on that record.

## 12. Date and venue

**Date** is chosen from a calendar. Click the field and pick the day.

**End date** is optional and empty for almost every event — fill it in only for
something that genuinely runs across more than one day. To remove one you added,
use the **Clear** button beside the field; the record then holds no end date at
all, which is what a one-day event should look like.

> Earlier phases used a typed field here, precisely because a date picker applies
> a timezone and on a machine in Warsaw a date-only value can slide to the
> previous day. That risk is real, and it is now handled rather than avoided: the
> picker is configured to work in UTC, with no clock and a fixed year-month-day
> output, so the day stored is the day chosen. Three settings do that work, and
> `npm run validate:cms` asserts all three on every date field — removing any one
> of them silently brings the old bug back.
>
> Clearing a date is also normalised on save: the widget writes an empty value,
> and the CMS stores "no date" in the one form the rest of the repository uses.

**Date, as written** is the wording readers see ("10 February 2026"), in each
language. The two are independent: one is data, one is prose.

**Venue** is bilingual where it needs to be. The venue name and town each have an
English and a Polish form — "Polish Institute and Sikorski Museum" /
"Instytut Polski i Muzeum im. gen. Sikorskiego"; "London" / "Londyn". Where a
venue keeps one name in both languages, write the same text twice rather than
leaving one empty.

## 13. The page an event makes

Every standard event page is laid out the same way, and you cannot reorder it:

```
Header          title, eyebrow, date, venue, the key facts
Main body       the writing — paragraphs, links, quotes, sub-headings, photos
Gallery         a group of event photographs, if there are any
Registration    the sign-up panel, if sign-ups are set up
Photo album     the link to the full album, if there is one
Social          Instagram, Facebook or LinkedIn posts about the event
Navigation      the way back to the events listing
```

**This replaced the old "sections" system**, where a page was assembled from a
list of blocks and the same list had to be repeated three times — once for the
structure, once for English, once for Polish — matched by position. Getting them
out of step was easy and the consequences were quiet: a photograph could end up
carrying the description of the one before it. There is nothing left to keep in
step, so that class of mistake is gone.

Two pages changed as a result. The Sikorski Debate and the Youth Congress used to
open with a gallery above the writing; their galleries now sit below it, like
every other event.

### Main body

One box per language, with a small toolbar. It handles everything the writing
needs:

| Button | What it does |
|---|---|
| **B** / *I* | bold and italic |
| Link | a link — `https://` addresses only |
| Heading | a sub-heading inside the writing |
| Quote | a highlighted statement, set apart from the text |
| Lists | bulleted or numbered |
| Image | a photograph placed between paragraphs |

The two language boxes are independent. Write the English, switch to Polski with
the tabs at the top of the block, and write the Polish. Neither is derived from
the other and neither is required to match the other's structure.

### Advanced

Underneath each language's fields there is a closed **Advanced** drawer holding
the wording overrides — a different summary for the card, a different title for
the homepage timeline, custom search and sharing text. Every one of them falls
back to the **Summary** you have already written, so an ordinary event needs
none of them and the drawer can stay shut.

The four existing events do use them, and their wording still wins. Opening the
drawer shows you what they say.

## 14. Galleries

A gallery is one optional block: a heading, a small label above it, and a list of
photographs. It is **closed by default** on the form — most events have none.

Each photograph carries **its own description, in both languages**, right beside
the picture it belongs to. Nothing is matched by position any more, so a
photograph cannot inherit the wrong description.

**Full width** puts a photograph across both columns of the grid. Use it for a
wide shot.

Galleries are optional. The Icebreaker has none, and that is a valid event.

A photograph that belongs in the flow of the writing — one you want a paragraph
either side of — goes in **Main body** instead. The gallery is for a genuine
group of event pictures.

## 15. Images

| Field | Used for |
|---|---|
| Card image | The events listing |
| Social sharing image | Link previews on social media |
| Hero image | Optional; none of the current events use one |
| Gallery images | In the gallery, or in the main body |
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
- The **order of the page**. It is fixed for every event, on purpose.

## 21. Known limitations

1. **The page order cannot be changed.** That is the point — every event now reads
   the same way — but it does mean a page that genuinely wanted its gallery first
   cannot have it. Two pages were reordered when this came in.
2. **The main body is Markdown underneath.** The toolbar covers everything the
   writing needs, but a paste from Word may bring formatting the editor drops.
   Check the result before saving.
3. **`title_tail` is rarely needed.** Only the Christmas Dinner uses it. It exists
   because that title has the highlighted word in the middle.
4. **Registration has never run for real.** All four events store `state: none`.
   The panel, the states and the dates are all implemented and tested, but no
   Federation event has yet opened sign-ups through the site.
5. **An announcement's preview of an event's registration is read when you open
   it.** If somebody changes that event in another tab while you are looking, the
   preview will not notice. What the site publishes always comes from the event's
   own record at build time.
6. Business Forum editing is out of scope until Phase 17C-b.

## Commands

| Command | Does |
|---|---|
| `npm run cms:dev` | **Start the CMS** — see `docs/CMS_FOUNDATION.md` §3 |
| `npm run cms:smoke` | Check a running CMS and say what is broken |
| `npm run cms:check` | Content integrity, in editor language |
| `npm run test:event-rules` | Title spacing, registration, media, link and date rules |
| `npm run test:event-content` | Proves no words, links or photographs were lost in the rebuild |
| `npm run validate` | The full repository validator |

## Files in this phase

| File | | Purpose |
|---|---|---|
| `src/_data/cmsConfig.js` | modified | Events collection, guards, event options |
| `src/_data/records.js` | modified | Event date normalisation |
| `src/_data/registration.js` | modified | Which registration an announcement renders |
| `src/admin/index.njk` | modified | Guards and enhancers wired into the admin page |
| `src/admin/advanced-drawer.js` | new | The collapsed wording overrides, one per language |
| `src/admin/registration-ux.js` | new | The Registration block, one question at a time |
| `src/admin/image-units.js` | modified | The photo album, closed by default |
| `src/admin/form-sections.js` | modified | Gallery section; the locale plan retired |
| `src/_includes/partials/event/body.njk` | new | The main body |
| `src/_includes/partials/event/gallery-fixed.njk` | new | The gallery region |
| `scripts/migrate-event-body.js` | new | The one-off section → body + gallery migration |
| `scripts/test-event-content.js` | new | Proves nothing was lost in the rebuild |
| `scripts/cms-check.js` | modified | Standard Events integrity section |
| `scripts/validate-cms.js` | modified | Events configuration assertions |
| `scripts/test-event-rules.js` | modified | Title, registration, year, media and link rules |
| `docs/CMS_EVENTS.md` | modified | This document |

The four standard event records WERE rewritten by `scripts/migrate-event-body.js`:
their `sections` arrays became a `body` per language plus an optional `gallery`.
`npm run test:event-content` proves that every paragraph, link, photograph,
description and heading on the live pages is still on the generated ones. The
Polish Business Forum record was not touched.
