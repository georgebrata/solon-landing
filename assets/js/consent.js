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

/** @returns {object} */
function resolveConsentGlobal() {
  if (typeof window !== "undefined") {
    return window;
  }
  return globalThis;
}

/** @returns {Document|null} */
function resolveConsentDocument() {
  if (typeof document !== "undefined") {
    return document;
  }
  return null;
}

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
  const SKIP_SCRIPT_ATTRS = {
    type: true,
    "data-consent-category": true,
    "data-consent-activated": true,
  };

  const win = root;
  const doc = resolveConsentDocument();
  const ui = {
    root: null,
    banner: null,
    dialog: null,
    overlay: null,
    lastFocus: null,
  };

  /** @returns {string} */
  function nowIso() {
    return new Date().toISOString();
  }

  /**
   * @returns {{version: number, timestamp: string, necessary: boolean, analytics: boolean, marketing: boolean}}
   */
  function deniedConsent() {
    return {
      version: CONSENT_VERSION,
      timestamp: "",
      necessary: true,
      analytics: false,
      marketing: false,
    };
  }

  /**
   * @returns {{version: number, timestamp: string, necessary: boolean, analytics: boolean, marketing: boolean}}
   */
  function grantedConsent() {
    return {
      version: CONSENT_VERSION,
      timestamp: nowIso(),
      necessary: true,
      analytics: true,
      marketing: true,
    };
  }

  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  function isGrantedFlag(value) {
    return value === true;
  }

  /**
   * @param {object} [value]
   * @returns {{version: number, timestamp: string, necessary: boolean, analytics: boolean, marketing: boolean}}
   */
  function cloneConsent(value) {
    const source = value || {};
    let timestamp = nowIso();
    if (source.timestamp) {
      timestamp = source.timestamp;
    }
    return {
      version: CONSENT_VERSION,
      timestamp,
      necessary: true,
      analytics: isGrantedFlag(source.analytics),
      marketing: isGrantedFlag(source.marketing),
    };
  }

  let current = deniedConsent();

  /** Installs a dataLayer-backed gtag stub before any vendor tag runs.
   * @returns {void}
   */
  function setupGtagStub() {
    if (!win.dataLayer) {
      win.dataLayer = [];
    }
    if (typeof win.gtag === "function") {
      return;
    }
    /**
     * @param {...unknown} gtagArgs
     * @returns {void}
     */
    function gtag(...gtagArgs) {
      win.dataLayer.push(gtagArgs);
    }
    win.gtag = gtag;
  }

  /**
   * @param {unknown} granted
   * @returns {"granted"|"denied"}
   */
  function modeState(granted) {
    if (granted) {
      return "granted";
    }
    return "denied";
  }

  /**
   * @param {object} [consent]
   * @returns {{ad_storage: string, ad_user_data: string, ad_personalization: string, analytics_storage: string}}
   */
  function consentModePayload(consent) {
    const source = consent || {};
    const analyticsState = modeState(source.analytics);
    const marketingState = modeState(source.marketing);
    return {
      ad_storage: marketingState,
      ad_user_data: marketingState,
      ad_personalization: marketingState,
      analytics_storage: analyticsState,
    };
  }

  /** Writes Consent Mode v2 defaults (denied) before gtag.js can load.
   * @returns {void}
   */
  function setConsentModeDefault() {
    setupGtagStub();
    const payload = consentModePayload(deniedConsent());
    payload.wait_for_update = 500;
    win.gtag("consent", "default", payload);
  }

  /**
   * @param {object} consent
   * @returns {void}
   */
  function updateConsentMode(consent) {
    setupGtagStub();
    win.gtag("consent", "update", consentModePayload(consent));
  }

  /**
   * @param {string} name
   * @returns {string}
   */
  function readCookie(name) {
    if (!doc) {
      return "";
    }
    const parts = String(doc.cookie || "").split(";");
    const prefix = `${name}=`;
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) {
        return decodeURIComponent(trimmed.slice(prefix.length));
      }
    }
    return "";
  }

  /**
   * @param {string} name
   * @param {string} value
   * @param {number} maxAge
   * @returns {void}
   */
  function writeCookie(name, value, maxAge) {
    if (!doc) {
      return;
    }
    let secure = "";
    if (win.location && win.location.protocol === "https:") {
      secure = "; Secure";
    }
    doc.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
  }

  /** @returns {string} */
  function readLocalStorage() {
    try {
      if (!win.localStorage) {
        return "";
      }
      return win.localStorage.getItem(STORAGE_KEY) || "";
    } catch {
      return "";
    }
  }

  /** @returns {string} */
  function storageGet() {
    const fromLs = readLocalStorage();
    if (fromLs) {
      return fromLs;
    }
    return readCookie(STORAGE_KEY);
  }

  /**
   * @param {string} json
   * @returns {boolean}
   */
  function writeLocalStorage(json) {
    try {
      if (win.localStorage) {
        win.localStorage.setItem(STORAGE_KEY, json);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @param {string} json
   * @returns {void}
   */
  function storageSet(json) {
    writeLocalStorage(json);
    writeCookie(STORAGE_KEY, json, COOKIE_MAX_AGE);
  }

  /**
   * @param {string} raw
   * @returns {object|null}
   */
  function parseConsent(raw) {
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      if (Number(parsed.version) !== CONSENT_VERSION) {
        return null;
      }
      if (!parsed.timestamp) {
        return null;
      }
      const then = Date.parse(parsed.timestamp);
      if (!then || Date.now() - then > MAX_AGE_MS) {
        return null;
      }
      return cloneConsent(parsed);
    } catch {
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
    if (category === "necessary") {
      return true;
    }
    return isGrantedFlag(current && current[category]);
  }

  /** @returns {object} */
  function getConsent() {
    return cloneConsent(current);
  }

  /**
   * @param {Element} fromEl
   * @param {HTMLScriptElement} toEl
   * @returns {void}
   */
  function copyAttributes(fromEl, toEl) {
    let attrs = [];
    if (fromEl.attributes) {
      attrs = Array.from(fromEl.attributes);
    }
    for (const attr of attrs) {
      if (!SKIP_SCRIPT_ATTRS[attr.name]) {
        toEl.setAttribute(attr.name, attr.value);
      }
    }
  }

  /**
   * @param {HTMLScriptElement} el
   * @returns {void}
   */
  function activateInertScript(el) {
    if (!doc || !el || el.getAttribute("data-consent-activated") === "true") {
      return;
    }
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

  /**
   * @param {object} consent
   * @returns {void}
   */
  function activateInertScripts(consent) {
    if (!doc || typeof doc.querySelectorAll !== "function") {
      return;
    }
    const nodes = doc.querySelectorAll('script[type="text/plain"][data-consent-category]');
    const granted = consent || {};
    for (const el of nodes) {
      const category = el.getAttribute("data-consent-category");
      if (category === "necessary" || granted[category]) {
        activateInertScript(el);
      }
    }
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  function isTrackerCookie(name) {
    if (!name || name === STORAGE_KEY) {
      return false;
    }
    for (const prefix of TRACKER_COOKIE_PREFIXES) {
      if (name === prefix || name.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  /** Clears known first-party tracker cookies after withdrawal.
   * @returns {void}
   */
  function expireTrackerCookies() {
    if (!doc || !doc.cookie) {
      return;
    }
    const host = (win.location && win.location.hostname) || "";
    const parts = String(doc.cookie).split(";");
    for (const part of parts) {
      const name = part.split("=")[0].trim();
      if (isTrackerCookie(name)) {
        doc.cookie = `${name}=; Path=/; Max-Age=0`;
        if (host) {
          doc.cookie = `${name}=; Path=/; Max-Age=0; Domain=${host}`;
          if (host.includes(".")) {
            doc.cookie = `${name}=; Path=/; Max-Age=0; Domain=.${host}`;
          }
        }
      }
    }
  }

  /**
   * @param {Function} fn
   * @returns {boolean}
   */
  function tryCall(fn) {
    try {
      fn();
      return true;
    } catch {
      return false;
    }
  }

  /** Asks already-loaded tags to stop tracking after a category is withdrawn.
   * @returns {void}
   */
  function disableLoadedTags() {
    /** Revokes Clarity tracking if the tag already ran.
     * @returns {void}
     */
    function revokeClarity() {
      if (typeof win.clarity === "function") {
        win.clarity("consent", false);
      }
    }
    /** Revokes Meta Pixel tracking if the tag already ran.
     * @returns {void}
     */
    function revokeFbq() {
      if (typeof win.fbq === "function") {
        win.fbq("consent", "revoke");
      }
    }
    tryCall(revokeClarity);
    tryCall(revokeFbq);
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
    const source = partial || {};
    const next = applyChoice({
      necessary: true,
      analytics: isGrantedFlag(source.analytics),
      marketing: isGrantedFlag(source.marketing),
    });
    hideBanner();
    closeDialog();
    return next;
  }

  /** Reads customize-dialog toggles and persists that mix.
   * @returns {void}
   */
  function saveFromToggles() {
    const analyticsEl = qs("#solon-consent-analytics");
    const marketingEl = qs("#solon-consent-marketing");
    let analyticsOn = false;
    let marketingOn = false;
    if (analyticsEl && analyticsEl.checked) {
      analyticsOn = true;
    }
    if (marketingEl && marketingEl.checked) {
      marketingOn = true;
    }
    saveCustom({
      analytics: analyticsOn,
      marketing: marketingOn,
    });
  }

  /**
   * @param {string} selector
   * @returns {Element|null}
   */
  function qs(selector) {
    if (!ui.root) {
      return null;
    }
    return ui.root.querySelector(selector);
  }

  /** @returns {string} */
  function cookiesPolicyHref() {
    const path = (win.location && win.location.pathname) || "/";
    if (path === "/" || path === "/index.html") {
      return "./cookies/";
    }
    if (path.startsWith("/cookies")) {
      return "./";
    }
    return "/cookies/";
  }

  /**
   * @param {HTMLElement} node
   * @param {string} key
   * @param {unknown} value
   * @returns {void}
   */
  function applyAttr(node, key, value) {
    if (value === null || value === undefined) {
      return;
    }
    if (key === "className") {
      node.className = String(value);
      return;
    }
    if (key === "text") {
      node.textContent = String(value);
      return;
    }
    if (key === "htmlFor") {
      node.setAttribute("for", String(value));
      return;
    }
    node.setAttribute(key, String(value));
  }

  /**
   * @param {HTMLElement} node
   * @param {Node|string|null} child
   * @returns {void}
   */
  function appendChildNode(node, child) {
    if (typeof child === "string") {
      node.appendChild(doc.createTextNode(child));
      return;
    }
    if (child) {
      node.appendChild(child);
    }
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
      for (const key of Object.keys(attrs)) {
        applyAttr(node, key, attrs[key]);
      }
    }
    let list = children;
    if (!list) {
      list = [];
    }
    for (const child of list) {
      appendChildNode(node, child);
    }
    return node;
  }

  /**
   * @param {HTMLElement} node
   * @returns {void}
   */
  function hideNode(node) {
    node.hidden = true;
  }

  /**
   * @returns {HTMLElement}
   */
  function createBanner() {
    const policy = cookiesPolicyHref();
    const banner = h("div", {
      className: "solon-consent__banner",
      role: "dialog",
      "aria-modal": "false",
      "aria-labelledby": "solon-consent-title",
      "aria-describedby": "solon-consent-desc",
    });
    hideNode(banner);
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
        h("h2", {
          id: "solon-consent-title",
          className: "solon-consent__title",
          text: "Cookie-uri pe solon.agency",
        }),
        desc,
        h("div", { className: "solon-consent__actions" }, [
          h("button", {
            type: "button",
            className: "solon-consent__btn solon-consent__btn--accept",
            "data-consent-action": "accept",
            text: "Acceptă toate",
          }),
          h("button", {
            type: "button",
            className: "solon-consent__btn solon-consent__btn--reject",
            "data-consent-action": "reject",
            text: "Respinge toate",
          }),
          h("button", {
            type: "button",
            className: "solon-consent__btn solon-consent__btn--customize",
            "data-consent-action": "customize",
            "aria-haspopup": "dialog",
            text: "Personalizează",
          }),
        ]),
      ])
    );
    return banner;
  }

  /**
   * @param {{id: string, label: string, hint: string, input: HTMLInputElement}} spec
   * @returns {HTMLElement}
   */
  function createCategory(spec) {
    return h("div", { className: "solon-consent__category" }, [
      h("div", { className: "solon-consent__category-head" }, [
        h("label", { className: "solon-consent__label", htmlFor: spec.id, text: spec.label }),
        spec.input,
      ]),
      h("p", { className: "solon-consent__hint", text: spec.hint }),
    ]);
  }

  /**
   * @returns {HTMLElement}
   */
  function createDialog() {
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
    hideNode(dialog);
    dialog.appendChild(
      h("div", { className: "solon-consent__dialog-inner" }, [
        h("h2", {
          id: "solon-consent-dialog-title",
          className: "solon-consent__dialog-title",
          text: "Setări cookie",
        }),
        h("p", {
          className: "solon-consent__text",
          text: "Poți accepta categoriile de mai jos sau le poți lăsa dezactivate. Cookie-urile necesare rămân active.",
        }),
        h("div", { className: "solon-consent__categories" }, [
          createCategory({
            id: "solon-consent-necessary",
            label: "Necesare",
            hint: "Memorează alegerea ta de consimțământ și țin site-ul funcțional. Nu pot fi dezactivate.",
            input: necessaryInput,
          }),
          createCategory({
            id: "solon-consent-analytics",
            label: "Analiză",
            hint: "Google Analytics 4, Microsoft Clarity, Ahrefs Analytics, Metricool și counter.dev — statistici de utilizare.",
            input: analyticsInput,
          }),
          createCategory({
            id: "solon-consent-marketing",
            label: "Marketing",
            hint: "Meta Pixel și Brevo — măsurarea campaniilor. Pot implica publicitate măsurată.",
            input: marketingInput,
          }),
        ]),
        h("div", { className: "solon-consent__actions" }, [
          h("button", {
            type: "button",
            className: "solon-consent__btn solon-consent__btn--accept",
            "data-consent-action": "save",
            text: "Salvează",
          }),
          h("button", {
            type: "button",
            className: "solon-consent__btn solon-consent__btn--reject",
            "data-consent-action": "reject",
            text: "Respinge toate",
          }),
          h("button", {
            type: "button",
            className: "solon-consent__btn solon-consent__btn--customize",
            "data-consent-action": "close",
            text: "Închide",
          }),
        ]),
      ])
    );
    return dialog;
  }

  /** Builds the banner, overlay, and preferences dialog once.
   * @returns {void}
   */
  function buildUi() {
    if (!doc || !doc.body || ui.root) {
      return;
    }
    const rootEl = h("div", { id: "solon-consent", className: "solon-consent" });
    const banner = createBanner();
    const overlay = h("div", { className: "solon-consent__overlay" });
    hideNode(overlay);
    const dialog = createDialog();
    rootEl.appendChild(banner);
    rootEl.appendChild(overlay);
    rootEl.appendChild(dialog);
    doc.body.appendChild(rootEl);
    ui.root = rootEl;
    ui.banner = banner;
    ui.dialog = dialog;
    ui.overlay = overlay;
    rootEl.addEventListener("click", onUiClick);
    doc.addEventListener("keydown", onKeydown);
  }

  /**
   * @param {Event} event
   * @returns {Element|null}
   */
  function eventElement(event) {
    if (event.target instanceof Element) {
      return event.target;
    }
    if (event.target && event.target.parentElement) {
      return event.target.parentElement;
    }
    return null;
  }

  /**
   * @param {MouseEvent} event
   * @returns {void}
   */
  function onUiClick(event) {
    const target = eventElement(event);
    if (!target || typeof target.closest !== "function") {
      return;
    }
    const btn = target.closest("[data-consent-action]");
    if (!btn) {
      return;
    }
    const action = btn.getAttribute("data-consent-action");
    if (action === "accept") {
      acceptAll();
      return;
    }
    if (action === "reject") {
      rejectAll();
      return;
    }
    if (action === "customize") {
      openPreferences();
      return;
    }
    if (action === "save") {
      saveFromToggles();
      return;
    }
    if (action === "close") {
      closeDialog();
    }
  }

  /**
   * @param {Element} container
   * @returns {HTMLElement[]}
   */
  function focusables(container) {
    if (!container || typeof container.querySelectorAll !== "function") {
      return [];
    }
    const nodes = container.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])'
    );
    const visible = [];
    for (const el of Array.from(nodes)) {
      if (el.offsetParent !== null || el === doc.activeElement) {
        visible.push(el);
      }
    }
    return visible;
  }

  /**
   * @param {KeyboardEvent} event
   * @returns {void}
   */
  function onKeydown(event) {
    if (!ui.dialog || ui.dialog.hidden) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const items = focusables(ui.dialog);
    if (!items.length) {
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && doc.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Shows the first-layer banner.
   * @returns {void}
   */
  function showBanner() {
    buildUi();
    if (ui.banner) {
      ui.banner.hidden = false;
    }
  }

  /** Hides the first-layer banner.
   * @returns {void}
   */
  function hideBanner() {
    if (ui.banner) {
      ui.banner.hidden = true;
    }
  }

  /** Syncs customize-dialog checkboxes with the current choice.
   * @returns {void}
   */
  function syncToggles() {
    const analytics = qs("#solon-consent-analytics");
    const marketing = qs("#solon-consent-marketing");
    if (analytics) {
      analytics.checked = isGrantedFlag(current.analytics);
    }
    if (marketing) {
      marketing.checked = isGrantedFlag(current.marketing);
    }
  }

  /** Opens the second-layer preferences dialog.
   * @returns {void}
   */
  function openPreferences() {
    buildUi();
    syncToggles();
    hideBanner();
    ui.lastFocus = doc.activeElement;
    if (ui.overlay) {
      ui.overlay.hidden = false;
    }
    if (ui.dialog) {
      ui.dialog.hidden = false;
      const closeBtn = ui.dialog.querySelector('[data-consent-action="close"]');
      let titleFocus = ui.dialog;
      if (closeBtn) {
        titleFocus = closeBtn;
      }
      if (titleFocus && typeof titleFocus.focus === "function") {
        titleFocus.focus();
      }
    }
  }

  /** Closes the preferences dialog and restores the banner if nothing is stored.
   * @returns {void}
   */
  function closeDialog() {
    if (ui.dialog) {
      ui.dialog.hidden = true;
    }
    if (ui.overlay) {
      ui.overlay.hidden = true;
    }
    if (!readStored()) {
      showBanner();
    }
    if (ui.lastFocus && typeof ui.lastFocus.focus === "function") {
      ui.lastFocus.focus();
    }
    ui.lastFocus = null;
  }

  /** Wires footer “Setări cookie” links to reopen the dialog.
   * @returns {void}
   */
  function bindFooterLinks() {
    if (!doc) {
      return;
    }
    /**
     * @param {MouseEvent} event
     * @returns {void}
     */
    function onFooterConsentClick(event) {
      const target = eventElement(event);
      if (!target || typeof target.closest !== "function") {
        return;
      }
      const link = target.closest("[data-solon-consent-open]");
      if (!link) {
        return;
      }
      event.preventDefault();
      openPreferences();
    }
    doc.addEventListener("click", onFooterConsentClick);
  }

  /** Mounts UI after DOM is ready and applies a stored choice if present.
   * @returns {void}
   */
  function startUi() {
    buildUi();
    bindFooterLinks();
    const stored = readStored();
    if (stored) {
      activateInertScripts(stored);
      hideBanner();
      return;
    }
    showBanner();
  }

  /** Boots Consent Mode defaults, then the banner or stored choice.
   * @returns {void}
   */
  function boot() {
    setConsentModeDefault();
    const stored = readStored();
    if (stored) {
      current = stored;
      updateConsentMode(stored);
    }
    if (!doc) {
      return;
    }
    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", startUi);
      return;
    }
    startUi();
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

  if (doc) {
    boot();
  }
})(resolveConsentGlobal());
