# Agent notes

- This is a static HTML/CSS/vanilla JavaScript site. Read [docs/forms.md](docs/forms.md) before changing contact, callback, or newsletter forms.
- Blog post pages are generated from `templates/layout.html`; edit the template, then run `node scripts/build.js`.
- The pre-commit hook rebuilds and stages blog content, minified assets, HTML cache-busting query strings, the homepage, and sitemap. Inspect the working tree before committing and do not stage unrelated user changes.
- Asset cache-busting (`?v=<content-hash>` on CSS/JS/vendor refs) is applied by `scripts/stamp-asset-refs.js`, invoked from `npm run minify` and from `scripts/build.js`. New CSS/JS files are picked up by path, not an allowlist; add the HTML tag and remminify.

## Blog post front-matter

A post PR should add the markdown file and then regenerate with `node scripts/build.js && node scripts/update-homepage-blog-carousel.js`. Do not hand-edit `blog/index.html` or the homepage carousel.

After the build, optionally log the article title to the editorial Google Sheet with `node scripts/append-blog-google-sheets.js "Article title"`. That script reads the full Apps Script web app URL from env **`BLOG_SHEETS_APPEND_URL`** (set it as a GitHub Actions secret or locally when you run the script; never commit the value). If **`BLOG_SHEETS_APPEND_URL`** is unset, sheet logging is skipped with a clear message and exit code 0 so CI and deploy are not blocked.

Optional fields:

- `cluster`: one topical key. The build links every other post in that cluster under "Articole similare". A post with no cluster, or the only post in a cluster, gets no related block.
- `json_ld`: a JSON-LD document (FAQPage, HowTo, DefinedTermSet, Article, or a `@graph` of those). The build parses it, pretty-prints it, and injects exactly one `<script type="application/ld+json">` via `{{json_ld}}` in `templates/layout.html`. Invalid JSON fails the build. A non-object JSON value fails the build. `<` is escaped so a FAQ string cannot close the script. `null`, empty, and whitespace-only values count as no custom JSON-LD. If the post has no custom JSON-LD and no JSON-LD script in the body, the build emits an Article whose `image` is `https://solon.agency/assets/img/solon-metaimage.png`. `datePublished` and `dateModified` are `YYYY-MM-DD` in Europe/Bucharest, including when an unquoted YAML date arrives as a Date.
- `date_modified`: kept in `posts.json` (still before `url`) so a later edit can move that post's sitemap lastmod forward. The sitemap uses `max(stored day, date_modified or date)`, then clamps to today in Europe/Bucharest. Deploy also passes `--from-git`, which includes the page's last content-changing commit in that max.
- DefinedTerm `url`: set it to the post URL plus a `#term-...` anchor, or leave it empty and the build fills `#term-` plus the term name. The visible heading should use the same id.
- Tables: wrap them in `<div class="table-wrap">`. Only those tables get a horizontal scroll and a minimum width. Other tables are unchanged.
- `posts.json` omits `json_ld`, `faq`, `sources`, and the other heavy planning fields. It keeps `date_modified`. `url` stays the last property.

Sitemap lastmod is preserved for a page whose content date is not newer than the stored value. A date after today in Europe/Bucharest is clamped to today (`YYYY-MM-DD`). Running `node scripts/update-sitemap.js` twice must not change `sitemap.xml`.

## Case studies

Every directory under `studii-de-caz/` with an `index.html` is a published case study. Keep it linked like the others: homepage portfolio and inline nav, `studii-de-caz/index.html` hub grid, blog hub list in `templates/list.html`, `llms.txt`, and the sitemap. Related-case-study blocks on other case study pages should include it when rotating peers. Do not remove inbound links because a client relationship ended unless product or legal explicitly requests a takedown.

The production workflow runs `node scripts/update-sitemap.js --from-git` after the pricing build and before FTP. Each `<lastmod>` becomes the later of the stored day and the last commit that changed that page's content, still clamped to today in Europe/Bucharest. Cache-bust `?v=` tokens and the generated "Articole recente" / "Articole similare" blocks are not content changes, so a page that did not change keeps its stored value. A working-tree edit since `HEAD` (the pricing build can rewrite the homepage) uses today. The refreshed sitemap is uploaded and is not committed back.

## Blog sheet append (optional)

`scripts/append-blog-google-sheets.js` logs a new article title to a Google Sheet via Apps Script (see the blog post workflow above). **`BLOG_SHEETS_APPEND_URL`** must be the full deployment URL, including any required query parameter. Configure it as a GitHub Actions secret or a local env var before running the script. Without it, sheet logging is skipped (stdout names the variable only; exit 0). Tests: `npm run test:append-sheets`. Never commit the URL or secret value.

## Pricing data (SOLON API)

Homepage pricing is built at deploy time (and in tests offline) by `scripts/build-pricing.js` from the **Abonamente** and **Servicii** tabs of the "SOLON API" spreadsheet via the key-protected SOLON CRUD API.

- **URL:** optional env `SHEETS_API_URL` (Actions variable); the script default is the documented deployment URL.
- **Key:** required env `SHEETS_API_KEY` (GitHub Actions secret, same value as the Apps Script Script Property `API_KEY`). Never print, commit, or put it in browser JS.
- **Tabs** must include an `id` column; rows with a blank `id` are omitted by the API. Without ids, the live fetch fails validation and deploy falls back to `data/abonamente.snapshot.json` (build still succeeds; look for `::error::build-pricing`).
- **Snapshot:** `data/abonamente.snapshot.json` stores **Abonamente only** (allowlisted fields: `id`, package name, `Activ`, both RON prices, inclusion `Servicii` text, NETOPIA links). Internal columns such as `Notes` or the Servicii tab are not committed. On a successful API fetch, deploy refreshes the sanitized snapshot (bot commit on `main`). Do not hand-edit the snapshot. Offline cleanup: `node scripts/build-pricing.js --sanitize-snapshot`.
- **Notes/add-ons:** the homepage does not render pricing notes or add-ons; tests assert that block stays removed.
- **Checks:** `npm run test:pricing`, `node scripts/build-pricing.js --offline --check`.

## Short links

Short URLs come from the `ShortLinks` sheet and are published by `node scripts/build-shortlinks.js`. Browsers (`Accept` contains `text/html`) are rewritten to `r/<path>/index.html`, which sends `{ action: "hit", id }` with `fetch` (`credentials: 'omit'`, `referrerPolicy: 'no-referrer'`) and then `location.replace`. Other clients get a 302 from `.htaccess` with the visitor query copied byte for byte. Do not add `r/` to the sitemap, IndexNow, or the homepage carousel. `robots.txt` disallows `/r/`.

Rows whose Original URL contains an `apiKey` query parameter are skipped with a `::warning::` that names only the id. Identical short URLs keep the first sheet row and warn on the later ones; differing duplicates are both skipped. `hitEndpoint` in `data/shortlinks.config.json` is the keyed SOLON API exec URL. The redirect page posts `{ action: "hit", id }` and does not send the API key. The Apps Script counter increments `Clicks` (trimmed, any case) and falls back to `Total clicks` only when that column is absent. The snapshot drops both columns in any case. Paste `docs/apps-script/shortlinks-hit.gs` by hand; do not deploy the live script from this repo. The live read reuses `fetchTab` from `scripts/build-pricing.js` (`SHEETS_API_URL`, `SHEETS_API_KEY`). No key uses the committed snapshot. A failed fetch logs `::error::` and does not rewrite the snapshot, `.htaccess`, or `r/`. See [docs/short-links.md](docs/short-links.md).
