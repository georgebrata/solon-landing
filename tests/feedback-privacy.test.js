"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const { shouldSkipPublicTrackerSync } = require("../scripts/sync-public-tracker-snippets");

const feedbackHtmlPath = path.join(root, "feedback/index.html");

const BLOCKED_TRACKER_HOSTS = [
  "facebook.com",
  "connect.facebook.net",
  "googletagmanager.com",
  "google-analytics.com",
  "analytics.ahrefs.com",
  "cdn.counter.dev",
  "tracker.metricool.com",
  "mny.ro",
];

test("shouldSkipPublicTrackerSync skips feedback", () => {
  assert.equal(shouldSkipPublicTrackerSync("feedback/index.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("feedback"), true);
});

test("feedback page includes no consent-gated analytics or marketing trackers", () => {
  const html = fs.readFileSync(feedbackHtmlPath, "utf8");
  const scriptSrcPattern = /<script[^>]+src=["']([^"']+)["']/giu;
  const scriptUrls = [...html.matchAll(scriptSrcPattern)].map((match) => match[1]);
  for (const src of scriptUrls) {
    for (const host of BLOCKED_TRACKER_HOSTS) {
      assert.equal(
        src.includes(host),
        false,
        `feedback script src must not reference ${host}: ${src}`,
      );
    }
  }
  assert.equal(/meta-pixel(?:\.min)?\.js/i.test(html), false);
  assert.equal(/gtag-config(?:\.min)?\.js/i.test(html), false);
  assert.equal(/googletagmanager\.com\/gtag\/js/i.test(html), false);
  assert.equal(/tracking(?:\.min)?\.js/i.test(html), false);
  assert.equal(/clarity-init(?:\.min)?\.js/i.test(html), false);
  assert.equal(/brevo-tracker(?:\.min)?\.js/i.test(html), false);
  assert.equal(/metricool-init(?:\.min)?\.js/i.test(html), false);
  assert.equal(/mny\.ro\/npId/i.test(html), false);
  assert.equal(/data-consent-category="analytics"/i.test(html), false);
  assert.equal(/data-consent-category="marketing"/i.test(html), false);
  assert.match(html, /consent\.min\.js/);
  assert.match(html, /feedback-form-prefill\.min\.js/);
});
