/**
 * Team group filter.
 *
 * Behaviourally identical to the inline <script> at the bottom of the live
 * team.html / pl/team.html. Extracted to a real source file because Phase 4's
 * brief prefers "a small dedicated source script" where it makes the behaviour
 * easier to maintain: one copy now serves both languages instead of two inline
 * copies drifting apart.
 *
 * Contains NO display strings. Every visible label lives in
 * content/settings/team-groups.yaml and is rendered into the markup at build
 * time, so this file is language-agnostic and never needs translating.
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

  function init() {
    var chips = document.querySelectorAll(".filter-bar .chip");
    var groups = document.querySelectorAll(".team-section");

    // Nothing to filter — not the team page, or the markup changed shape.
    if (!chips.length || !groups.length) return;

    Array.prototype.forEach.call(chips, function (chip) {
      chip.addEventListener("click", function () {
        Array.prototype.forEach.call(chips, function (c) {
          c.classList.remove("active");
        });
        chip.classList.add("active");

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
