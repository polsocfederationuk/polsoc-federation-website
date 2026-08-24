/**
 * The authoritative inventory of INDEXABLE public routes.
 *
 * One source of truth for the generated sitemap, the deployment-tree audit, the
 * crawler and the validator. Derived from the canonical page and event records —
 * NOT from scanning dist/ for *.html, because a scan would happily publish a
 * diagnostic or fixture page the moment one appeared. Adding a route has to be a
 * deliberate act here or in a content record.
 *
 * Deliberately EXCLUDED:
 *   /404.html, /pl/404.html   — noindex by design (see docs/STATIC_PAGES_MIGRATION.md)
 *   build fixtures            — never production output at all after Phase 15
 *   unpublished records       — `published: false` or `show_in_listing`-hidden
 *                               pages are still not routes; visibility flags
 *                               affect listings, `published` affects existence
 *
 * `changefreq` and `priority` mirror the hand-tuned values in the live
 * sitemap.xml. They are kept because the live model is consistent and
 * intentional — a clear tier per page type, with every Polish route one step
 * below its English pair — and a cutover phase is the wrong moment to change a
 * published signal. `lastmod` is deliberately NOT modelled; see src/sitemap.njk.
 *
 * Exported as an Eleventy data file AND as a plain module so the audit scripts
 * can import the same list the sitemap is built from.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.join(__dirname, "..", "..");
const LOCALES = require("./locales.json");

/**
 * Static page routes, with the sitemap weights the live file uses.
 *
 * `template` names the source template that generates the route. That is the real
 * determinant of whether the page exists — some pages are driven by a
 * content/pages/*.yaml record (home, events, contact) and others by a whole
 * collection (team from content/team/, members from content/societies/,
 * announcements from content/announcements/), so gating on a single record file
 * would silently drop three real routes. Deleting a template removes its route
 * from the sitemap automatically.
 *
 * The homepage's public path is "" (i.e. "/" and "/pl/"), not "index.html".
 */
const PAGE_ROUTES = [
  { key: "home", file: "", template: "src/index.njk", changefreq: "weekly", priority: { en: "1.0", pl: "0.9" } },
  { key: "events", file: "events.html", template: "src/events.njk", changefreq: "monthly", priority: { en: "0.9", pl: "0.8" } },
  { key: "members", file: "members.html", template: "src/members.njk", changefreq: "monthly", priority: { en: "0.9", pl: "0.8" } },
  { key: "announcements", file: "announcements.html", template: "src/announcements.njk", changefreq: "weekly", priority: { en: "0.9", pl: "0.8" } },
  { key: "team", file: "team.html", template: "src/team.njk", changefreq: "yearly", priority: { en: "0.7", pl: "0.6" } },
  { key: "contact", file: "contact.html", template: "src/contact.njk", changefreq: "yearly", priority: { en: "0.7", pl: "0.6" } },
];

/** Per-event sitemap weights, keyed by slug — the flagship outranks the rest. */
const EVENT_WEIGHTS = {
  "business-forum": { changefreq: "yearly", priority: { en: "0.8", pl: "0.7" } },
  _default: { changefreq: "yearly", priority: { en: "0.6", pl: "0.5" } },
};

function loadEvents() {
  const dir = path.join(ROOT, "content", "events");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .sort()                                     // deterministic before re-sorting
    .filter((f) => /\.ya?ml$/i.test(f))
    .map((f) => yaml.load(fs.readFileSync(path.join(dir, f), "utf8")) || {})
    // `published` decides whether a PAGE exists at all. `show_in_listing` and
    // `show_on_homepage` only decide whether it is advertised, so a published
    // event that is hidden from the listing still has a real, indexable URL.
    .filter((e) => e.published === true)
    .sort((a, b) => (a.order - b.order) || (String(a.slug) < String(b.slug) ? -1 : 1));
}

/**
 * Build the full route list: every static page, then every event detail page,
 * English first then Polish — the order the live sitemap uses.
 */
function routes() {
  const events = loadEvents();
  const out = [];

  for (const locale of LOCALES) {
    for (const page of PAGE_ROUTES) {
      // A template that has gone must not leave an orphan sitemap entry.
      if (!fs.existsSync(path.join(ROOT, page.template))) continue;
      out.push({
        key: `${page.key}:${locale.code}`,
        locale: locale.code,
        // Public path relative to the site root, e.g. "" or "pl/events.html".
        path: locale.urlPrefix + page.file,
        // The file the generator must have produced for this route.
        file: locale.urlPrefix + (page.file || "index.html"),
        loc: `/${locale.urlPrefix}${page.file}`,
        changefreq: page.changefreq,
        priority: page.priority[locale.code],
        kind: "page",
      });
    }
    for (const event of events) {
      const w = EVENT_WEIGHTS[event.slug] || EVENT_WEIGHTS._default;
      const file = `${locale.urlPrefix}event-${event.slug}.html`;
      out.push({
        key: `event-${event.slug}:${locale.code}`,
        locale: locale.code,
        path: file,
        file,
        loc: `/${file}`,
        changefreq: w.changefreq,
        priority: w.priority[locale.code],
        kind: "event",
        slug: event.slug,
      });
    }
  }
  return out;
}

/**
 * Routes that exist but must NEVER appear in the sitemap.
 *
 * Two kinds. The 404 pages are content that only ever answers a miss. The
 * staff login page is OPERATIONAL: it is how committee officers reach the
 * content manager, it is deliberately reachable and deliberately not a page of
 * the website, and it has no Polish counterpart because there is one login
 * page, not one per language.
 *
 * Being out of the sitemap is tidiness, not access control — /admin/ is guarded
 * by invite-only accounts and a server-side role check. See
 * docs/CMS_PRODUCTION.md §6.
 */
const NOINDEX_ROUTES = LOCALES.map((l) => ({
  locale: l.code,
  path: `${l.urlPrefix}404.html`,
  file: `${l.urlPrefix}404.html`,
  reason: "noindex by design",
})).concat([{
  locale: "en",
  path: "staff-login/",
  file: "staff-login/index.html",
  reason: "operational route: the way in to the content manager",
  operational: true,
}]);

module.exports = () => ({
  domain: "https://polsocfederation.pl",
  routes: routes(),
  noindex: NOINDEX_ROUTES,
});

// Importable by scripts/*.js without going through Eleventy.
module.exports.routes = routes;
module.exports.noindexRoutes = () => NOINDEX_ROUTES;
module.exports.domain = "https://polsocfederation.pl";
module.exports.PAGE_ROUTES = PAGE_ROUTES;
