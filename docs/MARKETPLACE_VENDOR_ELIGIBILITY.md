# Marketplace Vendor Eligibility

**Type:** Source of truth  
**Last updated:** 2026-06-23  
**Frontend mirror:** `Digital-Builders-757/mosaic-biz-frontend-launch/docs/MARKETPLACE_VENDOR_ELIGIBILITY.md`

This document explains the difference between admin business status and public marketplace visibility.

## Rule

A business is public on Mosaic only when both flags are true:

```js
business.isApproved === true && business.isActive === true
```

Backend helper:

- `lib/marketplace/businessEligibility.js`
- `isPublicMarketplaceBusiness(business)`
- `publicMarketplaceBusinessFilter(extra)`

## Status Meanings

| State | Field(s) | Effect |
| --- | --- | --- |
| Approved | `Business.isApproved` | Vendor application/admin approval is complete |
| Admin active | `Business.isActive` | Admin has not disabled the business record |
| Public on marketplace | `isApproved && isActive` | Business and listings may appear on public marketplace surfaces |
| Checkout ready | Public on marketplace + Stripe Connect ready | Orders can be initiated and paid |

`isActive` alone does not list a vendor publicly. `isApproved` alone does not override deactivation.

## Enforced Backend Surfaces

| Endpoint | Controller | Behavior |
| --- | --- | --- |
| `GET /api/business` | `controllers/businessController.js` | Returns only eligible product businesses |
| `GET /api/products/list` | `controllers/publicListing.js` | Products must be published, not deleted, and owned by an eligible business |
| `GET /api/ranked` | `controllers/productListingController.js` | Ranked feed is scoped to eligible businesses |
| `GET /api/public/search` | `controllers/publicListing.js`, `lib/listing/publicSearchFilters.js` | Search filters are intersected with eligible business IDs |
| `GET /api/public/product/:id` | `controllers/publicListing.js` | 404 for unpublished/deleted products or ineligible businesses |
| `GET /api/public/products/business/:businessId` | `controllers/publicListing.js` | Empty list for ineligible business IDs |
| `GET /api/public/product/vendor-profile/:businessId` | `controllers/publicListing.js` | 404 for ineligible business IDs |
| `GET /api/featured-products` | `controllers/featuredProducts.controller.js` | Preserves `{ products, pagination }`; excludes ineligible business products |
| `POST /api/cart/add` | `controllers/customer/cartController.js` | 403 with clear message for ineligible vendors |
| `GET /api/cart` | `controllers/customer/cartController.js` | Removes stale lines for unavailable listings or ineligible vendors |
| `POST /api/orders/initiate` | `controllers/orderController.js` | Checks eligibility, then Stripe Connect readiness |

## Admin Flow

| Action | Backend behavior |
| --- | --- |
| Stage-1 finalize approved | Sets onboarding `status: "verified"` and syncs `Business.isApproved = true` when a Business exists |
| Stage-1 finalize rejected | Sets onboarding `status: "rejected"` and syncs `Business.isApproved = false` when a Business exists |
| `POST /admin/api/business/approve/:id` | Idempotently sets `isApproved = true` and `isActive = true` after `onboardingStatus === "completed"` |
| `PATCH /admin/api/business/status/:id` | Updates `isActive` only; returns `publicMarketplaceEligible` so admins can see activation is not approval |

## Customer Messages

Cart add:

```text
This vendor is not approved and active for the public marketplace.
```

Cart read after stale line cleanup:

```text
Some items were removed from the cart because their vendor is no longer approved and active.
```

Order initiate:

```text
This vendor is not approved and active for checkout.
```

## QA Checklist

1. Business with `isActive: true`, `isApproved: false` is hidden from directory, list, search, ranked, featured, product detail, vendor profile, and storefront products.
2. `POST /api/cart/add` rejects that business's product.
3. `GET /api/cart` removes any stale lines for that business.
4. Admin activation leaves `isApproved: false` and `publicMarketplaceEligible: false`.
5. Admin approve sets `isApproved: true` and `isActive: true`.
6. Eligible vendor with Stripe Connect ready can still initiate checkout.
