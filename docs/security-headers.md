# Apache security headers

Hostico serves this static site from Apache (cPanel `public_html`). Security headers live in the root `.htaccess` block marked `# BEGIN issue #29` / `# END issue #29`, wrapped in `<IfModule mod_headers.c>`. FTP deploy uploads `.htaccess` (it must stay off the exclude list).

Do not scatter extra `Header` directives in nested `.htaccess` files.

## Headers shipped

| Header | Value | Notes |
| --- | --- | --- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | **No `preload`.** `includeSubDomains` kept after verifying HTTPS on `dosargpt.solon.agency` and `link.solon.agency`. |
| `X-Content-Type-Options` | `nosniff` | |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Sends origin (not full URL) on HTTPS cross-origin requests so analytics still work. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | Stripe today is Payment Links (`buy.stripe.com` navigations), not embedded Checkout. If Checkout is ever embedded, allow `payment` for that origin. |
| `X-Frame-Options` | `SAMEORIGIN` | Enforced clickjacking control. |
| `Content-Security-Policy` | `frame-ancestors 'self'` | Enforced. Report-Only cannot apply `frame-ancestors`. |
| `Content-Security-Policy-Report-Only` | Full allowlist + `report-uri` / `report-to` | Phase 1. Does not block. Collector URL is a **placeholder** until George provides one. |
| `Report-To` / `Reporting-Endpoints` | Placeholder `csp-endpoint` | Same placeholder URL. |

## CSP reporting placeholder

The Report-Only policy includes `report-uri` and `report-to csp-endpoint`, plus `Report-To` and `Reporting-Endpoints` headers. The URL is `https://REPLACE_WITH_CSP_REPORT_COLLECTOR.invalid/` (RFC 2606 `.invalid`, so browsers will not deliver reports yet).

George must:

1. Create a collector (free [report-uri.com](https://report-uri.com/) project, or a dedicated n8n webhook — **not** the support-chat webhook).
2. Replace `https://REPLACE_WITH_CSP_REPORT_COLLECTOR.invalid/` in `.htaccess` (`Report-To`, `Reporting-Endpoints`, and `report-uri`) and in this doc.
3. Add that collector origin to `connect-src` if the Reporting API is blocked in the console.
4. Confirm reports arrive, then consider flipping Report-Only to enforcing.

Until that URL is replaced, QA is still the DevTools console.

## HSTS without preload

`includeSubDomains` is enabled. Checked 2026-10-06:

| Host | HTTPS | Certificate |
| --- | --- | --- |
| `dosargpt.solon.agency` | HTTP/2 200 | Let's Encrypt `CN=*.solon.agency`, valid through 2026-12-28 |
| `link.solon.agency` | HTTP/2 302 (Rebrandly, stays on HTTPS) | Let's Encrypt `CN=link.solon.agency`, valid through 2026-11-06 |

`mail.solon.agency`, `cpanel.solon.agency`, `webmail.solon.agency`, and `ftp.solon.agency` also answered HTTPS with a verified certificate (`ssl_verify_result=0`).

`preload` is still omitted. Submitting a domain to [hstspreload.org](https://hstspreload.org/) is a long-lived, hard-to-undo browser commitment for the whole registrable domain. Add `; preload` only after every subdomain is HTTPS **and** the owner is ready to submit the list.

## Switch CSP from Report-Only to enforcing

After homepage, a blog post, contact/callback/newsletter, Stripe plan click, Google Calendar embed, `/feedback/`, and `/unsubscribe/` show **no unexpected** Report-Only violations in DevTools (support chat is disabled; re-enable per Trello jIwDAiCn before re-testing that flow):

1. Copy the `Content-Security-Policy-Report-Only` value onto `Content-Security-Policy` (keep `frame-ancestors 'self'` in that policy).
2. Delete the `Content-Security-Policy-Report-Only` line.
3. Delete the short `Content-Security-Policy "frame-ancestors 'self'"` line so only one CSP header remains.
4. Deploy via merge to `main` (FTP). Confirm with `curl -sI https://solon.agency/` that `content-security-policy` is present and `content-security-policy-report-only` is gone.
5. Re-test the flows above. A missing host will now **block** the resource.

Cookie consent (#26) must remain the legal gate for trackers. Do not shrink the allowlist to “enforce consent”; consent-gated scripts still need these hosts after Accept.

## Server signature

`ServerSignature Off` is **not** shipped. It is a core Apache directive, not a module. Wrapping it in `<IfModule>` does not test whether `.htaccess` is allowed to use it; on Hostico a disallowed core directive 500s the whole site. Quality Bot flagged this as high.

`Header unset Server` (inside `<IfModule mod_headers.c>`) is best-effort; many shared hosts still emit `Server: Apache` / OpenResty. `ServerTokens Prod` is **not** valid in `.htaccess` — ask Hostico to set it in httpd.conf if the `Server` header must stop advertising a version.

## Third-party inventory (allowlist source)

Verified from HTML/JS in this repo (non-vendor), plus the live script bodies for counter.dev, Metricool, Ahrefs, Brevo, and the NETOPIA widget. Navigation-only links (Instagram, LinkedIn, client sites, `anpc.ro`, `buy.stripe.com`, `mpy.ro`, `forms.gle`) are **not** required in CSP unless noted.

| Purpose | Hosts | CSP directives |
| --- | --- | --- |
| First-party | `'self'` (`/assets/`, `/blog/posts.json`, forms, consent.js when #26 lands) | default / script / style / img / font / connect / frame / form-action / worker |
| GA4 / gtag | `www.googletagmanager.com`, `www.google-analytics.com`, `*.google-analytics.com`, `region1.google-analytics.com`, `analytics.google.com`, `*.analytics.google.com`, `*.googletagmanager.com`, `stats.g.doubleclick.net`, `www.google.com`, `www.google.ro` | script, img, connect |
| Meta Pixel | `connect.facebook.net`, `www.facebook.com`, `*.facebook.com` | script, img, connect |
| Microsoft Clarity | `www.clarity.ms`, `scripts.clarity.ms`, `*.clarity.ms` | script, img, connect, worker |
| Brevo tracker | Headless Chrome with the public client key, after marketing consent, requested `https://cdn.brevo.com/js/sdk-loader.js` (script), `https://sibautomation.com/sa.js` (script), and `https://in-automate.brevo.com/p` (connect, page view). No Brevo image, frame, or worker request was made, and no `cm_iframe` was created, so `frame-src` does not allow `sibautomation.com`. `worker-src` still allows `sibautomation.com` for `sw.js`. `*.brevo.com` covers the Brevo subdomains. Identify uses the same `in-automate.brevo.com` connect host. | script, connect, worker |
| Metricool | `tracker.metricool.com` (script + `c3po.jpg` beacon) | script, img, connect |
| Ahrefs | `analytics.ahrefs.com` | script, connect |
| counter.dev | `cdn.counter.dev`, `t.counter.dev` | script, connect |
| Jost + Open Sans (self-hosted) | `/assets/fonts/*.woff2`, `assets/css/fonts.css` (merged into `style.min.css`) | font (`'self'`) |
| Contact/newsletter/callback forms and the short-link click counter | `script.google.com`, `script.googleusercontent.com`, `*.script.googleusercontent.com` | connect, form-action (`assets/js/forms.js` POST to Apps Script; counter POST uses `connect-src` only and sends no API key). Homepage FAQ/testimonials are build-time only (`scripts/build-homepage-sheets.js`). |
| IP lookup | `api64.ipify.org` | connect |
| Support chat (disabled; re-enable per Trello jIwDAiCn) | `solon-agency.app.n8n.cloud` — omit from CSP while off | connect |
| Stripe Payment Links | `buy.stripe.com` is a **top-level navigation** (not CSP). `js.stripe.com` / `hooks.stripe.com` reserved if Checkout is ever embedded | frame, script |
| Cloudflare Turnstile (#31) | `challenges.cloudflare.com` | script, style, img, connect, frame, worker |
| NETOPIA / ANPC widget | Script `mny.ro/npId.js` injects an SVG from `mny.ro`. `anpc.ro` is a text link; logos are first-party under `/assets/img/` | script, img, connect |
| demoanaf.ro verified badge | `verified.js` + `GET /api/verified/badge/49995463` (`credentials: 'omit'`). Not consent-gated; see `docs/demoanaf-badge.md` if the API adds `features.consent.enabled`. | script, connect |
| Fireworks (inner pages) | `'self'` (`assets/js/vendor/fireworks-js/`, incl. `LICENSE.txt`) | script |
| Before/after slider (Marinău) | `unpkg.com` | script |
| Case-study screenshots | `i.ibb.co` | img |
| Google Calendar embed | `calendar.google.com` | frame |
| Feedback form embed | `docs.google.com` | frame |
| Unsubscribe form | `formsubmit.co` | form-action |
| Inline snippets | `'unsafe-inline'` on script-src and style-src | temporary |

`data:` is allowed for `img-src` and `font-src` (Bootstrap data-URI icons). `blob:` is allowed for `worker-src` (Clarity, Ahrefs, Turnstile).

## Coordination with other `.htaccess` issues

Suggested block order (Quality Bot):

1. Redirects (#33 / PR #36) — already above this block on `main`
2. Deny rules (#35) — already on `main`; do not reorder
3. Security headers (#29) — this block
4. Caching (#30)
5. ErrorDocument (#32)

Whichever of #29 / #30 / #32 / #33 merges later may need a trivial rebase. Keep each change inside its `# BEGIN issue #N` / `# END issue #N` markers.

Deny rules must continue to allow `/.well-known`, `/blog/posts.json`, and `/feedback/`.
