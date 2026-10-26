"use strict";

/** Minimum passed tests per file (raise via scripts/update-assert-test-floors.js only). */
const MIN_REGISTERED_TESTS_BY_FILE = {
  "append-blog-google-sheets.test.js": 8,
  "apps-script-brevo.test.js": 21,
  "assert-test-files.test.js": 16,
  "blog-schema.test.js": 3,
  "brevo-tracker.test.js": 7,
  "consent.test.js": 63,
  "demoanaf-badge.test.js": 5,
  "error-log.test.js": 5,
  "error-pages.test.js": 12,
  "forms.test.js": 35,
  "ga-collect-transport.test.js": 5,
  "ga-measurement-id.test.js": 4,
  "gtag-browser.test.js": 7,
  "gtag-datalayer.test.js": 2,
  "html-integrity.test.js": 4,
  "html-validate.test.js": 11,
  "humanize.test.js": 24,
  "indexnow.test.js": 18,
  "json-ld-injection.test.js": 17,
  "jsonld.test.js": 2,
  "legal-content-guard.test.js": 3,
  "meta-pixel-privacy.test.js": 4,
  "partners.test.js": 4,
  "price-toggle.test.js": 3,
  "pricing.test.js": 26,
  "puppeteer-ga-intercept.test.js": 2,
  "shortlinks-hit.test.js": 2,
  "shortlinks.test.js": 24,
  "sitemap.test.js": 7,
  "stamp-asset-refs.test.js": 6,
  "support-chat.test.js": 5,
  "tracking-snippets.test.js": 7,
  "tracking.test.js": 17,
  "turnstile-gate.test.js": 3,
  "unsubscribe-privacy.test.js": 5,
};

const MIN_TOTAL_REGISTERED_TESTS = 387;

/**
 * @param {{ MIN_REGISTERED_TESTS_BY_FILE?: unknown, MIN_TOTAL_REGISTERED_TESTS?: unknown }} floors
 * @returns {{ byFile: Record<string, number>, total: number }}
 */
const validateTestGuardFloors = (floors) => {
  const byFile = floors.MIN_REGISTERED_TESTS_BY_FILE;
  const total = floors.MIN_TOTAL_REGISTERED_TESTS;
  if (!byFile || typeof byFile !== "object" || Array.isArray(byFile)) {
    throw new Error("test-guard-floors: MIN_REGISTERED_TESTS_BY_FILE must be an object");
  }
  const keys = Object.keys(byFile);
  if (keys.length === 0) {
    throw new Error("test-guard-floors: MIN_REGISTERED_TESTS_BY_FILE has zero entries");
  }
  /** @type {Record<string, number>} */
  const normalized = {};
  for (const name of keys) {
    const value = byFile[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`test-guard-floors: invalid floor for ${name}`);
    }
    normalized[name] = value;
  }
  if (typeof total !== "number" || !Number.isFinite(total) || total < 1) {
    throw new Error("test-guard-floors: MIN_TOTAL_REGISTERED_TESTS must be a positive number");
  }
  return { byFile: normalized, total };
};

const committedFloors = validateTestGuardFloors({
  MIN_REGISTERED_TESTS_BY_FILE,
  MIN_TOTAL_REGISTERED_TESTS,
});

module.exports = {
  MIN_REGISTERED_TESTS_BY_FILE,
  MIN_TOTAL_REGISTERED_TESTS,
  validateTestGuardFloors,
  committedFloors,
};
