(function () {
  "use strict";

  // Pricing markup is generated at build time by scripts/build-pricing.js.
  // This only switches monthly/annual and sends GA4 events (no PII).
  const track = (name, params) => {
    if (typeof window.gtag === "function") window.gtag("event", name, params);
  };

  function setBilling(billing) {
    const section = document.querySelector("#pricing");
    if (!section) return;
    section.querySelectorAll(".price-monthly").forEach((el) => { el.hidden = billing !== "monthly"; });
    section.querySelectorAll(".price-annual").forEach((el) => { el.hidden = billing !== "annual"; });
    section.dataset.billing = billing;
  }

  window.addEventListener("load", () => {
    const section = document.querySelector("#pricing");
    if (!section) return;
    const monthly = section.querySelector("#monthly");
    const yearly = section.querySelector("#yearly");
    if (monthly && yearly) {
      monthly.addEventListener("change", () => { setBilling("monthly"); track("pricing_toggle_billing", { billing: "monthly" }); });
      yearly.addEventListener("change", () => { setBilling("annual"); track("pricing_toggle_billing", { billing: "annual" }); });
    }
    setBilling(yearly && yearly.checked ? "annual" : "monthly");

    section.addEventListener("click", (e) => {
      const btn = e.target.closest("a.buy-btn[data-plan]");
      if (!btn) return;
      const params = { plan: btn.dataset.plan, billing: btn.dataset.billing };
      track("pricing_plan_click", params);
      track("checkout_start", params);
    });

    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) { track("pricing_view", {}); io.disconnect(); }
      }, { threshold: 0.3 });
      io.observe(section);
    }
  });
})();
