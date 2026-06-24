# LLM Context Guide — Mosaic Backend

Fast navigation for AI coding assistants, new developers, and reviewers. **Read this before editing anything.**

**Read order:** [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) → this doc → [BACKEND_ARCHITECTURE_MAP.md](BACKEND_ARCHITECTURE_MAP.md) → [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md)

For full route maps and lifecycle detail, see [ARCHITECTURE.md](ARCHITECTURE.md), [API_SURFACE.md](API_SURFACE.md), and the [docs index](README.md).

---

## Project summary

| Item | Value |
| --- | --- |
| Name | Mosaic Biz Hub backend (`mosaic-biz-hub`) |
| Type | Node.js REST API |
| Framework | Express 5 |
| Database | MongoDB via Mongoose (not Supabase/Postgres) |
| Entry | `index.js` → `app.js` |
| Default port | `3001` |
| Production API | `https://api.mosaicbizhub.com` |
| Deploy target | AWS Elastic Beanstalk (auto GHA deploy on push/merge to `main`; manual `workflow_dispatch` also available) |
| **MVP program status** | [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) |

---

## Current baseline (2026-06-18)

| Item | Value |
| --- | --- |
| Production deploy SHA | `7d01011` (issues #33 + #42) |
| `main` HEAD | See git / program status hub |
| EB version label | `mosaic-7d01011c55cb3ea367ff928b4b5fe2c30897d65e` |
| Open PRs | None |
| Automated tests | **168/168** (`npm test`) |
| Completed MVP issues | #26–#33, #42 |
| Active roadmap | **#50–#60** (Phase 2 audits/refactors) |
| Proposed extensions | #61–#75 (not yet filed) |

Before starting issue work, read [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md).

---

## Backend purpose

This service powers a **minority-owned business marketplace**:

- **Customers** browse listings, manage cart/wishlist, place orders, book services/food.
- **Vendors** (`business_owner`) onboard, pay verification fees, manage businesses, products/services/food, and receive payouts via Stripe Connect.
- **Admins** review vendor applications, manage CMS/categories, moderate content, and oversee users.
- **Payments** run through Stripe (orders, subscriptions, vendor verification, Connect payouts) with five separate webhook endpoints.

---

## App entrypoints and bootstrap

| File | Role |
| --- | --- |
| [`index.js`](../index.js) | `dotenv`, MongoDB connect via [`config/Db.js`](../config/Db.js), HTTP listener on `PORT` (default 3001) |
| [`app.js`](../app.js) | Express app: CORS, cookies, **webhook raw-body mounts**, `express.json()`, all route mounts, health `GET /` |

**Critical boot order in `app.js`:**

1. CORS + `cookieParser`
2. Stripe webhook routes with `express.raw({ type: 'application/json' })` **before** `express.json()`
3. `express.json()` for all subsequent routes
4. Feature routers via `app.use(prefix, router)`

Breaking webhook mount order invalidates Stripe signature verification.

---

## Core business domains

| Domain | What it does | Primary paths |
| --- | --- | --- |
| **Auth** | JWT + cookies, OTP registration, Google OAuth, password reset | `routes/userRoutes.js`, `routes/authRoutes.js`, `middlewares/authenticate.js` |
| **Vendor onboarding** | Stage-1 application, verification payment, business profile, submit for review | `routes/vendorOnboarding.routes.js`, `controllers/vendorOnboarding.controller.js` |
| **Business / listings** | Business CRUD, products, services, food, public/private listings | `routes/businessRoutes.js`, `routes/productRoutes.js`, `routes/publicListing.js` |
| **Public marketplace / search** | Browse, filter, ranked products, vendor profile | `routes/publicListing.js`, `controllers/publicListing.js`, `controllers/productListingController.js` |
| **Featured products** | Canonical homepage featured feed | `routes/featuredProductRoutes.js` → **`GET /api/featured-products`** |
| **Customer commerce** | Cart, wishlist, enquiries, orders, bookings, discounts | `routes/customer/`, `routes/orderRoutes.js`, `routes/bookingRoutes.js` |
| **Payments / Stripe** | PaymentIntents, Connect, subscriptions, billing portal | `controllers/orderController.js`, `routes/connectRoutes.js`, `routes/stripeRoutes.js` |
| **Webhooks** | Five Stripe endpoints; raw body before JSON parser | `app.js`, `controllers/webhookController.js`, stripe controllers |
| **Admin** | User mgmt, vendor review, CMS, categories, blogs, FAQs | `routes/admin/`, `controllers/admin/` |
| **Email** | Onboarding, order, booking notifications | `utils/WellcomeMailer.js`, `utils/OrderMail.js`, `utils/orderPhase.js` |
| **Upload / media** | Cloudinary pending images, S3 presigned vendor docs | `routes/uploadImage.js`, `controllers/vendorOnboardingUpload.controller.js` |

---

## DTO and serializer patterns

Public API responses use shared normalizers — do not invent new field shapes without checking these first.

| Helper | Location | Used for |
| --- | --- | --- |
| `toPublicListingCard` | [`lib/listing/publicListingDto.js`](../lib/listing/publicListingDto.js) | Product/service/food list and card endpoints |
| `toPublicListingDetail` | same | Detail pages |
| `toPublicAuthUser` | [`utils/toPublicAuthUser.js`](../utils/toPublicAuthUser.js) | Auth responses (`/auth/check`, login) |
| `toAdminUser` | [`utils/toAdminUser.js`](../utils/toAdminUser.js) | Admin user list/detail |

**Contract reference:** [MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md](MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md) (issue #28)

**Services layer:** [`services/productListingService.js`](../services/productListingService.js), [`services/reviewService.js`](../services/reviewService.js), [`services/invoiceService.js`](../services/invoiceService.js)

---

## Featured products (canonical)

| Rule | Detail |
| --- | --- |
| **Use** | `GET /api/featured-products` |
| **Router** | [`routes/featuredProductRoutes.js`](../routes/featuredProductRoutes.js) mounted at `/api` |
| **Controller** | [`featuredProducts.controller.js`](../controllers/featuredProducts.controller.js) |
| **Response** | `{ products, pagination }` wrapper; items via `toPublicListingCard` |
| **Do not use** | `/api/products/featured` — **not registered** (404) |

Tests: [`tests/marketplace/featured-products-response.test.js`](../tests/marketplace/featured-products-response.test.js)

---

## Public marketplace and search flow

```
Client → GET /api/public/search | /api/products/list | /api/ranked | ...
       → publicListing / productListingController
       → Mongoose query on Product | Service | Food | Business
       → toPublicListingCard / toPublicListingDetail
       → JSON response
```

**Deep dive:** [MVP_BACKEND_SEARCH_FILTER_READINESS.md](MVP_BACKEND_SEARCH_FILTER_READINESS.md) · [MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md](MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md)

---

## Key files by feature area

### Bootstrap and routing

| File | Why it matters |
| --- | --- |
| [`index.js`](../index.js) | Server start, `dotenv`, MongoDB connect |
| [`app.js`](../app.js) | **All route mounts**; webhook raw-body order; CORS |
| [`config/Db.js`](../config/Db.js) | `MONGODB_URI` connection |
| [`.env.example`](../.env.example) | Authoritative env var **names** (never commit values) |

### Auth

| File | Why it matters |
| --- | --- |
| [`routes/userRoutes.js`](../routes/userRoutes.js) | Register, login, logout, OTP, `/auth/check` |
| [`routes/authRoutes.js`](../routes/authRoutes.js) | Google OAuth |
| [`middlewares/authenticate.js`](../middlewares/authenticate.js) | JWT verify, `sessionVersion` check |
| [`middlewares/isAdmin.js`](../middlewares/isAdmin.js) | Admin gate |
| [`middlewares/isBusinessOwner.js`](../middlewares/isBusinessOwner.js) | Vendor gate |
| [`middlewares/isCustomer.js`](../middlewares/isCustomer.js) | Customer gate |
| [`middlewares/requireVerifiedVendor.js`](../middlewares/requireVerifiedVendor.js) | OTP + optional Stage-1 verified |
| [`models/User.js`](../models/User.js) | User schema, roles, OTP, `sessionVersion` |

### Vendor onboarding

| File | Why it matters |
| --- | --- |
| [`routes/vendorOnboarding.routes.js`](../routes/vendorOnboarding.routes.js) | Vendor + admin verify routes (mounted twice) |
| [`controllers/vendorOnboarding.controller.js`](../controllers/vendorOnboarding.controller.js) | Draft, submit, profile, verification payment, webhook |
| [`controllers/admin/vendorOnboardVerifyStage1.js`](../controllers/admin/vendorOnboardVerifyStage1.js) | Admin queue, verify, finalize |
| [`utils/syncBusinessFromOnboarding.js`](../utils/syncBusinessFromOnboarding.js) | Creates/updates `Business` after approval |
| [`models/VendorOnboardingStage1.js`](../models/VendorOnboardingStage1.js) | Application schema and statuses |
| [`models/Business.js`](../models/Business.js) | Operational vendor record (Connect, subscription) |

### Email

| File | Why it matters |
| --- | --- |
| [`utils/WellcomeMailer.js`](../utils/WellcomeMailer.js) | Vendor onboarding emails |
| [`utils/approvalMail.js`](../utils/approvalMail.js) | Admin finalize approve/reject |
| [`utils/OrderMail.js`](../utils/OrderMail.js) | Post-payment order emails |
| [`utils/orderPhase.js`](../utils/orderPhase.js) | Order status / vendor new-order emails |
| [`utils/bookingMailer.js`](../utils/bookingMailer.js) | Service/food booking emails |

**Deep dive:** [MVP_BACKEND_EMAIL_NOTIFICATIONS.md](MVP_BACKEND_EMAIL_NOTIFICATIONS.md) · [MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md](MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md)

### Upload / media

| File | Why it matters |
| --- | --- |
| [`routes/uploadImage.js`](../routes/uploadImage.js) | `POST /api/upload-image` — Cloudinary URL → `PendingImage` |
| [`controllers/vendorOnboardingUpload.controller.js`](../controllers/vendorOnboardingUpload.controller.js) | S3 presigned URLs for vendor documents |
| [`controllers/s3Controller.js`](../controllers/s3Controller.js) | Product image uploads |

### Payments and Stripe (no-touch by default)

| File | Why it matters |
| --- | --- |
| [`controllers/orderController.js`](../controllers/orderController.js) | Order initiate, Connect PaymentIntent |
| [`utils/checkoutGuards.js`](../utils/checkoutGuards.js) | Business approval/active checkout gate (#42) |
| [`utils/paymentIntentResponse.js`](../utils/paymentIntentResponse.js) | Sanitized retrieve-intent response (#42) |
| [`controllers/stripePaymentController.js`](../controllers/stripePaymentController.js) | Post-payment order emails webhook |
| [`controllers/webhookController.js`](../controllers/webhookController.js) | Order status + subscription webhooks |
| [`controllers/connectController.js`](../controllers/connectController.js) | Stripe Connect onboarding |
| [`models/Order.js`](../models/Order.js) | Order + payment fields |

### Tests (mirror these when adding coverage)

| Path | Covers |
| --- | --- |
| [`tests/auth/`](../tests/auth/) | JWT payload, OAuth security, password reset |
| [`tests/admin/`](../tests/admin/) | Admin DTO, pending applications, finalize |
| [`tests/vendor/`](../tests/vendor/) | Field allowlist, verified vendor, uploads, sync, orders |
| [`tests/stripe/`](../tests/stripe/) | Webhooks, Connect checkout, checkout guards, email safety |
| [`tests/marketplace/`](../tests/marketplace/) | Public listing DTO, featured products, search filters |
| [`tests/email/`](../tests/email/) | Notification logging safety |
| [`tests/utils/`](../tests/utils/) | Email delivery helpers, checkout/PI sanitizers |

Full index: [TEST_MATRIX.md](TEST_MATRIX.md)

---

## Environment variable names (never paste values)

Grouped from [`.env.example`](../.env.example). Configure in `.env` locally; production values live in EB env properties only.

| Group | Variable names |
| --- | --- |
| Core | `PORT`, `NODE_ENV`, `MONGODB_URI`, `FRONTEND_URL`, `API_BASE_URL` |
| Auth / cookies | `JWT_SECRET`, `COOKIE_DOMAIN`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_ORDER_WEBHOOK_SECRET`, `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET`, `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`, `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET`, `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET`, `PLATFORM_FEE_CENTS`, `BILLING_PORTAL_RETURN_URL`, `CONNECT_RETURN_PATH`, `CONNECT_REFRESH_PATH`, `CONNECT_RETURN_URL`, `CONNECT_REFRESH_URL` |
| AWS S3 | `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET` |
| Email | `MAIL_USER`, `MAIL_PASSWORD`, `ADMIN_EMAIL`, `SUPPORT_EMAIL`, `APP_NAME`, `APP_URL` |
| Storage (optional) | `STORAGE_PROVIDER`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| Other optional | `GOOGLE_GEOCODING_API_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PUPPETEER_EXECUTABLE_PATH`, `LISTING_DEBUG` |

Sentry env vars are planned on unmerged `chore/post-deploy-hardening` (#18) — not on current `main`.

---

## Issue map and recommended order

### Completed MVP (#26–#35 subset)

| Issue | Title | Status |
| --- | --- | --- |
| #26 | Backend MVP API audit | Merged |
| #27 | Smoke proof pack | Partial evidence |
| #28 | Marketplace data contract | Merged, live |
| #29 | Search/filter readiness | Merged, live |
| #30 | Vendor onboarding + email | Merged, live |
| #31 | Vendor self-service APIs | Merged, live |
| #32 | Stripe Connect runtime | Merged, live |
| #33 | Email notifications | Merged, live |
| #42 | Checkout approval + safe PI | Merged, live |

### Open follow-ups (do before or alongside Phase 2)

| Issue | Title | Priority |
| --- | --- | --- |
| #41 | Payment route protection hardening | P0 security |
| #43 | Order email timing / webhook idempotency | P1 |
| #34 | Admin dashboard APIs (gaps) | P1 |
| #35 | Reviews API (tests/DTO audit) | P1 |
| #44–#46 | Pagination, DTO, validation audits | P2 |

### Infra / post-deploy (#18–#24)

| Issue | Title | Notes |
| --- | --- | --- |
| #18 | Sentry monitoring | On unmerged `chore/post-deploy-hardening` |
| #19–#23 | IAM, CORS smoke, staging workflow, rollback doc, push-to-main criteria | Open |
| #24 | Production deploy verification | **Closed** |

### Active Phase 2 roadmap (#50–#60)

| Issue | Title |
| --- | --- |
| **#50** | Agent onboarding and architecture knowledge pack (this doc set) |
| #51 | Platform and dependency modernization audit |
| #52 | Controller/service boundary refactor plan |
| #53 | Database index and explain-plan audit |
| #54 | Media payload optimization |
| #55 | OpenAPI / API contract documentation |
| #56 | Test fixtures and factories cleanup |
| #57 | Request validation, rate limiting, payload safety |
| #58 | Structured logging and correlation IDs |
| #59 | Background job and webhook processing readiness |
| #60 | Legacy route and dead-code cleanup |

### Proposed extensions (#61–#75)

Not yet filed on GitHub — see agent prompt pack for titles (smoke harness, env inventory, vendor state machine, admin authz matrix, email contract, order lifecycle, health diagnostics, seed cleanup, upload security, search taxonomy, audit trail, contract tests, backup runbook, plan entitlements, moderation visibility).

**Recommended order:** Finish #50 → #55 (contract docs) → #56 (test harness) → #44/#53 (performance) → security #57/#41 → observability #58/#18.

---

## Safe edit rules

1. **Read before write** — Open the route file, controller, model, and any existing test for the area you are changing.
2. **Follow the layer pattern** — `routes/` → `middlewares/` → `controllers/` → `models/`. Do not put business logic in route files.
3. **Match existing conventions** — Same naming, error response shapes, and middleware patterns as neighboring code.
4. **Minimal diff** — Fix only what the task requires. No drive-by refactors.
5. **Register new routes in `app.js`** — Every new router needs an `app.use(prefix, router)` mount.
6. **Webhook changes need raw body** — Stripe webhooks must mount with `express.raw()` **before** `express.json()` in `app.js`.
7. **Use env var names from `.env.example`** — Never hardcode secrets. Local dev uses `.env` (not `.env.local`).
8. **Auth checks use `req.user` from DB** — Role gates read `req.user.role`, not raw JWT claims.
9. **Run tests** — `npm test` after auth, vendor, admin, marketplace, or webhook changes.
10. **Documentation-only tasks** — Must not change runtime behavior.
11. **Preserve featured endpoint** — `GET /api/featured-products` only; never add `/api/products/featured`.

---

## Files and areas that should not be changed casually

| File / area | Risk if changed without care |
| --- | --- |
| [`app.js`](../app.js) | Breaks routing, CORS, or webhook body parsing order |
| [`middlewares/authenticate.js`](../middlewares/authenticate.js) | Breaks all protected routes |
| [`controllers/webhookController.js`](../controllers/webhookController.js) | Payment/subscription state desync |
| [`controllers/orderController.js`](../controllers/orderController.js) | Order/payment/Connect money flow |
| [`utils/checkoutGuards.js`](../utils/checkoutGuards.js), [`utils/paymentIntentResponse.js`](../utils/paymentIntentResponse.js) | Checkout safety (#42) |
| [`utils/syncBusinessFromOnboarding.js`](../utils/syncBusinessFromOnboarding.js) | Vendor approval → business creation |
| [`models/User.js`](../models/User.js), [`models/Order.js`](../models/Order.js), [`models/Business.js`](../models/Business.js) | Schema migrations affect all consumers |
| [`.github/workflows/deploy-eb-production.yml`](../.github/workflows/deploy-eb-production.yml) | Production deploy pipeline |
| [`.env`](../.env), [`.env.local`](../.env.local) | **Never commit**; never paste values into docs |
| [`routes/cms/cmsRoutes.js`](../routes/cms/cmsRoutes.js) | Unmounted dead file — do not wire up without explicit task |
| Legacy `/api/payments/*`, unauthenticated `/stripe/*` | Security gaps tracked in #41 — no casual edits |

---

## Auth — high level

```
Register → OTP email → verify OTP → JWT cookie
Login    → bcrypt verify → JWT cookie (sessionVersion in User)
OAuth    → Google redirect → upsert User → JWT cookie
Protected route → authenticate → loads User from DB → role middleware → controller
Logout / password reset → bump sessionVersion → invalidates old JWTs
```

- **Transport:** HTTP-only `token` cookie (web) or `Authorization: Bearer` (API/mobile).
- **Roles:** `customer`, `business_owner`, `admin` — checked on `req.user.role`.
- **No global auth** — Each route applies `authenticate` and role gates explicitly.

**Deep dive:** [AUTH_FLOW.md](AUTH_FLOW.md) · [auth.md](auth.md)

---

## Vendor onboarding — high level

```
1. saveDraft        → VendorOnboardingStage1 (status: draft)
2. updateBusinessProfile / patchBusinessProfile → onboarding doc (+ optional Business sync)
3. createVerificationPayment → Stripe PaymentIntent ($24.99)
4. webhook          → verificationPayment.status = paid
5. submitForReview  → status: submitted
6. Admin reviews    → verifyAndAllocatePoints → finalizeVerification
7. finalize         → syncBusinessFromOnboarding → Business record live
```

**Statuses:** `draft`, `submitted`, `verified`, `rejected`, `payment_pending`. Admin queue shows only `submitted`.

**Deep dive:** [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md) · [business-sync.md](business-sync.md)

---

## Admin review — high level

```
GET  pending applications  → status allowlist: submitted only
GET  application details   → full VendorOnboardingStage1 for review
POST verifyAndAllocatePoints → admin marks checklist, allocates points
POST finalizeVerification  → status verified → syncBusinessFromOnboarding → Business
```

**Deep dive:** [admin-read-mutation.md](admin-read-mutation.md)

---

## Stripe / webhooks — how they are organized

**Five endpoints, five secrets.** Each maps to one env var. All mount in `app.js` with `express.raw()` before `express.json()`.

| Route | Env secret | Handler | Updates |
| --- | --- | --- | --- |
| `POST /api/webhooks/stripe` | `STRIPE_ORDER_WEBHOOK_SECRET` | `webhookController.handleStripeWebhook` | `Order` payment status |
| `POST /api/stripe/webhook` | `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET` | `stripeController.handleStripeWebhook` | `Business`, `Subscription` |
| `POST /api/stripe/payment/webhook` | `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET` | `stripePaymentController.stripePaymentWebhook` | `Order` + emails |
| `POST /api/subscription/webhook` | `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | `webhookController.handleSubscriptionWebhook` | `Subscription` |
| `POST /api/vendor-onboarding/webhook/payment` | `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET` | `handleVendorPaymentWebhook` | `VendorOnboardingStage1` |

**Connect payouts:** `Business.stripeConnectAccountId` via Connect onboarding; orders use destination charges in PaymentIntents.

**Deep dive:** [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md) · [MVP_BACKEND_STRIPE_CONNECT_RUNTIME_VERIFICATION.md](MVP_BACKEND_STRIPE_CONNECT_RUNTIME_VERIFICATION.md)

---

## Deployment and runtime

| Doc | Use when |
| --- | --- |
| [SETUP.md](../SETUP.md) | Local dev bootstrap |
| [DEPLOYMENT.md](../DEPLOYMENT.md) | Production EB deploy, rollback |
| [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) | Deploy, smoke, Go/No-Go |
| [deploy-verification.md](deploy-verification.md) | Deploy verification log |
| [production-smoke-checklist.md](production-smoke-checklist.md) | Post-deploy smoke tiers P0–P6 |
| [production-env-checklist.md](production-env-checklist.md) | EB env var audit |

**Branch flow:** `feature/*` or `sprint/backend-*` → PR → **`staging`** → PR → **`main`** → auto GHA EB deploy. Never open feature PRs directly to `main`. Manual `workflow_dispatch` remains for redeploys.

---

## Testing commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Start with nodemon (port 3001 default) |
| `npm start` | Production-style start |
| `npm test` | Run all tests: `node --test tests/**/*.test.js` (**168** cases) |
| `node scripts/verify-auth-check-smoke.js` | Manual auth smoke against local/prod API |

**When to run tests:**

- Auth changes → `tests/auth/`
- Admin → `tests/admin/`
- Vendor → `tests/vendor/`
- Stripe/webhooks/checkout → `tests/stripe/`
- Marketplace/featured/search → `tests/marketplace/`
- Email → `tests/email/`, `tests/utils/`

---

## Release-control guardrails (agents)

- One issue per branch; one PR per issue
- Branch from `staging`; promote via PR to `staging`, then PR `staging` → `main` only
- No direct commits to `main`; no merge; no manual deploy triggers
- No secrets in docs, logs, or screenshots
- No fake production proof or live Stripe charges
- Do not edit deploy workflows without explicit issue scope + written approval
- Update [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) when sprint state changes (usually after human merge)

Full process: [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md)

---

## Evidence / proof-pack expectations

| Artifact | Purpose |
| --- | --- |
| [production-proof-pack-template.md](production-proof-pack-template.md) | Copy per release |
| [production-smoke-checklist.md](production-smoke-checklist.md) | P0–P6 checks |
| [deploy-verification.md](deploy-verification.md) | Chronological deploy log |

**Never include in evidence:** API keys, webhook secrets, JWTs, passwords, or full `.env` contents.

---

## Quick lookup — "I need to change X"

| Task | Start here |
| --- | --- |
| Any unfamiliar area | [BACKEND_ARCHITECTURE_MAP.md](BACKEND_ARCHITECTURE_MAP.md), [ARCHITECTURE.md](ARCHITECTURE.md) |
| Agent process / PR rules | [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md) |
| Login / JWT / OAuth | `routes/userRoutes.js`, `middlewares/authenticate.js` |
| Public search / browse | `routes/publicListing.js`, [MVP_BACKEND_SEARCH_FILTER_READINESS.md](MVP_BACKEND_SEARCH_FILTER_READINESS.md) |
| Featured products | `routes/featuredProductRoutes.js` — **`GET /api/featured-products` only** |
| Vendor onboarding | `controllers/vendorOnboarding.controller.js` |
| Admin vendor approval | `controllers/admin/vendorOnboardVerifyStage1.js` |
| Orders / checkout | `controllers/orderController.js`, `utils/checkoutGuards.js` |
| Stripe webhook | `app.js` mount order first, then handler |
| Email notifications | `utils/WellcomeMailer.js`, [MVP_BACKEND_EMAIL_NOTIFICATIONS.md](MVP_BACKEND_EMAIL_NOTIFICATIONS.md) |
| New API endpoint | route → controller → model → `app.js` mount → test |
| Deploy / release | [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) |
