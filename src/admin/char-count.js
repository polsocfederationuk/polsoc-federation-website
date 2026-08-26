/**
 * char-count.js — "how much of this will look right on the website?"
 *
 * Shows a live count under short text fields, against a length taken from what
 * the site actually renders well rather than from an arbitrary schema number.
 *
 * TWO KINDS OF LIMIT, and the difference matters:
 *
 *   recommended  the length beyond which the design starts to suffer. Warned
 *                about, never enforced — an editor with a good reason wins.
 *   hard         a length beyond which something genuinely breaks. Enforced.
 *
 * Almost every field here has only a recommendation. The layouts wrap, so long
 * text looks worse rather than breaking, and inventing a hard cap would have
 * made existing, deliberately-written copy unsaveable. Every recommendation was
 * set at or above the longest value already in the repository, so nothing that
 * exists today is reported as a problem.
 *
 * COUNTING. `[...string].length`, not `.length` — the latter counts UTF-16 code
 * units, so an emoji would count as two. Polish diacritics are single code
 * points either way, but counting code points is the correct rule to state.
 *
 * Presentation only: this reads values and writes a caption. It never changes
 * what is stored, and it never truncates.
 */

(function () {
  "use strict";

  var ROOT = "fed-count";
  var LIMITS = window.FED_FIELD_LIMITS || {};

  /** Code points, so a two-unit character still counts as one. */
  function count(value) {
    return Array.from(String(value == null ? "" : value)).length;
  }

  /** The field name from a Decap control id such as "summary-field-12". */
  function fieldNameOf(el) {
    var m = /^([a-z0-9_]+)-field-/i.exec(el.id || "");
    return m ? m[1] : null;
  }

  function describe(n, limit) {
    var rec = limit.recommended;
    var hard = limit.hard;
    if (hard && n > hard) {
      return { state: "over", text: n + " / " + hard + " maximum — too long to save" };
    }
    if (rec && n > rec) {
      return { state: "warn", text: n + " / " + rec + " recommended — longer than usual" };
    }
    if (rec && n > rec * 0.85) {
      return { state: "near", text: n + " / " + rec + " recommended" };
    }
    return { state: "ok", text: n + " / " + (rec || hard) + " recommended" };
  }

  function attach(input, limit) {
    if (input.dataset.fedCount === "done") return;
    input.dataset.fedCount = "done";

    var out = document.createElement("p");
    out.className = ROOT;
    out.setAttribute("aria-live", "polite");

    var container = input.closest('[aria-label$="field"]') || input.parentElement;
    if (!container) return;
    container.appendChild(out);

    var update = function () {
      var d = describe(count(input.value), limit);
      out.textContent = d.text;
      out.className = ROOT + " " + ROOT + "-" + d.state;
    };

    input.addEventListener("input", update);
    update();
  }

  function enhance() {
    var inputs = document.querySelectorAll("input[type=text], textarea");
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var name = fieldNameOf(el);
      if (!name) continue;
      var limit = LIMITS[name];
      if (!limit) continue;
      attach(el, limit);
    }
  }

  /* Throttle with a ceiling — Decap mutates the editor about every 110ms, so a
     plain debounce never settles. Same reasoning as the other enhancers. */
  var pending = null;
  var lastRun = 0;
  function run() { pending = null; lastRun = Date.now(); try { enhance(); } catch (e) { /* never break the form */ } }
  function schedule() {
    if (Date.now() - lastRun > 600) { if (pending) clearTimeout(pending); return run(); }
    if (pending) clearTimeout(pending);
    pending = setTimeout(run, 120);
  }

  function start() {
    schedule();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else { start(); }

  window.fedCharCount = { count: count, describe: describe, limits: LIMITS };
})();
