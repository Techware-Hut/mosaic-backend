# Marketplace Visibility Matrix (Issue #77)

**Date:** 2026-06-18  
**Branch:** `sprint/backend-deploy-smoke-sentry-18-27`  
**Related:** [MVP_BACKEND_API_AUDIT.md](MVP_BACKEND_API_AUDIT.md), [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md)

---

## Purpose

Document which listing and business fields gate **browse**, **search**, **featured**, **ranked**, **detail**, and **checkout** visibility for public marketplace APIs.

---

## Core visibility fields

| Field | Model | Meaning | Public browse/search |
| --- | --- | --- | --- |
| `Business.isActive` | `Business` | Vendor business enabled for marketplace | **Required** — inactive businesses excluded from all public lists |
| `Product.isPublished` | `Product` | Vendor published listing | **Required** for product lists, search, featured, ranked, detail |
| `Product.isDeleted` | `Product` | Soft delete | **Excluded** when `true` |
| `Product.isFeatured` | `Product` | Featured carousel flag | Required only on `/api/featured-products` |
| `Service.isPublished` | `Service` | Service listing published | **Required** for service lists and search |
| `Food.isPublished` | `Food` | Food listing published | **Required** for food lists and search |
| `Food.isDeleted` | `Food` | Soft delete | **Excluded** when `true` |
| `VendorOnboardingStage1.status` | Onboarding | `verified` = admin approved Stage 1 | Used for **verified badge** in search metadata, not a hard list filter |
| `Business.isApproved` | `Business` | Legacy/admin approval flag | **Not** used as primary public list gate (active + published drive browse) |

**Checkout / payment** is out of scope for this matrix — governed by cart, order, and Stripe Connect routes with separate auth and business rules.

---

## Visibility by surface

### Browse lists (`controllers/publicListing.js`)

| Endpoint | Route | Listing filters | Business scope |
| --- | --- | --- | --- |
| Services list | `GET /api/services/list` | `isPublished: true` | `getVisibleBusinessIds()` → `Business.isActive: true` |
| Products list | `GET /api/products/list` | `isPublished: true`, `isDeleted: false` | Active businesses only |
| Food list | `GET /api/food/list` | `isPublished: true`, `isDeleted: false` | Active businesses only |
| Products by business | `GET /api/products/business/:businessId` | `isPublished: true`, `isDeleted: false` | Target business must be `isActive: true` |
| Vendor profile | `GET /api/vendor/:businessId` | N/A (business card) | `isActive: true` or 404 |

Helper: `getVisibleBusinessIds()` in [`controllers/publicListing.js`](../controllers/publicListing.js) loads all `Business.find({ isActive: true })`.

### Unified search

| Endpoint | Route | Rules |
| --- | --- | --- |
| Public search | `GET /api/public/search` | `parsePublicSearchQuery()` caps `limit` at 50; intersects keyword/location/tag/verified filters with active businesses; each listing type requires `isPublished` (+ `isDeleted: false` for products/food) |

Verified filter uses `VendorOnboardingStage1.status === 'verified'` — narrows **business IDs**, not individual listing publish flags.

### Featured feed

| Endpoint | Route | Rules |
| --- | --- | --- |
| Featured products | `GET /api/featured-products` | `isFeatured: true`, `isPublished: true`, `isDeleted: false`, `businessId ∈ active businesses` |

Implementation: [`controllers/featuredProducts.controller.js`](../controllers/featuredProducts.controller.js).

### Ranked / similar products

| Endpoint | Route | Rules |
| --- | --- | --- |
| Ranked products | `GET /api/ranked` | `isPublished: true`, `isDeleted: false`, active business scope |
| Similar products | `GET /api/:id/similar` | Same ranked handler via `attachSimilarQuery` |

Implementation: [`controllers/productListingController.js`](../controllers/productListingController.js) — `listProductsRanked`.

### Detail by ID / slug

| Surface | Gate |
| --- | --- |
| Product by ID | Active business + published product |
| Service by slug / ID | `isPublished: true` + active business |
| Food by ID | Published + not deleted + active business |

Unpublished or inactive-business listings return empty/404 — never leak draft content in public DTOs (`toPublicListingCard`).

---

## Decision matrix (quick reference)

| Scenario | Visible in browse/search? | Visible in featured? | Visible in ranked? |
| --- | --- | --- | --- |
| Published product, active business | Yes | Only if `isFeatured` | Yes |
| Unpublished product, active business | No | No | No |
| Published product, inactive business | No | No | No |
| Draft vendor onboarding, no listings | No | No | No |
| Verified badge, unpublished listing | No (badge irrelevant until published) | No | No |

---

## Automated test coverage

| Test file | What it proves |
| --- | --- |
| [`tests/marketplace/featured-products-response.test.js`](../tests/marketplace/featured-products-response.test.js) | Featured query scopes to active businesses; limit capped at 50; DTO mapping |
| [`tests/marketplace/ranked-products-visibility.test.js`](../tests/marketplace/ranked-products-visibility.test.js) | Ranked feed excludes unpublished / inactive-business products |
| [`tests/marketplace/public-search-filters.test.js`](../tests/marketplace/public-search-filters.test.js) | Search filter parsing, limit cap 50, verified/location helpers |
| [`tests/marketplace/public-listing-dto.test.js`](../tests/marketplace/public-listing-dto.test.js) | Public card shape — no internal fields leaked |

Deploy smoke: `GET /api/featured-products` included in `npm run smoke:backend` ([`docs/TEST_MATRIX.md`](TEST_MATRIX.md)).

---

## Known gaps (document only — not launch blockers)

| Gap | Tracking |
| --- | --- |
| No centralized visibility middleware — rules duplicated across controllers | Future refactor |
| `Business.isApproved` not enforced on all public paths | Align with product policy if required |
| Moderation / takedown workflow beyond `isActive` | Post-launch admin tooling (#34) |
| Food/Service compound indexes for publish+delete queries | [#53](DATABASE_INDEX_AUDIT.md) |

---

## Issue #77 resolution

Acceptance criteria satisfied: visibility rules documented, mapped to source files, and linked to existing automated tests. No contract-breaking code changes required.
