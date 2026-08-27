/**
 * cms.mjs — the production CMS API.
 *
 * A MODERN (v2) NETLIFY FUNCTION. `export default async (request, context)`,
 * taking a standard `Request` and returning a standard `Response`. The previous
 * version was a v1 Lambda-compatible handler taking `(event, context)` and
 * returning `{statusCode, headers, body}`.
 *
 * That is not cosmetic. `getUser()` from @netlify/identity — Netlify's current
 * first-party server API — reads the request context the v2 runtime provides,
 * and is explicitly unsupported in v1 handlers. Migrating is what let the
 * bespoke session-verification wrapper be deleted rather than kept alongside it.
 *
 * `.mjs` because this repository is CommonJS. The shared libraries stay CJS and
 * are imported through Node's interop; only the handler needs to be a module.
 *
 * WHAT SPEAKS TO IT
 *
 * Decap's own `proxy` backend, pointed at `/api/cms` — a ROOT-RELATIVE url,
 * which that backend explicitly supports. So this is a built-in, pinned,
 * already-tested Decap backend talking to us over its documented action
 * protocol, not a hand-written implementation of an API its own documentation
 * calls unfinalised. Root-relative is also SAME-ORIGIN, so the session cookie
 * is sent without the backend knowing anything about authentication.
 *
 * WHAT IT WILL NOT DO
 *
 * Take a repository path from the browser. Decap sends paths — it is a
 * file-oriented protocol — but every one is classified against the allow-list
 * in ../lib/paths.js before it is read, and again before it is written. A path
 * outside content/ and the three asset folders does not exist as far as this
 * function is concerned, for editors and admins alike.
 *
 * There is no shell, no arbitrary GitHub call, and no route that accepts a URL.
 */

import { getUser, verifyRequestOrigin } from "@netlify/identity";

import yaml from "js-yaml";
import paths from "../lib/paths.js";
import session from "../lib/session.js";
import media from "../lib/media.js";
import github from "../lib/github.js";
import rules from "../lib/rules.js";
import authz from "../lib/authz.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  // This is an API, not a document. Nothing should frame it or sniff it, and
  // no CORS header is ever returned: a cross-origin caller cannot read a reply
  // even if it managed to provoke one.
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

const reply = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const fail = (status, message) => reply(status, { error: message });

/* -- request integrity ------------------------------------------------------ */

/**
 * Three layers, and each one catches something the others do not.
 *
 *   1. POST only            there is no state-changing GET to embed in an
 *                           <img> or a link somebody can be sent.
 *   2. JSON content type    a simple cross-site form can only send
 *                           form-urlencoded, text/plain or multipart. Sending
 *                           JSON requires a preflight, which this function
 *                           never answers.
 *   3. verifyRequestOrigin  Netlify's own check: the Origin header must be
 *                           present and must match this site.
 *
 * Layer 3 replaced a hand-written origin comparison. It is STRICTER in one
 * respect — the old code fell back to the Referer when no Origin was present,
 * and this refuses outright. That fallback existed for browsers that omitted
 * Origin on same-origin POSTs, which current browsers do not do; requiring it
 * is the safer reading and it is the library's.
 *
 * Layers 1 and 2 are kept because verifyRequestOrigin does not look at the
 * method or the content type, and dropping them would widen what a cross-site
 * page can attempt before the origin is ever consulted.
 */
function requestProblem(request) {
  if (request.method !== "POST") {
    return { status: 405, message: "This endpoint only accepts POST requests." };
  }
  const contentType = request.headers.get("content-type") || "";
  if (!/^application\/json\b/i.test(contentType)) {
    return { status: 403, message: "That request could not be accepted." };
  }
  try {
    verifyRequestOrigin(request);
  } catch (error) {
    // AuthError carries a status and a message written for a developer; the
    // editor gets neither.
    return { status: 403, message: "That request could not be accepted." };
  }
  return null;
}

/* -- the protocol ----------------------------------------------------------- */

/**
 * Decap's proxy protocol.
 *
 * Only these actions exist. The editorial-workflow actions are deliberately
 * absent: the CMS runs `publish_mode: simple`, so an unpublished-entry action
 * arriving here would mean something is misconfigured, not that we should try.
 */
async function run(action, params, ctx) {
  const { repo } = ctx;

  switch (action) {
    case "entriesByFolder": {
      const folder = String(params.folder || "");
      if (!paths.readable(folder).ok) return { error: "unknown folder" };
      const files = await repo.listFolder(folder);
      const wanted = files.filter((f) =>
        !params.extension || f.name.endsWith(`.${params.extension}`));
      const entries = [];
      for (const file of wanted) {
        const found = await repo.readFile(file.path);
        if (found) entries.push({ data: found.text, file: { path: file.path, id: found.sha } });
      }
      return entries;
    }

    case "entriesByFiles": {
      const entries = [];
      for (const item of params.files || []) {
        const repoPath = String((item && item.path) || "");
        if (!paths.readable(repoPath).ok) continue;
        const found = await repo.readFile(repoPath);
        if (found) entries.push({ data: found.text, file: { path: repoPath, id: found.sha } });
      }
      return entries;
    }

    case "getEntry": {
      const repoPath = String(params.path || "");
      if (!paths.readable(repoPath).ok) return { error: "unknown file" };
      const found = await repo.readFile(repoPath);
      if (!found) return { error: "not found" };
      return { data: found.text, file: { path: repoPath, id: found.sha } };
    }

    case "getMedia": {
      const folder = String(params.mediaFolder || "assets");
      const listed = [];
      for (const dir of paths.MEDIA) {
        if (folder !== "assets" && !dir.startsWith(folder.replace(/^\//, ""))) continue;
        for (const file of await repo.listFolder(dir)) {
          listed.push({ id: file.sha, name: file.name, path: `/${file.path}`,
            content: "", encoding: "base64", size: file.size });
        }
      }
      return listed;
    }

    case "getMediaFile": {
      const repoPath = String(params.path || "").replace(/^\//, "");
      if (!paths.classify(repoPath).ok) return { error: "unknown file" };
      const found = await repo.readBytes(repoPath);
      if (!found) return { error: "not found" };
      return { id: found.sha, name: repoPath.split("/").pop(), path: `/${repoPath}`,
        content: found.bytes.toString("base64"), encoding: "base64", size: found.size };
    }

    case "persistEntry":
      return persistEntry(params, ctx);

    case "persistMedia":
      return persistMedia(params, ctx);

    case "deleteFiles": {
      const targets = (params.paths || []).map((p) => String(p).replace(/^\//, ""));
      const result = await repo.commit(
        targets.map((path) => ({ path, delete: true })),
        commitMessage("deleted", targets.length === 1
          ? targets[0].split("/").pop().replace(/\.yaml$/, "") : `${targets.length} records`,
        ctx.user),
        commitAuthor(ctx.user));
      return { commit: result.commit };
    }

    /*
      Deploy previews are a Netlify concept this function has no privileged way
      to look up, and inventing one would mean giving the browser a Netlify
      token. Decap treats an empty answer as "no preview", which is the truth.
    */
    case "getDeployPreview":
      return null;

    default:
      return { error: "unsupported action" };
  }
}

/* -- writing ---------------------------------------------------------------- */

/*
  The commit is ATTRIBUTED TO THE EDITOR, using the identity Netlify verified.
  The App remains the committer because it holds the credential — both names
  appear in `git log`, and neither comes from the request body.
*/
const commitAuthor = (user) => ({ name: user.name || user.email, email: user.email });

const commitMessage = (verb, subject, user) =>
  `CMS: ${user.name || user.email} ${verb} ${subject}\n\n` +
  `CMS-Actor: ${user.email}\n` +
  `CMS-Actor-Id: ${user.id}`;

/**
 * One record and its images, in one commit.
 *
 * Decap hands over the data files and every asset the entry references. They
 * are validated together and committed together: a record must never reach the
 * repository naming a photograph that is not in the same commit.
 */
async function persistEntry(params, ctx) {
  const { repo, user } = ctx;
  const dataFiles = params.dataFiles || [];
  const assets = params.assets || [];
  if (!dataFiles.length) return { error: "nothing to save" };

  const changes = [];
  let subject = "a record";

  for (const file of dataFiles) {
    const repoPath = String(file.path || "").replace(/^\//, "");
    const verdict = paths.classify(repoPath);
    if (!verdict.ok || verdict.kind !== "content") {
      return { error: "That is not something the content manager can change." };
    }
    if (verdict.adminOnly && !user.isAdmin) {
      return { error: "Only an administrator can change the site settings." };
    }

    /*
      SERVER-SIDE CONTENT VALIDATION. Decap validates in the browser, and the
      browser is not where a rule is enforced. The same shared helpers the local
      CMS and the build use are applied here, so a record that would break the
      site cannot be committed even by a caller that skipped the form.
    */
    const problem = rules.check(repoPath, file.raw, verdict.folder);
    if (problem) return { error: problem };

    subject = describe(repoPath, file.raw);
    changes.push({ path: repoPath, content: file.raw });
  }

  for (const asset of assets) {
    const repoPath = String(asset.path || "").replace(/^\//, "");
    // Folder first, then the rebuilt name, then the whole path — the name the
    // browser offered is not the name that gets written.
    const folder = paths.mediaFolderOf(repoPath);
    if (!folder) return { error: "That image cannot be saved there." };

    const bytes = Buffer.from(String(asset.content || ""), "base64");
    const checked = media.check(repoPath.split("/").pop(), bytes);
    if (!checked.ok) return { error: mediaMessage(checked) };

    const finalPath = `${folder}/${checked.filename}`;
    const verdict = paths.classify(finalPath);
    if (!verdict.ok || verdict.kind !== "media") {
      return { error: "That image cannot be saved there." };
    }
    changes.push({ path: finalPath, content: asset.content, encoding: "base64" });
  }

  const result = await repo.commit(changes,
    commitMessage("updated", subject, user), commitAuthor(user));
  return { commit: result.commit };
}

async function persistMedia(params, ctx) {
  const { repo, user } = ctx;
  const asset = params.asset || {};
  const repoPath = String(asset.path || "").replace(/^\//, "");

  const folder = paths.mediaFolderOf(repoPath);
  if (!folder) return { error: "That image cannot be saved there." };

  const bytes = Buffer.from(String(asset.content || ""), "base64");
  const checked = media.check(repoPath.split("/").pop(), bytes);
  if (!checked.ok) return { error: mediaMessage(checked) };

  const finalPath = `${folder}/${checked.filename}`;
  const verdict = paths.classify(finalPath);
  if (!verdict.ok || verdict.kind !== "media") {
    return { error: "That image cannot be saved there." };
  }

  await repo.commit(
    [{ path: finalPath, content: asset.content, encoding: "base64" }],
    commitMessage("uploaded", checked.filename, user), commitAuthor(user));

  const saved = await repo.readBytes(finalPath);
  return { id: saved ? saved.sha : finalPath, name: checked.filename,
    path: `/${finalPath}`, content: asset.content, encoding: "base64", size: bytes.length };
}

function mediaMessage(checked) {
  switch (checked.code) {
    case "too_large":
      return `That image is too large (${checked.detail}). Please use one under 8 MB.`;
    case "unsupported_type":
      return "Only JPEG, PNG, WebP and GIF images can be uploaded.";
    case "content_mismatch":
      return "That file is not the kind of image its name says it is.";
    case "no_extension":
    case "unusable_name":
      return "Please give the image a normal filename ending in .jpg or .png.";
    default:
      return "That image could not be uploaded.";
  }
}

/** A human subject line for the commit message. */
function describe(repoPath, raw) {
  const id = repoPath.split("/").pop().replace(/\.yaml$/, "");
  let record;
  try {
    record = yaml.load(raw) || {};
  } catch (err) {
    return id;
  }
  const en = record.en || {};
  const title = record.name || en.title ||
    [en.title_lead, en.title_fancy, en.title_tail].filter(Boolean).join(" ") || id;
  const kind = repoPath.startsWith("content/team") ? "team member"
    : repoPath.startsWith("content/announcements") ? "announcement"
      : repoPath.startsWith("content/events") ? "event" : "record";
  return `${kind} "${title}"`;
}

/* -- entry point ------------------------------------------------------------ */

/**
 * @param {Request} request
 * @param {object} context   Netlify's function context
 * @param {object} [injected] test seam — never supplied by the runtime, which
 *                            passes exactly two arguments
 */
export default async function handler(request, context, injected) {
  const deps = injected || {};

  const bad = requestProblem(request);
  if (bad) return fail(bad.status, bad.message);

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return fail(400, "That request could not be understood.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(400, "That request could not be understood.");
  }

  /*
    WHO IS ASKING.

    `getUser()` first, because where Netlify populates the ambient context it is
    the right answer. It takes no arguments, though, so where the runtime does
    NOT populate that context it returns null however good the session is — and
    the request's own `nf_jwt` cookie goes unread. lib/session.js falls back to
    that cookie and asks Identity about it.

    Nothing in the body is consulted either way: a `roles`, `email` or `user`
    field posted by a browser is a claim, not a fact.
  */
  const account = await session.resolve(request, {
    getUser: deps.getUser || getUser,
    fetch: deps.fetch,
    env: process.env,
  });
  const user = account ? authz.permissions(account) : null;

  const action = String(body.action || "");
  const params = (body.params && typeof body.params === "object") ? body.params : {};

  // Everything a write would touch, gathered before the write is considered.
  // Media is represented by its folder: the filename is rebuilt during the
  // write, so the path this pass can see is not the path that will be committed.
  const asMedia = (p) => {
    const asPath = String(p || "").replace(/^\//, "");
    const folder = paths.mediaFolderOf(asPath);
    return folder ? `${folder}/placeholder.png` : asPath;
  };
  const touched = [
    ...(params.dataFiles || []).map((f) => String((f || {}).path || "").replace(/^\//, "")),
    ...(params.assets || []).map((a) => asMedia((a || {}).path)),
    ...(params.asset ? [asMedia(params.asset.path)] : []),
    ...(params.paths || []).map((p) => String(p).replace(/^\//, "")),
  ].filter(Boolean);

  const refusal = authz.refuse(user, action, touched);
  if (refusal) return fail(refusal.status, refusal.message);

  const built = deps.repo
    ? { repo: deps.repo }
    : github.fromEnvironment(process.env, deps.fetch);
  if (built.missing) {
    console.error("cms function is not configured:", built.missing.join(", "));
    return fail(503, "The content manager is not fully set up yet. " +
      "Please tell an administrator.");
  }

  try {
    const result = await run(action, params, { repo: built.repo, user });
    if (result && result.error) return fail(400, result.error);
    return reply(200, result === undefined ? null : result);
  } catch (err) {
    if (err && err.name === "GitHubError") {
      // Already written for a person; carries no token or path detail.
      return fail(err.status === 409 ? 409 : 502, err.message);
    }
    /*
      Anything else stays in the function log. An editor gets a sentence; a
      stack trace could name a path, and an upstream body could echo a token.
    */
    console.error("cms function failed:", err && err.stack ? err.stack : err);
    return fail(500, "Something went wrong. Your changes were not saved.");
  }
}

/* Exported for the tests, which exercise these directly. */
export { run, requestProblem, describe, commitMessage, JSON_HEADERS };
