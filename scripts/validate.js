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

// Content is migrated one collection at a time, each in its own reviewed phase.
// A collection not on this list must still be empty, so an unplanned migration
// cannot slip in unnoticed alongside a planned one.
//   Phase 4: team, settings
//   Phase 6: announcements
const MIGRATED_COLLECTIONS = new Set(["team", "settings", "announcements"]);
const populated = ["events", "announcements", "team", "societies", "settings"]
  .filter((c) => !MIGRATED_COLLECTIONS.has(c))
  .filter((c) => fs.readdirSync(path.join(ROOT, "content", c))
    .some((f) => /\.(ya?ml|json|md)$/i.test(f)));
assert(populated.length === 0,
  `only the migrated collections hold content (${[...MIGRATED_COLLECTIONS].join(", ")}); the rest are still empty`,
  "a collection was migrated outside its phase", populated);

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

    // Generated HTML is either an architectural test page under build-test/,
    // or a MIGRATED public page on the explicit allowlist below.
    //
    // Phase 2 asserted "everything is under build-test/". Phase 4 migrates the
    // first real public page, so that wording no longer expresses the intent.
    // The intent was never "generate nothing public" — it was "never generate
    // something public by accident". The allowlist keeps that guarantee exact
    // and makes each migration a deliberate, reviewable edit to this line.
    const MIGRATED = ["team.html", "pl/team.html", "announcements.html", "pl/announcements.html"];

    const generatedHtml = distFiles.filter((f) => f.endsWith(".html"));
    const strayHtml = generatedHtml.filter(
      (f) => !f.startsWith("build-test/") && !MIGRATED.includes(f)
    );
    assert(strayHtml.length === 0,
      `all ${generatedHtml.length} generated HTML files are either under build-test/ or on the migrated allowlist (${MIGRATED.join(", ")})`,
      "generated HTML that is neither a test page nor an allowlisted migration", strayHtml);

    // A migrated page is EXPECTED to share a path with its live counterpart —
    // that is what makes it a replacement. Any other collision is an accident.
    const htmlCollides = generatedHtml.filter((f) => exists(f) && !MIGRATED.includes(f));
    assert(htmlCollides.length === 0,
      "no unplanned generated HTML file collides with an existing public page",
      "generated HTML would overwrite a public page if dist/ were published", htmlCollides);

    // The collision above is only safe while Netlify still publishes the
    // repository root. This is the check that keeps it safe.
    if (exists("netlify.toml")) {
      assert(/publish\s*=\s*"\.?"/.test(read("netlify.toml")),
        "Netlify still publishes the repository root, so generated pages are not served",
        "netlify.toml no longer publishes '.' — migrated pages under dist/ would go live unreviewed");
    }

    // Passthrough assets must be byte-identical copies. If one ever differs,
    // the build has modified a shared asset rather than copying it.
    //
    // Most originals sit at the repository root at the same relative path.
    // src/js/team-filter.js is new architecture-owned source with no root
    // counterpart, so its origin is stated explicitly rather than guessed.
    const PASSTHROUGH_SOURCE = {
      "js/team-filter.js": "src/js/team-filter.js",
      "js/announcements-page.js": "src/js/announcements-page.js",
    };
    // Build PRODUCTS, not copies: these are rendered from templates and have no
    // byte-identical source, so they are excluded from the copy check and
    // covered instead by §18 and scripts/compare-announcements.js.
    const GENERATED_ASSETS = new Set([
      "js/announcements-data-en.js",
      "js/announcements-data-pl.js",
    ]);
    const crypto = require("crypto");
    const hash = (p) => crypto.createHash("sha256")
      .update(fs.readFileSync(path.join(ROOT, p))).digest("hex");
    const copied = distFiles.filter((f) => !f.endsWith(".html") && !GENERATED_ASSETS.has(f));
    const altered = copied.filter((f) => {
      const source = PASSTHROUGH_SOURCE[f] || f;
      return !exists(source) || hash("dist/" + f) !== hash(source);
    });
    assert(altered.length === 0,
      `all ${copied.length} passthrough assets are byte-identical copies of their sources`,
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

/* =================================================================== 14. team content */

section("14. Team content records (Phase 4)");

const yaml = require("js-yaml");

const TEAM_DIR = "content/team";
const CURRENT_YEAR = "2025/26";
const EXPECTED_GROUPS = {
  trustees: 5,
  partnerships: 4,
  events: 4,
  marketing: 3,
  legal: 1,
  regional: 4,
};
const EXPECTED_TOTAL = Object.values(EXPECTED_GROUPS).reduce((a, b) => a + b, 0);

const loadYaml = (rel) => yaml.load(read(rel)) || {};

/* -- central settings ------------------------------------------------------- */

assert(exists("content/settings/academic-year.yaml"),
  "content/settings/academic-year.yaml exists (single source of truth for the year)",
  "the central academic-year setting is missing");
assert(exists("content/settings/team-groups.yaml"),
  "content/settings/team-groups.yaml exists (single source of truth for groups)",
  "the central group definition is missing");

// The Phase 2 placeholder in site.json contradicted the roster. It must not
// come back: two sources for one fact is the bug this architecture prevents.
assert(!("currentAcademicYear" in JSON.parse(read("src/_data/site.json"))),
  "src/_data/site.json declares no competing academic year",
  "site.json has reintroduced currentAcademicYear — the year belongs in content/settings/");

const groupsCfg = exists("content/settings/team-groups.yaml")
  ? loadYaml("content/settings/team-groups.yaml") : {};
const yearCfg = exists("content/settings/academic-year.yaml")
  ? loadYaml("content/settings/academic-year.yaml") : {};

assert(yearCfg.current === CURRENT_YEAR,
  `the configured current academic year is ${CURRENT_YEAR}`,
  `the configured academic year is ${JSON.stringify(yearCfg.current)}, expected ${CURRENT_YEAR}`);

const cfgKeys = (groupsCfg.groups || []).map((g) => g.key);
assert(JSON.stringify(cfgKeys) === JSON.stringify(Object.keys(EXPECTED_GROUPS)),
  `group definition lists the six groups in the live page's order (${cfgKeys.join(" > ")})`,
  "group definition keys or order do not match the live pages",
  [`config: ${cfgKeys.join(", ")}`, `expected: ${Object.keys(EXPECTED_GROUPS).join(", ")}`]);

const groupLabelGaps = (groupsCfg.groups || []).filter(
  (g) => !(g.en && g.en.heading && g.en.filter_label && g.pl && g.pl.heading && g.pl.filter_label)
).map((g) => g.key);
assert(groupLabelGaps.length === 0,
  "every group defines an English and Polish heading and filter label",
  "groups missing a heading or filter label", groupLabelGaps);

const groupOrders = (groupsCfg.groups || []).map((g) => g.order);
assert(groupOrders.every((o) => Number.isInteger(o)) &&
  new Set(groupOrders).size === groupOrders.length,
  "group display orders are unique integers",
  "group display orders are missing, non-integer or duplicated", groupOrders);

/* -- member records --------------------------------------------------------- */

const teamFiles = fs.existsSync(path.join(ROOT, TEAM_DIR))
  ? fs.readdirSync(path.join(ROOT, TEAM_DIR)).filter((f) => /\.ya?ml$/i.test(f)).sort()
  : [];

const team = teamFiles.map((f) => ({ _file: `${TEAM_DIR}/${f}`, ...loadYaml(`${TEAM_DIR}/${f}`) }));
const current = team.filter((m) => m.published === true && m.academic_year === CURRENT_YEAR);

assert(current.length === EXPECTED_TOTAL,
  `exactly ${EXPECTED_TOTAL} published records for ${CURRENT_YEAR}`,
  `expected ${EXPECTED_TOTAL} published ${CURRENT_YEAR} records, found ${current.length}`);

// One record per person, one file per record — no EN-only / PL-only splits.
const enOnly = teamFiles.filter((f) => /[-.](en|pl)\.ya?ml$/i.test(f) || /^(en|pl)[-.]/i.test(f));
assert(enOnly.length === 0,
  "no language-split member files exist (one canonical record per person)",
  "language-split member files found", enOnly);

const slugs = team.map((m) => m.slug);
const dupSlugs = slugs.filter((s, i) => slugs.indexOf(s) !== i);
assert(dupSlugs.length === 0, "every member slug is unique", "duplicate member slugs", [...new Set(dupSlugs)]);

const slugMismatch = team.filter((m) => m._file !== `${TEAM_DIR}/${m.slug}.yaml`).map((m) => m._file);
assert(slugMismatch.length === 0,
  "every record's slug matches its filename",
  "records whose slug does not match the filename", slugMismatch);

const badGroup = current.filter((m) => !cfgKeys.includes(m.group)).map((m) => `${m.slug} -> ${m.group}`);
assert(badGroup.length === 0,
  "every member references a group defined centrally",
  "members referencing an undefined group", badGroup);

const wrongCounts = Object.entries(EXPECTED_GROUPS)
  .map(([k, n]) => [k, n, current.filter((m) => m.group === k).length])
  .filter(([, want, got]) => want !== got)
  .map(([k, want, got]) => `${k}: expected ${want}, found ${got}`);
assert(wrongCounts.length === 0,
  `all six groups hold the expected member counts (${Object.entries(EXPECTED_GROUPS).map(([k, n]) => `${k} ${n}`).join(", ")})`,
  "group member counts do not match the live pages", wrongCounts);

const dupOrder = [];
for (const key of cfgKeys) {
  const orders = current.filter((m) => m.group === key).map((m) => m.order);
  if (new Set(orders).size !== orders.length) dupOrder.push(`${key}: ${orders.join(",")}`);
}
assert(dupOrder.length === 0,
  "every member has a unique display position within their group",
  "duplicate display positions inside a group", dupOrder);

const SHARED_REQUIRED = ["slug", "academic_year", "group", "order", "name", "email", "linkedin"];
const missingShared = [];
for (const m of current) {
  for (const f of SHARED_REQUIRED) {
    if (m[f] === undefined || m[f] === null || String(m[f]).trim() === "") {
      missingShared.push(`${m.slug}: ${f}`);
    }
  }
  if (!("photo" in m)) missingShared.push(`${m.slug}: photo (may be null, but must be present)`);
  if (!("published" in m)) missingShared.push(`${m.slug}: published`);
}
assert(missingShared.length === 0,
  `all ${SHARED_REQUIRED.length + 2} shared invariant fields are present on every member`,
  "members missing a required shared field", missingShared);

const badOrder = current.filter((m) => !Number.isInteger(m.order)).map((m) => `${m.slug}: ${m.order}`);
assert(badOrder.length === 0, "every `order` value is a whole number",
  "non-numeric display positions", badOrder);

const badPublished = team.filter((m) => typeof m.published !== "boolean").map((m) => `${m.slug}: ${m.published}`);
assert(badPublished.length === 0, "every `published` value is a real boolean",
  "non-boolean publication flags", badPublished);

const badYear = team.filter((m) => !/^\d{4}\/\d{2}$/.test(String(m.academic_year)))
  .map((m) => `${m.slug}: ${m.academic_year}`);
assert(badYear.length === 0, "every `academic_year` matches the YYYY/YY format",
  "malformed academic years", badYear);

const missingRole = current.filter((m) => !(m.en && m.en.role) || !(m.pl && m.pl.role)).map((m) => m.slug);
assert(missingRole.length === 0,
  "every member has both an English and a Polish role",
  "members missing a localised role", missingRole);

// Polish roles are grammatically gendered free text and must be authored, not
// derived. An identical EN/PL pair almost certainly means one was copied.
const copiedRole = current.filter((m) => m.en.role === m.pl.role).map((m) => `${m.slug}: ${m.en.role}`);
assert(copiedRole.length === 0,
  "no Polish role is a copy of its English counterpart",
  "identical English and Polish roles — a translation is probably missing", copiedRole);

const withPhoto = current.filter((m) => m.photo);
const withoutPhoto = current.filter((m) => !m.photo);

const missingAlt = withPhoto.filter((m) => !(m.en && m.en.photo_alt) || !(m.pl && m.pl.photo_alt))
  .map((m) => m.slug);
assert(missingAlt.length === 0,
  `all ${withPhoto.length} members with a photograph have English and Polish alt text`,
  "members with a photograph but no localised alt text", missingAlt);

assert(withoutPhoto.every((m) => m.photo === null),
  `a null photograph is accepted (${withoutPhoto.length} member: ${withoutPhoto.map((m) => m.name).join(", ") || "none"})`,
  "a member without a photograph uses something other than an explicit null",
  withoutPhoto.map((m) => `${m.slug}: ${JSON.stringify(m.photo)}`));

const strayAlt = withoutPhoto.filter((m) => (m.en && m.en.photo_alt) || (m.pl && m.pl.photo_alt))
  .map((m) => m.slug);
assert(strayAlt.length === 0,
  "no photograph-less member carries alt text for an image that does not exist",
  "alt text on a member with no photograph", strayAlt);

const badPhotoPath = withPhoto.filter((m) => !String(m.photo).startsWith("/assets/team/"))
  .map((m) => `${m.slug}: ${m.photo}`);
assert(badPhotoPath.length === 0,
  "every photograph path is root-relative under /assets/team/",
  "photograph paths that are not root-relative", badPhotoPath);

const missingPhotoFile = withPhoto.filter((m) => !exists(String(m.photo).replace(/^\/+/, "")))
  .map((m) => `${m.slug}: ${m.photo}`);
assert(missingPhotoFile.length === 0,
  `all ${withPhoto.length} referenced photographs exist on disk`,
  "photograph paths that do not resolve to a real file", missingPhotoFile);

const badEmail = current.filter((m) => !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(m.email)))
  .map((m) => `${m.slug}: ${m.email}`);
assert(badEmail.length === 0, "every e-mail address is well formed",
  "malformed e-mail addresses", badEmail);

const badLinkedIn = current.filter((m) => !/^https:\/\/www\.linkedin\.com\/in\/\S+$/.test(String(m.linkedin)))
  .map((m) => `${m.slug}: ${m.linkedin}`);
assert(badLinkedIn.length === 0, "every LinkedIn value is an HTTPS linkedin.com/in/ URL",
  "malformed LinkedIn URLs", badLinkedIn);

// Content is data, not markup: the templates escape it, so a stored tag or
// entity would render as visible literal text.
const rawHtml = [];
for (const m of current) {
  const fields = [m.name, m.email, m.linkedin, m.photo, m.aria_name_email, m.aria_name_linkedin,
    m.en && m.en.role, m.pl && m.pl.role, m.en && m.en.photo_alt, m.pl && m.pl.photo_alt];
  for (const v of fields) {
    if (typeof v !== "string") continue;
    if (/<[a-z/!]/i.test(v) || /&[a-z]+;|&#\d+;/i.test(v)) rawHtml.push(`${m.slug}: ${v}`);
  }
}
assert(rawHtml.length === 0,
  "no member record contains raw HTML tags or entities",
  "member fields containing markup", rawHtml);

// Phase 5 derives every contact-link accessible name from `name` via the
// per-locale patterns in ui.json, so the old per-member aria fields are gone.
// They must not creep back: a stored name would silently override the pattern
// for one member and reintroduce the ambiguity Phase 5 removed.
const staleAria = current
  .filter((m) => "aria_name_email" in m || "aria_name_linkedin" in m)
  .map((m) => m.slug);
assert(staleAria.length === 0,
  "no member stores a redundant aria name (accessible names derive from `name`)",
  "records still carrying aria_name_email / aria_name_linkedin", staleAria);

/* =================================================================== 15. generated team pages */

section("15. Generated team pages (Phase 4)");

const TEAM_PAGES = { en: "dist/team.html", pl: "dist/pl/team.html" };

if (!exists("dist")) {
  ok("dist/ absent — generated team-page checks skipped (run `npm run build` to enable them)");
} else {
  const missingTeam = Object.values(TEAM_PAGES).filter((p) => !exists(p));
  assert(missingTeam.length === 0,
    "dist/team.html and dist/pl/team.html were both generated",
    "generated team pages missing after build", missingTeam);

  if (missingTeam.length === 0) {
    const gEn = read(TEAM_PAGES.en);
    const gPl = read(TEAM_PAGES.pl);

    assert(/<html lang="en">/.test(gEn), "generated English team page declares lang=\"en\"",
      "generated English team page has the wrong <html lang>");
    assert(/<html lang="pl">/.test(gPl), "generated Polish team page declares lang=\"pl\"",
      "generated Polish team page has the wrong <html lang>");

    const canon = (s) => (s.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    assert(canon(gEn) === `${SITE}/team.html` && canon(gPl) === `${SITE}/pl/team.html`,
      "generated canonicals are self-referencing and keep the .html URLs",
      "generated canonical URLs are wrong", [`en: ${canon(gEn)}`, `pl: ${canon(gPl)}`]);

    const alts = (s) => [...s.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)]
      .map((m) => `${m[1]}=${m[2]}`).sort();
    const wantAlts = [
      `en=${SITE}/team.html`, `pl=${SITE}/pl/team.html`, `x-default=${SITE}/team.html`,
    ].sort();
    assert(JSON.stringify(alts(gEn)) === JSON.stringify(wantAlts) &&
      JSON.stringify(alts(gPl)) === JSON.stringify(wantAlts),
      "both generated pages carry the identical, reciprocal hreflang trio",
      "generated hreflang alternates are not reciprocal",
      [`en: ${alts(gEn).join(" ")}`, `pl: ${alts(gPl).join(" ")}`]);

    // The language switcher must cross to the OTHER language's team page, not
    // to a home page and not to its own.
    const switchTargets = (s) => {
      const nav = s.match(/<nav class="lang-switch"[\s\S]*?<\/nav>/);
      return nav ? [...nav[0].matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1]) : [];
    };
    const enSwitch = switchTargets(gEn);
    const plSwitch = switchTargets(gPl);
    assert(enSwitch.some((h) => h === "/pl/team.html") && plSwitch.some((h) => h === "/team.html"),
      "language switchers point at the paired team page in the other language",
      "language-switcher destinations are wrong",
      [`en page offers: ${enSwitch.join(", ")}`, `pl page offers: ${plSwitch.join(", ")}`]);

    for (const [code, src] of [["en", gEn], ["pl", gPl]]) {
      const cards = (src.match(/<div class="member reveal/g) || []).length;
      assert(cards === EXPECTED_TOTAL,
        `generated ${code} page renders exactly ${EXPECTED_TOTAL} member cards`,
        `generated ${code} page renders ${cards} member cards, expected ${EXPECTED_TOTAL}`);

      // Attribute-order agnostic on purpose: pinning the exact attribute
      // sequence made this silently match nothing when Phase 5 added
      // aria-pressed, and a zero-length list compares equal to a zero-length
      // list. The `.length === 7` assertion below is the guard against that.
      const chips = [...src.matchAll(/<button\s+([^>]*?)>/g)]
        .filter((m) => /class="[^"]*\bchip\b/.test(m[1]))
        .map((m) => (m[1].match(/data-filter="([^"]+)"/) || [])[1]);
      assert(chips.length === 7,
        `generated ${code} page exposes all seven filter controls`,
        `generated ${code} page exposes ${chips.length} filter controls, expected 7`);
      assert(JSON.stringify(chips) === JSON.stringify(["all", ...cfgKeys]),
        `generated ${code} page has the "all" chip plus all six group filters, in order`,
        `generated ${code} page filter controls are wrong or out of order`, chips);

      const sections = [...src.matchAll(/<div class="team-section" data-group="([^"]+)">/g)].map((m) => m[1]);
      assert(JSON.stringify(sections) === JSON.stringify(cfgKeys),
        `generated ${code} page has all six sections in the live page's order`,
        `generated ${code} page section order is wrong`, sections);

      // Member order inside the page must equal the order the records declare.
      const rendered = [...src.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
      const expected = cfgKeys.flatMap((k) =>
        current.filter((m) => m.group === k).sort((a, b) => a.order - b.order).map((m) => m.name));
      assert(JSON.stringify(rendered) === JSON.stringify(expected),
        `generated ${code} page renders members in the order the records declare`,
        `generated ${code} page member order does not match the structured records`,
        rendered.filter((n, i) => n !== expected[i]));

      // Scoped to the member cards: the shared footer also carries a mailto:.
      const memberLinks = [...src.matchAll(/<div class="member-links">[\s\S]*?<\/div>/g)].join("");
      const emails = [...memberLinks.matchAll(/href="mailto:([^"]+)"/g)].map((m) => m[1]).sort();
      assert(JSON.stringify(emails) === JSON.stringify(current.map((m) => m.email).sort()),
        `generated ${code} page preserves all ${EXPECTED_TOTAL} e-mail addresses`,
        `generated ${code} page e-mail links do not match the records`);

      const lis = [...src.matchAll(/href="(https:\/\/www\.linkedin\.com\/in\/[^"]+)"/g)].map((m) => m[1]).sort();
      assert(JSON.stringify(lis) === JSON.stringify(current.map((m) => m.linkedin).sort()),
        `generated ${code} page preserves all ${EXPECTED_TOTAL} LinkedIn links`,
        `generated ${code} page LinkedIn links do not match the records`);

      // The null-photo card: placeholder present, no <img>, no empty src.
      const phEmpty = [...src.matchAll(/<div class="ph"([^>]*)>([\s\S]*?)<\/div>/g)]
        .filter((m) => !/<img/.test(m[2]));
      assert(phEmpty.length === withoutPhoto.length,
        `generated ${code} page renders ${withoutPhoto.length} .ph placeholder without an <img>`,
        `generated ${code} page has ${phEmpty.length} empty .ph blocks, expected ${withoutPhoto.length}`);
      assert(phEmpty.every((m) => /data-label="[^"]+"/.test(m[1])),
        `generated ${code} page's placeholder carries a data-label`,
        `generated ${code} page's placeholder is missing its data-label`);
      assert(!/<img[^>]*src=""/.test(src) && !/<img[^>]*src="\/assets\/team\/null/.test(src),
        `generated ${code} page contains no empty or invalid image src`,
        `generated ${code} page contains a broken <img src>`);

      assert(/<a[^>]*class="[^"]*\bactive\b[^"]*"[^>]*href="team\.html"/.test(src) ||
        /<a[^>]*href="team\.html"[^>]*class="[^"]*\bactive\b[^"]*"/.test(src),
        `generated ${code} page marks Team as the active navigation item`,
        `generated ${code} page has no active navigation state on Team`);
    }

    // Roles must not leak across languages. Every English role string is
    // checked for absence on the Polish page and vice versa.
    const enRoles = [...new Set(current.map((m) => m.en.role))];
    const plRoles = [...new Set(current.map((m) => m.pl.role))];
    const roleRegion = (s) => (s.match(/<div class="member-role">[\s\S]*/) || [""])[0];
    const enLeak = plRoles.filter((r) => roleRegion(gEn).includes(`<div class="member-role">${r}<`));
    const plLeak = enRoles.filter((r) => roleRegion(gPl).includes(`<div class="member-role">${r}<`));
    assert(enLeak.length === 0, "no Polish role appears on the generated English page",
      "Polish roles leaked onto the English page", enLeak);
    assert(plLeak.length === 0, "no English role appears on the generated Polish page",
      "English roles leaked onto the Polish page", plLeak);

    // The sitemap already lists the live /team.html and /pl/team.html. Phase 4
    // must not have touched it, and must not have added a dist/ URL.
    assert(!/\/dist\//.test(sitemapRaw),
      "sitemap.xml lists no dist/ URL for the generated pages",
      "sitemap.xml references the generated output");

    // --- semantic comparison against the live pages -------------------------
    // compare-team.js is a standalone script; run it as a child process so its
    // exit status, not a re-implementation of it, is what gets asserted.
    const { spawnSync } = require("child_process");
    const cmp = spawnSync(process.execPath, [path.join(__dirname, "compare-team.js")], {
      cwd: ROOT, encoding: "utf8",
    });
    const matched = (cmp.stdout.match(/PASS — (\d+)\/\1 comparisons matched/) || [])[1];
    assert(cmp.status === 0,
      `generated team pages match the live pages (${matched || "?"} semantic comparisons — scripts/compare-team.js)`,
      "scripts/compare-team.js reports differences from the live team pages",
      (cmp.stdout || "").split("\n").filter((l) => /FAIL/.test(l)).slice(0, 12));
  }
}

/* =================================================================== 16. team accessibility */

section("16. Team filter and contact-link accessibility (Phase 5)");

// Applies to the LIVE pages and, when a build exists, the generated ones —
// the whole point of this phase is that the two carry the same corrections.
const A11Y_PAGES = [
  { label: "live en", rel: "team.html", locale: "en" },
  { label: "live pl", rel: "pl/team.html", locale: "pl" },
];
if (exists("dist/team.html")) A11Y_PAGES.push({ label: "dist en", rel: "dist/team.html", locale: "en" });
if (exists("dist/pl/team.html")) A11Y_PAGES.push({ label: "dist pl", rel: "dist/pl/team.html", locale: "pl" });

// Stated here independently of ui.json: a check that reads its expectation from
// the same file it is checking would pass no matter what that file said.
const ARIA_PATTERNS = {
  en: { email: "Email {name}", linkedin: "{name} on LinkedIn" },
  pl: { email: "Wyślij e-mail do: {name}", linkedin: "Profil LinkedIn: {name}" },
};
const ENGLISH_LEAKS = [/^Email\s/, /\son LinkedIn$/];
const ALL_KEYS = ["all", "trustees", "partnerships", "events", "marketing", "legal", "regional"];

for (const page of A11Y_PAGES) {
  const src = read(page.rel);
  const tag = `${page.label} (${page.rel})`;

  // --- filter container ---------------------------------------------------
  const barMatch = src.match(/<div class="filter-bar([^"]*)"([^>]*)>([\s\S]*?)<\/div>/);
  assert(Boolean(barMatch), `${tag}: the filter container was found`,
    `${tag}: no .filter-bar container — the checks below cannot run`);

  if (barMatch) {
    const barAttrs = barMatch[2];
    const barBody = barMatch[3];

    assert(!/role="tablist"/.test(src),
      `${tag}: no role="tablist" (these controls filter a roster, not tab panels)`,
      `${tag}: role="tablist" is still present`);
    assert(!/role="tab"/.test(src),
      `${tag}: no role="tab" anywhere`,
      `${tag}: role="tab" was introduced — this must not become a tab widget`);
    assert(/role="group"/.test(barAttrs),
      `${tag}: the filter container is role="group"`,
      `${tag}: the filter container is not role="group"`);

    const barLabel = barAttrs.match(/aria-label="([^"]*)"/);
    assert(Boolean(barLabel && barLabel[1].trim()),
      `${tag}: the filter group has a non-empty aria-label ("${barLabel ? barLabel[1] : ""}")`,
      `${tag}: the filter group has no usable aria-label`);
    // Localised: the Polish label must not be the English one.
    if (barLabel) {
      const isEnglishLabel = barLabel[1] === "Filter team by group";
      assert(page.locale === "en" ? isEnglishLabel : !isEnglishLabel,
        `${tag}: the filter group's aria-label is in the page's own language`,
        `${tag}: the filter group's aria-label is not localised ("${barLabel[1]}")`);
    }

    // --- the chips --------------------------------------------------------
    const chips = [];
    for (const m of barBody.matchAll(/<(\w+)\s+([^>]*?)>([\s\S]*?)<\/\1>/g)) {
      const [, el, attrs, label] = m;
      if (!/class="[^"]*\bchip\b/.test(attrs)) continue;
      const at = (n) => { const v = attrs.match(new RegExp(n + '="([^"]*)"')); return v ? v[1] : null; };
      chips.push({ el, key: at("data-filter"), pressed: at("aria-pressed"),
        selected: at("aria-selected"), role: at("role"),
        active: /class="[^"]*\bactive\b/.test(attrs), label: label.trim() });
    }

    assert(chips.length === 7,
      `${tag}: all seven filter controls were parsed`,
      `${tag}: parsed ${chips.length} filter controls, expected 7 — a markup change may be hiding the checks below`);

    assert(chips.every((c) => c.el === "button"),
      `${tag}: every filter is a native <button> (Enter/Space work without a key handler)`,
      `${tag}: a filter control is not a native button`,
      chips.filter((c) => c.el !== "button").map((c) => `${c.key}: <${c.el}>`));

    assert(chips.every((c) => c.role === null),
      `${tag}: no filter overrides its native button role`,
      `${tag}: a filter carries an explicit role`,
      chips.filter((c) => c.role).map((c) => `${c.key}: role="${c.role}"`));

    assert(chips.every((c) => c.selected === null),
      `${tag}: no filter carries aria-selected`,
      `${tag}: aria-selected is present on a filter (it belongs to tabs, not toggles)`,
      chips.filter((c) => c.selected !== null).map((c) => c.key));

    const noPressed = chips.filter((c) => c.pressed === null).map((c) => c.key);
    assert(noPressed.length === 0,
      `${tag}: all ${chips.length} filters expose aria-pressed`,
      `${tag}: filters missing aria-pressed`, noPressed);

    const pressed = chips.filter((c) => c.pressed === "true").map((c) => c.key);
    assert(pressed.length === 1,
      `${tag}: exactly one filter starts pressed`,
      `${tag}: ${pressed.length} filters start pressed, expected exactly 1`, pressed);
    assert(pressed.length === 1 && pressed[0] === "all",
      `${tag}: the initially pressed filter is the "Everyone"/"Wszyscy" control`,
      `${tag}: the initially pressed filter is not the "all" control`, pressed);

    const badUnpressed = chips.filter((c) => c.key !== "all" && c.pressed !== "false").map((c) => c.key);
    assert(badUnpressed.length === 0,
      `${tag}: every other filter starts aria-pressed="false"`,
      `${tag}: filters that do not start explicitly unpressed`, badUnpressed);

    // The state a sighted user sees and the state announced must agree.
    const mismatched = chips.filter((c) => c.active !== (c.pressed === "true")).map((c) => c.key);
    assert(mismatched.length === 0,
      `${tag}: the pressed state matches the .active class on every filter`,
      `${tag}: pressed state and .active class disagree`, mismatched);

    assert(JSON.stringify(chips.map((c) => c.key)) === JSON.stringify(ALL_KEYS),
      `${tag}: filter order is unchanged`,
      `${tag}: filter order changed`, chips.map((c) => c.key));
  }

  // --- contact links ------------------------------------------------------
  const cards = [...src.matchAll(
    /<h3>([^<]+)<\/h3>\s*<div class="member-links">([\s\S]*?)<\/div>/g)];
  assert(cards.length === EXPECTED_TOTAL,
    `${tag}: all ${EXPECTED_TOTAL} member contact blocks were parsed`,
    `${tag}: parsed ${cards.length} member contact blocks, expected ${EXPECTED_TOTAL}`);

  const pat = ARIA_PATTERNS[page.locale];
  const wrongEmail = [];
  const wrongLinkedIn = [];
  const emptyName = [];
  const leaked = [];
  const rawAddress = [];
  const allNames = [];

  for (const [, name, links] of cards) {
    const person = name.trim();
    const em = links.match(/href="mailto:[^"]+"[^>]*aria-label="([^"]*)"/);
    const li = links.match(/href="https:\/\/www\.linkedin\.com[^"]+"[^>]*aria-label="([^"]*)"/);
    const emAria = em ? em[1] : "";
    const liAria = li ? li[1] : "";
    allNames.push(emAria, liAria);

    if (!emAria.trim() || !liAria.trim()) emptyName.push(person);
    if (emAria !== pat.email.replace("{name}", person)) wrongEmail.push(`${person}: "${emAria}"`);
    if (liAria !== pat.linkedin.replace("{name}", person)) wrongLinkedIn.push(`${person}: "${liAria}"`);
    if (/@/.test(emAria) || /@/.test(liAria)) rawAddress.push(person);
    if (page.locale === "pl" && ENGLISH_LEAKS.some((re) => re.test(emAria) || re.test(liAria))) {
      leaked.push(`${person}: "${emAria}" / "${liAria}"`);
    }
  }

  assert(emptyName.length === 0,
    `${tag}: every e-mail and LinkedIn link has a non-empty accessible name`,
    `${tag}: contact links with no accessible name`, emptyName);
  assert(wrongEmail.length === 0,
    `${tag}: all ${cards.length} e-mail links follow "${pat.email}"`,
    `${tag}: e-mail accessible names that do not follow the locale's pattern`, wrongEmail.slice(0, 5));
  assert(wrongLinkedIn.length === 0,
    `${tag}: all ${cards.length} LinkedIn links follow "${pat.linkedin}"`,
    `${tag}: LinkedIn accessible names that do not follow the locale's pattern`, wrongLinkedIn.slice(0, 5));
  assert(rawAddress.length === 0,
    `${tag}: no accessible name exposes a raw e-mail address`,
    `${tag}: accessible names containing an e-mail address`, rawAddress);
  assert(new Set(allNames).size === allNames.length,
    `${tag}: all ${allNames.length} contact-link accessible names are unique on the page`,
    `${tag}: two contact links share an accessible name`,
    allNames.filter((n, i) => allNames.indexOf(n) !== i));

  if (page.locale === "pl") {
    assert(leaked.length === 0,
      `${tag}: no English label pattern survives on the Polish page`,
      `${tag}: English accessible-label patterns still present`, leaked.slice(0, 5));
  }

  // --- the filter behaviour keeps both states in step ----------------------
  // Whether the code is inline (live) or a linked file (generated), it must set
  // aria-pressed. A page that only toggles the class would pass every static
  // check above and still strand assistive technology on the initial state.
  const behaviour = /dist\//.test(page.rel)
    ? read("dist/js/team-filter.js")
    : (src.match(/<script>[\s\S]*?<\/script>/g) || []).join("");
  assert(/aria-pressed/.test(behaviour),
    `${tag}: the filter code updates aria-pressed, not just the .active class`,
    `${tag}: the filter code never touches aria-pressed — the state would freeze on load`);
}

// Live and generated must agree on the corrected semantics, not merely each be
// internally consistent.
if (exists("dist/team.html") && exists("dist/pl/team.html")) {
  const semantics = (rel) => {
    const s = read(rel);
    const bar = s.match(/<div class="filter-bar[^"]*"([^>]*)>([\s\S]*?)<\/div>/);
    return JSON.stringify({
      role: bar ? (bar[1].match(/role="([^"]*)"/) || [])[1] : null,
      label: bar ? (bar[1].match(/aria-label="([^"]*)"/) || [])[1] : null,
      pressed: bar ? [...bar[2].matchAll(/data-filter="([^"]*)"[^>]*aria-pressed="([^"]*)"/g)]
        .map((m) => `${m[1]}=${m[2]}`) : [],
      aria: [...s.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]).filter((v) => /:|Email|LinkedIn/.test(v)),
    });
  };
  for (const [live, gen, lang] of [["team.html", "dist/team.html", "English"],
                                   ["pl/team.html", "dist/pl/team.html", "Polish"]]) {
    assert(semantics(live) === semantics(gen),
      `${lang}: live and generated pages carry identical corrected semantics`,
      `${lang}: live and generated pages disagree on the corrected semantics`,
      [`live: ${semantics(live)}`, `dist: ${semantics(gen)}`]);
  }
}

/* =================================================================== 17. announcement content */

section("17. Announcement content records (Phase 6)");

const ANN_DIR = "content/announcements";
const ANN_EXPECTED = 28;

// Feature counts, taken from the live source arrays. These are the numbers the
// migration must reproduce exactly; they are stated here rather than recomputed
// from the records, so a record that loses a flag fails instead of redefining
// the expectation.
const ANN_FEATURES = {
  noImage: 3, closed: 8, imagePosition: 5, containFit: 4,
  extraImages: 3, background: 1, linked: 11, external: 2,
};

const SUPPORTED_FIT = new Set(["contain"]);
const SUPPORTED_LINK_TYPES = new Set(["event", "page", "external"]);

const annFiles = fs.existsSync(path.join(ROOT, ANN_DIR))
  ? fs.readdirSync(path.join(ROOT, ANN_DIR)).filter((f) => /\.ya?ml$/i.test(f)).sort()
  : [];

const annAll = annFiles.map((f) => ({ _file: `${ANN_DIR}/${f}`, ...loadYaml(`${ANN_DIR}/${f}`) }));
const ann = annAll.filter((a) => a.published === true && a.academic_year === CURRENT_YEAR);

assert(ann.length === ANN_EXPECTED,
  `exactly ${ANN_EXPECTED} published announcement records for ${CURRENT_YEAR}`,
  `expected ${ANN_EXPECTED} published ${CURRENT_YEAR} announcements, found ${ann.length}`);

/* -- identity and ordering -------------------------------------------------- */

const annSlugs = annAll.map((a) => a.slug);
const annDupSlug = annSlugs.filter((s, i) => annSlugs.indexOf(s) !== i);
assert(annDupSlug.length === 0, "every announcement slug is unique",
  "duplicate announcement slugs", [...new Set(annDupSlug)]);

const annSlugFile = annAll.filter((a) => a._file !== `${ANN_DIR}/${a.slug}.yaml`).map((a) => a._file);
assert(annSlugFile.length === 0, "every announcement's slug matches its filename",
  "records whose slug does not match the filename", annSlugFile);

const annOrders = ann.map((a) => a.order);
assert(new Set(annOrders).size === annOrders.length,
  "every published announcement has a unique display order",
  "duplicate announcement display orders",
  annOrders.filter((o, i) => annOrders.indexOf(o) !== i));
assert(annOrders.every((o) => Number.isInteger(o)),
  "every announcement `order` is a whole number",
  "non-integer display orders", annOrders.filter((o) => !Number.isInteger(o)));

// No language-split files.
const annSplit = annFiles.filter((f) => /[-.](en|pl)\.ya?ml$/i.test(f) || /^(en|pl)[-.]/i.test(f));
assert(annSplit.length === 0,
  "no language-split announcement files (one canonical record each)",
  "language-split announcement files found", annSplit);

/* -- dates ------------------------------------------------------------------ */

const annBadYear = annAll.filter((a) => !/^\d{4}\/\d{2}$/.test(String(a.academic_year)))
  .map((a) => `${a.slug}: ${a.academic_year}`);
assert(annBadYear.length === 0, "every announcement `academic_year` matches YYYY/YY",
  "malformed announcement academic years", annBadYear);

// The date must be a STRING. Unquoted in YAML it parses to a JS Date, whose
// stringification is timezone-dependent and would make the build non-deterministic.
const annDateType = annAll.filter((a) => typeof a.published_date !== "string")
  .map((a) => `${a.slug}: ${Object.prototype.toString.call(a.published_date)}`);
assert(annDateType.length === 0,
  "every `published_date` is a quoted string, not a parsed YAML date",
  "unquoted dates — YAML turned these into timezone-sensitive Date objects", annDateType);

const annBadDate = annAll.filter((a) => {
  const s = String(a.published_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d;
}).map((a) => `${a.slug}: ${a.published_date}`);
assert(annBadDate.length === 0, "every `published_date` is a real ISO calendar date",
  "invalid ISO dates", annBadDate);

const annBadPublished = annAll.filter((a) => typeof a.published !== "boolean")
  .map((a) => `${a.slug}: ${a.published}`);
assert(annBadPublished.length === 0, "every announcement `published` is a real boolean",
  "non-boolean publication flags", annBadPublished);

const annBadClosed = annAll.filter((a) => typeof a.signups_closed !== "boolean")
  .map((a) => `${a.slug}: ${a.signups_closed}`);
assert(annBadClosed.length === 0, "every announcement `signups_closed` is a real boolean",
  "non-boolean closed flags", annBadClosed);

/* -- localised fields ------------------------------------------------------- */

const annMissingLoc = [];
for (const a of ann) {
  for (const code of ["en", "pl"]) {
    const l = a[code];
    if (!l) { annMissingLoc.push(`${a.slug}: no ${code} block`); continue; }
    for (const f of ["title", "subtitle", "body"]) {
      if (!l[f] || !String(l[f]).trim()) annMissingLoc.push(`${a.slug}: ${code}.${f}`);
    }
  }
}
assert(annMissingLoc.length === 0,
  "every announcement has an English and Polish title, subtitle and body",
  "announcements missing a localised field", annMissingLoc);

/* -- no markup in content --------------------------------------------------- */

const annRawHtml = [];
const annScriptish = [];
for (const a of ann) {
  for (const code of ["en", "pl"]) {
    const l = a[code] || {};
    for (const f of ["title", "subtitle", "body", "link_label"]) {
      const v = l[f];
      if (typeof v !== "string") continue;
      if (/<[a-z/!][^>]*>/i.test(v)) annRawHtml.push(`${a.slug}: ${code}.${f}`);
      if (/<\s*script/i.test(v) || /\bon[a-z]+\s*=\s*["']/i.test(v)) {
        annScriptish.push(`${a.slug}: ${code}.${f}`);
      }
    }
  }
}
assert(annRawHtml.length === 0,
  "no raw HTML in any announcement title, subtitle or body (Markdown only)",
  "announcement fields containing HTML tags", annRawHtml);
assert(annScriptish.length === 0,
  "no <script> tags or inline event handlers in announcement content",
  "announcement fields containing script or handler markup", annScriptish);

// Markdown link targets must use a safe protocol.
const annBadProto = [];
for (const a of ann) {
  for (const code of ["en", "pl"]) {
    for (const m of String((a[code] || {}).body || "").matchAll(/\]\(([^)]+)\)/g)) {
      const url = m[1].trim();
      if (!/^(https?:|mailto:|\/|#)/i.test(url) && !/^[a-z0-9][a-z0-9-]*\.html([?#]|$)/i.test(url)) {
        annBadProto.push(`${a.slug} (${code}): ${url}`);
      }
    }
  }
}
assert(annBadProto.length === 0,
  "every Markdown link in a body uses an allowed protocol",
  "body links using an unsafe or unrecognised protocol", annBadProto);

/* -- images ----------------------------------------------------------------- */

const annImageFields = [];
for (const a of ann) {
  if (a.image !== null && typeof a.image !== "string") annImageFields.push(`${a.slug}: image is ${typeof a.image}`);
  if (a.image && !String(a.image).startsWith("/assets/")) annImageFields.push(`${a.slug}: ${a.image}`);
  for (const x of a.extra_images || []) {
    if (!String(x).startsWith("/assets/")) annImageFields.push(`${a.slug}: extra ${x}`);
  }
}
assert(annImageFields.length === 0,
  "every announcement image path is null or root-relative under /assets/",
  "image fields that are not null or root-relative", annImageFields);

const annMissingImg = [];
for (const a of ann) {
  if (a.image && !exists(String(a.image).replace(/^\/+/, ""))) annMissingImg.push(`${a.slug}: ${a.image}`);
  for (const x of a.extra_images || []) {
    if (!exists(String(x).replace(/^\/+/, ""))) annMissingImg.push(`${a.slug}: extra ${x}`);
  }
}
assert(annMissingImg.length === 0,
  `all referenced announcement images exist on disk (${ann.filter((a) => a.image).length} main + ${ann.reduce((n, a) => n + (a.extra_images || []).length, 0)} extra)`,
  "announcement image paths that do not resolve to a real file", annMissingImg);

const annBadFit = ann.filter((a) => a.image_fit && !SUPPORTED_FIT.has(a.image_fit))
  .map((a) => `${a.slug}: ${a.image_fit}`);
assert(annBadFit.length === 0,
  `every image_fit uses a supported value (${[...SUPPORTED_FIT].join(", ")})`,
  "unsupported image_fit values", annBadFit);

/* -- links ------------------------------------------------------------------ */

const annLinked = ann.filter((a) => a.link && a.link.type);
const annBadType = annLinked.filter((a) => !SUPPORTED_LINK_TYPES.has(a.link.type))
  .map((a) => `${a.slug}: ${a.link.type}`);
assert(annBadType.length === 0,
  `every link type is recognised (${[...SUPPORTED_LINK_TYPES].join(", ")})`,
  "unrecognised link types", annBadType);

const annBadEvent = annLinked.filter((a) => a.link.type === "event")
  .filter((a) => !a.link.event_slug || !exists(`event-${a.link.event_slug}.html`))
  .map((a) => `${a.slug} -> event-${a.link.event_slug}.html`);
assert(annBadEvent.length === 0,
  `every event link points at an existing event page (${annLinked.filter((a) => a.link.type === "event").length} links)`,
  "event links whose target page does not exist", annBadEvent);

const annBadExternal = annLinked.filter((a) => a.link.type === "external")
  .filter((a) => !/^https:\/\/\S+$/.test(String(a.link.url)))
  .map((a) => `${a.slug}: ${a.link.url}`);
assert(annBadExternal.length === 0,
  "every external link is an HTTPS URL",
  "external links that are not HTTPS", annBadExternal);

const annBadPage = annLinked.filter((a) => a.link.type === "page")
  .filter((a) => !exists(String(a.link.page)))
  .map((a) => `${a.slug}: ${a.link.page}`);
assert(annBadPage.length === 0,
  "every internal page link points at an existing page",
  "page links whose target does not exist", annBadPage);

const annMissingLabel = annLinked.filter(
  (a) => !((a.en || {}).link_label || "").trim() || !((a.pl || {}).link_label || "").trim()
).map((a) => a.slug);
assert(annMissingLabel.length === 0,
  "every linked announcement has an English and Polish link label",
  "linked announcements missing a localised label", annMissingLabel);

const annStrayLabel = ann.filter((a) => !(a.link && a.link.type))
  .filter((a) => ((a.en || {}).link_label || (a.pl || {}).link_label))
  .map((a) => a.slug);
assert(annStrayLabel.length === 0,
  "no announcement carries a link label without a destination",
  "link labels with no link", annStrayLabel);

/* -- optional-feature counts must match the live source arrays -------------- */

const annCounts = {
  noImage: ann.filter((a) => !a.image).length,
  closed: ann.filter((a) => a.signups_closed).length,
  imagePosition: ann.filter((a) => a.image_position).length,
  containFit: ann.filter((a) => a.image_fit === "contain").length,
  extraImages: ann.filter((a) => (a.extra_images || []).length).length,
  background: ann.filter((a) => a.image_background).length,
  linked: annLinked.length,
  external: annLinked.filter((a) => a.link.type === "external").length,
};
const annCountMismatch = Object.entries(ANN_FEATURES)
  .filter(([k, want]) => annCounts[k] !== want)
  .map(([k, want]) => `${k}: expected ${want}, found ${annCounts[k]}`);
assert(annCountMismatch.length === 0,
  `optional-feature counts match the live arrays (${Object.entries(annCounts).map(([k, v]) => `${k} ${v}`).join(", ")})`,
  "optional-feature counts differ from the live source arrays", annCountMismatch);

/* =================================================================== 18. generated announcements */

section("18. Generated announcement pages (Phase 6)");

const ANN_PAGES = { en: "dist/announcements.html", pl: "dist/pl/announcements.html" };
const ANN_DATA = { en: "dist/js/announcements-data-en.js", pl: "dist/js/announcements-data-pl.js" };

if (!exists("dist")) {
  ok("dist/ absent — generated announcement checks skipped (run `npm run build` to enable them)");
} else {
  const missingAnn = [...Object.values(ANN_PAGES), ...Object.values(ANN_DATA)].filter((p) => !exists(p));
  assert(missingAnn.length === 0,
    "both announcement pages and both generated data files exist",
    "generated announcement artefacts missing after build", missingAnn);

  if (missingAnn.length === 0) {
    const vm = require("child_process");
    const nodeVm = require("vm");
    const loadArr = (rel, expr) => {
      const ctx = {};
      nodeVm.createContext(ctx);
      nodeVm.runInContext(read(rel), ctx);
      return nodeVm.runInContext(expr, ctx);
    };

    const gAnn = { en: read(ANN_PAGES.en), pl: read(ANN_PAGES.pl) };
    const gData = { en: loadArr(ANN_DATA.en, "ANNOUNCEMENTS"), pl: loadArr(ANN_DATA.pl, "ANNOUNCEMENTS") };

    assert(/<html lang="en">/.test(gAnn.en), 'generated English announcements page declares lang="en"',
      "generated English announcements page has the wrong <html lang>");
    assert(/<html lang="pl">/.test(gAnn.pl), 'generated Polish announcements page declares lang="pl"',
      "generated Polish announcements page has the wrong <html lang>");

    const annCanon = (s) => (s.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    assert(annCanon(gAnn.en) === `${SITE}/announcements.html` &&
      annCanon(gAnn.pl) === `${SITE}/pl/announcements.html`,
      "generated announcement canonicals are self-referencing and keep the .html URLs",
      "generated announcement canonical URLs are wrong",
      [`en: ${annCanon(gAnn.en)}`, `pl: ${annCanon(gAnn.pl)}`]);

    const annAlts = (s) => [...s.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)]
      .map((m) => `${m[1]}=${m[2]}`).sort();
    const annWant = [`en=${SITE}/announcements.html`, `pl=${SITE}/pl/announcements.html`,
      `x-default=${SITE}/announcements.html`].sort();
    assert(JSON.stringify(annAlts(gAnn.en)) === JSON.stringify(annWant) &&
      JSON.stringify(annAlts(gAnn.pl)) === JSON.stringify(annWant),
      "both announcement pages carry the identical reciprocal hreflang trio with an English x-default",
      "generated announcement hreflang alternates are wrong",
      [`en: ${annAlts(gAnn.en).join(" ")}`, `pl: ${annAlts(gAnn.pl).join(" ")}`]);

    const annOg = (s) => (s.match(/<meta property="og:locale" content="([^"]+)"/) || [])[1];
    assert(annOg(gAnn.en) === "en_GB" && annOg(gAnn.pl) === "pl_PL",
      "generated announcement pages declare the correct Open Graph locales",
      "generated announcement og:locale values are wrong",
      [`en: ${annOg(gAnn.en)}`, `pl: ${annOg(gAnn.pl)}`]);

    const annSwitch = (s) => {
      const nav = s.match(/<nav class="lang-switch"[\s\S]*?<\/nav>/);
      return nav ? [...nav[0].matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1]) : [];
    };
    assert(annSwitch(gAnn.en).includes("/pl/announcements.html") &&
      annSwitch(gAnn.pl).includes("/announcements.html"),
      "announcement language switchers point at the paired page in the other language",
      "announcement language-switcher destinations are wrong",
      [`en: ${annSwitch(gAnn.en).join(", ")}`, `pl: ${annSwitch(gAnn.pl).join(", ")}`]);

    for (const code of ["en", "pl"]) {
      const src = gAnn[code];
      const data = gData[code];

      assert(data.length === ANN_EXPECTED,
        `generated ${code} data exposes exactly ${ANN_EXPECTED} announcements`,
        `generated ${code} data exposes ${data.length} announcements, expected ${ANN_EXPECTED}`);

      // Visible order must equal the records' order field.
      const wantOrder = ann.slice().sort((a, b) => a.order - b.order).map((a) => a[code].title);
      assert(JSON.stringify(data.map((a) => a.title)) === JSON.stringify(wantOrder),
        `generated ${code} order matches the records' explicit order field`,
        `generated ${code} announcement order does not match the source records`,
        data.map((a) => a.title).filter((t, i) => t !== wantOrder[i]).slice(0, 4));

      // Dates, titles and subtitles are all preserved from the records.
      const byOrder = ann.slice().sort((a, b) => a.order - b.order);
      const wrongDate = data.filter((d, i) => d.isoDate !== byOrder[i].published_date)
        .map((d) => `${d.title}: ${d.isoDate}`);
      assert(wrongDate.length === 0,
        `generated ${code} dates all derive from their record's published_date`,
        `generated ${code} dates do not match their records`, wrongDate.slice(0, 4));
      const wrongSub = data.filter((d, i) => d.subtitle !== byOrder[i][code].subtitle).map((d) => d.title);
      assert(wrongSub.length === 0,
        `generated ${code} subtitles are preserved verbatim`,
        `generated ${code} subtitles do not match their records`, wrongSub.slice(0, 4));

      // Event links must stay RELATIVE — root-relative would send Polish
      // readers to the English event page.
      const internal = data.filter((d) => d.link && !d.link.external).map((d) => d.link.href);
      assert(internal.every((h) => /^[a-z0-9][a-z0-9-]*\.html$/.test(h)),
        `generated ${code} internal links stay relative (${internal.length} links)`,
        `generated ${code} has an internal link that is not relative`,
        internal.filter((h) => !/^[a-z0-9][a-z0-9-]*\.html$/.test(h)));

      const externals = data.filter((d) => d.link && d.link.external).map((d) => d.link.href);
      assert(externals.every((h) => /^https:\/\//.test(h)),
        `generated ${code} external links remain absolute HTTPS (${externals.length} links)`,
        `generated ${code} has an external link that is not HTTPS`, externals);

      // The /pl/assets/ class of bug: every image path must be root-relative.
      const allImgs = data.flatMap((d) => [d.image, ...(d.extraImages || [])]).filter(Boolean);
      assert(allImgs.every((i) => i.startsWith("/assets/")),
        `no generated ${code} image path can resolve under /pl/ (${allImgs.length} paths, all root-relative)`,
        `generated ${code} image paths that are not root-relative`,
        allImgs.filter((i) => !i.startsWith("/assets/")));

      // Every referenced asset must have been copied into dist/.
      const notCopied = allImgs.filter((i) => !exists("dist" + i));
      assert(notCopied.length === 0,
        `all ${allImgs.length} ${code} announcement images were copied into dist/`,
        `${code} announcement images referenced but not copied into dist/`, notCopied.slice(0, 5));

      // Local CSS and script references on the page must resolve inside dist/.
      const refs = [
        ...[...src.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]),
        ...[...src.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]),
      ].filter((r) => r.startsWith("/"));
      const brokenRefs = refs.filter((r) => !exists("dist" + r));
      assert(brokenRefs.length === 0,
        `generated ${code} page's ${refs.length} local CSS/script references all resolve inside dist/`,
        `generated ${code} page references files that do not exist in dist/`, brokenRefs);

      assert(/<a[^>]*class="[^"]*\bactive\b[^"]*"[^>]*href="announcements\.html"/.test(src) ||
        /<a[^>]*href="announcements\.html"[^>]*class="[^"]*\bactive\b[^"]*"/.test(src),
        `generated ${code} announcements page marks News as the active navigation item`,
        `generated ${code} announcements page has no active navigation state on News`);
    }

    // Polish event links resolve within /pl/ precisely because they are
    // relative and the page itself lives at /pl/announcements.html.
    const plInternal = gData.pl.filter((d) => d.link && !d.link.external).map((d) => d.link.href);
    assert(plInternal.length > 0 && plInternal.every((h) => !h.startsWith("/")),
      `Polish internal links resolve within /pl/ (${plInternal.length} relative links from /pl/announcements.html)`,
      "a Polish internal link would escape /pl/");

    assert(!/announcements-data|announcements\.html.*dist/.test(sitemapRaw) || !/\/dist\//.test(sitemapRaw),
      "sitemap.xml lists no generated announcement artefact",
      "sitemap.xml references generated output");

    // --- semantic comparison against the live pages -------------------------
    const { spawnSync } = require("child_process");
    const annCmp = spawnSync(process.execPath, [path.join(__dirname, "compare-announcements.js")], {
      cwd: ROOT, encoding: "utf8",
    });
    const annMatched = (annCmp.stdout.match(/PASS — (\d+)\/\1 comparisons matched/) || [])[1];
    assert(annCmp.status === 0,
      `generated announcements match the live pages (${annMatched || "?"} semantic comparisons — scripts/compare-announcements.js)`,
      "scripts/compare-announcements.js reports differences from the live announcement pages",
      (annCmp.stdout || "").split("\n").filter((l) => /FAIL/.test(l)).slice(0, 12));
  }
}

/* =================================================================== 19. modal close layering */

section("19. Announcement modal close-button layering (Phase 7)");

/**
 * Parse one rule's declarations out of the stylesheet by brace matching, rather
 * than grepping for a substring. A text search for "z-index" anywhere in the
 * file would happily pass while the declaration sat in a comment or in an
 * unrelated rule; this reads the actual `.modal-close` block.
 */
function cssRule(sheet, selector) {
  const re = new RegExp("(^|\\})\\s*" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{", "m");
  const m = sheet.match(re);
  if (!m) return null;
  const open = sheet.indexOf("{", m.index + m[0].length - 1);
  let depth = 0;
  for (let i = open; i < sheet.length; i++) {
    if (sheet[i] === "{") depth++;
    else if (sheet[i] === "}") { depth--; if (depth === 0) return sheet.slice(open + 1, i); }
  }
  return null;
}

/** Declarations of a rule body, comments stripped, as { prop: value }. */
function cssDecls(body) {
  const out = {};
  if (!body) return out;
  for (const decl of body.replace(/\/\*[\s\S]*?\*\//g, "").split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
  }
  return out;
}

const styleSheet = read("css/style.css");
const closeBody = cssRule(styleSheet, ".modal-close");

assert(closeBody !== null,
  "css/style.css defines a .modal-close rule",
  "the .modal-close rule is missing from css/style.css");

if (closeBody !== null) {
  const d = cssDecls(closeBody);

  // z-index only takes effect on a positioned element, so the two checks
  // belong together — a stacking value on a static box is silently inert.
  const POSITIONED = new Set(["absolute", "relative", "fixed", "sticky"]);
  assert(POSITIONED.has(String(d.position)),
    `.modal-close is positioned (position: ${d.position}) so a stacking value applies`,
    ".modal-close is not positioned — z-index would have no effect", [`position: ${d.position}`]);

  assert(d["z-index"] !== undefined,
    `.modal-close declares an explicit stacking value (z-index: ${d["z-index"]})`,
    ".modal-close has no explicit z-index — the modal photograph will paint over it " +
    "and swallow clicks on the close control (see docs/ANNOUNCEMENT_MODAL_FIX.md)");

  if (d["z-index"] !== undefined) {
    const z = Number(d["z-index"]);
    assert(Number.isInteger(z) && z >= 1,
      `.modal-close's stacking value is a positive integer (${z})`,
      ".modal-close's z-index is not a positive integer", [`z-index: ${d["z-index"]}`]);
    // Guard against someone "fixing" a future problem with a huge number: the
    // button only has to beat its siblings inside .modal-panel, and .modal
    // itself sits at 200. Anything at or above that is a sign the value was
    // chosen by escalation rather than by reading the stacking context.
    assert(z < 200,
      `.modal-close's stacking value is modest and scoped to .modal-panel (${z} < 200)`,
      ".modal-close's z-index is inflated — it only needs to beat its siblings inside .modal-panel",
      [`z-index: ${d["z-index"]}`]);
  }

  // The fix must not have been achieved by disabling pointer events on the
  // photograph, which would break image interaction and is explicitly ruled out.
  const phBody = cssRule(styleSheet, ".modal-panel .ph");
  assert(!/pointer-events/.test(String(phBody)),
    "the fix does not disable pointer events on the modal photograph",
    "pointer-events was used on the modal photograph instead of a stacking value");
}

// The generated site must serve the same stylesheet, byte for byte — that is
// what makes the fix reach dist/ without a second edit.
if (exists("dist/css/style.css")) {
  const crypto2 = require("crypto");
  const sha = (p) => crypto2.createHash("sha256").update(fs.readFileSync(path.join(ROOT, p))).digest("hex");
  assert(sha("css/style.css") === sha("dist/css/style.css"),
    "dist/css/style.css is a byte-identical copy of css/style.css (the fix reaches the generated pages)",
    "the generated stylesheet differs from the source stylesheet");
}

// The fix is CSS-only: no announcement content, data or markup may have moved.
{
  const { execFileSync } = require("child_process");
  let changed = [];
  try {
    changed = execFileSync("git", ["status", "--porcelain", "--",
      "announcements.html", "pl/announcements.html",
      "js/announcements-data.js", "js/pl/announcements-data.js",
      "content/announcements"], { cwd: ROOT, encoding: "utf8" })
      .split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    changed = ["(git unavailable — check skipped)"];
  }
  assert(changed.length === 0 || changed[0].startsWith("(git unavailable"),
    "no announcement page, data file or content record was modified by this fix",
    "the modal fix touched announcement content or markup", changed);
}

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
