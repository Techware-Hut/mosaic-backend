# Legacy Route and Dead-Code Cleanup Audit

**Issue:** #60
**Last updated:** 2026-06-23

## Summary

This audit identifies duplicate, legacy, or cleanup-candidate backend surfaces without deleting runtime code. The current launch-safe policy is to keep canonical public APIs stable, add tests before removals, and deprecate aliases in small PRs.

## Stripe and Payment Surfaces

| Surface | Mount/status | Cleanup note |
| --- | --- | --- |
| `routes/stripeRoutes.js` + `controllers/stripeController.js` | Mounted at `/api/stripe` | Legacy subscription checkout/webhook surface. Keep until vendor subscription flow is fully mapped. |
| `routes/stripe.routes.js` + `controllers/stripe.controller.js` | Mounted at `/stripe` | Newer Connect helper surface. Keep as canonical Connect self-service API for now. |
| `routes/paymentRoutes.js` + `controllers/paymentController.js` | Mounted at `/api/payments` | Legacy customer PaymentIntent API. It remains guarded, but new order checkout is under orders. |
| `controllers/stripePaymentController.js` | Used by order payment webhook and retrieve-intent polling | Keep. It contains sanitized PaymentIntent response helpers. |
| `controllers/webhookController.js` | Webhook handlers | Keep. Must remain raw-body protected. |
| `controllers/subscriptionController.js`, `controllers/subscriptions.controller.js`, `controllers/subscriptionPlanController.js` | Subscription/plan APIs | Overlapping naming. Do not merge until admin/vendor subscription flows are smoke-tested. |

Cleanup order:

1. Document the frontend callers for `/api/stripe`, `/stripe`, `/api/payments`, and `/api/orders/initiate`.
2. Mark legacy `/api/payments/create-payment-intent` as deprecated in docs only.
3. Add contract tests around the canonical checkout path before removing any legacy payment route.
4. Split subscription controller naming cleanup into a separate PR after admin subscription pages are verified.

## Listing and Marketplace Surfaces

| Surface | Mount/status | Cleanup note |
| --- | --- | --- |
| `routes/publicListing.js` + `controllers/publicListing.js` | Mounted under `/api` | Canonical public browse/detail/search API surface. Preserve. |
| `routes/privateListing.js` + `controllers/privateListing.js` | Mounted under `/api/private` | Vendor/private listing helpers. Keep until vendor dashboard callers are fully mapped. |
| `controllers/productListingController.js` | Route usage needs follow-up verification | Candidate for future consolidation after route/caller scan. |
| `controllers/productController.js`, `controllers/serviceController.js`, `controllers/foodController.js` | Owner CRUD surfaces | Keep. These are active vendor/admin flows. |
| `controllers/featuredProducts.controller.js` + `routes/featuredProductRoutes.js` | Mounted under `/api`; exposes `GET /api/featured-products` | Canonical featured-products route. Preserve. Do not reintroduce `/api/products/featured`. |

Cleanup order:

1. Preserve `GET /api/featured-products` as canonical.
2. Audit frontend callers for `/api/private/*` before changing `privateListing`.
3. Consolidate DTO mapping through `lib/listing/publicListingDto.js` only when individual controller tests cover the affected response shapes.
4. Avoid deleting `productListingController.js` until a route-level unused-file check confirms no import path depends on it.

## CMS and Content Routes

| Surface | Mount/status | Cleanup note |
| --- | --- | --- |
| `routes/admin/cmsRoutes.js` | Mounted at `/api/cms` and `/cms` | Active CMS surface despite admin folder naming. Requires auth review before route changes. |
| `routes/cms/cmsRoutes.js` | Not mounted from `app.js` in this audit | Candidate for future removal or explicit archive once confirmed unused. |
| `controllers/pubic/cms.controller.js` | Spelling indicates legacy/unused risk | Candidate for future archive after confirming no imports. |

Cleanup order:

1. Add a route registration test for CMS mounts before touching CMS files.
2. Decide whether `/cms` should remain an alias for `/api/cms`.
3. Archive or delete unmounted CMS files only after import checks pass.

## Deprecated or Alias Routes

| Route | Current posture |
| --- | --- |
| `/api/featured-products` | Canonical public featured product route. |
| `/api/products/featured` | Must stay absent. Existing contract tests guard this. |
| `/api/payments/create-payment-intent` | Legacy but guarded. Keep until checkout caller inventory is complete. |
| `/api/orders/initiate` | Canonical customer checkout initiation path. |

## Files Not Safe To Delete Yet

- `controllers/stripeController.js`
- `controllers/stripe.controller.js`
- `controllers/stripePaymentController.js`
- `controllers/paymentController.js`
- `controllers/privateListing.js`
- `controllers/productListingController.js`
- `routes/cms/cmsRoutes.js`
- `controllers/pubic/cms.controller.js`

## Recommended PR Order

1. Add route/caller inventory tests for CMS and payment surfaces.
2. Deprecate legacy payment docs and keep runtime behavior unchanged.
3. Remove or archive unmounted CMS files after import tests prove they are unused.
4. Consolidate listing DTO helpers only after public browse/search/detail tests cover all listing types.
5. Rename or split subscription controllers after subscription admin/vendor pages have a passing smoke pack.

## Verification

This is a documentation-only audit. Runtime verification for the same branch:

- `npm test`
- `npm run test:contract`
