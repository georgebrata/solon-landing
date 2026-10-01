const assert = require("assert");
const { parseApiResponse } = require("../assets/js/support-chat.js");

// Test case 1: Real n8n webhook output with JSON string in data.reply
const rawResponse1 = {
  reply: '{"version":"v2","content":{"type":"instagram","messages":[{"type":"text","text":"Salut! Cu ce te pot ajuta?"}],"actions":[],"quick_replies":[]}}',
  session_id: "test-session-456",
  channel: "website"
};

const parsed1 = parseApiResponse(rawResponse1);
assert.strictEqual(parsed1.messages.length, 1);
assert.strictEqual(parsed1.messages[0].text, "Salut! Cu ce te pot ajuta?");
assert.strictEqual(parsed1.needsHuman, false);

// Test case 2: Response with needs_human action
const rawResponse2 = {
  reply: '{"version":"v2","content":{"type":"instagram","messages":[{"type":"text","text":"Un coleg te va contacta."}],"actions":[{"action":"add_tag","tag_name":"needs_human"}],"quick_replies":[{"caption":"Optiunea 1"}]}}',
  session_id: "test-session-789",
  channel: "website"
};

const parsed2 = parseApiResponse(rawResponse2);
assert.strictEqual(parsed2.messages[0].text, "Un coleg te va contacta.");
assert.strictEqual(parsed2.needsHuman, true);
assert.strictEqual(parsed2.quickReplies.length, 1);
assert.strictEqual(parsed2.quickReplies[0].caption, "Optiunea 1");

// Test case 3: Direct content object (legacy or alternative format)
const rawResponse3 = {
  content: {
    messages: [{ type: "text", text: "Direct content text" }],
    actions: [],
    quick_replies: []
  }
};

const parsed3 = parseApiResponse(rawResponse3);
assert.strictEqual(parsed3.messages[0].text, "Direct content text");

// Test case 4: Plain string in reply
const rawResponse4 = {
  reply: "Simplu text de raspuns"
};

const parsed4 = parseApiResponse(rawResponse4);
assert.strictEqual(parsed4.messages[0].text, "Simplu text de raspuns");

console.log("All support chat parsing tests passed!");
