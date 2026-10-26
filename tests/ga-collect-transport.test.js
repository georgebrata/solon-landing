"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  gaCollectPathMatch,
  isGaCollectTransportUrl,
  pathHasGaCollectSegments,
} = require("../scripts/lib/ga-collect-transport");

test("gaCollectPathMatch blocks double-encoded and slash-collapsed collect paths", () => {
  assert.equal(gaCollectPathMatch("/g/%2563ollect").matches, true);
  assert.equal(gaCollectPathMatch("/g/%252Fcollect").matches, true);
  assert.equal(gaCollectPathMatch("//g//collect").matches, true);
});

test("gaCollectPathMatch treats malformed percent-encoding as decode failure", () => {
  const malformed = gaCollectPathMatch("/g/%ZZollect");
  assert.equal(malformed.matches, false);
  assert.equal(malformed.decodeFailed, true);
});

test("pathHasGaCollectSegments does not match /g/collection", () => {
  assert.equal(pathHasGaCollectSegments("/g/collection"), false);
  assert.equal(pathHasGaCollectSegments("/g/collect"), true);
});

test("isGaCollectTransportUrl matches /ccm/collect and encoded GA paths", () => {
  assert.equal(
    isGaCollectTransportUrl("https://www.googletagmanager.com/ccm/collect?v=2"),
    true,
  );
  assert.equal(
    isGaCollectTransportUrl("https://www.google-analytics.com/g/%63ollect?v=2"),
    true,
  );
  assert.equal(
    isGaCollectTransportUrl("https://www.googletagmanager.com/g/collection?v=2"),
    false,
  );
});
