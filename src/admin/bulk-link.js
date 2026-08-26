/**
 * bulk-link.js — put Bulk manage where somebody will find it.
 *
 * WHY THIS IS A LINK AND NOT A FEATURE
 *
 * Decap 3.15.1 registers widgets, previews, backends, media libraries, locales,
 * event listeners and custom formats. There is no API for adding a page, a
 * route or a sidebar entry — `registerAdditionalLink` does not exist in this
 * version's bundle — so Bulk manage is a page of our own at /admin/bulk/, and
 * this adds one anchor pointing at it.
 *
 * DEGRADING WELL IS THE POINT. This is the only part of the feature that
 * touches Decap's own markup, and all it does is APPEND a link beside the
 * collection list. If a future Decap release renames that list, the link simply
 * does not appear: nothing is moved, nothing is replaced, no control is taken
 * over, and the screen is still reachable at its URL and from the banner link
 * on the admin page. Compare that with injecting checkboxes into the collection
 * list itself, where the same change would silently break selection.
 *
 * Idempotent, and the observer stops as soon as the link exists.
 */

(function () {
  "use strict";

  var ID = "fed-bulk-link";
  var HREF = "/admin/bulk/";

  function place() {
    if (document.getElementById(ID)) return true;

    /*
      The collection list is a <nav> or a list of collection links. Anchored on
      Decap's own hrefs — values this repository controls through config.yml —
      rather than on a generated class name.
    */
    var anyCollection = document.querySelector('a[href^="#/collections/"]');
    if (!anyCollection) return false;

    var list = anyCollection.parentElement;
    while (list && list.querySelectorAll('a[href^="#/collections/"]').length < 2) {
      list = list.parentElement;
    }
    if (!list) list = anyCollection.parentElement;
    if (!list) return false;

    var link = document.createElement("a");
    link.id = ID;
    link.className = ID;
    link.href = HREF;
    link.textContent = "Bulk manage";
    link.title = "Hide, show or delete several records at once";
    list.appendChild(link);
    return true;
  }

  var observer = null;

  function arm() {
    if (place()) return;
    if (observer) return;
    observer = new MutationObserver(function () {
      try {
        if (place()) { observer.disconnect(); observer = null; }
      } catch (e) {
        // A convenience link must never break the editor.
        if (observer) { observer.disconnect(); observer = null; }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener("hashchange", function () {
    // Decap re-renders the shell on some route changes; put it back if so.
    if (!document.getElementById(ID)) arm();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", arm);
  } else { arm(); }

  window.fedBulkLink = {
    href: HREF,
    present: function () { return Boolean(document.getElementById(ID)); },
  };
})();
