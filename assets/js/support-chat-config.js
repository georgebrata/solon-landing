"use strict";

/** re-enable per Trello jIwDAiCn */
const SUPPORT_CHAT_ENABLED = false;

/**
 * @returns {boolean}
 */
const isSupportChatEnabled = () => SUPPORT_CHAT_ENABLED;

/**
 * Whether main.js should inject support-chat.min.js (same rules as the live loader).
 * @param {{ src?: string } | null | undefined} currentScript
 * @returns {string | null} script URL to load, or null when chat stays off
 */
const resolveSupportChatScriptSrc = (currentScript) => {
  if (!isSupportChatEnabled()) {
    return null;
  }
  if (!currentScript || !currentScript.src) {
    return null;
  }
  return currentScript.src
    .replace(/main\.min\.js(\?.*)?$/i, "support-chat.min.js$1")
    .replace(/main\.js(\?.*)?$/i, "support-chat.js$1");
};

/**
 * Prepended to main.min.js and support-chat.min.js at build time (browser runtime).
 * @returns {string} JavaScript source prefix defining `SOLON_SUPPORT_CHAT_RUNTIME`
 */
const buildBrowserRuntimePrefix = () => {
  const enabled = SUPPORT_CHAT_ENABLED;
  const enabledLiteral = enabled ? "true" : "false";
  return (
    `var SOLON_SUPPORT_CHAT_RUNTIME={SUPPORT_CHAT_ENABLED:${enabledLiteral},` +
    `isSupportChatEnabled:function(){return ${enabledLiteral};},` +
    "resolveSupportChatScriptSrc:function(currentScript){" +
    `if(!${enabledLiteral})return null;` +
    "if(!currentScript||!currentScript.src)return null;" +
    'return currentScript.src.replace(/main\\.min\\.js(\\?.*)?$/i,"support-chat.min.js$1")' +
    '.replace(/main\\.js(\\?.*)?$/i,"support-chat.js$1");}};\n'
  );
};

module.exports = {
  SUPPORT_CHAT_ENABLED,
  isSupportChatEnabled,
  resolveSupportChatScriptSrc,
  buildBrowserRuntimePrefix,
};
