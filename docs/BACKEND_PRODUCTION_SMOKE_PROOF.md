# Backend Production Smoke Proof — Auth, Checkout, Order, Email

**Issue:** [#84 Backend production smoke proof for domain/API/auth](https://github.com/Techware-Hut/mosaic-backend/issues/84)  
**Recorded:** 2026-06-18 18:22:36 UTC (post-deploy verification pass)  
**Branch:** `audit/backend-post-deploy-release-verification`  
**Repo `main` commit:** `5f98461`  
**Production API:** `https://api.mosaicbizhub.com`

---

## Deploy status

| Field | Value |
|-------|-------|
| `main` HEAD | `5f98461` (PR #85 CORS merge) |
| Last GHA EB deploy | `7d01011` — 2026-06-18T01:13:55Z |
| Live deploy confirmed | **NO** — `/api/health` + `/api/ready` return **404** on production |
| EB env names verified | **BLOCKED** — AWS CLI not available in audit environment |

No secrets in this document.

---

## Local validation (2026-06-18)

| Check | Result |
|-------|--------|
| `npm test` | **PASS** — 196/196 |
| `node -c app.js` | **PASS** |

### Email / order safety (unit tests + code)

| Finding | Result |
|---------|--------|
| No pre-payment emails in `initiateOrder` | **PASS** — `order-email-safety.test.js` |
| Duplicate paid confirmation guard | **PASS** — `paidConfirmationEmailSentAt` in `stripePaymentController.js` |
| Webhook idempotency | **PASS** — `order-webhook-handlers.test.js` |
| Route protection on `POST /api/orders/initiate` | **PASS** — `payment-route-protection.test.js` |

---

## Production — public endpoints

| Endpoint | HTTP | Expected | Result |
|----------|------|----------|--------|
| `GET /` | 200 | 200 | **PASS** |
| `GET /api/health` | 404 | 200 | **FAIL** |
| `GET /api/ready` | 404 | 200 | **FAIL** |
| `GET /api/featured-products` | 200 | 200 | **PASS** |
| `GET /api/products/list?limit=5` | 200 | 200 | **PASS** |
| `GET /api/services/list?limit=5` | 200 | 200 | **PASS** |
| `GET /api/food/list?limit=5` | 200 | 200 | **PASS** |
| `GET /api/public/search?keyword=test&limit=5` | 200 | 200 | **PASS** |
| `GET /api/categories` | 200 | 200 | **PASS** |
| `GET /api/ranked` | 200 | 200 | **PASS** |

Smoke script: **PASS=9 FAIL=2 SKIP=1 BLOCKED=3**

---

## Production — CORS credentials

See [`docs/CORS_PRODUCTION_SMOKE_PROOF.md`](CORS_PRODUCTION_SMOKE_PROOF.md). Summary: **3/4** allowlisted origins pass; apex **FAIL**.

---

## Production — unauth protected routes

| Route | Method | HTTP | Stack leak | Result |
|-------|--------|------|------------|--------|
| `/api/users/auth/check` | GET | 401 | No | **PASS** |
| `/api/business/my` | GET | 401 | No | **PASS** |
| `/api/vendor-onboarding/onboarding-data` | GET | 401 | No | **PASS** |
| `/api/orders/initiate` | POST | 401 | No | **PASS** |
| `/api/orders/vendor` | GET | 401 | No | **PASS** |
| `/api/connect/.../account-link` | POST | 401 | No | **PASS** |
| `/stripe/account-session` | POST | 400 | No | **PARTIAL** (rejected, not 401) |
| `/admin/users` | GET | 401 | No | **PASS** |

Unauth body example: `{"success":false,"message":"Authentication required"}` — no stack trace.

---

## Authenticated smoke — BLOCKED

| Check | Status |
|-------|--------|
| `SMOKE_TEST_CUSTOMER_TOKEN` | Not set |
| `SMOKE_TEST_VENDOR_TOKEN` | Not set |
| `SMOKE_TEST_ADMIN_TOKEN` | Not set |
| Customer/vendor/admin auth/check | **BLOCKED** |
| Role protection (403 probes) | **BLOCKED** |
| Checkout initiation | **BLOCKED** — no tokens; no live payment tests per policy |

---

## Sentry (safe probes)

| Check | Result |
|-------|--------|
| `GET /internal/sentry-debug` | **404** — debug route disabled (launch-safe) |
| Unauth error body stack leak | **PASS** — no stack in JSON |
| Sentry dashboard event capture | **BLOCKED** — no dashboard access; debug route not enabled |

---

## Acceptance criteria

| Criterion | Result |
|-----------|--------|
| npm test passes | **PASS** |
| Public browse routes | **PASS** |
| Health/readiness on prod | **FAIL** — deploy not live |
| Protected routes reject unauth | **PASS** |
| CORS credentials (4 origins) | **FAIL** — apex |
| No pre-payment email regression | **PASS** (unit tests) |
| No duplicate paid email risk | **PASS** (unit tests + code) |
| Authenticated checkout on prod | **BLOCKED** |

---

## Remaining blockers

1. Redeploy `main` @ `5f98461`+ to EB
2. Confirm `CORS_ORIGINS` + `FRONTEND_URL` on EB
3. Re-run smoke after deploy (`/api/health` must return 200)
4. Provide approved smoke test tokens for auth/checkout tier

---

## References

- [`scripts/smoke-backend.ps1`](../scripts/smoke-backend.ps1)
- [`docs/BACKEND_DEPLOYMENT_PROOF.md`](BACKEND_DEPLOYMENT_PROOF.md)
- [`docs/CORS_PRODUCTION_SMOKE_PROOF.md`](CORS_PRODUCTION_SMOKE_PROOF.md)
- [`docs/SENTRY_EB_DEPLOY_VERIFICATION.md`](SENTRY_EB_DEPLOY_VERIFICATION.md)
