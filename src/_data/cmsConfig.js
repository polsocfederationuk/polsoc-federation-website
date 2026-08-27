/**
 * Decap CMS configuration — as DATA, not as a hand-written YAML file.
 *
 * This module is the single source of truth for the admin panel's schema. It is
 * consumed in two places:
 *
 *   1. src/admin/config.njk  renders it to dist/admin/config.yml (CMS_DEV only)
 *   2. scripts/validate-cms.js and scripts/test-cms-roundtrip.js require it
 *      directly, so the tests can never drift from the config that ships.
 *
 * WHY GENERATED RATHER THAN HAND-WRITTEN
 * --------------------------------------
 * docs/TEAM_MIGRATION.md §12 flagged the one thing that would rot: the `group`
 * select must not be a second hard-coded copy of the six group keys. Because the
 * admin config is generated, the options are derived from the same
 * content/settings/team-groups.yaml the site renders from, so the two
 * definitions cannot disagree.
 *
 * FIELD ORDER IS LOAD-BEARING
 * ---------------------------
 * Decap serialises with `yaml@1` and sorts the output keys by the field order
 * declared here (decap-cms-core/formats/yaml.js -> toFile -> sortKeys). Keeping
 * this order identical to the existing records' layout is what makes a CMS save
 * produce a small, readable diff instead of a whole-file reshuffle.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const academicYear = require("./academicYear");

const ROOT = path.join(__dirname, "..", "..");

/* The local proxy. Port and host are matched by package.json's `cms:proxy`
 * script; 8081 is decap-server's own default. */
const PROXY_PORT = 8081;
/** The branch Netlify builds the public site from. */
const PRODUCTION_BRANCH = process.env.CMS_GITHUB_BRANCH || "main";

const PROXY_URL = `http://localhost:${PROXY_PORT}/api/v1`;

/** The configured current academic year, read fresh from the settings file. */
function currentAcademicYear() {
  const file = path.join(ROOT, "content", "settings", "academic-year.yaml");
  if (!fs.existsSync(file)) return null;
  return (yaml.load(fs.readFileSync(file, "utf8")) || {}).current || null;
}

/* ---------------------------------------------------------------------------
   Group options, derived from the ONE central definition.
   --------------------------------------------------------------------------- */
function teamGroupOptions() {
  const file = path.join(ROOT, "content", "settings", "team-groups.yaml");
  const cfg = yaml.load(fs.readFileSync(file, "utf8")) || {};
  const groups = cfg.groups || [];
  if (groups.length === 0) {
    throw new Error("cmsConfig: content/settings/team-groups.yaml defines no groups");
  }
  // The editor sees the English section heading; the file stores the canonical
  // key the build filters on. A select (not free text) is what stops a typo
  // from inventing a seventh team group that renders nowhere.
  return groups.map((g) => ({
    label: (g.en && g.en.heading) || g.key,
    value: g.key,
  }));
}

/* ---------------------------------------------------------------------------
   Event options for announcement links, derived from the canonical event
   records rather than hard-coded.

   An announcement stores an event SLUG, never a generated URL: the templates
   build `event-<slug>.html` for English and `../event-<slug>.html` from the
   Polish page, which is how a link keeps the reader's language. Storing a URL
   would freeze one language into the content.

   The label is assembled the way the event templates assemble it. Standard
   events keep their heading in parts (`title_lead` / `title_fancy` /
   `title_tail`) and the Business Forum uses a single `title`; joining the parts
   with a SPACE is deliberate — concatenating them with "" is the exact defect
   that produced "Polish Youth Congress2025" in Phase 11.
   --------------------------------------------------------------------------- */
function eventLinkOptions() {
  const dir = path.join(ROOT, "content", "events");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/i.test(f))
    .sort()
    .map((f) => yaml.load(fs.readFileSync(path.join(dir, f), "utf8")) || {})
    .filter((e) => e.slug && e.published === true)
    .map((e) => {
      const en = e.en || {};
      const label = en.title ||
        [en.title_lead, en.title_fancy, en.title_tail]
          .filter(Boolean).map((s) => String(s).trim()).filter(Boolean).join(" ");
      return { label: label || e.slug, value: e.slug };
    });
}

/* ---------------------------------------------------------------------------
   Academic year.

   Since Phase 17C.2 the editor picks from a SELECT rather than typing. The
   objection to a select was that somebody would have to edit an array each
   summer — so the options are GENERATED (see academicYearOptions), running from
   2025/26 through ten years past whatever is configured. Rolling the site over
   extends the list instead of shifting it, so historical years stay selectable
   and historical records stay editable.

   The pattern below is kept for the validators and for any value that reaches a
   file another way. scripts/validate.js still enforces the ARITHMETIC — that the
   second half really is the following year — because a regular expression cannot
   add one to a number. See docs/CMS_FOUNDATION.md §10.
   --------------------------------------------------------------------------- */
const ACADEMIC_YEAR_PATTERN = ["^\\d{4}/\\d{2}$", 'Use the form 2025/26 — four digits, a slash, then two digits.'];

/**
 * The academic-year control every annual collection uses.
 *
 * A SELECT, not free text. A mistyped "2025/27" or "2025-26" used to reach the
 * file and be caught only by the validator, long after the editor had moved on.
 * Options come from one generator in src/_data/academicYear.js, so Team,
 * Announcements, Events and Site settings cannot offer different years.
 *
 * The stored value is the option value itself — "2026/27" — never a display
 * label, so nothing downstream has to translate it back.
 */
function academicYearField(name, label, hint, extra) {
  return Object.assign({
    label,
    name,
    widget: "select",
    required: true,
    options: academicYear.academicYearOptions(currentAcademicYear()),
    hint,
  }, extra || {});
}

/**
 * A date-only calendar control.
 *
 * `datetime` with a date-only format and `picker_utc` gives a calendar without a
 * clock and, critically, without timezone conversion — the stored string stays
 * exactly YYYY-MM-DD, which dateOnly.js, the validators and the JSON-LD all
 * depend on. Free typing was the previous behaviour and let a value like
 * 20/05/2026 reach a file.
 *
 * Year-month-day ordering is stated in the hint: the picker renders in Decap's
 * own format, and forcing a slashed display is not worth risking the stored
 * value. See docs/CMS_EVENTS.md.
 *
 * Every field built here registers its name in DATE_FIELD_NAMES, which the
 * pre-save guard uses to turn a cleared date into `null`. Registering at
 * construction rather than in a hand-kept list means a date field added later is
 * covered the moment it exists.
 */
const DATE_FIELD_NAMES = [];

function dateOnlyField(name, label, required, hint) {
  if (DATE_FIELD_NAMES.indexOf(name) === -1) DATE_FIELD_NAMES.push(name);
  return {
    label,
    name,
    widget: "datetime",
    required: Boolean(required),
    date_format: "YYYY-MM-DD",
    time_format: false,
    format: "YYYY-MM-DD",
    picker_utc: true,
    hint,
  };
}

const YEAR_HINT =
  "The committee year this membership belongs to, e.g. 2025/26. " +
  "Create a NEW record for a new committee year. Do not change this value on an " +
  "old record merely to reuse the member — that would erase last year's committee " +
  "from the site's history.";

const SLUG_HINT =
  "The unique identifier for THIS annual Team record. It becomes the filename, " +
  "so it must not match any record that already exists. " +
  "Use the person's name in lowercase with hyphens — for example jane-example. " +
  "When somebody serves in a later committee year, leave their existing record " +
  "alone and create a NEW one with a different ID, for example " +
  "jane-example-2026-27. A year suffix is only needed to keep the second record " +
  "distinct; a first record does not need one. " +
  "Do not change this value when you are simply editing somebody's details.";

const ROLLOVER_WARNING =
  "This controls which academic year the website treats as current. " +
  "Changing it does NOT move or delete old content: last year's team members and " +
  "events stay exactly where they are and simply stop being shown. " +
  "Create the new year's Team members and events as NEW records rather than " +
  "changing the year on old records. Change this only when the new season is " +
  "ready to go live.";

/* ---------------------------------------------------------------------------
   Team fields.

   The order below is the order of the existing files, and therefore the order a
   saved file keeps. `en`/`pl` are explicit object widgets rather than Decap's
   i18n mode — see docs/CMS_FOUNDATION.md §7 for why.
   --------------------------------------------------------------------------- */
function teamFields() {
  return [
    {
      label: "Record ID — must be unique",
      name: "slug",
      widget: "string",
      required: true,
      hint: SLUG_HINT,
      pattern: ["^[a-z0-9]+(-[a-z0-9]+)*$",
        "Lowercase letters, numbers and single hyphens only — e.g. jane-example-2026-27."],
    },
    academicYearField("academic_year", "Academic year", YEAR_HINT),
    {
      label: "Team group",
      name: "group",
      widget: "select",
      required: true,
      options: teamGroupOptions(),
      hint: "Which section of the team page this person appears under.",
    },
    {
      label: "Display position within the group",
      name: "order",
      widget: "number",
      required: true,
      value_type: "int",
      min: 1,
      step: 1,
      hint: "1 is first. Positions are counted within this group and this academic " +
        "year only, so two people in different groups may both be 1.",
    },
    {
      label: "Published",
      name: "published",
      widget: "boolean",
      required: false,
      default: true,
      hint: "Unpublish to remove somebody from the site while keeping the record.",
    },
    {
      label: "Full name",
      name: "name",
      widget: "string",
      required: true,
      hint: "As it should appear on the card, in both languages.",
    },
    {
      label: "Photograph",
      name: "photo",
      widget: "image",
      required: false,
      // Leaving this empty is a legitimate editorial state, and Decap's natural
      // output for it is to omit the `photo` key entirely — it has no way to
      // write an explicit null, and `default: null` was tried and verified not
      // to change that. Rather than configure something Decap will not honour,
      // the schema now treats an absent key and `photo: null` as the same thing:
      // src/_data/records.js normalises the two at load, and scripts/validate.js
      // accepts either. A populated value is still strictly validated.
      // See docs/CMS_FOUNDATION.md §9.
      // Repo-root-relative because it starts with "/". Uploads land beside the
      // existing headshots and are stored in the YAML as /assets/team/<file>,
      // which is the root-relative form the Polish pages need: a page-relative
      // path would resolve to /pl/assets/team/... and 404.
      media_folder: "/assets/team",
      public_folder: "/assets/team",
      // No arbitrary URL insertion: every headshot must be a file in the
      // repository, never an external hotlink.
      choose_url: false,
      hint: "JPEG or PNG, roughly square. Leave empty if there is no photograph — " +
        "the card shows initials instead.",
    },
    {
      /*
        Added in Phase 17C.3, and OPTIONAL in the strongest sense: every one of
        the twenty-one existing members leaves it empty, and an empty value
        renders exactly what the site renders today — no style attribute at all,
        so their pages are byte-identical. Nobody has to go back and set a focus
        on a photograph that already looks right.

        Stored as a coordinate pair rather than a position string. Unlike the
        announcement field, this one has no history in the published site, so it
        can use the plainer representation from the start.
      */
      label: "Photograph focus",
      name: "photo_focus",
      widget: "focalPoint",
      required: false,
      image_field: "photo",
      value_format: "coords",
      // Measured from css/style.css: `.member .ph { aspect-ratio: 1 }`.
      frames: [{ label: "On the team card", ratio_w: 1, ratio_h: 1 }],
      hint: "Only needed if the square crop cuts someone's face awkwardly. " +
        "Leave it centred otherwise — most photographs need nothing here.",
    },
    {
      label: "E-mail address",
      name: "email",
      widget: "string",
      required: true,
      pattern: ["^[^\\s@]+@[^\\s@]+\\.[A-Za-z]{2,}$", "Enter a valid e-mail address."],
    },
    {
      label: "LinkedIn profile",
      name: "linkedin",
      widget: "string",
      required: true,
      pattern: ["^https://www\\.linkedin\\.com/in/\\S+$",
        "Must be a full https://www.linkedin.com/in/... profile URL."],
    },
    {
      label: "English",
      name: "en",
      widget: "object",
      required: true,
      collapsed: false,
      fields: [
        {
          label: "Role title (English)",
          name: "role",
          widget: "string",
          required: true,
          hint: "e.g. Vice-President, Events Officer.",
        },
        {
          label: "Photograph alt text (English)",
          name: "photo_alt",
          widget: "string",
          required: false,
          hint: "Usually just the person's name. Leave empty if there is no photograph.",
        },
      ],
    },
    {
      label: "Polski",
      name: "pl",
      widget: "object",
      required: true,
      fields: [
        {
          label: "Role title (Polish)",
          name: "role",
          widget: "string",
          required: true,
          hint: "np. Wiceprezes, Koordynator Wydarzeń.",
        },
        {
          label: "Photograph alt text (Polish)",
          name: "photo_alt",
          widget: "string",
          required: false,
          hint: "Zwykle po prostu imię i nazwisko. Zostaw puste, jeśli nie ma zdjęcia.",
        },
      ],
    },
  ];
}

/* ---------------------------------------------------------------------------
   Standard events.

   The four `event_family: standard` records. The Polish Business Forum is a
   different family with its own template and its own bespoke fields, and it is
   excluded from this collection entirely — see docs/CMS_EVENTS.md §2.
   --------------------------------------------------------------------------- */

const STANDARD_FAMILY = "standard";
const STANDARD_TEMPLATE = "standard";
const BUSINESS_FORUM_FAMILY = "polish-business-forum";

/** The section types the standard template renders, from the real records. */
const SECTION_TYPES = ["prose", "heading", "gallery", "album", "instagram"];

/**
 * The inert registration block every standard event carries.
 *
 * Kept as data rather than typed twice, because it is both the hidden field's
 * default and what ensureEventRegistration() completes a record with.
 */
const CANONICAL_REGISTRATION = { state: "none", type: null, url: null, email: null };

/**
 * Give a standard event the canonical no-registration block.
 *
 * Decap drops keys whose value is null, so a hidden field's default alone can
 * arrive as `{state: "none"}` with the three null siblings missing. The stored
 * schema keeps all four, so they are completed here rather than left to differ
 * from every existing record.
 *
 * Only ever ADDS the canonical shape to a standard event that lacks it: a record
 * that already carries a registration block — including any hand-authored
 * non-`none` one — is returned untouched. Nothing is overwritten.
 *
 * Pure and plain-JS: the admin page embeds this source and the tests import this
 * function, so what is tested is what runs.
 */
function ensureEventRegistration(data) {
  if (!data || data.event_family !== "standard") return null;

  var current = data.registration;
  var complete = current && typeof current === "object" && !Array.isArray(current) &&
    "state" in current && "type" in current && "url" in current && "email" in current;
  if (complete) return null;

  var next = { state: "none", type: null, url: null, email: null };
  if (current && typeof current === "object" && !Array.isArray(current)) {
    // Preserve anything already set; only fill the gaps.
    for (var k in next) {
      if (Object.prototype.hasOwnProperty.call(current, k) && current[k] !== undefined) {
        next[k] = current[k];
      }
    }
  }
  return next;
}

/**
 * A date the editor cleared must be stored as `null`, never as "".
 *
 * Decap's datetime widget writes an empty string when its Clear button is used.
 * The repository's canonical absent-date is `null` — that is what every
 * hand-written file holds, what scripts/validate.js documents, and what
 * `end_date: null` means to a reader of the YAML. Letting "" through would give
 * the same file two spellings for "no end date", which is how a validator that
 * checks one form and a template that checks the other end up disagreeing.
 *
 * Only exactly-empty values are touched, and only on registered date fields:
 * a real date is never rewritten. Returns null when nothing needed changing, so
 * the caller can leave the entry untouched.
 *
 * Pure and plain-JS: the admin page embeds this source and the tests import this
 * function, so what is tested is what runs.
 */
function blankDatesToNull(data, dateFieldNames) {
  if (!data || typeof data !== "object") return null;
  var names = dateFieldNames || DATE_FIELD_NAMES;
  var changed = [];
  for (var i = 0; i < names.length; i++) {
    var key = names[i];
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    var v = data[key];
    // "" and "   " only. undefined is Decap not having the key at all, which is
    // a different thing and not ours to invent a value for.
    if (typeof v === "string" && v.trim() === "") changed.push(key);
  }
  return changed.length ? changed : null;
}

/**
 * The canonical spelling of a colour: lowercase `#rrggbb`.
 *
 * The Brand colour control shows a live caption of what a typed value means, but
 * it deliberately does NOT rewrite the box under the editor's cursor while they
 * are typing. Canonicalising here instead means the stored value is correct
 * however it was entered — `#ABC`, `AABBCC` and `#AaBbCc` all land as
 * `#aabbcc` — and it keeps working even if a value ever arrives from somewhere
 * other than the widget.
 *
 * A value that is not a colour at all is left completely alone: the widget's own
 * validator refuses the save and tells the editor, and silently inventing a
 * colour here would hide that.
 *
 * Returns null when nothing needed changing, so the caller can leave the entry
 * untouched.
 *
 * Pure and plain-JS: the admin page embeds this source and the tests import this
 * function, so what is tested is what runs.
 */
/** Every field whose stored value is a CSS colour. One entry today; a list so
    17C-b can add the Business Forum fields without touching the guard. */
const COLOUR_FIELD_NAMES = ["image_background"];

function canonicalColour(value) {
  if (typeof value !== "string") return null;
  var v = value.trim().toLowerCase();
  if (!v) return null;
  if (v.charAt(0) !== "#") v = "#" + v;
  if (/^#[0-9a-f]{3}$/.test(v)) {
    v = "#" + v.charAt(1) + v.charAt(1) + v.charAt(2) + v.charAt(2) + v.charAt(3) + v.charAt(3);
  }
  if (!/^#[0-9a-f]{6}$/.test(v)) return null;      // not a colour — not ours to fix
  return v === value ? null : v;                    // already canonical?
}

const SECTIONS_HELP =
  "TWO LEVELS OF EDITING. Changing the words inside a section — a paragraph, a " +
  "heading, an image description — is ordinary and safe. ADDING, REMOVING or " +
  "REORDERING sections is an advanced change, because the same change must be " +
  "made in all three lists: Section structure, English sections and Polish " +
  "sections. They are matched by position, and the CMS does NOT keep them in " +
  "step for you. If they stop matching, the save is refused and nothing is lost.";

/* ---------------------------------------------------------------------------
   Standard event sections — the alignment guard.
   --------------------------------------------------------------------------- */

/**
 * Check that a standard event's three section arrays still describe the same
 * sections in the same order.
 *
 * WHY THIS EXISTS
 * ---------------
 * A standard event stores its sections as THREE parallel arrays:
 *
 *   sections[]      shared structure — type, layout, gallery image paths
 *   en.sections[]   the English prose, headings and gallery alt text
 *   pl.sections[]   the Polish equivalents
 *
 * src/event.njk pairs them strictly by index (`c.sections[loop.index0]`), so
 * position N in all three must describe the same section. Decap has no way to
 * keep three lists in step: an editor who adds a section to one and not the
 * others produces a record whose Polish page silently renders the wrong content
 * — or nothing at all.
 *
 * This is deliberately a BLOCKING check and never a repair. Inserting a missing
 * section, deleting an unmatched one, reordering an array or copying one
 * language into the other would all "fix" the save while destroying or
 * fabricating content. Refusing to save loses nothing: the editor still has
 * their work on screen.
 *
 * Pure and plain-JS on purpose: the admin page embeds this exact source and
 * scripts/test-event-rules.js imports this exact function, so the behaviour that
 * is tested is the behaviour that ships.
 *
 * @param {object} data  the event record as the form currently holds it
 * @returns {string|null} an editor-facing message, or null when aligned
 */
function checkEventSectionAlignment(data) {
  if (!data || data.event_family !== "standard") return null;

  var shared = data.sections;
  var en = data.en && data.en.sections;
  var pl = data.pl && data.pl.sections;

  // A standard event with no sections at all is a different problem, and the
  // repository validator reports it. Nothing to compare here.
  if (!Array.isArray(shared) || !Array.isArray(en) || !Array.isArray(pl)) return null;

  var header = "Event sections are out of alignment.\n\n";
  var footer = "\n\nAll three section lists must describe the same section in the " +
    "same position. The event has not been saved.";

  /* -- 1. counts ----------------------------------------------------------- */

  if (shared.length !== en.length || shared.length !== pl.length) {
    var msg = header +
      "Shared sections: " + shared.length + "\n" +
      "English sections: " + en.length + "\n" +
      "Polish sections: " + pl.length + "\n";

    var most = Math.max(shared.length, en.length, pl.length);
    var missing = [];
    if (shared.length < most) missing.push("Shared structure is missing section " + (shared.length + 1));
    if (en.length < most) missing.push("English is missing section " + (en.length + 1));
    if (pl.length < most) missing.push("Polish is missing section " + (pl.length + 1));
    if (missing.length) msg += "\n" + missing.join("\n");
    return msg + footer;
  }

  /* -- 2. the type sequence ------------------------------------------------- */

  for (var i = 0; i < shared.length; i++) {
    var s = (shared[i] || {}).type;
    var e = (en[i] || {}).type;
    var p = (pl[i] || {}).type;
    if (s === e && s === p) continue;
    return header +
      "Section " + (i + 1) + ":\n" +
      "Shared structure: " + (s || "(none)") + "\n" +
      "English structure: " + (e || "(none)") + "\n" +
      "Polish structure: " + (p || "(none)") +
      "\n\nCorrect the section that does not match, or undo the structural change" +
      " before saving." + footer;
  }

  /* -- 3. gallery alt-text parity ------------------------------------------- */
  /* The images live in the shared section; their alt text lives in each locale.
   * If those drift, a photograph loses its accessible description in one
   * language — a silent accessibility regression that nothing else would catch. */

  for (var j = 0; j < shared.length; j++) {
    if ((shared[j] || {}).type !== "gallery") continue;
    var images = (shared[j].images || []).length;
    var enAlts = ((en[j] || {}).alts || []).length;
    var plAlts = ((pl[j] || {}).alts || []).length;
    if (images === enAlts && images === plAlts) continue;
    return header +
      "Section " + (j + 1) + " is a gallery, and its descriptions do not match its images.\n\n" +
      "Images: " + images + "\n" +
      "English descriptions: " + enAlts + "\n" +
      "Polish descriptions: " + plAlts +
      "\n\nEvery image needs one description in each language, in the same order," +
      " or a photograph will be left with no description for screen readers." +
      footer;
  }

  return null;
}

/* ---------------------------------------------------------------------------
   Announcement fields.

   Order matches the canonical records, so a save produces a readable diff
   rather than a whole-file reshuffle.
   --------------------------------------------------------------------------- */

/**
 * The finite value sets the announcement templates understand.
 *
 * These mirror SUPPORTED_FIT and SUPPORTED_LINK_TYPES in scripts/validate.js.
 * They are duplicated rather than imported because that file is a script that
 * exits when required; scripts/validate-cms.js asserts the two stay identical,
 * so the copy cannot drift unnoticed.
 */
const SUPPORTED_IMAGE_FIT = ["contain"];
const SUPPORTED_LINK_TYPES = ["event", "page", "external"];

/**
 * The link types the CMS actually offers, plus the editor-only "none".
 *
 * `page` is a valid stored type and the repository still accepts it, but no
 * announcement uses it and it has no destination field or validation of its own,
 * so offering it would let an editor create a state nothing checks.
 *
 * NONE is editor-only. It exists because Decap gave no reliable way to clear an
 * optional select — see docs/CMS_ANNOUNCEMENTS.md §11 — so "no link" has to be a
 * value the editor can positively choose. normaliseAnnouncementLink() turns it
 * into the canonical `link: null` before anything is written, and it is never
 * stored. If it ever were, scripts/validate.js rejects it by name, which is the
 * correct way for a failed normalisation to surface.
 */
const LINK_TYPE_NONE = "none";
const OFFERED_LINK_TYPES = [LINK_TYPE_NONE, "event", "external"];

/* ---------------------------------------------------------------------------
   Registration — announcements.
   --------------------------------------------------------------------------- */

const REGISTRATION_NONE = "none";

/**
 * The four states an announcement's sign-ups can be in.
 *
 * `none` is a real state, not a missing value: most announcements are notices
 * with nothing to sign up for, and saying so explicitly is what lets the other
 * three mean something.
 *
 * Order matters only for the dropdown, which reads as a life cycle: nothing,
 * then not yet, then now, then over.
 */
const REGISTRATION_STATES = [REGISTRATION_NONE, "coming_soon", "open", "closed"];

/**
 * What the event picker shows for each event.
 *
 * A constant because two things depend on it agreeing exactly: Decap renders it
 * as the option label, and eventRegistrationIndex() below renders the same
 * string as the key an editor's choice is looked up by. Written twice, the
 * preview would go blank the first time somebody adjusted the wording.
 */
const EVENT_PICKER_LABEL = "{{en.timeline_title}} — {{start_date}}";

/** What a record with no registration looks like on disk. */
const CANONICAL_REGISTRATION_NONE = Object.freeze({
  state: REGISTRATION_NONE, url: null, opens_on: null, closes_on: null,
});

/**
 * The four registration controls, shared by Announcements and Standard Events.
 *
 * Phase 17C.5A.2 gave standard events a real registration section. Writing a
 * second set of controls would have produced two definitions of "open" that
 * drift the first time one is changed, so both collections build their fields
 * here and both are validated by normaliseRegistration() below.
 *
 * Only the wording differs, because the sentence that helps an editor is not
 * the same on an event page as on an announcement card.
 *
 * @param {"event"|"announcement"} kind
 */
function registrationFields(kind) {
  const onEvent = kind === "event";
  const thing = onEvent ? "event" : "announcement";
  return [
    {
      label: "Registration status",
      name: "state",
      widget: "select",
      required: false,
      default: REGISTRATION_NONE,
      options: REGISTRATION_STATES.map((v) => ({
        label: v === "none" ? "No registration — no sign-up button"
          : v === "coming_soon" ? "Coming soon — sign-ups have not opened"
            : v === "open" ? "Open — people can register now"
              : "Closed — sign-ups have ended",
        value: v,
      })),
      hint: "You choose this. It does NOT change on its own when a date passes: " +
        "the website is built as fixed files, so a status that changed by itself " +
        `would be wrong until somebody rebuilt the site. Blank means no ` +
        `registration, which is normal for most ${thing}s.`,
    },
    {
      label: "Registration web address",
      name: "url",
      widget: "string",
      required: false,
      // https only. This becomes a button rendered into the page, so other
      // schemes must not be reachable.
      pattern: [HTTPS_URL_OR_EMPTY,
        "Must be a full https:// address, or leave it empty."],
      hint: "Needed only when the status is Open — that is what the Register " +
        "button points at. Ignored for the other statuses.",
    },
    dateOnlyField("opens_on", "Sign-ups open on", false,
      "Optional. Shown to readers when sign-ups have not opened yet. " +
      "Setting it does NOT open registration — change the status for that."),
    dateOnlyField("closes_on", "Sign-ups close on", false,
      "Optional. Shown to readers as a deadline. Setting it does NOT close " +
      "registration — change the status for that."),
  ];
}

/**
 * Put a registration block into its canonical shape, or report why it cannot be.
 *
 * Two jobs, deliberately in one place so the CMS guard and the validator cannot
 * disagree about what a valid registration is:
 *
 *   - TIDYING. Decap keeps every sub-field it has ever shown, so an editor who
 *     types a URL, then switches the status to Closed, would otherwise leave a
 *     live sign-up address in a record that claims to be closed. Only the fields
 *     that belong to the chosen state survive; the rest become null. Cleared
 *     dates arrive as "" from the date picker and become null here too.
 *
 *   - REFUSING. Some combinations cannot be rendered honestly — Open with no
 *     address gives a Register button that goes nowhere, and a closing date
 *     before the opening date describes a sign-up that was never open.
 *
 * @returns {{registration: object}|{error: string}}
 *
 * Pure and plain-JS: the admin page embeds this source and the tests import this
 * function, so what is tested is what runs.
 */
function normaliseRegistration(raw) {
  var r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

  /*
    WHERE DOES THIS REGISTRATION COME FROM? (Phase 17C.5A.2)

    An announcement may either describe its own sign-up or point at a Federation
    event that owns one. Pointing means storing a REFERENCE and nothing else —
    copying the event's status, address and dates into the announcement would
    create two copies of one fact, and they would drift the first time somebody
    changed the event.

    `source: "own"` is never written. An absent source already means "its own",
    which is what all twenty-eight migrated records mean, so they needed no
    rewriting and a newly saved announcement keeps the same minimal shape.
  */
  /*
    NOTHING TO SIGN UP FOR (Phase 17C.5A.3).

    Chosen explicitly rather than reached by leaving the status blank, so the
    editor answers one question instead of meeting four controls they do not
    need. Whatever the draft still carries from an earlier choice is dropped —
    that is the same tidying the states below get, applied to the whole block.

    The stored shape is the canonical empty one, with no source key: identical
    to what the twenty-eight migrated announcements already contain, so this
    choice never rewrites a record into a new dialect.
  */
  if (String(r.source || "") === "none") {
    return { registration: { state: REGISTRATION_NONE, url: null,
      opens_on: null, closes_on: null } };
  }

  if (String(r.source || "") === "event") {
    var eventSlug = typeof r.event_slug === "string" ? r.event_slug.trim() : "";
    if (!eventSlug) {
      return { error:
        "Registration is set to come from a Federation event, but no event is " +
        "selected.\n\nChoose the event, or change registration to Other event " +
        "to enter the details here." };
    }
    // Only the reference is stored. The status, address and dates live on the
    // event and are read from it at build time.
    return { registration: { source: "event", event_slug: eventSlug } };
  }

  var state = typeof r.state === "string" && r.state ? r.state : REGISTRATION_NONE;
  if (REGISTRATION_STATES.indexOf(state) === -1) {
    return { error: 'Unknown registration status "' + state + '".' };
  }

  var blank = function (v) {
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  };
  var text = function (v) { return blank(v) ? null : String(v).trim(); };

  var url = text(r.url);
  var opens = text(r.opens_on);
  var closes = text(r.closes_on);

  // Only "open" keeps an address. Every other state is a statement, not a link,
  // so a leftover URL is dropped rather than carried into a closed record.
  if (state !== "open") url = null;

  if (state === "open") {
    if (!url) {
      return { error:
        "Registration is set to Open, but there is no registration web address.\n\n" +
        "Add the address people should use to sign up, or change the status to " +
        "Coming soon while you wait for it." };
    }
    if (!/^https:\/\/[^\s"'<>]+$/.test(url)) {
      return { error:
        'The registration web address must start with https:// — "' + url +
        '" does not.\n\nThis becomes a button on the public website, so it has ' +
        "to be a normal secure web address." };
    }
  }

  var isDate = function (v) { return v === null || /^\d{4}-\d{2}-\d{2}$/.test(v); };
  if (!isDate(opens) || !isDate(closes)) {
    return { error: "Sign-up dates must be a calendar day chosen from the picker." };
  }
  if (opens && closes && opens > closes) {
    // Plain string comparison is correct for YYYY-MM-DD and avoids timezones.
    return { error:
      "Sign-ups cannot close before they open.\n\n" +
      "Opening date: " + opens + "\nClosing date: " + closes };
  }

  return { registration: { state: state, url: url, opens_on: opens, closes_on: closes } };
}

/**
 * Reduce a link to exactly one destination, or to nothing.
 *
 * THE WHOLE POINT: an editor who picks a Federation event and then changes their
 * mind must not leave the event slug behind. Decap's object widget keeps every
 * sub-field it has ever been given, so without this a record could end up
 * carrying both an event and a URL — a state the canonical records never contain
 * and that scripts/cms-check.js rightly calls impossible.
 *
 * Pure and plain-JS on purpose: the admin page embeds this exact source and
 * scripts/test-announcement-rules.js requires this exact function, so the tested
 * behaviour and the shipped behaviour cannot drift apart.
 *
 * @param {object|null|undefined} link  the link as the form currently holds it
 * @returns {object|null} the canonical link, or null for "no link"
 */
function normaliseAnnouncementLink(link) {
  if (!link || typeof link !== "object") return null;

  var type = link.type;
  if (!type || type === "none") return null;

  if (type === "event") {
    // Only a slug survives. A stale external URL is dropped, and an event
    // choice that was never made is not a link at all.
    if (!link.event_slug) return null;
    return { type: "event", event_slug: link.event_slug };
  }

  if (type === "external") {
    var url = typeof link.url === "string" ? link.url.trim() : "";
    if (!url) return null;
    return { type: "external", url: url };
  }

  // An unrecognised type is passed through untouched rather than silently
  // discarded: dropping a destination nobody asked to remove would be worse
  // than letting the validator report it.
  return link;
}

const ANN_SLUG_HINT =
  "The unique identifier for THIS announcement. It becomes the filename, so it " +
  "must not match one that already exists. Use lowercase words joined by hyphens, " +
  "for example spring-careers-evening. If you are running the same campaign again " +
  "in a later academic year, leave the old announcement alone and create a new one " +
  "with a different ID, for example spring-careers-evening-2026-27.";

const ANN_YEAR_HINT =
  "The academic year this announcement belongs to, e.g. 2025/26. Announcements " +
  "from earlier years stay in the archive exactly as they are — never change this " +
  "on an old announcement to reuse it. Preparing next year's announcements early " +
  "is fine: they stay invisible until the current academic year is changed in " +
  "Site settings.";

const ANN_BODY_HINT =
  "Markdown: blank line between paragraphs, **bold**, *italic*, [link](https://…), " +
  "and - for bullet points. HTML is deliberately not supported and will show as " +
  "literal text rather than being rendered.";

function announcementFields() {
  return [
    {
      label: "Record ID — must be unique",
      name: "slug",
      widget: "string",
      required: true,
      hint: ANN_SLUG_HINT,
      pattern: ["^[a-z0-9]+(-[a-z0-9]+)*$",
        "Lowercase letters, numbers and single hyphens only."],
    },
    academicYearField("academic_year", "Academic year", ANN_YEAR_HINT),
    dateOnlyField("published_date", "Publication date", true,
      "Pick the date from the calendar. Stored as year-month-day, e.g. 2026-05-14."),
    {
      label: "Display position",
      name: "order",
      widget: "number",
      required: true,
      value_type: "int",
      min: 1,
      step: 1,
      hint: "1 appears first. Positions are counted within this academic year only, " +
        "so next year's announcements start again at 1.",
    },
    {
      label: "Published",
      name: "published",
      widget: "boolean",
      required: false,
      default: true,
      hint: "Unpublish to hide an announcement without deleting it. This is separate " +
        "from the academic year: a future year's announcement is already hidden.",
    },
    {
      label: "Main image",
      name: "image",
      widget: "image",
      required: false,
      media_folder: "/assets/announcements",
      public_folder: "/assets/announcements",
      choose_url: false,
      hint: "Optional. Announcements without an image render a text-only card.",
    },
    {
      /*
        A VISUAL control since Phase 17C.3.

        This was a free-text box in which an editor was expected to type
        `center 30%`. That is CSS, and asking a non-technical editor to write it
        — with no way to see what it did — was the clearest example of the
        interface leaking its implementation.

        The stored value is UNCHANGED: still the same object-position string the
        live site's generated data file already holds. That is deliberate. The
        announcement comparison checks those strings byte for byte against the
        published site, so re-expressing "center 30%" as "50% 30%" would rewrite
        published output to say exactly the same thing differently. The widget
        parses the string, edits it as two percentages, and writes it back.

        Both frames are shown because ONE stored value serves two different
        crops — the listing card and the pop-up are not the same shape — and an
        editor choosing a focus should see the compromise they are making rather
        than discover it later.
      */
      label: "Image focus",
      name: "image_position",
      widget: "focalPoint",
      required: false,
      image_field: "image",
      value_format: "css",
      frames: [
        // Measured from css/style.css: `.ann-card .ph` and `.modal-panel .ph`.
        { label: "On the listing card", ratio_w: 16, ratio_h: 10 },
        { label: "In the pop-up", ratio_w: 16, ratio_h: 8 },
      ],
      hint: "Which part of the picture matters most. The website crops images to " +
        "fit, and this keeps the important part in view. Leave it centred unless " +
        "something is being cut off. Note: this has no effect while Image fit is " +
        "set to Contain, because the whole picture is shown.",
    },
    {
      label: "Image fit",
      name: "image_fit",
      widget: "select",
      required: false,
      options: [...SUPPORTED_IMAGE_FIT].map((v) => ({ label: "Contain (show the whole image)", value: v })),
      hint: "Leave empty for the normal cropped fit. Choose Contain for posters and " +
        "graphics that must not be cropped.",
    },
    {
      // The ONE field in the current CMS whose stored value is genuinely a CSS
      // colour, so the only place the Brand colour control belongs today. The
      // widget is written to be reused — Business Forum colour fields can adopt
      // it in 17C-b without changing it — but inventing colour fields elsewhere
      // merely for consistency would add controls nothing renders.
      label: "Image backdrop colour",
      name: "image_background",
      widget: "brandColour",
      required: false,
      hint: "Optional. Fills the space around an image set to Contain — useful " +
        "when a logo or poster would otherwise sit on white. Pick one of the " +
        "site's colours, or set your own.",
    },
    {
      label: "Extra images",
      name: "extra_images",
      // A list of plain paths, matching the canonical records exactly. Decap's
      // list widget preserves order, and drag-to-reorder is what an editor needs.
      widget: "list",
      required: false,
      field: {
        label: "Image",
        name: "image",
        widget: "image",
        media_folder: "/assets/announcements",
        public_folder: "/assets/announcements",
        choose_url: false,
      },
      hint: "Shown in the announcement pop-up after the main image, in this order. " +
        "Drag to reorder.",
    },
    /*
      REGISTRATION — separate from the destination link below.

      These are two different things and used to be conflated. "Where do I read
      more about this?" and "how do I sign up?" can both apply to one
      announcement, can point at different places, and can change independently:
      a talk can have its programme on the Federation's own event page while
      registration runs on an external form.

      This replaced a single `signups_closed` on/off switch, which could only
      express "closed" and had no way to say "opens next week" or "sign up here".

      The state is ALWAYS an explicit editorial decision — see the hint. The site
      is built as static files, so nothing re-renders when a date passes; a state
      that flipped itself would simply be wrong until somebody rebuilt.
    */
    {
      label: "Registration",
      name: "registration",
      widget: "object",
      required: false,
      collapsed: false,
      hint: "Whether people can sign up, and where. This is separate from the " +
        "destination link below — an announcement may have both a link to the " +
        "details and a registration button.",
      /*
        WHERE THE REGISTRATION COMES FROM (Phase 17C.5A.2).

        A Federation event owns its registration. An announcement about that
        event points at it rather than repeating it, so the two can never say
        different things. Choosing the Federation event stores nothing but the
        reference; the status, address and dates are read from the event.

        The event picker is Decap's documented `relation` widget, which reads
        the collection through the backend — so an event saved a minute ago
        appears without rebuilding the CMS.
      */
      fields: [
        {
          label: "Where registration is handled",
          name: "source",
          widget: "select",
          required: false,
          default: "none",
          options: [
            { label: "No registration — nothing to sign up for", value: "none" },
            { label: "A Federation event — use that event's registration", value: "event" },
            { label: "This announcement — enter the details here", value: "own" },
          ],
          hint: "Most announcements need nothing here. Choose the Federation " +
            "event when this announcement is about one — its status and dates " +
            "are then managed on the event and this announcement follows them, " +
            "including sign-ups that have not opened yet.",
        },
        {
          label: "Federation event",
          name: "event_slug",
          widget: "relation",
          required: false,
          collection: "standard_events",
          value_field: "slug",
          // What the editor reads in the list. The date distinguishes annual
          // editions of an event that share a name.
          display_fields: [EVENT_PICKER_LABEL],
          search_fields: ["en.timeline_title", "slug", "start_date"],
          options_length: 20,
          hint: "Every Federation event can be chosen, including ones whose " +
            "sign-ups have not opened yet — this announcement will show a " +
            "registration panel as soon as the event has one.",
        },
      ].concat(registrationFields("announcement")),
    },
    {
      label: "Destination link",
      name: "link",
      widget: "object",
      required: false,
      collapsed: false,
      hint: "Only the field matching the chosen destination is saved. Whatever you " +
        "leave in the other one is discarded, so switching destinations is safe.",
      fields: [
        {
          label: "Link destination",
          name: "type",
          widget: "select",
          required: false,
          // "No link" first, and offered as a real choice rather than as an
          // empty select: it is how an editor undoes a destination.
          options: OFFERED_LINK_TYPES.map((v) => ({
            label: v === LINK_TYPE_NONE ? "No link — no button on the card"
              : v === "event" ? "Federation event"
                : "External website",
            value: v,
          })),
          default: LINK_TYPE_NONE,
          // Decap applies `default` only to NEW records. Reopening an existing
          // announcement that has no link leaves this select visibly blank,
          // because there is no link object to read a value from. The stored
          // shape is deliberately `link: null` rather than an object full of
          // empty strings, so the blank is explained rather than designed away.
          hint: "Blank means this announcement has no button — that is normal for " +
            "an announcement saved without a destination. Choose No link to remove " +
            "a destination you added by mistake. Federation event keeps the " +
            "reader's language automatically.",
        },
        {
          label: "Federation event",
          name: "event_slug",
          widget: "select",
          required: false,
          options: eventLinkOptions(),
          hint: "Used ONLY when the destination is Federation event. The English page " +
            "links to the English event and the Polish page to the Polish one. " +
            "Ignored and discarded for any other destination.",
        },
        {
          label: "External web address",
          name: "url",
          widget: "string",
          required: false,
          // https only. javascript:, data: and file: cannot match, which is the
          // point: an announcement button is rendered into the page.
          pattern: [HTTPS_URL,
            "Must be a full https:// address. Other schemes are not accepted."],
          hint: "Used ONLY when the destination is External website. Must start with " +
            "https:// — ignored and discarded for any other destination.",
        },
      ],
    },
    {
      label: "English",
      name: "en",
      widget: "object",
      required: true,
      collapsed: false,
      fields: [
        { label: "Title", name: "title", widget: "string", required: true },
        {
          label: "Summary", name: "subtitle", widget: "string", required: true,
          hint: "One sentence, shown on the card under the title.",
        },
        {
          label: "Body", name: "body", widget: "markdown", required: true,
          hint: ANN_BODY_HINT,
          // The rendered preview is what an editor reads; raw HTML must not be
          // offered anywhere, so the toolbar is limited to what markdown-it
          // renders with html:false.
          buttons: ["bold", "italic", "link", "bulleted-list", "numbered-list", "quote"],
          editor_components: [],
          modes: ["rich_text"],
        },
        {
          label: "Button label", name: "link_label", widget: "string", required: false,
          hint: "Only needed when there is a destination link, e.g. Read more.",
        },
      ],
    },
    {
      label: "Polski",
      name: "pl",
      widget: "object",
      required: true,
      collapsed: false,
      fields: [
        { label: "Tytuł", name: "title", widget: "string", required: true },
        {
          label: "Podsumowanie", name: "subtitle", widget: "string", required: true,
          hint: "Jedno zdanie widoczne na karcie pod tytułem.",
        },
        {
          label: "Treść", name: "body", widget: "markdown", required: true,
          hint: "Markdown: pusty wiersz między akapitami, **pogrubienie**, *kursywa*, " +
            "[odnośnik](https://…), - dla list. HTML nie jest obsługiwany.",
          buttons: ["bold", "italic", "link", "bulleted-list", "numbered-list", "quote"],
          editor_components: [],
          modes: ["rich_text"],
        },
        {
          label: "Etykieta przycisku", name: "link_label", widget: "string", required: false,
          hint: "Potrzebna tylko wtedy, gdy jest odnośnik docelowy.",
        },
      ],
    },
  ];
}

/* ---------------------------------------------------------------------------
   Standard event fields.
   --------------------------------------------------------------------------- */

const EVENT_SLUG_HINT =
  "The unique identifier for THIS edition of the event. It becomes the filename, " +
  "so it must not match one that already exists. A recurring event gets a NEW " +
  "record each year: christmas-dinner for 2025/26, then christmas-dinner-2026-27 " +
  "for the next. The earlier edition stays exactly as it is.";

/*
  ANY FULL https:// ADDRESS, WRITTEN ONCE.

  Four fields ask this question — two registration addresses, the photo album,
  and an announcement's external link — and they used to each carry their own
  copy of the answer. Three were right and one was not: it had `[^\s...` with a
  single backslash, and in a double-quoted JS string that backslash is dropped,
  so the class stopped meaning "no whitespace" and started meaning "not the
  letter s".

  It still compiled, and it still looked correct. What it did was reject every
  address containing an s — forms.gle, docs.google.com, anything ending
  /register — while telling the editor their address was not a full https one.
  A copy that drifts is the whole reason this is a constant now.

  DELIBERATELY PERMISSIVE. This is Decap's inline check, and its job is to catch
  an obvious slip while somebody types. What an address really has to be is
  decided by netlify/lib/rules.js, which parses it rather than matching it, and
  refuses the save. No list of allowed hosts appears in either: the Federation
  links to whatever service an event actually uses.
*/
const HTTPS_URL = "^https://[^\\s\"'<>]+$";
const HTTPS_URL_OR_EMPTY = HTTPS_URL + "|^$";

const EVENT_YEAR_HINT =
  "The academic year this edition belongs to, e.g. 2025/26. Never change this on " +
  "a past event to reuse it — that would erase that year from the archive. " +
  "You CAN prepare next year's events early, but switch Published OFF until the " +
  "new season starts: the events listing refuses to build a published event whose " +
  "year is later than the current one.";

/** Localised section entries. Types mirror the shared list exactly. */
function localisedSectionTypes(lang) {
  const t = (en, pl) => (lang === "pl" ? pl : en);
  return [
    {
      label: t("Paragraphs", "Akapity"), name: "prose",
      fields: [
        { label: "type", name: "type", widget: "hidden", default: "prose" },
        {
          label: t("Text", "Tekst"), name: "body", widget: "markdown", required: true,
          hint: t("Markdown. HTML is not rendered and would show as literal text.",
            "Markdown. HTML nie jest obsługiwany."),
          buttons: ["bold", "italic", "link", "bulleted-list", "numbered-list", "quote"],
          editor_components: [], modes: ["rich_text"],
        },
      ],
    },
    {
      label: t("Heading", "Nagłówek"), name: "heading",
      fields: [
        { label: "type", name: "type", widget: "hidden", default: "heading" },
        { label: t("Small label above", "Etykieta nad nagłówkiem"), name: "eyebrow", widget: "string", required: false },
        { label: t("Heading — before highlighted part", "Nagłówek — przed wyróżnieniem"), name: "title_lead", widget: "string", required: false },
        { label: t("Highlighted part", "Wyróżniona część"), name: "title_fancy", widget: "string", required: false },
      ],
    },
    {
      label: t("Photo gallery", "Galeria zdjęć"), name: "gallery",
      fields: [
        { label: "type", name: "type", widget: "hidden", default: "gallery" },
        {
          label: t("Image descriptions", "Opisy zdjęć"), name: "alts",
          widget: "list", required: false,
          field: { label: t("Description", "Opis"), name: "alt", widget: "string" },
          hint: t("One description per image, in the same order as the images in " +
            "Section structure. Used by screen readers.",
            "Jeden opis na zdjęcie, w tej samej kolejności co zdjęcia w strukturze sekcji."),
        },
      ],
    },
    {
      label: t("Photo album link", "Odnośnik do albumu"), name: "album",
      fields: [{ label: "type", name: "type", widget: "hidden", default: "album" }],
    },
    {
      label: "Instagram", name: "instagram",
      fields: [{ label: "type", name: "type", widget: "hidden", default: "instagram" }],
    },
  ];
}

/** The localised half of a standard event. */
function eventLocaleFields(lang) {
  const t = (en, pl) => (lang === "pl" ? pl : en);
  const fields = [
    {
      label: t("Title — before highlighted part", "Tytuł — przed wyróżnieniem"),
      name: "title_lead", widget: "string", required: false,
      hint: t("The title is assembled from up to three parts with single spaces " +
        "between them. Do not add spaces yourself.",
        "Tytuł składa się z maksymalnie trzech części oddzielonych pojedynczą spacją."),
    },
    {
      label: t("Highlighted part of title", "Wyróżniona część tytułu"),
      name: "title_fancy", widget: "string", required: false,
      hint: t("Shown in the accent style. Leave empty for a plain title.",
        "Wyświetlana w stylu akcentowanym. Zostaw puste dla zwykłego tytułu."),
    },
    {
      label: t("Title — after highlighted part", "Tytuł — po wyróżnieniu"),
      name: "title_tail", widget: "string", required: false,
      hint: t("Only needed when the highlighted part sits in the middle, " +
        'e.g. Annual / Christmas / Dinner.', "Potrzebne tylko, gdy wyróżnienie jest w środku."),
    },
    { label: t("Kind of event", "Rodzaj wydarzenia"), name: "eyebrow", widget: "string", required: false,
      hint: t('The small line above the title — for example "Annual tradition" or "Conference".',
        'Mała linia nad tytułem — na przykład „Doroczna tradycja”.') },
    /*
      BOILERPLATE, hidden from the editor (Phase 17C.4).

      All four events carry identical values for these — "Date"/"Data",
      "Venue"/"Miejsce" — because they are the headings of the facts panel, not
      anything about a particular event. Asking an editor to retype them on every
      new event was asking them to maintain the template.

      Hidden rather than deleted: `widget: "hidden"` keeps the existing value on
      an existing record and writes the default on a new one, which is the same
      pattern `event_family`, `template` and `organiser` have always used here.
      The stored files are unchanged.
    */
    { label: "Date label", name: "date_label", widget: "hidden", default: t("Date", "Data") },
    { label: "Venue label", name: "venue_label", widget: "hidden", default: t("Venue", "Miejsce") },
    /*
      ONE SUMMARY FOR AN ORDINARY EVENT (Phase 17C.5A).

      An editor used to write two descriptions here and a third for the homepage,
      plus two more for search engines. An inventory of the four existing events
      showed those are NOT duplicates — each carries deliberately different
      wording in both languages — so nothing was merged and nothing was deleted.

      Instead this new field became the source, and the two that were here became
      optional overrides below. A new event needs Summary alone; the existing
      four keep every authored variant, and their pages are byte-identical.
      See src/_data/eventText.js for the fallback chain.
    */
    { label: t("Summary", "Podsumowanie"), name: "summary", widget: "text", required: false,
      hint: t("A concise description of the event. Used on the Events page and near " +
        "the top of the event page unless a custom version is set below.",
      "Zwięzły opis wydarzenia. Używany na stronie Wydarzenia i u góry strony " +
        "wydarzenia, chyba że poniżej ustawiono własną wersję.") },
    { label: t("Event-page introduction — custom", "Wstęp na stronie wydarzenia — własny"),
      name: "hero_summary", widget: "text", required: false,
      hint: t("Optional. Leave empty to use the Summary.",
        "Opcjonalne. Zostaw puste, aby użyć Podsumowania.") },
    { label: t("Events-card description — custom", "Opis na karcie — własny"),
      name: "card_summary", widget: "text", required: false,
      hint: t("Optional. Leave empty to use the Summary.",
        "Opcjonalne. Zostaw puste, aby użyć Podsumowania.") },
    { label: t("Main image — alternative text", "Zdjęcie główne — tekst alternatywny"),
      name: "card_image_alt", widget: "string", required: true,
      hint: t("Describe what matters in the photograph for someone who cannot see it.",
        "Opisz, co jest ważne na zdjęciu, dla osoby, która go nie widzi.") },
    { label: t("Short title for the homepage timeline", "Krótki tytuł na oś czasu"), name: "timeline_title", widget: "string", required: true,
      hint: t("The concise label the homepage uses — usually shorter than the full title.",
        "Zwięzła etykieta używana na stronie głównej.") },
    /*
      A genuinely tighter context, so it keeps its own field: the inventory
      measured 77–109 characters here against 160–200 for card text. Optional
      now, falling back to the card summary rather than to nothing.
    */
    { label: t("Short homepage description", "Krótki opis na stronie głównej"),
      name: "timeline_summary", widget: "text", required: false,
      hint: t("Shown on the homepage timeline, where space is tight — aim for about " +
        "100 characters. Leave empty to reuse the card description.",
      "Pokazywany na osi czasu na stronie głównej — około 100 znaków. " +
        "Zostaw puste, aby użyć opisu z karty.") },
    {
      label: t("Quick information", "Krótkie informacje"), name: "facts",
      widget: "list", required: false,
      // The summary is what the collapsed row shows. "Attendance — 100 students"
      // tells an editor which fact they are looking at; "1 key facts" did not.
      summary: "{{fields.label}} — {{fields.value}}",
      label_singular: t("fact", "informacja"),
      hint: t("Optional short facts shown near the top of the event page — for " +
        'example "Attendance" and "100 students".',
      "Krótkie informacje pokazywane u góry strony wydarzenia."),
      fields: [
        { label: t("Name", "Nazwa"), name: "label", widget: "string" },
        { label: t("Detail", "Szczegół"), name: "value", widget: "string" },
      ],
    },
    /*
      CO-ORGANISERS HEADING — a genuine override, but a rare one.

      Three of the four events store nothing here and fall back to the template's
      own heading; one says "In collaboration with" / "We współpracy z". So it is
      real editorial content and cannot simply be hidden — but it does not belong
      loose in the main form either. It stays optional, is named for what it does,
      and explains what happens when it is left empty.
    */
    { label: t("Custom heading for co-organisers", "Własny nagłówek współorganizatorów"),
      name: "co_organisers_label", widget: "string", required: false,
      hint: t("Optional. Leave empty to use the standard heading.",
        "Opcjonalne. Zostaw puste, aby użyć standardowego nagłówka.") },
    /*
      THE PHOTO ALBUM PANEL — and a real bug fixed on the way.

      This was declared as a plain string called "Album button label", but the
      two events that have an album store an OBJECT:
      { heading, text, label }. Opening one of those events in the CMS and saving
      it would have handed an object to a text control. The contents are genuine
      editorial writing — a heading, a sentence and a button label, different for
      each event — so they are now three named fields, beside the album address
      in the "Photo album" section.
    */
    {
      label: t("Photo album panel", "Panel albumu"), name: "album",
      widget: "object", required: false, collapsed: true,
      hint: t("Only for events with a photo album. Leave empty otherwise.",
        "Tylko dla wydarzeń z albumem. W innym razie zostaw puste."),
      fields: [
        { label: t("Heading", "Nagłówek"), name: "heading", widget: "string", required: false },
        { label: t("Introduction", "Wprowadzenie"), name: "text", widget: "text", required: false },
        { label: t("Button text", "Tekst przycisku"), name: "label", widget: "string", required: false },
      ],
    },
    /*
      NAVIGATION BOILERPLATE, hidden from the editor (Phase 17C.4).

      All four events carry the same two strings — "← All events" and
      "← Back to all events", and their Polish equivalents. They are the page's
      own navigation, not content about the event, and nobody should have to
      maintain two copies of a back link per language per event.
    */
    { label: "Back link", name: "back_link", widget: "hidden",
      default: t("← All events", "← Wszystkie wydarzenia") },
    { label: "Back link at the foot of the page", name: "back_link_bottom", widget: "hidden",
      default: t("← Back to all events", "← Wróć do wszystkich wydarzeń") },
    /*
      THE MAIN BODY (Phase 17C.5A.3).

      This replaces the localised half of the three parallel section arrays. An
      editor writes the description here as ordinary formatted text; the page
      template owns where everything sits.

      `richtext` rather than the older markdown widget: it opens as a WYSIWYG
      editor, so nobody has to know Markdown to write a paragraph, add a link or
      mark a sentence as important. What is stored is still Markdown, which is
      what the build already renders safely with raw HTML disabled.
    */
    {
      label: t("Main body", "Treść główna"), name: "body",
      widget: "richtext", required: false,
      // Only the formatting an event description actually needs. No code
      // blocks, and no H1 — the event title is already the page's H1.
      modes: ["rich_text"],
      buttons: ["bold", "italic", "link", "heading-two", "quote",
        "bulleted-list", "numbered-list"],
      editor_components: ["image"],
      hint: t("The full description of the event. Use Quote for an important " +
        "statement you want to stand out, and add photographs between " +
        "paragraphs where they help.",
      "Pełny opis wydarzenia. Użyj cytatu, aby wyróżnić ważne zdanie, i dodaj " +
        "zdjęcia pomiędzy akapitami."),
    },
    /* -- search engines and social ---------------------------------------- */
    /*
      SEARCH AND SHARING — all optional since Phase 17C.5A.

      A new event needs none of these: the search title is generated from the
      visible title, the event's calendar year and the organisation name, and the
      search description falls back to the Summary. The four existing events
      carry authored values, which are kept and simply act as overrides.
    */
    { label: t("Browser / search title — custom", "Tytuł w wyszukiwarce — własny"),
      name: "seo_title", widget: "string", required: false,
      hint: t("Optional. Leave empty and one is generated: event title, year, then " +
        "the Federation's name.",
      "Opcjonalne. Zostaw puste — tytuł zostanie wygenerowany.") },
    { label: t("Search-result description — custom", "Opis w wyszukiwarce — własny"),
      name: "seo_description", widget: "text", required: false,
      hint: t("Optional. Leave empty to use the Summary.",
        "Opcjonalne. Zostaw puste, aby użyć Podsumowania.") },
    { label: t("Social image description", "Opis obrazu społecznościowego"), name: "og_image_alt", widget: "string", required: true },
    {
      // One level further down the chain than the search description, and
      // optional for the same reason: it falls back to it.
      label: t("Structured-data description — custom", "Opis danych strukturalnych — własny"),
      name: "schema_description", widget: "text", required: false,
      hint: t("Usually leave this blank. It uses the search description automatically.",
        "Zwykle zostaw puste. Automatycznie używa opisu z wyszukiwarki."),
    },
    {
      label: t("Structured-data name override", "Nadpisanie nazwy w danych strukturalnych"),
      name: "schema_name", widget: "string", required: false,
      hint: t("Advanced. Leave blank unless the search-engine event name needs to " +
        "differ from the visible page title.",
        "Zaawansowane. Zostaw puste, chyba że nazwa dla wyszukiwarek ma się różnić od tytułu."),
    },
  ];

  /*
    ORDINARY FIRST, OVERRIDES LAST (Phase 17C.5A.2).

    Decap renders fields in configuration order, so order IS the information
    architecture. An editor writing a new event should meet the title, the one
    Summary, the short homepage line, the quick facts and the album — and should
    meet the six override boxes only after all of that, because every one of
    them exists to say something DIFFERENT from what the record already derives.

    Done here rather than with a collapsible drawer in the admin enhancer: this
    is deterministic, needs no DOM, and cannot fail to apply. Nothing is hidden —
    an editor who needs an override still finds it, at the bottom, where it
    belongs.
  */
  const ORDINARY = ["title_lead", "title_fancy", "title_tail", "eyebrow",
    "summary", "body", "timeline_summary", "facts", "album",
    "card_image_alt", "og_image_alt"];
  const rank = (f) => {
    const i = ORDINARY.indexOf(f.name);
    return i === -1 ? ORDINARY.length : i;
  };
  return fields
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (rank(a.f) - rank(b.f)) || (a.i - b.i))
    .map((x) => x.f);
}

function standardEventFields() {
  return [
    /* -- identity, hidden invariants --------------------------------------- */
    {
      label: "Record ID — must be unique", name: "slug", widget: "string", required: true,
      hint: EVENT_SLUG_HINT,
      pattern: ["^[a-z0-9]+(-[a-z0-9]+)*$", "Lowercase letters, numbers and single hyphens only."],
    },
    // Rendering architecture, not content. Fixed so an editor cannot turn a
    // standard event into a Business Forum by accident, in either direction.
    { label: "event_family", name: "event_family", widget: "hidden", default: STANDARD_FAMILY },
    { label: "template", name: "template", widget: "hidden", default: STANDARD_TEMPLATE },
    // Every current record is a single-day event; the template reads this to
    // decide how to print the date. Nothing in the schema supports another value.
    { label: "date_precision", name: "date_precision", widget: "hidden", default: "day" },
    { label: "organiser", name: "organiser", widget: "hidden", default: "Federation of Polish Student Societies UK" },

    academicYearField("academic_year", "Academic year", EVENT_YEAR_HINT),
    dateOnlyField("start_date", "Start date", true,
      "Pick the day from the calendar. Stored as year-month-day, e.g. 2026-02-10. " +
      "The wording readers see comes from \"Date, as written\" below."),
    dateOnlyField("end_date", "End date", false,
      "Only for events spanning more than one day. Leave empty otherwise."),
    /*
      DISPLAY POSITION IS GONE (Phase 17C.5A).

      Events are shown newest first, by the date they happen. The hand-kept
      number this replaced duplicated information the record already carried:
      an editor had to know that the Christmas Dinner was third, keep that in
      step with four other records, and a clash was a fatal build error.

      Hidden rather than deleted, so the key still round-trips on the records
      that carry it and nothing has to be rewritten. Nothing reads it — see
      src/_data/eventListing.js, where the sort is now by `start_date`.
    */
    { label: "Display position", name: "order", widget: "hidden" },

    /* -- visibility --------------------------------------------------------- */
    { label: "Published", name: "published", widget: "boolean", required: false, default: true,
      hint: "Unpublish to hide the event everywhere while keeping the record. An " +
        "event for a FUTURE academic year must stay unpublished until that year " +
        "becomes current — src/_data/eventListing.js refuses to build otherwise." },
    { label: "Show in the events listing", name: "show_in_listing", widget: "boolean", required: false, default: true },
    { label: "Show on the homepage timeline", name: "show_on_homepage", widget: "boolean", required: false, default: true },
    { label: "Keep in the season archive", name: "show_in_archive", widget: "boolean", required: false, default: true,
      hint: "Past editions stay reachable through the archive when this is on." },
    { label: "Flagship event", name: "flagship", widget: "boolean", required: false, default: false,
      hint: "Reserved for the Federation's headline event of the year." },

    /* -- venue -------------------------------------------------------------- */
    {
      label: "Venue", name: "venue", widget: "object", required: true, collapsed: false,
      fields: [
        {
          label: "Venue name", name: "name", widget: "object", required: true,
          fields: [
            { label: "English", name: "en", widget: "string", required: true },
            { label: "Polski", name: "pl", widget: "string", required: true,
              hint: "Some venues keep the same name in both languages; others do not. " +
                "Write the Polish form if there is one." },
          ],
        },
        /*
          LOCATION PLUMBING, kept out of the ordinary form (Phase 17C.5A.2).

          An editor writing a new event should answer two questions — where is
          it, and in which city. These three answered neither, and one of them
          was actively dangerous: `neighbourhood` was declared as a string but
          two records store an object ({en, pl}), so opening Christmas Dinner
          or Icebreaker and saving would have handed an object to a text box.
          Hiding it fixes that as well.

          Hidden, never deleted: the values round-trip untouched, the venue
          display filter and the JSON-LD keep reading them, and no historical
          page changes. `hidden` is the pattern `event_family`, `template` and
          `organiser` have always used here.
        */
        { label: "Neighbourhood", name: "neighbourhood", widget: "hidden" },
        {
          label: "Town or city", name: "locality", widget: "object", required: true,
          fields: [
            { label: "English", name: "en", widget: "string", required: true },
            { label: "Polski", name: "pl", widget: "string", required: true },
          ],
        },
        /*
          "GB" is not a fabricated default: every event in the repository carries
          it, and the Federation is a UK organisation whose events happen in the
          UK. It feeds `addressCountry` in the structured data, so it has to be
          present — but it is not a question worth asking an editor each time.
          An event abroad would need this reconsidering, which is a better
          problem to have than a field nobody understands.
        */
        { label: "Country code", name: "country", widget: "hidden", default: "GB" },
        { label: "Show the town in the key facts", name: "show_locality_in_facts",
          widget: "hidden" },
      ],
    },

    /* -- imagery ------------------------------------------------------------ */
    /*
      A NOTE ON BROWSING IMAGES, which an earlier phase got wrong.

      These fields used to inherit the global assets/ root, on the reasoning that
      event images live in several places (assets/debata/, assets/wigilia/,
      assets/yc/, assets/announcements/) and a shared root would let an editor
      reuse any of them. Testing the media library in the browser showed that is
      not what happens: decap-server lists only files sitting DIRECTLY in the
      folder it is given, and never descends into subfolders. assets/ holds one
      file at its top level, so the picker showed "No assets found" — and the
      hint cheerfully told the editor they could pick any existing image.

      Recursion is the local content service's behaviour, not something this
      configuration can change. What it can do is make uploads land somewhere
      predictable instead of at the root of assets/, so the folder becomes useful
      as events are added, and say plainly what the editor should expect.

      Existing records are unaffected: the stored value is a path string, and a
      field's media folder governs only browsing and uploading, never the value
      already in the file.
    */
    /*
      ONE UPLOAD, SEVERAL USES.

      All three fields browse and upload to the SAME folder, which is what makes
      reuse work: upload the photograph once, then pick the very same file in the
      other field. Nothing is copied and no second asset is created — the fields
      store a path, and two fields may hold the same path.

      This is not theoretical. christmas-dinner and business-forum each already
      point the main image and the sharing image at one file, and have done since
      before the CMS existed.
    */
    {
      label: "Main event image", name: "card_image", widget: "image", required: true,
      media_folder: "/assets/events",
      public_folder: "/assets/events",
      choose_url: false,
      hint: "The event's photograph, shown on the events listing. For a new event, " +
        "use Upload — it is saved to assets/events, and you can then pick the same " +
        "file again for the sharing image below. Photographs from earlier events " +
        "live in their own folders and are not listed here.",
    },
    {
      /*
        A focus for the LISTING CARD only.

        The card is the one place the site itself crops an event photograph:
        `.event-card .ph img` is `object-fit: cover` inside a cell the grid sizes
        at 380 x 260 on a wide screen. The other two image fields deliberately do
        NOT get one:

          - the hero image is null on every event and no standard-event template
            renders it, so a focus would control nothing;
          - the sharing image is handed to social networks as a plain URL. They
            crop it however they choose, and this site cannot influence that.
            Offering a control that quietly does nothing would be worse than
            offering none.

        Because a focus belongs to the ROLE and not to the file, one photograph
        reused across fields can still be framed differently in each — no second
        copy of the image is needed to get a different crop.
      */
      label: "Main image focus",
      name: "card_image_focus",
      widget: "focalPoint",
      required: false,
      image_field: "card_image",
      value_format: "coords",
      // The card is sized by the page rather than by a fixed ratio, so this is a
      // representative shape: 380 x 260, the desktop grid cell. Marked as
      // approximate in the editor rather than pretending to be exact.
      frames: [{ label: "On the events listing", ratio_w: 380, ratio_h: 260, approximate: true }],
      hint: "Which part of the photograph matters most on the events listing. " +
        "Leave it centred unless something important is being cut off.",
    },
    {
      label: "Sharing image (used when the page is shared)", name: "og_image",
      widget: "image", required: true,
      media_folder: "/assets/events",
      public_folder: "/assets/events",
      choose_url: false,
      hint: "Shown when somebody shares the page on social media. You can choose " +
        "the SAME file as the main image above — do not upload it a second time. " +
        "Some events instead use the Federation's own sharing card; either is fine.",
    },
    {
      /*
        HIDDEN, because it controls nothing (Phase 17C.4).

        Every event stores null here and no standard-event template renders it —
        the pages open with a typographic heading by design. Phase 17C.3 left it
        visible with a hint saying "leave this empty", which is still an image
        picker an editor has to read, decide about and ignore. An inert control
        is worse than no control.

        Kept as a hidden field so the key round-trips exactly as it does today.
      */
      label: "Hero image", name: "hero_image", widget: "hidden", default: null,
    },

    /* -- links -------------------------------------------------------------- */
    /*
      SOCIAL POSTS — one public post per platform (Phase 17C.5A).

      A generic `social_posts` list was considered and rejected. Instagram is
      not only a top-level value: it is also a SECTION TYPE, and the section
      renderer reads `event.instagram_permalink` directly. Moving it into a
      list would have meant reworking the three-array section architecture
      that every alignment guard in this repository protects, for a feature no
      event needs yet — no current event references more than one post on any
      platform.

      So Facebook and LinkedIn are siblings of the field that already worked.
      Existing Instagram data is untouched, and the CMS presents all three as
      one Social posts group.

      Each pattern pins its own platform: a LinkedIn address in the Facebook
      box is refused, as is any scheme other than https. The templates build
      their own markup from these values and never render editor text as HTML.
    */
    { label: "Instagram post", name: "instagram_permalink", widget: "string", required: false,
      pattern: ["^https://www\\.instagram\\.com/(p|reel|tv)/[A-Za-z0-9_-]+/?(\\?\\S*)?$|^$",
        "A public Instagram post address, for example https://www.instagram.com/p/ABC123/ — or leave empty."],
      hint: "Public post only. A private or deleted post shows a link instead of an embed." },
    { label: "Facebook post", name: "facebook_permalink", widget: "string", required: false,
      pattern: ["^https://(www\\.)?facebook\\.com/\\S+$|^$",
        "A public Facebook post address on facebook.com — or leave empty."],
      hint: "Public post only. If Facebook will not embed it, the page shows a link to it." },
    { label: "LinkedIn post", name: "linkedin_permalink", widget: "string", required: false,
      pattern: ["^https://(www\\.)?linkedin\\.com/(posts|feed/update)/\\S+$|^$",
        "A public LinkedIn post address on linkedin.com — or leave empty."],
      hint: "Public post only — one shared with Anyone. Otherwise the page shows a link." },
    { label: "Photo album link", name: "album_url", widget: "string", required: false,
      pattern: [HTTPS_URL_OR_EMPTY, "A full https:// address, or leave empty."],
      hint: "Where the Album button points. Leave empty if there is no album." },

    /* -- co-organisers ------------------------------------------------------ */
    {
      label: "Co-organisers", name: "co_organisers", widget: "list", required: false,
      label_singular: "co-organiser",
      hint: "Partner organisations shown with their logos. Leave empty if none.",
      fields: [
        {
          label: "Logo", name: "logo", widget: "image", required: true,
          // No field-level media folder: event images legitimately live in several

          // places (assets/announcements/, assets/social/, assets/wigilia/, assets/yc/),

          // so the picker inherits the global assets/ root and an editor can reuse any

          // of them. A private assets/events/ folder would have shown "No assets found"

          // on a new event. Validation accepts any /assets/… path that resolves.

          choose_url: false,
        },
        {
          label: "Organisation name", name: "alt", widget: "object", required: true,
          fields: [
            { label: "English", name: "en", widget: "string", required: true },
            { label: "Polski", name: "pl", widget: "string", required: true },
          ],
        },
      ],
    },

    /* -- registration ------------------------------------------------------- */
    {
      /*
        REGISTRATION IS DELIBERATELY HIDDEN.

        All four standard events store the same inert structure, and no
        standard-event rendering path was found that does anything with a
        non-`none` state. Offering an editor a control whose effect is unproven
        invites them to set something that silently does nothing — worse than not
        offering it at all.

        The field is NOT removed from the stored schema: hidden widgets still
        serialise, so a record created here keeps the canonical shape, and
        ensureEventRegistration() fills in the sub-fields Decap would otherwise
        omit. Existing records are untouched, and scripts/validate.js still
        rejects a malformed registration block if a file is hand-edited.

        This says nothing about the Business Forum, which is out of scope.
        See docs/CMS_EVENTS.md §19.
      */
      /*
        A REAL REGISTRATION SECTION (Phase 17C.5A.2).

        This was hidden while no public rendering existed — showing a control
        that changed nothing would have been worse than showing none. The event
        page now renders registration, so the section is editable, and it uses
        the SAME four controls and the SAME validator as an announcement.

        The two legacy keys stay as hidden fields. Every existing record carries
        `type: null` and `email: null` from the original migration, and dropping
        them from the schema would delete them from the file on the next save.
        Nothing reads them; they simply round-trip.
      */
      label: "Registration", name: "registration", widget: "object",
      required: false, collapsed: false,
      hint: "Whether people can sign up for this event, and where. Leave the " +
        "status as No registration for a past event or one that needs no sign-up.",
      fields: registrationFields("event").concat([
        { label: "type", name: "type", widget: "hidden", default: null },
        { label: "email", name: "email", widget: "hidden", default: null },
      ]),
    },

    /* -- section structure --------------------------------------------------- */
    /*
      THE GALLERY (Phase 17C.5A.3).

      This replaces the shared half of the three parallel section arrays. ONE
      ordered list of photographs, each carrying its own bilingual description
      and its own layout flag — so the index-alignment problem that made the old
      architecture dangerous simply cannot occur.

      The template decides where the gallery sits on the page. An editor decides
      which photographs are in it, and in what order.

      A photograph that belongs in the flow of the writing goes in Main body
      instead; this is for a genuine group of event pictures.
    */
    {
      label: "Gallery", name: "gallery", widget: "object", required: false,
      collapsed: true,
      summary: "Gallery",
      hint: "A group of photographs from the event. Leave empty if there are none.",
      fields: [
        {
          label: "Gallery heading", name: "heading", widget: "object", required: false,
          fields: [
            { label: "English", name: "en", widget: "string", required: false },
            { label: "Polski", name: "pl", widget: "string", required: false },
          ],
        },
        /*
          The decorative last words, exactly as the event's own title works.

          The heading blocks this gallery replaced could highlight part of their
          title — "Relive the *evening*" — and two events still do. Dropping it
          would have quietly reset authored typography on live pages, so the
          part is stored separately and added after the heading, which is what
          the h1 has always done.
        */
        {
          label: "Highlighted part", name: "heading_fancy", widget: "object",
          required: false,
          hint: "Optional. Added after the heading in the decorative face, the " +
            "same way the event's own title highlights a word.",
          fields: [
            { label: "English", name: "en", widget: "string", required: false },
            { label: "Polski", name: "pl", widget: "string", required: false },
          ],
        },
        {
          label: "Small label above the heading", name: "eyebrow", widget: "object",
          required: false,
          fields: [
            { label: "English", name: "en", widget: "string", required: false },
            { label: "Polski", name: "pl", widget: "string", required: false },
          ],
        },
        {
          label: "Photographs", name: "images", widget: "list", required: false,
          label_singular: "photograph",
          summary: "{{fields.alt.en}}",
          fields: [
            {
              label: "Photograph", name: "src", widget: "image", required: true,
              media_folder: "/assets/events",
              public_folder: "/assets/events",
              choose_url: false,
            },
            {
              label: "Description", name: "alt", widget: "object", required: true,
              hint: "Describe what matters in this photograph for someone who cannot see it.",
              fields: [
                { label: "English", name: "en", widget: "string", required: true },
                { label: "Polski", name: "pl", widget: "string", required: true },
              ],
            },
            {
              label: "Full width", name: "wide", widget: "boolean", required: false,
              default: false,
              hint: "Spans both columns of the grid. Good for a wide photograph.",
            },
          ],
        },
      ],
    },
    /*
      The heading that used to introduce the Instagram block. Kept because it is
      authored content — two events say "As seen on Instagram" above it — but
      hidden, because it is not something a new event needs to think about.
    */
    { label: "Social heading", name: "social_heading", widget: "hidden" },

    /* -- localised ----------------------------------------------------------- */
    { label: "English", name: "en", widget: "object", required: true, collapsed: false,
      fields: eventLocaleFields("en") },
    { label: "Polski", name: "pl", widget: "object", required: true, collapsed: false,
      fields: eventLocaleFields("pl") },
  ];
}

/* ---------------------------------------------------------------------------
   The configuration object.
   --------------------------------------------------------------------------- */
/**
 * Turn Decap's built-in preview pane off, for every collection.
 *
 * Two reasons, and either alone would be enough:
 *
 *   - It crashes. Saving an event raises "Failed to load preview: Cannot read
 *     properties of undefined (reading 'get')" — Decap's generic preview cannot
 *     render the index-aligned `sections` / `en.sections` / `pl.sections`
 *     structure. The save itself succeeds, so the editor is shown a red error
 *     for an operation that actually worked. Nothing is more corrosive to trust
 *     in a tool than that.
 *   - It would be misleading even when it works. These pages are rendered by
 *     Eleventy from Nunjucks templates; Decap's preview knows none of that and
 *     shows an unstyled field dump. An editor comparing it to the real page
 *     would reasonably conclude the CMS had broken the design.
 *
 * A faithful preview would mean reimplementing the site's templates in React
 * and keeping the two in step forever. Showing nothing is honest; showing
 * something wrong is not. `npm run build` renders the real page.
 *
 * Applied by mapping over the collections rather than written into each one, so
 * a collection added later cannot reintroduce the crash by omission.
 */
function withoutPreviewPane(collections) {
  return collections.map((c) => Object.assign({}, c, { editor: { preview: false } }));
}

/**
 * A label -> field-name map for every top-level field of every collection.
 *
 * The form-sections enhancer groups fields it can identify. Text inputs carry
 * their field name in the input id, but booleans, objects, lists and image
 * pickers do not — so most of the event form was unidentifiable and only two
 * sections were built. Their LABELS are the other thing this repository owns,
 * so they are handed to the browser as data rather than guessed at there.
 *
 * Built from the config itself, so a renamed label cannot leave the enhancer
 * looking for wording that no longer exists.
 */
function fieldLabelMap(collections) {
  const map = {};
  for (const c of collections) {
    for (const f of c.fields || []) {
      if (f.label && f.name) map[String(f.label).trim()] = f.name;
    }
  }
  return map;
}

/* ---------------------------------------------------------------------------
   How long should each short text be?
   --------------------------------------------------------------------------- */

/**
 * Recommended lengths, measured from the site rather than invented.
 *
 * Every figure below is at or above the LONGEST value already in the repository,
 * so introducing these cannot make existing copy invalid — which was the whole
 * risk of adding limits to content somebody has already written and published.
 * The comment on each line records what the real content does.
 *
 * `hard` is deliberately absent almost everywhere. These layouts wrap: long text
 * looks worse, it does not break, and a cap that blocks a save needs a stronger
 * justification than "it would be tidier". The counter supports one, and the
 * tests exercise it, but production configures none.
 */
const FIELD_LIMITS = {
  /* -- standard events -------------------------------------------------- */
  // Composed <h1>; the longest real title is 47 characters.
  title_lead: { recommended: 60 },
  title_fancy: { recommended: 40 },
  title_tail: { recommended: 40 },
  // "Annual tradition", "Academic debate" — real range 6–21.
  eyebrow: { recommended: 40 },
  /*
    The Summary now feeds BOTH the listing card and the page introduction, so it
    has to suit two contexts: hero text runs 59–104 characters, card text
    162–200. A single figure cannot be ideal for both; 180 sits inside the card
    range and reads as a full sentence at the top of the page, which is the
    better compromise than optimising for either end.
  */
  summary: { recommended: 180 },
  hero_summary: { recommended: 120 },   // real range 59–104
  card_summary: { recommended: 210 },   // real range 162–200
  timeline_title: { recommended: 45 },  // real range 21–35
  timeline_summary: { recommended: 115 }, // real range 77–109, tight context
  card_image_alt: { recommended: 125 }, // real range 56–87
  og_image_alt: { recommended: 125 },   // real range 48–97
  /*
    Search guidance, not a technical ceiling — search engines truncate what they
    show, they do not reject anything. Set above the longest existing value so a
    deliberately fuller title is a nudge rather than an error.
  */
  seo_title: { recommended: 90 },        // real range 59–82
  seo_description: { recommended: 165 }, // real range 133–154
  schema_description: { recommended: 200 }, // real range 140–182
  schema_name: { recommended: 70 },      // real range 15–31

  /* -- announcements ----------------------------------------------------- */
  title: { recommended: 75 },      // real range 30–64
  subtitle: { recommended: 115 },  // real range 56–95
  link_label: { recommended: 35 }, // real range 12–22
};

function buildConfig() {
  /*
    LOCAL OR PRODUCTION, DECIDED BY ONE EXPLICIT FLAG.

    CMS_TARGET=production is set only by the production build script. Nothing
    infers the mode from whether a GitHub credential happens to be present in
    the environment: a developer with those variables exported must still get
    the local backend, or a local experiment becomes a public commit.

    BOTH modes use Decap’s built-in `proxy` backend, which is the whole reason
    this works. It posts {branch, action, params} to one URL and accepts a
    ROOT-RELATIVE one — so locally it talks to scripts/cms-server.js on
    127.0.0.1, and in production to a same-origin Netlify Function at /api/cms.
    Same pinned, tested, built-in backend either way; no custom adapter written
    against an API Decap documents as unfinalised.

    Same-origin also means the browser sends the session cookie with every
    request without the backend knowing anything about authentication.
  */
  const production = process.env.CMS_TARGET === "production";
  const config = {
    backend: production
      ? {
        name: "proxy",
        // Root-relative on purpose: same origin as /admin/, so the Netlify
        // Identity session cookie is sent and there is no CORS surface at all.
        proxy_url: "/api/cms",
        branch: PRODUCTION_BRANCH,
      }
      : {
        // decap-server in its default `fs` mode: writes files, does not commit.
        // No OAuth client, no Git Gateway, no Identity, no token anywhere.
        name: "proxy",
        proxy_url: PROXY_URL,
        branch: "feature/admin-cms",
      },

    // Where the built-in media library uploads by default. The Team photograph
    // field overrides both of these so headshots stay in assets/team/.
    media_folder: "assets",
    public_folder: "/assets",

    // Editors save straight to the working tree. The editorial workflow needs a
    // real git backend and belongs to the authentication phase.
    publish_mode: "simple",

    // Nothing here is a live site yet, so no preview links are offered.
    site_url: "https://polsocfederation.pl",
    display_url: "https://polsocfederation.pl",

    collections: [
      {
        name: "team",
        label: "Team",
        label_singular: "team member",
        description:
          "One record per person per academic year. Adding next year's committee " +
          "never edits or deletes this year's — create new records instead.",
        folder: "content/team",
        // New records are allowed; nothing may be deleted from the CMS, because a
        // deleted record is a deleted piece of the Federation's history. Use the
        // Published toggle instead.
        create: true,
        delete: false,
        // Pure YAML, matching the extension the repository already uses.
        extension: "yaml",
        format: "yaml",
        // The filename is the `slug` FIELD, so scripts/validate.js's
        // "every record's slug matches its filename" assertion holds by
        // construction, and a returning member's year-suffixed ID cannot collide
        // with their previous year's record.
        slug: "{{fields.slug}}",
        identifier_field: "name",
        // The academic year is in the summary because the collection holds every
        // year at once: without it, a returning member appears twice with no way
        // to tell the rows apart before opening one.
        //
        // `{{fields.group}}` renders the stored key (`trustees`), not the human
        // label (`Trustees`). Decap's summary templates support only the `date`
        // and `default` filters — there is no way to map a select value back to
        // its label, and storing the label as a second field would recreate
        // exactly the divergence that generating the options from
        // team-groups.yaml exists to prevent. The `view_groups` control below
        // does carry readable labels.
        summary: "{{fields.name}} — {{fields.academic_year}} — {{fields.group}}",
        sortable_fields: ["academic_year", "group", "order", "name"],
        // Grouped by year FIRST so past committees stay visible and obvious
        // rather than being mixed in with the current one. Nothing is filtered:
        // every record in content/team/ is listed, whatever its year.
        view_groups: [
          { label: "Academic year", field: "academic_year" },
          { label: "Team group", field: "group" },
        ],
        fields: teamFields(),
      },
      {
        name: "standard_events",
        label: "Events",
        label_singular: "event",
        description:
          "The Federation's standard events, one record per edition. The Polish " +
          "Business Forum is not here — it has its own page design and its own " +
          "editor. Adding next year's edition never changes this year's.",
        folder: "content/events",
        create: true,
        // Deleting an event deletes a piece of the Federation's history. Unpublish
        // instead; the record stays and the archive keeps working.
        delete: false,
        extension: "yaml",
        format: "yaml",
        slug: "{{fields.slug}}",
        identifier_field: "slug",
        // THIS is what keeps the Business Forum out. Decap's `filter` hides any
        // record whose field does not match, so the bespoke record never appears
        // in this collection and cannot be opened through it. The hidden
        // event_family default means a record created here is always standard.
        filter: { field: "event_family", value: STANDARD_FAMILY },
        // The concise homepage label, not the assembled title parts. Decap's
        // summary templates cannot join conditionally, so interpolating
        // title_lead/fancy/tail produces a doubled space when the highlighted
        // part is empty (Icebreaker) and drops the tail entirely (Annual
        // Christmas *Dinner*) — the very spacing class of defect this event
        // family has already suffered once. timeline_title is a single canonical
        // string that reads well on its own.
        // The date is in the summary so the list reads chronologically at a
        // glance and "Sort by → Start date" is obviously the useful choice.
        summary: "{{fields.start_date}} · {{fields.en.timeline_title}} — {{fields.academic_year}}",
        /*
          Newest first, by the date the event happens (Phase 17C.5A).

          `order` has gone from this list because it has gone from the editor:
          the public listing now sorts by date, and offering a sort by a number
          nobody maintains would only invite someone to wonder what it meant.
          Decap 3.15.1 accepts only a plain array here — the object form with an
          explicit default direction is a newer variant and made the whole
          configuration fail to load. So the collection offers "Start date" as
          the first sort choice and the editor picks the direction; the PUBLIC
          listing is date-ordered regardless, which is what readers see.
        */
        sortable_fields: ["start_date", "academic_year"],
        view_groups: [{ label: "Academic year", field: "academic_year" }],
        fields: standardEventFields(),
      },
      {
        name: "announcements",
        label: "Announcements",
        label_singular: "announcement",
        description:
          "News and opportunities, newest first within each academic year. " +
          "Announcements from earlier years stay in the archive — start a new " +
          "record rather than rewriting an old one.",
        folder: "content/announcements",
        create: true,
        // Unlike Team, deletion is allowed: an announcement posted in error is a
        // mistake to remove, not a piece of committee history. Unpublishing
        // remains the right choice for anything that genuinely happened.
        delete: true,
        extension: "yaml",
        format: "yaml",
        slug: "{{fields.slug}}",
        identifier_field: "slug",
        // Year first: the collection holds every year at once, and a repeated
        // campaign is otherwise indistinguishable from its predecessor.
        summary: "{{fields.academic_year}} — {{fields.en.title}} — {{fields.published_date}}",
        sortable_fields: ["academic_year", "published_date", "order"],
        // Grouped by year so older announcements remain browsable once a second
        // year exists. Nothing is filtered by the current year.
        view_groups: [
          { label: "Academic year", field: "academic_year" },
        ],
        fields: announcementFields(),
      },
      {
        name: "settings",
        label: "Site settings",
        // A file collection: a fixed list of known files, no creation, no deletion.
        files: [
          {
            name: "academic_year",
            label: "Current academic year",
            file: "content/settings/academic-year.yaml",
            description: ROLLOVER_WARNING,
            fields: [
              academicYearField("current", "Current academic year", ROLLOVER_WARNING),
              {
                // Present so that saving this file cannot silently drop it.
                // Decap serialises the fields it knows about; an unconfigured key
                // would be lost on the first save.
                label: "Known academic years",
                name: "known",
                widget: "list",
                required: false,
                field: {
                  label: "Academic year",
                  name: "year",
                  widget: "select",
                  options: academicYear.academicYearOptions(currentAcademicYear()),
                },
                hint: "Every year that has content in the repository. Add the new " +
                  "year here when you roll over. Nothing reads this yet — it is the " +
                  "record of which archives exist.",
              },
            ],
          },
        ],
      },
    ],
  };

  config.collections = withoutPreviewPane(config.collections);
  return config;
}

/**
 * The pinned Decap CMS version, read from the installed package rather than
 * repeated as a literal. package-lock.json is what actually holds it still.
 */
function decapVersion() {
  const pkg = path.join(ROOT, "node_modules", "decap-cms", "package.json");
  if (!fs.existsSync(pkg)) return null;
  return JSON.parse(fs.readFileSync(pkg, "utf8")).version;
}

/**
 * The config as YAML text.
 *
 * `noRefs` matters: the same option objects appear in more than one field, and
 * without it js-yaml would emit YAML anchors (`&ref_0` / `*ref_0`) that Decap's
 * loader does not expect. `lineWidth: -1` stops long hint strings being wrapped
 * mid-sentence, which keeps the generated file diffable.
 */
function configYaml() {
  return yaml.dump(buildConfig(), { noRefs: true, lineWidth: -1, quotingType: '"' });
}

/**
 * Facts the admin page's duplicate-ID guard needs, for every folder collection
 * whose filename is its own `slug` field.
 *
 * Derived rather than listed, so a collection added later is protected the day
 * it appears instead of the day somebody remembers to update this.
 */
function guardSettings() {
  const config = buildConfig();
  return {
    branch: config.backend.branch,
    collections: config.collections
      .filter((c) => c.folder && c.slug === "{{fields.slug}}")
      .map((c) => ({
        name: c.name,
        label: c.label_singular || c.label,
        folder: c.folder,
        extension: c.extension,
        pattern: c.fields.find((f) => f.name === "slug").pattern[0],
      })),
  };
}

/**
 * An admin-page asset, read from its own file.
 *
 * The editor enhancements live in real .js/.css files rather than as strings in
 * this module: they are long enough to deserve syntax highlighting, and the
 * tests read the same files. Embedding the contents keeps the admin page to a
 * single script and stylesheet, which is what the "no CDN, no remote asset"
 * assertions in scripts/validate-cms.js check for.
 */
function adminAsset(name) {
  const file = path.join(ROOT, "src", "admin", name);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

/* ---------------------------------------------------------------------------
   The brand palette offered by the colour control.
   --------------------------------------------------------------------------- */

/**
 * The colours an editor is offered, READ FROM THE SITE'S OWN STYLESHEETS.
 *
 * Each entry names a custom property that css/style.css or css/pbf.css actually
 * defines, and the value is whatever that file says today. Nothing is copied by
 * hand, so the palette cannot drift away from the site: change `--red` in the
 * stylesheet and the swatch changes with it.
 *
 * This is a CURATED list, not everything in the stylesheets. Those files contain
 * dozens of incidental one-off shades; offering all of them would bury the few
 * colours that actually mean something. The selection covers the categories an
 * editor might reasonably want — the Federation red, the dark inks, the light
 * backgrounds, the events navy and gold, and the Business Forum blues, which is
 * where the one colour currently stored in content came from.
 *
 * A name missing from the stylesheet is dropped rather than guessed, so a
 * renamed variable removes a swatch instead of shipping a stale colour.
 */
const BRAND_PALETTE_SOURCE = [
  ["style.css", "--red", "Federation red"],
  ["style.css", "--red-dark", "Federation red (dark)"],
  ["style.css", "--red-deep", "Federation red (deepest)"],
  ["style.css", "--ink", "Ink — near black"],
  ["style.css", "--ink-soft", "Soft ink — dark grey"],
  ["style.css", "--cream", "Cream — light background"],
  ["style.css", "--line", "Line — pale border"],
  ["style.css", "--white", "White"],
  ["style.css", "--navy", "Events navy"],
  ["style.css", "--navy-deep", "Events navy (deep)"],
  ["style.css", "--gold", "Events gold"],
  ["style.css", "--gold-soft", "Events gold (soft)"],
  ["pbf.css", "--pbf-navy", "Business Forum navy"],
  ["pbf.css", "--pbf-navy-deep", "Business Forum navy (deep)"],
  ["pbf.css", "--pbf-silver", "Business Forum silver"],
  ["pbf.css", "--pbf-ice", "Business Forum ice"],
];

function brandPalette() {
  const cache = {};
  const read = (file) => {
    if (!(file in cache)) {
      const p = path.join(ROOT, "css", file);
      cache[file] = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
    }
    return cache[file];
  };

  const out = [];
  const seen = new Set();
  for (const [file, prop, name] of BRAND_PALETTE_SOURCE) {
    const m = new RegExp(`${prop}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`).exec(read(file));
    if (!m) continue;                       // renamed or removed — drop it
    let hex = m[1].toLowerCase();
    // #abc -> #aabbcc, so every offered value is the canonical six digits.
    if (/^#[0-9a-f]{3}$/.test(hex)) {
      hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    if (!/^#[0-9a-f]{6}$/.test(hex) || seen.has(hex)) continue;
    seen.add(hex);
    out.push({ name, hex });
  }
  return out;
}

module.exports = () => ({
  config: buildConfig(),
  yaml: configYaml(),
  decapVersion: decapVersion(),
  // The English / Polski switcher. Presentation only — see the file's header.
  languageTabsScript: adminAsset("language-tabs.js"),
  languageTabsStyles: adminAsset("language-tabs.css"),
  // The Brand colour widget, and the palette it offers — read from the site's
  // own stylesheets so a swatch cannot drift away from the real colour.
  brandColourScript: adminAsset("brand-colour.js"),
  // The image focus control — one widget, configured per field.
  focalPointScript: adminAsset("focal-point.js"),
  // One title field with a highlight picker, in place of three text boxes.
  eventTitleScript: adminAsset("event-title.js"),
  eventTitleStyles: adminAsset("event-title.css"),
  // Section grouping, compact visibility and collapsing for the long forms.
  formSectionsScript: adminAsset("form-sections.js"),
  // Live length captions on short text fields.
  // An image beside the words describing it, and its crop.
  // The collapsed overrides drawer, one per language block.
  advancedDrawerScript: adminAsset("advanced-drawer.js"),
  // Bulk manage — its own page, its own assets. See docs/CMS_BULK_MANAGE.md.
  // The production Staff login page. See src/staff-login.njk.
  staffLoginScript: adminAsset("staff-login.js"),
  staffLoginStyles: adminAsset("staff-login.css"),
  bulkScript: adminAsset("bulk.js"),
  bulkStyles: adminAsset("bulk.css"),
  bulkLinkScript: adminAsset("bulk-link.js"),
  // The production sign-in gate and account panel. Only the production admin
  // page includes these; local development has no Identity to ask.
  sessionScript: adminAsset("session.js"),
  sessionStyles: adminAsset("session.css"),
  bulkLinkStyles: adminAsset("bulk-link.css"),
  registrationUxScript: adminAsset("registration-ux.js"),
  registrationUxStyles: adminAsset("registration-ux.css"),
  // Which option an editor has chosen, worked out from the label Decap shows.
  registrationChoices: registrationChoices(),
  // Which event each picker label belongs to. See eventRegistrationIndex().
  eventPickerIndex: eventRegistrationIndex(),
  advancedDrawerStyles: adminAsset("advanced-drawer.css"),
  imageUnitsScript: adminAsset("image-units.js"),
  imageUnitsStyles: adminAsset("image-units.css"),
  charCountScript: adminAsset("char-count.js"),
  charCountStyles: adminAsset("char-count.css"),
  fieldLimits: FIELD_LIMITS,
  fieldLabels: fieldLabelMap(buildConfig().collections),
  formSectionsStyles: adminAsset("form-sections.css"),
  focalPointStyles: adminAsset("focal-point.css"),
  brandColourStyles: adminAsset("brand-colour.css"),
  brandPalette: brandPalette(),
  proxyPort: PROXY_PORT,
  /*
    WHERE THE ADMIN PAGE ITSELF MAKES REQUESTS.

    Two enhancers talk to the backend directly rather than through Decap: the
    duplicate-ID guard, which lists a collection before a save, and the
    registration preview, which reads one event. They use the same action
    protocol, so they follow the same URL — the local server locally, and the
    same-origin function in production.

    Derived from the backend that was just built, so the two cannot disagree:
    a production admin pointed at a developer machine would be a CMS that looks
    fine and silently does nothing.
  */
  proxyUrl: buildConfig().backend.proxy_url,
  guard: guardSettings(),
  // The literal source of normaliseAnnouncementLink, embedded in the admin page
  // so the browser runs the same function the tests import. Deriving it with
  // Function.prototype.toString rather than keeping a second copy is what makes
  // "the tested code is the shipped code" true rather than aspirational.
  normaliseLinkSource: normaliseAnnouncementLink.toString(),
  // Likewise for the standard-event section guard.
  sectionGuardSource: checkEventSectionAlignment.toString(),
  // The academic-year rule, embedded from src/_data/academicYear.js so the
  // browser, cms:check and the build all read a year the same way.
  academicYearSource: [
    academicYear.parseAcademicYear.toString(),
    academicYear.futureYear.toString(),
    academicYear.futureYearMessage.toString(),
  ].join("\n\n"),
  // Where the central setting lives, so the guard can read the CURRENT value
  // rather than one frozen at build time.
  settingsFile: "content/settings/academic-year.yaml",
  currentAcademicYear: currentAcademicYear(),
  registrationSource: ensureEventRegistration.toString(),
  // Cleared dates become null rather than "". The field names are derived from
  // the config itself, so the guard cannot fall behind a field added later.
  blankDateSource: blankDatesToNull.toString(),
  dateFieldNames: DATE_FIELD_NAMES.slice(),
  // Colours are stored in one spelling however they were typed.
  colourSource: canonicalColour.toString(),
  colourFieldNames: COLOUR_FIELD_NAMES.slice(),
  // Announcement registration: tidies the block and refuses states that cannot
  // be rendered honestly. Named distinctly from `registrationSource` above,
  // which is the standard-EVENT registration block and a different thing.
  // The rules for an announcement that borrows an event's registration, shared
  // with scripts/validate.js and cms:check so all three refuse the same things.
  // The rules for an announcement that borrows an event's registration, shared
  // with scripts/validate.js and cms:check so all three refuse the same things.
  registrationReferenceSource: [
    "var REG_SOURCE_EVENT = \"event\";",
    require("./registration.js").sourceOf.toString(),
    require("./registration.js").referencedEventSlug.toString(),
  ].join("\n\n"),
  announcementRegistrationSource: [
    "var REGISTRATION_NONE = " + JSON.stringify(REGISTRATION_NONE) + ";",
    "var REGISTRATION_STATES = " + JSON.stringify(REGISTRATION_STATES) + ";",
    normaliseRegistration.toString(),
  ].join("\n\n"),
});

/**
 * The registration choices, read back out of the config we just built.
 *
 * The conditional editor needs to know which option an editor has picked, and a
 * Decap select renders its LABEL, not its value — so the browser needs a way
 * back. Deriving the table from the built config rather than retyping it means
 * a label edited above cannot leave the editor showing the wrong fields.
 *
 * @returns {{source: object, state: object}} label -> value, per control
 */
function registrationChoices() {
  const out = { source: {}, state: {} };
  const collections = buildConfig().collections || [];
  for (const collection of collections) {
    const block = (collection.fields || []).find((f) => f.name === "registration");
    if (!block) continue;
    for (const field of block.fields || []) {
      if (!out[field.name] || !Array.isArray(field.options)) continue;
      for (const option of field.options) out[field.name][option.label] = option.value;
    }
  }
  return out;
}

/**
 * Every standard event, keyed by the label the picker shows for it.
 *
 * WHY A LOOKUP TABLE AT ALL
 *
 * Decap's relation widget stores the slug but renders the label, and the option
 * elements it builds carry only the text — there is nowhere in the page to read
 * the chosen slug back from. So the pairing has to come from the content, and
 * this is the one place that can read the files with a real YAML parser.
 *
 * WHAT IS AND IS NOT LIVE
 *
 * The pairing is a snapshot, taken when the admin page is built. That is fine
 * for what it is used for: a title changes when somebody deliberately renames an
 * event, and restarting `npm run cms:dev` refreshes it.
 *
 * The registration VALUES here are a starting point only. The preview re-reads
 * the chosen event's file through the local proxy before it draws anything, so
 * what an editor sees is the event as it stands now, not as it stood at build
 * time. That distinction matters — an editor who has just opened sign-ups on an
 * event and then looked at an announcement must see the change.
 *
 * @returns {object} label -> { slug, state }
 */
function eventRegistrationIndex() {
  const dir = path.join(__dirname, "..", "..", "content", "events");
  const index = {};
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f));
  } catch (err) {
    // No events yet is a legitimate state for a fresh checkout, and an admin
    // page that will not build is a much worse failure than a preview that
    // says it cannot find anything.
    return index;
  }
  for (const file of files) {
    let record;
    try {
      record = yaml.load(fs.readFileSync(path.join(dir, file), "utf8"));
    } catch (err) {
      continue;
    }
    if (!record || record.event_family !== STANDARD_FAMILY) continue;
    const label = EVENT_PICKER_LABEL
      .replace("{{en.timeline_title}}", ((record.en || {}).timeline_title) || record.slug)
      .replace("{{start_date}}", record.start_date || "");
    index[label] = {
      slug: record.slug,
      state: ((record.registration || {}).state) || REGISTRATION_NONE,
    };
  }
  return index;
}

// Named exports for the test and validation scripts, which need the pieces
// without going through Eleventy's data cascade.
module.exports.buildConfig = buildConfig;
module.exports.registrationChoices = registrationChoices;
module.exports.eventRegistrationIndex = eventRegistrationIndex;
module.exports.EVENT_PICKER_LABEL = EVENT_PICKER_LABEL;
module.exports.configYaml = configYaml;
module.exports.decapVersion = decapVersion;
module.exports.normaliseAnnouncementLink = normaliseAnnouncementLink;
module.exports.checkEventSectionAlignment = checkEventSectionAlignment;
module.exports.parseAcademicYear = academicYear.parseAcademicYear;
module.exports.futureYear = academicYear.futureYear;
module.exports.futureYearMessage = academicYear.futureYearMessage;
module.exports.currentAcademicYear = currentAcademicYear;
module.exports.ensureEventRegistration = ensureEventRegistration;
module.exports.blankDatesToNull = blankDatesToNull;
/**
 * The registered date fields.
 *
 * A function rather than the bare array because the names are collected as
 * `dateOnlyField` is CALLED, and that happens inside buildConfig(). A caller
 * that reads the list before building the config would otherwise get an empty
 * array and silently test nothing.
 */
module.exports.FIELD_LIMITS = FIELD_LIMITS;
module.exports.brandPalette = brandPalette;
module.exports.canonicalColour = canonicalColour;
module.exports.COLOUR_FIELD_NAMES = COLOUR_FIELD_NAMES;
module.exports.normaliseRegistration = normaliseRegistration;
module.exports.REGISTRATION_STATES = REGISTRATION_STATES;
module.exports.REGISTRATION_NONE = REGISTRATION_NONE;
module.exports.CANONICAL_REGISTRATION_NONE = CANONICAL_REGISTRATION_NONE;
module.exports.dateFieldNames = () => {
  buildConfig();
  return DATE_FIELD_NAMES.slice();
};
module.exports.CANONICAL_REGISTRATION = CANONICAL_REGISTRATION;
module.exports.SECTION_TYPES = SECTION_TYPES;
module.exports.STANDARD_FAMILY = STANDARD_FAMILY;
module.exports.STANDARD_TEMPLATE = STANDARD_TEMPLATE;
module.exports.OFFERED_LINK_TYPES = OFFERED_LINK_TYPES;
module.exports.SUPPORTED_LINK_TYPES = SUPPORTED_LINK_TYPES;
module.exports.LINK_TYPE_NONE = LINK_TYPE_NONE;
module.exports.teamGroupOptions = teamGroupOptions;
module.exports.PROXY_PORT = PROXY_PORT;
module.exports.PROXY_URL = PROXY_URL;
/** Top-level key order a saved Team record will have. */
module.exports.TEAM_FIELD_ORDER = teamFields().map((f) => f.name);
module.exports.SETTINGS_FIELD_ORDER = ["current", "known"];
