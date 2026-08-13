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

const ROOT = path.join(__dirname, "..", "..");

/* The local proxy. Port and host are matched by package.json's `cms:proxy`
 * script; 8081 is decap-server's own default. */
const PROXY_PORT = 8081;
const PROXY_URL = `http://localhost:${PROXY_PORT}/api/v1`;

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
});

// Named exports for the test and validation scripts, which need the pieces
// without going through Eleventy's data cascade.
module.exports.buildConfig = buildConfig;
module.exports.configYaml = configYaml;
module.exports.decapVersion = decapVersion;
module.exports.normaliseAnnouncementLink = normaliseAnnouncementLink;
module.exports.OFFERED_LINK_TYPES = OFFERED_LINK_TYPES;
module.exports.SUPPORTED_LINK_TYPES = SUPPORTED_LINK_TYPES;
module.exports.LINK_TYPE_NONE = LINK_TYPE_NONE;
module.exports.teamGroupOptions = teamGroupOptions;
module.exports.PROXY_PORT = PROXY_PORT;
module.exports.PROXY_URL = PROXY_URL;
/** Top-level key order a saved Team record will have. */
module.exports.TEAM_FIELD_ORDER = teamFields().map((f) => f.name);
module.exports.SETTINGS_FIELD_ORDER = ["current", "known"];
