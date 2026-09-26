/**
 * link-ux.js — show only the field the chosen button destination uses.
 *
 * The announcement's "Destination link" block holds three controls: the
 * destination (now three cards), the Federation event, and the external
 * address. Only one of the last two ever matters, and normaliseAnnouncementLink()
 * already discards the other on save. This hides the one that would be
 * discarded, so the form asks one question at a time — the same approach as
 * registration-ux.js.
 *
 * NOTHING IS REMOVED, ONLY HIDDEN. Values stay in the draft; switching back
 * shows them unchanged. Presentation only.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  var HIDDEN = "fed-when-hidden";

  function onAnnouncement() { return /#\/collections\/announcements\//.test(location.hash || ""); }

  function fieldIn(scope, name) {
    var el = scope.querySelector('[id^="' + name + '-field-"]');
    return el ? el.closest('[aria-label$="field"]') : null;
  }

  function show(field, visible) {
    if (field) field.classList.toggle(HIDDEN, !visible);
  }

  function pass() {
    if (!onAnnouncement()) return;
    var blocks = document.querySelectorAll('[id^="link-field-"]');
    for (var i = 0; i < blocks.length; i++) {
      var scope = blocks[i].closest('[aria-label$="field"]');
      if (!scope) continue;
      var typeField = fieldIn(scope, "type");
      var checked = typeField && typeField.querySelector('input[type="radio"]:checked');
      // Nothing readable (an older control, or not drawn yet): show everything.
      var type = checked ? checked.value : "";
      show(fieldIn(scope, "event_slug"), !type || type === "event");
      show(fieldIn(scope, "url"), !type || type === "external");
    }
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    Promise.resolve().then(function () { queued = false; try { pass(); } catch (e) { /* stay visible */ } });
  }

  function start() {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    document.addEventListener("change", function (e) {
      if (e.target && e.target.matches && e.target.matches('input[type="radio"]')) schedule();
    });
    window.addEventListener("hashchange", schedule);
    pass();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  window.fedLinkUx = { pass: pass };
})();
