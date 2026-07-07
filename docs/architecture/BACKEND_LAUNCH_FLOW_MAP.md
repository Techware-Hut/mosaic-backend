# Backend Launch Flow Map - July 6 UAT

Date: 2026-07-06
Repo: Techware-Hut/mosaic-backend
Branch: docs/july-6-architecture-gap-audit
Base branch: staging

## Purpose

Map the backend responsibilities for the customer, vendor, admin, and integration flows touched by July 6 UAT. This is the implementation map for the next fix branches.

## Source Of Truth Assumptions

- Backend owns persistence and server-side workflow state.
- Frontend may guide a user, but the backend must reject invalid state transitions, invalid totals, invalid uploads, unauthorized roles, and unsafe payment/order actions.
- No deploy or merge is part of this audit branch.

## Files Inspected

`app.js`, `routes/customer/cartRoutes.js`, `routes/discounts.js`, `routes/orderRoutes.js`, `routes/vendorOnboarding.routes.js`, `routes/serviceRoutes.js`, `routes/connectRoutes.js`, `controllers/customer/cartController.js`, `controllers/discountController.js`, `controllers/orderController.js`, `controllers/admin/vendorOnboardVerifyStage1.js`, `controllers/vendorOnboarding.controller.js`, `controllers/vendorOnboardingUpload.controller.js`, `controllers/businessController.js`, `utils/couponDiscount.js`, `utils/vendorShipping.js`, `utils/checkoutGuards.js`, `utils/orderLifecycleEmailDelivery.js`, `utils/vendorOnboardingUploadMimeAllowlist.js`.

## Customer Flow

| Step | Backend route/service | Current implementation evidence | Missing or risky piece | Launch risk |
| --- | --- | --- | --- | --- |
| Browse marketplace | `/api/products/list`, `/api/services/list`, `/api/public/product/:productId` | Public listing controllers filter approved/active businesses. | Product detail omits business address state, which local delivery UI expects. | P1 if local delivery is in launch scope. |
| Add/update cart | `/api/cart/add`, `/api/cart/update/:cartItemId`, `/api/cart/update-quantity` | Persisted item id is returned and update route accepts it. | Frontend still needs full regression coverage. | Low after PR #199/#324. |
| Coupon | `/api/discounts/validate`, `/api/discounts/apply`, `/api/cart?couponCode=` | `evaluateCouponDiscount` enforces dates, usage, and `minOrderAmount` on subtotal. | Confirm business rule for subtotal basis is approved. | Low if subtotal basis accepted. |
| Checkout/order initiate | `/api/orders/initiate` | Recomputes subtotal, coupon, shipping, total and rejects tampered totals. | Connect guard is product-commerce oriented but not listing-type scoped. | P0/P1 decision for food/service. |
| Shipment tracking | `/api/orders/ship/:orderId` | Saves tracking and sends shipped email with tracking URL. | Hosted email provider smoke still needed. | P1 evidence gap. |

## Vendor Flow

| Step | Backend route/service | Current implementation evidence | Missing or risky piece | Launch risk |
| --- | --- | --- | --- | --- |
| Application draft/submit | `/api/vendor-onboarding/draft`, `/submit`, `/status/:applicationId` | Supports draft, submit, rejected resubmission, and status next action. | Frontend must surface next action clearly. | Medium after PR #200. |
| Document upload | `/stage1/upload-url`, `/stage1/upload-file` | PDF/JPEG/PNG/WebP MIME allowlist and extension fallback are present. | Hosted S3/CORS PDF smoke needed. | P1 evidence gap. |
| Profile setup | `/api/business`, `/api/business-profile` | Business stores address, logo, bio/profile fields through existing profile routes. | Admin list/detail must show enough latest profile data. | P1 cross-repo. |
| Listing create/edit | `/api/product`, `/api/service`, `/api/food` | Dynamic media limits present; service update supports features. | Service create drops submitted features. | P1. |
| Stripe Connect | `/api/connect/:businessId/account-link`, `/status` | Connect account links/status exist. | Required/optional policy by listing type unresolved. | P0/P1 decision. |
| Order management | `/api/orders/vendor/*`, `/accept`, `/reject`, `/ship`, `/deliver` | Shipment email and lifecycle log present. | Hosted smoke needed. | P1 evidence gap. |

## Admin Flow

| Step | Backend route/service | Current implementation evidence | Missing or risky piece | Launch risk |
| --- | --- | --- | --- | --- |
| Application list | `/api/vendor-onboarding/pending` | Returns pending/submitted review queue. | Cannot serve all status filter. | P1. |
| Application detail | `/api/vendor-onboarding/:applicationId` | Returns detail used by admin view. | Confirm latest logo/bio/additional info are visible in frontend. | P1 evidence. |
| Verify item | `/api/vendor-onboarding/:applicationId/verify` | Admin verification items and notes supported. | UI completeness depends on frontend. | Medium. |
| Finalize | `/api/vendor-onboarding/:applicationId/finalize` | Supports approve/reject decision, notes, rejection reason, next action. | Frontend posts no explicit decision body today. | P1 cross-repo. |
| Badge/trust review | Business/profile plus onboarding detail | Data is present across models/controllers. | Single admin review contract needs final field list. | P1 decision. |

## Integration Flow

| Concern | Backend evidence | Missing or risk | Launch bucket |
| --- | --- | --- | --- |
| Auth/cookies/CORS | Existing app middleware and route guards. | Not changed in this audit. | Evidence Needed. |
| Stripe checkout/payment/webhooks | Webhook routes mounted before JSON parser. | Do not change webhook order. | Governance. |
| Stripe Connect | Checkout guard requires Connect. | Listing-type/payment-mode policy unresolved. | Pending Client Input. |
| Upload security | MIME allowlist and max size present. | Hosted PDF smoke. | Ready for Client Review after smoke. |
| Email | Order lifecycle email delivery helper logs sent/skipped/failed. | Hosted provider smoke. | Evidence Needed. |
| Health/ready | App health routes present. | Smoke only if server is running. | Evidence Needed. |

## Business Decision Log

| Decision | Current code behavior | Risk if unclear | Recommended default | Approver | Blocks launch |
| --- | --- | --- | --- | --- | --- |
| Local delivery eligibility | Backend has `local` rates but no zone eligibility contract. | UI can hide or show wrong option. | Vendor-defined zones, with same-state as temporary fallback only if approved. | Bryan/Rakesh/client | Yes if local delivery advertised. |
| Service vendors and Connect | Checkout requires Connect; dashboard hiding is frontend. | Vendors may be blocked from directory listings. | Connect required only when online payment is enabled. | Rakesh/Bryan | Yes. |
| Food/restaurant vendors and Connect | Same checkout guard. | Restaurant directory/onboarding blocked incorrectly. | Allow directory/offline listing without Connect unless online ordering is enabled. | Rakesh/Bryan | Yes. |
| Coupon basis | Backend uses subtotal before shipping. | Client disputes if expected cart total includes shipping/tax. | Keep subtotal-only unless product approves otherwise. | Bryan/client | No if documented. |
| Finalize meaning | Backend can approve or reject; old UI can call empty finalize. | Admin action may not match business process. | Explicit approve/reject/request changes UI. | Bryan | Yes for admin UAT. |
| Badge review fields | Data split across onboarding/business profile. | Admin may approve without enough evidence. | Define mandatory logo, bio, docs, review links, notes. | Bryan/client | Yes for badge launch. |

## Tests Missing

- Backend unit/integration test for service create preserving `features`.
- Contract test proving cart/public product response exposes vendor state or explicit local eligibility.
- Admin list test for status query once implemented.
- Hosted email and upload smoke evidence.

## Next Recommended Work Order

1. Business decision memo for local delivery and Stripe Connect.
2. Backend contract patches for local delivery and admin status filtering.
3. Backend service feature create persistence patch.
4. Frontend finalize explicit decision UI patch.
5. Cross-repo smoke and UAT signoff.
