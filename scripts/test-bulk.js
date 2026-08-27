#!/usr/bin/env node
/**
 * test-bulk.js — the Bulk Manage backend.
 *
 * WHAT THIS IS FOR
 *
 * Bulk operations are the one place in this CMS where a single click changes
 * many records, so the interesting questions are not "does hide work" but
 * "what happens when part of the selection is wrong". The answer has to be
 * "nothing at all", every time, and that is what most of these assertions are
 * about: after a refused operation, every file involved must be byte-identical
 * to what it was before.
 *
 * FIXTURES, NOT REAL RECORDS
 *
 * Every test writes its own records into the canonical folders, exercises them,
 * and removes them again. Real content is read but never written: the guards at
 * the end of this file compare the twenty-eight announcements, twenty-one team
 * members and four standard events against the state they were in when the run
 * started, and fail if a single byte moved.
 *
 * Run:  node scripts/test-bulk.js       (or: npm run test:bulk)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const yaml = require("js-yaml");

const store = require("./bulk/local-store.js");
const api = require("./bulk/api.js");
const { collectionFor, folderOf } = require("./bulk/collections.js");

const ROOT = path.join(__dirname, "..");
const FIXTURE_PREFIX = "zz-bulk-test-";

let checks = 0;
const problems = [];

function check(ok, what, detail) {
  checks++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}`);
  if (detail) console.log(`          ${detail}`);
  if (!ok) problems.push(what + (detail ? ` — ${detail}` : ""));
}

function section(title) {
  console.log(`\n  ${title}\n  ${"-".repeat(title.length)}`);
}

/* -- fixtures --------------------------------------------------------------- */

const created = [];

function fixturePath(collectionKey, id) {
  return path.join(folderOf(collectionFor(collectionKey)), `${id}.yaml`);
}

function makeFixture(collectionKey, id, body) {
  const file = fixturePath(collectionKey, id);
  fs.writeFileSync(file, body, "utf8");
  created.push(file);
  return file;
}

function teamFixture(id, opts) {
  const o = opts || {};
  return makeFixture("team", id,
    `# TEST FIXTURE — created by scripts/test-bulk.js, removed by it too.\n` +
    `slug: ${id}\n` +
    `academic_year: "${o.year || "2025/26"}"\n` +
    `group: trustees\n` +
    `order: 99\n` +
    `published: ${o.published === false ? "false" : "true"}\n` +
    `\nname: "Test Fixture Person"\n` +
    `photo: "/assets/team/${FIXTURE_PREFIX}photo.jpg"\n` +
    `email: null\nlinkedin: null\n` +
    `\nen:\n  role: "Test Role"\n  photo_alt: "Test"\n` +
    `\npl:\n  role: "Rola testowa"\n  photo_alt: "Test"\n`);
}

function eventFixture(id, opts) {
  const o = opts || {};
  return makeFixture("standard-events", id,
    `# TEST FIXTURE — created by scripts/test-bulk.js, removed by it too.\n` +
    `slug: ${id}\n` +
    `event_family: standard\ntemplate: standard\n` +
    `academic_year: ${o.year || "2025/26"}\n` +
    `published: ${o.published === false ? "false" : "true"}\n` +
    `order: 99\nflagship: false\n` +
    `show_in_listing: ${o.showInListing === false ? "false" : "true"}\n` +
    `show_on_homepage: true\nshow_in_archive: true\n` +
    `start_date: "${o.startDate || "2025-11-01"}"\nend_date: null\n` +
    `date_precision: day\n` +
    `venue:\n  name:\n    en: Test\n    pl: Test\n` +
    `registration:\n  state: none\n  url: null\n  opens_on: null\n  closes_on: null\n` +
    `en:\n  title_lead: "Test Fixture Event"\n  summary: "Test."\n` +
    `pl:\n  title_lead: "Testowe wydarzenie"\n  summary: "Test."\n`);
}

function announcementFixture(id, opts) {
  const o = opts || {};
  const link = o.linkEvent
    ? `link:\n  type: event\n  event_slug: ${o.linkEvent}\n`
    : `link:\n  type: none\n`;
  const registration = o.registrationEvent
    ? `registration:\n  source: event\n  event_slug: ${o.registrationEvent}\n`
    : `registration:\n  state: none\n  url: null\n  opens_on: null\n  closes_on: null\n`;
  return makeFixture("announcements", id,
    `# TEST FIXTURE — created by scripts/test-bulk.js, removed by it too.\n` +
    `slug: ${id}\n` +
    `academic_year: "${o.year || "2025/26"}"\n` +
    `published_date: "2025-11-02"\norder: 99\n` +
    `published: ${o.published === false ? "false" : "true"}\n` +
    `image: null\nextra_images: []\n` +
    registration + link +
    `en:\n  title: "Test Fixture Announcement"\n  subtitle: "Test."\n  body: |\n    Test.\n` +
    `pl:\n  title: "Testowe ogloszenie"\n  subtitle: "Test."\n  body: |\n    Test.\n`);
}

function cleanup() {
  for (const file of created) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  created.length = 0;
}

/** What the screen would send for a record: its ID and the revision it saw. */
function itemFor(collectionKey, id) {
  const found = store.readRecord(collectionFor(collectionKey), id);
  return { id, rev: found ? found.rev : "missing" };
}

const hashOf = (file) => (fs.existsSync(file)
  ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : "absent");

/* -- the real records, before anything runs --------------------------------- */

function snapshotReal() {
  const snapshot = {};
  for (const key of ["team", "announcements", "standard-events"]) {
    const folder = folderOf(collectionFor(key));
    for (const name of fs.readdirSync(folder)) {
      if (!/\.ya?ml$/i.test(name) || name.startsWith(FIXTURE_PREFIX)) continue;
      snapshot[path.join(folder, name)] = hashOf(path.join(folder, name));
    }
  }
  return snapshot;
}

const realBefore = snapshotReal();

console.log("\n" + "=".repeat(78));
console.log("  BULK MANAGE BACKEND");
console.log("=".repeat(78));

/* -- 1. the allow-list ------------------------------------------------------ */

section("1. Only the three managed collections exist");
{
  check(store.listRecords("team").records !== undefined,
    "Team can be listed", store.listRecords("team").records.length + " records");
  check(store.listRecords("announcements").records.length === 28,
    "Announcements can be listed", "28 records");
  check(store.listRecords("standard-events").records.length === 4,
    "Standard Events can be listed",
    store.listRecords("standard-events").records.length + " records");

  /*
    content/events/ holds the Business Forum too. Excluding it by FAMILY rather
    than by filename means a second Forum edition added later is excluded
    without anybody remembering to update a list.
  */
  const eventIds = store.listRecords("standard-events").records.map((r) => r.id);
  check(!eventIds.includes("business-forum"),
    "the Business Forum is not offered for bulk management", "excluded by family");

  for (const bad of ["business-forum", "settings", "societies", "", "Team", "../team"]) {
    const result = store.listRecords(bad);
    check(result.error && result.error.code === "unknown_collection",
      `an unknown collection is refused: ${JSON.stringify(bad)}`, "refused");
  }
}

/* -- 2. path traversal ------------------------------------------------------ */

section("2. A record ID cannot become a path");
{
  /*
    None of these can be SPELLED with the characters a record ID allows, which
    is a stronger property than filtering them out: there is no branch in the
    store that concatenates caller input into a path without first matching this
    pattern. The resolved-path containment check is a second, independent guard.
  */
  const attacks = [
    "../secret", "..\\secret", "../../package", "/etc/passwd",
    "C:\\Windows\\System32\\config", "\\\\server\\share\\file",
    "team/../../package", ".", "..", "record.yaml", "UPPER", "sp ace",
    "sub/dir", "record%2e%2e", "nul", "-leading", "a".repeat(200),
  ];
  for (const id of attacks) {
    const resolved = store.fileFor(collectionFor("team"), id);
    const update = store.updateRecords("team", "hide", [{ id, rev: "x" }]);
    check(resolved === null && update.error && update.error.code === "invalid_id",
      `refused as a record ID: ${JSON.stringify(id)}`,
      resolved === null ? "no path resolved" : `RESOLVED TO ${resolved}`);
  }

  // A well-formed ID that simply is not there is a different, honest failure.
  const ghost = store.updateRecords("team", "hide", [{ id: "no-such-person", rev: "x" }]);
  check(ghost.error && ghost.error.code === "unknown_record",
    "a well-formed but unknown record ID is refused separately", "unknown_record");
}

/* -- 3. request shape ------------------------------------------------------- */

section("3. The request carries operations, never content");
{
  const id = FIXTURE_PREFIX + "shape";
  teamFixture(id);
  const item = itemFor("team", id);

  for (const op of ["delete", "publish", "", null, "HIDE", "hide;rm", 1, {}]) {
    const result = store.updateRecords("team", op, [item]);
    check(result.error && result.error.code === "unknown_operation",
      `an unsupported operation is refused: ${JSON.stringify(op)}`, "refused");
  }

  /*
    There is no route that takes YAML, a file path or a field name from the
    browser, so a request cannot ask for an arbitrary change. Extra keys on the
    request are simply not read.
  */
  const smuggled = store.updateRecords("team", "hide", [Object.assign({}, item, {
    file: "package.json",
    path: "../../package.json",
    yaml: "published: false\nname: pwned\n",
    fields: { name: "pwned" },
  })]);
  check(!smuggled.error, "extra keys on an item are ignored, not honoured", "ignored");
  const after = yaml.load(fs.readFileSync(fixturePath("team", id), "utf8"));
  check(after.name === "Test Fixture Person" && after.published === false,
    "only `published` changed; smuggled content was not applied", "name unchanged");

  check(store.updateRecords("team", "hide", []).error.code === "empty_selection",
    "an empty selection is refused", "empty_selection");
  check(store.updateRecords("team", "hide", "everything").error.code === "empty_selection",
    "a non-array selection is refused", "empty_selection");

  const twice = store.updateRecords("team", "hide", [item, item]);
  check(twice.error && twice.error.code === "duplicate_id",
    "the same record listed twice is refused as ambiguous", "duplicate_id");

  cleanup();
}

/* -- 4. hide and show ------------------------------------------------------- */

section("4. Hide and show, and nothing else");
{
  const id = FIXTURE_PREFIX + "visible";
  eventFixture(id, { published: true, showInListing: true });
  const before = fs.readFileSync(fixturePath("standard-events", id), "utf8");

  const hidden = store.updateRecords("standard-events", "hide",
    [itemFor("standard-events", id)]);
  check(!hidden.error && hidden.changed.length === 1, "hide changes the record", "1 changed");

  const afterHide = fs.readFileSync(fixturePath("standard-events", id), "utf8");
  const parsedHide = yaml.load(afterHide);
  check(parsedHide.published === false, "published became false", "false");
  for (const field of ["show_in_listing", "show_on_homepage", "show_in_archive", "flagship"]) {
    check(parsedHide[field] === yaml.load(before)[field],
      `hide left ${field} exactly as it was`, String(parsedHide[field]));
  }
  check(afterHide.split("\n").length === before.split("\n").length,
    "hide changed one line and no others",
    afterHide.split("\n").length + " lines");
  const diff = before.split("\n").filter((line, i) => line !== afterHide.split("\n")[i]);
  check(diff.length === 1 && /^published:/.test(diff[0]),
    "the only line that differs is the visibility line", diff.join(" | "));

  // Idempotent: hiding what is already hidden is not an error and writes nothing.
  const again = store.updateRecords("standard-events", "hide",
    [itemFor("standard-events", id)]);
  check(!again.error && again.changed.length === 0,
    "hiding an already-hidden record is accepted and writes nothing", "0 changed");

  const shown = store.updateRecords("standard-events", "show",
    [itemFor("standard-events", id)]);
  check(!shown.error, "show restores the record", "1 changed");
  check(fs.readFileSync(fixturePath("standard-events", id), "utf8") === before,
    "the file is byte-identical to before it was hidden", "round-trip exact");

  cleanup();
}

/* -- 5. mixed selections ---------------------------------------------------- */

section("5. A mixed selection is ordinary, not an error");
{
  const a = FIXTURE_PREFIX + "mixed-a";
  const b = FIXTURE_PREFIX + "mixed-b";
  teamFixture(a, { published: true });
  teamFixture(b, { published: false });

  const hide = store.updateRecords("team", "hide",
    [itemFor("team", a), itemFor("team", b)]);
  check(!hide.error && hide.changed.length === 1,
    "hiding one visible and one hidden record succeeds, writing only the one that moved",
    "1 changed of 2 selected");
  check(yaml.load(fs.readFileSync(fixturePath("team", a), "utf8")).published === false &&
    yaml.load(fs.readFileSync(fixturePath("team", b), "utf8")).published === false,
  "both are hidden afterwards", "both false");

  const show = store.updateRecords("team", "show",
    [itemFor("team", a), itemFor("team", b)]);
  check(!show.error && show.changed.length === 2, "showing both succeeds", "2 changed");
  check(yaml.load(fs.readFileSync(fixturePath("team", a), "utf8")).published === true &&
    yaml.load(fs.readFileSync(fixturePath("team", b), "utf8")).published === true,
  "both are visible afterwards", "both true");

  cleanup();
}

/* -- 6. the future-year guard ----------------------------------------------- */

section("6. A future academic year publishes like any other");
{
  /*
    THIS USED TO BE A REFUSAL, AND IT TOOK THE WHOLE SELECTION WITH IT.

    The events listing showed a single season, so publishing an event belonging
    to a later year made it disappear from the site and broke the build. Bulk
    manage refused the operation outright rather than leave that trap armed.

    Every academic year is now its own section on the public pages. A 2026/27
    event lands in a collapsed 2026/27 group — visible, correctly placed, and
    not promoted over the season that is running. Which year is CURRENT still
    comes from Site settings alone, so a record arriving early changes nothing
    about which section opens.
  */
  const current = store.readCurrentAcademicYear();
  check(current === "2025/26", "the current academic year is unchanged", current);

  const now = FIXTURE_PREFIX + "this-year";
  const later = FIXTURE_PREFIX + "next-year";
  eventFixture(now, { published: false, year: "2025/26" });
  eventFixture(later, { published: false, year: "2026/27" });

  const both = store.updateRecords("standard-events", "show",
    [itemFor("standard-events", now), itemFor("standard-events", later)]);
  check(!both.error, "a selection containing a future event is accepted", "no error");
  check(yaml.load(fs.readFileSync(fixturePath("standard-events", now), "utf8")).published === true,
    "the current-year event is published", "published");
  check(yaml.load(fs.readFileSync(fixturePath("standard-events", later), "utf8")).published === true,
    "…and so is the future one", "published");

  const alone = store.updateRecords("standard-events", "hide",
    [itemFor("standard-events", later)]);
  check(!alone.error, "hiding a future event is allowed too", "no error");
  check(yaml.load(fs.readFileSync(fixturePath("standard-events", later), "utf8")).published === false,
    "…and it is hidden", "hidden");

  /*
    The helper still REPORTS a future year — it is a useful thing to be able to
    say — it simply no longer refuses anything on the strength of it.
  */
  const helper = require("../src/_data/academicYear.js");
  const notice = helper.futureYear(
    { academic_year: "2026/27", published: true }, "2025/26");
  check(notice !== null && notice.eventYear === "2026/27",
    "the shared helper still identifies a future year", "reported, not refused");
  check(helper.futureYear({ academic_year: "2025/26" }, "2025/26") === null,
    "…and says nothing about the current one", "null");

  cleanup();
}

/* -- 7. stale edits --------------------------------------------------------- */

section("7. A record edited since the list loaded blocks everything");
{
  const fresh = FIXTURE_PREFIX + "fresh";
  const stale = FIXTURE_PREFIX + "stale";
  teamFixture(fresh);
  teamFixture(stale);

  // What the screen saw when it loaded.
  const items = [itemFor("team", fresh), itemFor("team", stale)];

  // Somebody saves that record in the entry editor, in another tab.
  fs.writeFileSync(fixturePath("team", stale),
    fs.readFileSync(fixturePath("team", stale), "utf8")
      .replace("Test Fixture Person", "Renamed In Another Tab"), "utf8");

  const freshBefore = hashOf(fixturePath("team", fresh));
  const staleBefore = hashOf(fixturePath("team", stale));

  const update = store.updateRecords("team", "hide", items);
  check(update.error && update.error.code === "stale",
    "the bulk operation is refused", "stale");
  check(update.error.records.length === 1 && update.error.records[0].id === stale,
    "the stale record is named", update.error.records[0].title);
  check(hashOf(fixturePath("team", fresh)) === freshBefore,
    "the other selected record is untouched", "byte-identical");
  check(hashOf(fixturePath("team", stale)) === staleBefore,
    "the stale record is untouched", "byte-identical");

  const message = api.explain(update.error);
  check(/has been edited since this list was loaded/.test(message.title) &&
    /Refresh/.test(message.detail),
  "the editor is told to refresh, in words", message.title);

  // Deleting a stale record is refused for the same reason, before any unlink.
  const remove = store.deleteRecords("team", items);
  check(remove.error && remove.error.code === "stale",
    "deletion is refused on a stale revision too", "stale");
  check(fs.existsSync(fixturePath("team", fresh)) && fs.existsSync(fixturePath("team", stale)),
    "neither file was deleted", "both present");

  // Reloading makes it work.
  const retry = store.updateRecords("team", "hide",
    [itemFor("team", fresh), itemFor("team", stale)]);
  check(!retry.error && retry.changed.length === 2,
    "after a refresh the same operation succeeds", "2 changed");

  cleanup();
}

/* -- 8. deletion ------------------------------------------------------------ */

section("8. Deletion removes the record and nothing else");
{
  const id = FIXTURE_PREFIX + "deletable";
  teamFixture(id);
  const asset = path.join(ROOT, "assets", "team", `${FIXTURE_PREFIX}photo.jpg`);
  fs.writeFileSync(asset, "not a real photograph, but a real file");
  created.push(asset);

  const result = store.deleteRecords("team", [itemFor("team", id)]);
  check(!result.error && result.deleted.length === 1, "the record is deleted", "1 deleted");
  check(!fs.existsSync(fixturePath("team", id)), "the file is gone", "absent");
  check(!fs.existsSync(fixturePath("team", id) + ".bulk-tmp"),
    "no temporary file is left behind", "clean");

  /*
    MEDIA IS NEVER DELETED. The same photograph can belong to several records —
    a team portrait also appears in the Business Forum's own people list — so
    deleting a record must not take a file another record still uses.
  */
  check(fs.existsSync(asset), "the photograph the record used is still there", "kept");

  cleanup();
  check(!fs.existsSync(asset), "…and the test removes its own asset afterwards", "cleaned");
}

/* -- 9. referential safety -------------------------------------------------- */

section("9. An event still referenced cannot be deleted");
{
  const event = FIXTURE_PREFIX + "referenced";
  const free = FIXTURE_PREFIX + "unreferenced";
  const viaLink = FIXTURE_PREFIX + "ann-link";
  const viaBoth = FIXTURE_PREFIX + "ann-both";

  eventFixture(event);
  eventFixture(free);
  announcementFixture(viaLink, { linkEvent: event });
  announcementFixture(viaBoth, { linkEvent: event, registrationEvent: event });

  const eventBefore = hashOf(fixturePath("standard-events", event));
  const freeBefore = hashOf(fixturePath("standard-events", free));

  const blocked = store.deleteRecords("standard-events",
    [itemFor("standard-events", free), itemFor("standard-events", event)]);
  check(blocked.error && blocked.error.code === "has_dependents",
    "the deletion is refused", "has_dependents");

  const blockedRecord = blocked.error.records[0];
  check(blocked.error.records.length === 1 && blockedRecord.id === event,
    "the blocking event is named", blockedRecord.title);
  check(blockedRecord.dependents.length === 2,
    "both dependent announcements are listed", "2 announcements");

  const bothWays = blockedRecord.dependents.find((d) => d.id === viaBoth);
  check(bothWays && bothWays.ways.length === 2 &&
    bothWays.ways.includes("the details link") &&
    bothWays.ways.includes("the registration"),
  "an announcement depending twice is listed once, with both reasons",
  bothWays ? bothWays.ways.join(" and ") : "not found");

  /* ATOMIC: the deletable event in the same selection survives. */
  check(hashOf(fixturePath("standard-events", free)) === freeBefore,
    "the unreferenced event in the same selection is NOT deleted", "still there");
  check(hashOf(fixturePath("standard-events", event)) === eventBefore,
    "the referenced event is still there", "still there");

  /*
    A REGISTRATION REFERENCE COUNTS EVEN WITH NO SIGN-UPS.

    Since Phase 17C.5A.3 an announcement may point at an event whose
    registration state is `none` — the ordinary case when the announcement is
    written before sign-ups open. The event renders no panel, but the reference
    is real and deleting the event would break it.
  */
  fs.unlinkSync(fixturePath("announcements", viaLink));
  fs.writeFileSync(fixturePath("announcements", viaBoth),
    fs.readFileSync(fixturePath("announcements", viaBoth), "utf8")
      .replace(/link:\n  type: event\n  event_slug: .*\n/, "link:\n  type: none\n"), "utf8");
  const quiet = yaml.load(fs.readFileSync(fixturePath("standard-events", event), "utf8"));
  check(quiet.registration.state === "none",
    "the referenced event has no registration of its own", "state none");
  const stillBlocked = store.deleteRecords("standard-events",
    [itemFor("standard-events", event)]);
  check(stillBlocked.error && stillBlocked.error.code === "has_dependents",
    "a registration reference alone still blocks the deletion", "blocked");
  check(stillBlocked.error.records[0].dependents[0].ways.join() === "the registration",
    "and the reason given is the registration", "the registration");

  // Remove the last reference and the deletion goes through.
  fs.writeFileSync(fixturePath("announcements", viaBoth),
    fs.readFileSync(fixturePath("announcements", viaBoth), "utf8")
      .replace(/registration:\n  source: event\n  event_slug: .*\n/,
        "registration:\n  state: none\n  url: null\n  opens_on: null\n  closes_on: null\n"),
    "utf8");
  const allowed = store.deleteRecords("standard-events",
    [itemFor("standard-events", event), itemFor("standard-events", free)]);
  check(!allowed.error && allowed.deleted.length === 2,
    "once nothing references it, both events delete", "2 deleted");
  check(fs.existsSync(fixturePath("announcements", viaBoth)),
    "the announcement that referenced it is untouched", "still there");

  cleanup();
}

section("10. Real records: every standard event is currently referenced");
{
  /*
    Not a contrived state — every one of the four standard events is the subject
    of at least one announcement, so none of them can be deleted today. Worth
    asserting: it is the guard's most likely real-world outcome, and a change
    that quietly broke dependency discovery would otherwise look like success.
  */
  const events = store.listRecords("standard-events").records.map((r) => r.id);
  const dependents = store.dependentsOfEvents(events);
  check(dependents.size === events.length,
    "all four standard events have dependent announcements",
    `${dependents.size} of ${events.length}`);

  const attempt = store.deleteRecords("standard-events",
    events.slice(0, 1).map((id) => itemFor("standard-events", id)));
  check(attempt.error && attempt.error.code === "has_dependents",
    "so deleting a real event is refused", events[0]);

  // Team and announcement IDs are referenced by nothing canonical.
  check(store.dependentsOfEvents(["nikodem-rajpold"]).size === 0,
    "a team member's ID is not an event reference", "no false positives");
}

/* -- 11. the API layer's wording -------------------------------------------- */

section("11. Failures are explained in words, not codes");
{
  const cases = [
    ["unknown_collection", {}],
    ["empty_selection", {}],
    ["invalid_id", { id: "../x" }],
    ["duplicate_id", { id: "x" }],
    ["unknown_operation", { operation: "nope" }],
    ["unknown_record", { ids: ["ghost"] }],
    ["stale", { records: [{ id: "a", title: "Icebreaker" }] }],
    ["future_year", { records: [{ id: "a", title: "Future Event", recordYear: "2026/27", currentYear: "2025/26" }] }],
    ["has_dependents", { records: [] }],
    ["write_failed", { detail: "EACCES" }],
  ];
  for (const [code, extra] of cases) {
    const message = api.explain(Object.assign({ code }, extra));
    check(typeof message.title === "string" && message.title.length > 0 &&
      !/[A-Za-z]_[a-z]/.test(message.title),
    `${code} produces a human sentence`, message.title.slice(0, 68));
  }

  const stale = api.explain({ code: "stale",
    records: [{ id: "a", title: "Icebreaker" }] });
  check(/"Icebreaker"/.test(stale.title),
    "a stale record is identified by its title, not its ID", stale.title);

  const future = api.explain({ code: "future_year",
    records: [{ id: "a", title: "Future Event", recordYear: "2026/27", currentYear: "2025/26" }] });
  check(/Nothing was changed/.test(future.title) && /2026\/27/.test(future.detail) &&
    /2025\/26/.test(future.detail),
  "a blocked show says nothing changed, and names both years", future.detail);

  check(api.MAX_BODY_BYTES <= 1024 * 1024,
    "the request body is capped", api.MAX_BODY_BYTES + " bytes");
}

/* -- 12. no shell ----------------------------------------------------------- */

section("12. There is no shell in this feature");
{
  for (const file of ["bulk/api.js", "bulk/local-store.js", "bulk/collections.js"]) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    check(!/child_process|execSync|spawnSync|\bexec\(/.test(source),
      `${file} runs no commands`, "no child_process");
    check(!/eval\(|new Function/.test(source),
      `${file} evaluates nothing`, "no eval");
  }
}

/* -- the real records, afterwards ------------------------------------------- */

section("13. No real record was touched by this run");
{
  const after = snapshotReal();
  const beforeKeys = Object.keys(realBefore);
  const changed = beforeKeys.filter((file) => realBefore[file] !== after[file]);
  const added = Object.keys(after).filter((file) => !(file in realBefore));
  check(changed.length === 0, "every real record is byte-identical",
    changed.length ? changed.map((f) => path.basename(f)).join(", ") : `${beforeKeys.length} files`);
  check(added.length === 0, "no fixture was left behind",
    added.length ? added.map((f) => path.basename(f)).join(", ") : "none");
}

cleanup();

console.log("\n" + "=".repeat(78));
if (problems.length) {
  console.log(`  FAIL — ${problems.length} of ${checks} bulk assertions:`);
  for (const p of problems) console.log(`    - ${p}`);
  console.log("=".repeat(78) + "\n");
  process.exit(1);
}
console.log(`  PASS — ${checks} bulk assertions, 0 problems`);
console.log("=".repeat(78) + "\n");
