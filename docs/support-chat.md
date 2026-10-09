# Support chat widget ("Maria")

`assets/js/support-chat.js` (minified to `support-chat.min.js`, loaded by `main.js`) renders the support chat on every page. Visitors see **Maria**, SOLON customer support. Answers come from the Support Bot through the Vercel sync bridge in [georgebrata/solon-support-api](https://github.com/georgebrata/solon-support-api) (see its `README.md` and `AGENT.md`).

## Backend and rollback

- `API_BACKENDS.vercel` = `https://solon-support-api.vercel.app/api/chat` (default, `CHAT_BACKEND_DEFAULT = "vercel"`).
- `API_BACKENDS.n8n` = the old n8n webhook, kept only as a rollback path. Test it in one browser with `?chatBackend=n8n` (the CSP is report-only, so this works without a CSP change until CSP is enforced).
- Full rollback: set `CHAT_BACKEND_DEFAULT = "n8n"`, put `https://solon-agency.app.n8n.cloud` back in the `.htaccess` CSP `connect-src`, bump `SUPPORT_CHAT_REV` in `main.js`, run `npm run minify`, open a PR. George must unpause the n8n workflow (bots have no n8n access). Maria UI and GA4 events can stay.
- Request: `{ message, session_id, channel: "website" }`. Response: `{ messages[], quick_replies[{caption}], actions[{tag_name}] }`. Client abort is 65 s (`CLIENT_TIMEOUT_MS`), past the backend's 60 s limit, so the backend's own timeout reply can arrive first.

## Cache busting

`support-chat.min.js` is requested with `main.min.js`'s `?v=` token and cached for a year. **Whenever `support-chat.js` changes, bump `SUPPORT_CHAT_REV` in `assets/js/main.js`** and run `npm run minify` so every page picks up a fresh URL.

The chat UUID (`chat_session_id`) is created on the first open or the first message, not on page load. `chat_history` is stored with `chat_history_at` and dropped 24 hours after it was last saved, together with the session id (same window as the backend). A transcript with no timestamp is treated as expired.

## Maria UI and copy

- Avatar: `assets/img/maria-avatar.webp` (192x192, AI-generated fictional person; not a real person's photo). Used in the launcher (with a small chat badge), the panel header, and next to each Maria bubble.
- Header: `AGENT_NAME` "Maria" + `AGENT_ROLE` "Suport clienți".
- Copy (Romanian, informal "tu"): `GREETING`, `TYPING_MSG`, `ERROR_MSG_RATE_LIMIT` (HTTP 429: too many messages, try again in a minute), `ERROR_MSG_UNAVAILABLE` (HTTP 503 and every other failure: temporarily unavailable), `NEEDS_HUMAN_MSG`. Never "asistentul SOLON" or "bot". A stored legacy greeting is replaced on next open.
- Styles for the Maria additions are injected from JS (`MARIA_CSS`), so `style.css` and the HTML stamps don't change.
- AI disclosure: `SHOW_AI_DISCLOSURE = false` (George's decision, 2026-10-09). Setting it to `true` shows `AI_DISCLOSURE_TEXT` under the header; no other change is needed.
- Persona rule (enforced by the Support Bot, documented in the bridge `AGENT.md`): if a visitor sincerely and directly asks whether they are talking to a human or a bot/AI, Maria must not claim to be human; she deflects warmly back to helping or offers a human colleague (`needs_human`).

## GA4 events (property 420688868)

Sent with `trackSupport()` only when `window.SolonConsent.hasConsent("analytics")` is true: `gtag("event", …)` if present, else `dataLayer.push`, else no-op. Without analytics consent the event is dropped. It is not passed to the consent.js `gtag` stub and it is not pushed onto `dataLayer`, so a later grant on the same page cannot replay it.

| Event | When | Params |
| --- | --- | --- |
| `support_chat_opened` | panel opens (every open) | `session_id` |
| `support_chat_started` | first visitor message of a session (once) | `session_id` |
| `support_chat_message_sent` | every visitor message, incl. quick replies | `session_id`, `message_index` (1-based) |
| `support_chat_answer_received` | Maria's reply rendered | `session_id`, `latency_ms`, `has_quick_replies` |
| `support_chat_escalated` | reply has `needs_human` | `session_id`, `message_index` |
| `support_chat_resolved` | see rule below (once per chat session) | `session_id`, `message_count` (visitor messages only) |

`session_id` is the last 8 hex characters of the local chat UUID, never the full id. Never add message text, email, name, or any other PII to these params (a test enforces the event list and blocks `text`/`message`/`email`/`name` params).

**Resolved rule:** primary signal is an explicit `resolved` action tag in Maria's reply (no `needs_human` in the session). Fallback: the visitor closes the panel after at least one answer and with no escalation in the session. A `localStorage` flag (`chat_resolved_session`), keyed by the short session id the same way as `chat_started_session`, prevents double counting for that chat session. `message_count` is the number of visitor messages, not greeting or Maria bubbles. `needs_human` always wins over `resolved`.

Query with `user-Google-Analytics` `run_report` on property 420688868 filtered by `eventName` in the list above. Register `message_index`, `latency_ms`, `has_quick_replies`, `message_count` as custom dimensions/metrics in GA4 if you need them in Explorations.

## Tests

`npm run test:chat` (`tests/support-chat.test.js`): response parsing, `resolved`/`needs_human`, backend default, disclosure default, GA4 helper, consent gate (no `support_chat_*` on `dataLayer` before analytics consent), resolved de-dupe, 24h history TTL, error copy, event names, no-PII params.
