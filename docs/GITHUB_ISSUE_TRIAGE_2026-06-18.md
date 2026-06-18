# GitHub Issue Triage — 2026-06-18

**Repo:** Techware-Hut/mosaic-backend  
**Evidence base:** `main` @ `fbe3aac` (PR #78), Batch 3 @ `1a02332`  
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
| #44 | Performance | Batch 1 pagination caps; unified helper deferred |
| #53 | Performance | Product indexes added; Atlas explain deferred |
| #57 | Security | mongo-sanitize/xss mounted; **Express 5 body/params-only fix** in `app.js`; rate-limit audit open |
| #63 | Automation | `scripts/smoke-backend.*` added; GHA automation deferred (#21) |
| #77 | Marketplace | Batch 1 visibility hardening; moderation matrix deferred |

## Commented — deferred post-launch (remain open)

#34, #35, #45, #46, #51, #52, #54, #55, #56, #58, #59, #60, #65, #66, #67, #68, #70, #71, #72, #73, #74, #76

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
| #19 | DevOps — IAM tighten after deploy validation |
| #21 | DevOps — CORS GHA smoke |
| #23 | Release owner — push-to-main criteria |

---

See [BACKEND_REMAINING_BLOCKERS_AFTER_BATCH_3.md](BACKEND_REMAINING_BLOCKERS_AFTER_BATCH_3.md) for full classification.
