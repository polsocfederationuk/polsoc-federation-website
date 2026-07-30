/**
 * Computed data for src/index.njk.
 *
 * Lives here rather than in front matter because `eleventyComputed` values in
 * YAML are rendered as TEMPLATE STRINGS, which turns objects into
 * "[object Object]". See src/event.11tydata.js.
 */

"use strict";

module.exports = {
  eleventyComputed: {
    // The page's address, stated once — canonical, the hreflang trio, og:url and
    // both language-switcher destinations all derive from it. The homepage's
    // public URLs are "/" and "/pl/", not "/index.html".
    urlPattern: () => "/{prefix}",
    activeNav: () => "home",

    pageTitle: (data) => localised(data, "seo_title"),
    pageDescription: (data) => localised(data, "seo_description"),

    // The live homepages are og:type "website" (the layout default) and use the
    // shared Federation banner, whose dimensions site.json declares — so the
    // extended og:image fields are emitted, exactly as live.
    ogImage: (data) => data.site.defaultOgImage,
    ogImageAlt: (data) => localised(data, "og_image_alt"),
    ogImageWidth: (data) => data.site.defaultOgImageWidth,
    ogImageHeight: (data) => data.site.defaultOgImageHeight,

    extraHead: (data) => {
      const ld = buildOrganizationJsonLd(data);
      return ld ? `  <script type="application/ld+json">\n${ld}\n  </script>` : null;
    },
  },
};

function localised(data, field) {
  const home = data.records && data.records.pages && data.records.pages.home;
  if (!home || !data.locale) return null;
  return (home[data.locale.code] || {})[field] || null;
}

/**
 * Organization JSON-LD for the homepage.
 *
 * Almost every field is shared, including the organisation's PRIMARY name, which
 * is the Polish legal name on both pages — that is deliberate on the live site and
 * is preserved, not "corrected" to match the page language. Only `description`,
 * `url` and `inLanguage` vary by locale.
 *
 * `sameAs` carries exactly the three confirmed Federation profiles. The Polish
 * Business Forum and The Lambert are separate initiatives and are NOT
 * Federation-level profiles in the live schema, so they are not added.
 *
 * The postal address is present on BOTH live homepages and is reproduced for
 * production equivalence. Whether the Federation's correspondence address belongs
 * in Organization structured data is a governance/SEO question this phase does not
 * settle — it is modelled as one shared block in site.json so it can be removed in
 * one place. See docs/HOMEPAGE_MIGRATION.md §12.
 */
function buildOrganizationJsonLd(data) {
  const { site, locale } = data;
  const home = data.records && data.records.pages && data.records.pages.home;
  if (!site || !locale || !home) return null;
  const org = site.organization;
  if (!org) return null;

  const ld = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: org.name,
    alternateName: org.alternateName,
    url: site.domain + "/" + locale.urlPrefix,
    logo: site.domain + org.logo,
    image: site.domain + org.image,
    description: (home[locale.code] || {}).schema_description,
    email: org.email,
    foundingDate: org.foundingDate,
    identifier: {
      "@type": "PropertyValue",
      name: org.identifier.name,
      value: org.identifier.value,
    },
    address: {
      "@type": "PostalAddress",
      streetAddress: org.address.streetAddress,
      addressLocality: org.address.addressLocality,
      postalCode: org.address.postalCode,
      addressCountry: org.address.addressCountry,
    },
    sameAs: org.sameAs,
  };
  if (locale.code !== "en") ld.inLanguage = "pl-PL";
  return JSON.stringify(ld, null, 2);
}
