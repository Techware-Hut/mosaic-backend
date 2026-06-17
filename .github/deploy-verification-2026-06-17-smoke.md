# Backend MVP Smoke Proof — Final Report (Issue #27)

**Date:** 2026-06-17  
**Production API:** https://api.mosaicbizhub.com

## Merge status

| Item | Status |
|------|--------|
| PR #37 | **MERGED** — https://github.com/Techware-Hut/mosaic-backend/pull/37 |
| Merge commit | `7201f97dd59db953f7d469f2de4f686fb7f39217` |
| Issue #28 | **CLOSED** (auto-closed with PR #37) |

## Production deploy

| Field | Value |
|-------|-------|
| Status | **SUCCESS** |
| GitHub Actions run | https://github.com/Techware-Hut/mosaic-backend/actions/runs/27717414160 |
| Deployed SHA | `7201f97` (matches merge) |
| EB version label | `mosaic-7201f97dd59db953f7d469f2de4f686fb7f39217` |
| EB application | `mosaic-biz-hub-backend` |
| EB environment | `mosaic-backend-env` |
| API base URL | `https://api.mosaicbizhub.com` |

## Smoke endpoints tested

All **PASS** (HTTP status):

- `GET /` → 200
- `GET /api/users/auth/check` → 401
- `GET /api/featured-products` → 200
- `GET /api/products/list?limit=5` → 200
- `GET /api/products/filters?limit=5` → 200
- `GET /api/public/search?keyword=test&limit=5` → 200
- `GET /api/services/list?limit=5` → 200
- `GET /api/food/list?limit=5` → 200
- `GET /api/public/product/{id}` → 200
- `GET /api/public/services/{id}` → 200
- `GET /api/public/foods/{id}` → 200
- `GET /api/public/product/vendor-profile/{businessId}` → 200

## CORS

| Check | Result |
|-------|--------|
| OPTIONS `/api/featured-products` | **204** |
| GET with launch origin | **200** JSON |
| `Access-Control-Allow-Origin` | `https://mosaic-biz-frontend-launch.vercel.app` (exact match) |

**CORS: PASS**

## Marketplace contract

| Source | Result |
|--------|--------|
| `products/list[0]` | **PASS** — `displayPrice`, `vendorLogo`, legacy keys present |
| `services/list[0]` | **PASS** |
| `food/list[0]` | **PASS** |
| `product/detail` | **PASS** |
| `featured[0]` | **SKIP** — empty featured feed (0 items); wrapper shape valid |
| Featured wrapper | **PASS** — `{ products, pagination }` |

**DTO canary:** `displayPrice` present on products list cards — confirms PR #37 code live.

## Failures / gaps

| Gap | Severity |
|-----|----------|
| Empty featured products in prod DB | Soft — route healthy; frontend empty state |
| Featured card field matrix not exercised | Soft — no seed data |
| ZIP/geolocation (#29) | Future phase |
| Stripe/checkout runtime | Out of scope (P4/P5) |

**No hard smoke blockers.**

## Frontend production testing

**Safe to proceed** with frontend production testing against:

- Product/service/food browse and detail
- Public search and filters
- Auth 401 behavior
- CORS from `https://mosaic-biz-frontend-launch.vercel.app`

Handle empty featured feed until prod data seeded.

## Recommendation

**Start issue #29** (search/filter API readiness). No smoke blocker fixes required before frontend integration.

Evidence doc: [docs/MVP_BACKEND_SMOKE_PROOF_PACK.md](../docs/MVP_BACKEND_SMOKE_PROOF_PACK.md) § Production smoke results — 2026-06-17
