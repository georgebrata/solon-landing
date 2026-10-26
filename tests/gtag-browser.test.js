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
 * @param {import("puppeteer").Page} page
 * @param {number} [timeout]
 * @returns {Promise<void>}
 */
const waitForFirstCollect = async (page, timeout = 60000) => {
  await page.waitForRequest((req) => COLLECT_RE.test(req.url()), { timeout });
};

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * @returns {Promise<boolean>}
 */
const canReachGoogleTagManager = async () => {
  if (process.env.SKIP_GTAG_BROWSER === "1") {
    return false;
  }
  const attempts = 3;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        return true;
      }
    } catch {
      // try again with backoff
    }
    if (attempt < attempts - 1) {
      await sleep(1000 * (attempt + 1));
    }
  }
  return false;
};

/**
 * @returns {string | false}
 */
const resolveSuiteSkip = () => {
  if (process.env.SKIP_GTAG_BROWSER === "1") {
    return "SKIP_GTAG_BROWSER=1";
  }
  try {
    require.resolve("puppeteer");
  } catch {
    return "puppeteer is not installed";
  }
  return false;
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

describe("real gtag.js collect after analytics withdrawal", () => {
  /** @type {string | false} */
  let suiteSkip = false;
  /** @type {import("puppeteer").Browser | null} */
  let browser = null;
  /** @type {import("http").Server | null} */
  let server = null;
  /** @type {string} */
  let baseUrl = "";

  before(async () => {
    suiteSkip = await resolveSuiteSkip();
    if (suiteSkip) {
      return;
    }
    if (!(await canReachGoogleTagManager())) {
      throw new Error(
        "googletagmanager.com unreachable: real gtag browser regression tests did not run",
      );
    }
    const puppeteer = require("puppeteer");
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

  it("sends no new /g/collect after withdrawal (single tab)", async (t) => {
    if (suiteSkip) {
      t.skip(suiteSkip);
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
    const firstCollect = waitForFirstCollect(page);
    await page.evaluate(() => {
      window.SolonConsent.acceptAll();
    });
    await firstCollect;
    await new Promise((r) => setTimeout(r, 2500));
    page.off("request", onCollectBefore);
    await page.evaluate(() => {
      window.SolonConsent.saveCustom({ analytics: false, marketing: true });
    });
    await page.waitForFunction(
      () => window[window.SolonConsent.GA_DISABLE_PROPERTY] === true,
      { timeout: 15000 },
    );
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
    const gaCookiesAfter = await page.evaluate(() =>
      document.cookie.split(";").map((part) => part.trim()).filter((part) => part.startsWith("_ga")),
    );
    assert.equal(gaCookiesAfter.length, 0, `expected no _ga cookies after withdrawal, got ${gaCookiesAfter.join(", ")}`);
    await page.close();
  });

  it("sends no new /g/collect on tab A after tab B withdraws (cross-tab)", async (t) => {
    if (suiteSkip) {
      t.skip(suiteSkip);
      return;
    }
    const context = await browser.createBrowserContext();
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await pageA.goto(baseUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await pageA.waitForFunction(() => window.SolonConsent?.acceptAll, { timeout: 15000 });
    const firstCollect = waitForFirstCollect(pageA);
    await pageA.evaluate(() => window.SolonConsent.acceptAll());
    await firstCollect;
    await pageB.goto(baseUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await pageB.waitForFunction(
      () => window.SolonConsent?.hasConsent("analytics") === true,
      { timeout: 15000 },
    );
    await pageB.waitForFunction(() => window.SolonConsent?.saveCustom, { timeout: 15000 });
    await pageB.evaluate(() => {
      window.SolonConsent.saveCustom({ analytics: false, marketing: true });
    });
    await pageA.waitForFunction(
      () => !window.SolonConsent.hasConsent("analytics"),
      { timeout: 15000 },
    );
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
    const gaCookiesOnA = await pageA.evaluate(() =>
      document.cookie.split(";").map((part) => part.trim()).filter((part) => part.startsWith("_ga")),
    );
    assert.equal(gaCookiesOnA.length, 0, `tab A expected no _ga cookies after tab B withdrew, got ${gaCookiesOnA.join(", ")}`);
    await pageA.close();
    await pageB.close();
    await context.close();
  });

  it("blocked real XHR to google-analytics fires onerror and onloadend once", async (t) => {
    if (suiteSkip) {
      t.skip(suiteSkip);
      return;
    }
    const page = await browser.newPage();
    const gaCollectUrls = [];
    page.on("request", (req) => {
      if (/google-analytics\.com/u.test(req.url())) {
        gaCollectUrls.push(req.url());
      }
    });
    await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction(() => window.SolonConsent?.acceptAll, { timeout: 15000 });
    await page.evaluate(() => {
      window.SolonConsent.acceptAll();
    });
    await page.evaluate(() => {
      window.SolonConsent.saveCustom({ analytics: false, marketing: true });
    });
    await page.waitForFunction(
      () => window[window.SolonConsent.GA_DISABLE_PROPERTY] === true,
      { timeout: 15000 },
    );
    const result = await page.evaluate(
      (measurementId) =>
        new Promise((resolve) => {
          const tallies = { error: 0, loadend: 0 };
          const order = [];
          const xhr = new XMLHttpRequest();
          xhr.open("GET", `https://www.google-analytics.com/g/collect?v=2&tid=${measurementId}`);
          xhr.onreadystatechange = () => {
            order.push("readystatechange");
          };
          xhr.onerror = () => {
            tallies.error += 1;
            order.push("error");
          };
          xhr.onloadend = () => {
            tallies.loadend += 1;
            order.push("loadend");
          };
          xhr.send();
          setTimeout(() => resolve({ tallies, order, readyState: xhr.readyState }), 100);
        }),
      GA_MEASUREMENT_ID,
    );
    assert.deepEqual(result.tallies, { error: 1, loadend: 1 });
    assert.deepEqual(result.order, ["readystatechange", "error", "loadend"]);
    assert.equal(gaCollectUrls.length, 0);
    await page.close();
  });
});
