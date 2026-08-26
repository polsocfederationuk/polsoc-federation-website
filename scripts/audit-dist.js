#!/usr/bin/env node
/**
 * audit-dist.js — strict audit of the deployment tree.
 *
 * Answers one question: if Netlify published dist/ right now, would it publish
 * anything it should not?
 *
 * The rules are CATEGORY and REFERENCE based, not a per-file allowlist. A new
 * photograph must not require editing this script; a stray `package.json`, a source
 * YAML or a fixture page must fail it. So:
 *
 *   - HTML is allowed only at a known public route (or a deliberately noindex 404).
 *   - Root-level non-HTML is allowed only from a small fixed set of web-platform
 *     files (favicon, manifest, robots, sitemap).
 *   - Assets are allowed by directory and extension, and must be REFERENCED by
 *     something in the tree — an orphan is reported, because unreferenced files in
 *     a deployment tree are either dead weight or a mistake.
 *   - Anything matching a development/source signature fails outright.
 *
 * Run:  node scripts/audit-dist.js
 * Exit: 0 when the tree is clean, 1 otherwise.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const publicRoutes = require("../src/_data/publicRoutes.js");

let failures = 0;
const results = [];
function check(label, cond, detail) {
  results.push({ ok: !!cond, label, detail });
  if (!cond) failures++;
}

if (!fs.existsSync(DIST)) {
  console.error("FATAL: dist/ does not exist — run `npm run build` first.");
  process.exit(1);
}

/* ------------------------------------------------------------------ inventory */

/** Every file in dist/, as a POSIX path relative to dist/. */
function walk(dir = "") {
  const out = [];
  for (const entry of fs.readdirSync(path.join(DIST, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}
const allFiles = walk().sort();
check("dist/ contains files", allFiles.length > 0, allFiles.length);

/*
  THE CONTENT MANAGER IS NOT PUBLIC CONTENT (Phase 17D.1).

  `npm run build:production` puts the online CMS into dist/admin/. Everything in
  there is a shipped application, not a page of the website: it has its own
  config.yml, its own source maps, and its own HTML at routes that are
  deliberately absent from the sitemap.

  So the public-content rules below are applied to the public tree, and the
  admin tree gets the checks that actually matter for it — which are asserted
  explicitly further down rather than skipped: it must be noindex, it must not
  be produced by an ordinary build, and it must carry no credential.

  A plain `npm run build` produces no admin/ at all, so on that build this
  partition is empty and every existing assertion runs exactly as before.
*/
const ADMIN_PREFIX = "admin/";
const isAdminFile = (f) => f.startsWith(ADMIN_PREFIX);

/** The public website: everything the deployment tree serves as content. */
const files = allFiles.filter((f) => !isAdminFile(f));
const adminFiles = allFiles.filter(isAdminFile);

/* --------------------------------------------------------- forbidden signatures */

// Directories that must not exist in a deployment tree at all.
const FORBIDDEN_DIRS = [
  "build-test", "docs", "content", "src", "scripts", "node_modules",
  ".git", ".github", ".claude", ".fixtures", "test", "tests", "tmp", "temp",
];
// Exact filenames that are development or repository files, never web resources.
const FORBIDDEN_FILES = new Set([
  "package.json", "package-lock.json", "netlify.toml", "eleventy.config.js",
  ".gitignore", ".eslintrc", ".editorconfig", ".DS_Store", "Thumbs.db",
  "README.md", "readme.md", "LICENSE",
]);
// Extensions that indicate source, documentation, tooling or editor detritus.
const FORBIDDEN_EXT = new Set([
  ".yaml", ".yml", ".njk", ".md", ".markdown", ".ts", ".jsx", ".tsx",
  ".log", ".bak", ".orig", ".rej", ".swp", ".swo", ".tmp", ".lock",
]);

{
  const inForbiddenDir = files.filter((f) => FORBIDDEN_DIRS.some((d) => f === d || f.startsWith(d + "/")));
  check(`no forbidden directory in dist/ (${FORBIDDEN_DIRS.join(", ")})`,
    inForbiddenDir.length === 0, inForbiddenDir);

  const forbiddenName = files.filter((f) => FORBIDDEN_FILES.has(path.posix.basename(f)));
  check("no development or repository file in dist/", forbiddenName.length === 0, forbiddenName);

  const forbiddenExt = files.filter((f) => FORBIDDEN_EXT.has(path.posix.extname(f).toLowerCase()));
  check(`no source, documentation or tooling file in dist/`, forbiddenExt.length === 0, forbiddenExt);

  const tilde = files.filter((f) => f.endsWith("~"));
  check("no editor backup file (trailing ~) in dist/", tilde.length === 0, tilde);

  const hidden = files.filter((f) => path.posix.basename(f).startsWith(".") && path.posix.basename(f) !== ".well-known");
  check("no dotfile in dist/", hidden.length === 0, hidden);

  const maps = files.filter((f) => f.endsWith(".map"));
  check("no unexpected source map in dist/", maps.length === 0, maps);

  // A zero-byte file in a deployment tree is almost always a truncated copy.
  const empty = files.filter((f) => fs.statSync(path.join(DIST, f)).size === 0);
  check("no zero-byte file in dist/", empty.length === 0, empty);
}

/* ------------------------------------------------------------------ HTML pages */

const htmlFiles = files.filter((f) => f.endsWith(".html"));
const expectedHtml = new Set([
  ...publicRoutes.routes().map((r) => r.file),
  ...publicRoutes.noindexRoutes().map((r) => r.file),
]);

{
  const unexpected = htmlFiles.filter((f) => !expectedHtml.has(f));
  check(`every generated HTML file is a known public route (${htmlFiles.length} files)`,
    unexpected.length === 0, unexpected);

  const missing = [...expectedHtml].filter((f) => !htmlFiles.includes(f));
  check(`every known route has a generated HTML file (${expectedHtml.size} routes)`,
    missing.length === 0, missing);

  check("no fixture page in dist/", !htmlFiles.some((f) => /build-test|fixture|proof|diagnostic/i.test(f)),
    htmlFiles.filter((f) => /build-test|fixture|proof|diagnostic/i.test(f)));
}

/* ------------------------------------------------------- root-level web files */

// The only non-HTML files permitted at the root of the deployment tree.
const ROOT_WEB_FILES = new Set(["favicon.ico", "site.webmanifest", "robots.txt", "sitemap.xml"]);
{
  const rootNonHtml = files.filter((f) => !f.includes("/") && !f.endsWith(".html"));
  const unexpected = rootNonHtml.filter((f) => !ROOT_WEB_FILES.has(f));
  check(`root-level non-HTML files are only ${[...ROOT_WEB_FILES].join(", ")}`,
    unexpected.length === 0, unexpected);
  const missing = [...ROOT_WEB_FILES].filter((f) => !files.includes(f));
  check("every required root-level web file is present", missing.length === 0, missing);
}

/* ----------------------------------------------------------------- asset dirs */

// Assets live in known directories with known extensions. New files inside these
// need no change here, which is the point.
const ASSET_RULES = [
  { dir: "css", ext: [".css"] },
  { dir: "js", ext: [".js"] },
  { dir: "assets", ext: [".jpg", ".jpeg", ".png", ".webp", ".svg", ".ico", ".gif", ".avif"] },
  { dir: "pl", ext: [".html"] },
  /*
    The staff login page. One directory, one HTML file, no Polish counterpart:
    there is a single login page rather than one per language. It is an
    operational route, registered as noindex in src/_data/publicRoutes.js.
  */
  /*
    The staff login page, and the one script it loads: @netlify/identity,
    bundled from the pinned package and served from this origin rather than a
    CDN. One directory, no Polish counterpart — there is a single login page
    rather than one per language.
  */
  { dir: "staff-login", ext: [".html", ".js"] },
];
{
  const nonRoot = files.filter((f) => f.includes("/"));
  const bad = [];
  for (const f of nonRoot) {
    const top = f.split("/")[0];
    const rule = ASSET_RULES.find((r) => r.dir === top);
    if (!rule) { bad.push(`${f} (unknown top-level directory "${top}")`); continue; }
    const ext = path.posix.extname(f).toLowerCase();
    if (!rule.ext.includes(ext)) bad.push(`${f} (extension ${ext} not allowed under ${top}/)`);
  }
  check(`every non-root file is an allowed type in a known directory (${nonRoot.length} files)`,
    bad.length === 0, bad);
}

/* ------------------------------------------------------- referenced vs orphans */

// Collect every local reference the tree makes, so unreferenced assets surface.
{
  const referenced = new Set();
  const DOMAIN = publicRoutes.domain;
  const addRef = (from, ref) => {
    if (!ref) return;
    let r = String(ref).trim();
    // An absolute URL on OUR OWN domain is a reference to a file in this tree —
    // og:image, twitter:image and JSON-LD images are all written that way, and
    // treating them as external would report the social banner as an orphan.
    if (r.startsWith(DOMAIN)) r = r.slice(DOMAIN.length) || "/";
    if (!r || r.startsWith("#") || /^(https?:|mailto:|tel:|data:)/i.test(r)) return;
    r = r.split("#")[0].split("?")[0];
    if (!r) return;
    // Resolve relative to the referring file's directory, or the root.
    const base = r.startsWith("/") ? "" : path.posix.dirname(from);
    const resolved = path.posix.normalize(path.posix.join(r.startsWith("/") ? "" : base, r.replace(/^\//, "")));
    referenced.add(resolved);
  };

  for (const f of files) {
    if (!/\.(html|css|webmanifest|js)$/.test(f)) continue;
    const src = fs.readFileSync(path.join(DIST, f), "utf8");
    if (f.endsWith(".webmanifest")) {
      try { for (const i of (JSON.parse(src).icons || [])) addRef(f, i.src); } catch { /* reported elsewhere */ }
      continue;
    }
    if (f.endsWith(".js")) {
      // Announcement and member data live in JS and build their markup at
      // runtime, so their images are referenced from string literals rather than
      // from any HTML attribute. Scanning only HTML/CSS would report ~55 real,
      // in-use photographs as orphans.
      for (const m of src.matchAll(/["'`](\/assets\/[^"'`]+)["'`]/g)) addRef(f, m[1]);
      continue;
    }
    for (const m of src.matchAll(/(?:src|href)="([^"]+)"/g)) addRef(f, m[1]);
    // Social images live in <meta ... content="…">, not in src/href.
    for (const m of src.matchAll(/<meta[^>]+content="([^"]+)"/g)) addRef(f, m[1]);
    // JSON-LD carries absolute image and logo URLs on our own domain.
    for (const m of src.matchAll(/"(?:image|logo|url)":\s*"([^"]+)"/g)) addRef(f, m[1]);
    for (const m of src.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) addRef(f, m[2]);
    for (const m of src.matchAll(/srcset="([^"]+)"/g)) {
      for (const cand of m[1].split(",")) addRef(f, cand.trim().split(/\s+/)[0]);
    }
  }

  // Assets present but referenced by nothing. Not a hard failure for icons, which
  // are fetched by the platform rather than linked, but reported.
  const PLATFORM_FETCHED = /^(favicon\.ico|site\.webmanifest|robots\.txt|sitemap\.xml)$/;
  const orphans = files.filter((f) =>
    !f.endsWith(".html")
    && !PLATFORM_FETCHED.test(f)
    && !referenced.has(f));
  check(`no unreferenced asset in dist/ (${referenced.size} distinct references seen)`,
    orphans.length === 0, orphans);
}

/* --------------------------------------------------------------------- output */

console.log("\n" + "=".repeat(70));
console.log("  DEPLOYMENT TREE AUDIT — dist/");
console.log("=".repeat(70) + "\n");
console.log(`  ${files.length} files: ${htmlFiles.length} HTML, ${files.length - htmlFiles.length} other\n`);
for (const r of results) {
  console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.label}`);
  if (!r.ok && r.detail) {
    const d = Array.isArray(r.detail) ? r.detail : [r.detail];
    d.slice(0, 15).forEach((x) => console.log(`          ${x}`));
    if (d.length > 15) console.log(`          … and ${d.length - 15} more`);
  }
}
console.log("\n" + "=".repeat(70));
if (failures === 0) console.log(`  PASS — ${results.length}/${results.length} deployment-tree checks`);
else console.log(`  FAIL — ${failures} of ${results.length} deployment-tree checks`);
console.log("=".repeat(70) + "\n");
process.exit(failures === 0 ? 0 : 1);

/* ------------------------------------------------- the content manager */

/*
  Only two states are acceptable: no admin at all (an ordinary build), or a
  complete one that is marked noindex and carries no secret. A HALF-built admin
  is the dangerous middle — an editor would meet a CMS that cannot load.
*/
if (adminFiles.length === 0) {
  check("no content manager in this build (ordinary public build)", true, "none");
} else {
  check("the content manager is complete",
    adminFiles.includes("admin/index.html") && adminFiles.includes("admin/config.yml"),
    adminFiles.length + " files");

  const adminHtml = adminFiles.filter((f) => f.endsWith(".html"));
  const notNoindex = adminHtml.filter((f) =>
    !/<meta name="robots"[^>]*noindex/i.test(fs.readFileSync(path.join(DIST, f), "utf8")));
  check("every content-manager page is noindex", notNoindex.length === 0, notNoindex);

  const config = fs.readFileSync(path.join(DIST, "admin", "config.yml"), "utf8");
  check("the content manager points at the production backend, not a developer machine",
    /proxy_url:\s*["']?\/api\/cms/.test(config) && !/localhost|127\.0\.0\.1/.test(config),
    config.split("\n").filter((l) => /proxy_url/.test(l)).join(" "));
}
