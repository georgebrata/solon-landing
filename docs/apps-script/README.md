# Apps Script lead-form backend

The browser posts to a **Google Apps Script** web app (`/exec`). That project lives in Google’s editor, not in git. This folder is paste-ready source so the repo and the live `doPost` handler can stay in sync.

`docs/` is excluded from FTP deploy (`.github/workflows/main.yml`) and blocked by `.htaccess`, so this file is not published on solon.agency.

## What this script does

1. Parses `text/plain` JSON `{ action: "append", data: { ... } }`.
2. **Honeypot:** if `company_url` or `website` is non-empty, returns `{ ok: true }` without writing a row.
3. **Timing:** rejects `{ ok: false, error: "too_fast" }` when `formLoadedAt` is missing, older than 24h, or `now - formLoadedAt` is under 3 seconds (2-second clock skew allowed).
4. **Turnstile:** if Script Property `TURNSTILE_SECRET` is set, POSTs the token to `https://challenges.cloudflare.com/turnstile/v0/siteverify` and requires `success: true`. If the property is unset, verification is skipped (matches the client placeholder key).
5. **Rate limit:** max 5 posts / 10 minutes / IP + sheet via `CacheService`.
6. Appends only the sheet columns `Data`, `Email`, `Nume`, `Mesaj`, `Telefon`, `IP` — never the token, timestamp, or honeypot.

Success and failure use `{ ok: true }` / `{ ok: false, error: "..." }` to match `assets/js/forms.js`.

## How to paste and redeploy

1. Open the existing Apps Script project attached to the leads spreadsheet (or create one bound to that sheet).
2. Replace `Code.gs` with the contents of `Code.gs` in this folder. If you already have custom append logic, keep `appendLead_()` in sync with your column headers and still call the honeypot / timing / Turnstile / rate-limit checks **before** `appendRow`.
3. **Project Settings → Script properties** → add `TURNSTILE_SECRET` = the Turnstile **secret** key (not the site key). Never commit that value.
4. Deploy → **Manage deployments** → pencil → **New version** → Deploy. Use a test deployment / test sheet first.
5. Confirm the `/exec` URL still matches `API_URL` in `assets/js/forms.js` (rotating the URL is optional; if you rotate, update the client constant and redeploy the site).

## Test sheet checklist

- Empty honeypot + waited 3s + valid Turnstile → new row.
- Filled honeypot → `{ ok: true }`, no row.
- Missing `formLoadedAt` or instant submit → `{ ok: false, error: "too_fast" }`.
- Missing/invalid token while `TURNSTILE_SECRET` is set → `{ ok: false, error: "captcha" }`.
- Six posts in 10 minutes from the same IP → `{ ok: false, error: "rate_limited" }`.
