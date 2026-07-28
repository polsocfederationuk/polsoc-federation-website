# Team page accessibility remediation (Cleanup Phase 5)

Two defects on the team pages, both flagged during the Phase 4 migration and
deliberately reproduced rather than silently fixed at the time, are corrected
here. Unlike Phases 2–4, **this phase changes the live pages**: `team.html`,
`pl/team.html`, the Eleventy templates and the shared filter script all move
together, so the eventual cutover to `dist/` remains a no-op.

No CSS changed. No content changed. Nothing about the page looks different.

Related: [TEAM_MIGRATION.md](TEAM_MIGRATION.md) §11 and §15, where both defects
were first recorded.

---

## 1. The two defects

**Defect 1 — the Polish page announced English.** All 21 members on
`pl/team.html` carried English `aria-label` values on both contact links:

```html
<a href="mailto:…" title="E-mail" aria-label="Email Szymon">
<a href="https://www.linkedin.com/…" title="LinkedIn" aria-label="Szymon on LinkedIn">
```

`title` was translated; `aria-label` was not. Because `aria-label` overrides
everything else in the accessible-name computation, a Polish screen-reader user
heard English on all 42 links of that page. The visible page gave no hint that
anything was wrong.

A second, quieter problem sat inside the same markup: the labels used a stored
first name, so **"Email Maksymilian" identified two different people** —
Maksymilian Celm and Maksymilian Rokosz. Anyone navigating by a list of links
got two identical entries pointing at different inboxes.

**Defect 2 — the filter bar claimed to be a tab widget.**

```html
<div class="filter-bar reveal" role="tablist" aria-label="Filter team by group">
  <button class="chip active" data-filter="all">Everyone</button>
```

`role="tablist"` with no `role="tab"` children, no `aria-selected`, and no
tabpanels anywhere on the page.

## 2. Why `role="tablist"` was wrong

`tablist` is a promise about structure and behaviour, and the page kept none of
it:

- **It promises tabs.** A `tablist` whose children are plain buttons is an
  incomplete widget. Assistive technology is told a tablist exists but finds
  nothing selectable inside it.
- **It promises tabpanels.** Tabs control panels via `aria-controls`, and
  activating a tab reveals its panel. These controls don't switch between
  panels — they filter one continuous roster, and "Everyone" shows all six
  sections at once. No tab can be "the one whose panel is showing".
- **It promises arrow-key navigation.** Screen-reader users expect Left/Right
  to move between tabs and Tab to jump past the whole set. Here Tab stepped
  through each button individually, contradicting the announced role.
- **It communicated no state.** Without `aria-selected` there was no way to know
  which filter was applied. The red `.active` chip conveyed that visually and
  to nobody else.

The role described a control that did not exist, while the control that did
exist went undescribed.

## 3. Why native buttons plus `aria-pressed`

These are toggles over a single list, so the accurate pattern is a **labelled
group of toggle buttons**:

```html
<div class="filter-bar reveal" role="group" aria-label="Filter team by group">
  <button class="chip active" data-filter="all" aria-pressed="true">Everyone</button>
  <button class="chip" data-filter="trustees" aria-pressed="false">Trustees</button>
```

- `role="group"` + `aria-label` names the set without promising behaviour it
  doesn't have.
- `aria-pressed` states each control's on/off condition — the information the
  `.active` class was carrying visually and silently.
- They stay **native `<button>` elements**, so focus order, Enter/Space
  activation and the focus ring are the browser's, not a reimplementation.

A formal tab widget was explicitly not built. It would mean `role="tab"`,
`aria-selected`, `aria-controls`, six `role="tabpanel"` regions, roving
`tabindex` and arrow-key handling — a large amount of custom behaviour to
describe a filter that already works. The brief ruled it out and it would have
been the wrong shape regardless.

The classes (`filter-bar`, `chip`, `active`) are untouched, because every style
rule keys off them. Nothing in `css/style.css` selects on `role` or any ARIA
attribute, which is why the correction is visually inert.

## 4. Final English group label

```text
Filter team by group
```

Unchanged. The brief suggested "Filter team members"; the existing string is
kept because it says what the controls filter *by*, which is more informative,
and because it already had a matching Polish translation. Changing it would have
been churn on two live pages for no accessibility gain. Easily revisited — it is
one string in `ui.json`.

## 5. Final Polish group label

```text
Filtruj zespół według sekcji
```

Unchanged, and already correct Polish.

## 6. Final English contact-link patterns

```text
Email {name}          ->  "Email Szymon Kwidziński"
{name} on LinkedIn    ->  "Szymon Kwidziński on LinkedIn"
```

The patterns are as before; `{name}` is now the member's **full name** rather
than a stored first name. That change resolves the duplicate-name collision
described in §1 — all 42 accessible names on each page are now unique.

## 7. Final Polish contact-link patterns

```text
Wyślij e-mail do: {name}   ->  "Wyślij e-mail do: Szymon Kwidziński"
Profil LinkedIn: {name}    ->  "Profil LinkedIn: Szymon Kwidziński"
```

**On the colon.** Polish would normally inflect here: *"Wyślij e-mail do
Szymona"* needs the genitive, and *"Profil LinkedIn Szymona"* likewise. A
genitive cannot be produced from an uninflected name by string substitution —
Polish surnames decline differently by gender and ending, and the roster
includes non-Polish names such as Katie Taylor that should not be declined at
all. The `label: value` construction is idiomatic in Polish interfaces, is
unambiguous when read aloud, and keeps the name in the nominative, so one
pattern serves all 21 members correctly. The alternative — a hand-written
genitive per person — would reintroduce exactly the per-member string data this
phase removed.

`title` stays as the short tooltip ("E-mail", "LinkedIn"). It is not relied on
as the accessible name; `aria-label` supplies that.

Both locales' patterns live in `src/_data/ui.json` under `<locale>.team`, so the
generated pages have a single source for them.

## 8. JavaScript behaviour

`src/js/team-filter.js` (and the equivalent inline script on each live page)
applies the state in **one pass over every chip**:

```js
chips.forEach((c) => {
  const on = c === chip;
  c.classList.toggle("active", on);
  c.setAttribute("aria-pressed", on ? "true" : "false");
});
```

Writing both from the same loop is the point: the visual state and the announced
state are derived from one boolean, so they cannot drift, and exactly one chip
is left active and pressed no matter how the function is entered.

The filtering itself is unchanged — `.hidden` toggled per section, `all` showing
everything, and the reveal animation replayed on the newly shown cards.

The script still contains no display strings, works unmodified in both
languages, and returns immediately if the chips or team sections are absent.

## 9. Keyboard behaviour

No keyboard handlers were added, on purpose. Native `<button>` gives:

- **Tab / Shift+Tab** — moves through the seven filters in DOM order.
- **Enter** — activates the focused filter (UA fires `click` on keydown).
- **Space** — activates the focused filter (UA fires `click` on keyup).
- **Focus ring** — the browser default. `css/style.css` contains no `outline`
  reset anywhere, so the ring is intact; measured on a focused chip it resolves
  to `outline-style: auto` with `:focus-visible` matching. **No CSS change was
  needed and none was made.**

Arrow-key navigation was deliberately not implemented: it belongs to tab
widgets, and adding it to a button group would surprise users. Adding key
handlers at all would risk double-firing alongside the UA's own activation.

## 10. Files changed

| File | Change |
| --- | --- |
| `team.html` | filter group semantics, 42 aria-labels, inline filter script |
| `pl/team.html` | same, with Polish labels |
| `src/_includes/partials/team-filters.njk` | `role="group"`, `aria-pressed` |
| `src/_includes/partials/team-card.njk` | aria name derived from `name` |
| `src/js/team-filter.js` | sets `aria-pressed` alongside `.active` |
| `src/_data/ui.json` | Polish aria patterns; documentation of both |
| `content/team/*.yaml` (21) | removed `aria_name_email` / `aria_name_linkedin` |
| `scripts/compare-team.js` | corrected-semantics checks; chip-parsing fix |
| `scripts/validate.js` | new §16; two brittle regexes fixed |
| `docs/TEAM_MIGRATION.md` | §11 and §15 updated to describe the fix |
| `docs/TEAM_ACCESSIBILITY_REMEDIATION.md` | this file |

`css/style.css` and `js/main.js` are untouched. No other public file changed.

### A bug this phase exposed

Adding `aria-pressed` broke a regex in `compare-team.js` that pinned the exact
attribute order of a chip. It matched nothing — and because **both** sides then
parsed to an empty list, six filter comparisons silently "passed". The regexes
are now attribute-order agnostic, and both scripts assert that exactly seven
chips were parsed, so an empty parse fails loudly instead of comparing nothing
to nothing. A second copy of the same brittle pattern in `validate.js` §15 was
fixed the same way.

## 11. Testing performed

- `npm run clean && npm run build && npm run validate` — **246 checks, 0
  problems** (was 148).
- `npm run compare:team` — **194/194 comparisons matched** (was 120, of which 6
  were the false pass described above).
- **Negative controls.** Defects were injected deliberately and confirmed to
  fail: `role="tablist"` restored, a second chip pressed, `aria-pressed`
  removed, and an English label put back on the Polish page — 13 comparison
  failures and 11 validator failures, including the live↔generated parity check.
  All four pages were then restored and re-verified.
- **Determinism.** Two consecutive clean builds byte-identical across 42 files;
  also identical under `TZ=Pacific/Auckland`.
- **Browser**, all four pages (`/team.html`, `/pl/team.html` from the repository
  root on :8012; `dist/team.html`, `dist/pl/team.html` on :8011) at **320, 390,
  768, 1280** — 16 combinations. Every one: zero horizontal overflow, zero
  elements outside the viewport, 21 cards, 22 images loaded and none broken, all
  7 chips native buttons and focusable, exactly one `.active` and exactly one
  `aria-pressed="true"`, no `role="tablist"`, no `role="tab"`, no
  `aria-selected`, and 42 unique non-empty accessible names. Grid track sizes
  measured identical to the Phase 4 figures at every width (`130px` at 320,
  `165.2px` at 390, `342.8px` at 768, `265px ×4` at 1280), confirming no layout
  change.
- **Filter sweep** on all 16 combinations: each of the 7 chips clicked, yielding
  21/5/4/4/3/1/4 cards, with exactly one active chip, exactly one pressed chip,
  six unpressed, and the pressed chip always the clicked one. "Everyone" /
  "Wszyscy" restored all 21 every time.
- **Keyboard.** Real `Tab` presses moved focus between chips; the focused
  element was a native `BUTTON`, matched `:focus-visible`, and had the browser's
  `outline: auto` ring.
- **Accessibility tree.** The browser exposed the seven chips as buttons with
  their Polish visible labels, and the contact links with the corrected Polish
  accessible names.
- No console errors on any page.

### What was not verified, and why

**Enter and Space activation could not be exercised end to end.** The browser
automation available here dispatches key events that reach the page as trusted
`keydown`s with the correct `key` value, but the browser does not perform the
default activation from them. This was isolated with a control: a freshly
created, unstyled native `<button>` with a click listener, appended to the same
page, also failed to activate on the same synthetic Enter. The limitation is in
the automation harness, not the page.

What *is* established: the controls are native `<button>` elements (verified in
the DOM on all four pages), Tab genuinely reaches them, real mouse clicks
activate them correctly, and **no script on either page registers any
`keydown`, `keyup` or `keypress` handler, calls `preventDefault`, or sets
`tabindex`** — verified across `js/main.js`, `src/js/team-filter.js` and both
inline scripts. With nothing intercepting keys, Enter and Space activation is
the user agent's own behaviour. That is a sound inference, not an observation,
and a manual keyboard pass before cutover is still worth doing.

No screenshots were captured — the preview pane cannot composite frames in this
environment. All visual claims above rest on measured geometry and computed
styles, not on looking at the rendered pages.

## 12. Remaining accessibility limitations

Out of scope here, and none of them regressions:

- **No live region on filtering.** Choosing a filter changes how many cards are
  present with no announcement. A screen-reader user hears the button's pressed
  state but not "4 members shown". A polite live region holding the visible
  count would close this; it needs a localised string in `ui.json` and is the
  most valuable remaining item.
- **Decorative SVG icons are not explicitly hidden.** The mail and LinkedIn
  glyphs have no `aria-hidden="true"`. Harmless today because the `aria-label`
  on the anchor overrides its subtree, but the attribute would be more robust.
- **Contact links are icon-only.** They meet the 24×24 target-size guidance at
  the tested widths but are visually terse; nothing is broken, it is a design
  question.
- **Focus ring is the browser default.** Adequate and untouched, but a
  brand-styled `:focus-visible` would be more consistent with the rest of the
  site — `.lang-switch a` already has one. Deliberately not added here, since
  the brief limited CSS changes to cases where focus was genuinely unusable.
- **The rest of the site is unaudited.** This phase covered the team pages only.
  The header, navigation drawer, language switcher and footer are shared chrome
  and were not assessed; the announcements, events, members and contact pages
  have had no accessibility review at all.
