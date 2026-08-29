#!/usr/bin/env node
/**
 * test-announcement-rules.js — negative controls for the Announcement rules.
 *
 * Same discipline as scripts/test-team-rules.js: every case injects ONE specific
 * defect into a temporary record, runs the real validator or cms:check, and
 * asserts that THAT rule's own wording appeared. Matching on the message rather
 * than on the exit code matters, because a temporary extra announcement also
 * breaks the live-page comparison — "something failed" would not be evidence
 * that the rule under test failed.
 *
 * Two rules are worth stating plainly, because they are the ones a future change
 * is most likely to get wrong:
 *
 *   - The same display position in DIFFERENT academic years is legal. Positions
 *     restart at 1 each year; only a clash inside one year is a fault.
 *   - A future-year announcement is legal and invisible. "Not this year" and
 *     "unpublished" are separate ideas and must not be conflated.
 *
 * SAFETY: only files named `zz-cms-ann-test-*.yaml` are ever written, they are
 * removed in a `finally` (and on Ctrl+C), and the run ends by asserting that
 * content/announcements/ is byte-identical to how it started.
 *
 * Run:  npm run test:announcement-rules
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const rules = require(path.join(ROOT, "netlify", "lib", "rules.js"));
const ANN_DIR = path.join(ROOT, "content", "announcements");
const PREFIX = "zz-cms-ann-test";

/* -- baseline --------------------------------------------------------------- */

const baseline = fs.readdirSync(ANN_DIR).filter((f) => /\.ya?ml$/i.test(f)).sort();
const baselineHash = crypto.createHash("sha256")
  .update(baseline.map((f) => f + ":" + fs.readFileSync(path.join(ANN_DIR, f)).toString("base64")).join("|"))
  .digest("hex");

function cleanup() {
  for (const f of fs.readdirSync(ANN_DIR)) {
    if (f.startsWith(PREFIX)) fs.rmSync(path.join(ANN_DIR, f), { force: true });
  }
}
process.on("SIGINT", () => { cleanup(); process.exit(130); });

/* -- harness ---------------------------------------------------------------- */

let failures = 0;
const results = [];
const section = (t) => results.push({ section: t });
function check(ok, label, detail) {
  if (!ok) failures++;
  results.push({ ok, label, detail });
}

const runValidator = () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "validate.js")],
    { cwd: ROOT, encoding: "utf8" });
  return (r.stdout || "") + (r.stderr || "");
};
const runCmsCheck = () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "cms-check.js")],
    { cwd: ROOT, encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};

/** A valid announcement, as the CMS would write one. */
function record(stem, over = {}) {
  const r = {
    slug: stem,
    academic_year: "2025/26",
    published_date: "2030-01-01",
    order: 900,
    published: true,
    image: null,
    image_position: null,
    image_fit: null,
    image_background: null,
    extra_images: [],
    registration: { state: "none", url: null, opens_on: null, closes_on: null },
    link: null,
    en: { title: "ZZ Rule Test", subtitle: "Temporary record.", body: "A paragraph." },
    pl: { title: "ZZ Test Regul", subtitle: "Rekord tymczasowy.", body: "Akapit." },
    ...over,
  };
  const q = (v) => (v === null ? "null" : JSON.stringify(v));
  const lines = [
    `slug: ${r.slug}`,
    `academic_year: ${q(r.academic_year)}`,
    `published_date: ${r.rawDate !== undefined ? r.rawDate : q(r.published_date)}`,
    `order: ${r.order}`,
    `published: ${r.published}`,
    `image: ${q(r.image)}`,
    `image_position: ${q(r.image_position)}`,
    `image_fit: ${q(r.image_fit)}`,
    `image_background: ${q(r.image_background)}`,
  ];
  lines.push("extra_images:");
  if (!r.extra_images.length) lines[lines.length - 1] = "extra_images: []";
  else for (const x of r.extra_images) lines.push(`  - ${q(x)}`);
  // Registration replaced signups_closed in Phase 17C.3. Written out in full so
  // a temporary record has the same shape as a real one — a test fixture that
  // does not look like production is a test that proves less than it claims.
  lines.push("registration:");
  for (const k of ["state", "url", "opens_on", "closes_on"]) {
    lines.push(`  ${k}: ${q(r.registration[k])}`);
  }
  if (r.link === null) lines.push("link: null");
  else {
    lines.push("link:");
    for (const [k, v] of Object.entries(r.link)) lines.push(`  ${k}: ${q(v)}`);
  }
  for (const loc of ["en", "pl"]) {
    lines.push(`${loc}:`);
    for (const [k, v] of Object.entries(r[loc])) lines.push(`  ${k}: ${q(v)}`);
  }
  fs.writeFileSync(path.join(ANN_DIR, `${stem}.yaml`), lines.join("\n") + "\n");
  return `${stem}.yaml`;
}

/** Assert a specific validator message fires (or does not) for one defect. */
function rule({ name, over, file, expect, shouldFire, via = "validator" }) {
  const stem = file || `${PREFIX}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  try {
    record(stem, over);
    const out = via === "validator" ? runValidator() : runCmsCheck().out;
    const fired = out.includes(expect);
    check(fired === shouldFire,
      `${shouldFire ? "REJECTED" : "accepted"}: ${name}`,
      fired === shouldFire ? null
        : `expected ${via} ${shouldFire ? "to report" : "NOT to report"} "${expect}" — it did ${fired ? "" : "not"}`);
  } finally {
    fs.rmSync(path.join(ANN_DIR, `${stem}.yaml`), { force: true });
  }
}

try {
  /* =========================================================================
     Valid records
     ========================================================================= */

  section("1. Valid announcements are accepted");

  {
    // A valid current-year record must trip none of the announcement rules.
    const MESSAGES = [
      "malformed announcement academic years",
      "duplicate announcement display orders",
      "records whose slug does not match the filename",
      "duplicate announcement slugs",
      "invalid ISO dates",
      "publication dates that are not date-only",
      "image fields that are not null or root-relative",
      "unsupported image_fit values",
      "announcement fields containing HTML tags",
    ];
    const stem = `${PREFIX}-valid`;
    try {
      record(stem);
      const out = runValidator();
      const hit = MESSAGES.filter((m) => out.includes(m));
      check(hit.length === 0, "accepted: an ordinary current-year announcement",
        hit.length ? `unexpectedly rejected by: ${hit.join(", ")}` : null);
    } finally { fs.rmSync(path.join(ANN_DIR, `${stem}.yaml`), { force: true }); }
  }

  rule({ name: "a future-year announcement", over: { academic_year: "2026/27" },
    expect: "malformed announcement academic years", shouldFire: false });

  {
    // Future-year records are invisible without being unpublished — the two
    // concepts must stay separate.
    const stem = `${PREFIX}-future`;
    try {
      record(stem, { academic_year: "2026/27", order: 1 });
      const { code } = runCmsCheck();
      check(code === 0, "accepted: a future-year announcement needs no year change to exist",
        code === 0 ? null : "cms:check rejected a legitimate future-year record");
      const yaml = require("js-yaml");
      const parsed = yaml.load(fs.readFileSync(path.join(ANN_DIR, `${stem}.yaml`), "utf8"));
      check(parsed.published === true && parsed.academic_year === "2026/27",
        "a future-year announcement is published yet not current — the two are separate");
    } finally { fs.rmSync(path.join(ANN_DIR, `${stem}.yaml`), { force: true }); }
  }

  {
    // The same position in two different years is correct.
    const a = `${PREFIX}-order-2025`;
    const b = `${PREFIX}-order-2026`;
    try {
      record(a, { academic_year: "2025/26", order: 901 });
      record(b, { academic_year: "2026/27", order: 901 });
      const out = runValidator();
      check(!out.includes("duplicate announcement display orders"),
        "accepted: the same display position in two different academic years");
      const { code, out: co } = runCmsCheck();
      check(code === 0 && !/share a display position/.test(co),
        "cms:check also accepts a repeated position across years",
        code === 0 ? null : "cms:check reported a cross-year position clash");
    } finally {
      fs.rmSync(path.join(ANN_DIR, `${a}.yaml`), { force: true });
      fs.rmSync(path.join(ANN_DIR, `${b}.yaml`), { force: true });
    }
  }

  /* =========================================================================
     Invalid records
     ========================================================================= */

  section("2. Academic year, ordering and identity");

  rule({ name: "a malformed academic year", over: { academic_year: "2025" },
    expect: "malformed announcement academic years", shouldFire: true });

  rule({ name: "a non-consecutive academic year (2025/27)", over: { academic_year: "2025/27" },
    expect: "does not span consecutive years", shouldFire: true, via: "cms" });

  {
    // Two published records, same year, same position.
    const a = `${PREFIX}-clash-a`;
    const b = `${PREFIX}-clash-b`;
    try {
      record(a, { order: 902 });
      record(b, { order: 902 });
      const out = runValidator();
      check(out.includes("duplicate announcement display orders"),
        "REJECTED: two announcements sharing a position in the SAME year");
      const { out: co } = runCmsCheck();
      check(/share a display position in the same year/.test(co),
        "cms:check explains the same-year position clash");
    } finally {
      fs.rmSync(path.join(ANN_DIR, `${a}.yaml`), { force: true });
      fs.rmSync(path.join(ANN_DIR, `${b}.yaml`), { force: true });
    }
  }

  rule({ name: "filename does not match the Record ID",
    file: `${PREFIX}-mismatch`, over: { slug: `${PREFIX}-something-else` },
    expect: "records whose slug does not match the filename", shouldFire: true });

  {
    // Two files claiming one Record ID.
    const a = `${PREFIX}-dupe-a`;
    const b = `${PREFIX}-dupe-b`;
    try {
      record(a, { slug: `${PREFIX}-shared`, order: 903 });
      record(b, { slug: `${PREFIX}-shared`, order: 904 });
      const out = runValidator();
      check(out.includes("duplicate announcement slugs"), "REJECTED: a duplicate Record ID");
      const { out: co } = runCmsCheck();
      check(/two announcements claim the same Record ID/.test(co),
        "cms:check names the duplicate Record ID");
    } finally {
      fs.rmSync(path.join(ANN_DIR, `${a}.yaml`), { force: true });
      fs.rmSync(path.join(ANN_DIR, `${b}.yaml`), { force: true });
    }
  }

  {
    // The Decap collision artefact.
    const real = `${PREFIX}-collide`;
    const artefact = `${real}-1`;
    try {
      record(real, { order: 905 });
      record(artefact, { slug: real, order: 906 });
      const { code, out } = runCmsCheck();
      check(code !== 0 && /duplicate-ID collision/.test(out),
        "REJECTED: the Decap -1 collision artefact");
      check(new RegExp(real + "\\.yaml").test(out),
        "cms:check names the conflicting existing announcement");
    } finally {
      fs.rmSync(path.join(ANN_DIR, `${real}.yaml`), { force: true });
      fs.rmSync(path.join(ANN_DIR, `${artefact}.yaml`), { force: true });
    }
  }

  for (const bad of ["ZZ Test", "zz_test", "zz/test", "../zz"]) {
    const stem = `${PREFIX}-unsafe`;
    try {
      record(stem, { slug: bad });
      const { code, out } = runCmsCheck();
      check(code !== 0 && /(not filename-safe|disagree)/.test(out),
        `REJECTED: unsafe Record ID ${JSON.stringify(bad)}`);
    } finally { fs.rmSync(path.join(ANN_DIR, `${stem}.yaml`), { force: true }); }
  }

  section("3. Dates");

  rule({ name: "an impossible calendar date", over: { published_date: "2026-02-31" },
    expect: "invalid ISO dates", shouldFire: true });

  rule({ name: "a full timestamp instead of a calendar day",
    over: { rawDate: "2026-05-14T13:45:00Z" },
    expect: "publication dates that are not date-only", shouldFire: true });

  rule({ name: "the bare YYYY-MM-DD form Decap writes", over: { rawDate: "2026-05-14" },
    expect: "publication dates that are not date-only", shouldFire: false });

  {
    // The point of accepting the bare form: it must mean the same calendar day
    // even on a machine east of UTC.
    const stem = `${PREFIX}-bare-date`;
    try {
      record(stem, { rawDate: "2026-05-14" });
      const loaded = require(path.join(ROOT, "src", "_data", "records.js"))();
      const rec = loaded.announcements.find((a) => a.slug === stem);
      check(rec && rec.published_date === "2026-05-14",
        "the bare date normalises to the identical calendar day (no timezone shift)",
        rec ? `loader gave ${JSON.stringify(rec.published_date)}` : "record not loaded");
      check(rec && typeof rec.published_date === "string",
        "the normalised date is a string, not a Date object");
    } finally { fs.rmSync(path.join(ANN_DIR, `${stem}.yaml`), { force: true }); }
  }

  section("4. Media");

  rule({ name: "an image outside /assets/", over: { image: "/uploads/x.jpg" },
    expect: "image fields that are not null or root-relative", shouldFire: true });

  rule({ name: "a /pl/assets/ image", over: { image: "/pl/assets/announcements/x.jpg" },
    expect: "language-prefixed", shouldFire: true, via: "cms" });

  rule({ name: "a Windows absolute path",
    over: { image: "C:\\Users\\someone\\photo.jpg" },
    expect: "a path on somebody's own computer", shouldFire: true, via: "cms" });

  rule({ name: "an external image URL",
    over: { image: "https://random-host.example/photo.jpg" },
    expect: "hotlinked from another site", shouldFire: true, via: "cms" });

  rule({ name: "a nonexistent local asset",
    over: { image: "/assets/announcements/zz-does-not-exist.jpg" },
    expect: "is missing", shouldFire: true, via: "cms" });

  rule({ name: "an empty-string image", over: { image: "" },
    expect: "is an empty string", shouldFire: true, via: "cms" });

  rule({ name: "a missing optional image (null)", over: { image: null },
    expect: "the main image", shouldFire: false, via: "cms" });

  rule({ name: "a broken extra image",
    over: { extra_images: ["/assets/announcements/zz-nope.jpg"] },
    expect: "extra image 1 is missing", shouldFire: true, via: "cms" });

  rule({ name: "an invalid image-fit value", over: { image_fit: "cover-ish" },
    expect: "unsupported image_fit values", shouldFire: true });

  rule({ name: "an invalid backdrop colour", over: { image_background: "navy" },
    expect: "not a hex colour", shouldFire: true, via: "cms" });

  section("5. Links");

  rule({ name: "an event link to a nonexistent event",
    over: { link: { type: "event", event_slug: "missing-event" },
      en: { title: "ZZ", subtitle: "s", body: "b", link_label: "Read" },
      pl: { title: "ZZ", subtitle: "s", body: "b", link_label: "Czytaj" } },
    expect: 'event slug "missing-event" does not exist', shouldFire: true, via: "cms" });

  rule({ name: "an event link to a real event",
    over: { link: { type: "event", event_slug: "icebreaker" },
      en: { title: "ZZ", subtitle: "s", body: "b", link_label: "Read" },
      pl: { title: "ZZ", subtitle: "s", body: "b", link_label: "Czytaj" } },
    expect: "does not exist", shouldFire: false, via: "cms" });

  for (const [scheme, url] of [["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>x</script>"], ["file:", "file:///etc/passwd"]]) {
    rule({ name: `an external link using ${scheme}`,
      over: { link: { type: "external", url },
        en: { title: "ZZ", subtitle: "s", body: "b", link_label: "Read" },
        pl: { title: "ZZ", subtitle: "s", body: "b", link_label: "Czytaj" } },
      expect: "unsafe scheme", shouldFire: true, via: "cms" });
  }

  rule({ name: "an external link over plain http",
    over: { link: { type: "external", url: "http://insecure.example/" },
      en: { title: "ZZ", subtitle: "s", body: "b", link_label: "Read" },
      pl: { title: "ZZ", subtitle: "s", body: "b", link_label: "Czytaj" } },
    expect: "not a valid https:// URL", shouldFire: true, via: "cms" });

  rule({ name: "an unsupported link type",
    over: { link: { type: "telepathy" },
      en: { title: "ZZ", subtitle: "s", body: "b", link_label: "Read" },
      pl: { title: "ZZ", subtitle: "s", body: "b", link_label: "Czytaj" } },
    expect: "the link type is not supported", shouldFire: true, via: "cms" });

  rule({ name: "a link with no button label",
    over: { link: { type: "external", url: "https://example.com/" } },
    expect: "button has no label", shouldFire: true, via: "cms" });

  section("6. Link normalisation — the four destination transitions");

  {
    /*
      These are unit tests of the exact function the admin page runs: the page
      embeds `normaliseAnnouncementLink.toString()`, so there is no second copy
      to drift.

      What they are really protecting: Decap's object widget keeps every
      sub-field it has ever held, so an editor who changes their mind leaves the
      previous destination behind. Every case below asserts that the abandoned
      destination is GONE, not merely that the new one is present — the stale
      value is the whole defect.
    */
    const { normaliseAnnouncementLink: n } = require(path.join(ROOT, "src", "_data", "cmsConfig.js"));
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    check(n(null) === null, "no link stays no link");
    check(n(undefined) === null, "an absent link is no link");
    check(n({}) === null, "an empty link object is no link");
    check(n({ type: "" }) === null, "an unset destination is no link");

    check(eq(n({ type: "event", event_slug: "icebreaker" }), { type: "event", event_slug: "icebreaker" }),
      "a clean event link is unchanged");
    check(eq(n({ type: "external", url: "https://example.com/" }), { type: "external", url: "https://example.com/" }),
      "a clean external link is unchanged");

    // event -> none
    check(n({ type: "none", event_slug: "icebreaker" }) === null,
      "event → No link: the event slug is removed");
    // external -> none
    check(n({ type: "none", url: "https://example.com/" }) === null,
      "external → No link: the URL is removed");
    // event -> external
    {
      const out = n({ type: "external", url: "https://example.com/", event_slug: "icebreaker" });
      check(eq(out, { type: "external", url: "https://example.com/" }),
        "event → external: the stale event slug is removed", JSON.stringify(out));
      check(!("event_slug" in out), "  and no event_slug key survives");
    }
    // external -> event
    {
      const out = n({ type: "event", event_slug: "icebreaker", url: "https://example.com/" });
      check(eq(out, { type: "event", event_slug: "icebreaker" }),
        "external → event: the stale URL is removed", JSON.stringify(out));
      check(!("url" in out), "  and no url key survives");
    }
    // Both stale at once, which is what the old UI could produce.
    check(n({ type: "none", event_slug: "icebreaker", url: "https://example.com/" }) === null,
      "No link clears BOTH a stale event and a stale URL");

    // An incomplete choice is not a link.
    check(n({ type: "event" }) === null, "Federation event with no event chosen is no link");
    check(n({ type: "external" }) === null, "External website with no address is no link");
    check(n({ type: "external", url: "   " }) === null, "a whitespace-only address is no link");
    check(eq(n({ type: "external", url: "  https://example.com/  " }), { type: "external", url: "https://example.com/" }),
      "an address is trimmed");

    // An unknown type is passed through for the validator to report, rather
    // than silently discarded.
    check(eq(n({ type: "page", url: "/x.html" }), { type: "page", url: "/x.html" }),
      "an unrecognised type is passed through untouched, not dropped");

    // The output shape is exactly what the canonical records contain.
    const canonical = ["type", "event_slug"];
    check(eq(Object.keys(n({ type: "event", event_slug: "x", url: "https://y.example/" })), canonical),
      "a normalised event link has exactly the canonical keys, in order");
    check(eq(Object.keys(n({ type: "external", url: "https://y.example/", event_slug: "x" })), ["type", "url"]),
      "a normalised external link has exactly the canonical keys, in order");
  }

  {
    // The editor-only value must never reach a file. If it ever does — meaning
    // normalisation did not run — the repository must reject it loudly.
    const stem = `${PREFIX}-none-type`;
    try {
      record(stem, { link: { type: "none" },
        en: { title: "ZZ", subtitle: "s", body: "b", link_label: "Read" },
        pl: { title: "ZZ", subtitle: "s", body: "b", link_label: "Czytaj" } });
      const { code, out } = runCmsCheck();
      check(code !== 0 && /the link type is not supported/.test(out),
        'REJECTED: a stored type "none" (normalisation must have run)');
      const v = runValidator();
      check(v.includes("unsupported announcement link types") || v.includes("link type"),
        "the main validator also rejects a stored \"none\"");
    } finally { fs.rmSync(path.join(ANN_DIR, `${stem}.yaml`), { force: true }); }
  }

  section("7. Markdown safety");

  rule({ name: "raw HTML in an announcement body",
    over: { en: { title: "ZZ", subtitle: "s", body: "<script>alert(1)</script>" },
      pl: { title: "ZZ", subtitle: "s", body: "Akapit." } },
    expect: "announcement fields containing HTML tags", shouldFire: true });

  rule({ name: "an unsafe protocol in a Markdown body link",
    over: { en: { title: "ZZ", subtitle: "s", body: "See [this](javascript:alert(1))." },
      pl: { title: "ZZ", subtitle: "s", body: "Akapit." } },
    expect: "body links using an unsafe or unrecognised protocol", shouldFire: true });

  rule({ name: "ordinary Markdown with emphasis, a list and a link",
    over: {
      en: { title: "ZZ", subtitle: "s",
        body: "A **bold** and *italic* paragraph.\n\n- one\n- two\n\nSee [the site](https://example.com/)." },
      pl: { title: "ZZ", subtitle: "s",
        body: "Akapit z **pogrubieniem**, zażółć gęślą jaźń.\n\n- raz\n- dwa" },
    },
    expect: "announcement fields containing HTML tags", shouldFire: false });

  {
    // The build's own safety boundary, asserted rather than assumed.
    const cfg = fs.readFileSync(path.join(ROOT, "eleventy.config.js"), "utf8");
    check(/html:\s*false/.test(cfg) && !/html:\s*true/.test(cfg),
      "markdown-it still renders with raw HTML disabled");
    const MarkdownIt = require(path.join(ROOT, "node_modules", "markdown-it"));
    const md = new MarkdownIt({ html: false });
    const out = md.render("<script>alert(1)</script>\n\nzażółć **gęślą** jaźń");
    check(!/<script>/.test(out) && /&lt;script&gt;/.test(out),
      "a stored <script> renders as visible text, not as markup");
    check(/<strong>gęślą<\/strong>/.test(out),
      "Polish diacritics and emphasis survive Markdown rendering");
  }
} finally {
  cleanup();
}

/* =========================================================================
   Nothing left behind
   ========================================================================= */

section("8. This test left nothing behind");

{
  const after = fs.readdirSync(ANN_DIR).filter((f) => /\.ya?ml$/i.test(f)).sort();
  const afterHash = crypto.createHash("sha256")
    .update(after.map((f) => f + ":" + fs.readFileSync(path.join(ANN_DIR, f)).toString("base64")).join("|"))
    .digest("hex");
  check(after.length === baseline.length,
    `content/announcements/ still holds exactly ${baseline.length} records`, `found ${after.length}`);
  check(!after.some((f) => f.startsWith(PREFIX)), "no test announcement remains",
    after.filter((f) => f.startsWith(PREFIX)).join(", "));
  check(afterHash === baselineHash, "every real announcement is byte-identical to before the run",
    afterHash === baselineHash ? null : "a real announcement was modified");
}

/* ===========================================================================
   Image focus (Phase 17C.3)

   The stored value ends up inside a `style` attribute, so the parser is the
   security boundary as well as the convenience: anything it does not recognise
   must produce NOTHING rather than being passed through.

   The legacy cases matter most. Five announcements already carry positions
   written by hand, and every one of them has to keep rendering exactly as it
   does on the published site.
   =========================================================================== */

section("Image focus (Phase 17C.3)");

{
  const F = require(path.join(ROOT, "src", "_data", "focalPoint.js"));

  // -- every distinct value that exists in the repository today -------------
  const yaml = require("js-yaml");
  const stored = {};
  for (const f of fs.readdirSync(ANN_DIR).filter((x) => /\.ya?ml$/i.test(x) && !x.startsWith(PREFIX))) {
    const d = yaml.load(fs.readFileSync(path.join(ANN_DIR, f), "utf8")) || {};
    const v = d.image_position === undefined ? null : d.image_position;
    stored[JSON.stringify(v)] = (stored[JSON.stringify(v)] || 0) + 1;
  }
  const LEGACY = {
    "null": null,
    '"center top"': "50% 0%",
    '"center 30%"': "50% 30%",
    '"center 22%"': "50% 22%",
  };
  for (const key of Object.keys(stored)) {
    check(Object.prototype.hasOwnProperty.call(LEGACY, key),
      `a stored image focus this test knows about: ${key}`,
      `${stored[key]} record(s)`);
    if (!Object.prototype.hasOwnProperty.call(LEGACY, key)) continue;
    const got = F.focalStyle(JSON.parse(key));
    check(got === LEGACY[key],
      `${key} still renders as ${LEGACY[key] === null ? "no attribute at all" : LEGACY[key]}`,
      `${stored[key]} record(s) -> ${JSON.stringify(got)}`);
  }

  // -- accepted --------------------------------------------------------------
  const ok = [
    [null, null], [undefined, null], ["", null],
    ["center", "50% 50%"], ["centre", "50% 50%"],
    ["left top", "0% 0%"], ["right bottom", "100% 100%"],
    ["center top", "50% 0%"], ["center 30%", "50% 30%"],
    ["50% 50%", "50% 50%"], ["0% 0%", "0% 0%"], ["100% 100%", "100% 100%"],
    [{ x: 0, y: 0 }, "0% 0%"], [{ x: 100, y: 100 }, "100% 100%"],
    [{ x: 30, y: 75 }, "30% 75%"], [{ x: 50, y: 50 }, "50% 50%"],
    [{ x: 33.4, y: 66.6 }, "33% 67%"],
  ];
  for (const [input, want] of ok) {
    const got = F.focalStyle(input);
    check(got === want, `accepted: ${JSON.stringify(input)}`,
      `-> ${JSON.stringify(got)}`);
  }

  // -- refused ---------------------------------------------------------------
  const bad = [
    { x: -1, y: 50 }, { x: 50, y: 101 }, { x: "a", y: 5 }, { x: NaN, y: 0 },
    { x: null, y: null }, {}, [50, 50], 42, true,
    "50", "50%; background:url(x)", "calc(50% + 2px) 50%", "url(evil.png)",
    "left center right", "top", "-10% 50%", "110% 0%", "50px 20px",
    "expression(alert(1))", "50% 50%; }",
  ];
  for (const input of bad) {
    const got = F.focalStyle(input);
    check(got === null, `refused: ${JSON.stringify(input)}`,
      got === null ? "no attribute produced" : `LEAKED ${JSON.stringify(got)}`);
  }

  // Nothing a refused value contains may reach a style attribute.
  for (const input of bad) {
    const attr = F.focalStyleAttr(input);
    check(attr === "", `no style attribute for ${JSON.stringify(input)}`, "empty");
  }
  check(F.focalStyleAttr({ x: 30, y: 75 }) === ' style="object-position: 30% 75%"',
    "a valid focus produces exactly one safe style attribute",
    F.focalStyleAttr({ x: 30, y: 75 }));

  // -- the admin widget parses the same way ----------------------------------
  const widget = fs.readFileSync(path.join(ROOT, "src", "admin", "focal-point.js"), "utf8");
  check(/typeof value\.get === "function"/.test(widget),
    "the widget reads a stored pair through .get, so an Immutable value loads correctly",
    "a saved focus reopens where it was left");
  check(/registerWidget\("focalPoint"/.test(widget),
    "the focus control is registered through the documented widget API",
    "CMS.registerWidget");
  for (const forbidden of ["store.getState", "__REDUX", "dispatch(", "document.querySelector('.css-"]) {
    check(!widget.includes(forbidden),
      `the focus control does not reach into Decap internals (${forbidden})`, "absent");
  }
  check(/value\.trim\(\)\.toLowerCase\(\)\.split/.test(widget),
    "the widget parses with the same narrow rules as the renderer", "narrow parser");

  // -- the widget must not reach the public site -----------------------------
  for (const f of ["dist/js/main.js", "dist/js/announcements-page.js"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const t = fs.readFileSync(p, "utf8");
    check(!/registerWidget|fed-focal/.test(t),
      `no editor widget code reaches ${f}`, "public output is free of CMS code");
  }
}

/* ===========================================================================
   Registration (Phase 17C.3)

   Negative controls against the REAL validator, in the same style as the rest of
   this file: inject one specific defect and assert that rule's own wording
   appears. The states are an editorial choice, so the rules that matter are the
   ones about coherence — a Register button must have somewhere to go, and a
   record that is not open must not be carrying a live sign-up address.
   =========================================================================== */

section("Registration replaces the sign-ups switch (Phase 17C.3)");

{
  const reg = (over) => ({ registration: { state: "none", url: null, opens_on: null, closes_on: null, ...over } });

  rule({ name: "no registration", over: reg({}),
    expect: "unknown registration states", shouldFire: false });
  rule({ name: "coming soon", over: reg({ state: "coming_soon" }),
    expect: "unknown registration states", shouldFire: false });
  rule({ name: "open with an https address",
    over: reg({ state: "open", url: "https://example.com/signup" }),
    expect: "unknown registration states", shouldFire: false });
  rule({ name: "closed", over: reg({ state: "closed" }),
    expect: "unknown registration states", shouldFire: false });

  rule({ name: "an unknown registration state", over: reg({ state: "maybe" }),
    expect: "unknown registration states", shouldFire: true });
  rule({ name: "open with nowhere to sign up", over: reg({ state: "open" }),
    expect: "open registrations with nowhere to go", shouldFire: true });
  rule({ name: "an insecure registration address",
    over: reg({ state: "open", url: "http://example.com/signup" }),
    expect: "unsafe or malformed registration addresses", shouldFire: true });
  rule({ name: "a javascript: registration address",
    over: reg({ state: "open", url: "javascript:alert(1)" }),
    expect: "unsafe or malformed registration addresses", shouldFire: true });
  rule({ name: "a sign-up address on a closed record",
    over: reg({ state: "closed", url: "https://example.com/signup" }),
    expect: "registration addresses on records that are not open", shouldFire: true });
  rule({ name: "sign-ups that close before they open",
    over: reg({ state: "coming_soon", opens_on: "2026-06-01", closes_on: "2026-05-01" }),
    expect: "registrations that close before they open", shouldFire: true });
  rule({ name: "sign-up dates in the right order",
    over: reg({ state: "coming_soon", opens_on: "2026-05-01", closes_on: "2026-06-01" }),
    expect: "registrations that close before they open", shouldFire: false });
}

{
  // Details and registration are independent: both may be set at once, and the
  // validator must not object to an announcement that carries the two.
  const stem = `${PREFIX}-dual`;
  try {
    record(stem, {
      registration: { state: "open", url: "https://example.com/signup", opens_on: null, closes_on: null },
      link: { type: "event", event_slug: "icebreaker" },
      en: { title: "ZZ Dual", subtitle: "Both.", body: "A paragraph.", link_label: "Explore the event" },
      pl: { title: "ZZ Oba", subtitle: "Oba.", body: "Akapit.", link_label: "Zobacz wydarzenie" },
    });
    const out = runValidator();
    const complaints = [
      "unknown registration states", "open registrations with nowhere to go",
      "registration addresses on records that are not open",
      "unsafe or malformed registration addresses",
    ].filter((m) => out.includes(m));
    check(complaints.length === 0,
      "accepted: an announcement with BOTH a details link and open registration",
      complaints.length ? `objected: ${complaints.join(", ")}` : "the two are independent");
  } finally { fs.rmSync(path.join(ANN_DIR, `${stem}.yaml`), { force: true }); }
}

{
  // The migration's meaning: the eight records that were closed still are, and
  // nothing else acquired a registration by accident.
  const yaml = require("js-yaml");
  const live = fs.readdirSync(ANN_DIR).filter((f) => /\.ya?ml$/i.test(f) && !f.startsWith(PREFIX))
    .map((f) => yaml.load(fs.readFileSync(path.join(ANN_DIR, f), "utf8")) || {});
  const closed = live.filter((a) => a.registration && a.registration.state === "closed");
  const none = live.filter((a) => a.registration && a.registration.state === "none");
  check(closed.length === 8, "the eight closed announcements are still closed after the migration",
    `${closed.length} closed`);
  check(none.length === live.length - 8,
    "every other announcement has no registration, as before",
    `${none.length} with no registration`);
  check(live.every((a) => a.signups_closed === undefined),
    "no record still carries the replaced sign-ups switch",
    "one source of truth");
  check(live.every((a) => !a.registration || a.registration.url === null),
    "the migration invented no sign-up addresses",
    "external links were not silently turned into registration links");
}

/* ===========================================================================
   Language tabs (Phase 17C.3)

   The English / Polski switcher is PRESENTATION. These assertions guard the one
   property that matters: it must not be able to change, drop or reshape what is
   stored. A switcher that loses the language an editor cannot currently see
   would be worse than the long form it replaced.
   =========================================================================== */

section("Language tabs are presentation only (Phase 17C.3)");

{
  const tabsFile = path.join(ROOT, "src", "admin", "language-tabs.js");
  check(fs.existsSync(tabsFile), "the language switcher exists as its own file",
    "present");

  const src = fs.existsSync(tabsFile) ? fs.readFileSync(tabsFile, "utf8") : "";

  // Hiding keeps the React tree mounted. Removing, detaching or re-parenting a
  // panel would unmount its controls and lose unsaved text.
  check(/classList\.toggle\(HIDDEN_CLASS/.test(src),
    "panels are hidden by class, so fields stay mounted and keep unsaved values",
    "the switcher does not hide by class");
  for (const forbidden of ["removeChild", "innerHTML =", "outerHTML", "replaceChild", "cloneNode"]) {
    check(!src.includes(forbidden),
      `the switcher never uses ${forbidden}, which would destroy unsaved input`,
      "absent");
  }

  // The brief forbids reaching into Decap's internals.
  for (const forbidden of ["store.getState", "__REDUX", "dispatch("]) {
    check(!src.includes(forbidden),
      `the switcher does not touch Decap internals (${forbidden})`,
      "absent");
  }

  // Anchoring: semantic attributes and our own labels, never generated classes.
  check(src.includes('aria-label="object field"'),
    "panels are found by their accessibility role, not a generated class name",
    "anchored on aria-label");
  check(/nestingDepth\(c\) !== 0/.test(src),
    "only TOP-LEVEL language objects count as panels, so venue.name.en is safe",
    "nested fields excluded");

  const cssFile = path.join(ROOT, "src", "admin", "language-tabs.css");
  check(fs.existsSync(cssFile), "the switcher has its own stylesheet", "present");
  const cssSrc = fs.existsSync(cssFile) ? fs.readFileSync(cssFile, "utf8") : "";
  check(/@media[^{]*max-width/.test(cssSrc),
    "the switcher has a narrow-screen rule, so it is usable on a phone",
    "max-width rule present");
  check(/min-height:\s*2\.75rem/.test(cssSrc),
    "the tabs meet a touch-friendly target height", "44px target");

  // Both assets must actually reach the admin page.
  const admin = fs.readFileSync(path.join(ROOT, "src", "admin", "index.njk"), "utf8");
  check(/cmsConfig\.languageTabsScript/.test(admin),
    "the admin page embeds the switcher script", "embedded from its own file");
  check(/cmsConfig\.languageTabsStyles/.test(admin),
    "the admin page embeds the switcher styles", "embedded from its own file");
}

{
  // The canonical shape must be untouched by any of this.
  const cfg = require(path.join(ROOT, "src", "_data", "cmsConfig.js")).buildConfig();
  const ann = cfg.collections.find((c) => c.name === "announcements");
  const en = (ann.fields || []).find((f) => f.name === "en");
  const pl = (ann.fields || []).find((f) => f.name === "pl");
  check(en && en.widget === "object" && pl && pl.widget === "object",
    "announcements still store en and pl as two objects in ONE record",
    "one record, two objects");
  check(en && en.label === "English" && pl && pl.label === "Polski",
    "the language panels carry the labels the switcher looks for",
    `${en && en.label} / ${pl && pl.label}`);
  check(!JSON.stringify(cfg).includes('"i18n"'),
    "Decap's own i18n is NOT enabled — one record still holds both languages",
    "not enabled");
}

/* -- output ----------------------------------------------------------------- */

/* ================================================ a bare YAML date ======== */

/*
  THE DATE THE CMS ACTUALLY WRITES.

  Publishing a real announcement failed with 400 "The published date must be a
  calendar day" — for a record whose date was exactly right. Decap's date widget
  had done its job: it displayed 29/08/2026 and serialised the canonical
  `published_date: 2026-08-29`.

  Unquoted, that is a YAML 1.1 timestamp, and js-yaml's default schema hands
  back a JS Date. Every check here then saw
  "Sat Aug 29 2026 02:00:00 GMT+0200" and refused it.

  These run the RAW YAML through rules.check() — the same parse and the same
  validation persistEntry uses — rather than testing a helper in isolation,
  because the defect lived in the gap between the parser and the rule.
*/
section("A bare YAML date, as the CMS writes it");
{
  const announcement = (dateLine, extra) => `slug: rekrutacja2627
academic_year: 2026/27
${dateLine}
order: 1
published: true
image: null
image_position: null
image_fit: null
image_background: null
extra_images: []
registration:
  state: open
  url: "https://forms.gle/EMbydwqPBcVT5SWm8"
${extra || "  opens_on: 2026-02-01"}
  closes_on: null
link:
  type: none
en:
  title: "Rekrutacja 2026/27"
  subtitle: "Applications are open."
  link_label: "Apply"
  body: |
    Applications are **open** now.
pl:
  title: "Rekrutacja 2026/27"
  subtitle: "Nabór jest otwarty."
  link_label: "Aplikuj"
  body: |
    Nabór jest **otwarty**.
`;

  const verdict = (raw) =>
    rules.check("content/announcements/rekrutacja2627.yaml", raw, "content/announcements");

  /* The exact record from production. */
  const real = verdict(announcement("published_date: 2026-08-29"));
  check(real === null,
    "the record the CMS actually sends is accepted",
    real === null ? "published_date: 2026-08-29" : `refused: ${real}`);

  /* Quoted must keep working — every existing record is written that way. */
  check(verdict(announcement('published_date: "2026-08-29"')) === null,
    "a quoted date is accepted too", "existing records are unaffected");

  /*
    THE NESTED ONE. rules.js checks any *_on field, and registration.opens_on
    comes back as a Date exactly like published_date. It would have been the
    next failure.
  */
  check(verdict(announcement("published_date: 2026-08-29", "  opens_on: 2026-02-01")) === null,
    "an unquoted date inside the registration block is accepted too",
    "registration.opens_on");

  /* -- and the meaning must survive the conversion ------------------------- */

  const { normaliseDatesDeep } = require(path.join(ROOT, "src/_data/dateOnly.js"));
  const parsed = normaliseDatesDeep(yaml.load(announcement("published_date: 2026-08-29")));
  check(parsed.published_date === "2026-08-29",
    "the stored meaning is still that calendar day", JSON.stringify(parsed.published_date));
  check(typeof parsed.published_date === "string",
    "…as a string, not a Date", typeof parsed.published_date);
  check(parsed.registration.opens_on === "2026-02-01",
    "…and so is the nested one", JSON.stringify(parsed.registration.opens_on));

  /*
    NO TIMEZONE SHIFT. The Date js-yaml produces is midnight UTC, which is the
    previous day everywhere west of Greenwich. Reading its UTC components is
    what keeps the 29th the 29th; local ones would make it the 28th for half
    the world.
  */
  const shifted = normaliseDatesDeep({ d: new Date(Date.UTC(2026, 7, 29)) }).d;
  check(shifted === "2026-08-29",
    "a midnight-UTC date keeps its day, whatever the machine's zone", shifted);

  /* -- what must still be refused ------------------------------------------ */

  for (const [label, line] of [
    ["a real time of day", "published_date: 2026-08-29T14:30:00Z"],
    ["a quoted timestamp", 'published_date: "2026-08-29T14:30:00Z"'],
    ["the 31st of February", 'published_date: "2026-02-31"'],
    ["the 29th of a non-leap February", 'published_date: "2027-02-29"'],
    ["month thirteen", 'published_date: "2026-13-01"'],
    ["a day-first date", 'published_date: "29/08/2026"'],
    ["prose", 'published_date: "tomorrow"'],
  ]) {
    const refused = verdict(announcement(line));
    check(refused !== null, `${label} is still refused`, refused || "ACCEPTED — too loose");
  }

  /* A genuine leap day is a day. */
  check(verdict(announcement("published_date: 2028-02-29")) === null,
    "a real leap day is accepted", "2028-02-29");
}

console.log("\n" + "=".repeat(78));
console.log("  ANNOUNCEMENT RULES — negative controls");
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
