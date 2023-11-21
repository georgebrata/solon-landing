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
        select('#price-gold').textContent = '399/lună';

        select('#link-bronze').href = 'https://buy.stripe.com/eVaaIFc6p7CN1cA3cc';
        select('#link-silver').href = '';
        select('#link-gold').href = '';
    }

    function clickAnnual() {
        select('#price-bronze').textContent = '951/an';
        select('#price-silver').textContent = '1,911/an';
        select('#price-gold').textContent = '3,831/an';

        select('#link-bronze').href = 'https://buy.stripe.com/bIY041c6p4qB1cA5kl';
        select('#link-silver').href = '';
        select('#link-gold').href = '';
    }

    window.addEventListener('load', () => {
        let anualPricing = select('#anual-btn')
        let monthlyPricing = select('#montly-btn')
        anualPricing.addEventListener('click', clickAnnual)
        monthlyPricing.addEventListener('click', clickMonthly)
    });
  
  })()