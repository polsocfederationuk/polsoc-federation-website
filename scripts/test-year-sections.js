#!/usr/bin/env node
/**
 * test-year-sections.js — the multi-year public pages, and the homepage cap.
 *
 * WHAT THIS PINS
 *
 * Events, Team and Announcements each show every academic year they have, one
 * collapsible section per year, newest first, with the configured current year
 * open. Three pages, one behaviour, one helper — and the point of this suite is
 * that they cannot drift apart.
 *
 * The scenarios are the ones that were wrong before: a record belonging to a
 * year that has not started yet, and a current-year setting that moves forward
 * without any content changing. Both used to be impossible; the first was a
 * fatal build error and the second required editing records.
 *
 * Fixtures are in memory. Nothing here writes to content/, so a failed run
 * cannot leave fake committee members on the public site.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

const { groupByAcademicYear } = require(path.join(ROOT, "src/_data/academicYearGroups.js"));
const { group, years } = require(path.join(ROOT, "src/_data/eventListing.js"));

let checks = 0;
const problems = [];
function check(ok, what, detail) {
  checks += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}`);
  if (detail) console.log(`          ${detail}`);
  if (!ok) problems.push(what + (detail ? ` — ${detail}` : ""));
}
const section = (t) => console.log(`\n  ${t}\n  ${"-".repeat(t.length)}`);

/* ------------------------------------------------------------------ fixtures */

const person = (slug, year, extra) => ({
  slug, academic_year: year, published: true, group: "trustees", order: 1, ...extra,
});
const event = (slug, year, date, extra) => ({
  slug, academic_year: year, published: true, show_in_listing: true,
  show_on_homepage: true, start_date: date, ...extra,
});

const MANY_YEARS = [
  person("future-a", "2026/27"),
  person("now-a", "2025/26"),
  person("now-b", "2025/26"),
  person("old-a", "2024/25"),
  person("older-a", "2023/24"),
  person("hidden", "2025/26", { published: false }),
];

/* ============================================================ 1. the helper */

section("1. One group per year, newest first");
{
  const g = groupByAcademicYear(MANY_YEARS, "2025/26", { visible: (r) => r.published === true });

  check(g.map((y) => y.academicYear).join(",") === "2026/27,2025/26,2024/25,2023/24",
    "every year appears once, newest first", g.map((y) => y.academicYear).join(", "));
  check(g.filter((y) => y.isCurrent).length === 1,
    "exactly one year is current", "one");
  check(g.find((y) => y.isCurrent).academicYear === "2025/26",
    "…and it is the configured one", "2025/26");

  const seen = g.flatMap((y) => y.records.map((r) => r.slug));
  check(new Set(seen).size === seen.length, "no record appears in two years", `${seen.length} records`);
  check(!seen.includes("hidden"), "an unpublished record does not leak", "excluded");
  check(seen.length === 5, "…and every visible one is placed", `${seen.length} of 5`);

  check(g[0].label === "2026/27" && g[0].isCurrent === false,
    "a year that has not started yet sorts above the current one, collapsed",
    "2026/27 first, not current");
}

section("2. Moving the setting forward, with no content change");
{
  const before = groupByAcademicYear(MANY_YEARS, "2025/26", { visible: (r) => r.published === true });
  const after = groupByAcademicYear(MANY_YEARS, "2026/27", { visible: (r) => r.published === true });

  check(before.map((y) => y.academicYear).join(",") === after.map((y) => y.academicYear).join(","),
    "the same years, in the same order", after.map((y) => y.academicYear).join(", "));
  check(after.find((y) => y.isCurrent).academicYear === "2026/27",
    "the new year is the one that opens", "2026/27");
  check(before.find((y) => y.isCurrent).academicYear === "2025/26",
    "…and it was not before", "2025/26");

  const same = (a, b) => a.map((y) => y.records.map((r) => r.slug).join("|")).join(",")
    === b.map((y) => y.records.map((r) => r.slug).join("|")).join(",");
  check(same(before, after),
    "no record moved between years — only which section is open changed",
    "content untouched");
}

section("3. A current year with nothing in it still has a section");
{
  const g = groupByAcademicYear([person("old", "2024/25")], "2025/26",
    { visible: (r) => r.published === true });
  const current = g.find((y) => y.isCurrent);
  check(Boolean(current), "the configured year is present", "2025/26");
  check(current.records.length === 0, "…and empty", "0 records");
  check(g[0].academicYear === "2025/26",
    "…and still sorts above the older one", g.map((y) => y.academicYear).join(", "));
}

section("4. A malformed year is still an error");
{
  let threw = null;
  try {
    groupByAcademicYear([person("bad", "2025/2026")], "2025/26", {});
  } catch (err) { threw = err.message; }
  check(threw !== null && /invalid academic_year/.test(threw),
    "an unparseable academic year is refused", threw);

  let threwCurrent = null;
  try { groupByAcademicYear([], "not-a-year", {}); } catch (err) { threwCurrent = err.message; }
  check(threwCurrent !== null && /invalid current academic year/.test(threwCurrent),
    "so is an unparseable current setting", threwCurrent);
}

/* ================================================ 5. events, through its own */

section("5. The events listing groups the same way");
{
  const evs = [
    event("future", "2026/27", "2026-11-20"),
    event("late", "2025/26", "2026-05-04"),
    event("early", "2025/26", "2025-10-01"),
    event("old", "2024/25", "2024-12-01"),
    event("draft", "2025/26", "2025-11-01", { published: false }),
    event("unlisted", "2025/26", "2025-11-02", { show_in_listing: false }),
  ];
  const y = years(evs, "2025/26");

  check(y.map((x) => x.academicYear).join(",") === "2026/27,2025/26,2024/25",
    "one section per year, newest first", y.map((x) => x.academicYear).join(", "));
  check(y[0].isCurrent === false && y[1].isCurrent === true,
    "the future year is collapsed and the configured one is open", "as configured");
  check(y[1].records.map((e) => e.slug).join(",") === "late,early",
    "inside a year, newest event first", y[1].records.map((e) => e.slug).join(", "));

  const shown = y.flatMap((x) => x.records.map((e) => e.slug));
  check(!shown.includes("draft") && !shown.includes("unlisted"),
    "unpublished and unlisted events do not leak", "excluded");

  /* The homepage path is untouched by any of this. */
  const g = group(evs, "2025/26");
  check(g.current.events.length === 2, "group() still reports the current season alone",
    `${g.current.events.length} events`);
}

/* ======================================================= 6. the homepage cap */

/* ------------------------------------------------------------------------- */
/*
  THE ANNOUNCEMENT GRID SURVIVES BEING SPLIT INTO YEARS.

  #annGrid ships as `.ann-grid` — three equal columns — because without year
  sections the cards are its direct children. Adding year sections made each
  <details> a grid ITEM one column wide, whose own three-column grid split that
  column again: cards rendered at 104px instead of 361px on a 1280px viewport,
  about a ninth of the page.

  Asserting "year sections exist" would have passed throughout. So this runs the
  real renderer against a DOM shim and asserts the LAYOUT CONTRACT: which
  element is the grid, what each card's parent is, and that no grid ever nests
  inside another.
*/
section("7. Announcement cards keep their grid");
{
  /* Enough DOM for the renderer, and enough to inspect what it built. */
  const makeNode = (tag) => {
    const node = {
      tagName: String(tag).toUpperCase(),
      children: [],
      parentElement: null,
      _classes: new Set(),
      style: {},
      dataset: {},
      attributes: {},
      textContent: "",
      open: false,
      get className() { return [...this._classes].join(" "); },
      set className(v) {
        this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
      },
      classList: {
        add: (...c) => c.forEach((x) => node._classes.add(x)),
        remove: (...c) => c.forEach((x) => node._classes.delete(x)),
        contains: (c) => node._classes.has(c),
        toggle: (c) => (node._classes.has(c) ? node._classes.delete(c) : node._classes.add(c)),
      },
      appendChild(child) {
        child.parentElement = node;
        node.children.push(child);
        return child;
      },
      setAttribute(k, v) { node.attributes[k] = String(v); },
      getAttribute(k) { return k in node.attributes ? node.attributes[k] : null; },
      removeAttribute(k) { delete node.attributes[k]; },
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      closest() { return null; },
      focus() {},
      remove() {},
    };
    return node;
  };

  /** Every node under `root`, in document order. */
  const walk = (root, out = []) => {
    for (const child of root.children) { out.push(child); walk(child, out); }
    return out;
  };
  const withClass = (root, cls) => walk(root).filter((n) => n._classes.has(cls));

  const container = makeNode("div");
  container.className = "ann-grid";
  container.attributes.id = "annGrid";

  const byId = { annGrid: container };
  const stub = () => makeNode("div");
  const document_ = {
    getElementById: (id) => byId[id] || stub(),
    createElement: makeNode,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    body: makeNode("body"),
    readyState: "complete",
  };

  const ANNOUNCEMENTS = [
    { slug: "a", title: "A", academic_year: "2025/26" },
    { slug: "b", title: "B", academic_year: "2025/26" },
    { slug: "c", title: "C", academic_year: "2024/25" },
  ];
  const ANNOUNCEMENT_YEARS = [
    { academicYear: "2025/26", label: "2025/26", isCurrent: true,
      items: [ANNOUNCEMENTS[0], ANNOUNCEMENTS[1]] },
    { academicYear: "2024/25", label: "2024/25", isCurrent: false,
      items: [ANNOUNCEMENTS[2]] },
  ];

  const source = fs.readFileSync(
    path.join(ROOT, "src/js/announcements-page.js"), "utf8");

  let threw = null;
  try {
    /* eslint-disable-next-line no-new-func */
    new Function("document", "window", "ANNOUNCEMENTS", "ANNOUNCEMENT_YEARS", source)(
      document_,
      { addEventListener() {}, location: { hash: "" }, matchMedia: () => ({ matches: false }) },
      ANNOUNCEMENTS,
      ANNOUNCEMENT_YEARS,
    );
  } catch (err) {
    threw = err;
  }
  check(!threw, "the renderer runs", threw ? threw.message : "no error");

  const years = container.children.filter((n) => n.tagName === "DETAILS");
  check(years.length === 2, "one year section per year", `${years.length} sections`);

  /*
    THE FIX ITSELF. The container must stop being the three-column grid the
    moment it holds year sections, or every section becomes one column wide.
  */
  check(!container._classes.has("ann-grid"),
    "the container is no longer the grid once years are rendered",
    container.className || "(no classes)");
  check(container._classes.has("ann-years"),
    "…and says what it is instead", container.className);

  /* Each year owns exactly one grid, and the cards are ITS children. */
  for (const year of years) {
    const grids = withClass(year, "ann-grid");
    check(grids.length === 1,
      "each year section contains exactly one grid", `${grids.length} grid(s)`);
    const cards = withClass(year, "ann-card");
    check(cards.length > 0 && cards.every((c) => c.parentElement === grids[0]),
      "every card is a direct child of that grid",
      `${cards.length} card(s)`);
  }

  /* The squash, stated directly: a grid inside a grid is the defect. */
  const nested = withClass(container, "ann-grid")
    .filter((g) => {
      let up = g.parentElement;
      while (up) { if (up._classes && up._classes.has("ann-grid")) return true; up = up.parentElement; }
      return false;
    });
  check(nested.length === 0,
    "no grid is nested inside another grid",
    nested.length ? `${nested.length} nested — cards would be squashed` : "none");

  /* Every announcement still appears, exactly once. */
  const allCards = withClass(container, "ann-card");
  check(allCards.length === 3, "every announcement is rendered", `${allCards.length}`);

  /* Open state follows the configured current year, not the content. */
  check(years[0].open === true && years[1].open === false,
    "the current year is open and the others are not",
    `${years.map((y) => y.open).join(", ")}`);

  /* And the flat fallback keeps the container AS the grid. */
  const flatContainer = makeNode("div");
  flatContainer.className = "ann-grid";
  flatContainer.attributes.id = "annGrid";
  try {
    /* eslint-disable-next-line no-new-func */
    new Function("document", "window", "ANNOUNCEMENTS", "ANNOUNCEMENT_YEARS", source)(
      { ...document_, getElementById: (id) => (id === "annGrid" ? flatContainer : stub()) },
      { addEventListener() {}, location: { hash: "" }, matchMedia: () => ({ matches: false }) },
      ANNOUNCEMENTS,
      [],
    );
  } catch (err) { /* reported by the assertion below */ }
  check(flatContainer._classes.has("ann-grid"),
    "a build with no year data still renders the flat grid",
    flatContainer.className);
}

/* ------------------------------------------------------------------------- */
/*
  A YEAR NOBODY HAS BEEN ADDED TO YET IS NOT A DELETED TEAM.

  Moving Site settings to 2026/27 rendered the new year with every group
  heading present and "0 people" under each, above a collapsed 2025/26. It read
  as though the committee had been wiped — which is how it was reported from
  production.

  The records were never lost: the template already grouped all of them. What
  was wrong was what an empty year LOOKS like.
*/
section("8. An empty current year does not look like a deleted team");
{
  const people = [
    person("a", "2025/26", { group: "trustees" }),
    person("b", "2025/26", { group: "events" }),
    person("c", "2024/25", { group: "trustees" }),
  ];

  for (const current of ["2025/26", "2026/27"]) {
    const groups = groupByAcademicYear(people, current,
      { visible: (r) => r.published === true });
    const present = groups.flatMap((g) => g.records.map((r) => r.slug)).sort();
    check(present.join(",") === "a,b,c",
      `current ${current}: every person is still on the page`, present.join(", "));
    const open = groups.filter((g) => g.isCurrent).map((g) => g.academicYear);
    check(open.length === 1 && open[0] === current,
      `current ${current}: exactly that year is open`, open.join(", "));
    const dupes = present.filter((x, i) => present.indexOf(x) !== i);
    check(dupes.length === 0, `current ${current}: nobody is duplicated`, "unique");
  }

  /* The set of people does not depend on the setting — that is the whole bug. */
  const at2025 = groupByAcademicYear(people, "2025/26", { visible: (r) => r.published })
    .flatMap((g) => g.records.map((r) => r.slug)).sort().join(",");
  const at2026 = groupByAcademicYear(people, "2026/27", { visible: (r) => r.published })
    .flatMap((g) => g.records.map((r) => r.slug)).sort().join(",");
  check(at2025 === at2026,
    "changing the current year changes nobody's presence", `${at2025} == ${at2026}`);

  /* The template must not render group headings for a year with no members. */
  const team = fs.readFileSync(path.join(ROOT, "src/team.njk"), "utf8");
  check(/yearMembers\.length/.test(team),
    "the team page asks whether a year has anybody before rendering groups",
    "guarded");
  check(/groupMembers\.length/.test(team),
    "…and skips a group with nobody in it", "guarded");
  check(/t\.team\.emptyYear/.test(team),
    "…and says so in words instead", "empty-year line");
  const ui = require(path.join(ROOT, "src/_data/ui.json"));
  check(Boolean(ui.en.team.emptyYear) && Boolean(ui.pl.team.emptyYear),
    "the empty-year line exists in both languages",
    `EN + PL`);
}

section("6. The homepage shows at most five events");
{
  /*
    The filter is defined inside eleventy.config.js, which is a plugin function
    rather than a module of exports. Rather than reach into it, the same rule is
    applied here — filter to show_on_homepage, then take five — and the config
    is checked separately for the constant so the two cannot silently disagree.
  */
  const fs = require("fs");
  const config = fs.readFileSync(path.join(ROOT, "eleventy.config.js"), "utf8");
  check(/const HOMEPAGE_EVENT_LIMIT = 5;/.test(config),
    "the limit is a named constant in the config", "HOMEPAGE_EVENT_LIMIT = 5");
  check(/\.slice\(0, HOMEPAGE_EVENT_LIMIT\)/.test(config),
    "…and the homepage filter applies it", "sliced");

  const homepage = (list) =>
    list.filter((e) => e.show_on_homepage === true).slice(0, 5);

  const dated = (n) => Array.from({ length: n }, (_, i) =>
    event(`e${i}`, "2025/26", `2026-0${(i % 9) + 1}-01`));

  check(homepage([]).length === 0, "no events renders nothing", "0");
  check(homepage(dated(1)).length === 1, "one event renders one", "1");
  check(homepage(dated(5)).length === 5, "exactly five renders five", "5");
  check(homepage(dated(6)).length === 5, "six renders five", "5");
  check(homepage(dated(40)).length === 5, "forty renders five", "5");

  /*
    ORDER DECIDES WHICH FIVE, AND ORDER IS THE DATE. A newer event takes the top
    place and pushes the oldest of the five off the homepage — where it stays
    on the events page, which is uncapped.
  */
  const listing = years([
    event("newest", "2025/26", "2026-06-01"),
    event("a", "2025/26", "2026-05-01"),
    event("b", "2025/26", "2026-04-01"),
    event("c", "2025/26", "2026-03-01"),
    event("d", "2025/26", "2026-02-01"),
    event("oldest", "2025/26", "2026-01-01"),
  ], "2025/26")[0].records;

  const five = homepage(listing);
  check(five.map((e) => e.slug).join(",") === "newest,a,b,c,d",
    "the five newest are the five shown", five.map((e) => e.slug).join(", "));
  check(!five.some((e) => e.slug === "oldest"),
    "…and the sixth falls off the homepage", "oldest dropped");
  check(listing.length === 6,
    "…while the events page still has all six", `${listing.length} events`);

  /* A card hidden from the homepage never takes one of the five places. */
  const withHidden = homepage(years([
    event("shown-1", "2025/26", "2026-06-01"),
    event("not-on-home", "2025/26", "2026-05-15", { show_on_homepage: false }),
    event("shown-2", "2025/26", "2026-05-01"),
  ], "2025/26")[0].records);
  check(withHidden.map((e) => e.slug).join(",") === "shown-1,shown-2",
    "an event hidden from the homepage is skipped, not counted",
    withHidden.map((e) => e.slug).join(", "));

  /* Ties are broken by slug, so the five are the same five every build. */
  const tied = homepage(years([
    event("bravo", "2025/26", "2026-06-01"),
    event("alpha", "2025/26", "2026-06-01"),
  ], "2025/26")[0].records);
  check(tied.map((e) => e.slug).join(",") === "alpha,bravo",
    "two events on the same day order by slug, deterministically",
    tied.map((e) => e.slug).join(", "));
}

/* ------------------------------------------------------------------- report */

console.log("\n" + "=".repeat(70));
console.log(problems.length === 0
  ? `  PASS — ${checks} year-section checks, 0 problems`
  : `  FAIL — ${problems.length} of ${checks} year-section checks:\n    - ${problems.join("\n    - ")}`);
console.log("=".repeat(70) + "\n");
process.exit(problems.length === 0 ? 0 : 1);
