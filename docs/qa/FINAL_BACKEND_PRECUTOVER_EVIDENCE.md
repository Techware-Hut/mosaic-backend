# Final Backend Pre-Cutover Evidence

Date: 2026-06-24
Repository: `Techware-Hut/mosaic-backend`
Integration branch: `staging`
Feature branch: `codex/backend-final-preprod-audit`
Starting staging SHA: `28f9be37c6ae168605ad1d978d32fb013ddfe3af`
Production PR: `#129` (`staging` -> `main`)
Frontend reference: `Digital-Builders-757/mosaic-biz-frontend-launch` `develop` SHA `d1e320356ef0cca6ff7456502cffeac4333fab70`

This file records the final controlled backend pre-production audit pass. It is not a production deploy, does not modify AWS/DNS/environment values, and does not declare the backend launch-ready.

## Scope

- Reconciled current `staging` after it advanced past prior evidence SHA `00ff81d0377b7ba3ffaf48144464a0adb67aaee6`.
- Reran backend unit and launch-contract baselines on the actual staging head.
- Confirmed Stripe webhook raw-body mounts still occur before `express.json`.
- Audited the launch-critical route contracts listed in the final mission prompt.
- Added a focused regression test proving vendor product delete is owner-scoped and soft-deletes variants.
- Updated final QA docs and regression ledger.

## Baseline Evidence

| Check | Result |
| --- | --- |
| `git fetch --all --prune` / `git pull --ff-only` | Local `staging` fast-forwarded to `28f9be37c6ae168605ad1d978d32fb013ddfe3af` |
| `npm test` on starting staging | Pass: 388/388 |
| `npm run test:contract` on starting staging | Pass: 20/20 |
| Webhook raw-body order | Confirmed by source and tests: `/api/stripe`, `/api/webhooks`, `/api/vendor-onboarding/webhook/payment`, and `/api/subscription/webhook` mount before `express.json` |
| PR #129 state before this pass | Open `staging` -> `main`; REST API reports mergeable true, merge state blocked by branch/check policy until final updates settle |

## Confirmed Current Truth

| Area | Current truth |
| --- | --- |
| Canonical frontend | `https://mosaicbizhub.com` via `utils/frontendUrl.js` default |
| Transition origins | `https://app.mosaicbizhub.com` and `https://mosaic-biz-frontend-launch.vercel.app` remain approved |
| API host | `https://api.mosaicbizhub.com` remains backend/API target |
| Featured products | `GET /api/featured-products` is registered; `/api/products/featured` is absent |
| CORS | `utils/corsOrigins.js` filters wildcard entries and supports credentialed allowed origins only |
| Cookies | Production default domain is `.mosaicbizhub.com`; invalid explicit `COOKIE_DOMAIN` values fall back safely |
| Redirect sanitization | `utils/frontendUrl.js` rejects API host, `www`, and arbitrary frontend redirects |
| Stripe Connect return URLs | `lib/connect/connectUrls.js` and related tests sanitize full URL overrides back to approved frontend origins |
| Active frontend callers | Active app/lib code has no `/api/products/featured`, no `/api/bookings/create`, and no `/api/stripe/account-session` calls; one route-contract comment mentions `/api/stripe/account-session` as intentionally 404 |

## Safe Correction From This Pass

| File | Change |
| --- | --- |
| `tests/vendor/vendor-listing-ownership.test.js` | Added regression tests for `deleteProduct`: owner can soft-delete product and variants; another vendor receives 403 and variants remain untouched |

No payment, checkout, subscription, Connect, payout, webhook, auth architecture, database migration, AWS, DNS, or environment behavior was changed.

## Product Count Investigation

| Consumer | Current authoritative source | Status |
| --- | --- | --- |
| Vendor private inventory products | `controllers/privateListing.js` groups private product variants into products and returns `total`, `totalVariants`, and `sellableCount` for authenticated owner/business scope | Current behavior documented; no safe correction made |
| Vendor private services | `controllers/privateListing.js` uses `Service.countDocuments(filters)` plus published/unpublished counts under authenticated owner/business scope | Current behavior documented; no safe correction made |
| Public marketplace products/services/food | `controllers/publicListing.js` counts the exact public list filters after approved/active business scope, badge scope, location, category, and price rules | Verified by marketplace tests; no correction needed |
| Featured products | `controllers/featuredProducts.controller.js` counts featured, published, non-deleted products intersected with approved/active businesses | Verified by featured-products tests |
| Category totals | `controllers/categoryController.js` aggregates published product/service counts by category; this is not proven to apply approved/active business visibility | Runtime/product question remains; no correction made because consumer semantics are unclear |
| Subscription quotas | `utils/listingTierLimits.js` counts non-deleted product plus variant entries by business | Verified by `tests/vendor/listing-tier-limits.test.js` |
| Business usage fields | `utils/syncBusinessFromOnboarding.js` initializes `usage.totalProducts` and `usage.totalServices` on new Business records; no current route in this pass proved these fields are authoritative for listing totals | Runtime/product question remains |

## Regression Concern Verification

| Concern | Evidence |
| --- | --- |
| OTP registration response refers to email | Covered by auth OTP tests and docs; live SMTP still requires runtime smoke |
| OTP delivery failure is safe and structured | `tests/auth/otp-email-delivery.test.js` passes |
| Login/session-check safe serialization | `tests/auth/vendor-login-session.test.js` and `tests/auth/auth-check-payload.test.js` pass |
| Rejected applications can be edited as drafts | `tests/vendor/rejected-application-resubmit.test.js` passes |
| Explicit resubmission changes to submitted | Same rejected/resubmit tests pass |
| Draft save does not silently submit | Same rejected/resubmit tests pass |
| Admin approval syncs `Business.isApproved=true` | `tests/admin/vendor-onboarding-finalize.test.js` passes |
| Rejection syncs `Business.isApproved=false` | Same admin finalize tests pass |
| Marketplace requires active and approved businesses | `tests/marketplace/business-eligibility.test.js`, public search, featured, ranked, badge tests pass |
| Decimal128 public prices serialize safely | `tests/marketplace/public-listing-dto.test.js` passes |
| Service/food badge filters preserve business context | `tests/marketplace/public-listing-badge-filters.test.js` passes |
| Bronze/Silver/Gold/Platinum/Diamond filters normalize consistently | `tests/marketplace/public-search-filters.test.js` and badge tests pass |
| Product deletion owner scope and variant soft delete | New targeted tests pass |
| Service booking route registered/protected | `tests/launch/backend-launch-contract.test.js` and frontend caller alignment pass |
| Canonical featured route unchanged | `tests/launch/backend-launch-contract.test.js` passes |

## Remaining Runtime Gates

- Fresh customer and vendor registration with real OTP email delivery.
- Login/session/logout cookies on `https://mosaicbizhub.com` against `https://api.mosaicbizhub.com`.
- Password reset email delivery and final-domain reset flow.
- Vendor onboarding with real upload URLs, verification payment, draft/save/submit, and admin review.
- Stripe Connect account link/status against real test-mode connected accounts.
- Checkout/order/payment intent with approved active connected vendors, run only with written payment-test approval.
- Cart merge/count persistence with real account and live catalog data.
- Category total semantics versus approved/active marketplace visibility.
- Production health/ready proving production is running the intended promoted commit.

## Rollback

If the eventual `staging` -> `main` promotion causes a production issue, revert the promotion merge or redeploy the prior known-good `main` commit. Use the route matrix, security checklist, and runtime gaps docs from this pass to isolate whether the issue is backend code, frontend caller drift, environment configuration, or live data.
