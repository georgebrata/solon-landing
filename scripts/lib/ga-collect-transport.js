"use strict";

const MAX_PATH_DECODES = 8;

/**
 * @param {string} hostname
 * @returns {string}
 */
const normalizeHostname = (hostname) => {
  let normalized = hostname.toLowerCase();
  while (normalized.endsWith(".")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
};

/**
 * @param {string} hostname
 * @param {string} apex
 * @returns {boolean}
 */
const hostnameMatchesApex = (hostname, apex) =>
  hostname === apex || hostname.endsWith(`.${apex}`);

/**
 * @param {string} pathname
 * @returns {string}
 */
const collapsePathSlashes = (pathname) => pathname.replace(/\/+/gu, "/");

/**
 * @param {string} pathname
 * @returns {{ ok: true, pathname: string } | { ok: false }}
 */
const decodeCollectPathname = (pathname) => {
  let pathCursor = pathname || "";
  for (let i = 0; i < MAX_PATH_DECODES; i += 1) {
    try {
      const next = decodeURIComponent(pathCursor);
      if (next === pathCursor) {
        break;
      }
      pathCursor = next;
    } catch {
      return { ok: false };
    }
  }
  return { ok: true, pathname: collapsePathSlashes(pathCursor) };
};

/**
 * @param {string} pathname
 * @param {string} leftSegment
 * @param {string} rightSegment
 * @returns {boolean}
 */
const pathHasAdjacentSegments = (pathname, leftSegment, rightSegment) => {
  const parts = collapsePathSlashes(pathname || "").split("/").filter(Boolean);
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (parts[i].toLowerCase() === leftSegment && parts[i + 1].toLowerCase() === rightSegment) {
      return true;
    }
  }
  return false;
};

/**
 * @param {string} pathname
 * @returns {boolean}
 */
const pathHasGaCollectSegments = (pathname) => pathHasAdjacentSegments(pathname, "g", "collect");

/**
 * @param {string} pathname
 * @returns {boolean}
 */
const pathHasCcmCollectSegments = (pathname) => pathHasAdjacentSegments(pathname, "ccm", "collect");

/**
 * @param {string} pathname
 * @returns {boolean}
 */
const isGaCollectPathname = (pathname) =>
  pathHasGaCollectSegments(pathname) || pathHasCcmCollectSegments(pathname);

/**
 * Block when raw or normalized pathname matches; malformed percent-encoding matches on GA/GTM hosts.
 * @param {string} rawPathname
 * @returns {{ matches: boolean, decodeFailed: boolean }}
 */
const gaCollectPathMatch = (rawPathname) => {
  const raw = rawPathname || "";
  if (isGaCollectPathname(raw)) {
    return { matches: true, decodeFailed: false };
  }
  const decoded = decodeCollectPathname(raw);
  if (!decoded.ok) {
    return { matches: false, decodeFailed: true };
  }
  if (isGaCollectPathname(decoded.pathname)) {
    return { matches: true, decodeFailed: false };
  }
  return { matches: false, decodeFailed: false };
};

/**
 * @param {string} hostname
 * @returns {boolean}
 */
const isGoogleAnalyticsCollectHost = (hostname) =>
  hostnameMatchesApex(hostname, "google-analytics.com") ||
  hostnameMatchesApex(hostname, "analytics.google.com");

/**
 * @param {string} hostname
 * @returns {boolean}
 */
const isGoogleTagManagerCollectHost = (hostname) => hostnameMatchesApex(hostname, "googletagmanager.com");

/**
 * @param {string} url
 * @returns {boolean}
 */
const isGaCollectTransportUrl = (url) => {
  try {
    const parsed = new URL(url);
    const hostname = normalizeHostname(parsed.hostname);
    if (
      !isGoogleAnalyticsCollectHost(hostname) &&
      !isGoogleTagManagerCollectHost(hostname)
    ) {
      return false;
    }
    const pathCheck = gaCollectPathMatch(parsed.pathname);
    if (pathCheck.decodeFailed) {
      return isGoogleTagManagerCollectHost(hostname) || isGoogleAnalyticsCollectHost(hostname);
    }
    return pathCheck.matches;
  } catch {
    return false;
  }
};

/**
 * @param {string} url
 * @returns {boolean}
 */
const isGtagLoaderUrl = (url) => {
  try {
    const parsed = new URL(url);
    const hostname = normalizeHostname(parsed.hostname);
    return isGoogleTagManagerCollectHost(hostname) && /\/gtag\/js\b/i.test(parsed.pathname);
  } catch {
    return false;
  }
};

/** Host suffixes that must not be contacted before analytics consent (and after reject). */
const GOOGLE_TRACKING_HOST_APEXES = [
  "google.com",
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "gstatic.com",
];

/**
 * @param {string} hostname
 * @returns {boolean}
 */
const isGoogleTrackingHost = (hostname) => {
  const normalized = normalizeHostname(hostname);
  return GOOGLE_TRACKING_HOST_APEXES.some((apex) => hostnameMatchesApex(normalized, apex));
};

/**
 * @param {string} url
 * @returns {boolean}
 */
const isGoogleTrackingRequestUrl = (url) => {
  try {
    return isGoogleTrackingHost(new URL(url).hostname);
  } catch {
    return false;
  }
};

module.exports = {
  MAX_PATH_DECODES,
  normalizeHostname,
  hostnameMatchesApex,
  collapsePathSlashes,
  decodeCollectPathname,
  pathHasGaCollectSegments,
  pathHasCcmCollectSegments,
  isGaCollectPathname,
  gaCollectPathMatch,
  isGoogleAnalyticsCollectHost,
  isGoogleTagManagerCollectHost,
  isGaCollectTransportUrl,
  isGtagLoaderUrl,
  GOOGLE_TRACKING_HOST_APEXES,
  isGoogleTrackingHost,
  isGoogleTrackingRequestUrl,
};
