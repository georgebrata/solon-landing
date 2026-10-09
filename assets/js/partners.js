(function () {
  "use strict";

  /**
   * @param {string} partnerName
   * @param {{ solonConsent?: { hasConsent?: (category: string) => boolean } | null, gtag?: ((...args: unknown[]) => void) | null }} [deps]
   */
  function trackPartnerClick(partnerName, deps) {
    if (typeof partnerName !== "string" || partnerName.length === 0) {
      return;
    }

    const env = deps ?? {};
    let consentApi = env.solonConsent;
    let gtagFn = env.gtag;

    if (consentApi === undefined && typeof window !== "undefined") {
      consentApi = window.SolonConsent;
    }
    if (gtagFn === undefined && typeof window !== "undefined") {
      gtagFn = window.gtag;
    }

    if (
      consentApi === null ||
      consentApi === undefined ||
      typeof consentApi.hasConsent !== "function" ||
      !consentApi.hasConsent("analytics")
    ) {
      return;
    }

    if (typeof gtagFn !== "function") {
      return;
    }

    gtagFn("event", "partner_click", { partner_name: partnerName });
  }

  /**
   * @param {ParentNode | Document | null} [root]
   */
  function initPartnerClickTracking(root) {
    const doc = root ?? (typeof document !== "undefined" ? document : null);
    if (doc === null) {
      return;
    }

    const partnerLinks = doc.querySelectorAll("[data-partner-name]");
    if (partnerLinks.length === 0) {
      return;
    }

    partnerLinks.forEach((link) => {
      if (!(link instanceof HTMLElement)) {
        return;
      }
      link.addEventListener("click", () => {
        const name = link.getAttribute("data-partner-name");
        if (name !== null && name.length > 0) {
          trackPartnerClick(name);
        }
      });
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { trackPartnerClick, initPartnerClickTracking };
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        initPartnerClickTracking();
      });
    } else {
      initPartnerClickTracking();
    }
  }
})();
