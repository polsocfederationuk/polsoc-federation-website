/**
 * image-units.js — put an image's descriptions next to the image.
 *
 * THE PROBLEM
 *
 * A standard event stores its picture at the top level (`card_image`) and the
 * words describing it inside the language blocks (`en.card_image_alt`,
 * `pl.card_image_alt`). Decap renders fields where they are stored, so the
 * editor met "Main image — alternative text" dozens of fields away from the
 * photograph it describes, with nothing to say which image was meant.
 *
 * WHY THIS IS NOT FIXED IN THE CONFIGURATION
 *
 * Because a Decap field maps one-to-one onto a storage path. Grouping the image
 * and its descriptions in the FORM would mean grouping them in the YAML, and
 * that is a schema migration this phase rules out. Co-organisers already look
 * right for exactly this reason — their logo and names are stored together.
 *
 * So the real controls are MOVED. Not copied: the same DOM nodes Decap created,
 * re-parented, so there is one editable control per value and React keeps
 * owning it. A clone would have been a second source of truth.
 *
 * LIFECYCLE — why this one terminates
 *
 * The previous attempt shared a throttle with the section grouper and lost: its
 * last run happened before the language panels had rendered, and nothing ran
 * afterwards. This has its own observer, does idempotent work on every batch of
 * mutations, and DISCONNECTS as soon as every unit is attached. No interval, no
 * polling, no delay constant — the exit condition is the work being finished,
 * not time passing. Moving to another record re-arms it.
 */

(function () {
  "use strict";

  var ROOT = "fed-imgunit";

  /*
    Which image goes with which descriptions.

    `alt` is the field NAME inside each language block — a value this repository
    controls in src/_data/cmsConfig.js, never a generated class name.
  */
  var UNITS = {
    standard_events: [
      { title: "Main event image", image: "card_image", alt: "card_image_alt",
        focus: "card_image_focus",
        help: "Describe what matters in this image for someone who cannot see it." },
      { title: "Sharing image", image: "og_image", alt: "og_image_alt",
        help: "Used when the page is shared, and by services that read image descriptions." },
    ],
    team: [
      { title: "Photograph", image: "photo", alt: "photo_alt", focus: "photo_focus",
        help: "Describe what matters in this photograph for someone who cannot see it." },
    ],
  };

  function collectionName() {
    var m = /#\/collections\/([^/]+)/.exec(location.hash || "");
    return m ? m[1] : null;
  }

  /** The control container holding a given field, within a scope. */
  function controlFor(scope, name) {
    var el = scope.querySelector('[id^="' + name + '-"]');
    return el ? el.closest('[aria-label$="field"]') : null;
  }

  /**
   * A top-level control, matched by the label our own config gives it.
   *
   * Image pickers expose no input carrying the field name, so the id route
   * cannot find them; the label map built from the configuration can.
   */
  function topLevelControlFor(name) {
    var direct = controlFor(document, name);
    if (direct) return direct;
    var labels = window.FED_FIELD_LABELS || {};
    var all = document.querySelectorAll('[aria-label$="field"]');
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      var label = c.querySelector("label");
      if (!label || label.closest('[aria-label$="field"]') !== c) continue;
      var text = label.textContent.trim().replace(/\s*\(optional\)\s*$/i, "");
      if (labels[text] === name) return c;
    }
    return null;
  }

  /** The English or Polski block. */
  function languagePanel(lang) {
    var panels = document.querySelectorAll('[aria-label="object field"]');
    for (var i = 0; i < panels.length; i++) {
      var label = panels[i].querySelector("label");
      if (!label || label.closest('[aria-label$="field"]') !== panels[i]) continue;
      var t = label.textContent.trim();
      if (lang === "en" && /^English/.test(t)) return panels[i];
      if (lang === "pl" && /^Polski/.test(t)) return panels[i];
    }
    return null;
  }

  function heading(text, cls) {
    var p = document.createElement("p");
    p.className = cls;
    p.textContent = text;
    return p;
  }

  /**
   * Build one unit, or report that it is not yet possible.
   *
   * Idempotent: a unit already built is left alone. Nothing is created until
   * every piece is present, so a half-built block can never appear.
   */
  function attachUnit(unit) {
    if (document.querySelector("[data-" + ROOT + '="' + unit.image + '"]')) return true;

    var imageCtl = topLevelControlFor(unit.image);
    if (!imageCtl) return false;

    var alts = [];
    var langs = ["en", "pl"];
    for (var i = 0; i < langs.length; i++) {
      var panel = languagePanel(langs[i]);
      if (!panel) return false;                 // not rendered yet — try again
      var ctl = controlFor(panel, unit.alt);
      if (!ctl) return false;
      alts.push(ctl);
    }

    var block = document.createElement("section");
    block.className = ROOT;
    block.setAttribute("data-" + ROOT, unit.image);
    block.appendChild(heading(unit.title, ROOT + "-title"));

    imageCtl.parentElement.insertBefore(block, imageCtl);
    block.appendChild(imageCtl);

    var altWrap = document.createElement("div");
    altWrap.className = ROOT + "-alt";
    altWrap.appendChild(heading("Alternative text", ROOT + "-alt-title"));
    altWrap.appendChild(heading(unit.help, ROOT + "-alt-help"));
    /*
      Both languages are shown, stacked, rather than behind a second set of
      tabs. Alt text is one short line, so showing both costs almost nothing and
      avoids nesting a language switch inside the page-level one — two competing
      tab controls on one screen is a worse problem than a little extra height.
    */
    for (var j = 0; j < alts.length; j++) {
      alts[j].classList.add(ROOT + "-altfield");
      altWrap.appendChild(alts[j]);
    }
    block.appendChild(altWrap);

    if (unit.focus) {
      var focusCtl = topLevelControlFor(unit.focus);
      if (focusCtl) block.appendChild(focusCtl);
    }
    return true;
  }

  /* -- lifecycle ----------------------------------------------------------- */

  var observer = null;
  var armedFor = null;

  /*
    THE PHOTO ALBUM (Phase 17C.5A.2).

    One shared address, and a heading, blurb and button label per language.
    Those lived in three different places, so the album read as three unrelated
    settings rather than one thing.

    Built exactly like an image unit and for the same reason: the real controls
    are MOVED, so the address stays a single Decap-owned input. Cloning it per
    language would have produced two boxes writing to one value — the kind of
    duplicate source of truth this phase exists to remove.
  */
  function attachAlbum() {
    if (collectionName() !== "standard_events") return true;
    if (document.querySelector("[data-" + ROOT + '="album"]')) return true;

    var urlCtl = topLevelControlFor("album_url");
    if (!urlCtl) return false;

    var panels = [];
    var langs = ["en", "pl"];
    for (var i = 0; i < langs.length; i++) {
      var panel = languagePanel(langs[i]);
      if (!panel) return false;
      var ctl = controlFor(panel, "album");
      if (!ctl) return false;
      panels.push(ctl);
    }

    /*
      CLOSED BY DEFAULT (Phase 17C.5A.3).

      Four of the five events have no album at all, and the ones that do get it
      weeks after the event. A native <details> is closed before any script runs,
      the browser handles the toggle, and it stays keyboard- and
      screen-reader-correct without us reimplementing any of that.
    */
    var block = document.createElement("details");
    block.className = ROOT + " " + ROOT + "-drawer";
    block.setAttribute("data-" + ROOT, "album");

    var title = document.createElement("summary");
    title.className = ROOT + "-title " + ROOT + "-summary";
    title.textContent = "Photo album";
    block.appendChild(title);

    block.appendChild(heading(
      "Leave the address empty if this event has no album.", ROOT + "-alt-help"));

    urlCtl.parentElement.insertBefore(block, urlCtl);
    block.appendChild(urlCtl);
    for (var j = 0; j < panels.length; j++) {
      panels[j].classList.add(ROOT + "-altfield");
      block.appendChild(panels[j]);
    }
    return true;
  }

  function pass() {
    var units = UNITS[collectionName()];
    if (!units) return true;                    // nothing to do on this screen
    var done = true;
    for (var i = 0; i < units.length; i++) {
      if (!attachUnit(units[i])) done = false;
    }
    if (!attachAlbum()) done = false;
    return done;
  }

  function arm() {
    var route = location.hash || "";
    if (armedFor === route && observer) return;
    if (observer) { observer.disconnect(); observer = null; }
    armedFor = route;

    if (pass()) return;                         // already complete; never observe

    observer = new MutationObserver(function () {
      try {
        if (pass()) { observer.disconnect(); observer = null; }
      } catch (e) {
        // A convenience layout must never break the editor. The real controls
        // are still on the form, wherever they happen to be.
        if (observer) { observer.disconnect(); observer = null; }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener("hashchange", function () { armedFor = null; arm(); });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", arm);
  } else { arm(); }

  window.fedImageUnits = {
    units: UNITS,
    built: function () { return document.querySelectorAll("." + ROOT).length; },
    observing: function () { return Boolean(observer); },
    rearm: function () { armedFor = null; arm(); },
  };
})();
