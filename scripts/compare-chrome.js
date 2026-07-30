#!/usr/bin/env node
/**
 * Semantic chrome comparison — generated vs live.
 *
 * Compares the header, navigation, language switcher and footer produced by the
 * Eleventy partials against the equivalent regions of a representative live
 * page, as NORMALISED HTML. Read-only; modifies nothing.
 *
 *   node scripts/compare-chrome.js          (run standalone)
 *   npm run validate                        (invoked as part of section 13)
 *
 * Deliberately NOT byte equality. These differences are normalised away and are
 * expected:
 *   - indentation, line endings, whitespace between tags
 *   - the .active nav item (differs per page by design)
 *   - language-switcher destinations (page-aware by design)
 *   - relative vs root-relative asset URLs — the generated chrome standardises
 *     on root-relative, which is depth-independent and removes the class of bug
 *     that once shipped (/pl/assets/… 404s). See SHARED_CHROME_MIGRATION.md.
 *
 * A heavier DOM/browser diffing framework is deliberately not used in this
 * phase; string normalisation is sufficient to catch structural drift.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

/** Slice an inclusive region between two markers. */
function region(html, startTag, endTag) {
  const i = html.indexOf(startTag);
  if (i < 0) return "";
  const j = html.indexOf(endTag, i);
  if (j < 0) return "";
  return html.slice(i, j + endTag.length);
}

/**
 * Normalise a chrome region so only structure, classes, labels and
 * destinations remain comparable.
 */
function normalise(html) {
  return (
    html
      // whitespace / line endings / indentation
      .replace(/\r\n/g, "\n")
      .replace(/>\s+</g, "><")
      .replace(/\s+/g, " ")
      // relative vs root-relative assets are equivalent when served from root
      .replace(/(src|href)="\.\.\/(assets|css|js)\//g, '$1="/$2/')
      .replace(/(src|href)="(assets|css|js)\//g, '$1="/$2/')
      // page-specific: which nav item is current
      .replace(/\s*class="active"/g, "")
      // page-specific: the switcher points at the current page
      .replace(/href="\/(?:pl\/)?[a-z0-9\-./]*"(\s+hreflang)/g, 'href="§PAGE§"$1')
      // relative internal links vs root-relative ones (404 uses root form)
      .replace(/href="\/((?:pl\/)?[a-z0-9-]+\.html)"/g, 'href="$1"')
      .replace(/href="pl\/([a-z0-9-]+\.html)"/g, 'href="$1"')
      .trim()
  );
}

const results = [];
const record = (ok, label, detail) => results.push({ ok, label, detail });

/** Compare one region between a live page and a generated page. */
function compareRegion(label, livePath, genPath, startTag, endTag) {
  if (!exists(livePath) || !exists(genPath)) {
    record(false, `${label}: missing file`, [livePath, genPath].filter((p) => !exists(p)));
    return;
  }
  const live = normalise(region(read(livePath), startTag, endTag));
  const gen = normalise(region(read(genPath), startTag, endTag));

  if (!live) return record(false, `${label}: region not found in ${livePath}`);
  if (!gen) return record(false, `${label}: region not found in ${genPath}`);

  if (live === gen) return record(true, `${label} matches ${livePath}`);

  // Report the first divergence with a little context, not the whole blob.
  let i = 0;
  while (i < live.length && i < gen.length && live[i] === gen[i]) i++;
  record(false, `${label} differs from ${livePath} at char ${i}`, [
    "live: …" + live.slice(Math.max(0, i - 60), i + 90),
    "gen : …" + gen.slice(Math.max(0, i - 60), i + 90),
  ]);
}

/** Structural assertions that survive normalisation. */
function compareFeatures(label, livePath, genPath) {
  const live = read(livePath);
  const gen = read(genPath);

  const FEATURES = [
    ["header element", /<header class="site-header">/],
    ["nav-inner wrapper", /<div class="nav-inner">/],
    ["brand link", /<a class="brand"/],
    ["brand wordmark rows", /<span class="brand-text" aria-hidden="true">(?:<span>[^<]*<\/span>){5}<\/span>/],
    ["burger button", /<button class="nav-toggle"[^>]*aria-expanded="false">(?:<span><\/span>){3}<\/button>/],
    ["nav list", /<ul class="nav-links">/],
    ["PBF nav item", /<a class="nav-pbf"[^>]*><span class="nav-pbf-logo" role="img"/],
    ["Lambert nav item", /<a class="nav-lambert"[^>]*target="_blank" rel="noopener">/],
    ["language switcher", /<nav class="lang-switch" aria-label="[^"]+">/],
    ["switcher separator", /<span class="sep" aria-hidden="true">\|<\/span>/],
    ["active language", /aria-current="true"/],
    ["footer element", /<footer class="site-footer">/],
    ["footer grid", /<div class="footer-grid">/],
    ["footer brand", /<div class="footer-brand">/],
    ["charity line", /<p class="charity-no">/],
    ["footer bottom", /<div class="footer-bottom">/],
    ["stylesheet", /<link rel="stylesheet" href="[^"]*css\/style\.css">/],
    ["main script", /<script src="[^"]*js\/main\.js"><\/script>/],
    ["favicon ico", /<link rel="icon" href="\/favicon\.ico" sizes="any">/],
    ["apple touch icon", /<link rel="apple-touch-icon" sizes="180x180"/],
    ["manifest", /<link rel="manifest" href="\/site\.webmanifest">/],
    ["theme colour", /<meta name="theme-color"/],
  ];

  const missingLive = FEATURES.filter(([, re]) => !re.test(live)).map(([n]) => n);
  const missingGen = FEATURES.filter(([, re]) => !re.test(gen)).map(([n]) => n);

  record(missingLive.length === 0,
    `${label}: reference page ${livePath} has all ${FEATURES.length} chrome features`,
    missingLive);
  record(missingGen.length === 0,
    `${label}: generated page has all ${FEATURES.length} chrome features`,
    missingGen);

  // No SVG favicon may be reintroduced.
  record(!/rel="icon"[^>]*image\/svg\+xml/.test(gen),
    `${label}: generated page declares no SVG favicon`,
    "an SVG favicon was reintroduced");

  // Nav destinations must match the live page's set.
  const navLinks = (html) => {
    const ul = region(html, '<ul class="nav-links">', "</ul>");
    return [...ul.matchAll(/href="([^"]+)"/g)]
      .map((m) => m[1].replace(/^\/(?:pl\/)?/, "").replace(/^pl\//, ""))
      .sort();
  };
  const a = navLinks(live), b = navLinks(gen);
  record(JSON.stringify(a) === JSON.stringify(b),
    `${label}: navigation destinations match`,
    [`live: ${a.join(" ")}`, `gen : ${b.join(" ")}`]);

  // Footer links must match too.
  const footLinks = (html) => {
    const f = region(html, '<footer class="site-footer">', "</footer>");
    return [...f.matchAll(/href="([^"]+)"/g)]
      .map((m) => m[1].replace(/^\/(?:pl\/)?/, "").replace(/^pl\//, ""))
      .sort();
  };
  const c = footLinks(live), d = footLinks(gen);
  record(JSON.stringify(c) === JSON.stringify(d),
    `${label}: footer links match`,
    [`live: ${c.join(" ")}`, `gen : ${d.join(" ")}`]);
}

/* --------------------------------------------------------------- run pairs */

const PAIRS = [
  ["EN chrome", "events.html", ".fixtures/build-test/chrome/index.html"],
  ["PL chrome", "pl/events.html", ".fixtures/build-test/chrome/pl/index.html"],
];

function run() {
  for (const [label, live, gen] of PAIRS) {
    if (!exists(gen)) {
      record(true, `${label}: generated page absent — run \`npm run build\` (skipped)`);
      continue;
    }
    compareRegion(`${label} header`, live, gen, '<header class="site-header">', "</header>");
    compareRegion(`${label} footer`, live, gen, '<footer class="site-footer">', "</footer>");
    compareFeatures(label, live, gen);
  }
  return results;
}

module.exports = { run, normalise, region };

if (require.main === module) {
  const res = run();
  let bad = 0;
  for (const r of res) {
    console.log((r.ok ? "  ✓ " : "  ✗ ") + r.label);
    if (!r.ok && r.detail) {
      (Array.isArray(r.detail) ? r.detail : [r.detail]).forEach((d) => console.log("      " + d));
      bad++;
    }
  }
  console.log(bad === 0 ? "\nchrome comparison: OK" : `\nchrome comparison: ${bad} difference(s)`);
  process.exit(bad === 0 ? 0 : 1);
}
