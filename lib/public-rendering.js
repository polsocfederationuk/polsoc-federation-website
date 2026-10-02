"use strict";
// Shared by the public Eleventy build and the unsaved CMS preview.
const MarkdownIt = require("markdown-it");
const registrationModel = require("../src/_data/registration.js");
const { groupByAcademicYear } = require("../src/_data/academicYearGroups.js");
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


function registerPublicFilters(eleventyConfig, options = {}) {
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
    (event) => require("../src/_data/socialPosts.js").socialPostsFor(event));

  eleventyConfig.addFilter("focalStyleAttr",
    (value) => require("../src/_data/focalPoint.js").focalStyleAttr(value));

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
  /*
    Every academic year a set of records covers, newest first, with the
    configured current year marked. One helper behind it — see
    src/_data/academicYearGroups.js — so the events, team and announcements
    pages cannot disagree about which year is current or what order years go in.
  */
  eleventyConfig.addFilter("academicYears", (records, currentYear) =>
    groupByAcademicYear(records, currentYear, {
      visible: (r) => r && r.published === true,
    }));

  /**
   * Everyone published in one academic year, whatever their group.
   *
   * Used to decide whether a year has anybody in it at all, which decides
   * whether it renders group headings or a single line saying it is empty.
   */
  eleventyConfig.addFilter("teamInYear", (team, academicYear) =>
    (team || []).filter((m) => m.published === true && m.academic_year === academicYear));

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
  /*
    AT MOST FIVE, NEWEST FIRST.

    The homepage is a taste of the year, not the archive. Without a limit it
    grew by one card every time an event was added, and the section that is
    meant to be scannable became the longest thing on the page.

    Five is the cap; the sixth falls off the homepage and stays on the events
    page, which is uncapped and is where "See all events" underneath points.

    ORDER IS INHERITED, NOT INVENTED. The list arrives sorted by start_date
    descending with a slug tie-break, from the same grouping helper the events
    listing uses, so a new event takes the top position by virtue of its date
    and no second ordering field exists for an editor to maintain — or to get
    wrong. Nothing here reads the filesystem.
  */
  const HOMEPAGE_EVENT_LIMIT = 5;

  eleventyConfig.addFilter("homepageEvents", (events) =>
    (events || []).filter((e) => e.show_on_homepage === true).slice(0, HOMEPAGE_EVENT_LIMIT)
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
  const lookupEventBySlug = options.lookupEventBySlug || (() => null);

  /*
    THE SAME ANNOUNCEMENTS, SPLIT BY ACADEMIC YEAR.

    Deliberately built ON TOP of announcementsFor rather than beside it: that
    filter already decides what a published announcement looks like in one
    locale — the rendered body, the display date, the registration shape — and a
    second projection would be a second thing to keep in step.

    So this asks it once per year and keeps its answer. `announcementsFor`
    itself is untouched, which also leaves scripts/validate.js and
    scripts/compare-announcements.js reading exactly what they always did.
  */
  /**
   * Every visible announcement for a locale, newest first, across all years.
   *
   * The flat list is described as "the ordered array for this page's locale",
   * and it is what the page falls back to when the year data is missing and
   * what the comparison and validation scripts read. It was built from the
   * CURRENT academic year alone, so the moment Site settings moved to a year
   * with nothing in it yet, the array went empty: a fallback that would have
   * rendered nothing, and scripts that saw no announcements at all while 28
   * were sitting in the archive.
   *
   * Ordering is inherited from announcementsFor, applied once across the whole
   * set rather than within a year.
   */
  eleventyConfig.addFilter("announcementsAcrossYears", (records, localeCode) =>
    eleventyConfig.getFilter("announcementsFor")(records, localeCode, undefined, true));

  eleventyConfig.addFilter("announcementYears", (records, localeCode, currentYear) => {
    const published = (records || []).filter((a) => a && a.published === true);
    const groups = groupByAcademicYear(published, currentYear, {});
    return groups.map((year) => ({
      academicYear: year.academicYear,
      label: year.label,
      isCurrent: year.isCurrent,
      items: eleventyConfig.getFilter("announcementsFor")(
        records, localeCode, year.academicYear),
    }));
  });

  /*
    `everyYear` selects the whole visible set instead of one year. The ordering
    and the projection below are identical either way, so the flat list and a
    year's list can never describe the same announcement differently.
  */
  eleventyConfig.addFilter("announcementsFor", (records, localeCode, academicYear, everyYear) =>
    (records || [])
      .filter((a) => a.published === true
        && (everyYear === true || a.academic_year === academicYear))
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
          // Stored as a full path ("/assets/polsocs/x.jpg") since the CMS
          // manages societies; a bare filename from before is still accepted.
          logo: String(s.logo).startsWith("/assets/")
            ? String(s.logo)
            : "/assets/polsocs/" + String(s.logo).replace(/^\/+/, ""),
          active: s.active === true,
          member: s.member === true,
          pastMember: s.past_member === true,
        };
      })
  );

}
module.exports = { registerPublicFilters };
