# Backend Soft-Launch Smoke Proof - 2026-06-28

Related issues:

- Backend: #84 Backend production smoke proof for domain/API/auth
- Frontend tracker: #250 Cross-repo soft-launch backend and Stripe verification tracker

## Scope

This proof records the current production API state before the live Stripe key switch. It is safe for the July Vendor Soft Launch because it verifies public API health, canonical marketplace routes, CORS policy, and guarded unauthenticated behavior without exposing secrets or changing payment flows.

## Production Identity

| Item | Evidence |
| --- | --- |
| API base | `https://api.mosaicbizhub.com` |
| Runtime service | `mosaic-backend` |
| Runtime environment | `production` |
| Runtime commit | `17953e8` |
| Runtime deployment version | `mosaic-17953e84f92cf19a877795a99cef5b535e7f34a8` |
| GitHub Actions EB deploy | `Deploy to Elastic Beanstalk`, run `28312315944`, success |
| Deploy head SHA | `17953e84f92cf19a877795a99cef5b535e7f34a8` |

Runtime endpoints checked:

- `GET /api/build-info` returned release commit `17953e8`, environment `production`, deployment version `mosaic-17953e84f92cf19a877795a99cef5b535e7f34a8`.
- `GET /api/health` returned `status: ok` with the same release identity.
- `GET /api/ready` returned `status: ready`, `database: connected`, with the same release identity.

## Smoke Command

```powershell
./scripts/smoke-backend.ps1 -ApiBaseUrl https://api.mosaicbizhub.com
```

Result:

| Status | Count |
| --- | ---: |
| PASS | 28 |
| FAIL | 0 |
| SKIP | 2 |
| BLOCKED | 5 |

## Passed Checks

- `GET /`
- `GET /api/health`
- `GET /api/ready`
- `GET /api/build-info`
- `GET /api/featured-products`
- `GET /api/products/list?limit=5`
- `GET /api/public/search?keyword=test&limit=5`
- `GET /api/services/list?limit=5`
- `GET /api/food/list?limit=5`
- Approved CORS preflight origins:
  - `https://mosaicbizhub.com`
  - `https://app.mosaicbizhub.com`
  - `https://mosaic-biz-frontend-launch.vercel.app`
  - `https://mosaic-biz-frontend-launch-digital-builders.vercel.app`
  - `https://mosaic-biz-frontend-launch-git-main-digital-builders.vercel.app`
  - `https://mosaic-biz-frontend-launch-git-develop-digital-builders.vercel.app`
- Guarded unauthenticated routes return protected responses instead of data:
  - `/api/users/auth/check`
  - `/api/admin/categories`
  - `/api/orders/initiate`
  - `/api/connect/:id/account-link`
  - `/admin/users`
  - `/admin/api/products`
  - `/api/payments/create-payment-intent`
  - `/stripe/account-balance`
- Deprecated route guard:
  - `GET /api/products/featured` remains absent.

## CORS Correction In This Batch

The smoke scripts no longer treat `https://www.mosaicbizhub.com` as a credentialed API origin. `www` is an alias/redirect concern for frontend traffic, not a browser credential origin for the API.

The backend CORS callback now denies disallowed origins without raising a server error:

- Disallowed origins do not receive `access-control-allow-origin`.
- Disallowed origins do not produce a backend 500.
- Focused CORS unit tests cover arbitrary disallowed origins and the `www` marketplace alias.

## Blocked Or Deferred Runtime Checks

These were not failed checks; they require dedicated smoke credentials or IDs that were intentionally not placed in this repository:

| Check | Reason |
| --- | --- |
| Customer authenticated smoke | `SMOKE_TEST_CUSTOMER_TOKEN` not set |
| Vendor authenticated smoke | `SMOKE_TEST_VENDOR_TOKEN` not set |
| Vendor `/api/business/my` smoke | `SMOKE_TEST_VENDOR_TOKEN` not set |
| Vendor onboarding-data smoke | `SMOKE_TEST_VENDOR_TOKEN` not set |
| Admin authenticated smoke | `SMOKE_TEST_ADMIN_TOKEN` not set |
| Product detail smoke | `SMOKE_TEST_PRODUCT_ID` not set |
| Vendor profile smoke | `SMOKE_TEST_BUSINESS_ID` not set |

## Stripe Mode Notes

- No live Stripe keys were changed in this batch.
- The soft-launch posture remains: vendor onboarding and inventory build-out continue while checkout can still be exercised with Stripe test-mode flows.
- Payment, checkout, Connect, subscription, and webhook logic were not changed.
- Existing unit coverage still verifies webhook raw-body ordering and guarded payment routes.

## Commands Run

```powershell
node --test tests/cors/cors-login-preflight.test.js tests/cors/cors-origins.test.js
npm test
./scripts/smoke-backend.ps1 -ApiBaseUrl https://api.mosaicbizhub.com
Invoke-RestMethod -Uri https://api.mosaicbizhub.com/api/build-info
Invoke-RestMethod -Uri https://api.mosaicbizhub.com/api/health
Invoke-RestMethod -Uri https://api.mosaicbizhub.com/api/ready
```

Results:

- Focused CORS tests: 11 passed.
- Full backend unit suite: 427 passed.
- Production smoke: 28 passed, 0 failed, 2 skipped, 5 blocked.

## Launch Risk Summary

The production backend is healthy for public marketplace browsing, canonical featured products, CORS from approved frontend origins, and guarded unauthenticated access. Remaining production launch proof requires dedicated smoke tokens and selected product/business IDs so authenticated vendor, customer, and admin flows can be checked without exposing credentials in code or docs.
