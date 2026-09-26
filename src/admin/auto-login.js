/**
 * auto-login.js — no "Login" button in front of the CMS.
 *
 * With the `proxy` backend Decap's own login screen is ceremony: pressing
 * "Login" checks nothing and grants nothing. Locally there is no sign-in at
 * all; in production the server decides access from the Netlify Identity
 * session on every request, and session.js has already sent anybody without a
 * session to /staff-login/ before Decap is started.
 *
 * Decap shows that screen whenever it finds no remembered user in local
 * storage — on a first visit, in a private window, or after storage is
 * cleared. session.js's restoreUser override only helps once something is
 * stored, so the button still appeared. This stores the same one key the
 * button would have stored, before Decap looks for it.
 *
 * Runs straight after the Decap bundle is evaluated. Decap reads the key only
 * after it has fetched config.yml, which is asynchronous, so this is in time.
 *
 * LOCAL ONLY (window.FED_LOCAL_CMS): choosing "Log out" in the account menu
 * brings Decap's screen back without a page load. There is nothing to log out
 * of locally, so the screen is passed straight through. In production "Log
 * out" leaves for /staff-login/ instead (session.js), so this never applies.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  var KEY = "decap-cms-user";

  function remember() {
    try {
      var stored = JSON.parse(window.localStorage.getItem(KEY) || "null");
      if (stored && stored.backendName === "proxy") return;
      window.localStorage.setItem(KEY, JSON.stringify({ backendName: "proxy" }));
    } catch (err) { /* No storage: Decap shows its button, which still works. */ }
  }
  remember();

  if (!window.FED_LOCAL_CMS || typeof MutationObserver === "undefined") return;

  /** Decap's login screen: a lone "Login" button and no CMS header. */
  function loginButton() {
    if (document.querySelector('a[href^="#/collections"]')) return null;
    return Array.prototype.find.call(document.querySelectorAll("button"), function (b) {
      return b.textContent.trim() === "Login";
    }) || null;
  }

  var pressed = 0;
  function check() {
    var button = loginButton();
    if (!button || pressed > 3) return;   // never loop if something is wrong
    pressed++;
    remember();
    button.click();
  }

  function start() {
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
    check();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  window.fedAutoLogin = { remember: remember };
})();
