"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  countRegisteredTests,
  MIN_REGISTERED_TESTS_BY_FILE,
  MIN_TOTAL_REGISTERED_TESTS,
} = require("./assert-test-files");

const testsDir = path.join(__dirname, "..", "tests");
const targetPath = path.join(__dirname, "assert-test-files.js");

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
  const previous = nextByFile[name] ?? 1;
  nextByFile[name] = Math.max(previous, registered);
}

const nextTotal = Math.max(MIN_TOTAL_REGISTERED_TESTS, totalRegistered);

const lines = Object.keys(nextByFile)
  .sort()
  .map((name) => `  "${name}": ${nextByFile[name]},`)
  .join("\n");

const block = `/** Minimum registered tests per file (raise via scripts/update-assert-test-floors.js only). */
const MIN_REGISTERED_TESTS_BY_FILE = {
${lines}
};`;

let source = fs.readFileSync(targetPath, "utf8");
source = source.replace(
  /\/\*\* Minimum registered tests per file[\s\S]*?^const MIN_REGISTERED_TESTS_BY_FILE = \{[\s\S]*?\};/m,
  block,
);
source = source.replace(
  /const MIN_TOTAL_REGISTERED_TESTS = \d+;/,
  `const MIN_TOTAL_REGISTERED_TESTS = ${nextTotal};`,
);

fs.writeFileSync(targetPath, source);
console.log(`Updated test guard floors (${files.length} files, total registered ${totalRegistered}, floor ${nextTotal}).`);
