#!/usr/bin/env node
/**
 * cms-server.js — the local CMS web server.
 *
 * Serves two trees from one origin, deliberately:
 *
 *   /admin/…   from .cms/admin/   the CMS runtime, which no public build touches
 *   anything else from dist/      the generated site, for previewing links
 *
 * ONE ORIGIN MATTERS. Decap resolves its lazily-loaded chunks relative to the
 * page, and the proxy's CORS allow-list is origin-based, so splitting these
 * across two ports would trade one class of failure for another.
 *
 * dist/ may be absent or mid-rebuild at any moment — a public build can run
 * while the CMS is open, which is the whole point of the separation. A missing
 * dist/ therefore produces a plain, readable message rather than an exception:
 * the admin keeps working regardless.
 *
 * Node rather than `python -m http.server` because this needs three things that
 * a generic static server cannot give: two roots on one origin, no-store headers
 * on the CMS config (see below), and a readable message when dist/ is missing.
 *
 * Bound to 127.0.0.1: the admin can write to the repository through the proxy,
 * and none of that should be reachable from the local network.
 *
 * Run:  node scripts/cms-server.js       (usually via npm run cms:dev)
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const bulk = require("./bulk/api.js");

const ROOT = path.join(__dirname, "..");
const CMS_ROOT = path.join(ROOT, ".cms");
const SITE_ROOT = path.join(ROOT, "dist");
const PORT = Number(process.env.CMS_SITE_PORT || 8001);
const HOST = "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ "Content-Length": Buffer.byteLength(body) }, headers));
  res.end(body);
}

/** Resolve a URL path inside a root, refusing anything that escapes it. */
function resolveWithin(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const target = path.join(root, decoded);
  const normalised = path.normalize(target);
  if (!normalised.startsWith(root)) return null;      // ../ traversal
  return normalised;
}

const server = http.createServer((req, res) => {
  // WHATWG URL rather than the legacy url.parse, which Node now deprecates.
  const pathname = new URL(req.url, `http://${HOST}:${PORT}`).pathname || "/";

  /*
    BULK MANAGE (Phase 17C.5B).

    Served from this origin rather than from the Decap proxy, for two reasons.
    The proxy is a third-party package this repository must not modify, and
    same-origin means the admin page talks to it with no CORS surface at all.

    It handles four POST routes and nothing else; every other path falls
    through to the static file serving below, unchanged.
  */
  if (bulk.handles(pathname)) {
    bulk.handle(req, res, pathname).catch((err) => {
      console.error("  bulk api failed:", err && err.stack ? err.stack : err);
      if (!res.headersSent) send(res, 500, '{"error":{"code":"internal"}}',
        { "Content-Type": "application/json; charset=utf-8" });
    });
    return;
  }

  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  if (pathname === "/admin") {
    return send(res, 302, "", { Location: "/admin/" });
  }

  const root = isAdmin ? CMS_ROOT : SITE_ROOT;
  let filePath = resolveWithin(root, pathname);
  if (filePath === null) return send(res, 400, "Bad request");

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    if (isAdmin) {
      // The admin lives in .cms/, which nothing else deletes, so a miss here
      // means the CMS was never built rather than that a build removed it.
      return send(res, 404,
        "The CMS has not been built yet.\n\nRun:  npm run cms:dev\n",
        { "Content-Type": "text/plain; charset=utf-8" });
    }
    if (!fs.existsSync(SITE_ROOT)) {
      // Entirely expected: a public build may be running right now. Say so
      // plainly instead of showing a bare 404 that looks like a CMS fault.
      return send(res, 503,
        "The generated site is not built at the moment.\n\n" +
        "This does not affect the CMS — open http://localhost:" + PORT + "/admin/\n\n" +
        "To preview the public pages, run `npm run build` in another terminal.\n",
        { "Content-Type": "text/plain; charset=utf-8" });
    }
    return send(res, 404, "Not found\n", { "Content-Type": "text/plain; charset=utf-8" });
  }

  let body;
  try {
    body = fs.readFileSync(filePath);
  } catch (e) {
    // A public build can replace dist/ between the existence check and the read.
    return send(res, 503, "That file is being rebuilt. Try again in a moment.\n",
      { "Content-Type": "text/plain; charset=utf-8" });
  }

  const headers = { "Content-Type": TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream" };

  // The CMS runtime is never cached. Editing src/_data/cmsConfig.js and
  // rebuilding used to leave the browser showing the previous config.yml, which
  // wasted real debugging time in earlier phases. Development only — this server
  // does not run in production, and public caching is untouched.
  if (isAdmin) {
    headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
    headers.Pragma = "no-cache";
    headers.Expires = "0";
  }

  send(res, 200, body, headers);
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\n  Port ${PORT} is already in use.\n\n` +
      `  Something else is serving on it — most likely a CMS you already have\n` +
      `  running. Close it, or set CMS_SITE_PORT to a free port.\n`);
    process.exit(1);
  }
  console.error("  CMS server error:", e.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  if (process.env.CMS_QUIET !== "1") {
    console.log(`  CMS server listening on http://${HOST}:${PORT}`);
    console.log(`    /admin/  -> .cms/admin/   (CMS runtime)`);
    console.log(`    /        -> dist/         (generated site, may be rebuilt at any time)`);
  }
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
