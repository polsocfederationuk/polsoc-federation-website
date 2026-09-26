/**
 * Groups optional event wording into a collapsed section. The original Decap
 * controls remain mounted and their values are never rewritten by this helper.
 */

(function () {
  "use strict";

  var ROOT = "fed-adv";

  /* The fields an ordinary editor should not meet first, per language block. */
  var FIELDS = [
    "hero_summary", "card_summary", "timeline_summary", "eyebrow",
    "seo_title", "seo_description", "schema_description", "schema_name",
    "co_organisers_label",
  ];

  var TITLE = { en: "Optional wording for cards and search", pl: "Opcjonalne teksty na kartach i w wyszukiwarce" };
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

    // Native details starts closed; the form helper reveals validation errors.
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
        return d.tagName !== "DETAILS" || d.open;
      }).length;
    },
    observing: function () { return Boolean(observer); },
  };
})();
