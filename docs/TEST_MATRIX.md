# Test Matrix

**Last updated:** 2026-06-28

This matrix maps backend validation commands to what they prove. It intentionally does **not** hard-code total test counts; counts change as coverage grows and should be recorded in PR descriptions, CI runs, and release proof packs.

---

## Commands

| Command | Scope | Source |
| --- | --- | --- |
| `npm test` | Non-integration unit and module tests under `tests/`, excluding `tests/integration/` | `scripts/run-unit-tests.js` |
| `npm run test:contract` | Launch route/static contract checks | `tests/launch/backend-launch-contract.test.js` |
| `npm run test:integration` | Isolated Express/Mongo integration suite with `mongodb-memory-server` and provider stubs | `scripts/run-integration-tests.js`, `tests/integration/**` |
| `npm run smoke:backend` | Live or local HTTP smoke wrapper | `scripts/run-smoke-backend.js`, `scripts/smoke-backend.ps1`, `scripts/smoke-backend.sh` |

CI (`.github/workflows/ci.yml`) runs install, `npm test`, `npm run test:contract`, and `npm run test:integration` on PRs/pushes to `staging` and `main`. Production deploy (`.github/workflows/deploy-eb-production.yml`) runs `npm test` before packaging and then performs post-deploy health, auth, readiness, CORS, and featured-products probes.

---

## Automated Coverage By Area

| Area | Primary tests | Proves | Does not prove |
| --- | --- | --- | --- |
| Auth/session | `tests/auth/**`, `tests/integration/auth.integration.test.js`, `tests/integration/roles.integration.test.js` | Safe auth DTOs, JWT/sessionVersion behavior, password reset safeguards, Google OAuth guardrails, role checks in isolated integration | Live email delivery, live OAuth redirect, production cookie/CORS behavior |
| Admin | `tests/admin/**`, `tests/integration/vendor-onboarding.integration.test.js` | Admin user DTOs, admin guards, pending applications, finalize behavior, audit trail pieces | Full production admin dashboard UX or live email delivery |
| Vendor onboarding | `tests/vendor/**`, `tests/integration/vendor-onboarding.integration.test.js` | Vendor state transitions, protected field allowlists, upload MIME checks, business sync, listing limits | Live S3 presigned upload, live Stripe verification payment |
| Marketplace/search | `tests/marketplace/**`, `tests/integration/marketplace.integration.test.js` | Public listing DTOs, featured products, ranking/search filters, business eligibility | Production data quality, search performance under load |
| Orders/commerce | `tests/orders/**`, `tests/integration/commerce.integration.test.js`, `tests/integration/connect.integration.test.js` | Customer/vendor order safety, invoice auth, Connect URL helpers, checkout guard behavior | Full live Stripe payment and payout reconciliation |
| Stripe/webhooks | `tests/stripe/**` | Raw-body mount order, signature handling, webhook logic, Checkout/Connect guardrails, safe PaymentIntent response shaping | Stripe Dashboard delivery, EB/proxy body behavior, real money movement |
| Email/logging | `tests/email/**`, `tests/utils/vendor-onboarding-email-delivery.test.js` | Mail helper behavior, safe failure, logging hygiene | Inbox receipt or SMTP provider health |
| Sentry/release identity | `tests/sentry/**`, `tests/release/**`, `tests/health/**` | Env gating, release identity payloads, health/readiness contracts | Live Sentry issue creation unless the Sentry debug route/manual capture is run in an approved environment |
| Security/payload safety | `tests/security/**`, route guard tests across admin/vendor/stripe | Sanitizer expectations, authorization failures, negative route contracts | Full penetration testing |

---

## Manual Smoke Still Required

Automated tests do not replace production smoke. Run smoke after deploys that touch auth, payments, uploads, CORS, release identity, or public marketplace routes.

| Smoke area | Why manual |
| --- | --- |
| Production deploy identity | Confirms EB is serving the intended commit/version |
| Live Stripe payments and webhooks | Requires Stripe Dashboard/test-mode events against the deployed API; use [qa/PRODUCTION_STRIPE_WEBHOOK_RUNTIME_SMOKE_RUNBOOK_2026_06_28.md](qa/PRODUCTION_STRIPE_WEBHOOK_RUNTIME_SMOKE_RUNBOOK_2026_06_28.md) for unsigned rejection proof and valid-delivery evidence |
| Email delivery | Mailers are mocked/stubbed in tests |
| S3 uploads | AWS SDK and presigned upload flows need live credentials/CORS |
| Google OAuth browser flow | Redirect/cookie behavior depends on provider config and production domains |
| Cross-domain cookies and CORS | Browser behavior depends on deployed frontend/API origins |
| Admin/vendor production data flows | Tests use mocks or isolated MongoDB fixtures |

Record results in [production-proof-pack-template.md](production-proof-pack-template.md) or the active release proof pack. Use [production-smoke-checklist.md](production-smoke-checklist.md) for the P0-P6 sequence.

---

## Evidence Rules

1. Treat current command output, CI logs, and dated proof packs as evidence.
2. Do not copy an old pass count into living docs; paste it into the PR or proof pack for that run.
3. Passing `npm test` proves mocked/unit/module behavior, not production deploy health.
4. Passing CI proves the branch validation workflow, not EB runtime behavior.
5. Passing post-deploy probes proves only the probed endpoints; still run tiered smoke for launch-critical flows.

---

## Related Docs

- [README.md](README.md)
- [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md)
- [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md)
- [production-smoke-checklist.md](production-smoke-checklist.md)
- [production-proof-pack-template.md](production-proof-pack-template.md)
- [qa/PRODUCTION_STRIPE_WEBHOOK_RUNTIME_SMOKE_RUNBOOK_2026_06_28.md](qa/PRODUCTION_STRIPE_WEBHOOK_RUNTIME_SMOKE_RUNBOOK_2026_06_28.md)
- [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md)
- [backend/BACKEND_INTEGRATION_TEST_RUNBOOK.md](backend/BACKEND_INTEGRATION_TEST_RUNBOOK.md)
