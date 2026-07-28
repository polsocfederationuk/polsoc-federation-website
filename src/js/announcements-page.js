/**
 * Announcements page — cards and modal.
 *
 * One script for both languages, replacing the two near-identical inline
 * copies on the live pages. It reads two globals that the generated data file
 * defines:
 *
 *   ANNOUNCEMENTS      the ordered array for this page's locale
 *   ANNOUNCEMENTS_UI   the locale's visible strings
 *
 * It therefore contains NO translated text of its own — every label comes from
 * src/_data/ui.json via the generated data file.
 *
 * SECURITY. `bodyHtml` is assigned with innerHTML. That is safe here and only
 * here: it is produced at BUILD time by markdown-it with `html: false`, so it
 * can only ever contain the small set of tags that renderer emits. Nothing in
 * this file interprets HTML that came from the browser or a URL. Every other
 * value from the data file is written with textContent or through `attr()`.
 *
 * Fails safely: if the expected markup is absent it returns immediately, so
 * loading it on another page does nothing and logs nothing.
 */
(function () {
  "use strict";

  function init() {
    var grid = document.getElementById("annGrid");
    var modal = document.getElementById("annModal");
    if (!grid || !modal || typeof ANNOUNCEMENTS === "undefined") return;

    var modalPhoto = document.getElementById("annModalPhoto");
    var modalDate = document.getElementById("annModalDate");
    var modalTitle = document.getElementById("annModalTitle");
    var modalBody = document.getElementById("annModalBody");
    var modalExtra = document.getElementById("annModalExtra");
    var closeBtn = document.getElementById("annClose");
    if (!modalPhoto || !modalDate || !modalTitle || !modalBody || !modalExtra || !closeBtn) return;

    var UI = typeof ANNOUNCEMENTS_UI !== "undefined" ? ANNOUNCEMENTS_UI : {};

    // Escape for use inside an HTML attribute (titles contain quotes and
    // ampersands — "OC&C", curly quotes, and so on).
    function attr(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function fill(pattern, values) {
      return String(pattern || "").replace(/\{(\w+)\}/g, function (_, k) {
        return values[k] != null ? values[k] : "";
      });
    }

    // item.image null = deliberate no-photo announcement.
    // item.fit "contain" (optional item.bg) = logo-style cover.
    // item.imagePos = CSS object-position, e.g. "center top".
    function photoHTML(item) {
      if (!item.image) return "";
      var cls = "ph" + (item.fit === "contain" ? " ph-contain" : "");
      var bg = item.bg ? ' style="background:' + attr(item.bg) + '"' : "";
      var pos = item.imagePos ? ' style="object-position:' + attr(item.imagePos) + '"' : "";
      return '<div class="' + cls + '"' + bg + '><img src="' + attr(item.image) +
        '" alt="' + attr(item.title) + '"' + pos + "></div>";
    }

    var lastFocused = null;

    function openModal(item, trigger) {
      lastFocused = trigger || document.activeElement;

      modalPhoto.innerHTML = photoHTML(item);
      modalDate.textContent = item.date;
      modalTitle.textContent = item.title;
      // Build-rendered Markdown — see the security note at the top of this file.
      modalBody.innerHTML = item.bodyHtml;

      var extra = "";
      if (item.closed) {
        extra += '<div class="ann-closed">' + attr(UI.signupsClosed) + "</div>";
      }
      if (item.extraImages && item.extraImages.length) {
        extra += '<div class="ann-extra">' + item.extraImages.map(function (src, n) {
          return '<img src="' + attr(src) + '" alt="' +
            attr(fill(UI.extraImageAltPattern, { title: item.title, n: n + 2 })) + '">';
        }).join("") + "</div>";
      }
      if (item.link) {
        extra += '<div class="ann-link"><a class="btn btn-primary" href="' + attr(item.link.href) + '"' +
          (item.link.external ? ' target="_blank" rel="noopener"' : "") + ">" +
          attr(item.link.text) + ' <span class="arrow">→</span></a></div>';
      }
      modalExtra.innerHTML = extra;

      modal.classList.add("open");
      document.body.style.overflow = "hidden";
      // Move focus into the dialog. The live pages leave focus on the card
      // behind the overlay; this is the one behavioural improvement here, and
      // it is what makes the Escape/close handlers reachable by keyboard.
      closeBtn.focus();
    }

    function closeModal() {
      if (!modal.classList.contains("open")) return;
      modal.classList.remove("open");
      document.body.style.overflow = "";
      // Return focus to the card that opened the dialog.
      if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
      lastFocused = null;
    }

    ANNOUNCEMENTS.forEach(function (item) {
      var card = document.createElement("button");
      card.className = "ann-card reveal" + (item.image ? "" : " no-photo");
      card.type = "button";
      card.innerHTML =
        photoHTML(item) +
        '<div class="ann-body">' +
        '<span class="ann-date">' + attr(item.date) + "</span>" +
        "<h3>" + attr(item.title) + "</h3>" +
        "<p>" + attr(item.subtitle) + "</p>" +
        '<span class="ann-more">' + attr(UI.readMore) + "</span>" +
        "</div>";
      card.addEventListener("click", function () { openModal(item, card); });
      grid.appendChild(card);
    });

    closeBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });

    // Re-run reveal observation for the cards injected above.
    var cards = document.querySelectorAll(".ann-card.reveal");
    Array.prototype.forEach.call(cards, function (el, i) {
      setTimeout(function () { el.classList.add("visible"); }, 120 + i * 90);
    });

    // Tilt effect on the injected cards (main.js loads before this script).
    if (window.applyTilt) window.applyTilt(document.querySelectorAll(".ann-card"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
