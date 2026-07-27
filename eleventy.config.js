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
