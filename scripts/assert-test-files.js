"use strict";

const fs = require("node:fs");
const path = require("node:path");

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
 * @param {string} source
 * @returns {number}
 */
const countDeclaredTests = (source) => {
  const stripped = stripJavaScriptComments(source);
  const re = /(?<![.\w])(?:test|it)(?:\.(?:only|skip|todo|concurrent))?\s*\(/gu;
  const matches = stripped.match(re);
  return matches ? matches.length : 0;
};

/** Minimum declared test()/it() calls per file (ab3c8693 + this branch). */
const MIN_DECLARED_TESTS_BY_FILE = {
  "append-blog-google-sheets.test.js": 8,
  "apps-script-brevo.test.js": 21,
  "assert-test-files.test.js": 5,
  "blog-schema.test.js": 3,
  "brevo-tracker.test.js": 7,
  "consent.test.js": 53,
  "error-log.test.js": 5,
  "error-pages.test.js": 8,
  "forms.test.js": 31,
  "ga-measurement-id.test.js": 4,
  "gtag-browser.test.js": 3,
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
  "shortlinks.test.js": 16,
  "sitemap.test.js": 7,
  "stamp-asset-refs.test.js": 6,
  "support-chat.test.js": 5,
  "tracking-snippets.test.js": 7,
  "tracking.test.js": 17,
  "turnstile-gate.test.js": 3,
  "unsubscribe-privacy.test.js": 5,
};

const DEFAULT_MIN_DECLARED_TESTS = 1;

const MIN_TOTAL_DECLARED_TESTS = 318;

/**
 * Ensure every tests/*.test.js file is non-empty and declares enough test()/it() calls.
 * @returns {void}
 */
const runAssertTestFiles = function runAssertTestFiles() {
  const files = fs
    .readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.js"))
    .sort();

  let totalDeclared = 0;
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
    const declared = countDeclaredTests(source);
    totalDeclared += declared;
    if (declared < 1) {
      errors.push(`${name} has no declared test()/it() calls after stripping comments`);
    }
    const required = MIN_DECLARED_TESTS_BY_FILE[name] ?? DEFAULT_MIN_DECLARED_TESTS;
    if (declared < required) {
      errors.push(`${name} declared test count ${declared} is below floor ${required}`);
    }
  }

  const minTotal = process.env.SOLON_TESTS_DIR ? 0 : MIN_TOTAL_DECLARED_TESTS;
  if (totalDeclared < minTotal) {
    errors.push(`total declared test count ${totalDeclared} is below floor ${minTotal}`);
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
  stripJavaScriptComments,
  runAssertTestFiles,
};

if (require.main === module) {
  runAssertTestFiles();
}
