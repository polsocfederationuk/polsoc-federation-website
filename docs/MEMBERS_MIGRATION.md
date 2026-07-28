# Member societies migration (Cleanup Phase 8)

The 30 member societies are now **structured content**. Thirty YAML files under
`content/societies/` replace the two hand-maintained JavaScript arrays, and
Eleventy generates `dist/members.html`, `dist/pl/members.html` and their data
files from them.

**The live site has not changed.** Netlify still publishes the repository root,
so `members.html`, `pl/members.html` and both `js/…/societies-data.js` files are
still what the public sees. Every comparison in `scripts/compare-members.js`
passes, which is the evidence that the eventual cutover will be a no-op.

Related reading: [BUILD_ARCHITECTURE.md](BUILD_ARCHITECTURE.md),
[SHARED_CHROME_MIGRATION.md](SHARED_CHROME_MIGRATION.md),
[TEAM_MIGRATION.md](TEAM_MIGRATION.md),
[ANNOUNCEMENTS_MIGRATION.md](ANNOUNCEMENTS_MIGRATION.md),
[ADMIN_SYSTEM_AUDIT.md](ADMIN_SYSTEM_AUDIT.md).

---

## 1. The canonical society schema

One society, one file: `content/societies/<slug>.yaml`. The filename is the slug.

```yaml
# Member society.
#
# active / member / past_member are DATA ONLY — they describe the society's
# relationship with the Federation and are deliberately not shown on the page.

slug: riverbridge-polish-society
order: 7
published: true

name: "Riverbridge University Polish Society"
latitude: 52.4014
longitude: -1.5085
instagram: "riverbridgepolsoc"
email: "polsoc@riverbridge.ac.uk"
logo: "riverbridge.jpg"

active: true
member: false
past_member: true

en:
  university_location: "Riverbridge, England"

pl:
  university_location: "Riverbridge, Anglia"
```

*(Fictional. No real society carries this name or slug.)*

## 2. Shared and localised fields

Everything above the `en:` block is **invariant** — identical in both languages
because there is only one copy of it.

| Shared (top level) | Localised (`en:` / `pl:`) |
| --- | --- |
| `slug` | `university_location` |
| `order` | |
| `published` | |
| `name` | |
| `latitude`, `longitude` | |
| `instagram` | |
| `email` (may be `""`) | |
| `logo` | |
| `active`, `member`, `past_member` | |

**`university_location` is the only localised field**, and extraction confirmed
it genuinely differs in all 30 records ("Aberdeen, Scotland" / "Aberdeen,
Szkocja"). The comparison script fails if any pair becomes identical, because
that would mean a locale lookup silently fell back.

**Logo alt text is not stored.** The live renderer emits `alt=""` on every
society logo — they are decorative, sitting next to the society's name as text.
That is reproduced exactly; inventing alt text would add noise for screen-reader
users who already hear the name.

Interface strings — "Email"/"E-mail", "Instagram", and the two aria-label
patterns — live in `src/_data/ui.json` under `<locale>.members`, not in any
society file.

## 3. Why societies are not assigned to an academic year

Team members and announcements belong to one committee year. **A society does
not.** Cardiff Polish Society is the same organisation across many years; its
coordinates, Instagram handle and logo outlive any one committee.

So the model here is deliberately different:

- **Society identity is permanent.** One record per society, forever.
- **`active`, `member` and `past_member` describe its current or historical
  relationship with the Federation** (§9), and are edited in place.
- **No annual snapshot exists**, because the current data contains none. The
  live arrays record only a present-tense status, and inventing a year-by-year
  membership history would be fabricating data the Federation never captured.

If the Federation later wants real history, the honest addition is a separate
membership-history collection (or a list of `{year, status}` entries on the
record) populated from actual records — not back-filled from today's flags.

## 4. Ordering rules

`order` is an explicit integer, unique across the published set. The generated
data file is sorted by it and by nothing else — never filesystem order, never
filename order, never JavaScript object order.

**The page then sorts the cards alphabetically by name**, because that is what
the live page does (`localeCompare(…, "en")`) so the index below the map reads
like an index. That sort lives in `src/js/members-page.js`, where the
presentation decision belongs; the data file keeps canonical order.

The two currently coincide — the live array is already alphabetical — but they
are kept separate on purpose. If a future editor wants a non-alphabetical
canonical order (say, by region), `order` can change without touching the
page's presentation, and vice versa.

The validator enforces uniqueness; a slug comparison exists as a tie-break so a
mistake yields a stable page rather than output that changes between builds.

## 5. Logo-path rules

Records store a **bare filename**:

```yaml
logo: "riverbridge.jpg"
```

The build prefixes it to produce a **root-relative** URL:

```text
/assets/polsocs/riverbridge.jpg
```

Storing the bare name means a page-relative path can never slip into a record.
The root-relative output is what stops the Polish page requesting
`/pl/assets/polsocs/…` — a class of bug this site actually shipped once
(CLEANUP_BASELINE §5). Both the validator and the comparison script fail if any
generated logo path is not root-relative, and again if any resolves under `/pl/`.

Nothing was renamed, moved, re-encoded or optimised. The passthrough list is
derived from the records, so only referenced logos are copied into `dist/` and
unreferenced files in `assets/polsocs/` are left untouched.

## 6. Coordinate storage

`latitude` and `longitude` are plain YAML numbers, at the precision the live
data uses (four decimal places, ≈11 m). They are never strings and never
rounded by the build — the comparison asserts numeric identity, because a
rounded latitude silently moves a pin.

The validator range-checks them (-90..90, -180..180), which catches a
transposed pair or a stray digit.

## 7. Instagram handle storage and URL construction

Records store the **bare handle** — no `@`, no URL:

```yaml
instagram: "riverbridgepolsoc"
```

The renderer builds `https://www.instagram.com/<handle>/`, exactly as the live
page does. Storing bare handles means the URL shape is defined in one place; if
Instagram ever changed it, one line in `members-page.js` would follow.

Links open in a new tab with `target="_blank" rel="noopener"`, preserved from
the live pages. The validator rejects a handle containing `@`, a slash or a
protocol.

## 8. Empty-email handling

Three societies publish no e-mail address. That is a real state, not missing
data, and it is stored as an **empty string**:

```yaml
email: ""   # no public address — the card omits the e-mail control
```

The key must be present; the validator fails if it is absent, so "no address"
is always a deliberate statement rather than a forgotten field.

When `email` is empty the renderer emits **no e-mail control at all** — no
`<a href="mailto:">`, no disabled icon, nothing. A link to `mailto:` with
nothing after it is a broken control, and both the validator and the comparison
check that none is produced. The three societies are City, Essex and Leicester;
the count is pinned at 3 so losing or inventing one fails the build.

## 9. `active`, `member` and `past_member`

Three independent booleans on every record:

| Field | Meaning |
| --- | --- |
| `active` | The society itself is currently operating. One record is `false`. |
| `member` | It is a current member of the Federation. Three records are `true`. |
| `past_member` | It has been a member at some point. Thirteen records are `true`. |

They are independent, not a state machine: a society can be active but not a
member, or a past member that is still active. The counts (1 / 3 / 13) are
pinned in the validator against the live arrays.

## 10. Why those fields stay hidden

They were once rendered as membership chips on the society cards. **Those chips
were deliberately removed from the design** in earlier work, and this migration
must not bring them back.

So the data travels and the badges do not. `members-page.js` reads the records
but renders nothing from these three fields, and **three separate checks guard
that**: the validator fails if status-chip classes appear in the generated HTML,
the comparison fails if they appear on either side, and the in-browser audit
asserts no card's text contains a status word.

They are kept rather than dropped because they are genuine information the
Federation holds, and a future admin interface will want to filter on them even
if the public page never shows them.

## 11. Generated data strategy

Two data files plus one shared renderer:

```text
dist/js/societies-data-en.js
dist/js/societies-data-pl.js
dist/js/members-page.js
```

Per-locale rather than one bilingual file, because a shared file would ship all
30 Polish location strings to English readers and vice versa. The cost is two
outputs instead of one, which is free: both come from the same records through
the same `societiesFor` filter, so only `uni` can differ and the comparison
script asserts exactly that.

Both files are generated, never edited. They carry the invariants, the
canonical order, the empty e-mails and the hidden status fields.

## 12. Map initialisation and marker behaviour

Reproduced from the live inline script without behavioural change:

- `L.map("map", { scrollWheelZoom: false, maxBoundsViscosity: 1, zoomSnap: 0 })`
  — `zoomSnap: 0` lets `fitBounds` land on a fractional zoom so the UK fills the
  frame instead of being floored to the next integer zoom.
- CARTO `light_all` tiles, `maxZoom: 19`, with the OpenStreetMap + CARTO
  attribution string unchanged.
- The view is locked to the UK: fit `[49.7, -8.8] … [59.6, 2.0]`, then set that
  zoom as the floor and `maxBounds` to the padded box. A `resize` handler
  re-derives the floor when the container changes size, keeping the centre.
- Pins are a `divIcon` (`.soc-pin`, 26×26, anchored bottom-centre).
- Each society gets a marker with a popup: logo, name, location, then the same
  e-mail/Instagram links as the card.
- **Card → map:** clicking a card scrolls the map into view and flies to the pin
  at zoom 15, then opens its popup. A `prefers-reduced-motion` branch jumps
  instead of animating, and a 1400 ms safety net jumps if the fly animation
  cannot run (background tab, stalled rAF). All preserved.
- Scroll-wheel zoom stays disabled until the user clicks the map, so the page
  does not trap scrolling.

**Leaflet is treated as optional.** If the CDN is blocked the script skips all
map work and still renders the 30 cards, rather than throwing on `L`. Verified
by loading the renderer with Leaflet absent: cards rendered, no uncaught error.

## 13. FAQ source and behaviour

The four questions live in the `copy` block of `src/members.njk`, per locale.
One template renders both pages, so each string is written exactly once — there
is no duplication to centralise further, and no second template to drift from.

Markup is unchanged: four `<details class="acc">` with a `<summary>` and an
`.acc-body`. **No `open` attribute**, so all four start collapsed. The accordion
is native `<details>` behaviour — no JavaScript is involved, on the live pages
or the generated ones.

Answers contain inline links (the contact page, a `mailto:`), so they are
rendered with `| safe`. That is sound here because this is author-controlled
page copy in a template, not editor input — unlike announcement bodies, which
are Markdown with raw HTML disabled. The comparison checks every answer's link
destinations, so a lost or altered link fails.

## 14. Adding a society

1. Put the logo in `assets/polsocs/` (e.g. `riverbridge.jpg`).
2. Create `content/societies/riverbridge-polish-society.yaml` from §1.
3. Give it the next free `order`.
4. Write **both** location lines. Do not machine-translate — these are place
   names with established Polish forms ("Szkocja", "Anglia", "Londyn").
5. Set `active`, `member` and `past_member` honestly (§9).
6. `npm run build && npm run validate`.

The logo is copied into `dist/` automatically — the passthrough list is derived
from the records.

Note that the validator pins the expected counts (30 societies, 3 empty e-mails,
1 inactive, 3 members, 13 past members). **Adding a society is expected to fail
validation until those constants are updated** — that is deliberate, so the
counts are a conscious decision rather than something that drifts.

## 15. Editing a society

Edit the one file and rebuild. There is no second copy to keep in sync.

Changing the slug means renaming the file too; the validator requires them to
match. The logo filename is independent of the slug and need not change.

## 16. Deactivating a society without deleting it

Set `active: false`. The record stays, the pin stays, the card stays — the flag
simply records that the society is not currently operating. One society is in
this state today.

Use `published: false` for something different: taking the society off the page
entirely (a duplicate entry, or a takedown request) while keeping the record.

Delete the file only to remove a society permanently, and delete its logo too if
nothing else references it.

## 17. Recording current or previous Federation membership

```yaml
member: true          # currently a member
past_member: true     # has been a member at some point
```

Both can be true. When a society joins, set `member: true`; when it leaves, set
`member: false` and `past_member: true`. Nothing is deleted, and the same record
carries its whole relationship.

There is no per-year history — see §3 for why, and for what adding real history
would take.

## 18. Decap CMS

The schema was shaped for Decap and should need no restructuring:

```yaml
- name: societies
  folder: content/societies
  create: true
  slug: "{{fields.slug}}"
  i18n: true            # structure: single_file — matches the en:/pl: nesting
  fields:
    - { name: slug, widget: string, i18n: duplicate }
    - { name: order, widget: number, value_type: int, i18n: duplicate }
    - { name: published, widget: boolean, i18n: duplicate }
    - { name: name, widget: string, i18n: duplicate }
    - { name: latitude, widget: number, value_type: float, i18n: duplicate }
    - { name: longitude, widget: number, value_type: float, i18n: duplicate }
    - { name: instagram, widget: string, i18n: duplicate }
    - { name: email, widget: string, required: false, i18n: duplicate }
    - { name: logo, widget: image, i18n: duplicate }
    - { name: active, widget: boolean, i18n: duplicate }
    - { name: member, widget: boolean, i18n: duplicate }
    - { name: past_member, widget: boolean, i18n: duplicate }
    - { name: university_location, widget: string, i18n: true }
```

`i18n: duplicate` on the shared fields is what keeps them invariant.

Three things to settle first:

- **`email` must accept an empty string**, not silently become `null` when
  cleared. Decap's `required: false` writes an empty string for a `string`
  widget, which is what the schema expects — worth asserting after wiring it up.
- **The `image` widget writes a path, not a bare filename.** It needs
  `media_folder`/`public_folder` configured for `assets/polsocs/` so the stored
  value stays a bare name, or the filter needs to tolerate both.
- **A map widget would be a real improvement** over two numeric inputs, but no
  first-party Decap widget exists; picking coordinates by hand from a map and
  pasting them is the honest interim.

## 19. Discrepancies found during extraction

Records were generated mechanically from the two live arrays, with every
invariant cross-checked between languages before a single file was written.

### A. No invariant disagreements

Record count, order, name, latitude, longitude, Instagram handle, e-mail, logo
filename, `active`, `member` and `pastMember` were compared field by field
across all 30 pairs. **Zero mismatches.** Extraction was set to abort and write
nothing on any disagreement; it did not fire.

### B. `uni` differs in all 30 records — as it should

The university/location line is the only localised field, and it is genuinely
translated in every record. No society was left with English location text on
the Polish page.

### C. The live array order is already alphabetical

`order` therefore equals the alphabetical position today. They are still kept as
separate concepts (§4).

### D. Logo paths become root-relative — a deliberate improvement

The live pages build `assets/polsocs/…` (English) and `../assets/polsocs/…`
(Polish) as page-relative strings inside their inline scripts. The generated
pages use `/assets/polsocs/…` on both. Same file, one string, and the Polish
page can no longer ask for `/pl/assets/polsocs/…`. The comparison normalises
path depth before comparing, and asserts the root-relative form separately.

### E. Polish aria-labels were already correct

Unlike the team page — where Phase 5 had to fix English aria-labels on the
Polish page — the society cards were already properly localised
("Napisz e-mail: {name}", "{name} na Instagramie"). Nothing to fix; the strings
moved into `ui.json` verbatim.

## 20. Remaining limitations before cutover

- **The map has no keyboard path to a society.** Pins are reachable only by
  mouse; the cards below are the accessible route. That matches the live page
  and is not a regression, but a keyboard-operable pin list would be a genuine
  improvement.
- **Popups are built with `innerHTML`.** The values are escaped through the same
  `attr()` helper the live page uses, and society data is not editor-supplied
  free text, but a future CMS makes this worth revisiting.
- **Cards and pins are rendered client-side**, so with JavaScript disabled the
  page shows its heading, an empty map container and no society list — exactly
  as the live page does today. Server-rendering the cards would be a real
  improvement and deliberately out of scope: it would change the served HTML and
  break the equivalence this phase exists to prove.
- **Leaflet is loaded from unpkg with SRI.** The version, URLs and integrity
  hashes are unchanged. If the CDN is unavailable the cards still render (§12),
  but the map does not — that is inherent to the current dependency choice, not
  something this phase changed.
- **The validator's pinned counts** (30 / 3 / 1 / 3 / 13) must be updated
  deliberately whenever the roster changes. See §14.
- **Cutover is still blocked** on the pages not yet migrated: the homepage,
  events and the five event pages, contact, and both 404s. Publishing `dist/`
  today would drop them.
