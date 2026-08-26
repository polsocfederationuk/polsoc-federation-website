# The online content manager

Phase 17D.1. How the Federation's Marketing team edits the website from a
browser, with individual accounts, and how a save becomes a published page.

The Polish Business Forum editor is **deliberately not part of this**. It stays
outside the CMS for now.

---

## 1. What an editor actually does

```
Sign in at polsocfederation.pl/staff-login/
  ↓
Edit a record in the content manager
  ↓
Publish
  ↓
a commit appears in the repository, attributed to them
  ↓
Netlify rebuilds and deploys
  ↓
the change is on the website
```

No `git pull`, no `git push`, no GitHub account, no Netlify login. They need one
invitation and a password.

**It is not instant, and the CMS does not pretend otherwise.** A save produces a
commit; the site is a static build, so the change appears when the deploy
finishes — usually a minute or two. The message says "The website is rebuilding
and will update automatically", never "live now".

---

## 2. The shape of it

```
      browser                    Netlify                     GitHub
 ┌──────────────────┐
 │ /staff-login/    │──── Netlify Identity ────▶ verifies the account
 └──────────────────┘      (invite only)
          │ nf_jwt cookie
          ▼
 ┌──────────────────┐
 │ /admin/          │◀─── edge role check: editor or admin, or redirected
 │ Decap CMS        │
 └──────────────────┘
          │ POST /api/cms          (same origin — the cookie goes too)
          ▼
 ┌──────────────────────────────────────┐
 │ netlify/functions/cms.mjs             │
 │  1. is this request from our page?    │  origin + JSON + POST
 │  2. who is signed in?                 │  getUser() — Netlify's own answer
 │  3. what is their role?               │  from the provider, not the body
 │  4. may they touch these paths?       │  allow-list
 │  5. do the contents pass the rules?   │  the same shared helpers
 └──────────────────────────────────────┘
          │ GitHub App installation token, minted per invocation
          ▼
   one commit ──▶ Netlify build hook ──▶ deploy
```

---

## 3. Local and production are different builds

| | `npm run cms:dev` | `npm run build:production` |
|---|---|---|
| CMS at | `.cms/admin/` | `dist/admin/` |
| Backend | `http://127.0.0.1:8081` | `/api/cms` |
| Writes | files in your working copy | a commit on `main` |
| Needs | nothing | Identity + a GitHub App |
| Chosen by | the default | `CMS_TARGET=production` |

**Both use Decap's built-in `proxy` backend.** That backend posts
`{branch, action, params}` to one URL and accepts a root-relative one, so the
only difference between the two is which URL. There is no custom backend
adapter — see §5.

`npm run build` still produces a site with **no** admin panel at all. That is
what every test and every local build does, and it is why a stray production
credential in a developer's environment cannot turn a local build into a
publishing one: the mode is one explicit flag, never inferred from whether a
credential happens to exist.

`npm run build:production` reads its own output back before declaring success
and refuses to finish if it finds a local endpoint, a missing admin, or anything
shaped like a credential in `dist/`.

---

## 4. Why not Git Gateway

Netlify documents Git Gateway as deprecated and does not recommend it for new
configurations. Choosing it would have meant adopting a component with no future
on the first day of production.

The alternative that Decap tutorials suggest next — the direct `github` backend —
was rejected for a different reason: it requires **every editor to have a GitHub
account with write access to the repository**. A Marketing officer would then
hold, personally, the ability to change `netlify.toml`, the build scripts and the
deploy configuration. That is a much larger grant than "may edit announcements",
and it outlives their term on the committee.

The server-side adapter here gives an editor exactly what the role says: content,
through an API that will not accept anything else.

---

## 4b. Modern (v2) Functions

Both functions are **v2 Netlify Functions**: ES modules exporting a default
`(request, context)` handler and returning a standard `Response`. They are
`.mjs` because the rest of the repository is CommonJS; the shared libraries
stay CJS and are imported through Node's interop.

That is not a style choice. `getUser()` from `@netlify/identity` — Netlify's
current first-party server API — reads the request context the v2 runtime
provides and is **explicitly unsupported in a v1 Lambda-compatible handler**.
While the functions were v1 they had to verify the session themselves, by
pulling `nf_jwt` out of the Cookie header and handing it back to Identity's
`/user` endpoint. That was correct — verification was always delegated to the
provider and no signing secret ever lived here — but it was a bespoke wrapper
around something Netlify ships. It has been deleted. There is now exactly one
way to find out who is asking.

`netlify/lib/authz.js` is what remains: which of this Federation's operations
each role may perform. It reads no header, body or query string.

### Request security, in three layers

| | Catches |
|---|---|
| POST only | a state-changing GET embedded in an `<img>` or a link |
| JSON content type | a simple cross-site form, which cannot send JSON without a preflight this function never answers |
| `verifyRequestOrigin(request)` | Netlify's own check: Origin present, and matching this site |

The third replaced a hand-written origin comparison and is **stricter** — the
old code fell back to the Referer when no Origin was present; this refuses
outright. The first two are kept because `verifyRequestOrigin` looks at
neither the method nor the content type. No CORS header is returned anywhere,
so a cross-origin caller cannot read a reply even if it provoked one.

---

## 5. The backend, and why there is no custom adapter

Decap 3.15.1 registers widgets, previews, backends, media libraries, locales,
event listeners and custom formats. Its own documentation describes the custom
backend API as not finalised.

We do not use it. Instead:

```yaml
backend:
  name: proxy
  proxy_url: /api/cms
  branch: main
```

`proxy` is a **built-in, pinned, already-tested** backend. Reading its source
(`node_modules/decap-cms-backend-proxy/dist/esm/implementation.js`) shows two
things that make this work:

1. `normalizeProxyUrl` explicitly accepts a root-relative URL.
2. `request()` sets only method, headers and body — so `fetch` uses its default
   `credentials: "same-origin"`, and the session cookie is sent.

So the production backend is the same component as the local one, and the CMS
needs to know nothing about authentication.

The actions it sends are the ones `netlify/functions/cms.mjs` implements:
`entriesByFolder`, `entriesByFiles`, `getEntry`, `getMedia`, `getMediaFile`,
`persistEntry`, `persistMedia`, `deleteFiles`, `getDeployPreview`. The
editorial-workflow actions are deliberately unimplemented — `publish_mode` is
`simple`.

---

## 6. Accounts and roles

**Sign-in providers are discovered, not hard-coded.** The login page asks
Identity which external providers this site actually has enabled
(`getSettings()`) and renders a button for each. Enabling Google in the
Netlify UI makes the button appear with no code change; nothing offers a
provider nobody configured.

**Invite only.** There is no public sign-up, and Netlify Identity is configured
so that self-registration is off. Somebody who authenticates with a Google
account nobody invited gets a session and **no role**, which grants nothing: the
edge sends them back to the login page, and every function refuses them with 403.

Two roles:

| | Editor | Admin |
|---|---|---|
| Open the CMS | ✓ | ✓ |
| Create and edit Team, Announcements, Events | ✓ | ✓ |
| Upload images | ✓ | ✓ |
| Bulk manage: hide and show | ✓ | ✓ |
| Bulk manage: delete permanently | | ✓ |
| Change the current academic year | | ✓ |

**Enforced on the server, not by hiding buttons.** Bulk manage does hide Delete
from an editor, because showing somebody a control they cannot use is unkind —
but an editor calling the delete endpoint by hand gets 403 and nothing is
committed. `npm run test:cms-production` asserts exactly that.

Nobody, including an admin, can change `src/`, `scripts/`, `netlify.toml`,
`package.json` or anything else outside the content folders through the CMS. An
admin is somebody who may delete a record and change the academic year, not
somebody who may edit the build.

---

## 7. Getting in

```
Footer: "Staff login"  →  /staff-login/  →  sign in  →  /admin/
```

`/admin/*` is protected at the edge by a Netlify role rule. Somebody who is not
signed in, or has no role, is redirected to the login page rather than shown a
raw 401.

The login page is deliberately **outside** the protected path: an invitation link
lands there with a token in the URL, and a newly invited person has no role yet.
Behind the gate they would meet an error instead of a password field.

The address of `/admin/` is public and guessable. That is fine. What protects it
is invite-only accounts, assigned roles, and a server-side role check on every
request — not an unguessable URL.

---

## 8. What the server will and will not accept

The browser sends a **collection, a record and an operation**. The server decides
which file that is.

Writeable:

```
content/team/*.yaml
content/announcements/*.yaml
content/events/*.yaml
content/settings/*.yaml          admin only
assets/team/          assets/announcements/          assets/events/
```

Everything else is refused, for every role. A record ID must match
`^[a-z0-9][a-z0-9-]{0,120}$`, which makes `../`, `..\`, `C:\`, `\\server\share`
and a bare `.` **unspellable** rather than merely filtered — and Windows device
names (`nul`, `con`, `com1`…) are refused on top of that, because
`content/team/nul.yaml` opens the null device and swallows a write in silence.

There is no shell, no route that accepts a URL, and no route that accepts a field
name or raw YAML for an arbitrary path.

### Images

Validated by their **first bytes**, not by the type the browser claims. JPEG,
PNG, WebP and GIF; 8 MB; the filename is rebuilt from scratch into the alphabet
the existing assets use rather than sanitised character by character.

**SVG is refused.** It is XML, it can carry script, and the site serves media
from its own origin — an uploaded SVG would be a same-origin script delivery
mechanism. Nothing in Team, Announcements or Events needs one.

---

## 9. One commit per publish

A single Publish can change a record and add two photographs. All of it goes
into **one commit** through the Git data API — blobs, tree, commit, one
conditional ref update — rather than three commits through the contents API.

That is not tidiness. A half-applied publish would put a record into the
repository naming an image that is not there yet, and Netlify would build exactly
that.

The ref update is **not forced**. Two editors publishing at the same moment
cannot lose one another's work: the second is refused and told to refresh.

### Who did it

```
CMS: Ewa Editor updated announcement "Freshers Icebreaker"

CMS-Actor: ewa@polsocfederation.pl
CMS-Actor-Id: 6f2c…
```

The **git author** is the verified account; the **committer** is the App, because
the App is what holds the credential. Both appear in `git log`, and neither comes
from anything the browser said.

---

## 10. Sessions, staleness and failure

| What happens | What the editor sees |
|---|---|
| Session expires mid-edit | "Your session has expired. Please sign in again." The work is still on screen. |
| Somebody else saved that record first | "…has been edited since this list was loaded. Refresh and try again." |
| A future-year event is published | Blocked, with both years named. Nothing changed. |
| An event an announcement references is deleted | Blocked, naming the announcements. Nothing deleted. |
| Image too large / wrong type | Said plainly, in words, with the limit. |
| The commit succeeds but the Netlify build fails | The previous deploy stays live. The editor was told the site is *rebuilding*, never that it is live. The commit is in history for an admin to inspect or revert. |

No stack trace, no path, no token ever reaches the browser. Technical detail
stays in the function log.

---

## 11. Rollback

Git history is the recovery mechanism.

1. **Hide is the normal way to withdraw something.** Reversible, instant to
   perform, and it keeps the record.
2. **Delete is exceptional.** It removes the record from the CMS; the commit that
   removed it is still in the repository.
3. A bad publish can be reverted from Git history by a technical admin.
4. Netlify can roll back to a previous successful deploy.

There is deliberately no CMS undo feature. It would be a second, weaker history
beside the one Git already keeps.

---

## 12. Environment variables

Set in the Netlify UI. **Never in the repository, never in generated files,
never in browser JavaScript.** `npm run build:production` fails if it finds any
of them, or anything shaped like a key, anywhere in `dist/`.

| Variable | What it is |
|---|---|
| `CMS_GITHUB_APP_ID` | the GitHub App's numeric ID |
| `CMS_GITHUB_INSTALLATION_ID` | the installation on this repository |
| `CMS_GITHUB_PRIVATE_KEY` | the App's private key (PEM; escaped `\n` is handled) |
| `CMS_GITHUB_REPO` | `owner/repo` |
| `CMS_GITHUB_BRANCH` | the branch Netlify builds — `main` |

Installation tokens are minted per invocation and expire in an hour. Nothing
stores them.

---

## 13. Inviting and removing people

No code change is ever needed for this.

**Invite an editor**

1. Netlify → your site → **Identity** → **Invite users**
2. Enter their address → Send
3. Open the new user → **Edit** → set **Roles** to `editor` → Save
4. They receive an e-mail, click the link, land on `/staff-login/`, choose a
   password, and are taken straight to the CMS

**Promote to admin** — change the role to `admin` and save. They see the change
next time they sign in.

**Remove someone** — Netlify → Identity → the user → **Delete user**. Their
session stops working the next time a request is checked, which is within
seconds. Do this when an officer leaves the committee.

**Somebody forgot their password** — the login page's Sign in dialog has a
recovery link; Netlify sends the e-mail.

### Account guidance for officers

- **Never share an account.** Every action is attributed to a person in the Git
  history, and a shared account makes that attribution a lie.
- Use a strong, unique password, or Google sign-in if it has been enabled.
- Tell the President when you leave the committee so the account can be removed.

There are no forced password rotations. They make people choose worse passwords.

---

## 14. Testing it

| Command | What it covers |
|---|---|
| `npm run cms:dev` | ordinary CMS and content work — no Identity, no GitHub, no internet |
| `npm run test:cms-production` | the production functions: roles, paths, media, rules, commits — all against fakes, never a real repository |
| `npm run build:identity` | rebuild the bundled `@netlify/identity` from the pinned package |
| `npm run build:production` | the deployable tree, and the checks that no secret or local endpoint went into it |
| `npm run validate` | everything else |

The production tests use an injected GitHub transport and an injected Identity
fetch. They never reach the network, which is deliberate: a suite that *could*
reach the real repository would eventually be pointed at `main`, and most of what
these tests assert is that a write must **not** happen.

To exercise the real functions locally, install the Netlify CLI and run
`netlify dev` with the environment variables set. That is a separate workflow
from `npm run cms:dev` on purpose — the everyday one must stay simple.
