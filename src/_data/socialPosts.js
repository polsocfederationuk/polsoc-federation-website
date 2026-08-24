/**
 * socialPosts.js — turn a stored public post address into safe markup inputs.
 *
 * WHAT THIS IS FOR
 *
 * An event may reference one public post per platform. The editor stores only a
 * URL; every piece of markup is generated here from a platform enum plus a
 * validated address. Nothing an editor types is ever rendered as HTML, and no
 * `<script>`, `<iframe src>` or "Copy embed code" snippet is stored in YAML.
 *
 * THE OFFICIAL MECHANISMS, as documented by each platform:
 *
 *   Instagram  blockquote.instagram-media + //www.instagram.com/embed.js.
 *              Unchanged from the existing implementation, which works.
 *
 *   Facebook   the Embedded Posts plugin, in its IFRAME form:
 *              /plugins/post.php?href=<encoded>. This needs no SDK, no app id
 *              and no credentials, so nothing loads until the frame does.
 *
 *   LinkedIn   /embed/feed/update/urn:li:<type>:<id>. LinkedIn's own
 *              documentation says the address comes from the post's own
 *              "Embed this post" option, so it is NOT reliably derivable from a
 *              public URL. We derive it where the URL clearly carries an
 *              activity id, and fall back to a plain link where it does not —
 *              which is why the fallback below is not decoration.
 *
 * EVERY post keeps a normal clickable link regardless. Third-party embeds fail
 * for ordinary reasons — the post is deleted or made private, the visitor blocks
 * tracking scripts, the platform is down — and the event page has to stay
 * useful when they do.
 */

"use strict";

/** Platforms in the order they should appear, with their strict address rules. */
const PLATFORMS = {
  instagram: {
    label: "Instagram",
    test: /^https:\/\/www\.instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?(\?\S*)?$/,
  },
  facebook: {
    label: "Facebook",
    test: /^https:\/\/(www\.)?facebook\.com\/\S+$/,
  },
  linkedin: {
    label: "LinkedIn",
    test: /^https:\/\/(www\.)?linkedin\.com\/(posts|feed\/update)\/\S+$/,
  },
};

/** Is this a public address on the platform it claims to be from? */
function isValid(platform, url) {
  const p = PLATFORMS[platform];
  if (!p || typeof url !== "string") return false;
  const u = url.trim();
  // Belt and braces over the pattern: no scheme other than https, and no
  // protocol-relative address that would inherit whatever the page is on.
  if (!/^https:\/\//.test(u)) return false;
  if (/[<>"']/.test(u)) return false;
  return p.test.test(u);
}

/**
 * The LinkedIn embed address, or null when one cannot be derived.
 *
 * A public post URL looks like
 *   /posts/<slug>-activity-<19 digits>-<hash>
 * and the digits are the activity id. Anything else — a company update, a
 * reshare, a format LinkedIn does not embed — returns null and gets a link.
 */
function linkedinEmbedSrc(url) {
  const m = /-activity-(\d{6,25})/.exec(String(url || ""));
  if (m) return `https://www.linkedin.com/embed/feed/update/urn:li:activity:${m[1]}`;
  const direct = /\/feed\/update\/(urn:li:[a-zA-Z]+:\d{6,25})/.exec(String(url || ""));
  return direct ? `https://www.linkedin.com/embed/feed/update/${direct[1]}` : null;
}

/** The Facebook Embedded Posts iframe address. */
function facebookEmbedSrc(url) {
  return "https://www.facebook.com/plugins/post.php?href=" +
    encodeURIComponent(url) + "&show_text=true&width=500";
}

/**
 * Everything the template needs for one event's social posts.
 *
 * Returns [] when there are none, so a page with no posts emits nothing at all
 * and every existing event's markup is unchanged.
 */
function socialPostsFor(event) {
  const e = event || {};
  const stored = [
    ["instagram", e.instagram_permalink],
    ["facebook", e.facebook_permalink],
    ["linkedin", e.linkedin_permalink],
  ];

  const out = [];
  for (const [platform, url] of stored) {
    if (!url || !isValid(platform, url)) continue;
    const post = { platform, label: PLATFORMS[platform].label, url, embed: null };
    if (platform === "facebook") post.embed = { kind: "iframe", src: facebookEmbedSrc(url) };
    if (platform === "linkedin") {
      const src = linkedinEmbedSrc(url);
      // No derivable id means no embed — and a link rather than an empty box.
      if (src) post.embed = { kind: "iframe", src };
    }
    if (platform === "instagram") post.embed = { kind: "instagram" };
    out.push(post);
  }
  return out;
}

/** Which third-party scripts does this page actually need? */
function scriptsFor(posts) {
  return {
    instagram: (posts || []).some((p) => p.platform === "instagram"),
  };
}

module.exports = {
  PLATFORMS, isValid, socialPostsFor, scriptsFor,
  linkedinEmbedSrc, facebookEmbedSrc,
};
