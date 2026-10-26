"use strict";

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
 *     marketing: boolean        // Meta Pixel, Brevo tracker, mny.ro ANPC widget
 *   }
 *   Retention: 12 months from timestamp. Version mismatch or expiry → re-prompt.
 *
 * Google Consent Mode v2 defaults (denied) are written to dataLayer before any
 * gtag/GTM tag is activated. Tracker <script type="text/plain" data-consent-category="...">
 * tags stay inert until the matching category is granted.
 */
(function () {

  const CONSENT_VERSION = 2;
  const STORAGE_KEY = "solon_cookie_consent";
  const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
  const MAX_AGE_MS = COOKIE_MAX_AGE * 1000;
  const CATEGORIES = ["necessary", "analytics", "marketing"];
  const GA_MEASUREMENT_ID = "G-H41D7KCWHX"; // @sync data/ga-measurement.json
  const GA_DISABLE_PROPERTY = `ga-disable-${GA_MEASUREMENT_ID}`;
  const SKIP_SCRIPT_ATTRS = {
    type: true,
    "data-consent-category": true,
    "data-consent-activated": true,
  };

  let win = globalThis;
  if (typeof window !== "undefined") {
    win = window;
  }
  let doc = null;
  if (typeof document !== "undefined") {
    doc = document;
  }
  const BODY_OPEN_CLASS = "solon-consent-open";
  const BANNER_HEIGHT_VAR = "--solon-consent-banner-height";
  const ui = {
    root: null,
    banner: null,
    dialog: null,
    overlay: null,
    lastFocus: null,
    bannerResizeObserver: null,
    insetListenersReady: false,
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

  /**
   * @param {string} href
   * @returns {{ pathAndQuery: string, email: string|null, stripped: boolean }}
   */
  function stripEmailQueryFromHref(href) {
    try {
      const url = new URL(href);
      const email = url.searchParams.get("email");
      let stripped = false;
      if (url.searchParams.has("email")) {
        url.searchParams.delete("email");
        stripped = true;
      }
      return {
        pathAndQuery: url.pathname + url.search + url.hash,
        email: email || null,
        stripped,
      };
    } catch {
      return { pathAndQuery: "", email: null, stripped: false };
    }
  }

  /**
   * Removes email from the visible URL before trackers or other scripts read location.
   * @returns {void}
   */
  function applySensitiveUrlHygiene() {
    if (!win.location || typeof win.history?.replaceState !== "function") {
      return;
    }
    const path = win.location.pathname || "";
    const { pathAndQuery, email, stripped } = stripEmailQueryFromHref(win.location.href);
    if (/\/unsubscribe\/?$/iu.test(path) && email) {
      win.__solonUnsubscribeEmail = email;
    }
    if (stripped) {
      win.history.replaceState(null, "", pathAndQuery);
    }
  }

  /** Installs a dataLayer-backed gtag stub before any vendor tag runs.
   * @returns {void}
   */
  function setupGtagStub() {
    if (!win.dataLayer) {
      win.dataLayer = [];
    }
    if (typeof win.gtag === "function" && win.gtag.__solonArgumentsStub === true) {
      return;
    }
    /** @returns {void} */
    function gtag() {
      // skipcq: JS-0244 -- gtag command must be read from the Arguments object
      const command = arguments[0];
      if (command === "event" && win[GA_DISABLE_PROPERTY] === true) {
        return;
      }
      // skipcq: JS-0244 -- gtag.js only processes Arguments objects on dataLayer, not rest-param arrays
      win.dataLayer.push(arguments);
    }
    gtag.__solonArgumentsStub = true;
    win.gtag = gtag;
  }

  /** Drops new GA / Clarity transport when analytics is withdrawn (does not cancel in-flight requests). */
  function installAnalyticsTransportGuard() {
    if (win.__solonAnalyticsTransportGuard || !win.navigator) {
      return;
    }
    win.__solonAnalyticsTransportGuard = true;
    /**
     * @param {unknown} input
     * @returns {string}
     */
    const transportUrlFromInput = (input) => {
      if (typeof input === "string") {
        return input;
      }
      if (typeof URL !== "undefined" && input instanceof URL) {
        return input.href;
      }
      if (input && typeof input === "object" && typeof input.url === "string") {
        return input.url;
      }
      if (input != null) {
        try {
          return String(input);
        } catch {
          return "";
        }
      }
      return "";
    };
    /**
     * @param {unknown} input
     * @returns {string}
     */
    const transportHostname = (input) => {
      const raw = transportUrlFromInput(input);
      if (!raw) {
        return "";
      }
      try {
        const base = win.location?.href || "https://solon.agency/";
        let hostname = new URL(raw, base).hostname.toLowerCase();
        while (hostname.endsWith(".")) {
          hostname = hostname.slice(0, -1);
        }
        return hostname;
      } catch {
        return "";
      }
    };
    /**
     * @param {string} hostname
     * @param {string} apex
     * @returns {boolean}
     */
    const hostnameMatchesApex = (hostname, apex) =>
      hostname === apex || hostname.endsWith(`.${apex}`);
    /**
     * @param {string} hostname
     * @returns {boolean}
     */
    const isGoogleAnalyticsCollectHost = (hostname) =>
      hostnameMatchesApex(hostname, "google-analytics.com") ||
      hostnameMatchesApex(hostname, "analytics.google.com");
    /**
     * @param {string} hostname
     * @returns {boolean}
     */
    const isClarityCollectHost = (hostname) => hostnameMatchesApex(hostname, "clarity.ms");
    /** @returns {boolean} */
    const clarityTransportBlocked = () => {
      const consent = win.SolonConsent;
      if (consent && typeof consent.hasConsent === "function") {
        return !consent.hasConsent("analytics");
      }
      return win[GA_DISABLE_PROPERTY] === true;
    };
    /**
     * @param {unknown} input
     * @returns {boolean}
     */
    const shouldDropAnalyticsTransport = (input) => {
      const hostname = transportHostname(input);
      if (!hostname) {
        return false;
      }
      return (
        (isGoogleAnalyticsCollectHost(hostname) && win[GA_DISABLE_PROPERTY] === true) ||
        (isClarityCollectHost(hostname) && clarityTransportBlocked())
      );
    };
    /**
     * @param {() => void} fn
     * @returns {void}
     */
    const scheduleMicrotask = (fn) => {
      if (typeof win.queueMicrotask === "function") {
        win.queueMicrotask(fn);
      } else if (typeof win.setTimeout === "function") {
        win.setTimeout(fn, 0);
      } else {
        fn();
      }
    };
    /**
     * @param {XMLHttpRequest} xhr
     * @returns {void}
     */
    const finishBlockedXhr = (xhr) => {
      scheduleMicrotask(() => {
        const EventCtor = win.Event || (typeof Event !== "undefined" ? Event : null);
        const ProgressEventCtor =
          win.ProgressEvent || (typeof ProgressEvent !== "undefined" ? ProgressEvent : EventCtor);
        if (!EventCtor || !ProgressEventCtor || typeof xhr.dispatchEvent !== "function") {
          return;
        }
        try {
          Object.defineProperty(xhr, "readyState", { value: 4, configurable: true });
        } catch {
          try {
            xhr.readyState = 4;
          } catch {
            // Prototype may expose readyState as accessor-only; events still fire below.
          }
        }
        const readystatechangeEvent = new EventCtor("readystatechange");
        const errorEvent = new ProgressEventCtor("error");
        const loadEndEvent = new ProgressEventCtor("loadend");
        xhr.dispatchEvent(readystatechangeEvent);
        xhr.dispatchEvent(errorEvent);
        xhr.dispatchEvent(loadEndEvent);
      });
    };
    /**
     * @param {HTMLImageElement} img
     * @returns {void}
     */
    const finishBlockedImage = (img) => {
      scheduleMicrotask(() => {
        const EventCtor = win.Event || (typeof Event !== "undefined" ? Event : null);
        if (!EventCtor || typeof img.dispatchEvent !== "function") {
          return;
        }
        img.dispatchEvent(new EventCtor("error"));
      });
    };
    const nativeBeacon = win.navigator.sendBeacon?.bind(win.navigator);
    if (nativeBeacon) {
      win.navigator.sendBeacon = (url, data) => {
        if (shouldDropAnalyticsTransport(url)) {
          return true;
        }
        return nativeBeacon(url, data);
      };
    }
    if (typeof win.fetch === "function") {
      const nativeFetch = win.fetch.bind(win);
      win.fetch = (input, init) => {
        if (shouldDropAnalyticsTransport(input)) {
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return nativeFetch(input, init);
      };
    }
    const NativeXHR = win.XMLHttpRequest;
    if (NativeXHR?.prototype?.open && NativeXHR.prototype.send) {
      const nativeOpen = NativeXHR.prototype.open;
      const nativeSend = NativeXHR.prototype.send;
      NativeXHR.prototype.open = function (method, url, ...rest) {
        this.__solonGaOpenUrl = transportUrlFromInput(url);
        const ownReadyState = Object.getOwnPropertyDescriptor(this, "readyState");
        if (ownReadyState?.configurable) {
          delete this.readyState;
        }
        return nativeOpen.call(this, method, url, ...rest);
      };
      NativeXHR.prototype.send = function (...args) {
        if (shouldDropAnalyticsTransport(this.__solonGaOpenUrl || "")) {
          finishBlockedXhr(this);
          return undefined;
        }
        return nativeSend.apply(this, args);
      };
    }
    const imageProto = win.HTMLImageElement?.prototype;
    const imageSrcDescriptor = imageProto && Object.getOwnPropertyDescriptor(imageProto, "src");
    if (imageSrcDescriptor?.set) {
      Object.defineProperty(imageProto, "src", {
        configurable: true,
        enumerable: imageSrcDescriptor.enumerable,
        get: imageSrcDescriptor.get,
        set(value) {
          if (shouldDropAnalyticsTransport(value)) {
            finishBlockedImage(this);
            return;
          }
          imageSrcDescriptor.set.call(this, value);
        },
      });
    }
    const imageSrcsetDescriptor = imageProto && Object.getOwnPropertyDescriptor(imageProto, "srcset");
    if (imageSrcsetDescriptor?.set) {
      Object.defineProperty(imageProto, "srcset", {
        configurable: true,
        enumerable: imageSrcsetDescriptor.enumerable,
        get: imageSrcsetDescriptor.get,
        set(value) {
          if (shouldDropAnalyticsTransport(value)) {
            finishBlockedImage(this);
            return;
          }
          imageSrcsetDescriptor.set.call(this, value);
        },
      });
    }
    const ElementCtor = win.Element;
    if (doc && ElementCtor?.prototype?.setAttribute) {
      const nativeSetAttribute = ElementCtor.prototype.setAttribute;
      ElementCtor.prototype.setAttribute = function (name, value) {
        const attr = String(name).toLowerCase();
        if (
          this instanceof win.HTMLImageElement &&
          (attr === "src" || attr === "srcset") &&
          shouldDropAnalyticsTransport(value)
        ) {
          finishBlockedImage(this);
          return;
        }
        nativeSetAttribute.call(this, name, value);
      };
    }
  }

  /** Stops gtag.js from accruing new engagement time on already-loaded tags (same tick as ga-disable).
   * @returns {void}
   */
  function denyAnalyticsStorageSameTick() {
    setupGtagStub();
    if (typeof win.gtag !== "function") {
      return;
    }
    win.gtag("consent", "update", { analytics_storage: "denied" });
  }

  /**
   * @param {object|null} consent
   * @returns {void}
   */
  function syncAnalyticsDisableFlag(consent) {
    if (consent && isGrantedFlag(consent.analytics)) {
      win[GA_DISABLE_PROPERTY] = false;
      return;
    }
    win[GA_DISABLE_PROPERTY] = true;
    if (typeof win.gtag === "function" && win.gtag.__solonArgumentsStub !== true) {
      tryCall(() => {
        win.gtag("config", GA_MEASUREMENT_ID, { send_page_view: false });
      }, "gtag-config-disable");
    }
    denyAnalyticsStorageSameTick();
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
    if (win.location?.protocol === "https:") {
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

  /** Cookie-only read for visibility fallback when localStorage may be stale.
   * @returns {object|null}
   */
  function readStoredFromCookie() {
    return parseConsent(readCookie(STORAGE_KEY));
  }

  /**
   * @param {object} left
   * @param {object} right
   * @returns {boolean}
   */
  function consentEquals(left, right) {
    if (!left || !right) {
      return false;
    }
    return (
      isGrantedFlag(left.analytics) === isGrantedFlag(right.analytics) &&
      isGrantedFlag(left.marketing) === isGrantedFlag(right.marketing)
    );
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
    return isGrantedFlag(current?.[category]);
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
   * @param {string} label
   * @param {unknown} err
   * @returns {void}
   */
  function logVendorCallbackError(label, err) {
    const message = err instanceof Error ? err.message : String(err);
    const safe = message.slice(0, 200);
    if (typeof win.SolonErrorLog?.warn === "function") {
      win.SolonErrorLog.warn(`consent:${label}`, { message: safe });
      return;
    }
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn(`[solon-consent] ${label}: ${safe}`);
    }
  }

  /**
   * @param {Function} fn
   * @param {string} [label]
   * @returns {boolean}
   */
  function tryCall(fn, label) {
    try {
      fn();
      return true;
    } catch (err) {
      logVendorCallbackError(label || "vendor", err);
      return false;
    }
  }

  const ANALYTICS_COOKIE_PREFIXES = ["_ga", "_gid", "_gat", "_gcl", "_clck", "_clsk", "CLID", "ANONCHK", "SM", "MUID"];
  const MARKETING_COOKIE_PREFIXES = ["_fbp", "_fbc", "sib_"];

  /**
   * @param {string[]} prefixes
   * @returns {void}
   */
  function expireCookiesForPrefixes(prefixes) {
    if (!doc?.cookie) {
      return;
    }
    const host = win.location?.hostname || "";
    const parts = String(doc.cookie).split(";");
    for (const part of parts) {
      const name = part.split("=")[0].trim();
      if (!name || name === STORAGE_KEY) {
        continue;
      }
      let matches = false;
      for (const prefix of prefixes) {
        if (name === prefix || name.startsWith(prefix)) {
          matches = true;
          break;
        }
      }
      if (!matches) {
        continue;
      }
      doc.cookie = `${name}=; Path=/; Max-Age=0`;
      if (host) {
        doc.cookie = `${name}=; Path=/; Max-Age=0; Domain=${host}`;
        if (host.includes(".")) {
          doc.cookie = `${name}=; Path=/; Max-Age=0; Domain=.${host}`;
        }
      }
    }
  }

  /** Stops hits from an already-loaded gtag.js instance after analytics withdrawal.
   * @returns {void}
   */
  function disableAnalyticsTags() {
    setupGtagStub();
    if (typeof win.clarity === "function") {
      tryCall(() => {
        win.clarity("consent", false);
      }, "clarity-consent");
    }
    expireCookiesForPrefixes(ANALYTICS_COOKIE_PREFIXES);
  }

  /** Revokes Meta Pixel and clears marketing cookies only.
   * @returns {void}
   */
  function disableMarketingTags() {
    if (typeof win.fbq === "function") {
      tryCall(() => {
        win.fbq("consent", "revoke");
      }, "fbq-revoke");
    }
    expireCookiesForPrefixes(MARKETING_COOKIE_PREFIXES);
  }

  /** Grants Meta Pixel consent when marketing is allowed.
   * @returns {void}
   */
  function grantMarketingFbq() {
    if (typeof win.fbq === "function") {
      win.fbq("consent", "grant");
    }
  }

  /** Starts or stops Brevo when marketing consent changes.
   * The tracker tag stays inert until marketing is granted. This also covers
   * withdrawal, and a later grant on the same page after the tag already ran.
   * @param {object} consent
   * @returns {void}
   */
  function syncBrevo(consent) {
    const brevo = win.SolonBrevo;
    if (!brevo) {
      return;
    }
    if (isGrantedFlag(consent?.marketing)) {
      if (typeof brevo.start === "function") {
        tryCall(() => {
          brevo.start();
        }, "brevo-start");
      }
      return;
    }
    if (typeof brevo.stop === "function") {
      tryCall(() => {
        brevo.stop();
      }, "brevo-stop");
    }
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
    syncAnalyticsDisableFlag(next);
    updateConsentMode(next);
    if (next.analytics || next.marketing) {
      activateInertScripts(next);
    }
    syncBrevo(next);
    if (isGrantedFlag(next.marketing)) {
      tryCall(grantMarketingFbq, "fbq-grant");
    }
    if (!isGrantedFlag(next.analytics)) {
      disableAnalyticsTags();
    }
    if (!isGrantedFlag(next.marketing)) {
      disableMarketingTags();
    }
    if (doc && typeof doc.dispatchEvent === "function") {
      tryCall(() => {
        doc.dispatchEvent(
          new CustomEvent("solon:consent-granted", {
            detail: {
              analytics: isGrantedFlag(next.analytics),
              marketing: isGrantedFlag(next.marketing),
            },
          }),
        );
      }, "consent-granted-event");
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
    if (analyticsEl?.checked) {
      analyticsOn = true;
    }
    if (marketingEl?.checked) {
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
    const path = win.location?.pathname || "/";
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
      "aria-label": "Preferințe cookie-uri",
      "aria-describedby": "solon-consent-desc",
    });
    hideNode(banner);
    const policyLink = h("a", {
      className: "solon-consent__policy",
      href: policy,
      "aria-label": "Detalii despre politica de cookie-uri",
      text: "Detalii",
    });
    const desc = h("p", { id: "solon-consent-desc", className: "solon-consent__text" }, [
      "Folosim cookie-uri pentru analiză, marketing și o experiență mai bună, doar cu acordul tău. ",
      policyLink,
    ]);
    banner.appendChild(
      h("div", { className: "solon-consent__inner" }, [
        desc,
        h("div", { className: "solon-consent__actions" }, [
          h("button", {
            type: "button",
            className: "solon-consent__btn solon-consent__btn--accept",
            "data-consent-action": "accept",
            text: "Accept",
          }),
          h("button", {
            type: "button",
            className: "solon-consent__btn solon-consent__btn--reject",
            "data-consent-action": "reject",
            text: "Refuz",
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
            hint:
              "Google Analytics 4, Microsoft Clarity, Ahrefs Analytics, Metricool și counter.dev — statistici de utilizare, inclusiv evenimente de conversie (de exemplu, trimiterea unui formular), fără conținutul formularelor.",
            input: analyticsInput,
          }),
          createCategory({
            id: "solon-consent-marketing",
            label: "Marketing",
            hint:
              "Meta Pixel, pe toate paginile publice, pentru măsurarea conversiilor și a campaniilor; Brevo (identificarea ta când te abonezi la newsletter); widget-ul ANPC (mny.ro), pe paginile unde apare.",
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
            text: "Refuz",
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
    if (!doc?.body || ui.root) {
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
    if (event.target?.parentElement) {
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

  /** Lifts fixed UI (e.g. chat launcher) above the visible consent banner. */
  function syncBannerInset() {
    if (!doc?.documentElement || !doc.body) {
      return;
    }
    const visible = ui.banner && !ui.banner.hidden;
    if (!visible) {
      doc.body.classList.remove(BODY_OPEN_CLASS);
      doc.documentElement.style.removeProperty(BANNER_HEIGHT_VAR);
      return;
    }
    doc.body.classList.add(BODY_OPEN_CLASS);
    const height = Math.ceil(ui.banner.getBoundingClientRect().height);
    doc.documentElement.style.setProperty(BANNER_HEIGHT_VAR, `${height}px`);
  }

  /** @returns {void} */
  function ensureBannerInsetObservers() {
    if (!ui.banner || ui.insetListenersReady || !win) {
      return;
    }
    ui.insetListenersReady = true;
    if (typeof win.ResizeObserver === "function") {
      ui.bannerResizeObserver = new win.ResizeObserver(() => {
        syncBannerInset();
      });
      ui.bannerResizeObserver.observe(ui.banner);
    }
    win.addEventListener("resize", syncBannerInset);
  }

  /** Shows the first-layer banner.
   * @returns {void}
   */
  function showBanner() {
    buildUi();
    if (ui.banner) {
      ui.banner.hidden = false;
      ensureBannerInsetObservers();
      syncBannerInset();
      if (typeof win.requestAnimationFrame === "function") {
        win.requestAnimationFrame(syncBannerInset);
      }
    }
  }

  /** Hides the first-layer banner.
   * @returns {void}
   */
  function hideBanner() {
    if (ui.banner) {
      ui.banner.hidden = true;
    }
    syncBannerInset();
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

  /** Applies consent from another tab or cookie refresh without writing storage.
   * @param {object|null} consent
   * @returns {object}
   */
  function applyRemoteChoice(consent) {
    const next = consent ? cloneConsent(consent) : deniedConsent();
    return applyChoice(next, { persist: false });
  }

  /**
   * @param {StorageEvent} event
   * @returns {void}
   */
  function onConsentStorageEvent(event) {
    if (event.key !== STORAGE_KEY) {
      return;
    }
    if (event.storageArea !== win.localStorage) {
      return;
    }
    const next = parseConsent(event.newValue || "");
    if (!next) {
      applyRemoteChoice(null);
      showBanner();
      return;
    }
    applyRemoteChoice(next);
    hideBanner();
  }

  /** Re-sync when the tab becomes visible (cookie + localStorage re-read).
   * @returns {void}
   */
  function onVisibilityCookieRefresh() {
    if (!doc || doc.visibilityState !== "visible") {
      return;
    }
    const cookieChoice = readStoredFromCookie();
    const storageChoice = parseConsent(readLocalStorage());
    if (!cookieChoice) {
      syncAnalyticsDisableFlag(null);
      if (!storageChoice) {
        applyRemoteChoice(null);
        showBanner();
        return;
      }
      if (!consentEquals(current, deniedConsent())) {
        applyRemoteChoice(null);
        showBanner();
      } else if (!isGrantedFlag(current.analytics)) {
        disableAnalyticsTags();
      }
      return;
    }
    const next =
      storageChoice && !consentEquals(storageChoice, cookieChoice) ? storageChoice : cookieChoice;
    if (!consentEquals(next, current)) {
      applyRemoteChoice(next);
      hideBanner();
    }
  }

  /** Cross-tab storage sync and cookie refresh when the tab is visible again.
   * @returns {void}
   */
  function bindConsentSyncListeners() {
    if (typeof win.addEventListener === "function") {
      win.addEventListener("storage", onConsentStorageEvent);
    }
    if (doc && typeof doc.addEventListener === "function") {
      doc.addEventListener("visibilitychange", onVisibilityCookieRefresh);
    }
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
    installAnalyticsTransportGuard();
    const stored = readStored();
    if (stored) {
      current = stored;
      syncAnalyticsDisableFlag(stored);
      updateConsentMode(stored);
    } else {
      syncAnalyticsDisableFlag(null);
    }
    bindConsentSyncListeners();
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
    GA_MEASUREMENT_ID,
    GA_DISABLE_PROPERTY,
    CATEGORIES,
    deniedConsent,
    readStored,
    getConsent,
    hasConsent,
    acceptAll,
    rejectAll,
    saveCustom,
    applyChoice,
    applyRemoteChoice,
    onConsentStorageEvent,
    onVisibilityCookieRefresh,
    syncAnalyticsDisableFlag,
    activateInertScripts,
    openPreferences,
    parseConsent,
    setConsentModeDefault,
    boot,
    stripEmailQueryFromHref,
    applySensitiveUrlHygiene,
  };

  win.SolonConsent = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  applySensitiveUrlHygiene();

  if (doc) {
    boot();
  }
})();
