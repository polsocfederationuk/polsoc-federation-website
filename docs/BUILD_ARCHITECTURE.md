# Build architecture

**Phase 2 of the pre-CMS cleanup — architectural only.**

Nothing about the live website changed. The public pages are still the
hand-written HTML at the repository root, Netlify still publishes the repository
root, and no content has been migrated. What this phase adds is a build pipeline
running alongside the live site, proven on two throwaway test pages.

Date: 27 July 2026 · Branch: `main` · Baseline: `8517d33`

---

## 1. Selected generator

**Eleventy (11ty) v3.1.6**, with Nunjucks templates and YAML content records.

## 2. Why

The brief asked for the *least complex* option that can reliably support
layouts, partials, bilingual generation, structured content, stable `.html`
URLs, Nunjucks, automatic SEO, future Decap CMS, Netlify and Windows.

"Least complex" is ambiguous — fewest dependencies, or least code we own?
Eleventy loses on the first and wins decisively on the second, and the second is
what matters for this project:

- **Handover.** The committee rotates annually. A new member can search
  "Eleventy layout" and find documentation, tutorials and Stack Overflow
  answers. Bespoke code has exactly one source of documentation: ours.
- **Exact URL control.** `permalink: "events.html"` emits precisely that path.
  This is the single hardest requirement — the site's URLs are live, indexed and
  cross-referenced by hreflang, and a generator that insists on `/events/`
  directory URLs would be disqualifying. Eleventy's permalinks handle it, and
  §10 proves it.
- **The hard parts are already solved.** The data cascade, collections with
  sorting and filtering (needed for academic-year archives), pagination (needed
  to emit one page per event × 2 locales), and incremental rebuilds. Writing
  these ourselves means writing and then *debugging* them.
- **Decap is a well-worn path.** Decap + Eleventy + Netlify is one of the most
  common combinations in this space, with existing guides.
- **Build-time only.** Nothing Eleventy touches is shipped to a visitor. The
  output is ordinary static HTML, exactly as it is today.

The honest cost is a large transitive dependency tree (§4) and a framework's
conventions to learn. Both are accepted deliberately.

## 3. Alternatives considered

**A custom Node.js generator.** Genuinely viable — the site is 24 pages, and a
few hundred lines could walk `content/`, merge data and render Nunjucks. It wins
on dependency count: `nunjucks` + `js-yaml` is a handful of packages versus
Eleventy's ~110.

Rejected because we would then own the data cascade, collection sorting,
permalink mapping, pagination, watch mode and incremental builds — all of which
have to be written, tested and then maintained by a rotating volunteer committee
with no dedicated maintainer. That is more total complexity, not less, and it is
concentrated in exactly the place where a handover gap hurts most. If Eleventy
ever becomes a burden, the content records in `content/` are plain YAML and are
not Eleventy-specific, so a switch stays cheap (§19).

**React, Next.js, Gatsby, Vue, any SPA, any database, Supabase** — excluded by
the brief, and all wrong for a static brochure site that must stay
plain HTML/CSS/JS.

**Decap CMS itself** — explicitly out of scope for this phase.

## 4. Dependencies introduced

Both are `devDependencies`. Neither ships to a visitor; neither is needed to
deploy the site today.

| Package | Why it is necessary |
|---|---|
| `@11ty/eleventy` ^3.1.6 | The generator. Provides Nunjucks, layouts, partials, the data cascade, collections, pagination and permalink control. |
| `js-yaml` ^4.3.0 | Eleventy reads `.json`/`.js` data natively but not YAML. Needed for `addDataExtension("yaml", …)` and to load `content/**/*.yaml`. Chosen because content records are YAML (§9) — the format Decap writes and the only one of the three that handles multi-line prose readably. |

Nothing else was added. No CSS framework, no bundler, no test runner, no
markdown library yet (§16 explains when `markdown-it` will be needed).

**Known advisory:** `npm audit` reports 4 high-severity issues, all one
transitive dependency — `brace-expansion` (DoS via unbounded glob expansion),
reached through `minimatch` → `@11ty/recursive-copy` → `@11ty/eleventy`. It is
build-time only, we control every glob it sees, and no untrusted input reaches
it. `npm audit fix --force` would *downgrade* Eleventy to 3.1.2, which is worse.
Left as-is; revisit when Eleventy ships a patched `recursive-copy`.

## 5. Source directory structure

```
src/                          templates and source pages (Eleventy input)
  _data/
    site.json                 shared invariants: domain, org names, socials
    locales.json              locale definitions (code, lang, og locale, prefix)
    records.js                loads content/**/*.yaml into the data cascade
  _includes/
    layouts/
      base.njk                shared base layout
    partials/
      test-banner.njk         reusable partial (Phase 2 proof)
      build-footer.njk        reusable partial (Phase 2 proof)
  build-test/
    index.njk                 the proof page template (generates EN + PL)

content/                      structured content records (YAML)
  build-test/
    architecture-proof.yaml   the one canonical bilingual record
  events/                     EMPTY — awaiting migration
  announcements/              EMPTY — awaiting migration
  team/                       EMPTY — awaiting migration
  societies/                  EMPTY — awaiting migration
  settings/                   EMPTY — awaiting migration

eleventy.config.js            build configuration
scripts/
  validate.js                 site validator (Phase 1, extended in Phase 2)
  clean.js                    cross-platform dist/ removal
```

The data file is called `records.js`, **not** `content.js`, on purpose: inside an
Eleventy layout `{{ content }}` already means "the rendered child template", and
a global named `content` would shadow it.

## 6. Generated output structure

```
dist/                         generated — gitignored, never edited by hand
  build-test/
    index.html                English proof page
    pl/
      index.html              Polish proof page
```

Currently two files. When the public pages migrate, `dist/` will mirror the
current live structure exactly (§10).

## 7. Files developers edit

- `src/_includes/**` — layouts and partials
- `src/**/*.njk` — page templates
- `src/_data/*` — site-wide invariants and locale definitions
- `content/**/*.yaml` — content records (and, later, the Decap admin UI writes
  these same files)
- `eleventy.config.js`, `scripts/*`, `docs/*`

## 8. Files that must NEVER be edited by hand

- **Everything under `dist/`.** It is regenerated by `npm run build` and deleted
  by `npm run clean`. `dist/` is gitignored, and the validator asserts that no
  file under it is git-tracked. An edit there is silently destroyed on the next
  build.
- `node_modules/`.

During Phase 2 the public HTML at the repository root is *still hand-edited* —
it is the live site. That inverts at the Netlify cutover (§18), after which the
root HTML becomes generated output and must not be edited either.

## 9. Bilingual field design

**One canonical record per content item.** Invariant fields at the top level,
localised fields nested under `en:` and `pl:`. Never two loosely-coupled files
that can drift apart.

```yaml
slug: architecture-proof          # ── invariant: edited once, true for both
academic_year: 2026/27
template: build-test
order: 1
published: true
start_date: 2027-03-12
image: /assets/logo.svg

en:                               # ── localised
  title: Build architecture proof
  summary: ...
pl:
  title: Dowód architektury budowania
  summary: ...
```

**Format: YAML.** Reasons:

- Multi-line prose is readable via block scalars (`>-`, `|`). JSON cannot do
  this without escaping every newline, which makes long bodies unusable for a
  human editor.
- Markdown-with-front-matter has one body per file, so a bilingual item would
  need two files — reintroducing exactly the drift this design prevents.
- It is what Decap writes with `format: yaml`, so the future admin UI edits
  these files directly with no migration (§17).

### Which fields go where

| Invariant (top level) | Localised (`en:` / `pl:`) |
|---|---|
| `slug` | `title` |
| `academic_year` | `summary` |
| `start_date`, `end_date`, `date_precision` | `body` |
| `image`, `gallery[].image` | `image_alt`, `gallery[].alt` |
| `email`, `linkedin`, social URLs | `role` |
| `lat`, `lng` (societies) | `uni` (societies — city/country name) |
| `instagram` handle, `logo` filename | `seo_title`, `seo_description` |
| `order`, `published`, `template` | `cta_label`, button labels |
| `performers[].name`, sponsor names | `fact_label`, `fact_value` |

The rule of thumb: **if the two languages could ever legitimately disagree, it is
localised; otherwise it is invariant.** A date, a coordinate or an image path
disagreeing between languages is always a bug, so those live at the top level
where they physically cannot.

### Determinism warning (found while building the proof)

YAML parses an unquoted `2027-03-12` into a JavaScript `Date`, and Nunjucks
stringifies a `Date` using the **local timezone**:

```
Fri Mar 12 2027 00:00:00 GMT+0000 (Greenwich Mean Time)     ← built in London
Fri Mar 12 2027 00:00:00 GMT+0100 (Central European …)      ← built in Warsaw
```

Same input, different output. **Always render dates through the `isoDate`
filter**, which formats in UTC. Verified: building under `TZ=Europe/Warsaw`
produces byte-identical output.

## 10. URL preservation strategy

Every public URL stays exactly as it is. No `/events/`, no `/en/`, no
trailing-slash directory URLs, `.html` extensions preserved.

Each page declares its URL shape **once**, as a pattern containing `{prefix}`:

```yaml
urlPattern: "/{prefix}events.html"      # -> /events.html   and  /pl/events.html
permalink: "{{ locale.urlPrefix }}events.html"
```

The `urlFor` filter resolves that pattern per locale, and the canonical, the
three hreflang alternates and `og:url` are all derived from it — so a page's
address is stated in exactly one place and cannot drift between its own tags.

Eleventy's *default* would be `/events/index.html` (a directory URL). The
explicit `permalink` overrides it. The proof pages demonstrate this: they are
emitted to `dist/build-test/index.html` and `dist/build-test/pl/index.html`, not
`dist/build-test/index/`.

Target mapping when the real pages migrate:

| Source | English output | Polish output |
|---|---|---|
| `src/pages/index.njk` | `index.html` | `pl/index.html` |
| `src/pages/events.njk` | `events.html` | `pl/events.html` |
| `src/pages/team.njk` | `team.html` | `pl/team.html` |
| `src/pages/event.njk` (paginated over events × locales) | `event-<slug>.html` | `pl/event-<slug>.html` |

## 11. Shared layout and partial strategy

One base layout plus a set of small partials. Planned inventory (**none of the
real chrome has been migrated — that is the next phase**):

| Partial | Responsibility |
|---|---|
| `partials/head.njk` | charset, viewport, title, description, canonical, hreflang trio, OG, Twitter, icons, manifest, theme-color |
| `partials/header.njk` | brand lockup + wordmark rows |
| `partials/nav.njk` | primary navigation, active state |
| `partials/lang-switch.njk` | `PL \| EN`, root-relative, `aria-current` on the active side |
| `partials/footer.njk` | brand blurb, charity number, explore/connect columns |
| `partials/scripts.njk` | `main.js` and any page-specific scripts |
| `partials/cards/announcement.njk` | announcement card |
| `partials/cards/event.njk` | event card (incl. flagship variant) |
| `partials/cards/team-member.njk` | team member card, tolerating a null photo |
| `partials/archive-dropdown.njk` | academic-year selector (§15) — **not yet** |

Phase 2 proves the mechanism with two deliberately trivial partials
(`test-banner.njk`, `build-footer.njk`) rather than migrating real chrome.

## 12. SEO and hreflang generation

Emitted by `partials/head.njk` from data, never hand-written:

- **canonical** — always self-referencing, from `urlPattern | urlFor(locale)`
- **hreflang** — `en`, `pl`, `x-default`; identical on both pages of a pair;
  `x-default` always points at English (`locales[0]`)
- **og:locale** — `en_GB` / `pl_PL`, with the other as `og:locale:alternate`
- **title / description / OG / Twitter** — from the record's localised fields,
  falling back to `title`/`summary` when a dedicated SEO field is absent

The existing Phase 1 validator already enforces every one of these rules against
the public pages, so a regression during migration fails `npm run validate`
rather than reaching production.

## 13. Structured-data generation

A `partials/schema.njk` will emit JSON-LD from the same record:

- **Homepage** → `Organization`. Polish variant adds `inLanguage: "pl-PL"`, the
  `/pl/` URL, the Polish `name` and the English `alternateName`. `logo` must
  stay a raster (`/assets/icons/icon-512.png`), never the SVG.
- **Event pages** → `Event`, with `startDate`/`endDate`/`location`/`performer`
  from invariant fields and `description` from the localised half.
  `date_precision: month` must emit `"2025-10"` — the Icebreaker needs it.

The JSON must be built with a JSON filter, not string concatenation, so quotes
and Polish diacritics in descriptions cannot break it.

## 14. Sitemap generation

A template (`src/sitemap.njk`, `permalink: "sitemap.xml"`) iterating pages ×
locales. Rules carried over from Phase 1:

- absolute URLs on `https://polsocfederation.pl`
- both 404 pages excluded
- `build-test` excluded (`eleventyExcludeFromCollections`)
- Polish priority 0.1 below its English counterpart
- **`lastmod` must come from content, not from build time.** Stamping today's
  date on all 22 URLs every deploy destroys the signal. Source it from a
  `updated:` field on the record, falling back to git's last-commit date for the
  source file.

## 15. Academic-year strategy

`site.currentAcademicYear` (in `src/_data/site.json`, currently `2026/27`) is the
single switch. Every event, announcement and team record carries
`academic_year: "2026/27"`.

- **Current year first.** Listing pages filter to `academic_year ==
  site.currentAcademicYear`, sorted by `order` then date.
- **Archives.** Earlier years are grouped into collections keyed by year. The
  archive dropdown (§11) renders those groups — **not built in this phase**.
- **Detail URLs never change.** `event-<slug>.html` is derived from `slug`
  alone, never from the year, so an event remains at its original address
  forever even after it leaves the current-year listing. This is what protects
  existing inbound links and search rankings.
- **Past committees stay available.** Team records carry `academic_year`, so a
  `team.html` filtered to the current year coexists with archived committees.
- **Rolling over a year** is a one-line change to `currentAcademicYear` plus new
  records; nothing else moves.

## 16. Event templates

Two templates, not a free-form page builder:

1. **`standard`** — the four ordinary event pages.
2. **`pbf`** — the Business Forum, a genuine sub-brand: `body.pbf-page`,
   `css/pbf.css`, its own hero, stats band, founders grid, two sponsor
   carousels, funding note, ball section and photographer cards. It gets a
   bespoke template rather than being forced through the standard one.

The `template:` field on the record selects between them.

The standard template will eventually support an ordered list of **approved
optional blocks**, each a named partial with a fixed schema: text section,
image, gallery, speakers, agenda, sponsors, FAQ, Instagram embed, album link,
CTA button, external registration link, external payment link, downloadable
document. **None are implemented in this phase.**

Deliberately *not* a free-form builder: a fixed block vocabulary keeps every
generated page inside the design system, which is the whole reason the site
looks coherent today.

Rendering block prose will need Markdown. That is when `markdown-it` gets added
as an explicit dependency — relying on Eleventy's bundled copy would be
depending on a transitive package.

## 17. Future Decap CMS compatibility

The content shape was chosen to be what Decap already writes:

```yaml
i18n:
  structure: single_file      # one file, locales nested under en:/pl:
  locales: [en, pl]
  default_locale: en
```

With `structure: single_file`, Decap stores localised fields under a top-level
key per locale and leaves non-localised fields at the root — exactly the shape
in §9. Per-field `i18n` settings then map onto the invariant/localised split:

| Decap `i18n` | Applied to |
|---|---|
| `duplicate` | slug, dates, image paths, coordinates, emails, handles, order, template — editor types once, both locales stay identical **by construction** |
| `true` | every prose field |

> **This supersedes `docs/ADMIN_SYSTEM_AUDIT.md` §8.3**, which proposed
> `structure: multiple_folders` (separate files per locale). `single_file` is
> the better choice: it delivers the "one canonical record" requirement
> physically rather than by convention. The field-level `i18n: duplicate` idea
> from the audit is unchanged and remains the core anti-drift mechanism.

Decap also needs an auth backend (Git Gateway or GitHub OAuth) and an
`/admin/` route — neither is in scope here. Note that Netlify Identity is
deprecated for new sites; confirm availability before committing to it.

## 18. Netlify migration plan

**Unchanged in this phase.** `netlify.toml` still declares `publish = "."` and
**no build command**. The Polish 404 redirect is untouched. The live deploy is
byte-for-byte what it was.

The cutover, once every public page is generated and byte-compared against the
current output:

```toml
[build]
  command = "npm run build"
  publish = "dist"
```

Order of operations:

1. Generate all 24 pages into `dist/`.
2. Diff each generated page against its live counterpart until differences are
   either nil or deliberate.
3. Add a passthrough copy for `assets/`, `css/`, `js/`, `favicon.ico`,
   `site.webmanifest`, `robots.txt` so `dist/` is a complete site.
4. Move the `/pl/*` 404 redirect across unchanged.
5. Deploy to a **branch preview** and run the full manual checklist against it.
6. Only then switch production, and only then delete the root HTML.

Do not switch `publish` until step 5 passes.

## 19. Rollback strategy

Rollback is trivial *because* Phase 2 changed nothing public:

- **During Phase 2 and 3:** delete `dist/`, `src/`, `content/`,
  `eleventy.config.js` and the two devDependencies. The live site is untouched
  and keeps deploying. There is nothing to revert.
- **After the Netlify cutover:** revert `netlify.toml` to `publish = "."`. The
  hand-written root HTML must still be in git at that point — **do not delete it
  in the same commit as the cutover.** Keep it for at least one full deploy
  cycle.
- **If Eleventy itself becomes a problem:** the content records are plain YAML
  with no Eleventy-specific syntax. Templates would need rewriting; content
  would not.

## 20. Risks and limitations

1. **The repo now has two sources of truth.** Until the cutover, the live pages
   are hand-edited root HTML while `src/` + `content/` describe a parallel
   system. Edits made to one do not reach the other. This is the biggest hazard
   of the interim state — keep the interim short and migrate a whole content
   type at a time.
2. **Dependency surface.** ~110 packages for a 24-page static site, with one
   open advisory (§4). Build-time only, but real.
3. **A build step is a new failure mode.** Today a broken commit still deploys
   the previous HTML; after the cutover a template error fails the build and can
   block a deploy. Mitigated by running `npm run validate` in CI before the
   cutover.
4. **Contributors can no longer just open a file.** They will need Node and
   `npm install`. Document it prominently in the README at cutover time.
5. **Timezone determinism** (§9) — handled by `isoDate`, but any future date
   rendering that bypasses the filter reintroduces it.
6. **Eleventy's default directory URLs** are the opposite of what this site
   needs. Every page template must set `permalink` explicitly; forgetting it
   silently changes a public URL. The validator's URL checks catch this.
7. **`dist/` is not deployed yet**, so a build error is currently invisible to
   production — which is safe, but also means the pipeline is unexercised until
   the cutover.

## 21. Recommended migration order

The brief's suggested order, adopted **unchanged**:

1. **Shared page chrome** — header, nav, language switcher, footer, head/SEO
   partials. Everything else depends on these, and getting them byte-identical
   to the current output is the strongest possible proof the pipeline is sound.
2. **Team members** — 21 records, one page per language, no URL implications.
   Smallest real content type; exercises the record → card → page path.
3. **Announcements** — already structured as a JS array, so the transformation
   is mechanical. 28 records with a known field set.
4. **Member societies** — 30 flat records. Must keep emitting a JS array the
   existing Leaflet code can consume, unless that is rewritten at the same time.
5. **Academic-year listings** — introduce `academic_year` filtering and the
   archive grouping once there is enough content to group.
6. **Standard events** — the four ordinary event pages. Requires reconciling the
   six duplicated copies of each event (`ADMIN_SYSTEM_AUDIT.md` §7.1), which
   needs human judgement.
7. **Business Forum** — the bespoke template, last among content because it is
   the most unusual page on the site.
8. **Site settings and remaining page copy** — hero text, FAQ, testimonials,
   stat labels, the `main.js` UI strings.
9. **Decap CMS** — only once the content shape has stopped moving.

No change to this order is recommended. The one thing worth stressing: steps 1–4
are individually reversible, step 6 is not cheap to redo, and step 9 should not
start until steps 1–8 have been live and stable for a while.
