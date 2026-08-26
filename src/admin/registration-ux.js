/**
 * registration-ux.js — ask one question at a time.
 *
 * THE PROBLEM
 *
 * The Registration block showed all six controls at once: where registration is
 * handled, which Federation event, the status, the web address, and two dates.
 * Most announcements need none of them, and the ones that do need three at most.
 * An editor writing about a talk with no sign-up still had to read six labels
 * and decide, each time, that all six were irrelevant.
 *
 * WHAT THIS DOES
 *
 * Shows the source chooser, and then only the fields that choice actually uses:
 *
 *   No registration        nothing else at all
 *   A Federation event     the event picker, and a read-only preview of what
 *                          that event's registration currently says
 *   This announcement      the status, and the fields that status can use
 *
 * On a standard event there is no chooser — an event always owns its own
 * registration — so only the status branch applies.
 *
 * NOTHING IS REMOVED, ONLY HIDDEN. Every control keeps its place in the form and
 * its value in the draft; switching back reveals it unchanged. What an editor
 * cannot see, normaliseRegistration() clears on save anyway, so the record never
 * keeps a value the visible form did not claim.
 *
 * READING A SELECT
 *
 * Decap renders a select with react-select, which puts the chosen option's LABEL
 * on screen and keeps the value to itself. The way back is the table in
 * FED_REGISTRATION_CHOICES, derived by src/_data/cmsConfig.js from the very
 * options it just built — so an edited label cannot leave this file matching a
 * string that no longer exists.
 *
 * THE PREVIEW
 *
 * Read-only means read-only: plain text, not disabled inputs. A disabled input
 * still looks like somewhere to type, and the value is not this record's to
 * change — it belongs to the event.
 *
 * The values are read from the event's file through the same local proxy the
 * rest of the admin page uses, the first time that event is previewed in this
 * editing session — not baked in when the CMS was built. Reopening the editor
 * reads it again. What the site renders is always the event's file at build
 * time, so a preview can only ever be as stale as the tab it is sitting in.
 *
 * LIFECYCLE
 *
 * One observer, armed per route. Unlike the drawers, this one does NOT
 * disconnect after its first success: the fields it shows depend on values the
 * editor keeps changing, so it has to keep watching while the form is open. It
 * is idempotent, cheap (a few label reads), and it stops on navigation.
 */

(function () {
  "use strict";

  var ROOT = "fed-reg";
  var HIDDEN = ROOT + "-hidden";

  var CHOICES = window.FED_REGISTRATION_CHOICES || { source: {}, state: {} };
  var PROXY = window.FED_CMS_PROXY || "";
  var BRANCH = window.FED_CMS_BRANCH || "";

  /* Which collections have a registration block, and whether it can be shared. */
  var KINDS = { announcements: "announcement", standard_events: "event" };

  var STATE_LABEL = {
    none: "No registration",
    coming_soon: "Coming soon — sign-ups have not opened",
    open: "Open — people can register now",
    closed: "Closed — sign-ups have ended",
  };

  function collectionName() {
    var m = /#\/collections\/([^/]+)/.exec(location.hash || "");
    return m ? m[1] : null;
  }

  /** Decap's wrapper for one field, found by the id it gives the control. */
  function fieldIn(scope, name) {
    var el = scope.querySelector('[id^="' + name + '-field-"]');
    return el ? el.closest('[aria-label$="field"]') : null;
  }

  /**
   * The value an editor has chosen in a select, or "" for nothing yet.
   *
   * react-select shows the label; CHOICES maps it back. An unrecognised label
   * returns "", which every caller treats as "not chosen" — so a mismatch makes
   * the form show more than necessary, never less. Failing open is the right
   * direction for a control whose only job is to hide things.
   */
  function selected(scope, name) {
    var field = fieldIn(scope, name);
    if (!field) return "";
    var shown = field.querySelector('[class*="singleValue"]');
    if (!shown) return "";
    var table = CHOICES[name] || {};
    var text = shown.textContent.trim();
    return table[text] || "";
  }

  function show(field, visible) {
    if (!field) return;
    if (visible) field.classList.remove(HIDDEN);
    else field.classList.add(HIDDEN);
  }

  /* -- the preview --------------------------------------------------------- */

  /**
   * The registration keys of one event file, without a YAML parser.
   *
   * The block is flat and two-space indented — `state`, `url`, `opens_on`,
   * `closes_on` and nothing nested — and scripts/validate.js pins that shape, so
   * a scan of the indented lines under `registration:` is enough. The admin page
   * already reads the academic year this way rather than carrying a parser.
   */
  function registrationFromYaml(raw) {
    var out = { state: "none", url: null, opens_on: null, closes_on: null };
    var lines = String(raw || "").split(/\r?\n/);
    var inside = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^registration:\s*$/.test(line)) { inside = true; continue; }
      if (!inside) continue;
      if (!/^\s/.test(line)) break;          // back to the top level: block over
      var m = /^\s+([a-z_]+):\s*(.*)$/.exec(line);
      if (!m) continue;
      var value = m[2].trim().replace(/^["']|["']$/g, "");
      if (value === "null" || value === "~" || value === "") value = null;
      if (Object.prototype.hasOwnProperty.call(out, m[1])) out[m[1]] = value;
    }
    if (!out.state) out.state = "none";
    return out;
  }

  var cache = {};

  /** Read one event's registration through the local proxy. */
  function loadRegistration(slug) {
    if (cache[slug]) return cache[slug];
    cache[slug] = fetch(PROXY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "getEntry",
        params: { branch: BRANCH, path: "content/events/" + slug + ".yaml" },
      }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (entry) { return registrationFromYaml(entry && entry.data); });
    return cache[slug];
  }

  function row(dl, term, value) {
    var dt = document.createElement("dt");
    dt.textContent = term;
    var dd = document.createElement("dd");
    dd.textContent = value;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  function renderPreview(box, slug, reg) {
    box.textContent = "";

    var head = document.createElement("p");
    head.className = ROOT + "-preview-head";
    head.textContent = "What " + slug + " currently says";
    box.appendChild(head);

    var dl = document.createElement("dl");
    dl.className = ROOT + "-preview-list";
    row(dl, "Status", STATE_LABEL[reg.state] || reg.state);
    if (reg.state === "open" && reg.url) row(dl, "Sign-up address", reg.url);
    if (reg.opens_on) row(dl, "Sign-ups open", reg.opens_on);
    if (reg.closes_on) row(dl, "Sign-ups close", reg.closes_on);
    box.appendChild(dl);

    var note = document.createElement("p");
    note.className = ROOT + "-preview-note";
    note.textContent = reg.state === "none"
      /*
        The case the old rule refused. Saying so plainly is the whole point:
        the editor has done nothing wrong, and nothing more is required of them.
      */
      ? "Nothing is shown to readers yet. This announcement will show the " +
        "sign-up panel automatically once the event has one — you do not need " +
        "to come back and edit it."
      : "Managed on the event, not here. Change it there and this announcement " +
        "follows on the next build.";
    box.appendChild(note);
  }

  /**
   * Keep the preview showing whichever event is currently selected.
   *
   * Guarded by the slug it last drew, so the observer can call this on every
   * mutation without re-fetching or repainting anything.
   */
  function updatePreview(box, slug) {
    if (!slug) {
      if (box.getAttribute("data-slug") === "") return;
      box.setAttribute("data-slug", "");
      box.textContent = "";
      var ask = document.createElement("p");
      ask.className = ROOT + "-preview-note";
      ask.textContent = "Choose the event above to see its registration.";
      box.appendChild(ask);
      return;
    }
    if (box.getAttribute("data-slug") === slug) return;
    box.setAttribute("data-slug", slug);
    box.textContent = "";
    var wait = document.createElement("p");
    wait.className = ROOT + "-preview-note";
    wait.textContent = "Reading " + slug + "…";
    box.appendChild(wait);

    loadRegistration(slug).then(function (reg) {
      // The editor may have moved on while the file was being read.
      if (box.getAttribute("data-slug") !== slug) return;
      renderPreview(box, slug, reg);
    }).catch(function () {
      if (box.getAttribute("data-slug") !== slug) return;
      box.textContent = "";
      var oops = document.createElement("p");
      oops.className = ROOT + "-preview-note";
      oops.textContent = "Could not read that event just now. Its registration " +
        "is still used when the site is built.";
      box.appendChild(oops);
      // Not cached as a failure, so the next look tries again.
      delete cache[slug];
    });
  }

  /**
   * Which event is chosen, read from the relation control's own label.
   *
   * Decap's relation widget renders `display_fields`, which starts with the
   * event's title — but its stored value is the slug, and the slug is what the
   * preview needs. The label is matched against the events the picker itself
   * offers: those options carry the value on the element Decap builds them from.
   */
  function chosenEventSlug(scope) {
    var field = fieldIn(scope, "event_slug");
    if (!field) return "";
    var shown = field.querySelector('[class*="singleValue"]');
    if (!shown) return "";
    var label = shown.textContent.trim();
    return label ? slugForLabel(label) : "";
  }

  /*
    THE LABEL THE PICKER SHOWS IS NOT THE VALUE IT STORES.

    Decap renders `display_fields` and keeps the slug to itself; its option
    elements carry nothing but text. So the pairing is read from the content
    itself by src/_data/cmsConfig.js and handed here as data, keyed by exactly
    the string the picker draws — one template, used on both sides.
  */
  var EVENT_INDEX = window.FED_EVENT_PICKER_INDEX || {};

  function slugForLabel(label) {
    var hit = EVENT_INDEX[label];
    return hit ? hit.slug : "";
  }

  /* -- the pass ------------------------------------------------------------ */

  function previewBox(scope, after) {
    var box = scope.querySelector("." + ROOT + "-preview");
    if (box) return box;
    box = document.createElement("div");
    box.className = ROOT + "-preview";
    /*
      Deliberately no data-slug yet. That attribute records what is DRAWN, and a
      new box has drawn nothing — setting it to "" here would match the "no event
      chosen" case and skip the very message that case exists to show.
    */
    after.parentElement.insertBefore(box, after.nextSibling);
    return box;
  }

  /**
   * Which branch of the block an editor is looking at.
   *
   * THE TWENTY-EIGHT EXISTING ANNOUNCEMENTS HAVE NO SOURCE.
   *
   * They were migrated before the chooser existed, and an absent source has
   * always meant "this announcement's own" — src/_data/registration.js reads
   * them that way and none of them needed rewriting. So the chooser sits empty
   * on those records, and taking that at face value would hide a closed
   * registration behind a control that looks like it says "nothing here".
   *
   * The status the record already carries answers the question instead: a real
   * status means the announcement owns one. Nothing is written to do this — the
   * record keeps exactly the shape it has until an editor changes something.
   */
  function branchOf(scope, kind) {
    if (kind !== "announcement") return "own";
    var chosen = selected(scope, "source");
    if (chosen) return chosen;
    var carried = selected(scope, "state");
    return carried && carried !== "none" ? "own" : "none";
  }

  /** Say so, when the branch was worked out rather than chosen. */
  function legacyNote(scope, show_) {
    var note = scope.querySelector("." + ROOT + "-legacy");
    if (!show_) {
      if (note) note.parentElement.removeChild(note);
      return;
    }
    if (note) return;
    var field = fieldIn(scope, "source");
    if (!field) return;
    note = document.createElement("p");
    note.className = ROOT + "-legacy";
    note.textContent = "This announcement was written before the question above " +
      "existed. It has its own registration, shown below — answer the question " +
      "only if you want to change that.";
    field.parentElement.insertBefore(note, field.nextSibling);
  }

  function apply(scope, kind) {
    var stateField = fieldIn(scope, "state");
    var urlField = fieldIn(scope, "url");
    var opens = fieldIn(scope, "opens_on");
    var closes = fieldIn(scope, "closes_on");

    var source = branchOf(scope, kind);
    var eventField = kind === "announcement" ? fieldIn(scope, "event_slug") : null;

    if (kind === "announcement") {
      legacyNote(scope, !selected(scope, "source") && source === "own");
      show(eventField, source === "event");
      if (eventField) {
        var box = previewBox(scope, eventField);
        box.classList.toggle(HIDDEN, source !== "event");
        if (source === "event") updatePreview(box, chosenEventSlug(scope));
      }
    }

    /*
      The status branch. On an announcement it belongs to "This announcement";
      on an event it is simply the whole block, because an event has no other
      place its registration could come from.
    */
    var own = source === "own";
    show(stateField, own);

    var state = own ? selected(scope, "state") : "";
    // A blank status means the editor has not chosen — show the fields rather
    // than hide values they cannot then see.
    var live = own && state !== "none";
    show(urlField, own && (state === "open" || state === ""));
    show(opens, live);
    show(closes, live);

    scope.setAttribute("data-fed-source", source);
    scope.setAttribute("data-fed-state", state);
    return true;
  }

  function pass() {
    var kind = KINDS[collectionName()];
    if (!kind) return;
    var blocks = document.querySelectorAll('[id^="registration-field-"]');
    for (var i = 0; i < blocks.length; i++) {
      var scope = blocks[i].closest('[aria-label$="field"]');
      if (scope) apply(scope, kind);
    }
  }

  /* -- lifecycle ----------------------------------------------------------- */

  var observer = null;
  var armedFor = null;
  var queued = false;

  function schedule() {
    /*
      Decap rewrites parts of the form constantly while it is open, so a burst of
      mutations is collapsed into a single pass. A MICROTASK, not a frame: a
      background tab never paints, so requestAnimationFrame would leave the form
      showing every field until somebody looked at it — which is exactly the
      moment an editor cannot see that anything is wrong.

      Not a timer either. There is no interval and no delay constant; the queue
      drains as soon as the current mutation callback returns.

      The pass is idempotent and does not observe attributes, so the few nodes it
      does insert settle after one further round rather than looping.
    */
    if (queued) return;
    queued = true;
    Promise.resolve().then(function () {
      queued = false;
      try { pass(); } catch (e) { stop(); }
    });
  }

  function stop() {
    if (observer) { observer.disconnect(); observer = null; }
  }

  function arm() {
    var route = location.hash || "";
    if (armedFor === route && observer) return;
    stop();
    armedFor = route;
    if (!KINDS[collectionName()]) return;

    pass();
    /*
      This one keeps watching. What it shows depends on values the editor is
      still changing, so "finished" never arrives while the form is open; it
      stops on navigation instead.
    */
    observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true,
    });
  }

  window.addEventListener("hashchange", function () { armedFor = null; arm(); });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", arm);
  } else { arm(); }

  window.fedRegistrationUx = {
    choices: CHOICES,
    parse: registrationFromYaml,
    read: function () {
      var out = [];
      var blocks = document.querySelectorAll("[data-fed-source]");
      for (var i = 0; i < blocks.length; i++) {
        var s = blocks[i];
        out.push({
          source: s.getAttribute("data-fed-source"),
          state: s.getAttribute("data-fed-state"),
          hidden: [].map.call(s.querySelectorAll("." + HIDDEN), function (h) {
            var input = h.querySelector('[id*="-field-"]');
            return input ? input.id.replace(/-field-.*/, "") : "?";
          }),
          preview: (s.querySelector("." + ROOT + "-preview") || {}).textContent || "",
        });
      }
      return out;
    },
    observing: function () { return Boolean(observer); },
  };
})();
