"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const scriptPath = path.join(__dirname, "..", "scripts", "assert-test-files.js");
const cliPath = path.join(__dirname, "..", "scripts", "count-registered-tests-cli.js");
const updateFloorsPath = path.join(__dirname, "..", "scripts", "update-assert-test-floors.js");
const { countDeclaredTests, countRegisteredTests } = require(scriptPath);
const { parseTapPassCount } = require(cliPath);
const {
  readOriginMainFloors,
  parseFloorsFromAssertSource,
} = require("../scripts/lib/origin-main-test-floors");

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

test("assert-test-files counts loop-generated registered tests", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-test-guard-"));
  const testsDir = path.join(tmpDir, "tests");
  fs.mkdirSync(testsDir);
  const filePath = path.join(testsDir, "loop.test.js");
  fs.writeFileSync(
    filePath,
    [
      '"use strict";',
      'const { test } = require("node:test");',
      "const names = ['alpha', 'beta'];",
      "for (const name of names) {",
      "  test(name, () => {});",
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(countDeclaredTests(fs.readFileSync(filePath, "utf8")), 1);
  assert.equal(countRegisteredTests(filePath), 2);
});

test("assert-test-files passes on real tests directory", (t) => {
  if (process.env.SOLON_SKIP_ASSERT_INTEGRATION === "1") {
    t.skip("full guard runs from npm test before the suite");
    return;
  }
  const { runAssertTestFiles } = require(scriptPath);
  runAssertTestFiles();
});

test("parseTapPassCount ignores forged # tests and requires TAP version", () => {
  const forged = [
    "TAP version 13",
    "# tests 999",
    "ok 1 - real",
    "# tests 1",
    "# pass 1",
    "# fail 0",
    "# tests 999",
  ].join("\n");
  assert.equal(parseTapPassCount(forged), 1);
  assert.equal(parseTapPassCount("no summary"), 0);
  assert.equal(parseTapPassCount("# pass 999\n# tests 999"), 0);
});

test("countRegisteredTests returns 0 for skip-only and todo-only files", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-test-guard-"));
  const testsDir = path.join(tmpDir, "tests");
  fs.mkdirSync(testsDir);
  const skipPath = path.join(testsDir, "skip-only.test.js");
  fs.writeFileSync(
    skipPath,
    [
      '"use strict";',
      'const { test } = require("node:test");',
      'test("skipped", (t) => { t.skip("n/a"); });',
      "",
    ].join("\n"),
  );
  const todoPath = path.join(testsDir, "todo-only.test.js");
  fs.writeFileSync(
    todoPath,
    [
      '"use strict";',
      'const { test } = require("node:test");',
      'test.todo("later");',
      "",
    ].join("\n"),
  );
  assert.equal(countRegisteredTests(skipPath), 0);
  assert.equal(countRegisteredTests(todoPath), 0);
});

test("assert-test-files rejects skip-only file under SOLON_TESTS_DIR", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-test-guard-"));
  const testsDir = path.join(tmpDir, "tests");
  fs.mkdirSync(testsDir);
  fs.writeFileSync(
    path.join(testsDir, "only-skip.test.js"),
    [
      '"use strict";',
      'const { test } = require("node:test");',
      'test("skipped", (t) => { t.skip("n/a"); });',
      "",
    ].join("\n"),
  );
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: { ...process.env, SOLON_TESTS_DIR: testsDir },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /only-skip\.test\.js passed 0/);
});

test("countRegisteredTests returns 0 for early process.exit before subtests", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-test-guard-"));
  const testsDir = path.join(tmpDir, "tests");
  fs.mkdirSync(testsDir);
  const earlyPath = path.join(testsDir, "early.test.js");
  fs.writeFileSync(
    earlyPath,
    ['"use strict";', "process.exit(0);", 'const { test } = require("node:test");', 'test("x", () => {});', ""].join(
      "\n",
    ),
  );
  assert.equal(countRegisteredTests(earlyPath), 0);
});

test("countRegisteredTests returns 0 when tests are only registered conditionally", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-test-guard-"));
  const testsDir = path.join(tmpDir, "tests");
  fs.mkdirSync(testsDir);
  const conditionalPath = path.join(testsDir, "conditional.test.js");
  fs.writeFileSync(
    conditionalPath,
    [
      '"use strict";',
      'const { test } = require("node:test");',
      "if (false) {",
      '  test("never", () => {});',
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(countRegisteredTests(conditionalPath), 0);
});

test("update-assert-test-floors fails when consent floor is below origin/main", () => {
  const { validateCommittedFloorsAgainstMain } = require(updateFloorsPath);
  const mainConsent = readOriginMainFloors().byFile["consent.test.js"];
  const currentConsent = parseFloorsFromAssertSource(fs.readFileSync(scriptPath, "utf8")).byFile[
    "consent.test.js"
  ];
  let tampered = fs.readFileSync(scriptPath, "utf8");
  tampered = tampered.replace(
    `"consent.test.js": ${currentConsent},`,
    `"consent.test.js": ${mainConsent - 1},`,
  );
  assert.throws(() => validateCommittedFloorsAgainstMain(tampered), /committed floor for consent\.test\.js/i);
});

test("update-assert-test-floors fails when floor anchor is missing", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solon-test-guard-"));
  const assertCopy = path.join(tmpDir, "assert-test-files.js");
  fs.writeFileSync(assertCopy, '"use strict";\nmodule.exports = {};\n');
  const result = spawnSync(process.execPath, [updateFloorsPath], {
    encoding: "utf8",
    env: { ...process.env, SOLON_ASSERT_TEST_FILES_PATH: assertCopy },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /anchor missing/i);
});
