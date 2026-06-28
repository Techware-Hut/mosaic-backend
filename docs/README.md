# Mosaic Backend - Documentation Home

**Audience:** backend engineers, QA, release control, AI agents
**Last updated:** 2026-06-28

This is the entry point for current backend documentation. Older sprint, smoke, and proof-pack docs are retained as evidence, but the living docs below are the source of truth for current behavior.

Repository root: [README.md](../README.md). Deployment entry point: [../DEPLOYMENT.md](../DEPLOYMENT.md).

---

## Current Production Posture

| Item | Current state |
| --- | --- |
| Production API | `https://api.mosaicbizhub.com` |
| Production branch | `main` |
| Integration branch | `staging` |
| Canonical frontend | `https://mosaicbizhub.com` |
| Current mode | Vendor soft launch and product build phase |
| Payments | Stripe test-mode flows are allowed for controlled QA; do not present as unrestricted live commerce |
| Release evidence | Exact deployed SHA, EB version, and latest promotion live in [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) and dated proof packs |
| Main status hub | [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) |

---

## Start Here

| Question | Read |
| --- | --- |
| Where are we today? | [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) |
| What docs changed or became historical? | [DOCUMENTATION_CONSOLIDATION_2026_06_28.md](DOCUMENTATION_CONSOLIDATION_2026_06_28.md) |
| What is the platform supposed to do? | [PLATFORM_OPERATING_MODEL.md](PLATFORM_OPERATING_MODEL.md) |
| How is the backend organized? | [ARCHITECTURE.md](ARCHITECTURE.md), [BACKEND_ARCHITECTURE_MAP.md](BACKEND_ARCHITECTURE_MAP.md) |
| What API routes exist? | [API_SURFACE.md](API_SURFACE.md), [contracts/BACKEND_ROUTE_MANIFEST.md](contracts/BACKEND_ROUTE_MANIFEST.md) |
| How do frontend/backend contracts line up? | [BACKEND_FRONTEND_ROUTE_CONTRACT.md](BACKEND_FRONTEND_ROUTE_CONTRACT.md), [contracts/BACKEND_FRONTEND_CONTRACT_RISK_REPORT.md](contracts/BACKEND_FRONTEND_CONTRACT_RISK_REPORT.md) |
| How do we deploy? | [BACKEND_EB_DEPLOY_RUNBOOK.md](BACKEND_EB_DEPLOY_RUNBOOK.md), [../DEPLOYMENT.md](../DEPLOYMENT.md), [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) |
| What is historical only? | [archive/README.md](archive/README.md) |

---

## Active Documentation

### Living

| Document | Use for |
| --- | --- |
| [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) | Current production SHA, open backend work, domain/CORS posture |
| [DOCUMENTATION_CONSOLIDATION_2026_06_28.md](DOCUMENTATION_CONSOLIDATION_2026_06_28.md) | What was consolidated and what should be treated as historical |
| [BACKEND_ROADMAP_ISSUES.md](BACKEND_ROADMAP_ISSUES.md) | Older roadmap context; verify against current GitHub issues before acting |

### Source Of Truth - Platform Behavior

| Document | Use for |
| --- | --- |
| [PLATFORM_OPERATING_MODEL.md](PLATFORM_OPERATING_MODEL.md) | Cross-role platform behavior |
| [MARKETPLACE_VENDOR_ELIGIBILITY.md](MARKETPLACE_VENDOR_ELIGIBILITY.md) | Vendor visibility and checkout eligibility |
| [MARKETPLACE_VISIBILITY_MATRIX.md](MARKETPLACE_VISIBILITY_MATRIX.md) | Public/admin/vendor visibility rules |
| [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md) | Vendor onboarding and approval states |
| [LIFECYCLE_STATE_AND_LEGACY_ROUTE_POLICY.md](LIFECYCLE_STATE_AND_LEGACY_ROUTE_POLICY.md) | Backend lifecycle states and intentional legacy/duplicate route policy |

### Architecture, API, And Contracts

| Document | Use for |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Backend architecture and env overview |
| [API_SURFACE.md](API_SURFACE.md) | Full HTTP route map |
| [AUTH_FLOW.md](AUTH_FLOW.md) | Auth, OTP, JWT, Google OAuth, CORS/cookies |
| [PAYMENT_FLOW.md](PAYMENT_FLOW.md) | Orders, payment intents, subscriptions, Connect |
| [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md) | Stripe webhook endpoints and behavior |
| [DOMAIN_MIGRATION_URL_INVENTORY.md](DOMAIN_MIGRATION_URL_INVENTORY.md) | Canonical, alias, transition, preview, and API origin policy |
| [STRIPE_CONNECT_DOMAIN_VERIFICATION.md](STRIPE_CONNECT_DOMAIN_VERIFICATION.md) | Stripe Connect return/refresh domain intent |
| [BACKEND_FRONTEND_ROUTE_CONTRACT.md](BACKEND_FRONTEND_ROUTE_CONTRACT.md) | Contract between frontend calls and backend routes |
| [contracts/BACKEND_ROUTE_MANIFEST.md](contracts/BACKEND_ROUTE_MANIFEST.md) | Generated/curated route manifest |
| [backend/API_CONTRACT_AS_BUILT.md](backend/API_CONTRACT_AS_BUILT.md) | As-built API contract snapshot |
| [backend/AUTH_CORS_COOKIE_AUDIT.md](backend/AUTH_CORS_COOKIE_AUDIT.md) | Auth/CORS/cookie audit |

### Operations, QA, And Release

| Document | Use for |
| --- | --- |
| [BACKEND_EB_DEPLOY_RUNBOOK.md](BACKEND_EB_DEPLOY_RUNBOOK.md) | EB deploy and smoke runbook |
| [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) | Release-owner runbook |
| [TEST_MATRIX.md](TEST_MATRIX.md) | Automated tests mapped to manual smoke |
| [SMOKE_TEST_TOKENS.md](SMOKE_TEST_TOKENS.md) | How token-protected smoke tiers work |
| [qa/PRODUCTION_STRIPE_WEBHOOK_RUNTIME_SMOKE_RUNBOOK_2026_06_28.md](qa/PRODUCTION_STRIPE_WEBHOOK_RUNTIME_SMOKE_RUNBOOK_2026_06_28.md) | Controlled Stripe webhook runtime smoke, redacted evidence validation, and valid delivery proof |
| [qa/FRESH_ACCOUNT_E2E_PLAN.md](qa/FRESH_ACCOUNT_E2E_PLAN.md) | Fresh account production QA plan |
| [qa/REGRESSION_CLAIM_LEDGER.md](qa/REGRESSION_CLAIM_LEDGER.md) | Runtime claims and gaps ledger |
| [release/WORK_ORDER_2026_06_26_MOSAIC_LAUNCH_HARDENING.md](release/WORK_ORDER_2026_06_26_MOSAIC_LAUNCH_HARDENING.md) | June 26 work order evidence |

---

## Historical / Evidence Only

Use [archive/README.md](archive/README.md) for old batch audits, smoke packs, proof packs, and dated deployment evidence. These files preserve history and should not be deleted casually.

Current domain rule:

- `https://mosaicbizhub.com` is the canonical production frontend.
- `https://app.mosaicbizhub.com` is transition/historical unless explicitly approved for rollback.
- `https://mosaic-biz-frontend-launch.vercel.app` is QA/preview or historical evidence.
- `https://www.mosaicbizhub.com` is an alias/redirect target, not a credentialed API origin.

If a historical doc conflicts with [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md), current code, or runtime proof, trust the current source and update/link the stale doc instead of copying its old conclusion forward.
