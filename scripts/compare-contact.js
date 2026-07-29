#!/usr/bin/env node
/**
 * compare-contact.js — semantic comparison of the live contact pages against
 * the Eleventy-generated ones.
 *
 *   contact.html     vs  dist/contact.html
 *   pl/contact.html  vs  dist/pl/contact.html
 *
 * Companion to compare-chrome.js, compare-team.js, compare-announcements.js and
 * compare-members.js.
 *
 * WHAT IS COMPARED
 *   SEO head metadata, including the extended Open Graph image fields
 *   hero eyebrow, heading and lead
 *   the "Write to us" card: headings, e-mail destination and label, the copy
 *     button and its payload, the correspondence-address wording and every
 *     address line in order
 *   the "Follow us" card: destinations, labels, handles, target/rel
 *   the initiatives: count, logos, titles, notes, and every sub-link's
 *     destination, label and external behaviour
 *   the CTA band
 *   the classes the responsive CSS depends on
 *   stylesheet and script references
 *
 * WHAT IS IGNORED (harmless)
 *   whitespace, indentation, comments, line endings, attribute order
 *   asset path DEPTH — the live Polish page uses "../assets/…"; the generated
 *     pages use "/assets/…". Same file, and the root-relative form is what
 *     stops /pl/ resolving its own assets directory.
 *
 * Run:  node scripts/compare-contact.js
 * Exit: 0 when every comparison matches, 1 otherwise.
 */

"use strict";

const fs = require("fs");
const path = require("path");

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

const assetKey = (p) => String(p).replace(/^(\.\.\/)+/, "").replace(/^\/+/, "");

const attrOf = (attrs, name) => {
  const m = String(attrs).match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : null;
};

/* --------------------------------------------------------------- extraction */

function parse(html) {
  const out = { meta: {}, hero: {}, write: {}, social: [], initiatives: [], cta: {}, refs: {} };

  const head = html.split("</head>")[0];
  const pat = {
    title: /<title>([\s\S]*?)<\/title>/,
    description: /<meta name="description" content="([\s\S]*?)">/,
    canonical: /<link rel="canonical" href="([\s\S]*?)">/,
    ogType: /<meta property="og:type" content="([\s\S]*?)">/,
    ogUrl: /<meta property="og:url" content="([\s\S]*?)">/,
    ogImage: /<meta property="og:image" content="([\s\S]*?)">/,
    ogImageAlt: /<meta property="og:image:alt" content="([\s\S]*?)">/,
    ogImageWidth: /<meta property="og:image:width" content="([\s\S]*?)">/,
    ogImageHeight: /<meta property="og:image:height" content="([\s\S]*?)">/,
    ogImageType: /<meta property="og:image:type" content="([\s\S]*?)">/,
    ogImageSecureUrl: /<meta property="og:image:secure_url" content="([\s\S]*?)">/,
    ogLocale: /<meta property="og:locale" content="([\s\S]*?)">/,
    twitterCard: /<meta name="twitter:card" content="([\s\S]*?)">/,
    twitterImage: /<meta name="twitter:image" content="([\s\S]*?)">/,
  };
  for (const [k, re] of Object.entries(pat)) {
    const m = head.match(re);
    out.meta[k] = m ? text(m[1]) : null;
  }
  out.meta.htmlLang = (html.match(/<html lang="([^"]*)"/) || [])[1] || null;
  out.meta.hreflang = [...head.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)">/g)]
    .map((m) => `${m[1]}=${m[2]}`).sort();

  // ---- hero ----
  const hero = html.match(/<section class="page-hero">([\s\S]*?)<\/section>/);
  if (hero) {
    const g = (re) => { const m = hero[1].match(re); return m ? text(m[1]) : null; };
    out.hero.eyebrow = g(/<span class="eyebrow">([\s\S]*?)<\/span>/);
    out.hero.h1 = g(/<h1>([\s\S]*?)<\/h1>/);
    out.hero.h1Fancy = g(/<h1>[\s\S]*?<span class="fancy">([\s\S]*?)<\/span>/);
    out.hero.lead = g(/<p class="lead">([\s\S]*?)<\/p>/);
  }

  // ---- contact cards ----
  const grid = html.match(/<div class="contact-grid">([\s\S]*?)<!--|<div class="contact-grid">([\s\S]*?)<div class="sub-head/);
  const gridInner = grid ? (grid[1] || grid[2]) : "";
  out.refs.contactGridPresent = /<div class="contact-grid">/.test(html);
  out.refs.contactCardClasses = [...html.matchAll(/<div class="(contact-card[^"]*)">/g)].map((m) => m[1]);
  out.refs.socialListPresent = /<ul class="social-list">/.test(html);

  // "Write to us" card
  const cards = [...gridInner.matchAll(/<div class="contact-card[^"]*">([\s\S]*?)<\/div>\s*(?=<div class="contact-card|$)/g)]
    .map((m) => m[1]);
  // Defaults matter: if the structure breaks (a renamed wrapper, a removed
  // <address>), these stay empty arrays so the mismatch is REPORTED rather than
  // throwing and taking the whole comparison down with it.
  out.write.strongLabels = [];
  out.write.addressLines = [];
  const writeCard = gridInner.match(/<address>([\s\S]*?)<\/address>/);
  const h3s = [...gridInner.matchAll(/<h3>([\s\S]*?)<\/h3>/g)].map((m) => text(m[1]));
  out.write.heading = h3s[0] || null;
  out.write.followHeading = h3s[1] || null;
  out.write.h3IconsAriaHidden = (gridInner.match(/<span class="h3-icon" aria-hidden="true">/g) || []).length;
  if (writeCard) {
    const a = writeCard[1];
    const mail = a.match(/<a href="mailto:([^"]+)">([\s\S]*?)<\/a>/);
    out.write.emailHref = mail ? mail[1] : null;
    out.write.emailLabel = mail ? text(mail[2]) : null;
    const btn = a.match(/<button class="copy-btn"([^>]*)>([\s\S]*?)<\/button>/);
    out.write.copyButtonType = btn ? attrOf(btn[1], "type") : null;
    out.write.copyButtonPayload = btn ? attrOf(btn[1], "data-copy") : null;
    out.write.copyButtonLabel = btn ? text(btn[2]) : null;
    out.write.strongLabels = [...a.matchAll(/<strong>([\s\S]*?)<\/strong>/g)].map((m) => text(m[1]));
    // Every visible line of the address block, in order — the wording that says
    // "Correspondence address" and the lines under it.
    out.write.addressLines = decode(
      a.replace(/<button[\s\S]*?<\/button>/g, "|")
        .replace(/<br\s*\/?>/g, "\n")
        .replace(/<[^>]+>/g, "")
    ).split("\n").map((l) => l.trim()).filter((l) => l && l !== "|");
  }

  // ---- social list ----
  for (const m of html.matchAll(/<li><a href="([^"]+)"([^>]*)>([\s\S]*?)<\/a><\/li>/g)) {
    const inner = m[3];
    const handle = inner.match(/<span class="handle">([\s\S]*?)<\/span>/);
    out.social.push({
      url: m[1],
      target: attrOf(m[2], "target"),
      rel: attrOf(m[2], "rel"),
      label: text(inner.replace(/<span class="handle">[\s\S]*?<\/span>/, "")),
      handle: handle ? text(handle[1]) : null,
      hasSvg: /<svg/.test(inner),
    });
  }

  // ---- initiatives ----
  const subGrid = html.match(/<div class="sub-grid">([\s\S]*?)<\/section>/);
  if (subGrid) {
    const head2 = html.match(/<div class="sub-head reveal">\s*<h2>([\s\S]*?)<\/h2>/);
    out.initiativesHeading = head2 ? text(head2[1]) : null;
    out.refs.ruleAriaHidden = /<span class="rule" aria-hidden="true"><\/span>/.test(html);
    for (const m of subGrid[1].matchAll(
      /<div class="(sub-card[^"]*)">\s*<img class="sub-logo" src="([^"]+)" alt="([^"]*)">\s*<h3>([\s\S]*?)<\/h3>\s*<p class="sub-note">([\s\S]*?)<\/p>\s*<div class="sub-links">([\s\S]*?)<\/div>/g
    )) {
      out.initiatives.push({
        cardClass: m[1],
        logo: assetKey(m[2]),
        logoAlt: text(m[3]),
        title: text(m[4]),
        note: text(m[5]),
        links: [...m[6].matchAll(/<a href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g)].map((a) => ({
          url: a[1],
          target: attrOf(a[2], "target"),
          rel: attrOf(a[2], "rel"),
          label: text(a[3]),
          hasSvg: /<svg/.test(a[3]),
        })),
      });
    }
  }

  // ---- CTA band ----
  const cta = html.match(/<div class="cta-band reveal">([\s\S]*?)<\/div>/);
  if (cta) {
    const g = (re) => { const m = cta[1].match(re); return m ? text(m[1]) : null; };
    out.cta.h2 = g(/<h2>([\s\S]*?)<\/h2>/);
    out.cta.p = g(/<p>([\s\S]*?)<\/p>/);
    const btn = cta[1].match(/<a class="btn btn-light" href="([^"]+)">([\s\S]*?)<\/a>/);
    out.cta.href = btn ? btn[1] : null;
    out.cta.label = btn ? text(btn[2]) : null;
  }

  // ---- references ----
  out.refs.stylesheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => assetKey(m[1]));
  out.refs.scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => assetKey(m[1]));
  out.refs.hasInlineScript = /<script>[\s\S]*?<\/script>/.test(html);
  out.refs.activeNav =
    /<a[^>]*class="[^"]*\bactive\b[^"]*"[^>]*href="contact\.html"|<a[^>]*href="contact\.html"[^>]*class="[^"]*\bactive\b[^"]*"/.test(html);
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

function comparePage(name, livePath, genPath, expectations) {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`  ${name}`);
  console.log(`  ${livePath}  ->  ${genPath}`);
  console.log("=".repeat(72));

  const before = results.length;
  const p = (s) => `${name}: ${s}`;
  const live = parse(read(livePath));
  const gen = parse(read(genPath));

  // FAIL LOUDLY on an empty parse.
  check(p("live page parsed contact content"), true,
    live.social.length > 0 && live.initiatives.length > 0 && Boolean(live.write.emailHref));
  check(p("generated page parsed contact content"), true,
    gen.social.length > 0 && gen.initiatives.length > 0 && Boolean(gen.write.emailHref));

  for (const k of Object.keys(live.meta)) check(p(`head: ${k}`), live.meta[k], gen.meta[k]);
  for (const k of Object.keys(live.hero)) check(p(`hero: ${k}`), live.hero[k], gen.hero[k]);
  for (const k of Object.keys(live.write)) check(p(`write-to-us: ${k}`), live.write[k], gen.write[k]);

  // The correspondence-address wording, asserted absolutely as well as by
  // parity — two identically-reworded pages would otherwise agree.
  check(p("address description wording (live)"), expectations.addressLabel,
    (live.write.strongLabels || [])[1] || null);
  check(p("address description wording (generated)"), expectations.addressLabel,
    (gen.write.strongLabels || [])[1] || null);
  check(p("address lines, in order"), expectations.addressLines, gen.write.addressLines);

  check(p("social link count"), live.social.length, gen.social.length);
  check(p("social destinations"), live.social.map((s) => s.url), gen.social.map((s) => s.url));
  check(p("social labels"), live.social.map((s) => s.label), gen.social.map((s) => s.label));
  check(p("social handles"), live.social.map((s) => s.handle), gen.social.map((s) => s.handle));
  check(p("social target/rel"), live.social.map((s) => `${s.target}|${s.rel}`),
    gen.social.map((s) => `${s.target}|${s.rel}`));
  check(p("social icons present"), live.social.map((s) => s.hasSvg), gen.social.map((s) => s.hasSvg));

  check(p("initiatives heading"), live.initiativesHeading, gen.initiativesHeading);
  check(p("initiative count"), live.initiatives.length, gen.initiatives.length);
  for (const f of ["cardClass", "logo", "logoAlt", "title", "note"]) {
    check(p(`initiative field: ${f}`), live.initiatives.map((i) => i[f]), gen.initiatives.map((i) => i[f]));
  }
  check(p("initiative link destinations"),
    live.initiatives.map((i) => i.links.map((l) => l.url)),
    gen.initiatives.map((i) => i.links.map((l) => l.url)));
  check(p("initiative link labels"),
    live.initiatives.map((i) => i.links.map((l) => l.label)),
    gen.initiatives.map((i) => i.links.map((l) => l.label)));
  check(p("initiative link external behaviour"),
    live.initiatives.map((i) => i.links.map((l) => `${l.target}|${l.rel}`)),
    gen.initiatives.map((i) => i.links.map((l) => `${l.target}|${l.rel}`)));
  check(p("initiative link icons present"),
    live.initiatives.map((i) => i.links.map((l) => l.hasSvg)),
    gen.initiatives.map((i) => i.links.map((l) => l.hasSvg)));

  for (const k of Object.keys(live.cta)) check(p(`cta: ${k}`), live.cta[k], gen.cta[k]);

  // Classes the responsive CSS keys off. Losing one reintroduces the mobile
  // overflow that was fixed earlier — see STATIC_PAGES_MIGRATION §6.
  check(p("RESPONSIVE: .contact-grid wrapper present"), true, gen.refs.contactGridPresent);
  check(p("RESPONSIVE: contact-card classes"), live.refs.contactCardClasses, gen.refs.contactCardClasses);
  check(p("RESPONSIVE: .social-list present"), true, gen.refs.socialListPresent);
  check(p("RESPONSIVE: sub-card classes"), live.initiatives.map((i) => i.cardClass),
    gen.initiatives.map((i) => i.cardClass));

  check(p("h3 icons are aria-hidden"), live.write.h3IconsAriaHidden, gen.write.h3IconsAriaHidden);
  check(p("decorative rule is aria-hidden"), live.refs.ruleAriaHidden, gen.refs.ruleAriaHidden);
  check(p("stylesheet references"), live.refs.stylesheets, gen.refs.stylesheets);
  check(p("active nav marks Contact"), live.refs.activeNav, gen.refs.activeNav);
  check(p("language-switcher destinations"), live.refs.switcher, gen.refs.switcher);
  check(p("script references"), live.refs.scripts, gen.refs.scripts);
  check(p("neither page needs an inline script"), live.refs.hasInlineScript, gen.refs.hasInlineScript);

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

comparePage("English", "contact.html", "dist/contact.html", {
  addressLabel: "Correspondence address",
  addressLines: ["General enquiries", "contact@polsocfederation.pl", "Correspondence address",
    "Federation of Polish Student Societies in the UK", "238-246 King St", "London W6 0RF", "United Kingdom"],
});

comparePage("Polish", "pl/contact.html", "dist/pl/contact.html", {
  addressLabel: "Adres korespondencyjny",
  addressLines: ["Zapytania ogólne", "contact@polsocfederation.pl", "Adres korespondencyjny",
    "Federacja Polskich Stowarzyszeń Studenckich w Wielkiej Brytanii", "238-246 King St",
    "London W6 0RF", "Wielka Brytania"],
});

/* ---------------------------------------------- cross-language invariants */
console.log(`\n${"=".repeat(72)}`);
console.log("  Cross-language invariant check (generated pages)");
console.log("=".repeat(72));
{
  const en = parse(read("dist/contact.html"));
  const pl = parse(read("dist/pl/contact.html"));
  const before = results.length;

  check("E-mail destination identical in both locales", en.write.emailHref, pl.write.emailHref);
  check("Social destinations identical", en.social.map((s) => s.url), pl.social.map((s) => s.url));
  check("Social handles identical", en.social.map((s) => s.handle), pl.social.map((s) => s.handle));
  check("Initiative destinations identical",
    en.initiatives.map((i) => i.links.map((l) => l.url)),
    pl.initiatives.map((i) => i.links.map((l) => l.url)));
  check("Initiative logos identical", en.initiatives.map((i) => i.logo), pl.initiatives.map((i) => i.logo));
  const streetOf = (parsed) => (parsed.write.addressLines || []).filter((l) => /King St|W6 0RF/.test(l));
  check("Street address lines identical", streetOf(en), streetOf(pl));
  // Headings must be translated — identical ones would mean a lookup fell back.
  check("Hero lead is translated", [], en.hero.lead === pl.hero.lead ? [en.hero.lead] : []);
  const addrLabel = (parsed) => (parsed.write.strongLabels || [])[1] || null;
  check("Address description is translated", [],
    addrLabel(en) !== null && addrLabel(en) === addrLabel(pl) ? [addrLabel(en)] : []);
  // No generated asset may resolve under /pl/.
  check("No generated logo resolves under pl/", [],
    pl.initiatives.map((i) => i.logo).filter((l) => /^pl\//.test(l)));

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
