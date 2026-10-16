"use strict";

/** re-enable per Trello jIwDAiCn */
const SUPPORT_CHAT_ENABLED = false;

/**
 * @returns {boolean}
 */
function isSupportChatEnabled() {
  return SUPPORT_CHAT_ENABLED;
}

/**
 * Whether main.js should inject support-chat.min.js (same rules as the live loader).
 * @param {{ src?: string } | null | undefined} currentScript
 * @returns {string | null} script URL to load, or null when chat stays off
 */
function resolveSupportChatScriptSrc(currentScript) {
  if (!isSupportChatEnabled()) {
    return null;
  }
  if (!currentScript || !currentScript.src) {
    return null;
  }
  return currentScript.src
    .replace(/main\.min\.js(\?.*)?$/i, "support-chat.min.js$1")
    .replace(/main\.js(\?.*)?$/i, "support-chat.js$1");
}

module.exports = {
  SUPPORT_CHAT_ENABLED,
  isSupportChatEnabled,
  resolveSupportChatScriptSrc,
};
