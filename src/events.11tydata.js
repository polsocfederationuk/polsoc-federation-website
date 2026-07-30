/**
 * Computed data for src/events.njk.
 *
 * Lives here rather than in the template's YAML front matter because
 * front-matter `eleventyComputed` values are rendered as TEMPLATE STRINGS, which
 * turns objects into "[object Object]". See src/event.11tydata.js.
 */

"use strict";

module.exports = {
  eleventyComputed: {
    // The page's address, stated once — canonical, the hreflang trio, og:url and
    // both language-switcher destinations all derive from it.
    urlPattern: () => "/{prefix}events.html",
    activeNav: () => "events",

    pageTitle: (data) => localised(data, "seo_title"),
    pageDescription: (data) => localised(data, "seo_description"),

    // The live listing pages are og:type "website" (unlike the event detail
    // pages, which are "article"), so the layout default is correct here.
    ogImage: () => "/assets/pbf/stage.jpg",
    ogImageAlt: (data) => localised(data, "og_image_alt"),
  },
};

function localised(data, field) {
  const page = data.records && data.records.pages && data.records.pages.events;
  if (!page || !data.locale) return null;
  return (page[data.locale.code] || {})[field] || null;
}
