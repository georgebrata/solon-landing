"use strict";

/**
 * Brevo tracker, snippet v2.0.
 *
 * The public client key is the only config spot in this file. It is the value
 * from Brevo > Automation > Settings > Tracking code, not a private API key.
 * An empty key, or one that still starts with REPLACE_WITH_, does not load the SDK.
 *
 * The script tag is type="text/plain" data-consent-category="marketing", so the
 * browser does not fetch it until SolonConsent grants marketing. start() also
 * refuses to run without that grant. stop() runs when marketing is withdrawn.
 *
 * After consent, start() loads https://cdn.brevo.com/js/sdk-loader.js and queues
 * window.Brevo = window.Brevo || []; Brevo.push(["init", { client_key }]).
 * Page views and identify use the same Brevo.push API.
 */
(function () {
  const BREVO_TRACKER_CLIENT_KEY = "mwgotrl8mb9d4jf2rit2omjt";
  const SDK_SRC = "https://cdn.brevo.com/js/sdk-loader.js";
  const LOADER_ID = "solon-brevo-sdk-loader";
  const SDK_ID = "sendinblue-js";
  const FRAME_ID = "cm_iframe";

  const doc = typeof document !== "undefined" ? document : null;
  let win = globalThis;
  if (typeof window !== "undefined") {
    win = window;
  }

  let started = false;
  let stopped = false;

  /**
   * @param {string} key
   * @returns {boolean}
   */
  function isPlaceholderKey(key) {
    const value = String(key || "").trim();
    if (!value) {
      return true;
    }
    return value.indexOf("REPLACE_WITH_") === 0;
  }

  /**
   * @returns {boolean}
   */
  function marketingGranted() {
    const api = win.SolonConsent;
    if (!api || typeof api.hasConsent !== "function") {
      return false;
    }
    return api.hasConsent("marketing") === true;
  }

  /**
   * @returns {{name: string, properties: {ma_title: string, ma_url: string, ma_path: string, ma_referrer: string}}}
   */
  function pagePayload() {
    const title = String(doc?.title || "page").trim() || "page";
    const loc = win.location || {};
    return {
      name: title,
      properties: {
        ma_title: title,
        ma_url: typeof loc.href === "string" ? loc.href : "",
        ma_path: typeof loc.pathname === "string" ? loc.pathname : "",
        ma_referrer: doc && typeof doc.referrer === "string" ? doc.referrer : "",
      },
    };
  }

  /**
   * @param {string} name
   * @returns {void}
   */
  function expireCookie(name) {
    if (!doc) {
      return;
    }
    const host = win.location && typeof win.location.hostname === "string" ? win.location.hostname : "";
    const base = `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    doc.cookie = base;
    if (host) {
      doc.cookie = `${base}; Domain=${host}`;
      if (host.indexOf(".") !== -1) {
        doc.cookie = `${base}; Domain=.${host}`;
      }
    }
  }

  /**
   * @param {ParentNode|null} parent
   * @param {string} id
   * @returns {void}
   */
  function removeNode(id) {
    if (!doc || typeof doc.getElementById !== "function") {
      return;
    }
    const node = doc.getElementById(id);
    if (node?.parentNode) {
      node.parentNode.removeChild(node);
    }
  }

  /** Replaces a Brevo method so withdrawal does not send anything further.
   * @returns {boolean}
   */
  function ignoreBrevoCommand() {
    return false;
  }

  /** Drops queued and live Brevo commands so withdrawal stops further sends.
   * @returns {void}
   */
  function silenceBrevo() {
    const noop = ignoreBrevoCommand;
    const api = win.Brevo;
    win.Brevo = [];
    win.Brevo.push = noop;
    if (api && typeof api === "object") {
      api.push = noop;
      const methods = ["page", "identify", "track", "trackLink", "viewProduct", "viewCategory", "search"];
      for (const name of methods) {
        if (typeof api[name] === "function") {
          api[name] = noop;
        }
      }
    }
    if (win.sib && win.sib !== api) {
      win.sib.push = noop;
    }
  }

  /**
   * @returns {boolean}
   */
  function start() {
    if (!marketingGranted() || isPlaceholderKey(BREVO_TRACKER_CLIENT_KEY)) {
      return false;
    }
    if (started && !stopped) {
      return true;
    }
    if (!doc || typeof doc.createElement !== "function") {
      return false;
    }
    if (!doc.getElementById(LOADER_ID)) {
      const script = doc.createElement("script");
      script.id = LOADER_ID;
      script.async = true;
      script.src = SDK_SRC;
      const parent = doc.head || doc.documentElement;
      if (!parent || typeof parent.appendChild !== "function") {
        return false;
      }
      parent.appendChild(script);
    }
    stopped = false;
    const page = pagePayload();
    if (Array.isArray(win.Brevo) && win.Brevo.push === ignoreBrevoCommand) {
      delete win.Brevo;
    }
    win.sib = undefined;
    // Snippet v2.0: sdk-loader.js, then window.Brevo = window.Brevo || [].
    // sa.js also unshifts a page view on init. do_not_track_page keeps that
    // from firing so the Brevo.push(["page", ...]) call below is the only one.
    win.Brevo = win.Brevo || [];
    win.Brevo.push([
      "init",
      {
        client_key: BREVO_TRACKER_CLIENT_KEY,
        do_not_track_page: true,
      },
    ]);
    win.Brevo.push(["page", page.name, page.properties]);
    started = true;
    return true;
  }

  /**
   * @returns {void}
   */
  function stop() {
    stopped = true;
    started = false;
    silenceBrevo();
    removeNode(LOADER_ID);
    removeNode(SDK_ID);
    removeNode(FRAME_ID);
    expireCookie("sib_cuid");
    expireCookie("visitor_id");
  }

  /**
   * @param {string} email
   * @param {{FIRSTNAME?: string, SOURCE?: string, PAGE_URL?: string}} [attributes]
   * @returns {boolean}
   */
  function identify(email, attributes) {
    if (stopped || !started || !marketingGranted() || isPlaceholderKey(BREVO_TRACKER_CLIENT_KEY)) {
      return false;
    }
    const address = String(email || "").trim();
    if (!address || address.indexOf("@") === -1) {
      return false;
    }
    if (!win.Brevo || typeof win.Brevo.push !== "function") {
      return false;
    }
    const source = attributes || {};
    const attrs = {};
    if (source.FIRSTNAME) {
      attrs.FIRSTNAME = String(source.FIRSTNAME);
    }
    if (source.SOURCE) {
      attrs.SOURCE = String(source.SOURCE);
    }
    if (source.PAGE_URL) {
      attrs.PAGE_URL = String(source.PAGE_URL);
    }
    win.Brevo.push([
      "identify",
      {
        identifiers: { email_id: address },
        attributes: attrs,
      },
    ]);
    return true;
  }

  win.SolonBrevo = {
    start,
    stop,
    identify,
    isConfigured() {
      return !isPlaceholderKey(BREVO_TRACKER_CLIENT_KEY);
    },
  };

  if (doc && marketingGranted()) {
    start();
  }
})();
