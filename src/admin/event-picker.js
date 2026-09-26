/**
 * event-picker.js — choose a Federation event from a list you can read.
 *
 * Replaces two different dropdowns that asked the same question: the
 * announcement's "details" link (a fixed list written when the CMS was built)
 * and its registration source (Decap's relation dropdown). Both now show the
 * same list: each event on its own row with its date and its state, newest
 * first, with a search box when there are more than a handful.
 *
 * WHAT IS STORED: the event's slug, a plain string — exactly what both old
 * controls stored. No content file changes.
 *
 * WHERE THE LIST COMES FROM
 *
 *   1. window.FED_EVENT_CHOICES, read from content/events/ when the admin page
 *      was built. Drawn immediately, and the only source for event families
 *      that have no Decap collection of their own (the Business Forum).
 *   2. Decap's own `query` prop — the documented call the relation widget
 *      makes — for the field's `collection`. Records saved since the admin
 *      page was built replace or join the list without a rebuild.
 *
 * FIELD OPTIONS
 *
 *   collection         Decap collection read live, e.g. "standard_events".
 *   families           Event families offered, e.g. ["standard"]. Omit for all.
 *   published_only     true: hide events not shown on the website (a link to
 *                      one would lead nowhere).
 *   show_registration  true: each row says whether sign-ups are open.
 *   initial_count      Rows shown before "Show all". Default 5.
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || !window.CMS) return;
  var h = window.h, createClass = window.createClass;
  if (!h || !createClass) return;

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var REG_TEXT = {
    open: "Sign-ups open", coming_soon: "Sign-ups coming soon",
    closed: "Sign-ups closed", none: "No sign-up",
  };

  function plain(value) { return value && typeof value.toJS === "function" ? value.toJS() : value; }

  function titleOf(data) {
    var en = data.en || {};
    var parts = [en.title_lead, en.title_fancy, en.title_tail]
      .map(function (s) { return String(s || "").trim(); })
      .filter(Boolean);
    return String(en.title || "").trim() || parts.join(" ") ||
      String(en.timeline_title || "").trim() || data.slug;
  }

  /** The shape both sources are reduced to. */
  function fromRecord(data) {
    data = data || {};
    return {
      slug: String(data.slug || ""),
      family: data.event_family || "",
      title: titleOf(data),
      start_date: data.start_date ? String(data.start_date).slice(0, 10) : "",
      academic_year: data.academic_year || "",
      published: data.published === true,
      registration: ((data.registration || {}).state) || "none",
    };
  }

  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return "No date yet";
    return Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1];
  }

  function newestFirst(a, b) {
    if (a.start_date !== b.start_date) return a.start_date < b.start_date ? 1 : -1;
    return a.title.localeCompare(b.title);
  }

  var Control = createClass({
    getInitialState: function () {
      return { live: null, search: "", expanded: false };
    },

    componentDidMount: function () {
      var self = this;
      this.alive = true;
      var collection = this.props.field.get("collection");
      if (!collection || typeof this.props.query !== "function") return;
      Promise.resolve(this.props.query(this.props.forID, collection, ["slug"], ""))
        .then(function (action) {
          var hits = action && action.payload && action.payload.hits;
          if (!self.alive || !Array.isArray(hits)) return;
          self.setState({ live: hits.map(function (hit) { return fromRecord(plain(hit.data)); }) });
        })
        .catch(function () { /* The built list stays on screen. */ });
    },

    componentWillUnmount: function () { this.alive = false; },

    events: function () {
      var field = this.props.field;
      var families = plain(field.get("families"));
      var publishedOnly = field.get("published_only") === true;
      var bySlug = {};
      (window.FED_EVENT_CHOICES || []).forEach(function (e) { bySlug[e.slug] = e; });
      (this.state.live || []).forEach(function (e) { if (e.slug) bySlug[e.slug] = e; });
      return Object.keys(bySlug).map(function (k) { return bySlug[k]; })
        .filter(function (e) {
          if (Array.isArray(families) && families.indexOf(e.family) === -1) return false;
          return !publishedOnly || e.published;
        })
        .sort(newestFirst);
    },

    choose: function (slug) {
      if (this.props.isDisabled || slug === this.props.value) return;
      this.props.onChange(slug);
    },

    row: function (event, selected) {
      var self = this, props = this.props;
      var details = [formatDate(event.start_date)];
      if (!event.published) details.push("Hidden on website");
      else if (props.field.get("show_registration") === true) details.push(REG_TEXT[event.registration] || "");
      return h("label", {
        key: event.slug,
        className: "fed-choice-card fed-event-row has-description" + (selected ? " is-selected" : ""),
      },
        h("input", {
          type: "radio", name: props.forID, value: event.slug, checked: selected,
          disabled: Boolean(props.isDisabled),
          onFocus: props.setActiveStyle, onBlur: props.setInactiveStyle,
          onChange: function () { self.choose(event.slug); },
        }),
        h("span", { className: "fed-choice-text" },
          h("span", { className: "fed-choice-label" }, event.title),
          h("span", { className: "fed-choice-description" },
            details.filter(Boolean).map(function (d, i) {
              return h("span", { key: i, className: "fed-event-detail" }, d);
            }))));
    },

    render: function () {
      var self = this, props = this.props;
      var value = props.value || "";
      var all = this.events();
      var limit = Number(props.field.get("initial_count")) || 5;
      var term = this.state.search.trim().toLowerCase();

      var shown;
      if (term) {
        shown = all.filter(function (e) {
          return (e.title + " " + e.slug + " " + e.start_date + " " + formatDate(e.start_date))
            .toLowerCase().indexOf(term) !== -1;
        });
      } else if (this.state.expanded) {
        shown = all;
      } else {
        shown = all.slice(0, limit);
        var chosen = all.filter(function (e) { return e.slug === value; })[0];
        if (chosen && shown.indexOf(chosen) === -1) shown = [chosen].concat(shown.slice(0, limit - 1));
      }

      var known = all.some(function (e) { return e.slug === value; });
      var rows = shown.map(function (e) { return self.row(e, e.slug === value); });

      // A stored event that is no longer offered must still be visible, or the
      // editor would not know the record points anywhere at all.
      if (value && !known && !term) {
        rows.unshift(h("div", { key: "__missing", className: "fed-event-missing", role: "note" },
          "Currently set to \u201c" + value + "\u201d, which is not in this list — it may be hidden, " +
          "renamed or deleted. Choose an event below to replace it."));
      }

      var searchBox = all.length > limit ? h("input", {
        key: "__search", type: "search", className: "fed-event-search",
        placeholder: "Search events by name or date",
        "aria-label": "Search events",
        value: this.state.search,
        onChange: function (e) { self.setState({ search: e.target.value }); },
      }) : null;

      var footer = null;
      if (term && !shown.length) {
        footer = h("p", { className: "fed-event-empty" }, "No event matches \u201c" + this.state.search.trim() + "\u201d.");
      } else if (!term && !this.state.expanded && all.length > limit) {
        footer = h("button", {
          type: "button", className: "fed-choice-more fed-event-more",
          onClick: function () { self.setState({ expanded: true }); },
        }, "Show all " + all.length + " events");
      } else if (!all.length) {
        footer = h("p", { className: "fed-event-empty" },
          "There are no Federation events to choose from yet. Create the event first, then come back.");
      }

      return h("div", { id: props.forID, className: "fed-event-picker" },
        searchBox,
        h("div", { className: "fed-event-list", role: "radiogroup", "aria-label": props.field.get("label") }, rows),
        footer);
    },
  });

  window.CMS.registerWidget("eventPicker", Control);
  window.fedEventPicker = { fromRecord: fromRecord, formatDate: formatDate };
})();
