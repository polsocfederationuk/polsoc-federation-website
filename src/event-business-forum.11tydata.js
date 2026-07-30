/**
 * Computed data for src/event-business-forum.njk.
 *
 * These live here rather than in the template's YAML front matter because
 * front-matter `eleventyComputed` values are rendered as TEMPLATE STRINGS: a
 * `locale` object assigned that way arrives at the layout as "[object Object]",
 * and every `locale.code` in the shared chrome silently breaks. A JS data file
 * can return real values.
 */

"use strict";

module.exports = {
  eleventyComputed: {
    // The shared chrome reads `locale`; the pagination pair carries it.
    locale: (data) => data.page_pair && data.page_pair.locale,

    // The page's address, stated once — canonical, the hreflang trio, og:url
    // and both language-switcher destinations all derive from it.
    urlPattern: (data) =>
      data.page_pair ? `/{prefix}event-${data.page_pair.event.slug}.html` : null,

    // The Forum is an event: it lights the Events nav item, not one of its own.
    activeNav: () => "events",

    // Branded structure, not content. A marketing officer cannot change these.
    bodyClass: () => "pbf-page",
    stylesheetsAfter: () => ["/css/pbf.css"],

    pageTitle: (data) => localised(data, "seo_title"),
    pageDescription: (data) => localised(data, "seo_description"),

    // The live Forum pages are og:type "article", not the layout's default.
    ogType: () => "article",

    ogImage: (data) => (data.page_pair ? data.page_pair.event.og_image : null),
    ogImageAlt: (data) => localised(data, "og_image_alt"),

    // The Forum's OG image is its own photograph, so the live pages carry no
    // width/height/type — see the matching note in src/event.11tydata.js.
    ogImageWidth: (data) =>
      data.page_pair && data.page_pair.event.og_image === data.site.defaultOgImage
        ? data.site.defaultOgImageWidth
        : null,
    ogImageHeight: (data) =>
      data.page_pair && data.page_pair.event.og_image === data.site.defaultOgImage
        ? data.site.defaultOgImageHeight
        : null,

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
  const localisedOrganiser = event.organiser && typeof event.organiser === "object";
  const ld = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: loc.title
      || [loc.title_lead, loc.title_fancy, loc.title_tail].filter(Boolean).join("").trim(),
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
    organizer: {
      "@type": "Organization",
      name: localisedOrganiser ? event.organiser[locale.code] : event.organiser,
      url: site.domain + "/" + (localisedOrganiser ? locale.urlPrefix : ""),
    },
    url: `${site.domain}/${locale.urlPrefix}event-${event.slug}.html`,
  };
  if (event.end_date) ld.endDate = event.end_date;
  if (Array.isArray(event.performers) && event.performers.length) {
    ld.performer = event.performers.map((p) => ({ "@type": p.type || "Person", name: p.name }));
  }
  if (locale.code !== "en") ld.inLanguage = "pl-PL";
  return JSON.stringify(ld, null, 2);
}
