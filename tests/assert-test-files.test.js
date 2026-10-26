"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const scriptPath = path.join(__dirname, "..", "scripts", "assert-test-files.js");
const { countDeclaredTests } = require(scriptPath);

test("assert-test-files rejects an empty tests/*.test.js", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-test-guard-"));
  const testsDir = path.join(tmpDir, "tests");
  fs.mkdirSync(testsDir);
  fs.writeFileSync(path.join(testsDir, "empty.test.js"), "");
  fs.writeFileSync(
    path.join(testsDir, "ok.test.js"),
    'const { test } = require("node:test");\ntest("x", () => {});\n',
  );
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: { ...process.env, SOLON_TESTS_DIR: testsDir },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /empty\.test\.js is empty/);
});

test("assert-test-files rejects comment-only test( and .test() false positives", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-test-guard-"));
  const testsDir = path.join(tmpDir, "tests");
  fs.mkdirSync(testsDir);
  fs.writeFileSync(
    path.join(testsDir, "fake.test.js"),
    [
      '"use strict";',
      "const COLLECT_RE = /collect/;",
      "// test('should not count');",
      "COLLECT_RE.test('https://example.com/g/collect');",
      "",
    ].join("\n"),
  );
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: { ...process.env, SOLON_TESTS_DIR: testsDir },
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stderr}${result.stdout}`,
    /fake\.test\.js has no declared test\(\)\/it\(\) calls/,
  );
});

test("assert-test-files counts it() declarations", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-test-guard-"));
  const testsDir = path.join(tmpDir, "tests");
  fs.mkdirSync(testsDir);
  fs.writeFileSync(
    path.join(testsDir, "suite.test.js"),
    [
      '"use strict";',
      'const { describe, it } = require("node:test");',
      "describe('group', () => {",
      "  it('works', () => {});",
      "});",
      "",
    ].join("\n"),
  );
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: { ...process.env, SOLON_TESTS_DIR: testsDir },
  });
  assert.equal(result.status, 0);
});

test("assert-test-files meets consent.test.js declaration floor", () => {
  const consentSource = fs.readFileSync(path.join(__dirname, "consent.test.js"), "utf8");
  assert.ok(countDeclaredTests(consentSource) >= 53);
});

test("assert-test-files passes on real tests directory", () => {
  const env = { ...process.env };
  delete env.SOLON_TESTS_DIR;
  const result = spawnSync(process.execPath, [scriptPath], { encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
