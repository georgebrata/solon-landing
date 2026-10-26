"use strict";

const { spawnSync } = require("node:child_process");

/**
 * @param {NodeJS.ProcessEnv} base
 * @returns {NodeJS.ProcessEnv}
 */
const isolatedTestEnv = (base) => {
  const env = { ...base, SKIP_GTAG_BROWSER: "1", SOLON_SKIP_ASSERT_INTEGRATION: "1" };
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST") || key === "NODE_OPTIONS") {
      delete env[key];
    }
  }
  return env;
};

const filePath = process.argv[2];
if (!filePath) {
  process.stderr.write("usage: count-registered-tests-cli.js <test-file>\n");
  process.exit(2);
}

const result = spawnSync(process.execPath, ["--test", "--test-reporter", "tap", filePath], {
  encoding: "utf8",
  env: isolatedTestEnv(process.env),
  timeout: 120_000,
});

const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
const match = combined.match(/# tests (\d+)/);
if (!match) {
  process.stderr.write(combined);
  process.exit(1);
}

process.stdout.write(match[1]);
