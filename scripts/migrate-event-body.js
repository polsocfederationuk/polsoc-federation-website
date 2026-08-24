#!/usr/bin/env node
/**
 * migrate-event-body.js — retire the three parallel section arrays.
 *
 * WHAT THIS REPLACES
 *
 * A standard event's page used to be assembled from three lists that had to stay
 * aligned by position:
 *
 *   sections[]      the structure — which block, which images, which spacing
 *   en.sections[]   the English words for each block
 *   pl.sections[]   the Polish words for each block
 *
 * Adding a paragraph meant editing all three in the same place, and getting it
 * wrong was a refused save at best. Every guard this repository grew around that
 * architecture existed because the architecture was dangerous.
 *
 * WHAT IT BECOMES
 *
 *   en.body / pl.body   the long-form description, as Markdown
 *   gallery             ONE ordered image list, each image carrying its own
 *                       bilingual alt text and its own `wide` layout flag
 *   social.heading      the optional heading that used to introduce Instagram
 *
 * and a template that owns the page structure: header, body, gallery,
 * registration, album, social, navigation. No ordering for an editor to get
 * wrong, and no index alignment anywhere.
 *
 * THE MAPPING, walked in the original order so the body reads as it did:
 *
 *   prose                          -> body paragraphs, unchanged (already
 *                                     Markdown, blockquotes and links included)
 *   heading before prose           -> "## Title" inside the body
 *   heading before a real gallery  -> the gallery's own heading + eyebrow
 *   heading before Instagram       -> the social region's heading + eyebrow
 *   gallery                        -> the dedicated gallery
 *   gallery with instagram_in_grid -> its photographs join the gallery; the
 *                                     Instagram embed itself is already stored
 *                                     as `instagram_permalink`
 *   album / instagram markers      -> dropped; both already have canonical
 *                                     top-level fields, and the template places
 *                                     them
 *
 * A "real" gallery is one WITHOUT `instagram_in_grid`. That flag marked a grid
 * whose purpose was to present the Instagram embed rather than photographs, and
 * treating it as a photo gallery would have moved an "As seen on Instagram"
 * heading onto four unrelated networking photographs.
 *
 * WHAT VISIBLY MOVES, stated plainly rather than discovered later: a gallery
 * that used to sit ABOVE the prose now sits below it, because the template owns
 * that position. Sikorski Debate and Youth Congress are both affected. Nothing
 * is removed and no image changes size or order.
 *
 * Per-block spacing (`style: margin-bottom: 70px`) is deliberately not carried
 * over. Spacing belongs to the stylesheet, not to content.
 *
 * The script REFUSES to write if any paragraph, link, image or alt text would be
 * lost, and prints an accounting for every record.
 *
 * Run:  node scripts/migrate-event-body.js [--write]
 */

"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.join(__dirname, "..");
const EVENTS = path.join(ROOT, "content", "events");
const WRITE = process.argv.includes("--write");
const LOCALES = ["en", "pl"];

const text = (v) => (typeof v === "string" ? v.trim() : "");

/** A gallery of photographs, as opposed to a grid built to hold an embed. */
const isPhotoGallery = (s) => s.type === "gallery" && !s.instagram_in_grid;

/** What kind of block does this heading introduce? */
function headingTarget(sections, index) {
  for (let i = index + 1; i < sections.length; i++) {
    const t = sections[i].type;
    if (t === "heading") break;
    if (t === "gallery") return sections[i].instagram_in_grid ? "social" : "gallery";
    if (t === "instagram") return "social";
    if (t === "album") return "album";
    if (t === "prose") return "body";
  }
  return "body";
}

/**
 * The bilingual heading text carried by one `heading` section.
 *
 * The lead and the highlighted part stay APART. Joining them into one string
 * loses the `<span class="fancy">` the live pages render — two events set the
 * last word of their heading in the decorative face, and flattening it here
 * would silently reset authored typography on a page that is already published.
 */
function headingParts(record, index) {
  const out = { eyebrow: {}, heading: {}, heading_fancy: {} };
  for (const locale of LOCALES) {
    const loc = ((record[locale] || {}).sections || [])[index] || {};
    out.eyebrow[locale] = text(loc.eyebrow);
    out.heading[locale] = text(loc.title_lead) || "";
    out.heading_fancy[locale] = text(loc.title_fancy) || "";
  }
  return out;
}

/* -- the pieces ------------------------------------------------------------- */

function buildPlan(record) {
  const sections = Array.isArray(record.sections) ? record.sections : [];

  const bodyParts = { en: [], pl: [] };
  const images = [];
  let galleryHeading = null;
  let socialHeading = null;

  sections.forEach((section, i) => {
    if (section.type === "prose") {
      for (const locale of LOCALES) {
        const body = text((((record[locale] || {}).sections || [])[i] || {}).body);
        if (body) bodyParts[locale].push(body);
      }
      return;
    }

    if (section.type === "heading") {
      const parts = headingParts(record, i);
      const target = headingTarget(sections, i);
      if (target === "gallery" && !galleryHeading) { galleryHeading = parts; return; }
      if (target === "social" && !socialHeading) { socialHeading = parts; return; }
      // Anything introducing prose stays in the body as a real heading.
      for (const locale of LOCALES) {
        const h = parts.heading[locale];
        const e = parts.eyebrow[locale];
        if (!h && !e) continue;
        bodyParts[locale].push(`## ${[e, h].filter(Boolean).join(" — ")}`);
      }
      return;
    }

    if (section.type === "gallery") {
      // Photographs from BOTH kinds of grid are kept; only the embed-holder's
      // purpose differs, and the embed itself is stored separately.
      (section.images || []).forEach((img, k) => {
        const alt = {};
        for (const locale of LOCALES) {
          alt[locale] = text(((((record[locale] || {}).sections || [])[i] || {}).alts || [])[k]);
        }
        images.push({ src: text(img.src), wide: img.wide === true, alt });
      });
    }
    // `album` and `instagram` are position markers only.
  });

  const gallery = images.length
    ? Object.assign({ images }, galleryHeading ? {
      eyebrow: galleryHeading.eyebrow, heading: galleryHeading.heading,
      heading_fancy: galleryHeading.heading_fancy,
    } : {})
    : null;

  return {
    body: { en: bodyParts.en.join("\n\n"), pl: bodyParts.pl.join("\n\n") },
    gallery,
    socialHeading,
  };
}

/* -- accounting: prove nothing was lost ------------------------------------ */

const LINK = /\[[^\]]*\]\((?!\/assets)[^)]+\)/g;

function accounting(record, locale, plan) {
  const sections = record.sections || [];
  const local = (record[locale] || {}).sections || [];

  const oldProse = local.filter((s, i) => (sections[i] || {}).type === "prose")
    .map((s) => text(s.body)).join("\n\n");
  const body = plan.body[locale];

  const oldImages = sections.filter((s) => s.type === "gallery")
    .reduce((n, s) => n + (s.images || []).length, 0);
  const newImages = plan.gallery ? plan.gallery.images.length : 0;

  const oldAlts = local.filter((s, i) => (sections[i] || {}).type === "gallery")
    .reduce((n, s) => n + (s.alts || []).filter(Boolean).length, 0);
  const newAlts = plan.gallery
    ? plan.gallery.images.filter((im) => text(im.alt[locale])).length : 0;

  const oldWide = sections.filter((s) => s.type === "gallery")
    .reduce((n, s) => n + (s.images || []).filter((im) => im.wide).length, 0);
  const newWide = plan.gallery ? plan.gallery.images.filter((im) => im.wide).length : 0;

  // Every heading's words must survive somewhere.
  const oldHeadings = local.filter((s, i) => (sections[i] || {}).type === "heading")
    .map((s) => [s.eyebrow, s.title_lead, s.title_fancy].map(text).filter(Boolean).join(" "))
    .filter(Boolean);
  const haystack = [
    body,
    plan.gallery && plan.gallery.heading ? plan.gallery.heading[locale] : "",
    plan.gallery && plan.gallery.heading_fancy ? plan.gallery.heading_fancy[locale] : "",
    plan.gallery && plan.gallery.eyebrow ? plan.gallery.eyebrow[locale] : "",
    plan.socialHeading ? plan.socialHeading.heading[locale] : "",
    plan.socialHeading ? plan.socialHeading.heading_fancy[locale] : "",
    plan.socialHeading ? plan.socialHeading.eyebrow[locale] : "",
  ].join("\n");
  const lostHeadings = oldHeadings.filter((h) =>
    !h.split(" ").every((word) => haystack.includes(word)));

  const missing = oldProse.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .filter((p) => !body.includes(p));

  return {
    oldLinks: (oldProse.match(LINK) || []).length,
    newLinks: (body.match(LINK) || []).length,
    oldImages, newImages, oldAlts, newAlts, oldWide, newWide,
    missing, lostHeadings,
  };
}

/* -- run -------------------------------------------------------------------- */

let failures = 0;
const files = fs.readdirSync(EVENTS).filter((f) => /\.ya?ml$/i.test(f)).sort();

console.log("\n" + "=".repeat(78));
console.log("  STANDARD EVENT BODY + GALLERY MIGRATION" +
  (WRITE ? "" : "   (dry run — pass --write)"));
console.log("=".repeat(78));

const pending = [];

for (const file of files) {
  const full = path.join(EVENTS, file);
  const record = yaml.load(fs.readFileSync(full, "utf8")) || {};

  if (record.event_family !== "standard") {
    console.log(`\n  ${record.slug} — skipped (${record.event_family})`);
    continue;
  }
  if (!Array.isArray(record.sections) || !record.sections.length) {
    console.log(`\n  ${record.slug} — already migrated (no sections)`);
    continue;
  }

  const plan = buildPlan(record);
  const order = record.sections.map((s) =>
    s.type === "gallery" && s.instagram_in_grid ? "gallery(embed)" : s.type).join(" → ");
  const galleryFirst = record.sections.findIndex(isPhotoGallery);
  const proseFirst = record.sections.findIndex((s) => s.type === "prose");
  const moved = galleryFirst >= 0 && proseFirst >= 0 && galleryFirst < proseFirst;

  console.log(`\n  ${record.slug}`);
  console.log(`    was: ${order}`);
  console.log(`    gallery moves below the body: ${moved ? "YES" : "no"}`);

  for (const locale of LOCALES) {
    const a = accounting(record, locale, plan);
    const ok = a.newLinks >= a.oldLinks && a.newImages === a.oldImages &&
      a.newAlts >= a.oldAlts && a.newWide === a.oldWide &&
      a.missing.length === 0 && a.lostHeadings.length === 0;
    if (!ok) failures++;
    console.log(
      `    ${locale}: body ${a.newLinks}/${a.oldLinks} links | ` +
      `gallery ${a.newImages}/${a.oldImages} images, ${a.newWide}/${a.oldWide} wide, ` +
      `${a.newAlts}/${a.oldAlts} alts | ${ok ? "OK" : "CONTENT WOULD BE LOST"}`);
    for (const m of a.missing) console.log(`      MISSING PARAGRAPH: ${m.slice(0, 70)}…`);
    for (const h of a.lostHeadings) console.log(`      MISSING HEADING: ${h}`);
  }
  if (plan.gallery && plan.gallery.heading) {
    console.log(`    gallery heading: ${JSON.stringify(plan.gallery.eyebrow.en)} / ` +
      `${JSON.stringify(plan.gallery.heading.en)}`);
  }
  if (plan.socialHeading) {
    console.log(`    social heading:  ${JSON.stringify(plan.socialHeading.eyebrow.en)} / ` +
      `${JSON.stringify(plan.socialHeading.heading.en)}`);
  }

  pending.push({ full, record, plan });
}

console.log("\n" + "=".repeat(78));
if (failures) {
  console.log(`  REFUSED — ${failures} language case(s) would lose content. Nothing written.`);
  process.exit(1);
}

if (WRITE) {
  for (const { full, record, plan } of pending) {
    for (const locale of LOCALES) {
      record[locale].body = plan.body[locale];
      delete record[locale].sections;
    }
    delete record.sections;
    if (plan.gallery) record.gallery = plan.gallery;
    if (plan.socialHeading) {
      record.social_heading = {
        eyebrow: plan.socialHeading.eyebrow,
        heading: plan.socialHeading.heading,
        heading_fancy: plan.socialHeading.heading_fancy,
      };
    }
    fs.writeFileSync(full, yaml.dump(record, { lineWidth: -1, noRefs: true, quotingType: '"' }));
    console.log(`  written: ${record.slug}`);
  }
  console.log("\n  Migration written.");
} else {
  console.log("  Dry run clean. Re-run with --write to apply.");
}
console.log("=".repeat(78) + "\n");
