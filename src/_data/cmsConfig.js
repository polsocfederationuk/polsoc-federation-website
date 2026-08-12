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

/** Team collection facts the admin page's duplicate-ID guard needs. */
function guardSettings() {
  const team = buildConfig().collections.find((c) => c.name === "team");
  const slug = team.fields.find((f) => f.name === "slug");
  return {
    folder: team.folder,
    extension: team.extension,
    branch: buildConfig().backend.branch,
    pattern: slug.pattern[0],
  };
}

module.exports = () => ({
  config: buildConfig(),
  yaml: configYaml(),
  decapVersion: decapVersion(),
  proxyPort: PROXY_PORT,
  proxyUrl: PROXY_URL,
  guard: guardSettings(),
});

// Named exports for the test and validation scripts, which need the pieces
// without going through Eleventy's data cascade.
module.exports.buildConfig = buildConfig;
module.exports.configYaml = configYaml;
module.exports.decapVersion = decapVersion;
module.exports.teamGroupOptions = teamGroupOptions;
module.exports.PROXY_PORT = PROXY_PORT;
module.exports.PROXY_URL = PROXY_URL;
/** Top-level key order a saved Team record will have. */
module.exports.TEAM_FIELD_ORDER = teamFields().map((f) => f.name);
module.exports.SETTINGS_FIELD_ORDER = ["current", "known"];
