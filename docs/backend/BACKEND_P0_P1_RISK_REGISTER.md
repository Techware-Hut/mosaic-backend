# Backend P0/P1 Risk Register

**Purpose:** Track launch-blocking and high-priority risks against P0/P1 contracts, with verification status from [BACKEND_LAUNCH_CONTRACT_VERIFICATION.md](BACKEND_LAUNCH_CONTRACT_VERIFICATION.md).

**Evidence date:** 2026-06-19  
**Branch:** `test/backend-launch-contract-smoke-guards`  
**Smoke tiers reference:** [production-smoke-checklist.md](../production-smoke-checklist.md)

---

## P0 risks (infrastructure / critical wiring)

| ID | Risk | Verification in this PR | Residual risk | Owner |
| --- | --- | --- | --- | --- |
| P0-R1 | API unreachable after deploy | Static: root + health mounts; smoke script covers `GET /`, `/api/health`, `/api/ready` | EB boot logs, deploy SHA confirmation still manual | Release |
| P0-R2 | Stripe webhook signature broken by middleware order | **Verified** — static tests assert webhooks before `express.json()` | Dashboard delivery + live sig still manual (P4 tier) | Backend + Stripe admin |
| P0-R3 | OTP or secrets in application logs | Not tested in this PR | Manual P0.3 after auth smoke | QA |
| P0-R4 | Wrong featured endpoint breaks marketplace home | **Verified** — canonical `/api/featured-products`; `/api/products/featured` absent | Frontend must not call stale path | Frontend |

---

## P1 risks (auth guards / protected routes)

| ID | Risk | Verification in this PR | Residual risk | Owner |
| --- | --- | --- | --- | --- |
| P1-R1 | Unauthenticated access to vendor business data | **Verified** — `GET /api/business/my` static guard | HTTP 401 smoke needs live API + vendor token | QA |
| P1-R2 | Unauthenticated admin user/product enumeration | **Verified** — static guards + `isAdmin` unit test; smoke adds unauth 401 checks | Response body when unauth (401 vs empty 200) needs live smoke | QA |
| P1-R3 | Customer checkout without auth | **Verified** — `POST /api/orders/initiate` static + existing controller tests | Live 401 smoke blocked until API up | QA |
| P1-R4 | Legacy payment intent abused | **Verified** — static guard + ownership 403 in payment-route-protection | Frontend may still hit legacy route | Frontend |
| P1-R5 | Vendor Stripe finance routes exposed | **Verified** — `/stripe/*` static guards | Live 401 smoke blocked until API up | QA |
| P1-R6 | Connect onboarding link/status exposed | **Verified** — connectRoutes static guards | Live vendor-token smoke blocked | QA |
| P1-R7 | Admin list leaks password/OTP fields | **Verified** — `toAdminUser` allowlist unit test | Full HTTP admin list audit with token | QA |
| P1-R8 | Stale frontend paths 404 in production | **Documented** — `/api/admin/users`, `/api/stripe/account-session` absent | Frontend must use `/admin/users`, `/stripe/*` | Frontend |

---

## Resolved gaps

| Gap | Location | Resolution | Branch |
| --- | --- | --- | --- |
| Unguarded admin products test route | `GET /admin/api/products/test` | **Removed** — debug-only route not used in prod UI or smoke | `fix/backend-guard-admin-products-test-route` |

---

## Known gaps (document only)

| Gap | Location | Severity | Recommended follow-up |
| --- | --- | --- | --- |
| Public admin category routes | `GET /api/admin/categories` (see API_SURFACE) | Medium | Separate audit PR — **approval required** |
| Legacy payment route overlap | `/api/payments/create-payment-intent` vs `/api/orders/initiate` | Medium | Frontend migration plan — **no payment logic change without approval** |
| No global 404 handler | Express default for unknown routes | Low | Document only; alias PRs **not approved** |
| Inconsistent error response shapes | Various controllers | Low | Contract normalization deferred |

---

## Stop-for-approval gates

Do **not** proceed without explicit approval for:

- Changing payment logic (checkout, PaymentIntent, Connect charges)
- Changing webhook handlers or signing behavior
- Changing auth, CORS, or cookie behavior
- Adding route aliases (e.g. `/api/products/featured`, `/api/admin/users`)
- Deleting or reordering routes or middleware
- Changing database schemas
- Deploying to EB or production

---

## Verification summary

| Category | Count |
| --- | --- |
| P0 contracts verified (repo-local) | 2 of 3 (P0.3 manual) |
| P1 contracts verified (repo-local) | 10+ static/unit |
| Smoke extensions added | 5 unauth checks (blocked until live API) |
| New automated tests | 16 |
| Business logic changes | **0** |

---

## External evidence checklist

- [ ] Run `npm run smoke:backend` with `API_BASE_URL` set (no secrets printed)
- [ ] Confirm Stripe Dashboard has five webhook endpoints with correct env secret names
- [ ] Confirm EB production env has required env var **names** (values in EB only)
- [ ] Frontend contract diff against [API_CONTRACT_AS_BUILT.md](API_CONTRACT_AS_BUILT.md)
- [ ] Full P1–P6 manual smoke with test accounts
- [ ] Release owner Go/No-Go sign-off
