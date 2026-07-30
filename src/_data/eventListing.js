/**
 * Academic-year grouping for the events listing.
 *
 * A PURE function of (records, currentYear). It never mutates its input, never
 * reads the filesystem order, and never infers ordering from dates, titles or
 * event family — the record's explicit `order` decides, scoped to its academic
 * year. That scoping is the point: the 2026/27 Icebreaker can be `order: 1`
 * without colliding with the 2025/26 Business Forum's `order: 1`.
 *
 * Exported as an Eleventy data file AND as a plain module, so
 * scripts/test-event-listing-groups.js can exercise the multi-year behaviour
 * with synthetic records — there is only one real academic year today, and
 * inventing fake public events to test archive UI would be worse than useless.
 *
 * Shape returned by group():
 *
 *   { current:  { academicYear, events: [...] },
 *     previous: [ { academicYear, events: [...] }, ... ] }   // newest first
 *
 * `current` is always present, even with zero events — the listing needs to
 * render its empty-season message rather than silently promoting last year.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

/** "2025/26" → 2025, and only if the second half really is the next year. */
function parseAcademicYear(value) {
  const m = /^(\d{4})\/(\d{2})$/.exec(String(value || ""));
  if (!m) return null;
  const start = Number(m[1]);
  // The trailing pair must be the last two digits of start + 1, so "2025/27"
  // and "2025/25" are rejected rather than silently sorted somewhere.
  const expected = String((start + 1) % 100).padStart(2, "0");
  return m[2] === expected ? start : null;
}

/**
 * Group published, listing-visible events by academic year.
 *
 * Throws on anything an editor could get wrong in a way that would silently
 * misplace an event: a malformed year, two events sharing an `order` within one
 * year, or an event published under a year LATER than the configured current
 * one. That last case is deliberately a failure, not a silent exclusion —
 * publishing next season's event before the site moves to that season is an
 * editorial mistake, and hiding it would leave the author wondering where their
 * event went. Bumping `current` in content/settings/academic-year.yaml is the
 * single, visible action that makes it appear.
 */
function group(records, currentYear) {
  const currentStart = parseAcademicYear(currentYear);
  if (currentStart === null) {
    throw new Error(`invalid current academic year: ${JSON.stringify(currentYear)} (expected "YYYY/YY")`);
  }

  const visible = (records || []).filter((e) => e && e.published === true && e.show_in_listing === true);

  const problems = [];
  const buckets = new Map();

  for (const event of visible) {
    const start = parseAcademicYear(event.academic_year);
    if (start === null) {
      problems.push(`${event.slug}: invalid academic_year ${JSON.stringify(event.academic_year)} (expected "YYYY/YY")`);
      continue;
    }
    if (start > currentStart) {
      problems.push(
        `${event.slug}: academic_year ${event.academic_year} is later than the configured current year ${currentYear} — `
        + "publish it once the current year moves on, or correct the record"
      );
      continue;
    }
    if (!Number.isInteger(event.order)) {
      problems.push(`${event.slug}: order must be an integer, got ${JSON.stringify(event.order)}`);
      continue;
    }
    if (!buckets.has(start)) buckets.set(start, { academicYear: event.academic_year, events: [] });
    buckets.get(start).events.push(event);
  }

  // `order` is unique WITHIN a year, not globally.
  for (const [, bucket] of buckets) {
    const orders = bucket.events.map((e) => e.order);
    const dupes = [...new Set(orders.filter((o, i) => orders.indexOf(o) !== i))];
    for (const d of dupes) {
      const clashing = bucket.events.filter((e) => e.order === d).map((e) => e.slug).sort();
      problems.push(`${bucket.academicYear}: order ${d} used by ${clashing.join(" and ")}`);
    }
  }

  if (problems.length) {
    throw new Error("event listing grouping failed:\n  - " + problems.join("\n  - "));
  }

  // Sort a COPY of each bucket; ties broken by slug so output never depends on
  // the order records happened to be read in.
  const sortEvents = (events) =>
    [...events].sort((a, b) => (a.order - b.order) || (String(a.slug) < String(b.slug) ? -1 : 1));

  const current = buckets.has(currentStart)
    ? { academicYear: buckets.get(currentStart).academicYear, events: sortEvents(buckets.get(currentStart).events) }
    : { academicYear: currentYear, events: [] };

  const previous = [...buckets.keys()]
    .filter((y) => y < currentStart)
    .sort((a, b) => b - a)                       // newest archived year first
    .map((y) => ({ academicYear: buckets.get(y).academicYear, events: sortEvents(buckets.get(y).events) }));

  return { current, previous };
}

/* ------------------------------------------------------------------ 11ty data */

const EVENTS_DIR = path.join(__dirname, "..", "..", "content", "events");
const SETTINGS = path.join(__dirname, "..", "..", "content", "settings", "academic-year.yaml");

function loadRecords() {
  if (!fs.existsSync(EVENTS_DIR)) return [];
  return fs
    .readdirSync(EVENTS_DIR)
    .sort()                                       // deterministic, then re-sorted by `order`
    .filter((f) => /\.ya?ml$/i.test(f))
    .map((f) => ({
      ...(yaml.load(fs.readFileSync(path.join(EVENTS_DIR, f), "utf8")) || {}),
      _source: `content/events/${f}`,
    }));
}

module.exports = () => {
  // ONE central current-year setting, shared with the team page. There is no
  // second listing-specific copy to drift from it.
  const settings = yaml.load(fs.readFileSync(SETTINGS, "utf8")) || {};
  return group(loadRecords(), settings.current);
};

// Exposed for scripts/test-event-listing-groups.js.
module.exports.group = group;
module.exports.parseAcademicYear = parseAcademicYear;
