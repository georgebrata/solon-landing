"use strict";

/**
 * Ensures public HTML pages include consent-gated Meta Pixel + GA4 snippets
 * and tracking.min.js. Skips r/, error pages, and templates/.
 */
const nodeCrypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const { GA_MEASUREMENT_ID, gtagLoaderUrl } = require("./lib/ga-measurement");

/**
 * @param {string} relFromRoot Repo-relative path with forward slashes.
 * @returns {string}
 */
const assetContentHash = (relFromRoot) =>
  nodeCrypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(root, relFromRoot)))
    .digest("hex")
    .slice(0, 10);

const SKIP_DIR_NAMES = new Set([".git", "node_modules", "r", "templates"]);

/**
 * @param {string} relPath Repo-relative path using forward slashes.
 * @returns {boolean}
 */
const shouldSkipPublicTrackerSync = (relPath) => {
  const rel = String(relPath).replace(/\\/gu, "/");
  return (
    /^(?:403|404|500)\.html$/u.test(rel) ||
    rel === "r" ||
    rel.startsWith("r/") ||
    rel.startsWith("templates/") ||
    rel.startsWith("node_modules/") ||
    rel === "unsubscribe" ||
    rel.startsWith("unsubscribe/") ||
    rel === "feedback" ||
    rel.startsWith("feedback/") ||
    rel === "client-nou/index.html"
  );
};

/**
 * @param {string} html
 * @returns {string}
 */
const normalizeTrackerHeadPaths = (html) =>
  html.replace(
    /src=["'](?:\.\.\/)*assets\/js\/(meta-pixel|gtag-config|metricool-init)\.min\.js/giu,
    'src="/assets/js/$1.min.js',
  );

/**
 * @param {string} html
 * @returns {string}
 */
const normalizeTrackingScriptLine = (html) =>
  html.replace(
    /(\S)\s+(<script\b[^>]*tracking\.min\.js[^>]*><\/script>)/giu,
    "$1\n  $2",
  );

/**
 * @returns {string}
 */
const trackerHeadBlock = () => {
  const metricoolHash = assetContentHash("assets/js/metricool-init.min.js");
  const metaPixelHash = assetContentHash("assets/js/meta-pixel.min.js");
  const gtagConfigHash = assetContentHash("assets/js/gtag-config.min.js");
  return `
<!-- counter.dev -->
  <script type="text/plain" data-consent-category="analytics" src="https://cdn.counter.dev/script.js" data-id="03bd5925-48e2-4d33-ae59-d66aaf6acba0"
    data-utcoffset="2" defer></script>

  <!--metricool-->
  <script type="text/plain" data-consent-category="analytics" src="/assets/js/metricool-init.min.js?v=${metricoolHash}" data-metricool-hash="5eff58c72e852f80d27f8f1735299845"></script>

  <!-- Meta Pixel Code -->
  <script type="text/plain" data-consent-category="marketing" src="/assets/js/meta-pixel.min.js?v=${metaPixelHash}" defer></script>
  <!-- End Meta Pixel Code -->

  <!-- Google tag (gtag.js) -->
  <script type="text/plain" data-consent-category="analytics" async src="${gtagLoaderUrl}"></script>
  <script type="text/plain" data-consent-category="analytics" src="/assets/js/gtag-config.min.js?v=${gtagConfigHash}"></script>
`;
};

const TRACKING_BODY_TAG =
  '  <script src="/assets/js/tracking.min.js" defer></script>\n';

/**
 * @param {string} html
 * @returns {string}
 */
const ensureHeadSnippets = (html) => {
  if (html.includes("meta-pixel.min.js")) {
    return html;
  }
  const anchor = /(<script[^>]*consent\.min\.js[^>]*><\/script>)/iu;
  if (!anchor.test(html)) {
    return html;
  }
  return html.replace(anchor, `$1${trackerHeadBlock()}`);
};

/**
 * @param {string} html
 * @returns {string}
 */
const ensureTrackingScript = (html) => {
  if (!html.includes("consent.min.js")) {
    return html;
  }
  if (html.includes("tracking.min.js")) {
    return html;
  }
  if (html.includes("forms.min.js")) {
    return html.replace(
      /(\s*<script[^>]*forms\.min\.js[^>]*><\/script>)/iu,
      `\n${TRACKING_BODY_TAG}\n$1`,
    );
  }
  if (/<\/body>/iu.test(html)) {
    return html.replace(/<\/body>/iu, `\n${TRACKING_BODY_TAG}\n</body>`);
  }
  return html;
};

/**
 * @returns {string[]}
 */
const listHtmlFiles = () => {
  const out = [];
  /**
   * @param {string} dir
   */
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIR_NAMES.has(entry.name)) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".html")) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
};

/**
 * Walks public HTML and injects tracker snippets where missing.
 * @returns {void}
 */
const main = () => {
  let changed = 0;
  for (const file of listHtmlFiles()) {
    const rel = path.relative(root, file).replace(/\\/gu, "/");
    if (shouldSkipPublicTrackerSync(rel)) {
      continue;
    }

    const html = fs.readFileSync(file, "utf8");
    let next = ensureTrackingScript(ensureHeadSnippets(html));
    next = normalizeTrackerHeadPaths(next);
    next = normalizeTrackingScriptLine(next);
    if (next !== html) {
      fs.writeFileSync(file, next);
      changed += 1;
    }
  }
  console.log(`sync-public-tracker-snippets: updated ${changed} file(s)`);
};

if (require.main === module) {
  main();
}

module.exports = {
  ensureHeadSnippets,
  ensureTrackingScript,
  trackerHeadBlock,
  assetContentHash,
  GA_MEASUREMENT_ID,
  shouldSkipPublicTrackerSync,
  listHtmlFiles,
  normalizeTrackerHeadPaths,
  normalizeTrackingScriptLine,
};
