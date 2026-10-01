"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { parseApiResponse } = require("../assets/js/support-chat.js");

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
