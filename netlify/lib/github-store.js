/**
 * github-store.js — Bulk manage, against the repository instead of a disk.
 *
 * THE SEAM PHASE 17C.5B BUILT FOR THIS.
 *
 * Bulk manage was written so the screen knows a collection key, a record ID, a
 * revision token and an operation, and nothing about storage. This is the
 * second adapter behind that seam. The screen is not modified at all: it posts
 * the same actions to the same paths, and in production a Netlify Function
 * answers instead of the local Node server.
 *
 * Every semantic from 17C.5B is preserved, because they are the same code or
 * the same helper:
 *
 *   revision token   the file's BLOB SHA — Git's own content hash — where the
 *                    local adapter used a SHA-256 of the bytes. Same idea, and
 *                    the local adapter used a content hash precisely so this
 *                    substitution would be a rename rather than a redesign.
 *   future year      academicYear.futurePublishProblem, as everywhere else
 *   dependencies     read from the repository at the moment of the delete
 *   atomicity        one commit for the whole selection, or none at all
 *   media            never deleted
 */

"use strict";

const yaml = require("js-yaml");

const { collectionFor } = require("../../scripts/bulk/collections.js");
const { withPublished, usableId } = require("../../scripts/bulk/local-store.js");
const academicYear = require("../../src/_data/academicYear.js");
const rules = require("./rules.js");

/** Where each bulk collection lives in the repository. */
const FOLDERS = {
  team: "content/team",
  announcements: "content/announcements",
  "standard-events": "content/events",
};

/** Everything in a collection, described for the screen. */
async function listRecords(repo, collectionKey) {
  const collection = collectionFor(collectionKey);
  if (!collection) return { error: { code: "unknown_collection", collection: collectionKey } };

  const files = await repo.listFolder(FOLDERS[collectionKey]);
  const rows = [];
  for (const file of files) {
    if (!/\.ya?ml$/i.test(file.name)) continue;
    const id = file.name.replace(/\.ya?ml$/i, "");
    if (!usableId(id)) continue;
    const found = await repo.readFile(file.path);
    if (!found) continue;
    let record;
    try {
      record = yaml.load(found.text);
    } catch (err) {
      continue;
    }
    if (!record || typeof record !== "object" || !collection.belongs(record)) continue;
    const described = collection.describe(record);
    rows.push({
      id,
      record,
      title: described.title,
      detail: described.detail,
      date: described.date,
      academicYear: record.academic_year || null,
      published: record.published === true,
      // The blob SHA IS the revision. Git already computed it.
      rev: found.sha,
      text: found.text,
      path: file.path,
    });
  }
  rows.sort(collection.order);
  return { records: rows.map(({ record, text, path, ...row }) => row), full: rows };
}

/**
 * Resolve a selection, refusing the whole thing if anything is wrong.
 *
 * The same order of checks as the local adapter: identity, duplicates,
 * existence, then staleness. Nothing is written until every one passes.
 */
async function resolveSelection(repo, collectionKey, items) {
  const collection = collectionFor(collectionKey);
  if (!collection) return { error: { code: "unknown_collection" } };
  if (!Array.isArray(items) || items.length === 0) return { error: { code: "empty_selection" } };

  const seen = new Set();
  const resolved = [];
  const missing = [];
  const stale = [];

  for (const item of items) {
    const id = item && item.id;
    if (!usableId(id)) return { error: { code: "invalid_id", id: String(id) } };
    if (seen.has(id)) return { error: { code: "duplicate_id", id } };
    seen.add(id);

    const path = `${FOLDERS[collectionKey]}/${id}.yaml`;
    const found = await repo.readFile(path);
    if (!found) { missing.push(id); continue; }

    let record;
    try {
      record = yaml.load(found.text);
    } catch (err) {
      return { error: { code: "unreadable_record", records: [{ id, reason: "malformed" }] } };
    }
    if (!record || !collection.belongs(record)) { missing.push(id); continue; }

    if (item.rev !== found.sha) {
      stale.push({ id, title: collection.describe(record).title });
      continue;
    }
    resolved.push({ id, path, text: found.text, record, sha: found.sha });
  }

  if (missing.length) return { error: { code: "unknown_record", ids: missing } };
  if (stale.length) return { error: { code: "stale", records: stale } };
  return { collection, resolved };
}

/** Hide or show every selected record, in one commit or none. */
async function updateRecords(repo, collectionKey, operation, items, user) {
  const published = operation === "show" ? true : operation === "hide" ? false : null;
  if (published === null) {
    return { error: { code: "unknown_operation", operation: String(operation) } };
  }

  const selection = await resolveSelection(repo, collectionKey, items);
  if (selection.error) return selection;
  const { collection, resolved } = selection;

  if (collection.key === "standard-events" && published === true) {
    const currentYear = rules.currentAcademicYear();
    const blocked = resolved
      .map((entry) => {
        const problem = academicYear.futurePublishProblem(
          { ...entry.record, published: true }, currentYear);
        return problem ? {
          id: entry.id,
          title: collection.describe(entry.record).title,
          recordYear: problem.eventYear,
          currentYear: problem.currentYear,
        } : null;
      })
      .filter(Boolean);
    if (blocked.length) return { error: { code: "future_year", records: blocked } };
  }

  const changes = [];
  for (const entry of resolved) {
    if (entry.record.published === published) continue;         // already there
    const next = withPublished(entry.text, published);
    if (next === null) {
      return { error: { code: "no_published_field",
        records: [{ id: entry.id, title: collection.describe(entry.record).title }] } };
    }
    changes.push({ path: entry.path, content: next });
  }

  if (!changes.length) return { changed: [] };                  // idempotent

  /*
    ONE COMMIT. The local adapter wrote each file separately and relied on
    validating first; here the whole selection is a single ref update, so a
    half-applied bulk hide is not expressible.
  */
  await repo.commit(changes,
    `CMS: ${actorName(user)} ${published ? "showed" : "hid"} ` +
    `${changes.length} ${collection.label.toLowerCase()} ` +
    `record${changes.length === 1 ? "" : "s"}\n\n` +
    `CMS-Actor: ${user.email}\nCMS-Actor-Id: ${user.id}`,
    { name: actorName(user), email: user.email });

  return { changed: changes.map((c) => c.path.split("/").pop().replace(/\.yaml$/, "")) };
}

/**
 * Which announcements point at these events, read from the repository now.
 *
 * A reference counts even when the event's registration state is `none`: an
 * announcement written before sign-ups open is the ordinary case, and deleting
 * the event would still leave it pointing at nothing.
 */
async function dependentsOfEvents(repo, ids) {
  const wanted = new Set(ids);
  const found = new Map();
  const announcements = collectionFor("announcements");

  for (const file of await repo.listFolder(FOLDERS.announcements)) {
    if (!/\.ya?ml$/i.test(file.name)) continue;
    const entry = await repo.readFile(file.path);
    if (!entry) continue;
    let record;
    try {
      record = yaml.load(entry.text);
    } catch (err) {
      continue;
    }
    if (!record || typeof record !== "object") continue;

    const link = record.link || {};
    const registration = record.registration || {};
    const ways = new Map();
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
        id: record.slug || file.name.replace(/\.ya?ml$/i, ""),
        title: announcements.describe(record).title,
        ways: reasons,
      });
    }
  }
  return found;
}

/** Delete every selected record, in one commit or none. Admins only. */
async function deleteRecords(repo, collectionKey, items, user) {
  const selection = await resolveSelection(repo, collectionKey, items);
  if (selection.error) return selection;
  const { collection, resolved } = selection;

  if (collection.key === "standard-events") {
    const dependents = await dependentsOfEvents(repo, resolved.map((e) => e.id));
    if (dependents.size) {
      return { error: { code: "has_dependents",
        records: [...dependents.entries()].map(([id, users]) => ({
          id,
          title: collection.describe(resolved.find((e) => e.id === id).record).title,
          dependents: users,
        })) } };
    }
  }

  /*
    MEDIA IS NEVER DELETED. A photograph can belong to several records, and the
    Business Forum keeps its own copies of team portraits. Only the record file
    is removed.
  */
  await repo.commit(
    resolved.map((entry) => ({ path: entry.path, delete: true })),
    `CMS: ${actorName(user)} deleted ${resolved.length} ` +
    `${collection.label.toLowerCase()} record${resolved.length === 1 ? "" : "s"}\n\n` +
    `CMS-Actor: ${user.email}\nCMS-Actor-Id: ${user.id}`,
    { name: actorName(user), email: user.email });

  return { deleted: resolved.map((e) => e.id) };
}

const actorName = (user) => user.name || user.email;

module.exports = { listRecords, updateRecords, deleteRecords, dependentsOfEvents, FOLDERS };
