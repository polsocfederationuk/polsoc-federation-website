#!/usr/bin/env node
/**
 * build-cms.js — build the site WITH the local admin panel into dist/.
 *
 * A normal `npm run build` ignores src/admin/ entirely, so dist/ never contains
 * an admin page. This sets CMS_DEV=1, which is the only thing that makes
 * eleventy.config.js emit dist/admin/index.html + dist/admin/config.yml and
 * copy the pinned Decap bundle beside them.
 *
 * The output is development tooling. dist/ is gitignored, and the admin panel
 * it contains is configured against a local file-system proxy with no
 * authentication — it must never be deployed. See docs/CMS_FOUNDATION.md §2.
 *
 * A wrapper rather than an inline env assignment because `VAR=x cmd` is not
 * portable to Windows shells, matching scripts/build-fixtures.js.
 *
 * Run:  node scripts/build-cms.js
 */

"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

// Clean first. Eleventy writes into dist/ without emptying it, so going from a
// CMS build back to a normal one would otherwise leave dist/admin/ behind — a
// stale admin panel sitting in what looks like a production tree. The dist
// audits do catch it, but a build that cannot create the situation is better
// than one that reports it afterwards.
spawnSync(process.execPath, [path.join(__dirname, "clean.js")], {
  cwd: ROOT,
  stdio: "inherit",
});

const result = spawnSync(
  process.execPath,
  [path.join(ROOT, "node_modules", "@11ty", "eleventy", "cmd.cjs")],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, CMS_DEV: "1" },
  }
);

if (result.error) {
  console.error("failed to run Eleventy for the CMS build:", result.error.message);
  process.exit(1);
}
if (result.status === 0) {
  console.log("\n  built WITH the local admin panel at dist/admin/");
  console.log("  start the proxy in another terminal:  npm run cms:proxy");
}
process.exit(result.status === null ? 1 : result.status);
