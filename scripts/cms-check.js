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

/* ===========================================================================
   ANNOUNCEMENTS
   =========================================================================== */

const annCollection = config.collections.find((c) => c.name === "announcements");
const ANN_DIR = annCollection.folder;
const ANN_EXT = annCollection.extension;
const ANN_ID_RE = new RegExp(annCollection.fields.find((f) => f.name === "slug").pattern[0]);
const ANN_ASSETS = "assets/announcements";

/** Canonical event slugs — what an announcement's event link may point at. */
const eventSlugs = (() => {
  const dir = path.join(ROOT, "content", "events");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f))
    .map((f) => {
      try { return (yaml.load(fs.readFileSync(path.join(dir, f), "utf8")) || {}).slug; }
      catch { return null; }
    })
    .filter(Boolean);
})();

const annDir = path.join(ROOT, ANN_DIR);
const annFiles = fs.existsSync(annDir)
  ? fs.readdirSync(annDir).filter((f) => /\.ya?ml$/i.test(f)).sort()
  : [];

const annRecords = annFiles.map((file) => {
  let data = null;
  let parseError = null;
  try {
    data = yaml.load(fs.readFileSync(path.join(annDir, file), "utf8")) || {};
  } catch (e) {
    parseError = e.message.split("\n")[0];
  }
  return { file, rel: `${ANN_DIR}/${file}`, data, parseError };
});

for (const r of annRecords) {
  if (r.parseError) {
    problem(r.rel, "the file is not valid YAML", r.parseError,
      `Fix the syntax, or restore it with \`git checkout -- ${r.rel}\`.`);
  }
}
const annOk = annRecords.filter((r) => !r.parseError);

/* -- A1. Record ID, filename, duplicates ----------------------------------- */

for (const r of annOk) {
  const stored = r.data.slug;
  if (stored === undefined) {
    problem(r.rel, "no Record ID is stored", "the `slug` field is missing",
      `Add "slug: ${r.file.replace(/\.ya?ml$/i, "")}" to the file, or set the Record ID in the CMS.`);
    continue;
  }
  if (typeof stored !== "string" || !ANN_ID_RE.test(stored)) {
    problem(r.rel, "the Record ID is not filename-safe",
      `"${stored}" does not match ${ANN_ID_RE.source}`,
      "Use lowercase letters, numbers and single hyphens only.");
    continue;
  }
  const expected = `${stored}.${ANN_EXT}`;
  if (r.file === expected) continue;

  const collision = new RegExp(`^${stored.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+\\.${ANN_EXT}$`).test(r.file);
  const conflictExists = annFiles.includes(expected);
  if (collision && conflictExists) {
    problem(r.rel, "this looks like a duplicate-ID collision",
      `stored Record ID "${stored}" — but that ID already belongs to ${ANN_DIR}/${expected}`,
      `Decide which announcement this is. If it is a DIFFERENT one, give it a unique ` +
      `Record ID (for example "${stored}-2026-27") and rename the file to match. If it was ` +
      `created by mistake, delete ${r.rel}. ${ANN_DIR}/${expected} has not been modified.`);
  } else {
    problem(r.rel, "the filename and the stored Record ID disagree",
      `file "${r.file}" vs slug "${stored}" (expected ${expected})`,
      conflictExists
        ? `${ANN_DIR}/${expected} already exists, so choose a different Record ID.`
        : `Rename the file to ${expected}, or change the Record ID to "${r.file.replace(/\.ya?ml$/i, "")}".`);
  }
}

{
  const bySlug = new Map();
  for (const r of annOk) {
    if (r.data.slug === undefined) continue;
    if (!bySlug.has(r.data.slug)) bySlug.set(r.data.slug, []);
    bySlug.get(r.data.slug).push(r);
  }
  for (const [slug, group] of bySlug) {
    if (group.length < 2) continue;
    problem(group.map((g) => g.rel).join(" + "), "two announcements claim the same Record ID",
      `Record ID "${slug}" is stored in ${group.length} files: ${group.map((g) => g.file).join(", ")}`,
      `Record IDs must be unique. Give one a different ID and rename its file to match.`);
  }
}

/* -- A2. Academic year and same-year ordering ------------------------------ */

const AY_RE = /^(\d{4})\/(\d{2})$/;
for (const r of annOk) {
  const y = r.data.academic_year;
  const m = AY_RE.exec(String(y));
  if (!m) {
    problem(r.rel, "the academic year is malformed", `"${y}"`,
      'Use the form 2025/26 — four digits, a slash, then the following year\'s last two digits.');
  } else if (m[2] !== String((Number(m[1]) + 1) % 100).padStart(2, "0")) {
    problem(r.rel, "the academic year does not span consecutive years", `"${y}"`,
      `The second half must be the year after the first — ${m[1]}/${String((Number(m[1]) + 1) % 100).padStart(2, "0")}.`);
  }
}

{
  // Ordering is scoped to (academic year, published). The same position in a
  // different year is correct and must not be reported.
  const byYear = new Map();
  for (const r of annOk) {
    if (r.data.published !== true) continue;
    const y = r.data.academic_year;
    if (!y) continue;
    if (!byYear.has(y)) byYear.set(y, new Map());
    const orders = byYear.get(y);
    if (!orders.has(r.data.order)) orders.set(r.data.order, []);
    orders.get(r.data.order).push(r);
  }
  for (const [year, orders] of byYear) {
    for (const [order, group] of orders) {
      if (group.length < 2) continue;
      problem(group.map((g) => g.rel).join(" + "),
        "two published announcements share a display position in the same year",
        `position ${order} is used ${group.length} times in ${year}`,
        "Give each announcement in an academic year its own position. Positions restart " +
        "at 1 for every year, so a clash with a different year is not a problem.");
    }
  }
  for (const [year, orders] of byYear) {
    notes.push(`${year}: ${[...orders.keys()].length} published announcement position(s)`);
  }
}

/* -- A3. Publication date --------------------------------------------------- */

for (const r of annOk) {
  const d = r.data.published_date;
  let iso = null;
  if (typeof d === "string") iso = d;
  else if (d instanceof Date && !Number.isNaN(d.getTime())) {
    const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 &&
      d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
    if (midnight) iso = d.toISOString().slice(0, 10);
    else {
      problem(r.rel, "the publication date carries a time", d.toISOString(),
        "Announcement dates are calendar days only. Set it to the form 2026-05-14.");
      continue;
    }
  }
  if (iso === null || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    problem(r.rel, "the publication date is not a calendar date", JSON.stringify(d),
      "Use the form 2026-05-14 (year-month-day).");
  }
}

/* -- A4. Media -------------------------------------------------------------- */

function checkAnnouncementImage(r, value, label) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string") {
    problem(r.rel, `${label} is the wrong type`, `${JSON.stringify(value)} (${typeof value})`,
      "Choose an image in the CMS, or remove the field.");
    return;
  }
  if (value.trim() === "") {
    problem(r.rel, `${label} is an empty string`, "neither a picture nor an absence",
      "Remove the field, set it to null, or choose an image.");
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith("//")) {
    problem(r.rel, `${label} is hotlinked from another site`, value,
      `Download the image, add it to ${ANN_ASSETS}/, and choose it in the CMS.`);
    return;
  }
  if (/^[A-Za-z]:[\\/]/.test(value) || value.includes("\\")) {
    problem(r.rel, `${label} is a path on somebody's own computer`, value,
      "That file does not exist for anyone else. Upload the image through the CMS.");
    return;
  }
  if (value.startsWith("/pl/") || value.includes("/pl/assets/")) {
    problem(r.rel, `${label} is language-prefixed`, value,
      `Announcement images are shared between both languages. Use /${ANN_ASSETS}/… with no /pl/ prefix.`);
    return;
  }
  // Any folder under /assets/ is legitimate, not only assets/announcements/.
  // Several real announcements reuse event imagery — /assets/pbf/stage.jpg,
  // /assets/debata/networking.jpg — and requiring one folder would make those
  // records uneditable. New uploads still land in assets/announcements/, which
  // is what the CMS's media_folder controls.
  if (!value.startsWith("/assets/")) {
    problem(r.rel, `${label} is not a site asset`, value,
      "Announcement images are stored as /assets/…, for example " +
      `/${ANN_ASSETS}/<file> for a new upload.`);
    return;
  }
  if (!fs.existsSync(path.join(ROOT, value.replace(/^\/+/, "")))) {
    problem(r.rel, `${label} is missing`, `${value} does not exist on disk`,
      "Re-upload the image through the CMS, or clear the field.");
  }
}

for (const r of annOk) {
  checkAnnouncementImage(r, r.data.image, "the main image");
  const extra = r.data.extra_images;
  if (extra !== undefined && extra !== null && !Array.isArray(extra)) {
    problem(r.rel, "extra images is not a list", JSON.stringify(extra),
      "Extra images must be a list of image paths.");
  } else {
    for (const [i, x] of (extra || []).entries()) {
      checkAnnouncementImage(r, x, `extra image ${i + 1}`);
    }
  }
  // Presentation fields.
  const fit = r.data.image_fit;
  const validFit = annCollection.fields.find((f) => f.name === "image_fit").options.map((o) => o.value);
  if (fit !== undefined && fit !== null && !validFit.includes(fit)) {
    problem(r.rel, "the image fit is not a supported value", JSON.stringify(fit),
      `Supported values: ${validFit.join(", ")}, or leave it empty.`);
  }
  const bg = r.data.image_background;
  if (bg !== undefined && bg !== null && !/^#[0-9a-fA-F]{6}$/.test(String(bg))) {
    problem(r.rel, "the image backdrop is not a hex colour", JSON.stringify(bg),
      "Use a six-digit hex colour such as #001f62, or leave it empty.");
  }
}

/* -- A5. Destination links -------------------------------------------------- */

// The types a FILE may contain — deliberately not the list the CMS offers.
// The form also offers an editor-only "none", which the pre-save normaliser
// turns into `link: null`; a file that still says `type: none` means that
// normalisation did not run, which is a fault worth naming rather than
// accepting because the dropdown happened to include the word.
const validLinkTypes = cms.SUPPORTED_LINK_TYPES;
const editorOnlyType = cms.LINK_TYPE_NONE;

for (const r of annOk) {
  const link = r.data.link;
  if (link === undefined || link === null) continue;
  if (typeof link !== "object" || Array.isArray(link)) {
    problem(r.rel, "the destination link is malformed", JSON.stringify(link),
      "A link is a type plus either a Federation event or an external address.");
    continue;
  }
  const { type } = link;
  if (type === editorOnlyType) {
    problem(r.rel, `the link type is not supported ("${editorOnlyType}" is editor-only)`,
      `"${editorOnlyType}" should have become \`link: null\` when the announcement was saved`,
      "Open the announcement in the CMS, confirm the destination is No link, and save " +
      "again. If it persists, the pre-save normalisation is not running.");
    continue;
  }
  if (!validLinkTypes.includes(type)) {
    problem(r.rel, "the link type is not supported", JSON.stringify(type),
      `Supported types: ${validLinkTypes.join(", ")}.`);
    continue;
  }
  if (type === "event") {
    if (!link.event_slug) {
      problem(r.rel, "the event link names no event", "`event_slug` is missing",
        "Choose a Federation event, or change the link type.");
    } else if (!eventSlugs.includes(link.event_slug)) {
      problem(r.rel, `event slug "${link.event_slug}" does not exist`,
        `no record in content/events/ has that slug (available: ${eventSlugs.join(", ")})`,
        "Choose an existing Federation event or remove the event link.");
    }
    if (link.url) {
      problem(r.rel, "the event link also carries an external address", String(link.url),
        "An announcement links to one destination. Clear the external address.");
    }
  }
  if (type === "external") {
    const url = String(link.url || "");
    if (!link.url) {
      problem(r.rel, "the external link has no address", "`url` is missing",
        "Enter a full https:// address, or change the link type.");
    } else if (/^(javascript|data|file|vbscript):/i.test(url)) {
      problem(r.rel, "the external address uses an unsafe scheme", url,
        "Only https:// addresses are accepted. This value would be rendered into the page.");
    } else if (!/^https:\/\/[^\s"'<>]+$/.test(url)) {
      problem(r.rel, "the external address is not a valid https:// URL", url,
        "Use a full address beginning with https://");
    }
    if (link.event_slug) {
      problem(r.rel, "the external link also names a Federation event", String(link.event_slug),
        "An announcement links to one destination. Clear the event.");
    }
  }
  // A link with no label renders a button with no words on it.
  for (const loc of ["en", "pl"]) {
    if (!(r.data[loc] && r.data[loc].link_label)) {
      problem(r.rel, `the ${loc === "en" ? "English" : "Polish"} button has no label`,
        `${loc}.link_label is empty but a destination link is set`,
        "Add a short button label in both languages, e.g. Read more / Czytaj więcej.");
    }
  }
}

/* -- A6. Bilingual completeness --------------------------------------------- */

for (const r of annOk) {
  for (const loc of ["en", "pl"]) {
    const block = r.data[loc];
    if (!block || typeof block !== "object") {
      problem(r.rel, `the ${loc === "en" ? "English" : "Polish"} content is missing`,
        `\`${loc}\` is absent`, "Both languages are required for every announcement.");
      continue;
    }
    for (const f of ["title", "subtitle", "body"]) {
      if (!block[f] || String(block[f]).trim() === "") {
        problem(r.rel, `${loc}.${f} is empty`, `every announcement needs a ${f} in both languages`,
          `Fill in the ${loc === "en" ? "English" : "Polish"} ${f}.`);
      }
    }
    // The body is Markdown and is rendered with raw HTML disabled; a stored tag
    // would appear as literal text on the page.
    if (block.body && /<[a-z][^>]*>/i.test(String(block.body))) {
      problem(r.rel, `${loc}.body contains HTML`,
        String(block.body).match(/<[a-z][^>]*>/i)[0],
        "Announcement bodies are Markdown. HTML is not rendered and will show as " +
        "literal text — use **bold**, *italic* and [link](https://…) instead.");
    }
  }
}

/* -- A7. Publication state -------------------------------------------------- */

for (const r of annOk) {
  if (typeof r.data.published !== "boolean") {
    problem(r.rel, "the published flag is not a true/false value", JSON.stringify(r.data.published),
      "Set the Published toggle in the CMS.");
  }
  /*
    Registration replaced the old on/off switch in Phase 17C.3. Reported in the
    editor's own words, like everything else in this file — an editor reading
    this has a form in front of them, not a YAML file.
  */
  const reg = r.data.registration;
  const STATES = ["none", "coming_soon", "open", "closed"];
  const STATE_WORDS = {
    none: "No registration", coming_soon: "Coming soon", open: "Open", closed: "Closed",
  };
  if (reg !== undefined && reg !== null) {
    if (typeof reg !== "object" || Array.isArray(reg)) {
      problem(r.rel, "the Registration section is not filled in properly",
        JSON.stringify(reg), "Open the record and set the Registration status.");
    } else {
      if (reg.state !== undefined && STATES.indexOf(reg.state) === -1) {
        problem(r.rel, "the Registration status is not one the website understands",
          JSON.stringify(reg.state),
          `Choose one of: ${STATES.map((s) => STATE_WORDS[s]).join(", ")}.`);
      }
      if (reg.state === "open" && !reg.url) {
        problem(r.rel, "Registration is Open but there is no address to sign up at", null,
          "Add the registration web address, or set the status to Coming soon.");
      }
      if (reg.state !== "open" && reg.url) {
        problem(r.rel, "a sign-up address is stored on a record that is not open for registration",
          JSON.stringify(reg.url),
          "Set the status to Open, or clear the registration web address.");
      }
      if (reg.opens_on && reg.closes_on && reg.opens_on > reg.closes_on) {
        problem(r.rel, "sign-ups close before they open",
          `${reg.opens_on} → ${reg.closes_on}`, "Check the two sign-up dates.");
      }
    }
  }
}

/* -- A8. Stray test content ------------------------------------------------- */

{
  const suspicious = annFiles.filter((f) => /cms-announcement|cms-careers|cms-test|cms-noimage|cms-event|cms-external|cms-extra|dummy|delete-?me/i.test(f));
  if (suspicious.length) {
    problem(suspicious.map((f) => `${ANN_DIR}/${f}`).join(", "),
      "test announcements are still in the repository", suspicious.join(", "),
      "Delete them before committing — they would otherwise be published as real news.");
  }
  const strayImages = fs.existsSync(path.join(ROOT, ANN_ASSETS))
    ? fs.readdirSync(path.join(ROOT, ANN_ASSETS))
      .filter((f) => /cms-test|cms-announcement|dummy|delete-?me/i.test(f))
    : [];
  if (strayImages.length) {
    problem(`${ANN_ASSETS}/${strayImages.join(", ")}`,
      "test images are still in the repository", strayImages.join(", "),
      "Delete them before committing.");
  }
}

/* ===========================================================================
   STANDARD EVENTS
   =========================================================================== */

const evCollection = config.collections.find((c) => c.name === "standard_events");
const EV_DIR = evCollection.folder;
const EV_EXT = evCollection.extension;
const EV_ID_RE = new RegExp(evCollection.fields.find((f) => f.name === "slug").pattern[0]);

const evDir = path.join(ROOT, EV_DIR);
const evFiles = fs.existsSync(evDir)
  ? fs.readdirSync(evDir).filter((f) => /\.ya?ml$/i.test(f)).sort()
  : [];

const evRecords = evFiles.map((file) => {
  let data = null;
  let parseError = null;
  try { data = yaml.load(fs.readFileSync(path.join(evDir, file), "utf8")) || {}; }
  catch (e) { parseError = e.message.split("\n")[0]; }
  return { file, rel: `${EV_DIR}/${file}`, data, parseError };
});

for (const r of evRecords) {
  if (r.parseError) {
    problem(r.rel, "the file is not valid YAML", r.parseError,
      `Fix the syntax, or restore it with \`git checkout -- ${r.rel}\`.`);
  }
}
const evOk = evRecords.filter((r) => !r.parseError);
const evStandard = evOk.filter((r) => r.data.event_family === cms.STANDARD_FAMILY);
const evForum = evOk.filter((r) => r.data.event_family === "polish-business-forum");

/* -- E1. families and templates -------------------------------------------- */

for (const r of evOk) {
  const fam = r.data.event_family;
  if (fam !== cms.STANDARD_FAMILY && fam !== "polish-business-forum") {
    problem(r.rel, "the event family is not recognised", JSON.stringify(fam),
      `Events are either "${cms.STANDARD_FAMILY}" or "polish-business-forum".`);
    continue;
  }
  const expectedTemplate = fam === cms.STANDARD_FAMILY ? cms.STANDARD_TEMPLATE : "business-forum";
  if (r.data.template !== expectedTemplate) {
    problem(r.rel, "the family and template disagree",
      `event_family "${fam}" with template "${r.data.template}"`,
      `A ${fam} event must use the ${expectedTemplate} template. This pair decides ` +
      "which page design renders the event and is not an editorial choice.");
  }
}

/* -- E2. identity ----------------------------------------------------------- */

for (const r of evOk) {
  const stored = r.data.slug;
  if (stored === undefined) {
    problem(r.rel, "no Record ID is stored", "the `slug` field is missing",
      `Add "slug: ${r.file.replace(/\.ya?ml$/i, "")}" to the file.`);
    continue;
  }
  if (typeof stored !== "string" || !EV_ID_RE.test(stored)) {
    problem(r.rel, "the Record ID is not filename-safe",
      `"${stored}" does not match ${EV_ID_RE.source}`,
      "Use lowercase letters, numbers and single hyphens only.");
    continue;
  }
  const expected = `${stored}.${EV_EXT}`;
  if (r.file === expected) continue;
  const collision = new RegExp(`^${stored.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+\\.${EV_EXT}$`).test(r.file);
  const conflict = evFiles.includes(expected);
  problem(r.rel,
    collision && conflict ? "this looks like a duplicate-ID collision"
      : "the filename and the stored Record ID disagree",
    `file "${r.file}" vs slug "${stored}"`,
    collision && conflict
      ? `That ID already belongs to ${EV_DIR}/${expected}. If this is a different ` +
        `edition, give it a year-qualified ID such as "${stored}-2026-27" and rename ` +
        `the file to match. ${EV_DIR}/${expected} has not been modified.`
      : `Rename the file to ${expected}, or change the Record ID to "${r.file.replace(/\.ya?ml$/i, "")}".`);
}
{
  const bySlug = new Map();
  for (const r of evOk) {
    if (r.data.slug === undefined) continue;
    if (!bySlug.has(r.data.slug)) bySlug.set(r.data.slug, []);
    bySlug.get(r.data.slug).push(r);
  }
  for (const [slug, group] of bySlug) {
    if (group.length < 2) continue;
    problem(group.map((g) => g.rel).join(" + "), "two events claim the same Record ID",
      `Record ID "${slug}" is stored in ${group.length} files`,
      "Record IDs must be unique. Give one a year-qualified ID and rename its file.");
  }
}

/* -- E3. academic years and year-scoped ordering ---------------------------- */

for (const r of evOk) {
  const m = AY_RE.exec(String(r.data.academic_year));
  if (!m) {
    problem(r.rel, "the academic year is malformed", JSON.stringify(r.data.academic_year),
      "Use the form 2025/26.");
  } else if (m[2] !== String((Number(m[1]) + 1) % 100).padStart(2, "0")) {
    problem(r.rel, "the academic year does not span consecutive years",
      JSON.stringify(r.data.academic_year),
      `The second half must be the year after the first — ${m[1]}/${String((Number(m[1]) + 1) % 100).padStart(2, "0")}.`);
  }
}
{
  const byYear = new Map();
  for (const r of evStandard) {
    if (r.data.published !== true) continue;
    const y = r.data.academic_year;
    if (!y) continue;
    if (!byYear.has(y)) byYear.set(y, new Map());
    const o = byYear.get(y);
    const day = String(r.data.start_date || "");
    if (!o.has(day)) o.set(day, []);
    o.get(day).push(r);
  }
  /*
    THE POSITION-CLASH RULE IS GONE (Phase 17C.5A).

    It used to tell an editor that two events shared a position and ask them to
    renumber. Events are now shown newest first by date, so there is no position
    to clash and nothing to renumber — and a check that asks somebody to maintain
    a value the site ignores is worse than no check. Two events on one day is
    ordinary and fine.

    The count is still reported, because knowing how many published events a year
    holds is useful when reviewing a season.
  */
  for (const [year, days] of byYear) {
    const total = [...days.values()].reduce((n, g) => n + g.length, 0);
    notes.push(`${year}: ${total} published standard event(s)`);
  }
}

/* -- E3b. published future-year events --------------------------------------- */
/* The CMS refuses to save this state, so reaching it means a file was edited by
 * hand. It is worth naming clearly because the consequence is a FATAL build —
 * which also takes `npm run cms:serve` down, leaving no way back in through the
 * CMS. */

{
  const current = cms.currentAcademicYear();
  for (const r of evStandard) {
    const problem = cms.futurePublishProblem(r.data, current);
    if (!problem) continue;
    problem_future(r, problem);
  }
  function problem_future(r, p) {
    problem(r.rel, "a future year's event is already published",
      `this event is ${p.eventYear} but the website's current academic year is ${p.currentYear}`,
      `Open it in the CMS and switch Published off, or change the current academic ` +
      `year to ${p.eventYear} in Site settings once the Federation is ready. ` +
      `Until then the events listing cannot build.`);
  }
}

/* -- E4. dates -------------------------------------------------------------- */

for (const r of evOk) {
  for (const field of ["start_date", "end_date"]) {
    const d = r.data[field];
    if (d === null || d === undefined) continue;
    if (d instanceof Date) {
      const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 &&
        d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
      if (!midnight) {
        problem(r.rel, `${field} carries a time`, d.toISOString(),
          "Event dates are calendar days only. Set it to the form 2026-02-10.");
      }
      continue;
    }
    if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      problem(r.rel, `${field} is not a calendar date`, JSON.stringify(d),
        "Use the form 2026-02-10 (year-month-day).");
    }
  }
}

/* -- E5. section alignment --------------------------------------------------- */

for (const r of evStandard) {
  const msg = cms.checkEventSectionAlignment(r.data);
  if (!msg) continue;
  problem(r.rel, "the section lists are out of alignment",
    msg.split("\n").filter(Boolean).slice(1, 5).join(" / "),
    "The English, Polish and shared section lists must describe the same sections " +
    "in the same order. Open the event in the CMS and correct the list that differs.");
}

/* -- E6. media and links ----------------------------------------------------- */

function checkEventAsset(r, value, label) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string") {
    problem(r.rel, `${label} is the wrong type`, `${JSON.stringify(value)} (${typeof value})`,
      "Choose an image in the CMS, or clear the field.");
    return;
  }
  if (value.trim() === "") {
    problem(r.rel, `${label} is an empty string`, "neither an image nor an absence",
      "Clear the field entirely, or choose an image.");
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith("//")) {
    problem(r.rel, `${label} is hotlinked from another site`, value,
      "Download the image, add it to assets/events/, and choose it in the CMS.");
    return;
  }
  if (/^[A-Za-z]:[\\/]/.test(value) || value.includes("\\")) {
    problem(r.rel, `${label} is a path on somebody's own computer`, value,
      "That file does not exist for anyone else. Upload it through the CMS.");
    return;
  }
  if (value.startsWith("/pl/") || value.includes("/pl/assets/")) {
    problem(r.rel, `${label} is language-prefixed`, value,
      "Event images are shared between both languages. Use /assets/… with no /pl/ prefix.");
    return;
  }
  if (!value.startsWith("/assets/")) {
    problem(r.rel, `${label} is not a site asset`, value,
      "Event images are stored as /assets/…, for example /assets/events/<file>.");
    return;
  }
  if (!fs.existsSync(path.join(ROOT, value.replace(/^\/+/, "")))) {
    problem(r.rel, `${label} is missing`, `${value} does not exist on disk`,
      "Re-upload the image through the CMS, or clear the field.");
  }
}

for (const r of evStandard) {
  checkEventAsset(r, r.data.card_image, "the card image");
  checkEventAsset(r, r.data.og_image, "the social sharing image");
  checkEventAsset(r, r.data.hero_image, "the hero image");
  for (const [i, s] of (r.data.sections || []).entries()) {
    for (const [k, img] of ((s || {}).images || []).entries()) {
      checkEventAsset(r, img && img.src, `gallery section ${i + 1}, image ${k + 1}`);
    }
  }
  for (const [i, co] of (r.data.co_organisers || []).entries()) {
    checkEventAsset(r, co && co.logo, `co-organiser ${i + 1} logo`);
    if (!(co && co.alt && co.alt.en && co.alt.pl)) {
      problem(r.rel, `co-organiser ${i + 1} is not named in both languages`,
        JSON.stringify(co && co.alt),
        "Every partner logo needs an organisation name in English and Polish.");
    }
  }
  for (const [label, url] of [["Instagram link", r.data.instagram_permalink],
    ["album link", r.data.album_url],
    ["registration link", (r.data.registration || {}).url]]) {
    if (!url) continue;
    const v = String(url);
    if (/^(javascript|data|file|vbscript):/i.test(v)) {
      problem(r.rel, `the ${label} uses an unsafe scheme`, v,
        "Only https:// addresses are accepted. This value is rendered into the page.");
    } else if (!/^https:\/\/[^\s"'<>]+$/.test(v)) {
      problem(r.rel, `the ${label} is not a valid https:// URL`, v,
        "Use a full address beginning with https://");
    }
  }
}

/* -- E7. bilingual completeness ---------------------------------------------- */

for (const r of evStandard) {
  for (const loc of ["en", "pl"]) {
    const b = r.data[loc];
    const label = loc === "en" ? "English" : "Polish";
    if (!b || typeof b !== "object") {
      problem(r.rel, `the ${label} content is missing`, `\`${loc}\` is absent`,
        "Both languages are required for every event.");
      continue;
    }
    for (const f of ["date_label", "venue_label", "hero_summary", "card_summary",
      "card_image_alt", "timeline_title", "timeline_summary", "seo_title",
      "seo_description", "og_image_alt", "schema_description"]) {
      if (!b[f] || String(b[f]).trim() === "") {
        problem(r.rel, `${loc}.${f} is empty`, `every event needs this in both languages`,
          `Fill in the ${label} value.`);
      }
    }
    if (!b.title_lead && !b.title_fancy) {
      problem(r.rel, `the ${label} title has no parts`, "title_lead and title_fancy are both empty",
        "An event needs at least the first part of its title.");
    }
  }
  const venue = r.data.venue || {};
  if (!(venue.name && venue.name.en && venue.name.pl)) {
    problem(r.rel, "the venue is not named in both languages", JSON.stringify(venue.name),
      "Give the venue's English and Polish names.");
  }
  if (!(venue.locality && venue.locality.en && venue.locality.pl)) {
    problem(r.rel, "the town is not named in both languages", JSON.stringify(venue.locality),
      "Give the town's English and Polish names, e.g. London / Londyn.");
  }
}

/* -- E8. stray test content --------------------------------------------------- */

{
  const suspicious = evFiles.filter((f) => /cms-standard|cms-event|cms-test|zz-|dummy|delete-?me/i.test(f));
  if (suspicious.length) {
    problem(suspicious.map((f) => `${EV_DIR}/${f}`).join(", "),
      "test events are still in the repository", suspicious.join(", "),
      "Delete them before committing — they would otherwise appear as real events.");
  }
}

/* -- output ---------------------------------------------------------------- */

console.log("\n" + "=".repeat(78));
console.log("  CMS CONTENT CHECK — Team, Announcements and Events");
console.log("=".repeat(78));
console.log(`\n  ${files.length} team record(s) in ${TEAM_DIR}`);
console.log(`  ${annFiles.length} announcement(s) in ${ANN_DIR}`);
console.log(`  ${evStandard.length} standard event(s) + ${evForum.length} Polish Business Forum in ${EV_DIR}\n`);

for (const n of notes) console.log(`  note  ${n}`);
if (notes.length) console.log("");

if (problems.length === 0) {
  console.log("  Nothing to fix.");
  console.log("    Team          — unique filename-safe Record IDs; every photograph absent");
  console.log("                    or a real image in assets/team/.");
  console.log("    Announcements — unique Record IDs; valid academic years; no repeated");
  console.log("                    position within a year; every event link resolves; every");
  console.log("                    image a real file under /assets/.");
  console.log("    Events        — standard family only; the three section lists aligned;");
  console.log("                    year-scoped positions; every image and link resolves.\n");
  console.log("=".repeat(78));
  console.log(`  PASS — ${files.length + annFiles.length + evFiles.length} records, 0 problems`);
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
console.log(`  FAIL — ${problems.length} problem(s) in ${files.length + annFiles.length + evFiles.length} records`);
console.log("  Nothing was renamed, moved or deleted; fix these by hand.");
console.log("=".repeat(78) + "\n");
process.exit(1);
