(function() {
    "use strict";
  
    /**
     * Easy selector helper function
     */
    const select = (el, all = false) => {
      el = el.trim()
      if (all) {
        return [...document.querySelectorAll(el)]
      } else {
        return document.querySelector(el)
      }
    }

    function clickMonthly() {
        select('#price-bronze').textContent = '99/lună';
        select('#price-silver').textContent = '199/lună';
        select('#price-gold').textContent = '349/lună';

        select('#link-bronze').href = 'https://buy.stripe.com/eVa4gI8jaagyb16dQV';
        select('#link-silver').href = 'https://buy.stripe.com/28o8wY1UMcoG1qwaEH';
        select('#link-gold').href = 'https://buy.stripe.com/cN2cNeczqewO9X29AB';
    }

    function clickAnnual() {
        select('#price-bronze').textContent = '999/an';
        select('#price-silver').textContent = '1,999/an';
        select('#price-gold').textContent = '2,999/an';

        select('#link-bronze').href = 'https://buy.stripe.com/7sI00sfLC88qb1614c';
        select('#link-silver').href = 'https://buy.stripe.com/dR6aF60QI60iedi5kr';
        select('#link-gold').href = 'https://buy.stripe.com/cN214wbvm4We3yEbIO';
    }

    window.addEventListener('load', () => {
        let anualPricing = select('#anual-btn')
        let monthlyPricing = select('#montly-btn')
        anualPricing.addEventListener('click', clickAnnual)
        monthlyPricing.addEventListener('click', clickMonthly)

        clickMonthly();
    });
  
  })()