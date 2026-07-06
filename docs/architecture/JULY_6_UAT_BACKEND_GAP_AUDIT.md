# July 6 UAT Backend Gap Audit

Date: 2026-07-06
Repo: Techware-Hut/mosaic-backend
Branch: docs/july-6-architecture-gap-audit
Base branch: staging

## Purpose

Classify the backend side of the July 6 UAT defects before additional patch work continues. This file identifies what is already fixed on current `staging`, what is still a backend gap, what belongs to frontend, and what needs client or business approval.

## Source Of Truth Assumptions

- Backend owns route behavior, persisted data, auth/roles, upload MIME allowlists, email dispatch, order totals, coupon eligibility, shipping cost calculation, and Stripe/Connect/payment enforcement.
- Frontend owns messages, route rendering, form controls, client payload assembly, and display of backend state.
- Backend PR #199 is merged into `staging`: `Fix P0 checkout cart coupon and total integrity`, merge commit `23d7e024d98847b142236b48bd9f6fe27cd39a0e`, original commit `da5dd6bab58f8da32618e5891e33bbdf7656e2d7`.
- Backend PR #200 is merged into `staging`: vendor application state/finalize flow, merge commit present at branch head `f21194e`.

## Files Inspected

`app.js`, `controllers/customer/cartController.js`, `controllers/discountController.js`, `controllers/orderController.js`, `controllers/admin/vendorOnboardVerifyStage1.js`, `controllers/vendorOnboarding.controller.js`, `controllers/vendorOnboardingUpload.controller.js`, `controllers/productController.js`, `controllers/serviceController.js`, `controllers/publicListing.js`, `controllers/businessController.js`, `models/Business.js`, `models/VendorOnboardingStage1.js`, `utils/couponDiscount.js`, `utils/vendorShipping.js`, `utils/checkoutGuards.js`, `utils/orderPhase.js`, `utils/orderLifecycleEmailDelivery.js`, `utils/vendorOnboardingUploadMimeAllowlist.js`, `tests/orders/order-lifecycle-emails.test.js`, `tests/admin/vendor-onboarding-finalize.test.js`, `tests/vendor/vendor-onboarding-status-next-step.test.js`, `tests/vendor/vendor-onboarding-upload-mime.test.js`.

## Backend Findings

| UAT | Backend status | Classification | Priority | Evidence |
| --- | --- | --- | --- | --- |
| 1 image limit copy says 3 while 6 allowed | Backend product/service messages use dynamic limits. | Frontend copy/evidence needed | P2 Medium | `productController.js`, `serviceController.js` use plan limits in messages. |
| 2 three services display as one | Backend `getMyServices` returns parent services with child `services`; public list returns one card per parent. | Business/display contract | P1 High | `serviceController.js`, `publicListing.js`. |
| 3 edit view only shows one image | Backend detail DTO can preserve gallery; product cards intentionally use cover. | Frontend/evidence needed | P1 High | `public-listing-dto.test.js`; controller DTOs. |
| 4 features cannot be edited | Backend update supports `features`; create initializes `features: []`. | Corrective Work / Bug | P1 High | `updateService` has `features`; `createService` drops initial features. |
| 5 service vendor shows payout/bank setup | Backend checkout still requires Connect for order checkout; publish requirement is not backend-decided per listing type. | Client decision plus contract | P0/P1 | `utils/checkoutGuards.js`. |
| 6 product description renders HTML | Backend stores/returns raw description; frontend owns safe rendering. | Ready for Review | P2 Medium | Public product detail returns description as data. |
| 7 local shipping hidden for same-state user | Backend calculates local cost but does not expose vendor state in cart/product detail contract. | Corrective Work / Bug if state-based local delivery is launch scope | P1 High | `cartController.js`, `publicListing.js`, `models/Business.js`. |
| 8 cart quantity cannot reduce | Already fixed on staging. | Accepted | P0 closed | `cartItemId` returned; ID update route exists. |
| 9 coupon min cart value ignored | Already fixed on staging. | Accepted | P0 closed | `couponDiscount.js` evaluates `minOrderAmount` on subtotal. |
| 10 cart and checkout totals differ | Already fixed on staging. | Accepted | P0 closed | PR #199; `orderController.js` recomputes and validates totals. |
| 11 shipped order email missing tracking link | Already fixed in code; runtime provider smoke still needed. | Ready for Review | P1 High | `shipOrder` sends `sendOrderUpdateEmail(... trackingUrl ...)`; tests cover success/failure. |
| 12 PDF upload issue | Code supports PDF and generic MIME fallback; hosted S3/CORS smoke still needed. | Ready for Review with evidence needed | P1 High | Upload MIME allowlist and tests. |
| 13 admin status filtering/profile review | List endpoint only returns submitted/pending; detail has richer data. | Corrective Work / Bug | P1 High | `getPendingApplications` pending statuses only. |
| 14 approval/disapproval/finalize broken | Backend staging supports reject next action, resubmit, explicit finalize decisions. | Accepted backend, frontend alignment needed | P0 closed backend | PR #200; tests cover status next step and finalize. |
| 15 restaurant forced into Stripe Connect | Backend checkout requires Connect; publishing requirement for food/service is not separated. | Client decision plus possible corrective work | P0/P1 | `getBusinessCheckoutBlock`. |

## Confirmed Backend Gaps

1. Service creation should persist submitted feature arrays instead of starting with `features: []`.
2. Cart and public product/detail contracts need an authoritative vendor location field if local shipping remains state-based.
3. Admin application listing needs an all-status endpoint or query parameter, not only `/pending`.
4. Stripe Connect requirement must be scoped by listing type and payment mode after business approval.

## Items Already Fixed On Current Backend Staging

- Cart item quantity update by persisted cart item id.
- Coupon validation and application based on backend subtotal.
- Cart/checkout/order total integrity, including client tamper guard.
- Order shipment email with tracking URL and lifecycle email log.
- Vendor onboarding rejection/next-action/resubmission/finalize state support.
- PDF upload MIME allowlist and generic file type fallback in code.

## Severity And Ownership

- Backend P1: service feature persistence, local shipping state contract, admin all-status application list.
- Cross-repo P0/P1 decision: service/food/restaurant Stripe Connect requirement.
- Frontend P1 dependency: explicit finalize reject/change-request controls.

## Acceptance Criteria

- Backend exposes the fields the frontend needs for local delivery eligibility or the frontend stops inferring local delivery from unavailable state data.
- Admin can query applications by status: submitted, under_review, verified, rejected, draft/resubmitted as approved by product.
- Service `features` submitted on create survive create, edit, detail, and public listing read paths.
- Backend tests prove coupon, totals, shipment email, PDF upload, and vendor application state flows remain green.

## Evidence Needed

- `npm test`
- `npm run test:integration`
- Hosted manual smoke for S3 PDF upload and shipment email provider.
- Cross-repo UI smoke after frontend consumes any new admin/local-shipping contracts.

## Open Decisions

- Local delivery basis and vendor-defined delivery zones.
- Stripe Connect requirement by listing type and payment mode.
- Whether finalize is final approval or pre-approval readiness.
- Required badge/profile review data.

## Next Recommended Work Order

1. Backend branch `fix/p1-local-shipping-vendor-state-contract`.
2. Backend branch `fix/p1-admin-application-status-filter-api`.
3. Backend branch `fix/p1-service-create-features-persistence`.
4. Cross-repo branch pair for Stripe Connect by listing type after Rakesh/Bryan decision.
