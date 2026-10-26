"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const {
  clearGtagPassCache,
  newCacheNonce,
  resolveRunKey,
} = require("./lib/gtag-pass-cache");

const repoRoot = path.join(__dirname, "..");
const cachePath = path.join(repoRoot, "tests", ".cache", "gtag-browser-pass.json");
const runKey = resolveRunKey();
const nonce = newCacheNonce();

clearGtagPassCache(cachePath);

const sharedEnv = {
  ...process.env,
  SOLON_GTAG_PASS_CACHE_PATH: cachePath,
  SOLON_GTAG_PASS_RUN_KEY: runKey,
  SOLON_GTAG_PASS_NONCE: nonce,
};

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {void}
 */
const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: sharedEnv,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const testFiles = fs
  .readdirSync(path.join(repoRoot, "tests"))
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => path.join("tests", name));
run(process.execPath, ["--test", ...testFiles]);
run(process.execPath, [path.join("scripts", "assert-test-files.js")]);
run(process.execPath, [path.join("scripts", "test-feature-flags.js")]);
