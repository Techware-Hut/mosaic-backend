# Request Validation and Rate Limit Audit (Issue #57)

**Date:** 2026-06-18  
**Branch:** `sprint/backend-deploy-smoke-sentry-18-27`

---

## Purpose

Inventory rate limiters, request validation, and payload safety controls. Document Express 5 sanitization fix and optional JSON body size limit.

---

## Rate limiters

All use `express-rate-limit`, 15-minute window unless noted.

### Auth / user routes ([`routes/userRoutes.js`](../routes/userRoutes.js))

| Route | Limiter | Max / 15 min |
| --- | --- | --- |
| `POST /register` | `registerLimiter` | 5 |
| `POST /login` | `loginLimiter` | 15 |
| `POST /verify-otp` | `otpVerifyLimiter` | 10 |
| `POST /resend-otp` | `otpResendLimiter` | 5 |
| `POST /forgot-password` | `forgotPasswordLimiter` | 5 |
| `POST /reset-password` | `resetPasswordLimiter` | 10 |

Validation: `express-validator` on all POST bodies above.

### OAuth routes ([`routes/authRoutes.js`](../routes/authRoutes.js))

| Route | Limiter | Max / 15 min |
| --- | --- | --- |
| `GET /google` | `googleStartLimiter` | 20 |
| `GET /google/callback` | `googleCallbackLimiter` | 20 |
| `POST /google/complete` | `googleCompleteLimiter` | 10 |

### Payment routes ([`routes/paymentRoutes.js`](../routes/paymentRoutes.js))

| Route | Limiter | Max / 15 min |
| --- | --- | --- |
| `POST /create-payment-intent` | `paymentLimiter` | 10 |

Requires `authenticate` + `isCustomer` + MongoId validation on `orderId`.

### Gaps (no global limiter)

| Area | Risk | Recommendation |
| --- | --- | --- |
| Public list/search GETs | Scraping / DoS | CDN/WAF or API gateway throttle (ops) |
| Authenticated vendor CRUD | Abuse per token | Per-route limits deferred |
| Webhook endpoints | Stripe-only traffic | Signature verification sufficient |

---

## Payload safety

### Stripe webhooks — raw body (before JSON parser)

In [`app.js`](../app.js), webhook routes mount **before** `express.json()`:

1. `POST /api/stripe/payment/webhook` — order payment
2. `POST /api/vendor-onboarding/webhook/payment` — vendor verification
3. `POST /api/subscription/webhook` — subscription billing

Each uses `express.raw({ type: 'application/json' })` for signature verification.

### JSON body parser

```javascript
app.use(express.json({ limit: '1mb' }));
```

**Batch 3 change:** explicit 1 MB cap. Webhooks unaffected (registered above parser). Typical API payloads << 1 MB.

### Mongo sanitize + XSS (Express 5 fix)

Express 5 makes `req.query` read-only. Middleware in `app.js` sanitizes **`req.body` and `req.params` only** — avoids 500 on all GET requests.

Uses `mongo-sanitize` and `xss-clean/lib/xss` with recursive object walk (same pattern as legacy xss-clean).

---

## Validation coverage snapshot

| Layer | Mechanism |
| --- | --- |
| Auth registration/login | `express-validator` in userRoutes |
| Payment intent | MongoId + optional amount/currency |
| Vendor onboarding | Controller + dedicated field allowlists |
| Public query params | Parsed/clamped in controllers (pagination caps — see [PUBLIC_API_PAGINATION_AUDIT.md](PUBLIC_API_PAGINATION_AUDIT.md)) |

No centralized Zod/Joi schema layer — incremental express-validator on sensitive routes.

---

## Recommendations (deferred)

1. Global authenticated API rate limit (e.g. 300 req/15 min per user ID).
2. Helmet CSP/HSTS review for production EB (#57 follow-up).
3. Request size logging when `413` payload too large occurs.

---

## Issue #57 status

**Batch 5 update (2026-06-22):** Core inventory complete; Express 5 sanitization + 1 MB JSON limit applied and tested.

| Item | Status |
| --- | --- |
| Rate limiter inventory (auth, OAuth, payment) | **Done** |
| Stripe webhook raw body ordering | **Done** — [`tests/security/payload-safety.test.js`](../tests/security/payload-safety.test.js) |
| JSON body 1 MB cap | **Done** |
| Mongo sanitize + XSS (body/params only) | **Done** |
| Public GET throttling | **Deferred** — CDN/WAF (ops) |
| Global authenticated rate limit | **Deferred** |
| Helmet CSP/HSTS | **Deferred** — production EB review |
| Oversized payload integration test | **Deferred** — source contract tests sufficient for launch |

See also [`docs/ADMIN_AUTHORIZATION_MATRIX.md`](ADMIN_AUTHORIZATION_MATRIX.md) for admin mutation guard coverage (#66).
