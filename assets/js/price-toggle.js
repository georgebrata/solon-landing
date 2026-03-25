(function() {
  "use strict";

  /**
   * Easy selector helper function
   */
  const select = (el, all = false) => {
    el = el.trim();
    if (all) {
      return [...document.querySelectorAll(el)];
    }
    return document.querySelector(el);
  };

  function clickMonthly() {
    const priceBronze = select("#price-bronze");
    const priceSilver = select("#price-silver");
    const priceGold = select("#price-gold");
    const linkBronze = select("#link-bronze");
    const linkSilver = select("#link-silver");
    const linkGold = select("#link-gold");
    if (!priceBronze || !priceSilver || !priceGold || !linkBronze || !linkSilver || !linkGold) {
      return;
    }
    priceBronze.textContent = "99/lună";
    priceSilver.textContent = "199/lună";
    priceGold.textContent = "349/lună";
    linkBronze.href = "https://buy.stripe.com/14kbJ767n5X58xOeUU";
    linkSilver.href = "https://buy.stripe.com/14k6oNfHX5X5dS89AB";
    linkGold.href = "https://buy.stripe.com/7sI6oN0N3gBJ5lCcMO";
  }

  function clickAnnual() {
    const priceBronze = select("#price-bronze");
    const priceSilver = select("#price-silver");
    const priceGold = select("#price-gold");
    const linkBronze = select("#link-bronze");
    const linkSilver = select("#link-silver");
    const linkGold = select("#link-gold");
    if (!priceBronze || !priceSilver || !priceGold || !linkBronze || !linkSilver || !linkGold) {
      return;
    }
    priceBronze.textContent = "999/an";
    priceSilver.textContent = "1,999/an";
    priceGold.textContent = "2,999/an";
    linkBronze.href = "https://buy.stripe.com/7sI00sfLC88qb1614c";
    linkSilver.href = "https://buy.stripe.com/dR6aF60QI60iedi5kr";
    linkGold.href = "https://buy.stripe.com/cN214wbvm4We3yEbIO";
  }

  window.addEventListener("load", () => {
    const anualPricing = select("#anual-btn");
    const monthlyPricing = select("#montly-btn");
    if (!anualPricing || !monthlyPricing) {
      return;
    }
    anualPricing.addEventListener("click", clickAnnual);
    monthlyPricing.addEventListener("click", clickMonthly);
    clickMonthly();
  });
})();
