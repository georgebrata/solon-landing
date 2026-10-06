/**
 * SOLON cookie consent manager (GDPR / ePrivacy).
 *
 * Storage
 *   localStorage + first-party cookie key: `solon_cookie_consent`
 *   Schema: {
 *     version: number,          // CONSENT_VERSION below; bump to re-prompt everyone
 *     timestamp: string,        // ISO-8601
 *     necessary: true,          // always on
 *     analytics: boolean,       // GA4, Clarity, Ahrefs, Metricool, counter.dev
 *     marketing: boolean        // Meta Pixel, Brevo
 *   }
 *   Retention: 12 months from timestamp. Version mismatch or expiry → re-prompt.
 *
 * Google Consent Mode v2 defaults (denied) are written to dataLayer before any
 * gtag/GTM tag is activated. Tracker <script type="text/plain" data-consent-category="...">
 * tags stay inert until the matching category is granted.
 */
(function (root) {
  "use strict";

  var CONSENT_VERSION = 1;
  var STORAGE_KEY = "solon_cookie_consent";
  var COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
  var MAX_AGE_MS = COOKIE_MAX_AGE * 1000;
  var CATEGORIES = ["necessary", "analytics", "marketing"];
  var TRACKER_COOKIE_PREFIXES = [
    "_ga",
    "_gid",
    "_gat",
    "_gcl",
    "_clck",
    "_clsk",
    "_fbp",
    "_fbc",
    "CLID",
    "ANONCHK",
    "SM",
    "MUID",
  ];

  var win = typeof root !== "undefined" ? root : {};
  var doc = typeof document !== "undefined" ? document : null;
  var current = deniedConsent();
  var ui = {
    root: null,
    banner: null,
    dialog: null,
    lastFocus: null,
  };
  var scriptsActivated = { analytics: false, marketing: false };

  function deniedConsent() {
    return {
      version: CONSENT_VERSION,
      timestamp: "",
      necessary: true,
      analytics: false,
      marketing: false,
    };
  }

  function grantedConsent() {
    return {
      version: CONSENT_VERSION,
      timestamp: new Date().toISOString(),
      necessary: true,
      analytics: true,
      marketing: true,
    };
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function cloneConsent(value) {
    return {
      version: CONSENT_VERSION,
      timestamp: value && value.timestamp ? value.timestamp : nowIso(),
      necessary: true,
      analytics: !!(value && value.analytics),
      marketing: !!(value && value.marketing),
    };
  }

  function setupGtagStub() {
    win.dataLayer = win.dataLayer || [];
    if (typeof win.gtag !== "function") {
      win.gtag = function gtag() {
        win.dataLayer.push(arguments);
      };
    }
  }

  function consentModePayload(consent) {
    var analyticsGranted = !!(consent && consent.analytics);
    var marketingGranted = !!(consent && consent.marketing);
    return {
      ad_storage: marketingGranted ? "granted" : "denied",
      ad_user_data: marketingGranted ? "granted" : "denied",
      ad_personalization: marketingGranted ? "granted" : "denied",
      analytics_storage: analyticsGranted ? "granted" : "denied",
    };
  }

  function setConsentModeDefault() {
    setupGtagStub();
    win.gtag(
      "consent",
      "default",
      Object.assign({ wait_for_update: 500 }, consentModePayload(deniedConsent()))
    );
  }

  function updateConsentMode(consent) {
    setupGtagStub();
    win.gtag("consent", "update", consentModePayload(consent));
  }

  function readCookie(name) {
    if (!doc) return "";
    var parts = String(doc.cookie || "").split(";");
    for (var i = 0; i < parts.length; i += 1) {
      var part = parts[i].trim();
      if (part.indexOf(name + "=") === 0) {
        return decodeURIComponent(part.slice(name.length + 1));
      }
    }
    return "";
  }

  function writeCookie(name, value, maxAge) {
    if (!doc) return;
    var secure = win.location && win.location.protocol === "https:" ? "; Secure" : "";
    doc.cookie =
      name +
      "=" +
      encodeURIComponent(value) +
      "; Path=/; Max-Age=" +
      maxAge +
      "; SameSite=Lax" +
      secure;
  }

  function storageGet() {
    try {
      if (win.localStorage) {
        var fromLs = win.localStorage.getItem(STORAGE_KEY);
        if (fromLs) return fromLs;
      }
    } catch (err) {
      /* private mode */
    }
    return readCookie(STORAGE_KEY);
  }

  function storageSet(json) {
    try {
      if (win.localStorage) win.localStorage.setItem(STORAGE_KEY, json);
    } catch (err) {
      /* private mode */
    }
    writeCookie(STORAGE_KEY, json, COOKIE_MAX_AGE);
  }

  function parseConsent(raw) {
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (Number(parsed.version) !== CONSENT_VERSION) return null;
      if (!parsed.timestamp) return null;
      var then = Date.parse(parsed.timestamp);
      if (!then || Date.now() - then > MAX_AGE_MS) return null;
      return cloneConsent(parsed);
    } catch (err) {
      return null;
    }
  }

  function readStored() {
    return parseConsent(storageGet());
  }

  function persist(consent) {
    var stored = cloneConsent(consent);
    stored.timestamp = nowIso();
    stored.version = CONSENT_VERSION;
    storageSet(JSON.stringify(stored));
    current = stored;
    return stored;
  }

  function hasConsent(category) {
    if (category === "necessary") return true;
    return !!(current && current[category]);
  }

  function getConsent() {
    return cloneConsent(current);
  }

  function copyAttributes(fromEl, toEl) {
    var attrs = fromEl.attributes ? Array.prototype.slice.call(fromEl.attributes) : [];
    for (var i = 0; i < attrs.length; i += 1) {
      var name = attrs[i].name;
      if (
        name === "type" ||
        name === "data-consent-category" ||
        name === "data-consent-activated"
      ) {
        continue;
      }
      toEl.setAttribute(name, attrs[i].value);
    }
  }

  function activateInertScript(el) {
    if (!doc || !el || el.getAttribute("data-consent-activated") === "true") return;
    var script = doc.createElement("script");
    copyAttributes(el, script);
    if (!el.getAttribute("src")) {
      script.text = el.textContent || "";
    }
    el.setAttribute("data-consent-activated", "true");
    if (el.parentNode) {
      el.parentNode.insertBefore(script, el);
      el.parentNode.removeChild(el);
    } else {
      doc.head.appendChild(script);
    }
  }

  function activateInertScripts(consent) {
    if (!doc || typeof doc.querySelectorAll !== "function") return;
    var nodes = doc.querySelectorAll(
      'script[type="text/plain"][data-consent-category]'
    );
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      var category = el.getAttribute("data-consent-category");
      if (category === "necessary" || (consent && consent[category])) {
        activateInertScript(el);
      }
    }
    if (consent && consent.analytics) scriptsActivated.analytics = true;
    if (consent && consent.marketing) scriptsActivated.marketing = true;
  }

  function expireTrackerCookies() {
    if (!doc || !doc.cookie) return;
    var host = (win.location && win.location.hostname) || "";
    var parts = String(doc.cookie).split(";");
    for (var i = 0; i < parts.length; i += 1) {
      var name = parts[i].split("=")[0].trim();
      if (!name || name === STORAGE_KEY) continue;
      var match = TRACKER_COOKIE_PREFIXES.some(function (prefix) {
        return name === prefix || name.indexOf(prefix) === 0;
      });
      if (!match) continue;
      doc.cookie = name + "=; Path=/; Max-Age=0";
      if (host) {
        doc.cookie = name + "=; Path=/; Max-Age=0; Domain=" + host;
        if (host.indexOf(".") !== -1) {
          doc.cookie = name + "=; Path=/; Max-Age=0; Domain=." + host;
        }
      }
    }
  }

  function disableLoadedTags() {
    try {
      if (typeof win.clarity === "function") win.clarity("consent", false);
    } catch (err) {
      /* Clarity may be absent */
    }
    try {
      if (typeof win.fbq === "function") {
        win.fbq("consent", "revoke");
      }
    } catch (err) {
      /* Meta pixel may be absent */
    }
    expireTrackerCookies();
  }

  function applyChoice(consent, options) {
    var opts = options || {};
    var next = cloneConsent(consent);
    if (opts.persist !== false) {
      next = persist(next);
    } else {
      current = next;
    }
    updateConsentMode(next);
    if (next.analytics || next.marketing) {
      activateInertScripts(next);
    }
    if (!next.analytics || !next.marketing) {
      disableLoadedTags();
    }
    return next;
  }

  function acceptAll() {
    var next = applyChoice(grantedConsent());
    hideBanner();
    closeDialog();
    return next;
  }

  function rejectAll() {
    var next = applyChoice({
      necessary: true,
      analytics: false,
      marketing: false,
    });
    hideBanner();
    closeDialog();
    return next;
  }

  function saveCustom(partial) {
    var next = applyChoice({
      necessary: true,
      analytics: !!(partial && partial.analytics),
      marketing: !!(partial && partial.marketing),
    });
    hideBanner();
    closeDialog();
    return next;
  }

  function qs(id) {
    return ui.root ? ui.root.querySelector(id) : null;
  }

  function cookiesPolicyHref() {
    var path = (win.location && win.location.pathname) || "/";
    if (path === "/" || path === "/index.html") return "./cookies/";
    if (path.indexOf("/cookies") === 0) return "./";
    return "/cookies/";
  }

  function buildUi() {
    if (!doc || !doc.body || ui.root) return;
    var policy = cookiesPolicyHref();
    var root = doc.createElement("div");
    root.id = "solon-consent";
    root.className = "solon-consent";
    root.innerHTML =
      '<div class="solon-consent__banner" hidden role="dialog" aria-modal="false" aria-labelledby="solon-consent-title" aria-describedby="solon-consent-desc">' +
      '<div class="solon-consent__inner">' +
      '<h2 id="solon-consent-title" class="solon-consent__title">Cookie-uri pe solon.agency</h2>' +
      '<p id="solon-consent-desc" class="solon-consent__text">Folosim cookie-uri necesare pentru funcționarea site-ului și, doar cu acordul tău, cookie-uri de analiză și marketing. Citește <a class="solon-consent__policy" href="' +
      policy +
      '">Politica de cookie-uri</a>.</p>' +
      '<div class="solon-consent__actions">' +
      '<button type="button" class="solon-consent__btn solon-consent__btn--accept" data-consent-action="accept">Acceptă toate</button>' +
      '<button type="button" class="solon-consent__btn solon-consent__btn--reject" data-consent-action="reject">Respinge toate</button>' +
      '<button type="button" class="solon-consent__btn solon-consent__btn--customize" data-consent-action="customize" aria-haspopup="dialog">Personalizează</button>' +
      "</div></div></div>" +
      '<div class="solon-consent__overlay" hidden></div>' +
      '<div class="solon-consent__dialog" hidden role="dialog" aria-modal="true" aria-labelledby="solon-consent-dialog-title" tabindex="-1">' +
      '<div class="solon-consent__dialog-inner">' +
      '<h2 id="solon-consent-dialog-title" class="solon-consent__dialog-title">Setări cookie</h2>' +
      '<p class="solon-consent__text">Poți accepta categoriile de mai jos sau le poți lăsa dezactivate. Cookie-urile necesare rămân active.</p>' +
      '<div class="solon-consent__categories">' +
      '<div class="solon-consent__category">' +
      '<div class="solon-consent__category-head">' +
      '<label class="solon-consent__label" for="solon-consent-necessary">Necesare</label>' +
      '<input id="solon-consent-necessary" type="checkbox" checked disabled>' +
      "</div>" +
      '<p class="solon-consent__hint">Memorează alegerea ta de consimțământ și țin site-ul funcțional. Nu pot fi dezactivate.</p>' +
      "</div>" +
      '<div class="solon-consent__category">' +
      '<div class="solon-consent__category-head">' +
      '<label class="solon-consent__label" for="solon-consent-analytics">Analiză</label>' +
      '<input id="solon-consent-analytics" type="checkbox">' +
      "</div>" +
      '<p class="solon-consent__hint">Google Analytics 4, Microsoft Clarity, Ahrefs Analytics, Metricool și counter.dev — statistici de utilizare.</p>' +
      "</div>" +
      '<div class="solon-consent__category">' +
      '<div class="solon-consent__category-head">' +
      '<label class="solon-consent__label" for="solon-consent-marketing">Marketing</label>' +
      '<input id="solon-consent-marketing" type="checkbox">' +
      "</div>" +
      '<p class="solon-consent__hint">Meta Pixel și Brevo — măsurarea campaniilor. Pot implica publicitate măsurată.</p>' +
      "</div></div>" +
      '<div class="solon-consent__actions">' +
      '<button type="button" class="solon-consent__btn solon-consent__btn--accept" data-consent-action="save">Salvează</button>' +
      '<button type="button" class="solon-consent__btn solon-consent__btn--reject" data-consent-action="reject">Respinge toate</button>' +
      '<button type="button" class="solon-consent__btn solon-consent__btn--customize" data-consent-action="close">Închide</button>' +
      "</div></div></div>";
    doc.body.appendChild(root);
    ui.root = root;
    ui.banner = root.querySelector(".solon-consent__banner");
    ui.dialog = root.querySelector(".solon-consent__dialog");
    ui.overlay = root.querySelector(".solon-consent__overlay");
    root.addEventListener("click", onUiClick);
    doc.addEventListener("keydown", onKeydown);
  }

  function onUiClick(event) {
    var btn = event.target.closest("[data-consent-action]");
    if (!btn) return;
    var action = btn.getAttribute("data-consent-action");
    if (action === "accept") acceptAll();
    else if (action === "reject") rejectAll();
    else if (action === "customize") openPreferences();
    else if (action === "save") {
      saveCustom({
        analytics: !!(qs("#solon-consent-analytics") && qs("#solon-consent-analytics").checked),
        marketing: !!(qs("#solon-consent-marketing") && qs("#solon-consent-marketing").checked),
      });
    } else if (action === "close") closeDialog();
  }

  function focusables(container) {
    if (!container || typeof container.querySelectorAll !== "function") return [];
    return Array.prototype.slice.call(
      container.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])'
      )
    ).filter(function (el) {
      return el.offsetParent !== null || el === doc.activeElement;
    });
  }

  function onKeydown(event) {
    if (!ui.dialog || ui.dialog.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") return;
    var items = focusables(ui.dialog);
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && doc.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function showBanner() {
    buildUi();
    if (!ui.banner) return;
    ui.banner.hidden = false;
  }

  function hideBanner() {
    if (ui.banner) ui.banner.hidden = true;
  }

  function syncToggles() {
    var analytics = qs("#solon-consent-analytics");
    var marketing = qs("#solon-consent-marketing");
    if (analytics) analytics.checked = !!current.analytics;
    if (marketing) marketing.checked = !!current.marketing;
  }

  function openPreferences() {
    buildUi();
    syncToggles();
    hideBanner();
    ui.lastFocus = doc.activeElement;
    if (ui.overlay) ui.overlay.hidden = false;
    if (ui.dialog) {
      ui.dialog.hidden = false;
      var closeBtn = ui.dialog.querySelector('[data-consent-action="close"]');
      var titleFocus = closeBtn || ui.dialog;
      if (titleFocus && typeof titleFocus.focus === "function") titleFocus.focus();
    }
  }

  function closeDialog() {
    if (ui.dialog) ui.dialog.hidden = true;
    if (ui.overlay) ui.overlay.hidden = true;
    if (!readStored()) showBanner();
    if (ui.lastFocus && typeof ui.lastFocus.focus === "function") {
      ui.lastFocus.focus();
    }
    ui.lastFocus = null;
  }

  function bindFooterLinks() {
    if (!doc) return;
    doc.addEventListener("click", function (event) {
      var link = event.target.closest("[data-solon-consent-open]");
      if (!link) return;
      event.preventDefault();
      openPreferences();
    });
  }

  function boot() {
    setConsentModeDefault();
    var stored = readStored();
    if (stored) {
      current = stored;
      updateConsentMode(stored);
    }
    if (!doc) return;
    var start = function () {
      buildUi();
      bindFooterLinks();
      if (stored) {
        activateInertScripts(stored);
        hideBanner();
      } else {
        showBanner();
      }
    };
    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
  }

  var api = {
    CONSENT_VERSION: CONSENT_VERSION,
    STORAGE_KEY: STORAGE_KEY,
    CATEGORIES: CATEGORIES,
    deniedConsent: deniedConsent,
    readStored: readStored,
    getConsent: getConsent,
    hasConsent: hasConsent,
    acceptAll: acceptAll,
    rejectAll: rejectAll,
    saveCustom: saveCustom,
    applyChoice: applyChoice,
    activateInertScripts: activateInertScripts,
    openPreferences: openPreferences,
    parseConsent: parseConsent,
    setConsentModeDefault: setConsentModeDefault,
    boot: boot,
  };

  win.SolonConsent = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (doc) boot();
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
