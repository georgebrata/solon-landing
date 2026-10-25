"use strict";

/**
 * /feedback/#e=<email> (primary) or ?e= — prefill Google Form email and strip before trackers.
 */
(function () {
  const FEEDBACK_FORM_BASE_SRC =
    "https://docs.google.com/forms/d/e/1FAIpQLScGk_sLoxOYV7O2dwqCaxgZ6lqlTe7NZagVa3zjj-Pk5PI9nw/viewform?embedded=true";
  const EMAIL_ENTRY_ID = "1640447617";
  const EMAIL_QUERY_PARAM = "e";
  const EMAIL_MAX_LENGTH = 254;
  const LOCAL_PART_MAX_LENGTH = 64;
  const IFRAME_TITLE = "Formular feedback SOLON (Google Forms)";

  let win = globalThis;
  if (typeof window !== "undefined") {
    win = window;
  }
  let doc = null;
  if (typeof document !== "undefined") {
    doc = document;
  }

  /**
   * @param {string} encoded
   * @returns {string}
   */
  function decodeEmailQueryValue(encoded) {
    if (!encoded) {
      return "";
    }
    try {
      return decodeURIComponent(encoded.replace(/\+/g, "%2B"));
    } catch {
      /* ignore malformed percent-encoding in e= */
      return "";
    }
  }

  /**
   * @param {string} segmentsSource
   * @returns {string|null}
   */
  function readRawEmailFromParamSegments(segmentsSource) {
    if (!segmentsSource) {
      return null;
    }
    const parts = segmentsSource.split("&");
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (!part) {
        continue;
      }
      const eq = part.indexOf("=");
      const key = eq === -1 ? part : part.slice(0, eq);
      if (key.toLowerCase() !== EMAIL_QUERY_PARAM) {
        continue;
      }
      const value = eq === -1 ? "" : part.slice(eq + 1);
      return decodeEmailQueryValue(value);
    }
    return null;
  }

  /**
   * @param {string} search
   * @returns {string|null}
   */
  function readRawEmailParamFromSearch(search) {
    const qs = search.startsWith("?") ? search.slice(1) : search;
    return readRawEmailFromParamSegments(qs);
  }

  /**
   * @param {string} hash
   * @returns {string|null}
   */
  function readRawEmailFromHash(hash) {
    if (!hash) {
      return null;
    }
    const inner = hash.startsWith("#") ? hash.slice(1) : hash;
    return readRawEmailFromParamSegments(inner);
  }

  /**
   * @param {string} segmentsSource
   * @returns {{ encoded: string, rawEmail: string|null, stripped: boolean }}
   */
  function stripEParamFromSegments(segmentsSource) {
    if (!segmentsSource) {
      return { encoded: "", rawEmail: null, stripped: false };
    }
    const parts = segmentsSource.split("&");
    const kept = [];
    let rawEmail = null;
    let stripped = false;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (part === "") {
        kept.push(part);
        continue;
      }
      const eq = part.indexOf("=");
      const key = eq === -1 ? part : part.slice(0, eq);
      if (key.toLowerCase() === EMAIL_QUERY_PARAM) {
        stripped = true;
        if (rawEmail === null) {
          const value = eq === -1 ? "" : part.slice(eq + 1);
          rawEmail = decodeEmailQueryValue(value);
        }
        continue;
      }
      kept.push(part);
    }
    if (!stripped) {
      return { encoded: segmentsSource, rawEmail: null, stripped: false };
    }
    return { encoded: kept.join("&"), rawEmail, stripped: true };
  }

  /**
   * @param {string} search
   * @returns {{ search: string, rawEmail: string|null, stripped: boolean }}
   */
  function stripEParamPreservingSearch(search) {
    if (!search) {
      return { search: "", rawEmail: null, stripped: false };
    }
    const qs = search.startsWith("?") ? search.slice(1) : search;
    if (!qs) {
      return { search, rawEmail: null, stripped: false };
    }
    const { encoded, rawEmail, stripped } = stripEParamFromSegments(qs);
    if (!stripped) {
      return { search, rawEmail: null, stripped: false };
    }
    if (!encoded) {
      return { search: "", rawEmail, stripped: true };
    }
    return { search: `?${encoded}`, rawEmail, stripped: true };
  }

  /**
   * @param {string} hash
   * @returns {string}
   */
  function hashWithLeadingOctothorpe(hash) {
    if (!hash) {
      return "";
    }
    return hash.startsWith("#") ? hash : `#${hash}`;
  }

  /**
   * @param {string} hash
   * @returns {{ hash: string, rawEmail: string|null, stripped: boolean }}
   */
  function stripEFromHash(hash) {
    if (!hash) {
      return { hash: "", rawEmail: null, stripped: false };
    }
    const inner = hash.startsWith("#") ? hash.slice(1) : hash;
    if (!inner) {
      return { hash: hashWithLeadingOctothorpe(hash), rawEmail: null, stripped: false };
    }
    const { encoded, rawEmail, stripped } = stripEParamFromSegments(inner);
    if (!stripped) {
      return { hash: hashWithLeadingOctothorpe(hash), rawEmail: null, stripped: false };
    }
    if (!encoded) {
      return { hash: "", rawEmail, stripped: true };
    }
    return { hash: `#${encoded}`, rawEmail, stripped: true };
  }

  /**
   * @param {unknown} raw
   * @returns {string|null}
   */
  function normalizeFeedbackEmailParam(raw) {
    if (raw === null || typeof raw !== "string") {
      return null;
    }
    const value = raw.trim();
    if (!value) {
      return null;
    }
    if (value.length > EMAIL_MAX_LENGTH) {
      return null;
    }
    if (!isConservativeFeedbackEmail(value)) {
      return null;
    }
    return value;
  }

  /**
   * @param {string} value
   * @returns {boolean}
   */
  function containsAsciiControlChar(value) {
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code <= 0x1f || code === 0x7f) {
        return true;
      }
    }
    return false;
  }

  /**
   * @param {string} value
   * @returns {boolean}
   */
  function isConservativeFeedbackEmail(value) {
    if (!value || value.length > EMAIL_MAX_LENGTH) {
      return false;
    }
    if (/[\s<>"']/u.test(value)) {
      return false;
    }
    if (containsAsciiControlChar(value)) {
      return false;
    }
    const at = value.indexOf("@");
    if (at <= 0 || at !== value.lastIndexOf("@")) {
      return false;
    }
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    if (!local || local.length > LOCAL_PART_MAX_LENGTH) {
      return false;
    }
    if (!domain || local.includes("..") || domain.includes("..")) {
      return false;
    }
    const lastDot = domain.lastIndexOf(".");
    if (lastDot <= 0 || lastDot >= domain.length - 1) {
      return false;
    }
    const tld = domain.slice(lastDot + 1);
    return tld.length >= 2;
  }

  /**
   * @param {string} href
   * @returns {{ pathAndQuery: string, rawEmail: string|null, stripped: boolean }}
   */
  function stripFeedbackEmailFromHref(href) {
    try {
      const url = new URL(href);
      const hashPart = stripEFromHash(url.hash);
      const queryPart = stripEParamPreservingSearch(url.search);
      let rawEmail = readRawEmailFromHash(url.hash);
      if (rawEmail === null) {
        rawEmail = readRawEmailParamFromSearch(url.search);
      }
      return {
        pathAndQuery: url.pathname + queryPart.search + hashPart.hash,
        rawEmail,
        stripped: hashPart.stripped || queryPart.stripped,
      };
    } catch {
      return { pathAndQuery: "", rawEmail: null, stripped: false };
    }
  }

  /**
   * @param {string} email
   * @returns {string|null}
   */
  function buildFeedbackFormSrc(email) {
    const normalized = normalizeFeedbackEmailParam(email);
    if (!normalized) {
      return null;
    }
    const url = new URL(FEEDBACK_FORM_BASE_SRC);
    url.searchParams.set(`entry.${EMAIL_ENTRY_ID}`, normalized);
    url.searchParams.set("usp", "pp_url");
    return url.toString();
  }

  /**
   * @param {Window} targetWin
   * @returns {string|null} validated email captured before strip
   */
  function applyFeedbackUrlHygiene(targetWin) {
    if (!targetWin.location || typeof targetWin.history?.replaceState !== "function") {
      return null;
    }
    const { pathAndQuery, rawEmail, stripped } = stripFeedbackEmailFromHref(targetWin.location.href);
    const email = normalizeFeedbackEmailParam(rawEmail);
    if (stripped) {
      targetWin.history.replaceState(null, "", pathAndQuery);
    }
    return email;
  }

  /**
   * @param {Element|null} frame
   * @returns {string}
   */
  function resolveFeedbackFormBaseSrc(frame) {
    if (frame && typeof frame.getAttribute === "function") {
      const fromData = frame.getAttribute("data-src");
      if (fromData) {
        return fromData;
      }
    }
    return FEEDBACK_FORM_BASE_SRC;
  }

  /**
   * @param {Document} targetDoc
   * @param {string|null} email
   * @returns {void}
   */
  function applyFeedbackIframeSrc(targetDoc, email) {
    const frame = targetDoc.querySelector(`iframe[title="${IFRAME_TITLE}"]`);
    if (!frame) {
      return;
    }
    const base = resolveFeedbackFormBaseSrc(frame);
    let src = base;
    if (email) {
      const prefilled = buildFeedbackFormSrc(email);
      if (prefilled) {
        src = prefilled;
      }
    }
    frame.setAttribute("src", src);
  }

  /**
   * @returns {void}
   */
  function bootFeedbackFormPrefill() {
    if (!doc || !win.location) {
      return;
    }
    const email = applyFeedbackUrlHygiene(win);
    /**
     * @returns {void}
     */
    function onReady() {
      applyFeedbackIframeSrc(doc, email);
    }
    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", onReady);
      return;
    }
    onReady();
  }

  const api = {
    FEEDBACK_FORM_BASE_SRC,
    EMAIL_ENTRY_ID,
    EMAIL_QUERY_PARAM,
    LOCAL_PART_MAX_LENGTH,
    decodeEmailQueryValue,
    readRawEmailParamFromSearch,
    readRawEmailFromHash,
    stripEParamPreservingSearch,
    stripEFromHash,
    normalizeFeedbackEmailParam,
    isConservativeFeedbackEmail,
    stripFeedbackEmailFromHref,
    buildFeedbackFormSrc,
    applyFeedbackUrlHygiene,
    resolveFeedbackFormBaseSrc,
    applyFeedbackIframeSrc,
    bootFeedbackFormPrefill,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (doc) {
    bootFeedbackFormPrefill();
  }
})();
