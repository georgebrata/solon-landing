"use strict";

const { GA_MEASUREMENT_ID } = require("../../scripts/lib/ga-measurement");

const COLLECT_PATH_RE = /\/g\/collect\b/i;

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
    const hostname = parsed.hostname.toLowerCase();
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

/** @type {string[]} */
const leakedCollectUrls = [];

/**
 * @param {import("puppeteer").Page} page
 * @returns {Promise<{ interceptedCollectUrls: string[] }>}
 */
const installGaCollectInterception = async (page) => {
  /** @type {string[]} */
  const interceptedCollectUrls = [];
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
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
};

module.exports = {
  GA_MEASUREMENT_ID,
  COLLECT_PATH_RE,
  isGaCollectTransportUrl,
  installGaCollectInterception,
  assertZeroRealProductionGaCollectHits,
  resetRealNetworkProductionCollectHits,
  getLeakedCollectUrls: () => [...leakedCollectUrls],
};
