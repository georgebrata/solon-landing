"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { trackPartnerClick } = require("../assets/js/partners.js");

test("trackPartnerClick does not call gtag without SolonConsent", () => {
  const calls = [];
  trackPartnerClick("Lexeto", {
    solonConsent: undefined,
    gtag: (...args) => {
      calls.push(args);
    },
  });
  assert.equal(calls.length, 0);
});

test("trackPartnerClick does not call gtag when analytics consent is denied", () => {
  const calls = [];
  trackPartnerClick("Juridis", {
    solonConsent: {
      hasConsent: (category) => category !== "analytics",
    },
    gtag: (...args) => {
      calls.push(args);
    },
  });
  assert.equal(calls.length, 0);
});

test("trackPartnerClick emits partner_click with partner_name when analytics consent is granted", () => {
  const calls = [];
  trackPartnerClick("Lexeto", {
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
    "partner_click",
    { partner_name: "Lexeto" },
  ]);
});

test("trackPartnerClick ignores empty partner names", () => {
  const calls = [];
  trackPartnerClick("", {
    solonConsent: {
      hasConsent: () => true,
    },
    gtag: (...args) => {
      calls.push(args);
    },
  });
  assert.equal(calls.length, 0);
});
