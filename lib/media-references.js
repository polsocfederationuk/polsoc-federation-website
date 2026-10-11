"use strict";

const fs = require("node:fs");
const path = require("node:path");
const media = require("../netlify/lib/media.js");

/** Update exact asset references, including Markdown, without reformatting YAML. */
function rewriteReferences(raw, renamed) {
  if (!renamed.size) return raw;
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // One replacement pass prevents a new filename from being renamed a second time.
  const names = [...renamed.keys()].sort((a, b) => b.length - a.length).map(escape);
  const pattern = new RegExp("(^|[\\s\"'(<])(/?)(" + names.join("|") + ")(?=$|[\\s\"')\\]?#<>])", "gm");
  return raw.replace(pattern, (_match, before, slash, original) => before + slash + renamed.get(original));
}

/**
 * Recover only the deterministic rename made by the old uploader. No fuzzy
 * matching, no cross-folder guesses, and no replacement of an existing image.
 */
function legacyAliases(root) {
  const aliases = new Map();
  const content = path.join(root, "content");
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(/(?:^|[\s"'(<])\/?(assets\/(?:team|events|announcements|polsocs)\/[a-zA-Z0-9][a-zA-Z0-9._-]*)/gm)) {
        const requested = match[1];
        if (fs.existsSync(path.join(root, requested))) continue;
        const stored = media.canonicalPath(requested);
        if (stored && stored !== requested && fs.existsSync(path.join(root, stored))) {
          aliases.set(requested, stored);
        }
      }
    }
  };
  walk(content);
  return aliases;
}

function copyLegacyAliases(root, output) {
  const outputRoot = path.resolve(root, output);
  const aliases = legacyAliases(root);
  for (const [requested, stored] of aliases) {
    const destination = path.resolve(outputRoot, requested);
    if (!destination.startsWith(outputRoot + path.sep)) throw new Error("Invalid media alias");
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, stored), destination);
  }
  return aliases;
}

module.exports = { rewriteReferences, legacyAliases, copyLegacyAliases };
