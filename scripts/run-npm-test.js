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
  SOLON_SKIP_ASSERT_INTEGRATION: "1",
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
    throw new Error(`npm test step failed: ${args.join(" ")} (exit ${result.status ?? 1})`);
  }
};

const testFiles = fs
  .readdirSync(path.join(repoRoot, "tests"))
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => path.join("tests", name));
try {
  run(process.execPath, ["--test", ...testFiles]);
  if (process.env.SOLON_SKIP_GTAG_MUTATION !== "1") {
    run(process.execPath, [path.join("scripts", "verify-gtag-mutation-fails.js"), "continue"]);
    run(process.execPath, [path.join("scripts", "verify-gtag-mutation-fails.js"), "no-intercept"]);
    run(process.execPath, [path.join("scripts", "verify-consent-guard-off-fails.js")]);
  }
  run(process.execPath, [path.join("scripts", "assert-test-files.js")]);
  run(process.execPath, [path.join("scripts", "test-feature-flags.js")]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
