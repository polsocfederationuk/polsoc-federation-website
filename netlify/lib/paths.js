/**
 * paths.js — the production allow-list.
 *
 * THE SAME PRINCIPLE AS BULK MANAGE, ENFORCED AT THE REPOSITORY BOUNDARY.
 *
 * The browser names a collection and a record; the server decides which file
 * that is. Nothing here turns caller-supplied text into a repository path
 * without first matching it against a fixed pattern, and the resulting path is
 * re-checked against the allow-list before any write is planned.
 *
 * This matters more in production than it did locally. A local mistake edits a
 * file in a working copy somebody can inspect with `git diff`; the same mistake
 * here commits to the repository the website is built from.
 *
 * WHAT IS NOT WRITEABLE
 *
 * Everything else, deliberately and including for admins: src/, scripts/,
 * netlify/, package.json, netlify.toml, .github/, the repository root's
 * hand-written HTML. An admin is somebody who may delete a record and change
 * the academic year — not somebody who may edit the build through the CMS.
 */

"use strict";

/** A record ID is a filename. Nothing outside this alphabet is accepted. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,120}$/;

/* Windows reserves these whatever the extension; the repository is developed
   on Windows and a checkout must not contain a file nobody can open. */
const RESERVED = new Set(["con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"]);

const usableId = (id) =>
  typeof id === "string" && ID_PATTERN.test(id) && !RESERVED.has(id);

/**
 * Content folders the CMS owns, and who may write to them.
 *
 * `adminOnly` marks the settings record: the current academic year decides
 * which events may be published at all, so changing it is an administrative
 * act rather than an editorial one.
 */
const CONTENT = {
  team: { folder: "content/team", adminOnly: false, label: "Team" },
  announcements: { folder: "content/announcements", adminOnly: false, label: "Announcements" },
  "standard-events": { folder: "content/events", adminOnly: false, label: "Standard Events" },
  settings: { folder: "content/settings", adminOnly: true, label: "Site settings" },
};

/** Media folders the CMS may upload into. */
const MEDIA = [
  "assets/team",
  "assets/announcements",
  "assets/events",
];

/**
 * Is this a repository path the CMS is allowed to touch, and by whom?
 *
 * Called on every path in a proposed commit, including paths Decap derived
 * itself — the collection config decides where an entry is written, but this
 * decides whether the write is permitted.
 *
 * @returns {{ok: true, adminOnly: boolean, kind: string}|{ok: false, reason: string}}
 */
function classify(repoPath) {
  const path = String(repoPath || "");

  // Refused before anything is parsed: these can only be attempts.
  if (path !== path.trim()) return { ok: false, reason: "padded path" };
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.startsWith("\\\\")) {
    return { ok: false, reason: "absolute path" };
  }
  if (path.includes("..") || path.includes("\\") || path.includes("//")) {
    return { ok: false, reason: "traversal" };
  }
  if (path.includes("\0") || /%2e|%2f|%5c/i.test(path)) {
    return { ok: false, reason: "encoded traversal" };
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(path)) {
    return { ok: false, reason: "unexpected characters" };
  }

  for (const entry of Object.values(CONTENT)) {
    const prefix = `${entry.folder}/`;
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length);
    if (!/^[a-z0-9][a-z0-9-]{0,120}\.yaml$/.test(name)) {
      return { ok: false, reason: "not a record filename" };
    }
    if (RESERVED.has(name.replace(/\.yaml$/, ""))) {
      return { ok: false, reason: "reserved filename" };
    }
    return { ok: true, adminOnly: entry.adminOnly, kind: "content", folder: entry.folder };
  }

  for (const folder of MEDIA) {
    const prefix = `${folder}/`;
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length);
    if (name.includes("/")) return { ok: false, reason: "media subfolders are not used" };
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
      return { ok: false, reason: "unsafe media filename" };
    }
    return { ok: true, adminOnly: false, kind: "media", folder };
  }

  return { ok: false, reason: "outside the content the CMS manages" };
}

/** Which content folders may be listed. Reads are allow-listed too. */
function readable(repoPath) {
  const result = classify(repoPath);
  if (result.ok) return result;
  // A folder itself, for entriesByFolder.
  const path = String(repoPath || "").replace(/\/$/, "");
  for (const entry of Object.values(CONTENT)) {
    if (path === entry.folder) {
      return { ok: true, adminOnly: false, kind: "folder", folder: entry.folder };
    }
  }
  for (const folder of MEDIA) {
    if (path === folder) return { ok: true, adminOnly: false, kind: "mediaFolder", folder };
  }
  return { ok: false, reason: result.reason };
}

/**
 * The media folder a proposed upload belongs to, or null.
 *
 * An upload is classified by its FOLDER, not by the name the browser offered:
 * that name is about to be rebuilt by lib/media.js into something safe, so
 * judging the original would refuse "Jane Photo.png" for a space it is not
 * going to keep. The rebuilt path is then classified in full before the write,
 * which is the check that actually decides.
 */
function mediaFolderOf(repoPath) {
  const folder = String(repoPath || "").split("/").slice(0, -1).join("/");
  return MEDIA.includes(folder) ? folder : null;
}

module.exports = { CONTENT, MEDIA, ID_PATTERN, RESERVED, usableId, classify, readable,
  mediaFolderOf };
