# Federation of Polish Student Societies in the UK — website

Source for the bilingual (English / Polish) website of the **Federation of Polish
Student Societies in the UK**, a UK-registered charity (charity number **1166785**),
live at <https://polsocfederation.pl>.

**Code is MIT licensed. Photographs, logos and site content are NOT — see [NOTICE](NOTICE).**

[LICENSE](LICENSE) is the MIT licence and covers the software only: the Eleventy
build, the Nunjucks templates, the CSS and JavaScript, the Netlify Functions and
the scripts. [NOTICE](NOTICE) lists what it excludes — every file under `assets/`,
the Federation logo and wordmark, the member-society and sponsor logos, the
photographs of identifiable people, and the editorial text under `content/` and
`src/_data/ui.json`. Reusing the code means replacing that material with your own.

This site is powered by [Netlify](https://www.netlify.com).

---

## Contents

- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Build and verification order](#build-and-verification-order)
- [Content](#content)
- [The content manager](#the-content-manager)
- [Reusing this project](#reusing-this-project)
- [Contributing, conduct and security](#contributing-conduct-and-security)

## Architecture

- **Static site generator:** [Eleventy](https://www.11ty.dev) 3 (`^3.1.6`), with
  Nunjucks templates and data files under `src/`, built to `dist/`.
- **Canonical content:** YAML records under `content/`. Templates read them
  through the data modules in `src/_data/`.
- **Hosting:** Netlify. `netlify.toml` declares
  `command = "npm run build:production"`, `publish = "dist"` and
  `functions = "netlify/functions"`. The production branch is set in the Netlify
  UI, not in `netlify.toml`.
- **Why `build:production` and not `build`:** it sets `CMS_TARGET=production`,
  which is the only thing that puts the content manager into `dist/admin/` and
  points it at the same-origin `/api/cms` function. A plain `npm run build`
  produces a site with **no admin panel at all** — which is what every local
  build and every test does.
- **Content manager:** [Decap CMS](https://decapcms.org) pinned at `3.15.1`,
  served at `/admin/` and configured by `src/_data/cmsConfig.js` (generated, not
  a hand-written `config.yml`).
- **Writes:** Netlify v2 Functions — `netlify/functions/cms.mjs` and
  `netlify/functions/bulk.mjs`, exposed as `/api/cms` and `/api/bulk/*` by
  redirects in `netlify.toml`. Each verifies the signed-in Netlify Identity user
  and their role **server-side on every request**, then commits to GitHub using a
  GitHub App. The browser never receives GitHub credentials. Git Gateway is
  deliberately not used.
- **Access to `/admin/`:** Netlify checks the role in the `nf_jwt` cookie at the
  edge before serving anything under `/admin/`; anyone without the `editor` or
  `admin` role is sent to `/staff-login/`. Every write function checks the role
  again for itself.
- **Node:** `>= 18` (`engines` in `package.json`). There is deliberately no
  `.nvmrc` — `package.json` is the single tracked declaration.

## Repository layout

| Path | What it is |
|---|---|
| `src/` | Nunjucks templates, layouts, partials, data modules, the admin page and the staff login page |
| `content/` | canonical YAML records — the site's content |
| `css/`, `js/main.js` | the shared stylesheets and the shared behaviour script, **still live**: passed through into `dist/` by `eleventy.config.js` |
| `netlify/functions/`, `netlify/lib/` | the CMS API functions and the libraries they share (session, authorisation, rules, GitHub) |
| `scripts/` | build, validation, comparison and test scripts |
| `docs/` | technical documentation, one file per migration phase |
| `dist/` | build output (gitignored; not in the repository) |

### The hand-written HTML at the repository root is superseded

The repository root still contains the **previous, hand-written** site:
`index.html`, `team.html`, `events.html`, `event-business-forum.html`,
`event-sikorski-debate.html`, `event-christmas-dinner.html`,
`event-youth-congress.html`, `event-icebreaker.html`, `announcements.html`,
`members.html`, `contact.html`, `404.html`, `pl/*.html` and the scripts in `js/`.

**Those pages are not served any more.** Netlify publishes `dist/`, which Eleventy
generates from `src/` and `content/`. The root HTML is kept deliberately, for two
reasons:

1. it is the rollback surface, and
2. it is the baseline that the comparison suites (`scripts/compare-*.js`) diff the
   generated pages against, byte for byte.

The one exception is `css/` (and `js/main.js`), which are shared by both and are
still live.

## Getting started

```sh
npm install
npm run build        # -> dist/, the public site, with NO admin panel
npm run serve:dist   # http://localhost:8001
```

The main scripts (all declared in `package.json`):

| Script | What it does |
|---|---|
| `npm run clean` | remove build output |
| `npm run build` | Eleventy build of the public site into `dist/` |
| `npm run build:production` | what Netlify runs: clean, bundle the Identity client, build with `CMS_TARGET=production`, then verify the output really contains `/admin/` and `/staff-login/` and no local endpoint or credential |
| `npm run build:identity` | bundle `@netlify/identity` for the staff login page (self-hosted, not a CDN) |
| `npm run build:cms` | the local development admin, built into `.cms/` — never into `dist/` |
| `npm run build:fixtures` | the architectural fixture pages, into the gitignored `.fixtures/` |
| `npm run validate` | static validation of the build |
| `npm run validate:cms` | static validation of the admin configuration and rules |
| `npm run test:cms-production` | the production CMS suite (session, roles, rules, GitHub adapter, generated admin) |
| `npm run test:bulk` | the bulk-manage suite |
| `npm run test:cms-roundtrip` | a record survives a CMS save unchanged |
| `npm run cms:dev` | run the local CMS (proxy + site server) against the working tree |
| `npm run cms:check` | read-only content integrity check on the records, reported in editor language |
| `npm run audit:dist`, `npm run crawl:dist`, `npm run audit:public-parity`, `npm run compare:sitemap` | audits of the generated site |
| `npm run compare:chrome`, `npm run compare:homepage`, `npm run compare:team`, … | byte-for-byte comparisons against the superseded root HTML |

`scripts/` holds more of the same; `package.json` is the full list.

### Two scripts with side effects worth knowing

- **`npm run compare:chrome`** reads the development fixture pages, which a
  production build deliberately excludes. Run `npm run build:fixtures` first — it
  writes to the gitignored `.fixtures/`.
- **`npm run audit:events`** is advisory, and rewrites
  `docs/EVENT_SOURCE_MATRIX.json` as a side effect.

## Build and verification order

**The order matters, and getting it wrong fails silently.** `npm run validate:cms`
runs a plain Eleventy build as part of proving that the admin panel is
development-only, and that build leaves `dist/` with **no** `dist/admin/`. If
`build:production` ran before it, the production admin is gone by the time the
tests look for it — and `npm run test:cms-production` then skips its whole
"the deployed admin talks to production" section (about 45 assertions, roughly 270
down to roughly 225) while still printing **PASS**.

So run them in this order:

```sh
npm run clean
npm run validate:cms
npm run build:production
npm run test:cms-production
npm run test:bulk
```

## Content

`content/` holds the canonical records, as YAML:

| Path | Records |
|---|---|
| `content/announcements/` | announcements |
| `content/events/` | events |
| `content/team/` | committee members, one record per person per academic year |
| `content/societies/` | member Polish societies |
| `content/pages/` | copy for the standing pages (home, events, contact, 404) |
| `content/settings/` | site settings, including `academic-year.yaml`, which names the current academic year |

`content/settings/academic-year.yaml` is the single source of truth for the
current academic year. It drives the multi-year sectioning on the Team, Events and
Announcements pages, via `src/_data/academicYear.js` and `netlify/lib/rules.js`.

**Content is edited through the content manager, not by hand.**

## The content manager

At a high level:

- Editors sign in at `/staff-login/` with Netlify Identity. Accounts are
  **invite-only** — there is no public sign-up — and roles (`editor`, `admin`) are
  assigned by an administrator.
- Netlify checks the role at the edge before serving `/admin/`. Without it, the
  request is redirected to `/staff-login/`.
- Decap CMS runs at `/admin/` and posts saves to the same-origin `/api/cms`
  function. Bulk manage posts to `/api/bulk/*`.
- Those functions verify the user and role again server-side, apply the content
  rules in `netlify/lib/rules.js`, and commit to the repository with a GitHub App.
  The commit is attributed to the person who made it. The browser is never given
  a GitHub credential, and cannot name a repository path.
- A commit triggers a Netlify build, which is how the change reaches the site.

`docs/CMS_PRODUCTION.md` has the detail.

## Reusing this project

If you are another student society or nonprofit and want to run your own copy,
start with **[docs/OPEN_SOURCE_REUSE.md](docs/OPEN_SOURCE_REUSE.md)**. It covers
the Netlify site, your own GitHub App, every environment variable, invite-only
Identity, and the list of things that are hard-coded to this Federation and must
be changed.

Read [NOTICE](NOTICE) first: the imagery and the site text are not yours to reuse.

## Contributing, conduct and security

- [CONTRIBUTING.md](CONTRIBUTING.md) — how to propose a change
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — the code of conduct for this project
- [SECURITY.md](SECURITY.md) — how to report a vulnerability privately

General contact: <contact@polsocfederation.pl>. Technical and rights enquiries:
<it@polsocfederation.pl>.
