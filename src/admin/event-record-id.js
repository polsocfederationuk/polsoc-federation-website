/**
 * event-record-id.js — the standard event's Record ID, generated and then fixed.
 *
 * A custom widget registered through Decap's documented `CMS.registerWidget`
 * API, built with the `h` / `createClass` globals that API provides — the same
 * approach as focal-point.js.
 *
 * WHAT IT DOES
 *
 * On a NEW event the ID is filled in from the English title and the academic
 * year while the editor types:
 *
 *   "Chleb Asi" + 2026/27        ->  chleb-asi-26-27
 *   "Wigilia Świąteczna" + 2026/27 -> wigilia-swiateczna-26-27
 *
 * Typing in the field takes over; the generator then leaves it alone, and a
 * "use the generated ID" button hands it back.
 *
 * On an EXISTING event the field is read-only. The ID is the filename
 * (content/events/<id>.yaml) and the public address (event-<id>.html), so
 * changing it would break a live URL — and Decap would not rename the file
 * anyway, leaving a slug that disagrees with its filename, which
 * netlify/lib/rules.js and scripts/validate.js both reject. The admin page's
 * preSave guard enforces the same rule, so the lock is not presentation only.
 *
 * WHY A WIDGET AND NOT AN ENHANCER
 *
 * event-title.js is an enhancer because it has to WRITE three fields. This only
 * writes its own field and only READS the others, which Decap supports: every
 * control receives the whole `entry`. So no DOM scraping, no generated class
 * names, and the value reaches the store through the widget's own onChange.
 *
 * STORAGE IS UNCHANGED: a plain string in `slug`, validated by the same
 * pattern as before.
 *
 * The pure functions at the top are exported for scripts/test-event-record-id.js
 * when this file is loaded by Node, so the tests run the code the browser runs.
 */

(function () {
  "use strict";

  /* -- the generator (pure, tested) ------------------------------------------ */

  // Letters NFD cannot decompose. ł is a separate letter in Unicode, not l with
  // a mark, so stripping combining marks alone would drop it entirely.
  var NO_DECOMPOSITION = { "ł": "l", "ø": "o", "đ": "d", "ß": "ss", "æ": "ae", "œ": "oe" };

  /** Lowercase ASCII, with Polish (and other Latin) diacritics removed. */
  function toAscii(text) {
    return String(text == null ? "" : text)
      .toLowerCase()
      .replace(/[łøđßæœ]/g, function (ch) { return NO_DECOMPOSITION[ch]; })
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  /** Lowercase letters, numbers and single hyphens — the Record ID alphabet. */
  function slugify(text) {
    return toAscii(text)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /** "2026/27" -> "26-27". Anything not in that exact shape gives "". */
  function shortYear(academicYear) {
    var m = /^\s*(\d{4})\/(\d{2})\s*$/.exec(String(academicYear == null ? "" : academicYear));
    return m ? m[1].slice(2) + "-" + m[2] : "";
  }

  /** The visible title, joined the way the page template joins it. */
  function composeTitle(lead, fancy, tail) {
    return [lead, fancy, tail]
      .map(function (s) { return String(s == null ? "" : s).trim(); })
      .filter(Boolean)
      .join(" ");
  }

  /**
   * The Record ID for a title and an academic year.
   *
   * No title gives "" — the field stays empty and the required check explains
   * what is missing. No year gives the title part alone until one is chosen.
   * A title that already ends with the same year is not given it twice.
   */
  function generate(title, academicYear) {
    var base = slugify(title);
    if (!base) return "";
    var year = shortYear(academicYear);
    if (!year) return base;
    if (base === year || base.slice(-(year.length + 1)) === "-" + year) return base;
    return base + "-" + year;
  }

  var api = {
    toAscii: toAscii,
    slugify: slugify,
    shortYear: shortYear,
    composeTitle: composeTitle,
    generate: generate,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;

  /* -- the widget ------------------------------------------------------------- */

  if (typeof window === "undefined") return;
  window.FED_EVENT_RECORD_ID = api;

  if (typeof window.CMS === "undefined" || !window.CMS.registerWidget) return;

  var h = window.h;
  var createClass = window.createClass;
  if (!h || !createClass) return;

  function read(entry, path) {
    return entry && typeof entry.getIn === "function" ? entry.getIn(path) : undefined;
  }

  /**
   * Is this a record being created?
   *
   * Decap sets `newRecord` on the draft: true for "New event" and for a
   * duplicate, false once a saved record is opened. The path fallback covers a
   * draft restored from a local backup, where Decap derives the flag the same way.
   */
  function isNewEntry(entry) {
    if (!entry || typeof entry.get !== "function") return false;
    var flag = entry.get("newRecord");
    if (flag === true) return true;
    if (flag === false) return false;
    return !entry.get("path");
  }

  function generatedFor(entry, field) {
    var source = field && field.get && field.get("id_source");
    if (source) {
      return generate(read(entry, ["data"].concat(source.split("."))), read(entry, ["data", "academic_year"]));
    }
    return generate(
      composeTitle(
        read(entry, ["data", "en", "title_lead"]),
        read(entry, ["data", "en", "title_fancy"]),
        read(entry, ["data", "en", "title_tail"])
      ),
      read(entry, ["data", "academic_year"])
    );
  }

  var Control = createClass({
    getInitialState: function () {
      var value = this.props.value || "";
      // A new record whose ID is empty or already the generated one follows the
      // title. Anything else — a duplicate carrying the old ID, a restored draft
      // with a hand-typed ID — is kept until the editor asks for the generated one.
      return { manual: !(value === "" || value === generatedFor(this.props.entry, this.props.field)) };
    },

    componentDidMount: function () { this.follow(); },
    componentDidUpdate: function () { this.follow(); },

    /**
     * Decap's Widget wrapper calls this with nextProps only; React calls it with
     * both for this control's own state changes.
     */
    shouldComponentUpdate: function (nextProps, nextState) {
      var p = this.props;
      return nextProps.value !== p.value ||
        nextProps.entry !== p.entry ||
        nextProps.classNameWrapper !== p.classNameWrapper ||
        nextProps.hasActiveStyle !== p.hasActiveStyle ||
        (nextState !== undefined && nextState !== this.state);
    },

    /** Keep a new, untouched ID in step with the title and year. */
    follow: function () {
      if (!isNewEntry(this.props.entry) || this.state.manual) return;
      var generated = generatedFor(this.props.entry, this.props.field);
      if ((this.props.value || "") !== generated) this.props.onChange(generated);
    },

    handleChange: function (event) {
      if (!isNewEntry(this.props.entry)) return;       // locked
      var value = event.target.value;
      this.setState({ manual: value !== generatedFor(this.props.entry, this.props.field) });
      this.props.onChange(value);
    },

    useGenerated: function (event) {
      if (event && event.preventDefault) event.preventDefault();
      if (!isNewEntry(this.props.entry)) return;
      this.setState({ manual: false });
      this.props.onChange(generatedFor(this.props.entry, this.props.field));
    },

    render: function () {
      var p = this.props;
      var value = p.value || "";
      var isNew = isNewEntry(p.entry);
      var generated = generatedFor(p.entry, p.field);
      var source = p.field && p.field.get && p.field.get("id_source");
      var subject = source === "name" ? "member" : source ? "announcement" : "event";

      var input = h("input", {
        type: "text",
        id: p.forID,
        className: p.classNameWrapper,
        value: value,
        readOnly: !isNew,
        "aria-readonly": isNew ? "false" : "true",
        onChange: this.handleChange,
        onFocus: p.setActiveStyle,
        onBlur: p.setInactiveStyle,
      });

      var note;
      var action = null;

      if (!isNew) {
        note = "Locked to protect this saved " + subject + ". You can still change its content. Create a new record for a different edition or committee year.";
      } else if (!this.state.manual) {
        note = generated
          ? "Created automatically. You usually do not need to change this."
          : "This fills in when you enter " + (source === "name" ? "the full name" : "the English title") + ".";
      } else {
        note = "Typed by hand, so it no longer follows the title.";
        if (generated && generated !== value) {
          action = h("button", {
            type: "button",
            className: "fed-record-id__use",
            onClick: this.useGenerated,
          }, "Use " + generated);
        }
      }

      return h("div", { className: "fed-record-id" + (isNew ? "" : " fed-record-id--locked") },
        input,
        h("p", { className: "fed-record-id__note" }, note, action ? " " : null, action)
      );
    },
  });

  function Preview(props) {
    return h("span", null, props.value || "");
  }

  window.CMS.registerWidget("eventRecordId", Control, Preview);
})();
