# Backend Launch Blockers — Batch 2 Proof Pack

**Branch:** `sprint/backend-launch-blockers-41-43-69`  
**Date:** 2026-06-18  
**Issues:** #41, #43, #69 (+ smoke support for #27)

---

## Commit

Record after commit:

```text
git rev-parse HEAD
```

---

## Files changed

| File | Issue | Change |
| --- | --- | --- |
| `routes/paymentRoutes.js` | #41 | `authenticate`, `isCustomer` on legacy PI route |
| `routes/stripe.routes.js` | #41 | Auth middleware on all `/stripe/*` routes |
| `routes/orderRoutes.js` | #41 | `isCustomer` on `/initiate` |
| `controllers/paymentController.js` | #41 | Order ownership + already-paid guard |
| `controllers/stripe.controller.js` | #41 | Connect account ownership checks |
| `utils/stripeConnectOwnership.js` | #41 | Shared ownership helper |
| `controllers/orderController.js` | #43 | Removed pre-payment emails |
| `controllers/stripePaymentController.js` | #43 | `paidConfirmationEmailSentAt` dedup |
| `models/Order.js` | #43 | `paidConfirmationEmailSentAt` field |
| `routes/healthRoutes.js` | #69 | New `/api/health`, `/api/ready` |
| `app.js` | #69 | Mount health routes after JSON parser |
| `tests/stripe/payment-route-protection.test.js` | #41 | New route/auth tests |
| `tests/stripe/order-email-safety.test.js` | #43 | Duplicate email + no pre-payment sends |
| `tests/health/health-readiness.test.js` | #69 | Health/readiness tests |
| `docs/BACKEND_LAUNCH_BLOCKERS_BATCH_2_AUDIT.md` | All | Audit |
| `docs/BACKEND_LAUNCH_BLOCKERS_BATCH_2_PROOF.md` | All | This file |

---

## Tests run

| Command | Result |
| --- | --- |
| `npm test` | **190/190 pass** (was 178 before batch 2) |
| `npm run lint` | Not defined |
| `npm run build` | Not defined |
| `node scripts/verify-auth-check-smoke.js` | Skipped (requires live credentials) |

---

## Payment route protection matrix (summary)

| Route | Unauthenticated | Wrong role | Authorized |
| --- | --- | --- | --- |
| `POST /api/payments/create-payment-intent` | **401** | **403** (non-customer) | 200 if order owned |
| `POST /stripe/account-session` | **401** | **403** (non-vendor) | 200 if Connect account owned |
| `POST /api/orders/initiate` | **401** | **403** (non-customer) | 201 Connect checkout |
| Stripe webhooks | Signature required | N/A | 200 with valid sig |
| `POST /stripe/backfill-customers` | **401** | **403** (non-admin) | Admin only |

Full matrix: [BACKEND_LAUNCH_BLOCKERS_BATCH_2_AUDIT.md](BACKEND_LAUNCH_BLOCKERS_BATCH_2_AUDIT.md)

---

## Order email timing proof

| Scenario | Expected | Test |
| --- | --- | --- |
| Order initiated (PI created) | **No** customer/vendor confirmation email | Source audit + removed block |
| `payment_intent.succeeded` webhook | `sendOrderPaidEmails` once | `order-email-safety.test.js` |
| Duplicate webhook retry | **No** second paid email | `paidConfirmationEmailSentAt` guard |
| SMTP failure on paid email | Webhook still `{ received: true }` | Existing test preserved |

**Email trigger point (after):** `stripePaymentWebhook` → `sendOrderPaidEmails` only after confirmed payment.

---

## Health / readiness proof

| Endpoint | Status | Body highlights |
| --- | --- | --- |
| `GET /api/health` | 200 | `status: ok`, `service`, `uptime`, `timestamp` — no DB |
| `GET /api/ready` (DB connected) | 200 | `status: ready`, `database: connected` |
| `GET /api/ready` (DB down) | 503 | `status: not_ready`, `database: disconnected` |

No connection strings or secrets in responses (test + source audit).

---

## Smoke commands (#27 support)

### Local (after `npm start`)

```powershell
curl.exe -s -o NUL -w "%{http_code}" http://localhost:3001/api/health
curl.exe -s http://localhost:3001/api/ready
curl.exe -s "http://localhost:3001/api/featured-products?page=1&limit=12"
curl.exe -s "http://localhost:3001/api/products/list?page=1&limit=10"
curl.exe -s "http://localhost:3001/api/public/search?keyword=test"
curl.exe -s "http://localhost:3001/api/ranked?page=1&pageSize=24"
curl.exe -s http://localhost:3001/api/categories
```

### Production (pre-deploy — health endpoints 404 until EB deploy)

```powershell
curl.exe -s -o NUL -w "%{http_code}" https://api.mosaicbizhub.com/
curl.exe -s -o NUL -w "%{http_code}" https://api.mosaicbizhub.com/api/featured-products?page=1&limit=12
```

### Authorization checks (expect 401 without cookie/token)

```powershell
curl.exe -s -o NUL -w "%{http_code}" -X POST https://api.mosaicbizhub.com/api/payments/create-payment-intent -H "Content-Type: application/json" -d "{\"orderId\":\"507f1f77bcf86cd799439011\"}"
curl.exe -s -o NUL -w "%{http_code}" -X POST https://api.mosaicbizhub.com/stripe/account-session -H "Content-Type: application/json" -d "{\"account\":\"acct_test\"}"
```

### Stripe webhook (local only)

Use Stripe CLI against raw-body routes — do not expose secrets in docs. See [STRIPE_WEBHOOKS.md](STRIPE_WEBHOOKS.md).

---

## Env vars (no values)

Unchanged for this batch. Payment/email still require:

- `STRIPE_SECRET_KEY`, webhook secrets (`STRIPE_ORDER_*`, etc.)
- `MAIL_USER`, `MAIL_PASSWORD` for SMTP
- `JWT_SECRET` for auth gates
- `MONGODB_URI` for readiness

---

## Schema change

| Model | Field | Purpose |
| --- | --- | --- |
| `Order` | `paidConfirmationEmailSentAt` | Webhook email idempotency (#43) |

No SQL migrations — Mongoose schema only.

---

## Remaining launch blockers

| Issue | Status after batch 2 |
| --- | --- |
| #41 Payment route protection | **Addressed** in this branch (legacy + `/stripe/*`) |
| #43 Order email timing | **Addressed** in this branch |
| #69 Health/readiness | **Addressed** in this branch |
| #27 Full smoke proof | **Partial** — commands documented; needs `SMOKE_TEST_*` accounts + post-deploy run |
| #18 Sentry EB deploy | Open |
| Billing route IDOR (#76) | Deferred |

---

## Risks before deploy

1. Changes not live until EB deploy from merged branch
2. Legacy clients calling `/api/payments/create-payment-intent` without auth will receive **401**
3. Vendors/customers who relied on pre-payment “order placed” email will only get post-payment confirmation
4. Confirm `paidConfirmationEmailSentAt` persists on existing orders (defaults null — safe)

---

## Related docs

- [BACKEND_LAUNCH_BLOCKERS_BATCH_2_AUDIT.md](BACKEND_LAUNCH_BLOCKERS_BATCH_2_AUDIT.md)
- [BACKEND_STABILITY_PROOF.md](BACKEND_STABILITY_PROOF.md)
- [production-smoke-checklist.md](production-smoke-checklist.md)
