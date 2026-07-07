# July 6 Docs-to-Code Conformance Audit (Backend)

Date: July 7, 2026  
Audit branch: `audit/july6-docs-code-conformance`  
Primary evidence SHA: `ad9ddd14c85ac851f9001e5f9952c9b594159d9c` (`origin/main`)  
Candidate SHA (pre-promotion reference): `b838239b481f9f68be6f0c80ac527069a5d78964` (`staging`)  
Paired frontend SHA: `b3a86cb43a8562e30d535ab5f1a58b6b97dca2a7` (`launch/main`)

**This is not final launch approval.** No runtime code changes, merges, or deploys were performed in this audit pass.

---

## 1. Executive Summary

Production promotion **has already occurred** on both repos (backend PR #209, frontend PR #335) despite July 6 release docs stating promotion was blocked pending manual UAT and written approvals.

Automated verification on production `main` passed:

| Command | Result |
| --- | --- |
| `npm test` | 529/529 passed |
| `npm run test:integration` | 74/74 passed |
| `npm run test:contract` | 20/20 passed (canonical `GET /api/featured-products`; no `/api/products/featured`) |

**Conformance summary (15 checklist items):**

| Status | Count |
| --- | --- |
| Implemented / Ready for QA | 9 |
| Evidence Needed | 2 |
| Regression Risk | 1 |
| Code Mismatch | 1 |
| Documentation Mismatch | 1 |
| Pending Client Input | 1 |

P0 commerce fixes (cart quantity, coupon minimum, cart/checkout totals) are implemented and covered by integration tests. Hosted proof is still required for shipment tracking email and PDF/JPEG upload on production infrastructure. Checkout still requires Stripe Connect for **all** listing types while onboarding skips payout setup for service/food vendors — a policy mismatch requiring client decision.

Cross-repo route matrix: [`JULY_6_CROSS_REPO_ROUTE_CONTRACT_TRACE.md`](./JULY_6_CROSS_REPO_ROUTE_CONTRACT_TRACE.md).  
Backend implementation trace: [`JULY_6_BACKEND_IMPLEMENTATION_TRACE.md`](./JULY_6_BACKEND_IMPLEMENTATION_TRACE.md).  
Production UAT checklist: [`../uat/JULY_6_PRODUCTION_UAT_CHECKLIST.md`](../uat/JULY_6_PRODUCTION_UAT_CHECKLIST.md).

---

## 2. Branches and SHAs Audited

| Repo | Role | Branch | SHA | Notes |
| --- | --- | --- | --- | --- |
| mosaic-backend | Production (primary audit) | `main` | `ad9ddd14` | PR #209 merged 2026-07-07 |
| mosaic-backend | Pre-promotion candidate | `staging` | `b838239b` | Ancestor of `main`; 2 commits behind `origin/staging` |
| mosaic-biz-frontend-launch | Production (primary audit) | `main` | `b3a86cb4` | PR #335 merged from `develop` |
| mosaic-biz-frontend-launch | Pre-promotion candidate | `develop` | `8163a3b3` | Ancestor of `main` |

**Candidate vs production delta:** Backend `main` adds merge commit + [`STAGING_ENVIRONMENT_AUDIT.md`](../release/STAGING_ENVIRONMENT_AUDIT.md). No additional runtime code changes between `b838239` and `ad9ddd1`. Frontend `main` adds PR #335 merge only.

---

## 3. Production Promotion Status

| Event | When | Impact on audit |
| --- | --- | --- |
| Backend PR #209 (`staging` → `main`) | 2026-07-07 | July 6 backend fixes are live on production API |
| Frontend PR #335 (`develop` → `main`) | Before audit | July 6 frontend fixes are live on production app |

Prior docs ([`JULY_6_RELEASE_READINESS_SUMMARY.md`](../uat/JULY_6_RELEASE_READINESS_SUMMARY.md), [`JULY_6_POST_MERGE_VERIFICATION.md`](../uat/JULY_6_POST_MERGE_VERIFICATION.md)) stated promotion was **Blocked** pending Bryan written approval and manual UAT evidence. **That gate was not met in documentation before promotion.** QA is now performing **controlled production UAT** on live stacks.

---

## 4. Documentation Files Inspected

| File | Purpose | SHA refs in doc | Freshness |
| --- | --- | --- | --- |
| [`docs/uat/JULY_6_UAT_TRACEABILITY.md`](../uat/JULY_6_UAT_TRACEABILITY.md) | 15-item matrix | `65b89d5` | **Stale SHA** — corrected in this audit |
| [`docs/uat/JULY_6_UAT_TESTER_HANDOFF.md`](../uat/JULY_6_UAT_TESTER_HANDOFF.md) | QA steps | `65b89d5` / `8f000a15` | **Stale SHA** — updated |
| [`docs/uat/JULY_6_RELEASE_READINESS_SUMMARY.md`](../uat/JULY_6_RELEASE_READINESS_SUMMARY.md) | Promotion gate | Pre-promotion | **Conflicting** — said blocked; promotion occurred |
| [`docs/uat/JULY_6_POST_MERGE_VERIFICATION.md`](../uat/JULY_6_POST_MERGE_VERIFICATION.md) | Post-merge tests | `429e4ef4` / `2b1b8fac` | **Stale SHA** — updated |
| [`docs/uat/JULY_6_INTEGRATED_UAT_VERIFICATION.md`](../uat/JULY_6_INTEGRATED_UAT_VERIFICATION.md) | Cross-repo PR map | `65b89d5` | **Stale SHA** — updated |
| [`docs/uat/JULY_6_BACKEND_REGRESSION_CHECKLIST.md`](../uat/JULY_6_BACKEND_REGRESSION_CHECKLIST.md) | Backend regression | Audit-time counts | Current methodology |
| [`docs/uat/JULY_6_GITHUB_ISSUE_PLAN.md`](../uat/JULY_6_GITHUB_ISSUE_PLAN.md) | Issue backlog | N/A | Reference |
| [`docs/architecture/API_CONTRACT_ALIGNMENT_MATRIX.md`](../architecture/API_CONTRACT_ALIGNMENT_MATRIX.md) | Route matrix | Pre-audit branch | Partially stale on Connect checkout |
| [`docs/architecture/JULY_6_UAT_BACKEND_GAP_AUDIT.md`](../architecture/JULY_6_UAT_BACKEND_GAP_AUDIT.md) | Pre-fix gaps | Historical | Superseded by this audit |
| [`docs/architecture/BACKEND_ROUTE_CONTRACT_AUDIT.md`](../architecture/BACKEND_ROUTE_CONTRACT_AUDIT.md) | Route audit | Pre-July-6 | **Conflicting** — superseded pointer added |
| [`docs/release/STAGING_ENVIRONMENT_AUDIT.md`](../release/STAGING_ENVIRONMENT_AUDIT.md) | No true staging | `b838239` / `8163a3b` | Current |
| `docs/AGENT_CONTEXT_INDEX.md` | Agent index | — | **Not present** |

**Incorrect status language corrected:** "Fixed / Ready for Review" normalized to **Implemented / Ready for QA** where automated proof exists. No item marked Accepted, Complete, or Launch-ready.

---

## 5. Runtime Code Areas Inspected

See [`JULY_6_BACKEND_IMPLEMENTATION_TRACE.md`](./JULY_6_BACKEND_IMPLEMENTATION_TRACE.md) for file-level detail. Summary:

- Cart/commerce: `controllers/customer/cartController.js`, `utils/couponDiscount.js`, `controllers/orderController.js`
- Shipping: `utils/vendorShipping.js`, cart pricing enrichment
- Services: `controllers/serviceController.js`, `utils/businessListingVisibility.js`, `lib/listing/publicListingDto.js`
- Connect: `utils/checkoutGuards.js`, `controllers/connectController.js`, `utils/businessListingVisibility.js`
- Admin onboarding: `controllers/admin/vendorOnboardVerifyStage1.js`
- Uploads: `controllers/vendorOnboardingUpload.controller.js`, `utils/vendorOnboardingUploadMimeAllowlist.js`
- Orders/email: `controllers/orderController.js`, `utils/orderLifecycleEmailDelivery.js`
- Route registration: `app.js`, `routes/featuredProductRoutes.js`

---

## 6. July 6 Checklist Conformance Matrix

| # | Expected behavior | Doc claim | Backend evidence | Frontend evidence | Routes/API | Tests | QA evidence needed | Status | Owner | Rollback risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Tier-accurate image limit errors | PR #328 | Plan-driven `galleryImageLimit` in product/service controllers | Dynamic `imageLimit` from subscription; PriceBar/TierCard aligned | Business/subscription fetch; create/update listing | Service publication tests | Upload UI screenshot | **Implemented / Ready for QA** | both | Low |
| 2 | Three service offerings visible | PR #206/#332 | Offering counts in `businessListingVisibility.js`, public listing DTO | `getServiceOfferingSummary()` on cards | Service list/public routes | `marketplace.integration.test.js`, `serviceOfferings.test.ts` | Dashboard + public profile screenshots | **Implemented / Ready for QA** | both | Medium |
| 3 | Edit view shows all images | PR #331 | Gallery arrays on GET/PUT product/service | `normalizeProductEditImages` preserves gallery | `PUT /api/product/:id`, service update | `public-listing-dto.test.js`, `productEditImages.test.ts` | Before/after edit screenshots | **Implemented / Ready for QA** | both | Medium |
| 4 | Features editable/persist | PR #202 | `createService` persists `features`; **`createParentService` hardcodes `features: []`** | Feature array UI on create/edit | `POST/PUT /api/service` | `service-payload-contract.test.js` | Parent-create flow screenshot | **Regression Risk** | backend | Medium |
| 5 | Service vendor not forced payout setup | PR #205/#330 | `PAYOUT_REQUIRED_LISTING_TYPES = ['product']` in visibility | `requiresPayoutSetup()` product-only | Publication/eligibility endpoints | `vendorOnboardingGuard.test.ts` | Final-review screenshot | **Implemented / Ready for QA** (onboarding) | both | Medium |
| 6 | No raw HTML in descriptions | PR #333 | Returns raw description; frontend sanitizes | `productDescriptionToPlainText()` | `GET /api/public/product/:id` | `productDescriptionText.test.ts` | Product detail screenshot | **Implemented / Ready for QA** | frontend | Low |
| 7 | Local shipping same-state | PR #204/#329 | Cart exposes `vendorState`; local speed in pricing | Cart filters `local` by `vendorState` | `GET /api/cart?deliverySpeed=local` | `commerce.integration.test.js`, `cartShipping.test.ts` | Same/different state screenshots | **Implemented / Ready for QA** | both | Medium |
| 8 | Cart qty decrease | PR #199 | `PUT /api/cart/update/:cartItemId` | `updateCartItemQuantityById` | Cart update route | `commerce.integration.test.js` | Cart decrease screenshot | **Implemented / Ready for QA** | both | High |
| 9 | Coupon min cart value | PR #199 | `minOrderAmount` enforced in `couponDiscount.js` | Defers to backend `GET /api/cart?couponCode=` | Discount + cart routes | `coupon-discount.test.js`, order-initiate tests | Below/above minimum screenshots | **Implemented / Ready for QA** | backend | High |
| 10 | Cart = checkout total | PR #199/#334 | Server recalc on `POST /api/orders/initiate` | Backend `totalAmount`; checkout uses PaymentIntent | Order initiate | Integration + e2e evidence spec | Cart/checkout total screenshot | **Implemented / Ready for QA** | both | High |
| 11 | Shipment tracking email | Code fixed | Ship handler + lifecycle email helper | Customer order tracking link | `PUT /api/orders/ship/:orderId` | `order-lifecycle-emails.test.js` | Provider/log summary (no private email) | **Evidence Needed** | backend + QA | Medium |
| 12 | PDF/JPEG upload | Upload fixes | MIME allowlist + PDF alias fallback | `VENDOR_DOCUMENT_ACCEPT`, evidence types | Stage1 upload routes | `vendor-onboarding-upload-mime.test.js` | Hosted upload screenshot (no signed URLs) | **Evidence Needed** | both | Medium |
| 13 | Admin status filters | PR #203/#326 | `APPLICATION_STATUS_FILTERS`, `?status=` query | `listPendingVendorApplications({ status })` | `GET /api/vendor-onboarding/pending` | `pending-applications.test.js` | Admin filter + detail screenshots | **Implemented / Ready for QA** | both | Medium |
| 14 | Approve/reject/finalize flow | PR #200/#327 | Finalize validates decision/reason | Explicit `decision`, `rejectionReason`, `requiredNextAction` | Finalize/verify routes | `vendor-onboarding-finalize.test.js` | Admin/vendor flow screenshots | **Documentation Mismatch** (no separate "request changes" button; reject path used) + **Implemented / Ready for QA** for finalize | both | High |
| 15 | Restaurant/service Connect not compulsory | PR #205/#330 | Onboarding skips payout; **checkout still requires `stripeConnectAccountId`** | Messaging optionality-aware | Connect + order initiate | `order-initiate-connect.test.js` | Policy sign-off + checkout attempt | **Code Mismatch** + **Pending Client Input** | both + business | High |

---

## 7. Route/API Contract Mismatches

| Feature | Mismatch | Severity |
| --- | --- | --- |
| Stripe Connect at checkout | Onboarding/publication treats service/food as payout-optional; `checkoutGuards.js` blocks all checkout without Connect | **Code Mismatch** — WO-1 |
| Service features on parent create | `createParentService` ignores submitted features | **Regression Risk** — WO-2 |
| Request changes UX | Handoff lists distinct "request-changes"; UI uses reject + `requiredNextAction` | **Documentation Mismatch** — WO-3 |
| [`BACKEND_ROUTE_CONTRACT_AUDIT.md`](../architecture/BACKEND_ROUTE_CONTRACT_AUDIT.md) | Still lists local shipping/features as incomplete | **Documentation Mismatch** — superseded |

Full matrix: [`JULY_6_CROSS_REPO_ROUTE_CONTRACT_TRACE.md`](./JULY_6_CROSS_REPO_ROUTE_CONTRACT_TRACE.md).

---

## 8. Documentation Mismatches Corrected

This audit branch updates:

- SHA references to production `main` SHAs
- Status vocabulary to approved terms
- Production promotion reality vs prior "Blocked" language
- Superseded pointers on stale architecture audits

No runtime code was modified.

---

## 9. Code Mismatches (Follow-Up Work Orders)

| ID | Issue | Priority |
| --- | --- | --- |
| WO-1 | Align checkout Connect guard with service/food onboarding optionality | P0 policy |
| WO-2 | Persist features on `createParentService` path | P1 |
| WO-3 | Clarify "request changes" vs reject+`requiredNextAction` | P1 |
| WO-4 | Hosted shipment email provider evidence | P1 QA |
| WO-5 | Hosted S3/CORS PDF upload smoke | P1 QA |
| WO-6 | Reconcile promotion gate docs with PR #209/#335 | Release control |
| WO-7 | Lionel technical + Bryan written approvals before launch sign-off | Business gate |

---

## 10. Test, Build, and Lint Results

**Backend (`ad9ddd14`):**

| Command | Result |
| --- | --- |
| `npm test` | 529/529 pass |
| `npm run test:integration` | 74/74 pass |
| `npm run test:contract` | 20/20 pass |
| `/api/products/featured` grep | Absent from runtime routes; negative guard in contract tests |
| `/api/featured-products` | Registered in `app.js` via `featuredProductRoutes.js` |

**Frontend (`b3a86cb4`):**

| Command | Result |
| --- | --- |
| `npm run build` | Pass |
| `npm run test:unit` | 172/172 pass |
| Focused ESLint (July 6 files) | 0 errors, 2 warnings (exhaustive-deps) |
| Repo-wide `npm run lint` | Unrelated baseline debt (238 errors per prior docs) — not a July 6 blocker |

---

## 11. Evidence Still Needed from QA

All 15 items require safe-account manual proof. Highest priority:

1. Shipment tracking email provider/log evidence (item 11)
2. Hosted PDF/JPEG upload without exposing signed URLs (item 12)
3. Service/food checkout vs Connect policy validation (item 15)
4. Parent-service feature create path if vendors use that flow (item 4)

---

## 12. Recommended Tester Instructions

Use [`JULY_6_PRODUCTION_UAT_CHECKLIST.md`](../uat/JULY_6_PRODUCTION_UAT_CHECKLIST.md) and [`JULY_6_CONTROLLED_PRODUCTION_UAT_PLAN.md`](../release/JULY_6_CONTROLLED_PRODUCTION_UAT_PLAN.md).

- Test on production URLs with dedicated safe UAT accounts only
- Capture redacted screenshots per checklist item
- Do not include passwords, signed S3 URLs, or email contents with PII
- Do not mark any item Accepted without written client/UAT approval
- Escalate item 15 failures immediately — may block service/food paid checkout

---

## 13. Test Coverage Map

| # | Automated | Manual UAT | Classification |
| --- | --- | --- | --- |
| 1 | Partial (plan limits) | Required | Partially Covered |
| 2 | Integration + unit | Required | Partially Covered |
| 3 | DTO + unit tests | Required | Partially Covered |
| 4 | Payload contract (createService only) | Required for parent path | Partially Covered |
| 5 | Guard unit tests | Required | Partially Covered |
| 6 | Unit tests | Required | Partially Covered |
| 7 | Integration + unit | Required | Partially Covered |
| 8 | Integration | Required | Automated Covered + manual |
| 9 | Coupon + integration | Required | Automated Covered + manual |
| 10 | Integration + e2e | Required | Automated Covered + manual |
| 11 | Unit tests only | Provider proof required | Evidence Needed |
| 12 | MIME unit tests | Hosted upload required | Evidence Needed |
| 13 | Integration + unit | Required | Partially Covered |
| 14 | Finalize integration | Required | Partially Covered |
| 15 | Connect block tests | Policy validation required | Partially Covered |

---

## 14. Approval Gates

- **Lionel:** written technical approval — **Pending**
- **Bryan:** written business approval — **Pending**
- **Statement:** This audit is not final launch approval.

---

## 15. Audit Safety Statement

- No runtime code changes were made in this pass
- No merges or deploys were performed
- No secrets, env values, tokens, or signed URLs were committed
- Canonical route `GET /api/featured-products` preserved; `/api/products/featured` not introduced
