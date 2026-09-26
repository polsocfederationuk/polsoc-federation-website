"use strict";
/** Build only the CMS preview runtime; this does not build or serve the website. */
const fs = require("fs"), path = require("path"), yaml = require("js-yaml");
const nunjucks = require("nunjucks"), esbuild = require("esbuild");
const root = path.join(__dirname, "..");
function split(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  return { data: match ? yaml.load(match[1]) : {}, body: match ? source.slice(match[0].length) : source };
}
function buildPreviewBundle() {
  const templates = {}, pages = {};
  function visit(dir, prefix) {
    for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
      if (file.isDirectory()) visit(path.join(dir, file.name), prefix + file.name + "/");
      else if (file.name.endsWith(".njk")) templates[prefix + file.name] = fs.readFileSync(path.join(dir, file.name), "utf8");
    }
  }
  visit(path.join(root, "src/_includes"), "");
  for (const name of ["event", "team", "announcements"]) {
    const page = split(fs.readFileSync(path.join(root, "src", name + ".njk"), "utf8"));
    templates[name + ".njk"] = page.body;
    pages[name] = page.data;
  }
  let compiled = "var window = {};\n";
  for (const [name, source] of Object.entries(templates)) compiled += nunjucks.precompileString(source, { name }) + "\n";
  compiled += "module.exports = window.nunjucksPrecompiled;\n";
  const records = require("../src/_data/records.js")();
  const readJSON = name => JSON.parse(fs.readFileSync(path.join(root, "src/_data", name + ".json"), "utf8"));
  const data = {
    pages, site: readJSON("site"), ui: readJSON("ui"),
    locales: readJSON("locales"), nav: readJSON("nav"),
    records: { team: records.team, announcements: records.announcements, events: records.events, settings: records.settings },
    css: fs.readFileSync(path.join(root, "css/style.css"), "utf8"),
    scripts: {
      main: fs.readFileSync(path.join(root, "js/main.js"), "utf8"),
      team: fs.readFileSync(path.join(root, "src/js/team-filter.js"), "utf8"),
      announcements: fs.readFileSync(path.join(root, "src/js/announcements-page.js"), "utf8")
    }
  };
  // buildSync cannot run esbuild plugins. Virtual modules are provided through
  // stdin imports using temporary-free data substitutions in the entry source.
  const source = fs.readFileSync(path.join(root, "src/admin/frontend-preview-entry.js"), "utf8")
    .replace('require("PREVIEW_TEMPLATES")', "(function(){var module={exports:{}};" + compiled + ";return module.exports;})()")
    .replace('require("PREVIEW_DATA")', JSON.stringify(data));
  const result = esbuild.buildSync({
    stdin: { contents: source, resolveDir: path.join(root, "src/admin"), sourcefile: "frontend-preview-entry.js" },
    bundle: true, write: false, platform: "browser", format: "iife", minify: true,
    nodePaths: require.resolve.paths("nunjucks"), logLevel: "silent"
  });
  if (result.warnings.length) throw new Error("Preview bundle warnings: " + result.warnings.map(w => w.text).join("; "));
  return result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
}
module.exports = { buildPreviewBundle, split };
