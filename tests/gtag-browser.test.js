"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { describe, it, before, after } = require("node:test");

const root = path.join(__dirname, "..");
const { GA_MEASUREMENT_ID } = require("../scripts/lib/ga-measurement");
const {
  isGaCollectTransportUrl,
  installGaCollectInterception,
  assertZeroRealProductionGaCollectHits,
  resetRealNetworkProductionCollectHits,
  chromeLaunchArgs,
} = require("./lib/puppeteer-ga-intercept");
const {
  startGaCollectSinkServer,
  stopGaCollectSinkServer,
  resetGaCollectSink,
  assertGaCollectSinkEmpty,
} = require("./lib/ga-collect-sink-server");
const { writeGtagPassCache } = require("../scripts/lib/gtag-pass-cache");

const GTAG_PASS_CACHE_PATH = process.env.SOLON_GTAG_PASS_CACHE_PATH
  ? path.resolve(process.env.SOLON_GTAG_PASS_CACHE_PATH)
  : path.join(__dirname, ".cache", "gtag-browser-pass.json");

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
  await page.waitForRequest((req) => isGaCollectTransportUrl(req.url()), { timeout });
};

const BLOCKED_XHR_READYSTATE_DONE = 4;
const BLOCKED_XHR_POLL_TIMEOUT_MS = 5000;

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
/**
 * @param {string} relPath
 * @returns {Buffer}
 */
const readConsentJsForBrowserTests = (relPath) => {
  if (process.env.SOLON_GTAG_DISABLE_CONSENT_GUARD === "1") {
    let body = fs.readFileSync(path.join(root, "assets/js/consent.js"), "utf8");
    body = body.replace(/installAnalyticsTransportGuard\(\);?/g, "");
    return Buffer.from(body, "utf8");
  }
  return fs.readFileSync(path.join(root, relPath));
};

const startStaticServer = () =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      if (urlPath.endsWith("/")) {
        urlPath = `${urlPath}index.html`;
      }
      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//u, "");
      if (
        process.env.SOLON_GTAG_DISABLE_CONSENT_GUARD === "1" &&
        (rel === "assets/js/consent.js" || rel === "assets/js/consent.min.js")
      ) {
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
        res.end(readConsentJsForBrowserTests(rel));
        return;
      }
      const filePath = path.join(root, rel);
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

describe("GA collect transport URL matcher", () => {
  it("matches host and /g/collect path only on GA/GTM collect hosts", () => {
    assert.equal(isGaCollectTransportUrl("https://www.googletagmanager.com/g/collect?v=2"), true);
    assert.equal(isGaCollectTransportUrl("https://evil.com/g/collect?v=2"), false);
    assert.equal(
      isGaCollectTransportUrl("https://www.googletagmanager.com/gtag/js?id=G-TEST000000"),
      false,
    );
    assert.equal(isGaCollectTransportUrl("https://www.google-analytics.com/G/COLLECT?v=2"), true);
    assert.equal(
      isGaCollectTransportUrl("https://www.googletagmanager.com./g/collect?v=2"),
      true,
    );
    assert.equal(
      isGaCollectTransportUrl("https://www.googletagmanager.com/g/collection?v=2"),
      false,
    );
    assert.equal(
      isGaCollectTransportUrl("https://www.googletagmanager.com/ccm/collect?v=2"),
      true,
    );
  });
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
  /** @type {number} */
  let passedBrowserTests = 0;
  /** @type {{ httpsPort: number, httpPort: number, spkiHash: string } | null} */
  let sinkMeta = null;

  before(async () => {
    resetRealNetworkProductionCollectHits();
    suiteSkip = await resolveSuiteSkip();
    if (suiteSkip) {
      return;
    }
    const puppeteer = require("puppeteer");
    sinkMeta = await startGaCollectSinkServer();
    server = await startStaticServer();
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}/tests/fixtures/gtag-withdrawal/`;
    browser = await puppeteer.launch({
      headless: true,
      args: chromeLaunchArgs(sinkMeta),
    });
  });

  /**
   * @returns {Promise<import("puppeteer").Page>}
   */
  const newPageWithGaGuard = async () => {
    const page = await browser.newPage();
    await installGaCollectInterception(page);
    return page;
  };

  after(async () => {
    if (browser) {
      await browser.close();
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (sinkMeta) {
      await stopGaCollectSinkServer();
    }
    if (!suiteSkip) {
      assertZeroRealProductionGaCollectHits();
      const runKey = process.env.SOLON_GTAG_PASS_RUN_KEY;
      const nonce = process.env.SOLON_GTAG_PASS_NONCE;
      const cacheEligible =
        !process.env.SOLON_GTAG_INTERCEPT_MUTATION &&
        process.env.SOLON_GTAG_DISABLE_CONSENT_GUARD !== "1" &&
        process.env.SOLON_GTAG_GUARD_OFF_PROOF !== "1";
      if (
        cacheEligible &&
        runKey &&
        nonce &&
        process.env.SOLON_GTAG_PASS_CACHE_PATH &&
        passedBrowserTests === 6
      ) {
        writeGtagPassCache(GTAG_PASS_CACHE_PATH, 1 + passedBrowserTests, { runKey, nonce });
      }
    }
  });

  /**
   * @param {import("puppeteer").Page} page
   * @returns {Promise<void>}
   */
  const assertNoCollectLeakAfterWithdraw = async (page) => {
    resetGaCollectSink();
    await new Promise((r) => setTimeout(r, 5000));
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await new Promise((r) => setTimeout(r, 3000));
    assertGaCollectSinkEmpty();
  };

  it("sends no new /g/collect after withdrawal (single tab)", async (t) => {
    if (suiteSkip) {
      t.skip(suiteSkip);
      return;
    }
    const page = await newPageWithGaGuard();
    let maxEtBeforeWithdraw = 0;
    const onCollectBefore = (req) => {
      if (isGaCollectTransportUrl(req.url())) {
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
      if (isGaCollectTransportUrl(req.url())) {
        afterWithdraw.push(req.url());
      }
    };
    page.on("request", onCollect);
    await assertNoCollectLeakAfterWithdraw(page);
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
    passedBrowserTests += 1;
  });

  it("sends no new /g/collect on tab A after tab B withdraws (cross-tab)", async (t) => {
    if (suiteSkip) {
      t.skip(suiteSkip);
      return;
    }
    const context = await browser.createBrowserContext();
    const pageA = await context.newPage();
    await installGaCollectInterception(pageA);
    const pageB = await context.newPage();
    await installGaCollectInterception(pageB);
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
      if (isGaCollectTransportUrl(req.url())) {
        afterWithdraw.push(req.url());
      }
    };
    pageA.on("request", onCollect);
    await assertNoCollectLeakAfterWithdraw(pageA);
    pageA.off("request", onCollect);
    assert.equal(afterWithdraw.length, 0, `tab A expected 0 collects after tab B withdrew, got ${afterWithdraw.length}`);
    const gaCookiesOnA = await pageA.evaluate(() =>
      document.cookie.split(";").map((part) => part.trim()).filter((part) => part.startsWith("_ga")),
    );
    assert.equal(gaCookiesOnA.length, 0, `tab A expected no _ga cookies after tab B withdrew, got ${gaCookiesOnA.join(", ")}`);
    await pageA.close();
    await pageB.close();
    await context.close();
    passedBrowserTests += 1;
  });

  it("blocked real XHR to google-analytics fires onerror and onloadend once", async (t) => {
    if (suiteSkip) {
      t.skip(suiteSkip);
      return;
    }
    const page = await newPageWithGaGuard();
    await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction(() => window.SolonConsent?.acceptAll, { timeout: 15000 });
    const firstCollect = waitForFirstCollect(page);
    await page.evaluate(() => {
      window.SolonConsent.acceptAll();
    });
    await firstCollect;
    await page.evaluate(() => {
      window.SolonConsent.saveCustom({ analytics: false, marketing: true });
    });
    await page.waitForFunction(
      () => window[window.SolonConsent.GA_DISABLE_PROPERTY] === true,
      { timeout: 15000 },
    );
    const gaCollectUrls = [];
    page.on("request", (req) => {
      const url = req.url();
      if (isGaCollectTransportUrl(url)) {
        gaCollectUrls.push(url);
      }
    });
    const result = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const tallies = { error: 0, loadend: 0 };
          const order = [];
          const xhr = new XMLHttpRequest();
          xhr.open("GET", "https://www.google-analytics.com/g/collect?v=2&tid=G-TEST000000");
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
    );
    assert.deepEqual(result.tallies, { error: 1, loadend: 1 });
    assert.deepEqual(result.order, ["readystatechange", "error", "loadend"]);
    assert.equal(result.readyState, 4);
    assert.equal(gaCollectUrls.length, 0);
    assertGaCollectSinkEmpty();
    await page.close();
    passedBrowserTests += 1;
  });

  it("blocked XHR reuse resets readyState after analytics withdrawal", async (t) => {
    if (suiteSkip) {
      t.skip(suiteSkip);
      return;
    }
    const page = await newPageWithGaGuard();
    await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction(() => window.SolonConsent?.acceptAll, { timeout: 15000 });
    const firstCollect = waitForFirstCollect(page);
    await page.evaluate(() => {
      window.SolonConsent.acceptAll();
    });
    await firstCollect;
    await page.evaluate(() => {
      window.SolonConsent.saveCustom({ analytics: false, marketing: true });
    });
    await page.waitForFunction(
      () => window[window.SolonConsent.GA_DISABLE_PROPERTY] === true,
      { timeout: 15000 },
    );
    const result = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", "https://www.google-analytics.com/g/collect?v=2");
          xhr.send();
          setTimeout(() => {
            const afterBlock = xhr.readyState;
            xhr.open("GET", "https://example.com/safe-reuse");
            setTimeout(() => {
              resolve({ afterBlock, afterReuse: xhr.readyState });
            }, 50);
          }, 150);
        }),
    );
    assert.equal(result.afterBlock, 4);
    assert.equal(result.afterReuse, 1);
    await assertNoCollectLeakAfterWithdraw(page);
    await page.close();
    passedBrowserTests += 1;
  });

  it("ignores pre-set __solonAnalyticsTransportGuard=true and blocks GA, Clarity, and doubleclick after withdrawal", async (t) => {
    if (suiteSkip) {
      t.skip(suiteSkip);
      return;
    }
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      window.__solonAnalyticsTransportGuard = true;
    });
    await installGaCollectInterception(page);
    await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction(() => window.SolonConsent?.acceptAll, { timeout: 15000 });
    await page.evaluate(() => {
      window.SolonConsent.acceptAll();
    });
    await page.waitForFunction(
      () => typeof window.gtag === "function",
      { timeout: 15000 },
    );
    await page.evaluate(() => {
      window.SolonConsent.saveCustom({ analytics: false, marketing: true });
    });
    await page.waitForFunction(
      () => window[window.SolonConsent.GA_DISABLE_PROPERTY] === true,
      { timeout: 15000 },
    );
    const blocked = await page.evaluate(
      async (doneState, timeoutMs) => {
        const poll = (xhr) =>
          new Promise((resolve, reject) => {
            const deadline = Date.now() + timeoutMs;
            const step = () => {
              if (xhr.readyState === doneState) {
                resolve(xhr.readyState);
                return;
              }
              if (Date.now() >= deadline) {
                reject(new Error(`blocked XHR readyState stayed ${xhr.readyState}`));
                return;
              }
              queueMicrotask(step);
            };
            step();
          });
        const gaXhr = new XMLHttpRequest();
        gaXhr.open("GET", "https://www.google-analytics.com/g/collect?v=2");
        gaXhr.send();
        const clarityXhr = new XMLHttpRequest();
        clarityXhr.open("GET", "https://h.clarity.ms/collect");
        clarityXhr.send();
        const dcXhr = new XMLHttpRequest();
        dcXhr.open("GET", "https://ad.doubleclick.net/activity");
        dcXhr.send();
        return {
          ga: await poll(gaXhr),
          clarity: await poll(clarityXhr),
          doubleclick: await poll(dcXhr),
        };
      },
      BLOCKED_XHR_READYSTATE_DONE,
      BLOCKED_XHR_POLL_TIMEOUT_MS,
    );
    assert.equal(blocked.ga, 4);
    assert.equal(blocked.clarity, 4);
    assert.equal(blocked.doubleclick, 4);
    assertGaCollectSinkEmpty();
    await page.close();
    passedBrowserTests += 1;
  });

  it("blocked GTM /g/collect XHR does not hit the network after withdrawal", async (t) => {
    if (suiteSkip) {
      t.skip(suiteSkip);
      return;
    }
    const page = await newPageWithGaGuard();
    await page.goto(baseUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction(() => window.SolonConsent?.acceptAll, { timeout: 15000 });
    const firstCollect = waitForFirstCollect(page);
    await page.evaluate(() => {
      window.SolonConsent.acceptAll();
    });
    await firstCollect;
    await page.evaluate(() => {
      window.SolonConsent.saveCustom({ analytics: false, marketing: true });
    });
    await page.waitForFunction(
      () => window[window.SolonConsent.GA_DISABLE_PROPERTY] === true,
      { timeout: 15000 },
    );
    const gaCollectUrls = [];
    page.on("request", (req) => {
      const url = req.url();
      if (isGaCollectTransportUrl(url)) {
        gaCollectUrls.push(url);
      }
    });
    const result = await page.evaluate(
      async (doneState, timeoutMs) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "https://www.googletagmanager.com/g/collect?v=2");
        xhr.send();
        const readyState = await new Promise((resolve, reject) => {
          const deadline = Date.now() + timeoutMs;
          const step = () => {
            if (xhr.readyState === doneState) {
              resolve(xhr.readyState);
              return;
            }
            if (Date.now() >= deadline) {
              reject(new Error(`blocked XHR readyState stayed ${xhr.readyState}`));
              return;
            }
            queueMicrotask(step);
          };
          step();
        });
        return { readyState };
      },
      BLOCKED_XHR_READYSTATE_DONE,
      BLOCKED_XHR_POLL_TIMEOUT_MS,
    );
    assert.equal(result.readyState, 4);
    assert.equal(gaCollectUrls.length, 0);
    assertGaCollectSinkEmpty();
    await page.close();
    passedBrowserTests += 1;
  });
});
