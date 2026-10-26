"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execSync } = require("node:child_process");
const { validateTestGuardFloors } = require("./test-guard-floors");

const repoRoot = path.join(__dirname, "..", "..");
const ORIGIN_MAIN_REF = "refs/remotes/origin/main";

/**
 * @returns {string}
 */
const resolveMainFloorRef = () => {
  if (process.env.GITHUB_EVENT_NAME === "push" && process.env.GITHUB_REF === "refs/heads/main") {
    if (process.env.GITHUB_EVENT_BEFORE && process.env.GITHUB_EVENT_BEFORE !== "0000000000000000000000000000000000000000") {
      return process.env.GITHUB_EVENT_BEFORE;
    }
    return "HEAD^1";
  }
  return "origin/main";
};

/**
 * @returns {void}
 */
const requireOriginMainRef = () => {
  const gitDir = path.join(repoRoot, ".git");
  if (!fs.existsSync(gitDir)) {
    throw new Error("origin/main guard: .git is missing (fetch origin main before running floors)");
  }
  const ref = resolveMainFloorRef();
  if (ref === "HEAD^1" || ref.length === 40) {
    try {
      execSync(`git rev-parse --verify ${ref}^{commit}`, {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      throw new Error(`origin/main guard: ${ref} is missing for floor comparison`);
    }
    return;
  }
  try {
    execSync(`git rev-parse --verify ${ORIGIN_MAIN_REF}`, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "origin/main guard: refs/remotes/origin/main is missing (run: git fetch origin main)",
    );
  }
};

/**
 * @param {string} source
 * @returns {{ byFile: Record<string, number>, total: number }}
 */
const parseFloorsFromModuleSource = (source) => {
  const moduleWrapper = { exports: {} };
  const sandbox = {
    module: moduleWrapper,
    exports: moduleWrapper.exports,
    require: (id) => {
      if (id === "./test-guard-floors" || id.endsWith("test-guard-floors")) {
        return require("./test-guard-floors");
      }
      throw new Error(`origin/main guard: unsupported require(${id}) in floor module`);
    },
  };
  vm.runInNewContext(source, sandbox, { filename: "test-guard-floors.js" });
  return validateTestGuardFloors(moduleWrapper.exports);
};

/**
 * @returns {string[]}
 */
const listMainTestFiles = () => {
  requireOriginMainRef();
  const ref = resolveMainFloorRef();
  const spec = `${ref}:tests`;
  const listing = execSync(`git ls-tree --name-only ${spec}`, {
    encoding: "utf8",
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return listing
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name.endsWith(".test.js"));
};

/**
 * @returns {{ byFile: Record<string, number>, total: number }}
 */
/**
 * @param {string} source
 * @returns {{ byFile: Record<string, number>, total: number }}
 */
const parseFloorsFromAssertLegacySource = (source) => {
  const blockMatch = source.match(/const MIN_REGISTERED_TESTS_BY_FILE = \{([\s\S]*?)\};/m);
  const totalMatch = source.match(/const MIN_TOTAL_REGISTERED_TESTS = (\d+);/);
  if (!blockMatch || !totalMatch) {
    throw new Error("origin/main guard: could not parse legacy assert-test-files.js floors");
  }
  /** @type {Record<string, number>} */
  const byFile = {};
  for (const line of blockMatch[1].split("\n")) {
    const entry = line.match(/^\s*"([^"]+)":\s*(\d+),?\s*$/u);
    if (entry) {
      byFile[entry[1]] = Number(entry[2]);
    }
  }
  return validateTestGuardFloors({
    MIN_REGISTERED_TESTS_BY_FILE: byFile,
    MIN_TOTAL_REGISTERED_TESTS: Number(totalMatch[1]),
  });
};

/**
 * @returns {{ byFile: Record<string, number>, total: number }}
 */
const readOriginMainFloors = () => {
  requireOriginMainRef();
  const ref = resolveMainFloorRef();
  try {
    const source = execSync(`git show ${ref}:scripts/lib/test-guard-floors.js`, {
      encoding: "utf8",
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return parseFloorsFromModuleSource(source);
  } catch {
    const legacy = execSync(`git show ${ref}:scripts/assert-test-files.js`, {
      encoding: "utf8",
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return parseFloorsFromAssertLegacySource(legacy);
  }
};

module.exports = {
  ORIGIN_MAIN_REF,
  repoRoot,
  resolveMainFloorRef,
  requireOriginMainRef,
  parseFloorsFromModuleSource,
  parseFloorsFromAssertLegacySource,
  readOriginMainFloors,
  listMainTestFiles,
};
