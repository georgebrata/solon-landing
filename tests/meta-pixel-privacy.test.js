"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const pixelSource = fs.readFileSync(path.join(root, "assets/js/meta-pixel.js"), "utf8");
const trackingSource = fs.readFileSync(path.join(root, "assets/js/tracking.js"), "utf8");
const { GA4_CUSTOM_EVENTS } = require("../assets/js/tracking.js");

test("meta-pixel disables autoConfig before init without Advanced Matching", () => {
  const autoIdx = pixelSource.indexOf('fbq("set", "autoConfig", false');
  const initIdx = pixelSource.indexOf('fbq("init"');
  assert.ok(autoIdx >= 0, "autoConfig must be set");
  assert.ok(initIdx > autoIdx, "autoConfig must run before init");
  assert.match(pixelSource, /fbq\("init", PIXEL_ID\)/);
  assert.doesNotMatch(pixelSource, /fbq\(\s*["']init["']\s*,\s*[^,]+,\s*\{/);
  assert.doesNotMatch(pixelSource, /em:|ph:|fn:|ln:|external_id/i);
});

test("meta-pixel loads fbevents only from the consent-gated script file", () => {
  assert.match(pixelSource, /connect\.facebook\.net\/en_US\/fbevents\.js/);
  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(
    indexHtml,
    /<script type="text\/plain" data-consent-category="marketing"[^>]*meta-pixel\.min\.js/,
  );
  assert.doesNotMatch(indexHtml, /<script(?![^>]*type=["']text\/plain["'])[^>]*meta-pixel/);
  assert.doesNotMatch(indexHtml, /<script(?![^>]*type=["']text\/plain["'])[^>]*connect\.facebook\.net/);
});

test("tracking.js does not queue events for replay before consent", () => {
  assert.doesNotMatch(trackingSource, /localStorage|sessionStorage/);
  assert.doesNotMatch(trackingSource, /\bqueue\b.*push|pendingEvents|replay/i);
});

test("solonTrack only emits allowlisted GA4 custom events and blocks purchase", () => {
  assert.deepEqual([...GA4_CUSTOM_EVENTS].sort(), [
    "begin_checkout",
    "contact",
    "generate_lead",
    "sign_up",
    "view_item",
  ]);
  const vm = require("node:vm");
  const gtagCalls = [];
  const context = {
    window: {
      SolonConsent: { hasConsent: (c) => c === "analytics" || c === "marketing" },
      gtag: (...args) => {
        gtagCalls.push(args);
      },
      fbq() {},
      document: { readyState: "complete", addEventListener() {}, querySelector() { return null; } },
      location: { pathname: "/" },
    },
  };
  context.globalThis = context.window;
  vm.runInNewContext(trackingSource, context, { filename: "tracking.js" });
  context.window.solonTrack("Purchase", "purchase", { value: 1 });
  context.window.solonTrack("Lead", "not_allowed_event", { content_name: "x" });
  context.window.solonTrack("Lead", "generate_lead", { content_name: "Contact", email: "x@y.z" });
  assert.equal(gtagCalls.length, 1);
  assert.equal(gtagCalls[0][1], "generate_lead");
  assert.equal(gtagCalls[0][2].email, undefined);
});
