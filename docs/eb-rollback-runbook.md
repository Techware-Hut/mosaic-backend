# Elastic Beanstalk Rollback Runbook

Authoritative rollback procedure for Mosaic Biz Hub backend production. For release workflow context see [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) and [DEPLOYMENT.md](../DEPLOYMENT.md).

**Current rollback baseline (2026-06-17):**

| Field | Value |
|-------|-------|
| Known-good commit | `c7955cc` |
| Known-good EB version label | `mosaic-c7955cc06f7ef87ac6d8747e053a2f5f66ff3037` |
| EB application | `mosaic-biz-hub-backend` |
| EB environment | `mosaic-backend-env` |
| Region | `us-east-1` |
| Production API | `https://api.mosaicbizhub.com` |

---

## Roles

| Role | Responsibility |
|------|----------------|
| **Infrastructure / AWS owner** | Executes rollback (Actions or Console); confirms EB version after rollback |
| **Release owner** | Approves rollback decision; runs post-rollback smoke; updates proof pack |
| **Backend engineer** | Diagnoses failed deploy; recommends rollback target SHA |

Rollback requires **release owner approval** before infra executes, except P0 outage where infra may rollback immediately and notify release owner within 15 minutes.

---

## Pre-deploy rollback checklist (every production deploy)

Before triggering any production deploy:

- [ ] Record **current** EB version label and commit SHA (becomes rollback target for the next deploy)
- [ ] Confirm previous known-good SHA is on `main` and has a corresponding EB version `mosaic-<sha>`
- [ ] Identify rollback executor and approver for this release window
- [ ] Confirm [production-env-checklist.md](production-env-checklist.md) changes (if any) are reversible

Update [deploy-verification.md](deploy-verification.md) and [production-proof-pack-template.md](production-proof-pack-template.md) with the recorded baseline.

---

## Rollback paths

### Path A — GitHub Actions (preferred)

Use when GitHub Actions OIDC and the `production` environment are configured.

1. Stop further promotions to `main` until root cause is understood.
2. GitHub → **Actions** → **Deploy to Elastic Beanstalk** → **Run workflow**.
3. Branch: **`main`**
4. Select the **previous known-good commit SHA** (not the failed commit).
5. Wait for workflow to complete (test gate + deploy + probes).
6. Confirm workflow summary shows deployed SHA matches intended rollback target.

**Estimated time:** 10–15 minutes (deploy + automated probes). Add 15–30 minutes for manual smoke.

### Path B — AWS Console (fallback)

Use when GitHub Actions is unavailable or OIDC is misconfigured.

1. AWS Console → **Elastic Beanstalk** → **Applications** → `mosaic-biz-hub-backend`
2. **Application versions** → locate version label `mosaic-<sha>` for the known-good commit
3. Select version → **Deploy** → environment **`mosaic-backend-env`**
4. Wait for environment health **Ok** (Configuration → Events for progress)
5. Record deployed version label in [deploy-verification.md](deploy-verification.md)

**Estimated time:** 10–20 minutes (Console deploy + verification).

---

## Post-rollback verification

Run immediately after rollback completes:

| Check | Expected | Method |
|-------|----------|--------|
| Health | HTTP **200** | `GET https://api.mosaicbizhub.com/` |
| Auth (unauth) | HTTP **401** | `GET https://api.mosaicbizhub.com/api/users/auth/check` |
| CORS featured products | HTTP **200** + correct `Access-Control-Allow-Origin` | OPTIONS + GET `/api/featured-products` with launch frontend Origin (automated in deploy workflow) |
| EB version | Matches rollback SHA | AWS Console → Environment → Running version |
| EB logs | Mongo connected, no crash loop | AWS Console → Logs (infra owner) |

Minimum manual smoke after rollback: **P0.1**, **P1.4** (login/logout with test account), one Stripe webhook delivery check if payment-related deploy failed.

Full tiers: [production-smoke-checklist.md](production-smoke-checklist.md).

---

## Incident log template

Record in proof pack or incident tracker:

```
Incident date/time (UTC):
Failed commit SHA:
Failed EB version label:
Impact summary:
Rollback executor:
Rollback approver:
Rollback path used: [ ] GitHub Actions  [ ] AWS Console
Rollback target SHA:
Rollback target EB version:
Rollback started (UTC):
Rollback completed (UTC):
Post-rollback smoke result:
Root cause (if known):
Follow-up actions:
```

---

## Rollback if push-to-main auto-deploy misfires

If push-to-main is re-enabled and an unintended deploy occurs:

1. Revert the workflow PR that uncommented the push trigger (disable auto-deploy).
2. Execute **Path A** or **Path B** to redeploy last known-good SHA (`c7955cc` or newer confirmed-good).
3. Run post-rollback verification above.
4. Document in [DECISION_REGISTER.md](DECISION_REGISTER.md) incident notes.

See [DEPLOYMENT.md](../DEPLOYMENT.md) § Push-to-main auto-deploy gate.

---

## Related docs

- [github-actions-eb-setup.md](github-actions-eb-setup.md) — OIDC IAM setup
- [deploy-verification.md](deploy-verification.md) — deploy audit log
- [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) — release owner procedures
