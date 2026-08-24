/**
 * form-sections.js — turn a long field list into a form with a shape.
 *
 * The standard event form is the worst case: dozens of top-level fields in one
 * undifferentiated column, so an editor cannot tell which part of the page they
 * are editing, and everything advanced is as prominent as everything ordinary.
 *
 * This groups the fields Decap has already rendered under headings, collapses
 * the sections that are rarely touched, and lays the visibility switches out as
 * one compact row instead of five full-width blocks.
 *
 * PRESENTATION ONLY. Fields are MOVED, never rebuilt: the same DOM nodes are
 * re-parented, so every control stays mounted, keeps its React state and keeps
 * its unsaved value. Nothing here reads or writes entry data.
 *
 * WHY NOT DECAP'S OWN GROUPING
 *
 * Decap can only group fields by nesting them in an `object`, and an object
 * nests in the STORED YAML too. Grouping the event form that way would rewrite
 * every event file and change the canonical schema for a purely visual reason,
 * which the brief rules out. So the grouping lives here, keyed on field NAMES —
 * values this repository controls — and never on generated class names.
 */

(function () {
  "use strict";

  var ROOT = "fed-sec";

  /**
   * The plan, per collection.
   *
   * Each section lists the field names it owns, in the order they should appear.
   * A field not named here stays where it is, so a field added later is visible
   * by default rather than silently disappearing — the safe direction to fail.
   */
  var PLANS = {
    standard_events: [
      { title: "Basic information", open: true,
        fields: ["slug", "academic_year", "start_date", "end_date", "order", "eyebrow"] },
      { title: "Where it happens", open: true, fields: ["venue"] },
      { title: "Visibility", open: true, compact: true,
        fields: ["published", "show_in_listing", "show_on_homepage", "show_in_archive", "flagship"] },
      { title: "Images", open: true,
        fields: ["card_image", "card_image_focus", "og_image"] },
      /*
        Album controls belong together (Phase 17C.5A.2).

        The shared album address used to sit in a section called "Photo album
        and social", while the heading, blurb and button label lived in the
        language blocks. One conceptual thing in two places. The address moves
        into the album unit built below; what is left here is genuinely social.
      */
      { title: "Social", open: false,
        note: "Public post addresses only. Each post also shows a plain link, so " +
          "the page still works if the platform will not embed it.",
        fields: ["instagram_permalink", "facebook_permalink", "linkedin_permalink"] },
      { title: "Co-organisers", open: false, fields: ["co_organisers"] },
      /*
        Registration became a real feature in Phase 17C.5A.2, so it is a real
        section rather than a leftover under "search and sharing" — where it
        had been parked while it was hidden and rendered nothing.
      */
      { title: "Registration", open: true, fields: ["registration"] },
      /*
        THE GALLERY (Phase 17C.5A.3).

        It replaced the tri-array `sections` machinery, and it is optional: most
        events have no gallery, and the ones that do get the photographs after
        the page is already written. Closed, so the form does not open on a
        picture list that is usually empty.

        The object's own `collapsed: true` is in the config and reads correctly,
        but Decap renders this object expanded regardless, so the collapsing is
        done here — by the same mechanism as every other section on the form,
        which is one behaviour to understand rather than two.
      */
      { title: "Gallery", open: false,
        note: "Photographs shown in a grid below the main text. Leave it empty " +
          "if there are none.",
        fields: ["gallery"] },
    ],
    announcements: [
      { title: "Basic information", open: true,
        fields: ["slug", "academic_year", "published_date", "order"] },
      { title: "Visibility", open: true, compact: true, fields: ["published"] },
      { title: "Image", open: true,
        fields: ["image", "image_position", "image_fit", "image_background", "extra_images"] },
      { title: "Registration", open: true, fields: ["registration"] },
      { title: "Destination link", open: false, fields: ["link"] },
    ],
    team: [
      { title: "Basic information", open: true,
        fields: ["slug", "academic_year", "group", "order", "name"] },
      { title: "Visibility", open: true, compact: true, fields: ["published"] },
      { title: "Photograph", open: true, fields: ["photo", "photo_focus"] },
      { title: "Contact", open: true, fields: ["email", "linkedin"] },
    ],
  };

  /*
    THE PER-LANGUAGE ADVANCED DRAWER LIVES IN src/admin/advanced-drawer.js.

    It was tried here first, twice, and never appeared — with every precondition
    verified true by hand each time. Rather than keep guessing at a module that
    does several other jobs, it was rebuilt as its own file on the pattern
    image-units.js already proved: one observer, one job, its own state.

    Nothing is left here for it. Two modules moving the same controls would
    race, and only one of them was ever working.
  */

  /** Which collection is on screen? Read from the route, not from the markup. */
  function collectionName() {
    var m = /#\/collections\/([^/]+)/.exec(location.hash || "");
    return m ? m[1] : null;
  }

  /** Decap's wrapper for one field, and the field name inside it. */
  function fieldName(container) {
    var el = container.querySelector("input, textarea, select, [data-slate-editor]");
    if (el && el.id) {
      var m = /^([a-z0-9_]+)-field-/i.exec(el.id);
      if (m) return m[1];
    }
    // Objects and lists may have no input of their own; fall back to the id of
    // the first descendant that does, which belongs to a child field, so those
    // are matched by label instead.
    return null;
  }

  /**
   * The top-level field containers of the open entry form, in document order.
   *
   * Top-level means "not nested inside another field", which is what stops a
   * sub-field of `venue` being torn out of it.
   */
  function topLevelFields(form) {
    var all = form.querySelectorAll('[aria-label$="field"]');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var parent = el.parentElement ? el.parentElement.closest('[aria-label$="field"]') : null;
      if (!parent) out.push(el);
    }
    return out;
  }

  /**
   * Match a container to a field name.
   *
   * Tries the input id first, then the label text against a name-to-label map
   * built from the labels the config actually uses — both are values this
   * repository owns.
   */
  /**
   * The LABEL is tried first, deliberately.
   *
   * For an object or a list, the first descendant `input` belongs to a CHILD
   * field — the venue group's first input is its town, not the venue — so
   * reading the id would name the wrong field and the group would never be
   * matched. The label belongs to the container itself.
   */
  function nameOf(container, labelMap) {
    var label = container.querySelector("label");
    if (label) {
      var owner = label.closest('[aria-label$="field"]');
      if (owner === container) {
        var text = label.textContent.trim().replace(/\s*\(optional\)\s*$/i, "");
        if (labelMap[text]) return labelMap[text];
      }
    }
    return fieldName(container);
  }

  function buildSection(spec) {
    var sec = document.createElement("section");
    sec.className = ROOT + (spec.compact ? " " + ROOT + "-compact" : "");

    var head = document.createElement("button");
    head.type = "button";
    head.className = ROOT + "-head";
    head.setAttribute("aria-expanded", spec.open ? "true" : "false");

    var caret = document.createElement("span");
    caret.className = ROOT + "-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = "▾";

    var title = document.createElement("span");
    title.className = ROOT + "-title";
    title.textContent = spec.title;

    head.appendChild(caret);
    head.appendChild(title);

    var body = document.createElement("div");
    body.className = ROOT + "-body";
    if (!spec.open) body.hidden = true;

    if (spec.note) {
      var note = document.createElement("p");
      note.className = ROOT + "-note";
      note.textContent = spec.note;
      body.appendChild(note);
    }

    head.addEventListener("click", function () {
      var open = head.getAttribute("aria-expanded") === "true";
      head.setAttribute("aria-expanded", open ? "false" : "true");
      body.hidden = open;
      sec.classList.toggle(ROOT + "-closed", open);
    });

    if (!spec.open) sec.classList.add(ROOT + "-closed");

    sec.appendChild(head);
    sec.appendChild(body);
    return { sec: sec, body: body };
  }

  var lastForm = null;
  var enhancedFor = null;

  function enhance(labelMap) {
    var route = location.hash || "";
    var plan = PLANS[collectionName()];
    if (!plan) return;

    /*
      DONE ALREADY?

      Guarding on the container was not enough. Moving a field into a section
      makes that section's body its new parent, so on the next pass the "form"
      looked like a different element, the guard missed, and the sections were
      built again — twenty times over in testing. The route plus the presence of
      our own markup is the reliable signal: this editor is already arranged.
    */
    if (enhancedFor === route && document.querySelector("." + ROOT)) return;
    if (enhancedFor !== route) lastForm = null;

    // The control list of the open editor. Anchored on Decap's own aria role.
    var anyField = document.querySelector('[aria-label$="field"]:not(.' + ROOT + ' [aria-label$="field"])');
    if (!anyField) return;
    var form = anyField.parentElement;
    if (!form) return;

    var fields = topLevelFields(form);
    if (!fields.length) return;

    // Index the containers by field name.
    var byName = {};
    fields.forEach(function (c) {
      var n = nameOf(c, labelMap);
      if (n && !byName[n]) byName[n] = c;
    });

    // Nothing recognisable? Leave the form exactly as Decap rendered it.
    var recognised = plan.reduce(function (acc, s) {
      return acc + s.fields.filter(function (f) { return byName[f]; }).length;
    }, 0);
    if (recognised < 3) return;

    form.dataset.fedSections = "done";
    lastForm = form;
    enhancedFor = route;

    plan.forEach(function (spec) {
      var owned = spec.fields.map(function (f) { return byName[f]; }).filter(Boolean);
      if (!owned.length) return;
      var built = buildSection(spec);
      // Insert the section where its first field currently sits, so the overall
      // order of the form is preserved rather than reshuffled.
      owned[0].parentElement.insertBefore(built.sec, owned[0]);
      owned.forEach(function (c) { built.body.appendChild(c); });
    });

  }

  /* -- wiring --------------------------------------------------------------- */

  var LABEL_MAP = window.FED_FIELD_LABELS || {};

  var runs = 0;
  var lastError = null;
  var pending = null;
  var lastRun = 0;

  // Throttle with a ceiling — see the note in event-title.js. Decap's editor
  // mutates often enough that a plain debounce never settles.
  var QUIET = 120;
  var CEILING = 600;

  function run() {
    pending = null;
    lastRun = Date.now();
    runs++;
    // Grouping happens once per route; the image units are attempted on every
    // pass because the alt controls live inside the language panels and are not
    // necessarily rendered at the moment the sections are built.
    try { enhance(LABEL_MAP); } catch (e) { lastError = String(e && e.message || e); }
    // The per-language drawers are attempted on every pass: enhance() returns
    // early once the top-level sections exist, and the language panels are not
    // necessarily rendered at that moment.
  }

  function schedule() {
    if (Date.now() - lastRun > CEILING) { if (pending) clearTimeout(pending); return run(); }
    if (pending) clearTimeout(pending);
    pending = setTimeout(run, QUIET);
  }

  // Observer plus a backstop poll — see the note in event-title.js.
  function start() {
    schedule();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    setInterval(function () {
      if (PLANS[collectionName()] && !document.querySelector("." + ROOT)) schedule();
    }, 700);
    window.addEventListener("hashchange", function () { lastForm = null; schedule(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  window.fedFormSections = {
    plans: PLANS,
    count: function () { return document.querySelectorAll("." + ROOT).length; },
    diagnostics: function () { return { runs: runs, lastError: lastError }; },
  };
})();
