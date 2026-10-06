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

The form source and the live Apps Script project are separate. Merging this repo does **not** update `/exec` — paste `docs/apps-script/Code.gs` and redeploy before (or with) enabling Turnstile. Follow **Turnstile cutover** below; either-side-missing stays on honeypot + timing only. A timeout or lost response may happen after a row was written; do not automatically retry because this API does not promise idempotency.

## Spam protection

Layered checks run in the browser and again in Apps Script. Client-only checks are not enough: the `/exec` URL is public.

### Honeypot

Every `data-solon-form` includes a `company_url` field in a `.solon-hp` wrapper. It is positioned off-screen (`left: -10000px`, not `display: none` alone), marked `aria-hidden="true"`, `inert`, `tabindex="-1"`, and `autocomplete="off"` so screen readers and keyboard users skip it.

If the field is non-empty, the client **does not** call the API or ipify. It shows the same generic success message as a real save (fake success) so bots are not tipped off. Apps Script also treats a non-empty honeypot as `{ ok: true }` without appending a row.

### Minimum time-to-submit

On bind, the client stores `data-form-loaded-at` / `formLoadedAt` from `Date.now()`. Submits faster than **3 seconds** are rejected in the client with a Romanian error (`Trimiterea a fost prea rapidă…`) and are not sent. The server rejects missing, stale (>24h), or too-fast timestamps (`error: "too_fast"`), allowing about 2 seconds of clock skew.

### Cloudflare Turnstile

The **site key** lives in one place: `const TURNSTILE_SITE_KEY` at the top of `assets/js/forms.js` (placeholder `"TURNSTILE_SITE_KEY"`). After you put a real key there you **must** run `npm run minify` — Terser otherwise drops the dead Turnstile branch from `forms.min.js`. The **secret** is only `TURNSTILE_SECRET` in Apps Script Script Properties — never in git.

Turnstile is enforced **only when both** the site key and the secret are configured:

| Site key | Secret | Live leads |
| --- | --- | --- |
| Placeholder | Unset | No token sent. Server skips CAPTCHA. Honeypot + timing + rate limit. |
| Real key | Unset | Client sends `turnstileToken`. Server **does not** reject it. Same fallbacks. |
| Placeholder | Set | Client sends no token. Server **does not** demand one (`captcha` is not returned). Same fallbacks. |
| Real key | Set | Client sends a token; server `siteverify`s it. Invalid/failed verify → `{ ok: false, error: "captcha" }`. |

Error codes stay `captcha`, `too_fast`, and `rate_limited` (PR #40 maps them to Romanian UI copy).

- Placeholder or empty key: the widget is not loaded, no token is sent, honeypot and timing still run. Forms keep working.
- Real site key: `forms.js` loads `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`, renders an `interaction-only` widget per form, and sends `data.turnstileToken`. A missing widget token fails the submit **in the browser** so a key-less server skip is not used by accident. Each Apps Script post consumes a token and resets the widget so the Contact → Newsletter opt-in path can request a fresh token.
- Server: `UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', …)` **only** when secret **and** token are both non-empty. Then `success: true` is required (fail closed). Fetch/parse errors also return `captcha`.

Hostnames for the Turnstile widget: `solon.agency` and `www.solon.agency` (plus `localhost` if you test locally).

### Turnstile cutover (safe in either order)

Merging the GitHub PR deploys HTML/JS over FTP on push to `main`; it does **not** paste Apps Script. Do this on a test `/exec` + test sheet first.

**Recommended order** (what happens to **live** leads at each step):

1. **Create the Turnstile widget** in Cloudflare (hostnames `solon.agency`, `www.solon.agency`, optional `localhost`). Copy site key + secret. **Leads:** unchanged; widget is not on the site yet.
2. **Set the secret** in Apps Script → Project Settings → Script properties → `TURNSTILE_SECRET`. **Leads:** still unchanged on the *current* production handler (it ignores this property until Code.gs is pasted). After the new `Code.gs` is live, a secret without a client token does **not** return `captcha`.
3. **Paste and redeploy** `docs/apps-script/Code.gs` (Deploy → Manage deployments → New version). Confirm `/exec` still matches `API_URL` in `forms.js`. **Leads:** honeypot + timing + rate limit. CAPTCHA still skipped until the site key is on the deployed `forms.min.js`.
4. **Set the site key** in `assets/js/forms.js` (`const TURNSTILE_SITE_KEY = "..."`). **Leads on the live FTP site:** still the old minified JS until the next two steps, so still no token.
5. **Minify** with `npm run minify` (required; the placeholder path is tree-shaken out of `forms.min.js`).
6. **Deploy** the site (merge to `main` / FTP). **Leads:** browser sends tokens; Apps Script verifies them. Invalid token → `captcha`. Honeypot and timing stay on.
7. **Verify** with a test sheet: empty honeypot + 3s wait + solved widget → row; filled honeypot → no row; instant submit → `too_fast`; six posts / 10 min → `rate_limited`.

**Other orders stay safe** with the new gate (do not captcha-block real leads):

- Secret before new Code.gs: old handler ignores the property.
- New Code.gs before secret: skip CAPTCHA.
- Site key + minify + FTP **before** secret / new Code.gs: extra JSON field is ignored or skipped; leads still save.
- Secret live **before** site key: client sends no token; server does not demand one.

Do not reverse the old (pre-fix) Code.gs that returned `captcha` whenever the secret was set and the token was missing.

### Rate limiting

Apps Script `CacheService` allows **5** posts per **10 minutes** per sheet, keyed by client `IP` **and** by email/phone when present (so spoofing `data.IP` alone is not enough). Over the limit returns `{ ok: false, error: "rate_limited" }` without writing. Apps Script web apps do not expose a trusted platform client IP; `data.IP` remains a hint.

### CSP note for issue #29

When Content-Security-Policy is added, Turnstile needs `challenges.cloudflare.com` in **`script-src`**, **`frame-src`**, and **`connect-src`**. Do not add that allowlist only on the client; the widget iframes a challenge from that host.

## Date, IP, and opt-in

`Data` is formatted as `YYYY-MM-DD` in `Europe/Bucharest` at submission time. The client looks up the public IPv4/IPv6 address through `https://api64.ipify.org?format=json` only after browser validation, honeypot, and timing checks pass. It times out after three seconds, caches a successful result in memory for the page session, and sends an empty `IP` when unavailable. Do not log form values or IPs in the browser console.

The contact newsletter checkbox is optional and unchecked by default. If checked, the client first submits Contact, then submits Newsletter using the same email, date, and IP (and a new Turnstile token when the widget is enabled). Contact success is retained if the newsletter request fails; the inline retry button submits only Newsletter. Newsletter success confirms that the request was recorded; it does not imply that an email was sent or confirmed.

## UI, source files, and generated pages

Keep the existing form appearance and IDs/classes used by surrounding CSS. Contact forms live in `index.html` and `studii-de-caz/index.html`. Callback forms are repeated in the homepage, case-study pages, privacy, terms, and cookies pages. Newsletter markup lives in `newsletter.html` and `templates/layout.html`, plus the disabled homepage feature-flag block. The blog build generates newsletter instances from the template; edit the template, then run `node scripts/build.js`.

`scripts/minify-assets.js` lists JavaScript sources explicitly; keep `forms.js` there and regenerate the minified asset with `npm run minify`. The homepage newsletter flag remains disabled in `feature-flags.json`. The unsubscribe form is separate and must not be converted as part of this integration.

## Testing and safe regeneration

Run `node --test tests/forms.test.js tests/turnstile-gate.test.js` (or `npm run test:forms`) for the mock-based form tests plus the four Turnstile key/secret cutover cases. They use stubbed `fetch` responses and do not send user data or append production sheet rows. Coverage includes honeypot short-circuit, the 3-second timing guard, Turnstile token inclusion, placeholder-key degrade, and enforce-only-when-both-configured. For visual checks, compare the contact card and newsletter/callback pills at desktop and mobile widths; check native validation, keyboard submission, pending state, accessible feedback, API failures, and the contact opt-in's newsletter-only retry. Confirm the honeypot is not in the tab order and is not announced by a screen reader.

For source changes, run `npm run minify`, then `node scripts/build.js`, `npm run flags:dry`, and `npm run test:flags`. Inspect generated diffs against the current working-tree contents: the pre-commit hook also rewrites Markdown, regenerates blog files and homepage content, and stages blog/assets/sitemap files. Do not stage unrelated changes. Form-only changes do not require sitemap regeneration.
