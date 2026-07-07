# July 6 Controlled Production UAT Plan

Date: July 7, 2026  
Related: [`STAGING_ENVIRONMENT_AUDIT.md`](./STAGING_ENVIRONMENT_AUDIT.md), [`JULY_6_PRODUCTION_UAT_CHECKLIST.md`](../uat/JULY_6_PRODUCTION_UAT_CHECKLIST.md)

**This is not final launch approval.**

---

## 1. Why Controlled Production UAT

Mosaic Biz Hub does **not** have a complete isolated staging environment:

- Backend deploys to Elastic Beanstalk from `main` only (`deploy-eb-production.yml`)
- No separate staging API host is configured in repo
- Frontend `develop` branch provides CI/build checks and Vercel previews, not a full paired staging stack
- Shared production MongoDB, Stripe, S3, and email infrastructure are in use

July 6 fixes were promoted to production (backend PR #209, frontend PR #335) **before** manual UAT evidence and written business approval were attached. QA must therefore validate on **controlled production** with strict safeguards.

---

## 2. Production URLs Under Test

| Surface | URL (names only) |
| --- | --- |
| Customer/vendor app | Production frontend alias (e.g. `app.mosaicbizhub.com`) |
| API | `https://api.mosaicbizhub.com` |
| Health | `/api/health`, `/api/ready` |

Do not record or commit environment variable values.

---

## 3. Audited Release SHAs

| Repo | Branch | SHA |
| --- | --- | --- |
| mosaic-backend | `main` | `ad9ddd14c85ac851f9001e5f9952c9b594159d9c` |
| mosaic-biz-frontend-launch | `main` | `b3a86cb43a8562e30d535ab5f1a58b6b97dca2a7` |

Pre-promotion reference SHAs: backend `b838239b`, frontend `8163a3b3`.

---

## 4. Risks

| Risk | Mitigation |
| --- | --- |
| Real payments on production Stripe | Use safe test vendors; avoid live high-value orders without approval |
| Real customer email delivery | Use dedicated UAT accounts; redact inbox evidence |
| Inventory/order side effects | Use low-stock test products; cancel test orders when safe |
| Promotion before UAT sign-off | Treat all July 6 items as **Evidence Needed** until proven |
| Connect policy mismatch (item 15) | Document checkout behavior separately from onboarding messaging |
| No rollback without release owner | Follow rollback runbook; do not self-deploy |

---

## 5. Tester Safeguards

**Do:**

- Use dedicated UAT accounts per role
- Capture redacted screenshots per checklist item
- Record safe API response summaries (status codes, field names — no tokens)
- Stop and escalate on P0 commerce failures (items 8–10)
- Verify canonical `GET /api/featured-products` in network tab (regression guard)

**Do not:**

- Share passwords in evidence
- Paste signed S3 upload URLs into tickets
- Complete live Stripe Connect onboarding on real vendor accounts without approval
- Modify production environment variables
- Mark any checklist item Accepted without Bryan written approval
- Force-push `main` or `develop`

---

## 6. Rollback Notes

| Failure type | Rollback path |
| --- | --- |
| Frontend regression | Revert specific July 6 frontend PR merge; rerun build + unit tests |
| Backend regression | Revert specific backend merge commit; rerun unit/integration/contract tests |
| Commerce P0 (8–10) | Immediate release-owner notification; consider EB rollback per [`PRODUCTION_ROLLBACK_RUNBOOK`](../../mosaic-biz-frontend/docs/release/PRODUCTION_ROLLBACK_RUNBOOK.md) |

Rollback requires release-owner approval. This audit did not perform any rollback.

---

## 7. Approval Gates

| Gate | Owner | Status |
| --- | --- | --- |
| Technical approval | Lionel | Pending |
| Business approval | Bryan | Pending |
| Manual UAT evidence | QA team | Evidence Needed (all 15 items) |
| Launch sign-off | Release owner | **Not granted** |

---

## 8. Automated Pre-UAT Verification (Completed in Audit)

| Check | Result |
| --- | --- |
| Backend unit tests | 529/529 pass |
| Backend integration | 74/74 pass |
| Backend contract | 20/20 pass |
| Frontend build | Pass |
| Frontend unit tests | 172/172 pass |
| Featured route canonical | Verified |
| `/api/products/featured` | Not used |

---

## 9. Known Open Issues for UAT Focus

1. **Item 15:** Checkout requires Stripe Connect for all vendors; onboarding skips payout for service/food — validate with product owner
2. **Item 4:** Parent-service create may drop features — test both create flows
3. **Item 11:** Shipment email needs provider/log proof
4. **Item 12:** PDF upload needs hosted S3/CORS proof

Work orders tracked in [`JULY_6_DOCS_TO_CODE_CONFORMANCE_AUDIT.md`](../audit/JULY_6_DOCS_TO_CODE_CONFORMANCE_AUDIT.md).

---

## 10. Statement

This controlled production UAT plan supports evidence collection only. It is **not** final launch approval. Production promotion has already occurred; this UAT determines whether the promoted build is acceptable for continued operation and whether follow-up fixes are required.
