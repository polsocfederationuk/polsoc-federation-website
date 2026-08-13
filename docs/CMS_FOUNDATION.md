# CMS foundation (Phase 17A)

The local-development foundation for a non-technical admin panel, built on
Decap CMS. This phase covers **Team records** and the **central academic-year
setting** only. It is deliberately local-only: there is no production `/admin/`,
no authentication, and nothing in the deployed site changes.

---

## 1. Why Decap CMS

The repository already stores every page as structured YAML under `content/`,
rendered by Eleventy. What was missing was a way for a committee member who does
not use Git to change a role title or add next year's officers.

Decap fits that gap better than the alternatives because:

- **It edits the files that already exist.** Decap is a form over a Git
  repository, not a database with an export step. `content/team/*.yaml` stays the
  single source of truth, and `npm run validate` remains the final authority over
  what is correct. A hosted CMS would have introduced a second copy of the
  content and a synchronisation problem.
- **It is static.** No server, no database, no runtime dependency for visitors.
  The published site is exactly as it is today.
- **It has a local mode.** `decap-server` lets the whole panel run against the
  working tree with no accounts, no OAuth application and no cloud service — which
  is what makes this phase possible without touching production security.
- **Bilingual records survive intact.** Decap can map form sections onto the
  existing `en:` / `pl:` nesting, so one person stays one file.

The cost is that Decap rewrites YAML rather than patching it. §8 documents
exactly what that changes, and `npm run test:cms-roundtrip` proves it changes
nothing that matters.

### Versions

| Package | Version | Role |
|---|---|---|
| `decap-cms` | **3.15.1** (exact) | The browser bundle, vendored from `node_modules`, never a CDN |
| `decap-server` | **3.10.0** (exact) | The local file-system proxy |

Both are `devDependencies`, pinned without a `^` range and locked in
`package-lock.json`. There is no `latest` URL anywhere: the admin page loads
`./decap-cms.js` from its own directory, so the version cannot drift and the
panel works offline.

> `decap-cms`, not `decap-cms-app`. The latter is a UMD module that leaves React
> and ReactDOM as externals and does not initialise itself; dropped into a
> `<script>` tag it fails with a React-internals error. `decap-cms` is the
> self-contained build.

---

## 2. Local-only architecture

```
  browser  ──►  http://localhost:8001/admin/     (static, from dist/)
     │
     └──────►  http://127.0.0.1:8081/api/v1      (decap-server, fs mode)
                        │
                        └──►  reads and writes  content/  and  assets/team/
```

Three properties make this safe:

- **The proxy binds to `127.0.0.1`.** It grants write access to the repository,
  so it is reachable only from this machine, never from the local network.
- **The proxy runs in `fs` mode**, decap-server's default. It writes files and
  stops. The alternative, `MODE=git`, would create a commit on every save.
  Nothing here commits; you review with `git diff` and commit yourself.
- **`/admin/` does not exist in a normal build.** `eleventy.config.js` adds
  `src/admin/**` to Eleventy's ignore list unless `CMS_DEV=1` is set. A normal
  `npm run build` cannot emit an admin panel even by accident, which means an
  unauthenticated content editor cannot reach production. This mirrors the
  existing `BUILD_FIXTURES` pattern.

`npm run validate:cms` proves the last point by running both builds and checking
the output, rather than trusting the configuration to be right.

---

## 3. Starting the proxy

Terminal 1:

```bash
npm run cms:proxy
```

Leave it running. It prints the repository it is bound to and the port. Stop it
with `Ctrl+C`.

## 4. Starting the CMS-enabled site

Terminal 2:

```bash
npm run cms:serve
```

This builds with `CMS_DEV=1` and serves `dist/` on port 8001 — the same port
`npm run serve:dist` already uses, so no new server or port is introduced. It
also cleans first, so switching between a CMS build and a normal build can never
leave a stale `dist/admin/` behind.

Both commands are Node wrappers rather than inline `VAR=x cmd` prefixes, because
that syntax does not work in PowerShell or `cmd.exe`. They work unchanged on
Windows.

## 5. Local admin URL

```
http://localhost:8001/admin/
```

Click **Login**. There is no password: with the proxy backend that button just
connects to `localhost:8081`. If it hangs, the proxy in terminal 1 is not
running.

To rebuild after changing a template, re-run `npm run cms:serve`.

---

## 6. Team collection mapping

`content/team/` ⇄ the **Team** collection. Nothing was moved, renamed or
converted; the collection is declared `extension: yaml`, `format: yaml` to match
the files that already exist.

| Field in the CMS | YAML key | Widget | Notes |
|---|---|---|---|
| Record ID (filename) | `slug` | string | Pattern-validated; becomes the filename (§9) |
| Academic year | `academic_year` | string | Pattern `^\d{4}/\d{2}$`, always visible (§11) |
| Team group | `group` | select | Options generated from `team-groups.yaml` |
| Display position within the group | `order` | number (int, min 1) | Scoped to group **and** year |
| Published | `published` | boolean | Default `true` |
| Full name | `name` | string | |
| Photograph | `photo` | image | Uploads to `assets/team/`, stores `/assets/team/…` |
| E-mail address | `email` | string | Format-validated |
| LinkedIn profile | `linkedin` | string | Must be `https://www.linkedin.com/in/…` |
| English → Role title | `en.role` | string | Required |
| English → Photograph alt text | `en.photo_alt` | string | Only when there is a photograph |
| Polski → Nazwa funkcji | `pl.role` | string | Required, must not equal the English |
| Polski → Tekst alternatywny | `pl.photo_alt` | string | Only when there is a photograph |

The field order above is the order in the file. Decap sorts saved keys by the
configured field order, so a save produces a small diff rather than a reshuffle.

**Creation is enabled; deletion is not.** A deleted member is a deleted piece of
the Federation's history. To remove somebody from the site, switch **Published**
off — the record stays.

### Hidden technical fields

There are none, because Team records contain none. Every key in the schema is
editorial or structural information an editor legitimately owns. Nothing was
invented to have something to hide. (Other collections do carry template
discriminators; those arrive in 17B/17C and will be `hidden` widgets.)

### The group select

`group` is a select, never free text, so a typo cannot invent a seventh team
group that renders nowhere. The options are **generated** from
`content/settings/team-groups.yaml` at build time, because
`docs/TEAM_MIGRATION.md` §12 flagged the risk of a second hard-coded copy. The
editor sees `Trustees`, `Partnerships Officers`, …; the file stores `trustees`,
`partnerships`, …. `npm run validate:cms` fails if the two ever disagree.

### Display order

`order` is a whole number starting at 1, **scoped to the group and the academic
year** — the same scope `scripts/validate.js` enforces, so two people in
different groups may both be 1. Existing records are never renumbered.

---

## 7. English and Polish

One person is one file. The record keeps the existing shape:

```yaml
name: "Katie Taylor"          # shared — identical in both languages
en:
  role: "Events Officer"
  photo_alt: "Katie Taylor"
pl:
  role: "Specjalista ds. wydarzeń"
  photo_alt: "Katie Taylor"
```

In the CMS this is three groups: the shared fields, then **English**, then
**Polski**, as nested object widgets mapped directly onto `en:` and `pl:`.

**Decap's own i18n mode is deliberately NOT enabled.** Its `single_file`
structure produces a similar layout, but it also takes ownership of how locales
are written, and this repository's schema is already fixed and validated by
1121 checks. Explicit object widgets give exactly the shape the build expects,
with no dependency on Decap's locale handling continuing to serialise the way it
does today. `npm run validate:cms` asserts that i18n stays off and that no
per-language folder or filename can appear.

There is no `content/team/en/`, no `member.pl.yaml`, and no way to create one.

---

## 8. YAML serialization behaviour

Decap does not patch text. It parses the file to an object, applies the edit and
re-serialises from scratch, using `yaml`@1.10.3. The site parses with
`js-yaml`@4. Both libraries must agree, or a value could survive the save and
still break the build.

`npm run test:cms-roundtrip` replays the exact load/save cycle against all 21
real records and the settings file — 196 assertions — and compares
`js-yaml(original)` with `js-yaml(what Decap would write)`.

**What is preserved** (verified, not assumed):

- booleans stay booleans, integers stay integers
- `photo: null` stays an explicit null
- `known:` list items keep their order
- `/assets/team/…` paths are unchanged, and never acquire a `/pl/` prefix
- `en:` / `pl:` stay nested objects in one file
- `"2025/26"` is still the **string** `2025/26` under both parsers
- editing one field changes that field and nothing else

**What changes — formatting only:**

1. **Comments are dropped.** Decap reads with `doc.toJSON()`, which discards
   them. The explanatory header on each team record disappears the first time
   that record is saved through the CMS. This is Decap behaviour and cannot be
   configured away.
2. **Redundant quotes are dropped.** `academic_year: "2025/26"` becomes
   `academic_year: 2025/26`. Both parsers still read it as a string — an
   unquoted `2025/26` is not a valid number or date — so the meaning is
   identical.
3. **Blank-line grouping is lost.** The file becomes one continuous block.

A real save looks like this (Test A, verbatim):

```diff
-# Team member — 2025/26 committee.
-# Generated from the live pages during the Phase 4 migration; edit freely.
 slug: katie-taylor
-academic_year: "2025/26"
+academic_year: 2025/26
-  role: "Events Officer"
+  role: Senior Events Officer
```

No data was lost, no other record was touched, and `npm run validate` passed.

Files are **not** reformatted in bulk. A record changes only when somebody
actually saves it, so the comments disappear gradually and only where an editor
has been.

---

## 9. Team media handling

Uploads go to the existing headshot directory. Nothing was moved or renamed.

- **Upload directory:** `assets/team/`
- **Stored in YAML as:** `/assets/team/<file>` — root-relative, so the Polish
  pages resolve it correctly. A page-relative path would become
  `/pl/assets/team/…` and 404; `npm run validate:cms` asserts that no
  `/pl/assets/` path can be produced.
- **Formats:** JPEG or PNG, roughly square. Every existing headshot is `.jpg`.
- **External URLs are disabled** (`choose_url: false`). Every photograph must be
  a file in the repository, never a hotlink to somebody else's server.
- Existing photographs are never renamed or moved.

### A member with no photograph

Not every committee member has a headshot, and that is a legitimate state, not
an error. It has **two spellings on disk and one meaning**:

```yaml
photo: null        # hand-written records, e.g. stefan-gayda-pimlott
```
```yaml
# no `photo` key at all    — what Decap writes when the field is left empty
```

Decap has no way to write an explicit null: an image widget with no file selected
simply omits the key. `default: null` was tried in Phase 17A and **verified not to
work**. Requiring an explicit null therefore meant hand-editing YAML after
creating any photograph-less member — precisely the work the CMS exists to remove.

**The rule (Phase 17A.1):**

> `photo` may be **absent** or **explicitly null** — both mean "no photograph".
> If present and non-null, it must be a real Team asset.

Neither spelling is preferred and **no record was rewritten** to normalise them.
`photo: null` remains clearer when writing YAML by hand; absence is what the CMS
produces. Both are correct.

**Where the two are reconciled:** one place — `src/_data/records.js`, at the
boundary where records enter the build:

```js
if (dirName === "team" && record.photo === undefined) record.photo = null;
```

After that line, nothing downstream can tell the two forms apart, so no template
needs to know which serialization Decap used. The YAML on disk is untouched, and
**no second field** (`has_photo`, `photo_missing`, …) was introduced — presence is
serialization detail, not editorial content.

The card renders the placeholder either way:

```html
<div class="ph" data-label="Headshot"></div>   <!-- pl: data-label="Zdjęcie" -->
```

### What is still rejected

The relaxation applies **only** to absence. Anything present must be a real Team
asset, and each failure is reported by its own name rather than as a generic
"bad path":

| Value | Result |
|---|---|
| key absent | **accepted** — no photograph |
| `photo: null` | **accepted** — no photograph |
| `/assets/team/katie-taylor.jpg` | **accepted** |
| `photo: ""` | rejected — *empty-string photograph values* |
| `photo: 42` | rejected — *photograph values of the wrong type* |
| `https://elsewhere.example/x.jpg` | rejected — *external photograph URLs* |
| `C:\Users\someone\photo.jpg` | rejected — *local filesystem paths* |
| `/pl/assets/team/person.jpg` | rejected — *language-prefixed photograph paths* |
| `/assets/pbf/crowd.jpg` | rejected — not under `/assets/team/` |
| `/assets/team/does-not-exist.jpg` | rejected — *does not resolve to a real file* |

Every row is a negative control in `npm run test:team-rules`, which injects the
defect into a temporary record, runs the real validator and asserts that **that
specific message** fired. A rule that cannot fail proves nothing, so the tests
match on wording rather than on the exit code — a temporary extra member also
breaks the group counts, and "the validator failed" would not have been evidence
that the photo rule failed.

Alt text on a member with no photograph is still rejected: the relaxation did not
take its neighbours with it.

### File size

Decap's built-in media library has no `max_file_size` setting. No fake limit was
configured. Headshots are reviewed in `git diff` before committing like
everything else.

---

## 10. The academic-year model

One central setting decides what "now" means:

```yaml
# content/settings/academic-year.yaml
current: "2025/26"
known:
  - "2025/26"
```

**Format: `YYYY/YY`**, where the second component is the following calendar
year. `2025/26` and `2026/27` are valid; `2025/27` is not.

Validation is split, because a regular expression cannot add one to a number:

| Layer | Enforces |
|---|---|
| The CMS pattern `^\d{4}/\d{2}$` | The **shape**, as you type |
| `scripts/validate.js` | The **arithmetic** — that `YY` really is `YYYY`+1 |

`scripts/validate.js` remains the final authority.

The year field is a **validated string, not a select**. A select would have to be
edited every summer, and an editor could not add next year's committee if the
only permitted value were this year's. `2026/27`, `2027/28` and beyond need no
configuration change.

Page generation reads each record's own `academic_year` and compares it with
`current`. That is the whole mechanism, and it is deliberately boring: records
whose year does not match simply stop rendering. Nothing is deleted.

---

## 11. Which content types are year-scoped

### Academic-year rules

| Content type | Year scoped? | How |
|---|---|---|
| **Team** | **Yes** | One record per person **per year**. A returning member is two records. |
| **Announcements** | **Yes** | Past announcements keep their historical year. (Phase 17B) |
| **Standard events** | **Yes** | `order` is scoped **within** a year, not globally. (Phase 17C) |
| **Polish Business Forum** | **Yes — one record per edition** | A future edition is a new record; it never overwrites the current one. (Phase 17C) |
| **Member societies** | **No** | Societies are not annual. No year field is to be added. |
| **Site page content** | **No** | Homepage, contact and similar are not annual unless the schema explicitly says otherwise. |

## 12. Which are not

Member societies and page content, per the table above. This phase adds no
academic-year field to either, and none should be added later without a
deliberate decision — introducing one would silently make historical society
records disappear from the site.

---

## 13. How Team history works

Every Team record carries the year it belongs to. The team page renders only the
records matching `current`. So:

- The 2025/26 committee is 21 records, all `academic_year: "2025/26"`.
- Adding the 2026/27 committee means **adding records**, never editing the old
  ones.
- When `current` changes, the 2025/26 records stop rendering. They are still on
  disk, still editable, still in Git history.
- Nothing is deleted at any point.

`known:` lists the years that have content, ready for an archive UI.

## 14. The same person in two academic years

A person who serves two consecutive terms is **two annual memberships**, not one
record whose year gets overwritten:

```
content/team/jane-example.yaml            academic_year: "2025/26"
content/team/jane-example-2026-27.yaml    academic_year: "2026/27"
```

Both exist. Both are independently editable. The 2025/26 page keeps its own role
title and its own photograph.

### How the filenames avoid collision

`scripts/validate.js` requires every record's `slug` to equal its filename, and
Decap writes to `folder/<slug template>.yaml`. The collection therefore uses:

```yaml
slug: "{{fields.slug}}"
```

so the filename **is** the record's own `slug` field, and the invariant holds by
construction rather than by convention.

The convention for editors:

- first year → `jane-example`
- a later year → `jane-example-2026-27`

Existing records were **not renamed**. All 21 are 2025/26 and keep their bare
names; the year suffix is only needed the first time somebody returns.

**This does expose a technical identifier**, which the brief anticipated. Decap
cannot compose a filename from two fields and also write the result back into the
`slug` key, so the alternative was a filename the editor could not see or predict.

The field is presented as:

> **Record ID — must be unique**
>
> The unique identifier for THIS annual Team record. It becomes the filename, so
> it must not match any record that already exists. Use the person's name in
> lowercase with hyphens — for example `jane-example`. When somebody serves in a
> later committee year, leave their existing record alone and create a NEW one
> with a different ID, for example `jane-example-2026-27`. A year suffix is only
> needed to keep the second record distinct; a first record does not need one. Do
> not change this value when you are simply editing somebody's details.

### Format

```
^[a-z0-9]+(?:-[a-z0-9]+)*$
```

Lowercase letters, digits and single hyphens. `Jane Example`, `jane_example`,
`jane/example`, `../jane` and `JANE` are all rejected — by the CMS field pattern,
by the pre-save guard, by `npm run cms:check` and by `npm run validate`. Existing
slugs all already satisfy it; none was renamed.

### If an ID collides

Three independent things now stand in the way, so the same mistake is caught
whether it is made in the CMS, at the command line, or in a build:

**1. The CMS blocks the save.** `src/admin/index.njk` registers a `preSave`
listener — Decap's own public event — which asks the local proxy for the Team
folder listing and throws if the proposed ID already belongs to another file.
`persistEntry` awaits that handler as its first statement with no `try`, so
throwing aborts the save and the editor sees:

> A Team record with this ID already exists (content/team/jane-example.yaml). Use
> a different Record ID — for example jane-example-2026-27 for another committee
> year. The existing record has not been changed.

Nothing is patched or wrapped: the guard uses `CMS.registerEventListener` and the
proxy's documented `entriesByFolder` action, the same request Decap itself makes.
If it cannot reach the proxy it stands aside rather than blocking legitimate work,
because it is not the only protection.

**2. `npm run cms:check` finds it afterwards.** Should the guard ever not run —
an older build open in a tab, a future Decap that stops firing `preSave` — Decap's
own behaviour is to write `jane-example-1.yaml` while leaving `slug: jane-example`
inside. Nothing is overwritten, but filename and slug then disagree.
`cms:check` recognises that signature specifically and says so in editor language:

```
PROBLEM   this looks like a duplicate-ID collision
file      content/team/jane-example-1.yaml
detail    stored Record ID "jane-example" — but that ID already belongs to
          content/team/jane-example.yaml
do this   Decide which record this is. If it is a DIFFERENT annual membership,
          change its Record ID to something unique (for example
          "jane-example-2026-27") and rename the file to match. If it was created
          by mistake, delete content/team/jane-example-1.yaml.
          content/team/jane-example.yaml has not been modified.
```

It is read-only: it never renames, rewrites or deletes anything, because deciding
which record was meant is an editorial judgement, not a script's.

**3. `npm run validate` fails the build** on "every record's slug matches its
filename" and "every member slug is unique".

Run `npm run cms:check` after a CMS session. It also catches a repeated person in
one academic year, a Record ID that is not filename-safe, a photograph that points
at nothing, and leftover test records.

> A repeated **name** is not an error — that is exactly what a second term looks
> like, and `cms:check` reports it as normal. Uniqueness is a property of record
> identity, not of the person.

## 15. Rolling over to a new year

The order matters. Prepare first, switch last.

1. **Create the new committee's records.** Each with
   `academic_year: "2026/27"`, and a year-suffixed Record ID for anybody
   returning. Leave every 2025/26 record alone. The new records are on disk but
   render nowhere — the site is unchanged while you work.
2. **Check them.** `npm run build`, look at the team page. Still last year's
   committee, because `current` has not moved.
3. **Update the central setting.** In the CMS: *Site settings → Current academic
   year*. Set `current` to `2026/27` and add `2026/27` to *Known academic years*.
4. **Update the expected counts** in `scripts/validate.js` §14 (`CURRENT_YEAR`,
   `EXPECTED_GROUPS`) and the hero copy in `src/team.njk`, per
   `docs/TEAM_MIGRATION.md` §13.
5. **Verify.** `npm run clean && npm run build && npm run validate`.

Step 3 is the only step that changes what visitors see, and it is a single
deliberate action. The CMS never performs it as a side effect of anything else.

## 16. Why the CMS never mass-updates old records

There is no "roll over" button, and there should not be one.

A button that rewrote `academic_year` across existing records would destroy the
Federation's history in a single click: the 2025/26 committee would cease to have
ever existed, and the only recovery would be Git. The architecture makes the safe
path the easy one — adding records is additive, and the destructive operation is
simply not offered.

Concretely:

- Changing `current` moves the site's idea of "now". It edits **one file** and no
  content record. Verified in testing: the diff touched only
  `academic-year.yaml`.
- Creating a record never modifies another record. Verified: creating a member
  left all 21 existing files byte-identical.
- The CMS cannot delete Team records at all (`delete: false`).
- Both the academic-year field and the settings entry carry help text telling
  editors to create a new record rather than re-year an old one.

---

## 17. Deliberately excluded from this phase

Not implemented, by instruction:

- Announcements collection (17B)
- Standard Events collection, Business Forum form (17C)
- Member Societies, homepage and contact-page editing
- Production authentication of any kind — Netlify Identity, Git Gateway, GitHub
  OAuth, an OAuth proxy
- Editorial workflow and user permissions
- A production `/admin/` route
- Registrations, payments
- Any change to `netlify.toml` or the deployment

**Resolved in Phase 17A.1:**

1. ~~`photo: null` on CMS-created members.~~ Absent and null are now the same
   thing (§9). A photograph-less member can be created entirely through the CMS
   and needs no hand-editing.
2. ~~The `-1` suffix on a duplicate Record ID.~~ The save is now blocked before it
   happens, with `cms:check` and the validator as backstops (§14).

**Carried forward as unresolved:**

1. **The team group shows as a stored key in collection summaries** —
   `Jane Example — 2025/26 — trustees`, not `Trustees`. Decap's summary templates
   support only the `date` and `default` filters, so a select's value cannot be
   mapped back to its label, and storing the label as a second field would
   recreate exactly the divergence that generating the options from
   `team-groups.yaml` exists to prevent. The `view_groups` control does show
   readable labels, and the field itself shows them when the record is open.
2. **The pre-save guard is local-development-only by construction.** It reads the
   collection through the local proxy. When production authentication arrives the
   lookup will need to go through the real backend, or move server-side.
3. **`npm audit` reports vulnerabilities** in the Decap dependency tree. These
   are development-only packages: `decap-cms` ships as a pre-built browser bundle
   that never reaches the deployed site, and `decap-server` runs only on a
   developer's machine bound to localhost. No production surface is affected.

## 18. What production authentication will require

None of this is built yet. When `/admin/` is eventually exposed:

- **An identity provider.** Netlify Identity with Git Gateway is the least
  work; GitHub OAuth via an OAuth proxy avoids a second account system but needs
  a small hosted service. Either way it is a real decision with real
  consequences, which is why it is its own phase.
- **`backend.name` changes** from `proxy` to the real backend, and
  `local_backend: true` becomes how developers keep working locally. The
  collection schema — every field in §6 — is unaffected.
- **The build gate changes.** Today `/admin/` is absent from production because
  it must be. That inverts: the page must ship, and the protection moves to
  authentication. `npm run validate:cms` will need its §11 assertions rewritten
  to match, and that inversion should be a conscious, reviewed change rather than
  a quiet one.
- **A real invite and role model.** Who can edit, who can publish, what happens
  when a committee member graduates.
- **Editorial workflow** becomes worth having, since edits would no longer be
  reviewed via `git diff`.

Until then: local only, `git diff` is the review step, and production is
unchanged.

---

## Commands

| Command | Does |
|---|---|
| `npm run cms:proxy` | Start the local file-system proxy (terminal 1) |
| `npm run cms:serve` | Build with `/admin/` and serve on :8001 (terminal 2) |
| `npm run build:cms` | Build with `/admin/` without serving |
| `npm run validate:cms` | Static validation of the CMS configuration |
| `npm run cms:check` | **Content integrity after editing, in editor language** |
| `npm run test:cms-roundtrip` | Prove a CMS save cannot corrupt a record |
| `npm run test:team-rules` | Negative controls for the photo and Record ID rules |
| `npm run test:announcement-rules` | Negative controls for the announcement rules |
| `npm run build` | **Normal build — contains no `/admin/`** |

> **Announcements** were added in Phase 17B — see `docs/CMS_ANNOUNCEMENTS.md`
> for that collection's schema, its academic-year and ordering rules, Markdown
> safety, imagery, event and external links, and the publication-date trap.

## Files in this phase

| File | Status | Purpose |
|---|---|---|
| `src/_data/cmsConfig.js` | new | The CMS schema, as data. Single source of truth. |
| `src/admin/index.njk` | new | The admin entry point + duplicate-ID guard (CMS_DEV only) |
| `src/_data/records.js` | modified | Normalises an absent Team `photo` to null (17A.1) |
| `scripts/validate.js` | modified | Absent-or-null photo rule, itemised path checks (17A.1) |
| `scripts/cms-check.js` | new | Editor-facing content integrity check (17A.1) |
| `scripts/test-team-rules.js` | new | Negative controls for photo and Record ID (17A.1) |
| `docs/TEAM_MIGRATION.md` | modified | §9 amended for the absent-or-null rule (17A.1) |
| `src/admin/config.njk` | new | Renders `config.yml` (CMS_DEV only) |
| `scripts/build-cms.js` | new | `CMS_DEV=1` build wrapper |
| `scripts/cms-proxy.js` | new | Proxy launcher, pinned to localhost + `fs` mode |
| `scripts/cms-serve.js` | new | Build + serve for terminal 2 |
| `scripts/validate-cms.js` | new | 121 CMS configuration checks |
| `scripts/test-cms-roundtrip.js` | new | 196 YAML round-trip assertions |
| `eleventy.config.js` | modified | `CMS_DEV` gate + Decap bundle passthrough |
| `package.json` | modified | Pinned devDependencies and the `cms:*` scripts |
| `package-lock.json` | modified | Locks both Decap versions |
| `docs/CMS_FOUNDATION.md` | new | This document |

No file under `content/`, `css/`, `js/`, `assets/` or `netlify.toml` was changed.
Phase 17A.1 changed `scripts/validate.js` and `src/_data/records.js`, both build
tooling; the generated production site is byte-for-byte identical either way.
