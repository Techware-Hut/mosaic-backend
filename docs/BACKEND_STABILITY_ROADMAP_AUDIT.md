# Backend Stability Roadmap Audit

**Branch:** `sprint/backend-stability-roadmap-cleanup`  
**Date:** 2026-06-18  
**Production API:** `https://api.mosaicbizhub.com` (deploy SHA `7d01011`)  
**`main` HEAD:** `a03305a` (Sentry #18 merged; EB deploy pending)

This document synthesizes the MVP doc set, open GitHub issues, and a targeted code scan. For live sprint state, see [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md).

---

## What exists

| Area | Status | Reference |
| --- | --- | --- |
| Full marketplace REST API | Implemented | [MVP_BACKEND_API_AUDIT.md](MVP_BACKEND_API_AUDIT.md) |
| Public listing DTO contract | Merged (#28) | [MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md](MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md) |
| Canonical featured route | `GET /api/featured-products` | [routes/featuredProductRoutes.js](../routes/featuredProductRoutes.js) |
| Search/filter (ZIP exact, no radius) | Merged (#29) | [MVP_BACKEND_SEARCH_FILTER_READINESS.md](MVP_BACKEND_SEARCH_FILTER_READINESS.md) |
| Vendor onboarding + emails | Merged (#30) | [MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md](MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md) |
| Vendor self-service APIs | Merged (#31) | [MVP_BACKEND_VENDOR_SELF_SERVICE_APIS.md](MVP_BACKEND_VENDOR_SELF_SERVICE_APIS.md) |
| Stripe Connect runtime | Merged (#32, #42) | [MVP_BACKEND_STRIPE_CONNECT_RUNTIME_VERIFICATION.md](MVP_BACKEND_STRIPE_CONNECT_RUNTIME_VERIFICATION.md) |
| Email notification audit | Merged (#33) | [MVP_BACKEND_EMAIL_NOTIFICATIONS.md](MVP_BACKEND_EMAIL_NOTIFICATIONS.md) |
| Automated tests | 173 tests (`npm test`) | [TEST_MATRIX.md](TEST_MATRIX.md) |
| Agent guardrails | Documented | [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md), [LLM_CONTEXT.md](LLM_CONTEXT.md) |
| Sentry SDK | On `main`, not prod-verified | [instrument.js](../instrument.js), issue #18 |

---

## What is working

- **Browse/auth/CORS smoke (Tier A–D):** PASS on commit `7201f97` — [MVP_BACKEND_SMOKE_PROOF_PACK.md](MVP_BACKEND_SMOKE_PROOF_PACK.md)
- **Public list endpoints** scope to `Business.isActive: true` via `getVisibleBusinessIds()` in [controllers/publicListing.js](../controllers/publicListing.js)
- **Listing DTOs** normalize card/detail fields via [lib/listing/publicListingDto.js](../lib/listing/publicListingDto.js)
- **Vendor approve/reject emails** wired with tests in `tests/admin/vendor-onboarding-finalize.test.js`
- **Checkout guards** block unapproved vendors at payment time (#42)
- **Search pagination cap** at 50 in [lib/listing/publicSearchFilters.js](../lib/listing/publicSearchFilters.js)
- **Ranked pagination cap** at 60 in [controllers/productListingController.js](../controllers/productListingController.js)
- **Health probe:** `GET /` returns 200 JSON (P0.1 in smoke checklist)
- **CORS allowlist** includes launch frontend `https://mosaic-biz-frontend-launch.vercel.app`

---

## What is fragile (addressed in this sprint)

| Issue | Risk | Fix in this branch |
| --- | --- | --- |
| Featured products omit inactive-business filter | Inactive vendor featured items may appear | Add `businessId: { $in: activeIds }` in featured controller |
| Public search with no filters skips business scope | Unscoped listings when no location/tag/verified params | Default `allowedBusinessIds` to `getVisibleBusinessIds()` |
| Ranked simple path omits `isPublished` | Unpublished products in ranked feed | Add `isPublished: true` to find/count and aggregation |
| Featured/list limits uncapped | Large payloads, slow responses | Cap `limit` at 50 on featured and list handlers |
| Product model lacks compound indexes | Slow featured/list queries at scale | Add Mongoose indexes on hot filter fields |
| `mongo-sanitize` / `xss-clean` imported but not mounted | Input sanitization gap | Mount after `express.json()` (webhooks stay raw) |

---

## What is missing or incomplete

| Gap | Impact | Tracked |
| --- | --- | --- |
| Full P0–P6 prod smoke | Launch sign-off incomplete | #27, [production-smoke-checklist.md](production-smoke-checklist.md) |
| `SMOKE_TEST_*` prod accounts | Checkout/vendor tier smoke SKIP | [deploy-verification.md](deploy-verification.md) |
| Payment route auth on legacy `/stripe/*` | Security exposure | #41 |
| Order email timing before payment confirm | Wrong email timing | #43 |
| Live SMTP inbox proof on prod | Email delivery unverified | #33 docs |
| Admin aggregation APIs | Admin dashboard gaps | #34 |
| Reviews API/tests | Reviews not MVP-complete | #35 |
| Sentry on production EB | Observability gap | #18 (deploy pending) |
| Dedicated `/api/health` | Minimal diagnostics | #69 |
| OpenAPI / contract docs | No machine-readable API spec | #55 |
| Geolocation / ZIP-radius search | ZIP exact only (by design) | [DECISION_REGISTER.md](DECISION_REGISTER.md) |
| BusinessScreen API verification | Manual review for MVP | Deferred |

---

## Fix now (this sprint)

1. Public visibility consistency (featured, search default scope, ranked `isPublished`)
2. Pagination max guards on featured and list endpoints
3. Product compound indexes (Mongoose schema)
4. Mount security sanitization middleware
5. Tests + proof docs for all of the above

---

## Verify now (document only — no blind rewrites)

| Area | Action | Reference |
| --- | --- | --- |
| Stripe checkout / Connect / webhooks | Confirm runtime docs match code; no code changes | [MVP_BACKEND_STRIPE_CONNECT_RUNTIME_VERIFICATION.md](MVP_BACKEND_STRIPE_CONNECT_RUNTIME_VERIFICATION.md) |
| Vendor approve/reject flow | Rely on existing unit tests | `tests/admin/vendor-onboarding-finalize.test.js` |
| CORS | Already smoke-verified | Smoke Tier D |
| Sentry wiring | Code review + env var checklist; prod deploy separate | `.env.example`, #18 |
| Public browse vs `isApproved` | Browse gates on `isActive`; checkout gates on `isApproved` — intentional | [utils/checkoutGuards.js](../utils/checkoutGuards.js) |

---

## Defer / change request

| Item | Status | Issue |
| --- | --- | --- |
| Payment route hardening | Separate security PR | #41 |
| Order email idempotency | Post-launch hardening | #43 |
| Full error response normalization | Large pass | #46 |
| DTO consolidation | Large pass | #45 |
| Controller/service refactor | Future | #52 |
| BusinessScreen automation | Change request / future phase | DECISION_REGISTER |
| Geolocation radius | Deferred | #29, DECISION_REGISTER |
| Reviews system | Not started | #35 |
| OpenAPI generation | Docs-only future | #55 |
| Dead route cleanup | Audit first | #60 |

---

## Risks before production testing

1. **Production is first integrated environment** — no hosted staging ([hosted-staging-decision.md](hosted-staging-decision.md))
2. **Prod SHA lags `main`** — Sentry and this sprint’s fixes not live until EB deploy
3. **Unauthenticated payment/stripe routes** (#41) — P0 security follow-up
4. **Partial smoke evidence** — browse PASS; checkout/email tiers need test accounts
5. **Empty featured feed in prod DB** — route healthy; frontend must handle empty array
6. **`getVisibleBusinessIds()` per request** — acceptable for MVP; cache later (#44)

---

## Open GitHub issues map (sample)

| Priority | Issues |
| --- | --- |
| Launch blockers | #41, #43, #27, #69 |
| Post-launch high | #34, #65, #66 |
| Performance | #44, #53, #54 |
| Vendor/admin | #76, #67, #77 |
| Marketplace | #72, #45 |
| Observability | #18, #58, #63 |
| Future | #55, #52, #35, BusinessScreen, geolocation |

Full issue plan: [BACKEND_ROADMAP_ISSUES.md](BACKEND_ROADMAP_ISSUES.md)

---

## Related documentation

- [BACKEND_STABILITY_PROOF.md](BACKEND_STABILITY_PROOF.md) — test and manual verification evidence
- [BACKEND_STABILITY_AGENT_PROMPT.md](BACKEND_STABILITY_AGENT_PROMPT.md) — reusable agent prompt
- [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) — canonical sprint hub
