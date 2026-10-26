"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readGtagPassCache } = require("./lib/gtag-pass-cache");

/**
 * @param {NodeJS.ProcessEnv} base
 * @param {string} [testFilePath]
 * @returns {NodeJS.ProcessEnv}
 */
const isolatedTestEnv = (base, testFilePath = "") => {
  const env = { ...base, SOLON_SKIP_ASSERT_INTEGRATION: "1" };
  const baseName = testFilePath ? path.basename(testFilePath) : "";
  if (baseName !== "gtag-browser.test.js") {
    env.SKIP_GTAG_BROWSER = "1";
  }
  const preserveNodeOptions = baseName === "gtag-browser.test.js";
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST")) {
      delete env[key];
    }
    if (key === "NODE_OPTIONS" && !preserveNodeOptions) {
      delete env[key];
    }
  }
  return env;
};

/**
 * Count only passed tests from the real node:test TAP summary (fail-closed).
 * Ignores forged `# tests N` lines; skipped/todo do not increase the count.
 * @param {string} combined
 * @returns {number}
 */
const parseTapPassCount = (combined) => {
  if (!/^TAP version \d+/mu.test(combined)) {
    return 0;
  }
  let passFromSummary = null;
  let testsFromSummary = null;
  for (const line of combined.split("\n")) {
    const passMatch = line.match(/^# pass (\d+)\s*$/u);
    if (passMatch) {
      passFromSummary = Number(passMatch[1]);
    }
    const testsMatch = line.match(/^# tests (\d+)\s*$/u);
    if (testsMatch) {
      testsFromSummary = Number(testsMatch[1]);
    }
  }
  if (passFromSummary === null || !Number.isFinite(passFromSummary)) {
    return 0;
  }

  let subtestOk = 0;
  for (const line of combined.split("\n")) {
    const okMatch = line.match(/^ok \d+ - (.+)$/u);
    if (okMatch && !okMatch[1].endsWith(".test.js")) {
      subtestOk += 1;
    }
  }
  if (subtestOk === 0 && passFromSummary > 0 && testsFromSummary === 1) {
    return 0;
  }
  return passFromSummary;
};

/**
 * @param {string} testFilePath
 * @returns {number | null}
 */
const readGtagPassCacheForCli = (testFilePath) => {
  const cachePath = process.env.SOLON_GTAG_PASS_CACHE_PATH;
  if (!cachePath || path.basename(testFilePath) !== "gtag-browser.test.js") {
    return null;
  }
  const runKey = process.env.SOLON_GTAG_PASS_RUN_KEY;
  const nonce = process.env.SOLON_GTAG_PASS_NONCE;
  if (!runKey || !nonce) {
    return null;
  }
  return readGtagPassCache(cachePath, { runKey, nonce });
};

module.exports = {
  parseTapPassCount,
  isolatedTestEnv,
  readGtagPassCacheForCli,
};

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error("usage: count-registered-tests-cli.js <test-file>");
  }

  const cachedPass = readGtagPassCacheForCli(filePath);
  if (cachedPass !== null) {
    process.stdout.write(String(cachedPass));
  } else {
    const timeoutMs = path.basename(filePath) === "assert-test-files.test.js" ? 300_000 : 120_000;
    const result = spawnSync(process.execPath, ["--test", "--test-reporter", "tap", filePath], {
      encoding: "utf8",
      env: isolatedTestEnv(process.env, filePath),
      timeout: timeoutMs,
    });

    const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
    const passCount = parseTapPassCount(combined);

    process.stdout.write(String(passCount));
  }
}
