"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { shouldSkipPublicTrackerSync, listHtmlFiles } = require("./sync-public-tracker-snippets");

const root = path.join(__dirname, "..");

const DEMOANAF_CUI = "49995463";
const DEMOANAF_HEAD_TAG = `<script defer src="https://demoanaf.ro/verified.js"></script>`;
const DEMOANAF_FOOTER_TAG = `<div data-demoanaf="${DEMOANAF_CUI}"></div>`;

const HEAD_SCRIPT_RE = /<script\s+defer\s+src="https:\/\/demoanaf\.ro\/verified\.js"\s*><\/script>/iu;
const FOOTER_BADGE_RE = new RegExp(`<div\\s+data-demoanaf="${DEMOANAF_CUI}"\\s*><\\/div>`, "iu");

/**
 * @param {string} relPath Repo-relative path using forward slashes.
 * @returns {boolean}
 */
const shouldSkipDemoanafBadge = (relPath) => {
  const rel = String(relPath).replace(/\\/gu, "/");
  if (rel === "cookies/index.html" || rel.startsWith("cookies/")) {
    return true;
  }
  return shouldSkipPublicTrackerSync(rel);
};

/**
 * @param {string} html
 * @returns {boolean}
 */
const hasSiteFooter = (html) =>
  /<footer\b[^>]*\bid=["']footer["']/iu.test(html) && /footer-bottom/u.test(html);

/**
 * @param {string} html
 * @returns {string}
 */
const ensureDemoanafHead = (html) => {
  if (HEAD_SCRIPT_RE.test(html)) {
    return html;
  }
  if (!/<\/head>/iu.test(html)) {
    return html;
  }
  return html.replace(/<\/head>/iu, `  ${DEMOANAF_HEAD_TAG}\n</head>`);
};

/**
 * @param {string} html
 * @returns {string}
 */
const ensureDemoanafFooter = (html) => {
  if (FOOTER_BADGE_RE.test(html)) {
    return html;
  }
  const betweenCopyrightAndCredits =
    /(<div class="copyright">[\s\S]*?<\/div>)(\s*\n\s*)(<div class="credits">)/iu;
  if (betweenCopyrightAndCredits.test(html)) {
    return html.replace(
      betweenCopyrightAndCredits,
      `$1\n      ${DEMOANAF_FOOTER_TAG}$2$3`,
    );
  }
  const footerBottom = /(<div class="container footer-bottom clearfix">)/iu;
  if (footerBottom.test(html)) {
    return html.replace(footerBottom, `$1\n      ${DEMOANAF_FOOTER_TAG}`);
  }
  return html;
};

/**
 * @param {string} html
 * @returns {string}
 */
const ensureDemoanafBadge = (html) => ensureDemoanafFooter(ensureDemoanafHead(html));

/**
 * @returns {string[]}
 */
const listDemoanafTargetRelPaths = () => {
  const targets = [];
  for (const file of listHtmlFiles()) {
    const rel = path.relative(root, file).replace(/\\/gu, "/");
    if (shouldSkipDemoanafBadge(rel)) {
      continue;
    }
    const html = fs.readFileSync(file, "utf8");
    if (hasSiteFooter(html)) {
      targets.push(rel);
    }
  }
  return targets.sort();
};

/**
 * @returns {void}
 */
const main = () => {
  let changed = 0;
  for (const file of listHtmlFiles()) {
    const rel = path.relative(root, file).replace(/\\/gu, "/");
    if (shouldSkipDemoanafBadge(rel)) {
      continue;
    }
    const html = fs.readFileSync(file, "utf8");
    if (!hasSiteFooter(html)) {
      continue;
    }
    const next = ensureDemoanafBadge(html);
    if (next !== html) {
      fs.writeFileSync(file, next);
      changed += 1;
    }
  }
  console.log(`sync-demoanaf-badge: updated ${changed} file(s)`);
};

module.exports = {
  DEMOANAF_CUI,
  DEMOANAF_HEAD_TAG,
  DEMOANAF_FOOTER_TAG,
  HEAD_SCRIPT_RE,
  FOOTER_BADGE_RE,
  shouldSkipDemoanafBadge,
  hasSiteFooter,
  ensureDemoanafHead,
  ensureDemoanafFooter,
  ensureDemoanafBadge,
  listDemoanafTargetRelPaths,
};

if (require.main === module) {
  main();
}
