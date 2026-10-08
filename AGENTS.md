# Agent notes

- This is a static HTML/CSS/vanilla JavaScript site. Read [docs/forms.md](docs/forms.md) before changing contact, callback, or newsletter forms.
- Blog post pages are generated from `templates/layout.html`; edit the template, then run `node scripts/build.js`.
- The pre-commit hook rebuilds and stages blog content, minified assets, HTML cache-busting query strings, the homepage, and sitemap. Inspect the working tree before committing and do not stage unrelated user changes.
- Asset cache-busting (`?v=<content-hash>` on CSS/JS/vendor refs) is applied by `scripts/stamp-asset-refs.js`, invoked from `npm run minify` and from `scripts/build.js`. New CSS/JS files are picked up by path, not an allowlist; add the HTML tag and remminify.

## Blog post front-matter

A post PR should add the markdown file and then regenerate with `node scripts/build.js && node scripts/update-homepage-blog-carousel.js`. Do not hand-edit `blog/index.html` or the homepage carousel.

Optional fields:

- `cluster`: one topical key. The build links every other post in that cluster under "Articole similare". A post with no cluster, or the only post in a cluster, gets no related block.
- `json_ld`: a JSON-LD document (FAQPage, HowTo, DefinedTermSet, Article, or a `@graph` of those). The build parses it, pretty-prints it, and injects exactly one `<script type="application/ld+json">` via `{{json_ld}}` in `templates/layout.html`. Invalid JSON fails the build. A non-object JSON value fails the build. `<` is escaped so a FAQ string cannot close the script. `null`, empty, and whitespace-only values count as no custom JSON-LD. If the post has no custom JSON-LD and no JSON-LD script in the body, the build emits an Article whose `image` is `https://solon.agency/assets/img/solon-metaimage.png`. `datePublished` and `dateModified` are `YYYY-MM-DD` in Europe/Bucharest, including when an unquoted YAML date arrives as a Date.
- `date_modified`: kept in `posts.json` (still before `url`) so a later edit can move that post's sitemap lastmod forward. The sitemap uses `max(stored day, date_modified or date)`, then clamps to today in Europe/Bucharest.
- DefinedTerm `url`: set it to the post URL plus a `#term-...` anchor, or leave it empty and the build fills `#term-` plus the term name. The visible heading should use the same id.
- Tables: wrap them in `<div class="table-wrap">`. Only those tables get a horizontal scroll and a minimum width. Other tables are unchanged.
- `posts.json` omits `json_ld`, `faq`, `sources`, and the other heavy planning fields. It keeps `date_modified`. `url` stays the last property.

Sitemap lastmod is preserved for a page whose content date is not newer than the stored value. A date after today in Europe/Bucharest is clamped to today (`YYYY-MM-DD`). Running `node scripts/update-sitemap.js` twice must not change `sitemap.xml`.

Do not add links to `/studii-de-caz/avocat-dumitrescu-alexandru/` in templates, the hub, the carousel, related posts, or `llms.txt`. The page and its sitemap entry stay until Legal clears them.
