/**
 * mapTiles.js — the key for the members map's background tiles.
 *
 * Since September 2026 CARTO's free basemaps need an API key: without one,
 * every tile is stamped "API KEY REQUIRED". The key is free for non-profits
 * (up to 5 million tile requests a month) from https://carto.com/basemaps/apikey/
 *
 * It is read from the CARTO_BASEMAPS_KEY environment variable at build time
 * (Netlify → Site configuration → Environment variables), so changing it needs
 * no code change — only a new deploy. With no key set, the map still works and
 * shows the watermark.
 *
 * A basemaps key is not a secret: it travels in every tile request the
 * visitor's browser makes. Protect it in CARTO's dashboard instead, by
 * restricting it to polsocfederation.pl.
 */
"use strict";

module.exports = () => ({
  key: String(process.env.CARTO_BASEMAPS_KEY || "").trim(),
});
