/**
 * Keep Decap's native preview handler; expose it beside View Live.
 * No React internals, replacement save/delete controls or listener duplication.
 */
(function () {
  "use strict";
  try { localStorage.setItem("cms.scroll-sync-enabled", "false"); } catch (_) {}
  var observer, pending;
  function button(title) { return document.querySelector('button[title="' + title + '"]'); }
  /**
   * The toolbar section that holds Publish, on a record with no View Live link
   * (every new record). Found from the Publish control itself — a <button> on
   * some records and a span with role="button" on others — walking up to the
   * child of the toolbar row that also holds the Back link. No generated class
   * names and no assumption about how many children the section has, which is
   * what used to leave the old floating toggle showing on a new team member.
   */
  function publishSection() {
    var back = document.querySelector('a[href^="#/collections/"]');
    var row = back && back.parentElement;
    if (!row) return null;
    var publish = Array.prototype.find.call(row.querySelectorAll('button, [role="button"]'), function (el) {
      return /^(publish|published|publishing|unpublish)/i.test(el.textContent.trim());
    });
    var node = publish;
    while (node && node.parentElement !== row) node = node.parentElement;
    return node && node !== back ? node : null;
  }

  function enhance() {
    var native = button("Toggle preview");
    var proxy = document.querySelector(".fed-toolbar-preview");
    if (!native) { if (proxy) proxy.remove(); return; }
    var live = Array.prototype.find.call(document.querySelectorAll("a"), function (a) { return /^view live$/i.test(a.textContent.trim()); });
    var target = live && live.parentElement;
    if (!target) target = publishSection();
    if (!target) return;
    if (!proxy) {
      proxy = document.createElement("button");
      proxy.type = "button";
      proxy.className = "fed-toolbar-preview";
      proxy.textContent = "Preview";
      proxy.addEventListener("click", function () {
        var current = button("Toggle preview");
        if (current) current.click();
        setTimeout(schedule, 0);
      });
    }
    if (proxy.parentElement !== target) {
      if (live) target.insertBefore(proxy, live);
      else target.appendChild(proxy);
    }
    proxy.setAttribute("aria-pressed", String(localStorage.getItem("cms.preview-visible") !== "false"));
    native.classList.add("fed-preview-native");
  }
  function run() {
    pending = false;
    if (observer) observer.disconnect();
    try { enhance(); } finally { observer.observe(document.body, { childList: true, subtree: true }); }
  }
  function schedule() { if (!pending) { pending = true; setTimeout(run, 60); } }
  function start() {
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", schedule);
    schedule();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
