"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { GA_MEASUREMENT_ID } = require("../../scripts/lib/ga-measurement");
const {
  isGaCollectTransportUrl,
  isGtagLoaderUrl,
} = require("../../scripts/lib/ga-collect-transport");

const GTAG_STUB_FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "gtag", "gtag-stub.js");

/** @type {string | null} */
let gtagLoaderFailure = null;

/**
 * @param {{ httpsPort: number, httpPort: number, spkiHash: string }} sink
 * @returns {string[]}
 */
const chromeLaunchArgs = (sink) => {
  const rules = [
    `MAP *.google-analytics.com:443 127.0.0.1:${sink.httpsPort}`,
    `MAP google-analytics.com:443 127.0.0.1:${sink.httpsPort}`,
    `MAP *.analytics.google.com:443 127.0.0.1:${sink.httpsPort}`,
    `MAP analytics.google.com:443 127.0.0.1:${sink.httpsPort}`,
    `MAP *.googletagmanager.com:443 127.0.0.1:${sink.httpsPort}`,
    `MAP googletagmanager.com:443 127.0.0.1:${sink.httpsPort}`,
    `MAP *.doubleclick.net:443 127.0.0.1:${sink.httpsPort}`,
    `MAP doubleclick.net:443 127.0.0.1:${sink.httpsPort}`,
    `MAP *.google-analytics.com:80 127.0.0.1:${sink.httpPort}`,
    `MAP google-analytics.com:80 127.0.0.1:${sink.httpPort}`,
    `MAP *.googletagmanager.com:80 127.0.0.1:${sink.httpPort}`,
    `MAP googletagmanager.com:80 127.0.0.1:${sink.httpPort}`,
    `MAP *.doubleclick.net:80 127.0.0.1:${sink.httpPort}`,
    `MAP doubleclick.net:80 127.0.0.1:${sink.httpPort}`,
  ];
  return [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    `--host-resolver-rules=${rules.join(", ")}`,
    `--ignore-certificate-errors-spki-list=${sink.spkiHash}`,
  ];
};

/**
 * @param {import("puppeteer").Page} page
 * @param {{ interceptCollect?: boolean }} [options]
 * @returns {Promise<{ interceptedCollectUrls: string[] }>}
 */
const installGaCollectInterception = async (page, options = {}) => {
  if (process.env.SOLON_GTAG_DISABLE_CONSENT_GUARD === "1") {
    await page.evaluateOnNewDocument(() => {
      window.__SOLON_TEST_DISABLE_ANALYTICS_TRANSPORT_GUARD = true;
    });
  }
  const mutation = process.env.SOLON_GTAG_INTERCEPT_MUTATION || "";
  const guardOffProof = process.env.SOLON_GTAG_GUARD_OFF_PROOF === "1";
  let interceptCollect = options.interceptCollect !== false;
  if (mutation === "no-intercept" || guardOffProof) {
    interceptCollect = false;
  }
  const forceCollectContinue = mutation === "continue" || guardOffProof;
  /** @type {string[]} */
  const interceptedCollectUrls = [];

  if (!fs.existsSync(GTAG_STUB_FIXTURE_PATH)) {
    gtagLoaderFailure = `gtag loader fixture missing at ${GTAG_STUB_FIXTURE_PATH}`;
    const error = new Error(gtagLoaderFailure);
    error.code = "GTAG_LOADER_FIXTURE_MISSING";
    throw error;
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
          gtagLoaderFailure = `gtag loader respond failed for ${url}`;
        });
      return;
    }

    if (isCollect) {
      if (!interceptCollect || forceCollectContinue) {
        req.continue().catch(() => undefined);
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
          req.abort("failed").catch(() => undefined);
        });
      return;
    }

    req.continue().catch(() => undefined);
  });
  return { interceptedCollectUrls };
};

/**
 * @returns {void}
 */
const assertZeroRealProductionGaCollectHits = () => {
  if (gtagLoaderFailure) {
    const error = new Error(`gtag loader failure: ${gtagLoaderFailure}`);
    error.code = "GTAG_LOADER_FAILURE";
    throw error;
  }
};

/**
 * @returns {void}
 */
const resetRealNetworkProductionCollectHits = () => {
  gtagLoaderFailure = null;
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
};
