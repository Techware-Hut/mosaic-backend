# Mosaic Backend — Documentation Home

**Start here.** This index is the entry point for contributors, QA, release owners, and LLMs working on `mosaic-backend`.

Repository root: [README.md](../README.md) (stack, commands, env vars).  
Application map: [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Read first (by role)

| If you are… | Read in this order |
| --- | --- |
| **LLM / AI agent** | [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) → [LLM_CONTEXT.md](LLM_CONTEXT.md) → [BACKEND_ARCHITECTURE_MAP.md](BACKEND_ARCHITECTURE_MAP.md) → [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md) → [BACKEND_STABILITY_AGENT_PROMPT.md](BACKEND_STABILITY_AGENT_PROMPT.md) → [API_SURFACE.md](API_SURFACE.md) |
| **New backend developer** | [ARCHITECTURE.md](ARCHITECTURE.md) → [SETUP.md](../SETUP.md) → [AUTH_FLOW.md](AUTH_FLOW.md) → [API_SURFACE.md](API_SURFACE.md) |
| **QA / smoke tester** | [BACKEND_FULL_SMOKE_PROOF_PACK.md](BACKEND_FULL_SMOKE_PROOF_PACK.md) → [production-smoke-checklist.md](production-smoke-checklist.md) → [TEST_MATRIX.md](TEST_MATRIX.md) → [API_SURFACE.md](API_SURFACE.md) |
| **Release / deploy owner** | [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) → [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) → [DEPLOYMENT.md](../DEPLOYMENT.md) → [production-proof-pack-template.md](production-proof-pack-template.md) |
| **Product / launch reviewer** | [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) → [DECISION_REGISTER.md](DECISION_REGISTER.md) → [launch-readiness-report.md](launch-readiness-report.md) |

---

## MVP backend sprint (#26–#35)

**Start here for sprint state:** [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) — production SHA, open PRs, roadmap, known gaps.

| Doc | What it covers |
| --- | --- |
| [MVP_BACKEND_PROGRAM_STATUS.md](MVP_BACKEND_PROGRAM_STATUS.md) | **Canonical hub** — where we are, what's live, what's next |
| [MVP_BACKEND_API_AUDIT.md](MVP_BACKEND_API_AUDIT.md) | Full API audit, coverage matrix (#26–#35), recommended fix order |
| [MVP_BACKEND_SMOKE_PROOF_PACK.md](MVP_BACKEND_SMOKE_PROOF_PACK.md) | Issue #27 smoke proof pack evidence |
| [MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md](MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md) | Issue #28 public listing/featured/detail DTO contract |
| [MVP_BACKEND_SEARCH_FILTER_READINESS.md](MVP_BACKEND_SEARCH_FILTER_READINESS.md) | Issue #29 search/filter API readiness |
| [MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md](MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md) | Issue #30 vendor onboarding validation + email flow |
| [MVP_BACKEND_EMAIL_NOTIFICATIONS.md](MVP_BACKEND_EMAIL_NOTIFICATIONS.md) | Issue #33 email notification audit + tests |
| [MVP_BACKEND_VENDOR_SELF_SERVICE_APIS.md](MVP_BACKEND_VENDOR_SELF_SERVICE_APIS.md) | Issue #31 vendor profile, listings, orders, stock |
| [deploy-verification.md](deploy-verification.md) | Chronological MVP deploy verification log |

---

## Core guides

Canonical deep-dives. Prefer these over duplicating detail in chat or new docs.

| Doc | What it covers |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Repo layout, request lifecycle, route registry by domain, models index, where to look first |
| [LLM_CONTEXT.md](LLM_CONTEXT.md) | Safe-edit rules, env names, issue map, and fast navigation for AI assistants |
| [BACKEND_ARCHITECTURE_MAP.md](BACKEND_ARCHITECTURE_MAP.md) | Route → controller → model ownership, boundaries, and no-touch zones (issue #50) |
| [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md) | Branch/PR guardrails, before-coding and before-PR checklists for agents |
| [BACKEND_STABILITY_AGENT_PROMPT.md](BACKEND_STABILITY_AGENT_PROMPT.md) | Controlled stabilization sprint prompt for Cursor/OpenClaw |
| [BACKEND_STABILITY_ROADMAP_AUDIT.md](BACKEND_STABILITY_ROADMAP_AUDIT.md) | Stability audit snapshot (working / fragile / deferred) |
| [BACKEND_STABILITY_PROOF.md](BACKEND_STABILITY_PROOF.md) | Test and manual verification evidence for stability sprint |
| [BACKEND_ROADMAP_ISSUES.md](BACKEND_ROADMAP_ISSUES.md) | Prioritized GitHub-ready issue backlog by lane |
| [BACKEND_LAUNCH_BLOCKERS_BATCH_2_AUDIT.md](BACKEND_LAUNCH_BLOCKERS_BATCH_2_AUDIT.md) | Batch 2 audit — payment auth, email timing, health (#41/#43/#69) |
| [BACKEND_LAUNCH_BLOCKERS_BATCH_2_PROOF.md](BACKEND_LAUNCH_BLOCKERS_BATCH_2_PROOF.md) | Batch 2 test and smoke proof |
| [BACKEND_BATCH_3_DEPLOY_SMOKE_AUDIT.md](BACKEND_BATCH_3_DEPLOY_SMOKE_AUDIT.md) | Batch 3 deploy/smoke/Sentry audit snapshot |
| [BACKEND_FULL_SMOKE_PROOF_PACK.md](BACKEND_FULL_SMOKE_PROOF_PACK.md) | P0–P6 smoke matrix (#27) |
| [SENTRY_EB_DEPLOY_VERIFICATION.md](SENTRY_EB_DEPLOY_VERIFICATION.md) | Sentry EB verification (#18) |
| [EB_DEPLOYMENT_READINESS_CHECKLIST.md](EB_DEPLOYMENT_READINESS_CHECKLIST.md) | Pre/post EB deploy checklist |
| [BACKEND_REMAINING_BLOCKERS_AFTER_BATCH_3.md](BACKEND_REMAINING_BLOCKERS_AFTER_BATCH_3.md) | Post-Batch 3 blocker classification |
| [API_SURFACE.md](API_SURFACE.md) | Full HTTP route map, middleware, auth/role boundaries, smoke and risk notes |
| [AUTH_FLOW.md](AUTH_FLOW.md) | Login, register, OTP, password reset, JWT, Google OAuth, rate limits |
| [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md) | Vendor onboarding states, admin review, payments, uploads, resubmit |
| [DECISION_REGISTER.md](DECISION_REGISTER.md) | MVP decisions, open blockers, deferred items, launch assumptions |

---

## Payments and Stripe

| Doc | What it covers |
| --- | --- |
| [PAYMENT_FLOW.md](PAYMENT_FLOW.md) | Orders, payment intents, vendor fee, subscriptions, Connect (non-webhook paths) |
| [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md) | Five webhook endpoints, events, signature behavior, smoke guidance |
| [stripe-webhook-registration.md](stripe-webhook-registration.md) | How to register webhook URLs in Stripe Dashboard |
| [business-sync.md](business-sync.md) | Onboarding → `Business` document sync behavior |

---

## Operations, deployment, and environment

| Doc | What it covers |
| --- | --- |
| [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) | Deploy, smoke tiers, rollback, Go/No-Go, sign-off |
| [DEPLOYMENT.md](../DEPLOYMENT.md) | AWS Elastic Beanstalk deploy process |
| [STAGING.md](../STAGING.md) | `staging` branch integration gate (no hosted staging deploy) |
| [SETUP.md](../SETUP.md) | Local development bootstrap |
| [production-env-checklist.md](production-env-checklist.md) | Production environment variable audit |
| [hosted-staging-decision.md](hosted-staging-decision.md) | **Deferred:** hosted staging backend — rationale and implications |

---

## Testing and launch readiness

| Doc | What it covers |
| --- | --- |
| [TEST_MATRIX.md](TEST_MATRIX.md) | Automated tests (`npm test`) mapped to manual smoke and gaps |
| [production-smoke-checklist.md](production-smoke-checklist.md) | Tiered post-deploy smoke (P0–P6) on production API |
| [BACKEND_FULL_SMOKE_PROOF_PACK.md](BACKEND_FULL_SMOKE_PROOF_PACK.md) | Full P0–P6 evidence matrix with pass/fail/blocked status |
| [launch-readiness-report.md](launch-readiness-report.md) | Route audit, blockers, and launch-risk inventory |

---

## Proof packs and release evidence

Keep **confirmed launch evidence** here — not in chat logs or ad-hoc notes.

| Doc | What it covers |
| --- | --- |
| [production-proof-pack-template.md](production-proof-pack-template.md) | Per-release evidence template (deploy SHA, smoke, rollback) |
| [deploy-verification.md](deploy-verification.md) | Deploy verification log format |
| [integration-gate-asana-evidence.md](integration-gate-asana-evidence.md) | Integration gate evidence (Asana-linked) |
| [wave2-auth-verification-evidence.md](wave2-auth-verification-evidence.md) | Wave 2 auth verification evidence archive |
| [wave2-stripe-webhook-verification-evidence.md](wave2-stripe-webhook-verification-evidence.md) | Wave 2 Stripe webhook verification evidence archive |

---

## Admin, vendor, and security reference

| Doc | What it covers |
| --- | --- |
| [admin-read-mutation.md](admin-read-mutation.md) | Admin API read/mutation behavior |
| [admin-pending-applications-statuses.md](admin-pending-applications-statuses.md) | Vendor application status definitions |
| [vendor-field-protection.md](vendor-field-protection.md) | Vendor field allowlists and protection rules |
| [security-remediation-notes.md](security-remediation-notes.md) | Security remediation tracking (Stripe routes, secrets, auth gaps) |
| [auth.md](auth.md) | Legacy auth notes; see [AUTH_FLOW.md](AUTH_FLOW.md) for the canonical flow doc |

---

## Internal / misc

| Doc | What it covers |
| --- | --- |
| [../todo.md](../todo.md) | Informal dev notes (not maintained as operational docs) |
| [../README.md](../README.md) | Project overview, commands, env var tables |

---

## Documentation maintenance rules

Follow these when changing code **or** docs.

### When to update

1. **Behavior changes** — Update the relevant guide (auth, vendor, payments, webhooks, API surface) in the same PR or immediately after merge.
2. **New routes** — Add rows to [API_SURFACE.md](API_SURFACE.md) and mount notes in [ARCHITECTURE.md](ARCHITECTURE.md).
3. **New decisions or deferrals** — Add a row to [DECISION_REGISTER.md](DECISION_REGISTER.md) with status and evidence link.
4. **Deploy or smoke process changes** — Update [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md), [DEPLOYMENT.md](../DEPLOYMENT.md), and smoke checklists as needed.
5. **Launch evidence** — Record in proof-pack docs ([production-proof-pack-template.md](production-proof-pack-template.md), [deploy-verification.md](deploy-verification.md)), not in unrelated files.

### Linking and discoverability

- **Every new doc in `docs/` must be linked from this file** (`docs/README.md`).
- Prefer cross-links between related docs instead of copying long sections.
- Root [README.md](../README.md) Operational docs section should point here for the full index.

### Content standards

| Rule | Detail |
| --- | --- |
| **No secrets** | Never commit API keys, webhook secrets, passwords, JWTs, or `.env` values. Use placeholder names only. |
| **No private data** | Do not include real user, vendor, or customer PII, emails, or production IDs in docs. |
| **Facts vs assumptions** | Label uncertain items explicitly (e.g. *Assumption*, *Unverified*, *Deferred*). |
| **Deferred items** | Mark clearly in [DECISION_REGISTER.md](DECISION_REGISTER.md) and link from affected runbooks. |
| **Evidence** | Confirmed production behavior belongs in proof-pack / evidence docs with date and deploy SHA when applicable. |
| **No overclaiming** | Do not mark launch items complete without linked evidence. **Launch-ready** requires EB deployed commit confirmed, rollback recorded, post-deploy smoke (commit confirmed), proof pack, and product owner written approval (Bryan). |

### Doc ownership hints

| Area | Primary docs to touch |
| --- | --- |
| Routes / middleware | `API_SURFACE.md`, `ARCHITECTURE.md` |
| Auth | `AUTH_FLOW.md`, `auth.md` (if legacy parity needed) |
| Vendor | `VENDOR_LIFECYCLE.md`, `vendor-field-protection.md`, `business-sync.md` |
| Stripe | `STRIPE_WEBHOOKS.md`, `PAYMENT_FLOW.md`, `stripe-webhook-registration.md` |
| Release | `PRODUCTION_RUNBOOK.md`, proof-pack templates, `DECISION_REGISTER.md` |
| Security | `security-remediation-notes.md`, `launch-readiness-report.md` |

---

## Quick links (required deliverables)

- [MVP program status](MVP_BACKEND_PROGRAM_STATUS.md)
- [Architecture map](ARCHITECTURE.md)
- [LLM context guide](LLM_CONTEXT.md)
- [Auth flow](AUTH_FLOW.md)
- [Vendor lifecycle](VENDOR_LIFECYCLE.md)
- [Stripe webhook docs](STRIPE_WEBHOOKS.md)
- [Payment flow docs](PAYMENT_FLOW.md)
- [Production runbook](PRODUCTION_RUNBOOK.md)
- [Test matrix](TEST_MATRIX.md)
- [API surface map](API_SURFACE.md)
- [Decision register](DECISION_REGISTER.md)
- [Proof-pack template](production-proof-pack-template.md)
- [Backend stability audit](BACKEND_STABILITY_ROADMAP_AUDIT.md)
- [Backend roadmap issues](BACKEND_ROADMAP_ISSUES.md)
- [Launch blockers batch 2 audit](BACKEND_LAUNCH_BLOCKERS_BATCH_2_AUDIT.md)
- [Deployment docs](../DEPLOYMENT.md) · [Staging](../STAGING.md) · [Setup](../SETUP.md)
