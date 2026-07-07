# Backend Route Contract Audit - July 6 UAT

Date: 2026-07-06
Repo: Techware-Hut/mosaic-backend
Branch: docs/july-6-architecture-gap-audit
Base branch: staging

## Purpose

This audit records the backend route truth for the July 6 vendor journey UAT defects. It is documentation-only. No application routes, middleware, Stripe webhooks, payment logic, or persistence code were changed.

## Source Of Truth

- Backend is Node.js/Express 5 with MongoDB/Mongoose, deployed on AWS Elastic Beanstalk.
- Backend owns route registration, persistence, auth cookies, CORS, role authorization, marketplace APIs, vendor onboarding APIs, admin APIs, orders, payments, Stripe Connect, webhooks, email, uploads, and health routes.
- Frontend owns UI rendering, API client calls, client-side guards, loading/error/empty states, and browser workflow.
- Canonical featured products route remains `GET /api/featured-products`. Do not replace it with `/api/products/featured`.

## Files Inspected

- `app.js`
- `routes/customer/cartRoutes.js`
- `routes/discounts.js`
- `routes/orderRoutes.js`
- `routes/vendorOnboarding.routes.js`
- `routes/serviceRoutes.js`
- `routes/connectRoutes.js`
- `routes/featuredProductRoutes.js`
- `controllers/customer/cartController.js`
- `controllers/discountController.js`
- `controllers/orderController.js`
- `controllers/admin/vendorOnboardVerifyStage1.js`
- `controllers/vendorOnboarding.controller.js`
- `controllers/vendorOnboardingUpload.controller.js`
- `controllers/productController.js`
- `controllers/serviceController.js`
- `controllers/publicListing.js`
- `controllers/businessController.js`
- `models/Business.js`
- `models/VendorOnboardingStage1.js`
- `utils/couponDiscount.js`
- `utils/vendorShipping.js`
- `utils/checkoutGuards.js`
- `utils/orderLifecycleEmailDelivery.js`
- `utils/orderPhase.js`
- `utils/vendorOnboardingUploadMimeAllowlist.js`
- `tests/launch/backend-launch-contract.test.js`
- `tests/orders/order-lifecycle-emails.test.js`
- `tests/admin/vendor-onboarding-finalize.test.js`
- `tests/vendor/vendor-onboarding-status-next-step.test.js`
- `tests/vendor/vendor-onboarding-upload-mime.test.js`

## Express Mount Inventory

| Feature | Mounted route | Controller or router | Auth role | Current note |
| --- | --- | --- | --- | --- |
| Health/readiness | `/api` plus root health routes | `routes/healthRoutes.js` and app health handlers | Public | Safe for smoke tests. |
| Featured products | `/api/featured-products` | `routes/featuredProductRoutes.js` | Public | Canonical launch route. Contract tests assert this route and reject `/api/products/featured`. |
| Public products/services/food | `/api/products/list`, `/api/public/product/:productId`, `/api/services/list`, `/api/services/:slug`, `/api/public/services/:id`, `/api/public/foods/:id` | `controllers/publicListing.js` | Public | Product detail currently returns business name/id, not business address state. |
| Product CRUD/media | `/api/product` | `controllers/productController.js` | Vendor/admin | Dynamic gallery limit is enforced in controller messages. |
| Service CRUD/media | `/api/service` | `controllers/serviceController.js` | Vendor/admin/public by route | Update supports `features`; create currently initializes `features: []`. |
| Cart | `/api/cart`, `/api/cart/add`, `/api/cart/update/:cartItemId`, `/api/cart/update-quantity` | `controllers/customer/cartController.js` | Customer for persisted cart | Cart item response includes `cartItemId`; pricing is backend-authoritative. |
| Discounts/coupons | `/api/discounts/validate`, `/api/discounts/apply`, CRUD under `/api/discounts` | `controllers/discountController.js` | Customer/vendor/admin by route | `minOrderAmount` is evaluated against subtotal by shared utility. |
| Orders | `/api/orders/initiate`, status routes, vendor/admin queues | `controllers/orderController.js` | Customer/vendor/admin by route | Order initiate recomputes totals and guards tampered client totals. |
| Shipment tracking email | `/api/orders/ship/:orderId` | `controllers/orderController.js` | Vendor | Saves tracking info, sends customer shipped email with tracking URL, logs lifecycle result. |
| Vendor onboarding | `/api/vendor-onboarding/*` | `vendorOnboarding.controller`, `admin/vendorOnboardVerifyStage1` | Vendor/admin by route | Stage status, reject next action, resubmission, admin verify/finalize supported on staging. |
| Admin vendor applications | `/api/vendor-onboarding/pending`, `/api/vendor-onboarding/:applicationId`, verify/finalize routes | `controllers/admin/vendorOnboardVerifyStage1.js` | Admin | List endpoint is pending/submitted-focused; it does not support all-status filtering. |
| Uploads/documents | `/api/vendor-onboarding/stage1/upload-url`, `/api/vendor-onboarding/stage1/upload-file` | `controllers/vendorOnboardingUpload.controller.js` | Vendor | PDF allowlist and generic MIME fallback are present. Runtime S3/CORS evidence still required. |
| Business profile/settings | `/api/business`, `/api/business-profile`, shipping/tax settings | `controllers/businessController.js` | Vendor/admin | Business address state exists at `address.state`; cart/public product contracts do not expose it consistently. |
| Stripe Connect | `/api/connect/:businessId/account-link`, `/api/connect/:businessId/status` | `routes/connectRoutes.js` | Vendor | Backend checkout guard requires Connect for order checkout. Publish requirement for service/food is a business decision. |
| Stripe/webhooks | `/api/stripe`, `/api/webhooks`, payment/subscription webhooks | Stripe routers | Mixed | Mounted before JSON parsing where required. Not touched in this audit. |

## Current Mismatches And Gaps

| Gap | Evidence | Owner repo | Priority | Launch bucket |
| --- | --- | --- | --- | --- |
| Local delivery eligibility contract is incomplete. | `buildCartPricing` returns `availableDeliverySpeeds: ['standard','express','local']`, but cart item enrichment does not return business `address.state`; frontend hides `local` when `vendorState` is missing. | Backend plus frontend | P1 High | Must Fix Before Launch if local delivery is launch scope. |
| Admin application status filtering is not backed by an all-status API. | `/api/vendor-onboarding/pending` uses `PENDING_REVIEW_STATUSES = ['submitted']`; frontend filter operates on that limited list. | Backend | P1 High | Must Fix Before Launch if admin must review rejected/verified history. |
| Service create drops submitted features. | `updateService` allows `features`, but `createService` initializes `features: []`. | Backend | P1 High | Must Fix Before Launch for service listing completeness. |
| Product public detail does not expose business state. | `getProductById` populates `businessId` with `businessName owner taxSettings` and maps business without address. | Backend | P1 High | Needed by local shipping contract if state-based. |
| Stripe Connect requirement is too broad for non-product vendor publishing. | `getBusinessCheckoutBlock` requires `stripeConnectAccountId` for checkout; publish/final-review requirement for service/food must be decided. | Backend plus frontend | P0/P1 decision | Pending Client Input. |
| Application finalize has backend decision support, but frontend uses empty finalize body. | Backend accepts approve/reject metadata; frontend client currently posts no body. | Frontend primary, backend compatible | P1 High | Must Fix if admins need explicit reject/change-request text in UI. |

## Findings By Severity

- P0 Launch Blocker: no backend-only P0 was newly confirmed in this audit. The Stripe Connect requirement for restaurant/food vendors can become P0 if launch policy says food/service directory vendors must publish without Connect.
- P1 High: local shipping contract, admin all-status application filtering, service feature create persistence, and application finalize UI/body alignment.
- P2 Medium: tier copy/limit consistency and product variant multi-image edit evidence need frontend follow-up.
- P3 Low: documentation and smoke-evidence consolidation.

## Acceptance Criteria

- Every frontend API call in the July 6 flows has a documented backend route and response owner.
- Existing canonical `GET /api/featured-products` remains unchanged.
- Route contract gaps are classified as bug, evidence needed, client decision, or future phase.
- No secret values are documented.
- No app route, middleware, payment, webhook, or storage code is changed in this docs branch.

## Evidence Needed

- Runtime cart smoke with same-state customer/vendor and local shipping enabled.
- Admin application list smoke across submitted, rejected, verified, and draft/resubmitted states.
- Fresh service create/edit smoke proving features persist from create through edit and public detail.
- Hosted S3/CORS upload smoke for PDF and JPEG.
- Vendor shipment smoke confirming the email provider sends the tracking URL on the hosted environment.

## Open Decisions

- Define local delivery eligibility: same state, same ZIP, distance radius, vendor-defined zones, or manual vendor option.
- Decide whether service and food vendors can publish directory-only/offline-payment listings without Stripe Connect.
- Decide whether application finalize means live vendor approval or only readiness for final business approval.
- Decide which vendor profile/badge fields are mandatory for admin approval.

## Recommended Work Order

1. Lock business decisions for local delivery and Stripe Connect by listing type.
2. Patch backend API contracts for local shipping state and admin all-status filtering.
3. Patch service create feature persistence and add unit/integration tests.
4. Wire explicit frontend finalize approve/reject/request-changes body to backend finalize.
5. Run fresh end-to-end vendor/customer/admin smoke and attach evidence to PRs.
