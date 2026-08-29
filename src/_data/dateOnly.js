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
/**
 * The same rule, everywhere in a record — including inside nested blocks.
 *
 * WHY THE SHALLOW VERSION WAS NOT ENOUGH
 *
 * normaliseRecordDates knows three field names at the top level. A record's
 * dates are not all there: an announcement keeps `opens_on` and `closes_on`
 * inside its `registration` block, and those come back from js-yaml as Dates
 * exactly like the others. The server rejected a perfectly good announcement
 * with "The published date must be a calendar day", and `opens_on` would have
 * been the next one to fail.
 *
 * So this walks the whole structure rather than a list of names. A field the
 * CMS starts writing tomorrow is covered without anybody remembering to add it.
 *
 * The rule itself is unchanged and still conservative: only a Date at exactly
 * midnight UTC becomes a calendar day, read from its UTC components. A Date
 * carrying a real time is left alone so it is still rejected, and a value that
 * is already a string is untouched.
 */
function normaliseDatesDeep(value) {
  if (value instanceof Date) return dateOnly(value);
  if (Array.isArray(value)) return value.map(normaliseDatesDeep);
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) value[key] = normaliseDatesDeep(value[key]);
  }
  return value;
}

function normaliseRecordDates(record) {
  if (!record || typeof record !== "object") return record;
  /*
    Every date in the record, not the three at the top. A nested `opens_on`
    reaching a template as a Date is the same defect this module exists for —
    it simply had not surfaced yet because nothing rendered one.
  */
  return normaliseDatesDeep(record);
}

module.exports = { dateOnly, normaliseRecordDates, normaliseDatesDeep };
