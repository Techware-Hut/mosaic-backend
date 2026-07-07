# July 6 Docs-to-Code Conformance Audit (Backend)

- Date: 2026-07-07
- Audit branch: `audit/july6-docs-code-conformance` (cut from `origin/main`)
- Backend `main` tip audited: `ad9ddd1` (PR #209, `staging` -> `main`)
- Staging candidate SHA `b838239b481f9f68be6f0c80ac527069a5d78964` is an ancestor of `main` — **production promotion has already happened**.
- Frontend counterpart: `mosaic-biz-frontend-launch` `main` tip `b3a86cb4` (PR #335, `develop` -> `main`); develop candidate `8163a3b3` is an ancestor of `main`.
- Scope: documentation-to-implementation conformance for the 15 July 6 QA items. **Docs-only pass. No runtime code changed, no merges, no deploys.**

## Status vocabulary

Only these statuses are used: `Implemented / Ready for QA`, `Evidence Needed`, `Documentation Mismatch`, `Code Mismatch`, `Regression Risk`, `Pending Client Input`, `Deferred / Future Phase`, `Blocked`. Nothing is marked Accepted; no written client/UAT approval exists as of this audit.

## Executive summary

1. All July 6 backend fixes claimed in the UAT docs are present on `main` and covered by passing automated tests (529 unit / 74 integration / 20 contract, all green at `ad9ddd1`).
2. The most important conformance gap is **release-state drift, not code drift**: every July 6 UAT doc says production promotion is Blocked pending manual UAT evidence and written Lionel/Bryan approval, yet `staging` was merged to `main` (PR #209). This release must therefore be treated as **controlled production UAT**, not an approved launch (see Production UAT Readiness below).
3. One documentation mismatch was found and corrected: `docs/architecture/API_CONTRACT_ALIGNMENT_MATRIX.md` claimed the cart contract exposes `localDeliveryEligible`; the backend returns `vendorState` only (frontend derives local eligibility from same-state matching).
4. One frontend-side code risk affects a backend contract consumer: the legacy product edit page (`inventory/edit/[id]`) manages only the cover image even though `GET /api/product/:productId` returns the full `galleryImages` array. Tracked as follow-up work order FW-1 (frontend repo).
5. No forbidden "Accepted"/"launch-ready" language was found in the July 6 doc set. The docs are disciplined about approval gates; they are, however, temporally layered (pre-fix audits vs post-merge verification) with three different "verified" SHAs. Superseded-state notes were added.
6. `GET /api/featured-products` remains canonical; `/api/products/featured` has **zero hits in runtime code** (only docs, smoke scripts, and guard tests that assert its absence).

## Phase 1 — Source document inventory

| Doc | Purpose | Branch/SHA referenced | State | Forbidden approval language |
|---|---|---|---|---|
| `docs/uat/JULY_6_UAT_TRACEABILITY.md` | Maps 15 QA items to PRs #201–#206 / #325–#333, tests, rollback | `staging` @ `65b89d5` | Stale SHA (pre-#207/#208/#209) | None; explicitly denies Passed Smoke |
| `docs/uat/JULY_6_INTEGRATED_UAT_VERIFICATION.md` | Cross-repo merged-PR + automated test record | `staging` @ `65b89d5`, frontend `develop` @ `8f000a15` | Stale SHA; says PR #334 open (merged) | None; "Production promotion recommendation: Evidence Needed" |
| `docs/uat/JULY_6_UAT_TESTER_HANDOFF.md` | Manual tester steps and evidence rules for all 15 items | `65b89d5` / `8f000a15` | Stale SHA; assumes staging env that does not exist | None; contains explicit prohibition on "Accepted" |
| `docs/uat/JULY_6_RELEASE_READINESS_SUMMARY.md` | Executive readiness snapshot | `65b89d5` / `8f000a15`; PRs #207/#334 listed open | Stale (PRs since merged) | None; production explicitly Blocked |
| `docs/uat/JULY_6_POST_MERGE_VERIFICATION.md` | Post-#207/#334 verification | `staging` @ `429e4ef4`, frontend `develop` @ `2b1b8fac` | Stale vs `main` `ad9ddd1`; conflicts with promotion state | None; says production blocked pending Bryan approval |
| `docs/uat/JULY_6_BACKEND_REGRESSION_CHECKLIST.md` | Safe verification commands + manual smoke targets | `docs/july-6-architecture-gap-audit` on `staging` | Pre-fix snapshot; test counts stale (522/72 vs 529/74) | None |
| `docs/uat/JULY_6_GITHUB_ISSUE_PLAN.md` | Issue bodies for then-open gaps | `docs/july-6-architecture-gap-audit`; PR #199/#200 SHAs | Pre-fix snapshot; conflicts with post-merge claims | None |
| `docs/release/STAGING_ENVIRONMENT_AUDIT.md` | Concludes no true staging environment exists | `staging` @ `b838239`, frontend `develop` @ `8163a3b3` | Closest to candidate SHAs; conflicts with "Ready for staging UAT" phrasing elsewhere | None |
| `docs/release/BUG_RESOLUTION_LEDGER.md` | June 24 rehearsal defect ledger | None | Stale; predates July 6 wave | None |
| `docs/release/CLIENT_DECISION_REGISTER.md` | Open Bryan product decisions (incl. Connect visibility) | None | Stale but load-bearing for items 5/15 | None; decisions remain open |
| `docs/architecture/API_CONTRACT_ALIGNMENT_MATRIX.md` | Cross-repo API contract matrix for July 6 defects | `docs/july6-integrated-uat-verification` on `staging` | Contained one contract inaccuracy (`localDeliveryEligible`) — corrected in this pass | None |
| `docs/architecture/JULY_6_UAT_BACKEND_GAP_AUDIT.md` | Pre-fix gap classification | `docs/july-6-architecture-gap-audit` | Superseded pre-fix snapshot (note added) | None |
| `docs/architecture/BACKEND_ROUTE_CONTRACT_AUDIT.md` | Pre-fix route truth audit | `docs/july-6-architecture-gap-audit` | Superseded pre-fix snapshot (note added) | None |
| `docs/architecture/BACKEND_LAUNCH_FLOW_MAP.md` | Flow map + business decision log | `docs/july-6-architecture-gap-audit` | Superseded pre-fix snapshot (note added) | None |
| `docs/AGENT_CONTEXT_INDEX.md` | — | — | Does not exist | — |
| `docs/release/JULY_6_CONTROLLED_PRODUCTION_UAT_PLAN.md` | — | — | Does not exist; posture covered by this audit + `JULY_6_PRODUCTION_UAT_CHECKLIST.md` | — |
| `docs/README.md` | Docs index | June 28 consolidation | Does not index the July 6 doc set | None |

Cross-document conflicts (documented, not all fixable in a docs pass):

- Three "verified" backend SHAs coexist (`65b89d5`, `429e4ef4`, `b838239`) without precedence; none reference `main` `ad9ddd1`.
- Pre-fix architecture docs list items 4, 7, 13 (and Connect 5/15) as open gaps; post-merge docs mark them fixed via PRs #202–#206. The pre-fix docs are point-in-time audits; superseded notes added.
- All UAT docs say "Ready for staging UAT" while `STAGING_ENVIRONMENT_AUDIT.md` establishes no real staging exists — resolved in practice by the controlled production UAT posture documented here.
- All UAT docs say production promotion is Blocked; promotion has in fact occurred (PR #209 / PR #335).

## Phase 4 — July 6 checklist conformance matrix

Statuses verified against backend `main` `ad9ddd1` and frontend `main` `b3a86cb4`. FE = frontend repo paths, BE = backend repo paths. Detailed evidence lives in `docs/audit/JULY_6_BACKEND_IMPLEMENTATION_TRACE.md` and the frontend `docs/audit/JULY_6_FRONTEND_IMPLEMENTATION_TRACE.md`.

| # | QA item | Doc claim | Implementation evidence (summary) | Route/API | Tests | Status | Owner | Rollback risk |
|---|---|---|---|---|---|---|---|---|
| 1 | 6 images selectable but error says 3 allowed | Fixed via FE #328 | Limit is plan-driven (`limits.imageLimit`/`galleryImageLimit`), not hardcoded 3. BE enforces at create/update/presign (`productController.js` L333–352, L1613–1619; service/food equivalents). FE copy uses the same plan variable: "You can only upload up to ${imageLimit} images." No hardcoded "3" copy remains in FE app code. | `POST/PUT /api/product`, `GET /api/product/upload-url` (+ service/food) | BE: `s3-presigned-upload-contract.test.js`; FE: `listingUploads.test.ts` | Implemented / Ready for QA | both | Low — limit messaging only |
| 2 | 3 services added, only 1 displays | Fixed via BE #206, FE #332 | One parent `Service` per business with `services[]` child offerings; counts via `summarizeCounts` (`utils/businessListingVisibility.js` L85–124, `services` = offering count). Public DTO exposes `serviceOfferingCount`/`serviceOfferings`. FE renders all offerings (dashboard table, public profile checkboxes); card preview shows first 3 names plus count. | `GET /api/service/my-services`, `GET /api/private/services/list`, public listing DTO | BE: `service-publication.integration.test.js`, `public-listing-dto.test.js`; FE: `serviceOfferings.test.ts` | Implemented / Ready for QA | both | Low |
| 3 | Edit view only shows 1 image | Fixed via FE #331 | BE vendor GET returns full arrays (`galleryImages`, `variants[].images` — `productController.js` L710–758). FE `EditProductModal` loads/edits the full gallery. **However** legacy edit route `partners/[businessid]/inventory/edit/[id]` (`EditProduct.tsx`) still manages only the cover image and remains reachable. | `GET /api/product/:productId`, `PUT /api/product/:productId` | BE: `vendor-listing-ownership.test.js`; FE: `productEditImages.test.ts` | Evidence Needed (QA must confirm which edit surface they used); legacy route tracked as FW-1 | frontend + QA evidence | Medium — wrong edit surface can drop gallery data |
| 4 | Features cannot be edited | Fixed via BE #202 | `features` accepted on create (`lib/service/serviceContract.js` L121–133) and update (`serviceController.js` L786–794, in `updatableFields`); model `Service.features: [String]`. FE `EditServiceForm` sends `features` in `PUT /api/service/:id` payload. **Caveat:** the onboarding create path `POST /api/service/parent` hardcodes `features: []` (`serviceController.js` L154) and the FE onboarding flow (`partners/add-service/hooks/useServiceForm.ts`) never sends features — editing after create is the only way to set them from that flow (FW-9). | `POST /api/service`, `POST /api/service/parent`, `PUT /api/service/:id` | BE: `service-payload-contract.test.js`, `service-publication.integration.test.js`; FE: `services.test.ts` | Implemented / Ready for QA (edit path); parent-create path Regression Risk (FW-9) | both | Low |
| 5 | Service vendor still shows payout/bank setup | Fixed via BE #205, FE #330; policy wording pending sign-off | BE: `PAYOUT_REQUIRED_LISTING_TYPES = ['product']` (`utils/businessListingVisibility.js` L11); publication blockers skip payout for service/food. FE: `requiresPayoutSetup()` true only for product; payout step hidden from stepper for service/food. Direct visit to `/partners/payout-setup` still shows generic copy (FW-4). | `GET /api/connect/:businessId/status`, publication endpoints | BE: `business-storefront-publication.integration.test.js`; FE: `vendorOnboardingGuard.test.ts` | Implemented / Ready for QA; policy wording remains Pending Client Input | both + business decision | Medium — payout gating affects publication |
| 6 | Product description renders raw HTML | Fixed via FE #333 | FE renders plain text through `productDescriptionToPlainText()`; zero `dangerouslySetInnerHTML` in `app/`. BE applies `xss-clean` to body/params at ingress (`app.js` L145–152); no additional strip on read (by design). | Product detail fetch | FE: `productDescriptionText.test.ts`; BE: `payload-safety.test.js` | Implemented / Ready for QA | frontend | Low |
| 7 | Local shipping missing for same-state | Fixed via BE #204, FE #329 | BE returns `pricing.availableDeliverySpeeds` (incl. `local`), per-item `shipping.local`, and `vendorState` on cart items (`cartController.js` L97–200, L505–547). FE shows the local option when items are `localDeliveryEligible` **or** vendor/customer states match. Note: same-state gate is client-side only; BE prices `local` if selected. Doc claim that BE returns `localDeliveryEligible` was inaccurate — corrected. | `GET /api/cart?deliverySpeed=` | BE: `commerce.integration.test.js` L163–217; FE: `cartShipping.test.ts` | Implemented / Ready for QA (Documentation Mismatch corrected; client-side-only gate noted as FW-6) | both | Medium — shipping charge correctness |
| 8 | Cart quantity cannot be reduced | Fixed (prior cart fixes + FE #334) | BE `PUT /api/cart/update/:cartItemId` accepts lower quantities (integration test decreases 3 -> 1); qty 0 rejected ("Quantity must be at least 1"), removal via `DELETE /api/cart/remove/:cartItemId`. FE decrement uses stable `cartItemId`; at qty 1 the minus button removes the line. | `PUT /api/cart/update/:cartItemId`, `DELETE /api/cart/remove/:cartItemId` | BE: `commerce.integration.test.js` L112–160; FE e2e: `cart-checkout.spec.ts` | Implemented / Ready for QA | both | Low |
| 9 | Coupon ignores cart-value minimum | Fixed pending UAT (PR #199) | BE enforces min order ("Minimum order amount is ${minOrderAmount}"), expiry, usage limits in `utils/couponDiscount.js` L25–55; re-validated in cart pricing and at order initiate. FE surfaces backend rejection message and never computes discounts locally. | `POST /api/discounts/validate`, `POST /api/discounts/apply`, `GET /api/cart?couponCode=` | BE: `coupon-discount.test.js`, `coupon-apply-validate.test.js`, `order-initiate-coupon.test.js`; FE e2e: `cart-coupon-totals-evidence.spec.ts` | Implemented / Ready for QA | both | Medium — money math |
| 10 | Cart vs checkout totals differ | Fixed pending UAT (PR #199 + FE #323/#324/#334) | BE recalculates everything server-side at `POST /api/orders/initiate` and rejects tampering via `assertClientTotalsMatch` (tolerance 0.01; "Client total does not match server-calculated total"). FE cart displays `cartPricing.totalAmount` and sends `expectedTotal`. Buy-now flow still does local subtotal/shipping math before initiate (FW-3). | `GET /api/cart`, `POST /api/orders/initiate` | BE: `order-initiate-coupon.test.js` L336–351; FE e2e: `cart-checkout.spec.ts` | Implemented / Ready for QA (buy-now hybrid noted as Regression Risk, FW-3) | both | High if totals wrong at payment |
| 11 | No tracking email after shipment | Evidence Needed (hosted provider) | `PUT /api/orders/ship/:orderId` requires `trackingId` + `trackingUrl`, persists `order.trackingInfo`, sets status `shipped`, sends customer email with tracking link (`orderController.shipOrder` L1216–1272; `utils/orderPhase.js` L295–315). FE customer order list shows "Track order" link when shipped. Hosted SMTP delivery has never been proven. | `PUT /api/orders/ship/:orderId` | BE: `order-lifecycle-emails.test.js` L150–180 | Evidence Needed (hosted email delivery proof) | QA evidence | Medium — customer comms |
| 12 | PDF uploads fail, JPEG works | Fixed; hosted evidence needed | Vendor onboarding allowlist explicitly includes `application/pdf` (`utils/vendorOnboardingUploadMimeAllowlist.js` L1–6), 5 MB cap, extension fallback for generic MIME. Listing gallery presign is images-only **by design**. FE accepts PDF for policy docs and PDF/JPG/PNG/WEBP for evidence uploads. | `GET /api/vendor-onboarding/stage1/upload-url`, `POST /api/vendor-onboarding/stage1/upload-file` | BE: `vendor-onboarding-upload-mime.test.js`; FE: `vendorUploadFiles.test.ts` | Implemented / Ready for QA (hosted S3 evidence requested) | both + QA evidence | Medium — onboarding blocker if broken |
| 13 | Admin cannot filter by status / review profile+badge | Fixed via BE #203, FE #326/#327 | BE supports `draft`, `payment_pending`, `submitted`, `verified`, `rejected` + aliases (`pending`/`under_review` -> `submitted`, `approved` -> `verified`, `all`) with meta `availableStatuses`. Detail returns full application incl. `businessBio`, `businessProfileImage`, `featureBanner`, policy docs, `badge`, checklist. FE select offers all/submitted/verified/rejected/draft/payment_pending; detail shows logo, bio, docs. | `GET /api/vendor-onboarding/pending?status=`, `GET /api/vendor-onboarding/:applicationId` | BE: `vendorOnboardVerifyStage1.pending-applications.test.js`; FE: `vendorOnboardingAdmin.test.ts` | Implemented / Ready for QA | both | Low |
| 14 | Approval/finalize flow broken; no next step after disapproval | Fixed via FE #327 + BE finalize foundation (PR #200) | State machine `draft -> payment_pending -> submitted -> verified|rejected`; finalize accepts `{ decision, rejectionReason, adminNotes, requiredNextAction }` (`finalizeVerification` L922–947); rejected vendors can resubmit (`rejected -> draft -> submitted`). FE finalize modal requires reason + next action on reject; rejected view shows Reason / Vendor Next Action / Admin Notes. | `POST /api/vendor-onboarding/:id/finalize`, `/verify`, `/submit` | BE: `vendor-onboarding-finalize.test.js`, `rejected-application-resubmit.test.js`, `vendor-onboarding.integration.test.js`; FE: `vendorOnboardingAdmin.test.ts` | Implemented / Ready for QA | both | Medium — vendor lifecycle |
| 15 | Restaurant vendor forced into Stripe Connect | Fixed via BE #205, FE #330; policy pending sign-off | Same mechanism as item 5: food listed in non-payout-required types; publication and onboarding do not require Connect for food vendors. Product **checkout** still requires Connect for all vendors (unchanged, by policy); food/service commerce is booking-based with no Connect gate. | Publication endpoints, `POST /api/orders/initiate` (product only) | BE: `business-storefront-publication.integration.test.js`, `order-initiate-connect.test.js`; FE: `vendorOnboardingGuard.test.ts` | Implemented / Ready for QA; Connect policy wording remains Pending Client Input | both + business decision | Medium — payments policy |

Production UAT test steps and per-item QA evidence requests are in `docs/uat/JULY_6_PRODUCTION_UAT_CHECKLIST.md`.

## Phase 5 — Route/API contract alignment

Full table: `docs/audit/JULY_6_CROSS_REPO_ROUTE_CONTRACT_TRACE.md`. Mandated verifications:

| Check | Result |
|---|---|
| `GET /api/featured-products` canonical | Confirmed — `routes/featuredProductRoutes.js` L7, mounted `app.js` L240; FE caller `lib/api/featured-products.ts` L42 |
| `/api/products/featured` not used | Confirmed — zero runtime hits in either repo; only docs, smoke scripts, and guard tests asserting absence |
| Cart update uses stable `cartItemId` | Confirmed — FE `PUT /api/cart/update/:cartItemId`; BE `CartItem.findById` |
| Coupon totals backend-authoritative | Confirmed — FE displays `cartPricing.discount`/`totalAmount` only; BE validates min order/expiry/usage at apply, cart, and order time |
| Order initiate recalculates server-side | Confirmed — DB price resolution, coupon re-evaluation, shipping recompute, `assertClientTotalsMatch` tamper rejection |
| Local shipping fields returned and consumed | Partially — `vendorState`, `shipping.local`, `availableDeliverySpeeds` returned and consumed. `localDeliveryEligible` is consumed by FE if present but **never returned by BE**; doc corrected. Same-state gating is client-side only (FW-6) |
| Admin status filters backend-supported | Confirmed — every FE select value maps to a supported status or alias |
| Finalize sends explicit decision/reason/notes | Confirmed — `{ decision, rejectionReason, requiredNextAction, adminNotes }` |
| Service feature contract matches | Confirmed — `features` in FE payload and BE create/update persistence |
| PDF/JPEG upload contract matches | Confirmed — onboarding allowlist (PDF+images) matches FE accept strings; listing gallery images-only on both sides |
| Tracking response/email metadata exposed safely | Confirmed — `trackingInfo` persisted and returned; email send logged via order lifecycle logging; no secrets in responses |
| Connect messaging does not overpromise | Confirmed — FE hides payout step exactly where BE does not require it (product-only requirement on both sides); generic copy on directly-visited payout page noted (FW-4) |

## Phase 6 — Test coverage map

| # | FE unit | BE unit | BE integration | BE contract | Manual UAT needed | Coverage class |
|---|---|---|---|---|---|---|
| 1 | `listingUploads.test.ts` | `s3-presigned-upload-contract.test.js` | — | — | Yes (limit copy screenshot) | Partially Covered |
| 2 | `serviceOfferings.test.ts` | `service-publication-visibility.test.js` | `service-publication.integration.test.js` | — | Yes | Automated Covered |
| 3 | `productEditImages.test.ts` | `vendor-listing-ownership.test.js` | — | — | Yes (which edit surface) | Partially Covered |
| 4 | `services.test.ts` | `service-payload-contract.test.js` | `service-publication.integration.test.js` | — | Yes | Automated Covered |
| 5 | `vendorOnboardingGuard.test.ts` | — | `business-storefront-publication.integration.test.js` | — | Yes | Automated Covered |
| 6 | `productDescriptionText.test.ts` | `payload-safety.test.js` | — | — | Yes | Automated Covered |
| 7 | `cartShipping.test.ts` | `vendorShipping` via cart tests | `commerce.integration.test.js` | — | Yes (same-state UI) | Partially Covered |
| 8 | e2e `cart-checkout.spec.ts` | — | `commerce.integration.test.js` | — | Yes | Automated Covered |
| 9 | e2e `cart-coupon-totals-evidence.spec.ts` | `coupon-discount.test.js`, `coupon-apply-validate.test.js` | `discount-ownership.integration.test.js` | — | Yes | Automated Covered |
| 10 | e2e cart/checkout specs | `order-initiate-coupon.test.js` | `commerce.integration.test.js` | — | Yes (incl. buy-now) | Partially Covered (buy-now Manual Only) |
| 11 | — | `order-lifecycle-emails.test.js` | — | — | Yes — hosted email proof | Evidence Needed |
| 12 | `vendorUploadFiles.test.ts` | `vendor-onboarding-upload-mime.test.js` | — | — | Yes — hosted S3 proof | Partially Covered |
| 13 | `vendorOnboardingAdmin.test.ts` | `vendorOnboardVerifyStage1.pending-applications.test.js` | `vendor-onboarding.integration.test.js` | — | Yes | Automated Covered |
| 14 | `vendorOnboardingAdmin.test.ts` | `vendor-onboarding-finalize.test.js`, `rejected-application-resubmit.test.js` | `vendor-onboarding.integration.test.js` | — | Yes | Automated Covered |
| 15 | `vendorOnboardingGuard.test.ts` | `order-initiate-connect.test.js` | `business-storefront-publication.integration.test.js`, `connect.integration.test.js` | — | Yes | Automated Covered |

Route invariants (featured products, webhook mount order) are additionally covered by `tests/launch/backend-launch-contract.test.js` (contract suite) and `tests/security/payload-safety.test.js`.

## Phase 7 — Production UAT readiness

- **This is controlled production UAT.** Per `docs/release/STAGING_ENVIRONMENT_AUDIT.md`, no complete isolated staging environment exists; production is the only hosted environment where all 15 items (email delivery, S3 uploads, Stripe flows) can be exercised end to end.
- **Why production**: hosted SMTP, S3 CORS/presign, and Stripe Connect behavior cannot be proven from local runs; items 11 and 12 are explicitly hosted-evidence items.
- **Risks**: real customer/vendor visibility of test data; real Stripe objects; real emails; irreversible order/payment records if testers use live cards.
- **Tester safeguards**: use designated test accounts only; test-mode/low-value transactions only where payment is unavoidable; label all created listings/applications as test data; capture screenshots before and after each step; do not touch real vendor or customer records.
- **Testers must not**: use real payment cards outside sanctioned test flows; modify or delete real vendors' data; approve/reject real vendor applications; change admin categories/CMS content; share URLs of unpublished test listings publicly.
- **Rollback notes**: backend rollback per `docs/release/PRODUCTION_ROLLBACK_RUNBOOK.md` (redeploy previous EB build); frontend rollback via previous Vercel deployment promotion. Both repos' `main` history preserves pre-promotion tips for revert PRs.
- **Approval gates (still open)**: written Lionel technical approval — not on record; written Bryan business approval — not on record.
- **This is not final launch approval.**

## Phase 8 — Documentation corrections made in this pass

1. `docs/architecture/API_CONTRACT_ALIGNMENT_MATRIX.md` — corrected the cart contract rows that claimed the backend exposes `localDeliveryEligible`; backend returns `vendorState` (frontend derives local eligibility client-side).
2. Added a "Conformance audit update (2026-07-07)" banner to the stale/superseded July 6 docs (traceability, integrated verification, tester handoff, readiness summary, post-merge verification, gap audit, route contract audit, launch flow map, GitHub issue plan) pointing at the promoted `main` SHAs and this audit.
3. Created `docs/uat/JULY_6_PRODUCTION_UAT_CHECKLIST.md` (production UAT posture + per-item tester steps and evidence requirements).
4. No "Accepted"/"complete"/"launch-ready" language required replacement — none was found asserting client/UAT approval.

## Code mismatches found (follow-up work orders — NOT fixed in this pass)

| ID | Repo | Finding | Suggested owner |
|---|---|---|---|
| FW-1 | frontend | Legacy product edit route `app/(partner)/partners/[businessid]/inventory/edit/[id]/EditProduct.tsx` manages cover image only while `EditProductModal` handles the full gallery; both are reachable. Likely source of QA item 3. Consolidate or add gallery support. | frontend |
| FW-2 | backend | Cart contract does not emit `localDeliveryEligible`; either add the computed field to `GET /api/cart` items or keep the doc-corrected `vendorState`-only contract permanently. | backend + business decision |
| FW-3 | frontend | Buy-now checkout (`checkout/buy-now/page.tsx`) computes subtotal/shipping locally and applies coupons via `POST /api/discounts/apply` instead of the backend-authoritative cart pricing path; order initiate still protects final totals, but displayed totals can drift. | frontend |
| FW-4 | frontend | `/partners/payout-setup` shows unconditional "Connect your Stripe account to receive payouts." copy when visited directly by service/food vendors, contradicting the optional-Connect policy messaging. | frontend + business decision |
| FW-5 | frontend | Pre-existing lint errors (6 react-hooks errors) in `app/(home)/product/[id]/page.tsx`; unrelated to July 6 fixes; not a blocker for this docs audit. | frontend |
| FW-6 | backend | Local delivery same-state rule is enforced client-side only; `PUT /api/cart` / order initiate will price `deliverySpeed=local` for any state if requested directly. Decide whether server-side gating is required. | backend + business decision |
| FW-7 | backend | `PUT /api/service/:id` assigns `features` raw from the request body without the create-path normalization (`normalizeStringList`); harmless for the FE client but inconsistent. | backend |
| FW-8 | both | `docs/README.md` (both repos) does not index the July 6 doc set; July 6 docs are orphaned from navigation. | docs |
| FW-9 | both | Onboarding service-create path drops features: `POST /api/service/parent` hardcodes `features: []` (`serviceController.js` L154) and the frontend onboarding flow (`app/(home)/partners/add-service/hooks/useServiceForm.ts`) never collects/sends features. The inventory create path (`POST /api/service`) and the edit path both persist features correctly. | both |

## Phase 10 — Verification results (backend `main` `ad9ddd1`)

| Command | Result |
|---|---|
| `npm test` (unit) | PASS — 529 tests, 0 fail |
| `npm run test:integration` | PASS — 74 tests, 0 fail |
| `npm run test:contract` | PASS — 20 tests, 0 fail |
| grep `/api/products/featured` | No runtime hits (docs/scripts/guard tests only) |
| `GET /api/featured-products` registration | Confirmed (`app.js` L240 + `routes/featuredProductRoutes.js` L7) |

No runtime code was changed, no branches merged, and nothing was deployed by this audit.
