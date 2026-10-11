"use strict";
// Exercise the installed Decap implementation, not a mock of getAsset.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ROOT = process.env.CMS_PREVIEW_TEST_ROOT || path.join(__dirname, "..");
const SOURCE = process.argv[2] || path.join(ROOT, "src/admin");
const { fromJS } = require(path.join(ROOT, "node_modules/immutable"));
function installed(file, bindings, exports) {
  const source = fs.readFileSync(path.join(ROOT, "node_modules", file), "utf8")
    .replace(/^import[\s\S]*?;\r?\n/gm, "")
    .replace(/export default /g, "").replace(/export /g, "");
  return vm.runInNewContext(source + "\n;({" + exports + "})", {
    URL, Blob, File, atob, console, Uint8Array, window: { URL }, ...bindings,
  });
}
const util = installed("decap-cms-lib-util/dist/esm/path.js", {}, "isAbsolutePath,basename");
const assets = installed("decap-cms-core/dist/esm/valueObjects/AssetProxy.js", {}, "createAssetProxy");
// Use Decap's actual path selector as well as its actual media action. The
// folder lookup is supplied directly from each field in the real site config.
const entriesSource = fs.readFileSync(path.join(ROOT, "node_modules/decap-cms-core/dist/esm/reducers/entries.js"), "utf8");
const selectorSource = entriesSource.slice(entriesSource.indexOf("export function selectMediaFilePath("), entriesSource.indexOf("export function selectMediaFilePublicPath("));
const selectMediaFilePath = vm.runInNewContext(selectorSource.replace("export ", "") + ";selectMediaFilePath", {
  ...util, join: path.posix.join,
  selectMediaFolder: (config, collection, entry, field) => field.get("media_folder").replace(/^\//, ""),
});
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS0cAAAAASUVORK5CYII=", "base64");
const requests = [];
const ProxyBackend = installed("decap-cms-backend-proxy/dist/esm/implementation.js", {
  AuthenticationPage: function () {},
  EditorialWorkflowError: Error, APIError: Error,
  blobToFileObj: (name, blob) => new File([blob], name),
  unsentRequest: { fetchWithTimeout: async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const p = body.params.path || "assets/events/test-image.png";
    return { ok: true, json: async () => body.action === "getMedia"
      ? [{ id: "png-sha", name: "test-image.png", path: "/" + p, content: "", encoding: "base64", size: png.length }]
      : { id: "png-sha", name: "test-image.png", path: "/" + p, content: png.toString("base64"), encoding: "base64" } };
  } },
}, "ProxyBackend").ProxyBackend;
const backend = { init: (config, options) => new ProxyBackend(config, options) };
let imageControl;
const win = {
  CMS: {
    getWidget: () => ({ control: function BuiltinImage() {}, preview: function BuiltinPreview() {} }),
    registerWidget: (name, control) => { imageControl = control; },
    getBackend: () => backend,
  },
  h: (type, props) => ({type, props}), createClass: x => x,
};
vm.runInNewContext(fs.readFileSync(path.join(SOURCE, "media-previews.js"), "utf8"), {window: win});
assert.equal(imageControl.shouldComponentUpdate(), true, "Decap must forward media selection and loading updates");
const instance = backend.init({backend: {proxy_url: "/api/cms"}, media_folder: "assets"});
const state = { config: {}, medias: {} };
const action = installed("decap-cms-core/dist/esm/actions/media.js", {
  ...util, ...assets, selectMediaFilePath,
  selectMediaFileByPath: () => null,
  waitForMediaLibraryToLoad: async () => {},
  getMediaFile: (state, p) => instance.getMediaFile(p),
  getMediaDisplayURL: () => { throw new Error("Unexpected media-list lookup"); },
}, "getAsset");
const tasks = [];
function dispatch(a) {
  if (typeof a === "function") {
    const result = a(dispatch, () => state);
    if (result && result.then) tasks.push(result);
    return result;
  }
  if (a.type === "ADD_ASSET") state.medias[a.payload.path] = {asset: a.payload};
  if (a.type === "LOAD_ASSET_REQUEST") state.medias[a.payload.path] = {isLoading: true};
  if (a.type === "LOAD_ASSET_SUCCESS") state.medias[a.payload.path].isLoading = false;
  if (a.type === "LOAD_ASSET_FAILURE") throw a.payload.error;
}
const config = require(path.join(ROOT, "src/_data/cmsConfig.js")).buildConfig();
(async () => {
  let checks = 0;
  for (const [name, key] of [["team", "photo"], ["standard_events", "card_image"], ["announcements", "image"]]) {
    const collection = fromJS(config.collections.find(c => c.name === name));
    const field = collection.get("fields").find(f => f.get("name") === key);
    const p = field.get("media_folder").slice(1) + "/test-image.png";
    const blob = URL.createObjectURL(new Blob([png]));
    state.medias = {[p]: {asset: assets.createAssetProxy({path: p, url: blob})}};
    const getAsset = (p, f) => dispatch(action.getAsset({collection, field: f, path: p}));
    assert.equal(String(getAsset("/" + p, field)), "/" + p, "reproduces Decap's public URL bypass before the fix");
    const image = imageControl.render.call({props: {value: "/" + p, field, getAsset}});
    assert.equal(image.props.value, "/" + p, "stored path stays unchanged");
    assert.equal(String(image.props.getAsset(image.props.value, field)), blob, "built-in image control finds upload");
    assert.equal(String(win.fedImageAsset("/" + p, field, getAsset)), blob, "custom previews find same upload");
    assert.equal(requests.length, 0, "draft image needs no deployed public file or API request");
    URL.revokeObjectURL(blob);
    checks++;
  }
  const collection = fromJS(config.collections.find(c => c.name === "standard_events"));
  const field = collection.get("fields").find(f => f.get("name") === "card_image");
  const getAsset = (p, f) => dispatch(action.getAsset({collection, field: f, path: p}));
  state.medias = {};
  win.fedImageAsset("/assets/events/test-image.png", field, getAsset);
  await Promise.all(tasks);
  const loaded = String(win.fedImageAsset("/assets/events/test-image.png", field, getAsset));
  assert.ok(loaded.startsWith("blob:"));
  assert.deepEqual(Buffer.from(await (await fetch(loaded)).arrayBuffer()), png, "saved image loads before deployment through the authenticated backend");
  URL.revokeObjectURL(loaded);
  checks++;
  const files = await instance.getMedia("assets/events");
  assert.equal(files[0].path, "assets/events/test-image.png");
  assert.equal(files[0].file, undefined, "listing does not create empty image files");
  const thumbnail = await instance.getMediaDisplayURL(files[0].displayURL);
  assert.deepEqual(Buffer.from(await (await fetch(thumbnail)).arrayBuffer()), png);
  URL.revokeObjectURL(thumbnail);
  checks++;
  for (const p of ["https://example.com/a.jpg", "/assets/pbf/crowd.jpg", "/assets/logo.svg"]) {
    assert.equal(String(win.fedImageAsset(p, field, getAsset)), p, "unrelated public URLs unchanged");
  }
  const failedPath = "assets/events/failed-image.png";
  state.medias = { [failedPath]: { error: new Error("not found") } };
  for (const p of [failedPath, "/" + failedPath]) {
    const fallback = String(win.fedImageAsset(p, field, getAsset));
    assert.equal(fallback, "/" + failedPath);
    assert.equal(new URL(fallback, "https://polsocfederation.pl/admin/").pathname, "/" + failedPath);
  }
  checks++;
  assert.ok(requests.every(r => r.action === "getMedia" || r.action === "getMediaFile"));
  console.log("Decap media loading: " + checks + " scenarios passed (cached upload, saved image, file library)");
})().catch(e => { console.error(e); process.exitCode = 1; });
