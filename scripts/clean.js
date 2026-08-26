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

// Both output trees: dist/ is the deployment tree, .fixtures/ holds the
// architectural fixtures that a normal build deliberately does not emit. Stale
// output in either would let a removed page survive into the next audit.
// .cms/ is DELIBERATELY not here. It holds the running local CMS, and deleting
// it from under an open editor session is precisely the bug Phase 17C.2 fixed:
// the admin used to live in dist/, so every clean/build silently broke it.
// `npm run cms:dev` manages .cms/ itself.
const TARGETS = ["dist", ".fixtures"];

let removed = 0;
for (const name of TARGETS) {
  const dir = path.resolve(__dirname, "..", name);
  if (!fs.existsSync(dir)) continue;
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("clean: removed " + dir);
  removed++;
}
if (removed === 0) console.log("clean: nothing to remove");
