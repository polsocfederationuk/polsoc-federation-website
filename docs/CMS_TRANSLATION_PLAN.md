# Assisted translation in the CMS — a design, not an implementation

**Status: not built. Nothing in this repository sends content anywhere.**

This document exists so that the question "can the CMS translate for me?" has a
considered answer on file rather than being decided in a hurry by whoever next
has twenty minutes and an API key. It records the constraints, the options that
were rejected and why, and what would have to be true before any of it is built.

Phase 17C.2 deliberately stopped short of implementing this. The CMS had to
become reliable first, and a translation button on an unreliable CMS would
simply have been one more thing that failed.

---

## 1. The problem, stated honestly

Every record in this repository is bilingual. A Team member has `en.role` and
`pl.role`. An announcement has `en.title` / `pl.title`, `en.subtitle` /
`pl.subtitle`, `en.body` / `pl.body`. A standard event has around eight
localised fields per language plus a section list per language.

An editor writing an announcement therefore writes everything twice. If their
Polish is better than their English, or the reverse, the weaker side is where
mistakes land — and the weaker side is still published.

That is a real cost and worth solving. It is not worth solving badly.

---

## 2. What the site publishes, and why that raises the bar

These are not internal notes. The Federation's announcements, event pages and
committee roles are the public face of a national student organisation, read by
partner institutions, embassies and universities. A translation that is merely
*plausible* is worse than no translation: nobody proofreads text that already
looks finished.

Polish also punishes shallow translation in ways that are easy to miss in
review:

- **Case.** Event and institution names decline. "Instytut Sikorskiego" is not
  the form used after every preposition. A translator that leaves proper nouns
  in the nominative produces text that reads as foreign.
- **Formality.** The site addresses readers with the plural "Państwo" register in
  some contexts and informally in others. Machine output picks one at random.
- **Institutional names have official Polish forms** that are not translations.
  "Polish University Abroad" is "Polski Uniwersytet na Obczyźnie" — a name, not a
  rendering. A translator will happily invent a different one.

The conclusion is not "never translate". It is that **machine output is a first
draft for a human who reads the target language**, and the design must make that
structurally obvious rather than merely say it in a hint.

---

## 3. Options considered

### 3.1 Browser-side call to a translation API — REJECTED

The CMS is a static page. A translation call from it needs a key in the page.
Anyone who opens the admin, or reads the built file, has the key. The key bills
the Federation.

This is not mitigated by "it is local only". The admin is built from a template
in a git repository; the first time somebody deploys the admin behind
authentication — which is the whole point of the authentication phase — the key
deploys with it.

**Rejected: it puts a billable credential in a file we intend to serve.**

### 3.2 An undocumented public endpoint — REJECTED

The unofficial `translate.googleapis.com` endpoint used by browser extensions is
free and needs no key. It is also undocumented, unversioned, rate-limited by IP,
and not licensed for this. Building the Federation's publishing workflow on an
endpoint that can vanish without notice, and that we have no right to use, is
not a foundation.

**Rejected: no licence, no stability guarantee, no recourse when it breaks.**

### 3.3 A built-in dictionary or phrase table — REJECTED

Tempting because it needs no network and no key. It would produce word-salad for
anything beyond a handful of memorised strings, and — worse — it would produce
*confident* word-salad. An editor who does not read Polish cannot tell the
difference between a real translation and a lookup table's best effort.

**Rejected: it would be a translation-shaped object, not a translation.**

### 3.4 A server-side call through a proxy the Federation controls — VIABLE

The only option that survives. The shape:

- The key lives in an environment variable on a small server function, never in
  the repository and never in the browser.
- The CMS calls **that function**, not the translation provider.
- The function is reachable only by an authenticated editor. This means it
  **cannot be built before the authentication phase** — until then there is no
  "authenticated editor" to check for, and an open endpoint with a billable key
  behind it is a liability.

This is the recommendation, and it is explicitly blocked on authentication.

---

## 4. Provider

Not chosen here — deliberately. It is a decision with cost and
data-protection consequences that belongs to the Federation, not to a build
phase. What the choice must be made against:

| Question | Why it decides the outcome |
| --- | --- |
| Quality for EN↔PL specifically | General benchmarks do not predict Polish case and formality handling. Test with real announcements. |
| Cost at this volume | A few dozen records a year. Any per-character pricing is negligible; a monthly minimum may not be. |
| Where text is processed, and retention | Announcements are public before long, but drafts are not, and unpublished event details may be embargoed. |
| Formality control | A provider that exposes a formality setting removes a whole class of error. |
| Glossary support | The single highest-value feature here — see below. |

**A glossary matters more than raw quality.** Institution names, the
Federation's own name, event names, and the committee role titles are a closed
set that must come out identically every time. A provider that accepts a
glossary turns the largest category of embarrassing error into a solved problem.

---

## 5. The interaction, if it is built

The design principle: **assist the draft, never the publish.**

1. Translation is offered per field, not per record. One button beside the
   Polish field, reading in English. No "translate everything".
2. It **never overwrites text that is already there.** If the target field has
   content, the button is disabled with a plain explanation. An editor who wants
   to replace their own work clears the field first — a deliberate act.
3. The result lands in the field as ordinary editable text, with no styling and
   no marker that distinguishes it from typed text once saved. It is a draft the
   editor now owns.
4. **The record is flagged as machine-drafted until a human confirms it.** A
   `needs_review` marker on the record, set when translation is used and cleared
   only by an explicit "I have checked this" action. Records carrying the flag
   are visible as such in the collection list.
5. Failure is quiet and non-destructive: the field is left exactly as it was and
   the editor is told the translation service could not be reached. Nothing about
   a translation failure should ever block saving.

Point 4 is the one that makes the rest defensible. Without it, "machine output is
a first draft" is a sentence in a document; with it, it is a state in the data
that somebody has to clear.

---

## 6. What must be true before any of this is built

- [ ] The authentication phase is complete, so there is an authenticated editor
      to gate the endpoint on.
- [ ] The Federation has chosen a provider and accepted its data handling.
- [ ] A glossary of institution names, event names and committee roles exists.
- [ ] The key lives in a server environment variable, and a check exists that
      fails the build if a key-shaped string appears in a tracked file.
- [ ] The `needs_review` flag is in the content model and rendered in the
      collection list *before* the button that sets it exists.

Until every box is ticked, editors write both languages by hand. That is slower.
It is also correct, which matters more.

---

## 7. What this phase did instead

Reduced the cost of bilingual editing without translating anything:

- Both languages sit in one record, side by side, so nothing can be edited in one
  language and forgotten in the other.
- `npm run cms:check` fails the build if an English field holds Polish text or
  the reverse, which catches the commonest bilingual error — pasting into the
  wrong box.
- Polish fields carry Polish labels and Polish hints, so the Polish side is not
  second-class in the interface.

See [CMS_FOUNDATION.md](CMS_FOUNDATION.md) for the editing model and
[CMS_EVENTS.md](CMS_EVENTS.md) for the bilingual section rules.
