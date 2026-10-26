"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const repoRoot = path.join(__dirname, "..", "..");
const ORIGIN_MAIN_REF = "refs/remotes/origin/main";

/**
 * @returns {string}
 */
const resolveMainFloorRef = () => {
  if (process.env.GITHUB_EVENT_NAME === "push" && process.env.GITHUB_REF === "refs/heads/main") {
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
  if (ref === "HEAD^1") {
    try {
      execSync("git rev-parse --verify HEAD^1", {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      throw new Error("origin/main guard: HEAD^1 is missing on this push");
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
const parseFloorsFromAssertSource = (source) => {
  const blockMatch = source.match(/const MIN_REGISTERED_TESTS_BY_FILE = \{([\s\S]*?)\};/m);
  const totalMatch = source.match(/const MIN_TOTAL_REGISTERED_TESTS = (\d+);/);
  if (!blockMatch) {
    throw new Error("origin/main guard: could not parse MIN_REGISTERED_TESTS_BY_FILE block");
  }
  if (!totalMatch) {
    throw new Error("origin/main guard: could not parse MIN_TOTAL_REGISTERED_TESTS");
  }
  /** @type {Record<string, number>} */
  const byFile = {};
  const body = blockMatch[1];
  for (const line of body.split("\n")) {
    const entry = line.match(/^\s*"([^"]+)":\s*(\d+),?\s*$/u);
    if (entry) {
      byFile[entry[1]] = Number(entry[2]);
    }
  }
  const total = Number(totalMatch[1]);
  if (!Number.isFinite(total)) {
    throw new Error("origin/main guard: MIN_TOTAL_REGISTERED_TESTS is not a number");
  }
  return { byFile, total };
};

/**
 * @returns {string[]}
 */
const listMainTestFiles = () => {
  requireOriginMainRef();
  const ref = resolveMainFloorRef();
  const spec = ref === "HEAD^1" ? "HEAD^1:tests" : "origin/main:tests";
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
const readOriginMainFloors = () => {
  requireOriginMainRef();
  const ref = resolveMainFloorRef();
  const source = execSync(`git show ${ref}:scripts/assert-test-files.js`, {
    encoding: "utf8",
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseFloorsFromAssertSource(source);
};

module.exports = {
  ORIGIN_MAIN_REF,
  repoRoot,
  resolveMainFloorRef,
  requireOriginMainRef,
  parseFloorsFromAssertSource,
  readOriginMainFloors,
  listMainTestFiles,
};
