# MVP Backend Marketplace Data Contract

**Issue:** [#28 Marketplace data contract for cards and detail pages](https://github.com/Techware-Hut/mosaic-backend/issues/28)  
**Implementation:** [`lib/listing/publicListingDto.js`](../lib/listing/publicListingDto.js)

## Audit dependency

The **full** MVP backend API audit lives in [PR #36](https://github.com/Techware-Hut/mosaic-backend/pull/36) (`sprint/backend-mvp-api-audit`, issue #26). This branch keeps a minimal [`MVP_BACKEND_API_AUDIT.md`](MVP_BACKEND_API_AUDIT.md) stub only — do not duplicate the full audit here.

## Purpose

Normalize **public** marketplace, listing, and featured-product responses so the frontend redesign can render cards and detail pages from live backend data. All changes are **additive**: legacy response keys are preserved.

## Canonical featured endpoint

**`GET /api/featured-products`** is the only public featured-products route. There is no `/api/products/featured`.

## DTO functions

| Function | Use |
|----------|-----|
| `toPublicListingCard(raw, { listingType })` | Product, service, food list/card responses |
| `toPublicListingDetail(raw, { listingType, extras })` | Detail pages; extends card with variants, tax, etc. |
| `toPublicBusinessCard(raw)` | Business/vendor browse and profile cards |

## Normalized frontend-safe fields (additive)

These fields are added to responses where source data exists. Missing values are `null`, `[]`, or a safe string fallback — never `undefined`. **No fake ratings, badges, locations, or statistics are invented.**

| Field | Type | Source / fallback |
|-------|------|-------------------|
| `id` | string | from `_id` |
| `listingType` | string | `product`, `service`, `food`, or `business` |
| `title` / `name` | string \| null | listing title or business name |
| `slug` | string \| null | when stored on listing/business |
| `description` | string \| null | full description |
| `shortDescription` | string \| null | truncated from description (~160 chars) |
| `image` / `imageUrl` | string \| null | `coverImage` → `images[0]` → vendor `logo` |
| `images` | string[] | Card/list: primary image only (`[]` when none). Detail: full deduped gallery |
| `price` | number \| null | `null` when missing (not coerced to 0) |
| `priceLabel` / `displayPrice` | string | `"Contact for price"` when price is null; else `$X.XX` |
| `vendorId` / `businessId` | string \| null | from populated or raw business ref |
| `vendorName` | string \| null | from business |
| `vendorLogo` | string \| null | business logo when joined |
| `business` | object \| null | `{ businessId, businessName, logo, badge, email, phone, address, slug }` |
| `category` / `subcategory` | object \| null | `{ id, name, slug }` |
| `location` | object \| null | from `location`, `contact.address`, or business address |
| `city` / `state` | string \| null | parsed from address when present |
| `tags` | string[] | `[]` when not joined |
| `status` / `availability` | string \| null | `available`, `unavailable`, or null |
| `averageRating` | number \| null | only when stored on listing |
| `totalReviews` | number | count from listing; `0` when absent |
| `badge` | string \| null | only when present on Business |
| `verified` | boolean \| null | only when onboarding status is known |
| `contact` | object \| null | `{ email, phone }` when available |
| `detailPath` | string \| null | frontend routing hint |
| `createdAt` / `updatedAt` | ISO date | passed through when present on raw doc |

### Card vs detail media

| Response | `images[]` | Omitted from cards |
|----------|------------|-------------------|
| List/card (`toPublicListingCard`) | Primary image only (0 or 1 entry) | `videos` and other non-whitelisted raw doc fields |
| Detail (`toPublicListingDetail`) | Full deduped gallery | — |

Cards still pass through whitelisted legacy keys (`_id`, `coverImage`, `categoryId`, etc.) for backward compatibility with #28.

---

## Endpoint reference

### Featured products

| | |
|---|---|
| **Endpoint** | `GET /api/featured-products` |
| **Auth** | None (public) |
| **Purpose** | Paginated featured product feed for homepage/marketing |
| **DTO** | `toPublicListingCard` (`listingType: product`) |
| **Wrapper** | `{ products, pagination }` — unchanged |

**Frontend usage:** Use `products[]` for card grid. Prefer `imageUrl`, `displayPrice`, `vendorName`, `detailPath`. Pagination via `pagination.currentPage`, `totalPages`, `totalProducts`.

**Backward compatibility:** `_id`, `coverImage`, `categoryId`, `subcategoryId`, `businessId` (populated) remain. Missing price is `null` (not `0`).

**Known missing fields:** `tags`, `verified`, variant-level pricing on cards.

---

### Product browse

#### `GET /api/products/list`

| | |
|---|---|
| **Auth** | None |
| **Purpose** | Paginated product catalog with filters (category, badge, search, sort) |
| **DTO** | `toPublicListingCard` per item in `data[]` |
| **Wrapper** | `{ success, total, page, totalPages, data }` |

**Frontend usage:** Card grid from `data[]`. Badge comes from business lookup when filter applies.

**Known missing fields:** `location` unless business address populated; `tags`.

#### `GET /api/products/filters`

| | |
|---|---|
| **Auth** | None |
| **Purpose** | Products with variant summaries for filter UI |
| **DTO** | `toPublicListingCard` — `variants` remain on raw object |
| **Wrapper** | `{ success, total, page, totalPages, data }` |

**Frontend usage:** Card + variant picker. Variant prices on detail endpoint only for tax-aware amounts.

#### `GET /api/ranked` / `GET /api/:id/similar`

| | |
|---|---|
| **Auth** | None |
| **Purpose** | Ranked/similar product discovery |
| **DTO** | `toPublicListingCard` per item in `items[]` |
| **Wrapper** | `{ items, total, page, pageSize, mix }` |

---

### Product detail

#### `GET /api/public/product/:productId`

| | |
|---|---|
| **Auth** | None |
| **Purpose** | Single product detail with tax-aware pricing and variants |
| **DTO** | `toPublicListingDetail` — variants/tax in `extras` |
| **Wrapper** | `{ success, data }` |

**Frontend usage:** Detail page from `data`. Use `variants[]` for SKU/size selection. Tax fields (`taxRate`, `priceInclTax`, etc.) unchanged.

#### `GET /api/public/products/business/:businessId`

| | |
|---|---|
| **Auth** | None |
| **Purpose** | Products for a specific vendor storefront |
| **DTO** | `toPublicListingCard` per item in `data[]` |

---

### Unified search

#### `GET /api/public/search`

| | |
|---|---|
| **Auth** | None |
| **Purpose** | Keyword/location/minority-type search across products, services, foods |
| **DTO** | `toPublicListingCard` per array (`listingType` per kind) |
| **Wrapper** | `{ success, filters, totals, data: { products, services, foods } }` |

**Frontend usage:** Tabbed results from `data.products`, `data.services`, `data.foods`. Counts in `totals`.

**Post-MVP gap (#29):** ZIP/geolocation filtering not implemented.

---

### Services

#### `GET /api/services/list`

| | |
|---|---|
| **Auth** | None |
| **Purpose** | Paginated service catalog |
| **DTO** | `toPublicListingCard` — legacy `businessDetails` preserved |
| **Wrapper** | `{ success, total, page, totalPages, data }` |

**Frontend usage:** Cards from `data[]`. Rich vendor info in `businessDetails` (legacy) and normalized `business`/`vendorName`.

#### `GET /api/public/services/:id`

| | |
|---|---|
| **Auth** | None |
| **Purpose** | Service detail with vendor profile |
| **DTO** | `toPublicListingDetail` on `service`; `toPublicBusinessCard` on `business` |
| **Wrapper** | `{ success, data: { service, business } }` |

---

### Food / restaurants

#### `GET /api/food/list`

| | |
|---|---|
| **Auth** | None |
| **Purpose** | Paginated food/restaurant listings |
| **DTO** | `toPublicListingCard` (`listingType: food`) |

#### `GET /api/public/foods/:id`

| | |
|---|---|
| **Auth** | None |
| **Purpose** | Food detail with vendor profile |
| **DTO** | `toPublicListingDetail` + `toPublicBusinessCard` |

---

### Business / vendor profiles

#### `GET /api/business/`

| | |
|---|---|
| **Auth** | None |
| **Purpose** | Product-type business browse cards |
| **DTO** | `toPublicBusinessCard` per item in `data[]` |

#### `GET /api/business/public/:slug`

| | |
|---|---|
| **Auth** | None |
| **Purpose** | Public business profile by slug |
| **DTO** | `toPublicBusinessCard` on `data` |

#### `GET /api/public/product/vendor-profile/:businessId`

| | |
|---|---|
| **Auth** | None |
| **Purpose** | Vendor profile for product storefront pages |
| **DTO** | `toPublicBusinessCard` on `data.business`; `vendorDetails` sibling unchanged |

---

## Backward compatibility (all endpoints)

- Legacy keys (`_id`, `coverImage`, `categoryId`, `subcategoryId`, `businessId`, `businessDetails`) remain when previously returned.
- Response wrappers unchanged (`{ products, pagination }`, `{ success, data }`, etc.).
- New canonical fields are **added alongside** legacy fields.

## Known missing / blocked fields

| Field | Limitation |
|-------|------------|
| `tags` | Live on `Business.tags`; not joined in all list queries → `[]` |
| `verified` | Requires `VendorOnboardingStage1.status` → `null` unless context provided |
| `location` / `city` / `state` | Only when address/location present on raw doc or populated business |
| Variant card pricing | Filter list uses product-level price; variant pricing on detail only |
| ZIP / geolocation | Out of scope (#29) |

## Post-MVP gaps

- Issue #29: search category, location, and tag filtering readiness
- Issue #26: full API audit (PR #36)
- Live E2E smoke against MongoDB (automated tests use mocks)

## Tests

- [`tests/marketplace/public-listing-dto.test.js`](../tests/marketplace/public-listing-dto.test.js)
- [`tests/marketplace/featured-products-response.test.js`](../tests/marketplace/featured-products-response.test.js)

Run: `npm test`

## Out of scope (issue #28)

- Stripe, checkout, webhooks, payment intent creation
- ZIP/geolocation search
- Admin or vendor-private routes
- New `/api/products/featured` alias
- Production deployment
