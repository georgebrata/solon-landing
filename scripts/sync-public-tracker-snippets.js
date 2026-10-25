"use strict";

/**
 * Ensures public HTML pages include consent-gated Meta Pixel + GA4 snippets
 * and tracking.min.js. Skips r/, error pages, and templates/.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const SKIP_DIR_NAMES = new Set([".git", "node_modules", "r", "templates"]);

/**
 * @param {string} relPath Repo-relative path using forward slashes.
 * @returns {boolean}
 */
function shouldSkipPublicTrackerSync(relPath) {
  const rel = String(relPath).replace(/\\/g, "/");
  if (/^(?:403|404|500)\.html$/.test(rel)) {
    return true;
  }
  if (rel === "r" || rel.startsWith("r/")) {
    return true;
  }
  if (rel.startsWith("templates/")) {
    return true;
  }
  if (rel.startsWith("node_modules/")) {
    return true;
  }
  return false;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function relativeAssetPrefix(filePath) {
  const dir = path.dirname(filePath);
  const rel = path.relative(root, dir);
  if (!rel || rel === ".") return "";
  const depth = rel.split(path.sep).filter(Boolean).length;
  return `${"../".repeat(depth)}`;
}

/**
 * @param {string} prefix
 * @returns {string}
 */
function trackerHeadBlock(prefix) {
  const asset = prefix ? `${prefix}assets/` : "assets/";
  return `
<!-- counter.dev -->
  <script type="text/plain" data-consent-category="analytics" src="https://cdn.counter.dev/script.js" data-id="03bd5925-48e2-4d33-ae59-d66aaf6acba0"
    data-utcoffset="2" defer></script>

  <!--metricool-->
  <script type="text/plain" data-consent-category="analytics" src="/assets/js/metricool-init.min.js" data-metricool-hash="5eff58c72e852f80d27f8f1735299845"></script>

  <!-- Meta Pixel Code -->
  <script type="text/plain" data-consent-category="marketing" src="${asset}js/meta-pixel.min.js" defer></script>
  <!-- End Meta Pixel Code -->

  <!-- Google tag (gtag.js) -->
  <script type="text/plain" data-consent-category="analytics" async src="https://www.googletagmanager.com/gtag/js?id=G-H41D7KCWHX"></script>
  <script type="text/plain" data-consent-category="analytics" src="/assets/js/gtag-config.min.js"></script>
`;
}

const TRACKING_BODY_TAG =
  '  <script src="/assets/js/tracking.min.js" defer></script>\n';

/**
 * @param {string} html
 * @param {string} prefix
 * @returns {string}
 */
function ensureHeadSnippets(html, prefix) {
  if (html.includes("meta-pixel.min.js")) {
    return html;
  }
  const anchor = /(<script[^>]*consent\.min\.js[^>]*><\/script>)/i;
  if (!anchor.test(html)) {
    return html;
  }
  return html.replace(anchor, `$1${trackerHeadBlock(prefix)}`);
}

/**
 * @param {string} html
 * @returns {string}
 */
function ensureTrackingScript(html) {
  if (!html.includes("consent.min.js")) {
    return html;
  }
  if (html.includes("tracking.min.js")) {
    return html;
  }
  if (html.includes("forms.min.js")) {
    return html.replace(
      /(\s*<script[^>]*forms\.min\.js[^>]*><\/script>)/i,
      `${TRACKING_BODY_TAG}$1`,
    );
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${TRACKING_BODY_TAG}</body>`);
  }
  return html;
}

/**
 * @returns {string[]}
 */
function listHtmlFiles() {
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
}

function main() {
  let changed = 0;
  for (const file of listHtmlFiles()) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    if (shouldSkipPublicTrackerSync(rel)) {
      continue;
    }

    const prefix = relativeAssetPrefix(file);
    let html = fs.readFileSync(file, "utf8");
    const next = ensureTrackingScript(ensureHeadSnippets(html, prefix));
    if (next !== html) {
      fs.writeFileSync(file, next);
      changed += 1;
    }
  }
  console.log(`sync-public-tracker-snippets: updated ${changed} file(s)`);
}

if (require.main === module) {
  main();
}

module.exports = {
  ensureHeadSnippets,
  ensureTrackingScript,
  trackerHeadBlock,
  shouldSkipPublicTrackerSync,
  listHtmlFiles,
};
