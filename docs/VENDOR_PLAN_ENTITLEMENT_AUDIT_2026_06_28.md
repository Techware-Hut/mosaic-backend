# Vendor Plan Entitlement And Subscription Lifecycle Audit - 2026-06-28

**Issue:** #76 - Vendor plan entitlement and subscription lifecycle audit  
**Branch:** `staging`  
**Mode:** Vendor soft launch and product build phase  
**Guardrail:** This audit documents current behavior only. It does not change live billing, Stripe subscriptions, pricing, webhooks, or entitlement enforcement.

## Executive Summary

Silver, Gold, and Platinum plans are modeled in `models/SubscriptionPlan.js`. Listing quotas are enforced in create and update surfaces for products, services, foods, and gallery images. Subscription state is modeled in `models/Subscription.js`, and listing actions require an active, unexpired subscription before quota checks run.

Feature flags such as analytics, marketing tools, featured placement, search priority, and top-tier visibility are schema fields today. They are not consistently enforced as hard product permissions in controllers. Treat those as future-phase or merchandising assumptions until separate implementation and tests confirm otherwise.

## Plan Fields

`models/SubscriptionPlan.js` defines:

| Area | Fields | Current status |
| --- | --- | --- |
| Plan identity | `name` enum: `Silver Plan`, `Gold Plan`, `Platinum Plan` | Live schema |
| Billing metadata | `price`, `currency`, `interval`, `intervalCount`, `trialPeriodDays`, `durationInDays` | Live schema used by plan/admin/subscription flows |
| Stripe links | `stripeProductId`, `stripePriceId` | Live schema; values are managed through Stripe-aware plan/subscription flows |
| Listing limits | `productListings`, `serviceListings`, `foodListings`, `imageLimit`, `videoLimit` | Live schema |
| Feature flags | `analyticsDashboard`, `marketingTools`, `featuredPlacement`, `supportLevel`, `communityEventsAccess`, `searchPriority`, `listingPriority`, `pushNotifications`, `aiRecommendation`, `topTierPlacement`, `topTierVisibility` | Stored, but not all are controller-enforced MVP permissions |

## Subscription Lifecycle

`models/Subscription.js` stores the customer/vendor subscription state:

| Field | Meaning |
| --- | --- |
| `userId` | Vendor user that owns the subscription |
| `businessId` | Linked after business creation; defaults to `null` |
| `subscriptionPlanId` | Current plan reference |
| `stripeSubscriptionId` and `stripeCustomerId` | Stripe linkage |
| `paymentStatus` | `COMPLETED`, `FAILED`, `PENDING`, or `REFUNDED` |
| `status` | `active`, `expired`, `cancelled`, or `pending` |
| `startDate` and `endDate` | Active window used by listing gates |

Listing controllers check for `status: 'active'` and `endDate >= now` before allowing listing creation or expansion. If no active subscription exists, the controller returns a 403 response.

## Enforced MVP Entitlements

| Entitlement | Enforcement surface | Current behavior |
| --- | --- | --- |
| Product listing quota | `controllers/productController.js`, `utils/listingTierLimits.js` | Counts parent products plus product variants against `limits.productListings`; blocks create/update when quota would be exceeded |
| Service listing quota | `controllers/serviceController.js` | Counts child services against `limits.serviceListings`; blocks create/update when quota would be exceeded |
| Food listing quota | `controllers/foodController.js` | Counts food listings against `limits.foodListings`; blocks create when quota is reached |
| Gallery image quota | Product, service, and food controllers | Uses `galleryImageLimit` when present, otherwise `imageLimit`; cover images and menu images are intentionally not counted per `tier-listing-limit-implementation.md` |
| Business usage helper methods | `models/Business.js` | Provides `canAddProduct`, `canAddService`, `canAddFood`, `canUploadImage`, and remaining-limit helpers for business-level checks |

## Existing Test Coverage

| Test area | Files |
| --- | --- |
| Product + variant quota helper | `tests/vendor/listing-tier-limits.test.js` |
| Vendor listing ownership and limits fixture coverage | `tests/vendor/vendor-listing-ownership.test.js` |
| Service publication visibility and limit fixtures | `tests/service/service-publication-visibility.test.js` |
| Integration factories for default plan limits | `tests/integration/helpers/factories.js` |

## Feature Flag Assumptions

| Feature flag | MVP classification | Notes |
| --- | --- | --- |
| `analyticsDashboard` | Future-phase permission | Schema exists; do not promise tier-gated analytics until dashboard gate and tests exist |
| `marketingTools` | Future-phase permission | Schema exists; no launch-critical controller gate confirmed in this audit |
| `featuredPlacement` | Partially supported merchandising concept | Public featured placements exist, but tier entitlement enforcement should be verified before sales language promises it |
| `supportLevel` | Future-phase/support operations | Schema exists; operational SLA should be documented before public promise |
| `communityEventsAccess` | Future-phase | Schema exists; no hard controller gate confirmed |
| `searchPriority` and `listingPriority` | Future-phase/search relevance | Schema exists; do not claim ranking benefits until ranking implementation and tests are documented |
| `pushNotifications` | Future-phase | Schema exists; no entitlement gate confirmed |
| `aiRecommendation` | Future-phase | Schema exists; avoid public AI entitlement claims until implementation is live |
| `topTierPlacement` and `topTierVisibility` | Future-phase merchandising | Schema exists; needs ranking/visibility contract before launch claims |

## MVP Versus Future-Phase Rule

MVP launch-safe entitlements:

- Active subscription status gate.
- Product, product variant, service, food, and gallery image quotas.
- Trust-badge and onboarding status as vendor credibility signals.

Future-phase entitlements:

- Analytics dashboards.
- Marketing tools.
- Ranking priority.
- Featured/top-tier placement guarantees.
- Push notifications.
- AI recommendations.
- Support-level SLA promises.

## Safe Follow-Ups

1. Add controller or route-level tests for food and service quota edge cases if not already covered by integration lanes.
2. Add an explicit feature-flag route contract before public plan copy advertises analytics, ranking priority, marketing tools, AI, or top-tier placement.
3. Review `subscriptionPlanController` sorting because the sort order currently uses base names while plan names include the `Plan` suffix.
4. Capture production/staging plan documents in a redacted evidence packet before live pricing copy is finalized.
5. Confirm Stripe webhook-driven status transitions with a controlled runtime smoke before switching from test to live keys.

## Verification

- This audit only changed documentation.
- Current code inspection confirms listing quota gates exist in product, service, and food controllers.
- Current code inspection confirms feature flags are stored in `SubscriptionPlan` but should not be treated as fully enforced MVP permissions without follow-up implementation evidence.
- `npm run test:contract` passed on 2026-06-28.
- `node --test tests/vendor/listing-tier-limits.test.js tests/service/service-publication-visibility.test.js` passed on 2026-06-28.
