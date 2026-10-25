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
        addEventListener() {
          void 0;
        },
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
  assert.equal("email" in gtagCalls[0][2], false);
  assert.equal("phone" in gtagCalls[0][2], false);
});

const {
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

const assertNoEmailLeakInPayload = (payload) => {
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("@"), false, `unexpected @ in ${serialized}`);
  assert.equal(/email=/iu.test(serialized), false, `unexpected email= in ${serialized}`);
};

test("solonTrack never forwards @ or email= in gtag or fbq payloads", () => {
  const { solonTrack, gtagCalls, fbqCalls } = loadTracking({
    consent: {
      hasConsent: (category) => category === "analytics" || category === "marketing",
    },
    location: { pathname: "/", href: "https://solon.agency/?email=leak@example.com" },
  });
  solonTrack("Lead", "generate_lead", {
    content_name: "Contact",
    email: "leak@example.com",
    page_url: "https://solon.agency/?email=leak@example.com",
  });
  for (const call of gtagCalls) {
    assertNoEmailLeakInPayload(call);
  }
  for (const call of fbqCalls) {
    assertNoEmailLeakInPayload(call);
  }
});

test("page ViewContent fires on solon:pixel-ready when fbq loads after DOMContentLoaded", () => {
  const gtagCalls = [];
  const fbqCalls = [];
  const pixelReadyListeners = [];
  let domReady = null;
  const doc = {
    readyState: "loading",
    addEventListener(type, fn) {
      if (type === "DOMContentLoaded") domReady = fn;
      if (type === "solon:pixel-ready") pixelReadyListeners.push(fn);
    },
    querySelector() {
      return null;
    },
  };
  const context = {
    console,
    window: {
      SolonConsent: {
        hasConsent: (category) => category === "analytics" || category === "marketing",
      },
      gtag: (...args) => {
        gtagCalls.push(args);
      },
      location: { pathname: "/abonament/gold/", href: "https://solon.agency/abonament/gold/" },
      document: doc,
    },
  };
  context.globalThis = context.window;
  vm.runInNewContext(trackingSource, context, { filename: "tracking.js" });
  domReady?.();
  assert.equal(gtagCalls.some((call) => call[1] === "view_item"), true);
  assert.equal(fbqCalls.length, 0);
  context.window.fbq = (...args) => {
    fbqCalls.push(args);
  };
  for (const listener of pixelReadyListeners) {
    listener();
  }
  assert.equal(fbqCalls.filter((call) => call[0] === "track" && call[1] === "ViewContent").length, 1);
});

test("newsletter sign_up only on confirmare-abonare, not on other pages", () => {
  const home = loadTracking({
    consent: {
      hasConsent: (category) => category === "analytics" || category === "marketing",
    },
    location: { pathname: "/", href: "https://solon.agency/" },
  });
  assert.equal(home.gtagCalls.some((call) => call[1] === "sign_up"), false);

  const confirm = loadTracking({
    consent: {
      hasConsent: (category) => category === "analytics" || category === "marketing",
    },
    location: {
      pathname: "/confirmare-abonare/",
      href: "https://solon.agency/confirmare-abonare/",
    },
  });
  assert.equal(confirm.gtagCalls.filter((call) => call[1] === "sign_up").length, 1);
  assert.equal(
    confirm.fbqCalls.filter((call) => call[0] === "track" && call[1] === "CompleteRegistration").length,
    1,
  );
});

test("tracking.js binds click handlers only once when evaluated twice", () => {
  let captureClickHandlers = 0;
  const doc = {
    readyState: "complete",
    addEventListener(type, _fn, capture) {
      if (type === "click" && capture) captureClickHandlers += 1;
    },
    querySelector() {
      return null;
    },
  };
  const context = {
    console,
    window: {
      SolonConsent: { hasConsent: () => false },
      location: { pathname: "/", href: "https://solon.agency/" },
      document: doc,
    },
  };
  context.globalThis = context.window;
  vm.runInNewContext(trackingSource, context, { filename: "tracking.js" });
  vm.runInNewContext(trackingSource, context, { filename: "tracking.js" });
  assert.equal(captureClickHandlers, 1);
});

test("view_item on abonament includes value and items when prices are in the DOM", () => {
  const doc = {
    readyState: "complete",
    addEventListener() {
      void 0;
    },
    querySelector(sel) {
      if (sel === ".price-annual") {
        return { textContent: "1.099 lei/an" };
      }
      return null;
    },
  };
  const { gtagCalls } = loadTracking({
    consent: { hasConsent: (c) => c === "analytics" },
    location: { pathname: "/abonament/gold/", href: "https://solon.agency/abonament/gold/" },
    document: doc,
  });
  const viewCall = gtagCalls.find((call) => call[1] === "view_item");
  assert.ok(viewCall);
  assert.equal(viewCall[2].value, 1099);
  assert.equal(viewCall[2].currency, "RON");
  assert.equal(viewCall[2].items[0].price, 1099);
});

test("checkout on external pay link uses beacon transport and delays navigation", () => {
  const gtagCalls = [];
  const timeouts = [];
  let navigatedTo = "";
  const link = {
    tagName: "A",
    classList: { contains: () => false },
    getAttribute(name) {
      if (name === "href") return "https://pay.netopia.ro/start";
      if (name === "data-plan") return "gold";
      return null;
    },
    closest() {
      return link;
    },
  };
  const event = {
    target: link,
    preventDefault() {},
  };
  const priorGtag = globalThis.gtag;
  const priorConsent = globalThis.SolonConsent;
  const priorLocation = globalThis.location;
  const priorSetTimeout = globalThis.setTimeout;
  globalThis.SolonConsent = {
    hasConsent: (category) => category === "analytics" || category === "marketing",
  };
  globalThis.fbq = () => {};
  globalThis.gtag = (...args) => {
    gtagCalls.push(args);
  };
  globalThis.location = {
    pathname: "/",
    href: "https://solon.agency/",
    set href(value) {
      navigatedTo = value;
    },
    get href() {
      return navigatedTo || "https://solon.agency/";
    },
  };
  globalThis.setTimeout = (fn, ms) => {
    timeouts.push(ms);
    fn();
  };
  const { trackCheckoutClick } = require("../assets/js/tracking.js");
  trackCheckoutClick(link, event);
  if (priorGtag !== undefined) globalThis.gtag = priorGtag;
  else delete globalThis.gtag;
  if (priorConsent !== undefined) globalThis.SolonConsent = priorConsent;
  else delete globalThis.SolonConsent;
  globalThis.location = priorLocation;
  globalThis.setTimeout = priorSetTimeout;
  const checkoutCall = gtagCalls.find((call) => call[1] === "begin_checkout");
  assert.ok(checkoutCall);
  assert.equal(checkoutCall[2].transport_type, "beacon");
  assert.equal(navigatedTo, "https://pay.netopia.ro/start");
  assert.ok(timeouts.includes(120));
});

test("newsletter sign_up fires at most once per session (form and confirm page)", () => {
  const session = {};
  const gtagCalls = [];
  const fbqCalls = [];
  const context = {
    console,
    window: {
      SolonConsent: {
        hasConsent: (category) => category === "analytics" || category === "marketing",
      },
      gtag: (...args) => {
        gtagCalls.push(args);
      },
      fbq: (...args) => {
        fbqCalls.push(args);
      },
      location: { pathname: "/confirmare-abonare/", href: "https://solon.agency/confirmare-abonare/" },
      sessionStorage: {
        getItem(key) {
          return Object.prototype.hasOwnProperty.call(session, key) ? session[key] : null;
        },
        setItem(key, value) {
          session[key] = String(value);
        },
      },
      document: {
        readyState: "complete",
        addEventListener() {
          void 0;
        },
        querySelector() {
          return null;
        },
      },
    },
  };
  context.globalThis = context.window;
  vm.runInNewContext(trackingSource, context, { filename: "tracking.js" });
  assert.equal(gtagCalls.length, 1);
  assert.equal(fbqCalls.length, 1);
  const firstEventId = gtagCalls[0][2].event_id;
  context.window.solonTrackNewsletterSignUp();
  assert.equal(gtagCalls.length, 1);
  assert.equal(fbqCalls.length, 1);
  assert.equal(fbqCalls[0][3].eventID, firstEventId);
});
