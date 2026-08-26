/**
 * media.js — what may be uploaded, and under what name.
 *
 * MIME TYPE IS A CLAIM, NOT EVIDENCE.
 *
 * The browser says what it thinks a file is; anybody can say anything. So the
 * decision is made on the first bytes of the file, which a real PNG, JPEG,
 * WebP, GIF or SVG has and a renamed script does not. The extension has to
 * agree with those bytes as well, because the extension is what the web server
 * will later use to choose a Content-Type.
 *
 * The site is a static site: an uploaded file becomes a URL anybody can open.
 * That is why an .html or .js upload is refused outright rather than merely
 * being given a harmless name.
 */

"use strict";

/** Roughly the largest photograph the existing site actually carries. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Signatures, checked against the first bytes of the file.
 *
 * SVG is deliberately NOT here. It is XML, it can carry script, and the site
 * serves media from its own origin — an uploaded SVG would be a same-origin
 * script delivery mechanism. Nothing in Team, Announcements or Events needs
 * one; the co-organiser logos are raster files.
 */
const TYPES = [
  { ext: ["png"], mime: "image/png",
    magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  { ext: ["jpg", "jpeg"], mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
  { ext: ["gif"], mime: "image/gif",
    magic: [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]] },
  { ext: ["webp"], mime: "image/webp", magic: [[0x52, 0x49, 0x46, 0x46]],
    // RIFF is also WAV and AVI; bytes 8-11 say which.
    also: (b) => b.length > 11 && b.slice(8, 12).toString("ascii") === "WEBP" },
];

const startsWith = (buffer, bytes) =>
  buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b);

/**
 * Is this upload acceptable, and what should it be called?
 *
 * @param {string} name    the filename the browser offered
 * @param {Buffer} bytes   the decoded file
 * @returns {{ok: true, filename: string, mime: string}|{ok: false, code: string, detail?: string}}
 */
function check(name, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    return { ok: false, code: "empty" };
  }
  if (bytes.length > MAX_BYTES) {
    return { ok: false, code: "too_large",
      detail: `${Math.round(bytes.length / 1024 / 1024)} MB` };
  }

  const raw = String(name || "");
  // Only the last segment, so a name carrying a path contributes nothing.
  const base = raw.split(/[\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return { ok: false, code: "no_extension" };

  const ext = base.slice(dot + 1).toLowerCase();
  const stem = base.slice(0, dot);

  const type = TYPES.find((t) => t.ext.includes(ext));
  if (!type) return { ok: false, code: "unsupported_type", detail: ext };

  const matches = type.magic.some((m) => startsWith(bytes, m)) &&
    (!type.also || type.also(bytes));
  if (!matches) {
    /*
      The name says one thing and the bytes say another. That is either a
      corrupt file or a rename, and neither should reach a public URL.
    */
    return { ok: false, code: "content_mismatch", detail: ext };
  }

  /*
    THE NAME IS REBUILT, NOT SANITISED.

    Stripping bad characters from a name invites arguments about which
    characters are bad. Instead the stem is reduced to the alphabet the existing
    assets already use, which cannot express a path, a leading dot or a second
    extension.
  */
  const safeStem = stem.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!safeStem) return { ok: false, code: "unusable_name" };

  return { ok: true, filename: `${safeStem}.${ext === "jpeg" ? "jpg" : ext}`, mime: type.mime };
}

module.exports = { check, MAX_BYTES, TYPES };
