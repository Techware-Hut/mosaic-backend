# July 6 GitHub Issue Plan - Backend

Date: 2026-07-06
Repo: Techware-Hut/mosaic-backend
Branch: docs/july-6-architecture-gap-audit
Base branch: staging

## Purpose

Provide copy-paste issue bodies for remaining backend and cross-repo July 6 UAT work. This audit does not create issues automatically and does not close existing issues.

## Source Of Truth Assumptions

- Existing open backend issues inspected with `gh issue list --repo Techware-Hut/mosaic-backend --limit 100 --state open`.
- No open backend issue matched the exact July 6 UAT set at audit time.
- Backend PR #199 is merged into `staging` and closes the P0 cart/coupon/checkout total integrity backend work.
- Backend PR #200 is merged into `staging` and closes the backend application state/finalize foundation.

## Files Inspected

`controllers/customer/cartController.js`, `controllers/publicListing.js`, `controllers/serviceController.js`, `controllers/admin/vendorOnboardVerifyStage1.js`, `controllers/vendorOnboarding.controller.js`, `controllers/orderController.js`, `utils/vendorShipping.js`, `utils/checkoutGuards.js`, `utils/couponDiscount.js`, related tests and route files.

## Existing Issue Context

- Backend open issues found: #187 marketplace category source audit, #52 controller/service boundary refactor, #46 validation/error consistency, #19 OIDC IAM follow-up.
- These are not one-to-one issue records for the July 6 UAT defects.

## Issue 1

Title: P1: Expose local delivery eligibility in cart and product contracts

Repo: Techware-Hut/mosaic-backend
Priority: P1 High
Labels: `backend`, `api-contract`, `shipping`, `qa`, `launch-readiness`

Problem: The frontend hides local delivery unless cart/product data contains a vendor state match. Backend pricing includes `local`, but cart item and product detail responses do not expose vendor state or a server-owned eligibility field.

Source finding: `cartController.js` returns `availableDeliverySpeeds: ['standard','express','local']` but enriched items omit `Business.address.state`; `publicListing.js` product detail populates business name/id without address state.

Affected files/routes: `controllers/customer/cartController.js`, `controllers/publicListing.js`, `models/Business.js`, `GET /api/cart`, `GET /api/public/product/:productId`.

Acceptance criteria:
- Cart and product detail responses expose either `vendorState` or `localDeliveryEligible`.
- Backend tests cover same-state and non-same-state behavior if state-based eligibility is approved.
- Frontend no longer infers local eligibility from missing fields.

Verification commands:
- `npm test`
- `npm run test:integration`
- `npm run test:contract`

Smoke test steps:
- Configure vendor local rate and address state.
- Add item to cart with same-state customer address.
- Confirm local option appears and checkout accepts selected local speed.

Rollback note: Revert response-field addition and frontend consumption together if it breaks clients.

What not to change: Do not alter Stripe, webhook, or payment middleware order.

## Issue 2

Title: P1: Add admin vendor application all-status filter API

Repo: Techware-Hut/mosaic-backend
Priority: P1 High
Labels: `backend`, `admin`, `vendor-flow`, `api-contract`, `qa`

Problem: Admin UI has status filters, but backend list route returns only pending/submitted applications.

Source finding: `getPendingApplications` uses `PENDING_REVIEW_STATUSES = ['submitted']`; frontend `listPendingVendorApplications()` calls `/api/vendor-onboarding/pending`.

Affected files/routes: `controllers/admin/vendorOnboardVerifyStage1.js`, `routes/vendorOnboarding.routes.js`, `GET /api/vendor-onboarding/pending` or new all-status route.

Acceptance criteria:
- Admin can request applications by status.
- Submitted, under_review, rejected, verified, and resubmitted states are documented or explicitly excluded.
- Existing pending queue behavior is preserved for callers that need only review queue.

Verification commands:
- `npm test`
- `npm run test:integration`

Smoke test steps:
- Seed or create applications in submitted, rejected, verified states.
- Filter each status in admin UI after frontend integration.

Rollback note: Preserve the original `/pending` route during rollout.

What not to change: Do not change auth stack or admin role middleware.

## Issue 3

Title: P1: Persist service features on create

Repo: Techware-Hut/mosaic-backend
Priority: P1 High
Labels: `backend`, `service`, `vendor-flow`, `qa`

Problem: Service edit supports `features`, but service create initializes `features: []`, so vendor-entered features can disappear until edited later.

Source finding: `serviceController.js` `updateService` includes `features` in updatable fields; create path sets `features: []`.

Affected files/routes: `controllers/serviceController.js`, service model, service create/edit tests.

Acceptance criteria:
- Submitted feature array persists on service create.
- Empty/blank feature entries are normalized safely.
- Service detail/edit/public responses return the saved features.

Verification commands:
- `npm test`
- `npm run test:integration`

Smoke test steps:
- Create a service with three features.
- Open edit view and public detail.
- Confirm all features remain visible.

Rollback note: Revert only the service feature persistence change if it breaks create validation.

What not to change: Do not change product or food listing schemas unless tests prove a shared helper is required.

## Issue 4

Title: P0/P1: Decide and implement Stripe Connect requirement by listing type

Repo: Techware-Hut/mosaic-backend
Priority: P0 Launch Blocker if service/food vendors must publish without Connect; otherwise P1 High
Labels: `backend`, `stripe`, `connect`, `vendor-flow`, `decision-needed`

Problem: QA says restaurant vendors should not be forced into Stripe Connect, but backend checkout guard requires Connect for order checkout.

Source finding: `utils/checkoutGuards.js` returns `Vendor is not connected to Stripe.` when `stripeConnectAccountId` is absent.

Affected files/routes: `utils/checkoutGuards.js`, `routes/connectRoutes.js`, order initiate flow, business/listing type rules.

Acceptance criteria:
- Product, service, and food/restaurant Connect rules are approved by Bryan/Rakesh/client.
- Directory-only/offline listings can publish without Connect if approved.
- Online paid checkout still blocks vendors without Connect where payment settlement requires it.

Verification commands:
- `npm test`
- `npm run test:integration`

Smoke test steps:
- Product vendor online checkout without Connect blocks as expected.
- Service/food vendor publish flow follows approved policy.

Rollback note: Keep checkout payment guard conservative if policy is not approved.

What not to change: Do not touch Stripe webhooks or payment finalization logic in the decision PR.

## Issue 5

Title: P1: Add hosted evidence for PDF upload and shipment tracking email

Repo: Techware-Hut/mosaic-backend
Priority: P1 High
Labels: `backend`, `qa`, `uploads`, `email`, `launch-readiness`

Problem: Code and tests indicate PDF uploads and shipment tracking emails are fixed, but hosted provider evidence is still required for launch signoff.

Source finding: PDF MIME allowlist and order lifecycle email tests exist; runtime S3/CORS/email provider behavior still needs proof.

Affected files/routes: `/api/vendor-onboarding/stage1/upload-file`, `/api/orders/ship/:orderId`, upload and order email utils.

Acceptance criteria:
- Hosted PDF and JPEG upload smoke passes.
- Shipped email includes tracking URL in HTML and text or provider-rendered body.
- Evidence contains no secret values.

Verification commands:
- `npm test`
- `npm run test:integration`

Smoke test steps:
- Upload PDF and JPEG from vendor onboarding.
- Ship accepted test order with tracking URL.
- Capture safe screenshots/log summaries.

Rollback note: Evidence-only issue; rollback not applicable unless code changes are added.

What not to change: Do not commit real credentials, raw email tokens, or S3 secret values.

## Deferred/Closed Tracking

- Cart quantity reduce: fixed by current backend/frontend branches.
- Coupon cart value logic: fixed by PR #199.
- Cart/checkout totals: fixed by PR #199 and frontend PR #323/#324.
- Backend application rejection/resubmission/finalize state: fixed by PR #200; frontend explicit decision UI still needs follow-up in frontend repo.
