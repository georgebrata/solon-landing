"use strict";

/**
 * Brevo JS SDK init. Activated only after marketing consent (homepage).
 */
(function () {

  if (!window.Brevo) {
    window.Brevo = [];
  }
  window.Brevo.push([
    "init",
    {
      client_key: "mwgotrl8mb9d4jf2rit2omjt",
    },
  ]);
})();
