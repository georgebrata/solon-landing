"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  assertZeroRealProductionGaCollectHits,
  resetRealNetworkProductionCollectHits,
  recordGaCollectPassthroughForTests,
  GTAG_STUB_FIXTURE_PATH,
} = require("./lib/puppeteer-ga-intercept");
const fs = require("node:fs");

test("gtag stub fixture exists and contains no production measurement id", () => {
  assert.ok(fs.existsSync(GTAG_STUB_FIXTURE_PATH));
  const body = fs.readFileSync(GTAG_STUB_FIXTURE_PATH, "utf8");
  assert.equal(body.includes("G-H41D7KCWHX"), false);
  assert.match(body, /G-TEST000000/);
  assert.match(body, /not Google gtag\.js/i);
});

test("assertZeroRealProductionGaCollectHits fails when collect passthrough is recorded", () => {
  resetRealNetworkProductionCollectHits();
  recordGaCollectPassthroughForTests("https://www.google-analytics.com/g/collect?v=2");
  assert.throws(() => assertZeroRealProductionGaCollectHits(), /passthrough/i);
  resetRealNetworkProductionCollectHits();
  assertZeroRealProductionGaCollectHits();
});
