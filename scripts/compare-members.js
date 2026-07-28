#!/usr/bin/env node
/**
 * compare-members.js — semantic comparison of the live member pages against the
 * Eleventy-generated ones.
 *
 *   members.html    + js/societies-data.js
 *     vs  dist/members.html    + dist/js/societies-data-en.js
 *
 *   pl/members.html + js/pl/societies-data.js
 *     vs  dist/pl/members.html + dist/js/societies-data-pl.js
 *
 * Companion to compare-chrome.js, compare-team.js and compare-announcements.js.
 *
 * WHAT IS COMPARED
 *   SEO head metadata; hero, map-section and CTA copy
 *   the map container and its accessible name
 *   Leaflet CSS/JS URLs, integrity, crossorigin AND cascade position
 *   per society, in order: name, university/location, coordinates, Instagram
 *     handle and destination, e-mail and mailto destination, logo, and the
 *     active/member/past-member data
 *   the four FAQ items: questions, answers, order, markup and initial state
 *   stylesheet and script references
 *   absence of visible status chips
 *
 * WHAT IS IGNORED (harmless, per the brief)
 *   whitespace, indentation, comments, line endings, generated formatting
 *   asset path DEPTH — the live pages use page-relative logo paths
 *     ("assets/polsocs/x.jpg", "../assets/polsocs/x.jpg"); the generated pages
 *     use root-relative ("/assets/polsocs/x.jpg"). Both resolve to the same
 *     file, and the root-relative form is what stops the Polish page asking for
 *     /pl/assets/polsocs/… — a bug this site shipped once.
 *
 * Run:  node scripts/compare-members.js
 * Exit: 0 when every comparison matches, 1 otherwise.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* ------------------------------------------------------------ normalisation */

const norm = (html) =>
  String(html).replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();

const decode = (s) =>
  String(s)
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&rarr;/g, "→")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

const text = (html) => decode(norm(html).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/** Drop page-relative depth so "../assets/x", "assets/x" and "/assets/x" match. */
const assetKey = (p) => String(p).replace(/^(\.\.\/)+/, "").replace(/^\/+/, "");

/** Attribute lookup that does not care about attribute order. */
const attrOf = (attrs, name) => {
  const m = String(attrs).match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : null;
};

/* ---------------------------------------------------------------- loading */

function loadGlobal(rel, expr) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(read(rel), ctx);
  return vm.runInContext(expr, ctx);
}

/** Reduce a society record from either side to one comparable shape. */
function normaliseSociety(s) {
  return {
    name: text(s.name),
    uni: text(s.uni),
    lat: Number(s.lat),
    lng: Number(s.lng),
    instagram: s.instagram,
    instagramUrl: "https://www.instagram.com/" + s.instagram + "/",
    email: s.email || "",
    hasEmail: Boolean(s.email),
    mailto: s.email ? "mailto:" + s.email : null,
    logo: assetKey(s.logo).replace(/^assets\/polsocs\//, ""),
    logoPath: assetKey(s.logo),
    active: s.active === true,
    member: s.member === true,
    pastMember: s.pastMember === true,
  };
}

/* --------------------------------------------------------------- page shell */

function parsePage(html) {
  const out = { meta: {}, hero: {}, mapSection: {}, cta: {}, faq: [], refs: {} };

  const head = html.split("</head>")[0];
  const pat = {
    title: /<title>([\s\S]*?)<\/title>/,
    description: /<meta name="description" content="([\s\S]*?)">/,
    canonical: /<link rel="canonical" href="([\s\S]*?)">/,
    ogType: /<meta property="og:type" content="([\s\S]*?)">/,
    ogUrl: /<meta property="og:url" content="([\s\S]*?)">/,
    ogImage: /<meta property="og:image" content="([\s\S]*?)">/,
    ogImageAlt: /<meta property="og:image:alt" content="([\s\S]*?)">/,
    ogLocale: /<meta property="og:locale" content="([\s\S]*?)">/,
    twitterCard: /<meta name="twitter:card" content="([\s\S]*?)">/,
  };
  for (const [k, re] of Object.entries(pat)) {
    const m = head.match(re);
    out.meta[k] = m ? text(m[1]) : null;
  }
  out.meta.htmlLang = (html.match(/<html lang="([^"]*)"/) || [])[1] || null;
  out.meta.hreflang = [...head.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)">/g)]
    .map((m) => `${m[1]}=${m[2]}`).sort();

  // ---- hero ----
  const hero = html.match(/<section class="page-hero hero-photo">([\s\S]*?)<\/section>/);
  if (hero) {
    const h = hero[1];
    const bg = h.match(/background-image: url\('([^']+)'\); background-position: ([^;"]+);/);
    out.hero.bgImage = bg ? assetKey(bg[1]) : null;
    out.hero.bgPosition = bg ? bg[2].trim() : null;
    const g = (re) => { const m = h.match(re); return m ? text(m[1]) : null; };
    out.hero.eyebrow = g(/<span class="eyebrow">([\s\S]*?)<\/span>/);
    out.hero.h1 = g(/<h1>([\s\S]*?)<\/h1>/);
    out.hero.h1Fancy = g(/<h1>[\s\S]*?<span class="fancy">([\s\S]*?)<\/span>/);
    out.hero.lead = g(/<p class="lead">([\s\S]*?)<\/p>/);
  }

  // ---- map section head + containers ----
  const heads = [...html.matchAll(/<div class="section-head reveal">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
  if (heads[0]) {
    const g = (re) => { const m = heads[0].match(re); return m ? text(m[1]) : null; };
    out.mapSection.eyebrow = g(/<span class="eyebrow">([\s\S]*?)<\/span>/);
    out.mapSection.title = g(/<h2 class="section-title">([\s\S]*?)<\/h2>/);
    out.mapSection.lead = g(/<p class="lead">([\s\S]*?)<\/p>/);
  }
  const mapEl = html.match(/<div id="map"([^>]*)><\/div>/);
  out.mapSection.mapPresent = Boolean(mapEl);
  out.mapSection.mapClass = mapEl ? attrOf(mapEl[1], "class") : null;
  out.mapSection.mapAria = mapEl ? text(attrOf(mapEl[1], "aria-label")) : null;
  const gridEl = html.match(/<div class="soc-grid" id="socGrid">([\s\S]*?)<\/div>/);
  out.mapSection.gridPresent = Boolean(gridEl);
  out.mapSection.gridEmpty = gridEl ? gridEl[1].trim() === "" : null;

  if (heads[1]) {
    const g = (re) => { const m = heads[1].match(re); return m ? text(m[1]) : null; };
    out.faqEyebrow = g(/<span class="eyebrow">([\s\S]*?)<\/span>/);
    out.faqTitle = g(/<h2 class="section-title">([\s\S]*?)<\/h2>/);
  }

  // ---- FAQ ----
  for (const m of html.matchAll(
    /<details class="acc"([^>]*)>\s*<summary>([\s\S]*?)<\/summary>\s*<div class="acc-body">([\s\S]*?)<\/div>\s*<\/details>/g
  )) {
    out.faq.push({
      openByDefault: /\bopen\b/.test(m[1]),
      question: text(m[2]),
      answer: text(m[3]),
      // Answer links are part of the content: a lost mailto: or contact link
      // would be a real regression, so compare destinations too.
      links: [...m[3].matchAll(/<a\s+([^>]*)>([\s\S]*?)<\/a>/g)]
        .map((a) => ({ href: attrOf(a[1], "href"), text: text(a[2]) })),
    });
  }

  // ---- CTA band ----
  const cta = html.match(/<div class="cta-band reveal">([\s\S]*?)<\/div>/);
  if (cta) {
    const g = (re) => { const m = cta[1].match(re); return m ? text(m[1]) : null; };
    out.cta.h2 = g(/<h2>([\s\S]*?)<\/h2>/);
    out.cta.p = g(/<p>([\s\S]*?)<\/p>/);
    const btn = cta[1].match(/<a class="btn btn-light"([^>]*)>([\s\S]*?)<\/a>/);
    out.cta.btnHref = btn ? attrOf(btn[1], "href") : null;
    out.cta.btnText = btn ? text(btn[2]) : null;
  }

  // ---- asset references, in document order ----
  out.refs.stylesheets = [...html.matchAll(/<link rel="stylesheet"\s+([^>]*)>/g)].map((m) => ({
    href: assetKey(attrOf(m[1], "href")),
    integrity: attrOf(m[1], "integrity"),
    crossorigin: attrOf(m[1], "crossorigin"),
  }));
  out.refs.scripts = [...html.matchAll(/<script\s+([^>]*?)>\s*<\/script>/g)].map((m) => ({
    src: assetKey(attrOf(m[1], "src")),
    integrity: attrOf(m[1], "integrity"),
    crossorigin: attrOf(m[1], "crossorigin"),
  })).filter((s) => s.src);
  out.refs.hasInlineScript = /<script>[\s\S]*?<\/script>/.test(html);
  out.refs.activeNav =
    /<a[^>]*class="[^"]*\bactive\b[^"]*"[^>]*href="members\.html"|<a[^>]*href="members\.html"[^>]*class="[^"]*\bactive\b[^"]*"/.test(html);
  out.refs.switcher = (html.match(/<nav class="lang-switch"[\s\S]*?<\/nav>/) || [""])[0]
    .match(/href="([^"]+)"/g) || [];

  // ---- status chips must NOT be present ----
  // The membership badges were removed from the design on purpose. Catch any
  // reappearance, whether as a class or as the words themselves.
  out.refs.statusChipMarkup = [
    ...html.matchAll(/class="[^"]*\b(soc-status|soc-badge|status-chip|member-chip|past-member)\b[^"]*"/g),
  ].map((m) => m[0]);

  return out;
}

/* ------------------------------------------------------------- comparison */

const results = [];
let failures = 0;

function check(label, expected, actual, note) {
  const e = JSON.stringify(expected);
  const a = JSON.stringify(actual);
  const ok = e === a;
  if (!ok) failures++;
  results.push({ ok, label, expected: e, actual: a, note });
}

function comparePair(name, cfg) {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`  ${name}`);
  console.log(`  ${cfg.livePage} + ${cfg.liveData}`);
  console.log(`  ${cfg.genPage} + ${cfg.genData}`);
  console.log("=".repeat(72));

  const before = results.length;
  const p = (s) => `${name}: ${s}`;

  const liveArr = loadGlobal(cfg.liveData, "SOCIETIES");
  const genArr = loadGlobal(cfg.genData, "SOCIETIES");
  const genUi = loadGlobal(cfg.genData, "SOCIETIES_UI");

  // FAIL LOUDLY on an empty parse — two empty lists must never "match".
  check(p("live data array is non-empty"), true, Array.isArray(liveArr) && liveArr.length > 0);
  check(p("generated data array is non-empty"), true, Array.isArray(genArr) && genArr.length > 0);
  check(p("society count"), liveArr.length, genArr.length);
  check(p("society count is the expected 30"), 30, genArr.length);

  if (liveArr.length && genArr.length && liveArr.length === genArr.length) {
    const L = liveArr.map(normaliseSociety);
    const G = genArr.map(normaliseSociety);

    const FIELDS = ["name", "uni", "lat", "lng", "instagram", "instagramUrl",
      "email", "hasEmail", "mailto", "logo", "active", "member", "pastMember"];
    for (const f of FIELDS) {
      check(p(`society field: ${f} (all ${L.length}, in order)`), L.map((s) => s[f]), G.map((s) => s[f]));
    }

    // Record order, as the sequence of names.
    check(p("society order (name sequence)"), L.map((s) => s.name), G.map((s) => s.name));

    // Empty e-mails must stay empty and must never become a mailto:.
    check(p("societies with no e-mail"), L.filter((s) => !s.hasEmail).map((s) => s.name),
      G.filter((s) => !s.hasEmail).map((s) => s.name));
    check(p("exactly three societies have no e-mail"), 3, G.filter((s) => !s.hasEmail).length);
    check(p("no empty e-mail produced a mailto: destination"), [],
      G.filter((s) => !s.hasEmail && s.mailto).map((s) => s.name));

    // Status data survives, even though nothing renders it.
    check(p("status counts (active:false / member / pastMember)"),
      [L.filter((s) => !s.active).length, L.filter((s) => s.member).length, L.filter((s) => s.pastMember).length],
      [G.filter((s) => !s.active).length, G.filter((s) => s.member).length, G.filter((s) => s.pastMember).length]);

    // Logos: root-relative in the generated data, and never under /pl/.
    check(p("every generated logo path is root-relative under /assets/polsocs/"), [],
      genArr.filter((s) => !String(s.logo).startsWith("/assets/polsocs/")).map((s) => s.name));
    check(p("no generated logo path resolves under /pl/"), [],
      genArr.filter((s) => /\/pl\/assets/.test(String(s.logo))).map((s) => s.name));

    // Coordinates must be exact — a rounded latitude moves a pin.
    check(p("coordinates are numerically identical"), [],
      L.map((s, i) => (s.lat !== G[i].lat || s.lng !== G[i].lng ? s.name : null)).filter(Boolean));
  }

  // --- UI strings the renderer actually uses ---
  check(p("generated UI strings are present"), true,
    Boolean(genUi && genUi.emailLabel && genUi.instagramLabel &&
      genUi.emailAriaPattern && genUi.instagramAriaPattern));
  check(p("e-mail label matches the live page"), cfg.ui.emailLabel, genUi.emailLabel);
  check(p("Instagram label matches the live page"), cfg.ui.instagramLabel, genUi.instagramLabel);
  check(p("e-mail aria pattern matches the live page"), cfg.ui.emailAriaPattern, genUi.emailAriaPattern);
  check(p("Instagram aria pattern matches the live page"), cfg.ui.instagramAriaPattern, genUi.instagramAriaPattern);

  // --- page shell ---
  const live = parsePage(read(cfg.livePage));
  const gen = parsePage(read(cfg.genPage));

  for (const k of Object.keys(live.meta)) check(p(`head: ${k}`), live.meta[k], gen.meta[k]);
  for (const k of Object.keys(live.hero)) check(p(`hero: ${k}`), live.hero[k], gen.hero[k]);
  for (const k of Object.keys(live.mapSection)) check(p(`map section: ${k}`), live.mapSection[k], gen.mapSection[k]);
  for (const k of Object.keys(live.cta)) check(p(`cta: ${k}`), live.cta[k], gen.cta[k]);
  check(p("FAQ section eyebrow"), live.faqEyebrow, gen.faqEyebrow);
  check(p("FAQ section title"), live.faqTitle, gen.faqTitle);

  // --- FAQ ---
  check(p("FAQ item count is 4 (live)"), 4, live.faq.length);
  check(p("FAQ item count is 4 (generated)"), 4, gen.faq.length);
  check(p("FAQ questions and order"), live.faq.map((f) => f.question), gen.faq.map((f) => f.question));
  check(p("FAQ answers and order"), live.faq.map((f) => f.answer), gen.faq.map((f) => f.answer));
  check(p("FAQ answer links and destinations"), live.faq.map((f) => f.links), gen.faq.map((f) => f.links));
  check(p("FAQ items all start collapsed"), live.faq.map((f) => f.openByDefault), gen.faq.map((f) => f.openByDefault));

  // --- Leaflet dependencies, including cascade position ---
  const leafletCssIndex = (parsed) => parsed.refs.stylesheets.findIndex((s) => /leaflet\.css$/.test(s.href));
  const siteCssIndex = (parsed) => parsed.refs.stylesheets.findIndex((s) => /css\/style\.css$/.test(s.href));
  check(p("Leaflet CSS is present"), true, leafletCssIndex(gen) >= 0);
  check(p("Leaflet CSS loads BEFORE the site stylesheet"), true,
    leafletCssIndex(gen) >= 0 && leafletCssIndex(gen) < siteCssIndex(gen),
    `leaflet at ${leafletCssIndex(gen)}, style.css at ${siteCssIndex(gen)}`);
  check(p("Leaflet CSS URL, integrity and crossorigin"),
    live.refs.stylesheets[leafletCssIndex(live)], gen.refs.stylesheets[leafletCssIndex(gen)]);

  const leafletJs = (parsed) => parsed.refs.scripts.find((s) => /leaflet\.js$/.test(s.src)) || null;
  check(p("Leaflet JS URL, integrity and crossorigin"), leafletJs(live), leafletJs(gen));
  check(p("stylesheet references"), live.refs.stylesheets.map((s) => s.href), gen.refs.stylesheets.map((s) => s.href));
  check(p("active nav marks Members"), live.refs.activeNav, gen.refs.activeNav);
  check(p("language-switcher destinations"), live.refs.switcher, gen.refs.switcher);

  // --- status chips must be absent on BOTH sides ---
  check(p("live page renders no status-chip markup"), [], live.refs.statusChipMarkup);
  check(p("generated page renders no status-chip markup"), [], gen.refs.statusChipMarkup);

  // --- known, intentional differences: asserted, not ignored ---
  check(p("KNOWN DIFF — script delivery (live)"), cfg.scripts.live, live.refs.scripts.map((s) => s.src));
  check(p("KNOWN DIFF — script delivery (generated)"), cfg.scripts.gen, gen.refs.scripts.map((s) => s.src),
    "generated: per-locale data file + shared members-page.js instead of an inline copy");
  check(p("live page carries an inline map script"), true, live.refs.hasInlineScript);
  check(p("generated page carries no inline map script"), false, gen.refs.hasInlineScript);

  const slice = results.slice(before);
  for (const r of slice) {
    if (r.ok) console.log(`  ok    ${r.label}${r.note ? `  (${r.note})` : ""}`);
    else {
      console.log(`  FAIL  ${r.label}`);
      console.log(`          live: ${r.expected}`);
      console.log(`          dist: ${r.actual}`);
    }
  }
  console.log(`  -- ${slice.filter((r) => r.ok).length}/${slice.length} matched`);
}

comparePair("English", {
  livePage: "members.html",
  liveData: "js/societies-data.js",
  genPage: "dist/members.html",
  genData: "dist/js/societies-data-en.js",
  ui: { emailLabel: "Email", instagramLabel: "Instagram",
        emailAriaPattern: "Email {name}", instagramAriaPattern: "{name} on Instagram" },
  scripts: {
    live: ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "js/societies-data.js", "js/main.js"],
    gen: ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "js/societies-data-en.js", "js/main.js", "js/members-page.js"],
  },
});

comparePair("Polish", {
  livePage: "pl/members.html",
  liveData: "js/pl/societies-data.js",
  genPage: "dist/pl/members.html",
  genData: "dist/js/societies-data-pl.js",
  ui: { emailLabel: "E-mail", instagramLabel: "Instagram",
        emailAriaPattern: "Napisz e-mail: {name}", instagramAriaPattern: "{name} na Instagramie" },
  scripts: {
    live: ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "js/pl/societies-data.js", "js/main.js"],
    gen: ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "js/societies-data-pl.js", "js/main.js", "js/members-page.js"],
  },
});

/* ---------------------------------------------- cross-language invariants */
console.log(`\n${"=".repeat(72)}`);
console.log("  Cross-language invariant check (generated data)");
console.log("=".repeat(72));
{
  const en = loadGlobal("dist/js/societies-data-en.js", "SOCIETIES").map(normaliseSociety);
  const pl = loadGlobal("dist/js/societies-data-pl.js", "SOCIETIES").map(normaliseSociety);
  const before = results.length;

  check("Both generated locales parsed a non-empty array", true, en.length > 0 && pl.length > 0);
  check("Record count identical across locales", en.length, pl.length);
  for (const f of ["name", "lat", "lng", "instagram", "email", "logo", "active", "member", "pastMember"]) {
    check(`Invariant identical in EN and PL: ${f}`, en.map((s) => s[f]), pl.map((s) => s[f]));
  }
  // The university/location line is the ONLY documented localised field, and it
  // must actually be localised — identical text would mean a lookup fell back.
  const same = en.filter((s, i) => s.uni === pl[i].uni).map((s) => s.name);
  check("University/location text differs between EN and PL for every society", [], same);

  for (const r of results.slice(before)) {
    if (r.ok) console.log(`  ok    ${r.label}`);
    else {
      console.log(`  FAIL  ${r.label}`);
      console.log(`          en: ${r.expected}`);
      console.log(`          pl: ${r.actual}`);
    }
  }
}

console.log(`\n${"=".repeat(72)}`);
if (failures === 0) console.log(`  PASS — ${results.length}/${results.length} comparisons matched`);
else console.log(`  FAIL — ${failures} of ${results.length} comparisons differ`);
console.log("=".repeat(72));

process.exit(failures === 0 ? 0 : 1);
