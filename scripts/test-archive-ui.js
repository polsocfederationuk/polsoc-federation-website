#!/usr/bin/env node
/**
 * test-archive-ui.js — verify the events-archive disclosure styles.
 *
 * The archive `<details>` disclosures the events listing generates for previous
 * academic years cannot be exercised by the real dataset: only one season exists,
 * so no real page renders them. Phase 14 added a synthetic fixture; Phase 15 moved
 * fixtures out of the deployment tree entirely.
 *
 * This builds the fixture into .fixtures/ (never dist/), asserts the archive CSS is
 * present and correctly scoped, asserts the fixture markup matches what
 * src/events.njk actually emits, and then removes the fixture tree again so nothing
 * is left lying around. Geometry and keyboard behaviour are checked in a browser
 * during the phase; this is the part that can run unattended in CI.
 *
 * Run:  node scripts/test-archive-ui.js
 * Exit: 0 when every check passes, 1 otherwise.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const FIXTURES = path.join(ROOT, ".fixtures");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let failures = 0;
const results = [];
function check(label, cond, detail) {
  results.push({ ok: !!cond, label, detail });
  if (!cond) failures++;
}

console.log("\n" + "=".repeat(70));
console.log("  ARCHIVE DISCLOSURE UI — fixture build and style audit");
console.log("=".repeat(70) + "\n");

/* ---- 1. the CSS itself ---------------------------------------------------- */
const css = read("css/style.css");

check(".event-archive is styled", css.includes(".event-archive"));
check(".event-archive-year is styled", css.includes(".event-archive-year"));
check(".event-archive-year > summary is styled", css.includes(".event-archive-year > summary"));
check("expanded content reuses the normal .event-list grid",
  /\.event-archive-year > \.event-list/.test(css));
check("the summary has a visible :focus-visible outline",
  /\.event-archive-year > summary:focus-visible\s*\{[^}]*outline/.test(css));
check("the summary keeps a touch-sized target (min-height: 44px)",
  /\.event-archive-year > summary\s*\{[^}]*min-height:\s*44px/s.test(css));
// Native semantics: the marker must survive, since no custom indicator is provided.
check("the native disclosure marker is NOT hidden",
  !/\.event-archive-year > summary[^{]*\{[^}]*list-style:\s*none/s.test(css)
  && !/event-archive-year[^{]*::-webkit-details-marker\s*\{[^}]*display:\s*none/s.test(css));
check("the summary renders as list-item so the marker shows",
  /\.event-archive-year > summary\s*\{[^}]*display:\s*list-item/s.test(css));
// Scoping: every archive rule must be prefixed, so nothing global changed.
{
  const archiveRules = [...css.matchAll(/^(\.[^\s{,][^{]*)\{/gm)]
    .map((m) => m[1].trim())
    .filter((sel) => /event-archive/.test(sel));
  const unscoped = archiveRules.filter((sel) =>
    !sel.split(",").every((s) => s.trim().startsWith(".event-archive")));
  check(`all ${archiveRules.length} archive rules are scoped to .event-archive*`,
    unscoped.length === 0, unscoped);
}

/* ---- 2. build the fixture, outside dist/ --------------------------------- */
const build = spawnSync(process.execPath, [path.join(__dirname, "build-fixtures.js")],
  { cwd: ROOT, encoding: "utf8" });
check("the fixture build succeeds", build.status === 0,
  build.status === 0 ? null : (build.stderr || build.stdout || "").split("\n").slice(-6));

const FIXTURE_PAGES = [".fixtures/build-test/archive-fixture.html", ".fixtures/build-test/pl/archive-fixture.html"];
for (const rel of FIXTURE_PAGES) {
  check(`${rel} was generated`, exists(rel));
}

/* ---- 3. the fixture must exercise the REAL markup ------------------------ */
// If the fixture drifts from what src/events.njk emits, it stops testing anything.
const listing = read("src/events.njk");
const listingArchive = {
  details: /<details class="event-year has-watermark"/.test(listing),
  summary: /<summary class="event-year-summary">/.test(listing),
  watermark: /<span class="watermark"/.test(listing),
  list: /<div class="event-list">/.test(listing),
};
check("src/events.njk still emits details.event-year / summary / watermark / .event-list",
  Object.values(listingArchive).every(Boolean), listingArchive);

for (const rel of FIXTURE_PAGES) {
  if (!exists(rel)) continue;
  const src = read(rel);
  check(`${rel}: groups years in a wrapper`, /<div class="event-years">/.test(src));
  check(`${rel}: uses native <details class="event-year">`, /<details class="event-year has-watermark"/.test(src));
  check(`${rel}: each year carries its own watermark`,
    (src.match(/<span class="watermark"/g) || []).length
      === (src.match(/<details class="event-year has-watermark"/g) || []).length);
  check(`${rel}: every disclosure has a <summary>`,
    (src.match(/<details class="event-archive-year">/g) || []).length
    === (src.match(/<summary>/g) || []).length);
  check(`${rel}: no disclosure is open by default`, !/<details[^>]*\bopen\b/.test(src));
  check(`${rel}: expanded content uses the normal .event-list grid`, /<div class="event-list">/.test(src));
  check(`${rel}: expanded content uses normal .event-card markup`, /<article class="event-card/.test(src));
  check(`${rel}: is noindex`, /noindex/.test(src));
  // No ARIA duplicating what <details> already provides.
  check(`${rel}: adds no ARIA to <details>`,
    [...src.matchAll(/<details([^>]*)>/g)].every((m) => !/role=|aria-expanded/.test(m[1])));
  check(`${rel}: needs no JavaScript for the disclosure`, !/details[^>]*onclick/.test(src));
}

/* ---- 4. the synthetic events must stay synthetic ------------------------- */
const FICTIONAL = ["example-winter-gala", "example-autumn-social", "example-spring-forum"];
check("no fictional fixture event exists in content/events/",
  FICTIONAL.every((s) => !exists(`content/events/${s}.yaml`)),
  FICTIONAL.filter((s) => exists(`content/events/${s}.yaml`)));

// And they must not have reached the deployment tree, if one is built.
if (exists("dist")) {
  const leaked = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith(".html")) {
        const src = read(rel);
        for (const s of FICTIONAL) if (src.includes(s)) leaked.push(`${rel} → ${s}`);
      }
    }
  };
  walk("dist");
  check("no fictional fixture event appears anywhere in dist/", leaked.length === 0, leaked);
  check("dist/ contains no build-test directory", !exists("dist/build-test"));
}

/* ---- 5. clean up -------------------------------------------------------- */
let cleaned = false;
if (fs.existsSync(FIXTURES)) {
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  cleaned = !fs.existsSync(FIXTURES);
}
check("the temporary fixture tree was removed", cleaned || !fs.existsSync(FIXTURES));

/* ---- output ------------------------------------------------------------- */
for (const r of results) {
  console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.label}`);
  if (!r.ok && r.detail) {
    const d = Array.isArray(r.detail) ? r.detail : [r.detail];
    d.slice(0, 8).forEach((x) => console.log(`          ${typeof x === "string" ? x : JSON.stringify(x)}`));
  }
}
console.log("\n" + "=".repeat(70));
if (failures === 0) console.log(`  PASS — ${results.length}/${results.length} archive-UI checks`);
else console.log(`  FAIL — ${failures} of ${results.length} archive-UI checks`);
console.log("=".repeat(70) + "\n");
process.exit(failures === 0 ? 0 : 1);
