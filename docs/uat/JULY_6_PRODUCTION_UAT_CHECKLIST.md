# July 6 Production UAT Checklist

Date: July 7, 2026  
Environment: **Controlled production UAT** (no isolated staging stack)  
Audited production SHAs: backend `ad9ddd14`, frontend `b3a86cb4`

**This is not final launch approval.** Do not mark any item Accepted without written client/UAT approval from Bryan.

---

## Before You Start

| Requirement | Detail |
| --- | --- |
| Accounts | Dedicated safe UAT customer, vendor (product/service/food), and admin accounts |
| Evidence | Redacted screenshots or screen recordings; no passwords in files |
| Forbidden | Signed S3 URLs, API keys, webhook secrets, real high-value orders without approval |
| Approvals pending | Lionel (technical), Bryan (business) — both required before launch sign-off |

See also: [`JULY_6_CONTROLLED_PRODUCTION_UAT_PLAN.md`](../release/JULY_6_CONTROLLED_PRODUCTION_UAT_PLAN.md)

---

## Checklist

| # | Area | Steps | Expected | Status | Screenshot |
| --- | --- | --- | --- | --- | --- |
| 1 | Image upload limit | Open vendor upload UI for tier allowing 6 images; attempt max selection | Correct limit message; no stale "3 only" copy | Evidence Needed | Upload UI |
| 2 | Service offering count | Add/verify 3 offerings; check dashboard + public profile | All offerings/counts visible | Evidence Needed | Dashboard + public |
| 3 | Edit image gallery | Edit listing with multiple images; save; reopen | All images preserved | Evidence Needed | Before/after edit |
| 4 | Service features | Create/edit features; save; reopen | Features persist (test both create paths if possible) | Evidence Needed | Feature form + reopen |
| 5 | Service/food payout messaging | Open final review as service and food vendor | Payout not forced for onboarding; messaging accurate | Evidence Needed | Final review |
| 6 | Product description | Open product with HTML-like description | No raw tags; no unsafe HTML | Evidence Needed | Product detail |
| 7 | Local shipping | Same-state and different-state cart if data exists | Local only when eligible | Evidence Needed | Cart shipping chips |
| 8 | Cart quantity decrease | Increase then decrease qty in cart | Qty and totals update | Evidence Needed | Cart totals |
| 9 | Coupon minimum | Apply below-minimum coupon; then valid coupon | Backend rejection below min; discount above min | Evidence Needed | Coupon messages |
| 10 | Cart vs checkout total | Compare cart, checkout, order initiate | Totals match or explained recalculation | Evidence Needed | Cart + checkout |
| 11 | Tracking email | Ship order with tracking URL; check customer view | Tracking visible; safe provider/log shows sent/skipped | Evidence Needed | Order + log summary |
| 12 | PDF/JPEG upload | Upload JPEG and PDF vendor documents | Both succeed or document exact blocker (no signed URLs) | Evidence Needed | Upload result |
| 13 | Admin filters/profile | Filter by status; open detail | Filters work; logo, bio, docs, badge visible | Evidence Needed | Admin list + detail |
| 14 | Approve/reject/finalize | Reject with reason + next action; vendor view; resubmit; approve | Clear next steps both sides | Evidence Needed | Admin + vendor screens |
| 15 | Restaurant/service Connect | Final review + attempt paid checkout for service/food if applicable | Messaging not overpromising; note checkout Connect requirement | Evidence Needed | Final review + checkout |

---

## Status Terms (Use Only These)

- Implemented / Ready for QA
- Evidence Needed
- Documentation Mismatch
- Code Mismatch
- Regression Risk
- Pending Client Input
- Deferred / Future Phase
- Blocked

---

## Rollback Risk Summary

| Priority | Items | Action if fail |
| --- | --- | --- |
| High | 8, 9, 10, 14, 15 | Stop commerce/onboarding UAT; escalate to release owner |
| Medium | 2, 3, 4, 7, 11, 12, 13 | Document failure; open focused fix PR |
| Low | 1, 6 | Copy/rendering fix; non-blocking for commerce |

---

## Evidence Upload

Attach evidence to the release tracker with filenames like `uat-july6-item-08-cart-qty.png`. Redact PII and secrets.

Cross-repo conformance audit: [`../audit/JULY_6_DOCS_TO_CODE_CONFORMANCE_AUDIT.md`](../audit/JULY_6_DOCS_TO_CODE_CONFORMANCE_AUDIT.md)
