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

function extractJsonLd(html) {
  const matches = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    matches.push(m[1].trim());
  }
  return matches;
}

test("homepage Organization JSON-LD is valid and complete", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const blocks = extractJsonLd(html);
  assert.ok(blocks.length > 0, "no JSON-LD blocks found in index.html");

  const parsed = blocks.map((b) => {
    try {
      return JSON.parse(b);
    } catch (e) {
      assert.fail(`JSON-LD block is not valid JSON: ${e.message}\n---\n${b}\n---`);
    }
  });

  const org = parsed.find((b) => {
    const type = b["@type"];
    return type === "Organization" || (Array.isArray(type) && type.includes("Organization"));
  });
  assert.ok(org, "no Organization JSON-LD block found in index.html");

  assert.equal(
    org["@type"],
    "Organization",
    `@type must be exactly "Organization", got: ${JSON.stringify(org["@type"])}`
  );
  assert.ok(org["@id"], 'Organization JSON-LD missing "@id"');
  assert.ok(org["legalName"], 'Organization JSON-LD missing "legalName"');
  assert.ok(org["taxID"], 'Organization JSON-LD missing "taxID"');
});

test("JSON-LD legalName and taxID match /terms/", () => {
  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const termsHtml = fs.readFileSync(path.join(root, "terms", "index.html"), "utf8");

  const blocks = extractJsonLd(indexHtml).map((b) => JSON.parse(b));
  const org = blocks.find((b) => {
    const type = b["@type"];
    return type === "Organization" || (Array.isArray(type) && type.includes("Organization"));
  });
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
