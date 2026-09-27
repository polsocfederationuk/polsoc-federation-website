/**
 * consent.js — the cookie banner, and what it actually controls.
 *
 * WHAT THE SITE STORES
 *
 * The site itself sets no tracking cookies and runs no analytics. The one thing
 * that does set third-party cookies is an embedded social post on an event page:
 * Instagram's embed script, and Facebook's and LinkedIn's iframes. So there are
 * two categories:
 *
 *   necessary  the consent choice itself (one cookie, `cc_cookie`). Always on.
 *   social     embedded Instagram, Facebook and LinkedIn posts. Off until the
 *              visitor accepts.
 *
 * A banner that blocked nothing would be decoration. Here, until "social" is
 * accepted, embedded posts are not loaded at all: the page shows a short note
 * with a button to allow them, and the plain "View on Instagram" link that
 * every post already carries. Accepting loads them in place, without a reload.
 *
 * THE LIBRARY is vanilla-cookieconsent 3.1.0 (MIT), pinned in package.json and
 * copied from node_modules at build time — served from this origin, like the
 * login page's identity library, never from a CDN.
 *
 * Language follows the page: <html lang="pl"> gets Polish.
 */
(function () {
  "use strict";
  var CC = window.CookieConsent;
  if (!CC || typeof CC.run !== "function") return;

  var polish = /^pl/i.test(document.documentElement.lang || "");
  // The privacy policy, in the page's language (src/privacy-policy.njk).
  var POLICY = polish ? "/pl/privacy-policy.html" : "/privacy-policy.html";

  var TEXT = {
    en: {
      consentModal: {
        title: "Cookies",
        description:
          "We use one cookie to remember your choice. Event pages can also show " +
          "posts from Instagram, Facebook and LinkedIn, which set their own cookies. " +
          "Those only load if you accept.",
        acceptAllBtn: "Accept",
        acceptNecessaryBtn: "Decline",
        showPreferencesBtn: "Choose",
        footer: '<a href="' + POLICY + '">Privacy policy</a>',
      },
      preferencesModal: {
        title: "Cookie settings",
        acceptAllBtn: "Accept all",
        acceptNecessaryBtn: "Decline all",
        savePreferencesBtn: "Save my choice",
        closeIconLabel: "Close",
        sections: [
          {
            title: "Necessary",
            description: "Remembers the choice you make here. It cannot be switched off.",
            linkedCategory: "necessary",
          },
          {
            title: "Social media posts",
            description:
              "Shows Instagram, Facebook and LinkedIn posts embedded on event pages. " +
              "Those services set their own cookies when a post is shown. If you " +
              "decline, you get a link to each post instead.",
            linkedCategory: "social",
          },
          {
            title: "More information",
            description: 'How we use and protect your personal data is set out in our <a href="' +
              POLICY + '">privacy policy</a>.',
          },
        ],
      },
      blocked: "This post comes from social media, which would set cookies.",
      allow: "Show social media posts",
    },
    pl: {
      consentModal: {
        title: "Pliki cookie",
        description:
          "Używamy jednego pliku cookie, aby zapamiętać Twój wybór. Strony wydarzeń " +
          "mogą też wyświetlać posty z Instagrama, Facebooka i LinkedIna, które " +
          "zapisują własne pliki cookie. Wczytują się one tylko po Twojej zgodzie.",
        acceptAllBtn: "Akceptuję",
        acceptNecessaryBtn: "Odrzucam",
        showPreferencesBtn: "Wybierz",
        footer: '<a href="' + POLICY + '">Polityka prywatności</a>',
      },
      preferencesModal: {
        title: "Ustawienia plików cookie",
        acceptAllBtn: "Akceptuję wszystkie",
        acceptNecessaryBtn: "Odrzucam wszystkie",
        savePreferencesBtn: "Zapisz wybór",
        closeIconLabel: "Zamknij",
        sections: [
          {
            title: "Niezbędne",
            description: "Zapamiętują wybór dokonany tutaj. Nie można ich wyłączyć.",
            linkedCategory: "necessary",
          },
          {
            title: "Posty z mediów społecznościowych",
            description:
              "Wyświetlają posty z Instagrama, Facebooka i LinkedIna osadzone na " +
              "stronach wydarzeń. Te serwisy zapisują własne pliki cookie, gdy post " +
              "jest wyświetlany. Jeśli odmówisz, zobaczysz link do każdego posta.",
            linkedCategory: "social",
          },
          {
            title: "Więcej informacji",
            description: 'Jak wykorzystujemy i chronimy Twoje dane osobowe, opisujemy w naszej <a href="' +
              POLICY + '">polityce prywatności</a>.',
          },
        ],
      },
      blocked: "Ten post pochodzi z mediów społecznościowych, które zapisałyby pliki cookie.",
      allow: "Pokaż posty z mediów społecznościowych",
    },
  };
  var words = polish ? TEXT.pl : TEXT.en;

  /* -- the embeds ----------------------------------------------------------- */

  var loaded = false;

  /** Load every embedded post on the page — only ever after consent. */
  function showEmbeds() {
    if (loaded) return;
    loaded = true;
    var notes = document.querySelectorAll(".fed-consent-note");
    for (var i = 0; i < notes.length; i++) notes[i].remove();
    var frames = document.querySelectorAll("iframe[data-consent-src]");
    for (var j = 0; j < frames.length; j++) {
      frames[j].src = frames[j].getAttribute("data-consent-src");
      frames[j].removeAttribute("data-consent-src");
      frames[j].hidden = false;
    }
    var scripts = document.querySelectorAll('script[type="text/plain"][data-consent-src]');
    for (var k = 0; k < scripts.length; k++) {
      var s = document.createElement("script");
      s.async = true;
      s.src = scripts[k].getAttribute("data-consent-src");
      scripts[k].parentNode.replaceChild(s, scripts[k]);
    }
  }

  /** In each embed's place, until consent: what it is, and a way to allow it. */
  function explainEmbeds() {
    var blocks = document.querySelectorAll(".insta-embed");
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (block.querySelector(".fed-consent-note")) continue;
      var note = document.createElement("div");
      note.className = "fed-consent-note";
      var p = document.createElement("p");
      p.textContent = words.blocked;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-ghost";
      button.textContent = words.allow;
      button.addEventListener("click", function () {
        CC.acceptCategory(["social"]);
      });
      note.appendChild(p);
      note.appendChild(button);
      block.insertBefore(note, block.firstChild);
    }
  }

  function apply() {
    if (CC.acceptedCategory("social")) showEmbeds();
    else explainEmbeds();
  }

  /* -- the banner ----------------------------------------------------------- */

  CC.run({
    cookie: { name: "cc_cookie", expiresAfterDays: 182 },
    guiOptions: {
      consentModal: { layout: "box", position: "bottom left", equalWeightButtons: true, flipButtons: false },
      preferencesModal: { layout: "box", equalWeightButtons: true, flipButtons: false },
    },
    categories: {
      necessary: { enabled: true, readOnly: true },
      social: {},
    },
    language: {
      default: polish ? "pl" : "en",
      translations: { en: TEXT.en, pl: TEXT.pl },
    },
    onConsent: apply,
    onChange: function () {
      // Withdrawing consent cannot un-load a post already shown; a reload
      // leaves the page as the new choice says.
      if (loaded && !CC.acceptedCategory("social")) window.location.reload();
      else apply();
    },
  });

  // Before any choice is made the embeds stay blocked and explained.
  if (!CC.validConsent || !CC.validConsent()) explainEmbeds();

  // "Cookie settings" in the footer.
  document.addEventListener("click", function (event) {
    var opener = event.target && event.target.closest && event.target.closest("[data-fed-cookie-settings]");
    if (!opener) return;
    event.preventDefault();
    CC.showPreferences();
  });
})();
