"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const mutation = process.argv[2];
if (mutation !== "continue" && mutation !== "no-intercept") {
  console.error("usage: verify-gtag-mutation-fails.js <continue|no-intercept>");
  process.exit(2);
}

const env = {
  ...process.env,
  SOLON_GTAG_INTERCEPT_MUTATION: mutation,
  SOLON_SKIP_ASSERT_INTEGRATION: "1",
};
delete env.SOLON_GTAG_PASS_CACHE_PATH;
delete env.SOLON_GTAG_PASS_RUN_KEY;
delete env.SOLON_GTAG_PASS_NONCE;

const result = spawnSync(process.execPath, ["--test", path.join("tests", "gtag-browser.test.js")], {
  cwd: repoRoot,
  env,
  encoding: "utf8",
});

if (result.status === 0) {
  console.error(`::error::gtag mutation ${mutation} should have failed tests but passed`);
  process.exit(1);
}

process.stdout.write(`gtag mutation ${mutation} failed as expected (exit ${result.status ?? 1})\n`);
