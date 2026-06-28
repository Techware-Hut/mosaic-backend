# Lifecycle State And Legacy Route Policy

**Issue:** [#152](https://github.com/Techware-Hut/mosaic-backend/issues/152)  
**Type:** Source of truth  
**Last updated:** 2026-06-28  
**Scope:** Documentation only. No schema rewrite, route removal, payment behavior change, or webhook behavior change.

This document defines the backend lifecycle states that frontend, QA, release control, and future agents should use when reasoning about Mosaic Biz Hub. It also records which duplicate or legacy route mounts are intentional and which paths should not be revived.

Use this with:

- [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md)
- [MARKETPLACE_VENDOR_ELIGIBILITY.md](MARKETPLACE_VENDOR_ELIGIBILITY.md)
- [MARKETPLACE_VISIBILITY_MATRIX.md](MARKETPLACE_VISIBILITY_MATRIX.md)
- [PAYMENT_FLOW.md](PAYMENT_FLOW.md)
- [BACKEND_FRONTEND_ROUTE_CONTRACT.md](BACKEND_FRONTEND_ROUTE_CONTRACT.md)
- [contracts/BACKEND_ROUTE_MANIFEST.md](contracts/BACKEND_ROUTE_MANIFEST.md)

## Policy Summary

1. Do not infer business behavior from route names alone. Check model state, middleware, and controller guards.
2. Public marketplace visibility requires both business eligibility and listing publication.
3. Checkout requires public marketplace eligibility plus Stripe Connect readiness.
4. Vendor onboarding `verified` is not the same thing as public marketplace eligibility.
5. Duplicate route mounts are compatibility surfaces, not permission bypasses.
6. Missing stale routes should stay missing unless a focused compatibility decision is approved.
7. Historical docs may contain old domains or old blocked smoke states. Current code and this doc win.

## Account And Auth State

Primary model: `models/User.js`.

| State or field | Values | Owner | Meaning | Frontend implication |
| --- | --- | --- | --- | --- |
| `role` | `customer`, `business_owner`, `admin` | Server | Determines broad route family access | Do not invent extra roles; route guards use these values. |
| `provider` | `local`, `google`, `facebook` | Server/OAuth | Auth origin | Local-only flows require password and OTP. |
| `isOtpVerified` | boolean | Auth flow | Whether local OTP has been verified | Vendor middleware blocks unverified accounts. |
| `isBlocked` | boolean | Admin | Restricted account | Authenticated routes should treat as blocked. |
| `isDeleted` | boolean | Admin/user lifecycle | Soft-deleted account | Authenticated routes should treat as unavailable. |
| `sessionVersion` | number | Auth/password reset | Invalidates old sessions when incremented | Fresh auth checks are needed after reset/logout. |

Unsupported states:

- No supported `super_admin`, `vendor`, `seller`, or `guest` role exists in the backend role enum.
- A logged-out user is not an account state; it is an absent or invalid session.

## Vendor Onboarding Application State

Primary model: `models/VendorOnboardingStage1.js`. Detailed flow: [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md).

| State | Owner | Meaning | Allowed next transitions | Frontend implication |
| --- | --- | --- | --- | --- |
| `draft` | Vendor | Application exists and can be edited | `payment_pending`, `submitted` when paid, or remain `draft` | Show editable onboarding surfaces. |
| `payment_pending` | Vendor/payment webhook | Verification PaymentIntent exists, not paid | `draft` on payment success; remains pending/failed after failure | Do not submit until payment status is `paid`. |
| `submitted` | Vendor | Application is waiting for admin review | `verified` or `rejected` by admin finalize | Admin pending queue includes this state only. |
| `verified` | Admin | Stage-1 application approved | Terminal for draft edits; can proceed to subscription/profile work | `saveDraft` is blocked; continue Stage 2+. |
| `rejected` | Admin | Application needs correction | `draft` via save, then explicit `submitted` via submit | Saving a rejected app does not resubmit it. |

Verification fee state:

| Field | Values | Meaning |
| --- | --- | --- |
| `verificationPayment.status` | `not_started`, `pending`, `paid`, `failed` | Separate from application `status`; `submitForReview` requires `paid`. |

Unsupported states:

- `approved` may appear in response copy, but the stored application status is `verified`.
- `in_review`, `needs_changes`, and `pending_admin` are not stored Stage-1 states.

## Business Approval And Activation State

Primary model: `models/Business.js`. Eligibility rules: [MARKETPLACE_VENDOR_ELIGIBILITY.md](MARKETPLACE_VENDOR_ELIGIBILITY.md).

| Field | Values | Owner | Meaning | Frontend implication |
| --- | --- | --- | --- | --- |
| `isApproved` | boolean | Admin/vendor onboarding sync | Business has been approved for marketplace consideration | Required for public marketplace visibility. |
| `isActive` | boolean | Admin | Business is not disabled | Required for public marketplace visibility. |
| `listingType` | `product`, `service`, `food` | Business setup | Primary listing family | Dashboard should show matching inventory workflows. |
| `adminStatusRemark` | string | Admin | Internal/admin-facing reason text | Do not expose as customer proof without review. |

Public marketplace eligibility:

```text
Business.isApproved === true && Business.isActive === true
```

Checkout eligibility:

```text
public marketplace eligibility + Stripe Connect readiness
```

Unsupported states:

- `isActive: true` does not mean approved.
- `isApproved: true` does not override admin deactivation.
- Stage-1 `verified` does not by itself guarantee public listing visibility if the `Business` record is inactive or missing.

## Subscription And Plan State

Primary models: `models/Subscription.js`, `models/SubscriptionPlan.js`, `models/Business.js`.

| Field | Values | Owner | Meaning | Frontend implication |
| --- | --- | --- | --- | --- |
| `Subscription.status` | `active`, `expired`, `cancelled`, `pending` | Billing/webhook/admin | Subscription lifecycle | Listing gates and profile completion should not assume active unless status is `active` and date window is valid. |
| `Subscription.paymentStatus` | `COMPLETED`, `FAILED`, `PENDING`, `REFUNDED` | Billing/webhook | Payment state for the subscription | Do not equate `paymentStatus` with subscription usability without `status`. |
| `Business.subscriptionStatus` | `active`, `expired`, `cancelled`, `pending` | Business sync | Denormalized business-level subscription status | Useful for dashboards, but verify source subscription for billing decisions. |
| `SubscriptionPlan.limits` | object | Admin/plan sync | Listing/media limits | Product/service/food create paths enforce only supported limits. |

Unsupported states:

- No backend entitlement state named `trial`, `paused`, or `grace_period` is currently modeled.
- Badge tier (`Silver`, `Gold`, `Platinum`, `Diamond`) is trust/verification metadata, not a complete subscription entitlement proof.

## Stripe Connect Readiness State

Primary model: `models/Business.js`. Flow: [PAYMENT_FLOW.md](PAYMENT_FLOW.md), [STRIPE_CONNECT_DOMAIN_VERIFICATION.md](STRIPE_CONNECT_DOMAIN_VERIFICATION.md).

| Field | Values | Owner | Meaning | Frontend implication |
| --- | --- | --- | --- | --- |
| `stripeConnectAccountId` | string/null | Connect account-link/webhook | Vendor has or had a Stripe Express account | Required before checkout can create destination payments. |
| `chargesEnabled` | boolean | Stripe account sync | Stripe says charges are enabled | Required for checkout readiness messaging. |
| `payoutsEnabled` | boolean | Stripe account sync | Stripe says payouts are enabled | Required for payout-ready messaging. |
| `onboardingStatus` | `not_started`, `in_progress`, `requirements_due`, `completed` | Connect controller/webhook | Local summary of Connect onboarding | Use with capability booleans; do not use alone for checkout. |
| `capabilities.card_payments` | Stripe capability string | Stripe account sync | Card payment capability | Treat non-active values as not ready. |
| `capabilities.transfers` | Stripe capability string | Stripe account sync | Transfer capability | Treat non-active values as not ready. |

Checkout-ready Connect minimum:

```text
stripeConnectAccountId present
chargesEnabled === true
payoutsEnabled === true
```

Unsupported states:

- No separate backend state named `stripe_verified` exists.
- Dashboard-link availability is not proof that checkout destination payments are ready.

## Listing Publication State

Primary models: `Product`, `Service`, `Food`; business eligibility still applies.

| Listing family | Fields | Meaning | Public implication |
| --- | --- | --- | --- |
| Product | `isPublished`, `isDeleted`, `isFeatured` | Product publication, soft delete, featured carousel flag | Public product surfaces require published and not deleted; featured also requires `isFeatured`. |
| Service | `isPublished` | Service publication flag | Public service surfaces require published and eligible business. |
| Food | `isPublished` | Food publication flag | Public food surfaces require published and eligible business. |

Public listing visibility:

```text
listing is published
AND product is not deleted when product
AND owning business is approved and active
```

Frontend implication:

- Draft listings are valid vendor inventory but should not be presented as public customer inventory.
- Public 404 for an owner-visible listing can be correct when publication or business eligibility is false.
- Sparse marketplace inventory during vendor soft launch is not a backend failure if APIs respond correctly.

Unsupported states:

- No separate `pending_publication` or `needs_listing_review` field is currently modeled for listings.
- `isFeatured` is not equivalent to `isPublished`.

## Order, Payment, Return, Refund, And Dispute State

Primary model: `models/Order.js`. Audit detail: [audit/BACKEND_REFUND_RETURN_DISPUTE_AS_BUILT_AUDIT.md](audit/BACKEND_REFUND_RETURN_DISPUTE_AS_BUILT_AUDIT.md).

| Field | Values | Owner | Meaning | Frontend implication |
| --- | --- | --- | --- | --- |
| `Order.status` | `created`, `ordered`, `accepted`, `rejected`, `shipped`, `delivered`, `cancelled`, `returned`, `refunded` | Order API/webhook/vendor/customer | Operational fulfillment state | Use status-specific actions; do not infer payment success from fulfillment alone. |
| `Order.paymentStatus` | `pending`, `paid`, `failed`, `refunded` | Stripe webhook/order API | Financial state | Payment success requires `paid`; refund requires `refunded`. |
| `statusHistory` | array | Order API | Transition audit trail | Useful for timeline display, not authorization. |
| `items[].chargeId` | string/null | Post-payment webhook | Stripe charge reference | Needed for refund paths. |

Current as-built flow:

1. `POST /api/orders/initiate` creates order with `paymentStatus: pending`, `status: created`.
2. Stripe payment success webhook sets `paymentStatus: paid`, `status: ordered`.
3. Vendor actions move order through `accepted`, `rejected`, `shipped`, `delivered`.
4. Customer cancel, vendor reject, and vendor accept-return can trigger full Stripe refunds.
5. Customer return initiation currently sets `status: returned`; vendor accept-return moves to refund path.

Unsupported states and workflows:

- No partial refund state.
- No admin refund/mediation state.
- No dispute or chargeback state.
- No `Refund` persistence is active despite a model existing historically.
- No pending-return review state exists today; `returned` is used immediately after customer return initiation.

## Legacy And Duplicate Route Policy

### Canonical route rules

| Need | Canonical route | Legacy/alternate route | Policy |
| --- | --- | --- | --- |
| Featured products | `GET /api/featured-products` | `/api/products/featured` | Do not add the stale route. Frontend must use canonical route. |
| Ranked products | `GET /api/ranked` | `/api/products/ranked` | Do not add the stale route. Frontend must use canonical route. |
| Public product detail | `GET /api/public/product/:productId` | Owner route `/api/product/:productId` | Public pages must use public route; owner route requires vendor auth. |
| Public service detail | `GET /api/public/services/:id` | `GET /api/service/business-service/:id` | Both are registered; prefer public route when ID is known. |
| Admin order list | `GET /api/orders/admin` | `GET /admin/api/orders` | Both are registered and guarded; frontend may use either known route. |
| Vendor finance dashboard | `/stripe/*` | `/api/stripe/*` | `/stripe/*` is vendor finance. `/api/stripe/*` is different checkout/webhook scope. |
| Marketplace checkout | `POST /api/orders/initiate` | `POST /api/payments/create-payment-intent` | Order initiate is preferred. Legacy payment-intent route remains guarded. |
| Connect onboarding | `POST /api/connect/:businessId/account-link` | frontend-only return pages | Backend creates account links; frontend handles UI. |

### Intentional duplicate mounts

| Router | Mounts | Why it exists | Guard policy |
| --- | --- | --- | --- |
| `vendorOnboarding.routes.js` | `/api/vendor-onboarding`, `/admin/vendor-onboard-verify-stage1` | Shared vendor/admin onboarding router | Admin routes still require admin middleware; duplicate mount is not a bypass. |
| Admin business router | `/admin/api/business`, `/api/admin/business` | Historical frontend/backend callers | Preserve until frontend route contract is fully stable. |
| Admin orders | `/admin/api/orders`, `/api/orders/admin` | Frontend compatibility and backend canonical path | Both require admin auth. |
| CMS | `/api/cms`, `/cms` | Historical CMS callers | Treat as compatibility until a separate CMS cleanup issue is approved. |

### Missing routes that should stay missing

| Path | Status | Reason |
| --- | --- | --- |
| `/api/products/featured` | Not registered | Canonical featured route is `/api/featured-products`. |
| `/api/products/ranked` | Not registered | Canonical ranked route is `/api/ranked`. |
| `/api/bookings/create` | Not registered | Active service booking path is `/api/bookings/service/:serviceId` or `/api/bookings/service`. |
| `/api/stripe/account-session` | Not registered | Vendor finance route is `/stripe/account-session`. |
| `/api/admin/products` | Not registered | Admin products live at `/admin/api/products`. |

## Frontend-Facing Rules

1. Use `/api/users/auth/check` for session proof. Do not read protected user fields directly.
2. Use `Business.isApproved && Business.isActive` for public eligibility messaging.
3. Use listing publication plus business eligibility for browse/detail visibility.
4. Use Connect readiness for checkout readiness. Do not treat dashboard link success as checkout proof.
5. Treat public 404 as a possible valid state for unpublished or ineligible listings.
6. Do not show live-commerce language until Stripe test-mode checkout, webhook, order status, and Sentry correlation are proven.
7. When a route has both canonical and alternate mounts, prefer the canonical route in new frontend work and leave aliases untouched unless a cleanup issue explicitly approves removal.

## Issue Closure Evidence

This document satisfies backend #152 by defining:

- authenticated user/account state
- vendor onboarding application state
- business approval/activation state
- subscription and plan state
- Stripe Connect readiness
- listing publication state
- order/payment/refund lifecycle state
- legacy route aliases, duplicate mounts, and missing stale routes
- frontend-facing implications and unsupported states

