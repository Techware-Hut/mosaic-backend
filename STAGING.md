# Staging Integration Branch

## Purpose

The `staging` branch is the **pre-production integration branch**. It is not a hosted environment.

**MVP release strategy:** feature branch → PR → `staging` → PR → `main` → AWS Elastic Beanstalk production → [production soft-launch smoke](docs/production-smoke-checklist.md) with test accounts.

Hosted staging backend is **deferred** — see [docs/hosted-staging-decision.md](docs/hosted-staging-decision.md).

---

## Current state

| Layer | Role | Deploy target |
| --- | --- | --- |
| Feature work | Short-lived branch from `staging` | Local dev only |
| Integration branch | `staging` | **None** (branch-level only) |
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

**Do not** require runtime webhook/auth smoke on `staging` itself — there is no staging host. Those checks run post-deploy on production per [DEPLOYMENT.md](DEPLOYMENT.md) and [docs/production-smoke-checklist.md](docs/production-smoke-checklist.md).

---

## Promotion rule

Do not merge `staging` → `main` until:

- Integration checklist above is complete
- Reviewer or release owner approves the PR
- Rollback readiness confirmed in [DEPLOYMENT.md](DEPLOYMENT.md)
- Required production env vars documented in [docs/production-env-checklist.md](docs/production-env-checklist.md)

**No direct commits to `main`.**

---

## Future hosted staging

A staging deploy workflow exists at [`.github/workflows/deploy-eb-staging.yml`](.github/workflows/deploy-eb-staging.yml) (`workflow_dispatch` on `staging` branch). **Hosted staging EB is not yet provisioned** — the workflow requires infra setup first:

1. Provision isolated EB environment (e.g. `mosaic-backend-staging`), MongoDB, S3, mail, Stripe **test mode**
2. Create GitHub `staging` environment and OIDC role per [docs/github-actions-eb-setup.md](docs/github-actions-eb-setup.md) § Step D
3. Set GitHub variables: `AWS_ROLE_TO_ASSUME_STAGING`, `EB_APPLICATION_NAME_STAGING`, `EB_ENVIRONMENT_NAME_STAGING`, `STAGING_API_URL`
4. Run first manual staging deploy; update [docs/hosted-staging-decision.md](docs/hosted-staging-decision.md)

See [docs/hosted-staging-decision.md](docs/hosted-staging-decision.md) for isolation requirements.

---

## Related docs

- [docs/README.md](docs/README.md) — documentation index
- [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md) — release owner runbook
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [SETUP.md](SETUP.md)
- [docs/launch-readiness-report.md](docs/launch-readiness-report.md)
