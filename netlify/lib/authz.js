/**
 * authz.js — what a signed-in person is allowed to do.
 *
 * AUTHENTICATION IS NOT HERE ANY MORE.
 *
 * This file used to be identity.js, and it verified the session itself: it
 * pulled `nf_jwt` out of the Cookie header and handed it back to Netlify
 * Identity's `/user` endpoint. That was correct — verification was always
 * delegated to the provider, and no signing secret ever lived here — but it was
 * a bespoke wrapper around something Netlify now ships.
 *
 * The functions call `getUser()` from @netlify/identity instead. It reads the
 * request context the v2 runtime provides, asks Identity, and returns a
 * normalised user with `roles` already lifted out of `app_metadata`. There is
 * exactly one way to find out who is asking, and it is Netlify's.
 *
 * What is left here is the part that was never Netlify's business: which of
 * this Federation's operations each role may perform.
 *
 * ROLES COME FROM THE VERIFIED USER, NEVER FROM THE REQUEST. Nothing in this
 * file reads a body, a header or a query string. A `roles` field posted by a
 * browser is data about what somebody claims, not about what they are.
 */

"use strict";

const paths = require("./paths.js");

const ROLES = { EDITOR: "editor", ADMIN: "admin" };

/** Only an admin may permanently remove a record. */
const ADMIN_ONLY_ACTIONS = new Set(["deleteFiles"]);

/**
 * The Federation's view of a user @netlify/identity has already verified.
 *
 * @param {object|null} user  the value getUser() returned
 */
function permissions(user) {
  const roles = ((user && user.roles) || []).map((r) => String(r).toLowerCase());
  return {
    id: (user && user.id) || "",
    email: (user && user.email) || "",
    name: (user && (user.name || user.email)) || "",
    roles,
    isEditor: roles.includes(ROLES.EDITOR) || roles.includes(ROLES.ADMIN),
    isAdmin: roles.includes(ROLES.ADMIN),
  };
}

/**
 * May this user perform this action on these paths? Null when they may.
 *
 * DEFENCE IN DEPTH. Netlify's edge rule already keeps anybody without a role
 * out of /admin/, and the screens hide what an editor cannot do. Neither is the
 * reason an editor cannot delete: this is. A request that arrives here having
 * skipped both still gets 403 and changes nothing.
 *
 * @returns {{status: number, message: string}|null}
 */
function refuse(user, action, touchedPaths) {
  if (!user) {
    return { status: 401, message: "Your session has expired. Please sign in again." };
  }
  if (!user.isEditor) {
    return { status: 403,
      message: "This account is not authorised to use the content manager." };
  }
  if (ADMIN_ONLY_ACTIONS.has(action) && !user.isAdmin) {
    return { status: 403, message: "You are not authorised to delete records." };
  }
  for (const repoPath of touchedPaths || []) {
    const verdict = paths.classify(repoPath);
    if (!verdict.ok) {
      return { status: 403,
        message: "That is not something the content manager can change." };
    }
    if (verdict.adminOnly && !user.isAdmin) {
      return { status: 403,
        message: "Only an administrator can change the site settings." };
    }
  }
  return null;
}

module.exports = { ROLES, ADMIN_ONLY_ACTIONS, permissions, refuse };
