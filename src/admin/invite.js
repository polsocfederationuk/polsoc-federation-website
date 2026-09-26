/**
 * invite.js — the Invite someone screen.
 *
 * Asks the server first whether this account may invite, and shows the form
 * only to a superadmin. That is a courtesy: netlify/functions/invite.mjs
 * checks the role again on every request and refuses everybody else.
 */
(function () {
  "use strict";
  var ENDPOINT = window.FED_INVITE_ENDPOINT || "/api/invite";
  var form = document.getElementById("invite-form");
  var status = document.getElementById("invite-status");
  var result = document.getElementById("invite-result");
  var email = document.getElementById("invite-email");
  var emailError = document.getElementById("invite-email-error");
  var name = document.getElementById("invite-name");
  var submit = document.getElementById("invite-submit");
  var EMAIL = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

  function post(body) {
    return fetch(ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        return { status: response.status, data: data || {} };
      });
    });
  }

  function show(kind, title, detail, action) {
    result.className = "invite-result " + (kind === "ok" ? "is-ok" : "is-problem");
    result.textContent = "";
    var t = document.createElement("p");
    var strong = document.createElement("strong");
    strong.textContent = title;
    t.appendChild(strong);
    result.appendChild(t);
    if (detail) {
      var d = document.createElement("p");
      d.textContent = detail;
      result.appendChild(d);
    }
    if (action) result.appendChild(action);
    result.hidden = false;
  }

  function resendButton(address) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "invite-secondary";
    b.textContent = "Send the e-mail again";
    b.addEventListener("click", function () {
      b.disabled = true;
      post({ email: address, resend: true }).then(function (r) {
        if (r.status === 200) {
          show("ok", "E-mail sent again to " + address + ".",
            "It is titled as a password reset. The link inside lets them choose their password.");
        } else {
          var m = r.data.message || {};
          show("problem", m.title || "The e-mail could not be sent.", m.detail || "Please try again in a minute.",
            resendButton(address));
        }
      }).catch(function () {
        show("problem", "The invite service could not be reached.", "Check your connection and try again.",
          resendButton(address));
      });
    });
    return b;
  }

  function role() {
    var picked = form.querySelector('input[name="invite-role"]:checked');
    return picked ? picked.value : "editor";
  }

  email.addEventListener("input", function () {
    emailError.hidden = true;
    email.removeAttribute("aria-invalid");
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    result.hidden = true;
    var address = email.value.trim();
    if (!EMAIL.test(address)) {
      emailError.hidden = false;
      email.setAttribute("aria-invalid", "true");
      email.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = "Sending…";
    post({ email: address, name: name.value, role: role() }).then(function (r) {
      var m = r.data.message || {};
      if (r.status === 200) {
        show("ok", "Invitation sent to " + r.data.email + ".",
          "Netlify's e-mail is titled as a password reset — let them know it is their invitation.");
        form.reset();
      } else if (r.data.error && (r.data.error.code === "exists" || r.data.error.code === "email_failed")) {
        show("problem", m.title, m.detail, resendButton(r.data.email || address.toLowerCase()));
      } else {
        show("problem", m.title || "Something went wrong.", m.detail || "Nobody was invited.");
      }
    }).catch(function () {
      show("problem", "The invite service could not be reached.", "Check your connection and try again.");
    }).then(function () {
      submit.disabled = false;
      submit.textContent = "Send invitation";
    });
  });

  // Who is this? The server answers; nothing here decides.
  post({ check: true }).then(function (r) {
    if (r.status === 200 && r.data.canInvite) {
      status.hidden = true;
      form.hidden = false;
      email.focus();
    } else if (r.status === 401) {
      status.textContent = "Your session has expired. Sign in again, then come back to this page.";
    } else if (r.status === 200) {
      status.textContent = "Only a superadmin can invite people. Ask the Federation President to invite them for you.";
    } else {
      status.textContent = "Inviting works on the live site only.";
    }
  }).catch(function () {
    status.textContent = "Inviting works on the live site only.";
  });

  window.fedInvite = { post: post };
})();
