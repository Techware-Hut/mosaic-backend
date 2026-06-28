# Backend Documentation Consolidation - 2026-06-28

**Purpose:** record what is current, what is historical, and what changed during the documentation drift cleanup.

---

## Current Truth

| Area | Current source |
| --- | --- |
| Status | [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) |
| Docs index | [README.md](README.md) |
| Platform behavior | [PLATFORM_OPERATING_MODEL.md](PLATFORM_OPERATING_MODEL.md) |
| Deployment | [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md), [BACKEND_EB_DEPLOY_RUNBOOK.md](BACKEND_EB_DEPLOY_RUNBOOK.md), [../DEPLOYMENT.md](../DEPLOYMENT.md) |
| Route/API contract | [API_SURFACE.md](API_SURFACE.md), [contracts/BACKEND_ROUTE_MANIFEST.md](contracts/BACKEND_ROUTE_MANIFEST.md) |

---

## Consolidation Decisions

| Drift found | Decision |
| --- | --- |
| `MVP_BACKEND_PROGRAM_STATUS.md` still described June 18 sprint state | Replaced it with the 2026-06-28 production state. |
| Older proof packs contain old production SHAs and app-domain references | Keep as evidence only; current status lives in the program status hub. |
| Frontend backend-coordination issues were parked in frontend repo | Moved remaining backend work into backend issues #151-#155. |
| Apex/domain docs mixed current and pre-cutover language | Current policy is now summarized in the status hub and docs index. |
| `www.mosaicbizhub.com` policy was easy to overclaim | Documented as alias/redirect target, not a credentialed API origin. |
| README/SETUP still hard-coded old test counts | Replaced with command-level guidance and moved exact counts to release evidence. |
| Architecture docs had stale sanitizer mounting language | Updated current docs to show `express-mongo-sanitize` and `xss-clean` are mounted after `express.json()` and after raw Stripe webhook routes. |
| Architecture/LLM docs still said Sentry was planned on an unmerged branch | Updated current docs to show `instrument.js`, Sentry Express error handling, and HTTP 5xx capture are live when Sentry env enables them. |
| Docs home duplicated exact production SHA and EB version | Kept exact release metadata in [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) and proof packs; docs home now links there instead of duplicating volatile values. |
| Test matrix mixed historical counts across many PRs | Rewrote the test matrix around scripts, CI jobs, smoke tiers, and evidence rules so counts are recorded per run instead of copied forward. |
| Decision register still listed no-CI and sanitizer mounting as open blockers | Updated release decisions to GitHub Actions EB deploy, CI coverage, and closed sanitizer mounting with links to live code/docs. |
| Production runbook mixed old manual deploy wording with newer GHA steps | Aligned the release path and execution phase around automated `main` -> EB deploy plus deployment-owner SHA confirmation. |
| Historical launch/deploy logs contained old no-CI/manual-deploy claims | Added historical snapshot/evidence-log notes and rephrased audit rows so they do not read like current operating truth. |
| Push-to-main deploy criteria still read like push deploy was disabled | Reframed it as the active operating criteria for an enabled `main` deploy workflow, with re-enable steps only for future rollback/disables. |
| Stability proof and Asana evidence docs carried old test/deploy/Sentry snapshots | Marked them as historical evidence and redirected current readers to the test matrix, production runbook, and program status. |

---

## Still Current And Useful

- [API_SURFACE.md](API_SURFACE.md)
- [AUTH_FLOW.md](AUTH_FLOW.md)
- [BACKEND_EB_DEPLOY_RUNBOOK.md](BACKEND_EB_DEPLOY_RUNBOOK.md)
- [BACKEND_FRONTEND_ROUTE_CONTRACT.md](BACKEND_FRONTEND_ROUTE_CONTRACT.md)
- [MARKETPLACE_VENDOR_ELIGIBILITY.md](MARKETPLACE_VENDOR_ELIGIBILITY.md)
- [MARKETPLACE_VISIBILITY_MATRIX.md](MARKETPLACE_VISIBILITY_MATRIX.md)
- [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md)
- [TEST_MATRIX.md](TEST_MATRIX.md)
- [contracts/BACKEND_ROUTE_MANIFEST.md](contracts/BACKEND_ROUTE_MANIFEST.md)
- [qa/FRESH_ACCOUNT_E2E_PLAN.md](qa/FRESH_ACCOUNT_E2E_PLAN.md)

---

## Historical Evidence Only

- Old batch smoke packs and launch blocker audits.
- [launch-readiness-report.md](launch-readiness-report.md) and older sections of [deploy-verification.md](deploy-verification.md) are audit/evidence snapshots only.
- [integration-gate-asana-evidence.md](integration-gate-asana-evidence.md), [BACKEND_STABILITY_PROOF.md](BACKEND_STABILITY_PROOF.md), and [BACKEND_STABILITY_ROADMAP_AUDIT.md](BACKEND_STABILITY_ROADMAP_AUDIT.md) are evidence snapshots, not current operating docs.
- MVP sprint issue matrix sections that predate PR #149 and PR #150.
- Deployment proofs that name `app.mosaicbizhub.com` as the production frontend.
- Dated evidence docs showing blocked tiers because credentials were absent in that session.

Historical docs should not be deleted because they preserve audit trail. When they conflict with current code or runtime proof, trust [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md), current runtime evidence, and the code.
