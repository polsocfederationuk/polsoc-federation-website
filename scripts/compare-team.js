#!/usr/bin/env node
/**
 * compare-team.js — semantic comparison of the live team pages against the
 * Eleventy-generated ones.
 *
 *   team.html      vs  dist/team.html
 *   pl/team.html   vs  dist/pl/team.html
 *
 * Companion to scripts/compare-chrome.js, which covers the shared header,
 * navigation, language switcher and footer. This script deliberately does NOT
 * re-check those regions; it checks the team page's own content.
 *
 * WHAT IS COMPARED
 *   page heading, eyebrow and lead copy
 *   filter labels and their order
 *   section headings, member counts and their order
 *   per member: name, role, photo path, alt text, e-mail, LinkedIn, aria-labels,
 *               link titles, reveal classes and position
 *   the null-photo placeholder (.ph, data-label, absence of <img>)
 *   stylesheet and script references
 *   SEO head metadata
 *
 * WHAT IS IGNORED (harmless, per the brief)
 *   indentation, line endings, whitespace between tags, HTML comments
 *   asset path DEPTH — the live pages use page-relative paths ("assets/…",
 *     "../assets/…"); the generated pages use root-relative ("/assets/…").
 *     Both resolve to the same file. This is the Phase 3 convention and exists
 *     because a page-relative path in shared markup silently breaks under /pl/
 *     — which shipped as a live bug once (docs/CLEANUP_BASELINE.md §5).
 *
 * Run:  node scripts/compare-team.js
 * Exit: 0 when every comparison matches, 1 otherwise.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Collapse insignificant whitespace and strip comments. */
const norm = (html) =>
  String(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();

/** Plain text: normalised, tags removed, entities resolved. */
const text = (html) =>
  norm(html)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();

/**
 * Reduce an asset reference to the part that identifies the file, discarding
 * how deep the referencing page sits. "../assets/team/x.jpg", "assets/team/x.jpg"
 * and "/assets/team/x.jpg" all become "assets/team/x.jpg".
 */
const assetKey = (p) => String(p).replace(/^(\.\.\/)+/, "").replace(/^\/+/, "");

// ---------------------------------------------------------------------------
// Extraction — one parser, used on both the live and the generated page
// ---------------------------------------------------------------------------

function parse(html) {
  const out = { meta: {}, hero: {}, filters: [], groups: [], refs: {} };

  const head = html.split("</head>")[0];
  const metaPatterns = {
    title: /<title>([\s\S]*?)<\/title>/,
    description: /<meta name="description" content="([\s\S]*?)">/,
    canonical: /<link rel="canonical" href="([\s\S]*?)">/,
    ogType: /<meta property="og:type" content="([\s\S]*?)">/,
    ogTitle: /<meta property="og:title" content="([\s\S]*?)">/,
    ogDescription: /<meta property="og:description" content="([\s\S]*?)">/,
    ogUrl: /<meta property="og:url" content="([\s\S]*?)">/,
    ogImage: /<meta property="og:image" content="([\s\S]*?)">/,
    ogImageAlt: /<meta property="og:image:alt" content="([\s\S]*?)">/,
    twitterCard: /<meta name="twitter:card" content="([\s\S]*?)">/,
    twitterTitle: /<meta name="twitter:title" content="([\s\S]*?)">/,
    twitterImage: /<meta name="twitter:image" content="([\s\S]*?)">/,
    twitterImageAlt: /<meta name="twitter:image:alt" content="([\s\S]*?)">/,
    htmlLang: /<html lang="([^"]*)"/,
  };
  for (const [key, re] of Object.entries(metaPatterns)) {
    const m = (key === "htmlLang" ? html : head).match(re);
    out.meta[key] = m ? text(m[1]) : null;
  }
  out.meta.hreflang = [...head.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)">/g)]
    .map((m) => `${m[1]}=${m[2]}`);

  // ---- hero -------------------------------------------------------------
  const hero = html.match(/<section class="page-hero hero-photo">([\s\S]*?)<\/section>/);
  if (hero) {
    const h = hero[1];
    const bg = h.match(/background-image: url\('([^']+)'\); background-position: ([^;"]+);/);
    out.hero.bgImage = bg ? assetKey(bg[1]) : null;
    out.hero.bgPosition = bg ? bg[2].trim() : null;
    const eyebrow = h.match(/<span class="eyebrow">([\s\S]*?)<\/span>/);
    out.hero.eyebrow = eyebrow ? text(eyebrow[1]) : null;
    const h1 = h.match(/<h1>([\s\S]*?)<\/h1>/);
    out.hero.h1 = h1 ? text(h1[1]) : null;
    const fancy = h1 && h1[1].match(/<span class="fancy">([\s\S]*?)<\/span>/);
    out.hero.h1Fancy = fancy ? text(fancy[1]) : null;
    const lead = h.match(/<p class="lead">([\s\S]*?)<\/p>/);
    out.hero.lead = lead ? text(lead[1]) : null;
  }

  // ---- filter chips -----------------------------------------------------
  //
  // The attribute-order-agnostic parsing below is deliberate. An earlier
  // version pinned `class` then `data-filter` then `>`; adding aria-pressed in
  // Phase 5 made it match nothing, and because BOTH sides parsed to an empty
  // list the filter comparisons still "passed". The `filters` non-empty guard
  // in comparePage() is what stops that class of false pass recurring.
  const bar = html.match(/<div class="filter-bar([^"]*)"([^>]*)>([\s\S]*?)<\/div>/);
  if (bar) {
    out.filterBarClass = ("filter-bar" + bar[1]).trim();
    const role = bar[2].match(/role="([^"]*)"/);
    const label = bar[2].match(/aria-label="([^"]*)"/);
    out.filterBarRole = role ? role[1] : null;
    out.filterBarLabel = label ? text(label[1]) : null;
    for (const m of bar[3].matchAll(/<(button|a|div|span)\s+([^>]*?)>([\s\S]*?)<\/\1>/g)) {
      const [, tag, attrs, label2] = m;
      if (!/class="[^"]*\bchip\b/.test(attrs)) continue;
      const attr = (n) => {
        const v = attrs.match(new RegExp(n + '="([^"]*)"'));
        return v ? v[1] : null;
      };
      out.filters.push({
        tag,                                   // must be a native <button>
        key: attr("data-filter"),
        active: /class="[^"]*\bactive\b/.test(attrs),
        pressed: attr("aria-pressed"),         // null if the attribute is absent
        ariaSelected: attr("aria-selected"),   // must stay null
        role: attr("role"),                    // must stay null (no role="tab")
        label: text(label2),
      });
    }
  }
  out.hasTablist = /role="tablist"/.test(html);
  out.hasRoleTab = /role="tab"/.test(html);

  // ---- sections and members --------------------------------------------
  const parts = html.split(/<div class="team-section" data-group="([a-z]+)">/);
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i];
    const seg = parts[i + 1].split("</section>")[0];

    const h2 = seg.match(/<h2 class="reveal">([\s\S]*?)<\/h2>/);
    const countSpan = h2 && h2[1].match(/<span class="count">([\s\S]*?)<\/span>/);
    const heading = h2 ? text(h2[1].replace(/<span class="count">[\s\S]*/, "")) : null;

    const members = [];
    const cardRe =
      /<div class="member([^"]*)">\s*<div class="ph"([^>]*)>([\s\S]*?)<\/div>\s*<div class="member-body">\s*<div class="member-role">([\s\S]*?)<\/div>\s*<h3>([\s\S]*?)<\/h3>([\s\S]*?)<\/div>\s*<\/div>/g;
    for (const m of seg.matchAll(cardRe)) {
      const [, reveal, phAttrs, phInner, role, name, links] = m;
      const img = phInner.match(/<img src="([^"]+)" alt="([^"]*)">/);
      const dataLabel = phAttrs.match(/data-label="([^"]*)"/);
      const mail = links.match(/href="mailto:([^"]+)" title="([^"]*)" aria-label="([^"]*)"/);
      const li = links.match(
        /href="(https:\/\/www\.linkedin\.com[^"]+)" title="([^"]*)" aria-label="([^"]*)" target="([^"]*)" rel="([^"]*)"/
      );
      members.push({
        reveal: ("member" + reveal).replace(/\s+/g, " ").trim(),
        photo: img ? assetKey(img[1]) : null,
        alt: img ? text(img[2]) : null,
        hasImgTag: Boolean(img),
        dataLabel: dataLabel ? text(dataLabel[1]) : null,
        role: text(role),
        name: text(name),
        email: mail ? mail[1] : null,
        emailTitle: mail ? text(mail[2]) : null,
        emailAria: mail ? text(mail[3]) : null,
        linkedin: li ? li[1] : null,
        linkedinTitle: li ? text(li[2]) : null,
        linkedinAria: li ? text(li[3]) : null,
        linkedinTarget: li ? li[4] : null,
        linkedinRel: li ? li[5] : null,
      });
    }
    out.groups.push({ key, heading, count: countSpan ? text(countSpan[1]) : null, members });
  }

  // ---- asset references -------------------------------------------------
  out.refs.stylesheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) =>
    assetKey(m[1])
  );
  out.refs.scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => assetKey(m[1]));
  out.refs.hasInlineScript = /<script>[\s\S]*?<\/script>/.test(html);
  out.refs.gridCount = (html.match(/class="team-grid"/g) || []).length;
  out.refs.activeNav = [...html.matchAll(/<a[^>]*class="([^"]*\bactive\b[^"]*)"[^>]*href="([^"]*)"/g)]
    .map((m) => m[2])
    .filter((h) => /team\.html$/.test(h)).length > 0;

  return out;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

const results = [];
let failures = 0;

function check(label, expected, actual, note) {
  const e = JSON.stringify(expected);
  const a = JSON.stringify(actual);
  const ok = e === a;
  if (!ok) failures++;
  results.push({ ok, label, expected: e, actual: a, note });
  return ok;
}

function comparePage(name, livePath, distPath, expectations) {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`  ${name}`);
  console.log(`  ${livePath}  ->  ${distPath}`);
  console.log("=".repeat(72));

  const before = results.length;
  const live = parse(read(livePath));
  const gen = parse(read(distPath));

  const p = (s) => `${name}: ${s}`;

  // --- hero copy ---
  check(p("hero background image"), live.hero.bgImage, gen.hero.bgImage);
  check(p("hero background position"), live.hero.bgPosition, gen.hero.bgPosition);
  check(p("hero eyebrow"), live.hero.eyebrow, gen.hero.eyebrow);
  check(p("hero h1 text"), live.hero.h1, gen.hero.h1);
  check(p("hero h1 .fancy span"), live.hero.h1Fancy, gen.hero.h1Fancy);
  check(p("hero lead copy"), live.hero.lead, gen.hero.lead);

  // --- filters ---
  // Guard first: an empty parse must never be able to "match" an empty parse.
  check(p("filter chips were parsed at all (live)"), 7, live.filters.length);
  check(p("filter chips were parsed at all (generated)"), 7, gen.filters.length);

  check(p("filter bar classes"), live.filterBarClass, gen.filterBarClass);
  check(p("filter bar role"), live.filterBarRole, gen.filterBarRole);
  check(p("filter bar aria-label"), live.filterBarLabel, gen.filterBarLabel);
  check(p("filter keys and order"), live.filters.map((f) => f.key), gen.filters.map((f) => f.key));
  check(p("filter labels and order"), live.filters.map((f) => f.label), gen.filters.map((f) => f.label));
  check(p("filter active state"), live.filters.map((f) => f.active), gen.filters.map((f) => f.active));
  check(p("filter pressed state"), live.filters.map((f) => f.pressed), gen.filters.map((f) => f.pressed));
  check(p("filter element types"), live.filters.map((f) => f.tag), gen.filters.map((f) => f.tag));

  // --- corrected filter semantics: absolute requirements, both sides --------
  for (const [side, parsed] of [["live", live], ["generated", gen]]) {
    check(p(`${side}: no role="tablist" anywhere`), false, parsed.hasTablist);
    check(p(`${side}: no role="tab" anywhere`), false, parsed.hasRoleTab);
    check(p(`${side}: filter container is role="group"`), "group", parsed.filterBarRole);
    check(p(`${side}: filter group has a non-empty aria-label`), true,
      Boolean(parsed.filterBarLabel && parsed.filterBarLabel.trim()));
    check(p(`${side}: every filter is a native <button>`), ["button"],
      [...new Set(parsed.filters.map((f) => f.tag))]);
    check(p(`${side}: no filter carries role=`), [null],
      [...new Set(parsed.filters.map((f) => f.role))]);
    check(p(`${side}: no filter carries aria-selected`), [null],
      [...new Set(parsed.filters.map((f) => f.ariaSelected))]);
    check(p(`${side}: every filter carries aria-pressed`), [],
      parsed.filters.filter((f) => f.pressed === null).map((f) => f.key));
    check(p(`${side}: exactly one filter starts pressed`), ["all"],
      parsed.filters.filter((f) => f.pressed === "true").map((f) => f.key));
    check(p(`${side}: every other filter starts unpressed`), [],
      parsed.filters.filter((f) => f.key !== "all" && f.pressed !== "false").map((f) => f.key));
    // The pressed state and the visual state must agree in the served markup.
    check(p(`${side}: pressed state matches the .active class`), [],
      parsed.filters.filter((f) => f.active !== (f.pressed === "true")).map((f) => f.key));
  }

  // --- sections ---
  check(p("section keys and order"), live.groups.map((g) => g.key), gen.groups.map((g) => g.key));
  check(p("section headings"), live.groups.map((g) => g.heading), gen.groups.map((g) => g.heading));
  check(p("section member counts"), live.groups.map((g) => g.count), gen.groups.map((g) => g.count));
  check(
    p("members per section"),
    live.groups.map((g) => g.members.length),
    gen.groups.map((g) => g.members.length)
  );
  check(
    p("total member count"),
    live.groups.reduce((n, g) => n + g.members.length, 0),
    gen.groups.reduce((n, g) => n + g.members.length, 0)
  );

  // --- per-member, field by field ---
  const flat = (parsed) => parsed.groups.flatMap((g) => g.members.map((m) => ({ ...m, group: g.key })));
  const liveM = flat(live);
  const genM = flat(gen);

  const FIELDS = [
    "group", "name", "role", "photo", "alt", "hasImgTag", "dataLabel",
    "email", "emailTitle", "emailAria",
    "linkedin", "linkedinTitle", "linkedinAria", "linkedinTarget", "linkedinRel",
    "reveal",
  ];
  for (const f of FIELDS) {
    check(p(`member field: ${f} (all ${liveM.length}, in order)`), liveM.map((m) => m[f]), genM.map((m) => m[f]));
  }

  // --- contact-link accessible names: absolute, both sides -----------------
  //
  // Parity alone is not enough here: two identically-wrong pages would agree.
  // Each label is rebuilt from the locale's pattern and the member's own name
  // and compared to what the page actually serves.
  for (const [side, members] of [["live", liveM], ["generated", genM]]) {
    const wantEmail = members.map((m) => expectations.aria.email.replace("{name}", m.name));
    const wantLinkedIn = members.map((m) => expectations.aria.linkedin.replace("{name}", m.name));
    check(p(`${side}: e-mail accessible names follow "${expectations.aria.email}"`),
      wantEmail, members.map((m) => m.emailAria));
    check(p(`${side}: LinkedIn accessible names follow "${expectations.aria.linkedin}"`),
      wantLinkedIn, members.map((m) => m.linkedinAria));

    // No link may be nameless, and no accessible name may be a bare address.
    check(p(`${side}: every contact link has a non-empty accessible name`), [],
      members.filter((m) => !m.emailAria || !m.emailAria.trim() || !m.linkedinAria || !m.linkedinAria.trim())
        .map((m) => m.name));
    check(p(`${side}: no accessible name exposes a raw e-mail address`), [],
      members.filter((m) => /@/.test(m.emailAria) || /@/.test(m.linkedinAria)).map((m) => m.name));

    // Two links sharing an accessible name is exactly the ambiguity Phase 5
    // removed by switching from stored first names to the full name.
    const names = [...members.map((m) => m.emailAria), ...members.map((m) => m.linkedinAria)];
    check(p(`${side}: all ${names.length} contact-link names are unique on the page`),
      names.length, new Set(names).size);

    // The Polish page must not fall back to the English patterns.
    if (expectations.forbiddenAria) {
      check(p(`${side}: no English label pattern survives on the Polish page`), [],
        members.filter((m) => expectations.forbiddenAria.some(
          (re) => re.test(m.emailAria) || re.test(m.linkedinAria))).map((m) => m.name));
    }
  }

  // --- null-photo member ---
  const liveNull = liveM.filter((m) => !m.hasImgTag);
  const genNull = genM.filter((m) => !m.hasImgTag);
  check(p("members without a photograph"), liveNull.map((m) => m.name), genNull.map((m) => m.name));
  check(p("null-photo data-label"), liveNull.map((m) => m.dataLabel), genNull.map((m) => m.dataLabel));
  check(p("null-photo carries no <img>"), liveNull.map(() => false), genNull.map((m) => m.hasImgTag));

  // --- structure and references ---
  check(p("team-grid count"), live.refs.gridCount, gen.refs.gridCount);
  check(p("stylesheet references"), live.refs.stylesheets, gen.refs.stylesheets);
  check(p("active nav points at team.html"), live.refs.activeNav, gen.refs.activeNav);

  // --- SEO head ---
  for (const key of Object.keys(live.meta)) {
    check(p(`head: ${key}`), live.meta[key], gen.meta[key]);
  }

  // --- known, intentional differences: asserted explicitly, not ignored ---
  check(
    p("KNOWN DIFF — filter script delivery"),
    expectations.scripts.live,
    live.refs.scripts,
    "live page: inline <script> after js/main.js"
  );
  check(
    p("KNOWN DIFF — filter script delivery"),
    expectations.scripts.gen,
    gen.refs.scripts,
    "generated page: shared js/team-filter.js instead of an inline copy"
  );

  const pageFailures = results.slice(before).filter((r) => !r.ok).length;
  for (const r of results.slice(before)) {
    if (r.ok) {
      console.log(`  ok    ${r.label}${r.note ? `  (${r.note})` : ""}`);
    } else {
      console.log(`  FAIL  ${r.label}`);
      console.log(`          live: ${r.expected}`);
      console.log(`          dist: ${r.actual}`);
    }
  }
  console.log(`  -- ${results.length - before - pageFailures}/${results.length - before} matched`);
}

// The accessible-name patterns each page must serve. These mirror
// src/_data/ui.json — the generated side reads them from there, so stating them
// independently here is what makes this a real check rather than a tautology.
comparePage("English", "team.html", "dist/team.html", {
  scripts: { live: ["js/main.js"], gen: ["js/main.js", "js/team-filter.js"] },
  aria: { email: "Email {name}", linkedin: "{name} on LinkedIn" },
});
comparePage("Polish", "pl/team.html", "dist/pl/team.html", {
  scripts: { live: ["js/main.js"], gen: ["js/main.js", "js/team-filter.js"] },
  aria: { email: "Wyślij e-mail do: {name}", linkedin: "Profil LinkedIn: {name}" },
  forbiddenAria: [/^Email /, / on LinkedIn$/],
});

// ---------------------------------------------------------------------------
// Cross-language invariants — the brief requires reporting, not silent choosing
// ---------------------------------------------------------------------------
console.log(`\n${"=".repeat(72)}`);
console.log("  Cross-language invariant check (generated pages)");
console.log("=".repeat(72));

{
  const en = parse(read("dist/team.html"));
  const pl = parse(read("dist/pl/team.html"));
  const flat = (x) => x.groups.flatMap((g) => g.members.map((m) => ({ ...m, group: g.key })));
  const a = flat(en);
  const b = flat(pl);

  for (const f of ["group", "name", "photo", "email", "linkedin", "reveal", "hasImgTag"]) {
    check(`Invariant identical in EN and PL: ${f}`, a.map((m) => m[f]), b.map((m) => m[f]));
  }
  // Roles MUST differ — a Polish page showing English roles would mean the
  // localised lookup silently fell back.
  const sameRole = a.filter((m, i) => m.role === b[i].role).map((m) => m.name);
  check("Roles differ between EN and PL for every member", [], sameRole);

  for (const r of results.slice(-8)) {
    if (r.ok) console.log(`  ok    ${r.label}`);
    else {
      console.log(`  FAIL  ${r.label}`);
      console.log(`          en: ${r.expected}`);
      console.log(`          pl: ${r.actual}`);
    }
  }
}

console.log(`\n${"=".repeat(72)}`);
if (failures === 0) {
  console.log(`  PASS — ${results.length}/${results.length} comparisons matched`);
} else {
  console.log(`  FAIL — ${failures} of ${results.length} comparisons differ`);
}
console.log("=".repeat(72));

process.exit(failures === 0 ? 0 : 1);
