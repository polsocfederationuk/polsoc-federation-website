/**
 * privacy-page.js — the privacy policy page's two small behaviours:
 * highlight the section being read in the contents list, and print.
 * The page is complete and readable without it.
 */
(function () {
  "use strict";
  var printButton = document.querySelector("[data-fed-print]");
  if (printButton) printButton.addEventListener("click", function () { window.print(); });

  var links = Array.prototype.slice.call(document.querySelectorAll(".policy-toc a[href^='#']"));
  if (!links.length || !("IntersectionObserver" in window)) return;
  var byId = {};
  links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });

  var visible = {};
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
    var current = null;
    for (var i = 0; i < links.length; i++) {
      var id = links[i].getAttribute("href").slice(1);
      if (visible[id]) { current = id; break; }
    }
    if (!current) return;
    links.forEach(function (a) {
      var on = a === byId[current];
      a.classList.toggle("is-current", on);
      if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
  }, { rootMargin: "-100px 0px -55% 0px" });
  Object.keys(byId).forEach(function (id) {
    var section = document.getElementById(id);
    if (section) observer.observe(section);
  });
})();
