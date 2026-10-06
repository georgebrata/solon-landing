"use strict";

const PLACEHOLDER_SITE_KEY = "TURNSTILE_SITE_KEY";

const isNonEmpty = (value) => Boolean(value && String(value).trim());

const isSiteKeyConfigured = (siteKey, placeholder) =>
  isNonEmpty(siteKey) && siteKey !== (placeholder || PLACEHOLDER_SITE_KEY);

/**
 * Cutover policy: enforce Turnstile only when the public site key and the
 * Apps Script secret are both configured. Either side missing → skip CAPTCHA
 * (honeypot and timing still apply). Error codes stay captcha / too_fast /
 * rate_limited.
 */
const evaluateTurnstile = ({ siteKeyConfigured, secretConfigured, token }) => {
  const hasToken = isNonEmpty(token);
  const clientSendsToken = Boolean(siteKeyConfigured);
  if (!siteKeyConfigured || !secretConfigured) {
    return {
      clientSendsToken,
      verify: false,
      rejectMissingToken: false,
      error: null,
    };
  }
  if (!hasToken) {
    return {
      clientSendsToken: true,
      verify: false,
      rejectMissingToken: true,
      error: "captcha",
    };
  }
  return {
    clientSendsToken: true,
    verify: true,
    rejectMissingToken: false,
    error: null,
  };
};

/**
 * Apps Script cannot see the site key. A live client sends a token only when
 * TURNSTILE_SITE_KEY is replaced. Secret without token (or token without
 * secret) must not captcha-block leads during cutover.
 */
const serverTurnstileDecision = (secret, token) => {
  if (!isNonEmpty(secret) || !isNonEmpty(token)) {
    return { verify: false, ok: true, error: null };
  }
  return { verify: true, ok: null, error: null };
};

module.exports = {
  PLACEHOLDER_SITE_KEY,
  isNonEmpty,
  isSiteKeyConfigured,
  evaluateTurnstile,
  serverTurnstileDecision,
};
