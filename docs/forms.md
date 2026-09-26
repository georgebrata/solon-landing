# Contact, callback, and newsletter forms

The site submits these forms from the browser to a Google Apps Script web app. The shared, dependency-free implementation is `assets/js/forms.js`; the deployed file is `assets/js/forms.min.js`. Source HTML uses `data-solon-form="Contact"`, `"Telefon"`, or `"Newsletter"`. Field `name` values match the API's Romanian sheet headings.

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
    "IP": "203.0.113.1"
  }
}
```

The `data` keys depend on the form:

| Sheet | Keys |
| --- | --- |
| Contact | `Data`, `Email`, `Nume`, `Mesaj`, `IP` |
| Telefon | `Data`, `Telefon`, `IP` |
| Newsletter | `Data`, `Email`, `IP` |

Contact name is optional and is sent as an empty string if blank. Contact email/message, callback phone, and newsletter email are required and use native browser validation. Values are trimmed; message line breaks are preserved. Phone input intentionally accepts international and local formats without an imposed pattern.

The shared client sends JSON text with `Content-Type: text/plain;charset=UTF-8`, credentials omitted, and redirect following enabled. The Apps Script deployment must accept the request body as JSON text and return an origin-readable response with `{ "success": true }` after saving. A non-2xx response, unreadable response, invalid JSON, or a body without `success: true` is a failure. Example failure: `{ "success": false, "error": "..." }`. Do not use `no-cors`: opaque responses cannot confirm that a row was saved.

The form source and Apps Script project are separate. The latter is not maintained in this repository. Before release, deploy or verify its matching `doPost` handler and test browser CORS behavior with a test sheet/deployment. A timeout or lost response may happen after a row was written; do not automatically retry because this API does not promise idempotency.

## Date, IP, and opt-in

`Data` is formatted as `YYYY-MM-DD` in `Europe/Bucharest` at submission time. The client looks up the public IPv4/IPv6 address through `https://api64.ipify.org?format=json` only after browser validation passes. It times out after three seconds, caches a successful result in memory for the page session, and sends an empty `IP` when unavailable. Do not log form values or IPs in the browser console.

The contact newsletter checkbox is optional and unchecked by default. If checked, the client first submits Contact, then submits Newsletter using the same email, date, and IP. Contact success is retained if the newsletter request fails; the inline retry button submits only Newsletter. Newsletter success confirms that the request was recorded; it does not imply that an email was sent or confirmed.

## UI, source files, and generated pages

Keep the existing form appearance and IDs/classes used by surrounding CSS. Contact forms live in `index.html` and `studii-de-caz/index.html`. Callback forms are repeated in the homepage, case-study pages, privacy, terms, and cookies pages. Newsletter markup lives in `newsletter.html` and `templates/layout.html`, plus the disabled homepage feature-flag block. The blog build generates 51 newsletter instances from the template; edit the template, then run `node scripts/build.js`.

`scripts/minify-assets.js` lists JavaScript sources explicitly; keep `forms.js` there and regenerate the minified asset with `npm run minify`. The homepage newsletter flag remains disabled in `feature-flags.json`. The unsubscribe form is separate and must not be converted as part of this integration.

## Testing and safe regeneration

Run `node --test tests/forms.test.js` for the mock-based form tests. They use stubbed `fetch` responses and do not send user data or append production sheet rows. For visual checks, compare the contact card and newsletter/callback pills at desktop and mobile widths; check native validation, keyboard submission, pending state, accessible feedback, API failures, and the contact opt-in's newsletter-only retry.

For source changes, run `npm run minify`, then `node scripts/build.js`, `npm run flags:dry`, and `npm run test:flags`. Inspect generated diffs against the current working-tree contents: the pre-commit hook also rewrites Markdown, regenerates blog files and homepage content, and stages blog/assets/sitemap files. Do not stage unrelated changes. Form-only changes do not require sitemap regeneration.
