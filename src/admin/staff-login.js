/**
 * staff-login.js — sign in, then go to the content manager.
 *
 * Built on @netlify/identity, the library Netlify recommends for new projects.
 * It is headless: standalone async functions, no class to instantiate, no
 * `.init()`, and no UI of its own. The form on this page is ours; the
 * credentials, the tokens and the cookies are entirely the library's.
 *
 * NOT the legacy netlify-identity-widget, which this replaced. That package
 * shipped a pre-built modal and is no longer recommended; its own README now
 * says so. The visible flow is deliberately the same — a person still clicks
 * one button and signs in — but nothing about the session is hand-rolled any
 * more.
 *
 * WHAT THE LIBRARY OWNS NOW, THAT THIS FILE USED TO
 *
 *   the `nf_jwt` cookie   set by login(), cleared by logout(). The previous
 *                         implementation wrote that cookie by hand, which meant
 *                         it also had to guess the expiry.
 *   staying signed in     the library schedules a refresh a minute before the
 *                         token expires and syncs the new one to the cookie.
 *                         The hand-rolled version simply expired mid-edit.
 *   callback tokens       handleAuthCallback() recognises OAuth, invitation,
 *                         recovery, e-mail confirmation and e-mail change from
 *                         the URL, and says which it was.
 *
 * That cookie is what Netlify's edge role rule on /admin/* reads, and what the
 * CMS and Bulk manage functions authenticate against. One session, one cookie,
 * managed by the library that issued it.
 *
 * WHY THIS PAGE IS OUTSIDE THE PROTECTED PATH
 *
 * An invitation link lands here with a token in the URL, and an invited person
 * has no role yet. Behind the role gate they would meet a 401 instead of a
 * password field.
 */

(function () {
  "use strict";

  var api = window.netlifyIdentityApi;

  var form = document.getElementById("login-form");
  var email = document.getElementById("login-email");
  var password = document.getElementById("login-password");
  var submit = document.getElementById("login-submit");
  var providers = document.getElementById("login-providers");
  var forgot = document.getElementById("login-forgot");
  var problem = document.getElementById("login-problem");
  var notice = document.getElementById("login-notice");
  var heading = document.getElementById("login-lead");

  /*
    The providers Netlify Identity supports, with the wording a person reads.
    Which of them are OFFERED is decided at runtime by getSettings(); this is
    only the label for each, because the API returns identifiers.
  */
  var PROVIDERS = [
    { id: "google", label: "Google" },
    { id: "github", label: "GitHub" },
    { id: "gitlab", label: "GitLab" },
    { id: "bitbucket", label: "Bitbucket" },
    { id: "facebook", label: "Facebook" },
  ];

  /** What the form is currently for. Set by the callback handler on load. */
  var mode = "login";          // login | invite | recovery
  var inviteToken = null;

  function say(message, kind) {
    var box = kind === "notice" ? notice : problem;
    var other = kind === "notice" ? problem : notice;
    box.textContent = message;
    box.hidden = false;
    other.hidden = true;
  }

  function clearMessages() {
    problem.hidden = true;
    notice.hidden = true;
  }

  function busy(on) {
    submit.disabled = on;
    [].forEach.call(providers.querySelectorAll("button"), function (b) { b.disabled = on; });
    submit.textContent = on ? "Please wait…" : submit.getAttribute("data-label");
  }

  if (!api) {
    say("The sign-in service could not be loaded. Check your connection and " +
      "reload the page.");
    submit.disabled = true;
    return;
  }

  /**
   * Is this account allowed into the content manager?
   *
   * A courtesy, not the control. Netlify's edge rule on /admin/* and every
   * write function check the same roles server-side. This exists so somebody
   * who signs in successfully but has no role is told why, rather than bouncing
   * off a redirect with no explanation.
   *
   * It is also what makes an uninvited Google account harmless: the sign-in may
   * well succeed, and it still grants nothing.
   *
   * v2 normalises `app_metadata.roles` onto the user as `roles`, so there is no
   * metadata digging here.
   */
  function permitted(user) {
    var roles = (user && user.roles) || [];
    for (var i = 0; i < roles.length; i++) {
      var role = String(roles[i]).toLowerCase();
      if (role === "editor" || role === "admin") return true;
    }
    return false;
  }

  function admitted(user) {
    if (!permitted(user)) {
      /*
        Signed in, but not authorised. Ending the session is deliberate: leaving
        a useless one in place would send them round the /admin/ redirect loop
        with no idea why.
      */
      api.logout().catch(function () { /* the cookie is cleared regardless */ });
      say("You are signed in, but this account has not been given access to " +
        "the content manager yet. Ask the Federation President to add it.");
      form.hidden = true;
      return;
    }
    // replace(), not assign(): Back should return to the website, not to a
    // login page that will bounce straight through again.
    window.location.replace("/admin/");
  }

  /* -- what the form is for ------------------------------------------------ */

  function askForNewPassword(what) {
    mode = what;
    form.hidden = false;
    email.closest(".login-field").hidden = true;
    email.required = false;
    password.setAttribute("autocomplete", "new-password");
    password.value = "";
    heading.textContent = what === "invite" ? "Choose a password" : "Set a new password";
    submit.setAttribute("data-label",
      what === "invite" ? "Create my account" : "Save new password");
    submit.textContent = submit.getAttribute("data-label");
    providers.hidden = true;
    if (forgot) forgot.hidden = true;
    say(what === "invite"
      ? "Welcome. Choose a password to finish setting up your account."
      : "Choose a new password for your account.", "notice");
    password.focus();
  }

  /* -- arriving from an e-mail, or from a provider ------------------------- */

  /**
   * Handle anything the URL is carrying, before showing a form.
   *
   * One call covers all five: an OAuth redirect, an invitation, a password
   * recovery, an e-mail confirmation and an e-mail change. The library reads
   * the hash, exchanges the token, clears the URL and reports which it was.
   * Nothing here parses a fragment.
   */
  function handleArrival() {
    return api.handleAuthCallback().then(function (result) {
      if (!result) return null;

      if (result.type === "invite" && result.token) {
        // NOT signed in yet — an invited person sets a password first.
        inviteToken = result.token;
        askForNewPassword("invite");
        return "handled";
      }
      if (result.type === "recovery") {
        // Signed in, but the password is still the old one.
        askForNewPassword("recovery");
        return "handled";
      }
      // oauth, confirmation, email_change: signed in and finished.
      if (result.user) { admitted(result.user); return "handled"; }
      return null;
    }).catch(function (error) {
      say(readable(error, "That link did not work. It may have expired — ask " +
        "the person who invited you for a fresh one."));
      return "handled";
    });
  }

  /** An error a person can act on, never a raw message from the service. */
  function readable(error, fallback) {
    if (error && error.name === "MissingIdentityError") {
      return "Sign-in is not available on this site yet. Please tell an administrator.";
    }
    var status = error && (error.status || error.statusCode);
    if (status === 400 || status === 401) {
      return "That e-mail address and password did not match an account.";
    }
    if (status === 422) return "That password is not acceptable. Try a longer one.";
    if (status === 429) return "Too many attempts. Please wait a minute and try again.";
    return fallback;
  }

  /* -- the form ------------------------------------------------------------ */

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearMessages();
    busy(true);

    var finish = function (error) {
      busy(false);
      if (error) say(readable(error, "Sorry — that did not work. Please try again."));
    };

    if (mode === "invite") {
      api.acceptInvite(inviteToken, password.value)
        .then(admitted).catch(finish);
      return;
    }
    if (mode === "recovery") {
      /*
        The recovery callback already signed them in; this sets the password
        they will use next time. updateUser() is the documented completion of
        that flow.
      */
      api.updateUser({ password: password.value })
        .then(function (user) { admitted(user); })
        .catch(finish);
      return;
    }
    api.login(email.value.trim(), password.value).then(admitted).catch(finish);
  });

  /**
   * Offer the external providers this site actually has enabled.
   *
   * ASKED, NOT ASSUMED. getSettings() reports which providers Identity is
   * configured for; the previous version rendered a Google button whenever a
   * build-time flag was set, which could put a button on the page for a
   * provider nobody had configured. Following it led to an error page.
   *
   * Failure here is quiet on purpose: if the settings cannot be read, the
   * e-mail and password form is still on the page and still works. A login page
   * that refuses to render because an optional extra could not be listed would
   * be worse than one missing a button.
   */
  function offerProviders() {
    return api.getSettings().then(function (settings) {
      var enabled = (settings && settings.providers) || {};
      var offered = 0;
      PROVIDERS.forEach(function (provider) {
        if (!enabled[provider.id]) return;
        var button = document.createElement("button");
        button.type = "button";
        button.className = "login-button login-button-alt";
        button.textContent = "Sign in with " + provider.label;
        button.addEventListener("click", function () {
          clearMessages();
          /*
            Navigates away and does not return; the provider sends the browser
            back here, where handleAuthCallback() picks it up on the next load.

            Invite-only still applies. Signing in with a provider proves who
            somebody is, not that they were invited — permitted() and the
            server-side role checks decide that.
          */
          api.oauthLogin(provider.id);
        });
        providers.appendChild(button);
        offered++;
      });
      providers.hidden = offered === 0;
    }).catch(function () {
      providers.hidden = true;
    });
  }

  if (forgot) {
    forgot.addEventListener("click", function () {
      clearMessages();
      var address = email.value.trim();
      if (!address) {
        say("Enter your e-mail address first, then choose “Forgot password”.");
        email.focus();
        return;
      }
      api.requestPasswordRecovery(address).then(function () {
        /*
          Deliberately the same answer whether or not the address has an
          account: telling a stranger which addresses exist is a way of
          enumerating the committee.
        */
        say("If that address has an account, a reset link is on its way.", "notice");
      }).catch(function () {
        say("If that address has an account, a reset link is on its way.", "notice");
      });
    });
  }

  /* -- start --------------------------------------------------------------- */

  handleArrival().then(function (handled) {
    if (handled) return;
    /*
      No token in the URL. Restore an existing session if there is one, so
      somebody who is already signed in is not asked again — and so the
      library restarts its refresh timer.
    */
    return api.hydrateSession().then(function (user) {
      if (user) return admitted(user);
      form.hidden = false;
      // Only worth asking once we know a sign-in form is what this visit needs.
      return offerProviders();
    }).catch(function () {
      form.hidden = false;
      return offerProviders();
    });
  });

  // Read by the browser tests.
  window.fedStaffLogin = {
    library: "@netlify/identity",
    permitted: permitted,
    mode: function () { return mode; },
    api: Object.keys(api || {}),
    providers: function () {
      return [].map.call(providers.querySelectorAll("button"),
        function (b) { return b.textContent; });
    },
  };
})();
