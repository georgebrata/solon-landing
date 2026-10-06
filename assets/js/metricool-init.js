"use strict";

/**
 * Metricool tracker loader. Activated only after analytics consent.
 */
(function () {

  const DEFAULT_HASH = "5eff58c72e852f80d27f8f1735299845";
  const current = document.currentScript;
  let hash = DEFAULT_HASH;
  if (current) {
    const fromTag = current.getAttribute("data-metricool-hash");
    if (fromTag) {
      hash = fromTag;
    }
  }
  const tag = document.createElement("script");
  tag.src = "https://tracker.metricool.com/resources/be.js";
  tag.async = true;
  /**
   * Fires beTracker once the Metricool snippet is available.
   * @returns {void}
   */
  tag.onload = function onMetricoolLoad() {
    if (typeof window.beTracker?.t === "function") {
      window.beTracker.t({ hash });
    }
  };
  document.head.appendChild(tag);
})();
