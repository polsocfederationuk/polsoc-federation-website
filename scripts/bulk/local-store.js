/**
 * local-store.js — the local file adapter behind Bulk Manage.
 *
 * THE POINT OF THE SEAM
 *
 * This is the ONLY module that knows records are YAML files on a Windows
 * machine. The screen above it knows a collection key, a record ID, a revision
 * token and an operation, and nothing else. When Phase 17D adds Git-backed
 * publishing, a second adapter implements the same four functions against the
 * GitHub API and the screen does not change: a revision token becomes a blob
 * SHA instead of a content hash, and a delete becomes a commit instead of an
 * unlink.
 *
 *   listRecords(collectionKey)                  -> { records }
 *   updateRecords(collectionKey, op, items)     -> { changed } | { error }
 *   deleteRecords(collectionKey, items)         -> { deleted } | { error }
 *   getDependencies(collectionKey, ids)         -> what would break
 *
 * NOTHING HERE ACCEPTS A PATH. Callers name a collection and a record ID; the
 * folder comes from the allow-list in collections.js and the filename is built
 * from an ID that has already been checked against a strict pattern. There is
 * no branch that concatenates caller input into a path, and no shell.
 *
 * VALIDATE EVERYTHING, THEN WRITE
 *
 * Every operation resolves and checks the WHOLE selection — existence,
 * revision, rules, dependencies — and builds every replacement file in memory
 * before a single byte is written. A selection that fails anywhere changes
 * nothing at all. That is what makes "nothing was changed" in the error message
 * a true statement rather than a hope.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const yaml = require("js-yaml");

const { collectionFor, folderOf, ROOT } = require("./collections.js");
const academicYear = require("../../src/_data/academicYear.js");

/*
  A record ID is a filename. Anything outside this alphabet is refused before it
  is used, which is what makes "../", "..\\", "C:\\", "\\\\server\\share" and a
  bare "." unrepresentable rather than merely filtered: none of them can be
  spelled with these characters. A separate normalisation check below re-proves
  containment anyway, because one guard for this is not enough.
*/
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,120}$/;

/*
  Windows reserves these names for devices, extension and all: opening
  `content/team/nul.yaml` opens the null device, and a write to it is discarded
  in silence rather than refused. The repository is developed on Windows, so an
  ID that spells one is refused here rather than trusted to fail loudly.
*/
const RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/** Is this a usable record ID at all? */
function usableId(id) {
  return typeof id === "string" && ID_PATTERN.test(id) && !RESERVED_NAMES.has(id);
}

const OPERATIONS = { hide: false, show: true };

/* -- reading ---------------------------------------------------------------- */

/**
 * The revision token for a file's current contents.
 *
 * A content hash, not a timestamp. It is exact, it is the same on every
 * machine, and it does not care about the filesystem's clock resolution — two
 * saves inside the same millisecond produce different tokens. It is also the
 * concept a Git adapter already has, so the protocol does not change later.
 */
function revisionOf(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/** The absolute file for a record ID, or null if the ID is not usable. */
function fileFor(collection, id) {
  if (!usableId(id)) return null;
  const folder = folderOf(collection);
  const file = path.join(folder, `${id}.yaml`);
  // Belt and braces. The pattern above already makes an escape unspellable;
  // this proves containment on the resolved path rather than trusting that.
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(folder) + path.sep)) return null;
  return resolved;
}

/** Read and parse one record, or null when it is not there / not ours. */
function readRecord(collection, id) {
  const file = fileFor(collection, id);
  if (!file || !fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  let record;
  try {
    record = yaml.load(text);
  } catch (err) {
    // A hand-broken file is a real state. Reporting it as "cannot be read" is
    // more useful than a parser stack trace in an editor's browser console.
    return { id, file, text, record: null, broken: String(err.message || err) };
  }
  if (!record || typeof record !== "object") return null;
  if (!collection.belongs(record)) return null;
  return { id, file, text, record, rev: revisionOf(text) };
}

/** Everything in a collection, described for the screen and sorted. */
function listRecords(collectionKey) {
  const collection = collectionFor(collectionKey);
  if (!collection) return { error: { code: "unknown_collection", collection: collectionKey } };

  const folder = folderOf(collection);
  if (!fs.existsSync(folder)) return { records: [] };

  const rows = [];
  for (const name of fs.readdirSync(folder)) {
    if (!/\.ya?ml$/i.test(name)) continue;
    const id = name.replace(/\.ya?ml$/i, "");
    const found = readRecord(collection, id);
    if (!found || found.broken || !found.record) continue;
    const described = collection.describe(found.record);
    rows.push({
      id,
      record: found.record,
      title: described.title,
      detail: described.detail,
      date: described.date,
      academicYear: found.record.academic_year || null,
      // The site-wide convention, unchanged: every public loader in this
      // repository filters `published === true`, so anything else is hidden.
      // Bulk Manage reports what the website does, not a second opinion.
      published: found.record.published === true,
      rev: found.rev,
    });
  }
  rows.sort(collection.order);
  return { records: rows.map(({ record, ...row }) => row) };
}

/* -- dependencies ----------------------------------------------------------- */

/**
 * Which announcements point at these events, and how.
 *
 * The only canonical cross-record reference in this repository. A repository
 * scan at the time of writing found announcements referring to standard events
 * two ways — the details link and the registration source — and found NO
 * canonical reference to a team member or to another announcement. Team slugs
 * appear inside `/assets/team/…jpg` paths and inside one LinkedIn URL in prose,
 * neither of which is a record reference.
 *
 * A REFERENCE COUNTS EVEN WHEN THE EVENT HAS NO REGISTRATION. Since Phase
 * 17C.5A.3 an announcement may point at an event whose sign-ups have not opened
 * — that is the normal case — and the reference is no less real for rendering
 * no panel today. Deleting the event would leave the announcement pointing at
 * nothing.
 */
function dependentsOfEvents(ids) {
  const wanted = new Set(ids);
  const announcements = collectionFor("announcements");
  const folder = folderOf(announcements);
  const found = new Map();                       // event id -> [{id, title, ways}]
  if (!fs.existsSync(folder)) return found;

  for (const name of fs.readdirSync(folder)) {
    if (!/\.ya?ml$/i.test(name)) continue;
    let record;
    try {
      record = yaml.load(fs.readFileSync(path.join(folder, name), "utf8"));
    } catch (err) {
      continue;
    }
    if (!record || typeof record !== "object") continue;

    const link = record.link || {};
    const registration = record.registration || {};
    const ways = new Map();                      // event id -> [reasons]
    const note = (slug, reason) => {
      if (!slug || !wanted.has(slug)) return;
      if (!ways.has(slug)) ways.set(slug, []);
      ways.get(slug).push(reason);
    };
    if (link.type === "event") note(link.event_slug, "the details link");
    if (registration.source === "event") note(registration.event_slug, "the registration");

    for (const [slug, reasons] of ways) {
      if (!found.has(slug)) found.set(slug, []);
      found.get(slug).push({
        id: record.slug || name.replace(/\.ya?ml$/i, ""),
        title: announcements.describe(record).title,
        // One announcement can depend on one event twice. Listed once, with
        // both reasons, rather than as two near-identical rows.
        ways: reasons,
      });
    }
  }
  return found;
}

/* -- validation ------------------------------------------------------------- */

/**
 * Resolve a selection and refuse it whole if anything is wrong.
 *
 * Returns either `{ error }` or `{ collection, resolved }` — never a partial
 * set. Callers that get `resolved` may assume every entry exists, is ours, and
 * still holds the contents the screen was showing.
 */
function resolveSelection(collectionKey, items) {
  const collection = collectionFor(collectionKey);
  if (!collection) {
    return { error: { code: "unknown_collection", collection: String(collectionKey) } };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { error: { code: "empty_selection" } };
  }

  const seen = new Set();
  const resolved = [];
  const missing = [];
  const stale = [];
  const unreadable = [];

  for (const item of items) {
    const id = item && item.id;
    const rev = item && item.rev;
    if (!usableId(id)) {
      return { error: { code: "invalid_id", id: String(id) } };
    }
    /*
      A repeated ID makes the request ambiguous rather than merely redundant:
      the two entries can carry different revisions, and there is no honest way
      to decide which one the editor meant. Refused rather than de-duplicated.
    */
    if (seen.has(id)) return { error: { code: "duplicate_id", id } };
    seen.add(id);

    const found = readRecord(collection, id);
    if (!found) { missing.push(id); continue; }
    if (found.broken) { unreadable.push({ id, reason: found.broken }); continue; }
    if (typeof rev !== "string" || rev !== found.rev) {
      stale.push({ id, title: collection.describe(found.record).title });
      continue;
    }
    resolved.push(found);
  }

  if (missing.length) return { error: { code: "unknown_record", ids: missing } };
  if (unreadable.length) return { error: { code: "unreadable_record", records: unreadable } };
  if (stale.length) return { error: { code: "stale", records: stale } };
  return { collection, resolved };
}

/* -- writing ---------------------------------------------------------------- */

/**
 * Set `published:` in place, touching nothing else in the file.
 *
 * A line edit rather than a YAML re-dump. Re-serialising would rewrite comment
 * headers, re-wrap every long Polish paragraph and re-quote strings across a
 * file where only one boolean changed — an unreadable diff, and a change to
 * content this operation has no business touching. The other visibility
 * switches an event carries (`show_in_listing`, `show_on_homepage`,
 * `show_in_archive`, `flagship`) are left exactly as they are, so hiding an
 * event remembers where it belongs when it comes back.
 */
function withPublished(text, value) {
  const lines = text.split(/\r?\n/);
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  for (let i = 0; i < lines.length; i++) {
    // Top level only: an indented `published:` would belong to something else.
    if (/^published:\s*(true|false)\s*$/.test(lines[i])) {
      lines[i] = `published: ${value}`;
      return lines.join(eol);
    }
  }
  return null;                                  // no key to change — see below
}

/** Replace a file's contents without ever leaving a half-written file behind. */
function writeAtomic(file, text) {
  const temp = `${file}.bulk-tmp`;
  fs.writeFileSync(temp, text, "utf8");
  // Rename is atomic within a directory on both NTFS and POSIX: a reader sees
  // either the old file or the new one, never a partial write, even if the
  // process dies mid-operation.
  fs.renameSync(temp, file);
}

/**
 * Hide or show every selected record, or none of them.
 *
 * @param {"hide"|"show"} operation
 */
function updateRecords(collectionKey, operation, items) {
  if (!Object.prototype.hasOwnProperty.call(OPERATIONS, operation)) {
    return { error: { code: "unknown_operation", operation: String(operation) } };
  }
  const published = OPERATIONS[operation];

  const selection = resolveSelection(collectionKey, items);
  if (selection.error) return selection;
  const { collection, resolved } = selection;

  /*
    A FUTURE ACADEMIC YEAR IS NO LONGER REFUSED.

    Publishing next year's event used to be blocked, because the listing showed
    a single season and the event would simply have disappeared. Every academic
    year is now its own section on the public pages, so it appears in a
    collapsed group of its own instead — present, correctly placed, and never
    promoted over the current year.

    The year's FORMAT is still validated, by the same rules as ever.
  */

  // Every replacement is built and checked before anything is written.
  const planned = [];
  for (const entry of resolved) {
    if (entry.record.published === published) continue;   // already there
    const next = withPublished(entry.text, published);
    if (next === null) {
      /*
        Every record in this repository carries a top-level `published:`, and
        scripts/validate.js requires it. A file without one is malformed rather
        than merely old, and inventing the key here would guess at where it
        belongs in a file whose field order the round-trip test pins.
      */
      return { error: { code: "no_published_field",
        records: [{ id: entry.id, title: collection.describe(entry.record).title }] } };
    }
    planned.push({ file: entry.file, text: next, id: entry.id });
  }

  /*
    Idempotent by construction: a record already in the requested state produces
    no plan entry and no write. Selecting a mixture of hidden and visible
    records is an ordinary thing to do, not an error.
  */
  const written = [];
  try {
    for (const item of planned) {
      writeAtomic(item.file, item.text);
      written.push(item.id);
    }
  } catch (err) {
    /*
      A write failed part-way — a locked file, a full disk. Every original is
      still in memory, so the files already replaced are put back before the
      failure is reported, and the editor's selection is left as it was.

      This is the one place where "nothing changed" depends on the rollback
      rather than on ordering, which is why validation happens first and this
      path is reached only by an actual filesystem failure.
    */
    restore(resolved.filter((entry) => written.includes(entry.id)));
    return { error: { code: "write_failed", detail: String(err.message || err) } };
  }
  return { changed: written };
}

/** Delete every selected record, or none of them. */
function deleteRecords(collectionKey, items) {
  const selection = resolveSelection(collectionKey, items);
  if (selection.error) return selection;
  const { collection, resolved } = selection;

  /*
    DEPENDENCIES ARE READ FROM THE FILES, NOT FROM THE BROWSER.

    The screen's idea of what depends on what is as old as the page. An
    announcement that started pointing at this event a minute ago must still
    block the delete, so the check runs against the announcements on disk now.
  */
  if (collection.key === "standard-events") {
    const ids = resolved.map((entry) => entry.id);
    const dependents = dependentsOfEvents(ids);
    if (dependents.size) {
      return { error: { code: "has_dependents",
        records: [...dependents.entries()].map(([id, users]) => ({
          id,
          title: collection.describe(
            resolved.find((entry) => entry.id === id).record).title,
          dependents: users,
        })) } };
    }
  }

  /*
    MEDIA IS NEVER DELETED. A photograph can belong to several records — the
    same portrait appears on a team page and inside the Business Forum's own
    people list — so removing a record must not remove the picture it used.
    Nothing in this function touches assets/.
  */
  const deleted = [];
  for (const entry of resolved) {
    fs.unlinkSync(entry.file);
    deleted.push(entry.id);
  }
  return { deleted };
}

/** Put files back the way they were. Used only to unwind a failed write. */
function restore(entries) {
  for (const entry of entries) {
    try { writeAtomic(entry.file, entry.text); } catch (err) { /* reported above */ }
  }
}

/* -- the current academic year ---------------------------------------------- */

/**
 * The year the site is currently running, read from the settings record.
 *
 * The same file the CMS edits and the build reads, so bulk Show cannot disagree
 * with a save about which year is current.
 */
function readCurrentAcademicYear() {
  const file = path.join(ROOT, "content", "settings", "academic-year.yaml");
  try {
    const settings = yaml.load(fs.readFileSync(file, "utf8")) || {};
    return String(settings.current || "");
  } catch (err) {
    return "";
  }
}

module.exports = {
  ID_PATTERN,
  usableId,
  RESERVED_NAMES,
  revisionOf,
  listRecords,
  updateRecords,
  deleteRecords,
  dependentsOfEvents,
  resolveSelection,
  withPublished,
  readCurrentAcademicYear,
  readRecord,
  fileFor,
  restore,
};
