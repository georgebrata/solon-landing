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

        select('#link-bronze').href = 'https://buy.stripe.com/14kbJ767n5X58xOeUU';
        select('#link-silver').href = 'https://buy.stripe.com/14k6oNfHX5X5dS89AB';
        select('#link-gold').href = 'https://buy.stripe.com/7sI6oN0N3gBJ5lCcMO';
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