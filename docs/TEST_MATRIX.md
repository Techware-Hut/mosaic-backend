# Test Matrix

Maps backend features to automated tests (`npm test`), manual smoke checks, and proof-pack evidence.

**Runner:** `npm test` → `node --test tests/**/*.test.js` (73 tests, Node built-in runner)

**Test style:** Unit/integration-style tests with mocked Mongoose models and module hooks. They prove **handler logic and wiring** — not full end-to-end flows against live MongoDB, Stripe, or AWS in CI.

**Related:** [production-smoke-checklist.md](production-smoke-checklist.md), [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md), [production-proof-pack-template.md](production-proof-pack-template.md), [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md)

---

## Coverage summary

| Layer | Count | What it validates |
|-------|-------|-------------------|
| Automated (`tests/`) | **73** | DTOs, middleware, controller logic, webhook wiring (mocked) |
| Manual smoke script | 1 | Live API + DB auth/check per role |
| Production smoke tiers | P0–P6 | Post-deploy on `https://api.mosaicbizhub.com` |
| Proof pack | Per release | Redacted evidence matrix |

**Not covered by automation:** Live Stripe payments, S3 uploads, email delivery, full order checkout, admin finalize against real DB, CI pipeline (none in repo).

---

## Auth tests

| Area | Test File | What It Proves | What It Does Not Prove | Manual Smoke Needed? |
| --- | --- | --- | --- | --- |
| Auth response DTO | [`tests/auth/auth-check-payload.test.js`](../tests/auth/auth-check-payload.test.js) | `toPublicAuthUser` exposes only safe fields; `/auth/check` handler uses whitelist | Live login, cookie flags, CORS | Yes — P1.4, P1.5 |
| JWT shape | same | `buildSessionToken` uses `sub` claim (not `userId`) | Token expiry in production, refresh flow | No (logic only) |
| Google OAuth cookie TTL | [`tests/auth/google-oauth-security.test.js`](../tests/auth/google-oauth-security.test.js) | `mbh_tmp` cookie `maxAge` matches temp JWT lifetime when profile completion required | Full Google redirect flow, live Google tokens | Yes — P1.8 |
| Google OAuth rate limits | same | Rate limit middleware precedes OAuth handlers on `/google`, `/callback`, `/complete` | Rate limit effectiveness under load | No |
| Admin self-registration block | — | *(no automated test)* | Register with `role: admin` rejected | Yes — P1.6 |

---

## Password reset tests

| Area | Test File | What It Proves | What It Does Not Prove | Manual Smoke Needed? |
| --- | --- | --- | --- | --- |
| Email enumeration | [`tests/auth/password-reset-abuse-protection.test.js`](../tests/auth/password-reset-abuse-protection.test.js) | `forgotPassword` returns generic message for unknown emails | Email actually sent, SMTP config | Yes — P1.7 |
| OTP lockout | same | `resetPassword` clears reset OTP after 5 failed attempts | Lockout timing in production | Yes — P1.7 |
| Expired reset OTP | same | Expired OTP fields cleared before rejection | — | Yes — P1.7 |
| Rate limiting wiring | same | `forgot-password` and `reset-password` routes have rate limiter before handler | 429 responses at limit threshold | Partial — optional abuse test |

---

## Session invalidation tests

| Area | Test File | What It Proves | What It Does Not Prove | Manual Smoke Needed? |
| --- | --- | --- | --- | --- |
| Password reset invalidation | [`tests/auth/password-reset-session-invalidation.test.js`](../tests/auth/password-reset-session-invalidation.test.js) | `resetPassword` increments `sessionVersion` | User must re-login after reset (no auto JWT) | Yes — P1.7 |
| Stale JWT rejection | same | `authenticate` rejects JWT when `sessionVersion` mismatch; clears cookies | Logout invalidation (logout does not bump version) | Yes — P1.4 |
| Valid session acceptance | same | `authenticate` accepts matching `sessionVersion` | Bearer vs cookie transport in production | Yes — P1.4, P1.5 |

---

## Vendor onboarding tests

| Area | Test File | What It Proves | What It Does Not Prove | Manual Smoke Needed? |
| --- | --- | --- | --- | --- |
| Rejected resubmit (draft) | [`tests/vendor/rejected-application-resubmit.test.js`](../tests/vendor/rejected-application-resubmit.test.js) | `saveDraft` on rejected → `draft`, not auto-`submitted` | Full rejected → revise → resubmit E2E | Yes — P2.1, P2.5 |
| Explicit resubmit | same | `submitForReview` on rejected → `submitted` when paid | Payment gate (`402`) with live Stripe | Yes — P2.3–P2.5 |
| Draft submit | same | `submitForReview` on draft → `submitted` | `validateStage1Payload` strictness (mostly disabled in code) | Yes — P2.5 |
| Protected fields on draft | same | `saveDraft` strips badge/status/points from payload | All PUT paths without allowlist | Partial |
| Verified vendor middleware | [`tests/vendor/require-verified-vendor.test.js`](../tests/vendor/require-verified-vendor.test.js) | 401/403 for missing user, wrong role, unverified OTP, blocked paths | Live vendor routes with real JWT | Yes — P2.1 |
| Stage-1 verified gate | same | `requireStage1Verified` requires `onboarding.status === verified` | Business profile PUT against prod | Yes — after P3.4 |
| Auth on vendor routes | same | Unauthenticated request blocked on onboarding route | All vendor route permutations | Yes — P2.1 |
| Verification payment | — | *(no automated test)* | $24.99 PI create, webhook paid status | Yes — P2.2–P2.4 |
| Submit without payment | — | *(no automated test)* | `402` when verification unpaid | Yes — P2.5 |

---

## Admin review tests

| Area | Test File | What It Proves | What It Does Not Prove | Manual Smoke Needed? |
| --- | --- | --- | --- | --- |
| Pending queue filter | [`tests/admin/vendorOnboardVerifyStage1.pending-applications.test.js`](../tests/admin/vendorOnboardVerifyStage1.pending-applications.test.js) | `getPendingApplications` returns only `submitted` | Live admin UI, pagination | Yes — P3.1 |
| Resubmitted in queue | same | Resubmitted apps appear when status returns to `submitted` | Email notifications on resubmit | Yes — P3.1 |
| Excludes payment_pending | same | `payment_pending` apps excluded from queue | `draft`/`rejected`/`verified` exclusion | Yes — P3.1 |
| Allowlist constant | same | `PENDING_REVIEW_STATUSES = ['submitted']` frozen | — | No |
| Admin route guard | same | Pending route blocks non-admin via `isAdmin` | All admin routes (`/admin/*`) | Yes — P3.1–P3.5 |
| Admin user DTO | [`tests/admin/admin-users-response.test.js`](../tests/admin/admin-users-response.test.js) | `toAdminUser` whitelist; `getAllUsers` maps through it | Live `GET /admin/users` against prod | Yes — P3.x |
| isAdmin middleware | same | `isAdmin` blocks non-admin roles | Admin JWT from prod login | Yes — P3.1 |
| verifyAndAllocatePoints | — | *(no automated test)* | Document checklist, points allocation | Yes — P3.3 |
| finalizeVerification | — | *(no automated test)* | Approve/reject, badge, emails | Yes — P3.4 |
| Business approve | — | *(no automated test)* | `POST /admin/api/business/approve/:id` | Yes — P3.5 |

---

## Upload / MIME tests

| Area | Test File | What It Proves | What It Does Not Prove | Manual Smoke Needed? |
| --- | --- | --- | --- | --- |
| MIME allowlist constants | [`tests/vendor/vendor-onboarding-upload-mime.test.js`](../tests/vendor/vendor-onboarding-upload-mime.test.js) | JPEG, PNG, WebP, PDF accepted; unsafe types rejected | S3 presigned URL actually works | Yes — P2.6 |
| Upload handler MIME gate | same | `getStage1UploadUrl` returns 400 for unsafe MIME | File content validation (magic bytes) | Yes — P2.6 |
| Upload auth | same | Upload route blocked without auth; blocks non-vendor | `requireVerifiedVendor` OTP gate live | Yes — P2.6 |
| documentType allowlist | — | *(tested in controller, not every type)* | All 7 `documentType` values end-to-end | Yes — P2.6 |
| S3 upload completion | — | *(no automated test)* | Client PUT to presigned URL succeeds | Yes — human |

---

## Stripe webhook tests

| Area | Test File | What It Proves | What It Does Not Prove | Manual Smoke Needed? |
| --- | --- | --- | --- | --- |
| Mount order | [`tests/stripe/stripe-webhook-routing-signature.test.js`](../tests/stripe/stripe-webhook-routing-signature.test.js) | All 5 webhook mounts before `express.json()` in `app.js` | EB/nginx body buffering | Yes — P4.1 (Dashboard delivery) |
| Raw body middleware | same | `express.raw` on webhook POST paths | — | No (static analysis) |
| Per-route secrets | same | Each handler uses correct `STRIPE_*_WEBHOOK_SECRET` | EB env values match Dashboard | Yes — P4.1 |
| Missing signature | same | 400 when `stripe-signature` absent (incl. vendor in production) | All 5 routes via live curl | Yes — P4.5 |
| Invalid / wrong secret | same | 400 on bad signature or mismatched secret | — | Yes — P4.5 (spot check) |
| Raw body guard (order) | same | Canonical order webhook rejects parsed JSON body | Other routes raw-body edge cases | Partial |
| Secret uniqueness | same | Five env secrets are distinct values in test fixture | Production secrets not reused | Yes — infra review |
| Event handling logic | — | *(no automated test)* | Order paid, subscription active, vendor fee paid | Yes — P4.2–P4.4, P5.3 |
| Signed Dashboard delivery | — | *(no automated test)* | Stripe → EB HTTP 200 end-to-end | Yes — P4.1 |

See [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md) for route ownership and curl smoke commands.

---

## Business sync tests

| Area | Test File | What It Proves | What It Does Not Prove | Manual Smoke Needed? |
| --- | --- | --- | --- | --- |
| Create Business | [`tests/vendor/vendor-onboarding-business-sync.test.js`](../tests/vendor/vendor-onboarding-business-sync.test.js) | `syncBusinessFromOnboarding` creates `Business` when none exists | Requires active `Subscription` in prod | Yes — after P3.4 + subscription |
| Update Business | same | Sync updates existing `Business` fields | PATCH profile path (no sync) | Yes — P2.1 + profile flow |
| Sync failure propagation | same | `Business.save()` failure throws; `updateBusinessProfile` returns 500 | Swallowed sync on other code paths | Partial |
| Profile PUT success path | same | `updateBusinessProfile` succeeds when sync succeeds | Live MongoDB validation errors | Yes — post-verify profile |
| finalizeVerification → Business | — | *(no automated test)* | Admin approve does not call sync (by design) | Yes — P3.4 |

---

## Vendor profile / field protection tests

| Area | Test File | What It Proves | What It Does Not Prove | Manual Smoke Needed? |
| --- | --- | --- | --- | --- |
| Protected field strip | [`tests/vendor/vendor-profile-field-allowlist.test.js`](../tests/vendor/vendor-profile-field-allowlist.test.js) | `stripProtectedVendorFields` removes payment/status/badge fields | Crafted PUT bypass in prod | Partial |
| Profile allowlist | same | PUT/PATCH apply only `VENDOR_BUSINESS_PROFILE_ALLOWLIST` | Fields outside allowlist on draft save | Partial |
| Media verified flag | same | Vendor cannot overwrite admin `verified` on media subdocs | Document array `verified` on minority docs | Partial |
| User scoping | same | Profile updates query by `req.user._id` only | IDOR across users | Yes — security review |

---

## Production smoke probes

Manual checks run **after EB deploy** on `https://api.mosaicbizhub.com`. Full tier list: [production-smoke-checklist.md](production-smoke-checklist.md).

| Area | Test File / Source | What It Proves | What It Does Not Prove | Manual Smoke Needed? |
| --- | --- | --- | --- | --- |
| Health | P0.1 | API reachable; JSON health response | Correct commit deployed | **Yes** — always |
| EB boot logs | P0.2 | Mongo connected; no crash | Performance, memory leaks | **Yes** — infra owner |
| Log hygiene | P0.3 | No OTP in logs after auth tests | All PII log scrubbing | **Yes** |
| Auth full tier | P1.1–P1.8 | Register, OTP, login, OAuth, reset | Automated regression between releases | **Yes** |
| Vendor tier | P2.1–P2.6 | Draft, pay, submit, upload URL | Admin approval path | **Yes** |
| Admin tier | P3.1–P3.5 | Queue, verify, finalize, business approve | All admin CMS routes | **Yes** |
| Stripe tier | P4.1–P4.5 | Dashboard deliveries; unsigned rejection | Every event type handler | **Yes** |
| Orders tier | P5.1–P5.5 | Connect, initiate, pay, retrieve | Refunds, partial captures | **Yes** |
| Public tier | P6.1–P6.5 | Search, listings, plans | Load/performance | **Yes** — launch scope |

Record results in [production-proof-pack-template.md](production-proof-pack-template.md).

---

## Manual QA still requiring human verification

These launch-critical areas have **no** meaningful automated coverage. They require human execution each release (or per [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) scope).

| Area | Why manual | Smoke IDs | Proof-pack field |
| --- | --- | --- | --- |
| **Deployed commit on EB** | Tests do not deploy or verify SHA | Runbook gate | EB deployed commit confirmed |
| **Live Stripe payments** | No test hits Stripe API | P2.3, P4.2–P4.4, P5.3 | Stripe Dashboard screenshot (redacted) |
| **Email delivery** | Mailer mocked in all tests | P1.1–P1.2, P2.3, P3.4 | Optional: inbox check note |
| **S3 presigned upload** | AWS SDK mocked | P2.6 | Manual upload + URL in draft |
| **Google OAuth E2E** | Redirect flow not automated | P1.8 | OAuth callback success note |
| **Connect onboarding** | No Connect tests | P5.1 | Connect status in Dashboard |
| **Subscription billing E2E** | Webhook logic mocked | P4.3 | Invoice payment delivery |
| **Order checkout E2E** | Order controller not tested | P5.2–P5.5 | Test order `paymentStatus: paid` |
| **Admin finalize + emails** | Controller not tested | P3.4 | Approval/rejection email received |
| **Frontend integration** | Backend tests only | Script + P6 | `verify-auth-check-smoke.js` page loads |
| **Cross-domain cookies** | Cookie helper unit-tested only | P1.4 | Browser session on `app.mosaicbizhub.com` |
| **Open P0 blockers** | Documented gaps, not tested | Launch review | [launch-readiness-report.md](launch-readiness-report.md) §9 |

### Manual smoke script (not `npm test`)

| Script | Command | What It Proves | What It Does Not Prove |
| --- | --- | --- | --- |
| Auth smoke | `node scripts/verify-auth-check-smoke.js` | Live `/auth/check` per role; unauth 401; optional frontend page HTTP status | Full register/login flow; does not replace P1 tier |

Requires `.env`, MongoDB with seeded users per role, and running API (local or `API_BASE_URL`).

### Production negative probes (safe, no secrets)

Unsigned webhook POST → expect `400` on all five routes. Commands in [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md). Record in proof pack as P4.5 evidence.

---

## Marketplace tests (issue #28)

| Area | Test File | What It Proves | What It Does Not Prove | Manual Smoke Needed? |
| --- | --- | --- | --- | --- |
| Public listing DTO | [`tests/marketplace/public-listing-dto.test.js`](../tests/marketplace/public-listing-dto.test.js) | Null-safe card/detail fields; legacy key preservation; price/image/vendor normalization | Live MongoDB list/detail responses | Yes — P6.1 featured-products |
| Featured products wiring | [`tests/marketplace/featured-products-response.test.js`](../tests/marketplace/featured-products-response.test.js) | `getFeaturedProducts` maps through `toPublicListingCard`; preserves `{ products, pagination }` wrapper | Full featured feed against prod DB | Yes — deploy smoke `GET /api/featured-products` |

**Contract doc:** [API_MARKETPLACE_DATA_CONTRACT.md](API_MARKETPLACE_DATA_CONTRACT.md)

---

## Launch-critical area → coverage map

| Launch-critical area | Automated | Manual smoke | Gap / honest limit |
| --- | --- | --- | --- |
| Auth DTO / session shape | Yes (12 tests) | P1.x | No live login E2E |
| Password reset security | Yes (7 tests) | P1.7 | No SMTP proof |
| Vendor status machine | Yes (resubmit + middleware) | P2.x | Payment/webhook E2E manual |
| Admin pending queue | Yes (5 tests) | P3.1 | Finalize/verify manual |
| Field protection | Yes (6 tests) | Partial | Theoretical PUT bypass untested live |
| Upload MIME | Yes (5 tests) | P2.6 | No real S3 |
| Webhook wiring | Yes (9 tests) | P4.x | Event DB side-effects manual |
| Business sync | Yes (5 tests) | Post-verify | Subscription dependency manual |
| Marketplace card/detail DTO | Yes (16 tests) | P6.x | Live browse/detail E2E manual |
| Subscriptions (API) | **No** | P4.3 | Billing E2E manual |
| CI/CD regression | **No** | `npm test` local pre-merge | No GitHub Actions |

---

## How to run

```bash
# All automated tests (73)
npm test

# Manual auth smoke (live API + DB)
node scripts/verify-auth-check-smoke.js

# Production health (post-deploy)
# See production-smoke-checklist.md Tier 0
```

---

## Proof-pack evidence mapping

| Evidence type | Source | Automated equivalent |
| --- | --- | --- |
| `npm test` 73/73 pass | Pre-merge local/CI | Yes — full suite |
| Auth smoke script output | `scripts/verify-auth-check-smoke.js` | Partial — live auth/check only |
| Smoke matrix P0–P6 | [production-smoke-checklist.md](production-smoke-checklist.md) | No — human execution |
| Webhook unsigned 400 | [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md) curl | Partial — 9 tests cover handler logic |
| Stripe Dashboard deliveries | Manual | No |
| EB commit SHA | Deployment owner | No |

**Do not overclaim:** Passing `npm test` proves code-level contracts and wiring with mocks. It does **not** prove production deploy health, live payments, or launch readiness. See [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) for Deploy Go vs launch sign-off.

---

## Test file index

| File | Tests | Domain |
| --- | ---: | --- |
| `tests/auth/auth-check-payload.test.js` | 3 | Auth DTO, JWT `sub` |
| `tests/auth/google-oauth-security.test.js` | 2 | OAuth cookie + rate limits |
| `tests/auth/password-reset-abuse-protection.test.js` | 4 | Reset abuse + rate limits |
| `tests/auth/password-reset-session-invalidation.test.js` | 3 | Session invalidation |
| `tests/admin/admin-users-response.test.js` | 3 | Admin user DTO + guard |
| `tests/admin/vendorOnboardVerifyStage1.pending-applications.test.js` | 5 | Admin pending queue |
| `tests/vendor/rejected-application-resubmit.test.js` | 5 | Resubmit state machine |
| `tests/vendor/require-verified-vendor.test.js` | 6 | Vendor middleware |
| `tests/vendor/vendor-onboarding-upload-mime.test.js` | 5 | Upload MIME + auth |
| `tests/vendor/vendor-onboarding-business-sync.test.js` | 5 | Business sync |
| `tests/vendor/vendor-profile-field-allowlist.test.js` | 6 | Field allowlists |
| `tests/stripe/stripe-webhook-routing-signature.test.js` | 9 | Webhook routing + signatures |
| **Total** | **57** | |
