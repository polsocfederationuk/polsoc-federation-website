/**
 * Date-only normalisation for content records.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The canonical content files quote their dates (`start_date: "2025-12-08"`), so
 * YAML yields a string. Decap re-serialises with `yaml`@1, whose YAML 1.2 core
 * schema treats a bare 2025-12-08 as an ordinary string and writes it WITHOUT
 * quotes. js-yaml's default schema still carries YAML 1.1 timestamps and reads
 * that same line back as a Date — and a Date stringifies in the machine's local
 * zone. On a machine in Warsaw the Christmas Dinner rendered as
 * "Mon Dec 08 2025 01:00:00 GMT+0100 (Central European Standard Time)" and the
 * page's structured data disappeared entirely.
 *
 * WHY IT LIVES IN ITS OWN MODULE
 * ------------------------------
 * Several data files load event and announcement YAML independently —
 * records.js, standardEventPages.js, eventListing.js — and each one spreads the
 * parsed object straight into what the templates receive. Normalising in only
 * one of them fixes only the pages that happen to use it, which is exactly how
 * this defect survived its first fix. One helper, applied wherever a record is
 * built, is the shape that does not rot.
 *
 * A Date carrying a real TIME component is deliberately left alone: that is a
 * genuine loss of date-only meaning, and scripts/validate.js rejects it by name
 * rather than having it silently rounded here.
 */

"use strict";

/** A midnight-UTC Date becomes "YYYY-MM-DD"; anything else is returned as-is. */
function dateOnly(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return value;
  const midnightUTC =
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0;
  // UTC components, never local ones — that is the whole point.
  return midnightUTC ? value.toISOString().slice(0, 10) : value;
}

/** Normalise every date-only field a record may carry. Mutates and returns it. */
function normaliseRecordDates(record) {
  if (!record || typeof record !== "object") return record;
  for (const field of ["start_date", "end_date", "published_date"]) {
    if (field in record) record[field] = dateOnly(record[field]);
  }
  return record;
}

module.exports = { dateOnly, normaliseRecordDates };
