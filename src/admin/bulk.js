/**
 * bulk.js — the Bulk Manage screen.
 *
 * WHAT IT KNOWS
 *
 * A collection key, a record ID, the words shown to a person, a revision token
 * and an operation. It does not know that records are YAML, where they live, or
 * that this machine runs Windows. It never sends a path — the server resolves
 * one from an allow-list — so there is no request this page could be talked
 * into making that would reach a file nobody intended.
 *
 * TWO DELIBERATE UX RULES
 *
 * Changing the collection or a filter CLEARS the selection. The alternative —
 * keeping selections that scroll out of view — means an editor can hide records
 * they cannot see. One deterministic rule, stated on screen.
 *
 * Nothing is optimistic. After a successful operation the list is reloaded from
 * the server, so the statuses on screen are the statuses on disk and every
 * revision token is fresh. A screen that guessed would eventually be wrong at
 * the exact moment it mattered.
 */

(function () {
  "use strict";

  var API = {
    list: "/api/bulk/list",
    update: "/api/bulk/update",
    remove: "/api/bulk/delete",
    dependencies: "/api/bulk/dependencies",
  };

  var COLLECTIONS = [
    { key: "team", label: "Team", singular: "team member" },
    { key: "announcements", label: "Announcements", singular: "announcement" },
    { key: "standard-events", label: "Standard Events", singular: "event" },
  ];

  /* Typing the word is asked for above this many records. Below it, deleting a
     single test fixture stays a two-click job rather than a typing exercise. */
  var TYPED_CONFIRM_FROM = 5;

  var state = {
    collection: "team",
    year: "all",
    status: "all",
    records: [],
    currentYear: "",
    selected: {},                 // id -> true
    loading: false,
    message: null,                // { kind, title, detail, dependents }
  };

  var root = document.getElementById("bulk-app");

  /* -- talking to the server ------------------------------------------------ */

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (response) {
      return response.json().then(function (payload) {
        return { ok: response.ok, payload: payload };
      });
    }).catch(function () {
      /*
        The local content service is not running, or has stopped. Saying so
        beats "Failed to fetch", and the important half of the message is that
        the editor's records are untouched.
      */
      return { ok: false, payload: { message: {
        title: "The CMS cannot reach the local content service.",
        detail: "Nothing was changed. Check that `npm run cms:dev` is still " +
          "running in your terminal, then try again.",
      } } };
    });
  }

  function load() {
    state.loading = true;
    render();
    return post(API.list, { collection: state.collection }).then(function (result) {
      state.loading = false;
      if (!result.ok) {
        state.records = [];
        state.message = fail(result.payload);
      } else {
        state.records = result.payload.records || [];
        state.currentYear = result.payload.currentAcademicYear || "";
      }
      render();
    });
  }

  function fail(payload) {
    var m = (payload && payload.message) || {};
    return {
      kind: "error",
      title: m.title || "Something went wrong.",
      detail: m.detail || "Nothing was changed.",
      dependents: m.dependents || null,
    };
  }

  /* -- filtering ------------------------------------------------------------ */

  /** The records the filters currently allow through. */
  function visible() {
    return state.records.filter(function (r) {
      if (state.year !== "all" && r.academicYear !== state.year) return false;
      if (state.status === "visible" && !r.published) return false;
      if (state.status === "hidden" && r.published) return false;
      return true;
    });
  }

  function years() {
    var seen = {};
    state.records.forEach(function (r) { if (r.academicYear) seen[r.academicYear] = true; });
    return Object.keys(seen).sort().reverse();
  }

  function selectedIds() {
    return Object.keys(state.selected).filter(function (id) { return state.selected[id]; });
  }

  /** The selected records, as the server wants them: ID plus what we were shown. */
  function selectedItems() {
    var chosen = {};
    selectedIds().forEach(function (id) { chosen[id] = true; });
    return state.records
      .filter(function (r) { return chosen[r.id]; })
      .map(function (r) { return { id: r.id, rev: r.rev }; });
  }

  function clearSelection() {
    state.selected = {};
  }

  /* -- building the page ---------------------------------------------------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function field(labelText, id, options, value, onChange) {
    var wrap = el("div", "bulk-field");
    var label = el("label", null, labelText);
    label.setAttribute("for", id);
    var select = el("select");
    select.id = id;
    options.forEach(function (option) {
      var node = el("option", null, option.label);
      node.value = option.value;
      if (option.value === value) node.selected = true;
      select.appendChild(node);
    });
    select.addEventListener("change", function () { onChange(select.value); });
    wrap.appendChild(label);
    wrap.appendChild(select);
    return wrap;
  }

  function collectionLabel() {
    for (var i = 0; i < COLLECTIONS.length; i++) {
      if (COLLECTIONS[i].key === state.collection) return COLLECTIONS[i];
    }
    return COLLECTIONS[0];
  }

  function renderControls() {
    var bar = el("div", "bulk-controls");

    bar.appendChild(field("Collection", "bulk-collection",
      COLLECTIONS.map(function (c) { return { value: c.key, label: c.label }; }),
      state.collection,
      function (value) {
        state.collection = value;
        // A new collection means new records; a selection from the old one
        // would be meaningless and dangerous.
        clearSelection();
        state.year = "all";
        state.status = "all";
        state.message = null;
        load();
      }));

    var yearOptions = [{ value: "all", label: "All academic years" }]
      .concat(years().map(function (y) { return { value: y, label: y }; }));
    bar.appendChild(field("Academic year", "bulk-year", yearOptions, state.year,
      function (value) { state.year = value; clearSelection(); render(); }));

    bar.appendChild(field("Status", "bulk-status", [
      { value: "all", label: "All" },
      { value: "visible", label: "Visible on website" },
      { value: "hidden", label: "Hidden from website" },
    ], state.status, function (value) { state.status = value; clearSelection(); render(); }));

    var note = el("p", "bulk-hint",
      "Changing the collection or a filter clears your selection, so you can " +
      "never act on records you cannot see.");
    var wrap = el("div", "bulk-controls-wrap");
    wrap.appendChild(bar);
    wrap.appendChild(note);
    return wrap;
  }

  function renderRow(record) {
    var row = el("div", "bulk-row" + (state.selected[record.id] ? " bulk-row-on" : ""));

    var box = el("input");
    box.type = "checkbox";
    box.className = "bulk-check";
    box.id = "pick-" + record.id;
    box.checked = Boolean(state.selected[record.id]);
    // The accessible name is the record's own title, so a screen reader says
    // "Jane Smith, checkbox" rather than "checkbox".
    box.setAttribute("aria-label", record.title);
    box.addEventListener("change", function () {
      state.selected[record.id] = box.checked;
      if (!box.checked) delete state.selected[record.id];
      render();
    });

    var body = el("div", "bulk-row-body");
    var title = el("label", "bulk-row-title", record.title);
    title.setAttribute("for", box.id);
    body.appendChild(title);

    var meta = el("p", "bulk-row-meta");
    var bits = [];
    if (record.detail) bits.push(record.detail);
    if (record.date) bits.push(record.date);
    if (record.academicYear) bits.push(record.academicYear);
    meta.textContent = bits.join(" · ");
    body.appendChild(meta);

    /*
      Words, not a colour. "Hidden from website" is legible to somebody who
      cannot distinguish the two dots beside it, and it is the same phrase the
      buttons use, so the connection needs no explaining.
    */
    var status = el("p", "bulk-row-status " +
      (record.published ? "bulk-on" : "bulk-off"),
    record.published ? "Visible on website" : "Hidden from website");
    body.appendChild(status);

    row.appendChild(box);
    row.appendChild(body);
    return row;
  }

  function renderList() {
    var shown = visible();
    var wrap = el("div", "bulk-list-wrap");

    var head = el("div", "bulk-list-head");
    var selectAll = el("button", "bulk-btn bulk-btn-quiet", "Select all visible");
    selectAll.type = "button";
    selectAll.disabled = shown.length === 0;
    selectAll.addEventListener("click", function () {
      // Exactly what is on screen after the filters — never the whole
      // collection, and never a record the filters are hiding.
      shown.forEach(function (r) { state.selected[r.id] = true; });
      render();
    });
    head.appendChild(selectAll);

    var count = el("p", "bulk-count",
      shown.length + (shown.length === 1 ? " record" : " records") +
      (shown.length === state.records.length ? "" : " of " + state.records.length));
    head.appendChild(count);
    wrap.appendChild(head);

    if (state.loading) {
      wrap.appendChild(el("p", "bulk-note", "Loading…"));
      return wrap;
    }
    if (shown.length === 0) {
      wrap.appendChild(el("p", "bulk-note",
        state.records.length === 0
          ? "There are no records in this collection."
          : "No records match these filters."));
      return wrap;
    }

    var list = el("div", "bulk-list");
    shown.forEach(function (r) { list.appendChild(renderRow(r)); });
    wrap.appendChild(list);
    return wrap;
  }

  function renderActions() {
    var chosen = selectedIds();
    var bar = el("div", "bulk-actions");

    var count = el("p", "bulk-selected",
      chosen.length === 0 ? "Nothing selected"
        : chosen.length + " selected");
    count.setAttribute("role", "status");
    bar.appendChild(count);

    var buttons = el("div", "bulk-buttons");
    function action(label, className, run) {
      var button = el("button", "bulk-btn " + className, label);
      button.type = "button";
      button.disabled = chosen.length === 0 || state.loading;
      button.addEventListener("click", run);
      buttons.appendChild(button);
      return button;
    }

    action("Hide from website", "bulk-btn-primary", function () { runUpdate("hide"); });
    action("Show on website", "bulk-btn-primary", function () { runUpdate("show"); });
    action("Delete permanently", "bulk-btn-danger", askDelete);
    action("Clear selection", "bulk-btn-quiet", function () {
      clearSelection();
      state.message = null;
      render();
    });

    bar.appendChild(buttons);
    return bar;
  }

  function renderMessage() {
    if (!state.message) return null;
    var box = el("div", "bulk-message bulk-message-" + state.message.kind);
    box.setAttribute("role", state.message.kind === "error" ? "alert" : "status");
    box.appendChild(el("p", "bulk-message-title", state.message.title));
    if (state.message.detail) {
      box.appendChild(el("p", "bulk-message-detail", state.message.detail));
    }
    if (state.message.dependents) {
      state.message.dependents.forEach(function (blocked) {
        var group = el("div", "bulk-dependents");
        group.appendChild(el("p", "bulk-dependents-title",
          "“" + blocked.title + "” cannot be deleted because it is still used by:"));
        var list = el("ul");
        blocked.dependents.forEach(function (user) {
          var item = el("li", null, user.title);
          // One announcement can use one event twice — as the details link and
          // as the registration source. Both reasons, one row.
          item.appendChild(el("span", "bulk-dependents-why", " — " + user.ways.join(" and ")));
          list.appendChild(item);
        });
        group.appendChild(list);
        group.appendChild(el("p", "bulk-dependents-fix",
          "Change those announcements first, then try again."));
        box.appendChild(group);
      });
    }
    return box;
  }

  function render() {
    root.textContent = "";
    root.appendChild(renderControls());
    var message = renderMessage();
    if (message) root.appendChild(message);
    root.appendChild(renderList());
    root.appendChild(renderActions());
  }

  /* -- operations ----------------------------------------------------------- */

  function runUpdate(operation) {
    var items = selectedItems();
    if (!items.length) return;
    state.loading = true;
    state.message = null;
    render();

    post(API.update, {
      collection: state.collection,
      operation: operation,
      items: items,
    }).then(function (result) {
      state.loading = false;
      if (!result.ok) {
        state.message = fail(result.payload);
        render();
        return;
      }
      var n = items.length;
      state.message = {
        kind: "ok",
        title: n + (n === 1 ? " record " : " records ") +
          (operation === "hide" ? "hidden from the website." : "shown on the website."),
        detail: null,
      };
      // Reload rather than patch: the statuses and the revision tokens must
      // come from the files, not from what this screen assumed happened.
      clearSelection();
      load();
    });
  }

  function askDelete() {
    var items = selectedItems();
    if (!items.length) return;
    state.loading = true;
    render();
    // Told what blocks the deletion BEFORE reading a warning about permanence.
    post(API.dependencies, {
      collection: state.collection,
      ids: items.map(function (i) { return i.id; }),
    }).then(function (result) {
      state.loading = false;
      var blocking = (result.ok && result.payload.dependents) || [];
      if (blocking.length) {
        state.message = {
          kind: "error",
          title: "Nothing was deleted.",
          detail: null,
          dependents: blocking.map(function (b) {
            var record = recordById(b.id);
            return { title: record ? record.title : b.id, dependents: b.dependents };
          }),
        };
        render();
        return;
      }
      openConfirm(items);
    });
  }

  function recordById(id) {
    for (var i = 0; i < state.records.length; i++) {
      if (state.records[i].id === id) return state.records[i];
    }
    return null;
  }

  function openConfirm(items) {
    var n = items.length;
    var needsTyping = n >= TYPED_CONFIRM_FROM;

    var overlay = el("div", "bulk-overlay");
    var dialog = el("div", "bulk-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "bulk-dialog-title");

    var heading = el("h2", null, "Delete " + n + (n === 1 ? " item" : " items") + " permanently?");
    heading.id = "bulk-dialog-title";
    dialog.appendChild(heading);

    /*
      "cannot be undone from the admin panel" — not "gone forever". Once Phase
      17D publishes through Git the repository still holds the history, and a
      warning an editor later discovers to be an overstatement is a warning they
      stop believing.
    */
    dialog.appendChild(el("p", null,
      "This removes the records from the content manager and cannot be undone " +
      "from the admin panel. Photographs and other uploaded files are kept."));

    var list = el("ul", "bulk-dialog-list");
    items.forEach(function (item) {
      var record = recordById(item.id);
      list.appendChild(el("li", null, record ? record.title : item.id));
    });
    dialog.appendChild(list);

    var typed = null;
    if (needsTyping) {
      var wrap = el("div", "bulk-field");
      var label = el("label", null, "Type DELETE to confirm");
      label.setAttribute("for", "bulk-typed");
      typed = el("input");
      typed.id = "bulk-typed";
      typed.type = "text";
      typed.autocomplete = "off";
      wrap.appendChild(label);
      wrap.appendChild(typed);
      dialog.appendChild(wrap);
    }

    var buttons = el("div", "bulk-dialog-buttons");
    var cancel = el("button", "bulk-btn bulk-btn-quiet", "Cancel");
    cancel.type = "button";
    var confirm = el("button", "bulk-btn bulk-btn-danger",
      "Delete " + n + " permanently");
    confirm.type = "button";
    if (needsTyping) {
      confirm.disabled = true;
      typed.addEventListener("input", function () {
        confirm.disabled = typed.value.trim() !== "DELETE";
      });
    }

    function close() {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      render();
    }
    function onKey(event) {
      if (event.key === "Escape") close();
    }
    cancel.addEventListener("click", close);
    confirm.addEventListener("click", function () {
      close();
      runDelete(items);
    });

    buttons.appendChild(cancel);
    buttons.appendChild(confirm);
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
    (needsTyping ? typed : cancel).focus();
  }

  function runDelete(items) {
    state.loading = true;
    state.message = null;
    render();
    post(API.remove, { collection: state.collection, items: items })
      .then(function (result) {
        state.loading = false;
        if (!result.ok) {
          state.message = fail(result.payload);
          render();
          return;
        }
        var n = (result.payload.deleted || []).length;
        state.message = {
          kind: "ok",
          title: n + (n === 1 ? " record" : " records") + " deleted permanently.",
          detail: "Photographs and other uploaded files were kept.",
        };
        clearSelection();
        load();
      });
  }

  /* -- start ---------------------------------------------------------------- */

  load();

  // Read by the browser tests, and by anybody wondering what the screen thinks.
  window.fedBulk = {
    state: function () {
      return {
        collection: state.collection,
        year: state.year,
        status: state.status,
        total: state.records.length,
        visible: visible().length,
        selected: selectedIds(),
        message: state.message,
        loading: state.loading,
      };
    },
    visibleIds: function () { return visible().map(function (r) { return r.id; }); },
    statusOf: function (id) {
      var record = recordById(id);
      return record ? (record.published ? "visible" : "hidden") : null;
    },
    reload: load,
  };
})();
