"use strict";

/**
 * Consent-gated Meta Pixel + GA4 conversion helper.
 * No pre-consent queueing; no personal data in params.
 */
(function (global) {
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

  /**
   * @param {string} metaEvent
   * @param {string} ga4Event
   * @param {Record<string, unknown>} [params]
   * @returns {string}
   */
  const solonTrack = (metaEvent, ga4Event, params) => {
    const eventId = generateEventId();
    if (BLOCKED_META_EVENTS.has(metaEvent) || ga4Event === "purchase") {
      return eventId;
    }
    const safe = sanitizeParams(params);
    const consent = consentApi();

    if (
      consent?.hasConsent("analytics") &&
      GA4_CUSTOM_EVENTS.has(ga4Event) &&
      typeof global.gtag === "function"
    ) {
      global.gtag("event", ga4Event, { ...safe, event_id: eventId });
    }

    if (consent?.hasConsent("marketing") && typeof global.fbq === "function") {
      global.fbq("track", metaEvent, safe, { eventID: eventId });
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
   * @param {string} path
   * @returns {{ content_name: string, content_category: string, value?: number }|null}
   */
  const viewContentContextForPath = (path) => {
    const matchAbonament = path.match(/\/abonament\/([^/]+)\/?$/iu);
    if (matchAbonament) {
      const name = matchAbonament[1].toLowerCase();
      return { content_name: name, content_category: "pachet" };
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
   * @param {Element} target
   * @returns {void}
   */
  const trackCheckoutClick = (target) => {
    const btn = target.closest ? target.closest("a.buy-btn[data-plan], a[href]") : null;
    if (!btn || btn.tagName !== "A") return;

    if (btn.classList.contains("buy-btn") && btn.dataset.plan) {
      const params = {
        content_name: btn.dataset.plan,
        currency: CURRENCY,
      };
      const value = priceFromBuyButton(btn);
      if (value !== undefined) params.value = value;
      solonTrack("InitiateCheckout", "begin_checkout", params);
      return;
    }

    const href = btn.getAttribute("href") || "";
    const fromShort = packageFromCheckoutHref(href);
    if (fromShort) {
      solonTrack("InitiateCheckout", "begin_checkout", {
        content_name: fromShort.content_name,
        currency: CURRENCY,
      });
      return;
    }

    if (/^https?:\/\/([^/]+\.)?mpy\.ro\//iu.test(href) || /^https?:\/\/pay\.netopia\.ro\//iu.test(href)) {
      const plan = btn.getAttribute("data-plan") || "package";
      solonTrack("InitiateCheckout", "begin_checkout", {
        content_name: plan,
        currency: CURRENCY,
      });
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
   * Fire ViewContent once for package / offer landing pages.
   * @returns {void}
   */
  const trackViewContentForPage = () => {
    const path = global.location?.pathname || "";
    const ctx = viewContentContextForPath(path);
    if (!ctx) return;
    solonTrack("ViewContent", "view_item", {
      content_name: ctx.content_name,
      content_category: ctx.content_category,
      currency: CURRENCY,
    });
  };

  /**
   * @returns {string}
   */
  const readNewsletterSignUpEventId = () => {
    try {
      const storage = global.sessionStorage;
      if (!storage) return "";
      return String(storage.getItem(NEWSLETTER_SIGNUP_STORAGE_KEY) || "");
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
      global.sessionStorage?.setItem(NEWSLETTER_SIGNUP_STORAGE_KEY, eventId);
    } catch {
      return;
    }
  };

  /**
   * CompleteRegistration/sign_up at most once per browser session (form or confirm page).
   * @returns {string}
   */
  const trackNewsletterSignUp = () => {
    const existing = readNewsletterSignUpEventId();
    if (existing) {
      return existing;
    }
    const eventId = solonTrack("CompleteRegistration", "sign_up", { content_name: "newsletter" });
    storeNewsletterSignUpEventId(eventId);
    return eventId;
  };

  /**
   * Fire sign_up on newsletter confirmation landing when not already tracked.
   * @returns {void}
   */
  const trackNewsletterConfirmationPage = () => {
    const path = global.location?.pathname || "";
    if (!/\/confirmare-abonare\/?$/iu.test(path)) return;
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
        solonTrack("ViewContent", "view_item", {
          content_name: "servicii",
          content_category: "serviciu",
          currency: CURRENCY,
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
        trackCheckoutClick(target);
      },
      true,
    );
  };

  /**
   * Page-level tracking bootstrap.
   * @returns {void}
   */
  const initTracking = () => {
    trackViewContentForPage();
    trackNewsletterConfirmationPage();
    if ((global.location?.pathname || "/") === "/" || (global.location?.pathname || "").endsWith("/index.html")) {
      observeHomeServices();
    }
    bindDocumentTracking();
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
