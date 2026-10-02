/**
 * map-picker.js — put a society on the map by clicking it.
 *
 * A society record keeps its position as two plain numbers, `latitude` and
 * `longitude`, and every check and page reads them that way. Decap gives a
 * widget one field, so this is two registered widgets that work as a pair:
 *
 *   mapPicker     on `latitude`: the map, the pin, both number boxes and a
 *                 "paste coordinates" box. It stores the latitude itself.
 *   mapPartner    on `longitude`: draws nothing (its row is hidden by CSS) and
 *                 stores the longitude the map sends it.
 *
 * They talk through one window event, scoped by the map's own id, so two open
 * editors could never cross. The stored values are exactly what they were:
 * numbers rounded to 4 decimal places (about 10 m), like the existing records.
 *
 * Leaflet is the pinned npm copy, inlined in the admin page (no CDN: the
 * admin's security policy allows scripts from this site only). Tiles are
 * CARTO's, with the site's basemaps key when the build has one.
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || !window.CMS) return;
  var h = window.h, createClass = window.createClass;
  if (!h || !createClass) return;

  var EVENT = "fed-map-pick";
  var UK = [[49.7, -8.8], [59.6, 2.0]];
  var round = function (n) { return Math.round(Number(n) * 10000) / 10000; };
  var isLat = function (n) { return typeof n === "number" && isFinite(n) && n >= -90 && n <= 90; };
  var isLng = function (n) { return typeof n === "number" && isFinite(n) && n >= -180 && n <= 180; };
  var num = function (v) {
    if (typeof v === "number") return v;
    var s = String(v == null ? "" : v).trim();
    return s === "" ? NaN : Number(s.replace(",", "."));
  };

  /**
   * "57.1645, -2.1011", "57.1645 -2.1011", or a Google Maps link
   * (…/@57.1645,-2.1011,15z or …?q=57.1645,-2.1011) → [lat, lng], else null.
   */
  function parseCoordinates(text) {
    var s = String(text || "");
    var m = /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(s) ||
      /[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(s) ||
      /(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)/.exec(s);
    if (!m) return null;
    var lat = Number(m[1]), lng = Number(m[2]);
    return isLat(lat) && isLng(lng) ? [round(lat), round(lng)] : null;
  }

  var pinIcon = function () {
    return window.L.divIcon({
      className: "",
      html: '<div class="fed-map-pin"></div>',
      iconSize: [26, 26],
      iconAnchor: [13, 26],
    });
  };

  /* -- the longitude half: stores what the map sends, draws nothing ---------- */

  var Partner = createClass({
    componentDidMount: function () {
      var self = this;
      this.listen = function (e) {
        var d = e.detail || {};
        if (d.entryKey !== self.entryKey()) return;
        if (d.lng !== self.props.value) self.props.onChange(d.lng);
      };
      window.addEventListener(EVENT, this.listen);
    },
    componentWillUnmount: function () { window.removeEventListener(EVENT, this.listen); },
    entryKey: function () {
      var e = this.props.entry;
      return (e && e.get && (e.get("path") || e.get("slug"))) || "new";
    },
    render: function () {
      return h("span", { id: this.props.forID, className: "fed-map-partner", "aria-hidden": "true" });
    },
  });

  /* -- the latitude half: the map and every way to set the position -------- */

  var Picker = createClass({
    getInitialState: function () { return { paste: "", pasteError: false, latText: null, lngText: null }; },

    entryKey: function () {
      var e = this.props.entry;
      return (e && e.get && (e.get("path") || e.get("slug"))) || "new";
    },
    lat: function () { return num(this.props.value); },
    lng: function () {
      var e = this.props.entry;
      return num(e && e.getIn ? e.getIn(["data", "longitude"]) : NaN);
    },

    /** Decap redraws on the widget's own value only; the longitude matters too. */
    shouldComponentUpdate: function (nextProps, nextState) {
      if (nextState !== undefined && nextState !== this.state) return true;
      var p = this.props;
      var lngOf = function (props) { return props.entry && props.entry.getIn ? props.entry.getIn(["data", "longitude"]) : null; };
      return nextProps.value !== p.value || lngOf(nextProps) !== lngOf(p) ||
        nextProps.isDisabled !== p.isDisabled || nextProps.classNameWrapper !== p.classNameWrapper;
    },

    set: function (lat, lng, from) {
      lat = round(lat); lng = round(lng);
      if (!isLat(lat) || !isLng(lng)) return;
      this.setState({ latText: null, lngText: null });
      if (lat !== this.props.value) this.props.onChange(lat);
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { entryKey: this.entryKey(), lat: lat, lng: lng } }));
      if (from !== "map") this.placePin(lat, lng, true);
    },

    placePin: function (lat, lng, fly) {
      if (!this.map) return;
      if (!isLat(lat) || !isLng(lng)) {
        if (this.marker) { this.marker.remove(); this.marker = null; }
        return;
      }
      if (!this.marker) {
        var self = this;
        this.marker = window.L.marker([lat, lng], { icon: pinIcon(), draggable: !this.props.isDisabled, keyboard: true,
          title: "Society location — drag to move" }).addTo(this.map);
        this.marker.on("dragend", function () {
          var p = self.marker.getLatLng();
          self.set(p.lat, p.lng, "map");
        });
      } else {
        this.marker.setLatLng([lat, lng]);
      }
      if (fly) this.map.setView([lat, lng], Math.max(this.map.getZoom(), 12));
    },

    componentDidMount: function () {
      var L = window.L;
      if (!L || !this.mapEl) return;
      var self = this;
      this.map = L.map(this.mapEl, { scrollWheelZoom: false, zoomSnap: 0.5 });
      var key = String(window.FED_MAP_TILES_KEY || "");
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" +
        (key ? "?key=" + encodeURIComponent(key) : ""), {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
        // The admin sends no referrer at all (netlify.toml). A key restricted
        // to this site needs the tile requests to say where they come from.
        referrerPolicy: "strict-origin-when-cross-origin",
      }).addTo(this.map);
      var lat = this.lat(), lng = this.lng();
      if (isLat(lat) && isLng(lng)) {
        this.map.setView([lat, lng], 12);
        this.placePin(lat, lng, false);
      } else {
        this.map.fitBounds(UK);
      }
      this.map.on("click", function (e) {
        if (self.props.isDisabled) return;
        self.placePin(e.latlng.lat, e.latlng.lng, false);
        self.set(e.latlng.lat, e.latlng.lng, "map");
      });
      this.map.on("focus", function () { self.map.scrollWheelZoom.enable(); });
      this.map.on("blur", function () { self.map.scrollWheelZoom.disable(); });
      // The form lays itself out after this mounts; measure again once it has.
      setTimeout(function () { if (self.map) self.map.invalidateSize(); }, 300);
    },

    componentDidUpdate: function () {
      var lat = this.lat(), lng = this.lng();
      if (this.marker && isLat(lat) && isLng(lng)) {
        var at = this.marker.getLatLng();
        if (round(at.lat) !== lat || round(at.lng) !== lng) this.marker.setLatLng([lat, lng]);
      } else if (!this.marker && isLat(lat) && isLng(lng)) {
        this.placePin(lat, lng, false);
      }
    },

    componentWillUnmount: function () { if (this.map) { this.map.remove(); this.map = null; } },

    typed: function (which, text) {
      var patch = {}; patch[which] = text; this.setState(patch);
      var lat = which === "latText" ? num(text) : this.lat();
      var lng = which === "lngText" ? num(text) : this.lng();
      if (isLat(lat) && isLng(lng)) this.set(lat, lng, "typed");
    },

    pasted: function () {
      var found = parseCoordinates(this.state.paste);
      if (!found) { this.setState({ pasteError: true }); return; }
      this.setState({ paste: "", pasteError: false });
      this.set(found[0], found[1], "paste");
    },

    render: function () {
      var self = this, p = this.props;
      var lat = this.lat(), lng = this.lng();
      var has = isLat(lat) && isLng(lng);
      var latShown = this.state.latText != null ? this.state.latText : (isLat(lat) ? String(lat) : "");
      var lngShown = this.state.lngText != null ? this.state.lngText : (isLng(lng) ? String(lng) : "");
      return h("div", { className: "fed-map-picker" },
        h("div", {
          className: "fed-map-canvas", ref: function (el) { self.mapEl = el; },
          role: "application", "aria-label": "Map. Click to place the society's pin; drag the pin to move it.",
        }),
        h("p", { className: "fed-map-status" + (has ? "" : " is-empty") },
          has ? "Pin placed. Drag it, or click elsewhere on the map, to move it."
            : "Click the map where the university campus is, or paste coordinates below."),
        h("div", { className: "fed-map-fields" },
          h("label", null, h("span", null, "Latitude"),
            h("input", { id: p.forID, type: "text", inputMode: "decimal", value: latShown, disabled: Boolean(p.isDisabled),
              placeholder: "e.g. 51.5246", onChange: function (e) { self.typed("latText", e.target.value); } })),
          h("label", null, h("span", null, "Longitude"),
            h("input", { type: "text", inputMode: "decimal", value: lngShown, disabled: Boolean(p.isDisabled),
              placeholder: "e.g. -0.1340", onChange: function (e) { self.typed("lngText", e.target.value); } }))),
        h("div", { className: "fed-map-paste" },
          h("label", { htmlFor: p.forID + "-paste" }, "Or paste coordinates or a Google Maps link"),
          h("div", { className: "fed-map-paste-row" },
            h("input", { id: p.forID + "-paste", type: "text", value: this.state.paste, disabled: Boolean(p.isDisabled),
              placeholder: "51.5246, -0.1340",
              "aria-invalid": this.state.pasteError ? "true" : undefined,
              onChange: function (e) { self.setState({ paste: e.target.value, pasteError: false }); },
              onKeyDown: function (e) { if (e.key === "Enter") { e.preventDefault(); self.pasted(); } } }),
            h("button", { type: "button", className: "fed-map-button", disabled: Boolean(p.isDisabled) || !this.state.paste.trim(),
              onClick: function () { self.pasted(); } }, "Place pin")),
          this.state.pasteError ? h("p", { className: "fed-map-error", role: "alert" },
            "No coordinates found in that. Try \u201c51.5246, -0.1340\u201d, or copy a link from Google Maps.") : null));
    },
  });

  window.CMS.registerWidget("mapPicker", Picker);
  window.CMS.registerWidget("mapPartner", Partner);
  window.fedMapPicker = { parseCoordinates: parseCoordinates };
})();
