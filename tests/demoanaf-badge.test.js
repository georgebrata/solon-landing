"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const {
  DEMOANAF_CUI,
  DEMOANAF_HEAD_TAG,
  HEAD_SCRIPT_RE,
  FOOTER_BADGE_RE,
  shouldSkipDemoanafBadge,
  hasSiteFooter,
  ensureDemoanafBadge,
  listDemoanafTargetRelPaths,
} = require("../scripts/sync-demoanaf-badge");

const EXACT_HEAD_SCRIPT = '<script defer src="https://demoanaf.ro/verified.js"></script>';
const EXACT_FOOTER_BADGE = `<div data-demoanaf="${DEMOANAF_CUI}"></div>`;

/**
 * @param {string} html
 * @returns {string}
 */
const extractHead = (html) => {
  const match = html.match(/<head\b[\s\S]*?<\/head>/iu);
  return match ? match[0] : "";
};

/**
 * @param {string} html
 * @returns {string}
 */
const extractFooter = (html) => {
  const match = html.match(/<footer\b[\s\S]*?<\/footer>/iu);
  return match ? match[0] : "";
};

/**
 * @param {string} source
 * @param {RegExp} pattern
 * @returns {number}
 */
const countMatches = (source, pattern) => {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  return [...source.matchAll(re)].length;
};

test("ensureDemoanafBadge injects exact head script and footer badge once", () => {
  const html = `<!DOCTYPE html><html><head><title>x</title></head><body>
  <footer id="footer"><div class="container footer-bottom clearfix">
  <div class="copyright"><b>SOLON</b></div>
  <div class="credits">Servicii</div></div></footer></body></html>`;
  const next = ensureDemoanafBadge(html);
  assert.match(next, new RegExp(EXACT_HEAD_SCRIPT.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  assert.match(next, new RegExp(EXACT_FOOTER_BADGE.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  assert.equal(countMatches(extractHead(next), HEAD_SCRIPT_RE), 1);
  assert.equal(countMatches(extractFooter(next), FOOTER_BADGE_RE), 1);
});

test("skipped paths are not demoanaf targets", () => {
  assert.equal(shouldSkipDemoanafBadge("r/bronze/lunar/index.html"), true);
  assert.equal(shouldSkipDemoanafBadge("404.html"), true);
  assert.equal(shouldSkipDemoanafBadge("client-nou/index.html"), true);
  assert.equal(shouldSkipDemoanafBadge("templates/layout.html"), true);
  assert.equal(shouldSkipDemoanafBadge("cookies/index.html"), true);
});

test("every public page with the site footer has one demoanaf head script and footer badge", () => {
  const targets = listDemoanafTargetRelPaths();
  assert.ok(targets.length >= 90, `expected many footer pages, got ${targets.length}`);
  const offenders = [];
  for (const rel of targets) {
    const html = fs.readFileSync(path.join(root, rel), "utf8");
    assert.equal(hasSiteFooter(html), true, `${rel} must have site footer`);
    const head = extractHead(html);
    const footer = extractFooter(html);
    const headCount = countMatches(head, HEAD_SCRIPT_RE);
    const badgeCount = countMatches(footer, FOOTER_BADGE_RE);
    if (headCount !== 1 || badgeCount !== 1) {
      offenders.push(`${rel} head=${headCount} footerBadge=${badgeCount}`);
    }
    if (!head.includes(EXACT_HEAD_SCRIPT)) {
      offenders.push(`${rel} head script not exact`);
    }
    if (!footer.includes(EXACT_FOOTER_BADGE)) {
      offenders.push(`${rel} footer badge not exact`);
    }
  }
  assert.deepEqual(offenders, []);
});

const PRIVACY_DEMOANAF_PARAGRAPH_PLAIN =
  "Insigna „firmă verificată” din subsolul fiecărei pagini este încărcată de pe demoanaf.ro, platformă operată de Gamerina SRL (CUI RO43020532, Cluj-Napoca). Pentru a afișa insigna, browserul tău se conectează direct la serverele demoanaf.ro, care primesc astfel adresa ta IP și informații despre browser. Insigna nu plasează cookie-uri și nu stochează nimic pe dispozitivul tău, iar noi nu primim aceste date. Temeiul este interesul nostru legitim de a-ți arăta, din surse publice (ONRC, ANAF), datele oficiale ale SOLON SRL (art. 6 alin. (1) lit. f) din Regulamentul (UE) 2016/679). Pentru prelucrările ulterioare, Gamerina SRL acționează ca operator independent, conform propriei politici de confidențialitate DemoANAF.";

/**
 * @param {string} html
 * @returns {string}
 */
const stripHtmlTags = (html) =>
  html
    .replace(/<[^>]+>/gu, "")
    .replace(/\s+/gu, " ")
    .trim();

test("privacy page includes DemoANAF disclosure paragraph verbatim in Dezvăluirea section", () => {
  const html = fs.readFileSync(path.join(root, "privacy/index.html"), "utf8");
  const sectionStart = html.indexOf("<h3>Dezvăluirea datelor cu caracter personal</h3>");
  const sectionEnd = html.indexOf("<h3>Drepturile tale</h3>", sectionStart);
  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
  const section = html.slice(sectionStart, sectionEnd);
  const paragraphMatch = section.match(
    /<p class="px-lg-5">Insigna „firmă verificată”[\s\S]*?<\/p>/u,
  );
  assert.ok(paragraphMatch, "DemoANAF disclosure paragraph missing");
  const plain = stripHtmlTags(paragraphMatch[0]);
  assert.equal(plain, PRIVACY_DEMOANAF_PARAGRAPH_PLAIN);
  assert.match(
    paragraphMatch[0],
    /<a href="https:\/\/demoanaf\.ro\/confidentialitate" rel="noopener noreferrer" target="_blank">politici de confidențialitate DemoANAF<\/a>/u,
  );
  assert.match(html, /Ultima actualizare: 26\.10\.2026/u);
});

test("redirect stubs and error pages without badge policy omit demoanaf markup", () => {
  const skipped = [
    "r/bronze/lunar/index.html",
    "404.html",
    "403.html",
    "500.html",
    "client-nou/index.html",
    "newsletter.html",
    "cookies/index.html",
  ];
  for (const rel of skipped) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) {
      continue;
    }
    const html = fs.readFileSync(full, "utf8");
    assert.equal(countMatches(html, HEAD_SCRIPT_RE), 0, rel);
    assert.equal(countMatches(html, FOOTER_BADGE_RE), 0, rel);
  }
});
