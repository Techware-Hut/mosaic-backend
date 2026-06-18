# Backend Batch 3 — Deploy, Smoke, and Sentry Audit

**Branch:** `sprint/backend-deploy-smoke-sentry-18-27`  
**Base:** `main` @ `fbe3aac` (merge of [PR #78](https://github.com/Techware-Hut/mosaic-backend/pull/78))  
**Date:** 2026-06-18  
**Issues:** #18 (Sentry EB verify), #27 (full P0–P6 smoke proof)

---

## Branch and commit state

| Item | Value |
| --- | --- |
| Batch 1 | `5e6995e` — marketplace visibility, pagination caps, security middleware |
| Batch 2 | `c775a3b` — #41 payment routes, #43 order email timing, #69 health/readiness |
| Merge to `main` | `fbe3aac` — PR #78 merged |
| Batch 3 branch | `sprint/backend-deploy-smoke-sentry-18-27` (docs + smoke scripts) |
| Stacked? | Batch 1 + 2 **merged** to `main`; Batch 3 stacks on `main` |

Prior proof packs:

- [BACKEND_STABILITY_PROOF.md](BACKEND_STABILITY_PROOF.md) — Batch 1, 178/178 tests
- [BACKEND_LAUNCH_BLOCKERS_BATCH_2_PROOF.md](BACKEND_LAUNCH_BLOCKERS_BATCH_2_PROOF.md) — Batch 2, 190/190 tests

---

## Production API baseline (live probe — 2026-06-18)

**Canonical URL:** `https://api.mosaicbizhub.com`

| Check | Expected (post PR #78) | Actual | Notes |
| --- | --- | --- | --- |
| `GET /` | 200 JSON | **200** | Legacy message: `"Mosaic Biz Hub API is working 9 feb "` |
| `GET /api/health` | 200 `{ status: ok }` | **404** | Not deployed to EB yet |
| `GET /api/ready` | 200 + DB connected | **404** | Not deployed to EB yet |
| `GET /api/users/auth/check` (no cookie) | 401 | **401** | Auth middleware OK |
| Public marketplace GETs | 200 | **200** | featured, products, search, services, food |

**Conclusion:** Production is reachable and browse/auth probes pass, but **EB is not running PR #78** (health/readiness missing). Do not sign off #69 or post-#78 smoke until GHA deploy of `fbe3aac` completes.

---

## Existing deployment workflow

| Item | Detail |
| --- | --- |
| Workflow | [`.github/workflows/deploy-eb-production.yml`](../.github/workflows/deploy-eb-production.yml) |
| Trigger | Manual `workflow_dispatch` only (push-to-main disabled) |
| Pre-deploy | `npm ci` + `npm test` in GHA |
| Package | `deploy.zip` (excludes tests, docs, `.env*`) |
| EB application | `mosaic-biz-hub-backend` (var override) |
| EB environment | `mosaic-backend-env` (var override) |
| Region | `us-east-1` |
| Version label | `mosaic-<github.sha>` |
| Post-deploy probes | `GET /` (200), unauth `auth/check` (401) — **does not probe `/api/health` or `/api/ready`** |

Setup: [github-actions-eb-setup.md](github-actions-eb-setup.md)  
Runbook: [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md)  
Verification log: [deploy-verification.md](deploy-verification.md)

---

## Sentry package and config status

| Item | Status |
| --- | --- |
| Package | `@sentry/node` ^10.58.0 in [package.json](../package.json) |
| Init | [instrument.js](../instrument.js) — env-gated via `SENTRY_DSN` |
| Bootstrap order | [index.js](../index.js) loads `./instrument` before `./app` |
| HTTP 5xx capture | [middlewares/sentryHttpCapture.js](../middlewares/sentryHttpCapture.js) |
| Error handler | [app.js](../app.js) — `Sentry.setupExpressErrorHandler(app)` |
| Debug route | `GET /internal/sentry-debug` when `ENABLE_SENTRY_DEBUG_ROUTE=true` |
| Tests | [tests/sentry/instrument.test.js](../tests/sentry/instrument.test.js) |
| Env names | `.env.example`, [production-env-checklist.md](production-env-checklist.md) § Observability |
| EB production verify | **Not confirmed** — #18 open until DSN set + event captured |

Detail: [SENTRY_EB_DEPLOY_VERIFICATION.md](SENTRY_EB_DEPLOY_VERIFICATION.md)

---

## Existing smoke test coverage

| Asset | Coverage |
| --- | --- |
| [production-smoke-checklist.md](production-smoke-checklist.md) | Tiered P0–P6 manual checklist |
| [MVP_BACKEND_SMOKE_PROOF_PACK.md](MVP_BACKEND_SMOKE_PROOF_PACK.md) | Jun 17 browse/auth/CORS evidence (pre PR #78) |
| [scripts/verify-auth-check-smoke.js](../scripts/verify-auth-check-smoke.js) | Auth check + frontend page loads (needs Mongo + JWT_SECRET) |
| **New (Batch 3)** | [scripts/smoke-backend.ps1](../scripts/smoke-backend.ps1), [scripts/smoke-backend.sh](../scripts/smoke-backend.sh) |
| **New (Batch 3)** | [BACKEND_FULL_SMOKE_PROOF_PACK.md](BACKEND_FULL_SMOKE_PROOF_PACK.md) — P0–P6 matrix |

---

## Missing credentials / access / accounts

| Gap | Impact | Owner |
| --- | --- | --- |
| EB deploy of `fbe3aac` | `/api/health`, `/api/ready`, payment/auth fixes not live | Deployment owner |
| Sentry dashboard + EB `SENTRY_DSN` | Cannot close #18 | DevOps |
| `SMOKE_TEST_CUSTOMER_TOKEN` | P2–P4 auth/checkout smoke blocked | QA |
| `SMOKE_TEST_VENDOR_TOKEN` | P3 vendor profile smoke blocked | QA |
| `SMOKE_TEST_ADMIN_TOKEN` | P5 admin smoke blocked | QA |
| Stripe test-mode checkout approval | P4 live charge smoke blocked | Release owner |
| EB boot logs / Atlas index verify | P6 infra evidence incomplete | DevOps |
| Hosted staging | No pre-prod environment — [hosted-staging-decision.md](hosted-staging-decision.md) | N/A |

---

## Risks before deploy

1. **Stale production SHA** — health endpoints 404 proves PR #78 not on EB.
2. **GHA post-deploy gap** — workflow does not fail if `/api/health` missing.
3. **Sentry DSN unset** — no production error capture until EB env configured.
4. **Webhook raw-body order** — Stripe webhooks mounted before `express.json()` in [app.js](../app.js); do not reorder middleware during deploy fixes.
5. **Smoke account gap** — P2–P5 tiers remain Blocked without dedicated tokens.
6. **Billing IDOR (#66/#76)** — deferred unless smoke exposes active escalation.

---

## Related Batch 3 deliverables

| Doc | Purpose |
| --- | --- |
| [SENTRY_EB_DEPLOY_VERIFICATION.md](SENTRY_EB_DEPLOY_VERIFICATION.md) | #18 verification steps |
| [BACKEND_FULL_SMOKE_PROOF_PACK.md](BACKEND_FULL_SMOKE_PROOF_PACK.md) | #27 P0–P6 matrix |
| [EB_DEPLOYMENT_READINESS_CHECKLIST.md](EB_DEPLOYMENT_READINESS_CHECKLIST.md) | Pre/post deploy checklist |
| [BACKEND_REMAINING_BLOCKERS_AFTER_BATCH_3.md](BACKEND_REMAINING_BLOCKERS_AFTER_BATCH_3.md) | Post-Batch 3 classification |

---

## Commands for deployment owner (post-merge)

```powershell
# 1. Trigger GHA: Deploy to Elastic Beanstalk on main @ fbe3aac

# 2. After deploy, verify:
$Base = "https://api.mosaicbizhub.com"
Invoke-RestMethod "$Base/api/health"
Invoke-RestMethod "$Base/api/ready"

# 3. Run smoke helper:
./scripts/smoke-backend.ps1 -ApiBaseUrl $Base
```

Evidence required: GHA run URL, EB version label `mosaic-fbe3aac`, smoke script output, Sentry event screenshot (redacted).

---

## Batch 3 test and smoke results (2026-06-18)

| Command | Result |
| --- | --- |
| `npm test` | **190/190 pass** |
| `npm run lint` | Not defined |
| `npm run build` | Not defined |
| `./scripts/smoke-backend.ps1 -ApiBaseUrl https://api.mosaicbizhub.com` | **8 pass, 2 fail** (P0.2/P0.3 health 404), 3 blocked, 1 skip, exit 1 |
| `./scripts/smoke-backend.ps1 -ApiBaseUrl http://localhost:3001` | **Fail** (500 on all routes) — `express-mongo-sanitize` + Express 5 GET request incompatibility on PR #78 code; not introduced in Batch 3 |

Production smoke output (expected failures until EB deploy):

```
PASS  P0.1 GET / (200)
FAIL  P0.2 GET /api/health (404, expected 200)
FAIL  P0.3 GET /api/ready (404, expected 200)
PASS  P2.1, P1 (5 endpoints), P4.2 unauth 401
BLOCKED  P2.2-P2.4 (no SMOKE_TEST_* tokens)
```
