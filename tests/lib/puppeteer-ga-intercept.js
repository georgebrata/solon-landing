"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { GA_MEASUREMENT_ID } = require("../../scripts/lib/ga-measurement");
const {
  isGaCollectTransportUrl,
  isGtagLoaderUrl,
} = require("../../scripts/lib/ga-collect-transport");

const GTAG_STUB_FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "gtag", "gtag-stub.js");

const CHROME_HOST_RESOLVER_RULES = [
  "MAP www.google-analytics.com 127.0.0.1",
  "MAP region1.google-analytics.com 127.0.0.1",
  "MAP www.googletagmanager.com 127.0.0.1",
  "MAP region1.googletagmanager.com 127.0.0.1",
  "MAP www.google.com 127.0.0.1",
  "MAP region1.analytics.google.com 127.0.0.1",
  "MAP analytics.google.com 127.0.0.1",
].join(", ");

/** @type {string[]} */
const leakedCollectUrls = [];

/** @type {string[]} */
const passthroughCollectUrls = [];

/** @type {string | null} */
let gtagLoaderFailure = null;

/**
 * @returns {string[]}
 */
const chromeLaunchArgs = () => [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  `--host-resolver-rules=${CHROME_HOST_RESOLVER_RULES}`,
];

/**
 * @param {import("puppeteer").Page} page
 * @param {{ interceptCollect?: boolean }} [options]
 * @returns {Promise<{ interceptedCollectUrls: string[] }>}
 */
const installGaCollectInterception = async (page, options = {}) => {
  const interceptCollect = options.interceptCollect !== false;
  /** @type {string[]} */
  const interceptedCollectUrls = [];

  if (!fs.existsSync(GTAG_STUB_FIXTURE_PATH)) {
    gtagLoaderFailure = `gtag test stub missing at ${GTAG_STUB_FIXTURE_PATH}`;
    throw new Error(gtagLoaderFailure);
  }
  const gtagFixtureBody = fs.readFileSync(GTAG_STUB_FIXTURE_PATH, "utf8");

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    const isCollect = isGaCollectTransportUrl(url);

    if (isGtagLoaderUrl(url)) {
      req
        .respond({
          status: 200,
          contentType: "application/javascript; charset=utf-8",
          body: gtagFixtureBody,
        })
        .catch(() => {
          leakedCollectUrls.push(url);
          req.abort("failed").catch(() => {
            leakedCollectUrls.push(url);
          });
        });
      return;
    }

    if (isCollect) {
      if (!interceptCollect) {
        passthroughCollectUrls.push(url);
        req.continue().catch(() => {
          passthroughCollectUrls.push(url);
        });
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
          req.abort("failed").catch(() => {
            leakedCollectUrls.push(url);
          });
        });
      return;
    }

    req.continue().catch(() => {
      if (isGaCollectTransportUrl(url)) {
        passthroughCollectUrls.push(url);
      }
    });
  });
  return { interceptedCollectUrls };
};

/**
 * @returns {void}
 */
const assertZeroRealProductionGaCollectHits = () => {
  if (gtagLoaderFailure) {
    throw new Error(`gtag loader fixture failure: ${gtagLoaderFailure}`);
  }
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
  gtagLoaderFailure = null;
};

/**
 * @param {string} url
 * @returns {void}
 */
const recordGaCollectPassthroughForTests = (url) => {
  passthroughCollectUrls.push(url);
};

module.exports = {
  GA_MEASUREMENT_ID,
  GTAG_STUB_FIXTURE_PATH,
  chromeLaunchArgs,
  isGaCollectTransportUrl,
  isGtagLoaderUrl,
  installGaCollectInterception,
  assertZeroRealProductionGaCollectHits,
  resetRealNetworkProductionCollectHits,
  recordGaCollectPassthroughForTests,
  getLeakedCollectUrls: () => [...leakedCollectUrls],
  getPassthroughCollectUrls: () => [...passthroughCollectUrls],
};
