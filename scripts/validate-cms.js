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

{
  const ay = field("academic_year");
  assert(ay !== undefined, "the Team form has an academic_year field",
    "academic_year is not editable");
  assert(ay && ay.required === true, "academic_year is required",
    "academic_year is optional, so a record could be created with no year");
  assert(ay && ay.widget !== "hidden",
    "academic_year is visible to the editor (not hidden)",
    "academic_year is hidden — the editor could not see which year they are editing");
  assert(ay && Array.isArray(ay.pattern) && /\\d\{4\}/.test(ay.pattern[0]),
    "academic_year is format-validated in the CMS",
    "academic_year has no format validation");
  assert(ay && !/2025/.test(String(ay.pattern && ay.pattern[0])),
    "the academic-year pattern does not hardcode a single permitted year",
    "the academic-year pattern is locked to one specific year");
  assert(ay && ay.widget === "string",
    "academic_year is a validated string, so future years need no config change",
    `academic_year uses the ${ay && ay.widget} widget, which would need editing every year`);
  assert(ay && typeof ay.hint === "string" && /new record/i.test(ay.hint),
    "the academic-year field warns against re-yearing an old record",
    "the academic-year field has no rollover guidance");

  // The pattern must accept future years and reject malformed ones.
  const re = new RegExp(ay.pattern[0]);
  const accepts = ["2025/26", "2026/27", "2030/31"].filter((v) => re.test(v));
  const rejects = ["2025", "25/26", "2025/2026", "2025-26", ""].filter((v) => !re.test(v));
  assert(accepts.length === 3, "the pattern accepts 2025/26, 2026/27 and 2030/31",
    "the pattern rejects a valid future year", accepts.join(", "));
  assert(rejects.length === 5, "the pattern rejects malformed years",
    "the pattern accepts a malformed year");
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
  const cur = (settingsFile.fields || []).find((f) => f.name === "current");
  assert(cur && cur.required === true && Array.isArray(cur.pattern),
    "the current-year field is required and format-validated",
    "the current-year field is unvalidated");
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
  assert(fs.existsSync(rel("dist/admin/index.html")),
    "the CMS build DOES publish dist/admin/index.html",
    "the CMS build produced no admin page");
  assert(fs.existsSync(rel("dist/admin/config.yml")),
    "the CMS build publishes dist/admin/config.yml",
    "the CMS build produced no admin configuration");
  assert(fs.existsSync(rel("dist/admin/decap-cms.js")),
    "the pinned Decap bundle is vendored beside it (no CDN)",
    "the Decap bundle was not copied");

  if (fs.existsSync(rel("dist/admin/index.html"))) {
    const html = read("dist/admin/index.html");
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
    const markup = html.replace(/<!--[\s\S]*?-->/g, "");
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
    assert(!/CMS\.__|_reduxStore|\.prototype\.|Object\.defineProperty\(window\.CMS/.test(markup),
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
  const y = annField("academic_year");
  assert(y && y.required === true && y.widget === "string" && Array.isArray(y.pattern),
    "academic_year is a required, format-validated, visible string",
    "academic_year is missing, optional, hidden or unvalidated");
  assert(y && !/20\d\d/.test(String(y.pattern[0])),
    "the year pattern hardcodes no specific year (future years need no config change)",
    "the year pattern is locked to specific years");
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

  const bg = annField("image_background");
  assert(bg && Array.isArray(bg.pattern) && /#/.test(bg.pattern[0]),
    "the backdrop colour is validated as a hex colour",
    "the backdrop colour accepts arbitrary CSS");

  // image_position is deliberately free text — three real records use CSS
  // percentages that no finite list could contain.
  const pos = annField("image_position");
  assert(pos && pos.widget === "string" && pos.required === false,
    "the image focal point stays optional free text (real records use percentages)",
    "the image focal point was restricted to a fixed list");
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
    if (exists("dist/admin/index.html")) {
      const built = read("dist/admin/index.html");
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
  const closed = annField("signups_closed");
  assert(closed && closed.widget === "boolean", "registration state is a boolean toggle",
    "registration state is not a boolean");
  assert(closed && /does not close just because/i.test(String(closed.hint)),
    "the registration toggle states that it is not inferred from the date",
    "the registration toggle has no guidance");

  const date = annField("published_date");
  assert(date && date.widget === "string" && Array.isArray(date.pattern),
    "the publication date is a validated string, not a timezone-sensitive datetime widget",
    `the publication date uses the ${date && date.widget} widget`);
  assert(date && new RegExp(date.pattern[0]).test("2026-05-14") &&
    !new RegExp(date.pattern[0]).test("2026-05-14T00:00:00.000Z"),
    "the date pattern accepts a calendar day and rejects a timestamp",
    "the date pattern would accept a timestamp");
}

/* =================================================================== 12 */
section("12. Netlify configuration untouched by this phase");

{
  const toml = read("netlify.toml");
  assert(!/admin|decap|cms/i.test(toml),
    "netlify.toml mentions no admin panel, Decap or CMS",
    "netlify.toml has acquired CMS configuration");
  const diff = spawnSync("git", ["diff", "--name-only", "HEAD", "--", "netlify.toml"],
    { cwd: ROOT, encoding: "utf8" });
  assert((diff.stdout || "").trim() === "",
    "netlify.toml is unmodified relative to HEAD",
    "netlify.toml has been modified", (diff.stdout || "").trim());
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
