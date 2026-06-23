# Backend Route Registration — As-Built

**Evidence date:** 2026-06-19  
**Authoritative registry:** [`app.js`](../../app.js)  
**Cross-check:** [`../API_SURFACE.md`](../API_SURFACE.md) (~195 endpoints)

---

## Status legend

| Status | Meaning |
| --- | --- |
| **verified** | Route file + controller read; auth/method confirmed |
| **inferred** | Mount prefix + router path only; handler name from route import |
| **evidence needed** | Response shape or runtime behavior not confirmed from repo |

---

## Global routes

| Method | Full path | Route file | Controller | Auth | Role | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/` | `app.js` inline | inline | Public | — | verified |
| GET | `/api/health` | `healthRoutes.js` | inline | Public | — | verified |
| GET | `/api/ready` | `healthRoutes.js` | inline | Public | — | verified |
| GET | `/api/build-info` | `healthRoutes.js` | inline | Public | — | verified |
| GET | `/internal/sentry-debug` | `app.js` | throws test error | Public | — | verified (env-gated) |

---

## Auth and users

| Method | Full path | Route file | Controller | Auth | Role | Status |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/users/register` | `userRoutes.js` | `registerUser` | Public + rate limit | — | verified |
| POST | `/api/users/login` | `userRoutes.js` | `loginUser` | Public + rate limit | — | verified |
| POST | `/api/users/logout` | `userRoutes.js` | `logout` | Public | — | verified |
| POST | `/api/users/verify-otp` | `userRoutes.js` | `verifyOtp` | Public + rate limit | — | verified |
| POST | `/api/users/resend-otp` | `userRoutes.js` | `resendOtp` | Public + rate limit | — | verified |
| POST | `/api/users/forgot-password` | `userRoutes.js` | `forgotPassword` | Public + rate limit | — | verified |
| POST | `/api/users/reset-password` | `userRoutes.js` | `resetPassword` | Public + rate limit | — | verified |
| GET | `/api/users/auth/check` | `userRoutes.js` | inline + `toPublicAuthUser` | JWT/cookie | Any authenticated | verified |
| GET | `/api/auth/google` | `authRoutes.js` | `startGoogleAuth` | Public + rate limit | — | verified |
| GET | `/api/auth/google/callback` | `authRoutes.js` | `handleGoogleCallback` | Public + rate limit | — | verified |
| POST | `/api/auth/google/complete` | `authRoutes.js` | `completeGoogleProfile` | `mbh_tmp` cookie | — | verified |

---

## Featured products (canonical)

| Method | Full path | Route file | Controller | Auth | Role | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/featured-products` | `featuredProductRoutes.js` | `getFeaturedProducts` | Public | — | **verified** |

**Not registered:** `GET /api/products/featured` — **verified absent** (no mount; returns Express default 404).

---

## Public marketplace / browse

| Method | Full path | Route file | Controller | Auth | Status |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/public/search` | `publicListing.js` | `searchPublicListings` | Public | verified |
| GET | `/api/products/list` | `publicListing.js` | `getAllProducts` | Public | verified |
| GET | `/api/products/filters` | `publicListing.js` | `getProductsByFilters` | Public | verified |
| GET | `/api/services/list` | `publicListing.js` | `getAllServices` | Public | verified |
| GET | `/api/food/list` | `publicListing.js` | `getAllFood` | Public | verified |
| GET | `/api/ranked` | `publicListing.js` | `listProductsRanked` | Public | verified |
| GET | `/api/public/product/:productId` | `publicListing.js` | `getProductById` | Public | verified |
| GET | `/api/public/services/:id` | `publicListing.js` | `getServiceById` | Public | verified |
| GET | `/api/public/foods/:id` | `publicListing.js` | `getFoodById` | Public | verified |
| GET | `/api/public/product/vendor-profile/:businessId` | `publicListing.js` | `getVendorProfile` | Public | verified |
| GET | `/api/public/products/business/:businessId` | `publicListing.js` | `getProductsByBusinessId` | Public | verified |
| GET | `/api/services/:slug` | `publicListing.js` | `getServiceBySlug` | Public | verified |
| GET | `/api/:id/similar` | `publicListing.js` | `listProductsRanked` | Public | inferred |

---

## Business profile

| Method | Full path | Route file | Controller | Auth | Role | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/business/my` | `businessRoutes.js` | `getMyBusinesses` | JWT/cookie | `business_owner` | **verified** |
| POST | `/api/business/` | `businessRoutes.js` | `createBusiness` | JWT + upload | `business_owner` | verified |
| GET | `/api/business/public/:slug` | `businessRoutes.js` | `getBusinessBySlugPublic` | Public | — | verified |
| GET | `/api/business/:slug` | `businessRoutes.js` | owner slug read | JWT | `business_owner` | verified |
| PUT | `/api/business/:id` | `businessRoutes.js` | `updateBusiness` | JWT | `business_owner` | verified |
| DELETE | `/api/business/:id` | `businessRoutes.js` | `deleteBusiness` | JWT | `business_owner` | verified |
| POST | `/api/business/draft` | `businessRoutes.js` | `createBusinessDraft` | JWT | `business_owner` | verified |

---

## Vendor onboarding

Mounts: `/api/vendor-onboarding` **and** `/admin/vendor-onboard-verify-stage1` (same router).

| Method | Full path (prefix `/api/vendor-onboarding`) | Controller | Auth | Role | Status |
| --- | --- | --- | --- | --- | --- |
| POST | `/draft` | `saveDraft` | JWT | verified vendor | verified |
| GET | `/draft` | `getDraft` | JWT | verified vendor | verified |
| POST | `/submit` | `submitForReview` | JWT | verified vendor | verified |
| GET | `/onboarding-data` | `getOnboardingData` | JWT | verified vendor | verified |
| PUT/PATCH | `/business-profile` | update/patch profile | JWT | stage-1 verified | verified |
| GET | `/status/:applicationId` | `getStatusByApplicationId` | **Public** | — | verified |
| GET | `/applicationId` | `getApplicationId` | JWT | — | verified |
| GET | `/stage1/upload-url` | `getStage1UploadUrl` | JWT | verified vendor | verified |
| POST | `/stage1/create-payment` | `createVerificationPayment` | JWT | verified vendor | verified |
| GET | `/stage1/payment-status` | `getPaymentStatus` | JWT | verified vendor | verified |
| GET | `/pending` | `getPendingApplications` | JWT | admin | verified |
| GET | `/:applicationId` | `getApplicationDetails` | JWT | admin | verified |
| POST | `/:applicationId/verify` | `verifyAndAllocatePoints` | JWT | admin | verified |
| POST | `/:applicationId/finalize` | `finalizeVerification` | JWT | admin | verified |

---

## Orders, payments, Stripe

| Method | Full path | Route file | Controller | Auth | Role | Status |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/orders/initiate` | `orderRoutes.js` | `initiateOrder` | JWT | `customer` | **verified** |
| GET | `/api/orders/retrieve-intent/:id` | `orderRoutes.js` | `retrieveIntent` | JWT | any auth | verified |
| GET | `/api/orders/user` | `orderRoutes.js` | `getUserOrders` | JWT | — | verified |
| GET | `/api/orders/vendor` | `orderRoutes.js` | `getVendorOrders` | JWT | `business_owner` | verified |
| GET | `/api/orders/:id/invoice.pdf` | `orderRoutes.js` | `getInvoicePdf` | JWT | — | verified |
| PUT | `/api/orders/accept/:orderId` | `orderRoutes.js` | `acceptOrder` | JWT | `business_owner` | verified |
| PUT | `/api/orders/ship/:orderId` | `orderRoutes.js` | `shipOrder` | JWT | `business_owner` | verified |
| PUT | `/api/orders/deliver/:orderId` | `orderRoutes.js` | `deliverOrder` | JWT | `business_owner` | verified |
| GET | `/api/orders/admin` | `orderRoutes.js` | `getAllOrdersAdmin` | JWT | `admin` | verified |
| GET | `/admin/api/orders` | `admin/adminOrderRoutes.js` | `getAllOrdersAdmin` | JWT | `admin` | verified (alias) |
| POST | `/api/payments/create-payment-intent` | `paymentRoutes.js` | `createPaymentIntent` | JWT + rate limit | `customer` | verified |
| POST | `/api/stripe/create-checkout-session` | `stripeRoutes.js` | `createCheckoutSession` | JWT | `business_owner` | verified |
| POST | `/api/connect/:businessId/account-link` | `connectRoutes.js` | `createAccountLink` | JWT | `business_owner` | **verified** |
| GET | `/api/connect/:businessId/status` | `connectRoutes.js` | `getStatus` | JWT | `business_owner` | verified |
| GET | `/api/connect/return` | `connectRoutes.js` | `handleReturn` | Public | — | verified |
| GET | `/api/connect/refresh` | `connectRoutes.js` | `handleRefresh` | Public | — | verified |
| POST | `/api/billing-portal/session` | `api.routes.js` | billing portal | JWT | `business_owner` | inferred |

**Payment success/failure pages:** No backend routes found — **evidence needed** (likely frontend/Vercel redirect URLs only).

---

## Stripe webhooks (no JWT)

| Method | Full path | Handler | Secret env var | Status |
| --- | --- | --- | --- | --- |
| POST | `/api/webhooks/stripe` | `webhookController.handleStripeWebhook` | `STRIPE_ORDER_WEBHOOK_SECRET` | verified |
| POST | `/api/stripe/webhook` | `stripeController.handleStripeWebhook` | `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET` | verified |
| POST | `/api/stripe/payment/webhook` | `stripePaymentController.stripePaymentWebhook` | `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET` | verified |
| POST | `/api/subscription/webhook` | `webhookController.handleSubscriptionWebhook` | `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | verified |
| POST | `/api/vendor-onboarding/webhook/payment` | `handleVendorPaymentWebhook` | `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET` | verified |

All mounted with `express.raw()` before `express.json()` in `app.js`.

---

## Admin

| Method | Full path | Route file | Auth | Role | Status |
| --- | --- | --- | --- | --- | --- |
| POST | `/admin/users/admins` | `admin/userRoutes.js` | JWT | admin | verified |
| GET | `/admin/users/` | `admin/userRoutes.js` | JWT | admin | verified |
| GET | `/admin/users/:id` | `admin/userRoutes.js` | JWT | admin | verified |
| PUT | `/admin/users/:id` | `admin/userRoutes.js` | JWT | admin | verified |
| DELETE | `/admin/users/:id` | `admin/userRoutes.js` | JWT | admin | verified |
| PUT | `/admin/users/:id/block` | `admin/userRoutes.js` | JWT | admin | verified |
| GET | `/admin/api/business/` | `admin/businessRoutes.js` | JWT | admin | verified |
| POST | `/admin/api/business/approve/:id` | `admin/businessRoutes.js` | JWT | admin | verified |
| GET | `/admin/api/products/` | `admin/adminProductRoutes.js` | JWT | admin | verified |
| PATCH | `/admin/api/products/:productId/featured` | `admin/adminProductRoutes.js` | JWT | admin | verified |
| GET | `/admin/api/orders` | `admin/adminOrderRoutes.js` | JWT | admin | verified |
| GET | `/admin/vendor-onboard-verify-stage1/pending` | `vendorOnboarding.routes.js` | JWT | admin | verified (duplicate prefix) |

---

## Bookings

| Method | Full path | Route file | Auth | Role | Status |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/bookings/service` | `bookingRoutes.js` | JWT | `customer` | verified |
| POST | `/api/bookings/food` | `bookingRoutes.js` | JWT | `customer` | verified |
| GET | `/api/bookings/vendor` | `bookingRoutes.js` | JWT | `business_owner` | verified |
| GET | `/api/bookings/customer` | `bookingRoutes.js` | JWT | `customer` | verified |
| PUT | `/api/bookings/service/:id/approve` | `bookingRoutes.js` | JWT | `business_owner` | inferred |
| PUT | `/api/bookings/cancel/:id` | `bookingRoutes.js` | JWT | authenticated | inferred |

Full booking table: see [`../API_SURFACE.md`](../API_SURFACE.md) § Bookings.

---

## Complete inventory

For all ~195 endpoints (products, services, food CRUD, cart, wishlist, discounts, CMS, blogs, categories, subscriptions), see:

- [`../API_SURFACE.md`](../API_SURFACE.md) — full tables with smoke tiers
- [`BACKEND_ARCHITECTURE_AS_BUILT.md`](BACKEND_ARCHITECTURE_AS_BUILT.md) — mount registry

**Unmounted dead code:** [`routes/cms/cmsRoutes.js`](../../routes/cms/cmsRoutes.js) — 5 routes not registered.
