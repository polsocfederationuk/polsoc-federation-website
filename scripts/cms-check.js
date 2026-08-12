#!/usr/bin/env node
/**
 * cms-check.js — content integrity after CMS editing, in editor language.
 *
 * `npm run validate` already rejects every problem found here, but it reports as
 * a build validator: 1126 checks, and the failure says what rule broke rather
 * than what to do about it. This says which file, what is wrong with it, and what
 * to do next — so it can be run straight after a CMS session by somebody who does
 * not read the validator.
 *
 * It is deliberately READ-ONLY. Nothing is renamed, rewritten or deleted:
 * recovering from a collision means deciding which record was meant, and that is
 * an editorial decision, not one a script should take.
 *
 * Run:  npm run cms:check
 */

"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.join(__dirname, "..");
const cms = require(path.join(ROOT, "src", "_data", "cmsConfig.js"));

const config = cms.buildConfig();
const team = config.collections.find((c) => c.name === "team");
const TEAM_DIR = team.folder;
const EXT = team.extension;
const ID_RE = new RegExp(team.fields.find((f) => f.name === "slug").pattern[0]);

const problems = [];
const notes = [];

function problem(file, what, detail, action) {
  problems.push({ file, what, detail, action });
}

/* -- load ------------------------------------------------------------------ */

const dir = path.join(ROOT, TEAM_DIR);
if (!fs.existsSync(dir)) {
  console.error(`cms:check — ${TEAM_DIR} does not exist`);
  process.exit(1);
}

const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)).sort();
const records = files.map((file) => {
  let data = null;
  let parseError = null;
  try {
    data = yaml.load(fs.readFileSync(path.join(dir, file), "utf8")) || {};
  } catch (e) {
    parseError = e.message.split("\n")[0];
  }
  return { file, rel: `${TEAM_DIR}/${file}`, data, parseError };
});

for (const r of records) {
  if (r.parseError) {
    problem(r.rel, "the file is not valid YAML", r.parseError,
      "Open it and fix the syntax, or restore it with `git checkout -- " + r.rel + "`.");
  }
}

const ok = records.filter((r) => !r.parseError);

/* -- 1. filename vs stored slug -------------------------------------------- */
/* This is the Decap collision signature. When an editor reuses an existing
 * Record ID, Decap does not overwrite the other record — it writes
 * `<slug>-1.yaml` and leaves `slug: <slug>` inside. The data is safe; the
 * record's identity is not. */

for (const r of ok) {
  const stored = r.data.slug;
  const expected = `${stored}.${EXT}`;
  if (stored === undefined) {
    problem(r.rel, "no Record ID is stored", "the `slug` field is missing",
      `Add "slug: ${r.file.replace(/\.ya?ml$/i, "")}" to the file, or set the Record ID in the CMS.`);
    continue;
  }
  if (r.file === expected) continue;

  // Distinguish the -1 collision artefact from a plain mismatch, because the
  // remedy differs: one has a conflicting record to reconcile, the other does not.
  const collision = new RegExp(`^${stored.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+\\.${EXT}$`)
    .test(r.file);
  const conflictExists = files.includes(expected);

  if (collision && conflictExists) {
    problem(r.rel,
      "this looks like a duplicate-ID collision",
      `stored Record ID "${stored}" — but that ID already belongs to ${TEAM_DIR}/${expected}`,
      `Decide which record this is. If it is a DIFFERENT annual membership, change its ` +
      `Record ID to something unique (for example "${stored}-2026-27") and rename the file ` +
      `to match. If it was created by mistake, delete ${r.rel}. ` +
      `${TEAM_DIR}/${expected} has not been modified.`);
  } else {
    problem(r.rel,
      "the filename and the stored Record ID disagree",
      `file "${r.file}" vs slug "${stored}" (expected ${expected})`,
      conflictExists
        ? `${TEAM_DIR}/${expected} already exists, so choose a different Record ID for this record.`
        : `Rename the file to ${expected}, or change the stored Record ID to "${r.file.replace(/\.ya?ml$/i, "")}".`);
  }
}

/* -- 2. duplicate stored slugs --------------------------------------------- */

{
  const bySlug = new Map();
  for (const r of ok) {
    if (r.data.slug === undefined) continue;
    if (!bySlug.has(r.data.slug)) bySlug.set(r.data.slug, []);
    bySlug.get(r.data.slug).push(r);
  }
  for (const [slug, group] of bySlug) {
    if (group.length < 2) continue;
    problem(group.map((g) => g.rel).join(" + "),
      "two records claim the same Record ID",
      `Record ID "${slug}" is stored in ${group.length} files: ${group.map((g) => g.file).join(", ")}`,
      `Record IDs must be unique. If these are different committee years, give one a ` +
      `year-suffixed ID such as "${slug}-2026-27" and rename its file to match.`);
  }
}

/* -- 3. Record ID format --------------------------------------------------- */

for (const r of ok) {
  const slug = r.data.slug;
  if (slug === undefined) continue;
  if (typeof slug !== "string" || !ID_RE.test(slug)) {
    problem(r.rel, "the Record ID is not filename-safe",
      `"${slug}" does not match ${ID_RE.source}`,
      "Use lowercase letters, numbers and single hyphens only — for example jane-example.");
  }
}

/* -- 4. photographs -------------------------------------------------------- */
/* Absent and null are both fine (docs/CMS_FOUNDATION.md §9). A value that is
 * present must be a real Team asset. */

for (const r of ok) {
  if (!("photo" in r.data) || r.data.photo === null) continue;
  const p = r.data.photo;
  if (typeof p !== "string") {
    problem(r.rel, "the photograph value is the wrong type",
      `${JSON.stringify(p)} (${typeof p})`,
      "Either select an image in the CMS, or remove the `photo` line entirely.");
    continue;
  }
  if (p.trim() === "") {
    problem(r.rel, "the photograph is an empty string",
      '`photo: ""` is neither a picture nor an absence',
      "Remove the `photo` line, or set it to null, or select an image in the CMS.");
    continue;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p) || p.startsWith("//")) {
    problem(r.rel, "the photograph is hotlinked from another site", p,
      "Download the image, add it to assets/team/, and select it in the CMS.");
    continue;
  }
  if (/^[A-Za-z]:[\\/]/.test(p) || p.includes("\\")) {
    problem(r.rel, "the photograph is a path on somebody's own computer", p,
      "That file does not exist for anyone else. Upload the image through the CMS instead.");
    continue;
  }
  if (p.startsWith("/pl/") || p.includes("/pl/assets/")) {
    problem(r.rel, "the photograph path is language-prefixed", p,
      "Team photographs are shared between both languages. Use /assets/team/… with no /pl/ prefix.");
    continue;
  }
  if (!p.startsWith("/assets/team/")) {
    problem(r.rel, "the photograph is not in the Team image folder", p,
      "Team photographs live in assets/team/ and are stored as /assets/team/<file>.");
    continue;
  }
  if (!fs.existsSync(path.join(ROOT, p.replace(/^\/+/, "")))) {
    problem(r.rel, "the photograph file is missing", `${p} does not exist on disk`,
      "Re-upload the image through the CMS, or clear the photograph field.");
  }
}

/* -- 5. annual identity ---------------------------------------------------- */
/* A repeated NAME is legitimate — that is precisely what a second term looks
 * like. A repeated (name, year) pair is not: it means one committee has the
 * same person twice. */

{
  const seen = new Map();
  for (const r of ok) {
    const key = `${String(r.data.name || "").trim().toLowerCase()}||${r.data.academic_year}`;
    if (!r.data.name || !r.data.academic_year) continue;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(r);
  }
  for (const [key, group] of seen) {
    if (group.length < 2) continue;
    const [name, year] = key.split("||");
    problem(group.map((g) => g.rel).join(" + "),
      "the same person appears twice in one academic year",
      `"${group[0].data.name}" has ${group.length} records for ${year}`,
      `A person holds one membership per committee year. If one of these belongs to a ` +
      `different year, correct its Academic year field. If it is a duplicate, delete it.`);
    void name;
  }

  // The healthy multi-year case, reported so the difference is visible.
  const byName = new Map();
  for (const r of ok) {
    const n = String(r.data.name || "").trim().toLowerCase();
    if (!n) continue;
    if (!byName.has(n)) byName.set(n, new Set());
    byName.get(n).add(r.data.academic_year);
  }
  for (const [n, years] of byName) {
    if (years.size > 1) {
      notes.push(`${n} serves in ${years.size} academic years (${[...years].sort().join(", ")}) — this is normal`);
    }
  }
}

/* -- 6. stray CMS test content --------------------------------------------- */

{
  const suspicious = files.filter((f) => /cms-test|cms-collision|cms-annual|cms-photo|test-person|dummy|delete-?me/i.test(f));
  if (suspicious.length) {
    problem(suspicious.map((f) => `${TEAM_DIR}/${f}`).join(", "),
      "test records are still in the repository",
      suspicious.join(", "),
      "Delete them before committing — they would otherwise be published as real committee members.");
  }
  const strayImages = fs.existsSync(path.join(ROOT, "assets", "team"))
    ? fs.readdirSync(path.join(ROOT, "assets", "team"))
      .filter((f) => /cms-test|cms-photo|dummy|delete-?me/i.test(f))
    : [];
  if (strayImages.length) {
    problem(`assets/team/${strayImages.join(", ")}`,
      "test images are still in the repository", strayImages.join(", "),
      "Delete them before committing.");
  }
}

/* -- output ---------------------------------------------------------------- */

console.log("\n" + "=".repeat(78));
console.log("  CMS CONTENT CHECK — Team records");
console.log("=".repeat(78));
console.log(`\n  ${files.length} record(s) in ${TEAM_DIR}\n`);

for (const n of notes) console.log(`  note  ${n}`);
if (notes.length) console.log("");

if (problems.length === 0) {
  console.log("  Nothing to fix. Every Team record has a unique, filename-safe Record ID,");
  console.log("  and every photograph is either absent or a real image in assets/team/.\n");
  console.log("=".repeat(78));
  console.log(`  PASS — ${files.length} records, 0 problems`);
  console.log("=".repeat(78) + "\n");
  process.exit(0);
}

for (const p of problems) {
  console.log("  " + "-".repeat(74));
  console.log(`  PROBLEM   ${p.what}`);
  console.log(`  file      ${p.file}`);
  console.log(`  detail    ${p.detail}`);
  console.log(`  do this   ${p.action}`);
}
console.log("  " + "-".repeat(74));
console.log("\n" + "=".repeat(78));
console.log(`  FAIL — ${problems.length} problem(s) in ${files.length} records`);
console.log("  Nothing was renamed, moved or deleted; fix these by hand.");
console.log("=".repeat(78) + "\n");
process.exit(1);
