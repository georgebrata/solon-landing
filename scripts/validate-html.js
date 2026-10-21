"use strict";

/**
 * Validate every served HTML page with html-validate:recommended.
 *
 * The two rules turned off in .htmlvalidate.json were already off in CI.
 * Do not add further disables. Pages that still fail for a content or design
 * reason are listed in data/html-validate-baseline.json. That file is a ceiling:
 * a page that gains errors fails, and a page that is not listed fails as soon
 * as it has any error. A lower count does not fail. Shrink the ceiling with
 * `node scripts/validate-html.js --shrink`, which only lowers or drops counts
 * and refuses to add a file or raise a number. Once the file exists on main,
 * a pull request that raises an allowance fails the same check.
 *
 * studii-de-caz/avocat-dumitrescu-alexandru/index.html is excluded while PR #94
 * edits that page. Remove the exclusion after it merges.
 */

const { execFileSync } = require("node:child_process");
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
  /**
   * @param {string} dir
   * @returns {void}
   */
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
 * Ceiling check. Counts above the baseline and errors on a page that has no
 * allowance fail. Counts below the baseline are shrinkable and do not fail.
 *
 * @param {Record<string, Record<string, number>>} actual
 * @param {{ files?: Record<string, Record<string, number>> }} baseline
 * @returns {{ problems: { kind: string, file: string, rule: string, got: number, allowed: number }[], shrinkable: { file: string, rule: string, got: number, allowed: number }[] }}
 */
const diffBaseline = (actual, baseline) => {
  /** @type {{ kind: string, file: string, rule: string, got: number, allowed: number }[]} */
  const problems = [];
  /** @type {{ file: string, rule: string, got: number, allowed: number }[]} */
  const shrinkable = [];
  const allowed = baseline.files || {};
  const seen = new Set();

  for (const [file, rules] of Object.entries(actual)) {
    for (const [rule, count] of Object.entries(rules)) {
      seen.add(`${file}\0${rule}`);
      const allowedCount = allowed[file]?.[rule];
      if (allowedCount === undefined) {
        problems.push({ kind: "unexpected", file, rule, got: count, allowed: 0 });
      } else if (count > allowedCount) {
        problems.push({ kind: "regression", file, rule, got: count, allowed: allowedCount });
      } else if (count < allowedCount) {
        shrinkable.push({ file, rule, got: count, allowed: allowedCount });
      }
    }
  }

  for (const [file, rules] of Object.entries(allowed)) {
    for (const [rule, count] of Object.entries(rules)) {
      if (!seen.has(`${file}\0${rule}`)) {
        shrinkable.push({ file, rule, got: 0, allowed: count });
      }
    }
  }

  /**
   * @param {{ file: string, rule: string }} left
   * @param {{ file: string, rule: string }} right
   * @returns {number}
   */
  const byFile = (left, right) => left.file.localeCompare(right.file) || left.rule.localeCompare(right.rule);
  problems.sort(byFile);
  shrinkable.sort(byFile);
  return { problems, shrinkable };
};

/**
 * Compare a proposed baseline with the one on main. Allowances may fall or
 * disappear. A higher count, or a file/rule that main does not list, fails.
 *
 * @param {{ files?: Record<string, Record<string, number>> } | null} previous
 * @param {{ files?: Record<string, Record<string, number>> }} current
 * @returns {{ kind: string, file: string, rule: string, got: number, allowed: number }[]}
 */
const assertRatchet = (previous, current) => {
  if (!previous) return [];
  /** @type {{ kind: string, file: string, rule: string, got: number, allowed: number }[]} */
  const problems = [];
  const prevFiles = previous.files || {};
  for (const [file, rules] of Object.entries(current.files || {})) {
    for (const [rule, count] of Object.entries(rules)) {
      const prev = prevFiles[file]?.[rule];
      if (prev === undefined) {
        problems.push({ kind: "ratchet", file, rule, got: count, allowed: 0 });
      } else if (count > prev) {
        problems.push({ kind: "ratchet", file, rule, got: count, allowed: prev });
      }
    }
  }
  return problems.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
};

/**
 * Lower baseline counts to the current page. Refuses when that would hide a
 * new or larger error.
 *
 * @param {object} baseline
 * @param {Record<string, Record<string, number>>} actual
 * @returns {{ problems: object[], shrinkable: object[], next: object | null }}
 */
const applyShrink = (baseline, actual) => {
  const { problems, shrinkable } = diffBaseline(actual, baseline);
  if (problems.length > 0) return { problems, shrinkable, next: null };

  /** @type {Record<string, Record<string, number>>} */
  const files = {};
  for (const file of Object.keys(baseline.files || {}).sort()) {
    /** @type {Record<string, number>} */
    const nextRules = {};
    for (const rule of Object.keys(baseline.files[file]).sort()) {
      const got = actual[file]?.[rule];
      const nextCount = got === undefined ? 0 : got;
      if (nextCount > 0) nextRules[rule] = nextCount;
    }
    if (Object.keys(nextRules).length > 0) files[file] = nextRules;
  }

  return { problems, shrinkable, next: { ...baseline, files } };
};

/**
 * Baseline committed on origin/main, or null when that file is not there yet.
 * @param {string} root
 * @returns {object | null}
 */
const loadPreviousBaseline = (root) => {
  try {
    const text = execFileSync("git", ["show", "origin/main:data/html-validate-baseline.json"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(text);
  } catch {
    return null;
  }
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

  const diff = diffBaseline(actual, baseline);
  const problems = [
    ...assertConfig(config).map((message) => ({ kind: "config", message })),
    ...assertBaselineShape(baseline, root).map((message) => ({ kind: "baseline", message })),
    ...findDisableComments(files, root).map((message) => ({ kind: "disable", message })),
    ...diff.problems,
    ...assertRatchet(loadPreviousBaseline(root), baseline),
  ];

  return { files, actual, baseline, problems, shrinkable: diff.shrinkable };
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

/**
 * @param {{ files?: Record<string, Record<string, number>> }} baseline
 * @returns {number}
 */
const countAllowances = (baseline) => Object.values(baseline.files || {}).reduce(
  (sum, rules) => sum + Object.values(rules).reduce((inner, count) => inner + count, 0),
  0
);

class HtmlValidationError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "HtmlValidationError";
  }
}

/**
 * @param {string} headline
 * @param {object[]} problems
 * @returns {never}
 */
const failValidation = (headline, problems) => {
  console.error(headline);
  printProblems(problems);
  throw new HtmlValidationError(headline);
};

/**
 * Scan served pages and exit through the process status when this file is the program.
 * @returns {Promise<void>}
 */
const main = async () => {
  const shrink = process.argv.includes("--shrink");
  const { files, problems, baseline, actual, shrinkable } = await validateServedHtml(ROOT);
  if (problems.length > 0) {
    failValidation(`HTML validation failed (${files.length} served files).`, problems);
  }

  if (shrink) {
    const applied = applyShrink(baseline, actual);
    if (!applied.next) {
      failValidation("Refusing to shrink.", applied.problems);
    }
    const ratchetProblems = assertRatchet(loadPreviousBaseline(ROOT), applied.next);
    if (ratchetProblems.length > 0) {
      failValidation("Refusing to shrink: the result would allow more than origin/main.", ratchetProblems);
    }
    if (!applied.shrinkable.length) {
      console.log("Baseline is already tight.");
      return;
    }
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(applied.next, null, 2)}\n`);
    for (const item of applied.shrinkable) {
      console.log(`shrunk ${item.file} ${item.rule} ${item.allowed} -> ${item.got}`);
    }
    console.log(`Baseline shrunk to ${countAllowances(applied.next)} errors.`);
    return;
  }

  const baselined = countAllowances(baseline);
  console.log(
    `HTML validation passed (${files.length} served files, ${baselined} baselined errors, ${baseline.excludedFiles.length} excluded file).`
  );
  if (shrinkable.length > 0) {
    console.log(
      `${shrinkable.length} allowance(s) are above the current pages. Run \`node scripts/validate-html.js --shrink\` to lower them.`
    );
  }
};

module.exports = {
  BASELINE_PATH,
  CONFIG_PATH,
  HISTORICAL_OFF_RULES,
  ROOT,
  applyShrink,
  assertBaselineShape,
  assertConfig,
  assertRatchet,
  collectServedHtml,
  diffBaseline,
  shouldValidate,
  validateServedHtml,
};

if (require.main === module) {
  main().catch((error) => {
    if (!(error instanceof HtmlValidationError)) console.error(error);
    process.exitCode = 1;
  });
}
