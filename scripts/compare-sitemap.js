#!/usr/bin/env node
/**
 * compare-sitemap.js — the generated sitemap against the live one.
 *
 * Not a byte comparison: the generated file is produced from the route inventory
 * and formats itself. What must hold is the SEMANTICS — the same 22 URLs, on the
 * same scheme and host, with the same paths, no duplicates, no 404s, no fixtures.
 *
 * One deliberate semantic difference is enumerated and asserted rather than
 * ignored: `<lastmod>` is dropped. See docs/CUTOVER_READINESS.md §3.
 *
 * Run:  node scripts/compare-sitemap.js
 * Exit: 0 when the sitemaps agree, 1 otherwise.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const DOMAIN = "https://polsocfederation.pl";

let failures = 0;
const results = [];
const check = (label, expected, actual, note) => {
  const e = JSON.stringify(expected);
  const a = JSON.stringify(actual);
  const ok = e === a;
  if (!ok) failures++;
  results.push({ ok, label, expected: e, actual: a, note });
};

/** Minimal, strict-enough sitemap parse: entries in document order. */
function parseSitemap(xml, label) {
  // Reject anything that is not a well-formed-looking urlset before parsing.
  if (!/<\?xml version="1\.0" encoding="UTF-8"\?>/.test(xml)) {
    return { fatal: `${label}: missing or wrong XML declaration` };
  }
  if (!/<urlset\s+xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/.test(xml)) {
    return { fatal: `${label}: missing or wrong <urlset> namespace` };
  }
  // Tag balance — a cheap well-formedness check that catches truncation.
  const opens = (xml.match(/<url>/g) || []).length;
  const closes = (xml.match(/<\/url>/g) || []).length;
  if (opens !== closes) return { fatal: `${label}: ${opens} <url> vs ${closes} </url> — malformed XML` };
  if (!/<\/urlset>\s*$/.test(xml.trim() + "\n")) return { fatal: `${label}: <urlset> is not closed` };

  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => {
    const g = (tag) => { const x = m[1].match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return x ? x[1].trim() : null; };
    return { loc: g("loc"), lastmod: g("lastmod"), changefreq: g("changefreq"), priority: g("priority") };
  });
  return { entries };
}

const liveXml = read("sitemap.xml");
const genPath = "dist/sitemap.xml";
if (!fs.existsSync(path.join(ROOT, genPath))) {
  console.error(`FATAL: ${genPath} does not exist — run \`npm run build\` first.`);
  process.exit(1);
}
const genXml = read(genPath);

const live = parseSitemap(liveXml, "live sitemap.xml");
const gen = parseSitemap(genXml, "dist/sitemap.xml");
for (const p of [live, gen]) {
  if (p.fatal) { console.error("FATAL: " + p.fatal); process.exit(1); }
}
if (live.entries.length === 0 || gen.entries.length === 0) {
  console.error(`FATAL: parsed zero URLs (live ${live.entries.length}, generated ${gen.entries.length})`);
  process.exit(1);
}

const liveLocs = live.entries.map((e) => e.loc);
const genLocs = gen.entries.map((e) => e.loc);

/* ---- URL set and count -------------------------------------------------- */
check("URL count", liveLocs.length, genLocs.length);
check("URL set (sorted)", [...liveLocs].sort(), [...genLocs].sort());
check("URL order", liveLocs, genLocs);

/* ---- scheme, host, path hygiene ----------------------------------------- */
{
  const notHttps = genLocs.filter((u) => !u.startsWith("https://"));
  check("every URL uses HTTPS", [], notHttps);
  const wrongHost = genLocs.filter((u) => !u.startsWith(DOMAIN + "/"));
  check(`every URL is on ${DOMAIN}`, [], wrongHost);
  const dupes = genLocs.filter((u, i) => genLocs.indexOf(u) !== i);
  check("no duplicate URL", [], [...new Set(dupes)]);
  const withFragment = genLocs.filter((u) => u.includes("#"));
  check("no URL contains a fragment", [], withFragment);
  const withQuery = genLocs.filter((u) => u.includes("?"));
  check("no URL contains a query string", [], withQuery);
  const unescaped = genLocs.filter((u) => /&(?!amp;)/.test(u));
  check("no URL contains an unescaped ampersand", [], unescaped);
}

/* ---- forbidden entries -------------------------------------------------- */
{
  check("no 404 URL", [], genLocs.filter((u) => /404/.test(u)));
  check("no build-test or fixture URL", [], genLocs.filter((u) => /build-test|fixture|proof/i.test(u)));
  check("no source or documentation URL", [], genLocs.filter((u) => /\.(njk|yaml|yml|md|json|js|css)$/i.test(u)));
  check("no docs/ or src/ URL", [], genLocs.filter((u) => /\/(docs|src|scripts|content|node_modules)\//.test(u)));
}

/* ---- locale parity ------------------------------------------------------ */
{
  const en = genLocs.filter((u) => !u.startsWith(DOMAIN + "/pl/"));
  const pl = genLocs.filter((u) => u.startsWith(DOMAIN + "/pl/"));
  check("English and Polish URL counts match", en.length, pl.length);
  // Every English URL must have a Polish twin and vice versa.
  const toPl = (u) => (u === DOMAIN + "/" ? DOMAIN + "/pl/" : u.replace(DOMAIN + "/", DOMAIN + "/pl/"));
  const missingPl = en.map(toPl).filter((u) => !pl.includes(u));
  check("every English URL has a Polish equivalent", [], missingPl);
  const toEn = (u) => (u === DOMAIN + "/pl/" ? DOMAIN + "/" : u.replace(DOMAIN + "/pl/", DOMAIN + "/"));
  const missingEn = pl.map(toEn).filter((u) => !en.includes(u));
  check("every Polish URL has an English equivalent", [], missingEn);
}

/* ---- required pages ----------------------------------------------------- */
{
  const EVENTS = ["business-forum", "sikorski-debate", "christmas-dinner", "youth-congress", "icebreaker"];
  const missing = [];
  for (const slug of EVENTS) {
    for (const prefix of ["/", "/pl/"]) {
      const u = `${DOMAIN}${prefix}event-${slug}.html`;
      if (!genLocs.includes(u)) missing.push(u);
    }
  }
  check("every event detail page is listed (both locales)", [], missing);
  check("the English homepage is listed with a trailing slash and no index.html",
    true, genLocs.includes(DOMAIN + "/") && !genLocs.some((u) => /index\.html$/.test(u)));
  check("the Polish homepage is listed as /pl/", true, genLocs.includes(DOMAIN + "/pl/"));
}

/* ---- enumerated semantic differences ------------------------------------ */
{
  const liveHasLastmod = live.entries.filter((e) => e.lastmod).length;
  const genHasLastmod = gen.entries.filter((e) => e.lastmod).length;
  check("APPROVED: the live sitemap carries <lastmod> on every URL", liveLocs.length, liveHasLastmod,
    "enumerated difference — verified in both directions");
  check("APPROVED: the generated sitemap carries <lastmod> on none", 0, genHasLastmod,
    "no authoritative per-URL content date exists; a build-derived date would be non-deterministic and untrue");

  // changefreq and priority ARE preserved, per URL.
  const liveByLoc = Object.fromEntries(live.entries.map((e) => [e.loc, e]));
  const cfDiff = gen.entries
    .filter((e) => liveByLoc[e.loc] && e.changefreq !== liveByLoc[e.loc].changefreq)
    .map((e) => `${e.loc}: live ${liveByLoc[e.loc].changefreq} vs generated ${e.changefreq}`);
  check("every <changefreq> matches the live sitemap", [], cfDiff);
  const prDiff = gen.entries
    .filter((e) => liveByLoc[e.loc] && e.priority !== liveByLoc[e.loc].priority)
    .map((e) => `${e.loc}: live ${liveByLoc[e.loc].priority} vs generated ${e.priority}`);
  check("every <priority> matches the live sitemap", [], prDiff);

  // hreflang alternates: neither file has them, and that is deliberate.
  check("the live sitemap has no xhtml:link alternates", false, /xhtml:link/.test(liveXml));
  check("the generated sitemap has no xhtml:link alternates either (hreflang stays in the HTML)",
    false, /xhtml:link/.test(genXml));
}

/* ---- cross-check against the route inventory ---------------------------- */
{
  const publicRoutes = require("../src/_data/publicRoutes.js");
  const expected = publicRoutes.routes().map((r) => DOMAIN + r.loc);
  check("the generated sitemap matches the authoritative route inventory exactly", expected, genLocs);
}

/* -------------------------------------------------------------------- output */

const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
console.log("");
console.log("=".repeat(72));
console.log("  SITEMAP — live vs generated");
console.log("=".repeat(72));
console.log(`  live: ${liveLocs.length} URLs · generated: ${genLocs.length} URLs\n`);
for (const r of results) {
  if (r.ok && !verbose) continue;
  console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.label}`);
  if (!r.ok) {
    console.log(`          live/expected: ${r.expected}`);
    console.log(`          generated    : ${r.actual}`);
    if (r.note) console.log(`          note         : ${r.note}`);
  }
}
console.log("");
console.log("=".repeat(72));
if (failures === 0) console.log(`  PASS — ${results.length}/${results.length} sitemap comparisons matched`);
else console.log(`  FAIL — ${failures} of ${results.length} sitemap comparisons differ`);
console.log("=".repeat(72));
console.log("");
process.exit(failures === 0 ? 0 : 1);
