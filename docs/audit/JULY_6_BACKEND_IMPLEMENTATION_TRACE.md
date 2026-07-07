# July 6 Backend Implementation Trace

Date: July 7, 2026  
Audited SHA: `ad9ddd14c85ac851f9001e5f9952c9b594159d9c` (`origin/main`)

Per-area backend evidence for the July 6 UAT checklist. Status terms follow the audit vocabulary (no Accepted/Complete/Launch-ready).

---

## 1. Image / Media Upload Limit Enforcement

| Field | Detail |
| --- | --- |
| **Files** | `controllers/productController.js`, `controllers/serviceController.js`, subscription plan helpers |
| **Routes** | Product/service create and update; upload-url routes under `/api/product`, `/api/service` |
| **Behavior** | Enforces plan-driven `galleryImageLimit` / `imageLimit`; returns explicit max count in 400 error (e.g. service gallery limit message) |
| **Auth** | `authenticate`, `isBusinessOwner` |
| **Tests** | `tests/service/service-publication-visibility.test.js` (plan limit references) |
| **Doc match** | **Implemented / Ready for QA** — backend enforces limits; copy alignment is frontend-owned |
| **Gap** | Manual screenshot of tier-accurate UI message |

---

## 2. Service Offering Persistence / Count / Display Contract

| Field | Detail |
| --- | --- |
| **Files** | `controllers/serviceController.js`, `controllers/publicListing.js`, `utils/businessListingVisibility.js`, `lib/listing/publicListingDto.js` |
| **Routes** | `GET /api/service/my-services`, public service list/detail |
| **Behavior** | Parent + child service model; public cards expose offering counts/names via listing visibility and DTO |
| **Response fields** | Child services array, offering count summaries on business/listing snapshots |
| **Tests** | `tests/integration/marketplace.integration.test.js`, `tests/service/service-publication-visibility.test.js` |
| **Doc match** | **Implemented / Ready for QA** |

---

## 3. Listing Image Arrays (Edit / Detail)

| Field | Detail |
| --- | --- |
| **Files** | `controllers/productController.js`, `controllers/serviceController.js`, `lib/listing/publicListingDto.js` |
| **Routes** | `GET/PUT /api/product/:id`, `GET/PUT /api/service/:id` |
| **Behavior** | Returns `images[]` and `coverImage` on detail; update accepts gallery arrays |
| **Tests** | `tests/marketplace/public-listing-dto.test.js` |
| **Doc match** | **Implemented / Ready for QA** |

---

## 4. Service Features Create / Update Persistence

| Field | Detail |
| --- | --- |
| **Files** | `controllers/serviceController.js` (`createService`, `createParentService`, `updateService`) |
| **Routes** | `POST /api/service`, `PUT /api/service/:id` |
| **Behavior** | `createService` persists normalized `features` from payload; `updateService` allows `features`; **`createParentService` initializes `features: []` ignoring body** |
| **Tests** | `tests/service/service-payload-contract.test.js`, `tests/integration/service-publication.integration.test.js` |
| **Doc match** | **Regression Risk** for parent-first create path; edit path **Implemented / Ready for QA** |

---

## 5. Service / Food Connect Optionality (Onboarding / Publication)

| Field | Detail |
| --- | --- |
| **Files** | `utils/businessListingVisibility.js` — `PAYOUT_REQUIRED_LISTING_TYPES = ['product']` |
| **Routes** | Publication readiness via business/my and publish-storefront |
| **Behavior** | Service/food vendors skip payout blockers at publication; product vendors require payout complete |
| **Tests** | Integration publish-storefront tests with payout blockers |
| **Doc match** | **Implemented / Ready for QA** for onboarding/publication only |

---

## 6. Description Sanitation (Backend Role)

| Field | Detail |
| --- | --- |
| **Files** | `controllers/publicListing.js`, `controllers/productController.js` |
| **Routes** | `GET /api/public/product/:productId` |
| **Behavior** | Backend returns stored description as-is; sanitization is frontend responsibility |
| **Doc match** | **Implemented / Ready for QA** (frontend owns rendering) |

---

## 7. Local Shipping Eligibility Contract

| Field | Detail |
| --- | --- |
| **Files** | `controllers/customer/cartController.js`, `utils/vendorShipping.js`, `controllers/publicListing.js` |
| **Routes** | `GET /api/cart`, `POST /api/orders/initiate` |
| **Behavior** | Cart pricing exposes `vendorState` per item; `availableDeliverySpeeds` includes `local` when eligible; product detail includes business state |
| **Response fields** | `vendorState`, `availableDeliverySpeeds`, shipping cost by speed |
| **Tests** | `tests/integration/commerce.integration.test.js` — "authenticated cart exposes vendor state for local delivery UI" |
| **Doc match** | **Implemented / Ready for QA** |

---

## 8. Cart Quantity Update Routes

| Field | Detail |
| --- | --- |
| **Files** | `controllers/customer/cartController.js` |
| **Routes** | `PUT /api/cart/update/:cartItemId` (canonical), legacy `PUT /api/cart/update-quantity` |
| **Behavior** | Decrement/increment by stable cart line id; quantity 0 removes line |
| **Auth** | `authenticate`, customer role |
| **Tests** | `tests/integration/commerce.integration.test.js` — decrease via cartItemId |
| **Doc match** | **Implemented / Ready for QA** |

---

## 9. Coupon Min Order / Expiry / Usage Rules

| Field | Detail |
| --- | --- |
| **Files** | `controllers/discountController.js`, `utils/couponDiscount.js` |
| **Routes** | `POST /api/discounts/validate`, `POST /api/discounts/apply`; cart pricing via `GET /api/cart?couponCode=` |
| **Behavior** | Rejects coupons below `minOrderAmount`; enforces dates and usage limits |
| **Tests** | `tests/utils/coupon-discount.test.js`, `tests/discount/coupon-apply-validate.test.js`, `tests/stripe/order-initiate-coupon.test.js` |
| **Doc match** | **Implemented / Ready for QA** |

---

## 10. Order Initiate Total Calculation / Tamper Rejection

| Field | Detail |
| --- | --- |
| **Files** | `controllers/orderController.js`, `controllers/customer/cartController.js` |
| **Routes** | `POST /api/orders/initiate` |
| **Behavior** | Server recomputes totals; rejects client tampering vs authoritative cart pricing |
| **Tests** | `tests/stripe/order-initiate-coupon.test.js`, commerce integration |
| **Doc match** | **Implemented / Ready for QA** |

---

## 11. Shipment Tracking Persistence and Email Delivery

| Field | Detail |
| --- | --- |
| **Files** | `controllers/orderController.js`, `utils/orderPhase.js`, `utils/orderLifecycleEmailDelivery.js` |
| **Routes** | `PUT /api/orders/ship/:orderId` |
| **Behavior** | Persists `trackingId`, `trackingUrl`, `vendorNote`; triggers lifecycle email with delivery metadata |
| **Tests** | `tests/orders/order-lifecycle-emails.test.js`, `tests/email/order-mail-links.test.js` |
| **Doc match** | Code **Implemented / Ready for QA**; hosted provider proof **Evidence Needed** |

---

## 12. PDF / JPEG Upload MIME Allowlist and Storage

| Field | Detail |
| --- | --- |
| **Files** | `controllers/vendorOnboardingUpload.controller.js`, `utils/vendorOnboardingUploadMimeAllowlist.js` |
| **Routes** | `GET /api/vendor-onboarding/stage1/upload-url`, `POST /api/vendor-onboarding/stage1/upload-file` |
| **Behavior** | PDF in document allowlist with MIME alias normalization; JPEG/PNG/WEBP for evidence |
| **Tests** | `tests/vendor/vendor-onboarding-upload-mime.test.js`, `tests/vendor/s3-presigned-upload-contract.test.js` |
| **Doc match** | Automated **Implemented / Ready for QA**; production S3/CORS **Evidence Needed** |

---

## 13. Admin Application Status Filtering / Profile Data Contract

| Field | Detail |
| --- | --- |
| **Files** | `controllers/admin/vendorOnboardVerifyStage1.js` |
| **Routes** | `GET /api/vendor-onboarding/pending?status=` |
| **Behavior** | `APPLICATION_STATUS_FILTERS` supports `all`, submitted/pending/rejected/approved aliases; returns profile summary fields |
| **Auth** | Admin |
| **Tests** | `tests/admin/vendorOnboardVerifyStage1.pending-applications.test.js`, vendor onboarding integration |
| **Doc match** | **Implemented / Ready for QA** |

---

## 14. Vendor Application Approve / Reject / Finalize State Machine

| Field | Detail |
| --- | --- |
| **Files** | `controllers/admin/vendorOnboardVerifyStage1.js`, `controllers/vendorOnboarding.controller.js` |
| **Routes** | `POST /api/vendor-onboarding/:id/verify`, `POST /api/vendor-onboarding/:id/finalize` |
| **Behavior** | Finalize accepts explicit `decision`, `rejectionReason`, `requiredNextAction`, `adminNotes`; rejected apps can resubmit |
| **Tests** | `tests/admin/vendor-onboarding-finalize.test.js`, `tests/vendor/rejected-application-resubmit.test.js` |
| **Doc match** | Backend **Implemented / Ready for QA**; "request changes" is modeled as reject + next action (**Documentation Mismatch** with handoff wording) |

---

## 15. Restaurant / Service Stripe Connect Requirement at Checkout

| Field | Detail |
| --- | --- |
| **Files** | `utils/checkoutGuards.js`, `controllers/connectController.js`, `utils/businessListingVisibility.js` |
| **Routes** | `POST /api/orders/initiate`; `/api/connect/:businessId/status` |
| **Behavior** | **Checkout:** `getBusinessCheckoutBlock` returns 400 if `!business.stripeConnectAccountId` for all vendors. **Onboarding:** payout required only for `listingType === 'product'`. |
| **Tests** | `tests/stripe/order-initiate-connect.test.js` — blocks checkout without Connect |
| **Doc match** | **Code Mismatch** — docs claim full service/food Connect optionality; checkout still mandatory |

---

## Route Registration Notes

- `app.js` line 240: `app.use('/api', featuredProductRoutes)` → `GET /api/featured-products`
- No `/api/products/featured` mount in active routes (contract test verified)
