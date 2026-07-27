#!/usr/bin/env node
/**
 * Removes the generated output directory.
 *
 * Uses Node's own fs.rm rather than `rm -rf` or `rmdir /s` so it behaves
 * identically on Windows, macOS and Linux — the committee develops on Windows.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const dist = path.resolve(__dirname, "..", "dist");

if (!fs.existsSync(dist)) {
  console.log("clean: dist/ does not exist, nothing to remove");
  process.exit(0);
}

fs.rmSync(dist, { recursive: true, force: true });
console.log("clean: removed " + dist);
