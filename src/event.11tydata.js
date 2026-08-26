/**
 * Computed data for src/event.njk.
 *
 * These live here rather than in the template's YAML front matter because
 * front-matter `eleventyComputed` values are rendered as TEMPLATE STRINGS: a
 * `locale` object assigned that way arrives at the layout as "[object Object]",
 * and every `locale.code` in the shared chrome silently breaks. A JS data file
 * can return real values.
 */

"use strict";

const eventText = require("./_data/eventText.js");
const ui = require("./_data/ui.json");

/**
 * Every piece of wording this page needs, with the Phase 17C.5A fallbacks
 * already applied — see src/_data/eventText.js. Existing records carry their
 * authored overrides and are unaffected; a new record that fills in only
 * Summary gets sensible text in all of these places.
 */
function effective(data) {
  if (!data.page_pair) return null;
  const { event, locale } = data.page_pair;
  const org = ((ui[locale.code] || {}).footer || {}).orgName || "";
  return eventText.effectiveText(event[locale.code] || {}, event, org);
}

module.exports = {
  eleventyComputed: {
    // The shared chrome reads `locale`; the pagination pair carries it.
    locale: (data) => data.page_pair && data.page_pair.locale,

    // The page's address, stated once — canonical, the hreflang trio, og:url
    // and both language-switcher destinations all derive from it.
    urlPattern: (data) =>
      data.page_pair ? `/{prefix}event-${data.page_pair.event.slug}.html` : null,

    activeNav: () => "events",

    pageTitle: (data) => { const e = effective(data); return e ? e.searchTitle || null : null; },
    pageDescription: (data) => { const e = effective(data); return e ? e.searchDescription || null : null; },

    // The live event pages are og:type "article", not the layout's "website"
    // default.
    ogType: () => "article",

    ogImage: (data) => (data.page_pair ? data.page_pair.event.og_image : null),
    ogImageAlt: (data) => localised(data, "og_image_alt"),

    // Extended image fields only when the page uses the shared Federation
    // banner, whose dimensions site.json declares. An event's own photograph has
    // no known size and the live pages omit these for exactly that reason —
    // inventing numbers would be worse than leaving them out.
    ogImageWidth: (data) => (usesSharedBanner(data) ? data.site.defaultOgImageWidth : null),
    ogImageHeight: (data) => (usesSharedBanner(data) ? data.site.defaultOgImageHeight : null),

    /**
     * Event JSON-LD, injected into the shared <head>.
     *
     * The filter returns null for a record without a full day-precision date,
     * and this emits nothing in that case rather than an incomplete Event block.
     */
    extraHead: (data) => {
      if (!data.page_pair) return null;
      const { event, locale } = data.page_pair;
      const ld = buildJsonLd(event, locale, data.site);
      return ld ? `  <script type="application/ld+json">\n${ld}\n  </script>` : null;
    },
  },
};

function localised(data, field) {
  if (!data.page_pair) return null;
  const { event, locale } = data.page_pair;
  return (event[locale.code] || {})[field] || null;
}

/** True when the event's OG image is the shared Federation banner. */
function usesSharedBanner(data) {
  if (!data.page_pair) return false;
  return data.page_pair.event.og_image === data.site.defaultOgImage;
}

/**
 * Duplicated deliberately from the `eventJsonLd` filter in eleventy.config.js:
 * Eleventy filters are not callable from a data file, and importing the config
 * would execute the whole plugin registration. scripts/validate.js asserts the
 * two produce the same result on every generated page, so a drift between them
 * fails the build rather than shipping.
 */
function buildJsonLd(event, locale, site) {
  if (event.date_precision !== "day") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(event.start_date))) return null;
  const loc = event[locale.code] || {};
  // Structured data uses the same fallback chain the page and card use.
  const org = ((ui[locale.code] || {}).footer || {}).orgName || "";
  const eff = eventText.effectiveText(loc, event, org);
  const ld = {
    "@context": "https://schema.org",
    "@type": "Event",
    // Mirrors eventSchemaName() in eleventy.config.js: parts joined with a
    // SPACE (the `.fancy` span is inline and adds none), and `schema_name`
    // overriding where the live JSON-LD names the year but the heading does not.
    name: eff.structuredName,
    description: eff.structuredDescription,
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
    organizer: { "@type": "Organization", name: event.organiser, url: site.domain + "/" },
    url: `${site.domain}/${locale.urlPrefix}event-${event.slug}.html`,
  };
  if (event.end_date) ld.endDate = event.end_date;
  if (Array.isArray(event.performers) && event.performers.length) {
    ld.performer = event.performers.map((p) => ({ "@type": p.type || "Person", name: p.name }));
  }
  if (locale.code !== "en") ld.inLanguage = "pl-PL";
  return JSON.stringify(ld, null, 2);
}
