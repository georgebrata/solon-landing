"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ORIGIN_MAIN_REF = "refs/remotes/origin/main";

/**
 * @returns {void}
 */
const requireOriginMainRef = () => {
  const gitDir = path.join(__dirname, "..", "..", ".git");
  if (!fs.existsSync(gitDir)) {
    throw new Error("origin/main guard: .git is missing (fetch origin main before running floors)");
  }
  try {
    execSync(`git rev-parse --verify ${ORIGIN_MAIN_REF}`, {
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
  /** @type {Record<string, number>} */
  const byFile = {};
  if (blockMatch) {
    const body = blockMatch[1];
    for (const line of body.split("\n")) {
      const entry = line.match(/^\s*"([^"]+)":\s*(\d+),?\s*$/u);
      if (entry) {
        byFile[entry[1]] = Number(entry[2]);
      }
    }
  }
  const total = totalMatch ? Number(totalMatch[1]) : 0;
  return { byFile, total };
};

/**
 * @returns {{ byFile: Record<string, number>, total: number }}
 */
const readOriginMainFloors = () => {
  requireOriginMainRef();
  const source = execSync("git show origin/main:scripts/assert-test-files.js", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseFloorsFromAssertSource(source);
};

module.exports = {
  ORIGIN_MAIN_REF,
  requireOriginMainRef,
  parseFloorsFromAssertSource,
  readOriginMainFloors,
};
