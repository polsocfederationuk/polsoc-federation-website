#!/usr/bin/env node
/**
 * audit-public-parity.js — will anything the public site serves today disappear
 * when Netlify starts publishing dist/?
 *
 * The repository root is BOTH the live website and a development workspace, so a
 * blind directory diff is useless — it would flag every script, doc and source
 * record as "missing". Instead this walks the live site the way a visitor or
 * crawler does, from the live sitemap and the live pages' own references, and
 * classifies each publicly reachable resource:
 *
 *   generated-equivalent      dist/ produces this route itself
 *   byte-identical-passthrough  copied into dist/ unchanged
 *   approved-replacement      intentionally different (enumerated below)
 *   not-publicly-required     reachable in the repo but not part of the site
 *   MISSING BLOCKER           publicly required and absent from dist/  ← fails
 *
 * Writes docs/CUTOVER_RESOURCE_MATRIX.json.
 *
 * Run:  node scripts/audit-public-parity.js
 * Exit: 0 when there are no blockers, 1 otherwise.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const DOMAIN = "https://polsocfederation.pl";
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const hash = (p) => crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, p))).digest("hex");

let failures = 0;
const results = [];
const check = (label, cond, detail) => {
  results.push({ ok: !!cond, label, detail });
  if (!cond) failures++;
};

if (!fs.existsSync(DIST)) {
  console.error("FATAL: dist/ does not exist — run `npm run build` first.");
  process.exit(1);
}

/* ------------------------------------------------ the live public surface */

/** Live pages, discovered from the live sitemap plus the two 404s. */
function livePages() {
  const xml = read("sitemap.xml");
  const locs = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((m) => m[1].trim());
  const pages = new Set();
  for (const loc of locs) {
    let p = loc.replace(DOMAIN, "").replace(/^\//, "");
    if (p === "" || p.endsWith("/")) p += "index.html";
    pages.add(p);
  }
  // Deliberately absent from the sitemap but publicly served.
  pages.add("404.html");
  pages.add("pl/404.html");
  return [...pages].sort();
}

const LIVE_PAGES = livePages();
check("live pages discovered from the live sitemap", LIVE_PAGES.length > 0, LIVE_PAGES.length);

/** Every local resource the live pages reference. */
function liveReferences() {
  const refs = new Map();               // resource path -> Set of referring pages
  const add = (res, from) => {
    if (!refs.has(res)) refs.set(res, new Set());
    refs.get(res).add(from);
  };
  for (const page of LIVE_PAGES) {
    if (!exists(page)) continue;
    // Comments are stripped FIRST. The live pages carry hand-editing instructions
    // containing placeholder markup (assets/events/my-event.jpg,
    // assets/team/name-surname.jpg) which is not part of the site — the same
    // commented block that made the Phase 10 audit misreport a card image.
    const src = read(page).replace(/<!--[\s\S]*?-->/g, "");
    const dir = path.posix.dirname(page) === "." ? "" : path.posix.dirname(page);
    const collect = (raw) => {
      let r = String(raw || "").trim();
      // Inline scripts build markup from template literals; `src="${item.image}"`
      // is code, not a reference to a file called "${item.image}".
      if (r.includes("${")) return;
      if (r.startsWith(DOMAIN)) r = r.slice(DOMAIN.length) || "/";
      if (!r || r.startsWith("#") || /^(https?:|mailto:|tel:|data:)/i.test(r)) return;
      r = r.split("#")[0].split("?")[0];
      if (!r) return;
      let resolved = r.startsWith("/")
        ? r.replace(/^\//, "")
        : path.posix.normalize(path.posix.join(dir, r));
      if (resolved === "" || resolved.endsWith("/")) resolved += "index.html";
      add(resolved, page);
    };
    for (const m of src.matchAll(/(?:src|href)="([^"]+)"/g)) collect(m[1]);
    for (const m of src.matchAll(/<meta[^>]+content="([^"]+)"/g)) if (/^(https?:|\/)/.test(m[1])) collect(m[1]);
    for (const m of src.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) collect(m[2]);
    for (const m of src.matchAll(/"(?:image|logo|url)":\s*"([^"]+)"/g)) collect(m[1]);
  }
  // Resources referenced from live CSS and JS, which pages load.
  for (const asset of [...refs.keys()].filter((r) => /\.(css|js)$/.test(r))) {
    if (!exists(asset)) continue;
    const src = read(asset);
    const dir = path.posix.dirname(asset);
    const noData = src
      .replace(/url\((['"])data:[\s\S]*?\1\s*\)/g, "url(data-uri)")
      .replace(/url\(\s*data:[^)]*\)/g, "url(data-uri)");
    for (const m of noData.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
      if (m[2] === "data-uri") continue;
      const r = m[2].split("#")[0].split("?")[0];
      if (!r || /^(https?:|data:)/i.test(r)) continue;
      add(r.startsWith("/") ? r.replace(/^\//, "") : path.posix.normalize(path.posix.join(dir, r)), asset);
    }
    if (asset.endsWith(".js")) {
      const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const m of noComments.matchAll(/["'`](\/assets\/[^"'`]+)["'`]/g)) add(m[1].replace(/^\//, ""), asset);
    }
  }
  // Manifest icons.
  if (exists("site.webmanifest")) {
    try {
      for (const i of (JSON.parse(read("site.webmanifest")).icons || [])) {
        add(String(i.src).replace(/^\//, ""), "site.webmanifest");
      }
    } catch { /* reported by the crawler */ }
  }
  return refs;
}

const REFS = liveReferences();

/* ----------------------------------------------------- approved replacements */

/**
 * Publicly served today, deliberately NOT byte-identical in dist/. Each is
 * enumerated with its reason, so an unexplained difference cannot hide here.
 */
const APPROVED_REPLACEMENTS = {
  "sitemap.xml": "generated from the route inventory (src/sitemap.njk); same 22 URLs, <lastmod> dropped — see docs/CUTOVER_READINESS.md §3",
  // The page data files were renamed in the announcements and members migrations:
  // a `-en` / `-pl` suffix replaced the `js/` vs `js/pl/` directory split, so both
  // locales' data sits in one directory. Nothing external links to these — they
  // are implementation details loaded by our own pages, and the generated pages
  // reference the new names (verified by scripts/crawl-dist.js).
  "js/announcements-data.js": "renamed to js/announcements-data-en.js (locale suffix replaces the js/pl/ split)",
  "js/pl/announcements-data.js": "renamed to js/announcements-data-pl.js (locale suffix replaces the js/pl/ split)",
  "js/societies-data.js": "renamed to js/societies-data-en.js (locale suffix replaces the js/pl/ split)",
  "js/pl/societies-data.js": "renamed to js/societies-data-pl.js (locale suffix replaces the js/pl/ split)",
};

/** The file each approved replacement is expected to become in dist/. */
const REPLACEMENT_TARGET = {
  "js/announcements-data.js": "js/announcements-data-en.js",
  "js/pl/announcements-data.js": "js/announcements-data-pl.js",
  "js/societies-data.js": "js/societies-data-en.js",
  "js/pl/societies-data.js": "js/societies-data-pl.js",
};

/** Live files that exist but are not part of the public website. */
const NOT_PUBLICLY_REQUIRED = [
  /^docs\//, /^scripts\//, /^src\//, /^content\//, /^node_modules\//,
  /^\.git/, /^\.claude/, /^package(-lock)?\.json$/, /^netlify\.toml$/,
  /^eleventy\.config\.js$/, /^README/i, /^\.gitignore$/,
];

/* ------------------------------------------------------------- classification */

const matrix = [];
const blockers = [];

// 1. Pages.
for (const page of LIVE_PAGES) {
  const inDist = exists(path.posix.join("dist", page));
  const row = {
    resource: page,
    kind: "page",
    liveExists: exists(page),
    distExists: inDist,
    classification: inDist ? "generated-equivalent" : "MISSING BLOCKER",
    referencedBy: [...(REFS.get(page) || [])].slice(0, 3),
  };
  if (!inDist) blockers.push(`${page} — live page has no generated equivalent`);
  matrix.push(row);
}

// 2. Referenced resources (assets, css, js, root files).
for (const [res, from] of [...REFS.entries()].sort()) {
  if (res.endsWith(".html")) continue;                    // pages handled above
  if (NOT_PUBLICLY_REQUIRED.some((re) => re.test(res))) {
    matrix.push({ resource: res, kind: "asset", classification: "not-publicly-required", referencedBy: [...from].slice(0, 3) });
    continue;
  }
  const liveExists = exists(res);
  const distPath = path.posix.join("dist", res);
  const distExists = exists(distPath);
  let classification;
  if (APPROVED_REPLACEMENTS[res]) classification = "approved-replacement";
  else if (!distExists) classification = "MISSING BLOCKER";
  else if (liveExists && hash(res) === hash(distPath)) classification = "byte-identical-passthrough";
  else classification = "content-differs";
  if (classification === "MISSING BLOCKER") blockers.push(`${res} — referenced by ${[...from][0]}, absent from dist/`);
  matrix.push({
    resource: res, kind: "asset", liveExists, distExists, classification,
    reason: APPROVED_REPLACEMENTS[res] || undefined,
    referencedBy: [...from].slice(0, 3),
  });
}

// 3. Root-level web-platform files, which nothing links but the platform fetches.
for (const res of ["favicon.ico", "site.webmanifest", "robots.txt", "sitemap.xml"]) {
  if (matrix.some((r) => r.resource === res)) continue;
  const distPath = path.posix.join("dist", res);
  const distExists = exists(distPath);
  let classification;
  if (APPROVED_REPLACEMENTS[res]) classification = "approved-replacement";
  else if (!distExists) classification = "MISSING BLOCKER";
  else if (exists(res) && hash(res) === hash(distPath)) classification = "byte-identical-passthrough";
  else classification = "content-differs";
  if (classification === "MISSING BLOCKER") blockers.push(`${res} — required root file absent from dist/`);
  matrix.push({
    resource: res, kind: "root-file", liveExists: exists(res), distExists, classification,
    reason: APPROVED_REPLACEMENTS[res] || undefined, referencedBy: ["(platform)"],
  });
}

/* --------------------------------------------------------------------- checks */

check("no publicly required resource is missing from dist/", blockers.length === 0, blockers);

{
  const differs = matrix.filter((r) => r.classification === "content-differs");
  check("every content difference is an enumerated approved replacement",
    differs.length === 0, differs.map((r) => `${r.resource} (differs but is not in the approved list)`));
}
{
  // A replacement is only approved if its stated successor actually exists — a
  // rename that never landed would otherwise be silently excused.
  const unfulfilled = Object.entries(REPLACEMENT_TARGET)
    .filter(([, target]) => !exists(path.posix.join("dist", target)))
    .map(([from, target]) => `${from} → ${target} (successor missing from dist/)`);
  check("every approved replacement's successor exists in dist/", unfulfilled.length === 0, unfulfilled);
}
{
  // Both 404 pages must survive the switch — the Netlify fallback depends on them.
  const missing404 = ["404.html", "pl/404.html"].filter((p) => !exists(path.posix.join("dist", p)));
  check("both 404 pages exist in dist/ (the Netlify /pl/* fallback target)", missing404.length === 0, missing404);
}
{
  const counts = matrix.reduce((a, r) => { a[r.classification] = (a[r.classification] || 0) + 1; return a; }, {});
  check("every classified resource has a non-blocking classification",
    !counts["MISSING BLOCKER"], counts);
}

/* --------------------------------------------------------------------- output */

const outPath = "docs/CUTOVER_RESOURCE_MATRIX.json";
const summary = matrix.reduce((a, r) => { a[r.classification] = (a[r.classification] || 0) + 1; return a; }, {});
fs.writeFileSync(path.join(ROOT, outPath), JSON.stringify({
  generated_by: "scripts/audit-public-parity.js",
  domain: DOMAIN,
  note: "Live public surface, walked from the live sitemap and the live pages' own references, "
      + "classified against the generated deployment tree. Regenerate with `npm run audit:public-parity`.",
  summary,
  blockers,
  resources: matrix.sort((a, b) => (a.kind + a.resource).localeCompare(b.kind + b.resource)),
}, null, 2) + "\n");

console.log("\n" + "=".repeat(72));
console.log("  PUBLIC PARITY — live root vs dist/");
console.log("=".repeat(72) + "\n");
console.log(`  ${LIVE_PAGES.length} live pages · ${matrix.length} classified resources\n`);
for (const [k, v] of Object.entries(summary).sort()) console.log(`    ${String(v).padStart(4)}  ${k}`);
console.log("");
for (const r of results) {
  console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.label}`);
  if (!r.ok && r.detail) {
    const d = Array.isArray(r.detail) ? r.detail : [JSON.stringify(r.detail)];
    d.slice(0, 15).forEach((x) => console.log(`          ${x}`));
    if (d.length > 15) console.log(`          … and ${d.length - 15} more`);
  }
}
console.log(`\n  matrix written: ${outPath}`);
console.log("\n" + "=".repeat(72));
if (failures === 0) console.log(`  PASS — ${results.length}/${results.length} parity checks, 0 blockers`);
else console.log(`  FAIL — ${failures} of ${results.length} parity checks, ${blockers.length} blocker(s)`);
console.log("=".repeat(72) + "\n");
process.exit(failures === 0 ? 0 : 1);
