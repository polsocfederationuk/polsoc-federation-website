/**
 * session.js — /staff-login/ is the only sign-in screen anybody sees.
 *
 * THE SCREEN THIS EXISTS TO REMOVE
 *
 * Decap ships its own login page, and with the `proxy` backend it is pure
 * ceremony: `authenticate()` resolves immediately and writes one key to local
 * storage. Pressing "Login" on it proves nothing and grants nothing — the
 * server decides that, from the Identity session — but it looks exactly like an
 * authentication screen, and "Log Out" returned people to it. Somebody who
 * signed out could press Login and appear to be back in, which is the opposite
 * of what signing out should mean.
 *
 * So Decap's screen never renders. `window.CMS_MANUAL_INIT` is set before the
 * bundle loads, which stops it initialising itself, and nothing here calls
 * `initCMS()` until Netlify Identity has said who this is. Somebody without a
 * session is sent to /staff-login/ before Decap has drawn anything at all.
 *
 * WHAT DECIDES ACCESS
 *
 * Not this file. Every request is authorised again in the function that serves
 * it, from the session cookie, against the roles Identity holds — see
 * netlify/lib/session.js and netlify/lib/authz.js. The role shown beside the
 * avatar here is a label on a screen. A browser that skipped all of this would
 * reach a CMS that cannot read or write anything.
 *
 * WHY THE IDENTITY CLIENT STAYS LOADED
 *
 * `getUser()` hydrates the session and starts the library's own refresh timer,
 * which rewrites `nf_jwt` before it expires. Without it a CMS tab left open
 * would quietly stop working after an hour, with every request refused and
 * nothing on screen to say why.
 */

(function () {
  "use strict";

  var api = window.netlifyIdentityApi;
  var LOGIN = "/staff-login/";
  var ROLES = { admin: "Administrator", editor: "Editor" };

  /* -- leaving --------------------------------------------------------------- */

  var leaving = false;

  /**
   * Send somebody to the sign-in page, once.
   *
   * `replace`, not `assign`: Back should return to the website rather than to a
   * CMS that is about to bounce them straight here again.
   */
  function leave(query) {
    if (leaving) return;
    leaving = true;
    window.location.replace(LOGIN + (query || ""));
  }

  /** End the Identity session first, so signing out actually signs out. */
  function signOut(query) {
    if (leaving) return;
    var done = function () { leave(query); };
    try {
      // The library clears nf_jwt and nf_refresh either way; a network failure
      // on the way out must not strand somebody inside the CMS.
      api.logout().then(done, done);
    } catch (err) {
      done();
    }
  }

  /* -- who is signed in ------------------------------------------------------ */

  /** The role this account holds, or null. Display only. */
  function roleOf(user) {
    var roles = (user && user.roles) || [];
    for (var i = 0; i < roles.length; i++) {
      var role = String(roles[i]).toLowerCase();
      if (role === "admin") return "admin";
      if (role === "editor") return "editor";
    }
    return null;
  }

  /* -- the backend ----------------------------------------------------------- */

  /**
   * Decap's own proxy backend, with two answers changed.
   *
   * COMPOSED, NOT REIMPLEMENTED. `getBackend("proxy").init` is a factory rather
   * than a class, so it cannot be extended — but a constructor may return an
   * object, and returning the built-in instance keeps every file operation
   * Decap already implements and tests. Only two methods are replaced.
   *
   *   restoreUser  Decap shows its login screen whenever this resolves nothing,
   *                which is what happens on a first visit with empty local
   *                storage. Since the real session has already been checked
   *                above, there is nothing left for that screen to ask.
   *
   *   logout       Decap's own would clear its local storage and return to that
   *                same screen, leaving the Identity session alive behind it.
   *                This ends the real session instead.
   *
   * If a future Decap changes either name this simply does not apply, and the
   * CMS behaves as it does today rather than breaking.
   */
  function useOwnBackend() {
    var CMS = window.CMS;
    if (!CMS || typeof CMS.getBackend !== "function") return false;
    var registered = CMS.getBackend("proxy");
    var builtin = registered && registered.init;
    if (typeof builtin !== "function") return false;

    CMS.registerBackend("proxy", function (config, options) {
      var inner = builtin(config, options);
      inner.restoreUser = function () {
        return Promise.resolve({ backendName: "proxy" });
      };
      inner.logout = function () {
        signOut("?logged_out=1");
        return null;
      };
      return inner;
    });
    return true;
  }

  /* -- a session that ends while the CMS is open ----------------------------- */

  /**
   * Watch the two endpoints that carry a session, and nothing else.
   *
   * A 401 from either means the session ended after the page loaded. Left
   * alone, Decap reports "No Entries" and an API error, which reads as a broken
   * CMS rather than as "you have been signed out".
   *
   * Deliberately narrow. Wrapping every request would put this in the path of
   * media, config and anything a future page fetches, for no benefit: those do
   * not carry a session and cannot answer 401 for this reason.
   */
  var WATCHED = ["/api/cms", "/api/bulk"];

  /*
    THE MOST A REQUEST MAY CARRY.

    A synchronous function receives at most 6 MB. Decap puts every new upload
    into the persistEntry request base64-encoded, so one photograph near the
    per-file limit is fine and three are not — and the failure arrives as
    "TypeError: Failed to fetch", which tells an editor nothing and names no
    file.

    5 MB leaves headroom under the platform limit. Checked here because this is
    where the request already passes through, and because a per-file limit
    cannot see a total.
  */
  var MAX_REQUEST_BYTES = 5 * 1024 * 1024;

  function tooLarge(bytes) {
    var mb = function (n) { return (n / 1024 / 1024).toFixed(1); };
    return new Error(
      "This is too large to save in one go (" + mb(bytes) + " MB).\n\n" +
      "Images are sent with the record, so a few large photographs add up. " +
      "Remove or replace the largest one and save again — anything up to about " +
      mb(MAX_REQUEST_BYTES) + " MB in total will go through.\n\n" +
      "Nothing has been saved.");
  }

  function watchForExpiry() {
    var real = window.fetch;
    if (typeof real !== "function") return;

    window.fetch = function (input, init) {
      /*
        REFUSED BEFORE IT IS SENT. Letting an oversized request go produces a
        network failure with no message worth reading; this produces a sentence
        naming the problem, and Decap shows it where the editor is looking.
      */
      var body = init && init.body;
      if (typeof body === "string" && body.length > MAX_REQUEST_BYTES) {
        var target = typeof input === "string" ? input : (input && input.url) || "";
        var to;
        try { to = new URL(target, window.location.origin).pathname; } catch (err) { to = ""; }
        if (WATCHED.some(function (prefix) { return to.indexOf(prefix) === 0; })) {
          return Promise.reject(tooLarge(body.length));
        }
      }

      var result = real.apply(this, arguments);
      var raw = typeof input === "string" ? input : (input && input.url) || "";
      var path;
      try {
        path = new URL(raw, window.location.origin).pathname;
      } catch (err) {
        return result;
      }
      var ours = WATCHED.some(function (prefix) { return path.indexOf(prefix) === 0; });
      if (!ours || !result || typeof result.then !== "function") return result;

      return result.then(function (response) {
        if (response && response.status === 401) signOut("?expired=1");
        return response;
      });
    };
  }

  /* -- the account panel ----------------------------------------------------- */

  /*
    ADDITIVE, LIKE THE BULK MANAGE LINK.

    Decap gives the account control an accessible name — "Account options
    dropdown" — which is part of its interface rather than a generated class, so
    it is what these anchor on. Everything here appends; if a future release
    renames any of it the email simply does not appear and the CMS is unchanged.
  */
  var EMAIL_ID = "fed-account-email";

  function showEmail(user) {
    if (document.getElementById(EMAIL_ID)) return true;
    var button = document.querySelector('[aria-label="Account options dropdown"]');
    if (!button || !button.parentElement) return false;

    var label = document.createElement("span");
    label.id = EMAIL_ID;
    label.className = EMAIL_ID;
    label.textContent = user.email || "";
    label.title = "Account options";
    // Clicking the address opens the same menu the avatar does.
    label.addEventListener("click", function () { button.click(); });
    button.parentElement.insertBefore(label, button);
    return true;
  }

  /** The email, the role, and a way back to the site, inside the open menu. */
  function fillMenu(user, role) {
    var menu = document.querySelector('[role="menu"]');
    if (!menu || menu.querySelector(".fed-account-head")) return;
    var list = menu.querySelector("ul") || menu;
    var first = list.firstChild;

    var head = document.createElement("div");
    head.className = "fed-account-head";
    var who = document.createElement("div");
    who.className = "fed-account-who";
    who.textContent = user.email || "";
    head.appendChild(who);
    if (role) {
      var what = document.createElement("div");
      what.className = "fed-account-role";
      what.textContent = ROLES[role];
      head.appendChild(what);
    }
    list.insertBefore(head, first);

    var site = document.createElement("a");
    site.className = "fed-account-item";
    site.setAttribute("role", "menuitem");
    site.href = "/";
    site.textContent = "View website";
    list.insertBefore(site, first);
  }

  /* -- start ----------------------------------------------------------------- */

  function reveal() {
    var cover = document.getElementById("fed-gate");
    if (cover && cover.parentElement) cover.parentElement.removeChild(cover);
  }

  function boot(user, role) {
    useOwnBackend();
    watchForExpiry();

    if (typeof window.initCMS === "function") window.initCMS();
    reveal();

    /*
      Decap draws its header after initialising, and redraws it on some route
      changes, so the label is placed when it appears and put back if it goes.
      The observer is cheap and stops nothing else; it is the same shape as
      bulk-link.js.
    */
    var observer = new MutationObserver(function () {
      try {
        showEmail(user);
        fillMenu(user, role);
      } catch (err) {
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    showEmail(user);
  }

  if (!api) {
    /*
      No Identity client means no way to tell who this is. Showing a CMS that
      cannot be used is worse than showing the sign-in page.
    */
    leave();
    return;
  }

  api.getUser().then(function (user) {
    if (!user) return leave();
    var role = roleOf(user);
    if (!role) {
      /*
        Signed in, but not invited to this. Ending the session is deliberate:
        leaving a useless one in place sends them round the same loop with no
        idea why, and /staff-login/ explains it.
      */
      return signOut("?unauthorised=1");
    }
    return boot(user, role);
  }).catch(function () {
    leave();
  });

  // Read by the browser tests.
  window.fedSession = {
    login: LOGIN,
    watched: WATCHED.slice(),
    email: function () {
      var el = document.getElementById(EMAIL_ID);
      return el ? el.textContent : null;
    },
  };
})();
