"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const scriptPath = path.join(__dirname, "..", "scripts", "assert-test-files.js");

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

test("assert-test-files passes on real tests directory", () => {
  const result = spawnSync(process.execPath, [scriptPath], { encoding: "utf8" });
  assert.equal(result.status, 0);
});
