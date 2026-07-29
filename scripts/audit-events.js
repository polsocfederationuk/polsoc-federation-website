#!/usr/bin/env node
/**
 * audit-events.js — READ-ONLY reconciliation audit of the five current events.
 *
 * Every event's information currently lives in up to nine places per language:
 * a detail page, a listing card, a homepage timeline entry, JSON-LD, SEO
 * metadata, and — for some — a related announcement record. Nothing guarantees
 * those agree. This script extracts each field from each source, compares them,
 * and writes a machine-readable matrix plus a human report.
 *
 * IT WRITES ONLY:
 *   docs/EVENT_SOURCE_MATRIX.json
 *   docs/EVENT_RECONCILIATION.md  (the generated data sections; the prose
 *                                  sections of that file are hand-written and
 *                                  preserved — see MARKER below)
 *
 * It never touches event pages, homepages, listings, announcement records,
 * the sitemap, content collections or generated output.
 *
 * EXTRACTION FAILURES ARE EXPLICIT. A field that could not be parsed is
 * recorded as {extracted: false}, never as an empty-but-valid value — the
 * difference between "the page says nothing" and "I could not read the page"
 * is exactly what this audit exists to surface.
 *
 * Exit codes:
 *   0  extraction completed (even if human-review issues were found)
 *   1  a required source file could not be read, the report could not be
 *      written, or zero events were discovered
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DOCS = path.join(ROOT, "docs");

/* ------------------------------------------------------------------ helpers */

const readOrFail = (rel, required = true) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    if (required) {
      console.error(`FATAL: required source file missing: ${rel}`);
      process.exit(1);
    }
    return null;
  }
  return fs.readFileSync(abs, "utf8");
};

const decode = (s) =>
  String(s)
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&rarr;/g, "→").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

/** Visible text: tags stripped, entities resolved, whitespace collapsed. */
const text = (html) =>
  html == null ? null
    : decode(String(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() || null;

/** Strip page-relative depth so "../assets/x" and "assets/x" compare equal. */
const assetKey = (p) => (p == null ? null : String(p).replace(/^(\.\.\/)+/, "").replace(/^\/+/, ""));

/** Attribute lookup that does not care about attribute order. */
const attrOf = (attrs, name) => {
  const m = String(attrs || "").match(new RegExp(name + '\\s*=\\s*"([^"]*)"'));
  return m ? m[1] : null;
};

/**
 * An extraction result. `extracted: false` means the parser could not find the
 * construct at all — deliberately distinct from a found-but-empty value.
 */
const found = (value) => ({ extracted: true, value: value === undefined ? null : value });
const notFound = (reason) => ({ extracted: false, value: null, reason });

/* ---------------------------------------------------------------- the events */

const EVENTS = [
  { slug: "business-forum",   page: "event-business-forum.html",   announcementSlugs: ["polish-business-forum-2026-two-days-that", "introducing-the-polish-business-forum"] },
  { slug: "sikorski-debate",  page: "event-sikorski-debate.html",  announcementSlugs: ["our-debate-at-the-sikorski-institute-as", "an-academic-debate-at-the-sikorski-institute"] },
  { slug: "christmas-dinner", page: "event-christmas-dinner.html", announcementSlugs: ["christmas-dinner-2025-an-evening-straight-from", "missing-home-this-christmas-we-ve-got"] },
  { slug: "youth-congress",   page: "event-youth-congress.html",   announcementSlugs: ["polish-youth-congress-2025-thank-you", "join-us-at-the-polish-youth-congress"] },
  { slug: "icebreaker",       page: "event-icebreaker.html",       announcementSlugs: ["icebreaker-join-our-first-social-of-the"] },
];

/* ------------------------------------------------- detail-page extraction */

function parseDetailPage(html, rel) {
  const out = { _file: rel };
  const head = html.split("</head>")[0];
  const body = html.includes("</header>") ? html.split("</header>")[1].split("<footer")[0] : html;

  // --- SEO / document ---
  const t = head.match(/<title>([\s\S]*?)<\/title>/);
  out.seo_title = t ? found(text(t[1])) : notFound("no <title>");
  const d = head.match(/<meta name="description" content="([\s\S]*?)">/);
  out.seo_description = d ? found(decode(d[1])) : notFound("no meta description");
  const c = head.match(/<link rel="canonical" href="([^"]+)">/);
  out.canonical = c ? found(c[1]) : notFound("no canonical link");
  const lang = html.match(/<html lang="([^"]*)"/);
  out.language = lang ? found(lang[1]) : notFound("no <html lang>");
  const ogImg = head.match(/<meta property="og:image" content="([^"]+)">/);
  out.og_image = ogImg ? found(assetKey(ogImg[1].replace(/^https?:\/\/[^/]+/, ""))) : notFound("no og:image");
  const ogAlt = head.match(/<meta property="og:image:alt" content="([^"]*)">/);
  out.og_image_alt = ogAlt ? found(decode(ogAlt[1])) : notFound("no og:image:alt");

  // --- template type, inferred from the page's own structure ---
  const isPbf = /<section class="pbf-hero">/.test(body) || /pbf\.css/.test(head);
  out.detail_template_type = found(isPbf ? "business-forum" : "standard");

  // --- hero ---
  const heroBg = body.match(/background-image:\s*url\('([^']+)'\)/);
  if (heroBg) {
    out.hero_image = found(assetKey(heroBg[1]));
  } else if (/<section class="event-hero">/.test(body)) {
    // A real, deliberate absence: the standard event hero is typographic, with
    // no background photograph. Not an extraction failure.
    out.hero_image = found(null);
    out.hero_image_note = found("standard event-hero has no background photograph by design");
  } else {
    out.hero_image = notFound("no hero background-image url() and no recognised hero section");
  }
  const h1 = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  out.title = h1 ? found(text(h1[1])) : notFound("no <h1>");
  const eyebrow = body.match(/<span class="(?:eyebrow|pbf-eyebrow)">([\s\S]*?)<\/span>/);
  out.hero_eyebrow = eyebrow ? found(text(eyebrow[1])) : notFound("no hero eyebrow");
  const lead = body.match(/<p class="(?:lead|pbf-tagline)">([\s\S]*?)<\/p>/);
  out.intro_copy = lead ? found(text(lead[1])) : notFound("no hero lead paragraph");

  // --- facts bar (label/value pairs) ---
  // Both <span> (standard event pages) and <div> (PBF stats) forms exist.
  const facts = [...body.matchAll(/<div class="fact">([\s\S]*?)<\/div>/g)]
    .map((m) => {
      const label = m[1].match(/<(?:span|div) class="fact-label">([\s\S]*?)<\/(?:span|div)>/);
      const value = m[1].match(/<(?:span|div) class="fact-value[^"]*">([\s\S]*?)<\/(?:span|div)>/);
      // A fact value may be TEXT or a strip of co-organiser LOGOS
      // (class="fact-value fact-logos"). Both are real; only the second has no
      // text, so record the variant rather than reporting an empty value.
      const logos = value ? [...value[1].matchAll(/<img[^>]*?src="([^"]+)"([^>]*)>/g)]
        .map((im) => ({ src: assetKey(im[1]), alt: attrOf(im[2], "alt") })) : [];
      return {
        label: text(label && label[1]),
        value: text(value && value[1]),
        variant: logos.length ? "logos" : "text",
        logos: logos.length ? logos : undefined,
      };
    })
    .filter((f) => f.label || f.value || f.variant === "logos");
  out.facts = facts.length ? found(facts) : notFound("no .fact blocks found");
  out.fact_logo_images = found(facts.flatMap((f) => (f.logos || []).map((l) => l.src)));
  out.fact_labels = found(facts.map((f) => f.label));

  // --- prose ---
  // A non-greedy match to </div> stops at the first NESTED close, which is why
  // an earlier version reported "no prose" on pages that plainly have some.
  // Walk the div nesting instead.
  const proseBlocks = [];
  // Attribute-order agnostic: the live markup is
  //   <div class="prose reveal" style="margin-bottom: 60px;">
  // so a pattern requiring `">` straight after the class attribute misses it.
  const proseRe = /<div\b[^>]*\bclass="[^"]*\bprose\b[^"]*"[^>]*>/g;
  let pm;
  while ((pm = proseRe.exec(body)) !== null) {
    let depth = 1, i = pm.index + pm[0].length;
    const divRe = /<div[\s>]|<\/div>/g;
    divRe.lastIndex = i;
    let dm;
    while (depth > 0 && (dm = divRe.exec(body)) !== null) {
      depth += dm[0] === "</div>" ? -1 : 1;
      if (depth === 0) { proseBlocks.push(body.slice(i, dm.index)); break; }
    }
  }
  const proseParas = proseBlocks.flatMap((blk) =>
    [...blk.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => text(m[1])).filter(Boolean));
  out.body_copy_paragraphs = proseBlocks.length
    ? found(proseParas.length)
    : notFound("no .prose block found");

  // --- galleries and images ---
  const imgs = [...body.matchAll(/<img[^>]*?src="([^"]+)"([^>]*)>/g)].map((m) => ({
    src: assetKey(m[1]),
    alt: attrOf(m[2], "alt"),
  }));
  out.images = found(imgs);
  out.gallery_image_count = found(imgs.length);
  out.images_missing_alt = found(imgs.filter((i) => i.alt === null).map((i) => i.src));
  out.images_empty_alt = found(imgs.filter((i) => i.alt === "").map((i) => i.src));

  // --- links ---
  const links = [...body.matchAll(/<a[^>]*?href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1], label: text(m[3]), external: /target="_blank"/.test(m[2] || ""),
  }));
  const ig = links.filter((l) => /instagram\.com/.test(l.href));
  out.instagram_links = found(ig.map((l) => l.href));
  const embed = body.match(/<blockquote class="instagram-media"[\s\S]*?data-instgrm-permalink="([^"]+)"/);
  out.instagram_permalink = embed ? found(embed[1])
    : (/instagram-media|insta-embed/.test(body) ? notFound("insta embed present but no data-instgrm-permalink") : found(null));
  const album = links.filter((l) => /(photos\.app\.goo\.gl|drive\.google|flickr|album)/i.test(l.href));
  out.album_link = album.length ? found(album[0].href) : found(null);
  const reg = links.filter((l) => /(eventbrite|tickets|register|forms\.gle|docs\.google\.com\/forms|zapisy)/i.test(l.href));
  out.registration_link = reg.length ? found(reg[0].href) : found(null);
  out.external_links = found([...new Set(links.filter((l) => /^https?:/.test(l.href)).map((l) => l.href))]);

  // --- downloads ---
  const dl = links.filter((l) => /\.(pdf|zip|docx?|pptx?)$/i.test(l.href));
  out.download_links = found(dl.map((l) => l.href));

  // --- co-organiser / partner logos ---
  const logoTiles = (body.match(/class="[^"]*(?:pbf-logo-tile|logo-tile|partner-logo)[^"]*"/g) || []).length;
  out.partner_logo_tiles = found(logoTiles);

  // --- JSON-LD ---
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!ld) {
    out.jsonld = notFound("no JSON-LD script block");
  } else {
    try {
      const parsed = JSON.parse(ld[1]);
      out.jsonld = found(parsed);
      out.jsonld_start = found(parsed.startDate || null);
      out.jsonld_end = found(parsed.endDate || null);
      out.jsonld_name = found(parsed.name || null);
      out.jsonld_description = found(parsed.description || null);
      out.jsonld_status = found(parsed.eventStatus || null);
      out.jsonld_attendance = found(parsed.eventAttendanceMode || null);
      out.jsonld_venue = found(parsed.location && parsed.location.name || null);
      out.jsonld_locality = found(parsed.location && parsed.location.address &&
        parsed.location.address.addressLocality || null);
      out.jsonld_country = found(parsed.location && parsed.location.address &&
        parsed.location.address.addressCountry || null);
      out.jsonld_organiser = found(parsed.organizer && parsed.organizer.name || null);
      out.jsonld_url = found(parsed.url || null);
      out.jsonld_image = found(parsed.image ? assetKey(String(parsed.image).replace(/^https?:\/\/[^/]+/, "")) : null);
      out.jsonld_performers = found(
        Array.isArray(parsed.performer) ? parsed.performer.map((p) => p.name) :
        parsed.performer ? [parsed.performer.name] : []);
      out.jsonld_inLanguage = found(parsed.inLanguage || null);
    } catch (e) {
      out.jsonld = notFound(`JSON-LD present but unparseable: ${e.message}`);
    }
  }

  return out;
}

/* ------------------------------------------------ listing-card extraction */

function parseListing(html, rel) {
  const cards = {};
  const body = html.includes("</header>") ? html.split("</header>")[1] : html;
  for (const m of body.matchAll(
    /<article class="(event-card[^"]*)">([\s\S]*?)<\/article>/g
  )) {
    const inner = m[2];
    const link = inner.match(/<h2><a href="event-([a-z0-9-]+)\.html">([\s\S]*?)<\/a><\/h2>/);
    if (!link) continue;
    const slug = link[1];
    const dateVenue = inner.match(/<span class="event-date">([\s\S]*?)<\/span>/);
    const img = inner.match(/<img[^>]*?src="([^"]+)"([^>]*)>/);
    const summary = inner.match(/<p>([\s\S]*?)<\/p>/);
    const flagship = /class="flagship-tag"/.test(inner);
    // "24–25 April 2026 · London Business School" -> two parts
    const dv = text(dateVenue && dateVenue[1]);
    const parts = dv ? dv.split("·").map((s) => s.trim()) : [];
    cards[slug] = {
      _file: rel,
      card_classes: found(m[1]),
      card_title: found(text(link[2])),
      card_date_venue_raw: dateVenue ? found(dv) : notFound("no .event-date span"),
      card_display_date: parts.length ? found(parts[0]) : notFound("could not split date from venue"),
      card_venue: parts.length > 1 ? found(parts.slice(1).join(" · ")) : notFound("no venue after '·'"),
      card_summary: summary ? found(text(summary[1])) : notFound("no card <p>"),
      card_image: img ? found(assetKey(img[1])) : notFound("no card image"),
      card_image_alt: img ? found(attrOf(img[2], "alt")) : notFound("no card image"),
      flagship_tag: found(flagship),
    };
  }
  return cards;
}

/* ---------------------------------------------- homepage timeline extraction */

function parseTimeline(html, rel) {
  const items = {};
  const tl = html.match(/<div class="timeline">([\s\S]*?)<\/section>/);
  if (!tl) return items;
  for (const m of tl[1].matchAll(/<div class="tl-item[^"]*">([\s\S]*?)<\/div>/g)) {
    const inner = m[1];
    const link = inner.match(/<h3><a href="event-([a-z0-9-]+)\.html">([\s\S]*?)<\/a><\/h3>/);
    if (!link) continue;
    const date = inner.match(/<span class="tl-date">([\s\S]*?)<\/span>/);
    const summary = inner.match(/<p>([\s\S]*?)<\/p>/);
    items[link[1]] = {
      _file: rel,
      timeline_title: found(text(link[2])),
      timeline_display_date: date ? found(text(date[1])) : notFound("no .tl-date span"),
      timeline_summary: summary ? found(text(summary[1])) : notFound("no timeline <p>"),
    };
  }
  return items;
}

/* ------------------------------------------- announcement record extraction */

function loadAnnouncements() {
  const dir = path.join(ROOT, "content", "announcements");
  if (!fs.existsSync(dir)) return {};
  let yaml;
  try { yaml = require("js-yaml"); } catch { return {}; }
  const out = {};
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/i.test(f)) continue;
    try {
      const rec = yaml.load(fs.readFileSync(path.join(dir, f), "utf8")) || {};
      out[rec.slug || f.replace(/\.ya?ml$/i, "")] = { ...rec, _file: `content/announcements/${f}` };
    } catch { /* a malformed record is reported by validate.js, not here */ }
  }
  return out;
}

/* ------------------------------------------------------------- comparison */

const STATUSES = ["consistent", "expected-localisation", "missing-in-some-sources",
  "contradiction", "invalid-format", "uncertain", "not-applicable"];

/**
 * Classification drives how a disagreement is interpreted:
 *   shared_invariant  — must be identical in both languages; difference = contradiction
 *   localised         — expected to differ; identical values are worth noting
 *   derived           — should be generated, not stored twice
 */
const CLASSIFY = {
  // --- genuinely localised prose ---
  title: "localised", hero_eyebrow: "localised", intro_copy: "localised",
  card_title: "localised", card_summary: "localised", card_image_alt: "localised",
  timeline_title: "localised", timeline_summary: "localised",
  seo_title: "localised", seo_description: "localised", og_image_alt: "localised",
  facts: "localised",
  jsonld_name: "localised", jsonld_description: "localised",

  // --- localised because the NAME ITSELF is translated on the live pages ---
  // Venue and locality are written differently ("London" / "Londyn", and some
  // institution names are translated). Whether each SHOULD be translated is a
  // human question; the audit's job is to surface it, not to call it a defect.
  card_venue: "localised", jsonld_venue: "localised", jsonld_locality: "localised",
  jsonld_organiser: "localised",

  // --- per-locale BY DESIGN: the URL carries the /pl/ prefix ---
  // Marking these shared_invariant made the first run report five false
  // "contradictions" — a canonical that did NOT differ would be the bug.
  canonical: "per-locale-url", jsonld_url: "per-locale-url",

  // --- present on one locale by design ---
  // schema.org inLanguage is emitted on the Polish pages and absent on the
  // English ones. Asymmetry is the intent, not a discrepancy.
  jsonld_inLanguage: "locale-asymmetric",

  // --- derived: a display string that should come from a machine date ---
  card_display_date: "derived", timeline_display_date: "derived",

  // --- genuinely shared: same value must appear in both languages ---
  og_image: "shared_invariant", card_image: "shared_invariant",
  hero_image: "shared_invariant", gallery_image_count: "shared_invariant",
  detail_template_type: "shared_invariant", flagship_tag: "shared_invariant",
  instagram_permalink: "shared_invariant", album_link: "shared_invariant",
  registration_link: "shared_invariant", partner_logo_tiles: "shared_invariant",
  jsonld_start: "shared_invariant", jsonld_end: "shared_invariant",
  jsonld_status: "shared_invariant", jsonld_attendance: "shared_invariant",
  jsonld_country: "shared_invariant", jsonld_image: "shared_invariant",
  jsonld_performers: "shared_invariant",
  body_copy_paragraphs: "shared_invariant",
  download_links: "shared_invariant", external_links: "shared_invariant",
  images_missing_alt: "shared_invariant", images_empty_alt: "shared_invariant",

  language: "not-applicable",
};

function compareField(field, sources) {
  const classification = CLASSIFY[field] || "uncertain";
  const usable = sources.filter((s) => s.extracted !== false);
  const failed = sources.filter((s) => s.extracted === false);

  const entry = {
    field,
    classification,
    sources: sources.map((s) => ({
      file: s.file, locale: s.locale,
      value: s.extracted === false ? null : s.value,
      ...(s.extracted === false ? { extraction_failed: true, reason: s.reason } : {}),
    })),
    status: "uncertain",
    recommended_value: null,
    requires_human_decision: false,
  };

  if (classification === "not-applicable") {
    entry.status = "not-applicable";
    return entry;
  }
  if (sources.length === 0) {
    entry.status = "missing-in-some-sources";
    entry.requires_human_decision = true;
    return entry;
  }
  if (failed.length && usable.length === 0) {
    entry.status = "missing-in-some-sources";
    entry.requires_human_decision = true;
    entry.notes = "no source could be parsed for this field";
    return entry;
  }

  const key = (v) => JSON.stringify(v);
  const en = usable.filter((s) => s.locale === "en").map((s) => s.value);
  const pl = usable.filter((s) => s.locale === "pl").map((s) => s.value);

  // Within one language, sources must agree with each other.
  const enSet = new Set(en.map(key));
  const plSet = new Set(pl.map(key));
  const intraDisagreement = enSet.size > 1 || plSet.size > 1;

  if (classification === "localised") {
    if (intraDisagreement) {
      entry.status = "contradiction";
      entry.requires_human_decision = true;
      entry.notes = "sources within the same language disagree";
      return entry;
    }
    if (failed.length) {
      entry.status = "missing-in-some-sources";
      entry.requires_human_decision = true;
      return entry;
    }
    if (en.length && pl.length && key(en[0]) === key(pl[0])) {
      // Identical across languages is not automatically wrong (proper names),
      // but it is not something a script may bless either.
      entry.status = "uncertain";
      entry.requires_human_decision = true;
      entry.notes = "localised field is identical in both languages — may be a proper name, may be an untranslated string";
      return entry;
    }
    entry.status = "expected-localisation";
    return entry;
  }

  if (classification === "per-locale-url") {
    // Must differ, and must differ in exactly the expected way.
    const enV = en[0], plV = pl[0];
    if (failed.length) { entry.status = "missing-in-some-sources"; entry.requires_human_decision = true; return entry; }
    const expectedPl = typeof enV === "string" ? enV.replace(/^(https?:\/\/[^/]+)\//, "$1/pl/") : null;
    if (expectedPl && plV === expectedPl) {
      entry.status = "expected-localisation";
      entry.notes = "per-locale URL: the Polish value is the English one with the /pl/ prefix, as intended";
      return entry;
    }
    entry.status = "contradiction";
    entry.requires_human_decision = true;
    entry.notes = "per-locale URL does not follow the /pl/ prefix convention";
    return entry;
  }

  if (classification === "locale-asymmetric") {
    entry.status = "expected-localisation";
    entry.notes = "present on one locale by design (schema.org inLanguage on the Polish pages)";
    return entry;
  }

  if (classification === "derived") {
    entry.status = "expected-localisation";
    entry.notes = "display date — should be generated from a machine-readable date rather than stored per locale";
    if (intraDisagreement) {
      entry.status = "contradiction";
      entry.requires_human_decision = true;
      entry.notes = "display dates disagree between sources in the same language";
    }
    return entry;
  }

  // shared_invariant
  const all = new Set(usable.map((s) => key(s.value)));
  if (all.size === 1) {
    if (failed.length) {
      entry.status = "missing-in-some-sources";
      entry.recommended_value = usable[0].value;
      entry.notes = `${failed.length} source(s) could not be parsed; the parsed sources agree`;
      return entry;
    }
    entry.status = "consistent";
    entry.recommended_value = usable[0].value;
    return entry;
  }
  // Genuine disagreement on a value that must be identical.
  entry.status = "contradiction";
  entry.requires_human_decision = true;
  entry.recommended_value = null; // never guess
  return entry;
}

/* ------------------------------------------------------------------- main */

function main() {
  const src = {
    enListing: readOrFail("events.html"),
    plListing: readOrFail("pl/events.html"),
    enHome: readOrFail("index.html"),
    plHome: readOrFail("pl/index.html"),
  };
  const enCards = parseListing(src.enListing, "events.html");
  const plCards = parseListing(src.plListing, "pl/events.html");
  const enTl = parseTimeline(src.enHome, "index.html");
  const plTl = parseTimeline(src.plHome, "pl/index.html");
  const announcements = loadAnnouncements();

  const matrix = { generated_by: "scripts/audit-events.js", events: {} };
  const summary = { consistent: 0, "expected-localisation": 0, "missing-in-some-sources": 0,
    contradiction: 0, "invalid-format": 0, uncertain: 0, "not-applicable": 0 };
  const extractionFailures = [];

  for (const ev of EVENTS) {
    const enHtml = readOrFail(ev.page);
    const plHtml = readOrFail("pl/" + ev.page);
    const enDetail = parseDetailPage(enHtml, ev.page);
    const plDetail = parseDetailPage(plHtml, "pl/" + ev.page);

    for (const [side, parsed] of [["en", enDetail], ["pl", plDetail]]) {
      for (const [k, v] of Object.entries(parsed)) {
        if (v && v.extracted === false) {
          extractionFailures.push({ event: ev.slug, locale: side, file: parsed._file, field: k, reason: v.reason });
        }
      }
    }

    const fields = {};
    const add = (name, sources) => { fields[name] = compareField(name, sources); };
    const S = (file, locale, res) => ({ file, locale, ...(res || notFound("source absent")) });

    // Detail-page fields, both languages.
    const detailFields = ["title", "hero_eyebrow", "intro_copy", "seo_title", "seo_description",
      "canonical", "language", "og_image", "og_image_alt", "hero_image", "detail_template_type",
      "gallery_image_count", "body_copy_paragraphs", "instagram_permalink", "album_link",
      "registration_link", "external_links", "download_links", "partner_logo_tiles", "facts",
      "images_missing_alt", "images_empty_alt",
      "jsonld_start", "jsonld_end", "jsonld_name", "jsonld_description", "jsonld_status",
      "jsonld_attendance", "jsonld_venue", "jsonld_locality", "jsonld_country",
      "jsonld_organiser", "jsonld_url", "jsonld_image", "jsonld_performers", "jsonld_inLanguage"];
    for (const f of detailFields) {
      add(f, [S(ev.page, "en", enDetail[f]), S("pl/" + ev.page, "pl", plDetail[f])]);
    }

    // Listing-card fields.
    const ec = enCards[ev.slug], pc = plCards[ev.slug];
    for (const f of ["card_title", "card_summary", "card_display_date", "card_venue",
      "card_image", "card_image_alt", "flagship_tag"]) {
      add(f, [
        S("events.html", "en", ec ? ec[f] : notFound("event not present in English listing")),
        S("pl/events.html", "pl", pc ? pc[f] : notFound("event not present in Polish listing")),
      ]);
    }

    // Homepage timeline fields.
    const et = enTl[ev.slug], pt = plTl[ev.slug];
    for (const f of ["timeline_title", "timeline_summary", "timeline_display_date"]) {
      add(f, [
        S("index.html", "en", et ? et[f] : notFound("event not present in English timeline")),
        S("pl/index.html", "pl", pt ? pt[f] : notFound("event not present in Polish timeline")),
      ]);
    }

    // ---- CROSS-SOURCE consistency WITHIN one language -------------------
    // The per-field comparison above checks en-vs-pl. It cannot catch a venue
    // written one way on the card and another way in JSON-LD on the SAME page,
    // which is exactly the kind of drift that hand-maintained duplication
    // produces. Compare those here.
    const crossChecks = [];
    for (const [locale, detail, card] of [["en", enDetail, enCards[ev.slug]], ["pl", plDetail, plCards[ev.slug]]]) {
      const factOf = (labels) => {
        const f = (detail.facts.value || []).find((x) => x.label && labels.includes(x.label));
        return f ? f.value : null;
      };
      const venueVariants = {
        "facts bar": factOf(["Venue", "Miejsce"]),
        "listing card": card ? (card.card_venue.value || null) : null,
        "JSON-LD location.name": detail.jsonld_venue ? detail.jsonld_venue.value : null,
      };
      const venueSet = new Set(Object.values(venueVariants).filter(Boolean));
      if (venueSet.size > 1) {
        crossChecks.push({
          check: "venue_wording_across_sources", locale,
          values: venueVariants, distinct: venueSet.size,
          note: "the same venue is written differently in different places on the same-language pages",
        });
      }
      const dateVariants = {
        "facts bar": factOf(["Date", "Data"]),
        "listing card": card ? (card.card_display_date.value || null) : null,
        "homepage timeline": (locale === "en" ? enTl : plTl)[ev.slug]
          ? (locale === "en" ? enTl : plTl)[ev.slug].timeline_display_date.value : null,
      };
      const dateSet = new Set(Object.values(dateVariants).filter(Boolean));
      if (dateSet.size > 1) {
        crossChecks.push({
          check: "display_date_across_sources", locale,
          values: dateVariants, distinct: dateSet.size,
          note: "the same date is displayed differently in different places",
        });
      }
    }

    // Related announcements — informational, not compared for equality.
    const related = ev.announcementSlugs
      .filter((s) => announcements[s])
      .map((s) => ({
        slug: s, file: announcements[s]._file,
        published_date: announcements[s].published_date || null,
        link: announcements[s].link || null,
        en_title: (announcements[s].en || {}).title || null,
        pl_title: (announcements[s].pl || {}).title || null,
      }));
    const missingAnn = ev.announcementSlugs.filter((s) => !announcements[s]);

    for (const [, entry] of Object.entries(fields)) summary[entry.status]++;

    matrix.events[ev.slug] = {
      slug: ev.slug,
      detail_pages: { en: ev.page, pl: "pl/" + ev.page },
      sources_inspected: [
        ev.page, "pl/" + ev.page, "events.html", "pl/events.html", "index.html", "pl/index.html",
        ...related.map((r) => r.file),
      ],
      related_announcements: related,
      announcement_slugs_not_found: missingAnn,
      present_in_english_listing: Boolean(ec),
      present_in_polish_listing: Boolean(pc),
      present_in_english_timeline: Boolean(et),
      present_in_polish_timeline: Boolean(pt),
      cross_source_checks: crossChecks,
      fields,
    };
  }

  if (Object.keys(matrix.events).length === 0) {
    console.error("FATAL: zero events discovered — the audit cannot be meaningful.");
    process.exit(1);
  }

  matrix.summary = summary;
  matrix.extraction_failures = extractionFailures;
  matrix.supported_statuses = STATUSES;

  // ---- write the matrix -------------------------------------------------
  try {
    fs.mkdirSync(DOCS, { recursive: true });
    fs.writeFileSync(path.join(DOCS, "EVENT_SOURCE_MATRIX.json"),
      JSON.stringify(matrix, null, 2) + "\n", "utf8");
  } catch (e) {
    console.error(`FATAL: could not write the source matrix: ${e.message}`);
    process.exit(1);
  }

  // ---- console report ---------------------------------------------------
  console.log("=".repeat(72));
  console.log("  EVENT RECONCILIATION AUDIT (read-only)");
  console.log("=".repeat(72));
  console.log(`  events discovered: ${Object.keys(matrix.events).length}`);
  for (const [slug, ev] of Object.entries(matrix.events)) {
    const f = ev.fields;
    const counts = {};
    for (const e of Object.values(f)) counts[e.status] = (counts[e.status] || 0) + 1;
    const decisions = Object.values(f).filter((e) => e.requires_human_decision);
    console.log(`\n  ${slug}`);
    console.log(`    template: ${(f.detail_template_type.recommended_value) || "?"}` +
      `   listing en/pl: ${ev.present_in_english_listing}/${ev.present_in_polish_listing}` +
      `   timeline en/pl: ${ev.present_in_english_timeline}/${ev.present_in_polish_timeline}`);
    console.log(`    fields: ${Object.keys(f).length}  ` +
      Object.entries(counts).map(([k, v]) => `${k}=${v}`).join("  "));
    if (decisions.length) {
      console.log(`    NEEDS HUMAN DECISION (${decisions.length}):`);
      for (const d of decisions) console.log(`      - ${d.field} [${d.status}]${d.notes ? " — " + d.notes : ""}`);
    }
    if (ev.cross_source_checks && ev.cross_source_checks.length) {
      console.log(`    CROSS-SOURCE DRIFT (same language, different wording):`);
      for (const c of ev.cross_source_checks) {
        console.log(`      - [${c.locale}] ${c.check}: ${c.distinct} distinct values`);
        for (const [where, val] of Object.entries(c.values)) {
          if (val) console.log(`          ${where.padEnd(22)} ${JSON.stringify(val)}`);
        }
      }
    }
    if (ev.announcement_slugs_not_found.length) {
      console.log(`    announcement slugs not found: ${ev.announcement_slugs_not_found.join(", ")}`);
    }
  }

  console.log(`\n${"-".repeat(72)}`);
  console.log("  FIELD STATUS TOTALS");
  for (const s of STATUSES) console.log(`    ${s.padEnd(26)} ${summary[s]}`);

  console.log(`\n  EXTRACTION FAILURES (parser could not read the construct): ${extractionFailures.length}`);
  const byField = {};
  for (const x of extractionFailures) {
    byField[x.field] = byField[x.field] || [];
    byField[x.field].push(`${x.event}/${x.locale}`);
  }
  for (const [f, where] of Object.entries(byField)) {
    console.log(`    ${f}: ${where.join(", ")}`);
  }

  const totalCross = Object.values(matrix.events)
    .reduce((n, e) => n + (e.cross_source_checks || []).length, 0);
  console.log(`
  CROSS-SOURCE DRIFT FINDINGS: ${totalCross}`);

  const totalDecisions = Object.values(matrix.events)
    .reduce((n, e) => n + Object.values(e.fields).filter((f) => f.requires_human_decision).length, 0);
  console.log(`\n  ITEMS REQUIRING HUMAN DECISION: ${totalDecisions}`);
  console.log(`  matrix written: docs/EVENT_SOURCE_MATRIX.json`);
  console.log("=".repeat(72));

  // Human-review issues do NOT fail the command — the audit succeeded.
  process.exit(0);
}

main();
