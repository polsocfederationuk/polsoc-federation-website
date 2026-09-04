# Contributing

Thank you for taking an interest in the website of the Federation of Polish
Student Societies in the UK. This is a small, student-run project maintained by
volunteer committee officers, so please read this page before you start — a few
things here are unusual and will save you wasted work.

Everyone taking part is expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting a problem

**GitHub Issues are switched off on this repository.** Please e-mail
**it@polsocfederation.pl** instead. Tell us what happened, what you expected,
which page you were on and whether you were viewing it in English or Polish,
and what browser and device you were using.

For anything security-related, do **not** e-mail a general report — follow
[SECURITY.md](SECURITY.md) instead.

## Proposing a change

Fork the repository, make a branch, and open a pull request against `main`.

Please keep pull requests small and focused on one thing, and explain in the
description what the change does and why. A large unexplained rewrite is very
unlikely to be merged. We are a volunteer committee and reviews may take a
little while.

## Content is edited through the CMS, not by hand

The text, events, announcements, team lists and member societies of the site are
the canonical YAML files under `content/`. **Do not edit them in a pull
request.** They are managed by committee officers through the Decap CMS admin at
`/admin/`, which commits to this repository on their behalf. A pull request that
edits anything under `content/` will conflict with the CMS, can be overwritten
by the next edit an officer makes, and will normally be declined.

If you have spotted a factual mistake in the content of the site, e-mail
it@polsocfederation.pl and an officer will correct it in the CMS.

Code, templates, build scripts and documentation are a different matter — those
are exactly what pull requests are for.

## Do not add images, logos or photographs

The MIT licence on this repository covers the code only. As set out in
[NOTICE](NOTICE), the photographs, the Federation logo in all its versions, the
member society logos, the sponsor, partner and press logos, and the editorial
content of the site are **not** covered and remain all rights reserved.

So please do not add third-party images, logos, or photographs of people to this
repository, in any pull request, for any reason. We cannot relicense material we
do not own, and photographs of students carry data-protection obligations we
have to manage ourselves. If a change needs new imagery, describe what is needed
and let a committee officer add it.

## The hand-written HTML at the repository root is deliberate

The root of the repository still contains the previous hand-written site —
`index.html`, `team.html`, `events.html`, `event-*.html`, `announcements.html`,
`members.html`, `contact.html`, `404.html`, `pl/*.html` and `js/*.js`.

**It is not dead code and must not be deleted or "tidied up".** It is no longer
served, but it is kept on purpose for two reasons: it is the rollback surface if
the generated site has to be reverted, and it is the baseline that the
comparison test suites in `scripts/compare-*.js` diff the generated pages
against. Deleting it breaks the tests and removes our safety net.

## Working on it locally

```sh
npm install
npm run build       # Eleventy build from src/ + content/ into dist/
npm run validate    # checks the content files and the build output
```

The comparison suites diff a generated page against its hand-written baseline,
and are the main way we prove a template change did not alter the rendered site.
Run the ones relevant to what you touched, for example:

```sh
npm run compare:homepage
npm run compare:team
npm run compare:announcements
npm run compare:members
npm run compare:contact
npm run compare:404
```

`package.json`'s `scripts` block is the full list — there are more comparison,
audit and CMS suites there than are worth listing here. `docs/` holds the
background on how the build and the CMS fit together, starting with
`docs/BUILD_ARCHITECTURE.md`.

Please run the suites relevant to your change before opening a pull request, and
say in the description which ones you ran. There is no CI on this repository, so
your local run is the only check there is.
