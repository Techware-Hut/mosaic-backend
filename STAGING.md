# Staging Integration Branch

## Purpose

The `staging` branch is the **pre-production integration branch**. It is also deployed to the hosted staging backend (see [Hosted staging](#hosted-staging)).

**MVP release strategy:** feature branch → PR → `staging` → PR → `main` → AWS Elastic Beanstalk production → [production soft-launch smoke](docs/production-smoke-checklist.md) with test accounts.

Hosted staging backend: a dedicated Elastic Beanstalk environment at `https://api-staging.mosaicbizhub.com`, deployed from the `staging` branch. Background: [docs/hosted-staging-decision.md](docs/hosted-staging-decision.md).

---

## Current state

| Layer | Role | Deploy target |
| --- | --- | --- |
| Feature work | Short-lived branch from `staging` | Local dev only |
| Integration branch | `staging` | Dedicated AWS EB staging environment + `https://api-staging.mosaicbizhub.com` |
| Production release | `main` | AWS EB + `https://api.mosaicbizhub.com` |

Production EB hostname: `mosaic-backend.us-east-1.elasticbeanstalk.com` (use custom domain for HTTPS smoke).

---

## Integration checklist (before PR to `main`)

Complete on the `staging` branch **before** opening a PR to `main`:

1. PR reviewed; security-sensitive diffs called out.
2. App boots locally with `.env` (see [SETUP.md](SETUP.md)) — not `.env.local`.
3. No secrets committed; `.env.example` updated if new vars added.
4. Docs updated: README, SETUP, DEPLOYMENT, security notes as applicable.
5. Known P0 blockers tracked in [docs/launch-readiness-report.md](docs/launch-readiness-report.md) — deployment does not close them.
6. `npm test` pass recorded (local) — see [docs/TEST_MATRIX.md](docs/TEST_MATRIX.md).

Production webhook/auth smoke still runs post-deploy on production per [DEPLOYMENT.md](DEPLOYMENT.md) and [docs/production-smoke-checklist.md](docs/production-smoke-checklist.md).

---

## Promotion rule

Do not merge `staging` → `main` until:

- Integration checklist above is complete
- Reviewer or release owner approves the PR
- Rollback readiness confirmed in [DEPLOYMENT.md](DEPLOYMENT.md)
- Required production env vars documented in [docs/production-env-checklist.md](docs/production-env-checklist.md)

**No direct commits to `main`.**

---

## Hosted staging

Hosted staging is a dedicated Elastic Beanstalk environment (`https://api-staging.mosaicbizhub.com`), deployed from the `staging` branch. It must use isolated MongoDB, S3, mail and Stripe test mode per [docs/hosted-staging-decision.md](docs/hosted-staging-decision.md). The backend treats itself as staging when `RELEASE_ENVIRONMENT` or `SENTRY_ENVIRONMENT` is `staging`.

### Isolation self-check

At startup every environment logs one line: `[isolation] {...}`. On staging only, `GET /api/ready` also returns the same object as `isolation` (production `/api/ready`, `/api/health` and `/api/build-info` are unchanged). It contains booleans/enums and the database name only, never keys, URIs, bucket names or recipient addresses:

| Field | Meaning |
| --- | --- |
| `stagingMarker`, `environment` | Staging marker detected; release environment name |
| `database.name` | Connected MongoDB database name |
| `stripe.mode` | `test` / `live` / `unset` / `unknown`, derived from the `STRIPE_SECRET_KEY` prefix |
| `stripe.webhookSigningConfigured.*` | Whether each `STRIPE_*_WEBHOOK_SECRET` (order, subscription, businessDraft, orderPostPayment, vendorVerification) is set |
| `jobs.*` | `ENABLE_ONBOARDING_REMINDERS` / `ENABLE_INVENTORY_RESERVATION_EXPIRY` effective state |
| `mail` | SMTP credentials set; recipient allowlist active; `recipientPolicy` (see below); number of valid allowlist entries |
| `sms` | `TELNYX_API_KEY` set; recipient allowlist active; `recipientPolicy`; number of valid allowlist entries |
| `storage` | `AWS_S3_BUCKET` set; `AWS_REGION` (default `us-east-1`). The bucket name is deliberately not reported; confirm it in the EB environment configuration |
| `adminEmailExplicit` | `ADMIN_EMAIL` set (otherwise code fallbacks apply) |

Expected on staging: `stripe.mode` = `test`, a staging-only database (and, checked in EB configuration, a staging-only bucket), both jobs `false` unless deliberately enabled.

### Recipient allowlist (staging only, fail closed)

| Variable | Format |
| --- | --- |
| `MAIL_RECIPIENT_ALLOWLIST` | Comma-separated exact addresses and/or `@domain` suffixes |
| `SMS_RECIPIENT_ALLOWLIST` | Comma-separated E.164 numbers (e.g. `+17575550100`) |

Whenever the staging marker is present, mail `to`/`cc`/`bcc` and the SMS destination are filtered to allowlisted recipients. Staging data may be cloned from production, so the default is to reach nobody: with the variable **unset or blank**, every send of that kind is suppressed. If none remain, nothing is handed to the provider and one redacted log line (counts plus `reason`/`policy` enums, never addresses or numbers) is written. The call does not throw, so business flows continue, and the outcome is recorded as a deliberate skip rather than a delivery or a provider failure:

- Mail: `sendMail` resolves (or calls its callback asynchronously) with a guard-only result. Paid-order email evidence records that role as `skipped` with reason `staging_recipient_allowlist_suppressed`: never `sent` (no `sentAt`, the customer is not counted as notified) and never `failed`, and the role is not re-claimed or resent. Vendor onboarding / tier-welcome / reminder deliveries report `sent: false, skipped: true` with the same reason. The marker cannot be produced by a provider response or outside staging.
- SMS: `sendSMS` returns `{ success: true, suppressed: true, status: 'suppressed' }`.
 A set variable with zero valid entries suppresses **all** sends of that kind (fail closed). While active, mail that sets `To`/`Cc`/`Bcc` through custom `headers`, uses a `raw` message, or has an explicit `envelope` with no allowlisted recipient is suppressed. Outside staging (no marker) behaviour is unchanged: a pure pass-through, whatever the variables contain.

`recipientPolicy` values: `off` (not staging, pass-through), `enforced` (filtering), `suppress_all_unset` (staging, variable unset/blank), `suppress_all_invalid` (staging, set but no valid entry). To let QA receive mail or SMS on staging, list their addresses/domains/numbers explicitly.

---

## Related docs

- [docs/README.md](docs/README.md) — documentation index
- [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md) — release owner runbook
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [SETUP.md](SETUP.md)
- [docs/launch-readiness-report.md](docs/launch-readiness-report.md)
