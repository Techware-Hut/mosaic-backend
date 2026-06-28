# Mosaic Biz Hub — Launch Readiness Repo Reality Report

**Audit date:** 2026-06-07  
**Repos inspected (read-only):**
- Backend: `mosaic-backend` (DeveloperTWH/backend)
- Frontend: `mosaic-biz-frontend` (DeveloperTWH/mosaic-biz-frontend)

> **Historical snapshot:** This report captures the repo state on 2026-06-07. Do not use it as current truth for CI, deploy workflow, sanitizer wiring, Sentry, or test counts. Current truth lives in [README.md](../README.md), [docs/README.md](README.md), [TEST_MATRIX.md](TEST_MATRIX.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [BACKEND_ARCHITECTURE_MAP.md](BACKEND_ARCHITECTURE_MAP.md).

**Production context at audit time:** API live at `https://api.mosaicbizhub.com`; EB hostname `mosaic-backend.us-east-1.elasticbeanstalk.com`; hosted staging and CI workflows were absent in the audit snapshot.

**Related operational docs:**
- [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) — current MVP sprint state (supersedes this report for live deploy/issue status)
- [production-env-checklist.md](production-env-checklist.md)
- [stripe-webhook-registration.md](stripe-webhook-registration.md)
- [production-smoke-checklist.md](production-smoke-checklist.md)
- [production-proof-pack-template.md](production-proof-pack-template.md)

---

## 1. Backend route map

Entry: `index.js` → `app.js` (default port `3001`).

| Route group | Prefix | What it supports |
|-------------|--------|------------------|
| **Health** | `GET /` | Liveness JSON |
| **Auth** | `/api/auth` | Google OAuth start/callback/complete |
| **Users** | `/api/users` | Register, login, logout, OTP verify/resend, forgot/reset password, session check |
| **Vendor onboarding** | `/api/vendor-onboarding` (+ duplicate mount `/admin/vendor-onboard-verify-stage1`) | Stage-1 draft, doc upload URLs, $24.99 verification PI, submit, status, business-profile patch; admin pending/verify/finalize |
| **Business** | `/api/business` | Create (legacy PayPal path), draft for Stripe checkout, CRUD, shipping/tax, public slug listing |
| **Business profile** | `/api/business-profile` | Stage-3 survey save/submit, step-4 survey |
| **Subscriptions** | `/api/subscription-plans`, `/api/subscriptions`, `/api/billing-portal/session` | Plan CRUD (admin), subscribe/cancel/resume, billing portal |
| **Stripe checkout** | `/api/stripe` | Business-draft Checkout session + business-draft webhook + post-payment order email webhook |
| **Stripe Connect (legacy mount)** | `/stripe` | Account session, express login, balance, payout, backfill — **several routes have no auth middleware** |
| **Connect** | `/api/connect` | Account link, status, return/refresh redirects |
| **Marketplace public** | `/api` via `publicListing.js` | Products/services/food lists, filters, unified search, ranked/similar, vendor public profiles |
| **Marketplace private** | `/api/private` | Owner-only listing views |
| **Catalog CRUD** | `/api/product`, `/api/service`, `/api/food` | Vendor CRUD, variants, stock, S3 presigns, reviews |
| **Categories** | `/api`, `/api/admin/category/*` | Public trees; admin CRUD; vendor category requests |
| **Cart / wishlist** | `/api/cart`, `/api/wishlist` | Server-side cart merge/count; wishlist by variant |
| **Orders / payments** | `/api/orders`, `/api/payments` | Initiate order + Connect PI, lifecycle, invoice PDF, admin list; **`POST /api/payments/create-payment-intent` is unauthenticated** |
| **Bookings** | `/api/bookings` | Service/food booking lifecycle |
| **Discounts** | `/api/discounts` | Coupon validate/apply; owner CRUD |
| **CMS / content** | `/api/cms` and `/cms` (duplicate mount) | Public pages + admin CRUD, how-it-works |
| **Admin content** | `/admin/faqs`, `/admin/api/blogs`, `/api/admin/testimonials` | FAQ/blog/testimonial admin APIs |
| **Admin ops** | `/admin/users`, `/admin/api/business`, `/admin/api/products`, `/admin/business-profile-verify` | Users, business approval, featured products, profile verification |
| **Misc** | `/api/contact-inquiry`, `/api/enquiries`, `/api/google-places`, `/api/minority-types`, `/api/featured-products`, `/api/upload-image` | Contact form, enquiry reveal, Places autocomplete, minority types, featured products, Cloudinary tracker |

**Orphans / quirks:**
- `routes/cms/cmsRoutes.js` exists but is **not mounted** in `app.js`.
- Vendor onboarding routes mounted twice.
- CMS routes mounted at both `/api/cms` and `/cms`.
- `express-mongo-sanitize` and `xss-clean` are **imported but never `app.use()`'d** despite README claiming they are configured.

---

## 2. Frontend route / page map and journeys

**Stack:** Next.js 16 App Router, React 19, Tailwind + MUI, Zustand, Stripe Elements/Connect. ~93 `page.tsx` files.

| Journey | Key routes | Backend APIs consumed |
|---------|------------|----------------------|
| **Public browse** | `/`, `/products`, `/services`, `/foods`, `/search`, `/vendors/*`, vendor storefronts | `/api/products/list`, `/api/services/list`, `/api/public/search`, `/api/ranked` |
| **Customer auth** | `/login`, `/signup`, `/verify-otp`, `/forgot-password` | `/api/users/*` |
| **Customer shop** | `/product/[id]` → `/cart` → `/checkout/payment` → `/payment-success` → `/customer/order` | `/api/cart`, `/api/orders/initiate`, Stripe client-side confirm |
| **Customer bookings** | `/customer/bookings` | `/api/bookings` |
| **Become a vendor** | `/become-a-vendor` → `/signup?type=vendor` → `/partners` | Registration + onboarding APIs |
| **Vendor onboarding (6 stages)** | `/partners` hub and stage routes | See section 3 |
| **Vendor ops (post-setup)** | `/partners/dashboard`, `/partners/[businessid]/*` | Business, product, order, connect APIs |
| **Admin** | `/signin` → `/admin` + 14 sub-pages | Admin + shared APIs (see section 5) |

**UI gaps:**
- Grocery/food cart checkout shows “coming soon” stub.
- Admin sidebar links to `/admin/blog` and `/admin/faq` but **no pages exist** (Blog/FAQ admin UIs missing; public `/faq` page exists).
- `README.md` is still create-next-app boilerplate.

---

## 3. Vendor onboarding flow

| Step | Status | Notes |
|------|--------|-------|
| Account + OTP | Implemented | Admin role blocked on public register |
| Stage 1 docs + $24.99 payment | Implemented | Webhook sets `verificationPayment.status=paid` |
| Stage 1 submit validation | **Weak** | `validateStage1Payload` only enforces business name; EIN/SSN, license, address, terms checks are commented out |
| Admin Stage 1 review | Implemented | verify + finalize + badge/points |
| Tier / subscription | Implemented (dual paths) | Stripe Checkout webhook **or** direct `/api/subscriptions/create` |
| Business profile survey | Implemented (dual models) | Parallel paths: onboarding doc + `BusinessProfile` + admin `/admin/business-profile-verify` |
| Connect payout | Implemented | Required before customer checkout |
| Admin business approval | Implemented | Requires `onboardingStatus === 'completed'` |
| Listing activation | Partially gated | Products default `isPublished: false`; public filters require approved active business |

**Risks:** Business auto-created with `isActive: true` while `isApproved: false`; legacy `POST /api/business` trusts client `paymentStatus`; dual onboarding paths increase drift risk.

---

## 4. Customer shopping flow

| Step | Implemented | Gap |
|------|-------------|-----|
| Browse / search | Yes | Public listing filters `isPublished` + approved business |
| Wishlist | Yes (toggle on PDP) | No dedicated wishlist page |
| Cart + discounts | Yes (products) | Food/grocery checkout stub on frontend |
| Checkout | Yes | Single-vendor orders only |
| Payment | Yes (Connect PI) | Legacy unauthenticated `/api/payments/create-payment-intent` still exposed |
| Order confirmation | Yes | `/payment-success` retrieves intent |
| Email | Partially correct | **Placed-order emails fire on `initiateOrder` before payment succeeds** |
| Post-order lifecycle | Yes | Vendor accept/ship/deliver; customer cancel/return; invoice PDF |

---

## 5. Admin flow

**Backend:** Users, vendor Stage 1, business approval, business profile verify, products (featured), orders, subscription plans, categories, category requests, CMS, FAQs, blogs, testimonials.

**Frontend pages:** `/admin`, `/admin/businesses`, `/admin/products`, `/admin/vendor-applications`, `/admin/orders`, `/admin/users`, `/admin/subscription`, `/admin/categories-management`, `/admin/category-requests`, `/admin/cms`, `/admin/testimonials`.

**Missing frontend:** Blog admin (`/admin/blog`), FAQ admin (`/admin/faq`) — sidebar links 404.

---

## 6. Environment variables

See [production-env-checklist.md](production-env-checklist.md) for production EB checklist and [SETUP.md](../SETUP.md) for local setup.

**Backend local gotcha:** App loads `.env` only (`index.js`); `.env.local` is ignored. Windows + Node 24 can fail Atlas `mongodb+srv://` SRV DNS while `nslookup` works.

**Frontend:** No `.env.example` in repo at audit time. Required: `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_CLIENT_BASE_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `JWT_SECRET` (server).

---

## 7. Tests, build, lint

| Repo | `npm test` | `npm run build` | `npm run lint` | CI |
|------|------------|-----------------|----------------|-----|
| **Backend** | **57-test audit snapshot** via Node built-in runner (`node --test tests/**/*.test.js`); mock-based | N/A | Not defined | None |
| **Frontend** | Not defined | Defined | Defined | None |

**Verdict:** Backend has local automated tests (see [TEST_MATRIX.md](TEST_MATRIX.md)) but **no CI pipeline** and no lint gate; tests do not exercise live MongoDB, Stripe, or AWS.

---

## 8. Documentation mismatches

| Source | Says | Reality |
|--------|------|---------|
| Backend README architecture | Mongo sanitization + XSS configured | Imports only in `app.js`, **not mounted** — README corrected in doc pass |
| Backend README / SETUP | Google integrations optional | **Server crashes** if Google env missing |
| Backend `.env.example` | Legacy Stripe secret names | Code uses `STRIPE_*_WEBHOOK_SECRET` names from README |
| Backend doc links | Absolute paths to `C:/Users/Asus/OneDrive/...` | Broken on other machines — **fixed in this doc pass** |
| DEPLOYMENT smoke | EB raw hostname | Production HTTPS smoke should use `https://api.mosaicbizhub.com` |
| Frontend README | Generic Next.js starter | Real app uses different env var names and route structure |

---

## 9. Launch classification

### P0 launch blockers

1. CI pipeline absent in the audit snapshot (local `npm test` existed; see current [TEST_MATRIX.md](TEST_MATRIX.md) for today's commands and coverage)
2. Security middleware not wired (`mongoSanitize` / `xss-clean`)
3. Unauthenticated payment/order attack surface
4. Order emails before payment
5. Legacy business create trusts client `paymentStatus`
6. Vendor Stage 1 validation mostly disabled
7. Product tier limits not enforced on initial product create
8. Dual/conflicting vendor paths
9. Five Stripe webhooks must all be registered with correct secrets
10. Google OAuth env hard-required at boot
11. No hosted staging — production is first integrated environment
12. Frontend admin Blog/FAQ dead links
13. `backend27may.zip` committed on `main`/`staging`

### Verification needed

Full vendor journey, customer checkout with webhook proof, all 5 Stripe webhooks, S3/mail/cookie cross-domain behavior, frontend build on deploy host. See [production-smoke-checklist.md](production-smoke-checklist.md).

### Phase 2

Jest/Vitest + CI, hosted staging, security hardening, admin Blog/FAQ UI, frontend `.env.example`, remove zip artifacts, grocery checkout, dependency audit.

---

## Bottom line

Both repos implement a **broad MVP surface**, but **launch readiness is blocked** by missing CI regression gates, open security findings, email/payment ordering bugs, weak onboarding validation, env/doc drift, and absence of a staging environment for integrated verification.
