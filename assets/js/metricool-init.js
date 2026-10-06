(function () {
  "use strict";

  const DEFAULT_HASH = "5eff58c72e852f80d27f8f1735299845";
  const current = document.currentScript;
  const hash = (current && current.getAttribute("data-metricool-hash")) || DEFAULT_HASH;
  const tag = document.createElement("script");
  tag.src = "https://tracker.metricool.com/resources/be.js";
  tag.async = true;
  tag.onload = function onMetricoolLoad() {
    if (window.beTracker && typeof window.beTracker.t === "function") {
      window.beTracker.t({ hash: hash });
    }
  };
  document.head.appendChild(tag);
})();
