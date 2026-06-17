# Decision Register

Business and technical decisions for Mosaic Biz Hub backend MVP. Captures what is decided, what is deferred, and what blocks launch — so future work does not rely on chat history.

**Last aligned with repo docs:** 2026-06 (scan `docs/`, `DEPLOYMENT.md`, launch-readiness report, controllers).

**How to use:** Add a row when a decision changes. Link evidence (doc, proof pack, PR). Do not mark **Accepted** without recorded evidence.

---

## Release and infrastructure

| Decision | Status | Reason | Owner | Evidence/Link |
| --- | --- | --- | --- | --- |
| Hosted staging backend is **deferred**; not part of MVP release strategy | **Accepted** | Avoid duplicate Stripe/Mongo/S3/mail config cost; production API already live; branch-level `staging` provides review gate | Release owner + infra owner | [hosted-staging-decision.md](hosted-staging-decision.md), [STAGING.md](../STAGING.md) |
| `staging` branch is **integration-only** (no deploy target) | **Accepted** | PR review + local boot; runtime smoke runs post-prod deploy | Backend engineer | [STAGING.md](../STAGING.md) |
| Production release path: `feature/*` → PR → `staging` → PR → `main` → **manual EB deploy** | **Accepted** | No CI auto-deploy in repo; controlled promotions | Release owner | [DEPLOYMENT.md](../DEPLOYMENT.md), [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) |
| **No direct commits to `main`** | **Accepted** | Production branch protection | Reviewer / release owner | [DEPLOYMENT.md](../DEPLOYMENT.md) |
| Deploy platform: **AWS Elastic Beanstalk** | **Accepted** | Current production hosting | Infrastructure owner | [DEPLOYMENT.md](../DEPLOYMENT.md) |
| **Manual** production deployment (merge ≠ deploy) | **Accepted** | Infra owner deploys approved `main` SHA to EB | Infrastructure owner | [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md), [production-proof-pack-template.md](production-proof-pack-template.md) |
| Supported production API URL: **`https://api.mosaicbizhub.com`** | **Accepted** | Custom domain with valid TLS; used for smoke, OAuth, Stripe webhooks | Infrastructure owner | [DEPLOYMENT.md](../DEPLOYMENT.md), [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) |
| Raw EB hostname **HTTPS** must **not** be used for production smoke | **Accepted** | TLS certificate CN mismatch on `mosaic-backend.us-east-1.elasticbeanstalk.com` | Release owner | [production-smoke-checklist.md](production-smoke-checklist.md) |
| EB HTTP hostname acceptable for optional raw health probe only | **Accepted** | `http://mosaic-backend.us-east-1.elasticbeanstalk.com/` | Infrastructure owner | [production-smoke-checklist.md](production-smoke-checklist.md) |
| Final sign-off requires **deployment owner to confirm EB commit SHA** | **Accepted** | Custom-domain health can pass while old commit is still live | Deployment owner | [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md), [production-proof-pack-template.md](production-proof-pack-template.md) |
| Post-deploy validation uses **dedicated test accounts** on production | **Accepted** | No hosted staging; controlled smoke after deploy | Release owner | [hosted-staging-decision.md](hosted-staging-decision.md), [production-smoke-checklist.md](production-smoke-checklist.md) |
| Per-release **proof pack** required | **Accepted** | Audit trail for deploy, smoke, rollback | Release owner | [production-proof-pack-template.md](production-proof-pack-template.md) |
| GitHub Actions OIDC deploy to EB (no static AWS keys) | **Accepted** | First successful deploy 2026-06-17 @ `c7955cc` | Infrastructure owner | [deploy-verification.md](deploy-verification.md), [github-actions-eb-setup.md](github-actions-eb-setup.md) |
| Push-to-main auto-deploy **disabled** until gate criteria met | **Accepted** | Controlled rollout after hardening | Release owner + infra owner | [DEPLOYMENT.md](../DEPLOYMENT.md) § Push-to-main auto-deploy gate |

---

## Auth and sessions

| Decision | Status | Reason | Owner | Evidence/Link |
| --- | --- | --- | --- | --- |
| Stateless **JWT** (7-day TTL); HTTP-only cookie + Bearer header | **Accepted** | Standard MVP auth model | Backend engineer | [AUTH_FLOW.md](AUTH_FLOW.md), [auth.md](auth.md) |
| **No refresh tokens** or server-side session store for MVP | **Accepted** | Simplicity; logout clears cookies only | Backend engineer | [AUTH_FLOW.md](AUTH_FLOW.md) |
| Password reset **increments `sessionVersion`** to invalidate old JWTs | **Accepted** | Partial invalidation without token blacklist | Backend engineer | [AUTH_FLOW.md](AUTH_FLOW.md), `tests/auth/password-reset-session-invalidation.test.js` |
| Role checks use **`req.user.role` from DB**, not raw JWT claims | **Accepted** | Prevent claim-based escalation | Backend engineer | [auth.md](auth.md), [middlewares/authenticate.js](../middlewares/authenticate.js) |
| `admin` role **cannot** be self-assigned at registration | **Accepted** | `getSafePublicRole` clamps public register | Backend engineer | [AUTH_FLOW.md](AUTH_FLOW.md), `userController.registerUser` |
| Google OAuth env vars **required at boot** (`authController` throws if missing) | **Accepted** | Fail fast on misconfiguration | Backend engineer | [authController.js](../controllers/authController.js) |
| Local dev reads **`.env`** not `.env.local` | **Accepted** | `dotenv` loads `.env` in `index.js` | Backend engineer | [SETUP.md](../SETUP.md) |

---

## Vendor onboarding and verification (MVP)

| Decision | Status | Reason | Owner | Evidence/Link |
| --- | --- | --- | --- | --- |
| Stage-1 application states: `draft`, `payment_pending`, `submitted`, `verified`, `rejected` | **Accepted** | Single `VendorOnboardingStage1` document per user | Backend engineer | [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md), [VendorOnboardingStage1.js](../models/VendorOnboardingStage1.js) |
| **$24.99** verification PaymentIntent required before `submitForReview` | **Accepted** | `402` if `verificationPayment.status !== paid` | Product + backend | [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md), `vendorOnboarding.controller.js` |
| Admin approval stored as **`verified`** (not `approved` enum) | **Accepted** | Schema enum; API may say "approved" in JSON | Backend engineer | [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md), [admin-pending-applications-statuses.md](admin-pending-applications-statuses.md) |
| Admin pending queue shows **`submitted` only** | **Accepted** | Positive allowlist; excludes draft, payment_pending, rejected, verified | Backend engineer | [vendorOnboardVerifyStage1.js](../controllers/admin/vendorOnboardVerifyStage1.js), `tests/admin/vendorOnboardVerifyStage1.pending-applications.test.js` |
| **Finalize approve/reject** driven by **required document checklist**, not point total | **Accepted** | Tax + license + minority (if applicable) flags | Product + admin ops | [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md), `finalizeVerification` |
| **Badge** (Silver–Diamond) assigned from **points** at finalize; does not affect approve/reject | **Accepted** | Points from `verifyAndAllocatePoints` | Product | [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md) |
| Rejected resubmit is **two-step**: `saveDraft` → `draft`, then `submitForReview` → `submitted` | **Accepted** | Draft save never auto-resubmits to admin queue | Backend engineer | [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md), `tests/vendor/rejected-application-resubmit.test.js` |
| `verified` applications **cannot** be edited via `saveDraft` | **Accepted** | Terminal for Stage-1 vendor edits | Backend engineer | `vendorOnboarding.controller.js` |
| Vendor onboarding upload MIME: **JPEG, PNG, WebP, PDF only** | **Accepted** | Presigned S3 upload gate | Backend engineer | [vendorOnboardingUploadMimeAllowlist.js](../utils/vendorOnboardingUploadMimeAllowlist.js) |
| `saveDraft` strips **protected fields** (status, badge, payment, checklist) | **Accepted** | Prevent vendor self-approval via payload | Backend engineer | [vendorOnboardingProfileFields.js](../utils/vendorOnboardingProfileFields.js) |
| Business profile PUT/PATCH uses **field allowlist** | **Accepted** | PATCH/PUT apply `VENDOR_BUSINESS_PROFILE_ALLOWLIST` | Backend engineer | [vendor-profile-field-allowlist.test.js](../tests/vendor/vendor-profile-field-allowlist.test.js) |
| `validateStage1Payload` at submit enforces **business name only** (most rules commented out) | **Accepted (MVP gap)** | Reduced server validation; frontend gating assumed | Product | [vendorOnboarding.controller.js](../controllers/vendorOnboarding.controller.js) |

---

## Admin and vendor access boundaries

| Decision | Status | Reason | Owner | Evidence/Link |
| --- | --- | --- | --- | --- |
| Vendor onboarding routes require **`authenticate` + `requireVerifiedVendor`** | **Accepted** | `business_owner` + `isOtpVerified` + not blocked/deleted | Backend engineer | [requireVerifiedVendor.js](../middlewares/requireVerifiedVendor.js), [vendorOnboarding.routes.js](../routes/vendorOnboarding.routes.js) |
| Business profile PUT/PATCH requires **`requireStage1Verified`** (`status === verified`) | **Accepted** | Post-approval profile only | Backend engineer | [vendorOnboarding.routes.js](../routes/vendorOnboarding.routes.js) |
| Admin vendor review routes require **`authenticate` + `isAdmin`** | **Accepted** | Pending, detail, verify, finalize | Backend engineer | [vendorOnboarding.routes.js](../routes/vendorOnboarding.routes.js) |
| Same vendor router mounted at **`/api/vendor-onboarding`** and **`/admin/vendor-onboard-verify-stage1`** | **Accepted** | Shared router, two URL prefixes | Backend engineer | [app.js](../app.js) |
| `GET /api/vendor-onboarding/status/:applicationId` is **public** (no auth) | **Accepted** | Status polling by application ID | Backend engineer | [vendorOnboarding.routes.js](../routes/vendorOnboarding.routes.js) |
| Admin user list uses **`toAdminUser`** response whitelist | **Accepted** | Reduce sensitive field exposure | Backend engineer | [admin-users-response.test.js](../tests/admin/admin-users-response.test.js) |
| Auth responses use **`toPublicAuthUser`** whitelist | **Accepted** | Same pattern for login/OTP/check | Backend engineer | [auth-check-payload.test.js](../tests/auth/auth-check-payload.test.js) |

---

## Stripe and payments

| Decision | Status | Reason | Owner | Evidence/Link |
| --- | --- | --- | --- | --- |
| **Five separate** Stripe webhook endpoints, each with **own signing secret** | **Accepted** | Isolated blast radius; per-handler env vars | Backend + infra | [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md), [stripe-webhook-registration.md](stripe-webhook-registration.md) |
| Webhook mounts **before** `express.json()` with **`express.raw()`** | **Accepted** | Stripe signature verification requires raw body | Backend engineer | [app.js](../app.js), `tests/stripe/stripe-webhook-routing-signature.test.js` |
| Order payment status: **`/api/webhooks/stripe`** (`STRIPE_ORDER_WEBHOOK_SECRET`) | **Accepted** | Updates `Order.paymentStatus` / `status` from PI metadata | Backend engineer | [webhookController.js](../controllers/webhookController.js) |
| Order post-payment (emails + charge IDs): **`/api/stripe/payment/webhook`** | **Accepted** | Separate handler; may receive same `payment_intent.succeeded` | Backend engineer | [stripePaymentController.js](../controllers/stripePaymentController.js) |
| Vendor verification webhook: **`/api/vendor-onboarding/webhook/payment`** | **Accepted** | Updates `verificationPayment.status` | Backend engineer | [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md) |
| Subscription billing webhook: **`/api/subscription/webhook`** | **Accepted** | Invoice/charge/PI events → `Subscription` status | Backend engineer | [webhookController.js](../controllers/webhookController.js) |
| Business draft + Connect sync: **`/api/stripe/webhook`** | **Accepted** | `checkout.session.completed`, `account.updated` | Backend engineer | [stripeController.js](../controllers/stripeController.js) |
| Marketplace orders use **Stripe Connect** `transfer_data.destination` | **Accepted** | Vendor payout model | Product + backend | [orderController.js](../controllers/orderController.js) |
| Unsigned webhooks return **400** in production (vendor dev bypass only in `NODE_ENV=development`) | **Accepted** | Security gate | Backend engineer | [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md), webhook tests |
| Stripe webhook registration uses **`https://api.mosaicbizhub.com`** base URL | **Accepted** | Canonical production API | Infrastructure owner | [stripe-webhook-registration.md](stripe-webhook-registration.md) |

---

## Testing and quality

| Decision | Status | Reason | Owner | Evidence/Link |
| --- | --- | --- | --- | --- |
| Automated tests: **Node built-in runner**, `npm test` (57 tests) | **Accepted** | No Jest/Mocha; mock-based unit/integration style | Backend engineer | [TEST_MATRIX.md](TEST_MATRIX.md), `package.json` |
| **No CI pipeline** in repo (tests run locally pre-merge) | **Accepted** | Documented gap; manual gate | Release owner | [launch-readiness-report.md](launch-readiness-report.md) §9 |
| `npm test` pass **does not** equal launch sign-off | **Accepted** | Live Stripe/S3/email/EB not exercised | Release owner | [TEST_MATRIX.md](TEST_MATRIX.md), [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) |
| Deploy Go vs **launch sign-off** are separate gates | **Accepted** | Deploy healthy ≠ unrestricted public launch | Release owner | [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) |

---

## What is required for launch (process)

These are **requirements**, not optional decisions. Failure blocks **Deploy Go** or **launch sign-off** per [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md).

| Requirement | Gate | Owner | Evidence/Link |
| --- | --- | --- | --- |
| PR `staging` → `main` with reviewer + release owner approval | Pre-deploy | Reviewer | [STAGING.md](../STAGING.md) |
| Rollback SHA recorded; EB rollback path confirmed | Pre-deploy | Infra + release owner | [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) |
| Production EB env vars set (names per checklist) | Pre-deploy | Infra owner | [production-env-checklist.md](production-env-checklist.md) |
| All **5 Stripe webhooks** registered with matching secrets | Pre-deploy | Infra + backend | [stripe-webhook-registration.md](stripe-webhook-registration.md) |
| `npm test` pass recorded pre-merge | Pre-deploy | Backend engineer | [TEST_MATRIX.md](TEST_MATRIX.md) |
| EB deployed commit SHA **confirmed** by deployment owner | Post-deploy | Deployment owner | [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) |
| Minimum smoke: P0.1, P0.2, P1.4, P1.5, P4.1/P4.5 | Deploy Go | Release owner | [production-smoke-checklist.md](production-smoke-checklist.md) |
| Extended smoke per release scope (S1–S4 minimum for payment/auth) | Launch sign-off | Release owner | [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) |
| Proof pack completed with redacted evidence | Launch sign-off | Release owner | [production-proof-pack-template.md](production-proof-pack-template.md) |
| Product owner **written approval** (Bryan) | Launch sign-off | Product owner | [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) |
| Open P0 code blockers reviewed — remediated or **business-accepted risk** documented | Launch sign-off | Product + release owner | [launch-readiness-report.md](launch-readiness-report.md) §9 |

---

## Push-to-main auto-deploy gate (deferred)

| Decision | Status | Reason | Owner | Evidence/Link |
| --- | --- | --- | --- | --- |
| Re-enable push-to-`main` in deploy workflow | **Deferred** | Awaiting hardening prerequisites | Release owner + infra owner | [DEPLOYMENT.md](../DEPLOYMENT.md) § Push-to-main auto-deploy gate |

**Prerequisites (all required):** ≥2 successful manual deploys; automated health + auth + CORS probes; rollback runbook; tightened OIDC IAM; Sentry verified; production environment reviewers; written sign-off.

---

## Open launch blockers (not deferred — tracked)

Distinct from **deferred** decisions. These are **open risks** documented in the repo as of launch-readiness report. Status: **Open** until remediated or explicitly accepted with sign-off.

| Item | Status | Reason | Owner | Evidence/Link |
| --- | --- | --- | --- | --- |
| No CI / automated deploy regression | **Open** | No `.github/workflows/` | Release owner | [launch-readiness-report.md](launch-readiness-report.md) |
| `mongoSanitize` / `xss-clean` imported but **not mounted** | **Open** | [app.js](../app.js) imports only | Backend engineer | [launch-readiness-report.md](launch-readiness-report.md), [ARCHITECTURE.md](ARCHITECTURE.md) |
| Unauthenticated payment/order attack surface | **Open** | e.g. `/api/payments/create-payment-intent`, `/stripe/*` | Backend engineer | [production-smoke-checklist.md](production-smoke-checklist.md) P0-7, P0-8 |
| Order confirmation emails **before** payment succeeds | **Open** | `initiateOrder` sends emails pre-payment | Backend engineer | [launch-readiness-report.md](launch-readiness-report.md) |
| `POST /api/business` trusts client `paymentStatus` | **Open** | Legacy create path | Backend engineer | [launch-readiness-report.md](launch-readiness-report.md) |
| Vendor submit validation mostly disabled | **Open** | `validateStage1Payload` minimal | Backend engineer | [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md) |
| Product tier limits not enforced on create | **Open** | Catalog limits | Backend engineer | [launch-readiness-report.md](launch-readiness-report.md) |
| Dual / conflicting vendor onboarding paths | **Open** | Documented in readiness report | Backend engineer | [launch-readiness-report.md](launch-readiness-report.md) |
| Duplicate order webhook handlers (intentional split; operational complexity) | **Open** | Two endpoints same event type | Backend engineer | [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md) |
| Frontend admin Blog/FAQ dead links | **Open** | Frontend repo | Frontend owner | [launch-readiness-report.md](launch-readiness-report.md) |
| `backend27may.zip` on `main`/`staging` | **Open** | Repo hygiene | Backend engineer | [launch-readiness-report.md](launch-readiness-report.md) |

**Note:** Automated tests (**57**) exist locally; the blocker is **lack of CI**, not lack of tests entirely.

---

## Deferred — Phase 2

Planned improvements from [launch-readiness-report.md](launch-readiness-report.md) § Phase 2. **Not required for MVP deploy process** unless promoted by product.

| Decision | Status | Reason | Owner | Evidence/Link |
| --- | --- | --- | --- | --- |
| **Hosted staging** EB environment | **Deferred** | Cost/complexity; see future runbook when approved | Infrastructure owner | [hosted-staging-decision.md](hosted-staging-decision.md) |
| **CI pipeline** (GitHub Actions or equivalent) | **Deferred** | Not in repo today | Release owner | [launch-readiness-report.md](launch-readiness-report.md) |
| Migrate to **Jest/Vitest** (optional) | **Deferred** | Currently Node `node:test` | Backend engineer | [launch-readiness-report.md](launch-readiness-report.md) |
| Security hardening pass (sanitization, auth on payment routes) | **Deferred** | P0 items tracked separately | Backend engineer | [security-remediation-notes.md](security-remediation-notes.md) |
| Admin Blog/FAQ UI (frontend) | **Deferred** | Frontend scope | Frontend owner | [launch-readiness-report.md](launch-readiness-report.md) |
| Frontend `.env.example` alignment | **Deferred** | Doc drift | Frontend owner | [launch-readiness-report.md](launch-readiness-report.md) |
| Remove committed zip artifacts | **Deferred** | Repo cleanup | Backend engineer | [launch-readiness-report.md](launch-readiness-report.md) |
| Grocery checkout flow | **Deferred** | Product scope | Product | [launch-readiness-report.md](launch-readiness-report.md) |
| Dependency audit / npm audit cadence | **Deferred** | Supply chain | Backend engineer | [launch-readiness-report.md](launch-readiness-report.md) |

---

## Deferred — post-MVP / hardening (no Phase 3 doc; ongoing backlog)

Documented in feature-specific refs. **Not** launch blockers unless promoted.

| Decision | Status | Reason | Owner | Evidence/Link |
| --- | --- | --- | --- | --- |
| Backend **subscription gate** on profile PUT (enforce active subscription server-side) | **Deferred** | Frontend gates profile page today | Backend engineer | [business-sync.md](business-sync.md) §11 |
| Stricter **`validateStage1Payload`** at vendor submit | **Deferred** | Most rules commented out | Backend engineer | [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md) |
| Remove legacy JWT **`userId` claim** fallback in `authenticate` | **Deferred** | After old tokens expire | Backend engineer | [AUTH_FLOW.md](AUTH_FLOW.md), [auth.md](auth.md) |
| **Refresh tokens** or server-side session revocation on logout | **Deferred** | MVP stateless model | Backend engineer | [AUTH_FLOW.md](AUTH_FLOW.md) |
| Admin `GET /admin/users` additional field redaction | **Deferred** | Wave 2 checklist item | Backend engineer | [auth.md](auth.md) §10 |
| Relocate admin vendor routes off shared vendor router | **Deferred** | Cleaner boundary | Backend engineer | [admin-read-mutation.md](admin-read-mutation.md) |
| Consolidate or document **dual order webhook** operational runbook | **Deferred** | Reduce operator confusion | Backend engineer | [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md) |
| Facebook OAuth (`provider` enum exists; no routes) | **Deferred** | Not implemented | Product | [AUTH_FLOW.md](AUTH_FLOW.md) |
| Wire **`express-mongo-sanitize`** and **`xss-clean`** middleware | **Deferred** | Imported but not applied | Backend engineer | [app.js](../app.js) |

---

## Decision status legend

| Status | Meaning |
| --- | --- |
| **Accepted** | Active decision; implement and document changes against this row |
| **Open** | Known blocker or risk; not resolved |
| **Deferred** | Explicitly postponed; do not treat as launch requirement |
| **Superseded** | Replaced by a newer row (add date in Reason) |

---

## Related documentation index

| Doc | Topic |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Repo map |
| [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) | Deploy, smoke, sign-off |
| [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md) | Vendor states and admin review |
| [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md) | Webhook ownership |
| [TEST_MATRIX.md](TEST_MATRIX.md) | Test vs manual coverage |
| [launch-readiness-report.md](launch-readiness-report.md) | P0 blockers and Phase 2 list |

When a decision changes, update this register **and** the linked evidence doc in the same PR.
