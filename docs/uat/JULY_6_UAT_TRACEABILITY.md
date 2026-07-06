# July 6 UAT Traceability - Backend Copy

Date: 2026-07-06
Repo: Techware-Hut/mosaic-backend
Branch: docs/july-6-architecture-gap-audit
Base branch: staging

## Purpose

Trace all 15 July 6 UAT defects to current repo evidence, owner repo, priority, launch bucket, acceptance criteria, and evidence needed. This is a documentation-only traceability pass.

## Source Of Truth Assumptions

- Backend `staging` contains PR #199 for checkout/cart/coupon total integrity and PR #200 for vendor application state/finalize flow.
- Frontend `develop` contains PR #323/#324 cart/coupon/checkout display sync work.
- If evidence is incomplete, status is marked Evidence Needed instead of guessed.

## Files Inspected

Backend: `app.js`, `controllers/customer/cartController.js`, `controllers/discountController.js`, `controllers/orderController.js`, `controllers/admin/vendorOnboardVerifyStage1.js`, `controllers/vendorOnboarding.controller.js`, `controllers/vendorOnboardingUpload.controller.js`, `controllers/productController.js`, `controllers/serviceController.js`, `controllers/publicListing.js`, `utils/couponDiscount.js`, `utils/vendorShipping.js`, `utils/checkoutGuards.js`, `utils/orderPhase.js`, `utils/orderLifecycleEmailDelivery.js`, `utils/vendorOnboardingUploadMimeAllowlist.js`, related tests.

Frontend evidence reviewed from paired repo: cart, checkout buy-now, service hooks/forms, admin vendor application pages, upload utilities, product description helper, final review/dashboard pages, pricing copy.

## Traceability Matrix

| # | UAT defect | Current evidence | Status | Scope classification | Priority | Launch bucket | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Six images allowed but error says 3 | Backend uses dynamic plan limits; frontend forms use dynamic limits; admin price copy still says 3 images. | Defect / Bug Fix Needed | Corrective Work / Bug | P2 Medium | Ready for Client Review after copy fix | Frontend |
| 2 | Three services added but only one displays | Vendor dashboard flattens child services; public marketplace returns one parent service card. | Evidence Needed | Business/display contract | P1 High | Pending Client Input | Both |
| 3 | Edit view only shows one image | Service edit reads image arrays; product variant section may still display/replace first image only. | Evidence Needed | Corrective Work / Bug if product edit is affected | P1 High | Must Fix Before Launch if reproducible | Frontend |
| 4 | Features cannot be edited | Backend update supports features; backend create drops submitted features. | Defect / Bug Fix Needed | Corrective Work / Bug | P1 High | Must Fix Before Launch | Backend |
| 5 | Service vendor still shows payout/bank setup | Dashboard tabs hide payout for non-product, but final review still requires payout; backend checkout requires Connect. | Pending Client Input | Client Content / Decision plus frontend bug | P0/P1 | Pending Client Input | Both |
| 6 | Product description renders HTML | Frontend sanitizes description text; backend returns raw description by design. | Ready for Review | Accepted frontend fix | P2 Medium | Ready for Client Review | Frontend |
| 7 | Local shipping not shown for same-state vendor/customer | Backend exposes local speed but not vendor state; frontend hides local without `vendorState`. | Defect / Bug Fix Needed | Corrective Work / Bug if state rule approved | P1 High | Must Fix Before Launch | Both |
| 8 | Cart quantity cannot be reduced | Fixed through persisted `cartItemId` update path. | Accepted | Corrective Work / Bug closed | P0 closed | Ready for Client Review | Both |
| 9 | Coupon applies for all cart values | Fixed through backend subtotal validation. | Accepted | Corrective Work / Bug closed | P0 closed | Ready for Client Review | Backend |
| 10 | Cart and checkout amounts differ | Fixed by backend PR #199 and frontend PR #323/#324. | Accepted | Corrective Work / Bug closed | P0 closed | Ready for Client Review | Both |
| 11 | Shipment email lacks tracking link | Backend sends shipped email with tracking URL and tests cover success/failure. | Ready for Review | Evidence Needed for hosted provider | P1 High | Ready for Client Review after smoke | Backend |
| 12 | PDF upload has issues while JPEG works | PDF allowlist and generic MIME fallback exist in backend and frontend code. | Ready for Review | Evidence Needed for hosted S3/CORS | P1 High | Ready for Client Review after smoke | Both |
| 13 | Admin cannot filter applications by status or clearly review profile | Frontend filter exists but backend `/pending` returns submitted-only queue; detail shows richer profile fields. | Defect / Bug Fix Needed | Corrective Work / Bug | P1 High | Must Fix Before Launch | Both |
| 14 | Approval/disapproval/finalize flow broken | Backend supports reject next action, resubmit, explicit decisions; frontend finalize posts no decision body. | In Progress | Corrective Work / Bug | P1 High | Must Fix Before Launch for admin UX | Frontend primary |
| 15 | Restaurant vendor forced into Stripe Connect | Backend checkout requires Connect; frontend final review requires payout; listing-type policy unresolved. | Pending Client Input | Client Content / Decision | P0/P1 | Pending Client Input | Both |

## Repro Steps To Preserve

1. Create a new vendor account for product, service, and food listing types.
2. Complete onboarding draft, submit, disapprove/reject, confirm vendor next action, resubmit, and admin finalize.
3. Create three child service offerings under a service parent and verify vendor dashboard and public marketplace behavior.
4. Add/edit listings with gallery images, PDF documents, and features.
5. Add product to cart, reduce quantity, apply under-minimum and valid coupons, compare cart and checkout totals.
6. Configure same-state vendor/customer shipping and confirm local delivery is visible only when eligible.
7. Ship an accepted order with tracking id and tracking URL and confirm customer email content.

## Acceptance Criteria

- Every UAT item has a status, priority, owner, and launch bucket.
- Fixed items include commit/PR or file/test evidence.
- Open items include a suggested fix branch and issue title in the issue plan.
- Business decisions are separated from code defects.

## Evidence Needed

- Frontend build/lint/test-unit pass.
- Backend `npm test` and `npm run test:integration` pass.
- Hosted S3 PDF upload smoke.
- Hosted email provider shipment smoke.
- Admin application list smoke across all statuses.

## Open Decisions

- Local delivery basis.
- Stripe Connect requirement for service and food vendors.
- Directory-only/offline-payment listing policy.
- Finalize approval semantics.
- Mandatory badge review fields.

## Next Recommended Work Order

1. Resolve local delivery and Connect decisions.
2. Fix local shipping contract and admin status filtering.
3. Fix service create feature persistence.
4. Finish explicit frontend admin finalize controls.
5. Run fresh UAT and attach evidence.
