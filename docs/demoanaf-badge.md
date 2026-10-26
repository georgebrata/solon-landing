# demoanaf.ro verified-company badge

SOLON S.R.L. (CUI `49995463`, domain `solon.agency`) is verified on [demoanaf.ro](https://demoanaf.ro/). Public pages with the standard site footer load:

- `<script defer src="https://demoanaf.ro/verified.js"></script>` in `<head>`
- `<div data-demoanaf="49995463"></div>` in the footer bottom row (next to copyright / credits)

`scripts/sync-demoanaf-badge.js` keeps those markers aligned across static HTML. Blog posts are generated from `templates/layout.html` via `node scripts/build.js`.

**Excluded pages** (no badge): `r/` short-link loaders; `templates/` sources; `403.html`, `404.html`, `500.html`; `client-nou/`; `cookies/index.html` (legal: cookie policy page stays unchanged); HTML without `<footer id="footer">` (e.g. `newsletter.html`, `oferta/`).

## Cookie consent and third-party scripts

The badge is **not** gated behind SOLON cookie consent. As of the integration date, `verified.js` does not set cookies or storage; it fetches `https://demoanaf.ro/api/verified/badge/49995463` with `credentials: 'omit'`.

**Risk:** if demoanaf’s API ever returns `features.consent.enabled`, `verified.js` may inject `https://demoanaf.ro/consent.js` (a third-party consent banner). That would stack on top of SOLON’s own consent UI. We do not gate the badge locally, but operators should **recheck the live API response** after demoanaf deploys and before raising CSP or consent scope.

```bash
curl -sS 'https://demoanaf.ro/api/verified/badge/49995463' | head
```

If `features.consent.enabled` appears, decide with legal whether to keep the badge, block that script path, or negotiate a SOLON-only embed.

## CSP (Report-Only)

`https://demoanaf.ro` is allowlisted in `.htaccess` for `script-src` and `connect-src` (badge API). See `docs/security-headers.md` for the full inventory.
