# GitHub Issue Triage — 2026-06-18

**Repo:** Techware-Hut/mosaic-backend  
**Evidence base:** `main` @ `fbe3aac` (PR #78), Batch 3 @ `sprint/backend-deploy-smoke-sentry-18-27`  
**Production API:** `https://api.mosaicbizhub.com` (health/ready 404 until EB deploy)

---

## Closed (code complete)

| Issue | Action | Evidence |
| --- | --- | --- |
| #41 | Closed | PR #78, `tests/stripe/payment-route-protection.test.js` |
| #43 | Closed | PR #78, `paidConfirmationEmailSentAt`, `tests/stripe/order-email-safety.test.js` |
| #69 | Closed | PR #78, `routes/healthRoutes.js`, `tests/health/health-readiness.test.js` |
| #20 | Closed | Rollback documented in `docs/PRODUCTION_RUNBOOK.md` |

## Reopened (verification incomplete)

| Issue | Action | Reason |
| --- | --- | --- |
| #18 | Reopened | Sentry code on `main`; EB DSN + event capture not verified |
| #27 | Reopened | Batch 3 smoke matrix started; P0 health fail on prod; P2–P5 blocked |

## Commented — partial progress (remain open)

| Issue | Lane | Notes |
| --- | --- | --- |
| #57 | Security | [REQUEST_VALIDATION_RATE_LIMIT_AUDIT.md](REQUEST_VALIDATION_RATE_LIMIT_AUDIT.md); Express 5 body/params sanitize; `express.json({ limit: '1mb' })` |
| #53 | Performance | [DATABASE_INDEX_AUDIT.md](DATABASE_INDEX_AUDIT.md); Product indexes in place; Service/Food gaps + Atlas explain deferred |
| #59 | Platform | [WEBHOOK_ASYNC_READINESS_AUDIT.md](WEBHOOK_ASYNC_READINESS_AUDIT.md); queue migration deferred |

## Closed — batch 3 (2026-06-18)

| Issue | Action | Evidence |
| --- | --- | --- |
| #77 | Closed | [MARKETPLACE_VISIBILITY_MATRIX.md](MARKETPLACE_VISIBILITY_MATRIX.md) + marketplace tests |
| #44 | Closed | [PUBLIC_API_PAGINATION_AUDIT.md](PUBLIC_API_PAGINATION_AUDIT.md); all public lists capped |
| #67 | Closed | [MVP_BACKEND_EMAIL_NOTIFICATIONS.md](MVP_BACKEND_EMAIL_NOTIFICATIONS.md) synced post-#43 |
| #65 | Closed | [VENDOR_ONBOARDING_STATE_GAP_AUDIT.md](VENDOR_ONBOARDING_STATE_GAP_AUDIT.md) vs [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md) |

## Verification (batch 3)

| Check | Result |
| --- | --- |
| `npm test` | **190/190** pass |
| `npm run smoke:backend` (prod) | **9 pass**, 2 fail (`/api/health`, `/api/ready` 404 — EB not deployed), 3 blocked (tokens) |

## Commented — partial progress (batch 1, superseded by batch 3 docs)

| Issue | Lane | Notes |
| --- | --- | --- |
| #63 | Automation | Smoke scripts closed batch 2; see batch 3 verification |

## Commented — deferred post-launch (remain open)

#34, #35, #45, #46, #51, #52, #54, #55, #56, #58, #60, #66, #68, #70, #71, #72, #73, #74, #76 — see [BACKEND_REMAINING_BLOCKERS_AFTER_BATCH_3.md](BACKEND_REMAINING_BLOCKERS_AFTER_BATCH_3.md)

## Closed — batch 2 (2026-06-18)

| Issue | Action | Evidence |
| --- | --- | --- |
| #63 | Closed | `scripts/smoke-backend.*`, `npm run smoke:backend`, CORS check, `docs/BACKEND_FULL_SMOKE_PROOF_PACK.md` |
| #64 | Closed | `docs/ENV_VAR_INVENTORY.md` |
| #21 | Closed | CORS in smoke scripts + GHA post-deploy probe in `deploy-eb-production.yml` |
| #23 | Closed | `docs/PUSH_TO_MAIN_DEPLOY_CRITERIA.md` |
| #75 | Closed | `docs/BACKUP_ROLLBACK_RUNBOOK.md` |

## Commented — ops blocked (remain open)

| Issue | Owner |
| --- | --- |
| #18 | DevOps — Sentry EB DSN + event ([SENTRY_EB_DEPLOY_VERIFICATION.md](SENTRY_EB_DEPLOY_VERIFICATION.md)) |
| #27 | QA + DevOps — EB deploy + smoke tokens ([BACKEND_FULL_SMOKE_PROOF_PACK.md](BACKEND_FULL_SMOKE_PROOF_PACK.md)) |
| #19 | DevOps — IAM tighten after deploy validation |

---

See [BACKEND_REMAINING_BLOCKERS_AFTER_BATCH_3.md](BACKEND_REMAINING_BLOCKERS_AFTER_BATCH_3.md) for full classification.
