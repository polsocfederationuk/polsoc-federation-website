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

  /* -- what an upstream refusal may and may not become ---------------------- */

  /*
    A 502 CARRYING OUR OWN 405 MESSAGE.

    Production showed `502 {"error":"This endpoint only accepts POST requests."}`
    on /api/cms, and the leading theory was that the session fallback was
    calling Identity with the wrong method and that its refusal was being
    surfaced as our 502.

    That string exists in exactly one place in this repository — the method
    check in cms.mjs — and it is a 405 there. These tests pin down what the
    fallback does with a refusal shaped exactly like the one that was seen, and
    what status the endpoint can return as a result. If a future change ever
    lets an upstream body escape into our response, or turns an unauthenticated
    request into a 5xx, this is what stops it.
  */
  section("1e. An upstream refusal never becomes a 502");
  {
    const sessionLib = require(path.join(__dirname, "..", "netlify", "lib", "session.js"));

    /* Identity answering exactly as production's /api/cms answers a GET. */
    const postOnly = async () => new Response(
      JSON.stringify({ error: "This endpoint only accepts POST requests." }),
      { status: 405, headers: { "content-type": "application/json" } });

    const user = await sessionLib.resolve(
      new Request(SITE + "/api/cms", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "nf_jwt=whatever" },
        body: "{}",
      }),
      { getUser: async () => null, fetch: postOnly, env: { URL: SITE } },
    );
    check(user === null,
      "a refusal from Identity resolves to nobody, not to an error",
      "null, so the caller answers 401");

    /* …and end to end, that is a 401 with our own words. */
    const refused = await cms.default(
      request({ action: "getEntry", params: { path: "content/team/jane-example.yaml" } },
        { headers: { cookie: "nf_jwt=whatever" } }),
      {},
      { repo: seedRepo(), getUser: async () => null, fetch: postOnly },
    );
    const refusedBody = JSON.parse(await refused.text());
    check(refused.status === 401,
      "the endpoint answers 401, never 502, when Identity refuses",
      `${refused.status}`);
    check(!/only accepts POST/.test(refusedBody.error || ""),
      "and never repeats an upstream body back to the browser",
      refusedBody.error);

    /* The same for every shape an upstream can fail in. */
    for (const [label, reply] of [
      ["a 500 from Identity", async () => new Response("boom", { status: 500 })],
      ["an unreachable Identity", async () => { throw new TypeError("fetch failed"); }],
      ["a non-JSON body", async () => new Response("<html>", { status: 200 })],
      ["a 200 with no user", async () => new Response("{}", { status: 200 })],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const out = await cms.default(
        request({ action: "getEntry", params: { path: "content/team/jane-example.yaml" } },
          { headers: { cookie: "nf_jwt=whatever" } }),
        {},
        { repo: seedRepo(), getUser: async () => null, fetch: reply },
      );
      check(out.status === 401, `${label} is still a 401`, `${out.status}`);
    }

    /*
      THE METHOD WE SEND. Identity's /user is a GET — the installed
      @netlify/identity asks for it that way, and the live endpoint answers
      "requires a Bearer token" rather than a method complaint. Sending POST
      would be a guess; this pins the contract to what the library does.
    */
    let seen = null;
    await sessionLib.resolve(
      new Request(SITE + "/api/cms", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "nf_jwt=t" },
        body: "{}",
      }),
      {
        getUser: async () => null,
        env: { URL: SITE },
        fetch: async (url, init) => {
          seen = { url: String(url), method: (init && init.method) || "GET",
            hasBody: Boolean(init && init.body) };
          return new Response("{}", { status: 401 });
        },
      },
    );
    check(seen && seen.method === "GET",
      "the Identity lookup is a GET, as the library's own is",
      seen && seen.method);
    check(seen && seen.url === SITE + "/.netlify/identity/user",
      "…to /.netlify/identity/user on this site", seen && seen.url);
    check(seen && seen.hasBody === false,
      "…with no body", "GET carries none");

    /*
      A SITE URL WITH A PATH ON IT. `new URL(...).origin` discards the path, so
      an env.URL of "https://site/some/where" still produces the right endpoint
      rather than "https://site/some/where/.netlify/identity/user".
    */
    check(sessionLib.identityOrigin(
      new Request(SITE + "/api/cms", { method: "POST", body: "{}" }),
      { URL: SITE + "/some/path" }) === SITE,
    "a site URL carrying a path still yields the bare origin", "no double join");
    check(sessionLib.identityOrigin(
      new Request(SITE + "/api/cms", { method: "POST", body: "{}" }),
      { URL: SITE + "/" }) === SITE,
    "…and a trailing slash does not double up", "no //");
  }

  /* -- diagnosing a refused installation token ------------------------------ */

  /*
    WHY THERE IS A LOG LINE HERE AT ALL.

    Every refusal from GitHub's token endpoint becomes the same 502 for the
    editor, which is right — they can do nothing about any of it. It also made
    a wrong App ID and a wrong private key look identical from outside, and
    production spent a long time indistinguishable from a working system.

    So the failure path records the upstream status and an allow-listed
    classification, which is what turns one opaque sentence into something
    diagnosable. These tests keep it to exactly that: non-secrets only, and
    nothing at all on success.

    A key fingerprint was logged here too, temporarily, to settle whether
    production held the key we thought. It did — the fault was an installation
    ID containing a settings URL — so the fingerprint is gone and the assertion
    below checks it stays gone.
  */
  section("1f. A refused installation token is diagnosable, not revealing");
  {
    const gh = require(path.join(__dirname, "..", "netlify", "lib", "github.js"));
    const crypto = require("crypto");

    /* A throwaway pair: never a real credential in the test suite. */
    const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
      publicKeyEncoding: { type: "pkcs1", format: "pem" } });
    /* -- the classification allow-list -------------------------------------- */

    for (const known of ["Integration not found", "Not Found",
      "Bad credentials", "A JSON web token could not be decoded"]) {
      check(gh.classifyRefusal(known) === known,
        `"${known}" is reported as itself`, "allow-listed");
    }
    for (const [label, arbitrary] of [
      ["free upstream prose", "Something new GitHub started saying"],
      ["something echoing a request", "Bad credentials for token ghs_SECRETVALUE"],
      ["an empty message", ""],
      ["a non-string", undefined],
    ]) {
      check(gh.classifyRefusal(arbitrary) === "(unrecognised)",
        `${label} is not repeated into the log`, "(unrecognised)");
    }

    /* -- what actually reaches the log -------------------------------------- */

    /** Capture console.error while a refusal happens. */
    const refusalLog = async (status, body) => {
      const lines = [];
      const realError = console.error;
      console.error = (...args) => lines.push(args.join(" "));
      const repo = new gh.GitHubRepo({
        owner: "polsocfederationuk", repo: "polsoc-federation-website", branch: "main",
        appId: "4703355", installationId: "156228587", privateKey: pair.privateKey,
      }, async () => new Response(JSON.stringify(body), { status }));
      let thrown = null;
      try { await repo.accessToken(); } catch (err) { thrown = err; }
      console.error = realError;
      return { lines, thrown };
    };

    const refused = await refusalLog(401,
      { message: "A JSON web token could not be decoded" });
    check(refused.thrown && refused.thrown.name === "GitHubError"
      && refused.thrown.status === 502,
    "a refusal still throws the same 502 GitHubError", "unchanged for the editor");
    check(refused.thrown.message === "could not authenticate with the repository",
      "…with exactly the same message", refused.thrown.message);
    check(refused.lines.length === 1, "and logs exactly one line",
      `${refused.lines.length} line(s)`);

    const logged = refused.lines[0] || "";
    check(/"status":401/.test(logged), "the log carries the upstream status", "401");
    check(/A JSON web token could not be decoded/.test(logged),
      "…the allow-listed classification", "classified");
    check(/"appId":"4703355"/.test(logged) && /"installationId":"156228587"/.test(logged),
      "…the identifiers we asked with", "appId + installationId");
    check(/polsocfederationuk\/polsoc-federation-website/.test(logged),
      "…and the repository", "owner/repo");

    /*
      NOTHING ELSE. This is the assertion that matters: a diagnostic that leaks
      is worse than no diagnostic, because it ships to a log nobody is guarding.
    */
    const secretBody = pair.privateKey
      .replace(/-----[A-Z ]+-----/g, "").replace(/s+/g, "");
    check(!logged.includes(secretBody.slice(0, 40)),
      "the log contains no private-key material", "no key");
    check(!/BEGIN [A-Z ]*PRIVATE KEY|Bearer |Authorization|eyJ[A-Za-z0-9_-]{10,}/.test(logged),
      "no JWT, bearer token or Authorization header reaches the log", "none");
    check(!/nf_jwt|nf_refresh/.test(logged),
      "and no session cookie either", "none");

    /* An unrecognised upstream body must not be echoed. */
    const odd = await refusalLog(403,
      { message: "Bad credentials for token ghs_LOOKS_LIKE_A_SECRET" });
    check(!/ghs_LOOKS_LIKE_A_SECRET/.test(odd.lines[0] || ""),
      "an unrecognised upstream message is never repeated", "(unrecognised)");
    check(/"status":403/.test(odd.lines[0] || ""),
      "…though its status still narrows the problem", "403");

    /* A body that is not JSON at all must not break the path. */
    const html = await refusalLog(502, "<html>upstream trouble</html>");
    check(html.thrown && html.thrown.status === 502 && html.lines.length === 1,
      "a non-JSON upstream body still logs one line and throws", "no crash");
    check(!/upstream trouble/.test(html.lines[0] || ""),
      "…without repeating it", "(unrecognised)");

    /*
      THE TEMPORARY DIAGNOSTIC IS GONE AND STAYS GONE. A key fingerprint is not
      a secret, but a log line nobody needs is one more thing shipping to a
      place nobody is guarding.
    */
    check(gh.keyFingerprint === undefined,
      "the temporary key-fingerprint helper has been removed", "not exported");
    const ghSource = require("fs").readFileSync(
      path.join(__dirname, "..", "netlify", "lib", "github.js"), "utf8");
    check(!/keyFingerprint|createPublicKey|spki/i.test(ghSource),
      "…and nothing derives a key fingerprint any more", "no public-key digest");
    check(!/fingerprint/i.test(logged),
      "…so no fingerprint reaches the log", "status and identifiers only");

    /* -- and silence on success --------------------------------------------- */

    const quiet = [];
    const realError = console.error;
    console.error = (...args) => quiet.push(args.join(" "));
    const ok = new gh.GitHubRepo({
      owner: "polsocfederationuk", repo: "polsoc-federation-website", branch: "main",
      appId: "4703355", installationId: "156228587", privateKey: pair.privateKey,
    }, async () => new Response(JSON.stringify({
      token: "ghs_NOT_A_REAL_TOKEN", expires_at: new Date(Date.now() + 3600e3).toISOString(),
    }), { status: 201 }));
    const token = await ok.accessToken();
    console.error = realError;
    check(quiet.length === 0,
      "a successful token mints nothing into the log", "silent on 201");
    check(token === "ghs_NOT_A_REAL_TOKEN",
      "…and the token is returned to the caller only", "not logged");
  }

  /* -- the browser sign-in gate -------------------------------------------- */

  /*
    THE SCREEN NOBODY SHOULD SEE.

    Decap ships a login page, and with the proxy backend it grants nothing —
    `authenticate()` resolves immediately. It still looked like an
    authentication screen, and "Log Out" returned people to it, so somebody who
    had signed out could press Login and appear to be back inside.

    src/admin/session.js is what removes it: Decap is held at CMS_MANUAL_INIT
    until Netlify Identity has said who this is. These tests RUN that file
    against stubs rather than searching it for strings, because what matters is
    what it does with each answer.
  */
  section("1d. The browser sign-in gate");
  {
    const gateSource = require("fs").readFileSync(
      path.join(__dirname, "..", "src", "admin", "session.js"), "utf8");

    /** Run session.js in a bare window and report what it did. */
    const runGate = (identityUser, options) => {
      const opts = options || {};
      const record = { replaced: null, initCalled: 0, loggedOut: 0, backend: null };

      const node = () => ({
        id: "", className: "", textContent: "", href: "", hidden: false,
        parentElement: null, firstChild: null,
        appendChild() {}, insertBefore() {}, removeChild() {},
        addEventListener() {}, setAttribute() {}, click() {},
        querySelector: () => null, querySelectorAll: () => [],
      });

      const win = {
        location: {
          origin: SITE,
          replace(to) { if (record.replaced === null) record.replaced = to; },
        },
        netlifyIdentityApi: opts.noApi ? undefined : {
          getUser: () => (opts.identityThrows
            ? Promise.reject(new Error("offline"))
            : Promise.resolve(identityUser)),
          logout: () => { record.loggedOut += 1; return Promise.resolve(); },
        },
        CMS: {
          getBackend: (name) => (name === "proxy"
            ? { init: () => ({ entriesByFolder() {}, logout() { return "decap"; } }) }
            : null),
          registerBackend: (name, Ctor) => { record.backend = new Ctor({}, {}); },
        },
        initCMS() { record.initCalled += 1; },
        fetch: opts.fetch || (() => Promise.resolve({ status: 200 })),
        addEventListener() {},
        MutationObserver: function () {
          return { observe() {}, disconnect() {} };
        },
      };
      win.window = win;

      const doc = {
        body: node(),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: node,
        addEventListener() {},
        readyState: "complete",
      };

      /*
        Every global session.js reaches for is passed in explicitly. A missing
        one would surface as a ReferenceError inside its own catch and look
        exactly like "no session", which is the failure mode most worth not
        mistaking for a pass.
      */
      // eslint-disable-next-line no-new-func
      new Function("window", "document", "Promise", "URL", "MutationObserver", gateSource)(
        win, doc, Promise, URL, win.MutationObserver);
      return { record, win };
    };

    const settle = () => new Promise((r) => setTimeout(r, 0));

    /*
      A VALID SESSION AND NO DECAP STATE. This is a first visit — local storage
      is empty, which is exactly when Decap used to show its login screen.
    */
    const editor = runGate({ email: "ewa@polsocfederation.pl", roles: ["editor"] });
    await settle();
    check(editor.record.replaced === null,
      "an editor with a valid session is not sent away", "stays in the CMS");
    check(editor.record.initCalled === 1,
      "the CMS is initialised exactly once", `initCMS called ${editor.record.initCalled}×`);
    check(editor.record.backend !== null,
      "a backend is registered before the CMS starts", "proxy backend replaced");

    /*
      …and the replacement answers restoreUser, which is the single thing that
      keeps Decap's login screen from rendering on that first visit.
    */
    const restored = editor.record.backend
      ? await editor.record.backend.restoreUser() : null;
    check(Boolean(restored),
      "the backend restores a user, so Decap never shows its login screen",
      JSON.stringify(restored));
    check(typeof editor.record.backend.entriesByFolder === "function",
      "…while still delegating Decap's own file operations", "composed, not reimplemented");

    /* NO SESSION, whatever Decap may have left in local storage. */
    const anon = runGate(null);
    await settle();
    check(anon.record.replaced === "/staff-login/",
      "no Identity session is sent to the sign-in page", anon.record.replaced);
    check(anon.record.initCalled === 0,
      "…before Decap is initialised at all", "no CMS is drawn");

    /* SIGNED IN, NOT INVITED. Ending the session is deliberate. */
    const stranger = runGate({ email: "stranger@example.com", roles: [] });
    await settle();
    check(stranger.record.replaced === "/staff-login/?unauthorised=1",
      "an account with no role is refused and told why", stranger.record.replaced);
    check(stranger.record.loggedOut === 1,
      "…and its Identity session is ended, not left lying around",
      "logout called once");
    check(stranger.record.initCalled === 0,
      "…and it never reaches a usable CMS", "no CMS is drawn");

    /* An admin is admitted on the same terms as an editor. */
    const admin = runGate({ email: "ada@polsocfederation.pl", roles: ["admin"] });
    await settle();
    check(admin.record.replaced === null && admin.record.initCalled === 1,
      "an admin is admitted too", "same gate, both roles");

    /* LOGGING OUT ends the real session before leaving. */
    const out = runGate({ email: "ewa@polsocfederation.pl", roles: ["editor"] });
    await settle();
    out.record.backend.logout();
    await settle();
    check(out.record.loggedOut === 1,
      "logging out calls Netlify Identity's logout", "the session is really ended");
    check(out.record.replaced === "/staff-login/?logged_out=1",
      "…then lands on the signed-out page", out.record.replaced);

    /*
      A SESSION THAT ENDS WHILE THE CMS IS OPEN. Without this the editor is left
      looking at "No Entries" and an API error, which reads as a broken CMS.
    */
    const expiring = runGate({ email: "ewa@polsocfederation.pl", roles: ["editor"] },
      { fetch: () => Promise.resolve({ status: 401 }) });
    await settle();
    await expiring.win.fetch(SITE + "/api/cms", { method: "POST" });
    await settle();
    check(expiring.record.replaced === "/staff-login/?expired=1",
      "a 401 from /api/cms sends the editor to the expiry page",
      expiring.record.replaced);

    const bulkExpiring = runGate({ email: "e@x", roles: ["editor"] },
      { fetch: () => Promise.resolve({ status: 401 }) });
    await settle();
    await bulkExpiring.win.fetch("/api/bulk/list", { method: "POST" });
    await settle();
    check(bulkExpiring.record.replaced === "/staff-login/?expired=1",
      "…and so does one from /api/bulk", bulkExpiring.record.replaced);

    /* NARROW ON PURPOSE: anything else answering 401 is not our business. */
    const elsewhere = runGate({ email: "e@x", roles: ["editor"] },
      { fetch: () => Promise.resolve({ status: 401 }) });
    await settle();
    await elsewhere.win.fetch("/some/other/thing");
    await settle();
    check(elsewhere.record.replaced === null,
      "a 401 from anywhere else is left alone", "only /api/cms and /api/bulk are watched");

    /* If Identity cannot answer, a CMS that cannot work is not shown. */
    const broken = runGate(null, { identityThrows: true });
    await settle();
    check(broken.record.replaced === "/staff-login/" && broken.record.initCalled === 0,
      "an identity failure shows the sign-in page, not a broken CMS",
      broken.record.replaced);

    const missing = runGate(null, { noApi: true });
    await settle();
    check(missing.record.replaced === "/staff-login/" && missing.record.initCalled === 0,
      "a missing identity client does the same", missing.record.replaced);

    /* The token is not this file's business, and it never touches one. */
    check(!/nf_jwt|token|jwt/i.test(gateSource.replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")),
    "the gate never handles a token itself", "Identity holds it");
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
    /*
      A FUTURE ACADEMIC YEAR SAVES AND PUBLISHES.

      The server used to refuse this outright, because the events listing showed
      one season and an event belonging to a later year would have disappeared
      from the site while breaking the build.

      Every year is now its own section on the public pages, so the event lands
      in a collapsed 2026/27 group. Which year is CURRENT is still decided by
      Site settings alone — a record arriving early does not promote itself.
    */
    const completeEvent = (year) => 'slug: gala\nevent_family: standard\n' +
      `academic_year: "${year}"\n` +
      "published: true\nshow_in_listing: true\nstart_date: \"2026-11-20\"\n" +
      "en:\n  summary: s\n  title_lead: Winter Gala\n  timeline_title: Gala\n" +
      "  card_image_alt: a\n  og_image_alt: b\n" +
      "pl:\n  summary: s\n  title_lead: Gala\n  timeline_title: Gala\n" +
      "  card_image_alt: a\n  og_image_alt: b\n";

    const future = await call(cms.default, { action: "persistEntry", params: {
      dataFiles: [{ path: "content/events/gala.yaml", raw: completeEvent("2026/27") } ] } },
    "admin-token");
    check(future.status === 200,
      "a future-year event can be published", `${future.status}`);
    check(future.repo.commits.length === 1,
      "…and is committed like any other", `${future.repo.commits.length} commit(s)`);

    /* The year's FORMAT is still a refusal — that rule did not move. */
    const malformed = await call(cms.default, { action: "persistEntry", params: {
      dataFiles: [{ path: "content/events/gala.yaml", raw: completeEvent("twenty-six") } ] } },
    "admin-token");
    check(malformed.status >= 400 && malformed.repo.commits.length === 0,
      "an unparseable academic year is still refused", `${malformed.status}`);

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
    /*
      A FUTURE YEAR PUBLISHES LIKE ANY OTHER.

      This used to be refused, and refusing took the whole selection with it. The
      events listing showed one season, so an event belonging to a later year
      would have vanished from the site and broken the build.

      Every academic year is now its own section on the public pages, so it
      lands in a collapsed 2026/27 group instead — visible, correctly placed,
      and not promoted over the season that is running. Which year is current is
      still decided only by Site settings.
    */
    check(show.status === 200,
      "showing a future event is allowed", `${show.status}`);
    check(/published: true/.test(show.repo.files.get("content/events/future-event.yaml")),
      "…and the future event is published", "2026/27 published");
    check(/published: true/.test(show.repo.files.get("content/events/now-event.yaml")),
      "…alongside the current-year event in the same selection", "both shown");
    check(show.repo.commits.length === 1,
      "…in one commit", `${show.repo.commits.length} commit(s)`);

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

      /*
        THE SIGN-IN GATE, IN THE PAGE THAT ACTUALLY SHIPS.

        The order here is the whole mechanism and it is easy to get wrong:
        `CMS_MANUAL_INIT` is read when the Decap bundle EVALUATES, so a flag set
        after the script tag does nothing at all — Decap initialises itself,
        draws its login screen, and none of this applies. Positions are compared
        rather than presence for exactly that reason.
      */
      const flagAt = page.indexOf("CMS_MANUAL_INIT = true");
      const bundleAt = page.indexOf('src="./decap-cms.js"');
      const identityAt = page.indexOf('src="/staff-login/netlify-identity.js"');
      check(flagAt !== -1 && bundleAt !== -1 && flagAt < bundleAt,
        "CMS_MANUAL_INIT is set before the Decap bundle loads",
        flagAt === -1 ? "flag absent" : `flag at ${flagAt}, bundle at ${bundleAt}`);
      check(identityAt !== -1 && identityAt < bundleAt,
        "the Identity client loads on the admin page, before Decap",
        identityAt === -1 ? "identity absent" : `identity at ${identityAt}`);

      /*
        Called once. Twice would mount the CMS twice; never would leave the page
        blank behind the "Checking your sign-in…" cover.
      */
      const pageCode = page
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const initCalls = (pageCode.match(/window\.initCMS\(\)/g) || []).length;
      check(initCalls === 1, "the supported initialiser is called exactly once",
        `window.initCMS() × ${initCalls}`);
      check((pageCode.match(/CMS_MANUAL_INIT\s*=\s*true/g) || []).length === 1,
        "…and the manual-init flag is set exactly once", "one assignment");

      /*
        NO SESSION MATERIAL IN THE PAGE. The gate asks Identity at runtime; a
        token baked into a served file would be a credential anybody could read.
      */
      check(!/nf_jwt\s*=|eyJ[A-Za-z0-9_-]{20,}/.test(page),
        "the admin page embeds no session token", "nothing baked in");
      check(!/<script[^>]*src="https?:/.test(page),
        "the admin page loads no third-party script", "self-hosted");
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
