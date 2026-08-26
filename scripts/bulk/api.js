/**
 * api.js — the Bulk Manage request handler.
 *
 * Mounted by scripts/cms-server.js under /api/bulk/, so it shares an origin
 * with /admin/ and needs no CORS of its own. It is bound to 127.0.0.1 with the
 * rest of that server: it can write to the repository, and none of that should
 * be offered to the local network.
 *
 * THE TRUST BOUNDARY
 *
 * A request names a collection, an operation and a list of record IDs with the
 * revisions the screen was showing. It never names a file, a folder or a path,
 * and there is nothing here that would accept one — the folder comes from the
 * allow-list in collections.js and the filename is built from an ID that has
 * already been matched against a strict pattern. No YAML is accepted from the
 * browser either: the operation is a word from a fixed set, and the server
 * decides what that word does to a record.
 *
 * There is no shell execution anywhere in this feature.
 *
 * ERRORS ARE STRUCTURED
 *
 * Each failure carries a code and the records it concerns, so the screen can
 * say "Icebreaker has been edited since this list was loaded" instead of
 * showing a stack trace. Technical detail stays in the server log.
 */

"use strict";

const store = require("./local-store.js");
const { collectionList, collectionFor } = require("./collections.js");
// The refusal wording, shared with the production function. See messages.js.
const { explain } = require("./messages.js");

/** Requests are small by nature: a few dozen IDs. Anything larger is refused. */
const MAX_BODY_BYTES = 256 * 1024;

const send = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
};

/** Read a JSON body, refusing anything oversized or malformed. */
function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let stopped = false;
    req.on("data", (chunk) => {
      if (stopped) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        stopped = true;
        resolve({ error: { code: "too_large" } });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (stopped) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          resolve({ error: { code: "invalid_request" } });
          return;
        }
        resolve({ value });
      } catch (err) {
        resolve({ error: { code: "invalid_request" } });
      }
    });
    req.on("error", () => { if (!stopped) resolve({ error: { code: "invalid_request" } }); });
  });
}

/* -- routes ----------------------------------------------------------------- */

const ROUTES = {
  "/api/bulk/collections": () => ({ collections: collectionList() }),

  "/api/bulk/list": (body) => {
    const result = store.listRecords(body.collection);
    if (result.error) return { error: result.error };
    return {
      collection: body.collection,
      currentAcademicYear: store.readCurrentAcademicYear(),
      records: result.records,
    };
  },

  "/api/bulk/update": (body) => {
    const result = store.updateRecords(body.collection, body.operation, body.items);
    if (result.error) return { error: result.error };
    return { changed: result.changed };
  },

  "/api/bulk/delete": (body) => {
    const result = store.deleteRecords(body.collection, body.items);
    if (result.error) return { error: result.error };
    return { deleted: result.deleted };
  },

  /*
    Asked before the confirmation dialog opens, so an editor is told what blocks
    a deletion BEFORE they read a warning about permanence. The delete route
    checks again against the files at that moment; this one is for the wording.
  */
  "/api/bulk/dependencies": (body) => {
    const collection = collectionFor(body.collection);
    if (!collection) return { error: { code: "unknown_collection" } };
    if (collection.key !== "standard-events") return { dependents: [] };
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id) => store.usableId(id)) : [];
    const found = store.dependentsOfEvents(ids);
    return { dependents: [...found.entries()].map(([id, users]) => ({ id, dependents: users })) };
  },
};

/** Does this request belong to Bulk Manage? */
function handles(pathname) {
  return Object.prototype.hasOwnProperty.call(ROUTES, pathname);
}

async function handle(req, res, pathname) {
  if (req.method !== "POST") {
    return send(res, 405, { error: { code: "invalid_request" },
      message: explain({ code: "invalid_request" }) });
  }
  const body = await readJson(req);
  if (body.error) {
    return send(res, 400, { error: body.error, message: explain(body.error) });
  }

  let result;
  try {
    result = ROUTES[pathname](body.value);
  } catch (err) {
    // An unexpected fault must not reach the editor as a stack trace, and must
    // not look like a successful operation either.
    console.error("  bulk api:", pathname, err && err.stack ? err.stack : err);
    return send(res, 500, { error: { code: "internal" },
      message: { title: "Something went wrong.", detail: "Nothing was changed." } });
  }

  if (result.error) {
    const status = result.error.code === "stale" ? 409
      : result.error.code === "has_dependents" || result.error.code === "future_year" ? 422
        : result.error.code === "unknown_record" ? 404 : 400;
    return send(res, status, { error: result.error, message: explain(result.error) });
  }
  return send(res, 200, result);
}

module.exports = { handles, handle, explain, MAX_BODY_BYTES };
