"use strict";

/**
 * Consent-gated Meta Pixel + GA4 conversion helper.
 * No pre-consent queueing; no personal data in params.
 */
(function (global) {
  const CURRENCY = "RON";
  const PACKAGE_SLUGS = ["bronze", "silver", "gold", "platinum"];
  const PII_KEYS =
    /^(email|e-mail|phone|telefon|tel|name|nume|firstname|first_name|lastname|last_name|mesaj|message|ip)$/i;
  const GA4_CUSTOM_EVENTS = new Set([
    "view_item",
    "generate_lead",
    "sign_up",
    "contact",
    "begin_checkout",
  ]);
  const BLOCKED_META_EVENTS = new Set(["Purchase"]);

  /**
   * @returns {string}
   */
  function generateEventId() {
    try {
      if (global.crypto && typeof global.crypto.randomUUID === "function") {
        return global.crypto.randomUUID();
      }
    } catch {
      // fall through
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * @param {Record<string, unknown>} [params]
   * @returns {Record<string, unknown>}
   */
  function sanitizeParams(params) {
    const out = {};
    const source = params && typeof params === "object" ? params : {};
    for (const [key, value] of Object.entries(source)) {
      if (PII_KEYS.test(key)) continue;
      if (value === undefined || value === null) continue;
      out[key] = value;
    }
    return out;
  }

  /**
   * @returns {{ hasConsent?: (category: string) => boolean } | null}
   */
  function consentApi() {
    if (global.SolonConsent && typeof global.SolonConsent.hasConsent === "function") {
      return global.SolonConsent;
    }
    return null;
  }

  /**
   * @param {string} metaEvent
   * @param {string} ga4Event
   * @param {Record<string, unknown>} [params]
   * @returns {string}
   */
  function solonTrack(metaEvent, ga4Event, params) {
    const eventId = generateEventId();
    if (BLOCKED_META_EVENTS.has(metaEvent) || ga4Event === "purchase") {
      return eventId;
    }
    const safe = sanitizeParams(params);
    const consent = consentApi();

    if (
      consent &&
      consent.hasConsent("analytics") &&
      GA4_CUSTOM_EVENTS.has(ga4Event) &&
      typeof global.gtag === "function"
    ) {
      global.gtag("event", ga4Event, { ...safe, event_id: eventId });
    }

    if (consent && consent.hasConsent("marketing") && typeof global.fbq === "function") {
      global.fbq("track", metaEvent, safe, { eventID: eventId });
    }

    return eventId;
  }

  /**
   * @param {string} text
   * @returns {number|undefined}
   */
  function parseRonAmount(text) {
    if (!text) return undefined;
    const normalized = String(text).replace(/\u00a0/g, " ").replace(/[^\d.,]/g, "").trim();
    if (!normalized) return undefined;
    const compact = normalized.replace(/\./g, "").replace(",", ".");
    const value = Number.parseFloat(compact);
    if (!Number.isFinite(value)) return undefined;
    return value;
  }

  /**
   * @param {Element|null} btn
   * @returns {number|undefined}
   */
  function priceFromBuyButton(btn) {
    if (!btn || typeof btn.closest !== "function") return undefined;
    const box = btn.closest(".box");
    if (!box) return undefined;
    const billing = btn.getAttribute("data-billing") === "annual" ? "annual" : "monthly";
    const selector = billing === "annual" ? ".price-annual" : ".price-monthly";
    const priceEl = box.querySelector(`h4 ${selector}`);
    return parseRonAmount(priceEl ? priceEl.textContent : "");
  }

  /**
   * @param {string} path
   * @returns {{ content_name: string, content_category: string, value?: number }|null}
   */
  function viewContentContextForPath(path) {
    const matchAbonament = path.match(/\/abonament\/([^/]+)\/?$/i);
    if (matchAbonament) {
      const name = matchAbonament[1].toLowerCase();
      return { content_name: name, content_category: "pachet" };
    }
    if (/\/oferta(-mobile)?\/?$/i.test(path)) {
      return { content_name: "oferta", content_category: "serviciu" };
    }
    return null;
  }

  /**
   * @param {string} href
   * @returns {{ content_name: string, billing: string }|null}
   */
  function packageFromCheckoutHref(href) {
    if (!href) return null;
    let url;
    try {
      url = new URL(href, global.location?.href || "https://solon.agency/");
    } catch {
      return null;
    }
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length === 2) {
      const [pkg, term] = pathParts.map((p) => p.toLowerCase());
      if (PACKAGE_SLUGS.includes(pkg) && (term === "lunar" || term === "anual")) {
        return { content_name: pkg, billing: term === "anual" ? "annual" : "monthly" };
      }
    }
    return null;
  }

  /**
   * @param {Element} target
   * @returns {void}
   */
  function trackCheckoutClick(target) {
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

    if (/^https?:\/\/([^/]+\.)?mpy\.ro\//i.test(href) || /^https?:\/\/pay\.netopia\.ro\//i.test(href)) {
      const plan = btn.getAttribute("data-plan") || "package";
      solonTrack("InitiateCheckout", "begin_checkout", {
        content_name: plan,
        currency: CURRENCY,
      });
    }
  }

  /**
   * @param {Element} target
   * @returns {void}
   */
  function trackContactClick(target) {
    const link = target.closest ? target.closest("a[href]") : null;
    if (!link) return;
    const href = (link.getAttribute("href") || "").trim();
    if (!href) return;

    let method;
    if (/^tel:/i.test(href)) method = "phone";
    else if (/^mailto:/i.test(href)) method = "email";
    else if (/wa\.me|api\.whatsapp\.com|whatsapp:\/\//i.test(href)) method = "whatsapp";
    else return;

    solonTrack("Contact", "contact", { method });
  }

  /**
   * Fire ViewContent once for package / offer landing pages.
   * @returns {void}
   */
  function trackViewContentForPage() {
    const path = global.location?.pathname || "";
    const ctx = viewContentContextForPath(path);
    if (!ctx) return;
    solonTrack("ViewContent", "view_item", {
      content_name: ctx.content_name,
      content_category: ctx.content_category,
      currency: CURRENCY,
    });
  }

  /**
   * Fire sign_up on newsletter confirmation landing.
   * @returns {void}
   */
  function trackNewsletterConfirmationPage() {
    const path = global.location?.pathname || "";
    if (!/\/confirmare-abonare\/?$/i.test(path)) return;
    solonTrack("CompleteRegistration", "sign_up", { content_name: "newsletter" });
  }

  /**
   * ViewContent when the homepage #servicii block is seen.
   * @returns {void}
   */
  function observeHomeServices() {
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
  }

  /**
   * Delegated click handlers for contact and checkout links.
   * @returns {void}
   */
  function bindDocumentTracking() {
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
  }

  /**
   * Page-level tracking bootstrap.
   * @returns {void}
   */
  function initTracking() {
    trackViewContentForPage();
    trackNewsletterConfirmationPage();
    if ((global.location?.pathname || "/") === "/" || (global.location?.pathname || "").endsWith("/index.html")) {
      observeHomeServices();
    }
    bindDocumentTracking();
  }

  global.solonTrack = solonTrack;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      solonTrack,
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
