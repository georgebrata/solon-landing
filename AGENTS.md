# Agent notes

- This is a static HTML/CSS/vanilla JavaScript site. Read [docs/forms.md](docs/forms.md) before changing contact, callback, or newsletter forms.
- Blog post pages are generated from `templates/layout.html`; edit the template, then run `node scripts/build.js`.
- The pre-commit hook rebuilds and stages blog content, minified assets, the homepage, and sitemap. Inspect the working tree before committing and do not stage unrelated user changes.
