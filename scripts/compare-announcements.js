#!/usr/bin/env node
/**
 * compare-announcements.js — semantic comparison of the live announcements
 * against the Eleventy-generated ones.
 *
 *   announcements.html    + js/announcements-data.js
 *     vs  dist/announcements.html    + dist/js/announcements-data-en.js
 *
 *   pl/announcements.html + js/pl/announcements-data.js
 *     vs  dist/pl/announcements.html + dist/js/announcements-data-pl.js
 *
 * Companion to compare-chrome.js (header/nav/footer) and compare-team.js.
 *
 * WHAT IS COMPARED
 *   page heading, eyebrow and lead copy; SEO head metadata
 *   modal structure and its accessibility attributes
 *   stylesheet and script references
 *   per announcement, in order: date, title, subtitle, body text, body links,
 *     main image, image position, fit, background, extra images, closed status,
 *     link label, link destination and external-vs-relative behaviour
 *
 * WHAT IS IGNORED (harmless, per the brief)
 *   whitespace, indentation, line endings, comments, generated formatting
 *   HTML-entity spelling in body text: the live bodies are injected raw, so a
 *     literal "&" reaches the DOM as "&"; markdown-it emits "&amp;", which the
 *     browser renders identically. Bodies are compared as DECODED TEXT plus a
 *     structured list of their links, which is what a reader actually gets.
 *
 * Run:  node scripts/compare-announcements.js
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
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

const text = (html) => decode(norm(html).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/** Drop page-relative depth so "../assets/x", "assets/x" and "/assets/x" match. */
const assetKey = (p) => String(p).replace(/^(\.\.\/)+/, "").replace(/^\/+/, "");

/** Body -> plain reading text, whitespace-normalised, entities resolved. */
const bodyText = (body) => text(String(body).replace(/\n+/g, " "));

/** Body -> ordered list of its links, as a reader would follow them. */
function bodyLinks(body) {
  return [...String(body).matchAll(/<a\s+([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => {
    const attrs = m[1];
    const at = (n) => {
      const v = attrs.match(new RegExp(n + '="([^"]*)"'));
      return v ? v[1] : null;
    };
    return { href: at("href"), target: at("target"), rel: at("rel"), text: text(m[2]) };
  });
}

/** Paragraph count, from blank lines (live) or from the rendered separator. */
const paraCount = (body) => String(body).trim().split(/\n{2,}/).filter(Boolean).length;

/* ---------------------------------------------------------------- loading */

function loadArray(rel, expr) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(read(rel), ctx);
  return vm.runInContext(expr, ctx);
}

/** Reduce a record from either side to one comparable shape. */
function normaliseRecord(a) {
  const body = a.bodyHtml != null ? a.bodyHtml : a.body;
  return {
    date: a.date,
    title: text(a.title),
    subtitle: text(a.subtitle),
    bodyText: bodyText(body),
    bodyLinks: bodyLinks(body),
    paragraphs: paraCount(body),
    image: a.image ? assetKey(a.image) : null,
    imagePos: a.imagePos || null,
    fit: a.fit || null,
    bg: a.bg || null,
    extraImages: (a.extraImages || []).map(assetKey),
    closed: !!a.closed,
    linkHref: a.link ? a.link.href : null,
    linkText: a.link ? text(a.link.text) : null,
    linkExternal: a.link ? !!a.link.external : null,
  };
}

/* --------------------------------------------------------------- page shell */

function parsePage(html) {
  const out = { meta: {}, hero: {}, modal: {}, refs: {} };

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

  // Card container must be present and EMPTY in the served HTML — the cards
  // are injected by script on both sides.
  const gridM = html.match(/<div class="ann-grid" id="annGrid">([\s\S]*?)<\/div>/);
  out.refs.gridPresent = Boolean(gridM);
  out.refs.gridEmpty = gridM ? gridM[1].trim() === "" : null;

  const modalM = html.match(/<div class="modal" id="annModal"([^>]*)>([\s\S]*?)<footer/);
  if (modalM) {
    const attrs = modalM[1];
    const body = modalM[2];
    const at = (src, n) => { const v = src.match(new RegExp(n + '="([^"]*)"')); return v ? v[1] : null; };
    out.modal.role = at(attrs, "role");
    out.modal.ariaModal = at(attrs, "aria-modal");
    out.modal.ariaLabel = at(attrs, "aria-label");
    // Attribute-order agnostic: pinning class-then-id has silently matched
    // nothing before when an attribute was added (see the Phase 5 note in
    // compare-team.js). Collect every <button> in the modal, then pick the
    // close controls by class.
    const buttons = [...body.matchAll(/<button\s+([^>]*?)>([\s\S]*?)<\/button>/g)]
      .map((m) => ({ attrs: m[1], inner: m[2] }))
      .filter((b) => /class="[^"]*\bmodal-close\b/.test(b.attrs));
    out.modal.closeControlCount = buttons.length;
    const closeM = buttons[0];
    out.modal.closeIsNativeButton = buttons.length > 0;
    out.modal.closeId = closeM ? at(closeM.attrs, "id") : null;
    out.modal.closeClass = closeM ? at(closeM.attrs, "class") : null;
    out.modal.closeAriaLabel = closeM ? at(closeM.attrs, "aria-label") : null;
    out.modal.closeAriaLabelNonEmpty = Boolean(closeM && (at(closeM.attrs, "aria-label") || "").trim());
    out.modal.closeGlyph = closeM ? closeM.inner.trim() : null;
    out.modal.ids = [...body.matchAll(/id="(annModal\w*)"/g)].map((m) => m[1]).sort();
    out.modal.hasAnnText = /<div class="ann-text" id="annModalBody">/.test(body);
  }

  out.refs.stylesheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => assetKey(m[1]));
  out.refs.scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => assetKey(m[1]));
  out.refs.hasInlineScript = /<script>[\s\S]*?<\/script>/.test(html);
  out.refs.activeNav = /<a[^>]*class="[^"]*\bactive\b[^"]*"[^>]*href="announcements\.html"|<a[^>]*href="announcements\.html"[^>]*class="[^"]*\bactive\b[^"]*"/.test(html);
  out.refs.switcher = (html.match(/<nav class="lang-switch"[\s\S]*?<\/nav>/) || [""])[0]
    .match(/href="([^"]+)"/g) || [];

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

  const liveArr = loadArray(cfg.liveData, "ANNOUNCEMENTS");
  const genArr = loadArray(cfg.genData, "ANNOUNCEMENTS");
  const genUi = loadArray(cfg.genData, "ANNOUNCEMENTS_UI");

  // FAIL LOUDLY on an empty parse — two empty lists must never "match".
  check(p("live data array is non-empty"), true, Array.isArray(liveArr) && liveArr.length > 0);
  check(p("generated data array is non-empty"), true, Array.isArray(genArr) && genArr.length > 0);
  check(p("announcement count"), liveArr.length, genArr.length);

  if (liveArr.length && genArr.length && liveArr.length === genArr.length) {
    const L = liveArr.map(normaliseRecord);
    const G = genArr.map(normaliseRecord);

    const FIELDS = ["date", "title", "subtitle", "bodyText", "bodyLinks", "paragraphs",
      "image", "imagePos", "fit", "bg", "extraImages", "closed",
      "linkHref", "linkText", "linkExternal"];
    for (const f of FIELDS) {
      check(p(`record field: ${f} (all ${L.length}, in order)`), L.map((r) => r[f]), G.map((r) => r[f]));
    }

    // Order is the sequence of titles: a reordering would slip past field-wise
    // set comparisons but not this.
    check(p("announcement order (title sequence)"), L.map((r) => r.title), G.map((r) => r.title));

    // Event links must stay RELATIVE so each language resolves to its own page.
    const rel = (arr) => arr.filter((r) => r.linkHref && !r.linkExternal).map((r) => r.linkHref);
    check(p("internal link hrefs are relative, not root-relative"),
      rel(L).filter(() => true), rel(G));
    check(p("no internal link became root-relative"), [], rel(G).filter((h) => h.startsWith("/")));

    // External links keep their external behaviour.
    const ext = (arr) => arr.filter((r) => r.linkExternal).map((r) => r.linkHref);
    check(p("external link destinations"), ext(L), ext(G));

    // No image may resolve under /pl/ — the bug that shipped once already.
    const imgs = G.flatMap((r) => [r.image, ...r.extraImages]).filter(Boolean);
    check(p("no generated image path resolves under pl/"), [], imgs.filter((i) => /^pl\//.test(i)));
    check(p("every generated image path is root-relative in the raw data"), [],
      genArr.flatMap((a) => [a.image, ...(a.extraImages || [])]).filter(Boolean)
        .filter((i) => !String(i).startsWith("/")));
  }

  // --- UI strings actually used by the renderer ---
  check(p("generated UI strings are present"), true,
    Boolean(genUi && genUi.readMore && genUi.signupsClosed && genUi.closeLabel));
  check(p('"read more" label matches the live page'), cfg.ui.readMore, genUi.readMore);
  check(p('"sign-ups closed" label matches the live page'), cfg.ui.signupsClosed, genUi.signupsClosed);
  check(p("extra-image alt pattern matches the live page"), cfg.ui.extraImageAltPattern, genUi.extraImageAltPattern);

  // --- page shell ---
  const live = parsePage(read(cfg.livePage));
  const gen = parsePage(read(cfg.genPage));

  for (const k of Object.keys(live.hero)) check(p(`hero: ${k}`), live.hero[k], gen.hero[k]);
  for (const k of Object.keys(live.meta)) check(p(`head: ${k}`), live.meta[k], gen.meta[k]);
  for (const k of Object.keys(live.modal)) check(p(`modal: ${k}`), live.modal[k], gen.modal[k]);

  // --- close control: absolute requirements on BOTH sides -------------------
  // The Phase 7 layering fix is CSS-only, so the markup must be unchanged; these
  // assert the control the fix targets is present, unique and named.
  for (const [side, parsed] of [["live", live], ["generated", gen]]) {
    check(p(`${side}: exactly one .modal-close control`), 1, parsed.modal.closeControlCount);
    check(p(`${side}: the close control is a native <button>`), true, parsed.modal.closeIsNativeButton);
    check(p(`${side}: the close control carries class "modal-close"`), "modal-close", parsed.modal.closeClass);
    check(p(`${side}: the close control has a non-empty accessible name`), true, parsed.modal.closeAriaLabelNonEmpty);
  }

  check(p("card container present"), true, gen.refs.gridPresent);
  check(p("card container is empty in served HTML"), live.refs.gridEmpty, gen.refs.gridEmpty);
  check(p("stylesheet references"), live.refs.stylesheets, gen.refs.stylesheets);
  check(p("active nav marks News"), live.refs.activeNav, gen.refs.activeNav);
  // Compared against the live page rather than a hard-coded list: an
  // expectation typed by hand is a second source of truth that can itself be
  // wrong, which is exactly what happened while writing this script.
  check(p("language-switcher destinations"), live.refs.switcher, gen.refs.switcher);
  check(p("language switcher offers both languages"), 2, gen.refs.switcher.length);

  // --- known, intentional differences: asserted, not ignored ---
  check(p("KNOWN DIFF — script delivery (live)"), cfg.scripts.live, live.refs.scripts);
  check(p("KNOWN DIFF — script delivery (generated)"), cfg.scripts.gen, gen.refs.scripts,
    "generated: per-locale data file + shared announcements-page.js instead of an inline copy");
  check(p("live page carries an inline renderer"), true, live.refs.hasInlineScript);
  check(p("generated page carries no inline renderer"), false, gen.refs.hasInlineScript);

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
  livePage: "announcements.html",
  liveData: "js/announcements-data.js",
  genPage: "dist/announcements.html",
  genData: "dist/js/announcements-data-en.js",
  ui: { readMore: "Read more →", signupsClosed: "Sign-ups closed", extraImageAltPattern: "{title} — photo {n}" },
  switcher: ['href="/announcements.html"', 'href="/pl/announcements.html"'],
  scripts: {
    live: ["js/announcements-data.js", "js/main.js"],
    gen: ["js/announcements-data-en.js", "js/main.js", "js/announcements-page.js"],
  },
});

comparePair("Polish", {
  livePage: "pl/announcements.html",
  liveData: "js/pl/announcements-data.js",
  genPage: "dist/pl/announcements.html",
  genData: "dist/js/announcements-data-pl.js",
  ui: { readMore: "Czytaj więcej →", signupsClosed: "Nabór zakończony", extraImageAltPattern: "{title} — zdjęcie {n}" },
  switcher: ['href="/pl/announcements.html"', 'href="/announcements.html"'],
  scripts: {
    live: ["js/pl/announcements-data.js", "js/main.js"],
    gen: ["js/announcements-data-pl.js", "js/main.js", "js/announcements-page.js"],
  },
});

/* ---------------------------------------------- cross-language invariants */
console.log(`\n${"=".repeat(72)}`);
console.log("  Cross-language invariant check (generated data)");
console.log("=".repeat(72));
{
  const en = loadArray("dist/js/announcements-data-en.js", "ANNOUNCEMENTS").map(normaliseRecord);
  const pl = loadArray("dist/js/announcements-data-pl.js", "ANNOUNCEMENTS").map(normaliseRecord);
  const before = results.length;
  for (const f of ["image", "imagePos", "fit", "bg", "extraImages", "closed", "linkHref", "linkExternal"]) {
    check(`Invariant identical in EN and PL: ${f}`, en.map((r) => r[f]), pl.map((r) => r[f]));
  }
  // A title identical in both languages usually means a locale lookup fell
  // back to English. It is not automatically wrong, though: announcement #25
  // is a conference whose proper name stays in English in the Polish copy
  // (its subtitle IS translated). So the check is that the set of identical
  // titles matches the LIVE data's, not that the set is empty — that catches a
  // real fallback while accepting a deliberately untranslated proper noun.
  const liveEn = loadArray("js/announcements-data.js", "ANNOUNCEMENTS").map(normaliseRecord);
  const livePl = loadArray("js/pl/announcements-data.js", "ANNOUNCEMENTS").map(normaliseRecord);
  check("Titles left untranslated match the live data exactly",
    liveEn.filter((r, i) => r.title === livePl[i].title).map((r) => r.title),
    en.filter((r, i) => r.title === pl[i].title).map((r) => r.title));
  check("Subtitles and bodies are translated for every announcement", [],
    en.filter((r, i) => r.subtitle === pl[i].subtitle || r.bodyText === pl[i].bodyText)
      .map((r) => r.title));
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
