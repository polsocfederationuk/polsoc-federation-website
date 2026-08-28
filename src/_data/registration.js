/**
 * registration.js — one answer to "can people sign up, and where?"
 *
 * WHY THIS EXISTS
 *
 * A Federation event owns its registration. An announcement about that event may
 * REFER to it. Before this, the only way for an announcement to show a sign-up
 * button was to repeat the event's status, address and dates in its own record —
 * two copies of one fact, which drift the moment somebody changes one of them.
 *
 * So an announcement now stores a REFERENCE, and the effective values are
 * resolved here at build time:
 *
 *   registration:
 *     source: event
 *     event_slug: icebreaker
 *
 * Nothing is copied. Change the event's registration and every announcement
 * pointing at it renders the new state on the next build. That is the point.
 *
 * BACKWARDS COMPATIBILITY
 *
 * The twenty-eight migrated announcements carry a registration block with no
 * `source` key at all. An absent source means "this announcement's own
 * registration", which is exactly what those records mean, so none of them
 * needed rewriting and none of them changed.
 *
 *   source absent, or "own"  -> the record's own state/url/dates
 *   source "event"           -> the referenced event's registration
 *
 * A reference that cannot be resolved is an ERROR, never a silent fallback to
 * stale values: scripts/validate.js and cms-check refuse it. Rendering nothing
 * would hide a broken link to a sign-up page, which is worse than failing loudly
 * while somebody can still fix it.
 */

"use strict";

const SOURCE_OWN = "own";
const SOURCE_EVENT = "event";

/** The states a registration may be in, in the order they occur. */
const STATES = ["none", "coming_soon", "open", "closed"];

const blank = (v) => v === undefined || v === null ||
  (typeof v === "string" && v.trim() === "");

const text = (v) => (blank(v) ? null : String(v).trim());

/** The empty answer — no panel, no button, nothing rendered. */
function noRegistration() {
  return { state: "none", url: null, opensOn: null, closesOn: null, source: SOURCE_OWN };
}

/**
 * Which source does this registration block use?
 *
 * Absent means "own", so every pre-existing record keeps its meaning without
 * being touched.
 */
function sourceOf(registration) {
  const r = registration || {};
  return text(r.source) === SOURCE_EVENT ? SOURCE_EVENT : SOURCE_OWN;
}

/** The event slug an announcement points at, or null. */
function referencedEventSlug(registration) {
  if (sourceOf(registration) !== SOURCE_EVENT) return null;
  return text((registration || {}).event_slug);
}

/**
 * A registration block reduced to what a template needs.
 *
 * Only the fields the state can honestly use survive: a closed sign-up keeps no
 * address, because there is nothing to click.
 */
function normalise(registration) {
  const r = registration || {};
  const state = STATES.indexOf(text(r.state)) >= 0 ? text(r.state) : "none";
  if (state === "none") return noRegistration();
  return {
    state,
    url: state === "open" ? text(r.url) : null,
    opensOn: text(r.opens_on),
    closesOn: text(r.closes_on),
    source: sourceOf(r),
  };
}

/**
 * The registration an announcement actually renders.
 *
 * @param {object} announcement
 * @param {(slug: string) => object|null} lookupEvent  finds an event by slug
 * @returns {{state, url, opensOn, closesOn, source, eventSlug?}}
 */
function effectiveRegistration(announcement, lookupEvent) {
  const own = (announcement || {}).registration || null;
  if (!own) return noRegistration();

  if (sourceOf(own) !== SOURCE_EVENT) return normalise(own);

  const slug = referencedEventSlug(own);
  const event = slug && typeof lookupEvent === "function" ? lookupEvent(slug) : null;
  if (!event) {
    // Resolved by the validator long before a build reaches here; throwing keeps
    // a broken reference from quietly rendering as "no registration".
    throw new Error(
      `announcement "${(announcement || {}).slug}" points its registration at ` +
      `event "${slug}", which does not exist`);
  }

  const resolved = normalise(event.registration);
  resolved.source = SOURCE_EVENT;
  resolved.eventSlug = slug;
  return resolved;
}

/**
 * Is this event one an announcement may point at?
 *
 * ANY standard event (Phase 17C.5A.3). It used to mean "a standard event that
 * already has a real registration", which quietly hid from the picker exactly
 * the events people write announcements about first — the ones announced before
 * sign-ups open. Pointing at one of those is correct, not an error: no panel
 * renders today, and the announcement inherits the registration the moment the
 * event gains one.
 *
 * The Business Forum stays out. It is a separate family with its own page and
 * its own rules, and this model does not describe it.
 */
function isRegistrable(event) {
  return (event || {}).event_family === "standard";
}

/**
 * Why is this announcement's registration reference invalid? Null if it is fine.
 *
 * Shared by scripts/validate.js, cms-check and the CMS pre-save guard so all
 * three refuse exactly the same things.
 */
function referenceProblem(announcement, events) {
  const own = (announcement || {}).registration || null;
  if (!own || sourceOf(own) !== SOURCE_EVENT) return null;

  const slug = referencedEventSlug(own);
  if (!slug) return "no event is selected for the registration to come from";

  const event = (events || []).find((e) => e && e.slug === slug);
  if (!event) return `the selected event "${slug}" does not exist`;
  if (event.event_family !== "standard") {
    return `"${slug}" is not a standard event, so its registration cannot be shared`;
  }
  /*
    AN EVENT WITH NO REGISTRATION IS A VALID REFERENCE (Phase 17C.5A.3).

    This used to be refused. It should not be: an announcement is often written
    BEFORE sign-ups open, and pointing it at the event then is exactly right.
    The announcement simply shows no registration panel until the event gains
    one, and inherits it on the next build without being touched again.

    What still fails is a reference that can never resolve — a missing event, or
    one from a family this model does not cover.
  */

  /*
    The destination link and the registration are separate ideas — an
    announcement may link to one event's page while registration is handled
    elsewhere. But pointing them at two DIFFERENT Federation events is almost
    certainly a mistake, and a reader would see a button for one event beside a
    link to another.
  */
  const link = (announcement || {}).link || null;
  if (link && text(link.type) === "event") {
    const linked = text(link.event_slug);
    if (linked && linked !== slug) {
      return `the details link points at "${linked}" but the registration comes ` +
        `from "${slug}" — a reader would see two different events`;
    }
  }
  return null;
}

module.exports = {
  SOURCE_OWN, SOURCE_EVENT, STATES,
  noRegistration, sourceOf, referencedEventSlug, normalise,
  effectiveRegistration, isRegistrable, referenceProblem,
  /*
    The admin page inlines sourceOf and referencedEventSlug by stringifying
    them, and a stringified function carries no scope — so it needs these two
    as well. Exported rather than retyped in cmsConfig.js so the browser and
    the build cannot disagree about what counts as blank.
  */
  blank, text,
};
