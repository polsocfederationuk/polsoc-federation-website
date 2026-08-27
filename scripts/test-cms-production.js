#!/usr/bin/env node
/**
 * test-cms-production.js — the online CMS: who may do what, and to which files.
 *
 * NOTHING HERE TOUCHES A NETWORK OR A REPOSITORY.
 *
 * Both functions take an injected transport and an injected identity fetch, so
 * every test drives a fake GitHub and a fake Netlify Identity. That is not only
 * for speed: a suite that could reach the real repository would eventually be
 * run by somebody against `main`, and the whole point of these tests is the
 * cases where a write must NOT happen.
 *
 * WHAT IS WORTH TESTING
 *
 * Not "does saving work" — Decap does the saving. The interesting questions are
 * the refusals: an editor who calls the delete endpoint by hand, a request that
 * names a path outside the content folders, an image that is a script with a
 * .png on the end, a session that has expired mid-edit. Each of those must fail
 * closed, and must leave no commit behind.
 *
 * Run:  node scripts/test-cms-production.js     (or: npm run test:cms-production)
 */

"use strict";

const path = require("path");

const paths = require("../netlify/lib/paths.js");
const media = require("../netlify/lib/media.js");
const github = require("../netlify/lib/github.js");
const rules = require("../netlify/lib/rules.js");
const authz = require("../netlify/lib/authz.js");

/*
  The functions are MODERN (v2) Netlify Functions: ES modules exporting a
  default `(request, context)` handler. This suite is CommonJS, so they are
  loaded with a dynamic import — which also proves the module format Netlify
  will use actually loads, rather than only that the file parses.
*/
let cms;
let bulk;

let checks = 0;
const problems = [];

function check(ok, what, detail) {
  checks++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}`);
  if (detail) console.log(`          ${detail}`);
  if (!ok) problems.push(what + (detail ? ` — ${detail}` : ""));
}

const section = (t) => console.log(`\n  ${t}\n  ${"-".repeat(t.length)}`);

/* -- the fakes -------------------------------------------------------------- */

const SITE = "https://polsocfederation.pl";

/** A repository that records what would have been committed. */
function fakeRepo(files) {
  const store = new Map(Object.entries(files || {}));
  const commits = [];
  return {
    commits,
    files: store,
    async head() { return "headsha"; },
    async readFile(p) {
      if (!store.has(p)) return null;
      const text = store.get(p);
      return { path: p, sha: `sha-${p}-${text.length}`, text, size: text.length };
    },
    async readBytes(p) {
      if (!store.has(p)) return null;
      const bytes = Buffer.from(store.get(p));
      return { path: p, sha: `sha-${p}`, bytes, size: bytes.length };
    },
    async listFolder(folder) {
      return [...store.keys()]
        .filter((p) => p.startsWith(`${folder}/`) && !p.slice(folder.length + 1).includes("/"))
        .map((p) => ({ path: p, name: p.split("/").pop(),
          sha: `sha-${p}-${store.get(p).length}`, size: store.get(p).length }));
    },
    async commit(changes, message, actor) {
      commits.push({ changes, message, actor });
      for (const c of changes) {
        if (c.delete) store.delete(c.path);
        else store.set(c.path, c.encoding === "base64"
          ? Buffer.from(c.content, "base64").toString("utf8") : c.content);
      }
      return { commit: `commit-${commits.length}`, changed: changes.map((c) => c.path) };
    },
  };
}

/**
 * The @netlify/identity boundary, mocked at the module's edge.
 *
 * The real `getUser()` reads the request context Netlify's v2 runtime provides
 * and then asks the Identity service. Neither exists here, and neither should:
 * a unit test that reached a real Identity service would be slow, flaky and
 * dependent on somebody's account.
 *
 * So the seam is the FUNCTION ITSELF — the handlers call `deps.getUser ||
 * getUser`, and every test supplies the first. What is being tested is what the
 * function does with an answer, which is the part this repository owns.
 */
const ACCOUNTS = {
  "editor-token": { id: "u1", email: "editor@polsocfederation.pl",
    name: "Ewa Editor", roles: ["editor"] },
  "admin-token": { id: "u2", email: "admin@polsocfederation.pl",
    name: "Ada Admin", roles: ["admin"] },
  "nobody-token": { id: "u3", email: "stranger@example.com",
    name: "A Stranger", roles: [] },
};

/** getUser() for a given session token, or for nobody. */
const identityFor = (token) => async () => ACCOUNTS[token] || null;

/**
 * A real Request, because a v2 function is handed a real Request.
 *
 * Method, headers, body and URL all come from the object under test rather
 * than from a hand-rolled `event` shape, so a mistake about how v2 parses any
 * of them shows up here instead of in production.
 */
const request = (body, extra) => new Request(
  `${SITE}${(extra || {}).path || "/api/cms"}`,
  {
    method: (extra || {}).method || "POST",
    headers: {
      "content-type": (extra || {}).contentType || "application/json",
      ...((extra || {}).origin === null ? {} : { origin: (extra || {}).origin || SITE }),
      ...((extra || {}).headers || {}),
    },
    body: (extra || {}).rawBody !== undefined
      ? (extra || {}).rawBody
      : JSON.stringify(body),
  });

const TEAM_YAML = 'slug: jane-example\nacademic_year: "2025/26"\ngroup: trustees\n' +
  "order: 1\npublished: true\n\nname: Jane Example\nphoto: /assets/team/jane.jpg\n" +
  "\nen:\n  role: President\n  title: x\npl:\n  role: Prezes\n  title: y\n";

const seedRepo = () => fakeRepo({
  "content/team/jane-example.yaml": TEAM_YAML,
  "content/settings/academic-year.yaml": 'current: "2025/26"\n',
});

/** Call a v2 handler and read its Response. */
async function call(fn, body, token, extra, repo) {
  const store = repo || seedRepo();
  const response = await fn(request(body, extra), {},
    { repo: store, getUser: identityFor(token) });
  let parsed = {};
  const text = await response.text();
  try { parsed = text ? JSON.parse(text) : {}; } catch (err) { parsed = { raw: text }; }
  return { status: response.status, body: parsed, repo: store, response };
}

console.log("\n" + "=".repeat(78));
console.log("  PRODUCTION CMS — AUTHENTICATION, AUTHORISATION, SAFETY");
console.log("=".repeat(78));

(async function run() {

  cms = await import("../netlify/functions/cms.mjs");
  bulk = await import("../netlify/functions/bulk.mjs");

  /* -- the module format ---------------------------------------------------- */

  section("0. Modern (v2) Netlify Functions");
  {
    /*
      The migration that made everything below possible. @netlify/identity's
      server-side getUser() is unsupported in a v1 Lambda-compatible handler, so
      a v1 function had to verify the session itself. These assertions are what
      stops the repository sliding back.
    */
    for (const [name, mod] of [["cms", cms], ["bulk", bulk]]) {
      check(typeof mod.default === "function",
        `${name} exports a default handler`, typeof mod.default);
      check(mod.handler === undefined,
        `${name} exports no v1 \`handler\``, mod.handler === undefined ? "none" : "PRESENT");
    }
    const fsMod = require("fs");
    const dir = path.join(__dirname, "..", "netlify", "functions");
    const files = fsMod.readdirSync(dir).sort();
    check(files.join(",") === "bulk.mjs,cms.mjs",
      "both functions are .mjs and nothing else remains", files.join(", "));
    for (const file of files) {
      const raw = fsMod.readFileSync(path.join(dir, file), "utf8");
      /*
        Comments stripped for the v1 search: these files EXPLAIN what they
        replaced, and a plain search would find the explanation and report the
        very thing it rules out.
      */
      const source = raw.replace(/\/\*[\s\S]*?\*\//g, "")
        .split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
      check(/export default async function handler/.test(raw),
        `${file} uses the v2 signature`, "export default (request, context)");
      check(!/exports\.handler|module\.exports/.test(source),
        `${file} has no CommonJS export`, "ESM only");
      check(/from "@netlify\/identity"/.test(source),
        `${file} imports the first-party identity API`, "@netlify/identity");
      check(!/statusCode|event\.headers|event\.body|event\.httpMethod/.test(source),
        `${file} carries no v1 request or response assumptions`, "Request/Response");
    }

    /*
      THE BESPOKE VERIFICATION WRAPPER IS GONE, not merely unused. Two ways of
      deciding who is signed in would be one too many.
    */
    check(!fsMod.existsSync(path.join(__dirname, "..", "netlify", "lib", "identity.js")),
      "the custom identity helper has been deleted", "removed");
    const libDir = path.join(__dirname, "..", "netlify", "lib");
    const netlifySources = fsMod.readdirSync(libDir)
      .concat(files.map((f) => path.join("..", "functions", f)))
      .map((f) => fsMod.readFileSync(path.join(libDir, f), "utf8"))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    /*
      ONE PLACE DECIDES WHO IS SIGNED IN — and that is still the rule. What
      changed is where.

      This used to forbid the Identity /user endpoint outright, on the reasoning
      that getUser() should be the only answer. That reasoning had a hole:
      getUser() takes NO ARGUMENTS. It reads ambient context, and where the
      runtime does not populate that context it returns null however valid the
      session is — so every request from a genuinely signed-in editor was
      refused 401, and this assertion is what guaranteed nobody could fix it.

      The rule is now the thing it was always trying to protect: the FUNCTIONS
      do not decide, netlify/lib/session.js does, and nothing anywhere verifies
      a token for itself.
    */
    const functionSources = files
      .map((f) => fsMod.readFileSync(path.join(libDir, "..", "functions", f), "utf8"))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    check(!/\.netlify\/identity\/user/.test(functionSources),
      "no function resolves a session for itself", "lib/session.js only");
    check(/\.netlify\/identity\/user/.test(
      fsMod.readFileSync(path.join(libDir, "session.js"), "utf8")),
    "session resolution delegates to Identity's own /user endpoint",
    "the token is never trusted locally");

    /*
      NO LOCAL VERIFICATION, ANYWHERE. A JWT decoded here would carry a `roles`
      claim, and acting on it would be acting on what the holder of an
      unverified token says about themselves. Identity is the only party that
      can answer that, which is why it is asked over the network every time.
    */
    check(!/jsonwebtoken|jose|createVerify|verify\(|atob\(|jwt\.decode/.test(netlifySources),
      "no production code verifies or decodes a session token itself",
      "Identity decides");
  }

  /* -- authentication ------------------------------------------------------ */

  section("1. Who is asking");
  {
    const anon = await call(cms.default, { action: "getEntry",
      params: { path: "content/team/jane-example.yaml" } }, null);
    check(anon.status === 401, "an unauthenticated request is refused", `${anon.status}`);
    check(/sign in again|session/i.test(anon.body.error),
      "and is told to sign in, not shown a stack trace", anon.body.error);

    const bad = await call(cms.default, { action: "getEntry",
      params: { path: "content/team/jane-example.yaml" } }, "made-up-token");
    check(bad.status === 401, "an unrecognised token is refused", `${bad.status}`);

    const stranger = await call(cms.default, { action: "getEntry",
      params: { path: "content/team/jane-example.yaml" } }, "nobody-token");
    check(stranger.status === 403,
      "a signed-in account with no role is refused", `${stranger.status}`);
    check(/not authorised/i.test(stranger.body.error),
      "…and told so plainly", stranger.body.error);

    /*
      THIS IS WHAT MAKES INVITE-ONLY MEAN SOMETHING. Somebody can sign in with a
      Google account nobody invited; without a role they get nothing.
    */
    const editor = await call(cms.default, { action: "getEntry",
      params: { path: "content/team/jane-example.yaml" } }, "editor-token");
    check(editor.status === 200 && /Jane Example/.test(editor.body.data),
      "an editor can read a record", `${editor.status}`);

    /* Roles come from the provider. A claim in the body is not a role. */
    const forged = await call(cms.default, { action: "deleteFiles",
      params: { paths: ["content/team/jane-example.yaml"] },
      roles: ["admin"], user: { email: "admin@polsocfederation.pl" } }, "editor-token");
    check(forged.status === 403,
      "roles sent in the request body are ignored", `${forged.status}`);
  }

  /* -- the session the request itself carries ------------------------------ */

  /*
    THE PRODUCTION BUG THIS SECTION EXISTS FOR.

    Every one of these calls passes `getUser: async () => null` — an ambient
    lookup that finds nothing, which is exactly what the deployed Node runtime
    does. `getUser()` takes no arguments, so it cannot see the request, and the
    nf_jwt cookie the browser faithfully sends went unread. A signed-in editor
    with a valid session got 401 on every single request, silently, and the CMS
    showed "No Entries" with a red toast.

    Section 1 above cannot catch it: it supplies a working ambient lookup, so it
    passes whether or not the cookie path exists at all. These tests fail
    against the code as it was deployed and pass against the fix.
  */
  section("1b. The nf_jwt cookie on the request");
  {
    /*
      Identity, mocked at the network boundary — the only place a token is ever
      turned into a user. The assertions below check WHERE it is asked and WHAT
      is sent, because sending a session token anywhere but this site's own
      Identity service would be a leak, not a lookup.
    */
    const KNOWN = {
      "cookie-editor": { id: "u4", email: "ewa@polsocfederation.pl",
        app_metadata: { roles: ["editor"] }, user_metadata: { full_name: "Ewa Cookie" } },
      "cookie-stranger": { id: "u5", email: "stranger@example.com",
        app_metadata: { roles: [] }, user_metadata: {} },
    };
    let asked = [];
    const identity = async (url, init) => {
      asked.push({ url: String(url),
        bearer: ((init || {}).headers || {}).Authorization || "" });
      const token = String(((init || {}).headers || {}).Authorization || "")
        .replace(/^Bearer /, "");
      const found = KNOWN[token];
      return found
        ? new Response(JSON.stringify(found), { status: 200 })
        : new Response("{}", { status: 401 });
    };

    /** A call whose ONLY credential is the cookie on the request. */
    const withCookie = async (cookie, body) => {
      asked = [];
      const store = seedRepo();
      const response = await cms.default(
        request(body || { action: "getEntry",
          params: { path: "content/team/jane-example.yaml" } },
        cookie === null ? {} : { headers: { cookie } }),
        {},
        { repo: store, getUser: async () => null, fetch: identity },
      );
      const text = await response.text();
      let parsed = {};
      try { parsed = text ? JSON.parse(text) : {}; } catch (err) { parsed = { raw: text }; }
      return { status: response.status, body: parsed };
    };

    const editor = await withCookie("nf_jwt=cookie-editor");
    check(editor.status === 200,
      "a valid nf_jwt cookie is honoured when the ambient lookup finds nothing",
      `${editor.status} (was 401 in production)`);
    check(/Jane Example/.test(editor.body.data || ""),
      "…and the record actually comes back", "content read");

    check(asked.length === 1 && /\/\.netlify\/identity\/user$/.test(asked[0].url),
      "the token is sent only to this site's own Identity endpoint", asked[0] && asked[0].url);
    check(asked[0] && asked[0].bearer === "Bearer cookie-editor",
      "…as a bearer credential, unmodified", "Authorization: Bearer …");

    /* Other cookies on the request are not session tokens. */
    const alongside = await withCookie("other=1; nf_jwt=cookie-editor; another=2");
    check(alongside.status === 200,
      "nf_jwt is found among other cookies", `${alongside.status}`);

    const none = await withCookie(null);
    check(none.status === 401, "no cookie at all is still refused", `${none.status}`);

    const empty = await withCookie("nf_jwt=");
    check(empty.status === 401, "an empty nf_jwt is refused", `${empty.status}`);

    const rejected = await withCookie("nf_jwt=expired-or-forged");
    check(rejected.status === 401,
      "a token Identity refuses is refused here too", `${rejected.status}`);

    /*
      THE ONE THAT MATTERS MOST. Authorisation comes from what Identity says,
      never from the token. A cookie holder with no role gets 403, not 200.
    */
    const stranger = await withCookie("nf_jwt=cookie-stranger");
    check(stranger.status === 403,
      "a cookie-authenticated account with no role is still refused",
      `${stranger.status}`);
    check(/not authorised/i.test(stranger.body.error || ""),
      "…and told so plainly", stranger.body.error);

    /*
      THE AMBIENT ANSWER STILL WINS where Netlify provides one, so nothing
      regresses on runtimes that populate it — and the cookie is not consulted
      at all in that case.
    */
    asked = [];
    const ambient = await cms.default(
      request({ action: "getEntry", params: { path: "content/team/jane-example.yaml" } },
        { headers: { cookie: "nf_jwt=cookie-stranger" } }),
      {},
      { repo: seedRepo(), getUser: identityFor("editor-token"), fetch: identity },
    );
    check(ambient.status === 200,
      "Netlify's own answer is preferred when the runtime provides one",
      `${ambient.status}`);
    check(asked.length === 0,
      "…and no token is sent anywhere when it does", "Identity not contacted");

    /* Bulk manage shares the helper, so it shares the fix. */
    for (const [name, fn] of [["bulk", bulk.default]]) {
      const viaCookie = await fn(
        request({ action: "list", collection: "team" },
          { path: "/api/bulk/list", headers: { cookie: "nf_jwt=cookie-editor" } }),
        {},
        { repo: seedRepo(), getUser: async () => null, fetch: identity },
      );
      check(viaCookie.status !== 401,
        `${name} honours the same cookie session`, `${viaCookie.status}`);
    }

    /* The token must not appear in anything we hand back. */
    const leaked = JSON.stringify(editor.body) + JSON.stringify(rejected.body);
    check(!/cookie-editor|expired-or-forged/.test(leaked),
      "no response echoes the session token", "nothing echoed");
  }

  /* -- where the token is allowed to go ------------------------------------ */

  /*
    A SESSION TOKEN IS A CREDENTIAL, AND ITS DESTINATION MUST NOT BE STEERABLE.

    session.js sends nf_jwt to one place: this site's own Identity service. The
    address for that comes from `env.URL`, which Netlify sets and a request
    cannot influence. The request's own origin is the fallback, for local
    development where there is no env.URL.

    The order matters and is the whole point of these checks. `request.url` is
    built from the incoming Host header, so preferring it would let a forged
    Host — or a proxy that rewrote one — name the server that receives a valid
    editor session. Reading env.URL first makes that unspellable.
  */
  section("1c. Where the session token may be sent");
  {
    const sessionLib = require(path.join(__dirname, "..", "netlify", "lib", "session.js"));
    const asRequest = (url, host) => new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(host ? { host } : {}) },
      body: "{}",
    });

    check(sessionLib.identityOrigin(asRequest(SITE + "/api/cms"),
      { URL: "https://polsocfederation.pl" }) === "https://polsocfederation.pl",
    "env.URL decides the Identity origin", "env.URL");

    /* Set, and disagreeing with the request: env.URL still wins. */
    check(sessionLib.identityOrigin(asRequest("https://attacker.example/api/cms"),
      { URL: "https://polsocfederation.pl" }) === "https://polsocfederation.pl",
    "env.URL wins over the address the request arrived on",
    "a forged host cannot redirect a token");

    /* Absent: the request's own origin, which is what local development needs. */
    check(sessionLib.identityOrigin(asRequest("http://localhost:8888/api/cms"), {})
      === "http://localhost:8888",
    "without env.URL the request origin is used", "local development");
    check(sessionLib.identityOrigin(asRequest("http://localhost:8888/api/cms"), undefined)
      === "http://localhost:8888",
    "…and an absent environment is not an error", "no env at all");

    /* Nonsense in env.URL falls back rather than throwing. */
    check(sessionLib.identityOrigin(asRequest(SITE + "/api/cms"), { URL: "not a url" })
      === SITE, "an unusable env.URL falls back to the request", "no crash");

    /*
      X-Forwarded-Host and friends are never consulted. They are attacker-
      controlled on any host that does not strip them, and nothing in session.js
      reads a header other than Cookie.
    */
    const source = require("fs").readFileSync(
      path.join(__dirname, "..", "netlify", "lib", "session.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    check(!/x-forwarded|forwarded-host|headers\.get\((?!"cookie")/i.test(source),
      "session.js reads no header but Cookie", "no forwarded input");

    /* And the token itself is never written anywhere. */
    check(!/console\.(log|error|warn|info|debug)/.test(source),
      "session.js logs nothing at all", "a token cannot leak through a log line");
  }

  /* -- authorisation ------------------------------------------------------- */

  section("2. What each role may do");
  {
    const write = (token) => call(cms.default, { action: "persistEntry", params: {
      dataFiles: [{ path: "content/team/jane-example.yaml", raw: TEAM_YAML }], assets: [] } }, token);

    const byEditor = await write("editor-token");
    check(byEditor.status === 200, "an editor may save a record", `${byEditor.status}`);
    check(byEditor.repo.commits.length === 1, "…and it produced one commit", "1 commit");

    const byAdmin = await write("admin-token");
    check(byAdmin.status === 200, "an admin may save a record", `${byAdmin.status}`);

    const editorDelete = await call(cms.default, { action: "deleteFiles",
      params: { paths: ["content/team/jane-example.yaml"] } }, "editor-token");
    check(editorDelete.status === 403, "an editor may NOT delete", `${editorDelete.status}`);
    check(editorDelete.repo.commits.length === 0,
      "and nothing was committed", `${editorDelete.repo.commits.length} commits`);
    check(/not authorised to delete/i.test(editorDelete.body.error),
      "the refusal says why", editorDelete.body.error);

    const adminDelete = await call(cms.default, { action: "deleteFiles",
      params: { paths: ["content/team/jane-example.yaml"] } }, "admin-token");
    check(adminDelete.status === 200, "an admin may delete", `${adminDelete.status}`);

    /* Site settings decide which events may be published at all. */
    const settings = 'current: "2026/27"\n';
    const editorSettings = await call(cms.default, { action: "persistEntry", params: {
      dataFiles: [{ path: "content/settings/academic-year.yaml", raw: settings }] } }, "editor-token");
    check(editorSettings.status === 403,
      "an editor may NOT change the academic year", `${editorSettings.status}`);
    check(editorSettings.repo.commits.length === 0, "and nothing was committed", "0 commits");
    check(/administrator/i.test(editorSettings.body.error),
      "the refusal names the reason", editorSettings.body.error);

    const adminSettings = await call(cms.default, { action: "persistEntry", params: {
      dataFiles: [{ path: "content/settings/academic-year.yaml", raw: settings }] } }, "admin-token");
    check(adminSettings.status === 200,
      "an admin may change the academic year", `${adminSettings.status}`);
  }

  /* -- paths --------------------------------------------------------------- */

  section("3. The browser cannot name a file");
  {
    const attacks = [
      "../../package.json", "..\\..\\package.json", "/etc/passwd",
      "C:/Windows/System32/drivers/etc/hosts", "package.json", "netlify.toml",
      "src/admin/index.njk", "scripts/validate.js", ".github/workflows/deploy.yml",
      "content/team/../../netlify.toml", "content%2fteam%2f..%2f..%2fx.yaml",
      "content/team/jane.js", "content/team/JANE.yaml", "content/team/nul.yaml",
      "assets/team/../../netlify.toml", "assets/../src/x.jpg",
    ];
    for (const target of attacks) {
      const result = await call(cms.default, { action: "persistEntry", params: {
        dataFiles: [{ path: target, raw: TEAM_YAML }] } }, "admin-token");
      const refused = result.status >= 400 && result.repo.commits.length === 0;
      check(refused, `refused as a write target: ${JSON.stringify(target)}`,
        refused ? `${result.status}` : `WROTE IT (${result.status})`);
    }

    /* Reads are allow-listed too, not only writes. */
    const read = await call(cms.default,
      { action: "getEntry", params: { path: "package.json" } }, "admin-token");
    check(read.status >= 400, "and cannot be read either", `${read.status}`);
  }

  /* -- media --------------------------------------------------------------- */

  section("4. What may be uploaded");
  {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64)]).toString("base64");
    const script = Buffer.from("<script>alert(1)</script>").toString("base64");

    const good = await call(cms.default, { action: "persistMedia", params: {
      asset: { path: "assets/team/Jane Photo.png", content: png } } }, "editor-token");
    check(good.status === 200, "an editor may upload a photograph", `${good.status}`);
    check(good.body.path === "/assets/team/jane-photo.png",
      "the filename is rebuilt into a safe one", good.body.path);

    const disguised = await call(cms.default, { action: "persistMedia", params: {
      asset: { path: "assets/team/evil.png", content: script } } }, "editor-token");
    check(disguised.status >= 400 && disguised.repo.commits.length === 0,
      "a script renamed .png is refused", `${disguised.status}`);
    check(/not the kind of image/i.test(disguised.body.error),
      "…and the reason is understandable", disguised.body.error);

    for (const [name, why] of [["evil.html", "an HTML upload"], ["evil.svg", "an SVG upload"],
      ["evil.js", "a script upload"]]) {
      const result = await call(cms.default, { action: "persistMedia", params: {
        asset: { path: `assets/team/${name}`, content: png } } }, "editor-token");
      check(result.status >= 400 && result.repo.commits.length === 0,
        `${why} is refused`, `${result.status}`);
    }

    const huge = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(9 * 1024 * 1024)]).toString("base64");
    const big = await call(cms.default, { action: "persistMedia", params: {
      asset: { path: "assets/team/huge.png", content: huge } } }, "editor-token");
    check(big.status >= 400 && /too large/i.test(big.body.error),
      "an oversized image is refused, in plain words", big.body.error);

    const outside = await call(cms.default, { action: "persistMedia", params: {
      asset: { path: "src/admin/evil.png", content: png } } }, "admin-token");
    check(outside.status >= 400 && outside.repo.commits.length === 0,
      "media cannot be written outside the asset folders", `${outside.status}`);
  }

  /* -- content rules ------------------------------------------------------- */

  section("5. Rules the browser cannot skip");
  {
    const futureEvent = 'slug: gala\nevent_family: standard\nacademic_year: "2026/27"\n' +
      "published: true\nen:\n  summary: s\n  title_lead: Winter Gala\npl:\n  summary: s\n";
    const future = await call(cms.default, { action: "persistEntry", params: {
      dataFiles: [{ path: "content/events/gala.yaml", raw: futureEvent }] } }, "admin-token");
    check(future.status >= 400 && future.repo.commits.length === 0,
      "a future-year event cannot be published, even by an admin", `${future.status}`);
    check(/2026\/27/.test(future.body.error) && /2025\/26/.test(future.body.error),
      "and both years are named", future.body.error);

    const mismatch = await call(cms.default, { action: "persistEntry", params: {
      dataFiles: [{ path: "content/team/someone-else.yaml", raw: TEAM_YAML }] } }, "editor-token");
    check(mismatch.status >= 400 && mismatch.repo.commits.length === 0,
      "a record whose ID disagrees with its filename is refused", mismatch.body.error);

    const unsafe = 'slug: a\nacademic_year: "2025/26"\npublished: true\n' +
      'registration:\n  state: open\n  url: "javascript:alert(1)"\n' +
      "en:\n  title: t\npl:\n  title: t\n";
    const link = await call(cms.default, { action: "persistEntry", params: {
      dataFiles: [{ path: "content/announcements/a.yaml", raw: unsafe }] } }, "editor-token");
    check(link.status >= 400 && link.repo.commits.length === 0,
      "an unsafe registration URL is refused", link.body.error);

    const revived = 'slug: e\nevent_family: standard\nacademic_year: "2025/26"\n' +
      "published: false\nsections: []\nen:\n  summary: s\npl:\n  summary: s\n";
    const old = await call(cms.default, { action: "persistEntry", params: {
      dataFiles: [{ path: "content/events/e.yaml", raw: revived }] } }, "admin-token");
    check(old.status >= 400, "the retired section architecture cannot come back", old.body.error);

    /*
      THE RULES MUST ACCEPT THE CONTENT THAT ACTUALLY EXISTS.

      Every check above uses a synthetic fixture, and a fixture is written to
      match whatever the rule says. That is how an invented requirement got in:
      the rule demanded `en.summary`, the fixtures had one, and all four real
      events — which use hero_summary/card_summary overrides instead — would
      have been refused on the first save through the production CMS.

      So the last word goes to the repository. If an editor cannot re-save a
      record that is already published, the rule is wrong, not the record.
    */
    const fsMod = require("fs");
    for (const [dir, folder] of [["content/team", "content/team"],
      ["content/announcements", "content/announcements"],
      ["content/events", "content/events"]]) {
      const files = fsMod.readdirSync(path.join(__dirname, "..", dir))
        .filter((f) => /.ya?ml$/i.test(f));
      const refused = [];
      let considered = 0;
      for (const file of files) {
        const raw = fsMod.readFileSync(path.join(__dirname, "..", dir, file), "utf8");
        if (folder === "content/events" && !/event_family:\s*standard/.test(raw)) continue;
        considered++;
        const problem = rules.check(`${folder}/${file}`, raw, folder);
        if (problem) refused.push(`${file}: ${problem}`);
      }
      check(refused.length === 0,
        `every real record in ${folder} can still be saved`,
        refused.length ? refused.slice(0, 2).join(" | ") : `${considered} records`);
    }

    check(rules.currentAcademicYear() === "2025/26",
      "the rules read the real current academic year", rules.currentAcademicYear());
  }

  /* -- request integrity --------------------------------------------------- */

  section("6. Cross-site requests");
  {
    const wrongOrigin = await call(cms.default, { action: "getEntry",
      params: { path: "content/team/jane-example.yaml" } }, "editor-token",
    { headers: { origin: "https://evil.example" } });
    check(wrongOrigin.status === 403,
      "a request from another site is refused even with a valid session",
      `${wrongOrigin.status}`);

    const noOrigin = await call(cms.default, { action: "getEntry",
      params: { path: "content/team/jane-example.yaml" } }, "editor-token",
    { headers: { origin: "", referer: "" } });
    check(noOrigin.status === 403,
      "a request with no origin at all is refused", `${noOrigin.status}`);

    const formPost = await call(cms.default, { action: "getEntry",
      params: { path: "content/team/jane-example.yaml" } }, "editor-token",
    { headers: { "content-type": "application/x-www-form-urlencoded" } });
    check(formPost.status === 403,
      "a simple cross-site form post cannot reach it", `${formPost.status}`);

    const viaGet = await call(cms.default, {}, "editor-token", { method: "GET", rawBody: null });
    check(viaGet.status === 405, "there is no state-changing GET", `${viaGet.status}`);
    for (const method of ["PUT", "DELETE", "PATCH", "HEAD"]) {
      const wrong = await call(cms.default, {}, "editor-token", { method, rawBody: null });
      check(wrong.status === 405, `${method} is refused`, `${wrong.status}`);
    }

    /*
      Malformed JSON, with a correct content type. v2 parses the body itself, so
      this proves the handler survives a body that is not what it claims to be.
    */
    const broken = await call(cms.default, null, "editor-token", { rawBody: "{not json" });
    check(broken.status === 400, "malformed JSON is refused", `${broken.status}`);
    check(/could not be understood/i.test(broken.body.error),
      "…in words", broken.body.error);

    const noOriginAtAll = await call(cms.default, { action: "getEntry",
      params: { path: "content/team/jane-example.yaml" } }, "editor-token",
    { origin: null });
    check(noOriginAtAll.status === 403,
      "verifyRequestOrigin refuses a request with no Origin header at all",
      `${noOriginAtAll.status}`);
  }

  /* -- what leaks ---------------------------------------------------------- */

  section("7. Nothing secret comes back");
  {
    const secrets = /BEGIN [A-Z ]*PRIVATE KEY|CMS_GITHUB_PRIVATE_KEY|ghp_|nfp_|Bearer /;
    const responses = [];
    responses.push(await call(cms.default, { action: "persistEntry", params: {
      dataFiles: [{ path: "../../package.json", raw: "x" }] } }, "admin-token"));
    responses.push(await call(cms.default, { action: "nonsense", params: {} }, "editor-token"));
    responses.push(await call(cms.default, { action: "getEntry", params: {} }, null));
    for (const r of responses) {
      const text = JSON.stringify(r.body);
      check(!secrets.test(text), "no credential appears in a failure response",
        text.slice(0, 70));
      check(!/[A-Za-z]:\\|\/home\/|\/var\/task/.test(text),
        "no filesystem path appears either", text.slice(0, 70));
    }
  }

  /* -- attribution and atomicity ------------------------------------------- */

  section("8. One commit, attributed to the person");
  {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64)]).toString("base64");
    const result = await call(cms.default, { action: "persistEntry", params: {
      dataFiles: [{ path: "content/team/jane-example.yaml", raw: TEAM_YAML }],
      assets: [{ path: "assets/team/jane.png", content: png }],
    } }, "editor-token");

    check(result.status === 200, "a record and its photograph save together", `${result.status}`);
    check(result.repo.commits.length === 1,
      "in exactly ONE commit, not one per file", `${result.repo.commits.length}`);
    const commit = result.repo.commits[0];
    check(commit.changes.length === 2, "carrying both files", `${commit.changes.length} files`);
    check(/Ewa Editor/.test(commit.message) && /Jane Example/.test(commit.message),
      "the message names the person and the record", commit.message.split("\n")[0]);
    check(/CMS-Actor: editor@polsocfederation\.pl/.test(commit.message),
      "and carries a machine-readable actor trailer", "CMS-Actor present");
    check(commit.actor && commit.actor.email === "editor@polsocfederation.pl",
      "the git author is the verified account", commit.actor.email);
    check(!/PRIVATE KEY|ghp_/.test(commit.message), "and no credential", "clean");

    /* A rejected file takes the whole publish with it. */
    const mixed = await call(cms.default, { action: "persistEntry", params: {
      dataFiles: [{ path: "content/team/jane-example.yaml", raw: TEAM_YAML }],
      assets: [{ path: "assets/team/evil.png",
        content: Buffer.from("<script>").toString("base64") }],
    } }, "editor-token");
    check(mixed.status >= 400 && mixed.repo.commits.length === 0,
      "one bad image blocks the whole publish, record included", `${mixed.status}`);
  }

  /* -- bulk manage --------------------------------------------------------- */

  section("9. Bulk manage online");
  {
    const repoFor = () => fakeRepo({
      "content/team/jane-example.yaml": TEAM_YAML,
      "content/team/other-person.yaml": TEAM_YAML.replace(/jane-example/, "other-person"),
      "content/settings/academic-year.yaml": 'current: "2025/26"\n',
    });

    const listed = await call(bulk.default, { collection: "team" }, "editor-token",
      { path: "/api/bulk/list" }, repoFor());
    check(listed.status === 200 && listed.body.records.length === 2,
      "an editor can list records", `${(listed.body.records || []).length} records`);
    check(listed.body.canDelete === false,
      "and is told Delete is not theirs to offer", "canDelete false");

    const asAdmin = await call(bulk.default, { collection: "team" }, "admin-token",
      { path: "/api/bulk/list" }, repoFor());
    check(asAdmin.body.canDelete === true, "an admin is", "canDelete true");

    const rev = listed.body.records[0].rev;
    const id = listed.body.records[0].id;

    const hidden = await call(bulk.default,
      { collection: "team", operation: "hide", items: [{ id, rev }] },
      "editor-token", { path: "/api/bulk/update" }, repoFor());
    check(hidden.status === 200, "an editor may hide", `${hidden.status}`);
    check(hidden.repo.commits.length === 1, "in one commit", "1 commit");
    check(/published: false/.test(hidden.repo.files.get(`content/team/${id}.yaml`)),
      "and the record is hidden", "published: false");
    check(/Ewa Editor/.test(hidden.repo.commits[0].message),
      "attributed to the editor", hidden.repo.commits[0].message.split("\n")[0]);

    const stale = await call(bulk.default,
      { collection: "team", operation: "hide", items: [{ id, rev: "an-old-revision" }] },
      "editor-token", { path: "/api/bulk/update" }, repoFor());
    check(stale.status === 409 && stale.repo.commits.length === 0,
      "a stale revision blocks the whole operation", `${stale.status}`);
    check(/edited since this list was loaded/i.test(stale.body.message.title),
      "with the wording the local screen uses", stale.body.message.title);

    const editorDelete = await call(bulk.default,
      { collection: "team", items: [{ id, rev }] },
      "editor-token", { path: "/api/bulk/delete" }, repoFor());
    check(editorDelete.status === 403 && editorDelete.repo.commits.length === 0,
      "an editor calling delete directly is refused, and nothing is committed",
      `${editorDelete.status}`);

    const adminDelete = await call(bulk.default,
      { collection: "team", items: [{ id, rev }] },
      "admin-token", { path: "/api/bulk/delete" }, repoFor());
    check(adminDelete.status === 200 && adminDelete.repo.commits.length === 1,
      "an admin may delete", `${adminDelete.status}`);
    check(!adminDelete.repo.files.has(`content/team/${id}.yaml`), "the record is gone", "removed");

    const unknown = await call(bulk.default, { collection: "business-forum" },
      "admin-token", { path: "/api/bulk/list" }, repoFor());
    check(unknown.status >= 400, "the Business Forum is not offered online either",
      `${unknown.status}`);

    const anon = await call(bulk.default, { collection: "team" }, null,
      { path: "/api/bulk/list" }, repoFor());
    check(anon.status === 401, "and none of it works signed out", `${anon.status}`);
  }

  /* -- events, references and the future-year guard in bulk ---------------- */

  section("10. Bulk rules match the local ones");
  {
    const eventYaml = (slug, year, published) =>
      `slug: ${slug}\nevent_family: standard\nacademic_year: "${year}"\n` +
      `published: ${published}\norder: 1\nstart_date: "2025-11-01"\n` +
      "en:\n  title_lead: Test Event\n  summary: s\npl:\n  title_lead: Test\n  summary: s\n";

    const repoFor = () => fakeRepo({
      "content/events/now-event.yaml": eventYaml("now-event", "2025/26", "false"),
      "content/events/future-event.yaml": eventYaml("future-event", "2026/27", "false"),
      "content/announcements/about-it.yaml":
        'slug: about-it\nacademic_year: "2025/26"\npublished: true\n' +
        "registration:\n  source: event\n  event_slug: now-event\nlink:\n  type: none\n" +
        "en:\n  title: About it\npl:\n  title: O tym\n",
      "content/settings/academic-year.yaml": 'current: "2025/26"\n',
    });

    const base = repoFor();
    const listed = await call(bulk.default, { collection: "standard-events" }, "admin-token",
      { path: "/api/bulk/list" }, base);
    const byId = Object.fromEntries(listed.body.records.map((r) => [r.id, r.rev]));

    const show = await call(bulk.default, { collection: "standard-events", operation: "show",
      items: [{ id: "now-event", rev: byId["now-event"] },
        { id: "future-event", rev: byId["future-event"] }] },
    "admin-token", { path: "/api/bulk/update" }, repoFor());
    check(show.status === 422 && show.repo.commits.length === 0,
      "showing a future event blocks the whole selection", `${show.status}`);
    check(/2026\/27/.test(show.body.message.detail),
      "naming the year", show.body.message.detail);
    check(/published: false/.test(show.repo.files.get("content/events/now-event.yaml")),
      "the valid event in the selection stays hidden", "unchanged");

    const del = await call(bulk.default, { collection: "standard-events",
      items: [{ id: "now-event", rev: byId["now-event"] }] },
    "admin-token", { path: "/api/bulk/delete" }, repoFor());
    check(del.status === 422 && del.repo.commits.length === 0,
      "an event an announcement references cannot be deleted", `${del.status}`);
    check(JSON.stringify(del.body.message).includes("About it"),
      "the blocking announcement is named", "About it");

    /*
      The reference is a REGISTRATION source and the event has no registration
      of its own. It still counts — Phase 17C.5A.3 made that reference valid,
      and deleting the event would break it.
    */
    check(/the registration/.test(JSON.stringify(del.body.message)),
      "…and the reason is the registration reference", "registration");
  }

  /* -- the adapter itself -------------------------------------------------- */

  section("11. The GitHub adapter");
  {
    const crypto = require("crypto");
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" } });

    const seen = [];
    const transport = async (url, init) => {
      seen.push({ url, method: (init || {}).method || "GET",
        auth: ((init || {}).headers || {}).Authorization });
      if (/access_tokens$/.test(url)) {
        return { ok: true, status: 201, json: async () => ({
          token: "ghs_installationtoken", expires_at: new Date(Date.now() + 3600000).toISOString() }) };
      }
      if (/git\/ref\/heads/.test(url)) {
        return { ok: true, status: 200, json: async () => ({ object: { sha: "headsha" } }) };
      }
      if (/git\/commits\/headsha/.test(url)) {
        return { ok: true, status: 200, json: async () => ({ tree: { sha: "treesha" } }) };
      }
      if (/git\/blobs$/.test(url)) {
        return { ok: true, status: 201, json: async () => ({ sha: "blobsha" }) };
      }
      if (/git\/trees$/.test(url)) {
        return { ok: true, status: 201, json: async () => ({ sha: "newtree" }) };
      }
      if (/git\/commits$/.test(url)) {
        return { ok: true, status: 201, json: async () => ({ sha: "newcommit" }) };
      }
      if (/git\/refs\/heads/.test(url)) return { ok: true, status: 200, json: async () => ({}) };
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const built = github.fromEnvironment({
      CMS_GITHUB_APP_ID: "12345",
      CMS_GITHUB_INSTALLATION_ID: "67890",
      CMS_GITHUB_PRIVATE_KEY: privateKey,
      CMS_GITHUB_REPO: "PolsocFederationUK/website",
      CMS_GITHUB_BRANCH: "main",
    }, transport);
    check(!built.missing, "the adapter builds from environment variables",
      built.missing ? built.missing.join(", ") : "configured");

    const result = await built.repo.commit(
      [{ path: "content/team/x.yaml", content: "slug: x\n" },
        { path: "assets/team/x.png", content: "AAAA", encoding: "base64" }],
      "CMS: test", { name: "Ewa", email: "ewa@example.com" });
    check(result.commit === "newcommit", "a two-file commit succeeds", result.commit);

    const kinds = seen.map((s) => `${s.method} ${s.url.replace(/^.*\/repos\//, "")}`);
    check(kinds.filter((k) => /git\/commits$/.test(k)).length === 1,
      "producing exactly ONE commit object for both files",
      kinds.filter((k) => /git\/commits$/.test(k)).length + "");
    check(kinds.some((k) => /PATCH .*git\/refs\/heads/.test(k)),
      "and one ref update", "1 ref update");

    const appJwtCall = seen.find((s) => /access_tokens$/.test(s.url));
    check(appJwtCall && /^Bearer eyJ/.test(appJwtCall.auth),
      "the installation token is minted with a signed App JWT", "RS256 JWT");
    const laterCalls = seen.filter((s) => !/access_tokens$/.test(s.url));
    check(laterCalls.every((s) => s.auth === "Bearer ghs_installationtoken"),
      "and every repository call uses the installation token, not the key",
      `${laterCalls.length} calls`);

    /* Two editors publishing at once: the second must lose, loudly. */
    const conflictTransport = async (url, init) => {
      if (/git\/refs\/heads/.test(url) && (init || {}).method === "PATCH") {
        return { ok: false, status: 422, json: async () => ({}) };
      }
      return transport(url, init);
    };
    const conflicted = github.fromEnvironment({
      CMS_GITHUB_APP_ID: "12345", CMS_GITHUB_INSTALLATION_ID: "67890",
      CMS_GITHUB_PRIVATE_KEY: privateKey, CMS_GITHUB_REPO: "a/b",
    }, conflictTransport).repo;
    let conflictError = null;
    try {
      await conflicted.commit([{ path: "content/team/x.yaml", content: "x" }], "m",
        { name: "a", email: "a@b.c" });
    } catch (err) { conflictError = err; }
    check(conflictError && conflictError.status === 409,
      "a ref that moved under us is a conflict, not a silent overwrite",
      conflictError ? conflictError.message : "no error");
    check(conflictError && !/PRIVATE KEY|ghs_/.test(conflictError.message),
      "and the message carries no credential", "clean");

    const stale = await built.repo.commit(
      [{ path: "content/team/x.yaml", content: "x" }], "m",
      { name: "a", email: "a@b.c" }, "some-other-head").catch((e) => e);
    check(stale && stale.status === 409,
      "an expected-head mismatch is refused before anything is written", "409");

    const unconfigured = github.fromEnvironment({}, transport);
    check(unconfigured.missing && unconfigured.missing.length === 4,
      "missing configuration is reported, not guessed",
      unconfigured.missing.join(", "));
  }

  /* -- the generated production admin -------------------------------------- */

  section("12. The deployed admin talks to production");
  {
    const fs = require("fs");
    const dist = path.join(__dirname, "..", "dist");
    const config = path.join(dist, "admin", "config.yml");
    if (!fs.existsSync(config)) {
      check(true, "no production build present to inspect (run npm run build:production)",
        "skipped");
    } else {
      const text = fs.readFileSync(config, "utf8");
      check(/proxy_url:\s*["']?\/api\/cms/.test(text),
        "the production admin posts to /api/cms", "same origin");
      check(!/localhost|127\.0\.0\.1/.test(text),
        "and to no local endpoint", "clean");
      check(!/git-gateway/.test(text),
        "the deprecated git-gateway backend is not used", "proxy backend");
      const page = fs.readFileSync(path.join(dist, "admin", "index.html"), "utf8");
      check(/noindex/.test(page), "the admin page is noindex", "noindex");
      const login = fs.readFileSync(path.join(dist, "staff-login", "index.html"), "utf8");
      check(/noindex/.test(login) && /nofollow/.test(login),
        "so is the login page", "noindex, nofollow");

      /*
        THE CURRENT IDENTITY LIBRARY, SELF-HOSTED.

        @netlify/identity is what Netlify recommends for new projects; the
        legacy netlify-identity-widget and gotrue-js are not. It is bundled from
        the pinned package rather than fetched from a CDN, so the version is
        fixed by package-lock and the page loads no third-party script at all.
      */
      const scripts = [...login.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
      check(scripts.length === 1 && scripts[0] === "/staff-login/netlify-identity.js",
        "the login page loads exactly one script, from this origin",
        scripts.join(", ") || "(none)");
      check(!/<script[^>]*src="https?:/.test(login),
        "and no script from any third party", "self-hosted");

      const bundle = fs.readFileSync(
        path.join(dist, "staff-login", "netlify-identity.js"), "utf8");
      check(/@netlify\/identity@/.test(bundle),
        "the bundle names the package and version it was built from",
        (bundle.match(/@netlify\/identity@[\d.]+/) || ["?"])[0]);
      for (const fn of ["handleAuthCallback", "acceptInvite", "requestPasswordRecovery",
        "oauthLogin", "hydrateSession", "updateUser", "logout", "getSettings"]) {
        check(bundle.includes(fn + ":"), `the bundle exports ${fn}`, "present");
      }
      /*
        AND NOTHING SERVER-SIDE. The package also ships verifyRequestOrigin and
        the admin user-management calls; the browser has no use for either. They
        are not secrets, but a bundle served to the public should carry what the
        page needs rather than a catalogue of what the package can do.
      */
      for (const serverOnly of ["verifyRequestOrigin", "getServerCookie"]) {
        check(!bundle.includes(serverOnly),
          `the browser bundle carries no ${serverOnly}`, "browser API only");
      }
      /*
        gotrue-js, which the library wraps, defines an admin client with methods
        like listUsers on a class the bundler cannot drop. It is NOT exported
        here — the global exposes twelve functions and none of them reaches it —
        and it would be useless anyway: /admin/users needs an administrator
        token from Identity, which a browser session is not.

        So the assertion is about what the page can CALL, which is the thing
        that matters, rather than about what a dependency happens to contain.
      */
      const exposed = (bundle.match(/([a-zA-Z]+):s*()s*=>/g) || [])
        .map((m) => m.split(":")[0]);
      check(!exposed.includes("admin") && !exposed.includes("listUsers"),
        "and exposes no admin user-management API to the browser",
        `${exposed.length} exports`);

      /*
        And the page uses that API rather than the widget's. Comments stripped
        first: this file EXPLAINS what it replaced, and a plain search would
        find the explanation and report the very thing it rules out.
      */
      const source = fs.readFileSync(
        path.join(__dirname, "..", "src", "admin", "staff-login.js"), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");

      check(/api\.handleAuthCallback\(\)/.test(code),
        "invite, recovery, OAuth and confirmation all arrive through handleAuthCallback()",
        "one entry point");
      check(/api\.acceptInvite\(/.test(code),
        "an invitation completes with acceptInvite()", "acceptInvite");
      check(/api\.updateUser\(/.test(code),
        "a recovery completes with updateUser({ password })", "updateUser");
      check(/api\.login\(/.test(code) && /api\.logout\(/.test(code),
        "sign in and sign out use the library", "login / logout");
      check(/api\.oauthLogin\(/.test(code),
        "OAuth uses oauthLogin()", "oauthLogin");
      check(/api\.requestPasswordRecovery\(/.test(code),
        "password recovery uses requestPasswordRecovery()", "requestPasswordRecovery");
      check(/api\.hydrateSession\(/.test(code),
        "an existing session is restored with hydrateSession()", "hydrateSession");

      check(!/window\.netlifyIdentity\b/.test(code),
        "nothing reaches for the legacy widget global", "no window.netlifyIdentity");
      check(!/\.init\(|\.open\(/.test(code),
        "nothing calls the widget's init() or open()", "headless library");
      check(!/document\.cookie/.test(code),
        "the session cookie is the library's to set, not this page's",
        "no hand-rolled cookie");
      check(/user\.roles/.test(code) && !/app_metadata/.test(code),
        "roles are read from the normalised user the library returns",
        "user.roles");

      /*
        PROVIDERS ARE DISCOVERED, NOT HARD-CODED.

        The page asks Identity which external providers this site actually has
        enabled and renders a button for each. The previous version showed a
        Google button whenever a build-time flag was set, which could offer a
        provider nobody had configured — following it led to an error page.
      */
      check(/api\.getSettings\(\)/.test(code),
        "enabled sign-in providers are read from getSettings()", "discovered");
      check(!/CMS_IDENTITY_GOOGLE|identityGoogle/.test(code),
        "no build-time provider flag decides what is offered", "runtime only");
      check(/enabled\[provider\.id\]/.test(code),
        "each button appears only when its provider is enabled", "per provider");
      check(/api\.oauthLogin\(provider\.id\)/.test(code),
        "and starts the flow with the library, not a hand-built OAuth URL",
        "oauthLogin");

      const template = fs.readFileSync(
        path.join(__dirname, "..", "src", "staff-login.njk"), "utf8");
      check(!/id="login-google"/.test(template) && /id="login-providers"/.test(template),
        "the page holds a provider container, not a fixed Google button",
        "login-providers");
      check(!/CMS_IDENTITY_GOOGLE|identityGoogle/.test(template),
        "and no build-time flag in the template either", "clean");

    }
  }

  /* -- the local CMS is untouched ------------------------------------------ */

  section("13. Local development still local");
  {
    const fs = require("fs");
    const cmsConfig = fs.readFileSync(
      path.join(__dirname, "..", "src", "_data", "cmsConfig.js"), "utf8");
    check(/process\.env\.CMS_TARGET === "production"/.test(cmsConfig),
      "the backend is chosen by an explicit flag", "CMS_TARGET");
    check(!/CMS_GITHUB_APP_ID[\s\S]{0,200}\?/.test(cmsConfig),
      "never by whether a GitHub credential happens to be present",
      "no credential sniffing");

    delete process.env.CMS_TARGET;
    const built = require("../src/_data/cmsConfig.js").buildConfig();
    check(/127\.0\.0\.1|localhost/.test(built.backend.proxy_url),
      "so a developer with those variables set still gets the local backend",
      built.backend.proxy_url);
  }

  /* -- finish -------------------------------------------------------------- */

  console.log("\n" + "=".repeat(78));
  if (problems.length) {
    console.log(`  FAIL — ${problems.length} of ${checks} production assertions:`);
    for (const p of problems) console.log(`    - ${p}`);
    console.log("=".repeat(78) + "\n");
    process.exit(1);
  }
  console.log(`  PASS — ${checks} production assertions, 0 problems`);
  console.log("=".repeat(78) + "\n");
})().catch((err) => {
  console.error("\n  the suite itself failed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
