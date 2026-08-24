/**
 * The one interpretation of an academic year in this repository.
 *
 * Extracted from src/_data/eventListing.js in Phase 17C-a so that the CMS
 * pre-save guard, scripts/cms-check.js and the build all compare years the same
 * way. A second, subtly different reading of "2025/26" is exactly the kind of
 * divergence that produces a rule which fires in one place and not another.
 *
 * `eventListing.js` still re-exports `parseAcademicYear`, so existing callers —
 * scripts/test-event-listing-groups.js among them — are unaffected.
 */

"use strict";

/**
 * "2025/26" -> 2025. Anything else -> null.
 *
 * The trailing pair must be the last two digits of start + 1, so "2025/27" and
 * "2025/25" are rejected rather than silently sorted somewhere. Comparison is on
 * the returned START YEAR, never on the string: "2099/00" is later than
 * "2098/99", which a lexicographic comparison would get wrong.
 */
function parseAcademicYear(value) {
  const m = /^(\d{4})\/(\d{2})$/.exec(String(value || ""));
  if (!m) return null;
  const start = Number(m[1]);
  const expected = String((start + 1) % 100).padStart(2, "0");
  return m[2] === expected ? start : null;
}

/**
 * Would publishing this event break the events listing?
 *
 * The build refuses to group a published, listing-visible event whose academic
 * year is LATER than the configured current year — see eventListing.js. That is
 * a fatal error, and it takes `npm run cms:serve` down with it, so an editor who
 * saves such a record cannot reopen the CMS to undo it.
 *
 * This is deliberately a shade stricter than the build rule: it does not also
 * require `show_in_listing`. A published future event that is merely hidden from
 * the listing builds today, but turning that switch on later breaks the site with
 * no warning attached to the switch. Refusing the state outright is kinder than
 * leaving the trap armed.
 *
 * Past and current years are always fine — the rule is "later than current",
 * not "equal to current".
 *
 * @returns {null|{eventYear: string, currentYear: string}} null when acceptable
 */
function futurePublishProblem(event, currentYear) {
  if (!event || event.published !== true) return null;

  const eventStart = parseAcademicYear(event.academic_year);
  const currentStart = parseAcademicYear(currentYear);
  // An unparseable year on either side is somebody else's error to report:
  // the academic-year format rules already cover it, and guessing here would
  // block a save for a reason the editor was never told about.
  if (eventStart === null || currentStart === null) return null;

  if (eventStart <= currentStart) return null;
  return { eventYear: String(event.academic_year), currentYear: String(currentYear) };
}

/** The editor-facing wording. Kept beside the rule so the two cannot drift. */
function futurePublishMessage(problem) {
  return (
    "Cannot publish this event yet.\n\n" +
    "This event belongs to " + problem.eventYear + ", but the website's current " +
    "academic year is still " + problem.currentYear + ".\n\n" +
    'You can save the event now with "Published" switched off.\n\n' +
    "When the Federation changes the current academic year to " + problem.eventYear +
    ", you can return to this event and publish it.\n\n" +
    "The event has not been saved."
  );
}

/* ---------------------------------------------------------------------------
   The option list every academic-year dropdown uses.
   --------------------------------------------------------------------------- */

/** The first year the repository holds content for. Never drops off the list. */
const FIRST_ACADEMIC_YEAR = 2025;

/** Keep at least this far ahead, so the list is useful without yearly edits. */
const MINIMUM_HORIZON = 2035;

/** "2025/26" from a start year. */
function formatAcademicYear(start) {
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * Every academic year an editor may choose, oldest first.
 *
 * Runs from 2025/26 — the earliest year with canonical content — through ten
 * years past whatever is currently configured, with a floor of 2035/36. Two
 * consequences are deliberate:
 *
 *   - rolling the site over to 2026/27 EXTENDS the list rather than shifting it,
 *     so 2025/26 stays selectable and historical records remain editable;
 *   - nobody has to edit an array each summer to add next year.
 *
 * One generator feeds Team, Announcements, Standard Events and the Site Settings
 * current-year control, so the four cannot offer different years.
 */
function academicYearOptions(currentYear) {
  const currentStart = parseAcademicYear(currentYear);
  const last = Math.max(MINIMUM_HORIZON, (currentStart || FIRST_ACADEMIC_YEAR) + 10);
  const years = [];
  for (let y = FIRST_ACADEMIC_YEAR; y <= last; y++) years.push(formatAcademicYear(y));
  return years;
}

module.exports = {
  parseAcademicYear,
  futurePublishProblem,
  futurePublishMessage,
  academicYearOptions,
  formatAcademicYear,
  FIRST_ACADEMIC_YEAR,
};
