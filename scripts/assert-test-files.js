"use strict";

const fs = require("node:fs");
const path = require("node:path");

const testsDir = process.env.SOLON_TESTS_DIR
  ? path.resolve(process.env.SOLON_TESTS_DIR)
  : path.join(__dirname, "..", "tests");

/** Minimum number of `test(` declarations per file (empty or stub files must not pass). */
const MIN_TEST_DECLARATIONS = {
  "consent.test.js": 45,
};

const DEFAULT_MIN_TEST_DECLARATIONS = 1;

/** Minimum total `test(` declarations across tests/*.test.js (guards accidental mass deletion). */
const MIN_TOTAL_TEST_DECLARATIONS = 280;

const files = fs
  .readdirSync(testsDir)
  .filter((name) => name.endsWith(".test.js"))
  .sort();

let totalDeclarations = 0;
/** @type {string[]} */
const errors = [];

for (const name of files) {
  const filePath = path.join(testsDir, name);
  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    errors.push(`${name} is empty (0 bytes)`);
    continue;
  }
  const source = fs.readFileSync(filePath, "utf8");
  const matches = source.match(/\btest\s*\(/g);
  const count = matches ? matches.length : 0;
  totalDeclarations += count;
  const required = MIN_TEST_DECLARATIONS[name] ?? DEFAULT_MIN_TEST_DECLARATIONS;
  if (count < required) {
    errors.push(`${name} has ${count} test() declarations (minimum ${required})`);
  }
}

const minTotal =
  process.env.SOLON_TESTS_DIR ? 0 : MIN_TOTAL_TEST_DECLARATIONS;
if (totalDeclarations < minTotal) {
  errors.push(
    `total test() declarations ${totalDeclarations} is below floor ${minTotal}`,
  );
}

if (errors.length > 0) {
  for (const message of errors) {
    console.error(`::error::assert-test-files: ${message}`);
  }
  throw new Error(`assert-test-files failed (${errors.length} issue(s))`);
}
