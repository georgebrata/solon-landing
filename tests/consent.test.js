"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/js/consent.js"), "utf8");
const gtagConfigSource = fs.readFileSync(path.join(root, "assets/js/gtag-config.js"), "utf8");

/**
 * @param {unknown} value
 * @returns {void}
 */
const assertIsArgumentsObject = (value) => {
  assert.equal(Object.prototype.toString.call(value), "[object Arguments]");
  assert.equal(Array.isArray(value), false);
};

/**
 * @param {string} category
 * @param {Record<string, string>} [attrs]
 * @returns {object}
 */
const createInertScript = function createInertScript(category, attrs) {
  const attributeList = [
    { name: "type", value: "text/plain" },
    { name: "data-consent-category", value: category },
  ];
  const extra = attrs || {};
  for (const name of Object.keys(extra)) {
    attributeList.push({ name, value: extra[name] });
  }
  const el = {
    attributes: attributeList,
    textContent: extra.body || "",
    parentNode: {
      inserted: null,
      insertBefore(next) {
        this.inserted = next;
      },
      removeChild(child) {
        child.removed = true;
      },
    },
    getAttribute(name) {
      if (name === "data-consent-activated") return this.activated || null;
      const found = attributeList.find((item) => item.name === name);
      if (!found) {
        return null;
      }
      return found.value;
    },
    setAttribute(name, value) {
      if (name === "data-consent-activated") this.activated = value;
    },
  };
  return el;
};

/**
 * @param {{store?: object, inertScripts?: object[], cookie?: string}} [options]
 * @returns {{api: object, context: object, store: object, created: object[], inertScripts: object[], listeners: object}}
 */
const loadConsent = function loadConsent(options = {}) {
  const store = options.store || {};
  const sessionStore = options.sessionStore || {};
  const inertScripts = options.inertScripts || [];
  const created = [];
  let cookieStr = options.cookie || "";
  const listeners = {};

  const document = {
    readyState: "loading",
    visibilityState: "visible",
    cookie: "",
    body: {
      _children: [],
      appendChild(node) {
        this._children.push(node);
        return node;
      },
    },
    head: {
      appendChild(node) {
        return node;
      },
    },
    getElementById() {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (String(selector).includes("data-consent-category")) {
        return inertScripts.filter((el) => !el.removed);
      }
      return [];
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    },
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(),
        attributes: [],
        _children: [],
        text: "",
        setAttribute(name, value) {
          this.attributes.push({ name, value });
          this[name] = value;
          if (name === "class") {
            this.className = value;
          }
        },
        getAttribute(name) {
          const found = this.attributes.find((item) => item.name === name);
          if (!found) {
            return null;
          }
          return found.value;
        },
        appendChild(child) {
          this._children.push(child);
          return child;
        },
        addEventListener() {
          return undefined;
        },
        getBoundingClientRect() {
          return { height: 48 };
        },
      };
      created.push(el);
      return el;
    },
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
  };

  Object.defineProperty(document, "cookie", {
    configurable: true,
    get() {
      return cookieStr;
    },
    set(value) {
      if (cookieStr) {
        cookieStr = `${cookieStr}; ${value}`;
      } else {
        cookieStr = String(value);
      }
    },
  });

  const context = {
    console,
    Date,
    JSON,
    Object,
    Array,
    Number,
    String,
    Error,
    addEventListener() {
      return undefined;
    },
    requestAnimationFrame(fn) {
      fn();
    },
    document,
    localStorage: {
      getItem(key) {
        if (Object.prototype.hasOwnProperty.call(store, key)) {
          return store[key];
        }
        return null;
      },
      setItem(key, value) {
        store[key] = String(value);
      },
      removeItem(key) {
        delete store[key];
      },
    },
    sessionStorage: {
      getItem(key) {
        if (Object.prototype.hasOwnProperty.call(sessionStore, key)) {
          return sessionStore[key];
        }
        return null;
      },
      setItem(key, value) {
        sessionStore[key] = String(value);
      },
      removeItem(key) {
        delete sessionStore[key];
      },
    },
    location: {
      pathname: "/",
      protocol: "https:",
      hostname: "solon.agency",
      href: "https://solon.agency/",
    },
  };
  if (options.preGtag) {
    context.gtag = options.preGtag;
  }
  if (options.dataLayer) {
    context.dataLayer = options.dataLayer;
  }
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { api: context.SolonConsent, context, store, sessionStore, created, inertScripts, listeners };
};

test("default state denies analytics and marketing", () => {
  const { api, context } = loadConsent();
  assert.equal(api.hasConsent("necessary"), true);
  assert.equal(api.hasConsent("analytics"), false);
  assert.equal(api.hasConsent("marketing"), false);
  const defaults = context.dataLayer[0];
  assertIsArgumentsObject(defaults);
  assert.equal(defaults[0], "consent");
  assert.equal(defaults[1], "default");
  assert.equal(defaults[2].analytics_storage, "denied");
  assert.equal(defaults[2].ad_storage, "denied");
  assert.equal(defaults[2].ad_user_data, "denied");
  assert.equal(defaults[2].ad_personalization, "denied");
  for (const entry of context.dataLayer) {
    assertIsArgumentsObject(entry);
  }
});

test("consent default is queued before gtag config with Arguments on dataLayer", () => {
  const { context } = loadConsent();
  for (const entry of context.dataLayer) {
    assertIsArgumentsObject(entry);
  }
  vm.runInNewContext(gtagConfigSource, context, { filename: "gtag-config.js" });
  const dataLayer = context.dataLayer;
  const defaultIdx = dataLayer.findIndex((entry) => entry[0] === "consent" && entry[1] === "default");
  const configIdx = dataLayer.findIndex((entry) => entry[0] === "config");
  assert.ok(defaultIdx >= 0);
  assert.ok(configIdx >= 0);
  assert.ok(defaultIdx < configIdx, "consent default must precede config");
  for (const entry of dataLayer) {
    assertIsArgumentsObject(entry);
  }
});

test("accept all persists version, timestamp, and both categories", () => {
  const { api, store } = loadConsent();
  const saved = api.acceptAll();
  assert.equal(saved.analytics, true);
  assert.equal(saved.marketing, true);
  assert.equal(saved.version, api.CONSENT_VERSION);
  assert.ok(Date.parse(saved.timestamp));
  const parsed = JSON.parse(store[api.STORAGE_KEY]);
  assert.equal(parsed.analytics, true);
  assert.equal(parsed.marketing, true);
});

test("rejection expires sib_ cookies even when the tracker never started", () => {
  const { api, context } = loadConsent({ cookie: "sib_cuid=abc-123; visitor=keep; _ga=GA1.1" });
  api.rejectAll();
  const jar = context.document.cookie;
  assert.match(jar, /sib_cuid=; Path=\/; Max-Age=0/);
  assert.match(jar, /_ga=; Path=\/; Max-Age=0/);
  assert.equal(jar.includes("visitor=; Path=/; Max-Age=0"), false);
});

test("rejection expires Meta _fbp and _fbc cookies", () => {
  const { api, context } = loadConsent({
    cookie: "_fbp=fb.1.123; _fbc=fb.2.456; visitor=keep",
  });
  api.rejectAll();
  const jar = context.document.cookie;
  assert.match(jar, /_fbp=; Path=\/; Max-Age=0/);
  assert.match(jar, /_fbc=; Path=\/; Max-Age=0/);
  assert.equal(jar.includes("visitor=; Path=/; Max-Age=0"), false);
});

test("meta-pixel script stays inert until marketing consent", () => {
  const pixel = createInertScript("marketing", {
    src: "/assets/js/meta-pixel.min.js",
  });
  const { api, created } = loadConsent({ inertScripts: [pixel] });
  assert.equal(created.length, 0);
  api.saveCustom({ analytics: true, marketing: false });
  assert.equal(created.length, 0);
  api.acceptAll();
  const activated = created.filter((el) => String(el.src || "").includes("meta-pixel.min.js"));
  assert.equal(activated.length, 1);
  assert.equal(pixel.activated, "true");
});

test("reject all persists denied optional categories", () => {
  const { api, store } = loadConsent();
  api.acceptAll();
  const saved = api.rejectAll();
  assert.equal(saved.analytics, false);
  assert.equal(saved.marketing, false);
  const parsed = JSON.parse(store[api.STORAGE_KEY]);
  assert.equal(parsed.analytics, false);
});

test("marketing withdrawal stops Brevo and an analytics-only change does not", () => {
  const { api, context } = loadConsent();
  const calls = [];
  context.SolonBrevo = {
    start() {
      calls.push("start");
    },
    stop() {
      calls.push("stop");
    },
  };
  api.acceptAll();
  assert.deepEqual(calls, ["start"]);
  calls.length = 0;
  api.saveCustom({ analytics: false, marketing: true });
  assert.deepEqual(calls, ["start"]);
  calls.length = 0;
  api.saveCustom({ analytics: true, marketing: false });
  assert.deepEqual(calls, ["stop"]);
  calls.length = 0;
  api.rejectAll();
  assert.deepEqual(calls, ["stop"]);
});

test("custom mix persists and rehydrates", () => {
  const first = loadConsent();
  first.api.saveCustom({ analytics: true, marketing: false });
  const second = loadConsent({ store: first.store });
  assert.equal(second.api.hasConsent("analytics"), true);
  assert.equal(second.api.hasConsent("marketing"), false);
  assert.equal(second.api.getConsent().version, first.api.CONSENT_VERSION);
});

test("applyChoice marketing-only grants Meta without revoking it afterward", () => {
  const fbqCalls = [];
  const { api, context } = loadConsent({ cookie: "_ga=GA1.1; _fbp=fb.1; visitor=keep" });
  context.fbq = (...args) => {
    fbqCalls.push(args);
  };
  api.applyChoice(
    { necessary: true, analytics: false, marketing: true },
    { persist: false },
  );
  assert.deepEqual(fbqCalls[fbqCalls.length - 1], ["consent", "grant"]);
  const jar = context.document.cookie;
  assert.match(jar, /_ga=; Path=\/; Max-Age=0/);
  assert.equal(jar.includes("_fbp=; Path=/; Max-Age=0"), false);
  assert.equal(jar.includes("visitor=; Path=/; Max-Age=0"), false);
});

test("applyChoice analytics-only revokes Meta but keeps GA cookies", () => {
  const fbqCalls = [];
  const { api, context } = loadConsent({ cookie: "_ga=GA1.1; _fbp=fb.1; visitor=keep" });
  context.fbq = (...args) => {
    fbqCalls.push(args);
  };
  api.applyChoice(
    { necessary: true, analytics: true, marketing: false },
    { persist: false },
  );
  assert.ok(fbqCalls.some((call) => call[0] === "consent" && call[1] === "revoke"));
  const jar = context.document.cookie;
  assert.match(jar, /_fbp=; Path=\/; Max-Age=0/);
  assert.equal(jar.includes("_ga=; Path=/; Max-Age=0"), false);
});

test("version bump invalidates stored choice", () => {
  const { api } = loadConsent();
  const stale = JSON.stringify({
    version: 1,
    timestamp: new Date().toISOString(),
    necessary: true,
    analytics: true,
    marketing: true,
  });
  assert.equal(api.parseConsent(stale), null);
});

test("stored consent v1 re-prompts and denies trackers until a v2 choice", () => {
  const key = "solon_cookie_consent";
  const { api, listeners, context } = loadConsent({
    store: {
      [key]: JSON.stringify({
        version: 1,
        timestamp: new Date().toISOString(),
        necessary: true,
        analytics: true,
        marketing: true,
      }),
    },
  });
  assert.equal(api.readStored(), null);
  assert.equal(api.hasConsent("analytics"), false);
  assert.equal(api.hasConsent("marketing"), false);
  if (listeners.DOMContentLoaded) {
    listeners.DOMContentLoaded();
  }
  const findBanner = (node) => {
    if (!node || typeof node !== "object") return null;
    const cls = node.className || "";
    if (String(cls).includes("solon-consent__banner")) return node;
    for (const child of node._children || []) {
      const found = findBanner(child);
      if (found) return found;
    }
    return null;
  };
  const roots = context.document.body._children || [];
  const banner = roots.map(findBanner).find(Boolean);
  assert.ok(banner, "banner should mount when stored consent is invalid");
  assert.equal(banner.hidden, false);
});

test("expired timestamp invalidates stored choice", () => {
  const { api } = loadConsent();
  const stale = JSON.stringify({
    version: api.CONSENT_VERSION,
    timestamp: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
    necessary: true,
    analytics: true,
    marketing: true,
  });
  assert.equal(api.parseConsent(stale), null);
});

test("before analytics consent gtag.js and gtag-config stay type text/plain", () => {
  const gtagJs = createInertScript("analytics", {
    src: "https://www.googletagmanager.com/gtag/js?id=G-H41D7KCWHX",
  });
  const gtagConfig = createInertScript("analytics", {
    src: "/assets/js/gtag-config.min.js",
  });
  const { api, context, created } = loadConsent({
    inertScripts: [gtagJs, gtagConfig],
  });
  api.activateInertScripts(api.getConsent());
  assert.equal(created.length, 0);
  assert.equal(gtagJs.getAttribute("type"), "text/plain");
  assert.equal(gtagConfig.getAttribute("type"), "text/plain");
  assert.equal(typeof gtagJs.activated, "undefined");
  assert.equal(typeof gtagConfig.activated, "undefined");
  const dataLayer = context.dataLayer;
  assert.ok(dataLayer.length >= 1);
  assertIsArgumentsObject(dataLayer[0]);
  assert.equal(dataLayer[0][0], "consent");
  assert.equal(dataLayer[0][1], "default");
  assert.equal(dataLayer[0][2].analytics_storage, "denied");
  assert.equal(
    dataLayer.some((entry) => entry[0] === "js" || entry[0] === "config"),
    false,
    "gtag-config must not run before analytics consent",
  );
});

const GA_DISABLE_KEY = "ga-disable-G-H41D7KCWHX";

/**
 * Simulates gtag.js honoring the ga-disable property on unload-style hits.
 * @param {object} win
 * @returns {number}
 */
const simulateGaUnloadHit = (win) => {
  if (win[GA_DISABLE_KEY] === true) {
    return 0;
  }
  if (typeof win.gtag === "function") {
    win.gtag("event", "user_engagement", { engagement_time_msec: 1 });
    return 1;
  }
  return 0;
};

test("analytics withdrawal sets ga-disable before consent update and cookie clearing", () => {
  const order = [];
  const { api, context } = loadConsent({ cookie: "_ga=GA1.1" });
  const gaDisableState = { value: context[GA_DISABLE_KEY] };
  delete context[GA_DISABLE_KEY];
  Object.defineProperty(context, GA_DISABLE_KEY, {
    configurable: true,
    enumerable: true,
    get() {
      return gaDisableState.value;
    },
    set(value) {
      order.push({ step: "ga-disable", value });
      gaDisableState.value = value;
    },
  });
  const originalGtag = context.gtag;
  const trackingGtag = function (...args) {
    if (args[0] === "consent" && args[1] === "update") {
      order.push({ step: "consent-update", payload: args[2] });
    }
    return originalGtag(...args);
  };
  trackingGtag.__solonArgumentsStub = true;
  context.gtag = trackingGtag;
  const cookieDescriptor = Object.getOwnPropertyDescriptor(context.document, "cookie");
  Object.defineProperty(context.document, "cookie", {
    configurable: true,
    get() {
      return cookieDescriptor.get.call(context.document);
    },
    set(value) {
      if (String(value).includes("Max-Age=0")) {
        order.push({ step: "cookie-expire", value: String(value) });
      }
      return cookieDescriptor.set.call(context.document, value);
    },
  });
  api.acceptAll();
  order.length = 0;
  api.saveCustom({ analytics: false, marketing: true });
  const disableIdx = order.findIndex((entry) => entry.step === "ga-disable" && entry.value === true);
  const updateIdx = order.findIndex((entry) => entry.step === "consent-update");
  const cookieIdx = order.findIndex((entry) => entry.step === "cookie-expire");
  assert.ok(disableIdx >= 0);
  assert.ok(updateIdx >= 0);
  assert.ok(cookieIdx >= 0);
  assert.ok(disableIdx < updateIdx);
  assert.ok(updateIdx < cookieIdx);
  const updatePayload = order[updateIdx].payload;
  assert.equal(updatePayload.analytics_storage, "denied");
  assert.equal(updatePayload.ad_storage, "granted");
});

test("withdraw-then-unload sends zero GA hits when ga-disable is set", () => {
  const { api, context } = loadConsent();
  api.acceptAll();
  const beforeWithdraw = simulateGaUnloadHit(context);
  assert.equal(beforeWithdraw, 1);
  api.saveCustom({ analytics: false, marketing: true });
  assert.equal(context[GA_DISABLE_KEY], true);
  const afterWithdraw = simulateGaUnloadHit(context);
  assert.equal(afterWithdraw, 0);
});

test("analytics re-grant clears ga-disable before consent update and resumes hits", () => {
  const order = [];
  const { api, context } = loadConsent();
  api.acceptAll();
  const gaDisableState = { value: context[GA_DISABLE_KEY] };
  delete context[GA_DISABLE_KEY];
  Object.defineProperty(context, GA_DISABLE_KEY, {
    configurable: true,
    enumerable: true,
    get() {
      return gaDisableState.value;
    },
    set(value) {
      order.push({ step: "ga-disable", value });
      gaDisableState.value = value;
    },
  });
  const originalGtag = context.gtag;
  const trackingGtag = function (...args) {
    if (args[0] === "consent" && args[1] === "update") {
      order.push({ step: "consent-update", payload: args[2] });
    }
    return originalGtag(...args);
  };
  trackingGtag.__solonArgumentsStub = true;
  context.gtag = trackingGtag;
  api.saveCustom({ analytics: false, marketing: true });
  order.length = 0;
  api.saveCustom({ analytics: true, marketing: true });
  const disableIdx = order.findIndex((entry) => entry.step === "ga-disable" && entry.value === false);
  const updateIdx = order.findIndex((entry) => entry.step === "consent-update");
  assert.ok(disableIdx >= 0);
  assert.ok(updateIdx >= 0);
  assert.ok(disableIdx < updateIdx);
  assert.equal(order[updateIdx].payload.analytics_storage, "granted");
  assert.equal(simulateGaUnloadHit(context), 1);
});

test("foreign gtag is replaced without forwarding commands", () => {
  const dataLayer = [];
  const foreignCalls = [];
  const { context } = loadConsent({
    dataLayer,
    preGtag(...args) {
      foreignCalls.push([...args]);
    },
  });
  assert.equal(context.gtag.__solonArgumentsStub, true);
  assert.equal(foreignCalls.length, 0);
  context.gtag("event", "probe", { ok: true });
  assert.equal(foreignCalls.length, 0);
  const pushed = dataLayer[dataLayer.length - 1];
  assertIsArgumentsObject(pushed);
  assert.equal(pushed[0], "event");
});

test("boot with no stored consent sets ga-disable", () => {
  const { api, context } = loadConsent();
  assert.equal(context[api.GA_DISABLE_PROPERTY], true);
});

test("boot with stored analytics denial sets ga-disable", () => {
  const store = {};
  const timestamp = new Date().toISOString();
  store.solon_cookie_consent = JSON.stringify({
    version: 2,
    timestamp,
    necessary: true,
    analytics: false,
    marketing: false,
  });
  const { api, context } = loadConsent({ store });
  assert.equal(context[api.GA_DISABLE_PROPERTY], true);
});

test("storage event from another tab withdraws analytics on this tab", () => {
  const store = {};
  const tabA = loadConsent({ store, cookie: "_ga=GA1.1; _ga_H41D7KCWHX=1" });
  tabA.api.acceptAll();
  assert.equal(tabA.context[tabA.api.GA_DISABLE_PROPERTY], false);
  const tabB = loadConsent({ store });
  tabB.api.saveCustom({ analytics: false, marketing: true });
  tabA.api.onConsentStorageEvent({
    key: tabA.api.STORAGE_KEY,
    storageArea: tabA.context.localStorage,
    newValue: store[tabA.api.STORAGE_KEY],
  });
  assert.equal(tabA.context[tabA.api.GA_DISABLE_PROPERTY], true);
  assert.match(tabA.context.document.cookie, /_ga=; Path=\/; Max-Age=0/);
});

test("visibilitychange with missing consent cookie sets ga-disable and clears analytics", () => {
  const { api, context } = loadConsent({ cookie: "_ga=GA1.1" });
  api.acceptAll();
  const cookieBacking = { value: context.document.cookie };
  Object.defineProperty(context.document, "cookie", {
    configurable: true,
    get() {
      return cookieBacking.value;
    },
    set(value) {
      cookieBacking.value = String(value);
    },
  });
  cookieBacking.value = "";
  context.document.visibilityState = "visible";
  api.onVisibilityCookieRefresh();
  assert.equal(context[api.GA_DISABLE_PROPERTY], true);
  assert.equal(api.hasConsent("analytics"), false);
});

test("consent gtag stub output is accepted by a gtag.js-like Arguments-only consumer", () => {
  const { context } = loadConsent();
  const accepted = [];
  for (const entry of context.dataLayer) {
    if (Object.prototype.toString.call(entry) !== "[object Arguments]") {
      throw new Error("gtag.js consumer rejected non-Arguments dataLayer entry");
    }
    accepted.push(entry);
  }
  context.gtag("event", "probe", { ok: true });
  const last = context.dataLayer[context.dataLayer.length - 1];
  assert.equal(Object.prototype.toString.call(last), "[object Arguments]");
  assert.equal(last[0], "event");
});

test("reject all never activates GA gtag inert scripts", () => {
  const gtagJs = createInertScript("analytics", {
    src: "https://www.googletagmanager.com/gtag/js?id=G-H41D7KCWHX",
  });
  const gtagConfig = createInertScript("analytics", {
    src: "/assets/js/gtag-config.min.js",
  });
  const { api, created } = loadConsent({
    inertScripts: [gtagJs, gtagConfig],
  });
  api.rejectAll();
  const activatedGa = created.filter(
    (el) =>
      String(el.src || "").includes("googletagmanager.com/gtag/js") ||
      String(el.src || "").includes("gtag-config"),
  );
  assert.equal(activatedGa.length, 0);
  assert.equal(gtagJs.getAttribute("type"), "text/plain");
  assert.equal(gtagConfig.getAttribute("type"), "text/plain");
});

test("inert analytics scripts stay inert until analytics consent", () => {
  const analytics = createInertScript("analytics", {
    src: "https://www.googletagmanager.com/gtag/js?id=G-H41D7KCWHX",
  });
  const marketing = createInertScript("marketing", {
    src: "https://example.com/meta-pixel.min.js",
  });
  const { api, created } = loadConsent({
    inertScripts: [analytics, marketing],
  });
  api.activateInertScripts(api.getConsent());
  assert.equal(created.length, 0);
  assert.equal(typeof analytics.activated, "undefined");

  api.saveCustom({ analytics: true, marketing: false });
  const activated = created.filter((el) => el.src);
  assert.equal(activated.length, 1);
  assert.equal(activated[0].src, "https://www.googletagmanager.com/gtag/js?id=G-H41D7KCWHX");
  assert.equal(analytics.activated, "true");
  assert.equal(typeof marketing.activated, "undefined");
});

test("accept all activates analytics and marketing inert tags", () => {
  const analytics = createInertScript("analytics", {
    src: "https://analytics.ahrefs.com/analytics.js",
  });
  const marketing = createInertScript("marketing", {
    src: "https://cdn.brevo.com/js/sdk-loader.js",
  });
  const { api, created, context } = loadConsent({
    inertScripts: [analytics, marketing],
  });
  api.acceptAll();
  const srcs = created.map((el) => el.src).filter((src) => src);
  assert.ok(srcs.includes("https://analytics.ahrefs.com/analytics.js"));
  assert.ok(srcs.includes("https://cdn.brevo.com/js/sdk-loader.js"));
  const last = context.dataLayer[context.dataLayer.length - 1];
  assertIsArgumentsObject(last);
  assert.equal(last[0], "consent");
  assert.equal(last[1], "update");
  assert.equal(last[2].analytics_storage, "granted");
  assert.equal(last[2].ad_storage, "granted");
});

test("accept all grants Meta Pixel consent when fbq is present", () => {
  const fbqCalls = [];
  const { api, context } = loadConsent();
  context.fbq = (...args) => {
    fbqCalls.push(args);
  };
  api.acceptAll();
  const grants = fbqCalls.filter((args) => args[0] === "consent" && args[1] === "grant");
  assert.equal(grants.length, 1);
});

/**
 * @returns {string[]}
 */
const htmlFiles = function htmlFiles() {
  const files = [];
  const skipDirs = new Set([".git", "node_modules", "assets", "scripts", "tests", "docs", "r"]);
  /**
   * @param {string} dir
   */
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (!skipDirs.has(name)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (name.endsWith(".html")) {
          files.push(full);
        }
      }
    }
  }
  walk(root);
  return files;
};

const SKIP_GATING = new Set([
  path.join(root, "100/index.html"),
  path.join(root, "1000/index.html"),
  path.join(root, "templates/list.html"),
  path.join(root, "templates/post.html"),
]);

/**
 * @param {string} html
 * @returns {boolean}
 */
const hasLiveTracker = function hasLiveTracker(html) {
  const re = /<script(\s[\s\S]*?)?>([\s\S]*?)<\/script>/gi;
  let match = re.exec(html);
  while (match) {
    const attrs = match[1] || "";
    const body = match[2] || "";
    const isInert = /type\s*=\s*["']text\/plain["']/i.test(attrs);
    const isConsent = /consent\.min\.js/.test(attrs);
    if (!isInert && !isConsent) {
      const haystack = `${attrs}\n${body}`;
      if (
        /googletagmanager\.com\/gtag|cdn\.counter\.dev|analytics\.ahrefs\.com|cdn\.brevo\.com|brevo-tracker|sibautomation\.com|tracker\.metricool\.com|clarity\.ms\/tag|connect\.facebook\.net|meta-pixel|G-H41D7KCWHX|client_key:\s*"mwgotrl8|beTracker|mny\.ro/.test(
          haystack
        )
      ) {
        return true;
      }
    }
    match = re.exec(html);
  }
  return /<noscript>[\s\S]*facebook\.com\/tr[\s\S]*<\/noscript>/i.test(html);
};

test("non-essential tracker tags are inert on source and generated pages", () => {
  const offenders = [];
  for (const file of htmlFiles()) {
    if (!SKIP_GATING.has(file)) {
      const html = fs.readFileSync(file, "utf8");
      if (hasLiveTracker(html)) {
        offenders.push(path.relative(root, file));
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("clean visit does not request mny.ro until Acceptă toate", async () => {
  const widget = createInertScript("marketing", {
    src: "https://mny.ro/npId.js?p=143413",
  });
  const denied = loadConsent({ inertScripts: [widget] });
  assert.equal(denied.created.length, 0);
  assert.equal(typeof widget.activated, "undefined");

  denied.api.saveCustom({ analytics: true, marketing: false });
  assert.equal(typeof widget.activated, "undefined");

  denied.api.acceptAll();
  const activated = denied.created.filter((el) => el.src === "https://mny.ro/npId.js?p=143413");
  assert.equal(activated.length, 1);
  assert.equal(widget.activated, "true");

  const live = [];
  const wrongCategory = [];
  for (const file of htmlFiles()) {
    if (!SKIP_GATING.has(file)) {
      const html = fs.readFileSync(file, "utf8");
      const re = /<script([^>]*)>/gi;
      let match = re.exec(html);
      while (match) {
        const attrs = match[1] || "";
        const mentionsMny = /mny\.ro/i.test(attrs);
        const isInert = /type\s*=\s*["']text\/plain["']/i.test(attrs);
        const isMarketing = /data-consent-category\s*=\s*["']marketing["']/i.test(attrs);
        if (mentionsMny && !isInert) {
          live.push(path.relative(root, file));
        }
        if (mentionsMny && !isMarketing) {
          wrongCategory.push(path.relative(root, file));
        }
        match = re.exec(html);
      }
    }
  }
  assert.deepEqual(live, []);
  assert.deepEqual(wrongCategory, []);

  const homepage = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(homepage);
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    let port = 0;
    if (address && typeof address === "object") {
      port = address.port;
    }
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const body = await res.text();
    const liveOnVisit = /<script(?![^>]*type=["']text\/plain["'])[^>]*mny\.ro/i.test(body);
    assert.equal(liveOnVisit, false);
    assert.match(body, /data-consent-category="marketing" src="https:\/\/mny\.ro\/npId\.js/);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
});

test("pages with trackers or site footer include the consent manager", () => {
  const missing = [];
  for (const file of htmlFiles()) {
    if (!SKIP_GATING.has(file)) {
      const rel = path.relative(root, file);
      const html = fs.readFileSync(file, "utf8");
      const hasTrackers =
        html.includes("data-consent-category") ||
        html.includes("clarity.ms") ||
        html.includes("analytics.ahrefs");
      const hasFooter = html.includes('id="footer"');
      if (hasTrackers || hasFooter) {
        if (!html.includes("/assets/js/consent.min.js")) {
          missing.push(`${rel} (consent.js)`);
        }
        if (hasFooter && !html.includes("data-solon-consent-open")) {
          missing.push(`${rel} (Setări cookie)`);
        }
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("cookies policy describes the banner, categories, and all trackers", () => {
  const html = fs.readFileSync(path.join(root, "cookies/index.html"), "utf8");
  const needles = [
    "Setări cookie",
    "Acceptă toate",
    "Respinge toate",
    "Personalizează",
    "Necesare",
    "Analiză",
    "Marketing",
    "Google Analytics",
    "Microsoft Clarity",
    "Ahrefs",
    "Metricool",
    "counter.dev",
    "mny.ro",
    "Meta Pixel",
    "Brevo",
    "Consent Mode",
  ];
  for (const needle of needles) {
    assert.ok(html.includes(needle), `policy missing “${needle}”`);
  }
  assert.equal(html.includes("Nu desfășurăm activități de tip publicitate personalizată"), false);
  assert.ok(
    html.includes(
      "trackerul Brevo (vizitele tale și identificarea când te abonezi prin formularul de newsletter); widget-ul ANPC, pe paginile unde este afișat."
    ),
    "Marketing Brevo copy must describe newsletter form only"
  );
  assert.equal(html.includes("trimiți un formular cu email"), false);
});

test("consent analytics hint documents conversion events without form content", () => {
  assert.ok(
    source.includes(
      "Google Analytics 4, Microsoft Clarity, Ahrefs Analytics, Metricool și counter.dev — statistici de utilizare, inclusiv evenimente de conversie (de exemplu, trimiterea unui formular), fără conținutul formularelor.",
    ),
  );
});

test("consent marketing hint matches Legal C4 copy", () => {
  assert.ok(
    source.includes(
      "Meta Pixel, pe toate paginile publice, pentru măsurarea conversiilor și a campaniilor; Brevo (identificarea ta când te abonezi la newsletter); widget-ul ANPC (mny.ro), pe paginile unde apare.",
    ),
  );
  assert.equal(source.includes("emailul tău"), false);
});

test("privacy policy limits Brevo visit linking to newsletter subscription", () => {
  const html = fs.readFileSync(path.join(root, "privacy/index.html"), "utf8");
  assert.ok(html.includes("dacă te abonezi prin formularul de newsletter, adresa de e-mail"));
  assert.ok(
    html.includes(
      "<strong>De ce:</strong> ca să îți trimitem newsletterul la care te-ai abonat și ca să înțelegem ce conținut te interesează, legând vizitele tale pe website de adresa ta de e-mail după ce te abonezi prin formularul de newsletter."
    )
  );
  assert.ok(
    html.includes(
      "Nu folosim aceste date pentru newsletter sau pentru alte comunicări de marketing decât dacă te abonezi. Dacă bifezi abonarea la newsletter în formularul de contact, adresa ta de e-mail intră și în lista de newsletter din Brevo; bifarea nu leagă vizitele tale pe website de adresa ta."
    )
  );
  assert.equal(html.includes("dacă trimiți un formular, adresa de email"), false);
  assert.equal(html.includes("după ce te identifici printr-un formular"), false);
  assert.equal(html.includes("decât dacă te abonezi separat. Dacă bifezi"), false);
});
