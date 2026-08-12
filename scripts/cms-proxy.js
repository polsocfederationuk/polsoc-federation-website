#!/usr/bin/env node
/**
 * cms-proxy.js — start Decap's local file-system proxy.
 *
 * This is what lets the admin panel read and write content/ without any remote
 * Git API, OAuth application or Netlify service. It is the whole reason this
 * phase needs no authentication.
 *
 * THREE SETTINGS ARE DELIBERATE
 * -----------------------------
 * MODE=fs        decap-server's default. It writes files into the working tree
 *                and stops there. The alternative, MODE=git, would COMMIT every
 *                save — this phase must not create git history, and a committing
 *                CMS would also make the round-trip tests unreviewable.
 *
 * BIND_HOST      127.0.0.1, so the proxy is reachable only from this machine.
 *                The proxy grants write access to the repository, and the
 *                default binding would offer that to the whole local network.
 *
 * GIT_REPO_DIRECTORY
 *                pinned to the repository root, so a stray working directory
 *                cannot point the proxy at someone else's files. decap-server
 *                also refuses any path that escapes this root.
 *
 * Run:  node scripts/cms-proxy.js       (or: npm run cms:proxy)
 * Stop: Ctrl+C
 */

"use strict";

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PORT = process.env.CMS_PROXY_PORT || "8081";

const server = path.join(ROOT, "node_modules", "decap-server", "dist", "index.js");
if (!fs.existsSync(server)) {
  console.error("decap-server is not installed. Run `npm install` first.");
  process.exit(1);
}

console.log("");
console.log("  Decap local proxy");
console.log("  -----------------");
console.log(`  repository : ${ROOT}`);
console.log(`  listening  : http://127.0.0.1:${PORT}/api/v1   (this machine only)`);
console.log("  mode       : fs — writes files, does NOT commit");
console.log("");
console.log("  In a second terminal:  npm run cms:serve");
console.log("  Then open:             http://localhost:8001/admin/");
console.log("");

const child = spawn(process.execPath, [server], {
  cwd: ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    PORT,
    BIND_HOST: "127.0.0.1",
    MODE: "fs",
    GIT_REPO_DIRECTORY: ROOT,
  },
});

child.on("exit", (code) => process.exit(code === null ? 1 : code));
process.on("SIGINT", () => child.kill("SIGINT"));
