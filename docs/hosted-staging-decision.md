# Hosted Staging — MVP Decision and Future Runbook

## MVP decision (2026-06-07)

**MVP decision (2026-06-07):** Hosted staging backend was deferred.

**Update (2026-06-17):** Staging deploy workflow added ([`.github/workflows/deploy-eb-staging.yml`](../.github/workflows/deploy-eb-staging.yml)). **AWS staging EB environment is not yet provisioned** — workflow is ready for infra setup. Until provisioned, `staging` branch remains integration-only (no deploy target).

| Layer | Role | Deploy target |
|-------|------|---------------|
| `feature/*` | Individual fixes | Local dev only |
| `staging` | Integration branch (PR review, local boot) | **None** |
| `main` | Production release | AWS Elastic Beanstalk |

Runtime validation for MVP happens **after** `main` deploy to production using **dedicated test accounts** and the [production-smoke-checklist.md](production-smoke-checklist.md). See [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md), [STAGING.md](../STAGING.md), and [DEPLOYMENT.md](../DEPLOYMENT.md).

This supersedes any prior plan to provision a separate staging EB environment before first production soft-launch.

---

## Why deferred

- Production API is already live at `https://api.mosaicbizhub.com`.
- Branch-level integration on `staging` provides code review gate without duplicate infra cost.
- Five Stripe webhooks, MongoDB, S3, and mail must be configured per environment; duplicating all of that blocks MVP velocity.
- Known P0 code blockers (see [launch-readiness-report.md](launch-readiness-report.md)) are not fixed by staging alone.

---

## Future runbook (when hosted staging is approved)

Provision these as **isolated** resources (never share production credentials):

| Resource | Requirement |
|----------|-------------|
| AWS EB environment | Separate app/env name (e.g. `mosaic-backend-staging`) |
| MongoDB | Separate cluster or database; no production data |
| S3 bucket | Staging-only bucket and IAM user/role |
| SMTP | Mail sandbox or separate sender |
| Stripe | **Test mode** keys and test webhook endpoints only |
| HTTPS URL | Custom subdomain (e.g. `staging-api.mosaicbizhub.com`) with valid TLS cert |
| Frontend | Staging Vercel/host pointing `NEXT_PUBLIC_API_BASE_URL` at staging API |

### Checklist after provisioning

1. Copy env vars from [production-env-checklist.md](production-env-checklist.md) with test-safe values.
2. Register all 5 Stripe webhooks per [stripe-webhook-registration.md](stripe-webhook-registration.md).
3. Deploy `staging` branch commit; verify `GET /` and boot logs (Mongo connected, no missing-env crash).
4. Run smoke tiers S0–S6 from [production-smoke-checklist.md](production-smoke-checklist.md) against staging host.
5. Record results in [production-proof-pack-template.md](production-proof-pack-template.md).

### Owner

Infrastructure or AWS owner provisions resources; backend engineer validates env + webhooks; release owner signs off smoke matrix.
