# MVP Backend Program Status

**Last updated:** 2026-06-17  
**Canonical hub** for backend MVP sprint (#26–#35): where Mosaic is today, what is live in production, what is in flight, and what comes next.

For deep technical detail, follow links to issue-specific docs — do not duplicate them here.

---

## Executive snapshot

| Item | Value |
| --- | --- |
| **Product** | Mosaic Biz Hub backend — minority-owned business marketplace REST API |
| **Production API** | `https://api.mosaicbizhub.com` |
| **Production deploy SHA** | `6cdf587` — issue #30 vendor onboarding + email ([PR #39](https://github.com/Techware-Hut/mosaic-backend/pull/39)) |
| **EB version label** | `mosaic-6cdf587f0f3178a13634686bbfc12db8daee4ae4` |
| **`main` HEAD** | `268ee50` — post-#30 verification docs; **app runtime matches EB** (no newer app code on `main` than production) |
| **Open PR** | [#40](https://github.com/Techware-Hut/mosaic-backend/pull/40) — issue #31 vendor self-service APIs (**not merged, not deployed**) |
| **Automated tests (production lineage)** | **107/107** at `6cdf587` / `main` app code |
| **Automated tests (PR #40 branch)** | **123/123** — includes 16 new vendor listing/order/stock tests |
| **Release model** | Controlled issue-by-issue merge → manual GHA EB deploy → tiered prod smoke → evidence in [deploy-verification.md](deploy-verification.md) |

---

## Issue tracker (#26–#35)

| Issue | Title | Code status | Production | Evidence |
| --- | --- | --- | --- | --- |
| [#26](https://github.com/Techware-Hut/mosaic-backend/issues/26) | Backend MVP API audit | **Merged** | N/A (docs) | [MVP_BACKEND_API_AUDIT.md](MVP_BACKEND_API_AUDIT.md) |
| [#27](https://github.com/Techware-Hut/mosaic-backend/issues/27) | Smoke proof pack | **Partial evidence** | Partial P0–P6 | [MVP_BACKEND_SMOKE_PROOF_PACK.md](MVP_BACKEND_SMOKE_PROOF_PACK.md) |
| [#28](https://github.com/Techware-Hut/mosaic-backend/issues/28) | Marketplace data contract | **Merged** (PR #37) | **Live** | [MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md](MVP_BACKEND_MARKETPLACE_DATA_CONTRACT.md) |
| [#29](https://github.com/Techware-Hut/mosaic-backend/issues/29) | Search/filter readiness | **Merged** (PR #38) | **Live** (`9f66c07`+) | [MVP_BACKEND_SEARCH_FILTER_READINESS.md](MVP_BACKEND_SEARCH_FILTER_READINESS.md) |
| [#30](https://github.com/Techware-Hut/mosaic-backend/issues/30) | Vendor onboarding + email | **Merged** (PR #39) | **Live** (`6cdf587`) | [MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md](MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md) |
| [#31](https://github.com/Techware-Hut/mosaic-backend/issues/31) | Vendor self-service APIs | **In PR** [#40](https://github.com/Techware-Hut/mosaic-backend/pull/40) OPEN | **Not deployed** | [MVP_BACKEND_VENDOR_SELF_SERVICE_APIS.md](MVP_BACKEND_VENDOR_SELF_SERVICE_APIS.md) |
| [#32](https://github.com/Techware-Hut/mosaic-backend/issues/32) | Stripe Connect runtime | **Not started** | N/A | [MVP_BACKEND_API_AUDIT.md](MVP_BACKEND_API_AUDIT.md) §10 |
| [#33](https://github.com/Techware-Hut/mosaic-backend/issues/33) | Email notifications | **Not started** | N/A | Audit §10 |
| [#34](https://github.com/Techware-Hut/mosaic-backend/issues/34) | Admin APIs | **Not started** | N/A | Audit §10 |
| [#35](https://github.com/Techware-Hut/mosaic-backend/issues/35) | Reviews | **Not started** | N/A | Audit §10 |

**Deploy log:** chronological merge/deploy/smoke records → [deploy-verification.md](deploy-verification.md)

---

## Where we are going

### Immediate gate

1. Human review and merge of [PR #40](https://github.com/Techware-Hut/mosaic-backend/pull/40) (issue #31)
2. Manual GHA deploy from `main` per [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md)
3. Production smoke per [MVP_BACKEND_VENDOR_SELF_SERVICE_APIS.md](MVP_BACKEND_VENDOR_SELF_SERVICE_APIS.md)
4. Update this file and [deploy-verification.md](deploy-verification.md) with deploy SHA and smoke results

### Next scheduled work

- **#32 Stripe Connect runtime** — prod smoke for checkout + webhooks; remediate unauthenticated `/stripe/*` routes. **Do not start until scheduled.**

### Parallel / later

- **#27** — full P0–P6 smoke proof pack ([production-proof-pack-template.md](production-proof-pack-template.md))
- **#33–#35** — order emails, admin aggregation, reviews tests/DTO audit
- **Security hardening** — auth on exposed admin/stripe routes (tracked in audit and [DECISION_REGISTER.md](DECISION_REGISTER.md))

Issue dependency diagram: [MVP_BACKEND_API_AUDIT.md](MVP_BACKEND_API_AUDIT.md) §10 (Recommended backend fix order).

---

## How to read the documentation set

```mermaid
flowchart TD
  hub["MVP_BACKEND_PROGRAM_STATUS"]
  index["docs/README.md"]
  audit["MVP_BACKEND_API_AUDIT"]
  issueDocs["MVP_BACKEND_* per issue"]
  ops["PRODUCTION_RUNBOOK + deploy-verification"]
  llm["LLM_CONTEXT"]
  hub --> audit
  hub --> issueDocs
  hub --> ops
  index --> hub
  llm --> hub
  audit --> issueDocs
```

| Role | Read in this order |
| --- | --- |
| **Release / deploy owner** | This doc → [deploy-verification.md](deploy-verification.md) → issue-specific production section → [production-proof-pack-template.md](production-proof-pack-template.md) |
| **Developer / LLM** | [LLM_CONTEXT.md](LLM_CONTEXT.md) → this doc → [MVP_BACKEND_API_AUDIT.md](MVP_BACKEND_API_AUDIT.md) → relevant issue doc |
| **QA / smoke tester** | [production-smoke-checklist.md](production-smoke-checklist.md) → [TEST_MATRIX.md](TEST_MATRIX.md) → issue doc production section |

**Full index:** [docs/README.md](README.md)

---

## Known gaps (honest inventory)

| Gap | Impact | Where tracked |
| --- | --- | --- |
| No dedicated `SMOKE_TEST_*` vendor/admin accounts | Submit/finalize and tier-limit prod smoke **PENDING** / **SKIP** | [#30 deploy verification](deploy-verification.md), vendor self-service doc |
| Live SMTP inbox proof not captured | Email delivery unverified on production | [MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md](MVP_BACKEND_VENDOR_ONBOARDING_EMAIL_FLOW.md) |
| `PATCH /business-profile` skips Business sync | PUT works; PATCH partial sync gap | [business-sync.md](business-sync.md), [DECISION_REGISTER.md](DECISION_REGISTER.md) |
| `Business.usage` counters not wired | Tier limits use live product/variant counts (#31) | [MVP_BACKEND_VENDOR_SELF_SERVICE_APIS.md](MVP_BACKEND_VENDOR_SELF_SERVICE_APIS.md) |
| Service/food/private-listing ownership | Not covered by #31 unit tests | [MVP_BACKEND_VENDOR_SELF_SERVICE_APIS.md](MVP_BACKEND_VENDOR_SELF_SERVICE_APIS.md) |
| `/stripe/*` routes lack auth | Pre-#32 security risk | [MVP_BACKEND_API_AUDIT.md](MVP_BACKEND_API_AUDIT.md), [security-remediation-notes.md](security-remediation-notes.md) |

---

## Maintenance rule

When sprint state changes (merge, deploy, smoke, or issue closed):

1. Update **this file first** (snapshot table, issue matrix, known gaps).
2. Patch counts and conclusions in linked docs ([TEST_MATRIX.md](TEST_MATRIX.md), [deploy-verification.md](deploy-verification.md), issue-specific MVP docs).
3. Add new `docs/` files to [docs/README.md](README.md).

---

## Related documentation

| Doc | Purpose |
| --- | --- |
| [MVP_BACKEND_API_AUDIT.md](MVP_BACKEND_API_AUDIT.md) | Full API surface audit and fix order |
| [DECISION_REGISTER.md](DECISION_REGISTER.md) | MVP decisions and deferrals |
| [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) | Deploy, smoke, rollback |
| [TEST_MATRIX.md](TEST_MATRIX.md) | Automated tests ↔ manual smoke mapping |
