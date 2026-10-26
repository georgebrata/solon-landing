"use strict";

const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const repoRoot = path.join(__dirname, "..", "..");

/**
 * @returns {string}
 */
const resolveRunKey = () => {
  if (process.env.GITHUB_RUN_ID) {
    return `gha-${process.env.GITHUB_RUN_ID}`;
  }
  try {
    const head = execSync("git rev-parse HEAD", {
      encoding: "utf8",
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (head) {
      return `head-${head}`;
    }
  } catch {
    // fall through
  }
  return `pid-${process.pid}`;
};

/**
 * @returns {string}
 */
const newCacheNonce = () => randomBytes(16).toString("hex");

/**
 * @param {string} cachePath
 * @returns {void}
 */
const clearGtagPassCache = (cachePath) => {
  if (fs.existsSync(cachePath)) {
    fs.unlinkSync(cachePath);
  }
};

/**
 * @param {string} cachePath
 * @param {number} passCount
 * @param {{ runKey: string, nonce: string }} meta
 * @returns {void}
 */
const writeGtagPassCache = (cachePath, passCount, meta) => {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(
    cachePath,
    `${JSON.stringify({
      pass: passCount,
      runKey: meta.runKey,
      nonce: meta.nonce,
      skipped: 0,
    })}\n`,
  );
};

/**
 * @param {string} cachePath
 * @param {{ runKey: string; nonce: string }} expected
 * @returns {number | null}
 */
const readGtagPassCache = (cachePath, expected) => {
  if (!fs.existsSync(cachePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (
      typeof parsed.pass !== "number" ||
      !Number.isFinite(parsed.pass) ||
      parsed.pass < 1 ||
      parsed.runKey !== expected.runKey ||
      parsed.nonce !== expected.nonce ||
      parsed.skipped !== 0
    ) {
      return null;
    }
    return parsed.pass;
  } catch {
    return null;
  }
};

module.exports = {
  resolveRunKey,
  newCacheNonce,
  clearGtagPassCache,
  writeGtagPassCache,
  readGtagPassCache,
  repoRoot,
};
