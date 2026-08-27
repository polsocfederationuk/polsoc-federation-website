/**
 * github.js — the production write adapter.
 *
 * WHY A GITHUB APP AND NOT A TOKEN
 *
 * Marketing officers must not need GitHub accounts, repository access or
 * personal access tokens. A GitHub App installed on this one repository lets
 * the server act on their behalf with `Contents: read and write` and nothing
 * else, and its installation tokens expire on their own in an hour. A personal
 * access token would belong to a person, outlive them on the committee, and
 * carry whatever else that person can reach.
 *
 * The App's private key lives in a Netlify environment variable. It is never
 * sent to the browser, never written into generated files, and never logged.
 *
 * ATOMIC COMMITS
 *
 * A single Publish can change a record and add two photographs. Those go into
 * ONE commit through the Git data API — blobs, then a tree, then a commit, then
 * one ref update — rather than three commits through the contents API. That
 * matters for more than tidiness: a half-applied publish would put a record
 * referencing an image that is not in the repository yet, and Netlify would
 * build exactly that.
 *
 * The ref update is conditional on the parent commit, so two editors publishing
 * at the same moment cannot lose one another's work: the second one fails and
 * is told to refresh.
 *
 * TESTABLE WITHOUT A NETWORK
 *
 * Every call goes through an injected `transport`. The tests drive a fake one
 * and never touch a real repository — see scripts/test-cms-production.js.
 */

"use strict";

const crypto = require("crypto");

const API = "https://api.github.com";

/* -- authentication --------------------------------------------------------- */

const b64url = (input) => Buffer.from(input).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * The App's own JWT: proof to GitHub that we are this App.
 *
 * Signed here because that is the whole mechanism — there is no endpoint that
 * will do it for us, and adding a JWT library for one RS256 signature would be
 * a dependency to audit for no gain. This SIGNS a token we own; it does not
 * parse or trust one, which is the thing worth avoiding by hand.
 */
function appJwt(appId, privateKey, now) {
  const issued = Math.floor((now || Date.now()) / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    // Backdated by a minute: GitHub rejects a token whose `iat` is in the
    // future, and a function host's clock can be a little ahead.
    iat: issued - 60,
    exp: issued + 540,
    iss: appId,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(privateKey).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

/**
 * A private key from an environment variable, in either shape it arrives in.
 *
 * Netlify's UI accepts real newlines, but a value pasted through a shell or a
 * CI variable usually arrives with `\n` written out. Both are normal; guessing
 * wrong produces an unreadable OpenSSL error at the worst moment.
 */
/**
 * WHICH KEY IS THIS, WITHOUT SAYING WHAT IT IS.
 *
 * The public half of a key pair is not a secret — it is published — so a digest
 * of it can be compared between a laptop and a function log to settle the one
 * question a refusal cannot otherwise answer: is production even holding the
 * key we think it is?
 *
 * SPKI DER is the canonical encoding, so the same key fingerprints identically
 * whether it arrived as PKCS#1 or PKCS#8, one line or many, padded with blank
 * lines or not. Nothing derived from the PRIVATE half is read, printed or
 * returned.
 *
 * @param {string} privateKey  already through normaliseKey
 * @returns {string} lowercase hex SHA-256, or "(unreadable)"
 */
function keyFingerprint(privateKey) {
  try {
    const pub = crypto.createPublicKey(privateKey);
    return crypto.createHash("sha256")
      .update(pub.export({ type: "spki", format: "der" }))
      .digest("hex");
  } catch (err) {
    // A key that will not parse cannot be fingerprinted, and saying so is
    // itself the diagnosis.
    return "(unreadable)";
  }
}

/*
  WHAT GITHUB IS ALLOWED TO SAY IN OUR LOG.

  Each of these was observed from the real API, and each maps to a different
  thing being wrong:

    Integration not found                  the App ID / JWT issuer
    Not Found                              the installation, or the App is not
                                           installed where we think
    A JSON web token could not be decoded  the private key
    Bad credentials                        the signature or the clock

  An allow-list rather than the message itself, because a response body is
  upstream text: it can change, and it can carry request detail. Anything not
  on this list is logged as "(unrecognised)" and the status still narrows it.
*/
const GITHUB_REFUSALS = new Set([
  "Integration not found",
  "Not Found",
  "A JSON web token could not be decoded",
  "Bad credentials",
]);

function classifyRefusal(message) {
  return GITHUB_REFUSALS.has(message) ? message : "(unrecognised)";
}

function normaliseKey(raw) {
  const key = String(raw || "").trim();
  return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}

/* -- the adapter ------------------------------------------------------------ */

class GitHubRepo {
  /**
   * @param {object} config  { owner, repo, branch, appId, installationId, privateKey }
   * @param {function} transport  (url, init) => Response — injected for tests
   */
  constructor(config, transport) {
    this.owner = config.owner;
    this.repo = config.repo;
    this.branch = config.branch;
    this.config = config;
    this.transport = transport || globalThis.fetch;
    this.token = null;
    this.tokenExpires = 0;
  }

  get base() {
    return `${API}/repos/${this.owner}/${this.repo}`;
  }

  /**
   * A current installation token, minted on demand.
   *
   * Held only for the life of this function invocation and only until shortly
   * before it expires. Nothing persists it: a leaked token that has already
   * expired is a much smaller problem than one stored somewhere convenient.
   */
  async accessToken() {
    const now = Date.now();
    if (this.token && now < this.tokenExpires - 60_000) return this.token;

    const jwt = appJwt(this.config.appId, normaliseKey(this.config.privateKey), now);
    const response = await this.transport(
      `${API}/app/installations/${this.config.installationId}/access_tokens`,
      { method: "POST", headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      } });
    if (!response.ok) {
      /*
        THE ONE LINE THAT MAKES THIS DIAGNOSABLE.

        Every refusal here used to collapse into the same 502, which is correct
        for the editor — they can do nothing about any of it — and useless for
        whoever has to fix it: a wrong App ID and a wrong private key looked
        identical from outside. This records what the log needs and nothing
        more.

        Only non-secrets. The status and an allow-listed classification say what
        GitHub objected to; the three identifiers say what we asked with; the
        fingerprint identifies the key WITHOUT any private material — it is a
        digest of the public half. The JWT, the token, the Authorization header
        and the response body are never touched.

        Their values are logged as given, untrimmed, so that stray whitespace
        from a copied-and-pasted environment variable is visible as \n rather
        than silently invisible.
      */
      let classification = "(unrecognised)";
      try {
        const body = await response.json();
        classification = classifyRefusal(
          typeof body.message === "string" ? body.message : "");
      } catch (err) {
        /* not JSON, and the body is not ours to repeat */
      }
      console.error("github: installation token refused " + JSON.stringify({
        status: response.status,
        github: classification,
        appId: this.config.appId,
        installationId: this.config.installationId,
        repo: `${this.owner}/${this.repo}`,
        keyFingerprint: keyFingerprint(normaliseKey(this.config.privateKey)),
      }));
      // Unchanged: the editor can do nothing with any of the above.
      throw new GitHubError("could not authenticate with the repository", 502);
    }
    const body = await response.json();
    this.token = body.token;
    this.tokenExpires = Date.parse(body.expires_at) || (now + 3_600_000);
    return this.token;
  }

  async call(path, init) {
    const token = await this.accessToken();
    const response = await this.transport(`${this.base}${path}`, {
      ...(init || {}),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...((init || {}).headers || {}),
      },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new GitHubError(`the repository refused that change`, response.status);
    }
    return response.json();
  }

  /* -- reading ------------------------------------------------------------- */

  /** The commit the branch currently points at. */
  async head() {
    const ref = await this.call(`/git/ref/heads/${encodeURIComponent(this.branch)}`);
    if (!ref) throw new GitHubError(`the branch "${this.branch}" does not exist`, 404);
    return ref.object.sha;
  }

  /** One file's text and blob SHA, or null. */
  async readFile(repoPath) {
    const found = await this.call(
      `/contents/${encodePath(repoPath)}?ref=${encodeURIComponent(this.branch)}`);
    if (!found || Array.isArray(found) || !found.content) return null;
    return {
      path: repoPath,
      sha: found.sha,
      text: Buffer.from(found.content, "base64").toString("utf8"),
      size: found.size,
    };
  }

  /** One file as raw bytes, or null. Used for media. */
  async readBytes(repoPath) {
    const found = await this.call(
      `/contents/${encodePath(repoPath)}?ref=${encodeURIComponent(this.branch)}`);
    if (!found || Array.isArray(found) || !found.content) return null;
    return { path: repoPath, sha: found.sha,
      bytes: Buffer.from(found.content, "base64"), size: found.size };
  }

  /** Everything directly inside a folder. */
  async listFolder(folder) {
    const found = await this.call(
      `/contents/${encodePath(folder)}?ref=${encodeURIComponent(this.branch)}`);
    if (!found || !Array.isArray(found)) return [];
    return found
      .filter((item) => item.type === "file")
      .map((item) => ({ path: item.path, name: item.name, sha: item.sha, size: item.size }));
  }

  /* -- writing ------------------------------------------------------------- */

  /**
   * One commit containing every change.
   *
   * @param {Array} changes  [{ path, content?, encoding?, delete? }]
   * @param {string} message
   * @param {object} actor   { name, email } for the commit author
   * @param {string} expectedHead  refuse if the branch has moved since
   */
  async commit(changes, message, actor, expectedHead) {
    const head = await this.head();
    if (expectedHead && head !== expectedHead) {
      throw new GitHubError("somebody else changed the site while you were working", 409);
    }

    const commit = await this.call(`/git/commits/${head}`);
    const baseTree = commit.tree.sha;

    /*
      Blobs first. A deletion is a tree entry with a null sha, which is how the
      Git data API removes a path — there is no separate delete call, and that
      is exactly why a mixed add/update/delete publish stays one commit.
    */
    const tree = [];
    for (const change of changes) {
      if (change.delete) {
        tree.push({ path: change.path, mode: "100644", type: "blob", sha: null });
        continue;
      }
      const blob = await this.call("/git/blobs", {
        method: "POST",
        body: JSON.stringify({
          content: change.encoding === "base64"
            ? change.content
            : Buffer.from(change.content, "utf8").toString("base64"),
          encoding: "base64",
        }),
      });
      tree.push({ path: change.path, mode: "100644", type: "blob", sha: blob.sha });
    }

    const newTree = await this.call("/git/trees", {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTree, tree }),
    });

    const created = await this.call("/git/commits", {
      method: "POST",
      body: JSON.stringify({
        message,
        tree: newTree.sha,
        parents: [head],
        /*
          The commit is ATTRIBUTED TO THE EDITOR, using the identity Netlify
          verified. The App is the committer — it is what actually holds the
          credential — so `git log` shows both: who asked, and what carried it
          out. Neither is invented from a request body.
        */
        ...(actor && actor.email ? { author: { name: actor.name, email: actor.email } } : {}),
      }),
    });

    /*
      Not forced. If the branch moved between the read above and here, GitHub
      rejects the update and the editor is told to refresh — rather than one of
      two simultaneous publishes disappearing.
    */
    const token = await this.accessToken();
    const response = await this.transport(
      `${this.base}/git/refs/heads/${encodeURIComponent(this.branch)}`,
      { method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ sha: created.sha, force: false }) });
    if (!response.ok) {
      throw new GitHubError("somebody else changed the site while you were working", 409);
    }
    return { commit: created.sha, changed: changes.map((c) => c.path) };
  }
}

/** Percent-encode each segment, leaving the separators alone. */
function encodePath(repoPath) {
  return String(repoPath).split("/").map(encodeURIComponent).join("/");
}

class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GitHubError";
    this.status = status || 502;
  }
}

/** Build the adapter from the environment, or say what is missing. */
function fromEnvironment(env, transport) {
  const e = env || process.env;
  const missing = ["CMS_GITHUB_APP_ID", "CMS_GITHUB_INSTALLATION_ID",
    "CMS_GITHUB_PRIVATE_KEY", "CMS_GITHUB_REPO"].filter((name) => !e[name]);
  if (missing.length) return { missing };

  const [owner, repo] = String(e.CMS_GITHUB_REPO).split("/");
  if (!owner || !repo) return { missing: ["CMS_GITHUB_REPO (owner/repo)"] };

  return { repo: new GitHubRepo({
    owner,
    repo,
    branch: e.CMS_GITHUB_BRANCH || "main",
    appId: e.CMS_GITHUB_APP_ID,
    installationId: e.CMS_GITHUB_INSTALLATION_ID,
    privateKey: e.CMS_GITHUB_PRIVATE_KEY,
  }, transport) };
}

module.exports = { GitHubRepo, GitHubError, fromEnvironment, appJwt, normaliseKey,
  encodePath, keyFingerprint, classifyRefusal };
