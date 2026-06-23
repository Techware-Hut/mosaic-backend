# Mosaic Biz Hub - Platform Operating Model

**Type:** Source of truth
**Audience:** PM, QA, frontend, backend, stakeholders
**Last updated:** 2026-06-23
**Frontend mirror:** `Digital-Builders-757/mosaic-biz-frontend-launch/docs/PLATFORM_OPERATING_MODEL.md`

This document describes what the platform is supposed to do. When older backend docs, route comments, or implementation details disagree with this file, treat this as the intended operating model and file or fix the defect.

Related backend docs:

- [MARKETPLACE_VENDOR_ELIGIBILITY.md](MARKETPLACE_VENDOR_ELIGIBILITY.md)
- [API_SURFACE.md](API_SURFACE.md)
- [PAYMENT_FLOW.md](PAYMENT_FLOW.md)
- [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md)
- [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md)

## One-Sentence Summary

Mosaic Biz Hub is a managed multi-vendor marketplace where approved minority-owned businesses operate independent storefronts, customers discover and purchase from them, Stripe processes and routes payments, vendors fulfill their own orders, and admins govern trust, access, and marketplace activity.

Mosaic is not a warehouse or shipping company. It is the digital shopping center, payment coordinator, and trust layer.

## Roles

| Role | Real-world equivalent | Backend anchors |
| --- | --- | --- |
| Customer | Shopper | `User.role = "customer"`, `/api/cart`, `/api/orders/*` |
| Vendor (`business_owner`) | Independent shopkeeper | `User.role = "business_owner"`, `Business`, `VendorOnboardingStage1` |
| Admin | Mall manager / trust officer | `User.role = "admin"`, `/admin/*`, `/admin/api/*`, `/api/admin/*` |
| Backend API | Rules engine and ledger | Express routes, Mongoose models, Stripe webhooks |
| Stripe | Cash register and payout network | PaymentIntents + Connect accounts |
| Carrier | USPS, UPS, FedEx, courier | Outside Mosaic in MVP |

## Commercial Heartbeat

```text
Vendor applies -> Admin approves -> Vendor completes profile
  -> Vendor selects plan -> Vendor connects Stripe
  -> Vendor creates listings -> Customer discovers listings
  -> Customer adds to cart -> Backend creates order + PaymentIntent
  -> Stripe confirms payment by webhook -> Vendor accepts order
  -> Vendor ships + enters tracking -> Customer receives order
```

Products, services, and food share the marketplace shell but use different backend models and fulfillment flows. Do not assume product checkout proves service booking or food ordering.

## Vendor Eligibility And Public Visibility

A business is public on Mosaic only when:

```js
business.isApproved === true && business.isActive === true
```

Backend helper: `lib/marketplace/businessEligibility.js`.

| Field | Meaning |
| --- | --- |
| `Business.isApproved` | Admin/application approval is complete |
| `Business.isActive` | Admin has not disabled the business |
| Both true | Business and listings may appear publicly |

Admin "Active" alone does not mean public. Admin approval alone does not override deactivation.

Public endpoints that enforce this rule:

- `GET /api/business`
- `GET /api/products/list`
- `GET /api/ranked`
- `GET /api/public/search`
- `GET /api/public/product/:id`
- `GET /api/public/products/business/:businessId`
- `GET /api/public/product/vendor-profile/:businessId`
- `GET /api/featured-products`
- `POST /api/cart/add`
- `GET /api/cart`

Checkout additionally requires Stripe Connect readiness. Public listing does not require Connect; purchasability does.

## Vendor Journey

1. Register as `business_owner`.
2. Complete Stage 1 application and upload documents.
3. Pay the verification fee.
4. Submit application (`POST /api/vendor-onboarding/submit`).
5. Admin finalizes application.
6. Approved vendors complete business profile, subscription, Stripe Connect, shipping, tax, and listings.

On Stage-1 approval, backend stores `VendorOnboardingStage1.status = "verified"` and sets `Business.isApproved = true` when a linked business exists. Business activation remains separate.

## Customer Journey

1. Browse products, services, foods, vendors, search, ranked, and featured surfaces.
2. View listing detail and vendor profile.
3. Add items to cart. Checkout is single-vendor in the current implementation.
4. Submit checkout. Backend validates stock, price, vendor eligibility, shipping, tax, and Connect readiness.
5. Pay through Stripe Elements.
6. Stripe webhook moves order from pending/created to paid/ordered.
7. Track order as vendor accepts, ships, and enters tracking.

The customer browser does not dictate final price. `POST /api/orders/initiate` recalculates and validates the order server-side.

## Admin Journey

Admins govern trust and marketplace operations. They do not sell inventory.

| Area | Responsibility |
| --- | --- |
| Vendor applications | Review, approve/reject Stage 1 |
| Businesses | Approve, activate/deactivate, investigate status mismatches |
| Categories | Product, service, and food taxonomy |
| Products | List, inspect, feature/unfeature |
| Orders | View all orders and investigate payment/fulfillment issues |
| Content | CMS pages, FAQs, testimonials |

`POST /admin/api/business/approve/:id` is an idempotent approval action. It sets `isApproved: true` and `isActive: true` after onboarding is completed.

`PATCH /admin/api/business/status/:id` changes `isActive` only. Activating an unapproved business leaves it hidden from public marketplace endpoints.

## Shipping Model (MVP)

Vendors set business-level shipping rates:

- `GET /api/business/:id/shipping-settings`
- `PUT /api/business/:id/shipping-settings`

Supported systems:

| System | Behavior |
| --- | --- |
| Flat rate | Same price for a selected delivery speed |
| Quantity based | Tiered price by cart item count |

For each system, vendors configure standard, express, and local rates plus optional free-shipping threshold. Mosaic does not buy shipping labels or calculate live USPS/UPS/FedEx rates in MVP. Vendors pack, ship, and enter tracking.

## Orders And Payments

Primary checkout route: `POST /api/orders/initiate`.

Sequence:

1. Customer sends checkout request.
2. Backend validates cart items, stock, prices, vendor eligibility, Stripe Connect, shipping, and tax.
3. Backend creates `Order` with pending payment state.
4. Backend creates Stripe PaymentIntent with Connect destination.
5. Frontend confirms payment with `clientSecret`.
6. Stripe webhook `payment_intent.succeeded` marks orders paid/ordered.

Product order status path:

```text
created -> ordered -> accepted -> shipped -> delivered
```

Alternate paths include `rejected`, `cancelled`, `returned`, and `refunded`.

## API Path Conventions

| Topic | Canonical path |
| --- | --- |
| Featured products | `GET /api/featured-products` |
| Product CRUD router mount | `/api/product` (singular) |
| Public product browse | `/api/products/list` (plural public browse route) |
| Public vendor directory | `GET /api/business` |
| Order initiation | `POST /api/orders/initiate` |

Do not add or promote `/api/products/featured`; the canonical featured route is `GET /api/featured-products`.

## Non-Goals

This model does not change Stripe Connect onboarding routes, webhook handlers, payment webhook semantics, or the `GET /api/featured-products` response contract.
