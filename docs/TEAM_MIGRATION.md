# Team migration (Cleanup Phase 4)

The 2025/26 committee is now **structured content**. Twenty-one YAML files under
`content/team/` replace the hand-written member markup that was duplicated
across `team.html` and `pl/team.html`, and Eleventy generates
`dist/team.html` and `dist/pl/team.html` from them.

**The live site has not changed.** Netlify still publishes the repository root,
so `team.html` and `pl/team.html` at the root are still the pages the public
sees. The generated pages sit in `dist/` awaiting a separate, reviewed cutover.
Every comparison in `scripts/compare-team.js` passes, which is the evidence that
the cutover will be a no-op for visitors.

Related reading: [BUILD_ARCHITECTURE.md](BUILD_ARCHITECTURE.md) (why Eleventy,
how permalinks work), [SHARED_CHROME_MIGRATION.md](SHARED_CHROME_MIGRATION.md)
(the header/nav/footer these pages sit inside),
[ADMIN_SYSTEM_AUDIT.md](ADMIN_SYSTEM_AUDIT.md) (the Decap CMS this schema was
shaped for).

---

## 1. The content-file format

One person, one file: `content/team/<slug>.yaml`. The filename is the slug.

```yaml
# Team member — 2025/26 committee.

slug: example-person
academic_year: "2025/26"
group: trustees
order: 1
published: true

name: "Example Person"
photo: "/assets/team/example-person.jpg"
email: "example.person@polsocfederation.pl"
linkedin: "https://www.linkedin.com/in/example-person/"

en:
  role: "Example Officer"
  photo_alt: "Example Person"

pl:
  role: "Specjalista ds. przykładów"
  photo_alt: "Example Person"
```

Notes on the fields that are not self-explanatory:

- **`academic_year`** is quoted. Unquoted, YAML would happily read `2025/26` as
  a string anyway, but quoting makes the intent explicit and matches the date
  handling elsewhere in the build (see §4 and BUILD_ARCHITECTURE §11).
- **Contact-link accessible names are not stored.** They are built at render
  time from a per-locale pattern in `ui.json` with the member's full `name`
  substituted in. Phase 4 stored them per member to reproduce the live pages
  exactly; Phase 5 fixed the underlying defect and removed the fields. See §15.
- **`photo`** is root-relative (`/assets/…`), never page-relative. A
  page-relative path in shared markup resolves against the *page* URL and breaks
  under `/pl/` — that shipped as a live bug once (CLEANUP_BASELINE §5).

## 2. Shared versus localised fields

Everything above the `en:` block is **invariant**: identical in both languages by
construction, because there is only one copy of it.

| Shared (top level) | Localised (`en:` / `pl:`) |
| --- | --- |
| `slug` | `role` |
| `academic_year` | `photo_alt` |
| `group` | *(any future biography)* |
| `order` | |
| `published` | |
| `name` | |
| `photo` (path or `null`) | |
| `email` | |
| `linkedin` | |

This nesting is not arbitrary — it is Decap CMS's `i18n.structure: single_file`
layout, so the same files become CMS-editable without restructuring (§12).

Strings that belong to the *page* rather than to a person live elsewhere:

- section headings, filter labels and plural forms →
  `content/settings/team-groups.yaml`
- the hero eyebrow, heading and lead → front matter of `src/team.njk`
- link titles, the placeholder label, the filter bar's `aria-label` and the
  aria-label patterns → `src/_data/ui.json` under `<locale>.team`

## 3. Group configuration

`content/settings/team-groups.yaml` is the single source of truth for the six
groups. The **same file feeds both the filter chips and the section headings**,
so they cannot drift apart:

```yaml
groups:
  - key: trustees
    order: 1
    en: { heading: "Trustees", filter_label: "Trustees" }
    pl: { heading: "Powiernicy", filter_label: "Powiernicy" }
```

Note that `heading` and `filter_label` genuinely differ — the live pages say
"Partnerships Officers" as a heading but "Partnerships" on the chip. Both are
preserved.

The file also holds:

- **`all_filter`** — the "Everyone" / "Wszyscy" chip. It is not a group: no
  heading, no members, and its reserved key `all` is what `js/team-filter.js`
  checks for.
- **`plural`** — the member-count forms. English needs two (`1 member` /
  `{n} members`); Polish needs three (`1 osoba` / `4 osoby` / `5 osób`). The
  strings live here; only the selection *rule* lives in code, as the `plural`
  filter in `eleventy.config.js`.

Group order on the page comes from the array order in this file, which the
validator pins to the live pages' order.

## 4. Academic-year handling

`content/settings/academic-year.yaml`:

```yaml
current: "2025/26"
known:
  - "2025/26"
```

The team page renders only members whose `academic_year` equals `current`. That
is the whole mechanism, and it is deliberately boring: adding next year's
committee never requires deleting this year's.

`src/_data/site.json` previously carried a competing `currentAcademicYear` of
`2026/27` left over from Phase 2. It has been removed and the validator now
fails if it comes back. One fact, one place.

## 5. How member ordering works

Two numbers, both explicit:

1. **Group order** — the array position in `team-groups.yaml`.
2. **Member order** — the `order:` field, counted **from 1 within each group**.
   Two members of the same group may not share an `order`; the validator
   rejects it.

`order` is scoped to the group, so `trustees` and `events` both start at 1.

The `teamInGroup` filter sorts by `order`, falling back to a plain slug
comparison. That fallback should never fire — it exists so a mistake produces a
stable page rather than a build whose output changes between runs.

The stagger classes (`reveal`, `reveal-d1`, `reveal-d2`, `reveal-d3`) are
computed from the member's position *within its group*, cycling every four, and
are not stored.

## 6. Adding a team member

1. Drop the headshot in `assets/team/` as `firstname-surname.jpg`, cropped
   chest-up so everyone appears at a similar scale.
2. Create `content/team/firstname-surname.yaml` using the template in §1.
3. Set `group` to one of the six keys and `order` to the next free position in
   that group.
4. Write **both** roles. Do not machine-translate: Polish role titles are
   grammatically gendered ("Specjalista" vs "Specjalistka"), so they must be
   written per person by someone who knows which is correct.
5. `npm run build && npm run validate`.

The passthrough list for headshots is derived from the YAML at build time, so a
new photo is copied into `dist/` automatically — there is no second list to
update.

## 7. Editing a team member

Edit the one file and rebuild. There is no second copy to keep in sync — that
was the point of the migration.

To change someone's *name*, also rename the file and update `slug` (the
validator requires them to match). Renaming the photograph is optional; the
`photo` path is explicit, so it does not have to match the slug.

## 8. Removing a member without deleting history

Set `published: false`. The record stays on disk, out of the page.

Use this when someone steps down mid-year. Do **not** use it for a member whose
term simply ended — that is what the academic year is for (§13), and it keeps
`published` meaningful as "currently serving".

To remove someone permanently — a mistaken entry, or a request to be taken
down — delete the file, and delete the headshot too if it is no longer used.

## 9. A member with no photograph

Set `photo: null` explicitly, and omit `photo_alt` from both language blocks.

The card then renders the placeholder used by the live site:

```html
<div class="ph" data-label="Headshot"></div>   <!-- pl: data-label="Zdjęcie" -->
```

No `<img>` tag, no empty `src`, no placeholder image file. The label is a UI
string in `ui.json`, not member data, so a second member losing their photograph
needs no new copy anywhere.

Measured at all six tested widths, the placeholder card is exactly the same
width as a photo card and its frame exactly the same height, so the grid does
not shift. One current member — Stefan Gayda-Pimlott — is in this state.

## 10. English and Polish role titles

Free text, per person, authored by hand, in both languages. Never derived from
an enum and never machine-translated.

The reason is grammatical gender: Sara Pietrusińska is
"Specjalistka ds. relacji instytucjonalnych" while Bartek Czajkowski is
"Specjalista ds. IT". Both map to the same English word, "Officer". A shared
role enum would get one of them wrong, every time.

The validator enforces that both roles exist and that they are not identical to
each other — an identical pair almost always means one was copied and never
translated.

## 11. How the generated filters work

Markup and behaviour are unchanged from the live pages:

- `<div class="filter-bar reveal" role="group" aria-label="…">`
- `<button class="chip" data-filter="KEY" aria-pressed="…">LABEL</button>`, with
  `all` first, carrying `active` and `aria-pressed="true"` at page load
- one `<div class="team-section" data-group="KEY">` per group

Clicking a chip moves both `.active` and `aria-pressed="true"` to it — from a
single pass, so the visible and announced states cannot drift — and toggles
`.hidden` on every section
whose `data-group` does not match — `all` shows everything. Cards in the newly
shown section replay their reveal animation on a 50 ms stagger.

The logic lives in `src/js/team-filter.js`, copied to `dist/js/team-filter.js`.

**This is the one intentional difference from the live pages**, which each carry
their own inline copy of the same code. Extracting it means one file serves both
languages instead of two copies drifting apart. It contains no display strings —
every visible label is baked into the markup at build time — so it never needs
translating, and it returns immediately on any page without chips or team
sections. `scripts/compare-team.js` asserts this difference explicitly rather
than ignoring it, so it can never quietly become an unnoticed drift.

`js/main.js` is untouched and still loads first.

### Corrected in Phase 5

Phase 4 reproduced the live pages' `role="tablist"` faithfully, which meant
reproducing a defect: a tablist with no tabs, no tabpanels and no
`aria-selected`. Phase 5 replaced it with a labelled `role="group"` of native
buttons carrying `aria-pressed`, on the live pages and the templates together.
See [TEAM_ACCESSIBILITY_REMEDIATION.md](TEAM_ACCESSIBILITY_REMEDIATION.md) §2–3.

## 12. Connecting to Decap CMS

The schema was shaped for Decap and should need no restructuring. A collection
config would be roughly:

```yaml
- name: team
  folder: content/team
  create: true
  slug: "{{fields.slug}}"
  i18n: true            # structure: single_file — matches the en:/pl: nesting
  fields:
    - { name: slug, widget: string, i18n: duplicate }
    - { name: academic_year, widget: string, i18n: duplicate }
    - { name: group, widget: select, options: [trustees, partnerships, events, marketing, legal, regional], i18n: duplicate }
    - { name: order, widget: number, value_type: int, i18n: duplicate }
    - { name: published, widget: boolean, i18n: duplicate }
    - { name: name, widget: string, i18n: duplicate }
    - { name: photo, widget: image, required: false, i18n: duplicate }
    - { name: email, widget: string, i18n: duplicate }
    - { name: linkedin, widget: string, i18n: duplicate }
    - { name: role, widget: string, i18n: true }
    - { name: photo_alt, widget: string, required: false, i18n: true }
```

`i18n: duplicate` on the shared fields is what keeps them invariant: the CMS
shows one input and writes one value.

Two things must be settled before wiring it up:

- **The `group` select must be driven by `team-groups.yaml`**, not by a
  hard-coded options list, or the two definitions will diverge.
- ~~`aria_name_email` / `aria_name_linkedin` need a decision.~~ **Settled in
  Phase 5:** the accessibility defect was fixed, the accessible names are now
  derived from `name`, and both fields have been removed. Nothing to expose.

CMS work is out of scope here; nothing in this phase adds authentication or an
admin route.

## 13. Adding the 2026/27 committee

1. Write the new records with `academic_year: "2026/27"`.
2. Add `"2026/27"` to `known:` in `academic-year.yaml` and set
   `current: "2026/27"`.
3. Leave every 2025/26 record exactly where it is. They stop rendering because
   they no longer match `current` — nothing is deleted.
4. Update the expected counts in `scripts/validate.js` §14 (`CURRENT_YEAR`,
   `EXPECTED_GROUPS`) to describe the new committee.
5. Update the hero copy in `src/team.njk` (`eyebrow`, and the year inside the
   Polish meta description).

Two headshots may collide if a returning member's photograph changes; name the
new file distinctly rather than overwriting, so the old year's page keeps its
own image when archives are eventually shown.

## 14. What remains before previous teams can be shown

Deliberately not built in this phase. Outstanding work:

- **A URL scheme** — likely `/team/2025-26.html`, which needs the sitemap,
  hreflang pairs and a Polish equivalent.
- **A year picker** — plus its labels in `ui.json` in both languages.
- **A canonical decision** — whether the current-year page and the archived page
  for the same year are one URL or two. Two would be duplicate content.
- **Archived-photo retention** — §13's collision note.
- **`known:` becomes load-bearing.** Today it is documentation; the archive
  index would read it, so it would need validating against the years actually
  present in `content/team/`.

The schema already supports all of this. Only the presentation is missing.

## 15. Discrepancies discovered during extraction

Records were generated mechanically from the live pages, and every invariant
field was cross-checked between English and Polish before a single file was
written. Findings:

### A. Polish link aria-labels are in English — a real defect, reproduced not fixed

On `pl/team.html`, all 21 members carry English `aria-label` values:

```html
<a href="mailto:…" title="E-mail" aria-label="Email Szymon">
<a href="https://www.linkedin.com/…" title="LinkedIn" aria-label="Szymon on LinkedIn">
```

`title` **is** translated (`Email` → `E-mail`); `aria-label` was not. Since
`aria-label` overrides the link's accessible name, a Polish screen-reader user
hears English for every one of the 42 links on that page.

This is a genuine pre-existing accessibility bug, not an extraction artefact.
The brief was to report discrepancies rather than silently correct them, so the
generated pages reproduce it exactly — `compare-team.js` would fail otherwise.

**It is staged for a one-line fix.** The patterns live in `src/_data/ui.json` as
`pl.team.emailAriaPattern` and `pl.team.linkedinAriaPattern`. Translating those
two strings fixes all 42 links on the Polish page and nothing else. That change
belongs in a deliberate accessibility phase — together with the `role="tablist"`
issue in §11 — because it will make `compare-team.js` fail by design, and that
failure is the signal the live page needs the same fix.

### B. `data-label` differs by language — correct, not a bug

`Headshot` on the English page, `Zdjęcie` on the Polish one. Treated as a
localised UI string in `ui.json`. Noted only because it is easy to mistake for
an inconsistency.

### C. Photograph paths differ by depth — expected

`assets/team/x.jpg` on the English page, `../assets/team/x.jpg` on the Polish
one. Both resolve to the same file. The generated pages use root-relative
`/assets/team/x.jpg` at both depths, per the Phase 3 convention;
`compare-team.js` normalises depth before comparing.

### D. One unreferenced headshot

`assets/team/michal-kobus.jpg` exists but no current member references it —
presumably a past member. It is **not** copied into `dist/`, because the
passthrough list is derived from the records. The file is left untouched at the
repository root; deleting it is a separate decision, and it may be wanted when
archives arrive (§14).

### E. No genuine EN/PL invariant disagreement

Names, e-mails, LinkedIn URLs, photograph filenames, group membership, member
order and the aria-label strings were compared field by field across both pages.
**Zero mismatches.** Had there been one, extraction would have aborted rather
than picking a side.

---

## Files in this migration

| File | Role |
| --- | --- |
| `content/team/*.yaml` (21) | one canonical record per member |
| `content/settings/academic-year.yaml` | which year renders |
| `content/settings/team-groups.yaml` | groups, headings, filter labels, plurals |
| `src/team.njk` | the page: permalinks, SEO, hero copy |
| `src/_includes/partials/team-filters.njk` | the chip row |
| `src/_includes/partials/team-section.njk` | one group: heading, count, grid |
| `src/_includes/partials/team-card.njk` | one member, with or without a photo |
| `src/js/team-filter.js` | filter behaviour, both languages |
| `src/_data/ui.json` | `<locale>.team` assistive and UI strings |
| `eleventy.config.js` | `teamInGroup`, `revealClass`, `plural`, passthroughs |
| `scripts/compare-team.js` | 120 semantic comparisons against the live pages |
| `scripts/validate.js` | §14 records, §15 generated pages |
