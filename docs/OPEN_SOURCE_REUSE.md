# Running your own copy

This guide is for another Polish student society, another student organisation, or
another small nonprofit that wants to run a site like this one: a bilingual static
site with an invite-only content manager that commits to its own repository.

Everything below is derived from what the code actually requires, with the file
that proves it named alongside. Read [../NOTICE](../NOTICE) before you start: the
MIT licence covers the code, and **not** the photographs, the logos or the site
text. Reusing this means replacing all of that with your own.

Order of the sections is the order to do them in.

1. [Fork and build locally](#1-fork-and-build-locally)
2. [Create the Netlify site](#2-create-the-netlify-site)
3. [Create your own GitHub App](#3-create-your-own-github-app)
4. [Environment variables](#4-environment-variables)
5. [Netlify Identity: invite-only, with roles](#5-netlify-identity-invite-only-with-roles)
6. [The first deploy, and how to tell it worked](#6-the-first-deploy-and-how-to-tell-it-worked)
7. [What is hard-coded to this Federation](#7-what-is-hard-coded-to-this-federation)
8. [What this is not](#8-what-this-is-not)

---

## 1. Fork and build locally

Node **18 or newer** (`engines.node` in `package.json`; Eleventy 3 requires it).
There is deliberately no `.nvmrc`.

```sh
npm install
npm run build        # -> dist/
npm run serve:dist   # http://localhost:8001
```

What a local build gives you is **the public site with no admin panel at all**.
That is not a misconfiguration: the admin is emitted only when
`CMS_TARGET=production` is set, and only `scripts/build-production.js` sets it
(`eleventy.config.js`, the `CMS_PRODUCTION` branch of the passthrough block).
Every local build and every test therefore runs against a site with no `/admin/`.

To work on the admin locally, `npm run build:cms` builds it into `.cms/` —
deliberately *not* into `dist/`, because `npm run clean`, `npm run build` and
`npm run validate:cms` all delete `dist/` and used to pull the files out from
under a CMS an editor had open. `npm run cms:dev` runs the local CMS against your
working tree; it writes files, it does not commit.

Before you go further, read
[Build and verification order](../README.md#build-and-verification-order) in the
README. `npm run validate:cms` clears `dist/admin`, so `build:production` must run
*after* it or the production CMS suite silently skips a whole section.

## 2. Create the Netlify site

Connect the repository as a new Netlify site. The build settings are already
declared in `netlify.toml`, so Netlify picks them up:

```toml
[build]
  command = "npm run build:production"
  publish = "dist"
  functions = "netlify/functions"
```

Three things to know:

- **`command` and `publish` are inseparable.** `dist/` is gitignored, so
  Netlify's checkout contains no `dist/` at all. Without the build command
  Netlify would publish an empty directory.
- **`npm run build:production`, not `npm run build`.** It sets
  `CMS_TARGET=production`, which is the only thing that puts the content manager
  into `dist/admin/` and points it at the same-origin `/api/cms` function. It then
  reads the generated output back and refuses the build if the deployed admin
  contains a `localhost` endpoint, a Windows path, or anything shaped like a
  credential (`scripts/build-production.js`, `verify()`).
- **The production branch is set in the Netlify UI, not in `netlify.toml`.**
  Netlify takes the production branch from site settings; declaring it in the file
  would have no effect. `netlify.toml` says so in a comment.

`netlify.toml` also carries the redirects that expose `/api/cms` and
`/api/bulk/*`, the role gate on `/admin/`, the Polish 404 rule, and the security
headers for the operational routes. You should not need to change any of them,
but read them — they are commented.

## 3. Create your own GitHub App

**Create your own. Do not try to reuse this project's.** The App is what commits
to *your* repository, and its private key is a real secret.

GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.

### Permissions it needs

Derived from `netlify/lib/github.js`, which is the only thing in the codebase that
talks to GitHub:

| Permission | Level | Why |
|---|---|---|
| Repository → **Contents** | **Read and write** | the only permission the code needs |
| Repository → **Metadata** | Read-only | GitHub grants this automatically and mandatorily alongside Contents |

**Nothing else.** No Pull requests, no Issues, no Actions, no organisation
permissions, no user permissions, no webhooks. The App does not need to be public
and does not need a callback URL.

The evidence is the complete set of endpoints the adapter calls, all against
`https://api.github.com/repos/<owner>/<repo>`:

- `/contents/...` — read a file, read a folder listing
- `/git/ref/heads/<branch>` — find the current head
- `/git/commits/<sha>` — read the commit at that head
- `/git/blobs` — create a blob per changed file
- `/git/trees` — create the new tree
- `/git/commits` — create the commit
- `/git/refs/heads/<branch>` — `PATCH` to move the branch

### Install it, and note two numbers

Install the App on **the one repository**, not on all of them. Then note:

- the **App ID** — a number, on the App's own settings page
- the **Installation ID** — a number, on the installation's settings page

> **Warning.** The Installation ID is the **number at the end** of the GitHub
> settings URL, not the URL itself. Pasting the whole URL is a mistake that has
> actually happened on this project, and it breaks every CMS write while looking
> like something else entirely — every refusal from GitHub's token endpoint
> becomes the same opaque 502 for the editor. See the comment at
> `scripts/test-cms-production.js` §1f, which exists because of it, and the
> allow-listed refusal logging in `netlify/lib/github.js` (`classifyRefusal`)
> which is what finally made it diagnosable.

### The private key

Generate a private key for the App and download the `.pem`. **It is a real
secret.** In this architecture it lives in exactly one place: a Netlify
environment variable. It is never committed, never sent to the browser, and never
logged — `scripts/build-production.js` fails the build if anything shaped like a
private key or a token reaches `dist/`, and the production CMS suite asserts that
no key material, JWT, `Authorization` header or session cookie appears in a log
line.

### Concurrent edits are safe by construction

The `PATCH` that moves the branch sends `force: false`
(`netlify/lib/github.js`). So if two editors save at once, the second gets a
clean **409 — "somebody else changed the site while you were working"** rather
than silently overwriting the first. A commit whose expected head no longer
matches is refused before anything is written.

## 4. Environment variables

Set these in Netlify → Site configuration → Environment variables.

**Names and purpose only below. Do not put values in any file in the repository.**

| Variable | What it is | Read when |
|---|---|---|
| `CMS_GITHUB_APP_ID` | your GitHub App's numeric App ID | runtime — `netlify/lib/github.js`, `fromEnvironment` |
| `CMS_GITHUB_INSTALLATION_ID` | the numeric installation ID of that App on the repository | runtime — same place |
| `CMS_GITHUB_PRIVATE_KEY` | the App's PEM private key. **The only true secret in this list.** An escaped `\n` form is handled (`normaliseKey`) | runtime — same place |
| `CMS_GITHUB_REPO` | `owner/repo`. Split on `/` by `netlify/lib/github.js`; a value with no slash is rejected with a clear message rather than guessed | runtime |
| `CMS_GITHUB_BRANCH` | the branch the CMS commits to. Defaults to `main` | **both** — runtime in `netlify/lib/github.js`, and build time in `src/_data/cmsConfig.js` line 40, where it is baked into the generated admin configuration as the backend branch |
| `CMS_CURRENT_ACADEMIC_YEAR` | optional runtime override of the current academic year, read at `netlify/lib/rules.js` line 275. Normally **unset** — the source of truth is `content/settings/academic-year.yaml` | runtime |
| `URL` | set by Netlify to the site's own address. `netlify/lib/session.js` prefers it as the trusted origin, deliberately, because it cannot be influenced by a forged `Host` header | runtime |

`CMS_TARGET` is **not** something you configure in Netlify.
`scripts/build-production.js` sets it to `production` itself, for the Eleventy
child process only. That is what puts the admin into `dist/admin/`.

If any of the first four are missing, `fromEnvironment` returns a list of what is
missing instead of half-working.

There are also development-only knobs, read by the local CMS scripts —
`CMS_PROXY_PORT`, `CMS_SITE_PORT`, `CMS_DEV`, `CMS_QUIET`, `BUILD_FIXTURES`. None
of them belong in a production Netlify site.

### Scope the secret to Production only

This matters once your repository is public. Only `CMS_GITHUB_BRANCH` is read at
build time, and it falls back to `"main"`, so **nothing about a build needs the
private key**. Scope `CMS_GITHUB_PRIVATE_KEY` (and, if you like, the App and
installation IDs) to the **Production** deploy context alone. Otherwise a
stranger's pull request would be built with your site's environment variables
available to it.

## 5. Netlify Identity: invite-only, with roles

Enable Netlify Identity on the site and set registration to **invite only**.
There must be no public sign-up.

Two roles are recognised, in `netlify/lib/authz.js`:

- **`editor`** — may create and update records
- **`admin`** — may also permanently remove a record (`ADMIN_ONLY_ACTIONS`, which
  holds exactly `deleteFiles`) and change the site settings under
  `content/settings/` (`adminOnly` in `netlify/lib/paths.js`)

Assign roles yourself, from Netlify → Identity → the user → Edit roles. An account
nobody gave a role to gets a session that grants nothing.

Access to `/admin/` is enforced twice, on purpose:

1. **At the edge.** Netlify checks the role in the `nf_jwt` cookie before any file
   under `/admin/` is served. The rules are in `netlify.toml`:

   ```toml
   [[redirects]]
     from = "/admin/*"
     to = "/admin/:splat"
     status = 200
     conditions = {Role = ["editor", "admin"]}

   [[redirects]]
     from = "/admin/*"
     to = "/staff-login/"
     status = 302
   ```

   **Their order matters.** Netlify uses the first matching rule, so the
   role-conditioned one has to come first. Swapping them sends signed-in editors
   to the login page forever.

2. **Server-side, on every write.** `netlify/functions/cms.mjs` and
   `netlify/functions/bulk.mjs` verify the signed-in user and their role again for
   themselves, from the verified user and never from the request body. An attacker
   who reaches the admin page without a session gets a CMS that cannot read or
   write anything.

## 6. The first deploy, and how to tell it worked

Deploy, then check these in order. Each one isolates a different piece.

1. **The build succeeded and produced the admin.** `build:production` prints
   `production build complete: dist/ contains the site, /admin/ and /staff-login/`.
   If it refused instead, it lists exactly what was wrong.
2. **`/staff-login/` loads.** It should load with no third-party script: the
   Identity client is bundled from the pinned package by
   `scripts/build-identity.js` and served from your own origin.
3. **`/admin/` redirects you to `/staff-login/` while signed out.** That is the
   edge role check doing its job. If `/admin/` loads for a signed-out visitor,
   your redirect rules are in the wrong order.
4. **An invited editor can sign in and reach `/admin/`.** Invite yourself first,
   accept the invitation, and confirm the role is set.
5. **A save works end to end.** Edit one record, save, and confirm the change
   appears as a **commit on the branch named by `CMS_GITHUB_BRANCH`**, attributed
   to the person who made it. That commit is what triggers the next Netlify build,
   which is how the change reaches the public site.

If a save fails with a 502, the App credentials are the first place to look — and
re-read the Installation ID warning in section 3.

## 7. What is hard-coded to this Federation

You must change all of this. It is not configuration-driven; it is a real
charity's site.

### `src/_data/site.json` — go through it line by line

The whole file is Federation-specific: `domain`, `shortName`, `logo`, `email`,
`charityNumber`, `themeColor`, `fontsHref` (the Google Fonts request for this
site's four typefaces), `defaultOgImage` with its width and height, the three
`social` URLs, `lambertUrl`, and the whole `organization` block — the Polish legal
name, the alternate names, the logo and image, the founding date, the charity
identifier, the postal address, and the `sameAs` list.

### The specifics, and everywhere else they appear

| Thing | Where |
|---|---|
| the domain `https://polsocfederation.pl` | `src/_data/site.json` (`domain`), and also `scripts/validate.js`, `scripts/compare-sitemap.js`, `scripts/audit-public-parity.js`, `scripts/compare-standard-events.js`, `scripts/compare-contact.js` and `scripts/test-cms-production.js` |
| the UK charity number `1166785` | `src/_data/site.json` (`charityNumber`, and `organization.identifier.value`) and `src/_data/ui.json` — the footer charity line, in **both** languages |
| `contact@polsocfederation.pl` | `src/_data/site.json` (`email`, and `organization.email`) |
| `it@polsocfederation.pl` | the Code of Conduct, `SECURITY.md` and `NOTICE` — the rights and security contact |
| the brand colour `#d7282f` | `src/_data/site.json` (`themeColor`), plus the CSS custom properties in `css/style.css` (including inside several inline `data:` SVG backgrounds) |
| the logo, the icons and the social banner | `src/_data/site.json` (`logo`, `defaultOgImage`, `organization.logo`), `assets/icons/*`, `assets/social/`, `favicon.ico`. **All of these are excluded from the MIT licence by `NOTICE` — you must supply your own** |
| the English/Polish language pair | the whole bilingual structure: the two locale blocks in `src/_data/ui.json`, and the `pl/` output prefix |
| the academic-year convention (e.g. `2026/27`) | `content/settings/academic-year.yaml`, read through `src/_data/academicYear.js` and `netlify/lib/rules.js`. The multi-year sectioning on the Team, Events and Announcements pages is built on it, and `parseAcademicYear` rejects anything that is not `YYYY/YY` with a consistent second half |
| the content paths | `content/announcements/`, `content/events/`, `content/team/`, `content/societies/`, `content/pages/`, `content/settings/` — and the CMS collections that mirror them in `src/_data/cmsConfig.js` |

### About the CMS collections specifically

`src/_data/cmsConfig.js` defines four collections: **Team** (`content/team`),
**Events** (`content/events`), **Announcements** (`content/announcements`) and
**Site settings** (the single file `content/settings/academic-year.yaml`). The
society records and the standing-page copy are *not* CMS-editable; they are edited
in the repository.

The config is generated rather than hand-written so that option lists cannot drift
from the data — the team `group` select is derived from
`content/settings/team-groups.yaml`, and the event choices on an announcement are
derived from the real event records. Field order in that file is load-bearing:
Decap sorts its YAML output by it, which is what keeps a CMS save producing a
small, readable diff.

### The comparison suites will be meaningless to you

`scripts/compare-*.js` diff the generated pages, byte for byte, against **this
Federation's** superseded hand-written HTML at the repository root. Once you have
replaced the content, those suites are comparing your site to somebody else's old
site. Do not try to make them pass; delete them, or leave them alone and ignore
them. `npm run validate`, `npm run validate:cms`, `npm run test:cms-production`
and `npm run test:bulk` remain useful — they test the build and the CMS, not this
Federation's copy.

## 8. What this is not

This is a real charity's website, published as open source because the code is
worth sharing — not a template product.

There is no theme system, no plugin API, no configuration layer that abstracts the
Federation away, and no upgrade path: if this repository changes later, nothing
will merge those changes into your fork for you. What you are doing is forking a
working site and editing it, and that is the honest description of the work
involved.

Everything under `docs/` is a record of how the real migration was done, one file
per phase. `docs/BUILD_ARCHITECTURE.md` and `docs/CMS_PRODUCTION.md` are the two
most useful to a reuser.
