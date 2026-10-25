"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.join(__dirname, "..");
const trackingSource = fs.readFileSync(path.join(root, "assets/js/tracking.js"), "utf8");

const loadTracking = (overrides = {}) => {
  const gtagCalls = [];
  const fbqCalls = [];
  const context = {
    console,
    window: {
      crypto: overrides.crypto,
      SolonConsent: overrides.consent,
      gtag: (...args) => {
        gtagCalls.push(args);
      },
      fbq: (...args) => {
        fbqCalls.push(args);
      },
      location: overrides.location || { pathname: "/", href: "https://solon.agency/" },
      document: overrides.document || {
        readyState: "complete",
        addEventListener() {},
        querySelector() {
          return null;
        },
      },
    },
  };
  context.crypto = context.window.crypto;
  context.globalThis = context.window;
  vm.runInNewContext(trackingSource, context, { filename: "tracking.js" });
  return {
    solonTrack: context.window.solonTrack,
    gtagCalls,
    fbqCalls,
  };
};

test("solonTrack sends nothing without consent", () => {
  const { solonTrack, gtagCalls, fbqCalls } = loadTracking({
    consent: {
      hasConsent: () => false,
    },
  });
  solonTrack("Lead", "generate_lead", { content_name: "Contact" });
  assert.equal(gtagCalls.length, 0);
  assert.equal(fbqCalls.length, 0);
});

test("solonTrack uses the same event_id for GA4 and Meta when both categories granted", () => {
  const { solonTrack, gtagCalls, fbqCalls } = loadTracking({
    consent: {
      hasConsent: (category) => category === "analytics" || category === "marketing",
    },
  });
  const returned = solonTrack("Lead", "generate_lead", { content_name: "Telefon" });
  assert.equal(gtagCalls.length, 1);
  assert.equal(fbqCalls.length, 1);
  assert.equal(typeof returned, "string");
  assert.ok(returned.length > 0);
  assert.equal(gtagCalls[0][2].event_id, returned);
  assert.equal(fbqCalls[0][3].eventID, returned);
  assert.equal(gtagCalls[0][2].content_name, "Telefon");
  assert.equal(fbqCalls[0][2].content_name, "Telefon");
});

test("solonTrack strips personal-data keys from params", () => {
  const { solonTrack, gtagCalls } = loadTracking({
    consent: { hasConsent: (c) => c === "analytics" },
  });
  solonTrack("Contact", "contact", {
    method: "email",
    email: "secret@example.com",
    phone: "+40770000000",
  });
  assert.equal(gtagCalls[0][2].method, "email");
  assert.equal(gtagCalls[0][2].email, undefined);
  assert.equal(gtagCalls[0][2].phone, undefined);
});

const {
  sanitizeParams,
  parseRonAmount,
  viewContentContextForPath,
  packageFromCheckoutHref,
} = require("../assets/js/tracking.js");

test("viewContentContextForPath matches abonament and oferta routes", () => {
  assert.deepEqual(viewContentContextForPath("/abonament/gold/"), {
    content_name: "gold",
    content_category: "pachet",
  });
  assert.deepEqual(viewContentContextForPath("/oferta-mobile/"), {
    content_name: "oferta",
    content_category: "serviciu",
  });
});

test("packageFromCheckoutHref parses short package URLs", () => {
  assert.deepEqual(packageFromCheckoutHref("https://solon.agency/silver/lunar"), {
    content_name: "silver",
    billing: "monthly",
  });
});

test("parseRonAmount reads Romanian-formatted prices", () => {
  assert.equal(parseRonAmount("1.099 lei/an"), 1099);
  assert.equal(parseRonAmount("99 lei/lună"), 99);
});
