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
  hasConsentGatedGtag,
  trackerHeadBlock,
  assetContentHash,
  normalizeTrackerHeadPaths,
  normalizeTrackingScriptLine,
} = require("../scripts/sync-public-tracker-snippets");
const { GA_MEASUREMENT_ID, gtagLoaderUrl } = require("../scripts/lib/ga-measurement");

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

test("shouldSkipPublicTrackerSync skips r/, templates/, error pages, unsubscribe, and client-nou", () => {
  assert.equal(shouldSkipPublicTrackerSync("r/bronze/lunar/index.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("r/api/index.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("templates/layout.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("unsubscribe/index.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("unsubscribe/success/index.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("client-nou/index.html"), true);
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

test("client-nou redirect page has no tracker snippets", () => {
  const html = fs.readFileSync(path.join(root, "client-nou/index.html"), "utf8");
  assert.equal(/tracking(?:\.min)?\.js/i.test(html), false);
  assert.equal(/meta-pixel(?:\.min)?\.js/i.test(html), false);
  assert.equal(/gtag-config(?:\.min)?\.js/i.test(html), false);
});

/**
 * @param {string} html
 * @returns {boolean}
 */
const hasUngatedGtagLoader = (html) => {
  const re =
    /<script\b([^>]*)\bsrc=["']https:\/\/www\.googletagmanager\.com\/gtag\/js[^"']*["']([^>]*)>/giu;
  for (const match of html.matchAll(re)) {
    const attrs = `${match[1]}${match[2]}`;
    if (!/type=["']text\/plain["']/iu.test(attrs)) {
      return true;
    }
    if (!/data-consent-category=["']analytics["']/iu.test(attrs)) {
      return true;
    }
  }
  return false;
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

test("ensureHeadSnippets adds consent-gated gtag when meta-pixel exists but gtag is missing", () => {
  const partial = `<script src="/assets/js/consent.min.js?v=1"></script>
  <script type="text/plain" data-consent-category="marketing" src="/assets/js/meta-pixel.min.js?v=1" defer></script>
  <!-- End Meta Pixel Code -->
  <script type="text/plain" data-consent-category="analytics" src="/assets/js/clarity-init.min.js?v=1"></script>`;
  assert.equal(hasConsentGatedGtag(partial), false);
  const next = ensureHeadSnippets(partial);
  assert.equal(hasConsentGatedGtag(next), true);
  assert.match(next, new RegExp(gtagLoaderUrl.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  assert.match(next, /gtag-config\.min\.js\?v=[a-f0-9]{10}/u);
  assert.equal(countMatches(next, /googletagmanager\.com\/gtag\/js/iu), 1);
});

test("every blog HTML page includes exactly one consent-gated GA4 gtag block", () => {
  const files = blogHtmlFiles();
  assert.ok(files.length > 0, "expected blog HTML pages");
  const missing = [];
  const duplicateLoader = [];
  for (const file of files) {
    const html = fs.readFileSync(file, "utf8");
    if (!hasConsentGatedGtag(html)) {
      missing.push(path.relative(root, file));
    }
    const loaders = countMatches(html, /googletagmanager\.com\/gtag\/js\?id=/giu);
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
