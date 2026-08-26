/**
 * collections.js — what Bulk Manage is allowed to touch, and how to read it.
 *
 * ONE PLACE, FOR TWO REASONS.
 *
 * It is the server's ALLOW-LIST. A request names a collection by a short
 * canonical key; anything not in this table is refused before a path is
 * resolved, so an unknown key cannot become a folder name. The browser never
 * sends a path, and there is no code here that would accept one.
 *
 * It is also the only place that knows how a record of each kind describes
 * itself — its human label, its date, its year. The bulk screen shows people
 * names and titles rather than record IDs, and a nontechnical editor should
 * never have to recognise a file to know what they are hiding.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * The Polish Business Forum. It is a separate family with its own page, its own
 * rules and its own phase; listing it here would offer operations nobody has
 * designed for it. `content/events/` holds both families, so the standard-event
 * entry filters on `event_family` rather than trusting the folder.
 */

"use strict";

const path = require("path");
const eventText = require("../../src/_data/eventText.js");

const ROOT = path.join(__dirname, "..", "..");

/** The first non-empty string, or "". Titles fall back rather than throw. */
const firstOf = (...values) => {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
};

/**
 * The three collections, keyed by the identifier the browser sends.
 *
 * `folder`     relative to the repository root; resolved server-side only.
 * `belongs`    excludes records that live in the folder but are not ours.
 * `describe`   record -> what a person needs to recognise it.
 * `order`      how the list is sorted before it reaches the screen.
 */
const COLLECTIONS = {
  team: {
    key: "team",
    label: "Team",
    singular: "team member",
    folder: "content/team",
    belongs: () => true,
    describe: (r) => ({
      // A person is their name. The record ID is a filename, and an editor
      // hiding the wrong committee member because two IDs looked alike is
      // exactly the mistake this screen exists to prevent.
      title: firstOf(r.name, r.slug),
      detail: firstOf((r.en || {}).role, (r.pl || {}).role),
      date: null,
    }),
    order: (a, b) => (a.record.group === b.record.group
      ? (a.record.order || 0) - (b.record.order || 0)
      : String(a.record.group || "").localeCompare(String(b.record.group || ""))),
  },

  announcements: {
    key: "announcements",
    label: "Announcements",
    singular: "announcement",
    folder: "content/announcements",
    belongs: () => true,
    describe: (r) => ({
      // English first, Polish second, ID last. The admin panel is in English
      // and every record has both, but a half-translated draft must still be
      // recognisable rather than crash the list.
      title: firstOf((r.en || {}).title, (r.pl || {}).title, r.slug),
      detail: firstOf((r.en || {}).subtitle, (r.pl || {}).subtitle),
      date: r.published_date || null,
    }),
    // Newest first, which is the order the announcements page itself uses.
    order: (a, b) => String(b.record.published_date || "")
      .localeCompare(String(a.record.published_date || "")) ||
      String(a.id).localeCompare(String(b.id)),
  },

  "standard-events": {
    key: "standard-events",
    label: "Standard Events",
    singular: "event",
    folder: "content/events",
    // The folder also holds the Business Forum, which this phase does not
    // manage. Filtering on the family rather than on a filename means a second
    // Forum edition added later is excluded automatically.
    belongs: (r) => r.event_family === "standard",
    describe: (r) => ({
      title: firstOf(
        eventText.visibleTitle(r.en || {}),
        eventText.visibleTitle(r.pl || {}),
        r.slug),
      detail: firstOf((r.en || {}).eyebrow, (r.pl || {}).eyebrow),
      date: r.start_date || null,
    }),
    /*
      Newest first, with the record ID breaking a tie. Two events on one day is
      not hypothetical — a congress and its dinner can share a date — and a list
      that reordered itself between loads would make "select all visible" mean
      something different each time.
    */
    order: (a, b) => String(b.record.start_date || "")
      .localeCompare(String(a.record.start_date || "")) ||
      String(a.id).localeCompare(String(b.id)),
  },
};

/** The collection for a key, or null. Never throws on editor input. */
function collectionFor(key) {
  return Object.prototype.hasOwnProperty.call(COLLECTIONS, key)
    ? COLLECTIONS[key] : null;
}

/** The absolute folder of a known collection. Not reachable with an unknown key. */
function folderOf(collection) {
  return path.join(ROOT, collection.folder);
}

/** What the screen offers, in the order it offers it. */
function collectionList() {
  return Object.values(COLLECTIONS)
    .map((c) => ({ key: c.key, label: c.label, singular: c.singular }));
}

module.exports = { COLLECTIONS, collectionFor, folderOf, collectionList, ROOT };
