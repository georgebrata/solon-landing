"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  render,
  validateSnapshot,
  resolveData,
} = require("../scripts/build-homepage-sheets");

const ROOT = path.join(__dirname, "..");
const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "homepage-sheets.snapshot.json"), "utf8"));
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const FORBIDDEN = [
  /script\.google\.com/iu,
  /script\.googleusercontent\.com/iu,
  /cdn\.jsdelivr\.net/iu,
];

/** @param {string} label */
const read = (label) => {
  const map = {
    home: path.join(ROOT, "index.html"),
    blog: path.join(ROOT, "blog", "index.html"),
    privacy: path.join(ROOT, "privacy", "index.html"),
    cookies: path.join(ROOT, "cookies", "index.html"),
    faqJs: path.join(ROOT, "assets", "js", "faq.min.js"),
    testimonialsJs: path.join(ROOT, "assets", "js", "testimonials.min.js"),
    formsJs: path.join(ROOT, "assets", "js", "forms.min.js"),
  };
  return fs.readFileSync(map[label], "utf8");
};

/** @param {string} source */
const forbiddenHits = (source) => FORBIDDEN.filter((re) => re.test(source));

test("committed index.html matches homepage sheets snapshot render", () => {
  const data = validateSnapshot(snapshot);
  assert.equal(render(indexHtml, data), indexHtml);
});

test("homepage FAQ and testimonials client bundles do not fetch Google Sheets", () => {
  for (const label of ["faqJs", "testimonialsJs"]) {
    const hits = forbiddenHits(read(label));
    assert.deepEqual(hits, [], `${label} must not reference ${hits.map(String).join(", ")}`);
    assert.equal(/\bfetch\s*\(/u.test(read(label)), false, `${label} must not call fetch()`);
  }
});

test("built HTML for /, /blog/, /privacy/, /cookies/ has no runtime Google Sheets or jsDelivr refs", () => {
  for (const page of ["home", "blog", "privacy", "cookies"]) {
    const hits = forbiddenHits(read(page));
    assert.deepEqual(hits, [], `${page} HTML must not reference ${hits.map(String).join(", ")}`);
  }
});

test("forms.js still posts leads to Apps Script (allowed third-party submit)", () => {
  const forms = read("formsJs");
  assert.match(forms, /script\.google\.com\/macros\/s\//u);
  assert.doesNotMatch(forms, /cdn\.jsdelivr\.net/iu);
});

test("resolveData offline uses committed snapshot without network", async () => {
  const { data, source } = await resolveData({ offline: true });
  assert.equal(source, "snapshot");
  assert.ok(Array.isArray(data.Testimonials));
  assert.equal(data.Testimonials.filter((row) => row.Visible).length, 4);
});
