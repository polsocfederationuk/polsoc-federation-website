/**
 * people.js — the People screen. Superadmins only, decided by the server
 * (netlify/functions/people.mjs); this page shows what it is told.
 */
(function () {
  "use strict";
  var ENDPOINT = window.FED_PEOPLE_ENDPOINT || "/api/people";
  var INVITE = window.FED_INVITE_ENDPOINT || "/api/invite";
  var statusEl = document.getElementById("people-status");
  var listEl = document.getElementById("people-list");
  var filtersEl = document.getElementById("people-filters");
  var resultEl = document.getElementById("people-result");

  var refreshEl = document.getElementById("people-refresh");
  var loading = false;

  var STATUS = {
    active: "Active", pending: "Pending", disabled: "Disabled", no_access: "No access",
  };
  var ROLE = { superadmin: "Superadmin", admin: "Administrator", editor: "Editor" };
  var FILTERS = [["all", "Everyone"], ["pending", "Pending"], ["active", "Active"], ["disabled", "Disabled"], ["no_access", "No access"]];

  var people = [];
  var filter = "all";

  function post(url, body) {
    return fetch(url, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d || {} }; });
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function when(iso) {
    if (!iso) return "Not recorded";
    var d = new Date(iso);
    if (isNaN(d)) return "Not recorded";
    return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function show(kind, title, detail) {
    resultEl.className = "people-result " + (kind === "ok" ? "is-ok" : "is-problem");
    resultEl.textContent = "";
    var t = el("p"); t.appendChild(el("strong", null, title)); resultEl.appendChild(t);
    if (detail) resultEl.appendChild(el("p", null, detail));
    resultEl.hidden = false;
  }

  function problem(r, fallback) {
    var m = (r && r.data && r.data.message) || {};
    show("problem", m.title || fallback, m.detail || "");
  }

  function drawFilters() {
    filtersEl.textContent = "";
    FILTERS.forEach(function (f) {
      var count = f[0] === "all" ? people.length : people.filter(function (p) { return p.status === f[0]; }).length;
      if (f[0] !== "all" && !count) return;
      var b = el("button", null, f[1] + " (" + count + ")");
      b.type = "button";
      b.setAttribute("aria-pressed", String(filter === f[0]));
      b.addEventListener("click", function () { filter = f[0]; draw(); });
      filtersEl.appendChild(b);
    });
    filtersEl.hidden = false;
  }

  function act(person, action, button) {
    if (action === "delete" && !window.confirm(
      "Delete " + person.email + "'s account for good?\n\nThey will not be able to sign in, and this cannot be undone. " +
      "To take access away but keep the account, use Disable instead.")) return;
    if (action === "disable" && !window.confirm("Take away " + person.email + "'s access? You can give it back later.")) return;
    button.disabled = true;
    resultEl.hidden = true;
    var request = action === "resend"
      ? post(INVITE, { email: person.email, resend: true })
      : post(ENDPOINT, { action: action, id: person.id });
    request.then(function (r) {
      if (r.status !== 200) { problem(r, "That did not work."); button.disabled = false; return; }
      if (action === "resend") {
        show("ok", "E-mail sent again to " + person.email + ".", "It is titled as a password reset — the link inside lets them choose their password.");
        button.disabled = false;
        return;
      }
      if (action === "delete") {
        people = people.filter(function (p) { return p.id !== person.id; });
        show("ok", person.email + "'s account was deleted.");
      } else {
        people = people.map(function (p) { return p.id === person.id ? r.data.person : p; });
        show("ok", action === "disable" ? person.email + " can no longer open the content manager."
          : person.email + " can open the content manager again.",
          action === "disable" ? "If they are signed in right now, saving stops working straight away." : "");
      }
      draw();
    }).catch(function () {
      show("problem", "The service could not be reached.", "Check your connection and try again.");
      button.disabled = false;
    });
  }

  function row(p) {
    var li = el("li", "person");
    var who = el("div", "person-who");
    who.appendChild(el("div", "person-email", p.email || "(no address)"));
    if (p.name) who.appendChild(el("div", "person-name", p.name));
    var meta = el("div", "person-meta");
    meta.appendChild(el("span", "badge badge-" + p.status, STATUS[p.status] || p.status));
    if (p.role) meta.appendChild(el("span", "badge badge-role", ROLE[p.role] || p.role));
    meta.appendChild(el("span", null, "Last signed in: " + when(p.lastSignInAt)));
    if (p.invitedBy) meta.appendChild(el("span", null, "Invited by " + p.invitedBy));
    if (p.status === "disabled" && p.disabledBy) meta.appendChild(el("span", null, "Disabled by " + p.disabledBy + " on " + when(p.disabledAt)));
    who.appendChild(meta);
    li.appendChild(who);

    if (p.locked) {
      li.appendChild(el("div", "person-locked", p.isYou ? "This is you" : "Superadmin — change in the Netlify dashboard"));
      return li;
    }
    var actions = el("div", "person-actions");
    function button(label, action, cls) {
      var b = el("button", cls || null, label);
      b.type = "button";
      b.addEventListener("click", function () { act(p, action, b); });
      actions.appendChild(b);
    }
    if (p.status === "pending") button("Send the e-mail again", "resend");
    if (p.status === "disabled" || p.status === "no_access") button("Give access", "enable");
    else button("Disable", "disable");
    button("Delete", "delete", "danger");
    li.appendChild(actions);
    return li;
  }

  function draw() {
    drawFilters();
    listEl.textContent = "";
    var shown = people.filter(function (p) { return filter === "all" || p.status === filter; });
    if (!shown.length) {
      listEl.appendChild(el("li", "people-empty", "Nobody here."));
    } else {
      shown.forEach(function (p) { listEl.appendChild(row(p)); });
    }
    listEl.hidden = false;
    statusEl.hidden = true;
  }

  function loadPeople() {
    if (loading) return;
    loading = true;
    refreshEl.disabled = true;
    statusEl.textContent = "Loading…";
    statusEl.hidden = false;
    return post(ENDPOINT, { action: "list" }).then(function (r) {
      if (r.status === 200 && Array.isArray(r.data.people)) {
        people = r.data.people;
        draw();
      } else {
        if (r.status === 401 || r.status === 403) {
          people = [];
          listEl.textContent = "";
          listEl.hidden = true;
          filtersEl.hidden = true;
          statusEl.textContent = r.status === 401
            ? "Your session has expired. Sign in again, then come back to this page."
            : "Only a superadmin can manage people.";
        } else if (r.status === 404) {
          statusEl.textContent = "This page works on the live site only.";
        } else {
          var m = (r.data && r.data.message) || {};
          statusEl.textContent = (m.title || "The list could not be refreshed. Try again.") + (m.detail ? " " + m.detail : "");
        }
      }
    }).catch(function () {
      statusEl.textContent = "The list could not be refreshed. Check your connection and try again.";
    }).then(function () {
      loading = false;
      refreshEl.disabled = false;
    });
  }
  refreshEl.addEventListener("click", loadPeople);
  loadPeople();

  window.fedPeople = { post: post };
})();
