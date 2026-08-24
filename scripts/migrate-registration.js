#!/usr/bin/env node
/**
 * migrate-registration.js — replace `signups_closed` with a registration block.
 *
 * ONE-OFF, and written down rather than done by hand so the mapping can be read,
 * argued with, and re-run on a clean checkout.
 *
 * THE MAPPING, and why it is this and not something cleverer:
 *
 *   signups_closed: true   ->  registration.state: closed
 *   signups_closed: false  ->  registration.state: none
 *
 * Nothing else is inferred. In particular an EXTERNAL destination link is NOT
 * treated as a registration address. That temptation was checked against the
 * actual records before writing this: of the eight records with sign-ups closed,
 * six have no link at all and two link to a Federation event page. Not one of
 * them has an external link, so there is no evidence anywhere in the content
 * that "external link" ever meant "sign up here". Guessing otherwise would have
 * invented registration URLs for records that never had them.
 *
 * The destination link is left exactly as it is on every record. It answers a
 * different question — where to read more — and keeps doing so.
 *
 * VISIBLE OUTPUT IS UNCHANGED. `closed` renders the same wording it always has;
 * see the note in eleventy.config.js. The eight closed records produce
 * byte-identical HTML after this migration, which is what keeps
 * `npm run compare:announcements` green.
 *
 * Run:  node scripts/migrate-registration.js [--dry-run]
 */

"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "content", "announcements");
const DRY = process.argv.includes("--dry-run");

const files = fs.readdirSync(DIR).filter((f) => /\.ya?ml$/i.test(f)).sort();

let closed = 0;
let none = 0;
let skipped = 0;
const changes = [];

for (const file of files) {
  const full = path.join(DIR, file);
  const text = fs.readFileSync(full, "utf8");

  if (!/^signups_closed:/m.test(text)) {
    skipped++;
    continue;
  }

  const parsed = yaml.load(text) || {};
  const wasClosed = parsed.signups_closed === true;
  const state = wasClosed ? "closed" : "none";
  if (wasClosed) closed++; else none++;

  /*
    Rewritten as TEXT, not by re-serialising the parsed object.

    Re-dumping would reformat all 28 files — stripping the comments that explain
    the migration history, requoting every string and reordering keys — and bury
    a two-line semantic change in several hundred lines of noise. Replacing the
    one line in place keeps the diff readable and leaves every other byte alone.
  */
  const block = [
    "registration:",
    `  state: ${state}`,
    "  url: null",
    "  opens_on: null",
    "  closes_on: null",
  ].join("\n");

  const next = text.replace(/^signups_closed:[^\n]*$/m, block);

  if (next === text) {
    console.error(`  ! ${file}: signups_closed line did not rewrite`);
    process.exitCode = 1;
    continue;
  }

  changes.push({ file, state });
  if (!DRY) fs.writeFileSync(full, next);
}

console.log(`\n  ${DRY ? "Would migrate" : "Migrated"} ${changes.length} announcement(s)\n`);
console.log(`    signups_closed: true  -> registration.state: closed   ${closed}`);
console.log(`    signups_closed: false -> registration.state: none     ${none}`);
if (skipped) console.log(`    already migrated / no field                     ${skipped}`);

if (closed) {
  console.log("\n  Now closed:");
  for (const c of changes.filter((x) => x.state === "closed")) {
    console.log(`    ${c.file.replace(/\.ya?ml$/, "")}`);
  }
}
console.log("");
