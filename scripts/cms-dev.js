#!/usr/bin/env node
/**
 * cms-dev.js — start the whole local CMS with one command.
 *
 *   npm run cms:dev
 *
 * Builds the admin into .cms/, starts the Decap file-system proxy and the CMS
 * web server, then PROVES the environment actually works before saying so. An
 * editor should never discover that the backend is broken by watching the
 * browser fail.
 *
 * Readiness means every one of these answered correctly, not that two processes
 * were spawned:
 *
 *   admin HTML, admin config, proxy API,
 *   Team / Announcements / Standard Events listings, the settings file
 *
 * If a child dies the other is stopped too, so there is never a half-running
 * environment quietly failing half its requests. Ctrl+C stops both.
 *
 * Node's own child_process rather than concurrently/npm-run-all: this needs
 * ordered readiness gating and paired shutdown, which a generic runner does not
 * provide, and it keeps the dependency list honest.
 */

"use strict";

const http = require("http");
const net = require("net");
const path = require("path");
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PROXY_PORT = Number(process.env.CMS_PROXY_PORT || 8081);
const SITE_PORT = Number(process.env.CMS_SITE_PORT || 8001);
const ADMIN_URL = `http://localhost:${SITE_PORT}/admin/`;

const children = [];
let shuttingDown = false;

/** The branch the proxy expects on every request, from the generated config. */
const BRANCH = (() => {
  try {
    return require(path.join(ROOT, "src", "_data", "cmsConfig.js")).buildConfig().backend.branch;
  } catch {
    return "feature/admin-cms";
  }
})();

/* -- helpers --------------------------------------------------------------- */

function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", (e) => resolve(e.code === "EADDRINUSE"));
    s.once("listening", () => s.close(() => resolve(false)));
    s.listen(port, "127.0.0.1");
  });
}

function get(pathname) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: SITE_PORT, path: pathname }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", (e) => resolve({ status: 0, body: e.code }));
    req.setTimeout(5000, () => { req.destroy(); resolve({ status: 0, body: "timeout" }); });
  });
}

function proxy(action, params) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ action, params });
    const req = http.request({
      host: "127.0.0.1", port: PROXY_PORT, path: "/api/v1", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* not json */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on("error", (e) => resolve({ status: 0, json: null, error: e.code }));
    req.setTimeout(5000, () => { req.destroy(); resolve({ status: 0, json: null, error: "timeout" }); });
    req.end(payload);
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, { attempts = 40, delay = 250 } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (await fn()) return true;
    await wait(delay);
  }
  return false;
}

/**
 * Kill a child AND anything it started.
 *
 * `child.kill()` alone is not enough. decap-server is launched through Node and
 * starts work of its own; on Windows a plain kill can take the process we hold a
 * handle to while leaving its descendants alive, still holding the port. That is
 * not theoretical — a supervisor exited believing it had shut down, and left a
 * server on 8001 and a content service on 8081 running for the rest of the
 * session. The next `npm run cms:dev` then failed with "port already in use" and
 * pointed at a window the editor could not find, because there wasn't one.
 *
 * taskkill /T kills the whole tree; POSIX gets the ordinary signal.
 */
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    // /T whole tree, /F force. Output suppressed: "not found" is a normal race
    // when the process has already gone, and is not worth alarming anyone with.
    try {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch { /* fall through to the ordinary kill */ }
  }
  try { if (!child.killed) child.kill(); } catch { /* already gone */ }
}

/** Has every port this session claimed actually been released? */
async function portsReleased() {
  for (const p of [PROXY_PORT, SITE_PORT]) {
    if (await portInUse(p)) return false;
  }
  return true;
}

async function stopAll(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) killTree(c);

  // Do not merely hope: confirm the ports are free before exiting, so the next
  // run starts cleanly. Bounded, because refusing to exit would be worse than
  // exiting with a warning.
  const freed = await until(portsReleased, { attempts: 20, delay: 100 });
  if (!freed) {
    console.error(
      `\n  Warning: ports ${PROXY_PORT}/${SITE_PORT} are still held after shutdown.\n` +
      "  Run `npm run cms:dev` again — it will offer to clear them.\n");
  }
  process.exit(code);
}

function fail(message, detail) {
  console.error(`\n  CMS did not start.\n\n  ${message}`);
  if (detail) console.error(`  ${detail}`);
  console.error("");
  return stopAll(1);
}

/**
 * Is a CMS already running on these ports, and is it healthy?
 *
 * "Port in use" has two very different causes and they need opposite advice.
 * Either a working CMS is already up — in which case the answer is simply the
 * URL, not an error — or something is holding the port without serving, which
 * an editor cannot diagnose and must not be asked to.
 */
async function existingCms() {
  const admin = await get("/admin/index.html");
  const info = await proxy("info", {});
  const serverOk = admin.status === 200 && /Federation Content Manager/.test(admin.body);
  const contentOk = info.status === 200 && info.json && info.json.type === "local_fs";
  if (serverOk && contentOk) return "healthy";
  if (serverOk || contentOk) return "partial";
  return "foreign";
}

/** The command that clears a stuck CMS, in this platform's own words. */
function clearCommand() {
  return process.platform === "win32"
    ? `npx kill-port ${PROXY_PORT} ${SITE_PORT}`
    : `lsof -ti:${PROXY_PORT},${SITE_PORT} | xargs kill`;
}

/* -- 1. ports -------------------------------------------------------------- */

(async function main() {
  console.log("\n  Starting the local CMS…\n");

  const busy = [];
  for (const [port, what] of [[PROXY_PORT, "content service"], [SITE_PORT, "CMS server"]]) {
    if (await portInUse(port)) busy.push({ port, what });
  }

  if (busy.length) {
    const state = await existingCms();

    if (state === "healthy" && busy.length === 2) {
      // Not an error. The editor asked for a CMS and there is one.
      console.log("  A CMS is already running, and it is working.\n");
      console.log(`  Open:  ${ADMIN_URL}\n`);
      console.log("  (If you wanted a fresh start, stop the other one with Ctrl+C first.)\n");
      return process.exit(0);
    }

    // Anything else is a half-running or foreign process. Neither is something
    // an editor should be asked to reason about, so give the exact remedy.
    return fail(
      `Port ${busy.map((b) => b.port).join(" and ")} ` +
      `${busy.length > 1 ? "are" : "is"} already in use, ` +
      `so the ${busy.map((b) => b.what).join(" and ")} cannot start.`,
      state === "partial"
        ? "A previous CMS did not shut down cleanly — part of it is still running.\n" +
          `  Clear it with:  ${clearCommand()}\n` +
          "  Then run `npm run cms:dev` again."
        : "Something else on this machine is using that port.\n" +
          `  Either stop it, or pick different ports:\n` +
          `    CMS_SITE_PORT=8002 CMS_PROXY_PORT=8082 npm run cms:dev`
    );
  }

  /* -- 2. build the admin -------------------------------------------------- */

  const build = spawnSync(process.execPath, [path.join(__dirname, "build-cms.js")],
    { cwd: ROOT, encoding: "utf8" });
  if (build.status !== 0) {
    return fail("The admin panel failed to build.",
      (build.stderr || build.stdout || "").split("\n").slice(-6).join("\n  "));
  }
  console.log("  admin built            .cms/admin/");

  /* -- 3. start the children ----------------------------------------------- */

  const proxyChild = spawn(process.execPath,
    [path.join(ROOT, "node_modules", "decap-server", "dist", "index.js")],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: String(PROXY_PORT), BIND_HOST: "127.0.0.1",
        MODE: "fs", GIT_REPO_DIRECTORY: ROOT, LOG_LEVEL: "warn" } });
  children.push(proxyChild);

  const serverChild = spawn(process.execPath, [path.join(__dirname, "cms-server.js")],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CMS_SITE_PORT: String(SITE_PORT), CMS_QUIET: "1" } });
  children.push(serverChild);

  // If either dies, the other is useless — stop the pair and say which went.
  proxyChild.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`\n  The content service stopped unexpectedly (exit ${code}).`);
    console.error("  The CMS cannot save without it, so it has been shut down.\n");
    stopAll(1);
  });
  serverChild.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`\n  The CMS server stopped unexpectedly (exit ${code}).\n`);
    stopAll(1);
  });

  const proxyErr = [];
  proxyChild.stderr.on("data", (d) => proxyErr.push(String(d)));
  serverChild.stderr.on("data", (d) => process.stderr.write(d));

  /* -- 4. readiness -------------------------------------------------------- */

  const ok = await until(async () => (await get("/admin/index.html")).status === 200);
  if (!ok) return fail("The CMS server never answered.", `Nothing responded on port ${SITE_PORT}.`);

  const proxyUp = await until(async () => (await proxy("info", {})).status === 200);
  if (!proxyUp) {
    return fail("The content service never answered.",
      proxyErr.join("").trim().split("\n").slice(-3).join("\n  ") ||
      `Nothing responded on port ${PROXY_PORT}.`);
  }

  const CHECKS = [
    ["admin HTML", async () => (await get("/admin/index.html")).status === 200],
    ["admin config", async () => {
      const r = await get("/admin/config.yml");
      return r.status === 200 && /collections:/.test(r.body);
    }],
    ["content service", async () => (await proxy("info", {})).status === 200],
    ["Team", async () => {
      const r = await proxy("entriesByFolder",
        { branch: BRANCH, folder: "content/team", extension: "yaml", depth: 1 });
      return r.status === 200 && Array.isArray(r.json) && r.json.length > 0;
    }],
    ["Announcements", async () => {
      const r = await proxy("entriesByFolder",
        { branch: BRANCH, folder: "content/announcements", extension: "yaml", depth: 1 });
      return r.status === 200 && Array.isArray(r.json) && r.json.length > 0;
    }],
    ["Standard Events", async () => {
      const r = await proxy("entriesByFolder",
        { branch: BRANCH, folder: "content/events", extension: "yaml", depth: 1 });
      return r.status === 200 && Array.isArray(r.json) && r.json.length > 0;
    }],
    ["Site settings", async () => {
      const r = await proxy("getEntry",
        { branch: BRANCH, path: "content/settings/academic-year.yaml" });
      return r.status === 200 && r.json && typeof r.json.data === "string" &&
        /current\s*:/.test(r.json.data);
    }],
  ];

  for (const [name, check] of CHECKS) {
    let passed = false;
    try { passed = await check(); } catch { passed = false; }
    if (!passed) {
      return fail(`The CMS started but "${name}" is not working, so it is not usable.`,
        "This usually means the content service cannot read the repository.");
    }
    console.log(`  ${name.padEnd(22)} ok`);
  }

  console.log("\n  CMS ready:");
  console.log(`  ${ADMIN_URL}\n`);
  console.log("  Public build commands (clean, build, validate) will NOT disturb this session.");
  console.log("  Press Ctrl+C to stop.\n");
})();

/* -- shutdown --------------------------------------------------------------- */

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    console.log("\n  Stopping the CMS…");
    stopAll(0);
  });
}

// Last resort. `exit` handlers must be synchronous, so this cannot wait for the
// ports or use the async path above — it is the backstop for an abrupt exit
// (an uncaught throw, a closed terminal), not the normal route.
process.on("exit", () => {
  if (shuttingDown) return;
  for (const c of children) killTree(c);
});

// An unexpected throw must still take the children with it, or the next run
// meets the ports this one left behind.
process.on("uncaughtException", (e) => {
  console.error(`\n  The CMS supervisor hit an unexpected error: ${e && e.message}\n`);
  stopAll(1);
});
