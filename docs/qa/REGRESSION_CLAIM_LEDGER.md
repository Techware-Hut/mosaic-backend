# Regression Claim Ledger

Date: 2026-06-24
Repository: `Techware-Hut/mosaic-backend`
Backend branch: `codex/backend-final-preprod-audit`
Starting staging SHA: `28f9be37c6ae168605ad1d978d32fb013ddfe3af`
Frontend reference: `Digital-Builders-757/mosaic-biz-frontend-launch` `develop` SHA `d1e320356ef0cca6ff7456502cffeac4333fab70`

Rule for this ledger: "not tested" is not treated as a failure. A claim is only a current defect when current code or a reproducible route/test check proves it. Live runtime gaps remain open QA work, not automated test failures.

## Classification Summary

| Classification | Count | Meaning |
| --- | ---: | --- |
| Confirmed and fixed | 2 | Current pass or recent integrated work closed the exact issue with tests/evidence |
| Stale/already fixed | 13 | Report no longer matches current staging/frontend code |
| Runtime evidence required | 9 | Code/tests align, but live final-domain proof is still needed |
| Frontend-owned | 2 | Backend route is correct; issue was or is in frontend caller/UX/doc surface |
| Product decision required | 5 | Behavior may be intentional and needs owner decision |
| Partially confirmed | 2 | A mismatch/risk exists, but safe correction requires clearer consumer semantics |
| Not reproduced | 1 | Current source/tests did not reproduce the reported defect |
| Not tested | 4 | Outside this controlled backend pass |

## Ledger

| Report item | Classification | Evidence | Owner/action |
| --- | --- | --- | --- |
| Vendor registration/OTP blocked | Runtime evidence required | Backend OTP tests pass and failure paths are structured; live SMTP/final-domain browser proof not run | QA with fresh vendor account |
| Customer registration/OTP blocked | Runtime evidence required | Same auth/OTP coverage as vendor registration | QA with fresh customer account |
| Registration copy says OTP sent to mobile while backend emails OTP | Frontend-owned | Backend OTP behavior is email-based; frontend copy must remain email-aligned | Keep frontend copy aligned |
| OTP delivery failure creates unsafe/ambiguous state | Stale/already fixed | `tests/auth/otp-email-delivery.test.js` passes for register/resend/login mail failure | No backend change |
| Login response leaks unsafe user fields | Stale/already fixed | Login/session tests cover `toPublicAuthUser` safe serialization | No backend change |
| Auth session check response differs from login user shape | Stale/already fixed | `GET /api/users/auth/check` uses `toPublicAuthUser`; tests pass | No backend change |
| Password reset can leave old sessions valid | Stale/already fixed | Password reset session invalidation tests pass | No backend change |
| Rejected vendor applications cannot be edited as drafts | Stale/already fixed | Rejected application draft tests pass | No backend change |
| Draft save silently submits application | Stale/already fixed | Save draft tests prove draft status remains draft | No backend change |
| Explicit resubmission from rejected does not return to submitted | Stale/already fixed | Rejected resubmit tests pass | No backend change |
| Admin approval does not sync `Business.isApproved=true` | Stale/already fixed | Admin finalize test asserts `isApproved: true` update | No backend change; live admin QA still needed |
| Admin rejection does not sync `Business.isApproved=false` | Stale/already fixed | Admin finalize test asserts `isApproved: false` update | No backend change; live admin QA still needed |
| Public marketplace shows unapproved/inactive businesses | Stale/already fixed | Marketplace eligibility, search, featured, and ranked visibility tests pass | No backend change |
| Decimal128 prices break public DTOs | Stale/already fixed | Public listing DTO tests normalize Decimal128 to finite number or null | No backend change |
| Service badge filters fail because of casing/object mismatch | Stale/already fixed | Public badge filter tests normalize badge case and scope | No backend change |
| Food badge filter overwrites explicit vendor/business context | Stale/already fixed | Food badge tests preserve explicit business context | No backend change |
| Bronze/Silver/Gold/Platinum/Diamond filters behave inconsistently | Stale/already fixed | Public search filter tests cover every tier case-insensitively | No backend change |
| Product deletion route mismatch or unsafe owner behavior | Confirmed and fixed | Backend route is canonical singular `/api/product/delete-product/:productId`; this pass added tests for owner scope and variant soft delete | Test added; no controller change |
| Product delete does not soft-delete variants | Confirmed and fixed | New test asserts `ProductVariant.updateMany({ productId }, { $set: { isDeleted: true } })` on owned delete | Test added; existing behavior protected |
| Service booking posts to missing `/api/bookings/create` | Frontend-owned | Backend registers `/api/bookings/service` and `/api/bookings/service/:serviceId`; active frontend now uses helper for `/api/bookings/service/:serviceId` | No backend change |
| Canonical featured route accidentally changed | Not reproduced | Contract test confirms `GET /api/featured-products`; backend does not register `/api/products/featured` | Keep guard |
| Frontend still calls `/api/products/featured` | Not reproduced | Active frontend app/lib scan found no usage; old docs/mocks mention it as a guard/history | No backend change |
| Product count shows one while no products visible | Runtime evidence required | Public list counts align to filtered query in tests; live data fixture mismatch not reproduced | Live catalog QA |
| Category totals may count listings hidden from public marketplace | Partially confirmed | Category aggregations count published products/services, not proven approved/active business scope | Product/API decision before changing |
| Business `usage.totalProducts`/`usage.totalServices` should drive visible totals | Product decision required | Business usage fields initialize on business sync; listing totals currently come from Product/Variant/Service queries | Decide authoritative metric |
| Food listings over $200 hidden by default | Product decision required | Backend has default food price window and supports `price=all` | Product owner to decide default |
| Available state/country dropdown should show only listing-supported locations | Product decision required | Filtering exists, but no visible-location metadata endpoint is defined | Define endpoint later if desired |
| Stripe Connect should only apply to some verticals | Product decision required | Backend Connect is business ownership-scoped, not vertical-scoped | Product owner decision |
| Stripe Connect onboarding old-domain redirects | Runtime evidence required | URL sanitization tests pass for approved origins; deployed env values must be proved live | Final-domain Connect QA |
| Checkout/payment intent cannot be validated safely in unit tests | Runtime evidence required | Route guards and Connect eligibility tests pass; real payment needs test-mode approval | Payment QA with written approval |
| Cart merge/count unreliable with live browser session | Runtime evidence required | Integration tests cover cart behavior; browser/localStorage/live catalog proof remains | Final-domain QA |
| Admin pending/detail/verify/finalize could not be tested live | Runtime evidence required | Route guards and controller tests pass; destructive live workflow not executed | Dedicated admin QA account |
| Review workflow needs fresh purchase/booking proof | Not tested | Review route tests exist, but live review submission was outside this pass | Later QA |
| AWS S3 upload presigned URLs and object access | Not tested | Upload MIME and route tests exist; live AWS env not touched | Runtime QA |
| Google OAuth final callback | Not tested | OAuth security tests pass; live Google account flow not executed | Runtime QA |
| Stripe webhook delivery to deployed API | Not tested | Webhook signature and raw-body tests pass; live Stripe CLI/dashboard delivery not executed | Runtime QA |

## Current Low-Risk Fix

Only test coverage changed in backend code:

- `tests/vendor/vendor-listing-ownership.test.js` now covers owned product delete, variant soft delete, and cross-vendor rejection.

No production business logic changed in this pass.
