# Launch Authorization and Integration Evidence - 2026-06-28

Related issues:

- #155 Add route authorization matrix and negative-access contract tests
- #151 Add isolated integration tests for auth, onboarding, orders, and admin routes

## Summary

This pass adds one focused integration file that proves representative launch-critical route boundaries without live Stripe, email, S3, OAuth, or production data. It also fixes one ownership gap found by that test: `GET /api/connect/:businessId/status` now rejects vendors who request another vendor's business.

New test file:

- `tests/integration/launch-access-contract.integration.test.js`

Code change:

- `controllers/connectController.js` now applies the same business-owner check to Connect status that was already present on Connect account-link creation.

Existing supporting evidence:

- `docs/qa/FINAL_ROUTE_CONTRACT_MATRIX.md`
- `docs/ADMIN_AUTHORIZATION_MATRIX.md`
- `tests/integration/auth.integration.test.js`
- `tests/integration/roles.integration.test.js`
- `tests/integration/vendor-onboarding.integration.test.js`
- `tests/integration/commerce.integration.test.js`
- `tests/integration/connect.integration.test.js`
- `tests/integration/discount-ownership.integration.test.js`

## Route Authorization Matrix Delta

| Surface | Public/role expectation | Negative proof | Positive or supporting proof |
| --- | --- | --- | --- |
| Public marketplace | `GET /api/featured-products` is public; deprecated `/api/products/featured` is absent | New launch access test asserts deprecated alias returns 404 | Existing marketplace/featured product tests |
| Session auth | `/api/users/auth/check` requires auth | New launch access test asserts 401 unauthenticated | `tests/integration/auth.integration.test.js` covers login, auth/check, logout |
| Vendor business | `/api/business/my` requires `business_owner` | New launch access test asserts unauth 401 and customer 403 | `roles.integration.test.js` covers owner access |
| Vendor onboarding | Draft and submit require authenticated vendor | New launch access test asserts unauthenticated draft/submit 401 | `vendor-onboarding.integration.test.js` covers draft save/load, submit, admin finalize |
| Checkout/order initiation | `POST /api/orders/initiate` requires customer | New launch access test asserts unauth 401 and vendor 403 | `commerce.integration.test.js` covers customer empty-cart rejection and vendor denial |
| Vendor orders | `/api/orders/vendor` requires `business_owner` | New launch access test asserts unauth 401 and customer 403 | `commerce.integration.test.js` covers vendor endpoint access |
| Stripe Connect status | Requires `business_owner` and owned business | New launch access test asserts unauth 401 and cross-vendor 403 | `connect.integration.test.js` covers owner account-link/status contracts |
| Admin audit events | `/admin/api/audit-events` requires admin | New launch access test asserts unauth 401 and vendor 403 | New launch access test seeds a safe audit event and confirms admin read |
| Admin orders/users | Admin only | Existing role tests assert vendor/customer 403 | Existing role tests assert admin 200 |
| Discount ownership | Owner-scoped vendor resource | Existing discount ownership test asserts cross-vendor 404 and unauth 401 | Existing discount ownership test asserts owner read/update/delete |

## Integration Scope Coverage

| Launch-critical area | Positive path | Negative path | Notes |
| --- | --- | --- | --- |
| Auth/session | Existing auth integration | New unauth auth/check plus existing stale-session tests | Uses mocked OTP capture, no live email |
| Vendor onboarding | Existing draft/submit/admin finalize integration | New unauth draft/submit | Payment status is DB/stubbed, no live Stripe execution |
| Orders/commerce | Existing customer cart/order and vendor order integration | New unauth/wrong-role order tests | Checkout payment side effects stay stubbed |
| Admin/moderation | Existing admin role routes and vendor application finalize | New admin audit route read proof | Admin audit storage is Mongo-backed and insert-only |
| Ownership-sensitive resources | Existing discount IDOR and Connect account-link tests | New Connect status cross-owner 403 | No production data used |

## Commands

```bash
node --test tests/integration/launch-access-contract.integration.test.js
npm run test:integration
npm run test:contract
npm test
```

Results from 2026-06-28:

| Command | Result |
| --- | --- |
| `node --test tests/integration/launch-access-contract.integration.test.js` | 5 pass, 0 fail |
| `npm run test:integration` | 59 pass, 0 fail |
| `npm run test:contract` | 20 pass, 0 fail |
| `npm test` | 427 pass, 0 fail |

## Remaining Live Runtime Gaps

The following cannot be proven by isolated integration tests and remain runtime QA items:

- Final-domain browser cookie behavior for customer, vendor, and admin.
- Live SMTP OTP/password reset delivery.
- Stripe Connect onboarding with a real Stripe test connected account.
- Checkout/payment intent execution with a connected test vendor.
- Stripe webhook delivery from Stripe tooling/dashboard.
- Production admin review/finalize on a dedicated QA vendor application.

These gaps are tracked in `docs/qa/FINAL_RUNTIME_TEST_GAPS.md` and frontend issue `Digital-Builders-757/mosaic-biz-frontend-launch#243`.
