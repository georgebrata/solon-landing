#!/usr/bin/env node

/**
 * test-feature-flags.js
 *
 * Automated verification suite for the homepage feature flags system.
 * Tests disabling, enabling, idempotency, byte fidelity, nav syncing, and error safety.
 */

const assert = require('assert');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT_DIR, 'scripts', 'apply-feature-flags.js');
const INDEX_PATH = path.join(ROOT_DIR, 'index.html');
const CONFIG_PATH = path.join(ROOT_DIR, 'feature-flags.json');

const TMP_DIR = path.join(ROOT_DIR, 'scratch');
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

const TEST_HTML = path.join(TMP_DIR, 'test-index.html');
const TEST_CONFIG = path.join(TMP_DIR, 'test-flags.json');

const { findActiveSection, findDisabledSection } = require('./apply-feature-flags.js');

function cleanup() {
  if (fs.existsSync(TEST_HTML)) fs.unlinkSync(TEST_HTML);
  if (fs.existsSync(TEST_CONFIG)) fs.unlinkSync(TEST_CONFIG);
}

function runScript(args = '') {
  return execSync(
    `node "${SCRIPT_PATH}" --config "${TEST_CONFIG}" --input "${TEST_HTML}" --output "${TEST_HTML}" ${args}`,
    { encoding: 'utf8' }
  );
}

function readHtml() {
  return fs.readFileSync(TEST_HTML, 'utf8');
}

function writeConfig(obj) {
  fs.writeFileSync(TEST_CONFIG, JSON.stringify(obj, null, 2), 'utf8');
}

console.log('Running feature flag test suite...\n');

try {
  cleanup();

  const originalHtml = fs.readFileSync(INDEX_PATH, 'utf8');
  const baseConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  // Test 1: Status command
  console.log('Test 1: Status command outputs all sections');
  fs.writeFileSync(TEST_HTML, originalHtml);
  writeConfig(baseConfig);
  const statusOutput = execSync(
    `node "${SCRIPT_PATH}" --config "${TEST_CONFIG}" --input "${TEST_HTML}" --status`,
    { encoding: 'utf8' }
  );
  for (const id of Object.keys(baseConfig.homepage.sections)) {
    assert(statusOutput.includes(id), `Expected section "${id}" in status output`);
  }
  console.log('  Passed.\n');

  // Test 2: Disable a section (pricing)
  console.log('Test 2: Disabling an active section');
  const configPricingOff = JSON.parse(JSON.stringify(baseConfig));
  configPricingOff.homepage.sections.pricing.enabled = false;
  writeConfig(configPricingOff);

  runScript();
  let html = readHtml();
  assert(findDisabledSection(html, 'pricing') !== null, 'Should contain disabled pricing marker');
  assert(findActiveSection(html, 'pricing') === null, 'Pricing section should not be active');
  console.log('  Passed.\n');

  // Test 3: Idempotency check when disabled
  console.log('Test 3: Idempotency when running repeatedly with no changes');
  const outSame = runScript();
  assert(outSame.includes('No changes needed'), 'Should report no changes needed');
  console.log('  Passed.\n');

  // Test 4: Re-enable the section (pricing)
  console.log('Test 4: Re-enabling the section');
  const configPricingOn = JSON.parse(JSON.stringify(baseConfig));
  configPricingOn.homepage.sections.pricing.enabled = true;
  writeConfig(configPricingOn);

  runScript();
  html = readHtml();
  assert(findDisabledSection(html, 'pricing') === null, 'Should remove disabled marker');
  assert(findActiveSection(html, 'pricing') !== null, 'Pricing section should be active');
  console.log('  Passed.\n');

  // Test 5: Loss-less roundtrip fidelity
  console.log('Test 5: Byte fidelity after roundtrip (disable -> re-enable)');
  assert.strictEqual(html, originalHtml, 'HTML after disabling and re-enabling must match original exactly');
  console.log('  Passed.\n');

  // Test 6: Dry-run does not modify files
  console.log('Test 6: Dry-run preview');
  writeConfig(configPricingOff);
  const dryOutput = runScript('--dry-run');
  assert(dryOutput.includes('[DRY RUN]'), 'Should indicate dry-run mode');
  assert.strictEqual(readHtml(), originalHtml, 'File should remain unchanged after dry-run');
  console.log('  Passed.\n');

  // Test 7: Nav synchronization
  console.log('Test 7: Nav link synchronization (--sync-nav)');
  const configNav = JSON.parse(JSON.stringify(baseConfig));
  configNav.settings.syncNav = true;
  configNav.homepage.sections.servicii.enabled = false;
  writeConfig(configNav);

  runScript();
  html = readHtml();
  assert(html.includes('[FEATURE_FLAG_NAV_DISABLED:servicii]'), 'Nav link for servicii should be disabled');
  assert(html.includes('[FEATURE_FLAG_DISABLED:servicii]'), 'Section for servicii should be disabled');

  // Re-enable servicii with nav sync
  configNav.homepage.sections.servicii.enabled = true;
  writeConfig(configNav);
  runScript();
  html = readHtml();
  assert(!html.includes('[FEATURE_FLAG_NAV_DISABLED:servicii]'), 'Nav link for servicii should be restored');
  assert(!html.includes('[FEATURE_FLAG_DISABLED:servicii]'), 'Section for servicii should be restored');
  assert.strictEqual(html, originalHtml, 'HTML with nav roundtrip must match original');
  console.log('  Passed.\n');

  console.log('All feature flag tests passed successfully! ✓\n');
} finally {
  cleanup();
}
