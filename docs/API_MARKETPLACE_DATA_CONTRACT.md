# API Marketplace Data Contract

**Issue:** [#28 Marketplace data contract for cards and detail pages](https://github.com/Techware-Hut/mosaic-backend/issues/28)  
**Implementation:** [`lib/listing/publicListingDto.js`](../lib/listing/publicListingDto.js)  
**Related audit:** [MVP_BACKEND_API_AUDIT.md](MVP_BACKEND_API_AUDIT.md) (issue #26)

This document defines the **additive** public response contract for marketplace cards and detail pages. Legacy keys are preserved for backward compatibility.

## Canonical featured endpoint

**`GET /api/featured-products`** is the only public featured-products route. There is no `/api/products/featured`.

## DTO module

| Function | Purpose |
|----------|---------|
| `toPublicListingCard(raw, { listingType })` | Product, service, food list/card responses |
| `toPublicListingDetail(raw, { listingType, extras })` | Detail pages; extends card with tax, variants, etc. |
| `toPublicBusinessCard(raw)` | Business/vendor browse cards |

## Canonical card fields (additive)

| Field | Type | Fallback |
|-------|------|----------|
| `id` | string | from `_id` |
| `listingType` | string | `product`, `service`, `food`, or `business` |
| `title` / `name` | string \| null | listing title or business name |
| `description` | string \| null | |
| `shortDescription` | string \| null | truncated from description (~160 chars) |
| `slug` | string \| null | |
| `image` / `imageUrl` | string \| null | `coverImage` → `images[0]` → `logo` |
| `images` | string[] | `[]` |
| `price` | number \| null | `null` when missing (not coerced to 0) |
| `priceLabel` | string | `"Contact for price"` when price is null |
| `vendorId` / `businessId` | string \| null | |
| `vendorName` | string \| null | |
| `business` | object \| null | normalized vendor summary |
| `category` / `subcategory` | object \| null | `{ id, name, slug }` |
| `tags` | string[] | `[]` |
| `status` / `availability` | string \| null | `available`, `unavailable`, or null |
| `averageRating` | number \| null | |
| `totalReviews` | number | `0` when missing |
| `badge` | string \| null | only when present on Business |
| `verified` | boolean \| null | only when onboarding status known |
| `contact` | object \| null | `{ email, phone }` |
| `detailPath` | string \| null | frontend routing hint |

**Rule:** responses must not include `undefined` values.

## Endpoints using the DTO

All handlers below map responses through [`lib/listing/publicListingDto.js`](../lib/listing/publicListingDto.js) (wired in issue #28).

| Endpoint | DTO | Notes |
|----------|-----|-------|
| `GET /api/featured-products` | `toPublicListingCard` | Canonical featured feed |
| `GET /api/products/list` | `toPublicListingCard` | Product cards |
| `GET /api/products/filters` | `toPublicListingCard` | Includes variants on raw object |
| `GET /api/public/product/:productId` | `toPublicListingDetail` | Variants + tax in `extras` |
| `GET /api/public/products/business/:businessId` | `toPublicListingCard` | |
| `GET /api/public/search` | `toPublicListingCard` | products, services, foods arrays |
| `GET /api/services/list` | `toPublicListingCard` | Keeps legacy `businessDetails` |
| `GET /api/public/services/:id` | `toPublicListingDetail` + `toPublicBusinessCard` | |
| `GET /api/food/list` | `toPublicListingCard` | |
| `GET /api/public/foods/:id` | `toPublicListingDetail` + `toPublicBusinessCard` | |
| `GET /api/ranked`, `GET /api/:id/similar` | `toPublicListingCard` | |
| `GET /api/public/product/vendor-profile/:businessId` | `toPublicBusinessCard` | |
| `GET /api/business/`, `GET /api/business/public/:slug` | `toPublicBusinessCard` | |

## Backward compatibility

Existing keys remain on responses where they were previously returned:

- `_id`, `coverImage`, `categoryId`, `subcategoryId`, `businessId` (raw or populated)
- `business`, `businessDetails` nested objects
- Featured response wrapper: `{ products, pagination }`

New canonical fields are **added alongside** legacy fields.

## Fields blocked by missing source data

| Field | Limitation |
|-------|------------|
| `tags` on listing cards | Tags live on `Business.tags`; not joined in all list queries → defaults to `[]` |
| `verified` | Requires `VendorOnboardingStage1.status`; null unless passed in context |
| `shortDescription` | Derived from `description` truncation only |
| Variant-level card pricing | Filter list uses product-level price; variant pricing on detail endpoint only |
| ZIP / geolocation | Out of scope (#29); not implemented here |

## Tests

Automated: [`tests/marketplace/public-listing-dto.test.js`](../tests/marketplace/public-listing-dto.test.js), [`tests/marketplace/featured-products-response.test.js`](../tests/marketplace/featured-products-response.test.js)

Run: `npm test`

## Out of scope (issue #28)

- Stripe, checkout, webhooks
- ZIP/geolocation search
- Admin or vendor-private routes
- New `/api/products/featured` alias
