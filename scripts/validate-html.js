"use strict";

/**
 * Validate every served HTML page with html-validate:recommended.
 *
 * The two rules turned off in .htmlvalidate.json were already off in CI.
 * Do not add further disables. Recommended rules stay at error with their
 * default options. A rule set to warn, turned off, or given looser options
 * fails. Warnings (severity 1 and above) count.
 *
 * Pages that still fail for a content or design reason are listed in
 * data/html-validate-baseline.json, one occurrence id per finding. A page that
 * gains an occurrence fails, and a page that is not listed fails as soon as it
 * has any finding. A fixed finding does not free a slot for a different one:
 * leftover allowances fail the run. Shrink them with
 * `node scripts/validate-html.js --shrink`, which only drops occurrences and
 * refuses to add one or raise a count.
 *
 * Once the baseline exists on origin/main, a pull request that raises an
 * allowance, adds an excluded file, or loosens .htmlvalidate.json fails the
 * same check. excludedFiles may be an empty list. A missing origin/main ref
 * fails the CI script (`npm run validate:html` with CI set). `npm test` does
 * not fetch main and does not enforce that ref, so the suite still runs; the
 * ratchet applies whenever the ref is present.
 *
 * studii-de-caz/avocat-dumitrescu-alexandru/index.html is excluded while PR #94
 * edits that page. Remove the exclusion after it merges and fix whatever is
 * left. Do not baseline that page.
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
const CANONICAL_CONFIG = {
  extends: ["html-validate:recommended"],
  rules: {
    "no-trailing-whitespace": "off",
    "void-style": "off",
  },
};

let warnedMissingRef = false;

class HtmlValidationError extends Error {
  /**
   * @param {string} message
   * @param {{ reported?: boolean }} [options] Set reported when the message is already printed.
   */
  constructor(message, options = {}) {
    super(message);
    this.name = "HtmlValidationError";
    this.reported = options.reported === true;
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

/**
 * @param {Map<string, [number, object]> | Record<string, [number, object]> | null | undefined} rules
 * @returns {Map<string, [number, object]>}
 */
const asRuleMap = (rules) => {
  if (!rules) return new Map();
  if (rules instanceof Map) return rules;
  return new Map(Object.entries(rules));
};

/**
 * @param {object} config
 * @param {string} root
 * @returns {Promise<Map<string, [number, object]>>}
 */
const resolvedRuleMap = async (config, root) => {
  const htmlvalidate = new HtmlValidate({ ...config, root: true });
  const resolved = await htmlvalidate.getConfigFor(path.join(root, "index.html"));
  return new Map(resolved.rules);
};

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
 * Tracked HTML only. Untracked files, including local Lighthouse reports, are not scanned.
 * @param {string} root
 * @param {{ excludedFiles?: { file: string }[] }} baseline
 * @returns {string[]}
 */
const collectServedHtml = (root, baseline) => {
  const listed = execFileSync("git", ["ls-files", "-z", "--", "*.html"], {
    cwd: root,
    encoding: "utf8",
  });
  return listed
    .split("\0")
    .filter(Boolean)
    .filter((rel) => shouldValidate(rel, baseline))
    .map((rel) => path.join(root, rel))
    .sort();
};

/**
 * @param {string} stderr
 * @returns {"missing-path" | "missing-ref" | "error"}
 */
const classifyGitShowError = (stderr) => {
  if (/exists on disk, but not in '|does not exist in '/.test(stderr)) return "missing-path";
  if (/invalid object name|bad revision|ambiguous argument/.test(stderr)) return "missing-ref";
  return "error";
};

/**
 * Read a git object. Null means the path is not on that ref, or the ref is
 * absent and this run is allowed to skip the ratchet. Other failures throw.
 * @param {string} root
 * @param {string} spec `git show` object, such as origin/main:path.
 * @param {boolean} enforceMain When true, a missing ref is a hard failure.
 * @returns {string | null}
 */
const loadGitText = (root, spec, enforceMain) => {
  try {
    return execFileSync("git", ["show", spec], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr = String(error.stderr || error.message || "");
    const reason = classifyGitShowError(stderr);
    if (reason === "missing-path") return null;
    if (reason === "missing-ref" && !enforceMain) {
      if (!warnedMissingRef) {
        warnedMissingRef = true;
        console.warn(
          "Skipping the origin/main ratchet because that ref is not available. Fetch origin/main locally (git fetch origin main) before npm run validate:html, or rely on CI workflows that fetch it before npm test / validate:html."
        );
      }
      return null;
    }
    if (reason === "missing-ref") {
      throw new HtmlValidationError(
        `Could not read ${spec}. CI must fetch origin/main before HTML validation.`
      );
    }
    throw error;
  }
};

/**
 * @param {string} root
 * @param {boolean} enforceMain
 * @returns {object | null}
 */
const loadPreviousBaseline = (root, enforceMain) => {
  const text = loadGitText(root, "origin/main:data/html-validate-baseline.json", enforceMain);
  if (text === null) return null;
  return JSON.parse(text);
};

/**
 * @param {string} root
 * @param {boolean} enforceMain
 * @returns {Promise<Map<string, [number, object]> | null>}
 */
const loadPreviousConfig = async (root, enforceMain) => {
  const text = loadGitText(root, "origin/main:.htmlvalidate.json", enforceMain);
  if (text === null) return null;
  return await resolvedRuleMap(JSON.parse(text), root);
};

/**
 * @param {object} config
 * @param {string} [root]
 * @returns {Promise<string[]>}
 */
const assertConfig = async (config, root = ROOT) => {
  const extended = Array.isArray(config.extends) ? config.extends : [];
  if (!extended.includes("html-validate:recommended")) {
    return ["config must extend html-validate:recommended"];
  }

  const expected = await resolvedRuleMap(CANONICAL_CONFIG, root);
  const actual = await resolvedRuleMap(config, root);
  /** @type {string[]} */
  const problems = [];
  const ids = [...new Set([...expected.keys(), ...actual.keys()])].sort();
  for (const id of ids) {
    const exp = expected.get(id);
    const got = actual.get(id);
    if (!exp) {
      problems.push(`config adds ${id}; do not weaken html-validate rules`);
      continue;
    }
    if (!got) {
      problems.push(`config drops ${id}; do not weaken html-validate rules`);
      continue;
    }
    if (HISTORICAL_OFF_RULES.has(id)) {
      if (got[0] !== 0) problems.push(`config is missing the historical exception for ${id}`);
      continue;
    }
    if (got[0] < exp[0]) {
      const how = got[0] === 0 ? "disables" : "sets to warn";
      problems.push(`config ${how} ${id}; do not weaken html-validate rules`);
    } else if (got[0] !== exp[0] || canonicalJson(got[1]) !== canonicalJson(exp[1])) {
      problems.push(`config changes ${id} options away from the recommended defaults`);
    }
  }
  return problems;
};

/**
 * Fail when the resolved config is looser than origin/main.
 * @param {Map<string, [number, object]> | Record<string, [number, object]> | null} previous
 * @param {Map<string, [number, object]> | Record<string, [number, object]>} current
 * @returns {{ kind: string, message: string }[]}
 */
const assertConfigRatchet = (previous, current) => {
  if (!previous) return [];
  const prev = asRuleMap(previous);
  const curr = asRuleMap(current);
  /** @type {{ kind: string, message: string }[]} */
  const problems = [];
  const ids = [...new Set([...prev.keys(), ...curr.keys()])].sort();
  for (const id of ids) {
    const before = prev.get(id) || [2, {}];
    const after = curr.get(id) || [2, {}];
    if (after[0] < before[0]) {
      problems.push({ kind: "ratchet", message: `config weakens ${id} compared with origin/main` });
    }
    if (canonicalJson(after[1]) !== canonicalJson(before[1])) {
      problems.push({
        kind: "ratchet",
        message: `config changes ${id} options compared with origin/main`,
      });
    }
  }
  return problems;
};

/**
 * @param {{ file: string, rule: string }} left
 * @param {{ file: string, rule: string }} right
 * @returns {number}
 */
const byFile = (left, right) => left.file.localeCompare(right.file) || left.rule.localeCompare(right.rule);

/**
 * @param {string[]} ids
 * @returns {Map<string, number>}
 */
const tally = (ids) => {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const id of ids || []) counts.set(id, (counts.get(id) || 0) + 1);
  return counts;
};

/**
 * @param {unknown} value
 * @returns {string[]}
 */
const asOccurrenceList = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);

/**
 * Occurrence check. An id above its allowance, or an id the baseline does not
 * list, fails. An allowance with no matching finding is leftover and does not
 * free a slot for a different id.
 *
 * @param {Record<string, Record<string, string[]>>} actual
 * @param {{ files?: Record<string, Record<string, string[]>> }} baseline
 * @returns {{ problems: { kind: string, file: string, rule: string, got: number, allowed: number }[], shrinkable: { file: string, rule: string, got: number, allowed: number }[] }}
 */
const diffBaseline = (actual, baseline) => {
  /** @type {{ kind: string, file: string, rule: string, got: number, allowed: number }[]} */
  const problems = [];
  /** @type {{ file: string, rule: string, got: number, allowed: number }[]} */
  const shrinkable = [];
  const allowed = baseline.files || {};
  /** @type {Set<string>} */
  const pairs = new Set();

  for (const file of Object.keys(actual)) pairs.add(file);
  for (const file of Object.keys(allowed)) pairs.add(file);

  for (const file of pairs) {
    /** @type {Set<string>} */
    const rules = new Set([
      ...Object.keys(actual[file] || {}),
      ...Object.keys(allowed[file] || {}),
    ]);
    for (const rule of rules) {
      const got = tally(asOccurrenceList(actual[file]?.[rule]));
      const cap = tally(asOccurrenceList(allowed[file]?.[rule]));
      /** @type {Set<string>} */
      const ids = new Set([...got.keys(), ...cap.keys()]);
      for (const id of ids) {
        const gotCount = got.get(id) || 0;
        const allowedCount = cap.get(id) || 0;
        if (gotCount > allowedCount) {
          problems.push({
            kind: allowedCount === 0 ? "unexpected" : "regression",
            file,
            rule,
            got: gotCount,
            allowed: allowedCount,
          });
        } else if (gotCount < allowedCount) {
          shrinkable.push({ file, rule, got: gotCount, allowed: allowedCount });
        }
      }
    }
  }

  problems.sort(byFile);
  shrinkable.sort(byFile);
  return { problems, shrinkable };
};

/**
 * @param {object[]} problems
 * @param {{ file: string, rule: string, got: number, allowed: number }[]} shrinkable
 * @param {boolean} reportLeftovers
 * @returns {object[]}
 */
const gateProblems = (problems, shrinkable, reportLeftovers) => {
  if (!reportLeftovers) return problems;
  return [
    ...problems,
    ...shrinkable.map((item) => ({ ...item, kind: "leftover" })),
  ];
};

/**
 * Allowances and exclusions may fall. A higher count, a new occurrence, or a
 * new exclusion fails.
 *
 * @param {{ files?: Record<string, Record<string, string[]>>, excludedFiles?: { file: string }[] } | null} previous
 * @param {{ files?: Record<string, Record<string, string[]>>, excludedFiles?: { file: string }[] }} current
 * @returns {{ kind: string, file: string, rule: string, got: number, allowed: number }[]}
 */
const assertRatchet = (previous, current) => {
  if (!previous) return [];
  const raised = diffBaseline(current.files || {}, previous).problems.map((problem) => ({
    ...problem,
    kind: "ratchet",
  }));
  const prevExcluded = new Set((previous.excludedFiles || []).map((entry) => entry.file));
  /** @type {{ kind: string, file: string, rule: string, got: number, allowed: number }[]} */
  const added = [];
  for (const entry of current.excludedFiles || []) {
    if (!prevExcluded.has(entry.file)) {
      added.push({ kind: "ratchet", file: entry.file, rule: "excluded", got: 1, allowed: 0 });
    }
  }
  return [...raised, ...added].sort(byFile);
};

/**
 * Drop leftover occurrences. Refuses when that would hide a new or larger finding.
 * @param {object} baseline
 * @param {Record<string, Record<string, string[]>>} actual
 * @returns {{ problems: object[], shrinkable: object[], next: object | null }}
 */
const applyShrink = (baseline, actual) => {
  const { problems, shrinkable } = diffBaseline(actual, baseline);
  if (problems.length > 0) return { problems, shrinkable, next: null };

  /** @type {Record<string, Record<string, string[]>>} */
  const files = {};
  for (const file of Object.keys(baseline.files || {}).sort()) {
    /** @type {Record<string, string[]>} */
    const nextRules = {};
    for (const rule of Object.keys(baseline.files[file]).sort()) {
      const got = asOccurrenceList(actual[file]?.[rule]);
      if (got.length > 0) nextRules[rule] = [...got].sort();
    }
    if (Object.keys(nextRules).length > 0) files[file] = nextRules;
  }

  /** @type {Record<string, string>} */
  const rules = {};
  const used = new Set(Object.values(files).flatMap((entry) => Object.keys(entry)));
  for (const [rule, reason] of Object.entries(baseline.rules || {})) {
    if (used.has(rule)) rules[rule] = reason;
  }

  return { problems, shrinkable, next: { ...baseline, rules, files } };
};

/**
 * @param {string} filePath
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
  const excluded = baseline.excludedFiles;

  if (!Array.isArray(excluded)) {
    problems.push("baseline is missing excludedFiles");
  }

  for (const entry of excluded || []) {
    if (!entry?.file || !entry?.reason) {
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
    for (const [rule, occurrences] of Object.entries(rules)) {
      if (!Array.isArray(occurrences) || occurrences.some((item) => typeof item !== "string" || item.length === 0)) {
        problems.push(`baseline occurrences for ${rule} in ${file} must be a list of ids`);
      }
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
 * Stable id for one finding. The source slice keeps two findings of the same
 * rule distinct, so fixing one cannot authorize a different one.
 * @param {{ message?: string, selector?: string, offset?: number, size?: number }} message
 * @param {string} source
 * @returns {string}
 */
const occurrenceId = (message, source) => {
  const start = message.offset || 0;
  const size = message.size || 0;
  const slice = source.slice(start, start + size).trim();
  // A one-character highlight, such as long-title's ">", does not identify the
  // finding. Keep that slot on the selector and message. A longer slice, such as
  // a style attribute, stays in the id so a different finding cannot reuse it.
  const detail = slice.length >= 8 ? slice : "";
  const selector = (message.selector || "").replace(/:nth-child\(\d+\)/g, "");
  return `${selector}\n${message.message || ""}\n${detail}`;
};

/**
 * @param {string} [root]
 * @param {{ reportLeftovers?: boolean, enforceMain?: boolean }} [options]
 * @returns {Promise<{ files: string[], actual: Record<string, Record<string, string[]>>, baseline: object, problems: object[], shrinkable: object[] }>}
 */
const validateServedHtml = async (root = ROOT, options = {}) => {
  const reportLeftovers = options.reportLeftovers !== false;
  const enforceMain = options.enforceMain === true;
  const config = loadJson(path.join(root, ".htmlvalidate.json"));
  const baseline = loadJson(path.join(root, "data", "html-validate-baseline.json"));
  const htmlvalidate = new HtmlValidate({ ...config, root: true });
  const files = collectServedHtml(root, baseline);
  const report = await htmlvalidate.validateMultipleFiles(files);
  /** @type {Record<string, Record<string, string[]>>} */
  const actual = {};

  for (const result of report.results) {
    const rel = path.relative(root, result.filePath).split(path.sep).join("/");
    const source = fs.readFileSync(result.filePath, "utf8");
    for (const message of result.messages) {
      if (!(message.severity >= 1)) continue;
      if (!actual[rel]) actual[rel] = {};
      if (!actual[rel][message.ruleId]) actual[rel][message.ruleId] = [];
      actual[rel][message.ruleId].push(occurrenceId(message, source));
    }
  }

  for (const rules of Object.values(actual)) {
    for (const rule of Object.keys(rules)) rules[rule].sort();
  }

  const diff = diffBaseline(actual, baseline);
  const currentRules = await resolvedRuleMap(config, root);
  const problems = gateProblems(
    [
      ...(await assertConfig(config, root)).map((message) => ({ kind: "config", message })),
      ...assertBaselineShape(baseline, root).map((message) => ({ kind: "baseline", message })),
      ...findDisableComments(files, root).map((message) => ({ kind: "disable", message })),
      ...diff.problems,
      ...assertRatchet(loadPreviousBaseline(root, enforceMain), baseline),
      ...assertConfigRatchet(await loadPreviousConfig(root, enforceMain), currentRules),
    ],
    diff.shrinkable,
    reportLeftovers
  );

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
 * @param {{ files?: Record<string, Record<string, string[]>> }} baseline
 * @returns {number}
 */
const countAllowances = (baseline) => Object.values(baseline.files || {}).reduce(
  (sum, rules) => sum + Object.values(rules).reduce((inner, occurrences) => inner + asOccurrenceList(occurrences).length, 0),
  0
);

/**
 * @param {string} headline
 * @param {object[]} problems
 * @returns {never}
 */
const failValidation = (headline, problems) => {
  console.error(headline);
  printProblems(problems);
  throw new HtmlValidationError(headline, { reported: true });
};

/**
 * Print a failure that has not already been written, then set a failing status.
 * failValidation prints before it throws. A missing origin/main ref throws
 * before that, so this is the path that makes the error visible.
 * @param {unknown} error
 * @returns {void}
 */
const handleCliError = (error) => {
  if (error instanceof HtmlValidationError) {
    if (!error.reported) console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
};

/**
 * Scan served pages and set a failing status when this file is the program.
 * @returns {Promise<void>}
 */
const main = async () => {
  const shrink = process.argv.includes("--shrink");
  const enforceMain = Boolean(process.env.CI);
  const { files, problems, baseline, actual } = await validateServedHtml(ROOT, {
    reportLeftovers: !shrink,
    enforceMain,
  });
  if (problems.length > 0) {
    failValidation(`HTML validation failed (${files.length} served files).`, problems);
  }

  if (shrink) {
    const applied = applyShrink(baseline, actual);
    if (!applied.next) {
      failValidation("Refusing to shrink.", applied.problems);
    }
    const ratchetProblems = assertRatchet(loadPreviousBaseline(ROOT, enforceMain), applied.next);
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
  const excludedCount = baseline.excludedFiles.length;
  const excludedLabel = excludedCount === 1 ? "excluded file" : "excluded files";
  console.log(
    `HTML validation passed (${files.length} served files, ${baselined} baselined errors, ${excludedCount} ${excludedLabel}).`
  );
};

module.exports = {
  BASELINE_PATH,
  CONFIG_PATH,
  HISTORICAL_OFF_RULES,
  ROOT,
  applyShrink,
  assertBaselineShape,
  assertConfig,
  assertConfigRatchet,
  assertRatchet,
  classifyGitShowError,
  collectServedHtml,
  diffBaseline,
  gateProblems,
  failValidation,
  handleCliError,
  HtmlValidationError,
  loadGitText,
  occurrenceId,
  shouldValidate,
  validateServedHtml,
};

if (require.main === module) {
  main().catch((error) => {
    handleCliError(error);
  });
}
