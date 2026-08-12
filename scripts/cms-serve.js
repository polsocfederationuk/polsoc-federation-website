#!/usr/bin/env node
/**
 * cms-serve.js — build the site with the admin panel, then serve it.
 *
 * One command for the second terminal: it runs the CMS_DEV build and then
 * serves dist/ on the port this repository already uses for the generated site
 * (8001, the same as `npm run serve:dist`), so no new server or port is
 * introduced.
 *
 * Bound to 127.0.0.1 rather than 0.0.0.0. The pages themselves are harmless,
 * but /admin/ talks to a proxy with write access to the repository, and there is
 * no reason for either to be reachable from the local network.
 *
 * Run:  node scripts/cms-serve.js       (or: npm run cms:serve)
 * Stop: Ctrl+C
 */

"use strict";

const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PORT = process.env.CMS_SITE_PORT || "8001";

/* -- 1. build, with the admin panel -------------------------------------- */
const build = spawnSync(process.execPath, [path.join(__dirname, "build-cms.js")], {
  cwd: ROOT,
  stdio: "inherit",
});
if (build.status !== 0) {
  console.error("\n  the CMS build failed — not starting the server");
  process.exit(build.status === null ? 1 : build.status);
}

/* -- 2. serve dist/ ------------------------------------------------------- */
// Python's http.server is what `npm run serve:dist` already uses; reusing it
// avoids adding a Node server dependency for a job the toolchain already does.
const PY = process.platform === "win32" ? "py" : "python3";
const args = ["-m", "http.server", PORT, "--bind", "127.0.0.1", "--directory", "dist"];

console.log("");
console.log("  Generated site with admin panel");
console.log("  -------------------------------");
console.log(`  site       : http://localhost:${PORT}/`);
console.log(`  admin      : http://localhost:${PORT}/admin/`);
console.log("");
console.log("  The proxy must be running in another terminal:  npm run cms:proxy");
console.log("");

const child = spawn(PY, args, { cwd: ROOT, stdio: "inherit" });
child.on("error", (e) => {
  console.error(`could not start ${PY}: ${e.message}`);
  console.error("Serve dist/ with any static server on port " + PORT + " instead.");
  process.exit(1);
});
child.on("exit", (code) => process.exit(code === null ? 1 : code));
process.on("SIGINT", () => child.kill("SIGINT"));
