# Contact, callback, and newsletter forms

The site submits these forms from the browser to a Google Apps Script web app. The shared, dependency-free implementation is `assets/js/forms.js`; the deployed file is `assets/js/forms.min.js`. Source HTML uses `data-solon-form="Contact"`, `"Telefon"`, or `"Newsletter"`. Field `name` values match the API's Romanian sheet headings.

Paste-ready Apps Script source lives in `docs/apps-script/Code.gs` (not FTP-deployed). The live `/exec` project is still edited in Google’s Apps Script console — copy from that file when the handler changes.

## Endpoint and payload

The endpoint is the deployed `/exec` URL in `assets/js/forms.js`. Each form appends to the sheet named by its `sheet` query parameter and sends:

```json
{
  "action": "append",
  "data": {
    "Data": "YYYY-MM-DD",
    "Email": "john@example.com",
    "Nume": "John Doe",
    "Mesaj": "Hello from the site",
    "IP": "203.0.113.1",
    "formLoadedAt": 1700000000000,
    "turnstileToken": "0.xxxxx"
  }
}
```

`formLoadedAt` is the epoch millisecond timestamp recorded when the form script bound the page. `turnstileToken` is included only when a real Turnstile site key is configured (not the `TURNSTILE_SITE_KEY` placeholder).

The `data` keys that are written to the sheet depend on the form:

| Sheet | Keys |
| --- | --- |
| Contact | `Data`, `Email`, `Nume`, `Mesaj`, `IP` |
| Telefon | `Data`, `Telefon`, `IP` |
| Newsletter | `Data`, `Email`, `IP` |

Contact name is optional and is sent as an empty string if blank. Contact email/message, callback phone, and newsletter email are required and use native browser validation. Values are trimmed; message line breaks are preserved. Phone input intentionally accepts international and local formats without an imposed pattern.

The shared client sends JSON text with `Content-Type: text/plain;charset=UTF-8`, credentials omitted, and redirect following enabled. The Apps Script deployment must accept the request body as JSON text and return an origin-readable response with `{ "ok": true }` after saving. A non-2xx response, unreadable response, invalid JSON, or a body without `ok: true` is a failure. Example failure: `{ "ok": false, "error": "..." }`. Do not use `no-cors`: opaque responses cannot confirm that a row was saved. (`success: true` is not the client contract.)

The form source and the live Apps Script project are separate. Before release, paste `docs/apps-script/Code.gs`, set `TURNSTILE_SECRET` (only when a real Turnstile site key is also configured), redeploy, and test browser CORS behavior with a test sheet/deployment. A timeout or lost response may happen after a row was written; do not automatically retry because this API does not promise idempotency. The UI shows a Romanian error; **Încearcă din nou** is offered for network/timeout/HTTP/captcha failures, not for `too_fast` or `rate_limited`. Public IP lookup (GET) does retry with backoff because it is safe to repeat.

## Error states and logging

Timeouts (20s), network failures, HTTP errors, unconfirmed API responses, `captcha`, `too_fast`, and `rate_limited` each show a distinct Romanian message in `[data-form-status]`. The status region stays `aria-live="polite"`. Failures keep field values; success still resets the form. Immediate retry is omitted for `too_fast` and `rate_limited` so the button cannot skip the timing window or the rate limit.

`assets/js/error-log.js` (deployed as `error-log.min.js`) records structured client events: timestamp, level, type, sanitized message. It never logs emails, phone numbers, IPs, or field values. Form submit success is an `info` audit event with only the form type (`Contact`, `Telefon`, `Newsletter`). Remote reporting is off until you set `window.SOLON_ERROR_ENDPOINT` and/or `window.SOLON_SENTRY_DSN` **before** `error-log.min.js` (Hostico cPanel: a small inline script in the template, or the constants at the top of `error-log.js`). See the README error-reporting section. Do not log form values or IPs in the browser console.

## Spam protection

Layered checks run in the browser and again in Apps Script. Client-only checks are not enough: the `/exec` URL is public.

### Honeypot

Every `data-solon-form` includes a `company_url` field in a `.solon-hp` wrapper. It is positioned off-screen (`left: -10000px`, not `display: none` alone), marked `aria-hidden="true"`, `inert`, `tabindex="-1"`, and `autocomplete="off"` so screen readers and keyboard users skip it.

If the field is non-empty, the client **does not** call the API or ipify. It shows the same generic success message as a real save (fake success) so bots are not tipped off. Apps Script also treats a non-empty honeypot as `{ ok: true }` without appending a row.

### Minimum time-to-submit

On bind, the client stores `data-form-loaded-at` / `formLoadedAt` from `Date.now()`. Submits faster than **3 seconds** are rejected in the client with a Romanian error (`Trimiterea a fost prea rapidă…`) and are not sent. The server rejects missing, stale (>24h), or too-fast timestamps (`error: "too_fast"`), allowing about 2 seconds of clock skew. The error UI does not show an immediate retry for this code.

### Cloudflare Turnstile

The **site key** lives in one place: `const TURNSTILE_SITE_KEY` at the top of `assets/js/forms.js` (placeholder `"TURNSTILE_SITE_KEY"`). The **secret** is only `TURNSTILE_SECRET` in Apps Script Script Properties — never in git.

- Placeholder or empty key: the widget is not loaded, no token is sent, honeypot and timing still run. Forms keep working.
- Real site key: `forms.js` loads `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`, renders an `interaction-only` widget per form, and sends `data.turnstileToken`. A missing token fails the submit with the Romanian captcha message. Each Apps Script post consumes a token and resets the widget so the Contact → Newsletter opt-in path can request a fresh token.
- Server: `UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', …)`. Turnstile is enforced only when **both** the site key and `TURNSTILE_SECRET` are set. If the secret is unset, verification is skipped (same degrade path as the placeholder). If it is set, `success: true` is required before append. `{ ok: false, error: "captcha" }` maps to the Romanian captcha copy.

Hostnames for the Turnstile widget: `solon.agency` and `www.solon.agency` (plus `localhost` if you test locally).

### Rate limiting

Apps Script `CacheService` allows **5** posts per **10 minutes** per IP + sheet name. Over the limit returns `{ ok: false, error: "rate_limited" }` without writing. The client shows a wait message and does not offer an immediate retry.

### CSP note for issue #29

When Content-Security-Policy is added, Turnstile needs `challenges.cloudflare.com` in **`script-src`**, **`frame-src`**, and **`connect-src`**. Do not add that allowlist only on the client; the widget iframes a challenge from that host.

## Date, IP, and opt-in

`Data` is formatted as `YYYY-MM-DD` in `Europe/Bucharest` at submission time. The client looks up the public IPv4/IPv6 address through `https://api64.ipify.org?format=json` only after browser validation, honeypot, and timing checks pass. It times out after three seconds, caches a successful result in memory for the page session, and sends an empty `IP` when unavailable. Do not log form values or IPs in the browser console.

The contact newsletter checkbox is optional and unchecked by default. If checked, the client first submits Contact, then submits Newsletter using the same email, date, and IP (and a new Turnstile token when the widget is enabled). Contact success is retained if the newsletter request fails; the inline retry button submits only Newsletter. Newsletter success confirms that the request was recorded; it does not imply that an email was sent or confirmed.

## UI, source files, and generated pages

Keep the existing form appearance and IDs/classes used by surrounding CSS. Contact forms live in `index.html` and `studii-de-caz/index.html`. Callback forms are repeated in the homepage, case-study pages, privacy, terms, and cookies pages. Newsletter markup lives in `newsletter.html` and `templates/layout.html`, plus the disabled homepage feature-flag block. The blog build generates newsletter instances from the template; edit the template, then run `node scripts/build.js`.

`scripts/minify-assets.js` lists JavaScript sources explicitly; keep `forms.js` and `error-log.js` there and regenerate the minified assets with `npm run minify`. The homepage newsletter flag remains disabled in `feature-flags.json`. The unsubscribe form is separate and must not be converted as part of this integration.

## Testing and safe regeneration

Run `node --test tests/forms.test.js tests/error-log.test.js` (or `npm run test:forms`) for the mock-based form and logger tests. They use stubbed `fetch` responses and do not send user data or append production sheet rows. Coverage includes honeypot short-circuit, the 3-second timing guard, Turnstile token inclusion, the placeholder-key degrade path, timeout/network copy, `captcha` / `too_fast` / `rate_limited` messages, and that immediate retry is omitted for timing and rate-limit failures. For visual checks, compare the contact card and newsletter/callback pills at desktop and mobile widths; check native validation, keyboard submission, pending state, accessible feedback, API failures, and the contact opt-in's newsletter-only retry. Confirm the honeypot is not in the tab order and is not announced by a screen reader.

For source changes, run `npm run minify`, then `node scripts/build.js`, `npm run flags:dry`, and `npm run test:flags`. Inspect generated diffs against the current working-tree contents: the pre-commit hook also rewrites Markdown, regenerates blog files and homepage content, and stages blog/assets/sitemap files. Do not stage unrelated changes. Form-only changes do not require sitemap regeneration.
