(function () {
  "use strict";

  const partnerLinks = document.querySelectorAll("[data-partner-name]");
  if (!partnerLinks.length) {
    return;
  }

  /**
   * @param {string} partnerName
   */
  function trackPartnerClick(partnerName) {
    const consentApi = window.SolonConsent;
    if (
      typeof consentApi?.hasConsent !== "function" ||
      !consentApi.hasConsent("analytics") ||
      typeof window.gtag !== "function"
    ) {
      return;
    }
    window.gtag("event", "partner_click", { partner_name: partnerName });
  }

  partnerLinks.forEach((link) => {
    link.addEventListener("click", () => {
      const name = link.getAttribute("data-partner-name");
      if (name) {
        trackPartnerClick(name);
      }
    });
  });
})();
