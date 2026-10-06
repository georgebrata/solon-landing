"use strict";

/**
 * Microsoft Clarity loader. Activated only after analytics consent.
 */
(function () {

  const PROJECT_ID = "w9hin0o1ua";
  /**
   * @param {...unknown} clarityArgs
   * @returns {void}
   */
  function clarityStub(...clarityArgs) {
    if (!window.clarity.q) {
      window.clarity.q = [];
    }
    window.clarity.q.push(clarityArgs);
  }
  if (typeof window.clarity !== "function") {
    window.clarity = clarityStub;
  }
  const tag = document.createElement("script");
  tag.async = true;
  tag.src = `https://www.clarity.ms/tag/${PROJECT_ID}`;
  const first = document.getElementsByTagName("script")[0];
  if (first?.parentNode) {
    first.parentNode.insertBefore(tag, first);
  } else {
    document.head.appendChild(tag);
  }
})();
