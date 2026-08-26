#!/usr/bin/env node
/**
 * validate-cms.js — static validation of the admin panel's configuration.
 *
 * Separate from scripts/validate.js on purpose. The site validator answers "is
 * the published content correct?"; this one answers "can the CMS damage it?".
 * Mixing them would make the main validator depend on CMS tooling that has
 * nothing to do with the deployed site.
 *
 * It is STATIC: no browser, no proxy, no network. The one thing it does execute
 * is a pair of Eleventy builds, because "a normal build does not publish the
 * admin panel" is a claim worth proving rather than asserting. dist/ is
 * gitignored build output, and this script leaves it in the NORMAL production
 * state when it finishes.
 *
 * Run:  npm run validate:cms
 */

"use strict";

const fs = require("fs");
const path = require("path");
const jsyaml = require("js-yaml");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const cms = require(path.join(ROOT, "src", "_data", "cmsConfig.js"));
const config = cms.buildConfig();

let failures = 0;
const results = [];
const assert = (ok, pass, fail, detail) => {
  if (!ok) failures++;
  results.push({ ok, label: ok ? pass : fail, detail: ok ? null : detail });
};
const section = (t) => results.push({ section: t });

const rel = (p) => path.join(ROOT, p);
const exists = (p) => fs.existsSync(rel(p));
const read = (p) => fs.readFileSync(rel(p), "utf8");

const team = config.collections.find((c) => c.name === "team");
const settings = config.collections.find((c) => c.name === "settings");
const settingsFile = settings && settings.files.find((f) => f.name === "academic_year");
const field = (name) => (team.fields || []).find((f) => f.name === name);

/* =================================================================== 1 */
section("1. Team collection targets the existing canonical content");

assert(team !== undefined, "a Team collection exists", "no Team collection is defined");
assert(team.folder === "content/team",
  "the Team collection points at content/team/",
  `the Team collection points somewhere else: ${team && team.folder}`);
assert(exists("content/team"), "content/team/ exists on disk", "content/team/ is missing");
assert(team.extension === "yaml" && team.format === "yaml",
  "the Team collection is declared as pure YAML (extension + format)",
  `extension/format are ${team.extension}/${team.format}, expected yaml/yaml`);

{
  // The declared extension must be the one the repository already uses, or the
  // CMS would create a second, invisible set of records.
  const onDisk = [...new Set(fs.readdirSync(rel("content/team"))
    .filter((f) => /\.ya?ml$/i.test(f))
    .map((f) => f.split(".").pop().toLowerCase()))];
  assert(onDisk.length === 1 && onDisk[0] === team.extension,
    `the declared extension matches every record on disk (.${team.extension})`,
    "the declared extension does not match the records on disk", onDisk.join(", "));
}

assert(team.create === true, "creating new Team records is enabled",
  "Team creation is disabled, so next year's committee could not be added");
assert(team.delete === false,
  "deleting Team records from the CMS is disabled (history is protected)",
  "the CMS is allowed to delete Team records");

/* =================================================================== 2 */
section("2. Academic-year handling");

/*
  Phase 17C.2 replaced free text with a dropdown.

  The field used to be a `string` with a regex, and this section used to assert
  the regex accepted future years and rejected malformed ones. A real editor
  typed a year by hand and got it wrong, which is why the field is now a
  `select`: a malformed year is no longer possible to enter, so a pattern that
  rejects one has nothing left to guard.

  What matters now is different, and is asserted instead: the list is generated
  rather than written down, it is the SAME list everywhere a year is chosen, and
  it reaches far enough ahead that nobody edits config each summer.
*/
{
  const ay = field("academic_year");
  assert(ay !== undefined, "the Team form has an academic_year field",
    "academic_year is not editable");
  assert(ay && ay.required === true, "academic_year is required",
    "academic_year is optional, so a record could be created with no year");
  assert(ay && ay.widget !== "hidden",
    "academic_year is visible to the editor (not hidden)",
    "academic_year is hidden — the editor could not see which year they are editing");
  assert(ay && ay.widget === "select",
    "academic_year is chosen from a list, so a mistyped year cannot be saved",
    `academic_year uses the ${ay && ay.widget} widget, which lets an editor type free text`);
  assert(ay && Array.isArray(ay.options) && ay.options.length > 1,
    "the academic-year dropdown offers a list of years",
    "the academic-year dropdown has no options");
  assert(ay && typeof ay.hint === "string" && /new record/i.test(ay.hint),
    "the academic-year field warns against re-yearing an old record",
    "the academic-year field has no rollover guidance");

  // Every offered value must be a well-formed academic year by the ONE parser
  // the build uses — not by a second regex written here, which could drift.
  const bad = (ay.options || []).filter((v) => cms.parseAcademicYear(v) === null);
  assert(bad.length === 0,
    "every offered year parses as a real academic year",
    `these offered years are malformed: ${bad.join(", ")}`,
    `${(ay.options || []).length} years offered`);

  // The list must cover the current year and reach years ahead of it, or an
  // editor preparing next season would be stuck.
  const current = cms.currentAcademicYear();
  assert((ay.options || []).includes(current),
    "the dropdown includes the current academic year",
    `the current year ${current} is not offered`, current);
  const ahead = (ay.options || []).filter(
    (v) => cms.parseAcademicYear(v) > cms.parseAcademicYear(current));
  assert(ahead.length >= 5,
    "the dropdown reaches at least five years ahead, so no yearly config edit is needed",
    `only ${ahead.length} future year(s) are offered`, `${ahead.length} ahead`);

  // Divergent lists are the failure this replaces: one collection offering a
  // year another does not is how half a season ends up unreachable.
  const expected = JSON.stringify(ay.options);
  const yearFields = [];
  const walk = (fields, where) => {
    for (const f of fields || []) {
      if (f.name === "academic_year" || f.name === "current" || f.name === "year") {
        if (f.widget === "select") yearFields.push({ where, options: f.options });
      }
      if (f.fields) walk(f.fields, where);
      if (f.field) walk([f.field], where);
    }
  };
  for (const c of cms.buildConfig().collections) {
    walk(c.fields, c.name);
    for (const file of c.files || []) walk(file.fields, `${c.name}/${file.name}`);
  }
  const divergent = yearFields.filter((f) => JSON.stringify(f.options) !== expected);
  assert(divergent.length === 0,
    "every academic-year control offers exactly the same years",
    `these offer a different list: ${divergent.map((d) => d.where).join(", ")}`,
    `${yearFields.length} controls agree`);
}

/* =================================================================== 3 */
section("3. One bilingual record per person — no language split");

{
  const en = field("en");
  const pl = field("pl");
  assert(en && en.widget === "object", "English content is a nested object widget",
    "the en block is not an object widget");
  assert(pl && pl.widget === "object", "Polish content is a nested object widget",
    "the pl block is not an object widget");
  assert(config.i18n === undefined && team.i18n === undefined,
    "Decap's top-level i18n is NOT enabled (it would restructure storage)",
    "Decap i18n is enabled — storage layout is no longer guaranteed");

  for (const [name, blk] of [["en", en], ["pl", pl]]) {
    const names = ((blk && blk.fields) || []).map((f) => f.name);
    assert(names.includes("role"), `${name}.role exists`, `${name}.role is missing`);
    assert(names.includes("photo_alt"), `${name}.photo_alt exists`, `${name}.photo_alt is missing`);
    const role = (blk.fields || []).find((f) => f.name === "role");
    assert(role && role.required === true, `${name}.role is required`,
      `${name}.role is optional, but the site requires both roles`);
  }

  // Nothing may configure a per-language folder or filename.
  const asText = JSON.stringify(config);
  assert(!/content\/team\/(en|pl)\b/.test(asText),
    "no per-language Team folder is configured",
    "a per-language Team folder appears in the configuration");
  assert(!/\{\{locale\}\}|\.en\.yaml|\.pl\.yaml/.test(asText),
    "no per-language Team filename is configured",
    "a per-language Team filename appears in the configuration");

  const split = fs.readdirSync(rel("content/team"))
    .filter((f) => /[-.](en|pl)\.ya?ml$/i.test(f) || /^(en|pl)[-.]/i.test(f));
  assert(split.length === 0, "no language-split record exists on disk",
    "language-split records found", split.join(", "));
}

/* =================================================================== 4 */
section("4. Collision-safe filenames");

assert(team.slug === "{{fields.slug}}",
  "the filename is the record's own slug field, so it is unique by construction",
  `the slug template is ${JSON.stringify(team.slug)}, which may not be unique across years`);
{
  const slug = field("slug");
  assert(slug && slug.required === true, "the slug field is required",
    "the slug field is optional, so Decap would have to invent a filename");
  assert(slug && Array.isArray(slug.pattern),
    "the slug field is pattern-validated (filesystem and URL safe)",
    "the slug field has no pattern");
  const re = slug && new RegExp(slug.pattern[0]);
  const bad = ["Jane Example", "jane_example", "../escape", "jane/example", "JANE", ""]
    .filter((v) => re.test(v));
  assert(bad.length === 0, "the slug pattern rejects spaces, slashes, capitals and traversal",
    "the slug pattern accepts an unsafe value", bad.join(" | "));
  assert(re.test("jane-example") && re.test("jane-example-2026-27"),
    "the slug pattern accepts both a bare name and a year-suffixed name",
    "the slug pattern rejects the documented naming convention");
  assert(slug && /unique/i.test(String(slug.hint)),
    "the slug field explains that IDs must be unique across years",
    "the slug field does not warn about collisions");
}
{
  // Every record on disk already satisfies the invariant the site validator
  // enforces, so the CMS convention is consistent with the existing content.
  const files = fs.readdirSync(rel("content/team")).filter((f) => /\.ya?ml$/i.test(f));
  const mismatch = files.filter((f) => {
    const rec = jsyaml.load(read(`content/team/${f}`)) || {};
    return `${rec.slug}.yaml` !== f;
  });
  assert(mismatch.length === 0,
    `all ${files.length} records already have slug === filename`,
    "records whose slug does not match their filename", mismatch.join(", "));
}

/* =================================================================== 5 */
section("5. Team media");

{
  const photo = field("photo");
  assert(photo && photo.widget === "image", "the photograph field is an image widget",
    "the photograph field is not an image widget");
  assert(photo && photo.required === false,
    "a photograph is optional (one current member has none)",
    "the photograph field is required, which would break the null-photo member");

  // Decap omits the key when the field is left empty and cannot be configured to
  // write an explicit null — Phase 17A verified this directly. A `default` here
  // would be configuration that looks like it does something and does not.
  assert(photo && !("default" in photo),
    "the photograph field declares no `default` (Decap would not honour one)",
    "the photograph field declares a default that Decap demonstrably ignores");

  // The corresponding half of the rule, on the repository side.
  {
    const v = read("scripts/validate.js");
    assert(/photo` may be ABSENT or explicitly NULL/.test(v),
      "the repository validator documents that an absent photo is legal",
      "scripts/validate.js no longer states the absent-or-null rule");
    assert(!/photo \(may be null, but must be present\)/.test(v),
      "the old must-be-present photo rule is gone",
      "scripts/validate.js still requires the photo key to be present");
    const rec = read("src/_data/records.js");
    assert(/record\.photo === undefined\) record\.photo = null/.test(rec),
      "the build normalises an absent photo to null at the loading boundary",
      "src/_data/records.js does not normalise a missing photo key");
    assert(!/has_photo|photo_enabled|photo_missing/.test(rec + v),
      "no second stored field was introduced to track photo presence",
      "a redundant photo-presence field has been added");
  }
  assert(photo && photo.media_folder === "/assets/team",
    "uploads go to the existing team headshot directory",
    `uploads would go to ${photo && photo.media_folder}`);
  assert(photo && photo.public_folder === "/assets/team",
    "stored paths are root-relative under /assets/team",
    `stored paths would be ${photo && photo.public_folder}`);
  assert(photo && String(photo.public_folder).startsWith("/"),
    "the stored path is root-relative, so Polish pages cannot request /pl/assets/",
    "the stored path is not root-relative and would break under /pl/");
  assert(photo && photo.choose_url === false,
    "arbitrary URL insertion is disabled (no external hotlinking)",
    "editors could paste an external image URL");
  assert(exists("assets/team"), "assets/team/ exists on disk", "assets/team/ is missing");

  // The site validator requires this exact prefix.
  assert(String(photo.public_folder).startsWith("/assets/team"),
    "the configured path satisfies scripts/validate.js's /assets/team/ rule",
    "the configured path would fail the site validator");
}
{
  // Nothing anywhere may produce a /pl/-prefixed asset path.
  const asText = JSON.stringify(config);
  assert(!/\/pl\/assets/.test(asText),
    "no /pl/assets/ path can be produced by this configuration",
    "a /pl/assets/ path appears in the configuration");
  assert(String(config.public_folder).startsWith("/"),
    "the global public folder is root-relative too",
    `the global public folder is ${config.public_folder}`);
}

/* =================================================================== 6 */
section("6. Group and ordering fields");

{
  const group = field("group");
  assert(group && group.widget === "select",
    "the team group is a select, so a typo cannot invent a group",
    "the team group is free text");
  const cfgGroups = (jsyaml.load(read("content/settings/team-groups.yaml")) || {}).groups || [];
  const keys = cfgGroups.map((g) => g.key);
  const optionValues = (group.options || []).map((o) => o.value);
  assert(JSON.stringify(optionValues) === JSON.stringify(keys),
    `the six group options are derived from team-groups.yaml (${keys.join(", ")})`,
    "the CMS group options have drifted from team-groups.yaml",
    `config: ${optionValues.join(", ")} | source: ${keys.join(", ")}`);
  assert((group.options || []).every((o) => o.label && o.value),
    "each option shows a human label but stores the canonical key",
    "an option is missing its label or value");

  const order = field("order");
  assert(order && order.widget === "number" && order.value_type === "int",
    "display position is a whole-number field",
    "display position is not an integer number field");
  assert(order && order.min === 1, "display position starts at 1",
    `display position minimum is ${order && order.min}`);
  assert(order && /within this group and this academic year/i.test(String(order.hint)),
    "the ordering hint states the real scope (group + academic year)",
    "the ordering hint does not describe the scope the build uses");
}

/* =================================================================== 7 */
section("7. Site settings collection");

assert(settingsFile !== undefined, "a Current-academic-year settings entry exists",
  "no academic-year settings entry is configured");
assert(settingsFile && settingsFile.file === "content/settings/academic-year.yaml",
  "it points at the real central setting file",
  `it points at ${settingsFile && settingsFile.file}`);
assert(exists("content/settings/academic-year.yaml"),
  "content/settings/academic-year.yaml exists on disk", "the settings file is missing");
{
  const names = (settingsFile.fields || []).map((f) => f.name);
  const onDisk = Object.keys(jsyaml.load(read("content/settings/academic-year.yaml")) || {});
  const dropped = onDisk.filter((k) => !names.includes(k));
  assert(dropped.length === 0,
    `every key in the settings file is a configured field (${onDisk.join(", ")})`,
    "keys that a CMS save would silently drop", dropped.join(", "));
  // A dropdown since Phase 17C.2 — see the note in section 2. This is the one
  // setting that changes what the whole site treats as "now", so a mistyped
  // value here would be the most damaging free-text field in the CMS.
  const cur = (settingsFile.fields || []).find((f) => f.name === "current");
  assert(cur && cur.required === true && cur.widget === "select",
    "the current-year field is required and chosen from a list",
    "the current-year field is optional or accepts free text");
  assert(cur && Array.isArray(cur.options) &&
    cur.options.every((v) => cms.parseAcademicYear(v) !== null),
    "every year the rollover control offers is a real academic year",
    "the rollover control offers a malformed year",
    `${(cur && cur.options || []).length} years offered`);
  assert(/does NOT move or delete/i.test(String(settingsFile.description)) &&
    /does NOT move or delete/i.test(String(cur.hint)),
    "the rollover warning is shown on the entry and on the field",
    "the rollover warning is missing");
}
{
  // Only the academic year is exposed. team-groups.yaml sits in the same folder
  // and is structural configuration, not editorial content.
  const files = (settings.files || []).map((f) => f.file);
  assert(files.length === 1 && !files.some((f) => /team-groups/.test(f)),
    "no unrelated technical configuration is exposed for editing",
    "the settings collection exposes more than the academic year", files.join(", "));
}

/* =================================================================== 8 */
section("8. No credentials, no production authentication");

{
  /**
   * These files DESCRIBE the authentication that is deliberately absent, so a
   * naive text search finds "OAuth" and "Netlify Identity" in the very comments
   * explaining that neither is used. Scanning the stripped source instead tests
   * what the code does rather than what its documentation says.
   *
   * Comments are removed only at the start of a line, so a `//` inside a URL
   * string — proxy_url is exactly that — is never mistaken for one.
   */
  const stripJs = (t) => t
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
  const stripMarkup = (t) => t
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^---\n[\s\S]*?\n---\n/, "")       // Nunjucks front matter
    .split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

  const configText = cms.configYaml();
  const sources = {
    "src/_data/cmsConfig.js": stripJs(read("src/_data/cmsConfig.js")),
    "src/admin/index.njk": stripMarkup(read("src/admin/index.njk")),
    "src/admin/config.njk": stripMarkup(read("src/admin/config.njk")),
    "generated config.yml": stripMarkup(configText),
  };

  // The stripper must not have removed the thing under test.
  assert(/proxy_url/.test(sources["src/_data/cmsConfig.js"]),
    "comment stripping preserved the real configuration",
    "the comment stripper removed live code — the scan below would be meaningless");

  const FORBIDDEN = [
    [/git-gateway/i, "Git Gateway"],
    [/netlify-?identity/i, "Netlify Identity"],
    [/\bclient_id\b|\bclient_secret\b/i, "an OAuth client credential"],
    [/oauth/i, "OAuth"],
    [/\bgh[pousr]_[A-Za-z0-9]{16,}/, "a GitHub token"],
    [/\bnfp_[A-Za-z0-9]{16,}/, "a Netlify token"],
    [/[A-Za-z0-9_-]*(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"'\s]{8,}["']/i, "a hardcoded secret"],
  ];
  for (const [file, text] of Object.entries(sources)) {
    for (const [re, what] of FORBIDDEN) {
      assert(!re.test(text), `${file}: no ${what}`,
        `${file} appears to contain ${what}`);
    }
  }

  assert(config.backend.name === "proxy",
    "the backend is the local file-system proxy, not a hosted git provider",
    `the backend is ${config.backend.name}`);
  assert(/^http:\/\/localhost:\d+\/api\/v1$/.test(config.backend.proxy_url),
    "the proxy URL is a localhost address",
    `the proxy URL is ${config.backend.proxy_url}`);
  assert(!("local_backend" in config),
    "`local_backend: true` is not used (the proxy backend is declared explicitly)",
    "local_backend appears in the configuration");

  // No Windows path, no drive letter, no file:// URL anywhere. Checked against
  // the RAW text: an absolute path is a leak even inside a comment.
  for (const file of Object.keys(sources)) {
    const raw = file === "generated config.yml" ? configText : read(file);
    assert(!/[A-Za-z]:[\\/]{1,2}Users|file:\/\/\//.test(raw),
      `${file}: no absolute local filesystem path`,
      `${file} contains an absolute local path`);
  }
}

/* =================================================================== 9 */
section("9. The transcribed serializer still matches the installed package");

{
  // scripts/test-cms-roundtrip.js re-implements Decap's YAML format module.
  // If the package changes shape, that transcription is silently wrong.
  const p = "node_modules/decap-cms-core/dist/esm/formats/yaml.js";
  assert(exists(p), "decap-cms-core's YAML format module is present", "the format module is missing");
  if (exists(p)) {
    const src = read(p);
    const markers = [
      ["yaml.createNode(data)", /yaml\.createNode\(data\)/],
      ["sortKeys(sortedKeys", /sortKeys\(sortedKeys/],
      ["doc.toJSON()", /doc\.toJSON\(\)/],
      ["new yaml.Document()", /new yaml\.Document\(\)/],
    ];
    for (const [label, re] of markers) {
      assert(re.test(src), `the serializer still uses ${label}`,
        `decap-cms-core has changed: ${label} is gone — re-check scripts/test-cms-roundtrip.js`);
    }
  }
}

/* =================================================================== 10 */
section("10. No CMS test record remains in the repository");

{
  const files = fs.readdirSync(rel("content/team")).filter((f) => /\.ya?ml$/i.test(f));
  const suspicious = files.filter((f) => /cms-test|test-person|dummy|example|placeholder|delete-?me/i.test(f));
  assert(suspicious.length === 0, "content/team/ holds no CMS test record",
    "leftover CMS test records", suspicious.join(", "));

  const byContent = files.filter((f) => {
    const r = jsyaml.load(read(`content/team/${f}`)) || {};
    return /cms test|test person|\.invalid\b|example\.com/i.test(
      [r.name, r.email, r.linkedin, r.en && r.en.role].join(" "));
  });
  assert(byContent.length === 0, "no record contains test contact details",
    "records with test contact details", byContent.join(", "));

  // The team-photo directory must not collect test uploads either.
  const photos = fs.readdirSync(rel("assets/team"))
    .filter((f) => /cms-test|test-person|dummy|delete-?me/i.test(f));
  assert(photos.length === 0, "assets/team/ holds no test upload",
    "leftover test uploads", photos.join(", "));

  const years = [...new Set(files.map((f) => (jsyaml.load(read(`content/team/${f}`)) || {}).academic_year))];
  assert(years.length === 1 && years[0] === "2025/26",
    `every record is still ${years.join(", ")} — no stray future-year test record`,
    "unexpected academic years present", years.join(", "));
}

/* =================================================================== 11 */
section("11. The admin panel is development-only (proved by building)");

{
  const run = (script) => spawnSync(process.execPath, [path.join(ROOT, "scripts", script)],
    { cwd: ROOT, encoding: "utf8" });

  const clean = () => spawnSync(process.execPath, [path.join(ROOT, "scripts", "clean.js")],
    { cwd: ROOT, encoding: "utf8" });

  // -- a normal production build ------------------------------------------
  clean();
  const normal = spawnSync(process.execPath,
    [path.join(ROOT, "node_modules", "@11ty", "eleventy", "cmd.cjs")],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, CMS_DEV: "" } });
  assert(normal.status === 0, "a normal `npm run build` succeeds", "the normal build failed",
    (normal.stderr || "").split("\n").slice(0, 4).join(" | "));

  assert(!fs.existsSync(rel("dist/admin")),
    "a normal build emits NO dist/admin/ at all",
    "the normal build published an admin panel");

  const leaks = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(html|js|yml|yaml|json|txt|xml)$/i.test(e.name)) continue;
      const t = fs.readFileSync(full, "utf8");
      if (/local_backend|decap-cms|proxy_url/i.test(t)) leaks.push(path.relative(rel("dist"), full));
    }
  };
  if (fs.existsSync(rel("dist"))) walk(rel("dist"));
  assert(leaks.length === 0,
    "no file in a normal build mentions local_backend, decap-cms or proxy_url",
    "CMS configuration leaked into the production build", leaks.slice(0, 5).join(", "));

  const normalCount = fs.existsSync(rel("dist"))
    ? spawnSync(process.execPath, ["-e",
      "const fs=require('fs'),p=require('path');let n=0;(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);e.isDirectory()?w(f):n++}})('dist');console.log(n)"],
      { cwd: ROOT, encoding: "utf8" }).stdout.trim()
    : "0";

  // -- the CMS development build ------------------------------------------
  clean();
  const cmsBuild = run("build-cms.js");
  assert(cmsBuild.status === 0, "`npm run build:cms` succeeds", "the CMS build failed",
    (cmsBuild.stderr || "").split("\n").slice(0, 4).join(" | "));
  /*
    The admin lives in .cms/, NOT in dist/.

    Phase 17C.2 moved it. While it was built into dist/, every command that
    rebuilt or cleaned the site — `npm run build`, `npm run clean`, and the
    validators, including this one — deleted the admin out from under a CMS an
    editor had open. Decap lazy-loads around ninety code-split chunks, so the
    already-loaded page kept working from memory while any chunk not yet fetched
    returned 404. That is what the "Failed to fetch" reports were, and why they
    looked random: which chunks were cached differed between people.

    Asserting the LOCATION is therefore a real safety check, not bookkeeping.
  */
  assert(fs.existsSync(rel(".cms/admin/index.html")),
    "the CMS build publishes .cms/admin/index.html, outside the site build",
    "the CMS build produced no admin page");
  assert(fs.existsSync(rel(".cms/admin/config.yml")),
    "the CMS build publishes .cms/admin/config.yml",
    "the CMS build produced no admin configuration");
  assert(fs.existsSync(rel(".cms/admin/decap-cms.js")),
    "the pinned Decap bundle is vendored beside it (no CDN)",
    "the Decap bundle was not copied");
  assert(!fs.existsSync(rel("dist/admin")),
    "the CMS build writes nothing into dist/, so a site build cannot break the CMS",
    "the CMS build still writes into dist/");

  if (fs.existsSync(rel(".cms/admin/index.html"))) {
    const html = read(".cms/admin/index.html");
    assert(/name="robots"[^>]*noindex/i.test(html), "the admin page is noindex",
      "the admin page is not marked noindex");
    assert(/name="viewport"/i.test(html), "the admin page declares a responsive viewport",
      "the admin page has no viewport meta");
    assert(/<title>Federation Content Manager<\/title>/.test(html),
      "the admin page is titled Federation Content Manager", "unexpected admin page title");
    assert(/src="\.\/decap-cms\.js"/.test(html),
      "the admin page loads the local bundle, not a remote URL",
      "the admin page loads a remote script");
    assert(!/https?:\/\/(unpkg|cdn|jsdelivr)/i.test(html),
      "the admin page references no CDN", "the admin page references a CDN");
    // Comments removed first: the page explains in prose which authentication
    // it deliberately omits, and that prose is not markup.
    //
    // CSS block comments are stripped for the same reason. The admin stylesheets
    // are inlined into this page and their comments explain, in words, that
    // `css/style.css` is a live deployed file which must not be edited for CMS
    // presentation. Scanning that sentence for the string "style.css" reported a
    // leak that does not exist — the check is about what the page LOADS, not
    // about which files its comments discuss.
    const markup = html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert(!/style\.css|js\/main\.js|analytics|gtag|plausible/i.test(markup),
      "the admin page pulls in no site stylesheet, site script or analytics",
      "the admin page loads unrelated site assets");
    assert(!/<nav[\s>]|netlify-?identity|identity\.js/i.test(markup),
      "the admin page carries no public navigation and no identity widget",
      "the admin page contains navigation or an identity widget");
    // Two: the vendored Decap bundle, and the inline duplicate-ID guard. Any
    // third script would be something nobody deliberately added.
    assert((markup.match(/<script/gi) || []).length === 2,
      "the admin page loads exactly two scripts (the Decap bundle and the ID guard)",
      `the admin page loads ${(markup.match(/<script/gi) || []).length} scripts`);
    assert((markup.match(/<script[^>]*\ssrc=/gi) || []).length === 1,
      "only one script is loaded from a file; the guard is inline",
      "an unexpected external script is loaded");
    assert(/registerEventListener/.test(markup) && /"preSave"/.test(markup),
      "the duplicate-ID guard uses Decap's public preSave event",
      "the duplicate-ID guard is missing from the admin page");
    assert(/with this ID already exists/.test(markup) &&
      /The existing record has not been changed/.test(markup),
      "the guard gives the editor a specific message naming the conflict",
      "the guard has no editor-facing message");
    assert(/COLLECTIONS/.test(markup) && /entriesByFolder/.test(markup),
      "the guard covers every folder collection, not just one",
      "the guard is hardcoded to a single collection");
    // Reaching into Decap specifically — not any use of Object.prototype, which
    // the embedded helpers legitimately use for hasOwnProperty checks.
    assert(!/CMS\.__|_reduxStore|window\.CMS\.[a-z]+\s*=|CMS\.[A-Za-z]+\.prototype|Object\.defineProperty\(\s*window\.CMS/.test(markup),
      "the guard does not monkey-patch Decap internals",
      "the guard reaches into Decap's internals");
  }

  // -- leave dist/ in the production state --------------------------------
  clean();
  const restore = spawnSync(process.execPath,
    [path.join(ROOT, "node_modules", "@11ty", "eleventy", "cmd.cjs")],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, CMS_DEV: "" } });
  assert(restore.status === 0 && !fs.existsSync(rel("dist/admin")),
    `dist/ was rebuilt in the normal production state (${normalCount} files, no admin/)`,
    "failed to restore dist/ to the production build");
}

/* =================================================================== 13 */
section("13. Announcements collection (Phase 17B)");

const ann = config.collections.find((c) => c.name === "announcements");
const annField = (name) => ((ann && ann.fields) || []).find((f) => f.name === name);

assert(ann !== undefined, "an Announcements collection exists", "no Announcements collection");
assert(ann && ann.folder === "content/announcements",
  "it points at the canonical content/announcements/",
  `it points at ${ann && ann.folder}`);
assert(exists("content/announcements"), "content/announcements/ exists on disk",
  "the announcements folder is missing");
assert(ann && ann.extension === "yaml" && ann.format === "yaml",
  "announcements are stored as pure YAML",
  `extension/format are ${ann && ann.extension}/${ann && ann.format}`);
assert(ann && ann.create === true, "creating announcements is enabled",
  "announcement creation is disabled");
assert(ann && ann.slug === "{{fields.slug}}",
  "the filename is the record's own Record ID",
  `the slug template is ${JSON.stringify(ann && ann.slug)}`);
{
  const onDisk = [...new Set(fs.readdirSync(rel("content/announcements"))
    .filter((f) => /\.ya?ml$/i.test(f)).map((f) => f.split(".").pop().toLowerCase()))];
  assert(onDisk.length === 1 && onDisk[0] === ann.extension,
    `the declared extension matches every record on disk (.${ann.extension})`,
    "the declared extension does not match the records on disk", onDisk.join(", "));
}
assert(ann && /academic_year/.test(String(ann.summary)),
  "the collection summary shows the academic year",
  "the summary does not distinguish academic years", ann && ann.summary);

/* -- academic year and ordering -------------------------------------------- */
{
  // A dropdown since Phase 17C.2 — see the note in section 2. The old
  // assertions here tested a regex that no longer exists, because free text no
  // longer exists.
  const y = annField("academic_year");
  assert(y && y.required === true && y.widget === "select",
    "academic_year is a required, visible dropdown",
    "academic_year is missing, optional, hidden or free text");
  assert(y && Array.isArray(y.options) &&
    y.options.every((v) => cms.parseAcademicYear(v) !== null),
    "every year the announcement form offers is a real academic year",
    "the announcement year dropdown offers a malformed year",
    `${(y && y.options || []).length} years offered`);
  assert(y && /never change this on an old announcement/i.test(String(y.hint)),
    "the year field warns against re-yearing an old announcement",
    "the year field has no archive warning");

  const o = annField("order");
  assert(o && o.widget === "number" && o.value_type === "int",
    "display position is a whole-number field",
    "display position is not an integer field");
  assert(o && /within this academic year only/i.test(String(o.hint)),
    "the ordering hint states the real scope (per academic year)",
    "the ordering hint does not describe the scope the build uses");
}

/* -- bilingual, one record --------------------------------------------------- */
{
  for (const [name, label] of [["en", "English"], ["pl", "Polish"]]) {
    const blk = annField(name);
    assert(blk && blk.widget === "object", `${label} content is a nested object widget`,
      `the ${name} block is not an object widget`);
    const names = ((blk && blk.fields) || []).map((f) => f.name);
    for (const f of ["title", "subtitle", "body", "link_label"]) {
      assert(names.includes(f), `${name}.${f} exists`, `${name}.${f} is missing`);
    }
  }
  assert(ann.i18n === undefined,
    "Decap i18n is NOT enabled on announcements (storage layout stays fixed)",
    "Decap i18n is enabled on announcements");
  const asText = JSON.stringify(ann);
  assert(!/content\/announcements\/(en|pl)\b/.test(asText) && !/\.en\.yaml|\.pl\.yaml/.test(asText),
    "no per-language announcement folder or filename is configured",
    "a per-language announcement path appears in the configuration");
  const split = fs.readdirSync(rel("content/announcements"))
    .filter((f) => /[-.](en|pl)\.ya?ml$/i.test(f) || /^(en|pl)[-.]/i.test(f));
  assert(split.length === 0, "no language-split announcement exists on disk",
    "language-split announcements found", split.join(", "));
}

/* -- Markdown safety --------------------------------------------------------- */
{
  for (const loc of ["en", "pl"]) {
    const body = (annField(loc).fields || []).find((f) => f.name === "body");
    assert(body && body.widget === "markdown", `${loc}.body uses the Markdown widget`,
      `${loc}.body is a ${body && body.widget} widget`);
    assert(body && Array.isArray(body.editor_components) && body.editor_components.length === 0,
      `${loc}.body offers no editor components (no HTML block)`,
      `${loc}.body exposes editor components`);
    const buttons = (body && body.buttons) || [];
    assert(buttons.length > 0 && !buttons.some((b) => /code-block|image|html/i.test(b)),
      `${loc}.body's toolbar is limited to safe inline formatting`,
      `${loc}.body offers a button that can introduce markup`, buttons.join(", "));
  }
  // The actual security boundary lives in the build, not the CMS.
  const cfg = read("eleventy.config.js");
  assert(/html:\s*false/.test(cfg),
    "markdown-it is still configured with html: false (raw HTML is not rendered)",
    "the Markdown renderer no longer disables raw HTML");
  assert(!/html:\s*true/.test(cfg),
    "no Markdown renderer in the build enables raw HTML",
    "a Markdown renderer enables raw HTML");
}

/* -- media ------------------------------------------------------------------- */
{
  const img = annField("image");
  assert(img && img.widget === "image" && img.required === false,
    "the main image is an optional image field",
    "the main image field is missing or required");
  assert(img && img.media_folder === "/assets/announcements" &&
    img.public_folder === "/assets/announcements",
    "uploads go to the existing announcement asset folder",
    `uploads would go to ${img && img.media_folder}`);
  assert(img && img.choose_url === false,
    "arbitrary URL insertion is disabled for the main image",
    "editors could paste an external image URL");
  assert(!("default" in (img || {})),
    "the main image declares no `default` (Decap would not honour one)",
    "the main image declares a default Decap ignores");

  const extra = annField("extra_images");
  assert(extra && extra.widget === "list",
    "extra images are an ordered list", "extra images are not a list widget");
  assert(extra && extra.field && extra.field.widget === "image",
    "each extra image is an image field", "extra images are not image fields");
  assert(extra && extra.field && extra.field.choose_url === false,
    "extra images cannot be external URLs either",
    "extra images allow arbitrary URLs");
  assert(extra && !extra.fields,
    "extra images stay a list of plain paths, matching the canonical records",
    "extra images were restructured into objects");

  assert(!/\/pl\/assets/.test(JSON.stringify(ann)),
    "no /pl/assets/ path can be produced by the announcements configuration",
    "a /pl/assets/ path appears in the configuration");

  // The build normalises an absent optional field to null, as for Team photos.
  const rec = read("src/_data/records.js");
  assert(/dirName === "announcements"/.test(rec) && /record\[key\] === undefined\) record\[key\] = null/.test(rec),
    "the build normalises absent announcement fields to null",
    "src/_data/records.js does not normalise absent announcement fields");
}

/* -- image presentation ------------------------------------------------------ */
{
  const fit = annField("image_fit");
  assert(fit && fit.widget === "select", "image fit is a select, not free text",
    "image fit is free text and could take any CSS value");
  const values = (fit.options || []).map((o) => o.value);
  const supported = (read("scripts/validate.js").match(/SUPPORTED_FIT = new Set\(\[([^\]]*)\]/) || [])[1] || "";
  const fromValidator = supported.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  assert(JSON.stringify(values) === JSON.stringify(fromValidator),
    `image-fit options match scripts/validate.js exactly (${values.join(", ")})`,
    "the CMS image-fit options have drifted from the validator",
    `cms: ${values.join(", ")} | validator: ${fromValidator.join(", ")}`);
  assert((fit.options || []).every((o) => o.label && o.label !== o.value),
    "image fit shows a human label rather than the raw stored value",
    "image fit exposes the raw value as its label");

  /*
    A dedicated control since Phase 17C.3.

    This used to be a `string` with a hex pattern. The pattern kept bad values
    out but told an editor nothing about what a good one looked like, and left
    them typing raw hex with no idea which colours the site actually uses. The
    field is now the Brand colour widget: swatches read from the real
    stylesheets, a picker, and a hex box for anything else.

    The stored value is unchanged — still a plain `#rrggbb` string — so no
    content needed rewriting. What is asserted here is that the safety did not
    move out of the way when the control changed: the widget validates, and the
    pre-save guard canonicalises whatever spelling was typed.
  */
  const bg = annField("image_background");
  assert(bg && bg.widget === "brandColour",
    "the backdrop colour uses the Brand colour control, not a bare text box",
    `the backdrop colour uses the ${bg && bg.widget} widget`);

  const palette = cms.brandPalette();
  assert(palette.length > 0 && palette.every((c) => /^#[0-9a-f]{6}$/.test(c.hex)),
    "every offered brand colour is a canonical six-digit hex value",
    "a brand colour is not canonical hex",
    `${palette.length} colours offered`);
  assert(palette.every((c) => typeof c.name === "string" && c.name.trim() && !/^--/.test(c.name)),
    "every brand colour is named in words rather than by its CSS variable",
    "a brand colour is labelled with a raw variable name");

  // The palette is generated. A hard-coded copy would drift from the site.
  {
    const cfgSrc = read("src/_data/cmsConfig.js");
    assert(/fs\.readFileSync[\s\S]{0,200}css/.test(cfgSrc) || /BRAND_PALETTE_SOURCE/.test(cfgSrc),
      "the palette is read from the site's own stylesheets, not copied by hand",
      "the palette appears to be hard-coded");
    // and the colours it produces must really appear in those stylesheets
    const css = read("css/style.css") + read("css/pbf.css");
    const missing = palette.filter((c) => !css.toLowerCase().includes(c.hex));
    assert(missing.length === 0,
      "every offered colour genuinely appears in the site's stylesheets",
      `these are not in the CSS: ${missing.map((m) => m.hex).join(", ")}`,
      `${palette.length} checked`);
  }

  // Canonicalisation, exercised on the real function the admin page embeds.
  {
    const cases = [
      ["#ABC", "#aabbcc"], ["abc", "#aabbcc"], ["AABBCC", "#aabbcc"],
      ["#001F62", "#001f62"], ["#001f62", null], ["not-a-colour", null],
      ["#12345", null], ["", null], [null, null],
    ];
    const wrong = cases.filter(([input, want]) => cms.canonicalColour(input) !== want);
    assert(wrong.length === 0,
      "a colour is stored in one spelling however it was typed",
      `these were canonicalised wrongly: ${wrong.map(([i]) => JSON.stringify(i)).join(", ")}`,
      `${cases.length} spellings checked`);

    const admin = read("src/admin/index.njk");
    assert(/canonicalColour\(data\[ckey\]\)/.test(admin),
      "the admin page canonicalises colours before saving",
      "the colour guard is not wired into the save");
    assert(/cmsConfig\.colourSource/.test(admin),
      "the admin page embeds the colour guard rather than a second copy",
      "embedded, not duplicated");
  }

  /*
    A VISUAL control since Phase 17C.3.

    This used to assert the field stayed FREE TEXT, on the reasoning that real
    records hold percentages no dropdown could contain. The premise was right and
    the conclusion wrong: the answer to "no finite list fits" was never a text box
    in which a non-technical editor had to type `center 30%` with no way to see
    what it did. It is a control that shows the actual crops.

    The stored value is unchanged — still the same position string the live site's
    data file holds — so nothing was migrated and the comparison stays exact.
  */
  const pos = annField("image_position");
  assert(pos && pos.widget === "focalPoint" && pos.required === false,
    "the image focus is a visual control, and still optional",
    `the image focus uses the ${pos && pos.widget} widget`);
  assert(pos && pos.value_format === "css",
    "the announcement focus keeps its existing stored form, so no record needed rewriting",
    `value_format: ${pos && pos.value_format}`);
  assert(pos && Array.isArray(pos.frames) && pos.frames.length === 2,
    "both real crops are previewed, because one value serves the card and the pop-up",
    `${pos && pos.frames ? pos.frames.length : 0} frames`);

  {
    // The frames must match the CSS they claim to represent.
    const css = read("css/style.css");
    const ratioOf = (sel) => {
      const m = new RegExp(`${sel}[^}]*aspect-ratio:\\s*(\\d+)\\s*/\\s*(\\d+)`).exec(css);
      return m ? `${m[1]}/${m[2]}` : null;
    };
    const cardCss = ratioOf("\\.ann-card \\.ph \\{");
    const modalCss = ratioOf("\\.modal-panel \\.ph \\{");
    const frames = (pos && pos.frames) || [];
    const asText = frames.map((f) => `${f.ratio_w}/${f.ratio_h}`);
    assert(cardCss && asText.includes(cardCss),
      `the card preview matches the real card crop (${cardCss})`,
      `css says ${cardCss}, the editor previews ${asText.join(" and ")}`);
    assert(modalCss && asText.includes(modalCss),
      `the pop-up preview matches the real pop-up crop (${modalCss})`,
      `css says ${modalCss}, the editor previews ${asText.join(" and ")}`);
  }

  {
    const admin = read("src/admin/index.njk");
    assert(/cmsConfig\.focalPointScript/.test(admin),
      "the admin page embeds the focus control", "embedded from its own file");
    const widget = read("src/admin/focal-point.js");
    assert(/registerWidget\("focalPoint"/.test(widget),
      "the focus control is registered through the documented widget API",
      "CMS.registerWidget");
    // A UI fault must never rewrite content — see §21 of the brief.
    assert(/if \(!image\)/.test(widget),
      "the control renders a message rather than a value when it has no image",
      "a missing image cannot overwrite a saved focus");
  }
}

/* -- destination links -------------------------------------------------------- */
{
  const link = annField("link");
  assert(link && link.widget === "object" && link.required === false,
    "the destination link is an optional object",
    "the destination link is missing or required");
  const sub = (n) => (link.fields || []).find((f) => f.name === n);

  const type = sub("type");
  assert(type && type.widget === "select", "the link destination is a select",
    "the link destination is free text");
  const types = (type.options || []).map((o) => o.value);
  const vSupported = (read("scripts/validate.js").match(/SUPPORTED_LINK_TYPES = new Set\(\[([^\]]*)\]/) || [])[1] || "";
  const vTypes = vSupported.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);

  // "none" is an editor-only choice: it is how somebody undoes a destination,
  // and the pre-save normaliser turns it into `link: null` before anything is
  // written. Every OTHER offered value must be a type the repository stores.
  assert(types[0] === cms.LINK_TYPE_NONE,
    'the first destination option is the editor-only "no link" choice',
    `the first option is ${JSON.stringify(types[0])}`);
  assert(!vTypes.includes(cms.LINK_TYPE_NONE),
    '"none" is never a stored link type — the validator would reject it',
    'the validator accepts "none" as a stored type');
  const stored = types.filter((t) => t !== cms.LINK_TYPE_NONE);
  const unknown = stored.filter((t) => !vTypes.includes(t));
  assert(unknown.length === 0,
    `every offered destination is a type the repository stores (${stored.join(", ")})`,
    "the CMS offers a link type the validator does not accept", unknown.join(", "));
  assert(stored.includes("event") && stored.includes("external"),
    "both real destinations are offered (Federation event, External website)",
    "a real destination is missing from the CMS");
  assert((type.options || []).every((o) => o.label && o.label !== o.value),
    "each destination shows a human label rather than its stored value",
    "a destination option exposes its raw value");
  assert(type.default === cms.LINK_TYPE_NONE,
    "a new announcement defaults to having no link",
    `the default destination is ${JSON.stringify(type.default)}`);

  // The normaliser itself, and the fact that the admin page runs the same source.
  {
    const n = cms.normaliseAnnouncementLink;
    assert(typeof n === "function", "the link normaliser is exported for testing",
      "normaliseAnnouncementLink is not exported");
    assert(n({ type: "none", event_slug: "icebreaker", url: "https://x.example/" }) === null,
      "choosing No link discards a stale event and URL");
    assert(JSON.stringify(n({ type: "event", event_slug: "icebreaker", url: "https://x.example/" }))
      === JSON.stringify({ type: "event", event_slug: "icebreaker" }),
      "choosing Federation event discards a stale external URL");
    assert(JSON.stringify(n({ type: "external", url: "https://x.example/", event_slug: "icebreaker" }))
      === JSON.stringify({ type: "external", url: "https://x.example/" }),
      "choosing External website discards a stale event slug");

    const admin = read("src/admin/index.njk");
    assert(/cmsConfig\.normaliseLinkSource/.test(admin),
      "the admin page embeds the normaliser source rather than a second copy",
      "the admin page carries its own copy of the normalisation logic");
    if (exists(".cms/admin/index.html")) {
      const built = read(".cms/admin/index.html");
      assert(/function normaliseAnnouncementLink/.test(built),
        "the built admin page contains the normaliser",
        "the normaliser is missing from the built admin page");
    }
  }

  const ev = sub("event_slug");
  assert(ev && ev.widget === "select", "the event link is a select of real events",
    "the event link is free text");
  const evValues = (ev.options || []).map((o) => o.value).sort();
  const onDisk = fs.readdirSync(rel("content/events")).filter((f) => /\.ya?ml$/i.test(f))
    .map((f) => jsyaml.load(read(`content/events/${f}`)) || {})
    .filter((e) => e.published === true).map((e) => e.slug).sort();
  assert(JSON.stringify(evValues) === JSON.stringify(onDisk),
    `event options are derived from the canonical event records (${evValues.length})`,
    "the event options have drifted from content/events/",
    `cms: ${evValues.join(", ")} | disk: ${onDisk.join(", ")}`);
  assert((ev.options || []).every((o) => o.label && o.label !== o.value),
    "each event shows its human title rather than its slug",
    "an event option exposes the raw slug as its label");
  assert(!(ev.options || []).some((o) => /\.html$/.test(String(o.value))),
    "event links store a slug, never a generated .html URL",
    "an event option stores a generated URL");

  const url = sub("url");
  assert(url && Array.isArray(url.pattern), "the external address is pattern-validated",
    "the external address accepts anything");
  const re = new RegExp(url.pattern[0]);
  const unsafe = ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd",
    "vbscript:x", "http://insecure.example/", "//protocol-relative.example/"]
    .filter((u) => re.test(u));
  assert(unsafe.length === 0,
    "the external-address pattern rejects javascript:, data:, file: and non-https schemes",
    "the pattern accepts an unsafe scheme", unsafe.join(" | "));
  assert(re.test("https://example.com/") && re.test("https://twojapolonia.tvp.pl/a,90510126"),
    "the pattern accepts ordinary https:// addresses",
    "the pattern rejects a legitimate https URL");
}

/* -- publication state -------------------------------------------------------- */
{
  const pub = annField("published");
  assert(pub && pub.widget === "boolean", "publication state is a boolean toggle",
    "publication state is not a boolean");
  /*
    REGISTRATION replaced the `signups_closed` on/off switch in Phase 17C.3.

    The old switch could only say "closed". It could not express "opens next
    week", had nowhere to put a sign-up address, and — because it sat beside the
    destination link — invited the two to be confused. Registration is now a
    block of its own with four states, and the assertions below hold it to the
    same standards the switch was held to, plus the ones the richer model needs.
  */
  assert(annField("signups_closed") === undefined,
    "the replaced sign-ups switch is gone from the form, so there is one control",
    "the old signups_closed switch is still in the announcement form");

  const reg = annField("registration");
  assert(reg && reg.widget === "object", "registration is a group of its own fields",
    `registration uses the ${reg && reg.widget} widget`);

  const regSub = (n) => ((reg && reg.fields) || []).find((f) => f.name === n);

  const state = regSub("state");
  assert(state && state.widget === "select",
    "the registration status is chosen from a list, not typed",
    `the status uses the ${state && state.widget} widget`);
  assert(state && Array.isArray(state.options) &&
    state.options.length === cms.REGISTRATION_STATES.length &&
    state.options.every((o) => cms.REGISTRATION_STATES.includes(o.value)),
    `the status offers exactly the four known states (${cms.REGISTRATION_STATES.join(", ")})`,
    "the status options have drifted from the states the site understands");
  assert(state && (state.options || []).every((o) => o.label && o.label !== o.value),
    "each status is described in words rather than by its stored value",
    "a status exposes its raw value as its label");

  // The single most important thing an editor must understand about this field:
  // nothing changes by itself, because the site is built as fixed files.
  assert(state && /does NOT change on its own|not change on its own/i.test(String(state.hint)),
    "the status hint says plainly that it never changes by itself",
    "the status hint does not explain that the state is manual");

  const regUrl = regSub("url");
  assert(regUrl && Array.isArray(regUrl.pattern) && /https/.test(regUrl.pattern[0]),
    "the registration address must be a secure https:// address",
    "the registration address accepts any text");

  // Both dates use the same safe calendar control as every other date.
  for (const n of ["opens_on", "closes_on"]) {
    const d = regSub(n);
    assert(d && d.widget === "datetime" && d.picker_utc === true &&
      d.time_format === false && d.format === "YYYY-MM-DD",
      `${n} is a timezone-safe calendar day, like every other date in the CMS`,
      `${n} is not a safe date-only control`);
  }

  // Registration and the destination link must stay separate controls: an
  // announcement can carry both, and merging them is the confusion this model
  // exists to remove.
  const link = annField("link");
  assert(link && link.name !== reg.name && link.widget === "object",
    "the destination link is a separate control from registration",
    "the link and registration controls have been merged");

  // The guard the browser runs, exercised here on the real function.
  {
    const ok = (r) => !cms.normaliseRegistration(r).error;
    const cases = [
      [{ state: "none" }, true], [{ state: "coming_soon" }, true],
      [{ state: "open", url: "https://example.com/" }, true],
      [{ state: "closed" }, true],
      [{ state: "open" }, false],
      [{ state: "open", url: "http://example.com/" }, false],
      [{ state: "open", url: "javascript:alert(1)" }, false],
      [{ state: "nonsense" }, false],
      [{ state: "open", url: "https://e.com/", opens_on: "2026-06-01", closes_on: "2026-05-01" }, false],
    ];
    const wrong = cases.filter(([r, want]) => ok(r) !== want);
    assert(wrong.length === 0,
      "the registration guard accepts every valid state and refuses every broken one",
      `these were judged wrongly: ${wrong.map(([r]) => JSON.stringify(r)).join(", ")}`,
      `${cases.length} states checked`);

    // Tidying: a state that cannot have an address must not keep one.
    const tidied = cms.normaliseRegistration({ state: "closed", url: "https://x.example/" });
    assert(tidied.registration && tidied.registration.url === null,
      "switching away from Open discards the sign-up address",
      "a closed registration kept a live sign-up address");
  }

  {
    const admin = read("src/admin/index.njk");
    assert(/normaliseRegistration\(data\.registration\)/.test(admin),
      "the admin page runs the registration guard before saving",
      "the registration guard is not wired into the save");
    assert(/cmsConfig\.announcementRegistrationSource/.test(admin),
      "the admin page embeds the guard rather than a second copy",
      "embedded, not duplicated");
  }

  /*
    Phase 17C.2 replaced the validated string with a real calendar control.

    The previous design used a `string` + pattern specifically BECAUSE Decap's
    datetime widget is timezone-sensitive: left at its defaults it converts to
    local time and can store the day before. A real editor then typed 20/05/2026
    into the free-text box, which the pattern rejected without explaining much.

    The widget is now used, made safe by configuration rather than avoided:
    `picker_utc` stops the local-time conversion, `time_format: false` removes
    the clock, and `format` fixes what is written to the file. Each of those is
    asserted below, because dropping any ONE of them silently reintroduces the
    timezone bug that produced "Mon Dec 08 2025 01:00:00 GMT+0100" in a YAML
    file in Phase 17C-a.
  */
  const date = annField("published_date");
  assert(date && date.widget === "datetime",
    "the publication date is a calendar control, so no date can be typed by hand",
    `the publication date uses the ${date && date.widget} widget`);
  assert(date && date.picker_utc === true,
    "the date picker works in UTC, so a date cannot shift to the previous day",
    "picker_utc is not set — the stored day can differ from the day chosen");
  assert(date && date.time_format === false,
    "the date picker shows no clock, so no time can be attached to a calendar day",
    "the date picker offers a time, which would be written into the file");
  assert(date && date.format === "YYYY-MM-DD",
    "the stored value is a plain calendar day",
    `the stored format is ${JSON.stringify(date && date.format)}, not YYYY-MM-DD`);
}

/* -- every date control, not just this one --------------------------------- */
{
  // Derived from the config so a date field added later is covered here on the
  // day it appears, rather than the day somebody remembers this check exists.
  const names = cms.dateFieldNames();
  const found = [];
  const walk = (fields, where) => {
    for (const f of fields || []) {
      if (names.includes(f.name) && f.widget === "datetime") found.push({ f, where });
      if (f.fields) walk(f.fields, where);
      if (f.field) walk([f.field], where);
    }
  };
  for (const c of config.collections) {
    walk(c.fields, c.name);
    for (const file of c.files || []) walk(file.fields, `${c.name}/${file.name}`);
  }

  /*
    Every registered date field must be a calendar control — but a field NAME
    may legitimately appear in more than one collection. `opens_on` and
    `closes_on` exist on both announcements and standard events since Phase
    17C.5A.2, so counting controls against names was wrong: what matters is
    that each name is represented, and that every control found is safe.
  */
  const covered = names.filter((n) => found.some(({ f }) => f.name === n));
  assert(covered.length === names.length,
    `every registered date field is a calendar control (${names.join(", ")})`,
    `these have no calendar control: ${names.filter((n) => !covered.includes(n)).join(", ")}`,
    `${found.length} controls for ${names.length} fields`);

  const unsafe = found.filter(({ f }) =>
    f.picker_utc !== true || f.time_format !== false || f.format !== "YYYY-MM-DD");
  assert(unsafe.length === 0,
    "every date control is timezone-safe and stores a plain calendar day",
    `these are not timezone-safe: ${unsafe.map((u) => `${u.where}.${u.f.name}`).join(", ")}`,
    `${found.length} controls checked`);
}

/* =================================================================== 14 */
section("14. Standard Events collection (Phase 17C-a)");

const ev = config.collections.find((c) => c.name === "standard_events");
const evField = (n) => ((ev && ev.fields) || []).find((f) => f.name === n);
const evLocale = (loc, n) => ((evField(loc) || {}).fields || []).find((f) => f.name === n);

assert(ev !== undefined, "a Standard Events collection exists", "no Standard Events collection");
assert(ev && ev.folder === "content/events",
  "it points at the canonical content/events/", `it points at ${ev && ev.folder}`);
assert(ev && ev.extension === "yaml" && ev.format === "yaml",
  "events are stored as pure YAML", `extension/format are ${ev && ev.extension}/${ev && ev.format}`);
assert(ev && ev.create === true, "creating events is enabled", "event creation is disabled");
assert(ev && ev.slug === "{{fields.slug}}",
  "the filename is the record's own Record ID", `the slug template is ${JSON.stringify(ev && ev.slug)}`);
assert(ev && /academic_year/.test(String(ev.summary)),
  "the collection summary shows the academic year", ev && ev.summary);

/* -- Business Forum exclusion ---------------------------------------------- */
{
  assert(ev && ev.filter && ev.filter.field === "event_family" &&
    ev.filter.value === cms.STANDARD_FAMILY,
    `the collection is filtered to event_family: ${cms.STANDARD_FAMILY}`,
    `filter is ${JSON.stringify(ev && ev.filter)}`);

  const onDisk = fs.readdirSync(rel("content/events")).filter((f) => /\.ya?ml$/i.test(f))
    .map((f) => jsyaml.load(read(`content/events/${f}`)) || {});
  const forum = onDisk.filter((e) => e.event_family === "polish-business-forum");
  const standard = onDisk.filter((e) => e.event_family === cms.STANDARD_FAMILY);
  assert(forum.length === 1 && standard.length === 4,
    `content/events/ holds ${standard.length} standard events and ${forum.length} Business Forum`,
    "unexpected event family counts");
  assert(!forum.some((e) => e.event_family === ev.filter.value),
    "the Business Forum record cannot match the collection filter",
    "the Business Forum would appear in the standard collection");

  // No Business Forum field may be reachable from this form.
  const asText = JSON.stringify(ev);
  for (const bespoke of ["business_forum", "performers", "carouselSets", "partner_tier",
    "statistics", "forum_ball", "photographers"]) {
    assert(!asText.includes(bespoke),
      `no Business Forum field is exposed: ${bespoke}`,
      `the standard form exposes ${bespoke}`);
  }
}

/* -- technical invariants --------------------------------------------------- */
{
  for (const [name, value] of [["event_family", cms.STANDARD_FAMILY],
    ["template", cms.STANDARD_TEMPLATE], ["date_precision", "day"]]) {
    const f = evField(name);
    assert(f && f.widget === "hidden", `${name} is a hidden technical field`,
      `${name} is a ${f && f.widget} widget`);
    assert(f && f.default === value, `${name} defaults to ${JSON.stringify(value)}`,
      `${name} defaults to ${JSON.stringify(f && f.default)}`);
  }
  assert((evField("organiser") || {}).widget === "hidden",
    "organiser is fixed rather than retyped on every event",
    "organiser is editable free text");

  // Nothing that belongs to the rendering layer may be exposed.
  const asText = JSON.stringify(ev);
  for (const leak of ["jsonld", "json_ld", "@type", "schema.org", "AttendanceMode",
    "hreflang", "og:", "canonical", "urlPattern", "njk"]) {
    assert(!asText.includes(leak), `no rendering internal is exposed: ${leak}`,
      `the form exposes ${leak}`);
  }
}

/* -- identity and years ------------------------------------------------------ */
{
  const slug = evField("slug");
  assert(slug && slug.required === true && Array.isArray(slug.pattern),
    "the Record ID is required and pattern-validated", "the Record ID is unvalidated");
  const re = new RegExp(slug.pattern[0]);
  assert(!["Christmas Dinner", "christmas_dinner", "../x", "CHRISTMAS"].some((v) => re.test(v)),
    "the Record ID pattern rejects spaces, capitals, underscores and traversal");
  assert(re.test("christmas-dinner") && re.test("christmas-dinner-2026-27"),
    "the Record ID pattern accepts an annual edition ID");
  assert(slug && /new record each year/i.test(String(slug.hint)),
    "the Record ID hint explains annual editions",
    "the Record ID hint does not mention annual editions");

  // A dropdown since Phase 17C.2 — see the note in section 2.
  const y = evField("academic_year");
  assert(y && y.required === true && y.widget === "select",
    "academic year is a required, visible dropdown",
    "academic year is missing, hidden or free text");
  assert(y && Array.isArray(y.options) &&
    y.options.every((v) => cms.parseAcademicYear(v) !== null),
    "every year the event form offers is a real academic year",
    "the event year dropdown offers a malformed year",
    `${(y && y.options || []).length} years offered`);
  assert(y && /never change this on a past event/i.test(String(y.hint)),
    "the year field warns against re-yearing a past event");

  /*
    DISPLAY POSITION RETIRED (Phase 17C.5A).

    Events are shown newest first by the date they happen, so there is no number
    for an editor to keep. These assertions used to require a visible integer
    field with a year-scoped hint; what matters now is the opposite — that the
    field is NOT presented, and that nothing reads it.
  */
  const order = evField("order");
  assert(order && order.widget === "hidden",
    "the retired display position is hidden, so no editor maintains it",
    `order uses the ${order && order.widget} widget`);

  {
    const listing = read("src/_data/eventListing.js");
    assert(/localeCompare\(String\(a\.start_date\)\)/.test(listing),
      "the events listing sorts by date, newest first",
      "the listing no longer sorts by start_date");
    assert(!/a\.order - b\.order/.test(listing),
      "no event ordering reads the retired position field",
      "the listing still sorts by order");
  }
}

/* -- dates ------------------------------------------------------------------- */
{
  /*
    Calendar controls since Phase 17C.2. The old assertions here required the
    OPPOSITE — that no datetime widget appeared anywhere — because the widget's
    defaults shift dates across timezones. That risk is now handled by
    configuring the widget rather than by banning it; the settings that do the
    handling are asserted for every date field above, and per field here.
  */
  for (const name of ["start_date", "end_date"]) {
    const d = evField(name);
    assert(d && d.widget === "datetime",
      `${name} is a calendar control, so no date can be typed by hand`,
      `${name} uses the ${d && d.widget} widget`);
    assert(d && d.picker_utc === true && d.time_format === false && d.format === "YYYY-MM-DD",
      `${name} is timezone-safe and stores a plain calendar day`,
      `${name} is missing picker_utc, time_format: false or the YYYY-MM-DD format`);
  }
  assert(evField("start_date") && evField("start_date").required === true,
    "a standard event must have a start date",
    "the start date is optional");
  assert(evField("end_date") && evField("end_date").required === false,
    "the end date is optional, because most events last one day",
    "the end date is required, which would force a value onto single-day events");
}

/* -- bilingual, one record ---------------------------------------------------- */
{
  for (const [loc, label] of [["en", "English"], ["pl", "Polish"]]) {
    const blk = evField(loc);
    assert(blk && blk.widget === "object", `${label} content is a nested object widget`,
      `the ${loc} block is not an object widget`);
    const names = ((blk && blk.fields) || []).map((f) => f.name);
    //  left this list in Phase 17C.5A.3 — the page structure is the
    // template's now, and  is what an editor writes instead.
    for (const f of ["title_lead", "title_fancy", "title_tail", "timeline_title",
      "card_summary", "hero_summary", "body", "schema_description"]) {
      assert(names.includes(f), `${loc}.${f} exists`, `${loc}.${f} is missing`);
    }
  }
  assert(ev.i18n === undefined, "Decap i18n is NOT enabled on events",
    "Decap i18n is enabled on events");
  assert(!/content\/events\/(en|pl)\b/.test(JSON.stringify(ev)),
    "no per-language event folder is configured");
  const split = fs.readdirSync(rel("content/events"))
    .filter((f) => /[-.](en|pl)\.ya?ml$/i.test(f));
  assert(split.length === 0, "no language-split event exists on disk", split.join(", "));
}

/* -- title parts -------------------------------------------------------------- */
{
  for (const loc of ["en", "pl"]) {
    for (const part of ["title_lead", "title_fancy", "title_tail"]) {
      const f = evLocale(loc, part);
      assert(f && f.widget === "string", `${loc}.${part} is preserved as its own field`,
        `${loc}.${part} was collapsed or removed`);
      assert(f && f.label && !/title_/.test(f.label),
        `${loc}.${part} has a human label rather than its storage key`, f && f.label);
    }
    // Each locale's hint is written in its own language, so the wording differs.
    const spacingHint = String((evLocale(loc, "title_lead") || {}).hint);
    assert(/single spaces|pojedynczą spacją/i.test(spacingHint),
      `${loc}: the title hint explains that spacing is added automatically`,
      `${loc}.title_lead has no spacing guidance`, spacingHint);
  }
  assert(!(evField("title") || evLocale("en", "title")),
    "no single combined `title` field was introduced",
    "a combined title field would change how spacing works");
}

/* -- main body and gallery ----------------------------------------------------- */
/*
  THE THREE PARALLEL SECTION ARRAYS ARE GONE (Phase 17C.5A.3).

  These assertions used to prove the three lists offered the same block types
  and stayed aligned. There are no lists now: an event has one Main body per
  language and one shared gallery, and the page template owns the structure —
  so the alignment class of bug it guarded against cannot occur at all.

  What replaces it is proof that the new shape is what the editor actually gets.
*/
{
  const body = evLocale("en", "body");
  assert(body && body.widget === "richtext",
    "the main body is a rich-text editor, so nobody has to write Markdown",
    `body uses the ${body && body.widget} widget`);
  assert(body && Array.isArray(body.modes) && body.modes.length === 1 &&
    body.modes[0] === "rich_text",
  "the body editor opens as rich text, not as a raw markup box",
  JSON.stringify(body && body.modes));

  // No H1 (the event title already is one) and no code blocks.
  const buttons = (body && body.buttons) || [];
  assert(buttons.length > 0 && !buttons.includes("heading-one"),
    "the body toolbar offers no second H1",
    `buttons: ${buttons.join(", ")}`);
  assert(!buttons.includes("code") && !buttons.includes("code-block"),
    "the body toolbar offers no code formatting", "not offered");
  assert(buttons.includes("quote"),
    "the body toolbar can mark an important statement as a highlight",
    "quote available");
  for (const n of ["bold", "italic", "link", "bulleted-list", "numbered-list"]) {
    assert(buttons.includes(n), `the body toolbar offers ${n}`, "available");
  }

  // The section editor must be gone from the form entirely.
  assert(!evField("sections") && !evLocale("en", "sections") && !evLocale("pl", "sections"),
    "no section list is offered to an editor in either language",
    "a section list is still configured");
  const yamlText = cms.configYaml();
  assert(!/name: sections/.test(yamlText),
    "the generated configuration mentions no section list at all",
    "sections still appear in config.yml");

  // The gallery: one shared list, each image carrying its own two descriptions.
  const gallery = evField("gallery");
  assert(gallery && gallery.widget === "object",
    "the gallery is one optional group, not a page-structure list",
    `gallery uses the ${gallery && gallery.widget} widget`);
  assert(gallery && gallery.collapsed === true,
    "the gallery is collapsed until an editor wants it", "collapsed");
  const images = ((gallery && gallery.fields) || []).find((f) => f.name === "images");
  assert(images && images.widget === "list",
    "the gallery holds one ordered list of photographs", "list");
  const imageFields = ((images && images.fields) || []).map((f) => f.name).sort();
  assert(JSON.stringify(imageFields) === JSON.stringify(["alt", "src", "wide"]),
    "each photograph carries its own description and layout flag",
    imageFields.join(", "));
  const alt = ((images && images.fields) || []).find((f) => f.name === "alt");
  const altLangs = ((alt && alt.fields) || []).map((f) => f.name).sort();
  assert(JSON.stringify(altLangs) === JSON.stringify(["en", "pl"]),
    "a photograph's description is bilingual on the photograph itself",
    altLangs.join(", "));
}

/* -- media, links, visibility --------------------------------------------------- */
{
  /*
    `hero_image` left this list in Phase 17C.4.

    It is null on every event and no standard-event template renders it — the
    pages open with a typographic heading by design. It was previously shown as
    an image picker carrying a hint that said "leave this empty", which is still
    a control an editor must read and decide about. It is now a hidden field, so
    the key round-trips exactly as before while the form stops asking about
    something that does nothing. Asserted as hidden below.
  */
  {
    const hero = evField("hero_image");
    assert(hero && hero.widget === "hidden",
      "the unused hero image is hidden rather than shown as an inert control",
      `hero_image uses the ${hero && hero.widget} widget`);
    assert(hero && hero.default === null,
      "the hidden hero image keeps its canonical null value",
      `hero_image default is ${JSON.stringify(hero && hero.default)}`);
  }

  for (const name of ["card_image", "og_image"]) {
    const f = evField(name);
    assert(f && f.widget === "image", `${name} is an image field`, `${name} is not an image field`);
    assert(f && f.choose_url === false, `${name} cannot be an external URL`,
      `${name} allows arbitrary URLs`);
    /*
      Reversed in Phase 17C.2, after testing the media library in a browser.

      These fields used to be REQUIRED to have no field-level media folder, so
      that they inherited the global assets/ root and an editor could reuse any
      existing event image. That reasoning was wrong, and this assertion was
      keeping it in place: decap-server lists only files sitting directly in the
      folder it is given and does not descend into subfolders, so the global root
      offered exactly one file and the picker read "No assets found" — the very
      symptom the old comment here attributed to the alternative.

      Recursion is the content service's behaviour and not configurable, so the
      fields now pin a folder that uploads accumulate in. What still matters, and
      is asserted, is that the stored path stays root-relative under /assets.
    */
    const effective = f && (f.public_folder || config.public_folder);
    assert(String(effective).startsWith("/assets"),
      `${name} stores a root-relative /assets path (${effective})`,
      `${name} stores ${effective}`);
    assert(f && typeof f.media_folder === "string" && f.media_folder.startsWith("/assets"),
      `${name} pins a media folder, so an upload lands somewhere predictable`,
      `${name} has no media folder, so uploads land at the root of assets/`);
  }
  assert(!/\/pl\/assets/.test(JSON.stringify(ev)),
    "no /pl/assets/ path can be produced by the events configuration");

  for (const name of ["instagram_permalink", "album_url"]) {
    const f = evField(name);
    assert(f && Array.isArray(f.pattern), `${name} is pattern-validated`, `${name} is unvalidated`);
    const re = new RegExp(f.pattern[0]);
    const unsafe = ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "vbscript:x"]
      .filter((u) => re.test(u));
    assert(unsafe.length === 0, `${name} rejects unsafe schemes`, unsafe.join(" | "));
  }

  const co = evField("co_organisers");
  assert(co && co.widget === "list" && Array.isArray(co.fields),
    "co-organisers stay a list of structured objects",
    "co-organisers were flattened");
  const coNames = (co.fields || []).map((f) => f.name).sort();
  assert(JSON.stringify(coNames) === JSON.stringify(["alt", "logo"]),
    "each co-organiser keeps its logo and bilingual name", coNames.join(", "));

  for (const name of ["published", "show_in_listing", "show_on_homepage", "show_in_archive", "flagship"]) {
    const f = evField(name);
    assert(f && f.widget === "boolean", `${name} is an editorial on/off control`,
      `${name} is not a boolean`);
    assert(f && f.label && f.label !== name,
      `${name} has a human label`, `${name} shows its storage key`);
  }

  const sn = evLocale("en", "schema_name");
  assert(sn && sn.required === false && /Leave blank unless/i.test(String(sn.hint)),
    "the structured-data name override is optional and explained",
    "the structured-data override is missing or unexplained");
  assert(sn && !/json/i.test(String(sn.hint)), "the override hint exposes no JSON syntax");
}

/* =================================================================== 15 */
section("15. The fixed event page and the conditional Registration block (17C.5A.3)");

{
  const admin = read("src/admin/index.njk");

  /* -- the drawers ------------------------------------------------------- */

  /*
    The override fields are collapsed, not merely pushed to the bottom. A field
    an editor still has to scroll past is a field they still have to read.
  */
  const drawer = read("src/admin/advanced-drawer.js");
  assert(/cmsConfig\.advancedDrawerScript/.test(admin),
    "the admin page embeds the overrides drawer", "the drawer is not embedded");
  assert(/document\.createElement\("details"\)/.test(drawer),
    "the drawer is a native <details>, so it is closed before any script runs",
    "the drawer builds its own toggle");
  assert(!/\.open\s*=\s*true/.test(drawer),
    "nothing opens the drawer on the editor's behalf", "the drawer opens itself");
  for (const name of ["hero_summary", "card_summary", "timeline_title", "seo_title",
    "seo_description", "schema_description", "schema_name", "co_organisers_label"]) {
    assert(drawer.includes('"' + name + '"'),
      `the drawer collects ${name}`, `${name} is not in the drawer`);
  }
  assert(!/appendChild\(.*cloneNode/.test(drawer) && !/cloneNode/.test(drawer),
    "the drawer MOVES Decap's controls rather than cloning them",
    "a cloned control would be a second box writing to one value");
  assert(!/setInterval|setTimeout/.test(drawer),
    "the drawer waits on the work being done, not on a delay",
    "the drawer polls");

  /*
    Retired from form-sections.js when it moved to its own module. Two modules
    moving the same controls would race, and only one of them ever worked.
  */
  const sections = read("src/admin/form-sections.js");
  assert(!/LOCALE_PLAN/.test(sections),
    "form-sections.js no longer tries to build the drawer as well",
    "two modules would fight over the same fields");

  /* -- collapsed by default ---------------------------------------------- */

  assert(/{ title: "Gallery", open: false/.test(sections),
    "the Gallery section is closed by default",
    "the form opens on a photograph list that is usually empty");
  const units = read("src/admin/image-units.js");
  assert(/createElement\("details"\)[\s\S]{0,400}data-" \+ ROOT, "album"|album[\s\S]{0,600}createElement\("details"\)/.test(units),
    "the Photo album is closed by default", "the album is open by default");
  assert(!/\.open\s*=\s*true/.test(units),
    "nothing opens the album on the editor's behalf", "the album opens itself");

  const albumUrl = evField("album_url");
  assert(albumUrl !== undefined && !Array.isArray(albumUrl),
    "there is still exactly one album address", "the album address was duplicated");

  /* -- the source chooser ------------------------------------------------ */

  const annReg = ((ann && ann.fields) || []).find((f) => f.name === "registration");
  const source = ((annReg || {}).fields || []).find((f) => f.name === "source");
  assert(source && source.widget === "select",
    "an announcement chooses where its registration comes from", "no source chooser");
  const values = ((source || {}).options || []).map((o) => o.value);
  assert(JSON.stringify(values) === JSON.stringify(["none", "event", "own"]),
    "the chooser offers no registration, a Federation event, or this announcement",
    `the chooser offers ${JSON.stringify(values)}`);
  assert(source && source.default === "none",
    "a new announcement starts with nothing to sign up for",
    "a new announcement starts by asking for sign-up details");

  /*
    AN EVENT WITHOUT SIGN-UPS IS STILL A VALID CHOICE.

    An announcement is usually written before registration opens. Refusing that
    reference forced editors to either wait or copy the details by hand — the
    duplication this model exists to remove.
  */
  const picker = ((annReg || {}).fields || []).find((f) => f.name === "event_slug");
  assert(picker && picker.widget === "relation" && picker.collection === "standard_events",
    "the event picker reads the events collection through the backend",
    "the picker is not a relation on standard_events");
  assert(picker && picker.filter === undefined,
    "the picker lists every standard event, unfiltered",
    "the picker hides some events");
  assert(picker && !/must already have|other than No/i.test(String(picker.hint)),
    "the picker no longer claims an event must already have sign-ups",
    "the hint still describes the retired rule");

  const registration = require(rel("src/_data/registration.js"));
  const quiet = [{ slug: "quiet", event_family: "standard", registration: { state: "none" } }];
  assert(registration.referenceProblem(
    { registration: { source: "event", event_slug: "quiet" } }, quiet) === null,
  "an event whose sign-ups have not opened can be referenced", "the reference is refused");
  assert(registration.isRegistrable(quiet[0]) === true,
    "and it is offered in the picker", "it is filtered out");
  assert(/does not exist/.test(String(registration.referenceProblem(
    { registration: { source: "event", event_slug: "ghost" } }, quiet))),
  "a reference to a missing event is still refused", "a broken reference is accepted");
  assert(/two different events/.test(String(registration.referenceProblem(
    { registration: { source: "event", event_slug: "quiet" },
      link: { type: "event", event_slug: "other" } }, quiet))),
  "a details link and a registration pointing at different events is still refused",
  "the consistency guard is gone");
  assert(/takes its\s*"? \+\s*"?registration from another|registration from another/.test(admin),
    "the editor refuses that combination at save time too",
    "the save-time consistency guard is gone");

  /* -- the conditional block --------------------------------------------- */

  /*
    Comments removed before these assertions run. Several of these modules
    EXPLAIN in prose why they avoid a technique — "not requestAnimationFrame,
    because a background tab never paints" — and a plain search would find that
    sentence and report the very thing it was written to rule out.
  */
  const code = (t) => t
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");

  const ux = code(read("src/admin/registration-ux.js"));
  assert(/cmsConfig\.registrationUxScript/.test(admin),
    "the admin page embeds the conditional Registration block", "it is not embedded");
  assert(/FED_REGISTRATION_CHOICES/.test(admin) && /FED_EVENT_PICKER_INDEX/.test(admin),
    "its two lookup tables are handed over as data, built from the config and the content",
    "a lookup table is written into the script by hand");
  assert(!/requestAnimationFrame/.test(ux),
    "it does not depend on the tab being painted to update the form",
    "a background tab would show every field");
  assert(!/setInterval/.test(ux) && !/setTimeout/.test(ux),
    "it uses no timer and no delay constant", "it polls");
  assert(/display: none/.test(read("src/admin/registration-ux.css")),
    "fields are hidden, never removed — the draft keeps their values",
    "a hidden field would lose its value");
  assert(/<dt>|createElement\("dt"\)/.test(ux) && !/disabled/.test(ux),
    "the event's registration is previewed as plain text, not as disabled inputs",
    "a disabled input still looks like somewhere to type");

  const choices = cms.registrationChoices();
  assert(Object.values(choices.source).sort().join(",") === "event,none,own",
    "the choice table is derived from the options the config just built",
    "the table and the options can drift apart");
  const index = cms.eventRegistrationIndex();
  assert(Object.keys(index).length > 0 &&
    Object.values(index).every((e) => e.slug),
  `the picker labels are paired with their events (${Object.keys(index).length} events)`,
  "the preview cannot tell which event was chosen");

  /* -- the page itself ---------------------------------------------------- */

  /*
    The gallery and the social block use the live site's own classes. The reveal class
    is what js/main.js animates and .insta-embed is what centres an embed;
    a container of our own would have been a class css/style.css never heard of,
    and css/style.css is a live deployed file this phase does not touch.
  */
  const gallery = read("src/_includes/partials/event/gallery-fixed.njk");
  assert(/class="gallery-grid reveal"/.test(gallery),
    "the gallery grid keeps the class the live pages animate",
    "the grid would no longer reveal on scroll");
  assert(/class="section-head reveal"/.test(gallery),
    "so does its heading", "the heading would no longer reveal on scroll");
  assert(/class="fancy"/.test(gallery),
    "a gallery heading can still highlight part of itself",
    "authored typography would be flattened");
  const social = read("src/_includes/partials/event/social-posts.njk");
  assert(/class="insta-embed reveal"/.test(social),
    "each social embed keeps the block the live pages use",
    "the embed would lose its centring and its width cap");
  assert(/class="fancy"/.test(social),
    "so can the social heading", "authored typography would be flattened");

  const body = read("src/_includes/partials/event/body.njk");
  assert(/class="prose reveal"/.test(body),
    "the main body is the same prose block it has always been",
    "the body would lose its styling");
}

/* =================================================================== 12 */
section("12. Netlify configuration");

/*
  THIS ASSERTION CHANGED IN PHASE 17D.1, DELIBERATELY.

  Every CMS phase up to 17C.5B was local-only, so netlify.toml being unmodified
  was the proof that nothing had leaked into production. Phase 17D.1 IS the
  production integration: the CMS is served from the deployment, so netlify.toml
  now legitimately routes /api/cms, guards /admin/* by role and sets security
  headers.

  "Unchanged" is therefore no longer the right question. These are: does it
  carry a credential, does it protect the admin, and does it still do the things
  the public site depends on?
*/
{
  const toml = read("netlify.toml");
  /*
    Comments stripped for the rule checks below. This file EXPLAINS at length
    why it does not use `force = true`, and a search for that string would
    otherwise find the explanation and report the very thing it rules out.
  */
  const active = toml.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");

  /*
    NO SECRET IN A TRACKED FILE. netlify.toml is in the repository; every
    credential belongs in the Netlify UI. Checked by name and by shape, because
    a key pasted here would be a published key.
  */
  assert(!/CMS_GITHUB_PRIVATE_KEY\s*=|BEGIN [A-Z ]*PRIVATE KEY|ghp_|nfp_|ghs_/.test(toml),
    "netlify.toml contains no credential",
    "netlify.toml appears to contain a secret");
  assert(!/\[build\.environment\]/.test(toml) || !/CMS_GITHUB/.test(toml),
    "no CMS credential is declared as a build environment variable",
    "netlify.toml declares CMS credentials inline");

  /* The admin is guarded at the edge, and the guard comes before the fallback. */
  const roleRule = toml.indexOf("conditions = {Role");
  const loginFallback = toml.indexOf('to = "/staff-login/"');
  assert(roleRule > -1, "/admin/* is role-conditioned at the edge",
    "netlify.toml does not restrict /admin/* by role");
  assert(loginFallback > -1 && roleRule < loginFallback,
    "an unauthorised visitor falls through to the login page, not into the CMS",
    "the role rule does not precede the login fallback — order decides which wins");
  assert(/Role = \["editor", "admin"\]/.test(toml),
    "only editors and admins may open the content manager",
    "the admin role condition is not editor/admin");

  /* The API is a function, and nothing may frame the CMS. */
  assert(/from = "\/api\/cms"/.test(toml) && /functions\/cms/.test(toml),
    "/api/cms is served by the CMS function", "the CMS API is not routed");
  assert(/frame-ancestors 'none'/.test(toml),
    "the content manager cannot be framed by another site",
    "no frame-ancestors restriction on /admin/");
  assert(/X-Robots-Tag = "noindex/.test(toml),
    "the admin and login routes are marked noindex at the edge",
    "no noindex header on the operational routes");

  /* What the public site still depends on, unchanged by this phase. */
  assert(/from = "\/pl\/\*"/.test(toml) && /status = 404/.test(toml),
    "the Polish 404 rule survives", "the Polish 404 rule was lost");
  assert(!/force\s*=\s*true/.test(active),
    "no redirect is forced, so real Polish pages still resolve",
    "a forced redirect would intercept the Polish site");
  assert(/publish = "dist"/.test(toml) && /command = "npm run build:production"/.test(toml),
    "the build publishes dist/ with the production-CMS command",
    "publish and command disagree — see scripts/validate.js parseDeploymentState()");
}

/* =================================================================== out */

console.log("\n" + "=".repeat(78));
console.log("  CMS CONFIGURATION VALIDATION");
console.log("=".repeat(78));
for (const r of results) {
  if (r.section) { console.log("\n  " + r.section + "\n  " + "-".repeat(r.section.length)); continue; }
  console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.label}`);
  if (r.detail) console.log(`          ${r.detail}`);
}
const total = results.filter((r) => !r.section).length;
console.log("\n" + "=".repeat(78));
console.log(failures === 0
  ? `  PASS — ${total} CMS checks, 0 problems`
  : `  FAIL — ${failures} of ${total} CMS checks`);
console.log("=".repeat(78) + "\n");
process.exit(failures === 0 ? 0 : 1);
