#!/usr/bin/env node
/**
 * build-fixtures.js — build the architectural fixtures into .fixtures/, never dist/.
 *
 * A normal `npm run build` ignores src/build-test/ entirely, so no test page can
 * reach the deployment tree. The fixtures still need building for the shared-chrome
 * comparison and the archive-disclosure UI test, so this sets BUILD_FIXTURES=1 and
 * points Eleventy's output at .fixtures/ instead.
 *
 * A wrapper rather than an inline env assignment because `VAR=x cmd` is not
 * portable to Windows shells and adding cross-env for one variable is not worth a
 * dependency.
 *
 * Run:  node scripts/build-fixtures.js
 */

"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const result = spawnSync(
  process.execPath,
  [path.join(ROOT, "node_modules", "@11ty", "eleventy", "cmd.cjs")],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, BUILD_FIXTURES: "1" },
  }
);

if (result.error) {
  console.error("failed to run Eleventy for the fixture build:", result.error.message);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
