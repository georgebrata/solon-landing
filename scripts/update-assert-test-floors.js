"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { countRegisteredTests, MIN_REGISTERED_TESTS_BY_FILE } = require("./assert-test-files");
const { readOriginMainFloors, parseFloorsFromAssertSource } = require("./lib/origin-main-test-floors");

const testsDir = path.join(__dirname, "..", "tests");

const FLOOR_BLOCK_RE =
  /\/\*\* Minimum (?:registered|passed) tests per file[\s\S]*?^const MIN_REGISTERED_TESTS_BY_FILE = \{[\s\S]*?\};/m;

/**
 * @param {string} source
 * @returns {void}
 */
const validateCommittedFloorsAgainstMain = (source) => {
  const mainFloors = readOriginMainFloors();
  const committedFloors = parseFloorsFromAssertSource(source);
  for (const [name, mainFloor] of Object.entries(mainFloors.byFile)) {
    const committedFloor = committedFloors.byFile[name] ?? 0;
    if (committedFloor < mainFloor) {
      throw new Error(
        `update-assert-test-floors: committed floor for ${name} (${committedFloor}) is below origin/main (${mainFloor})`,
      );
    }
  }
  if (committedFloors.total < mainFloors.total) {
    throw new Error(
      `update-assert-test-floors: committed total floor (${committedFloors.total}) is below origin/main (${mainFloors.total})`,
    );
  }
};

/**
 * @returns {void}
 */
const runUpdateAssertTestFloors = function runUpdateAssertTestFloors() {
  const targetPath = process.env.SOLON_ASSERT_TEST_FILES_PATH
    ? path.resolve(process.env.SOLON_ASSERT_TEST_FILES_PATH)
    : path.join(__dirname, "assert-test-files.js");

  let source = fs.readFileSync(targetPath, "utf8");
  if (!FLOOR_BLOCK_RE.test(source)) {
    throw new Error(
      "update-assert-test-floors: MIN_REGISTERED_TESTS_BY_FILE anchor missing in assert-test-files.js",
    );
  }
  if (!/const MIN_TOTAL_REGISTERED_TESTS = \d+;/u.test(source)) {
    throw new Error("update-assert-test-floors: MIN_TOTAL_REGISTERED_TESTS anchor missing");
  }

  const mainFloors = readOriginMainFloors();
  validateCommittedFloorsAgainstMain(source);

  const files = fs
    .readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.js"))
    .sort();

  /** @type {Record<string, number>} */
  const nextByFile = { ...MIN_REGISTERED_TESTS_BY_FILE };
  let totalRegistered = 0;

  for (const name of files) {
    const filePath = path.join(testsDir, name);
    const registered = countRegisteredTests(filePath);
    totalRegistered += registered;
    const mainFloor = mainFloors.byFile[name] ?? 0;
    if (registered < mainFloor) {
      throw new Error(
        `update-assert-test-floors: ${name} passed ${registered} tests, below origin/main floor ${mainFloor}`,
      );
    }
    nextByFile[name] = Math.max(registered, mainFloor);
  }

  const nextTotal = Math.max(totalRegistered, mainFloors.total);
  if (nextTotal < mainFloors.total) {
    throw new Error(
      `update-assert-test-floors: next total floor ${nextTotal} would be below origin/main ${mainFloors.total}`,
    );
  }

  const lines = Object.keys(nextByFile)
    .sort()
    .map((name) => `  "${name}": ${nextByFile[name]},`)
    .join("\n");

  const block = `/** Minimum passed tests per file (raise via scripts/update-assert-test-floors.js only). */
const MIN_REGISTERED_TESTS_BY_FILE = {
${lines}
};`;

  source = source.replace(FLOOR_BLOCK_RE, block);
  source = source.replace(
    /const MIN_TOTAL_REGISTERED_TESTS = \d+;/u,
    `const MIN_TOTAL_REGISTERED_TESTS = ${nextTotal};`,
  );

  fs.writeFileSync(targetPath, source);
  console.log(
    `Updated test guard floors (${files.length} files, total passed ${totalRegistered}, floor ${nextTotal}).`,
  );
};

module.exports = { runUpdateAssertTestFloors, validateCommittedFloorsAgainstMain };

if (require.main === module) {
  runUpdateAssertTestFloors();
}
