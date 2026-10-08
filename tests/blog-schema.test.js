"use strict";

/**
 * Validates that FAQPage JSON-LD schema matches the visible FAQ section
 * for every blog post that includes a FAQPage node.
 *
 * Visible answers may span multiple <p> elements (e.g. when a paragraph
 * was split by humanize.js); they are joined with a single space before
 * comparison so the check is resilient to that formatting detail.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const BLOG_DIR = path.join(__dirname, "../blog");

/**
 * Strip all HTML tags and normalise internal whitespace.
 * @param {string} html
 * @returns {string}
 */
function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Find the FAQPage node in any JSON-LD script block and return its Q&A pairs.
 * Returns null when no FAQPage is found.
 * @param {string} html
 * @returns {Array<{name: string, text: string}>|null}
 */
function extractJsonLdFaqPairs(html) {
  const scriptRe = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = scriptRe.exec(html)) !== null) {
    let schema;
    try {
      schema = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const nodes = Array.isArray(schema["@graph"])
      ? schema["@graph"]
      : schema["@type"] === "FAQPage"
      ? [schema]
      : [];
    for (const node of nodes) {
      if (node["@type"] !== "FAQPage") continue;
      const pairs = (node.mainEntity || []).map((item) => ({
        name: (item.name || "").trim(),
        text: ((item.acceptedAnswer || {}).text || "").trim(),
      }));
      if (pairs.length > 0) return pairs;
    }
  }
  return null;
}

/**
 * Extract visible FAQ Q&A pairs from the rendered HTML.
 * Looks for the "Întrebări frecvente" h2, then gathers h3+answer pairs.
 * Concatenates multiple <p> elements per answer with a space.
 * @param {string} html
 * @returns {Array<{name: string, text: string}>|null}
 */
function extractVisibleFaqPairs(html) {
  const sectionMatch = html.match(
    /<h2[^>]*>[^<]*Întrebări frecvente[^<]*<\/h2>([\s\S]*?)(?=<h2[^>]*>|<\/article>)/i
  );
  if (!sectionMatch) return null;

  const section = sectionMatch[1];
  const h3Re = /<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3[^>]*>|$)/g;
  const pairs = [];
  let qm;
  while ((qm = h3Re.exec(section)) !== null) {
    const question = stripTags(qm[1]);
    const answerBlock = qm[2];
    const pTexts = [];
    const pRe = /<p>([\s\S]*?)<\/p>/g;
    let pm;
    while ((pm = pRe.exec(answerBlock)) !== null) {
      const txt = stripTags(pm[1]);
      if (txt) pTexts.push(txt);
    }
    if (question) pairs.push({ name: question, text: pTexts.join(" ") });
  }
  return pairs.length > 0 ? pairs : null;
}

test("FAQPage JSON-LD matches visible FAQ section for all blog posts", () => {
  const entries = fs.readdirSync(BLOG_DIR, { withFileTypes: true });
  const htmlFiles = entries
    .filter((d) => d.isDirectory() && d.name !== "posts")
    .map((d) => path.join(BLOG_DIR, d.name, "index.html"))
    .filter((f) => fs.existsSync(f));

  assert.ok(htmlFiles.length > 0, "No blog post HTML files found in blog/");

  const failures = [];
  let postsWithFaq = 0;

  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8");
    const jsonLdPairs = extractJsonLdFaqPairs(html);
    if (!jsonLdPairs) continue;

    postsWithFaq += 1;
    const rel = path.relative(path.join(__dirname, ".."), file);
    const visiblePairs = extractVisibleFaqPairs(html);

    if (!visiblePairs) {
      failures.push(`${rel}: FAQPage in JSON-LD but no "Întrebări frecvente" section found`);
      continue;
    }
    if (jsonLdPairs.length !== visiblePairs.length) {
      failures.push(
        `${rel}: JSON-LD has ${jsonLdPairs.length} Q&As, visible section has ${visiblePairs.length}`
      );
      continue;
    }
    for (let i = 0; i < jsonLdPairs.length; i += 1) {
      if (jsonLdPairs[i].name !== visiblePairs[i].name) {
        failures.push(
          `${rel}: Q${i + 1} question mismatch\n` +
            `  JSON-LD : ${jsonLdPairs[i].name}\n` +
            `  Visible : ${visiblePairs[i].name}`
        );
      }
      if (jsonLdPairs[i].text !== visiblePairs[i].text) {
        failures.push(
          `${rel}: Q${i + 1} answer mismatch\n` +
            `  JSON-LD : ${jsonLdPairs[i].text}\n` +
            `  Visible : ${visiblePairs[i].text}`
        );
      }
    }
  }

  assert.ok(postsWithFaq > 0, "Expected at least one post with FAQPage schema");
  assert.equal(
    failures.length,
    0,
    `FAQPage/visible mismatches (${failures.length}):\n${failures.join("\n\n")}`
  );
});
