#!/usr/bin/env node
/**
 * test-event-listing-groups.js — the academic-year grouping helper, exercised
 * with SYNTHETIC records.
 *
 * There is exactly one real academic year today, so the archive path cannot be
 * covered by the live dataset. The alternative — inventing fake public events
 * under content/events/ so an archive appears — would put fiction on the website
 * to test a code path. These records exist only in this file, are never written
 * to disk and are never rendered.
 *
 * Run:  node scripts/test-event-listing-groups.js
 * Exit: 0 when every case passes, 1 otherwise.
 */

"use strict";

const { group, years, parseAcademicYear } = require("../src/_data/eventListing.js");

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (e) {
    failures.push({ name, message: e.message });
    console.log(`  FAIL  ${name}\n          ${e.message}`);
  }
}

function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}\n          expected: ${b}\n          actual:   ${a}`);
}

function throws(fn, pattern, what) {
  let message = null;
  try { fn(); } catch (e) { message = e.message; }
  if (message === null) throw new Error(`${what}: expected a throw, got none`);
  if (!pattern.test(message)) {
    throw new Error(`${what}: message did not match ${pattern}\n          got: ${message}`);
  }
}

/**
 * A minimal synthetic record.
 *
 * The third argument still reads as a POSITION, but position is no longer a
 * stored field: Phase 17C.5A made the listing sort by `start_date`, newest
 * first, so an editor never maintains a number again. The position is turned
 * into a descending date here, which means every expectation below — all of them
 * written as slug sequences against the old hand-kept numbers — now proves that
 * date ordering reproduces exactly the sequence the numbers produced.
 *
 * Position 1 is the newest, so it gets the latest date.
 */
const ev = (slug, academicYear, position, extra = {}) => ({
  slug,
  academic_year: academicYear,
  // 1 -> 2026-05-01, 2 -> 2026-04-01, ... — descending, and a real calendar day.
  start_date: typeof position === "number" && position >= 1 && position <= 11
    ? `2026-${String(12 - position).padStart(2, "0")}-01`
    : position,
  published: true,
  show_in_listing: true,
  event_family: "standard",
  ...extra,
});

const slugs = (list) => list.map((e) => e.slug);

const FIVE_2025 = [
  ev("business-forum", "2025/26", 1, { event_family: "polish-business-forum", flagship: true }),
  ev("sikorski-debate", "2025/26", 2),
  ev("christmas-dinner", "2025/26", 3),
  ev("youth-congress", "2025/26", 4),
  ev("icebreaker", "2025/26", 5),
];

console.log("\n" + "=".repeat(70));
console.log("  ACADEMIC-YEAR GROUPING — synthetic records (never rendered)");
console.log("=".repeat(70) + "\n");

/* 1 */
test("current 2025/26 with five events and no previous years", () => {
  const r = group(FIVE_2025, "2025/26");
  eq(r.current.academicYear, "2025/26", "current year");
  eq(slugs(r.current.events),
    ["business-forum", "sikorski-debate", "christmas-dinner", "youth-congress", "icebreaker"],
    "current events in order");
  eq(r.previous, [], "no archive while only one year exists");
});

/* 2 */
test("current 2026/27 with two current events and five archived 2025/26", () => {
  const r = group([
    ...FIVE_2025,
    ev("freshers-mixer", "2026/27", 1),
    ev("winter-gala", "2026/27", 2),
  ], "2026/27");
  eq(r.current.academicYear, "2026/27", "current year");
  eq(slugs(r.current.events), ["freshers-mixer", "winter-gala"], "current events");
  eq(r.previous.length, 1, "one archived year");
  eq(r.previous[0].academicYear, "2025/26", "archived year label");
  eq(slugs(r.previous[0].events),
    ["business-forum", "sikorski-debate", "christmas-dinner", "youth-congress", "icebreaker"],
    "archived events keep their own order");
});

/* 3 */
test("current 2026/27 with ZERO current events still reports the current year", () => {
  const r = group(FIVE_2025, "2026/27");
  eq(r.current.academicYear, "2026/27", "current year is the configured one, not the newest with events");
  eq(r.current.events, [], "current year is empty");
  eq(r.previous.length, 1, "previous year still shown");
  eq(slugs(r.previous[0].events).length, 5, "all five archived");
});

/* 4 */
test("two previous years sort 2025/26 before 2024/25", () => {
  const r = group([
    ...FIVE_2025,
    ev("old-social", "2024/25", 1),
    ev("old-dinner", "2024/25", 2),
  ], "2026/27");
  eq(r.previous.map((p) => p.academicYear), ["2025/26", "2024/25"], "archive newest-first");
});

/* 5 */
test("the same date in different years stays in its own year", () => {
  const r = group([
    ev("current-first", "2026/27", 1),
    ev("older-first", "2025/26", 1),
  ], "2026/27");
  eq(slugs(r.current.events), ["current-first"], "current");
  eq(slugs(r.previous[0].events), ["older-first"], "previous");
});

/* 6 */
test("two events on the SAME DAY are both kept, ordered by slug", () => {
  // The hand-kept number this replaced could collide, and a collision was a
  // fatal build error because the sequence was then undefined. Two events on one
  // day is an ordinary thing to happen, so it must simply work.
  const r = group([
    ev("b-later-slug", "2025/26", 3),
    ev("a-earlier-slug", "2025/26", 3),
  ], "2025/26");
  eq(slugs(r.current.events), ["a-earlier-slug", "b-later-slug"], "stable, slug tie-break");
});

/* 7 */
test("invalid academic-year formats are rejected", () => {
  throws(() => group([ev("a", "2025/27", 1)], "2025/26"), /invalid academic_year/, "2025/27");
  throws(() => group([ev("a", "2025-26", 1)], "2025/26"), /invalid academic_year/, "2025-26");
  throws(() => group([ev("a", "2025/2026", 1)], "2025/26"), /invalid academic_year/, "2025/2026");
  throws(() => group([ev("a", "2025/25", 1)], "2025/26"), /invalid academic_year/, "2025/25");
  throws(() => group([], "2025/27"), /invalid current academic year/, "invalid current setting");
});

/* 8 */
/*
  A FUTURE YEAR IS A YEAR, NOT AN ERROR.

  This used to throw. The listing showed one season, so an event belonging to a
  later year had nowhere to go, and failing the build was preferable to letting
  it disappear.

  The page now renders one section per academic year, so it gets a section of
  its own: above the current one because it is newer, and collapsed because
  `isCurrent` is decided by the setting alone. Publishing next year's ball early
  is a normal thing to do and no longer changes what the site considers current.
*/
test("a published event in a FUTURE year gets its own year, ahead of the current one", () => {
  const grouped = years([...FIVE_2025, ev("next-year-ball", "2026/27", 1)], "2025/26");

  eq(grouped.map((y) => y.academicYear).join(","), "2026/27,2025/26", "newest year first");
  eq(grouped[0].isCurrent, false, "the future year is NOT current");
  eq(grouped[1].isCurrent, true, "the configured year is");
  eq(slugs(grouped[0].records).join(","), "next-year-ball", "the future event is in its own year");
  eq(grouped[1].records.length, 5, "and the current year still has its five");
});

/* 8b */
test("moving the setting forward opens the future year and closes the old one", () => {
  const records = [...FIVE_2025, ev("next-year-ball", "2026/27", 1)];
  const after = years(records, "2026/27");

  eq(after.map((y) => y.academicYear).join(","), "2026/27,2025/26", "order is unchanged");
  eq(after[0].isCurrent, true, "the new year is now current");
  eq(after[1].isCurrent, false, "and last year is not");
  eq(slugs(after[1].records).length, 5, "no record moved between years");
});

/* 9 */
test("unpublished events are excluded", () => {
  const r = group([...FIVE_2025, ev("draft", "2025/26", 6, { published: false })], "2025/26");
  eq(slugs(r.current.events).includes("draft"), false, "draft excluded");
  eq(r.current.events.length, 5, "five remain");
});

/* 10 */
test("show_in_listing: false events are excluded", () => {
  const r = group([...FIVE_2025, ev("hidden", "2025/26", 7, { show_in_listing: false })], "2025/26");
  eq(slugs(r.current.events).includes("hidden"), false, "hidden excluded");
  eq(r.current.events.length, 5, "five remain");
});

/* 11 */
test("shuffled input produces identical output", () => {
  const shuffled = [FIVE_2025[3], FIVE_2025[0], FIVE_2025[4], FIVE_2025[2], FIVE_2025[1]];
  eq(JSON.stringify(group(shuffled, "2025/26")), JSON.stringify(group(FIVE_2025, "2025/26")),
    "output independent of input order");
});

/* extras — properties the listing depends on */
test("input records are never mutated", () => {
  const input = FIVE_2025.map((e) => ({ ...e }));
  const snapshot = JSON.stringify(input);
  group(input, "2025/26");
  eq(JSON.stringify(input), snapshot, "input unchanged");
});

test("event family does not affect grouping or order", () => {
  const r = group([
    ev("standard-one", "2025/26", 1),
    ev("forum", "2025/26", 2, { event_family: "polish-business-forum", flagship: true }),
  ], "2025/26");
  eq(slugs(r.current.events), ["standard-one", "forum"], "order decides, not family");
});

test("a year equal to the current year is current, not previous", () => {
  const r = group([ev("a", "2025/26", 1)], "2025/26");
  eq(r.previous, [], "no archive");
  eq(slugs(r.current.events), ["a"], "counted as current");
});

test("a record without a usable start date is rejected", () => {
  // The position number is no longer stored, so the date is what the sort needs.
  throws(() => group([ev("a", "2025/26", "not-a-date")], "2025/26"),
    /start_date must be a calendar day/, "unparseable date");
  throws(() => group([ev("a", "2025/26", undefined)], "2025/26"),
    /start_date must be a calendar day/, "missing date");
});

test("events sort by date, newest first, regardless of the order given", () => {
  const r = group([
    { slug: "oldest", academic_year: "2025/26", start_date: "2025-10-16",
      published: true, show_in_listing: true, event_family: "standard" },
    { slug: "newest", academic_year: "2025/26", start_date: "2026-02-10",
      published: true, show_in_listing: true, event_family: "standard" },
    { slug: "middle", academic_year: "2025/26", start_date: "2025-12-08",
      published: true, show_in_listing: true, event_family: "standard" },
  ], "2025/26");
  eq(slugs(r.current.events), ["newest", "middle", "oldest"], "newest first");
});

test("parseAcademicYear accepts valid and rejects invalid values", () => {
  eq(parseAcademicYear("2025/26"), 2025, "2025/26");
  eq(parseAcademicYear("2026/27"), 2026, "2026/27");
  eq(parseAcademicYear("2099/00"), 2099, "century rollover");
  eq(parseAcademicYear("2025/27"), null, "2025/27");
  eq(parseAcademicYear("25/26"), null, "short start year");
  eq(parseAcademicYear(""), null, "empty");
  eq(parseAcademicYear(null), null, "null");
});

console.log("\n" + "=".repeat(70));
if (failures.length === 0) {
  console.log(`  PASS — ${passed}/${passed} grouping cases`);
} else {
  console.log(`  FAIL — ${failures.length} of ${passed + failures.length} grouping cases`);
}
console.log("=".repeat(70) + "\n");
process.exit(failures.length === 0 ? 0 : 1);
