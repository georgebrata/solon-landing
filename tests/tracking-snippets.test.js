"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const {
  shouldSkipPublicTrackerSync,
  ensureHeadSnippets,
  ensureTrackingScript,
  listHtmlFiles,
  trackerHeadBlock,
  assetContentHash,
  normalizeTrackerHeadPaths,
  normalizeTrackingScriptLine,
} = require("../scripts/sync-public-tracker-snippets");
const { GA_MEASUREMENT_ID } = require("../scripts/lib/ga-measurement");

const SKIP_SCAN_DIRS = new Set([".git", "node_modules", "assets", "scripts", "tests", "docs", "r", "templates"]);

/**
 * @returns {string[]}
 */
const publicHtmlFiles = () => {
  const files = [];
  /**
   * @param {string} dir
   */
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (!SKIP_SCAN_DIRS.has(name)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (name.endsWith(".html")) {
          files.push(full);
        }
      }
    }
  };
  walk(root);
  return files;
};

/**
 * @param {string} html
 * @param {RegExp} pattern
 * @returns {number}
 */
const countMatches = (html, pattern) => {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  return [...html.matchAll(re)].length;
};

test("shouldSkipPublicTrackerSync skips r/, templates/, error pages, unsubscribe, feedback, and client-nou", () => {
  assert.equal(shouldSkipPublicTrackerSync("r/bronze/lunar/index.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("r/api/index.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("templates/layout.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("unsubscribe/index.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("unsubscribe/success/index.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("feedback/index.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("feedback"), true);
  assert.equal(shouldSkipPublicTrackerSync("client-nou/index.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("tests/fixtures/gtag-withdrawal/index.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("404.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("blog/index.html"), false);
  assert.equal(shouldSkipPublicTrackerSync("index.html"), false);
});

/**
 * @returns {string[]}
 */
const shortLinkHtmlFiles = () => {
  const rDir = path.join(root, "r");
  const files = [];
  /**
   * @param {string} dir
   */
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".html")) {
        files.push(full);
      }
    }
  }
  walk(rDir);
  return files;
};

test("sync helpers do not inject snippets into skipped r/ redirect stubs", () => {
  const rFiles = shortLinkHtmlFiles();
  assert.ok(rFiles.length > 0, "expected short-link HTML stubs under r/");
  for (const file of rFiles) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    assert.equal(shouldSkipPublicTrackerSync(rel), true);
    const html = fs.readFileSync(file, "utf8");
    const next = ensureTrackingScript(ensureHeadSnippets(html));
    assert.equal(next, html, `${rel} must not be modified by sync helpers`);
    assert.equal(countMatches(html, /meta-pixel(?:\.min)?\.js/i), 0);
    assert.equal(countMatches(html, /gtag-config(?:\.min)?\.js/i), 0);
    assert.equal(countMatches(html, /tracking(?:\.min)?\.js/i), 0);
  }
});

test("trackerHeadBlock stamps first-party tracker scripts with content hashes", () => {
  const block = trackerHeadBlock();
  const gtagHash = assetContentHash("assets/js/gtag-config.min.js");
  const pixelHash = assetContentHash("assets/js/meta-pixel.min.js");
  const metricoolHash = assetContentHash("assets/js/metricool-init.min.js");
  assert.match(block, new RegExp(`/assets/js/gtag-config\\.min\\.js\\?v=${gtagHash}`));
  assert.match(block, new RegExp(`/assets/js/meta-pixel\\.min\\.js\\?v=${pixelHash}`));
  assert.match(block, new RegExp(`/assets/js/metricool-init\\.min\\.js\\?v=${metricoolHash}`));
});

test("normalizeTrackerHeadPaths uses root-absolute /assets/js tracker sources", () => {
  const html =
    '<script src="../assets/js/meta-pixel.min.js?v=1"></script>' +
    '<script src="assets/js/gtag-config.min.js?v=2"></script>';
  const next = normalizeTrackerHeadPaths(html);
  assert.match(next, /src="\/assets\/js\/meta-pixel\.min\.js\?v=1"/);
  assert.match(next, /src="\/assets\/js\/gtag-config\.min\.js\?v=2"/);
});

test("normalizeTrackingScriptLine puts tracking.min.js on its own line", () => {
  const html =
    '<script src="x.js"></script>  <script src="/assets/js/tracking.min.js" defer></script>';
  const next = normalizeTrackingScriptLine(html);
  assert.match(next, /<\/script>\n {2}<script src="\/assets\/js\/tracking\.min\.js"/);
});

test("public HTML includes each tracker script at most once", () => {
  const offenders = [];
  for (const file of publicHtmlFiles()) {
    const rel = path.relative(root, file);
    const html = fs.readFileSync(file, "utf8");
    const tracking = countMatches(html, /tracking(?:\.min)?\.js/i);
    const pixel = countMatches(html, /meta-pixel(?:\.min)?\.js/i);
    const gtag = countMatches(html, /gtag-config(?:\.min)?\.js/i);
    if (tracking > 1 || pixel > 1 || gtag > 1) {
      offenders.push(`${rel} tracking=${tracking} meta-pixel=${pixel} gtag-config=${gtag}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("sync-public-tracker-snippets does not walk tests/ HTML fixtures", () => {
  const fixture = path.join(root, "tests/fixtures/gtag-withdrawal/index.html");
  const before = fs.readFileSync(fixture, "utf8");
  const htmlUnderTests = listHtmlFiles().filter((file) =>
    file.replace(/\\/gu, "/").includes("/tests/"),
  );
  assert.deepEqual(htmlUnderTests, []);
  const rel = "tests/fixtures/gtag-withdrawal/index.html";
  assert.equal(shouldSkipPublicTrackerSync(rel), true);
  const { execFileSync } = require("node:child_process");
  execFileSync(process.execPath, [path.join(root, "scripts/sync-public-tracker-snippets.js")], {
    cwd: root,
    stdio: "pipe",
  });
  const after = fs.readFileSync(fixture, "utf8");
  assert.equal(after, before);
});

test("client-nou redirect page has no tracker snippets", () => {
  const html = fs.readFileSync(path.join(root, "client-nou/index.html"), "utf8");
  assert.equal(/tracking(?:\.min)?\.js/i.test(html), false);
  assert.equal(/meta-pixel(?:\.min)?\.js/i.test(html), false);
  assert.equal(/gtag-config(?:\.min)?\.js/i.test(html), false);
});

/**
 * @param {string} html
 * @returns {string}
 */
const stripHtmlComments = (html) => html.replace(/<!--[\s\S]*?-->/gu, "");

/**
 * @param {string} html
 * @returns {string[]}
 */
const scriptTagAttrBlobs = (html) =>
  [...stripHtmlComments(html).matchAll(/<script\b([^>]*)>/giu)].map((match) => match[1]);

/**
 * @param {string} attrBlob
 * @returns {boolean}
 */
const isConsentGatedAnalyticsScript = (attrBlob) =>
  /\btype\s*=\s*["']text\/plain["']/iu.test(attrBlob) &&
  /\bdata-consent-category\s*=\s*["']analytics["']/iu.test(attrBlob);

/**
 * @param {string} html
 * @returns {string[]}
 */
const gtagLoaderSrcPattern = () =>
  new RegExp(
    `\\bsrc\\s*=\\s*["']https:\\/\\/www\\.googletagmanager\\.com\\/gtag\\/js\\?id=${GA_MEASUREMENT_ID}["']`,
    "iu",
  );

/**
 * @param {string} html
 * @returns {string[]}
 */
const gtagLoaderAttrBlobs = (html) =>
  scriptTagAttrBlobs(html).filter((attrs) => gtagLoaderSrcPattern().test(attrs));

/**
 * @param {string} html
 * @returns {string[]}
 */
const gtagConfigAttrBlobs = (html) =>
  scriptTagAttrBlobs(html).filter((attrs) => /\bgtag-config\.min\.js\b/iu.test(attrs));

/**
 * @param {string} html
 * @returns {boolean}
 */
const hasConsentGatedGtagBlock = (html) => {
  const loaders = gtagLoaderAttrBlobs(html);
  const configs = gtagConfigAttrBlobs(html);
  return (
    loaders.length === 1 &&
    configs.length === 1 &&
    isConsentGatedAnalyticsScript(loaders[0]) &&
    isConsentGatedAnalyticsScript(configs[0])
  );
};

/**
 * @param {string} html
 * @returns {boolean}
 */
const hasUngatedGtagLoader = (html) => {
  for (const attrs of gtagLoaderAttrBlobs(html)) {
    if (!isConsentGatedAnalyticsScript(attrs)) {
      return true;
    }
  }
  return scriptTagAttrBlobs(html).some(
    (attrs) =>
      /\bgoogletagmanager\.com\/gtag\/js\b/iu.test(attrs) &&
      !new RegExp(`\\?id=${GA_MEASUREMENT_ID}\\b`, "iu").test(attrs),
  );
};

/**
 * @returns {string[]}
 */
const blogHtmlFiles = () => {
  const blogDir = path.join(root, "blog");
  /** @type {string[]} */
  const files = [];
  /**
   * @param {string} dir
   */
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".html")) {
        files.push(full);
      }
    }
  };
  walk(blogDir);
  return files;
};

test("every blog HTML page includes exactly one consent-gated GA4 gtag block", () => {
  const files = blogHtmlFiles();
  assert.ok(files.length > 0, "expected blog HTML pages");
  const missing = [];
  const duplicateLoader = [];
  for (const file of files) {
    const html = fs.readFileSync(file, "utf8");
    if (!hasConsentGatedGtagBlock(html)) {
      missing.push(path.relative(root, file));
    }
    const loaders = countMatches(
      stripHtmlComments(html),
      new RegExp(`googletagmanager\\.com\\/gtag\\/js\\?id=${GA_MEASUREMENT_ID}`, "giu"),
    );
    if (loaders !== 1) {
      duplicateLoader.push(`${path.relative(root, file)} (${loaders})`);
    }
    assert.equal(
      html.includes(GA_MEASUREMENT_ID),
      true,
      `${path.relative(root, file)} must reference ${GA_MEASUREMENT_ID}`,
    );
  }
  assert.deepEqual(missing, []);
  assert.deepEqual(duplicateLoader, []);
});

test("blog HTML pages have no ungated googletagmanager gtag loader scripts", () => {
  const offenders = [];
  for (const file of blogHtmlFiles()) {
    const html = fs.readFileSync(file, "utf8");
    if (hasUngatedGtagLoader(html)) {
      offenders.push(path.relative(root, file));
    }
  }
  assert.deepEqual(offenders, []);
});

/**
 * @returns {string[]}
 */
const shippedHtmlWithGtagTracker = () =>
  publicHtmlFiles().filter((file) => {
    const html = fs.readFileSync(file, "utf8");
    const scanned = stripHtmlComments(html);
    return (
      /\bgtag-config\.min\.js\b/iu.test(scanned) ||
      gtagLoaderAttrBlobs(html).length > 0 ||
      /\bgoogletagmanager\.com\/gtag\/js\b/iu.test(scanned)
    );
  });

test("every shipped HTML page with GA4 gtag includes a consent-gated loader and config pair", () => {
  const files = shippedHtmlWithGtagTracker();
  assert.ok(files.length > 0, "expected shipped HTML with gtag tracker");
  const missing = [];
  for (const file of files) {
    const html = fs.readFileSync(file, "utf8");
    if (!hasConsentGatedGtagBlock(html)) {
      missing.push(path.relative(root, file));
    }
  }
  assert.deepEqual(missing, []);
});

test("shipped HTML with GA4 gtag has no ungated googletagmanager loader scripts", () => {
  const offenders = [];
  for (const file of shippedHtmlWithGtagTracker()) {
    const html = fs.readFileSync(file, "utf8");
    if (hasUngatedGtagLoader(html)) {
      offenders.push(path.relative(root, file));
    }
  }
  assert.deepEqual(offenders, []);
});

test("hasConsentGatedGtagBlock accepts gtag script attribute order variants", () => {
  const configSrc = '/assets/js/gtag-config.min.js?v=deadbeef01';
  const loaderSrc = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  const variants = [
    `<script type="text/plain" data-consent-category="analytics" async src="${loaderSrc}"></script><script type="text/plain" data-consent-category="analytics" src="${configSrc}"></script>`,
    `<script async type="text/plain" data-consent-category="analytics" src="${loaderSrc}"></script><script src="${configSrc}" type="text/plain" data-consent-category="analytics"></script>`,
    `<script data-consent-category="analytics" type="text/plain" src="${loaderSrc}" async></script><script data-consent-category="analytics" type="text/plain" src="${configSrc}"></script>`,
    `<script src="${loaderSrc}" data-consent-category="analytics" type="text/plain" async></script><script src="${configSrc}" data-consent-category="analytics" type="text/plain"></script>`,
  ];
  for (const [index, html] of variants.entries()) {
    assert.equal(hasConsentGatedGtagBlock(html), true, `variant ${index} should pass`);
  }
});

test("gtag static guards ignore decoy gtag markup inside HTML comments", () => {
  const configSrc = '/assets/js/gtag-config.min.js?v=deadbeef01';
  const loaderSrc = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  const gated = `<script type="text/plain" data-consent-category="analytics" async src="${loaderSrc}"></script><script type="text/plain" data-consent-category="analytics" src="${configSrc}"></script>`;
  const html = `<!-- <script src="https://www.googletagmanager.com/gtag/js?id=EVIL"></script> -->${gated}`;
  assert.equal(hasConsentGatedGtagBlock(html), true);
  assert.equal(hasUngatedGtagLoader(html), false);
});

test("trackerHeadBlock ships a consent-gated GA4 gtag loader and config", () => {
  const block = trackerHeadBlock();
  assert.equal(hasConsentGatedGtagBlock(block), true);
  assert.equal(hasUngatedGtagLoader(block), false);
});

test("static guard fails when trackerHeadBlock loader is not consent-gated", () => {
  const block = trackerHeadBlock();
  const ungated = block.replace(
    /type="text\/plain"\s+data-consent-category="analytics"\s+async/giu,
    "async",
  );
  assert.equal(hasUngatedGtagLoader(ungated), true);
  assert.equal(hasConsentGatedGtagBlock(ungated), false);
});
