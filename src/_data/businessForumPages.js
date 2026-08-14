/**
 * The cross product of published Polish Business Forum editions × locales.
 *
 * Deliberately a sibling of standardEventPages.js rather than a shared loader
 * with a family parameter: the two families paginate into DIFFERENT templates,
 * so each template needs its own data set. What they share is the record
 * directory and the event core — which is the point of the extension design.
 *
 * Filtering on `event_family` here is the mechanism that stops a Business Forum
 * record ever rendering through the standard-event template, and vice versa.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { normaliseRecordDates } = require("./dateOnly");

const EVENTS_DIR = path.join(__dirname, "..", "..", "content", "events");
const LOCALES = require("./locales.json");
const FAMILY = "polish-business-forum";

module.exports = () => {
  if (!fs.existsSync(EVENTS_DIR)) return [];

  const events = fs
    .readdirSync(EVENTS_DIR)
    // .sort() keeps the build deterministic: readdir order is filesystem
    // dependent and would otherwise vary between machines.
    .sort()
    .filter((f) => /\.ya?ml$/i.test(f))
    .map((f) => normaliseRecordDates({
      ...(yaml.load(fs.readFileSync(path.join(EVENTS_DIR, f), "utf8")) || {}),
      _source: `content/events/${f}`,
    }))
    .filter((e) => e.published === true && e.event_family === FAMILY)
    // A record in this family that names any other template is a structural
    // error, not something to render differently — fail the build.
    .map((e) => {
      if (e.template !== "business-forum") {
        throw new Error(
          `${e._source}: event_family "${FAMILY}" requires template "business-forum", got "${e.template}"`
        );
      }
      if (!e.business_forum) {
        throw new Error(`${e._source}: event_family "${FAMILY}" requires a business_forum: extension`);
      }
      return e;
    })
    .sort((a, b) => (a.order - b.order) || (String(a.slug) < String(b.slug) ? -1 : 1));

  const pairs = [];
  for (const event of events) {
    for (const locale of LOCALES) {
      pairs.push({ event, locale });
    }
  }
  return pairs;
};
