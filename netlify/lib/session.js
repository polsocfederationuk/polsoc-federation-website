/**
 * session.js — who is asking, resolved from the request actually in hand.
 *
 * WHY THIS EXISTS
 *
 * `getUser()` from @netlify/identity takes NO ARGUMENTS. It cannot be handed a
 * request; it finds the session in ambient state — `globalThis.netlifyIdentityContext`,
 * or `globalThis.Netlify.context.cookies`. Where the runtime populates that, it
 * is exactly the right thing to call, and this file calls it first.
 *
 * Where the runtime does NOT populate it, `getUser()` returns null however good
 * the session is. The browser sends `nf_jwt` faithfully — path=/, host-only,
 * Secure over https, SameSite=Lax on a same-origin POST, so it is sent — and the
 * function never looks at it, because nothing ever gave the library the request.
 * Every call then answers 401 to a perfectly valid editor, silently, with
 * nothing in the log to say why. That is what happened in production, and it is
 * what this file fixes.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not decode the JWT, and it does not trust anything it might read from
 * one. A token is an opaque string here. The only thing that turns it into a
 * user is Netlify Identity's own `/user` endpoint, asked over the network with
 * the token as a bearer credential — byte for byte what the library does
 * internally, and what this project's pre-v2 code did before the migration
 * replaced it with an ambient lookup that this runtime does not support.
 *
 * That matters for authorisation: roles come back from Identity, which is the
 * only party that can say what they are. A `roles` claim decoded locally out of
 * an unverified token would be a claim about what somebody wants to be.
 *
 * The token is never logged, never persisted, never returned to a caller, and
 * never sent anywhere except this site's own Identity endpoint.
 */

"use strict";

const NF_JWT = "nf_jwt";
const IDENTITY_USER_PATH = "/.netlify/identity/user";

/**
 * One cookie's value from a request, or null.
 *
 * The Identity client writes its cookies with `encodeURIComponent`, so they are
 * decoded on the way back out. A JWT survives that round trip unchanged — it is
 * base64url and dots — but decoding is what the writer's contract asks for, and
 * assuming otherwise would break the first time a value contained anything else.
 */
function cookieValue(request, name) {
  const header = request && request.headers && request.headers.get("cookie");
  if (!header) return null;
  for (const part of String(header).split(";")) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    if (part.slice(0, at).trim() !== name) continue;
    const raw = part.slice(at + 1).trim();
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch (err) {
      return raw;
    }
  }
  return null;
}

/**
 * Where this site's Identity service lives.
 *
 * `env.URL` FIRST, DELIBERATELY. Netlify sets it to the site's own address, and
 * it cannot be influenced by the request. `request.url` is derived from the
 * incoming Host header, so preferring it would let a forged Host decide where a
 * session token gets sent — the one thing that must never be steerable from
 * outside. The request is the fallback only so that local development, where
 * there is no env.URL, still works.
 */
function identityOrigin(request, env) {
  const configured = (env || {}).URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch (err) {
      /* falls through to the request */
    }
  }
  try {
    return new URL(request.url).origin;
  } catch (err) {
    return null;
  }
}

/**
 * Identity's answer, in the shape authz.js expects.
 *
 * `roles` is lifted out of `app_metadata` exactly as the library's own `toUser`
 * does, so a user resolved here and a user resolved by `getUser()` are the same
 * shape and authz cannot tell them apart.
 */
function toUser(data) {
  if (!data || typeof data !== "object" || !data.id) return null;
  const appMeta = data.app_metadata || {};
  const userMeta = data.user_metadata || {};
  const roles = Array.isArray(appMeta.roles)
    && appMeta.roles.every((r) => typeof r === "string")
    ? appMeta.roles
    : [];
  const name = userMeta.full_name || userMeta.name;
  return {
    id: data.id,
    email: data.email || "",
    name: typeof name === "string" ? name : (data.email || ""),
    roles,
  };
}

/**
 * Ask Identity who a token belongs to.
 *
 * A refusal — expired, revoked, forged, or simply not ours — is a null, which
 * the caller turns into 401. Nothing is retried and nothing is cached: a session
 * that Identity has just ended must stop working immediately, not at the end of
 * some window we invented.
 */
async function identityUser(token, origin, fetchImpl) {
  if (!token || !origin) return null;
  const call = fetchImpl || globalThis.fetch;
  if (typeof call !== "function") return null;
  try {
    const response = await call(`${origin}${IDENTITY_USER_PATH}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response || !response.ok) return null;
    return toUser(await response.json());
  } catch (err) {
    /*
      A network failure is not an authorisation. Deliberately no logging: the
      only thing worth saying is "not signed in", and the caller says it. An
      error object from a request carrying a bearer token is exactly the kind of
      thing that ends up echoing the token into a log.
    */
    return null;
  }
}

/**
 * The signed-in user, or null.
 *
 * @param {Request} request  the v2 function's own request
 * @param {object} [options]
 * @param {Function} [options.getUser]  the ambient lookup, tried first
 * @param {Function} [options.fetch]    transport for the Identity call
 * @param {object}   [options.env]      where to find this site's own address
 */
async function resolve(request, options) {
  const { getUser, fetch: fetchImpl, env } = options || {};

  // 1. Netlify's own answer, wherever the runtime provides one.
  if (typeof getUser === "function") {
    try {
      const ambient = await getUser();
      if (ambient) return ambient;
    } catch (err) {
      /* An ambient lookup that throws is an absent one; the cookie is next. */
    }
  }

  // 2. The request we were actually given.
  const token = cookieValue(request, NF_JWT);
  if (!token) return null;

  return identityUser(token, identityOrigin(request, env), fetchImpl);
}

module.exports = { resolve, cookieValue, identityOrigin, toUser, NF_JWT, IDENTITY_USER_PATH };
