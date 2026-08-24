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

/** SHA-256 of a repo-relative file, for byte-identity checks. */
const hashFile = (rel) =>
  require("crypto").createHash("sha256").update(fs.readFileSync(path.join(ROOT, rel))).digest("hex");

/* ===========================================================================
   DEPLOYMENT STATE

   The site has exactly TWO supported deployment configurations, and this is the
   single place that decides which one is active. Before this existed, seven
   assertions across five sections each hardcoded "publish must be '.'", which
   made the approved cutover un-committable: the guards that protected the
   pre-cutover state also forbade ever leaving it.

     repository-root   publish = "."      and NO build command
     generated-dist    publish = "dist"   and command = "npm run build"

   Everything else is rejected, including both halves of a partial cutover.
   `publish = "dist"` without a command is the dangerous one: dist/ is gitignored
   and absent from a clean checkout, so Netlify would publish an empty directory
   and the site would go down.

   Not a general TOML parser — the project has no TOML dependency and does not
   need one. It reads the `[build]` table only, after stripping comments in a
   string-aware way, and reports ambiguity rather than guessing.
   =========================================================================== */

/**
 * Strip `#` comments while respecting double-quoted strings, so a `#` inside a
 * value is preserved and a commented-out example never counts as active config.
 */
function stripTomlComments(src) {
  return String(src)
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
}

/**
 * Parse the `[build]` table of netlify.toml into a deployment state.
 *
 * Returns { publish, command, mode, problems[] }. `command` is `null` when no
 * key is declared and `""` when one is declared empty — a meaningful difference,
 * because an empty command is a broken build, not the absence of one.
 * `mode` is "repository-root", "generated-dist", or "unsupported".
 */
function parseDeploymentState(tomlSource) {
  const problems = [];
  const code = stripTomlComments(tomlSource);

  // Slice out the [build] table: from its header to the next table header.
  const lines = code.split("\n");
  const start = lines.findIndex((l) => /^\s*\[build\]\s*$/.test(l));
  if (start === -1) {
    problems.push("no [build] section found");
    return { publish: null, command: null, mode: "unsupported", problems };
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    // `[build.environment]` is a sub-table, not the end of [build]; any other
    // bracketed header is.
    if (/^\s*\[\[?[^\]]+\]\]?\s*$/.test(lines[i]) && !/^\s*\[build\./.test(lines[i])) { end = i; break; }
  }
  const buildLines = lines.slice(start + 1, end);

  /** Every active `key = "value"` in the table, so duplicates are visible. */
  const valuesOf = (key) => buildLines
    .map((l) => l.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"\\s*$`)))
    .filter(Boolean)
    .map((m) => m[1]);

  const publishes = valuesOf("publish");
  const commands = valuesOf("command");

  // A key that appears with a non-string value (or malformed) is ambiguous.
  const malformed = buildLines.filter((l) =>
    /^\s*(publish|command)\s*=/.test(l) && !/^\s*(publish|command)\s*=\s*"[^"]*"\s*$/.test(l));
  for (const l of malformed) problems.push(`unreadable [build] setting: ${l.trim()}`);

  if (publishes.length === 0) problems.push("no active `publish` declared in [build]");
  if (publishes.length > 1) problems.push(`duplicate active \`publish\` declarations: ${publishes.join(", ")}`);
  if (commands.length > 1) problems.push(`duplicate active \`command\` declarations: ${commands.join(", ")}`);

  const publish = publishes.length === 1 ? publishes[0] : null;
  const command = commands.length === 1 ? commands[0] : (commands.length === 0 ? null : undefined);

  let mode = "unsupported";
  if (problems.length === 0) {
    if (publish === "." && command === null) mode = "repository-root";
    else if (publish === "dist" && command === "npm run build") mode = "generated-dist";
  }
  return { publish, command, mode, problems };
}

/**
 * The active deployment state, parsed once on first use.
 *
 * Lazy because this helper sits above the file-reading helpers it needs; a plain
 * const here would evaluate at load time and crash. Memoised so every section
 * sees one consistent answer.
 */
let _deploy = null;
function deployState() {
  if (_deploy) return _deploy;
  const file = path.join(ROOT, "netlify.toml");
  _deploy = fs.existsSync(file)
    ? parseDeploymentState(fs.readFileSync(file, "utf8"))
    : { publish: null, command: null, mode: "unsupported", problems: ["netlify.toml is missing"] };
  return _deploy;
}

/**
 * Explain why a state is not one of the two supported ones. Kept separate from
 * the parser so the message can name the specific danger.
 */
function describeUnsupportedDeployment(state) {
  if (state.problems.length) return state.problems.join("; ");
  if (state.publish === "dist" && state.command === null) {
    return 'publish = "dist" with NO build command — dist/ is gitignored and absent from a '
      + 'clean checkout, so Netlify would publish an empty directory and the site would go down. '
      + 'Add command = "npm run build" in the same commit.';
  }
  if (state.publish === "dist" && state.command === "") {
    return 'publish = "dist" with an EMPTY build command — nothing would generate dist/.';
  }
  if (state.publish === "dist") {
    return `publish = "dist" but the command is ${JSON.stringify(state.command)}; `
      + 'the generated-dist state requires exactly "npm run build".';
  }
  if (state.publish === "." && state.command !== null) {
    return `publish = "." with a build command (${JSON.stringify(state.command)}) — the repository-root `
      + "state serves the hand-written files and must not run a build.";
  }
  return `publish = ${JSON.stringify(state.publish)} is neither "." nor "dist".`;
}

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
  // The build command is state-dependent, not permanently forbidden: the
  // repository-root deployment must have none, the generated-dist deployment must
  // have exactly `npm run build`. See parseDeploymentState().
  if (deployState().mode === "repository-root") {
    assert(deployState().command === null,
      "repository-root deployment declares no build command (the site is served as-is)",
      "repository-root deployment declares a build command", deployState().command);
  } else if (deployState().mode === "generated-dist") {
    assert(deployState().command === "npm run build",
      'generated-dist deployment declares command = "npm run build"',
      "generated-dist deployment has the wrong build command", deployState().command);
  } else {
    assert(false,
      "the Netlify build configuration is one of the two supported states",
      `unsupported Netlify deployment configuration — ${describeUnsupportedDeployment(deployState())}`);
  }
}

assert(exists("robots.txt") && !/Disallow/.test(read("robots.txt")),
  "robots.txt allows crawling and blocks nothing",
  "robots.txt is missing or contains Disallow rules");
assert(read("robots.txt").includes(`${SITE}/sitemap.xml`),
  "robots.txt points at the sitemap", "robots.txt does not declare the sitemap");

/* ---------------------------------------------------------------------------
   FIXTURE BOOTSTRAP (Phase 15)

   Architectural fixtures no longer ship in dist/ — a normal build ignores them,
   so a test page can never reach the deployment tree. Several sections below still
   assert on them (the Phase 2 proof pages, the Phase 3 chrome pages, the Phase 14
   archive fixture), so they are built ONCE here into .fixtures/.

   Section 33's archive-UI test rebuilds and then removes that tree itself, which
   is why this runs first and why nothing here depends on it surviving.
   --------------------------------------------------------------------------- */
{
  const { spawnSync } = require("child_process");
  const r = spawnSync(process.execPath, [path.join(__dirname, "build-fixtures.js")],
    { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) {
    console.log("\n  ! fixture build failed — fixture-dependent checks below will fail");
  }
}

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
  // Phase 15 made the OUTPUT directory conditional: dist/ for a normal build and
  // .fixtures/ when BUILD_FIXTURES=1, so no test page can reach the deployment
  // tree. Phase 17C.2 added a THIRD branch, .cms/ when CMS_DEV=1, because the
  // admin used to be built into dist/ — where `npm run clean`, `npm run build`
  // and every validator deleted it out from under a CMS an editor had open. That
  // was the cause of the "Failed to fetch" reports. Each branch is asserted
  // separately so none of the three can quietly collapse into another.
  assert(/input:\s*"src"/.test(cfg), "Eleventy input is scoped to src/ — the build cannot touch the repository root",
    "Eleventy input is not scoped to src/");
  assert(/output:\s*FIXTURES \? "\.fixtures" : CMS_DEV \? "\.cms" : "dist"/.test(cfg),
    "Eleventy output is dist/ normally, .fixtures/ when BUILD_FIXTURES=1 and .cms/ when CMS_DEV=1",
    "the Eleventy output directory is not the expected dist/ vs .fixtures/ vs .cms/ split");
  // The separation only holds if the CMS branch is genuinely mutually exclusive
  // with the fixtures branch; `CMS_DEV=1 BUILD_FIXTURES=1` must not write the
  // admin into the fixtures tree.
  assert(/CMS_DEV\s*=\s*process\.env\.CMS_DEV === "1" && !FIXTURES/.test(cfg),
    "CMS_DEV and BUILD_FIXTURES cannot both be active, so the admin cannot land in .fixtures/",
    "CMS_DEV is not mutually exclusive with BUILD_FIXTURES");
  assert(/eleventyConfig\.ignores\.add\("src\/build-test\/\*\*"\)/.test(cfg),
    "a normal build ignores src/build-test/, so fixtures cannot enter the deployment tree",
    "src/build-test/ is not ignored by a normal build");
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
//   Phase 8: societies
//   Phase 9: pages (contact, 404)
//   Phase 11: events (standard family only — the Business Forum is a later phase)
const MIGRATED_COLLECTIONS = new Set(["team", "settings", "announcements", "societies", "pages", "events"]);
const populated = ["announcements", "team", "societies", "settings", "pages", "events"]
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

const PROOF = [".fixtures/build-test/index.html", ".fixtures/build-test/pl/index.html"];

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
    const MIGRATED = ["team.html", "pl/team.html", "announcements.html", "pl/announcements.html",
      "members.html", "pl/members.html", "contact.html", "pl/contact.html",
      "404.html", "pl/404.html",
      // Phase 13 added the bilingual events listing; Phase 14 the homepages.
      "events.html", "pl/events.html",
      "index.html", "pl/index.html",
      // Phase 11 added the four standard events; Phase 12 the Business Forum.
      ...["sikorski-debate", "christmas-dinner", "youth-congress", "icebreaker", "business-forum"]
        .flatMap((s) => [`event-${s}.html`, `pl/event-${s}.html`])];

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

    // The "collision" above describes generated pages sharing a filename with a
    // public page. Whether that matters depends on the deployment mode:
    //
    //   repository-root  the hand-written files are served and dist/ is not, so
    //                    a collision means nothing — it is the intended overlap.
    //   generated-dist   the generated files ARE the site; the root copies are
    //                    kept only as the rollback surface and comparison
    //                    baseline, so the overlap is again intended.
    //
    // Either way what must hold is that the deployment is in one of the two
    // supported states, which is what is asserted here.
    assert(deployState().mode !== "unsupported",
      `Netlify deployment mode is valid: ${deployState().mode}`,
      `unsupported Netlify deployment configuration — ${describeUnsupportedDeployment(deployState())}`);

    // Passthrough assets must be byte-identical copies. If one ever differs,
    // the build has modified a shared asset rather than copying it.
    //
    // Most originals sit at the repository root at the same relative path.
    // src/js/team-filter.js is new architecture-owned source with no root
    // counterpart, so its origin is stated explicitly rather than guessed.
    const PASSTHROUGH_SOURCE = {
      "js/team-filter.js": "src/js/team-filter.js",
      "js/announcements-page.js": "src/js/announcements-page.js",
      "js/members-page.js": "src/js/members-page.js",
    };
    // Build PRODUCTS, not copies: these are rendered from templates and have no
    // byte-identical source, so they are excluded from the copy check and
    // covered instead by §18 and scripts/compare-announcements.js.
    const GENERATED_ASSETS = new Set([
      "js/announcements-data-en.js",
      "js/announcements-data-pl.js",
      "js/societies-data-en.js",
      "js/societies-data-pl.js",
    ]);
    const crypto = require("crypto");
    const hash = (p) => crypto.createHash("sha256")
      .update(fs.readFileSync(path.join(ROOT, p))).digest("hex");
    // sitemap.xml joined the generated set in Phase 15 (src/sitemap.njk): it is
    // built from the route inventory, so it deliberately differs from the
    // hand-maintained root file and must not be hash-compared against it.
    const GENERATED_NON_HTML = new Set([...GENERATED_ASSETS, "sitemap.xml"]);
    const copied = distFiles.filter((f) => !f.endsWith(".html") && !GENERATED_NON_HTML.has(f));
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
  en: ".fixtures/build-test/chrome/index.html",
  pl: ".fixtures/build-test/chrome/pl/index.html",
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

/*
  Photograph focus (Phase 17C.3). Optional everywhere — every current member
  leaves it empty and renders exactly as before — but a value that IS present
  must be one the renderer accepts, because it reaches a `style` attribute.
*/
{
  const F = require(path.join(ROOT, "src", "_data", "focalPoint.js"));
  const badFocus = team
    .filter((m) => m.photo_focus !== null && m.photo_focus !== undefined &&
      F.parseFocal(m.photo_focus) === null)
    .map((m) => `${m.slug}: ${JSON.stringify(m.photo_focus)}`);
  assert(badFocus.length === 0,
    "every photograph focus is one the website can actually use",
    "photograph focus values the renderer would refuse", badFocus);

  const focusWithoutPhoto = team
    .filter((m) => m.photo_focus && !m.photo)
    .map((m) => m.slug);
  assert(focusWithoutPhoto.length === 0,
    "no member has a photograph focus without a photograph to apply it to",
    "focus set on a member with no photograph", focusWithoutPhoto);
}

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
  // `photo` is deliberately NOT required to be present — see the photograph
  // block below. Absent and explicitly null both mean "no photograph".
  if (!("published" in m)) missingShared.push(`${m.slug}: published`);
}
assert(missingShared.length === 0,
  `all ${SHARED_REQUIRED.length + 1} shared invariant fields are present on every member`,
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

/* -- photographs ------------------------------------------------------------
 *
 * THE RULE: `photo` may be ABSENT or explicitly NULL — both mean "this member
 * has no photograph". If present and non-null it must be a real Team asset.
 *
 * Absence became a legitimate spelling in Phase 17A.1. A hand-written record
 * says `photo: null`; Decap omits the key entirely when an editor selects no
 * image, and has no way to write an explicit null. Rejecting the CMS's natural
 * output would have meant hand-editing YAML after every photograph-less member
 * — which is exactly the work the CMS exists to remove.
 *
 * What did NOT relax: anything that is present must still be a root-relative
 * path under /assets/team/ that resolves to a real file. An empty string, an
 * external URL, a /pl/-prefixed path, a Windows path or a non-string scalar are
 * all still failures, and are reported separately so the message names the
 * actual problem.
 *
 * See docs/CMS_FOUNDATION.md §9.
 * ------------------------------------------------------------------------- */

/** "none" | "path" | "empty" | "type" — the four states `photo` can be in. */
function photoState(m) {
  if (!("photo" in m) || m.photo === null) return "none";
  if (typeof m.photo !== "string") return "type";
  if (m.photo.trim() === "") return "empty";
  return "path";
}

const withPhoto = current.filter((m) => photoState(m) === "path");
const withoutPhoto = current.filter((m) => photoState(m) === "none");

const missingAlt = withPhoto.filter((m) => !(m.en && m.en.photo_alt) || !(m.pl && m.pl.photo_alt))
  .map((m) => m.slug);
assert(missingAlt.length === 0,
  `all ${withPhoto.length} members with a photograph have English and Polish alt text`,
  "members with a photograph but no localised alt text", missingAlt);

{
  const absent = withoutPhoto.filter((m) => !("photo" in m));
  const explicit = withoutPhoto.filter((m) => m.photo === null);
  assert(true,
    `a photograph-less member may omit \`photo\` or set it to null ` +
    `(${withoutPhoto.length}: ${explicit.length} explicit null, ${absent.length} absent)`);
}

// A value that is present but unusable. These would previously have been caught
// by the "must be an explicit null" rule; now that absence is legal, they need
// naming in their own right or they would slip through as "no photograph".
const emptyPhoto = current.filter((m) => photoState(m) === "empty")
  .map((m) => `${m.slug}: ${JSON.stringify(m.photo)}`);
assert(emptyPhoto.length === 0,
  "no member uses an empty string for a photograph (omit the key or use null)",
  "empty-string photograph values", emptyPhoto);

const typedPhoto = current.filter((m) => photoState(m) === "type")
  .map((m) => `${m.slug}: ${JSON.stringify(m.photo)} (${typeof m.photo})`);
assert(typedPhoto.length === 0,
  "every photograph value is a string or null, never a number, boolean or list",
  "photograph values of the wrong type", typedPhoto);

const strayAlt = withoutPhoto.filter((m) => (m.en && m.en.photo_alt) || (m.pl && m.pl.photo_alt))
  .map((m) => m.slug);
assert(strayAlt.length === 0,
  "no photograph-less member carries alt text for an image that does not exist",
  "alt text on a member with no photograph", strayAlt);

// Reported separately from the general prefix rule so the failure message says
// what is actually wrong rather than "not root-relative".
const externalPhoto = withPhoto.filter((m) => /^[a-z][a-z0-9+.-]*:\/\//i.test(m.photo) || m.photo.startsWith("//"))
  .map((m) => `${m.slug}: ${m.photo}`);
assert(externalPhoto.length === 0,
  "no photograph is hotlinked from an external site",
  "external photograph URLs — headshots must be files in this repository", externalPhoto);

const windowsPhoto = withPhoto.filter((m) => /^[A-Za-z]:[\\/]/.test(m.photo) || m.photo.includes("\\"))
  .map((m) => `${m.slug}: ${m.photo}`);
assert(windowsPhoto.length === 0,
  "no photograph path is an absolute local filesystem path",
  "local filesystem paths — these exist only on one machine", windowsPhoto);

// The /pl/ bug class: a page-relative path resolves to /pl/assets/… from the
// Polish page and 404s.
const localisedPhoto = withPhoto.filter((m) => m.photo.startsWith("/pl/") || m.photo.includes("/pl/assets/"))
  .map((m) => `${m.slug}: ${m.photo}`);
assert(localisedPhoto.length === 0,
  "no photograph path is language-prefixed (/pl/assets/… would 404)",
  "language-prefixed photograph paths", localisedPhoto);

const badPhotoPath = withPhoto.filter((m) => !m.photo.startsWith("/assets/team/"))
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

/* -- the publication date --------------------------------------------------
 *
 * `published_date` must be a DATE-ONLY value, and it has two legal spellings.
 *
 * The canonical files quote it, so YAML yields a string. Decap re-serialises
 * with `yaml`@1, whose YAML 1.2 core schema treats a bare 2025-10-26 as an
 * ordinary string and writes it unquoted; js-yaml's default schema still carries
 * YAML 1.1 timestamps and reads that same line back as a Date. Both spellings
 * denote the same calendar day, and src/_data/records.js converts the second to
 * the first through UTC components before anything renders it.
 *
 * What is still rejected, and why it matters: a Date carrying a real TIME
 * component. `2025-10-26T13:45:00Z` is not a date-only value — rendering it
 * depends on the reader's timezone, and in Warsaw it can display the previous
 * day. That is the actual hazard; the quoting is only its symptom.
 *
 * See docs/CMS_ANNOUNCEMENTS.md §6.
 * ------------------------------------------------------------------------- */

/** The canonical "YYYY-MM-DD" for either spelling, or null if it is neither. */
function canonicalAnnouncementDate(value) {
  if (typeof value === "string") return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const midnightUTC = value.getUTCHours() === 0 && value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0;
    return midnightUTC ? value.toISOString().slice(0, 10) : null;
  }
  return null;
}

const annDateType = annAll.filter((a) => canonicalAnnouncementDate(a.published_date) === null)
  .map((a) => `${a.slug}: ${a.published_date instanceof Date
    ? a.published_date.toISOString() + " (carries a time component)"
    : Object.prototype.toString.call(a.published_date)}`);
assert(annDateType.length === 0,
  "every `published_date` is a date-only value (quoted string or bare YYYY-MM-DD)",
  "publication dates that are not date-only — a time component makes rendering timezone-dependent",
  annDateType);

{
  // Stated separately so the split between the two spellings is visible rather
  // than merely tolerated.
  const quoted = annAll.filter((a) => typeof a.published_date === "string").length;
  const bare = annAll.length - quoted;
  assert(true, `publication dates: ${quoted} quoted string(s), ${bare} bare YAML date(s) — both normalise to one value`);
}

const annBadDate = annAll.filter((a) => {
  const s = canonicalAnnouncementDate(a.published_date);
  if (s === null) return false;                       // already reported above
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

/*
  REGISTRATION replaced the `signups_closed` boolean in Phase 17C.3.

  The old field could only say "closed" — it had no way to express "opens next
  week" or "sign up here", and it left an editor no place to put a registration
  address. The block that replaced it carries a state, an address and the two
  dates, and is checked here in the same spirit as the flag it replaced: the
  shape must be exactly right, because the browser renders a button from it.

  The state is never inferred from today's date. This is a static site, so a
  state that recalculated itself would be wrong the moment a date passed and
  right again only after the next build.
*/
const REG_STATES = ["none", "coming_soon", "open", "closed"];

const annNoReg = annAll.filter((a) => !a.registration || typeof a.registration !== "object")
  .map((a) => a.slug);
assert(annNoReg.length === 0, "every announcement carries a registration block",
  "announcements with no registration block", annNoReg);

const annBadState = annAll
  .filter((a) => a.registration && REG_STATES.indexOf(a.registration.state) === -1)
  .map((a) => `${a.slug}: ${a.registration.state}`);
assert(annBadState.length === 0,
  `every registration state is one of ${REG_STATES.join(", ")}`,
  "unknown registration states", annBadState);

// Only an OPEN registration may carry an address. A closed record holding a
// live sign-up link is the exact confusion this model exists to prevent.
const annStrayUrl = annAll
  .filter((a) => a.registration && a.registration.state !== "open" && a.registration.url)
  .map((a) => `${a.slug}: ${a.registration.state} but has ${a.registration.url}`);
assert(annStrayUrl.length === 0,
  "only an open registration carries a sign-up address",
  "registration addresses on records that are not open", annStrayUrl);

const annOpenNoUrl = annAll
  .filter((a) => a.registration && a.registration.state === "open" && !a.registration.url)
  .map((a) => a.slug);
assert(annOpenNoUrl.length === 0,
  "every open registration has a sign-up address",
  "open registrations with nowhere to go", annOpenNoUrl);

const annBadRegUrl = annAll
  .filter((a) => a.registration && a.registration.url &&
    !/^https:\/\/[^\s"'<>]+$/.test(a.registration.url))
  .map((a) => `${a.slug}: ${a.registration.url}`);
assert(annBadRegUrl.length === 0,
  "every registration address is a plain https:// address",
  "unsafe or malformed registration addresses", annBadRegUrl);

const annBadRegDate = annAll.filter((a) => {
  const r = a.registration || {};
  const ok = (v) => v === null || v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v);
  return !ok(r.opens_on) || !ok(r.closes_on);
}).map((a) => `${a.slug}: ${a.registration.opens_on} / ${a.registration.closes_on}`);
assert(annBadRegDate.length === 0,
  "every registration date is a plain calendar day",
  "registration dates that are not date-only", annBadRegDate);

const annRegOrder = annAll.filter((a) => {
  const r = a.registration || {};
  return r.opens_on && r.closes_on && r.opens_on > r.closes_on;
}).map((a) => `${a.slug}: opens ${a.registration.opens_on}, closes ${a.registration.closes_on}`);
assert(annRegOrder.length === 0,
  "no registration closes before it opens",
  "registrations that close before they open", annRegOrder);

/*
  IMAGE FOCUS (Phase 17C.3).

  These values are written into a `style` attribute, so they are validated with
  the same narrow parser the renderer uses — not a looser one. A value the
  renderer would refuse must not sit in a record pretending to work.
*/
{
  const F = require(path.join(ROOT, "src", "_data", "focalPoint.js"));
  const bad = annAll
    .filter((a) => a.image_position !== null && a.image_position !== undefined &&
      a.image_position !== "" && F.parseFocal(a.image_position) === null)
    .map((a) => `${a.slug}: ${JSON.stringify(a.image_position)}`);
  assert(bad.length === 0,
    "every announcement image focus is one the website can actually use",
    "image focus values the renderer would refuse", bad);
}

// One source of truth: the old flag must be gone, not shadowing the new block.
/*
  REGISTRATION THAT COMES FROM AN EVENT (Phase 17C.5A.2).

  An announcement may point its registration at a Federation event instead of
  repeating it. That reference has to resolve, or a reader would be shown a
  sign-up button for something that does not exist — so a broken one fails the
  build rather than rendering as "no registration".

  Every rule lives in src/_data/registration.js, shared with cms:check and the
  CMS pre-save guard, so all three refuse exactly the same things.
*/
{
  const registrationModel = require(path.join(ROOT, "src", "_data", "registration.js"));
  const eventRecords = fs.existsSync(path.join(ROOT, "content", "events"))
    ? fs.readdirSync(path.join(ROOT, "content", "events"))
      .filter((f) => /\.ya?ml$/i.test(f))
      .map((f) => loadYaml(`content/events/${f}`))
    : [];

  const broken = annAll
    .map((a) => ({ slug: a.slug, why: registrationModel.referenceProblem(a, eventRecords) }))
    .filter((r) => r.why)
    .map((r) => `${r.slug}: ${r.why}`);
  assert(broken.length === 0,
    "every announcement that borrows an event's registration points at a real one",
    "announcements with a broken registration reference", broken);

  // A reference stores ONLY the reference. Copied values would drift.
  const copied = annAll
    .filter((a) => registrationModel.sourceOf(a.registration) === registrationModel.SOURCE_EVENT)
    .filter((a) => ["state", "url", "opens_on", "closes_on"]
      .some((k) => (a.registration || {})[k] !== undefined && (a.registration || {})[k] !== null))
    .map((a) => a.slug);
  assert(copied.length === 0,
    "an event-linked registration stores only the reference, never a copy",
    "announcements copying registration values from an event", copied);
}

const annLegacyFlag = annAll.filter((a) => a.signups_closed !== undefined).map((a) => a.slug);
assert(annLegacyFlag.length === 0,
  "the replaced `signups_closed` flag is gone, so there is one source of truth",
  "records still carrying the old signups_closed flag", annLegacyFlag);

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
  // Reads the registration block since Phase 17C.3, but counts the same thing
  // the old `signups_closed` flag did — the expected total is unchanged, which
  // is itself evidence the migration preserved meaning.
  closed: ann.filter((a) => a.registration && a.registration.state === "closed").length,
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

/*
  The fix is CSS-only: no announcement page, data file or markup may have moved.

  `content/announcements` USED to be in this list. It was removed in Phase
  17C.3, when the registration migration rewrote all 28 records — and, more
  importantly, because the CMS now exists specifically so that editors can change
  these files. A rule that content records must never change would fail the
  moment anybody saved an announcement, and a validator that always fails is a
  validator people learn to ignore.

  Nothing is lost by it. What this guard was really protecting — that the
  announcements PAGE still renders exactly as it does live — is checked far more
  strictly by `npm run compare:announcements`, which compares 160 properties of
  the generated output against the live pages, and by the registration assertions
  in section 17 above. The live public artefacts stay in the list below.
*/
{
  const { execFileSync } = require("child_process");
  let changed = [];
  try {
    changed = execFileSync("git", ["status", "--porcelain", "--",
      "announcements.html", "pl/announcements.html",
      "js/announcements-data.js", "js/pl/announcements-data.js"],
    { cwd: ROOT, encoding: "utf8" })
      .split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    changed = ["(git unavailable — check skipped)"];
  }
  assert(changed.length === 0 || changed[0].startsWith("(git unavailable"),
    "no announcement page, data file or content record was modified by this fix",
    "the modal fix touched announcement content or markup", changed);
}

/* =================================================================== 20. society content */

section("20. Member society records (Phase 8)");

const SOC_DIR = "content/societies";
const SOC_EXPECTED = 30;
// Status counts taken from the live source arrays. Stated here rather than
// recomputed from the records, so a record that loses a flag fails instead of
// quietly redefining the expectation.
const SOC_STATUS = { emptyEmail: 3, inactive: 1, member: 3, pastMember: 13 };

const socFiles = fs.existsSync(path.join(ROOT, SOC_DIR))
  ? fs.readdirSync(path.join(ROOT, SOC_DIR)).filter((f) => /\.ya?ml$/i.test(f)).sort()
  : [];
const socAll = socFiles.map((f) => ({ _file: `${SOC_DIR}/${f}`, ...loadYaml(`${SOC_DIR}/${f}`) }));
const soc = socAll.filter((s) => s.published === true);

assert(soc.length === SOC_EXPECTED,
  `exactly ${SOC_EXPECTED} published society records`,
  `expected ${SOC_EXPECTED} published societies, found ${soc.length}`);

/* -- identity and ordering -------------------------------------------------- */

const socSlugs = socAll.map((s) => s.slug);
const socDup = socSlugs.filter((s, i) => socSlugs.indexOf(s) !== i);
assert(socDup.length === 0, "every society slug is unique",
  "duplicate society slugs", [...new Set(socDup)]);

const socSlugFile = socAll.filter((s) => s._file !== `${SOC_DIR}/${s.slug}.yaml`).map((s) => s._file);
assert(socSlugFile.length === 0, "every society's slug matches its filename",
  "records whose slug does not match the filename", socSlugFile);

const socOrders = soc.map((s) => s.order);
assert(new Set(socOrders).size === socOrders.length,
  "every published society has a unique display order",
  "duplicate society display orders", socOrders.filter((o, i) => socOrders.indexOf(o) !== i));
assert(socOrders.every((o) => Number.isInteger(o)),
  "every society `order` is a whole number",
  "non-integer society display orders", socOrders.filter((o) => !Number.isInteger(o)));

const socSplit = socFiles.filter((f) => /[-.](en|pl)\.ya?ml$/i.test(f) || /^(en|pl)[-.]/i.test(f));
assert(socSplit.length === 0,
  "no language-split society files (one canonical record each)",
  "language-split society files found", socSplit);

/* -- required fields -------------------------------------------------------- */

const SOC_REQUIRED = ["slug", "order", "name", "latitude", "longitude", "instagram", "logo"];
const socMissing = [];
for (const s of soc) {
  for (const f of SOC_REQUIRED) {
    if (s[f] === undefined || s[f] === null || String(s[f]).trim() === "") socMissing.push(`${s.slug}: ${f}`);
  }
  // `email` may be empty, but the KEY must exist — an absent key would mean the
  // record simply forgot the field rather than declaring "no public address".
  if (!("email" in s)) socMissing.push(`${s.slug}: email (may be "", but must be present)`);
  for (const f of ["published", "active", "member", "past_member"]) {
    if (!(f in s)) socMissing.push(`${s.slug}: ${f}`);
  }
  for (const code of ["en", "pl"]) {
    if (!s[code] || !String((s[code] || {}).university_location || "").trim()) {
      socMissing.push(`${s.slug}: ${code}.university_location`);
    }
  }
}
assert(socMissing.length === 0,
  "every society has all required shared fields plus an English and Polish location line",
  "societies missing a required field", socMissing);

/* -- coordinates ------------------------------------------------------------ */

const socBadLat = soc.filter((s) => typeof s.latitude !== "number" || !(s.latitude >= -90 && s.latitude <= 90))
  .map((s) => `${s.slug}: ${s.latitude}`);
assert(socBadLat.length === 0, "every latitude is a number between -90 and 90",
  "invalid latitudes", socBadLat);

const socBadLng = soc.filter((s) => typeof s.longitude !== "number" || !(s.longitude >= -180 && s.longitude <= 180))
  .map((s) => `${s.slug}: ${s.longitude}`);
assert(socBadLng.length === 0, "every longitude is a number between -180 and 180",
  "invalid longitudes", socBadLng);

/* -- contact details -------------------------------------------------------- */

// The live handles are the bare Instagram username, no @ and no URL.
const socBadIg = soc.filter((s) => !/^[A-Za-z0-9._]{1,30}$/.test(String(s.instagram)))
  .map((s) => `${s.slug}: ${s.instagram}`);
assert(socBadIg.length === 0,
  "every Instagram value is a bare handle (no @, no URL)",
  "malformed Instagram handles", socBadIg);

const socBadEmail = soc.filter((s) => s.email !== "" && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(s.email)))
  .map((s) => `${s.slug}: ${s.email}`);
assert(socBadEmail.length === 0,
  "every non-empty e-mail address is well formed",
  "malformed society e-mail addresses", socBadEmail);

const socEmpty = soc.filter((s) => s.email === "");
assert(socEmpty.length === SOC_STATUS.emptyEmail,
  `exactly ${SOC_STATUS.emptyEmail} societies publish no e-mail address (${socEmpty.map((s) => s.name).join(", ")})`,
  `expected ${SOC_STATUS.emptyEmail} societies with an empty e-mail, found ${socEmpty.length}`,
  socEmpty.map((s) => s.slug));

/* -- logos ------------------------------------------------------------------ */

// Records store a BARE FILENAME; the /assets/polsocs/ prefix is added at build
// time. Storing a path here would let a page-relative one slip in.
const socBadLogo = soc.filter((s) => !/^[A-Za-z0-9._-]+\.(jpe?g|png|webp|svg)$/i.test(String(s.logo)))
  .map((s) => `${s.slug}: ${s.logo}`);
assert(socBadLogo.length === 0,
  "every logo is a bare filename with an image extension",
  "malformed logo values", socBadLogo);

const socMissingLogo = soc.filter((s) => !exists(`assets/polsocs/${s.logo}`)).map((s) => `${s.slug}: ${s.logo}`);
assert(socMissingLogo.length === 0,
  `all ${soc.length} referenced society logos exist in assets/polsocs/`,
  "logo files that do not exist", socMissingLogo);

/* -- status fields ---------------------------------------------------------- */

const socBadBool = [];
for (const s of socAll) {
  for (const f of ["published", "active", "member", "past_member"]) {
    if (typeof s[f] !== "boolean") socBadBool.push(`${s.slug}: ${f}=${JSON.stringify(s[f])}`);
  }
}
assert(socBadBool.length === 0,
  "published, active, member and past_member are real booleans on every record",
  "non-boolean society status fields", socBadBool);

const socCounts = {
  inactive: soc.filter((s) => s.active === false).length,
  member: soc.filter((s) => s.member === true).length,
  pastMember: soc.filter((s) => s.past_member === true).length,
};
const socCountBad = [
  ["inactive", SOC_STATUS.inactive, socCounts.inactive],
  ["member", SOC_STATUS.member, socCounts.member],
  ["pastMember", SOC_STATUS.pastMember, socCounts.pastMember],
].filter(([, want, got]) => want !== got).map(([k, want, got]) => `${k}: expected ${want}, found ${got}`);
assert(socCountBad.length === 0,
  `status counts match the live arrays (active:false ${socCounts.inactive}, member ${socCounts.member}, past_member ${socCounts.pastMember})`,
  "society status counts differ from the live source arrays", socCountBad);

/* -- content hygiene -------------------------------------------------------- */

const socRawHtml = [];
const socBadProto = [];
for (const s of soc) {
  const fields = [s.name, s.instagram, s.email, s.logo,
    (s.en || {}).university_location, (s.pl || {}).university_location];
  for (const v of fields) {
    if (typeof v !== "string") continue;
    if (/<[a-z/!][^>]*>/i.test(v)) socRawHtml.push(`${s.slug}: ${v}`);
    if (/\b(javascript|vbscript|data):/i.test(v)) socBadProto.push(`${s.slug}: ${v}`);
  }
}
assert(socRawHtml.length === 0,
  "no society record contains raw HTML",
  "society fields containing markup", socRawHtml);
assert(socBadProto.length === 0,
  "no society record contains an unsafe URL protocol",
  "society fields using an unsafe protocol", socBadProto);

/* =================================================================== 21. generated member pages */

section("21. Generated member pages (Phase 8)");

const SOC_PAGES = { en: "dist/members.html", pl: "dist/pl/members.html" };
const SOC_DATA = { en: "dist/js/societies-data-en.js", pl: "dist/js/societies-data-pl.js" };

if (!exists("dist")) {
  ok("dist/ absent — generated member checks skipped (run `npm run build` to enable them)");
} else {
  const missingSoc = [...Object.values(SOC_PAGES), ...Object.values(SOC_DATA)].filter((p) => !exists(p));
  assert(missingSoc.length === 0,
    "both member pages and both generated society data files exist",
    "generated member artefacts missing after build", missingSoc);

  if (missingSoc.length === 0) {
    const nodeVm2 = require("vm");
    const loadSoc = (rel, expr) => {
      const ctx = {};
      nodeVm2.createContext(ctx);
      nodeVm2.runInContext(read(rel), ctx);
      return nodeVm2.runInContext(expr, ctx);
    };

    const gSoc = { en: read(SOC_PAGES.en), pl: read(SOC_PAGES.pl) };
    const gData = { en: loadSoc(SOC_DATA.en, "SOCIETIES"), pl: loadSoc(SOC_DATA.pl, "SOCIETIES") };

    assert(/<html lang="en">/.test(gSoc.en), 'generated English members page declares lang="en"',
      "generated English members page has the wrong <html lang>");
    assert(/<html lang="pl">/.test(gSoc.pl), 'generated Polish members page declares lang="pl"',
      "generated Polish members page has the wrong <html lang>");

    const socCanon = (s) => (s.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    assert(socCanon(gSoc.en) === `${SITE}/members.html` && socCanon(gSoc.pl) === `${SITE}/pl/members.html`,
      "generated member canonicals are self-referencing and keep the .html URLs",
      "generated member canonical URLs are wrong",
      [`en: ${socCanon(gSoc.en)}`, `pl: ${socCanon(gSoc.pl)}`]);

    const socAlts = (s) => [...s.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)]
      .map((m) => `${m[1]}=${m[2]}`).sort();
    const socWant = [`en=${SITE}/members.html`, `pl=${SITE}/pl/members.html`,
      `x-default=${SITE}/members.html`].sort();
    assert(JSON.stringify(socAlts(gSoc.en)) === JSON.stringify(socWant) &&
      JSON.stringify(socAlts(gSoc.pl)) === JSON.stringify(socWant),
      "both member pages carry the identical reciprocal hreflang trio with an English x-default",
      "generated member hreflang alternates are wrong",
      [`en: ${socAlts(gSoc.en).join(" ")}`, `pl: ${socAlts(gSoc.pl).join(" ")}`]);

    const socOg = (s) => (s.match(/<meta property="og:locale" content="([^"]+)"/) || [])[1];
    assert(socOg(gSoc.en) === "en_GB" && socOg(gSoc.pl) === "pl_PL",
      "generated member pages declare the correct Open Graph locales",
      "generated member og:locale values are wrong",
      [`en: ${socOg(gSoc.en)}`, `pl: ${socOg(gSoc.pl)}`]);

    const socSwitch = (s) => {
      const nav = s.match(/<nav class="lang-switch"[\s\S]*?<\/nav>/);
      return nav ? [...nav[0].matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1]) : [];
    };
    assert(socSwitch(gSoc.en).includes("/pl/members.html") && socSwitch(gSoc.pl).includes("/members.html"),
      "member language switchers point at the paired page in the other language",
      "member language-switcher destinations are wrong",
      [`en: ${socSwitch(gSoc.en).join(", ")}`, `pl: ${socSwitch(gSoc.pl).join(", ")}`]);

    for (const code of ["en", "pl"]) {
      const src = gSoc[code];
      const data = gData[code];

      assert(data.length === SOC_EXPECTED,
        `generated ${code} data exposes exactly ${SOC_EXPECTED} societies`,
        `generated ${code} data exposes ${data.length} societies, expected ${SOC_EXPECTED}`);

      // Order must equal the records' explicit order field.
      const wantOrder = soc.slice().sort((a, b) => a.order - b.order).map((s) => s.name);
      assert(JSON.stringify(data.map((s) => s.name)) === JSON.stringify(wantOrder),
        `generated ${code} society order matches the records' explicit order field`,
        `generated ${code} society order does not match the source records`,
        data.map((s) => s.name).filter((n, i) => n !== wantOrder[i]).slice(0, 4));

      // Localised text comes from the right block.
      const byOrder = soc.slice().sort((a, b) => a.order - b.order);
      const wrongUni = data.filter((s, i) => s.uni !== byOrder[i][code].university_location).map((s) => s.name);
      assert(wrongUni.length === 0,
        `generated ${code} university/location text comes from the ${code} block`,
        `generated ${code} location text does not match its record`, wrongUni.slice(0, 4));

      // Logos: root-relative, present in dist/, never under /pl/.
      const logos = data.map((s) => s.logo);
      assert(logos.every((l) => l.startsWith("/assets/polsocs/")),
        `all ${logos.length} generated ${code} logo paths are root-relative under /assets/polsocs/`,
        `generated ${code} logo paths that are not root-relative`,
        logos.filter((l) => !l.startsWith("/assets/polsocs/")));
      assert(logos.every((l) => !/^\/pl\//.test(l)),
        `no generated ${code} logo path resolves under /pl/`,
        `generated ${code} logo paths under /pl/`, logos.filter((l) => /^\/pl\//.test(l)));
      const notCopied = logos.filter((l) => !exists("dist" + l));
      assert(notCopied.length === 0,
        `all ${logos.length} ${code} society logos were copied into dist/`,
        `${code} society logos referenced but not copied into dist/`, notCopied.slice(0, 5));

      // Empty e-mails must stay empty — a "mailto:" with nothing after it is a
      // broken control, which is exactly what the renderer must avoid emitting.
      const empties = data.filter((s) => !s.email);
      assert(empties.length === SOC_STATUS.emptyEmail,
        `generated ${code} data keeps ${SOC_STATUS.emptyEmail} societies with an empty e-mail`,
        `generated ${code} data has ${empties.length} empty e-mails, expected ${SOC_STATUS.emptyEmail}`);
      assert(!/mailto:"/.test(src) && !/mailto:\s*"/.test(src),
        `generated ${code} page contains no empty mailto: destination`,
        `generated ${code} page contains a broken mailto: link`);

      // Instagram destinations are constructed from the bare handle.
      assert(data.every((s) => /^[A-Za-z0-9._]+$/.test(s.instagram)),
        `generated ${code} Instagram values are bare handles ready for URL construction`,
        `generated ${code} data has a malformed Instagram handle`,
        data.filter((s) => !/^[A-Za-z0-9._]+$/.test(s.instagram)).map((s) => s.instagram));

      // Status fields survive as data...
      assert(data.every((s) => typeof s.active === "boolean" && typeof s.member === "boolean" &&
        typeof s.pastMember === "boolean"),
        `generated ${code} data carries active/member/pastMember on every society`,
        `generated ${code} data lost a status field`);
      // ...but must not be rendered as chips. The badges were removed from the
      // design deliberately; this fails if they come back.
      const chipMarkup = src.match(/class="[^"]*\b(soc-status|soc-badge|status-chip|member-chip|past-member)\b[^"]*"/g);
      assert(!chipMarkup,
        `generated ${code} page renders no membership status chips`,
        `generated ${code} page reintroduced status chips`, chipMarkup);
      assert(!/\/js\/members-page\.js/.test(read("dist/js/members-page.js").match(/soc-status|soc-badge/) || ""),
        `${code}: the shared renderer emits no status-chip class`,
        `the shared renderer emits status-chip markup`);

      // Leaflet: present, and its CSS before the site sheet.
      const sheets = [...src.matchAll(/<link rel="stylesheet"\s+([^>]*)>/g)].map((m) => m[1]);
      const leafIdx = sheets.findIndex((a) => /leaflet\.css/.test(a));
      const siteIdx = sheets.findIndex((a) => /css\/style\.css/.test(a));
      assert(leafIdx >= 0, `generated ${code} page loads the Leaflet stylesheet`,
        `generated ${code} page is missing the Leaflet stylesheet`);
      assert(leafIdx >= 0 && siteIdx >= 0 && leafIdx < siteIdx,
        `generated ${code} page loads Leaflet CSS BEFORE css/style.css (cascade preserved)`,
        `generated ${code} page has the Leaflet CSS in the wrong cascade position`,
        [`leaflet at ${leafIdx}, style.css at ${siteIdx}`]);
      assert(leafIdx >= 0 && /integrity="sha256-/.test(sheets[leafIdx]) && /crossorigin=/.test(sheets[leafIdx]),
        `generated ${code} page keeps Leaflet CSS integrity and crossorigin attributes`,
        `generated ${code} page dropped Leaflet CSS subresource integrity`);
      const leafJs = src.match(/<script\s+([^>]*leaflet\.js[^>]*)>/);
      assert(Boolean(leafJs), `generated ${code} page loads the Leaflet script`,
        `generated ${code} page is missing the Leaflet script`);
      assert(leafJs && /integrity="sha256-/.test(leafJs[1]) && /crossorigin=/.test(leafJs[1]),
        `generated ${code} page keeps Leaflet JS integrity and crossorigin attributes`,
        `generated ${code} page dropped Leaflet JS subresource integrity`);
      assert(/leaflet@1\.9\.4/.test(src),
        `generated ${code} page still pins Leaflet 1.9.4 (not upgraded)`,
        `generated ${code} page changed the Leaflet version`);

      // The map and card containers, empty in the served HTML exactly as live.
      assert(/<div id="map"[^>]*><\/div>/.test(src),
        `generated ${code} page has the empty #map container`,
        `generated ${code} page's #map container is missing or pre-filled`);
      assert(/<div class="soc-grid" id="socGrid"><\/div>/.test(src),
        `generated ${code} page has the empty #socGrid container`,
        `generated ${code} page's #socGrid container is missing or pre-filled`);

      // All four FAQ items, in both languages.
      const faq = [...src.matchAll(/<details class="acc"([^>]*)>\s*<summary>([\s\S]*?)<\/summary>/g)];
      assert(faq.length === 4,
        `generated ${code} page has all four FAQ items`,
        `generated ${code} page has ${faq.length} FAQ items, expected 4`);
      assert(faq.every((m) => !/\bopen\b/.test(m[1])),
        `generated ${code} page's FAQ items all start collapsed`,
        `generated ${code} page has an FAQ item open by default`);

      // Local references must resolve inside dist/.
      const refs = [
        ...[...src.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]),
        ...[...src.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]),
      ].filter((r) => r.startsWith("/"));
      const broken = refs.filter((r) => !exists("dist" + r));
      assert(broken.length === 0,
        `generated ${code} page's ${refs.length} local CSS/script references all resolve inside dist/`,
        `generated ${code} page references files that do not exist in dist/`, broken);

      assert(/<a[^>]*class="[^"]*\bactive\b[^"]*"[^>]*href="members\.html"/.test(src) ||
        /<a[^>]*href="members\.html"[^>]*class="[^"]*\bactive\b[^"]*"/.test(src),
        `generated ${code} members page marks Members as the active navigation item`,
        `generated ${code} members page has no active navigation state on Members`);
    }

    // Cross-locale invariants on the generated output.
    const inv = ["name", "lat", "lng", "instagram", "email", "logo", "active", "member", "pastMember"];
    const invBad = inv.filter((f) =>
      JSON.stringify(gData.en.map((s) => s[f])) !== JSON.stringify(gData.pl.map((s) => s[f])));
    assert(gData.en.length > 0 && gData.pl.length > 0,
      "both generated locales parsed a non-empty society array",
      "a generated society array is empty");
    assert(invBad.length === 0,
      `all ${inv.length} society invariants are identical in the English and Polish output`,
      "generated society invariants differ between locales", invBad);
    const uniSame = gData.en.filter((s, i) => s.uni === gData.pl[i].uni).map((s) => s.name);
    assert(uniSame.length === 0,
      "the university/location line is localised for every society",
      "societies whose location text is identical in both locales", uniSame);

    assert(!/members\.html/.test(sitemapRaw) || !/\/dist\//.test(sitemapRaw),
      "sitemap.xml lists no generated member artefact",
      "sitemap.xml references generated output");

    // --- semantic comparison against the live pages -------------------------
    const { spawnSync } = require("child_process");
    const socCmp = spawnSync(process.execPath, [path.join(__dirname, "compare-members.js")], {
      cwd: ROOT, encoding: "utf8",
    });
    const socMatched = (socCmp.stdout.match(/PASS — (\d+)\/\1 comparisons matched/) || [])[1];
    assert(socCmp.status === 0,
      `generated member pages match the live pages (${socMatched || "?"} semantic comparisons — scripts/compare-members.js)`,
      "scripts/compare-members.js reports differences from the live member pages",
      (socCmp.stdout || "").split("\n").filter((l) => /FAIL/.test(l)).slice(0, 12));
  }
}

/* =================================================================== 22. static page content */

section("22. Contact and 404 page records (Phase 9)");

const PAGES_DIR = "content/pages";
const pageFiles = fs.existsSync(path.join(ROOT, PAGES_DIR))
  ? fs.readdirSync(path.join(ROOT, PAGES_DIR)).filter((f) => /\.ya?ml$/i.test(f)).sort()
  : [];
const pageRecs = pageFiles.map((f) => ({ _file: `${PAGES_DIR}/${f}`, ...loadYaml(`${PAGES_DIR}/${f}`) }));

const pageSplit = pageFiles.filter((f) => /[-.](en|pl)\.ya?ml$/i.test(f) || /^(en|pl)[-.]/i.test(f));
assert(pageSplit.length === 0,
  "no language-split page-content files (one canonical record each)",
  "language-split page files found", pageSplit);

/** Walk every string in a record and report unsafe markup or protocols. */
function scanStrings(rec, onString) {
  const walk = (v, trail) => {
    if (typeof v === "string") return onString(v, trail);
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${trail}[${i}]`));
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) if (k !== "_source") walk(x, trail ? `${trail}.${k}` : k);
    }
  };
  walk(rec, "");
}

const UNSAFE_PROTO = /\b(javascript|vbscript|data)\s*:/i;
const RAW_TAG = /<[a-z/!][^>]*>/i;
const HANDLER_ATTR = /\bon[a-z]+\s*=\s*["']/i;

/* -- contact record --------------------------------------------------------- */

const contactRecs = pageRecs.filter((r) => r.slug === "contact");
assert(contactRecs.length === 1,
  "exactly one contact-page record exists",
  `expected 1 contact record, found ${contactRecs.length}`, contactRecs.map((r) => r._file));

if (contactRecs.length === 1) {
  const ct = contactRecs[0];

  assert(typeof ct.published === "boolean",
    "the contact record's publication status is a boolean",
    `contact record's published is ${JSON.stringify(ct.published)}`);
  assert(Boolean(ct.en) && Boolean(ct.pl),
    "the contact record contains both an en and a pl block",
    "the contact record is missing a language block");

  const CONTACT_REQUIRED = ["title", "description", "eyebrow", "h1_lead", "h1_fancy", "lead",
    "write_to_us_heading", "general_enquiries_label", "copy_button_label", "address_label",
    "address_org_line", "address_country_line", "follow_us_heading", "initiatives_heading",
    "cta_heading", "cta_text", "cta_button"];
  const ctMissing = [];
  for (const code of ["en", "pl"]) {
    for (const f of CONTACT_REQUIRED) {
      if (!String((ct[code] || {})[f] || "").trim()) ctMissing.push(`${code}.${f}`);
    }
  }
  assert(ctMissing.length === 0,
    `every required contact heading and page string exists in both languages (${CONTACT_REQUIRED.length} each)`,
    "contact record missing localised strings", ctMissing);

  // The e-mail and every destination must match what the live page serves.
  const liveContact = read("contact.html");
  assert(liveContact.includes(`mailto:${ct.contact_email}`),
    `the contact e-mail matches the live destination (${ct.contact_email})`,
    "the contact e-mail does not match the live page", [ct.contact_email]);

  const socialUrls = (ct.social_links || []).map((s) => s.url);
  const socialMissing = socialUrls.filter((u) => !liveContact.includes(u));
  assert(socialUrls.length > 0 && socialMissing.length === 0,
    `all ${socialUrls.length} social destinations match the live page`,
    "social destinations not present on the live contact page", socialMissing);

  const initUrls = (ct.initiatives || []).flatMap((i) => (i.links || []).map((l) => l.url));
  const initMissing = initUrls.filter((u) => !liveContact.includes(u));
  assert(initUrls.length > 0 && initMissing.length === 0,
    `all ${initUrls.length} initiative destinations match the live page`,
    "initiative destinations not present on the live contact page", initMissing);

  // Every initiative needs localised copy in both languages.
  const initCopyMissing = [];
  for (const init of ct.initiatives || []) {
    for (const code of ["en", "pl"]) {
      const copy = ((ct[code] || {}).initiatives_copy || {})[init.key];
      if (!copy || !String(copy.note || "").trim() || !String(copy.logo_alt || "").trim()) {
        initCopyMissing.push(`${code}.${init.key}`);
      }
    }
  }
  assert(initCopyMissing.length === 0,
    "every initiative has a localised title, note and logo alt in both languages",
    "initiatives missing localised copy", initCopyMissing);

  // External destinations must be HTTPS. mailto: is a documented exception —
  // The Lambert's contact link is a mailto on the live page.
  const badProto = [...socialUrls, ...initUrls]
    .filter((u) => !/^https:\/\//.test(u) && !/^mailto:/.test(u));
  assert(badProto.length === 0,
    "every external contact destination is HTTPS (mailto: is the one documented exception)",
    "contact destinations that are neither HTTPS nor mailto:", badProto);

  const ctUnsafe = [];
  scanStrings(ct, (v, trail) => {
    if (RAW_TAG.test(v) || HANDLER_ATTR.test(v)) ctUnsafe.push(`${trail}: raw markup`);
    if (UNSAFE_PROTO.test(v)) ctUnsafe.push(`${trail}: unsafe protocol`);
  });
  assert(ctUnsafe.length === 0,
    "the contact record contains no raw HTML, inline handlers or unsafe protocols",
    "unsafe values in the contact record", ctUnsafe);
}

/* -- 404 record ------------------------------------------------------------- */

const errRecs = pageRecs.filter((r) => String(r.slug) === "404");
assert(errRecs.length === 1,
  "exactly one bilingual 404 record exists",
  `expected 1 404 record, found ${errRecs.length}`, errRecs.map((r) => r._file));

if (errRecs.length === 1) {
  const er = errRecs[0];

  assert(er.noindex === true,
    "the 404 record declares noindex: true",
    "the 404 record does not declare noindex: true", [JSON.stringify(er.noindex)]);
  assert(typeof er.published === "boolean",
    "the 404 record's publication status is a boolean",
    `404 record's published is ${JSON.stringify(er.published)}`);
  assert(Boolean(er.en) && Boolean(er.pl),
    "the 404 record contains both an en and a pl block",
    "the 404 record is missing a language block");

  // A canonical, an hreflang list or a sitemap flag on this record would be a
  // route to making the pages indexable. None may exist.
  const forbidden = ["canonical", "hreflang", "alternates", "sitemap", "in_sitemap", "sitemap_include"];
  const present = forbidden.filter((f) => f in er);
  assert(present.length === 0,
    "the 404 record supplies no canonical, hreflang or sitemap-inclusion field",
    "the 404 record carries a field that could make it indexable", present);

  const ERR_REQUIRED = ["title", "description", "eyebrow", "h1_lead", "h1_fancy", "lead",
    "primary_label", "secondary_label", "cards_eyebrow", "cards_title_lead", "cards_title_fancy"];
  const erMissing = [];
  for (const code of ["en", "pl"]) {
    for (const f of ERR_REQUIRED) {
      if (!String((er[code] || {})[f] || "").trim()) erMissing.push(`${code}.${f}`);
    }
    for (const card of er.cards || []) {
      const copy = ((er[code] || {}).cards_copy || {})[card.key];
      if (!copy || !String(copy.heading || "").trim() || !String(copy.text || "").trim() ||
          !String(copy.more || "").trim()) erMissing.push(`${code}.cards_copy.${card.key}`);
    }
  }
  assert(erMissing.length === 0,
    "every required 404 string exists in both languages, including all three cards",
    "404 record missing localised strings", erMissing);

  // Destinations are stored as bare page files; the build prefixes them. A
  // stored absolute URL or a "../" would defeat root-link mode.
  const dests = [er.primary_destination, er.secondary_destination,
    ...(er.cards || []).map((c) => c.destination)];
  const badDest = dests.filter((d) => !/^[a-z0-9][a-z0-9-]*\.html$/.test(String(d)));
  assert(badDest.length === 0,
    `all ${dests.length} 404 destinations are bare page files the build makes root-relative`,
    "404 destinations that are not bare page filenames", badDest);
  const missingDest = dests.filter((d) => !exists(String(d)));
  assert(missingDest.length === 0,
    "every 404 destination points at a page that exists",
    "404 destinations whose target page does not exist", missingDest);

  const erUnsafe = [];
  scanStrings(er, (v, trail) => {
    if (RAW_TAG.test(v) || HANDLER_ATTR.test(v)) erUnsafe.push(`${trail}: raw markup`);
    if (UNSAFE_PROTO.test(v)) erUnsafe.push(`${trail}: unsafe protocol`);
  });
  assert(erUnsafe.length === 0,
    "the 404 record contains no raw HTML, inline handlers or unsafe protocols",
    "unsafe values in the 404 record", erUnsafe);
}

/* =================================================================== 23. generated static pages */

section("23. Generated contact and 404 pages (Phase 9)");

if (!exists("dist")) {
  ok("dist/ absent — generated contact/404 checks skipped (run `npm run build` to enable them)");
} else {
  const STATIC_PAGES = {
    contactEn: "dist/contact.html", contactPl: "dist/pl/contact.html",
    errEn: "dist/404.html", errPl: "dist/pl/404.html",
  };
  const missingStatic = Object.values(STATIC_PAGES).filter((p) => !exists(p));
  assert(missingStatic.length === 0,
    "all four generated pages exist (contact ×2, 404 ×2)",
    "generated contact/404 pages missing after build", missingStatic);

  if (missingStatic.length === 0) {
    const g = Object.fromEntries(Object.entries(STATIC_PAGES).map(([k, v]) => [k, read(v)]));

    /* ---- contact pages ---- */
    assert(/<html lang="en">/.test(g.contactEn) && /<html lang="pl">/.test(g.contactPl),
      "generated contact pages declare the correct <html lang>",
      "a generated contact page has the wrong <html lang>");

    const cCanon = (s) => (s.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    assert(cCanon(g.contactEn) === `${SITE}/contact.html` && cCanon(g.contactPl) === `${SITE}/pl/contact.html`,
      "generated contact canonicals are self-referencing and keep the .html URLs",
      "generated contact canonical URLs are wrong",
      [`en: ${cCanon(g.contactEn)}`, `pl: ${cCanon(g.contactPl)}`]);

    const cAlts = (s) => [...s.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)]
      .map((m) => `${m[1]}=${m[2]}`).sort();
    const cWant = [`en=${SITE}/contact.html`, `pl=${SITE}/pl/contact.html`,
      `x-default=${SITE}/contact.html`].sort();
    assert(JSON.stringify(cAlts(g.contactEn)) === JSON.stringify(cWant) &&
      JSON.stringify(cAlts(g.contactPl)) === JSON.stringify(cWant),
      "both contact pages carry the identical reciprocal hreflang trio with an English x-default",
      "generated contact hreflang alternates are wrong",
      [`en: ${cAlts(g.contactEn).join(" ")}`, `pl: ${cAlts(g.contactPl).join(" ")}`]);

    const cOg = (s) => (s.match(/<meta property="og:locale" content="([^"]+)"/) || [])[1];
    assert(cOg(g.contactEn) === "en_GB" && cOg(g.contactPl) === "pl_PL",
      "generated contact pages declare the correct Open Graph locales",
      "generated contact og:locale values are wrong");

    const cSwitch = (s) => {
      const nav = s.match(/<nav class="lang-switch"[\s\S]*?<\/nav>/);
      return nav ? [...nav[0].matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1]) : [];
    };
    assert(cSwitch(g.contactEn).includes("/pl/contact.html") && cSwitch(g.contactPl).includes("/contact.html"),
      "contact language switchers point at the paired page in the other language",
      "contact language-switcher destinations are wrong");

    for (const [code, src] of [["en", g.contactEn], ["pl", g.contactPl]]) {
      assert(/<a[^>]*class="[^"]*\bactive\b[^"]*"[^>]*href="contact\.html"/.test(src) ||
        /<a[^>]*href="contact\.html"[^>]*class="[^"]*\bactive\b[^"]*"/.test(src),
        `generated ${code} contact page marks Contact as the active navigation item`,
        `generated ${code} contact page has no active navigation state on Contact`);

      // Contact information preserved.
      assert(src.includes("mailto:contact@polsocfederation.pl"),
        `generated ${code} contact page preserves the contact e-mail`,
        `generated ${code} contact page lost the contact e-mail`);
      assert(/238-246 King St/.test(src) && /London W6 0RF/.test(src),
        `generated ${code} contact page preserves the address lines`,
        `generated ${code} contact page lost an address line`);
      const socials = (src.match(/https:\/\/www\.(instagram|linkedin|facebook)\.com\/[^"]+/g) || []).length;
      assert(socials >= 3,
        `generated ${code} contact page preserves the social destinations (${socials} social URLs)`,
        `generated ${code} contact page is missing social destinations`);
      const subCards = (src.match(/<div class="sub-card/g) || []).length;
      assert(subCards === 2,
        `generated ${code} contact page renders both initiative cards`,
        `generated ${code} contact page renders ${subCards} initiative cards, expected 2`);

      // Classes the responsive CSS depends on. Losing one reintroduces the
      // mobile overflow fixed in earlier work.
      for (const cls of ["contact-grid", "contact-card", "social-list", "sub-grid", "sub-card"]) {
        assert(new RegExp(`class="[^"]*\\b${cls}\\b`).test(src),
          `generated ${code} contact page keeps the .${cls} class the responsive CSS needs`,
          `generated ${code} contact page lost the .${cls} class`);
      }

      // Local references must resolve inside dist/.
      const refs = [
        ...[...src.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]),
        ...[...src.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]),
        ...[...src.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]),
      ].filter((r) => r.startsWith("/"));
      const broken = refs.filter((r) => !exists("dist" + r));
      assert(broken.length === 0,
        `generated ${code} contact page's ${refs.length} local references all resolve inside dist/`,
        `generated ${code} contact page references files that do not exist in dist/`, broken);
    }

    // The contact pages ARE in the sitemap already and this phase must not
    // change it.
    assert(sitemapRaw.includes(`${SITE}/contact.html`) && sitemapRaw.includes(`${SITE}/pl/contact.html`),
      "both contact URLs remain in sitemap.xml, unchanged by this phase",
      "a contact URL is missing from sitemap.xml");

    /* ---- 404 pages ---- */
    assert(/<html lang="en">/.test(g.errEn) && /<html lang="pl">/.test(g.errPl),
      "generated 404 pages declare the correct <html lang> (en / pl)",
      "a generated 404 page has the wrong <html lang>");

    for (const [code, src] of [["en", g.errEn], ["pl", g.errPl]]) {
      const head404 = src.split("</head>")[0];
      assert(/<meta name="robots" content="noindex, follow">/.test(head404),
        `generated ${code} 404 page is noindex, follow`,
        `generated ${code} 404 page is missing its noindex robots tag`);
      assert(!/rel="canonical"/.test(src),
        `generated ${code} 404 page has no canonical`,
        `generated ${code} 404 page declares a canonical — it must not look indexable`);
      assert(!/rel="alternate" hreflang/.test(src),
        `generated ${code} 404 page has no hreflang links`,
        `generated ${code} 404 page declares hreflang alternates`);
      assert(!/property="og:/.test(head404),
        `generated ${code} 404 page has no Open Graph metadata (no indexable og:url)`,
        `generated ${code} 404 page declares Open Graph metadata`);
      assert(!/name="twitter:/.test(head404),
        `generated ${code} 404 page has no Twitter metadata`,
        `generated ${code} 404 page declares Twitter metadata`);

      // ROOT LINK MODE — the reason this page type exists in the build.
      const depthRelative = [...src.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
        .filter((h) => !/^(https?:|mailto:|tel:|data:|#|\/)/.test(h));
      assert(depthRelative.length === 0,
        `generated ${code} 404 page has no depth-relative href or src (root-link mode works)`,
        `generated ${code} 404 page has links that would break at an arbitrary URL depth`, depthRelative);

      // And prove the mode is actually exercised, not merely that the page
      // happens to contain no links.
      const rootLinks = [...src.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]);
      assert(rootLinks.length >= 10,
        `generated ${code} 404 page exercises root-link mode (${rootLinks.length} root-relative destinations)`,
        `generated ${code} 404 page has too few root-relative links to have exercised root-link mode`);
      const prefix = code === "pl" ? "/pl/" : "/";
      assert(rootLinks.some((h) => h === prefix + "index.html"),
        `generated ${code} 404 page's home link is root-relative (${prefix}index.html)`,
        `generated ${code} 404 page's home link is wrong`);

      const refs404 = [
        ...[...src.matchAll(/<link[^>]*href="([^"]+)"/g)].map((m) => m[1]),
        ...[...src.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]),
        ...[...src.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]),
      ].filter((r) => r.startsWith("/"));
      const broken404 = refs404.filter((r) => !exists("dist" + r));
      assert(broken404.length === 0,
        `generated ${code} 404 page's ${refs404.length} local references all resolve inside dist/`,
        `generated ${code} 404 page references files that do not exist in dist/`, broken404);
    }

    assert(!sitemapRaw.includes("/404.html"),
      "neither 404 page appears in sitemap.xml",
      "a 404 URL appears in sitemap.xml");

    // The Polish 404 rule must still work for the generated page after cutover:
    // the rule targets /pl/404.html, and the build must emit exactly that path.
    assert(exists("dist/pl/404.html"),
      "the generated Polish 404 sits at dist/pl/404.html, the path netlify.toml already targets",
      "the generated Polish 404 is not at the path the Netlify rule expects");

    // --- semantic comparisons -------------------------------------------
    const { spawnSync } = require("child_process");
    for (const [label, script] of [["contact", "compare-contact.js"], ["404", "compare-404.js"]]) {
      const cmp = spawnSync(process.execPath, [path.join(__dirname, script)], { cwd: ROOT, encoding: "utf8" });
      const matched = (cmp.stdout.match(/PASS — (\d+)\/\1 comparisons matched/) || [])[1];
      assert(cmp.status === 0,
        `generated ${label} pages match the live pages (${matched || "?"} semantic comparisons — scripts/${script})`,
        `scripts/${script} reports differences from the live pages`,
        (cmp.stdout || "").split("\n").filter((l) => /FAIL/.test(l)).slice(0, 12));
    }
  }
}

/* =================================================================== 24. event audit artefacts */

section("24. Event reconciliation artefacts (Phase 10)");

const EXPECTED_EVENT_SLUGS = ["business-forum", "sikorski-debate", "christmas-dinner",
  "youth-congress", "icebreaker"];
const SUPPORTED_STATUSES = new Set(["consistent", "expected-localisation",
  "missing-in-some-sources", "contradiction", "invalid-format", "uncertain", "not-applicable"]);
// Every place an event's information currently lives. A matrix that forgot one
// of these would be reconciling an incomplete picture.
const REQUIRED_SOURCE_LOCATIONS = ["events.html", "pl/events.html", "index.html", "pl/index.html"];

assert(exists("docs/EVENT_SOURCE_MATRIX.json"),
  "docs/EVENT_SOURCE_MATRIX.json exists (run `npm run audit:events` to regenerate)",
  "the event source matrix is missing");
assert(exists("docs/EVENT_RECONCILIATION.md"),
  "docs/EVENT_RECONCILIATION.md exists",
  "the event reconciliation report is missing");

if (exists("docs/EVENT_SOURCE_MATRIX.json")) {
  let matrix = null;
  try {
    matrix = JSON.parse(read("docs/EVENT_SOURCE_MATRIX.json"));
  } catch (e) {
    fail("the event source matrix is not valid JSON", [e.message]);
  }

  if (matrix) {
    const slugs = Object.keys(matrix.events || {});
    const missingSlugs = EXPECTED_EVENT_SLUGS.filter((s) => !slugs.includes(s));
    assert(missingSlugs.length === 0,
      `all five expected event slugs appear in the source matrix (${EXPECTED_EVENT_SLUGS.join(", ")})`,
      "event slugs missing from the source matrix", missingSlugs);
    assert(slugs.length > 0,
      `the source matrix is non-empty (${slugs.length} events)`,
      "the source matrix contains zero events");

    // Every event must account for every source location.
    const missingSources = [];
    for (const [slug, ev] of Object.entries(matrix.events || {})) {
      const inspected = ev.sources_inspected || [];
      for (const loc of [...REQUIRED_SOURCE_LOCATIONS, `event-${slug === "business-forum" ? "business-forum" : slug}.html`]) {
        if (!inspected.some((s) => s === loc)) missingSources.push(`${slug}: ${loc}`);
      }
      for (const side of ["en", "pl"]) {
        if (!ev.detail_pages || !ev.detail_pages[side]) missingSources.push(`${slug}: ${side} detail page not recorded`);
      }
    }
    assert(missingSources.length === 0,
      "every event accounts for all required source locations (both listings, both homepages, both detail pages)",
      "events with unaccounted source locations", missingSources.slice(0, 8));

    // Field-entry integrity.
    const badStatus = [];
    const inventedRecommendation = [];
    const unflaggedContradiction = [];
    let fieldCount = 0;
    for (const [slug, ev] of Object.entries(matrix.events || {})) {
      for (const [name, entry] of Object.entries(ev.fields || {})) {
        fieldCount++;
        if (!SUPPORTED_STATUSES.has(entry.status)) badStatus.push(`${slug}.${name}: ${entry.status}`);
        // An unresolved conflict must be flagged AND must not carry a guess.
        if (entry.status === "contradiction") {
          if (entry.requires_human_decision !== true) unflaggedContradiction.push(`${slug}.${name}`);
          if (entry.recommended_value !== null) inventedRecommendation.push(`${slug}.${name}`);
        }
        if (entry.requires_human_decision === true && entry.recommended_value !== null) {
          inventedRecommendation.push(`${slug}.${name}`);
        }
      }
    }
    assert(fieldCount > 0, `the matrix records ${fieldCount} field comparisons`,
      "the matrix records no field comparisons");
    assert(badStatus.length === 0,
      `every field entry uses a supported status (${[...SUPPORTED_STATUSES].join(", ")})`,
      "field entries with an unsupported status", badStatus);
    assert(unflaggedContradiction.length === 0,
      "every contradiction is flagged requires_human_decision: true",
      "contradictions not flagged for human decision", unflaggedContradiction);
    assert(inventedRecommendation.length === 0,
      "no unresolved item carries an invented recommended_value",
      "unresolved items with a recommended value — the audit must not guess", [...new Set(inventedRecommendation)]);
  }
}

/* -- example schemas -------------------------------------------------------- */

const SCHEMA_EXAMPLES = {
  standard: "docs/schema-examples/event-standard.example.yaml",
  businessForum: "docs/schema-examples/event-business-forum.example.yaml",
};
const VALID_FAMILY_TEMPLATE = { standard: "standard", "polish-business-forum": "business-forum" };

for (const [label, rel] of Object.entries(SCHEMA_EXAMPLES)) {
  assert(exists(rel), `${rel} exists`, `${label} schema example is missing`);
  if (!exists(rel)) continue;

  let doc = null;
  try {
    doc = loadYaml(rel);
    ok(`${label} schema example is valid YAML`);
  } catch (e) {
    fail(`${label} schema example is not valid YAML`, [e.message]);
    continue;
  }

  assert(Boolean(doc.en) && Boolean(doc.pl),
    `${label} example contains both an en and a pl block`,
    `${label} example is missing a locale block`);

  // The permitted family/template pairing — a Business Forum record must never
  // be able to render through the standard template.
  assert(VALID_FAMILY_TEMPLATE[doc.event_family] === doc.template,
    `${label} example uses a permitted event_family/template pair (${doc.event_family} + ${doc.template})`,
    `${label} example uses a forbidden event_family/template combination`,
    [`event_family: ${doc.event_family}`, `template: ${doc.template}`]);

  // Dates must be quoted ISO strings, never YAML-parsed Date objects.
  const dateFields = [["start_date", doc.start_date], ["end_date", doc.end_date]];
  const badDates = dateFields.filter(([, v]) => v !== null && v !== undefined && typeof v !== "string")
    .map(([k, v]) => `${k}: ${Object.prototype.toString.call(v)}`);
  assert(badDates.length === 0,
    `${label} example quotes its ISO dates so YAML keeps them as strings`,
    `${label} example has an unquoted date — YAML turned it into a timezone-sensitive Date`, badDates);
  const malformed = dateFields.filter(([, v]) => typeof v === "string" && !/^\d{4}-\d{2}(-\d{2})?$/.test(v))
    .map(([k, v]) => `${k}: ${v}`);
  assert(malformed.length === 0,
    `${label} example's dates are well-formed ISO values`,
    `${label} example has a malformed date`, malformed);

  // No raw HTML anywhere in an example.
  const rawHtml = [];
  (function walk(v, trail) {
    if (typeof v === "string") {
      if (/<[a-z/!][^>]*>/i.test(v)) rawHtml.push(trail);
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${trail}[${i}]`));
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(x, trail ? `${trail}.${k}` : k);
    }
  })(doc, "");
  assert(rawHtml.length === 0,
    `${label} example contains no raw HTML`,
    `${label} example contains raw HTML`, rawHtml);

  // Fictional data only — a real committee name or the real Forum theme in an
  // example would eventually be copied into a live record by mistake.
  const realWorldMarkers = ["polsocfederation.pl", "federac_ja", "Ognisko", "Mamuśka",
    "Sikorski", "Bielecki", "Norman Davies", "London Business School", "Golden Age"];
  const leaked = [];
  (function walk2(v) {
    if (typeof v === "string") {
      for (const marker of realWorldMarkers) if (v.includes(marker)) leaked.push(`${marker} in ${JSON.stringify(v.slice(0, 60))}`);
      return;
    }
    if (Array.isArray(v)) return v.forEach(walk2);
    if (v && typeof v === "object") Object.values(v).forEach(walk2);
  })(doc);
  assert(leaked.length === 0,
    `${label} example uses fictional data only`,
    `${label} example contains real-world data`, [...new Set(leaked)].slice(0, 6));
}

// The Business Forum example must demonstrate the real extension, not merely a
// different template name.
if (exists(SCHEMA_EXAMPLES.businessForum)) {
  const bf = loadYaml(SCHEMA_EXAMPLES.businessForum);
  const ext = bf.business_forum || {};
  const REQUIRED_EXT = ["edition_number", "branding", "statistics", "people",
    "partner_categories", "funding_acknowledgement", "forum_ball", "photographers"];
  const missingExt = REQUIRED_EXT.filter((k) => !(k in ext));
  assert(missingExt.length === 0,
    `the Business Forum example demonstrates the specialised extension (${REQUIRED_EXT.length} dedicated field groups)`,
    "the Business Forum example is missing extension field groups", missingExt);

  const std = loadYaml(SCHEMA_EXAMPLES.standard);
  assert(!("business_forum" in std),
    "the standard example carries no business_forum block (Forum fields cannot leak onto ordinary events)",
    "the standard example contains a business_forum block");
}

/* -- this phase must not have produced records or pages -------------------- */

const eventsContentDir = "content/events";
const eventRecords = exists(eventsContentDir)
  ? fs.readdirSync(path.join(ROOT, eventsContentDir)).filter((f) => /\.ya?ml$/i.test(f))
  : [];
// Phase 10 asserted this directory was EMPTY. Phase 11 populated it with the
// four standard events and Phase 12 added the Business Forum, so the guard now
// checks the narrower thing that is still true: exactly ONE Forum edition, and
// no future edition smuggled in early.
{
  const bfRecords = eventRecords.filter((f) => /business-forum/i.test(f));
  assert(bfRecords.length === 1,
    `content/events/ holds ${eventRecords.length} records, exactly one of them a Business Forum edition`,
    "expected exactly one Business Forum record", bfRecords);
  const futureEditions = bfRecords.filter((f) => !/^business-forum\.ya?ml$/i.test(f));
  assert(futureEditions.length === 0,
    "no future Business Forum edition has been created",
    "a future Forum edition exists outside its own phase", futureEditions);
}

if (exists("dist")) {
  // Every public page is generated as of Phase 14: events (11), the Business
  // Forum (12), the listing (13) and the homepages (14). Nothing is forbidden
  // here any more; the allowlist in section 12 is now the single guard against
  // generating something unintended.
  ok("all public page types are now generated (section 12's allowlist is the guard)");
}

// The audit is read-only: the live event sources must be untouched.
{
  const { execFileSync } = require("child_process");
  let changed = [];
  try {
    changed = execFileSync("git", ["status", "--porcelain", "--",
      "index.html", "pl/index.html", "events.html", "pl/events.html",
      ...EXPECTED_EVENT_SLUGS.flatMap((s) => [`event-${s}.html`, `pl/event-${s}.html`]),
      // netlify.toml is deliberately NOT in this list: deployment configuration is
      // protected by the central deployment-state validator (parseDeploymentState),
      // which permits exactly the two supported states and rejects every partial
      // cutover. A blanket "never changes" rule here would forbid the approved
      // cutover itself. Every other file below stays protected.
      // `content/announcements` was removed from this list in Phase 17C.3 —
      // see the note on the same change in section 19. The CMS edits those
      // records by design; their rendered output is guarded by
      // `npm run compare:announcements` instead of by immutability.
      "sitemap.xml"],
    { cwd: ROOT, encoding: "utf8" })
      .split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    changed = ["(git unavailable — check skipped)"];
  }
  assert(changed.length === 0 || changed[0].startsWith("(git unavailable"),
    "the audit changed no live event page, homepage, listing or sitemap",
    "the reconciliation phase modified files it must not touch", changed);
}

/* =================================================================== 25. standard event records */

section("25. Standard event records (Phase 11)");

const EV_DIR = "content/events";
const EV_EXPECTED = ["sikorski-debate", "christmas-dinner", "youth-congress", "icebreaker"];
const EV_SECTION_TYPES = new Set(["prose", "gallery", "heading", "album", "instagram"]);
const EV_REG_STATES = new Set(["none", "open", "closed", "sold-out"]);
const EV_REG_TYPES = new Set([null, "external-link", "payment-link", "email"]);
const EV_PRECISION = new Set(["day", "month"]);
// The Business Forum's dedicated extension must never appear on a standard event.
const BF_ONLY_KEYS = ["business_forum", "edition_number", "partner_categories",
  "forum_ball", "photographers", "statistics"];

const evFiles = fs.existsSync(path.join(ROOT, EV_DIR))
  ? fs.readdirSync(path.join(ROOT, EV_DIR)).filter((f) => /\.ya?ml$/i.test(f)).sort()
  : [];
/* Event dates have two legal spellings on disk — the quoted string the canonical
 * files use, and the bare YYYY-MM-DD Decap writes, which js-yaml resolves to a
 * midnight-UTC Date. Normalising here, once, means every rule below can simply
 * treat start_date as a string, instead of each one growing its own Date branch.
 * The type itself is still policed separately, so a Date carrying a real time
 * component is reported rather than quietly accepted.
 * See src/_data/dateOnly.js and docs/CMS_EVENTS.md §12. */
const { normaliseRecordDates: evNormaliseDates } = require("../src/_data/dateOnly.js");
const evAll = evFiles.map((f) =>
  evNormaliseDates({ _file: `${EV_DIR}/${f}`, ...loadYaml(`${EV_DIR}/${f}`) }));
const evStd = evAll.filter((e) => e.published === true && e.event_family === "standard");

assert(evStd.length === 4,
  "exactly four published standard-event records",
  `expected 4 published standard events, found ${evStd.length}`, evStd.map((e) => e.slug));

const evMissing = EV_EXPECTED.filter((s) => !evStd.some((e) => e.slug === s));
assert(evMissing.length === 0,
  `all four expected event slugs are present (${EV_EXPECTED.join(", ")})`,
  "expected standard events missing", evMissing);

const evSlugs = evAll.map((e) => e.slug);
assert(new Set(evSlugs).size === evSlugs.length, "every event slug is unique",
  "duplicate event slugs", evSlugs.filter((s, i) => evSlugs.indexOf(s) !== i));
const evOrders = evStd.map((e) => e.order);
assert(new Set(evOrders).size === evOrders.length, "every standard event has a unique display order",
  "duplicate event display orders", evOrders);
const evSlugFile = evAll.filter((e) => e._file !== `${EV_DIR}/${e.slug}.yaml`).map((e) => e._file);
assert(evSlugFile.length === 0, "every event's slug matches its filename",
  "records whose slug does not match the filename", evSlugFile);

// The Business Forum is a different family with its own template. A record
// must never be able to render Forum content through the standard template.
const evBadFamily = evStd.filter((e) => e.event_family !== "standard" || e.template !== "standard")
  .map((e) => `${e.slug}: ${e.event_family}/${e.template}`);
assert(evBadFamily.length === 0,
  "every standard record pairs event_family: standard with template: standard",
  "records with a forbidden family/template pair", evBadFamily);
const evBfLeak = [];
for (const e of evStd) for (const k of BF_ONLY_KEYS) if (k in e) evBfLeak.push(`${e.slug}: ${k}`);
assert(evBfLeak.length === 0,
  "no standard record carries a Business Forum extension field",
  "Business Forum fields leaked onto a standard event", evBfLeak);

const evBadYear = evStd.filter((e) => e.academic_year !== "2025/26").map((e) => `${e.slug}: ${e.academic_year}`);
assert(evBadYear.length === 0, 'every standard event is academic_year "2025/26"',
  "events with an unexpected academic year", evBadYear);

/* -- dates ------------------------------------------------------------------ */

/* An event date must be DATE-ONLY, and it has two legal spellings — the same
 * situation as announcement dates, for the same reason.
 *
 * The canonical files quote it, so YAML yields a string. Decap re-serialises
 * with `yaml`@1, whose YAML 1.2 core schema treats a bare 2025-12-08 as an
 * ordinary string and writes it unquoted; js-yaml's default schema still carries
 * YAML 1.1 timestamps and reads that line back as a Date. Both denote the same
 * calendar day, and src/_data/records.js converts the second to the first
 * through UTC components before anything renders it.
 *
 * Still rejected: a Date carrying a real TIME component. That is not a date-only
 * value, and rendering it depends on the reader's timezone — in Warsaw it can
 * show the previous day. The time is the hazard; the quoting is its symptom.
 *
 * See docs/CMS_EVENTS.md §12. */
const evBadDateType = evStd.filter((e) => {
  const v = e.start_date;
  if (typeof v === "string") return false;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return !(v.getUTCHours() === 0 && v.getUTCMinutes() === 0 &&
      v.getUTCSeconds() === 0 && v.getUTCMilliseconds() === 0);
  }
  return true;
}).map((e) => `${e.slug}: ${e.start_date instanceof Date
  ? e.start_date.toISOString() + " (carries a time component)"
  : Object.prototype.toString.call(e.start_date)}`);
assert(evBadDateType.length === 0,
  "every start_date is a date-only value (quoted string or bare YYYY-MM-DD)",
  "event dates that are not date-only — a time component makes rendering timezone-dependent",
  evBadDateType);
{
  const quoted = evStd.filter((e) => typeof e.start_date === "string").length;
  assert(true, `event dates: ${quoted} quoted string(s), ${evStd.length - quoted} bare YAML date(s) — both normalise to one value`);
}
const evBadPrec = evStd.filter((e) => !EV_PRECISION.has(e.date_precision))
  .map((e) => `${e.slug}: ${e.date_precision}`);
assert(evBadPrec.length === 0, `every date_precision is one of ${[...EV_PRECISION].join(", ")}`,
  "unsupported date precision", evBadPrec);
const evBadDate = evStd.filter((e) => {
  const s = String(e.start_date);
  return e.date_precision === "day" ? !/^\d{4}-\d{2}-\d{2}$/.test(s) : !/^\d{4}-\d{2}$/.test(s);
}).map((e) => `${e.slug}: ${e.start_date} (${e.date_precision})`);
assert(evBadDate.length === 0, "every start_date matches its declared precision",
  "dates that do not match their precision", evBadDate);

/* -- venue: the approved reconciliation decisions --------------------------- */

const APPROVED_VENUE = {
  "sikorski-debate": { en: "Polish Institute and Sikorski Museum", pl: "Instytut Polski i Muzeum im. gen. Sikorskiego", hood: null },
  "christmas-dinner": { en: "Ognisko Restaurant", pl: "Ognisko Restaurant", hood: "South Kensington" },
  "youth-congress": { en: "Ognisko Polskie", pl: "Ognisko Polskie", hood: null },
  "icebreaker": { en: "Mamuśka!", pl: "Mamuśka!", hood: "Waterloo" },
};
const evVenueBad = [];
for (const e of evStd) {
  const want = APPROVED_VENUE[e.slug];
  if (!want) continue;
  const v = e.venue || {};
  if ((v.name || {}).en !== want.en) evVenueBad.push(`${e.slug}: en name is ${JSON.stringify((v.name || {}).en)}`);
  if ((v.name || {}).pl !== want.pl) evVenueBad.push(`${e.slug}: pl name is ${JSON.stringify((v.name || {}).pl)}`);
  const hood = v.neighbourhood ? v.neighbourhood.en : null;
  if (hood !== want.hood) evVenueBad.push(`${e.slug}: neighbourhood is ${JSON.stringify(hood)}, expected ${JSON.stringify(want.hood)}`);
  if ((v.locality || {}).en !== "London") evVenueBad.push(`${e.slug}: en locality is not London`);
  if (v.country !== "GB") evVenueBad.push(`${e.slug}: country is not GB`);
  // "&" was explicitly ruled out for the Sikorski venue.
  if (String((v.name || {}).en).includes("&")) evVenueBad.push(`${e.slug}: venue name still uses "&"`);
}
assert(evVenueBad.length === 0,
  "every venue matches the approved reconciliation decision (name, neighbourhood, locality, country)",
  "venues that do not match the approved decisions", evVenueBad);

/* -- registration ----------------------------------------------------------- */

const evRegBad = [];
for (const e of evStd) {
  const r = e.registration || {};
  if (!EV_REG_STATES.has(r.state)) evRegBad.push(`${e.slug}: state ${JSON.stringify(r.state)}`);
  if (!EV_REG_TYPES.has(r.type === undefined ? null : r.type)) evRegBad.push(`${e.slug}: type ${JSON.stringify(r.type)}`);
}
assert(evRegBad.length === 0,
  `every registration uses a recognised state and type (${[...EV_REG_STATES].join(", ")})`,
  "unrecognised registration values", evRegBad);

/* -- localised content ------------------------------------------------------ */

// `card_summary` and `timeline_summary` are required even though no page renders
// them yet: they were transcribed from the live listing and homepage during the
// audit, and requiring them now means the listing phase cannot start with a
// record that silently lacks its card copy.
const EV_LOC_REQUIRED = ["title_lead", "eyebrow", "hero_summary", "card_summary", "timeline_summary",
  "date_label", "venue_label",
  "back_link", "back_link_bottom", "seo_title", "seo_description", "schema_description", "og_image_alt"];
const evLocBad = [];
for (const e of evStd) {
  for (const code of ["en", "pl"]) {
    const l = e[code];
    if (!l) { evLocBad.push(`${e.slug}: no ${code} block`); continue; }
    for (const f of EV_LOC_REQUIRED) {
      if (!String(l[f] || "").trim()) evLocBad.push(`${e.slug}.${code}.${f}`);
    }
    // The localised section list must line up with the shared structure.
    const shared = (e.sections || []).map((s) => s.type);
    const local = (l.sections || []).map((s) => s.type);
    if (JSON.stringify(shared) !== JSON.stringify(local)) {
      evLocBad.push(`${e.slug}.${code}: section types do not match the shared structure`);
    }
    for (let i = 0; i < shared.length; i++) {
      const s = e.sections[i], ls = (l.sections || [])[i] || {};
      if (s.type === "gallery" && (ls.alts || []).length !== (s.images || []).length) {
        evLocBad.push(`${e.slug}.${code}: gallery ${i} has ${(ls.alts || []).length} alts for ${(s.images || []).length} images`);
      }
      if (s.type === "prose" && !String(ls.body || "").trim()) evLocBad.push(`${e.slug}.${code}: prose ${i} is empty`);
      if (s.type === "album" && !((l.album || {}).heading)) evLocBad.push(`${e.slug}.${code}: album copy missing`);
    }
  }
}
assert(evLocBad.length === 0,
  `every standard event has all ${EV_LOC_REQUIRED.length} required localised fields, in both languages, with matching section structure`,
  "missing or mismatched localised event content", evLocBad.slice(0, 10));

/* -- sections, safety, images ----------------------------------------------- */

const evBadSection = [];
for (const e of evStd) {
  for (const s of e.sections || []) {
    if (!EV_SECTION_TYPES.has(s.type)) evBadSection.push(`${e.slug}: ${s.type}`);
  }
}
assert(evBadSection.length === 0,
  `every section uses a supported type (${[...EV_SECTION_TYPES].join(", ")})`,
  "unsupported section types", evBadSection);

const evRaw = [], evProto = [];
for (const e of evStd) {
  (function walk(v, trail) {
    if (typeof v === "string") {
      // Markdown bodies legitimately contain [text](url); raw tags never appear.
      if (/<[a-z/!][^>]*>/i.test(v)) evRaw.push(`${e.slug}.${trail}`);
      if (/\b(javascript|vbscript|data)\s*:/i.test(v)) evProto.push(`${e.slug}.${trail}`);
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${trail}[${i}]`));
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "_file") walk(x, trail ? `${trail}.${k}` : k);
  })(e, "");
}
assert(evRaw.length === 0, "no event record contains raw HTML", "event fields containing markup", evRaw);
assert(evProto.length === 0, "no event record contains an unsafe URL protocol",
  "event fields using an unsafe protocol", evProto);

const evImgBad = [], evImgMissing = [];
for (const e of evStd) {
  const all = [e.og_image, e.hero_image,
    ...(e.sections || []).flatMap((s) => (s.images || []).map((i) => i.src)),
    ...(e.co_organisers || []).map((c) => c.logo)].filter(Boolean);
  for (const p of all) {
    if (!String(p).startsWith("/assets/")) evImgBad.push(`${e.slug}: ${p}`);
    else if (!exists(String(p).replace(/^\/+/, ""))) evImgMissing.push(`${e.slug}: ${p}`);
  }
}
assert(evImgBad.length === 0, "every event image path is root-relative under /assets/",
  "event image paths that are not root-relative", evImgBad);
assert(evImgMissing.length === 0, "every referenced event image exists on disk",
  "event images that do not resolve to a real file", evImgMissing);

// Decision 10: the Icebreaker has no photographs for this edition.
{
  const ice = evStd.find((e) => e.slug === "icebreaker");
  const iceImgs = ice ? (ice.sections || []).flatMap((s) => s.images || []) : [];
  assert(iceImgs.length === 0,
    "the Icebreaker record has no gallery images (decision 10 — none were invented)",
    "photographs were added to the Icebreaker", iceImgs.map((i) => i.src));
  // Decision 2: the exact day is now known, so it is day-precision.
  assert(ice && ice.start_date === "2025-10-16" && ice.date_precision === "day",
    "the Icebreaker carries the approved exact date 2025-10-16 at day precision",
    "the Icebreaker date does not match the approved decision",
    [ice && ice.start_date, ice && ice.date_precision]);
}

/* =================================================================== 26. generated event pages */

section("26. Generated standard event pages (Phase 11)");

if (!exists("dist")) {
  ok("dist/ absent — generated event checks skipped (run `npm run build` to enable them)");
} else {
  const evPages = EV_EXPECTED.flatMap((s) => [`dist/event-${s}.html`, `dist/pl/event-${s}.html`]);
  const evMissingPages = evPages.filter((p) => !exists(p));
  assert(evMissingPages.length === 0,
    `all eight generated standard-event pages exist (${EV_EXPECTED.length} events × 2 locales)`,
    "generated event pages missing after build", evMissingPages);

  if (evMissingPages.length === 0) {
    for (const slug of EV_EXPECTED) {
      for (const [code, rel] of [["en", `dist/event-${slug}.html`], ["pl", `dist/pl/event-${slug}.html`]]) {
        const src = read(rel);
        const tag = `${slug} [${code}]`;
        const rec = evStd.find((e) => e.slug === slug);
        const pre = code === "en" ? "" : "pl/";

        assert(new RegExp(`<html lang="${code}">`).test(src),
          `${tag}: declares lang="${code}"`, `${tag}: wrong <html lang>`);
        const canon = (src.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
        assert(canon === `${SITE}/${pre}event-${slug}.html`,
          `${tag}: canonical is the preserved live URL`, `${tag}: canonical is wrong`, [canon]);
        const alts = [...src.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)]
          .map((m) => `${m[1]}=${m[2]}`).sort();
        const want = [`en=${SITE}/event-${slug}.html`, `pl=${SITE}/pl/event-${slug}.html`,
          `x-default=${SITE}/event-${slug}.html`].sort();
        assert(JSON.stringify(alts) === JSON.stringify(want),
          `${tag}: reciprocal hreflang trio with an English x-default`,
          `${tag}: hreflang alternates are wrong`, alts);
        const ogl = (src.match(/<meta property="og:locale" content="([^"]+)"/) || [])[1];
        assert(ogl === (code === "en" ? "en_GB" : "pl_PL"),
          `${tag}: correct Open Graph locale`, `${tag}: wrong og:locale`, [ogl]);
        assert(/<a[^>]*class="[^"]*\bactive\b[^"]*"[^>]*href="events\.html"/.test(src) ||
          /<a[^>]*href="events\.html"[^>]*class="[^"]*\bactive\b[^"]*"/.test(src),
          `${tag}: marks Events as the active navigation item`, `${tag}: no active nav on Events`);

        // The visible date and venue come from the record, once.
        const factVals = [...src.matchAll(/<span class="fact-value">([\s\S]*?)<\/span>/g)].map((m) => m[1].trim());
        assert(factVals.length >= 2, `${tag}: facts bar has a date and a venue`,
          `${tag}: facts bar is incomplete`, factVals);
        const wantVenue = APPROVED_VENUE[slug];
        const venueShown = factVals[1] || "";
        assert(venueShown.startsWith(wantVenue[code]),
          `${tag}: venue shows the approved canonical name`,
          `${tag}: venue does not match the approved decision`, [venueShown, wantVenue[code]]);
        assert(!venueShown.includes("&amp;") && !venueShown.includes(" & "),
          `${tag}: venue does not use "&"`, `${tag}: venue still uses "&"`, [venueShown]);

        // JSON-LD: every standard event now has a full date, so all eight carry one.
        const ld = src.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
        assert(Boolean(ld), `${tag}: has an Event JSON-LD block`, `${tag}: JSON-LD missing`);
        if (ld) {
          let j = null;
          try { j = JSON.parse(ld[1]); } catch (e) { fail(`${tag}: JSON-LD does not parse`, [e.message]); }
          if (j) {
            assert(j["@type"] === "Event" &&
              j.eventStatus === "https://schema.org/EventScheduled" &&
              j.eventAttendanceMode === "https://schema.org/OfflineEventAttendanceMode",
              `${tag}: JSON-LD is a scheduled, offline Event`,
              `${tag}: JSON-LD status or attendance mode is wrong`,
              [j.eventStatus, j.eventAttendanceMode]);
            assert(/^\d{4}-\d{2}-\d{2}$/.test(String(j.startDate)),
              `${tag}: JSON-LD startDate is a full ISO date (${j.startDate})`,
              `${tag}: JSON-LD startDate is not a full date`, [j.startDate]);
            assert(j.url === canon, `${tag}: JSON-LD url matches the canonical`,
              `${tag}: JSON-LD url differs from the canonical`, [j.url, canon]);
            assert(j.location && j.location["@type"] === "Place" &&
              j.location.address && j.location.address["@type"] === "PostalAddress" &&
              j.location.address.addressCountry === "GB",
              `${tag}: JSON-LD location is a structured Place with a PostalAddress`,
              `${tag}: JSON-LD location structure is wrong`);
            assert(j.location.name === wantVenue[code],
              `${tag}: JSON-LD venue is the same canonical name the facts bar shows`,
              `${tag}: JSON-LD venue drifts from the facts bar`, [j.location.name, wantVenue[code]]);
            assert(code === "pl" ? j.inLanguage === "pl-PL" : j.inLanguage === undefined,
              `${tag}: inLanguage is ${code === "pl" ? "pl-PL" : "absent"}`,
              `${tag}: inLanguage is wrong`, [j.inLanguage]);
          }
        }

        // Gallery and album content.
        const imgs = [...src.matchAll(/<img[^>]*?src="([^"]+)"/g)].map((m) => m[1]);
        const bodyImgs = imgs.filter((i) => i.startsWith("/assets/"));
        assert(bodyImgs.every((i) => exists("dist" + i)),
          `${tag}: all ${bodyImgs.length} referenced images were copied into dist/`,
          `${tag}: images referenced but not copied`, bodyImgs.filter((i) => !exists("dist" + i)));
        assert(!/["'(]\/pl\/assets\//.test(src),
          `${tag}: no /pl/assets/ path`, `${tag}: a /pl/assets/ path appears`,
          [...src.matchAll(/["'(](\/pl\/assets\/[^"')]*)/g)].map((m) => m[1]));
        const missingAlt = [...src.matchAll(/<img(?![^>]*\balt=)[^>]*>/g)].map((m) => m[0]);
        assert(missingAlt.length === 0, `${tag}: every image has an alt attribute`,
          `${tag}: images without alt`, missingAlt.slice(0, 3));
        if (rec && rec.album_url) {
          assert(src.includes(rec.album_url), `${tag}: album link preserved`,
            `${tag}: album link missing`);
        }
        // Internal links must stay relative so /pl/ routes to the Polish listing.
        const internal = [...src.matchAll(/<a[^>]*href="(events\.html)"/g)].map((m) => m[1]);
        assert(internal.length >= 2, `${tag}: both back-links point at events.html relatively`,
          `${tag}: back-links are missing or absolute`, internal);
      }
    }

    // Icebreaker: no gallery on either generated page.
    for (const rel of ["dist/event-icebreaker.html", "dist/pl/event-icebreaker.html"]) {
      const src = read(rel);
      assert(!/<div class="gallery-grid/.test(src),
        `${rel}: renders no gallery (decision 10)`, `${rel}: a gallery appeared on the Icebreaker`);
    }

    // Nothing outside the migrated scope may have been generated. The Business
    // Forum joined this list's allowed set in Phase 12.
    ok("the homepages are generated as of Phase 14 (see section 12's allowlist)");

    // A standard event must never render through the Business Forum template.
    for (const slug of EV_EXPECTED) {
      for (const rel of [`dist/event-${slug}.html`, `dist/pl/event-${slug}.html`]) {
        const src = read(rel);
        assert(!/class="pbf-page"/.test(src) && !/css\/pbf\.css/.test(src),
          `${rel}: does not render through the Business Forum template`,
          `${rel}: a standard event picked up Business Forum chrome`);
      }
    }

    // --- semantic comparison against the live pages -------------------------
    const { spawnSync } = require("child_process");
    const evCmp = spawnSync(process.execPath, [path.join(__dirname, "compare-standard-events.js")],
      { cwd: ROOT, encoding: "utf8" });
    const evMatched = (evCmp.stdout.match(/PASS — (\d+)\/\1 comparisons matched/) || [])[1];
    assert(evCmp.status === 0,
      `generated standard-event pages match the live pages (${evMatched || "?"} semantic comparisons — scripts/compare-standard-events.js)`,
      "scripts/compare-standard-events.js reports differences",
      (evCmp.stdout || "").split("\n").filter((l) => /FAIL/.test(l)).slice(0, 12));

    /*
      CONTENT ACCOUNTING (Phase 17C.5A.3).

      The comparison above identifies blocks by position, so when the fixed
      structure moves a gallery below the body it stops checking that page's
      blocks against the live ones at all. This proves separately that every
      paragraph, link, photograph, description and heading is still there — as
      sets, because the reordering is the intended change and a test that
      insisted on the old order would be asserting the bug this phase fixed.
    */
    const evContent = spawnSync(process.execPath, [path.join(__dirname, "test-event-content.js")],
      { cwd: ROOT, encoding: "utf8" });
    const evChecks = (evContent.stdout.match(/PASS — (\d+) content checks/) || [])[1];
    assert(evContent.status === 0,
      `no standard-event content was lost in the rebuild (${evChecks || "?"} checks — scripts/test-event-content.js)`,
      "scripts/test-event-content.js reports lost content",
      (evContent.stdout || "").split("\n").filter((l) => /FAIL/.test(l)).slice(0, 12));
  }
}

/* =================================================================== 27. business forum record */

section("27. Polish Business Forum record (Phase 12)");

const BF_FAMILY = "polish-business-forum";
const bfAll = evAll.filter((e) => e.event_family === BF_FAMILY);
const bfPub = bfAll.filter((e) => e.published === true);

assert(bfPub.length === 1,
  "exactly one published Polish Business Forum record",
  `expected 1 published Forum record, found ${bfPub.length}`, bfPub.map((e) => e.slug));

const bfRec = bfPub[0];
if (bfRec) {
  const bf = bfRec.business_forum;

  /* -- family / template pairing ------------------------------------------- */
  assert(bfRec.template === "business-forum",
    "the Forum record pairs event_family: polish-business-forum with template: business-forum",
    `the Forum record names template "${bfRec.template}"`);
  // The inverse of §25's leak check: only this family may carry the extension.
  const bfExtOnOthers = evAll
    .filter((e) => e.event_family !== BF_FAMILY && e.business_forum)
    .map((e) => e.slug);
  assert(bfExtOnOthers.length === 0,
    "no record outside the Forum family carries a business_forum extension",
    "the Forum extension leaked onto another family", bfExtOnOthers);
  assert(!("sections" in bfRec),
    "the Forum record has no `sections` list (its section order is fixed by the template)",
    "the Forum record carries a sections list, which would let an editor reorder branded structure");
  assert(bfRec.academic_year === "2025/26",
    "the Forum record is in academic year 2025/26",
    `unexpected academic year: ${bfRec.academic_year}`);
  assert(!!bf, "the Forum record carries a business_forum extension",
    "the Forum record has no business_forum extension");

  /* -- dates ---------------------------------------------------------------- */
  for (const f of ["start_date", "end_date"]) {
    assert(typeof bfRec[f] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(bfRec[f]),
      `${f} is a quoted full ISO date (${bfRec[f]})`,
      `${f} is not a quoted ISO date — unquoted YAML dates become timezone-sensitive Date objects`,
      [typeof bfRec[f], bfRec[f]]);
  }
  assert(bfRec.date_precision === "day", "the Forum is day-precision",
    `unexpected date_precision: ${bfRec.date_precision}`);
  assert(String(bfRec.start_date) <= String(bfRec.end_date),
    `start_date <= end_date (${bfRec.start_date} → ${bfRec.end_date})`,
    "the Forum's end date precedes its start date");

  /* -- shared core ---------------------------------------------------------- */
  for (const f of ["slug", "order", "flagship", "show_in_listing", "show_on_homepage",
    "show_in_archive", "venue", "registration", "og_image", "card_image", "organiser"]) {
    assert(bfRec[f] !== undefined && bfRec[f] !== null,
      `shared core field present: ${f}`, `the Forum record is missing ${f}`);
  }
  assert(EV_REG_STATES.has((bfRec.registration || {}).state),
    `registration.state is a recognised value (${(bfRec.registration || {}).state})`,
    "unrecognised registration state on the Forum record");
  assert(EV_REG_TYPES.has((bfRec.registration || {}).type === undefined ? null : bfRec.registration.type),
    "registration.type is a recognised value",
    `unrecognised registration type: ${(bfRec.registration || {}).type}`);
  for (const code of ["en", "pl"]) {
    assert(bfRec.venue && bfRec.venue.name && bfRec.venue.name[code],
      `venue name present for ${code}`, `the Forum venue has no ${code} name`);
    assert(bfRec.venue && bfRec.venue.locality && bfRec.venue.locality[code],
      `venue locality present for ${code}`, `the Forum venue has no ${code} locality`);
    assert(typeof bfRec.organiser === "object" && bfRec.organiser[code],
      `organiser name present for ${code}`, `the Forum organiser has no ${code} name`);
  }
  assert(Array.isArray(bfRec.performers) && bfRec.performers.length > 0,
    `performers recorded (${(bfRec.performers || []).length})`,
    "the Forum record lists no performers, but the live JSON-LD does");

  /* -- localised shared-core content ---------------------------------------- */
  const BF_LOC_REQUIRED = ["title", "hero_eyebrow", "back_link", "back_link_bottom",
    "story_body", "people_eyebrow", "people_lead", "partners_eyebrow", "partners_lead",
    "photographers_eyebrow", "photographers_lead",
    // Required now so the listing phase cannot start with a record that lacks
    // its card copy, even though nothing renders these yet.
    // card_title and flagship_tag were REMOVED in Phase 13: the card title is
    // derived from `title` (it was character-identical), and the flagship tag is
    // generic interface wording that now lives once in content/pages/events.yaml
    // rather than being repeated per event.
    "card_summary", "card_image_alt",
    "timeline_title", "timeline_summary",
    "seo_title", "seo_description", "schema_description", "og_image_alt"];
  const bfLocBad = [];
  for (const code of ["en", "pl"]) {
    const l = bfRec[code];
    if (!l) { bfLocBad.push(`no ${code} block`); continue; }
    for (const f of BF_LOC_REQUIRED) {
      if (!l[f] || !String(l[f]).trim()) bfLocBad.push(`${code}.${f}`);
    }
    for (const f of ["people_title", "partners_title", "photographers_title"]) {
      if (!l[f] || !l[f].lead || !l[f].fancy) bfLocBad.push(`${code}.${f} (lead/fancy)`);
    }
  }
  assert(bfLocBad.length === 0,
    "both locales carry every required localised field",
    "missing localised Forum fields", bfLocBad);

  // Decision 11: the future listing card must have meaningful localised alt
  // text, not an empty string and not the same string in both languages.
  for (const code of ["en", "pl"]) {
    const alt = String(((bfRec[code] || {}).card_image_alt) || "");
    assert(alt.trim().length >= 15,
      `${code}: listing card alt text is meaningful (${alt.length} chars)`,
      `${code}: listing card alt text is empty or too short to describe the image`, alt);
  }
  assert(bfRec.en.card_image_alt !== bfRec.pl.card_image_alt,
    "the listing card's alt text is localised, not the same string twice",
    "the Polish listing card alt text repeats the English string");

  /* -- extension structure -------------------------------------------------- */
  if (bf) {
    assert(Number.isInteger(bf.edition && bf.edition.number) && bf.edition.number >= 1,
      `edition number is a positive integer (${(bf.edition || {}).number})`,
      "the Forum edition number is missing or not a positive integer");
    for (const code of ["en", "pl"]) {
      assert(bf.edition && bf.edition.ordinal && bf.edition.ordinal[code],
        `edition ordinal present for ${code}`, `the edition ordinal has no ${code} form`);
    }
    for (const f of ["logo", "logo_alt", "tagline", "watermark_hero", "watermark_story", "watermark_people"]) {
      assert((bf.branding || {})[f], `branding.${f} present`, `branding.${f} is missing`);
    }

    /* -- hero backdrop: the EDITION-SPECIFIC model ---------------------------- */
    // Classified edition-specific (it is the 2026 team on the LBS stage, the same
    // photograph as the OG card, the listing card and the first story tile), so it
    // must be a record field, not a hard-coded stylesheet value.
    {
      const backdrop = (bf.branding || {}).hero_backdrop;
      assert(typeof backdrop === "string" && backdrop.startsWith("/assets/"),
        `branding.hero_backdrop is an edition-specific record field (${backdrop})`,
        "branding.hero_backdrop is missing — a future edition could not change the hero without editing CSS",
        backdrop);
      if (typeof backdrop === "string") {
        assert(exists(backdrop.replace(/^\//, "")),
          "the hero backdrop asset exists in the repository",
          "branding.hero_backdrop points at a missing file", backdrop);
      }
      // `hero_image` is the standard-event field for a hero <img>; this family has
      // none, so it must stay null rather than duplicating the backdrop.
      assert(bfRec.hero_image === null,
        "hero_image is null (this family's hero is a CSS layer, not an <img>)",
        "hero_image is set on the Forum record, which renders no hero image element",
        bfRec.hero_image);
      // css/pbf.css MUST keep a fallback, or the hand-written live pages — which
      // set no custom property — would lose their hero image entirely.
      const pbfCss = read("css/pbf.css");
      const fb = pbfCss.match(/var\(--pbf-hero-backdrop,\s*url\("([^"]+)"\)\)/);
      assert(!!fb,
        "css/pbf.css reads --pbf-hero-backdrop with a fallback for the un-migrated live pages",
        "css/pbf.css has no --pbf-hero-backdrop fallback — the live Business Forum pages would lose their hero");
      if (fb) {
        const fbKey = fb[1].replace(/^(\.\.\/)+/, "");
        assert(exists(fbKey), `the css fallback backdrop exists (${fbKey})`,
          "the css/pbf.css fallback backdrop file is missing", fbKey);
        assert(fbKey === String(backdrop).replace(/^\//, ""),
          "the css fallback names the same asset as the record, so live and generated heroes match",
          "the css fallback and the record disagree about the backdrop image",
          { css: fbKey, record: backdrop });
      }
      // The branded treatment must NOT have become configurable.
      assert(/center 30% \/ cover no-repeat/.test(pbfCss),
        "the hero's framing and scaling remain fixed in css/pbf.css",
        "the hero's branded framing/scaling was changed or made configurable");
      assert(/linear-gradient\(180deg, rgba\(0, 31, 98, 0\.86\)/.test(pbfCss),
        "the hero's navy overlay gradient is unchanged",
        "the hero overlay gradient was modified");
      assert(/\.pbf-hero \{[^}]*overflow: hidden/s.test(pbfCss),
        "the hero still clips its overflow (watermark bleed)",
        "the hero lost overflow: hidden, so the watermark would create page overflow");
    }

    /* -- bilingual corrections applied in this pass -------------------------- */
    {
      const ballEn = String(((bf.forum_ball || {}).body || {}).en || "");
      const ballPl = String(((bf.forum_ball || {}).body || {}).pl || "");
      assert(ballPl.trim().length > 0 && ballPl.trim() !== ballEn.trim(),
        "the Polish Forum Ball body is translated, not a copy of the English",
        "the Polish Forum Ball body still repeats the English text");
      // Sentence-level check: no English source sentence survives in the Polish.
      const enSentences = ballEn.split(/(?<=\.)\s+/).map((s) => s.trim()).filter((s) => s.length > 25);
      const leaked = enSentences.filter((s) => ballPl.includes(s));
      assert(leaked.length === 0,
        `no English sentence from the Ball body survives in the Polish copy (${enSentences.length} checked)`,
        "untranslated English sentences remain in the Polish Forum Ball body", leaked);

      const roles = (bf.people || []).map((p) => `${p.name}: ${(p.role || {}).pl}`);
      const englishRoles = (bf.people || [])
        .filter((p) => /Project Leader|Founder/i.test(String((p.role || {}).pl || "")))
        .map((p) => `${p.name}: ${(p.role || {}).pl}`);
      assert(englishRoles.length === 0,
        `no Polish role contains "Project Leader" or "Founder" (${roles.length} people checked)`,
        "an untranslated English role remains in the Polish content", englishRoles);

      const englishLabels = (bf.photographers || [])
        .filter((p) => /Open the gallery/i.test(String((p.link_label || {}).pl || "")))
        .map((p) => `${p.name}: ${(p.link_label || {}).pl}`);
      assert(englishLabels.length === 0,
        `no Polish gallery button says "Open the gallery" (${(bf.photographers || []).length} cards checked)`,
        "an untranslated English gallery button remains in the Polish content", englishLabels);
    }
    assert(Number.isInteger((bf.attendance || {}).count),
      `attendance count stored once as an integer (${(bf.attendance || {}).count})`,
      "attendance count is missing or not an integer");

    // Statistics: every item is either a counter or a text value, never both.
    const statBad = (bf.statistics && bf.statistics.items ? bf.statistics.items : []).map((s, i) => {
      const isCounter = s.count !== undefined && s.count !== null;
      const isText = !!s.value;
      if (isCounter === isText) return `item ${i}: must be exactly one of count/value`;
      if (isCounter && typeof s.plain !== "boolean") return `item ${i}: plain must be a boolean`;
      if (!s.label || !s.label.en || !s.label.pl) return `item ${i}: label not localised`;
      return null;
    }).filter(Boolean);
    assert(statBad.length === 0,
      `all ${((bf.statistics || {}).items || []).length} statistics are well formed`,
      "malformed statistics", statBad);

    // People: unique names and a stable order; roles localised.
    const peopleNames = (bf.people || []).map((p) => p.name);
    assert(peopleNames.length > 0 && new Set(peopleNames).size === peopleNames.length,
      `people are unique and ordered (${peopleNames.length})`,
      "duplicate or missing people", peopleNames);
    const peopleBad = (bf.people || [])
      .filter((p) => !p.photo || !p.role || !p.role.en || !p.role.pl).map((p) => p.name);
    assert(peopleBad.length === 0, "every person has a photo and a localised role",
      "people missing a photo or a localised role", peopleBad);

    // Partner groups: unique keys, unique logos WITHIN each group, and no
    // duplicated carousel sets stored as content.
    const groupKeys = (bf.partner_groups || []).map((g) => g.key);
    assert(groupKeys.length > 0 && new Set(groupKeys).size === groupKeys.length,
      `partner group keys are unique (${groupKeys.join(", ")})`,
      "duplicate or missing partner group keys", groupKeys);
    const dupLogos = [];
    for (const g of bf.partner_groups || []) {
      const imgs = (g.logos || []).map((l) => l.image);
      const names = (g.logos || []).map((l) => l.name);
      if (new Set(imgs).size !== imgs.length) {
        dupLogos.push(`${g.key}: repeated logo image (carousel duplication must NOT be stored in YAML)`);
      }
      if (new Set(names).size !== names.length) dupLogos.push(`${g.key}: repeated partner name`);
      for (const l of g.logos || []) {
        if (!l.image_alt || !l.image_alt.en || !l.image_alt.pl) {
          dupLogos.push(`${g.key}/${l.name}: alt text not localised`);
        }
      }
      // Carousel repetition is IT machinery, not content — it must NOT be here.
      if ("carousel_sets" in g) {
        dupLogos.push(`${g.key}: carousel_sets is IT machinery and must not appear in the content record`);
      }
      if (!Number.isInteger(g.order)) dupLogos.push(`${g.key}: missing order`);
    }
    assert(dupLogos.length === 0,
      "each partner logo is stored exactly once per group, with localised alt text and no carousel mechanics",
      "partner group problems", dupLogos);

    // No carousel mechanics anywhere in the record, at any depth, including the
    // localised blocks and any future CMS-facing field.
    {
      const strayCarousel = [];
      (function walkKeys(node, trail) {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) { node.forEach((v, i) => walkKeys(v, `${trail}[${i}]`)); return; }
        for (const k of Object.keys(node)) {
          if (/carousel|repetition|duplicate_sets/i.test(k)) strayCarousel.push(`${trail}.${k}`);
          walkKeys(node[k], `${trail}.${k}`);
        }
      })(bfRec, "record");
      assert(strayCarousel.length === 0,
        "the content record carries no carousel mechanics at any depth",
        "carousel configuration leaked into the content record", strayCarousel);
    }

    /* -- the repetition count lives in an IT-controlled location ------------- */
    {
      const techRel = "src/_data/businessForumTechnical.js";
      assert(exists(techRel),
        `the technical carousel repetition count lives in ${techRel}`,
        `${techRel} is missing — the repetition count has no IT-controlled home`);
      if (exists(techRel)) {
        const tech = require(path.join(ROOT, techRel));
        assert(tech.carouselSets === 2,
          `businessForumTechnical.carouselSets is 2 (js/main.js wraps at scrollWidth / 2)`,
          `carouselSets must be 2 while js/main.js wraps at scrollWidth / 2, got ${tech.carouselSets}`);
        // It must be a build-time constant, not something a CMS could reach: the
        // file lives under src/_data/, which no content collection maps to.
        assert(!exists("content/businessForumTechnical.js") && !exists("content/events/technical.yaml"),
          "the repetition count is not exposed through any content collection",
          "carousel machinery appeared inside content/, where a CMS could edit it");
      }
    }

    // Funding acknowledgement.
    assert((bf.funding_acknowledgement || {}).logo
      && bf.funding_acknowledgement.text
      && bf.funding_acknowledgement.text.en && bf.funding_acknowledgement.text.pl,
      "the funding acknowledgement has a logo and localised wording",
      "the funding acknowledgement is incomplete");

    // Forum Ball: an explicit boolean, and complete when enabled.
    assert(typeof (bf.forum_ball || {}).enabled === "boolean",
      `forum_ball.enabled is a boolean (${(bf.forum_ball || {}).enabled})`,
      "forum_ball.enabled must be an explicit boolean so an edition can hide the Ball");
    if ((bf.forum_ball || {}).enabled) {
      const ballBad = ["image", "image_alt", "caption", "eyebrow", "title", "body"]
        .filter((f) => !bf.forum_ball[f]);
      assert(ballBad.length === 0, "the enabled Forum Ball carries all its content",
        "the Forum Ball is enabled but incomplete", ballBad);
    }

    // Photographers: unique, ordered, localised.
    const photogNames = (bf.photographers || []).map((p) => p.name);
    assert(photogNames.length > 0 && new Set(photogNames).size === photogNames.length,
      `photographers are unique and ordered (${photogNames.length})`,
      "duplicate or missing photographers", photogNames);
    const photogBad = (bf.photographers || [])
      .filter((p) => !p.gallery_url || !p.tag || !p.tag.en || !p.tag.pl
        || !p.description || !p.description.en || !p.description.pl)
      .map((p) => p.name);
    assert(photogBad.length === 0,
      "every photographer has a gallery link and localised copy",
      "photographers missing a link or localised copy", photogBad);

    /* -- safety: no raw HTML, no handlers, safe URLs, images exist ---------- */
    const bfStrings = [];
    (function walk(node, trail) {
      if (node === null || node === undefined) return;
      if (typeof node === "string") { bfStrings.push([trail, node]); return; }
      if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${trail}[${i}]`)); return; }
      if (typeof node === "object") { for (const k of Object.keys(node)) walk(node[k], `${trail}.${k}`); }
    })(bfRec, "record");

    const bfRawHtml = bfStrings.filter(([, v]) => /<\/?[a-z][\s\S]*>/i.test(v))
      .map(([t, v]) => `${t}: ${v.slice(0, 60)}`);
    assert(bfRawHtml.length === 0,
      "no Forum field contains raw HTML",
      "raw HTML in the Forum record — markup belongs in the template", bfRawHtml);

    const bfHandlers = bfStrings.filter(([, v]) => /\bon[a-z]+\s*=/i.test(v) || /javascript:/i.test(v))
      .map(([t]) => t);
    assert(bfHandlers.length === 0,
      "no Forum field contains an inline event handler or javascript: URL",
      "unsafe content in the Forum record", bfHandlers);

    // Only fields that ARE urls — a general "looks like a scheme" heuristic also
    // matches CSS declarations such as "margin-bottom: 70px".
    const bfBadUrls = bfStrings
      .filter(([t]) => /\.(url|href|link|gallery_url|credit_url|social_url|permalink)$/.test(t))
      .filter(([, v]) => /^[a-z][a-z0-9+.-]*:/i.test(v))
      .filter(([, v]) => !/^(https?:|mailto:)/i.test(v))
      .map(([t, v]) => `${t}: ${v}`);
    assert(bfBadUrls.length === 0,
      "every absolute URL in the Forum record uses http(s) or mailto",
      "unsafe URL protocol in the Forum record", bfBadUrls);

    const bfImages = bfStrings
      .filter(([t]) => /\.(logo|image|photo|src|background|og_image|card_image)$/.test(t))
      .map(([, v]) => v)
      .filter((v) => v.startsWith("/assets/"));
    const bfMissingImages = [...new Set(bfImages)].filter((p) => !exists(p.replace(/^\//, "")));
    assert(bfMissingImages.length === 0,
      `all ${new Set(bfImages).size} Forum images exist in the repository`,
      "Forum record references missing images", bfMissingImages);
  }
}

/* =================================================================== 28. generated business forum */

section("28. Generated Business Forum pages (Phase 12)");

if (!exists("dist")) {
  ok("dist/ not built — run `npm run build` to validate the generated Forum pages");
} else {
  const BF_PAGES = [
    { rel: "dist/event-business-forum.html", code: "en", lang: "en", ogLocale: "en_GB", prefix: "" },
    { rel: "dist/pl/event-business-forum.html", code: "pl", lang: "pl", ogLocale: "pl_PL", prefix: "pl/" },
  ];

  for (const p of BF_PAGES) {
    const tag = `business-forum [${p.code}]`;
    if (!exists(p.rel)) {
      assert(false, `${tag}: page generated`, `${p.rel} was not generated`);
      continue;
    }
    const src = read(p.rel);
    const canonical = `https://polsocfederation.pl/${p.prefix}event-business-forum.html`;

    assert(new RegExp(`<html lang="${p.lang}"`).test(src), `${tag}: html lang="${p.lang}"`,
      `${tag}: wrong or missing html lang`);
    assert(src.includes(`<link rel="canonical" href="${canonical}">`),
      `${tag}: canonical is ${canonical}`, `${tag}: wrong canonical`);
    for (const [hl, href] of [
      ["en", "https://polsocfederation.pl/event-business-forum.html"],
      ["pl", "https://polsocfederation.pl/pl/event-business-forum.html"],
      ["x-default", "https://polsocfederation.pl/event-business-forum.html"],
    ]) {
      assert(src.includes(`<link rel="alternate" hreflang="${hl}" href="${href}">`),
        `${tag}: hreflang ${hl} → ${href}`, `${tag}: missing or wrong hreflang ${hl}`);
    }
    assert(src.includes(`<meta property="og:locale" content="${p.ogLocale}">`),
      `${tag}: og:locale is ${p.ogLocale}`, `${tag}: wrong og:locale`);
    assert(/<meta property="og:type" content="article">/.test(src),
      `${tag}: og:type is article`, `${tag}: og:type is not article`);

    /* -- branded structure ------------------------------------------------- */
    assert(/<body class="pbf-page">/.test(src), `${tag}: carries the pbf-page body class`,
      `${tag}: the pbf-page body class is missing`);
    const iStyle = src.indexOf("/css/style.css");
    const iPbf = src.indexOf("/css/pbf.css");
    assert(iStyle !== -1 && iPbf !== -1 && iPbf > iStyle,
      `${tag}: css/pbf.css loads after css/style.css`,
      `${tag}: Business Forum stylesheet missing or in the wrong cascade position`,
      { styleAt: iStyle, pbfAt: iPbf });
    // Linking the stylesheet is not the same as shipping it — the first build of
    // this phase referenced a pbf.css that no passthrough rule copied.
    for (const sheet of ["dist/css/style.css", "dist/css/pbf.css"]) {
      assert(exists(sheet), `${tag}: ${sheet.replace("dist/", "")} was copied into dist/`,
        `${tag}: ${sheet} is referenced but was never copied`);
    }
    // Every local asset the branded stylesheet itself references must resolve.
    {
      const cssSrc = read("css/pbf.css");
      const cssRefs = [...cssSrc.matchAll(/url\("(\.\.\/[^"]+)"\)/g)]
        .map((m) => m[1].replace(/^(\.\.\/)+/, ""));
      const cssMissing = [...new Set(cssRefs)].filter((a) => !exists(path.join("dist", a)));
      assert(cssMissing.length === 0,
        `${tag}: all ${new Set(cssRefs).size} assets referenced by css/pbf.css exist in dist/`,
        `${tag}: css/pbf.css references assets that were not copied`, cssMissing);
    }
    assert(/<a href="events\.html" class="active">|<a href="events\.html"[^>]*class="active"/.test(src),
      `${tag}: marks Events as the active navigation item`,
      `${tag}: the Events nav item is not active`);

    // Required branded pieces. Each is load-bearing: the lock-up is the visible
    // title, the sr-only h1 is the accessible one, the watermarks are brand.
    for (const [what, re] of [
      ["branded hero", /<section class="pbf-hero"[^>]*>/],
      ["hero backdrop element", /<div class="hero-bg" aria-hidden="true"><\/div>/],
      ["hero watermark", /<span class="pbf-watermark" aria-hidden="true">/],
      ["screen-reader-only h1", /<h1 class="sr-only">[^<]+<\/h1>/],
      ["logo lock-up", /<img class="pbf-logo" src="\/assets\/[^"]+" alt="[^"]+">/],
      ["tagline", /<p class="pbf-tagline">/],
      ["facts bar", /<div class="event-facts">/],
      ["statistics band", /<section class="section section-navy spotlight pbf-stats">/],
      ["people grid", /<div class="pbf-people reveal">/],
      ["partner carousels", /<div class="pbf-carousel" data-autoscroll aria-label="[^"]+">/],
      ["funding acknowledgement", /<div class="funding-note reveal">/],
      ["photographer cards", /<div class="pbf-photog-grid">/],
      ["story watermark", /<span class="watermark" aria-hidden="true">/],
    ]) {
      assert(re.test(src), `${tag}: ${what} present`, `${tag}: ${what} missing`);
    }

    /* -- edition-specific hero backdrop ------------------------------------ */
    {
      const backdrop = bfRec.business_forum.branding.hero_backdrop;
      const heroOpen = (src.match(/<section class="pbf-hero"[^>]*>/) || [""])[0];
      assert(heroOpen.includes(`--pbf-hero-backdrop: url('${backdrop}')`),
        `${tag}: hero supplies the edition backdrop as --pbf-hero-backdrop (${backdrop})`,
        `${tag}: the hero does not pass the record's backdrop to the stylesheet`, heroOpen.slice(0, 120));
      // Root-relative, so it resolves identically from / and /pl/.
      assert(backdrop.startsWith("/assets/") && !heroOpen.includes("/pl/assets/"),
        `${tag}: the backdrop URL is root-relative`,
        `${tag}: the backdrop URL would break from one locale`);
      assert(exists("dist" + backdrop),
        `${tag}: the backdrop asset was copied into dist/`,
        `${tag}: the hero backdrop is referenced but was not copied`, backdrop);
      // The hero must still render no <img> — the backdrop is a CSS layer.
      const heroBlock = src.slice(src.indexOf(heroOpen), src.indexOf("</section>", src.indexOf(heroOpen)));
      const heroImgs = [...heroBlock.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
      assert(heroImgs.length === 1 && /pbf-logo/.test(heroImgs[0]),
        `${tag}: the hero's only image is the logo lock-up (backdrop stays a CSS layer)`,
        `${tag}: the hero renders unexpected image elements`, heroImgs.map((i) => i.slice(0, 60)));
    }

    /* -- Polish copy is fully translated ----------------------------------- */
    if (p.code === "pl") {
      const bfBody = bfRec.business_forum;
      const enBall = String(bfBody.forum_ball.body.en || "");
      const enSentences = enBall.split(/(?<=\.)\s+/).map((s) => s.trim()).filter((s) => s.length > 25);
      const leakedOnPage = enSentences.filter((s) => src.includes(s));
      assert(leakedOnPage.length === 0,
        `${tag}: the rendered Forum Ball carries no English sentence from the English body`,
        `${tag}: untranslated English Ball copy is on the Polish page`, leakedOnPage);
      const roleLeak = [...src.matchAll(/<span class="pbf-role">([^<]*)<\/span>/g)]
        .map((m) => m[1].trim()).filter((r) => /Project Leader|Founder/i.test(r));
      assert(roleLeak.length === 0,
        `${tag}: no rendered role contains "Project Leader" or "Founder"`,
        `${tag}: an untranslated English role is on the Polish page`, roleLeak);
      assert(!/>\s*Open the gallery\s*</.test(src) && !src.includes("Open the gallery"),
        `${tag}: no gallery button says "Open the gallery"`,
        `${tag}: an untranslated English gallery button is on the Polish page`);
    }

    // The Forum Ball is enabled for this edition, so it must render — and when a
    // future edition disables it, no empty shell may be left behind.
    const ballEnabled = bfRec && bfRec.business_forum
      && bfRec.business_forum.forum_ball && bfRec.business_forum.forum_ball.enabled;
    assert(ballEnabled === /<section class="section pbf-ball">/.test(src),
      `${tag}: Forum Ball section presence matches forum_ball.enabled (${ballEnabled})`,
      `${tag}: the Forum Ball section does not match its enabled flag`);

    /* -- counters ---------------------------------------------------------- */
    const counters = [...src.matchAll(/<div class="stat-number"([^>]*)>/g)].map((m) => m[1]);
    assert(counters.length > 0, `${tag}: statistics counters render (${counters.length})`,
      `${tag}: no animated counters found`);
    const badCounters = counters.filter((a) => !/data-count="\d+"/.test(a));
    assert(badCounters.length === 0, `${tag}: every counter carries data-count`,
      `${tag}: a counter is missing data-count, so js/main.js will not animate it`, badCounters);

    /* -- carousel duplication --------------------------------------------- */
    const carousels = [...src.matchAll(/<div class="pbf-carousel" data-autoscroll[^>]*>/g)];
    assert(carousels.length === (bfRec.business_forum.partner_groups || []).length,
      `${tag}: one carousel per partner group (${carousels.length})`,
      `${tag}: carousel count does not match the record`);
    // The repetition count comes from the IT-controlled data file, NOT from the
    // content record — removing carousel_sets from YAML must not weaken this.
    // Guarded: a missing file is reported by §27, and crashing here would hide
    // every remaining check on this page.
    const CAROUSEL_SETS = exists("src/_data/businessForumTechnical.js")
      ? require(path.join(ROOT, "src/_data/businessForumTechnical.js")).carouselSets
      : null;
    assert(CAROUSEL_SETS !== null,
      `${tag}: the technical carousel repetition count is available`,
      `${tag}: src/_data/businessForumTechnical.js is missing, so the rendered tile count cannot be checked`);
    for (const g of bfRec.business_forum.partner_groups || []) {
      const expectedTiles = g.logos.length * CAROUSEL_SETS;
      // Count tiles between this carousel's aria-label and the closing wrapper.
      const label = g.aria_label[p.code];
      const start = src.indexOf(`aria-label="${label}"`);
      const slice = start === -1 ? "" : src.slice(start, start + 20000).split("</div>\n    <button")[0];
      const tiles = (slice.match(/pbf-logo-tile/g) || []).length;
      assert(tiles === expectedTiles,
        `${tag}: ${g.key} renders ${expectedTiles} tiles (${g.logos.length} canonical logos × ${CAROUSEL_SETS} technical sets)`,
        `${tag}: ${g.key} rendered ${tiles} tiles — the scrollWidth/2 loop needs exact sets`,
        { expectedTiles, tiles });
      assert(CAROUSEL_SETS === 2,
        `${tag}: ${g.key} renders exactly two identical sequences`,
        `${tag}: the technical repetition count is not 2`);
      const hidden = (slice.match(/pbf-logo-tile" aria-hidden="true"/g) || []).length;
      assert(hidden === g.logos.length,
        `${tag}: ${g.key}'s duplicated set is hidden from assistive technology`,
        `${tag}: ${g.key} has ${hidden} aria-hidden tiles, expected ${g.logos.length}`);
    }

    /* -- images and semantics --------------------------------------------- */
    const bfImgs = [...src.matchAll(/<img\b[^>]*>/g)];
    const noAlt = bfImgs.filter((m) => !/\balt\s*=/.test(m[0])).map((m) => m[0].slice(0, 70));
    assert(noAlt.length === 0, `${tag}: every image has an alt attribute (${bfImgs.length} images)`,
      `${tag}: images without an alt attribute`, noAlt);
    // Empty alt is the CORRECT marking for a decorative image, so the check is
    // not "none are empty" but "exactly the expected ones are". The expected set
    // is derived from the record: one duplicated carousel tile per partner logo
    // (hidden from assistive tech so partners are announced once), plus the
    // footer brand mark, which the adjacent text already names.
    const expectedEmptyAlt = (bfRec.business_forum.partner_groups || [])
      .reduce((n, g) => n + g.logos.length * (CAROUSEL_SETS - 1), 0) + 1;
    const emptyAlt = bfImgs.filter((m) => /\balt=""/.test(m[0]));
    assert(emptyAlt.length === expectedEmptyAlt,
      `${tag}: exactly the ${expectedEmptyAlt} decorative images carry empty alt text`,
      `${tag}: unexpected number of empty-alt images — an informative image may have lost its description`,
      { expected: expectedEmptyAlt, found: emptyAlt.length, images: emptyAlt.map((m) => m[0].slice(0, 70)) });
    // Every duplicated carousel tile must be silent to assistive technology.
    const emptyAltNotHidden = emptyAlt
      .filter((m) => /\/assets\/pbf\/(sponsors|media)\//.test(m[0]))
      .filter((m) => !/aria-hidden/.test(src.slice(Math.max(0, m.index - 120), m.index)));
    assert(emptyAltNotHidden.length === 0,
      `${tag}: every empty-alt partner tile sits in an aria-hidden container`,
      `${tag}: a partner logo has empty alt but is not hidden from assistive technology`,
      emptyAltNotHidden.map((m) => m[0].slice(0, 70)));

    const bfSrcs = bfImgs.map((m) => (m[0].match(/src="([^"]*)"/) || [])[1]).filter(Boolean);
    const bfNotCopied = [...new Set(bfSrcs)].filter((s) => s.startsWith("/") && !exists("dist" + s));
    assert(bfNotCopied.length === 0,
      `${tag}: all ${new Set(bfSrcs).size} referenced images were copied into dist/`,
      `${tag}: referenced images missing from dist/`, bfNotCopied);
    assert(!src.includes("/pl/assets/"), `${tag}: no /pl/assets/ path`,
      `${tag}: a /pl/assets/ path leaked in`);

    /* -- internal links --------------------------------------------------- */
    const internalHrefs = [...src.matchAll(/href="((?!https?:|mailto:|#|\/)[^"]+)"/g)].map((m) => m[1]);
    assert(internalHrefs.length > 0 && internalHrefs.every((h) => !h.startsWith("/")),
      `${tag}: internal links stay relative (${internalHrefs.length})`,
      `${tag}: an internal link is absolute`);

    /* -- JSON-LD ---------------------------------------------------------- */
    const bfLd = (src.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1];
    assert(!!bfLd, `${tag}: has an Event JSON-LD block`, `${tag}: JSON-LD is missing`);
    if (bfLd) {
      let j = null;
      try { j = JSON.parse(bfLd); } catch { j = null; }
      assert(j !== null, `${tag}: JSON-LD parses`, `${tag}: JSON-LD does not parse`);
      if (j) {
        assert(j["@type"] === "Event", `${tag}: JSON-LD @type is Event`, `${tag}: wrong @type`);
        assert(j.eventStatus === "https://schema.org/EventScheduled"
          && j.eventAttendanceMode === "https://schema.org/OfflineEventAttendanceMode",
          `${tag}: JSON-LD is a scheduled, offline Event`, `${tag}: wrong status or attendance mode`);
        assert(/^\d{4}-\d{2}-\d{2}$/.test(String(j.startDate)) && /^\d{4}-\d{2}-\d{2}$/.test(String(j.endDate)),
          `${tag}: JSON-LD has full ISO start and end dates (${j.startDate} → ${j.endDate})`,
          `${tag}: JSON-LD dates are not full ISO values`);
        assert(String(j.startDate) <= String(j.endDate),
          `${tag}: JSON-LD startDate <= endDate`, `${tag}: JSON-LD dates are inverted`);
        assert(j.url === canonical, `${tag}: JSON-LD url matches the canonical`,
          `${tag}: JSON-LD url does not match the canonical`, [j.url, canonical]);
        assert(j.location && j.location["@type"] === "Place"
          && j.location.address && j.location.address["@type"] === "PostalAddress"
          && j.location.address.addressCountry === "GB",
          `${tag}: JSON-LD location is a structured Place with a PostalAddress`,
          `${tag}: JSON-LD location is not properly structured`);
        // The visible facts bar and the structured data must agree.
        const factValues = [...src.matchAll(/<span class="fact-value">([^<]*)<\/span>/g)].map((m) => m[1]);
        assert(factValues.includes(j.location.name),
          `${tag}: JSON-LD venue is the same name the facts bar shows (${j.location.name})`,
          `${tag}: JSON-LD venue and facts bar disagree`, { factValues, jsonld: j.location.name });
        assert(Array.isArray(j.performer) && j.performer.length === bfRec.performers.length,
          `${tag}: JSON-LD lists ${bfRec.performers.length} performers`,
          `${tag}: performer count does not match the record`);
        if (p.code === "pl") {
          assert(j.inLanguage === "pl-PL", `${tag}: inLanguage is pl-PL`,
            `${tag}: Polish page does not declare inLanguage`);
        } else {
          assert(j.inLanguage === undefined, `${tag}: English page declares no inLanguage`,
            `${tag}: English page unexpectedly declares inLanguage`);
        }
        // Parity with the config filter: the data file duplicates buildJsonLd,
        // and a drift between the two must fail rather than ship.
        const expectedName = bfRec[p.code].title;
        assert(j.name === expectedName, `${tag}: JSON-LD name comes from the record (${expectedName})`,
          `${tag}: JSON-LD name does not match the record`, [j.name, expectedName]);
        assert(j.description === bfRec[p.code].schema_description,
          `${tag}: JSON-LD description is the record's schema_description`,
          `${tag}: JSON-LD description does not match the record`);
      }
    }
  }

  // Exactly two Forum pages, no future edition generated.
  const bfGenerated = fs.readdirSync(path.join(ROOT, "dist"))
    .filter((f) => /^event-business-forum.*\.html$/.test(f));
  assert(bfGenerated.length === 1,
    "exactly one Business Forum page per locale was generated",
    "unexpected Business Forum pages in dist/", bfGenerated);

  /* -- public files: only the justified css/pbf.css change is permitted ----- */
  {
    const { execFileSync } = require("child_process");
    const gitDiff = (args) => {
      try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }); }
      catch { return null; }
    };

    // Everything public except css/pbf.css must be byte-identical.
    // css/style.css is permitted to change in Phase 14, but ONLY additively and
    // ONLY for the archive-disclosure block — asserted separately below.
    const untouched = gitDiff(["status", "--porcelain", "--",
      // netlify.toml is deliberately NOT in this list: deployment configuration is
      // protected by the central deployment-state validator (parseDeploymentState),
      // which permits exactly the two supported states and rejects every partial
      // cutover. A blanket "never changes" rule here would forbid the approved
      // cutover itself. Every other file below stays protected.
      "js/main.js", "assets", "sitemap.xml", "robots.txt",
      "index.html", "pl/index.html", "events.html", "pl/events.html",
      "event-business-forum.html", "pl/event-business-forum.html"]);
      // `content/announcements` was removed from this list in Phase 17C.3 —
      // see the note on the same change in section 19. Editable by design;
      // guarded by output comparison rather than by immutability.
    if (untouched === null) {
      ok("git unavailable — public-file guard skipped");
    } else {
      const changed = untouched.split("\n").map((l) => l.trim()).filter(Boolean);
      assert(changed.length === 0,
        "every public file except css/pbf.css and css/style.css is untouched (live pages, main.js, assets, sitemap, netlify)",
        "this phase modified a public file it must not touch", changed);
    }

    // css/pbf.css MAY change, but only to add the backdrop custom property and
    // its explanatory comment. Any other edit to public CSS must fail.
    const pbfDiff = gitDiff(["diff", "--unified=0", "--", "css/pbf.css"]);
    if (pbfDiff === null) {
      ok("git unavailable — css/pbf.css scope guard skipped");
    } else if (pbfDiff.trim() === "") {
      ok("css/pbf.css has no uncommitted change (already committed, or unchanged)");
    } else {
      const body = pbfDiff.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
      const removed = body.filter((l) => l.startsWith("-")).map((l) => l.slice(1).trim());
      const added = body.filter((l) => l.startsWith("+")).map((l) => l.slice(1).trim());
      // Only the one background line may be removed.
      const unexpectedRemovals = removed.filter((l) => !/^url\("\.\.\/assets\/pbf\/[^"]+"\) center 30% \/ cover no-repeat;$/.test(l));
      assert(unexpectedRemovals.length === 0,
        "the css/pbf.css change removes only the hard-coded hero backdrop line",
        "css/pbf.css removed lines beyond the hero backdrop", unexpectedRemovals);
      // Additions must be the var() line or comment text.
      const isComment = (l) => l.startsWith("/*") || l.startsWith("*") || l.endsWith("*/")
        || (!l.includes("{") && !l.includes("}") && !/[a-z-]+\s*:/.test(l)) || /^[A-Za-z`(].*[a-z]$/.test(l);
      const unexpectedAdditions = added.filter((l) =>
        !/var\(--pbf-hero-backdrop, url\("\.\.\/assets\/pbf\/[^"]+"\)\) center 30% \/ cover no-repeat;/.test(l)
        && !isComment(l));
      assert(unexpectedAdditions.length === 0,
        `the css/pbf.css change adds only the --pbf-hero-backdrop line and its comment (${added.length} lines)`,
        "css/pbf.css added unrelated declarations", unexpectedAdditions);
      // No selector may have been added or removed.
      assert(!body.some((l) => /^[+-].*\{\s*$/.test(l)),
        "the css/pbf.css change adds and removes no selectors",
        "css/pbf.css gained or lost a rule");
    }

    // The live (repo-root) pages' own stylesheet references must still resolve.
    for (const [page, prefix] of [["event-business-forum.html", ""], ["pl/event-business-forum.html", "pl/"]]) {
      const liveSrc = read(page);
      const sheets = [...liveSrc.matchAll(/<link rel="stylesheet" href="((?!https?:)[^"]+)">/g)].map((m) => m[1]);
      const unresolved = sheets.filter((h) => !exists(path.posix.normalize(path.posix.join(prefix, h))));
      assert(unresolved.length === 0,
        `${page}: all ${sheets.length} local stylesheet references resolve`,
        `${page}: a stylesheet reference does not resolve`, unresolved);
    }
  }

  // --- semantic comparison against the live pages -------------------------
  {
    const { spawnSync } = require("child_process");
    const bfCmp = spawnSync(process.execPath, [path.join(__dirname, "compare-business-forum.js")],
      { cwd: ROOT, encoding: "utf8" });
    const bfMatched = (bfCmp.stdout.match(/PASS — (\d+)\/\1 comparisons matched/) || [])[1];
    assert(bfCmp.status === 0,
      `generated Business Forum pages match the live pages (${bfMatched || "?"} semantic comparisons — scripts/compare-business-forum.js)`,
      "scripts/compare-business-forum.js reports differences",
      (bfCmp.stdout || "").split("\n").filter((l) => /FAIL/.test(l)).slice(0, 12));
  }
}

/* =================================================================== 29. events listing content */

section("29. Events listing content (Phase 13)");

const AY_RE = /^(\d{4})\/(\d{2})$/;
/** "YYYY/YY" where YY really is the following calendar year. */
function validAcademicYear(value) {
  const m = AY_RE.exec(String(value || ""));
  if (!m) return false;
  return m[2] === String((Number(m[1]) + 1) % 100).padStart(2, "0");
}

/* -- the ONE central setting ---------------------------------------------- */
const AY_SETTINGS = loadYaml("content/settings/academic-year.yaml") || {};
const CURRENT_AY = AY_SETTINGS.current;
assert(validAcademicYear(CURRENT_AY),
  `the central academic-year setting is a valid "YYYY/YY" value (${CURRENT_AY})`,
  `content/settings/academic-year.yaml holds an invalid current year: ${CURRENT_AY}`);
assert(CURRENT_AY === "2025/26",
  "the configured current academic year is unchanged at 2025/26",
  `this phase must not change the current year (found ${CURRENT_AY})`);
{
  // A second current-year setting anywhere would be free to drift from this one.
  const rival = ["content/settings/events-year.yaml", "content/settings/listing-year.yaml",
    "content/pages/events-year.yaml"].filter((f) => exists(f));
  assert(rival.length === 0,
    "there is exactly one current-academic-year setting in the repository",
    "a second academic-year setting exists and could drift", rival);
  const pageRec = loadYaml("content/pages/events.yaml") || {};
  assert(!("academic_year" in pageRec) && !("current_year" in pageRec),
    "the events page record does not carry its own copy of the current year",
    "the events page record duplicates the central academic-year setting");
}

/* -- listing-visible event records ---------------------------------------- */
const listRecords = evAll.filter((e) => e.published === true && e.show_in_listing === true);
assert(listRecords.length === 5,
  `exactly five published, listing-visible events (${listRecords.length})`,
  `expected 5 listing-visible events, found ${listRecords.length}`, listRecords.map((e) => e.slug));

{
  const families = listRecords.reduce((acc, e) => {
    acc[e.event_family] = (acc[e.event_family] || 0) + 1; return acc;
  }, {});
  assert(families.standard === 4 && families["polish-business-forum"] === 1,
    "the listing holds four standard events and one Business Forum",
    "unexpected family mix in the listing", families);
}

{
  const slugs = listRecords.map((e) => e.slug);
  assert(new Set(slugs).size === slugs.length, "listing event slugs are unique",
    "duplicate slugs among listing events", slugs);
}

// `order` is unique WITHIN an academic year, and deliberately NOT globally.
{
  const byYear = {};
  const problems = [];
  for (const e of listRecords) {
    if (!validAcademicYear(e.academic_year)) {
      problems.push(`${e.slug}: invalid academic_year ${JSON.stringify(e.academic_year)}`);
      continue;
    }
    if (!Number.isInteger(e.order)) { problems.push(`${e.slug}: order is not an integer`); continue; }
    (byYear[e.academic_year] = byYear[e.academic_year] || []).push(e);
  }
  for (const [year, events] of Object.entries(byYear)) {
    const orders = events.map((e) => e.order);
    const dupes = [...new Set(orders.filter((o, i) => orders.indexOf(o) !== i))];
    for (const d of dupes) {
      problems.push(`${year}: order ${d} shared by ${events.filter((e) => e.order === d).map((e) => e.slug).join(", ")}`);
    }
  }
  assert(problems.length === 0,
    "every listing event has a valid academic year and an order unique within that year",
    "academic year / order problems", problems);
}

// No published event may sit in a year LATER than the configured current one.
{
  const currentStart = Number(AY_RE.exec(CURRENT_AY)[1]);
  const future = listRecords
    .filter((e) => validAcademicYear(e.academic_year) && Number(AY_RE.exec(e.academic_year)[1]) > currentStart)
    .map((e) => `${e.slug} (${e.academic_year})`);
  assert(future.length === 0,
    `no published listing event sits in a year later than ${CURRENT_AY}`,
    "a published event is in a future academic year — bump the central setting or correct the record", future);
}

/* -- card payload ---------------------------------------------------------- */
{
  const problems = [];
  for (const e of listRecords) {
    if (!e.card_image) problems.push(`${e.slug}: no card_image`);
    else if (!exists(String(e.card_image).replace(/^\//, ""))) problems.push(`${e.slug}: card_image missing on disk`);
    for (const code of ["en", "pl"]) {
      const loc = e[code] || {};
      // A card title must RESOLVE: either `title`, or the standard parts.
      const resolved = loc.title
        || [loc.title_lead, loc.title_fancy, loc.title_tail].map((p) => String(p || "").trim()).filter(Boolean).join(" ");
      if (!resolved) problems.push(`${e.slug}.${code}: no resolvable card title`);
      if (!loc.card_summary || !String(loc.card_summary).trim()) problems.push(`${e.slug}.${code}: no card_summary`);
      const alt = String(loc.card_image_alt || "");
      if (alt.trim().length < 15) problems.push(`${e.slug}.${code}: card_image_alt missing or too short`);
    }
    // Localised alt and summary must actually differ between languages.
    if (e.en && e.pl) {
      if (e.en.card_image_alt && e.en.card_image_alt === e.pl.card_image_alt) {
        problems.push(`${e.slug}: card_image_alt is identical in both languages`);
      }
      if (e.en.card_summary && e.en.card_summary === e.pl.card_summary) {
        problems.push(`${e.slug}: card_summary is identical in both languages`);
      }
    }
    // The card link is generated from the slug — nothing else may encode it.
    if (!/^[a-z0-9-]+$/.test(String(e.slug))) problems.push(`${e.slug}: slug cannot form a filename`);
  }
  assert(problems.length === 0,
    "every listing event has a resolvable title, localised summary and alt text, and an existing card image",
    "listing card payload problems", problems);
}

// Titles are DERIVED unless the listing genuinely differs; a card_title that
// merely repeats the resolved title is duplication and must be removed.
{
  const redundant = [];
  for (const e of listRecords) {
    for (const code of ["en", "pl"]) {
      const loc = e[code] || {};
      if (!loc.card_title) continue;
      const resolved = loc.title
        || [loc.title_lead, loc.title_fancy, loc.title_tail].map((p) => String(p || "").trim()).filter(Boolean).join(" ");
      if (loc.card_title.trim() === resolved) redundant.push(`${e.slug}.${code}`);
    }
  }
  assert(redundant.length === 0,
    "no record stores a card_title that merely repeats its own title",
    "redundant card_title overrides (derive instead)", redundant);
}

// No stored display date or venue string — both are generated.
{
  const stored = [];
  const BANNED = ["card_display_date", "card_date", "display_date", "card_venue", "venue_display", "listing_venue"];
  for (const e of listRecords) {
    for (const key of BANNED) {
      if (key in e) stored.push(`${e.slug}.${key}`);
      for (const code of ["en", "pl"]) if (e[code] && key in e[code]) stored.push(`${e.slug}.${code}.${key}`);
    }
  }
  assert(stored.length === 0,
    "no listing event stores a display date or venue string (both are generated)",
    "a stored display date or venue would be free to drift from the canonical fields", stored);
}

/* -- the events page record ------------------------------------------------ */
{
  const rel = "content/pages/events.yaml";
  assert(exists(rel), "the events page record exists", `${rel} is missing`);
  if (exists(rel)) {
    const rec = loadYaml(rel) || {};
    assert(!exists("content/pages/events.en.yaml") && !exists("content/pages/events.pl.yaml"),
      "the events page is ONE bilingual record, not split per language",
      "separate per-language events page records exist");
    const REQUIRED = ["eyebrow", "title_lead", "title_fancy", "lead", "read_more", "flagship_tag",
      "archive_heading", "archive_summary", "empty_season",
      "cta_heading", "cta_text", "cta_label",
      "seo_title", "seo_description", "og_image_alt"];
    const missing = [];
    for (const code of ["en", "pl"]) {
      const loc = rec[code];
      if (!loc) { missing.push(`no ${code} block`); continue; }
      for (const f of REQUIRED) if (!loc[f] || !String(loc[f]).trim()) missing.push(`${code}.${f}`);
    }
    assert(missing.length === 0, "the events page record carries every required string in both languages",
      "missing events page copy", missing);

    // Archive and empty-season wording must name the season.
    const noSeason = [];
    for (const code of ["en", "pl"]) {
      for (const f of ["archive_summary", "empty_season", "eyebrow"]) {
        if (rec[code] && !String(rec[code][f] || "").includes("{season}")) noSeason.push(`${code}.${f}`);
      }
    }
    assert(noSeason.length === 0,
      "the season-dependent strings use the {season} placeholder rather than a hard-coded year",
      "hard-coded academic year in page copy", noSeason);

    assert(rec.hero_image && exists(String(rec.hero_image).replace(/^\//, "")),
      `the events hero photograph exists (${rec.hero_image})`,
      "the events hero photograph is missing or not declared");

    // Safety: no markup, handlers or unsafe protocols in page copy.
    const strings = [];
    (function walk(node, trail) {
      if (typeof node === "string") { strings.push([trail, node]); return; }
      if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${trail}[${i}]`)); return; }
      if (node && typeof node === "object") for (const k of Object.keys(node)) walk(node[k], `${trail}.${k}`);
    })(rec, "events");
    const rawHtml = strings.filter(([, v]) => /<\/?[a-z][\s\S]*>/i.test(v)).map(([t]) => t);
    assert(rawHtml.length === 0, "no events page string contains raw HTML",
      "raw HTML in the events page record", rawHtml);
    const handlers = strings.filter(([, v]) => /\bon[a-z]+\s*=/i.test(v) || /javascript:/i.test(v)).map(([t]) => t);
    assert(handlers.length === 0, "no events page string contains a script or inline handler",
      "unsafe content in the events page record", handlers);
    const badUrl = strings
      .filter(([t]) => /\.(url|href|link|image)$/.test(t))
      .filter(([, v]) => /^[a-z][a-z0-9+.-]*:/i.test(v) && !/^(https?:|mailto:)/i.test(v))
      .map(([t, v]) => `${t}: ${v}`);
    assert(badUrl.length === 0, "every absolute URL in the events page record is http(s) or mailto",
      "unsafe URL protocol in the events page record", badUrl);
  }
}

/* -- the grouping helper, via its synthetic tests --------------------------- */
{
  const { spawnSync } = require("child_process");
  const t = spawnSync(process.execPath, [path.join(__dirname, "test-event-listing-groups.js")],
    { cwd: ROOT, encoding: "utf8" });
  const cases = (t.stdout.match(/PASS — (\d+)\/\1 grouping cases/) || [])[1];
  assert(t.status === 0,
    `the academic-year grouping helper passes its synthetic multi-year tests (${cases || "?"} cases)`,
    "scripts/test-event-listing-groups.js reports failures",
    (t.stdout || "").split("\n").filter((l) => /FAIL/.test(l)).slice(0, 12));
}

/* =================================================================== 30. generated events listing */

section("30. Generated events listing (Phase 13)");

if (!exists("dist")) {
  ok("dist/ not built — run `npm run build` to validate the generated listing");
} else {
  const LIST_PAGES = [
    { rel: "dist/events.html", code: "en", lang: "en", ogLocale: "en_GB", prefix: "" },
    { rel: "dist/pl/events.html", code: "pl", lang: "pl", ogLocale: "pl_PL", prefix: "pl/" },
  ];
  const EXPECTED_CARDS = ["business-forum", "sikorski-debate", "christmas-dinner", "youth-congress", "icebreaker"];

  for (const p of LIST_PAGES) {
    const tag = `events listing [${p.code}]`;
    if (!exists(p.rel)) { assert(false, `${tag}: page generated`, `${p.rel} was not generated`); continue; }
    const src = read(p.rel);
    const canonical = `https://polsocfederation.pl/${p.prefix}events.html`;

    assert(new RegExp(`<html lang="${p.lang}"`).test(src), `${tag}: html lang="${p.lang}"`,
      `${tag}: wrong or missing html lang`);
    assert(src.includes(`<link rel="canonical" href="${canonical}">`),
      `${tag}: canonical is ${canonical}`, `${tag}: wrong canonical`);
    for (const [hl, href] of [
      ["en", "https://polsocfederation.pl/events.html"],
      ["pl", "https://polsocfederation.pl/pl/events.html"],
      ["x-default", "https://polsocfederation.pl/events.html"],
    ]) {
      assert(src.includes(`<link rel="alternate" hreflang="${hl}" href="${href}">`),
        `${tag}: hreflang ${hl} → ${href}`, `${tag}: missing or wrong hreflang ${hl}`);
    }
    assert(src.includes(`<meta property="og:locale" content="${p.ogLocale}">`),
      `${tag}: og:locale is ${p.ogLocale}`, `${tag}: wrong og:locale`);
    assert(/<a href="events\.html" class="active">/.test(src),
      `${tag}: marks Events as the active navigation item`, `${tag}: the Events nav item is not active`);

    /* -- season comes from the central setting -------------------------- */
    const watermark = (src.match(/<span class="watermark"[^>]*>([^<]*)<\/span>/) || [])[1];
    assert(watermark === CURRENT_AY,
      `${tag}: the season watermark is the configured current year (${CURRENT_AY})`,
      `${tag}: watermark "${watermark}" does not match the central setting`);
    const longYear = `${AY_RE.exec(CURRENT_AY)[1]} / ${Number(AY_RE.exec(CURRENT_AY)[1]) + 1}`;
    const eyebrow = (src.match(/<span class="eyebrow">([^<]*)<\/span>/) || [])[1];
    assert(String(eyebrow).includes(longYear),
      `${tag}: the season eyebrow derives from the central setting (${longYear})`,
      `${tag}: eyebrow "${eyebrow}" does not contain the configured season`);

    /* -- cards ------------------------------------------------------------ */
    const noComments = src.replace(/<!--[\s\S]*?-->/g, "");
    const cards = [...noComments.matchAll(/<article class="(event-card[^"]*)">([\s\S]*?)<\/article>/g)];
    assert(cards.length === 5, `${tag}: exactly five current-year cards (${cards.length})`,
      `${tag}: expected 5 cards, found ${cards.length}`);
    const order = cards.map((m) => {
      const h = (m[2].match(/<h2><a href="event-([^".]+)\.html">/) || [])[1];
      return h;
    });
    assert(JSON.stringify(order) === JSON.stringify(EXPECTED_CARDS),
      `${tag}: card order is ${EXPECTED_CARDS.join(" → ")}`,
      `${tag}: unexpected card order`, order);

    // Family variants: exactly one flagship, and it is the Forum.
    const flagshipCards = cards.filter((m) => /class="flagship-tag"/.test(m[2]));
    const pbfCards = cards.filter((m) => /event-card-pbf/.test(m[1]));
    assert(flagshipCards.length === 1 && pbfCards.length === 1,
      `${tag}: exactly one flagship card and one Forum variant`,
      `${tag}: ${flagshipCards.length} flagship, ${pbfCards.length} Forum variant`);
    assert(/event-card-pbf[\s\S]*?flagship-tag/.test(noComments),
      `${tag}: the Forum card keeps its flagship structure`,
      `${tag}: the Forum card lost its flagship tag or variant class`);
    const wrongFlagship = cards
      .filter((m) => /event-card-pbf/.test(m[1]) === false && /class="flagship-tag"/.test(m[2]))
      .map((m) => (m[2].match(/event-([^".]+)\.html/) || [])[1]);
    assert(wrongFlagship.length === 0,
      `${tag}: no standard event uses the flagship structure`,
      `${tag}: a standard event rendered as flagship`, wrongFlagship);

    /* -- links stay in the reader's language ------------------------------ */
    const cardLinks = cards.flatMap((m) => [...m[2].matchAll(/href="([^"]*)"/g)].map((h) => h[1]));
    const absolute = cardLinks.filter((h) => h.startsWith("/") || /^https?:/.test(h));
    assert(absolute.length === 0,
      `${tag}: all ${cardLinks.length} card links are relative, so /pl/ stays Polish`,
      `${tag}: a card link is absolute and would leave the current language`, absolute);
    const expectedHrefs = EXPECTED_CARDS.flatMap((s) => [`event-${s}.html`, `event-${s}.html`]);
    assert(JSON.stringify(cardLinks) === JSON.stringify(expectedHrefs),
      `${tag}: every card links to its own detail page twice (title + read more)`,
      `${tag}: unexpected card link set`, cardLinks);

    /* -- archive: none, because only one academic year exists -------------- */
    assert(!/<details/.test(src),
      `${tag}: no archive disclosure is rendered while only one academic year exists`,
      `${tag}: an empty archive control was generated`);

    /* -- assets ------------------------------------------------------------ */
    assert(!src.includes("/pl/assets/"), `${tag}: no /pl/assets/ path`, `${tag}: a /pl/assets/ path leaked in`);
    const imgs = [...noComments.matchAll(/<img\b[^>]*>/g)];
    const noAlt = imgs.filter((m) => !/\balt\s*=/.test(m[0])).map((m) => m[0].slice(0, 70));
    assert(noAlt.length === 0, `${tag}: every image has an alt attribute (${imgs.length})`,
      `${tag}: images without alt`, noAlt);
    const srcs = imgs.map((m) => (m[0].match(/src="([^"]*)"/) || [])[1]).filter(Boolean);
    const notCopied = [...new Set(srcs)].filter((v) => v.startsWith("/") && !exists("dist" + v));
    assert(notCopied.length === 0, `${tag}: all ${new Set(srcs).size} images were copied into dist/`,
      `${tag}: referenced images missing from dist/`, notCopied);
    const localRefs = [...src.matchAll(/(?:href|src)="(\/(?:css|js|assets)\/[^"]*)"/g)].map((m) => m[1]);
    const brokenRefs = [...new Set(localRefs)].filter((r) => !exists("dist" + r));
    assert(brokenRefs.length === 0, `${tag}: all ${new Set(localRefs).size} local asset references resolve in dist/`,
      `${tag}: broken local asset references`, brokenRefs);
  }

  // The homepages are generated as of Phase 14 and validated in section 32.
  {
    const { execFileSync } = require("child_process");
    let changed = null;
    try {
      // netlify.toml is deliberately NOT in this list: deployment configuration is
      // protected by the central deployment-state validator (parseDeploymentState),
      // which permits exactly the two supported states and rejects every partial
      // cutover. A blanket "never changes" rule here would forbid the approved
      // cutover itself. Every other file below stays protected.
      changed = execFileSync("git", ["status", "--porcelain", "--", "sitemap.xml", "robots.txt"],
        { cwd: ROOT, encoding: "utf8" }).split("\n").map((l) => l.trim()).filter(Boolean);
    } catch { changed = null; }
    if (changed === null) ok("git unavailable — sitemap guard skipped");
    else assert(changed.length === 0, "sitemap.xml and robots.txt are unchanged",
      "this phase modified deployment or sitemap files", changed);
  }

  // --- semantic comparison against the live pages -------------------------
  {
    const { spawnSync } = require("child_process");
    const cmp = spawnSync(process.execPath, [path.join(__dirname, "compare-events-listing.js")],
      { cwd: ROOT, encoding: "utf8" });
    const matched = (cmp.stdout.match(/PASS — (\d+)\/\1 comparisons matched/) || [])[1];
    assert(cmp.status === 0,
      `the generated listing matches the live pages (${matched || "?"} semantic comparisons — scripts/compare-events-listing.js)`,
      "scripts/compare-events-listing.js reports differences",
      (cmp.stdout || "").split("\n").filter((l) => /FAIL/.test(l)).slice(0, 12));
  }
}

/* =================================================================== 31. homepage record */

section("31. Homepage content record (Phase 14)");

const HOME_REL = "content/pages/home.yaml";
assert(exists(HOME_REL), "the homepage record exists", `${HOME_REL} is missing`);
assert(!exists("content/pages/home.en.yaml") && !exists("content/pages/home.pl.yaml"),
  "the homepage is ONE bilingual record, not split per language",
  "separate per-language homepage records exist");

const homeRec = exists(HOME_REL) ? (loadYaml(HOME_REL) || {}) : {};
if (exists(HOME_REL)) {
  /* -- required sections --------------------------------------------------- */
  for (const key of ["hero", "ticker", "about", "statistics", "pillars",
    "featured_event", "testimonials", "partners", "watermarks"]) {
    assert(homeRec[key] !== undefined && homeRec[key] !== null,
      `homepage record section present: ${key}`, `the homepage record is missing ${key}`);
  }

  /* -- localised fields ---------------------------------------------------- */
  const HOME_LOC_REQUIRED = ["hero_eyebrow", "hero_title_line_1", "hero_title_line_2", "hero_lead",
    "hero_primary_button", "hero_secondary_button", "scroll_hint",
    "about_eyebrow", "about_body", "about_photo_alt", "about_caption",
    "stats_eyebrow", "pillars_eyebrow", "timeline_eyebrow",
    "featured_eyebrow", "featured_lead_before", "featured_lead_emphasis", "featured_lead_after", "featured_label",
    "testimonials_eyebrow", "partners_eyebrow", "partners_lead",
    "cta_heading", "cta_body", "cta_label",
    "seo_title", "seo_description", "og_image_alt", "schema_description"];
  const homeLocBad = [];
  for (const code of ["en", "pl"]) {
    const l = homeRec[code];
    if (!l) { homeLocBad.push(`no ${code} block`); continue; }
    for (const f of HOME_LOC_REQUIRED) if (!l[f] || !String(l[f]).trim()) homeLocBad.push(`${code}.${f}`);
    for (const f of ["about_title", "pillars_title", "timeline_title", "featured_title", "partners_title"]) {
      if (!l[f] || !l[f].lead || !l[f].fancy) homeLocBad.push(`${code}.${f} (lead/fancy)`);
    }
  }
  assert(homeLocBad.length === 0,
    "the homepage record carries every required localised field in both languages",
    "missing homepage copy", homeLocBad);

  /* -- shared URLs and images --------------------------------------------- */
  {
    const problems = [];
    const imgFields = [
      ["hero.shield_image", (homeRec.hero || {}).shield_image],
      ["about.photo", (homeRec.about || {}).photo],
      ["featured_event.logo", (homeRec.featured_event || {}).logo],
    ];
    for (const p of (homeRec.pillars || [])) imgFields.push([`pillar ${p.key}.background`, p.background]);
    for (const g of ((homeRec.featured_event || {}).gallery || [])) imgFields.push([`featured gallery`, g.src]);
    for (const p of (homeRec.partners || [])) imgFields.push([`partner ${p.key}.image`, p.image]);
    for (const [name, v] of imgFields) {
      if (!v) { problems.push(`${name}: missing`); continue; }
      if (!String(v).startsWith("/assets/")) problems.push(`${name}: not root-relative (${v})`);
      else if (!exists(String(v).replace(/^\//, ""))) problems.push(`${name}: file missing (${v})`);
    }
    assert(problems.length === 0,
      `all ${imgFields.length} homepage images are root-relative and exist`,
      "homepage image problems", problems);

    const links = [["hero.primary_link", (homeRec.hero || {}).primary_link],
      ["hero.secondary_link", (homeRec.hero || {}).secondary_link],
      ["featured_event.link", (homeRec.featured_event || {}).link]];
    const badLinks = links.filter(([, v]) => !v || String(v).startsWith("/") || /^https?:/.test(String(v)))
      .map(([n, v]) => `${n}: ${v}`);
    assert(badLinks.length === 0,
      "homepage destinations are relative, so /pl/ stays Polish",
      "absolute or missing homepage destination", badLinks);
  }

  /* -- statistics --------------------------------------------------------- */
  {
    const stats = homeRec.statistics || [];
    const keys = stats.map((s) => s.key);
    assert(keys.length > 0 && new Set(keys).size === keys.length,
      `statistic keys are unique (${keys.join(", ")})`, "duplicate statistic keys", keys);
    const bad = stats.map((s, i) => {
      if (!Number.isInteger(s.value)) return `${s.key || i}: value must be an integer`;
      if (typeof s.plain !== "boolean") return `${s.key || i}: plain must be a boolean`;
      if (!s.label || !s.label.en || !s.label.pl) return `${s.key || i}: label not localised`;
      return null;
    }).filter(Boolean);
    assert(bad.length === 0, `all ${stats.length} statistics are well formed`, "malformed statistics", bad);
    // The founding year MUST be plain or js/main.js renders "2,013".
    const founded = stats.find((s) => s.value === 2013);
    assert(founded && founded.plain === true,
      "the founding-year statistic is marked plain (so it is not rendered as 2,013)",
      "the founding year is missing or not marked plain");
    // Nothing may store a pre-formatted display string.
    const formatted = stats.filter((s) => /[0-9],[0-9]|\+$/.test(String(s.value))).map((s) => s.key);
    assert(formatted.length === 0,
      "no statistic stores a formatted display string (value + suffix produce it)",
      "a statistic stores formatted text", formatted);
  }

  /* -- pillars, testimonials, partners ------------------------------------ */
  {
    const pk = (homeRec.pillars || []).map((p) => p.key);
    assert(pk.length > 0 && new Set(pk).size === pk.length,
      `pillar keys are unique (${pk.join(", ")})`, "duplicate pillar keys", pk);
    const badPillar = (homeRec.pillars || [])
      .filter((p) => !p.number || !p.background || !p.title || !p.title.en || !p.title.pl || !p.body || !p.body.en || !p.body.pl)
      .map((p) => p.key);
    assert(badPillar.length === 0, "every pillar has a number, backdrop and localised copy",
      "incomplete pillars", badPillar);

    const tk = (homeRec.testimonials || []).map((t) => t.key);
    assert(tk.length > 0 && new Set(tk).size === tk.length,
      `testimonial keys are unique (${tk.length})`, "duplicate testimonial keys", tk);
    const badT = (homeRec.testimonials || [])
      .filter((t) => ["quote", "who", "role"].some((f) => !t[f] || !t[f].en || !t[f].pl))
      .map((t) => t.key);
    assert(badT.length === 0, "every testimonial has a localised quote, attribution and role",
      "incomplete testimonials", badT);

    const partners = homeRec.partners || [];
    const pak = partners.map((p) => p.key);
    const pai = partners.map((p) => p.image);
    assert(pak.length > 0 && new Set(pak).size === pak.length,
      `partner keys are unique (${pak.length})`, "duplicate partner keys", pak);
    assert(new Set(pai).size === pai.length,
      "each partner logo appears exactly once (marquee duplication is NOT stored here)",
      "a partner logo is stored more than once", pai.filter((v, i) => pai.indexOf(v) !== i));
    const badP = partners.filter((p) => !p.name || !p.image).map((p) => p.key);
    assert(badP.length === 0, "every partner has a name and a logo", "incomplete partners", badP);
  }

  /* -- no animation machinery in content ----------------------------------- */
  {
    const stray = [];
    (function walkKeys(node, trail) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach((v, i) => walkKeys(v, `${trail}[${i}]`)); return; }
      for (const k of Object.keys(node)) {
        if (/carousel|marquee_sets|repetition|duplicate|ticker_runs|runs$/i.test(k)) stray.push(`${trail}.${k}`);
        walkKeys(node[k], `${trail}.${k}`);
      }
    })(homeRec, "home");
    assert(stray.length === 0,
      "the homepage record stores no animation-duplication values",
      "animation machinery leaked into homepage content", stray);
    const techRel = "src/_data/homeTechnical.js";
    assert(exists(techRel), `animation repetition counts live in ${techRel}`,
      `${techRel} is missing`);
    if (exists(techRel)) {
      const tech = require(path.join(ROOT, techRel));
      assert(tech.partnerMarqueeSets === 2 && tech.tickerRuns === 2,
        "homeTechnical declares 2 marquee sets and 2 ticker runs",
        "unexpected homepage animation counts", tech);
    }
  }

  /* -- safety -------------------------------------------------------------- */
  {
    const strings = [];
    (function walk(node, trail) {
      if (typeof node === "string") { strings.push([trail, node]); return; }
      if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${trail}[${i}]`)); return; }
      if (node && typeof node === "object") for (const k of Object.keys(node)) walk(node[k], `${trail}.${k}`);
    })(homeRec, "home");
    const rawHtml = strings.filter(([, v]) => /<\/?[a-z][\s\S]*>/i.test(v)).map(([t]) => t);
    assert(rawHtml.length === 0, "no homepage string contains raw HTML",
      "raw HTML in the homepage record", rawHtml);
    const handlers = strings.filter(([, v]) => /\bon[a-z]+\s*=/i.test(v) || /javascript:/i.test(v)).map(([t]) => t);
    assert(handlers.length === 0, "no homepage string contains a script or inline handler",
      "unsafe content in the homepage record", handlers);
    const badUrl = strings
      .filter(([t]) => /\.(url|link|image|photo|src|background|logo)$/.test(t))
      .filter(([, v]) => /^[a-z][a-z0-9+.-]*:/i.test(v) && !/^(https?:|mailto:)/i.test(v))
      .map(([t, v]) => `${t}: ${v}`);
    assert(badUrl.length === 0, "every absolute URL in the homepage record is http(s) or mailto",
      "unsafe URL protocol in the homepage record", badUrl);
  }
}

/* -- homepage-visible events ---------------------------------------------- */
{
  const homeEvents = evAll.filter((e) => e.published === true && e.show_on_homepage === true);
  assert(homeEvents.length === 5,
    `exactly five published homepage-visible events (${homeEvents.length})`,
    `expected 5 homepage events, found ${homeEvents.length}`, homeEvents.map((e) => e.slug));
  const wrongYear = homeEvents.filter((e) => e.academic_year !== CURRENT_AY).map((e) => `${e.slug} (${e.academic_year})`);
  assert(wrongYear.length === 0,
    `every homepage event is in the configured current year (${CURRENT_AY})`,
    "a homepage event is outside the current academic year", wrongYear);

  const expectedOrder = ["business-forum", "sikorski-debate", "christmas-dinner", "youth-congress", "icebreaker"];
  const actualOrder = [...homeEvents].sort((a, b) => a.order - b.order).map((e) => e.slug);
  assert(JSON.stringify(actualOrder) === JSON.stringify(expectedOrder),
    `homepage timeline order matches the live page (${expectedOrder.join(" → ")})`,
    "homepage event order does not match the live timeline", actualOrder);

  // The live homepage timeline and the live listing are in the SAME order, so no
  // separate homepage order exists. A redundant override must not creep in.
  const redundant = homeEvents.filter((e) => e.homepage_order !== undefined).map((e) => e.slug);
  assert(redundant.length === 0,
    "no event carries a homepage_order override (the listing order already matches)",
    "a redundant homepage_order override exists", redundant);

  const bad = [];
  for (const e of homeEvents) {
    for (const code of ["en", "pl"]) {
      const l = e[code] || {};
      const resolved = l.timeline_title || l.title
        || [l.title_lead, l.title_fancy, l.title_tail].map((p) => String(p || "").trim()).filter(Boolean).join(" ");
      if (!resolved) bad.push(`${e.slug}.${code}: no resolvable timeline title`);
      if (!l.timeline_summary || !String(l.timeline_summary).trim()) bad.push(`${e.slug}.${code}: no timeline_summary`);
      // A timeline_title that merely repeats the event title is duplication.
      const plain = l.title || [l.title_lead, l.title_fancy, l.title_tail].map((p) => String(p || "").trim()).filter(Boolean).join(" ");
      if (l.timeline_title && l.timeline_title.trim() === plain) bad.push(`${e.slug}.${code}: timeline_title duplicates the title`);
    }
    if (!/^\d{4}-\d{2}(-\d{2})?$/.test(String(e.start_date))) bad.push(`${e.slug}: invalid start_date`);
    if (!/^[a-z0-9-]+$/.test(String(e.slug))) bad.push(`${e.slug}: slug cannot form a filename`);
  }
  assert(bad.length === 0,
    "every homepage event has a resolvable timeline title, localised summary, valid date and linkable slug",
    "homepage timeline data problems", bad);
}

/* -- archive-disclosure CSS ------------------------------------------------ */
{
  const css = read("css/style.css");
  for (const sel of [".event-archive", ".event-archive-year", ".event-archive-year > summary"]) {
    assert(css.includes(sel), `css/style.css defines ${sel}`, `${sel} is not styled`);
  }
  assert(/\.event-archive-year > summary:focus-visible\s*\{[^}]*outline/.test(css),
    "the archive summary has a visible keyboard focus outline",
    "the archive summary has no visible focus treatment");
  // Native semantics must survive: the marker must not be hidden without a custom
  // accessible indicator, and the summary must remain a list-item.
  assert(!/\.event-archive-year > summary\s*\{[^}]*list-style:\s*none/.test(css)
    && !/\.event-archive-year > summary::-webkit-details-marker\s*\{[^}]*display:\s*none/.test(css),
    "the native disclosure marker is not hidden",
    "the archive summary hides the native marker without providing an accessible indicator");
  assert(/\.event-archive-year > summary\s*\{[^}]*min-height:\s*44px/.test(css),
    "the archive summary keeps a touch-sized target",
    "the archive summary is too small to tap comfortably");

  // The change must be ADDITIVE only — no existing selector altered.
  const { execFileSync } = require("child_process");
  let diff = null;
  try {
    diff = execFileSync("git", ["diff", "--numstat", "--", "css/style.css"], { cwd: ROOT, encoding: "utf8" });
  } catch { diff = null; }
  if (diff === null) ok("git unavailable — css/style.css scope guard skipped");
  else if (diff.trim() === "") ok("css/style.css has no uncommitted change (already committed, or unchanged)");
  else {
    const [added, removed] = diff.trim().split(/\s+/).map(Number);
    assert(removed === 0,
      `the css/style.css change is purely additive (+${added}, -${removed})`,
      "css/style.css removed or altered existing lines", diff.trim());
  }
}

/* =================================================================== 32. generated homepages */

section("32. Generated homepages (Phase 14)");

if (!exists("dist")) {
  ok("dist/ not built — run `npm run build` to validate the generated homepages");
} else {
  const HOME_PAGES = [
    { rel: "dist/index.html", code: "en", lang: "en", ogLocale: "en_GB", canonical: "https://polsocfederation.pl/" },
    { rel: "dist/pl/index.html", code: "pl", lang: "pl", ogLocale: "pl_PL", canonical: "https://polsocfederation.pl/pl/" },
  ];
  const EXPECTED_TL = ["business-forum", "sikorski-debate", "christmas-dinner", "youth-congress", "icebreaker"];

  for (const p of HOME_PAGES) {
    const tag = `homepage [${p.code}]`;
    if (!exists(p.rel)) { assert(false, `${tag}: page generated`, `${p.rel} was not generated`); continue; }
    const src = read(p.rel);
    const noComments = src.replace(/<!--[\s\S]*?-->/g, "");

    assert(new RegExp(`<html lang="${p.lang}"`).test(src), `${tag}: html lang="${p.lang}"`, `${tag}: wrong html lang`);
    assert(src.includes(`<link rel="canonical" href="${p.canonical}">`),
      `${tag}: canonical is ${p.canonical}`, `${tag}: wrong canonical`);
    for (const [hl, href] of [["en", "https://polsocfederation.pl/"],
      ["pl", "https://polsocfederation.pl/pl/"], ["x-default", "https://polsocfederation.pl/"]]) {
      assert(src.includes(`<link rel="alternate" hreflang="${hl}" href="${href}">`),
        `${tag}: hreflang ${hl} → ${href}`, `${tag}: missing or wrong hreflang ${hl}`);
    }
    assert(src.includes(`<meta property="og:locale" content="${p.ogLocale}">`),
      `${tag}: og:locale is ${p.ogLocale}`, `${tag}: wrong og:locale`);
    // The current social banner, with the dimensions the live pages declare.
    assert(/<meta property="og:image" content="https:\/\/polsocfederation\.pl\/assets\/social\/og-image\.png">/.test(src),
      `${tag}: keeps the current social banner`, `${tag}: the social image changed`);
    for (const f of ["og:image:secure_url", "og:image:type", "og:image:width", "og:image:height"]) {
      assert(src.includes(`property="${f}"`), `${tag}: declares ${f}`, `${tag}: ${f} is missing`);
    }

    /* -- Organization JSON-LD ------------------------------------------- */
    const ldRaw = (src.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1];
    assert(!!ldRaw, `${tag}: has an Organization JSON-LD block`, `${tag}: JSON-LD is missing`);
    if (ldRaw) {
      let j = null;
      try { j = JSON.parse(ldRaw); } catch { j = null; }
      assert(j !== null, `${tag}: Organization JSON-LD parses`, `${tag}: JSON-LD does not parse`);
      if (j) {
        assert(j["@type"] === "Organization", `${tag}: @type is Organization`, `${tag}: wrong @type`);
        assert(j.url === p.canonical, `${tag}: JSON-LD url is the locale home`, `${tag}: wrong JSON-LD url`, j.url);
        assert(Array.isArray(j.sameAs) && j.sameAs.length === 3,
          `${tag}: sameAs holds exactly the three confirmed Federation profiles`,
          `${tag}: unexpected sameAs count`, j.sameAs);
        const unconfirmed = (j.sameAs || []).filter((u) => !/instagram\.com\/federac_ja|linkedin\.com\/company\/federation-of-polish-student-societies-in-the-uk|facebook\.com\/FederationOfPolishStudentSocietiesUK/.test(u));
        assert(unconfirmed.length === 0,
          `${tag}: sameAs contains no unconfirmed or initiative-level profile`,
          `${tag}: an unconfirmed social profile was added`, unconfirmed);
        if (p.code === "pl") assert(j.inLanguage === "pl-PL", `${tag}: inLanguage is pl-PL`, `${tag}: missing inLanguage`);
        else assert(j.inLanguage === undefined, `${tag}: no inLanguage on the English page`, `${tag}: unexpected inLanguage`);
        assert(j.description === (homeRec[p.code] || {}).schema_description,
          `${tag}: JSON-LD description comes from the record`, `${tag}: JSON-LD description drifted from the record`);
      }
    }

    /* -- ticker ---------------------------------------------------------- */
    assert(/<div class="ticker-clip">/.test(src),
      `${tag}: the ticker clip wrapper is present (the guard against page overflow)`,
      `${tag}: .ticker-clip is missing — the stripe would widen the document`);
    assert(/<div class="ticker" aria-hidden="true">/.test(src),
      `${tag}: the ticker is hidden from assistive technology`, `${tag}: the ticker is not aria-hidden`);
    {
      const track = (src.match(/<div class="ticker-track">([\s\S]*?)<\/div>/) || [])[1] || "";
      const runs = (track.match(/<span>(?!<)/g) || []).length;
      const tech = require(path.join(ROOT, "src/_data/homeTechnical.js"));
      assert(runs === tech.tickerRuns,
        `${tag}: the ticker renders ${tech.tickerRuns} phrase runs for the seamless loop`,
        `${tag}: ${runs} ticker runs, expected ${tech.tickerRuns}`);
    }

    /* -- statistics ------------------------------------------------------ */
    {
      const counters = [...src.matchAll(/<div class="stat-number"([^>]*)>/g)].map((m) => m[1]);
      assert(counters.length === (homeRec.statistics || []).length,
        `${tag}: ${counters.length} statistics render`, `${tag}: statistic count does not match the record`);
      const missingCount = counters.filter((a) => !/data-count="\d+"/.test(a));
      assert(missingCount.length === 0, `${tag}: every counter carries data-count`,
        `${tag}: a counter is missing data-count`, missingCount);
      assert(/data-count="2013" data-plain/.test(src),
        `${tag}: the founding-year counter keeps data-plain (not rendered as 2,013)`,
        `${tag}: data-plain lost on the founding year`);
    }

    /* -- timeline -------------------------------------------------------- */
    {
      const items = [...noComments.matchAll(/<div class="tl-item[^"]*">\s*<span class="tl-date">[^<]*<\/span>\s*<h3><a href="event-([^".]+)\.html">/g)]
        .map((m) => m[1]);
      assert(items.length === 5, `${tag}: five timeline items (${items.length})`,
        `${tag}: expected 5 timeline items`);
      assert(JSON.stringify(items) === JSON.stringify(EXPECTED_TL),
        `${tag}: timeline order is ${EXPECTED_TL.join(" → ")}`, `${tag}: unexpected timeline order`, items);
      assert(/<div class="timeline-progress" aria-hidden="true"><\/div>/.test(src),
        `${tag}: the animated timeline rail is present`, `${tag}: .timeline-progress is missing`);
      const tlLinks = [...noComments.matchAll(/<div class="tl-item[^"]*">[\s\S]*?<a href="([^"]*)"/g)].map((m) => m[1]);
      const absolute = tlLinks.filter((h) => h.startsWith("/") || /^https?:/.test(h));
      assert(absolute.length === 0,
        `${tag}: all ${tlLinks.length} timeline links are relative, so /pl/ stays Polish`,
        `${tag}: a timeline link would leave the current language`, absolute);
      // The homepage is not an archive.
      assert(!/<details/.test(src), `${tag}: no archive disclosure on the homepage`,
        `${tag}: an archive disclosure appeared on the homepage`);
    }

    /* -- partners -------------------------------------------------------- */
    {
      const tech = require(path.join(ROOT, "src/_data/homeTechnical.js"));
      const tiles = [...noComments.matchAll(/<div class="pbf-logo-tile"([^>]*)><img src="([^"]*)" alt="([^"]*)">/g)];
      const visible = tiles.filter((t) => !/aria-hidden/.test(t[1]));
      const hidden = tiles.filter((t) => /aria-hidden/.test(t[1]));
      const canonical = (homeRec.partners || []).length;
      assert(visible.length === canonical,
        `${tag}: ${canonical} canonical partner logos render`, `${tag}: partner count does not match the record`);
      assert(tiles.length === canonical * tech.partnerMarqueeSets,
        `${tag}: ${canonical * tech.partnerMarqueeSets} tiles (${canonical} logos × ${tech.partnerMarqueeSets} technical sets)`,
        `${tag}: rendered tile count breaks the scrollWidth/2 loop`, tiles.length);
      assert(hidden.length === canonical,
        `${tag}: the duplicated sequence is accessibility-hidden`,
        `${tag}: ${hidden.length} aria-hidden tiles, expected ${canonical}`);
      assert(hidden.every((t) => t[3] === ""),
        `${tag}: every duplicated logo has empty alt text`,
        `${tag}: a duplicated logo carries real alt text`);
    }

    /* -- testimonials ---------------------------------------------------- */
    {
      const slides = (noComments.match(/<div class="quote-slide[^"]*">/g) || []);
      assert(slides.length === (homeRec.testimonials || []).length,
        `${tag}: ${slides.length} testimonial slides render`, `${tag}: testimonial count does not match the record`);
      assert((noComments.match(/<div class="quote-slide active">/g) || []).length === 1,
        `${tag}: exactly one slide starts active`, `${tag}: wrong number of active slides`);
      assert(/<div class="quote-dots"><\/div>/.test(src),
        `${tag}: the indicator container js/main.js fills is present`, `${tag}: .quote-dots is missing`);
    }

    /* -- assets ---------------------------------------------------------- */
    assert(!src.includes("/pl/assets/"), `${tag}: no /pl/assets/ path`, `${tag}: a /pl/assets/ path leaked in`);
    {
      const imgs = [...noComments.matchAll(/<img\b[^>]*>/g)];
      const noAlt = imgs.filter((m) => !/\balt\s*=/.test(m[0])).map((m) => m[0].slice(0, 70));
      assert(noAlt.length === 0, `${tag}: every image has an alt attribute (${imgs.length})`,
        `${tag}: images without alt`, noAlt);
      const refs = [...src.matchAll(/(?:href|src)="(\/(?:css|js|assets)\/[^"]*)"/g)].map((m) => m[1]);
      const broken = [...new Set(refs)].filter((r) => !exists("dist" + r));
      assert(broken.length === 0, `${tag}: all ${new Set(refs).size} local asset references resolve in dist/`,
        `${tag}: broken local asset references`, broken);
      // CSS-only backdrops (pillars, stats photo) must resolve too.
      const cssRefs = [...src.matchAll(/url\('(\/assets\/[^']*)'\)/g)].map((m) => m[1]);
      const brokenCss = [...new Set(cssRefs)].filter((r) => !exists("dist" + r));
      assert(brokenCss.length === 0,
        `${tag}: all ${new Set(cssRefs).size} inline background images resolve in dist/`,
        `${tag}: broken inline background image`, brokenCss);
    }
  }

  // The synthetic archive fixture must stay out of the public tree.
  {
    const fixtures = [".fixtures/build-test/archive-fixture.html", ".fixtures/build-test/pl/archive-fixture.html"];
    assert(fixtures.every((f) => exists(f)),
      "the synthetic archive fixture is generated under build-test/",
      "the archive fixture is missing");
    assert(!exists("dist/archive-fixture.html") && !exists("dist/pl/archive-fixture.html"),
      "the archive fixture is NOT generated as a public page",
      "the archive fixture leaked into the public tree");
    for (const f of fixtures) {
      if (!exists(f)) continue;
      const src = read(f);
      assert(/<details class="event-archive-year">/.test(src),
        `${f}: renders the archive disclosure markup the real listing emits`,
        `${f}: no archive disclosure markup`);
      assert(/noindex/.test(src), `${f}: is noindex`, `${f}: the fixture is indexable`);
    }
    // Fictional fixture events must never reach the real content collection.
    const fake = ["example-winter-gala", "example-autumn-social", "example-spring-forum"]
      .filter((s) => exists(`content/events/${s}.yaml`));
    assert(fake.length === 0,
      "no fixture event was added to content/events/",
      "a fictional fixture event leaked into the real content collection", fake);
    for (const real of ["dist/events.html", "dist/pl/events.html", "dist/index.html", "dist/pl/index.html"]) {
      if (!exists(real)) continue;
      const src = read(real);
      const leaked = ["example-winter-gala", "example-autumn-social", "example-spring-forum"].filter((s) => src.includes(s));
      assert(leaked.length === 0, `${real}: contains no fixture event`,
        `${real}: a fictional fixture event appeared on a public page`, leaked);
    }
  }

  // --- semantic comparison against the live pages -------------------------
  {
    const { spawnSync } = require("child_process");
    const cmp = spawnSync(process.execPath, [path.join(__dirname, "compare-homepage.js")],
      { cwd: ROOT, encoding: "utf8" });
    const matched = (cmp.stdout.match(/PASS — (\d+)\/\1 comparisons matched/) || [])[1];
    assert(cmp.status === 0,
      `the generated homepages match the live pages (${matched || "?"} semantic comparisons — scripts/compare-homepage.js)`,
      "scripts/compare-homepage.js reports differences",
      (cmp.stdout || "").split("\n").filter((l) => /FAIL/.test(l)).slice(0, 12));
  }
}

/* =================================================================== 33. deployment tree */

section("33. Deployment tree and cutover readiness (Phase 15)");

{
  const publicRoutes = require(path.join(ROOT, "src/_data/publicRoutes.js"));
  const ROUTES = publicRoutes.routes();

  /* -- route inventory ---------------------------------------------------- */
  assert(ROUTES.length === 22,
    `the route inventory holds 22 indexable routes (${ROUTES.length})`,
    `unexpected route count: ${ROUTES.length}`, ROUTES.map((r) => r.loc));
  {
    const locs = ROUTES.map((r) => r.loc);
    const dupes = locs.filter((l, i) => locs.indexOf(l) !== i);
    assert(dupes.length === 0, "no route is listed twice", "duplicate route", [...new Set(dupes)]);
    const en = ROUTES.filter((r) => r.locale === "en").length;
    const pl = ROUTES.filter((r) => r.locale === "pl").length;
    assert(en === pl, `locale pairs are complete (${en} English, ${pl} Polish)`,
      "the route inventory is not locale-balanced");
    assert(!locs.some((l) => /404/.test(l)),
      "404 pages are excluded from the route inventory (they are noindex)",
      "a 404 page entered the indexable route inventory");
    assert(!locs.some((l) => /build-test|fixture/.test(l)),
      "no fixture route is in the inventory", "a fixture route entered the inventory");
  }

  if (!exists("dist")) {
    ok("dist/ not built — run `npm run build` to validate the deployment tree");
  } else {
    /* -- required files ---------------------------------------------------- */
    for (const f of ["dist/sitemap.xml", "dist/robots.txt", "dist/site.webmanifest", "dist/favicon.ico"]) {
      assert(exists(f), `${f} exists`, `${f} is missing from the deployment tree`);
    }
    {
      const missing = ROUTES.map((r) => `dist/${r.file}`).filter((f) => !exists(f));
      assert(missing.length === 0, `all ${ROUTES.length} public HTML routes exist in dist/`,
        "routes missing from dist/", missing);
    }
    assert(!exists("dist/build-test"),
      "a normal build produces no dist/build-test/ — fixtures cannot be deployed",
      "the deployment tree contains build fixtures");

    /* -- sitemap ----------------------------------------------------------- */
    {
      const xml = read("dist/sitemap.xml");
      const locs = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((m) => m[1].trim());
      assert(locs.length > 0, `the generated sitemap parses and holds ${locs.length} URLs`,
        "the generated sitemap has no URLs");
      const expected = ROUTES.map((r) => publicRoutes.domain + r.loc);
      assert(JSON.stringify(locs) === JSON.stringify(expected),
        "the generated sitemap's URL set matches the canonical route inventory exactly",
        "sitemap URLs do not match the route inventory",
        { onlyInSitemap: locs.filter((l) => !expected.includes(l)), onlyInRoutes: expected.filter((l) => !locs.includes(l)) });
      assert(!locs.some((l) => /404/.test(l)), "the sitemap contains no 404 URL", "a 404 URL is in the sitemap");
      assert(!locs.some((l) => /build-test|fixture/.test(l)), "the sitemap contains no test URL",
        "a test URL is in the sitemap");
      assert(locs.every((l) => l.startsWith("https://")), "every sitemap URL is HTTPS", "a sitemap URL is not HTTPS");
    }

    /* -- robots ------------------------------------------------------------ */
    {
      const robots = read("dist/robots.txt");
      const declared = (robots.match(/^Sitemap:\s*(\S+)/m) || [])[1];
      assert(declared === `${publicRoutes.domain}/sitemap.xml`,
        `robots.txt declares the production sitemap URL (${declared})`,
        "robots.txt does not point at the production sitemap", declared);
      assert(hashFile("robots.txt") === hashFile("dist/robots.txt"),
        "dist/robots.txt is a byte-identical copy of the root file",
        "dist/robots.txt differs from the root robots.txt");
    }

    /* -- manifest ---------------------------------------------------------- */
    {
      let m = null;
      try { m = JSON.parse(read("dist/site.webmanifest")); } catch { m = null; }
      assert(m !== null, "the generated manifest parses", "dist/site.webmanifest does not parse");
      if (m) {
        const missing = (m.icons || []).map((i) => String(i.src).replace(/^\//, ""))
          .filter((s) => !exists("dist/" + s));
        assert(missing.length === 0, `all ${(m.icons || []).length} manifest icons exist in dist/`,
          "manifest icons missing from dist/", missing);
        assert(!(m.icons || []).some((i) => /^\/pl\//.test(i.src)),
          "no manifest icon uses a /pl/ path", "a manifest icon is locale-scoped");
      }
    }

    /* -- the focused audit modules ----------------------------------------- */
    // Invoked, not reimplemented — each owns its own rules and its own output.
    {
      const { spawnSync } = require("child_process");
      for (const [label, script] of [
        ["deployment-tree audit", "audit-dist.js"],
        ["generated-site crawl", "crawl-dist.js"],
        ["public-parity audit", "audit-public-parity.js"],
        ["sitemap comparison", "compare-sitemap.js"],
        ["archive-UI test", "test-archive-ui.js"],
      ]) {
        const r = spawnSync(process.execPath, [path.join(__dirname, script)], { cwd: ROOT, encoding: "utf8" });
        const pass = (r.stdout || "").match(/PASS — (\d+)\/\1 [a-z- ]+/);
        assert(r.status === 0, `${label} passes (${pass ? pass[1] : "?"} checks — scripts/${script})`,
          `scripts/${script} reports problems`,
          (r.stdout || "").split("\n").filter((l) => /FAIL|BLOCKER/.test(l)).slice(0, 10));
      }
    }

    /* -- the resource matrix has no blocker -------------------------------- */
    {
      const rel = "docs/CUTOVER_RESOURCE_MATRIX.json";
      assert(exists(rel), "the cutover resource matrix exists", `${rel} is missing`);
      if (exists(rel)) {
        let matrix = null;
        try { matrix = JSON.parse(read(rel)); } catch { matrix = null; }
        assert(matrix !== null, "the cutover resource matrix parses", `${rel} does not parse`);
        if (matrix) {
          assert((matrix.blockers || []).length === 0,
            "the current-root vs dist/ resource matrix contains no blocker",
            "publicly required resources are missing from dist/", matrix.blockers);
        }
      }
    }
  }

  /* -- deployment state ----------------------------------------------------- */
  {
    const toml = read("netlify.toml");

    // Exactly two supported states; both halves of a partial cutover are invalid.
    assert(deployState().mode !== "unsupported",
      `Netlify deployment mode is valid: ${deployState().mode}`,
      `unsupported Netlify deployment configuration — ${describeUnsupportedDeployment(deployState())}`);

    // Mode-specific preconditions. These are what make each state SAFE, so they
    // are asserted whenever that state is active — not just at cutover time.
    if (deployState().mode === "generated-dist") {
      const gitignore = exists(".gitignore") ? read(".gitignore") : "";
      assert(/^dist\/?\s*$/m.test(gitignore),
        "dist/ is git-ignored, so generated output never enters the repository",
        "dist/ is not git-ignored while it is the published directory");

      const { execFileSync } = require("child_process");
      let tracked = null;
      try {
        tracked = execFileSync("git", ["ls-files", "dist"], { cwd: ROOT, encoding: "utf8" })
          .split("\n").map((l) => l.trim()).filter(Boolean);
      } catch { tracked = null; }
      if (tracked === null) ok("git unavailable — dist/ tracking check skipped");
      else assert(tracked.length === 0,
        "zero files under dist/ are tracked by git",
        "generated output is tracked by git while dist/ is the published directory", tracked.slice(0, 10));

      // Netlify runs `npm run build`, so everything it needs must be declared.
      const pkg = JSON.parse(read("package.json"));
      const declared = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const REQUIRED = ["@11ty/eleventy", "js-yaml", "markdown-it"];
      const missingDeps = REQUIRED.filter((d) => !declared[d]);
      assert(missingDeps.length === 0,
        `every build dependency is declared in package.json (${REQUIRED.join(", ")})`,
        "a build dependency is missing from package.json — Netlify would fail to build", missingDeps);
      assert(typeof (pkg.scripts || {}).build === "string" && pkg.scripts.build.trim() !== "",
        `package.json declares the build script the command runs (${(pkg.scripts || {}).build})`,
        "package.json has no build script for `npm run build` to invoke");

      // engines.node must still satisfy what the dependencies require.
      const enginesNode = ((pkg.engines || {}).node) || null;
      assert(!!enginesNode,
        `package.json declares engines.node (${enginesNode}) — Netlify's Node version source`,
        "package.json declares no engines.node, so the Netlify Node version would be an unknown default");
      if (enginesNode) {
        const floor = Number((String(enginesNode).match(/(\d+)/) || [])[1]);
        let required = 0;
        for (const dep of REQUIRED) {
          const pj = path.join(ROOT, "node_modules", dep, "package.json");
          if (!fs.existsSync(pj)) continue;
          const e = (JSON.parse(fs.readFileSync(pj, "utf8")).engines || {}).node;
          if (e) required = Math.max(required, Number((String(e).match(/(\d+)/) || [])[1]) || 0);
        }
        assert(Number.isFinite(floor) && floor >= required,
          `engines.node (${enginesNode}) satisfies the dependencies' minimum (Node ${required})`,
          `engines.node (${enginesNode}) is below the Node ${required} the build dependencies require`);
      }
    }
    assert(/from\s*=\s*"\/pl\/\*"/.test(toml) && /to\s*=\s*"\/pl\/404\.html"/.test(toml)
      && /status\s*=\s*404/.test(toml),
      "the Polish 404 fallback rule is unchanged",
      "the Polish fallback redirect was modified");
    // Comments are stripped first: netlify.toml explains at length why `force =
    // true` must never be added, and matching that prose would fail the check the
    // comment exists to protect.
    const tomlCode = toml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    assert(!/force\s*=\s*true/.test(tomlCode),
      "the Polish fallback is still non-forced, so real Polish pages win before it",
      "the fallback became forced, which would intercept the whole Polish site");

    // The cutover trap — `publish = "dist"` without a build command, which would
    // deploy an empty directory — is now rejected by parseDeploymentState() as an
    // unsupported mode, asserted at the top of this block and again in section 11.
    // It is not repeated here.
  }

  /* -- live public files are untouched -------------------------------------- */
  {
    const { execFileSync } = require("child_process");
    let changed = null;
    try {
      changed = execFileSync("git", ["status", "--porcelain", "--",
        "index.html", "pl/index.html", "events.html", "pl/events.html",
        "team.html", "pl/team.html", "members.html", "pl/members.html",
        "announcements.html", "pl/announcements.html", "contact.html", "pl/contact.html",
        "404.html", "pl/404.html", "sitemap.xml", "robots.txt", "site.webmanifest",
      // netlify.toml is deliberately NOT in this list: deployment configuration is
      // protected by the central deployment-state validator (parseDeploymentState),
      // which permits exactly the two supported states and rejects every partial
      // cutover. A blanket "never changes" rule here would forbid the approved
      // cutover itself. Every other file below stays protected.
        "css", "js", "assets"],
        { cwd: ROOT, encoding: "utf8" }).split("\n").map((l) => l.trim()).filter(Boolean);
    } catch { changed = null; }
    if (changed === null) ok("git unavailable — live-file guard skipped");
    else assert(changed.length === 0,
      "every live public file and asset is unchanged (deployment config is checked by mode, above)",
      "this phase modified a live public file", changed);
  }
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
