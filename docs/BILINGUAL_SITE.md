# Bilingual site (English + Polish)

How the two language versions of polsocfederation.pl fit together, and what you
need to do when you add or change something. No build step, no framework — it is
still plain HTML, CSS and JavaScript that Netlify serves as-is.

---

## 1. URL structure

English is the **default** language and keeps its original URLs. Polish lives in
a `/pl/` folder that mirrors it file-for-file.

| Page | English | Polish |
|---|---|---|
| Home | `/` | `/pl/` |
| Events | `/events.html` | `/pl/events.html` |
| News | `/announcements.html` | `/pl/announcements.html` |
| Members | `/members.html` | `/pl/members.html` |
| Team | `/team.html` | `/pl/team.html` |
| Contact | `/contact.html` | `/pl/contact.html` |
| Business Forum | `/event-business-forum.html` | `/pl/event-business-forum.html` |
| Christmas Dinner | `/event-christmas-dinner.html` | `/pl/event-christmas-dinner.html` |
| Icebreaker | `/event-icebreaker.html` | `/pl/event-icebreaker.html` |
| Sikorski debate | `/event-sikorski-debate.html` | `/pl/event-sikorski-debate.html` |
| Youth Congress | `/event-youth-congress.html` | `/pl/event-youth-congress.html` |
| 404 | `/404.html` | `/pl/404.html` |

**Filenames are always identical** between the two trees. That is what makes the
language switcher a simple, predictable rule. Do not rename a file in one tree
without renaming it in the other.

There is **no automatic redirect** based on browser language. A visitor always
lands on English unless they click PL or follow a `/pl/` link.

---

## 2. Language switcher

It sits in the header, top right, on every page:

```html
<nav class="lang-switch" aria-label="Change language">
  <a href="/pl/events.html" hreflang="pl" lang="pl">PL</a>
  <span class="sep" aria-hidden="true">|</span>
  <a href="/events.html" hreflang="en" lang="en" aria-current="true">EN</a>
</nav>
```

Rules:

- Both languages are **always real `<a>` links** — no JavaScript involved, so it
  works with keyboard, screen readers and with JS disabled.
- The **current** language carries `aria-current="true"`, which is what the CSS
  uses to render it in solid black instead of grey.
- `href` values are **root-relative** (`/events.html`, `/pl/events.html`) so the
  same markup is correct from both trees.
- On a Polish page the two links are the same, with `aria-current` moved to PL.
- Styling lives in `css/style.css` under *"Language switcher"*. Black, white and
  Federation red only — no flags (a flag stands for a country, not a language).

If you add a page, remember to point its switcher at the matching file in the
other tree.

---

## 3. Adding a new page in both languages

1. Create the English page as usual, e.g. `awards.html`.
2. Copy it to `pl/awards.html`.
3. In the Polish copy:
   - `<html lang="en">` → `<html lang="pl">`
   - asset paths gain one level: `css/` → `../css/`, `js/` → `../js/`,
     `assets/` → `../assets/` (including inside inline `style="...url('...')"`)
   - root-relative paths (`/favicon.ico`, `/assets/icons/…`, `/site.webmanifest`)
     stay **exactly as they are** — they already work from any depth
   - swap the data file if the page uses one (see §5)
   - translate the visible text, `alt`, `aria-label`, `title` and metadata
4. Set the canonical + hreflang block on **both** pages (see §4).
5. Set `og:locale` to `pl_PL` on the Polish page and `en_GB` on the English one,
   each with the other as `og:locale:alternate`.
6. Point both language switchers at each other.
7. Add **both** URLs to `sitemap.xml` (see §6).

Internal links inside `/pl/` stay **relative** (`href="events.html"`), so they
resolve within `/pl/` automatically. That is deliberate — never hard-code
`/events.html` in a Polish page or you will throw the visitor back to English.

---

## 4. hreflang and canonicals

Every page carries a self-referencing canonical plus the same three alternates.
The pair is reciprocal: each page lists **both** languages and points
`x-default` at English.

English `/events.html`:

```html
<link rel="canonical" href="https://polsocfederation.pl/events.html">
<link rel="alternate" hreflang="en" href="https://polsocfederation.pl/events.html">
<link rel="alternate" hreflang="pl" href="https://polsocfederation.pl/pl/events.html">
<link rel="alternate" hreflang="x-default" href="https://polsocfederation.pl/events.html">
```

Polish `/pl/events.html` — note the canonical points at **itself**, never at the
English page:

```html
<link rel="canonical" href="https://polsocfederation.pl/pl/events.html">
<link rel="alternate" hreflang="en" href="https://polsocfederation.pl/events.html">
<link rel="alternate" hreflang="pl" href="https://polsocfederation.pl/pl/events.html">
<link rel="alternate" hreflang="x-default" href="https://polsocfederation.pl/events.html">
```

The two `alternate` lines and the `x-default` line are **identical on both
pages**. Only the canonical differs. Use absolute URLs everywhere.

`404.html` and `pl/404.html` deliberately have **no** canonical and **no**
hreflang — they are `noindex, follow` and must not be indexed or paired.

---

## 5. Translated dynamic content

Three JavaScript files produce visible text.

| File | What it holds | Polish version |
|---|---|---|
| `js/announcements-data.js` | the 28 news items | `js/pl/announcements-data.js` |
| `js/societies-data.js` | the 30 member societies | `js/pl/societies-data.js` |
| `js/main.js` | 4 interface strings | **shared** — see below |

**`main.js` is not duplicated.** It picks its language from the page itself:

```js
const UI = { en: {...}, pl: {...} }[document.documentElement.lang === "pl" ? "pl" : "en"];
```

So setting `<html lang="pl">` is all that is needed. If you add a new
user-visible string to `main.js`, add it to **both** `en` and `pl` in that
object rather than hard-coding English.

**`announcements-data.js`** — the Polish copy has the same fields in the same
order. Translate `date`, `title`, `subtitle`, `body` and `link.text`. Keep
`image`, `imagePos`, `fit`, `bg`, `closed`, `extraImages` and `link.href`
byte-identical to the English file, and keep both files in the same order.
Dates are written out in Polish (`7 lipca 2026`, not `7 July 2026`).

**`societies-data.js`** — only the `uni` field (city and country) is translated,
e.g. `"Edinburgh, Scotland"` → `"Edynburg, Szkocja"`. Society **names**,
coordinates, e-mail addresses, Instagram handles and logo filenames must stay
identical in both files, or the map pins will drift apart between languages.

Labels generated by inline `<script>` blocks (for example *Read more* on the
news cards, *Sign-ups closed* in the pop-up, and the *E-mail* / *Instagram*
buttons on the members map) live **inside each HTML page**, so the Polish copy
of the page already carries the Polish label. Check those when you edit a page.

---

## 6. Adding a new event in both languages

1. Duplicate an existing `event-*.html` in the English root and write the page.
2. Copy it to `pl/` and translate it, following §3.
3. Add a card for it on `events.html` **and** `pl/events.html`.
4. Add a timeline entry on `index.html` **and** `pl/index.html`.
5. Add the announcement to `js/announcements-data.js` **and**
   `js/pl/announcements-data.js`.
6. In the Polish page's `Event` JSON-LD:
   - keep `startDate`, `endDate`, `location` coordinates and speaker names
     factually identical to the English version
   - translate `description`
   - set `"url"` to the `/pl/` address and `"inLanguage": "pl-PL"`
   - set `organizer.name` to the Polish organisation name and
     `organizer.url` to `https://polsocfederation.pl/pl/`
7. Add both URLs to `sitemap.xml`.

---

## 7. sitemap.xml

One sitemap covers both languages: 11 English URLs then 11 Polish ones. Rules:

- absolute URLs only
- **never** include `404.html` or `pl/404.html`
- `lastmod` must reflect a real change — do not bump every date because one page
  moved
- Polish entries sit 0.1 below their English counterpart in `priority`, since
  English is the default

Optional and **not currently used**: `xhtml:link` hreflang annotations inside the
sitemap. The HTML `<link rel="alternate">` tags are the authoritative signal and
are already complete, so the sitemap is kept simple. If you ever add sitemap
hreflang, every URL must list the full alternate set or Google ignores all of it.

---

## 8. Keeping the two versions in sync

The honest risk with a hand-maintained bilingual site is drift: someone updates
English and forgets Polish. To keep that in check:

- treat the two files as **one change** — edit `x.html` and `pl/x.html` in the
  same commit
- when the English text changes meaning, update the Polish text too; do not
  leave a stale translation that says something different
- if a Polish translation genuinely is not ready, it is better to leave the page
  out of `/pl/` entirely (and out of the sitemap and hreflang) than to publish a
  half-English page — a missing translation is fine, a wrong one is not
- run the checks in §10 before pushing

---

## 9. Names that stay in English

Do **not** translate these. They are proper nouns or registered brands, and a
Polish reader expects to see them as they are:

- **Polish Business Forum**, **Polish Youth Congress**, **Icebreaker** — event brands
- **London Business School**, **Ognisko Polskie**, **The Landmark London**,
  **Mamuśka!**, **Merchant Taylors' Hall**, **Villa Foksal** — venues
- **The Lambert** — the Federation's journal
- university names — *King's College London*, *Queen Mary University of London*,
  *University of Strathclyde*, *UCL*, *LSE*, *Oxford*, *Cambridge*
- sponsors and partners — *Bank Pekao*, *PKO Bank Polski*, *VeloBank*,
  *OC&C Strategy Consultants*, *Legimi*, *HEATPEX*, *ntfy*,
  *Stowarzyszenie Wspólnota Polska*, *Business Insider Polska*, *PAP Biznes*,
  *Puls Biznesu*, *British Poles*, *MyPolska*, *Focus on Business*, *Comparic*,
  *StockWatch*, *FXMAG*, *Przegląd*
- every personal name
- social handles — `@federac_ja`, `FederationOfPolishStudentSocietiesUK`
- conference titles quoted in English, e.g.
  *"Polish Golden Age: From Emerging to Leading"*,
  *"Building Bridges, Inspiring the Future"*

Translate the words **around** them: *"Dowiedz się więcej o Polish Business Forum"*.

### Organisation name

- Polish: **Federacja Polskich Stowarzyszeń Studenckich w Wielkiej Brytanii**
- English: **Federation of Polish Student Societies in the UK**

Use the Polish name on Polish pages. Do not invent an abbreviation — the site
does not use one.

---

## 10. Checks before you push

```bash
# every English page has a Polish twin and vice versa
ls *.html | sort > /tmp/en.txt && ls pl/*.html | xargs -n1 basename | sort > /tmp/pl.txt && diff /tmp/en.txt /tmp/pl.txt

# no Polish page links back into the English tree by accident
grep -n 'href="/[a-z-]*\.html"' pl/*.html | grep -v '/pl/'

# JavaScript still parses
node --check js/main.js && node --check js/pl/announcements-data.js && node --check js/pl/societies-data.js

# language attributes
grep -L 'html lang="pl"' pl/*.html      # should print nothing
grep -L 'html lang="en"' *.html         # should print nothing
```

Then open `/pl/` in a browser, click through every nav item, and use the PL | EN
switcher on a few pages to confirm it lands on the matching page rather than the
home page.
