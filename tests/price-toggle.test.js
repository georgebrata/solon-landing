"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { trackPricingEvent } = require("../assets/js/price-toggle.js");

test("trackPricingEvent does not call gtag without SolonConsent", () => {
  const calls = [];
  trackPricingEvent("pricing_view", {}, {
    solonConsent: undefined,
    gtag: (...args) => {
      calls.push(args);
    },
  });
  assert.equal(calls.length, 0);
});

test("trackPricingEvent does not call gtag when analytics consent is denied", () => {
  const calls = [];
  trackPricingEvent("pricing_toggle_billing", { billing: "monthly" }, {
    solonConsent: {
      hasConsent: (category) => category !== "analytics",
    },
    gtag: (...args) => {
      calls.push(args);
    },
  });
  assert.equal(calls.length, 0);
});

test("trackPricingEvent emits GA4 pricing events when analytics consent is granted", () => {
  const calls = [];
  trackPricingEvent("pricing_plan_click", { plan: "gold", billing: "annual" }, {
    solonConsent: {
      hasConsent: (category) => category === "analytics",
    },
    gtag: (...args) => {
      calls.push(args);
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    "event",
    "pricing_plan_click",
    { plan: "gold", billing: "annual" },
  ]);
});
