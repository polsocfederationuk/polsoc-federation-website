/** CMS controls surround a sandboxed page rendered by the real frontend. */
(function () {
  "use strict";
  if (!window.CMS || !window.FED_FRONTEND_PREVIEW) return;
  var h = window.h, createClass = window.createClass, runtime = window.FED_FRONTEND_PREVIEW;
  function plain(value) { return value && value.toJS ? value.toJS() : value; }
  function setting(field, name) { return field && (field.get ? field.get(name) : field[name]); }
  // Keep the original field objects: Decap uses their identity and media_folder
  // to find the in-memory upload (for example assets/team, rather than assets).
  function resolveImages(fields, data, getAsset) {
    if (!fields || !data || !getAsset) return data;
    var resolved = Object.assign({}, data);
    function visit(field, value) {
      if (setting(field, "widget") === "image" && typeof value === "string" && value) {
        var asset = getAsset(value, field);
        return asset ? String(asset) : null;
      } else if (Array.isArray(value)) {
        return value.map(function (item) {
          var child = setting(field, "field");
          return child ? visit(child, item) : resolveImages(setting(field, "fields"), item, getAsset);
        });
      } else if (value && typeof value === "object") {
        return resolveImages(setting(field, "fields"), value, getAsset);
      }
      return value;
    }
    fields.forEach(function (field) {
      var name = setting(field, "name");
      if (Object.prototype.hasOwnProperty.call(data, name)) resolved[name] = visit(field, data[name]);
    });
    return resolved;
  }
  var Preview = function (name) { return createClass({
    getInitialState: function () {
      this.previewImages = Object.create(null);
      return { lang: "en", width: "fit", detail: true, related: null, warning: "",
        imageRevision: 0,
        draft: plain(this.props.entry && this.props.entry.get("data")) || {} };
    },
    previewAsset: function (path, field) {
      var asset = window.fedImageAsset(path, field, this.props.getAsset);
      var url = asset ? String(asset) : "";
      if (!/^blob:/.test(url)) return url;
      // The sandboxed srcdoc has an opaque origin and cannot reliably read
      // its parent's Blob URLs. Embed a copy for this preview only; neither
      // the sandbox permissions nor the entry's saved paths need to change.
      var cached = this.previewImages[url];
      if (cached) return cached.data || null;
      cached = this.previewImages[url] = {};
      var self = this;
      fetch(url).then(function (response) { return response.blob(); }).then(function (blob) {
        // The proxy deserializes files without a MIME type.
        var ext = String(path).split(/[?#]/)[0].split(".").pop().toLowerCase();
        var mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml" }[ext];
        if (!blob.type && mime) blob = blob.slice(0, blob.size, mime);
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result); };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }).then(function (data) {
        cached.data = data;
        if (self.alive) self.setState(function (state) { return { imageRevision: state.imageRevision + 1 }; });
      }).catch(function () {
        if (self.alive) self.setState({ warning: "An image could not be loaded for this preview. Try selecting it again." });
      });
      return null;
    },
    componentDidMount: function () {
      var self = this;
      this.alive = true;
      this.scrollY = 0;
      this.onScroll = function (event) {
        if (self.frame && event.source === self.frame.contentWindow && event.data &&
            event.data.type === "fed-preview-scroll" && Number.isFinite(event.data.y)) self.scrollY = event.data.y;
      };
      this.messageWindow = this.props.window || window;
      this.messageWindow.addEventListener("message", this.onScroll);
      var collection = name === "team" ? "team" : name === "announcements" ? "announcements" : null;
      var requested = collection ? [collection] : [];
      if (name === "announcements") requested.push("standard_events");
      if (!this.props.getCollection || !requested.length) return;
      Promise.all(requested.map(function (key) {
        return self.props.getCollection(key).then(function (entries) {
          return { key: key === "standard_events" ? "events" : key,
            values: entries.map(function (entry) { return plain(entry.get("data")); }) };
        });
      })).then(function (results) {
        if (!self.alive) return;
        var records = Object.assign({}, runtime.records);
        results.forEach(function (r) { records[r.key] = plain(r.values); });
        self.setState({ related: records });
      }).catch(function () {
        if (self.alive) self.setState({ warning: "Related records could not be refreshed. This preview uses the last CMS build for other records." });
      });
    },
    componentDidUpdate: function (previous) {
      var before = previous.entry && previous.entry.get("data");
      var after = this.props.entry && this.props.entry.get("data");
      if (before === after) return;
      clearTimeout(this.draftTimer);
      var self = this;
      this.draftTimer = setTimeout(function () { self.setState({ draft: plain(after) || {} }); }, 300);
    },
    componentWillUnmount: function () {
      clearTimeout(this.draftTimer);
      this.alive = false;
      if (this.messageWindow) this.messageWindow.removeEventListener("message", this.onScroll);
    },
    render: function () {
      var self = this, props = this.props, data = this.state.draft;
      var html = "", error = "";
      try {
        // Resolve a copy of the draft before rendering, including images drawn
        // later by the announcement scripts. The entry's stored paths stay intact.
        var previewData = resolveImages(props.fields || setting(props.collection, "fields"), data,
          function (path, field) { return self.previewAsset(path, field); });
        html = runtime.render(name, previewData, { lang: this.state.lang, records: this.state.related || runtime.records,
          origin: window.location.origin, detail: this.state.detail, scrollY: this.scrollY,
          originalSlug: props.entry && props.entry.get("slug") });
      } catch (e) { error = "Preview could not render this draft: " + (e.message || e); }
      return h("div", { className: "fed-preview-shell" },
        h("div", { className: "fed-preview-controls" },
          h("div", { role: "group", "aria-label": "Preview language" }, ["en", "pl"].map(function (lang) {
            return h("button", { key: lang, type: "button", "aria-pressed": self.state.lang === lang,
              onClick: function () { self.scrollY = 0; self.setState({ lang: lang }); } }, lang === "en" ? "English" : "Polski");
          })),
          h("div", { role: "group", "aria-label": "Preview width" }, [["fit","Fit pane"],["desktop","Desktop"],["phone","Phone"]].map(function (choice) {
            return h("button", { key: choice[0], type: "button", "aria-pressed": self.state.width === choice[0],
              onClick: function () { self.setState({ width: choice[0] }); } }, choice[1]);
          })),
          name === "announcements" && h("button", { type: "button", "aria-pressed": this.state.detail,
            onClick: function () { self.scrollY = 0; self.setState({ detail: !self.state.detail }); } }, this.state.detail ? "Post view" : "Page view")),
        data.published !== true && h("p", { className: "fed-preview-note" }, "Hidden on website. Shown here so you can review your draft."),
        this.state.warning && h("p", { role: "status", className: "fed-preview-note" }, this.state.warning),
        error ? h("p", { role: "alert", className: "fed-preview-error" }, error) :
          h("div", { className: "fed-preview-scroll" },
            h("iframe", { title: "Website preview — " + (this.state.lang === "en" ? "English" : "Polski"),
              sandbox: "allow-scripts", referrerPolicy: "no-referrer", srcDoc: html,
              ref: function (el) { self.frame = el; },
              className: "fed-website-frame is-" + this.state.width })));
    }
  }); };
  window.CMS.registerPreviewStyle(window.FED_CONTENT_PREVIEW_CSS || "", { raw: true });
  ["team", "standard_events", "announcements"].forEach(function (name) {
    window.CMS.registerPreviewTemplate(name, Preview(name));
  });
})();
