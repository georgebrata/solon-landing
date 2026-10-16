"use strict";

/* global SOLON_SUPPORT_CHAT_RUNTIME */

/**
 * Browser helpers for support-chat (no Node require). Values come from
 * SOLON_SUPPORT_CHAT_RUNTIME, prepended to *.min.js by scripts/minify-assets.js
 * from assets/js/support-chat-config.js.
 */

/**
 * @returns {boolean}
 */
function solonIsSupportChatEnabled() {
  if (typeof SOLON_SUPPORT_CHAT_RUNTIME === "undefined" || !SOLON_SUPPORT_CHAT_RUNTIME) {
    return false;
  }
  return SOLON_SUPPORT_CHAT_RUNTIME.isSupportChatEnabled();
}

/**
 * @param {{ src?: string } | null | undefined} currentScript
 * @returns {string | null}
 */
function solonResolveSupportChatScriptSrc(currentScript) {
  if (typeof SOLON_SUPPORT_CHAT_RUNTIME === "undefined" || !SOLON_SUPPORT_CHAT_RUNTIME) {
    return null;
  }
  return SOLON_SUPPORT_CHAT_RUNTIME.resolveSupportChatScriptSrc(currentScript);
}
