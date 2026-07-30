/**
 * IT-CONTROLLED homepage machinery. NOT content, and NOT a CMS field.
 *
 * Both values below exist because of how the shipped CSS and JavaScript animate,
 * not because of any editorial decision. A marketing officer must never see them:
 * they are meaningless without the code they pair with, and a wrong value breaks
 * an animation silently rather than visibly.
 *
 * ---------------------------------------------------------------------------
 * partnerMarqueeSets — why the partner strip is rendered TWICE
 * ---------------------------------------------------------------------------
 * js/main.js drives every `.pbf-carousel-wrap` and wraps its scroll position at
 * `car.scrollWidth / 2`. That divisor hard-codes exactly two identical tile
 * sequences: with one the loop never wraps, with three it wraps mid-sequence and
 * the strip visibly jumps. Each partner is stored ONCE in
 * content/pages/home.yaml and the template repeats the rendered set.
 *
 * Shares its reasoning — and its value — with
 * src/_data/businessForumTechnical.js, but stays a separate constant because the
 * two pages could in principle diverge and the Forum's file documents its own.
 *
 * ---------------------------------------------------------------------------
 * tickerRuns — why the ticker phrases are rendered TWICE
 * ---------------------------------------------------------------------------
 * `.ticker-track` is animated by CSS translation. The live markup contains the
 * phrase run twice so the second copy has scrolled into place as the first leaves,
 * giving a seamless loop. One run would show a gap on every cycle.
 *
 * The whole `.ticker` is `aria-hidden="true"` on the live pages, so the
 * repetition raises no accessibility question here — assistive technology never
 * reaches either copy.
 *
 * If either animation is ever rewritten, change the constant and the matching
 * assertion in scripts/validate.js together; they are halves of one contract.
 */

"use strict";

module.exports = {
  partnerMarqueeSets: 2,
  tickerRuns: 2,
};
