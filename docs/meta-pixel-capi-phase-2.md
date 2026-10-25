# Meta Conversions API (CAPI) — phase 2 plan

This document describes a follow-up to client-side Meta Pixel + GA4 events (`assets/js/tracking.js`). **No CAPI calls ship in the tracking PR**; server events reuse the same `event_name` and `event_id` as the browser when marketing consent allows.

## Goals

- Deduplicate Meta events between Pixel and CAPI using the shared `event_id` from `solonTrack()`.
- Send **Lead** (form success) and **Purchase** (payment confirmation, separate card) from the existing Google Apps Script forms/payments backend.
- Never send personal data (email, phone, name) in event payloads; use cookies only with consent.

## Endpoint

```
POST https://graph.facebook.com/v26.0/<PIXEL_ID>/events
```

- `<PIXEL_ID>`: `400022442507673` (same as `assets/js/meta-pixel.js`).
- Access token: **Apps Script Script Property** only (e.g. `META_CAPI_TOKEN`). Not in repo, not in client JS.

## Payload shape (per event)

```json
{
  "data": [
    {
      "event_name": "Lead",
      "event_time": 1710000000,
      "event_id": "<same uuid as browser solonTrack>",
      "action_source": "website",
      "event_source_url": "https://solon.agency/programare-consultanta-gratuita/",
      "user_data": {
        "fbp": "<_fbp cookie if marketing consent>",
        "fbc": "<_fbc cookie if present>"
      },
      "custom_data": {
        "content_name": "Contact"
      }
    }
  ]
}
```

- `event_time`: Unix seconds (UTC).
- `user_data`: omit hashed email/phone (Advanced Matching stays off). Include `fbp` / `fbc` only when the server can read them and the submission is tied to a session that had marketing consent (or pass consent flag from client with the form POST for server-side gating).
- `custom_data`: mirror non-PII fields from `solonTrack` params (`content_name`, `value`, `currency`, `method`, etc.).

## When to send (server)

| Event | Trigger |
| --- | --- |
| `Lead` | Apps Script `append` succeeds for sheets Contact, Telefon (and consultation flow if added server-side). Client should include `meta_event_id` from `solonTrack()` return value in the JSON body. |
| `Purchase` | NETOPIA / payment confirmation webhook or sheet row (out of scope for the browser tracking PR). Same `event_id` pattern when the thank-you page fires Purchase client-side in a later PR. |

## Apps Script changes (sketch)

1. Accept optional `meta_event_id` (and optional `page_url`) on form POST bodies after validation.
2. After `{ ok: true }`, if `meta_event_id` is present and a consent flag indicates marketing:
   - Read `_fbp` / `_fbc` from request metadata if forwarded (or skip `user_data` if not available server-side).
   - `UrlFetchApp.fetch` to Graph API with token from `PropertiesService.getScriptProperties()`.
3. Log failures to Stackdriver / sheet audit column; do not block form save on CAPI errors.

## Testing

- Meta Events Manager → Test Events: verify browser + server events dedupe on `event_id`.
- Staging: use a test pixel or `test_event_code` query parameter (Meta docs) with a non-production token.

## Security

- Rotate CAPI token via Script Properties only.
- No tokens in git, PR descriptions, or client bundles.
- Rate-limit and validate `meta_event_id` format (UUID) server-side.
