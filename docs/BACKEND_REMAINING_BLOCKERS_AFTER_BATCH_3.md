# Backend Remaining Blockers After Batch 3

**Branch:** `sprint/backend-deploy-smoke-sentry-18-27`  
**Base:** `main` @ `fbe3aac`  
**Date:** 2026-06-18  
**Batch 3 deliverables:** deploy/smoke/Sentry verification docs + smoke scripts

Related: [BACKEND_BATCH_3_DEPLOY_SMOKE_AUDIT.md](BACKEND_BATCH_3_DEPLOY_SMOKE_AUDIT.md), [BACKEND_FULL_SMOKE_PROOF_PACK.md](BACKEND_FULL_SMOKE_PROOF_PACK.md)

---

## Launch blockers

| Issue | Title | Status | Owner | Next action |
| --- | --- | --- | --- | --- |
| **#18** | Sentry EB deploy + verification | Code on `main`; EB DSN unset; event not captured | DevOps | Set EB env vars; run [SENTRY_EB_DEPLOY_VERIFICATION.md](SENTRY_EB_DEPLOY_VERIFICATION.md); disable debug route |
| **#27** | Full P0–P6 smoke proof | Matrix started; P0 health **Fail** on prod; P2–P5 **Blocked** | QA + DevOps | Deploy PR #78 to EB; provision `SMOKE_TEST_*` tokens; fill [BACKEND_FULL_SMOKE_PROOF_PACK.md](BACKEND_FULL_SMOKE_PROOF_PACK.md) |
| **EB deploy gap** | PR #78 not live on production | `/api/health`, `/api/ready` return 404 | Deployment owner | GHA `workflow_dispatch` on `main` @ `fbe3aac` |

### Code complete — pending prod verify only

| Issue | Title | Evidence |
| --- | --- | --- |
| **#41** | Payment route protection | PR #78, `tests/stripe/payment-route-protection.test.js` |
| **#43** | Order email timing | PR #78, `paidConfirmationEmailSentAt`, `tests/stripe/order-email-safety.test.js` |
| **#69** | Health/readiness | PR #78, `routes/healthRoutes.js`, `tests/health/health-readiness.test.js` |

---

## High-priority post-launch

| Issue | Title | Classification | Notes |
| --- | --- | --- | --- |
| **#34** | Admin dashboard APIs | Post-launch feature | Partial MVP admin routes exist |
| **#65** | Vendor onboarding state machine | Post-launch audit | Document gaps; fix defects only |
| **#66** | Admin authorization matrix | Post-launch security | Route audit + 403 tests; not escalated by smoke |
| **#67** | Email template cleanup | Post-launch quality | Inventory mailers |
| **#68** | Order lifecycle audit | Post-launch quality | Status transition doc |
| **#76** | Vendor plan / subscription lifecycle | Post-launch audit | Includes billing portal scope; **not treated as launch blocker** unless smoke proves IDOR |

---

## Deferred / future phase

| Issues | Theme |
| --- | --- |
| **#35** | Reviews API — out of Batch 3 scope |
| **#44**, **#53**, **#54**, **#57**, **#77** | Partial Batch 1 fixes; remaining AC deferred |
| **#45**, **#46** | DTO / validation consistency |
| **#51**–**#52**, **#56**, **#58**–**#60**, **#70**–**#75** | Platform audits, logging, test harness, backup runbook |
| **#63** | Smoke automation harness — Batch 3 added scripts; full GHA automation deferred |

---

## Change request

| Issue | Title | Notes |
| --- | --- | --- |
| **#72** | Search relevance / taxonomy | May need Atlas Search or scoring CR |
| **#54** | Media payload optimization | Card vs detail payload shaping |

---

## Needs client input

| Item | Question |
| --- | --- |
| Stripe test-mode checkout smoke | Written approval for prod test charges? |
| Launch frontend origin | Confirm canonical Vercel URL for CORS smoke |
| Admin dashboard MVP scope | Which #34 endpoints are launch-required vs post-launch? |

---

## Needs developer / access input

| Gap | Blocks | Owner |
| --- | --- | --- |
| EB deploy of `fbe3aac` | #69, #41, #43 prod verify | Deployment owner |
| Sentry dashboard + EB DSN | #18 | DevOps |
| `SMOKE_TEST_CUSTOMER_TOKEN` etc. | #27 P2–P5 | QA |
| EB boot logs | P6 log hygiene | DevOps |
| Atlas index verification | P6.6 | DBA / DevOps |
| **#19** IAM tighten | Ops hardening | DevOps |
| **#20** Rollback doc | Partially in runbook | Docs owner |
| **#21** CORS GHA smoke | Automation | DevOps |
| **#23** Push-to-main criteria | Deploy policy | Release owner |

---

## Failed smoke items (production 2026-06-18)

| ID | Result | Root cause |
| --- | --- | --- |
| P0.2 `/api/health` | **Fail** 404 | EB not on PR #78 |
| P0.3 `/api/ready` | **Fail** 404 | EB not on PR #78 |

All other prod probes run in Batch 3: P0.1, P1 public lists, P2.1 **Pass**.

---

## Unresolved checkout/payment defects

None found in Batch 3 smoke — payment/email fixes are on `main` awaiting EB deploy. No code changes made in Batch 3.

---

## Recommended close order (GitHub)

1. Deploy `fbe3aac` to EB
2. Close **#69**, **#41**, **#43** with prod smoke evidence
3. Complete **#27** matrix → close or reopen with full evidence
4. Complete **#18** Sentry verify → close
5. Triage **#51–#77** audit backlog as post-launch (separate sprint)

---

## Branch PR readiness

**Safe to open PR** for Batch 3: docs + smoke scripts only, no payment logic changes, no secrets.

Suggested title: `chore: add backend deploy smoke and sentry verification pack`
