# Regression Claim Ledger

Date: 2026-06-24  
Backend integration SHA: `88ed0781707df4a54f78a210218001b46b3d20cf`  
Frontend integration SHA referenced: `5d35b4ddd3dec596bec61b686b5b92f895417e6e`

Input documents reviewed from `C:\Users\young\Downloads`:

- `TEST RESULTS 24-06.docx`
- `MBH Technical Regression Analysis (1).docx`
- `PROJECT ALIGNMENT DOCUMENT.docx`
- `BACKEND UPDATE IMPACT TO FRONTEND.docx`

Rule for this ledger: a "could not be tested" note is not treated as a failure. A claim is only a current defect when current code or a reproducible route check proves it.

## Summary

| Bucket | Count | Meaning |
| --- | ---: | --- |
| Fixed or stale in current code | 11 | Report statement no longer matches current `staging`/`develop` code |
| Aligned but runtime evidence required | 7 | Code and tests align, but fresh account/live browser proof is still needed |
| Product decision required | 3 | Current behavior may be intentional and needs owner decision |
| Fixed in this pass | 1 | Additional small frontend caller mismatch fixed |

## Claim Ledger

| Source claim | Evidence/tests/repro | Status | Owning repo | Action |
| --- | --- | --- | --- | --- |
| Vendor registration/OTP blocked; copy says OTP sent to mobile while backend emails OTP | `controllers/userController.js` and OTP tests return delivery failure when email send fails; user-facing flow is email OTP | `STALE_ALREADY_FIXED`; live SMTP evidence still required | Backend + frontend | Test fresh vendor account on final domain |
| Customer registration/OTP blocked | Same OTP controller/test evidence as vendor registration | `STALE_ALREADY_FIXED`; runtime evidence required | Backend + frontend | Test fresh customer account on final domain |
| DTO contract inconsistencies across products/services/foods/auth | Backend DTO layer is intentional; frontend has Decimal128/price and business object fallback handling | `DOCUMENTATION_DRIFT` with runtime evidence required | Both | Continue tolerant frontend parsing; do not revert DTO layer |
| Vendor onboarding rejected/draft status flow regressed | Backend tests cover rejected save staying draft and explicit resubmission | `STALE_ALREADY_FIXED` | Backend | No code change |
| Rejected applications cannot be resubmitted | Backend tests cover rejected -> submitted on explicit submit | `STALE_ALREADY_FIXED` | Backend | No code change |
| Admin approval does not sync marketplace visibility | Backend tests cover `isApproved` sync; public eligibility still requires active business | `PARTIAL_RUNTIME_EVIDENCE_REQUIRED` | Backend | Test fresh admin approve path; product decision for auto-activation if needed |
| Location search filtering ignores state/country | Public search filter tests cover state/country/business scope; frontend sends `state` | `STALE_ALREADY_FIXED` for filtering | Both | Product decision still needed for dynamic available-state dropdown |
| Location selector displays all states, not only listing-supported states | No current endpoint contract found for available listing states | `PRODUCT_DECISION_REQUIRED` | Both | Define and build `GET /api/marketplace/locations` or equivalent later |
| Service badge filter fails due casing/object mismatch | Backend badge intersection tests pass; frontend sends lower-case values | `STALE_ALREADY_FIXED` | Both | No code change |
| Food badge filter overwrites vendor context | Backend tests cover explicit vendor context preservation | `STALE_ALREADY_FIXED` | Backend | No code change |
| Food listings over $200 hidden by default | Backend retains default price window and supports `price=all` opt-out | `PRODUCT_DECISION_REQUIRED` | Backend/product | Decide default food price behavior |
| Product count shows one but no products visible | Frontend public product count uses API `total`; live data still needs QA | `RUNTIME_EVIDENCE_REQUIRED` | Both | Test with known product fixtures after deploy |
| Product delete removed or route mismatch `/api/products` vs `/api/product` | Backend canonical vendor route is `DELETE /api/product/delete-product/:productId`; frontend product delete uses same route with credentials | `STALE_ALREADY_FIXED` | Both | No code change |
| Service delete route missing | Backend canonical route is `DELETE /api/service/delete-service/:id`; frontend service delete uses same route | `ALIGNED` | Both | No code change |
| Legacy service booking posts to missing route | Current frontend had `POST /api/bookings/create`; backend only registers `/api/bookings/service` and `/api/bookings/service/:serviceId` | `FIXED_THIS_PASS` | Frontend | Frontend now uses `createServiceBooking` and `POST /api/bookings/service/:serviceId` |
| Stripe Connect appears for services/foods where it was not originally required | Backend Connect validates ownership, not listing type; no approved route contract restricting vendor types found | `PRODUCT_DECISION_REQUIRED` | Product + backend/frontend | Decide whether payout connection is universal or vertical-scoped |
| Login response missing mobile/isOtpVerified metadata | Backend auth serializer tests cover safe canonical user fields including OTP metadata | `STALE_ALREADY_FIXED` | Backend | No code change |
| Vendor journey could not be validated with provided account | Test-results doc says provided account was already verified/approved/subscribed | `RUNTIME_EVIDENCE_REQUIRED` | Both | Use fresh dedicated QA accounts |
| Cart/checkout/payment could not be tested | Route contracts align and tests guard order initiation auth/role; payment not executed here | `RUNTIME_EVIDENCE_REQUIRED` | Both | Execute only with written payment approval |
| Review is working as intended | Review routes exist for product/service/food; current pass did not submit live reviews | `RUNTIME_EVIDENCE_REQUIRED` | Both | Test fresh customer review after purchase/booking decision |
| Project alignment/process concerns | Document is about change control and ownership, not a concrete code defect | `PROCESS_INPUT` | Project | Keep PR-based evidence workflow |

## Current Safe Fix From This Pass

The only additional code fix made was frontend-owned:

- `app/(home)/service/[slug]/page.tsx` now calls the registered service booking route through `createServiceBooking`.
- `lib/api/serviceBookings.ts` encodes service IDs in the path.
- `lib/api/serviceBookings.test.ts` protects the route, credentials, body shape, and 401 messaging.

No backend code changes were required in this pass.
