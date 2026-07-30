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

const { group, parseAcademicYear } = require("../src/_data/eventListing.js");

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

/** A minimal synthetic record. */
const ev = (slug, academicYear, order, extra = {}) => ({
  slug,
  academic_year: academicYear,
  order,
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
test("order: 1 reused across different years is accepted", () => {
  const r = group([
    ev("current-first", "2026/27", 1),
    ev("older-first", "2025/26", 1),
  ], "2026/27");
  eq(slugs(r.current.events), ["current-first"], "current");
  eq(slugs(r.previous[0].events), ["older-first"], "previous");
});

/* 6 */
test("duplicate order within ONE year is rejected", () => {
  throws(() => group([ev("a", "2025/26", 1), ev("b", "2025/26", 1)], "2025/26"),
    /order 1 used by a and b/, "duplicate order");
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
test("a published event in a FUTURE year fails rather than being archived", () => {
  throws(() => group([...FIVE_2025, ev("next-year-ball", "2026/27", 1)], "2025/26"),
    /next-year-ball: academic_year 2026\/27 is later than the configured current year 2025\/26/,
    "future year");
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

test("non-integer order is rejected", () => {
  throws(() => group([ev("a", "2025/26", "1")], "2025/26"), /order must be an integer/, "string order");
  throws(() => group([ev("a", "2025/26", undefined)], "2025/26"), /order must be an integer/, "missing order");
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
