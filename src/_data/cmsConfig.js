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

   The CMS enforces the SHAPE ("YYYY/YY"); scripts/validate.js enforces the
   ARITHMETIC (that the second half really is the following year). A regular
   expression cannot add one to a number, so 2025/27 is refused by the validator
   rather than by this pattern — see docs/CMS_FOUNDATION.md §10.

   Deliberately NOT a select of hard-coded years: a select would have to be
   edited every summer, and an editor cannot add next year's committee if the
   only permitted value is this year's.
   --------------------------------------------------------------------------- */
const ACADEMIC_YEAR_PATTERN = ["^\\d{4}/\\d{2}$", 'Use the form 2025/26 — four digits, a slash, then two digits.'];

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
    {
      label: "Academic year",
      name: "academic_year",
      widget: "string",
      required: true,
      default: "",
      hint: YEAR_HINT,
      pattern: ACADEMIC_YEAR_PATTERN,
    },
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
      collapsed: false,
      fields: [
        {
          label: "Nazwa funkcji (po polsku)",
          name: "role",
          widget: "string",
          required: true,
          hint: "Musi być prawdziwym tłumaczeniem, a nie kopią wersji angielskiej — " +
            "walidator odrzuca identyczne pary.",
        },
        {
          label: "Tekst alternatywny zdjęcia (po polsku)",
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
    {
      label: "Academic year",
      name: "academic_year",
      widget: "string",
      required: true,
      hint: ANN_YEAR_HINT,
      pattern: ACADEMIC_YEAR_PATTERN,
    },
    {
      label: "Publication date",
      name: "published_date",
      // A validated STRING, not Decap's datetime widget, and not by accident.
      // The datetime widget hands back either a Date or a formatted value and
      // applies a timezone; a date-only editorial value must not be able to
      // shift a calendar day on a machine in Warsaw. A plain pattern-checked
      // string cannot. See docs/CMS_ANNOUNCEMENTS.md §6.
      widget: "string",
      required: true,
      pattern: ["^\\d{4}-\\d{2}-\\d{2}$", "Use the form 2026-05-14 (year-month-day)."],
      hint: "The date shown on the card, as 2026-05-14. Year, month, day — no time.",
    },
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
      label: "Image focal point",
      name: "image_position",
      widget: "string",
      required: false,
      // Free text on purpose: the canonical records hold CSS background-position
      // values including percentages ("center 30%", "center 22%"), so a select
      // would make three existing records uneditable.
      hint: 'Optional CSS position, e.g. "center top" or "center 30%". Leave empty ' +
        "unless the image is cropped badly.",
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
      label: "Image backdrop colour",
      name: "image_background",
      widget: "string",
      required: false,
      pattern: ["^#[0-9a-fA-F]{6}$", "Use a six-digit hex colour such as #001f62."],
      hint: "Optional. Fills the space around a Contain image, e.g. #001f62.",
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
    {
      label: "Registration closed",
      name: "signups_closed",
      widget: "boolean",
      required: false,
      default: false,
      hint: "Marks the sign-up as closed in both languages. Set this yourself — an " +
        "announcement does not close just because its date has passed.",
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
          hint: "Choose No link to remove a destination you added by mistake. " +
            "Federation event keeps the reader's language automatically.",
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
          pattern: ["^https://[^\\s\"'<>]+$",
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
  return [
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
    { label: t("Small label above the title", "Etykieta nad tytułem"), name: "eyebrow", widget: "string", required: false },
    { label: t("Date, as written", "Data zapisana słownie"), name: "date_label", widget: "string", required: true },
    { label: t("Venue label", "Etykieta miejsca"), name: "venue_label", widget: "string", required: true },
    { label: t("Summary on the event page", "Podsumowanie na stronie wydarzenia"), name: "hero_summary", widget: "text", required: true },
    { label: t("Summary on the events-listing card", "Podsumowanie na karcie"), name: "card_summary", widget: "text", required: true },
    { label: t("Card image description", "Opis zdjęcia karty"), name: "card_image_alt", widget: "string", required: true },
    { label: t("Short title for the homepage timeline", "Krótki tytuł na oś czasu"), name: "timeline_title", widget: "string", required: true,
      hint: t("The concise label the homepage uses — usually shorter than the full title.",
        "Zwięzła etykieta używana na stronie głównej.") },
    { label: t("Homepage timeline summary", "Podsumowanie na osi czasu"), name: "timeline_summary", widget: "text", required: true },
    {
      label: t("Key facts", "Najważniejsze informacje"), name: "facts",
      widget: "list", required: false,
      fields: [
        { label: t("Label", "Etykieta"), name: "label", widget: "string" },
        { label: t("Value", "Wartość"), name: "value", widget: "string" },
      ],
    },
    { label: t("Co-organisers label", "Etykieta współorganizatorów"), name: "co_organisers_label", widget: "string", required: false },
    { label: t("Album button label", "Etykieta przycisku albumu"), name: "album", widget: "string", required: false },
    { label: t("Back link", "Odnośnik powrotny"), name: "back_link", widget: "string", required: true },
    { label: t("Back link at the foot of the page", "Odnośnik powrotny na dole"), name: "back_link_bottom", widget: "string", required: true },
    {
      label: t("English sections", "Sekcje polskie"), name: "sections",
      widget: "list", required: true, types: localisedSectionTypes(lang),
      typeKey: "type", hint: SECTIONS_HELP,
    },
    /* -- search engines and social ---------------------------------------- */
    { label: t("Browser tab / search title", "Tytuł w wyszukiwarce"), name: "seo_title", widget: "string", required: true },
    { label: t("Search-result description", "Opis w wynikach wyszukiwania"), name: "seo_description", widget: "text", required: true },
    { label: t("Social image description", "Opis obrazu społecznościowego"), name: "og_image_alt", widget: "string", required: true },
    {
      label: t("Structured-data description", "Opis dla danych strukturalnych"),
      name: "schema_description", widget: "text", required: true,
      hint: t("The description search engines show for the event itself.",
        "Opis wydarzenia pokazywany przez wyszukiwarki."),
    },
    {
      label: t("Structured-data name override", "Nadpisanie nazwy w danych strukturalnych"),
      name: "schema_name", widget: "string", required: false,
      hint: t("Advanced. Leave blank unless the search-engine event name needs to " +
        "differ from the visible page title.",
        "Zaawansowane. Zostaw puste, chyba że nazwa dla wyszukiwarek ma się różnić od tytułu."),
    },
  ];
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

    { label: "Academic year", name: "academic_year", widget: "string", required: true,
      hint: EVENT_YEAR_HINT, pattern: ACADEMIC_YEAR_PATTERN },
    {
      label: "Date", name: "start_date", widget: "string", required: true,
      // A validated string, not Decap's datetime widget — the same decision as
      // announcements. A date-only value must not be able to shift a calendar
      // day on a machine in Warsaw. See docs/CMS_EVENTS.md §12.
      pattern: ["^\\d{4}-\\d{2}-\\d{2}$", "Use the form 2026-02-10 (year-month-day)."],
      hint: "The day the event happens, as 2026-02-10. No time — the page prints " +
        "the wording you enter under Date, as written.",
    },
    { label: "End date", name: "end_date", widget: "string", required: false,
      pattern: ["^\\d{4}-\\d{2}-\\d{2}$", "Use the form 2026-02-11, or leave empty."],
      hint: "Only for events spanning more than one day. Leave empty otherwise." },
    {
      label: "Display position", name: "order", widget: "number", required: true,
      value_type: "int", min: 1, step: 1,
      hint: "Position within this academic year. Next year's events start again at 1.",
    },

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
        { label: "Neighbourhood", name: "neighbourhood", widget: "string", required: false,
          hint: "e.g. South Kensington, Waterloo. Leave empty if not useful." },
        {
          label: "Town or city", name: "locality", widget: "object", required: true,
          fields: [
            { label: "English", name: "en", widget: "string", required: true },
            { label: "Polski", name: "pl", widget: "string", required: true },
          ],
        },
        { label: "Country code", name: "country", widget: "string", required: true,
          pattern: ["^[A-Z]{2}$", "Two capital letters, e.g. GB."] },
        { label: "Show the town in the key facts", name: "show_locality_in_facts",
          widget: "boolean", required: false },
      ],
    },

    /* -- imagery ------------------------------------------------------------ */
    {
      label: "Card image", name: "card_image", widget: "image", required: true,
      // No field-level media folder: event images legitimately live in several

      // places (assets/announcements/, assets/social/, assets/wigilia/, assets/yc/),

      // so the picker inherits the global assets/ root and an editor can reuse any

      // of them. A private assets/events/ folder would have shown "No assets found"

      // on a new event. Validation accepts any /assets/… path that resolves.

      choose_url: false,
      hint: "Shown on the events listing. Existing events keep their images where " +
        "they already live, and you can pick any of them here.",
    },
    {
      label: "Social sharing image", name: "og_image", widget: "image", required: true,
      // No field-level media folder: event images legitimately live in several

      // places (assets/announcements/, assets/social/, assets/wigilia/, assets/yc/),

      // so the picker inherits the global assets/ root and an editor can reuse any

      // of them. A private assets/events/ folder would have shown "No assets found"

      // on a new event. Validation accepts any /assets/… path that resolves.

      choose_url: false,
      hint: "Used when the page is shared on social media.",
    },
    {
      label: "Hero image", name: "hero_image", widget: "image", required: false,
      // No field-level media folder: event images legitimately live in several

      // places (assets/announcements/, assets/social/, assets/wigilia/, assets/yc/),

      // so the picker inherits the global assets/ root and an editor can reuse any

      // of them. A private assets/events/ folder would have shown "No assets found"

      // on a new event. Validation accepts any /assets/… path that resolves.

      choose_url: false,
      hint: "Optional. None of the current events use one.",
    },

    /* -- links -------------------------------------------------------------- */
    { label: "Instagram post", name: "instagram_permalink", widget: "string", required: false,
      pattern: ["^https://www\\.instagram\\.com/\\S+$|^$",
        "A full https://www.instagram.com/… address, or leave empty."],
      hint: "The post embedded in the Instagram section." },
    { label: "Photo album link", name: "album_url", widget: "string", required: false,
      pattern: ["^https://[^\\s\"'<>]+$|^$", "A full https:// address, or leave empty."],
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
      label: "registration", name: "registration", widget: "hidden",
      default: CANONICAL_REGISTRATION,
    },

    /* -- section structure --------------------------------------------------- */
    {
      label: "Section structure", name: "sections", widget: "list", required: true,
      typeKey: "type", hint: SECTIONS_HELP,
      types: [
        {
          label: "Paragraphs", name: "prose",
          fields: [
            { label: "type", name: "type", widget: "hidden", default: "prose" },
            { label: "Spacing", name: "style", widget: "string", required: false,
              hint: "Layout only. Leave exactly as it is unless you know what it does." },
          ],
        },
        {
          label: "Heading", name: "heading",
          fields: [
            { label: "type", name: "type", widget: "hidden", default: "heading" },
            { label: "Spacing", name: "style", widget: "string", required: false },
          ],
        },
        {
          label: "Photo gallery", name: "gallery",
          fields: [
            { label: "type", name: "type", widget: "hidden", default: "gallery" },
            { label: "Spacing", name: "style", widget: "string", required: false },
            { label: "Show the Instagram post inside this grid", name: "instagram_in_grid",
              widget: "boolean", required: false, default: false },
            {
              label: "Images", name: "images", widget: "list", required: true,
              hint: "Each image needs a description in BOTH languages, in this same " +
                "order, under English sections and Polish sections.",
              fields: [
                { label: "Image", name: "src", widget: "image", required: true,
                  choose_url: false },
                { label: "Wide (spans two columns)", name: "wide", widget: "boolean",
                  required: false, default: false },
              ],
            },
          ],
        },
        {
          label: "Photo album link", name: "album",
          fields: [
            { label: "type", name: "type", widget: "hidden", default: "album" },
            { label: "Spacing", name: "style", widget: "string", required: false },
          ],
        },
        {
          label: "Instagram", name: "instagram",
          fields: [
            { label: "type", name: "type", widget: "hidden", default: "instagram" },
            { label: "Spacing", name: "style", widget: "string", required: false },
          ],
        },
      ],
    },

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
function buildConfig() {
  return {
    // The local file-system proxy. This is NOT a production backend: there is no
    // OAuth client, no Git Gateway, no Netlify Identity and no token anywhere.
    // decap-server runs in its default `fs` mode, which writes files and does not
    // commit, so the CMS cannot create git history on its own.
    backend: {
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
        summary: "{{fields.en.timeline_title}} — {{fields.academic_year}}",
        sortable_fields: ["academic_year", "start_date", "order"],
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
              {
                label: "Current academic year",
                name: "current",
                widget: "string",
                required: true,
                hint: ROLLOVER_WARNING,
                pattern: ACADEMIC_YEAR_PATTERN,
              },
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
                  widget: "string",
                  pattern: ACADEMIC_YEAR_PATTERN,
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

module.exports = () => ({
  config: buildConfig(),
  yaml: configYaml(),
  decapVersion: decapVersion(),
  proxyPort: PROXY_PORT,
  proxyUrl: PROXY_URL,
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
    academicYear.futurePublishProblem.toString(),
    academicYear.futurePublishMessage.toString(),
  ].join("\n\n"),
  // Where the central setting lives, so the guard can read the CURRENT value
  // rather than one frozen at build time.
  settingsFile: "content/settings/academic-year.yaml",
  currentAcademicYear: currentAcademicYear(),
  registrationSource: ensureEventRegistration.toString(),
});

// Named exports for the test and validation scripts, which need the pieces
// without going through Eleventy's data cascade.
module.exports.buildConfig = buildConfig;
module.exports.configYaml = configYaml;
module.exports.decapVersion = decapVersion;
module.exports.normaliseAnnouncementLink = normaliseAnnouncementLink;
module.exports.checkEventSectionAlignment = checkEventSectionAlignment;
module.exports.parseAcademicYear = academicYear.parseAcademicYear;
module.exports.futurePublishProblem = academicYear.futurePublishProblem;
module.exports.futurePublishMessage = academicYear.futurePublishMessage;
module.exports.currentAcademicYear = currentAcademicYear;
module.exports.ensureEventRegistration = ensureEventRegistration;
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
