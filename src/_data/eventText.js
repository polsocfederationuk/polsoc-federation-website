/**
 * eventText.js — the one place an event's effective wording is decided.
 *
 * WHY THIS EXISTS
 *
 * A standard event used to require an editor to write three descriptions and
 * two more for search engines, most of which said much the same thing. Phase
 * 17C.5A reduced that to ONE Summary for an ordinary new event — without
 * discarding anything, because an inventory showed the four existing events do
 * carry deliberately different wording in every one of those fields.
 *
 * So nothing was migrated. The existing fields stayed exactly where they were
 * and became OVERRIDES; a new, optional `summary` became the source everything
 * falls back to. An event that fills in only Summary gets sensible text
 * everywhere; an event that has authored variants keeps every one of them.
 *
 * THE CHAIN
 *
 *   summary ──┬─> card summary        (override: card_summary)
 *             ├─> page introduction   (override: hero_summary)
 *             └─> search description  (override: seo_description)
 *                        └─> structured description (override: schema_description)
 *
 *   timeline summary  <- override: timeline_summary, else the card summary
 *   search title      <- override: seo_title, else generated
 *   structured name   <- override: schema_name, else the visible title
 *
 * Every arrow is "use the override if there is one". That is what makes the
 * four existing events render byte-identically while a new event needs one box.
 *
 * Kept out of the templates deliberately: the fallbacks have to be identical in
 * the page, the card, the meta tags and the structured data, and a chain
 * reimplemented in four templates is a chain that will disagree with itself.
 */

"use strict";

/** Trimmed text, or "" — so an empty override never beats a real Summary. */
const text = (v) => (typeof v === "string" ? v.trim() : "");

/** The first non-empty value, or "". */
const firstOf = (...values) => {
  for (const v of values) {
    const t = text(v);
    if (t) return t;
  }
  return "";
};

/**
 * The visible <h1>, assembled the way src/event.njk assembles it.
 *
 * Spaces sit OUTSIDE the decorative span, and an empty part contributes
 * nothing — the same rule the title control and the template already follow.
 */
function visibleTitle(loc) {
  return [loc.title_lead, loc.title_fancy, loc.title_tail]
    .map(text)
    .filter(Boolean)
    .join(" ");
}

/** The calendar year an event happens in, as a string, or "". */
function calendarYear(startDate) {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(String(startDate || ""));
  return m ? m[1] : "";
}

/**
 * The search title an ordinary event gets without anybody writing one.
 *
 *   <visible title> <year> | <organisation>
 *
 * The year is left off when the title already ends with it, so a record called
 * "Polish Youth Congress 2025" does not become "…2025 2025 | …". Only a
 * trailing year counts: "2025 in review" is about the year, not dated by it,
 * and appending the year there is still correct.
 */
function generatedSearchTitle(loc, startDate, orgName) {
  const title = visibleTitle(loc);
  const year = calendarYear(startDate);
  const alreadyEndsWithYear = Boolean(year) && (title === year || title.endsWith(" " + year));
  const head = [title, alreadyEndsWithYear ? "" : year].filter(Boolean).join(" ");
  return [head, text(orgName)].filter(Boolean).join(" | ");
}

/**
 * Everything the templates need, with every fallback already applied.
 *
 * @param {object} loc   the record's `en` or `pl` block
 * @param {object} event the whole record (for the date)
 * @param {string} orgName the organisation name in this language
 */
function effectiveText(loc, event, orgName) {
  const l = loc || {};
  const e = event || {};

  const summary = text(l.summary);
  const card = firstOf(l.card_summary, summary);
  const hero = firstOf(l.hero_summary, summary);

  // The homepage line is a genuinely tighter context — the inventory measured
  // 77–109 characters against 160–200 for card text — so it keeps its own
  // field. Falling back to the card summary is better than falling back to
  // nothing when a new event leaves it blank.
  const timeline = firstOf(l.timeline_summary, card);

  const searchDescription = firstOf(l.seo_description, summary, card);
  const structuredDescription = firstOf(l.schema_description, searchDescription);

  return {
    summary,
    cardSummary: card,
    heroSummary: hero,
    timelineSummary: timeline,
    searchTitle: firstOf(l.seo_title, generatedSearchTitle(l, e.start_date, orgName)),
    searchDescription,
    structuredDescription,
    structuredName: firstOf(l.schema_name, visibleTitle(l)),
    visibleTitle: visibleTitle(l),
  };
}

module.exports = {
  effectiveText,
  generatedSearchTitle,
  visibleTitle,
  calendarYear,
  firstOf,
};
