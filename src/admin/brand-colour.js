/**
 * brand-colour.js — the "Brand colour" control.
 *
 * A custom widget registered through Decap's documented `CMS.registerWidget`
 * API, built with the `createClass` / `h` globals that same API provides. No
 * Redux, no generated class names, no reaching into Decap's own controls: the
 * widget owns its markup and reports changes through the `onChange` prop it is
 * handed, which is exactly the contract the API defines.
 *
 * WHAT AN EDITOR SEES
 *
 *   - the site's own colours as labelled swatches;
 *   - a colour picker, for anything else;
 *   - a box for typing a hex value, for when somebody has been given one;
 *   - a preview and a plain-English caption naming the colour in force.
 *
 * WHAT IS STORED
 *
 * A plain lowercase `#rrggbb` string and nothing else — the same kind of string
 * the repository already held, so no existing content had to be rewritten to
 * introduce this control and nothing downstream had to change.
 *
 * WHY NOT SIMPLY A DROPDOWN OF BRAND COLOURS
 *
 * Because the palette is a shortcut, not a rule. A dropdown would have made any
 * record holding an off-palette colour uneditable, and "the CMS refuses to open
 * my record" is a far worse outcome than an unusual shade. Typing a hex value is
 * always allowed, and a custom colour is reported as such rather than corrected
 * to the nearest preset.
 *
 * The palette itself is passed in from src/_data/cmsConfig.js, which reads the
 * real values out of the site's own stylesheets rather than repeating them here.
 */

(function () {
  "use strict";

  if (typeof window.CMS === "undefined" || !window.CMS.registerWidget) return;

  var h = window.h;
  var createClass = window.createClass;
  if (!h || !createClass) return;   // not the build we expect; do nothing

  var PALETTE = window.FED_BRAND_PALETTE || [];

  /** The one accepted spelling: #rrggbb, lowercase. */
  var HEX = /^#[0-9a-f]{6}$/;

  /**
   * Accept what an editor is likely to type; reject what is not a colour.
   *
   * `#ABC` and `#AABBCC` both become `#aabbcc`, and a missing `#` is forgiven —
   * colours get pasted from all sorts of places. Anything else returns null and
   * is reported, rather than being quietly turned into black, which is the
   * failure that would actually reach the website.
   */
  function normalise(raw) {
    if (typeof raw !== "string") return null;
    var v = raw.trim().toLowerCase();
    if (!v) return null;
    if (v.charAt(0) !== "#") v = "#" + v;
    if (/^#[0-9a-f]{3}$/.test(v)) {
      v = "#" + v.charAt(1) + v.charAt(1) + v.charAt(2) + v.charAt(2) + v.charAt(3) + v.charAt(3);
    }
    return HEX.test(v) ? v : null;
  }

  /** Black or white, whichever stays readable on this background. */
  function readableInk(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? "#16181d" : "#ffffff";
  }

  var Control = createClass({
    /** Commit a value straight through Decap's own onChange. */
    set: function (next) {
      this.props.onChange(next);
    },

    /**
     * Tidy up on blur, never mid-keystroke.
     *
     * Normalising on every keypress fights the editor: typing "#0" would become
     * "#000000" under their cursor. The raw text is kept while the box has
     * focus, and only tidied once they leave it.
     */
    tidy: function (e) {
      var n = normalise(e.target.value);
      if (n && n !== e.target.value) this.set(n);
    },

    renderSwatches: function (current) {
      var self = this;
      return PALETTE.map(function (c) {
        var on = current === c.hex;
        return h("button", {
          key: c.hex,
          type: "button",
          title: c.name + " — " + c.hex,
          "aria-label": c.name + " " + c.hex,
          "aria-pressed": on ? "true" : "false",
          className: "fed-swatch" + (on ? " fed-swatch-on" : ""),
          style: { background: c.hex, color: readableInk(c.hex) },
          onClick: function () { self.set(c.hex); },
        }, on ? "✓" : "");
      });
    },

    render: function () {
      var self = this;
      var value = this.props.value || "";
      var current = normalise(value);
      var known = null;
      for (var i = 0; i < PALETTE.length; i++) {
        if (PALETTE[i].hex === current) { known = PALETTE[i]; break; }
      }

      var caption = !value
        ? "No colour set."
        : current
          ? (known ? known.name + " — " + current : "Custom colour — " + current)
          : 'Not a colour yet. Use six digits, like #001f62.';

      return h("div", { className: "fed-colour" },
        h("div", { className: "fed-swatches" }, this.renderSwatches(current)),
        h("div", { className: "fed-colour-row" },
          h("input", {
            type: "color",
            className: "fed-colour-picker",
            "aria-label": "Colour picker",
            value: current || "#000000",
            onChange: function (e) { self.set(normalise(e.target.value) || e.target.value); },
          }),
          h("input", {
            type: "text",
            id: this.props.forID,
            className: "fed-colour-hex" + (value && !current ? " fed-colour-bad" : ""),
            placeholder: "#001f62",
            spellCheck: false,
            value: value,
            onChange: function (e) { self.set(e.target.value); },
            onBlur: function (e) { self.tidy(e); },
          }),
          h("button", {
            type: "button",
            className: "fed-colour-clear",
            onClick: function () { self.set(""); },
          }, "Clear")),
        h("div", { className: "fed-colour-status" },
          h("span", {
            className: "fed-colour-preview" + (current ? "" : " fed-colour-preview-empty"),
            style: current ? { background: current } : {},
            "aria-hidden": "true",
          }),
          h("span", { className: "fed-colour-caption" }, caption)));
    },
  });

  var Preview = createClass({
    render: function () {
      return h("span", null, this.props.value || "");
    },
  });

  /**
   * The widget's own validation, run before a save.
   *
   * Returning `{ error: { message } }` is the documented way to refuse a value,
   * and the message appears against the field — so the editor is told what is
   * wrong beside the thing that is wrong, rather than in a banner at the top.
   */
  function validator(props) {
    var value = props.value;
    if (value === undefined || value === null || value === "") return true;   // optional
    return normalise(value)
      ? true
      : { error: { message: 'Use a six-digit colour such as #001f62 — "' + value + '" is not one.' } };
  }

  window.CMS.registerWidget("brandColour", Control, Preview, { validator: validator });

  // Exposed for the rule tests and the browser acceptance tests, so neither has
  // to re-implement the normaliser to check it.
  window.fedBrandColour = { normalise: normalise, palette: PALETTE };
})();
