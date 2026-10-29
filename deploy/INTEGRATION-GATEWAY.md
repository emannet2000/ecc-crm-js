# Provider gateway contract

This contract is implemented by ECC CRM. It does not describe or claim compatibility with a provider's native webhook/API. Build or connect a trusted gateway for the chosen calendar, communication, accounting and identity/signature providers, then authorize those accounts.

## Configuration

```
ECC_INTEGRATION_GATEWAY_URL=https://your-gateway.example/jobs
ECC_INTEGRATION_GATEWAY_TOKEN=private-gateway-bearer-token
ECC_INTEGRATION_WEBHOOK_SECRET=independent-random-secret-of-at-least-32-bytes
```

Only HTTPS outbound URLs are accepted. Redirects are rejected. The five-second worker does nothing while unconfigured. Enable an integration area and name its gateway-supported provider in **Advanced workflows → Integrations**. Credentials belong in the private deployment environment, not provider-name fields or payloads.

## Outbound jobs

CRM sends POST JSON `{id, kind, payload}` with `Authorization: Bearer TOKEN` and `Idempotency-Key: id`. The gateway must durably deduplicate this ID, preserve the CRM resource IDs, and return the same provider operation after repeated requests. It must enforce its own native provider callback verification and OAuth/account scope checks.

Respond with `{id, state: "PENDING" | "SUCCEEDED", provider_reference, url?, version?}`. The ID must match. Hosted customer URLs must use HTTPS. A request has a 15-second deadline. Timeouts, malformed responses and interrupted sends become `UNKNOWN` and require reconciliation; they are not automatically resent. Non-success HTTP responses become `FAILED` and also require explicit reconciliation before retry.

Kinds:

- `CALENDAR_UPSERT`, `CALENDAR_CANCEL`: `provider`, `task_id`, `title`, `starts_at`, `ends_at`, `status`, `local_hash`, prior `external_id`/`remote_version`. Associate the job's `user_id`/connection with an authorized provider calendar; do not guess a global calendar. CRM currently sends one configured provider per task. The gateway should perform conditional writes using native version identifiers and report conflicts, not silently overwrite concurrent remote edits.
- `SMS_SEND`, `WHATSAPP_SEND`, `EMAIL_SEND`: `provider`, `channel`, verified `to`, `body`. The gateway must map sender accounts, obey messaging consent/provider rules, and send verified inbound messages through this contract.
- `ACCOUNTING_INVOICE`, `ACCOUNTING_RECEIPT`, `ACCOUNTING_REFUND`: `provider` and complete CRM financial snapshots. Use stable invoice/payment/refund IDs for native upserts; different content versions are updates to the same resource, not new invoices/charges. Enforce receipt/refund prerequisites and retain reconciliation failures.
- `IDENTITY_CREATE`, `SIGNATURE_CREATE`: `provider`, `session_id`, case reference/name/email; signatures also include the exact proposal snapshot and `content_hash`. The gateway must use the selected service's actual consent, identity verification and signature evidence process and retain a downloadable evidence record externally.

The dispatch envelope also includes `lead_id` and `user_id` so the gateway can select the authorized account and preserve case association. Never expose another staff member's calendar or an unrelated customer's data.

## Signed callbacks

POST raw JSON to `/v1/public/integrations/events`:

```
{"id":"unique-provider-event-id","kind":"message.received","data":{...}}
```

Headers:

- `X-ECC-Timestamp`: current Unix time in seconds.
- `X-ECC-Signature`: `sha256=` plus the hex HMAC-SHA256 of `TIMESTAMP + "." + RAW_JSON_BYTES`, keyed by the webhook secret.

The timestamp must be within five minutes. Event IDs are deduplicated. Native provider signatures must be verified at the gateway before forwarding. CRM acknowledges stored unmatched/conflicting events without treating them as applied.

Events:

- `message.received`: `channel` (`SMS`, `WHATSAPP`, `EMAIL`), normalized `from`, `body`, optional `case_reference`. Phone numbers use E.164; emails are lowercase. Exactly one consented verified contact must match, otherwise staff must associate the quarantined event. Suppressed contacts produce no retained message body.
- `job.updated`: `job_id`, `state` (`PENDING`, `SUCCEEDED`, `FAILED`), `provider_reference`, optional `url`, `version`, `error`. References cannot change once bound. Cancelled/removed work cannot be revived.
- `calendar.changed`: `task_id`, `external_id`, `base_local_hash` from the last acknowledged job, provider `version`, `cancelled`, and ISO `starts_at`/`ends_at` when not cancelled. Both-sided changes or overlapping bookings create conflicts for staff review.
- `identity.completed`, `signature.completed`: `session_id`, `result` (`VERIFIED`, `REJECTED`), `provider_reference`, `evidence_reference`; signatures also require the exact `content_hash`. Provider verification does not replace staff review.

Store no gateway/provider secrets in these callbacks. Payloads may contain customer data and must follow the configured retention/erasure process. Gateway-side/provider erasure remains an external obligation tracked by CRM.
