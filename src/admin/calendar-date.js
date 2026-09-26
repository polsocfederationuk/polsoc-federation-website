/**
 * calendar-date.js — one clean date field.
 *
 * Replaces Decap's datetime widget for every date in the CMS. That widget drew
 * a date box inside a second bordered box, a "UTC" label and two grey buttons,
 * and no amount of styling from outside could reach its markup reliably.
 *
 * WHAT IS STORED: exactly what was stored before — a plain calendar day as
 * "YYYY-MM-DD", or "" when cleared (the pre-save guard turns "" into null, as it
 * always has). A native <input type="date"> reports its value in that form
 * whatever language the browser shows the picker in, and it has no time and no
 * time zone, so the day chosen is the day saved. That is the guarantee
 * `picker_utc` used to provide by configuration; here there is nothing to
 * configure wrongly.
 *
 * WHAT AN EDITOR SEES
 *
 *   - the date box, in their browser's own format (08.12.2025, 12/08/2025 …);
 *   - "Today", and "Clear" on an optional date that has a value;
 *   - the day written out underneath — "Monday 8 December 2025" — so there is
 *     no doubt which format the box is using;
 *   - a warning if the day is before the one it must follow (an end date
 *     before the start date, sign-ups closing before they open).
 *
 * FIELD OPTIONS
 *
 *   after_field   Path of the date this one must not precede, e.g. "start_date"
 *                 or "registration.opens_on". Sets the picker's minimum and
 *                 drives the warning. The save-time rules are unchanged.
 *   after_label   How to name that date in the warning ("the start date").
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || !window.CMS) return;
  var h = window.h, createClass = window.createClass;
  if (!h || !createClass) return;

  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];

  /** Whatever Decap hands over, as "YYYY-MM-DD" — or "" if it is not a real day. */
  function isoDay(value) {
    if (value instanceof Date) return isNaN(value) ? "" : value.toISOString().slice(0, 10);
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value == null ? "" : value).trim());
    if (!m) return "";
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? m[0] : "";
  }

  function spoken(iso) {
    var p = iso.split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return DAYS[d.getUTCDay()] + " " + p[2] + " " + MONTHS[p[1] - 1] + " " + p[0];
  }

  /** Today in the editor's own calendar — not UTC, which can be yesterday. */
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  var Control = createClass({
    after: function (entry) {
      var path = this.props.field.get("after_field");
      if (!path || !entry || typeof entry.getIn !== "function") return "";
      return isoDay(entry.getIn(["data"].concat(String(path).split("."))));
    },

    /** Decap redraws on a value change only; the "after" date matters too. */
    shouldComponentUpdate: function (nextProps) {
      var p = this.props;
      return nextProps.value !== p.value ||
        nextProps.classNameWrapper !== p.classNameWrapper ||
        nextProps.hasActiveStyle !== p.hasActiveStyle ||
        nextProps.isDisabled !== p.isDisabled ||
        this.after(nextProps.entry) !== this.after(p.entry);
    },

    set: function (value) {
      if (this.props.isDisabled) return;
      this.props.onChange(value);
    },

    render: function () {
      var self = this, props = this.props, field = props.field;
      var stored = props.value;
      var day = isoDay(stored);
      var unreadable = !day && stored != null && String(stored).trim() !== "";
      var required = field.get("required") !== false;
      var after = this.after(props.entry);
      var tooEarly = Boolean(day && after && day < after);
      var noteId = props.forID + "-said";

      var note;
      if (unreadable) {
        note = h("span", { className: "fed-date-warn" },
          "The saved value \u201c" + String(stored) + "\u201d is not a calendar day. Pick the day again.");
      } else if (tooEarly) {
        note = h("span", { className: "fed-date-warn" },
          spoken(day) + " is before " + (field.get("after_label") || "the earlier date") +
          " (" + spoken(after) + ").");
      } else if (day) {
        note = h("span", null, spoken(day));
      } else {
        note = h("span", { className: "fed-date-empty" }, required ? "Pick a day." : "No date set.");
      }

      return h("div", { className: "fed-date" },
        h("div", { className: "fed-date-row" },
          h("input", {
            id: props.forID, type: "date", className: "fed-date-input",
            value: day, min: after || undefined,
            disabled: Boolean(props.isDisabled),
            "aria-describedby": noteId,
            "aria-invalid": unreadable || tooEarly ? "true" : undefined,
            onFocus: props.setActiveStyle, onBlur: props.setInactiveStyle,
            onChange: function (e) { self.set(e.target.value || ""); },
          }),
          h("button", {
            type: "button", className: "fed-date-button",
            disabled: Boolean(props.isDisabled) || day === today(),
            onClick: function () { self.set(today()); },
          }, "Today"),
          !required && (day || unreadable) ? h("button", {
            type: "button", className: "fed-date-button fed-date-clear",
            disabled: Boolean(props.isDisabled),
            onClick: function () { self.set(""); },
          }, "Clear") : null),
        h("p", { id: noteId, className: "fed-date-said", "aria-live": "polite" }, note));
    },
  });

  window.CMS.registerWidget("calendarDate", Control);
  window.fedCalendarDate = { isoDay: isoDay, spoken: spoken };
})();
