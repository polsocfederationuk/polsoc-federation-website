# Cleanup baseline

**Phase 1 of the pre-CMS cleanup.** This document records the state of the live
site at the point tooling was added, so that any later refactor has something
concrete to be measured against.

**Nothing about the public site changed in this phase.** No markup, CSS, copy,
asset or URL was touched. Only new, non-shipping files were added.

Date: 27 July 2026 · Branch: `main` · Baseline commit: `da06bd3`

---

## 1. Public page inventory

24 pages: 12 English at the repository root, 12 Polish under `/pl/`.

| # | English URL | Polish URL | Indexed |
|---|---|---|---|
| 1 | `/` (`index.html`) | `/pl/` (`pl/index.html`) | yes |
| 2 | `/events.html` | `/pl/events.html` | yes |
| 3 | `/announcements.html` | `/pl/announcements.html` | yes |
| 4 | `/members.html` | `/pl/members.html` | yes |
| 5 | `/team.html` | `/pl/team.html` | yes |
| 6 | `/contact.html` | `/pl/contact.html` | yes |
| 7 | `/event-business-forum.html` | `/pl/event-business-forum.html` | yes |
| 8 | `/event-sikorski-debate.html` | `/pl/event-sikorski-debate.html` | yes |
| 9 | `/event-christmas-dinner.html` | `/pl/event-christmas-dinner.html` | yes |
| 10 | `/event-youth-congress.html` | `/pl/event-youth-congress.html` | yes |
| 11 | `/event-icebreaker.html` | `/pl/event-icebreaker.html` | yes |
| 12 | `/404.html` | `/pl/404.html` | **no** — `noindex, follow` |

22 indexable pages appear in `sitemap.xml`. Both 404 pages are deliberately
excluded from the sitemap and carry no canonical or hreflang.

Supporting files: `css/style.css`, `css/pbf.css`, `js/main.js`,
`js/announcements-data.js`, `js/societies-data.js`, `js/pl/announcements-data.js`,
`js/pl/societies-data.js`, `assets/**`, `favicon.ico`, `site.webmanifest`,
`robots.txt`, `sitemap.xml`.

---

## 2. English / Polish pairing rules

Pairing is **by identical filename** across the two trees. That identity is what
makes the language switcher, hreflang and sitemap generation a single rule. Full
detail is in `docs/BILINGUAL_SITE.md`; the load-bearing points are:

| Concern | Rule |
|---|---|
| Filenames | identical (`events.html` ↔ `pl/events.html`) |
| Homepages | `/` and `/pl/` |
| Shared assets | English `assets/…`, Polish `../assets/…` |
| Root-relative paths | `/favicon.ico`, `/assets/icons/…`, `/site.webmanifest` identical in both |
| Data files | `js/*.js` (EN) vs `js/pl/*.js` (PL) |
| Internal page links | **relative** in both trees, so each language stays in-language |
| Language switcher | **root-relative**, `aria-current="true"` on the active side |
| Language detection | `<html lang>` only — no redirects, no cookies, no auto-detect |
| Canonical | always self-referencing; a Polish canonical must never point at English |
| hreflang | `en` / `pl` / `x-default`, identical on both pages of a pair; `x-default` = English |

English is the default language. A visitor always lands on English unless they
click **PL** or follow a `/pl/` link.

---

## 3. Hosting and deployment assumptions

- **Netlify**, deploying from GitHub `polsocfederationuk/polsoc-federation-website`.
- Production branch **`main`** — configured in the Netlify UI. It is *not* set in
  `netlify.toml`, because Netlify takes the production branch from site settings
  and a value in the file would have no effect.
- **No build step.** The repository root is published as-is (`publish = "."`).
  `netlify.toml` deliberately declares **no** `command`.
- `package.json` exists **only** to run local validation. It is not a build
  dependency and Netlify does not need to install anything.
- Netlify serves the root `404.html` automatically. It has no concept of a
  per-directory 404, hence the `/pl/*` rule added in this phase.

---

## 4. Running the validation

```bash
npm run validate
```

Node 18+ required (developed against Node 24). No dependencies — the script uses
only Node's standard library, and there is no `node_modules` to install.

The script is **read-only**. It never rewrites a file, and in particular it never
touches `lastmod` values in `sitemap.xml`.

To serve the site locally:

```bash
python -m http.server 8000
```

Then browse `http://localhost:8000/` and `http://localhost:8000/pl/`.

Note that `python -m http.server` does **not** emulate Netlify's 404 handling, so
the Polish 404 rule cannot be tested locally — it must be verified on a deploy
preview (see `docs/MANUAL_REGRESSION_CHECKLIST.md`).

### Expected successful output

```
Validating C:\...\federacja website
12 English + 12 Polish pages

1. Page inventory and EN/PL pairing
2. HTML language attribute
3. Canonicals and hreflang
4. 404 pages
5. Sitemap
6. Internal links
7. Data-file asset paths
8. SEO metadata
9. Structured data
10. Load-bearing behaviours (regression guards)
11. Deployment configuration

================================================================
PASS — 54 checks, 0 problems
```

Exit code `0` on pass, `1` on failure. On failure each problem is printed under
its section with the offending files listed.

The validator was verified against a throwaway copy with six deliberate faults
injected (Polish canonical pointing at English, a page-relative announcement
image path, a removed `.ticker-clip` wrapper, a reintroduced SVG favicon, a 404
in the sitemap, and a broken internal link). All six were detected, so the pass
above is meaningful rather than vacuous.

---

## 5. Load-bearing behaviours

These look odd but are deliberate. Each one fixed a real bug; several are
guarded by the validator (marked ✔). **Do not "tidy" them.**

| Behaviour | Why | Guarded |
|---|---|---|
| The homepage ticker must stay wrapped in `.ticker-clip` | `.ticker` is `calc(100% + 48px)` wide so its rotated ends fall outside the frame. The wrapper uses `overflow-x: clip` (not `hidden`, which would also clip the intentional vertical spill and create a block formatting context). Without it the homepage overflows ~23px on a 375px phone. | ✔ |
| Announcement image paths are root-relative (`/assets/…`) | Paths in a data file resolve against the **page** URL, not the script URL. Relative paths 404 under `/pl/` as `/pl/assets/…`. This shipped as a live bug. | ✔ |
| Announcement `link.href` values stay **relative** | So each language resolves to its own event page (`/pl/announcements.html` → `/pl/event-*.html`). Making these root-relative would send Polish readers to the English site. **The opposite convention to images, on purpose.** | ✔ |
| A team member may have a **null photo** | Stefan Gayda-Pimlott has no headshot by design; the card renders `<div class="ph" data-label="…">` instead of an `<img>`. | ✔ |
| Mobile team grid is **two per row** | `@media (max-width: 600px)` sets `repeat(2, minmax(0, 1fr))`. One column only below 300px. The base grid (`auto-fill, minmax(240px, 1fr)`) would otherwise put one card per row on every phone. | ✔ |
| `.stats-grid` uses `minmax(0, 1fr)` | A bare `1fr` has an implicit min-content floor; the longer Polish stat labels pushed the Polish homepage 29px past a 320px screen. | ✔ |
| `.contact-grid` and `.social-list` use `minmax(0, 1fr)` + `min-width: 0` | Same trap: the contact card resolved to 483px inside a 327px grid, and the social row to 409px inside a 253px card (the long Facebook handle). | ✔ |
| Instagram embeds capped with `min(300px, 100%)` | Instagram's blockquote/iframe carry their own `min-width`, which overflowed a 320px screen. | ✔ |
| Partner logos are **duplicated** in the markup | The marquee needs two identical tile sets for a seamless loop. The duplicates carry `aria-hidden="true"`. Deleting them looks like de-duplication and breaks the animation. | ✔ |
| **No SVG favicon** is declared | Google does not use SVG for search-result favicons, and being typed and later in `<head>` it took priority. The set is ICO (16/32/48) + PNGs. | ✔ |
| `data-plain` on the Est. 2013 counter | Without it the counter renders `2,013` instead of `2013`. | ✔ |
| `aria-current="true"` on the active language link | Drives the switcher's active styling and announces state to screen readers. | ✔ |
| Society data: only `uni` is translated | Names, coordinates, emails, Instagram handles and logo filenames must stay byte-identical between `js/societies-data.js` and `js/pl/societies-data.js`, or the two maps drift apart. | ✔ |
| `js/main.js` is **not** duplicated per language | It reads `document.documentElement.lang` and picks from a `UI = { en, pl }` dictionary. New user-visible strings must be added to both halves. | |
| `pl/members.html` addresses society logos as `../assets/polsocs/…` | The path is built in inline page JS, so it is page-relative and must carry the `../`. | |
| Public URLs must not change | Every English and Polish URL is live, in the sitemap, and referenced by hreflang. Renaming a file breaks the pairing, the switcher and the sitemap simultaneously. | ✔ |

---

## 6. Known visual regression risks

The areas most likely to break in a future refactor, and what to watch:

1. **Mobile horizontal overflow.** Four separate causes have been fixed
   (`.ticker`, `.contact-grid`, `.social-list`, `.stats-grid`, plus the Instagram
   embed). `body { overflow-x: hidden }` exists in `css/style.css` but is a
   *last-resort safeguard only* — it hides overflow rather than fixing it. When
   auditing, temporarily neutralise it (`body { overflow-x: visible !important }`)
   or every element will look clipped and nothing will be flagged.
2. **The Business Forum page is a separate sub-brand.** `body.pbf-page` +
   `css/pbf.css`, its own hero, stats band, founders grid, two carousels, funding
   note, ball section and photographer cards. It is not the same template as the
   other four event pages.
3. **The announcements modal.** Card and modal share a `photoHTML()` renderer;
   `image: null` is a valid state (3 entries), as are `fit: "contain"` + `bg`.
4. **The members map.** Leaflet is locked to the UK with `zoomSnap: 0`, a fitted
   `minZoom`, and `maxBounds`. `#map` is capped at 840×700 and centred because the
   UK is tall and narrow; a full-width frame shows mostly sea.
5. **The homepage timeline rail.** Scroll progress is published as a single `--p`
   custom property that CSS turns into `scaleY()`. The previous implementation
   animated `height` against a CSS transition and visibly stuttered.
6. **The brand lockup.** Five wordmark rows total exactly the badge height, driven
   by `--badge-h: 48px`. Changing one without the other breaks the alignment.

---

## 7. What this phase changed

| File | Change |
|---|---|
| `netlify.toml` | **New.** Publishes the repo root, no build command, and maps `/pl/*` misses to `/pl/404.html` with a real 404 status. Non-forced, so valid Polish pages still resolve. |
| `package.json` | **New.** Declares `npm run validate` and `npm run serve`. No dependencies. Not used by Netlify. |
| `scripts/validate.js` | **New.** 54-check read-only validator (inventory, lang, canonical/hreflang, 404s, sitemap, links, data paths, SEO, JSON-LD, regression guards, deploy config). |
| `docs/CLEANUP_BASELINE.md` | **New.** This file. |
| `docs/MANUAL_REGRESSION_CHECKLIST.md` | **New.** Browser checks the script cannot perform. |

---

## 8. What this phase deliberately did **not** change

- No page was redesigned; no typography, colour, spacing or animation altered.
- No CSS reorganised, no class renamed.
- No asset folder moved, no image renamed, no public URL changed.
- No visible English or Polish copy edited.
- No content migrated to Markdown, JSON or YAML; no templates created.
- No CMS, static-site generator or framework introduced.
- No `lastmod` value in `sitemap.xml` rewritten.
- The homepage `Organization` schema, the event schemas and the Icebreaker's
  month-precision date were all left exactly as they were.
- Open content questions requiring committee input were **not** resolved —
  they remain listed in `docs/ADMIN_SYSTEM_AUDIT.md` §10.
