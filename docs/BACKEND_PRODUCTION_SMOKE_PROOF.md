# Backend Production Smoke Proof

**Issue:** [#84 Backend production smoke proof for domain/API/auth](https://github.com/Techware-Hut/mosaic-backend/issues/84)  
**Branch:** `release/backend-post-merge-production-stabilization`  
**Frontend batch:** [mosaic-biz-frontend-launch#188](https://github.com/Digital-Builders-757/mosaic-biz-frontend-launch/issues/188)  
**Recorded:** 2026-06-22 UTC  
**Production API:** `https://api.mosaicbizhub.com`  
**Production release:** `403d68e` / `mosaic-403d68e`  
**Repo `main` HEAD:** `0af8803` (51 commits ahead of production)

No secrets in this document.

---

## Deploy status

| Field | Value | Result |
|-------|-------|--------|
| Live API reachable | yes | **Passed** |
| Release identity on health/build-info | yes | **Passed** |
| Production matches `main` | no — stale | **Failed** |
| Post-merge code on production | no | **Failed** — redeploy required |

---

## Smoke script

```powershell
./scripts/smoke-backend.ps1 -ApiBaseUrl https://api.mosaicbizhub.com
```

**Summary:** PASS=24 FAIL=0 SKIP=2 BLOCKED=5

---

## Public endpoints

| Probe | HTTP | Expected | Result |
|-------|------|----------|--------|
| `GET /` | 200 | 200 | **Passed** |
| `GET /api/health` | 200 | 200 | **Passed** |
| `GET /api/ready` | 200 | 200 | **Passed** |
| `GET /api/build-info` | 200 | 200 | **Passed** |
| Release identity (health) | present | commit/env/version | **Passed** |
| `X-Request-Id` on health | present | header set | **Passed** |
| `GET /api/featured-products` | 200 | 200 | **Passed** |
| `GET /api/products/list?limit=5` | 200 | 200 | **Passed** |
| `GET /api/public/search?keyword=test&limit=5` | 200 | 200 | **Passed** |
| `GET /api/services/list?limit=5` | 200 | 200 | **Passed** |
| `GET /api/food/list?limit=5` | 200 | 200 | **Passed** |
| `GET /api/products/featured` | 404 | 404 (canonical is `/api/featured-products`) | **Passed** |

---

## CORS (see [CORS_PRODUCTION_SMOKE_PROOF.md](CORS_PRODUCTION_SMOKE_PROOF.md))

| Origin | Result |
|--------|--------|
| `https://app.mosaicbizhub.com` | **Passed** |
| `https://mosaic-biz-frontend-launch.vercel.app` | **Passed** |

---

## Auth guards (unauthenticated)

| Route | HTTP | Result |
|-------|------|--------|
| `GET /api/users/auth/check` | 401 | **Passed** |
| `POST /api/orders/initiate` | 401 | **Passed** |
| Error envelope (no stack trace) | safe body | **Passed** |
| `POST /api/payments/create-payment-intent` | 401 | **Passed** |
| `POST /api/connect/:id/account-link` | 401 | **Passed** |
| `GET /admin/users` | 401 | **Passed** |
| `GET /admin/api/products` | 401 | **Passed** |
| `GET /stripe/account-balance` | 401 | **Passed** |

---

## Admin / noted exposures

| Route | HTTP | Result |
|-------|------|--------|
| `GET /api/admin/categories` | 200 unauth | **Noted** — documented public taxonomy |
| `GET /admin/api/products/test` | 404 | **Passed** — debug route absent |

---

## Authenticated probes

| Probe | Result |
|-------|--------|
| Customer auth/check | **Blocked** — no token |
| Vendor auth/check | **Blocked** — no token |
| Vendor `GET /api/business/my` | **Blocked** |
| Vendor onboarding-data | **Blocked** |
| Admin auth/check | **Blocked** |
| Product detail by ID | **Skipped** — no product fixture ID |
| Vendor profile by business ID | **Skipped** — no business fixture ID |
| Service publication smoke | **Blocked** — run `scripts/service-publication-smoke.ps1` with vendor env vars post-deploy |

---

## Sentry

| Check | Result |
|-------|--------|
| Init when `SENTRY_DSN` set | **Passed** (code review — [`instrument.js`](../instrument.js)) |
| Release tags match build-info | **Not Tested** live — requires Sentry project access |
| Live verification event | **Blocked** — controlled event not sent |
| Public debug-error route | **Passed** — none added |

---

## Local test suite (branch evidence)

Run at PR time — see PR body for counts.

| Command | Purpose |
|---------|---------|
| `npm test` | Unit tests |
| `npm run test:contract` | Launch contract |
| `npm run test:integration` | Integration |
| `node --test tests/connect/connect-urls.test.js` | Connect URL alignment |

---

## Launch-readiness verdict

**Not safe to deploy for frontend #188 validation** until:

1. Production EB deploy matches `main` (`0af8803` or later).
2. `/api/health` release.commit matches deployed SHA.
3. Post-deploy smoke re-run (this script + optional auth tokens).
4. EB drift items in [EB_ENVIRONMENT_DRIFT_AUDIT.md](EB_ENVIRONMENT_DRIFT_AUDIT.md) resolved.

Current production passes **public** smoke on stale runtime but lacks post-merge backend features (service publication contract, admin auth matrix, etc.).

---

## Rollback

EB application version `mosaic-403d68e` + matching release identity env vars.
