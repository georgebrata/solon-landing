"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  ROOT,
  assertConfig,
  collectServedHtml,
  diffBaseline,
  shouldValidate,
  validateServedHtml,
} = require("../scripts/validate-html");

const baseline = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "html-validate-baseline.json"), "utf8")
);

test("served HTML includes pages, posts, case studies, and short links", () => {
  const files = collectServedHtml(ROOT, baseline).map((file) =>
    path.relative(ROOT, file).split(path.sep).join("/")
  );
  assert.ok(files.length >= 100, `expected at least 100 served pages, found ${files.length}`);
  for (const required of [
    "index.html",
    "404.html",
    "500.html",
    "403.html",
    "newsletter.html",
    "blog/index.html",
    "studii-de-caz/index.html",
    "studii-de-caz/tslaw/index.html",
    "r/api/index.html",
    "onboarding/bronze/index.html",
  ]) {
    assert.ok(files.includes(required), `missing ${required}`);
  }
  assert.equal(
    files.includes("studii-de-caz/avocat-dumitrescu-alexandru/index.html"),
    false
  );
  assert.equal(files.includes("templates/layout.html"), false);
  assert.equal(
    files.some((file) => file.startsWith("assets/vendor/")),
    false
  );
});

test("templates, vendor files, and the held case study are not validated", () => {
  assert.equal(shouldValidate("templates/layout.html", baseline), false);
  assert.equal(shouldValidate("templates/post.html", baseline), false);
  assert.equal(shouldValidate("node_modules/html-validate/index.html", baseline), false);
  assert.equal(shouldValidate("assets/vendor/example.html", baseline), false);
  assert.equal(
    shouldValidate("studii-de-caz/avocat-dumitrescu-alexandru/index.html", baseline),
    false
  );
  assert.equal(shouldValidate("index.html", baseline), true);
  assert.equal(shouldValidate("r/bronze/lunar/index.html", baseline), true);
});

test("recommended rules stay on except the two historical exceptions", () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, ".htmlvalidate.json"), "utf8"));
  assert.deepEqual(assertConfig(config), []);
  assert.deepEqual(
    assertConfig({
      extends: ["html-validate:recommended"],
      rules: { "no-inline-style": "off", "no-trailing-whitespace": "off", "void-style": "off" },
    }),
    ["config disables no-inline-style; do not weaken html-validate rules"]
  );
});

test("baseline diff fails on a new error and on a stale allowance", () => {
  const sample = {
    files: { "index.html": { "no-inline-style": 2 } },
    rules: { "no-inline-style": "documented" },
    excludedFiles: [],
  };
  assert.deepEqual(diffBaseline({ "index.html": { "no-inline-style": 2 } }, sample), []);
  assert.equal(
    diffBaseline({ "index.html": { "no-inline-style": 3 } }, sample)[0].kind,
    "regression"
  );
  assert.equal(
    diffBaseline({ "index.html": { "no-inline-style": 1 } }, sample)[0].kind,
    "stale"
  );
  assert.equal(
    diffBaseline({ "blog/new/index.html": { "long-title": 1 } }, sample)[0].kind,
    "unexpected"
  );
});

test("every served page matches the HTML baseline", async () => {
  const result = await validateServedHtml(ROOT);
  assert.deepEqual(result.problems, []);
});
