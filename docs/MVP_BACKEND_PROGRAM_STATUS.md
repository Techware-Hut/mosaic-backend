# Backend Program Status

**Type:** Living document
**Last updated:** 2026-06-28
**Audience:** backend engineers, QA, release control, AI agents

This is the current backend status hub. Older MVP sprint docs and smoke proof packs remain useful evidence, but they are no longer the source of truth for current production posture.

For documentation drift cleanup see [DOCUMENTATION_CONSOLIDATION_2026_06_28.md](DOCUMENTATION_CONSOLIDATION_2026_06_28.md).

---

## Current Production Snapshot

| Item | Current state |
| --- | --- |
| Repository | `Techware-Hut/mosaic-backend` |
| Integration branch | `staging` |
| Production branch | `main` |
| Latest production promotion | PR [#150](https://github.com/Techware-Hut/mosaic-backend/pull/150), merged 2026-06-28 |
| Production API | `https://api.mosaicbizhub.com` |
| Production deployed SHA | `7c2b10d` |
| EB deployment version | `mosaic-7c2b10dca32c746311ee79e9179c312b1c3743b9` |
| Runtime health | `/api/health`, `/api/ready`, and `/api/build-info` returned production release `7c2b10d` on 2026-06-28 |
| Frontend production | `https://mosaicbizhub.com` |
| Current mode | Vendor soft launch and product build phase; Stripe test-mode purchase flows are allowed for controlled QA |

---

## Current Source-Of-Truth Docs

| Need | Read first |
| --- | --- |
| Backend docs index | [README.md](README.md) |
| Platform behavior | [PLATFORM_OPERATING_MODEL.md](PLATFORM_OPERATING_MODEL.md) |
| API surface | [API_SURFACE.md](API_SURFACE.md), [contracts/BACKEND_ROUTE_MANIFEST.md](contracts/BACKEND_ROUTE_MANIFEST.md) |
| Frontend/backend route contract | [BACKEND_FRONTEND_ROUTE_CONTRACT.md](BACKEND_FRONTEND_ROUTE_CONTRACT.md), [contracts/BACKEND_FRONTEND_CONTRACT_RISK_REPORT.md](contracts/BACKEND_FRONTEND_CONTRACT_RISK_REPORT.md) |
| Auth/CORS/cookie behavior | [AUTH_FLOW.md](AUTH_FLOW.md), [backend/AUTH_CORS_COOKIE_AUDIT.md](backend/AUTH_CORS_COOKIE_AUDIT.md) |
| Vendor eligibility | [MARKETPLACE_VENDOR_ELIGIBILITY.md](MARKETPLACE_VENDOR_ELIGIBILITY.md), [MARKETPLACE_VISIBILITY_MATRIX.md](MARKETPLACE_VISIBILITY_MATRIX.md) |
| Deployment/runbook | [BACKEND_EB_DEPLOY_RUNBOOK.md](BACKEND_EB_DEPLOY_RUNBOOK.md), [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md), [../DEPLOYMENT.md](../DEPLOYMENT.md) |
| QA gaps | [qa/FRESH_ACCOUNT_E2E_PLAN.md](qa/FRESH_ACCOUNT_E2E_PLAN.md), [qa/REGRESSION_CLAIM_LEDGER.md](qa/REGRESSION_CLAIM_LEDGER.md) |

---

## Production Domain And CORS Policy

| Origin | Current role |
| --- | --- |
| `https://mosaicbizhub.com` | Canonical production frontend |
| `https://app.mosaicbizhub.com` | Transition/historical origin; keep only while approved |
| `https://mosaic-biz-frontend-launch.vercel.app` | QA/preview origin |
| `https://www.mosaicbizhub.com` | Alias/redirect target; do not treat as a credentialed API origin |

Backend generated frontend links should use the apex marketplace origin unless a specific QA or rollback flow intentionally overrides it.

---

## Open Backend Work That Still Matters

| Lane | Tracking |
| --- | --- |
| Production smoke proof for domain/API/auth | Backend [#84](https://github.com/Techware-Hut/mosaic-backend/issues/84) |
| Isolated integration tests for auth/onboarding/orders/admin | Backend [#151](https://github.com/Techware-Hut/mosaic-backend/issues/151) |
| Lifecycle state contracts and legacy route policy | Backend [#152](https://github.com/Techware-Hut/mosaic-backend/issues/152) |
| Internal audit trail for sensitive admin/moderation actions | Backend [#153](https://github.com/Techware-Hut/mosaic-backend/issues/153) |
| Refund, return, and dispute workflow audit | Backend [#154](https://github.com/Techware-Hut/mosaic-backend/issues/154) |
| Route authorization matrix and negative-access contract tests | Backend [#155](https://github.com/Techware-Hut/mosaic-backend/issues/155) |
| Validation/error response consistency | Backend [#46](https://github.com/Techware-Hut/mosaic-backend/issues/46) |
| OpenAPI/API contract documentation | Backend [#55](https://github.com/Techware-Hut/mosaic-backend/issues/55) |
| Admin dashboard APIs | Backend [#34](https://github.com/Techware-Hut/mosaic-backend/issues/34) |
| Ops/security audits | Backend [#19](https://github.com/Techware-Hut/mosaic-backend/issues/19), [#70](https://github.com/Techware-Hut/mosaic-backend/issues/70), [#71](https://github.com/Techware-Hut/mosaic-backend/issues/71), [#76](https://github.com/Techware-Hut/mosaic-backend/issues/76) |

---

## Superseded Or Historical

Treat the old MVP issue matrix, batch smoke docs, and dated proof packs as evidence snapshots. They may contain old production SHAs, `app.mosaicbizhub.com` as a then-current frontend, or blocked smoke tiers that have since changed.

Do not delete them casually. Instead:

1. Read this file first.
2. Check current runtime proof and code.
3. Use old proof packs only to understand why a decision was made at that time.
4. If an old doc is still linked as active, update the link or add an archive note.

---

## Maintenance Rule

When release state changes:

1. Update this file first.
2. Update [README.md](README.md) if the active/historical doc map changes.
3. Keep proof packs as historical evidence; do not rewrite old failures into passes.
4. Link new runtime proof from the relevant QA/release docs.
