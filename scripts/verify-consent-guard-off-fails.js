"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");

const env = {
  ...process.env,
  SOLON_GTAG_DISABLE_CONSENT_GUARD: "1",
  SOLON_GTAG_GUARD_OFF_PROOF: "1",
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

const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
const failMatch = combined.match(/^# fail (\d+)\s*$/m);
const failCount = failMatch ? Number(failMatch[1]) : 0;

if (result.status === 0) {
  console.error("::error::consent transport guard disabled should have failed gtag-browser tests but passed");
  process.exitCode = 1;
  throw new Error("consent transport guard disabled should have failed gtag-browser tests but passed");
}
/** Withdrawal + blog suites must fail closed when transport guard is disabled. */
const MIN_GTAG_GUARD_OFF_FAILURES = 4;

if (failCount < MIN_GTAG_GUARD_OFF_FAILURES) {
  console.error(
    `::error::consent guard off expected at least ${MIN_GTAG_GUARD_OFF_FAILURES} failed browser tests, got fail ${failCount}`,
  );
  process.exitCode = 1;
  throw new Error(
    `consent guard off expected at least ${MIN_GTAG_GUARD_OFF_FAILURES} failed browser tests, got fail ${failCount}`,
  );
}

process.stdout.write(
  `consent guard off failed gtag-browser as expected (exit ${result.status ?? 1}, fail ${failCount})\n`,
);
