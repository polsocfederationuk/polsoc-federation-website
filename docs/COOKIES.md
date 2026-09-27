# Cookie banner

Every public page shows a cookie banner the first time somebody visits.

## What it controls

The site itself sets **no tracking cookies** and runs **no analytics**. The one
thing on the public site that sets cookies is an embedded social post on an
event page — Instagram's embed script, and Facebook's and LinkedIn's post
iframes. So the banner has two categories:

| Category | What it is | Default |
|---|---|---|
| Necessary | One cookie, `cc_cookie`, that remembers the visitor's choice (6 months) | Always on |
| Social media posts | Embedded Instagram, Facebook and LinkedIn posts | Off until accepted |

Until a visitor accepts, embedded posts are **not loaded at all**: each shows a
short note with a "Show social media posts" button, and the plain link to the
post that every post already carries. Accepting loads them in place. Choosing
"Decline" later (footer → **Cookie settings**) reloads the page with them
blocked again.

Not covered, because they set no cookies: Google Fonts, the Leaflet map and its
CARTO tiles on the Members page, and the Netlify link. The staff login's
session cookie is only set for committee members who sign in, and is necessary.

## The pieces

| File | What it does |
|---|---|
| `vanilla-cookieconsent` 3.1.0 (MIT) | The banner itself. Pinned exactly in `package.json`, copied from `node_modules` at build time and served from this site, never a CDN |
| `src/js/consent.js` | Our settings, the English and Polish text, and the gate on social posts |
| `src/css/consent.css` | The banner in the site's colours, and the note that stands in for a post |
| `partials/head.njk`, `partials/scripts.njk` | Load the four files on every page |
| `partials/event/social-posts.njk`, `event.njk` | Embeds carry `data-consent-src` instead of `src` until consent |
| `partials/footer.njk` | The **Cookie settings** link |

The banner is left out of the CMS preview (`noConsentBanner`), which shows
social posts directly.

Accept and Decline are the same size and colour, so declining is as easy as
accepting. The library hides the banner from automated browsers (search
engines); real visitors always see it.

## Tests

The page comparisons check each page's stylesheets and scripts against the
live site, which never had a banner, so they leave out exactly the four files
listed in `scripts/site-wide-assets.js`. `scripts/audit-dist.js` then checks
that every public page does load them, in order, and `scripts/compare-chrome.js`
checks the footer carries the Cookie settings link.

## Still to do

- **Cookies in the privacy policy.** The policy (`/privacy-policy.html`,
  `src/_includes/partials/privacy/policy-en.njk`) does not yet mention cookies.
  The banner and the policy page's "Cookies on this website" box explain them;
  the Federation may want a short cookies section in the policy itself.
- **Polish wording** should be checked by a native speaker (`src/js/consent.js`
  and `ui.json` → `footer.cookieSettings`).

## Privacy policy page

`/privacy-policy.html` and `/pl/privacy-policy.html` (`src/privacy-policy.njk`)
show the Federation's approved English policy with a contents list, and are
linked from the footer on every page, from the banner, and from its settings.
The Polish page says the policy is available in English and shows it. To update
the policy, replace the text in `partials/privacy/policy-en.njk` and the date in
the page's front matter (`privacyPage.updated`, `updated_text`).
