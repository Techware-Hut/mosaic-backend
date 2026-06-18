# Backend Roadmap Issues Plan

**Branch:** `main` @ `fbe3aac` (PR #78 merged)  
**Date:** 2026-06-18 (Batch 3 audit update)  
**Purpose:** GitHub-ready issue backlog grouped by priority lane. Maps to existing open issues where possible — do not duplicate filing without review.

**Status labels used:** Defect / Bug Fix Needed · Revision Needed · Pending Developer Response · Deferred / Future Phase · Change Request Required

---

## 1. Launch blockers

### #41 — Payment route protection hardening

| Field | Detail |
| --- | --- |
| **GitHub** | [#41](https://github.com/Techware-Hut/mosaic-backend/issues/41) |
| **Status** | **Code complete** (PR #78) — prod verify pending EB deploy |
| **Problem** | Legacy `/stripe/*` and unauthenticated payment intent routes expose pre-checkout attack surface |
| **Impact** | Unauthorized payment API access; launch security gate |
| **Scope** | Auth middleware on legacy routes; remove or guard `POST /api/payments/create-payment-intent` |
| **Out of scope** | Connect checkout flow changes (#42 already merged) |
| **Acceptance criteria** | All payment mutation routes require authenticated customer or server-side webhook; audit doc updated |
| **Testing** | Unit tests for 401/403; manual curl on prod after deploy |
| **Risk** | High |

### #43 — Order email timing and webhook retry idempotency

| Field | Detail |
| --- | --- |
| **GitHub** | [#43](https://github.com/Techware-Hut/mosaic-backend/issues/43) |
| **Status** | **Code complete** (PR #78) — prod verify pending EB deploy |
| **Problem** | Order confirmation emails may fire before payment confirmation |
| **Impact** | Customer confusion; false "order paid" emails |
| **Scope** | Move customer/vendor order emails to post-webhook success path; idempotent webhook handlers |
| **Out of scope** | Stripe Connect account creation |
| **Acceptance criteria** | No paid-order email before `payment_intent.succeeded`; duplicate webhooks safe |
| **Testing** | Extend `tests/stripe/order-webhook-email-safety.test.js`; manual test-mode checkout |
| **Risk** | High |

### #27 — Full production smoke proof pack (P0–P6)

| Field | Detail |
| --- | --- |
| **GitHub** | [#27](https://github.com/Techware-Hut/mosaic-backend/issues/27) |
| **Status** | **In progress** — matrix in [BACKEND_FULL_SMOKE_PROOF_PACK.md](BACKEND_FULL_SMOKE_PROOF_PACK.md); P0 health blocked until EB deploy |
| **Problem** | Browse/auth smoke PASS; checkout/email/vendor tiers incomplete |
| **Impact** | Cannot sign off launch without tiered evidence |
| **Scope** | Execute [BACKEND_FULL_SMOKE_PROOF_PACK.md](BACKEND_FULL_SMOKE_PROOF_PACK.md) and [scripts/smoke-backend.ps1](../scripts/smoke-backend.ps1) with `SMOKE_TEST_*` accounts |
| **Out of scope** | New feature development |
| **Acceptance criteria** | Proof pack filled per [production-proof-pack-template.md](production-proof-pack-template.md) |
| **Testing** | Manual prod smoke; document SKIP reasons |
| **Risk** | High (process) |

### #69 — Health and readiness endpoints

| Field | Detail |
| --- | --- |
| **GitHub** | [#69](https://github.com/Techware-Hut/mosaic-backend/issues/69) |
| **Status** | **Code complete** (PR #78) — prod verify pending EB deploy (`/api/health` 404 on prod 2026-06-18) |
| **Problem** | Only `GET /` exists; no structured readiness probe |
| **Impact** | EB/GHA cannot distinguish "up" vs "ready" (DB connected) |
| **Scope** | Add `/api/health` or `/api/ready` with Mongo ping; keep `GET /` backward compatible |
| **Out of scope** | Metrics dashboard |
| **Acceptance criteria** | Readiness returns 503 when DB disconnected; documented in runbook |
| **Testing** | Unit test + post-deploy curl |
| **Risk** | Medium |

---

## 2. High-priority post-launch

### #34 — Admin dashboard aggregation APIs

| Field | Detail |
| --- | --- |
| **GitHub** | [#34](https://github.com/Techware-Hut/mosaic-backend/issues/34) |
| **Status** | Deferred / Future Phase (MVP partial) |
| **Problem** | No admin sales/revenue summary API |
| **Impact** | Admin dashboard incomplete |
| **Scope** | Read-only aggregation endpoints for pending approvals, highlights, sales summary |
| **Out of scope** | Full BI/analytics |
| **Acceptance criteria** | Documented admin routes with auth; DTO tests |
| **Testing** | Admin role tests |
| **Risk** | Medium |

### #66 — Admin authorization matrix audit

| Field | Detail |
| --- | --- |
| **GitHub** | [#66](https://github.com/Techware-Hut/mosaic-backend/issues/66) |
| **Status** | Revision Needed |
| **Problem** | Admin routes may have inconsistent role guards |
| **Impact** | Privilege escalation risk |
| **Scope** | Audit all `/admin/*` and `/api/admin/*` routes; document matrix |
| **Out of scope** | RBAC redesign |
| **Acceptance criteria** | Matrix doc + tests for each admin mutation route |
| **Testing** | 403 tests for customer/vendor roles |
| **Risk** | High |

### #65 — Vendor onboarding state machine audit

| Field | Detail |
| --- | --- |
| **GitHub** | [#65](https://github.com/Techware-Hut/mosaic-backend/issues/65) |
| **Status** | Revision Needed |
| **Problem** | Multiple status fields across onboarding, business, and listings |
| **Impact** | Edge cases in resubmit/reject/approve flows |
| **Scope** | State diagram + gap list; fix clear defects only |
| **Out of scope** | BusinessScreen automation |
| **Acceptance criteria** | Documented state machine matches [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md) |
| **Testing** | Extend vendor onboarding test suite |
| **Risk** | Medium |

---

## 3. Performance / loading improvements

### #44 — Public API pagination and query-shaping audit

| Field | Detail |
| --- | --- |
| **GitHub** | [#44](https://github.com/Techware-Hut/mosaic-backend/issues/44) |
| **Status** | Partially addressed (this sprint) |
| **Problem** | Inconsistent pagination shapes; unbounded limits on some routes |
| **Impact** | Slow frontend loads; large payloads |
| **Scope** | Unified pagination helper; document response shapes |
| **Out of scope** | GraphQL |
| **Acceptance criteria** | All public list endpoints cap limit; pagination metadata documented |
| **Testing** | Marketplace tests for each list family |
| **Risk** | Low–Medium |

**This sprint delivered:** featured/list limit caps (50), search default scope, ranked `isPublished`.

### #53 — Database index and explain-plan audit

| Field | Detail |
| --- | --- |
| **GitHub** | [#53](https://github.com/Techware-Hut/mosaic-backend/issues/53) |
| **Status** | Partially addressed (this sprint) |
| **Problem** | Missing indexes on hot listing filters |
| **Impact** | Slow queries at scale |
| **Scope** | Product indexes (done); Service/Food indexes; Atlas explain plans |
| **Out of scope** | Read replicas |
| **Acceptance criteria** | Index list documented; explain plans for top 5 public queries |
| **Testing** | Staging/Atlas index verification post-deploy |
| **Risk** | Medium |

### #54 — Media payload and image response optimization

| Field | Detail |
| --- | --- |
| **GitHub** | [#54](https://github.com/Techware-Hut/mosaic-backend/issues/54) |
| **Status** | Deferred / Future Phase |
| **Problem** | List endpoints may return heavy image arrays |
| **Impact** | Bandwidth and parse time on mobile |
| **Scope** | Card endpoints return single `imageUrl`; detail keeps gallery |
| **Out of scope** | CDN migration |
| **Acceptance criteria** | DTO contract updated backward-compat |
| **Testing** | DTO tests; payload size spot check |
| **Risk** | Low |

---

## 4. Vendor / admin workflow improvements

### #76 — Vendor plan entitlement and subscription lifecycle

| Field | Detail |
| --- | --- |
| **GitHub** | [#76](https://github.com/Techware-Hut/mosaic-backend/issues/76) |
| **Status** | Revision Needed |
| **Problem** | Tier limits vs subscription state may drift |
| **Impact** | Vendors over/under-listing relative to plan |
| **Scope** | Audit tier enforcement (#31) vs subscription webhooks |
| **Out of scope** | New tier SKUs |
| **Acceptance criteria** | Documented entitlement rules; defect fixes only |
| **Testing** | Vendor quota tests + subscription webhook tests |
| **Risk** | Medium |

### #67 — Email template and notification contract cleanup

| Field | Detail |
| --- | --- |
| **GitHub** | [#67](https://github.com/Techware-Hut/mosaic-backend/issues/67) |
| **Status** | Revision Needed |
| **Problem** | Email templates scattered across multiple mailer files |
| **Impact** | Inconsistent branding/copy; hard to audit |
| **Scope** | Inventory all mailers; standardize subject/body contracts |
| **Out of scope** | Marketing automation |
| **Acceptance criteria** | [MVP_BACKEND_EMAIL_NOTIFICATIONS.md](MVP_BACKEND_EMAIL_NOTIFICATIONS.md) updated with template map |
| **Testing** | Existing email safety tests pass |
| **Risk** | Low |

### #77 — Marketplace moderation and listing visibility rules

| Field | Detail |
| --- | --- |
| **GitHub** | [#77](https://github.com/Techware-Hut/mosaic-backend/issues/77) |
| **Status** | Partially addressed (this sprint) |
| **Problem** | Inconsistent visibility gates across featured/search/ranked |
| **Impact** | Inactive or unpublished listings visible publicly |
| **Scope** | Document rules: `isActive` for browse, `isApproved` for checkout |
| **Out of scope** | Automated moderation AI |
| **Acceptance criteria** | Visibility matrix doc; tests for each public endpoint family |
| **Testing** | Marketplace visibility tests (extended this sprint) |
| **Risk** | Medium |

---

## 5. Marketplace / search improvements

### #72 — Public search relevance and taxonomy normalization

| Field | Detail |
| --- | --- |
| **GitHub** | [#72](https://github.com/Techware-Hut/mosaic-backend/issues/72) |
| **Status** | Revision Needed |
| **Problem** | Regex keyword search; category slug inconsistencies |
| **Impact** | Poor search UX |
| **Scope** | Audit search scoring; normalize category aliases |
| **Out of scope** | Elasticsearch/Atlas Search (unless approved CR) |
| **Acceptance criteria** | Search audit doc with recommended MVP fixes |
| **Testing** | Search filter tests |
| **Risk** | Medium |

### #45 — DTO serializer consolidation

| Field | Detail |
| --- | --- |
| **GitHub** | [#45](https://github.com/Techware-Hut/mosaic-backend/issues/45) |
| **Status** | Deferred / Future Phase |
| **Problem** | Multiple response shapes across list endpoints |
| **Impact** | Frontend integration friction |
| **Scope** | Consolidate on `toPublicListingCard` / shared pagination wrapper |
| **Out of scope** | Removing legacy keys (backward compat required) |
| **Acceptance criteria** | Contract doc matches all public list endpoints |
| **Testing** | DTO test coverage for each listing type |
| **Risk** | Medium (breaking if done wrong) |

---

## 6. Observability / monitoring

### #18 — Sentry production deploy and verification

| Field | Detail |
| --- | --- |
| **GitHub** | [#18](https://github.com/Techware-Hut/mosaic-backend/issues/18) |
| **Status** | **Launch blocker** — code on `main`; EB DSN + event capture not verified |
| **Problem** | Sentry merged to `main`; not deployed/verified on EB |
| **Impact** | No prod error capture |
| **Scope** | EB deploy + verify DSN; optional debug route disabled in prod |
| **Out of scope** | Session replay |
| **Acceptance criteria** | Test error appears in Sentry dashboard; env vars in [production-env-checklist.md](production-env-checklist.md) |
| **Testing** | `tests/sentry/instrument.test.js`; manual debug route in staging only |
| **Risk** | Low |

### #58 — Structured logging and request correlation IDs

| Field | Detail |
| --- | --- |
| **GitHub** | [#58](https://github.com/Techware-Hut/mosaic-backend/issues/58) |
| **Status** | Deferred / Future Phase |
| **Problem** | `console.error` only; no request IDs |
| **Impact** | Hard to trace prod issues |
| **Scope** | Request ID middleware; structured JSON logs |
| **Out of scope** | Full log aggregation stack |
| **Acceptance criteria** | Request ID in logs and Sentry context |
| **Testing** | Middleware unit test |
| **Risk** | Low |

### #63 — Production smoke-test automation harness

| Field | Detail |
| --- | --- |
| **GitHub** | [#63](https://github.com/Techware-Hut/mosaic-backend/issues/63) |
| **Status** | Deferred / Future Phase |
| **Problem** | Smoke is manual curl/scripts |
| **Impact** | Slow release verification |
| **Scope** | Script or GHA job for P0–P2 tiers |
| **Out of scope** | Live Stripe charges in CI |
| **Acceptance criteria** | Runnable smoke script with PASS/FAIL report |
| **Testing** | CI dry-run against prod read-only endpoints |
| **Risk** | Low |

---

## 7. Future scope / change requests

### #35 — Reviews API

| Field | Detail |
| --- | --- |
| **GitHub** | [#35](https://github.com/Techware-Hut/mosaic-backend/issues/35) |
| **Status** | Change Request Required |
| **Problem** | Reviews partially implemented; no full MVP audit |
| **Impact** | Product ratings incomplete for launch |
| **Scope** | TBD per product owner — audit existing review routes first |
| **Out of scope** | Review follow-up emails (explicitly deferred in tests) |
| **Acceptance criteria** | PO sign-off on MVP review scope |
| **Risk** | Medium |

### #55 — OpenAPI / API contract documentation

| Field | Detail |
| --- | --- |
| **GitHub** | [#55](https://github.com/Techware-Hut/mosaic-backend/issues/55) |
| **Status** | Deferred / Future Phase |
| **Problem** | No machine-readable API spec |
| **Impact** | Frontend contract drift |
| **Scope** | Generate OpenAPI from route registry or hand-maintain core public routes |
| **Out of scope** | Auto-codegen of clients |
| **Acceptance criteria** | OpenAPI file for public browse + auth routes |
| **Risk** | Low |

### BusinessScreen API verification automation

| Field | Detail |
| --- | --- |
| **GitHub** | Not filed |
| **Status** | Change Request Required |
| **Problem** | Manual vendor verification only for MVP |
| **Impact** | Ops scale limit |
| **Scope** | External API integration — requires contract |
| **Out of scope** | MVP launch |
| **Acceptance criteria** | PO + legal approval |
| **Risk** | N/A (deferred) |

### Advanced geolocation / ZIP-radius search

| Field | Detail |
| --- | --- |
| **GitHub** | See [DECISION_REGISTER.md](DECISION_REGISTER.md) |
| **Status** | Deferred / Future Phase |
| **Problem** | ZIP exact match only |
| **Impact** | Limited local discovery |
| **Scope** | Geospatial indexes + radius query |
| **Out of scope** | MVP (documented in #29) |
| **Acceptance criteria** | CR approved |
| **Risk** | Medium |

### #52 — Controller/service boundary refactor

| Field | Detail |
| --- | --- |
| **GitHub** | [#52](https://github.com/Techware-Hut/mosaic-backend/issues/52) |
| **Status** | Deferred / Future Phase |
| **Problem** | Fat controllers; mixed concerns |
| **Impact** | Maintainability |
| **Scope** | Refactor plan only in Phase 2 |
| **Out of scope** | MVP launch changes |
| **Acceptance criteria** | Refactor plan doc with incremental milestones |
| **Risk** | High if done as big-bang |

---

## Recommended next five GitHub issues (priority order)

1. **#41** — Payment route protection (P0 security)
2. **#43** — Order email timing (P0 customer trust)
3. **#27** — Complete smoke proof pack (launch sign-off)
4. **#18** — Deploy and verify Sentry on EB
5. **#69** — Health/readiness endpoints

---

## Related docs

- [BACKEND_STABILITY_ROADMAP_AUDIT.md](BACKEND_STABILITY_ROADMAP_AUDIT.md)
- [BACKEND_STABILITY_PROOF.md](BACKEND_STABILITY_PROOF.md)
- [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md)
