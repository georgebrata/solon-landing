"use strict";

/**
 * GA4 config command. Activated only after analytics consent.
 */
(function () {

  const measurementId =
    typeof window.SolonConsent?.GA_MEASUREMENT_ID === "string"
      ? window.SolonConsent.GA_MEASUREMENT_ID
      : "G-H41D7KCWHX";

  if (!window.dataLayer) {
    window.dataLayer = [];
  }

  if (!(typeof window.gtag === "function" && window.gtag.__solonArgumentsStub === true)) {
    /** @returns {void} */
    function gtag() {
      // skipcq: JS-0244 -- gtag.js only processes Arguments objects on dataLayer, not rest-param arrays
      window.dataLayer.push(arguments);
    }
    gtag.__solonArgumentsStub = true;
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
  window.gtag("config", measurementId, {
    currency: "RON",
    page_location: safePageLocation(),
  });
})();
