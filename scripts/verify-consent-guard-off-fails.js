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
if (failCount < 5) {
  console.error(`::error::consent guard off expected at least 5 failed browser tests, got fail ${failCount}`);
  process.exitCode = 1;
  throw new Error(`consent guard off expected at least 5 failed browser tests, got fail ${failCount}`);
}

process.stdout.write(
  `consent guard off failed gtag-browser as expected (exit ${result.status ?? 1}, fail ${failCount})\n`,
);

const consentReusePattern = "blocked XHR open\\(\\) clears synthetic readyState before reuse";
const consentResult = spawnSync(
  process.execPath,
  [
    "--test",
    "--test-name-pattern",
    consentReusePattern,
    path.join("tests", "consent.test.js"),
  ],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      SOLON_CONSENT_OMIT_TRANSPORT_GUARD: "1",
      SOLON_CONSENT_GUARD_OFF_PROOF: "1",
      SOLON_SKIP_ASSERT_INTEGRATION: "1",
    },
    encoding: "utf8",
  },
);

if (consentResult.status === 0) {
  console.error(
    "::error::consent transport guard disabled should have failed blocked XHR reuse test but passed",
  );
  process.exitCode = 1;
  throw new Error(
    "consent transport guard disabled should have failed blocked XHR reuse test but passed",
  );
}

process.stdout.write(
  `consent guard off failed blocked XHR reuse as expected (exit ${consentResult.status ?? 1})\n`,
);
