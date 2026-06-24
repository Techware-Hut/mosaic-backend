# Fresh Account E2E Plan

Date: 2026-06-24  
Purpose: controlled Mosaic Biz Hub launch-readiness verification with fresh accounts and no secret exposure.

## Safety Rules

- Use dedicated QA accounts only.
- Do not print OTPs, tokens, cookies, Stripe IDs, customer PII, or environment values.
- Do not approve/reject a real vendor.
- Do not perform live charges without written approval.
- Do not bypass OTP, vendor verification, subscriptions, Stripe Connect, or admin approval.
- Stop at payment boundaries unless written approval names the environment and amount.

## Required Environment Record

Record names only, not values:

- frontend tested URL
- backend API URL
- frontend commit SHA
- backend commit SHA or production release identity
- browser/device
- test date/time/timezone
- relevant env var names present
- unavailable env var names, if any

## Read-Only Baseline

| Step | Expected |
| --- | --- |
| `GET /api/health` | 200 and release identity present |
| `GET /api/ready` | 200 and database connected |
| `GET /api/featured-products?page=1&limit=1` | 200 |
| `GET /api/services/list?page=1&limit=1` | 200 |
| `GET /api/food/list?page=1&limit=1&price=all` | 200 |
| Confirm frontend route scan | No `/api/products/featured`; no `/api/bookings/create` |

## Customer Flow

| Stage | Test | Stop condition |
| --- | --- | --- |
| Registration | Register fresh customer from final frontend domain | Stop if OTP email does not arrive; record status only |
| OTP | Verify OTP from inbox without logging the OTP | Stop if session is not established |
| Login/session | Log out, log back in, confirm `/api/users/auth/check` | Stop if cookie/session fails |
| Browse | Products, services, foods, search, filters | Record visible result counts and API status |
| Cart | Add a product from one approved active vendor | Stop if vendor eligibility blocks checkout |
| Checkout | Initiate order in approved test environment only | Stop before payment confirmation unless written approval exists |
| Booking | Book a service or food listing | Stop if route returns auth/role error; do not fabricate booking success |
| Review | Submit review only after an approved purchase/booking test path | Stop if no legitimate reviewed entity exists |

## Business Owner Flow

| Stage | Test | Stop condition |
| --- | --- | --- |
| Registration | Register fresh `business_owner` from final frontend domain | Stop if OTP email does not arrive |
| OTP/login | Verify OTP and confirm authenticated session | Stop if cookie/session fails |
| Stage 1 draft | Save vendor onboarding draft | Stop if validation errors are unexpected |
| Verification payment | Create verification payment in approved test mode only | Stop before payment confirmation unless written approval exists |
| Submit | Submit paid application | Stop if payment is not confirmed |
| Admin review | Admin views pending queue | Stop before approving/rejecting unless QA account is confirmed |
| Admin finalize | Approve or reject only dedicated QA application | Record status changes only |
| Business profile | Complete profile after Stage 1 verified | Stop if protected fields or sync errors appear |
| Listings | Create product, service, and food draft/published examples | Stop if tier limits or publication blockers appear |
| Stripe Connect | Create account link and complete onboarding in test mode only | Stop if Stripe asks for real/live credentials |

## Evidence To Capture

- Browser URL and route.
- HTTP method, URL path, status code.
- Request body shape with PII redacted.
- Response envelope shape with IDs redacted.
- Screenshot only when it does not expose secrets, OTPs, or private data.
- Sentry event IDs if errors occur.
- Whether a failure is reproduced, blocked by environment, or not tested.

## Exit Criteria

Do not call the system launch-ready until all P0 items are proven:

- Fresh customer registration, OTP, login/session.
- Fresh business-owner registration, OTP, onboarding draft, payment-gated submit.
- Admin pending/finalize with a dedicated QA application.
- Public marketplace browse/search/listing details on the final frontend domain.
- Cart and booking paths.
- Payment and Stripe Connect only in an explicitly approved test/live boundary.
- Production frontend and backend release identities are known and match the intended build.
