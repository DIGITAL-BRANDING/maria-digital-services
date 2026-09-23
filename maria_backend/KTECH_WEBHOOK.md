# K-Tech webhook

Endpoint: `POST https://<your-backend-domain>/api/webhooks/ktech`
Readiness check (browser): `GET https://<your-backend-domain>/api/webhooks/ktech`

## Setup
1. On the K-Tech partner dashboard set the **callback URL** to the endpoint above.
2. Copy the **webhook secret** from the same dashboard into the backend env var
   `KTECH_WEBHOOK_SECRET` (Railway -> Variables) and redeploy.
3. Open the GET URL in a browser. You should see `"ready": true`.
4. Press "send test webhook" on the K-Tech dashboard.

## What the server answers
| Status | Meaning |
| ------ | ------- |
| 200 | Accepted (test event, ticket settled, or an event we deliberately ignore) |
| 401 | Signature / secret did not match `KTECH_WEBHOOK_SECRET` |
| 503 | `KTECH_WEBHOOK_SECRET` is not set on the server |
| 500 | We failed while processing a valid event - K-Tech should retry |

Check the Railway logs for lines starting with `[ktech-webhook]`:
* `rejected - signature check failed` lists which header NAMES arrived (never values).
* `received ... verifiedBy` tells you which signing scheme K-Tech actually uses.

## Signature schemes accepted
K-Tech's partner docs are behind a login, so the receiver accepts the common schemes
(always requiring the shared secret): HMAC-SHA256 of the raw body (hex/base64, optional
`sha256=`), HMAC-SHA256 of `timestamp.body`, `t=...,v1=...` headers, or the secret sent in
`X-Webhook-Secret` / `Authorization: Bearer`. See `src/lib/webhook-signature.ts`.

## Ticket events
For async services (NIN validation, personalization, IPE clearance) a payload carrying
`ticket_id` + `status` settles the matching PENDING transaction: `success` marks it done,
`failed` marks it FAILED and refunds the wallet. Unknown statuses are never treated as failures.
