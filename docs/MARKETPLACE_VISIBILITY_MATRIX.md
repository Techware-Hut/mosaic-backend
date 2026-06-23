# Marketplace Visibility Matrix

**Type:** Reference
**Last updated:** 2026-06-23
**Source of truth:** [PLATFORM_OPERATING_MODEL.md](PLATFORM_OPERATING_MODEL.md), [MARKETPLACE_VENDOR_ELIGIBILITY.md](MARKETPLACE_VENDOR_ELIGIBILITY.md)

This matrix summarizes the backend fields that gate public browse, search, featured, ranked, detail, cart, and checkout visibility.

## Core Fields

| Field | Model | Public behavior |
| --- | --- | --- |
| `Business.isApproved` | `Business` | Required for all public marketplace business/listing surfaces |
| `Business.isActive` | `Business` | Required for all public marketplace business/listing surfaces |
| `Product.isPublished` | `Product` | Required for public product list/detail/search/featured/ranked |
| `Product.isDeleted` | `Product` | Excluded when `true` |
| `Product.isFeatured` | `Product` | Required only for `GET /api/featured-products` |
| `Service.isPublished` | `Service` | Required for public service list/detail/search |
| `Food.isPublished` | `Food` | Required for public food list/detail/search |
| `Food.isDeleted` | `Food` | Excluded when `true` |
| `VendorOnboardingStage1.status` | Onboarding | Used for verified metadata/filtering, not a replacement for `Business.isApproved` |

Public business eligibility is centralized in `lib/marketplace/businessEligibility.js`.

## Public Surfaces

| Endpoint | Listing filters | Business scope |
| --- | --- | --- |
| `GET /api/business` | `listingType: "product"` | `isApproved: true`, `isActive: true` |
| `GET /api/products/list` | `isPublished: true`, `isDeleted: false` | Eligible businesses only |
| `GET /api/ranked` | `isPublished: true`, `isDeleted: false` | Eligible businesses only |
| `GET /api/public/search` | Published listings; products exclude deleted | Search filters intersect eligible businesses |
| `GET /api/public/product/:id` | `isPublished: true`, `isDeleted: false` | 404 when business is ineligible |
| `GET /api/public/products/business/:businessId` | `isPublished: true`, `isDeleted: false` | Empty list when business is ineligible |
| `GET /api/public/product/vendor-profile/:businessId` | Business card/profile | 404 when business is ineligible |
| `GET /api/featured-products` | `isFeatured: true`, `isPublished: true`, `isDeleted: false` | Eligible businesses only; response wrapper unchanged |

## Cart And Checkout

| Endpoint | Eligibility behavior |
| --- | --- |
| `POST /api/cart/add` | Rejects products from ineligible vendors |
| `GET /api/cart` | Removes stale ineligible vendor lines |
| `POST /api/orders/initiate` | Requires eligible business, then Stripe Connect readiness |

## Decision Matrix

| Scenario | Browse/search | Featured | Cart add | Checkout |
| --- | --- | --- | --- | --- |
| Published product, approved + active business | Yes | Yes, if featured | Yes | Yes, if Connect ready |
| Published product, active but unapproved business | No | No | No | No |
| Published product, approved but inactive business | No | No | No | No |
| Unpublished product, approved + active business | No | No | No | No |
| Deleted product, approved + active business | No | No | No | No |

## Tests

| Test file | Coverage |
| --- | --- |
| `tests/integration/marketplace.integration.test.js` | Ineligible vendor hidden from public surfaces, cart add rejected, stale cart line stripped, admin approve/activate semantics |
| `tests/marketplace/featured-products-response.test.js` | Featured products scope by approved + active businesses while preserving wrapper |
| `tests/marketplace/ranked-products-visibility.test.js` | Ranked products use approved + active business scope |
| `tests/marketplace/public-search-filters.test.js` | Search business filters use approved + active business scope |
| `tests/admin/vendor-onboarding-finalize.test.js` | Finalize syncs `Business.isApproved` |
| `tests/stripe/order-initiate-connect.test.js` | Checkout blocks unapproved/inactive businesses and still requires Connect |
