# API Contract Alignment Matrix - July 6 UAT

Date: 2026-07-07 (conformance audit update)
Repo: Techware-Hut/mosaic-backend
Production branch: `main` at `ad9ddd14c85ac851f9001e5f9952c9b594159d9c`

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
| Cart read/pricing | `getCartDetailedResponse` | `GET /api/cart` | `cartController.js` | Items plus pricing, discount, available speeds, selected speed, `vendorState` per item | Conformance audit 2026-07-07: backend returns `vendorState` only; it does **not** emit `localDeliveryEligible`. Frontend treats `localDeliveryEligible` as optional and falls back to same-state `vendorState` matching. Same-state gating is client-side only (follow-up FW-6 in `docs/audit/JULY_6_DOCS_TO_CODE_CONFORMANCE_AUDIT.md`). | Implemented / Ready for QA | P1 UAT |
| Cart quantity update | `updateCartQuantity` | `PUT /api/cart/update/:cartItemId` | `cartController.js` | Updated cart | Fixed on staging/develop, pending UAT/client review. | Fixed pending UAT | P0 fix implemented |
| Coupon validate/apply | Cart and buy-now coupon actions | `/api/discounts/validate`, `/apply`, cart pricing | `discountController.js`, `couponDiscount.js` | Reject/accept with discount totals | Fixed pending UAT. Business must approve subtotal basis. | Fixed pending UAT | P0 fix implemented |
| Checkout total | Buy-now/order flow | `POST /api/orders/initiate` | `orderController.js` | Server total, discount, shipping, order/payment data | Fixed by PR #199, pending UAT/client review. | Fixed pending UAT | P0 fix implemented |
| Shipping speed | Cart/checkout chips | Cart pricing plus order initiate | `vendorShipping.js` | `availableDeliverySpeeds`, selected shipping cost, vendor state/local eligibility data when available | Fixed by July 6 PRs: backend exposes vendor state for local delivery and frontend filters local shipping by backend eligibility/same-state contract. | Implemented / Ready for QA | P1 UAT |
| Product detail | Product and buy-now pages | `GET /api/public/product/:productId` | `publicListing.js` | Listing detail, variants, business with state/address state | Fixed by July 6 contract alignment: product detail/business DTO includes state/address state used by buy-now local delivery. | Implemented / Ready for QA | P1 UAT |
| Service list | Vendor dashboard hook and public service cards | Service/vendor listing routes | `serviceController.js`, `publicListing.js`, `businessListingVisibility.js` | Parent service plus child offering summaries/counts | Fixed by July 6 PRs: business/listing snapshots and public cards expose service offering counts/names. | Implemented / Ready for QA | P1 UAT |
| Service create/edit | Service form client | `POST/PUT /api/service` | `serviceController.js` | Persisted service with media/features | Fixed by July 6 PRs: create and edit persist normalized features. | Implemented / Ready for QA | P1 UAT |
| Vendor upload | Vendor onboarding upload client | `/api/vendor-onboarding/stage1/upload-url`, `/upload-file` | `vendorOnboardingUpload.controller.js` | S3 URL/key or proxy upload result | Code supports PDF; hosted evidence needed. | Backend plus frontend smoke | P1 evidence |
| Admin application list | `listPendingVendorApplications` | `GET /api/vendor-onboarding/pending` | `admin/vendorOnboardVerifyStage1.js` | Application array filtered by status, including `status=all` and submitted/pending/approved aliases | Fixed by July 6 PRs: backend status filters and frontend filter UI are wired. | Implemented / Ready for QA | P1 UAT |
| Admin application detail | Admin detail page | `GET /api/vendor-onboarding/:applicationId` | Admin/vendor onboarding controllers | Review detail, profile data, documents, status, and admin decision metadata | Implemented / Ready for QA for current profile-review visibility; final visual clarity still needs UAT screenshots. | Implemented / Ready for QA | P1 UAT |
| Finalize application | `finalizeVendorApplication` | `POST /api/vendor-onboarding/:applicationId/finalize` | `admin/vendorOnboardVerifyStage1.js` | Approve/reject result and email warning metadata | Fixed by July 6 PRs: frontend sends explicit decision/reason/next-action payload and backend validates/persists it. | Implemented / Ready for QA | P1 UAT |
| Shipment tracking email | Vendor orders action | `PUT /api/orders/ship/:orderId` | `orderController.js`, `orderPhase.js` | Order shipped, emailDelivery | Fixed in code; hosted provider evidence needed. | Backend evidence | P1 |
| Stripe Connect prompt/status | Dashboard/final review/connect tab | `/api/connect/:businessId/status`, account-link | `connectRoutes.js`, `checkoutGuards.js` | Connect status/link with product-vendor payout requirement and service/food optionality messaging | **Code Mismatch:** onboarding skips payout for service/food; checkout still requires `stripeConnectAccountId` for all vendors | Pending Client Input | P0/P1 |

## Required Response Shape Additions

| Contract | Required field | Reason | Recommended source |
| --- | --- | --- | --- |
| Cart item | `vendorState` (returned today). `localDeliveryEligible` is **not** returned by the backend; adding it is follow-up FW-2. | Implemented / Ready for QA; required for local delivery UI. | `Business.address.state`. |
| Public product detail | `business.address.state` or `business.state` | Implemented / Ready for QA; buy-now checks vendor state for local delivery. | `Business.address.state`. |
| Admin application list | `status`, `reviewDecision`, `reviewedAt`, profile summary | Implemented / Ready for QA for status filtering and review triage. | `VendorOnboardingStage1` plus `Business` profile. |
| Service create response | `features` | Implemented / Ready for QA; create persists user-entered features. | `Service.features`. |
| Finalize request | `decision`, `rejectionReason`, `requiredNextAction`, `adminNotes` | Implemented / Ready for QA; admin can explicitly approve/reject/request changes. | Frontend body to backend finalize handler. |

## Acceptance Criteria

- Each frontend caller has one documented backend route and owner.
- Missing fields are added through backend contracts or frontend stops relying on them.
- Contract tests cover all changed shapes.
- Existing route names remain stable unless a migration plan exists.

## Evidence Needed

- Manual smoke with safe vendor/customer/admin accounts after implementation.
- Hosted shipment tracking email/provider proof without private email addresses or secrets.
- Hosted S3/CORS upload proof for JPEG and PDF documents without exposing signed URLs.

## Open Decisions

- Client/UAT sign-off on local delivery behavior.
- Client/UAT sign-off on Stripe Connect messaging by listing type and payment mode.
- Mandatory admin badge review fields beyond the currently visible profile/document fields.
- Coupon basis confirmation.

## Next Recommended Work Order

1. Merge frontend PR #334 after review to remove the July 6 cart/checkout lint regression.
2. Run safe-account manual UAT screenshots for all 15 checklist items.
3. Verify hosted shipment tracking email/provider evidence.
4. Decide whether unrelated repo-wide frontend lint debt blocks production promotion.
