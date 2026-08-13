/**
 * Loads structured content records from /content into Eleventy's data cascade.
 *
 * Exposed to templates as `records.<collection>`, e.g. `records.buildTest`.
 *
 * Named `records` rather than `content` on purpose: inside an Eleventy layout,
 * `{{ content }}` already means "the rendered child template". A global data
 * file called `content` would shadow it and produce very confusing bugs.
 *
 * PHASE 2: only `build-test` holds anything. The other collections are empty
 * directories awaiting migration — see docs/BUILD_ARCHITECTURE.md §21 for the
 * order in which they will be filled.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const CONTENT_DIR = path.join(__dirname, "..", "..", "content");

// Directory name -> template-facing key.
const COLLECTIONS = {
  "build-test": "buildTest",
  events: "events",
  announcements: "announcements",
  team: "team",
  societies: "societies",
  settings: "settings",
  // Single-instance page content (contact, 404). Not a list of like items the
  // way the collections above are, so it is also exposed keyed by slug below.
  pages: "pages",
};

const loadCollection = (dirName) => {
  const dir = path.join(CONTENT_DIR, dirName);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    // .sort() keeps the build deterministic: readdir order is filesystem
    // dependent, and an unstable order would make output differ between runs
    // and between machines.
    .sort()
    .filter((f) => /\.ya?ml$/i.test(f))
    .map((file) => {
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      const parsed = yaml.load(raw) || {};
      const record = {
        ...parsed,
        // Provenance, useful for error messages and for a future CMS.
        _source: `content/${dirName}/${file}`,
        // Fall back to the filename so every record has a slug even before the
        // field is filled in.
        slug: parsed.slug || file.replace(/\.ya?ml$/i, ""),
      };

      // "No date shift" — the announcement publication date.
      //
      // The canonical files quote it (`published_date: "2025-10-26"`) so YAML
      // reads a string. Decap re-serialises with `yaml`@1, which follows the
      // YAML 1.2 core schema, considers a bare 2025-10-26 an ordinary string and
      // writes it WITHOUT quotes. js-yaml's default schema still carries YAML
      // 1.1 timestamps, so it reads that same line back as a Date — and a Date
      // stringifies in the machine's local zone, which is exactly the
      // non-determinism the isoDate filter exists to prevent. On a machine in
      // Warsaw it can render the previous calendar day.
      //
      // Converting through UTC components restores the identical string, so both
      // spellings mean one date and the build cannot drift. A Date carrying a
      // real time component is left alone: that is a genuine loss of date-only
      // meaning, and scripts/validate.js rejects it by name rather than having it
      // silently rounded here. See docs/CMS_ANNOUNCEMENTS.md §6.
      if (dirName === "announcements" && record.published_date instanceof Date) {
        const d = record.published_date;
        if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 &&
            d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) {
          record.published_date = d.toISOString().slice(0, 10);
        }
      }

      // "No photograph" has two spellings on disk and one meaning.
      //
      // A hand-written record says `photo: null`. Decap omits the key entirely
      // when an editor selects no image — it has no way to write an explicit
      // null, which Phase 17A verified directly. Both mean the same thing, so
      // the distinction is normalised away here, at the one boundary where
      // records enter the build, rather than in every template that touches a
      // photograph.
      //
      // This does not touch the YAML: the file keeps whichever form it has, and
      // no record is rewritten to match the other. See docs/CMS_FOUNDATION.md §9.
      if (dirName === "team" && record.photo === undefined) record.photo = null;

      // The same absent-or-null equivalence for announcements. Every canonical
      // record spells "nothing here" as an explicit null (or an empty list);
      // Decap omits an optional field that an editor left empty. Both mean the
      // same thing, and normalising here keeps that difference out of every
      // template and filter downstream. No file is rewritten either way.
      if (dirName === "announcements") {
        for (const key of ["image", "image_position", "image_fit", "image_background", "link"]) {
          if (record[key] === undefined) record[key] = null;
        }
        if (record.extra_images === undefined) record.extra_images = [];
      }

      return record;
    });
};

module.exports = () => {
  const out = {};
  for (const [dirName, key] of Object.entries(COLLECTIONS)) {
    out[key] = loadCollection(dirName);
  }

  // `settings` is configuration, not a list of content items, so it is also
  // exposed keyed by filename for direct lookup:
  //   records.settings.academicYear.current
  //   records.settings.teamGroups.groups
  out.settings = out.settings.reduce((acc, rec) => {
    const stem = path.basename(rec._source, path.extname(rec._source));
    const key = stem.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    acc[key] = rec;
    return acc;
  }, {});

  // Single-instance page content is looked up by slug, not iterated:
  //   records.pages.contact.contact_email
  //   records.pages["404"].en.heading_lead
  // The array form stays available as `records.pagesList` for the validator,
  // which needs to count records and spot duplicates.
  out.pagesList = out.pages;
  out.pages = out.pages.reduce((acc, rec) => {
    acc[String(rec.slug)] = rec;
    return acc;
  }, {});

  return out;
};
