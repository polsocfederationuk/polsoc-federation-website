/**
 * rules.js — the canonical content rules, applied before a production write.
 *
 * WHY THE SERVER CHECKS AT ALL
 *
 * Decap validates in the browser. The browser is where a rule is EXPLAINED, not
 * where it is enforced — a caller that skipped the form, an editor on a stale
 * tab, or a widget that changes behaviour in a future release all reach this
 * function with whatever they have. A record that would break the build must
 * not be committable, because the commit is what Netlify builds.
 *
 * NOTHING IS RESTATED HERE.
 *
 * Every rule below is the SAME function the local CMS, the build and the
 * validator already use. This file decides which of them apply to a given file
 * and turns a failure into a sentence; it does not own a rule. A second
 * interpretation of "is this academic year in the future" is exactly the drift
 * this repository has spent several phases removing.
 */

"use strict";

const yaml = require("js-yaml");

const academicYear = require("../../src/_data/academicYear.js");
const registration = require("../../src/_data/registration.js");

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,120}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/* These become links and buttons in a public page. */
const SAFE_URL = /^https:\/\/[^\s"'<>]+$/;

/**
 * Why can this record not be saved? Null when it is fine.
 *
 * @param {string} repoPath   where it is going
 * @param {string} raw        the YAML as the CMS produced it
 * @param {string} folder     the collection folder, already allow-listed
 */
function check(repoPath, raw, folder) {
  let record;
  try {
    record = yaml.load(String(raw || ""));
  } catch (err) {
    return "That record could not be saved because its content is malformed.";
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return "That record could not be saved because it is empty.";
  }

  const id = repoPath.split("/").pop().replace(/\.yaml$/, "");

  /*
    THE FILENAME AND THE RECORD MUST AGREE.

    They are the same identity: the filename is the page address and the slug is
    what other records point at. A mismatch produces a record nothing can find
    and a link that resolves to nothing.
  */
  if (folder !== "content/settings") {
    if (!ID_PATTERN.test(id)) return "That record ID is not usable.";
    if (record.slug !== undefined && record.slug !== id) {
      return `That record's ID says "${record.slug}" but it is being saved as "${id}".`;
    }
    if (record.academic_year !== undefined &&
        academicYear.parseAcademicYear(String(record.academic_year)) === null) {
      return `"${record.academic_year}" is not a valid academic year.`;
    }
  }

  for (const [field, value] of Object.entries(record)) {
    if (/_date$|^start_date$|^end_date$|_on$/.test(field) && value !== null &&
        value !== undefined && value !== "" && !DATE_ONLY.test(String(value))) {
      return `The ${field.replace(/_/g, " ")} must be a calendar day.`;
    }
  }

  if (folder === "content/events") return checkEvent(record);
  if (folder === "content/announcements") return checkAnnouncement(record);
  return null;
}

function checkEvent(record) {
  /*
    THE FUTURE-YEAR PUBLICATION GUARD.

    Publishing an event from a later academic year is a fatal build error — the
    listing refuses to group it — so it would take the public site down on the
    next deploy. Same helper as the entry editor and Bulk manage.
  */
  const problem = academicYear.futurePublishProblem(record, currentAcademicYear());
  if (problem) {
    return `"${eventTitle(record)}" cannot be published yet: it belongs to ` +
      `${problem.eventYear} and the current academic year is ${problem.currentYear}.`;
  }

  const reg = record.registration || {};
  if (reg.state === "open" && !SAFE_URL.test(String(reg.url || ""))) {
    return "Registration is set to Open, so it needs a full https:// web address.";
  }
  if (reg.opens_on && reg.closes_on && String(reg.opens_on) > String(reg.closes_on)) {
    return "Sign-ups cannot close before they open.";
  }
  if (record.album_url && !SAFE_URL.test(String(record.album_url))) {
    return "The photo album link must be a full https:// address.";
  }
  for (const field of ["instagram_permalink", "facebook_permalink", "linkedin_permalink"]) {
    if (record[field] && !SAFE_URL.test(String(record[field]))) {
      return `The ${field.split("_")[0]} link must be a full https:// address.`;
    }
  }
  /* The retired architecture must not come back through a stale client. */
  if (record.sections || (record.en || {}).sections || (record.pl || {}).sections) {
    return "That event uses an old layout the site no longer supports.";
  }
  for (const locale of ["en", "pl"]) {
    const loc = record[locale] || {};
    if (!String(loc.summary || "").trim()) {
      return `The ${locale === "en" ? "English" : "Polish"} summary is required.`;
    }
  }
  return null;
}

function checkAnnouncement(record) {
  const reg = record.registration || {};
  if (registration.sourceOf(reg) === "event") {
    /*
      An event reference must resolve. The referenced event's own registration
      state is NOT a condition — since Phase 17C.5A.3 an announcement may point
      at an event whose sign-ups have not opened, which is the ordinary case.
    */
    if (!registration.referencedEventSlug(reg)) {
      return "Registration is set to come from a Federation event, but no event is chosen.";
    }
    const link = record.link || {};
    if (link.type === "event" && link.event_slug &&
        link.event_slug !== registration.referencedEventSlug(reg)) {
      return "This announcement links to one Federation event but takes its " +
        "registration from another.";
    }
  } else {
    if (reg.state === "open" && !SAFE_URL.test(String(reg.url || ""))) {
      return "Registration is set to Open, so it needs a full https:// web address.";
    }
    if (reg.opens_on && reg.closes_on && String(reg.opens_on) > String(reg.closes_on)) {
      return "Sign-ups cannot close before they open.";
    }
  }
  const link = record.link || {};
  if (link.type === "external" && !SAFE_URL.test(String(link.url || ""))) {
    return "The destination link must be a full https:// address.";
  }
  for (const locale of ["en", "pl"]) {
    if (!String(((record[locale] || {}).title) || "").trim()) {
      return `The ${locale === "en" ? "English" : "Polish"} title is required.`;
    }
  }
  return null;
}

function eventTitle(record) {
  const en = record.en || {};
  return [en.title_lead, en.title_fancy, en.title_tail].filter(Boolean).join(" ") ||
    record.slug || "that event";
}

/**
 * The current academic year.
 *
 * Read from the repository at build time and pinned into the function bundle,
 * because a function has no working copy to read. The settings record is
 * admin-only and changes about once a year; a deploy follows every change to
 * it, so the pinned value is never more than one deploy stale.
 */
function currentAcademicYear() {
  if (process.env.CMS_CURRENT_ACADEMIC_YEAR) return process.env.CMS_CURRENT_ACADEMIC_YEAR;
  try {
    const fs = require("fs");
    const path = require("path");
    const file = path.join(__dirname, "..", "..", "content", "settings", "academic-year.yaml");
    return String((yaml.load(fs.readFileSync(file, "utf8")) || {}).current || "");
  } catch (err) {
    return "";
  }
}

module.exports = { check, checkEvent, checkAnnouncement, currentAcademicYear, SAFE_URL };
