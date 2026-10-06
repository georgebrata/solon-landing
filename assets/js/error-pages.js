(function () {
  "use strict";

  const header = document.getElementById("header");
  const navbar = document.getElementById("navbar");
  const navToggle = document.querySelector(".mobile-nav-toggle");
  const backToTop = document.querySelector(".back-to-top");

  const onScroll = () => {
    const scrolled = window.scrollY > 100;
    if (header) {
      header.classList.toggle("header-scrolled", scrolled);
    }
    if (backToTop) {
      backToTop.classList.toggle("active", scrolled);
    }
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("load", onScroll);

  const setNavOpen = (open) => {
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
  };

  const toggleNav = () => {
    if (!navbar) {
      return;
    }
    setNavOpen(!navbar.classList.contains("navbar-mobile"));
  };

  if (navToggle) {
    navToggle.addEventListener("click", toggleNav);
    navToggle.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleNav();
      }
    });
  }
})();
