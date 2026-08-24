/**
 * messages.js — what a blocked bulk operation says to a person.
 *
 * Extracted from api.js in Phase 17D.1 so the production Netlify Function and
 * the local server produce the SAME sentence for the same refusal. An editor
 * should not learn one wording at their desk and a different one online, and a
 * second copy of these strings would drift the first time one was improved.
 *
 * Every message says what did NOT happen, because the one thing an editor needs
 * to know after a blocked bulk operation is whether half of it went through.
 */

"use strict";

const list = (names) => {
  if (names.length === 1) return `"${names[0]}"`;
  return names.map((n) => `"${n}"`).join(", ").replace(/, ([^,]*)$/, " and $1");
};

/**
 * Turn a structured failure into something a committee member can act on.
 *
 * Every message says what did NOT happen, because the one thing an editor needs
 * to know after a blocked bulk operation is whether half of it went through.
 */
function explain(error) {
  const nothing = "Nothing was changed.";
  switch (error.code) {
    case "unknown_collection":
      return { title: "That collection cannot be managed here.", detail: nothing };
    case "empty_selection":
      return { title: "Nothing was selected.", detail: "Choose at least one record first." };
    case "invalid_id":
    case "invalid_request":
    case "too_large":
      return { title: "That request could not be understood.", detail: nothing };
    case "duplicate_id":
      return { title: "The same record was listed twice.",
        detail: `${nothing} Refresh Bulk manage and try again.` };
    case "unknown_operation":
      return { title: "That is not something this screen can do.", detail: nothing };
    case "unknown_record":
      return { title: "Some of those records no longer exist.",
        detail: `${nothing} Refresh Bulk manage — somebody may have deleted them.` };
    case "unreadable_record":
      return { title: "One of those records could not be read.",
        detail: `${nothing} ${list(error.records.map((r) => r.id))} needs fixing by hand.` };
    case "stale":
      return { title: `${nothing.slice(0, -1)} because ` +
        `${list(error.records.map((r) => r.title))} ` +
        `${error.records.length === 1 ? "has" : "have"} been edited since this list was loaded.`,
      detail: "Refresh Bulk manage and try again." };
    case "future_year": {
      const r = error.records[0];
      const which = error.records.length === 1
        ? `${list([r.title])} cannot be shown yet because it belongs to ${r.recordYear}.`
        : `${list(error.records.map((x) => x.title))} cannot be shown yet because they ` +
          `belong to a later academic year.`;
      return { title: nothing,
        detail: `${which} The current academic year is ${r.currentYear}.` };
    }
    case "has_dependents":
      return { title: nothing, detail: "Some records are still referenced.",
        dependents: error.records };
    case "no_published_field":
      return { title: nothing,
        detail: `${list(error.records.map((r) => r.title))} has no visibility setting ` +
          "and needs fixing by hand." };
    case "write_failed":
      return { title: "The change could not be saved.",
        detail: "Anything already changed has been put back. Try again." };
    default:
      return { title: "Something went wrong.", detail: nothing };
  }
}

module.exports = { explain, list };
