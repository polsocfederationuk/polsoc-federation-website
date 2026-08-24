#!/usr/bin/env node
/**
 * compare-standard-events.js — semantic comparison of the four standard event
 * pages against their live counterparts, in both languages (8 page pairs).
 *
 * Unlike the earlier comparison scripts, this one cannot demand equivalence
 * everywhere: Phase 11 applied a list of APPROVED CORRECTIONS to the content.
 * So it works in two modes.
 *
 *   REQUIRED EQUIVALENCE — structure, prose, images, links, galleries, embeds,
 *     album cards, classes, chrome, URLs. Any difference is a failure.
 *
 *   APPROVED CORRECTION — an exact, enumerated before/after pair. The check is
 *     that the live page says the OLD value and the generated page says the NEW
 *     one. A correction that silently failed to apply, or that changed
 *     something it was not supposed to, fails just as loudly as a regression.
 *
 * That second mode matters: broadly ignoring a field because "it was meant to
 * change" would let an unrelated regression hide inside the exemption.
 *
 * Run:  node scripts/compare-standard-events.js
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

const norm = (h) => String(h).replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
const text = (h) => (h == null ? null : decode(norm(h).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() || null);
const assetKey = (p) => (p == null ? null : String(p).replace(/^(\.\.\/)+/, "").replace(/^\/+/, ""));
const attrOf = (a, n) => { const m = String(a || "").match(new RegExp(n + '\\s*=\\s*"([^"]*)"')); return m ? m[1] : null; };

/* --------------------------------------------------------------- extraction */

/** Walk div depth from the end of an opening tag to its matching close. */
function blockAfter(html, openEnd) {
  let depth = 1;
  const re = /<div[\s>]|<\/div>/g;
  re.lastIndex = openEnd;
  let m;
  while ((m = re.exec(html)) !== null) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return html.slice(openEnd, m.index);
  }
  return null;
}

function parse(html) {
  const o = { meta: {}, hero: {}, facts: [], sections: [], refs: {} };
  const head = html.split("</head>")[0];
  const body = html.includes("</header>") ? html.split("</header>")[1].split("<footer")[0] : html;

  const g = (re, src = head) => { const m = src.match(re); return m ? m[1] : null; };
  o.meta.htmlLang = g(/<html lang="([^"]*)"/, html);
  o.meta.title = text(g(/<title>([\s\S]*?)<\/title>/));
  o.meta.description = decode(g(/<meta name="description" content="([\s\S]*?)">/) || "");
  o.meta.canonical = g(/<link rel="canonical" href="([^"]+)">/);
  o.meta.ogLocale = g(/<meta property="og:locale" content="([^"]+)">/);
  // Added in Phase 12: these were NOT compared originally, and the generated
  // pages had drifted — og:type defaulted to "website" against the live pages'
  // "article", and the Icebreaker lost the shared banner's dimension fields.
  o.meta.ogType = g(/<meta property="og:type" content="([^"]*)">/);
  o.meta.ogImageExtended = [
    g(/<meta property="og:image:secure_url" content="([^"]*)">/),
    g(/<meta property="og:image:type" content="([^"]*)">/),
    g(/<meta property="og:image:width" content="([^"]*)">/),
    g(/<meta property="og:image:height" content="([^"]*)">/),
  ];
  o.meta.ogImage = assetKey((g(/<meta property="og:image" content="([^"]+)">/) || "").replace(/^https?:\/\/[^/]+/, ""));
  o.meta.ogImageAlt = decode(g(/<meta property="og:image:alt" content="([^"]*)">/) || "");
  o.meta.hreflang = [...head.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)">/g)]
    .map((m) => `${m[1]}=${m[2]}`).sort();

  // ---- hero ----
  o.hero.backLink = text(g(/<a class="back-link" href="([^"]*)">([\s\S]*?)<\/a>/, body) === null
    ? null : (body.match(/<a class="back-link" href="[^"]*">([\s\S]*?)<\/a>/) || [])[1]);
  o.hero.backHref = g(/<a class="back-link" href="([^"]*)"/, body);
  o.hero.eyebrow = text(g(/<span class="eyebrow">([\s\S]*?)<\/span>/, body));
  const h1 = (body.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1];
  o.hero.h1 = text(h1);
  o.hero.h1Fancy = text((String(h1).match(/<span class="fancy">([\s\S]*?)<\/span>/) || [])[1]);
  // Added in Phase 13. `text()` turns every tag into whitespace, so it CANNOT
  // see a missing space beside an inline <span> — Phase 11 shipped
  // "Polish Youth Congress2025" and this comparison passed. This reads the
  // heading the way a browser renders it: markup removed, nothing substituted.
  o.hero.h1Rendered = h1 == null ? null
    : decode(String(h1).replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").trim();
  o.hero.lead = text(g(/<p class="lead">([\s\S]*?)<\/p>/, body));

  // ---- facts ----
  for (const m of body.matchAll(/<div class="fact"><span class="fact-label">([\s\S]*?)<\/span><span class="fact-value([^"]*)">([\s\S]*?)<\/span><\/div>/g)) {
    const logos = [...m[3].matchAll(/<img[^>]*?src="([^"]+)"[^>]*?alt="([^"]*)"[^>]*>/g)]
      .map((im) => ({ src: assetKey(im[1]), alt: decode(im[2]) }));
    o.facts.push({ label: text(m[1]), value: logos.length ? null : text(m[3]),
      variant: logos.length ? "logos" : "text", logos: logos.length ? logos : undefined });
  }

  // ---- ordered sections ----
  const markers = [];
  for (const m of body.matchAll(/<div class="(gallery-grid|prose|section-head|album-card|insta-embed) reveal"([^>]*)>/g)) {
    markers.push({ start: m.index, end: m.index + m[0].length, kind: m[1], attrs: m[2] || "" });
  }
  markers.sort((a, b) => a.start - b.start);
  for (const mk of markers) {
    const blk = blockAfter(body, mk.end) || "";
    const style = (attrOf(mk.attrs, "style") || "").replace(/\s+/g, " ").trim();
    if (mk.kind === "gallery-grid") {
      const tiles = [...blk.matchAll(/<div class="(ph[^"]*)"><img[^>]*?src="([^"]+)"[^>]*?alt="([^"]*)"[^>]*><\/div>/g)]
        .map((t) => ({ wide: /span-2/.test(t[1]), src: assetKey(t[2]), alt: decode(t[3]) }));
      o.sections.push({ type: "gallery", style, tiles,
        instagramInGrid: /span-2 insta-embed/.test(blk),
        embedPermalink: (blk.match(/data-instgrm-permalink="([^"]+)"/) || [])[1] || null });
    } else if (mk.kind === "prose") {
      o.sections.push({
        type: "prose", style,
        paragraphs: [...blk.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((p) => text(p[1])),
        blockquotes: [...blk.matchAll(/<blockquote>([\s\S]*?)<\/blockquote>/g)].map((b) => text(b[1])),
        // Nested <p> inside a blockquote would silently restyle the quote.
        blockquoteHasNestedP: /<blockquote>\s*<p>/.test(blk),
        links: [...blk.matchAll(/<a href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g)]
          .map((a) => ({ href: a[1], target: attrOf(a[2], "target"), rel: attrOf(a[2], "rel"), label: text(a[3]) })),
        emphasis: [...blk.matchAll(/<em>([\s\S]*?)<\/em>/g)].map((e) => text(e[1])),
      });
    } else if (mk.kind === "section-head") {
      const title = (blk.match(/<h2 class="section-title">([\s\S]*?)<\/h2>/) || [])[1];
      o.sections.push({ type: "heading", style,
        eyebrow: text((blk.match(/<span class="eyebrow">([\s\S]*?)<\/span>/) || [])[1]),
        title: text(title),
        titleFancy: text((String(title).match(/<span class="fancy">([\s\S]*?)<\/span>/) || [])[1]) });
    } else if (mk.kind === "album-card") {
      const btn = blk.match(/<a class="btn btn-primary" href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/);
      o.sections.push({ type: "album", style,
        heading: text((blk.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1]),
        body: text((blk.match(/<div class="album-info">[\s\S]*?<p>([\s\S]*?)<\/p>/) || [])[1]),
        url: btn ? btn[1] : null,
        target: btn ? attrOf(btn[2], "target") : null,
        rel: btn ? attrOf(btn[2], "rel") : null,
        label: btn ? text(btn[3].replace(/<span class="arrow">[\s\S]*?<\/span>/, "")) : null,
        camAriaHidden: /<div class="cam" aria-hidden="true">/.test(blk) });
    } else {
      o.sections.push({ type: "instagram", style,
        permalink: (blk.match(/data-instgrm-permalink="([^"]+)"/) || [])[1] || null,
        /*
          A social block should hold a post and nothing else. The live Sikorski
          page put a photograph in the grid beside its embed; the fixed
          structure moved that photograph into the gallery, and this is what
          proves it did not stay behind as well.
        */
        tiles: [...blk.matchAll(/<img[^>]*?src="([^"]+)"/g)].map((m) => assetKey(m[1])) });
    }
  }

  // ---- page-level refs ----
  o.refs.bottomBackHref = g(/<a class="btn btn-ghost" href="([^"]+)">/, body);
  o.refs.bottomBackLabel = text(g(/<a class="btn btn-ghost" href="[^"]+">([\s\S]*?)<\/a>/, body));
  o.refs.stylesheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => assetKey(m[1]));
  o.refs.scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/g)].map((m) => assetKey(m[1]));
  o.refs.embedScript = /instagram\.com\/embed\.js/.test(html);
  o.refs.activeNav = /<a[^>]*class="[^"]*\bactive\b[^"]*"[^>]*href="events\.html"|<a[^>]*href="events\.html"[^>]*class="[^"]*\bactive\b[^"]*"/.test(html);
  o.refs.switcher = (html.match(/<nav class="lang-switch"[\s\S]*?<\/nav>/) || [""])[0].match(/href="([^"]+)"/g) || [];
  o.refs.allImages = [...body.matchAll(/<img[^>]*?src="([^"]+)"/g)].map((m) => assetKey(m[1]));
  o.refs.plAssetPaths = [...body.matchAll(/(?:src|href)="(\/pl\/assets\/[^"]*)"/g)].map((m) => m[1]);

  // ---- JSON-LD ----
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  o.jsonldRaw = ld ? ld[1] : null;
  o.jsonld = null;
  o.jsonldParseError = null;
  if (ld) {
    try { o.jsonld = JSON.parse(ld[1]); } catch (e) { o.jsonldParseError = e.message; }
  }
  return o;
}

/* ------------------------------------------------------------- comparison */

const results = [];
let failures = 0;
function check(label, expected, actual, note) {
  const e = JSON.stringify(expected), a = JSON.stringify(actual);
  const ok = e === a;
  if (!ok) failures++;
  results.push({ ok, label, expected: e, actual: a, note });
}

/**
 * APPROVED CORRECTIONS, enumerated exactly. Each says: the live page said X,
 * the generated page must say Y — and nothing else may move.
 */
/*
  THE FIXED PAGE STRUCTURE (Phase 17C.5A.3), human-approved.

  Every standard event now renders in one order — header, main body, gallery,
  registration, photo album, social, navigation — and the per-page spacing
  overrides that the old free-form section list needed are gone.

  Two consequences, both reviewed and approved before being recorded here:

    sectionOrder   The Sikorski Debate and the Youth Congress used to open with
                   a gallery ABOVE the writing. Their galleries now sit below
                   it, like every other event. Sikorski's second "gallery" was
                   never a gallery: it was a grid built to hold an Instagram
                   embed, and it is now simply a social post.

    sectionStyles  The live pages carry hand-tuned inline margins — 60px here,
                   70px there — because a freely ordered page needed spacing
                   decided per page. The fixed structure sets it once, so the
                   generated pages carry none.

  `sectionMap` says which generated section each live section became, so the
  per-section content checks below still run across the reordering instead of
  being silently skipped. Approving the order must not cost the paragraphs,
  photographs and links inside it.
*/
const CORRECTIONS = {
  "sikorski-debate": {
    en: { factsVenue: ["Polish Institute & Sikorski Museum", "Polish Institute and Sikorski Museum"],
          sectionOrder: [["gallery", "prose", "heading", "gallery"],
                         ["prose", "gallery", "heading", "instagram"]],
          sectionMap: [1, 0, 2, 3],
          sectionStyles: [["margin-bottom: 70px;", "", "margin-top: 70px;", ""],
                          ["", "", "", ""]],
          galleryTiles: [
            { srcs: ["assets/debata/networking.jpg", "assets/debata/debata-1.jpg",
              "assets/debata/oshaughnessy.jpg", "assets/debata/trustees.jpg"],
            alts: ["Guests networking among the collections of the Polish Institute and Sikorski Museum",
              "The audience during the debate at the Sikorski Institute",
              "Professor Nicholas O'Shaughnessy delivering the keynote lecture",
              "Federation trustees at the Polish Institute and Sikorski Museum"],
            wide: [true, false, false, true] },
            { srcs: ["assets/debata/networking.jpg", "assets/debata/debata-1.jpg",
              "assets/debata/oshaughnessy.jpg", "assets/debata/trustees.jpg",
              "assets/debata/debata-2.jpg"],
            alts: ["Guests networking among the collections of the Polish Institute and Sikorski Museum",
              "The audience during the debate at the Sikorski Institute",
              "Professor Nicholas O'Shaughnessy delivering the keynote lecture",
              "Federation trustees at the Polish Institute and Sikorski Museum",
              "A speaker during the debate at the Polish Institute and Sikorski Museum"],
            wide: [true, false, false, true, false] },
          ],
          absorbedPhoto: { src: "assets/debata/debata-2.jpg",
            alt: "A speaker during the debate at the Polish Institute and Sikorski Museum" } },
    pl: { factsVenue: ["Instytut Polski i Muzeum im. gen. Sikorskiego", "Instytut Polski i Muzeum im. gen. Sikorskiego"],
          ogAlt: ["Guests networking at the Polish Institute and Sikorski Museum before the debate",
                  "Goście rozmawiają wśród zbiorów Instytutu Polskiego i Muzeum im. gen. Sikorskiego"],
          sectionOrder: [["gallery", "prose", "heading", "gallery"],
                         ["prose", "gallery", "heading", "instagram"]],
          sectionMap: [1, 0, 2, 3],
          sectionStyles: [["margin-bottom: 70px;", "", "margin-top: 70px;", ""],
                          ["", "", "", ""]],
          galleryTiles: [
            { srcs: ["assets/debata/networking.jpg", "assets/debata/debata-1.jpg",
              "assets/debata/oshaughnessy.jpg", "assets/debata/trustees.jpg"],
            alts: ["Goście rozmawiają wśród zbiorów Instytutu Polskiego i Muzeum im. gen. Sikorskiego",
              "Widownia podczas debaty w Instytucie Sikorskiego",
              "Profesor Nicholas O'Shaughnessy wygłasza wykład otwierający",
              "Powiernicy Federacji w Instytucie Polskim i Muzeum im. gen. Sikorskiego"],
            wide: [true, false, false, true] },
            { srcs: ["assets/debata/networking.jpg", "assets/debata/debata-1.jpg",
              "assets/debata/oshaughnessy.jpg", "assets/debata/trustees.jpg",
              "assets/debata/debata-2.jpg"],
            alts: ["Goście rozmawiają wśród zbiorów Instytutu Polskiego i Muzeum im. gen. Sikorskiego",
              "Widownia podczas debaty w Instytucie Sikorskiego",
              "Profesor Nicholas O'Shaughnessy wygłasza wykład otwierający",
              "Powiernicy Federacji w Instytucie Polskim i Muzeum im. gen. Sikorskiego",
              "Mówca podczas debaty w Instytucie Polskim i Muzeum im. gen. Sikorskiego"],
            wide: [true, false, false, true, false] },
          ],
          absorbedPhoto: { src: "assets/debata/debata-2.jpg",
            alt: "Mówca podczas debaty w Instytucie Polskim i Muzeum im. gen. Sikorskiego" } },
  },
  "christmas-dinner": {
    en: { factsVenue: ["Ognisko, South Kensington", "Ognisko Restaurant, South Kensington"],
          sectionStyles: [["margin-bottom: 60px;", "", "", "", ""],
                          ["", "", "", "", ""]] },
    pl: { factsVenue: ["Ognisko Polskie, South Kensington", "Ognisko Restaurant, South Kensington"],
          h1: ["Annual Christmas Dinner", "Doroczna Kolacja Wigilijna"],
          ogAlt: ["Polish students seated for the traditional Christmas dinner at Ognisko",
                  "Studenci przy stołach oświetlonych świecami podczas wigilii w Ognisku Polskim"],
          sectionStyles: [["margin-bottom: 60px;", "", "", "", ""],
                          ["", "", "", "", ""]] },
  },
  "youth-congress": {
    en: { factsVenue: ["Ognisko Polskie, London", "Ognisko Polskie, London"],
          sectionOrder: [["gallery", "prose", "album", "instagram"],
                         ["prose", "gallery", "album", "instagram"]],
          sectionMap: [1, 0, 2, 3],
          sectionStyles: [["margin-bottom: 70px;", "", "", ""], ["", "", "", ""]] },
    pl: { factsVenue: ["Ognisko Polskie, Londyn", "Ognisko Polskie, Londyn"],
          ogAlt: ["The audience during a panel at the Polish Youth Congress in London",
                  "Widownia Polish Youth Congress w Ognisku Polskim"],
          sectionOrder: [["gallery", "prose", "album", "instagram"],
                         ["prose", "gallery", "album", "instagram"]],
          sectionMap: [1, 0, 2, 3],
          sectionStyles: [["margin-bottom: 70px;", "", "", ""], ["", "", "", ""]] },
  },
  "icebreaker": {
    en: { factsVenue: ["Mamuśka!, London Waterloo", "Mamuśka!, Waterloo"],
          factsDate: ["October 2025", "16 October 2025"],
          sectionStyles: [["margin-bottom: 60px;", "", "margin-top: 0;"], ["", "", ""]] },
    pl: { factsVenue: ["Mamuśka!, londyńskie Waterloo", "Mamuśka!, Waterloo"],
          factsDate: ["Październik 2025", "16 października 2025"],
          sectionStyles: [["margin-bottom: 60px;", "", "margin-top: 0;"], ["", "", ""]] },
  },
};

const EVENTS = ["sikorski-debate", "christmas-dinner", "youth-congress", "icebreaker"];
const SITE = "https://polsocfederation.pl";

function comparePage(slug, localeCode) {
  const pre = localeCode === "en" ? "" : "pl/";
  const livePath = `${pre}event-${slug}.html`;
  const genPath = `dist/${pre}event-${slug}.html`;
  const name = `${slug} [${localeCode}]`;
  console.log(`\n${"=".repeat(72)}\n  ${name}\n  ${livePath}  ->  ${genPath}\n${"=".repeat(72)}`);

  const before = results.length;
  const p = (s) => `${name}: ${s}`;
  const live = parse(read(livePath));
  const gen = parse(read(genPath));
  const corr = (CORRECTIONS[slug] || {})[localeCode] || {};

  // FAIL LOUDLY on an empty parse.
  check(p("live page parsed sections"), true, live.sections.length > 0);
  check(p("generated page parsed sections"), true, gen.sections.length > 0);
  check(p("live page parsed facts"), true, live.facts.length > 0);
  check(p("generated page parsed facts"), true, gen.facts.length > 0);

  /* ---- required equivalence: chrome and SEO ---- */
  check(p("html lang"), live.meta.htmlLang, gen.meta.htmlLang);
  check(p("SEO title"), live.meta.title, gen.meta.title);
  check(p("meta description"), live.meta.description, gen.meta.description);
  check(p("canonical"), live.meta.canonical, gen.meta.canonical);
  check(p("canonical is the live URL"), `${SITE}/${pre}event-${slug}.html`, gen.meta.canonical);
  check(p("hreflang trio"), live.meta.hreflang, gen.meta.hreflang);
  check(p("og:locale"), live.meta.ogLocale, gen.meta.ogLocale);
  check(p("og:type"), live.meta.ogType, gen.meta.ogType);
  check(p("og:image extended fields (secure_url/type/width/height)"),
    live.meta.ogImageExtended, gen.meta.ogImageExtended);
  check(p("og:image"), live.meta.ogImage, gen.meta.ogImage);
  check(p("stylesheets"), live.refs.stylesheets, gen.refs.stylesheets);
  check(p("active nav marks Events"), live.refs.activeNav, gen.refs.activeNav);
  check(p("language-switcher destinations"), live.refs.switcher, gen.refs.switcher);
  check(p("Instagram embed script present"), live.refs.embedScript, gen.refs.embedScript);

  /* ---- required equivalence: hero ---- */
  check(p("hero eyebrow"), live.hero.eyebrow, gen.hero.eyebrow);
  check(p("hero lead"), live.hero.lead, gen.hero.lead);
  check(p("back-link href"), live.hero.backHref, gen.hero.backHref);
  check(p("back-link label"), live.hero.backLink, gen.hero.backLink);
  check(p("bottom back-link href"), live.refs.bottomBackHref, gen.refs.bottomBackHref);
  check(p("bottom back-link label"), live.refs.bottomBackLabel, gen.refs.bottomBackLabel);

  // The <h1> is an approved correction only for the Polish Christmas Dinner.
  if (corr.h1) {
    check(p("APPROVED: live h1 is the old value"), corr.h1[0], live.hero.h1);
    check(p("APPROVED: generated h1 is the translated value"), corr.h1[1], gen.hero.h1);
    check(p("APPROVED: translated h1 renders with correct word spacing"),
      corr.h1[1], gen.hero.h1Rendered);
  } else {
    check(p("h1"), live.hero.h1, gen.hero.h1);
    check(p("h1 .fancy span"), live.hero.h1Fancy, gen.hero.h1Fancy);
    // As rendered, so a missing space beside the inline .fancy span fails.
    check(p("h1 as rendered (word spacing around the .fancy span)"),
      live.hero.h1Rendered, gen.hero.h1Rendered);
  }

  // og:image:alt — approved localisation on the Polish pages that had English.
  if (corr.ogAlt) {
    check(p("APPROVED: live og:image:alt was English"), corr.ogAlt[0], live.meta.ogImageAlt);
    check(p("APPROVED: generated og:image:alt is Polish"), corr.ogAlt[1], gen.meta.ogImageAlt);
    check(p("APPROVED: generated og:image:alt actually changed"), false,
      gen.meta.ogImageAlt === live.meta.ogImageAlt);
  } else {
    check(p("og:image:alt"), live.meta.ogImageAlt, gen.meta.ogImageAlt);
  }

  /* ---- facts: labels equivalent, date/venue per correction table ---- */
  check(p("fact labels and order"), live.facts.map((f) => f.label), gen.facts.map((f) => f.label));
  check(p("fact variants (text vs logo strip)"), live.facts.map((f) => f.variant), gen.facts.map((f) => f.variant));
  check(p("co-organiser logos"), live.facts.flatMap((f) => f.logos || []), gen.facts.flatMap((f) => f.logos || []));

  const factVal = (parsed, i) => (parsed.facts[i] || {}).value;
  // index 0 = date, index 1 = venue on every standard event page
  if (corr.factsDate) {
    check(p("APPROVED: live date was month-only"), corr.factsDate[0], factVal(live, 0));
    check(p("APPROVED: generated date is the exact day"), corr.factsDate[1], factVal(gen, 0));
  } else {
    check(p("facts: date"), factVal(live, 0), factVal(gen, 0));
  }
  check(p("APPROVED: live venue"), corr.factsVenue[0], factVal(live, 1));
  check(p("APPROVED: generated venue"), corr.factsVenue[1], factVal(gen, 1));
  // Any fact beyond date and venue must be untouched.
  check(p("facts beyond date and venue"), live.facts.slice(2).map((f) => f.value),
    gen.facts.slice(2).map((f) => f.value));

  /* ---- ordered sections ---- */
  const liveTypes = live.sections.map((s) => s.type);
  const genTypes = gen.sections.map((s) => s.type);
  if (corr.sectionOrder) {
    check(p("APPROVED: live section order is the old one"), corr.sectionOrder[0], liveTypes);
    check(p("APPROVED: generated section order is the fixed structure"), corr.sectionOrder[1], genTypes);
  } else {
    check(p("section types and order"), liveTypes, genTypes);
  }

  if (corr.sectionStyles) {
    check(p("APPROVED: live page carried per-section spacing"), corr.sectionStyles[0],
      live.sections.map((s) => s.style));
    check(p("APPROVED: generated page carries none"), corr.sectionStyles[1],
      gen.sections.map((s) => s.style));
  } else {
    check(p("section inline styles"), live.sections.map((s) => s.style),
      gen.sections.map((s) => s.style));
  }

  /*
    Live section i is compared against generated section sectionMap[i], which is
    i itself unless the reordering above moved it. Without this, an approved
    reordering would take the whole page's content checks down with it: the
    loop skips any pair whose types disagree.
  */
  const at = (i) => (corr.sectionMap ? corr.sectionMap[i] : i);
  for (let i = 0; i < live.sections.length; i++) {
    const j = at(i);
    if (j === undefined || j >= gen.sections.length) continue;
    const L = live.sections[i], G = gen.sections[j];
    const q = (f) => p(`section ${i} (${L.type}): ${f}`);
    /*
      Sikorski's fourth block changed KIND, not content: a grid built to hold an
      embed became the embed itself. The one thing it carried is checked here,
      because the shape comparison below cannot run across two different kinds.
    */
    if (L.type === "gallery" && G.type === "instagram") {
      check(q("APPROVED: the in-grid embed became a social post, same permalink"),
        L.embedPermalink, G.permalink);
      /*
        Any PHOTOGRAPH this grid held is deliberately NOT waved through here.
        It has to turn up somewhere, and where it turned up is a content
        decision, not a consequence of the approved reordering. The gallery
        comparison above is what reports it.
      */
      continue;
    }
    if (L.type !== G.type) continue;
    if (L.type === "gallery") {
      if (corr.galleryTiles) {
        /*
          THE PHOTOGRAPH THAT MOVED, human-approved.

          The live page held one photograph in the grid beside its Instagram
          embed. The fixed structure has one gallery and one social region and
          no slot between them, so the photograph belongs in the gallery. Both
          lists are enumerated in full: the live four and the generated five.
          Anything else moving fails, in either direction.
        */
        check(q("APPROVED: live gallery held four photographs"),
          corr.galleryTiles[0].srcs, L.tiles.map((t) => t.src));
        check(q("APPROVED: generated gallery also holds the absorbed one"),
          corr.galleryTiles[1].srcs, G.tiles.map((t) => t.src));
        check(q("APPROVED: live descriptions"),
          corr.galleryTiles[0].alts, L.tiles.map((t) => t.alt));
        check(q("APPROVED: generated descriptions, in this language"),
          corr.galleryTiles[1].alts, G.tiles.map((t) => t.alt));
        check(q("APPROVED: live widths"),
          corr.galleryTiles[0].wide, L.tiles.map((t) => t.wide));
        check(q("APPROVED: generated widths — the absorbed photograph is not wide"),
          corr.galleryTiles[1].wide, G.tiles.map((t) => t.wide));
      } else {
        check(q("tile srcs and order"), L.tiles.map((t) => t.src), G.tiles.map((t) => t.src));
        check(q("tile alt text"), L.tiles.map((t) => t.alt), G.tiles.map((t) => t.alt));
        check(q("tile wide flags"), L.tiles.map((t) => t.wide), G.tiles.map((t) => t.wide));
      }
      check(q("instagram inside grid"), L.instagramInGrid, G.instagramInGrid);
      check(q("in-grid embed permalink"), L.embedPermalink, G.embedPermalink);
    } else if (L.type === "prose") {
      check(q("paragraph text and order"), L.paragraphs, G.paragraphs);
      check(q("blockquote text"), L.blockquotes, G.blockquotes);
      check(q("blockquote has no nested <p>"), L.blockquoteHasNestedP, G.blockquoteHasNestedP);
      check(q("links: href, target, rel, label"), L.links, G.links);
      check(q("emphasis runs"), L.emphasis, G.emphasis);
    } else if (L.type === "heading") {
      check(q("eyebrow"), L.eyebrow, G.eyebrow);
      check(q("title"), L.title, G.title);
      check(q("title .fancy span"), L.titleFancy, G.titleFancy);
    } else if (L.type === "album") {
      check(q("heading"), L.heading, G.heading);
      check(q("body"), L.body, G.body);
      check(q("url / target / rel"), [L.url, L.target, L.rel], [G.url, G.target, G.rel]);
      check(q("button label"), L.label, G.label);
      check(q("camera glyph is aria-hidden"), L.camAriaHidden, G.camAriaHidden);
    } else if (L.type === "instagram") {
      check(q("permalink"), L.permalink, G.permalink);
    }
  }

  /*
    WHERE THE ABSORBED PHOTOGRAPH ENDED UP.

    Recording the approved move above is not enough on its own: it says the
    gallery grew by one, not that the photograph is in exactly one place, still
    described, and no longer sitting beside the social post. A photograph that
    were rendered twice would satisfy every list check above and still be wrong.
  */
  if (corr.absorbedPhoto) {
    const want = corr.absorbedPhoto;
    const inGalleries = gen.sections.filter((x) => x.type === "gallery")
      .flatMap((x) => x.tiles).filter((t) => t.src === want.src);
    check(p("APPROVED: the absorbed photograph is in the generated gallery"),
      1, inGalleries.length);
    check(p("APPROVED: it keeps its description in this language"),
      want.alt, inGalleries.length ? inGalleries[0].alt : null);
    check(p("APPROVED: it appears exactly once on the whole page"),
      1, gen.refs.allImages.filter((src) => src === want.src).length);
    check(p("APPROVED: no photograph is left beside the social post"),
      [], gen.sections.filter((x) => x.type === "instagram").flatMap((x) => x.tiles || []));
  }

  /* ---- images ---- */
  check(p("all image srcs and order"), live.refs.allImages, gen.refs.allImages);
  check(p("no /pl/assets/ path"), [], gen.refs.plAssetPaths);
  const missing = gen.refs.allImages.filter((i) => !fs.existsSync(path.join(ROOT, "dist", i)));
  check(p("every referenced image exists in dist/"), [], missing);

  /* ---- JSON-LD ---- */
  check(p("generated JSON-LD parses"), null, gen.jsonldParseError);
  // Every standard event now has a full date, so all eight pages carry a block.
  check(p("Event JSON-LD present"), true, Boolean(gen.jsonld));
  if (gen.jsonld) {
    const j = gen.jsonld;
    check(p("JSON-LD @type"), "Event", j["@type"]);
    // Added in Phase 13: the name was never compared against the live block, and
    // all four had drifted — three lost a word space, two lost their year.
    // The Polish Christmas Dinner name is an approved translation.
    if (corr.schemaName) {
      check(p("APPROVED: live JSON-LD name is the old value"), corr.schemaName[0], live.jsonld && live.jsonld.name);
      check(p("APPROVED: generated JSON-LD name is the translated value"), corr.schemaName[1], j.name);
    } else {
      check(p("JSON-LD name matches the live block"), live.jsonld && live.jsonld.name, j.name);
    }
    check(p("JSON-LD description matches the live block"),
      live.jsonld && live.jsonld.description, j.description);
    check(p("JSON-LD eventStatus"), "https://schema.org/EventScheduled", j.eventStatus);
    check(p("APPROVED: attendance mode emitted consistently"),
      "https://schema.org/OfflineEventAttendanceMode", j.eventAttendanceMode);
    check(p("JSON-LD startDate is a full ISO date"), true, /^\d{4}-\d{2}-\d{2}$/.test(String(j.startDate)));
    check(p("JSON-LD url matches canonical"), gen.meta.canonical, j.url);
    check(p("JSON-LD image matches og:image"), gen.meta.ogImage, assetKey(String(j.image).replace(/^https?:\/\/[^/]+/, "")));
    check(p("JSON-LD location is a structured Place"), ["Place", "PostalAddress"],
      [j.location && j.location["@type"], j.location && j.location.address && j.location.address["@type"]]);
    check(p("JSON-LD addressCountry"), "GB", j.location.address.addressCountry);
    check(p("JSON-LD organiser"), "Federation of Polish Student Societies UK", j.organizer && j.organizer.name);
    check(p("JSON-LD inLanguage"), localeCode === "pl" ? "pl-PL" : undefined, j.inLanguage);
    // The venue in JSON-LD must be the SAME canonical name the facts bar uses.
    const venueName = j.location.name;
    check(p("JSON-LD venue is the canonical name (no drift from the facts bar)"),
      true, String(factVal(gen, 1) || "").startsWith(venueName));
  }
  if (corr.factsDate) {
    check(p("APPROVED: live Icebreaker JSON-LD had a month-only startDate"),
      "2025-10", live.jsonld && live.jsonld.startDate);
  }

  const slice = results.slice(before);
  for (const r of slice) {
    if (r.ok) console.log(`  ok    ${r.label}${r.note ? `  (${r.note})` : ""}`);
    else {
      console.log(`  FAIL  ${r.label}`);
      console.log(`          expected: ${r.expected}`);
      console.log(`          actual:   ${r.actual}`);
    }
  }
  console.log(`  -- ${slice.filter((r) => r.ok).length}/${slice.length} matched`);
}

for (const slug of EVENTS) {
  for (const loc of ["en", "pl"]) comparePage(slug, loc);
}

/* -------------------------------------------- cross-language invariants */
console.log(`\n${"=".repeat(72)}\n  Cross-language invariant check (generated pages)\n${"=".repeat(72)}`);
{
  const before = results.length;
  for (const slug of EVENTS) {
    const en = parse(read(`dist/event-${slug}.html`));
    const pl = parse(read(`dist/pl/event-${slug}.html`));
    check(`${slug}: image sets identical across locales`, en.refs.allImages, pl.refs.allImages);
    check(`${slug}: section types identical across locales`,
      en.sections.map((s) => s.type), pl.sections.map((s) => s.type));
    check(`${slug}: JSON-LD dates identical across locales`,
      [en.jsonld && en.jsonld.startDate, en.jsonld && en.jsonld.endDate],
      [pl.jsonld && pl.jsonld.startDate, pl.jsonld && pl.jsonld.endDate]);
    check(`${slug}: Polish alt text is localised (differs from English)`, [],
      en.refs.allImages.length
        ? en.sections.flatMap((s, i) => (s.tiles || []).map((t, j) => {
            const p2 = (pl.sections[i] || {}).tiles || [];
            return p2[j] && p2[j].alt === t.alt ? t.alt : null;
          })).filter(Boolean)
        : []);
    check(`${slug}: Polish og:image:alt is not the English string`, false,
      en.meta.ogImageAlt === pl.meta.ogImageAlt && Boolean(en.meta.ogImageAlt));
  }
  for (const r of results.slice(before)) {
    if (r.ok) console.log(`  ok    ${r.label}`);
    else { console.log(`  FAIL  ${r.label}`); console.log(`          en: ${r.expected}`); console.log(`          pl: ${r.actual}`); }
  }
}

console.log(`\n${"=".repeat(72)}`);
if (failures === 0) console.log(`  PASS — ${results.length}/${results.length} comparisons matched`);
else console.log(`  FAIL — ${failures} of ${results.length} comparisons differ`);
console.log("=".repeat(72));
process.exit(failures === 0 ? 0 : 1);
