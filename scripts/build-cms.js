#!/usr/bin/env node
/**
 * build-cms.js — build the local admin panel into .cms/.
 *
 * The admin is development tooling and lives in its own tree. It used to be
 * built into dist/ alongside the public site, which meant `npm run clean`,
 * `npm run build` and `npm run validate:cms` deleted the files backing a CMS an
 * editor had open — the cause of the "Failed to fetch" reports. dist/ is now the
 * public website and nothing else.
 *
 * Only .cms/ is cleared here, never dist/.
 *
 * Run:  node scripts/build-cms.js       (or: npm run build:cms)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const CMS_DIR = path.join(ROOT, ".cms");

// Eleventy writes into an existing directory without emptying it, so a removed
// admin file would otherwise linger.
fs.rmSync(CMS_DIR, { recursive: true, force: true });

const result = spawnSync(
  process.execPath,
  [path.join(ROOT, "node_modules", "@11ty", "eleventy", "cmd.cjs")],
  { cwd: ROOT, stdio: "inherit", env: { ...process.env, CMS_DEV: "1" } }
);

if (result.error) {
  console.error("failed to run Eleventy for the CMS build:", result.error.message);
  process.exit(1);
}
if (result.status === 0) {
  const admin = path.join(CMS_DIR, "admin", "index.html");
  if (!fs.existsSync(admin)) {
    console.error("the CMS build produced no .cms/admin/index.html");
    process.exit(1);
  }
  console.log("\n  admin built into .cms/admin/ (dist/ untouched)");
}
process.exit(result.status === null ? 1 : result.status);
