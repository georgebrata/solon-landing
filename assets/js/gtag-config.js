/**
 * GA4 config command. Activated only after analytics consent.
 */
(function () {
  "use strict";

  if (!window.dataLayer) {
    window.dataLayer = [];
  }
  /**
   * @param {...unknown} gtagArgs
   * @returns {void}
   */
  function gtag(...gtagArgs) {
    window.dataLayer.push(gtagArgs);
  }
  if (typeof window.gtag !== "function") {
    window.gtag = gtag;
  }
  window.gtag("js", new Date());
  window.gtag("config", "G-H41D7KCWHX", { currency: "EURO" });
})();
