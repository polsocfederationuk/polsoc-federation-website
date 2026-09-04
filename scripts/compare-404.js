#!/usr/bin/env node
/**
 * compare-404.js — semantic comparison of the live 404 pages against the
 * Eleventy-generated ones.
 *
 *   404.html     vs  dist/404.html
 *   pl/404.html  vs  dist/pl/404.html
 *
 * These are NOT ordinary page pairs, and the checks reflect that. As well as
 * comparing content, this script asserts the deliberate ABSENCES — no canonical,
 * no hreflang, no Open Graph — because a well-meaning "fix" that made the 404
 * pages look like normal pages would make them indexable, and that is the one
 * thing they must never be.
 *
 * WHAT IS COMPARED
 *   <html lang>, robots metadata, title, description
 *   absence of canonical / hreflang / Open Graph / Twitter
 *   hero eyebrow, heading, lead, and both call-to-action buttons
 *   the three "where to next" cards: headings, text, more-labels, destinations
 *   branding (logo, brand rows), navigation, language switcher, footer
 *   asset references
 *   ROOT-RELATIVE link behaviour — every internal href must start with "/"
 *
 * WHAT IS IGNORED (harmless)
 *   whitespace, indentation, comments, line endings, attribute order
 *
 * Run:  node scripts/compare-404.js
 * Exit: 0 when every comparison matches, 1 otherwise.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const norm = (html) =>
  String(html).replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();

const decode = (s) =>
  String(s)
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&rarr;/g, "→")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

const text = (html) => decode(norm(html).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

const attrOf = (attrs, name) => {
  const m = String(attrs).match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : null;
};

/* --------------------------------------------------------------- extraction */

function parse(html) {
  const out = { meta: {}, hero: { cta: [] }, cards: [], chrome: {}, refs: {} };

  const head = html.split("</head>")[0];
  out.meta.htmlLang = (html.match(/<html lang="([^"]*)"/) || [])[1] || null;
  out.meta.title = (head.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || null;
  out.meta.description = (head.match(/<meta name="description" content="([\s\S]*?)">/) || [])[1] || null;
  out.meta.robots = (head.match(/<meta name="robots" content="([\s\S]*?)">/) || [])[1] || null;

  // The deliberate absences. Counted, not merely tested, so a partial
  // reintroduction is visible in the failure message.
  out.meta.canonicalCount = (head.match(/rel="canonical"/g) || []).length;
  out.meta.hreflangCount = (head.match(/hreflang="/g) || []).length -
    // the language switcher's own hreflang attributes live in <body>, not <head>
    0;
  out.meta.ogCount = (head.match(/property="og:/g) || []).length;
  out.meta.twitterCount = (head.match(/name="twitter:/g) || []).length;

  const hero = html.match(/<section class="page-hero">([\s\S]*?)<\/section>/);
  if (hero) {
    const g = (re) => { const m = hero[1].match(re); return m ? text(m[1]) : null; };
    out.hero.eyebrow = g(/<span class="eyebrow">([\s\S]*?)<\/span>/);
    out.hero.h1 = g(/<h1>([\s\S]*?)<\/h1>/);
    out.hero.h1Fancy = g(/<h1>[\s\S]*?<span class="fancy">([\s\S]*?)<\/span>/);
    out.hero.lead = g(/<p class="lead">([\s\S]*?)<\/p>/);
    const ctaBlock = hero[1].match(/<div class="hero-cta"([^>]*)>([\s\S]*?)<\/div>/);
    out.hero.ctaStyle = ctaBlock ? attrOf(ctaBlock[1], "style") : null;
    if (ctaBlock) {
      for (const m of ctaBlock[2].matchAll(/<a class="(btn[^"]*)" href="([^"]+)">([\s\S]*?)<\/a>/g)) {
        out.hero.cta.push({ cls: m[1], href: m[2], label: text(m[3]) });
      }
    }
  }

  const headBlock = html.match(/<div class="section-head reveal">([\s\S]*?)<\/div>/);
  if (headBlock) {
    const g = (re) => { const m = headBlock[1].match(re); return m ? text(m[1]) : null; };
    out.cardsEyebrow = g(/<span class="eyebrow">([\s\S]*?)<\/span>/);
    out.cardsTitle = g(/<h2 class="section-title">([\s\S]*?)<\/h2>/);
  }

  for (const m of html.matchAll(
    /<a class="(card[^"]*)" href="([^"]+)">\s*<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>\s*<span class="card-more">([\s\S]*?)<\/span>\s*<\/a>/g
  )) {
    out.cards.push({ cls: m[1], href: m[2], heading: text(m[3]), body: text(m[4]), more: text(m[5]) });
  }

  // ---- chrome ----
  const brand = html.match(/<a class="brand" href="([^"]+)">\s*<img src="([^"]+)" alt="([^"]*)">/);
  out.chrome.brandHref = brand ? brand[1] : null;
  out.chrome.brandLogo = brand ? brand[2] : null;
  out.chrome.brandAlt = brand ? text(brand[3]) : null;
  out.chrome.brandRows = [...html.matchAll(/<span class="brand-text" aria-hidden="true">([\s\S]*?)<\/span>\s*<\/a>/g)]
    .flatMap((m) => [...m[1].matchAll(/<span>([\s\S]*?)<\/span>/g)].map((s) => text(s[1])));
  const navList = html.match(/<ul class="nav-links">([\s\S]*?)<\/ul>/);
  out.chrome.navHrefs = navList ? [...navList[1].matchAll(/href="([^"]+)"/g)].map((m) => m[1]) : [];
  out.chrome.navLabels = navList
    ? [...navList[1].matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)].map((m) => text(m[1])).filter(Boolean) : [];
  out.chrome.navToggleAria = (html.match(/<button class="nav-toggle" aria-label="([^"]*)"/) || [])[1] || null;
  out.chrome.navAria = (html.match(/<nav aria-label="([^"]*)">/) || [])[1] || null;
  const sw = html.match(/<nav class="lang-switch" aria-label="([^"]*)">([\s\S]*?)<\/nav>/);
  out.chrome.switcherAria = sw ? sw[1] : null;
  out.chrome.switcher = sw
    ? [...sw[2].matchAll(/<a href="([^"]+)"[^>]*?(aria-current="true")?>([\s\S]*?)<\/a>/g)]
        .map((m) => `${m[3].trim()}=${m[1]}${/aria-current/.test(m[0]) ? " (current)" : ""}`)
    : [];
  const footLinks = html.match(/<footer class="site-footer">([\s\S]*?)<\/footer>/);
  /*
    THE TWO APPROVED FOOTER LINKS, human-approved.

      1. STAFF LOGIN (Phase 17D.1).
      2. THE NETLIFY ATTRIBUTION (open-source release) — required by Netlify's
         open-source policy on the main page or on all internal pages.

    The public footer gained exactly these two links, in both languages. Both
    are removed here so everything ELSE about the footer is still compared
    strictly, and each one's presence is asserted separately below — a relaxed
    comparison would also hide a THIRD new link, which this does not.
  */
  out.chrome.staffLogin = /href="[^"]*\/staff-login\/"/.test(html);
  out.chrome.netlifyLink = /href="https:\/\/www\.netlify\.com"/.test(html);
  out.chrome.footerHrefs = footLinks
    ? [...footLinks[1].matchAll(/href="([^"]+)"/g)].map((m) => m[1])
      .filter((href) => !href.endsWith("/staff-login/"))
      .filter((href) => href !== "https://www.netlify.com") : [];
  out.chrome.footerLogo = footLinks
    ? (footLinks[1].match(/<img src="([^"]+)" alt="([^"]*)">/) || []).slice(1, 3) : null;

  // ---- references + ROOT-RELATIVE assertion ----
  out.refs.stylesheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  out.refs.scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  out.refs.icons = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="([^"]+)"/g)]
    .map((m) => m[1]);
  out.refs.images = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]);

  // Every internal destination on a 404 must be root-relative: the page can be
  // served for a missing URL at any depth, and a relative href would resolve
  // against that imaginary directory.
  const allHrefs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  out.refs.depthRelative = allHrefs.filter(
    (h) => !/^(https?:|mailto:|tel:|data:|#|\/)/.test(h)
  );

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

function comparePage(name, livePath, genPath, expect) {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`  ${name}`);
  console.log(`  ${livePath}  ->  ${genPath}`);
  console.log("=".repeat(72));

  const before = results.length;
  const p = (s) => `${name}: ${s}`;
  const live = parse(read(livePath));
  const gen = parse(read(genPath));

  // FAIL LOUDLY on an empty parse.
  check(p("live page parsed 404 content"), true,
    Boolean(live.hero.h1) && live.cards.length > 0 && live.hero.cta.length > 0);
  check(p("generated page parsed 404 content"), true,
    Boolean(gen.hero.h1) && gen.cards.length > 0 && gen.hero.cta.length > 0);

  // --- indexing behaviour: absolute assertions on BOTH sides ---
  for (const [side, parsed] of [["live", live], ["generated", gen]]) {
    check(p(`${side}: robots is "noindex, follow"`), "noindex, follow", parsed.meta.robots);
    check(p(`${side}: no canonical`), 0, parsed.meta.canonicalCount);
    check(p(`${side}: no hreflang in <head>`), 0, parsed.meta.hreflangCount);
    check(p(`${side}: no Open Graph metadata`), 0, parsed.meta.ogCount);
    check(p(`${side}: no Twitter metadata`), 0, parsed.meta.twitterCount);
    check(p(`${side}: <html lang> is ${expect.lang}`), expect.lang, parsed.meta.htmlLang);
    // The whole point of root-link mode.
    check(p(`${side}: no depth-relative href or src anywhere`), [], parsed.refs.depthRelative);
  }

  check(p("title"), live.meta.title, gen.meta.title);
  check(p("description"), live.meta.description, gen.meta.description);

  for (const k of ["eyebrow", "h1", "h1Fancy", "lead", "ctaStyle"]) {
    check(p(`hero: ${k}`), live.hero[k], gen.hero[k]);
  }
  check(p("hero CTA buttons"), live.hero.cta, gen.hero.cta);
  check(p("hero CTA destinations are root-relative"), [],
    gen.hero.cta.map((c) => c.href).filter((h) => !h.startsWith("/")));

  check(p("cards eyebrow"), live.cardsEyebrow, gen.cardsEyebrow);
  check(p("cards title"), live.cardsTitle, gen.cardsTitle);
  check(p("card count"), live.cards.length, gen.cards.length);
  for (const f of ["cls", "href", "heading", "body", "more"]) {
    check(p(`card field: ${f}`), live.cards.map((c) => c[f]), gen.cards.map((c) => c[f]));
  }
  check(p("card destinations are root-relative"), [],
    gen.cards.map((c) => c.href).filter((h) => !h.startsWith("/")));

  for (const k of Object.keys(live.chrome)) {
    // staffLogin and netlifyLink are APPROVED differences, asserted as pairs
    // just below rather than compared for equality — they are meant to differ.
    if (k === "staffLogin" || k === "netlifyLink") continue;
    check(p(`chrome: ${k}`), live.chrome[k], gen.chrome[k]);
  }
  check(p("APPROVED: the live footer had no Staff login link"), false, live.chrome.staffLogin);
  check(p("APPROVED: the generated footer offers Staff login"), true, gen.chrome.staffLogin);
  /*
    NETLIFY OPEN SOURCE PLAN, REQUIREMENT (c). Asserted rather than tolerated:
    the charity's hosting credits depend on this link, so a future refactor of
    the footer must not be able to drop it silently. The 404 pages matter here
    too — the requirement is "all internal pages".
  */
  check(p("APPROVED: the live footer did not credit Netlify"), false, live.chrome.netlifyLink);
  check(p("APPROVED: the generated footer credits Netlify"), true, gen.chrome.netlifyLink);

  check(p("stylesheet references"), live.refs.stylesheets, gen.refs.stylesheets);
  check(p("script references"), live.refs.scripts, gen.refs.scripts);
  check(p("icon and manifest references"), live.refs.icons, gen.refs.icons);
  check(p("image references"), live.refs.images, gen.refs.images);

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

comparePage("English 404", "404.html", "dist/404.html", { lang: "en" });
comparePage("Polish 404", "pl/404.html", "dist/pl/404.html", { lang: "pl" });

/* ------------------------------------- depth resolution and sitemap absence */
console.log(`\n${"=".repeat(72)}`);
console.log("  Root-relative resolution from arbitrary URL depths");
console.log("=".repeat(72));
{
  const before = results.length;
  const en = parse(read("dist/404.html"));
  const pl = parse(read("dist/pl/404.html"));

  // Resolve every destination against several imaginary missing URLs. A
  // root-relative href resolves identically from all of them; a relative one
  // would not, which is exactly the bug this guards against.
  const DEPTHS = ["/missing/page", "/deeply/nested/missing/page",
    "/pl/missing/page", "/pl/deeply/nested/missing/page"];
  for (const [label, parsed] of [["English", en], ["Polish", pl]]) {
    const hrefs = [
      ...parsed.chrome.navHrefs, ...parsed.chrome.footerHrefs,
      ...parsed.hero.cta.map((c) => c.href), ...parsed.cards.map((c) => c.href),
      parsed.chrome.brandHref, parsed.chrome.brandLogo,
      ...parsed.refs.stylesheets, ...parsed.refs.scripts, ...parsed.refs.icons, ...parsed.refs.images,
    ].filter((h) => h && !/^(https?:|mailto:|tel:|data:|#)/.test(h));

    const resolvedSets = DEPTHS.map((base) =>
      hrefs.map((h) => new URL(h, "https://example.test" + base).pathname));
    const allIdentical = resolvedSets.every(
      (set) => JSON.stringify(set) === JSON.stringify(resolvedSets[0]));
    check(`${label} 404: all ${hrefs.length} internal destinations resolve identically from every depth`,
      true, allIdentical);
    // And they resolve to what they say, not to something nested.
    check(`${label} 404: resolved paths equal the literal hrefs`, hrefs, resolvedSets[0]);
  }

  // Neither page may appear in the sitemap.
  const sitemap = read("sitemap.xml");
  check("Neither 404 appears in sitemap.xml", [],
    ["/404.html", "/pl/404.html"].filter((u) => sitemap.includes(u)));

  for (const r of results.slice(before)) {
    if (r.ok) console.log(`  ok    ${r.label}`);
    else {
      console.log(`  FAIL  ${r.label}`);
      console.log(`          expected: ${r.expected}`);
      console.log(`          actual:   ${r.actual}`);
    }
  }
}

console.log(`\n${"=".repeat(72)}`);
if (failures === 0) console.log(`  PASS — ${results.length}/${results.length} comparisons matched`);
else console.log(`  FAIL — ${failures} of ${results.length} comparisons differ`);
console.log("=".repeat(72));

process.exit(failures === 0 ? 0 : 1);
