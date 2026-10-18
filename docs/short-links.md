# Short links

George edits the `ShortLinks` tab. The next deploy publishes each active row as a short URL on solon.agency. There is no link-creation UI in this repo.

`data/shortlinks.config.json` keeps `hitEndpoint` empty until the Apps Script `hit` action is deployed. With an empty endpoint the redirect still runs and the click is not counted.

## Add, disable, or change a link

1. Add a row, or edit one, in the sheet. Do not put an `apiKey` in `Original URL`. The visitor passes their own key.
2. `id` matches `^[A-Za-z0-9_-]{1,64}$` and is unique.
3. `Short URL` is `https://solon.agency/<path>` with one to three lowercase segments, no query and no fragment. A trailing slash is ignored. Uppercase is lowercased and warned.
4. `Original URL` is an absolute `http:` or `https:` URL, at most 2048 characters. Any host is allowed. `javascript:` and `data:` are rejected. A comma in the URL, or `]`, `[`, a quote, or a space in the query, is skipped: those characters would break Apache flags. An `apiKey` in the query or fragment, including percent-encoded and nested forms, is skipped.
5. Leave `Activ` empty to publish. Set it to FALSE to unpublish. `Tip redirect` is `302` unless the cell is `301` (the `301` applies only to non-browser clients).
6. Deploy. `node scripts/build-shortlinks.js` reads the ShortLinks tab through the same key-protected client as `scripts/build-pricing.js` (`SHEETS_API_URL` and `SHEETS_API_KEY`). With no key configured it publishes the committed snapshot and logs a message that contains neither the URL nor the key. A bad row is skipped with `::warning::` and the build continues. A fetch, pagination, schema, or validation failure, including a response with no publishable row, logs `::error::` and leaves the snapshot, `.htaccess`, and `r/` untouched.

The first path segment cannot be a top-level file or directory in the repo (`blog`, `assets`, `r`, and the rest), nor `.well-known`, `cgi-bin`, `wp-admin`, `cpanel`, `webmail`, `whm`, `cpcalendars`, `cpcontacts`, `autodiscover`, or `mail`. Two active rows with the same path, the same destination, and the same redirect type keep the first row in sheet order and log a warning for each later row. If the destination or the redirect type differs, both rows are skipped.

Check locally:

```bash
node scripts/build-shortlinks.js --offline --check
npm run test:shortlinks
```

## Query merge

The visitor's query is copied byte for byte, in the original order and encoding. A destination parameter is appended only when the visitor did not send that key. The visitor wins on a conflict. An empty visitor query leaves the destination as it is. A destination fragment is kept; otherwise the visitor's hash is appended in the browser.

Example: destination `https://x/p?language=ro&a=1`, visit `?language=en&q=%C8%99+x` → `https://x/p?language=en&q=%C8%99+x&a=1`.

Browsers (`Accept` contains `text/html`) are rewritten internally to `r/<path>/index.html`, then `location.replace` runs. Everyone else receives a `302` (or `301`) from `.htaccess`, with `NE`, `Cache-Control: no-store`, and `Vary: Accept`. Non-browser requests are not counted, so `/api?apiKey=…&sheet=…` works for scripts.

Without JavaScript the noscript refresh opens the destination without the visitor query, and the click is not counted.

## Click counter

The redirect page sends only `{ "action": "hit", "id": "<id>" }` with `fetch`, `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, and `mode: 'no-cors'`. It does not use `sendBeacon`, and it does not send the query, the path, or an apiKey. The redirect does not wait more than 300 ms.

Paste `docs/apps-script/shortlinks-hit.gs` into the bound CRUD script and deploy a new version at the same URL. Then a follow-up change can set `hitEndpoint`. The counter sets no cookie and writes only `Total clicks`.

`r/` is disallowed in `robots.txt` and is excluded from the sitemap and from IndexNow. Do not add these URLs to the homepage carousel.

## apiKey

Rows whose `Original URL` contains an `apiKey` query parameter (any capitalisation of the key, including the fragment and nested encodings) are skipped. The warning names the id and nothing else. `apiKey=` plus a value must not appear in `data/shortlinks.snapshot.json`, `.htaccess`, or `r/`.

`/api` (id `a3hb4931`) has no key in the sheet. `hu43hb44` is the same path and destination, so the build keeps `a3hb4931` and warns on `hu43hb44`. `/api/servicii`, `/api/abonamente`, and `/api/urls` are separate keyless rows. Visitors add their own key, and the query merge copies it byte for byte: `/api/servicii?apiKey=…`.

Hostico access logs and the visitor's browser history still store the full query, including an apiKey. For server-to-server calls, use the Apps Script URL directly or POST. The redirect page does not put the query in a referrer: the page sets `no-referrer`, and the request omits credentials.

## Troubleshooting

- Unknown or inactive slug: Apache returns the normal 404. Existing pages are unchanged.
- API down, malformed, empty, or a drop of more than half the published rows: the build logs `::error::` and does not write the snapshot, `.htaccess`, or `r/`. Deploy stays green and uploads the last committed files. The snapshot stores only `id`, `Original URL`, `Short URL`, `Activ`, and `Tip redirect`.
- No `SHEETS_API_KEY`: the build publishes `data/shortlinks.snapshot.json` and the log line does not include a URL or a key.
- `--check` exits 1 when `.htaccess` or `r/` would change. Run `node scripts/build-shortlinks.js --offline` and commit the result.
- A second run with the same snapshot does not change files.
