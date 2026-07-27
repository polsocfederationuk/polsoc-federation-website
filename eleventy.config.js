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

const yaml = require("js-yaml");

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
