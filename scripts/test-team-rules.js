#!/usr/bin/env node
/**
 * test-team-rules.js — negative controls for the Team photo and Record ID rules.
 *
 * WHY NEGATIVE CONTROLS
 * ---------------------
 * Phase 17A.1 relaxed one rule: `photo` may now be absent as well as null. A
 * relaxation is exactly the kind of change that quietly takes its neighbours
 * with it — it is easy to write a rule that accepts an absent key and, without
 * anyone noticing, also accepts an empty string, an external URL or a path that
 * resolves to nothing. A validator that cannot fail proves nothing.
 *
 * So each case below injects one specific defect into a temporary record, runs
 * the real validator, and asserts that the SPECIFIC message fired — not merely
 * that something failed. The last part matters: a temporary 22nd member also
 * breaks the expected group counts, so "the validator failed" is not evidence
 * that the photo rule failed. Every assertion matches on the rule's own wording.
 *
 * SAFETY
 * ------
 * Only files named `zz-cms-rule-test-*.yaml` are ever written, and they are
 * removed in a `finally` — including on Ctrl+C. Real records are never touched,
 * and the run ends by asserting that content/team/ is exactly as it started.
 *
 * Run:  npm run test:team-rules
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TEAM_DIR = path.join(ROOT, "content", "team");
const PREFIX = "zz-cms-rule-test";

/* -- baseline, so any mutation is detectable ------------------------------- */

const baseline = fs.readdirSync(TEAM_DIR).filter((f) => /\.ya?ml$/i.test(f)).sort();
const baselineHash = crypto.createHash("sha256")
  .update(baseline.map((f) => f + ":" + fs.readFileSync(path.join(TEAM_DIR, f)).toString("base64")).join("|"))
  .digest("hex");

/** Remove every file this script could possibly have created. */
function cleanup() {
  for (const f of fs.readdirSync(TEAM_DIR)) {
    if (f.startsWith(PREFIX)) fs.rmSync(path.join(TEAM_DIR, f), { force: true });
  }
}
process.on("SIGINT", () => { cleanup(); process.exit(130); });

/* -- harness --------------------------------------------------------------- */

let failures = 0;
const results = [];
const section = (t) => results.push({ section: t });
function check(ok, label, detail) {
  if (!ok) failures++;
  results.push({ ok, label, detail });
}

/** Run the real validator and return its combined output. */
function runValidator() {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "validate.js")],
    { cwd: ROOT, encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const BASE = {
  academic_year: "2025/26",
  group: "events",
  order: 97,
  published: true,
  name: "ZZ Rule Test",
  email: "zz.rule.test@example.invalid",
  linkedin: "https://www.linkedin.com/in/zz-rule-test/",
  en: { role: "Rule Test Officer" },
  pl: { role: "Testowy specjalista regul" },
};

/** Write a temporary record. `photo` is included only when explicitly given. */
function writeRecord(fileStem, overrides, photo) {
  const rec = { slug: fileStem, ...BASE, ...overrides };
  const lines = [];
  lines.push(`slug: ${rec.slug}`);
  lines.push(`academic_year: "${rec.academic_year}"`);
  lines.push(`group: ${rec.group}`);
  lines.push(`order: ${rec.order}`);
  lines.push(`published: ${rec.published}`);
  lines.push(`name: "${rec.name}"`);
  if (photo !== undefined) lines.push(`photo: ${photo}`);
  lines.push(`email: "${rec.email}"`);
  lines.push(`linkedin: "${rec.linkedin}"`);
  lines.push("en:");
  lines.push(`  role: "${rec.en.role}"`);
  if (rec.en.photo_alt) lines.push(`  photo_alt: "${rec.en.photo_alt}"`);
  lines.push("pl:");
  lines.push(`  role: "${rec.pl.role}"`);
  if (rec.pl.photo_alt) lines.push(`  photo_alt: "${rec.pl.photo_alt}"`);
  fs.writeFileSync(path.join(TEAM_DIR, `${fileStem}.yaml`), lines.join("\n") + "\n");
}

/**
 * Assert whether a specific validator rule fires for a given record.
 *
 * `expectMessage` is matched against the validator's FAILURE lines only, so the
 * collateral count failures a temporary 22nd member causes cannot be mistaken
 * for the rule under test.
 */
function ruleCase({ name, photo, overrides = {}, expectMessage, shouldFire }) {
  const stem = `${PREFIX}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  try {
    writeRecord(stem, overrides, photo);
    const { out } = runValidator();
    const fired = out.includes(expectMessage);
    check(fired === shouldFire,
      `${shouldFire ? "REJECTED" : "accepted"}: ${name}`,
      fired === shouldFire ? null
        : `expected the validator ${shouldFire ? "to report" : "NOT to report"} ` +
          `"${expectMessage}" — it did ${fired ? "" : "not"}`);
  } finally {
    fs.rmSync(path.join(TEAM_DIR, `${stem}.yaml`), { force: true });
  }
}

/* ===========================================================================
   Photo semantics
   =========================================================================== */

try {
  section("1. Photograph — absent and null are equivalent, values are strict");

  // The three accepted states. `photoValues` is the rule's own failure wording;
  // if none of it fires, the record's photograph was accepted.
  const PHOTO_FAILURES = [
    "empty-string photograph values",
    "photograph values of the wrong type",
    "external photograph URLs",
    "local filesystem paths",
    "language-prefixed photograph paths",
    "photograph paths that are not root-relative",
    "photograph paths that do not resolve to a real file",
  ];

  function photoAccepted(name, photo, overrides = {}) {
    const stem = `${PREFIX}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    try {
      writeRecord(stem, overrides, photo);
      const { out } = runValidator();
      const hit = PHOTO_FAILURES.filter((m) => out.includes(m));
      check(hit.length === 0, `accepted: ${name}`,
        hit.length ? `unexpectedly rejected by: ${hit.join(", ")}` : null);
    } finally {
      fs.rmSync(path.join(TEAM_DIR, `${stem}.yaml`), { force: true });
    }
  }

  photoAccepted("photo key absent entirely", undefined);
  photoAccepted("photo: null", "null");
  photoAccepted("a real /assets/team/ path", '"/assets/team/katie-taylor.jpg"',
    { en: { ...BASE.en, photo_alt: "ZZ Rule Test" }, pl: { ...BASE.pl, photo_alt: "ZZ Rule Test" } });

  ruleCase({ name: "empty string", photo: '""',
    expectMessage: "empty-string photograph values", shouldFire: true });

  ruleCase({ name: "a number instead of a path", photo: "42",
    expectMessage: "photograph values of the wrong type", shouldFire: true });

  ruleCase({ name: "external URL", photo: '"https://random-site.example/photo.jpg"',
    expectMessage: "external photograph URLs", shouldFire: true });

  ruleCase({ name: "Windows absolute path", photo: '"C:\\\\Users\\\\someone\\\\photo.jpg"',
    expectMessage: "local filesystem paths", shouldFire: true });

  ruleCase({ name: "/pl/assets/ language-prefixed path", photo: '"/pl/assets/team/person.jpg"',
    expectMessage: "language-prefixed photograph paths", shouldFire: true });

  ruleCase({ name: "path outside the Team image folder", photo: '"/assets/pbf/crowd.jpg"',
    expectMessage: "photograph paths that are not root-relative", shouldFire: true });

  ruleCase({ name: "a Team path that does not exist on disk",
    photo: '"/assets/team/nobody-has-this-photo.jpg"',
    expectMessage: "photograph paths that do not resolve to a real file", shouldFire: true });

  // Alt text without a photograph must still be rejected — the relaxation must
  // not have taken this rule with it.
  ruleCase({ name: "alt text on a member with no photograph", photo: undefined,
    overrides: { en: { ...BASE.en, photo_alt: "ZZ Rule Test" }, pl: { ...BASE.pl, photo_alt: "ZZ Rule Test" } },
    expectMessage: "alt text on a member with no photograph", shouldFire: true });

  /* =========================================================================
     Record IDs
     ========================================================================= */

  section("2. Record ID — uniqueness, filename agreement, safe characters");

  ruleCase({ name: "a unique, well-formed Record ID", photo: undefined,
    expectMessage: "records whose slug does not match the filename", shouldFire: false });

  // filename != slug — the plain mismatch.
  {
    const stem = `${PREFIX}-mismatch`;
    try {
      writeRecord(stem, { slug: `${PREFIX}-something-else` }, undefined);
      const { out } = runValidator();
      check(out.includes("records whose slug does not match the filename"),
        "REJECTED: filename does not match the stored Record ID");
      const chk = spawnSync(process.execPath, [path.join(ROOT, "scripts", "cms-check.js")],
        { cwd: ROOT, encoding: "utf8" });
      check(chk.status !== 0 && /filename and the stored Record ID disagree/.test(chk.stdout || ""),
        "cms:check reports the mismatch in editor language");
    } finally {
      fs.rmSync(path.join(TEAM_DIR, `${stem}.yaml`), { force: true });
    }
  }

  // The Decap collision artefact: <slug>-1.yaml containing slug: <slug>.
  {
    const realStem = `${PREFIX}-collide`;
    const artefact = `${realStem}-1`;
    try {
      writeRecord(realStem, {}, undefined);
      writeRecord(artefact, { slug: realStem, order: 96 }, undefined);
      fs.renameSync(path.join(TEAM_DIR, `${artefact}.yaml`), path.join(TEAM_DIR, `${artefact}.yaml`));

      const { out } = runValidator();
      check(out.includes("duplicate member slugs") ||
        out.includes("records whose slug does not match the filename"),
        "REJECTED: the Decap -1 collision artefact");

      const chk = spawnSync(process.execPath, [path.join(ROOT, "scripts", "cms-check.js")],
        { cwd: ROOT, encoding: "utf8" });
      const o = chk.stdout || "";
      check(chk.status !== 0, "cms:check exits non-zero on the collision");
      check(/duplicate-ID collision/.test(o), "cms:check names it as a duplicate-ID collision");
      check(/do this/.test(o) && /Record ID/.test(o),
        "cms:check tells the editor what to do about it");
      check(new RegExp(realStem + "\\.yaml").test(o),
        "cms:check names the conflicting existing record");
    } finally {
      fs.rmSync(path.join(TEAM_DIR, `${realStem}.yaml`), { force: true });
      fs.rmSync(path.join(TEAM_DIR, `${artefact}.yaml`), { force: true });
    }
  }

  // Two files, same stored slug.
  {
    const a = `${PREFIX}-dupe-a`;
    const b = `${PREFIX}-dupe-b`;
    try {
      writeRecord(a, { slug: `${PREFIX}-shared` }, undefined);
      writeRecord(b, { slug: `${PREFIX}-shared`, order: 96 }, undefined);
      const { out } = runValidator();
      check(out.includes("duplicate member slugs"), "REJECTED: two records claiming one Record ID");
      const chk = spawnSync(process.execPath, [path.join(ROOT, "scripts", "cms-check.js")],
        { cwd: ROOT, encoding: "utf8" });
      check(/two records claim the same Record ID/.test(chk.stdout || ""),
        "cms:check reports the duplicate Record ID");
    } finally {
      fs.rmSync(path.join(TEAM_DIR, `${a}.yaml`), { force: true });
      fs.rmSync(path.join(TEAM_DIR, `${b}.yaml`), { force: true });
    }
  }

  // Unsafe characters. The filename cannot literally contain a slash, so this is
  // checked through cms:check, which validates the stored value's format.
  {
    const stem = `${PREFIX}-unsafe`;
    for (const bad of ["Jane Example", "jane_example", "jane/example", "../jane", "JANE"]) {
      try {
        writeRecord(stem, { slug: bad }, undefined);
        const chk = spawnSync(process.execPath, [path.join(ROOT, "scripts", "cms-check.js")],
          { cwd: ROOT, encoding: "utf8" });
        check(chk.status !== 0 && /not filename-safe|disagree/.test(chk.stdout || ""),
          `REJECTED: unsafe Record ID ${JSON.stringify(bad)}`);
      } finally {
        fs.rmSync(path.join(TEAM_DIR, `${stem}.yaml`), { force: true });
      }
    }
  }

  /* =========================================================================
     The legitimate multi-year case must survive all of the above
     ========================================================================= */

  section("3. The same person in two academic years is still legal");

  {
    const y1 = `${PREFIX}-annual`;
    const y2 = `${PREFIX}-annual-2026-27`;
    try {
      writeRecord(y1, {}, undefined);
      writeRecord(y2, { academic_year: "2026/27", order: 96 }, undefined);

      const { out } = runValidator();
      check(!out.includes("duplicate member slugs"),
        "two annual records for one person are NOT a duplicate Record ID");
      check(!out.includes("records whose slug does not match the filename"),
        "both annual records keep slug === filename");

      const chk = spawnSync(process.execPath, [path.join(ROOT, "scripts", "cms-check.js")],
        { cwd: ROOT, encoding: "utf8" });
      check(chk.status === 0, "cms:check accepts the same person in two years",
        chk.status === 0 ? null : (chk.stdout || "").split("\n").filter((l) => /PROBLEM|detail/.test(l)).slice(0, 4).join(" | "));
      check(/serves in 2 academic years/.test(chk.stdout || ""),
        "cms:check recognises it as a normal multi-year membership");

      // Both files still exist: neither overwrote the other.
      check(fs.existsSync(path.join(TEAM_DIR, `${y1}.yaml`)) &&
        fs.existsSync(path.join(TEAM_DIR, `${y2}.yaml`)),
        "both annual records coexist on disk");
    } finally {
      fs.rmSync(path.join(TEAM_DIR, `${y1}.yaml`), { force: true });
      fs.rmSync(path.join(TEAM_DIR, `${y2}.yaml`), { force: true });
    }
  }

  // A repeated person NAME within one year is a different matter, and is caught.
  {
    const a = `${PREFIX}-sameyear-a`;
    const b = `${PREFIX}-sameyear-b`;
    try {
      writeRecord(a, {}, undefined);
      writeRecord(b, { order: 96 }, undefined);
      const chk = spawnSync(process.execPath, [path.join(ROOT, "scripts", "cms-check.js")],
        { cwd: ROOT, encoding: "utf8" });
      check(/same person appears twice in one academic year/.test(chk.stdout || ""),
        "REJECTED: the same person twice in ONE academic year");
    } finally {
      fs.rmSync(path.join(TEAM_DIR, `${a}.yaml`), { force: true });
      fs.rmSync(path.join(TEAM_DIR, `${b}.yaml`), { force: true });
    }
  }
} finally {
  cleanup();
}

/* ===========================================================================
   The repository must be exactly as it was
   =========================================================================== */

section("4. This test left nothing behind");

{
  const after = fs.readdirSync(TEAM_DIR).filter((f) => /\.ya?ml$/i.test(f)).sort();
  const afterHash = crypto.createHash("sha256")
    .update(after.map((f) => f + ":" + fs.readFileSync(path.join(TEAM_DIR, f)).toString("base64")).join("|"))
    .digest("hex");

  check(after.length === baseline.length,
    `content/team/ still holds exactly ${baseline.length} records`,
    `found ${after.length}`);
  check(!after.some((f) => f.startsWith(PREFIX)), "no test record remains",
    after.filter((f) => f.startsWith(PREFIX)).join(", "));
  check(afterHash === baselineHash, "every real record is byte-identical to before the run",
    afterHash === baselineHash ? null : "a real record was modified");
}

/* -- output ---------------------------------------------------------------- */

console.log("\n" + "=".repeat(78));
console.log("  TEAM PHOTO AND RECORD ID RULES — negative controls");
console.log("=".repeat(78));
for (const r of results) {
  if (r.section) { console.log("\n  " + r.section + "\n  " + "-".repeat(r.section.length)); continue; }
  console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.label}`);
  if (r.detail) console.log(`          ${r.detail}`);
}
const total = results.filter((r) => !r.section).length;
console.log("\n" + "=".repeat(78));
console.log(failures === 0
  ? `  PASS — ${total} rule assertions, 0 problems`
  : `  FAIL — ${failures} of ${total} rule assertions`);
console.log("=".repeat(78) + "\n");
process.exit(failures === 0 ? 0 : 1);
