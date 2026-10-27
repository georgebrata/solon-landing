"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const { shouldSkipPublicTrackerSync } = require("../scripts/sync-public-tracker-snippets");
const consentSource = fs.readFileSync(path.join(root, "assets/js/consent.js"), "utf8");
const gtagConfigSource = fs.readFileSync(path.join(root, "assets/js/gtag-config.js"), "utf8");

const BLOCKED_TRACKER_HOSTS = [
  "facebook.com",
  "connect.facebook.net",
  "googletagmanager.com",
  "google-analytics.com",
];

const unsubscribeHtmlFiles = () => [
  path.join(root, "unsubscribe/index.html"),
  path.join(root, "unsubscribe/success/index.html"),
];

test("shouldSkipPublicTrackerSync skips unsubscribe pages", () => {
  assert.equal(shouldSkipPublicTrackerSync("unsubscribe/index.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("unsubscribe/success/index.html"), true);
});

test("unsubscribe pages include no analytics or marketing tracker endpoints", () => {
  const scriptSrcPattern = /<script[^>]+src=["']([^"']+)["']/giu;
  for (const file of unsubscribeHtmlFiles()) {
    const html = fs.readFileSync(file, "utf8");
    const rel = path.relative(root, file);
    const scriptUrls = [...html.matchAll(scriptSrcPattern)].map((match) => match[1]);
    for (const src of scriptUrls) {
      for (const host of BLOCKED_TRACKER_HOSTS) {
        assert.equal(
          src.includes(host),
          false,
          `${rel} script src must not reference ${host}: ${src}`,
        );
      }
    }
    assert.equal(/meta-pixel(?:\.min)?\.js/i.test(html), false, rel);
    assert.equal(/gtag-config(?:\.min)?\.js/i.test(html), false, rel);
    assert.equal(/tracking(?:\.min)?\.js/i.test(html), false, rel);
    assert.equal(/data-consent-category="analytics"/i.test(html), false, rel);
    assert.equal(/data-consent-category="marketing"/i.test(html), false, rel);
  }
});

test("consent strips email query via replaceState before boot on unsubscribe", () => {
  const replaceCalls = [];
  const win = {
    console,
    Date,
    JSON,
    Object,
    Array,
    Number,
    String,
    Error,
    URL,
    URLSearchParams,
    history: {
      replaceState(_state, _title, url) {
        replaceCalls.push(url);
      },
    },
    location: {
      href: "https://solon.agency/unsubscribe/?email=test@example.com",
      pathname: "/unsubscribe/",
      search: "?email=test@example.com",
      protocol: "https:",
      hostname: "solon.agency",
    },
    document: null,
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {
        return undefined;
      },
      removeItem() {
        return undefined;
      },
    },
  };
  win.window = win;
  win.globalThis = win;
  vm.runInNewContext(consentSource, win, { filename: "consent.js" });
  assert.equal(win.__solonUnsubscribeEmail, "test@example.com");
  assert.equal(replaceCalls.length, 1);
  assert.equal(replaceCalls[0], "/unsubscribe/");
  assert.equal(win.location.search, "?email=test@example.com");
});

test("unsubscribe index prefills email, clears the global, and does not load jsDelivr", () => {
  const html = fs.readFileSync(path.join(root, "unsubscribe/index.html"), "utf8");
  const prefill = html.match(/<script>\s*\(function \(\) \{[\s\S]*?__solonUnsubscribeEmail[\s\S]*?<\/script>/i);
  assert.ok(prefill, "expected email prefill script block");
  assert.ok(prefill[0].includes('delete window.__solonUnsubscribeEmail'));
  assert.equal(/cdn\.jsdelivr\.net/iu.test(html), false);
});

test("gtag config omits email query from page_location", () => {
  const dataLayer = [];
  const context = {
    window: {
      dataLayer,
      location: {
        href: "https://solon.agency/?email=secret@example.com",
        pathname: "/",
      },
    },
  };
  context.globalThis = context.window;
  vm.runInNewContext(gtagConfigSource, context, { filename: "gtag-config.js" });
  const configCall = dataLayer.find((entry) => entry[0] === "config");
  assert.ok(configCall);
  assert.equal(Object.prototype.toString.call(configCall), "[object Arguments]");
  assert.equal(Array.isArray(configCall), false);
  for (const entry of dataLayer) {
    assert.equal(Object.prototype.toString.call(entry), "[object Arguments]");
  }
  const pageLocation = configCall[2].page_location;
  assert.equal(typeof pageLocation, "string");
  assert.equal(pageLocation.includes("@"), false);
  assert.equal(/email=/iu.test(pageLocation), false);
});
