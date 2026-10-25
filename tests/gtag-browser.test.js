"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { describe, it, before, after } = require("node:test");

const root = path.join(__dirname, "..");
const { GA_MEASUREMENT_ID } = require("../scripts/lib/ga-measurement");

const COLLECT_RE = /\/g\/collect\b/u;

/**
 * @param {string} url
 * @returns {number}
 */
const engagementEtFromCollectUrl = (url) => {
  const match = url.match(/[?&]_et=(\d+)/u);
  return match ? Number(match[1]) : 0;
};

/**
 * @returns {Promise<boolean>}
 */
const canReachGoogleTagManager = async () => {
  if (process.env.SKIP_GTAG_BROWSER === "1") {
    return false;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * @returns {Promise<import("http").Server>}
 */
const startStaticServer = () =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      if (urlPath.endsWith("/")) {
        urlPath = `${urlPath}index.html`;
      }
      const filePath = path.join(root, urlPath === "/" ? "index.html" : urlPath.replace(/^\//u, ""));
      if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const ext = path.extname(filePath);
      const type =
        ext === ".html"
          ? "text/html; charset=utf-8"
          : ext === ".js"
            ? "text/javascript; charset=utf-8"
            : "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(fs.readFileSync(filePath));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });

describe("real gtag.js collect after analytics withdrawal", { skip: false }, () => {
  /** @type {boolean} */
  let gtmOnline = false;
  /** @type {import("puppeteer").Browser | null} */
  let browser = null;
  /** @type {import("http").Server | null} */
  let server = null;
  /** @type {string} */
  let baseUrl = "";

  before(async () => {
    gtmOnline = await canReachGoogleTagManager();
    if (!gtmOnline) {
      return;
    }
    let puppeteer = null;
    try {
      puppeteer = require("puppeteer");
    } catch {
      gtmOnline = false;
      return;
    }
    server = await startStaticServer();
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}/tests/fixtures/gtag-withdrawal/`;
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  });

  after(async () => {
    if (browser) {
      await browser.close();
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("skips gracefully when googletagmanager.com is unreachable", (t) => {
    if (gtmOnline) {
      t.skip("GTM is reachable; browser assertions run in the next tests.");
      return;
    }
    assert.equal(process.env.SKIP_GTAG_BROWSER === "1" || !gtmOnline, true);
  });

  it("sends no new /g/collect after withdrawal (single tab)", async (t) => {
    if (!gtmOnline || !browser) {
      t.skip("Offline or puppeteer unavailable — set SKIP_GTAG_BROWSER=1 to skip explicitly.");
      return;
    }
    const page = await browser.newPage();
    let maxEtBeforeWithdraw = 0;
    const onCollectBefore = (req) => {
      if (COLLECT_RE.test(req.url())) {
        maxEtBeforeWithdraw = Math.max(maxEtBeforeWithdraw, engagementEtFromCollectUrl(req.url()));
      }
    };
    page.on("request", onCollectBefore);
    await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction(() => window.SolonConsent?.acceptAll, { timeout: 15000 });
    await page.evaluate(() => {
      window.SolonConsent.acceptAll();
    });
    await page.waitForFunction(
      () => window.dataLayer?.some((e) => e[0] === "config"),
      { timeout: 30000 },
    );
    await new Promise((r) => setTimeout(r, 2500));
    page.off("request", onCollectBefore);
    await page.evaluate(() => {
      window.SolonConsent.saveCustom({ analytics: false, marketing: true });
    });
    const afterWithdraw = [];
    const onCollect = (req) => {
      if (COLLECT_RE.test(req.url())) {
        afterWithdraw.push(req.url());
      }
    };
    page.on("request", onCollect);
    await new Promise((r) => setTimeout(r, 5000));
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await new Promise((r) => setTimeout(r, 3000));
    page.off("request", onCollect);
    assert.equal(afterWithdraw.length, 0, `expected 0 collect hits after withdrawal, got ${afterWithdraw.length}`);
    for (const url of afterWithdraw) {
      const et = engagementEtFromCollectUrl(url);
      assert.ok(
        et <= maxEtBeforeWithdraw,
        `post-withdraw _et=${et} exceeds pre-withdraw max ${maxEtBeforeWithdraw}`,
      );
    }
    await page.close();
  });

  it("sends no new /g/collect on tab A after tab B withdraws (cross-tab)", async (t) => {
    if (!gtmOnline || !browser) {
      t.skip("Offline or puppeteer unavailable — set SKIP_GTAG_BROWSER=1 to skip explicitly.");
      return;
    }
    const pageA = await browser.newPage();
    const pageB = await browser.newPage();
    await pageA.goto(baseUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await pageA.waitForFunction(() => window.SolonConsent?.acceptAll, { timeout: 15000 });
    await pageA.evaluate(() => window.SolonConsent.acceptAll());
    await pageA.waitForFunction(
      () => window.dataLayer?.some((e) => e[0] === "config"),
      { timeout: 30000 },
    );
    await new Promise((r) => setTimeout(r, 2000));
    await pageB.goto(baseUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await pageB.waitForFunction(() => window.SolonConsent?.saveCustom, { timeout: 15000 });
    await pageB.evaluate(() => {
      window.SolonConsent.saveCustom({ analytics: false, marketing: true });
    });
    await pageA.evaluate(() => {
      const key = window.SolonConsent.STORAGE_KEY;
      window.SolonConsent.onConsentStorageEvent({
        key,
        newValue: window.localStorage.getItem(key),
        storageArea: window.localStorage,
      });
    });
    await pageA.waitForFunction(
      () => window[window.SolonConsent.GA_DISABLE_PROPERTY] === true,
      { timeout: 15000 },
    );
    const afterWithdraw = [];
    const onCollect = (req) => {
      if (COLLECT_RE.test(req.url())) {
        afterWithdraw.push(req.url());
      }
    };
    pageA.on("request", onCollect);
    await new Promise((r) => setTimeout(r, 5000));
    await pageA.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await new Promise((r) => setTimeout(r, 3000));
    pageA.off("request", onCollect);
    assert.equal(afterWithdraw.length, 0, `tab A expected 0 collects after tab B withdrew, got ${afterWithdraw.length}`);
    await pageA.close();
    await pageB.close();
  });
});
