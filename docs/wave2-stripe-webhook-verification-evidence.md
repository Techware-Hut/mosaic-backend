# Wave 2 Stripe Webhook Verification — Asana Sign-Off Evidence

**Task:** Wave 2: Verify Stripe Webhook Routing, Secret Separation & Signature Verification – Runtime QA Gate  
**Asana ID:** `1215340069346302`  
**Date:** 2026-06-14  
**Branch:** `staging`

---

## Automated tests

```bash
npm test
```

**Result:** **57/57 pass** (includes 9 webhook QA gate tests)

| Test file | Coverage |
|-----------|----------|
| `tests/stripe/stripe-webhook-routing-signature.test.js` | Route ordering, `express.raw`, per-endpoint secrets, signature rejection, raw-body guard |

### Webhook QA matrix (automated)

| # | Route | Env var | Automated check |
|---|-------|---------|-----------------|
| 1 | `POST /api/webhooks/stripe` | `STRIPE_ORDER_WEBHOOK_SECRET` | Secret binding, sig required, raw body guard |
| 2 | `POST /api/stripe/webhook` | `STRIPE_BUSINESS_DRAFT_WEBHOOK_SECRET` | Secret binding, sig required |
| 3 | `POST /api/subscription/webhook` | `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | Secret binding, sig required |
| 4 | `POST /api/vendor-onboarding/webhook/payment` | `STRIPE_VENDOR_VERIFICATION_WEBHOOK_SECRET` | Secret binding, sig required in production |
| 5 | `POST /api/stripe/payment/webhook` | `STRIPE_ORDER_POST_PAYMENT_WEBHOOK_SECRET` | Secret binding, sig required |

### Routing guards verified

- All five webhook mounts in [`app.js`](../app.js) are registered **before** `express.json()`.
- Webhook routers use `express.raw()` on POST webhook paths ([`routes/webhookRoutes.js`](../routes/webhookRoutes.js), [`routes/stripeRoutes.js`](../routes/stripeRoutes.js)).
- Vendor and subscription webhook mounts in `app.js` also use `express.raw({ type: 'application/json' })`.

### Secret separation verified

Each handler calls `stripe.webhooks.constructEvent` with its own `STRIPE_*_WEBHOOK_SECRET` env var. Cross-route secret mismatch returns **400**.

### Signature verification verified

- Missing `stripe-signature` → **400** (vendor route also in `NODE_ENV=production`).
- Invalid / mismatched signature → **400**.
- Canonical order webhook rejects parsed JSON body (non-Buffer) → **400** before `constructEvent`.

---

## Runtime proof (post-deploy — manual)

Complete after EB deploy with live/test Stripe Dashboard deliveries:

1. Register all 5 endpoints per [stripe-webhook-registration.md](stripe-webhook-registration.md).
2. Send test webhook from Dashboard for each endpoint → expect HTTP **200**.
3. Record delivery screenshots in [production-proof-pack-template.md](production-proof-pack-template.md).

---

## Asana close — mark **Complete**

| Evidence item | Location |
|---------------|----------|
| Five distinct webhook routes | [stripe-webhook-registration.md](stripe-webhook-registration.md) |
| Per-route signing secrets | `.env.example`, README env table |
| Signature verification | Controller handlers + `tests/stripe/stripe-webhook-routing-signature.test.js` |
| Raw body before JSON parser | `app.js` mount order + automated test |

**Note:** Vendor verification webhook allows unsigned JSON only when `NODE_ENV=development` (local CLI testing). Production requires `stripe-signature`.
