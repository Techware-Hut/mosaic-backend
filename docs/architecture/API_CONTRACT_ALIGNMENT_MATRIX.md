# API Contract Alignment Matrix - July 6 UAT

Date: 2026-07-06
Repo: Techware-Hut/mosaic-backend
Branch: docs/july-6-architecture-gap-audit
Base branch: staging

## Purpose

Define the cross-repo API contracts touched by the July 6 UAT defects. This matrix should be updated when implementation branches change payloads or response shapes.

## Source Of Truth Assumptions

- Frontend must consume documented backend responses instead of inferring missing fields.
- Backend must return stable identifiers, state, and pricing data for user-facing decisions.
- Route changes must preserve existing launch contracts, especially `GET /api/featured-products`.

## Files Inspected

Backend: `app.js`, `routes/*.js`, `controllers/customer/cartController.js`, `controllers/discountController.js`, `controllers/orderController.js`, `controllers/admin/vendorOnboardVerifyStage1.js`, `controllers/vendorOnboarding.controller.js`, `controllers/vendorOnboardingUpload.controller.js`, `controllers/publicListing.js`, `controllers/serviceController.js`, `utils/couponDiscount.js`, `utils/vendorShipping.js`, `utils/checkoutGuards.js`.

Frontend evidence from paired repo: `utils/cartUtils.ts`, `app/(home)/cart/page.tsx`, `app/(home)/checkout/buy-now/page.tsx`, `lib/api/vendorOnboardingAdmin.ts`, `app/(admin)/admin/vendor-applications/[id]/page.tsx`, `lib/api/services.ts`, `app/(home)/partners/services/hooks/useServices.ts`.

## Alignment Matrix

| Feature | Frontend caller | Backend route | Backend owner | Expected response | Known mismatch | Owner repo | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Featured products | Home/marketplace feature calls | `GET /api/featured-products` | `featuredProductRoutes.js` | Featured product list | None. Preserve canonical route. | Both | P1 governance |
| Cart read/pricing | `getCartDetailedResponse` | `GET /api/cart` | `cartController.js` | Items plus pricing, discount, available speeds, selected speed | Items lack vendor state/local eligibility. | Backend plus frontend | P1 |
| Cart quantity update | `updateCartQuantity` | `PUT /api/cart/update/:cartItemId` | `cartController.js` | Updated cart | Fixed on staging/develop. | Accepted | P0 closed |
| Coupon validate/apply | Cart and buy-now coupon actions | `/api/discounts/validate`, `/apply`, cart pricing | `discountController.js`, `couponDiscount.js` | Reject/accept with discount totals | Fixed. Business must approve subtotal basis. | Accepted | P0 closed |
| Checkout total | Buy-now/order flow | `POST /api/orders/initiate` | `orderController.js` | Server total, discount, shipping, order/payment data | Fixed by PR #199. | Accepted | P0 closed |
| Shipping speed | Cart/checkout chips | Cart pricing plus order initiate | `vendorShipping.js` | `availableDeliverySpeeds`, selected shipping cost | Backend exposes speeds but not eligibility field; frontend filters `local` by missing `vendorState`. | Backend plus frontend | P1 |
| Product detail | Product and buy-now pages | `GET /api/public/product/:productId` | `publicListing.js` | Listing detail, variants, business | Business state/address not returned; buy-now looks for it. | Backend | P1 |
| Service list | Vendor dashboard hook | `GET /api/service/my-services` or equivalent | `serviceController.js` | Parent services with child service array | Dashboard flattens child services; public listing still one card per parent. | Business/display decision | P1 |
| Service create/edit | Service form client | `POST/PUT /api/service` | `serviceController.js` | Persisted service with media/features | Update supports features; create drops features. | Backend | P1 |
| Vendor upload | Vendor onboarding upload client | `/api/vendor-onboarding/stage1/upload-url`, `/upload-file` | `vendorOnboardingUpload.controller.js` | S3 URL/key or proxy upload result | Code supports PDF; hosted evidence needed. | Backend plus frontend smoke | P1 evidence |
| Admin application list | `listPendingVendorApplications` | `GET /api/vendor-onboarding/pending` | `admin/vendorOnboardVerifyStage1.js` | Application array | Endpoint only returns submitted/pending queue; frontend status filter is client-side over limited data. | Backend | P1 |
| Admin application detail | Admin detail page | `GET /api/vendor-onboarding/:applicationId` | Admin/vendor onboarding controllers | Review detail and profile data | Detail improved; mandatory badge fields need approved list. | Both | P1 |
| Finalize application | `finalizeVendorApplication` | `POST /api/vendor-onboarding/:applicationId/finalize` | `admin/vendorOnboardVerifyStage1.js` | Approve/reject result and email warning metadata | Frontend posts no decision/reason/body; backend supports metadata. | Frontend primary | P1 |
| Shipment tracking email | Vendor orders action | `PUT /api/orders/ship/:orderId` | `orderController.js`, `orderPhase.js` | Order shipped, emailDelivery | Fixed in code; hosted provider evidence needed. | Backend evidence | P1 |
| Stripe Connect prompt/status | Dashboard/final review/connect tab | `/api/connect/:businessId/status`, account-link | `connectRoutes.js`, `checkoutGuards.js` | Connect status/link | Required/optional policy not scoped by listing type in UI/business rules. | Both, decision | P0/P1 |

## Required Response Shape Additions

| Contract | Required field | Reason | Recommended source |
| --- | --- | --- | --- |
| Cart item | `vendorState` or `localDeliveryEligible` | Cart page hides local delivery without this. | `Business.address.state` or future delivery zone service. |
| Public product detail | `business.address.state` or `business.state` | Buy-now page checks vendor state for local delivery. | `Business.address.state`. |
| Admin application list | `status`, `reviewDecision`, `reviewedAt`, profile summary | Admin filter and review triage. | `VendorOnboardingStage1` plus `Business` profile. |
| Service create response | `features` | Verify create persisted user-entered features. | `Service.features`. |
| Finalize request | `decision`, `rejectionReason`, `requiredNextAction`, `adminNotes` | Admin needs explicit approve/reject/change request. | Frontend body to existing backend support. |

## Acceptance Criteria

- Each frontend caller has one documented backend route and owner.
- Missing fields are added through backend contracts or frontend stops relying on them.
- Contract tests cover all changed shapes.
- Existing route names remain stable unless a migration plan exists.

## Evidence Needed

- Backend tests for any new response fields.
- Frontend unit or integration tests for caller mapping.
- Manual smoke with real vendor/customer/admin accounts after implementation.

## Open Decisions

- Local delivery definition.
- Stripe Connect requirement by listing type and payment mode.
- Mandatory admin badge review fields.
- Coupon basis confirmation.

## Next Recommended Work Order

1. Align local shipping response fields.
2. Add admin all-status list API contract.
3. Patch service create features.
4. Wire frontend finalize decision body.
