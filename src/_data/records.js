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
      return {
        ...parsed,
        // Provenance, useful for error messages and for a future CMS.
        _source: `content/${dirName}/${file}`,
        // Fall back to the filename so every record has a slug even before the
        // field is filled in.
        slug: parsed.slug || file.replace(/\.ya?ml$/i, ""),
      };
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

  return out;
};
