# Backend Soft-Launch Smoke Proof — 2026-06-29

Related issues:

- Backend: #84 Backend production smoke proof for domain/API/auth
- Frontend tracker: #250 Cross-repo soft-launch backend and Stripe verification tracker

## Scope

Read-only launch-readiness verification of existing Mosaic Biz Hub backend behavior against production API. No payment flows executed, no secrets exposed, no code or deploy changes made.

## Commit Identity (Important)

| Item | Value |
| --- | --- |
| Production API tested | `https://api.mosaicbizhub.com` |
| Production live commit | `2ed0b81` |
| Local staging tip (at verification time) | `5b5623f7c558a0b5b88ae298a3114ccbb4818c06` |

**Production differs from the local staging tip.** Evidence in this document applies to the **deployed live commit** (`2ed0b81`), not necessarily every unmerged change on local `staging`. Deploy owners should confirm whether additional staging commits require promotion before treating this proof as covering the latest integration branch.

## Repo / Branch

| Item | Value |
| --- | --- |
| Verification branch | `staging` |
| Working tree during verification | Clean (docs-only follow-up PR) |

## Production Release Identity

| Item | Value |
| --- | --- |
| Runtime service | `mosaic-backend` |
| Runtime environment | `production` |
| Runtime commit (live) | `2ed0b81` |
| Runtime deployment version | `mosaic-2ed0b81e12b45a8e2a9c85ffb4b5589f2bcef76e` |
| Database (ready probe) | `connected` |
| X-Request-Id on `/api/health` | Present |

Runtime endpoints checked:

- `GET /api/build-info` — release commit `2ed0b81`, environment `production`
- `GET /api/health` — `status: ok`, same release identity
- `GET /api/ready` — `status: ready`, `database: connected`, same release identity

Prior proof (2026-06-28) recorded commit `17953e8`; production has advanced since then.

## Files Inspected

| File | Purpose |
| --- | --- |
| `app.js` | Middleware order, route mounts, Stripe raw-body before JSON |
| `routes/healthRoutes.js` | Health, ready, build-info handlers |
| `routes/featuredProductRoutes.js` | Canonical `GET /api/featured-products` |
| `utils/corsOrigins.js` | CORS allowlist and disallowed origins |
| `utils/cookieHelper.js` | Cookie configuration |
| `middlewares/authenticate.js` | Auth middleware and 401 behavior |
| `routes/connectRoutes.js` | Connect handoff and return/refresh redirects |
| `scripts/smoke-backend.ps1` | Primary production smoke runner |
| `tests/launch/backend-launch-contract.test.js` | Launch contract (webhook order, route guards) |
| `tests/cors/cors-origins.test.js` | CORS unit coverage |
| `tests/cors/cors-login-preflight.test.js` | CORS preflight unit coverage |

## Commands Run

```powershell
cd "c:\Users\young\Desktop\Project Files\mosaic-backend"
git branch --show-current
git rev-parse HEAD
npm test
npm run test:contract
node --test tests/cors/cors-origins.test.js tests/cors/cors-login-preflight.test.js
Invoke-RestMethod https://api.mosaicbizhub.com/
Invoke-RestMethod https://api.mosaicbizhub.com/api/health
Invoke-RestMethod https://api.mosaicbizhub.com/api/ready
Invoke-RestMethod https://api.mosaicbizhub.com/api/build-info
./scripts/smoke-backend.ps1 -ApiBaseUrl https://api.mosaicbizhub.com
# Supplemental unauth probes (vendor, admin, detail, connect, subscription)
# CORS negative control: OPTIONS with Origin https://www.mosaicbizhub.com
```

## npm test Result

| Suite | Pass | Fail |
| --- | ---: | ---: |
| `npm test` (unit) | 438 | 0 |
| `npm run test:contract` | 20 | 0 |
| CORS focused tests | 11 | 0 |
| **Total local** | **469** | **0** |

Contract tests confirm:

- Stripe webhook raw-body mounts remain before `express.json()`
- `GET /api/featured-products` is canonical; `/api/products/featured` is absent
- Launch-critical admin, order, payment, and Connect routes are guarded

Integration tests (`npm run test:integration`) were **not** run in this session. Wrong-role 403 behavior is covered locally by `tests/integration/launch-access-contract.integration.test.js` when the integration suite is executed separately.

## Production Smoke Script Summary

```powershell
./scripts/smoke-backend.ps1 -ApiBaseUrl https://api.mosaicbizhub.com
```

| Status | Count |
| --- | ---: |
| PASS | 28 |
| FAIL | 0 |
| SKIP | 2 |
| BLOCKED | 5 |

## Route / Status Code Table

### Health and identity

| Method | Path | Status | Expected | Result |
| --- | --- | ---: | ---: | --- |
| GET | `/` | 200 | 200 | Pass |
| GET | `/api/health` | 200 | 200 | Pass |
| GET | `/api/ready` | 200 | 200 | Pass |
| GET | `/api/build-info` | 200 | 200 | Pass |

### Marketplace (public)

| Method | Path | Status | Expected | Result |
| --- | --- | ---: | ---: | --- |
| GET | `/api/featured-products` | 200 | 200 | Pass |
| GET | `/api/products/list?limit=5` | 200 | 200 | Pass |
| GET | `/api/public/search?keyword=test&limit=5` | 200 | 200 | Pass |
| GET | `/api/services/list?limit=5` | 200 | 200 | Pass |
| GET | `/api/food/list?limit=5` | 200 | 200 | Pass |
| GET | `/api/products/featured` | 404 | 404 | Pass (deprecated absent) |
| GET | `/api/public/product/000000000000000000000000` | 404 | 404 | Pass |
| GET | `/api/public/services/000000000000000000000000` | 404 | 404 | Pass |
| GET | `/api/public/foods/000000000000000000000000` | 404 | 404 | Pass |
| GET | `/api/subscription-plans` | 200 | 200 | Pass |

### CORS preflight (OPTIONS `/api/featured-products`, credentials=true)

| Origin | Status | Allow-Origin | Result |
| --- | ---: | --- | --- |
| `https://mosaicbizhub.com` | 204 | Matches origin | Pass |
| `https://app.mosaicbizhub.com` | 204 | Matches origin | Pass |
| `https://mosaic-biz-frontend-launch.vercel.app` | 204 | Matches origin | Pass |
| `https://mosaic-biz-frontend-launch-digital-builders.vercel.app` | 204 | Matches origin | Pass |
| `https://mosaic-biz-frontend-launch-git-main-digital-builders.vercel.app` | 204 | Matches origin | Pass |
| `https://mosaic-biz-frontend-launch-git-develop-digital-builders.vercel.app` | 204 | Matches origin | Pass |
| `https://www.mosaicbizhub.com` (negative) | 200 | Not reflected | Pass (denied) |

### Auth / role guards (unauthenticated)

| Method | Path | Status | Expected | Result |
| --- | --- | ---: | ---: | --- |
| GET | `/api/users/auth/check` | 401 | 401 | Pass |
| GET | `/api/admin/categories` | 401 | 401 | Pass |
| GET | `/admin/users` | 401 | 401 | Pass |
| GET | `/admin/api/products` | 401 | 401 | Pass |
| GET | `/admin/api/orders` | 401 | 401 | Pass |
| GET | `/admin/api/audit-events` | 401 | 401 | Pass |
| GET | `/admin/business-profile-verify/pending` | 401 | 401 | Pass |
| POST | `/api/orders/initiate` | 401 | 401 | Pass |
| POST | `/api/payments/create-payment-intent` | 401 | 401 | Pass |
| POST | `/api/connect/000000000000000000000000/account-link` | 401 | 401 | Pass |
| GET | `/stripe/account-balance` | 401 | 401 | Pass |

### Vendor / business profile (unauthenticated)

| Method | Path | Status | Expected | Result |
| --- | --- | ---: | ---: | --- |
| GET | `/api/vendor-onboarding/draft` | 401 | 401 | Pass |
| POST | `/api/vendor-onboarding/submit` | 401 | 401 | Pass |
| GET | `/api/vendor-onboarding/pending` | 401 | 401 | Pass |
| GET | `/api/business-profile` | 401 | 401 | Pass |
| POST | `/api/business-profile/save` | 401 | 401 | Pass |

### Stripe / Connect (payment-safe, no charges)

| Method | Path | Status | Expected | Result |
| --- | --- | ---: | ---: | --- |
| GET | `/api/connect/return` | 302 | 302 | Pass → `https://mosaicbizhub.com/partners/connect/return` |
| GET | `/api/connect/refresh` | 302 | 302 | Pass → `https://mosaicbizhub.com/partners/connect/refresh` |
| GET | `/api/subscriptions/current` | 401 | 401 | Pass |
| POST | `/api/stripe/create-checkout-session` | 401 | 401 | Pass |
| POST | `/api/subscriptions/create` | 401 | 401 | Pass |

### Error envelope safety

| Check | Result |
| --- | --- |
| `POST /api/orders/initiate` unauth body | No stack trace leaked | Pass |

### Debug route note

| Method | Path | Status | Note |
| --- | --- | ---: | --- |
| GET | `/admin/api/products/test` | 404 | PR 96 fix deployed (route absent) |

## CORS / Auth / Cookie Findings

- **CORS:** All six approved launch origins pass preflight with `Access-Control-Allow-Credentials: true` and matching `Access-Control-Allow-Origin`.
- **Negative control:** `https://www.mosaicbizhub.com` does not receive a credentialed Allow-Origin header (expected — www is in `DISALLOWED_CREDENTIAL_ORIGINS`).
- **Unauth auth/check:** Returns 401 as expected.
- **Credentials:** Backend CORS is configured with `credentials: true` in `app.js`. Cookie-based login chain was **not** tested (no smoke credentials).
- **Wrong-role 403 (production):** **BLOCKED** — no `SMOKE_TEST_*` tokens supplied. Covered by local integration/unit tests only.

## Payment / Stripe Findings (no secrets)

- **Webhook middleware order:** Unchanged — contract tests pass; five raw-body webhook routes remain mounted before `express.json()` in `app.js`.
- **Unauth guards:** Checkout (`/api/orders/initiate`), legacy PI (`/api/payments/create-payment-intent`), Connect account-link, Stripe finance routes, and subscription create routes all return 401 without auth.
- **Connect redirects:** Return and refresh handlers redirect to canonical frontend paths on `mosaicbizhub.com` (no API secrets in Location headers).
- **Live webhook delivery:** Not tested — no POST to production webhook endpoints; Stripe Dashboard verification deferred.
- **Checkout / PI / Connect handoff with real accounts:** Not tested — requires authenticated smoke tokens and test business IDs.

## Blocked / Skipped Runtime Checks

| Check | Reason |
| --- | --- |
| Customer authenticated `auth/check` | `SMOKE_TEST_CUSTOMER_TOKEN` not set |
| Vendor authenticated `auth/check` | `SMOKE_TEST_VENDOR_TOKEN` not set |
| Vendor `GET /api/business/my` | `SMOKE_TEST_VENDOR_TOKEN` not set |
| Vendor `GET /api/vendor-onboarding/onboarding-data` | `SMOKE_TEST_VENDOR_TOKEN` not set |
| Admin authenticated `auth/check` | `SMOKE_TEST_ADMIN_TOKEN` not set |
| Product detail smoke | `SMOKE_TEST_PRODUCT_ID` not set |
| Vendor profile smoke | `SMOKE_TEST_BUSINESS_ID` not set |
| Production wrong-role 403 matrix | Requires cross-role tokens |
| Cookie login session proof | Requires test account credentials |
| Vendor onboarding payment (`stage1/create-payment`) | Requires auth + Stripe test charge |
| Order checkout end-to-end | Requires customer auth + cart |
| Connect account-link with real business | Requires vendor auth + business ID |
| Live Stripe webhook POST / Dashboard delivery | Manual / out of scope for safe smoke |

## P0 / P1 Blockers

**None identified.**

All production probes in scope returned expected status codes. Local test suite: 469/469 pass.

| Severity | Finding |
| --- | --- |
| Info | Production commit `2ed0b81` ≠ local staging tip `5b5623f` — deploy owner should confirm whether latest staging should be promoted |
| Info | Authenticated tiers BLOCKED by design (no smoke tokens) |

## What Was Not Tested

- Authenticated customer, vendor, and admin sessions on production
- Wrong-role 403 responses on production
- Vendor onboarding payment and submission happy path
- Admin vendor application review with admin token
- Business profile save/submit with vendor token
- Product/service/food detail with real published IDs
- Subscription tier status for a real business
- Checkout PaymentIntent or order payment completion
- Stripe Connect account-link handoff with real business
- Live webhook delivery in Stripe Dashboard
- `npm run test:integration` (wrong-role in-memory suite)
- `node scripts/verify-auth-check-smoke.js` (requires local Mongo + JWT)

## Rollback Notes

No backend code changes were made during verification. This PR adds documentation only. Rollback is N/A for application code.

## Verdict for Frontend #250

Production API is **healthy and launch-ready for public/unauth surfaces** tested in this wave at live commit **`2ed0b81`**:

- Health, readiness, and release identity respond correctly
- Canonical marketplace browse routes work
- CORS supports `app.mosaicbizhub.com` and launch Vercel previews with credentials
- Protected routes reject unauthenticated callers without data leaks
- Stripe/Connect guard routes and redirect behavior are correct
- Webhook middleware order unchanged (static contract proof)

Authenticated role tiers and payment end-to-end flows remain **deferred** until smoke tokens or dedicated test accounts are provided.

**Recommendation:** Link this evidence document in frontend #250.
