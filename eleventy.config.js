/**
 * Eleventy configuration — Federation of Polish Student Societies in the UK
 *
 * PHASE 2 SCOPE: this build generates ONLY the architectural proof pages under
 * dist/build-test/. The live website is still the hand-written HTML at the
 * repository root, and Netlify still publishes the repository root. Nothing in
 * this config touches, reads or rewrites a public page.
 *
 * The input directory is `src/`, so Eleventy cannot see — let alone modify —
 * the public HTML at the repository root. That containment is deliberate and
 * is asserted by scripts/validate.js.
 *
 * See docs/BUILD_ARCHITECTURE.md for the full rationale.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const MarkdownIt = require("markdown-it");

/* ===========================================================================
   Markdown for announcement bodies.

   html: false is the security boundary. Announcement bodies are editor input
   destined for `innerHTML` in the browser, so allowing raw HTML would make a
   stored-XSS hole out of a content file. With it off, markdown-it escapes any
   `<tag>` to visible text and the only markup that can reach the page is what
   this renderer itself emits.

   linkify and typographer are OFF so nothing is silently rewritten: a bare URL
   in prose stays prose, and the em dashes and curly quotes already in the copy
   are passed through untouched.
   =========================================================================== */
const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });

// Belt and braces over markdown-it's own validateLink, which already rejects
// javascript:, vbscript: and non-image data:. Stated explicitly so the policy
// is visible in this file rather than inherited silently.
const SAFE_LINK = /^(https?:|mailto:|\/|#)|^[a-z0-9][a-z0-9-]*\.html([?#]|$)/i;
md.validateLink = (url) => SAFE_LINK.test(String(url).trim());

// External links get target/rel, matching what the live bodies already carry.
md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const href = tokens[idx].attrGet("href") || "";
  if (/^https?:/i.test(href)) {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noopener");
  }
  return self.renderToken(tokens, idx, options);
};

/**
 * Render an announcement body.
 *
 * Paragraphs are rendered INLINE and rejoined with a blank line rather than
 * wrapped in <p>. That is not a shortcut — `.modal-content .ann-text` is styled
 * `white-space: pre-line`, so the blank line *is* the paragraph break. Emitting
 * <p> would add margins on top of the preserved newlines and space the text out
 * differently from the live page. See docs/ANNOUNCEMENTS_MIGRATION.md §8.
 */
function renderBody(markdown) {
  return String(markdown == null ? "" : markdown)
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((para) => md.renderInline(para.trim()))
    .join("\n\n");
}

/* ------------------------------------------------------------ date display */
const EN_MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
// Polish dates take the genitive: "7 lipca 2026", not "7 lipiec 2026".
const PL_MONTHS = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];

/**
 * "2026-07-07" -> "7 July 2026" / "7 lipca 2026".
 *
 * Parsed by splitting the string, never with `new Date(...)`: constructing a
 * Date and reading it back applies the machine's timezone and can shift the day
 * by one either side of UTC. Same input, different output, depending on where
 * the build runs. This is the same hazard the `isoDate` filter guards against.
 */
function formatDate(iso, localeCode) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso);
  const day = Number(m[3]);
  const months = localeCode === "pl" ? PL_MONTHS : EN_MONTHS;
  return `${day} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * Every announcement image referenced by a record — main and extra — as
 * repo-relative paths, sorted and de-duplicated. Drives the passthrough list so
 * exactly the required assets are copied and the list never needs maintaining.
 */
function announcementImagePaths() {
  const dir = path.join(__dirname, "content", "announcements");
  if (!fs.existsSync(dir)) return [];
  const paths = new Set();
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/i.test(file)) continue;
    const rec = yaml.load(fs.readFileSync(path.join(dir, file), "utf8")) || {};
    if (rec.image) paths.add(String(rec.image).replace(/^\/+/, ""));
    for (const extra of rec.extra_images || []) {
      paths.add(String(extra).replace(/^\/+/, ""));
    }
  }
  return [...paths].sort();
}

/**
 * Repo-relative paths of every headshot referenced by a team record, sorted and
 * de-duplicated. Read straight from the YAML so the passthrough list is exactly
 * "what the generated pages need" and stays that way without maintenance.
 */
function teamPhotoPaths() {
  const dir = path.join(__dirname, "content", "team");
  if (!fs.existsSync(dir)) return [];

  const paths = new Set();
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/i.test(file)) continue;
    const rec = yaml.load(fs.readFileSync(path.join(dir, file), "utf8")) || {};
    if (rec.photo) paths.add(String(rec.photo).replace(/^\/+/, ""));
  }
  return [...paths].sort();
}

module.exports = function (eleventyConfig) {
  // Content records are YAML (see BUILD_ARCHITECTURE.md §9). Eleventy reads
  // .json/.js natively but needs to be told about .yaml.
  eleventyConfig.addDataExtension("yaml", (contents) => yaml.load(contents));
  eleventyConfig.addDataExtension("yml", (contents) => yaml.load(contents));

  // DETERMINISM GUARD.
  // YAML silently parses an unquoted `2027-03-12` into a JavaScript Date, and
  // Nunjucks stringifies a Date using the LOCAL timezone —
  // "Fri Mar 12 2027 00:00:00 GMT+0000 (Greenwich Mean Time)" here, but
  // "GMT+0100 (Central European Standard Time)" on a machine in Warsaw. Same
  // input, different output. Always render dates through this filter, which
  // formats in UTC and is therefore machine-independent.
  eleventyConfig.addFilter("isoDate", (value) => {
    if (value === undefined || value === null || value === "") return "";
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
  });

  // Absolute, root-relative asset URL. The whole point is that the SAME string
  // is emitted regardless of how deep the page sits, because a relative path
  // resolves against the page URL and silently breaks under /pl/.
  // (docs/CLEANUP_BASELINE.md §5 — this shipped as a live bug once.)
  eleventyConfig.addFilter("asset", (p) => "/" + String(p).replace(/^\/+/, ""));

  // Public URL for a page, given a locale. English lives at the root, Polish
  // under /pl/, and every page keeps its .html extension.
  eleventyConfig.addFilter("localeUrl", (file, locale) => {
    const prefix = locale && locale.urlPrefix ? locale.urlPrefix : "";
    return "/" + prefix + (file === "index.html" ? "" : file);
  });

  // Resolve a page's URL pattern for a given locale. Each page declares one
  // pattern containing `{prefix}`; the canonical, the hreflang alternates and
  // og:url are all derived from it, so a page's URL is stated exactly once.
  //   "/{prefix}events.html"   -> "/events.html"  and  "/pl/events.html"
  //   "/build-test/{prefix}"   -> "/build-test/"  and  "/build-test/pl/"
  eleventyConfig.addFilter("urlFor", (pattern, locale) =>
    String(pattern).replace("{prefix}", (locale && locale.urlPrefix) || "")
  );

  // Navigation/footer link for a page file, in a given locale.
  //
  //   linkMode "relative" (default) — "team.html". Matches the live pages
  //     exactly: an English page links to "team.html", and a Polish page links
  //     to "team.html" too, which resolves inside /pl/. That relative form is
  //     what keeps each language routed to its own pages.
  //   linkMode "root" — "/pl/team.html". Needed only by 404 pages, which the
  //     server may return from any URL depth, so relative links would break.
  eleventyConfig.addFilter("navHref", (file, locale, linkMode) => {
    if (linkMode === "root") {
      return "/" + ((locale && locale.urlPrefix) || "") + file;
    }
    return file;
  });

  // Fails the BUILD when required page metadata is absent, rather than quietly
  // emitting an empty tag. The brief is explicit: required metadata must fail,
  // not fall back to something broad and wrong.
  eleventyConfig.addFilter("required", (value, fieldName) => {
    if (value === undefined || value === null || String(value).trim() === "") {
      throw new Error(
        `Missing required page metadata: "${fieldName}". ` +
        `Set it in the page's front matter — the shared head partial will not ` +
        `invent a default for it.`
      );
    }
    return value;
  });

  // Members of one group, for one academic year, in display order.
  //
  // Filtering by academic year here is what lets a 2026/27 committee be added
  // later WITHOUT deleting the 2025/26 records: old years stay on disk and
  // simply stop matching.
  //
  // The tie-break is a plain `<` on the slug, not localeCompare: collation
  // depends on the machine's ICU data, which would make the build
  // non-deterministic across machines. Duplicate `order` values inside a group
  // are rejected by scripts/validate.js, so the tie-break is a safety net that
  // should never fire.
  eleventyConfig.addFilter("teamInGroup", (team, groupKey, academicYear) =>
    (team || [])
      .filter(
        (m) =>
          m.published === true &&
          m.academic_year === academicYear &&
          m.group === groupKey
      )
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return String(a.slug) < String(b.slug) ? -1 : 1;
      })
  );

  // Stagger classes on the reveal animation, cycling every four cards within a
  // group: reveal, reveal-d1, reveal-d2, reveal-d3. Matches the live pages.
  eleventyConfig.addFilter("revealClass", (index) => {
    const d = Number(index) % 4;
    return d === 0 ? "member reveal" : `member reveal reveal-d${d}`;
  });

  // Plural member counts. English needs two forms, Polish three:
  //   1 osoba · 2-4 osoby · 5+ osób
  // Forms come from content/settings/team-groups.yaml, so the strings stay in
  // content and only the SELECTION rule lives in code.
  eleventyConfig.addFilter("plural", (count, forms, localeCode) => {
    const n = Number(count);
    if (!forms) return String(n);
    let form;
    if (n === 1 && forms.one) {
      form = forms.one;
    } else if (localeCode === "pl") {
      const mod10 = n % 10;
      const mod100 = n % 100;
      const few = mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14);
      form = few ? forms.few : forms.many;
    } else {
      form = forms.other;
    }
    return String(form).replace("{n}", n);
  });

  // Localised display date from a stored ISO string.
  eleventyConfig.addFilter("displayDate", (iso, localeCode) => formatDate(iso, localeCode));

  // Announcement body Markdown -> trusted HTML, rendered at BUILD time.
  eleventyConfig.addFilter("announcementBody", (markdown) => renderBody(markdown));

  /**
   * Project the canonical records into the flat, locale-specific array the
   * browser renderer consumes.
   *
   * Doing this here rather than in a template means the shape is defined once,
   * in JavaScript that scripts/validate.js and scripts/compare-announcements.js
   * can require and check directly.
   *
   * Ordering is by the explicit `order` field only — never filesystem order,
   * never YAML key order, never a parsed date.
   */
  eleventyConfig.addFilter("announcementsFor", (records, localeCode, academicYear) =>
    (records || [])
      .filter((a) => a.published === true && a.academic_year === academicYear)
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return String(a.slug) < String(b.slug) ? -1 : 1;
      })
      .map((a) => {
        const loc = a[localeCode] || {};
        const out = {
          slug: a.slug,
          // The display date is generated unless the record carries an explicit
          // override (none currently do — see ANNOUNCEMENTS_MIGRATION.md §3).
          date: loc.date_display || formatDate(a.published_date, localeCode),
          isoDate: a.published_date,
          title: loc.title,
          subtitle: loc.subtitle,
          image: a.image || null,
          bodyHtml: renderBody(loc.body),
        };
        // Optional fields are emitted only when set, so the generated array
        // matches the shape of the hand-written one it replaces.
        if (a.image_position) out.imagePos = a.image_position;
        if (a.image_fit) out.fit = a.image_fit;
        if (a.image_background) out.bg = a.image_background;
        if (a.signups_closed) out.closed = true;
        if (a.extra_images && a.extra_images.length) out.extraImages = a.extra_images.slice();
        if (a.link && a.link.type) {
          if (a.link.type === "event") {
            // RELATIVE on purpose: "event-x.html" resolves to the English page
            // from /announcements.html and to the Polish one from
            // /pl/announcements.html. Making this root-relative would send
            // Polish readers to the English event. See §6 of the migration doc.
            out.link = { href: `event-${a.link.event_slug}.html`, text: loc.link_label };
          } else if (a.link.type === "page") {
            out.link = { href: a.link.page, text: loc.link_label };
          } else if (a.link.type === "external") {
            out.link = { href: a.link.url, text: loc.link_label, external: true };
          }
        }
        return out;
      })
  );

  // ---------------------------------------------------------------------
  // Shared assets, copied (not moved, not modified) into dist/ so the chrome
  // comparison pages can load the REAL stylesheet and script when dist/ is
  // served standalone. Without these the responsive test would be meaningless:
  // an unstyled page cannot demonstrate that the header fits a 320px viewport.
  //
  // This is a deliberately MINIMAL list — only what the shared chrome touches.
  // Nothing is renamed or relocated; the originals stay exactly where they are
  // and remain the files the live site serves.
  // ---------------------------------------------------------------------
  eleventyConfig.addPassthroughCopy({ "css/style.css": "css/style.css" });
  eleventyConfig.addPassthroughCopy({ "js/main.js": "js/main.js" });
  eleventyConfig.addPassthroughCopy({ "favicon.ico": "favicon.ico" });
  eleventyConfig.addPassthroughCopy({ "site.webmanifest": "site.webmanifest" });
  eleventyConfig.addPassthroughCopy({ "assets/logo.svg": "assets/logo.svg" });
  eleventyConfig.addPassthroughCopy({ "assets/icons": "assets/icons" });
  // Referenced by css/style.css for the .nav-pbf-logo mask swap.
  eleventyConfig.addPassthroughCopy({
    "assets/pbf/pbf-logo-nav-navy.png": "assets/pbf/pbf-logo-nav-navy.png",
  });
  eleventyConfig.addPassthroughCopy({
    "assets/pbf/pbf-logo-nav-white.png": "assets/pbf/pbf-logo-nav-white.png",
  });

  // ---------------------------------------------------------------------
  // Team page assets.
  // ---------------------------------------------------------------------
  // The team hero photograph, which doubles as the page's og:image.
  eleventyConfig.addPassthroughCopy({
    "assets/pbf/team-steps.jpg": "assets/pbf/team-steps.jpg",
  });
  // The filter behaviour. Source-controlled under src/, copied to dist/js/.
  eleventyConfig.addPassthroughCopy({ "src/js/team-filter.js": "js/team-filter.js" });

  // ---------------------------------------------------------------------
  // Announcement page assets.
  // ---------------------------------------------------------------------
  // The announcements hero photograph, which doubles as the page's og:image.
  eleventyConfig.addPassthroughCopy({ "assets/pbf/crowd.jpg": "assets/pbf/crowd.jpg" });
  // The shared card/modal renderer.
  eleventyConfig.addPassthroughCopy({
    "src/js/announcements-page.js": "js/announcements-page.js",
  });
  // Announcement imagery — main and extra, derived from the records so only
  // what the generated pages reference is copied.
  for (const img of announcementImagePaths()) {
    eleventyConfig.addPassthroughCopy({ [img]: img });
  }

  // Headshots — ONLY those a record actually references. The list is derived
  // from content/team/*.yaml rather than hard-coded, so it can never drift, and
  // copying the whole directory (which still holds one unreferenced leftover)
  // is avoided. Members with `photo: null` contribute nothing.
  for (const photo of teamPhotoPaths()) {
    eleventyConfig.addPassthroughCopy({ [photo]: photo });
  }

  return {
    dir: {
      input: "src",
      output: "dist",
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["njk"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
    // No pathPrefix: the site is served from the domain root, so root-relative
    // asset URLs are correct as written.
  };
};
