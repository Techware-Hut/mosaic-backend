# July 6 UAT Traceability - Backend Copy

Date: July 7, 2026 (conformance audit update)
Repo: Techware-Hut/mosaic-backend
Production branch: `main`
Audited production SHA: `ad9ddd14c85ac851f9001e5f9952c9b594159d9c`
Pre-promotion candidate SHA: `b838239b481f9f68be6f0c80ac527069a5d78964` (`staging`)
Paired frontend production SHA: `b3a86cb43a8562e30d535ab5f1a58b6b97dca2a7`

## Purpose

Trace each July 6 Vendor Journey QA Checklist item to the current owner, merged fix evidence, command proof, remaining smoke evidence, and rollback path. This file reflects the post-merge state after backend PRs #201-#206 and frontend PRs #325-#333.

## Status Rules

- **Passed Smoke** means browser/runtime evidence exists.
- **Implemented / Ready for QA** means code and automated checks support the fix, but client/UAT smoke may still need screenshots.
- **Evidence Needed** means the item needs safe-account runtime proof or hosted provider evidence.
- **Pending Client Input** means business policy approval is needed.
- **Regression Found** means a verified failure remains.

## Traceability Matrix

| # | UAT item | Owner | Current status | Fix branch/PR | Command/test proof | Evidence still needed | Next action | Rollback note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Image upload limit message | Frontend | Implemented / Ready for QA | Frontend #328 | Frontend build/unit/focused eslint passed. | Upload UI screenshot showing correct tier limit copy. | Run safe vendor upload smoke. | Revert #328 if copy regresses. |
| 2 | Three services display as expected | Both | Implemented / Ready for QA | Backend #206, Frontend #332 | Backend integration service offering counts; frontend service offering unit tests. | Vendor dashboard and public/vendor profile screenshots. | Run service vendor smoke with three offerings. | Revert #206/#332 if display regresses. |
| 3 | Edit view shows all images | Frontend | Implemented / Ready for QA | Frontend #331 | Product edit image helper tests passed. | Before/after edit-gallery screenshots. | Run multi-image edit smoke. | Revert #331 if gallery persistence regresses. |
| 4 | Features can be edited | Backend primary | Regression Risk | Backend #202 | `createService` persists features; `createParentService` still hardcodes `features: []`. | Service feature edit/save/reopen screenshot; test parent-create path. | Run service feature smoke. | Revert #202 if persistence regresses. |
| 5 | Service vendor payout/bank setup | Both | Implemented / Ready for QA | Backend #205, Frontend #330 | Frontend guard tests show service/food skip payout; backend tests passed. | Service vendor final-review screenshot. | Validate messaging with safe service vendor. | Revert #205/#330 if gating regresses. |
| 6 | Product description HTML rendering | Frontend | Implemented / Ready for QA | Frontend #333 | Product description plain-text tests passed. | Product detail/card screenshot showing no raw tags. | Run product visual smoke. | Revert #333 if text rendering regresses. |
| 7 | Local shipping same-state behavior | Both | Implemented / Ready for QA | Backend #204, Frontend #329 | Backend local delivery integration and frontend state-matching tests passed. | Same-state and different-state cart/checkout screenshots. | Run shipping smoke with safe addresses. | Revert #204/#329 if eligibility regresses. |
| 8 | Cart quantity decrease | Both | Implemented / Ready for QA | Prior cart fixes plus frontend #334 | Backend cart decrement integration passed; focused eslint errors fixed. | Cart screenshot after increase/decrease and total update. | Run customer cart smoke. | Revert #334 only if the lint fix regresses UI behavior. |
| 9 | Coupon cart-value logic | Backend primary | Implemented / Ready for QA | Prior cart/coupon fixes | Backend coupon minimum order tests passed; frontend still defers to backend. | Below-minimum and valid-coupon screenshots/safe response summaries. | Run coupon smoke with safe test coupon. | Revert coupon backend fix if validation regresses. |
| 10 | Cart vs checkout amount | Both | Implemented / Ready for QA | Prior cart/checkout fixes plus frontend #334 | Backend order initiation guards passed; frontend build/unit passed. | Cart/checkout/order total evidence. | Run checkout amount smoke. | Revert #334 only if display/request speed handling regresses. |
| 11 | Shipment tracking email | Backend primary | Evidence Needed | Existing backend tracking/email code | Backend test suite passed, but hosted provider evidence was not run. | Shipment action, customer tracking display, and safe provider/log summary. | Run shipment email smoke without exposing private data. | Revert tracking-email change only if hosted smoke proves regression. |
| 12 | PDF upload | Both | Implemented / Ready for QA | Existing upload fixes | Backend PDF/JPEG upload tests and frontend PDF MIME tests passed. | Authenticated JPEG/PDF upload screenshots; no signed URLs. | Run hosted/local upload smoke. | Revert upload fix if hosted S3/CORS smoke proves regression. |
| 13 | Admin application filters/profile review | Both | Implemented / Ready for QA | Backend #203, Frontend #326/#327 | Backend status filter integration; frontend admin API tests passed. | Admin list/detail screenshots with redaction. | Run admin safe-account smoke. | Revert #203/#326/#327 if admin review regresses. |
| 14 | Approval/disapproval/finalize | Both | Implemented / Ready for QA | Frontend #327 plus backend finalize foundation | Backend finalize tests and frontend explicit decision tests passed. | Admin/vendor screenshots for reject, next action, resubmit, approve/finalize. | Run full admin/vendor application smoke. | Revert #327 if finalize UI regresses. |
| 15 | Restaurant/service Connect requirement | Both | Code Mismatch + Pending Client Input | Backend #205, Frontend #330 | Onboarding skips payout for service/food; checkout still requires Connect (`checkoutGuards.js`). | Restaurant/service final-review + checkout attempt screenshot. | Validate with safe food/service vendor; confirm policy with Bryan. | Revert #205/#330 if onboarding messaging regresses. |

## Current Backend Evidence

| Command | Status | Evidence |
| --- | --- | --- |
| `npm test` | Implemented / Ready for QA | 529/529 passed. |
| `npm run test:integration` | Implemented / Ready for QA | 74/74 passed. |
| `npm run test:contract` | Implemented / Ready for QA | 20/20 passed, including featured route and Stripe raw-body guards. |
| `npm run smoke:backend` | Evidence Needed | Not run because no common local backend server port was listening. |

## Manual Smoke Evidence Status

No checklist item is marked **Passed Smoke** yet. Safe customer/vendor/admin credentials, hosted provider evidence for tracking email, and screenshots are still required.
