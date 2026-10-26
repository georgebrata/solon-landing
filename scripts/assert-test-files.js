"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readOriginMainFloors } = require("./lib/origin-main-test-floors");

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
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST") || key === "NODE_OPTIONS") {
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

/** Minimum passed tests per file (raise via scripts/update-assert-test-floors.js only). */
const MIN_REGISTERED_TESTS_BY_FILE = {
  "append-blog-google-sheets.test.js": 8,
  "apps-script-brevo.test.js": 21,
  "assert-test-files.test.js": 11,
  "blog-schema.test.js": 3,
  "brevo-tracker.test.js": 7,
  "consent.test.js": 57,
  "error-log.test.js": 5,
  "error-pages.test.js": 12,
  "forms.test.js": 35,
  "ga-measurement-id.test.js": 4,
  "gtag-browser.test.js": 6,
  "gtag-datalayer.test.js": 2,
  "html-integrity.test.js": 4,
  "html-validate.test.js": 11,
  "humanize.test.js": 4,
  "indexnow.test.js": 18,
  "json-ld-injection.test.js": 17,
  "jsonld.test.js": 2,
  "legal-content-guard.test.js": 3,
  "meta-pixel-privacy.test.js": 4,
  "partners.test.js": 4,
  "price-toggle.test.js": 3,
  "pricing.test.js": 26,
  "shortlinks-hit.test.js": 2,
  "shortlinks.test.js": 24,
  "sitemap.test.js": 7,
  "stamp-asset-refs.test.js": 6,
  "support-chat.test.js": 5,
  "tracking-snippets.test.js": 7,
  "tracking.test.js": 17,
  "turnstile-gate.test.js": 3,
  "unsubscribe-privacy.test.js": 5,
};

const DEFAULT_MIN_REGISTERED_TESTS = 1;

const MIN_TOTAL_REGISTERED_TESTS = 343;

/**
 * Ensure every tests/*.test.js file is non-empty and registers enough node:test cases.
 * @returns {void}
 */
const runAssertTestFiles = function runAssertTestFiles() {
  const files = fs
    .readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.js"))
    .sort();

  let totalRegistered = 0;
  /** @type {string[]} */
  const errors = [];

  /** @type {{ byFile: Record<string, number>, total: number } | null} */
  let mainFloors = null;
  if (!process.env.SOLON_TESTS_DIR) {
    try {
      mainFloors = readOriginMainFloors();
    } catch (error) {
      errors.push(error.message);
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

  const minTotal = process.env.SOLON_TESTS_DIR ? 0 : MIN_TOTAL_REGISTERED_TESTS;
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
