# Backend Deployment Proof — Post-Deploy Release Verification

**Recorded:** 2026-06-18 18:22:36 UTC  
**Verification branch:** `audit/backend-post-deploy-release-verification`  
**Production API:** `https://api.mosaicbizhub.com`  
**Issues:** [#80 CORS](https://github.com/Techware-Hut/mosaic-backend/issues/80) · [#84 Smoke](https://github.com/Techware-Hut/mosaic-backend/issues/84) · [#18 Sentry](https://github.com/Techware-Hut/mosaic-backend/issues/18)

---

## Release metadata

| Field | Value |
|-------|-------|
| Repo `main` SHA | `5f98461` — Merge PR #85 (CORS allowlist) |
| Last GHA EB deploy SHA | `7d01011` — 2026-06-18T01:13:55Z |
| Deploy of `5f98461` confirmed live | **NO** |
| Deploy proxy evidence | `GET /api/health` → **404**; `GET /api/ready` → **404** |
| Executor | Automated post-deploy verification run |

**Conclusion:** Code is merged to `main`, but **production API behavior matches pre-merge deploy** (`7d01011` era). Full launch sign-off **blocked** until redeploy + env confirmation.

---

## EB environment variables (names only)

AWS CLI unavailable in audit environment — **presence not directly verified**. Required names per [`docs/ENV_VAR_INVENTORY.md`](ENV_VAR_INVENTORY.md):

### CORS / frontend

| Variable | Expected | Verified |
|----------|----------|----------|
| `CORS_ORIGINS` | Four launch origins (see CORS proof doc) | **INFER FAIL** — apex CORS 500 |
| `FRONTEND_URL` | `https://app.mosaicbizhub.com` | **BLOCKED** |

### Sentry

| Variable | Purpose |
|----------|---------|
| `SENTRY_DSN` | Enable monitoring |
| `SENTRY_ENVIRONMENT` | e.g. `production` |
| `SENTRY_RELEASE` | e.g. `mosaic-5f98461` |
| `SENTRY_TRACES_SAMPLE_RATE` | Default `0` |
| `SENTRY_PROFILES_SAMPLE_RATE` | Default `0` |
| `SENTRY_ENABLED` | Optional disable switch |
| `ENABLE_SENTRY_DEBUG_ROUTE` | Must be **false/unset** at launch |

### Stripe (names only)

`STRIPE_SECRET_KEY`, `STRIPE_ORDER_WEBHOOK_SECRET`, `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET`, `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`, `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET`, `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET`

### Email (names only)

`MAIL_USER`, `MAIL_PASSWORD`

No secret values recorded.

---

## Smoke summary

### Local

| Check | Result |
|-------|--------|
| `npm test` | **196/196 PASS** |
| `node -c app.js` | **PASS** |

### Production public

| Tier | Result |
|------|--------|
| Root + marketplace browse | **PASS** (200) |
| Health/readiness | **FAIL** (404) |
| Featured canonical route | **PASS** |

### CORS (OPTIONS `/api/featured-products`)

| Origin | Result |
|--------|--------|
| launch.vercel.app | **PASS** |
| app.mosaicbizhub.com | **PASS** |
| mosaicbizhub.com (apex) | **FAIL** |
| www.mosaicbizhub.com | **PASS** |
| evil.example.com | **PASS** (rejected) |

### Unauth protected routes

**PASS** — 401 on auth, vendor, order, connect, admin routes; no stack traces in bodies.

### Authenticated / checkout

**BLOCKED** — no `SMOKE_TEST_*` tokens; no live payment tests.

### Email safety

**PASS** — unit tests + `paidConfirmationEmailSentAt` guard; no pre-payment emails in `initiateOrder`.

### Sentry

| Check | Result |
|-------|--------|
| Debug route disabled | **PASS** (404) |
| No stack leak on 401 | **PASS** |
| Dashboard event proof | **BLOCKED** |

---

## Stakeholder summary

| Gate | Status |
|------|--------|
| Code on `main` | **PASS** |
| EB deploy of latest `main` | **FAIL** |
| EB env configured | **BLOCKED / INFER FAIL** |
| Public API browse | **PASS** |
| CORS 4/4 | **FAIL** (3/4) |
| Auth rejection | **PASS** |
| Email safety (code) | **PASS** |
| Full launch sign-off | **NOT READY** |

---

## Remaining launch blockers

1. **Deploy** `main` @ `5f98461`+ to Elastic Beanstalk (workflow_dispatch)
2. **Set** `CORS_ORIGINS` and `FRONTEND_URL` on EB before or with deploy
3. **Confirm** `GET /api/health` → 200 and apex CORS → 204
4. **Provide** approved smoke test tokens for authenticated tier
5. **Verify** Sentry dashboard capture (optional debug route — disable after)

---

## Related proof packs

- [`docs/CORS_PRODUCTION_SMOKE_PROOF.md`](CORS_PRODUCTION_SMOKE_PROOF.md)
- [`docs/BACKEND_PRODUCTION_SMOKE_PROOF.md`](BACKEND_PRODUCTION_SMOKE_PROOF.md)
- [`docs/BACKEND_FRONTEND_ROUTE_CONTRACT.md`](BACKEND_FRONTEND_ROUTE_CONTRACT.md) *(on branch `audit/backend-frontend-route-contract`)*
- [`docs/SENTRY_EB_DEPLOY_VERIFICATION.md`](SENTRY_EB_DEPLOY_VERIFICATION.md)
- [`docs/EB_DEPLOYMENT_READINESS_CHECKLIST.md`](EB_DEPLOYMENT_READINESS_CHECKLIST.md)

---

## Repro commands

```powershell
git checkout main
npm test
./scripts/smoke-backend.ps1 -ApiBaseUrl https://api.mosaicbizhub.com
```

CORS per-origin OPTIONS — see [`docs/CORS_PRODUCTION_SMOKE_PROOF.md`](CORS_PRODUCTION_SMOKE_PROOF.md).
