/**
 * advanced-drawer.js — hide the override fields until somebody asks for them.
 *
 * WHAT IT HIDES, AND WHY
 *
 * Every field this collects is an OVERRIDE of something the record already
 * works out for itself: the card and page summaries fall back to Summary, the
 * homepage title to the event title, the search metadata to Summary again. An
 * ordinary event needs none of them. Meeting six near-identical description
 * boxes on the way to writing one is what made the form feel like work.
 *
 * Collapsed, never removed — the four existing events use all of these, and
 * their authored wording still wins.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * A drawer built inside form-sections.js failed twice, in a way I could not
 * explain: every precondition held when queried by hand — both language panels
 * found, all the fields locatable, the plan correct, the function reached and
 * throwing nothing — and yet no drawer appeared. Rather than keep guessing at a
 * module that has been edited many times, this follows image-units.js, which
 * demonstrably works: its own observer, its own state, and one job.
 *
 * LIFECYCLE
 *
 * Idempotent work on every batch of mutations, and the observer DISCONNECTS as
 * soon as both drawers exist. No interval, no polling, no delay constant — the
 * exit condition is the work being finished, not time passing. Route changes
 * re-arm it.
 *
 * The controls are MOVED, never cloned: the same DOM nodes Decap created, so
 * there is one editable control per value and React keeps owning it.
 */

(function () {
  "use strict";

  var ROOT = "fed-adv";

  /* The fields an ordinary editor should not meet first, per language block. */
  var FIELDS = [
    "hero_summary", "card_summary", "timeline_title",
    "seo_title", "seo_description", "schema_description", "schema_name",
    "co_organisers_label",
  ];

  var TITLE = { en: "Advanced", pl: "Zaawansowane" };
  var NOTE = {
    en: "Only needed when this event should say something different from the " +
      "Summary above. Leave these empty and the Summary is used.",
    pl: "Potrzebne tylko wtedy, gdy wydarzenie ma powiedzieć coś innego niż " +
      "Podsumowanie powyżej. Zostaw puste, a użyte zostanie Podsumowanie.",
  };

  function collectionName() {
    var m = /#\/collections\/([^/]+)/.exec(location.hash || "");
    return m ? m[1] : null;
  }

  /** The English or Polski block, identified by the label our own config sets. */
  function languagePanels() {
    var out = [];
    var panels = document.querySelectorAll('[aria-label="object field"]');
    for (var i = 0; i < panels.length; i++) {
      var label = panels[i].querySelector("label");
      if (!label || label.closest('[aria-label$="field"]') !== panels[i]) continue;
      var t = label.textContent.trim();
      if (/^English/.test(t)) out.push({ lang: "en", panel: panels[i] });
      else if (/^Polski/.test(t)) out.push({ lang: "pl", panel: panels[i] });
    }
    return out;
  }

  /** The control container holding a field, within a panel. */
  function controlFor(panel, name) {
    var el = panel.querySelector('[id^="' + name + '-"]');
    return el ? el.closest('[aria-label$="field"]') : null;
  }

  /**
   * Build the drawer for one language panel, or report it is not yet possible.
   *
   * Nothing is created until at least one field is present, so a drawer can
   * never appear empty.
   */
  function attach(entry) {
    var panel = entry.panel;
    if (panel.querySelector("." + ROOT)) return true;

    var found = [];
    for (var i = 0; i < FIELDS.length; i++) {
      var ctl = controlFor(panel, FIELDS[i]);
      if (ctl) found.push(ctl);
    }
    if (!found.length) return false;

    var details = document.createElement("details");
    details.className = ROOT;

    var summary = document.createElement("summary");
    summary.className = ROOT + "-summary";
    summary.textContent = TITLE[entry.lang] || TITLE.en;
    details.appendChild(summary);

    var note = document.createElement("p");
    note.className = ROOT + "-note";
    note.textContent = NOTE[entry.lang] || NOTE.en;
    details.appendChild(note);

    /*
      A native <details> rather than a button and a hidden div: it is closed by
      default with no JavaScript at all, the browser handles the toggle, and it
      stays keyboard- and screen-reader-correct without us reimplementing any of
      that. The failure mode of the previous attempt — a drawer that never
      opened because our own toggle never ran — is not available here.
    */
    found[0].parentElement.insertBefore(details, found[0]);
    for (var j = 0; j < found.length; j++) details.appendChild(found[j]);
    return true;
  }

  /* -- lifecycle ----------------------------------------------------------- */

  var observer = null;
  var armedFor = null;

  function pass() {
    if (collectionName() !== "standard_events") return true;
    var panels = languagePanels();
    if (panels.length < 2) return false;
    var done = true;
    for (var i = 0; i < panels.length; i++) {
      if (!attach(panels[i])) done = false;
    }
    return done;
  }

  function arm() {
    var route = location.hash || "";
    if (armedFor === route && observer) return;
    if (observer) { observer.disconnect(); observer = null; }
    armedFor = route;

    if (pass()) return;

    observer = new MutationObserver(function () {
      try {
        if (pass()) { observer.disconnect(); observer = null; }
      } catch (e) {
        // A convenience layout must never break the editor. Every field is
        // still on the form, wherever it happens to be.
        if (observer) { observer.disconnect(); observer = null; }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener("hashchange", function () { armedFor = null; arm(); });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", arm);
  } else { arm(); }

  window.fedAdvancedDrawer = {
    fields: FIELDS,
    built: function () { return document.querySelectorAll("." + ROOT).length; },
    open: function () {
      return [].filter.call(document.querySelectorAll("." + ROOT), function (d) {
        return d.open;
      }).length;
    },
    observing: function () { return Boolean(observer); },
  };
})();
