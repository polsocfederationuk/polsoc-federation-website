#!/usr/bin/env node
/**
 * test-event-record-id.js — the standard event's generated, locked Record ID.
 *
 * Runs the real src/admin/event-record-id.js, twice:
 *
 *   1. through Node's require, for the pure generator;
 *   2. in a sandbox with a fake `CMS.registerWidget`, `h` and `createClass`,
 *      driving the widget the way Decap does — props in, onChange out — to prove
 *      that a new event follows its title, a hand-typed ID is left alone, and a
 *      saved event's ID is never changed.
 *
 * NOTHING HERE WRITES A FILE. No browser is started, so the final check of the
 * control in the real editor is still a manual one: see docs/CMS_EVENTS.md §4.
 *
 * Run:  npm run test:event-record-id
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const WIDGET_FILE = path.join(ROOT, "src", "admin", "event-record-id.js");

let checks = 0;
const problems = [];

function check(ok, what, detail) {
  checks++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}`);
  if (!ok && detail !== undefined) console.log(`          ${detail}`);
  if (!ok) problems.push(what + (detail !== undefined ? ` — ${detail}` : ""));
}

const section = (t) => console.log(`\n  ${t}\n  ${"-".repeat(t.length)}`);
const same = (actual, expected, what) =>
  check(actual === expected, what, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

/* -- 1. the generator ------------------------------------------------------- */

section("1. The generator");

const gen = require(WIDGET_FILE);

same(gen.generate("Chleb Asi", "2026/27"), "chleb-asi-26-27", "Chleb Asi + 2026/27 -> chleb-asi-26-27");
same(gen.generate("Wigilia Świąteczna", "2026/27"), "wigilia-swiateczna-26-27", "Polish letters become plain letters");
same(gen.generate("ŁÓDŹ Żółć Gęślą Jaźń", "2025/26"), "lodz-zolc-gesla-jazn-25-26", "every Polish diacritic, capitals included (ł does not decompose)");
same(gen.generate("  Q&A:  Night!! ", "2026/27"), "q-a-night-26-27", "punctuation and spaces become single hyphens, none at the ends");
same(gen.generate("Chleb Asi", ""), "chleb-asi", "no academic year yet: the title part alone");
same(gen.generate("Chleb Asi", "2026-27"), "chleb-asi", "a year not in the 2026/27 shape is not guessed at");
same(gen.generate("", "2026/27"), "", "no title: empty, so the required check explains what is missing");
same(gen.generate("!!!", "2026/27"), "", "a title with no letters or numbers: empty");
same(gen.generate("Youth Congress 26-27", "2026/27"), "youth-congress-26-27", "a title already ending with the year is not given it twice");
same(gen.shortYear("2099/00"), "99-00", "the short year is taken from the stored value, not computed");
same(gen.composeTitle("Annual", "Christmas", "Dinner"), "Annual Christmas Dinner", "the title is joined the way the page joins it");
same(gen.composeTitle("Icebreaker", "", null), "Icebreaker", "empty title parts add no spaces");

/* -- 2. the configuration --------------------------------------------------- */

section("2. The Events configuration");

const cmsConfig = require(path.join(ROOT, "src", "_data", "cmsConfig.js"));
const config = cmsConfig.buildConfig ? cmsConfig.buildConfig() : cmsConfig().config;
const events = config.collections.find((c) => c.name === "standard_events");
const slugField = events && events.fields.find((f) => f.name === "slug");

check(slugField && slugField.widget === "eventRecordId", "the Record ID uses the eventRecordId widget",
  slugField && slugField.widget);
check(slugField && slugField.required === true && Array.isArray(slugField.pattern),
  "the Record ID is still required and pattern-validated");
check(events && events.slug === "{{fields.slug}}", "the filename is still the Record ID");
check(slugField && /new record each year/i.test(String(slugField.hint)),
  "the hint still explains annual editions");
check(slugField && /chleb-asi-26-27/.test(String(slugField.hint)),
  "the hint shows the generated form");

const pattern = new RegExp(slugField.pattern[0]);
for (const [title, year] of [["Chleb Asi", "2026/27"], ["Wigilia Świąteczna", "2025/26"],
  ["  Q&A:  Night!! ", "2026/27"], ["Annual Christmas Dinner", "2026/27"], ["Ćma", ""]]) {
  const id = gen.generate(title, year);
  check(pattern.test(id), `generated ID passes the configured pattern: ${id}`);
}

// Other collections are unchanged.
for (const name of ["team", "announcements"]) {
  const c = config.collections.find((x) => x.name === name);
  const f = c && c.fields.find((x) => x.name === "slug");
  check(!f || f.widget !== "eventRecordId", `${name} Record IDs are unchanged`, f && f.widget);
}

/* -- 3. the admin page ------------------------------------------------------ */

section("3. The admin page");

const admin = fs.readFileSync(path.join(ROOT, "src", "admin", "index.njk"), "utf8");
const exported = cmsConfig();
check(/cmsConfig\.eventRecordIdScript/.test(admin), "the admin page embeds the Record ID control");
check(/cmsConfig\.eventRecordIdStyles/.test(admin), "the admin page embeds its styles");
check(admin.indexOf("cmsConfig.eventRecordIdScript") < admin.indexOf("window.CMS.registerEventListener({"),
  "the widget is registered before the editor can render it");
check(/registerWidget\("eventRecordId"/.test(exported.eventRecordIdScript),
  "the control is registered through the documented widget API");
check(/collection\.name === "standard_events"/.test(admin) &&
  /Record ID cannot be changed/.test(admin),
  "the pre-save guard refuses a changed ID on a saved event");

/* -- 4. the widget, driven like Decap drives it ----------------------------- */

section("4. The widget");

let registered = null;
const h = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat() });
const sandbox = {
  window: {
    h,
    createClass: (spec) => spec,
    CMS: { registerWidget: (name, control, preview) => { registered = { name, control, preview }; } },
  },
};
vm.runInNewContext(fs.readFileSync(WIDGET_FILE, "utf8"), sandbox, { filename: WIDGET_FILE });
check(registered && registered.name === "eventRecordId", "the file registers eventRecordId");

/** An Immutable-like entry: just get/getIn over plain objects. */
function entry({ newRecord, path: p, data }) {
  const obj = { newRecord, path: p, data };
  return {
    get: (k) => obj[k],
    getIn: (keys) => keys.reduce((v, k) => (v == null ? undefined : v[k]), obj),
  };
}

/** Mount the control with a tiny store: onChange writes the value back. */
function mount({ newRecord, path: p, data }) {
  const spec = registered.control;
  const store = { data: JSON.parse(JSON.stringify(data)), changes: [] };
  const inst = Object.create(spec);
  const props = () => ({
    value: store.data.slug,
    entry: entry({ newRecord, path: p, data: store.data }),
    forID: "slug-field-1",
    classNameWrapper: "wrapper",
    onChange: (v) => { store.changes.push(v); store.data.slug = v; },
  });
  inst.props = props();
  inst.state = spec.getInitialState.call(inst);
  inst.setState = function (s) { this.state = Object.assign({}, this.state, s); };
  spec.componentDidMount.call(inst);
  const rerender = () => {
    // Decap re-renders after a store change; follow() may change the value once.
    for (let i = 0; i < 3; i++) {
      inst.props = props();
      spec.componentDidUpdate.call(inst);
    }
  };
  return {
    inst, store,
    set(field, value) {
      const keys = field.split(".");
      let o = store.data;
      while (keys.length > 1) { const k = keys.shift(); o[k] = o[k] || {}; o = o[k]; }
      o[keys[0]] = value;
      rerender();
    },
    type(value) { inst.handleChange({ target: { value } }); rerender(); },
    input() { return inst.render().children[0]; },
    note() { return inst.render().children[1]; },
  };
}

{
  const w = mount({ newRecord: true, path: undefined, data: { en: {}, academic_year: undefined } });
  same(w.store.changes.length, 0, "new event with no title: nothing is written");
  check(w.input().props.readOnly === false, "new event: the field is editable");

  w.set("en.title_lead", "Chleb");
  same(w.store.data.slug, "chleb", "typing the title fills the ID");
  w.set("en.title_fancy", "Asi");
  w.set("academic_year", "2026/27");
  same(w.store.data.slug, "chleb-asi-26-27", "title + year -> chleb-asi-26-27");
  w.set("pl", { title_lead: "Zupełnie inny tytuł" });
  same(w.store.data.slug, "chleb-asi-26-27", "the Polish title does not affect it");
  w.set("academic_year", "2027/28");
  same(w.store.data.slug, "chleb-asi-27-28", "changing the year follows");

  w.type("my-own-id");
  same(w.store.data.slug, "my-own-id", "typing in the field is kept");
  w.set("en.title_lead", "Bread");
  same(w.store.data.slug, "my-own-id", "after typing, a title change does not overwrite it");
  const button = w.note().children.find((c) => c && c.tag === "button");
  check(button && /bread-asi-27-28/.test(button.children.join("")),
    "a button offers the generated ID", JSON.stringify(button));
  w.inst.useGenerated();
  w.set("academic_year", "2027/28");
  same(w.store.data.slug, "bread-asi-27-28", "the button hands the field back to the generator");
  w.set("en.title_lead", "Chleb");
  same(w.store.data.slug, "chleb-asi-27-28", "and it follows the title again");
}

{
  const data = { slug: "icebreaker", academic_year: "2025/26", en: { title_lead: "Icebreaker" } };
  const w = mount({ newRecord: false, path: "content/events/icebreaker.yaml", data });
  same(w.store.changes.length, 0, "saved event: opening it writes nothing");
  check(w.input().props.readOnly === true, "saved event: the field is read-only");
  w.set("en.title_lead", "Something Else");
  w.set("academic_year", "2026/27");
  same(w.store.data.slug, "icebreaker", "saved event: title and year changes do not touch the ID");
  w.type("hacked");
  same(w.store.data.slug, "icebreaker", "saved event: typing is ignored");
  check(/Locked/.test(w.note().children.join("")), "saved event: the note says why it is locked");
}

{
  // A duplicate carries the old ID into a new record.
  const data = { slug: "christmas-dinner", academic_year: "2026/27",
    en: { title_lead: "Annual", title_fancy: "Christmas", title_tail: "Dinner" } };
  const w = mount({ newRecord: true, path: undefined, data });
  same(w.store.data.slug, "christmas-dinner", "duplicate: the copied ID is not silently replaced");
  const button = w.note().children.find((c) => c && c.tag === "button");
  check(button && /annual-christmas-dinner-26-27/.test(button.children.join("")),
    "duplicate: the generated ID is offered");
}

{
  // Draft restored from a local backup, no newRecord flag: decided by path.
  const w = mount({ newRecord: undefined, path: "content/events/icebreaker.yaml",
    data: { slug: "icebreaker", en: { title_lead: "Other" }, academic_year: "2025/26" } });
  check(w.input().props.readOnly === true, "no flag but a path: treated as saved and locked");
}

/* -- result ------------------------------------------------------------------ */

console.log("\n" + "=".repeat(78));
if (problems.length) {
  console.log(`  FAIL — ${problems.length} of ${checks} Record ID checks failed`);
  console.log("=".repeat(78) + "\n");
  process.exit(1);
}
console.log(`  PASS — ${checks} Record ID checks, 0 problems`);
console.log("=".repeat(78) + "\n");
