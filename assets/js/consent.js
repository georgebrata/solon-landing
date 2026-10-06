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

  const CONSENT_VERSION = 1;
  const STORAGE_KEY = "solon_cookie_consent";
  const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
  const MAX_AGE_MS = COOKIE_MAX_AGE * 1000;
  const CATEGORIES = ["necessary", "analytics", "marketing"];
  const TRACKER_COOKIE_PREFIXES = [
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

  const win = root || {};
  const doc = typeof document !== "undefined" ? document : null;
  let current = deniedConsent();
  const ui = {
    root: null,
    banner: null,
    dialog: null,
    overlay: null,
    lastFocus: null,
  };

  /** @returns {{version: number, timestamp: string, necessary: boolean, analytics: boolean, marketing: boolean}} */
  function deniedConsent() {
    return {
      version: CONSENT_VERSION,
      timestamp: "",
      necessary: true,
      analytics: false,
      marketing: false,
    };
  }

  /** @returns {{version: number, timestamp: string, necessary: boolean, analytics: boolean, marketing: boolean}} */
  function grantedConsent() {
    return {
      version: CONSENT_VERSION,
      timestamp: new Date().toISOString(),
      necessary: true,
      analytics: true,
      marketing: true,
    };
  }

  /** @returns {string} */
  function nowIso() {
    return new Date().toISOString();
  }

  /**
   * @param {object} [value]
   * @returns {{version: number, timestamp: string, necessary: boolean, analytics: boolean, marketing: boolean}}
   */
  function cloneConsent(value) {
    return {
      version: CONSENT_VERSION,
      timestamp: value && value.timestamp ? value.timestamp : nowIso(),
      necessary: true,
      analytics: Boolean(value && value.analytics),
      marketing: Boolean(value && value.marketing),
    };
  }

  function setupGtagStub() {
    win.dataLayer = win.dataLayer || [];
    if (typeof win.gtag !== "function") {
      win.gtag = function gtag() {
        win.dataLayer.push(arguments); // skipcq: JS-W1023
      };
    }
  }

  /**
   * @param {object} [consent]
   * @returns {{ad_storage: string, ad_user_data: string, ad_personalization: string, analytics_storage: string}}
   */
  function consentModePayload(consent) {
    const analyticsGranted = Boolean(consent && consent.analytics);
    const marketingGranted = Boolean(consent && consent.marketing);
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

  /** @param {object} consent */
  function updateConsentMode(consent) {
    setupGtagStub();
    win.gtag("consent", "update", consentModePayload(consent));
  }

  /**
   * @param {string} name
   * @returns {string}
   */
  function readCookie(name) {
    if (!doc) return "";
    const parts = String(doc.cookie || "").split(";");
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.indexOf(`${name}=`) === 0) {
        return decodeURIComponent(trimmed.slice(name.length + 1));
      }
    }
    return "";
  }

  /**
   * @param {string} name
   * @param {string} value
   * @param {number} maxAge
   */
  function writeCookie(name, value, maxAge) {
    if (!doc) return;
    const secure = win.location && win.location.protocol === "https:" ? "; Secure" : "";
    doc.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
  }

  /** @returns {string} */
  function storageGet() {
    try {
      if (win.localStorage) {
        const fromLs = win.localStorage.getItem(STORAGE_KEY);
        if (fromLs) return fromLs;
      }
    } catch (err) {
      void err;
    }
    return readCookie(STORAGE_KEY);
  }

  /** @param {string} json */
  function storageSet(json) {
    try {
      if (win.localStorage) win.localStorage.setItem(STORAGE_KEY, json);
    } catch (err) {
      void err;
    }
    writeCookie(STORAGE_KEY, json, COOKIE_MAX_AGE);
  }

  /**
   * @param {string} raw
   * @returns {object|null}
   */
  function parseConsent(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (Number(parsed.version) !== CONSENT_VERSION) return null;
      if (!parsed.timestamp) return null;
      const then = Date.parse(parsed.timestamp);
      if (!then || Date.now() - then > MAX_AGE_MS) return null;
      return cloneConsent(parsed);
    } catch (err) {
      void err;
      return null;
    }
  }

  /** @returns {object|null} */
  function readStored() {
    return parseConsent(storageGet());
  }

  /**
   * @param {object} consent
   * @returns {object}
   */
  function persist(consent) {
    const stored = cloneConsent(consent);
    stored.timestamp = nowIso();
    stored.version = CONSENT_VERSION;
    storageSet(JSON.stringify(stored));
    current = stored;
    return stored;
  }

  /**
   * @param {string} category
   * @returns {boolean}
   */
  function hasConsent(category) {
    if (category === "necessary") return true;
    return Boolean(current && current[category]);
  }

  /** @returns {object} */
  function getConsent() {
    return cloneConsent(current);
  }

  /**
   * @param {Element} fromEl
   * @param {HTMLScriptElement} toEl
   */
  function copyAttributes(fromEl, toEl) {
    const attrs = fromEl.attributes ? Array.from(fromEl.attributes) : [];
    for (const attr of attrs) {
      const name = attr.name;
      if (
        name === "type" ||
        name === "data-consent-category" ||
        name === "data-consent-activated"
      ) {
        continue;
      }
      toEl.setAttribute(name, attr.value);
    }
  }

  /** @param {HTMLScriptElement} el */
  function activateInertScript(el) {
    if (!doc || !el || el.getAttribute("data-consent-activated") === "true") return;
    const script = doc.createElement("script");
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

  /** @param {object} consent */
  function activateInertScripts(consent) {
    if (!doc || typeof doc.querySelectorAll !== "function") return;
    const nodes = doc.querySelectorAll('script[type="text/plain"][data-consent-category]');
    for (const el of nodes) {
      const category = el.getAttribute("data-consent-category");
      if (category === "necessary" || (consent && consent[category])) {
        activateInertScript(el);
      }
    }
  }

  function expireTrackerCookies() {
    if (!doc || !doc.cookie) return;
    const host = (win.location && win.location.hostname) || "";
    const parts = String(doc.cookie).split(";");
    for (const part of parts) {
      const name = part.split("=")[0].trim();
      if (!name || name === STORAGE_KEY) continue;
      const match = TRACKER_COOKIE_PREFIXES.some((prefix) => name === prefix || name.indexOf(prefix) === 0);
      if (!match) continue;
      doc.cookie = `${name}=; Path=/; Max-Age=0`;
      if (host) {
        doc.cookie = `${name}=; Path=/; Max-Age=0; Domain=${host}`;
        if (host.indexOf(".") !== -1) {
          doc.cookie = `${name}=; Path=/; Max-Age=0; Domain=.${host}`;
        }
      }
    }
  }

  function disableLoadedTags() {
    try {
      if (typeof win.clarity === "function") win.clarity("consent", false);
    } catch (err) {
      void err;
    }
    try {
      if (typeof win.fbq === "function") win.fbq("consent", "revoke");
    } catch (err) {
      void err;
    }
    expireTrackerCookies();
  }

  /**
   * @param {object} consent
   * @param {{persist?: boolean}} [options]
   * @returns {object}
   */
  function applyChoice(consent, options) {
    const opts = options || {};
    let next = cloneConsent(consent);
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

  /** @returns {object} */
  function acceptAll() {
    const next = applyChoice(grantedConsent());
    hideBanner();
    closeDialog();
    return next;
  }

  /** @returns {object} */
  function rejectAll() {
    const next = applyChoice({
      necessary: true,
      analytics: false,
      marketing: false,
    });
    hideBanner();
    closeDialog();
    return next;
  }

  /**
   * @param {{analytics?: boolean, marketing?: boolean}} partial
   * @returns {object}
   */
  function saveCustom(partial) {
    const next = applyChoice({
      necessary: true,
      analytics: Boolean(partial && partial.analytics),
      marketing: Boolean(partial && partial.marketing),
    });
    hideBanner();
    closeDialog();
    return next;
  }

  /**
   * @param {string} selector
   * @returns {Element|null}
   */
  function qs(selector) {
    return ui.root ? ui.root.querySelector(selector) : null;
  }

  /** @returns {string} */
  function cookiesPolicyHref() {
    const path = (win.location && win.location.pathname) || "/";
    if (path === "/" || path === "/index.html") return "./cookies/";
    if (path.indexOf("/cookies") === 0) return "./";
    return "/cookies/";
  }

  /**
   * @param {string} tag
   * @param {Record<string, string>} [attrs]
   * @param {Array<Node|string>} [children]
   * @returns {HTMLElement}
   */
  function h(tag, attrs, children) {
    const node = doc.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((key) => {
        const value = attrs[key];
        if (value === null || value === undefined) return;
        if (key === "className") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "htmlFor") node.setAttribute("for", value);
        else node.setAttribute(key, value);
      });
    }
    (children || []).forEach((child) => {
      if (typeof child === "string") node.appendChild(doc.createTextNode(child));
      else if (child) node.appendChild(child);
    });
    return node;
  }

  function buildUi() {
    if (!doc || !doc.body || ui.root) return;
    const policy = cookiesPolicyHref();
    const root = h("div", { id: "solon-consent", className: "solon-consent" });

    const banner = h("div", {
      className: "solon-consent__banner",
      role: "dialog",
      "aria-modal": "false",
      "aria-labelledby": "solon-consent-title",
      "aria-describedby": "solon-consent-desc",
    });
    banner.hidden = true;
    const policyLink = h("a", {
      className: "solon-consent__policy",
      href: policy,
      text: "Politica de cookie-uri",
    });
    const desc = h("p", { id: "solon-consent-desc", className: "solon-consent__text" }, [
      "Folosim cookie-uri necesare pentru funcționarea site-ului și, doar cu acordul tău, cookie-uri de analiză și marketing. Citește ",
      policyLink,
      ".",
    ]);
    banner.appendChild(
      h("div", { className: "solon-consent__inner" }, [
        h("h2", { id: "solon-consent-title", className: "solon-consent__title", text: "Cookie-uri pe solon.agency" }),
        desc,
        h("div", { className: "solon-consent__actions" }, [
          h("button", { type: "button", className: "solon-consent__btn solon-consent__btn--accept", "data-consent-action": "accept", text: "Acceptă toate" }),
          h("button", { type: "button", className: "solon-consent__btn solon-consent__btn--reject", "data-consent-action": "reject", text: "Respinge toate" }),
          h("button", { type: "button", className: "solon-consent__btn solon-consent__btn--customize", "data-consent-action": "customize", "aria-haspopup": "dialog", text: "Personalizează" }),
        ]),
      ])
    );

    const overlay = h("div", { className: "solon-consent__overlay" });
    overlay.hidden = true;

    const necessaryInput = h("input", { id: "solon-consent-necessary", type: "checkbox" });
    necessaryInput.checked = true;
    necessaryInput.disabled = true;
    const analyticsInput = h("input", { id: "solon-consent-analytics", type: "checkbox" });
    const marketingInput = h("input", { id: "solon-consent-marketing", type: "checkbox" });

    const dialog = h("div", {
      className: "solon-consent__dialog",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "solon-consent-dialog-title",
      tabindex: "-1",
    });
    dialog.hidden = true;
    dialog.appendChild(
      h("div", { className: "solon-consent__dialog-inner" }, [
        h("h2", { id: "solon-consent-dialog-title", className: "solon-consent__dialog-title", text: "Setări cookie" }),
        h("p", { className: "solon-consent__text", text: "Poți accepta categoriile de mai jos sau le poți lăsa dezactivate. Cookie-urile necesare rămân active." }),
        h("div", { className: "solon-consent__categories" }, [
          h("div", { className: "solon-consent__category" }, [
            h("div", { className: "solon-consent__category-head" }, [
              h("label", { className: "solon-consent__label", htmlFor: "solon-consent-necessary", text: "Necesare" }),
              necessaryInput,
            ]),
            h("p", { className: "solon-consent__hint", text: "Memorează alegerea ta de consimțământ și țin site-ul funcțional. Nu pot fi dezactivate." }),
          ]),
          h("div", { className: "solon-consent__category" }, [
            h("div", { className: "solon-consent__category-head" }, [
              h("label", { className: "solon-consent__label", htmlFor: "solon-consent-analytics", text: "Analiză" }),
              analyticsInput,
            ]),
            h("p", { className: "solon-consent__hint", text: "Google Analytics 4, Microsoft Clarity, Ahrefs Analytics, Metricool și counter.dev — statistici de utilizare." }),
          ]),
          h("div", { className: "solon-consent__category" }, [
            h("div", { className: "solon-consent__category-head" }, [
              h("label", { className: "solon-consent__label", htmlFor: "solon-consent-marketing", text: "Marketing" }),
              marketingInput,
            ]),
            h("p", { className: "solon-consent__hint", text: "Meta Pixel și Brevo — măsurarea campaniilor. Pot implica publicitate măsurată." }),
          ]),
        ]),
        h("div", { className: "solon-consent__actions" }, [
          h("button", { type: "button", className: "solon-consent__btn solon-consent__btn--accept", "data-consent-action": "save", text: "Salvează" }),
          h("button", { type: "button", className: "solon-consent__btn solon-consent__btn--reject", "data-consent-action": "reject", text: "Respinge toate" }),
          h("button", { type: "button", className: "solon-consent__btn solon-consent__btn--customize", "data-consent-action": "close", text: "Închide" }),
        ]),
      ])
    );

    root.appendChild(banner);
    root.appendChild(overlay);
    root.appendChild(dialog);
    doc.body.appendChild(root);
    ui.root = root;
    ui.banner = banner;
    ui.dialog = dialog;
    ui.overlay = overlay;
    root.addEventListener("click", onUiClick);
    doc.addEventListener("keydown", onKeydown);
  }

  /** @param {MouseEvent} event */
  function onUiClick(event) {
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    if (!target || typeof target.closest !== "function") return;
    const btn = target.closest("[data-consent-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-consent-action");
    if (action === "accept") acceptAll();
    else if (action === "reject") rejectAll();
    else if (action === "customize") openPreferences();
    else if (action === "save") {
      saveCustom({
        analytics: Boolean(qs("#solon-consent-analytics") && qs("#solon-consent-analytics").checked),
        marketing: Boolean(qs("#solon-consent-marketing") && qs("#solon-consent-marketing").checked),
      });
    } else if (action === "close") closeDialog();
  }

  /**
   * @param {Element} container
   * @returns {HTMLElement[]}
   */
  function focusables(container) {
    if (!container || typeof container.querySelectorAll !== "function") return [];
    return Array.from(
      container.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null || el === doc.activeElement);
  }

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (!ui.dialog || ui.dialog.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(ui.dialog);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
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
    if (ui.banner) ui.banner.hidden = false;
  }

  function hideBanner() {
    if (ui.banner) ui.banner.hidden = true;
  }

  function syncToggles() {
    const analytics = qs("#solon-consent-analytics");
    const marketing = qs("#solon-consent-marketing");
    if (analytics) analytics.checked = Boolean(current.analytics);
    if (marketing) marketing.checked = Boolean(current.marketing);
  }

  function openPreferences() {
    buildUi();
    syncToggles();
    hideBanner();
    ui.lastFocus = doc.activeElement;
    if (ui.overlay) ui.overlay.hidden = false;
    if (ui.dialog) {
      ui.dialog.hidden = false;
      const closeBtn = ui.dialog.querySelector('[data-consent-action="close"]');
      const titleFocus = closeBtn || ui.dialog;
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
    doc.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : event.target.parentElement;
      if (!target || typeof target.closest !== "function") return;
      const link = target.closest("[data-solon-consent-open]");
      if (!link) return;
      event.preventDefault();
      openPreferences();
    });
  }

  function boot() {
    setConsentModeDefault();
    const stored = readStored();
    if (stored) {
      current = stored;
      updateConsentMode(stored);
    }
    if (!doc) return;
    const start = () => {
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

  const api = {
    CONSENT_VERSION,
    STORAGE_KEY,
    CATEGORIES,
    deniedConsent,
    readStored,
    getConsent,
    hasConsent,
    acceptAll,
    rejectAll,
    saveCustom,
    applyChoice,
    activateInertScripts,
    openPreferences,
    parseConsent,
    setConsentModeDefault,
    boot,
  };

  win.SolonConsent = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (doc) boot();
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
