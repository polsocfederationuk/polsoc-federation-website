/**
 * people.mjs — who has access to the content manager, and changing that.
 *
 * SUPERADMINS ONLY, checked here on every request from the verified session,
 * exactly as invite.mjs does. The People screen (/admin/people/) hides itself
 * from everybody else, but that is presentation; the rule is this file.
 *
 * ACTIONS (POST, JSON body { action, id? })
 *
 *   list     every account: address, name, role, status, last sign-in
 *   disable  take access away. The account and its history stay; its role is
 *            set aside in app_metadata.fed_disabled so it can be given back.
 *   enable   give it back: the role it had, or admin if none was recorded.
 *   delete   remove the account for good.
 *
 * WHAT NOBODY CAN DO FROM HERE
 *
 *   - change their own account (a superadmin cannot lock themselves out);
 *   - change a superadmin's account. That role is given and taken in the
 *     Netlify dashboard only, so one compromised superadmin session cannot
 *     remove the others.
 *
 * STATUS, as the screen shows it
 *
 *   pending   invited but has not chosen a password yet: our own invitations
 *             (fed_welcome still set) or Netlify's (not yet confirmed)
 *   active    has a role and can open the content manager
 *   disabled  access taken away here
 *   no access has no role at all (for example somebody who signed up with
 *             Google but was never given a role)
 *
 * Every change is read back from Identity and checked before it is reported
 * as done, as the invitation's role is.
 */

import { getUser, admin } from "@netlify/identity";

import session from "../lib/session.js";
import authz from "../lib/authz.js";

import { requestProblem, JSON_HEADERS } from "../functions/cms.mjs";

const ACCESS_ROLES = ["editor", "admin", "superadmin"];
const PAGE_SIZE = 100;
const MAX_PAGES = 20; // 2,000 accounts: far beyond a student federation

const reply = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const say = (status, code, title, detail) =>
  reply(status, { error: { code }, message: { title, detail } });

const rolesOf = (u) => (Array.isArray(u && u.roles) ? u.roles.map(String) : []);
const metaOf = (u) => (u && u.appMetadata && typeof u.appMetadata === "object" ? u.appMetadata : {});

function statusOf(u) {
  const roles = rolesOf(u);
  if (metaOf(u).fed_disabled) return "disabled";
  const welcome = u && u.userMetadata && u.userMetadata.fed_welcome === true;
  if (welcome || !u.confirmedAt) return "pending";
  return roles.some((r) => ACCESS_ROLES.includes(r)) ? "active" : "no_access";
}

function roleOf(u) {
  const roles = rolesOf(u);
  for (const r of ["superadmin", "admin", "editor"]) if (roles.includes(r)) return r;
  const set = metaOf(u).fed_disabled;
  return set && Array.isArray(set.roles) && set.roles[0] ? String(set.roles[0]) : "";
}

// Identity does not always persist its native lastSignInAt. The verified login
// event records a server-owned fallback; user-editable metadata is never read.
function lastSignIn(u) {
  const dates = [u.lastSignInAt, metaOf(u).fed_last_sign_in_at]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => Date.parse(value)).filter(Number.isFinite);
  return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
}

/** What the screen needs, and nothing more (no tokens, no raw metadata). */
function describe(u, me) {
  const disabled = metaOf(u).fed_disabled || null;
  return {
    id: u.id,
    email: u.email || "",
    name: u.name || "",
    role: roleOf(u),
    status: statusOf(u),
    createdAt: u.createdAt || null,
    lastSignInAt: lastSignIn(u),
    invitedBy: metaOf(u).invited_by || null,
    disabledAt: disabled && disabled.at ? disabled.at : null,
    disabledBy: disabled && disabled.by ? disabled.by : null,
    isYou: u.id === me.id,
    locked: u.id === me.id || rolesOf(u).includes("superadmin"),
  };
}

async function everyone(identityAdmin) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await identityAdmin.listUsers({ page, perPage: PAGE_SIZE });
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * @param {Request} request
 * @param {object} context
 * @param {object} [injected] test seam — the runtime passes two arguments
 */
export default async function handler(request, context, injected) {
  const deps = injected || {};
  const env = deps.env || process.env;

  const bad = requestProblem(request);
  if (bad) return say(bad.status, "invalid_request", "That request could not be accepted.", "Nothing was changed.");

  let body;
  try { body = await request.json(); } catch (err) { body = null; }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return say(400, "invalid_request", "That request could not be accepted.", "Nothing was changed.");
  }

  const account = await session.resolve(request, { getUser: deps.getUser || getUser, fetch: deps.fetch, env });
  const me = account ? authz.permissions(account) : null;
  if (!me) return say(401, "unauthenticated", "Your session has expired.", "Please sign in again.");
  if (!me.isSuperadmin) return say(403, "forbidden", "Only a superadmin can manage people.", "Nothing was changed.");

  const identityAdmin = deps.admin || admin;
  const action = String(body.action || "");

  const failed = (err, what) => {
    const text = String((err && err.message) || "");
    if (/operator token/i.test(text)) {
      console.error("people: Netlify did not provide an Identity operator token to this function");
      return say(503, "no_operator_token", "Netlify did not allow this site to manage accounts.",
        "Use the Netlify dashboard instead (Identity).");
    }
    console.error(`people: ${what} failed:`, (err && err.status) || "", text.slice(0, 200));
    return say(502, "identity_failed", "Netlify's account service did not respond as expected.", "Nothing was changed. Please try again.");
  };

  if (action === "list") {
    let users;
    try { users = await everyone(identityAdmin); } catch (err) { return failed(err, "listing accounts"); }
    const people = users.map((u) => describe(u, me))
      .sort((a, b) => a.email.localeCompare(b.email));
    return reply(200, { people });
  }

  if (!["disable", "enable", "delete"].includes(action)) {
    return say(400, "bad_action", "That is not something this screen can do.", "Nothing was changed.");
  }

  const id = String(body.id || "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    return say(400, "bad_id", "That account could not be found.", "Nothing was changed.");
  }
  if (id === me.id) {
    return say(403, "self", "You cannot change your own access here.", "Ask another superadmin, or use the Netlify dashboard.");
  }

  let target;
  try { target = await identityAdmin.getUser(id); } catch (err) {
    if (err && err.status === 404) return say(404, "not_found", "That account no longer exists.", "Refresh the list.");
    return failed(err, "reading the account");
  }
  if (rolesOf(target).includes("superadmin")) {
    return say(403, "superadmin", "Superadmins can only be changed in the Netlify dashboard.", "Nothing was changed.");
  }

  if (action === "delete") {
    try { await identityAdmin.deleteUser(id); } catch (err) { return failed(err, "deleting the account"); }
    return reply(200, { deleted: true, id });
  }

  const current = metaOf(target);
  let changes;
  if (action === "disable") {
    if (current.fed_disabled) return reply(200, { person: describe(target, me) });
    const kept = rolesOf(target).filter((r) => ACCESS_ROLES.includes(r));
    changes = { app_metadata: { roles: [], fed_disabled: { roles: kept, by: me.email, at: new Date().toISOString() } } };
  } else {
    const set = current.fed_disabled;
    const back = set && Array.isArray(set.roles) && set.roles.length
      ? set.roles.filter((r) => r !== "superadmin") : [];
    changes = { app_metadata: { roles: back.length ? back : ["admin"], fed_disabled: null } };
  }

  let updated;
  try { updated = await identityAdmin.updateUser(id, changes); } catch (err) { return failed(err, `${action} (update)`); }

  // Read back: an update Identity did not keep must not be reported as done.
  const ok = action === "disable"
    ? rolesOf(updated).filter((r) => ACCESS_ROLES.includes(r)).length === 0
    : rolesOf(updated).some((r) => ACCESS_ROLES.includes(r));
  if (!ok) {
    console.error(`people: ${action} was not kept by Identity for`, id);
    return say(502, "not_kept", "Netlify did not keep that change.", "Check the account in the Netlify dashboard.");
  }
  return reply(200, { person: describe(updated, me) });
}

export { statusOf, describe };
