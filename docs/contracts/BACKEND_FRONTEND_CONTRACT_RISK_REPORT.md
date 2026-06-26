# Backend Frontend Contract Risk Report

**Type:** Launch readiness audit evidence  
**Generated:** 2026-06-24  
**Branch:** `audit/backend-frontend-contract-integrity`  
**Baseline:** `main` + merged `fix/backend-vendor-child-service-delete` (PR #124)  
**Companion:** [`BACKEND_ROUTE_MANIFEST.md`](./BACKEND_ROUTE_MANIFEST.md)  
**Production API host:** `https://api.mosaicbizhub.com`

---

## Executive summary

Static audit of **309 registered route rows** (52 mount registrations, including duplicate mounts) found **no missing Stripe raw-body webhook ordering issues** and **confirmed payment-intent is authenticated in code** — but several **documentation files still describe it as unauthenticated**, which is a launch-risk for QA and frontend guards.

Top contract risks for frontend integration:

1. **P0 — Discount mutations lack business ownership checks** despite `isBusinessOwner` middleware (IDOR by discount id).
2. **P1 — Service deletion has two incompatible DELETE semantics** (`delete-service/:id` = whole parent; `/:parentId/child-services/:childId` = embedded child). Frontend sending child ids to the parent route returns 404.
3. **P1 — Stripe legacy checkout session** may start checkout for any `draftId` without verifying draft ownership.
4. **P2 — Public onboarding status** exposes application metadata and PII by `applicationId` without auth.
5. **P2 — Response envelope inconsistency** across delete mutations (`{ message }` vs `{ success, data }`).

**Doc drift:** [`docs/API_SURFACE.md`](../API_SURFACE.md) is stale on payment-intent auth and omits the new child-service DELETE route. [`docs/MVP_BACKEND_API_AUDIT.md`](../MVP_BACKEND_API_AUDIT.md) and [`docs/launch-readiness-report.md`](../launch-readiness-report.md) contain outdated claims that `/stripe/*` and payment-intent are unauthenticated.

---

## Registered route count

| Metric | Value |
| --- | --- |
| Total manifest rows | **309** |
| Unique mount registrations | **52** |
| Router files on disk | **51** |
| Unmounted router files | **1** (`routes/cms/cmsRoutes.js`) |
| Inline `app.js` handlers | **3** (`GET /`, vendor onboarding payment webhook, subscription webhook) |

---

## Mount prefixes (registration order)

See full table in [`BACKEND_ROUTE_MANIFEST.md`](./BACKEND_ROUTE_MANIFEST.md#mount-prefix-registry-registration-order).

Notable dual mounts:

| Router file | Mount prefixes |
| --- | --- |
| `vendorOnboarding.routes.js` | `/api/vendor-onboarding`, `/admin/vendor-onboard-verify-stage1` |
| `admin/cmsRoutes.js` | `/api/cms`, `/cms` |
| `admin/businessRoutes.js` | `/admin/api/business`, `/api/admin/business` |
| Shared `/api` prefix | `healthRoutes`, `publicListing`, `uploadImage`, `categoryRoutes`, `subcategoryRoutes`, `api.routes`, `featuredProductRoutes` |

---

## Duplicate routes

| ID | Description | Evidence |
| --- | --- | --- |
| DUP-01 | CMS admin/public routes registered at both `/api/cms/*` and `/cms/*` | `app.js:174,179` |
| DUP-02 | Admin business routes at `/admin/api/business` and `/api/admin/business` | `app.js:187-188` |
| DUP-03 | Vendor onboarding router mounted twice with different prefixes | `app.js:163-164` |
| DUP-04 | Legacy alias `GET /api/getProductCategories` duplicates `GET /api/categories/products` | `categoryRoutes.js:21,26` |
| DUP-05 | Featured products canonical: `GET /api/featured-products` only — `/api/products/featured` **not registered** (correct) | `featuredProductRoutes.js`, contract tests |

---

## Unmounted routers

| File | Status |
| --- | --- |
| `routes/cms/cmsRoutes.js` | Not referenced in `app.js`. Active CMS is `routes/admin/cmsRoutes.js`. Dead file references `getHowItWorks` without import — do not mount without repair. |

---

## Dynamic route-order risks

| ID | Router | Risk | Current status |
| --- | --- | --- | --- |
| RO-01 | `serviceRoutes.js` | `/:id` could shadow named routes | **Safe** — static paths (`/delete-service/:id`, `/child-services/...`, `/my-services`) registered before `/:id` |
| RO-02 | `vendorOnboarding.routes.js` | Admin `GET /:applicationId` vs public `GET /status/:applicationId` | **Safe on vendor mount** — `/status/...` is static. On `/admin/vendor-onboard-verify-stage1`, admin routes use `authenticate,isAdmin` |
| RO-03 | `orderRoutes.js` | `GET /vendor` vs `GET /:id/invoice.pdf` | **Safe** — `/vendor` registered before param route |
| RO-04 | `productRoutes.js` | Variant routes vs `/:id` | **Verify** — delete-variant uses explicit prefix `/delete-variant/:productId/:variantId` |

---

## Routes missing authentication (route level)

| Route | Method | Notes |
| --- | --- | --- |
| `GET /api/vendor-onboarding/status/:applicationId` | GET | Intentionally public polling |
| `POST /api/discounts/validate` | POST | Public coupon validation |
| `POST /api/discounts/apply` | POST | Public apply |
| Most public marketplace GETs | GET | By design |
| Stripe webhooks | POST | Signature-only (no JWT) |

**Corrected finding:** `POST /api/payments/create-payment-intent` **has** `authenticate` + `isCustomer` in [`paymentRoutes.js`](../routes/paymentRoutes.js). [`docs/API_SURFACE.md`](../API_SURFACE.md) line ~348 still marks it ⚪ No auth — **documentation drift**.

**Corrected finding:** `/stripe/*` dashboard routes in [`stripe.routes.js`](../routes/stripe.routes.js) **require** `authenticate` + `isBusinessOwner`. Older audits claiming unauthenticated `/stripe/*` are stale.

---

## Routes missing role checks

| Route | Gap |
| --- | --- |
| `GET /api/discounts/:id` | `authenticate` only — any logged-in role can read any discount by id |
| `GET /api/service/business-service/:id` | Public — verify publication filter in controller |
| `GET /api/food/business-food/:id` | Public — same |

---

## Routes missing ownership checks (controller level)

| Area | Middleware | Controller gap |
| --- | --- | --- |
| Discounts CRUD | `isBusinessOwner` on mutating routes | No verify that `businessId` or discount belongs to `req.user` |
| Stripe checkout session | `isBusinessOwner` | `createCheckoutSession` loads draft by id without owner match |
| `addChildServices` | `isBusinessOwner` | Allows business-owner fallback via populated `businessId.owner` (403 not 404) — differs from strict `deleteChildService` |

---

## Identifier ambiguities

| Domain | Parent ID | Child/nested ID | Routes |
| --- | --- | --- | --- |
| **Service** | `Service._id` | `services[]._id` (embedded) | `DELETE /api/service/delete-service/:id` deletes **parent**; `DELETE /api/service/:parentServiceId/child-services/:childServiceId` deletes **child** |
| **Product** | `Product._id` | `ProductVariant._id` (collection) | `DELETE /api/product/delete-product/:productId` vs `DELETE /api/product/delete-variant/:productId/:variantId` |
| **Food** | `Food._id` | menu items embedded | Single `DELETE /api/food/delete-food/:id` on listing |
| **Order** | `Order._id` | line items embedded | Vendor actions use `vendorId: req.user._id` |
| **Onboarding** | Mongo `_id` | `applicationId` string (`MBH-*`) | Public status uses **applicationId**, not Mongo id |
| **Reviews** | listing id | `reviewId` | Nested under `/:serviceId/reviews/:reviewId` etc. |

---

## Nested-resource gaps

| Gap | Status |
| --- | --- |
| Child service delete without deleting parent | **Addressed** on audit baseline — `DELETE /api/service/:parentServiceId/child-services/:childServiceId` |
| Parent service delete still removes entire document | **By design** — `DELETE /api/service/delete-service/:id` |
| Product variant vs product delete | Separate explicit routes — frontend must not swap ids |
| Food menu item delete | No dedicated nested delete route found — updates likely via PUT replacing menu array |

---

## Method and payload inconsistencies

| Issue | Detail |
| --- | --- |
| Order vendor actions | `PUT /api/orders/accept/:orderId` pattern (action in path) vs REST noun-only |
| Service routes | Mix of `/delete-service/:id` prefix vs REST nested child path |
| Product routes | `/delete-product/:productId` vs `/delete-variant/:productId/:variantId` |
| Featured products | Canonical `GET /api/featured-products` — not `/api/products/featured` |

---

## Response-envelope inconsistencies

| Pattern | Example endpoints |
| --- | --- |
| `{ success, data, publication? }` | Service create/update, child delete |
| `{ message }` only | `deleteService`, `deleteFood`, delete product |
| `{ success: true, message }` | delete variant, child delete (also includes `data`) |
| `{ clientSecret, amount, currency }` | payment intent — no `success` flag |
| `{ error }` / `{ message }` | 404/500 legacy errors |
| Order vendor fulfillment | `{ success, message, order }` |

Frontend code treating `{ message }` as success without checking HTTP status or `success` flag risks false-positive UX.

---

## Destructive-route risks

All DELETE routes are listed in the manifest with `Destructive=yes`. Highest-impact:

- Service parent delete vs child delete (see BE-CR-002)
- Product soft-delete vs food hard-delete asymmetry
- Admin user soft-delete, CMS slug delete
- Cart line removal (non-destructive to listing but mutates checkout state)

---

## Payment and webhook risks

| Surface | Auth | Notes |
| --- | --- | --- |
| Raw webhooks before `express.json` | Stripe signature | Preserved in `app.js:124-133`, `stripeRoutes.js:8-9` |
| `POST /api/orders/initiate` | customer | Canonical marketplace checkout |
| `POST /api/payments/create-payment-intent` | customer + order ownership | Legacy; guarded in code |
| `POST /api/stripe/create-checkout-session` | business_owner | Draft ownership gap (BE-CR-005) |
| `/stripe/account-session` etc. | business_owner | Connect ownership asserted in controller |

Environment variable names involved (values not listed): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `JWT_SECRET`, `MONGODB_URI`, `CORS_ORIGINS`, `FRONTEND_URL`, `AWS_*`, `SENTRY_DSN`.

---

## Documentation drift

| Document | Drift |
| --- | --- |
| [`API_SURFACE.md`](../API_SURFACE.md) | Payment-intent marked unauthenticated; child-service DELETE not listed |
| [`MVP_BACKEND_API_AUDIT.md`](../MVP_BACKEND_API_AUDIT.md) | Claims unauthenticated payment-intent and `/stripe/*` |
| [`launch-readiness-report.md`](../launch-readiness-report.md) | Same stale payment claims |
| [`PRODUCTION_RUNBOOK.md`](../PRODUCTION_RUNBOOK.md) | P0-7 references unauthenticated payment-intent |
| [`BACKEND_ROUTE_REGISTRATION.md`](../backend/BACKEND_ROUTE_REGISTRATION.md) | Archived 2026-06-19; payment-intent correctly shows JWT+customer |
| [`BACKEND_FRONTEND_ROUTE_CONTRACT.md`](../BACKEND_FRONTEND_ROUTE_CONTRACT.md) | Mostly aligned; predates child delete route |
| [`API_CONTRACT_AS_BUILT.md`](../backend/API_CONTRACT_AS_BUILT.md) | Partial; cross-check per route in manifest |

---

## Missing contract and integration tests

| Gap | Recommendation |
| --- | --- |
| Child service delete | Covered by `tests/integration/service-child-delete.integration.test.js` (on audit baseline) |
| Discount ownership IDOR | No integration test proving cross-vendor discount mutation fails |
| Admin `GET /api/admin/categories` | `tests/admin/admin-categories-guard.test.js` verifies `authenticate` + `isAdmin` |
| Stripe checkout draft ownership | No test for cross-user draft checkout |
| Route registration completeness | `tests/launch/backend-launch-contract.test.js` covers mounts, not every route |
| Full route manifest sync | No CI check that `API_SURFACE.md` row count matches code |

---

## Runtime evidence required

Cannot be proven from static analysis alone:

- Live responses at `https://api.mosaicbizhub.com` for each workflow
- Frontend caller inventory (`Digital-Builders-757/mosaic-biz-frontend-launch`)
- Real Stripe webhook signature validation under load
- CORS + cookie behavior across production origins
- S3 presigned upload/delete side effects
- EB environment variable values (names only listed above)

---

## Classified findings

### BE-CR-001 — Discount IDOR on mutate/read

| Field | Value |
| --- | --- |
| **Severity** | **P0** |
| **Classification** | Authorization / data integrity |
| **Full route** | `PUT /api/discounts/:id`, `DELETE /api/discounts/:id`, `GET /api/discounts/:id`, `POST /api/discounts/` |
| **Method** | PUT, DELETE, GET, POST |
| **Router / controller** | `routes/discounts.js` → `discountController` |
| **Middleware** | `isBusinessOwner` on mutators; GET `/:id` authenticate only |
| **Expected role** | business_owner scoped to own business |
| **Identifier semantics** | `:id` = discount Mongo id; body/query `businessId` not verified against owner |
| **Request contract** | POST body includes `businessId`; PUT accepts fields without ownership |
| **Response contract** | `{ success, data/message }` |
| **Evidence** | `routes/discounts.js:74-101`; `controllers/discountController.js` — no `ownerId`/`business.owner` check on update/delete/get |
| **Likely frontend impact** | Vendor dashboard may appear to work while allowing cross-tenant discount edits if ids are guessed |
| **Owner** | **backend** |
| **Smoke test** | Vendor A creates discount; Vendor B PUT/DELETE same id → expect 404/403; currently may succeed |
| **Next action** | Add business ownership checks in controller; add integration test — **do not implement in this audit branch** |

---

### BE-CR-002 — Service parent delete vs child delete semantics

| Field | Value |
| --- | --- |
| **Severity** | **P1** |
| **Classification** | Identifier mismatch / destructive behavior |
| **Full route** | `DELETE /api/service/delete-service/:id` vs `DELETE /api/service/:parentServiceId/child-services/:childServiceId` |
| **Method** | DELETE |
| **Router / controller** | `serviceRoutes.js` → `deleteService` / `deleteChildService` |
| **Middleware** | authenticate, isBusinessOwner |
| **Expected role** | business_owner |
| **Identifier semantics** | `:id` = parent Service `_id`; child route requires parent + embedded child `_id` |
| **Request contract** | Path params only |
| **Response contract** | Parent delete: `{ message }`; child delete: `{ success, deletedChildServiceId, data: { service, publication } }` |
| **Evidence** | `serviceController.js:657-673`; `serviceChildController.js:14-77` |
| **Likely frontend impact** | Vendor services UI sending child id to `delete-service/:id` → 404; wrong id could delete entire listing |
| **Owner** | **both** (frontend route switch + backend docs) |
| **Smoke test** | Create parent with 2 children; DELETE child via nested route → parent remains; DELETE via delete-service with child id → 404 |
| **Next action** | Frontend must call nested route; keep both endpoints documented — **do not remove parent delete** |

---

### BE-CR-003 — Public onboarding status exposes PII

| Field | Value |
| --- | --- |
| **Severity** | **P1** |
| **Classification** | Data exposure |
| **Full route** | `GET /api/vendor-onboarding/status/:applicationId` |
| **Method** | GET |
| **Router / controller** | `vendorOnboarding.routes.js:46` → `getStatusByApplicationId` |
| **Middleware** | None (public) |
| **Expected role** | Public poll by applicationId |
| **Identifier semantics** | `applicationId` string, not Mongo `_id` |
| **Request contract** | Path param `applicationId` |
| **Response contract** | `{ success, data: { businessName, status, details with email/phone/bio/logo } }` |
| **Evidence** | `vendorOnboarding.controller.js:1268-1391` |
| **Likely frontend impact** | Onboarding UI depends on public poll; risk if applicationId enumerable |
| **Owner** | **backend** (+ product decision) |
| **Smoke test** | GET status with valid applicationId unauthenticated → confirm fields exposed; assess redaction |
| **Next action** | Redact PII from public status or require session ownership — **do not implement in audit branch** |

---

### BE-CR-004 — Public admin categories endpoint

| Field | Value |
| --- | --- |
| **Severity** | **P2** |
| **Classification** | Missing route-level auth |
| **Full route** | `GET /api/admin/categories` |
| **Method** | GET |
| **Router / controller** | `categoryRoutes.js:30` → `getAllCategoriesAdmin` |
| **Middleware** | `authenticate`, `isAdmin` |
| **Expected role** | admin |
| **Identifier semantics** | N/A |
| **Request contract** | None |
| **Response contract** | `{ success, data: { foodCategories, serviceCategories, productCategories } }` |
| **Evidence** | `routes/categoryRoutes.js`, `tests/admin/admin-categories-guard.test.js` |
| **Likely frontend impact** | Admin UI must call with an authenticated admin session; public browse uses `/api/categories/*` |
| **Owner** | **backend** |
| **Smoke test** | Unauthenticated GET returns `401`; non-admin sessions return `403` |
| **Next action** | Resolved in launch hardening pass |

---

### BE-CR-005 — Stripe checkout session draft ownership

| Field | Value |
| --- | --- |
| **Severity** | **P1** |
| **Classification** | Authorization |
| **Full route** | `POST /api/stripe/create-checkout-session` |
| **Method** | POST |
| **Router / controller** | `stripeRoutes.js:12` → `stripeController.createCheckoutSession` |
| **Middleware** | authenticate, isBusinessOwner |
| **Expected role** | business_owner |
| **Identifier semantics** | Body `draftId` — ownership not verified against `req.user` |
| **Request contract** | draft/checkout payload |
| **Response contract** | Stripe session url/id |
| **Evidence** | `stripeController.js:11-19` — loads draft without owner comparison |
| **Likely frontend impact** | Low if draft ids not exposed; high if predictable |
| **Owner** | **backend** |
| **Smoke test** | User A creates draft; User B POST checkout with A's draftId |
| **Next action** | Assert draft.owner === req.user._id — **do not implement in audit branch** |

---

### BE-CR-006 — API_SURFACE stale on payment-intent auth

| Field | Value |
| --- | --- |
| **Severity** | **P2** |
| **Classification** | Documentation drift |
| **Full route** | `POST /api/payments/create-payment-intent` |
| **Method** | POST |
| **Router / controller** | `paymentRoutes.js` → `createPaymentIntent` |
| **Middleware** | authenticate, isCustomer, rateLimit |
| **Evidence** | Code: `paymentRoutes.js:18-28`; Doc: `API_SURFACE.md` ~348 marks ⚪ No auth |
| **Likely frontend impact** | QA may skip auth tests; frontend may duplicate unnecessary guards or miss required credentials |
| **Owner** | **both** (docs + frontend test plans) |
| **Smoke test** | Unauthenticated POST → 401 (per `BACKEND_LAUNCH_BLOCKERS_BATCH_2_PROOF.md`) |
| **Next action** | Update API_SURFACE and stale launch docs — **do not implement in audit branch** |

---

### BE-CR-007 — Delete mutation response envelope mismatch

| Field | Value |
| --- | --- |
| **Severity** | **P2** |
| **Classification** | Response contract |
| **Full route** | Service/product/food delete family |
| **Evidence** | `deleteService` → `{ message }`; `deleteVariant` → `{ success, message }`; `deleteChildService` → full owner DTO |
| **Likely frontend impact** | Shared delete handler may miss `success` on some listings |
| **Owner** | **both** |
| **Smoke test** | Compare DELETE responses across product/service/food |
| **Next action** | Document per-route envelopes in frontend API client — normalize in future API version |

---

### BE-CR-008 — Dual Stripe mount confusion

| Field | Value |
| --- | --- |
| **Severity** | **P2** |
| **Classification** | Route prefix irregularity |
| **Full route** | `/api/stripe/*` vs `/stripe/*` |
| **Evidence** | `app.js:124,228`; different controllers |
| **Likely frontend impact** | Wrong base path → 404 (checkout vs Connect dashboard) |
| **Owner** | **both** |
| **Smoke test** | Verify frontend uses `/stripe/account-session` for Connect and `/api/stripe/create-checkout-session` for subscription checkout |
| **Next action** | Maintain BACKEND_FRONTEND_ROUTE_CONTRACT quick reference |

---

### BE-CR-009 — Child delete route undocumented in API_SURFACE

| Field | Value |
| --- | --- |
| **Severity** | **P2** |
| **Classification** | Documentation drift |
| **Full route** | `DELETE /api/service/:parentServiceId/child-services/:childServiceId` |
| **Evidence** | Registered in `serviceRoutes.js:30-35`; absent from `API_SURFACE.md` |
| **Likely frontend impact** | Frontend/backend teams may miss canonical child delete path |
| **Owner** | **both** |
| **Smoke test** | Integration test in `service-child-delete.integration.test.js` |
| **Next action** | Add row to API_SURFACE after merge |

---

### BE-CR-010 — Duplicate CMS mount

| Field | Value |
| --- | --- |
| **Severity** | **P3** |
| **Classification** | Maintainability |
| **Full route** | `/api/cms/*` and `/cms/*` |
| **Evidence** | `app.js:174,179` |
| **Likely frontend impact** | Either prefix works if CORS/cookies identical |
| **Owner** | **backend** |
| **Next action** | Deprecate one prefix in docs |

---

## Verification appendix

Commands run on audit branch `audit/backend-frontend-contract-integrity`:

| Command | Result |
| --- | --- |
| `npm test` | **345 passed**, 0 failed |
| `npm run test:contract` | **20 passed**, 0 failed |
| `npm run test:integration` | **44 passed**, 0 failed |
| `GET /api/health` (harness) | **200** — `status: ok` |
| `GET /api/ready` (harness) | **200** — `status: ready` |

---

## What was not tested in this audit

- Production/staging live HTTP probes (except planned smoke above)
- Frontend repository call sites
- MongoDB RLS-equivalent data isolation beyond controller reads
- Rate limit thresholds under abuse
- Webhook replay/idempotency at scale
- Admin category public exposure business impact assessment with security team

---

## Recommended next actions (audit-only — do not implement here)

1. Merge PR #124 (child delete) before frontend switches delete calls.
2. Fix discount ownership (P0) in a dedicated security PR.
3. Refresh `API_SURFACE.md` payment-intent and child-delete rows.
4. Frontend audit (`Digital-Builders-757/mosaic-biz-frontend-launch`) to map callers to manifest rows.
5. Add integration tests for discount IDOR and checkout draft ownership.
