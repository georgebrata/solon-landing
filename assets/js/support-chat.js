(function () {
  "use strict";

  /*
   * Backend. Production is the Vercel sync bridge (repo georgebrata/solon-support-api).
   * Rollback path: set CHAT_BACKEND_DEFAULT to "n8n" (and restore the n8n host in the
   * .htaccess CSP connect-src), or test a single browser with ?chatBackend=n8n.
   * Both backends share the same request/response contract.
   */
  const API_BACKENDS = {
    vercel: "https://solon-support-api.vercel.app/api/chat",
    n8n: "https://solon-agency.app.n8n.cloud/webhook/customer-support-agent",
  };
  const CHAT_BACKEND_DEFAULT = "vercel";

  /*
   * AI-disclosure caption under the header. OFF by George's decision (2026-10-09).
   * Keep this code path so it can be switched on (set to true) without other changes.
   */
  const SHOW_AI_DISCLOSURE = false;
  const AI_DISCLOSURE_TEXT = "Răspunsuri generate cu ajutorul AI";

  const AGENT_NAME = "Maria";
  const AGENT_ROLE = "Suport clienți";
  const AVATAR_URL = "/assets/img/maria-avatar.webp";

  const SESSION_KEY = "chat_session_id";
  const HISTORY_KEY = "chat_history";
  const HISTORY_AT_KEY = "chat_history_at";
  const STARTED_KEY = "chat_started_session";
  const RESOLVED_KEY = "chat_resolved_session";
  const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
  const CLIENT_TIMEOUT_MS = 65000;
  const GREETING = "Bună! Sunt Maria, de la suportul SOLON. Cu ce te pot ajuta azi?";
  const TYPING_MSG = "Maria scrie…";
  const ERROR_MSG_RATE_LIMIT =
    "Ai trimis multe mesaje într-un timp scurt. Așteaptă un minut și încearcă din nou.";
  const ERROR_MSG_UNAVAILABLE =
    "Chatul nu e disponibil acum. Încearcă din nou mai târziu.";
  const NEEDS_HUMAN_MSG = "Te pun în legătură cu un coleg din echipă, care te va contacta în curând.";

  function resolveApi() {
    let backend = CHAT_BACKEND_DEFAULT;
    try {
      const override = new URLSearchParams(window.location.search).get("chatBackend");
      if (override && Object.prototype.hasOwnProperty.call(API_BACKENDS, override)) {
        backend = override;
      }
    } catch {
      /* keep default */
    }
    return API_BACKENDS[backend];
  }

  /*
   * GA4 (property 420688868). Privacy: only event names, a short session hash,
   * counters, booleans and latency. Never message text, email, name or the full
   * session UUID.
   * consent.js installs a gtag stub that pushes into dataLayer before a choice.
   * Drop the event until analytics consent. Do not call gtag and do not push
   * dataLayer, or a later grant on the same page can replay the queue.
   */
  function trackSupport(eventName, params) {
    try {
      if (typeof window === "undefined") return;
      if (!window.SolonConsent?.hasConsent("analytics")) return;
      if (typeof window.gtag === "function") {
        window.gtag("event", eventName, params || {});
        return;
      }
      if (Array.isArray(window.dataLayer)) {
        window.dataLayer.push(Object.assign({ event: eventName }, params || {}));
      }
    } catch {
      /* no-op */
    }
  }

  function shortSessionHash(id) {
    const hex = String(id || "").replace(/[^0-9a-f]/gi, "");
    return hex.slice(-8) || "unknown";
  }

  function analyticsSessionId() {
    try {
      return shortSessionHash(localStorage.getItem(SESSION_KEY));
    } catch {
      return "unknown";
    }
  }

  function readFlag(storage, key) {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeFlag(storage, key, value) {
    try {
      storage.setItem(key, value);
    } catch {
      /* no-op */
    }
  }

  function countUserMessages(history) {
    return history.filter((entry) => entry && entry.role === "user").length;
  }

  function sessionEscalated(history) {
    return history.some((entry) => entry && entry.needsHuman);
  }

  function sessionHasAnswer(history) {
    return history.some((entry) => entry && entry.role === "bot" && entry.answered);
  }

  function markResolved(history) {
    const sid = analyticsSessionId();
    // localStorage, keyed by the chat session, same as STARTED_KEY. A
    // sessionStorage flag resets when the tab closes while the transcript
    // remains, so the next visit would count resolved again.
    if (readFlag(localStorage, RESOLVED_KEY) === sid) return;
    writeFlag(localStorage, RESOLVED_KEY, sid);
    trackSupport("support_chat_resolved", {
      session_id: sid,
      message_count: countUserMessages(history),
    });
  }

  function chatErrorMessage(status) {
    if (status === 429) return ERROR_MSG_RATE_LIMIT;
    return ERROR_MSG_UNAVAILABLE;
  }

  let pending = false;
  let isOpen = false;
  let root;
  let launcher;
  let panel;
  let messagesEl;
  let typingEl;
  let quickRepliesEl;
  let inputEl;
  let sendBtn;
  let closeBtn;

  let memorySessionId = "";

  function storageRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* no-op */
    }
  }

  function clearChatStorage() {
    storageRemove(HISTORY_KEY);
    storageRemove(HISTORY_AT_KEY);
    storageRemove(SESSION_KEY);
    storageRemove(STARTED_KEY);
    storageRemove(RESOLVED_KEY);
  }

  function chatStorageFresh() {
    const savedAt = Number(readFlag(localStorage, HISTORY_AT_KEY));
    return savedAt > 0 && Date.now() - savedAt <= HISTORY_TTL_MS;
  }

  function expireChatIfNeeded() {
    const hasHistory = readFlag(localStorage, HISTORY_KEY);
    const hasSession = readFlag(localStorage, SESSION_KEY);
    if (!hasHistory && !hasSession) return;
    if (!chatStorageFresh()) clearChatStorage();
  }

  function getSessionId() {
    expireChatIfNeeded();
    try {
      let id = localStorage.getItem(SESSION_KEY);
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(SESSION_KEY, id);
        if (!localStorage.getItem(HISTORY_AT_KEY)) {
          localStorage.setItem(HISTORY_AT_KEY, String(Date.now()));
        }
      }
      return id;
    } catch {
      if (!memorySessionId) memorySessionId = crypto.randomUUID();
      return memorySessionId;
    }
  }

  function loadHistory() {
    try {
      expireChatIfNeeded();
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveHistory(items) {
    writeFlag(localStorage, HISTORY_KEY, JSON.stringify(items));
    writeFlag(localStorage, HISTORY_AT_KEY, String(Date.now()));
  }

  function isAllowedUrl(url) {
    if (typeof url !== "string" || !url.trim()) return false;
    try {
      const u = new URL(url.trim());
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  function scrollMessagesToBottom() {
    if (!messagesEl) return;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function clearQuickReplies() {
    if (!quickRepliesEl) return;
    quickRepliesEl.innerHTML = "";
    quickRepliesEl.hidden = true;
  }

  function avatarImg(className, size) {
    const img = document.createElement("img");
    img.className = className;
    img.src = AVATAR_URL;
    img.alt = "";
    img.width = size;
    img.height = size;
    img.decoding = "async";
    img.setAttribute("aria-hidden", "true");
    return img;
  }

  function appendBubbleToDom(entry) {
    const wrap = document.createElement("div");
    wrap.className =
      "solon-chat-msg solon-chat-msg--" +
      (entry.role === "user" ? "user" : "bot");

    if (entry.role !== "user") {
      wrap.classList.add("solon-chat-msg--maria");
      wrap.appendChild(avatarImg("solon-chat-msg__avatar", 28));
    }

    if (entry.text) {
      const text = document.createElement("div");
      text.className = "solon-chat-msg__text";
      text.textContent = entry.text;
      wrap.appendChild(text);
    }

    if (entry.role === "bot" && entry.buttons && entry.buttons.length) {
      const actions = document.createElement("div");
      actions.className = "solon-chat-msg__actions";
      entry.buttons.forEach((btn) => {
        if (!btn || btn.type !== "url" || !isAllowedUrl(btn.url)) return;
        const a = document.createElement("a");
        a.className = "solon-chat-msg__link-btn";
        a.href = btn.url.trim();
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = btn.caption || btn.url;
        actions.appendChild(a);
      });
      if (actions.childNodes.length) wrap.appendChild(actions);
    }

    if (entry.role === "bot" && entry.needsHuman) {
      const note = document.createElement("p");
      note.className = "solon-chat-msg__note";
      note.textContent = NEEDS_HUMAN_MSG;
      wrap.appendChild(note);
    }

    messagesEl.appendChild(wrap);
    return wrap;
  }

  function renderHistory(history) {
    messagesEl.innerHTML = "";
    history.forEach((entry) => {
      appendBubbleToDom(entry);
    });
    scrollMessagesToBottom();
  }

  const LEGACY_GREETING_PREFIX = "Bună! Sunt asistentul SOLON";

  function ensureGreeting(history) {
    if (
      history.length > 0 &&
      history[0] &&
      history[0].role === "bot" &&
      typeof history[0].text === "string" &&
      history[0].text.indexOf(LEGACY_GREETING_PREFIX) === 0
    ) {
      history[0] = { role: "bot", text: GREETING };
      saveHistory(history);
    }
    if (history.length > 0) return history;
    const next = [
      {
        role: "bot",
        text: GREETING,
      },
    ];
    saveHistory(next);
    return next;
  }

  function setInputEnabled(enabled) {
    pending = !enabled;
    if (inputEl) inputEl.disabled = !enabled;
    if (sendBtn) sendBtn.disabled = !enabled;
  }

  function showTyping(show) {
    if (!typingEl) return;
    typingEl.hidden = !show;
    if (show) scrollMessagesToBottom();
  }

  function renderQuickReplies(replies) {
    clearQuickReplies();
    if (!replies || !replies.length) return;
    const list = replies.slice(0, 11);
    list.forEach((qr) => {
      if (!qr || typeof qr.caption !== "string" || !qr.caption.trim()) return;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "solon-chat-chip";
      chip.textContent = qr.caption.trim();
      chip.addEventListener("click", () => {
        if (pending) return;
        clearQuickReplies();
        sendUserMessage(qr.caption.trim());
      });
      quickRepliesEl.appendChild(chip);
    });
    if (quickRepliesEl.childNodes.length) {
      quickRepliesEl.hidden = false;
      scrollMessagesToBottom();
    }
  }

  /**
   * Parses API response payload from the n8n webhook.
   *
   * @param {Object} data The raw response object from the webhook API.
   * @returns {{messages: Array, quickReplies: Array, needsHuman: boolean}} Standardized response object.
   */
  function parseApiResponse(data) {
    if (!data || typeof data !== "object") {
      return { messages: [], quickReplies: [], needsHuman: false };
    }

    let payload = data;
    if (data.reply) {
      if (typeof data.reply === "string") {
        try {
          payload = JSON.parse(data.reply);
        } catch {
          payload = data.reply;
        }
      } else if (typeof data.reply === "object") {
        payload = data.reply;
      }
    }

    const content =
      payload && typeof payload === "object" && payload.content
        ? payload.content
        : payload;

    let messages = [];
    if (Array.isArray(content?.messages)) {
      messages = content.messages.slice(0, 10);
    } else if (Array.isArray(payload?.messages)) {
      messages = payload.messages.slice(0, 10);
    } else if (Array.isArray(data?.messages)) {
      messages = data.messages.slice(0, 10);
    } else if (typeof payload === "string" && payload.trim()) {
      messages = [{ type: "text", text: payload.trim() }];
    } else if (typeof data?.reply === "string" && data.reply.trim()) {
      messages = [{ type: "text", text: data.reply.trim() }];
    }

    let quickReplies = [];
    if (Array.isArray(content?.quick_replies)) {
      quickReplies = content.quick_replies;
    } else if (Array.isArray(payload?.quick_replies)) {
      quickReplies = payload.quick_replies;
    } else if (Array.isArray(data?.quick_replies)) {
      quickReplies = data.quick_replies;
    }

    let actions = [];
    if (Array.isArray(content?.actions)) {
      actions = content.actions;
    } else if (Array.isArray(payload?.actions)) {
      actions = payload.actions;
    } else if (Array.isArray(data?.actions)) {
      actions = data.actions;
    }

    const needsHuman = actions.some(
      (a) => a && a.tag_name === "needs_human"
    );
    const resolved =
      !needsHuman && actions.some((a) => a && a.tag_name === "resolved");

    const result = {
      messages,
      quickReplies,
      needsHuman,
    };
    if (resolved) result.resolved = true;
    return result;
  }

  async function fetchReply(text) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      ctrl.abort();
    }, CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch(resolveApi(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          session_id: getSessionId(),
          channel: "website",
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const error = new Error("HTTP " + res.status);
        error.status = res.status;
        throw error;
      }
      const data = await res.json();
      return parseApiResponse(data);
    } finally {
      clearTimeout(timer);
    }
  }

  function botEntriesFromResponse(result) {
    const entries = [];
    const msgs = (result.messages || []).filter((m) => m && m.type === "text");
    msgs.forEach((m, idx) => {
      const buttons = Array.isArray(m.buttons)
        ? m.buttons
            .filter((b) => b && b.type === "url" && isAllowedUrl(b.url))
            .map((b) => ({
              type: "url",
              caption: b.caption,
              url: b.url,
            }))
        : [];
      entries.push({
        role: "bot",
        text: typeof m.text === "string" ? m.text : "",
        buttons: buttons,
        needsHuman: idx === msgs.length - 1 && result.needsHuman,
        answered: true,
      });
    });
    return entries;
  }

  async function sendUserMessage(text) {
    const trimmed = (text || "").trim();
    if (!trimmed || pending) return;

    const history = loadHistory();
    history.push({ role: "user", text: trimmed });
    saveHistory(history);
    appendBubbleToDom(history[history.length - 1]);
    clearQuickReplies();
    scrollMessagesToBottom();

    if (inputEl) inputEl.value = "";
    setInputEnabled(false);
    showTyping(true);

    const sid = analyticsSessionId();
    const messageIndex = countUserMessages(history);
    if (readFlag(localStorage, STARTED_KEY) !== sid) {
      writeFlag(localStorage, STARTED_KEY, sid);
      trackSupport("support_chat_started", { session_id: sid });
    }
    trackSupport("support_chat_message_sent", {
      session_id: sid,
      message_index: messageIndex,
    });
    const sentAt = Date.now();

    try {
      const result = await fetchReply(trimmed);
      showTyping(false);
      const botEntries = botEntriesFromResponse(result);
      botEntries.forEach((entry) => {
        history.push(entry);
        appendBubbleToDom(entry);
      });
      saveHistory(history);
      renderQuickReplies(result.quickReplies);
      if (botEntries.length) {
        trackSupport("support_chat_answer_received", {
          session_id: sid,
          latency_ms: Date.now() - sentAt,
          has_quick_replies: Array.isArray(result.quickReplies) && result.quickReplies.length > 0,
        });
      }
      if (result.needsHuman) {
        trackSupport("support_chat_escalated", {
          session_id: sid,
          message_index: messageIndex,
        });
      } else if (result.resolved && !sessionEscalated(history)) {
        markResolved(history);
      }
    } catch (error) {
      showTyping(false);
      const logger = globalThis?.SolonLog;
      if (typeof logger?.error === "function") {
        logger.error({
          type: "support_chat_error",
          message: error?.message,
          name: error?.name,
        });
      }
      const errEntry = { role: "bot", text: chatErrorMessage(error?.status) };
      history.push(errEntry);
      saveHistory(history);
      appendBubbleToDom(errEntry);
    }

    setInputEnabled(true);
    scrollMessagesToBottom();
    if (inputEl && isOpen) inputEl.focus();
  }

  function openPanel() {
    isOpen = true;
    getSessionId();
    trackSupport("support_chat_opened", { session_id: analyticsSessionId() });
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    document.body.classList.add("solon-chat-panel-open");

    const history = ensureGreeting(loadHistory());
    renderHistory(history);

    if (inputEl) inputEl.focus();
  }

  function closePanel() {
    // Fallback resolve heuristic (PLAN.md): closed after >=1 answer, no escalation.
    // markResolved() de-duplicates once per chat session in localStorage.
    const closingHistory = loadHistory();
    if (sessionHasAnswer(closingHistory) && !sessionEscalated(closingHistory)) {
      markResolved(closingHistory);
    }
    isOpen = false;
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    document.body.classList.remove("solon-chat-panel-open");
    launcher.focus();
  }

  function togglePanel() {
    if (isOpen) closePanel();
    else openPanel();
  }

  function onFormSubmit(e) {
    e.preventDefault();
    sendUserMessage(inputEl.value);
  }

  const MARIA_CSS = [
    ".solon-chat-launcher--maria{position:relative;padding:0;overflow:visible;background:var(--white,#fff);border:2px solid var(--primary,#03170c)}",
    ".solon-chat-launcher__avatar{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}",
    ".solon-chat-launcher__badge{position:absolute;right:-4px;bottom:-4px;width:24px;height:24px;border-radius:50%;background:var(--primary,#03170c);color:var(--white,#fff);display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,.25)}",
    ".solon-chat-launcher--maria .solon-chat-launcher__badge i{font-size:12px}",
    ".solon-chat-panel__identity{display:flex;align-items:center;gap:10px;min-width:0}",
    ".solon-chat-panel__avatar{width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.85);flex:0 0 auto}",
    ".solon-chat-panel__identity-text{min-width:0}",
    ".solon-chat-panel__role{margin:0;font-size:12px;opacity:.85;line-height:1.3}",
    ".solon-chat-panel__disclosure{margin:2px 0 0;font-size:11px;opacity:.75;line-height:1.3}",
    ".solon-chat-msg--maria{position:relative;margin-left:36px}",
    ".solon-chat-msg__avatar{position:absolute;left:-36px;bottom:0;width:28px;height:28px;border-radius:50%;object-fit:cover}",
  ].join("");

  function injectStyles() {
    if (document.getElementById("solon-support-chat-maria-css")) return;
    const style = document.createElement("style");
    style.id = "solon-support-chat-maria-css";
    style.textContent = MARIA_CSS;
    document.head.appendChild(style);
  }

  function buildUi() {
    injectStyles();
    root = document.createElement("div");
    root.id = "solon-support-chat";
    root.className = "solon-support-chat";

    launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "solon-chat-launcher";
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-controls", "solon-chat-panel");
    launcher.setAttribute("aria-label", "Vorbește cu Maria de la suportul SOLON");
    launcher.classList.add("solon-chat-launcher--maria");
    launcher.appendChild(avatarImg("solon-chat-launcher__avatar", 56));
    const launcherBadge = document.createElement("span");
    launcherBadge.className = "solon-chat-launcher__badge";
    launcherBadge.setAttribute("aria-hidden", "true");
    launcherBadge.innerHTML = '<i class="bi bi-chat-dots-fill"></i>';
    launcher.appendChild(launcherBadge);

    panel = document.createElement("div");
    panel.id = "solon-chat-panel";
    panel.className = "solon-chat-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "solon-chat-panel-title");

    const header = document.createElement("div");
    header.className = "solon-chat-panel__header";

    const identity = document.createElement("div");
    identity.className = "solon-chat-panel__identity";
    identity.appendChild(avatarImg("solon-chat-panel__avatar", 40));

    const identityText = document.createElement("div");
    identityText.className = "solon-chat-panel__identity-text";

    const title = document.createElement("h2");
    title.id = "solon-chat-panel-title";
    title.className = "solon-chat-panel__title";
    title.textContent = AGENT_NAME;

    const role = document.createElement("p");
    role.className = "solon-chat-panel__role";
    role.textContent = AGENT_ROLE;

    identityText.appendChild(title);
    identityText.appendChild(role);
    if (SHOW_AI_DISCLOSURE) {
      const disclosure = document.createElement("p");
      disclosure.className = "solon-chat-panel__disclosure";
      disclosure.textContent = AI_DISCLOSURE_TEXT;
      identityText.appendChild(disclosure);
    }
    identity.appendChild(identityText);

    closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "solon-chat-panel__close";
    closeBtn.setAttribute("aria-label", "Închide chat-ul");
    closeBtn.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';

    header.appendChild(identity);
    header.appendChild(closeBtn);

    messagesEl = document.createElement("div");
    messagesEl.className = "solon-chat-panel__messages";

    typingEl = document.createElement("div");
    typingEl.className = "solon-chat-panel__typing";
    typingEl.hidden = true;
    typingEl.setAttribute("aria-live", "polite");
    typingEl.textContent = TYPING_MSG;

    quickRepliesEl = document.createElement("div");
    quickRepliesEl.className = "solon-chat-panel__quick-replies";
    quickRepliesEl.hidden = true;

    const form = document.createElement("form");
    form.className = "solon-chat-panel__form";

    inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.className = "solon-chat-panel__input";
    inputEl.name = "message";
    inputEl.autocomplete = "off";
    inputEl.placeholder = "Scrie un mesaj…";
    inputEl.setAttribute("aria-label", "Mesaj");

    sendBtn = document.createElement("button");
    sendBtn.type = "submit";
    sendBtn.className = "solon-chat-panel__send";
    sendBtn.textContent = "Trimite";

    form.appendChild(inputEl);
    form.appendChild(sendBtn);

    panel.appendChild(header);
    panel.appendChild(messagesEl);
    panel.appendChild(typingEl);
    panel.appendChild(quickRepliesEl);
    panel.appendChild(form);

    root.appendChild(launcher);
    root.appendChild(panel);
    document.body.appendChild(root);
    document.body.classList.add("solon-support-chat-active");

    launcher.addEventListener("click", togglePanel);
    closeBtn.addEventListener("click", closePanel);
    form.addEventListener("submit", onFormSubmit);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        closePanel();
      }
    });
  }

  function init() {
    if (document.getElementById("solon-support-chat")) return;
    buildUi();
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseApiResponse,
      trackSupport,
      shortSessionHash,
      chatErrorMessage,
      getSessionId,
      loadHistory,
      saveHistory,
      markResolved,
      API_BACKENDS,
      CHAT_BACKEND_DEFAULT,
      SHOW_AI_DISCLOSURE,
      CLIENT_TIMEOUT_MS,
      HISTORY_TTL_MS,
    };
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})();
