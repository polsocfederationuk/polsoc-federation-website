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
const { normaliseDatesDeep } = require("./src/_data/dateOnly.js");

/**
 * Every image referenced by an event record — gallery tiles, the OG and card
 * images, co-organiser logos, and everything inside the Business Forum
 * extension. Derived from the records so exactly what the generated pages need
 * is copied, and adding a partner logo needs no second list updated.
 */
function eventImagePaths() {
  const dir = path.join(__dirname, "content", "events");
  if (!fs.existsSync(dir)) return [];
  const paths = new Set();
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/i.test(file)) continue;
    const rec = yaml.load(fs.readFileSync(path.join(dir, file), "utf8")) || {};
    const add = (p) => { if (p) paths.add(String(p).replace(/^\/+/, "")); };
    add(rec.og_image);
    add(rec.hero_image);
    add(rec.card_image);
    // The dedicated gallery, since Phase 17C.5A.3. The Business Forum still
    // uses its own section list, so both are collected.
    for (const im of ((rec.gallery || {}).images) || []) add(im.src);
    for (const sec of rec.sections || []) for (const im of sec.images || []) add(im.src);
    // Photographs placed inside the Main body as Markdown images.
    for (const locale of ["en", "pl"]) {
      const body = String(((rec[locale] || {}).body) || "");
      for (const m of body.matchAll(/![[^]]*](([^)]+))/g)) add(m[1]);
    }
    for (const co of rec.co_organisers || []) add(co.logo);

    const bf = rec.business_forum;
    if (bf) {
      add((bf.branding || {}).logo);
      // Edition-specific hero backdrop, applied via the --pbf-hero-backdrop
      // custom property rather than an <img>, so it needs copying explicitly.
      add((bf.branding || {}).hero_backdrop);
      add((bf.statistics || {}).background);
      for (const g of bf.galleries || []) for (const im of g.images || []) add(im.src);
      for (const p of bf.people || []) add(p.photo);
      for (const f of bf.people_photo_row || []) add(f.src);
      for (const g of bf.partner_groups || []) for (const lg of g.logos || []) add(lg.image);
      add((bf.funding_acknowledgement || {}).logo);
      if ((bf.forum_ball || {}).enabled) add(bf.forum_ball.image);
    }
  }
  return [...paths].sort();
}

/**
 * Logos referenced by the contact page's initiative cards, as repo-relative
 * paths. Read from the record so the passthrough list is exactly what the page
 * uses and needs no maintenance when an initiative is added.
 */
/**
 * Page-level images referenced by a record under content/pages/ — currently just
 * the events listing's hero photograph, which belongs to the page rather than to
 * any one event. Derived from the record so the list needs no maintenance.
 */
function pageImagePaths() {
  const dir = path.join(__dirname, "content", "pages");
  if (!fs.existsSync(dir)) return [];
  const paths = new Set();
  // Walk the WHOLE record: the homepage nests images inside pillars, the featured
  // gallery and the partner list, and a top-level-only scan silently missed six of
  // them. Any string under an image-named key that points at /assets/ is copied.
  const IMAGE_KEY = /^(hero_image|og_image|card_image|image|photo|logo|src|background|shield_image)$/;
  const walk = (node, key) => {
    if (typeof node === "string") {
      if (IMAGE_KEY.test(String(key)) && node.startsWith("/assets/")) {
        paths.add(node.replace(/^\/+/, ""));
      }
      return;
    }
    if (Array.isArray(node)) { node.forEach((v) => walk(v, key)); return; }
    if (node && typeof node === "object") for (const k of Object.keys(node)) walk(node[k], k);
  };
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/i.test(file)) continue;
    walk(yaml.load(fs.readFileSync(path.join(dir, file), "utf8")) || {}, null);
  }
  return [...paths].sort();
}

function contactLogoPaths() {
  const file = path.join(__dirname, "content", "pages", "contact.yaml");
  if (!fs.existsSync(file)) return [];
  const rec = yaml.load(fs.readFileSync(file, "utf8")) || {};
  const paths = new Set();
  for (const init of rec.initiatives || []) {
    if (init.logo) paths.add(String(init.logo).replace(/^\/+/, ""));
  }
  return [...paths].sort();
}

/**
 * Every society logo referenced by a record, as repo-relative paths, sorted and
 * de-duplicated. Records store a bare filename; the logos live in
 * assets/polsocs/. Driving the passthrough list from the records means exactly
 * the required files are copied and unreferenced ones are left alone.
 */
function societyLogoPaths() {
  const dir = path.join(__dirname, "content", "societies");
  if (!fs.existsSync(dir)) return [];
  const paths = new Set();
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/i.test(file)) continue;
    const rec = yaml.load(fs.readFileSync(path.join(dir, file), "utf8")) || {};
    if (rec.logo) {
      paths.add("assets/polsocs/" + String(rec.logo).replace(/^\/+/, "").replace(/^assets\/polsocs\//, ""));
    }
  }
  return [...paths].sort();
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

  let eventCache = null;
  const lookupEventBySlug = (slug) => {
    if (!eventCache) {
      eventCache = new Map();
      const dir = path.join(__dirname, "content", "events");
      if (fs.existsSync(dir)) {
        for (const file of fs.readdirSync(dir)) {
          if (!/\.ya?ml$/i.test(file)) continue;
          /*
            CANONICALISED, LIKE EVERY OTHER READ OF A RECORD.

            This is the one place that loads event YAML without going through
            src/_data/records.js, and it was the one place that skipped
            normalisation. An announcement that borrows an event's registration
            reads its dates from here, so a CMS-written event — which writes
            `opens_on: 2026-02-01` unquoted — put a Date into the announcement
            payload and the card rendered
            "Sun Feb 01 2026 01:00:00 GMT+0100 (Central European Standard Time)".

            Deep, because the dates that reach an announcement this way are
            inside the registration block rather than at the top level.
          */
          const data = normaliseDatesDeep(
            yaml.load(fs.readFileSync(path.join(dir, file), "utf8")) || {});
          if (data.slug) eventCache.set(String(data.slug), data);
        }
      }
    }
    return eventCache.get(String(slug)) || null;
  };

  require("./lib/public-rendering.js").registerPublicFilters(eleventyConfig, { lookupEventBySlug });

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
  // The branded Business Forum overrides. Its own url() references resolve
  // relative to the stylesheet, so no /pl/ variant is needed.
  eleventyConfig.addPassthroughCopy({ "css/pbf.css": "css/pbf.css" });
  eleventyConfig.addPassthroughCopy({ "js/main.js": "js/main.js" });
  eleventyConfig.addPassthroughCopy({ "favicon.ico": "favicon.ico" });
  eleventyConfig.addPassthroughCopy({ "site.webmanifest": "site.webmanifest" });
  // robots.txt is copied byte-for-byte rather than generated: it is three lines of
  // crawler policy with no data to derive, and its Sitemap: line must keep naming
  // the production URL. sitemap.xml IS generated (src/sitemap.njk) because its
  // contents follow from the route inventory.
  eleventyConfig.addPassthroughCopy({ "robots.txt": "robots.txt" });
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

  // ---------------------------------------------------------------------
  // Members page assets.
  // ---------------------------------------------------------------------
  // The members hero photograph, which doubles as the page's og:image.
  eleventyConfig.addPassthroughCopy({
    "assets/pbf/networking-hero.jpg": "assets/pbf/networking-hero.jpg",
  });
  // The shared map/card renderer.
  eleventyConfig.addPassthroughCopy({ "src/js/members-page.js": "js/members-page.js" });
  // Society logos — ONLY those a record actually references. Nothing is
  // renamed, re-encoded or deleted; unreferenced files stay where they are.
  for (const logo of societyLogoPaths()) {
    eleventyConfig.addPassthroughCopy({ [logo]: logo });
  }

  // ---------------------------------------------------------------------
  // Standard-event imagery — galleries, OG images and co-organiser logos.
  for (const img of eventImagePaths()) {
    eleventyConfig.addPassthroughCopy({ [img]: img });
  }

  // Contact page assets — the two initiative logos, derived from the record so
  // the list cannot drift from what the page actually references.
  // ---------------------------------------------------------------------
  for (const logo of contactLogoPaths()) {
    eleventyConfig.addPassthroughCopy({ [logo]: logo });
  }

  // Page-level imagery (the events listing hero), derived from content/pages/.
  // ---------------------------------------------------------------------
  for (const img of pageImagePaths()) {
    eleventyConfig.addPassthroughCopy({ [img]: img });
  }

  // Headshots — ONLY those a record actually references. The list is derived
  // from content/team/*.yaml rather than hard-coded, so it can never drift, and
  // copying the whole directory (which still holds one unreferenced leftover)
  // is avoided. Members with `photo: null` contribute nothing.
  for (const photo of teamPhotoPaths()) {
    eleventyConfig.addPassthroughCopy({ [photo]: photo });
  }

  // ---------------------------------------------------------------------
  // FIXTURES ARE NOT PRODUCTION OUTPUT.
  //
  // src/build-test/ holds architectural proof pages and the archive-disclosure
  // fixture. They must never reach the deployment tree — a test page that ships
  // is a page that can be indexed, linked or crawled by mistake.
  //
  // A normal build IGNORES them entirely. `BUILD_FIXTURES=1` builds ONLY them,
  // into .fixtures/ instead of dist/, so the chrome comparison and the archive-UI
  // test keep their coverage without production ever containing a fixture.
  // ---------------------------------------------------------------------
  const FIXTURES = process.env.BUILD_FIXTURES === "1";
  if (FIXTURES) {
    // Build the fixtures and nothing else: every other template is ignored, so
    // .fixtures/ cannot accidentally become a second copy of the site.
    for (const t of ["src/*.njk"]) eleventyConfig.ignores.add(t);
  } else {
    eleventyConfig.ignores.add("src/build-test/**");
  }

  // ---------------------------------------------------------------------
  // THE ADMIN PANEL IS NOT PRODUCTION OUTPUT.
  //
  // src/admin/ generates the local Decap CMS entry point. It is development
  // tooling: it is configured against a local file-system proxy that writes
  // directly into the working tree, and it carries no authentication whatever.
  // Publishing it would put an unauthenticated content editor on the public
  // internet.
  //
  // A normal build therefore IGNORES it completely, exactly as it ignores the
  // fixtures — so `npm run build` cannot emit dist/admin/ even by accident.
  // `CMS_DEV=1` opts in, and is only ever set by the `cms:*` npm scripts.
  //
  // See docs/CMS_FOUNDATION.md §2.
  // ---------------------------------------------------------------------
  /*
    THREE BUILDS, NOT TWO (Phase 17D.1).

      CMS_DEV=1              the local admin, into .cms/ — unchanged
      CMS_TARGET=production  the public site INCLUDING dist/admin/
      neither                the public site with no admin at all

    The third is still the default, so an ordinary `npm run build` cannot emit
    an admin panel by accident. Production is opted into by one explicit
    variable, set only by `npm run build:production`.
  */
  const CMS_PRODUCTION = process.env.CMS_TARGET === "production" && !FIXTURES;

  /*
    The bundled @netlify/identity library, served beside the login page.

    Copied for every build that emits that page — which is every public build,
    because the footer links to it. Generated by scripts/build-identity.js from
    the pinned package; see src/admin/staff-login.js for why it is self-hosted
    rather than loaded from a CDN.
  */
  if (!FIXTURES) {
    eleventyConfig.addPassthroughCopy({
      "src/admin/netlify-identity.bundle.js": "staff-login/netlify-identity.js",
    });
    /*
      The invitation e-mail Netlify Identity sends. Netlify reads a custom
      template from a path on the deployed site (Identity → Emails →
      Invitation template: /staff-login/emails/invitation.html). Ours links
      straight to the login page and carries the invited address, so the
      page can show it instead of asking for it. See src/admin/staff-login.js.
    */
    eleventyConfig.addPassthroughCopy({
      "src/email-templates/invitation.html": "staff-login/emails/invitation.html",
    });
  }
  const CMS_DEV = process.env.CMS_DEV === "1" && !FIXTURES;
  if (CMS_DEV) {
    // Build ONLY the admin, and into .cms/ rather than dist/.
    //
    // THIS SEPARATION IS THE FIX FOR A REAL EDITOR-FACING BUG. The admin used to
    // be built into dist/, which is also the public build's output directory —
    // so `npm run clean`, `npm run build` and `npm run validate:cms` deleted the
    // files backing a CMS an editor had open. Decap lazy-loads ~90 code-split
    // chunks after first paint, so the page kept working from memory while any
    // not-yet-fetched chunk started returning 404: "Failed to fetch", seemingly
    // at random, in whichever feature the editor happened to reach next.
    //
    // dist/ is now exclusively the public website; .cms/ is exclusively the
    // development CMS runtime, and no public build command touches it.
    for (const t of ["src/*.njk", "src/js/**", "src/build-test/**"]) {
      eleventyConfig.ignores.add(t);
    }
    // The Decap browser bundle, vendored from the pinned package rather than
    // loaded from a CDN. The whole directory is copied, not just the entry
    // file: the bundle is code-split into lazily-loaded chunks that resolve
    // relative to itself, and a missing chunk breaks a widget at the moment an
    // editor uses it.
    //
    // `decap-cms`, not `decap-cms-app`: the latter is a UMD module that leaves
    // React and ReactDOM as externals and does not initialise itself, so it
    // cannot be dropped straight into a <script> tag. `decap-cms` is the
    // self-contained browser build.
    eleventyConfig.addPassthroughCopy({
      "node_modules/decap-cms/dist": "admin",
    });
  } else if (CMS_PRODUCTION) {
    /*
      The production admin, from the same source as the local one — so there is
      one CMS to maintain, not two. What differs is the generated config.yml:
      CMS_TARGET=production switches its backend to the same-origin /api/cms
      Netlify Function. See src/_data/cmsConfig.js and docs/CMS_PRODUCTION.md.

      Bulk manage is emitted here too. It posts to /api/bulk/*, which is the
      local Node server on a developer's machine and a Netlify Function in
      production; the screen does not know the difference.
    */
    eleventyConfig.addPassthroughCopy({ "node_modules/decap-cms/dist": "admin" });
  } else {
    eleventyConfig.ignores.add("src/admin/**");
  }

  return {
    dir: {
      input: "src",
      // Three separate trees, deliberately: .fixtures/ for architectural proof
      // pages, .cms/ for the development admin, dist/ for the public site alone.
      output: FIXTURES ? ".fixtures" : CMS_DEV ? ".cms" : "dist",
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
