"use strict";

/**
 * Consent-gated Meta Pixel + GA4 conversion helper.
 * No pre-consent queueing; page-load Meta events retry on solon:pixel-ready only.
 */
(function (global) {
  if (global.__solonTrackingInit) {
    return;
  }
  global.__solonTrackingInit = true;

  const CURRENCY = "RON";
  const PACKAGE_SLUGS = ["bronze", "silver", "gold", "platinum"];
  const PII_KEYS =
    /^(email|e-mail|phone|telefon|tel|name|nume|firstname|first_name|lastname|last_name|mesaj|message|ip)$/iu;
  const GA4_CUSTOM_EVENTS = new Set([
    "view_item",
    "generate_lead",
    "sign_up",
    "contact",
    "begin_checkout",
  ]);
  const BLOCKED_META_EVENTS = new Set(["Purchase"]);
  const NEWSLETTER_SIGNUP_STORAGE_KEY = "solon_newsletter_sign_up_event_id";
  const NEWSLETTER_SIGNUP_TTL_MS = 24 * 60 * 60 * 1000;
  const PIXEL_READY_EVENT = "solon:pixel-ready";
  const CONSENT_GRANTED_EVENT = "solon:consent-granted";
  const CHECKOUT_NAV_DELAY_MS = 120;

  let pageViewPathKey = "";
  let pageViewEventId = "";
  let pageViewGaSent = false;
  let pageViewMetaSent = false;

  /** @type {Map<string, { metaEvent: string, safe: Record<string, unknown>, eventId: string }>} */
  const pendingMetaPageEvents = new Map();

  /**
   * @returns {string}
   */
  const generateEventId = () => {
    try {
      if (global.crypto && typeof global.crypto.randomUUID === "function") {
        return global.crypto.randomUUID();
      }
    } catch {
      // fall through
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  };

  /**
   * @param {Record<string, unknown>} [params]
   * @returns {Record<string, unknown>}
   */
  const sanitizeParams = (params) => {
    const out = {};
    const source = params && typeof params === "object" ? params : {};
    for (const [key, value] of Object.entries(source)) {
      if (PII_KEYS.test(key)) continue;
      if (value === undefined || value === null) continue;
      if (typeof value === "string" && (value.includes("@") || /email=/iu.test(value))) continue;
      out[key] = value;
    }
    return out;
  };

  /**
   * @returns {{ hasConsent?: (category: string) => boolean } | null}
   */
  const consentApi = () => {
    if (global.SolonConsent && typeof global.SolonConsent.hasConsent === "function") {
      return global.SolonConsent;
    }
    return null;
  };

  /** @returns {boolean} */
  const canSendGa4Event = () => {
    const consent = consentApi();
    if (!consent?.hasConsent("analytics") || typeof global.gtag !== "function") {
      return false;
    }
    const disableKey =
      typeof consent.GA_DISABLE_PROPERTY === "string"
        ? consent.GA_DISABLE_PROPERTY
        : `ga-disable-${typeof consent.GA_MEASUREMENT_ID === "string" ? consent.GA_MEASUREMENT_ID : "G-H41D7KCWHX"}`;
    return global[disableKey] !== true;
  };

  /**
   * @param {string} metaEvent
   * @param {Record<string, unknown>} safe
   * @param {string} eventId
   * @returns {boolean}
   */
  const sendMetaTrack = (metaEvent, safe, eventId) => {
    const consent = consentApi();
    if (!consent?.hasConsent("marketing") || typeof global.fbq !== "function") {
      return false;
    }
    global.fbq("track", metaEvent, safe, { eventID: eventId });
    return true;
  };

  /**
   * @returns {string}
   */
  const readNewsletterSignUpEventId = () => {
    try {
      const storage = global.localStorage;
      if (!storage) return "";
      const raw = storage.getItem(NEWSLETTER_SIGNUP_STORAGE_KEY);
      if (!raw) return "";
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.eventId !== "string" || typeof parsed.at !== "number") {
        storage.removeItem(NEWSLETTER_SIGNUP_STORAGE_KEY);
        return "";
      }
      if (Date.now() - parsed.at > NEWSLETTER_SIGNUP_TTL_MS) {
        storage.removeItem(NEWSLETTER_SIGNUP_STORAGE_KEY);
        return "";
      }
      return parsed.eventId;
    } catch {
      return "";
    }
  };

  /**
   * @param {string} eventId
   * @returns {void}
   */
  const storeNewsletterSignUpEventId = (eventId) => {
    try {
      global.localStorage?.setItem(
        NEWSLETTER_SIGNUP_STORAGE_KEY,
        JSON.stringify({ eventId, at: Date.now() }),
      );
    } catch {
      return;
    }
  };

  /**
   * @returns {boolean}
   */
  const newsletterSignUpAlreadySent = () => readNewsletterSignUpEventId().length > 0;

  /**
   * @returns {void}
   */
  const flushPendingMetaPageEvents = () => {
    if (pendingMetaPageEvents.size === 0) {
      return;
    }
    for (const [key, item] of pendingMetaPageEvents.entries()) {
      if (sendMetaTrack(item.metaEvent, item.safe, item.eventId)) {
        pendingMetaPageEvents.delete(key);
        if (key === "newsletter-sign-up" && !newsletterSignUpAlreadySent()) {
          storeNewsletterSignUpEventId(item.eventId);
        }
      }
    }
  };

  /**
   * @param {string} key
   * @param {string} metaEvent
   * @param {Record<string, unknown>} safe
   * @param {string} eventId
   * @param {boolean} metaSent
   * @returns {void}
   */
  const rememberPendingMetaPageEvent = (key, metaEvent, safe, eventId, metaSent) => {
    const consent = consentApi();
    if (metaSent || !consent?.hasConsent("marketing")) {
      return;
    }
    pendingMetaPageEvents.set(key, { metaEvent, safe, eventId });
  };

  /**
   * @param {string} metaEvent
   * @param {string} ga4Event
   * @param {Record<string, unknown>} [params]
   * @param {{ pageMetaKey?: string, transportType?: string, eventCallback?: () => void }} [options]
   * @returns {string}
   */
  const solonTrack = (metaEvent, ga4Event, params, options) => {
    const opts = options || {};
    const eventId = generateEventId();
    if (BLOCKED_META_EVENTS.has(metaEvent) || ga4Event === "purchase") {
      return eventId;
    }
    const safe = sanitizeParams(params);
    let metaSent = false;

    if (canSendGa4Event() && GA4_CUSTOM_EVENTS.has(ga4Event)) {
      const gaPayload = { ...safe, event_id: eventId };
      if (opts.transportType) {
        gaPayload.transport_type = opts.transportType;
      }
      if (typeof opts.eventCallback === "function") {
        gaPayload.event_callback = opts.eventCallback;
      }
      global.gtag("event", ga4Event, gaPayload);
    }

    metaSent = sendMetaTrack(metaEvent, safe, eventId);

    if (opts.pageMetaKey) {
      rememberPendingMetaPageEvent(opts.pageMetaKey, metaEvent, safe, eventId, metaSent);
    }

    return eventId;
  };

  /**
   * @param {string} text
   * @returns {number|undefined}
   */
  const parseRonAmount = (text) => {
    if (!text) return undefined;
    const normalized = String(text).replace(/\u00a0/gu, " ").replace(/[^\d.,]/gu, "").trim();
    if (!normalized) return undefined;
    const compact = normalized.replace(/\./gu, "").replace(",", ".");
    const value = Number.parseFloat(compact);
    if (!Number.isFinite(value)) return undefined;
    return value;
  };

  /**
   * @param {Element|null} btn
   * @returns {number|undefined}
   */
  const priceFromBuyButton = (btn) => {
    if (!btn || typeof btn.closest !== "function") return undefined;
    const box = btn.closest(".box");
    if (!box) return undefined;
    const billing = btn.getAttribute("data-billing") === "annual" ? "annual" : "monthly";
    const selector = billing === "annual" ? ".price-annual" : ".price-monthly";
    const priceEl = box.querySelector(`h4 ${selector}`);
    return parseRonAmount(priceEl ? priceEl.textContent : "");
  };

  /**
   * @returns {number|undefined}
   */
  const packageValueFromDocument = () => {
    const doc = global.document;
    if (!doc || typeof doc.querySelector !== "function") return undefined;
    const annual = doc.querySelector(".price-annual");
    const monthly = doc.querySelector(".price-monthly");
    const annualValue = parseRonAmount(annual ? annual.textContent : "");
    if (annualValue !== undefined) return annualValue;
    return parseRonAmount(monthly ? monthly.textContent : "");
  };

  /**
   * @param {string} contentName
   * @param {string} contentCategory
   * @param {number|undefined} value
   * @returns {Record<string, unknown>}
   */
  const buildViewItemParams = (contentName, contentCategory, value) => {
    const params = {
      content_name: contentName,
      content_category: contentCategory,
      currency: CURRENCY,
    };
    if (value !== undefined) {
      params.value = value;
      params.items = [
        {
          item_name: contentName,
          item_category: contentCategory,
          price: value,
          quantity: 1,
        },
      ];
    }
    return params;
  };

  /**
   * @param {string} path
   * @returns {{ content_name: string, content_category: string, value?: number }|null}
   */
  const viewContentContextForPath = (path) => {
    const matchAbonament = path.match(/\/abonament\/([^/]+)\/?$/iu);
    if (matchAbonament) {
      const name = matchAbonament[1].toLowerCase();
      const value = packageValueFromDocument();
      const ctx = { content_name: name, content_category: "pachet" };
      if (value !== undefined) ctx.value = value;
      return ctx;
    }
    if (/\/oferta(-mobile)?\/?$/iu.test(path)) {
      return { content_name: "oferta", content_category: "serviciu" };
    }
    return null;
  };

  /**
   * @param {string} href
   * @returns {{ content_name: string, billing: string }|null}
   */
  const packageFromCheckoutHref = (href) => {
    if (!href) return null;
    try {
      const url = new URL(href, global.location?.href || "https://solon.agency/");
      const pathParts = url.pathname.split("/").filter(Boolean);
      if (pathParts.length === 2) {
        const [pkg, term] = pathParts.map((p) => p.toLowerCase());
        if (PACKAGE_SLUGS.includes(pkg) && (term === "lunar" || term === "anual")) {
          return { content_name: pkg, billing: term === "anual" ? "annual" : "monthly" };
        }
      }
    } catch {
      return null;
    }
    return null;
  };

  /**
   * @param {string} href
   * @returns {"phone"|"email"|"whatsapp"|null}
   */
  const contactMethodForHref = (href) => {
    if (/^tel:/iu.test(href)) return "phone";
    if (/^mailto:/iu.test(href)) return "email";
    if (/wa\.me|api\.whatsapp\.com|whatsapp:\/\//iu.test(href)) return "whatsapp";
    return null;
  };

  /**
   * @param {string} href
   * @returns {boolean}
   */
  const isExternalCheckoutHref = (href) =>
    /^https?:\/\/([^/]+\.)?mpy\.ro\//iu.test(href) || /^https?:\/\/pay\.netopia\.ro\//iu.test(href);

  /**
   * @param {string} href
   * @param {Record<string, unknown>} params
   * @param {Event} [event]
   * @returns {void}
   */
  const trackCheckoutWithNavigation = (href, params, event) => {
    if (!isExternalCheckoutHref(href) || !event || typeof event.preventDefault !== "function") {
      solonTrack("InitiateCheckout", "begin_checkout", params);
      return;
    }
    event.preventDefault();
    let navigated = false;
    /** @returns {void} */
    const navigate = () => {
      if (navigated) return;
      navigated = true;
      global.location.href = href;
    };
    solonTrack("InitiateCheckout", "begin_checkout", params, {
      transportType: "beacon",
      eventCallback: navigate,
    });
    global.setTimeout(navigate, CHECKOUT_NAV_DELAY_MS);
  };

  /**
   * @param {Element} target
   * @param {Event} [event]
   * @returns {void}
   */
  const trackCheckoutClick = (target, event) => {
    const btn = target.closest ? target.closest("a.buy-btn[data-plan], a[href]") : null;
    if (!btn || btn.tagName !== "A") return;

    if (btn.classList.contains("buy-btn") && btn.dataset.plan) {
      const params = {
        content_name: btn.dataset.plan,
        currency: CURRENCY,
      };
      const value = priceFromBuyButton(btn);
      if (value !== undefined) {
        params.value = value;
        params.items = [
          {
            item_name: btn.dataset.plan,
            item_category: "pachet",
            price: value,
            quantity: 1,
          },
        ];
      }
      const href = btn.getAttribute("href") || "";
      trackCheckoutWithNavigation(href, params, event);
      return;
    }

    const href = btn.getAttribute("href") || "";
    const fromShort = packageFromCheckoutHref(href);
    if (fromShort) {
      trackCheckoutWithNavigation(href, {
        content_name: fromShort.content_name,
        currency: CURRENCY,
      }, event);
      return;
    }

    if (isExternalCheckoutHref(href)) {
      const plan = btn.getAttribute("data-plan") || "package";
      trackCheckoutWithNavigation(href, {
        content_name: plan,
        currency: CURRENCY,
      }, event);
    }
  };

  /**
   * @param {Element} target
   * @returns {void}
   */
  const trackContactClick = (target) => {
    const link = target.closest ? target.closest("a[href]") : null;
    if (!link) return;
    const href = (link.getAttribute("href") || "").trim();
    if (!href) return;

    const method = contactMethodForHref(href);
    if (!method) return;

    solonTrack("Contact", "contact", { method });
  };

  /**
   * Resets per-path page-view flags when the pathname changes.
   * @returns {void}
   */
  const syncPageViewPathState = () => {
    const path = global.location?.pathname || "";
    if (path === pageViewPathKey) {
      return;
    }
    pageViewPathKey = path;
    pageViewEventId = "";
    pageViewGaSent = false;
    pageViewMetaSent = false;
  };

  /**
   * Sends one view_item + ViewContent for the current page after consent, with a shared event_id.
   * Never queues or replays pre-consent attempts.
   * @returns {void}
   */
  const trySendPageViewContent = () => {
    syncPageViewPathState();
    const path = global.location?.pathname || "";
    const ctx = viewContentContextForPath(path);
    if (!ctx) {
      return;
    }
    const consent = consentApi();
    const canGa = !pageViewGaSent && canSendGa4Event();
    const canMeta =
      !pageViewMetaSent &&
      consent?.hasConsent("marketing") &&
      typeof global.fbq === "function";
    if (!canGa && !canMeta) {
      return;
    }
    if (!pageViewEventId) {
      pageViewEventId = generateEventId();
    }
    const params = buildViewItemParams(ctx.content_name, ctx.content_category, ctx.value);
    const safe = sanitizeParams(params);
    if (canGa) {
      global.gtag("event", "view_item", { ...safe, event_id: pageViewEventId });
      pageViewGaSent = true;
    }
    if (canMeta) {
      global.fbq("track", "ViewContent", safe, { eventID: pageViewEventId });
      pageViewMetaSent = true;
    }
  };

  /**
   * CompleteRegistration/sign_up only on /confirmare-abonare/, once per session after a real send.
   * @returns {string}
   */
  const trackNewsletterSignUp = () => {
    const path = global.location?.pathname || "";
    if (!/\/confirmare-abonare\/?$/iu.test(path)) {
      return "";
    }
    const existing = readNewsletterSignUpEventId();
    if (existing) {
      return existing;
    }
    const consent = consentApi();
    const eventId = generateEventId();
    const params = { content_name: "newsletter" };
    const safe = sanitizeParams(params);
    let sent = false;

    if (canSendGa4Event()) {
      global.gtag("event", "sign_up", { ...safe, event_id: eventId });
      sent = true;
    }
    if (sendMetaTrack("CompleteRegistration", safe, eventId)) {
      sent = true;
    } else if (consent?.hasConsent("marketing")) {
      rememberPendingMetaPageEvent("newsletter-sign-up", "CompleteRegistration", safe, eventId, false);
    }

    if (sent) {
      storeNewsletterSignUpEventId(eventId);
    }
    return eventId;
  };

  /**
   * Fire sign_up on newsletter confirmation landing when not already tracked.
   * @returns {void}
   */
  const trackNewsletterConfirmationPage = () => {
    trackNewsletterSignUp();
  };

  /**
   * ViewContent when the homepage #servicii block is seen.
   * @returns {void}
   */
  const observeHomeServices = () => {
    const section = global.document?.querySelector("#servicii");
    if (!section || typeof global.IntersectionObserver !== "function") return;
    const io = new global.IntersectionObserver(
      (entries) => {
        if (!entries.some((en) => en.isIntersecting)) return;
        solonTrack("ViewContent", "view_item", buildViewItemParams("servicii", "serviciu"), {
          pageMetaKey: "home-servicii",
        });
        io.disconnect();
      },
      { threshold: 0.25 },
    );
    io.observe(section);
  };

  /**
   * Delegated click handlers for contact and checkout links.
   * @returns {void}
   */
  const bindDocumentTracking = () => {
    const doc = global.document;
    if (!doc || typeof doc.addEventListener !== "function") return;

    doc.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!target || typeof target.closest !== "function") return;
        trackContactClick(target);
        trackCheckoutClick(target, event);
      },
      true,
    );
  };

  /**
   * @returns {void}
   */
  const bindConsentTrackingListeners = () => {
    const doc = global.document;
    if (!doc || typeof doc.addEventListener !== "function") return;
    doc.addEventListener(PIXEL_READY_EVENT, () => {
      flushPendingMetaPageEvents();
      trySendPageViewContent();
      if (!newsletterSignUpAlreadySent()) {
        trackNewsletterSignUp();
      }
    });
    doc.addEventListener(CONSENT_GRANTED_EVENT, () => {
      trySendPageViewContent();
    });
  };

  /**
   * Page-level tracking bootstrap.
   * @returns {void}
   */
  const initTracking = () => {
    bindConsentTrackingListeners();
    trySendPageViewContent();
    trackNewsletterConfirmationPage();
    if ((global.location?.pathname || "/") === "/" || (global.location?.pathname || "").endsWith("/index.html")) {
      observeHomeServices();
    }
    bindDocumentTracking();
    flushPendingMetaPageEvents();
  };

  global.solonTrack = solonTrack;
  global.solonTrackNewsletterSignUp = trackNewsletterSignUp;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      solonTrack,
      trackNewsletterSignUp,
      readNewsletterSignUpEventId,
      storeNewsletterSignUpEventId,
      generateEventId,
      sanitizeParams,
      parseRonAmount,
      priceFromBuyButton,
      viewContentContextForPath,
      packageFromCheckoutHref,
      trackCheckoutClick,
      trackContactClick,
      buildViewItemParams,
      flushPendingMetaPageEvents,
      trySendPageViewContent,
      canSendGa4Event,
      sendMetaTrack,
      CURRENCY,
      GA4_CUSTOM_EVENTS,
      BLOCKED_META_EVENTS,
    };
  }

  if (global.document && typeof global.document.addEventListener === "function") {
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", initTracking);
    } else {
      initTracking();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
