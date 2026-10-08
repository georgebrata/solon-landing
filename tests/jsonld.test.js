"use strict";

/**
 * Verifies the homepage Organization JSON-LD block:
 * - is valid JSON
 * - contains required fields (@id, @type, legalName, taxID)
 * - legalName and taxID match what /terms/ (terms/index.html) states
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

const extractJsonLd = (html) => {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match = re.exec(html);
  while (match !== null) {
    blocks.push(match[1].trim());
    match = re.exec(html);
  }
  return blocks;
};

const parseJsonLdBlocks = (html) => {
  const rawBlocks = extractJsonLd(html);
  const parsed = [];
  for (const block of rawBlocks) {
    try {
      parsed.push(JSON.parse(block));
    } catch (err) {
      assert.fail(`JSON-LD block is not valid JSON: ${err.message}\n---\n${block}\n---`);
    }
  }
  return parsed;
};

const findOrganization = (blocks) =>
  blocks.find((b) => {
    const type = b["@type"];
    return type === "Organization" || (Array.isArray(type) && type.includes("Organization"));
  });

test("homepage Organization JSON-LD is valid and complete", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const parsed = parseJsonLdBlocks(html);
  assert.ok(parsed.length > 0, "no JSON-LD blocks found in index.html");

  const org = findOrganization(parsed);
  assert.ok(org, "no Organization JSON-LD block found in index.html");

  assert.equal(
    org["@type"],
    "Organization",
    `@type must be exactly "Organization", got: ${JSON.stringify(org["@type"])}`
  );
  assert.ok(org["@id"], 'Organization JSON-LD missing "@id"');
  assert.ok(org.legalName, 'Organization JSON-LD missing "legalName"');
  assert.ok(org.taxID, 'Organization JSON-LD missing "taxID"');
});

test("JSON-LD legalName and taxID match /terms/", () => {
  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const termsHtml = fs.readFileSync(path.join(root, "terms", "index.html"), "utf8");

  const org = findOrganization(parseJsonLdBlocks(indexHtml));
  assert.ok(org, "Organization JSON-LD not found");

  const { legalName, taxID } = org;
  assert.ok(
    termsHtml.includes(legalName),
    `legalName "${legalName}" not found in terms/index.html`
  );
  assert.ok(
    termsHtml.includes(taxID),
    `taxID "${taxID}" not found in terms/index.html`
  );
});
