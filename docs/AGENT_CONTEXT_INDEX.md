# Agent Context Index — Techware-Hut/mosaic-backend

- Last updated: 2026-07-07
- Purpose: the first document any agent or developer should read before working in this repo during the July 6 Controlled Production UAT window.

## Read this first

- **Release posture: Controlled Production UAT.** Production promotion already occurred (backend `main` `ad9ddd1`, frontend `main` `b3a86cb4`) because no true isolated staging environment exists. QA is testing in production under safeguards.
- **This is not final launch approval.** Lionel technical approval and Bryan written business approval are both pending.
- Allowed status vocabulary: `Controlled Production UAT`, `Implemented / Ready for QA`, `Evidence Needed`, `Pending Client Input`, `Regression Risk`. Do not mark anything Accepted or launch-ready without written client/UAT approval.

## July 6 Controlled Production UAT

### Issue control board

Backend parent epic: [#211 — Epic: July 6 Controlled Production UAT backend follow-up control board](https://github.com/Techware-Hut/mosaic-backend/issues/211)

| Issue | Title | Status language |
|---|---|---|
| [#212](https://github.com/Techware-Hut/mosaic-backend/issues/212) | P1: Formalize local shipping eligibility contract (FW-2/FW-6) | Regression Risk / Evidence Needed |
| [#213](https://github.com/Techware-Hut/mosaic-backend/issues/213) | P1: Add server-side local shipping eligibility guard or document client-only temporary rule (FW-6) | Regression Risk |
| [#214](https://github.com/Techware-Hut/mosaic-backend/issues/214) | P1: Normalize service update features consistently with service create (FW-7) | Implemented / Ready for QA with Regression Risk |
| [#215](https://github.com/Techware-Hut/mosaic-backend/issues/215) | P1: Fix onboarding service creation path dropping features (FW-9) | Regression Risk |
| [#216](https://github.com/Techware-Hut/mosaic-backend/issues/216) | Evidence Needed: Hosted shipment tracking email proof (item 11) | Evidence Needed |
| [#217](https://github.com/Techware-Hut/mosaic-backend/issues/217) | Evidence Needed: Hosted PDF/JPEG vendor document upload proof (item 12) | Evidence Needed |
| [#218](https://github.com/Techware-Hut/mosaic-backend/issues/218) | Decision Needed: Service/restaurant Stripe Connect policy wording and requirement (items 5/15) | Pending Client Input |
| [#219](https://github.com/Techware-Hut/mosaic-backend/issues/219) | Decision Needed: Local delivery eligibility rule (item 7) | Pending Client Input |
| [#220](https://github.com/Techware-Hut/mosaic-backend/issues/220) | P3: Index July 6 UAT and audit docs in backend docs index (FW-8) | Implemented / Ready for QA (this document) |

Frontend parent epic: [Digital-Builders-757/mosaic-biz-frontend-launch#337](https://github.com/Digital-Builders-757/mosaic-biz-frontend-launch/issues/337)

### Source audit PRs

- Backend docs-to-code conformance audit: [PR #210](https://github.com/Techware-Hut/mosaic-backend/pull/210)
- Frontend docs-to-code conformance audit: [PR #336](https://github.com/Digital-Builders-757/mosaic-biz-frontend-launch/pull/336)

### Key documents

| Document | What it is |
|---|---|
| [`docs/uat/JULY_6_PRODUCTION_UAT_CHECKLIST.md`](uat/JULY_6_PRODUCTION_UAT_CHECKLIST.md) | Tester steps, safeguards, and evidence requirements for all 15 QA items |
| [`docs/audit/JULY_6_DOCS_TO_CODE_CONFORMANCE_AUDIT.md`](audit/JULY_6_DOCS_TO_CODE_CONFORMANCE_AUDIT.md) | Docs-to-code conformance findings, checklist matrix, follow-up work orders FW-1..FW-9 |
| [`docs/audit/JULY_6_BACKEND_IMPLEMENTATION_TRACE.md`](audit/JULY_6_BACKEND_IMPLEMENTATION_TRACE.md) | Per-area backend implementation evidence (routes, controllers, tests) |
| [`docs/audit/JULY_6_CROSS_REPO_ROUTE_CONTRACT_TRACE.md`](audit/JULY_6_CROSS_REPO_ROUTE_CONTRACT_TRACE.md) | Cross-repo route/API contract table (canonical) |
| [`docs/release/STAGING_ENVIRONMENT_AUDIT.md`](release/STAGING_ENVIRONMENT_AUDIT.md) | Why no true staging exists and why production UAT is controlled |
| [`docs/release/JULY_6_CONTROLLED_PRODUCTION_UAT_PLAN.md`](release/JULY_6_CONTROLLED_PRODUCTION_UAT_PLAN.md) | Controlled production UAT plan and safeguards |

## How future agents should use this

1. Read this index first, then the release posture docs above.
2. Read the linked GitHub issue in full before making any change; the issue defines scope, acceptance criteria, and verification commands.
3. Make one branch per issue; do not bundle unrelated fixes.
4. Do not touch flows unrelated to your issue.
5. Preserve `GET /api/featured-products` as the canonical featured route. Never introduce `/api/products/featured`.
6. Do not touch Stripe, webhook mounting order, payment intent, Connect payout, or subscription logic unless the issue explicitly requires it.
7. Never commit secrets, env values, tokens, keys, DSNs, or signed URLs. Env variables may be referenced by name only.
8. After your PR, update the issue (evidence, status language) and any affected docs in the same pass.
