(function () {
  "use strict";

  const API = "https://solon-agency.app.n8n.cloud/webhook/customer-support-agent";
  const SESSION_KEY = "chat_session_id";
  const HISTORY_KEY = "chat_history";
  const GREETING = "Bună! Sunt asistentul SOLON. Spune-mi cu ce te pot ajuta.";
  const ERROR_MSG = "A apărut o eroare. Te rugăm să încerci din nou.";
  const NEEDS_HUMAN_MSG = "Un coleg din echipă te va contacta.";

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

  function getSessionId() {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveHistory(items) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
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

  function appendBubbleToDom(entry) {
    const wrap = document.createElement("div");
    wrap.className =
      "solon-chat-msg solon-chat-msg--" +
      (entry.role === "user" ? "user" : "bot");

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

  function ensureGreeting(history) {
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

    return {
      messages,
      quickReplies,
      needsHuman,
    };
  }

  async function fetchReply(text) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      ctrl.abort();
    }, 60000);
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          session_id: getSessionId(),
          channel: "website",
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
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
    } catch (error) {
      showTyping(false);
      const logger = typeof globalThis !== "undefined" ? globalThis.SolonLog : null;
      if (logger && typeof logger.error === "function") {
        logger.error({
          type: "support_chat_error",
          message: error && error.message,
          name: error && error.name,
        });
      }
      const errEntry = { role: "bot", text: ERROR_MSG };
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
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    document.body.classList.add("solon-chat-panel-open");

    let history = loadHistory();
    if (history.length === 0) {
      history = ensureGreeting(history);
    }
    renderHistory(history);

    if (inputEl) inputEl.focus();
  }

  function closePanel() {
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

  function buildUi() {
    root = document.createElement("div");
    root.id = "solon-support-chat";
    root.className = "solon-support-chat";

    launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "solon-chat-launcher";
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-controls", "solon-chat-panel");
    launcher.setAttribute("aria-label", "Deschide chat-ul de suport SOLON");
    launcher.innerHTML = '<i class="bi bi-chat-dots" aria-hidden="true"></i>';

    panel = document.createElement("div");
    panel.id = "solon-chat-panel";
    panel.className = "solon-chat-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "solon-chat-panel-title");

    const header = document.createElement("div");
    header.className = "solon-chat-panel__header";

    const title = document.createElement("h2");
    title.id = "solon-chat-panel-title";
    title.className = "solon-chat-panel__title";
    title.textContent = "SOLON";

    closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "solon-chat-panel__close";
    closeBtn.setAttribute("aria-label", "Închide chat-ul");
    closeBtn.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';

    header.appendChild(title);
    header.appendChild(closeBtn);

    messagesEl = document.createElement("div");
    messagesEl.className = "solon-chat-panel__messages";

    typingEl = document.createElement("div");
    typingEl.className = "solon-chat-panel__typing";
    typingEl.hidden = true;
    typingEl.setAttribute("aria-live", "polite");
    typingEl.textContent = "…";

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
    getSessionId();
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseApiResponse };
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})();
