"use strict";

/**
 * GA4 config command. Activated only after analytics consent.
 */
(function () {

  if (!window.dataLayer) {
    window.dataLayer = [];
  }

  const existing = window.gtag;
  if (!(typeof existing === "function" && existing.__solonArgumentsStub === true)) {
    const previous = typeof existing === "function" ? existing : null;
    /** @returns {void} */
    function gtag() {
      // skipcq: JS-0244 -- gtag.js only processes Arguments objects on dataLayer, not rest-param arrays
      window.dataLayer.push(arguments);
      if (previous) {
        try {
          previous.apply(window, arguments);
        } catch {
          return;
        }
      }
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
  window.gtag("config", "G-H41D7KCWHX", {
    currency: "RON",
    page_location: safePageLocation(),
  });
})();
