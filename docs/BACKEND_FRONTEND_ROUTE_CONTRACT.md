# Backend Frontend Route Contract

**Purpose:** Launch-readiness route contract for frontend cleanup. Maps frontend-suspect paths to actual Express registrations.  
**Issue:** [#55 Backend OpenAPI and API contract documentation](https://github.com/Techware-Hut/mosaic-backend/issues/55)  
**Branch:** `audit/backend-frontend-route-contract`  
**Audited against `main` commit:** `4c77bf6` (2026-06-18)  
**Production base URL:** `https://api.mosaicbizhub.com`

**Status note (2026-06-28):** This remains useful frontend/backend reconciliation evidence, but it is an audited snapshot. For current route registration, verify [`app.js`](../app.js), [API_SURFACE.md](API_SURFACE.md), and [contracts/BACKEND_ROUTE_MANIFEST.md](contracts/BACKEND_ROUTE_MANIFEST.md).

---

## Quick reference — featured and ranked (Batch D)

Frontend must use these canonical routes. **Do not add backend aliases.**

| Frontend need | Use (canonical) | Do NOT use | Prod verified |
|---------------|-----------------|------------|---------------|
| Featured products carousel | `GET /api/featured-products` | `/api/products/featured` (404) | **200** |
| Ranked products browse | `GET /api/ranked` | `/api/products/ranked` (404) | **200** |

CORS preflight for featured: `OPTIONS /api/featured-products` (canonical apex, temporary app transition, and launch QA origins; see [`CORS_PRODUCTION_SMOKE_PROOF.md`](CORS_PRODUCTION_SMOKE_PROOF.md)).

**Registry:** Featured → [`routes/featuredProductRoutes.js`](../routes/featuredProductRoutes.js). Ranked → [`routes/publicListing.js`](../routes/publicListing.js) (`listProductsRanked`).

**Related (full backend maps):** [API_SURFACE.md](API_SURFACE.md) · [BACKEND_ARCHITECTURE_MAP.md](BACKEND_ARCHITECTURE_MAP.md) · [MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md](MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md)

**Registry source:** [`app.js`](../app.js) mounts + per-file routers under [`routes/`](../routes/). No central route generator.

---

## Executive summary — frontend-suspect paths

| Frontend suspect | Verdict | Use instead | Auth |
|------------------|---------|-------------|------|
| `/admin/users` | **valid** | Same path (see Admin users table) | Yes — `admin` |
| `/admin/api/products` | **valid** | Same path (see Admin products table) | Yes — `admin` |
| `/api/admin/products` | **missing** (wrong prefix) | `GET /admin/api/products` | — |
| `/api/products/featured` | **missing/stale** | **`GET /api/featured-products`** | Public |
| `/stripe/...` (vendor finance) | **valid** | `/stripe/account-session`, `/stripe/express-login-link`, etc. | Yes — `business_owner` |
| `/api/stripe/...` | **valid, different purpose** | Checkout: `POST /api/stripe/create-checkout-session`; webhooks: server-only | Mixed |
| Stripe webhooks | **server-only** | Never call from browser | Stripe signature |

**Compatibility fix required:** None on backend. Frontend should update stale paths (especially featured products and admin product prefix).

**Prefix traps (do not “normalize” in frontend without checking):**

| Pattern | Example routes |
|---------|----------------|
| `/admin/api/*` | products, blogs, business admin |
| `/api/admin/*` | categories, testimonials, business admin duplicate mount |
| `/admin/*` (no `/api`) | users, FAQs, vendor verify |
| `/stripe/*` | Vendor Connect dashboard embed (no `/api` prefix) |
| `/api/stripe/*` | Business draft checkout + webhooks |
| `/api/connect/*` | Connect onboarding account links |

---

## A. Public marketplace (launch-critical)

Mount: `/api` via [`routes/publicListing.js`](../routes/publicListing.js), [`routes/featuredProductRoutes.js`](../routes/featuredProductRoutes.js), [`routes/businessRoutes.js`](../routes/businessRoutes.js).

| Route | Method | Auth | Role | Frontend screen | Status | Notes |
|-------|--------|------|------|-----------------|--------|-------|
| `/api/featured-products` | GET | No | Public | Home / featured carousel | **valid** | **Canonical featured route.** Registered in `featuredProductRoutes.js`. |
| `/api/products/featured` | GET | — | — | — | **missing/stale** | **Not registered.** Returns 404. Do not use. |
| `/api/products/list` | GET | No | Public | Product browse / filters | **valid** | Primary product listing |
| `/api/products/filters` | GET | No | Public | Product browse filters | **valid** | Filter metadata |
| `/api/public/product/:productId` | GET | No | Public | Product detail | **valid** | Canonical public product detail |
| `/api/public/products/business/:businessId` | GET | No | Public | Vendor storefront products | **valid** | Products by business |
| `/api/public/product/vendor-profile/:businessId` | GET | No | Public | Vendor public profile | **valid** | Business card on product pages |
| `/api/public/search` | GET | No | Public | Search results | **valid** | Unified public search |
| `/api/services/list` | GET | No | Public | Services browse | **valid** | |
| `/api/services/:slug` | GET | No | Public | Service detail (slug) | **valid** | Alternate to ID route |
| `/api/public/services/:id` | GET | No | Public | Service detail (ID) | **valid** | Preferred when ID known |
| `/api/food/list` | GET | No | Public | Food browse | **valid** | |
| `/api/public/foods/:id` | GET | No | Public | Food detail | **valid** | Canonical public food detail |
| `/api/business/` | GET | No | Public | Business directory browse | **valid** | `getProductBusinesses` |
| `/api/business/public/:slug` | GET | No | Public | Public business page | **valid** | Slug-based public profile |
| `/api/ranked` | GET | No | Public | Ranked products | **valid** | **Canonical ranked route.** Registered in `publicListing.js`. |
| `/api/products/ranked` | GET | — | — | — | **missing/stale** | **Not registered.** Returns 404. Use `/api/ranked`. |
| `/api/:id/similar` | GET | No | Public | Similar products | **valid** | Detail page related items |

**Alternate public detail paths (also valid, prefer canonical above):**

| Route | Method | Status | Notes |
|-------|--------|--------|-------|
| `/api/service/business-service/:id` | GET | valid | Public service detail via `serviceRoutes.js` |
| `/api/food/business-food/:id` | GET | valid | Public food detail via `foodRoutes.js` |

**Vendor CRUD (not public browse):** Product/service/food management uses singular mounts `/api/product`, `/api/service`, `/api/food` with `business_owner` auth — not `/api/products`.

---

## B. Auth session probe

Mount: `/api/users` via [`routes/userRoutes.js`](../routes/userRoutes.js).

| Route | Method | Auth | Role | Frontend screen | Status | Notes |
|-------|--------|------|------|-----------------|--------|-------|
| `/api/users/auth/check` | GET | Yes | Any authenticated | App shell / route guard | **valid** | Returns `toPublicAuthUser` whitelist; 401 if unauthenticated |
| `/api/users/login` | POST | No | Public | Login | **valid** | |
| `/api/users/logout` | POST | No | Public | Logout | **valid** | Clears cookies |
| `/api/auth/google` | GET | No | Public | OAuth start | **valid** | Browser redirect flow |
| `/api/auth/google/callback` | GET | No | Public | OAuth callback | **valid** | Sets cookies |

Use `credentials: 'include'` (fetch) or `withCredentials: true` (axios) for authenticated requests.

---

## C. Admin launch routes

### Admin users

Mount: `/admin/users` → [`routes/admin/userRoutes.js`](../routes/admin/userRoutes.js). Router-level: `authenticate`, `isAdmin`.

| Route | Method | Auth | Role | Frontend screen | Status | Notes |
|-------|--------|------|------|-----------------|--------|-------|
| `/admin/users` | GET | Yes | admin | Admin user list | **valid** | Frontend suspect path confirmed |
| `/admin/users/:id` | GET | Yes | admin | Admin user detail | **valid** | |
| `/admin/users/:id` | PUT | Yes | admin | Admin user edit | **valid** | |
| `/admin/users/:id` | DELETE | Yes | admin | Admin user soft delete | **valid** | |
| `/admin/users/:id/block` | PUT | Yes | admin | Block/unblock user | **valid** | |
| `/admin/users/admins` | POST | Yes | admin | Create admin user | **valid** | Body validators required |

### Admin products

Mount: `/admin/api/products` → [`routes/admin/adminProductRoutes.js`](../routes/admin/adminProductRoutes.js).

| Route | Method | Auth | Role | Frontend screen | Status | Notes |
|-------|--------|------|------|-----------------|--------|-------|
| `/admin/api/products` | GET | Yes | admin | Admin product list / featured mgmt | **valid** | Frontend suspect path confirmed |
| `/admin/api/products/:productId/featured` | PATCH | Yes | admin | Toggle featured flag | **valid** | Sets `Product.isFeatured` for carousel |

**Removed (2026-06-19):** `GET /admin/api/products/test` — unauthenticated debug route removed in launch hardening fix.

**Wrong prefix:** `GET /api/admin/products` is **missing**. Admin products live under `/admin/api/products`, not `/api/admin/products`.

### Admin orders

Mount: `/admin/api/orders` → [`routes/admin/adminOrderRoutes.js`](../routes/admin/adminOrderRoutes.js).  
Canonical alternate: `GET /api/orders/admin` → [`routes/orderRoutes.js`](../routes/orderRoutes.js) (same handler).

| Route | Method | Auth | Role | Frontend screen | Status | Notes |
|-------|--------|------|------|-----------------|--------|-------|
| `/admin/api/orders` | GET | Yes | admin | Admin order list (`/admin/orders`) | **valid** | Frontend-compatible alias; filters, pagination, summaries |
| `/api/orders/admin` | GET | Yes | admin | Admin order list (alternate) | **valid** | Canonical backend path; same handler as alias |

**Response shape:** `{ success, message, data, pagination, summary }` — list key is **`data`**, not `orders` (unlike `GET /api/orders/user` and `GET /api/orders/vendor`).

**Wrong prefix:** `GET /api/admin/orders` is **missing**.

### Other admin mounts (prefix reference)

| Mount prefix | Purpose | Auth |
|--------------|---------|------|
| `/admin/vendor-onboard-verify-stage1` | Stage-1 application review | admin |
| `/admin/api/blogs` | Blog CMS | admin |
| `/admin/api/business` | Admin business management | admin |
| `/api/admin/business` | Same router, alternate mount | admin |
| `/api/admin/category/*` | Category CRUD | admin |
| `/api/admin/testimonials` | Testimonials | admin |
| `/admin/faqs` | FAQ admin | admin |

---

## D. Vendor onboarding and business profile

### Vendor onboarding

Mount: `/api/vendor-onboarding` → [`routes/vendorOnboarding.routes.js`](../routes/vendorOnboarding.routes.js).

| Route | Method | Auth | Role | Frontend screen | Status | Notes |
|-------|--------|------|------|-----------------|--------|-------|
| `/api/vendor-onboarding/onboarding-data` | GET | Yes | business_owner (verified vendor) | Vendor onboarding wizard | **valid** | Primary onboarding state fetch |
| `/api/vendor-onboarding/draft` | GET | Yes | verified vendor | Draft load | **valid** | |
| `/api/vendor-onboarding/draft` | POST | Yes | verified vendor | Draft save | **valid** | |
| `/api/vendor-onboarding/submit` | POST | Yes | verified vendor | Submit application | **valid** | |
| `/api/vendor-onboarding/business-profile` | PUT | Yes | stage-1 verified vendor | Business profile update | **valid** | Full replace |
| `/api/vendor-onboarding/business-profile` | PATCH | Yes | stage-1 verified vendor | Business profile patch | **valid** | Partial update |
| `/api/vendor-onboarding/stage1/upload-file` | POST | Yes | verified vendor | Doc upload proxy | **valid** | Canonical `/partners/business/new` and `/partners/business-profile` document UI path |
| `/api/vendor-onboarding/stage1/upload-url` | GET | Yes | verified vendor | Presigned doc upload | **valid** | Direct S3 diagnostic path; not used by those UI routes |
| `/api/vendor-onboarding/stage1/create-payment` | POST | Yes | verified vendor | Verification fee | **valid** | Stripe Checkout path |
| `/api/vendor-onboarding/stage1/payment-status` | GET | Yes | verified vendor | Payment poll | **valid** | |
| `/api/vendor-onboarding/status/:applicationId` | GET | No | Public | Application status page | **valid** | |
| `/api/vendor-onboarding/applicationId` | GET | Yes | Any authenticated | Resolve application ID | **valid** | |

Admin review mount: `/admin/vendor-onboard-verify-stage1` (same router file, admin routes).

### Business profile — `/api/business/my`

Mount: `/api/business` → [`routes/businessRoutes.js`](../routes/businessRoutes.js).

| Route | Method | Auth | Role | Frontend screen | Status | Notes |
|-------|--------|------|------|-----------------|--------|-------|
| `/api/business/my` | GET | Yes | business_owner | Vendor dashboard / business picker | **valid** | Returns businesses for current user |
| `/api/business/:slug` | GET | Yes | business_owner | Vendor business detail (auth) | **valid** | Slug-based, owner-scoped |
| `/api/business/:id` | PUT | Yes | business_owner | Update business | **valid** | |
| `/api/business/draft` | POST | Yes | business_owner | Create business draft | **valid** | Legacy business creation flow |

**Separate legacy flow:** `/api/business-profile/*` ([`routes/businessProfileRoutes.js`](../routes/businessProfileRoutes.js)) — authenticated but distinct from vendor onboarding. Prefer `/api/vendor-onboarding/*` and `/api/business/my` for launch vendor screens unless frontend already targets business-profile specifically.

---

## E. Stripe Connect, payments, and orders

### Connect onboarding (`/api/connect`)

Mount: [`routes/connectRoutes.js`](../routes/connectRoutes.js).

| Route | Method | Auth | Role | Frontend screen | Status | Notes |
|-------|--------|------|------|-----------------|--------|-------|
| `/api/connect/:businessId/account-link` | POST | Yes | business_owner | Connect onboarding start | **valid** | Creates Stripe Account Link |
| `/api/connect/:businessId/status` | GET | Yes | business_owner | Connect status poll | **valid** | |
| `/api/connect/return` | GET | No | Public | OAuth return redirect | **valid** | Browser redirect handler |
| `/api/connect/refresh` | GET | No | Public | OAuth refresh redirect | **valid** | Browser redirect handler |

### Vendor finance dashboard (`/stripe/*`)

Mount: `/stripe` → [`routes/stripe.routes.js`](../routes/stripe.routes.js). **No `/api` prefix.**

| Route | Method | Auth | Role | Frontend screen | Status | Notes |
|-------|--------|------|------|-----------------|--------|-------|
| `/stripe/account-session` | POST | Yes | business_owner | Embedded Connect dashboard | **valid** | Frontend finance suspect path |
| `/stripe/express-login-link` | POST | Yes | business_owner | Express Dashboard login | **valid** | |
| `/stripe/account-balance` | GET | Yes | business_owner | Balance widget | **valid** | |
| `/stripe/last-payout` | GET | Yes | business_owner | Payout history widget | **valid** | |
| `/stripe/backfill-customers` | POST | Yes | admin | — | **server-only** | Admin maintenance; not for frontend |

### Business draft checkout (`/api/stripe`)

Mount: [`routes/stripeRoutes.js`](../routes/stripeRoutes.js).

| Route | Method | Auth | Role | Frontend screen | Status | Notes |
|-------|--------|------|------|-----------------|--------|-------|
| `/api/stripe/create-checkout-session` | POST | Yes | business_owner | Business subscription checkout | **valid** | Not the same as `/stripe/*` finance routes |

### Customer checkout flow

| Route | Method | Auth | Role | Frontend screen | Status | Notes |
|-------|--------|------|------|-----------------|--------|-------|
| `/api/orders/initiate` | POST | Yes | customer | Checkout / payment start | **valid** | **Primary** — creates Connect destination PaymentIntent |
| `/api/orders/retrieve-intent/:id` | GET | Yes | Any authenticated | Payment status poll | **valid** | Poll after initiate |
| `/admin/api/orders` | GET | Yes | admin | Admin order dashboard | **valid** | Alias for admin list; same as `/api/orders/admin` |
| `/api/orders/admin` | GET | Yes | admin | Admin order dashboard (alternate) | **valid** | Response list key is `data`, not `orders` |
| `/api/payments/create-payment-intent` | POST | Yes | customer | Legacy PI creation | **valid** | Secondary; order initiate preferred for marketplace checkout |

### Webhooks — do not call from frontend

| Route | Method | Auth | Status | Notes |
|-------|--------|------|--------|-------|
| `/api/webhooks/stripe` | POST | Stripe signature | **server-only** | Canonical order webhook |
| `/api/stripe/webhook` | POST | Stripe signature | **server-only** | Business draft + Connect sync |
| `/api/stripe/payment/webhook` | POST | Stripe signature | **server-only** | Post-payment emails |
| `/api/vendor-onboarding/webhook/payment` | POST | Stripe signature | **server-only** | Vendor verification payment |
| `/api/subscription/webhook` | POST | Stripe signature | **server-only** | Subscription events |

---

## F. Frontend cleanup checklist

1. **Featured products:** Change any `GET /api/products/featured` call to **`GET /api/featured-products`**.
2. **Admin products:** Use **`/admin/api/products`**, not `/api/admin/products`.
3. **Admin users:** **`/admin/users`** is correct as-is; requires admin JWT/cookie session.
4. **Vendor finance:** Use **`/stripe/*`** routes for dashboard embed, balance, payouts — not `/api/stripe/*`.
5. **Marketplace checkout:** Use **`POST /api/orders/initiate`** then **`GET /api/orders/retrieve-intent/:id`** to poll.
6. **Connect onboarding:** Use **`POST /api/connect/:businessId/account-link`**; handle return via `/api/connect/return`.
7. **Webhooks:** Remove any frontend fetch/axios calls to webhook URLs.
8. **Auth:** All protected routes need credentials; use `/api/users/auth/check` for session probe.

---

## G. Compatibility assessment

| Question | Answer |
|----------|--------|
| Backend route aliases needed? | **No** — frontend path corrections sufficient |
| Routes to remove? | **No** — audit is docs-only |
| Payment/webhook logic changes? | **No** |
| `/api/products/featured` alias? | **Do not add** — preserve canonical `GET /api/featured-products` |

If frontend discovers a path that 404s after applying this contract, open a follow-up with the exact URL and screen — do not add aliases without explicit backend approval.

---

## H. Validation record

| Check | Command | Result |
|-------|---------|--------|
| Test suite | `npm test` | **PASS** — 196/196 (2026-06-18) |
| Syntax | `node -c app.js` | **PASS** — exit 0 |
| Featured canonical guard | `tests/stripe/checkout-approval-paymentintent-safety.test.js` | Asserts `/featured-products` remains registered |

---

## References

- Mount registry: [`app.js`](../app.js) lines 120–237
- Featured route: [`routes/featuredProductRoutes.js`](../routes/featuredProductRoutes.js)
- Public browse: [`routes/publicListing.js`](../routes/publicListing.js)
- Admin users: [`routes/admin/userRoutes.js`](../routes/admin/userRoutes.js)
- Admin products: [`routes/admin/adminProductRoutes.js`](../routes/admin/adminProductRoutes.js)
- Connect: [`routes/connectRoutes.js`](../routes/connectRoutes.js)
- Vendor finance: [`routes/stripe.routes.js`](../routes/stripe.routes.js)
- Orders: [`routes/orderRoutes.js`](../routes/orderRoutes.js)
- Payment flow detail: [PAYMENT_FLOW.md](PAYMENT_FLOW.md)
- Webhook registration: [stripe-webhook-registration.md](stripe-webhook-registration.md)
