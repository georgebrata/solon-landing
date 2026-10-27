"use strict";

/**
 * Homepage FAQ: items are baked into index.html at build time (scripts/build-homepage-sheets.js).
 */
(function () {
  const faqList = document.getElementById("faq-list");
  const faqListParent = document.getElementById("faq");

  document.getElementById("loading")?.classList.add("hidden");

  if (!faqList || !faqListParent) return;

  const hasItems = faqList.querySelector("li");
  if (!hasItems) {
    faqListParent.classList.add("hidden");
  }
})();
