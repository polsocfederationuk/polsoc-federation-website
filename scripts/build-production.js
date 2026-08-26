#!/usr/bin/env node
/**
 * build-production.js — the public site WITH the content manager.
 *
 * The only build that produces dist/admin/. Netlify runs this; nothing local
 * does unless somebody asks for it explicitly.
 *
 * WHY A SCRIPT AND NOT AN ENVIRONMENT VARIABLE IN netlify.toml
 *
 * Because the mode has to be checked as well as set. A production admin that
 * still pointed at http://localhost:8001 would be a CMS that silently does
 * nothing online, and the failure would look like a Netlify problem rather than
 * a build one. This sets the flag, runs Eleventy, and then reads the generated
 * output back to confirm what it actually contains — see verify() below.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "clean.js")],
  { cwd: ROOT, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status || 1);

/*
  The @netlify/identity bundle the staff login page loads. Rebuilt here rather
  than committed as a stale artefact: it is generated from the pinned package,
  and a production deploy should never ship a bundle older than the lockfile.
*/
const identity = spawnSync(process.execPath,
  [path.join(ROOT, "scripts", "build-identity.js")], { cwd: ROOT, stdio: "inherit" });
if (identity.status !== 0) process.exit(identity.status || 1);

const build = spawnSync(
  process.execPath,
  [path.join(ROOT, "node_modules", "@11ty", "eleventy", "cmd.cjs")],
  { cwd: ROOT, stdio: "inherit", env: { ...process.env, CMS_TARGET: "production" } }
);
if (build.status !== 0) process.exit(build.status || 1);

/**
 * What must be true of a production build, checked against the real output.
 *
 * These are not style preferences. A local endpoint in the deployed admin means
 * an editor's Publish quietly fails; a secret in a generated file means it is
 * public. Both are cheap to check here and expensive to discover later.
 */
function verify() {
  const problems = [];

  const admin = path.join(DIST, "admin", "index.html");
  const config = path.join(DIST, "admin", "config.yml");
  if (!fs.existsSync(admin)) problems.push("dist/admin/index.html was not produced");
  if (!fs.existsSync(config)) problems.push("dist/admin/config.yml was not produced");
  if (!fs.existsSync(path.join(DIST, "staff-login", "index.html"))) {
    problems.push("dist/staff-login/index.html was not produced");
  }

  /*
    THE PRODUCTION ADMIN MUST NOT TALK TO A DEVELOPER'S MACHINE.

    The local backend is the same Decap backend with a different URL, so the
    only thing standing between "works online" and "does nothing online" is
    which string ended up in config.yml.
  */
  const local = [
    /localhost:\d+/i,
    /127\.0\.0\.1/,
    /*
      A Windows path in a deployed file means a developer's machine leaked in.

      Narrower than it looks, because two innocent things nearly match. A bare
      drive letter also describes CSS like `.tab:hover`, so the backslash is
      required; and a backslash after a colon also describes an escape inside
      an embedded regular expression — `https:\/\/`, `registration:\s` — so the
      letter must not be part of a longer word. What is left is a drive letter
      standing on its own, which is only ever a path.
    */
    /(?:^|[^A-Za-z])[A-Za-z]:\\/,
    /file:\/\//i,
  ];
  for (const file of ["admin/config.yml", "admin/index.html", "staff-login/index.html"]) {
    const full = path.join(DIST, file);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, "utf8");
    for (const pattern of local) {
      if (pattern.test(text)) problems.push(`${file} contains a local endpoint (${pattern})`);
    }
  }

  if (fs.existsSync(config)) {
    const text = fs.readFileSync(config, "utf8");
    if (!/proxy_url:\s*["']?\/api\/cms/.test(text)) {
      problems.push("dist/admin/config.yml does not point at /api/cms");
    }
    if (/git-gateway/.test(text)) problems.push("config.yml uses the deprecated git-gateway backend");
  }

  /*
    NO SECRET REACHES dist/. Everything under dist/ is served publicly, so a
    credential that lands here is a published credential. Checked by name and by
    shape, over every generated file.
  */
  const secretNames = /CMS_GITHUB_PRIVATE_KEY|CMS_GITHUB_APP_ID|CMS_GITHUB_INSTALLATION_ID|NETLIFY_AUTH_TOKEN|GITHUB_TOKEN/;
  const secretShapes = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{16,}/,           // GitHub tokens
    /\bnfp_[A-Za-z0-9]{16,}/,                 // Netlify personal tokens
  ];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) { walk(full); continue; }
      if (!/\.(html|js|json|yml|yaml|css|txt|xml|map|webmanifest)$/i.test(name)) continue;
      const text = fs.readFileSync(full, "utf8");
      const where = path.relative(DIST, full);
      if (secretNames.test(text)) problems.push(`${where} names a secret environment variable`);
      for (const shape of secretShapes) {
        if (shape.test(text)) problems.push(`${where} contains something shaped like a credential`);
      }
    }
  };
  if (fs.existsSync(DIST)) walk(DIST);

  return problems;
}

const problems = verify();
if (problems.length) {
  console.error("\n  PRODUCTION BUILD REFUSED\n  " + "-".repeat(24));
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error("");
  process.exit(1);
}

console.log("\n  production build complete: dist/ contains the site, /admin/ and /staff-login/");
