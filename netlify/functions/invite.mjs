/**
 * invite.mjs — let a superadmin invite somebody, on Netlify's free plan.
 *
 * WHY THIS EXISTS
 *
 * Netlify's own "Invite users" e-mail links to the site with an opaque token.
 * Nothing in it says who the invitation is for, so the login page cannot show
 * the person's address — and changing that e-mail needs a Pro plan.
 *
 * So this does the two free things instead:
 *
 *   1. creates the account, confirmed, with the chosen role — Identity's admin
 *      API, which every plan has;
 *   2. asks Identity to send its standard password e-mail to that address —
 *      the same "Forgot password" e-mail anybody can request.
 *
 * The link in that e-mail signs the person in first, so /staff-login/ knows
 * exactly who they are: it shows their address and asks for a password twice.
 *
 * WHO MAY USE IT: ONLY A SUPERADMIN.
 *
 * Checked here, on every request, from the verified session — never from
 * anything the browser sends. The invite screen hides itself from everybody
 * else, but that is presentation; an editor or admin calling this endpoint by
 * hand gets 403 and nothing is created.
 *
 * EVERYBODY INVITED HERE IS AN ADMIN, from the moment the account exists: the
 * role is written when the account is created, so their first sign-in already
 * carries it and nobody has to add a role in the dashboard afterwards. There
 * is no choice to make, so the screen offers none, and any `role` a browser
 * sends is ignored. Superadmin is never granted here: that role is given only
 * in the Netlify dashboard, so one compromised superadmin session cannot mint
 * more of them.
 *
 * THE TEMPORARY PASSWORD
 *
 * Identity's admin API will not create an account without one. It is 32 random
 * bytes, generated here, used once in the create call, and then forgotten: never
 * returned, never logged, never stored. Nobody ever knows it; the person sets
 * their own from the e-mail.
 *
 * WHAT IS NOT ASSUMED
 *
 * The admin API needs an operator token that Netlify supplies to functions. If
 * it is missing, this says so plainly and creates nothing, rather than
 * pretending — the dashboard's own "Invite users" still works in that case.
 */

import { getUser, admin } from "@netlify/identity";
import { randomBytes } from "node:crypto";

import session from "../lib/session.js";
import authz from "../lib/authz.js";

import { requestProblem, JSON_HEADERS } from "../functions/cms.mjs";

const RECOVER_PATH = "/.netlify/identity/recover";
/** The one role an invitation gives. Superadmin itself is dashboard-only. */
const INVITED_ROLE = "admin";
const GRANTABLE = [INVITED_ROLE];
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

const reply = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const say = (status, code, title, detail, extra) =>
  reply(status, Object.assign({ error: code ? { code } : undefined, message: { title, detail } }, extra || {}));

/** A plain address, or "" when it is not one. Lower-case: Identity is. */
function cleanEmail(value) {
  const email = String(value == null ? "" : value).trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : "";
}

/** A display name: printable, single-line, at most 100 characters. */
function cleanName(value) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

/** Ask Identity to send its standard "choose a password" e-mail. */
async function sendPasswordEmail(email, origin, fetchImpl) {
  const call = fetchImpl || globalThis.fetch;
  const response = await call(`${origin}${RECOVER_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return Boolean(response && response.ok);
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
  if (bad) return say(bad.status, "invalid_request", "That request could not be accepted.", "Nobody was invited.");

  let body;
  try {
    body = await request.json();
  } catch (err) {
    body = null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return say(400, "invalid_request", "That request could not be accepted.", "Nobody was invited.");
  }

  // Who is asking — from the verified session only. See netlify/lib/session.js.
  const account = await session.resolve(request, {
    getUser: deps.getUser || getUser,
    fetch: deps.fetch,
    env,
  });
  const user = account ? authz.permissions(account) : null;

  // The screen asks this first, to decide whether to show the form at all.
  if (body.check === true) {
    return reply(user ? 200 : 401, { canInvite: Boolean(user && user.isSuperadmin), grantable: GRANTABLE });
  }

  if (!user) {
    return say(401, "unauthenticated", "Your session has expired.", "Please sign in again.");
  }
  if (!user.isSuperadmin) {
    return say(403, "forbidden", "Only a superadmin can invite people.", "Nobody was invited.");
  }

  const email = cleanEmail(body.email);
  if (!email) {
    return say(400, "bad_email", "That is not an e-mail address.", "Check it and try again.");
  }
  const origin = session.identityOrigin(request, env);
  if (!origin) {
    return say(503, "unconfigured", "The invite service is not set up yet.", "Please tell whoever looks after the website.");
  }

  const sendEmail = deps.sendPasswordEmail || ((address) => sendPasswordEmail(address, origin, deps.fetch));

  /*
    RESEND. For an account that already exists — the first e-mail went to spam,
    or expired. Sends the same e-mail again and changes nothing about the account.
  */
  if (body.resend === true) {
    let sent = false;
    try { sent = await sendEmail(email); } catch (err) { sent = false; }
    return sent
      ? reply(200, { email, resent: true })
      : say(502, "email_failed", "The e-mail could not be sent.", "Wait a minute and try again. Netlify limits how often it sends these.");
  }

  // Fixed, never read from the request.
  const role = INVITED_ROLE;
  const name = cleanName(body.name);

  const identityAdmin = deps.admin || admin;
  const appMetadata = {
    provider: "email",
    roles: [role],
    invited_by: user.email,
    invited_at: new Date().toISOString(),
  };
  // `fed_welcome` lets the login page greet a new person rather than talk
  // about "resetting" a password they never had. Cleared when they choose one.
  const userMetadata = Object.assign({ fed_welcome: true }, name ? { full_name: name } : {});
  let created;
  try {
    created = await identityAdmin.createUser({
      email,
      password: randomBytes(32).toString("base64url"),
      data: { app_metadata: appMetadata, user_metadata: userMetadata },
    });
  } catch (err) {
    const status = err && err.status; // AuthError carries the HTTP status here
    const text = String((err && err.message) || "");
    if (status === 422 || /already/i.test(text)) {
      return say(409, "exists", "This address already has an account.",
        "Use \u201cSend the e-mail again\u201d if they need a new link.", { email });
    }
    if (/operator token/i.test(text)) {
      console.error("invite: Netlify did not provide an Identity operator token to this function");
      return say(503, "no_operator_token", "Netlify did not allow this site to create accounts.",
        "Invite them from the Netlify dashboard instead (Identity \u2192 Invite users), then give them a role.");
    }
    // The message may describe the request; it never contains the password.
    console.error("invite: creating the account failed:", status || "", text.slice(0, 200));
    return say(502, "create_failed", "The account could not be created.", "Nobody was invited. Please try again.");
  }

  /*
    THE ROLE, MADE CERTAIN.

    Netlify's Identity accepted the metadata on the create call but did not
    store the role: invited people appeared in the dashboard with no role, so
    they could not open the CMS. Setting app_metadata with an update of the
    new account is the established way to give a role from a function, so it
    is done here whenever the created account does not already show the role
    — and the answer is read back and checked.

    If the role still cannot be given, the account is deleted again rather
    than left behind half-made: an account with no role can sign in to
    nothing, and it would block a second attempt with "already has an
    account". Nothing is e-mailed in that case.
  */
  const hasRole = (account) => Boolean(account && Array.isArray(account.roles) && account.roles.includes(role));
  if (!hasRole(created)) {
    let updated = null;
    try {
      updated = created && created.id
        ? await identityAdmin.updateUser(created.id, { app_metadata: appMetadata, user_metadata: userMetadata })
        : null;
    } catch (err) {
      console.error("invite: giving the role failed:", String((err && err.message) || "").slice(0, 200));
      updated = null;
    }
    if (!hasRole(updated)) {
      try {
        if (created && created.id) await identityAdmin.deleteUser(created.id);
      } catch (err) {
        console.error("invite: removing the account without a role failed:", String((err && err.message) || "").slice(0, 200));
        return say(502, "role_failed", "The account was created, but it could not be made an administrator.",
          "Open it in Netlify → Identity and add the role admin, or delete it and try again.", { email });
      }
      return say(502, "role_failed", "The account could not be made an administrator.",
        "Nobody was invited. Please try again.");
    }
  }

  let sent = false;
  try { sent = await sendEmail(email); } catch (err) { sent = false; }
  if (!sent) {
    // The account exists; only the e-mail is missing. Say exactly that.
    return say(502, "email_failed", "The account was created, but the e-mail could not be sent.",
      "Use \u201cSend the e-mail again\u201d in a minute.", { email, created: true });
  }
  return reply(200, { email, role, created: true, sent: true });
}

export { cleanEmail, cleanName, GRANTABLE };
