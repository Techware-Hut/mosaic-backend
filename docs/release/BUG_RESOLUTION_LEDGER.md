# Bug Resolution Ledger

Date: 2026-06-24

This ledger summarizes release-rehearsal defect status. It does not replace issue tracker history.

| Item | Status | Evidence | Remaining action |
| --- | --- | --- | --- |
| Old Stripe/Connect/domain redirects | Fixed in code; runtime proof required | Frontend/backend URL helpers prefer apex and allow transition origins | Verify on final deployed env |
| `/api/products/featured` usage | Fixed/stale | Backend route absent; frontend active code uses `/api/featured-products`; tests guard this | Continue to block new usage |
| Food filters missing canonical state/country/badge | Fixed | Frontend unit tests and backend public filter tests pass | Live marketplace QA |
| Auth shell horizontal overflow | Fixed | Frontend visual evidence and screenshot pilot pass | Final mobile smoke |
| OTP delivery unsafe failure | Fixed/stale | Backend OTP tests return safe structured failure | Live SMTP proof |
| Login/session serialization mismatch | Fixed/stale | Frontend/backend auth session tests pass | Final-domain cookie proof |
| Rejected vendor draft/resubmit | Fixed/stale | Backend rejected/resubmit tests pass | Live vendor/admin QA |
| Admin approval Business sync | Fixed/stale | Backend admin finalize tests pass | Live admin QA |
| Product delete route mismatch | Fixed/stale | Frontend uses singular backend route; backend delete tests pass | Live vendor QA |
| Service booking stale route | Fixed/stale | Frontend helper uses `/api/bookings/service/:serviceId`; backend route registered | Live customer booking QA |
| Product count mismatch | Runtime evidence required | Automated count rules pass; live data not tested | QA with known fixtures |
| Category totals visibility semantics | Product decision required | Category totals may not equal public-visible approved/active counts | Bryan decision |
| Food default price ceiling | Product decision required | Backend supports `price=all`; default remains bounded | Bryan decision |
| Sentry event proof | Not tested | Env names documented only | Trigger safe post-cutover event |
| S3 upload proof | Not tested | Upload code/tests exist | Live upload QA |
