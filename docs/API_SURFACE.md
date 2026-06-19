# API Surface

Backend HTTP route map for developers, QA, and LLMs. Paths are **full URLs** relative to server root (production base: `https://api.mosaicbizhub.com`).

**Registry:** [`app.js`](../app.js) mounts routers. There is no central routes file beyond that.

**Legend — Smoke notes**

| Symbol | Meaning |
|--------|---------|
| 🟢 | Safe read-only probe (GET, no side effects) |
| 🟡 | Test account only; may write data |
| 🔴 | **Production risk** — money, webhooks, missing auth, or irreversible |
| ⚪ | Public; no auth |

**Related:** [ARCHITECTURE.md](ARCHITECTURE.md), [AUTH_FLOW.md](AUTH_FLOW.md), [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md), [production-smoke-checklist.md](production-smoke-checklist.md)

**Unmounted file:** [`routes/cms/cmsRoutes.js`](../routes/cms/cmsRoutes.js) is **not** registered in `app.js`. Active CMS uses [`routes/admin/cmsRoutes.js`](../routes/admin/cmsRoutes.js).

---

## Global

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/` | — | inline in `app.js` | ⚪ Public | API health check | 🟢 P0.1 — primary prod probe |

---

## Auth and users (`/api/users`, `/api/auth`)

### Users — [`routes/userRoutes.js`](../routes/userRoutes.js) → `/api/users`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/users/register` | `registerLimiter`, validators | `userController.registerUser` | ⚪ Public | Register + send OTP email | 🟡 P1.1 — test email only |
| POST | `/api/users/login` | `loginLimiter`, validators | `userController.loginUser` | ⚪ Public | Login; may trigger OTP if unverified | 🟡 P1.4 |
| POST | `/api/users/logout` | — | `userController.logout` | ⚪ Public | Clear auth cookies | 🟡 P1.4 |
| POST | `/api/users/verify-otp` | `otpVerifyLimiter` | `userController.verifyOtp` | ⚪ Public | Verify registration OTP; issue JWT | 🟡 P1.2 |
| POST | `/api/users/resend-otp` | `otpResendLimiter` | `userController.resendOtp` | ⚪ Public | Resend registration OTP | 🟡 P1.3 |
| POST | `/api/users/forgot-password` | `forgotPasswordLimiter` | `userController.forgotPassword` | ⚪ Public | Request password reset OTP | 🟡 P1.7 — generic response |
| POST | `/api/users/reset-password` | `resetPasswordLimiter` | `userController.resetPassword` | ⚪ Public | Reset password; bumps `sessionVersion` | 🟡 P1.7 |
| GET | `/api/users/auth/check` | `authenticate` | inline + `toPublicAuthUser` | Any authenticated | Session probe | 🟢 P1.5 unauth=401; 🟡 auth=200 |

### OAuth — [`routes/authRoutes.js`](../routes/authRoutes.js) → `/api/auth`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/auth/google` | `googleStartLimiter` | `authController.startGoogleAuth` | ⚪ Public | Start Google OAuth redirect | 🟡 P1.8 — browser flow |
| GET | `/api/auth/google/callback` | `googleCallbackLimiter` | `authController.handleGoogleCallback` | ⚪ Public | OAuth callback; set cookies | 🟡 P1.8 |
| POST | `/api/auth/google/complete` | `googleCompleteLimiter` | `authController.completeGoogleProfile` | `mbh_tmp` cookie | Complete profile after OAuth | 🟡 if `REQUIRE_PROFILE_COMPLETION=true` |

---

## Stripe webhooks (no JWT — Stripe signature)

See [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md). **Never** smoke with real charges via unsigned POST in prod except negative tests (expect 400).

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/webhooks/stripe` | `express.raw` | `webhookController.handleStripeWebhook` | Stripe signature | Order payment status updates | 🔴 P4 — unsigned=400; Dashboard test only |
| POST | `/api/stripe/webhook` | `express.raw` | `stripeController.handleStripeWebhook` | Stripe signature | Business draft checkout; Connect `account.updated` | 🔴 P4 |
| POST | `/api/stripe/payment/webhook` | `express.raw` | `stripePaymentController.stripePaymentWebhook` | Stripe signature | Post-payment emails + charge IDs | 🔴 P4 |
| POST | `/api/subscription/webhook` | `express.raw` in `app.js` | `webhookController.handleSubscriptionWebhook` | Stripe signature | Subscription billing events | 🔴 P4.3 |
| POST | `/api/vendor-onboarding/webhook/payment` | `express.raw` in `app.js` | `vendorOnboarding.handleVendorPaymentWebhook` | Stripe signature | Vendor $24.99 verification PI | 🔴 P4.2 |

---

## Vendor onboarding

Mounts: `/api/vendor-onboarding` and `/admin/vendor-onboard-verify-stage1` (same router).

[`routes/vendorOnboarding.routes.js`](../routes/vendorOnboarding.routes.js)

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `.../draft` | `authenticate`, `requireVerifiedVendor` | `saveDraft` | `business_owner` + OTP | Save Stage-1 draft | 🟡 P2.1 |
| GET | `.../draft` | same | `getDraft` | vendor verified | Get draft | 🟡 |
| POST | `.../submit` | same | `submitForReview` | vendor verified | Submit for admin review (requires paid fee) | 🔴 P2.5 — needs paid PI |
| GET | `.../onboarding-data` | same | `getOnboardingData` | vendor verified | Combined onboarding read | 🟡 |
| PUT | `.../business-profile` | `authenticate`, `requireStage1Verified` | `updateBusinessProfile` | vendor + Stage-1 `verified` | Full profile update + Business sync | 🟡 post-P3.4 |
| PATCH | `.../business-profile` | same | `patchBusinessProfile` | vendor + Stage-1 `verified` | Partial profile update | 🟡 |
| GET | `.../status/:applicationId` | — | `getStatusByApplicationId` | ⚪ **Public** | Application status poll | 🟢 — exposes progress by ID |
| GET | `.../applicationId` | `authenticate` | `getApplicationId` | Authenticated | Get own application ID | 🟡 |
| GET | `.../stage1/upload-url` | `authenticate`, `requireVerifiedVendor` | `getStage1UploadUrl` | vendor verified | S3 presigned upload URL | 🟡 P2.6 |
| POST | `.../stage1/create-payment` | same | `createVerificationPayment` | vendor verified | Create $24.99 Stripe PI | 🔴 P2.2 — real/test charge |
| GET | `.../stage1/payment-status` | same | `getPaymentStatus` | vendor verified | Verification payment status | 🟡 P2.4 |
| GET | `.../pending` | `authenticate`, `isAdmin` | `getPendingApplications` | admin | Admin review queue (`submitted` only) | 🟡 P3.1 |
| GET | `.../:applicationId` | `authenticate`, `isAdmin` | `getApplicationDetails` | admin | Application detail | 🟡 P3.2 |
| POST | `.../:applicationId/verify` | `authenticate`, `isAdmin` | `verifyAndAllocatePoints` | admin | Mark checklist item; add points | 🟡 P3.3 |
| POST | `.../:applicationId/finalize` | `authenticate`, `isAdmin` | `finalizeVerification` | admin | Approve/reject Stage-1 | 🔴 P3.4 — sends emails |

---

## Business and vendor profile

### Business — [`routes/businessRoutes.js`](../routes/businessRoutes.js) → `/api/business`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/business/` | `authenticate`, `isBusinessOwner`, `upload` | `createBusiness` | business_owner | Create business | 🔴 P0-2 risk — trusts client fields |
| POST | `/api/business/retry-create` | same | `retryCreateBusiness` | business_owner | Retry failed create | 🔴 |
| GET | `/api/business/my` | `authenticate`, `isBusinessOwner` | `getMyBusinesses` | business_owner | List own businesses | 🟡 |
| GET | `/api/business/:id/shipping-settings` | same | `getBusinessShippingSettings` | business_owner | Read shipping settings | 🟡 |
| PUT | `/api/business/:id/shipping-settings` | same | `updateBusinessShippingSettings` | business_owner | Update shipping | 🟡 |
| GET | `/api/business/:id/tax-settings` | same | `getBusinessTaxSettings` | business_owner | Read tax settings | 🟡 |
| PUT | `/api/business/:id/tax-settings` | same | `updateBusinessTaxSettings` | business_owner | Update tax | 🟡 |
| GET | `/api/business/public/:slug` | — | `getBusinessBySlugPublic` | ⚪ Public | Public business by slug | 🟢 P6.4 related |
| GET | `/api/business/:slug` | `authenticate`, `isBusinessOwner` | `getBusinessBySlug` | business_owner | Owner business by slug | 🟡 |
| PUT | `/api/business/:id` | `authenticate`, `isBusinessOwner` | `updateBusiness` | business_owner | Update business | 🟡 |
| DELETE | `/api/business/:id` | same | `deleteBusiness` | business_owner | Delete business | 🔴 destructive |
| POST | `/api/business/draft` | same | `createBusinessDraft` | business_owner | Create pre-checkout draft | 🟡 |
| GET | `/api/business/` | — | `getProductBusinesses` | ⚪ Public | List product businesses | 🟢 |

### Business profile (legacy path) — [`routes/businessProfileRoutes.js`](../routes/businessProfileRoutes.js) → `/api/business-profile`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/business-profile/save` | `authenticate` | `saveBusinessProfile` | Authenticated | Save profile step | 🟡 |
| POST | `/api/business-profile/submit` | `authenticate` | `submitForReview` | Authenticated | Submit profile | 🟡 |
| GET | `/api/business-profile/` | `authenticate` | `getBusinessProfile` | Authenticated | Get profile | 🟡 |
| POST | `/api/business-profile/step4-survey` | `authenticate` | `saveStep4Survey` | Authenticated | Survey step | 🟡 |

### Stripe Connect — [`routes/connectRoutes.js`](../routes/connectRoutes.js) → `/api/connect`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/connect/:businessId/account-link` | `authenticate`, `isBusinessOwner` | `createAccountLink` | business_owner | Start Connect onboarding | 🟡 P5.1 |
| GET | `/api/connect/:businessId/status` | same | `getStatus` | business_owner | Connect account status | 🟡 |
| GET | `/api/connect/return` | — | `handleReturn` | ⚪ Public | Connect OAuth return | 🟡 browser |
| GET | `/api/connect/refresh` | — | `handleRefresh` | ⚪ Public | Connect refresh link | 🟡 browser |

### Stripe dashboard embed — [`routes/stripe.routes.js`](../routes/stripe.routes.js) → `/stripe`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/stripe/account-session` | — | `createAccountSession` | ⚪ **No auth** | Connect embedded session | 🔴 **P0-8** — prod risk |
| POST | `/stripe/express-login-link` | — | `createExpressLoginLink` | ⚪ No auth | Express dashboard login link | 🔴 **P0-8** |
| GET | `/stripe/account-balance` | — | `getAccountBalance` | ⚪ No auth | Account balance read | 🔴 **P0-8** |
| GET | `/stripe/last-payout` | — | `getLastPayout` | ⚪ No auth | Last payout read | 🔴 **P0-8** |
| POST | `/stripe/backfill-customers` | — | `backfillMissingStripeCustomers` | ⚪ No auth | Backfill Stripe customers | 🔴 admin-level impact |

---

## Catalog — products (`/api/product`)

[`routes/productRoutes.js`](../routes/productRoutes.js) — note mount prefix is **`/api/product`** not `/api/products`.

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/product/upload-url` | `authenticate` | `getProductUploadUrl` | Authenticated | S3 presigned URL | 🟡 |
| GET | `/api/product/variant-upload-url` | `authenticate` | `getVariantImageUploadUrl` | Authenticated | Variant image URL | 🟡 |
| GET | `/api/product/business/:businessId` | `authenticate`, `isBusinessOwner` | `getBusinessProducts` | business_owner | Vendor product list | 🟡 |
| GET | `/api/product/:productId/reviews` | — | `listReviews` | ⚪ Public | List reviews | 🟢 |
| POST | `/api/product/:productId/reviews` | `authenticate`, `isCustomer` | `upsertReview` | customer | Upsert review | 🟡 |
| DELETE | `/api/product/:productId/reviews/:reviewId` | `authenticate`, `isCustomer` | `deleteReview` | customer | Delete review | 🟡 |
| POST | `/api/product/` | `authenticate`, `isBusinessOwner` | `createProductWithVariants` | business_owner | Create product + variants | 🟡 P0-3 tier limits N/E |
| GET | `/api/product/:productId` | `authenticate`, `isBusinessOwner` | `getProductById` | business_owner | Get product | 🟡 |
| PUT | `/api/product/:productId` | same | `updateProduct` | business_owner | Update product | 🟡 |
| DELETE | `/api/product/delete-product/:productId` | same | `deleteProduct` | business_owner | Soft delete product | 🔴 |
| GET | `/api/product/get-variant/:productId/:variantId` | same | `getVariantById` | business_owner | Get variant | 🟡 |
| POST | `/api/product/add-variants/:productId` | same | `addVariants` | business_owner | Add variants | 🟡 |
| PUT | `/api/product/update-variant/:productId/:variantId` | same | `updateVariant` | business_owner | Update variant | 🟡 |
| PATCH | `/api/product/update-variantstock/:variantId` | same | `updateVariantStock` | business_owner | Stock update | 🟡 |
| DELETE | `/api/product/delete-variant/:productId/:variantId` | same | `deleteVariant` | business_owner | Delete variant | 🔴 |

---

## Catalog — services (`/api/service`)

[`routes/serviceRoutes.js`](../routes/serviceRoutes.js)

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/service/upload-url` | `authenticate` | `getServiceUploadUrl` | Authenticated | Upload URL | 🟡 |
| GET | `/api/service/parent-services` | `authenticate`, `isBusinessOwner` | `getParentServices` | business_owner | Parent services | 🟡 |
| GET | `/api/service/child-services/:parentServiceId` | same | `getChildServices` | business_owner | Child services | 🟡 |
| POST | `/api/service/parent` | same | `createParentService` | business_owner | Create parent | 🟡 |
| POST | `/api/service/add-child-services` | same | `addChildServices` | business_owner | Add children | 🟡 |
| POST | `/api/service/` | same | `createService` | business_owner | Create service | 🟡 |
| GET | `/api/service/my-services` | same | `getMyServices` | business_owner | List own services | 🟡 |
| GET | `/api/service/business-service/:id` | — | `getBusinessServiceById` | ⚪ Public | Business service detail | 🟢 |
| GET | `/api/service/:serviceId/reviews` | — | `listReviews` | ⚪ Public | Reviews | 🟢 |
| POST | `/api/service/:serviceId/reviews` | `authenticate`, `isCustomer` | `upsertReview` | customer | Upsert review | 🟡 |
| DELETE | `/api/service/:serviceId/reviews/:reviewId` | `authenticate`, `isCustomer` | `deleteReview` | customer | Delete review | 🟡 |
| GET | `/api/service/:id` | `authenticate`, `isBusinessOwner` | `getServiceById` | business_owner | Get service | 🟡 |
| DELETE | `/api/service/delete-service/:id` | same | `deleteService` | business_owner | Delete service | 🔴 |
| PUT | `/api/service/:id` | same | `updateService` | business_owner | Update service | 🟡 |
| GET | `/api/service/` | — | inline health | ⚪ Public | Service router health | 🟢 |

---

## Catalog — food (`/api/food`)

[`routes/foodRoutes.js`](../routes/foodRoutes.js)

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/food/upload-url` | `authenticate` | `getFoodUploadUrl` | Authenticated | Upload URL | 🟡 |
| POST | `/api/food/add-food` | `authenticate`, `isBusinessOwner` | `createFood` | business_owner | Create food listing | 🟡 |
| GET | `/api/food/my-foods` | same | `getMyFoods` | business_owner | List own foods | 🟡 |
| GET | `/api/food/business-food/:id` | — | `getBusinessFoodById` | ⚪ Public | Food by business | 🟢 |
| GET | `/api/food/:foodId/reviews` | — | `listReviews` | ⚪ Public | Reviews | 🟢 |
| POST | `/api/food/:foodId/reviews` | `authenticate`, `isCustomer` | `upsertReview` | customer | Upsert review | 🟡 |
| DELETE | `/api/food/:foodId/reviews/:reviewId` | `authenticate`, `isCustomer` | `deleteReview` | customer | Delete review | 🟡 |
| GET | `/api/food/food-by-id/:id` | `authenticate`, `isBusinessOwner` | `getFoodById` | business_owner | Get food | 🟡 |
| PUT | `/api/food/update-food/:id` | same | `updateFood` | business_owner | Update food | 🟡 |
| DELETE | `/api/food/delete-food/:id` | same | `deleteFood` | business_owner | Delete food | 🔴 |
| GET | `/api/food/` | — | inline health | ⚪ Public | Food router health | 🟢 |

---

## Public listings (`/api`)

[`routes/publicListing.js`](../routes/publicListing.js)

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/services/list` | — | `getAllServices` | ⚪ Public | Service listings | 🟢 |
| GET | `/api/public/search` | — | `searchPublicListings` | ⚪ Public | Keyword/location search | 🟢 P6.1–P6.2 |
| GET | `/api/services/:slug` | — | `getServiceBySlug` | ⚪ Public | Service by slug | 🟢 |
| GET | `/api/public/services/:id` | — | `getServiceById` | ⚪ Public | Service by ID | 🟢 |
| GET | `/api/public/foods/:id` | — | `getFoodById` | ⚪ Public | Food by ID | 🟢 |
| GET | `/api/products/list` | — | `getAllProducts` | ⚪ Public | Product list/filter | 🟢 P6.3 |
| GET | `/api/products/filters` | — | `getProductsByFilters` | ⚪ Public | Product filters metadata | 🟢 P6.3 |
| GET | `/api/public/product/:productId` | — | `getProductById` | ⚪ Public | Product detail | 🟢 |
| GET | `/api/public/product/vendor-profile/:businessId` | — | `getVendorProfile` | ⚪ Public | Vendor public profile | 🟢 P6.4 |
| GET | `/api/public/products/business/:businessId` | — | `getProductsByBusinessId` | ⚪ Public | Products by business | 🟢 |
| GET | `/api/food/list` | — | `getAllFood` | ⚪ Public | Food listings | 🟢 |
| GET | `/api/ranked` | — | `listProductsRanked` | ⚪ Public | Ranked products | 🟢 |
| GET | `/api/:id/similar` | `attachSimilarQuery` | `listProductsRanked` | ⚪ Public | Similar products | 🟢 — note `:id` mount order |

### Private vendor listings — [`routes/privateListing.js`](../routes/privateListing.js) → `/api/private`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/private/services/list` | `authenticate`, `isBusinessOwner` | `getAllPrivateServicesForBusiness` | business_owner | Vendor service list | 🟡 |
| GET | `/api/private/services/:slug` | same | `getServiceBySlug` | business_owner | Service by slug | 🟡 |
| GET | `/api/private/food/list` | same | `getAllFood` | business_owner | Vendor food list | 🟡 |
| GET | `/api/private/products/list` | same | `getAllProducts` | business_owner | Vendor product list | 🟡 |

---

## Categories and taxonomy

### Categories — [`routes/categoryRoutes.js`](../routes/categoryRoutes.js) → `/api`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/categories` | — | `getAllCategories` | ⚪ Public | All categories | 🟢 |
| GET | `/api/categories/products` | — | `getProductCategories` | ⚪ Public | Product categories | 🟢 |
| GET | `/api/categories/services` | — | `getServiceCategories` | ⚪ Public | Service categories | 🟢 |
| GET | `/api/categories/foods` | — | `getFoodCategories` | ⚪ Public | Food categories | 🟢 |
| POST | `/api/category-requests` | `authenticate`, `isBusinessOwner` | `createCategoryRequest` | business_owner | Request new category | 🟡 |
| GET | `/api/category-requests/my` | same | `getMyCategoryRequests` | business_owner | Own requests | 🟡 |
| GET | `/api/getProductCategories` | — | `getProductCategories` | ⚪ Public | Alias | 🟢 |
| GET | `/api/subcategories/:categoryId` | — | `getProductSubcategories` | ⚪ Public | Subcategories | 🟢 |
| GET | `/api/sub-categories` | — | `listSubcategories` | ⚪ Public | List subcategories | 🟢 |
| GET | `/api/s3-presigned-url` | `authenticate`, `isBusinessOwnerOrAdmin` | `s3Controller.getPresignedUrl` | owner or admin | Generic S3 URL | 🟡 |
| GET | `/api/admin/categories` | — | `getAllCategoriesAdmin` | ⚪ Public | Admin category list (no router guard on this route) | 🟡 audit |

### Subcategories — [`routes/subcategoryRoutes.js`](../routes/subcategoryRoutes.js) → `/api`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/products/subcategories/:categoryIdOrSlug` | — | `getProductSubcategories` | ⚪ Public | Product subcategories | 🟢 |
| GET | `/api/services/subcategories/:categoryIdOrSlug` | — | `getServiceSubcategories` | ⚪ Public | Service subcategories | 🟢 |
| GET | `/api/foods/subcategories/:categoryIdOrSlug` | — | `getFoodSubcategories` | ⚪ Public | Food subcategories | 🟢 |

### Minority types — [`routes/minorityTypeRoutes.js`](../routes/minorityTypeRoutes.js) → `/api/minority-types`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/minority-types/` | — | `getAllMinorityTypes` | ⚪ Public | List minority types | 🟢 |
| GET | `/api/minority-types/admin/all` | `authenticate`, `isAdmin` | `getAllMinorityTypesAdmin` | admin | Admin list | 🟡 |
| POST | `/api/minority-types/` | `authenticate`, `isAdmin` | `createMinorityType` | admin | Create | 🟡 |
| PUT | `/api/minority-types/:id` | `authenticate`, `isAdmin` | `updateMinorityType` | admin | Update | 🟡 |
| DELETE | `/api/minority-types/:id` | `authenticate`, `isAdmin` | `deleteMinorityType` | admin | Delete | 🔴 |

### Featured — [`routes/featuredProductRoutes.js`](../routes/featuredProductRoutes.js) → `/api`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/featured-products` | — | `getFeaturedProducts` | ⚪ Public | Featured products | 🟢 |

---

## Customer commerce

### Cart — [`routes/customer/cartRoutes.js`](../routes/customer/cartRoutes.js) → `/api/cart`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/cart/` | `authenticate` | `getCart` | Authenticated | Get cart | 🟡 |
| POST | `/api/cart/add` | `authenticate` | `addItemToCart` | Authenticated | Add item | 🟡 |
| PUT | `/api/cart/update/:cartItemId` | `authenticate` | `updateCartItem` | Authenticated | Update item | 🟡 |
| DELETE | `/api/cart/remove/:cartItemId` | `authenticate` | `removeItemFromCart` | Authenticated | Remove item | 🟡 |
| PUT | `/api/cart/update-quantity` | `authenticate` | `updateCartItemByComposite` | Authenticated | Update by composite key | 🟡 |
| DELETE | `/api/cart/remove` | `authenticate` | `removeItemByComposite` | Authenticated | Remove by composite | 🟡 |
| GET/POST | `/api/cart/products/mini` | — / `authenticate` | `getProductsMini` | Mixed | Mini product lookup | 🟢 GET public |
| GET/POST | `/api/cart/variants/mini` | — / `authenticate` | `getVariantsMini` | Mixed | Mini variant lookup | 🟢 GET public |
| GET | `/api/cart/count` | `authenticate` | `getCount` | Authenticated | Cart count | 🟡 |
| POST | `/api/cart/merge` | `authenticate` | `mergeGuestCart` | Authenticated | Merge guest cart | 🟡 |

### Wishlist — [`routes/customer/wishlistRoutes.js`](../routes/customer/wishlistRoutes.js) → `/api/wishlist`

Router-level: `authenticate`, `isCustomer`.

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/wishlist/` | router-level | `getWishlist` | customer | Get wishlist | 🟡 |
| POST | `/api/wishlist/:productVariantId` | router-level | `addToWishlist` | customer | Add item | 🟡 |
| DELETE | `/api/wishlist/:productVariantId` | router-level | `removeFromWishlist` | customer | Remove item | 🟡 |

### Enquiries — [`routes/enquiryRoutes.js`](../routes/enquiryRoutes.js) → `/api/enquiries`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/enquiries/reveal` | `authenticate` | `createRevealEnquiry` | Authenticated | Customer reveal enquiry | 🟡 |
| GET | `/api/enquiries/vendor` | `authenticate`, `isBusinessOwner` | `getVendorEnquiries` | business_owner | Vendor inbox | 🟡 |

---

## Orders and payments

### Orders — [`routes/orderRoutes.js`](../routes/orderRoutes.js) → `/api/orders`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/orders/initiate` | `authenticate` | `initiateOrder` | Authenticated customer | Create order + Stripe PI (Connect) | 🔴 **P5.2–P5.3** — real money; emails before pay |
| GET | `/api/orders/retrieve-intent/:id` | `authenticate` | `retrieveIntent` | Authenticated | PI + orders lookup | 🟡 P5.4 |
| GET | `/api/orders/user` | `authenticate` | `getUserOrders` | Authenticated | Customer orders | 🟡 |
| GET | `/api/orders/:id/invoice.pdf` | `authenticate` | `getInvoicePdf` | Authenticated | Invoice PDF | 🟡 |
| GET | `/api/orders/vendor` | `authenticate`, `isBusinessOwner` | `getVendorOrders` | business_owner | Vendor orders | 🟡 P5.5 |
| PUT | `/api/orders/accept/:orderId` | same | `acceptOrder` | business_owner | Accept order | 🟡 |
| PUT | `/api/orders/reject/:orderId` | same | `rejectOrder` | business_owner | Reject order | 🟡 |
| PUT | `/api/orders/ship/:orderId` | same | `shipOrder` | business_owner | Mark shipped | 🟡 |
| PUT | `/api/orders/deliver/:orderId` | same | `deliverOrder` | business_owner | Mark delivered | 🟡 |
| PUT | `/api/orders/return/:orderId` | same | `acceptReturn` | business_owner | Accept return | 🟡 |
| PUT | `/api/orders/initiateReturn/:orderId` | `authenticate`, `isCustomer` | `initiateReturn` | customer | Start return | 🟡 |
| POST | `/api/orders/:orderId/cancel` | `authenticate`, `isCustomer` | `cancelOrderByUser` | customer | Cancel order | 🟡 |
| GET | `/api/orders/admin` | `authenticate`, `isAdmin` | `getAllOrdersAdmin` | admin | All orders | 🟡 |

### Payments — [`routes/paymentRoutes.js`](../routes/paymentRoutes.js) → `/api/payments`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/payments/create-payment-intent` | `paymentLimiter`, validators | `createPaymentIntent` | ⚪ **No auth** | Legacy PI from `orderId` | 🔴 **P0-7** — unauthenticated |

### Stripe checkout — [`routes/stripeRoutes.js`](../routes/stripeRoutes.js) → `/api/stripe`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/stripe/create-checkout-session` | `authenticate`, `isBusinessOwner` | `createCheckoutSession` | business_owner | Business draft subscription checkout | 🔴 test Stripe only |

---

## Subscriptions and billing

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/api/subscription-plans/` | — | `listSubscriptionPlans` | ⚪ Public | List plans | 🟢 P6.5 |
| GET | `/api/subscription-plans/:id` | `authenticate`, `isAdmin` | `getSubscriptionPlan` | admin | Plan detail | 🟡 |
| POST | `/api/subscription-plans/` | `authenticate`, `isAdmin` | `createSubscriptionPlan` | admin | Create plan | 🟡 |
| PUT | `/api/subscription-plans/:id` | `authenticate`, `isAdmin` | `updateSubscriptionPlan` | admin | Update plan | 🟡 |
| GET | `/api/subscriptions/user/subscriptions` | `authenticate`, `isBusinessOwner` | `getUserSubscriptions` | business_owner | User subscriptions | 🟡 |
| POST | `/api/subscriptions/create` | `authenticate` | `createSubscription` | Authenticated | Create Stripe subscription | 🔴 P4.3 — test mode |
| GET | `/api/subscriptions/current` | `authenticate`, `isBusinessOwner` | `getCurrentSubscriptionForBusiness` | business_owner | Current subscription | 🟡 |
| POST | `/api/subscriptions/:id/cancel` | `authenticate`, `isBusinessOwner` | `cancelSubscriptionForBusiness` | business_owner | Cancel subscription | 🔴 |
| POST | `/api/subscriptions/:id/resume` | `authenticate`, `isBusinessOwner` | `resumeSubscriptionForBusiness` | business_owner | Resume subscription | 🔴 |
| POST | `/api/billing-portal/session` | `authenticate`, `isBusinessOwner` | `createBillingPortalSessionForBusiness` | business_owner | Stripe billing portal URL | 🟡 |

Controllers: [`subscriptionPlanRoutes.js`](../routes/subscriptionPlanRoutes.js), [`subscriptionRoutes.js`](../routes/subscriptionRoutes.js), [`api.routes.js`](../routes/api.routes.js).

---

## Bookings — [`routes/bookingRoutes.js`](../routes/bookingRoutes.js) → `/api/bookings`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/bookings/service` | `authenticate`, `isCustomer` | `createServiceBooking` | customer | Book service | 🟡 |
| POST | `/api/bookings/service/:serviceId` | same | `createServiceBooking` | customer | Book by service ID | 🟡 |
| POST | `/api/bookings/food` | same | `createFoodBooking` | customer | Book food | 🟡 |
| POST | `/api/bookings/food/:foodId` | same | `createFoodBooking` | customer | Book food by ID | 🟡 |
| GET | `/api/bookings/vendor` | `authenticate`, `isBusinessOwner` | `getVendorBookings` | business_owner | All vendor bookings | 🟡 |
| GET | `/api/bookings/vendor/service` | same | `getVendorServiceBookings` | business_owner | Service bookings | 🟡 |
| GET | `/api/bookings/vendor/food` | same | `getVendorFoodBookings` | business_owner | Food bookings | 🟡 |
| GET | `/api/bookings/customer` | `authenticate`, `isCustomer` | `getCustomerBookings` | customer | Customer bookings | 🟡 |
| GET | `/api/bookings/customer/service` | same | `getCustomerServiceBookings` | customer | Customer service bookings | 🟡 |
| GET | `/api/bookings/customer/food` | same | `getCustomerFoodBookings` | customer | Customer food bookings | 🟡 |
| PUT | `/api/bookings/service/:id/request-payment` | `authenticate`, `isBusinessOwner` | `requestServiceBookingPayment` | business_owner | Request payment | 🔴 |
| PUT | `/api/bookings/service/:id/approve` | same | `approveServiceBooking` | business_owner | Approve booking | 🟡 |
| PUT | `/api/bookings/service/:id/reject` | same | `rejectServiceBooking` | business_owner | Reject booking | 🟡 |
| PUT | `/api/bookings/confirm/:id` | `authenticate`, `isBusinessOwner` | inline | business_owner | Confirm booking | 🟡 |
| PUT | `/api/bookings/complete/:id` | same | inline | business_owner | Complete booking | 🟡 |
| PUT | `/api/bookings/cancel/:id` | `authenticate` | inline | Authenticated | Cancel booking | 🟡 |
| DELETE | `/api/bookings/:id` | `authenticate`, `isAdmin` | `deleteBooking` | admin | Delete booking | 🔴 |

---

## Discounts — [`routes/discounts.js`](../routes/discounts.js) → `/api/discounts`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/discounts/validate` | — | `validateCoupon` | ⚪ Public | Validate coupon code | 🟡 |
| POST | `/api/discounts/apply` | — | `applyCoupon` | ⚪ Public | Apply coupon | 🟡 |
| GET | `/api/discounts/business/:businessId` | `authenticate`, `isBusinessOwner` | `getBusinessDiscounts` | business_owner | List discounts | 🟡 |
| POST | `/api/discounts/` | `authenticate`, `isBusinessOwner` | `createDiscount` | business_owner | Create discount | 🟡 |
| GET | `/api/discounts/:id` | `authenticate` | `getDiscountById` | Authenticated | Get discount | 🟡 |
| PUT | `/api/discounts/:id` | `authenticate`, `isBusinessOwner` | `updateDiscount` | business_owner | Update discount | 🟡 |
| DELETE | `/api/discounts/:id` | `authenticate`, `isBusinessOwner` | `deleteDiscount` | business_owner | Delete discount | 🔴 |

---

## Admin routes

Global `router.use(authenticate, isAdmin)` noted as **admin** below.

### Users — `/admin/users` [`routes/admin/userRoutes.js`](../routes/admin/userRoutes.js)

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/admin/users/admins` | admin + validators | `createAdminUser` | admin | Create admin user | 🔴 prod caution |
| GET | `/admin/users/` | admin | `getAllUsers` | admin | List users | 🟡 |
| GET | `/admin/users/:id` | admin | `getUserById` | admin | User detail | 🟡 |
| PUT | `/admin/users/:id` | admin | `updateUserByAdmin` | admin | Update user | 🔴 |
| DELETE | `/admin/users/:id` | admin | `deleteUserByAdmin` | admin | Soft delete user | 🔴 |
| PUT | `/admin/users/:id/block` | admin | `toggleBlockUser` | admin | Block/unblock | 🔴 |

### Admin business — `/admin/api/business`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/admin/api/business/` | `authenticate`, `isAdmin` | `getAllBusinesses` | admin | List businesses | 🟡 |
| POST | `/admin/api/business/approve/:id` | same | `toggleBusinessStatus` | admin | Approve/activate business | 🔴 P3.5 |

### Admin products — `/admin/api/products`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/admin/api/products/` | `authenticate`, `isAdmin` | `getAllProducts` | admin | All products | 🟡 |
| PATCH | `/admin/api/products/:productId/featured` | same | `toggleProductFeatured` | admin | Toggle featured | 🟡 |

### Business profile verify — `/admin/business-profile-verify`

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `.../pending` | `authenticate`, `isAdmin` | `getPendingBusinessProfiles` | admin | Pending profiles | 🟡 |
| GET | `.../:profileId` | same | `getBusinessProfileDetails` | admin | Profile detail | 🟡 |
| POST | `.../:profileId/verify/:questionNumber` | same | `verifyQuestion` | admin | Verify question | 🟡 |
| POST | `.../:profileId/finalize` | same | `finalizeBusinessProfile` | admin | Finalize profile | 🔴 |

### Category admin CRUD

Mounts under `/api/admin/category/*`. Mutations require `authenticate`, `isAdmin` unless noted.

| Mount prefix | GET list | POST create | PUT/:id | DELETE/:id | Smoke |
| --- | --- | --- | --- | --- | --- |
| `/api/admin/category/product` | Public GET `/` | Admin POST | Admin PUT | Admin DELETE | 🟡 |
| `/api/admin/category/product-subcategory` | Admin router-level | Admin | Admin | Admin | 🟡 |
| `/api/admin/category/service` | Public GET `/` | Admin POST | Admin PUT | Admin DELETE | 🟡 |
| `/api/admin/category/service-subcategory` | Admin router-level | Admin | Admin | Admin | 🟡 |
| `/api/admin/category/food` | Public GET `/` | Admin POST | Admin PUT | Admin DELETE | 🟡 |
| `/api/admin/category/food-subcategory` | Admin router-level | Admin | Admin | Admin | 🟡 |

### Category requests — `/api/admin/category-requests` (router-level admin)

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `.../` | admin | `getAllCategoryRequests` | admin | List requests | 🟡 |
| PUT | `.../:id/approve` | admin | `approveCategoryRequest` | admin | Approve | 🟡 |
| PUT | `.../:id/reject` | admin | `rejectCategoryRequest` | admin | Reject | 🟡 |

### FAQs — `/admin/faqs` (router-level admin)

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET/POST/PUT/DELETE | `/admin/faqs/*` | admin | faq controller | admin | FAQ CRUD | 🟡 |

### Testimonials — `/api/admin/testimonials` (router-level admin)

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET/POST/PUT/DELETE | `/api/admin/testimonials/*` | admin | testimonial controller | admin | Testimonial CRUD | 🟡 |

### Blogs — `/admin/api/blogs` (router-level admin)

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST/GET/PUT/DELETE | `/admin/api/blogs/*` | admin | `blog.Controller` | admin | Blog CRUD + feature/publish toggles | 🟡 |

### CMS — `/api/cms` and `/cms` [`routes/admin/cmsRoutes.js`](../routes/admin/cmsRoutes.js)

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `.../public/:slug` | — | `getPublicCMSBySlug` | ⚪ Public | Public CMS page | 🟢 |
| GET | `.../public/how_it_works` | — | `getHowItWorks` | ⚪ Public | How it works content | 🟢 |
| GET/POST/PUT/DELETE/PATCH | `.../admin/*` | `authenticate`, `isAdmin` | cms controller | admin | CMS admin CRUD | 🟡 |

---

## Misc public / utility

| Method | Route | Middleware | Controller | Auth/Role | Purpose | Smoke Notes |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/api/contact-inquiry/` | — | `createContactInquiry` | ⚪ Public | Contact form | 🟡 — spam risk |
| POST | `/api/google-places/` | — | inline proxy | ⚪ Public | Google Places proxy | 🟡 — API key server-side |
| POST | `/api/upload-image` | `authenticate`, `isBusinessOwner` | inline + `savePendingImage` | business_owner | Cloudinary pending image | 🟡 |
| POST | `/api/discounts/validate` | — | see discounts | ⚪ | — | — |

---

## Production-risk summary

Routes that need extra care in production testing (from [launch-readiness-report.md](launch-readiness-report.md) and code scan):

| Risk | Routes | Mitigation |
| --- | --- | --- |
| **Unauthenticated payment** | `POST /api/payments/create-payment-intent` | Do not expose; smoke with awareness P0-7 |
| **Unauthenticated Stripe Connect** | `POST/GET /stripe/*` | Treat as P0-8; restrict at edge or add auth post-MVP |
| **Webhooks** | All 5 `POST` webhook paths | Unsigned POST must return 400; use Dashboard test events |
| **Real money** | `POST /api/orders/initiate`, vendor `create-payment`, subscriptions | Stripe test mode + dedicated test accounts only |
| **Public status leak** | `GET /api/vendor-onboarding/status/:applicationId` | Do not use real application IDs in public demos |
| **Admin destructive** | `/admin/users/*`, finalize, business approve | Admin test account only |
| **Pre-payment emails** | `POST /api/orders/initiate` | Known P0-6 — expect emails before pay succeeds |

---

## Audit tips

1. **Mount order** in `publicListing.js`: `GET /api/:id/similar` is broad — verify it does not shadow other `/api/*` routes.
2. **Duplicate routers:** vendor onboarding and CMS mounted twice — same handlers, different prefixes.
3. **Auth gaps:** Compare this doc to [TEST_MATRIX.md](TEST_MATRIX.md) for automated vs manual coverage.
4. When adding routes, update this file and register in [`app.js`](../app.js).
