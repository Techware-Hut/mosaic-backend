# MVP Backend Smoke Proof Pack

**Issue:** [#27 Backend MVP smoke proof pack](https://github.com/Techware-Hut/mosaic-backend/issues/27)  
**When to run:** After PR #36 and PR #37 are merged **and** the deployment owner confirms the intended commit SHA is live on Elastic Beanstalk.  
**Base URL:** `https://api.mosaicbizhub.com`

This pack consolidates manual production checks for the MVP backend release. It complements — does not replace — the full tiered checklist and proof template:

- [production-smoke-checklist.md](production-smoke-checklist.md) — P0–P6 tiers
- [production-proof-pack-template.md](production-proof-pack-template.md) — release evidence matrix
- [MVP_BACKEND_API_AUDIT.md](MVP_BACKEND_API_AUDIT.md) — route map and issue coverage (post PR #36)
- [MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md](MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md) — card/detail field contract (post PR #37)

**Out of scope here:** ZIP/geolocation search (#29), Stripe/checkout deep smoke (P4/P5 tiers unchanged), deploy workflow edits.

---

## Prerequisites

1. Deployment owner confirms EB is running the approved merge commit (record SHA in proof pack).
2. Use dedicated test accounts only; redact secrets in evidence.
3. Run from PowerShell or curl against production HTTPS base URL.

```powershell
$Base = "https://api.mosaicbizhub.com"
$FrontendOrigin = "https://mosaic-biz-frontend-launch.vercel.app"
```

---

## Tier A — Infrastructure

| Check | Command | Expected |
|-------|---------|----------|
| Health | `Invoke-RestMethod "$Base/"` | HTTP 200, JSON health payload |

```powershell
Invoke-RestMethod -Uri "$Base/" -Method GET
```

---

## Tier B — Auth probe

| Check | Command | Expected |
|-------|---------|----------|
| Unauthenticated session check | `GET /api/users/auth/check` | HTTP **401** |

```powershell
try {
  Invoke-WebRequest -Uri "$Base/api/users/auth/check" -Method GET -SkipHttpErrorCheck
} catch {
  $_.Exception.Response.StatusCode.value__
}
# Expect 401
```

Or curl:

```bash
curl -s -o /dev/null -w "%{http_code}" https://api.mosaicbizhub.com/api/users/auth/check
```

---

## Tier C — Marketplace browse

Copy-paste probes. Replace `{productId}`, `{id}`, `{businessId}` with live IDs from list responses.

| Check | Endpoint |
|-------|----------|
| Featured (canonical) | `GET /api/featured-products` |
| Products list | `GET /api/products/list?limit=5` |
| Product filters | `GET /api/products/filters?limit=5` |
| Public search | `GET /api/public/search?keyword=test&limit=5` |
| Services list | `GET /api/services/list?limit=5` |
| Food list | `GET /api/food/list?limit=5` |
| Product detail | `GET /api/public/product/{productId}` |
| Service detail | `GET /api/public/services/{id}` |
| Food detail | `GET /api/public/foods/{id}` |
| Vendor profile | `GET /api/public/product/vendor-profile/{businessId}` |

```powershell
$paths = @(
  "/api/featured-products",
  "/api/products/list?limit=5",
  "/api/products/filters?limit=5",
  "/api/public/search?keyword=test&limit=5",
  "/api/services/list?limit=5",
  "/api/food/list?limit=5"
)
foreach ($p in $paths) {
  $r = Invoke-WebRequest -Uri "$Base$p" -Method GET -SkipHttpErrorCheck
  Write-Host "$p -> $($r.StatusCode)"
}
```

**Note:** There is **no** `/api/products/featured`. Use **`GET /api/featured-products`** only.

After list calls succeed, pick IDs from the first item and verify detail routes:

```powershell
# Example after featured-products returns data:
# Invoke-RestMethod "$Base/api/public/product/<productId>"
# Invoke-RestMethod "$Base/api/public/services/<serviceId>"
# Invoke-RestMethod "$Base/api/public/foods/<foodId>"
# Invoke-RestMethod "$Base/api/public/product/vendor-profile/<businessId>"
```

---

## Tier D — CORS preflight

Verify launch frontend origin is allowed (from [`app.js`](../app.js) allowlist).

```powershell
$headers = @{
  Origin = $FrontendOrigin
  "Access-Control-Request-Method" = "GET"
}
Invoke-WebRequest -Uri "$Base/api/featured-products" -Method OPTIONS -Headers $headers -SkipHttpErrorCheck
```

**Expected:** HTTP 204/200 with `Access-Control-Allow-Origin` matching the launch frontend origin (or permissive CORS headers for allowed origin).

curl equivalent:

```bash
curl -s -D - -o /dev/null -X OPTIONS \
  -H "Origin: https://mosaic-biz-frontend-launch.vercel.app" \
  -H "Access-Control-Request-Method: GET" \
  https://api.mosaicbizhub.com/api/featured-products
```

---

## Tier E — Card field shape checklist

For the **first item** in each list response (featured `products[]`, products list, services list, food list, search results), record PASS/FAIL for presence and non-`undefined` values:

| Field | PASS/FAIL | Notes |
|-------|-----------|-------|
| `_id` | | Legacy Mongo id |
| `id` | | Canonical string id when present |
| `title` or `name` | | Display name |
| `coverImage` | | Legacy image key |
| `images` | | Array (may be empty) |
| `imageUrl` | | Canonical primary image |
| `displayPrice` | | Human-readable price string |
| `priceLabel` | | Alias/legacy label |
| `price` | | Numeric or null |
| `vendor` / `vendorName` / `vendorId` | | At least one vendor identifier |
| `vendorLogo` | | URL or null (not invented) |
| `location` / `city` / `state` | | When address data exists on source doc |
| `status` / `availability` | | Listing availability signal |

**Featured wrapper:** top-level response must include `products` (array) and `pagination` (object).

```powershell
$featured = Invoke-RestMethod "$Base/api/featured-products"
$featured.products.Count -ge 0
$null -ne $featured.pagination
$card = $featured.products[0]
# Inspect $card.displayPrice, $card.vendorLogo, $card.coverImage, etc.
```

Contract reference: [MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md](MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md).

---

## Pass / fail summary

| Tier | Blocker if FAIL? | Notes |
|------|------------------|-------|
| A — Health | **Yes** | API unreachable or wrong deploy |
| B — Auth 401 | **Yes** | Session middleware regression |
| C — Marketplace GETs | **Yes** for featured + primary list routes | Detail routes need valid IDs |
| D — CORS | **Yes** for launch frontend | Blocks browser calls from Vercel app |
| E — Field shape | **Risk** (not always hard blocker) | Missing `displayPrice`/`vendorLogo` breaks cards; log per endpoint |

### Known risks (future phase)

| Item | Reference |
|------|-----------|
| ZIP/geolocation search not implemented | Issue #29, [MVP_BACKEND_API_AUDIT.md](MVP_BACKEND_API_AUDIT.md) §5 |
| Stripe/checkout runtime | P4/P5 in [production-smoke-checklist.md](production-smoke-checklist.md) |
| Unauthenticated `/stripe/*` routes | Audit §5 security gap |
| Tags/verified on some list queries | [MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md](MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md) |

---

## Evidence checklist

Copy [production-proof-pack-template.md](production-proof-pack-template.md) for the release and attach:

- [ ] EB deployed commit SHA (deployment owner sign-off)
- [ ] Tier A–D command outputs (status codes)
- [ ] Tier E field matrix for featured + one product/service/food list
- [ ] CORS OPTIONS response headers (redacted)
- [ ] Link to automated pre-merge gate: `npm test` **77/77 pass** on merge commit

**Do not overclaim:** Passing this pack proves production browse/auth/CORS health for the deployed SHA. It does not prove Stripe payouts, email delivery, or full launch sign-off. See [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md).
