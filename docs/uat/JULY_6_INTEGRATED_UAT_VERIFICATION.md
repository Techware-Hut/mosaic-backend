# July 6 Integrated UAT Verification

Date: July 6, 2026

Release-control status: **Fixed / Ready for Review** for automated base-branch verification and the frontend lint regression fix. Manual UAT smoke evidence is still **Evidence Needed**.

Production promotion recommendation: **Evidence Needed**. Do not promote to production until safe-account/manual screenshots are attached and the release owner explicitly accepts the remaining repo-wide lint baseline or schedules it outside this UAT wave.

## Branches And SHAs Tested

| Repo | Branch | SHA / base |
| --- | --- | --- |
| Techware-Hut/mosaic-backend | `staging` | `65b89d5dbe22c10adc48628018b3ee7b9b5a7bee` |
| Digital-Builders-757/mosaic-biz-frontend-launch | `develop` | `8f000a158cd2ab8ab7674846443fcf937d0dcbfa` |
| Digital-Builders-757/mosaic-biz-frontend-launch | `fix/july6-cart-checkout-eslint-regression` | Based on `8f000a158cd2ab8ab7674846443fcf937d0dcbfa`; frontend PR #334 to `develop`. |

## Merged July 6 PRs

| PR | Repo | Purpose | Merge SHA | Status |
| --- | --- | --- | --- | --- |
| #201 | Backend | Backend architecture gap audit docs | `185f73f8eb1073e1921603b5010c9300df46443f` | Fixed / Ready for Review |
| #202 | Backend | Persist service features on create | `2dfef8b9ce1799c93da4e7cc613e31a92fd54d20` | Fixed / Ready for Review |
| #203 | Backend | Admin application status filters API | `de38cf3a3486931bf98791ac4431569b85b8c34e` | Fixed / Ready for Review |
| #204 | Backend | Local delivery vendor state contract | `cc5a34cc13a98546f8bfea1d79c8f05b79573049` | Fixed / Ready for Review |
| #205 | Backend | Service/food Connect optionality backend | `dadc5f4e31c4fa4078250bbffb1a65f770097a6a` | Fixed / Ready for Review |
| #206 | Backend | Service offering counts | `65b89d5dbe22c10adc48628018b3ee7b9b5a7bee` | Fixed / Ready for Review |
| #325 | Frontend | Frontend architecture gap audit docs | `cda41a03256fbaabb09cbadab127f381a1eb5500` | Fixed / Ready for Review |
| #326 | Frontend | Admin status filters UI | `eb2cf772d54a4244d3afbc9cd1e6cbab41de97a3` | Fixed / Ready for Review |
| #327 | Frontend | Admin finalize/profile review decisions | `8f000a158cd2ab8ab7674846443fcf937d0dcbfa` | Fixed / Ready for Review |
| #328 | Frontend | Image-limit copy | `9e6bb7cf8d61ddea7d4de521c058d31053274d3b` | Fixed / Ready for Review |
| #329 | Frontend | Local shipping UI | `b1448f474a8af8f3333e16b134476710c47bcaf4` | Fixed / Ready for Review |
| #330 | Frontend | Connect messaging for service/food vendors | `d41c035f8ef1d01de0100ec03a463360aee6be0c` | Fixed / Ready for Review |
| #331 | Frontend | Edit image gallery preservation | `5f145368820fdbd8af13ff53cd15d9e3dfc6e670` | Fixed / Ready for Review |
| #332 | Frontend | Service offering display | `4a6f3793bb849a1a414a14a733b249936df957bb` | Fixed / Ready for Review |
| #333 | Frontend | Plain-text product descriptions | `aaffd6cdcee760c7fd7b98c02bb2e5d61acb2714` | Fixed / Ready for Review |

## Frontend Lint Regression Fix

Status: **Fixed / Ready for Review**

Branch/PR: `fix/july6-cart-checkout-eslint-regression`, frontend PR #334

Files changed:

- `app/(home)/cart/page.tsx`
- `app/(home)/checkout/buy-now/page.tsx`

Root cause:

- The React compiler lint rules flagged synchronous state work triggered by mount/defaulting effects in cart and buy-now.
- Cart also called `Date.now()` during render while computing sale display fallback state.

Fix:

- Deferred initial async loading from effects by one microtask so effect bodies do not synchronously trigger state.
- Replaced default-delivery-speed state-writing effects with derived active delivery speed already used by pricing fallbacks.
- Normalized cart item sale-active state when cart API data is loaded, avoiding render-time `Date.now()` while preserving sale display.
- Kept coupon validation and cart totals backend-authoritative; no frontend-only discount math was added.

## Automated Verification Results

### Backend

| Command | Result | Notes |
| --- | --- | --- |
| `git pull --ff-only origin staging` | Passed | Already up to date. |
| `npm test` | Passed | 529/529 passed. |
| `npm run test:integration` | Passed | 74/74 passed. Covers cart quantity decrease, coupon minimum order validation, local delivery vendor state, service features/counts, admin status filtering/finalize, PDF upload paths, and Connect optionality. |
| `npm run test:contract` | Passed | 20/20 passed. Confirms `GET /api/featured-products`, absence of `/api/products/featured`, and Stripe webhook raw-body order. |
| `npm run smoke:backend` | Evidence Needed | Not run because no common local backend server port was listening. |

### Frontend

| Command | Result | Notes |
| --- | --- | --- |
| `git pull --ff-only origin develop` | Passed | Already up to date before branch creation. |
| Focused July 6 eslint before fix | Regression Found | 5 errors and 9 warnings. Errors were only in cart and buy-now. |
| `npx eslint app/(home)/cart/page.tsx app/(home)/checkout/buy-now/page.tsx` | Passed | 0 errors, 2 warnings after fix. |
| Focused eslint on all July 6 touched files | Passed | 0 errors, 9 warnings after fix. Remaining warnings are existing `<img>`, hook dependency, and token-color warnings outside the scoped regression. |
| `npm run build` | Passed | Next.js production build completed. |
| `npm test --if-present` | Passed | Exited 0; no default test output. |
| `npm run test:unit` | Passed | 172/172 passed across 46 suites. |
| `npm run lint` | Regression Found | Repo-wide baseline still fails with 238 errors and 205 warnings across unrelated admin/dashboard/shared files. This is not caused by the cart/buy-now patch. |

## Route And Safety Invariants

| Check | Evidence | Status |
| --- | --- | --- |
| Preserve `GET /api/featured-products` | Backend active source registers `/featured-products`; frontend active source calls `/api/featured-products` from `lib/api/featured-products.ts`. | Fixed / Ready for Review |
| Do not introduce `/api/products/featured` | Active backend scan over `app.js`, `routes`, `controllers`, and `lib` found no matches. Active frontend scan over `app`, `components`, `lib`, `hooks`, and `utils` found no matches. | Fixed / Ready for Review |
| Stripe webhook and middleware order | Backend contract tests passed. No backend runtime code changed in this pass. | Fixed / Ready for Review |
| Secrets | No `.env`, secret, credential, token, Stripe key, AWS key, DSN, or signed URL values were committed or documented. | Fixed / Ready for Review |

## July 6 Vendor Journey Checklist

No manual browser smoke was marked **Passed Smoke** because safe demo credentials and hosted runtime evidence were not available in this pass. Items with automated proof are marked **Fixed / Ready for Review** and still need client/UAT screenshots.

| # | Checklist item | Status | Owner | Branch/PR evidence | Command/test proof | Screenshot/evidence path | Next action | Rollback note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Image upload limit message | Fixed / Ready for Review | Frontend | #328 | Frontend build/unit/focused eslint passed. | Evidence Needed | Capture upload UI showing tier limit copy does not say 3 when 6 are allowed. | Revert #328 if copy regresses. |
| 2 | Service count/display | Fixed / Ready for Review | Both | Backend #206, Frontend #332 | Backend integration counts service offerings; frontend service offering unit tests passed. | Evidence Needed | Capture vendor dashboard and public/vendor profile showing expected offerings. | Revert #206/#332 if count/display regresses. |
| 3 | Edit image gallery | Fixed / Ready for Review | Frontend | #331 | Frontend product edit image helper tests passed. | Evidence Needed | Capture edit view before/after save with multiple images. | Revert #331 if gallery persistence regresses. |
| 4 | Feature editing | Fixed / Ready for Review | Backend primary | #202 | Backend unit/integration coverage passed for service create/update feature persistence. | Evidence Needed | Capture service feature edit/save/reopen flow. | Revert #202 if feature persistence regresses. |
| 5 | Service vendor payout/bank setup | Fixed / Ready for Review | Both | Backend #205, Frontend #330 | Backend integration and frontend guard tests show service/food skip payout setup; product vendors still require payout. | Evidence Needed | Capture service vendor final-review messaging. | Revert #205/#330 if payout gating regresses. |
| 6 | Product HTML description | Fixed / Ready for Review | Frontend | #333 | `productDescriptionToPlainText` unit tests passed. | Evidence Needed | Capture product page/card showing no raw tags or unsafe HTML injection. | Revert #333 if description rendering regresses. |
| 7 | Local shipping | Fixed / Ready for Review | Both | Backend #204, Frontend #329 | Backend integration covers vendor state contract; frontend local delivery unit tests passed. | Evidence Needed | Capture same-state and different-state cart/checkout shipping options. | Revert #204/#329 if local eligibility regresses. |
| 8 | Cart quantity decrease | Fixed / Ready for Review | Both | Existing July 6 cart work plus frontend #334 | Backend integration covers decrease by `cartItemId`; frontend #334 preserves update flow while fixing lint. | Evidence Needed | Capture increase/decrease subtotal update in cart. | Revert #334 only if UI behavior regresses; cart logic rollback depends on prior cart PRs. |
| 9 | Coupon cart-value logic | Fixed / Ready for Review | Backend primary | Existing July 6 cart/coupon work | Backend unit/integration covers minimum order validation; frontend still defers to backend. | Evidence Needed | Capture below-minimum rejection and above-minimum backend-approved discount. | Revert coupon backend PRs if validation regresses. |
| 10 | Cart vs checkout amount | Fixed / Ready for Review | Both | Existing July 6 cart/checkout work plus frontend #334 | Backend tests cover order initiation guards; frontend build/unit pass after lint fix. | Evidence Needed | Capture cart total, checkout total, and safe backend total summary. | Revert #334 only if display/request payload regresses. |
| 11 | Shipment tracking email | Evidence Needed | Backend primary | Existing backend email/tracking tests | Backend tests pass, but no hosted provider/log smoke was run. | Evidence Needed | Verify shipment action, stored tracking, customer page tracking, and provider/log evidence without exposing private email or secrets. | Revert tracking-email change only if hosted smoke proves regression. |
| 12 | PDF upload | Fixed / Ready for Review | Both | Existing upload fixes | Backend PDF/JPEG upload tests and frontend PDF MIME tests passed. | Evidence Needed | Capture JPEG and PDF upload in hosted/local authenticated UI; do not expose signed URLs. | Revert upload fix only if hosted S3/CORS smoke proves regression. |
| 13 | Admin filters/profile badge review | Fixed / Ready for Review | Both | Backend #203, Frontend #326/#327 | Backend integration covers status filters; frontend admin API unit tests passed. | Evidence Needed | Capture status filters and review detail with private data redacted. | Revert #203/#326/#327 if admin review regresses. |
| 14 | Approval/disapproval/finalize | Fixed / Ready for Review | Both | Frontend #327 plus backend finalize foundation | Backend finalize tests and frontend explicit decision tests passed. | Evidence Needed | Capture reject/change reason, vendor next step, resubmit if supported, approve/finalize. | Revert #327 if finalize UI regresses; backend rollback depends on finalize foundation PR. |
| 15 | Restaurant/service Stripe Connect requirement | Fixed / Ready for Review | Both | Backend #205, Frontend #330 | Frontend guard tests show service and food skip payout before final review; backend optionality tests passed. | Evidence Needed | Capture restaurant/service final review and online-payout messaging. | Revert #205/#330 if Connect optionality regresses. |

## Manual Smoke Blockers

| Blocker | Status | Notes |
| --- | --- | --- |
| Safe demo credentials/session | Evidence Needed | No safe customer/vendor/admin credentials were available in this pass. |
| Hosted/local backend smoke server | Evidence Needed | No common local backend server port was listening; `npm run smoke:backend` was not run. |
| Screenshots/recordings | Evidence Needed | No checklist item is marked Passed Smoke without visual/runtime evidence. |
| Shipment tracking provider evidence | Evidence Needed | Needs safe provider/log summary without private email addresses or secrets. |

## Bugs Fixed During This Pass

| Bug | Status | Evidence |
| --- | --- | --- |
| Frontend focused eslint failed on cart/buy-now with 5 React compiler errors | Fixed / Ready for Review | Frontend PR #334; focused July 6 eslint now exits 0 with 0 errors. |

## Bugs Still Open

| Item | Status | Next action |
| --- | --- | --- |
| Repo-wide `npm run lint` baseline | Regression Found | 238 errors and 205 warnings remain outside this scoped UAT fix. Decide whether to waive for this release or schedule a separate lint-hardening wave. |
| Manual UAT screenshots | Evidence Needed | Run browser UAT with safe customer/vendor/admin accounts and attach screenshot paths. |
| Shipment tracking email hosted proof | Evidence Needed | Run shipment smoke with safe order and summarize provider/log result without exposing private data. |

## Business Decisions Still Needed

| Decision | Status | Notes |
| --- | --- | --- |
| Production promotion | Pending Client Input | Should wait for manual UAT evidence. |
| Repo-wide lint baseline | Pending Client Input | Decide whether unrelated lint debt blocks production. |
| Online payout policy wording for directory/offline service and restaurant vendors | Pending Client Input | Current fixes prevent blind compulsory Connect setup; policy copy still needs UAT sign-off. |

## What Was Not Tested

- No production or staging deploy was performed.
- No PR was merged during this pass.
- No live Stripe, payment, Connect payout, webhook, or subscription behavior was exercised.
- No signed upload URLs or email provider values were inspected or exposed.
- No safe-account browser screenshots were captured.

## Final Recommendation

Ready for staging UAT: **Fixed / Ready for Review**.

Ready for production: **Evidence Needed**.

Production promotion is blocked until manual UAT evidence is complete, shipment tracking email behavior is verified in a safe environment, and release owners decide how to handle unrelated repo-wide lint debt.
