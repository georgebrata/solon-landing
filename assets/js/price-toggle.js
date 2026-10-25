(function () {
  "use strict";

  // Pricing markup is generated at build time by scripts/build-pricing.js.
  // This only switches monthly/annual and sends GA4 events (no PII).

  /**
   * @param {string} name
   * @param {Record<string, string>} params
   * @param {{ solonConsent?: { hasConsent?: (category: string) => boolean } | null, gtag?: ((...args: unknown[]) => void) | null }} [deps]
   */
  function trackPricingEvent(name, params, deps) {
    const env = deps ?? {};
    let consentApi = env.solonConsent;
    let gtagFn = env.gtag;

    if (consentApi === undefined && typeof window !== "undefined") {
      consentApi = window.SolonConsent;
    }
    if (gtagFn === undefined && typeof window !== "undefined") {
      gtagFn = window.gtag;
    }

    if (
      consentApi === null ||
      consentApi === undefined ||
      typeof consentApi.hasConsent !== "function" ||
      !consentApi.hasConsent("analytics")
    ) {
      return;
    }

    if (typeof gtagFn !== "function") {
      return;
    }

    gtagFn("event", name, params);
  }

  /** @param {"monthly" | "annual"} billing */
  function setBilling(billing) {
    const section = document.querySelector("#pricing");
    if (!section) return;
    section.querySelectorAll(".price-monthly").forEach((el) => {
      el.hidden = billing !== "monthly";
    });
    section.querySelectorAll(".price-annual").forEach((el) => {
      el.hidden = billing !== "annual";
    });
    section.dataset.billing = billing;
  }

  /** Wire billing toggle, plan clicks, and one-time pricing_view when #pricing is visible. */
  function initPricingToggle() {
    const section = document.querySelector("#pricing");
    if (!section) return;
    const monthly = section.querySelector("#monthly");
    const yearly = section.querySelector("#yearly");
    if (monthly && yearly) {
      monthly.addEventListener("change", () => {
        setBilling("monthly");
        trackPricingEvent("pricing_toggle_billing", { billing: "monthly" });
      });
      yearly.addEventListener("change", () => {
        setBilling("annual");
        trackPricingEvent("pricing_toggle_billing", { billing: "annual" });
      });
    }
    setBilling(yearly?.checked ? "annual" : "monthly");

    section.addEventListener("click", (e) => {
      const btn = e.target.closest("a.buy-btn[data-plan]");
      if (!btn) return;
      const params = { plan: btn.dataset.plan, billing: btn.dataset.billing };
      trackPricingEvent("pricing_plan_click", params);
    });

    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((en) => en.isIntersecting)) {
            trackPricingEvent("pricing_view", {});
            io.disconnect();
          }
        },
        { threshold: 0.3 },
      );
      io.observe(section);
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { trackPricingEvent, setBilling, initPricingToggle };
  }

  if (typeof window !== "undefined") {
    window.addEventListener("load", () => {
      initPricingToggle();
    });
  }
})();
