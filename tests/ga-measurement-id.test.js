"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const { GA_MEASUREMENT_ID, gtagLoaderUrl } = require("../scripts/lib/ga-measurement");
const { trackerHeadBlock } = require("../scripts/sync-public-tracker-snippets");
const { shouldSkipPublicTrackerSync } = require("../scripts/sync-public-tracker-snippets");

const consentSource = fs.readFileSync(path.join(root, "assets/js/consent.js"), "utf8");
const gtagConfigSource = fs.readFileSync(path.join(root, "assets/js/gtag-config.js"), "utf8");

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

test("data/ga-measurement.json is the canonical GA4 measurement id", () => {
  assert.equal(GA_MEASUREMENT_ID, "G-H41D7KCWHX");
  assert.match(gtagLoaderUrl, new RegExp(`id=${GA_MEASUREMENT_ID}`));
});

test("consent.js, gtag-config.js, and sync tracker block reference the canonical id", () => {
  assert.ok(consentSource.includes(`GA_MEASUREMENT_ID = "${GA_MEASUREMENT_ID}"`));
  assert.ok(gtagConfigSource.includes(GA_MEASUREMENT_ID));
  const block = trackerHeadBlock();
  assert.ok(block.includes(gtagLoaderUrl));
  assert.ok(block.includes(`gtag-config.min.js`));
});

test("public HTML pages use the canonical GA measurement id in gtag loader URLs", () => {
  const offenders = [];
  const otherGaId = /googletagmanager\.com\/gtag\/js\?id=(G-[A-Z0-9]+)/giu;
  for (const file of publicHtmlFiles()) {
    const rel = path.relative(root, file).replace(/\\/gu, "/");
    if (shouldSkipPublicTrackerSync(rel)) {
      continue;
    }
    const html = fs.readFileSync(file, "utf8");
    if (!html.includes("googletagmanager.com/gtag/js")) {
      continue;
    }
    for (const match of html.matchAll(otherGaId)) {
      if (match[1] !== GA_MEASUREMENT_ID) {
        offenders.push(`${rel}: ${match[1]}`);
      }
    }
    if (html.includes("googletagmanager.com/gtag/js") && !html.includes(GA_MEASUREMENT_ID)) {
      offenders.push(`${rel}: missing canonical id`);
    }
  }
  assert.deepEqual(offenders, []);
});
