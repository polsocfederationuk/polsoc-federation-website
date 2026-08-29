#!/usr/bin/env node
/**
 * test-cms-roundtrip.js — prove a CMS save cannot corrupt a content record.
 *
 * THE RISK
 * --------
 * Decap does not edit YAML text. It parses a file into a plain object, lets the
 * editor change fields, and then re-serialises the object from scratch. Anything
 * the parser drops, or the serialiser writes differently, is silently lost the
 * first time a non-technical editor presses Save — and the loss looks like an
 * innocent formatting diff.
 *
 * WHAT THIS TEST DOES
 * -------------------
 * It replays Decap's own load/save cycle against every real record and asserts
 * that the DATA the site's build sees is unchanged. Two different YAML libraries
 * are involved on purpose:
 *
 *   - Decap serialises with `yaml`@1  (decap-cms-core/dist/esm/formats/yaml.js)
 *   - The site parses with `js-yaml`  (eleventy.config.js, src/_data/records.js)
 *
 * A value that survives the first but changes meaning under the second — an
 * unquoted 2025/26 read back as something other than the string "2025/26", say —
 * would break the build in a way neither library would report on its own. So the
 * comparison is always: js-yaml(original) === js-yaml(Decap's output).
 *
 * The load/save functions below are transcribed from decap-cms-core rather than
 * imported: that module is ESM, bundled for the browser, and not resolvable from
 * Node. scripts/validate-cms.js asserts the transcription still matches the
 * installed package, so it cannot quietly drift.
 *
 * NOTHING IS WRITTEN. The whole test runs in memory; content/ is only ever read.
 *
 * Run:  npm run test:cms-roundtrip
 */

"use strict";

const fs = require("fs");
const path = require("path");
const jsyaml = require("js-yaml");
const yaml = require("yaml");

const ROOT = path.join(__dirname, "..");
const cms = require(path.join(ROOT, "src", "_data", "cmsConfig.js"));

/* ===========================================================================
   Decap's format module, transcribed.
   =========================================================================== */

function sortKeys(sortedKeys, selector = (a) => a) {
  return (a, b) => {
    const idxA = sortedKeys.indexOf(selector(a));
    const idxB = sortedKeys.indexOf(selector(b));
    if (idxA === -1 || idxB === -1) return 0;
    if (idxA > idxB) return 1;
    if (idxA < idxB) return -1;
    return 0;
  };
}

const timestampTag = {
  identify: (v) => v instanceof Date,
  default: true,
  tag: "!timestamp",
  test: RegExp("^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2}(\\.[0-9]+)?)Z$"),
  resolve: (str) => new Date(str),
  stringify: (v) => v.toISOString(),
};

/** decap-cms-core formats/yaml.js -> fromFile */
function decapLoad(content) {
  let src = content;
  if (src && src.trim().endsWith("---")) src = src.trim().slice(0, -3);
  const doc = yaml.parseDocument(src, { customTags: [timestampTag], prettyErrors: true });
  if (doc.errors.length) throw new Error(doc.errors.map((e) => e.message).join("\n"));
  return doc.toJSON();
}

/** decap-cms-core formats/yaml.js -> toFile */
function decapSave(data, sortedKeys = []) {
  const contents = yaml.createNode(data);
  contents.items.sort(sortKeys(sortedKeys, (item) => (item.key ? item.key.toString() : undefined)));
  const doc = new yaml.Document();
  doc.contents = contents;
  return doc.toString();
}

/* ===========================================================================
   Harness
   =========================================================================== */

let failures = 0;
const results = [];
function check(ok, label, detail) {
  if (!ok) failures++;
  results.push({ ok, label, detail });
}
function section(title) {
  results.push({ section: title });
}

const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A stable, order-insensitive description of every leaf value and its type. */
function shape(value, prefix = "") {
  const out = [];
  const walk = (v, p) => {
    if (v === null) return out.push(`${p} = null`);
    if (Array.isArray(v)) {
      out.push(`${p} = array[${v.length}]`);
      v.forEach((item, i) => walk(item, `${p}[${i}]`));
      return;
    }
    if (typeof v === "object") {
      for (const k of Object.keys(v).sort()) walk(v[k], p ? `${p}.${k}` : k);
      return;
    }
    out.push(`${p} = ${typeof v}:${JSON.stringify(v)}`);
  };
  walk(value, prefix);
  return out;
}

/* ===========================================================================
   1. Every Team record survives a load/save cycle
   =========================================================================== */

section("1. Team records — Decap load/save against every real record");

const TEAM_DIR = "content/team";
const teamFiles = fs
  .readdirSync(path.join(ROOT, TEAM_DIR))
  .filter((f) => /\.ya?ml$/i.test(f))
  .sort();

check(teamFiles.length > 0, `found ${teamFiles.length} Team records to test`);

/*
  The configured order must PRESERVE the order of the keys records already have.

  This used to pin the configured list to one exact array, which meant adding any
  optional field failed the test even when it changed nothing about existing
  records — as `photo_focus` did in Phase 17C.3. That is the wrong property: a
  new optional field is expected, and forbidding it would have meant either never
  adding one or editing the expected list by hand each time, which proves nothing.

  What actually matters is that a CMS save cannot REORDER a record that already
  exists. So the check is now a subsequence test: strip the fields no record
  carries, and what is left must still be in the historic order.
*/
const ORDER = cms.TEAM_FIELD_ORDER;
const HISTORIC = ["slug", "academic_year", "group", "order", "published", "name",
  "photo", "email", "linkedin", "en", "pl"];
check(
  eq(ORDER.filter((k) => HISTORIC.includes(k)), HISTORIC),
  "the configured field order still preserves the order of the existing keys",
  ORDER.join(", ")
);
check(
  ORDER.filter((k) => !HISTORIC.includes(k)).every((k) => {
    // Any field added since must be one no existing record carries, or it would
    // change those records on their next save.
    return teamFiles.every((f) => {
      const d = jsyaml.load(fs.readFileSync(path.join(ROOT, TEAM_DIR, f), "utf8")) || {};
      return d[k] === undefined;
    });
  }),
  "every field added since is absent from all existing records, so none of them change",
  ORDER.filter((k) => !HISTORIC.includes(k)).join(", ") || "none added"
);

let nullPhotoTested = false;
let missingAltTested = false;

for (const file of teamFiles) {
  const rel = `${TEAM_DIR}/${file}`;
  const source = readText(rel);

  // What the SITE sees today.
  const before = jsyaml.load(source);
  // What Decap would write, and what the site would see afterwards.
  const saved = decapSave(decapLoad(source), ORDER);
  const after = jsyaml.load(saved);

  const same = eq(shape(before), shape(after));
  check(same, `${file}`, same ? null : firstDifference(shape(before), shape(after)));

  // Type-level assertions, stated explicitly rather than relying on the deep
  // compare, so a failure names the actual problem.
  if (before.published !== undefined) {
    check(typeof after.published === "boolean",
      `  ${file}: published stayed a real boolean`,
      `became ${typeof after.published}`);
  }
  if (before.order !== undefined) {
    check(Number.isInteger(after.order), `  ${file}: order stayed a whole number`,
      `became ${JSON.stringify(after.order)}`);
  }
  check(typeof after.academic_year === "string" && /^\d{4}\/\d{2}$/.test(after.academic_year),
    `  ${file}: academic_year stayed the string "${before.academic_year}"`,
    `became ${typeof after.academic_year}:${JSON.stringify(after.academic_year)}`);

  if (before.photo === null) {
    nullPhotoTested = true;
    check(after.photo === null && "photo" in after,
      `  ${file}: an absent photograph stayed an explicit null`,
      `became ${JSON.stringify(after.photo)}`);
    check(!(after.en && after.en.photo_alt) && !(after.pl && after.pl.photo_alt),
      `  ${file}: no alt text was invented for a member with no photograph`);
  } else {
    check(String(after.photo).startsWith("/assets/team/"),
      `  ${file}: photograph path stayed root-relative under /assets/team/`,
      after.photo);
    check(!String(after.photo).startsWith("/pl/"),
      `  ${file}: photograph path did not acquire a /pl/ prefix`);
  }

  if (!(before.en && before.en.photo_alt)) missingAltTested = true;

  check(after.en && after.pl && typeof after.en === "object" && typeof after.pl === "object",
    `  ${file}: en/pl stayed nested objects in ONE file`);
  check(after.en.role === before.en.role && after.pl.role === before.pl.role,
    `  ${file}: both localised roles are unchanged`);
}

check(nullPhotoTested, "the null-photograph case was actually exercised");
check(missingAltTested, "the omitted-alt-text case was actually exercised");

/* ===========================================================================
   2. Editing one field changes exactly that field
   =========================================================================== */

section("2. A single edit changes one value and nothing else");

{
  const rel = `${TEAM_DIR}/${teamFiles[0]}`;
  const before = jsyaml.load(readText(rel));

  const data = decapLoad(readText(rel));
  data.en.role = "CHANGED FOR TEST";                       // one safe field
  const after = jsyaml.load(decapSave(data, ORDER));

  check(after.en.role === "CHANGED FOR TEST", `${teamFiles[0]}: the edited field changed`);

  const beforeShape = shape(before).filter((l) => !l.startsWith("en.role "));
  const afterShape = shape(after).filter((l) => !l.startsWith("en.role "));
  check(eq(beforeShape, afterShape),
    `${teamFiles[0]}: every OTHER field is byte-identical`,
    eq(beforeShape, afterShape) ? null : firstDifference(beforeShape, afterShape));

  // The Polish role must not be dragged along with the English one.
  check(after.pl.role === before.pl.role,
    `${teamFiles[0]}: editing the English role left the Polish role alone`);
}

/* ===========================================================================
   3. The academic-year setting
   =========================================================================== */

section("3. Site settings — content/settings/academic-year.yaml");

{
  const rel = "content/settings/academic-year.yaml";
  const source = readText(rel);
  const before = jsyaml.load(source);
  const after = jsyaml.load(decapSave(decapLoad(source), cms.SETTINGS_FIELD_ORDER));

  check(eq(shape(before), shape(after)), "the settings file survives a load/save cycle",
    eq(shape(before), shape(after)) ? null : firstDifference(shape(before), shape(after)));
  check(typeof after.current === "string" && after.current === before.current,
    `current stayed the string "${before.current}"`);
  check(Array.isArray(after.known) && eq(after.known, before.known),
    "the `known` list survived, in order", JSON.stringify(after.known));

  // The `known` list is only preserved because it is a configured field. Prove
  // that an UNCONFIGURED key would be dropped, so the reason is on record.
  const configured = cms.SETTINGS_FIELD_ORDER;
  check(configured.includes("known"),
    "`known` is a configured CMS field, so a save cannot drop it");

  const settingsFields = cms
    .buildConfig()
    .collections.find((c) => c.name === "settings")
    .files.find((f) => f.name === "academic_year").fields.map((f) => f.name);
  const unconfigured = Object.keys(before).filter((k) => !settingsFields.includes(k));
  check(unconfigured.length === 0,
    "every key in the settings file is exposed as a CMS field (none can be dropped)",
    unconfigured.length ? `unconfigured keys: ${unconfigured.join(", ")}` : null);

  // Changing the year must not disturb the archive list.
  const mutated = decapLoad(source);
  mutated.current = "2026/27";
  const rolled = jsyaml.load(decapSave(mutated, cms.SETTINGS_FIELD_ORDER));
  check(rolled.current === "2026/27" && eq(rolled.known, before.known),
    "changing `current` leaves `known` untouched");
  check(typeof rolled.current === "string",
    'a rolled-over year is still a string, not a date or a number');
}

/* ===========================================================================
   4. Same person, two academic years — no collision
   =========================================================================== */

section("4. The same person can exist in two academic years");

{
  // Decap writes to `folder`/`slug`.`extension`, where slug is the configured
  // template. Reproduce that filename derivation exactly.
  const teamCollection = cms.buildConfig().collections.find((c) => c.name === "team");
  check(teamCollection.slug === "{{fields.slug}}",
    "the Team filename is the record's own `slug` field",
    teamCollection.slug);
  check(teamCollection.extension === "yaml" && teamCollection.format === "yaml",
    "the Team collection is pure YAML with the repository's existing extension");

  const filenameFor = (record) => `${teamCollection.folder}/${record.slug}.${teamCollection.extension}`;

  const yearOne = { slug: "cms-test-person", academic_year: "2025/26", group: "events", order: 9,
    published: false, name: "CMS Test Person", photo: null,
    email: "cms.test@example.invalid", linkedin: "https://www.linkedin.com/in/cms-test-person/",
    en: { role: "Test Officer" }, pl: { role: "Testowy specjalista" } };
  const yearTwo = { ...yearOne, slug: "cms-test-person-2026-27", academic_year: "2026/27" };

  const f1 = filenameFor(yearOne);
  const f2 = filenameFor(yearTwo);
  check(f1 !== f2, "the two years resolve to DIFFERENT files", `${f1}  vs  ${f2}`);
  check(!fs.existsSync(path.join(ROOT, f1)) && !fs.existsSync(path.join(ROOT, f2)),
    "neither test filename collides with a record that already exists");

  // Both must round-trip, and the second must not inherit the first's year.
  const r1 = jsyaml.load(decapSave(yearOne, ORDER));
  const r2 = jsyaml.load(decapSave(yearTwo, ORDER));
  check(r1.academic_year === "2025/26" && r2.academic_year === "2026/27",
    "each record keeps its own academic year");
  check(r1.name === r2.name, "both records describe the same person");
  check(r1.slug !== r2.slug, "the two records have distinct identities");

  // The real reason a year-suffixed slug is required: without it, both years
  // derive the SAME path, and the second save overwrites the first.
  const naive = filenameFor({ ...yearTwo, slug: "cms-test-person" });
  check(naive === f1,
    "a name-only filename WOULD collide — which is why the year suffix exists",
    `${naive} === ${f1}`);

  // Every existing record's slug must equal its filename, or the validator's
  // own assertion would already be failing.
  const mismatched = teamFiles.filter((f) => {
    const rec = jsyaml.load(readText(`${TEAM_DIR}/${f}`));
    return `${rec.slug}.yaml` !== f;
  });
  check(mismatched.length === 0,
    "every existing record's slug already equals its filename",
    mismatched.join(", "));
}

/* ===========================================================================
   5. The build can still read what Decap writes
   =========================================================================== */

section("5. The site's own data layer accepts Decap's output");

{
  // records.js is what the build actually uses. Feed it Decap-serialised text
  // through the same js-yaml call and confirm the shape templates rely on.
  let ok = true;
  const problems = [];
  for (const file of teamFiles) {
    const rec = jsyaml.load(decapSave(decapLoad(readText(`${TEAM_DIR}/${file}`)), ORDER));
    if (rec.published !== true) { ok = false; problems.push(`${file}: published`); }
    if (!rec.group || !rec.academic_year) { ok = false; problems.push(`${file}: group/year`); }
    if (!rec.en || !rec.en.role || !rec.pl || !rec.pl.role) { ok = false; problems.push(`${file}: roles`); }
  }
  check(ok, "every round-tripped record still satisfies what the team template reads",
    problems.slice(0, 5).join("; "));

  /*
    THE TYPE, NOT THE YEAR.

    The team filters compare academic_year with ===, so a round trip that turned
    "2025/26" into anything else — a Date, a number, a differently-quoted string
    — would empty the page silently rather than error. That is what this guards.

    It used to compare every record against the CURRENT year instead, which held
    only while every record happened to belong to it. The moment Site settings
    moved to 2026/27 — an ordinary rollover, and the thing the multi-year work
    exists to support — 21 perfectly good records failed a test about types.

    Each record is now compared with its own original value, which is the
    invariant that was always meant, and which no rollover can break.
  */
  const originalYears = teamFiles.map((f) =>
    jsyaml.load(readText(`${TEAM_DIR}/${f}`)).academic_year);
  const years = teamFiles.map((f) =>
    jsyaml.load(decapSave(decapLoad(readText(`${TEAM_DIR}/${f}`)), ORDER)).academic_year);
  const preserved = years.filter(
    (y, i) => typeof y === "string" && y === originalYears[i]).length;
  check(preserved === teamFiles.length,
    `all ${teamFiles.length} round-tripped records keep academic_year identical, by strict equality`,
    preserved === teamFiles.length
      ? `${new Set(originalYears).size} distinct year(s), every one unchanged`
      : `${teamFiles.length - preserved} record(s) changed type or value`);
}

/* ===========================================================================
   6. What a save DOES change — stated, not hidden
   =========================================================================== */

section("6. Known, accepted formatting changes");

{
  const source = readText(`${TEAM_DIR}/${teamFiles[0]}`);
  const saved = decapSave(decapLoad(source), ORDER);

  const srcComments = (source.match(/^\s*#/gm) || []).length;
  const outComments = (saved.match(/^\s*#/gm) || []).length;
  check(srcComments > 0 && outComments === 0,
    `comments are dropped by a CMS save (${srcComments} in the source, ${outComments} after)`,
    "this is Decap behaviour, not a defect — documented in docs/CMS_FOUNDATION.md §8");

  check(!/"2025\/26"/.test(saved) && /2025\/26/.test(saved),
    "redundant quotes are dropped, and the value is still read back as a string");

  // The important half: dropping the quotes must not change the parsed value.
  check(jsyaml.load(saved).academic_year === jsyaml.load(source).academic_year,
    "the unquoted year parses identically under js-yaml");
}

/* ===========================================================================
   Output
   =========================================================================== */

function firstDifference(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return `before: ${a[i] || "(absent)"}   after: ${b[i] || "(absent)"}`;
  }
  return "(no line-level difference found)";
}

console.log("\n" + "=".repeat(78));
console.log("  CMS YAML ROUND-TRIP SAFETY");
console.log("  Decap yaml@" + require(path.join(ROOT, "node_modules", "yaml", "package.json")).version +
  "  vs  build js-yaml@" + require(path.join(ROOT, "node_modules", "js-yaml", "package.json")).version);
console.log("=".repeat(78));

let shown = 0;
for (const r of results) {
  if (r.section) { console.log("\n  " + r.section + "\n  " + "-".repeat(r.section.length)); continue; }
  // Passing per-record lines are summarised rather than printed 21 times over.
  if (r.ok && r.label.startsWith("  ")) { shown++; continue; }
  console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.label}`);
  if (r.detail) console.log(`          ${r.detail}`);
}
console.log(`\n  (${shown} per-record type assertions passed and are not listed individually)`);

const total = results.filter((r) => !r.section).length;
console.log("\n" + "=".repeat(78));
console.log(failures === 0
  ? `  PASS — ${total} round-trip assertions, 0 problems`
  : `  FAIL — ${failures} of ${total} round-trip assertions`);
console.log("=".repeat(78) + "\n");
process.exit(failures === 0 ? 0 : 1);
