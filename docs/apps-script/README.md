# Apps Script lead-form backend

The browser posts to a **Google Apps Script** web app (`/exec`). That project lives in Google’s editor, not in git. This folder is paste-ready source so the repo and the live `doPost` handler can stay in sync.

`docs/` is excluded from FTP deploy (`.github/workflows/main.yml`) and blocked by `.htaccess`, so this file is not published on solon.agency. **Merging the landing-page PR does not update `/exec`.** Paste and redeploy this handler as part of Turnstile cutover (see below and `docs/forms.md`).

## What this script does

1. Parses `text/plain` JSON `{ action: "append", data: { ... } }`.
2. **Honeypot:** if `company_url` or `website` is non-empty, returns `{ ok: true }` without writing a row.
3. **Timing:** rejects `{ ok: false, error: "too_fast" }` when `formLoadedAt` is missing, older than 24h, or `now - formLoadedAt` is under 3 seconds (2-second clock skew allowed).
4. **Turnstile:** `siteverify` runs **only when `TURNSTILE_SECRET` and `data.turnstileToken` are both non-empty**. Then `success: true` is required (fail closed, including fetch errors). If **either** is missing, CAPTCHA is skipped so cutover cannot block leads. The client sends a token only after `TURNSTILE_SITE_KEY` in `forms.js` is a real key. Error code on failed verify: `captcha` (stable; PR #40 maps it).
5. **Rate limit:** max 5 posts / 10 minutes / sheet, keyed by `data.IP` **and** email/phone when present. Over limit: `{ ok: false, error: "rate_limited" }`.
6. Appends only the sheet columns `Data`, `Email`, `Nume`, `Mesaj`, `Telefon`, `IP` — never the token, timestamp, or honeypot.

Success and failure use `{ ok: true }` / `{ ok: false, error: "..." }` to match `assets/js/forms.js`.

## Cutover (safe in either order)

Recommended:

1. Create the Cloudflare Turnstile widget (`solon.agency`, `www.solon.agency`).
2. Set Script property `TURNSTILE_SECRET` (never git).
3. Paste this `Code.gs`, Deploy → New version. Check `/exec` vs `API_URL`.
4. Put the site key in `assets/js/forms.js`.
5. `npm run minify` (required after changing the key).
6. Deploy the site (push to `main` / FTP).
7. Verify on a test sheet.

Until **both** secret and a client token exist, live leads use honeypot + timing + rate limit only. Setting the secret before the site key does **not** return `captcha` for token-less posts. A live site key before the secret does **not** reject the extra token field.

Full step-by-step “what happens to live leads” is in `docs/forms.md` (Turnstile cutover).

## How to paste and redeploy

1. Open the existing Apps Script project attached to the leads spreadsheet (or create one bound to that sheet).
2. Replace `Code.gs` with the contents of `Code.gs` in this folder. If you already have custom append logic, keep `appendLead_()` in sync with your column headers and still call the honeypot / timing / Turnstile / rate-limit checks **before** `appendRow`.
3. **Project Settings → Script properties** → add `TURNSTILE_SECRET` = the Turnstile **secret** key (not the site key). Never commit that value.
4. Deploy → **Manage deployments** → pencil → **New version** → Deploy. Use a test deployment / test sheet first.
5. Confirm the `/exec` URL still matches `API_URL` in `assets/js/forms.js` (rotating the URL is optional; if you rotate, update the client constant and redeploy the site).

## Test sheet checklist

- Empty honeypot + waited 3s + valid Turnstile (both key and secret live) → new row.
- Filled honeypot → `{ ok: true }`, no row.
- Missing `formLoadedAt` or instant submit → `{ ok: false, error: "too_fast" }`.
- Invalid token while **both** secret and token are present → `{ ok: false, error: "captcha" }`.
- Secret set, **no** token (site key still placeholder) → row saved, not `captcha`.
- Token present, **no** secret → row saved, not `captcha`.
- Six posts in 10 minutes from the same IP or same email/phone → `{ ok: false, error: "rate_limited" }`.
