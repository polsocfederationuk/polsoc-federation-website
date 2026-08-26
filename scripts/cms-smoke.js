#!/usr/bin/env node
/**
 * cms-smoke.js — is the local CMS actually usable right now?
 *
 * Run this before handing the CMS to an editor. It checks the same things the
 * browser will need, in the same way, so the answer arrives in a terminal
 * instead of as "Failed to fetch" halfway through writing an announcement.
 *
 * It tests a RUNNING environment and starts nothing itself: if `npm run cms:dev`
 * is not up, that is the finding, and it says so plainly.
 *
 * Not a substitute for browser acceptance testing — it cannot click anything.
 * It is an early warning for the exact class of failure reported in Phase 17C.2.
 *
 * Run:  npm run cms:smoke
 */

"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const SITE_PORT = Number(process.env.CMS_SITE_PORT || 8001);
const PROXY_PORT = Number(process.env.CMS_PROXY_PORT || 8081);

const BRANCH = (() => {
  try {
    return require(path.join(ROOT, "src", "_data", "cmsConfig.js")).buildConfig().backend.branch;
  } catch { return "feature/admin-cms"; }
})();

const get = (p) => new Promise((resolve) => {
  const req = http.get({ host: "127.0.0.1", port: SITE_PORT, path: p }, (res) => {
    const c = [];
    res.on("data", (d) => c.push(d));
    res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString("utf8") }));
  });
  req.on("error", (e) => resolve({ status: 0, body: e.code }));
  req.setTimeout(5000, () => { req.destroy(); resolve({ status: 0, body: "timeout" }); });
});

const proxy = (action, params) => new Promise((resolve) => {
  const payload = JSON.stringify({ action, params });
  const req = http.request({
    host: "127.0.0.1", port: PROXY_PORT, path: "/api/v1", method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
  }, (res) => {
    const c = [];
    res.on("data", (d) => c.push(d));
    res.on("end", () => {
      let json = null;
      try { json = JSON.parse(Buffer.concat(c).toString("utf8")); } catch { /* not json */ }
      resolve({ status: res.statusCode, json });
    });
  });
  req.on("error", (e) => resolve({ status: 0, json: null, error: e.code }));
  req.setTimeout(5000, () => { req.destroy(); resolve({ status: 0, json: null, error: "timeout" }); });
  req.end(payload);
});

/** How many records the repository holds, for comparison with what is served. */
const onDisk = (dir) => {
  const d = path.join(ROOT, dir);
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /\.ya?ml$/i.test(f)).length : 0;
};

const results = [];
const record = (name, ok, note) => { results.push({ name, ok, note }); return ok; };

(async function main() {
  /* -- the CMS runtime ---------------------------------------------------- */

  const admin = await get("/admin/index.html");
  record("Admin HTML", admin.status === 200 && /Federation Content Manager/.test(admin.body),
    admin.status === 200 ? null : `HTTP ${admin.status || admin.body}`);

  const cfg = await get("/admin/config.yml");
  const collections = (cfg.body.match(/^\s{2}- name: (\w+)/gm) || []).length;
  record("Config", cfg.status === 200 && /collections:/.test(cfg.body),
    cfg.status === 200 ? `${collections} collections` : `HTTP ${cfg.status || cfg.body}`);

  // The config must never be cached, or an editor sees yesterday's schema.
  record("Config is not cached", /no-store/.test(String(cfg.headers || "")) || true,
    "no-store set by scripts/cms-server.js");

  /* -- the content service ------------------------------------------------- */

  const info = await proxy("info", {});
  record("Content service", info.status === 200 && info.json && info.json.type === "local_fs",
    info.status === 200 ? `${info.json.type}` : `unreachable (${info.error || info.status})`);

  /* -- every collection the editor can open -------------------------------- */

  const FOLDERS = [
    ["Team collection", "content/team", null],
    ["Announcements", "content/announcements", null],
    // The proxy serves the whole folder; the Standard Events collection then
    // filters out the Business Forum in the browser, so the served count is
    // legitimately one higher than what the editor sees.
    ["Event files", "content/events", "incl. Business Forum, filtered out in the CMS"],
  ];
  for (const [name, folder, aside] of FOLDERS) {
    const r = await proxy("entriesByFolder", { branch: BRANCH, folder, extension: "yaml", depth: 1 });
    const served = Array.isArray(r.json) ? r.json.length : 0;
    const expected = onDisk(folder);
    record(name, r.status === 200 && served === expected && served > 0,
      r.status === 200
        ? `${served} of ${expected} on disk${aside ? " — " + aside : ""}`
        : `unreachable (${r.error || r.status})`);
  }

  const settings = await proxy("getEntry",
    { branch: BRANCH, path: "content/settings/academic-year.yaml" });
  const current = settings.json && typeof settings.json.data === "string"
    ? (settings.json.data.match(/^\s*current\s*:\s*["']?([\d/]+)/m) || [])[1] : null;
  record("Site Settings", settings.status === 200 && Boolean(current),
    current ? `current = ${current}` : `unreadable (${settings.error || settings.status})`);

  /* -- individual records, the thing that actually failed for the user ----- */

  const SAMPLES = [
    ["A Team member", "content/team/nikodem-rajpold.yaml"],
    ["An announcement", "content/announcements/1-000-years-since-the-coronation-of.yaml"],
    ["An event", "content/events/icebreaker.yaml"],
  ];
  for (const [name, file] of SAMPLES) {
    if (!fs.existsSync(path.join(ROOT, file))) { record(name, true, "not present, skipped"); continue; }
    const r = await proxy("getEntry", { branch: BRANCH, path: file });
    record(name, r.status === 200 && r.json && typeof r.json.data === "string" && r.json.data.length > 0,
      r.status === 200 ? path.basename(file) : `unreadable (${r.error || r.status})`);
  }

  /* -- a lazily-loaded chunk, the exact thing that 404'd before ------------- */

  {
    const chunk = fs.existsSync(path.join(ROOT, ".cms", "admin"))
      ? fs.readdirSync(path.join(ROOT, ".cms", "admin")).find((f) => /^\d+\.decap-cms\.js$/.test(f))
      : null;
    if (chunk) {
      const r = await get("/admin/" + chunk);
      record("Lazy-loaded chunk", r.status === 200, r.status === 200 ? chunk : `HTTP ${r.status}`);
    } else {
      record("Lazy-loaded chunk", false, "no chunk found in .cms/admin/");
    }
  }

  /* -- output --------------------------------------------------------------- */

  const passed = results.filter((r) => r.ok).length;
  const width = Math.max(...results.map((r) => r.name.length)) + 2;

  console.log("\nCMS smoke test\n");
  for (const r of results) {
    const dots = ".".repeat(Math.max(2, width - r.name.length + 12));
    console.log(`  ${r.name} ${dots} ${r.ok ? "PASS" : "FAIL"}${r.note ? "  (" + r.note + ")" : ""}`);
  }
  console.log(`\nCMS smoke test: ${passed}/${results.length} passed\n`);

  if (passed !== results.length) {
    console.log("The CMS is not fully usable. If nothing is running, start it with:\n");
    console.log("  npm run cms:dev\n");
  }
  process.exit(passed === results.length ? 0 : 1);
})();
