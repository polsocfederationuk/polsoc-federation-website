/**
 * IT-CONTROLLED Business Forum machinery. NOT content, and NOT a CMS field.
 *
 * Everything here exists because of how the shipped front-end code behaves, not
 * because of an editorial decision. A marketing officer must never see or change
 * any of it: the values are meaningless without the JavaScript and CSS they pair
 * with, and a wrong value breaks the page silently rather than visibly.
 *
 * ---------------------------------------------------------------------------
 * carouselSets — why the partner strips are rendered TWICE
 * ---------------------------------------------------------------------------
 * js/main.js auto-scrolls each `.pbf-carousel` and wraps its scroll position at:
 *
 *     const half = () => car.scrollWidth / 2;
 *
 * That divisor hard-codes exactly two identical tile sequences. With one set the
 * loop never wraps; with three it wraps mid-sequence and the strip visibly jumps.
 * So the repetition is a property of the ANIMATION, not of the partner list.
 *
 * Each partner logo is therefore stored exactly ONCE in
 * content/events/business-forum.yaml, and the template repeats the rendered
 * sequence `carouselSets` times. The duplicated sequence is aria-hidden with
 * empty alt text so assistive technology announces each partner once.
 *
 * If js/main.js is ever rewritten to measure a single set, change this constant
 * and the matching assertion in scripts/validate.js together — they are two
 * halves of the same contract. scripts/compare-business-forum.js independently
 * checks the live pages carry the same number of sequences.
 */

"use strict";

module.exports = {
  carouselSets: 2,
};
