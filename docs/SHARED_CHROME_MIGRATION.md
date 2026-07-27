# Shared chrome migration

**Phase 3 of the pre-CMS cleanup — chrome extraction only.**

The shared page chrome (document shell, `<head>`/SEO, header, navigation,
language switcher, footer, scripts) has been extracted into reusable Eleventy
partials and proven on two isolated comparison pages. **No public page, stylesheet,
script or asset was modified, and no content was migrated.**

Date: 28 July 2026 · Branch: `main` · Baseline: `46936ed`

---

## 1. Pages inspected

Chrome was compared across all 18 public pages, with these read in full:

| English | Polish |
|---|---|
| `index.html` | `pl/index.html` |
| `events.html` | `pl/events.html` |
| `team.html` | `pl/team.html` |
| `contact.html` | `pl/contact.html` |
| `members.html` | `pl/members.html` |
| `announcements.html` | `pl/announcements.html` |
| `event-business-forum.html` | `pl/event-business-forum.html` |
| `event-icebreaker.html` | `pl/event-icebreaker.html` |
| `404.html` | `pl/404.html` |

Method: normalise each chrome region (collapse whitespace, mask the `.active`
nav item and the page-aware switcher hrefs), then compare byte-for-byte.

---

## 2. What is genuinely shared

Header and footer are **identical on all eight indexable pages in each
language** once the `.active` nav item and the switcher destinations are
normalised. Only `404.html` differs, and only in link form (§3.1).

| Region | Shared? | Notes |
|---|---|---|
| `<meta charset>`, `<meta viewport>` | yes | identical everywhere |
| Icon block (ICO + 3 PNG + apple-touch) | yes | byte-identical on all 18 |
| `<link rel="manifest">`, `theme-color` | yes | identical |
| Font preconnects + Google Fonts href | yes | identical |
| `css/style.css` | yes | every page |
| `<header class="site-header">` | yes | identical (8 pages per language) |
| `.brand` + five `.brand-text` rows | yes | localised wording only |
| `.nav-toggle` burger + `.nav-links` | yes | localised labels, `.active` varies |
| `.nav-pbf` and `.nav-lambert` items | yes | identical, incl. `target="_blank" rel="noopener"` |
| `<nav class="lang-switch">` | yes | structure shared, destinations page-aware |
| `<footer class="site-footer">` | yes | identical (8 pages per language) |
| `js/main.js` (last script) | yes | every page |
| title, description, canonical, hreflang, OG, Twitter | **no** | page-specific |
| JSON-LD | **no** | differs by page type |
| Extra stylesheets / scripts | **no** | three pages only |
| `<body class>` | **no** | one page only |

---

## 3. Differences found between current pages

### 3.1 `404.html` uses root-relative links; every other page uses relative

`404.html` and `pl/404.html` link as `/index.html`, `/assets/logo.svg`,
`/css/style.css`, `/js/main.js`. All other pages use `index.html`,
`assets/logo.svg` (English) or `../assets/logo.svg` (Polish).

**Not a defect — deliberate and correct.** Netlify can return a 404 body at any
URL depth, so relative links would resolve against the wrong directory. Kept.

**Resolution:** the partials take a `linkMode` of `"relative"` (default) or
`"root"`; the 404 pages will set `"root"` when they migrate.

### 3.2 Extended `og:image:*` metadata exists on only three pages

`og:image:secure_url`, `:type`, `:width`, `:height` appear on `index.html`,
`contact.html` and `event-icebreaker.html` — exactly the three pages that use
the shared 1200×630 banner. The other eight carry only `og:image` +
`og:image:alt`.

**A genuine inconsistency, but the asymmetry is justified**: the eight other
pages use page-specific photographs whose dimensions were never measured.

**Resolution:** `head.njk` emits the extended block **only when the page supplies
`ogImageWidth` and `ogImageHeight`**. It does not invent dimensions. Producing
plausible-looking but unverified numbers would be worse than omitting optional
tags. Measuring the eight photos and populating the fields is a reasonable
follow-up, but it is a content change and out of scope here.

### 3.3 Stylesheet cascade order differs by page — and matters

- `members.html` loads Leaflet CSS **before** `style.css`
- `event-business-forum.html` loads `pbf.css` **after** `style.css` (it overrides it)

Collapsing these into one "extra stylesheets" slot would silently break the PBF
page's overrides.

**Resolution:** two slots — `stylesheetsBefore` and `stylesheetsAfter`.

### 3.4 Script order differs by page

`js/main.js` is always last. `announcements.html` loads its data file first;
`members.html` loads Leaflet then its data file. `main.js` reads the DOM those
scripts help build, so order is load-bearing.

**Resolution:** `scriptsBefore` / `scriptsAfter`, with `main.js` fixed between.

### 3.5 `404.html` has no canonical, hreflang, OG or Twitter tags

Deliberate — the 404s are `noindex, follow` and must not be indexed or paired.

**Resolution:** a `noindex` flag suppresses that whole block.

### 3.6 Asset URL form normalised in the generated chrome (deliberate change)

The live pages use three different forms for the same file: `assets/logo.svg`
(English), `../assets/logo.svg` (Polish), `/assets/logo.svg` (404). The
generated chrome standardises on **root-relative** for all shared assets.

Semantically identical when served from the domain root, and it removes an
entire class of bug — a page-relative asset path in shared code is exactly what
produced live `/pl/assets/…` 404s once before. The comparison script treats the
three forms as equivalent.

### 3.7 No material conflicts

No case was found where two pages implemented the *same* chrome element
differently in a way that required choosing a winner. Every difference above is
either page-specific by design or an omission handled by an optional slot.

---

## 4. Version selected for the partials

`events.html` / `pl/events.html` were used as the reference, because they are
the most ordinary pages: no bespoke stylesheet, no extra scripts, no body class,
no JSON-LD, and a nav item in the active state — so they exercise the `.active`
path while carrying nothing exceptional. The comparison script diffs the
generated chrome against these two on every run.

---

## 5. Global data (`src/_data/site.json`)

Identical in both languages: `domain`, `shortName`, `logo`, `email`,
`charityNumber`, `themeColor`, `fontsHref`, `defaultOgImage` (+ width/height),
the three social URLs, `lambertUrl`, `currentAcademicYear`.

`src/_data/nav.json` holds navigation **structure** (order, target files,
variants) with no wording. `src/_data/locales.json` holds locale mechanics
(`code`, `htmlLang`, `ogLocale`, `urlPrefix`, `label`).

## 6. Localised data (`src/_data/ui.json`)

Per locale: `logoAlt`, `brandRows` (five wordmark rows), `mainNavLabel`,
`toggleMenuLabel`, `changeLanguageLabel`, all `nav.*` labels, and
`footer.{orgName, blurb, charityLine, exploreHeading, connectHeading, copyright}`.

All copied verbatim from the live pages. **The Lambert** stays in English in both
locales — it is a brand name.

## 7. Page-specific values

`pageTitle`\*, `pageDescription`\*, `urlPattern`\*, `ogImageAlt`\*, `ogType`,
`ogTitle`, `ogDescription`, `ogImage`, `ogImageWidth/Height/Type`,
`twitterCard/Title/Description/Image/ImageAlt`, `bodyClass`, `activeNav`,
`linkMode`, `stylesheetsBefore/After`, `scriptsBefore/After`, `extraHead`,
`noindex`.

\* Required. These pass through a `required` filter that **throws and fails the
build** if absent, rather than falling back to a broad default. A page with no
description fails loudly instead of shipping an empty tag.

## 8. How active navigation is calculated

The page declares `activeNav: events` — the nav item's `key` from `nav.json`.
`navigation.njk` adds `class="active"` where `activeNav == item.key`. No
guessing from URLs or headings, so a page can be active for an item it does not
literally live at.

## 9. How language-switcher URLs are supplied

Each page declares its address **once**, as a pattern containing `{prefix}`:

```yaml
urlPattern: "/{prefix}events.html"    # -> /events.html and /pl/events.html
```

The `urlFor` filter resolves it per locale. The canonical, all three hreflang
alternates, `og:url` and both switcher destinations derive from that single
value, so they cannot drift apart. Destinations are root-relative and
`aria-current="true"` marks the active language.

## 10. Additional stylesheets

```yaml
stylesheetsBefore: ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"]  # members
stylesheetsAfter:  ["/css/pbf.css"]                                     # PBF
```

Two slots, because the cascade position differs per page (§3.3).

## 11. Page-specific JSON-LD

Via the `extraHead` slot, rendered last in `<head>`:

```yaml
extraHead: |
  <script type="application/ld+json">
  { "@context": "https://schema.org", "@type": "Event", ... }
  </script>
```

JSON-LD is **deliberately not global**: `Organization` on the homepage, `Event`
on event pages, none elsewhere. When it is generated from records it must be
serialised with a JSON filter, never string concatenation, so quotes and Polish
diacritics cannot break it.

## 12. How public URLs stay unchanged

Every page sets an explicit `permalink`. Eleventy's default would be
`/events/index.html` (a directory URL); the explicit permalink emits
`events.html`. Proven by the generated pages landing at
`dist/build-test/chrome/index.html` and `dist/build-test/chrome/pl/index.html`.

At migration each page maps to `permalink: "{{ locale.urlPrefix }}<file>.html"`,
giving exactly the current addresses — no `/events/`, no `/en/`, no trailing
slashes, `.html` preserved.

## 13. What still prevents production cutover

1. **No public page is generated yet** — this phase produced chrome only.
2. **No content is migrated.** All five collections are still empty.
3. **Page bodies are not templated** — every page's unique markup remains
   hand-written HTML at the root.
4. **Asset passthrough is partial** — 14 files, only what the chrome needs. A
   full cutover needs all of `assets/`, `css/`, `js/`, plus `robots.txt` and
   `sitemap.xml`.
5. **No generated sitemap.** Still hand-maintained.
6. **The 404 `linkMode: "root"` path is untested** — supported, not exercised.
7. **JSON-LD generation is unimplemented** — the slot exists, nothing fills it.
8. Netlify still publishes the repository root, deliberately.

## 14. Risks for later page migrations

1. **Two sources of truth.** Until cutover, live pages are hand-edited root HTML
   while `src/` describes a parallel system. An edit to one does not reach the
   other. Keep the interim short.
2. **`ui.json` is now the single definition of every chrome string.** A typo
   there propagates to all 24 pages at once. It is also the file a future CMS
   will edit, so it needs review discipline.
3. **The `.active` class is now data-driven.** A page that forgets `activeNav`
   silently renders with no active nav item — visible, but easy to miss.
4. **Cascade-order slots are easy to confuse.** Putting `pbf.css` in
   `stylesheetsBefore` would load it before `style.css` and silently lose the
   PBF overrides. Comparison against the live page catches it; a casual eye
   would not.
5. **Extended `og:image` fields stay absent** on the eight pages lacking measured
   dimensions (§3.2). Fine, but do not let a future template invent them.
6. **`brandRows` must stay exactly five entries** — the CSS sizes the wordmark
   block to the badge height assuming five rows.
7. **Passthrough list will grow** and could drift from what pages reference. The
   validator's byte-identity check catches modification, not omission.

---

## 15. Markup → partial mapping

| Current live markup | New partial | Data source |
|---|---|---|
| `<meta charset>` … `<link rel="stylesheet" href="css/style.css">` | `partials/head.njk` | page front matter + `site.json` |
| `<header class="site-header">` … `<div class="nav-inner">` | `partials/header.njk` | `ui[locale]`, `site.logo` |
| `<a class="brand">` + `<img>` + `.brand-text` × 5 rows | `partials/header.njk` | `ui[locale].logoAlt`, `.brandRows` |
| `<nav aria-label="Main navigation">` … `</nav>` | `partials/navigation.njk` | `nav.primary`, `ui[locale].nav` |
| `.nav-toggle` burger (3 spans, `aria-expanded`) | `partials/navigation.njk` | `ui[locale].toggleMenuLabel` |
| `.nav-pbf` masked-logo item | `partials/navigation.njk` | `nav.primary[variant=pbf]` |
| `.nav-lambert` external item | `partials/navigation.njk` | `nav.primary[variant=lambert]` |
| `<nav class="lang-switch">` … `</nav>` | `partials/language-switcher.njk` | `locales`, page `urlPattern` |
| `<footer class="site-footer">` … `</footer>` | `partials/footer.njk` | `ui[locale].footer`, `site.social`, `nav.footerExplore` |
| `<script src="js/main.js">` | `partials/scripts.njk` | page `scriptsBefore/After` |
| `<!DOCTYPE html>` … `<body class>` … `</html>` | `layouts/base.njk` | page `bodyClass` |
| `<script type="application/ld+json">` | `extraHead` slot | page front matter |

---

## 16. Verification performed

- **Semantic comparison** (`scripts/compare-chrome.js`): generated header and
  footer are **identical to `events.html` and `pl/events.html`** after
  normalisation; 22 structural features present on both; nav and footer
  destinations match. 14 comparisons, all passing, wired into `npm run validate`.
- **Responsive**, in a real browser at **320 / 390 / 768 / 1280px**, both
  languages: zero horizontal overflow, header and footer inside the viewport,
  switcher visible, burger below 900px and desktop nav at 1280, no broken images.
- **Behaviour** at 390px: burger opens and closes (`body.nav-open`,
  `aria-expanded` flips, `pointer-events` toggles), no overflow while open,
  `main.js` runs, no console errors, `PL` link returns 200.
- **Determinism**: two consecutive clean builds byte-identical, the second under
  `TZ=Europe/Warsaw`.
- **Public files**: 178 tracked public files byte-identical before and after.
