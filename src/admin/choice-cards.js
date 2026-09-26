/**
 * choice-cards.js — every option on screen, instead of a dropdown.
 *
 * A custom widget registered through Decap's documented `CMS.registerWidget`
 * API. It stores exactly the option value a select would have stored — string,
 * boolean or null — so switching a field from `select` to `choiceCards` changes
 * no content file.
 *
 * Native radio buttons underneath: Tab reaches the group, the arrow keys move
 * between options, and screen readers announce "radio button, 2 of 3".
 *
 * FIELD OPTIONS (all optional except `options`)
 *
 *   options      [{ label, value, description? }] or plain strings.
 *   layout       "cards" (default) — a grid of boxes, room for a description;
 *                "chips" — a row of pills, for short labels such as years.
 *   columns      Cards per row on a wide form. Narrow forms wrap sooner.
 *   featured     Values shown before "Other…". The rest appear on request.
 *                The stored value is always shown, featured or not, so a
 *                record can never hide its own answer.
 *   more_label   Text of that reveal button. Default "Other…".
 *   empty_shows_default
 *                true (default): an empty value is drawn as the `default`
 *                option, as the dropdown's placeholder used to imply.
 *                false: an empty value is drawn with nothing chosen. Used where
 *                "no answer yet" means something different from the default.
 *   follow_date  The name of a date field (YYYY-MM-DD). On a NEW record the
 *                academic year is picked from that date until the editor
 *                chooses one by hand. Existing records are never changed.
 *   confirm      A question asked before the value changes, for settings whose
 *                change affects the whole website.
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || !window.CMS) return;
  var h = window.h, createClass = window.createClass;
  if (!h || !createClass) return;

  /*
    The first month of an academic year. September matches every record in the
    repository (October–July dates all belong to the year that starts in the
    preceding September). Only used to PRE-SELECT a year on a new record.
  */
  var ACADEMIC_YEAR_START_MONTH = 9;

  function plain(value) { return value && typeof value.toJS === "function" ? value.toJS() : value; }

  function isEmpty(value) { return value === undefined || value === null || value === ""; }

  /** "2026-10-14" -> "2026/27"; anything else -> "". */
  function academicYearFor(date) {
    var m = /^(\d{4})-(\d{2})-\d{2}/.exec(String(date || ""));
    if (!m) return "";
    var year = Number(m[1]);
    var start = Number(m[2]) >= ACADEMIC_YEAR_START_MONTH ? year : year - 1;
    return start + "/" + String((start + 1) % 100).padStart(2, "0");
  }

  function isNewEntry(entry) {
    if (!entry || typeof entry.get !== "function") return false;
    var flag = entry.get("newRecord");
    if (flag === true) return true;
    if (flag === false) return false;
    return !entry.get("path");
  }

  function normalise(options) {
    return (plain(options) || []).map(function (o) {
      return typeof o === "object" && o !== null
        ? { label: String(o.label), value: o.value === undefined ? null : o.value, description: o.description || "" }
        : { label: String(o), value: o, description: "" };
    });
  }

  /** Radio `value` attributes are strings; the stored value keeps its own type. */
  function key(value) { return value === null ? "\u0000null" : typeof value + ":" + String(value); }

  var Control = createClass({
    getInitialState: function () {
      return { expanded: false, manualYear: false };
    },

    /**
     * Decap's Widget wrapper redraws a control only when its own value changes,
     * unless the control supplies this. A year that follows a date has to hear
     * about the date, so the entry counts too — but only for such a field, so
     * every other card group stays as quiet as before. Decap calls this with
     * nextProps only; React calls it with both for this control's own state.
     */
    shouldComponentUpdate: function (nextProps, nextState) {
      var p = this.props;
      if (nextState !== undefined && nextState !== this.state) return true;
      return nextProps.value !== p.value ||
        nextProps.classNameWrapper !== p.classNameWrapper ||
        nextProps.hasActiveStyle !== p.hasActiveStyle ||
        nextProps.isDisabled !== p.isDisabled ||
        (Boolean(this.field("follow_date", null)) && nextProps.entry !== p.entry);
    },

    componentDidMount: function () { this.follow(); },
    componentDidUpdate: function () { this.follow(); },

    field: function (name, fallback) {
      var v = this.props.field.get(name);
      return v === undefined ? fallback : plain(v);
    },

    /** What is chosen right now, as drawn. */
    current: function () {
      var value = this.props.value;
      if (!isEmpty(value)) return value;
      // A null-valued option ("Fill the frame") IS the empty value.
      var options = normalise(this.props.field.get("options"));
      for (var i = 0; i < options.length; i++) if (options[i].value === null) return null;
      if (this.field("empty_shows_default", true) === false) return undefined;
      var fallback = this.props.field.get("default");
      return fallback === undefined ? undefined : fallback;
    },

    follow: function () {
      var source = this.field("follow_date", null);
      if (!source || this.state.manualYear || !isNewEntry(this.props.entry)) return;
      var entry = this.props.entry;
      var date = entry && entry.getIn ? entry.getIn(["data", source]) : null;
      var year = academicYearFor(date);
      if (!year || year === this.props.value) return;
      var offered = normalise(this.props.field.get("options")).some(function (o) { return o.value === year; });
      if (offered) this.props.onChange(year);
    },

    choose: function (value) {
      if (this.props.isDisabled) return;
      if (value === this.props.value) return;
      var question = this.field("confirm", "");
      if (question && !window.confirm(question)) {
        // The radio has already moved; redraw it back where the value is.
        this.forceUpdate();
        return;
      }
      if (this.field("follow_date", null)) this.setState({ manualYear: true });
      this.props.onChange(value);
    },

    render: function () {
      var self = this, props = this.props;
      var options = normalise(props.field.get("options"));
      var layout = this.field("layout", "cards") === "chips" ? "chips" : "cards";
      var columns = Number(this.field("columns", 0)) || 0;
      var featured = this.field("featured", null);
      var current = this.current();
      var currentKey = current === undefined ? null : key(current);

      var visible = options;
      var hidden = 0;
      if (Array.isArray(featured) && !this.state.expanded) {
        visible = options.filter(function (o) {
          return featured.indexOf(o.value) !== -1 || key(o.value) === currentKey;
        });
        hidden = options.length - visible.length;
      }

      var style = columns ? { "--fed-choice-columns": String(columns) } : null;
      var items = visible.map(function (option, index) {
        var selected = key(option.value) === currentKey;
        var id = props.forID + "-option-" + options.indexOf(option);
        return h("label", {
          key: key(option.value),
          className: "fed-choice-card" + (selected ? " is-selected" : "") +
            (option.description ? " has-description" : ""),
        },
          h("input", {
            id: id, type: "radio", name: props.forID,
            // Plain text for text options, so other enhancers can read
            // `input:checked.value` exactly as they read it before.
            value: typeof option.value === "string" ? option.value : key(option.value),
            checked: selected, disabled: Boolean(props.isDisabled),
            onFocus: props.setActiveStyle, onBlur: props.setInactiveStyle,
            onChange: function () { self.choose(option.value); },
          }),
          h("span", { className: "fed-choice-text" },
            h("span", { className: "fed-choice-label" }, option.label),
            option.description ? h("span", { className: "fed-choice-description" }, option.description) : null));
      });

      if (hidden > 0) {
        items.push(h("button", {
          key: "__more", type: "button", className: "fed-choice-more",
          onClick: function () { self.setState({ expanded: true }); },
        }, this.field("more_label", "Other…")));
      }

      return h("div", {
        id: props.forID,
        className: "fed-choice-cards fed-choice-" + layout + (columns ? " has-columns" : ""),
        role: "radiogroup",
        "aria-label": props.field.get("label"),
        style: style,
      }, items);
    },
  });

  window.CMS.registerWidget("choiceCards", Control);
  // For tests and for other enhancers that need the same rule.
  window.fedChoiceCards = { academicYearFor: academicYearFor, startMonth: ACADEMIC_YEAR_START_MONTH };
})();
