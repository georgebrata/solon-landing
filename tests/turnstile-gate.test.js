"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  PLACEHOLDER_SITE_KEY,
  isSiteKeyConfigured,
  evaluateTurnstile,
  serverTurnstileDecision,
} = require("./turnstile-gate");

const SITE_KEY = "1x00000000000000000000AA";
const SECRET = "0x-test-secret";
const TOKEN = "0.turnstile-token";

test("four Turnstile key/secret combinations stay safe during cutover", () => {
  const neither = evaluateTurnstile({
    siteKeyConfigured: isSiteKeyConfigured(PLACEHOLDER_SITE_KEY),
    secretConfigured: false,
    token: "",
  });
  assert.equal(neither.clientSendsToken, false);
  assert.equal(neither.verify, false);
  assert.equal(neither.rejectMissingToken, false);
  assert.equal(neither.error, null);
  assert.deepEqual(serverTurnstileDecision("", ""), { verify: false, ok: true, error: null });

  const keyOnly = evaluateTurnstile({
    siteKeyConfigured: isSiteKeyConfigured(SITE_KEY),
    secretConfigured: false,
    token: TOKEN,
  });
  assert.equal(keyOnly.clientSendsToken, true);
  assert.equal(keyOnly.verify, false);
  assert.equal(keyOnly.error, null);
  assert.deepEqual(serverTurnstileDecision("", TOKEN), { verify: false, ok: true, error: null });

  const secretOnly = evaluateTurnstile({
    siteKeyConfigured: isSiteKeyConfigured(PLACEHOLDER_SITE_KEY),
    secretConfigured: true,
    token: "",
  });
  assert.equal(secretOnly.clientSendsToken, false);
  assert.equal(secretOnly.verify, false);
  assert.equal(secretOnly.rejectMissingToken, false);
  assert.equal(secretOnly.error, null);
  assert.deepEqual(serverTurnstileDecision(SECRET, ""), { verify: false, ok: true, error: null });

  const both = evaluateTurnstile({
    siteKeyConfigured: isSiteKeyConfigured(SITE_KEY),
    secretConfigured: true,
    token: TOKEN,
  });
  assert.equal(both.clientSendsToken, true);
  assert.equal(both.verify, true);
  assert.equal(both.error, null);
  assert.deepEqual(serverTurnstileDecision(SECRET, TOKEN), { verify: true, ok: null, error: null });
});

test("both key and secret set still use captcha when the token is missing or empty", () => {
  const missing = evaluateTurnstile({
    siteKeyConfigured: true,
    secretConfigured: true,
    token: "",
  });
  assert.equal(missing.rejectMissingToken, true);
  assert.equal(missing.error, "captcha");
  const whitespace = evaluateTurnstile({
    siteKeyConfigured: true,
    secretConfigured: true,
    token: "   ",
  });
  assert.equal(whitespace.error, "captcha");
});

test("Apps Script Code.gs enforces Turnstile only when secret and token are both present", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../docs/apps-script/Code.gs"),
    "utf8"
  );
  assert.match(source, /function turnstileShouldVerify_/);
  assert.match(source, /filled_\(secret\) && filled_\(token\)/);
  assert.match(source, /error: ['"]captcha['"]/);
  assert.match(source, /error: ['"]too_fast['"]/);
  assert.match(source, /error: ['"]rate_limited['"]/);
  assert.doesNotMatch(source, /if \(!secret\) return true;\s*\n\s*if \(!token\) return false/);
});
