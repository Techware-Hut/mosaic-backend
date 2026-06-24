# Elastic Beanstalk Deployment Readiness Checklist

**Release:** `main` @ `fbe3aac` (PR #78 — Batch 1 + Batch 2)  
**API:** `https://api.mosaicbizhub.com`  
**EB environment:** `mosaic-backend-env` (placeholder — confirm in AWS console)  
**EB application:** `mosaic-biz-hub-backend`  
**Region:** `us-east-1`

Related: [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md), [production-env-checklist.md](production-env-checklist.md), [BACKEND_BATCH_3_DEPLOY_SMOKE_AUDIT.md](BACKEND_BATCH_3_DEPLOY_SMOKE_AUDIT.md)

---

## Pre-deploy checklist

### Code and tests

- [ ] `main` contains PR #78 merge (`fbe3aac` or later)
- [ ] `npm test` passes locally and in GHA (190/190)
- [ ] No secrets in diff
- [ ] [BACKEND_BATCH_3_DEPLOY_SMOKE_AUDIT.md](BACKEND_BATCH_3_DEPLOY_SMOKE_AUDIT.md) reviewed

### Required backend env vars (names only)

**Boot-critical:**

- `MONGODB_URI`
- `JWT_SECRET`
- `FRONTEND_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `API_BASE_URL` — `https://api.mosaicbizhub.com`
- `NODE_ENV=production`
- `PORT` — match EB platform (often `8080`)

**Auth cookies:**

- `COOKIE_DOMAIN` — typically `.mosaicbizhub.com`
- `COOKIE_SECURE=true`
- `COOKIE_SAMESITE=none` (cross-site)

**Stripe (live mode in production):**

- `STRIPE_SECRET_KEY`
- `STRIPE_ORDER_WEBHOOK_SECRET` → `POST /api/webhooks/stripe`
- `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET` → `POST /api/stripe/webhook`
- `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` → `POST /api/subscription/webhook`
- `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET` → `POST /api/vendor-onboarding/webhook/payment`
- `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET` → `POST /api/stripe/payment/webhook`
- `PLATFORM_FEE_CENTS`, `BILLING_PORTAL_RETURN_URL`, Connect path vars

**S3 / email:** See [production-env-checklist.md](production-env-checklist.md).

**Sentry (optional but recommended for #18):**

- `SENTRY_DSN` — EB only, never git
- `SENTRY_ENVIRONMENT=production`
- `SENTRY_RELEASE=mosaic-<git-sha>`
- `SENTRY_TRACES_SAMPLE_RATE=0`
- `SENTRY_ENABLED=true`
- `ENABLE_SENTRY_DEBUG_ROUTE=false` (enable only during verify)

Full list: [production-env-checklist.md](production-env-checklist.md)

---

## MongoDB / Atlas readiness

- [ ] Production cluster reachable from EB security group
- [ ] Connection string uses correct user (least privilege)
- [ ] Batch 1 compound indexes on `Product` will build on deploy ([models/Product.js](../models/Product.js))
- [ ] Atlas owner confirms indexes after deploy (`db.products.getIndexes()`)

---

## Stripe webhook configuration

- [ ] All five webhook URLs registered in Stripe Dashboard — [stripe-webhook-registration.md](stripe-webhook-registration.md)
- [ ] Each endpoint shows recent successful delivery after deploy
- [ ] **Raw-body warning:** Webhook routes in [app.js](../app.js) use `express.raw()` **before** `express.json()`. Do not reorder middleware during deploy troubleshooting.

---

## CORS and frontend

- [ ] `CORS_ORIGINS` set on EB with explicit production frontends (recommended):
  - `https://mosaic-biz-frontend-launch.vercel.app`
  - `https://app.mosaicbizhub.com`
- [ ] `FRONTEND_URL` matches canonical app host (`https://app.mosaicbizhub.com`) for OAuth redirects and emails
- [ ] If `CORS_ORIGINS` is unset, verify default fallback still allows launch Vercel + app origins and does not include the root community site ([`utils/corsOrigins.js`](../utils/corsOrigins.js))
- [ ] Frontend `NEXT_PUBLIC_API_BASE_URL` → `https://api.mosaicbizhub.com`

---

## Deploy execution

1. Trigger [`.github/workflows/deploy-eb-production.yml`](../.github/workflows/deploy-eb-production.yml) via `workflow_dispatch` on `main`.
2. Confirm GHA test job passes.
3. Record version label: `mosaic-<sha>`.
4. Wait for EB environment recovery.

**GHA post-deploy (implemented #21):** `/api/health`, `/api/ready`, CORS OPTIONS+GET on `/api/featured-products` for launch and app origins.

Related docs: [ENV_VAR_INVENTORY.md](ENV_VAR_INVENTORY.md), [PUSH_TO_MAIN_DEPLOY_CRITERIA.md](PUSH_TO_MAIN_DEPLOY_CRITERIA.md), [BACKUP_ROLLBACK_RUNBOOK.md](BACKUP_ROLLBACK_RUNBOOK.md)

---

## Post-deploy smoke order

1. **P0** — `./scripts/smoke-backend.ps1 -ApiBaseUrl https://api.mosaicbizhub.com`
2. **P1** — Public marketplace GETs (included in script)
3. **P2+** — Re-run with `SMOKE_TEST_*_TOKEN` if available
4. **Sentry** — [SENTRY_EB_DEPLOY_VERIFICATION.md](SENTRY_EB_DEPLOY_VERIFICATION.md) (temporary debug route, then disable)
5. **Stripe** — Dashboard webhook delivery check
6. Fill [BACKEND_FULL_SMOKE_PROOF_PACK.md](BACKEND_FULL_SMOKE_PROOF_PACK.md)

Minimum manual checks:

```powershell
$Base = "https://api.mosaicbizhub.com"
Invoke-RestMethod "$Base/api/health"    # expect 200
Invoke-RestMethod "$Base/api/ready"     # expect 200, database connected
Invoke-WebRequest "$Base/api/users/auth/check" -SkipHttpErrorCheck  # expect 401
```

---

## Rollback plan

1. Stop further promotions to `main`.
2. In EB console, deploy previous known-good version label (e.g. prior `mosaic-<sha>`).
3. Confirm `GET /` → 200.
4. Re-run P0 smoke script.
5. Restore EB env vars if failure was config-related.
6. Log incident in [deploy-verification.md](deploy-verification.md).

See [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) § Rollback.

---

## Evidence required before closing #18 and #27

| Issue | Evidence |
| --- | --- |
| **#18** Sentry | Sentry dashboard screenshot (redacted); EB env var names set; debug route disabled post-verify |
| **#27** Smoke | Completed [BACKEND_FULL_SMOKE_PROOF_PACK.md](BACKEND_FULL_SMOKE_PROOF_PACK.md); GHA deploy URL; EB version label; smoke script output |

---

## Sign-off

| Role | Name | Date | EB version | Notes |
| --- | --- | --- | --- | --- |
| Deployment owner | | | mosaic- | |
| Release owner | | | | Smoke P0–P1 minimum |
| QA | | | | P2–P5 when tokens available |
