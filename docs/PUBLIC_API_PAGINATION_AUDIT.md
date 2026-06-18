# Public API Pagination Audit (Issue #44)

**Date:** 2026-06-18  
**Branch:** `sprint/backend-deploy-smoke-sentry-18-27`

---

## Purpose

Inventory every **public** list endpoint: default page size, maximum cap, and response pagination shape. Confirm no uncapped public path can return unbounded result sets.

---

## Shared helpers

| Helper | Location | Default | Max cap |
| --- | --- | --- | --- |
| `clipListPagination(page, limit, defaultLimit=10)` | [`controllers/publicListing.js`](../controllers/publicListing.js) | 10 | **50** (`PUBLIC_LIST_MAX_LIMIT`) |
| `parsePublicSearchQuery()` | [`lib/listing/publicSearchFilters.js`](../lib/listing/publicSearchFilters.js) | `limit=10`, `page=1` | **50** |
| Featured limit clamp | [`controllers/featuredProducts.controller.js`](../controllers/featuredProducts.controller.js) | 12 | **50** (`FEATURED_MAX_LIMIT`) |
| Ranked `clip()` | [`controllers/productListingController.js`](../controllers/productListingController.js) | `pageSize=24` | **60** (`Math.min(60, ...)`) |

---

## Public list endpoints

All routes mount under `/api` unless noted. Auth: none (public).

| Endpoint | Handler | Query params | Default | Max | Response shape |
| --- | --- | --- | --- | --- | --- |
| `GET /services/list` | `getAllServices` | `page`, `limit` | 10 | **50** | `{ success, total, page, totalPages, data[] }` |
| `GET /products/list` | `getAllProducts` | `page`, `limit` | 10 | **50** | `{ success, total, page, totalPages, data[] }` |
| `GET /food/list` | `getAllFood` | `page`, `limit` | 10 | **50** | `{ success, total, page, totalPages, data[] }` |
| `GET /products/business/:businessId` | `getProductsByBusinessId` | `page`, `limit`, `sort` | 10 | **50** | `{ success, total, page, totalPages, data[] }` |
| `GET /public/search` | `searchPublicListings` | `page`, `limit` (+ filters) | 10 | **50** | `{ page, limit, total, totalPages, results[] }` |
| `GET /featured-products` | `getFeaturedProducts` | `page`, `limit` | 12 | **50** | `{ products[], pagination: { currentPage, totalPages, totalProducts } }` |
| `GET /ranked` | `listProductsRanked` | `page`, `pageSize` | 24 | **60** | `{ page, pageSize, total, items[] }` (ranked wrapper) |
| `GET /:id/similar` | `listProductsRanked` | same as ranked | 24 | **60** | same |

Non-list public endpoints (`GET /vendor/:id`, product/service/food by ID) return single resources — no pagination.

---

## Cap audit findings

### All public list paths are capped

Every paginated public handler applies an explicit upper bound before `.limit()` / `.skip()`. No endpoint accepts unbounded `limit=999999` without clamping.

### Ranked feed uses 60, not 50

`listProductsRanked` caps `pageSize` at **60** (historical ranking interleave default). This is still bounded and safe; it is the only public path above 50. **No code change** in Batch 3 — documented for future unified helper work.

### Pagination param naming inconsistency

| Family | Page param | Size param |
| --- | --- | --- |
| publicListing lists | `page` | `limit` |
| Featured | `page` | `limit` |
| Ranked | `page` | `pageSize` |
| Search | `page` | `limit` |

Frontend must map accordingly. Unifying param names is a **breaking change** — deferred.

---

## Code references

```javascript
// controllers/publicListing.js
const PUBLIC_LIST_MAX_LIMIT = 50;
function clipListPagination(page, limit, defaultLimit = 10) {
  const pageN = Math.max(1, parseInt(page, 10) || 1);
  const limitN = Math.max(1, Math.min(PUBLIC_LIST_MAX_LIMIT, parseInt(limit, 10) || defaultLimit));
  return { page: pageN, limit: limitN, skip: (pageN - 1) * limitN };
}
```

```javascript
// lib/listing/publicSearchFilters.js — parsePublicSearchQuery
const limit = Math.max(1, Math.min(50, parseInt(query.limit, 10) || 10));
```

```javascript
// controllers/productListingController.js — listProductsRanked
const pageSizeN = Math.max(1, Math.min(60, Number(pageSize)));
```

---

## Test coverage

| Test | Assertion |
| --- | --- |
| [`tests/marketplace/featured-products-response.test.js`](../tests/marketplace/featured-products-response.test.js) | `getFeaturedProducts caps limit at 50` |
| [`tests/marketplace/public-search-filters.test.js`](../tests/marketplace/public-search-filters.test.js) | `parsePublicSearchQuery` clamps limit to 50 |
| [`tests/marketplace/ranked-products-visibility.test.js`](../tests/marketplace/ranked-products-visibility.test.js) | Ranked query wiring (visibility; pageSize clamp implicit in controller) |

**No new tests added in Batch 3** — audit found no uncapped public path.

---

## Recommendations (deferred)

1. Extract shared `clipPublicPagination({ page, limit, defaultLimit, maxLimit })` — default max 50, ranked override 60.
2. Add explicit ranked `pageSize` cap test (nice-to-have, not AC).
3. Document ranked `pageSize` in OpenAPI / API_SURFACE when spec is next updated.

---

## Issue #44 resolution

Acceptance criteria satisfied: full public pagination inventory, caps confirmed in source, existing tests referenced. No contract-breaking changes required.
