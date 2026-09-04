#!/usr/bin/env node
/**
 * compare-business-forum.js — semantic comparison of the two generated Polish
 * Business Forum pages against their live counterparts.
 *
 * The Forum is a branded set piece, so this script is less about prose and more
 * about STRUCTURE surviving: the logo lock-up, the watermarks, the screen-reader
 * heading, the counter attributes js/main.js depends on, and above all the
 * carousel's duplicated tile sets — the auto-scroll wraps at scrollWidth / 2, so
 * anything other than exactly two identical sets breaks the loop silently.
 *
 * Two modes, as in compare-standard-events.js:
 *
 *   REQUIRED EQUIVALENCE — sections, headings, prose, images, alt text, links,
 *     partners, facts, statistics, JSON-LD, accessibility attributes, chrome.
 *     Any difference fails.
 *
 *   APPROVED CORRECTION — an exact, enumerated before/after pair, verified in
 *     BOTH directions: the live page must say the old value and the generated
 *     page the new one. A correction that silently failed to apply fails just as
 *     loudly as a regression, and nothing hides inside a broad exemption.
 *
 * Run:  node scripts/compare-business-forum.js
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

const norm = (h) =>
  String(h).replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
const text = (h) =>
  h == null ? null : decode(norm(h).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() || null;
/** Locale-independent asset identity: "../assets/x", "assets/x", "/assets/x" → "assets/x". */
const assetKey = (p) => (p == null ? null : String(p).replace(/^(\.\.\/)+/, "").replace(/^\/+/, ""));
/** Attribute lookup by name — order within the tag is irrelevant. */
const attrOf = (tag, name) => {
  const m = String(tag || "").match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  return m ? decode(m[1]) : null;
};
// Plain substring test: a trailing \b never matches after a quote character,
// which would silently make every aria-hidden probe return false.
const hasAttr = (tag, name) =>
  new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(String(tag || ""));
/** Button/link label without the decorative arrow glyph, which is template chrome. */
const labelText = (h) => (text(h) || "").replace(/\s*→\s*$/, "").trim() || null;
/** Inline style compared as a set of declarations, so property order is free. */
const styleSet = (s) =>
  String(s || "")
    .split(";").map((d) => d.trim().replace(/\s*:\s*/, ":").replace(/\s+/g, " "))
    .filter(Boolean).sort();

/** Walk tag depth from the end of an opening tag to its matching close. */

/*
  THE TWO APPROVED FOOTER LINKS, both human-approved.

    1. STAFF LOGIN (Phase 17D.1) — the way in to the content manager for
       committee officers, and the only intentional public change of that phase.
    2. THE NETLIFY ATTRIBUTION (open-source release) — Netlify's open-source
       policy requires "a link to our service on your main page, or all
       internal pages". The link lives in the shared footer partial, so every
       page in both languages carries it.

  Both are handled as ENUMERATED additions rather than by relaxing the
  comparison: the generated footer must contain each one, the live footer must
  NOT (the live pages predate both), and everything else about the footer must
  still match exactly. A THIRD new link, or either of these going missing,
  still fails.
*/
const STAFF_LOGIN = "staff-login/";
const NETLIFY = "https://www.netlify.com";

/** The footer as it should be, ignoring only the two approved additions. */
function footerWithoutApproved(links) {
  return links.filter((href) =>
    !String(href).endsWith(STAFF_LOGIN) && String(href) !== NETLIFY);
}

/** Page-wide external links, ignoring only the approved Netlify attribution. */
function externalsWithoutApproved(links) {
  return links.filter((entry) => !String(entry).startsWith(NETLIFY + "|"));
}

function blockAfter(html, openEnd, tag = "div") {
  let depth = 1;
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, "g");
  re.lastIndex = openEnd;
  let m;
  while ((m = re.exec(html)) !== null) {
    depth += m[0] === `</${tag}>` ? -1 : 1;
    if (depth === 0) return html.slice(openEnd, m.index);
  }
  return null;
}

/** The <section> whose opening tag matches `re`, by class. */
function section(html, re) {
  const m = html.match(re);
  if (!m) return null;
  return blockAfter(html, m.index + m[0].length, "section");
}

/* --------------------------------------------------------------- extraction */

function parse(html) {
  const o = {};
  const head = html.split("</head>")[0];
  const body = html.includes("</header>")
    ? html.split("</header>")[1].split("<footer")[0]
    : html;

  const g = (re, src = head) => { const m = src.match(re); return m ? m[1] : null; };

  /* ---- document + SEO ---- */
  o.htmlLang = g(/<html lang="([^"]*)"/, html);
  o.bodyClass = g(/<body class="([^"]*)"/, html);
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
  o.twitterImageAlt = decode(g(/<meta name="twitter:image:alt" content="([^"]*)">/) || "");
  o.twitterCard = g(/<meta name="twitter:card" content="([^"]*)">/);

  // Stylesheet CASCADE ORDER: pbf.css must follow style.css or the branded
  // overrides lose. Compared as an ordered list of identities, not raw hrefs,
  // because generated paths are root-relative by design.
  o.stylesheets = [...head.matchAll(/<link rel="stylesheet" href="([^"]*)">/g)]
    .map((m) => m[1])
    .filter((h) => !/^https?:/.test(h))
    .map((h) => assetKey(h));

  o.scripts = [...html.matchAll(/<script[^>]*\bsrc="([^"]*)"/g)].map((m) => assetKey(m[1]));

  /* ---- JSON-LD ---- */
  const ld = g(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/, html);
  o.jsonld = null;
  o.jsonldValid = false;
  if (ld) {
    try { o.jsonld = JSON.parse(ld); o.jsonldValid = true; } catch { o.jsonldValid = false; }
  }

  /* ---- shared chrome ---- */
  o.navItems = [...html.matchAll(/<li><a\b([^>]*)>([\s\S]*?)<\/a><\/li>/g)]
    .map((m) => `${attrOf(m[0], "href")}|${text(m[2]) || attrOf(m[0], "aria-label")}`);
  o.activeNav = (html.match(/<li><a href="([^"]*)" class="active">/) || [])[1];
  o.langSwitch = [...html.matchAll(/<a href="([^"]*)" hreflang="([^"]*)"[^>]*>/g)].map((m) => `${m[2]}=${m[1]}`);
  o.footerLinks = html.includes("<footer")
    ? [...html.split("<footer")[1].matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => assetKey(m[1]))
    : [];

  /* ---- hero ---- */
  const heroOpen = (body.match(/<section class="pbf-hero"[^>]*>/) || [""])[0];
  // The edition-specific backdrop arrives as a custom property; the live pages
  // set none and fall back to the value in css/pbf.css.
  o.heroInlineStyle = styleSet(attrOf(heroOpen, "style"));
  o.heroBackdropUrl = (String(attrOf(heroOpen, "style") || "")
    .match(/--pbf-hero-backdrop:\s*url\(['"]?([^'")]+)['"]?\)/) || [])[1] || null;
  const hero = section(body, /<section class="pbf-hero"[^>]*>/);
  if (!hero) throw new Error("PBF hero section not found");
  o.heroBg = /<div class="hero-bg" aria-hidden="true"><\/div>/.test(norm(hero));
  o.heroWatermark = text(g(/<span class="pbf-watermark"[^>]*>([\s\S]*?)<\/span>/, hero));
  o.heroWatermarkHidden = hasAttr((hero.match(/<span class="pbf-watermark"[^>]*>/) || [""])[0], 'aria-hidden="true"');
  o.backLink = { href: g(/<a class="back-link" href="([^"]*)">/, hero), label: text(g(/<a class="back-link"[^>]*>([\s\S]*?)<\/a>/, hero)) };
  o.heroEyebrow = text(g(/<span class="pbf-eyebrow">([\s\S]*?)<\/span>/, hero));
  o.srHeading = text(g(/<h1 class="sr-only">([\s\S]*?)<\/h1>/, hero));
  const logoTag = (hero.match(/<img class="pbf-logo"[^>]*>/) || [""])[0];
  o.logo = { src: assetKey(attrOf(logoTag, "src")), alt: attrOf(logoTag, "alt") };
  o.tagline = text(g(/<p class="pbf-tagline">([\s\S]*?)<\/p>/, hero));
  o.facts = [...hero.matchAll(
    /<div class="fact"><span class="fact-label">([\s\S]*?)<\/span><span class="fact-value">([\s\S]*?)<\/span><\/div>/g
  )].map((m) => `${text(m[1])}=${text(m[2])}`);

  /* ---- story ---- */
  const story = section(body, /<section class="section has-watermark">/);
  if (!story) throw new Error("story section not found");
  o.storyWatermark = text(g(/<span class="watermark"[^>]*>([\s\S]*?)<\/span>/, story));
  o.storyGalleries = [...story.matchAll(/<div class="gallery-grid reveal" style="([^"]*)">/g)].map((m) => {
    const inner = blockAfter(story, m.index + m[0].length);
    return {
      style: styleSet(m[1]),
      tiles: [...inner.matchAll(/<div class="(ph[^"]*)">\s*<img\b([^>]*)>\s*<\/div>/g)].map((t) => ({
        classes: t[1].split(/\s+/).sort().join(" "),
        src: assetKey(attrOf("<img" + t[2] + ">", "src")),
        alt: attrOf("<img" + t[2] + ">", "alt"),
      })),
    };
  });
  const prose = (() => {
    const m = story.match(/<div class="prose reveal">/);
    return m ? blockAfter(story, m.index + m[0].length) : null;
  })();
  if (!prose) throw new Error("story prose not found");
  o.proseBlocks = [...prose.matchAll(/<(p|h2|h3|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((m) => `${m[1]}: ${text(m[2])}`);
  o.proseLinks = [...prose.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>/g)].map((m) => m[1]);
  // .prose blockquote styles the element itself; a nested <p> would inherit
  // .prose p and silently lose the quote treatment.
  o.proseQuoteNestedP = (prose.match(/<blockquote>\s*<p>/g) || []).length;
  o.proseEmphasis = [...prose.matchAll(/<em>([\s\S]*?)<\/em>/g)].map((m) => text(m[1]));

  /* ---- statistics ---- */
  const stats = section(body, /<section class="section section-navy spotlight pbf-stats">/);
  if (!stats) throw new Error("statistics section not found");
  o.statsBg = assetKey((g(/background-image: url\('([^']*)'\)/, stats) || ""));
  o.statsBgHidden = hasAttr((stats.match(/<div class="pbf-stats-bg"[^>]*>/) || [""])[0], 'aria-hidden="true"');
  o.statsEyebrow = text(g(/<span class="eyebrow">([\s\S]*?)<\/span>/, stats));
  o.stats = [...stats.matchAll(/<div class="stat( reveal[^"]*)?">([\s\S]*?)<div class="stat-label">([\s\S]*?)<\/div>/g)]
    .map((m) => {
      const numTag = (m[2].match(/<div class="stat-number"[^>]*>/) || [""])[0];
      const valTxt = text((m[2].match(/<div class="stat-value">([\s\S]*?)<\/div>/) || [])[1]);
      return {
        reveal: (m[1] || "").trim().split(/\s+/).filter(Boolean).sort().join(" "),
        label: text(m[3]),
        count: attrOf(numTag, "data-count"),
        suffix: attrOf(numTag, "data-suffix"),
        // data-plain suppresses thousands separators for year-like numbers.
        plain: numTag ? hasAttr(numTag, "data-plain") : null,
        value: valTxt,
      };
    });

  /* ---- forum ball ---- */
  const ball = section(body, /<section class="section pbf-ball">/);
  o.ball = null;
  if (ball) {
    const img = (ball.match(/<img\b[^>]*>/) || [""])[0];
    o.ball = {
      grid: /pbf-ball-grid/.test(ball),
      image: assetKey(attrOf(img, "src")),
      imageAlt: attrOf(img, "alt"),
      caption: text(g(/<div class="pbf-caption">([\s\S]*?)<\/div>/, ball)),
      eyebrow: text(g(/<span class="eyebrow">([\s\S]*?)<\/span>/, ball)),
      title: text(g(/<h2 class="section-title">([\s\S]*?)<\/h2>/, ball)),
      titleFancy: text(g(/<h2 class="section-title">[\s\S]*?<span class="fancy">([\s\S]*?)<\/span>/, ball)),
      paragraphs: [...ball.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)].map((m) => text(m[2])),
      firstParaStyle: styleSet(attrOf((ball.match(/<p\b[^>]*>/) || [""])[0], "style")),
    };
  }

  /* ---- people ---- */
  const peopleStart = body.indexOf('<section class="section has-watermark">',
    body.indexOf('<section class="section has-watermark">') + 10);
  const people = peopleStart === -1 ? null
    : blockAfter(body, peopleStart + '<section class="section has-watermark">'.length, "section");
  if (!people) throw new Error("people section not found");
  o.peopleWatermark = text(g(/<span class="watermark"[^>]*>([\s\S]*?)<\/span>/, people));
  o.peopleEyebrow = text(g(/<span class="eyebrow">([\s\S]*?)<\/span>/, people));
  o.peopleTitle = text(g(/<h2 class="section-title">([\s\S]*?)<\/h2>/, people));
  o.peopleLead = text(g(/<p class="lead">([\s\S]*?)<\/p>/, people));
  o.people = [...people.matchAll(
    /<div class="pbf-person">\s*<div class="pp">\s*<img\b([^>]*)>\s*<\/div>\s*<h3>([\s\S]*?)<\/h3>\s*<span class="pbf-role">([\s\S]*?)<\/span>/g
  )].map((m) => ({
    photo: assetKey(attrOf("<img" + m[1] + ">", "src")),
    photoAlt: attrOf("<img" + m[1] + ">", "alt"),
    name: text(m[2]),
    role: text(m[3]),
  }));
  const ack = (() => {
    const m = people.match(/<div class="pbf-ack reveal">/);
    return m ? blockAfter(people, m.index + m[0].length) : null;
  })();
  o.ack = ack ? {
    text: text(g(/<p>([\s\S]*?)<\/p>/, ack)),
    href: g(/<a class="btn btn-primary" href="([^"]*)">/, ack),
    label: text(g(/<a class="btn btn-primary"[^>]*>([\s\S]*?)<\/a>/, ack)),
  } : null;
  o.photoRow = [...people.matchAll(
    /<figure>\s*<div class="pbf-img">\s*<img\b([^>]*)>\s*<\/div>\s*<figcaption class="pbf-caption">([\s\S]*?)<\/figcaption>/g
  )].map((m) => ({
    src: assetKey(attrOf("<img" + m[1] + ">", "src")),
    alt: attrOf("<img" + m[1] + ">", "alt"),
    caption: text(m[2]),
  }));

  /* ---- partners ---- */
  const partners = section(body, /<section class="section section-cream">/);
  if (!partners) throw new Error("partners section not found");
  o.partnersEyebrow = text(g(/<span class="eyebrow">([\s\S]*?)<\/span>/, partners));
  o.partnersTitle = text(g(/<h2 class="section-title">([\s\S]*?)<\/h2>/, partners));
  o.partnersLead = text(g(/<p class="lead">([\s\S]*?)<\/p>/, partners));
  o.partnerHeadings = [...partners.matchAll(/<div class="pbf-logos-head reveal"><h3>([\s\S]*?)<\/h3>/g)]
    .map((m) => text(m[1]));

  o.partnerGroups = [...partners.matchAll(/<div class="pbf-carousel-wrap reveal">/g)].map((m) => {
    const wrap = blockAfter(partners, m.index + m[0].length);
    const carOpen = wrap.match(/<div class="pbf-carousel"[^>]*>/);
    const car = blockAfter(wrap, carOpen.index + carOpen[0].length);
    const tiles = [...car.matchAll(/<div class="pbf-logo-tile"([^>]*)>\s*<img\b([^>]*)>\s*<\/div>/g)].map((t) => ({
      hidden: hasAttr(t[1], 'aria-hidden="true"'),
      src: assetKey(attrOf("<img" + t[2] + ">", "src")),
      alt: attrOf("<img" + t[2] + ">", "alt"),
    }));
    const visible = tiles.filter((t) => !t.hidden);
    const hidden = tiles.filter((t) => t.hidden);
    return {
      autoscroll: hasAttr(carOpen[0], "data-autoscroll"),
      ariaLabel: attrOf(carOpen[0], "aria-label"),
      prevLabel: attrOf((wrap.match(/<button class="car-arrow car-prev"[^>]*>/) || [""])[0], "aria-label"),
      nextLabel: attrOf((wrap.match(/<button class="car-arrow car-next"[^>]*>/) || [""])[0], "aria-label"),
      prevType: attrOf((wrap.match(/<button class="car-arrow car-prev"[^>]*>/) || [""])[0], "type"),
      nextType: attrOf((wrap.match(/<button class="car-arrow car-next"[^>]*>/) || [""])[0], "type"),
      // The carousel's loop wraps at scrollWidth / 2 — the number of identical
      // sets is load-bearing, so it is compared, not tolerated.
      sets: visible.length ? tiles.length / visible.length : 0,
      visibleCount: visible.length,
      hiddenCount: hidden.length,
      logos: visible.map((t) => `${t.src}|${t.alt}`),
      duplicateOrder: hidden.map((t) => t.src),
      // Repeated tiles must be silent to assistive technology, or a screen
      // reader announces every partner twice.
      duplicateAltsEmpty: hidden.every((t) => t.alt === ""),
    };
  });

  const funding = (() => {
    const m = partners.match(/<div class="funding-note reveal">/);
    return m ? blockAfter(partners, m.index + m[0].length) : null;
  })();
  o.funding = funding ? {
    logo: assetKey(attrOf((funding.match(/<img\b[^>]*>/) || [""])[0], "src")),
    logoAlt: attrOf((funding.match(/<img\b[^>]*>/) || [""])[0], "alt"),
    text: text(g(/<p>([\s\S]*?)<\/p>/, funding)),
  } : null;

  /* ---- photographers ---- */
  const photogs = section(body, /<section class="section pbf-photogs">/);
  if (!photogs) throw new Error("photographers section not found");
  o.photogsEyebrow = text(g(/<span class="eyebrow">([\s\S]*?)<\/span>/, photogs));
  o.photogsTitle = text(g(/<h2 class="section-title">([\s\S]*?)<\/h2>/, photogs));
  o.photogsLead = text(g(/<p class="lead">([\s\S]*?)<\/p>/, photogs));
  o.photographers = [...photogs.matchAll(/<div class="pbf-photog( reveal[^"]*)?">/g)].map((m) => {
    const card = blockAfter(photogs, m.index + m[0].length);
    const link = card.match(/<a class="btn btn-pbf"[^>]*>([\s\S]*?)<\/a>/);
    const linkTag = (card.match(/<a class="btn btn-pbf"[^>]*>/) || [""])[0];
    return {
      reveal: (m[1] || "").trim().split(/\s+/).filter(Boolean).sort().join(" "),
      camHidden: hasAttr((card.match(/<div class="cam"[^>]*>/) || [""])[0], 'aria-hidden="true"'),
      hasSvg: /<svg\b/.test(card),
      tag: text(g(/<span class="ptag">([\s\S]*?)<\/span>/, card)),
      name: text(g(/<h3>([\s\S]*?)<\/h3>/, card)),
      description: text(g(/<p>([\s\S]*?)<\/p>/, card)),
      pin: text(g(/<span class="pbf-pin">([\s\S]*?)<\/span>/, card)),
      href: attrOf(linkTag, "href"),
      target: attrOf(linkTag, "target"),
      rel: attrOf(linkTag, "rel"),
      label: labelText(link ? link[1] : null),
      hasArrow: /<span class="arrow">/.test(card),
    };
  });
  const backBottom = photogs.match(/<a class="btn btn-pbf" href="([^"]*)" style="([^"]*)">([\s\S]*?)<\/a>/);
  o.backBottom = backBottom
    ? { href: backBottom[1], style: styleSet(backBottom[2]), label: text(backBottom[3]) }
    : null;

  /* ---- whole-page invariants ---- */
  o.sectionClasses = [...body.matchAll(/<section class="([^"]*)"/g)]
    .map((m) => m[1].split(/\s+/).sort().join(" "));
  o.allImages = [...html.matchAll(/<img\b[^>]*>/g)].map((t) => assetKey(attrOf(t[0], "src")));
  o.imagesWithoutAlt = [...html.matchAll(/<img\b[^>]*>/g)]
    .filter((t) => attrOf(t[0], "alt") === null).map((t) => attrOf(t[0], "src"));
  o.plAssetPaths = [...html.matchAll(/["'(](\/pl\/assets\/[^"')]*)/g)].map((m) => m[1]);

  // Every external link with its target and rel. Dropping rel="noopener" on a
  // target="_blank" link is a real security regression and must not pass just
  // because the visible label is unchanged.
  o.externalLinks = [...html.matchAll(/<a\b[^>]*>/g)]
    .filter((m) => /^https?:/.test(attrOf(m[0], "href") || ""))
    .map((m) => `${attrOf(m[0], "href")}|target=${attrOf(m[0], "target")}|rel=${attrOf(m[0], "rel")}`);

  return o;
}

/* ------------------------------------------------------------ approved diffs */

/**
 * Enumerated approved corrections, per locale: [live value, generated value].
 * Both directions are asserted.
 */
const CORRECTIONS = {
  en: {},
  pl: {
    // Decision 1 (Phase 10): the live Polish page repeats the ENGLISH
    // og:image:alt. The replacement is the Polish description of the same
    // photograph already used by the live Polish listing card and story gallery.
    ogImageAlt: [
      "The Polish Business Forum team on the main stage at London Business School",
      "Zespół Polish Business Forum na głównej scenie w London Business School",
    ],
    twitterImageAlt: [
      "The Polish Business Forum team on the main stage at London Business School",
      "Zespół Polish Business Forum na głównej scenie w London Business School",
    ],
  },
};

/**
 * The three untranslated Polish fragments corrected in this pass. Each is an
 * exact before/after pair, asserted in both directions.
 *
 * These are NOT applied as a blanket "ignore Polish text differences" rule. The
 * pair is spliced into a copy of the LIVE structure and then FULL equality with
 * the generated page is still required — so every other paragraph, role, label,
 * image and link inside those same structures is compared as strictly as before,
 * and an unrelated regression cannot hide inside the exemption.
 */
const PL_TRANSLATIONS = {
  ballParagraphs: [
    [
      "The inaugural Polish Business Forum Ball brought delegates, speakers and partners together for a grand black-tie evening at The Landmark London — one of the capital's most storied five-star hotels.",
      "Pierwszy Bal Polish Business Forum zgromadził delegatów, prelegentów i partnerów podczas uroczystego wieczoru w formule black tie w The Landmark London, jednym z najbardziej znanych pięciogwiazdkowych hoteli w Londynie.",
    ],
    [
      "The night opened in true Polish tradition with the polonez, before dinner, speeches and dancing carried the Forum's conversations long past midnight. It was the moment the conference became a community.",
      "Wieczór rozpoczął się zgodnie z polską tradycją polonezem. Następnie kolacja, przemówienia i tańce sprawiły, że rozmowy rozpoczęte podczas Forum trwały długo po północy. To był moment, w którym konferencja przerodziła się w prawdziwą społeczność.",
    ],
  ],
  // Nikodem Rajpold, the second person in the grid. The Polish wording matches
  // Szymon Kwidziński's, whose English role is character-for-character identical.
  personRole: { index: 1, pair: ["Project Leader & Founder", "Lider projektu i współzałożyciel"] },
  // Stas Romanowski, the second photographer card.
  photographerLabel: { index: 1, pair: ["Open the gallery", "Otwórz galerię"] },
};

/** The IT-owned repetition count — the record must not carry it. */
const { carouselSets: EXPECTED_CAROUSEL_SETS } = require("../src/_data/businessForumTechnical.js");

/**
 * The backdrop css/pbf.css falls back to, read from the stylesheet itself. The
 * generated pages must name the same asset, or the migrated and hand-written
 * heroes would render different photographs.
 */
const CSS_FALLBACK_BACKDROP = (() => {
  const css = read("css/pbf.css");
  const m = css.match(/var\(--pbf-hero-backdrop,\s*url\("([^"]+)"\)\)/);
  if (!m) {
    console.error("FATAL: css/pbf.css has no --pbf-hero-backdrop fallback — "
      + "the hand-written live pages would lose their hero image.");
    process.exit(1);
  }
  return assetKey(m[1]);
})();

const PAGES = [
  { locale: "en", live: "event-business-forum.html", gen: "dist/event-business-forum.html" },
  { locale: "pl", live: "pl/event-business-forum.html", gen: "dist/pl/event-business-forum.html" },
];

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

function checkCorrection(label, liveValue, genValue, pair) {
  const [was, now] = pair;
  check(`${label}: live page still says the old value`, was, liveValue,
    "approved correction — verified in both directions");
  check(`${label}: generated page applies the correction`, now, genValue,
    "approved correction — verified in both directions");
}

for (const page of PAGES) {
  const L = parse(read(page.live));
  const G = parse(read(page.gen));
  const tag = `[${page.locale}]`;
  const corr = CORRECTIONS[page.locale] || {};

  /* fail loudly if nothing parsed */
  if (!L.partnerGroups.length || !L.people.length || !L.stats.length) {
    console.error(`FATAL ${tag}: parsed no partner groups / people / statistics from ${page.live}`);
    process.exit(1);
  }
  if (!G.partnerGroups.length || !G.people.length || !G.stats.length) {
    console.error(`FATAL ${tag}: parsed no partner groups / people / statistics from ${page.gen}`);
    process.exit(1);
  }

  /* ---- document, chrome, SEO ---- */
  check(`${tag} html lang`, L.htmlLang, G.htmlLang);
  check(`${tag} body class is pbf-page`, L.bodyClass, G.bodyClass);
  check(`${tag} <title>`, L.title, G.title);
  check(`${tag} meta description`, L.description, G.description);
  check(`${tag} canonical`, L.canonical, G.canonical);
  check(`${tag} hreflang trio (incl. x-default)`, L.hreflang, G.hreflang);
  check(`${tag} og:type`, L.ogType, G.ogType);
  check(`${tag} og:locale`, L.ogLocale, G.ogLocale);
  check(`${tag} og:locale:alternate`, L.ogLocaleAlt, G.ogLocaleAlt);
  check(`${tag} og:url`, L.ogUrl, G.ogUrl);
  check(`${tag} og:image`, L.ogImage, G.ogImage);
  check(`${tag} twitter:card`, L.twitterCard, G.twitterCard);
  // Stylesheet cascade: style.css then pbf.css, in that order.
  check(`${tag} stylesheet cascade order`, L.stylesheets, G.stylesheets);
  check(`${tag} pbf.css follows style.css`,
    true, G.stylesheets.indexOf("css/pbf.css") > G.stylesheets.indexOf("css/style.css"));
  check(`${tag} scripts`, L.scripts, G.scripts);
  check(`${tag} navigation items`, L.navItems, G.navItems);
  check(`${tag} Events is the active nav item`, L.activeNav, G.activeNav);
  check(`${tag} language switcher destinations`, L.langSwitch, G.langSwitch);
  check(`${tag} footer links`, L.footerLinks, footerWithoutApproved(G.footerLinks));
  check(`${tag} APPROVED: the footer offers Staff login`,
    true, G.footerLinks.some((href) => String(href).endsWith(STAFF_LOGIN)));
  check(`${tag} APPROVED: the live footer did not`,
    false, L.footerLinks.some((href) => String(href).endsWith(STAFF_LOGIN)));
  /*
    NETLIFY OPEN SOURCE PLAN, REQUIREMENT (c). Asserted rather than tolerated:
    the charity's hosting credits depend on this link, so no future refactor of
    the footer may drop it silently.
  */
  check(`${tag} APPROVED: the footer credits Netlify (Open Source Plan requirement)`,
    true, G.footerLinks.some((href) => String(href) === NETLIFY));
  check(`${tag} APPROVED: the live footer did not credit Netlify`,
    false, L.footerLinks.some((href) => String(href) === NETLIFY));

  if (corr.ogImageAlt) checkCorrection(`${tag} og:image:alt`, L.ogImageAlt, G.ogImageAlt, corr.ogImageAlt);
  else check(`${tag} og:image:alt`, L.ogImageAlt, G.ogImageAlt);
  if (corr.twitterImageAlt) checkCorrection(`${tag} twitter:image:alt`, L.twitterImageAlt, G.twitterImageAlt, corr.twitterImageAlt);
  else check(`${tag} twitter:image:alt`, L.twitterImageAlt, G.twitterImageAlt);

  /* ---- JSON-LD ---- */
  check(`${tag} JSON-LD parses`, true, G.jsonldValid);
  check(`${tag} JSON-LD matches the live block`, L.jsonld, G.jsonld);
  // Guarded: an unparseable block already failed above, and reading through it
  // would crash the run instead of reporting the remaining differences.
  if (G.jsonldValid && G.jsonld) {
    check(`${tag} JSON-LD startDate <= endDate`, true,
      String(G.jsonld.startDate) <= String(G.jsonld.endDate));
    check(`${tag} JSON-LD venue matches the facts bar`, true,
      L.facts.some((f) => f.endsWith(`=${G.jsonld.location.name}`)));
  }

  /* ---- hero ---- */
  check(`${tag} hero backdrop element present and decorative`, L.heroBg, G.heroBg);
  // APPROVED ARCHITECTURAL DIFFERENCE: the backdrop photograph is
  // edition-specific, so the generated page supplies it as a custom property. The
  // live page sets no inline style and relies on the css/pbf.css fallback, which
  // must point at the very same asset — otherwise the two would render
  // differently.
  check(`${tag} live hero carries no inline backdrop`, [], L.heroInlineStyle);
  check(`${tag} generated hero supplies --pbf-hero-backdrop`,
    ["--pbf-hero-backdrop:url('/assets/pbf/stage.jpg')"], G.heroInlineStyle);
  check(`${tag} the backdrop is the same asset css/pbf.css falls back to`,
    CSS_FALLBACK_BACKDROP, assetKey(G.heroBackdropUrl));
  check(`${tag} hero watermark text`, L.heroWatermark, G.heroWatermark);
  check(`${tag} hero watermark is aria-hidden`, L.heroWatermarkHidden, G.heroWatermarkHidden);
  check(`${tag} hero back-link`, L.backLink, G.backLink);
  check(`${tag} hero eyebrow`, L.heroEyebrow, G.heroEyebrow);
  check(`${tag} screen-reader-only <h1>`, L.srHeading, G.srHeading);
  check(`${tag} logo lock-up`, L.logo, G.logo);
  check(`${tag} tagline`, L.tagline, G.tagline);
  check(`${tag} facts bar (4 label/value pairs)`, L.facts, G.facts);

  /* ---- story ---- */
  check(`${tag} story watermark`, L.storyWatermark, G.storyWatermark);
  check(`${tag} story galleries`, L.storyGalleries, G.storyGalleries);
  check(`${tag} story prose blocks`, L.proseBlocks, G.proseBlocks);
  check(`${tag} story prose links`, L.proseLinks, G.proseLinks);
  check(`${tag} story emphasis runs`, L.proseEmphasis, G.proseEmphasis);
  check(`${tag} blockquote has no nested <p>`, 0, G.proseQuoteNestedP,
    ".prose blockquote styles the element; a nested <p> would override it");

  /* ---- statistics ---- */
  check(`${tag} statistics background image`, L.statsBg, G.statsBg);
  check(`${tag} statistics background is decorative`, L.statsBgHidden, G.statsBgHidden);
  check(`${tag} statistics eyebrow`, L.statsEyebrow, G.statsEyebrow);
  check(`${tag} statistics (counters, suffixes, data-plain, labels)`, L.stats, G.stats);

  /* ---- forum ball ---- */
  check(`${tag} Forum Ball renders (enabled this edition)`, true, G.ball !== null);
  if (page.locale === "pl") {
    // Verify each paragraph's before/after pair explicitly...
    PL_TRANSLATIONS.ballParagraphs.forEach(([was, now], i) => {
      check(`${tag} Forum Ball paragraph ${i + 1}: live page is still English`, was, L.ball.paragraphs[i],
        "approved translation — verified in both directions");
      check(`${tag} Forum Ball paragraph ${i + 1}: generated page is Polish`, now, G.ball.paragraphs[i],
        "approved translation — verified in both directions");
    });
    check(`${tag} Forum Ball copy contains no English leftovers`, [],
      G.ball.paragraphs.filter((p) => PL_TRANSLATIONS.ballParagraphs.some(([was]) => p === was)));
    // ...then splice them into the live object and still demand full equality, so
    // the caption, eyebrow, title, image, alt and inline style are unchanged.
    const corrected = JSON.parse(JSON.stringify(L.ball));
    corrected.paragraphs = PL_TRANSLATIONS.ballParagraphs.map(([, now]) => now);
    check(`${tag} Forum Ball is otherwise identical to the live page`, corrected, G.ball);
  } else {
    check(`${tag} Forum Ball content`, L.ball, G.ball);
  }

  /* ---- people ---- */
  check(`${tag} people watermark`, L.peopleWatermark, G.peopleWatermark);
  check(`${tag} people eyebrow`, L.peopleEyebrow, G.peopleEyebrow);
  check(`${tag} people section title`, L.peopleTitle, G.peopleTitle);
  check(`${tag} people lead`, L.peopleLead, G.peopleLead);
  if (page.locale === "pl") {
    const { index, pair: [was, now] } = PL_TRANSLATIONS.personRole;
    check(`${tag} ${L.people[index].name}'s role: live page is still English`, was, L.people[index].role,
      "approved translation — verified in both directions");
    check(`${tag} ${G.people[index].name}'s role: generated page is Polish`, now, G.people[index].role,
      "approved translation — verified in both directions");
    // The same English role belongs to another founder whose Polish the live page
    // already had; both must now read the same.
    check(`${tag} both identical English roles share one Polish wording`,
      G.people.filter((p) => p.role === now).length, 2);
    const corrected = JSON.parse(JSON.stringify(L.people));
    corrected[index].role = now;
    check(`${tag} people are otherwise identical to the live page (order, photos, names, roles)`,
      corrected, G.people);
  } else {
    check(`${tag} people (order, photos, names, roles)`, L.people, G.people);
  }
  check(`${tag} committee acknowledgement`, L.ack, G.ack);
  check(`${tag} people photo row`, L.photoRow, G.photoRow);

  /* ---- partners ---- */
  check(`${tag} partners eyebrow`, L.partnersEyebrow, G.partnersEyebrow);
  check(`${tag} partners section title`, L.partnersTitle, G.partnersTitle);
  check(`${tag} partners lead`, L.partnersLead, G.partnersLead);
  check(`${tag} partner group headings`, L.partnerHeadings, G.partnerHeadings);
  check(`${tag} partner group count`, L.partnerGroups.length, G.partnerGroups.length);
  L.partnerGroups.forEach((lg, i) => {
    const gg = G.partnerGroups[i] || {};
    const gt = `${tag} partner group ${i + 1} (${lg.ariaLabel})`;
    check(`${gt}: carousel is auto-scrolling`, lg.autoscroll, gg.autoscroll);
    check(`${gt}: accessible name`, lg.ariaLabel, gg.ariaLabel);
    check(`${gt}: arrow labels and types`,
      [lg.prevLabel, lg.nextLabel, lg.prevType, lg.nextType],
      [gg.prevLabel, gg.nextLabel, gg.prevType, gg.nextType]);
    check(`${gt}: logos (order, paths, accessible names)`, lg.logos, gg.logos);
    check(`${gt}: duplicated tile sets (js/main.js wraps at scrollWidth/2)`, lg.sets, gg.sets);
    // Pinned to the IT-owned constant, not to whatever the live page happens to
    // do — removing carousel_sets from the record must not weaken this.
    check(`${gt}: renders exactly ${EXPECTED_CAROUSEL_SETS} sequences (businessForumTechnical.carouselSets)`,
      EXPECTED_CAROUSEL_SETS, gg.sets);
    check(`${gt}: rendered tiles equal canonical logos × the technical repetition count`,
      gg.visibleCount * EXPECTED_CAROUSEL_SETS, gg.visibleCount + gg.hiddenCount);
    check(`${gt}: duplicated set is exactly one extra copy`, lg.hiddenCount, gg.hiddenCount);
    check(`${gt}: duplicated set preserves order`, lg.duplicateOrder, gg.duplicateOrder);
    check(`${gt}: duplicated tiles are silent to assistive tech`, true, gg.duplicateAltsEmpty);
  });

  /* ---- funding ---- */
  check(`${tag} funding acknowledgement`, L.funding, G.funding);

  /* ---- photographers ---- */
  check(`${tag} photographers eyebrow`, L.photogsEyebrow, G.photogsEyebrow);
  check(`${tag} photographers section title`, L.photogsTitle, G.photogsTitle);
  check(`${tag} photographers lead`, L.photogsLead, G.photogsLead);
  if (page.locale === "pl") {
    const { index, pair: [was, now] } = PL_TRANSLATIONS.photographerLabel;
    check(`${tag} ${L.photographers[index].name}'s button: live page is still English`,
      was, L.photographers[index].label, "approved translation — verified in both directions");
    check(`${tag} ${G.photographers[index].name}'s button: generated page is Polish`,
      now, G.photographers[index].label, "approved translation — verified in both directions");
    check(`${tag} both gallery buttons share one Polish label`,
      G.photographers.filter((p) => p.label === now).length, 2);
    const corrected = JSON.parse(JSON.stringify(L.photographers));
    corrected[index].label = now;
    // Links, PINs, tags, descriptions, target and rel must all still match.
    check(`${tag} photographer cards are otherwise identical to the live page`,
      corrected, G.photographers);
  } else {
    check(`${tag} photographer cards`, L.photographers, G.photographers);
  }
  check(`${tag} bottom back-link`, L.backBottom, G.backBottom);

  /* ---- whole page ---- */
  check(`${tag} section classes and order`, L.sectionClasses, G.sectionClasses);
  check(`${tag} every image, in order`, L.allImages, G.allImages);
  check(`${tag} external links keep their target and rel`,
    L.externalLinks, externalsWithoutApproved(G.externalLinks));
  // …and the one approved addition carries the same target/rel convention as
  // the links beside it, so it is not a window.opener regression.
  check(`${tag} APPROVED: the Netlify link is target=_blank with rel=noopener`,
    [`${NETLIFY}|target=_blank|rel=noopener`],
    G.externalLinks.filter((e) => String(e).startsWith(NETLIFY + "|")));
  check(`${tag} every target=_blank link carries rel=noopener`, [],
    G.externalLinks.filter((l) => l.includes("target=_blank") && !l.includes("noopener")));
  check(`${tag} no image is missing an alt attribute`, [], G.imagesWithoutAlt);
  check(`${tag} no /pl/assets/ path`, [], G.plAssetPaths);
}

/* ---- cross-locale invariants ---- */
const EN = parse(read(PAGES[0].gen));
const PL = parse(read(PAGES[1].gen));
check("cross-locale: identical image sets", EN.allImages, PL.allImages);
check("cross-locale: identical section structure", EN.sectionClasses, PL.sectionClasses);
check("cross-locale: identical partner logo paths",
  EN.partnerGroups.map((g) => g.logos.map((l) => l.split("|")[0])),
  PL.partnerGroups.map((g) => g.logos.map((l) => l.split("|")[0])));
check("cross-locale: identical counter values",
  EN.stats.map((s) => `${s.count}|${s.suffix}|${s.plain}`),
  PL.stats.map((s) => `${s.count}|${s.suffix}|${s.plain}`));
check("cross-locale: identical JSON-LD dates",
  [EN.jsonld.startDate, EN.jsonld.endDate], [PL.jsonld.startDate, PL.jsonld.endDate]);
check("cross-locale: Polish og:image:alt is not the English string",
  true, EN.ogImageAlt !== PL.ogImageAlt);
check("cross-locale: Polish page declares inLanguage pl-PL", "pl-PL", PL.jsonld.inLanguage);
check("cross-locale: English page declares no inLanguage", undefined, EN.jsonld.inLanguage);

/* -------------------------------------------------------------------- output */

const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
console.log("");
console.log("=".repeat(72));
console.log("  POLISH BUSINESS FORUM — live vs generated");
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
if (failures === 0) {
  console.log(`  PASS — ${comparisons}/${comparisons} comparisons matched`);
} else {
  console.log(`  FAIL — ${failures} of ${comparisons} comparisons differ`);
}
console.log("=".repeat(72));
console.log("");
process.exit(failures === 0 ? 0 : 1);
