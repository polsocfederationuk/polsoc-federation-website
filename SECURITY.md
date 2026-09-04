# Security Policy

## Reporting a vulnerability

Please report security problems **privately**, by e-mail, to
**it@polsocfederation.pl**.

Do not open a public issue, post the details in a pull request, or discuss them
publicly before we have had a chance to fix them. GitHub Issues are open on
this repository for ordinary bug reports, but a security problem must never go
there.

Please include, as far as you can:

* what the problem is, and what an attacker could actually achieve with it
* the URL, page or endpoint affected
* the steps needed to reproduce it
* anything you used to find it — a request, a payload, a screenshot
* how you would like to be credited, if you would like to be

**What to expect.** The Federation is a student-run charity and this site is
maintained by volunteer committee officers, not by a company with an on-call
rota. We will aim to acknowledge your e-mail within a few working days and to
tell you what we plan to do about it. Something serious will be dealt with as
quickly as we can manage; something minor may sit for a while. Term dates,
exams and handovers genuinely do affect how fast we can respond. We are not in
a position to promise a service-level agreement, and we would rather be honest
about that than publish one we cannot keep.

## In scope

* the generated public website
* the Netlify Functions under `netlify/functions/` — in particular the write
  endpoints exposed as `/api/cms` and `/api/bulk/*`
* the content manager at `/admin/`
* the staff login at `/staff-login/`
* the build and the templates in this repository, where a flaw there produces a
  vulnerability in the published site

## Out of scope

* **Third-party services themselves** — Netlify, GitHub and Netlify Identity.
  Report those to the vendor concerned. We are interested in how *we* have
  configured them, but not in vulnerabilities in the platforms.
* **The superseded hand-written HTML at the repository root** — `index.html`,
  `team.html`, `event-*.html`, `pl/*.html`, `js/*.js` and so on. These files are
  no longer served. They are kept deliberately as a rollback surface and as the
  baseline for the comparison test suites. A finding in a file that is not
  published is not a vulnerability in the site.
* **Findings that require an already-compromised editor account.** An attacker
  who has an officer's live session can, by design, edit content — that is what
  the account is for. We are interested in how such a session could be *obtained*
  or in a way to escalate beyond the account's assigned role.
* **Automated scanner output with no demonstrated impact** — a raw report, a
  missing-header advisory, or a version-number finding with no working path to
  an actual problem on this site.
* Reports that amount to asking us to add a header or setting without saying
  what it would prevent here.

## Please do not test against the live site destructively

The content manager commits to a real repository and publishes a real charity's
website. Please do **not** create, modify or delete real content, submit test
entries, or run automated scanners or brute-force tooling against the live site
or its functions. If demonstrating a problem needs a write, describe how it
would work and e-mail us — we will reproduce it ourselves rather than have you
do it in production.

## The source being public does not weaken the CMS

This is worth stating plainly, because it is the usual first worry when a site
with an admin panel opens its source.

The security of the content manager does not depend on this repository being
private, and never did:

* **Accounts are invite-only.** Netlify Identity registration is closed. Nobody
  can sign themselves up.
* **Roles are assigned by an administrator.** The `editor` and `admin` roles are
  granted by hand; an account without one is of no use.
* **Netlify checks the role at the edge.** The role in the `nf_jwt` cookie is
  checked before any file under `/admin/` is served at all. Anyone without it is
  redirected to `/staff-login/`.
* **Every write function checks the role again, server-side, for itself.** It
  does not trust the browser, and it does not accept a repository path from the
  browser.
* **The browser never receives GitHub credentials.** Writes are committed by a
  GitHub App from within the function. Git Gateway is deliberately not used.

As `netlify.toml` puts it, `/admin/` is a publicly guessable address and that is
fine: **this is real access control, not obscurity.** An attacker who reaches
the admin page without a session gets a CMS that cannot read or write anything.
Security headers (a Content-Security-Policy, `X-Frame-Options: DENY`,
`no-store`, `noindex`) are applied to `/admin/*`, `/staff-login/*` and `/api/*`.

Knowing how the lock works has never been the same as having the key. If you
believe you have found a case where publishing the source *does* weaken
something, that is exactly the sort of report we want — please e-mail it.

## Rewards

We are a student charity and cannot offer a bounty or any payment. We can offer
credit: tell us how you would like to be named and we will acknowledge you once
the problem is fixed, or keep your report anonymous if you would prefer that.
