"use strict";

/**
 * /feedback/?e=<email> — prefill Google Form email field and strip `e` from the URL
 * before consent-gated trackers read location.href.
 */
(function () {
  const FEEDBACK_FORM_BASE_SRC =
    "https://docs.google.com/forms/d/e/1FAIpQLScGk_sLoxOYV7O2dwqCaxgZ6lqlTe7NZagVa3zjj-Pk5PI9nw/viewform?embedded=true";
  const EMAIL_ENTRY_ID = "1640447617";
  const EMAIL_QUERY_PARAM = "e";
  const EMAIL_MAX_LENGTH = 254;
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
   * @param {unknown} raw
   * @returns {string|null}
   */
  function normalizeFeedbackEmailParam(raw) {
    if (raw == null) {
      return null;
    }
    let value = String(raw).trim();
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
  function isConservativeFeedbackEmail(value) {
    if (!value || value.length > EMAIL_MAX_LENGTH) {
      return false;
    }
    if (/[\s<>"']/u.test(value)) {
      return false;
    }
    const at = value.indexOf("@");
    if (at <= 0 || at !== value.lastIndexOf("@")) {
      return false;
    }
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    return Boolean(local && domain && domain.includes("."));
  }

  /**
   * @param {string} href
   * @returns {{ pathAndQuery: string, rawEmail: string|null, stripped: boolean }}
   */
  function stripFeedbackEmailFromHref(href) {
    try {
      const url = new URL(href);
      const stripped = url.searchParams.has(EMAIL_QUERY_PARAM);
      const rawEmail = url.searchParams.get(EMAIL_QUERY_PARAM);
      if (stripped) {
        url.searchParams.delete(EMAIL_QUERY_PARAM);
      }
      return {
        pathAndQuery: url.pathname + url.search + url.hash,
        rawEmail,
        stripped,
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
   * @param {Document} targetDoc
   * @param {string|null} email
   * @returns {void}
   */
  function applyFeedbackIframePrefill(targetDoc, email) {
    if (!email) {
      return;
    }
    const src = buildFeedbackFormSrc(email);
    if (!src) {
      return;
    }
    const frame = targetDoc.querySelector(`iframe[title="${IFRAME_TITLE}"]`);
    if (frame && typeof frame.src === "string") {
      frame.src = src;
    }
  }

  /**
   * @param {string} path
   * @returns {boolean}
   */
  function isFeedbackPrefillPath(path) {
    return /\/feedback(\/(index\.html)?)?$/iu.test(path || "");
  }

  /**
   * @returns {void}
   */
  function bootFeedbackFormPrefill() {
    if (!doc || !win.location) {
      return;
    }
    const path = win.location.pathname || "";
    if (!isFeedbackPrefillPath(path)) {
      return;
    }
    const email = applyFeedbackUrlHygiene(win);
    /**
     * @returns {void}
     */
    function onReady() {
      applyFeedbackIframePrefill(doc, email);
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
    normalizeFeedbackEmailParam,
    isConservativeFeedbackEmail,
    stripFeedbackEmailFromHref,
    buildFeedbackFormSrc,
    applyFeedbackUrlHygiene,
    applyFeedbackIframePrefill,
    isFeedbackPrefillPath,
    bootFeedbackFormPrefill,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (doc) {
    bootFeedbackFormPrefill();
  }
})();
