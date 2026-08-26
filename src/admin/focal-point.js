/**
 * focal-point.js — the image crop control.
 *
 * A custom widget registered through Decap's documented `CMS.registerWidget`
 * API, built with the `h` / `createClass` globals that API provides.
 *
 * WHAT IT SHOWS, AND WHY THAT CHANGED
 *
 * The first version showed the CROPPED result with a marker on it. A human
 * tester found that unusable, and they were right: if you are only ever shown
 * what survives, you cannot see what is about to be thrown away, and the marker
 * is just an abstract dot.
 *
 * This version shows the FULL original photograph with the website's crop window
 * drawn on top of it. Everything outside that window is dimmed, so what will be
 * lost is the obvious thing on screen. Beside it sits the finished result.
 *
 * The crop window is not decorative. It is computed with the same arithmetic the
 * browser uses for `object-fit: cover` plus `object-position`, from the image's
 * real pixel dimensions — so where the rectangle sits IS where the crop falls,
 * for portrait and landscape sources alike.
 *
 * NOTHING IS CROPPED. The stored value is two percentages. The file is never
 * opened, re-encoded or copied, and one photograph can be framed differently in
 * different places.
 *
 * STORAGE IS UNCHANGED from Phase 17C.3:
 *
 *   value_format: "css"     an object-position string, e.g. "center 30%"
 *   value_format: "coords"  { x: 50, y: 30 }
 *
 * FAILURE SAFETY: if anything here throws, or the image cannot be read, the
 * control renders a message and LEAVES THE STORED VALUE ALONE.
 */

(function () {
  "use strict";

  if (typeof window.CMS === "undefined" || !window.CMS.registerWidget) return;

  var h = window.h;
  var createClass = window.createClass;
  if (!h || !createClass) return;

  var CENTRE = { x: 50, y: 50 };

  /* -- the limited parser --------------------------------------------------- */

  var KEYWORD_X = { left: 0, center: 50, centre: 50, right: 100 };
  var KEYWORD_Y = { top: 0, center: 50, centre: 50, bottom: 100 };

  function clamp(n) { return Math.max(0, Math.min(100, n)); }

  /**
   * Read a stored value into { x, y }, or null if it is not one.
   *
   * Deliberately narrow: it accepts the keywords and percentages the real
   * records use and nothing else. Anything unrecognised returns null and is
   * reported rather than passed through into a style attribute.
   */
  function parse(value) {
    if (value === null || value === undefined || value === "") return Object.assign({}, CENTRE);

    if (typeof value === "object" && !Array.isArray(value)) {
      // Decap hands a stored mapping over as an Immutable Map, not a plain
      // object, so `value.x` would be undefined and `Number(undefined)` NaN.
      var get = typeof value.get === "function"
        ? function (k) { return value.get(k); }
        : function (k) { return value[k]; };
      var rx = get("x");
      var ry = get("y");
      // Number(null) is 0 — a missing coordinate must not read as a corner.
      if ([rx, ry].some(function (v) {
        return v === null || v === undefined || v === "" || typeof v === "boolean";
      })) return null;
      var ox = Number(rx);
      var oy = Number(ry);
      if (!isFinite(ox) || !isFinite(oy)) return null;
      if (ox < 0 || ox > 100 || oy < 0 || oy > 100) return null;
      return { x: ox, y: oy };
    }

    if (typeof value !== "string") return null;

    var parts = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length === 0 || parts.length > 2) return null;

    // Out of range is refused, not clamped: a stored "110%" is a mistake, and
    // quietly turning it into 100% would hide it for good.
    var num = function (t) {
      var m = /^(\d+(?:\.\d+)?)%$/.exec(t);
      if (!m) return null;
      var n = parseFloat(m[1]);
      return n >= 0 && n <= 100 ? n : null;
    };

    if (parts.length === 1) {
      var t = parts[0];
      if (Object.prototype.hasOwnProperty.call(KEYWORD_X, t)) return { x: KEYWORD_X[t], y: 50 };
      var n = num(t);
      return n === null ? null : { x: n, y: 50 };
    }

    var xs = Object.prototype.hasOwnProperty.call(KEYWORD_X, parts[0])
      ? KEYWORD_X[parts[0]] : num(parts[0]);
    var ys = Object.prototype.hasOwnProperty.call(KEYWORD_Y, parts[1])
      ? KEYWORD_Y[parts[1]] : num(parts[1]);
    if (xs === null || ys === null) return null;
    return { x: xs, y: ys };
  }

  function tidy(p) { return { x: Math.round(clamp(p.x)), y: Math.round(clamp(p.y)) }; }

  function serialise(p, format) {
    var t = tidy(p);
    return format === "coords" ? { x: t.x, y: t.y } : t.x + "% " + t.y + "%";
  }

  /* -- the crop arithmetic --------------------------------------------------
     This is the whole point of the control, so it is written out plainly and
     tested on its own in scripts/test-event-rules.js.
     ------------------------------------------------------------------------ */

  /**
   * Which rectangle of the SOURCE image survives `object-fit: cover`?
   *
   * The browser scales the image so it covers the target box entirely, then
   * slides it so that the focal percentage of the image sits at the same
   * percentage of the box. What remains visible is a rectangle of the source in
   * the source's own aspect ratio on one axis and cropped on the other.
   *
   * Returned as fractions of the source image (0..1), which is what the overlay
   * needs and what makes the result independent of how big we draw it.
   *
   * @param {number} sw source width in pixels
   * @param {number} sh source height in pixels
   * @param {number} tw target width  (any unit; only the ratio matters)
   * @param {number} th target height
   * @param {{x:number,y:number}} focal percentages
   */
  function coverRect(sw, sh, tw, th, focal) {
    if (!(sw > 0 && sh > 0 && tw > 0 && th > 0)) return null;

    var sourceRatio = sw / sh;
    var targetRatio = tw / th;

    // The visible slice, in source pixels.
    var vw;
    var vh;
    if (sourceRatio > targetRatio) {
      // Source is wider than the box: full height is kept, sides are cropped.
      vh = sh;
      vw = sh * targetRatio;
    } else {
      // Source is taller: full width is kept, top and bottom are cropped.
      vw = sw;
      vh = sw / targetRatio;
    }

    // `object-position` places the slice: at 0% it hugs the left/top, at 100%
    // the right/bottom. The travel available is whatever is left over.
    var left = (sw - vw) * (clamp(focal.x) / 100);
    var top = (sh - vh) * (clamp(focal.y) / 100);

    // Formatted to match src/_data/focalPoint.js exactly — the test compares the
    // two bodies so the browser and the build can never drift apart.
    return { left: left / sw, top: top / sh, width: vw / sw, height: vh / sh };
  }

  /* -- config, tolerant of Immutable or plain objects ------------------------ */

  function cfg(field, key, fallback) {
    if (!field) return fallback;
    var v = typeof field.get === "function" ? field.get(key) : field[key];
    if (v === undefined || v === null) return fallback;
    return typeof v.toJS === "function" ? v.toJS() : v;
  }

  /**
   * The image this crop applies to, read from the entry being edited.
   *
   * `props.entry` is the entry as STORED, not the draft being typed — choosing a
   * new image does not update it, and Decap exposes no documented way for one
   * widget to read another field's unsaved value. So the previews appear for an
   * image that has been saved; the empty state says so plainly.
   */
  function imageFrom(entry, name) {
    if (!entry || !name) return null;
    try {
      var data = typeof entry.get === "function" ? entry.get("data") : entry.data;
      if (!data) return null;
      var v = typeof data.getIn === "function" ? data.getIn(String(name).split(".")) : data[name];
      return typeof v === "string" && v ? v : null;
    } catch (e) {
      return null;
    }
  }

  /* -- the control ---------------------------------------------------------- */

  var Control = createClass({
    getInitialState: function () {
      return { natural: null, frame: 0, fineTune: false, failed: false };
    },

    point: function () {
      var p = parse(this.props.value);
      return p || Object.assign({}, CENTRE);
    },

    commit: function (p) {
      this.props.onChange(serialise(p, cfg(this.props.field, "value_format", "css")));
    },

    onImageLoad: function (e) {
      var img = e.target;
      if (img.naturalWidth && img.naturalHeight) {
        this.setState({ natural: { w: img.naturalWidth, h: img.naturalHeight } });
      }
    },

    onImageError: function () { this.setState({ failed: true }); },

    /** A click or drag anywhere on the ORIGINAL sets the focus. */
    fromEvent: function (e, el) {
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      var src = e.touches && e.touches.length ? e.touches[0] : e;
      return {
        x: clamp(((src.clientX - r.left) / r.width) * 100),
        y: clamp(((src.clientY - r.top) / r.height) * 100),
      };
    },

    onDown: function (e) {
      var stage = e.currentTarget;
      var self = this;
      var apply = function (ev) {
        var p = self.fromEvent(ev, stage);
        if (p) self.commit(p);
      };
      apply(e);
      var move = function (ev) {
        apply(ev);
        if (ev.cancelable) ev.preventDefault();
      };
      var up = function () {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        document.removeEventListener("touchmove", move);
        document.removeEventListener("touchend", up);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      document.addEventListener("touchmove", move, { passive: false });
      document.addEventListener("touchend", up);
    },

    onKey: function (e) {
      var step = e.shiftKey ? 10 : 1;
      var p = this.point();
      var moved = null;
      if (e.key === "ArrowLeft") moved = { x: p.x - step, y: p.y };
      else if (e.key === "ArrowRight") moved = { x: p.x + step, y: p.y };
      else if (e.key === "ArrowUp") moved = { x: p.x, y: p.y - step };
      else if (e.key === "ArrowDown") moved = { x: p.x, y: p.y + step };
      if (!moved) return;
      e.preventDefault();
      this.commit(moved);
    },

    /* -- the original, with the crop window drawn on it --------------------- */

    renderStage: function (image, p, frame) {
      var self = this;
      var nat = this.state.natural;
      var rect = nat ? coverRect(nat.w, nat.h, frame.ratio_w, frame.ratio_h, p) : null;

      var children = [
        h("img", {
          key: "img",
          src: image,
          alt: "",
          className: "fed-crop-original",
          onLoad: function (e) { self.onImageLoad(e); },
          onError: function () { self.onImageError(); },
          draggable: false,
        }),
      ];

      if (rect) {
        var pc = function (n) { return (n * 100) + "%"; };
        // Four panels dim everything the website will not show. Drawn as
        // separate strips rather than one box-shadow so the boundary is a hard,
        // obvious edge at any size.
        children.push(
          h("div", { key: "mt", className: "fed-crop-shade",
            style: { left: 0, top: 0, width: "100%", height: pc(rect.top) } }),
          h("div", { key: "mb", className: "fed-crop-shade",
            style: { left: 0, top: pc(rect.top + rect.height), width: "100%",
              height: pc(1 - rect.top - rect.height) } }),
          h("div", { key: "ml", className: "fed-crop-shade",
            style: { left: 0, top: pc(rect.top), width: pc(rect.left), height: pc(rect.height) } }),
          h("div", { key: "mr", className: "fed-crop-shade",
            style: { left: pc(rect.left + rect.width), top: pc(rect.top),
              width: pc(1 - rect.left - rect.width), height: pc(rect.height) } }),
          h("div", { key: "win", className: "fed-crop-window",
            style: { left: pc(rect.left), top: pc(rect.top),
              width: pc(rect.width), height: pc(rect.height) } }),
          h("span", { key: "dot", className: "fed-crop-dot",
            style: { left: p.x + "%", top: p.y + "%" }, "aria-hidden": "true" })
        );
      }

      return h("div", { className: "fed-crop-stage-wrap" },
        h("div", {
          className: "fed-crop-stage",
          role: "application",
          tabIndex: 0,
          "aria-label": "Original photograph — click, drag or use the arrow keys to choose what stays visible",
          onMouseDown: function (e) { self.onDown(e); },
          onTouchStart: function (e) { self.onDown(e); },
          onKeyDown: function (e) { self.onKey(e); },
        }, children),
        h("p", { className: "fed-crop-caption" }, "Original photograph"),
        nat ? h("p", { className: "fed-crop-dims" },
          "The shaded areas will not appear on the website.") : null);
    },

    /* -- the finished result ------------------------------------------------ */

    renderResult: function (image, p, frame) {
      return h("div", { className: "fed-crop-result-wrap" },
        h("div", {
          className: "fed-crop-result",
          style: { aspectRatio: frame.ratio_w + " / " + frame.ratio_h },
        },
        h("img", {
          src: image, alt: "",
          className: "fed-crop-result-img",
          style: { objectPosition: p.x + "% " + p.y + "%" },
          draggable: false,
        })),
        h("p", { className: "fed-crop-caption" },
          "What visitors will see" + (frame.approximate ? " (approximate shape)" : "")));
    },

    render: function () {
      var self = this;
      var field = this.props.field;
      var frames = cfg(field, "frames", []) || [];
      var image = imageFrom(this.props.entry, cfg(field, "image_field", null));
      var raw = this.props.value;
      var parsed = parse(raw);
      var p = parsed || Object.assign({}, CENTRE);

      // An unreadable stored value is REPORTED, never silently replaced.
      var unreadable = (raw !== null && raw !== undefined && raw !== "" && !parsed)
        ? h("p", { className: "fed-crop-warn" },
          "This crop was saved in a form the editor does not recognise (" +
          JSON.stringify(raw) + "). Choose a new one below, or leave it and it " +
          "will stay exactly as it is.")
        : null;

      if (!image) {
        return h("div", { className: "fed-crop" }, unreadable,
          h("p", { className: "fed-crop-empty" },
            "The crop appears once an image has been saved on this record. If you " +
            "have just chosen one, save first and then come back."));
      }

      if (this.state.failed) {
        return h("div", { className: "fed-crop" }, unreadable,
          h("p", { className: "fed-crop-warn" },
            "That image could not be loaded, so the crop cannot be shown. The " +
            "saved setting has not been changed."));
      }

      var frame = frames[Math.min(this.state.frame, frames.length - 1)] || { ratio_w: 1, ratio_h: 1 };

      // More than one shape means one setting serves several places, and the
      // editor should be able to look at each of them.
      var chooser = frames.length > 1
        ? h("div", { className: "fed-crop-tabs", role: "tablist", "aria-label": "Where this image appears" },
          frames.map(function (f, i) {
            var on = i === self.state.frame;
            return h("button", {
              key: i, type: "button", role: "tab",
              "aria-selected": on ? "true" : "false",
              className: "fed-crop-tab" + (on ? " fed-crop-tab-on" : ""),
              onClick: function () { self.setState({ frame: i }); },
            }, f.label);
          }))
        : null;

      var fine = this.state.fineTune
        ? h("div", { className: "fed-crop-fine" },
          ["x", "y"].map(function (axis) {
            return h("label", { key: axis, className: "fed-crop-number" },
              h("span", null, axis === "x" ? "Across" : "Down"),
              h("input", {
                type: "number", min: 0, max: 100, step: 1,
                value: String(p[axis]),
                "aria-label": axis === "x"
                  ? "Position across, percent from the left"
                  : "Position down, percent from the top",
                onChange: function (e) {
                  var n = Number(e.target.value);
                  if (!isFinite(n)) return;
                  var next = { x: p.x, y: p.y };
                  next[axis] = clamp(n);
                  self.commit(next);
                },
              }),
              h("span", { className: "fed-crop-pc" }, "%"));
          }))
        : null;

      return h("div", { className: "fed-crop" },
        unreadable,
        h("p", { className: "fed-crop-lead" },
          "Choose which part of the photograph should stay visible when the " +
          "website crops it."),
        chooser,
        h("div", { className: "fed-crop-pair" },
          this.renderStage(image, p, frame),
          this.renderResult(image, p, frame)),
        h("div", { className: "fed-crop-actions" },
          h("button", {
            type: "button", className: "fed-crop-btn",
            onClick: function () { self.commit(Object.assign({}, CENTRE)); },
          }, "Centre image"),
          h("button", {
            type: "button", className: "fed-crop-btn fed-crop-btn-quiet",
            "aria-expanded": this.state.fineTune ? "true" : "false",
            onClick: function () { self.setState({ fineTune: !self.state.fineTune }); },
          }, this.state.fineTune ? "Hide fine tune" : "Fine tune")),
        fine);
    },
  });

  var Preview = createClass({
    render: function () {
      var p = parse(this.props.value);
      return h("span", null, p ? p.x + "% / " + p.y + "%" : "");
    },
  });

  function validator(props) {
    var v = props.value;
    if (v === null || v === undefined || v === "") return true;
    return parse(v)
      ? true
      : { error: { message:
        "This crop setting is not one the website can use. Click the photograph " +
        "to choose which part should stay visible." } };
  }

  window.CMS.registerWidget("focalPoint", Control, Preview, { validator: validator });

  // Exposed so the tests drive the real parser and the real crop arithmetic
  // rather than a second copy of either.
  window.fedFocalPoint = { parse: parse, serialise: serialise, coverRect: coverRect, CENTRE: CENTRE };
})();
