# LLM Context Guide — Mosaic Backend

Fast navigation for AI coding assistants (Cursor, OpenClaw, etc.), new developers, and reviewers. **Read this before editing anything.**

For full route maps and lifecycle detail, see [ARCHITECTURE.md](ARCHITECTURE.md), [API_SURFACE.md](API_SURFACE.md), and the [docs index](README.md).

---

## Project summary

| Item | Value |
|------|-------|
| Name | Mosaic Biz Hub backend (`mosaic-biz-hub`) |
| Type | Node.js REST API |
| Framework | Express 5 |
| Database | MongoDB via Mongoose (not Supabase/Postgres) |
| Entry | `index.js` → `app.js` |
| Default port | `3001` |
| Production API | `https://api.mosaicbizhub.com` |
| Deploy target | AWS Elastic Beanstalk (manual deploy from `main`) |
| **MVP program status** | [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) — production SHA, open PRs, #26–#35 roadmap |

---

## Backend MVP sprint (#26–#35)

Before starting or reviewing issue work, read [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md).

| State (2026-06-17) | Detail |
| --- | --- |
| Production EB | `6cdf587` — issue #30 live |
| Open PR | [#40](https://github.com/Techware-Hut/mosaic-backend/pull/40) — issue #31 (**not deployed**) |
| Test suite | **107/107** on production lineage; **123/123** on PR #40 branch |
| Next scheduled | **#32** Stripe Connect runtime — do not start until scheduled |

Issue-specific docs: [docs/README.md](README.md) § MVP backend sprint.

## Backend purpose

This service powers a **minority-owned business marketplace**:

- **Customers** browse listings, manage cart/wishlist, place orders, book services/food.
- **Vendors** (`business_owner`) onboard, pay verification fees, manage businesses, products/services/food, and receive payouts via Stripe Connect.
- **Admins** review vendor applications, manage CMS/categories, moderate content, and oversee users.
- **Payments** run through Stripe (orders, subscriptions, vendor verification, Connect payouts) with five separate webhook endpoints.

---

## Core business domains

| Domain | What it does | Primary paths |
|--------|--------------|---------------|
| **Auth** | JWT + cookies, OTP registration, Google OAuth, password reset | `routes/userRoutes.js`, `routes/authRoutes.js`, `middlewares/authenticate.js` |
| **Vendor onboarding** | Stage-1 application, verification payment, business profile, submit for review | `routes/vendorOnboarding.routes.js`, `controllers/vendorOnboarding.controller.js`, `models/VendorOnboardingStage1.js` |
| **Business / listings** | Business CRUD, products, services, food, public/private listings | `routes/businessRoutes.js`, `routes/productRoutes.js`, `routes/publicListing.js` |
| **Customer commerce** | Cart, wishlist, enquiries, orders, bookings, discounts | `routes/customer/`, `routes/orderRoutes.js`, `routes/bookingRoutes.js` |
| **Payments / Stripe** | PaymentIntents, Connect, subscriptions, billing portal | `controllers/orderController.js`, `routes/connectRoutes.js`, `routes/stripeRoutes.js`, `routes/api.routes.js` |
| **Webhooks** | Five Stripe endpoints; raw body before JSON parser | `app.js` (mount order), `controllers/webhookController.js`, stripe controllers |
| **Admin** | User mgmt, vendor review, CMS, categories, blogs, FAQs | `routes/admin/`, `controllers/admin/` |

---

## Key files by feature area

### Bootstrap and routing

| File | Why it matters |
|------|----------------|
| [`index.js`](../index.js) | Server start, `dotenv`, MongoDB connect |
| [`app.js`](../app.js) | **All route mounts**; webhook raw-body order; CORS |
| [`config/Db.js`](../config/Db.js) | `MONGODB_URI` connection |
| [`.env.example`](../.env.example) | Authoritative env var names |

### Auth

| File | Why it matters |
|------|----------------|
| [`routes/userRoutes.js`](../routes/userRoutes.js) | Register, login, logout, OTP, `/auth/check` |
| [`routes/authRoutes.js`](../routes/authRoutes.js) | Google OAuth |
| [`controllers/userController.js`](../controllers/userController.js) | Local auth logic |
| [`controllers/authController.js`](../controllers/authController.js) | Google OAuth, JWT minting |
| [`middlewares/authenticate.js`](../middlewares/authenticate.js) | JWT verify, `sessionVersion` check |
| [`middlewares/isAdmin.js`](../middlewares/isAdmin.js) | Admin gate |
| [`middlewares/isBusinessOwner.js`](../middlewares/isBusinessOwner.js) | Vendor gate |
| [`middlewares/isCustomer.js`](../middlewares/isCustomer.js) | Customer gate |
| [`middlewares/requireVerifiedVendor.js`](../middlewares/requireVerifiedVendor.js) | OTP + optional Stage-1 verified |
| [`utils/toPublicAuthUser.js`](../utils/toPublicAuthUser.js) | Safe auth response DTO |
| [`utils/cookieHelper.js`](../utils/cookieHelper.js) | Cookie flags from env |
| [`models/User.js`](../models/User.js) | User schema, roles, OTP, `sessionVersion` |

### Vendor onboarding

| File | Why it matters |
|------|----------------|
| [`routes/vendorOnboarding.routes.js`](../routes/vendorOnboarding.routes.js) | Vendor + admin verify routes (mounted twice) |
| [`controllers/vendorOnboarding.controller.js`](../controllers/vendorOnboarding.controller.js) | Draft, submit, profile, verification payment, webhook |
| [`controllers/vendorOnboardingUpload.controller.js`](../controllers/vendorOnboardingUpload.controller.js) | S3 presigned uploads |
| [`controllers/admin/vendorOnboardVerifyStage1.js`](../controllers/admin/vendorOnboardVerifyStage1.js) | Admin queue, verify, finalize |
| [`utils/syncBusinessFromOnboarding.js`](../utils/syncBusinessFromOnboarding.js) | Creates/updates `Business` after approval |
| [`utils/vendorOnboardingProfileFields.js`](../utils/vendorOnboardingProfileFields.js) | PATCH allowlist for profile fields |
| [`models/VendorOnboardingStage1.js`](../models/VendorOnboardingStage1.js) | Application schema and statuses |
| [`models/Business.js`](../models/Business.js) | Operational vendor record (Connect, subscription) |

### Admin

| File | Why it matters |
|------|----------------|
| [`routes/admin/userRoutes.js`](../routes/admin/userRoutes.js) | `router.use(authenticate, isAdmin)` pattern |
| [`routes/admin/cmsRoutes.js`](../routes/admin/cmsRoutes.js) | CMS (also mounted at `/api/cms`, `/cms`) |
| [`routes/admin/*Category*Routes.js`](../routes/admin/) | Category admin per listing type |
| [`controllers/admin/`](../controllers/admin/) | All admin handlers |
| [`utils/toAdminUser.js`](../utils/toAdminUser.js) | Admin user response DTO |

### Payments and Stripe

| File | Why it matters |
|------|----------------|
| [`controllers/orderController.js`](../controllers/orderController.js) | Order initiate, Connect PaymentIntent |
| [`controllers/paymentController.js`](../controllers/paymentController.js) | Standalone payment intent |
| [`controllers/connectController.js`](../controllers/connectController.js) | Stripe Connect onboarding |
| [`controllers/stripe.controller.js`](../controllers/stripe.controller.js) | Connect dashboard sessions |
| [`controllers/stripeController.js`](../controllers/stripeController.js) | Business draft checkout webhook |
| [`controllers/stripePaymentController.js`](../controllers/stripePaymentController.js) | Post-payment order emails webhook |
| [`controllers/webhookController.js`](../controllers/webhookController.js) | Order status + subscription webhooks |
| [`controllers/billing.controller.js`](../controllers/billing.controller.js) | Billing portal session |
| [`helpers/stripePlan.js`](../helpers/stripePlan.js) | Sync `SubscriptionPlan` to Stripe product/price |
| [`models/Order.js`](../models/Order.js) | Order + payment fields |
| [`models/Subscription.js`](../models/Subscription.js) | Subscription state |

### Tests (mirror these when adding coverage)

| Path | Covers |
|------|--------|
| [`tests/auth/`](../tests/auth/) | JWT payload, OAuth security, password reset |
| [`tests/admin/`](../tests/admin/) | Admin DTO, pending applications |
| [`tests/vendor/`](../tests/vendor/) | Field allowlist, verified vendor, uploads, sync |
| [`tests/stripe/`](../tests/stripe/) | Webhook routing and signature |

---

## Safe edit rules

1. **Read before write** — Open the route file, controller, model, and any existing test for the area you are changing.
2. **Follow the layer pattern** — `routes/` → `middlewares/` → `controllers/` → `models/`. Do not put business logic in route files.
3. **Match existing conventions** — Same naming, error response shapes, and middleware patterns as neighboring code.
4. **Minimal diff** — Fix only what the task requires. No drive-by refactors, formatting sweeps, or unrelated file edits.
5. **Register new routes in `app.js`** — Every new router needs an `app.use(prefix, router)` mount.
6. **Webhook changes need raw body** — Stripe webhooks must mount with `express.raw()` **before** `express.json()` in `app.js`.
7. **Use env var names from `.env.example`** — Never hardcode secrets. Local dev uses `.env` (not `.env.local`).
8. **Auth checks use `req.user` from DB** — Role gates read `req.user.role`, not raw JWT claims. Use `toPublicAuthUser` / `toAdminUser` for responses.
9. **Run tests** — `npm test` after auth, vendor, admin, or webhook changes.
10. **Documentation-only tasks** — Must not change runtime behavior.

---

## Files that should not be changed casually

| File / area | Risk if changed without care |
|-------------|------------------------------|
| [`app.js`](../app.js) | Breaks routing, CORS, or webhook body parsing order |
| [`middlewares/authenticate.js`](../middlewares/authenticate.js) | Breaks all protected routes |
| [`middlewares/requireVerifiedVendor.js`](../middlewares/requireVerifiedVendor.js) | Vendor access control regression |
| [`controllers/webhookController.js`](../controllers/webhookController.js) | Payment/subscription state desync |
| [`controllers/vendorOnboarding.controller.js`](../controllers/vendorOnboarding.controller.js) `handleVendorPaymentWebhook` | Verification payment state desync |
| [`controllers/orderController.js`](../controllers/orderController.js) | Order/payment/Connect money flow |
| [`utils/syncBusinessFromOnboarding.js`](../utils/syncBusinessFromOnboarding.js) | Vendor approval → business creation |
| [`models/User.js`](../models/User.js), [`models/Order.js`](../models/Order.js), [`models/Business.js`](../models/Business.js) | Schema migrations affect all consumers |
| [`.env`](../.env), [`.env.local`](../.env.local) | **Never commit**; never paste values into docs |
| [`routes/cms/cmsRoutes.js`](../routes/cms/cmsRoutes.js) | Unmounted dead file — do not wire up without explicit task |
| Root debug scripts (`fix-product-data.js`, `debug-data.js`, etc.) | One-off maintenance; not part of runtime API |

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
- **Roles:** `customer`, `business_owner`, `admin` — checked on `req.user.role`, not JWT claims.
- **No global auth** — Each route applies `authenticate` and role gates explicitly.

**Deep dive:** [auth.md](auth.md)

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

**Statuses that matter:** `draft`, `submitted`, `verified`, `rejected`, `payment_pending`. Admin queue shows only `submitted`.

**Gates:** `requireVerifiedVendor` middleware blocks unverified vendors from sensitive routes.

**Deep dive:** [business-sync.md](business-sync.md), [vendor-field-protection.md](vendor-field-protection.md), [admin-pending-applications-statuses.md](admin-pending-applications-statuses.md)

---

## Admin review — high level

```
GET  pending applications  → status allowlist: submitted only
GET  application details   → full VendorOnboardingStage1 for review
POST verifyAndAllocatePoints → admin marks checklist, allocates points
POST finalizeVerification  → status verified → syncBusinessFromOnboarding → Business
```

- Admin routes use `router.use(authenticate, isAdmin)` at the router level.
- Vendor onboarding admin endpoints share [`vendorOnboarding.routes.js`](../routes/vendorOnboarding.routes.js) mounted at `/admin/vendor-onboard-verify-stage1`.
- Approved applications persist as `verified` (not `approved`).

**Deep dive:** [admin-read-mutation.md](admin-read-mutation.md)

---

## Stripe / webhooks — how they are organized

**Five endpoints, five secrets.** Each maps to one env var. All mount in `app.js` with `express.raw()` before `express.json()`.

| Route | Env secret | Handler | Updates |
|-------|------------|---------|---------|
| `POST /api/webhooks/stripe` | `STRIPE_ORDER_WEBHOOK_SECRET` | `webhookController.handleStripeWebhook` | `Order` payment status |
| `POST /api/stripe/webhook` | `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET` | `stripeController.handleStripeWebhook` | `Business`, `Subscription`, `BusinessDraft` |
| `POST /api/stripe/payment/webhook` | `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET` | `stripePaymentController.stripePaymentWebhook` | `Order` + emails |
| `POST /api/subscription/webhook` | `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | `webhookController.handleSubscriptionWebhook` | `Subscription` |
| `POST /api/vendor-onboarding/webhook/payment` | `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET` | `vendorOnboarding.controller.handleVendorPaymentWebhook` | `VendorOnboardingStage1` |

**Connect payouts:** `Business.stripeConnectAccountId` set via [`connectController.js`](../controllers/connectController.js); orders use `transfer_data.destination` in PaymentIntents.

**Deep dive:** [stripe-webhook-registration.md](stripe-webhook-registration.md)

---

## Deployment docs — how they are organized

| Doc | Use when |
|-----|----------|
| [SETUP.md](../SETUP.md) | Local dev bootstrap, `.env` setup |
| [STAGING.md](../STAGING.md) | Pre-merge integration on `staging` branch |
| [DEPLOYMENT.md](../DEPLOYMENT.md) | Production EB deploy, rollback, roles |
| [production-env-checklist.md](production-env-checklist.md) | EB env var audit before deploy |
| [production-smoke-checklist.md](production-smoke-checklist.md) | Post-deploy smoke tiers P0–P6 |
| [deploy-verification.md](deploy-verification.md) | Deploy verification log |
| [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) | MVP sprint hub — prod SHA, PRs, roadmap |
| [hosted-staging-decision.md](hosted-staging-decision.md) | No hosted staging backend (deferred) |
| [launch-readiness-report.md](launch-readiness-report.md) | Full route audit and blockers |

**Branch flow:** `feature/*` → `staging` → PR → `main` → manual AWS EB deploy. No CI auto-deploy in this repo.

---

## Testing commands

| Command | What it does |
|---------|--------------|
| `npm install` | Install dependencies |
| `npm run dev` | Start with nodemon (port 3001 default) |
| `npm start` | Production-style start |
| `npm test` | Run all tests: `node --test tests/**/*.test.js` (**123** cases on PR #40 branch; **107** on production lineage — see [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md)) |
| `node scripts/verify-auth-check-smoke.js` | Manual auth smoke against local/prod API |

**When to run tests:**

- Auth, session, or OAuth changes → `tests/auth/`
- Admin user or pending applications → `tests/admin/`
- Vendor onboarding, field allowlist, verified vendor → `tests/vendor/`
- Webhook mount order or signature → `tests/stripe/`

**Local env note:** App reads `.env`, not `.env.local`. See [SETUP.md](../SETUP.md).

---

## Evidence / proof-pack expectations

Production releases require documented evidence. Do not mark launch or deploy items complete without proof.

| Artifact | Purpose |
|----------|---------|
| [production-proof-pack-template.md](production-proof-pack-template.md) | Copy per release; fill metadata, smoke matrix, rollback SHA |
| [production-smoke-checklist.md](production-smoke-checklist.md) | P0–P6 checks (infra, auth, vendor, admin, Stripe, Connect, public API) |
| [wave2-auth-verification-evidence.md](wave2-auth-verification-evidence.md) | Example auth sign-off |
| [wave2-stripe-webhook-verification-evidence.md](wave2-stripe-webhook-verification-evidence.md) | Example webhook sign-off |
| [integration-gate-asana-evidence.md](integration-gate-asana-evidence.md) | Integration gate records |

**Minimum pre-merge evidence (typical):**

- `npm test` pass count recorded
- Local health probe `GET /` → 200
- Relevant domain tests added or updated for the change
- For deploys: smoke matrix rows marked PASS/FAIL/PENDING with notes — not blank checkmarks

**Never include in evidence:** API keys, webhook secrets, JWTs, passwords, or full `.env` contents. Redact screenshots.

---

## Rules for AI/Cursor/OpenClaw agents

- Do not use `git add .`
- Do not mix unrelated changes
- One PR per logical change
- No broad refactors without approval
- No secrets in docs, logs, screenshots, or comments
- Do not mark launch items complete without evidence
- Documentation-only issues must not change runtime behavior

---

## Quick lookup — "I need to change X"

| Task | Start here |
|------|------------|
| Any unfamiliar area | [ARCHITECTURE.md](ARCHITECTURE.md), [API_SURFACE.md](API_SURFACE.md) |
| Login / JWT / OAuth | `routes/userRoutes.js`, `middlewares/authenticate.js`, [auth.md](auth.md) |
| Vendor onboarding | `controllers/vendorOnboarding.controller.js`, `models/VendorOnboardingStage1.js` |
| Admin vendor approval | `controllers/admin/vendorOnboardVerifyStage1.js` |
| Orders / checkout | `controllers/orderController.js`, `models/Order.js` |
| Stripe webhook | `app.js` mount order first, then handler + [stripe-webhook-registration.md](stripe-webhook-registration.md) |
| New API endpoint | route → controller → model → `app.js` mount → test |
| Deploy / release | [DEPLOYMENT.md](../DEPLOYMENT.md), [production-proof-pack-template.md](production-proof-pack-template.md) |
