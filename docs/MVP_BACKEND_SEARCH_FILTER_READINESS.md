# MVP Backend Search & Filter Readiness (Issue #29)

**Branch:** merged via PR #38 → `main`  
**Status:** **Deployed to production** (2026-06-17)

## Purpose

Document honest, test-backed search/filter behavior for public marketplace endpoints. Shared helpers live in `lib/listing/publicSearchFilters.js`.

**Principle:** Do not invent geolocation, radius search, or fake `distanceMiles` fields. ZIP filtering is **exact match** on `address.zipCode` only.

---

## Endpoint matrix

| Endpoint | Keyword | Category | Tag | City/State/Country | ZIP exact | Verified | Pagination | Notes |
|----------|---------|----------|-----|-------------------|-----------|----------|------------|-------|
| `GET /api/public/search` | yes (`keyword`, `search`) | yes (`categoryId`, `categorySlug`) | yes (`tag`, `tags`) | yes (`location` regex + `city`, `state`, `country`) | yes (`zip`) | yes (`verified=true`) | `page`, `limit` | `listingType=product\|service\|food\|all`; geo params listed in `filters.unsupported` |
| `GET /api/products/list` | yes | yes | yes | yes (listing `address.*`) | yes | yes | `page`, `limit` | Visible-business gate; `businessId.tags` populated on cards |
| `GET /api/products/filters` | same as list | same | same | same | same | same | yes | `totalPages` uses post-variant-filter count |
| `GET /api/services/list` | yes | yes | yes | yes (business address join) | yes | yes | yes | `isPublished: true`; state/country via business scope |
| `GET /api/food/list` | yes | yes | yes | yes | yes | yes | yes | Visible-business gate; `isPublished: true`; default price 0–200 unless `price=all` |
| `GET /api/business/` | yes | `productCategory` | yes | exact match (unchanged) | yes | no | yes | Product vendors only |

---

## Query parameters

### Unified public search (`GET /api/public/search`)

| Param | Behavior |
|-------|----------|
| `keyword` / `search` | Text match on listing fields + business name/description/tags |
| `location` | Flexible regex on business/vendor address fields (includes `address.zipCode` substring) |
| `city`, `state`, `country` | Dedicated address filters (flexible regex) |
| `zip` | Exact match on `Business.address.zipCode` and `VendorOnboardingStage1.address.zipCode` |
| `tag` / `tags` | Exact case-insensitive match on `Business.tags` (comma-separated in `tags`) |
| `verified=true` | Intersect with vendors where `VendorOnboardingStage1.status === 'verified'` |
| `categoryId` / `categorySlug` | Filter by category per listing type |
| `listingType` | `product`, `service`, `food`, or `all` (default `all`) |
| `minorityType` | Existing minority filter (unchanged) |
| `page`, `limit` | Offset pagination; limit clamped 1–50 |
| `radius`, `lat`, `lng`, `nearMe` | **Unsupported** — ignored for query; echoed in `filters.unsupported` |

### List endpoints (products, services, food)

Optional additive params: `tag`, `tags`, `zip`, `verified=true`, plus existing filters.

Food-only: `price=all` disables the default `price: 0–200` MVP filter.

### Business browse (`GET /api/business/`)

Optional: `tag`, `tags`, `zip` (exact on `address.zipCode`). City/state/country remain **exact match** (legacy behavior).

---

## Frontend usage examples

```bash
# Keyword + tag + verified vendors
curl "https://api.mosaicbizhub.com/api/public/search?keyword=organic&tag=local&verified=true&limit=10"

# ZIP exact (not radius)
curl "https://api.mosaicbizhub.com/api/public/search?zip=90210&listingType=product"

# Category slug + city
curl "https://api.mosaicbizhub.com/api/public/search?categorySlug=handmade&city=Atlanta"

# Products list with tag + zip
curl "https://api.mosaicbizhub.com/api/products/list?tag=organic&zip=30301&page=1&limit=20"

# Food without default price cap
curl "https://api.mosaicbizhub.com/api/food/list?price=all&city=Chicago"

# Rejected geolocation (still 200; params listed as unsupported)
curl "https://api.mosaicbizhub.com/api/public/search?lat=33.7&lng=-84.4&radius=10"
```

Response excerpt for unsupported geo:

```json
{
  "success": true,
  "filters": {
    "unsupported": [
      { "param": "lat", "reason": "geolocation not implemented" },
      { "param": "lng", "reason": "geolocation not implemented" },
      { "param": "radius", "reason": "geolocation not implemented" }
    ]
  }
}
```

---

## ZIP vs geolocation

| Capability | Status |
|------------|--------|
| ZIP exact on `address.zipCode` | **Implemented** |
| ZIP substring via `location` text search | **Included** in location regex set |
| Radius / lat/lng / near me | **Not implemented** |
| `distanceMiles` in responses | **Never added** |

Future phase requires a geocoding pipeline and indexed coordinates (Business GeoJSON or dedicated collection). Business `location` GeoJSON is commented out in schema today.

---

## Tags and verified behavior

| Field | Source | Notes |
|-------|--------|-------|
| Tag filter | `Business.tags` only | Exact match; no listing-level tags invented |
| Tags on cards | Populated from `businessId.tags` | Batch-loaded in list/search handlers |
| Verified filter | `VendorOnboardingStage1.status === 'verified'` | Optional `verified=true` |
| Verified on cards | Batch `loadVerifiedByBusinessIds` | `true` / `false` / `null` (unknown) |
| DTO fix | `resolveVerified` | No longer treats Stripe `onboardingStatus` as verified |

---

## Known MVP gaps (documented, not hidden)

| Gap | Detail |
|-----|--------|
| No radius / near-me search | By design until geo index + geocoding exist |
| Food default price filter | `0–200` applied unless `price=all` |
| Services `openNow` | Query param accepted elsewhere but not wired to hours logic |
| Business browse location | City/state/country remain exact match (not flexible regex) |
| Admin tags CRUD | Still no admin API; tags set on Business profile only |

---

## Tests

| File | Count | Coverage |
|------|------:|----------|
| `tests/marketplace/public-search-filters.test.js` | 15 | Query parsing, tag/ZIP resolution, verified DTO fix, search handler empty/geo/listingType/shape |
| Full suite | **92** | `npm test` |

---

## Backward compatibility

- All new query params are **additive**; existing clients unchanged.
- Response shapes unchanged; search adds optional `filters` metadata (including `unsupported`).
- Services/food now require `isPublished: true` (aligns with products/public search).
- Food list applies visible-business gate (aligns with products/services).

---

## Production deployment

| Field | Value |
|-------|-------|
| Merge commit | `9f66c079a80ec204e5c041cad3cc8799a266a1c8` (PR [#38](https://github.com/Techware-Hut/mosaic-backend/pull/38)) |
| GHA deploy run | [27720127626](https://github.com/Techware-Hut/mosaic-backend/actions/runs/27720127626) — **success** |
| EB version label | `mosaic-9f66c079a80ec204e5c041cad3cc8799a266a1c8` |
| EB application / environment | `mosaic-biz-hub-backend` / `mosaic-backend-env` |
| API base | `https://api.mosaicbizhub.com` |
| Smoke date | 2026-06-17 |

### Production smoke results (2026-06-17)

| Endpoint | HTTP | Result | Notes |
|----------|------|--------|-------|
| `GET /api/public/search?keyword=test&limit=5` | 200 | **PASS** | `filters.keyword=test`; `displayPrice` on cards |
| `GET /api/public/search?zip=90210&listingType=product` | 200 | **PASS** | Empty result set safe; no crash |
| `GET /api/public/search?tag=organic&verified=true` | 200 | **PASS** | Empty result set safe; filters echoed |
| `GET /api/public/search?lat=33.7&lng=-84.4&radius=10` | 200 | **PASS** | `filters.unsupported` lists lat/lng/radius; no `distanceMiles` |
| `GET /api/products/list?tag=organic&zip=90210` | 200 | **PASS** | Empty result set safe; DTO keys preserved on non-empty list |
| CORS (launch Vercel origin) | 204/200 | **PASS** | `Access-Control-Allow-Origin` exact match |

**Soft gaps (not blockers):** No prod businesses match `tag=organic` + `zip=90210`; empty arrays are expected and safe.

**Conclusion:** Issue #29 search/filter readiness verified on production. For current program-wide status and what followed (#30 live, #31 in PR #40), see [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md).
