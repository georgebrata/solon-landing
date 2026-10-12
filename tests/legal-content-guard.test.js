"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  containsLegalCitations,
  mergeLegalSentenceFragments,
  protectLegalContent,
} = require("../scripts/lib/legal-content-guard");

test("mergeLegalSentenceFragments keeps art./alin./pct. citations on one line", () => {
  const raw = ["Devii implementator (art.", " 3 pct.", " 4).", "End."];
  const merged = mergeLegalSentenceFragments(raw);
  assert.equal(merged.length, 2);
  assert.match(merged[0], /\(art\. 3 pct\. 4\)/u);
});

test("protectLegalContent preserves substanțial and legal role terms", () => {
  const input = "Îl modifici substanțial sau îl folosești ca furnizor și implementator.";
  const { text, restore } = protectLegalContent(input);
  assert.notEqual(text, input);
  const restored = restore(text);
  assert.equal(restored, input);
});

test("containsLegalCitations detects art. and Regulamentul (UE) references", () => {
  assert.equal(containsLegalCitations("Obligații din art. 50."), true);
  assert.equal(containsLegalCitations("Regulamentul (UE) 2024/1689"), true);
  assert.equal(containsLegalCitations("Text fără trimiteri legislative."), false);
});
