# Backend Documentation Consolidation - 2026-06-28

**Purpose:** record what is current, what is historical, and what changed during the documentation drift cleanup.

---

## Current Truth

| Area | Current source |
| --- | --- |
| Status | [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) |
| Docs index | [README.md](README.md) |
| Platform behavior | [PLATFORM_OPERATING_MODEL.md](PLATFORM_OPERATING_MODEL.md) |
| Deployment | [BACKEND_EB_DEPLOY_RUNBOOK.md](BACKEND_EB_DEPLOY_RUNBOOK.md), [../DEPLOYMENT.md](../DEPLOYMENT.md) |
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
- MVP sprint issue matrix sections that predate PR #149 and PR #150.
- Deployment proofs that name `app.mosaicbizhub.com` as the production frontend.
- Dated evidence docs showing blocked tiers because credentials were absent in that session.

Historical docs should not be deleted because they preserve audit trail. When they conflict with current code or runtime proof, trust [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md), current runtime evidence, and the code.
