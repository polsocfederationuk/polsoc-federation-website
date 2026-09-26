/**
 * Content-first administrative forms. Existing Decap controls are moved as
 * intact units; values, validation and the saved YAML structure stay unchanged.
 */
(function () {
  "use strict";
  var PLANS = {
    team: [
      { title: "Profile", lane: "main", columns: true, fields: ["name", "group"] },
      { title: "Role", lane: "main", languages: true, fields: ["en", "pl"] },
      { title: "Contact", lane: "main", columns: true, fields: ["email", "linkedin"] },
      { title: "Photo", lane: "side", disclosure: true, fields: ["photo", "photo_focus"] },
      { title: "Website", lane: "side", fields: ["published", "academic_year", "order"] },
      { title: "Record ID", lane: "side", disclosure: true, fields: ["slug"] }
    ],
    standard_events: [
  {
    "title": "Event details",
    "lane": "main",
    "languages": true,
    "columns": false,
    "fields": [
      "en",
      "pl"
    ]
  },
  {
    "title": "Date and venue",
    "lane": "main",
    "columns": true,
    "fields": [
      "start_date",
      "end_date",
      "academic_year",
      "venue"
    ],
    "wide": [
      "venue"
    ]
  },
  {
    "title": "Images",
    "lane": "main",
    "columns": true,
    "fields": [
      "card_image",
      "card_image_focus",
      "og_image"
    ]
  },
  {
    "title": "Registration",
    "disclosure": true,
    "lane": "main",
    "fields": [
      "registration"
    ]
  },
  {
    "title": "Gallery",
    "disclosure": true,
    "lane": "main",
    "fields": [
      "gallery"
    ]
  },
  {
    "title": "Photo album",
    "disclosure": true,
    "lane": "main",
    "fields": [
      "album_url"
    ]
  },
  {
    "title": "Social posts",
    "disclosure": true,
    "lane": "main",
    "columns": true,
    "fields": [
      "instagram_permalink",
      "facebook_permalink",
      "linkedin_permalink"
    ]
  },
  {
    "title": "Co-organisers",
    "disclosure": true,
    "lane": "main",
    "fields": [
      "co_organisers"
    ]
  },
  {
    "title": "Website visibility",
    "lane": "main",
    "columns": true,
    "fields": [
      "published",
      "show_in_listing",
      "show_on_homepage",
      "show_in_archive",
      "flagship"
    ]
  },
  {
    "title": "Record ID",
    "disclosure": true,
    "lane": "main",
    "fields": [
      "slug",
      "order"
    ]
  }
],
    announcements: [
      { title: "Announcement", lane: "main", languages: true, fields: ["en", "pl"] },
      { title: "Image", lane: "main", disclosure: true, fields: ["image"] },
      { title: "Registration", lane: "main", disclosure: true, fields: ["registration"] },
      { title: "Button link", lane: "main", disclosure: true, fields: ["link"] },
      { title: "More images", lane: "main", disclosure: true, fields: ["extra_images"] },
      { title: "Image appearance", lane: "main", disclosure: true,
        fields: ["image_position", "image_fit", "image_background"] },
      { title: "Website", lane: "side", fields: ["published", "published_date", "academic_year", "order"] },
      { title: "Record ID", lane: "side", disclosure: true, fields: ["slug"] }
    ]
  };

  if (typeof module !== "undefined" && module.exports) module.exports = { plans: PLANS };
  if (typeof window === "undefined") return;
  var observer, pending = null, serial = 0, runs = 0, lastError = null;

  function collectionName() {
    var match = /#\/collections\/([^/]+)\/(?:new|entries\/)/.exec(location.hash || "");
    return match ? match[1] : null;
  }
  function element(tag, className, text) {
    var el = document.createElement(tag);
    el.className = className;
    if (text) el.textContent = text;
    return el;
  }
  function nameOf(container) {
    var label = container.querySelector("label");
    if (label && label.closest('[aria-label$="field"]') === container) {
      var text = label.textContent.trim().replace(/\s*\(optional\)\s*$/i, "");
      var name = (window.FED_FIELD_LABELS || {})[text];
      if (name) return name;
    }
    var input = container.querySelector("input, textarea, select, [data-slate-editor]");
    var match = input && /^([a-z0-9_]+)-field-/i.exec(input.id || "");
    return match ? match[1] : null;
  }
  function rootFields(form) {
    return Array.prototype.filter.call(form.querySelectorAll('[aria-label$="field"]'), function (field) {
      return !field.parentElement.closest('[aria-label$="field"]');
    });
  }
  function buildSection(spec) {
    var sec = element(spec.disclosure ? "details" : "section",
      "fed-sec" + (spec.disclosure ? " fed-sec-disclosure" : ""));
    var head = element(spec.disclosure ? "summary" : "h2", "fed-sec-heading", spec.title);
    if (spec.disclosure) head.appendChild(element("span", "fed-optional-label", spec.title === "Record ID" ? "Advanced" : "Optional"));
    head.id = "fed-section-" + (++serial);
    sec.setAttribute("aria-labelledby", head.id);
    sec.appendChild(head);
    var body = element("div", "fed-sec-body" + (spec.columns ? " fed-sec-pair" : ""));
    sec.appendChild(body);
    return { sec: sec, body: body };
  }

  function enhance() {
    var plan = PLANS[collectionName()];
    if (!plan || document.querySelector(".fed-editor-layout")) return;
    var any = document.querySelector('[aria-label$="field"]');
    if (!any) return;
    while (any.parentElement.closest('[aria-label$="field"]')) {
      any = any.parentElement.closest('[aria-label$="field"]');
    }
    var form = any.parentElement;
    var byName = {};
    rootFields(form).forEach(function (field) {
      var name = nameOf(field);
      if (name && !byName[name]) byName[name] = field;
    });
    if (!byName.en || !byName.pl || !byName.published || !byName.academic_year) return;

    // Use the actual editor width (not the browser width) for the layout:
    // Decap can place this form in a narrower pane.
    form.classList.add("fed-editor");
    if (collectionName() === "standard_events") form.classList.add("fed-events-form");
    var layout = element("div", "fed-editor-layout");
    var main = element("div", "fed-editor-main");
    var side = element("aside", "fed-editor-side");
    side.setAttribute("aria-label", "Record settings");
    layout.appendChild(main);
    layout.appendChild(side);
    form.insertBefore(layout, form.firstChild);
    var moved = [];

    plan.forEach(function (spec) {
      var owned = spec.fields.map(function (name) {
        var field = byName[name];
        // Preserve already-built image/album units, including translations.
        return field && (field.closest(".fed-imgunit") || field);
      }).filter(function (field, index, all) {
        return field && all.indexOf(field) === index && moved.indexOf(field) === -1;
      });
      if (!owned.length) return;
      var built = buildSection(spec);
      if (spec.languages && collectionName() === "standard_events") built.sec.classList.add("fed-event-languages");
      if (spec.languages) {
        var bar = form.querySelector(".fed-lang-tabs");
        if (bar) built.body.appendChild(bar);
      }
      owned.forEach(function (field) {
        built.body.appendChild(field);
        if (spec.wide && spec.wide.some(function (name) { return byName[name] === field; })) field.classList.add("fed-span-all");
        moved.push(field);
      });
      // An album unit already supplies a disclosure. A second nested
      // disclosure would make users expand the same feature twice.
      if (spec.fields.indexOf("album_url") !== -1) {
        var album = built.body.querySelector("details.fed-imgunit");
        if (album) album.open = true;
      }
      (spec.lane === "side" ? side : main).appendChild(built.sec);
    });
    // New or unrecognised fields remain in their original form. Never hide them.
  }

  function flattenObjects() {
    var form = document.querySelector(".fed-editor");
    if (!form) return;
    Array.prototype.forEach.call(form.querySelectorAll('[aria-label="object field"]'), function (field) {
      // Decap 3.15.1 ObjectControl: direct ID wrapper, then top bar and fields.
      // Only mark that verified structure. List Add/remove controls are untouched.
      var control = Array.prototype.find.call(field.children, function (child) { return Boolean(child.id); });
      if (!control || control.children.length !== 2) return;
      var top = control.children[0], body = control.children[1];
      if (!top.querySelector('[data-testid="expand-button"]')) return;
      control.classList.add("fed-flat-object");
      top.classList.add("fed-object-toggle");
      body.classList.add("fed-object-fields");
      var children = Array.prototype.filter.call(body.children, function (child) {
        return /field$/.test(child.getAttribute("aria-label") || "");
      });
      if (children.length === 2 && children[0].querySelector('[id^="en-field-"]') && children[1].querySelector('[id^="pl-field-"]')) {
        body.classList.add("fed-bilingual-pair");
      }
      if (/^registration-field-/.test(control.id)) {
        body.classList.add("fed-registration-grid");
        children.forEach(function (child) {
          if (child.querySelector('[id^="state-field-"], [id^="url-field-"]')) child.classList.add("fed-span-all");
        });
      }
    });
  }
  function revealErrors() {
    var form = document.querySelector(".fed-editor");
    if (!form) return;
    var errors = form.querySelectorAll('[aria-invalid="true"], [role="alert"], [class*="ControlError"]');
    Array.prototype.forEach.call(errors, function (error) {
      if (!error.textContent.trim() && error.getAttribute("aria-invalid") !== "true") return;
      var parent = error.parentElement;
      while (parent && parent !== form) {
        if (parent.tagName === "DETAILS" && !parent.open) parent.open = true;
        parent = parent.parentElement;
      }
    });
  }
  function finishUnits() {
    // image-units.js may attach the album after the form has been arranged.
    var album = document.querySelector(".fed-sec-disclosure details[data-fed-imgunit='album']");
    if (album && !album.open) album.open = true;
  }
  function run() {
    pending = null;
    runs++;
    if (observer) observer.disconnect();
    try { enhance(); flattenObjects(); finishUnits(); revealErrors(); }
    catch (error) { lastError = String(error.message || error); }
    if (observer) observer.observe(document.body, { childList: true, subtree: true });
  }
  function schedule() {
    if (pending === null) pending = setTimeout(run, 120);
  }
  function start() {
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", schedule);
    run();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  window.fedFormSections = {
    plans: PLANS,
    count: function () { return document.querySelectorAll(".fed-sec").length; },
    diagnostics: function () { return { runs: runs, lastError: lastError }; }
  };
})();
