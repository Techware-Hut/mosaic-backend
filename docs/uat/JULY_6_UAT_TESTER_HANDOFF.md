# July 6 UAT Tester Handoff

> **Conformance audit update (2026-07-07):** production promotion has since occurred (backend PR #209 -> `main` `ad9ddd14`, frontend PR #335 -> `main` `b3a86cb4`). Testing now runs as **controlled production UAT** — use [`docs/uat/JULY_6_PRODUCTION_UAT_CHECKLIST.md`](JULY_6_PRODUCTION_UAT_CHECKLIST.md) for the current tester steps and safeguards. Branch/SHA references below (`staging` @ `65b89d5`, `develop` @ `8f000a15`) are historical. This is not final launch approval.

Date: July 6, 2026

Status: **Evidence Needed**

## Purpose

This handoff gives the manual QA team a focused checklist for proving the July 6 Vendor Journey fixes on the current release branches. Automated checks are passing, but production promotion is blocked until safe-account UAT evidence is attached.

## Branches Under Test

| Repo | Branch | SHA |
| --- | --- | --- |
| Techware-Hut/mosaic-backend | `main` (production) | `ad9ddd14c85ac851f9001e5f9952c9b594159d9c` |
| Digital-Builders-757/mosaic-biz-frontend-launch | `main` (production) | `b3a86cb43a8562e30d535ab5f1a58b6b97dca2a7` |

Pre-promotion candidates: backend `b838239b`, frontend `8163a3b3`.

**Environment:** Controlled production UAT — see [JULY_6_CONTROLLED_PRODUCTION_UAT_PLAN.md](../release/JULY_6_CONTROLLED_PRODUCTION_UAT_PLAN.md).

## What Has Been Technically Fixed

- Image-limit copy aligns with tier limits instead of saying only 3 images when 6 are allowed.
- Service offering counts and display are wired through backend and frontend.
- Product edit image galleries preserve multiple saved images.
- Service features persist through create/edit flows.
- Service and food vendors are not blindly forced through payout setup before final review.
- Product descriptions are rendered as safe plain text instead of visible raw HTML.
- Local shipping uses backend/vendor state eligibility and same-state checks.
- Cart quantity decrease uses the backend cart line update path.
- Coupon minimum cart-value validation remains backend-authoritative.
- Cart and checkout totals rely on backend pricing/order initiation.
- PDF and JPEG upload paths are covered by automated tests.
- Admin application status filters and explicit finalize decisions are wired.
- Restaurant/service Connect messaging is optionality-aware for **onboarding**; **checkout still requires vendor Connect** for paid orders (item 15 — confirm policy with Bryan).
- Frontend PR #334 fixes the July 6 cart/checkout focused ESLint regression.

## What Still Needs Manual Tester Proof

No checklist item is marked **Passed Smoke** yet. Manual testers must capture safe screenshots or recordings for each item below, plus any safe API/log summaries where requested.

## Exact Tester Checklist

| # | Area | Tester steps | Expected result | Status |
| --- | --- | --- | --- | --- |
| 1 | Image upload limit message | Open vendor listing/product/service image upload UI for a tier that allows 6 images. Attempt/select the documented maximum. | UI allows the correct count and does not show stale "3 images" copy. | Evidence Needed |
| 2 | Service offering count/display | Add or verify three service offerings. Check vendor dashboard and public/vendor profile. | All expected offerings/counts display according to the service offering contract. | Evidence Needed |
| 3 | Edit image gallery | Open a listing with multiple images, enter edit view, save without changing images, reopen. | All expected images remain visible before and after save. | Evidence Needed |
| 4 | Service feature editing | Create or open a service with features, edit features, save, reopen. | Edited features persist in the UI and safe response summary. | Evidence Needed |
| 5 | Service/food payout messaging | Open final review as a service vendor. Repeat for food/restaurant if available. | Messaging says Connect is required for online payouts when applicable, not blindly for every offline/directory listing. | Evidence Needed |
| 6 | Product HTML description display | Open product detail/card with HTML-like description. | Raw tags are not visible as broken text and unsafe HTML is not injected. | Evidence Needed |
| 7 | Local shipping | Test same-state vendor/customer and different-state vendor/customer if data exists. | Local shipping appears only when eligible; standard/express/local totals do not diverge. | Evidence Needed |
| 8 | Cart quantity decrease | Add product to cart, increase quantity, then decrease quantity. | Quantity and subtotal/total update correctly. | Evidence Needed |
| 9 | Coupon minimum logic | Apply a below-minimum coupon; apply a valid above-minimum coupon if available. | Backend rejection displays clearly below minimum; backend-approved discount only above minimum. | Evidence Needed |
| 10 | Cart vs checkout total match | Compare cart total, checkout total, and safe backend order initiation total. | Totals match or any backend recalculation is clearly explained. | Evidence Needed |
| 11 | Tracking email | Mark an order shipped with carrier/tracking number/tracking URL. | Backend stores tracking data, customer order page shows tracking, provider/log evidence shows sent/skipped/failed tracking email metadata. | Evidence Needed |
| 12 | PDF upload | Upload safe JPEG vendor document and safe PDF vendor document. | Both succeed, or exact hosted S3/CORS blocker is documented without signed URLs. | Evidence Needed |
| 13 | Admin filters/profile review | In admin, filter applications by submitted/pending, rejected/disapproved, approved/verified/finalized if test data exists. Open detail. | Status filters work; logo, bio, additional info, documents, and badge-review fields are visible enough for review. | Evidence Needed |
| 14 | Approve/reject/request-changes/finalize | Submit vendor application, reject with reason and required next action (models "request changes"), verify vendor view, resubmit if supported, then approve/finalize. | Admin and vendor both show clear next steps and final state. | Evidence Needed |
| 15 | Restaurant/service Connect messaging | Test restaurant/food and service vendor final review; attempt paid checkout if applicable. | Onboarding does not force payout setup; **paid checkout may still require Connect** — document behavior. | Evidence Needed |

## Required Screenshots Or Recordings

- Upload UI showing image limit copy.
- Vendor dashboard and public/vendor profile showing service offering counts.
- Listing edit gallery before and after save.
- Service feature edit form after save/reopen.
- Service and food/restaurant final review payout messaging.
- Product description display.
- Same-state and different-state cart/checkout shipping options.
- Cart quantity decrease and totals.
- Coupon rejection/approval messages and totals.
- Cart total and checkout total comparison.
- Customer order tracking view and safe email/provider/log summary.
- JPEG and PDF upload UI result.
- Admin status filters and admin application detail review.
- Admin reject/request-changes/finalize screens and vendor next-action view.

## Test Account Requirements

Use dedicated safe UAT accounts only. Do not include passwords in evidence.

Required account names/roles:

- Customer UAT account.
- Product vendor UAT account with at least one product listing.
- Service vendor UAT account with at least one parent service and multiple offerings.
- Food/restaurant vendor UAT account.
- Admin UAT reviewer account.
- Optional vendor/customer order pair with a safe shippable order.
- Safe test coupon configured with a minimum cart value.
- Safe upload files: one JPEG and one PDF with non-private content.

## Evidence Rules

- Do not expose passwords, tokens, API keys, Stripe keys, AWS keys, DSNs, or signed upload URLs.
- Do not include private customer data.
- Redact emails, phone numbers, addresses, order ids, and names when needed.
- Do not capture live payment card data.
- Use safe test data only.
- Mark items **Evidence Needed** when proof cannot be gathered.
- Mark items **Regression Found** only when a reproducible failure is observed.
- Do not mark anything **Passed Smoke** without screenshot/recording/log evidence.
- Do not mark anything **Accepted** without written client/UAT approval.

## Pass/Fail Table Template

| # | Area | Status | Evidence path/link | Tester notes | Regression owner if failed |
| --- | --- | --- | --- | --- | --- |
| 1 | Image upload limit message | Evidence Needed |  |  |  |
| 2 | Service offering count/display | Evidence Needed |  |  |  |
| 3 | Edit image gallery | Evidence Needed |  |  |  |
| 4 | Service feature editing | Evidence Needed |  |  |  |
| 5 | Service/food payout messaging | Evidence Needed |  |  |  |
| 6 | Product HTML description display | Evidence Needed |  |  |  |
| 7 | Local shipping | Evidence Needed |  |  |  |
| 8 | Cart quantity decrease | Evidence Needed |  |  |  |
| 9 | Coupon minimum logic | Evidence Needed |  |  |  |
| 10 | Cart vs checkout total match | Evidence Needed |  |  |  |
| 11 | Tracking email | Evidence Needed |  |  |  |
| 12 | PDF upload | Evidence Needed |  |  |  |
| 13 | Admin filters/profile review | Evidence Needed |  |  |  |
| 14 | Approve/reject/request-changes/finalize | Evidence Needed |  |  |  |
| 15 | Restaurant/service Connect messaging | Evidence Needed |  |  |  |

## How To Report A Regression

For each failed item, report:

- Checklist item number and title.
- Environment URL and branch/build identifier if visible.
- Safe account role used, without password.
- Exact steps to reproduce.
- Expected result.
- Actual result.
- Screenshot/recording path.
- Safe API/log summary if available.
- Classification: frontend bug, backend bug, full-stack contract mismatch, environment/evidence issue, or business decision needed.

## What Blocks Production Promotion

- Missing manual UAT evidence for any release-critical checklist item.
- Any **Regression Found** item without a fix PR and passing verification.
- Missing tracking email provider/log proof.
- Missing PDF/JPEG hosted upload proof.
- Missing written Lionel technical approval.
- Missing written Bryan business approval.
- Any decision to treat unrelated repo-wide frontend lint debt as release-blocking.

## Tester Message For Lionel To Send

July 6 fixes are merged into backend `staging` and frontend `develop`, and automated tests are passing. Manual UAT evidence is still needed before production promotion. Please use the July 6 tester checklist to retest checkout/cart/coupon totals, vendor services, admin review/finalize, shipping/tracking, uploads, and Connect messaging. Capture screenshots or recordings for each item, redact private data, and report any reproducible regressions with exact steps. We are not promoting to production yet.
