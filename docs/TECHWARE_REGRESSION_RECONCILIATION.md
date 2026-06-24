# Techware Regression Reconciliation

Date: 2026-06-24

Repository: `Techware-Hut/mosaic-backend`

Input report: `MBH Technical Regression Analysis.docx`

This document reconciles external launch-regression claims against the current backend code. The report is not treated as source of truth. Only currently proven, low-risk marketplace badge/listing defects are in scope for the paired code change.

## Repository Truth

| Item | Evidence |
| --- | --- |
| Working branch | `fix/backend-launch-regression-recovery` |
| Branch base | `origin/staging` |
| Current branch SHA before edits | `c00b9fc8697c104851c4027d92540aa7a5c92e0f` |
| `origin/main` SHA | `779b6945737b55d24f2e548300818d713570480a` |
| `origin/staging` SHA | `c00b9fc8697c104851c4027d92540aa7a5c92e0f` |
| Working tree before edits | Clean |
| Open PRs affecting staging/main | `#131 fix/backend-marketplace-badge-filter-regressions -> staging`; `#130 fix/backend-root-domain-canonicalization -> staging`; `#129 staging -> main` |
| Production health build identity | `release.commit=cf454ed`, `deploymentVersion=mosaic-cf454edb28905a1b54963ee71da819f40a6ade68` from `GET /api/health`, `GET /api/ready`, `GET /api/build-info` |
| Production matches main? | Not confirmed. Production commit `cf454ed` differs from `origin/main` `779b6945737b55d24f2e548300818d713570480a`. |

History checks run before code edits:

- `git fetch --all --prune`
- `git status`
- `git branch --show-current`
- `git log --oneline --decorate --graph --all -n 100`
- `git diff --stat origin/main...origin/staging`
- `git log --oneline origin/main..origin/staging`

`origin/main..origin/staging` currently contains the domain/connect release work from PRs `#124`, `#128`, and staging sync commit `c00b9fc`. This branch is based on `origin/staging` and does not target `main`.

## Claim Classification Table

| Report issue | Normalized claim | Classification | Current evidence | Route/contract | Tests/evidence | Final disposition |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Vendor registration OTP copy says mobile and failed email delivery returns false success. | STALE_ALREADY_FIXED | `controllers/userController.js:79-94`, `96-145` return `502 OTP_DELIVERY_FAILED` on send failure and success copy says email. | `POST /api/user/register` returns `201` only after OTP email send succeeds. | `tests/auth/otp-email-delivery.test.js` asserts email copy and delivery failure behavior. | No auth change. |
| 2 | Public DTO contracts leak inconsistent BSON Decimal128 or omit safe fields. | STALE_ALREADY_FIXED | `lib/listing/publicListingDto.js:42-50`, `245-305`; public listing controllers use shared DTO/card serializers. | Public product/service/food cards return finite numeric price or safe `null`. | `tests/marketplace/public-listing-dto.test.js`; this PR adds exact `{ "$numberDecimal": "15.00" }` coverage. | No DTO rewrite. |
| 3 | Customer registration OTP flow is broken. | DUPLICATE_FINDING | Same auth code path as issue 1. | Same as issue 1. | Same as issue 1. | Counted as duplicate OTP claim. |
| 4 | Rejected vendor save flow moves applications incorrectly or blocks resubmit. | STALE_ALREADY_FIXED | `controllers/vendorOnboarding.controller.js:58-170`, `1006-1080`. Save draft moves rejected to `draft`; explicit submit allows `rejected -> submitted`. | `POST /api/vendor-onboarding/draft`; `POST /api/vendor-onboarding/submit`. | `tests/vendor/rejected-application-resubmit.test.js`; `docs/VENDOR_LIFECYCLE.md`. | No onboarding change. |
| 5 | Admin approval does not sync marketplace visibility. | PARTIALLY_CONFIRMED | `controllers/admin/vendorOnboardVerifyStage1.js:27-45`, `585-599` sync `Business.isApproved`. `lib/marketplace/businessEligibility.js:1-21` also requires `isActive`. | Public marketplace filters require approved and active businesses. | `tests/admin/vendor-onboarding-finalize.test.js:113-149`. | `isApproved` stale; automatic `isActive` reactivation is product/lifecycle decision. |
| 6 | Location search ignores state/country. | NOT_REPRODUCED | `lib/listing/publicSearchFilters.js:51-73`, `216-250`, `298-350`, `419-465`; services include business/vendor location scope. Food/product apply listing `address.city/state/country` and business scope separately. | `GET /api/services/list`, `/api/food/list`, `/api/products/list`, `/api/public/search`. | `tests/marketplace/public-search-filters.test.js` covers city/state; this PR adds country and explicit businessId intersection checks. | No location code change. Clarify intended location source when frontend QA tests filters. |
| 7 | Service badge filter fails due casing/object filter and missing Bronze. | CONFIRMED_CURRENT_DEFECT | Branch-base service badge code had no `Bronze` normalization and compared object `businessId` filters as strings. `Business.badge` enum includes `Bronze` at `models/Business.js:170-173`. This PR fixes with `lib/listing/publicSearchFilters.js:14-20`, `503-525` and `controllers/publicListing.js:220-222`. | `GET /api/services/list?badge=...` must preserve approved/active business scope and explicit `businessId`. | `tests/marketplace/public-listing-badge-filters.test.js`. | Fixed by shared badge normalization/intersection helper. |
| 8 | Food listing has default price cap and badge overwrites vendor context. | PARTIALLY_CONFIRMED | `controllers/publicListing.js:593-604` default `$0-$200`, `price=all` opt-out. Branch-base food badge code overwrote existing `filters.businessId`; this PR fixes with `controllers/publicListing.js:607-609`. | `GET /api/food/list`. | `tests/marketplace/public-listing-badge-filters.test.js`. | Badge overwrite fixed. Price cap classified product decision, unchanged. |
| 9 | Product count/listing count mismatch due soft deletes or stale counters. | RUNTIME_EVIDENCE_REQUIRED | Public/admin/category counts use `Product.countDocuments` or aggregation with `isDeleted:false`. `Business.usage.totalProducts` exists in `models/Business.js:94-105`, `274-303`, but no current mutation path was proven in this pass. | Product browse/category/admin count routes. | Static evidence only. | No counter mutation. Requires separate consumer/source-of-truth decision and reconciliation tests if needed. |
| 10 | Product delete route is misspelled as `/api/product` vs expected `/api/products`. | STALE_ALREADY_FIXED | `app.js:158` mounts `routes/productRoutes.js` at `/api/product`; `routes/productRoutes.js:127-135` registers `DELETE /delete-product/:productId`. | Canonical vendor CRUD route is `DELETE /api/product/delete-product/:productId`. | Frontend callers inspected in `mosaic-biz-frontend-launch` call `/api/product/delete-product/:id`. Docs list singular product CRUD. | No alias added. |
| 11 | Stripe Connect should restrict vendor types. | PRODUCT_DECISION_REQUIRED | `controllers/connectController.js:25-70` owner check and account-link creation; no listing-type eligibility rule in approved backend contract found during this pass. | `POST /api/connect/:businessId/account-link`. | Existing connect contract/integration tests only verify account-link/status behavior. | Out of scope by instruction. No Stripe changes. |
| 12 | Login and auth-check response shapes differ and omit `mobile`/`isOtpVerified`. | STALE_ALREADY_FIXED | `utils/toPublicAuthUser.js:5-14`; `routes/userRoutes.js:55-57`, `121-122`; `controllers/userController.js:434-439`. | Login and auth-check use same safe serializer. | `tests/auth/auth-check-payload.test.js`; `tests/auth/vendor-login-session.test.js`. | No auth change. |
| 13 | Vendor journey testing limitations prove production breakage. | NOT_REPRODUCED | Testing limitations are not defects without failing current route evidence. | N/A. | Test matrix documents remaining live/E2E gaps. | Track as QA coverage, not backend fix. |
| 14 | Marketplace discovery umbrella regression. | DUPLICATE_FINDING | Decomposes into location, badge, DTO, count, booking/checkout claims. | Multiple public routes. | See rows 6-9 and Stripe/payment rows. | Duplicates handled by underlying claims. |
| 15 | Decimal128 pricing serialization failure. | STALE_ALREADY_FIXED | Shared `normalizePrice` handles `$numberDecimal`. | Public listing cards/details. | `tests/marketplace/public-listing-dto.test.js`. | Add exact 15.00 regression assertion only. |
| 16 | Service location filtering failure. | DUPLICATE_FINDING | Same as issue 6. | `GET /api/services/list`. | Public search filter tests. | No separate defect. |
| 17 | Badge casing mismatch. | CONFIRMED_CURRENT_DEFECT | Branch-base maps normalized Silver/Gold/Platinum/Diamond but omitted Bronze; service/product compared object filters as strings; food overwrote filters. Fixed in `lib/listing/publicSearchFilters.js:14-20`, `503-525`. | Public service/food/product list badge filters. | `tests/marketplace/public-listing-badge-filters.test.js`; `tests/marketplace/public-search-filters.test.js`. | Fixed in shared helper. |
| 18 | Food absent price filter should not cap at `$0-$200`. | PRODUCT_DECISION_REQUIRED | Current code intentionally keeps default MVP window and `price=all` opt-out at `controllers/publicListing.js:594-604`. | `GET /api/food/list`. | Static code evidence. | No change until product decides default behavior. |
| 19 | Food badge filter overwrites vendor context. | CONFIRMED_CURRENT_DEFECT | Branch-base food badge code replaced `filters.businessId` with badge IDs. Current code calls `applyBadgeBusinessIdFilter` at `controllers/publicListing.js:607-609`. | `GET /api/food/list?businessId=...&badge=...`. | New badge test proves explicit matching vendor is preserved and nonmatching vendor is empty. | Fixed. |
| 20 | OTP delivery failure. | DUPLICATE_FINDING | Same as issue 1. | Auth registration/resend/login. | OTP tests. | No separate defect. |
| 21 | Delete product route mismatch. | DUPLICATE_FINDING | Same as issue 10. | `DELETE /api/product/delete-product/:productId`. | Frontend caller inspected. | No separate defect. |
| 22 | Product counter synchronization failure. | RUNTIME_EVIDENCE_REQUIRED | `Business.usage.totalProducts` exists, but current public/admin/category counts do not appear to rely on it. | Subscription quota methods may read counters. | Static evidence only. | Separate focused audit if quota behavior fails. |
| 23 | Draft save auto-submits rejected applications. | STALE_ALREADY_FIXED | Current `saveDraft` explicitly sets rejected to `draft` only. | `POST /api/vendor-onboarding/draft`. | Rejected resubmit tests. | No change. |
| 24 | Rejected applications cannot be resubmitted. | STALE_ALREADY_FIXED | `submitForReview` permits `rejected`. | `POST /api/vendor-onboarding/submit`. | Rejected resubmit tests. | No change. |
| 25 | Admin approval sync failure. | PARTIALLY_CONFIRMED | `isApproved` sync exists; `isActive` remains separate. | Admin finalization and public marketplace eligibility. | Finalization and eligibility tests. | No change until lifecycle rule approved. |
| 26 | Missing user metadata in login response. | STALE_ALREADY_FIXED | Shared serializer returns `mobile` and `isOtpVerified`. | `POST /api/user/login`, `GET /api/user/auth/check`. | Auth payload tests. | No change. |
| 27 | Backend canonical frontend domain still points to `app.mosaicbizhub.com` after apex decision. | CONFIRMED_CURRENT_DEFECT | Current staging still has `utils/frontendUrl.js:1-4`, `utils/corsOrigins.js:1-4`, `tests/url/frontend-url.test.js:21-35`, and `docs/DOMAIN_MIGRATION_URL_INVENTORY.md:9-21` treating app as canonical and apex as disallowed/community. | Generated frontend URLs and default credentialed CORS origins. | Open PR `#130 fix/backend-root-domain-canonicalization -> staging` isolates this fix. Not bundled here to keep badge/listing recovery focused. | Separate P7 domain PR required before staging promotion. |

## Contradictions In The Report

- The report claims rejected draft edits move applications to `draft`, while another root-cause claim says draft save auto-submits rejected applications to `submitted`. Current code and tests prove the two-step flow: save/edit -> `draft`; explicit submit -> `submitted`.
- The report claims rejected applications cannot be resubmitted, while also describing a flow where rejected applications re-enter review. Current code allows explicit resubmission from `rejected`.
- The report claims OTP registration returns a false `201` success on email failure and says mobile; current code returns `502 OTP_DELIVERY_FAILED` and success copy says email.
- The report claims login omits `mobile` and `isOtpVerified`; current login and auth-check both use `toPublicAuthUser`.
- The report claims Decimal128 leaks through public DTOs; current public listing DTO normalizes `$numberDecimal`.

## Confirmed Fix Scope

Only these current defects are included in this PR:

- Add `Bronze` to public badge normalization where `Business.badge` already supports it.
- Intersect badge-matching business IDs with the existing `businessId` filter.
- Preserve explicit vendor/business filters, including vendor-menu context.
- Preserve approved/active marketplace eligibility through `publicMarketplaceBusinessFilter`.
- Apply the same shared helper to public service, food, and product list badge filters because all three had the same badge normalization/intersection family.
- Ensure service, food, and product `countDocuments` receive the same final filter as the returned rows.

Out of scope:

- Auth/OTP changes.
- Rejected onboarding state changes.
- Product counter mutations.
- Product route aliases.
- Food default price behavior.
- Stripe Connect/payment/subscription/webhook changes.
- Apex/root domain code changes already isolated in PR `#130`.
- Main branch merge or production deploy.

## Ordered Queue Evidence

| Queue item | Result | Evidence |
| --- | --- | --- |
| Marketplace badge filters | FIXED_IN_THIS_SESSION | Shared helper in `lib/listing/publicSearchFilters.js:14-20`, `475-525`; controller calls in `controllers/publicListing.js:220-222`, `607-609`, `1045-1047`; tests in `tests/marketplace/public-listing-badge-filters.test.js:205-302` and `tests/marketplace/public-search-filters.test.js:154-159`. |
| Public listing DTO Decimal128 proof | STALE_ALREADY_FIXED | `lib/listing/publicListingDto.js:42-50` normalizes `$numberDecimal`; exact `{ "$numberDecimal": "15.00" }` proof in `tests/marketplace/public-listing-dto.test.js:49-53`. Public product/service/food/search/featured/ranked routes call `toPublicListingCard` or `toPublicListingDetail`. |
| Location filtering contract | NOT_REPRODUCED | Services use approved/active business and vendor location scope through `resolveBusinessIdsByLocation`; product/food list filters use listing `address.city/state/country` plus approved/active business scope. Covered by `tests/marketplace/public-search-filters.test.js`. No geospatial radius behavior added. |
| Product counts and deletion | RUNTIME_EVIDENCE_REQUIRED | Product delete route is registered at `routes/productRoutes.js:127-135` and soft-deletes product plus variants in `controllers/productController.js:926-955`. Public/admin/category counts use `Product.countDocuments` or aggregation with `isDeleted:false`; quota usage is documented and tested in `utils/listingTierLimits.js:6-17`, `tests/vendor/listing-tier-limits.test.js:10-24`. No wrong consumer result was reproduced. |
| Stale auth/onboarding claims | STALE_ALREADY_FIXED | OTP delivery tests, auth-check payload tests, rejected-resubmit tests, vendor finalize tests, and marketplace eligibility tests cover these without backend behavior changes. |
| Food price ceiling | PRODUCT_DECISION_REQUIRED | `controllers/publicListing.js:593-604` keeps default `$0-$200`; `price=all` explicitly opts out. No approved source found proving no maximum is intended. |
| Canonical domain audit | CONFIRMED_CURRENT_DEFECT, SEPARATE_PR | Apex is now contractually canonical, but staging still defaults to app. PR `#130` contains the isolated root-domain correction; this branch does not change CORS/cookie/domain behavior. |

## Runtime Smoke Evidence

Read-only production checks were run against `https://api.mosaicbizhub.com` after local tests:

| Probe | Result |
| --- | --- |
| `GET /api/health` | `200` |
| `GET /api/ready` | `200` |
| `GET /api/featured-products?page=1&limit=1` | `200`, `productsLength=0` |
| `GET /api/services/list?badge=bronze&page=1&limit=1` | `200`, count `0` |
| `GET /api/services/list?badge=silver&page=1&limit=1` | `200`, count `0` |
| `GET /api/food/list?badge=bronze&page=1&limit=1&price=all` | `200`, count `0` |
| `GET /api/food/list?badge=silver&page=1&limit=1&price=all` | `200`, count `0` |
| `GET /api/services/list?businessId=6a3918d47788a4bcead90dc3&badge=silver&page=1&limit=1` | `200`, count `1` |
| Food explicit `businessId+badge` | Skipped: no public food listing with both businessId and badge found on first page. |
