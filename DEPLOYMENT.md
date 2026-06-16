# Deployment Process

## Purpose

This document defines the backend deployment flow, rollback approach, and production smoke testing for Mosaic Biz Hub.

---

## Branch policy

| Branch | Role |
|--------|------|
| `feature/*` | Individual work; local dev only |
| `staging` | Integration; PR review gate ([STAGING.md](STAGING.md)) |
| `main` | **Production release branch** — deploy to AWS EB only |

**Rules:** No direct commits to `main`. All production releases merge `staging` → `main` via PR with required reviewers.

---

## Production environment

| Resource | Value |
|----------|-------|
| Platform | AWS Elastic Beanstalk |
| EB hostname | `mosaic-backend.us-east-1.elasticbeanstalk.com` |
| Canonical HTTPS API | `https://api.mosaicbizhub.com` |
| Frontend (typical) | `https://app.mosaicbizhub.com` |

Use **`https://api.mosaicbizhub.com`** for smoke tests and Stripe webhook URLs. Avoid HTTPS on the raw EB hostname (TLS cert CN mismatch).

---

## Release roles

| Role | Responsibility |
| --- | --- |
| Backend engineer | Prepare changes, update docs, validate locally, identify env changes |
| Reviewer or tech lead | Review security-sensitive behavior; approve PR to `main` |
| Release owner | Coordinate deploy window; confirm smoke completion |
| Infrastructure or AWS owner | EB deploy, secrets, networking, rollback execution |

---

## Pre-deployment checklist

**Before every production deploy:**

1. Merge intended changes into `staging`; complete [STAGING.md](STAGING.md) integration checklist.
2. Open PR `staging` → `main`; obtain reviewer + release owner approval.
3. **Rollback readiness (mandatory):**
   - Record last known good `main` commit SHA currently on EB
   - Confirm EB can redeploy previous application version
   - Confirm production env restore path ([production-env-checklist.md](docs/production-env-checklist.md))
4. Confirm all production env vars set on EB (README names, not legacy `.env.example` Stripe names).
5. Confirm all 5 Stripe webhooks registered — [stripe-webhook-registration.md](docs/stripe-webhook-registration.md).
6. Confirm MongoDB, AWS, mail, and auth credentials are production (not dev).
7. Update [docs/security-remediation-notes.md](docs/security-remediation-notes.md) if security behavior changed.

---

## Deployment steps

### Automated (GitHub Actions — preferred)

Workflow: [`.github/workflows/deploy-eb-production.yml`](.github/workflows/deploy-eb-production.yml)

**Triggers:**

- Push to `main` (after merge from `staging`)
- Manual **Run workflow** (`workflow_dispatch`) on `main` — use for first deploy and rollbacks

**Flow:** `npm ci` → `npm test` → source-only ZIP → Elastic Beanstalk → health probe on `https://api.mosaicbizhub.com/`

**One-time setup:** [docs/github-actions-eb-setup.md](docs/github-actions-eb-setup.md) — AWS IAM, GitHub secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), variables (`AWS_REGION`, `EB_APPLICATION_NAME`, `EB_ENVIRONMENT_NAME`), and optional `production` environment reviewers.

**Per release:**

1. Merge approved PR `staging` → `main`; note commit SHA.
2. CI runs on push; deploy workflow runs tests then deploys to EB environment **`Mosaic-backend`** (application **`mosaic-backend`**, region **`us-east-1`**).
3. Confirm workflow summary shows deployed SHA and health probe PASS.
4. Verify EB boot logs (Mongo connected, no missing-env crash).
5. Run [production-smoke-checklist.md](docs/production-smoke-checklist.md) with **test accounts only**.
6. Fill [production-proof-pack-template.md](docs/production-proof-pack-template.md); retain for release record.

**Rollback via GitHub Actions:** Run **Deploy to Elastic Beanstalk** workflow manually and select a previous known-good commit on `main`.

### Manual ZIP (legacy fallback)

If GitHub Actions is unavailable:

1. Identify exact commit on `main` to release (post-merge SHA).
2. Infrastructure owner uploads ZIP to AWS Elastic Beanstalk (exclude `node_modules`, `.env`, `.git` — see [`.ebignore`](.ebignore)).
3. Follow verification steps below.

**Minimum post-deploy smoke:**

- `GET https://api.mosaicbizhub.com/` → 200
- `GET https://api.mosaicbizhub.com/api/users/auth/check` (unauthenticated) → 401
- Auth login/logout with test user
- One Stripe webhook delivery check in Dashboard
- One non-destructive protected route

---

## Rollback steps

### Before deploy (mandatory)

- [ ] Last good SHA recorded
- [ ] EB rollback path confirmed
- [ ] Release owner and infra owner identified

### If rollback required

1. Stop further promotions to `main`.
2. Re-deploy last known good commit on EB.
3. Re-verify EB health and `GET https://api.mosaicbizhub.com/`.
4. Re-run minimal smoke (P0.1, P1.4, one webhook check).
5. Restore env vars if config-related.
6. Log incident: failed commit, impact, rollback time, approvers.

---

## Evidence to retain

- Deployed commit hash
- Previous known-good commit
- Deployment timestamp
- PR link (`staging` → `main`)
- Approvers and executor
- Smoke matrix ([production-proof-pack-template.md](docs/production-proof-pack-template.md))
- Rollback reference if used

---

## Known launch blockers

Deployment and smoke tests **do not fix** open P0 code issues. See [launch-readiness-report.md](docs/launch-readiness-report.md) section 9. Sign-off must distinguish **deploy healthy** vs **launch-ready for unrestricted public traffic**.

---

## Related docs

- [docs/github-actions-eb-setup.md](docs/github-actions-eb-setup.md) — GitHub Actions + AWS one-time setup
- [docs/DECISION_REGISTER.md](docs/DECISION_REGISTER.md) — MVP decisions and deferrals
- [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md) — **release owner runbook** (smoke, rollback, Go/No-Go)
- [STAGING.md](STAGING.md)
- [SETUP.md](SETUP.md)
- [README.md](README.md)
- [docs/production-env-checklist.md](docs/production-env-checklist.md)
- [docs/hosted-staging-decision.md](docs/hosted-staging-decision.md)
