"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readOriginMainFloors, listMainTestFiles } = require("./lib/origin-main-test-floors");
const {
  MIN_REGISTERED_TESTS_BY_FILE,
  MIN_TOTAL_REGISTERED_TESTS,
} = require("./lib/test-guard-floors");

const testsDir = process.env.SOLON_TESTS_DIR
  ? path.resolve(process.env.SOLON_TESTS_DIR)
  : path.join(__dirname, "..", "tests");

/**
 * @param {string} source
 * @returns {string}
 */
const stripJavaScriptComments = (source) => {
  let out = "";
  let i = 0;
  const len = source.length;
  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < len && source[i] !== "\n") {
        i += 1;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < len - 1 && !(source[i] === "*" && source[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < len) {
        const character = source[i];
        out += character;
        i += 1;
        if (character === "\\" && i < len) {
          out += source[i];
          i += 1;
          continue;
        }
        if (character === quote) {
          break;
        }
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
};

/**
 * Static test()/it() call sites after comment stripping (guards comment/string false positives).
 * @param {string} source
 * @returns {number}
 */
const countDeclaredTests = (source) => {
  const stripped = stripJavaScriptComments(source);
  const re = /(?<![.\w])(?:test|it)(?:\.(?:only|skip|todo|concurrent))?\s*\(/gu;
  const matches = stripped.match(re);
  return matches ? matches.length : 0;
};

/**
 * Passed tests reported by node:test TAP for a single file (fail-closed; skips/todos excluded).
 * @param {string} filePath
 * @returns {number}
 */
const countRegisteredTests = (filePath) => {
  const cliPath = path.join(__dirname, "count-registered-tests-cli.js");
  const env = { ...process.env };
  const preserveNodeOptions = path.basename(filePath) === "gtag-browser.test.js";
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST")) {
      delete env[key];
    }
    if (key === "NODE_OPTIONS" && !preserveNodeOptions) {
      delete env[key];
    }
  }
  const result = spawnSync(process.execPath, [cliPath, filePath], {
    encoding: "utf8",
    env,
  });
  if (result.status !== 0) {
    throw new Error(
      `could not read registered test count for ${path.basename(filePath)}: ${result.stderr || result.stdout}`,
    );
  }
  const count = Number(String(result.stdout).trim());
  if (!Number.isFinite(count)) {
    throw new Error(`invalid registered test count for ${path.basename(filePath)}`);
  }
  return count;
};

const DEFAULT_MIN_REGISTERED_TESTS = 1;

/**
 * Ensure every tests/*.test.js file is non-empty and registers enough node:test cases.
 * @returns {void}
 */
// skipcq: JS-R1005 -- single guard entrypoint; splitting would duplicate floor wiring
const runAssertTestFiles = function runAssertTestFiles() {
  const files = fs
    .readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.js"))
    .sort();

  let totalRegistered = 0;
  /** @type {string[]} */
  const errors = [];

  const skipMainFloorGuard =
    Boolean(process.env.SOLON_TESTS_DIR) && process.env.SOLON_FORCE_MAIN_FLOOR_GUARD !== "1";

  /** @type {{ byFile: Record<string, number>, total: number } | null} */
  let mainFloors = null;
  /** @type {string[]} */
  let mainTestFiles = [];
  if (!skipMainFloorGuard) {
    try {
      mainFloors = readOriginMainFloors();
      mainTestFiles = listMainTestFiles();
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (mainTestFiles.length > 0) {
    const localNames = new Set(files);
    for (const name of mainTestFiles) {
      if (!localNames.has(name)) {
        errors.push(`${name} exists on main but is missing from tests/`);
      }
    }
  }

  for (const name of files) {
    const filePath = path.join(testsDir, name);
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      errors.push(`${name} is empty (0 bytes)`);
      continue;
    }
    const source = fs.readFileSync(filePath, "utf8");
    const declared = countDeclaredTests(source);
    if (declared < 1) {
      errors.push(`${name} has no declared test()/it() calls after stripping comments`);
    }
    let registered = 0;
    try {
      registered = countRegisteredTests(filePath);
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
      continue;
    }
    totalRegistered += registered;
    if (registered < 1) {
      errors.push(`${name} passed 0 node:test cases`);
    }
    const required = MIN_REGISTERED_TESTS_BY_FILE[name] ?? DEFAULT_MIN_REGISTERED_TESTS;
    if (registered < required) {
      errors.push(`${name} passed test count ${registered} is below floor ${required}`);
    }
    if (mainFloors) {
      const mainFloor = mainFloors.byFile[name] ?? 0;
      if (required < mainFloor) {
        errors.push(`${name} committed floor ${required} is below origin/main ${mainFloor}`);
      }
      if (registered < mainFloor) {
        errors.push(`${name} passed test count ${registered} is below origin/main floor ${mainFloor}`);
      }
    }
  }

  const minTotal = skipMainFloorGuard ? 0 : MIN_TOTAL_REGISTERED_TESTS;
  if (totalRegistered < minTotal) {
    errors.push(`total passed test count ${totalRegistered} is below floor ${minTotal}`);
  }
  if (mainFloors && minTotal > 0 && MIN_TOTAL_REGISTERED_TESTS < mainFloors.total) {
    errors.push(
      `committed total floor ${MIN_TOTAL_REGISTERED_TESTS} is below origin/main ${mainFloors.total}`,
    );
  }
  if (mainFloors && minTotal > 0 && totalRegistered < mainFloors.total) {
    errors.push(`total passed test count ${totalRegistered} is below origin/main ${mainFloors.total}`);
  }

  if (errors.length > 0) {
    for (const message of errors) {
      console.error(`::error::assert-test-files: ${message}`);
    }
    throw new Error(`assert-test-files failed (${errors.length} issue(s))`);
  }
};

module.exports = {
  countDeclaredTests,
  countRegisteredTests,
  stripJavaScriptComments,
  runAssertTestFiles,
  MIN_REGISTERED_TESTS_BY_FILE,
  MIN_TOTAL_REGISTERED_TESTS,
};

if (require.main === module) {
  runAssertTestFiles();
}
