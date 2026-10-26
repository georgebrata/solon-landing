"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
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
  /** @type {typeof import("puppeteer") | undefined} */
  let puppeteer;
  try {
    puppeteer = require("puppeteer");
  } catch {
    t.skip("puppeteer is not installed");
    return;
  }
  const backupPath = `${GTAG_STUB_FIXTURE_PATH}.guard-backup`;
  resetRealNetworkProductionCollectHits();
  fs.renameSync(GTAG_STUB_FIXTURE_PATH, backupPath);
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await assert.rejects(
      () => installGaCollectInterception(page),
      (error) => error && error.code === "GTAG_LOADER_FIXTURE_MISSING",
    );
  } finally {
    await browser.close();
    fs.renameSync(backupPath, GTAG_STUB_FIXTURE_PATH);
  }
});
