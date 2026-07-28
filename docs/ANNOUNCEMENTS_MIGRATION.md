# Announcements migration (Cleanup Phase 6)

The 28 announcements of the 2025/26 year are now **structured content**. Twenty-eight
YAML files under `content/announcements/` replace the two hand-maintained
JavaScript arrays, and Eleventy generates `dist/announcements.html`,
`dist/pl/announcements.html` and their data files from them.

**The live site has not changed.** Netlify still publishes the repository root,
so `announcements.html`, `pl/announcements.html` and both
`js/…/announcements-data.js` files are still what the public sees. Every
comparison in `scripts/compare-announcements.js` passes, which is the evidence
that the eventual cutover will be a no-op for visitors.

Related reading: [BUILD_ARCHITECTURE.md](BUILD_ARCHITECTURE.md),
[SHARED_CHROME_MIGRATION.md](SHARED_CHROME_MIGRATION.md),
[TEAM_MIGRATION.md](TEAM_MIGRATION.md) (the same schema pattern, applied first
to the committee), [ADMIN_SYSTEM_AUDIT.md](ADMIN_SYSTEM_AUDIT.md).

---

## 1. The canonical file format

One announcement, one file: `content/announcements/<slug>.yaml`. The filename is
the slug.

```yaml
# Announcement — 2025/26.

slug: spring-mixer-in-edinburgh
academic_year: "2025/26"
published_date: "2026-03-04"
order: 7
published: true

image: "/assets/announcements/spring-mixer.jpg"
image_position: "center 30%"
image_fit: null
image_background: null
extra_images:
  - "/assets/announcements/spring-mixer-crowd.jpg"
signups_closed: false

link:
  type: event
  event_slug: spring-mixer

en:
  title: "Spring mixer in Edinburgh"
  subtitle: "An evening for members from the Scottish societies."
  body: |
    Our Scottish members are invited to an informal evening in the city centre.

    Bring a friend — details and directions are on the [event page](spring-mixer.html).
  link_label: "See the event"

pl:
  title: "Wiosenne spotkanie w Edynburgu"
  subtitle: "Wieczór dla członków ze szkockich stowarzyszeń."
  body: |
    Zapraszamy naszych szkockich członków na nieformalny wieczór w centrum miasta.

    Weź ze sobą znajomych — szczegóły znajdziesz na [stronie wydarzenia](spring-mixer.html).
  link_label: "Zobacz wydarzenie"
```

*(Fictional example. No real announcement carries this slug.)*

## 2. Shared and localised fields

Everything above the `en:` block is **invariant** — identical in both languages
because there is only one copy of it.

| Shared (top level) | Localised (`en:` / `pl:`) |
| --- | --- |
| `slug` | `title` |
| `academic_year` | `subtitle` |
| `published_date` | `body` (Markdown) |
| `order` | `link_label` |
| `published` | *(`date_display`, only as an override — see §3)* |
| `image` (path or `null`) | |
| `extra_images` (list) | |
| `image_position`, `image_fit`, `image_background` | |
| `signups_closed` | |
| `link` (type + destination) | |

This nesting is Decap CMS's `i18n.structure: single_file` layout (§19).

**Image alt text is not stored.** The live renderer derives it: the main image
uses the announcement's own title, and extra images use a per-locale pattern
(`{title} — photo 2` / `{title} — zdjęcie 2`). That behaviour is reproduced
exactly, with the pattern in `src/_data/ui.json`, so alt text can never drift
out of sync with a retitled announcement.

Interface strings — "Read more", "Sign-ups closed", the modal's `aria-label` and
its close button's — live in `src/_data/ui.json` under `<locale>.announcements`,
not in any announcement file.

## 3. Date storage and localisation

Records store one machine-readable date:

```yaml
published_date: "2026-07-07"
```

**The quotes matter.** Unquoted, YAML parses `2026-07-07` into a JavaScript
`Date`, whose stringification depends on the machine's timezone — the same input
would produce different output in London and in Warsaw. The validator rejects an
unquoted date for exactly this reason.

The visible date is generated per locale by the `displayDate` filter:

```text
2026-07-07  ->  7 July 2026        (en)
2026-07-07  ->  7 lipca 2026       (pl)
```

Polish uses the **genitive** month forms (`lipca`, not `lipiec`), which is what
a Polish date requires. Formatting splits the ISO string arithmetically and
never constructs a `Date`, so it is UTC-safe and identical on every machine —
verified by building under `TZ=Pacific/Auckland`.

**Overrides.** A record may carry `en.date_display` / `pl.date_display` to force
an exact string when one cannot be reproduced from the ISO value.

> **No announcement currently uses an override.** All 28 dates in both languages
> round-trip exactly from their ISO value; this was checked mechanically during
> extraction, and the validator re-checks every generated date against its
> record on every build.

## 4. Ordering rules

`order` is an explicit integer, unique across the published set, ascending from
1 = newest. The generator sorts by it and by nothing else.

It deliberately does **not** rely on filesystem order, filename order, YAML key
order, or any date — parsed or displayed. Slugs sort nothing like publication
order, and a date-based sort would silently reorder two announcements published
on the same day. The validator enforces uniqueness; a slug comparison exists as
a tie-break so a mistake yields a stable page rather than output that changes
between builds.

To insert an announcement at the top, give it `order: 1` and increment the
others.

## 5. Image-path rules

Every image path is **root-relative**: `/assets/announcements/example.jpg`.

This is not cosmetic. A page-relative path (`assets/…`) resolves against the
*page's* URL, so the identical data string would try to load
`/pl/assets/announcements/example.jpg` from the Polish page and 404. That is a
bug this site actually shipped once (CLEANUP_BASELINE §5). Both the validator
and the comparison script assert that no generated image path can resolve under
`/pl/`.

Paths point at the existing files in `assets/`; nothing was renamed, moved,
re-encoded or optimised. The passthrough list is derived from the records at
build time, so only images an announcement actually references are copied into
`dist/`, and adding one needs no second list updated.

Three fields tune presentation, all optional:

- `image_position` — CSS `object-position`, e.g. `"center 22%"`.
- `image_fit: "contain"` — logo-style covers that must not be cropped.
- `image_background` — a backdrop behind a `contain` image, e.g. `"#001f62"`.

`image: null` is a deliberate no-photo announcement (§14).

## 6. Event-link routing rules

```yaml
link:
  type: event
  event_slug: business-forum
```

renders as `event-business-forum.html` — **relative, on purpose**:

| From | Resolves to |
| --- | --- |
| `/announcements.html` | `/event-business-forum.html` (English) |
| `/pl/announcements.html` | `/pl/event-business-forum.html` (Polish) |

One stored value, each language routed to its own event page. Making this
root-relative would send every Polish reader to the English event — which is why
both the validator and the comparison script fail if any internal link starts
with `/`. Confirmed in-browser: all 9 internal links on `/pl/announcements.html`
resolve under `/pl/`.

The validator also checks that `event-<slug>.html` exists at the repository
root, so a typo in a slug fails the build rather than shipping a dead button.

## 7. External-link rules

```yaml
link:
  type: external
  url: "https://example.org/tickets"
```

Renders with `target="_blank" rel="noopener"`, matching the live pages. The
validator requires HTTPS.

### Supported link types

| Type | Stored as | Rendered href | Opens |
| --- | --- | --- | --- |
| `event` | `event_slug` | `event-<slug>.html` | same-language event page |
| `page` | `page` | the page filename | same-language site page |
| `external` | `url` | the absolute URL | new tab, `rel="noopener"` |

`page` exists so a future internal link that is *not* an event has an honest
home instead of being forced into the event type. **No announcement currently
uses it**; the current 11 links are 9 `event` and 2 `external`.

A link is optional. When present, both languages must supply a `link_label`;
when absent, neither may. Both directions are validated.

## 8. Markdown configuration

**Renderer:** [markdown-it](https://github.com/markdown-it/markdown-it) 14.x,
declared as a direct `devDependency`. It was already present transitively via
Eleventy, but depending on that silently would mean an Eleventy upgrade could
change or remove it without warning.

Configuration, in `eleventy.config.js`:

```js
new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false })
```

- **`html: false`** — the security boundary. See §9.
- **`linkify: false`** — a bare URL in prose stays prose. Auto-linking would
  invent links the live pages do not have.
- **`typographer: false`** — no silent rewriting. The copy already contains
  deliberate em dashes, curly quotes and `·` separators; they pass through
  untouched.

Two additions:

- **External links get `target="_blank" rel="noopener"`**, via a `link_open`
  renderer rule, matching the live markup exactly.
- **`validateLink` is tightened** to an explicit allow-list — `http:`, `https:`,
  `mailto:`, root-relative, fragment, or a bare `*.html` page. markdown-it
  already rejects `javascript:`, but stating the policy in our own file makes it
  visible and auditable rather than inherited.

### Paragraphs are rendered inline, not wrapped in `<p>`

`renderBody()` splits on blank lines, renders each paragraph with
`md.renderInline()`, and rejoins with `\n\n`.

That is deliberate, not a shortcut. `.modal-content .ann-text` is styled
`white-space: pre-line`, so **the blank line itself is the paragraph break**.
Emitting `<p>` elements would add their margins *on top of* the preserved
newlines and space the text out differently from the live page — a visible
regression in a phase whose whole point is equivalence. The comparison script
therefore compares body *text* plus a structured list of links, which is what a
reader actually receives.

### How the one linked body was migrated

A single announcement (`become-a-trustee-…`) had a raw anchor in its body, in
both languages:

```html
… involves <a href="https://www.instagram.com/p/DafxJ5ejGF4/?img_index=1"
   target="_blank" rel="noopener">on our Instagram</a>.
```

It became a Markdown link with identical wording and destination:

```markdown
… involves [on our Instagram](https://www.instagram.com/p/DafxJ5ejGF4/?img_index=1).
```

The `target`/`rel` attributes are no longer stored — they are re-applied by the
renderer rule above, so every external body link gets them consistently rather
than depending on an author remembering. The rendered output is character-for-
character identical to the live markup.

## 9. Why raw HTML is not allowed

Announcement bodies are editor input, and the modal assigns the body with
`innerHTML`. Permitting raw HTML in a content file would therefore make stored
cross-site scripting a normal consequence of typing into a CMS field — a
`<script>` or an `onerror=` attribute in a YAML file would execute for every
visitor.

With `html: false`, markdown-it escapes any `<tag>` to visible text, so the only
markup that can reach the page is what the renderer itself emits: a small, known
set of inline tags. The validator independently rejects tags, `<script>` and
`on*=` handlers in any title, subtitle, body or label, so a bad record fails the
build rather than reaching a browser.

The `bodyHtml` in the generated data is therefore **trusted, build-produced
markup**, not editor-supplied HTML. That distinction is what makes the single
`innerHTML` assignment in the renderer safe — and it is the reason the body is
pre-rendered at build time rather than parsed in the browser.

## 10. How the modal is populated

`src/js/announcements-page.js` is one script for both languages. It reads two
globals defined by the generated data file — `ANNOUNCEMENTS` (this locale's
ordered array) and `ANNOUNCEMENTS_UI` (this locale's labels) — so it contains no
translated text of its own.

On click it fills the existing modal: photo, date, title, `bodyHtml`, then the
optional closed chip, extra-image gallery and link button. Everything except
`bodyHtml` is written with `textContent` or escaped through `attr()`.

Behaviour preserved from the live pages: close button, backdrop click, Escape,
`document.body` scroll lock, the staggered reveal animation and the tilt effect.

**One deliberate improvement:** focus moves to the close button when the dialog
opens and returns to the originating card when it closes. The live pages leave
focus on the card behind the overlay. This was not gratuitous — without it the
dialog's own controls are unreachable by keyboard, and the brief asked for focus
handling "at least as well as the current implementation".

The script returns immediately if the expected markup or data is absent, so
loading it elsewhere does nothing. Verified by injecting it into the generated
team page: no console output.

## 11. Adding an announcement

1. Put any images in `assets/announcements/` (or the existing `assets/pbf/`,
   `assets/debata/` folders).
2. Create `content/announcements/<slug>.yaml` from the template in §1.
3. Set `published_date` to the real ISO date and `order: 1`, then increment the
   `order` of every other published record.
4. Write both languages. Do not machine-translate.
5. `npm run build && npm run validate`.

Images are copied into `dist/` automatically — the passthrough list is derived
from the records.

## 12. Editing an announcement

Edit the one file and rebuild. There is no second copy to keep in sync — that
was the point of the migration.

Changing the slug means renaming the file too; the validator requires them to
match.

## 13. Unpublishing without deleting history

Set `published: false`. The record stays on disk and drops out of the page, the
generated data and the counts.

Use it to retract something published in error. For an announcement that is
merely old, prefer the academic year (§18) — that keeps `published` meaningful
as "should be visible now".

To remove something permanently — a takedown request, a mistaken entry — delete
the file, and delete any images that nothing else references.

## 14. An announcement with no image

```yaml
image: null
extra_images: []
```

The card renders with the `no-photo` class and no `<img>`; the modal shows no
photo block. No placeholder image is invented. Three announcements are currently
in this state.

## 15. Multiple images

`image` is the card thumbnail and the modal's header image. `extra_images` are
shown in a gallery under the modal body:

```yaml
image: "/assets/announcements/gala.jpg"
extra_images:
  - "/assets/announcements/gala-2.jpg"
  - "/assets/announcements/gala-3.jpg"
```

Alt text is derived: the extras become "…— photo 2", "…— photo 3" (`zdjęcie` in
Polish), numbered from 2 because the main image is photo 1. Three announcements
currently carry extra images.

## 16. Linking to a Federation event

```yaml
link:
  type: event
  event_slug: business-forum
```

plus a `link_label` in both languages. The slug is the part of the filename
between `event-` and `.html`. See §6 for why the output stays relative.

## 17. Linking to an external page

```yaml
link:
  type: external
  url: "https://example.org/tickets"
```

plus both labels. HTTPS is required; `target="_blank" rel="noopener"` is applied
automatically.

## 18. Academic years and future archives

Every record carries `academic_year: "2025/26"`, and the page renders only the
year named in `content/settings/academic-year.yaml` — the same switch the team
page uses.

Adding 2026/27 means writing new records with the new year and changing
`current`. Nothing is deleted; the 2025/26 records simply stop matching.

Archive *controls* are deliberately not built in this phase. Still needed: a URL
scheme for a past year, its hreflang pairs and sitemap entries, a localised year
picker, and a decision on whether the current-year page and an archived page for
the same year are one URL or two (two would be duplicate content). The schema
already supports all of it; only the presentation is missing.

## 19. Decap CMS

The schema was shaped for Decap and should need no restructuring:

```yaml
- name: announcements
  folder: content/announcements
  create: true
  slug: "{{fields.slug}}"
  i18n: true            # structure: single_file — matches the en:/pl: nesting
  fields:
    - { name: slug, widget: string, i18n: duplicate }
    - { name: academic_year, widget: string, i18n: duplicate }
    - { name: published_date, widget: datetime, format: "YYYY-MM-DD", picker_utc: true, i18n: duplicate }
    - { name: order, widget: number, value_type: int, i18n: duplicate }
    - { name: published, widget: boolean, i18n: duplicate }
    - { name: image, widget: image, required: false, i18n: duplicate }
    - { name: extra_images, widget: list, field: { name: src, widget: image }, required: false, i18n: duplicate }
    - { name: signups_closed, widget: boolean, i18n: duplicate }
    - { name: title, widget: string, i18n: true }
    - { name: subtitle, widget: string, i18n: true }
    - { name: body, widget: markdown, i18n: true }
```

`i18n: duplicate` on the shared fields is what keeps them invariant: one input,
one value, written to both.

Three things to settle first:

- **`picker_utc: true` is not optional.** Without it Decap writes a
  timezone-shifted date and the day can move by one.
- **The Markdown widget must be restricted** to the subset the renderer allows.
  Decap's default toolbar offers images and raw HTML; both must be off, or
  editors will produce content the validator then rejects.
- **`link` is a variant type** and needs a Decap `select` on `type` with
  conditional fields, or three separate optional field groups.

## 20. Discrepancies found during extraction

Records were generated mechanically from the two live arrays, with every
invariant cross-checked between languages before a single file was written.

### A. No invariant disagreements

Record count, order, main image, extra images, image position, fit, background,
closed status, link destination and link type were compared field by field
across all 28 pairs. **Zero mismatches.** Extraction was set to abort and write
nothing on any disagreement; it did not fire.

### B. One title is identical in both languages — and correctly so

Announcement #25, *"Building Bridges, Inspiring the Future"*, has the same title
in the Polish data. It is the proper name of a Polish Professionals in Great
Britain conference, and its **subtitle and body are fully translated**. This is
deliberate, not a missed translation.

It is worth recording because the obvious check — "no title may be identical
across locales" — would flag it. The comparison script instead asserts that the
set of untranslated titles *matches the live data's*, which still catches a real
locale fallback while accepting a genuine proper noun.

### C. Ampersands are now escaped

Live bodies contain literal `&` (`Legal & Finance`, `OC&C`) injected raw via
`innerHTML`. markdown-it emits `&amp;`. The browser renders both identically;
the generated markup is simply more correct. Bodies are compared as decoded
text, so this is not treated as a difference.

### D. The close button is unclickable when a photo is present — RESOLVED in Phase 7

Found while testing, **present identically on the live site**, and reproduced
rather than fixed.

`.modal-close` is `position: absolute` with no `z-index`, and `#annModalPhoto`
follows it in the DOM inside the same stacking context. The photo therefore
paints over the button. `elementFromPoint` at the button's centre returns the
`<img>`, on both the live and the generated page; with no photo, it returns the
button.

Consequences: for the 25 announcements that have a photo, a **mouse** click on
the ✕ does nothing. Users are not trapped — Escape closes, backdrop click
closes, and the button works by keyboard (it receives focus when the dialog
opens). Nothing about this is caused by the migration.

**Fixed in Phase 7** by adding `z-index: 1` to `.modal-close` in
`css/style.css` — one declaration, applied to the live stylesheet and inherited
by the generated pages through the byte-identical passthrough copy. See
[ANNOUNCEMENT_MODAL_FIX.md](ANNOUNCEMENT_MODAL_FIX.md); `scripts/validate.js`
§19 now fails if the stacking value is removed.

## 21. Remaining limitations before cutover

- ~~The close-button overlap (§20 D) should be fixed on the live stylesheet
  before or alongside cutover.~~ **Done in Phase 7** — see
  [ANNOUNCEMENT_MODAL_FIX.md](ANNOUNCEMENT_MODAL_FIX.md).
- **The dialog does not trap focus.** Tab from inside the open modal walks into
  the page behind it. The live pages behave the same way; a focus trap is a
  genuine improvement but a behaviour change, so it was not smuggled in here.
- **The modal has no accessible name tied to its content.** `aria-label` is the
  generic "Announcement" / "Ogłoszenie" rather than the announcement's title.
  Live behaviour, preserved.
- **Cards are rendered client-side.** With JavaScript disabled the page shows
  its heading and an empty grid — exactly as the live page does today.
  Server-rendering the cards is the obvious improvement, and deliberately out of
  scope: it would change the served HTML and break the equivalence this phase
  exists to prove. It should be a separate, reviewed step.
- **Cutover is still blocked** on the pages not yet migrated. Publishing `dist/`
  today would drop the homepage, events, members, contact, the event pages and
  both 404s.
