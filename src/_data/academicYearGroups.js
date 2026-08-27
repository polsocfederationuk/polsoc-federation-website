/**
 * academicYearGroups.js — one way to split records into academic years.
 *
 * Events, Team and Announcements all now show every academic year they have,
 * newest first, each in its own collapsible section with the current year open.
 * That is one behaviour, so it is one function: three slightly different
 * implementations would drift, and the first symptom would be two pages
 * disagreeing about which year is current.
 *
 * WHAT "CURRENT" MEANS, AND WHAT IT DOES NOT
 *
 * The current year comes from content/settings/academic-year.yaml and decides
 * exactly one thing here: which section is open when the page loads. It is NOT
 * derived from the content. A 2026/27 record appearing early does not make
 * 2026/27 current — it appears as its own collapsed section, above the open
 * one, and stays there until somebody changes the setting.
 *
 * That separation is the point. Publishing next year's committee early is a
 * normal thing to want to do; deciding that the new year has begun is an
 * editorial act, and it happens in one place.
 *
 * A year with no records produces no section, except the current year, which is
 * always present so a page never looks broken during a changeover.
 */

"use strict";

const { parseAcademicYear, formatAcademicYear } = require("./academicYear");

/**
 * Split records into academic-year groups, newest first.
 *
 * @param {Array} records     anything carrying `academic_year`
 * @param {string} currentYear  e.g. "2025/26", from the central setting
 * @param {object} [options]
 * @param {(record: any) => boolean} [options.visible]  which records count
 * @param {(a: any, b: any) => number} [options.sort]   order inside a year
 * @returns {Array<{academicYear: string, label: string, start: number,
 *                  isCurrent: boolean, records: Array}>}
 */
function groupByAcademicYear(records, currentYear, options) {
  const { visible, sort } = options || {};
  const currentStart = parseAcademicYear(currentYear);
  if (currentStart === null) {
    throw new Error(
      `invalid current academic year: ${JSON.stringify(currentYear)} (expected "YYYY/YY")`);
  }

  const buckets = new Map();
  const problems = [];

  for (const record of records || []) {
    if (!record) continue;
    if (visible && !visible(record)) continue;

    const start = parseAcademicYear(record.academic_year);
    if (start === null) {
      /*
        The FORMAT is still an error — it always was, and it is the one thing
        that genuinely cannot be placed. A year that simply has not started yet
        is fine; a year that is not a year is not.
      */
      problems.push(`${record.slug || "(no slug)"}: invalid academic_year ` +
        `${JSON.stringify(record.academic_year)} (expected "YYYY/YY")`);
      continue;
    }
    if (!buckets.has(start)) {
      buckets.set(start, { academicYear: record.academic_year, records: [] });
    }
    buckets.get(start).records.push(record);
  }

  if (problems.length) {
    throw new Error("academic-year grouping failed:\n  - " + problems.join("\n  - "));
  }

  /*
    THE CURRENT YEAR ALWAYS HAS A SECTION.

    Between one committee leaving and the next being entered, or in the days
    after the setting moves on, the current year can legitimately hold nothing.
    An empty section that says so reads better than a page whose newest heading
    is last year.
  */
  if (!buckets.has(currentStart)) {
    buckets.set(currentStart, { academicYear: currentYear, records: [] });
  }

  return [...buckets.keys()]
    .sort((a, b) => b - a)                       // newest first, future included
    .map((start) => {
      const bucket = buckets.get(start);
      const ordered = sort ? [...bucket.records].sort(sort) : bucket.records;
      return {
        academicYear: bucket.academicYear,
        label: formatAcademicYear(start),
        start,
        isCurrent: start === currentStart,
        records: ordered,
      };
    });
}

module.exports = { groupByAcademicYear };
