"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

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
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST") || key === "NODE_OPTIONS") {
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
  for (const line of combined.split("\n")) {
    const match = line.match(/^# pass (\d+)\s*$/u);
    if (match) {
      passFromSummary = Number(match[1]);
    }
  }
  if (passFromSummary === null || !Number.isFinite(passFromSummary)) {
    return 0;
  }
  return passFromSummary;
};

module.exports = {
  parseTapPassCount,
  isolatedTestEnv,
};

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error("usage: count-registered-tests-cli.js <test-file>");
  }

  const result = spawnSync(process.execPath, ["--test", "--test-reporter", "tap", filePath], {
    encoding: "utf8",
    env: isolatedTestEnv(process.env, filePath),
    timeout: 120_000,
  });

  const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
  const passCount = parseTapPassCount(combined);

  process.stdout.write(String(passCount));
}
