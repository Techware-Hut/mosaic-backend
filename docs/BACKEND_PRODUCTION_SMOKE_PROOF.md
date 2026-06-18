# Backend Production Smoke Proof — Auth, Checkout, Order, Email

**Issue:** [#84 Backend production smoke proof for domain/API/auth](https://github.com/Techware-Hut/mosaic-backend/issues/84)  
**Recorded:** 2026-06-18 19:10:36 UTC (final verification — CORS 4/4 PASS)  
**Repo `main` commit:** `4c77bf6` (docs); EB runtime @ `afa56ca`  
**Production API:** `https://api.mosaicbizhub.com`

---

## Deploy status

| Field | Value |
|-------|-------|
| `main` HEAD | `4c77bf6` |
| EB deployed SHA | `afa56ca` — GHA run [27781345087](https://github.com/Techware-Hut/mosaic-backend/actions/runs/27781345087) |
| Live deploy confirmed | **YES** — `/api/health` + `/api/ready` return **200** |
| EB env names verified | **PASS** (inferred) — CORS 4/4 after release-owner env apply |

No secrets in this document.

---

## Local validation (2026-06-18 18:53 UTC)

| Check | Result |
|-------|--------|
| `npm test` | **PASS** — 196/196 (re-run during #80 resolution) |
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
| `GET /api/health` | 200 | 200 | **PASS** |
| `GET /api/ready` | 200 | 200 | **PASS** |
| `GET /api/featured-products` | 200 | 200 | **PASS** |
| `GET /api/products/list?limit=5` | 200 | 200 | **PASS** |
| `GET /api/services/list?limit=5` | 200 | 200 | **PASS** |
| `GET /api/food/list?limit=5` | 200 | 200 | **PASS** |
| `GET /api/public/search?keyword=test&limit=5` | 200 | 200 | **PASS** |
| `GET /api/categories` | 200 | 200 | **PASS** |
| `GET /api/ranked?limit=5` | 200 | 200 | **PASS** |

Smoke script (`./scripts/smoke-backend.ps1`): **PASS=11 FAIL=0 SKIP=1 BLOCKED=3**

Note: `/api/products/ranked` returns **404** — canonical ranked route is **`GET /api/ranked`** (see [`routes/publicListing.js`](../routes/publicListing.js)).

---

## Production — CORS credentials

See [`docs/CORS_PRODUCTION_SMOKE_PROOF.md`](CORS_PRODUCTION_SMOKE_PROOF.md). Summary: **4/4 PASS** (2026-06-18 19:10 UTC) — all allowlisted origins return 204 + exact ACAO + credentials.

---

## Production — unauth protected routes

| Route | Method | HTTP | Stack leak | Result |
|-------|--------|------|------------|--------|
| `/api/users/auth/check` | GET | 401 | No | **PASS** |
| `/api/business/my` | GET | 401 | No | **PASS** |
| `/api/vendor-onboarding/onboarding-data` | GET | 401 | No | **PASS** |
| `/api/orders/initiate` | POST | 401 | No | **PASS** |
| `/api/connect/:id/account-link` | POST | 401 | No | **PASS** |
| `/stripe/account-session` | POST | 401 | No | **PASS** |
| `/admin/users` | GET | 401 | No | **PASS** |
| `/api/admin/categories` | GET | 200 | No | **NOTE** — no auth middleware on route |

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
| EB `SENTRY_*` env names | **BLOCKED** — AWS CLI unavailable |

---

## Acceptance criteria

| Criterion | Result |
|-----------|--------|
| npm test passes | **PASS** |
| Public browse routes | **PASS** |
| Health/readiness on prod | **PASS** |
| Protected routes reject unauth (no 500) | **PASS** |
| CORS credentials (4 origins) | **PASS** |
| No pre-payment email regression | **PASS** (unit tests) |
| No duplicate paid email risk | **PASS** (unit tests + code) |
| Authenticated checkout on prod | **BLOCKED** |

---

## Remaining blockers

1. ~~CORS 4/4 on production~~ — **RESOLVED** (2026-06-18)
2. Provide approved smoke test tokens for auth/checkout tier — see [`docs/BACKEND_NEXT_LAUNCH_HARDENING_BATCH.md`](BACKEND_NEXT_LAUNCH_HARDENING_BATCH.md) Batch A
3. Sentry dashboard proof — **BLOCKED** until release owner verifies — Batch B

---

## References

- [`scripts/smoke-backend.ps1`](../scripts/smoke-backend.ps1)
- [`docs/BACKEND_DEPLOYMENT_PROOF.md`](BACKEND_DEPLOYMENT_PROOF.md)
- [`docs/CORS_PRODUCTION_SMOKE_PROOF.md`](CORS_PRODUCTION_SMOKE_PROOF.md)
- [`docs/SENTRY_EB_DEPLOY_VERIFICATION.md`](SENTRY_EB_DEPLOY_VERIFICATION.md)
