/** Resolve CMS images through Decap's upload cache before the next deploy. */
(function () {
  "use strict";
  var CMS = window.CMS;
  if (!CMS || !window.h || !window.createClass) return;

  function resolve(path, field, getAsset) {
    // Decap 3.15 treats even a leading slash as an external/public URL. Its
    // upload cache uses repository paths without that slash. Only translate
    // our upload folders; other public and external images keep their URLs.
    var lookup = typeof path === "string" && /^\/assets\/(team|events|announcements|polsocs)\//.test(path)
      ? path.slice(1) : path;
    return getAsset(lookup, field);
  }
  window.fedImageAsset = resolve;

  // Keep Decap's picker, upload handling and stored value. Adapt only the
  // getAsset callback passed to its image control and preview.
  var widget = CMS.getWidget("image");
  function wrap(Component) {
    if (!Component) return Component;
    return window.createClass({
      // Decap's outer Widget delegates this check to the registered control.
      // Without it, mediaPaths and getAsset changes never reach the picker.
      shouldComponentUpdate: function () { return true; },
      render: function () {
        var props = this.props;
        return window.h(Component, Object.assign({}, props, {
          getAsset: function (path, field) { return resolve(path, field || props.field, props.getAsset); },
        }));
      },
    });
  }
  CMS.registerWidget("image", wrap(widget.control), wrap(widget.preview), widget.schema);

  // The production API lists metadata only. Decap's stock proxy turns an
  // empty content string into an empty Blob. Fetch each thumbnail on demand
  // through the authenticated API, avoiding an entire library of base64 in a
  // single function response. Local decap-server already returns real bytes.
  if (window.FED_LOCAL_CMS) return;
  var backend = CMS.getBackend("proxy");
  if (!backend || typeof backend.init !== "function") return;
  var init = backend.init;
  backend.init = function (config, options) {
    var inner = init(config, options);
    inner.getMedia = function (folder) {
      return inner.request({ action: "getMedia", params: {
        branch: inner.branch, mediaFolder: folder || inner.mediaFolder,
      } }).then(function (files) {
        return files.map(function (file) {
          var path = file.path.replace(/^\//, "");
          return { id: file.id, name: file.name, path: path, size: file.size,
            displayURL: { path: path } };
        });
      });
    };
    inner.getMediaDisplayURL = function (displayURL) {
      return inner.getMediaFile(displayURL.path).then(function (file) { return file.url; });
    };
    return inner;
  };
})();
