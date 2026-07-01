# Final MVP Launch Gate Backend Evidence

Date: 2026-07-01  
Repo: `Techware-Hut/mosaic-backend`  
Branch: `audit/final-mvp-launch-gate-backend`  
Audit base SHA: `676be1d61816fb7977ab9dac1de51ecb1760160d`  
Production API target: `https://api.mosaicbizhub.com`  
Production frontend target: `https://app.mosaicbizhub.com`

This is an evidence report, not a launch-readiness claim. Do not merge or deploy from this branch without stakeholder approval and a credentialed production QA/UAT pass.

## Executive Summary

- Backend unit, contract, and integration suites pass.
- Live read-only backend smoke against `https://api.mosaicbizhub.com` passes public and unauthenticated guard checks.
- Canonical `GET /api/featured-products` is mounted; `/api/products/featured` is absent and returns 404 in live smoke.
- Stripe webhook raw-body mounts remain before `express.json()`, and contract tests protect that ordering.
- Credentialed production checks remain blocked because no smoke tokens were provided.
- Stripe checkout, Connect payout/split, and live order-email delivery cannot be checked off without a safe Stripe test-mode transaction and email-provider proof.

## Commands Run

| Command | Result | Evidence |
| --- | --- | --- |
| `npm test` | PASS | 474 tests passed, 0 failed. Covered vendor onboarding auth, upload MIME/S3 behavior, vendor profile allowlists, vendor order scoping, Stripe verification-payment guards, and more. |
| `npm run test:contract` | PASS | 20 tests passed, 0 failed. Covered launch-critical route mounts, canonical featured route, admin/customer/vendor route guards, raw-body webhook order, Connect route auth, health routes, and request IDs. |
| `npm run test:integration` | PASS | 61 tests passed, 0 failed. Covered register -> OTP -> login -> auth/check -> logout for customer and business_owner, Connect contract, marketplace visibility, cart/order guards, vendor onboarding submit/finalize/reject flows, and service publication. |
| `npm run smoke:backend` | FAIL locally by default | Script defaulted to `http://localhost:3001`; no local server was running. This is not a production API failure. |
| `$env:API_BASE_URL='https://api.mosaicbizhub.com'; npm run smoke:backend` | PASS with blocked credentialed checks | 28 pass, 0 fail, 2 skip, 5 blocked. Public endpoints and unauth guards passed; customer/vendor/admin token checks blocked because `SMOKE_TEST_*_TOKEN` values were not provided. |

## Live Backend Smoke Evidence

Live read-only smoke passed for:

- `GET /`
- `GET /api/health`
- `GET /api/ready`
- `GET /api/build-info`
- `GET /api/users/auth/check` unauthenticated returns `401`
- `GET /api/featured-products` returns `200`
- `GET /api/products/list?limit=5` returns `200`
- `GET /api/public/search?keyword=test&limit=5` returns `200`
- `GET /api/services/list?limit=5` returns `200`
- `GET /api/food/list?limit=5` returns `200`
- CORS preflight returns `204` with credentials for approved production/preview origins:
  - `https://mosaicbizhub.com`
  - `https://app.mosaicbizhub.com`
  - `https://mosaic-biz-frontend-launch.vercel.app`
  - Vercel main/develop preview origins in the allowlist
- Guard checks returned safe unauthenticated responses:
  - `GET /api/admin/categories` -> `401`
  - `POST /api/orders/initiate` -> `401`
  - `POST /api/connect/:id/account-link` -> `401`
  - `GET /admin/users` -> `401`
  - `GET /admin/api/products` -> `401`
  - `POST /api/payments/create-payment-intent` -> `401`
  - `GET /stripe/account-balance` -> `401`
- `GET /api/products/featured` is absent and returned `404`.

Blocked live smoke checks:

- Customer auth chain: `SMOKE_TEST_CUSTOMER_TOKEN` not set.
- Vendor auth chain and `GET /api/business/my`: `SMOKE_TEST_VENDOR_TOKEN` not set.
- Vendor onboarding data: `SMOKE_TEST_VENDOR_TOKEN` not set.
- Admin auth: `SMOKE_TEST_ADMIN_TOKEN` not set.
- Product detail/vendor profile live smoke skipped because `SMOKE_TEST_PRODUCT_ID` and `SMOKE_TEST_BUSINESS_ID` were not set.

## Backend Route and Middleware Evidence

- `app.js` applies request IDs, Sentry capture, CORS with credentials, cookies, raw-body Stripe webhook mounts, then `express.json()`.
- Raw-body mounts before JSON parsing:
  - `/api/stripe`
  - `/api/webhooks`
  - `/api/vendor-onboarding/webhook/payment`
  - `/api/subscription/webhook`
- Launch-critical route mounts include:
  - `/api/users`
  - `/api/business`
  - `/api/vendor-onboarding`
  - `/admin/vendor-onboard-verify-stage1`
  - `/api/product`
  - `/api/service`
  - `/api/food`
  - `/api/orders`
  - `/api/connect`
  - `/stripe`
  - `/api/featured-products` through `featuredProductRoutes`
- CORS origin policy is centralized in `utils/corsOrigins.js`; `www.mosaicbizhub.com` and `api.mosaicbizhub.com` are intentionally disallowed credentialed origins.
- Cookie behavior is centralized in `utils/cookieHelper.js` and tested for production `secure` / `sameSite` behavior.

## Backend Model / Service Evidence

- Vendor onboarding:
  - `models/VendorOnboardingStage1.js`
  - `controllers/vendorOnboarding.controller.js`
  - `controllers/vendorOnboardingUpload.controller.js`
  - `controllers/admin/vendorOnboardVerifyStage1.js`
  - `routes/vendorOnboarding.routes.js`
- Marketplace data:
  - `models/Product.js`, `models/ProductVariant.js`, `models/Service.js`, `models/Food.js`, `models/Business.js`
  - `controllers/publicListing.js`, `controllers/featuredProducts.controller.js`, `controllers/productListingController.js`
- Orders and payments:
  - `models/Order.js`
  - `controllers/orderController.js`
  - `controllers/stripePaymentController.js`
  - `controllers/webhookController.js`
  - `utils/OrderMail.js`
  - `utils/orderLifecycleEmailDelivery.js`
- Reviews:
  - `models/Review.js`
  - `controllers/reviewController.js`
  - `services/reviewService.js`

## Final MVP Launch Gate Table

| # | Launch Gate Item | Status | Evidence | Blocker / Next Action | Repo Ownership |
| - | ---------------- | ------ | -------- | --------------------- | -------------- |
| 1 | A vendor can apply | PARTIAL | Integration tests pass customer and business_owner registration/OTP/login; vendor onboarding draft and submit tests pass; live unauth guards pass. | Needs credentialed production browser/API proof that a vendor can submit and admin can see the application. | Frontend + Backend |
| 2 | Admin can approve the vendor | PARTIAL | Integration test `admin verify and finalize progression` passes; admin vendor routes are guarded. | Needs admin production credential proof and audit evidence for one real test application. | Backend + Frontend |
| 3 | Vendor can create profile | PARTIAL | Business profile allowlist/update tests pass; `/api/vendor-onboarding/business-profile` protected routes exist. | Needs credentialed vendor proof that profile persists and reflects publicly after approval. | Backend + Frontend |
| 4 | Vendor can add products/services | PARTIAL | Product/service/food creation routes exist; ownership, deletion, publication, upload, and visibility tests pass. | Needs live credentialed creation/publish proof for product, service, and food paths. | Backend + Frontend |
| 5 | Vendor can connect payment account | PARTIAL | Connect account-link/status routes require business_owner auth; integration tests cover onboarding URL contract and owner scope. | Needs Stripe test account-link/status proof with a test vendor. | Backend + Stripe |
| 6 | Customer can browse | PARTIAL | Live smoke passed featured products, product list, public search, service list, and food list endpoints. | Needs browser route proof and current production data verification. | Backend + Frontend |
| 7 | Customer can search/filter | PARTIAL | Live smoke passed `/api/public/search`; integration tests cover public marketplace visibility. | Existing frontend issue #293 and backend category-data audit #187 remain relevant if API data causes filter/count drift. | Frontend + Backend |
| 8 | Customer can view vendor/product details | PARTIAL | Public product detail integration test passes when seeded; live detail smoke skipped due missing IDs. | Provide `SMOKE_TEST_PRODUCT_ID` and `SMOKE_TEST_BUSINESS_ID`, then rerun live smoke and browser detail checks. | Backend + Frontend |
| 9 | Customer can add to cart | PARTIAL | Integration tests cover authenticated customer cart and ineligible-vendor cart stripping; unauth order initiate is guarded. | Needs credentialed browser add/update/remove proof against a test product. | Backend + Frontend |
| 10 | Customer can check out through Stripe Connect | BLOCKED | Order initiate route is customer-auth guarded; webhook raw-body order is protected; post-payment tests pass. | Needs full Stripe test-mode checkout through Connect and order state proof. | Backend + Stripe + Frontend |
| 11 | Stripe payout/split works correctly | BLOCKED | Post-payment webhook tests store charge, transfer, and application fee IDs. | Needs Stripe dashboard/test transaction evidence proving destination account and platform fee split. | Backend + Stripe |
| 12 | Customer receives confirmation email | PARTIAL | `stripePaymentWebhook` calls `sendOrderPaidEmails`; tests cover success, duplicate skip, failed payment no-send, and email-failure logging. | Needs SMTP/test-provider proof from a successful paid order. | Backend |
| 13 | Vendor receives order notification | PARTIAL | `sendOrderPaidEmails` sends vendor recipients and invoice attachment; tests cover paid-order email path. | Needs live/test-provider email evidence and duplicate webhook proof. | Backend |
| 14 | Admin can view sales/activity | PARTIAL | Admin order routes are guarded; integration tests cover admin orders access; admin summary tests exist. | Needs production admin proof that sales/activity matches order/payment records. | Backend + Frontend |
| 15 | Customer can leave review | PARTIAL | Review routes exist for product/service/food; customer auth required; review pagination/summary code exists. | Purchase verification and moderation were not proven in this audit; decide MVP rule or open corrective issue. | Backend + Frontend |
| 16 | Site works on mobile | PARTIAL | Backend has no mobile ownership; frontend build/tests cover some responsive helpers. | Needs frontend Playwright/mobile screenshot evidence across key routes. | Frontend |
| 17 | Legal/policy pages are visible in footer | PASS | Backend has no footer ownership; frontend build confirms legal/policy pages. | Technical visibility can be checked off from frontend evidence; legal copy approval is stakeholder-owned. | Frontend + Stakeholder |
| 18 | No lorem ipsum, fake content, broken buttons, or dead links remain | PARTIAL | Backend live smoke found no deprecated featured route and public endpoints are reachable. | Frontend/content PRs and content decisions remain; backend category source audit #187 still relevant. | Frontend + Backend + Stakeholder |

## Related GitHub Issues / PRs

- Backend issue #187: marketplace category source audit and data cleanup plan.
- Backend issue #183: email notification audit and template registry.
- Backend issue #182: customer order lifecycle emails.
- Backend issue #180: vendor application lifecycle emails.
- Backend issue #46: validation/error consistency.
- Frontend issue #293: marketplace discovery filters and counts QA.
- Frontend issues #301-#304: soft-launch language and category visual/content evidence.

## Remaining Backend Blockers

- Credentialed production smoke requires safe customer/vendor/admin tokens or approved test login credentials.
- Checkout, payout/split, and order email gates require Stripe test-mode transaction evidence.
- Email delivery needs provider-level proof; code tests are not enough to check off launch items 12 and 13.
- Review purchase-gating/moderation is not proven by current review route evidence.
- Marketplace category source/data cleanup remains open if public categories are API/admin data rather than frontend fixtures.

## Rollback Notes

- No backend runtime code was changed in this audit branch.
- This branch only adds `docs/FINAL_MVP_LAUNCH_GATE_BACKEND_EVIDENCE.md`.
- Rollback is to revert the documentation commit.
