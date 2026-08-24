/**
 * bulk.mjs — Bulk manage in production.
 *
 * A MODERN (v2) NETLIFY FUNCTION, for the same reason as cms.mjs: `getUser()`
 * from @netlify/identity reads the request context the v2 runtime provides and
 * is unsupported in a v1 Lambda-compatible handler.
 *
 * Answers the SAME four paths the local server answers, so the screen built in
 * Phase 17C.5B needs no change at all: /api/bulk/list, /update, /delete and
 * /dependencies. Locally those are served by scripts/cms-server.js against
 * files; here by this function against the repository.
 *
 * ROLES ARE ENFORCED HERE, NOT IN THE SCREEN.
 *
 * The screen hides Delete from an editor, which is the right thing to show. It
 * is not the reason an editor cannot delete: an editor calling this endpoint by
 * hand gets 403 and nothing is committed. The edge role rule on /admin/ does
 * not help either — this endpoint is not under /admin/.
 */

import { getUser } from "@netlify/identity";

import github from "../lib/github.js";
import store from "../lib/github-store.js";
import rules from "../lib/rules.js";
import authz from "../lib/authz.js";
import messages from "../../scripts/bulk/messages.js";

import cms from "../functions/cms.mjs";
import { requestProblem } from "../functions/cms.mjs";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

const reply = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/*
  The same wording the local server uses. scripts/bulk/messages.js owns these
  sentences so an editor does not learn one phrasing at their desk and a
  different one online.
*/
const { explain } = messages;

/**
 * Which of the four routes is this?
 *
 * v2 gives a whole `Request`, so the path comes from its URL rather than from
 * an `event.path` string. Netlify rewrites /api/bulk/* to this function while
 * KEEPING the original path, which is what makes one function able to serve
 * four routes.
 */
function routeOf(request) {
  const { pathname } = new URL(request.url);
  const match = /\/api\/bulk\/([a-z]+)$/.exec(pathname);
  return match ? match[1] : null;
}

/**
 * @param {Request} request
 * @param {object} context
 * @param {object} [injected] test seam — the runtime passes two arguments
 */
export default async function handler(request, context, injected) {
  const deps = injected || {};

  // POST-only, JSON-only, same-origin — shared with cms.mjs so the two cannot
  // drift into different ideas of what a safe request looks like.
  const bad = requestProblem(request);
  if (bad) {
    return reply(bad.status, { error: { code: "invalid_request" },
      message: { title: "That request could not be accepted.",
        detail: "Nothing was changed." } });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return reply(400, { error: { code: "invalid_request" },
      message: explain({ code: "invalid_request" }) });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reply(400, { error: { code: "invalid_request" },
      message: explain({ code: "invalid_request" }) });
  }

  /*
    Netlify's own answer to "who is asking". Nothing in the body is consulted.
  */
  const account = await (deps.getUser || getUser)();
  const user = account ? authz.permissions(account) : null;

  if (!user) {
    return reply(401, { error: { code: "unauthenticated" },
      message: { title: "Your session has expired.", detail: "Please sign in again." } });
  }
  if (!user.isEditor) {
    return reply(403, { error: { code: "forbidden" },
      message: { title: "This account is not authorised to use the content manager.",
        detail: "Nothing was changed." } });
  }

  const built = deps.repo ? { repo: deps.repo } : github.fromEnvironment(process.env, deps.fetch);
  if (built.missing) {
    console.error("bulk function is not configured:", built.missing.join(", "));
    return reply(503, { error: { code: "unconfigured" },
      message: { title: "The content manager is not fully set up yet.",
        detail: "Please tell an administrator." } });
  }
  const repo = built.repo;

  try {
    switch (routeOf(request)) {
      case "list": {
        const result = await store.listRecords(repo, body.collection);
        if (result.error) return refuse(result.error);
        return reply(200, {
          collection: body.collection,
          currentAcademicYear: rules.currentAcademicYear(),
          records: result.records,
          // The screen uses this to decide whether to offer Delete at all.
          canDelete: user.isAdmin,
        });
      }

      case "update": {
        const result = await store.updateRecords(
          repo, body.collection, body.operation, body.items, user);
        if (result.error) return refuse(result.error);
        return reply(200, { changed: result.changed });
      }

      case "delete": {
        /*
          THE ONE ADMIN-ONLY OPERATION. Checked before the selection is even
          resolved, so an unauthorised caller learns nothing about what exists.

          Asked of the same helper the CMS function uses, so "who may delete" has
          one definition rather than two.
        */
        const refusal = authz.refuse(user, "deleteFiles", []);
        if (refusal) {
          return reply(refusal.status, { error: { code: "forbidden" },
            message: { title: refusal.message,
              detail: "Nothing was changed. Ask an administrator." } });
        }
        const result = await store.deleteRecords(repo, body.collection, body.items, user);
        if (result.error) return refuse(result.error);
        return reply(200, { deleted: result.deleted });
      }

      case "dependencies": {
        if (body.collection !== "standard-events") return reply(200, { dependents: [] });
        const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string") : [];
        const found = await store.dependentsOfEvents(repo, ids);
        return reply(200, { dependents: [...found.entries()]
          .map(([id, users]) => ({ id, dependents: users })) });
      }

      default:
        return reply(404, { error: { code: "invalid_request" },
          message: explain({ code: "invalid_request" }) });
    }
  } catch (err) {
    if (err && err.name === "GitHubError") {
      return reply(err.status === 409 ? 409 : 502, { error: { code: "conflict" },
        message: { title: "Nothing was changed.",
          detail: `${err.message}. Refresh Bulk manage and try again.` } });
    }
    console.error("bulk function failed:", err && err.stack ? err.stack : err);
    return reply(500, { error: { code: "internal" },
      message: { title: "Something went wrong.", detail: "Nothing was changed." } });
  }
}

function refuse(error) {
  const status = error.code === "stale" ? 409
    : error.code === "has_dependents" || error.code === "future_year" ? 422
      : error.code === "unknown_record" ? 404 : 400;
  return reply(status, { error, message: explain(error) });
}

export { routeOf };
