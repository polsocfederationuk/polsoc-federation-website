# Manual regression checklist

`npm run validate` covers the things a script can see: file structure, metadata,
links, sitemap, structured data and the presence of load-bearing markup and CSS.
It cannot see **layout**. This checklist covers what has to be looked at.

Work through it before merging anything that touches HTML, CSS or `js/main.js`.
For a copy-only change, the desktop pass plus one mobile width is enough.

**How to run the site**

```bash
python -m http.server 8000
```

Then `http://localhost:8000/` and `http://localhost:8000/pl/`.

> `python -m http.server` does not emulate Netlify. The 404 behaviour in §5 can
> only be verified on a Netlify deploy preview, not locally.

---

## 1. Desktop pass

At a normal desktop width (≥1280px), in **both languages** — the Polish column
means `/pl/…`.

| Page | Check | EN | PL |
|---|---|---|---|
| Home | hero, ticker animating, stats counting up, timeline rail fills on scroll, quote carousel arrows, partner marquee loops seamlessly | ☐ | ☐ |
| Events | five event cards, flagship card styled differently, each links to its detail page | ☐ | ☐ |
| Announcements | 28 cards with images, click opens the modal, modal closes on ✕ / backdrop / Esc | ☐ | ☐ |
| Members | map renders, 30 pins, clicking a card flies the map and opens the popup, 30 logo cards below | ☐ | ☐ |
| Team | 21 members in six groups, filter chips switch groups, one member shows the photo placeholder | ☐ | ☐ |
| Contact | two cards side by side, copy-email button shows the toast, social links correct | ☐ | ☐ |
| Business Forum | navy sub-brand intact, stats band over photo, founders row, both carousels scroll, funding note | ☐ | ☐ |
| Sikorski debate | hero, prose, galleries, Instagram embed | ☐ | ☐ |
| Christmas Dinner | hero, gallery, album card, Instagram embed | ☐ | ☐ |
| Youth Congress | hero with co-organiser logos, gallery, album card, Instagram embed | ☐ | ☐ |
| Icebreaker | hero, prose, Instagram embed (no gallery — correct) | ☐ | ☐ |
| 404 | branded page, three cards, links work | ☐ | ☐ |

### Language switching

- [ ] `PL | EN` visible top-right on every page, in both languages
- [ ] The **current** language is the solid/dark one; the other is grey
- [ ] From each English page, **PL** lands on the *same* page in Polish — not the homepage
- [ ] From each Polish page, **EN** lands on the *same* page in English
- [ ] Round-trip: `/events.html` → `/pl/events.html` → `/events.html`
- [ ] Reachable and operable by keyboard (Tab to it, Enter follows)
- [ ] No flag icons anywhere

### Cross-cutting

- [ ] Header logo goes to `/` from English pages and `/pl/` from Polish pages
- [ ] Footer links stay in-language
- [ ] The Lambert tab opens `thelambert.org` in a new tab
- [ ] The PBF nav tab shows the navy logo, turns white-on-navy on hover
- [ ] No console errors on any page

---

## 2. Mobile widths

Test every public page, **both languages**, at:

```
320px  360px  375px  390px  412px  430px  768px
```

320px and 430px are the boundaries that matter most; if time is short, do those
two plus 375px.

For **each page at each width**:

- [ ] **No horizontal overflow** — the page must not scroll sideways and must not
      "zoom out" leaving a white strip on the right

  Paste this into the console; it must print `true`:

  ```js
  document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ```

  To be sure the check is honest, first neutralise the defensive rule that hides
  overflow, then re-run the line above:

  ```js
  document.body.style.setProperty('overflow-x', 'visible', 'important');
  ```

- [ ] Mobile navigation: burger opens the drawer, links work, drawer closes on tap
- [ ] The `PL | EN` switcher is visible and usable, and does not push the header
      into overflow
- [ ] No image spills past its container or the viewport
- [ ] Cards stay inside the viewport with the normal page padding
- [ ] The footer sits inside the viewport

### Page-specific mobile checks

| Page | Check |
|---|---|
| Home | Ticker still animates **and stays clipped** — no red stripe past either edge. Stats band readable (Polish labels are longer than English). Timeline dots aligned to the rail. |
| Team | **Two members per row** at 320–430px. Names and roles wrap without escaping the card. Portraits not stretched. Email/LinkedIn buttons still tappable (36px). |
| Contact | "Write to us" and "Follow us" cards fully inside the viewport. The long Facebook handle wraps instead of forcing the card wide. |
| Members | Map usable, cannot be zoomed out past the UK or panned to another continent. Logo cards uniform. |
| Announcements | Cards uniform height. Modal opens, is scrollable, closes. Images inside the modal load. |
| Event pages | Prose readable, galleries stack, **Instagram embed fits the viewport** (it carries its own `min-width`). |
| Business Forum | Stats band, carousels and photographer cards all stay in bounds. |

---

## 3. Reduced motion

With `prefers-reduced-motion: reduce` enabled in the OS or DevTools rendering panel:

- [ ] The page is still usable and fully readable
- [ ] Clicking a society card on the members map still moves the map and opens the
      popup (there is a non-animated fallback path)
- [ ] Nothing is stuck mid-animation or invisible

---

## 4. Accessibility spot-check

- [ ] Tab order is sensible through header → nav → switcher → content → footer
- [ ] Focus is visible on links and buttons
- [ ] The language switcher announces the active language (`aria-current`)
- [ ] Images have meaningful `alt`, decorative ones have `alt=""`
- [ ] Page zoom to 200% does not break the layout (browser zoom is **not** disabled)

---

## 5. 404 behaviour — deploy preview only

This **cannot** be tested with `python -m http.server`. Use a Netlify deploy
preview or production.

| URL | Expected |
|---|---|
| `https://<site>/no-such-page` | English 404 page, HTTP **404** |
| `https://<site>/pl/nie-ma-takiej-strony` | **Polish** 404 page, HTTP **404** |
| `https://<site>/pl/` | Polish homepage, HTTP 200 — *not* the 404 |
| `https://<site>/pl/events.html` | Polish events page, HTTP 200 — *not* the 404 |

The last two matter most: the `/pl/*` rule in `netlify.toml` is deliberately
**not** forced, so real files win. If a valid Polish page ever returns the 404,
someone has added `force = true` and the whole Polish site is intercepted.

Check the status code, not just the visible page:

```bash
curl -sI https://<site>/pl/nie-ma-takiej-strony | head -1   # expect 404
curl -sI https://<site>/pl/events.html          | head -1   # expect 200
```

- [ ] Invalid root URL → English 404, status 404
- [ ] Invalid `/pl/` URL → Polish 404, status 404
- [ ] Valid Polish pages still return 200
- [ ] Both 404 pages keep working navigation and a language switcher

---

## 6. Post-deploy

- [ ] `https://polsocfederation.pl/favicon.ico` and
      `/assets/icons/favicon-32x32.png` both resolve
- [ ] `https://polsocfederation.pl/sitemap.xml` and `/robots.txt` resolve
- [ ] Sharing the homepage produces the Federation banner, not the Christmas photo
      (use the Facebook Sharing Debugger and re-scrape; LinkedIn caches separately)
- [ ] Search Console shows no new hreflang errors after a few days

> Google controls when it refreshes a search-result favicon and a cached share
> preview. Neither updates immediately after deploy, and that is not a defect.
