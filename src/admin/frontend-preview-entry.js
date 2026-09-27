"use strict";
const nunjucks = require("nunjucks/browser/nunjucks-slim.js");
const { registerPublicFilters } = require("../../lib/public-rendering.js");
const { normaliseDatesDeep } = require("../_data/dateOnly.js");
const templates = require("PREVIEW_TEMPLATES");
const source = require("PREVIEW_DATA");
const eventComputed = require("../event.11tydata.js").eleventyComputed;
function clone(value) { return JSON.parse(JSON.stringify(value)); }
/*
  Which team card is the one being edited?

  Matching by name found the wrong card whenever two records shared a name —
  which is exactly what happens when a returning member gets a new record for a
  new committee year. So the draft is tagged instead: its e-mail is swapped for
  a token while the page renders, and the token's mailto link is then restored
  and marked. The public templates are not changed.
*/
const DRAFT_TOKEN = "fed-preview-draft-member";
function escapeAttr(value) {
  return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function script(text) { return "<script>" + text.replace(/<\/script/gi, "<\\/script") + "</script>"; }
function renderPreview(collection, draft, options) {
  options = options || {};
  const lang = options.lang === "pl" ? "pl" : "en";
  const locale = source.locales.find(l => l.code === lang);
  const records = clone(options.records || source.records);
  const name = collection === "standard_events" ? "event" : collection === "team" ? "team" : "announcements";
  const folder = name === "event" ? "events" : name;
  const record = normaliseDatesDeep(clone(draft || {}));
  // Preview a hidden draft without changing the stored entry or public rules.
  record.slug = record.slug || "preview-draft";
  record.published = true;
  record.academic_year = record.academic_year || records.settings.academicYear.current;
  record.en = record.en || {}; record.pl = record.pl || {};
  if (name === "event" && record.start_date == null) record.start_date = "";
  if (name === "announcements" && record.published_date == null) record.published_date = "";
  if (name === "team" && !record.group) record.group = records.settings.teamGroups.groups[0].key;
  const draftEmail = name === "team" ? (record.email || "") : null;
  if (name === "team") record.email = DRAFT_TOKEN;
  // A brand-new profile has no name yet; give its card one so there is
  // something to see and to scroll to. Preview only — the draft is a copy.
  if (name === "team" && !String(record.name || "").trim()) record.name = "New team member";
  records[folder] = (records[folder] || []).filter(r => r.slug !== record.slug && r.slug !== options.originalSlug).concat([record]);
  const env = new nunjucks.Environment(new nunjucks.PrecompiledLoader(templates), { autoescape: true });
  registerPublicFilters({ addFilter: (n, fn) => env.addFilter(n, fn), getFilter: n => env.getFilter(n) },
    { lookupEventBySlug: slug => records.events.find(e => e.slug === slug) || null });
  const front = source.pages[name];
  const context = Object.assign({}, front, {
    site: source.site, ui: source.ui, locales: source.locales, locale, nav: source.nav, records,
    noindex: true, page_pair: { event: record, locale }, pageTitle: "Preview", pageDescription: "Preview",
    scriptsBefore: [], scriptsAfter: [],
    // No cookie banner over the editor's preview (src/js/consent.js).
    noConsentBanner: true, urlPattern: front.urlPattern || "/{prefix}event-" + record.slug + ".html"
  });
  if (front.copy) {
    context.pageTitle = front.copy[lang].title;
    context.pageDescription = front.copy[lang].description;
  }
  if (name === "event") {
    for (const [key, fn] of Object.entries(eventComputed)) context[key] = fn(context);
    context.pageTitle = context.pageTitle || "Preview";
    context.pageDescription = context.pageDescription || "Preview";
  }
  context.content = env.render(name + ".njk", context);
  let html = env.render("layouts/base.njk", context);
  if (name === "team") {
    html = html.split('href="mailto:' + DRAFT_TOKEN + '"')
      .join('href="mailto:' + escapeAttr(draftEmail) + '" data-fed-draft="1"');
  }
  if (options.raw) return html;
  /*
    Social posts. On the public site they wait for cookie consent
    (src/js/consent.js); the preview has no banner, so it shows them as it
    always did — the editor is looking at their own content, not visiting.
  */
  html = html.split("data-consent-src=").join("src=")
    .replace(/<iframe\b[^>]*>/g, (tag) => tag.replace(/\shidden(?=[\s>])/, ""))
    .split('<script type="text/plain" src="https://www.instagram.com/embed.js">')
    .join('<script async src="https://www.instagram.com/embed.js">');
  const origin = options.origin || source.site.domain;
  html = html.replace("<head>", '<head><base href="' + origin.replace(/"/g, "&quot;") + "/" + locale.urlPrefix + '">');
  // Exact stylesheet text, refreshed from the public CSS on every CMS build.
  html = html.replace('<link rel="stylesheet" href="/css/style.css">',
    "<style>" + source.css.replace(/<\/style/gi, "<\\/style") + "</style>");
  html = html.replace('<script src="/js/main.js"></script>', script(source.scripts.main));
  if (name === "team") html = html.replace("</body>", script(source.scripts.team) + "</body>");
  if (name === "announcements") {
    const items = env.getFilter("announcementsAcrossYears")(records.announcements, lang);
    const years = env.getFilter("announcementYears")(records.announcements, lang, records.settings.academicYear.current);
    const values = "const ANNOUNCEMENTS=" + JSON.stringify(items) + ";\nconst ANNOUNCEMENT_YEARS=" +
      JSON.stringify(years) + ";\nconst ANNOUNCEMENTS_UI=" + JSON.stringify(source.ui[lang].announcements) + ";";
    html = html.replace("</body>", script(values) + script(source.scripts.announcements) + "</body>");
  }
  const target = name === "team" ? record.name : record[lang].title;
  const focus = { name, target: target || "", detail: options.detail !== false, scrollY: options.scrollY || 0 };
  if (name === "team") {
    html = html.replace("</head>", "<style>.fed-draft-card{outline:3px solid #6554dd;outline-offset:6px;" +
      "border-radius:14px;opacity:1!important;transform:none!important}</style></head>");
  }
  html = html.replace("</body>", script(
    "const previewFocus=" + JSON.stringify(focus) + ";\n" +
    "addEventListener('load',function(){setTimeout(function(){" +
    // Team: the tagged card, always kept in view and outlined — even after a
    // change of group, order or year moves it — while scrolling stays where
    // the editor left it whenever the card is already visible.
    "if(previewFocus.name==='team'){var link=document.querySelector('[data-fed-draft]');" +
    "var card=link&&link.closest('.member');if(card){card.classList.add('fed-draft-card');" +
    "var d=card.parentElement;while(d){if(d.tagName==='DETAILS')d.open=true;d=d.parentElement;}" +
    "if(previewFocus.scrollY)scrollTo(0,previewFocus.scrollY);" +
    // "In view" allows for the sticky site header, and is checked again once
    // web fonts have loaded, because a late font can move the card.
    "var keep=function(){var h=document.querySelector('header');var top=h?h.getBoundingClientRect().bottom:0;" +
    "var r=card.getBoundingClientRect();if(r.top<top||r.bottom>innerHeight)card.scrollIntoView({block:'center'});};" +
    "keep();if(document.fonts&&document.fonts.ready)document.fonts.ready.then(keep);}" +
    "else if(previewFocus.scrollY)scrollTo(0,previewFocus.scrollY);}else{" +
    "if(previewFocus.target){var title=Array.from(document.querySelectorAll('.ann-card h3')).find(function(n){return n.textContent===previewFocus.target;});" +
    "if(title){var year=title.closest('details');if(year)year.open=true;" +
    "if(previewFocus.detail)title.closest('.ann-card').click();" +
    "else if(!previewFocus.scrollY)title.scrollIntoView({block:'center'});}}" +
    "if(previewFocus.scrollY)scrollTo(0,previewFocus.scrollY);}" +
    "},160);});\n" +
    // Preserve scroll during typing through a narrow, one-way message.
    "addEventListener('scroll',function(){parent.postMessage({type:'fed-preview-scroll',y:scrollY},'*');},{passive:true});\n" +
    "document.addEventListener('click',function(e){var a=e.target.closest('a');if(a&&!a.getAttribute('href').startsWith('#'))e.preventDefault();});"
  ) + "</body>");
  return html;
}
window.FED_FRONTEND_PREVIEW = { render: renderPreview, records: source.records };
