/**
 * Team group filter.
 *
 * Extracted to a real source file because one copy serving both languages is
 * easier to maintain than two inline copies drifting apart.
 *
 * Contains NO display strings. Every visible label lives in
 * content/settings/team-groups.yaml and is rendered into the markup at build
 * time, so this file is language-agnostic and never needs translating.
 *
 * ACCESSIBILITY (Phase 5): the chips are native <button>s inside a labelled
 * role="group", each carrying aria-pressed. Every filter change moves BOTH the
 * visual `.active` class and the pressed state to the clicked chip, so the
 * state a sighted user sees and the state announced to assistive technology
 * cannot diverge. Both are set from the same loop for exactly that reason.
 *
 * No keyboard handlers are registered. These are real buttons, so Enter and
 * Space already fire `click`, and Tab already reaches them. Adding key handlers
 * would risk double-firing.
 *
 * Fails safely: on a page with no chips or no team sections it binds nothing
 * and returns, so it is harmless if loaded anywhere else.
 *
 * Copied to dist/js/team-filter.js by eleventy.config.js. It does NOT replace,
 * modify or load alongside the live root js/main.js.
 */
(function () {
  "use strict";

  var ALL = "all";

  /*
    ONE BAR PER ACADEMIC YEAR, EACH GOVERNING ITS OWN.

    The team page shows every year it has, each in its own collapsible section
    with its own set of chips. A single page-wide query would make a chip in one
    year hide sections in another — including years the reader has collapsed and
    cannot see reappear.

    So each bar is wired to the year that contains it. Where there is no year
    section — any other page using these chips — the scope falls back to the
    document and the behaviour is exactly what it was.
  */
  function init() {
    var bars = document.querySelectorAll(".filter-bar");
    if (!bars.length) return;
    Array.prototype.forEach.call(bars, function (bar) { wire(bar); });
  }

  function wire(bar) {
    var scope = (bar.closest && bar.closest(".year-section")) || document;
    var chips = bar.querySelectorAll(".chip");
    var groups = scope.querySelectorAll(".team-section");

    // Nothing to filter — not the team page, or the markup changed shape.
    if (!chips.length || !groups.length) return;

    function select(chip) {
      // One pass over every chip guarantees the two states stay in step and
      // that exactly one chip ends up active and pressed.
      Array.prototype.forEach.call(chips, function (c) {
        var on = c === chip;
        c.classList.toggle("active", on);
        c.setAttribute("aria-pressed", on ? "true" : "false");
      });

      var f = chip.dataset.filter;

      Array.prototype.forEach.call(groups, function (g) {
        var show = f === ALL || g.dataset.group === f;
        g.classList.toggle("hidden", !show);

        if (show) {
          // Re-trigger the reveal animation on cards in the shown group.
          Array.prototype.forEach.call(
            g.querySelectorAll(".reveal"),
            function (el, i) {
              el.classList.remove("visible");
              setTimeout(function () {
                el.classList.add("visible");
              }, 60 + i * 50);
            }
          );
        }
      });
    }

    Array.prototype.forEach.call(chips, function (chip) {
      chip.addEventListener("click", function () {
        select(chip);
      });
    });
  }

  // The live page's inline script runs after the markup because it sits at the
  // end of <body>. This file is loaded the same way, but the readyState guard
  // keeps it correct if it is ever moved into <head> or loaded with defer.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
