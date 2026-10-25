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
} = require("../scripts/sync-public-tracker-snippets");

const SKIP_SCAN_DIRS = new Set([".git", "node_modules", "assets", "scripts", "tests", "docs", "r", "templates"]);

/**
 * @returns {string[]}
 */
function publicHtmlFiles() {
  const files = [];
  /**
   * @param {string} dir
   */
  function walk(dir) {
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
  }
  walk(root);
  return files;
}

/**
 * @param {string} html
 * @param {RegExp} pattern
 * @returns {number}
 */
function countMatches(html, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  return [...html.matchAll(re)].length;
}

test("shouldSkipPublicTrackerSync skips r/, templates/, and error pages", () => {
  assert.equal(shouldSkipPublicTrackerSync("r/bronze/lunar/index.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("r/api/index.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("templates/layout.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("404.html"), true);
  assert.equal(shouldSkipPublicTrackerSync("blog/index.html"), false);
  assert.equal(shouldSkipPublicTrackerSync("index.html"), false);
});

/**
 * @returns {string[]}
 */
function shortLinkHtmlFiles() {
  const rDir = path.join(root, "r");
  const files = [];
  /**
   * @param {string} dir
   */
  function walk(dir) {
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
}

test("sync helpers do not inject snippets into skipped r/ redirect stubs", () => {
  const rFiles = shortLinkHtmlFiles();
  assert.ok(rFiles.length > 0, "expected short-link HTML stubs under r/");
  for (const file of rFiles) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    assert.equal(shouldSkipPublicTrackerSync(rel), true);
    const html = fs.readFileSync(file, "utf8");
    const prefix = "../../";
    const next = ensureTrackingScript(ensureHeadSnippets(html, prefix));
    assert.equal(next, html, `${rel} must not be modified by sync helpers`);
    assert.equal(countMatches(html, /meta-pixel(?:\.min)?\.js/i), 0);
    assert.equal(countMatches(html, /gtag-config(?:\.min)?\.js/i), 0);
    assert.equal(countMatches(html, /tracking(?:\.min)?\.js/i), 0);
  }
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
