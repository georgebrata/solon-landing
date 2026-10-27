"use strict";

/**
 * Homepage testimonials are baked into index.html at build time (scripts/build-homepage-sheets.js).
 */
(function () {
  const section = document.getElementById("testimonials");
  const carousel = section?.querySelector(".carousel-inner");
  if (!section || !carousel) return;
  if (!carousel.querySelector(".carousel-item")) {
    section.classList.add("hidden");
  }
})();
