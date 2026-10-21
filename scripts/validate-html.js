"use strict";

/**
 * Validate every served HTML page with html-validate:recommended.
 *
 * The two rules turned off in .htmlvalidate.json were already off in CI.
 * Do not add further disables. Pages that still fail for a content or design
 * reason are listed with an exact count in data/html-validate-baseline.json.
 * A new error fails the run. A baselined error that disappeared fails the run
 * until the count is lowered, so the allowlist cannot grow slack.
 *
 * studii-de-caz/avocat-dumitrescu-alexandru/index.html is excluded while PR #94
 * edits that page. Remove the exclusion after it merges.
 */

const fs = require("node:fs");
const path = require("node:path");
const { HtmlValidate } = require("html-validate");

const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, ".htmlvalidate.json");
const BASELINE_PATH = path.join(ROOT, "data", "html-validate-baseline.json");

const SKIP_DIR_NAMES = new Set([".git", "node_modules", "templates"]);
const HISTORICAL_OFF_RULES = new Set(["no-trailing-whitespace", "void-style"]);

/**
 * @param {string} rel Posix path relative to the repo root.
 * @param {{ excludedFiles?: { file: string }[] }} baseline
 * @returns {boolean}
 */
const shouldValidate = (rel, baseline) => {
  const normalized = rel.split(path.sep).join("/");
  if (!normalized.endsWith(".html")) return false;
  const parts = normalized.split("/");
  if (parts.some((part) => SKIP_DIR_NAMES.has(part))) return false;
  if (parts[0] === "assets" && parts[1] === "vendor") return false;
  const excluded = new Set((baseline.excludedFiles || []).map((entry) => entry.file));
  return !excluded.has(normalized);
};

/**
 * @param {string} root
 * @param {{ excludedFiles?: { file: string }[] }} baseline
 * @returns {string[]}
 */
const collectServedHtml = (root, baseline) => {
  /** @type {string[]} */
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (dir === root && SKIP_DIR_NAMES.has(name)) continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (name === "vendor" && path.basename(dir) === "assets") continue;
        walk(full);
        continue;
      }
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (shouldValidate(rel, baseline)) files.push(full);
    }
  };
  walk(root);
  return files.sort();
};

/**
 * @param {object} config
 * @returns {string[]}
 */
const assertConfig = (config) => {
  /** @type {string[]} */
  const problems = [];
  const extended = Array.isArray(config.extends) ? config.extends : [];
  if (!extended.includes("html-validate:recommended")) {
    problems.push("config must extend html-validate:recommended");
  }
  const rules = config.rules || {};
  for (const [rule, value] of Object.entries(rules)) {
    const severity = Array.isArray(value) ? value[0] : value;
    const off = severity === "off" || severity === 0;
    if (off && !HISTORICAL_OFF_RULES.has(rule)) {
      problems.push(`config disables ${rule}; do not weaken html-validate rules`);
    }
  }
  for (const rule of HISTORICAL_OFF_RULES) {
    if (!(rule in rules)) {
      problems.push(`config is missing the historical exception for ${rule}`);
    }
  }
  return problems;
};

/**
 * @param {Record<string, Record<string, number>>} actual
 * @param {{ files?: Record<string, Record<string, number>>, excludedFiles?: { file: string, reason?: string }[], rules?: Record<string, string> }} baseline
 * @returns {{ kind: string, file: string, rule: string, got: number, allowed: number }[]}
 */
const diffBaseline = (actual, baseline) => {
  /** @type {{ kind: string, file: string, rule: string, got: number, allowed: number }[]} */
  const problems = [];
  const allowed = baseline.files || {};
  const seen = new Set();

  for (const [file, rules] of Object.entries(actual)) {
    for (const [rule, count] of Object.entries(rules)) {
      seen.add(`${file}\0${rule}`);
      const allowedCount = allowed[file] && allowed[file][rule];
      if (allowedCount === undefined) {
        problems.push({ kind: "unexpected", file, rule, got: count, allowed: 0 });
      } else if (count !== allowedCount) {
        problems.push({
          kind: count > allowedCount ? "regression" : "stale",
          file,
          rule,
          got: count,
          allowed: allowedCount,
        });
      }
    }
  }

  for (const [file, rules] of Object.entries(allowed)) {
    for (const [rule, count] of Object.entries(rules)) {
      if (!seen.has(`${file}\0${rule}`)) {
        problems.push({ kind: "stale", file, rule, got: 0, allowed: count });
      }
    }
  }

  return problems.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
};

/**
 * @param {string} root
 * @returns {object}
 */
const loadJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

/**
 * @param {object} baseline
 * @param {string} root
 * @returns {string[]}
 */
const assertBaselineShape = (baseline, root) => {
  /** @type {string[]} */
  const problems = [];
  const documented = baseline.rules || {};
  const files = baseline.files || {};
  const excluded = baseline.excludedFiles || [];

  if (!Array.isArray(excluded) || excluded.length === 0) {
    problems.push("baseline is missing excludedFiles");
  }

  for (const entry of excluded) {
    if (!entry.file || !entry.reason) {
      problems.push("each excluded file needs a file path and a reason");
      continue;
    }
    if (!fs.existsSync(path.join(root, entry.file))) {
      problems.push(`excluded file does not exist: ${entry.file}`);
    }
    if (files[entry.file]) {
      problems.push(`excluded file is also baselined: ${entry.file}`);
    }
  }

  for (const [file, rules] of Object.entries(files)) {
    for (const rule of Object.keys(rules)) {
      if (!documented[rule]) {
        problems.push(`baseline count for ${rule} in ${file} has no documented reason`);
      }
    }
  }

  return problems;
};

/**
 * @param {string[]} files
 * @param {string} root
 * @returns {string[]}
 */
const findDisableComments = (files, root) => {
  /** @type {string[]} */
  const problems = [];
  for (const file of files) {
    const html = fs.readFileSync(file, "utf8");
    if (html.includes("html-validate-disable")) {
      problems.push(`${path.relative(root, file).split(path.sep).join("/")} contains html-validate-disable`);
    }
  }
  return problems;
};

/**
 * @param {string} [root]
 * @returns {Promise<{ files: string[], actual: Record<string, Record<string, number>>, baseline: object, problems: object[] }>}
 */
const validateServedHtml = async (root = ROOT) => {
  const config = loadJson(path.join(root, ".htmlvalidate.json"));
  config.root = true;
  const baseline = loadJson(path.join(root, "data", "html-validate-baseline.json"));
  const htmlvalidate = new HtmlValidate(config);
  const files = collectServedHtml(root, baseline);
  const report = await htmlvalidate.validateMultipleFiles(files);
  /** @type {Record<string, Record<string, number>>} */
  const actual = {};

  for (const result of report.results) {
    const rel = path.relative(root, result.filePath).split(path.sep).join("/");
    for (const message of result.messages) {
      if (message.severity !== 2) continue;
      if (!actual[rel]) actual[rel] = {};
      actual[rel][message.ruleId] = (actual[rel][message.ruleId] || 0) + 1;
    }
  }

  const problems = [
    ...assertConfig(config).map((message) => ({ kind: "config", message })),
    ...assertBaselineShape(baseline, root).map((message) => ({ kind: "baseline", message })),
    ...findDisableComments(files, root).map((message) => ({ kind: "disable", message })),
    ...diffBaseline(actual, baseline),
  ];

  return { files, actual, baseline, problems };
};

/**
 * @param {object[]} problems
 * @returns {void}
 */
const printProblems = (problems) => {
  for (const problem of problems) {
    if (problem.file) {
      console.error(
        `${problem.kind} ${problem.file} ${problem.rule} (got ${problem.got}, allowed ${problem.allowed})`
      );
    } else {
      console.error(`${problem.kind} ${problem.message}`);
    }
  }
};

const main = async () => {
  const { files, problems, baseline } = await validateServedHtml(ROOT);
  if (problems.length > 0) {
    console.error(`HTML validation failed (${files.length} served files).`);
    printProblems(problems);
    process.exit(1);
  }
  const baselined = Object.values(baseline.files).reduce(
    (sum, rules) => sum + Object.values(rules).reduce((inner, count) => inner + count, 0),
    0
  );
  console.log(
    `HTML validation passed (${files.length} served files, ${baselined} baselined errors, ${baseline.excludedFiles.length} excluded file).`
  );
};

module.exports = {
  BASELINE_PATH,
  CONFIG_PATH,
  HISTORICAL_OFF_RULES,
  ROOT,
  assertBaselineShape,
  assertConfig,
  collectServedHtml,
  diffBaseline,
  shouldValidate,
  validateServedHtml,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
