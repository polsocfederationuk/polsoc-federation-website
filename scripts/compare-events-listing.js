#!/usr/bin/env node
/**
 * compare-events-listing.js — semantic comparison of the two generated events
 * listing pages against their live counterparts.
 *
 * Two modes, as in the other event comparisons:
 *
 *   REQUIRED EQUIVALENCE — chrome, SEO, hero copy, season label and watermark,
 *     card count and ORDER, titles, summaries, images, alt text, links, card
 *     structure, family variants, flagship tag, stylesheets, scripts, wrappers.
 *
 *   APPROVED CORRECTION — an exact, enumerated before/after pair verified in
 *     BOTH directions. The live page must still say the old value and the
 *     generated page the new one, so a correction that silently failed to apply
 *     fails as loudly as a regression and nothing hides inside the exemption.
 *
 * Run:  node scripts/compare-events-listing.js
 * Exit: 0 when every comparison matches, 1 otherwise.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* ------------------------------------------------------------ normalisation */

const decode = (s) =>
  String(s)
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&rarr;/g, "→")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

const strip = (h) => String(h).replace(/<!--[\s\S]*?-->/g, "");
const norm = (h) => strip(h).replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
const text = (h) => (h == null ? null : decode(norm(h).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() || null);
/** As a browser renders it — markup removed, nothing substituted, so a missing
 *  space beside an inline <span> is visible rather than papered over. */
const rendered = (h) => (h == null ? null : decode(strip(h).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() || null);
const assetKey = (p) => (p == null ? null : String(p).replace(/^(\.\.\/)+/, "").replace(/^\/+/, ""));
const attrOf = (tag, name) => {
  const m = String(tag || "").match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  return m ? decode(m[1]) : null;
};
const labelText = (h) => (text(h) || "").replace(/\s*→\s*$/, "").trim() || null;

/* --------------------------------------------------------------- extraction */


/*
  THE STAFF LOGIN LINK (Phase 17D.1), human-approved.

  The public footer gained exactly one link, in both languages, pointing at the
  Staff login page for committee officers. It is the only intentional public
  change in that phase.

  Handled as an enumerated addition rather than by relaxing the comparison: the
  generated footer must contain it, the live footer must NOT (the live pages
  predate it), and everything else about the footer must still match exactly. A
  second new link, or this one going missing, still fails.
*/
const STAFF_LOGIN = "staff-login/";

/** The footer as it should be, ignoring only the one approved addition. */
function footerWithoutStaffLogin(links) {
  return links.filter((href) => !String(href).endsWith(STAFF_LOGIN));
}

function parse(html) {
  const o = {};
  const head = html.split("</head>")[0];
  const body = html.includes("</header>") ? html.split("</header>")[1].split("<footer")[0] : html;
  const g = (re, src = head) => { const m = src.match(re); return m ? m[1] : null; };

  /* ---- document + SEO ---- */
  o.htmlLang = g(/<html lang="([^"]*)"/, html);
  o.bodyClass = g(/<body class="([^"]*)"/, html) || null;
  o.title = text(g(/<title>([\s\S]*?)<\/title>/));
  o.description = decode(g(/<meta name="description" content="([\s\S]*?)">/) || "");
  o.canonical = g(/<link rel="canonical" href="([^"]+)">/);
  o.hreflang = [...head.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)">/g)]
    .map((m) => `${m[1]}=${m[2]}`).sort();
  o.ogType = g(/<meta property="og:type" content="([^"]*)">/);
  o.ogLocale = g(/<meta property="og:locale" content="([^"]*)">/);
  o.ogLocaleAlt = g(/<meta property="og:locale:alternate" content="([^"]*)">/);
  o.ogUrl = g(/<meta property="og:url" content="([^"]*)">/);
  o.ogImage = assetKey((g(/<meta property="og:image" content="([^"]*)">/) || "").replace(/^https?:\/\/[^/]+/, ""));
  o.ogImageAlt = decode(g(/<meta property="og:image:alt" content="([^"]*)">/) || "");
  o.twitterCard = g(/<meta name="twitter:card" content="([^"]*)">/);
  o.twitterImageAlt = decode(g(/<meta name="twitter:image:alt" content="([^"]*)">/) || "");
  o.stylesheets = [...head.matchAll(/<link rel="stylesheet" href="([^"]*)">/g)]
    .map((m) => m[1]).filter((h) => !/^https?:/.test(h)).map(assetKey);
  o.scripts = [...html.matchAll(/<script[^>]*\bsrc="([^"]*)"/g)].map((m) => assetKey(m[1]));

  /* ---- shared chrome ---- */
  o.navItems = [...html.matchAll(/<li><a\b([^>]*)>([\s\S]*?)<\/a><\/li>/g)]
    .map((m) => `${attrOf(m[0], "href")}|${text(m[2]) || attrOf(m[0], "aria-label")}`);
  o.activeNav = (html.match(/<li><a href="([^"]*)" class="active">/) || [])[1];
  o.langSwitch = [...html.matchAll(/<a href="([^"]*)" hreflang="([^"]*)"[^>]*>/g)].map((m) => `${m[2]}=${m[1]}`);
  o.footerLinks = html.includes("<footer")
    ? [...html.split("<footer")[1].matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => assetKey(m[1]))
    : [];

  /* ---- hero ---- */
  const heroBgTag = (body.match(/<div class="hero-photo-bg"[^>]*>/) || [""])[0];
  o.heroClasses = (body.match(/<section class="(page-hero[^"]*)">/) || [])[1];
  o.heroImage = assetKey((String(attrOf(heroBgTag, "style") || "").match(/url\('([^']+)'\)/) || [])[1]);
  o.heroPosition = (String(attrOf(heroBgTag, "style") || "").match(/background-position:\s*([^;]+)/) || [])[1];
  o.heroDecorative = /aria-hidden="true"/.test(heroBgTag);
  o.eyebrow = text(g(/<span class="eyebrow">([\s\S]*?)<\/span>/, body));
  const h1 = g(/<h1>([\s\S]*?)<\/h1>/, body);
  o.h1 = text(h1);
  o.h1Rendered = rendered(h1);
  o.h1Fancy = text((String(h1).match(/<span class="fancy">([\s\S]*?)<\/span>/) || [])[1]);
  o.lead = text(g(/<p class="lead">([\s\S]*?)<\/p>/, body));

  /* ---- season watermark ---- */
  o.watermark = text(g(/<span class="watermark"[^>]*>([\s\S]*?)<\/span>/, body));
  o.sectionClasses = [...body.matchAll(/<section class="([^"]*)"/g)].map((m) => m[1].split(/\s+/).sort().join(" "));
  o.eventListWrappers = (body.match(/<div class="event-list">/g) || []).length;

  /* ---- cards ---- */
  o.cards = [...strip(body).matchAll(/<article class="(event-card[^"]*)">([\s\S]*?)<\/article>/g)].map((m) => {
    const inner = m[2];
    const img = (inner.match(/<img\b[^>]*>/) || [""])[0];
    const titleLink = inner.match(/<h2><a href="([^"]*)">([\s\S]*?)<\/a><\/h2>/);
    const cta = inner.match(/<a class="btn btn-primary" href="([^"]*)">([\s\S]*?)<\/a>/);
    return {
      classes: m[1].split(/\s+/).filter(Boolean).sort().join(" "),
      flagship: /class="flagship-tag"/.test(inner),
      flagshipTag: text((inner.match(/<span class="flagship-tag">([\s\S]*?)<\/span>/) || [])[1]),
      image: assetKey(attrOf(img, "src")),
      alt: attrOf(img, "alt"),
      date: text((inner.match(/<span class="event-date">([\s\S]*?)<\/span>/) || [])[1]),
      title: text(titleLink && titleLink[2]),
      titleRendered: rendered(titleLink && titleLink[2]),
      href: titleLink && titleLink[1],
      summary: text((inner.match(/<p>([\s\S]*?)<\/p>/) || [])[1]),
      ctaHref: cta && cta[1],
      ctaLabel: labelText(cta && cta[2]),
    };
  });

  /* ---- archive disclosures ---- */
  o.details = [...body.matchAll(/<details[^>]*>/g)].length;
  o.detailsSummaries = [...body.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => text(m[1]));
  // ARIA that duplicates native <details> semantics would be a defect.
  o.detailsAria = [...body.matchAll(/<details([^>]*)>/g)].map((m) => m[1].trim()).filter(Boolean);

  /* ---- closing CTA ---- */
  const ctaBand = body.match(/<div class="cta-band reveal">([\s\S]*?)<\/div>/);
  o.cta = ctaBand ? {
    heading: text((ctaBand[1].match(/<h2>([\s\S]*?)<\/h2>/) || [])[1]),
    body: text((ctaBand[1].match(/<p>([\s\S]*?)<\/p>/) || [])[1]),
    href: (ctaBand[1].match(/<a class="btn btn-light" href="([^"]*)">/) || [])[1],
    label: labelText((ctaBand[1].match(/<a class="btn btn-light"[^>]*>([\s\S]*?)<\/a>/) || [])[1]),
  } : null;

  /* ---- whole page ---- */
  // Comments are stripped FIRST. The live pages carry an "ADDING A NEW EVENT"
  // instruction block containing a placeholder <img src="assets/events/
  // my-event.jpg" alt="">, which is not part of the page — the same commented
  // markup that made the Phase 10 audit misreport the Forum's card image.
  // Generating the listing from records makes those hand-editing instructions
  // obsolete, so the generated page has no such comment.
  const realHtml = strip(html);
  o.allImages = [...realHtml.matchAll(/<img\b[^>]*>/g)].map((t) => assetKey(attrOf(t[0], "src")));
  o.imagesWithoutAlt = [...realHtml.matchAll(/<img\b[^>]*>/g)]
    .filter((t) => attrOf(t[0], "alt") === null).map((t) => attrOf(t[0], "src"));
  o.plAssetPaths = [...html.matchAll(/["'(](\/pl\/assets\/[^"')]*)/g)].map((m) => m[1]);
  // Any card link that escapes the current language by going root-relative.
  o.rootRelativeCardLinks = [...strip(body).matchAll(/<article class="event-card[\s\S]*?<\/article>/g)]
    .flatMap((m) => [...m[0].matchAll(/href="(\/[^"]*)"/g)].map((h) => h[1]));

  return o;
}

/* ------------------------------------------------------------ approved diffs */

/**
 * Per-locale, per-slug approved corrections on the CARD. Each is [live, generated]
 * and both directions are asserted.
 */
const CARD_CORRECTIONS = {
  en: {
    // Decision 4: the official name, spelled out, with no ampersand.
    "sikorski-debate": { date: ["10 February 2026 · Polish Institute & Sikorski Museum",
                                "10 February 2026 · Polish Institute and Sikorski Museum"] },
    // Decision 5: one canonical venue name.
    "christmas-dinner": { date: ["8 December 2025 · Ognisko, South Kensington",
                                 "8 December 2025 · Ognisko Restaurant, South Kensington"] },
    // Decision 2: the exact date replaces month-only precision.
    "icebreaker": { date: ["October 2025 · Mamuśka!, Waterloo",
                           "16 October 2025 · Mamuśka!, Waterloo"] },
  },
  pl: {
    "christmas-dinner": { date: ["8 grudnia 2025 · Ognisko Polskie, South Kensington",
                                 "8 grudnia 2025 · Ognisko Restaurant, South Kensington"] },
    "icebreaker": { date: ["Październik 2025 · Mamuśka!, Waterloo",
                           "16 października 2025 · Mamuśka!, Waterloo"] },
  },
};

const PAGES = [
  { locale: "en", live: "events.html", gen: "dist/events.html" },
  { locale: "pl", live: "pl/events.html", gen: "dist/pl/events.html" },
];

const EXPECTED_ORDER = ["business-forum", "sikorski-debate", "christmas-dinner", "youth-congress", "icebreaker"];
const slugOf = (href) => String(href || "").replace(/^event-/, "").replace(/\.html$/, "");

/* ---------------------------------------------------------------- comparison */

let failures = 0;
let comparisons = 0;
const results = [];

function check(label, expected, actual, note) {
  comparisons++;
  const e = JSON.stringify(expected);
  const a = JSON.stringify(actual);
  const ok = e === a;
  if (!ok) failures++;
  results.push({ ok, label, expected: e, actual: a, note });
}

for (const page of PAGES) {
  const L = parse(read(page.live));
  const G = parse(read(page.gen));
  const tag = `[${page.locale}]`;
  const corr = CARD_CORRECTIONS[page.locale] || {};

  /* fail loudly if nothing parsed */
  if (L.cards.length === 0) {
    console.error(`FATAL ${tag}: parsed zero cards from ${page.live}`);
    process.exit(1);
  }
  if (G.cards.length === 0) {
    console.error(`FATAL ${tag}: parsed zero cards from ${page.gen}`);
    process.exit(1);
  }

  /* ---- document, chrome, SEO ---- */
  check(`${tag} html lang`, L.htmlLang, G.htmlLang);
  check(`${tag} body class`, L.bodyClass, G.bodyClass);
  check(`${tag} <title>`, L.title, G.title);
  check(`${tag} meta description`, L.description, G.description);
  check(`${tag} canonical`, L.canonical, G.canonical);
  check(`${tag} hreflang trio (incl. x-default)`, L.hreflang, G.hreflang);
  check(`${tag} og:type`, L.ogType, G.ogType);
  check(`${tag} og:locale`, L.ogLocale, G.ogLocale);
  check(`${tag} og:locale:alternate`, L.ogLocaleAlt, G.ogLocaleAlt);
  check(`${tag} og:url`, L.ogUrl, G.ogUrl);
  check(`${tag} og:image`, L.ogImage, G.ogImage);
  check(`${tag} og:image:alt`, L.ogImageAlt, G.ogImageAlt);
  check(`${tag} twitter:card`, L.twitterCard, G.twitterCard);
  check(`${tag} twitter:image:alt`, L.twitterImageAlt, G.twitterImageAlt);
  check(`${tag} stylesheets`, L.stylesheets, G.stylesheets);
  check(`${tag} scripts`, L.scripts, G.scripts);
  check(`${tag} navigation items`, L.navItems, G.navItems);
  check(`${tag} Events is the active nav item`, L.activeNav, G.activeNav);
  check(`${tag} language switcher destinations`, L.langSwitch, G.langSwitch);
  check(`${tag} footer links`, L.footerLinks, footerWithoutStaffLogin(G.footerLinks));
  check(`${tag} APPROVED: the footer offers Staff login`,
    true, G.footerLinks.some((href) => String(href).endsWith(STAFF_LOGIN)));
  check(`${tag} APPROVED: the live footer did not`,
    false, L.footerLinks.some((href) => String(href).endsWith(STAFF_LOGIN)));

  /* ---- hero ---- */
  check(`${tag} hero section classes`, L.heroClasses, G.heroClasses);
  check(`${tag} hero photograph`, L.heroImage, G.heroImage);
  check(`${tag} hero photograph framing`, L.heroPosition, G.heroPosition);
  check(`${tag} hero backdrop is decorative`, L.heroDecorative, G.heroDecorative);
  // The season label is DERIVED from the central setting; it must still match.
  check(`${tag} season eyebrow`, L.eyebrow, G.eyebrow);
  check(`${tag} h1`, L.h1, G.h1);
  check(`${tag} h1 .fancy span`, L.h1Fancy, G.h1Fancy);
  check(`${tag} h1 as rendered (word spacing)`, L.h1Rendered, G.h1Rendered);
  check(`${tag} hero lead`, L.lead, G.lead);
  check(`${tag} season watermark`, L.watermark, G.watermark);
  check(`${tag} section classes and order`, L.sectionClasses, G.sectionClasses);
  check(`${tag} .event-list wrappers`, L.eventListWrappers, G.eventListWrappers);

  /* ---- cards ---- */
  check(`${tag} card count`, L.cards.length, G.cards.length);
  check(`${tag} five cards render`, 5, G.cards.length);
  check(`${tag} card ORDER (by slug)`, EXPECTED_ORDER, G.cards.map((c) => slugOf(c.href)));
  check(`${tag} card order matches the live page`,
    L.cards.map((c) => slugOf(c.href)), G.cards.map((c) => slugOf(c.href)));

  L.cards.forEach((lc, i) => {
    const gc = G.cards[i] || {};
    const slug = slugOf(lc.href);
    const ct = `${tag} card ${i + 1} (${slug})`;
    const cc = corr[slug] || {};

    check(`${ct}: family variant classes`, lc.classes, gc.classes);
    check(`${ct}: flagship status`, lc.flagship, gc.flagship);
    check(`${ct}: flagship tag wording`, lc.flagshipTag, gc.flagshipTag);
    check(`${ct}: card image`, lc.image, gc.image);
    check(`${ct}: image alt text`, lc.alt, gc.alt);
    check(`${ct}: title`, lc.title, gc.title);
    check(`${ct}: title as rendered (word spacing)`, lc.titleRendered, gc.titleRendered);
    check(`${ct}: summary`, lc.summary, gc.summary);
    check(`${ct}: detail link`, lc.href, gc.href);
    check(`${ct}: read-more link`, lc.ctaHref, gc.ctaHref);
    check(`${ct}: read-more label`, lc.ctaLabel, gc.ctaLabel);
    // Links must stay relative so /pl/ keeps the reader in Polish.
    check(`${ct}: detail link is relative`, true, !String(gc.href || "").startsWith("/"));

    if (cc.date) {
      check(`${ct}: live date/venue is still the old value`, cc.date[0], lc.date,
        "approved correction — verified in both directions");
      check(`${ct}: generated date/venue applies the correction`, cc.date[1], gc.date,
        "approved correction — verified in both directions");
    } else {
      check(`${ct}: date and venue`, lc.date, gc.date);
    }
  });

  // Structural invariants that must hold regardless of card contents.
  const pbfCards = G.cards.filter((c) => c.classes.includes("event-card-pbf"));
  const flagshipCards = G.cards.filter((c) => c.flagship);
  check(`${tag} exactly one flagship card`, 1, flagshipCards.length);
  check(`${tag} the flagship card is the Business Forum`, ["business-forum"], flagshipCards.map((c) => slugOf(c.href)));
  check(`${tag} exactly one card uses the Forum variant`, 1, pbfCards.length);
  check(`${tag} the Forum keeps its flagship structure`, true,
    pbfCards.length === 1 && pbfCards[0].flagship === true);
  check(`${tag} no standard event uses the flagship structure`, [],
    G.cards.filter((c) => slugOf(c.href) !== "business-forum" && (c.flagship || c.classes.includes("event-card-pbf")))
      .map((c) => slugOf(c.href)));

  /* ---- archive ---- */
  // Only one academic year exists, so there must be NO disclosure at all.
  check(`${tag} live page has no archive disclosure`, 0, L.details);
  check(`${tag} no empty archive control is generated`, 0, G.details);
  check(`${tag} no archive summaries`, [], G.detailsSummaries);
  check(`${tag} no ARIA duplicating native <details> semantics`, [], G.detailsAria);

  /* ---- closing CTA ---- */
  check(`${tag} closing call-to-action band`, L.cta, G.cta);

  /* ---- whole page ---- */
  check(`${tag} every image, in order`, L.allImages, G.allImages);
  check(`${tag} no image is missing an alt attribute`, [], G.imagesWithoutAlt);
  check(`${tag} no /pl/assets/ path`, [], G.plAssetPaths);
  check(`${tag} no card link is root-relative`, [], G.rootRelativeCardLinks);
}

/* ---- cross-locale invariants ---- */
const EN = parse(read(PAGES[0].gen));
const PL = parse(read(PAGES[1].gen));
check("cross-locale: identical card order", EN.cards.map((c) => slugOf(c.href)), PL.cards.map((c) => slugOf(c.href)));
check("cross-locale: identical card images", EN.cards.map((c) => c.image), PL.cards.map((c) => c.image));
check("cross-locale: identical card variant classes", EN.cards.map((c) => c.classes), PL.cards.map((c) => c.classes));
check("cross-locale: identical detail links (language comes from the page, not the record)",
  EN.cards.map((c) => c.href), PL.cards.map((c) => c.href));
check("cross-locale: every Polish alt differs from the English one", [],
  EN.cards.map((c, i) => (c.alt === PL.cards[i].alt ? slugOf(c.href) : null)).filter(Boolean));
check("cross-locale: every Polish summary differs from the English one", [],
  EN.cards.map((c, i) => (c.summary === PL.cards[i].summary ? slugOf(c.href) : null)).filter(Boolean));
check("cross-locale: same season watermark", EN.watermark, PL.watermark);

/* -------------------------------------------------------------------- output */

const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
console.log("");
console.log("=".repeat(72));
console.log("  EVENTS LISTING — live vs generated");
console.log("=".repeat(72));
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
if (failures === 0) console.log(`  PASS — ${comparisons}/${comparisons} comparisons matched`);
else console.log(`  FAIL — ${failures} of ${comparisons} comparisons differ`);
console.log("=".repeat(72));
console.log("");
process.exit(failures === 0 ? 0 : 1);
