"use strict";

(function () {

  const header = document.getElementById("header");
  const navbar = document.getElementById("navbar");
  const navToggle = document.querySelector(".mobile-nav-toggle");
  const backToTop = document.querySelector(".back-to-top");

  /**
   * Toggle header shadow and back-to-top visibility from scroll position.
   * @returns {void}
   */
  function onScroll() {
    const scrolled = window.scrollY > 100;
    if (header) {
      header.classList.toggle("header-scrolled", scrolled);
    }
    if (backToTop) {
      backToTop.classList.toggle("active", scrolled);
    }
  }

  /**
   * Open or close the mobile navigation overlay.
   * @param {boolean} open Whether the menu should be open.
   * @returns {void}
   */
  function setNavOpen(open) {
    if (!navbar || !navToggle) {
      return;
    }
    navbar.classList.toggle("navbar-mobile", open);
    navToggle.classList.toggle("bi-list", !open);
    navToggle.classList.toggle("bi-x", open);
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    navToggle.setAttribute(
      "aria-label",
      open ? "Închide meniul" : "Deschide meniul"
    );
  }

  /**
   * Invert the current mobile navigation open state.
   * @returns {void}
   */
  function toggleNav() {
    if (!navbar) {
      return;
    }
    setNavOpen(!navbar.classList.contains("navbar-mobile"));
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("load", onScroll);

  if (navToggle) {
    navToggle.addEventListener("click", toggleNav);
  }
})();
