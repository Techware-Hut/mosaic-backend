# Backend Next Launch Hardening Batch

**Created:** 2026-06-18  
**Context:** Issue [#80 CORS](https://github.com/Techware-Hut/mosaic-backend/issues/80) closed — 4/4 production CORS verified after EB env update.  
**Production API:** `https://api.mosaicbizhub.com`  
**EB runtime SHA:** `afa56ca`

This document indexes the next controlled backend launch-hardening work. **Each batch is a separate branch/PR** — do not combine.

---

## Completed

| Item | Status | Proof |
|------|--------|-------|
| CORS 4/4 on production | **DONE** | [`docs/CORS_PRODUCTION_SMOKE_PROOF.md`](CORS_PRODUCTION_SMOKE_PROOF.md) |
| EB `CORS_ORIGINS` + `FRONTEND_URL` | **DONE** | Release owner applied on `mosaic-backend-env` |
| Public smoke + health/readiness | **PASS** | [`docs/BACKEND_PRODUCTION_SMOKE_PROOF.md`](BACKEND_PRODUCTION_SMOKE_PROOF.md) |

---

## Batch A — Authenticated smoke unblock

| Field | Value |
|-------|-------|
| Branch | `chore/backend-smoke-token-harness` |
| Owner | Backend + release owner (test account provisioning) |
| Scope | Document smoke token env vars; optional CLI params on smoke script |

### Required environment variables (never commit values)

| Variable | Role | Used by |
|----------|------|---------|
| `SMOKE_TEST_CUSTOMER_TOKEN` | Customer JWT or session token | P2.2 auth/check |
| `SMOKE_TEST_VENDOR_TOKEN` | Vendor (`business_owner`) token | P2.3 auth/check |
| `SMOKE_TEST_ADMIN_TOKEN` | Admin token | P2.4 auth/check |
| `SMOKE_TEST_PRODUCT_ID` | Optional public product ID | P1 product detail |
| `FRONTEND_ORIGIN` | Optional CORS probe origin | P0.4 CORS preflight |

See [`docs/SMOKE_TEST_TOKENS.md`](SMOKE_TEST_TOKENS.md) for setup steps.

### Acceptance

- When tokens are supplied (env or script params), P2.2–P2.4 run instead of BLOCKED.
- No real secrets in repo, docs, or CI logs.
- No changes to payment/checkout/webhook/order/Stripe logic.

---

## Batch B — Sentry production proof

| Field | Value |
|-------|-------|
| Branch | Docs update (see Batch C runbook or [`docs/SENTRY_EB_DEPLOY_VERIFICATION.md`](SENTRY_EB_DEPLOY_VERIFICATION.md)) |
| Owner | Release owner (AWS Console + Sentry dashboard) |
| Scope | Safe production probes; dashboard validation steps |

### Checks

| Check | Expected | Owner | Status |
|-------|----------|-------|--------|
| `GET /internal/sentry-debug` on prod | **404** | Agent (curl) | **PASS** — route disabled at launch |
| Unauth 401 bodies | No stack trace | Agent | **PASS** |
| EB `SENTRY_*` env names documented | Names only | Docs | **PASS** — see Sentry doc |
| Sentry dashboard event capture | Event visible | Release owner | **BLOCKED** — no dashboard access in agent env |
| `ENABLE_SENTRY_DEBUG_ROUTE` in prod | **false/unset** | Release owner | **BLOCKED** — AWS CLI unavailable |

### Acceptance

- Sentry proof doc clearly marks PASS/BLOCKED per check with owner action.
- Do **not** enable production debug route unless explicitly approved for a one-time verification window.

---

## Batch C — Backend deployment workflow documentation

| Field | Value |
|-------|-------|
| Branch | `docs/backend-deploy-runbook` |
| Owner | Backend |
| Scope | Manual EB deploy runbook |

### Acceptance

- Documents [`.github/workflows/deploy-eb-production.yml`](../.github/workflows/deploy-eb-production.yml) is **`workflow_dispatch` only** (push to `main` commented out).
- Exact deploy commands, post-deploy probes, rollback steps, EB env update pattern (CORS).
- Release owner can deploy without guessing.

See [`docs/BACKEND_EB_DEPLOY_RUNBOOK.md`](BACKEND_EB_DEPLOY_RUNBOOK.md) (created in Batch C PR).

---

## Batch D — Route contract / API docs follow-up

| Field | Value |
|-------|-------|
| Branch | `docs/backend-route-contract-followup` |
| Owner | Backend |
| Scope | Clarify featured + ranked routes for frontend |

### Canonical routes (do not change backend)

| Route | Status | Notes |
|-------|--------|-------|
| `GET /api/featured-products` | **Canonical** | Featured carousel — do not add `/api/products/featured` |
| `GET /api/ranked` | **Canonical** | Ranked products browse |
| `GET /api/products/ranked` | **404 / stale** | Frontend must not use |

### Acceptance

- Frontend team has unambiguous route table in [`docs/BACKEND_FRONTEND_ROUTE_CONTRACT.md`](BACKEND_FRONTEND_ROUTE_CONTRACT.md).

---

## Remaining launch blockers (post-CORS)

| Blocker | Batch | Owner | Action |
|---------|-------|-------|--------|
| Authenticated smoke tokens | A | Release owner | Create test accounts; set env vars locally/CI secret |
| Sentry dashboard proof | B | Release owner | Verify event in Sentry after deploy; confirm EB env names |
| Deploy runbook | C | Backend | Merge runbook PR |
| Route ambiguity | D | Backend | Merge route contract follow-up PR |
| GHA CORS probe (2 origins only) | Future | Backend | Optional: extend deploy workflow to probe all 4 origins |

---

## References

- [`docs/BACKEND_DEPLOYMENT_PROOF.md`](BACKEND_DEPLOYMENT_PROOF.md)
- [`docs/BACKEND_PRODUCTION_SMOKE_PROOF.md`](BACKEND_PRODUCTION_SMOKE_PROOF.md)
- [`scripts/smoke-backend.ps1`](../scripts/smoke-backend.ps1)
- [`docs/ENV_VAR_INVENTORY.md`](ENV_VAR_INVENTORY.md)
