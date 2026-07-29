# Contact and 404 migration (Cleanup Phase 9)

The bilingual contact page and both branded 404 pages are now generated from
structured content. Two YAML records under `content/pages/` drive four generated
pages: `dist/contact.html`, `dist/pl/contact.html`, `dist/404.html` and
`dist/pl/404.html`.

**The live site has not changed.** Netlify still publishes the repository root,
so `contact.html`, `pl/contact.html`, `404.html` and `pl/404.html` are still what
the public sees. Every comparison in `scripts/compare-contact.js` and
`scripts/compare-404.js` passes, which is the evidence that the eventual cutover
will be a no-op.

This phase is also the **first to exercise root-link mode**, which Phase 3 built
for exactly this case and left untested until now (§9).

Related reading: [BUILD_ARCHITECTURE.md](BUILD_ARCHITECTURE.md),
[SHARED_CHROME_MIGRATION.md](SHARED_CHROME_MIGRATION.md),
[TEAM_MIGRATION.md](TEAM_MIGRATION.md),
[ANNOUNCEMENTS_MIGRATION.md](ANNOUNCEMENTS_MIGRATION.md),
[MEMBERS_MIGRATION.md](MEMBERS_MIGRATION.md).

---

## 1. Contact-page content schema

One record: `content/pages/contact.yaml`.

```yaml
slug: contact
published: true

contact_email: "hello@example.org"

address:
  street_lines:
    - "12 Example Street"
    - "Exampleton EX1 2YZ"

social_links:
  - key: instagram
    url: "https://www.instagram.com/example/"
    label: "Instagram"
    handle: "@example"

initiatives:
  - key: example-initiative
    logo: "/assets/example/logo.jpg"
    title: "Example Initiative"
    links:
      - icon: linkedin
        url: "https://www.linkedin.com/company/example/"
        external: true
        label_key: linkedin

en:
  title: "Contact | Example Organisation"
  description: "…"
  og_image_alt: "…"
  eyebrow: "Get in touch"
  h1_lead: "Get in "
  h1_fancy: "touch"
  lead: "…"
  write_to_us_heading: "Write to us"
  general_enquiries_label: "General enquiries"
  copy_button_label: "⧉ Copy email address"
  address_label: "Correspondence address"
  address_org_line: "Example Organisation"
  address_country_line: "United Kingdom"
  follow_us_heading: "Follow us"
  initiatives_heading: "Our initiatives"
  cta_heading: "…"
  cta_text: "…"
  cta_button: "See our events"
  initiatives_copy:
    example-initiative:
      logo_alt: "Example Initiative logo"
      note: "A one-line description."

pl:
  # …the same keys, in Polish…
```

*(Fictional. The real record holds the Federation's actual details.)*

## 2. Shared and localised contact fields

| Shared (top level) | Localised (`en:` / `pl:`) |
| --- | --- |
| `slug`, `published` | `title`, `description`, `og_image_alt` |
| `contact_email` | `eyebrow`, `h1_lead`, `h1_fancy`, `lead` |
| `address.street_lines` | `write_to_us_heading`, `follow_us_heading` |
| `social_links[].url` / `.label` / `.handle` | `general_enquiries_label`, `address_label` |
| `initiatives[].logo` / `.title` | `address_org_line`, `address_country_line` |
| `initiatives[].links[].url` / `.icon` / `.external` | `copy_button_label`, `initiatives_heading` |
| | `cta_heading`, `cta_text`, `cta_button` |
| | `initiatives_copy.<key>.logo_alt` / `.note` |

Two judgement calls worth recording:

- **The street lines are shared; the organisation name and country line are
  not.** "238-246 King St" and "London W6 0RF" are a postal address and are
  written identically in both languages on the live pages. The organisation name
  is translated, and "United Kingdom" becomes "Wielka Brytania". Splitting the
  block this way keeps one copy of the parts that genuinely are one copy.
- **Social labels and handles are shared, but initiative link labels are not.**
  "Instagram" and "@federac_ja" are the same string in both languages, so they
  live on the record. The initiative sub-links say "Email"/"E-mail" and
  "Website"/"Strona", so those are `label_key` references into
  `ui.json` → `<locale>.contact.linkLabels`.

## 3. Social-link and initiative modelling

**Social links** are a flat list with a `key` that also names the icon:

```yaml
- key: instagram        # also selects the inline SVG
  url: "…"
  label: "Instagram"    # visible, identical in both languages
  handle: "@example"    # the .handle span
```

**Initiatives** nest their own link lists, because The Lambert has four links and
the Business Forum has two:

```yaml
initiatives:
  - key: the-lambert
    logo: "/assets/…"
    title: "The Lambert"       # a proper name, not translated
    links:
      - icon: mail
        url: "mailto:…"
        external: false        # no target/rel
        label_key: email       # -> ui.json, localised
```

`external: true` produces `target="_blank" rel="noopener"`, matching the live
pages exactly — including the fact that The Lambert's `mailto:` link does **not**
get them.

**Icons are markup, not content.** A record names an icon (`linkedin`); the SVG
itself lives in `src/_includes/partials/contact-icons.njk`. This is why the
validator can forbid raw HTML in a record without losing the icons, and why the
same icon renders at 20px in the social list and 14px in an initiative card
without two copies of the path data.

## 4. How the visible address wording is preserved

The live pages describe the address as **"Correspondence address"** /
**"Adres korespondencyjny"**. Not an office. Not a registered address.

That wording is stored verbatim in `en.address_label` / `pl.address_label`, and
`scripts/compare-contact.js` asserts it **absolutely** — not merely that the two
pages agree, but that the English page says exactly "Correspondence address" and
the Polish exactly "Adres korespondencyjny". Two identically-reworded pages would
pass a parity check; they fail this one.

Every address line is compared in order, so a changed street number or a dropped
country line fails the build.

## 5. Why this phase does not resolve the Organization-address question

Whether this correspondence address should also appear in the homepage
`Organization` JSON-LD is a **separate, unresolved SEO and content question**. A
correspondence address is not necessarily a business location, and publishing it
as `address` in structured data makes a claim about the organisation that nobody
has decided to make.

This migration therefore does exactly one thing with the address: it moves the
existing wording, unchanged, into a content record. It adds no structured data,
removes none, and takes no position. The homepage is not touched by this phase at
all.

## 6. Contact responsive-layout protections

Earlier work fixed real mobile horizontal overflow on this page. The fix lives in
`css/style.css`, which this phase does not modify — so the generated markup has
to keep giving those rules something to bite on.

The load-bearing structures, all reproduced exactly:

- **`.contact-grid`** — its tracks use overflow-safe sizing (`minmax(0, 1fr)`
  rather than a bare `1fr`, which carries an implicit min-content floor). A long
  e-mail address inside a bare `1fr` track is what caused the original overflow.
- **`.contact-card`** — the card box, including its `min-width: 0`.
- **`.social-list`** — same reasoning; the LinkedIn handle
  ("Federation of Polish Student Societies") is long enough to matter.
- **`.sub-grid` / `.sub-card`** — the initiative cards.

`scripts/compare-contact.js` compares the class lists on both sides and asserts
each wrapper is present, and `scripts/validate.js` §23 independently checks all
five class names appear in the generated HTML. Losing one is a build failure, not
a visual surprise later.

Measured in a browser at eight widths (§ Testing below): zero horizontal
overflow, zero elements outside the viewport, and no card whose content
overflows its own box.

## 7. 404 content schema

One record: `content/pages/404.yaml`.

```yaml
slug: "404"
published: true
noindex: true

primary_destination: "index.html"
secondary_destination: "contact.html"

cards:
  - key: events
    destination: "events.html"

en:
  title: "Page Not Found | Example Organisation"
  description: "…"
  eyebrow: "Error 404"
  h1_lead: "Page not "
  h1_fancy: "found"
  lead: "…"
  primary_label: "Back to the homepage"
  secondary_label: "Get in touch"
  cards_eyebrow: "Where to next"
  cards_title_lead: "Try one of "
  cards_title_fancy: "these"
  cards_copy:
    events:
      heading: "Events"
      text: "…"
      more: "See our events"

pl:
  # …the same keys, in Polish…
```

**Destinations are stored as bare page filenames**, never as full paths. The
build prefixes `/` or `/pl/` per locale. Storing `"index.html"` rather than
`"/index.html"` means one value serves both languages, and storing it without a
leading slash makes it impossible to accidentally hard-code an English
destination into the Polish page. The validator rejects anything that is not a
bare `*.html` filename.

## 8. Why the 404 pages have no canonical or hreflang

Because they are not pages. They are a response body served for a URL that does
not exist.

- **A canonical would be a lie.** `<link rel="canonical" href="/404.html">` on a
  response served for `/some/typo` tells a crawler that `/some/typo` and
  `/404.html` are the same document and invites it to index one of them.
- **hreflang would be worse.** It asserts that two real, indexable pages are
  translations of each other. Neither of these is a real page.
- **Open Graph would produce an indexable `og:url`.** A shared link to a 404 is
  never wanted.
- **`noindex, follow`** is the correct pair: don't index this, but do follow the
  links out of it, which is the whole point of the "where to next" cards.

`head.njk` already had exactly this behaviour behind its `noindex` flag from
Phase 3 — the flag suppresses the canonical, the hreflang trio, and all Open
Graph and Twitter metadata in one branch. The 404 record sets `noindex: true` and
gets it.

Both comparison and validation assert these as **absences**, counted rather than
merely tested, so a partial reintroduction is visible. The 404 record itself is
also checked for `canonical`, `hreflang`, `sitemap` and similar keys, so the
route back to indexability is closed at the data layer too.

## 9. Why root-relative link mode is necessary

Netlify serves the 404 body for whatever URL was missed. The visitor's address
bar might say:

```text
/nope
/deeply/nested/missing/page
/pl/deeply/nested/missing/page
```

A relative link resolves against **that** URL, not against where the file lives.
From `/deeply/nested/missing/page`, a link written `team.html` resolves to:

```text
/deeply/nested/missing/team.html      ← a second 404
```

That counterfactual was measured in the browser, not assumed.

So `src/404.njk` sets `linkMode: root`, and the shared chrome's `navHref` filter
emits `/team.html` and `/pl/team.html` instead of `team.html`. The body's own
destinations are built the same way, from `"/" + locale.urlPrefix`. Stylesheets,
scripts, favicons, the manifest and both logo images are already root-relative
site-wide.

**Verified**: 29 internal destinations on each 404 page, zero depth-relative, and
every one resolving to an identical path from five different simulated depths.

**Normal pages keep relative links.** `linkMode: root` is set only on the 404
template. The other generated pages deliberately use `team.html`, because that is
what routes a Polish reader to the Polish page (see ANNOUNCEMENTS_MIGRATION §6).

## 10. How the Polish Netlify 404 rule works

```toml
[[redirects]]
  from = "/pl/*"
  to = "/pl/404.html"
  status = 404
```

Netlify serves the root `/404.html` automatically but has no concept of a
per-directory 404, so without this rule a mistyped Polish URL returns the English
page.

Two properties make it safe, and both are asserted by the validator:

- **It is not forced.** Netlify applies redirect rules only *after* failing to
  find a matching static file, so every real page under `/pl/` is served
  normally and the rule catches only genuine misses. `force = true` would
  intercept the entire Polish site.
- **`status = 404`** returns the page with a real not-found status rather than a
  200 or a redirect, so crawlers see the truth.

`netlify.toml` is unchanged by this phase.

## 11. How the rule will work after the `dist/` cutover

Unchanged — because the rule targets a **path**, not a file location, and the
build emits that exact path.

```text
today:        <repo root>/pl/404.html   ->  /pl/404.html
after cutover: dist/pl/404.html         ->  /pl/404.html
```

When `publish` changes from `.` to `dist`, `/pl/404.html` still resolves, now
from the generated file. The rule needs no edit. The validator asserts that
`dist/pl/404.html` exists at exactly the path `netlify.toml` already names, so
the two cannot drift apart before the cutover happens.

The root `/404.html` needs no rule at all: Netlify picks it up by convention, and
the build emits `dist/404.html`.

## 12. Editing contact-page content

Edit `content/pages/contact.yaml` and rebuild. There is no second copy.

- **Changing the e-mail** — update `contact_email`. It feeds the `mailto:`, the
  visible label and the copy button's payload at once. Note the validator checks
  it against the live page, so it will fail until the live page is cut over too.
- **Adding a social link** — append to `social_links` with a `key` that matches
  an icon in `contact-icons.njk`.
- **Adding an initiative** — append to `initiatives`, then add its
  `initiatives_copy.<key>` block to **both** language sections. The validator
  fails if either is missing. Put its logo in `assets/` and give the record a
  root-relative path; the passthrough list is derived from the record.
- **A new icon** — add a branch to `contact-icons.njk`. Never put SVG in a
  record; the validator rejects raw markup.

## 13. Editing 404 content

Edit `content/pages/404.yaml` and rebuild.

- **Changing a destination** — use a bare filename (`events.html`). The build
  adds `/` or `/pl/`. The validator rejects paths, `../`, and absolute URLs, and
  checks the target page exists.
- **Changing a card** — edit `cards[]` and the matching `cards_copy.<key>` in
  both languages.
- **Do not add `canonical`, `hreflang` or a sitemap flag.** The validator fails
  on those keys by name, because they are the route to accidentally making the
  page indexable.

## 14. Decap CMS

Both records are single-instance "files", not folder collections:

```yaml
- name: pages
  label: Site pages
  files:
    - name: contact
      file: content/pages/contact.yaml
      i18n: true              # structure: single_file
      fields:
        - { name: contact_email, widget: string, i18n: duplicate }
        - { name: address, widget: object, i18n: duplicate, fields: [
            { name: street_lines, widget: list, field: { name: line, widget: string } } ] }
        - { name: social_links, widget: list, i18n: duplicate, fields: [
            { name: key, widget: select, options: [instagram, linkedin, facebook] },
            { name: url, widget: string }, { name: label, widget: string },
            { name: handle, widget: string } ] }
        - { name: address_label, widget: string, i18n: true }
        # …and the rest of the localised strings…
```

Three things to settle first:

- **`initiatives_copy` is keyed by initiative key**, which Decap's object widget
  cannot generate dynamically. Either flatten it into the `initiatives` list with
  `i18n: true` on the localised sub-fields, or accept a fixed set of keys.
- **`icon` and `label_key` must be `select` widgets** bound to the icon names in
  `contact-icons.njk` and the keys in `ui.json`, or an editor will type a value
  that renders nothing.
- **The 404 record should probably not be CMS-editable at all.** Its destinations
  are structural, and the fields most likely to be edited by accident
  (`noindex`, the destinations) are the ones that break it. Exposing only the
  visible strings would be safer.

## 15. Discrepancies found during extraction

### A. No English/Polish invariant disagreements

The contact e-mail, all three social destinations and handles, both initiative
logos, all six initiative destinations and the two street address lines are
identical across the live pages. Compared field by field; zero mismatches.

### B. The initiative `mailto:` link has no `target`/`rel` — deliberate

Five of the six initiative links are external and carry
`target="_blank" rel="noopener"`. The Lambert's `mailto:contact@thelambert.org`
does not, on both live pages. That is correct — a mail client is not a new tab —
and it is modelled as `external: false` rather than smoothed over.

### C. The English `og:image:alt` uses title case

`"… — By Students. For Students."` in the OG tag, but the CTA band on the same
page reads "By students. For students." I first tried to *derive* the alt text
from the CTA heading and the comparison caught the mismatch. It is now stored
explicitly per locale. Deriving a string that merely looks derivable is a good
way to introduce a silent copy change.

### D. Asset paths become root-relative

The live Polish contact page uses `../assets/pbf/pbf-logo-icon.jpg`; the
generated pages use `/assets/pbf/pbf-logo-icon.jpg`. Same file, and the
root-relative form is what stops `/pl/` looking for its own assets directory.
The comparison normalises path depth before comparing.

### E. The 404 pages already used root-relative links

The live 404 pages were hand-written with `/team.html`-style links throughout —
whoever wrote them understood the problem. The migration preserves that; what is
new is that `linkMode: root` now *guarantees* it rather than relying on care.

## 16. Remaining limitations before cutover

- **The copy button depends on the live `js/main.js`.** It binds any
  `[data-copy]` element and picks its toast wording from `document.lang`. That
  script is unchanged and unmigrated; the generated pages simply provide the same
  markup. Its clipboard call needs a secure context, so the button silently does
  nothing on plain `http://` — true of the live page today as well.
- **The 404 pages cannot be end-to-end tested locally.** A plain static server
  does not serve `404.html` for an unknown path, and nothing here emulates
  Netlify's routing. What *was* tested is that every destination resolves
  correctly from arbitrary simulated depths, which is the property the routing
  depends on. **The Netlify fallback itself has not been exercised** and should be
  checked on a deploy preview at cutover.
- **The homepage Organization-address question is still open** (§5).
- **Cutover is still blocked** on the homepage, `events.html` and the five event
  pages. Publishing `dist/` today would drop them. After this phase, those are
  the only public pages left unmigrated.
