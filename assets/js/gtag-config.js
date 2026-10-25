"use strict";

/**
 * GA4 config command. Activated only after analytics consent.
 */
(function () {

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
  /**
   * @returns {string}
   */
  const safePageLocation = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("email");
      const qs = url.searchParams.toString();
      const query = qs ? `?${qs}` : "";
      return `${url.origin}${url.pathname}${query}${url.hash}`;
    } catch {
      return window.location.pathname || "/";
    }
  };

  window.gtag("js", new Date());
  window.gtag("config", "G-H41D7KCWHX", {
    currency: "RON",
    page_location: safePageLocation(),
  });
})();
