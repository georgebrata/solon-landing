"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  GTAG_STUB_FIXTURE_PATH,
  installGaCollectInterception,
  resetRealNetworkProductionCollectHits,
} = require("./lib/puppeteer-ga-intercept");

test("gtag stub fixture exists and contains no production measurement id", () => {
  assert.ok(fs.existsSync(GTAG_STUB_FIXTURE_PATH));
  const body = fs.readFileSync(GTAG_STUB_FIXTURE_PATH, "utf8");
  assert.equal(body.includes("G-H41D7KCWHX"), false);
  assert.match(body, /G-TEST000000/);
  assert.match(body, /not Google gtag\.js/i);
});

test("installGaCollectInterception reports loader failure when stub fixture is missing", async (t) => {
  // skipcq: JS-0119 -- optional dependency; assigned in try before use
  let puppeteer;
  try {
    puppeteer = require("puppeteer");
  } catch {
    t.skip("puppeteer is not installed");
    return;
  }
  const missingFixture = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "solon-gtag-stub-missing-")),
    "missing-gtag-stub.js",
  );
  resetRealNetworkProductionCollectHits();
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await assert.rejects(
      () => installGaCollectInterception(page, { gtagFixturePath: missingFixture }),
      (error) => error && error.code === "GTAG_LOADER_FIXTURE_MISSING",
    );
  } finally {
    await browser.close();
  }
});
