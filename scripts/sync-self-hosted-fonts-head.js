"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { listHtmlFiles } = require("./sync-public-tracker-snippets");

const root = path.join(__dirname, "..");

const LEGACY_GOOGLE_FONT_STYLESHEET = "css2?family=Jost:wght@400;500;600;700";

const FONT_PRELOAD_BLOCK = `  <!-- Self-hosted fonts (SIL OFL; see /assets/fonts/OFL.txt) -->
  <link rel="preload" href="/assets/fonts/jost-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/open-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
`;

/**
 * @param {string} html
 * @returns {string}
 */
const stripGoogleFontReferences = (html) => {
  let next = html;
  next = next.replace(/\s*<!--\s*Google Fonts\s*-->[\s\S]*?(?=\s*<!-- Vendor CSS|\s*<link[^>]*vendor\/)/gi, "\n");
  next = next.replace(/\s*<link rel="preconnect" href="https:\/\/[^"]*googleapis\.com"[^>]*>\s*/gi, "");
  next = next.replace(/\s*<link rel="preconnect" href="https:\/\/[^"]*gstatic\.com"[^>]*crossorigin[^>]*>\s*/gi, "");
  next = next.replace(/\s*<link[^>]*href="https:\/\/[^"]*googleapis\.com\/css2\?family=Jost[^"]*"[^>]*>\s*/gi, "");
  next = next.replace(/\s*<noscript>\s*<link[^>]*googleapis\.com\/css2\?family=Jost[^>]*>\s*<\/noscript>\s*/gi, "");
  return next;
};

/**
 * @param {string} html
 * @returns {string}
 */
const ensureSelfHostedFontPreloads = (html) => {
  if (html.includes("/assets/fonts/jost-latin-400-normal.woff2")) {
    return html;
  }
  const vendorAnchor = /(\s*<!-- Vendor CSS Files -->)/i;
  if (vendorAnchor.test(html)) {
    return html.replace(vendorAnchor, `\n${FONT_PRELOAD_BLOCK}$1`);
  }
  const bootstrapAnchor = /(\s*<link[^>]*bootstrap[^>]*rel="stylesheet"[^>]*>)/i;
  if (bootstrapAnchor.test(html)) {
    return html.replace(bootstrapAnchor, `\n${FONT_PRELOAD_BLOCK}$1`);
  }
  return html;
};

/**
 * @param {string} html
 * @returns {string}
 */
const applySelfHostedFontsHead = (html) => ensureSelfHostedFontPreloads(stripGoogleFontReferences(html));

/**
 * @param {string} relPath
 * @returns {boolean}
 */
const shouldSkipFontHeadSync = (relPath) => {
  const rel = String(relPath).replace(/\\/gu, "/");
  return (
    rel.startsWith("r/") ||
    /^(?:403|404|500)\.html$/u.test(rel) ||
    rel === "client-nou/index.html"
  );
};

/**
 * @returns {void}
 */
const main = () => {
  let changed = 0;
  for (const file of listHtmlFiles()) {
    const rel = path.relative(root, file).replace(/\\/gu, "/");
    if (shouldSkipFontHeadSync(rel)) {
      continue;
    }
    const html = fs.readFileSync(file, "utf8");
    if (!html.includes(LEGACY_GOOGLE_FONT_STYLESHEET) && html.includes("jost-latin-400-normal.woff2")) {
      continue;
    }
    if (!html.includes(LEGACY_GOOGLE_FONT_STYLESHEET)) {
      continue;
    }
    const next = applySelfHostedFontsHead(html);
    if (next !== html) {
      fs.writeFileSync(file, next);
      changed += 1;
    }
  }
  for (const rel of ["templates/layout.html"]) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
      continue;
    }
    const html = fs.readFileSync(file, "utf8");
    const next = applySelfHostedFontsHead(html);
    if (next !== html) {
      fs.writeFileSync(file, next);
      changed += 1;
    }
  }
  console.log(`sync-self-hosted-fonts-head: updated ${changed} file(s)`);
};

module.exports = {
  stripGoogleFontReferences,
  ensureSelfHostedFontPreloads,
  applySelfHostedFontsHead,
  FONT_PRELOAD_BLOCK,
};

if (require.main === module) {
  main();
}
