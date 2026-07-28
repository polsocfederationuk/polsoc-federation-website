# Announcement modal close-button layering fix (Cleanup Phase 7)

A one-declaration CSS fix, applied to the live stylesheet and inherited by the
generated pages through the existing byte-identical passthrough copy.

This is the defect recorded as §20 D in
[ANNOUNCEMENTS_MIGRATION.md](ANNOUNCEMENTS_MIGRATION.md), found during Phase 6
and deliberately reproduced rather than fixed at the time, because that phase
was forbidden from touching `css/style.css`.

---

## 1. The observed defect

On an announcement **with a main photograph**, the modal's ✕ button was visible
in its usual place but did not respond to mouse or touch. Clicking it did
nothing: the dialog stayed open.

On an announcement **without** a photograph the same button worked normally,
which is what made the bug easy to miss — and easy to misdiagnose as a
JavaScript problem.

It affected 25 of the 28 announcements, in both languages, on the live site.

## 2. Why the photograph intercepted pointer interaction

Hit-testing follows painting order. `document.elementFromPoint()` at the exact
centre of the button returned the `<img>`, not the button:

```text
before:  elementFromPoint(button centre) -> <img>     (isTheButton: false)
after:   elementFromPoint(button centre) -> <button>  (isTheButton: true)
```

Because the image painted on top, it was the event target. The click therefore
never reached the button's handler. It bubbled up to `#annModal`, whose backdrop
handler closes the dialog only when `e.target === modal` — and the target was
the image, so nothing happened at all.

Nothing was wrong with the JavaScript, and nothing was wrong with the button's
geometry. It was purely a question of which box painted last.

## 3. Stacking-context analysis

Measured in the browser rather than assumed:

| Element | `position` | `z-index` | `transform` | Creates a stacking context? |
| --- | --- | --- | --- | --- |
| `.modal` | `fixed` | `200` | none | **yes** (positioned + z-index) |
| `.modal-panel` | `relative` | `auto` | `matrix(…)` | **yes** — because of the transform |
| `.modal-close` | `absolute` | `auto` | none | no |
| `#annModalPhoto` | `static` | `auto` | none | no |
| `.ph` | `relative` | `auto` | none | no |
| `.ph img` | `absolute` | `auto` | none | no |

The relevant container is **`.modal-panel`**, and it is worth being precise
about why: not because of its `position: relative` — its `z-index` is `auto`, so
that alone would not do it — but because `.modal-panel` carries a `transform`
(`translateY(…) scale(…)`) for its open/close animation, and a transform other
than `none` establishes a stacking context on its own.

Inside that context, `.modal-close`, `.ph` and `.ph img` are **all positioned
with `z-index: auto`**. They therefore paint in the same layer, and within a
layer the tie-break is tree order:

```html
<div class="modal-panel" style="position: relative;">
  <button class="modal-close" id="annClose" …>✕</button>   <!-- painted first  -->
  <div id="annModalPhoto"> … <img> … </div>                <!-- painted second -->
  <div class="modal-content"> … </div>
</div>
```

The photograph comes second, so it wins. Moving the button later in the DOM
would also have fixed it, but that would mean editing both live HTML pages and
the template — three files instead of one, and a change to markup rather than to
presentation.

## 4. The exact CSS correction

One declaration added to the existing `.modal-close` rule in `css/style.css`:

```css
.modal-close {
  position: absolute;
  /* Keeps the ✕ above the modal photograph. Both this button and the photo's
     .ph/img are positioned with z-index:auto inside .modal-panel — which is a
     stacking context because of its transform — so without this they paint in
     DOM order and the photo, coming later, swallows the click. 1 is enough:
     nothing else inside the panel raises itself above the auto/0 level.
     See docs/ANNOUNCEMENT_MODAL_FIX.md. */
  z-index: 1;
  top: 18px;
  right: 18px;
  /* …unchanged… */
}
```

Nothing else changed: no new selector, no change to `top`/`right`/`width`/
`height`/`border-radius`/`background`/`box-shadow`, no markup, no JavaScript.

## 5. Why `z-index: 1` is sufficient

The button only has to beat its **siblings inside `.modal-panel`**, and every
one of them sits at the `auto`/0 level:

- `#annModalPhoto` and its `.ph`/`img` — the actual offender, `z-index: auto`.
- `.modal-content` and everything in it — body text, the extra-image gallery
  (`.ann-extra img`), the closed-registration chip (`.ann-closed`) and the link
  button (`.ann-link .btn`) — all `position: static`, so they paint *earlier*
  still, in the in-flow phase.

`z-index: 1` lifts the button above all of them and no further. Because
`.modal-panel` is a stacking context, the value is also **sealed inside the
modal**: it cannot interact with `.modal`'s own `z-index: 200`, the sticky
header, or anything else on the page, no matter what those use.

A large arbitrary value would have worked too, and would have been worse — it
would imply a competition that does not exist and invite the next person to
escalate further. The validator enforces both ends of this: the value must be a
positive integer **and** below 200.

`.modal-close` was already `position: absolute`, so no positioning change was
needed for `z-index` to apply. The validator checks that too, because a stacking
value on a static box is silently inert.

## 6. Files changed

| File | Change |
| --- | --- |
| `css/style.css` | `z-index: 1` on `.modal-close` (+ explanatory comment) — **the only public file** |
| `scripts/validate.js` | new §19: parses the rule and asserts the fix holds |
| `scripts/compare-announcements.js` | close-control presence/uniqueness/naming checks |
| `docs/ANNOUNCEMENT_MODAL_FIX.md` | this file |
| `docs/ANNOUNCEMENTS_MIGRATION.md` | §20 D and §21 marked resolved |

No HTML, no JavaScript, no announcement data, no content record, no asset, no
`sitemap.xml`, no `robots.txt`, no `netlify.toml`. The generated pages pick the
fix up automatically because `dist/css/style.css` is a byte-identical passthrough
copy — asserted by the validator.

### How the validator guards it

§19 does not grep for the string `z-index`. It brace-matches the `.modal-close`
rule out of the stylesheet, strips comments, and parses the declarations, then
asserts:

- the rule exists;
- `position` is one of `absolute`/`relative`/`fixed`/`sticky`, so a stacking
  value can take effect at all;
- an explicit `z-index` is present — this is the check that fails if someone
  removes it later;
- the value is a positive integer, and is below 200 (not inflated);
- `pointer-events` was **not** used on the photograph as a shortcut;
- `dist/css/style.css` is still byte-identical to the source;
- no announcement page, data file or content record was touched.

All four failure modes were confirmed by deliberately breaking the stylesheet:
removing the `z-index`, making the button `position: static`, and inflating the
value to `99999` each produced the expected failure, and each was then restored.

## 7. Browser testing performed

Both servers were run and all four pages exercised: the live pages from the
repository root and the generated pages from `dist/`, at **320, 360, 390, 430,
768 and 1280 px** — 24 page × width combinations.

At every width, on every page, nine representative announcements were opened,
covering each optional field combination:

| Case | Announcement (English index) |
| --- | --- |
| main photograph | #1 *Become a trustee…* |
| `object-fit: contain` | #3 *Beyond the Horizon: Pekao Challenge…* |
| custom image position | #1 (`center 22%`) |
| custom image background | #7 *Introducing the Polish Business Forum* (`#001f62`) |
| additional images | #21 *Polish Independence Day at the Embassy* |
| no main image | #13 *An academic debate at the Sikorski Institute* |
| external link | #15 *Honorary patrons of NeoQuartet's concerts…* |
| internal event link | #5 *Polish Business Forum 2026…* |
| closed registration | #1 |

For each, the button was hit-tested at its centre and at four points inside its
circular hit area; every probe returned the button. Also verified at each width:
`z-index` computed as `1`, no horizontal overflow, the button inside the
viewport, backdrop click closes, a click inside the panel does **not** close, and
no broken images. No console errors on any page.

### Real pointer clicks

**On the live pages, real pointer clicks were performed and are the primary
evidence.** The same coordinates were used before and after the fix:

- `announcements.html`, announcement #1 (has a photo), click at **(941, 124)** —
  the button's centre:
  - **before the fix:** the close handler did not fire and the modal stayed open;
  - **after the fix:** the handler fired, the modal closed and `document.body`
    scrolling was restored.
- `pl/announcements.html`, click at **(685, 149)**: handler fired, modal closed,
  scrolling restored.

**On the generated pages, real pointer clicks could not be completed.** Partway
through the session the browser tool's pointer input stopped reaching the page
entirely. This was isolated rather than assumed: with capture-phase listeners
installed for `pointerdown`, `mousedown`, `mouseup` and `click`, a click on the
close button produced **zero events**, and a control click on an ordinary
navigation link also produced zero events and did not navigate. The failure is in
the automation, not the pages.

The generated pages were therefore verified by hit-testing (above) plus the
structural facts that make the live result transfer: they load a stylesheet the
validator asserts is byte-identical to the fixed one, and
`compare-announcements.js` asserts their modal markup matches the live pages'.
Same CSS, same markup, same computed `z-index: 1`, same hit-test outcome.

A manual pointer check on the generated pages before cutover is still worth doing.

Keyboard and other close paths were confirmed working on the live pages by real
input: **Escape** closes the dialog, restores scrolling and returns focus to the
originating card (on the generated pages, which manage focus; the live pages
leave focus where it was, as they always have).

No screenshots were captured — the preview pane does not composite frames in this
environment, which is also why raw coordinate clicks were unavailable and
`ref`-resolved clicks were used instead. Every visual claim here rests on
measured geometry, computed styles and hit-testing.

### A measurement correction worth recording

An early version of the probe sampled the four corners of the button's bounding
box, inset by 6 px. That reported failures at some widths. The button is a
**circle** (`border-radius: 50%`, radius ≈ 20.4 px), and those probe points sit
≈ 20.3 px from the centre — right on the boundary, so sub-pixel rounding flipped
them in and out. The probe was corrected to sample points inside the circle. This
was a flaw in the test, not in the page; the centre probe passed throughout.

## 8. Remaining modal limitations

Unchanged by this fix, and all pre-existing:

- **No focus trap.** Tab from inside an open dialog walks into the page behind
  it. A trap is a real improvement but a behaviour change, so it is not smuggled
  into a CSS fix.
- **The live pages do not manage focus at all.** Opening a dialog leaves focus on
  the card behind the overlay; closing does not restore it. The generated pages
  already do both (Phase 6). This difference disappears at cutover.
- **The dialog's accessible name is generic** — "Announcement" / "Ogłoszenie"
  rather than the announcement's own title.
- **Cards are rendered client-side**, so with JavaScript disabled the page shows
  its heading and an empty grid.
- **The close button's focus ring is the browser default.** Adequate, and
  deliberately untouched here.

The first three are the natural content of a focused modal-accessibility pass;
none blocks cutover.
