/**
 * test-event-content.js — nothing an editor wrote was lost in the rebuild.
 *
 * WHY THIS EXISTS
 *
 * Phase 17C.5A.3 retired the `sections` / `en.sections` / `pl.sections` arrays
 * and gave standard events a fixed page: header, main body, gallery,
 * registration, photo album, social, navigation. The words, links, photographs
 * and headings did not change — only where they are stored and the order two of
 * the four pages put them in.
 *
 * scripts/compare-standard-events.js cannot prove that any more. It identifies
 * blocks by position, so when a gallery moves below the body its per-block
 * content checks are skipped for that page (`if (L.type !== G.type) continue`).
 * The comparison still catches everything else; this catches what it stopped
 * being able to see.
 *
 * WHAT IT PROVES
 *
 * For each of the four standard events, in both languages, against the LIVE
 * page at the repository root:
 *
 *   - every paragraph of prose is still on the generated page
 *   - every link keeps its address, label, target and rel
 *   - every blockquote survives
 *   - every photograph appears, with the same alt text and the same wide flag
 *   - every heading's words are still somewhere on the page
 *   - the album card and the social embeds are unchanged
 *
 * SET COMPARISON, NOT SEQUENCE. That is the whole point: the fixed structure
 * deliberately reorders two pages, and a test that insisted on the old order
 * would be asserting the bug this phase fixed. Order within the body is still
 * checked by the comparison script, which passes.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const EVENTS = ["christmas-dinner", "icebreaker", "sikorski-debate", "youth-congress"];

let checks = 0;
const problems = [];

function check(ok, what, detail) {
  checks++;
  if (ok) {
    console.log(`  ok    ${what}`);
    if (detail) console.log(`          ${detail}`);
  } else {
    console.log(`  FAIL  ${what}`);
    if (detail) console.log(`          ${detail}`);
    problems.push(what + (detail ? ` — ${detail}` : ""));
  }
}

/* -- reading a page --------------------------------------------------------- */

const decode = (s) => String(s)
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&rarr;/g, "→").replace(/&mdash;/g, "—");

/** Markup removed, whitespace collapsed — what a reader actually sees. */
const text = (s) => decode(String(s == null ? "" : s).replace(/<[^>]+>/g, " "))
  .replace(/\s+/g, " ").trim();

/**
 * The file an image src points at, however the page happens to spell the path.
 *
 * The live pages use relative addresses — `assets/…` at the root and
 * `../assets/…` under /pl/ — while the generated pages use absolute ones. Same
 * file, four spellings; reduce them all to `assets/…` so a comparison is about
 * the photograph and not about how the link was written.
 */
const assetKey = (src) => String(src || "")
  .replace(/^(\.\.\/|\.\/|\/)+/, "")
  .replace(/^pl\//, "");

/**
 * The article region of an event page.
 *
 * Between the header and the footer, so the navigation and the site chrome —
 * which this phase did not touch and the comparison script checks anyway —
 * cannot contribute a paragraph or a link and mask a real loss.
 */
function article(html) {
  const afterHeader = html.includes("</header>") ? html.split("</header>")[1] : html;
  return afterHeader.split("<footer")[0];
}

function paragraphs(body) {
  // Only prose paragraphs. The album blurb and the plain social links are
  // checked on their own terms below.
  return [...body.matchAll(/<div class="prose[^"]*"[^>]*>([\s\S]*?)<\/div>/g)]
    .flatMap((block) => [...block[1].matchAll(/<p>([\s\S]*?)<\/p>/g)])
    .map((m) => text(m[1]))
    .filter(Boolean);
}

function blockquotes(body) {
  return [...body.matchAll(/<blockquote>([\s\S]*?)<\/blockquote>/g)]
    .map((m) => text(m[1])).filter(Boolean);
}

function proseLinks(body) {
  return [...body.matchAll(/<div class="prose[^"]*"[^>]*>([\s\S]*?)<\/div>/g)]
    .flatMap((block) => [...block[1].matchAll(/<a href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g)])
    .map((m) => ({
      href: m[1],
      target: (m[2].match(/target="([^"]*)"/) || [])[1] || null,
      rel: (m[2].match(/rel="([^"]*)"/) || [])[1] || null,
      label: text(m[3]),
    }));
}

/** Every photograph on the page: gallery tiles and pictures inside the body. */
function photographs(body) {
  const out = [];
  for (const m of body.matchAll(
    /<div class="(ph[^"]*)"><img[^>]*?src="([^"]+)"[^>]*?alt="([^"]*)"[^>]*><\/div>/g)) {
    out.push({ src: assetKey(m[2]), alt: decode(m[3]), wide: /span-2/.test(m[1]) });
  }
  for (const block of body.matchAll(/<div class="prose[^"]*"[^>]*>([\s\S]*?)<\/div>/g)) {
    for (const m of block[1].matchAll(/<img[^>]*?src="([^"]+)"[^>]*?alt="([^"]*)"[^>]*>/g)) {
      out.push({ src: assetKey(m[1]), alt: decode(m[2]), wide: false });
    }
  }
  return out;
}

function headings(body) {
  return [...body.matchAll(/<div class="section-head[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>|<div class="section-head[^"]*"[^>]*>([\s\S]*?)<\/div>/g)]
    .map((m) => text(m[1] || m[2])).filter(Boolean);
}

function albumCard(body) {
  const m = body.match(/<div class="album-card[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
  if (!m) return null;
  const whole = body.slice(body.indexOf('<div class="album-card'));
  const btn = whole.match(/<a class="btn btn-primary" href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/);
  return {
    heading: text((whole.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1]),
    body: text((whole.match(/<div class="album-info">[\s\S]*?<p>([\s\S]*?)<\/p>/) || [])[1]),
    url: btn ? btn[1] : null,
    label: btn ? text(btn[3].replace(/<span class="arrow">[\s\S]*?<\/span>/, "")) : null,
  };
}

function embeds(body) {
  return [...body.matchAll(/data-instgrm-permalink="([^"]+)"/g)].map((m) => m[1]);
}

/* -- the comparison --------------------------------------------------------- */

const missingFrom = (want, have) => want.filter((w) => !have.includes(w));

function sameSet(label, live, gen, describe) {
  const lost = missingFrom(live, gen);
  check(lost.length === 0, label,
    lost.length ? `lost: ${lost.slice(0, 3).map(describe || String).join(" | ")}` :
      `all ${live.length} present`);
}

function comparePage(slug, lang) {
  const livePath = path.join(ROOT, lang === "pl" ? "pl" : ".", `event-${slug}.html`);
  const genPath = path.join(ROOT, "dist", lang === "pl" ? "pl" : ".", `event-${slug}.html`);
  const p = (what) => `${slug} [${lang}]: ${what}`;

  if (!fs.existsSync(livePath) || !fs.existsSync(genPath)) {
    check(false, p("both pages exist"), `${livePath} / ${genPath}`);
    return;
  }

  const live = article(fs.readFileSync(livePath, "utf8"));
  const gen = article(fs.readFileSync(genPath, "utf8"));

  sameSet(p("every paragraph survives"), paragraphs(live), paragraphs(gen),
    (t) => `"${t.slice(0, 50)}…"`);
  sameSet(p("every blockquote survives"), blockquotes(live), blockquotes(gen),
    (t) => `"${t.slice(0, 50)}…"`);

  const key = (l) => `${l.href} | ${l.label} | ${l.target || ""} | ${l.rel || ""}`;
  sameSet(p("every link keeps its address, label, target and rel"),
    proseLinks(live).map(key), proseLinks(gen).map(key));

  const photo = (x) => `${x.src} | ${x.alt} | ${x.wide ? "wide" : "single"}`;
  sameSet(p("every photograph keeps its file, description and width"),
    photographs(live).map(photo), photographs(gen).map(photo));

  /*
    Headings are compared word by word rather than whole. A heading that used to
    introduce a gallery is now the gallery's own heading and one that introduced
    the Instagram block is now the social heading — same words, different owner,
    and in one case the eyebrow and the title are no longer emitted adjacently.
  */
  const words = (hs) => hs.join(" ").split(/\s+/).filter(Boolean);
  const genWords = words(headings(gen)).join(" ");
  const lostWords = [...new Set(words(headings(live)))].filter((w) => !genWords.includes(w));
  check(lostWords.length === 0, p("every heading's words survive"),
    lostWords.length ? `lost: ${lostWords.join(" ")}` : `all ${headings(live).length} headings`);

  const liveAlbum = albumCard(live);
  if (liveAlbum) {
    const genAlbum = albumCard(gen);
    check(genAlbum !== null, p("the album card is still rendered"),
      genAlbum ? "present" : "missing");
    if (genAlbum) {
      for (const field of ["heading", "body", "url", "label"]) {
        check(liveAlbum[field] === genAlbum[field], p(`album ${field}`),
          liveAlbum[field] === genAlbum[field] ? "unchanged"
            : `live "${liveAlbum[field]}" vs generated "${genAlbum[field]}"`);
      }
    }
  }

  sameSet(p("every social embed keeps its permalink"), embeds(live), embeds(gen));
}

/* -- the stored records ----------------------------------------------------- */

function checkRecords() {
  const yaml = require("js-yaml");
  console.log("\n  The stored records\n  ------------------");
  for (const slug of EVENTS) {
    const file = path.join(ROOT, "content", "events", `${slug}.yaml`);
    const rec = yaml.load(fs.readFileSync(file, "utf8")) || {};

    check(rec.sections === undefined, `${slug}: the section array is gone`,
      rec.sections === undefined ? "retired" : "still present");
    for (const lang of ["en", "pl"]) {
      check(((rec[lang] || {}).sections) === undefined,
        `${slug} [${lang}]: the language section array is gone`,
        ((rec[lang] || {}).sections) === undefined ? "retired" : "still present");
      check(typeof ((rec[lang] || {}).body) === "string" && rec[lang].body.trim() !== "",
        `${slug} [${lang}]: the main body carries the writing`,
        `${String(((rec[lang] || {}).body) || "").length} characters`);
    }

    if (rec.gallery) {
      const images = rec.gallery.images || [];
      check(images.length > 0, `${slug}: the gallery holds photographs`,
        `${images.length} photographs`);
      check(images.every((im) => im.alt && im.alt.en && im.alt.pl),
        `${slug}: every gallery photograph is described in both languages`,
        images.every((im) => im.alt && im.alt.en && im.alt.pl) ? "all described"
          : "a description is missing");
      /*
        The alt text used to live in a parallel `alts` array indexed by position.
        Colocating it is the reason a photograph can no longer end up carrying
        the description of the one before it.
      */
      check(rec.gallery.alts === undefined,
        `${slug}: no parallel description array survives`,
        rec.gallery.alts === undefined ? "colocated" : "still present");
    }
  }
}

/* -- run -------------------------------------------------------------------- */

console.log("\n" + "=".repeat(78));
console.log("  STANDARD EVENT CONTENT ACCOUNTING");
console.log("  live pages vs dist/, as sets — the fixed structure reorders two pages");
console.log("=".repeat(78) + "\n");

for (const slug of EVENTS) {
  console.log(`  ${slug}\n  ${"-".repeat(slug.length)}`);
  comparePage(slug, "en");
  comparePage(slug, "pl");
  console.log("");
}
checkRecords();

console.log("\n" + "=".repeat(78));
if (problems.length) {
  console.log(`  FAIL — ${problems.length} of ${checks} content checks lost something:`);
  for (const p of problems) console.log(`    - ${p}`);
  console.log("=".repeat(78) + "\n");
  process.exit(1);
}
console.log(`  PASS — ${checks} content checks, nothing lost`);
console.log("=".repeat(78) + "\n");
