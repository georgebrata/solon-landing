# Agent notes

- This is a static HTML/CSS/vanilla JavaScript site. Read [docs/forms.md](docs/forms.md) before changing contact, callback, or newsletter forms.
- Blog post pages are generated from `templates/layout.html`; edit the template, then run `node scripts/build.js`.
- The pre-commit hook rebuilds and stages blog content, minified assets, HTML cache-busting query strings, the homepage, and sitemap. Inspect the working tree before committing and do not stage unrelated user changes.
- Asset cache-busting (`?v=<content-hash>` on CSS/JS/vendor refs) is applied by `scripts/stamp-asset-refs.js`, invoked from `npm run minify` and from `scripts/build.js`. New CSS/JS files are picked up by path, not an allowlist; add the HTML tag and remminify.
