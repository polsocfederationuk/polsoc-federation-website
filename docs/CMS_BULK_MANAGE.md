# Bulk manage

Phase 17C.5B. Hiding, showing and deleting several records at once, for Team,
Announcements and Standard Events.

The Polish Business Forum is deliberately absent — it is a separate family with
its own page and its own rules, and it gets its own phase.

---

## 1. What it is for

A committee changes over. Somebody has to take last year's officers off the team
page, or pull half a dozen announcements down before a new season starts. Doing
that one record at a time means opening, scrolling, switching a toggle, saving,
going back — twenty times, with no way to see what is currently visible.

Bulk manage is one screen that answers "what is on the website right now?" and
lets you change it for several records at once.

**Hide from website** and **Show on website** are the everyday, reversible pair.
**Delete permanently** is the exception.

The word *archive* is deliberately not used for hiding. This site already uses
"archive" for the season archive of past events, and one word meaning two things
in the same admin panel is how people make mistakes.

---

## 2. Why it is a page of its own

Decap CMS 3.15.1 lets an integrator register exactly these things:

```
registerWidget            registerPreviewTemplate    registerPreviewStyle
registerEditorComponent   registerWidgetValueSerializer
registerRemarkPlugin      registerBackend            registerMediaLibrary
registerLocale            registerEventListener      registerCustomFormat
```

There is no API for adding a page, a route, a sidebar entry or an action on the
collection list. `registerAdditionalLink`, which later Netlify CMS forks provide,
is **not present** in this version's bundle — checked against
`node_modules/decap-cms/dist/decap-cms.js`.

So putting checkboxes into Decap's own collection list would have meant matching
generated class names, reading its Redux store, or assuming the shape of markup
it does not document. This repository has already paid for that kind of coupling
once: an enhancer built on Decap's internals failed twice across two phases in a
way that could not be explained, and was rebuilt as a self-contained module.

Bulk manage is therefore a page this repository owns entirely, at
`/admin/bulk/`, built from `src/admin/bulk.njk` into `.cms/admin/bulk/` by the
same `CMS_DEV=1` build that produces the admin panel. No public build can emit
it.

**One anchor** — `src/admin/bulk-link.js` — appends a link to Decap's collection
list so the screen is findable. That is the only place this feature touches
Decap's markup, and all it does is add a link. If a future Decap release changes
that list, the link stops appearing and the screen is still reachable by URL.
Nothing is moved, replaced or taken over.

---

## 3. Publication semantics

**Every collection in this repository already had them, and none of them
changed.**

An inspection at the start of the phase found `published:` present on all 21 team
records, all 28 announcements and all 5 events, and every public loader filtering
on it strictly:

| Loader | Rule |
|---|---|
| `teamInGroup` (eleventy.config.js) | `published === true` |
| `announcementsFor` | `published === true` |
| `eventListing.js`, `standardEventPages.js`, `publicRoutes.js` | `published === true` |
| `businessForumPages.js`, `societiesFor` | `published === true` |

So Team needed no new field, no compatibility rule and **no migration**. The
"missing `published` means visible" fallback that was considered would have
contradicted the convention every other collection already follows, and would
have changed behaviour site-wide to solve a problem that did not exist.

Bulk manage reports exactly what the website does: `published === true` is
*Visible on website*, anything else is *Hidden from website*.

### What Hide and Show change

Exactly one line:

```yaml
published: false
```

Nothing else. In particular an event keeps every one of its surface preferences:

```yaml
published: false        # globally hidden right now
show_in_listing: true   # …but remember where it belongs
show_on_homepage: true
show_in_archive: true
flagship: false
```

That is valid canonical data and it is the point: showing the event again
restores where it appears, without anybody having to remember what the switches
were set to.

The change is made as a **line edit, not a YAML re-dump**. Re-serialising would
rewrite comment headers, re-wrap long Polish paragraphs and re-quote strings
across a file where one boolean changed. `npm run test:bulk` asserts that hide
followed by show returns the file byte-for-byte.

---

## 4. Filters and selection

Three controls: collection, academic year, publication status.

Academic years are read from the records on screen, not hard-coded, so the list
never offers a year nothing lives in.

**Select all visible** means precisely: every record currently shown *after the
filters*. Never the whole collection, never a record a filter is hiding.

**Changing the collection or any filter clears the selection.** One
deterministic rule, stated on the screen. The alternative — carrying selections
that have scrolled out of scope — lets somebody hide records they cannot see.

There is no pagination. Team is 21 records, Announcements 28, Standard Events 4;
showing all of them is both simpler and safer than defining what "select all
visible" means across pages.

---

## 5. The storage abstraction

```
src/admin/bulk.js          the screen. Knows: collection key, record ID,
                           human labels, revision token, operation.
                           Knows nothing about files, paths or Git.
        │  POST /api/bulk/…
        ▼
scripts/bulk/api.js        request shape, structured errors, human wording
        ▼
scripts/bulk/local-store.js   THE ONLY MODULE THAT KNOWS ABOUT FILES
        ▼
scripts/bulk/collections.js   the allow-list, and how a record describes itself
```

The store implements four operations:

```js
listRecords(collectionKey)                    // -> { records }
updateRecords(collectionKey, operation, items) // -> { changed } | { error }
deleteRecords(collectionKey, items)            // -> { deleted } | { error }
dependentsOfEvents(ids)                        // -> what would break
```

### Phase 17D

A Git adapter implements the same four functions against the GitHub API. The
screen does not change:

| Concept | Local adapter | Git adapter |
|---|---|---|
| revision token | SHA-256 of the file contents | blob SHA |
| update | atomic rename over the file | commit |
| delete | `unlink` | commit removing the path |
| stale check | token mismatch | SHA mismatch / rejected push |

The revision token was chosen as a content hash rather than a timestamp
precisely so that this substitution is a rename, not a redesign.

---

## 6. The trust boundary

The browser sends this:

```json
{ "collection": "announcements",
  "operation": "hide",
  "items": [{ "id": "record-a", "rev": "9f2c…" }] }
```

It never sends a path, a filename or YAML. The server resolves the folder from
the allow-list in `collections.js` and builds the filename from an ID matched
against `/^[a-z0-9][a-z0-9-]{0,120}$/`.

That pattern is what makes `../`, `..\`, `/etc/passwd`, `C:\Windows`,
`\\server\share` and a bare `.` **unspellable** rather than merely filtered.
Two further guards sit behind it: the resolved path is re-checked for
containment, and Windows device names (`nul`, `con`, `com1`…) are refused —
`content/team/nul.yaml` opens the null device and swallows a write in silence.

There is **no shell execution anywhere in this feature**, and no route that
accepts a field name, a file path or arbitrary content. `npm run test:bulk`
asserts all of this, including that extra keys smuggled onto a request item are
ignored rather than honoured.

The API is mounted on `scripts/cms-server.js` rather than on Decap's proxy: the
proxy is a third-party package this repository does not modify, and sharing an
origin with `/admin/` means there is no CORS surface at all. Both are bound to
`127.0.0.1`.

---

## 7. Stale-edit protection

Every record in the list carries the SHA-256 of its file contents at the moment
the list loaded. Every operation sends those tokens back, and the server checks
each one against the file as it stands now.

If **any** selected record has changed, the whole operation is refused:

```
Nothing was changed because "Icebreaker" has been edited since this
list was loaded.

Refresh Bulk manage and try again.
```

This is what stops a bulk operation quietly overwriting a colleague's edit made
in the entry editor a minute earlier. It applies to deletion too, and the check
runs before anything is unlinked.

---

## 8. Atomicity

Hide, Show and Delete all validate the **entire** selection before touching
anything:

1. resolve every record and confirm it exists and belongs to the collection
2. check every revision token
3. apply the operation's own rules to every record
4. for deletion, re-read dependencies from the files on disk
5. build every replacement file in memory
6. only then write

A selection that fails at any step changes nothing at all — so "Nothing was
changed" is a statement of fact, not a hope. `scripts/test-bulk.js` proves it by
hashing every file before a refused operation and comparing afterwards.

Writes use a temporary file and a rename, which is atomic within a directory on
both NTFS and POSIX: a reader sees the old file or the new one, never a partial
write. If a write fails part-way through a multi-record operation, the originals
are still in memory and the files already replaced are put back before the
failure is reported.

---

## 9. The future-year rule

A standard event belonging to a later academic year than the site's current one
cannot be published — publishing one is a fatal build error, and it takes
`npm run cms:serve` down with it.

Bulk Show calls `futurePublishProblem()` from `src/_data/academicYear.js`: the
same function the entry editor calls on save. There is no second copy of the
rule to drift.

Selecting a valid hidden event and a future hidden event and clicking **Show on
website** blocks the whole operation:

```
Nothing was changed.

"Test Fixture Future Event" cannot be shown yet because it belongs
to 2026/27. The current academic year is 2025/26.
```

The valid event stays hidden. Hiding a future event is always allowed — it is
publishing one that breaks the build.

---

## 10. Deletion

### Referential safety

A repository-wide scan found exactly one kind of canonical cross-record
reference: **announcement → standard event**, two ways.

```yaml
link:
  type: event
  event_slug: icebreaker        # the details link

registration:
  source: event
  event_slug: icebreaker        # the registration
```

An event referenced either way cannot be deleted. The blocked deletion names the
announcements and says which way each one depends — one announcement referencing
an event *both* ways is listed once with both reasons.

**A registration reference counts even when the event's registration state is
`none`.** Since Phase 17C.5A.3 an announcement may point at an event whose
sign-ups have not opened; that is the ordinary case, and the reference is no less
real for rendering no panel today.

At the time of writing **all four standard events are referenced**, so none of
them can currently be deleted. That is the guard working, not a fault.

Team records and announcements are referenced by nothing canonical. Team slugs do
appear inside `/assets/team/<slug>.jpg` paths and once inside a LinkedIn URL in
prose; neither is a record reference, and the Business Forum keeps its own copies
of the people it lists rather than pointing at Team records. No dependency check
was invented for them.

### Media is never deleted

Deleting a record does not delete a single asset. The same photograph can belong
to several records — a team portrait also appears in the Business Forum's own
people list — so removing a picture with a record could break a page nobody
looked at. Orphaned-media cleanup, if it is ever wanted, is a separate feature.

### The confirmation

Deleting shows an explicit dialog listing every record by name, keyboard-usable,
dismissable with Escape. **Five or more** records also require typing `DELETE`.
Below that a single test fixture stays a two-click job.

The warning says the deletion **cannot be undone from the admin panel** — not
that the record is gone forever. Once Phase 17D publishes through Git the
repository still holds the history, and a warning that turns out to be an
overstatement is one people stop believing.

---

## 11. Commands

| Command | Does |
|---|---|
| `npm run cms:dev` | Start the CMS; Bulk manage is at `/admin/bulk/` |
| `npm run test:bulk` | The bulk backend: security, atomicity, dependencies, staleness |

---

## 12. Files

| File | | Purpose |
|---|---|---|
| `scripts/bulk/collections.js` | new | The allow-list, and how each record describes itself |
| `scripts/bulk/local-store.js` | new | The local file adapter — the only module that knows about files |
| `scripts/bulk/api.js` | new | Request shape, structured errors, human wording |
| `scripts/cms-server.js` | modified | Mounts `/api/bulk/…`; everything else unchanged |
| `src/admin/bulk.njk` | new | The page |
| `src/admin/bulk.js` | new | The screen |
| `src/admin/bulk.css` | new | Its styles |
| `src/admin/bulk-link.js` | new | One anchor into Decap's collection list |
| `src/admin/bulk-link.css` | new | Styling for that anchor |
| `src/_data/cmsConfig.js` | modified | Registers the four new admin assets |
| `src/admin/index.njk` | modified | Embeds the link script and styles |
| `scripts/test-bulk.js` | new | 114 backend assertions |
| `docs/CMS_BULK_MANAGE.md` | new | This document |

No public template, stylesheet or loader was changed. `css/style.css`,
`css/pbf.css` and `netlify.toml` are untouched, and no canonical record was
migrated.

---

## 13. Known limitations

1. **The list is a snapshot.** It does not watch for changes made elsewhere. That
   is what the revision check is for: a stale operation is refused with the
   record named, rather than silently applied.
2. **No undo.** Hiding is reversible by showing again, but there is no history of
   bulk operations. Deletion is recoverable only through Git.
3. **The Business Forum is not managed here.** Deliberate; it is a separate
   family with its own phase.
4. **Decap's own mobile shell is still ~800px.** Bulk manage itself is
   responsive and needs no horizontal scrolling at 375px, but it is reached
   through an admin panel that is not.
5. **Deleting an event is currently impossible in practice** — every standard
   event is referenced by an announcement. Change or remove the reference first.
