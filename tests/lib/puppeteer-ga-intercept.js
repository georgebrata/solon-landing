"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { GA_MEASUREMENT_ID } = require("../../scripts/lib/ga-measurement");

const COLLECT_PATH_RE = /\/g\/collect\b/i;

const GTAG_JS_FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "gtag", "gtag-js-recorded.js");

/**
 * @param {string} hostname
 * @returns {string}
 */
const normalizeHostname = (hostname) => {
  let normalized = hostname.toLowerCase();
  while (normalized.endsWith(".")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
};

/**
 * @param {string} hostname
 * @param {string} apex
 * @returns {boolean}
 */
const hostnameMatchesApex = (hostname, apex) =>
  hostname === apex || hostname.endsWith(`.${apex}`);

/**
 * @param {string} url
 * @returns {boolean}
 */
const isGaCollectTransportUrl = (url) => {
  try {
    const parsed = new URL(url);
    const hostname = normalizeHostname(parsed.hostname);
    if (!COLLECT_PATH_RE.test(parsed.pathname)) {
      return false;
    }
    return (
      hostnameMatchesApex(hostname, "google-analytics.com") ||
      hostnameMatchesApex(hostname, "analytics.google.com") ||
      hostnameMatchesApex(hostname, "googletagmanager.com")
    );
  } catch {
    return false;
  }
};

/**
 * @param {string} url
 * @returns {boolean}
 */
const isGtagLoaderUrl = (url) => {
  try {
    const parsed = new URL(url);
    const hostname = normalizeHostname(parsed.hostname);
    return hostnameMatchesApex(hostname, "googletagmanager.com") && /\/gtag\/js\b/i.test(parsed.pathname);
  } catch {
    return false;
  }
};

/** @type {string[]} */
const leakedCollectUrls = [];

/** @type {string[]} */
const passthroughCollectUrls = [];

/**
 * @param {import("puppeteer").Page} page
 * @returns {Promise<{ interceptedCollectUrls: string[] }>}
 */
const installGaCollectInterception = async (page) => {
  /** @type {string[]} */
  const interceptedCollectUrls = [];
  let gtagFixtureBody = null;
  if (fs.existsSync(GTAG_JS_FIXTURE_PATH)) {
    gtagFixtureBody = fs.readFileSync(GTAG_JS_FIXTURE_PATH);
  }

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (isGtagLoaderUrl(url) && gtagFixtureBody) {
      req
        .respond({
          status: 200,
          contentType: "application/javascript; charset=utf-8",
          body: gtagFixtureBody,
        })
        .catch(() => {
          leakedCollectUrls.push(url);
          req.abort("failed").catch(() => undefined);
        });
      return;
    }
    if (!isGaCollectTransportUrl(url)) {
      req.continue();
      return;
    }
    interceptedCollectUrls.push(url);
    req
      .respond({
        status: 204,
        contentType: "text/plain",
        body: "",
      })
      .catch(() => {
        leakedCollectUrls.push(url);
        req.abort("failed").catch(() => undefined);
      });
  });
  return { interceptedCollectUrls };
};

/**
 * @returns {void}
 */
const assertZeroRealProductionGaCollectHits = () => {
  if (passthroughCollectUrls.length > 0) {
    throw new Error(
      `GA collect must not passthrough to the network: ${passthroughCollectUrls.join(", ")}`,
    );
  }
  if (leakedCollectUrls.length > 0) {
    throw new Error(
      `production GA collect must not reach the network (${GA_MEASUREMENT_ID}): ${leakedCollectUrls.join(", ")}`,
    );
  }
};

/**
 * @returns {void}
 */
const resetRealNetworkProductionCollectHits = () => {
  leakedCollectUrls.length = 0;
  passthroughCollectUrls.length = 0;
};

module.exports = {
  GA_MEASUREMENT_ID,
  COLLECT_PATH_RE,
  GTAG_JS_FIXTURE_PATH,
  isGaCollectTransportUrl,
  isGtagLoaderUrl,
  installGaCollectInterception,
  assertZeroRealProductionGaCollectHits,
  resetRealNetworkProductionCollectHits,
  getLeakedCollectUrls: () => [...leakedCollectUrls],
  getPassthroughCollectUrls: () => [...passthroughCollectUrls],
};
