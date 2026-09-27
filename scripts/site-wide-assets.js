/**
 * site-wide-assets.js — files the generated site adds to EVERY public page
 * that the live pages it is compared against never had.
 *
 * The page comparisons (scripts/compare-*.js) check each page's stylesheets
 * and scripts against the live site, in order. The cookie banner is new and
 * belongs on every page, so each comparison leaves these out of both lists —
 * and scripts/audit-dist.js checks separately that every public page does load
 * them, in this order, so the banner cannot be dropped without a failure.
 *
 * See src/js/consent.js.
 */
"use strict";

const STYLESHEETS = ["/css/cookieconsent.css", "/css/consent.css"];
const SCRIPTS = ["/js/cookieconsent.umd.js", "/js/consent.js"];

const tail = (ref) => String(ref || "").split(/[?#]/)[0].replace(/^(\.\.\/|\.\/)+/, "/").replace(/^([^/])/, "/$1");

/** True for a reference to one of the site-wide files, however it is written. */
function isSiteWide(ref) {
  const t = tail(ref);
  return STYLESHEETS.concat(SCRIPTS).some((f) => t === f || t.endsWith(f));
}

/**
 * Footer links the generated site adds to every page (the privacy policy).
 * Link comparisons leave them out, as they do the staff-login and Netlify
 * links; scripts/compare-chrome.js asserts the link is there.
 */
const FOOTER_LINKS = ["privacy-policy.html"];
function isSiteWideLink(href) {
  const t = String(href || "").split(/[?#]/)[0];
  return FOOTER_LINKS.some((f) => t === f || t.endsWith("/" + f));
}

module.exports = { STYLESHEETS, SCRIPTS, isSiteWide, FOOTER_LINKS, isSiteWideLink };
