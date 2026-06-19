# Backend Launch Contract Verification

**Purpose:** Automated and smoke-script proof that P0/P1 launch contracts from the merged as-built documentation pack are registered, guarded, and test-ready — without changing payment, auth, webhook, or middleware logic.

**Branch:** `test/backend-launch-contract-smoke-guards` (verification); `fix/backend-guard-admin-products-test-route` (hardening fix)  
**Evidence date:** 2026-06-19  
**Baseline docs:** [BACKEND_ROUTE_REGISTRATION.md](BACKEND_ROUTE_REGISTRATION.md), [API_CONTRACT_AS_BUILT.md](API_CONTRACT_AS_BUILT.md), [AUTH_CORS_COOKIE_AUDIT.md](AUTH_CORS_COOKIE_AUDIT.md), [STRIPE_PAYMENT_CONNECT_AUDIT.md](STRIPE_PAYMENT_CONNECT_AUDIT.md)

**Related:** [BACKEND_P0_P1_RISK_REGISTER.md](BACKEND_P0_P1_RISK_REGISTER.md)

---

## PR metadata (fill on merge)

| Field | Value |
| --- | --- |
| Branch | `fix/backend-guard-admin-products-test-route` |
| Commit SHA | `728d059` |
| PR link | https://github.com/Techware-Hut/mosaic-backend/pull/96 |
| Deploy | **Not performed** |
| Merge | **Not performed** |

---

## Commands run

| Command | Exit code | Result |
| --- | --- | --- |
| `git fetch origin main && git checkout main && git pull origin main` | 0 | Fast-forward to docs pack on main |
| `git checkout -b test/backend-launch-contract-smoke-guards` | 0 | Branch created |
| `npm test` | 0 | **228 pass**, 0 fail |
| `npm run test:contract` | 0 | **16 pass**, 0 fail |
| `npm run smoke:backend` | **Not run** | Requires live API (`API_BASE_URL`); see smoke script extensions below |

### Test summary

```
npm test → node --test tests/**/*.test.js
ℹ tests 228
ℹ pass 228
ℹ fail 0

npm run test:contract → node --test tests/launch/backend-launch-contract.test.js
ℹ tests 16
ℹ pass 16
ℹ fail 0
```

**Delta from docs pack baseline:** +16 contract tests (212 → 228 total).

---

## P0/P1 contract matrix

| ID | Contract | Evidence | Result | Type |
| --- | --- | --- | --- | --- |
| P0.1 | `GET /`, `GET /api/health`, `GET /api/ready` registered and public | `tests/launch/backend-launch-contract.test.js`, `tests/health/health-readiness.test.js` | **PASS** | static + unit |
| P0.2 | Stripe webhooks mounted before `express.json()` | `tests/launch/backend-launch-contract.test.js`, `tests/stripe/stripe-webhook-routing-signature.test.js`, `tests/stripe/payment-route-protection.test.js` | **PASS** | static |
| P0.3 | Log hygiene (no OTP in logs) | Existing auth tests | **Not in scope** | manual |
| P0.4 | CORS preflight on featured-products | `scripts/smoke-backend.ps1` / `.sh` | **BLOCKED** (smoke not run) | smoke |
| P1 featured | `GET /api/featured-products` canonical public endpoint | Contract test + `tests/marketplace/featured-products-response.test.js` + `tests/stripe/checkout-approval-paymentintent-safety.test.js` | **PASS** | static + unit |
| P1 absent | `GET /api/products/featured` not registered | Contract test + checkout-approval test | **PASS** | static |
| P1 business | `GET /api/business/my` requires `authenticate` + `isBusinessOwner` | Contract test | **PASS** | static |
| P1 admin users | `/admin/users/*` requires admin auth | Contract test + `tests/admin/admin-users-response.test.js` | **PASS** | static + unit |
| P1 admin products | `/admin/api/products/` list + featured PATCH require admin | Contract test | **PASS** | static |
| P1 admin leak | Admin DTO strips sensitive fields; non-admin gets 403 | Contract test + admin-users-response | **PASS** | unit |
| P1 orders | `POST /api/orders/initiate` requires customer auth | Contract test + `tests/stripe/order-initiate-connect.test.js` + smoke P4.2 | **PASS** (static); smoke **BLOCKED** | static + smoke |
| P1 legacy payment | `POST /api/payments/create-payment-intent` guarded (legacy; canonical is `orders/initiate`) | Contract test + `tests/stripe/payment-route-protection.test.js` | **PASS** | static + unit |
| P1 Connect | `/api/connect/:businessId/account-link` and `/status` guarded | Contract test | **PASS** | static |
| P1 Stripe finance | `/stripe/account-session`, `/express-login-link`, `/account-balance`, `/last-payout` guarded | Contract test + payment-route-protection | **PASS** | static |
| P3 admin smoke | Unauthenticated admin list returns 401 | Smoke P3.0, P3.1 | **BLOCKED** (smoke not run) | smoke |
| P4 payment smoke | Unauthenticated legacy payment intent returns 401 | Smoke P4.3 | **BLOCKED** (smoke not run) | smoke |
| P5 finance smoke | Unauthenticated `/stripe/account-balance` returns 401 | Smoke P5.0 | **BLOCKED** (smoke not run) | smoke |
| P6 absent smoke | `GET /api/products/featured` returns 404 | Smoke P6.0 | **BLOCKED** (smoke not run) | smoke |

---

## Route inspection table (task-specific paths)

| Path | Registered | Guarded | Notes |
| --- | --- | --- | --- |
| `/admin/users` | **Yes** | **Yes** — `router.use(authenticate, isAdmin)` | Mount: `app.js` → `routes/admin/userRoutes.js` |
| `/admin/api/products` | **Yes** | **Yes** — per-route `authenticate, isAdmin` on `/` and `/:productId/featured` | Debug route `GET /admin/api/products/test` **removed** in `fix/backend-guard-admin-products-test-route` |
| `/stripe/account-session` | **Yes** | **Yes** — `authenticate, isBusinessOwner` | Mounted at `/stripe`, not `/api/stripe` |
| `/stripe/express-login-link` | **Yes** | **Yes** | same |
| `/stripe/account-balance` | **Yes** | **Yes** | same |
| `/stripe/last-payout` | **Yes** | **Yes** | same |
| `/api/admin/users` | **No** | — | Use `/admin/users` |
| `/api/stripe/account-session` | **No** | — | Finance routes live under `/stripe/*` |
| `/api/orders/initiate` | **Yes** | **Yes** — `authenticate, isCustomer` | Canonical Connect checkout |
| `/api/payments/create-payment-intent` | **Yes** | **Yes** — `authenticate, isCustomer` + rate limit | **Legacy**; canonical flow is `orders/initiate` |

---

## Files added or changed

| File | Change |
| --- | --- |
| `tests/launch/backend-launch-contract.test.js` | **Added** — 16 launch contract tests |
| `package.json` | **Added** `test:contract` script |
| `scripts/smoke-backend.ps1` | **Extended** — P3.0, P3.1, P4.3, P5.0, P6.0 unauth checks |
| `scripts/smoke-backend.sh` | **Extended** — parity with PowerShell script |
| `docs/backend/BACKEND_LAUNCH_CONTRACT_VERIFICATION.md` | **Added** — this file |
| `docs/backend/BACKEND_P0_P1_RISK_REGISTER.md` | **Added** — risk register |
| `docs/backend/BACKEND_DOCUMENTATION_EVIDENCE_LOG.md` | **Updated** — this PR evidence |
| `docs/README.md` | **Updated** — index links |

---

## What was NOT tested

- Live Stripe PaymentIntent creation or charges
- Webhook delivery with production signing secrets
- AWS S3 uploads, SMTP email delivery
- Elastic Beanstalk deploy
- `npm run smoke:backend` against production or local running server (no server started in CI for this PR)
- Authenticated admin HTTP response body audit (empty vs data when wrong role)
- Full manual P0–P6 production smoke checklist
- Frontend payment redirect URL behavior

---

## Evidence still needed externally

| Item | Owner |
| --- | --- |
| Run extended smoke script against staging/production `API_BASE_URL` | QA / release owner |
| Production EB env var audit (names only in EB) | AWS / release owner |
| Stripe Dashboard webhook URLs for five endpoints | Stripe admin |
| Production `CORS_ORIGINS` value confirmation | AWS EB + frontend |
| Frontend path audit: `/api/admin/users`, `/api/stripe/account-session` | Frontend team |
| Whether frontend still calls legacy `POST /api/payments/create-payment-intent` | Frontend team |
| Go/No-Go launch sign-off | Product / release owner |

---

## Admin products test route fix (2026-06-19)

| Field | Decision |
| --- | --- |
| Route | `GET /admin/api/products/test` |
| Finding | Public debug endpoint; not referenced by smoke scripts, frontend contract, or production UI |
| Fix | **Removed** from `routes/admin/adminProductRoutes.js` |
| Tests | `tests/admin/admin-product-routes-guard.test.js`; launch contract test updated |
| Branch | `fix/backend-guard-admin-products-test-route` |

---

## Recommended next PR (requires approval)

| Item | Severity | Action |
| --- | --- | --- |
| Stale frontend paths `/api/admin/users`, `/api/stripe/*` | Medium | Frontend contract diff only — **no backend aliases without approval** |
| Legacy `create-payment-intent` overlap | Medium | Document deprecation; migrate frontend to `orders/initiate` — **no payment logic change without approval** |

**No payment, webhook, auth, CORS, cookie, middleware-order, schema, deploy, or route-alias changes were made in this PR.**
