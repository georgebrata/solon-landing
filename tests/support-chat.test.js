"use strict";

const test = require("node:test");
const assert = require("node:assert");
const {
  parseApiResponse,
  trackSupport,
  shortSessionHash,
  API_BACKENDS,
  CHAT_BACKEND_DEFAULT,
  SHOW_AI_DISCLOSURE,
} = require("../assets/js/support-chat.js");

test("parses n8n webhook output with JSON string in data.reply", () => {
  const rawResponse = {
    reply: '{"version":"v2","content":{"type":"instagram","messages":[{"type":"text","text":"Salut! Cu ce te pot ajuta?"}],"actions":[],"quick_replies":[]}}',
    session_id: "test-session-456",
    channel: "website",
  };

  const parsed = parseApiResponse(rawResponse);
  assert.strictEqual(parsed.messages.length, 1);
  assert.strictEqual(parsed.messages[0].text, "Salut! Cu ce te pot ajuta?");
  assert.strictEqual(parsed.needsHuman, false);
});

test("parses response with needs_human action and quick_replies", () => {
  const rawResponse = {
    reply: '{"version":"v2","content":{"type":"instagram","messages":[{"type":"text","text":"Un coleg te va contacta."}],"actions":[{"action":"add_tag","tag_name":"needs_human"}],"quick_replies":[{"caption":"Optiunea 1"}]}}',
    session_id: "test-session-789",
    channel: "website",
  };

  const parsed = parseApiResponse(rawResponse);
  assert.strictEqual(parsed.messages[0].text, "Un coleg te va contacta.");
  assert.strictEqual(parsed.needsHuman, true);
  assert.strictEqual(parsed.quickReplies.length, 1);
  assert.strictEqual(parsed.quickReplies[0].caption, "Optiunea 1");
});

test("parses direct content object", () => {
  const rawResponse = {
    content: {
      messages: [{ type: "text", text: "Direct content text" }],
      actions: [],
      quick_replies: [],
    },
  };

  const parsed = parseApiResponse(rawResponse);
  assert.strictEqual(parsed.messages[0].text, "Direct content text");
});

test("parses plain string in reply", () => {
  const rawResponse = {
    reply: "Simplu text de raspuns",
  };

  const parsed = parseApiResponse(rawResponse);
  assert.strictEqual(parsed.messages[0].text, "Simplu text de raspuns");
});

test("handles null or empty response gracefully", () => {
  const parsedNull = parseApiResponse(null);
  assert.deepStrictEqual(parsedNull, { messages: [], quickReplies: [], needsHuman: false });

  const parsedEmpty = parseApiResponse({});
  assert.deepStrictEqual(parsedEmpty, { messages: [], quickReplies: [], needsHuman: false });
});

test("defaults to the Vercel backend and keeps n8n as rollback", () => {
  assert.strictEqual(CHAT_BACKEND_DEFAULT, "vercel");
  assert.strictEqual(API_BACKENDS.vercel, "https://solon-support-api.vercel.app/api/chat");
  assert.match(API_BACKENDS.n8n, /^https:\/\/solon-agency\.app\.n8n\.cloud\//);
});

test("AI disclosure caption is off by default (George, 2026-10-09)", () => {
  assert.strictEqual(SHOW_AI_DISCLOSURE, false);
});

test("parses explicit resolved action; needs_human wins over resolved", () => {
  const resolved = parseApiResponse({
    messages: [{ type: "text", text: "Cu drag!" }],
    quick_replies: [],
    actions: [{ tag_name: "resolved" }],
  });
  assert.strictEqual(resolved.resolved, true);
  assert.strictEqual(resolved.needsHuman, false);

  const both = parseApiResponse({
    messages: [{ type: "text", text: "Te conectez cu un coleg." }],
    quick_replies: [],
    actions: [{ tag_name: "resolved" }, { tag_name: "needs_human" }],
  });
  assert.strictEqual(both.needsHuman, true);
  assert.strictEqual(both.resolved, undefined);
});

test("short session hash is 8 hex chars and not the full UUID", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const hash = shortSessionHash(id);
  assert.strictEqual(hash, "14174000");
  assert.ok(!id.startsWith(hash) && hash.length === 8);
  assert.strictEqual(shortSessionHash(null), "unknown");
});

test("trackSupport uses gtag, falls back to dataLayer, and never throws", () => {
  const calls = [];
  global.window = { gtag: (...args) => calls.push(args) };
  trackSupport("support_chat_opened", { session_id: "abcd1234" });
  assert.deepStrictEqual(calls, [["event", "support_chat_opened", { session_id: "abcd1234" }]]);

  global.window = { dataLayer: [] };
  trackSupport("support_chat_message_sent", { session_id: "abcd1234", message_index: 1 });
  assert.deepStrictEqual(global.window.dataLayer, [
    { event: "support_chat_message_sent", session_id: "abcd1234", message_index: 1 },
  ]);

  global.window = {};
  assert.doesNotThrow(() => trackSupport("support_chat_resolved", {}));
  delete global.window;
});

test("GA4 event names match PLAN.md and no PII params are sent", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("../assets/js/support-chat.js"), "utf8");
  const names = [...src.matchAll(/trackSupport\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual([...new Set(names)].sort(), [
    "support_chat_answer_received",
    "support_chat_escalated",
    "support_chat_message_sent",
    "support_chat_opened",
    "support_chat_resolved",
    "support_chat_started",
  ]);
  const paramBlocks = [...src.matchAll(/trackSupport\("[a-z_]+",\s*\{([^}]*)\}/g)].map((m) => m[1]);
  paramBlocks.forEach((block) => {
    assert.ok(!/\b(text|message|email|name)\s*:/.test(block), block);
  });
});
