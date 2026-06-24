# Backend Route Manifest

**Type:** Launch readiness audit evidence  
**Generated:** 2026-06-24  
**Branch baseline:** `audit/backend-frontend-contract-integrity` (includes child-service delete from PR #124)  
**Source of truth:** [`app.js`](../app.js) mount order → router files → controllers  
**Registered route count:** 309 (includes duplicate mounts of shared routers)  
**Unique mount registrations:** 52  
**Unmounted router files:** `routes/cms/cmsRoutes.js` (only file not registered in `app.js`)

---

## Mount prefix registry (registration order)

| Order | Mount prefix | Router variable | Router file |
| --- | --- | --- | --- |
| 1 | `/api/stripe` | `stripeRoutes` | `routes/stripeRoutes.js` |
| 2 | `/api/webhooks` | `webhookRoutes` | `routes/webhookRoutes.js` |
| 3 | `/api` | `healthRoutes` | `routes/healthRoutes.js` |
| 4 | `/api/product` | `productRoutes` | `routes/productRoutes.js` |
| 5 | `/api` | `publicListingRoutes` | `routes/publicListing.js` |
| 6 | `/api/private` | `privateListingRoutes` | `routes/privateListing.js` |
| 7 | `/api/users` | `userRoutes` | `routes/userRoutes.js` |
| 8 | `/api/business` | `businessRoutes` | `routes/businessRoutes.js` |
| 9 | `/api/vendor-onboarding` | `vendorOnboardRoutes` | `routes/vendorOnboarding.routes.js` |
| 10 | `/admin/vendor-onboard-verify-stage1` | `vendorOnboardVerifyStage1Routes` | `routes/vendorOnboarding.routes.js` |
| 11 | `/api/subscription-plans` | `subscriptionPlanRoutes` | `routes/subscriptionPlanRoutes.js` |
| 12 | `/api/service` | `serviceRoutes` | `routes/serviceRoutes.js` |
| 13 | `/api/food` | `foodRoutes` | `routes/foodRoutes.js` |
| 14 | `/api/minority-types` | `minorityTypeRoutes` | `routes/minorityTypeRoutes.js` |
| 15 | `/api` | `uploadImageRoute` | `routes/uploadImage.js` |
| 16 | `/api/subscriptions` | `subscriptionRoutes` | `routes/subscriptionRoutes.js` |
| 17 | `/api` | `categoryRoutes` | `routes/categoryRoutes.js` |
| 18 | `/api` | `subcategoryRoutes` | `routes/subcategoryRoutes.js` |
| 19 | `/api/cms` | `cmsRoutes` | `routes/admin/cmsRoutes.js` |
| 20 | `/cms` | `cmsRoutes` | `routes/admin/cmsRoutes.js` |
| 21 | `/admin/users` | `adminUserRoutes` | `routes/admin/userRoutes.js` |
| 22 | `/admin/faqs` | `adminFaqRoutes` | `routes/admin/faqRoutes.js` |
| 23 | `/api/admin/testimonials` | `testimonialRoutes` | `routes/admin/testimonialRoutes.js` |
| 24 | `/admin/api/blogs` | `blogRoutes` | `routes/admin/Blog/blogRoutes.js` |
| 25 | `/admin/api/business` | `adminBusinessRoutes` | `routes/admin/businessRoutes.js` |
| 26 | `/api/admin/business` | `adminBusinessRoutes` | `routes/admin/businessRoutes.js` |
| 27 | `/admin/api/products` | `adminProductRoutes` | `routes/admin/adminProductRoutes.js` |
| 28 | `/admin/api/orders` | `adminOrderRoutes` | `routes/admin/adminOrderRoutes.js` |
| 29 | `/admin/api/audit-events` | `adminAuditRoutes` | `routes/admin/adminAuditRoutes.js` |
| 30 | `/api/business-profile` | `businessProfileRoutes` | `routes/businessProfileRoutes.js` |
| 31 | `/api/admin/category/product` | `productCategoryRoutes` | `routes/admin/productCategoryRoutes.js` |
| 32 | `/api/admin/category/product-subcategory` | `productSubcategoryRoutes` | `routes/admin/productSubcategoryRoutes.js` |
| 33 | `/api/admin/category/service` | `ServiceCategoryRoutes` | `routes/admin/categoryRoutes.js` |
| 34 | `/api/admin/category-requests` | `categoryRequestRoutes` | `routes/admin/categoryRequestRoutes.js` |
| 35 | `/api/admin/category/service-subcategory` | `serviceSubcategoryRoutes` | `routes/admin/serviceSubcategoryRoutes.js` |
| 36 | `/api/admin/category/food` | `foodCategoryRoutes` | `routes/admin/foodCategoryRoutes.js` |
| 37 | `/api/admin/category/food-subcategory` | `foodSubcategoryRoutes` | `routes/admin/foodSubcategoryRoutes.js` |
| 38 | `/admin/business-profile-verify` | `businessProfileVerifyRoutes` | `routes/admin/businessProfileVerifyRoutes.js` |
| 39 | `/api/discounts` | `discountRoutes` | `routes/discounts.js` |
| 40 | `/api/wishlist` | `wishlistRoutes` | `routes/customer/wishlistRoutes.js` |
| 41 | `/api/cart` | `cartRoutes` | `routes/customer/cartRoutes.js` |
| 42 | `/api/payments` | `paymentRoutes` | `routes/paymentRoutes.js` |
| 43 | `/api/orders` | `orderRoutes` | `routes/orderRoutes.js` |
| 44 | `/api/bookings` | `bookingRoutes` | `routes/bookingRoutes.js` |
| 45 | `/api/connect` | `connectRoutes` | `routes/connectRoutes.js` |
| 46 | `/stripe` | `stripeNewRoutes` | `routes/stripe.routes.js` |
| 47 | `/api` | `apiRoutes` | `routes/api.routes.js` |
| 48 | `/api/google-places` | `googlePlace` | `routes/googlePlace.js` |
| 49 | `/api` | `featuredProductRoutes` | `routes/featuredProductRoutes.js` |
| 50 | `/api/contact-inquiry` | `contactInquiryRoutes` | `routes/contactInquiryRoutes.js` |
| 51 | `/api/auth` | `authRoutes` | `routes/authRoutes.js` |
| 52 | `/api/enquiries` | `enquiryRoutes` | `routes/enquiryRoutes.js` |

---

## Legend

| Column | Meaning |
| --- | --- |
| FullRoute | Effective URL path relative to API host |
| Auth | Public / JWT / Stripe signature |
| Role | Route-level role gate (controller may add ownership) |
| Destructive | DELETE or state-changing mutation |
| PaySens | Payment, order, webhook, or checkout adjacent |
| ID semantics | Parent vs child / slug vs Mongo _id notes |
| Doc | listed in API_SURFACE / new-unlisted / unlisted |

---

## Global / health (3 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/build-info` | GET | `routes/healthRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/health` | GET | `routes/healthRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/ready` | GET | `routes/healthRoutes` | `inline` | — | Public | — | no | no | — | unlisted |

## Auth and users (17 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/admin/users/` | GET | `routes/admin/userRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/admin/users/:id` | GET | `routes/admin/userRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/admin/users/:id` | PUT | `routes/admin/userRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/admin/users/:id` | DELETE | `routes/admin/userRoutes` | `inline` | — | Public | — | yes | no | — | listed |
| `/admin/users/:id/block` | PUT | `routes/admin/userRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/admin/users/admins` | POST | `routes/admin/userRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/auth/google` | GET | `routes/authRoutes` | `inline` | rateLimit | Public | — | no | no | — | listed |
| `/api/auth/google/callback` | GET | `routes/authRoutes` | `inline` | rateLimit | Public | — | no | no | — | listed |
| `/api/auth/google/complete` | POST | `routes/authRoutes` | `inline` | rateLimit | Public | — | no | no | — | listed |
| `/api/users/auth/check` | GET | `routes/userRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | no | — | listed |
| `/api/users/forgot-password` | POST | `routes/userRoutes` | `inline` | rateLimit | Public | — | no | no | — | listed |
| `/api/users/login` | POST | `routes/userRoutes` | `inline` | rateLimit | Public | — | no | no | — | listed |
| `/api/users/logout` | POST | `routes/userRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/users/register` | POST | `routes/userRoutes` | `inline` | rateLimit | Public | — | no | no | — | listed |
| `/api/users/resend-otp` | POST | `routes/userRoutes` | `inline` | rateLimit | Public | — | no | no | — | listed |
| `/api/users/reset-password` | POST | `routes/userRoutes` | `inline` | rateLimit | Public | — | no | no | — | listed |
| `/api/users/verify-otp` | POST | `routes/userRoutes` | `inline` | rateLimit | Public | — | maybe | no | — | listed |

## Vendor onboarding (31 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/admin/vendor-onboard-verify-stage1/:applicationId` | GET | `routes/vendorOnboarding.routes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | applicationId string (MBH-*), not Mongo _id | unlisted |
| `/admin/vendor-onboard-verify-stage1/:applicationId/finalize` | POST | `routes/vendorOnboarding.routes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | maybe | no | applicationId string (MBH-*), not Mongo _id | unlisted |
| `/admin/vendor-onboard-verify-stage1/:applicationId/verify` | POST | `routes/vendorOnboarding.routes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | maybe | no | applicationId string (MBH-*), not Mongo _id | unlisted |
| `/admin/vendor-onboard-verify-stage1/applicationId` | GET | `routes/vendorOnboarding.routes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | no | applicationId string (MBH-*), not Mongo _id | unlisted |
| `/admin/vendor-onboard-verify-stage1/business-profile` | PUT | `routes/vendorOnboarding.routes` | `inline` | requireStage1VerifiedVendor, authenticate | JWT cookie/Bearer | any authenticated | no | no | — | unlisted |
| `/admin/vendor-onboard-verify-stage1/business-profile` | PATCH | `routes/vendorOnboarding.routes` | `inline` | requireStage1VerifiedVendor, authenticate | JWT cookie/Bearer | any authenticated | no | no | — | unlisted |
| `/admin/vendor-onboard-verify-stage1/draft` | POST | `routes/vendorOnboarding.routes` | `inline` | requireVerifiedVendor, authenticate | JWT cookie/Bearer | business_owner (verified vendor) | no | no | — | unlisted |
| `/admin/vendor-onboard-verify-stage1/draft` | GET | `routes/vendorOnboarding.routes` | `inline` | requireVerifiedVendor, authenticate | JWT cookie/Bearer | business_owner (verified vendor) | no | no | — | unlisted |
| `/admin/vendor-onboard-verify-stage1/onboarding-data` | GET | `routes/vendorOnboarding.routes` | `inline` | requireVerifiedVendor, authenticate | JWT cookie/Bearer | business_owner (verified vendor) | no | no | — | unlisted |
| `/admin/vendor-onboard-verify-stage1/pending` | GET | `routes/vendorOnboarding.routes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | unlisted |
| `/admin/vendor-onboard-verify-stage1/stage1/create-payment` | POST | `routes/vendorOnboarding.routes` | `inline` | requireVerifiedVendor, authenticate | JWT cookie/Bearer | business_owner (verified vendor) | maybe | yes | — | unlisted |
| `/admin/vendor-onboard-verify-stage1/stage1/payment-status` | GET | `routes/vendorOnboarding.routes` | `inline` | requireVerifiedVendor, authenticate | JWT cookie/Bearer | business_owner (verified vendor) | no | yes | — | unlisted |
| `/admin/vendor-onboard-verify-stage1/stage1/upload-url` | GET | `routes/vendorOnboarding.routes` | `inline` | requireVerifiedVendor, authenticate | JWT cookie/Bearer | business_owner (verified vendor) | no | no | — | unlisted |
| `/admin/vendor-onboard-verify-stage1/status/:applicationId` | GET | `routes/vendorOnboarding.routes` | `inline` | — | Public | — | no | no | applicationId string (MBH-*), not Mongo _id | unlisted |
| `/admin/vendor-onboard-verify-stage1/submit` | POST | `routes/vendorOnboarding.routes` | `inline` | requireVerifiedVendor, authenticate | JWT cookie/Bearer | business_owner (verified vendor) | maybe | no | — | unlisted |
| `/api/vendor-onboarding/:applicationId` | GET | `routes/vendorOnboarding.routes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | applicationId string (MBH-*), not Mongo _id | unlisted |
| `/api/vendor-onboarding/:applicationId/finalize` | POST | `routes/vendorOnboarding.routes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | maybe | no | applicationId string (MBH-*), not Mongo _id | unlisted |
| `/api/vendor-onboarding/:applicationId/verify` | POST | `routes/vendorOnboarding.routes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | maybe | no | applicationId string (MBH-*), not Mongo _id | unlisted |
| `/api/vendor-onboarding/applicationId` | GET | `routes/vendorOnboarding.routes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | no | applicationId string (MBH-*), not Mongo _id | unlisted |
| `/api/vendor-onboarding/business-profile` | PUT | `routes/vendorOnboarding.routes` | `inline` | requireStage1VerifiedVendor, authenticate | JWT cookie/Bearer | any authenticated | no | no | — | unlisted |
| `/api/vendor-onboarding/business-profile` | PATCH | `routes/vendorOnboarding.routes` | `inline` | requireStage1VerifiedVendor, authenticate | JWT cookie/Bearer | any authenticated | no | no | — | unlisted |
| `/api/vendor-onboarding/draft` | POST | `routes/vendorOnboarding.routes` | `inline` | requireVerifiedVendor, authenticate | JWT cookie/Bearer | business_owner (verified vendor) | no | no | — | unlisted |
| `/api/vendor-onboarding/draft` | GET | `routes/vendorOnboarding.routes` | `inline` | requireVerifiedVendor, authenticate | JWT cookie/Bearer | business_owner (verified vendor) | no | no | — | unlisted |
| `/api/vendor-onboarding/onboarding-data` | GET | `routes/vendorOnboarding.routes` | `inline` | requireVerifiedVendor, authenticate | JWT cookie/Bearer | business_owner (verified vendor) | no | no | — | unlisted |
| `/api/vendor-onboarding/pending` | GET | `routes/vendorOnboarding.routes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | unlisted |
| `/api/vendor-onboarding/stage1/create-payment` | POST | `routes/vendorOnboarding.routes` | `inline` | requireVerifiedVendor, authenticate | JWT cookie/Bearer | business_owner (verified vendor) | maybe | yes | — | unlisted |
| `/api/vendor-onboarding/stage1/payment-status` | GET | `routes/vendorOnboarding.routes` | `inline` | requireVerifiedVendor, authenticate | JWT cookie/Bearer | business_owner (verified vendor) | no | yes | — | unlisted |
| `/api/vendor-onboarding/stage1/upload-url` | GET | `routes/vendorOnboarding.routes` | `inline` | requireVerifiedVendor, authenticate | JWT cookie/Bearer | business_owner (verified vendor) | no | no | — | unlisted |
| `/api/vendor-onboarding/status/:applicationId` | GET | `routes/vendorOnboarding.routes` | `inline` | — | Public | — | no | no | applicationId string (MBH-*), not Mongo _id | listed |
| `/api/vendor-onboarding/submit` | POST | `routes/vendorOnboarding.routes` | `inline` | requireVerifiedVendor, authenticate | JWT cookie/Bearer | business_owner (verified vendor) | maybe | no | — | unlisted |
| `/api/vendor-onboarding/webhook/payment` | POST | `app.js` | `router.handleVendorPaymentWebhook` | express.raw | Stripe signature | — | maybe | yes | — | listed |

## Business profile (21 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/admin/business-profile-verify/:profileId` | GET | `routes/admin/businessProfileVerifyRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | unlisted |
| `/admin/business-profile-verify/:profileId/finalize` | POST | `routes/admin/businessProfileVerifyRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | maybe | no | — | unlisted |
| `/admin/business-profile-verify/:profileId/verify/:questionNumber` | POST | `routes/admin/businessProfileVerifyRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | maybe | no | — | unlisted |
| `/admin/business-profile-verify/pending` | GET | `routes/admin/businessProfileVerifyRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | unlisted |
| `/api/business-profile/` | GET | `routes/businessProfileRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | no | — | listed |
| `/api/business-profile/save` | POST | `routes/businessProfileRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | no | — | listed |
| `/api/business-profile/step4-survey` | POST | `routes/businessProfileRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | no | — | listed |
| `/api/business-profile/submit` | POST | `routes/businessProfileRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | maybe | no | — | listed |
| `/api/business/` | POST | `routes/businessRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/business/` | GET | `routes/businessRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/business/:id` | PUT | `routes/businessRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/business/:id` | DELETE | `routes/businessRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | yes | no | — | listed |
| `/api/business/:id/shipping-settings` | GET | `routes/businessRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/business/:id/shipping-settings` | PUT | `routes/businessRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | maybe | no | — | listed |
| `/api/business/:id/tax-settings` | GET | `routes/businessRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/business/:id/tax-settings` | PUT | `routes/businessRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/business/:slug` | GET | `routes/businessRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | slug string | listed |
| `/api/business/draft` | POST | `routes/businessRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/business/my` | GET | `routes/businessRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/business/public/:slug` | GET | `routes/businessRoutes` | `inline` | — | Public | — | no | no | slug string | listed |
| `/api/business/retry-create` | POST | `routes/businessRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |

## Vendor products (15 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/product/` | POST | `routes/productRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/product/:productId` | GET | `routes/productRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/product/:productId` | PUT | `routes/productRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/product/:productId/reviews` | GET | `routes/productRoutes` | `inline` | — | Public | — | no | no | listingId + reviewId | listed |
| `/api/product/:productId/reviews` | POST | `routes/productRoutes` | `inline` | authenticate, isCustomer | JWT cookie/Bearer | customer | no | no | listingId + reviewId | listed |
| `/api/product/:productId/reviews/:reviewId` | DELETE | `routes/productRoutes` | `inline` | authenticate, isCustomer | JWT cookie/Bearer | customer | yes | no | listingId + reviewId | listed |
| `/api/product/add-variants/:productId` | POST | `routes/productRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/product/business/:businessId` | GET | `routes/productRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/product/delete-product/:productId` | DELETE | `routes/productRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | yes | no | productId=Product._id | listed |
| `/api/product/delete-variant/:productId/:variantId` | DELETE | `routes/productRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | yes | no | productId=Product._id; variantId=ProductVariant._id | listed |
| `/api/product/get-variant/:productId/:variantId` | GET | `routes/productRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/product/update-variant/:productId/:variantId` | PUT | `routes/productRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/product/update-variantstock/:variantId` | PATCH | `routes/productRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/product/upload-url` | GET | `routes/productRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | no | — | listed |
| `/api/product/variant-upload-url` | GET | `routes/productRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | no | — | listed |

## Vendor services (24 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/admin/category/service-subcategory/` | GET | `routes/admin/serviceSubcategoryRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/admin/category/service-subcategory/` | POST | `routes/admin/serviceSubcategoryRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/admin/category/service-subcategory/:id` | PUT | `routes/admin/serviceSubcategoryRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/admin/category/service-subcategory/:id` | DELETE | `routes/admin/serviceSubcategoryRoutes` | `inline` | — | Public | — | yes | no | — | unlisted |
| `/api/admin/category/service/` | GET | `routes/admin/categoryRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/admin/category/service/` | POST | `routes/admin/categoryRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | unlisted |
| `/api/admin/category/service/:id` | PUT | `routes/admin/categoryRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | unlisted |
| `/api/admin/category/service/:id` | DELETE | `routes/admin/categoryRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | yes | no | — | unlisted |
| `/api/service/` | POST | `routes/serviceRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/service/` | GET | `routes/serviceRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/service/:id` | GET | `routes/serviceRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/service/:id` | PUT | `routes/serviceRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/service/:parentServiceId/child-services/:childServiceId` | DELETE | `routes/serviceRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | yes | no | parentServiceId=Service._id; childServiceId=embedded subdoc _id | unlisted |
| `/api/service/:serviceId/reviews` | GET | `routes/serviceRoutes` | `inline` | — | Public | — | no | no | listingId + reviewId | listed |
| `/api/service/:serviceId/reviews` | POST | `routes/serviceRoutes` | `inline` | authenticate, isCustomer | JWT cookie/Bearer | customer | no | no | listingId + reviewId | listed |
| `/api/service/:serviceId/reviews/:reviewId` | DELETE | `routes/serviceRoutes` | `inline` | authenticate, isCustomer | JWT cookie/Bearer | customer | yes | no | listingId + reviewId | listed |
| `/api/service/add-child-services` | POST | `routes/serviceRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | parentServiceId=Service._id; childServiceId=embedded subdoc _id | listed |
| `/api/service/business-service/:id` | GET | `routes/serviceRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/service/child-services/:parentServiceId` | GET | `routes/serviceRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | parentServiceId=Service._id; childServiceId=embedded subdoc _id | listed |
| `/api/service/delete-service/:id` | DELETE | `routes/serviceRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | yes | no | :id=parent Service._id (whole document) | listed |
| `/api/service/my-services` | GET | `routes/serviceRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/service/parent` | POST | `routes/serviceRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/service/parent-services` | GET | `routes/serviceRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/service/upload-url` | GET | `routes/serviceRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | no | — | listed |

## Vendor food (11 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/food/` | GET | `routes/foodRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/food/:foodId/reviews` | GET | `routes/foodRoutes` | `inline` | — | Public | — | no | no | listingId + reviewId | listed |
| `/api/food/:foodId/reviews` | POST | `routes/foodRoutes` | `inline` | authenticate, isCustomer | JWT cookie/Bearer | customer | no | no | listingId + reviewId | listed |
| `/api/food/:foodId/reviews/:reviewId` | DELETE | `routes/foodRoutes` | `inline` | authenticate, isCustomer | JWT cookie/Bearer | customer | yes | no | listingId + reviewId | listed |
| `/api/food/add-food` | POST | `routes/foodRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/food/business-food/:id` | GET | `routes/foodRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/food/delete-food/:id` | DELETE | `routes/foodRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | yes | no | :id=Food listing _id | listed |
| `/api/food/food-by-id/:id` | GET | `routes/foodRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/food/my-foods` | GET | `routes/foodRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/food/update-food/:id` | PUT | `routes/foodRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/food/upload-url` | GET | `routes/foodRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | no | — | listed |

## Vendor private listings (4 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/private/food/list` | GET | `routes/privateListing` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/private/products/list` | GET | `routes/privateListing` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/private/services/:slug` | GET | `routes/privateListing` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | slug string | listed |
| `/api/private/services/list` | GET | `routes/privateListing` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |

## Public marketplace (22 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/:id/similar` | GET | `routes/publicListing` | `inline` | — | Public | — | no | no | — | listed |
| `/api/categories/foods` | GET | `routes/categoryRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/categories/products` | GET | `routes/categoryRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/categories/services` | GET | `routes/categoryRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/featured-products` | GET | `routes/featuredProductRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/food/:slug` | GET | `routes/publicListing` | `inline` | — | Public | — | no | no | slug string | unlisted |
| `/api/food/list` | GET | `routes/publicListing` | `inline` | — | Public | — | no | no | — | listed |
| `/api/foods/subcategories/:categoryIdOrSlug` | GET | `routes/subcategoryRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/products/:slug` | GET | `routes/publicListing` | `inline` | — | Public | — | no | no | slug string | unlisted |
| `/api/products/filters` | GET | `routes/publicListing` | `inline` | — | Public | — | no | no | — | listed |
| `/api/products/list` | GET | `routes/publicListing` | `inline` | — | Public | — | no | no | — | listed |
| `/api/products/subcategories/:categoryIdOrSlug` | GET | `routes/subcategoryRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/public/foods/:id` | GET | `routes/publicListing` | `inline` | — | Public | — | no | no | — | listed |
| `/api/public/product/:productId` | GET | `routes/publicListing` | `inline` | — | Public | — | no | no | — | listed |
| `/api/public/product/vendor-profile/:businessId` | GET | `routes/publicListing` | `inline` | — | Public | — | no | no | — | listed |
| `/api/public/products/business/:businessId` | GET | `routes/publicListing` | `inline` | — | Public | — | no | no | — | listed |
| `/api/public/search` | GET | `routes/publicListing` | `inline` | — | Public | — | no | no | — | listed |
| `/api/public/services/:id` | GET | `routes/publicListing` | `inline` | — | Public | — | no | no | — | listed |
| `/api/ranked` | GET | `routes/publicListing` | `inline` | — | Public | — | no | no | — | listed |
| `/api/services/:slug` | GET | `routes/publicListing` | `inline` | — | Public | — | no | no | slug string | listed |
| `/api/services/list` | GET | `routes/publicListing` | `inline` | — | Public | — | no | no | — | listed |
| `/api/services/subcategories/:categoryIdOrSlug` | GET | `routes/subcategoryRoutes` | `inline` | — | Public | — | no | no | — | listed |

## Cart, checkout, orders (31 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/admin/api/orders/` | GET | `routes/admin/adminOrderRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | yes | — | unlisted |
| `/admin/api/orders/summary` | GET | `routes/admin/adminOrderRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | yes | — | unlisted |
| `/api/cart/` | GET | `routes/customer/cartRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | yes | — | listed |
| `/api/cart/add` | POST | `routes/customer/cartRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | yes | — | listed |
| `/api/cart/count` | GET | `routes/customer/cartRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | yes | — | listed |
| `/api/cart/merge` | POST | `routes/customer/cartRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | yes | — | listed |
| `/api/cart/products/mini` | GET | `routes/customer/cartRoutes` | `inline` | — | Public | — | no | yes | — | listed |
| `/api/cart/products/mini` | POST | `routes/customer/cartRoutes` | `inline` | — | Public | — | no | yes | — | listed |
| `/api/cart/remove` | DELETE | `routes/customer/cartRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | yes | yes | — | listed |
| `/api/cart/remove/:cartItemId` | DELETE | `routes/customer/cartRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | yes | yes | — | listed |
| `/api/cart/update-quantity` | PUT | `routes/customer/cartRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | yes | — | listed |
| `/api/cart/update/:cartItemId` | PUT | `routes/customer/cartRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | yes | — | listed |
| `/api/cart/variants/mini` | GET | `routes/customer/cartRoutes` | `inline` | — | Public | — | no | yes | — | listed |
| `/api/cart/variants/mini` | POST | `routes/customer/cartRoutes` | `inline` | — | Public | — | no | yes | — | listed |
| `/api/orders/:id/invoice.pdf` | GET | `routes/orderRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | yes | — | listed |
| `/api/orders/:orderId/cancel` | POST | `routes/orderRoutes` | `inline` | authenticate, isCustomer | JWT cookie/Bearer | customer | maybe | yes | — | listed |
| `/api/orders/accept/:orderId` | PUT | `routes/orderRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | maybe | yes | — | listed |
| `/api/orders/admin` | GET | `routes/orderRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | yes | — | listed |
| `/api/orders/deliver/:orderId` | PUT | `routes/orderRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | maybe | yes | — | listed |
| `/api/orders/initiate` | POST | `routes/orderRoutes` | `inline` | authenticate, isCustomer | JWT cookie/Bearer | customer | maybe | yes | — | listed |
| `/api/orders/initiateReturn/:orderId` | PUT | `routes/orderRoutes` | `inline` | authenticate, isCustomer | JWT cookie/Bearer | customer | maybe | yes | — | listed |
| `/api/orders/reject/:orderId` | PUT | `routes/orderRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | maybe | yes | — | listed |
| `/api/orders/retrieve-intent/:id` | GET | `routes/orderRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | yes | — | listed |
| `/api/orders/return/:orderId` | PUT | `routes/orderRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | maybe | yes | — | listed |
| `/api/orders/ship/:orderId` | PUT | `routes/orderRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | maybe | yes | — | listed |
| `/api/orders/user` | GET | `routes/orderRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | yes | — | listed |
| `/api/orders/vendor` | GET | `routes/orderRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/api/payments/create-payment-intent` | POST | `routes/paymentRoutes` | `inline` | authenticate, isCustomer, rateLimit | JWT cookie/Bearer | customer | maybe | yes | — | listed |
| `/api/wishlist/` | GET | `routes/customer/wishlistRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/wishlist/:productVariantId` | POST | `routes/customer/wishlistRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/wishlist/:productVariantId` | DELETE | `routes/customer/wishlistRoutes` | `inline` | — | Public | — | yes | no | — | listed |

## Bookings (17 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/bookings/:id` | DELETE | `routes/bookingRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | yes | yes | — | listed |
| `/api/bookings/cancel/:id` | PUT | `routes/bookingRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | yes | — | listed |
| `/api/bookings/complete/:id` | PUT | `routes/bookingRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/api/bookings/confirm/:id` | PUT | `routes/bookingRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/api/bookings/customer` | GET | `routes/bookingRoutes` | `inline` | authenticate, isCustomer | JWT cookie/Bearer | customer | no | yes | — | listed |
| `/api/bookings/customer/food` | GET | `routes/bookingRoutes` | `inline` | authenticate, isCustomer | JWT cookie/Bearer | customer | no | yes | — | listed |
| `/api/bookings/customer/service` | GET | `routes/bookingRoutes` | `inline` | authenticate, isCustomer | JWT cookie/Bearer | customer | no | yes | — | listed |
| `/api/bookings/food` | POST | `routes/bookingRoutes` | `inline` | authenticate, isCustomer | JWT cookie/Bearer | customer | no | yes | — | listed |
| `/api/bookings/food/:foodId` | POST | `routes/bookingRoutes` | `inline` | authenticate, isCustomer | JWT cookie/Bearer | customer | no | yes | — | listed |
| `/api/bookings/service` | POST | `routes/bookingRoutes` | `inline` | authenticate, isCustomer | JWT cookie/Bearer | customer | no | yes | — | listed |
| `/api/bookings/service/:id/approve` | PUT | `routes/bookingRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/api/bookings/service/:id/reject` | PUT | `routes/bookingRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | maybe | yes | — | listed |
| `/api/bookings/service/:id/request-payment` | PUT | `routes/bookingRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/api/bookings/service/:serviceId` | POST | `routes/bookingRoutes` | `inline` | authenticate, isCustomer | JWT cookie/Bearer | customer | no | yes | — | listed |
| `/api/bookings/vendor` | GET | `routes/bookingRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/api/bookings/vendor/food` | GET | `routes/bookingRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/api/bookings/vendor/service` | GET | `routes/bookingRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |

## Discounts (7 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/discounts/` | POST | `routes/discounts` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/api/discounts/:id` | GET | `routes/discounts` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | yes | — | listed |
| `/api/discounts/:id` | PUT | `routes/discounts` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/api/discounts/:id` | DELETE | `routes/discounts` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | yes | yes | — | listed |
| `/api/discounts/apply` | POST | `routes/discounts` | `inline` | — | Public | — | maybe | yes | — | listed |
| `/api/discounts/business/:businessId` | GET | `routes/discounts` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/api/discounts/validate` | POST | `routes/discounts` | `inline` | — | Public | — | no | yes | — | listed |

## Stripe Connect and billing (12 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/connect/:businessId/account-link` | POST | `routes/connectRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/api/connect/:businessId/status` | GET | `routes/connectRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/api/connect/refresh` | GET | `routes/connectRoutes` | `inline` | — | Public | — | no | yes | — | listed |
| `/api/connect/return` | GET | `routes/connectRoutes` | `inline` | — | Public | — | no | yes | — | listed |
| `/api/stripe/create-checkout-session` | POST | `routes/stripeRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | maybe | yes | — | listed |
| `/api/stripe/payment/webhook` | POST | `routes/stripeRoutes` | `inline` | express.raw | Stripe signature | — | maybe | yes | — | listed |
| `/api/stripe/webhook` | POST | `routes/stripeRoutes` | `inline` | express.raw | Stripe signature | — | maybe | yes | — | listed |
| `/stripe/account-balance` | GET | `routes/stripe.routes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/stripe/account-session` | POST | `routes/stripe.routes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/stripe/backfill-customers` | POST | `routes/stripe.routes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | maybe | yes | — | listed |
| `/stripe/express-login-link` | POST | `routes/stripe.routes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/stripe/last-payout` | GET | `routes/stripe.routes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |

## Subscriptions (7 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/subscription-plans/` | POST | `routes/subscriptionPlanRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | yes | — | listed |
| `/api/subscription-plans/` | GET | `routes/subscriptionPlanRoutes` | `inline` | — | Public | — | no | yes | — | listed |
| `/api/subscription-plans/:id` | PUT | `routes/subscriptionPlanRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | yes | — | listed |
| `/api/subscription-plans/:id` | GET | `routes/subscriptionPlanRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | yes | — | listed |
| `/api/subscription/webhook` | POST | `app.js` | `router.handleSubscriptionWebhook` | express.raw | Stripe signature | — | maybe | yes | — | listed |
| `/api/subscriptions/create` | POST | `routes/subscriptionRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | yes | — | listed |
| `/api/subscriptions/user/subscriptions` | GET | `routes/subscriptionRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |

## Taxonomy and uploads (5 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/minority-types/` | GET | `routes/minorityTypeRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/minority-types/` | POST | `routes/minorityTypeRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | listed |
| `/api/minority-types/:id` | PUT | `routes/minorityTypeRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | listed |
| `/api/minority-types/:id` | DELETE | `routes/minorityTypeRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | yes | no | — | listed |
| `/api/minority-types/admin/all` | GET | `routes/minorityTypeRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | listed |

## CMS (18 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/cms/admin` | GET | `routes/admin/cmsRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/cms/admin/:slug` | GET | `routes/admin/cmsRoutes` | `inline` | — | Public | — | no | no | slug string | unlisted |
| `/api/cms/admin/:slug` | POST | `routes/admin/cmsRoutes` | `inline` | — | Public | — | no | no | slug string | unlisted |
| `/api/cms/admin/:slug` | PUT | `routes/admin/cmsRoutes` | `inline` | — | Public | — | no | no | slug string | unlisted |
| `/api/cms/admin/:slug` | DELETE | `routes/admin/cmsRoutes` | `inline` | — | Public | — | yes | no | slug string | unlisted |
| `/api/cms/admin/:slug/toggle` | PATCH | `routes/admin/cmsRoutes` | `inline` | — | Public | — | no | no | slug string | unlisted |
| `/api/cms/admin/how_it_works/:section` | PUT | `routes/admin/cmsRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/cms/public/:slug` | GET | `routes/admin/cmsRoutes` | `inline` | — | Public | — | no | no | slug string | unlisted |
| `/api/cms/public/how_it_works` | GET | `routes/admin/cmsRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/cms/admin` | GET | `routes/admin/cmsRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/cms/admin/:slug` | GET | `routes/admin/cmsRoutes` | `inline` | — | Public | — | no | no | slug string | unlisted |
| `/cms/admin/:slug` | POST | `routes/admin/cmsRoutes` | `inline` | — | Public | — | no | no | slug string | unlisted |
| `/cms/admin/:slug` | PUT | `routes/admin/cmsRoutes` | `inline` | — | Public | — | no | no | slug string | unlisted |
| `/cms/admin/:slug` | DELETE | `routes/admin/cmsRoutes` | `inline` | — | Public | — | yes | no | slug string | unlisted |
| `/cms/admin/:slug/toggle` | PATCH | `routes/admin/cmsRoutes` | `inline` | — | Public | — | no | no | slug string | unlisted |
| `/cms/admin/how_it_works/:section` | PUT | `routes/admin/cmsRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/cms/public/:slug` | GET | `routes/admin/cmsRoutes` | `inline` | — | Public | — | no | no | slug string | unlisted |
| `/cms/public/how_it_works` | GET | `routes/admin/cmsRoutes` | `inline` | — | Public | — | no | no | — | unlisted |

## Admin (45 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/admin/api/audit-events/` | GET | `routes/admin/adminAuditRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/admin/api/audit-events/:eventId` | GET | `routes/admin/adminAuditRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/admin/api/blogs/` | POST | `routes/admin/Blog/blogRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/admin/api/blogs/` | GET | `routes/admin/Blog/blogRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/admin/api/blogs/:slug` | GET | `routes/admin/Blog/blogRoutes` | `inline` | — | Public | — | no | no | slug string | unlisted |
| `/admin/api/blogs/:slug` | PUT | `routes/admin/Blog/blogRoutes` | `inline` | — | Public | — | no | no | slug string | unlisted |
| `/admin/api/blogs/:slug` | DELETE | `routes/admin/Blog/blogRoutes` | `inline` | — | Public | — | yes | no | slug string | unlisted |
| `/admin/api/blogs/:slug/feature` | PUT | `routes/admin/Blog/blogRoutes` | `inline` | — | Public | — | no | no | slug string | unlisted |
| `/admin/api/blogs/:slug/publish` | PUT | `routes/admin/Blog/blogRoutes` | `inline` | — | Public | — | maybe | no | slug string | unlisted |
| `/admin/api/business/` | GET | `routes/admin/businessRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | listed |
| `/admin/api/business/approve/:id` | POST | `routes/admin/businessRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | listed |
| `/admin/api/business/status/:id` | PATCH | `routes/admin/businessRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | unlisted |
| `/admin/api/products/` | GET | `routes/admin/adminProductRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | listed |
| `/admin/api/products/:productId/featured` | PATCH | `routes/admin/adminProductRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | listed |
| `/admin/faqs/` | GET | `routes/admin/faqRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/admin/faqs/` | POST | `routes/admin/faqRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/admin/faqs/:id` | PUT | `routes/admin/faqRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/admin/faqs/:id` | DELETE | `routes/admin/faqRoutes` | `inline` | — | Public | — | yes | no | — | unlisted |
| `/api/admin/business/` | GET | `routes/admin/businessRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | unlisted |
| `/api/admin/business/approve/:id` | POST | `routes/admin/businessRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | unlisted |
| `/api/admin/business/status/:id` | PATCH | `routes/admin/businessRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | unlisted |
| `/api/admin/category-requests/` | GET | `routes/admin/categoryRequestRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/admin/category-requests/:id/approve` | PUT | `routes/admin/categoryRequestRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/admin/category-requests/:id/reject` | PUT | `routes/admin/categoryRequestRoutes` | `inline` | — | Public | — | maybe | no | — | unlisted |
| `/api/admin/category/food-subcategory/` | GET | `routes/admin/foodSubcategoryRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/admin/category/food-subcategory/` | POST | `routes/admin/foodSubcategoryRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/admin/category/food-subcategory/:id` | PUT | `routes/admin/foodSubcategoryRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/admin/category/food-subcategory/:id` | DELETE | `routes/admin/foodSubcategoryRoutes` | `inline` | — | Public | — | yes | no | — | unlisted |
| `/api/admin/category/food/` | GET | `routes/admin/foodCategoryRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/admin/category/food/` | POST | `routes/admin/foodCategoryRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | unlisted |
| `/api/admin/category/food/:id` | PUT | `routes/admin/foodCategoryRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | unlisted |
| `/api/admin/category/food/:id` | DELETE | `routes/admin/foodCategoryRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | yes | no | — | unlisted |
| `/api/admin/category/product-subcategory/` | GET | `routes/admin/productSubcategoryRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/admin/category/product-subcategory/` | POST | `routes/admin/productSubcategoryRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/admin/category/product-subcategory/:id` | PUT | `routes/admin/productSubcategoryRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/admin/category/product-subcategory/:id` | DELETE | `routes/admin/productSubcategoryRoutes` | `inline` | — | Public | — | yes | no | — | unlisted |
| `/api/admin/category/product/` | POST | `routes/admin/productCategoryRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | unlisted |
| `/api/admin/category/product/` | GET | `routes/admin/productCategoryRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/admin/category/product/:id` | GET | `routes/admin/productCategoryRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | unlisted |
| `/api/admin/category/product/:id` | PUT | `routes/admin/productCategoryRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | no | no | — | unlisted |
| `/api/admin/category/product/:id` | DELETE | `routes/admin/productCategoryRoutes` | `inline` | authenticate, isAdmin | JWT cookie/Bearer | admin | yes | no | — | unlisted |
| `/api/admin/testimonials/` | GET | `routes/admin/testimonialRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/admin/testimonials/` | POST | `routes/admin/testimonialRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/admin/testimonials/:id` | PUT | `routes/admin/testimonialRoutes` | `inline` | — | Public | — | no | no | — | unlisted |
| `/api/admin/testimonials/:id` | DELETE | `routes/admin/testimonialRoutes` | `inline` | — | Public | — | yes | no | — | unlisted |

## Contact and enquiries (3 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/contact-inquiry/` | POST | `routes/contactInquiryRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/enquiries/reveal` | POST | `routes/enquiryRoutes` | `inline` | authenticate | JWT cookie/Bearer | any authenticated | no | no | — | listed |
| `/api/enquiries/vendor` | GET | `routes/enquiryRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |

## Google Places (1 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/google-places/` | POST | `routes/googlePlace` | `inline` | — | Public | — | no | no | — | listed |

## Webhooks (1 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/webhooks/stripe` | POST | `routes/webhookRoutes` | `inline` | express.raw | Stripe signature | — | no | yes | — | listed |

## Other (14 endpoints)

| FullRoute | Method | Router | Controller | Middleware | Auth | Role | Destructive | PaySens | ID semantics | Doc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | GET | `app.js` | `router.inline` | — | Public | — | no | no | — | listed |
| `/api/admin/categories` | GET | `routes/categoryRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/billing-portal/session` | POST | `routes/api.routes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/api/categories` | GET | `routes/categoryRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/category-requests` | POST | `routes/categoryRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/category-requests/my` | GET | `routes/categoryRoutes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |
| `/api/getProductCategories` | GET | `routes/categoryRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/s3-presigned-url` | GET | `routes/categoryRoutes` | `inline` | authenticate, isBusinessOwnerOrAdmin | JWT cookie/Bearer | any authenticated | no | no | — | listed |
| `/api/sub-categories` | GET | `routes/categoryRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/subcategories/:categoryId` | GET | `routes/categoryRoutes` | `inline` | — | Public | — | no | no | — | listed |
| `/api/subscriptions/:id/cancel` | POST | `routes/api.routes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | maybe | yes | — | listed |
| `/api/subscriptions/:id/resume` | POST | `routes/api.routes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/api/subscriptions/current` | GET | `routes/api.routes` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | yes | — | listed |
| `/api/upload-image` | POST | `routes/uploadImage` | `inline` | authenticate, isBusinessOwner | JWT cookie/Bearer | business_owner | no | no | — | listed |

---

## Duplicate mount note

The following routers are mounted more than once (each combination produces distinct full paths):

- `vendorOnboarding.routes.js` → `/api/vendor-onboarding` and `/admin/vendor-onboard-verify-stage1`
- `admin/cmsRoutes.js` → `/api/cms` and `/cms`
- `admin/businessRoutes.js` → `/admin/api/business` and `/api/admin/business`
- `publicListing.js`, `categoryRoutes.js`, `featuredProductRoutes.js`, `uploadImage.js`, `api.routes.js`, `healthRoutes.js` share `/api` prefix with other routers

---

## Response envelope patterns (controller-level — see risk report)

| Pattern | Example routes |
| --- | --- |
| `{ success, data, publication? }` | Service owner mutations via `formatOwnerServiceResponse` |
| `{ success, message, data? }` | Discounts, CMS, many admin routes |
| `{ message }` only | `deleteService`, `deleteFood`, parent product delete |
| `{ success: true, message }` | Variant delete, child service delete |
| `{ clientSecret, amount, currency }` | Payment intent (no `success` wrapper) |
| `{ error }` / `{ message }` | Legacy error responses |
| Pagination `{ data, total, page, totalPages }` | List endpoints |

---

## Verification limits

This manifest is derived from static route registration and middleware strings. Request body fields, exact success status codes, and controller ownership checks are summarized in [`BACKEND_FRONTEND_CONTRACT_RISK_REPORT.md`](./BACKEND_FRONTEND_CONTRACT_RISK_REPORT.md). Runtime behavior requires staging smoke tests against `https://api.mosaicbizhub.com`.
