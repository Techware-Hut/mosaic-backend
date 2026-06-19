# API Contract — As-Built

**Purpose:** Frontend/backend route contract reconciliation for launch readiness.  
**Evidence date:** 2026-06-19  
**Rule:** Status = **verified** | **inferred** | **evidence needed**

**DTO helpers:**
- Auth: [`utils/toPublicAuthUser.js`](../../utils/toPublicAuthUser.js)
- Listings: [`lib/listing/publicListingDto.js`](../../lib/listing/publicListingDto.js) — `toPublicListingCard`, `toPublicListingDetail`
- Payment poll: [`utils/paymentIntentResponse.js`](../../utils/paymentIntentResponse.js)

---

## Auth

### POST `/api/users/register`

| Field | Detail |
| --- | --- |
| Auth | Public + `registerLimiter` (5/15min) |
| Body | `name`, `email`, `password` (min 6), `mobile`, optional `role` (`customer` \| `business_owner`) |
| Success 201 | `{ success: true, message, userId }` — **verified** |
| Errors | `{ success: false, errors: [...] }` or duplicate codes (`EXISTING_CUSTOMER`, etc.) |

### POST `/api/users/login`

| Field | Detail |
| --- | --- |
| Auth | Public + `loginLimiter` (15/15min) |
| Body | `email`, `password` |
| Success 200 | `{ success: true, message, user: toPublicAuthUser, token? }` + `setAuthCookies` — **verified** |
| Errors | 403 blocked/deleted/OTP pending; 401 invalid credentials |

### POST `/api/users/logout`

| Field | Detail |
| --- | --- |
| Auth | Public (clears cookies) |
| Success | `{ success: true, message }` — **inferred** |

### GET `/api/users/auth/check`

| Field | Detail |
| --- | --- |
| Auth | `authenticate` (JWT cookie or Bearer) |
| Success 200 | `{ loggedIn: true, user: { id, name, email, role, gender, mobile, isOtpVerified } }` — **verified** |
| Error 401 | `{ success: false, message }` |

### POST `/api/users/verify-otp`

| Field | Detail |
| --- | --- |
| Body | `email`, `otp` (6 digits) |
| Success 200 | `{ success: true, message, user, token }` + cookies — **verified** |

### Google OAuth

| Route | Detail | Status |
| --- | --- | --- |
| GET `/api/auth/google` | Redirect to Google | verified |
| GET `/api/auth/google/callback` | Sets auth cookies; redirects to `FRONTEND_URL` | verified |
| POST `/api/auth/google/complete` | Requires `mbh_tmp` cookie; completes profile | verified |

---

## Featured products (canonical)

### GET `/api/featured-products`

| Field | Detail |
| --- | --- |
| Auth | Public |
| Query | `page` (default 1), `limit` (default 12, max 50) |
| Success 200 | `{ products: [toPublicListingCard...], pagination: { currentPage, totalPages, totalProducts } }` — **verified** |
| Scope | Products where `isFeatured`, published, active business |

**NOT registered:** `GET /api/products/featured` — **verified absent**. Do not use.

---

## Public marketplace

### GET `/api/public/search`

| Field | Detail |
| --- | --- |
| Auth | Public |
| Query | `q`, `location`, `zip`, `minorityType`, `category`, `listingType`, `page`, `limit` — geo-radius params rejected |
| Success 200 | `{ products, services, foods, pagination, filters? }` — **verified** (shape from controller tests) |
| DTO | Items via `toPublicListingCard` |

### GET `/api/products/list`, `/api/services/list`, `/api/food/list`

| Field | Detail |
| --- | --- |
| Auth | Public |
| Query | Filter/pagination params vary by listing type |
| DTO | `toPublicListingCard` — **verified** |

### GET `/api/ranked`

| Field | Detail |
| --- | --- |
| Auth | Public |
| Purpose | Weighted interleave ranking by subscription tier + rating + recency |
| Status | **verified** (route + controller); full query params — evidence needed for exhaustive list |

### GET `/api/public/product/:productId`

| Field | Detail |
| --- | --- |
| Auth | Public |
| Response | `toPublicListingDetail` + variants — **verified** |

---

## Business

### GET `/api/business/my`

| Field | Detail |
| --- | --- |
| Auth | `authenticate` + `isBusinessOwner` |
| Success 200 | Array of vendor businesses for `req.user` — **verified** (route L45–49 `businessRoutes.js`) |
| Response shape | **evidence needed** — confirm exact fields returned by `getMyBusinesses` for frontend contract |

---

## Vendor onboarding

### POST `/api/vendor-onboarding/draft`

| Field | Detail |
| --- | --- |
| Auth | verified vendor (`requireVerifiedVendor`) |
| Body | Stage-1 payload — validated by `utils/vendorOnboardingValidation.js` |
| Status | **verified** route; response shape — evidence needed |

### POST `/api/vendor-onboarding/stage1/create-payment`

| Field | Detail |
| --- | --- |
| Auth | verified vendor |
| Purpose | Stripe PaymentIntent for $24.99 verification fee |
| Response | `{ clientSecret, ... }` — **inferred** from controller |

### GET `/api/vendor-onboarding/status/:applicationId`

| Field | Detail |
| --- | --- |
| Auth | **Public** (no JWT) |
| Purpose | Poll application status by `applicationId` |

---

## Orders and checkout

### POST `/api/orders/initiate`

| Field | Detail |
| --- | --- |
| Auth | `customer` |
| Body | `{ items[], shippingAddress: { fullName, phone, addressLine1, ... }, userNote?, deliverySpeed? }` |
| Item shape | `{ productId, variantId, size, quantity, price }` — single vendor only |
| Success 201 | **verified** |

```json
{
  "success": true,
  "message": "Order initialized",
  "groupOrderId": "uuid",
  "orderId": "ObjectId",
  "clientSecret": "pi_...",
  "totals": {
    "subtotalExclTaxAmount": 0,
    "subtotalAmount": 0,
    "taxTotal": 0,
    "shippingAmount": 0,
    "totalAmount": 0,
    "deliverySpeed": "...",
    "shippingMethod": "...",
    "freeShippingApplied": false
  },
  "shipping": { "...": "..." }
}
```

| Errors | 400 checkout block (unapproved vendor, incomplete Connect), stock/price mismatch |

### GET `/api/orders/retrieve-intent/:id`

| Field | Detail |
| --- | --- |
| Auth | Authenticated (order owner) |
| Response | Sanitized PI + order via `sanitizePaymentIntentForClient`, `sanitizeOrderForPaymentPoll` — **verified** |

### POST `/api/payments/create-payment-intent` (legacy)

| Field | Detail |
| --- | --- |
| Auth | `customer` + rate limit |
| Body | `orderId` (MongoId), optional `amount`, `currency` |
| Status | **verified** route; whether frontend still calls this — **evidence needed**

---

## Stripe Connect

### POST `/api/connect/:businessId/account-link`

| Field | Detail |
| --- | --- |
| Auth | `business_owner` (must own business) |
| Success | `{ url: accountLink.url }` or similar onboarding URL — **verified** controller |
| Env | `CONNECT_RETURN_PATH`, `CONNECT_REFRESH_PATH`, `FRONTEND_URL`, optional full URL overrides |

### GET `/api/connect/:businessId/status`

| Field | Detail |
| --- | --- |
| Auth | `business_owner` |
| Response | Connect capabilities, `chargesEnabled`, `payoutsEnabled` — **inferred** |

---

## Payment success / failure

| Route | Status |
| --- | --- |
| Backend payment success page | **Evidence Needed** — no route in `routes/` or `app.js` |
| Backend payment failure page | **Evidence Needed** — likely frontend-only (Vercel) |

Stripe Checkout / PI completion is handled client-side + webhooks, not dedicated backend redirect routes.

---

## Admin (selected)

| Route | Auth | Status |
| --- | --- | --- |
| GET `/admin/users/` | admin | verified |
| GET `/admin/vendor-onboard-verify-stage1/pending` | admin | verified |
| POST `/admin/vendor-onboard-verify-stage1/:id/finalize` | admin | verified |
| GET `/admin/api/products/` | admin | verified |
| PATCH `/admin/api/products/:productId/featured` | admin | verified |

Admin user DTO: [`utils/toAdminUser.js`](../../utils/toAdminUser.js)

---

## Health

| Route | Response | Status |
| --- | --- | --- |
| GET `/` | `{ message: "Mosaic Biz Hub API is working..." }` | verified |
| GET `/api/health` | `{ status: "ok", service, timestamp, uptime }` | verified |
| GET `/api/ready` | `{ status: "ready"\|"not_ready", database, timestamp }` | verified |

---

## Response convention notes

Error shapes are **inconsistent** across controllers:
- Auth: `{ success: false, message }`
- Validation: `{ success: false, errors: [...] }`
- Some routes: `{ message }` or `{ error }`

**Recommendation:** Diff frontend API client against this doc; flag mismatches for contract tests (#55).
