# Production handover

## Prepare private configuration

`npm run production:prepare` creates `.env.production.local` with independently generated JWT, MFA-encryption and backup-encryption keys, mode 0600. It refuses to overwrite an existing file. A private configuration was generated during implementation; no secret values were printed. Keep these keys in a secret manager and retain the encryption keys separately from database backups.

Enter your real `PUBLIC_BASE_URL=https://your-hostname`, `CADDY_DOMAIN=your-hostname`, `BOOTSTRAP_ADMIN_EMAIL`, authorized mail sender/provider credentials, and payment provider credentials in that private file. The sample does not assume a domain or hosting account. Production startup refuses short/default signing secrets, missing encryption keys, non-HTTPS public URLs, and active users still using the demo password.

No hosting account/domain was supplied or connected by this implementation. These deployment files are prepared, not a published or TLS-verified deployment.

## Bootstrap and deploy

On the chosen Docker host, ensure DNS points at that host and ports 80/443 are reachable. Caddy handles certificates for the configured public hostname; see [Caddy HTTPS prerequisites](https://caddyserver.com/docs/quick-starts/https).

1. Build using `docker compose --env-file .env.production.local build`.
2. If migrating an existing installation, create a consistent SQLite backup and restore it into the data volume while the app is stopped. Never copy only the live database file while it has a WAL.
3. Run `docker compose --env-file .env.production.local run --rm app node scripts/bootstrap-admin.cjs` once. It backs up the database, creates the real administrator, and deactivates accounts still using the known demo password. A generated administrator password is written to a mode-0600 credentials file beside the database; read it locally, save it in your password manager, and remove that credentials file. Existing customer records are retained. Existing administrators use the normal reset workflow instead of rerunning bootstrap.
4. Run `docker compose --env-file .env.production.local up -d`.
5. Sign in, enroll administrator MFA, create real agent accounts, and reassign records previously owned by disabled demo accounts.
6. Verify the externally reachable HTTPS origin, certificate, login, upload and document download. Local configuration checks do not prove public reachability.

The app port is exposed only within the Compose network; Caddy publishes 80/443. Persistent volumes hold the database, encrypted backups and certificate state. Logs rotate. Docker/Caddy build and deployment were not run in the restricted workspace.

## Backups and restore

The running app schedules consistent SQLite backups. Backups include WAL-visible changes, pass SQLite integrity checks, use AES-256-GCM when configured, carry checksums, have restricted file permissions and apply retention. Use **Operations → Create backup** and **Verify by restoring** for an isolated restore exercise.

`npm run backup` performs a backup using the supplied environment. `npm run restore -- BACKUP NEW_DATABASE_PATH` decrypts, checks the checksum and integrity, and creates a new database. It refuses to overwrite an existing destination. Stop the app, verify the restored copy, then explicitly change the database path or switch files offline. Restore was tested against temporary databases, including signature blobs and payment history, plus checksum-tampering rejection.

Copy encrypted backups to storage outside the application host; the local Compose backup volume does not protect against losing the entire host. Keep the backup encryption key separately. A backup copy without its original key cannot be restored.

## Email

Configure Resend or the existing HTTP gateway as described in README. Use **Operations → Live email delivery check** to queue a test to an address you control. Confirm inbox receipt and check spam/provider status. A SENT outbox row indicates provider acceptance, not confirmed inbox delivery. Actual delivery could not be tested without provider settings and a recipient supplied by ECC.

## Online payments and refunds

Set `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`. Begin in test mode. Configure the endpoint `https://your-hostname/v1/payments/webhook` for checkout completion/async success/expiry and refund-created/refund-updated events. The endpoint validates the signature against the raw request body and rejects stale signatures or test/live-mode mismatches.

Hosted checkout uses server-calculated outstanding invoice/installment amounts. Duplicate events cannot create duplicate receipts. Amount/currency/balance mismatches are retained for reconciliation instead of silently recording an incorrect amount. Admin API `/v1/admin/payment-status` exposes attempts and refund status. Provider refunds use request IDs and only succeeded provider results become financial refund records. Card details remain on the provider's hosted page. Supported currencies currently use two decimal places: AED, USD, EUR, GBP, CAD, AUD and NZD.

Test payments/refunds were simulated with provider mocks; no real charge or refund was performed. Follow [Stripe Checkout](https://docs.stripe.com/api/checkout/sessions/create), [webhook verification](https://docs.stripe.com/webhooks/signature), and [refund API](https://docs.stripe.com/api/refunds/create) when configuring the account and running test-mode acceptance.

## Contracts, signatures, sources and verification

Enter ECC's actual approved contract wording and payment/cancellation conditions in **Agreements**. No source supplied to this task contained approved legal wording. Electronic signing captures explicit consent, the signature image, exact proposal snapshot, content hash, timestamp and request evidence, followed by staff review. The signed HTML record is downloadable and printable. This is an application evidence record; no qualified-signature-provider or jurisdiction-specific legal status is asserted.

Use **Country requirements** for source-linked, approved and dated checklist versions. Source checks found items needing review; see [fee review](FEE-REVIEW.md). No AED range was silently replaced with an unverified currency conversion.

Client activation confirms possession of the recipient-bound password setup link. Existing unverified client accounts must verify their email before password login. MFA uses authenticator codes with replay prevention and one-time recovery codes; save recovery codes before signing out.

## Browser acceptance

`npm run test:browser` is an isolated Playwright runner covering desktop and mobile application submission, signature drawing, applicant PDF output, staff assessment/documents/proposal, client acceptance/e-signing, staff review/conversion, client password activation/login, payments, receipts, case status and privacy. It writes screenshots and PDFs under `test-results/browser`.

Install Playwright and Chromium on the test host before running it. In this sandbox the runner stops with `BROWSER_ACCEPTANCE_BLOCKED` because a local listener returns `EPERM`. It was not marked passed. Provider-hosted payment UI, live inbox delivery and externally reachable TLS require separate acceptance on the chosen test deployment.
