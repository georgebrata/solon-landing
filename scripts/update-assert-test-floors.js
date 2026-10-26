"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const {
  countRegisteredTests,
  MIN_REGISTERED_TESTS_BY_FILE,
  MIN_TOTAL_REGISTERED_TESTS,
} = require("./assert-test-files");

const testsDir = path.join(__dirname, "..", "tests");
const targetPath = process.env.SOLON_ASSERT_TEST_FILES_PATH
  ? path.resolve(process.env.SOLON_ASSERT_TEST_FILES_PATH)
  : path.join(__dirname, "assert-test-files.js");

const FLOOR_BLOCK_RE =
  /\/\*\* Minimum (?:registered|passed) tests per file[\s\S]*?^const MIN_REGISTERED_TESTS_BY_FILE = \{[\s\S]*?\};/m;

/**
 * @param {string} source
 * @returns {{ byFile: Record<string, number>, total: number }}
 */
const parseFloorsFromAssertSource = (source) => {
  const blockMatch = source.match(/const MIN_REGISTERED_TESTS_BY_FILE = \{([\s\S]*?)\};/m);
  const totalMatch = source.match(/const MIN_TOTAL_REGISTERED_TESTS = (\d+);/);
  /** @type {Record<string, number>} */
  const byFile = {};
  if (blockMatch) {
    const body = blockMatch[1];
    for (const line of body.split("\n")) {
      const entry = line.match(/^\s*"([^"]+)":\s*(\d+),?\s*$/u);
      if (entry) {
        byFile[entry[1]] = Number(entry[2]);
      }
    }
  }
  const total = totalMatch ? Number(totalMatch[1]) : 0;
  return { byFile, total };
};

/**
 * @returns {{ byFile: Record<string, number>, total: number } | null}
 */
const readOriginMainFloors = () => {
  try {
    const source = execSync("git show origin/main:scripts/assert-test-files.js", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return parseFloorsFromAssertSource(source);
  } catch {
    return null;
  }
};

let source = fs.readFileSync(targetPath, "utf8");
if (!FLOOR_BLOCK_RE.test(source)) {
  throw new Error(
    "update-assert-test-floors: MIN_REGISTERED_TESTS_BY_FILE anchor missing in assert-test-files.js",
  );
}
if (!/const MIN_TOTAL_REGISTERED_TESTS = \d+;/u.test(source)) {
  throw new Error("update-assert-test-floors: MIN_TOTAL_REGISTERED_TESTS anchor missing");
}

const files = fs
  .readdirSync(testsDir)
  .filter((name) => name.endsWith(".test.js"))
  .sort();

const mainFloors = readOriginMainFloors();

/** @type {Record<string, number>} */
const nextByFile = { ...MIN_REGISTERED_TESTS_BY_FILE };
let totalRegistered = 0;

for (const name of files) {
  const filePath = path.join(testsDir, name);
  const registered = countRegisteredTests(filePath);
  totalRegistered += registered;
  const previous = nextByFile[name] ?? 1;
  const mainFloor = mainFloors?.byFile[name] ?? 0;
  nextByFile[name] = Math.max(previous, registered, mainFloor);
}

const mainTotal = mainFloors?.total ?? 0;
const nextTotal = Math.max(MIN_TOTAL_REGISTERED_TESTS, totalRegistered, mainTotal);

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
