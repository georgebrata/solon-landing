# solon-landing
Lightweight &amp; fast lading page for a digital agency from Cluj-Napoca.

<img width="1453" alt="Screenshot 2024-07-09 at 17 04 30" src="https://github.com/georgebrata/solon-landing/assets/15268479/33366e4a-c0bf-4a60-add6-5043ee7bec76">

Demo: https://solon.agency/

## Local Development
To run the project locally, simply clone the repository and open the root index.html file.
Optional: use [http-server]([url](https://github.com/http-party/http-server)) for local development

```bash
npm ci
npm run test:forms
npm run test:flags
npm run test:assets
npm audit --audit-level=high
```

## CI / Deploy

GitHub Actions (`.github/workflows/main.yml`) is the production pipeline. Issue #21's claim that `.github/workflows/` is empty is outdated; this workflow already exists and is the place to extend CI. Lighthouse CI and W3C HTML validation from #21 remain optional follow-ups.

| Event | `ci` job (`npm ci`, form/flag tests, `npm audit`) | FTP deploy |
| --- | --- | --- |
| Pull request targeting `main` | Yes | No |
| Push to `main` | Yes, then deploy | Yes, after `ci` |
| Manual **Run workflow** | Yes, then deploy | Yes, after `ci` |

Deploy uses `SamKirkland/FTP-Deploy-Action` with an exclude list so VCS, `node_modules`, tests, docs, tooling, markdown sources, `feature-flags.json`, and `.DS_Store` are not uploaded. Runtime files stay in the publish set: HTML pages, `assets/`, `robots.txt`, `sitemap.xml`, `blog/posts.json`, and `.htaccess`. Remote deletion (`dangerous-clean-slate`) is not enabled; leftover internal files already on the server must be removed in cPanel, not by CI.

`feature-flags.json` is build-time only (`scripts/apply-feature-flags.js`); the browser never fetches it. Blog sidebar JS fetches `/blog/posts.json`, which is not excluded.

`.htaccess` denies HTTP access to dotfiles (except `.well-known`), `*.md`, package/lock JSON, `feature-flags.json`, and tooling directories as defence in depth. It also 301-redirects `http://` and `www.solon.agency` to the canonical host `https://solon.agency` (path and query string preserved). `/.well-known/acme-challenge/` is not redirected so cPanel AutoSSL can renew. The same file sets HSTS, CSP Report-Only, nosniff, Referrer-Policy, Permissions-Policy, and clickjacking headers. See [docs/security-headers.md](docs/security-headers.md) to maintain the third-party allowlist or switch CSP from Report-Only to enforcing.

Repo admins should make the **ci** check required on `main`: **Settings → Branches → Add/Edit branch protection rule for `main` → Require status checks to pass before merging → search for `ci`**. Agents cannot always change that setting.

## Error reporting

Client JavaScript uses a small logger in `assets/js/error-log.js` (no Sentry SDK). It:

- writes structured console lines: `[solon <level>]` plus `{ ts, level, type, message, context }`
- catches `window` errors and unhandled promise rejections
- redacts emails, IP addresses, and phone numbers
- never includes form field values in the payload

Remote delivery is **off by default**. To enable it, set one or both of **before** `error-log.min.js` (Hostico: a small inline `<script>` in the page/template, or the constants at the top of `error-log.js`):

| Config | How | What it does |
| --- | --- | --- |
| Generic webhook | `window.SOLON_ERROR_ENDPOINT = "https://…"` | POSTs JSON (`info` and above) |
| Sentry | `window.SOLON_SENTRY_DSN = "https://<key>@<host>/<project>"` | POSTs to Sentry's Store API (`warn` and above), without loading the Sentry browser SDK |

Keep the endpoint/DSN out of git if it is secret; a public Sentry DSN is designed to be used in the browser. Failed deliveries retry with backoff and never throw into page code.

Form POST to Google Apps Script is **not** auto-retried (duplicate rows). Visitors get Romanian copy; **Încearcă din nou** is offered for network/timeout/HTTP/captcha failures, not for `too_fast` or `rate_limited`.

See [docs/forms.md](docs/forms.md) for form-specific error states.

## Features
- Responsive design
- Contact, callback, and newsletter forms submit directly to Google Apps Script using vanilla JavaScript. See [form integration documentation](docs/forms.md).
- Stripe Integration
- Wordpress Blog support (but different domain)
- FAQ section with dinamic content from Google Sheets
- **Lightweight Static Blog System**: Write in Markdown, build to static HTML.

## Support chat

The site-wide chat (`assets/js/support-chat.js`) presents **Maria** from SOLON support and calls `https://solon-support-api.vercel.app/api/chat` (backend repo: georgebrata/solon-support-api). It fires GA4 `support_chat_*` events with privacy-safe params only. Rollback to n8n, cache-busting (`SUPPORT_CHAT_REV`), events and the resolved rule: [docs/support-chat.md](docs/support-chat.md).

## Blog System

The project includes a minimal, performant static blog architecture.

### How it works
1.  **Content**: Write blog posts in Markdown (`.md`) in `/blog/posts/`.
2.  **Frontmatter**: Each post must include YAML frontmatter (title, date, slug, description, tags).
3.  **Build**: Run `node scripts/build.js` to compile Markdown files into static HTML pages in `/blog/`.
4.  **Templates**: Layout and styling are controlled via `/templates/`.
5.  **Search**: Includes client-side search and filtering by tag.

### Writing a new post
Create a new `.md` file in `/blog/posts/` with the following format:

```md
---
title: "Titlu Articol"
date: "2026-03-26"
slug: "titlu-articol"
description: "Scurtă descriere a articolului."
tags: ["tag1", "tag2"]
---

# Titlu Articol
Conținutul articolului tău aici...
```

### Automation
A Git pre-commit hook is configured to automatically run the build script and stage the generated files whenever you commit changes.

## Caching and cache-busting

Hostico Apache (`.htaccess`, issue #30) sends:

| Path | `Cache-Control` |
| --- | --- |
| `/assets/` CSS, JS, images, fonts, PDF | `public, max-age=31536000` (1 year), **only** under `/assets/` |
| HTML (including `/feedback/` and directory indexes) | `no-cache, must-revalidate` |
| `/blog/posts.json` | `no-cache, must-revalidate` |
| `/.well-known/` | `no-cache, must-revalidate` |
| `sitemap.xml`, `robots.txt` | `public, max-age=3600` (1 hour) |

`AddDefaultCharset utf-8` is set so HTML responses advertise `charset=utf-8`. `mod_expires` and `mod_headers` are wrapped in `<IfModule>` so a missing module does not 500 the site. Year-long `ExpiresByType` / `Cache-Control` apply only when `REQUEST_URI` starts with `/assets/`; a `.css` or `.js` file anywhere else is not long-cached.

Long-cache for CSS/JS is safe because HTML references those files with a content-hash query string (`style.min.css?v=a1b2c3d4e5`). `scripts/stamp-asset-refs.js` computes SHA-256 of each referenced file (first 10 hex chars) and rewrites `href`/`src` under `assets/css/`, `assets/js/`, and `assets/vendor/`. It is **path-based**, not an allowlist: any new file there (for example `consent.min.js` from #41) is stamped as soon as HTML links it. Add the tag, then run `npm run minify` (or `npm run stamp-assets` plus `node scripts/build.js` for the blog). After branded error pages (#42) land, re-run that so `404.html` / `500.html` get `?v=` too.

Images, fonts, and PDFs under `/assets/` are long-cached **without** query tokens. Do not overwrite those files in place; change the filename (or path) so browsers fetch the new object.

`.htaccess` block order: redirects (#33), deny (#35), security headers (#29), caching (#30), ErrorDocument (#32).

`npm run minify` minifies CSS/JS **then** stamps every HTML page, including `templates/layout.html`. `scripts/build.js` stamps generated blog pages so injected scripts (`blog-sidebar.js`, `blog-search.js`, `forms.min.js`) get tokens too. Images keep unique filenames and are not query-stamped.

Do not set `immutable` on HTML. After changing CSS or JS, remminify so `?v=` changes; browsers will request the new URL without a hard refresh. After later HTML PRs (consent banner #41, branded error pages #42), re-run `npm run minify` so new tags and pages are stamped.

Optional local Apache probe (needs `apache2`/`httpd` with `mod_headers` and `mod_expires`):

```bash
./scripts/test-htaccess-cache.sh
```

## CI/CD Pipeline

Three GitHub Actions workflows run automatically on every push and pull request to `main`.

| Workflow | File | What it checks |
|---|---|---|
| **Tests** | `.github/workflows/test.yml` | Form validation tests (`npm run test:forms`) and feature flag tests (`npm run test:flags`) |
| **Validate** | `.github/workflows/validate.yml` | Minified assets are up to date, feature flags dry-run passes, HTML structure is valid, blog build output is in sync |
| **Lighthouse CI** | `.github/workflows/lighthouse.yml` | Performance (≥ 80), Accessibility (≥ 90), Best Practices (≥ 90), SEO (≥ 90) scores on the homepage |

### Running checks locally

```bash
# Install dependencies
npm ci

# Run all tests
npm run test:forms
npm run test:flags
npm run test:assets

# Rebuild minified assets
npm run minify

# Refresh ?v= cache-busting tokens only (no minify)
npm run stamp-assets

# Cache-busting unit tests
npm run test:assets

# Preview feature flag changes without writing to disk
npm run flags:dry

# Rebuild blog
node scripts/build.js
```

