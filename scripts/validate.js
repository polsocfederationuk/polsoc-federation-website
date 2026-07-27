#!/usr/bin/env node
/**
 * Static site validator — Federation of Polish Student Societies in the UK
 *
 * Read-only. Inspects the repository source and reports problems; it never
 * rewrites a file. Run with:  npm run validate
 *
 * Dependency-free on purpose: the site has no build step, and this script must
 * not become the thin end of a toolchain wedge. Node's standard library only.
 *
 * The rules encoded here come from docs/BILINGUAL_SITE.md and
 * docs/ADMIN_SYSTEM_AUDIT.md. Where a check looks unusual there is a comment
 * explaining which deliberate behaviour it is protecting.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SITE = "https://polsocfederation.pl";

/* ------------------------------------------------------------------ output */

const problems = [];
let checks = 0;
let currentSection = "";

const section = (name) => {
  currentSection = name;
  console.log("\n" + name);
  console.log("-".repeat(name.length));
};

const ok = (msg) => {
  checks++;
  console.log("  \u2713 " + msg);
};

const fail = (msg, detail) => {
  checks++;
  problems.push({ section: currentSection, msg, detail });
  console.log("  \u2717 " + msg);
  if (detail) {
    (Array.isArray(detail) ? detail : [detail])
      .slice(0, 12)
      .forEach((d) => console.log("      " + d));
    if (Array.isArray(detail) && detail.length > 12) {
      console.log(`      … and ${detail.length - 12} more`);
    }
  }
};

const assert = (cond, good, bad, detail) => (cond ? ok(good) : fail(bad, detail));

/* ------------------------------------------------------------------ helpers */

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const listHtml = (dir) =>
  fs
    .readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith(".html"))
    .sort();

/** Strip comments and <script>/<style> bodies so we only inspect real markup. */
const stripNonMarkup = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

const head = (html) => html.split("</head>")[0];

/** Page identity: "events.html" in either tree; index.html maps to / and /pl/. */
const enUrl = (file) => (file === "index.html" ? "/" : "/" + file);
const plUrl = (file) => (file === "index.html" ? "/pl/" : "/pl/" + file);

/** Resolve a link/asset reference found on `pageRel` to a repo-relative path. */
const resolveRef = (pageRel, ref) => {
  const clean = ref.split("?")[0].split("#")[0];
  if (!clean) return null;
  let target;
  if (clean.startsWith("/")) {
    target = clean.slice(1); // root-relative -> repo root
  } else {
    target = path.posix.join(path.posix.dirname(pageRel.replace(/\\/g, "/")), clean);
  }
  // "/" -> index.html, "/pl/" -> pl/index.html
  if (target === "" ) target = "index.html";
  else if (target.endsWith("/")) target += "index.html";
  return path.posix.normalize(target);
};

const isExternalRef = (ref) =>
  /^(https?:|mailto:|tel:|#|data:|javascript:|\/\/)/i.test(ref) || ref.includes("${");

/* ------------------------------------------------------------------ inventory */

const EN_PAGES = listHtml(".");
const PL_PAGES = listHtml("pl");
const NOINDEX = new Set(["404.html"]); // excluded from canonical/hreflang/sitemap
const INDEXABLE = EN_PAGES.filter((f) => !NOINDEX.has(f));

/** [repoPath, file, lang] for every page. */
const ALL = [
  ...EN_PAGES.map((f) => [f, f, "en"]),
  ...PL_PAGES.map((f) => ["pl/" + f, f, "pl"]),
];

console.log("Validating " + ROOT);
console.log(`${EN_PAGES.length} English + ${PL_PAGES.length} Polish pages`);

/* =================================================================== 1. pairing */

section("1. Page inventory and EN/PL pairing");

const EXPECTED = [
  "404.html", "announcements.html", "contact.html",
  "event-business-forum.html", "event-christmas-dinner.html",
  "event-icebreaker.html", "event-sikorski-debate.html",
  "event-youth-congress.html", "events.html", "index.html",
  "members.html", "team.html",
];

const missingExpected = EXPECTED.filter((f) => !EN_PAGES.includes(f));
assert(missingExpected.length === 0,
  `all ${EXPECTED.length} expected English pages exist`,
  "expected English pages are missing", missingExpected);

const onlyEn = EN_PAGES.filter((f) => !PL_PAGES.includes(f));
const onlyPl = PL_PAGES.filter((f) => !EN_PAGES.includes(f));
assert(onlyEn.length === 0 && onlyPl.length === 0,
  "every English page has a Polish twin with the same filename",
  "English/Polish filenames are not paired",
  [...onlyEn.map((f) => "only in root: " + f), ...onlyPl.map((f) => "only in /pl/: " + f)]);

/* =================================================================== 2. lang */

section("2. HTML language attribute");

const wrongLang = ALL.filter(([rel, , lang]) =>
  !new RegExp(`<html lang="${lang}">`).test(read(rel)));
assert(wrongLang.length === 0,
  `all ${ALL.length} pages declare the correct <html lang>`,
  "pages with a wrong or missing <html lang>",
  wrongLang.map(([rel, , lang]) => `${rel} should be lang="${lang}"`));

/* =================================================================== 3. canonical + hreflang */

section("3. Canonicals and hreflang");

const canonicalIssues = [];
const hreflangIssues = [];

for (const [rel, file, lang] of ALL) {
  if (NOINDEX.has(file)) continue; // 404s deliberately carry neither
  const h = head(read(rel));
  const self = lang === "en" ? enUrl(file) : plUrl(file);

  const canon = h.match(/<link rel="canonical" href="([^"]+)">/);
  if (!canon) {
    canonicalIssues.push(`${rel}: no canonical`);
  } else if (canon[1] !== SITE + self) {
    canonicalIssues.push(`${rel}: canonical is ${canon[1]}, expected ${SITE + self}`);
  }
  // A Polish canonical pointing at the English page is the specific failure
  // BILINGUAL_SITE.md §4 warns about, so name it explicitly.
  if (canon && lang === "pl" && canon[1] === SITE + enUrl(file)) {
    canonicalIssues.push(`${rel}: Polish canonical points at the English page`);
  }

  const want = {
    en: `<link rel="alternate" hreflang="en" href="${SITE}${enUrl(file)}">`,
    pl: `<link rel="alternate" hreflang="pl" href="${SITE}${plUrl(file)}">`,
    "x-default": `<link rel="alternate" hreflang="x-default" href="${SITE}${enUrl(file)}">`,
  };
  for (const [k, tag] of Object.entries(want)) {
    if (!h.includes(tag)) hreflangIssues.push(`${rel}: missing or wrong hreflang="${k}"`);
  }
}

assert(canonicalIssues.length === 0,
  `all ${INDEXABLE.length * 2} indexable pages are self-canonical on ${SITE}`,
  "canonical problems", canonicalIssues);
assert(hreflangIssues.length === 0,
  "hreflang en/pl/x-default present and reciprocal on every pair (x-default = English)",
  "hreflang problems", hreflangIssues);

/* =================================================================== 4. 404 pages */

section("4. 404 pages");

for (const rel of ["404.html", "pl/404.html"]) {
  assert(exists(rel), `${rel} exists`, `${rel} is missing`);
  if (!exists(rel)) continue;
  const h = read(rel);
  assert(/<meta name="robots" content="noindex, follow">/.test(h),
    `${rel} declares noindex, follow`,
    `${rel} is missing <meta name="robots" content="noindex, follow">`);
  assert(!/rel="canonical"/.test(head(h)) && !/hreflang=/.test(head(h)),
    `${rel} correctly has no canonical or hreflang`,
    `${rel} should not carry a canonical or hreflang`);
}

/* =================================================================== 5. sitemap */

section("5. Sitemap");

const sitemapRaw = read("sitemap.xml");
const locs = [...sitemapRaw.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

assert(/^<\?xml version="1\.0" encoding="UTF-8"\?>/.test(sitemapRaw.trim()) &&
  sitemapRaw.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'),
  "sitemap.xml is a well-formed urlset", "sitemap.xml header/namespace is wrong");

assert(locs.every((l) => l.startsWith(SITE)),
  `all ${locs.length} sitemap URLs are absolute on ${SITE}`,
  "sitemap contains non-absolute or wrong-host URLs",
  locs.filter((l) => !l.startsWith(SITE)));

const dupes = locs.filter((l, i) => locs.indexOf(l) !== i);
assert(dupes.length === 0, "no duplicate sitemap URLs", "duplicate sitemap URLs", [...new Set(dupes)]);

assert(!locs.some((l) => /404/.test(l)),
  "both 404 pages are excluded from the sitemap",
  "a 404 page appears in the sitemap", locs.filter((l) => /404/.test(l)));

const wantLocs = [
  ...INDEXABLE.map((f) => SITE + enUrl(f)),
  ...INDEXABLE.map((f) => SITE + plUrl(f)),
];
const missingLoc = wantLocs.filter((u) => !locs.includes(u));
const strayLoc = locs.filter((u) => !wantLocs.includes(u));
assert(missingLoc.length === 0 && strayLoc.length === 0,
  `sitemap lists exactly the ${wantLocs.length} indexable pages (${INDEXABLE.length} EN + ${INDEXABLE.length} PL)`,
  "sitemap contents do not match the page inventory",
  [...missingLoc.map((u) => "missing: " + u), ...strayLoc.map((u) => "unexpected: " + u)]);

const unbacked = locs
  .map((l) => [l, resolveRef("sitemap.xml", l.replace(SITE, ""))])
  .filter(([, t]) => t && !exists(t));
assert(unbacked.length === 0,
  "every sitemap URL maps to a real file",
  "sitemap URLs with no file behind them", unbacked.map(([l, t]) => `${l} -> ${t}`));

// lastmod is read, never rewritten — a generator that stamps today's date on
// every page destroys the signal (ADMIN_SYSTEM_AUDIT.md §6.5).
const lastmods = [...new Set([...sitemapRaw.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]))];
assert(lastmods.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
  `lastmod values are well-formed (${lastmods.join(", ")}) — not rewritten by this script`,
  "malformed lastmod values", lastmods.filter((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d)));

/* =================================================================== 6. links */

section("6. Internal links");

const linkIssues = [];
const langLeaks = [];

for (const [rel, , lang] of ALL) {
  const markup = stripNonMarkup(read(rel));

  for (const m of markup.matchAll(/(?:href|src)="([^"]*)"/g)) {
    const ref = m[1];
    if (!ref || isExternalRef(ref)) continue;
    const target = resolveRef(rel, ref);
    if (target && !exists(target)) {
      linkIssues.push(`${rel} -> ${ref} (resolves to ${target})`);
    }
  }

  // A Polish page must not link into the English tree, EXCEPT via the language
  // switcher. Relative links are what keep each language routed to its own
  // pages (BILINGUAL_SITE.md §3).
  if (lang === "pl") {
    const withoutSwitcher = markup.replace(
      /<nav class="lang-switch"[\s\S]*?<\/nav>/g, "");
    for (const m of withoutSwitcher.matchAll(/href="(\/(?!pl\/)[a-z0-9-]+\.html)"/g)) {
      langLeaks.push(`${rel} -> ${m[1]}`);
    }
  }
}

assert(linkIssues.length === 0,
  "every local href/src in markup resolves to a real file",
  "broken local references", linkIssues);
assert(langLeaks.length === 0,
  "no Polish page links into the English tree outside the language switcher",
  "Polish pages leaking to English URLs", langLeaks);

/* =================================================================== 7. data-file assets */

section("7. Data-file asset paths");

/** Load a data file by evaluating it in an isolated function scope. */
const loadData = (rel, varName) => {
  const src = read(rel);
  // eslint-disable-next-line no-new-func
  return new Function(`${src}; return ${varName};`)();
};

for (const [rel, varName] of [
  ["js/announcements-data.js", "ANNOUNCEMENTS"],
  ["js/pl/announcements-data.js", "ANNOUNCEMENTS"],
]) {
  const data = loadData(rel, varName);
  const imgs = [];
  data.forEach((a) => {
    if (a.image) imgs.push(a.image);
    (a.extraImages || []).forEach((x) => imgs.push(x));
  });

  // Root-relative is load-bearing: a relative path in a data file resolves
  // against the PAGE url, so "assets/x.jpg" 404s as /pl/assets/x.jpg.
  const notRootRel = imgs.filter((p) => !p.startsWith("/assets/"));
  assert(notRootRel.length === 0,
    `${rel}: all ${imgs.length} image paths are root-relative (/assets/…)`,
    `${rel}: image paths must be root-relative or they break under /pl/`, notRootRel);

  const missingImg = imgs.filter((p) => !exists(p.replace(/^\//, "")));
  assert(missingImg.length === 0,
    `${rel}: every referenced image exists on disk`,
    `${rel}: missing image files`, missingImg);

  // Event links must stay RELATIVE so each language resolves to its own page.
  // This is deliberate and must not be "fixed".
  const links = data.filter((a) => a.link && !a.link.external).map((a) => a.link.href);
  const absLinks = links.filter((h) => h.startsWith("/") || /^https?:/.test(h));
  assert(absLinks.length === 0,
    `${rel}: all ${links.length} internal event links stay relative (language routing)`,
    `${rel}: internal event links must stay relative`, absLinks);

  const dir = rel.startsWith("js/pl/") ? "pl/" : "";
  const brokenLinks = links.filter((h) => !exists(dir + h));
  assert(brokenLinks.length === 0,
    `${rel}: relative event links resolve inside ${dir || "the root"}`,
    `${rel}: relative event links do not resolve`, brokenLinks);
}

// Societies: only `uni` is translated; everything else must stay identical or
// the two maps drift apart (BILINGUAL_SITE.md §5).
const socEn = loadData("js/societies-data.js", "SOCIETIES");
const socPl = loadData("js/pl/societies-data.js", "SOCIETIES");
assert(socEn.length === socPl.length,
  `societies data has the same entry count in both languages (${socEn.length})`,
  "societies data entry counts differ",
  [`en=${socEn.length} pl=${socPl.length}`]);

const socDrift = [];
socEn.forEach((e, i) => {
  const p = socPl[i];
  if (!p) return;
  ["name", "lat", "lng", "instagram", "email", "logo"].forEach((k) => {
    if (e[k] !== p[k]) socDrift.push(`#${i} ${k}: "${e[k]}" vs "${p[k]}"`);
  });
});
assert(socDrift.length === 0,
  "society names, coordinates, emails, handles and logos are identical in both languages",
  "societies data has drifted between languages", socDrift);

const missingLogos = socEn.filter((s) => !exists("assets/polsocs/" + s.logo));
assert(missingLogos.length === 0,
  `all ${socEn.length} society logos exist in assets/polsocs/`,
  "missing society logos", missingLogos.map((s) => s.logo));

/* =================================================================== 8. SEO metadata */

section("8. SEO metadata");

const metaIssues = [];
for (const [rel, file] of ALL) {
  if (NOINDEX.has(file)) continue;
  const h = head(read(rel));
  const need = [
    ["<title>", /<title>[^<]+<\/title>/],
    ["meta description", /<meta name="description" content="[^"]+">/],
    ["og:title", /<meta property="og:title" content="[^"]+">/],
    ["og:description", /<meta property="og:description" content="[^"]+">/],
    ["og:url", /<meta property="og:url" content="[^"]+">/],
    ["og:image", /<meta property="og:image" content="[^"]+">/],
    ["og:locale", /<meta property="og:locale" content="[^"]+">/],
    ["twitter:card", /<meta name="twitter:card" content="[^"]+">/],
    ["twitter:title", /<meta name="twitter:title" content="[^"]+">/],
    ["twitter:description", /<meta name="twitter:description" content="[^"]+">/],
    ["twitter:image", /<meta name="twitter:image" content="[^"]+">/],
  ];
  need.forEach(([label, re]) => {
    if (!re.test(h)) metaIssues.push(`${rel}: missing ${label}`);
  });
  const titles = (h.match(/<title>/g) || []).length;
  const descs = (h.match(/<meta name="description"/g) || []).length;
  if (titles !== 1) metaIssues.push(`${rel}: ${titles} <title> tags`);
  if (descs !== 1) metaIssues.push(`${rel}: ${descs} meta descriptions`);
}
assert(metaIssues.length === 0,
  `title, description, Open Graph and Twitter metadata present on all ${INDEXABLE.length * 2} indexable pages`,
  "metadata problems", metaIssues);

// og:image must be an absolute URL and point at a file we actually ship.
const ogIssues = [];
for (const [rel, file] of ALL) {
  if (NOINDEX.has(file)) continue;
  const m = head(read(rel)).match(/<meta property="og:image" content="([^"]+)">/);
  if (!m) continue;
  if (!m[1].startsWith(SITE + "/")) ogIssues.push(`${rel}: og:image is not absolute (${m[1]})`);
  else if (!exists(m[1].replace(SITE + "/", ""))) ogIssues.push(`${rel}: og:image file missing (${m[1]})`);
}
assert(ogIssues.length === 0, "every og:image is absolute and exists on disk",
  "og:image problems", ogIssues);

// Titles and descriptions should be unique across the whole site.
const seen = { title: new Map(), desc: new Map() };
const dupMeta = [];
for (const [rel, file] of ALL) {
  if (NOINDEX.has(file)) continue;
  const h = head(read(rel));
  const t = (h.match(/<title>([^<]+)<\/title>/) || [])[1];
  const d = (h.match(/<meta name="description" content="([^"]+)">/) || [])[1];
  if (t) { if (seen.title.has(t)) dupMeta.push(`duplicate title: ${rel} = ${seen.title.get(t)}`); else seen.title.set(t, rel); }
  if (d) { if (seen.desc.has(d)) dupMeta.push(`duplicate description: ${rel} = ${seen.desc.get(d)}`); else seen.desc.set(d, rel); }
}
assert(dupMeta.length === 0, "all titles and meta descriptions are unique", "duplicate metadata", dupMeta);

/* =================================================================== 9. structured data */

section("9. Structured data");

const EVENT_PAGES = EN_PAGES.filter((f) => f.startsWith("event-"));
const ldIssues = [];

for (const [rel, file, lang] of ALL) {
  if (NOINDEX.has(file)) continue;
  const blocks = [...read(rel).matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);

  const wantsLd = file === "index.html" || EVENT_PAGES.includes(file);
  if (wantsLd && blocks.length === 0) {
    ldIssues.push(`${rel}: expected JSON-LD, found none`);
    continue;
  }
  blocks.forEach((b, i) => {
    let obj;
    try {
      obj = JSON.parse(b);
    } catch (e) {
      ldIssues.push(`${rel}: JSON-LD block ${i + 1} is not valid JSON — ${e.message}`);
      return;
    }
    if (obj["@context"] !== "https://schema.org") {
      ldIssues.push(`${rel}: JSON-LD @context is not schema.org`);
    }
    if (file === "index.html" && obj["@type"] !== "Organization") {
      ldIssues.push(`${rel}: homepage JSON-LD should be Organization, found ${obj["@type"]}`);
    }
    if (EVENT_PAGES.includes(file) && obj["@type"] !== "Event") {
      ldIssues.push(`${rel}: event JSON-LD should be Event, found ${obj["@type"]}`);
    }
    // Polish structured data must point at the Polish URL.
    if (lang === "pl" && obj.url && !obj.url.includes("/pl/")) {
      ldIssues.push(`${rel}: JSON-LD url does not point at /pl/ (${obj.url})`);
    }
  });
}

assert(ldIssues.length === 0,
  `Organization JSON-LD on both homepages and Event JSON-LD on all ${EVENT_PAGES.length * 2} event pages, all valid JSON`,
  "structured data problems", ldIssues);

/* =================================================================== 10. load-bearing markup */

section("10. Load-bearing behaviours (regression guards)");

// These guard specific fixes documented in ADMIN_SYSTEM_AUDIT.md §6.7 / §7.8.
const guards = [
  [".ticker-clip wrapper present on both homepages (prevents mobile overflow)",
    ["index.html", "pl/index.html"],
    (s) => /<div class="ticker-clip">[\s\S]*?<div class="ticker"/.test(s)],
  ["no SVG favicon declared (Google ignores SVG for search favicons)",
    ALL.map(([r]) => r),
    (s) => !/rel="icon"[^>]*type="image\/svg\+xml"/.test(s)],
  ["favicon.ico + 16/32/48 PNG icons declared",
    ALL.map(([r]) => r),
    (s) => /href="\/favicon\.ico"/.test(s) &&
           ["16", "32", "48"].every((n) => s.includes(`/assets/icons/favicon-${n}x${n}.png`))],
  ["data-plain preserved on the Est. 2013 counter",
    ["index.html", "pl/index.html"],
    (s) => /data-count="2013" data-plain/.test(s)],
  ["partner logo set duplicated for the seamless marquee",
    ["index.html", "pl/index.html"],
    (s) => (s.match(/pbf-logo-tile/g) || []).length % 2 === 0],
  ["team placeholder kept for the member with no photo",
    ["team.html", "pl/team.html"],
    (s) => /<div class="ph" data-label="[^"]*"><\/div>/.test(s)],
  ["language switcher marks the active language with aria-current",
    ALL.map(([r]) => r),
    (s) => /<nav class="lang-switch"[\s\S]*?aria-current="true"[\s\S]*?<\/nav>/.test(s)],
];

for (const [label, files, test] of guards) {
  const bad = files.filter((f) => !test(read(f)));
  assert(bad.length === 0, label, label.replace(/^/, "FAILED: "), bad);
}

// CSS rules that fixed real mobile overflow bugs.
const css = read("css/style.css");
const cssGuards = [
  [".ticker-clip clips horizontally", /\.ticker-clip\s*\{[^}]*overflow-x:\s*clip/],
  [".contact-grid uses minmax(0, 1fr)", /\.contact-grid\s*\{[^}]*minmax\(0,\s*1fr\)/],
  [".social-list uses minmax(0, 1fr)", /\.social-list\s*\{[^}]*minmax\(0,\s*1fr\)/],
  [".stats-grid uses minmax(0, 1fr)", /\.stats-grid\s*\{[^}]*minmax\(0,\s*1fr\)/],
  ["Instagram embed capped with min(300px, 100%)", /min\(300px,\s*100%\)/],
  ["team grid is two-up on phones", /@media \(max-width: 600px\)\s*\{[\s\S]*?\.team-grid\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/],
];
for (const [label, re] of cssGuards) {
  assert(re.test(css), "css/style.css: " + label, "css/style.css: MISSING — " + label);
}

/* =================================================================== 11. deployment config */

section("11. Deployment configuration");

assert(exists("netlify.toml"), "netlify.toml exists", "netlify.toml is missing");
if (exists("netlify.toml")) {
  // Strip comments before testing: the file explains *why* `force = true` is
  // wrong, and a naive scan would match that prose instead of a real directive.
  // No value in this file contains a '#', so cutting at the first unquoted one
  // per line is safe.
  const toml = read("netlify.toml")
    .split("\n")
    .map((line) => {
      let inStr = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') inStr = !inStr;
        else if (line[i] === "#" && !inStr) return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
  assert(/from\s*=\s*"\/pl\/\*"/.test(toml) && /to\s*=\s*"\/pl\/404\.html"/.test(toml) &&
    /status\s*=\s*404/.test(toml),
    "netlify.toml maps /pl/* misses to /pl/404.html with status 404",
    "netlify.toml is missing the Polish 404 rule");
  assert(!/force\s*=\s*true/.test(toml),
    "the Polish 404 rule is not forced (real /pl/ pages still resolve)",
    "netlify.toml uses force = true, which would intercept valid Polish pages");
  assert(!/^\s*command\s*=/m.test(toml),
    "no build command declared (site stays a plain static deploy)",
    "netlify.toml declares a build command — the site has no build step");
}

assert(exists("robots.txt") && !/Disallow/.test(read("robots.txt")),
  "robots.txt allows crawling and blocks nothing",
  "robots.txt is missing or contains Disallow rules");
assert(read("robots.txt").includes(`${SITE}/sitemap.xml`),
  "robots.txt points at the sitemap", "robots.txt does not declare the sitemap");

/* =================================================================== 12. build architecture */

section("12. Build architecture (Phase 2)");

// --- source / output separation --------------------------------------------

const gitignore = exists(".gitignore") ? read(".gitignore") : "";
const ignored = (entry) =>
  gitignore.split("\n").map((l) => l.trim()).includes(entry);

assert(ignored("dist/"), "dist/ is listed in .gitignore (generated output is never committed)",
  "dist/ must be listed in .gitignore");
assert(ignored("node_modules/"), "node_modules/ is listed in .gitignore",
  "node_modules/ must be listed in .gitignore");

assert(exists("eleventy.config.js"), "eleventy.config.js exists", "eleventy.config.js is missing");
if (exists("eleventy.config.js")) {
  const cfg = read("eleventy.config.js");
  // Containment is the whole safety story: with input scoped to src/, the build
  // physically cannot read or rewrite the public HTML at the repository root.
  assert(/input:\s*"src"/.test(cfg) && /output:\s*"dist"/.test(cfg),
    "Eleventy input is src/ and output is dist/ — the build cannot touch the repository root",
    "Eleventy input/output directories are not scoped to src/ and dist/");
}

const SRC_DIRS = [
  "src", "src/_data", "src/_includes", "src/_includes/layouts",
  "src/_includes/partials", "src/build-test",
  "content", "content/events", "content/announcements",
  "content/team", "content/societies", "content/settings",
];
const missingDirs = SRC_DIRS.filter((d) => !exists(d));
assert(missingDirs.length === 0,
  `source tree present (${SRC_DIRS.length} directories)`,
  "source directories are missing", missingDirs);

// Phase 2 must not migrate content. Each collection should still be empty.
const populated = ["events", "announcements", "team", "societies", "settings"]
  .filter((c) => fs.readdirSync(path.join(ROOT, "content", c))
    .some((f) => /\.(ya?ml|json|md)$/i.test(f)));
assert(populated.length === 0,
  "content collections are still empty (no content migrated in this phase)",
  "content has been migrated — that belongs to a later phase", populated);

// --- generated output must not leak into the public site --------------------

assert(!locs.some((l) => /build-test/.test(l)),
  "build-test pages are not listed in sitemap.xml",
  "a build-test page appears in sitemap.xml", locs.filter((l) => /build-test/.test(l)));

const testLinks = [];
for (const [rel] of ALL) {
  if (/build-test/.test(stripNonMarkup(read(rel)))) testLinks.push(rel);
}
assert(testLinks.length === 0,
  "no public page links to or mentions build-test",
  "public pages referencing build-test", testLinks);

// --- generated output is not treated as source ------------------------------

let tracked = "";
try {
  tracked = require("child_process")
    .execSync("git ls-files dist", { cwd: ROOT, encoding: "utf8" }).trim();
} catch (e) {
  tracked = ""; // not a git checkout, or git unavailable — skip rather than fail
}
assert(tracked === "",
  "no file under dist/ is tracked by git (output is not source)",
  "generated files are tracked by git", tracked.split("\n").filter(Boolean));

// --- proof pages, only if a build has been run ------------------------------

const PROOF = ["dist/build-test/index.html", "dist/build-test/pl/index.html"];

if (!exists("dist")) {
  // Not a failure: validate must work on a clean checkout before any build.
  ok("dist/ absent — build-output checks skipped (run `npm run build` to enable them)");
} else {
  const missingProof = PROOF.filter((p) => !exists(p));
  assert(missingProof.length === 0,
    "both proof pages were generated",
    "proof pages missing after build", missingProof);

  if (missingProof.length === 0) {
    const en = read(PROOF[0]);
    const pl = read(PROOF[1]);

    assert(/<html lang="en">/.test(en), "English proof page declares lang=\"en\"",
      "English proof page has the wrong <html lang>");
    assert(/<html lang="pl">/.test(pl), "Polish proof page declares lang=\"pl\"",
      "Polish proof page has the wrong <html lang>");

    // Both pages sit at different depths (0 and 1). A root-relative asset URL
    // must therefore be the IDENTICAL string in both — that is the property
    // that stops the /pl/assets/… class of bug.
    const assetOf = (s) => (s.match(/<link rel="icon" href="([^"]+)"/) || [])[1];
    assert(assetOf(en) && assetOf(en) === assetOf(pl) && assetOf(en).startsWith("/"),
      `root-relative asset URL identical at both depths (${assetOf(en)})`,
      "asset URLs differ between the English and Polish proof pages",
      [`en: ${assetOf(en)}`, `pl: ${assetOf(pl)}`]);

    assert(/noindex/.test(en) && /noindex/.test(pl),
      "proof pages are noindex", "proof pages are missing a noindex robots tag");

    // A build must never emit anything that would shadow a public file.
    const distFiles = [];
    (function walk(d) {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const p = d + "/" + e.name;
        if (e.isDirectory()) walk(p);
        else distFiles.push(p.replace(/^dist\//, ""));
      }
    })("dist");

    // Generated HTML must live only under build-test/. Phase 3 additionally
    // passes through a small set of shared assets so the chrome pages can load
    // the real stylesheet and script when dist/ is served standalone — those
    // are copies, checked below, not new pages.
    const generatedHtml = distFiles.filter((f) => f.endsWith(".html"));
    const strayHtml = generatedHtml.filter((f) => !f.startsWith("build-test/"));
    assert(strayHtml.length === 0,
      `all ${generatedHtml.length} generated HTML files are under build-test/ — no public URL is generated`,
      "generated HTML outside build-test/", strayHtml);

    const htmlCollides = generatedHtml.filter((f) => exists(f));
    assert(htmlCollides.length === 0,
      "no generated HTML file collides with an existing public page",
      "generated HTML would overwrite a public page if dist/ were published", htmlCollides);

    // Passthrough assets must be byte-identical copies. If one ever differs,
    // the build has modified a shared asset rather than copying it.
    const crypto = require("crypto");
    const hash = (p) => crypto.createHash("sha256")
      .update(fs.readFileSync(path.join(ROOT, p))).digest("hex");
    const copied = distFiles.filter((f) => !f.endsWith(".html"));
    const altered = copied.filter((f) => !exists(f) || hash("dist/" + f) !== hash(f));
    assert(altered.length === 0,
      `all ${copied.length} passthrough assets are byte-identical copies of the originals`,
      "passthrough assets differ from their source files", altered);
  }
}

/* =================================================================== 13. shared chrome */

section("13. Shared chrome (Phase 3)");

const CHROME = {
  en: "dist/build-test/chrome/index.html",
  pl: "dist/build-test/chrome/pl/index.html",
};

if (!exists("dist")) {
  ok("dist/ absent — chrome checks skipped (run `npm run build` to enable them)");
} else {
  const missingChrome = Object.values(CHROME).filter((p) => !exists(p));
  assert(missingChrome.length === 0,
    "both English and Polish chrome pages were generated",
    "chrome pages missing after build", missingChrome);

  if (missingChrome.length === 0) {
    const en = read(CHROME.en);
    const pl = read(CHROME.pl);
    const TEST = { en: "/build-test/chrome/", pl: "/build-test/chrome/pl/" };

    assert(/<html lang="en">/.test(en), 'English chrome page uses lang="en"',
      "English chrome page has the wrong <html lang>");
    assert(/<html lang="pl">/.test(pl), 'Polish chrome page uses lang="pl"',
      "Polish chrome page has the wrong <html lang>");

    // Self-referencing canonicals on the TEST urls (never a public URL).
    for (const [code, html] of [["en", en], ["pl", pl]]) {
      const c = (html.match(/<link rel="canonical" href="([^"]+)">/) || [])[1];
      assert(c === SITE + TEST[code],
        `${code} chrome canonical is self-referencing (${TEST[code]})`,
        `${code} chrome canonical is wrong`, [`got ${c}`, `want ${SITE + TEST[code]}`]);
    }

    // Reciprocal hreflang, identical on both pages, x-default = English.
    const wantAlt = [
      `<link rel="alternate" hreflang="en" href="${SITE}${TEST.en}">`,
      `<link rel="alternate" hreflang="pl" href="${SITE}${TEST.pl}">`,
      `<link rel="alternate" hreflang="x-default" href="${SITE}${TEST.en}">`,
    ];
    const altMissing = [];
    for (const [code, html] of [["en", en], ["pl", pl]]) {
      wantAlt.forEach((tag) => { if (!html.includes(tag)) altMissing.push(`${code}: ${tag}`); });
    }
    assert(altMissing.length === 0,
      "chrome hreflang is reciprocal on both pages, x-default points at English",
      "chrome hreflang problems", altMissing);

    assert(/<meta property="og:locale" content="en_GB">/.test(en) &&
           /<meta property="og:locale:alternate" content="pl_PL">/.test(en),
      'English chrome page uses og:locale="en_GB" with pl_PL alternate',
      "English chrome og:locale is wrong");
    assert(/<meta property="og:locale" content="pl_PL">/.test(pl) &&
           /<meta property="og:locale:alternate" content="en_GB">/.test(pl),
      'Polish chrome page uses og:locale="pl_PL" with en_GB alternate',
      "Polish chrome og:locale is wrong");

    // aria-current must sit on the CURRENT language, not the other one.
    const activeLang = (html) => {
      const m = html.match(/<a href="[^"]*"\s+hreflang="([a-z]{2})"\s+lang="[a-z]{2}"\s+aria-current="true">/);
      return m ? m[1] : null;
    };
    assert(activeLang(en) === "en", 'English chrome page marks EN with aria-current="true"',
      "English chrome page marks the wrong active language", [`got ${activeLang(en)}`]);
    assert(activeLang(pl) === "pl", 'Polish chrome page marks PL with aria-current="true"',
      "Polish chrome page marks the wrong active language", [`got ${activeLang(pl)}`]);

    // Navigation labels must come out in the right language.
    const EN_LABELS = ["Home", "Team", "Events", "News", "Members", "Contact"];
    const PL_LABELS = ["Start", "Zespół", "Wydarzenia", "Aktualności", "Członkowie", "Kontakt"];
    const navOf = (html) => {
      const ul = html.slice(html.indexOf('<ul class="nav-links">'), html.indexOf("</ul>"));
      return [...ul.matchAll(/>([^<>]+)<\/a>/g)].map((m) => m[1].trim());
    };
    const enNav = navOf(en), plNav = navOf(pl);
    assert(EN_LABELS.every((l) => enNav.includes(l)),
      `English chrome navigation labels are correct (${EN_LABELS.join(", ")})`,
      "English chrome navigation labels are wrong", enNav);
    assert(PL_LABELS.every((l) => plNav.includes(l)),
      `Polish chrome navigation labels are correct (${PL_LABELS.join(", ")})`,
      "Polish chrome navigation labels are wrong", plNav);

    // Required chrome structures, shared CSS/JS, and no SVG favicon.
    const STRUCT = [
      ["header", /<header class="site-header">/],
      ["nav-inner", /<div class="nav-inner">/],
      ["brand + 5 wordmark rows", /<span class="brand-text" aria-hidden="true">(?:<span>[^<]*<\/span>){5}<\/span>/],
      ["burger with aria-expanded", /<button class="nav-toggle"[^>]*aria-expanded="false">/],
      ["nav list", /<ul class="nav-links">/],
      ["language switcher", /<nav class="lang-switch" aria-label="[^"]+">/],
      ["footer", /<footer class="site-footer">/],
      ["footer grid", /<div class="footer-grid">/],
      ["shared stylesheet", /<link rel="stylesheet" href="\/css\/style\.css">/],
      ["shared script", /<script src="\/js\/main\.js"><\/script>/],
      ["favicon.ico", /<link rel="icon" href="\/favicon\.ico" sizes="any">/],
      ["manifest", /<link rel="manifest" href="\/site\.webmanifest">/],
    ];
    const structMissing = [];
    for (const [code, html] of [["en", en], ["pl", pl]]) {
      STRUCT.forEach(([n, re]) => { if (!re.test(html)) structMissing.push(`${code}: ${n}`); });
    }
    assert(structMissing.length === 0,
      `required header/nav/footer/asset structures present on both chrome pages (${STRUCT.length} each)`,
      "chrome structure problems", structMissing);

    const svgFavicon = [["en", en], ["pl", pl]]
      .filter(([, h]) => /rel="icon"[^>]*image\/svg\+xml/.test(h)).map(([c]) => c);
    assert(svgFavicon.length === 0,
      "chrome pages declare no SVG favicon",
      "an SVG favicon was reintroduced", svgFavicon);

    assert(!locs.some((l) => /chrome/.test(l)),
      "chrome test pages are absent from sitemap.xml",
      "a chrome test page appears in sitemap.xml");

    // --- semantic comparison against the live pages -------------------------
    const cmp = require("./compare-chrome.js").run();
    const cmpBad = cmp.filter((r) => !r.ok);
    assert(cmpBad.length === 0,
      `generated chrome matches the live pages (${cmp.length} normalised comparisons vs events.html / pl/events.html)`,
      "generated chrome differs from the live pages",
      cmpBad.map((r) => r.label + (r.detail ? " — " + [].concat(r.detail).join(" | ") : "")));
  }
}

/* -- chrome test pages must not be referenced from the public site ---------- */

const chromeRefs = [];
for (const [rel] of ALL) {
  if (/build-test\/chrome/.test(stripNonMarkup(read(rel)))) chromeRefs.push(rel);
}
assert(chromeRefs.length === 0,
  "no public page links to the chrome test pages",
  "public pages referencing the chrome test pages", chromeRefs);

/* =================================================================== summary */

console.log("\n" + "=".repeat(64));
if (problems.length === 0) {
  console.log(`PASS — ${checks} checks, 0 problems`);
  process.exit(0);
} else {
  console.log(`FAIL — ${checks} checks, ${problems.length} problem(s):`);
  problems.forEach((p) => console.log(`  [${p.section}] ${p.msg}`));
  process.exit(1);
}
