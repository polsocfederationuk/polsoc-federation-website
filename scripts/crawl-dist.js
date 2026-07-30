#!/usr/bin/env node
/**
 * crawl-dist.js — crawl every generated page and verify links, assets and metadata.
 *
 * Static crawl of the deployment tree as a web server would see it: every internal
 * link must resolve to a real file, every asset reference must exist with EXACTLY
 * the right case, and every indexable page must carry correct canonical/hreflang/
 * lang metadata.
 *
 * Case matters more than it looks. The committee develops on Windows, where
 * `assets/Logo.svg` and `assets/logo.svg` are the same file; on Netlify's
 * case-sensitive filesystem one of them is a 404. So paths are matched against a
 * case-exact index of the tree, not with fs.existsSync.
 *
 * Run:  node scripts/crawl-dist.js
 * Exit: 0 when everything resolves, 1 otherwise.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const publicRoutes = require("../src/_data/publicRoutes.js");
const DOMAIN = publicRoutes.domain;

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

/* ------------------------------------------------------------- tree index */

function walk(dir = "") {
  const out = [];
  for (const e of fs.readdirSync(path.join(DIST, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}
const FILES = walk().sort();
// Case-exact set, plus a lowercase map so a case-only mismatch is reported as
// such rather than as a plain "missing file".
const EXACT = new Set(FILES);
const LOWER = new Map(FILES.map((f) => [f.toLowerCase(), f]));

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".xml": "application/xml", ".txt": "text/plain",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".gif": "image/gif", ".avif": "image/avif",
};

const decode = (s) => String(s).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Resolve a reference from `fromFile` into a tree path, or a reason it fails. */
function resolveRef(fromFile, raw) {
  let r = decode(String(raw || "").trim());
  if (!r) return { skip: "empty" };
  if (r.startsWith(DOMAIN)) r = r.slice(DOMAIN.length) || "/";
  if (/^(mailto:|tel:|data:|javascript:)/i.test(r)) return { skip: "scheme" };
  if (/^https?:\/\//i.test(r)) return { skip: "external", href: r };
  const [pathPart, frag] = r.split("#");
  if (!pathPart) return { skip: "fragment", fragment: frag };
  const clean = pathPart.split("?")[0];
  const base = clean.startsWith("/") ? "" : path.posix.dirname(fromFile);
  let resolved = path.posix.normalize(path.posix.join(clean.startsWith("/") ? "" : base, clean.replace(/^\//, "")));
  if (resolved.startsWith("..")) return { escape: resolved };
  // A directory URL ("/", "/pl/") serves that directory's index.html.
  if (resolved === "" || resolved === "." || resolved.endsWith("/")) resolved = path.posix.join(resolved, "index.html");
  return { target: resolved, fragment: frag || null };
}

/* -------------------------------------------------------------- the crawl */

const htmlFiles = FILES.filter((f) => f.endsWith(".html"));
check("HTML pages found to crawl", htmlFiles.length > 0, htmlFiles.length);

const brokenLinks = [];
const caseMismatches = [];
const escapes = [];
const plAssetPaths = [];
const crossLanguage = [];
const sourceTargets = [];
const fixtureTargets = [];
const badMime = [];
const zeroByte = [];
const badFragments = [];
const externalSeen = new Set();

// Fragment index: which ids exist on which generated page.
const IDS = new Map();
for (const f of htmlFiles) {
  const src = fs.readFileSync(path.join(DIST, f), "utf8");
  IDS.set(f, new Set([...src.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
}

for (const f of [...htmlFiles, ...FILES.filter((x) => /\.(css|webmanifest|js)$/.test(x))]) {
  const src = fs.readFileSync(path.join(DIST, f), "utf8");
  const refs = [];

  if (f.endsWith(".webmanifest")) {
    try { for (const i of (JSON.parse(src).icons || [])) refs.push(["manifest icon", i.src]); } catch { /* checked below */ }
  } else if (f.endsWith(".css")) {
    // Inline SVG data URIs contain their own url(...) and %23 colour fragments;
    // scanning inside them yields nonsense targets, so they are neutralised first.
    // Matched to the CLOSING QUOTE, not the first ")": an inline SVG data URI
    // contains its own url(#id) references, so a paren-terminated pattern stops
    // half way and leaves the tail to be misread as a real reference.
    const noData = src
      .replace(/url\((['"])data:[\s\S]*?\1\s*\)/g, "url(data-uri)")
      .replace(/url\(\s*data:[^)]*\)/g, "url(data-uri)");
    for (const m of noData.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
      if (m[2] === "data-uri") continue;
      refs.push(["css url()", m[2]]);
    }
  } else if (f.endsWith(".js")) {
    // Comments document the "/assets/..." convention in prose; only real string
    // literals in code are references.
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const m of noComments.matchAll(/["'`](\/assets\/[^"'`]+)["'`]/g)) refs.push(["js asset", m[1]]);
  } else {
    // Match the WHOLE anchor tag, so attributes after href are visible too — the
    // language switcher writes href first and hreflang second.
    for (const m of src.matchAll(/<a\b[^>]*>/g)) {
      const href = (m[0].match(/\shref="([^"]+)"/) || [])[1];
      if (!href) continue;
      // An anchor carrying an explicit hreflang IS the language switcher; sending
      // the reader to the other language is precisely its job, so it is not a leak.
      refs.push([/\bhreflang=/.test(m[0]) ? "lang-switch" : "link", href]);
    }
    for (const m of src.matchAll(/<(?:img|script|source)\b[^>]*\ssrc="([^"]+)"/g)) refs.push(["asset", m[1]]);
    for (const m of src.matchAll(/<link\b[^>]*\shref="([^"]+)"/g)) refs.push(["link-tag", m[1]]);
    for (const m of src.matchAll(/srcset="([^"]+)"/g)) {
      for (const c of m[1].split(",")) refs.push(["srcset", c.trim().split(/\s+/)[0]]);
    }
    for (const m of src.matchAll(/style="[^"]*url\((['"]?)([^'")]+)\1\)/g)) refs.push(["inline style url()", m[2]]);
    for (const m of src.matchAll(/<meta[^>]+content="([^"]+)"/g)) {
      if (/^(https?:|\/)/.test(m[1])) refs.push(["meta", m[1]]);
    }
    for (const m of src.matchAll(/"(?:image|logo|url)":\s*"([^"]+)"/g)) refs.push(["json-ld", m[1]]);
  }

  for (const [kind, raw] of refs) {
    const r = resolveRef(f, raw);
    if (r.skip === "external") { externalSeen.add(r.href); continue; }
    if (r.skip) {
      if (r.skip === "fragment" && r.fragment) {
        const ids = IDS.get(f);
        if (ids && !ids.has(r.fragment)) badFragments.push(`${f} → #${r.fragment} (no such id on this page)`);
      }
      continue;
    }
    if (r.escape) { escapes.push(`${f} → ${raw} escapes the public root`); continue; }

    const target = r.target;
    if (/^pl\/assets\//.test(target)) plAssetPaths.push(`${f} → ${raw}`);
    if (/\.(njk|yaml|yml|md)$/.test(target)) sourceTargets.push(`${f} → ${raw}`);
    if (/build-test|fixture/.test(target)) fixtureTargets.push(`${f} → ${raw}`);

    if (!EXACT.has(target)) {
      const lower = LOWER.get(target.toLowerCase());
      if (lower) caseMismatches.push(`${f} → ${raw} (tree has "${lower}", case-sensitive hosts will 404)`);
      else brokenLinks.push(`${f} → ${raw} (resolved "${target}")`);
      continue;
    }

    // Fragment on another generated page.
    if (r.fragment && target.endsWith(".html")) {
      const ids = IDS.get(target);
      if (ids && !ids.has(r.fragment)) badFragments.push(`${f} → ${raw} (no #${r.fragment} on ${target})`);
    }
    const ext = path.posix.extname(target).toLowerCase();
    if (MIME[ext] === undefined) badMime.push(`${f} → ${target} (unknown type ${ext})`);
    if (fs.statSync(path.join(DIST, target)).size === 0) zeroByte.push(`${f} → ${target}`);

    // Language routing: a link from a Polish page that lands on an English page.
    if (kind === "link" && f.startsWith("pl/") && target.endsWith(".html")
      && !target.startsWith("pl/") && !/^(index|404)\.html$/.test(target)) {
      crossLanguage.push(`${f} → ${raw} (resolves to ${target}, leaving Polish)`);
    }
  }
}

check("every internal link and asset reference resolves", brokenLinks.length === 0, brokenLinks);
check("every reference matches the file's exact case", caseMismatches.length === 0, caseMismatches);
check("no reference escapes the public root with ../", escapes.length === 0, escapes);
check("no /pl/assets/ path anywhere", plAssetPaths.length === 0, plAssetPaths);
check("no link targets a source file", sourceTargets.length === 0, sourceTargets);
check("no link targets a build fixture", fixtureTargets.length === 0, fixtureTargets);
check("no link crosses from Polish to English", crossLanguage.length === 0, crossLanguage);
check("every resolved fragment exists on its target page", badFragments.length === 0, badFragments);
check("every referenced file has a plausible MIME type", badMime.length === 0, badMime);
check("no referenced file is zero bytes", zeroByte.length === 0, zeroByte);

/* ------------------------------------------------------------- metadata */

const indexable = new Map(publicRoutes.routes().map((r) => [r.file, r]));
const noindex = new Set(publicRoutes.noindexRoutes().map((r) => r.file));

const metaProblems = [];
const jsonLdProblems = [];
let jsonLdBlocks = 0;

for (const f of htmlFiles) {
  const src = fs.readFileSync(path.join(DIST, f), "utf8");
  const head = src.split("</head>")[0];
  const one = (re) => (head.match(new RegExp(re, "g")) || []).length;
  const g = (re) => { const m = head.match(re); return m ? m[1] : null; };
  const isPl = f.startsWith("pl/");

  if (indexable.has(f)) {
    const route = indexable.get(f);
    const expectedCanonical = DOMAIN + route.loc;
    if (one('<link rel="canonical"') !== 1) metaProblems.push(`${f}: expected exactly one canonical`);
    const canonical = g(/<link rel="canonical" href="([^"]+)"/);
    if (canonical !== expectedCanonical) metaProblems.push(`${f}: canonical "${canonical}" ≠ route "${expectedCanonical}"`);

    const alts = [...head.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)">/g)].map((m) => [m[1], m[2]]);
    const byLang = Object.fromEntries(alts);
    const pair = route.loc.replace(/^\/pl\//, "/").replace(/^\/$/, "/");
    const enLoc = isPl ? (route.loc === "/pl/" ? "/" : route.loc.replace(/^\/pl\//, "/")) : route.loc;
    const plLoc = isPl ? route.loc : (route.loc === "/" ? "/pl/" : "/pl" + route.loc);
    void pair;
    if (byLang.en !== DOMAIN + enLoc) metaProblems.push(`${f}: hreflang en is "${byLang.en}", expected "${DOMAIN + enLoc}"`);
    if (byLang.pl !== DOMAIN + plLoc) metaProblems.push(`${f}: hreflang pl is "${byLang.pl}", expected "${DOMAIN + plLoc}"`);
    if (byLang["x-default"] !== DOMAIN + enLoc) metaProblems.push(`${f}: x-default is not the English URL`);

    const lang = g(/<html lang="([^"]+)"/);
    if (lang !== (isPl ? "pl" : "en")) metaProblems.push(`${f}: html lang "${lang}"`);
    const ogLocale = g(/<meta property="og:locale" content="([^"]+)"/);
    if (ogLocale !== (isPl ? "pl_PL" : "en_GB")) metaProblems.push(`${f}: og:locale "${ogLocale}"`);
    if (/<meta name="robots"[^>]*noindex/i.test(head)) metaProblems.push(`${f}: indexable route is marked noindex`);
    if (one("<title>") !== 1) metaProblems.push(`${f}: expected exactly one <title>`);
    if (one('<meta name="description"') !== 1) metaProblems.push(`${f}: expected exactly one meta description`);
  } else if (noindex.has(f)) {
    // The deliberate inverse.
    if (!/<meta name="robots" content="noindex, follow">/.test(head)) metaProblems.push(`${f}: 404 must be "noindex, follow"`);
    if (one('<link rel="canonical"') !== 0) metaProblems.push(`${f}: 404 must have no canonical`);
    if (one('<link rel="alternate" hreflang') !== 0) metaProblems.push(`${f}: 404 must have no hreflang`);
  } else {
    metaProblems.push(`${f}: page is neither a known route nor a known noindex page`);
  }

  for (const m of src.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    jsonLdBlocks++;
    let parsed = null;
    try { parsed = JSON.parse(m[1]); } catch (e) { jsonLdProblems.push(`${f}: JSON-LD does not parse (${e.message})`); continue; }
    const urls = [];
    (function collect(node) {
      if (typeof node === "string") { if (node.startsWith(DOMAIN)) urls.push(node); return; }
      if (Array.isArray(node)) return node.forEach(collect);
      if (node && typeof node === "object") Object.values(node).forEach(collect);
    })(parsed);
    for (const u of urls) {
      const r = resolveRef(f, u);
      if (r.target && !EXACT.has(r.target)) jsonLdProblems.push(`${f}: JSON-LD URL does not resolve → ${u}`);
    }
  }
}

check("every page's metadata is correct for its route", metaProblems.length === 0, metaProblems);
check(`every JSON-LD block parses and its local URLs resolve (${jsonLdBlocks} blocks)`,
  jsonLdProblems.length === 0, jsonLdProblems);

// Duplicate titles / descriptions across indexable pages.
{
  const titles = new Map();
  const descs = new Map();
  for (const f of htmlFiles) {
    if (!indexable.has(f)) continue;
    const head = fs.readFileSync(path.join(DIST, f), "utf8").split("</head>")[0];
    const t = (head.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const d = (head.match(/<meta name="description" content="([^"]*)"/) || [])[1];
    if (t) titles.set(t, [...(titles.get(t) || []), f]);
    if (d) descs.set(d, [...(descs.get(d) || []), f]);
  }
  const dupT = [...titles.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `${v.join(", ")} share title "${k.slice(0, 50)}…"`);
  const dupD = [...descs.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `${v.join(", ")} share description`);
  check("no two indexable pages share a <title>", dupT.length === 0, dupT);
  check("no two indexable pages share a meta description", dupD.length === 0, dupD);
}

/* ------------------------------------------------------------- manifest */
{
  const rel = "site.webmanifest";
  if (!EXACT.has(rel)) check("site.webmanifest exists", false);
  else {
    let m = null;
    try { m = JSON.parse(fs.readFileSync(path.join(DIST, rel), "utf8")); } catch (e) { check("site.webmanifest parses", false, e.message); }
    if (m) {
      check("site.webmanifest parses", true);
      check("manifest start_url is the site root", m.start_url === "/", m.start_url);
      check("manifest scope is the site root", m.scope === "/", m.scope);
      check("manifest display is unchanged (standalone)", m.display === "standalone", m.display);
      check("manifest theme and background colours are present", !!m.theme_color && !!m.background_color,
        [m.theme_color, m.background_color]);
      const iconProblems = [];
      for (const icon of m.icons || []) {
        if (!String(icon.src).startsWith("/")) iconProblems.push(`${icon.src} is not root-relative`);
        if (/^\/pl\//.test(icon.src)) iconProblems.push(`${icon.src} is a /pl/ path`);
        const t = String(icon.src).replace(/^\//, "");
        if (!EXACT.has(t)) iconProblems.push(`${icon.src} does not exist in dist/`);
        const ext = path.posix.extname(t).toLowerCase();
        if (icon.type && MIME[ext] !== icon.type) iconProblems.push(`${icon.src} declares ${icon.type} but is ${MIME[ext]}`);
      }
      check(`every manifest icon exists with the right type (${(m.icons || []).length} icons)`,
        iconProblems.length === 0, iconProblems);
    }
  }
}

/* --------------------------------------------------------------- output */

console.log("\n" + "=".repeat(70));
console.log("  GENERATED SITE CRAWL — dist/");
console.log("=".repeat(70) + "\n");
console.log(`  ${htmlFiles.length} HTML pages · ${externalSeen.size} distinct external hosts/URLs · ${jsonLdBlocks} JSON-LD blocks\n`);
for (const r of results) {
  console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.label}`);
  if (!r.ok && r.detail) {
    const d = Array.isArray(r.detail) ? r.detail : [r.detail];
    d.slice(0, 15).forEach((x) => console.log(`          ${x}`));
    if (d.length > 15) console.log(`          … and ${d.length - 15} more`);
  }
}
console.log("\n" + "=".repeat(70));
if (failures === 0) console.log(`  PASS — ${results.length}/${results.length} crawl checks`);
else console.log(`  FAIL — ${failures} of ${results.length} crawl checks`);
console.log("=".repeat(70) + "\n");
process.exit(failures === 0 ? 0 : 1);
