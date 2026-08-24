/**
 * language-tabs.js — English / Polski tabs in the entry editor.
 *
 * PRESENTATION ONLY. This file shows and hides two panels that Decap has
 * already rendered. It does not touch the store, the entry data, or the shape
 * of what is saved. One record still holds `en:` and `pl:` exactly as before.
 *
 * WHY HIDING, NOT MOVING OR REBUILDING
 *
 * The panels are hidden with `display: none` and nothing else. The React tree
 * stays mounted, so every value an editor has typed into the hidden language is
 * still in the form, still in the store, and still saved. Rebuilding the panels
 * as our own DOM, or detaching and reattaching them, would unmount controls and
 * lose unsaved text — which is the one thing a language switcher must never do.
 *
 * HOW THE PANELS ARE FOUND
 *
 * Decap has no documented API for rearranging the editor form, so this reads the
 * DOM. It deliberately anchors on the two most stable things available, both of
 * which we control or which carry meaning:
 *
 *   - `aria-label="object field"`, Decap's accessibility role for an object
 *     widget — semantic, not a generated class name;
 *   - the field's own label text, which comes from OUR configuration
 *     (`label: "English"` / `label: "Polski"` in src/_data/cmsConfig.js).
 *
 * It does NOT use generated emotion class names, `for` attributes (React reuses
 * DOM nodes between routes, so these go stale), or any Redux internals.
 *
 * Nested `en` / `pl` fields must not be mistaken for the language panels: a
 * standard event has `venue.name.en`, which is a STRING field nested two objects
 * deep. Only a top-level object field qualifies, which is what `nestingDepth`
 * checks. If either panel is missing, nothing happens at all and the form is
 * left exactly as Decap rendered it.
 */

(function () {
  "use strict";

  /* The label text that marks each language panel. These are the labels set in
     src/_data/cmsConfig.js; if they change there, they change here. */
  var LANGUAGES = [
    { code: "en", label: "English", tab: "English" },
    { code: "pl", label: "Polski", tab: "Polski" },
  ];

  var ROOT_CLASS = "fed-lang";
  var HIDDEN_CLASS = "fed-lang-hidden";
  var ACTIVE_CLASS = "fed-lang-tab-active";

  /* -- finding the panels --------------------------------------------------- */

  /** How many object fields wrap this one? Top-level panels answer 0. */
  function nestingDepth(el) {
    var depth = 0;
    var n = el.parentElement;
    while (n) {
      if (n.getAttribute && n.getAttribute("aria-label") === "object field") depth++;
      n = n.parentElement;
    }
    return depth;
  }

  /** The <label> Decap renders for a control, if this element has its own. */
  function ownLabel(control) {
    var label = control.querySelector("label");
    if (!label) return null;
    // Only the control's OWN label counts, not one belonging to a child field.
    var owner = label.closest('[aria-label]');
    return owner === control ? label.textContent.trim() : null;
  }

  /** The two language panels of the currently open editor, or null. */
  function findPanels(scope) {
    var found = {};
    var candidates = scope.querySelectorAll('[aria-label="object field"]');
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (nestingDepth(c) !== 0) continue;
      var text = ownLabel(c);
      if (!text) continue;
      for (var j = 0; j < LANGUAGES.length; j++) {
        // Labels may carry Decap's "(optional)" suffix; match the leading name.
        if (text === LANGUAGES[j].label || text.indexOf(LANGUAGES[j].label + " ") === 0) {
          if (!found[LANGUAGES[j].code]) found[LANGUAGES[j].code] = c;
        }
      }
    }
    return (found.en && found.pl) ? found : null;
  }

  /* -- completeness --------------------------------------------------------- */

  /**
   * Does this panel have a required field the editor has not filled in?
   *
   * Deliberately shallow. It reads the controls already on screen and nothing
   * else: this is a nudge so that a language hidden behind the other tab is not
   * forgotten, NOT a validation system. Decap still refuses the save, and
   * `npm run validate` remains the authority on what is actually required.
   */
  function isIncomplete(panel) {
    var controls = panel.querySelectorAll('[aria-label$="field"]');
    for (var i = 0; i < controls.length; i++) {
      var c = controls[i];
      var label = c.querySelector("label");
      if (!label) continue;
      var text = label.textContent || "";
      // Decap marks optional fields in the label itself; everything else is
      // required. This mirrors what the editor can see rather than re-deriving
      // the schema in the browser.
      if (/\(optional\)/i.test(text)) continue;
      var input = c.querySelector("input, textarea, [data-slate-editor]");
      if (!input) continue;
      var value = input.tagName === "DIV"
        ? (input.textContent || "").trim()
        : (input.value || "").trim();
      if (!value) return true;
    }
    return false;
  }

  /** Does this panel currently show a Decap validation error? */
  function hasError(panel) {
    return /is required|must |cannot /i.test(panel.textContent || "") &&
      Boolean(panel.querySelector('[class*="error"], [class*="Error"]'));
  }

  /* -- the tab bar ---------------------------------------------------------- */

  function buildTabs(panels, container) {
    var bar = document.createElement("div");
    bar.className = ROOT_CLASS + "-tabs";
    bar.setAttribute("role", "tablist");
    bar.setAttribute("aria-label", "Editing language");

    var tabs = {};

    LANGUAGES.forEach(function (lang) {
      var b = document.createElement("button");
      b.type = "button";                 // never submit the entry
      b.className = ROOT_CLASS + "-tab";
      b.setAttribute("role", "tab");
      b.dataset.lang = lang.code;

      var name = document.createElement("span");
      name.className = ROOT_CLASS + "-name";
      name.textContent = lang.tab;

      var mark = document.createElement("span");
      mark.className = ROOT_CLASS + "-mark";
      mark.setAttribute("aria-hidden", "true");

      b.appendChild(name);
      b.appendChild(mark);
      b.addEventListener("click", function () { select(lang.code); });
      bar.appendChild(b);
      tabs[lang.code] = { button: b, mark: mark };
    });

    // Left/right arrows move between tabs, as a tablist should.
    bar.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      select(current === "en" ? "pl" : "en");
      tabs[current].button.focus();
    });

    var current = "en";

    function refreshMarks() {
      LANGUAGES.forEach(function (lang) {
        var panel = panels[lang.code];
        var t = tabs[lang.code];
        var bad = hasError(panel);
        var missing = !bad && isIncomplete(panel);
        t.mark.textContent = bad || missing ? "⚠" : "✓";
        t.button.classList.toggle(ROOT_CLASS + "-warn", bad || missing);
        t.button.setAttribute("aria-label",
          lang.tab + (bad || missing ? " — something still needs filling in" : " — complete"));
      });
    }

    function select(code) {
      current = code;
      LANGUAGES.forEach(function (lang) {
        var on = lang.code === code;
        panels[lang.code].classList.toggle(HIDDEN_CLASS, !on);
        tabs[lang.code].button.classList.toggle(ACTIVE_CLASS, on);
        tabs[lang.code].button.setAttribute("aria-selected", on ? "true" : "false");
        tabs[lang.code].button.tabIndex = on ? 0 : -1;
      });
      refreshMarks();
    }

    container.insertBefore(bar, panels.en);
    select("en");

    return {
      select: select,
      refresh: refreshMarks,
      /**
       * If a hidden language has an error, show it. Called after a failed save:
       * an editor must never be told "you missed a required field" while the
       * field in question is behind the tab they cannot see.
       */
      revealProblem: function () {
        refreshMarks();
        for (var i = 0; i < LANGUAGES.length; i++) {
          var code = LANGUAGES[i].code;
          if (hasError(panels[code])) { select(code); return true; }
        }
        return false;
      },
    };
  }

  /* -- wiring --------------------------------------------------------------- */

  var active = null;

  function enhance() {
    var panels = findPanels(document);

    if (!panels) { active = null; return; }
    // Already enhanced this pair? Just keep the indicators current.
    if (active && active.panels.en === panels.en && active.panels.pl === panels.pl) {
      active.api.refresh();
      return;
    }

    var container = panels.en.parentElement;
    if (!container) return;

    container.classList.add(ROOT_CLASS + "-container");
    active = { panels: panels, api: buildTabs(panels, container) };
  }

  /* Decap re-renders the editor on every route change and on save, so watch
     rather than run once. Debounced: the observer fires very often while typing,
     and the work here should never be on that path. */
  var pending = null;
  function schedule() {
    if (pending) clearTimeout(pending);
    pending = setTimeout(function () {
      pending = null;
      try { enhance(); } catch (e) { /* never break the editor over decoration */ }
    }, 120);
  }

  function start() {
    schedule();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    // A failed save renders errors into a panel that may be hidden.
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.closest && t.closest("button")) {
        setTimeout(function () { if (active) active.api.revealProblem(); }, 400);
      }
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  // Exposed for the browser acceptance tests, which drive the tabs directly
  // rather than hunting for buttons by their generated markup.
  window.fedLanguageTabs = {
    select: function (code) { if (active) active.api.select(code); },
    state: function () {
      if (!active) return null;
      return {
        enHidden: active.panels.en.classList.contains(HIDDEN_CLASS),
        plHidden: active.panels.pl.classList.contains(HIDDEN_CLASS),
      };
    },
  };
})();
