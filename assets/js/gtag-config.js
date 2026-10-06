(function () {
  "use strict";

  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== "function") {
    window.gtag = function gtag() {
      window.dataLayer.push(arguments); // skipcq: JS-W1023
    };
  }
  window.gtag("js", new Date());
  window.gtag("config", "G-H41D7KCWHX", { currency: "EURO" });
})();
