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
  normalizeTrackerHeadPaths,
  normalizeTrackingScriptLine,
} = require("../scripts/sync-public-tracker-snippets");

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
