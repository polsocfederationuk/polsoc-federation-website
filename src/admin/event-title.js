/**
 * event-title.js — type the event title once, then choose the highlighted part.
 *
 * The stored shape is three fields, because that is what the page template
 * renders:
 *
 *   title_lead   "Annual"
 *   title_fancy  "Christmas"     <- rendered in the decorative face
 *   title_tail   "Dinner"
 *
 * Asking an editor to fill three boxes made them do the splitting in their head,
 * type the same words twice, and get the spacing right by luck. This shows one
 * title and lets them click the words to highlight.
 *
 * WHY AN ENHANCER RATHER THAN A CUSTOM WIDGET
 *
 * A Decap widget owns exactly one field and can only change that field's value.
 * One control spanning three fields is therefore not expressible as a widget
 * without moving the three keys into a nested object — a storage migration the
 * brief rules out, and one that would change every event file for a purely
 * cosmetic reason.
 *
 * So this follows the enhancer architecture already established by
 * language-tabs.js: the three real inputs stay exactly where Decap put them,
 * still owned by Decap, and are hidden. Values are written into them with the
 * native setter plus an `input` event — the same path a real keystroke takes,
 * which is why React sees it. No store access, no generated class names.
 *
 * SPACING IS THE THING THAT MUST NOT BREAK. The template renders:
 *
 *   lead + (fancy ? " " + <span>fancy</span> : "") + (tail ? " " + tail : "")
 *
 * so the words are joined by exactly one space and the spaces live OUTSIDE the
 * decorative span. Splitting on whitespace and rejoining with single spaces
 * reproduces that exactly, which is what keeps the title regression tests green.
 */

(function () {
  "use strict";

  var ROOT = "fed-title";

  /* -- the model ------------------------------------------------------------ */

  /** Words of a title, as the template would join them. */
  function tokenise(text) {
    return String(text || "").trim().split(/\s+/).filter(Boolean);
  }

  /**
   * Rebuild the single visible title from the three stored pieces.
   *
   * Empty pieces contribute nothing — `title_fancy: ""` on a record with no
   * highlight must not become a stray space.
   */
  function compose(lead, fancy, tail) {
    return [lead, fancy, tail]
      .map(function (s) { return String(s || "").trim(); })
      .filter(Boolean)
      .join(" ");
  }

  /**
   * Where does the highlighted phrase sit within the whole title?
   *
   * Returns { start, end } as token indices (end exclusive), or null when there
   * is no highlight. Derived from the stored pieces rather than by searching the
   * text, so a title that repeats the highlighted word cannot match the wrong
   * occurrence.
   */
  function rangeFrom(lead, fancy) {
    var f = tokenise(fancy);
    if (!f.length) return null;
    var start = tokenise(lead).length;
    return { start: start, end: start + f.length };
  }

  /** Split a title and a highlight range back into the three stored pieces. */
  function split(title, range) {
    var words = tokenise(title);
    if (!range || range.start >= range.end) {
      return { lead: words.join(" "), fancy: "", tail: "" };
    }
    return {
      lead: words.slice(0, range.start).join(" "),
      fancy: words.slice(range.start, range.end).join(" "),
      tail: words.slice(range.end).join(" "),
    };
  }

  /* -- driving Decap's own inputs ------------------------------------------- */

  function setInputValue(input, value) {
    var setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /** The control container Decap wraps a field in, given one of its inputs. */
  function containerOf(input) {
    return input.closest('[aria-label$="field"]') || input.parentElement;
  }

  /**
   * Find the three title inputs belonging to ONE language panel.
   *
   * Anchored on the field name Decap puts in the input's id (`title_lead-…`),
   * scoped to the language panel so the English and Polish sets never mix.
   */
  function findTrio(panel) {
    var pick = function (name) {
      return panel.querySelector('input[id^="' + name + '-"]');
    };
    var lead = pick("title_lead");
    var fancy = pick("title_fancy");
    var tail = pick("title_tail");
    return (lead && fancy && tail) ? { lead: lead, fancy: fancy, tail: tail } : null;
  }

  /* -- the control ---------------------------------------------------------- */

  function build(panel, trio, labels) {
    var wrap = document.createElement("div");
    wrap.className = ROOT;

    var titleLabel = document.createElement("label");
    titleLabel.className = ROOT + "-label";
    titleLabel.textContent = labels.title;

    var input = document.createElement("input");
    input.type = "text";
    input.className = ROOT + "-input";

    var pickLabel = document.createElement("p");
    pickLabel.className = ROOT + "-sub";
    pickLabel.textContent = labels.choose;

    var tokens = document.createElement("div");
    tokens.className = ROOT + "-tokens";

    var clear = document.createElement("button");
    clear.type = "button";
    clear.className = ROOT + "-clear";
    clear.textContent = labels.none;

    var preview = document.createElement("p");
    preview.className = ROOT + "-preview";

    var warn = document.createElement("p");
    warn.className = ROOT + "-warn";
    warn.hidden = true;

    wrap.appendChild(titleLabel);
    wrap.appendChild(input);
    wrap.appendChild(pickLabel);
    wrap.appendChild(tokens);
    wrap.appendChild(clear);
    wrap.appendChild(warn);
    wrap.appendChild(preview);

    // State lives here, not in the DOM.
    var range = null;
    var anchor = null;      // first click of a multi-word selection

    function writeBack() {
      var parts = split(input.value, range);
      if (trio.lead.value !== parts.lead) setInputValue(trio.lead, parts.lead);
      if (trio.fancy.value !== parts.fancy) setInputValue(trio.fancy, parts.fancy);
      if (trio.tail.value !== parts.tail) setInputValue(trio.tail, parts.tail);
    }

    function render() {
      var words = tokenise(input.value);

      // A title edited so the old highlight no longer fits must not silently
      // highlight different words — the selection is dropped and said so.
      if (range && range.end > words.length) {
        range = null;
        anchor = null;
        warn.hidden = false;
        warn.textContent = labels.lost;
      }

      tokens.textContent = "";
      words.forEach(function (w, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = ROOT + "-token" +
          (range && i >= range.start && i < range.end ? " " + ROOT + "-token-on" : "");
        b.textContent = w;
        b.setAttribute("aria-pressed",
          range && i >= range.start && i < range.end ? "true" : "false");
        /*
          Click selects one word; Shift-click extends to a phrase.

          An earlier version used two plain clicks — one to anchor, one to
          extend — and it was not predictable: whether a click started a new
          selection or extended the old one depended on invisible state, so the
          same gesture did different things at different moments. Shift-to-extend
          is the convention people already know from every file list and
          spreadsheet, and what it will do is knowable before clicking.
        */
        b.addEventListener("click", function (ev) {
          warn.hidden = true;
          if (ev.shiftKey && range) {
            var from = Math.min(range.start, i);
            var to = Math.max(range.end - 1, i) + 1;
            range = { start: from, end: to };
          } else {
            range = { start: i, end: i + 1 };
          }
          anchor = null;
          writeBack();
          render();
        });
        tokens.appendChild(b);
      });

      preview.textContent = "";
      if (words.length) {
        words.forEach(function (w, i) {
          var span = document.createElement("span");
          var on = range && i >= range.start && i < range.end;
          span.className = on ? ROOT + "-fancy" : "";
          span.textContent = w;
          preview.appendChild(span);
          if (i < words.length - 1) preview.appendChild(document.createTextNode(" "));
        });
      }

      clear.hidden = !range;
    }

    input.addEventListener("input", function () { writeBack(); render(); });
    clear.addEventListener("click", function () {
      range = null; anchor = null; warn.hidden = true; writeBack(); render();
    });

    // Load the existing record into the control.
    input.value = compose(trio.lead.value, trio.fancy.value, trio.tail.value);
    range = rangeFrom(trio.lead.value, trio.fancy.value);
    render();

    // Hide the three real fields. They stay mounted and Decap keeps owning them.
    [trio.lead, trio.fancy, trio.tail].forEach(function (i) {
      var c = containerOf(i);
      if (c) c.classList.add(ROOT + "-hidden");
    });

    // Put the control where the first of the three used to be.
    var first = containerOf(trio.lead);
    if (first && first.parentElement) first.parentElement.insertBefore(wrap, first);

    return { input: input, get range() { return range; } };
  }

  /* -- wiring --------------------------------------------------------------- */

  var LABELS = {
    en: {
      title: "Event title",
      choose: "Click a word to highlight it. Hold Shift and click to include more words.",
      none: "No highlighted text",
      lost: "The title changed, so the highlight was cleared. Choose which part should be highlighted.",
    },
    pl: {
      title: "Tytuł wydarzenia",
      choose: "Kliknij słowo, aby je wyróżnić. Przytrzymaj Shift, aby dodać kolejne.",
      none: "Bez wyróżnienia",
      lost: "Tytuł się zmienił, więc wyróżnienie zostało usunięte. Wybierz, która część ma być wyróżniona.",
    },
  };

  var built = [];

  function enhance() {
    // One control per language panel, found the same way the language tabs
    // find them: a top-level object field labelled English or Polski.
    var panels = document.querySelectorAll('[aria-label="object field"]');
    for (var i = 0; i < panels.length; i++) {
      var panel = panels[i];
      if (panel.dataset.fedTitle === "done") continue;
      var trio = findTrio(panel);
      if (!trio) continue;
      var label = panel.querySelector("label");
      var text = label ? label.textContent.trim() : "";
      var lang = /Polski/i.test(text) ? "pl" : "en";
      panel.dataset.fedTitle = "done";
      try {
        built.push(build(panel, trio, LABELS[lang]));
      } catch (e) {
        // Never break the editor over a convenience control: the three real
        // fields are still there and still work if this fails.
        panel.dataset.fedTitle = "";
      }
    }
  }

  var runs = 0;
  var lastError = null;
  var pending = null;
  var lastRun = 0;

  /*
    A THROTTLE WITH A CEILING, not a plain debounce.

    Decap mutates the editor DOM roughly every 110ms even when nobody is typing.
    A debounce that waits for a quiet period therefore never fires — measured:
    the first version ran exactly once, at start-up, and the control never
    appeared. The ceiling guarantees the work happens even while the page is
    permanently busy.
  */
  var QUIET = 120;
  var CEILING = 600;

  function run() {
    pending = null;
    lastRun = Date.now();
    runs++;
    try { enhance(); } catch (e) { lastError = String(e && e.message || e); }
  }

  function schedule() {
    if (Date.now() - lastRun > CEILING) { if (pending) clearTimeout(pending); return run(); }
    if (pending) clearTimeout(pending);
    pending = setTimeout(run, QUIET);
  }

  /*
    Two triggers, deliberately.

    The MutationObserver catches the editor being rendered. The interval is a
    backstop: Decap mounts the entry form asynchronously and the observer alone
    proved unreliable in testing — the control simply never appeared. A cheap
    poll that stops as soon as the work is done is worth more than a clever
    trigger that sometimes does not fire.
  */
  function start() {
    schedule();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    setInterval(function () {
      // Only re-scan while there is something unenhanced on screen.
      if (document.querySelector('input[id^="title_lead-"]') &&
          !document.querySelector("." + ROOT)) schedule();
    }, 700);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  // Exposed for the tests, which exercise the real split/compose rules.
  window.fedEventTitle = {
    compose: compose, split: split, rangeFrom: rangeFrom, tokenise: tokenise,
    controls: built,
    diagnostics: function () { return { runs: runs, built: built.length, lastError: lastError }; },
  };
})();
