/**
 * focalPoint.js — the one place a stored image focus becomes a style value.
 *
 * The website crops images with `object-fit: cover`; which part survives is
 * decided by `object-position`. That string is built HERE and nowhere else, so
 * no template is in the business of assembling CSS out of stored data.
 *
 * That matters for safety as much as tidiness. These values reach a `style`
 * attribute, and the parser below is deliberately narrow: it recognises the
 * keywords and percentages the real records use and refuses everything else. A
 * value it does not recognise produces NOTHING rather than being passed through,
 * so no stored text can become arbitrary CSS.
 *
 * Two stored forms are accepted, for a reason that is historical rather than
 * aesthetic:
 *
 *   "center 30%"  — announcements, whose exact strings appear in the live site's
 *                   generated data file and are compared byte for byte
 *   { x, y }      — Team and standard events, added in Phase 17C.3 with no such
 *                   history, so they store the plainer coordinate pair
 *
 * The admin widget (src/admin/focal-point.js) reads and writes both through an
 * equivalent parser. The two are tested against the same cases.
 */

"use strict";

const KEYWORD_X = { left: 0, center: 50, centre: 50, right: 100 };
const KEYWORD_Y = { top: 0, center: 50, centre: 50, bottom: 100 };

const CENTRE = { x: 50, y: 50 };

const clamp = (n) => Math.max(0, Math.min(100, n));

/**
 * A stored focus as { x, y }, or null when it is not one this site can use.
 *
 * Null is a real answer and is treated as "no focus recorded" by every caller —
 * which renders exactly as the site did before focal points existed.
 */
function parseFocal(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "object" && !Array.isArray(value)) {
    // `Number(null)` is 0 and `Number("")` is 0, so a missing coordinate would
    // otherwise arrive as a perfectly valid top-left corner. Both must be
    // rejected: an incomplete pair is a fault to report, not a position.
    const raw = [value.x, value.y];
    if (raw.some((v) => v === null || v === undefined || v === "" || typeof v === "boolean")) return null;
    const x = Number(value.x);
    const y = Number(value.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < 0 || x > 100 || y < 0 || y > 100) return null;
    return { x, y };
  }

  if (typeof value !== "string") return null;

  const parts = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;

  // Out of range is REFUSED, not clamped. Clamping is right while dragging — the
  // pointer can leave the frame — but a stored "110%" is a mistake, and quietly
  // turning it into 100% would hide it forever.
  const pc = (t) => {
    const m = /^(\d+(?:\.\d+)?)%$/.exec(t);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return n >= 0 && n <= 100 ? n : null;
  };

  if (parts.length === 1) {
    const t = parts[0];
    if (Object.prototype.hasOwnProperty.call(KEYWORD_X, t)) return { x: KEYWORD_X[t], y: 50 };
    const n = pc(t);
    return n === null ? null : { x: n, y: 50 };
  }

  const x = Object.prototype.hasOwnProperty.call(KEYWORD_X, parts[0])
    ? KEYWORD_X[parts[0]] : pc(parts[0]);
  const y = Object.prototype.hasOwnProperty.call(KEYWORD_Y, parts[1])
    ? KEYWORD_Y[parts[1]] : pc(parts[1]);
  if (x === null || y === null) return null;
  return { x, y };
}

/**
 * The `object-position` value for a stored focus, or null.
 *
 * Null means "write no style at all", which is what keeps every record that has
 * never had a focus rendering byte-identically to before.
 */
function focalStyle(value) {
  const p = parseFocal(value);
  if (!p) return null;
  return `${Math.round(p.x)}% ${Math.round(p.y)}%`;
}

/**
 * A ready-to-insert style attribute, or an empty string.
 *
 * Templates call this rather than composing the attribute themselves, so the
 * "no focus means no attribute" rule cannot be got wrong in one template and
 * right in another.
 */
function focalStyleAttr(value) {
  const s = focalStyle(value);
  return s ? ` style="object-position: ${s}"` : "";
}

/**
 * Which rectangle of the SOURCE image survives `object-fit: cover`?
 *
 * The same arithmetic the browser performs, written out so the CMS can draw the
 * crop window on the original photograph and so it can be tested here rather
 * than only observed in a browser.
 *
 * The browser scales the image until it covers the target box, then slides it so
 * the focal percentage of the image sits at that percentage of the box. What
 * survives is a rectangle of the source: full height with the sides cropped when
 * the source is the wider of the two, full width with top and bottom cropped
 * when it is the taller.
 *
 * Returned as fractions of the source (0..1), so the answer does not depend on
 * how large the picture happens to be drawn.
 *
 * The admin widget carries an identical copy — it runs in the browser and cannot
 * require this module — and scripts/test-event-rules.js asserts the two bodies
 * match, so they cannot drift apart unnoticed.
 */
function coverRect(sw, sh, tw, th, focal) {
  if (!(sw > 0 && sh > 0 && tw > 0 && th > 0)) return null;

  const sourceRatio = sw / sh;
  const targetRatio = tw / th;

  let vw;
  let vh;
  if (sourceRatio > targetRatio) {
    vh = sh;
    vw = sh * targetRatio;
  } else {
    vw = sw;
    vh = sw / targetRatio;
  }

  const left = (sw - vw) * (clamp(focal.x) / 100);
  const top = (sh - vh) * (clamp(focal.y) / 100);

  return { left: left / sw, top: top / sh, width: vw / sw, height: vh / sh };
}

module.exports = { parseFocal, focalStyle, focalStyleAttr, coverRect, CENTRE };
