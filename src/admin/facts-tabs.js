/**
 * One optional disclosure with one accessible tab per fact.
 * Stores the existing array of {label, value} records, without writes on mount.
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || !window.CMS) return;
  var h = window.h, createClass = window.createClass;
  var copy = function (value) {
    value = value && value.toJS ? value.toJS() : value;
    return Array.isArray(value) ? value.map(function (item) { return Object.assign({}, item); }) : [];
  };
  var Control = createClass({
    getInitialState: function () { return { selected: 0, expanded: false, validating: false, removed: null }; },
    words: function () {
      return this.props.field.get("locale") === "pl"
        ? { title: "Krótkie informacje", optional: "Opcjonalne", item: "Informacja", add: "Dodaj informację",
            empty: "Dodaj krótką informację, np. Uczestnicy — 100 studentów.",
            label: "Nazwa", value: "Szczegół", remove: "Usuń informację", earlier: "Przesuń w lewo",
            later: "Przesuń w prawo", undo: "Cofnij usunięcie", error: "Uzupełnij nazwę i szczegół lub usuń tę informację." }
        : { title: "Quick information", optional: "Optional", item: "Fact", add: "Add information",
            empty: "Add a short fact, such as Attendance — 100 students.",
            label: "Name", value: "Detail", remove: "Remove information", earlier: "Move left",
            later: "Move right", undo: "Undo removal", error: "Enter both a name and a detail, or remove this item." };
    },
    choose: function (index, focus) {
      var self = this;
      this.setState({ selected: index }, function () {
        if (focus && self.tabRefs && self.tabRefs[index]) self.tabRefs[index].focus();
      });
    },
    change: function (index, key, value) {
      if (this.props.isDisabled) return;
      var rows = copy(this.props.value);
      rows[index][key] = value;
      this.props.onChange(rows);
    },
    add: function () {
      if (this.props.isDisabled) return;
      var rows = copy(this.props.value), self = this;
      rows.push({ label: "", value: "" });
      this.props.onChange(rows);
      this.setState({ selected: rows.length - 1, expanded: true }, function () {
        if (self.inputRefs && self.inputRefs[rows.length - 1]) self.inputRefs[rows.length - 1].focus();
      });
    },
    remove: function (index) {
      if (this.props.isDisabled) return;
      var rows = copy(this.props.value), removed = rows.splice(index, 1)[0];
      this.props.onChange(rows);
      this.setState({ removed: { item: removed, index: index } });
      this.choose(Math.max(0, Math.min(index, rows.length - 1)), true);
      if (!rows.length && this.addRef) this.addRef.focus();
    },
    undo: function () {
      if (this.props.isDisabled || !this.state.removed) return;
      var rows = copy(this.props.value), removed = this.state.removed;
      var index = Math.min(removed.index, rows.length);
      rows.splice(index, 0, removed.item);
      this.props.onChange(rows);
      this.setState({ removed: null });
      this.choose(index, true);
    },
    move: function (index, delta) {
      if (this.props.isDisabled) return;
      var rows = copy(this.props.value), target = index + delta;
      if (target < 0 || target >= rows.length) return;
      var item = rows.splice(index, 1)[0];
      rows.splice(target, 0, item);
      this.props.onChange(rows);
      this.choose(target, true);
    },
    isValid: function () {
      var rows = copy(this.props.value);
      var bad = rows.findIndex(function (row) { return !String(row.label || "").trim() || !String(row.value || "").trim(); });
      if (bad === -1) return true;
      this.setState({ validating: true, expanded: true, selected: bad });
      return { error: { message: this.words().error } };
    },
    render: function () {
      var self = this, p = this.props, w = this.words(), rows = copy(p.value);
      var selected = Math.min(this.state.selected, Math.max(0, rows.length - 1));
      var base = p.forID, disabled = Boolean(p.isDisabled);
      this.tabRefs = this.tabRefs || []; this.inputRefs = this.inputRefs || [];
      return h("details", { id: base, className: "fed-facts", open: this.state.expanded,
        onToggle: function (e) {
          if (self.state.expanded !== e.currentTarget.open) self.setState({ expanded: e.currentTarget.open });
        } },
        h("summary", null, w.title, h("span", { className: "fed-optional-label" }, w.optional),
          rows.length > 0 && h("span", { className: "fed-facts-count" }, String(rows.length))),
        h("div", { className: "fed-facts-content" },
          rows.length === 0 && h("p", { className: "fed-facts-empty" }, w.empty),
          rows.length > 0 && h("div", { role: "tablist", "aria-label": w.title, className: "fed-facts-tabs" },
            rows.map(function (row, i) {
              return h("button", { type: "button", role: "tab", key: i, id: base + "-tab-" + i,
                "aria-controls": base + "-panel-" + i, "aria-selected": selected === i,
                tabIndex: selected === i ? 0 : -1,
                ref: function (el) { self.tabRefs[i] = el; },
                onClick: function () { self.choose(i); },
                onKeyDown: function (e) {
                  var next;
                  if (e.key === "ArrowRight") next = (i + 1) % rows.length;
                  if (e.key === "ArrowLeft") next = (i + rows.length - 1) % rows.length;
                  if (e.key === "Home") next = 0;
                  if (e.key === "End") next = rows.length - 1;
                  if (next !== undefined) { e.preventDefault(); self.choose(next, true); }
                } }, String(row.label || "").trim() || w.item + " " + (i + 1));
            })),
          rows.map(function (row, i) {
            var bad = self.state.validating && (!String(row.label || "").trim() || !String(row.value || "").trim());
            return h("div", { key: i, role: "tabpanel", id: base + "-panel-" + i,
              "aria-labelledby": base + "-tab-" + i, hidden: selected !== i, className: "fed-fact-panel" },
              h("div", { className: "fed-fact-fields" }, ["label", "value"].map(function (key) {
                return h("div", { key: key },
                  h("label", { htmlFor: base + "-" + key + "-" + i }, w[key]),
                  h("input", { id: base + "-" + key + "-" + i, type: "text", value: row[key] || "",
                    disabled: disabled, "aria-required": true,
                    "aria-invalid": bad && !String(row[key] || "").trim(),
                    "aria-describedby": bad ? base + "-error-" + i : undefined,
                    ref: key === "label" ? function (el) { self.inputRefs[i] = el; } : undefined,
                    onFocus: p.setActiveStyle, onBlur: p.setInactiveStyle,
                    onChange: function (e) { self.change(i, key, e.target.value); } }));
              })),
              bad && h("p", { role: "alert", id: base + "-error-" + i, className: "fed-fact-error" }, w.error),
              h("div", { className: "fed-fact-actions" },
                h("button", { type: "button", disabled: disabled || i === 0, onClick: function () { self.move(i, -1); } }, w.earlier),
                h("button", { type: "button", disabled: disabled || i === rows.length - 1, onClick: function () { self.move(i, 1); } }, w.later),
                h("button", { type: "button", className: "fed-remove", disabled: disabled, onClick: function () { self.remove(i); } }, w.remove)));
          }),
          h("div", { className: "fed-facts-footer" },
            h("button", { type: "button", className: "fed-facts-add", disabled: disabled,
              ref: function (el) { self.addRef = el; }, onClick: this.add }, "+ " + w.add),
            this.state.removed && h("button", { type: "button", disabled: disabled, onClick: this.undo }, w.undo))));
    }
  });
  window.CMS.registerWidget("factsTabs", Control);
})();
