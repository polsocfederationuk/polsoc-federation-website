#!/usr/bin/env node
/**
 * compare-homepage.js — semantic comparison of the two generated homepages
 * against their live counterparts.
 *
 *   REQUIRED EQUIVALENCE — head, Organization JSON-LD, chrome, hero, ticker,
 *     about, statistics, pillars, event timeline, featured event, testimonials,
 *     partner marquee, CTA, stylesheets, scripts, accessibility attributes and
 *     animation classes/data attributes. Any difference fails.
 *
 *   APPROVED CORRECTION — an exact, enumerated before/after pair verified in BOTH
 *     directions, so a correction that silently failed to apply fails as loudly as
 *     a regression and nothing hides inside the exemption.
 *
 * Run:  node scripts/compare-homepage.js
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
    .replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

const strip = (h) => String(h).replace(/<!--[\s\S]*?-->/g, "");
const norm = (h) => strip(h).replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
const text = (h) => (h == null ? null : decode(norm(h).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() || null);
/** As a browser renders it: markup removed, nothing substituted — so a missing
 *  space beside an inline <span> or <em> is visible rather than papered over. */
const rendered = (h) => (h == null ? null : decode(strip(h).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() || null);
const assetKey = (p) => (p == null ? null : String(p).replace(/^(\.\.\/)+/, "").replace(/^\/+/, ""));
const attrOf = (tag, name) => {
  const m = String(tag || "").match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  return m ? decode(m[1]) : null;
};
const hasAttr = (tag, name) => new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(String(tag || ""));
const styleSet = (s) => String(s || "").split(";").map((d) => d.trim().replace(/\s*:\s*/, ":").replace(/\s+/g, " ")).filter(Boolean).sort();
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
  const body = strip(html.split("</header>")[1].split("<footer")[0]);
  const g = (re, src = head) => { const m = String(src).match(re); return m ? m[1] : null; };
  const sect = (marker, from = 0) => {
    const i = body.indexOf(marker, from);
    return i === -1 ? "" : body.slice(i, body.indexOf("</section>", i));
  };

  /* ---- head + SEO ---- */
  o.htmlLang = g(/<html lang="([^"]*)"/, html);
  o.bodyClass = g(/<body class="([^"]*)"/, html) || null;
  o.title = text(g(/<title>([\s\S]*?)<\/title>/));
  o.description = decode(g(/<meta name="description" content="([^"]*)"/) || "");
  o.canonical = g(/<link rel="canonical" href="([^"]+)">/);
  o.hreflang = [...head.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)">/g)]
    .map((m) => `${m[1]}=${m[2]}`).sort();
  o.ogType = g(/<meta property="og:type" content="([^"]*)">/);
  o.ogSiteName = g(/<meta property="og:site_name" content="([^"]*)">/);
  o.ogLocale = g(/<meta property="og:locale" content="([^"]*)">/);
  o.ogLocaleAlt = g(/<meta property="og:locale:alternate" content="([^"]*)">/);
  o.ogTitle = decode(g(/<meta property="og:title" content="([^"]*)">/) || "");
  o.ogDescription = decode(g(/<meta property="og:description" content="([^"]*)">/) || "");
  o.ogUrl = g(/<meta property="og:url" content="([^"]*)">/);
  o.ogImage = g(/<meta property="og:image" content="([^"]*)">/);
  o.ogImageExtended = [
    g(/<meta property="og:image:secure_url" content="([^"]*)">/),
    g(/<meta property="og:image:type" content="([^"]*)">/),
    g(/<meta property="og:image:width" content="([^"]*)">/),
    g(/<meta property="og:image:height" content="([^"]*)">/),
  ];
  o.ogImageAlt = decode(g(/<meta property="og:image:alt" content="([^"]*)">/) || "");
  o.twitter = [
    g(/<meta name="twitter:card" content="([^"]*)">/),
    decode(g(/<meta name="twitter:title" content="([^"]*)">/) || ""),
    decode(g(/<meta name="twitter:description" content="([^"]*)">/) || ""),
    g(/<meta name="twitter:image" content="([^"]*)">/),
    decode(g(/<meta name="twitter:image:alt" content="([^"]*)">/) || ""),
  ];
  o.icons = [...head.matchAll(/<link rel="(icon|apple-touch-icon|manifest)"[^>]*>/g)].map((m) => norm(m[0]));
  o.themeColor = g(/<meta name="theme-color" content="([^"]*)">/);
  o.stylesheets = [...head.matchAll(/<link rel="stylesheet" href="([^"]*)">/g)]
    .map((m) => m[1]).filter((h) => !/^https?:/.test(h)).map(assetKey);
  o.scripts = [...html.matchAll(/<script[^>]*\bsrc="([^"]*)"/g)].map((m) => assetKey(m[1]));

  /* ---- Organization JSON-LD ---- */
  const ld = g(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/, html);
  o.jsonldValid = false;
  o.jsonld = null;
  if (ld) { try { o.jsonld = JSON.parse(ld); o.jsonldValid = true; } catch { o.jsonldValid = false; } }

  /* ---- shared chrome ---- */
  o.navItems = [...html.matchAll(/<li><a\b([^>]*)>([\s\S]*?)<\/a><\/li>/g)]
    .map((m) => `${attrOf(m[0], "href")}|${text(m[2]) || attrOf(m[0], "aria-label")}`);
  o.activeNav = (html.match(/<li><a href="([^"]*)" class="active">/) || [])[1];
  o.langSwitch = [...html.matchAll(/<a href="([^"]*)" hreflang="([^"]*)"[^>]*>/g)].map((m) => `${m[2]}=${m[1]}`);
  o.footerLinks = html.includes("<footer")
    ? [...html.split("<footer")[1].matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => assetKey(m[1])) : [];

  /* ---- section order ---- */
  o.sectionOrder = [...body.matchAll(/<section class="([^"]*)"(?: style="([^"]*)")?>/g)]
    .map((m) => m[1] + (m[2] ? ` |${styleSet(m[2]).join(";")}` : ""));

  /* ---- hero ---- */
  const hero = sect('<section class="hero">');
  o.hero = {
    blobs: (hero.match(/<div class="blob blob-\d"><\/div>/g) || []).length,
    ring: /<div class="hero-ring"><\/div>/.test(hero),
    eyebrow: text(g(/<span class="eyebrow">([\s\S]*?)<\/span>/, hero)),
    line1: text(g(/<span class="line"><span>([^<]*)<\/span><\/span>/, hero)),
    line2: text(g(/<span class="accent"><span>([^<]*)<\/span><\/span>/, hero)),
    h1Rendered: rendered(g(/<h1>([\s\S]*?)<\/h1>/, hero)),
    lead: text(g(/<p class="lead">([\s\S]*?)<\/p>/, hero)),
    primary: { href: g(/<a class="btn btn-primary" href="([^"]*)">/, hero), label: labelText(g(/<a class="btn btn-primary" href="[^"]*">([\s\S]*?)<\/a>/, hero)) },
    secondary: { href: g(/<a class="btn btn-ghost" href="([^"]*)">/, hero), label: text(g(/<a class="btn btn-ghost" href="[^"]*">([\s\S]*?)<\/a>/, hero)) },
    shield: assetKey(attrOf((hero.match(/<img class="hero-shield"[^>]*>/) || [""])[0], "src")),
    shieldAlt: attrOf((hero.match(/<img class="hero-shield"[^>]*>/) || [""])[0], "alt"),
    scrollHint: text(g(/<div class="scroll-hint" aria-hidden="true">([\s\S]*?)<\/div>\s*<\/section>|<div class="scroll-hint" aria-hidden="true">([\s\S]*?)$/, hero)),
    scrollHintHidden: /<div class="scroll-hint" aria-hidden="true">/.test(hero),
    wheel: /<div class="wheel"><\/div>/.test(hero),
  };

  /* ---- ticker ---- */
  const clip = body.match(/<div class="ticker-clip">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
  o.ticker = {
    clipPresent: /<div class="ticker-clip">/.test(body),
    ariaHidden: /<div class="ticker" aria-hidden="true">/.test(body),
    trackPresent: /<div class="ticker-track">/.test(body),
    runs: clip ? (clip[1].match(/<span>(?!<)/g) || []).length : 0,
    runTexts: clip ? [...clip[1].matchAll(/<span>((?:(?!<span>)[\s\S])*?)<\/span>\s*(?=<span>|$)/g)].map((m) => text(m[1])) : [],
    dots: clip ? (clip[1].match(/<span class="dot"><\/span>/g) || []).length : 0,
  };

  /* ---- about ---- */
  const about = sect('<section class="section has-watermark">');
  o.about = {
    watermark: text(g(/<span class="watermark" aria-hidden="true">([^<]*)<\/span>/, about)),
    eyebrow: text(g(/<span class="eyebrow">([\s\S]*?)<\/span>/, about)),
    title: text(g(/<h2 class="section-title">([\s\S]*?)<\/h2>/, about)),
    titleRendered: rendered(g(/<h2 class="section-title">([\s\S]*?)<\/h2>/, about)),
    titleFancy: text(g(/<h2 class="section-title">[\s\S]*?<span class="fancy">([\s\S]*?)<\/span>/, about)),
    titleHasBreak: /<h2 class="section-title">[^<]*<br>/.test(about),
    lead: text(g(/<p class="lead reveal reveal-d1">([\s\S]*?)<\/p>/, about)),
    leadBreaks: (String(g(/<p class="lead reveal reveal-d1">([\s\S]*?)<\/p>/, about)).match(/<br><br>/g) || []).length,
    gridStyle: styleSet(g(/<div class="hero-grid" style="([^"]*)">/, about)),
    photo: assetKey(attrOf((about.match(/<img src="[^"]*"[\s\S]{0,200}?>/) || [""])[0], "src")),
    photoAlt: attrOf((about.match(/<img src="[^"]*"[\s\S]{0,200}?>/) || [""])[0], "alt"),
    caption: text(g(/<figcaption>([\s\S]*?)<\/figcaption>/, about)),
    capDot: /<span class="cap-dot" aria-hidden="true"><\/span>/.test(about),
  };

  /* ---- statistics ---- */
  const stats = sect('<section class="section stats-photo">');
  o.stats = {
    eyebrow: text(g(/<span class="eyebrow">([\s\S]*?)<\/span>/, stats)),
    items: [...stats.matchAll(/<div class="stat( reveal[^"]*)?"><div class="stat-number"([^>]*)>0<\/div><div class="stat-label">([^<]*)<\/div><\/div>/g)]
      .map((m) => ({
        reveal: (m[1] || "").trim().split(/\s+/).filter(Boolean).sort().join(" "),
        count: attrOf(m[2], "data-count"),
        suffix: attrOf(m[2], "data-suffix"),
        plain: hasAttr(m[2], "data-plain"),
        label: text(m[3]),
      })),
  };

  /* ---- pillars ---- */
  const what = sect('<section class="section" style="padding-bottom: 56px;">');
  o.pillarsHead = {
    eyebrow: text(g(/<span class="eyebrow">([\s\S]*?)<\/span>/, what)),
    title: text(g(/<h2 class="section-title"[^>]*>([\s\S]*?)<\/h2>/, what)),
    titleRendered: rendered(g(/<h2 class="section-title"[^>]*>([\s\S]*?)<\/h2>/, what)),
    headStyle: styleSet(g(/<div class="section-head center reveal" style="([^"]*)">/, what)),
    titleStyle: styleSet(g(/<h2 class="section-title" style="([^"]*)">/, what)),
  };
  const pillarsSect = sect('<section class="pillars">');
  o.pillars = [...pillarsSect.matchAll(/<div class="pillar">\s*<div class="pillar-bg" style="([^"]*)"([^>]*)><\/div>\s*<div class="pillar-inner([^"]*)">\s*<span class="pillar-num">([^<]*)<\/span>\s*<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)]
    .map((m) => ({
      bg: assetKey((m[1].match(/url\('([^']*)'\)/) || [])[1]),
      bgHidden: hasAttr(m[2], 'aria-hidden="true"'),
      reveal: m[3].trim().split(/\s+/).filter(Boolean).sort().join(" "),
      num: text(m[4]),
      title: text(m[5]),
      body: text(m[6]),
    }));

  /* ---- event timeline ---- */
  const tlIdx = body.indexOf('<section class="section has-watermark tex-light">');
  const timeline = sect('<section class="section has-watermark tex-light">');
  o.timeline = {
    watermark: text(g(/<span class="watermark" aria-hidden="true">([^<]*)<\/span>/, timeline)),
    eyebrow: text(g(/<span class="eyebrow">([\s\S]*?)<\/span>/, timeline)),
    title: text(g(/<h2 class="section-title">([\s\S]*?)<\/h2>/, timeline)),
    titleRendered: rendered(g(/<h2 class="section-title">([\s\S]*?)<\/h2>/, timeline)),
    railPresent: /<div class="timeline-progress" aria-hidden="true"><\/div>/.test(timeline),
    wrapperPresent: /<div class="timeline">/.test(timeline),
    items: [...timeline.matchAll(/<div class="(tl-item[^"]*)">\s*<span class="tl-date">([^<]*)<\/span>\s*<h3><a href="([^"]*)">([\s\S]*?)<\/a><\/h3>\s*<p>([\s\S]*?)<\/p>/g)]
      .map((m) => ({
        classes: m[1].split(/\s+/).sort().join(" "),
        date: text(m[2]),
        href: m[3],
        title: text(m[4]),
        titleRendered: rendered(m[4]),
        summary: text(m[5]),
      })),
  };

  /* ---- featured event ---- */
  const featured = sect('<section class="section home-pbf has-watermark">');
  o.featured = {
    watermark: text(g(/<span class="watermark" aria-hidden="true">([^<]*)<\/span>/, featured)),
    eyebrow: text(g(/<span class="eyebrow">([\s\S]*?)<\/span>/, featured)),
    logo: assetKey(attrOf((featured.match(/<img class="home-pbf-logo"[^>]*>/) || [""])[0], "src")),
    logoAlt: attrOf((featured.match(/<img class="home-pbf-logo"[^>]*>/) || [""])[0], "alt"),
    title: text(g(/<h2 class="section-title">([\s\S]*?)<\/h2>/, featured)),
    titleRendered: rendered(g(/<h2 class="section-title">([\s\S]*?)<\/h2>/, featured)),
    lead: text(g(/<p class="lead">([\s\S]*?)<\/p>/, featured)),
    leadRendered: rendered(g(/<p class="lead">([\s\S]*?)<\/p>/, featured)),
    emphasis: text(g(/<em>([\s\S]*?)<\/em>/, featured)),
    gallery: [...featured.matchAll(/<div class="ph"><img src="([^"]*)" alt="([^"]*)"><\/div>/g)]
      .map((m) => ({ src: assetKey(m[1]), alt: decode(m[2]) })),
    ctaHref: g(/<a class="btn btn-primary" href="([^"]*)">/, featured),
    ctaLabel: labelText(g(/<a class="btn btn-primary" href="[^"]*">([\s\S]*?)<\/a>/, featured)),
    ctaWrapStyle: styleSet(g(/<div style="([^"]*)" class="reveal">/, featured)),
  };

  /* ---- testimonials ---- */
  const voices = sect('<section class="section has-watermark tex-light">', tlIdx + 10);
  o.testimonials = {
    watermark: text(g(/<span class="watermark" aria-hidden="true">([^<]*)<\/span>/, voices)),
    eyebrow: text(g(/<span class="eyebrow">([\s\S]*?)<\/span>/, voices)),
    quoteMark: text(g(/<span class="quote-mark" aria-hidden="true">([^<]*)<\/span>/, voices)),
    slides: [...voices.matchAll(/<div class="quote-slide([^"]*)">\s*<blockquote>([\s\S]*?)<\/blockquote>\s*<div class="quote-who">([\s\S]*?)<span>([\s\S]*?)<\/span><\/div>/g)]
      .map((m) => ({ classes: m[1].trim(), quote: text(m[2]), who: text(m[3]), role: text(m[4]) })),
    navPresent: /<div class="quote-nav">/.test(voices),
    dotsContainer: /<div class="quote-dots"><\/div>/.test(voices),
    prevLabel: g(/<button class="quote-arrow quote-prev" aria-label="([^"]*)">/, voices),
    nextLabel: g(/<button class="quote-arrow quote-next" aria-label="([^"]*)">/, voices),
    prevGlyph: text(g(/<button class="quote-arrow quote-prev"[^>]*>([^<]*)<\/button>/, voices)),
    nextGlyph: text(g(/<button class="quote-arrow quote-next"[^>]*>([^<]*)<\/button>/, voices)),
  };

  /* ---- partners ---- */
  const partners = sect('<section class="section" style="padding-bottom: 60px;">');
  const carOpen = (partners.match(/<div class="pbf-carousel"[^>]*>/) || [""])[0];
  const tiles = [...partners.matchAll(/<div class="pbf-logo-tile"([^>]*)><img src="([^"]*)" alt="([^"]*)"><\/div>/g)];
  const visible = tiles.filter((t) => !hasAttr(t[1], 'aria-hidden="true"'));
  const hidden = tiles.filter((t) => hasAttr(t[1], 'aria-hidden="true"'));
  o.partners = {
    eyebrow: text(g(/<span class="eyebrow">([\s\S]*?)<\/span>/, partners)),
    title: text(g(/<h2 class="section-title">([\s\S]*?)<\/h2>/, partners)),
    titleRendered: rendered(g(/<h2 class="section-title">([\s\S]*?)<\/h2>/, partners)),
    lead: text(g(/<p class="lead">([\s\S]*?)<\/p>/, partners)),
    wrapPresent: /<div class="pbf-carousel-wrap reveal">/.test(partners),
    carouselAttrs: carOpen.replace(/^<div class="pbf-carousel"/, "").replace(/>$/, "").trim(),
    ariaLabel: attrOf(carOpen, "aria-label"),
    // The homepage marquee deliberately carries NO data-autoscroll (unlike the
    // Business Forum carousels); reproduced, not normalised.
    autoscroll: hasAttr(carOpen, "data-autoscroll"),
    canonical: visible.map((t) => `${assetKey(t[2])}|${decode(t[3])}`),
    duplicated: hidden.map((t) => assetKey(t[2])),
    sets: visible.length ? tiles.length / visible.length : 0,
    duplicateAltsEmpty: hidden.every((t) => t[3] === ""),
    prevLabel: g(/<button class="car-arrow car-prev" type="button" aria-label="([^"]*)">/, partners),
    nextLabel: g(/<button class="car-arrow car-next" type="button" aria-label="([^"]*)">/, partners),
  };

  /* ---- CTA ---- */
  const cta = sect('<section class="section" style="padding-top: 0;">');
  o.cta = {
    heading: text(g(/<div class="cta-band reveal">\s*<h2>([\s\S]*?)<\/h2>/, cta)),
    body: text(g(/<div class="cta-band reveal">[\s\S]*?<p>([\s\S]*?)<\/p>/, cta)),
    href: g(/<a class="btn btn-light" href="([^"]*)">/, cta),
    label: labelText(g(/<a class="btn btn-light" href="[^"]*">([\s\S]*?)<\/a>/, cta)),
  };

  /* ---- whole page ---- */
  o.revealClasses = [...body.matchAll(/class="([^"]*\breveal\b[^"]*)"/g)].map((m) => m[1].split(/\s+/).sort().join(" "));
  o.allImages = [...body.matchAll(/<img\b[^>]*>/g)].map((t) => assetKey(attrOf(t[0], "src")));
  o.imagesWithoutAlt = [...body.matchAll(/<img\b[^>]*>/g)].filter((t) => attrOf(t[0], "alt") === null).map((t) => attrOf(t[0], "src"));
  o.plAssetPaths = [...html.matchAll(/["'(](\/pl\/assets\/[^"')]*)/g)].map((m) => m[1]);
  o.rootRelativeTimelineLinks = o.timeline.items.map((i) => i.href).filter((h) => h.startsWith("/") || /^https?:/.test(h));
  o.externalLinks = [...html.matchAll(/<a\b[^>]*>/g)]
    .filter((m) => /^https?:/.test(attrOf(m[0], "href") || ""))
    .map((m) => `${attrOf(m[0], "href")}|target=${attrOf(m[0], "target")}|rel=${attrOf(m[0], "rel")}`);

  return o;
}

/* ------------------------------------------------------------ approved diffs */

/** Timeline corrections, per locale, keyed by slug: [live, generated]. */
const TIMELINE_CORRECTIONS = {
  en: { icebreaker: { date: ["October 2025", "16 October 2025"] } },
  pl: { icebreaker: { date: ["Październik 2025", "16 października 2025"] } },
};

const PAGES = [
  { locale: "en", live: "index.html", gen: "dist/index.html" },
  { locale: "pl", live: "pl/index.html", gen: "dist/pl/index.html" },
];
const EXPECTED_TIMELINE = ["business-forum", "sikorski-debate", "christmas-dinner", "youth-congress", "icebreaker"];
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
  const corr = TIMELINE_CORRECTIONS[page.locale] || {};

  /* fail loudly if nothing parsed */
  const fatal = [];
  if (L.sectionOrder.length === 0) fatal.push("no sections");
  if (L.timeline.items.length === 0) fatal.push("no timeline items");
  if (!L.ticker.clipPresent) fatal.push("no ticker wrapper");
  if (L.partners.canonical.length === 0) fatal.push("empty partner set");
  if (L.testimonials.slides.length === 0) fatal.push("empty testimonial set");
  if (!L.jsonldValid) fatal.push("Organization JSON-LD did not parse");
  if (fatal.length) { console.error(`FATAL ${tag}: ${page.live}: ${fatal.join("; ")}`); process.exit(1); }
  const fatalG = [];
  if (G.sectionOrder.length === 0) fatalG.push("no sections");
  if (G.timeline.items.length === 0) fatalG.push("no timeline items");
  if (!G.ticker.clipPresent) fatalG.push("no ticker wrapper");
  if (G.partners.canonical.length === 0) fatalG.push("empty partner set");
  if (G.testimonials.slides.length === 0) fatalG.push("empty testimonial set");
  if (!G.jsonldValid) fatalG.push("Organization JSON-LD did not parse");
  if (fatalG.length) { console.error(`FATAL ${tag}: ${page.gen}: ${fatalG.join("; ")}`); process.exit(1); }

  /* ---- head + SEO ---- */
  check(`${tag} html lang`, L.htmlLang, G.htmlLang);
  check(`${tag} body class`, L.bodyClass, G.bodyClass);
  check(`${tag} <title>`, L.title, G.title);
  check(`${tag} meta description`, L.description, G.description);
  check(`${tag} canonical`, L.canonical, G.canonical);
  check(`${tag} hreflang trio (incl. x-default)`, L.hreflang, G.hreflang);
  check(`${tag} og:type`, L.ogType, G.ogType);
  check(`${tag} og:site_name`, L.ogSiteName, G.ogSiteName);
  check(`${tag} og:locale`, L.ogLocale, G.ogLocale);
  check(`${tag} og:locale:alternate`, L.ogLocaleAlt, G.ogLocaleAlt);
  check(`${tag} og:title`, L.ogTitle, G.ogTitle);
  check(`${tag} og:description`, L.ogDescription, G.ogDescription);
  check(`${tag} og:url`, L.ogUrl, G.ogUrl);
  check(`${tag} og:image (the current social banner)`, L.ogImage, G.ogImage);
  check(`${tag} og:image extended fields (secure_url/type/width/height)`, L.ogImageExtended, G.ogImageExtended);
  check(`${tag} og:image:alt`, L.ogImageAlt, G.ogImageAlt);
  check(`${tag} twitter card, title, description, image, alt`, L.twitter, G.twitter);
  check(`${tag} favicon and manifest declarations`, L.icons, G.icons);
  check(`${tag} theme-color`, L.themeColor, G.themeColor);
  check(`${tag} stylesheets`, L.stylesheets, G.stylesheets);
  check(`${tag} scripts`, L.scripts, G.scripts);

  /* ---- Organization JSON-LD ---- */
  check(`${tag} Organization JSON-LD parses`, true, G.jsonldValid);
  check(`${tag} Organization JSON-LD matches the live block`, L.jsonld, G.jsonld);
  if (G.jsonld) {
    check(`${tag} JSON-LD @type`, "Organization", G.jsonld["@type"]);
    check(`${tag} JSON-LD sameAs holds exactly the three confirmed profiles`, 3, (G.jsonld.sameAs || []).length);
    // Separate initiatives must not be promoted to Federation-level profiles.
    check(`${tag} JSON-LD sameAs excludes separate initiatives`, [],
      (G.jsonld.sameAs || []).filter((u) => /thelambert|businessforum|polishbusinessforum/i.test(u)));
    check(`${tag} JSON-LD url is the locale home`, L.jsonld.url, G.jsonld.url);
    check(`${tag} JSON-LD inLanguage`, L.jsonld.inLanguage, G.jsonld.inLanguage);
    // Reproduced for equivalence; governance decision deferred and documented.
    check(`${tag} JSON-LD postal address preserved from the live block`, L.jsonld.address, G.jsonld.address);
  }

  /* ---- chrome ---- */
  check(`${tag} navigation items`, L.navItems, G.navItems);
  check(`${tag} active nav item`, L.activeNav, G.activeNav);
  check(`${tag} language switcher destinations`, L.langSwitch, G.langSwitch);
  check(`${tag} footer links`, L.footerLinks, footerWithoutStaffLogin(G.footerLinks));
  check(`${tag} APPROVED: the footer offers Staff login`,
    true, G.footerLinks.some((href) => String(href).endsWith(STAFF_LOGIN)));
  check(`${tag} APPROVED: the live footer did not`,
    false, L.footerLinks.some((href) => String(href).endsWith(STAFF_LOGIN)));

  /* ---- section order ---- */
  check(`${tag} section order and inline styles`, L.sectionOrder, G.sectionOrder);

  /* ---- hero ---- */
  check(`${tag} hero`, L.hero, G.hero);

  /* ---- ticker ---- */
  check(`${tag} ticker (clip wrapper, aria-hidden, runs, phrases, dots)`, L.ticker, G.ticker);
  check(`${tag} ticker clip wrapper present`, true, G.ticker.clipPresent);
  check(`${tag} ticker renders two runs for the seamless loop`, 2, G.ticker.runs);

  /* ---- about ---- */
  check(`${tag} about section`, L.about, G.about);

  /* ---- statistics ---- */
  check(`${tag} statistics`, L.stats, G.stats);
  check(`${tag} the founding-year counter keeps data-plain`, true,
    G.stats.items.some((s) => s.count === "2013" && s.plain === true),
    "without data-plain js/main.js renders 2,013");

  /* ---- pillars ---- */
  check(`${tag} pillars heading band`, L.pillarsHead, G.pillarsHead);
  check(`${tag} pillars`, L.pillars, G.pillars);

  /* ---- event timeline ---- */
  check(`${tag} timeline heading, watermark and rail`, {
    watermark: L.timeline.watermark, eyebrow: L.timeline.eyebrow, title: L.timeline.title,
    titleRendered: L.timeline.titleRendered, railPresent: L.timeline.railPresent, wrapperPresent: L.timeline.wrapperPresent,
  }, {
    watermark: G.timeline.watermark, eyebrow: G.timeline.eyebrow, title: G.timeline.title,
    titleRendered: G.timeline.titleRendered, railPresent: G.timeline.railPresent, wrapperPresent: G.timeline.wrapperPresent,
  });
  check(`${tag} timeline item count`, L.timeline.items.length, G.timeline.items.length);
  check(`${tag} timeline shows five events`, 5, G.timeline.items.length);
  check(`${tag} timeline ORDER`, EXPECTED_TIMELINE, G.timeline.items.map((i) => slugOf(i.href)));
  check(`${tag} timeline order matches the live page`,
    L.timeline.items.map((i) => slugOf(i.href)), G.timeline.items.map((i) => slugOf(i.href)));

  L.timeline.items.forEach((li, i) => {
    const gi = G.timeline.items[i] || {};
    const slug = slugOf(li.href);
    const it = `${tag} timeline ${i + 1} (${slug})`;
    const cc = corr[slug] || {};
    check(`${it}: item classes`, li.classes, gi.classes);
    check(`${it}: title`, li.title, gi.title);
    check(`${it}: title as rendered (word spacing)`, li.titleRendered, gi.titleRendered);
    check(`${it}: summary`, li.summary, gi.summary);
    check(`${it}: detail link`, li.href, gi.href);
    check(`${it}: link is relative`, true, !String(gi.href || "").startsWith("/"));
    if (cc.date) {
      check(`${it}: live date is still the old value`, cc.date[0], li.date, "approved correction — both directions");
      check(`${it}: generated date applies the correction`, cc.date[1], gi.date, "approved correction — both directions");
    } else {
      check(`${it}: generated date`, li.date, gi.date);
    }
  });
  // The Business Forum's timeline title is a genuine override, not the event title.
  check(`${tag} the Business Forum timeline title is its override`, true,
    /Business Forum/.test(G.timeline.items[0].title) && G.timeline.items[0].title !== "Polish Business Forum 2026");
  // No archive disclosure may appear on the homepage.
  check(`${tag} the homepage renders no archive disclosure`, 0, (read(page.gen).match(/<details/g) || []).length);

  /* ---- featured event ---- */
  check(`${tag} featured event band`, L.featured, G.featured);

  /* ---- testimonials ---- */
  check(`${tag} testimonials`, L.testimonials, G.testimonials);
  check(`${tag} exactly one testimonial slide starts active`, 1,
    G.testimonials.slides.filter((s) => s.classes.includes("active")).length);

  /* ---- partners ---- */
  check(`${tag} partner marquee`, L.partners, G.partners);
  check(`${tag} nine canonical partner logos`, 9, G.partners.canonical.length);
  check(`${tag} rendered as two sequences (18 tiles)`, 2, G.partners.sets);
  check(`${tag} the duplicated sequence is accessibility-hidden with empty alt`, true, G.partners.duplicateAltsEmpty);
  check(`${tag} the duplicated sequence preserves logo order`,
    G.partners.canonical.map((c) => c.split("|")[0]), G.partners.duplicated);
  check(`${tag} the homepage marquee carries no data-autoscroll (as live)`, L.partners.autoscroll, G.partners.autoscroll);

  /* ---- CTA ---- */
  check(`${tag} closing call to action`, L.cta, G.cta);

  /* ---- whole page ---- */
  check(`${tag} reveal / animation classes`, L.revealClasses, G.revealClasses);
  check(`${tag} every image, in order`, L.allImages, G.allImages);
  check(`${tag} no image is missing an alt attribute`, [], G.imagesWithoutAlt);
  check(`${tag} no /pl/assets/ path`, [], G.plAssetPaths);
  check(`${tag} no timeline link is root-relative`, [], G.rootRelativeTimelineLinks);
  check(`${tag} external links keep their target and rel`, L.externalLinks, G.externalLinks);
}

/* ---- cross-locale invariants ---- */
const EN = parse(read(PAGES[0].gen));
const PL = parse(read(PAGES[1].gen));
check("cross-locale: identical image sets", EN.allImages, PL.allImages);
check("cross-locale: identical section order", EN.sectionOrder, PL.sectionOrder);
check("cross-locale: identical timeline order", EN.timeline.items.map((i) => slugOf(i.href)), PL.timeline.items.map((i) => slugOf(i.href)));
check("cross-locale: identical timeline links (language comes from the page)",
  EN.timeline.items.map((i) => i.href), PL.timeline.items.map((i) => i.href));
check("cross-locale: identical statistic machine values",
  EN.stats.items.map((s) => `${s.count}|${s.suffix}|${s.plain}`), PL.stats.items.map((s) => `${s.count}|${s.suffix}|${s.plain}`));
check("cross-locale: identical partner logo order",
  EN.partners.canonical.map((c) => c.split("|")[0]), PL.partners.canonical.map((c) => c.split("|")[0]));
check("cross-locale: Polish page declares inLanguage pl-PL", "pl-PL", PL.jsonld.inLanguage);
check("cross-locale: English page declares no inLanguage", undefined, EN.jsonld.inLanguage);
check("cross-locale: the same shared Organization name on both pages", EN.jsonld.name, PL.jsonld.name);
check("cross-locale: localised Organization description", true, EN.jsonld.description !== PL.jsonld.description);
check("cross-locale: every Polish timeline summary differs from the English", [],
  EN.timeline.items.map((i, n) => (i.summary === PL.timeline.items[n].summary ? slugOf(i.href) : null)).filter(Boolean));

/* -------------------------------------------------------------------- output */

const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
console.log("");
console.log("=".repeat(72));
console.log("  HOMEPAGE — live vs generated");
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
