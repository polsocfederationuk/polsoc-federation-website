/**
 * Members page — UK map, society pins and the index of cards below it.
 *
 * One script for both languages, replacing the two near-identical inline copies
 * on the live pages. It reads two globals the generated data file defines:
 *
 *   SOCIETIES      the ordered array for this page's locale
 *   SOCIETIES_UI   the locale's visible strings
 *
 * It therefore contains NO translated text of its own — every label and every
 * accessible name comes from src/_data/ui.json via the generated data file.
 *
 * Behaviour is carried over from the live inline script unchanged: the same
 * Leaflet options, the same CARTO tiles and attribution, the same UK lock and
 * resize handler, the same divIcon pin, the same popup markup, the same
 * fly-to-pin card interaction with its reduced-motion path and stalled-animation
 * safety net, and the same click-to-enable scroll zoom.
 *
 * Fails safely twice over: it returns immediately if Leaflet is unavailable
 * (CDN blocked, offline) and again if the expected markup is absent, so it does
 * nothing and logs nothing on any other page.
 *
 * NOTE ON STATUS FIELDS. Records carry `active`, `member` and `pastMember`.
 * They are deliberately NOT rendered — the membership chips they used to drive
 * were removed from the design on purpose. The data travels; the badges do not.
 */
(function () {
  "use strict";

  var MAIL_ICON =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="m3 6.5 9 6 9-6"/></svg>';
  var IG_ICON =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none"/></svg>';

  function init() {
    var mapEl = document.getElementById("map");
    var socGrid = document.getElementById("socGrid");

    // Not the members page — bind nothing, log nothing.
    if (!mapEl || !socGrid || typeof SOCIETIES === "undefined") return;

    // Leaflet is a third-party CDN script. If it is blocked or offline the page
    // must still render its cards rather than throwing on `L`.
    var hasLeaflet = typeof L !== "undefined" && L && typeof L.map === "function";

    var UI = typeof SOCIETIES_UI !== "undefined" ? SOCIETIES_UI : {};

    function attr(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
        .replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    function fill(pattern, values) {
      return String(pattern || "").replace(/\{(\w+)\}/g, function (_, k) {
        return values[k] != null ? values[k] : "";
      });
    }
    var igURL = function (s) { return "https://www.instagram.com/" + s.instagram + "/"; };

    var map = null;
    if (hasLeaflet) {
      // zoomSnap 0 lets fitBounds land on a fractional zoom, so the UK fills the
      // frame instead of being floored to the next integer zoom (a lot of ocean)
      map = L.map("map", { scrollWheelZoom: false, maxBoundsViscosity: 1, zoomSnap: 0 });

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
      }).addTo(map);

      // Keep the view on the UK: fit the isles, then forbid zooming or panning further out
      var UK = L.latLngBounds([49.7, -8.8], [59.6, 2.0]);
      var lockToUK = function () {
        map.setMinZoom(0).setMaxBounds(null);
        map.fitBounds(UK, { animate: false });
        map.setMinZoom(map.getZoom());
        map.setMaxBounds(UK.pad(0.12));
      };
      lockToUK();
      window.addEventListener("resize", function () {
        // Re-derive the floor when the container changes size, keeping the current centre
        var z = map.getZoom(), c = map.getCenter();
        map.setMinZoom(0).setMaxBounds(null);
        map.fitBounds(UK, { animate: false });
        var floor = map.getZoom();
        map.setMinZoom(floor).setMaxBounds(UK.pad(0.12));
        map.setView(c, Math.max(z, floor), { animate: false });
      });
    }

    var pinIcon = hasLeaflet
      ? L.divIcon({
          className: "",
          html: '<div class="soc-pin"></div>',
          iconSize: [26, 26],
          iconAnchor: [13, 26],
          popupAnchor: [0, -26],
        })
      : null;

    // Alphabetical, so the list below the map reads like an index. The data
    // file keeps the canonical `order`; this is a presentation choice, made
    // here exactly as the live page makes it.
    var ordered = SOCIETIES.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, "en");
    });

    ordered.forEach(function (s) {
      // An empty email is a real value — emit no mailto: control at all rather
      // than a link to "mailto:".
      var links =
        (s.email
          ? '<a href="mailto:' + attr(s.email) + '">' + MAIL_ICON + " " + attr(UI.emailLabel) + "</a>"
          : "") +
        '<a href="' + attr(igURL(s)) + '" target="_blank" rel="noopener">' +
        IG_ICON + " " + attr(UI.instagramLabel) + "</a>";

      var marker = null;
      if (hasLeaflet) {
        marker = L.marker([s.lat, s.lng], { icon: pinIcon }).addTo(map).bindPopup(
          '<div class="soc-popup">' +
          '<div class="soc-pop-head">' +
          '<img class="soc-logo" src="' + attr(s.logo) + '" alt="">' +
          "<div><h3>" + attr(s.name) + '</h3><div class="soc-uni">' + attr(s.uni) + "</div></div>" +
          "</div>" +
          '<div class="soc-links">' + links + "</div>" +
          "</div>"
        );
      }

      // Index card below the map — clicking the body flies the map to its pin
      var card = document.createElement("div");
      card.className = "soc-card";
      card.innerHTML =
        '<button class="soc-head" type="button">' +
        '<img class="soc-logo" src="' + attr(s.logo) + '" alt="">' +
        "<div><h3>" + attr(s.name) + '</h3><span class="soc-uni">' + attr(s.uni) + "</span></div>" +
        "</button>" +
        '<div class="soc-actions">' +
        (s.email
          ? '<a href="mailto:' + attr(s.email) + '" aria-label="' +
            attr(fill(UI.emailAriaPattern, { name: s.name })) + '" title="' + attr(s.email) + '">' +
            MAIL_ICON + "</a>"
          : "") +
        '<a href="' + attr(igURL(s)) + '" target="_blank" rel="noopener" aria-label="' +
        attr(fill(UI.instagramAriaPattern, { name: s.name })) + '" title="@' + attr(s.instagram) + '">' +
        IG_ICON + "</a>" +
        "</div>";

      card.querySelector(".soc-head").addEventListener("click", function () {
        mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
        if (!hasLeaflet || !marker) return;

        var opened = false;
        var open = function () { if (!opened) { opened = true; marker.openPopup(); } };

        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          map.setView([s.lat, s.lng], 15, { animate: false });
          open();
          return;
        }
        map.once("moveend", open);
        map.flyTo([s.lat, s.lng], 15, { duration: 1.1 });
        // Safety net: if the fly animation can't run (background tab, stalled rAF), jump
        setTimeout(function () {
          if (map.getZoom() < 14.9) map.setView([s.lat, s.lng], 15, { animate: false });
          open();
        }, 1400);
      });

      socGrid.appendChild(card);
    });

    // Enable scroll zoom only after the user clicks the map (prevents page-scroll traps)
    if (hasLeaflet) map.on("click", function () { map.scrollWheelZoom.enable(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
