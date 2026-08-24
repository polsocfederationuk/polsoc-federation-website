/**
 * Eleventy configuration — Federation of Polish Student Societies in the UK
 *
 * PHASE 2 SCOPE: this build generates ONLY the architectural proof pages under
 * dist/build-test/. The live website is still the hand-written HTML at the
 * repository root, and Netlify still publishes the repository root. Nothing in
 * this config touches, reads or rewrites a public page.
 *
 * The input directory is `src/`, so Eleventy cannot see — let alone modify —
 * the public HTML at the repository root. That containment is deliberate and
 * is asserted by scripts/validate.js.
 *
 * See docs/BUILD_ARCHITECTURE.md for the full rationale.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const MarkdownIt = require("markdown-it");
const registrationModel = require("./src/_data/registration.js");

/* ===========================================================================
   Markdown for announcement bodies.

   html: false is the security boundary. Announcement bodies are editor input
   destined for `innerHTML` in the browser, so allowing raw HTML would make a
   stored-XSS hole out of a content file. With it off, markdown-it escapes any
   `<tag>` to visible text and the only markup that can reach the page is what
   this renderer itself emits.

   linkify and typographer are OFF so nothing is silently rewritten: a bare URL
   in prose stays prose, and the em dashes and curly quotes already in the copy
   are passed through untouched.
   =========================================================================== */
const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });

// Belt and braces over markdown-it's own validateLink, which already rejects
// javascript:, vbscript: and non-image data:. Stated explicitly so the policy
// is visible in this file rather than inherited silently.
const SAFE_LINK = /^(https?:|mailto:|\/|#)|^[a-z0-9][a-z0-9-]*\.html([?#]|$)/i;
md.validateLink = (url) => SAFE_LINK.test(String(url).trim());

// External links get target/rel, matching what the live bodies already carry.
md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const href = tokens[idx].attrGet("href") || "";
  if (/^https?:/i.test(href)) {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noopener");
  }
  return self.renderToken(tokens, idx, options);
};

/**
 * Render an announcement body.
 *
 * Paragraphs are rendered INLINE and rejoined with a blank line rather than
 * wrapped in <p>. That is not a shortcut — `.modal-content .ann-text` is styled
 * `white-space: pre-line`, so the blank line *is* the paragraph break. Emitting
 * <p> would add margins on top of the preserved newlines and space the text out
 * differently from the live page. See docs/ANNOUNCEMENTS_MIGRATION.md §8.
 */
function renderBody(markdown) {
  return String(markdown == null ? "" : markdown)
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((para) => md.renderInline(para.trim()))
    .join("\n\n");
}

/**
 * Event prose renderer.
 *
 * Unlike announcement bodies (rendered INLINE because `.ann-text` uses
 * `white-space: pre-line`), event prose lives in `.prose`, which styles real
 * <p> and <blockquote> elements. So this is a full block render.
 *
 * ONE deviation from markdown-it's default: a blockquote is emitted WITHOUT the
 * <p> markdown-it normally nests inside it. `.prose blockquote` sets its own
 * font-family, size and weight, and `.prose p` would override them on the inner
 * paragraph — the quote would silently render as body text. The live pages have
 * a bare <blockquote>, and this keeps that.
 */
const eventMd = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });
eventMd.validateLink = (url) => SAFE_LINK.test(String(url).trim());
eventMd.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const href = tokens[idx].attrGet("href") || "";
  if (/^https?:/i.test(href)) {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noopener");
  }
  return self.renderToken(tokens, idx, options);
};
{
  let bqDepth = 0;
  eventMd.renderer.rules.blockquote_open = (t, i, o, e, s) => { bqDepth++; return s.renderToken(t, i, o); };
  eventMd.renderer.rules.blockquote_close = (t, i, o, e, s) => { bqDepth--; return s.renderToken(t, i, o); };
  eventMd.renderer.rules.paragraph_open = (t, i, o, e, s) => (bqDepth > 0 ? "" : s.renderToken(t, i, o));
  eventMd.renderer.rules.paragraph_close = (t, i, o, e, s) => (bqDepth > 0 ? "" : s.renderToken(t, i, o));
}
function renderEventBody(markdown) {
  return String(markdown == null ? "" : markdown).replace(/\r\n/g, "\n").trim()
    ? eventMd.render(String(markdown).replace(/\r\n/g, "\n").trim()).trim()
    : "";
}

/* ------------------------------------------------------------ date display */
const EN_MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
// Polish dates take the genitive: "7 lipca 2026", not "7 lipiec 2026".
const PL_MONTHS = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];

/**
 * "2026-07-07" -> "7 July 2026" / "7 lipca 2026".
 *
 * Parsed by splitting the string, never with `new Date(...)`: constructing a
 * Date and reading it back applies the machine's timezone and can shift the day
 * by one either side of UTC. Same input, different output, depending on where
 * the build runs. This is the same hazard the `isoDate` filter guards against.
 */
function formatDate(iso, localeCode) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso);
  const day = Number(m[3]);
  const months = localeCode === "pl" ? PL_MONTHS : EN_MONTHS;
  return `${day} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * An event's full localised title. Shared by the detail template, the listing
 * card and the JSON-LD builders so all three can never disagree.
 *
 * Parts are trimmed and joined with one space — see the `eventTitle` filter for
 * why concatenation was wrong.
 */
function eventTitle(localised) {
  const loc = localised || {};
  if (loc.title) return String(loc.title).trim();
  return [loc.title_lead, loc.title_fancy, loc.title_tail]
    .map((p) => String(p == null ? "" : p).trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * The name used in Event JSON-LD.
 *
 * Usually the display title, but two live pages deliberately differ: the
 * Christmas Dinner and the Icebreaker name the YEAR in structured data
 * ("Annual Christmas Dinner 2025", "Icebreaker 2025") while their visible
 * headings do not. `schema_name` records that override rather than forcing the
 * heading to carry a year it does not show.
 */
function eventSchemaName(localised) {
  const loc = localised || {};
  return loc.schema_name ? String(loc.schema_name).trim() : eventTitle(loc);
}

/**
 * The JSON-LD `organizer` node.
 *
 * The two event families genuinely differ on the live site and both must be
 * reproduced: standard events name the organisation in English on both locales
 * and link the root home page, while the Business Forum names it in the page's
 * own language and links that language's home page. The record shape decides —
 * a localised `organiser` means the localised organisation page.
 */
function buildOrganizer(organiser, locale, site) {
  const localised = organiser && typeof organiser === "object";
  return {
    "@type": "Organization",
    name: localised ? organiser[locale.code] : organiser,
    url: site.domain + "/" + (localised ? locale.urlPrefix : ""),
  };
}

/**
 * Every image referenced by an event record — gallery tiles, the OG and card
 * images, co-organiser logos, and everything inside the Business Forum
 * extension. Derived from the records so exactly what the generated pages need
 * is copied, and adding a partner logo needs no second list updated.
 */
function eventImagePaths() {
  const dir = path.join(__dirname, "content", "events");
  if (!fs.existsSync(dir)) return [];
  const paths = new Set();
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/i.test(file)) continue;
    const rec = yaml.load(fs.readFileSync(path.join(dir, file), "utf8")) || {};
    const add = (p) => { if (p) paths.add(String(p).replace(/^\/+/, "")); };
    add(rec.og_image);
    add(rec.hero_image);
    add(rec.card_image);
    // The dedicated gallery, since Phase 17C.5A.3. The Business Forum still
    // uses its own section list, so both are collected.
    for (const im of ((rec.gallery || {}).images) || []) add(im.src);
    for (const sec of rec.sections || []) for (const im of sec.images || []) add(im.src);
    // Photographs placed inside the Main body as Markdown images.
    for (const locale of ["en", "pl"]) {
      const body = String(((rec[locale] || {}).body) || "");
      for (const m of body.matchAll(/![[^]]*](([^)]+))/g)) add(m[1]);
    }
    for (const co of rec.co_organisers || []) add(co.logo);

    const bf = rec.business_forum;
    if (bf) {
      add((bf.branding || {}).logo);
      // Edition-specific hero backdrop, applied via the --pbf-hero-backdrop
      // custom property rather than an <img>, so it needs copying explicitly.
      add((bf.branding || {}).hero_backdrop);
      add((bf.statistics || {}).background);
      for (const g of bf.galleries || []) for (const im of g.images || []) add(im.src);
      for (const p of bf.people || []) add(p.photo);
      for (const f of bf.people_photo_row || []) add(f.src);
      for (const g of bf.partner_groups || []) for (const lg of g.logos || []) add(lg.image);
      add((bf.funding_acknowledgement || {}).logo);
      if ((bf.forum_ball || {}).enabled) add(bf.forum_ball.image);
    }
  }
  return [...paths].sort();
}

/**
 * Logos referenced by the contact page's initiative cards, as repo-relative
 * paths. Read from the record so the passthrough list is exactly what the page
 * uses and needs no maintenance when an initiative is added.
 */
/**
 * Page-level images referenced by a record under content/pages/ — currently just
 * the events listing's hero photograph, which belongs to the page rather than to
 * any one event. Derived from the record so the list needs no maintenance.
 */
function pageImagePaths() {
  const dir = path.join(__dirname, "content", "pages");
  if (!fs.existsSync(dir)) return [];
  const paths = new Set();
  // Walk the WHOLE record: the homepage nests images inside pillars, the featured
  // gallery and the partner list, and a top-level-only scan silently missed six of
  // them. Any string under an image-named key that points at /assets/ is copied.
  const IMAGE_KEY = /^(hero_image|og_image|card_image|image|photo|logo|src|background|shield_image)$/;
  const walk = (node, key) => {
    if (typeof node === "string") {
      if (IMAGE_KEY.test(String(key)) && node.startsWith("/assets/")) {
        paths.add(node.replace(/^\/+/, ""));
      }
      return;
    }
    if (Array.isArray(node)) { node.forEach((v) => walk(v, key)); return; }
    if (node && typeof node === "object") for (const k of Object.keys(node)) walk(node[k], k);
  };
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/i.test(file)) continue;
    walk(yaml.load(fs.readFileSync(path.join(dir, file), "utf8")) || {}, null);
  }
  return [...paths].sort();
}

function contactLogoPaths() {
  const file = path.join(__dirname, "content", "pages", "contact.yaml");
  if (!fs.existsSync(file)) return [];
  const rec = yaml.load(fs.readFileSync(file, "utf8")) || {};
  const paths = new Set();
  for (const init of rec.initiatives || []) {
    if (init.logo) paths.add(String(init.logo).replace(/^\/+/, ""));
  }
  return [...paths].sort();
}

/**
 * Every society logo referenced by a record, as repo-relative paths, sorted and
 * de-duplicated. Records store a bare filename; the logos live in
 * assets/polsocs/. Driving the passthrough list from the records means exactly
 * the required files are copied and unreferenced ones are left alone.
 */
function societyLogoPaths() {
  const dir = path.join(__dirname, "content", "societies");
  if (!fs.existsSync(dir)) return [];
  const paths = new Set();
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/i.test(file)) continue;
    const rec = yaml.load(fs.readFileSync(path.join(dir, file), "utf8")) || {};
    if (rec.logo) {
      paths.add("assets/polsocs/" + String(rec.logo).replace(/^\/+/, "").replace(/^assets\/polsocs\//, ""));
    }
  }
  return [...paths].sort();
}

/**
 * Every announcement image referenced by a record — main and extra — as
 * repo-relative paths, sorted and de-duplicated. Drives the passthrough list so
 * exactly the required assets are copied and the list never needs maintaining.
 */
function announcementImagePaths() {
  const dir = path.join(__dirname, "content", "announcements");
  if (!fs.existsSync(dir)) return [];
  const paths = new Set();
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/i.test(file)) continue;
    const rec = yaml.load(fs.readFileSync(path.join(dir, file), "utf8")) || {};
    if (rec.image) paths.add(String(rec.image).replace(/^\/+/, ""));
    for (const extra of rec.extra_images || []) {
      paths.add(String(extra).replace(/^\/+/, ""));
    }
  }
  return [...paths].sort();
}

/**
 * Repo-relative paths of every headshot referenced by a team record, sorted and
 * de-duplicated. Read straight from the YAML so the passthrough list is exactly
 * "what the generated pages need" and stays that way without maintenance.
 */
function teamPhotoPaths() {
  const dir = path.join(__dirname, "content", "team");
  if (!fs.existsSync(dir)) return [];

  const paths = new Set();
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/i.test(file)) continue;
    const rec = yaml.load(fs.readFileSync(path.join(dir, file), "utf8")) || {};
    if (rec.photo) paths.add(String(rec.photo).replace(/^\/+/, ""));
  }
  return [...paths].sort();
}

module.exports = function (eleventyConfig) {
  // Content records are YAML (see BUILD_ARCHITECTURE.md §9). Eleventy reads
  // .json/.js natively but needs to be told about .yaml.
  eleventyConfig.addDataExtension("yaml", (contents) => yaml.load(contents));
  eleventyConfig.addDataExtension("yml", (contents) => yaml.load(contents));

  // DETERMINISM GUARD.
  // YAML silently parses an unquoted `2027-03-12` into a JavaScript Date, and
  // Nunjucks stringifies a Date using the LOCAL timezone —
  // "Fri Mar 12 2027 00:00:00 GMT+0000 (Greenwich Mean Time)" here, but
  // "GMT+0100 (Central European Standard Time)" on a machine in Warsaw. Same
  // input, different output. Always render dates through this filter, which
  // formats in UTC and is therefore machine-independent.
  eleventyConfig.addFilter("isoDate", (value) => {
    if (value === undefined || value === null || value === "") return "";
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
  });

  // Absolute, root-relative asset URL. The whole point is that the SAME string
  // is emitted regardless of how deep the page sits, because a relative path
  // resolves against the page URL and silently breaks under /pl/.
  // (docs/CLEANUP_BASELINE.md §5 — this shipped as a live bug once.)
  eleventyConfig.addFilter("asset", (p) => "/" + String(p).replace(/^\/+/, ""));

  /**
   * The style attribute for a stored image focus, or an empty string.
   *
   * Templates never build this themselves — see src/_data/focalPoint.js for why.
   * An absent or unrecognised focus produces NOTHING, which is what keeps every
   * record that has never had one rendering exactly as it did before.
   */
  /**
   * The event's public social posts, already validated and with their embed
   * addresses derived. See src/_data/socialPosts.js — the template renders no
   * editor-supplied markup, only values this produces.
   */
  eleventyConfig.addFilter("socialPosts",
    (event) => require("./src/_data/socialPosts.js").socialPostsFor(event));

  eleventyConfig.addFilter("focalStyleAttr",
    (value) => require("./src/_data/focalPoint.js").focalStyleAttr(value));

  // Public URL for a page, given a locale. English lives at the root, Polish
  // under /pl/, and every page keeps its .html extension.
  eleventyConfig.addFilter("localeUrl", (file, locale) => {
    const prefix = locale && locale.urlPrefix ? locale.urlPrefix : "";
    return "/" + prefix + (file === "index.html" ? "" : file);
  });

  // Resolve a page's URL pattern for a given locale. Each page declares one
  // pattern containing `{prefix}`; the canonical, the hreflang alternates and
  // og:url are all derived from it, so a page's URL is stated exactly once.
  //   "/{prefix}events.html"   -> "/events.html"  and  "/pl/events.html"
  //   "/build-test/{prefix}"   -> "/build-test/"  and  "/build-test/pl/"
  eleventyConfig.addFilter("urlFor", (pattern, locale) =>
    String(pattern).replace("{prefix}", (locale && locale.urlPrefix) || "")
  );

  // Navigation/footer link for a page file, in a given locale.
  //
  //   linkMode "relative" (default) — "team.html". Matches the live pages
  //     exactly: an English page links to "team.html", and a Polish page links
  //     to "team.html" too, which resolves inside /pl/. That relative form is
  //     what keeps each language routed to its own pages.
  //   linkMode "root" — "/pl/team.html". Needed only by 404 pages, which the
  //     server may return from any URL depth, so relative links would break.
  eleventyConfig.addFilter("navHref", (file, locale, linkMode) => {
    if (linkMode === "root") {
      return "/" + ((locale && locale.urlPrefix) || "") + file;
    }
    return file;
  });

  // Fails the BUILD when required page metadata is absent, rather than quietly
  // emitting an empty tag. The brief is explicit: required metadata must fail,
  // not fall back to something broad and wrong.
  eleventyConfig.addFilter("required", (value, fieldName) => {
    if (value === undefined || value === null || String(value).trim() === "") {
      throw new Error(
        `Missing required page metadata: "${fieldName}". ` +
        `Set it in the page's front matter — the shared head partial will not ` +
        `invent a default for it.`
      );
    }
    return value;
  });

  // Members of one group, for one academic year, in display order.
  //
  // Filtering by academic year here is what lets a 2026/27 committee be added
  // later WITHOUT deleting the 2025/26 records: old years stay on disk and
  // simply stop matching.
  //
  // The tie-break is a plain `<` on the slug, not localeCompare: collation
  // depends on the machine's ICU data, which would make the build
  // non-deterministic across machines. Duplicate `order` values inside a group
  // are rejected by scripts/validate.js, so the tie-break is a safety net that
  // should never fire.
  eleventyConfig.addFilter("teamInGroup", (team, groupKey, academicYear) =>
    (team || [])
      .filter(
        (m) =>
          m.published === true &&
          m.academic_year === academicYear &&
          m.group === groupKey
      )
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return String(a.slug) < String(b.slug) ? -1 : 1;
      })
  );

  // Stagger classes on the reveal animation, cycling every four cards within a
  // group: reveal, reveal-d1, reveal-d2, reveal-d3. Matches the live pages.
  eleventyConfig.addFilter("revealClass", (index) => {
    const d = Number(index) % 4;
    return d === 0 ? "member reveal" : `member reveal reveal-d${d}`;
  });

  // Plural member counts. English needs two forms, Polish three:
  //   1 osoba · 2-4 osoby · 5+ osób
  // Forms come from content/settings/team-groups.yaml, so the strings stay in
  // content and only the SELECTION rule lives in code.
  eleventyConfig.addFilter("plural", (count, forms, localeCode) => {
    const n = Number(count);
    if (!forms) return String(n);
    let form;
    if (n === 1 && forms.one) {
      form = forms.one;
    } else if (localeCode === "pl") {
      const mod10 = n % 10;
      const mod100 = n % 100;
      const few = mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14);
      form = few ? forms.few : forms.many;
    } else {
      form = forms.other;
    }
    return String(form).replace("{n}", n);
  });

  // Localised display date from a stored ISO string.
  eleventyConfig.addFilter("displayDate", (iso, localeCode) => formatDate(iso, localeCode));

  // Event prose Markdown -> trusted HTML, rendered at BUILD time.
  eleventyConfig.addFilter("eventBody", (markdown) => renderEventBody(markdown));

  /**
   * An event's full localised title, from whichever shape its family uses.
   *
   * The Business Forum stores one `title`. Standard events store the display
   * title split around the `.fancy` span (`title_lead` / `title_fancy` /
   * `title_tail`), because the middle word is styled differently.
   *
   * The parts are joined with a SINGLE SPACE, not concatenated. Phase 11
   * concatenated them, which rendered "Polish Youth Congress2025" and
   * "AnnualChristmasDinner" — the `<span>` is inline, so it contributes no space
   * of its own. The comparison did not catch it because normalising markup to
   * text replaces tags with whitespace, which papers over exactly this defect.
   * Records store each part trimmed; the separator belongs to the renderer.
   */
  eleventyConfig.addFilter("eventTitle", (localised) => eventTitle(localised));

  /**
   * The homepage-visible subset of an already-grouped, already-ordered event list.
   *
   * The homepage shows only `show_on_homepage: true` events, and only from the
   * current academic year — the events page is the archive, so the timeline never
   * grows a disclosure. Order is inherited from the grouping helper (the record's
   * `order`, scoped to its year), because the live homepage timeline and the live
   * listing are in the SAME order; no separate homepage order exists.
   */
  eleventyConfig.addFilter("homepageEvents", (events) =>
    (events || []).filter((e) => e.show_on_homepage === true)
  );

  /**
   * Prose stored as blank-line-separated paragraphs → an array.
   *
   * Lets a record hold readable multi-paragraph copy without embedding the `<br>`
   * markup the live page happens to use to separate them. The template decides how
   * paragraphs are joined; the record just says where they break.
   */
  eleventyConfig.addFilter("paragraphs", (text) =>
    String(text || "").trim().split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean)
  );

  /**
   * "2025/26" → "2025 / 2026", the long form the listing hero uses.
   *
   * The live eyebrow reads "2025 / 2026 Season" while the watermark reads
   * "2025/26" — two renderings of ONE stored value, so changing the central
   * setting moves both. Returns the input unchanged if it is not a valid
   * academic year, so a bad value is visible rather than silently blanked.
   */
  eleventyConfig.addFilter("academicYearLong", (value) => {
    const m = /^(\d{4})\/(\d{2})$/.exec(String(value || ""));
    if (!m) return String(value || "");
    const start = Number(m[1]);
    return `${start} / ${String(start + 1)}`;
  });

  /**
   * Apply an inline style to the FIRST paragraph of rendered prose.
   *
   * The Business Forum Ball's opening paragraph carries extra bottom spacing on
   * the live page, and `.pbf-ball p` sets only colour — so that inline style is
   * the only thing separating the two paragraphs. It is presentation, so it
   * belongs to the template rather than being stored in the record as markup a
   * marketing officer could break.
   */
  eleventyConfig.addFilter("styleFirstParagraph", (html, style) => {
    const s = String(html);
    const i = s.indexOf("<p>");
    if (i === -1 || !style) return s;
    return s.slice(0, i) + `<p style="${style}">` + s.slice(i + 3);
  });

  /**
   * The visible date for an event, from its machine-readable fields.
   *
   * `date_precision: month` prints "October 2025" / "Październik 2025" — note
   * the Polish month is NOMINATIVE and capitalised when it stands alone, unlike
   * the genitive form used in a full date ("16 października 2025"). Getting that
   * wrong is the kind of thing a generated date silently introduces, so the two
   * cases are formatted separately.
   */
  /**
   * One calendar day, written out in the page's language.
   *
   * Uses the same split-the-string formatter as every other date on the site,
   * never `new Date(...)`, so a build in any timezone renders the same day.
   */
  /**
   * An event's own registration, reduced to what the panel renders.
   *
   * The same shape an announcement resolves to, so both use one template
   * vocabulary — see src/_data/registration.js.
   */
  eleventyConfig.addFilter("eventRegistration",
    (event) => registrationModel.normalise((event || {}).registration));

  eleventyConfig.addFilter("eventDate", (iso, localeCode) => formatDate(iso, localeCode));

  eleventyConfig.addFilter("eventDisplayDate", (event, localeCode) => {
    const iso = String(event.start_date || "");
    if (event.date_precision === "month") {
      const m = iso.match(/^(\d{4})-(\d{2})$/);
      if (!m) return iso;
      const idx = Number(m[2]) - 1;
      if (localeCode === "pl") {
        const NOM = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec",
          "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"];
        return `${NOM[idx]} ${m[1]}`;
      }
      return `${EN_MONTHS[idx]} ${m[1]}`;
    }
    const start = formatDate(iso, localeCode);
    if (!event.end_date) return start;
    // A range shares the month and year when both fall in one month.
    const a = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const b = String(event.end_date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (a && b && a[1] === b[1] && a[2] === b[2]) {
      return `${Number(a[3])}–${formatDate(event.end_date, localeCode)}`;
    }
    return `${start} – ${formatDate(event.end_date, localeCode)}`;
  });

  /**
   * The venue string shown in the facts bar: "Name, Neighbourhood" when a
   * neighbourhood exists, otherwise just the name. ONE source feeds the facts
   * bar, the listing card and the JSON-LD, which is what stops the three
   * drifting apart the way the live pages did (EVENT_RECONCILIATION §5.2).
   */
  eleventyConfig.addFilter("venueDisplay", (venue, localeCode) => {
    if (!venue) return "";
    const name = (venue.name || {})[localeCode] || "";
    const hood = (venue.neighbourhood || {})[localeCode] || "";
    if (hood) return `${name}, ${hood}`;
    // Some pages name the city in the facts bar and some do not — the Youth
    // Congress says "Ognisko Polskie, London" while the Sikorski debate says
    // just the institution. That is a per-event editorial choice, so it is an
    // explicit flag rather than a rule inferred from which fields are set.
    if (venue.show_locality_in_facts) {
      const city = (venue.locality || {})[localeCode] || "";
      return city ? `${name}, ${city}` : name;
    }
    return name;
  });

  // Published standard events for one academic year, in display order.
  eleventyConfig.addFilter("standardEvents", (events, academicYear) =>
    (events || [])
      .filter((e) => e.published === true && e.event_family === "standard" &&
        e.academic_year === academicYear)
      .sort((a, b) => (a.order - b.order) || (String(a.slug) < String(b.slug) ? -1 : 1))
  );

  /**
   * Event JSON-LD, built from the record.
   *
   * Emitted ONLY when the record has a full day-precision date — a month-only
   * value is not accepted by Google's Event rich results, and shipping an
   * incomplete block would assert a date the Federation has not recorded.
   */
  eleventyConfig.addFilter("eventJsonLd", (event, locale, site) => {
    if (event.date_precision !== "day") return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(event.start_date))) return null;
    const loc = event[locale.code] || {};
    const url = `${site.domain}/${locale.urlPrefix}event-${event.slug}.html`;
    const ld = {
      "@context": "https://schema.org",
      "@type": "Event",
      // One builder serves both families; `schema_name` overrides where the live
      // structured data names the year and the visible heading does not.
      name: eventSchemaName(loc),
      description: loc.schema_description,
      image: site.domain + event.og_image,
      startDate: event.start_date,
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: {
        "@type": "Place",
        name: (event.venue.name || {})[locale.code],
        address: {
          "@type": "PostalAddress",
          addressLocality: (event.venue.locality || {})[locale.code],
          addressCountry: event.venue.country,
        },
      },
      organizer: buildOrganizer(event.organiser, locale, site),
      url,
    };
    if (event.end_date) ld.endDate = event.end_date;
    if (Array.isArray(event.performers) && event.performers.length) {
      ld.performer = event.performers.map((p) => ({ "@type": p.type || "Person", name: p.name }));
    }
    if (locale.code !== "en") ld.inLanguage = "pl-PL";
    return JSON.stringify(ld, null, 2);
  });

  // Announcement body Markdown -> trusted HTML, rendered at BUILD time.
  eleventyConfig.addFilter("announcementBody", (markdown) => renderBody(markdown));

  /**
   * Project the canonical records into the flat, locale-specific array the
   * browser renderer consumes.
   *
   * Doing this here rather than in a template means the shape is defined once,
   * in JavaScript that scripts/validate.js and scripts/compare-announcements.js
   * can require and check directly.
   *
   * Ordering is by the explicit `order` field only — never filesystem order,
   * never YAML key order, never a parsed date.
   */
  /**
   * Find a standard event by slug, for announcements that point their
   * registration at one.
   *
   * Read from disk here rather than threaded through the data cascade because
   * `announcementsFor` is a filter and receives only the announcement records.
   * Cached for the build: the files do not change while it runs.
   */
  let eventCache = null;
  const lookupEventBySlug = (slug) => {
    if (!eventCache) {
      eventCache = new Map();
      const dir = path.join(__dirname, "content", "events");
      if (fs.existsSync(dir)) {
        for (const file of fs.readdirSync(dir)) {
          if (!/\.ya?ml$/i.test(file)) continue;
          const data = yaml.load(fs.readFileSync(path.join(dir, file), "utf8")) || {};
          if (data.slug) eventCache.set(String(data.slug), data);
        }
      }
    }
    return eventCache.get(String(slug)) || null;
  };

  eleventyConfig.addFilter("announcementsFor", (records, localeCode, academicYear) =>
    (records || [])
      .filter((a) => a.published === true && a.academic_year === academicYear)
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return String(a.slug) < String(b.slug) ? -1 : 1;
      })
      .map((a) => {
        const loc = a[localeCode] || {};
        const out = {
          slug: a.slug,
          // The display date is generated unless the record carries an explicit
          // override (none currently do — see ANNOUNCEMENTS_MIGRATION.md §3).
          date: loc.date_display || formatDate(a.published_date, localeCode),
          isoDate: a.published_date,
          title: loc.title,
          subtitle: loc.subtitle,
          image: a.image || null,
          bodyHtml: renderBody(loc.body),
        };
        // Optional fields are emitted only when set, so the generated array
        // matches the shape of the hand-written one it replaces.
        if (a.image_position) out.imagePos = a.image_position;
        if (a.image_fit) out.fit = a.image_fit;
        if (a.image_background) out.bg = a.image_background;
        /*
          REGISTRATION.

          `out.closed` is kept exactly as it was, and still drives exactly the
          same markup and wording it always did. That is deliberate: the eight
          records that were `signups_closed: true` became
          `registration.state: closed` in Phase 17C.3, and their pages must not
          change a pixel because of a schema migration. Only genuinely NEW states
          add anything to the page.

          Registration is emitted separately from `link` and never merges with
          it: an announcement may carry a link to the details AND a registration
          button, pointing at different places.
        */
        /*
          RESOLVED, not read directly (Phase 17C.5A.2).

          An announcement may now point its registration at a Federation event
          instead of repeating it. `effectiveRegistration` returns the event's
          current values in that case and the announcement's own otherwise, so
          the twenty-eight migrated records — which carry no `source` key —
          resolve to exactly what they always did.
        */
        const eff = registrationModel.effectiveRegistration(a, lookupEventBySlug);
        const reg = { url: eff.url, opens_on: eff.opensOn, closes_on: eff.closesOn };
        const state = eff.state;

        if (state === "closed") out.closed = true;

        if (state === "coming_soon" || state === "open") {
          out.registration = { state };
          if (state === "open" && reg.url) out.registration.url = reg.url;
          if (reg.opens_on) out.registration.opensOn = reg.opens_on;
          if (reg.closes_on) out.registration.closesOn = reg.closes_on;
        } else if (state === "closed" && reg && reg.closes_on) {
          // A deadline is worth showing beside "closed"; the state itself still
          // renders through `out.closed` above, unchanged.
          out.registration = { state: state, closesOn: reg.closes_on };
        }
        if (a.extra_images && a.extra_images.length) out.extraImages = a.extra_images.slice();
        if (a.link && a.link.type) {
          if (a.link.type === "event") {
            // RELATIVE on purpose: "event-x.html" resolves to the English page
            // from /announcements.html and to the Polish one from
            // /pl/announcements.html. Making this root-relative would send
            // Polish readers to the English event. See §6 of the migration doc.
            out.link = { href: `event-${a.link.event_slug}.html`, text: loc.link_label };
          } else if (a.link.type === "page") {
            out.link = { href: a.link.page, text: loc.link_label };
          } else if (a.link.type === "external") {
            out.link = { href: a.link.url, text: loc.link_label, external: true };
          }
        }
        return out;
      })
  );

  /**
   * Project the canonical society records into the flat, locale-specific array
   * the browser renderer consumes.
   *
   * Ordering is by the explicit `order` field only. The live page then sorts
   * the CARDS alphabetically by name before rendering — that is reproduced in
   * members-page.js, not here, so the data file keeps the canonical order and
   * the presentation choice stays where it belongs. (The two currently
   * coincide; see docs/MEMBERS_MIGRATION.md §4.)
   *
   * `active`, `member` and `past_member` are carried through even though
   * nothing renders them: they are real data about the society's relationship
   * with the Federation, and dropping them would lose information.
   */
  eleventyConfig.addFilter("societiesFor", (records, localeCode) =>
    (records || [])
      .filter((s) => s.published === true)
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return String(a.slug) < String(b.slug) ? -1 : 1;
      })
      .map((s) => {
        const loc = s[localeCode] || {};
        return {
          slug: s.slug,
          name: s.name,
          // Kept as `uni` so the generated array is shape-compatible with the
          // hand-written one it replaces, which keeps the comparison honest.
          uni: loc.university_location,
          lat: s.latitude,
          lng: s.longitude,
          instagram: s.instagram,
          // "" is a real value: three societies publish no address. Never
          // coerce it to null — the renderer tests it to decide whether to emit
          // a mailto: control at all.
          email: s.email || "",
          // Root-relative on purpose. A bare filename or a page-relative path
          // would resolve to /pl/assets/polsocs/… from the Polish page and 404.
          logo: "/assets/polsocs/" + String(s.logo).replace(/^\/+/, ""),
          active: s.active === true,
          member: s.member === true,
          pastMember: s.past_member === true,
        };
      })
  );

  // ---------------------------------------------------------------------
  // Shared assets, copied (not moved, not modified) into dist/ so the chrome
  // comparison pages can load the REAL stylesheet and script when dist/ is
  // served standalone. Without these the responsive test would be meaningless:
  // an unstyled page cannot demonstrate that the header fits a 320px viewport.
  //
  // This is a deliberately MINIMAL list — only what the shared chrome touches.
  // Nothing is renamed or relocated; the originals stay exactly where they are
  // and remain the files the live site serves.
  // ---------------------------------------------------------------------
  eleventyConfig.addPassthroughCopy({ "css/style.css": "css/style.css" });
  // The branded Business Forum overrides. Its own url() references resolve
  // relative to the stylesheet, so no /pl/ variant is needed.
  eleventyConfig.addPassthroughCopy({ "css/pbf.css": "css/pbf.css" });
  eleventyConfig.addPassthroughCopy({ "js/main.js": "js/main.js" });
  eleventyConfig.addPassthroughCopy({ "favicon.ico": "favicon.ico" });
  eleventyConfig.addPassthroughCopy({ "site.webmanifest": "site.webmanifest" });
  // robots.txt is copied byte-for-byte rather than generated: it is three lines of
  // crawler policy with no data to derive, and its Sitemap: line must keep naming
  // the production URL. sitemap.xml IS generated (src/sitemap.njk) because its
  // contents follow from the route inventory.
  eleventyConfig.addPassthroughCopy({ "robots.txt": "robots.txt" });
  eleventyConfig.addPassthroughCopy({ "assets/logo.svg": "assets/logo.svg" });
  eleventyConfig.addPassthroughCopy({ "assets/icons": "assets/icons" });
  // Referenced by css/style.css for the .nav-pbf-logo mask swap.
  eleventyConfig.addPassthroughCopy({
    "assets/pbf/pbf-logo-nav-navy.png": "assets/pbf/pbf-logo-nav-navy.png",
  });
  eleventyConfig.addPassthroughCopy({
    "assets/pbf/pbf-logo-nav-white.png": "assets/pbf/pbf-logo-nav-white.png",
  });

  // ---------------------------------------------------------------------
  // Team page assets.
  // ---------------------------------------------------------------------
  // The team hero photograph, which doubles as the page's og:image.
  eleventyConfig.addPassthroughCopy({
    "assets/pbf/team-steps.jpg": "assets/pbf/team-steps.jpg",
  });
  // The filter behaviour. Source-controlled under src/, copied to dist/js/.
  eleventyConfig.addPassthroughCopy({ "src/js/team-filter.js": "js/team-filter.js" });

  // ---------------------------------------------------------------------
  // Announcement page assets.
  // ---------------------------------------------------------------------
  // The announcements hero photograph, which doubles as the page's og:image.
  eleventyConfig.addPassthroughCopy({ "assets/pbf/crowd.jpg": "assets/pbf/crowd.jpg" });
  // The shared card/modal renderer.
  eleventyConfig.addPassthroughCopy({
    "src/js/announcements-page.js": "js/announcements-page.js",
  });
  // Announcement imagery — main and extra, derived from the records so only
  // what the generated pages reference is copied.
  for (const img of announcementImagePaths()) {
    eleventyConfig.addPassthroughCopy({ [img]: img });
  }

  // ---------------------------------------------------------------------
  // Members page assets.
  // ---------------------------------------------------------------------
  // The members hero photograph, which doubles as the page's og:image.
  eleventyConfig.addPassthroughCopy({
    "assets/pbf/networking-hero.jpg": "assets/pbf/networking-hero.jpg",
  });
  // The shared map/card renderer.
  eleventyConfig.addPassthroughCopy({ "src/js/members-page.js": "js/members-page.js" });
  // Society logos — ONLY those a record actually references. Nothing is
  // renamed, re-encoded or deleted; unreferenced files stay where they are.
  for (const logo of societyLogoPaths()) {
    eleventyConfig.addPassthroughCopy({ [logo]: logo });
  }

  // ---------------------------------------------------------------------
  // Standard-event imagery — galleries, OG images and co-organiser logos.
  for (const img of eventImagePaths()) {
    eleventyConfig.addPassthroughCopy({ [img]: img });
  }

  // Contact page assets — the two initiative logos, derived from the record so
  // the list cannot drift from what the page actually references.
  // ---------------------------------------------------------------------
  for (const logo of contactLogoPaths()) {
    eleventyConfig.addPassthroughCopy({ [logo]: logo });
  }

  // Page-level imagery (the events listing hero), derived from content/pages/.
  // ---------------------------------------------------------------------
  for (const img of pageImagePaths()) {
    eleventyConfig.addPassthroughCopy({ [img]: img });
  }

  // Headshots — ONLY those a record actually references. The list is derived
  // from content/team/*.yaml rather than hard-coded, so it can never drift, and
  // copying the whole directory (which still holds one unreferenced leftover)
  // is avoided. Members with `photo: null` contribute nothing.
  for (const photo of teamPhotoPaths()) {
    eleventyConfig.addPassthroughCopy({ [photo]: photo });
  }

  // ---------------------------------------------------------------------
  // FIXTURES ARE NOT PRODUCTION OUTPUT.
  //
  // src/build-test/ holds architectural proof pages and the archive-disclosure
  // fixture. They must never reach the deployment tree — a test page that ships
  // is a page that can be indexed, linked or crawled by mistake.
  //
  // A normal build IGNORES them entirely. `BUILD_FIXTURES=1` builds ONLY them,
  // into .fixtures/ instead of dist/, so the chrome comparison and the archive-UI
  // test keep their coverage without production ever containing a fixture.
  // ---------------------------------------------------------------------
  const FIXTURES = process.env.BUILD_FIXTURES === "1";
  if (FIXTURES) {
    // Build the fixtures and nothing else: every other template is ignored, so
    // .fixtures/ cannot accidentally become a second copy of the site.
    for (const t of ["src/*.njk"]) eleventyConfig.ignores.add(t);
  } else {
    eleventyConfig.ignores.add("src/build-test/**");
  }

  // ---------------------------------------------------------------------
  // THE ADMIN PANEL IS NOT PRODUCTION OUTPUT.
  //
  // src/admin/ generates the local Decap CMS entry point. It is development
  // tooling: it is configured against a local file-system proxy that writes
  // directly into the working tree, and it carries no authentication whatever.
  // Publishing it would put an unauthenticated content editor on the public
  // internet.
  //
  // A normal build therefore IGNORES it completely, exactly as it ignores the
  // fixtures — so `npm run build` cannot emit dist/admin/ even by accident.
  // `CMS_DEV=1` opts in, and is only ever set by the `cms:*` npm scripts.
  //
  // See docs/CMS_FOUNDATION.md §2.
  // ---------------------------------------------------------------------
  /*
    THREE BUILDS, NOT TWO (Phase 17D.1).

      CMS_DEV=1              the local admin, into .cms/ — unchanged
      CMS_TARGET=production  the public site INCLUDING dist/admin/
      neither                the public site with no admin at all

    The third is still the default, so an ordinary `npm run build` cannot emit
    an admin panel by accident. Production is opted into by one explicit
    variable, set only by `npm run build:production`.
  */
  const CMS_PRODUCTION = process.env.CMS_TARGET === "production" && !FIXTURES;

  /*
    The bundled @netlify/identity library, served beside the login page.

    Copied for every build that emits that page — which is every public build,
    because the footer links to it. Generated by scripts/build-identity.js from
    the pinned package; see src/admin/staff-login.js for why it is self-hosted
    rather than loaded from a CDN.
  */
  if (!FIXTURES) {
    eleventyConfig.addPassthroughCopy({
      "src/admin/netlify-identity.bundle.js": "staff-login/netlify-identity.js",
    });
  }
  const CMS_DEV = process.env.CMS_DEV === "1" && !FIXTURES;
  if (CMS_DEV) {
    // Build ONLY the admin, and into .cms/ rather than dist/.
    //
    // THIS SEPARATION IS THE FIX FOR A REAL EDITOR-FACING BUG. The admin used to
    // be built into dist/, which is also the public build's output directory —
    // so `npm run clean`, `npm run build` and `npm run validate:cms` deleted the
    // files backing a CMS an editor had open. Decap lazy-loads ~90 code-split
    // chunks after first paint, so the page kept working from memory while any
    // not-yet-fetched chunk started returning 404: "Failed to fetch", seemingly
    // at random, in whichever feature the editor happened to reach next.
    //
    // dist/ is now exclusively the public website; .cms/ is exclusively the
    // development CMS runtime, and no public build command touches it.
    for (const t of ["src/*.njk", "src/js/**", "src/build-test/**"]) {
      eleventyConfig.ignores.add(t);
    }
    // The Decap browser bundle, vendored from the pinned package rather than
    // loaded from a CDN. The whole directory is copied, not just the entry
    // file: the bundle is code-split into lazily-loaded chunks that resolve
    // relative to itself, and a missing chunk breaks a widget at the moment an
    // editor uses it.
    //
    // `decap-cms`, not `decap-cms-app`: the latter is a UMD module that leaves
    // React and ReactDOM as externals and does not initialise itself, so it
    // cannot be dropped straight into a <script> tag. `decap-cms` is the
    // self-contained browser build.
    eleventyConfig.addPassthroughCopy({
      "node_modules/decap-cms/dist": "admin",
    });
  } else if (CMS_PRODUCTION) {
    /*
      The production admin, from the same source as the local one — so there is
      one CMS to maintain, not two. What differs is the generated config.yml:
      CMS_TARGET=production switches its backend to the same-origin /api/cms
      Netlify Function. See src/_data/cmsConfig.js and docs/CMS_PRODUCTION.md.

      Bulk manage is emitted here too. It posts to /api/bulk/*, which is the
      local Node server on a developer's machine and a Netlify Function in
      production; the screen does not know the difference.
    */
    eleventyConfig.addPassthroughCopy({ "node_modules/decap-cms/dist": "admin" });
  } else {
    eleventyConfig.ignores.add("src/admin/**");
  }

  return {
    dir: {
      input: "src",
      // Three separate trees, deliberately: .fixtures/ for architectural proof
      // pages, .cms/ for the development admin, dist/ for the public site alone.
      output: FIXTURES ? ".fixtures" : CMS_DEV ? ".cms" : "dist",
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["njk"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
    // No pathPrefix: the site is served from the domain root, so root-relative
    // asset URLs are correct as written.
  };
};
