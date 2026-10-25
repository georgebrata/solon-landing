"use strict";

/**
 * GA4 config command. Activated only after analytics consent.
 */
(function () {

  /**
   * @param {() => void} fn
   * @returns {void}
   */
  const tryCall = (fn) => {
    try {
      fn();
    } catch {
      return;
    }
  };

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
        tryCall(() => {
          // skipcq: JS-0244 -- forward legacy gtag calls without array-shaped dataLayer entries
          previous.apply(window, arguments);
        });
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
