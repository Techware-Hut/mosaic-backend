# Vendor Onboarding State Gap Audit (Issue #65)

**Date:** 2026-06-18  
**Branch:** `sprint/backend-deploy-smoke-sentry-18-27`  
**Canonical reference:** [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md)

---

## Purpose

Compare issue #65 acceptance criteria against the implemented Stage-1 vendor lifecycle. Document gaps; no code changes unless a clear defect is found.

---

## Implemented state machine (summary)

| Status | Meaning | Source |
| --- | --- | --- |
| `draft` | In progress | `VendorOnboardingStage1.status` |
| `payment_pending` | $24.99 PI created | `createVerificationPayment` |
| `submitted` | Awaiting admin review | `submitForReview` |
| `verified` | Admin approved (API may say `approved`) | `finalizeVerification` |
| `rejected` | Admin rejected | `finalizeVerification` |

Payment sub-state: `verificationPayment.status` — `not_started` | `pending` | `paid` | `failed`.

Full transition table and mermaid diagram: [VENDOR_LIFECYCLE.md](VENDOR_LIFECYCLE.md).

---

## Gap analysis

| #65 expectation | Current behavior | Gap severity | Recommendation |
| --- | --- | --- | --- |
| Explicit state machine doc | **Complete** in `VENDOR_LIFECYCLE.md` | None | Keep as source of truth |
| Illegal transitions blocked | Handlers enforce per-state guards in controller | Low | Add integration tests for forbidden transitions (deferred) |
| `verified` vs `approved` naming | DB stores `verified`; JSON may return `approved` | Low | Document only (already in lifecycle doc) |
| Post-verify subscription gate | Subscription routes separate from Stage-1 status | Medium | Track in #76 vendor plan lifecycle |
| Business sync on verify | `syncBusinessFromOnboarding` runs on finalize | None | Covered in lifecycle doc |
| Resubmit after reject | `saveDraft` moves `rejected` → `draft`; `submitForReview` → `submitted` | None | Tested in `tests/vendor/` |
| Admin queue scope | Only `submitted` in pending queue | None | By design |
| Stage-2 / listing publish gates | `requireVerifiedVendor` middleware on vendor listing routes | Medium | Audit #76 for plan tier vs verify |
| Webhook payment → draft | PI success sets `paid`, returns to `draft` not auto-submit | None | Documented behavior |
| Idempotent submit | Re-submit while `submitted` returns 200 | None | Test exists |
| Terminal edit lock on `verified` | `saveDraft` blocked | None | Enforced in controller |
| Audit log / history trail | `statusHistory` on Order; onboarding lacks unified audit array | Low | Post-launch observability (#58) |
| Formal enum validation at API layer | Mongoose enum only | Low | express-validator optional hardening |

---

## Defects found

**None requiring immediate code fix in Batch 3.**

Observed behaviors match documented lifecycle. Remaining items are documentation, test coverage, or post-launch hardening — not launch blockers.

---

## Test coverage

| Area | Tests |
| --- | --- |
| Submit / payment / finalize | [`tests/vendor/`](../tests/vendor/), [`tests/admin/vendor-onboarding-finalize.test.js`](../tests/admin/vendor-onboarding-finalize.test.js) |
| Field protection | [`tests/vendor/vendor-onboarding-field-protection.test.js`](../tests/vendor/vendor-onboarding-field-protection.test.js) |
| Verified vendor middleware | Covered in vendor route tests |

---

## Related issues

| Issue | Relationship |
| --- | --- |
| #76 | Subscription / plan lifecycle after verify |
| #67 | Email triggers on submit/finalize (inventory updated) |
| #34 | Admin tooling for pending queue |

---

## Issue #65 resolution

Gap audit delivered against `VENDOR_LIFECYCLE.md`. No blocking defects. Close with doc evidence; future hardening tracked in #76 and deferred test expansion.
